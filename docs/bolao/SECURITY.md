# Security — Bolão do Ferrari

## Context and threat model

This is an informal friends/family app deployed as a static site. There is no server-side auth and no payments are processed by the app.

**It does store personal data, and this document said otherwise until 2026-08-10.** Verified
against production on that date, every entry in `bolao_state` carries `participantEmail`,
`payerName` and `paymentMethod`. The anon key is public by construction — it ships in
`js/config.js` to every browser — so anyone able to read that row can enumerate the participants'
e-mail addresses. That is a real exposure, tracked as finding **F10**, and it is not remediated
yet. Do not read the rest of this document as saying the public state is empty of PII.

What is *not* stored: card numbers, bank credentials, or anything the app itself charges — money
changes hands outside the app (Zelle/Venmo/PIX), and only the payer's name and the method are
recorded.

The threat model is:

- **In scope:** XSS, accidental credential exposure, admin session hijacking, data tampering by a malicious participant.
- **Out of scope:** Server-side attacks (there is no server), DDoS, MITM (GitHub Pages uses HTTPS), legal liability (app is explicitly informal).

## Admin authentication

- `config.adminPasswordHash`: SHA-256 hex of the admin password.
- Plain password is **never** stored anywhere — not in source, HTML, comments, or localStorage.
- If `adminPasswordHash` is empty or missing, admin login is blocked entirely.
- Hash is computed via `crypto.subtle.digest("SHA-256", ...)` — no external library.
- **Lockout:** after `adminMaxAttempts` (5) wrong attempts, admin is blocked for `adminLockMinutes` (15) minutes via `sessionStorage["adminLockUntil"]` (Copa2026; BR2026/CDB2026 use their own app-prefixed key, e.g. `sessionStorage["br2026_loginLockUntil"]`). This only throttles guesses made *through the UI*. `adminPasswordHash` itself ships in the publicly-readable `config.js`, so it is always exposed to offline cracking (dictionary/rainbow table) regardless of the lockout — the lockout does not, and cannot, mitigate that. Accepted for this app's threat model (informal friends/family pool, no server available to hash server-side); noted explicitly here so the mitigation's actual scope isn't overstated.
- **Session:** stored in `sessionStorage["adminOk"]` + `sessionStorage["adminUntil"]`. Cleared automatically when the tab is closed. Expires after `adminSessionMinutes` (30 min) of inactivity.
- **`guardAdmin()`** is called on **every** admin action (not just on login), so a stale session cannot perform actions.
- Session extension: `extendAdmin()` is called on every successful admin render to slide the 30-min window.

To generate a new admin password hash:
```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("YourPassword"))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("")))
```

## Content Security Policy

Enforced via `<meta http-equiv="Content-Security-Policy">` in `index.html`:

```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net;
connect-src 'self' https://api.emailjs.com https://gamma-api.polymarket.com https://*.supabase.co https://v3.football.api-sports.io https://api.ipify.org;
img-src 'self' data:;
style-src 'self' 'unsafe-inline';
base-uri 'self';
frame-ancestors 'none';
```

- Inline scripts are blocked — all JS is in external files.
- `unsafe-inline` for styles is acceptable (no user-controlled styles).
- `frame-ancestors 'none'` prevents clickjacking.

## XSS prevention

- All user-supplied data passes through `escapeHtml(v)` before any DOM insertion.
- `escapeHtml` escapes `&`, `<`, `>`, `"`, `'`.
- No `innerHTML` with raw user data anywhere in `app.js`.
- No `eval()` or `new Function()`.
- No `document.write` — receipts use `Blob URL` + `window.open`.

## Supabase keys

- Only the **anon/public** key is in `config.js`. It is safe to commit.
- The **service_role** key bypasses RLS — it must **never** appear in browser code or this repo.
- All three apps (Copa, BR2026, CDB2026) share the same Supabase project and `bolao_state` table,
  distinguished only by row `id` (`main` / `br2026` / `cdb2026` — see `config.database.stateId`
  in each app). RLS policies restrict all operations to those three specific ids for the anon
  role — see `docs/bolao/DATABASE_SETUP_SUPABASE.md` "Múltiplos apps na mesma tabela" for the
  exact SQL. Until that SQL is run, BR2026/CDB2026 rows are rejected by RLS even with
  `database.enabled: true` in their config — the local-first fallback swallows the error
  silently, so this fails safe (no data loss, no crash) but also fails silently (no sync
  happens) until the policy is updated.
- Anyone with the site URL can read/write the bolão state. This is intentional — it is a transparent public pool.

## EmailJS

- Public key (`GBZFujsJBET6modve`) is visible in browser source — unavoidable for a browser-only app.
- Rate limiting: `limitRate: { throttle: 30000 }` — maximum one email per 30 seconds per browser session.
- Email content is the `receiptHtml()` output, which applies `escapeHtml` on all user data before building the HTML string.

## API-Football

- API key is **not set** by default (`apiKey: ""`). Feature is disabled (`enabled: false`).
- If a key is added, it will be visible in browser source (unavoidable for a static site).
- For production use, a Supabase Edge Function or other backend proxy should be used to avoid key exposure.

## Data exposure

- All entries (name, email, payment method) are visible to anyone who opens DevTools and reads localStorage.
- The ranking section shows entry names, payer names, and payment status publicly — this is by design.
- No passwords, credit card numbers, or financial details (beyond payment method name like "CashApp") are stored.

## Known limitations of static-site security

| Limitation | Severity | Mitigation |
|---|---|---|
| Admin password auth is client-side only | Low (informal app) | SHA-256 + lockout + session expiry |
| Cutoff date enforcement is client-side | Low (clock manipulation) | Honor system; admin can delete fraudulent entries |
| Supabase anon key is public, and `bolao_state` contains participant e-mail + payer name | **Open (F10)** | RLS limits access to a single row, but that row is anonymously readable and holds PII. Mitigation is a public/private split — designed, not yet applied. |
| EmailJS key is public | Accepted | Rate limiting; e-mails carry results and ranking, no payment credentials |
| API-Football key exposed if set | Medium | Keep disabled; use proxy for production |

## Receipts and evidence

Per the transparency disclaimer in `CONFIG.transparency.disclaimer`:
> Comprovantes individuais, master list e backups exportados pelo administrador servem como evidência operacional em caso de dúvidas, erro técnico ou contestação.

Receipts are the participant's responsibility to save. The admin should export a CSV backup after the cutoff closes.

## Commit-message PII prevention

**Forward-only control, added 2026-08-18.** During the HIST-091/HIST-093 git-history investigation
(real participant emails, payment references, and a participant name from the 2026-08-01–08-06
exposure window), the file/blob PII gate (`scripts/audit_pii_repo_wide.mjs`, running since
2026-08-12) was found to have a structural blind spot: it only ever scanned tracked file content,
never commit-message *bodies*. That was a deliberate, reasonable design choice at the time — it
avoided false positives from git's own author/committer email metadata — but it meant PII typed
directly into a commit message (a "recipients:" list, a "fix: wrong email was X, now Y" note, an
incident narrative) was invisible to every existing gate.

`scripts/audit_commit_message_pii.mjs` closes that gap. It reuses the exact same detection engine
as the file scanner (`scripts/pii_detectors.mjs` — same detectors, same reserved-domain/synthetic
allowlists, same masked output; no separate logic to maintain) and applies it to every commit
message *newly introduced* since the same base every other safety-contract gate compares against
(`resolveBase()` in `scripts/safety/surfaces.mjs`). It is intentionally **forward-only**: it never
walks full repository history on a normal PR or push. Rescanning/redacting history that predates
this gate is HIST-091/HIST-093's own, separately-authorized remediation track (a Git history
rewrite is destructive and requires Eduardo's explicit sign-off — see those Issues), not something
a routine CI run should attempt.

Run locally: `npm run pii:check` (file scanner + commit-message scanner). Wired into
`npm run check` via `scripts/verify.mjs` (`commit-message-pii-gate`, `commit-message-pii-gate-tests`)
and classified in `bolao/scripts/gate_registry.json`, per the Issue #219 lesson that a new gate must
never be invisible to the registry.

**Synthetic test data.** Any test/fixture needing an email-shaped value must use an RFC 2606
reserved domain (`.invalid` preferred, or `.test`/`.example`/`.localhost`/`example.com`/`.net`/
`.org`) — never a real-looking domain, even fictionally, because `scripts/test_fixture_privacy.mjs`
has a zero-exception rule against non-reserved-domain emails in test files (a 2026-08-09 incident
sent real email to 15 people from a test-adjacent path). A payment-ID-shaped fixture uses one of
this repo's declared synthetic prefixes (`SYNTH-`, `SYNTHETIC-`, `FIXTURE-`, `SAMPLE-`,
`PLACEHOLDER-`, `REDACTED-`) or is assembled at runtime (string concatenation) so no literal,
matchable value sits in a file's own source.

**Where sensitive investigation material belongs.** Local, non-public security/audit work (raw PII
extracted during an investigation, working notes, disposable git mirrors used for a dry-run
rewrite) belongs under `~/Documents/GitHub/ferrarilabs-work/` on Eduardo's machine — a location
entirely outside this repository, never a candidate for `git add`, and therefore outside every gate
described above by construction. It is not gitignored *inside* this repo because it was never
inside it to begin with; that separation is the control. Nothing under it should ever be committed
here, copied into a PR description, or pasted into a GitHub Issue.

See `docs/bolao/adr/ADR-011-forward-only-pii-prevention.md` for why forward prevention and
historical remediation are tracked as two separate decisions.
