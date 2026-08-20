#!/usr/bin/env node
/**
 * Runs the abuse-control helpers from google-apps-script-with-resend.js against
 * the exploit shapes from the August 2026 incident.
 *
 *     node test-security-controls.js
 *
 * No dependencies, no build step. The helpers are pure, so they run here once
 * the handful of Apps Script globals they touch are stubbed — including enough
 * of Utilities to exercise verifyToken's real digest comparison, not just its
 * fail-closed short-circuit.
 *
 * Covered here: output escaping, URL and address validation, subject
 * flattening, formula-injection guarding, the plain-text fallback, and the
 * token gate in both its unconfigured and configured states.
 *
 * NOT covered here, because Apps Script's runtime cannot be simulated: the
 * rate limiter (CacheService/LockService, including eviction behavior), the
 * Sheets writes, and the live Resend call. Those need testSecurityControls()
 * and testSetup() run from the Apps Script editor before every deploy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOGGER = { log: () => {} };

/**
 * Enough of the Apps Script Utilities service to exercise verifyToken's real
 * comparison path. computeDigest returns *signed* bytes in Apps Script, so
 * match that — verifyToken XORs the two arrays and a sign mismatch would make
 * a passing test out of a broken compare.
 */
const UTILITIES = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest(algorithm, value) {
    const digest = crypto.createHash('sha256').update(String(value), 'utf8').digest();
    return Array.from(digest).map((b) => (b > 127 ? b - 256 : b));
  },
  getUuid: () => crypto.randomUUID(),
  base64EncodeWebSafe: (bytes) =>
    Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64url')
};

/**
 * @param {string} filename       script to load
 * @param {?string} sharedSecret  value FORM_SHARED_SECRET reads back as; pass
 *                                null to exercise the unconfigured/fail-closed
 *                                state.
 */
function loadScript(filename, sharedSecret) {
  const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  const properties = {
    getScriptProperties: () => ({
      getProperty: (key) => (key === 'FORM_SHARED_SECRET' ? sharedSecret || null : null)
    })
  };
  // Each script declares its own top-level CONFIG, so give them separate
  // scopes rather than letting the second redeclare the first.
  return new Function(
    'PropertiesService', 'Logger', 'Utilities',
    source + '\nreturn { verifyToken, isValidEmail, plainText, sheetSafe' +
    (filename.includes('resend')
      ? ', safeField, safeParagraph, safeSubject, safeUrl, htmlToPlainText,' +
        ' sendingIsConfigured, cacheTtlSeconds, recipientCacheKey,' +
        ' isSharedTestDomain, CONFIG'
      : ', cacheTtlSeconds, submitterCacheKey') +
    ' };'
  )(properties, LOGGER, UTILITIES);
}

const SECRET = 'a-test-shared-secret-value';

const resend = loadScript('google-apps-script-with-resend.js', null);
const legacy = loadScript('google-apps-script.js', null);
const resendConfigured = loadScript('google-apps-script-with-resend.js', SECRET);
const legacyConfigured = loadScript('google-apps-script.js', SECRET);

const {
  safeField, safeParagraph, safeSubject, safeUrl,
  isValidEmail, sheetSafe, verifyToken, htmlToPlainText
} = resend;

const cases = [
  // Output escaping — the layer that made arbitrary content possible.
  ['script tag escaped', safeField('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['attribute break escaped', safeField('" onload="evil()'),
    '&quot; onload=&quot;evil()'],
  ['link injection blocked', safeParagraph('<a href="http://evil">click</a>').includes('<a '),
    false],
  ['newlines survive as br', safeParagraph('one\ntwo'), 'one<br>two'],

  // URL handling — these reach an href in the notification template.
  ['javascript: url rejected', safeUrl('javascript:alert(1)'), ''],
  ['data: url rejected', safeUrl('data:text/html,<script>'), ''],
  ['protocol-relative rejected', safeUrl('//evil.example.com'), ''],
  ['quote break rejected', safeUrl('https://a.com" onmouseover="x'), ''],
  ['plain https accepted', safeUrl('https://example.com/x'), 'https://example.com/x'],

  // Recipient validation — one address, never several.
  ['plain address accepted', isValidEmail('someone@example.com'), true],
  ['comma list rejected', isValidEmail('a@b.com,c@d.com'), false],
  ['semicolon list rejected', isValidEmail('a@b.com;c@d.com'), false],
  ['display name rejected', isValidEmail('x <y@z.com>'), false],
  ['whitespace rejected', isValidEmail('a b@c.com'), false],
  ['no tld rejected', isValidEmail('a@b'), false],
  ['empty rejected', isValidEmail(''), false],
  ['overlong rejected', isValidEmail('a'.repeat(250) + '@b.com'), false],

  // Subject lines — no header splitting.
  ['subject crlf flattened', safeSubject('Hi\r\nBcc: v@x.com'), 'Hi Bcc: v@x.com'],
  ['subject truncated', safeSubject('x'.repeat(200)).length <= 80, true],

  // Spreadsheet formula injection.
  ['equals prefixed', sheetSafe('=IMPORTXML(1,2)'), "'=IMPORTXML(1,2)"],
  ['plus prefixed', sheetSafe('+1+1'), "'+1+1"],
  ['at prefixed', sheetSafe('@SUM(A1)'), "'@SUM(A1)"],
  ['ordinary text untouched', sheetSafe('Acme Ltd'), 'Acme Ltd'],

  // Token gate, unconfigured — must reject everything.
  ['token fails closed', verifyToken('anything'), false],
  ['empty token fails closed', verifyToken(''), false],
  ['null token fails closed', verifyToken(null), false],

  // Token gate, configured — exercises the digest comparison itself, which
  // the fail-closed cases above short-circuit before ever reaching.
  ['correct token accepted', resendConfigured.verifyToken(SECRET), true],
  ['wrong token rejected', resendConfigured.verifyToken('not-the-secret'), false],
  ['same-length near-miss rejected',
    resendConfigured.verifyToken(SECRET.slice(0, -1) + 'X'), false],
  ['prefix rejected', resendConfigured.verifyToken(SECRET.slice(0, 10)), false],
  ['secret plus suffix rejected', resendConfigured.verifyToken(SECRET + 'x'), false],
  ['empty rejected when configured', resendConfigured.verifyToken(''), false],
  ['null rejected when configured', resendConfigured.verifyToken(null), false],

  // Plain-text fallback.
  ['block spacing preserved', htmlToPlainText('<p>one</p><p>two</p>'), 'one\ntwo'],
  ['entities decoded', htmlToPlainText('<p>Ben &amp; Co</p>'), 'Ben & Co'],
  ['no double decode', htmlToPlainText('<p>a &amp;lt; b</p>'), 'a &lt; b'],
  ['tags stripped', htmlToPlainText('<p><em>x</em>y</p>'), 'x y'],
];

// The sheets-only script carries its own copies of the shared helpers. They
// must reject exactly the same things — a divergence there is how a hardened
// repo ends up with one vulnerable script still in it.
for (const [name, fn, arg, want] of [
  ['legacy: formula injection', 'sheetSafe', '=IMPORTXML(1,2)', "'=IMPORTXML(1,2)"],
  ['legacy: at prefixed', 'sheetSafe', '@SUM(A1)', "'@SUM(A1)"],
  ['legacy: ordinary text', 'sheetSafe', 'Acme Ltd', 'Acme Ltd'],
  ['legacy: multi recipient', 'isValidEmail', 'a@b.com,c@d.com', false],
  ['legacy: display name', 'isValidEmail', 'x <y@z.com>', false],
  ['legacy: plain address', 'isValidEmail', 'someone@example.com', true],
  ['legacy: token fails closed', 'verifyToken', 'anything', false],
]) {
  cases.push([name, legacy[fn](arg), want]);
}

cases.push(
  ['legacy: correct token accepted', legacyConfigured.verifyToken(SECRET), true],
  ['legacy: wrong token rejected', legacyConfigured.verifyToken('not-the-secret'), false],
  ['legacy: same-length near-miss rejected',
    legacyConfigured.verifyToken(SECRET.slice(0, -1) + 'X'), false]
);

// FROM_EMAIL defaulting to Resend's shared onboarding domain is a deliverability
// and reputation problem independent of the security fix; testSetup() flags it.
cases.push(
  ['shared domain: default flagged', resend.isSharedTestDomain('onboarding@resend.dev'), true],
  ['shared domain: any local part flagged', resend.isSharedTestDomain('x@resend.dev'), true],
  ['shared domain: case insensitive', resend.isSharedTestDomain('X@ReSeNd.DeV'), true],
  ['shared domain: own domain passes', resend.isSharedTestDomain('hello@venturescope.systems'), false],
  ['shared domain: lookalike passes', resend.isSharedTestDomain('a@notresend.dev.example.com'), false],
  ['shared domain: empty passes', resend.isSharedTestDomain(''), false],
);

// CacheService rejects a TTL over 6 hours. An unclamped config value would
// throw inside the limiter and reject every submission with a generic error.
cases.push(
  ['ttl: normal value passes', resend.cacheTtlSeconds(60), 3600],
  ['ttl: clamped at 6h ceiling', resend.cacheTtlSeconds(600), 21600],
  ['ttl: exactly at ceiling', resend.cacheTtlSeconds(360), 21600],
  ['ttl: never below 1s', resend.cacheTtlSeconds(0), 1],
  ['ttl: legacy clamps identically', legacy.cacheTtlSeconds(600), 21600],
);

// The cooldown key includes form type, so a quick-form submitter isn't blocked
// when they come back to complete the full intake.
cases.push(
  ['cooldown key differs per form',
    resend.recipientCacheKey('a@b.com', 'quick') !== resend.recipientCacheKey('a@b.com', 'intake'),
    true],
  ['cooldown key stable per form',
    resend.recipientCacheKey('a@b.com', 'quick') === resend.recipientCacheKey('a@b.com', 'quick'),
    true],
  ['cooldown key differs per address',
    resend.recipientCacheKey('a@b.com', 'quick') !== resend.recipientCacheKey('c@d.com', 'quick'),
    true],
  ['cooldown key does not contain the address',
    resend.recipientCacheKey('a@b.com', 'quick').includes('a@b.com'),
    false],
);

// A failed send refunds the per-recipient cooldown, but only when a send was
// genuinely attempted. With the kill switch off, or no API key, every send
// "fails" — refunding on those would strip the throttle at exactly the moment
// the kill switch is flipped.
for (const [name, emailsEnabled, apiKey, want] of [
  ['refund predicate: enabled + key', true, 're_test', true],
  ['refund predicate: kill switch off', false, 're_test', false],
  ['refund predicate: no api key', true, null, false],
  ['refund predicate: off and unconfigured', false, null, false],
]) {
  resend.CONFIG.EMAILS_ENABLED = emailsEnabled;
  resend.CONFIG.RESEND_API_KEY = apiKey;
  cases.push([name, resend.sendingIsConfigured(), want]);
}

let failed = 0;
for (const [name, got, want] of cases) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
    (ok ? '' : `\n        expected ${JSON.stringify(want)}\n        got      ${JSON.stringify(got)}`)
  );
}

console.log(
  failed === 0
    ? `\n${cases.length} checks passed.`
    : `\n${failed} of ${cases.length} checks FAILED.`
);
process.exit(failed === 0 ? 0 : 1);
