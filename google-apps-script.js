/**
 * Google Apps Script for VentureScope Form Submissions — SHEETS ONLY
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SUPERSEDED. Prefer google-apps-script-with-resend.js, which does what     │
 * │ this does and also sends confirmation emails.                            │
 * │                                                                          │
 * │ This file is kept for deployments that only want rows in a sheet and no  │
 * │ email at all. It carries the same abuse controls as its sibling, for the │
 * │ reason described in SECURITY.md: an earlier revision of the Resend       │
 * │ handler was an unauthenticated endpoint and was abused. This script had  │
 * │ the same shape. Do not deploy a copy of the old version of either.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Create a new Google Sheet:
 *    - Go to https://sheets.google.com
 *    - Create a new spreadsheet named "VentureScope Form Submissions"
 *    - Create two sheets (tabs): "Quick Forms" and "Intake Forms"
 *
 * 2. Open Apps Script:
 *    - In your Google Sheet, go to Extensions > Apps Script
 *    - Delete any default code
 *    - Copy and paste this entire script
 *    - Save the project (Ctrl+S / Cmd+S)
 *
 * 3. Set the shared secret (REQUIRED — the script rejects everything without it):
 *    - Project Settings > Script Properties > Add script property
 *    - Key: FORM_SHARED_SECRET
 *    - Value: run generateSharedSecret() below and copy what it logs
 *    - Put the same value in FORM_TOKEN in index.html
 *
 * 4. Deploy as Web App:
 *    - Click the "Deploy" button (top right)
 *    - Select "New deployment"
 *    - Click the gear icon next to "Select type" and choose "Web app"
 *    - Description: "VentureScope Form Handler"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"   <-- required for a public form; the token and
 *      rate limits are what make this safe, not the access setting.
 *    - Click "Deploy"
 *    - Copy the Web App URL (you'll need this for your website)
 *
 * 5. Update Your Website:
 *    - Set FORM_ENDPOINT and FORM_TOKEN in index.html (or via admin.html).
 */

const CONFIG = {
  FORM_SHARED_SECRET: PropertiesService.getScriptProperties().getProperty('FORM_SHARED_SECRET'),

  MAX_SUBMISSIONS_PER_HOUR: 20,
  RECIPIENT_COOLDOWN_MINUTES: 60,
  MAX_FIELD_LENGTH: 500,
  MAX_LONGTEXT_LENGTH: 2000,
  MAX_PAYLOAD_CHARS: 50000
};

// Main function to handle POST requests from the website
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'Bad request' });
    }

    // A processing cap, not a bandwidth one: Apps Script has already buffered
    // the whole body by the time this runs.
    if (e.postData.contents.length > CONFIG.MAX_PAYLOAD_CHARS) {
      return jsonResponse({ status: 'error', message: 'Payload too large' });
    }

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return jsonResponse({ status: 'error', message: 'Bad request' });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return jsonResponse({ status: 'error', message: 'Bad request' });
    }

    // Honeypot — a real browser leaves this empty. Fake success so bots
    // don't retry.
    if (String(data.hp_company_url || '').trim() !== '') {
      Logger.log('Honeypot triggered — dropping submission.');
      return jsonResponse({ status: 'success', message: 'Form submitted successfully' });
    }

    // Shared secret. Fails closed when the property is unset.
    if (!verifyToken(data.token)) {
      Logger.log('Rejected: missing or invalid token.');
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }

    const formType = data.formType;
    if (formType !== 'quick' && formType !== 'intake') {
      return jsonResponse({ status: 'error', message: 'Unknown form type' });
    }

    const submitter = normalizeEmail(formType === 'quick' ? data.email : data.workEmail);
    if (!isValidEmail(submitter)) {
      return jsonResponse({ status: 'error', message: 'A valid email address is required' });
    }

    const gate = checkRateLimits(submitter);
    if (!gate.ok) {
      Logger.log('Rejected by rate limit: ' + gate.reason);
      return jsonResponse({ status: 'error', message: gate.message });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (formType === 'quick') {
      handleQuickForm(ss, data, submitter);
    } else {
      handleIntakeForm(ss, data, submitter);
    }

    return jsonResponse({ status: 'success', message: 'Form submitted successfully' });

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    // Never echo the internal error back to the caller.
    return jsonResponse({ status: 'error', message: 'Submission failed' });
  }
}

function doGet() {
  return jsonResponse({ status: 'error', message: 'Method not allowed' });
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// SECURITY HELPERS
//
// These are duplicated verbatim from google-apps-script-with-resend.js, which
// is the canonical copy — Apps Script projects can't share a module, and these
// two deploy independently. Change them there first, then mirror the change
// here. test-security-controls.js asserts the two copies reject the same
// inputs and will fail if they drift, but it can only catch drift in behavior
// it already covers, so keep them textually in step.
// ============================================

function verifyToken(provided) {
  const expected = CONFIG.FORM_SHARED_SECRET;

  if (!expected) {
    Logger.log('FORM_SHARED_SECRET is not set — refusing all submissions.');
    return false;
  }

  // Fixed-length digests: nothing to short-circuit on, so neither the token
  // nor its length leaks through timing.
  const got = sha256Bytes(String(provided == null ? '' : provided));
  const want = sha256Bytes(expected);

  let diff = 0;
  for (let i = 0; i < want.length; i++) {
    diff |= got[i] ^ want[i];
  }
  return diff === 0;
}

function sha256Bytes(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
}

function submitterCacheKey(email) {
  return 'vs_sheets_' + Utilities.base64EncodeWebSafe(sha256Bytes(email));
}

function checkRateLimits(email) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(5000);
  } catch (lockError) {
    return { ok: false, reason: 'lock timeout', message: 'Server busy, please try again in a moment.' };
  }

  try {
    const key = submitterCacheKey(email);
    if (cache.get(key)) {
      return {
        ok: false,
        reason: 'submitter cooldown',
        message: 'We already have a recent request from this address.'
      };
    }

    const hourBucket = Math.floor(new Date().getTime() / (60 * 60 * 1000));
    const globalKey = 'vs_sheets_global_' + hourBucket;
    const count = parseInt(cache.get(globalKey) || '0', 10);

    if (count >= CONFIG.MAX_SUBMISSIONS_PER_HOUR) {
      return {
        ok: false,
        reason: 'global hourly cap reached (' + count + ')',
        message: 'Too many requests right now. Please try again later.'
      };
    }

    cache.put(globalKey, String(count + 1), 3600);
    cache.put(key, '1', CONFIG.RECIPIENT_COOLDOWN_MINUTES * 60);
    return { ok: true };

  } finally {
    lock.releaseLock();
  }
}

function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  return /^[^\s@,;:<>"'\\]+@[^\s@,;:<>"'\\]+\.[A-Za-z]{2,}$/.test(email);
}

function plainText(value, maxLength) {
  const limit = maxLength || CONFIG.MAX_FIELD_LENGTH;
  const raw = String(value == null ? '' : value)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.length > limit ? raw.slice(0, limit) + '…' : raw;
}

/**
 * Neutralizes spreadsheet formula injection — a cell starting with = + - @
 * is executed by Sheets when the sheet is opened.
 *
 * The \t and \r in the class are unreachable today: plainText() runs first and
 * collapses all whitespace, so nothing reaches here with a leading tab or
 * carriage return. They stay because this guard should not silently weaken if
 * plainText's normalization is ever narrowed.
 */
function sheetSafe(value, maxLength) {
  const v = plainText(value, maxLength);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

// ============================================
// FORM HANDLERS
// ============================================

function handleQuickForm(ss, data, submitter) {
  let sheet = ss.getSheetByName('Quick Forms');

  if (!sheet) {
    sheet = ss.insertSheet('Quick Forms');
    sheet.appendRow([
      'Timestamp',
      'Full Name',
      'Email',
      'Service'
    ]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#dc2626').setFontColor('#ffffff');
  }

  sheet.appendRow([
    new Date(),
    sheetSafe(data.fullName),
    sheetSafe(submitter),
    sheetSafe(data.service)
  ]);
}

function handleIntakeForm(ss, data, submitter) {
  let sheet = ss.getSheetByName('Intake Forms');

  if (!sheet) {
    sheet = ss.insertSheet('Intake Forms');
    sheet.appendRow([
      'Timestamp',
      'Full Name',
      'Work Email',
      'Phone',
      'Job Title',
      'Company Name',
      'Industry',
      'Team Size',
      'Website',
      'Service',
      'Process Description',
      'Pain Points',
      'Start Date',
      'Budget Range',
      'How Did You Hear'
    ]);
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold').setBackground('#dc2626').setFontColor('#ffffff');
  }

  sheet.appendRow([
    new Date(),
    sheetSafe(data.fullName),
    sheetSafe(submitter),
    sheetSafe(data.phone, 50),
    sheetSafe(data.jobTitle),
    sheetSafe(data.companyName),
    sheetSafe(data.industry),
    sheetSafe(data.teamSize),
    sheetSafe(data.website, 300),
    sheetSafe(data.service),
    sheetSafe(data.processDescription, CONFIG.MAX_LONGTEXT_LENGTH),
    sheetSafe(data.painPoints, CONFIG.MAX_LONGTEXT_LENGTH),
    sheetSafe(data.startDate, 50),
    sheetSafe(data.budgetRange, 100),
    sheetSafe(data.hearAbout, 100)
  ]);
}

// ============================================
// SETUP & TEST FUNCTIONS
// ============================================

/**
 * Run once to mint a shared secret. Copy the logged value into Script
 * Properties as FORM_SHARED_SECRET, and into index.html's FORM_TOKEN.
 */
function generateSharedSecret() {
  const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  Logger.log('FORM_SHARED_SECRET: ' + secret);
  Logger.log('Set this in Project Settings > Script Properties, then put the same value in index.html.');
  return secret;
}

// Test function - run this to verify your setup
function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet name: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + ss.getId());
  Logger.log('Shared secret configured: ' + (CONFIG.FORM_SHARED_SECRET ? 'Yes' : 'No — ALL SUBMISSIONS WILL BE REJECTED'));
  Logger.log('Setup test completed successfully!');
}
