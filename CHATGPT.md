# CHATGPT.md — Bolão do Ferrari

Context file for AI assistants (ChatGPT, Claude, etc.) working on this codebase.
Last updated: 2026-06-27.

---

## What this project is

**Bolão do Ferrari** is a Copa do Mundo 2026 bracket pool app for Eduardo Ferrari's friends and family.
It is a pure static site (HTML + vanilla JS + CSS) deployed on GitHub Pages — no server, no backend, no build step.

- **URL:** `https://ferrarilabs.github.io/bolao/`
- **Admin email:** emferrari@gmail.com
- **Current version:** v4.0-clean

---

## File map (bolao/)

```
index.html          ← single page app; sections toggled by JS
css/styles.css      ← all styles
js/config.js        ← window.BOLAO_CONFIG (all config)
js/data.js          ← window.BOLAO_DATA (fixtures, flags, strength)
js/i18n.js          ← window.BOLAO_I18N (3 languages: pt-BR, es, en-US)
js/app.js           ← all logic (single IIFE, ~1430 lines)
assets/             ← SVG icons, QR code images
docs/               ← setup guides (Supabase, API-Football, deploy)
CHANGELOG.md        ← version history
```

Extended docs: `docs/bolao/` at repo root.

---

## Rules of the pool

- **Entry fee:** US$ 5 per entry
- **Deadline:** Sunday June 28 2026 at 2:00 PM ET (cutoffIso in config.js)
- **Picks:** All 32 knockout matches (Round of 32 → Final)
- **Prize:** 70% → 1st, 20% → 2nd, 10% → 3rd
- **Payment:** CashApp ($EduardoFerrari), Zelle (914-406-5027), Venmo (Eduardo-Ferrari)
- **Informal:** no legal liability

### Scoring (knockout matches only)

| Event | Points |
|---|---|
| Exact score (90 min + ET, no shootout) | 10 |
| Correct team advancing | 5 |
| One team's goals correct | 1 |
| Bonus: champion | +25 |
| Bonus: runner-up | +15 |
| Bonus: 3rd place | +10 |
| Bonus: 4th place | +5 |

---

## Architecture in one page

### Globals loaded before app.js

| Variable | File | Contents |
|---|---|---|
| `window.BOLAO_CONFIG` | `js/config.js` | scoring rules, payment handles, Supabase keys, EmailJS keys, cutoff, admin hash |
| `window.BOLAO_DATA` | `js/data.js` | 72 group matches + 32 knockout matches, team flags, strength ratings |
| `window.BOLAO_I18N` | `js/i18n.js` | UI strings in pt-BR / es / en-US |

### State (localStorage key: `bolao_copa_2026_state`)

```json
{
  "entries": [{ "id":"...", "entryName":"...", "payerName":"...", "participantEmail":"...",
                "paymentMethod":"CashApp", "paymentTo":"$EduardoFerrari",
                "createdAt":"...", "diagnostics":{},
                "picks": { "73": { "goalsA":2,"goalsB":1,"advanceSide":"A","displayA":"Brazil","displayB":"Japan" } } }],
  "paid": { "<entry-id>": true },
  "results": { "73": { "goalsA":1,"goalsB":0,"advanceSide":"A" } },
  "meta": { "updatedAt":"...", "version":"v4.0-clean" }
}
```

Supabase is an optional remote mirror of this same object (`bolao_state` table, `id = "main"`).

### Match numbering

- Group stage: GS-01 through GS-72 (12 groups × 6 matches)
- Round of 32: matches 73–88
- Round of 16: matches 89–96
- Quarterfinals: matches 97–100
- Semifinals: matches 101–102
- 3rd Place: match 103
- Final: match 104

---

## Admin

- **Login:** SHA-256 hash comparison via `crypto.subtle`. Plain password never in source.
- **Hash field:** `config.adminPasswordHash`
- **Lockout:** 5 wrong attempts → 15-minute block (localStorage)
- **Session:** 30 min, sessionStorage, cleared on tab close
- **`guardAdmin()`** called on every admin action

Admin can: mark payments, enter real results, delete entries, export CSV/JSON/HTML, clear all data, load demo data, refresh API-Football cache.

---

## External services

### Supabase
- URL: `https://cmhqkkfczotdnssupkni.supabase.co`
- Anon key in `config.js` (safe to commit — RLS limits to `id = 'main'`)
- Never use service_role key in browser code
- Setup SQL: `bolao/docs/DATABASE_SETUP_SUPABASE.md`

### EmailJS
- Public key: `GBZFujsJBET6modve`
- Service: `service_o4hyzxr`
- Templates: `template_xq7yzzb` (participant), `template_4sgp5r9` (admin)
- Template body must contain only `{{{html_message}}}`
- Rate limit: 30-second throttle

### API-Football
- Disabled by default (`enabled: false`, `apiKey: ""`)
- League 1 (World Cup), season 2026
- Results cached in `localStorage["bolao_api_football_cache"]`
- Does NOT auto-update bracket — cache only

### Polymarket
- URL: `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100`
- Used internally by smart simulator to bias probabilities
- Not displayed in UI

---

## i18n

Three languages: `pt-BR` (default), `es`, `en-US`.
Toggle via flag buttons in header (🇧🇷 / 🇲🇽 / 🇺🇸).
All strings in `js/i18n.js`. Fallback: `pt-BR`.
**There is no Japanese language object** — ignore any prior docs that mention `ja`.

---

## Security constraints

- No server-side auth — admin is best-effort client-side SHA-256.
- Cutoff enforcement is client-side only.
- All user data goes through `escapeHtml()` before DOM insertion.
- No `document.write`, no eval.
- CSP in meta tag blocks inline scripts.
- Supabase anon key is public by design.
- EmailJS key is public — unavoidable for browser-only apps.
- API-Football key must NOT be set without a proxy for production.

---

## How to make a change

1. Edit files under `bolao/`.
2. Bump `siteVersion` in `js/config.js`.
3. Add entry to `bolao/CHANGELOG.md`.
4. Commit: `git add bolao/ && git commit -m "Release bolao vX.Y"`.
5. Push to main: `git push`. GitHub Pages deploys in < 2 min.
6. Run QA checklist: `docs/bolao/QA_CHECKLIST.md`.

Local preview: `python3 -m http.server 8080` → `http://localhost:8080/bolao/`

Rollback: `git revert HEAD && git push`

---

## What NOT to do

- Do not touch `index.html`, `styles.css`, or main site files when working on the bolão.
- Do not push admin password in plaintext.
- Do not push service_role Supabase key.
- Do not add `ja` language unless actually implementing it in `i18n.js`.
- Do not enable API-Football without a proxy (exposes key).
- Do not use `document.write` — use Blob URLs.
- Do not add `innerHTML` with raw user strings — always `escapeHtml()`.

---

## Extended documentation index

| File | Contents |
|---|---|
| `docs/bolao/PROJECT_CONTEXT.md` | Product vision, rules, scoring, tournament facts, version history |
| `docs/bolao/REQUIREMENTS.md` | All features as implemented; static site constraints |
| `docs/bolao/ARCHITECTURE.md` | File structure, state shape, key functions, Supabase schema |
| `docs/bolao/SECURITY.md` | CSP, XSS prevention, admin auth, key exposure, known limitations |
| `docs/bolao/QA_CHECKLIST.md` | Complete test checklist for every deploy |
| `docs/bolao/BUGS_AND_FEEDBACK.md` | Open bugs, fixed bugs, user feedback, wishlist |
| `docs/bolao/CHANGELOG.md` | Consolidated version history |
| `docs/bolao/ROADMAP.md` | Planned and discussed future work |
| `bolao/docs/DATABASE_SETUP_SUPABASE.md` | Supabase SQL setup |
| `bolao/docs/API_FOOTBALL_SETUP.md` | API-Football setup |
| `bolao/docs/DEPLOY.md` | Deploy steps and rollback |
| `bolao/docs/SECURITY_NOTES.md` | Security details for v4.0-clean |
