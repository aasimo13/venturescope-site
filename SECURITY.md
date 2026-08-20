# Security

## Reporting a vulnerability

Email `hello@venturescope.systems` with details. Please don't open a public issue
for anything exploitable.

## Known incident: open email relay (resolved)

An earlier revision of `google-apps-script-with-resend.js` deployed a Google Apps
Script web app that accepted **unauthenticated** POSTs and then sent HTML email
through the site's Resend account. The caller supplied both the recipient address
and the message content, and neither was validated or escaped. Anyone who learned
the `/exec` URL could send arbitrary email as VentureScope Systems.

It was used to send phishing.

### What was wrong

| Problem | Where |
|---|---|
| Web app deployed with access "Anyone", no token check | `doPost` |
| Caller chose the `to:` address | `sendEmailViaResend(data.email, …)` |
| Caller's text interpolated raw into the HTML body and the subject | all four templates |
| `data.website` interpolated raw into an `href` | intake notification |
| No rate limit, honeypot, or payload size cap | everywhere |
| Untrusted values written straight into Google Sheets cells | both sheet handlers |

### How it is fixed

`google-apps-script-with-resend.js` now applies six layers, in this order:

1. **Payload cap** — bodies over `MAX_PAYLOAD_BYTES` are rejected before parsing.
2. **Honeypot** — a hidden `hp_company_url` field; any non-empty value is dropped
   with a fake success response so bots don't retry.
3. **Shared-secret token** — `verifyToken()` compares `data.token` against the
   `FORM_SHARED_SECRET` script property in constant time. **It fails closed**: if
   the property is unset, every submission is rejected.
4. **Recipient validation** — `isValidEmail()` rejects whitespace, commas,
   semicolons, colons, angle brackets, and quotes, so one field can never expand
   into multiple recipients or a display-name header.
5. **Rate limiting** — `checkRateLimits()` enforces a global hourly cap plus a
   per-recipient cooldown, serialized under a `LockService` script lock so
   concurrent requests can't race the counter. Addresses are SHA-256 hashed
   before being used as cache keys.
6. **Output escaping** — every caller-supplied value passes through
   `safeField`, `safeParagraph`, `safeSubject`, or `safeUrl` before it reaches a
   template. `safeUrl` accepts only absolute `http(s)` URLs, so `javascript:` and
   `data:` payloads can't reach an `href`. `sheetSafe` prefixes `=`, `+`, `-`,
   and `@` with an apostrophe to neutralize spreadsheet formula injection.

`sendEmailViaResend()` re-validates the recipient as a last line of defense, and
honors `CONFIG.EMAILS_ENABLED` as a kill switch that stops all sending without
touching the website.

Run `testSecurityControls()` from the Apps Script editor after any change to that
file. It asserts that script tags, link injection, `javascript:`/`data:` URLs,
multi-recipient addresses, subject-line newlines, and formula injection are all
rejected.

### The token is not a real secret

`FORM_TOKEN` ships inside a public web page. Anyone who reads the source can
extract it. It exists to stop drive-by and replayed automated abuse, which is
most of it in practice.

The controls that hold against someone who reads your page source are the **rate
limits** and the **escaping** — they bound both the volume and the value of any
abuse. Treat the token as a filter, not a wall. Rotate it (regenerate the script
property and update the page) if you see it being used.

## Operational rules

- **Never commit an API key.** `RESEND_API_KEY` and `FORM_SHARED_SECRET` live in
  Apps Script → Project Settings → Script Properties. This repository is public;
  scraper bots harvest keys from GitHub's public event feed within seconds of a
  push, and revoking later does not undo the harvest.
- **Verify your own sending domain in Resend.** `FROM_EMAIL` currently defaults
  to `onboarding@resend.dev`, Resend's shared test domain. Sending real mail from
  it puts your traffic on a reputation you share with every other account, and
  makes any abuse of yours everyone else's problem too. Use it for testing only.
- **Keep the caps low.** `MAX_SUBMISSIONS_PER_HOUR` should be a small multiple of
  your genuine peak, not a generous ceiling. A cap that never fires legitimately
  is a cap that's too high to help.

## If it happens again

1. **Stop the sending.** Set `CONFIG.EMAILS_ENABLED = false` and save, or archive
   the deployment entirely: Apps Script → Deploy → Manage deployments → Archive.
   Do this before anything else; diagnosis can wait, sending can't.
2. **Revoke every Resend API key** and issue a new one.
3. **Rotate `FORM_SHARED_SECRET`** and update the page.
4. **Work out the entry point.** Cross-reference Resend → Logs against the Google
   Sheet. A spam send *with* a matching sheet row came through this endpoint. A
   send with *no* matching row means the API key itself is compromised and the
   attacker is calling `api.resend.com` directly — in that case the endpoint
   isn't the problem and disabling it won't stop anything.
5. **Tell Resend before they find it.** Self-reported abuse is treated very
   differently from discovered abuse.
6. **Preserve the evidence.** Don't clear the sheet or the Apps Script execution
   log — they are the only record of what was sent and to whom.
