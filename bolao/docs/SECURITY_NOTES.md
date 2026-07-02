# Security Notes — v4.0-clean

## Admin password

- `config.adminPasswordHash` contains the SHA-256 hex of the admin password.
- The plain password is **never** stored anywhere in source code, HTML, or comments.
- If `adminPasswordHash` is missing or empty, admin login is blocked entirely.
- Lockout: after `adminMaxAttempts` wrong guesses, the browser blocks login for `adminLockMinutes` minutes via `localStorage`.
- Session: stored in `sessionStorage` (cleared on tab close). Expires after `adminSessionMinutes` (30 min).
- `guardAdmin()` is called on **every** admin action, not just on section load.

To generate a new hash:

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("YourPassword"))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
```

## Supabase keys

- Only the **anon/public** key is used in the frontend.
- The service_role key bypasses RLS — it must never appear in browser code or this repo.
- RLS policies restrict all operations to the single row `id = 'main'`.

## XSS prevention

- All user-supplied data is passed through `escapeHtml()` before insertion into the DOM.
- No `innerHTML` with raw user data anywhere in `app.js`.
- No `document.write` is used. Receipts use `Blob URL` opened via `window.open`.

## Content Security Policy

The `<meta http-equiv="Content-Security-Policy">` tag in `index.html` enforces:

```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net;
connect-src 'self' https://api.emailjs.com https://gamma-api.polymarket.com https://*.supabase.co https://v3.football.api-sports.io;
img-src 'self' data:;
style-src 'self' 'unsafe-inline'
```

`unsafe-inline` for styles is acceptable here (no user-controlled styles). Inline scripts are blocked.

## EmailJS rate limiting

`emailjs.init` is called with `limitRate: { throttle: 30000 }` — one email per 30 seconds maximum from a given browser. This prevents accidental spam from repeated button clicks.

## Data exposure

- All state (entries, picks, payments) is stored in `localStorage` and optionally Supabase.
- There is no server-side auth — this is an informal friends/family app.
- Participants can view each other's names and payment status via the public ranking section.
- This is by design for a transparent bolão. No passwords or financial data beyond payment method names are stored.
