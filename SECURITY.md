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

### Was it used to send the phishing? No — and that matters

Phishing *was* sent through this project's Resend account (a "TV Licence
expiring" lure). A captured payload shows it did **not** come through this
endpoint:

```
from: "TVLicensing.co.uk Support Centre" <…@homeforge.family>
```

Neither the old handler nor the new one lets a caller choose the `from` address —
both build it from `CONFIG.FROM_EMAIL`, which was `onboarding@resend.dev`. A
caller-controlled sender is impossible through this endpoint.

`homeforge.family` is **our own domain**, already verified on the Resend account.
So nothing had to be added: a stolen API key with access to that domain was
sufficient to send from it, using any local part the attacker chose
(`tvlicensing-customersupport-…@`). Resend verifies domains, not addresses.

The consequences are ours to wear: our own domain's SPF and DKIM authenticated
that phishing, so its sending reputation is what took the damage. Closing this
endpoint does not address any of it. See the runbook at the bottom.

The relay described below was nonetheless real, reachable, and exploitable. It
is fixed here on its own merits — not because it was the vector.

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

1. **Payload cap** — bodies over `MAX_PAYLOAD_CHARS` are rejected before parsing.
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

### Testing the controls

Two layers, both required before any deploy of the handler:

```sh
node test-security-controls.js     # runs anywhere, no dependencies
```

The escaping and validation helpers are pure, so this stubs the few Apps Script
globals they touch at load time and asserts the exploit shapes from the incident
are rejected — script tags, attribute breaks, link injection, `javascript:` and
`data:` URLs, multi-recipient and display-name addresses, subject-line CRLF, and
spreadsheet formula injection. It exits non-zero on failure, so it can gate CI.

Then, in the Apps Script editor, run `testSecurityControls()` and `testSetup()`
and read the execution log. Those cover what node cannot: `PropertiesService`,
`CacheService`, `LockService`, `SpreadsheetApp` and the live Resend call. There is
no way to automate that part — if you skip it, nothing will tell you the rate
limiter or the token gate stopped working.

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
- **Scope API keys to one domain, and to sending only.** Resend keys can be
  restricted per domain and to send-only access. A full-access key is what let
  one leaked string reach every domain on the account. This form handler needs
  to send from exactly one domain and needs to read nothing.
- **Keep unrelated domains on separate accounts.** Every domain verified on an
  account is reachable by any full-access key issued from it, so one leaked key
  burns the reputation of all of them at once.
- **Keep the caps low, then watch them.** `MAX_SUBMISSIONS_PER_HOUR` should be a
  small multiple of your genuine peak, not a generous ceiling — a cap that never
  fires legitimately is too high to help. But it is a **global** cap, not
  per-visitor: a burst of real traffic (a launch, a newsletter, a post that does
  well) can consume it and lock out genuine leads for the rest of the hour. Raise
  it deliberately before anything that drives traffic, and check the Apps Script
  execution log afterwards for rate-limit rejections you didn't want.
- **The rate limiter is best-effort, not a guarantee.** It is built on
  `CacheService`, which Apps Script may evict early under memory pressure. An
  evicted counter means a window resets sooner than intended. That is acceptable
  for this threat model — the token gate and the escaping don't depend on it —
  but don't treat the cap as a hard ceiling.

## If it happens again

1. **Stop the sending.** Set `CONFIG.EMAILS_ENABLED = false` and save, or archive
   the deployment entirely: Apps Script → Deploy → Manage deployments → Archive.
   Do this before anything else; diagnosis can wait, sending can't.
2. **Revoke every Resend API key** and issue a new one.
3. **Rotate `FORM_SHARED_SECRET`** and update the page.
4. **Work out the entry point — check the `from` address first.** It is the
   fastest discriminator. This handler always sets `from` from
   `CONFIG.FROM_EMAIL`, so **any send with a `from` you did not configure did
   not come through this endpoint.** That means a stolen API key, and disabling
   the endpoint will not stop it. Confirm by cross-referencing Resend → Logs
   against the Google Sheet: a send through this endpoint always leaves a
   matching sheet row, because the sheet is written before the email goes out.
5. **On a stolen key, treat it as full account compromise.** A full-access key
   can enumerate your verified domains and send from any of them, and can also
   add new ones, mint further keys, and read stored data. Audit, in this order:
   **Audiences/Contacts** (were any stored lists readable, and do the targeted
   addresses match them?), **Domains** (remove any you did not add; expect the
   attacker to have used one you already had), **API keys** (delete all, mint
   one), **team members and pending invites**, **webhooks**. Then change the
   account password and enable 2FA.
   The Audiences check comes first because it is the one that decides whether
   this is also a personal-data breach rather than only an abuse-of-sending
   incident — if the recipients came from your stored contacts, the reporting
   obligations are different.
6. **Export the Resend logs before anything else.** On a stolen-key compromise
   the recipient list exists *only* there — nothing reached the Google Sheet.
   If Resend suspends the account you may lose access to the record of who was
   targeted.
7. **Tell Resend before they find it.** Self-reported abuse is treated very
   differently from discovered abuse.
8. **Preserve the evidence.** Don't clear the sheet or the Apps Script execution
   log — they are the only record of what was sent and to whom.
