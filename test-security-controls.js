#!/usr/bin/env node
/**
 * Runs the abuse-control helpers from google-apps-script-with-resend.js against
 * the exploit shapes from the August 2026 incident.
 *
 *     node test-security-controls.js
 *
 * No dependencies, no build step. The helpers are pure, so they run here once
 * the handful of Apps Script globals they touch at load time are stubbed. This
 * covers the escaping and validation layers only — anything touching
 * PropertiesService, CacheService, LockService, SpreadsheetApp or UrlFetchApp
 * still needs testSecurityControls() run from the Apps Script editor.
 */

const fs = require('fs');
const path = require('path');

global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Logger = { log: () => {} };

function loadScript(filename) {
  const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  // Each script declares its own top-level CONFIG, so give them separate
  // scopes rather than letting the second redeclare the first.
  return new Function(
    'PropertiesService', 'Logger',
    source + '\nreturn { verifyToken, isValidEmail, plainText, sheetSafe' +
    (filename.includes('resend')
      ? ', safeField, safeParagraph, safeSubject, safeUrl, htmlToPlainText'
      : '') +
    ' };'
  )(global.PropertiesService, global.Logger);
}

const resend = loadScript('google-apps-script-with-resend.js');
const legacy = loadScript('google-apps-script.js');

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

  // Token gate — must reject when the secret is unset.
  ['token fails closed', verifyToken('anything'), false],
  ['empty token fails closed', verifyToken(''), false],
  ['null token fails closed', verifyToken(null), false],

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
