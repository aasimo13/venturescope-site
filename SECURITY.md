# Security

## Reporting a vulnerability

Email `hello@venturescope.systems` with details. Please don't open a public issue
for anything exploitable.

## Threat model

`google-apps-script-with-resend.js` and `google-apps-script.js` are deployed as
Google Apps Script web apps with access set to "Anyone" — unavoidable for a
public contact form, since visitors have no Google session to authenticate with.
That makes the `/exec` URL a public, unauthenticated HTTP endpoint that writes to
a spreadsheet and, in the Resend version, sends email.

Two things follow, and both drive the design:

- **A public form that sends confirmation email is an email relay** unless
  something stops it. If a caller can choose the recipient and the content, they
  can send whatever they like to whoever they like, from your domain and on your
  sending reputation.
- **Every value in the request is attacker-controlled.** Not just the obvious
  ones — every field, every time, including on the paths that only ever reach
  your own inbox or your own spreadsheet.

## Controls

Six layers, numbered in the order `doPost` applies them:

1. **Payload cap** — bodies over `MAX_PAYLOAD_CHARS` are rejected before parsing.
   A processing cap, not a bandwidth one: Apps Script has already buffered the
   body by the time it runs.
2. **Honeypot** — a hidden `hp_field_b7` field; any non-empty value is dropped
   with a fake success response so bots don't retry. Its name and label are
   deliberately meaningless: a hidden field called "Company URL" is a plausible
   target for password managers and form-fill extensions, and a false positive
   there silently discards a real lead — the visitor sees success and nothing is
   ever recorded. If sheet rows ever fall noticeably short of form opens, this is
   the first thing to suspect.
3. **Shared-secret token** — `verifyToken()` compares SHA-256 digests of the
   caller's token and the `FORM_SHARED_SECRET` script property. Digests are a
   fixed 32 bytes, so there is no length check to short-circuit on and the
   comparison leaks neither the token nor its length through timing. **It fails
   closed**: if the property is unset, every submission is rejected.
4. **Recipient validation** — `isValidEmail()` rejects whitespace, commas,
   semicolons, colons, angle brackets, and quotes, so one field can never expand
   into multiple recipients or a display-name header.
5. **Rate limiting** — `checkRateLimits()` enforces a global hourly cap plus a
   per-recipient cooldown, serialized under a `LockService` script lock so
   concurrent requests can't race the counter. Addresses are SHA-256 hashed
   before being used as cache keys, and the cooldown is keyed on form type as
   well, so someone who sends the quick form and later completes the full intake
   isn't silently blocked on the second — each form stays bounded to one message
   per address per window, which is the property that matters.
   Cooldowns above 6 hours are clamped: `CacheService` rejects a longer TTL, and
   an unclamped value would throw inside the limiter, reach `doPost`'s outer
   catch, and reject *every* submission with a generic "Submission failed".
6. **Output escaping** — every caller-supplied value passes through
   `safeField`, `safeParagraph`, `safeSubject`, or `safeUrl` before it reaches a
   template. `safeUrl` accepts only absolute `http(s)` URLs, so `javascript:` and
   `data:` payloads can't reach an `href`. `sheetSafe` prefixes `=`, `+`, `-`,
   and `@` with an apostrophe to neutralize spreadsheet formula injection.

`sendEmailViaResend()` re-validates the recipient as a last line of defense, and
honors `CONFIG.EMAILS_ENABLED` as a kill switch that stops all sending without
touching the website.

Submissions are written to the sheet **before** any email is attempted, so there
is a record either way.

## Testing the controls

Two layers, both required before any deploy of either handler:

```sh
node test-security-controls.js     # runs anywhere, no dependencies
```

The escaping and validation helpers are pure, so this stubs the few Apps Script
globals they touch — including enough of `Utilities` to exercise `verifyToken`'s
real digest comparison, not just its fail-closed short-circuit — and asserts that
script tags, attribute breaks, link injection, `javascript:` and `data:` URLs,
multi-recipient and display-name addresses, subject-line CRLF, and spreadsheet
formula injection are all rejected. It also asserts the two handlers' copies of
the shared helpers reject identical inputs, so the repo can't end up
hardened-except-for-one-file. Exits non-zero on failure, so it can gate CI.

What it does **not** prove: that those blocks are wired together correctly. The
order `doPost` applies them in — honeypot, then token, then validation, then rate
limiting — is not exercised anywhere in CI, because that path needs
`SpreadsheetApp` and `CacheService`. A green check means the parts work, not that
the endpoint is safe to deploy. Don't cite it as though it means the latter.

Then, in the Apps Script editor, run `testSecurityControls()` and `testSetup()`
and read the execution log. Those cover what node cannot: `PropertiesService`,
`CacheService`, `LockService`, `SpreadsheetApp` and the live Resend call. There is
no way to automate that part — if you skip it, nothing will tell you the rate
limiter or the token gate stopped working.

## The token is not a real secret

`FORM_TOKEN` ships inside a public web page. Anyone who reads the source can
extract it. It exists to stop drive-by and replayed automated abuse, which is
most of it in practice.

The controls that hold against someone who reads your page source are the **rate
limits** and the **escaping** — they bound both the volume and the value of any
abuse. Treat the token as a filter, not a wall. Rotate it (regenerate the script
property and update the page) if you see it being used.

## Residual risk we are accepting

Any public contact form that sends a confirmation can be used to mail a chosen
address something that address did not ask for. Ours is bounded — one message
per address per form per `RECIPIENT_COOLDOWN_MINUTES`, inside a global hourly
cap, with every caller-supplied value escaped and length-capped, sent from our
own configured `FROM_EMAIL`. It is not zero. Someone can still cause one
low-volume unsolicited confirmation per hour per address, carrying an
attacker-chosen name and service inside otherwise fixed template text.

Eliminating that entirely means dropping customer confirmations and notifying
only our own fixed address — `SEND_CONFIRMATION_EMAILS: false` does exactly
that, and is the right setting if the form is ever abused. We keep confirmations
on because they are a real part of the lead flow, and the bounded version is a
very long way from an unbounded one.

## Operational rules

- **Never commit an API key.** `RESEND_API_KEY` and `FORM_SHARED_SECRET` live in
  Apps Script → Project Settings → Script Properties. This repository is public;
  scraper bots harvest keys from GitHub's public event feed within seconds of a
  push, and revoking later does not undo the harvest.
- **Scope API keys to one domain, and to sending only.** Resend keys can be
  restricted per domain and to send-only access. A full-access key means one
  leaked string reaches every domain on the account. This form handler needs to
  send from exactly one domain and needs to read nothing.
- **Keep unrelated domains on separate accounts.** Every domain verified on an
  account is reachable by any full-access key issued from it, so one leaked key
  burns the reputation of all of them at once.
- **Verify your own sending domain in Resend.** `FROM_EMAIL` defaults to
  `onboarding@resend.dev`, Resend's shared test domain. Sending real mail from it
  puts your traffic on a reputation you share with every other account, and makes
  any abuse of yours everyone else's problem too. Use it for testing only —
  `testSetup()` flags the default while it is still in place, and that warning
  should be gone before any customer mail is sent.
- **Keep the caps low, then watch them.** `MAX_SUBMISSIONS_PER_HOUR` should be a
  small multiple of your genuine peak, not a generous ceiling — a cap that never
  fires legitimately is too high to help. But it is a **global** cap, not
  per-visitor: a burst of real traffic (a launch, a newsletter, a post that does
  well) can consume it and lock out genuine leads for the rest of the hour. Raise
  it deliberately before anything that drives traffic, and check the Apps Script
  execution log afterwards for rate-limit rejections you didn't want.
- **The global cap is the actual abuse ceiling, not the per-recipient one.** Apps
  Script gives the handler no client IP, so there is nothing to rate limit per
  source. The per-recipient cooldown is keyed on a caller-supplied address, which
  an attacker simply varies. Set `MAX_SUBMISSIONS_PER_HOUR` as if it were the
  only limit, because against a determined caller it is.
- **The hourly cap uses fixed buckets, not a sliding window.** The counter keys
  on `floor(now / 1 hour)`, so a burst straddling a boundary can pass up to
  roughly twice `MAX_SUBMISSIONS_PER_HOUR` in a short span. A sliding window isn't
  worth the complexity here — just size the cap knowing its real short-run ceiling
  is about double the number you set.
- **The rate limiter is best-effort, not a guarantee.** It is built on
  `CacheService`, which Apps Script may evict early under memory pressure. An
  evicted counter means a window resets sooner than intended. That is acceptable
  here — the token gate and the escaping don't depend on it — but don't treat the
  cap as a hard ceiling.

## If you suspect the endpoint or the sending account is being abused

1. **Stop the sending.** Set `CONFIG.EMAILS_ENABLED = false` and save, or archive
   the deployment entirely: Apps Script → Deploy → Manage deployments → Archive.
   Do this before anything else; diagnosis can wait, sending can't.
2. **Revoke every API key** and issue a new one.
3. **Rotate `FORM_SHARED_SECRET`** and update the page.
4. **Work out the entry point — check the `from` address first.** It is the
   fastest discriminator. These handlers always set `from` from
   `CONFIG.FROM_EMAIL`, so **any send with a `from` you did not configure did not
   come through this endpoint.** That means a stolen API key, and disabling the
   endpoint will not stop it. Confirm by cross-referencing the Resend logs against
   the Google Sheet: a send through this endpoint always leaves a matching sheet
   row, because the sheet is written before the email goes out.
5. **On a stolen key, treat it as full account compromise.** A full-access key can
   enumerate your verified domains and send from any of them, and can also add new
   ones, mint further keys, and read stored data. Audit, in this order:
   **Audiences/Contacts** (were any stored lists readable, and do the targeted
   addresses match them?), **Domains** (remove any you did not add; expect a
   stolen key to have used one you already had), **API keys** (delete all, mint
   one), **team members and pending invites**, **webhooks**. Then change the
   account password and enable 2FA.
   The Audiences check comes first because it decides whether the event is also a
   personal-data breach rather than only an abuse-of-sending incident — if the
   recipients came from stored contacts, the reporting obligations differ.
6. **Export the provider's logs before anything else.** On a stolen-key
   compromise the recipient list exists *only* there — nothing reaches the Google
   Sheet. If the account is suspended you may lose access to the record of who
   was targeted.
7. **Tell the provider before they find it.** Self-reported abuse is treated very
   differently from discovered abuse.
8. **Preserve the evidence.** Don't clear the sheet or the Apps Script execution
   log — they are the only record of what this endpoint sent, and to whom.
