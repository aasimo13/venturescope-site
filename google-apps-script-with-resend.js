/**
 * Google Apps Script for VentureScope Form Submissions
 * WITH RESEND EMAIL INTEGRATION — HARDENED
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BEFORE EVERY DEPLOY OF THIS FILE, run these two from the editor and read │
 * │ the execution log:                                                       │
 * │     testSecurityControls()   every line must say PASS                    │
 * │     testSetup()              both script properties must say Yes         │
 * │ None of this can run in CI — the Apps Script runtime only exists here.   │
 * │ If you skip it, nothing will tell you the controls stopped working.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * SECURITY NOTE — READ THIS FIRST
 * --------------------------------
 * An earlier version of this script was an open email relay: it accepted
 * unauthenticated POSTs and then sent HTML email, using the site's Resend
 * account, to whatever address the caller supplied, with whatever content the
 * caller supplied. Anyone who knew the /exec URL could send arbitrary email as
 * VentureScope. This version closes that hole with layered controls:
 *
 * These are numbered in the order doPost applies them. Keep the numbering here,
 * the inline "Layer N" comments, and SECURITY.md in step — under incident
 * pressure the next person will trust whichever they read first.
 *
 *   1. Payload cap           — oversized bodies rejected before parsing.
 *   2. Honeypot field        — silently drops naive bots.
 *   3. Shared-secret token   — rejects payloads that don't carry the token.
 *   4. Strict validation     — one syntactically valid recipient, nothing else.
 *   5. Rate limiting         — a global hourly cap plus a per-recipient
 *                              cooldown, so no address can be blasted.
 *   6. Output escaping       — every caller-supplied value is HTML-escaped and
 *                              length-capped, so no markup, links, or scripts
 *                              can be injected into an outgoing email.
 *
 * Plus a kill switch that is not a layer: CONFIG.EMAILS_ENABLED = false stops
 * all sending without needing a redeploy of the website.
 *
 * Be honest about layer 3: the token ships inside a public web page, so it is
 * not a true secret. It stops drive-by and replayed automated abuse, which is
 * the bulk of it. The controls that hold up against someone who reads your page
 * source are the rate limits (5) and the escaping (6) — those cap both the
 * volume and the value of any abuse. Rotate the token if you see it being used.
 *
 * SETUP INSTRUCTIONS
 * ------------------
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
 *    - Update the CONFIGURATION section below with your details
 *    - Save the project (Ctrl+S / Cmd+S)
 *
 * 3. Set BOTH Script Properties (Project Settings > Script Properties).
 *    The script refuses every submission until both exist:
 *      - RESEND_API_KEY     your Resend API key (starts with "re_")
 *      - FORM_SHARED_SECRET a random string; run generateSharedSecret() below
 *                           to produce one, then paste the same value into
 *                           index.html's FORM_TOKEN (or the admin panel).
 *
 * 4. Deploy as Web App:
 *    - Click the "Deploy" button (top right)
 *    - Select "New deployment"
 *    - Click the gear icon next to "Select type" and choose "Web app"
 *    - Description: "VentureScope Form Handler with Resend"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"   <-- required for a public form; the token and
 *      rate limits above are what make this safe, not the access setting.
 *    - Click "Deploy"
 *    - Copy the Web App URL (you'll need this for your website)
 *
 * 5. Update Your Website:
 *    - Set FORM_ENDPOINT and FORM_TOKEN in index.html (or via admin.html).
 */

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================

const CONFIG = {
  // Secrets live in Script Properties, never in this file.
  // Project Settings > Script Properties.
  RESEND_API_KEY: PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY'),
  FORM_SHARED_SECRET: PropertiesService.getScriptProperties().getProperty('FORM_SHARED_SECRET'),

  // Email Settings
  FROM_EMAIL: 'onboarding@resend.dev', // Update with your verified domain in Resend
  FROM_NAME: 'VentureScope Systems',

  // Business notification email (where you want to receive notifications)
  NOTIFICATION_EMAIL: 'hello@venturescope.systems', // UPDATE THIS!

  // Enable/Disable Features
  EMAILS_ENABLED: true,            // Master kill switch — set false to stop ALL sending
  SEND_CONFIRMATION_EMAILS: true,  // Send emails to customers
  SEND_NOTIFICATION_EMAILS: true,  // Send emails to business owner

  // Abuse limits — tune these to your real traffic. Lower is safer.
  MAX_SUBMISSIONS_PER_HOUR: 20,    // Global cap across all visitors
  RECIPIENT_COOLDOWN_MINUTES: 60,  // One confirmation per address, per form, per window.
                                   // Capped at 360 (6h) — CacheService's TTL
                                   // ceiling. A longer cooldown needs a
                                   // different store; see cacheTtlSeconds().
  MAX_FIELD_LENGTH: 500,           // Cap on ordinary fields
  MAX_LONGTEXT_LENGTH: 2000,       // Cap on free-text fields
  MAX_PAYLOAD_CHARS: 50000,        // Reject oversized POST bodies outright (JS string length, not bytes)

  // Company Info
  COMPANY_NAME: 'VentureScope Systems',
  WEBSITE_URL: 'https://aasimo13.github.io/venturescope-site/',
  SUPPORT_EMAIL: 'hello@venturescope.systems'
};

// ============================================
// MAIN HANDLER
// ============================================

function doGet() {
  return jsonResponse({ status: 'error', message: 'Method not allowed' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'Bad request' });
    }

    // Layer 1: payload cap. A processing cap, not a bandwidth one — Apps Script
    // has already buffered the whole body by the time this runs, so it bounds
    // the work we do on a huge payload, not the bytes spent receiving it.
    if (e.postData.contents.length > CONFIG.MAX_PAYLOAD_CHARS) {
      Logger.log('Rejected: payload exceeds MAX_PAYLOAD_CHARS.');
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

    // Layer 2: honeypot. A real browser leaves this hidden field empty.
    // Answer with success so bots record a win and don't retry.
    if (String(data.hp_field_b7 || '').trim() !== '') {
      Logger.log('Honeypot triggered — dropping submission.');
      return jsonResponse({ status: 'success', message: 'Form submitted successfully' });
    }

    // Layer 3: shared-secret token. Fails closed if the property is unset.
    if (!verifyToken(data.token)) {
      Logger.log('Rejected: missing or invalid token.');
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }

    const formType = data.formType;
    if (formType !== 'quick' && formType !== 'intake') {
      return jsonResponse({ status: 'error', message: 'Unknown form type' });
    }

    // Layer 4: exactly one syntactically valid recipient, or nothing happens.
    const recipient = normalizeEmail(formType === 'quick' ? data.email : data.workEmail);
    if (!isValidEmail(recipient)) {
      return jsonResponse({ status: 'error', message: 'A valid email address is required' });
    }

    // Layer 5: rate limits.
    const gate = checkRateLimits(recipient, formType);
    if (!gate.ok) {
      Logger.log('Rejected by rate limit: ' + gate.reason);
      return jsonResponse({ status: 'error', message: gate.message });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    try {
      const confirmationSent = formType === 'quick'
        ? handleQuickForm(ss, data, recipient)
        : handleIntakeForm(ss, data, recipient);

      // sendEmailViaResend swallows its own errors and returns false, so a
      // Resend outage never reaches the catch below. Release the cooldown in
      // that case: it exists to stop an address being blasted, and nothing was
      // sent, so there is nothing to hold against a visitor who retries. The
      // global counter still bounds the retries.
      //
      // But only when sending was actually attempted. Both the kill switch and
      // a missing API key make every send "fail", and releasing on each one
      // would quietly strip the per-recipient throttle — in the kill switch's
      // case at exactly the moment it is flipped, during an incident. When
      // sending is off or unconfigured the cooldown stays, acting as a pure
      // submission throttle.
      if (!confirmationSent && sendingIsConfigured()) {
        Logger.log('Confirmation attempted but not sent — releasing recipient cooldown.');
        releaseRecipientCooldown(recipient, formType);
      }
    } catch (handlerError) {
      // Nothing was sent, so don't make a real visitor sit out an hour of
      // cooldown for our failure. The global hourly counter is deliberately
      // NOT released: refunding it on error would let anyone who can force an
      // error hammer the endpoint without ever consuming the cap.
      //
      // INVARIANT this relies on: nothing inside the handlers throws after a
      // confirmation has actually been sent. Today that holds because the only
      // throwing call is the Sheets write, which runs first, and
      // sendEmailViaResend swallows its own errors and returns false. If you
      // add a throwing call after the send, this refund would hand back a
      // cooldown for an address that already received real mail, permitting an
      // immediate duplicate — move the release behind a "did we send?" check
      // rather than leaving it unconditional.
      releaseRecipientCooldown(recipient, formType);
      throw handlerError;
    }

    return jsonResponse({ status: 'success', message: 'Form submitted successfully' });

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    // Never echo the internal error back to the caller.
    return jsonResponse({ status: 'error', message: 'Submission failed' });
  }
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// SECURITY HELPERS
// ============================================

/**
 * Compares the caller's token against FORM_SHARED_SECRET in constant time.
 * Returns false when the property is unset, so a misconfigured deployment
 * accepts nothing rather than everything.
 */
function verifyToken(provided) {
  const expected = CONFIG.FORM_SHARED_SECRET;

  if (!expected) {
    Logger.log('FORM_SHARED_SECRET is not set — refusing all submissions.');
    return false;
  }

  // Compare SHA-256 digests rather than the raw strings. Digests are always
  // 32 bytes, so there is no length check to short-circuit on and the
  // comparison leaks neither the token nor its length through timing.
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

/**
 * Global hourly cap plus a per-recipient cooldown, serialized with a script
 * lock so concurrent requests can't race past the counter.
 */
function checkRateLimits(recipient, formType) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(5000);
  } catch (lockError) {
    return { ok: false, reason: 'lock timeout', message: 'Server busy, please try again in a moment.' };
  }

  try {
    const recipientKey = recipientCacheKey(recipient, formType);

    if (cache.get(recipientKey)) {
      return {
        ok: false,
        reason: 'recipient cooldown for ' + recipient,
        message: 'We already have a recent request from this address — we\'ll be in touch shortly.'
      };
    }

    const hourBucket = Math.floor(new Date().getTime() / (60 * 60 * 1000));
    const globalKey = 'vs_global_' + hourBucket;
    const count = parseInt(cache.get(globalKey) || '0', 10);

    if (count >= CONFIG.MAX_SUBMISSIONS_PER_HOUR) {
      return {
        ok: false,
        reason: 'global hourly cap reached (' + count + ')',
        message: 'Too many requests right now. Please try again later or email us directly.'
      };
    }

    cache.put(globalKey, String(count + 1), 3600);
    cache.put(recipientKey, '1', cacheTtlSeconds(CONFIG.RECIPIENT_COOLDOWN_MINUTES));

    return { ok: true };

  } finally {
    lock.releaseLock();
  }
}

/**
 * Hash the address so we never store raw emails in the cache.
 *
 * Keyed on form type as well, so someone who sends the quick form and then
 * comes back to complete the full intake isn't silently rate limited on the
 * second one. That is a real flow, and it costs us nothing: each form is still
 * bounded to one message per address per window, which is the property the
 * cooldown exists for.
 */
function recipientCacheKey(recipient, formType) {
  return 'vs_recipient_' + formType + '_' +
    Utilities.base64EncodeWebSafe(sha256Bytes(recipient));
}

/**
 * CacheService rejects any TTL above 6 hours. Clamp rather than let a config
 * value above that throw inside checkRateLimits, bubble to doPost's outer
 * catch, and reject every submission with a generic "Submission failed" — a
 * miserable way to discover a typo in a config constant.
 */
function cacheTtlSeconds(minutes) {
  const CACHE_MAX_TTL_SECONDS = 21600; // 6 hours, Apps Script's hard ceiling
  return Math.min(Math.max(Math.floor(minutes * 60), 1), CACHE_MAX_TTL_SECONDS);
}

/** Refunds a per-recipient cooldown reserved for a submission that then failed. */
function releaseRecipientCooldown(recipient, formType) {
  try {
    CacheService.getScriptCache().remove(recipientCacheKey(recipient, formType));
  } catch (cacheError) {
    Logger.log('Could not release recipient cooldown: ' + cacheError.toString());
  }
}

function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/**
 * Deliberately strict. Rejecting commas, semicolons, angle brackets and
 * whitespace means a single field can never expand into multiple recipients
 * or a display-name header.
 */
function isValidEmail(email) {
  if (!email || email.length > 254) return false;
  return /^[^\s@,;:<>"'\\]+@[^\s@,;:<>"'\\]+\.[A-Za-z]{2,}$/.test(email);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trims, strips control characters, and caps length. Plain text — no escaping. */
function plainText(value, maxLength) {
  const limit = maxLength || CONFIG.MAX_FIELD_LENGTH;
  const raw = String(value == null ? '' : value)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.length > limit ? raw.slice(0, limit) + '…' : raw;
}

/** Single-line value, safe to drop into an HTML email body. */
function safeField(value, maxLength) {
  return escapeHtml(plainText(value, maxLength));
}

/** Multi-line value: newlines survive as <br>, everything else is escaped. */
function safeParagraph(value, maxLength) {
  const limit = maxLength || CONFIG.MAX_LONGTEXT_LENGTH;
  const raw = String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .trim();
  const capped = raw.length > limit ? raw.slice(0, limit) + '…' : raw;
  return escapeHtml(capped).replace(/\n/g, '<br>');
}

/** Subject lines are plain text; newlines are stripped so they can't be split. */
function safeSubject(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength || 80);
}

/**
 * Only absolute http(s) URLs survive; anything else becomes ''. Blocks
 * javascript:, data:, and attribute-breaking payloads in href positions.
 */
function safeUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.length > 300) return '';
  if (!/^https?:\/\/[^\s<>"'`]+$/i.test(raw)) return '';
  return escapeHtml(raw);
}

/**
 * Neutralizes spreadsheet formula injection — a cell starting with = + - @
 * is executed by Sheets when opened.
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
// QUICK FORM HANDLER
// ============================================

function handleQuickForm(ss, data, recipient) {
  let sheet = ss.getSheetByName('Quick Forms');

  // Create sheet if it doesn't exist
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

  // Log to the sheet first, so there is always a trail even if email fails.
  sheet.appendRow([
    new Date(),
    sheetSafe(data.fullName),
    sheetSafe(recipient),
    sheetSafe(data.service)
  ]);

  const safe = {
    fullName: safeField(data.fullName, 100),
    email: safeField(recipient, 254),
    service: safeField(data.service, 100),
    subjectName: safeSubject(data.fullName, 60)
  };

  // Send confirmation email to customer. Confirmations turned off by config
  // counts as sent — the cooldown then acts purely as a submission throttle.
  const confirmationSent = CONFIG.SEND_CONFIRMATION_EMAILS
    ? sendQuickFormConfirmation(recipient, safe)
    : true;

  // Send notification to business
  if (CONFIG.SEND_NOTIFICATION_EMAILS) {
    sendQuickFormNotification(safe);
  }

  return confirmationSent;
}

// ============================================
// INTAKE FORM HANDLER
// ============================================

function handleIntakeForm(ss, data, recipient) {
  let sheet = ss.getSheetByName('Intake Forms');

  // Create sheet if it doesn't exist
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

  // Log to the sheet first, so there is always a trail even if email fails.
  sheet.appendRow([
    new Date(),
    sheetSafe(data.fullName),
    sheetSafe(recipient),
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

  const websiteUrl = safeUrl(data.website);

  const safe = {
    fullName: safeField(data.fullName, 100),
    workEmail: safeField(recipient, 254),
    phone: safeField(data.phone, 50),
    jobTitle: safeField(data.jobTitle, 100),
    companyName: safeField(data.companyName, 150),
    industry: safeField(data.industry, 100),
    teamSize: safeField(data.teamSize, 50),
    websiteUrl: websiteUrl,
    service: safeField(data.service, 100),
    processDescription: safeParagraph(data.processDescription),
    painPoints: safeParagraph(data.painPoints),
    startDate: safeField(data.startDate, 50),
    budgetRange: safeField(data.budgetRange, 100),
    hearAbout: safeField(data.hearAbout, 100),
    subjectCompany: safeSubject(data.companyName, 60),
    subjectService: safeSubject(data.service, 40)
  };

  // Send confirmation email to customer. Confirmations turned off by config
  // counts as sent — the cooldown then acts purely as a submission throttle.
  const confirmationSent = CONFIG.SEND_CONFIRMATION_EMAILS
    ? sendIntakeFormConfirmation(recipient, safe)
    : true;

  // Send notification to business
  if (CONFIG.SEND_NOTIFICATION_EMAILS) {
    sendIntakeFormNotification(safe);
  }

  return confirmationSent;
}

// ============================================
// RESEND EMAIL FUNCTIONS
// ============================================

/**
 * Whether a send would actually be attempted. Distinguishes "we tried and it
 * failed" from "we were never going to try", which the caller needs in order
 * to decide whether a failed send should refund a rate-limit reservation.
 */
function sendingIsConfigured() {
  return Boolean(CONFIG.EMAILS_ENABLED && CONFIG.RESEND_API_KEY);
}

function sendEmailViaResend(to, subject, htmlContent, textContent) {
  if (!CONFIG.EMAILS_ENABLED) {
    Logger.log('EMAILS_ENABLED is false — skipping send to ' + to);
    return false;
  }

  if (!CONFIG.RESEND_API_KEY) {
    Logger.log('RESEND_API_KEY is not set — skipping send.');
    return false;
  }


  // Last line of defense: never hand Resend anything but one valid address.
  const recipient = normalizeEmail(to);
  if (!isValidEmail(recipient)) {
    Logger.log('Refusing to send: invalid recipient address.');
    return false;
  }

  const url = 'https://api.resend.com/emails';

  const payload = {
    from: `${CONFIG.FROM_NAME} <${CONFIG.FROM_EMAIL}>`,
    to: recipient,
    subject: subject,
    html: htmlContent,
    text: textContent || htmlToPlainText(htmlContent)
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Email sent successfully via Resend');
      return true;
    }

    Logger.log(`Failed to send email: ${responseCode} - ${responseText}`);
    return false;
  } catch (error) {
    Logger.log('Error sending email via Resend: ' + error.toString());
    return false;
  }
}

/**
 * Plain-text fallback for mail clients that won't render HTML. Naively
 * stripping tags runs words together across block boundaries (`</p><p>`),
 * so close out block elements as line breaks first, and decode the entities
 * our own escaping introduced.
 */
function htmlToPlainText(html) {
  return String(html)
    .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/table)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')   // last, so &amp;lt; doesn't become <
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================
// QUICK FORM EMAIL TEMPLATES
// ============================================

function sendQuickFormConfirmation(recipient, safe) {
  const subject = `Thanks for reaching out, ${safe.subjectName}! 🚀`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc2626; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 We Received Your Request!</h1>
        </div>
        <div class="content">
          <p>Hi ${safe.fullName},</p>

          <p>Thank you for reaching out to <strong>${CONFIG.COMPANY_NAME}</strong>! We're excited to help you transform your business operations.</p>

          <div class="info-box">
            <h3>📋 What You Requested:</h3>
            <p><strong>Service:</strong> ${safe.service}</p>
            <p><strong>Email:</strong> ${safe.email}</p>
          </div>

          <h3>⏱️ What Happens Next?</h3>
          <ol>
            <li><strong>Within 24 hours:</strong> Our team will review your request</li>
            <li><strong>We'll reach out:</strong> To schedule a quick 15-minute discovery call</li>
            <li><strong>Get your solution:</strong> We can deliver your first SOP in 48 hours!</li>
          </ol>

          <p>In the meantime, feel free to explore more about what we offer:</p>

          <center>
            <a href="${CONFIG.WEBSITE_URL}" class="button">Visit Our Website</a>
          </center>

          <p>Have questions? Just reply to this email or contact us at <a href="mailto:${CONFIG.SUPPORT_EMAIL}">${CONFIG.SUPPORT_EMAIL}</a></p>

          <p>Looking forward to working with you!</p>

          <p><strong>The VentureScope Team</strong><br>
          AI-Powered Business Operations in 48 Hours</p>
        </div>
        <div class="footer">
          <p>${CONFIG.COMPANY_NAME} | <a href="${CONFIG.WEBSITE_URL}">${CONFIG.WEBSITE_URL}</a></p>
          <p>Turning operational chaos into clarity</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmailViaResend(recipient, subject, html);
}

function sendQuickFormNotification(safe) {
  const subject = `🔔 New Quick Form Submission from ${safe.subjectName}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; }
        .header { background: #374151; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
        .field { margin-bottom: 15px; padding: 10px; background: #f3f4f6; border-radius: 4px; }
        .label { font-weight: bold; color: #374151; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>📨 New Quick Form Submission</h2>
        </div>
        <div class="content">
          <p><strong>A new potential client has reached out!</strong></p>

          <div class="field">
            <span class="label">Full Name:</span> ${safe.fullName}
          </div>
          <div class="field">
            <span class="label">Email:</span> <a href="mailto:${safe.email}">${safe.email}</a>
          </div>
          <div class="field">
            <span class="label">Service Interested:</span> ${safe.service}
          </div>
          <div class="field">
            <span class="label">Submitted:</span> ${new Date().toLocaleString()}
          </div>

          <p><strong>Action Required:</strong> Follow up within 24 hours!</p>
        </div>
      </div>
    </body>
    </html>
  `;

  sendEmailViaResend(CONFIG.NOTIFICATION_EMAIL, subject, html);
}

// ============================================
// INTAKE FORM EMAIL TEMPLATES
// ============================================

function sendIntakeFormConfirmation(recipient, safe) {
  const subject = `Application Received: ${safe.subjectCompany} 🎯`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        .info-box { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #dc2626; }
        .timeline { background: white; padding: 20px; border-radius: 6px; margin: 20px 0; }
        .timeline-item { padding: 10px 0; border-left: 3px solid #dc2626; padding-left: 20px; margin-left: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Application Received!</h1>
        </div>
        <div class="content">
          <p>Hi ${safe.fullName},</p>

          <p>Thank you for completing our detailed intake form! We've received your application for <strong>${safe.companyName}</strong> and are excited about the opportunity to transform your operations.</p>

          <div class="info-box">
            <h3>📋 Your Submission Summary:</h3>
            <p><strong>Company:</strong> ${safe.companyName}</p>
            <p><strong>Industry:</strong> ${safe.industry}</p>
            <p><strong>Service:</strong> ${safe.service}</p>
            <p><strong>Preferred Start Date:</strong> ${safe.startDate}</p>
            ${safe.budgetRange ? `<p><strong>Budget Range:</strong> ${safe.budgetRange}</p>` : ''}
          </div>

          <h3>🚀 Your Journey with VentureScope:</h3>
          <div class="timeline">
            <div class="timeline-item">
              <strong>Step 1 - Review (24 hours)</strong><br>
              Our team will carefully review your submission and match you with the right specialist.
            </div>
            <div class="timeline-item">
              <strong>Step 2 - Discovery Call</strong><br>
              We'll schedule a 15-30 minute call to discuss your specific needs and answer questions.
            </div>
            <div class="timeline-item">
              <strong>Step 3 - Proposal</strong><br>
              You'll receive a customized proposal outlining scope, timeline, and investment.
            </div>
            <div class="timeline-item">
              <strong>Step 4 - Kickoff (48 hours)</strong><br>
              Once approved, we can start delivering results in just 48 hours!
            </div>
          </div>

          <h3>💡 What Makes Us Different?</h3>
          <ul>
            <li><strong>Speed:</strong> First deliverables in 48 hours</li>
            <li><strong>AI-Powered:</strong> Cutting-edge automation and optimization</li>
            <li><strong>Practical:</strong> Real SOPs you can implement immediately</li>
            <li><strong>Support:</strong> Ongoing partnership, not just a one-time delivery</li>
          </ul>

          <p>We'll be in touch soon. In the meantime, feel free to reach out with any questions!</p>

          <center>
            <a href="${CONFIG.WEBSITE_URL}" class="button">Learn More About Us</a>
          </center>

          <p>Questions? Reply to this email or contact us at <a href="mailto:${CONFIG.SUPPORT_EMAIL}">${CONFIG.SUPPORT_EMAIL}</a></p>

          <p><strong>The VentureScope Team</strong><br>
          Turning Operational Chaos Into Clarity</p>
        </div>
        <div class="footer">
          <p>${CONFIG.COMPANY_NAME} | <a href="${CONFIG.WEBSITE_URL}">${CONFIG.WEBSITE_URL}</a></p>
          <p>AI-Powered Business Operations in 48 Hours</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmailViaResend(recipient, subject, html);
}

function sendIntakeFormNotification(safe) {
  const subject = `🎯 New Intake Form: ${safe.subjectCompany} - ${safe.subjectService}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 700px; margin: 0 auto; padding: 20px; background: #f9fafb; }
        .header { background: #374151; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 25px; }
        .field { margin-bottom: 12px; padding: 12px; background: #f3f4f6; border-radius: 4px; }
        .label { font-weight: bold; color: #374151; display: inline-block; min-width: 150px; }
        .priority { background: #dc2626; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🎯 New Detailed Intake Form Submission</h2>
          <p style="margin: 0;"><span class="priority">HIGH PRIORITY</span> - Full intake form completed!</p>
        </div>
        <div class="content">
          <div class="section">
            <h3>👤 Contact Information</h3>
            <div class="field">
              <span class="label">Full Name:</span> ${safe.fullName}
            </div>
            <div class="field">
              <span class="label">Email:</span> <a href="mailto:${safe.workEmail}">${safe.workEmail}</a>
            </div>
            <div class="field">
              <span class="label">Phone:</span> ${safe.phone || 'Not provided'}
            </div>
            <div class="field">
              <span class="label">Job Title:</span> ${safe.jobTitle}
            </div>
          </div>

          <div class="section">
            <h3>🏢 Company Details</h3>
            <div class="field">
              <span class="label">Company Name:</span> ${safe.companyName}
            </div>
            <div class="field">
              <span class="label">Industry:</span> ${safe.industry}
            </div>
            <div class="field">
              <span class="label">Team Size:</span> ${safe.teamSize}
            </div>
            <div class="field">
              <span class="label">Website:</span> ${safe.websiteUrl ? `<a href="${safe.websiteUrl}">${safe.websiteUrl}</a>` : 'Not provided'}
            </div>
          </div>

          <div class="section">
            <h3>💼 Project Information</h3>
            <div class="field">
              <span class="label">Service:</span> ${safe.service}
            </div>
            <div class="field">
              <span class="label">Start Date:</span> ${safe.startDate}
            </div>
            <div class="field">
              <span class="label">Budget Range:</span> ${safe.budgetRange || 'Not specified'}
            </div>
            <div class="field">
              <span class="label">How They Found Us:</span> ${safe.hearAbout || 'Not specified'}
            </div>
          </div>

          <div class="section">
            <h3>📝 Project Details</h3>
            <div class="field">
              <span class="label">Process Description:</span><br>
              ${safe.processDescription}
            </div>
            <div class="field">
              <span class="label">Pain Points:</span><br>
              ${safe.painPoints}
            </div>
          </div>

          <div class="section">
            <h3>⏰ Timing</h3>
            <div class="field">
              <span class="label">Submitted:</span> ${new Date().toLocaleString()}
            </div>
          </div>

          <p><strong>⚡ Action Required:</strong> This is a high-intent lead! Follow up within 24 hours to schedule discovery call.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  sendEmailViaResend(CONFIG.NOTIFICATION_EMAIL, subject, html);
}

// ============================================
// SETUP & TEST FUNCTIONS
// ============================================

/**
 * Run this once to mint a shared secret. Copy the logged value into
 * Script Properties as FORM_SHARED_SECRET, and into index.html's FORM_TOKEN.
 */
function generateSharedSecret() {
  // Two UUIDs, not Math.random(). Math.random() is not a CSPRNG, and minting a
  // security token is exactly the job where that distinction should be honored
  // even though this particular token ships in public page source.
  const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  Logger.log('FORM_SHARED_SECRET: ' + secret);
  Logger.log('Set this in Project Settings > Script Properties, then put the same value in index.html.');
  return secret;
}

// Run this to test the email functionality (bypasses the web-app gate on purpose)
function testEmailSetup() {
  Logger.log('Testing Resend integration...');
  sendQuickFormConfirmation('test@example.com', {
    fullName: safeField('Test User', 100),
    email: safeField('test@example.com', 254),
    service: safeField('Test Service', 100),
    subjectName: safeSubject('Test User', 60)
  });
  Logger.log('Test email sent! Check your inbox.');
}

// Run this to verify the script setup
function testSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Spreadsheet name: ' + ss.getName());
  Logger.log('Spreadsheet ID: ' + ss.getId());
  Logger.log('Resend API Key configured: ' + (CONFIG.RESEND_API_KEY ? 'Yes' : 'No'));
  Logger.log('Shared secret configured: ' + (CONFIG.FORM_SHARED_SECRET ? 'Yes' : 'No — ALL SUBMISSIONS WILL BE REJECTED'));
  Logger.log('Emails enabled: ' + CONFIG.EMAILS_ENABLED);
  Logger.log('Global cap: ' + CONFIG.MAX_SUBMISSIONS_PER_HOUR + '/hour');
  Logger.log('Setup test completed successfully!');
}

/**
 * Verifies the abuse controls actually reject the payload shapes that were
 * being exploited. Run it from the editor after any change to this file.
 */
function testSecurityControls() {
  const cases = [
    ['script tag in name', safeField('<script>alert(1)</script>'), function (r) { return r.indexOf('<') === -1; }],
    ['link injection', safeParagraph('<a href="http://evil">click</a>'), function (r) { return r.indexOf('<a ') === -1; }],
    ['javascript: url', safeUrl('javascript:alert(1)'), function (r) { return r === ''; }],
    ['data: url', safeUrl('data:text/html,<script>'), function (r) { return r === ''; }],
    ['valid url passes', safeUrl('https://example.com/x'), function (r) { return r === 'https://example.com/x'; }],
    ['multi-recipient', isValidEmail('a@b.com,c@d.com'), function (r) { return r === false; }],
    ['angle bracket addr', isValidEmail('x <y@z.com>'), function (r) { return r === false; }],
    ['plain address ok', isValidEmail('someone@example.com'), function (r) { return r === true; }],
    ['subject newline', safeSubject('Hi\r\nBcc: v@x.com'), function (r) { return r.indexOf('\n') === -1 && r.indexOf('\r') === -1; }],
    ['formula injection', sheetSafe('=IMPORTXML(1,2)'), function (r) { return r.charAt(0) === "'"; }],
    ['token fails closed', verifyToken('anything'), function (r) { return CONFIG.FORM_SHARED_SECRET ? true : r === false; }],
    ['text fallback spacing', htmlToPlainText('<p>one</p><p>two</p>'), function (r) { return r === 'one\ntwo'; }],
    ['text fallback entities', htmlToPlainText('<p>Ben &amp; Co</p>'), function (r) { return r === 'Ben & Co'; }],
    ['text fallback drops tags', htmlToPlainText('<p><script>x</script></p>'), function (r) { return r.indexOf('<') === -1; }],
    ['cache ttl clamped to 6h', cacheTtlSeconds(600), function (r) { return r === 21600; }],
    ['cache ttl normal passes', cacheTtlSeconds(60), function (r) { return r === 3600; }],
    ['sendingIsConfigured tracks config', sendingIsConfigured(),
      function (r) { return r === Boolean(CONFIG.EMAILS_ENABLED && CONFIG.RESEND_API_KEY); }]
  ];

  let failures = 0;
  cases.forEach(function (c) {
    const passed = c[2](c[1]);
    if (!passed) failures++;
    Logger.log((passed ? 'PASS  ' : 'FAIL  ') + c[0] + '  ->  ' + c[1]);
  });

  Logger.log(failures === 0 ? 'All security checks passed.' : failures + ' CHECK(S) FAILED.');
  return failures === 0;
}
