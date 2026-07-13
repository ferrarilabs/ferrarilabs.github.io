# Security — Bolão do Ferrari

## Context and threat model

This is an informal friends/family app deployed as a static site. There is no server-side auth, no payments processed by the app, and no sensitive financial data stored. The threat model is:

- **In scope:** XSS, accidental credential exposure, admin session hijacking, data tampering by a malicious participant.
- **Out of scope:** Server-side attacks (there is no server), DDoS, MITM (GitHub Pages uses HTTPS), legal liability (app is explicitly informal).

## Admin authentication

- `config.adminPasswordHash`: SHA-256 hex of the admin password.
- Plain password is **never** stored anywhere — not in source, HTML, comments, or localStorage.
- If `adminPasswordHash` is empty or missing, admin login is blocked entirely.
- Hash is computed via `crypto.subtle.digest("SHA-256", ...)` — no external library.
- **Lockout:** after `adminMaxAttempts` (5) wrong attempts, admin is blocked for `adminLockMinutes` (15) minutes via `localStorage["adminLockUntil"]`.
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
| Supabase anon key is public | Accepted | RLS limits to single row; no sensitive data |
| EmailJS key is public | Accepted | Rate limiting; no financial data in emails |
| API-Football key exposed if set | Medium | Keep disabled; use proxy for production |

## Receipts and evidence

Per the transparency disclaimer in `CONFIG.transparency.disclaimer`:
> Comprovantes individuais, master list e backups exportados pelo administrador servem como evidência operacional em caso de dúvidas, erro técnico ou contestação.

Receipts are the participant's responsibility to save. The admin should export a CSV backup after the cutoff closes.
