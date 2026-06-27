# Bolão do Ferrari — Copa do Mundo 2026

Static app for a friend/family prediction bracket. Hosted on GitHub Pages at `/bolao-teste/`.

## Quick start

```
python3 -m http.server 8080
```
Open `http://localhost:8080/bolao-teste/`.

## Files

```
bolao-teste/
  index.html          — single-page app shell
  css/styles.css      — dark/green theme, responsive
  js/
    config.js         — BOLAO_CONFIG (keys, scoring, EmailJS, Supabase)
    data.js           — BOLAO_DATA  (teams, matches 73-104)
    i18n.js           — BOLAO_I18N  (PT-BR / ES-MX / EN-US)
    app.js            — full app logic (IIFE, no build step)
  assets/
    whatsapp.svg
    whatsapp-group-qr.png  (add manually)
  docs/
    DEPLOY.md
    DATABASE_SETUP_SUPABASE.md
    QA_CHECKLIST.md
    SECURITY_NOTES.md
```

## Configuration

Edit `js/config.js`:
- `adminPasswordHash` — SHA-256 hex of your admin password (never store the password itself)
- `emailjs.*` — your EmailJS public key, service ID, template IDs
- `database.*` — Supabase URL and anon key (set `enabled: true`)
- `cutoffIso` — registration deadline in ISO 8601

See `docs/DATABASE_SETUP_SUPABASE.md` for the SQL schema and RLS policies.

## Admin password

Generate the hash in the browser console:

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("YourPassword"))
  .then(b => console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")))
```

Paste the result into `config.adminPasswordHash`. Never put the plain password anywhere in source.

## EmailJS template

Set the template body to only:

```
{{{html_message}}}
```

## Deploy

See `docs/DEPLOY.md`.

## Security notes

See `docs/SECURITY_NOTES.md`.
