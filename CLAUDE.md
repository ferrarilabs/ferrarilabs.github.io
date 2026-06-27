# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

No build step. Push to `main` and GitHub Pages auto-deploys to `ferrarilabs.github.io`.

- Main site: `ferrarilabs.github.io`
- Bolão app: `ferrarilabs.github.io/bolao-teste/`

To preview locally:
```bash
python3 -m http.server 8080
# Open: http://localhost:8080/bolao-teste/
```

## Repository structure

Two independent sub-projects:

**Main site** (`index.html`, `index.pt.html`, `index.es.html`, `index.jp.html`, `styles.css`) — static multilingual personal site about Eduardo Ferrari's work in financial crime/AML/AI compliance. Contact form uses Formspree + Cloudflare Turnstile (keys must be set manually in the HTML).

**Bolão app** (`bolao-teste/`) — Copa do Mundo 2026 bracket pool. Vanilla JS, no framework, no build system. URL: `ferrarilabs.github.io/bolao-teste/`.

## Bolão app — quick reference

### Script load order

1. `@emailjs/browser@4` (CDN, sync)
2. `@supabase/supabase-js@2` (CDN, sync)
3. `js/config.js` → `window.BOLAO_CONFIG`
4. `js/data.js` → `window.BOLAO_DATA`
5. `js/i18n.js` → `window.BOLAO_I18N`
6. `js/app.js` (defer — all logic in a single IIFE)

### Key files

| File | Purpose |
|---|---|
| `js/config.js` | Runtime config: scoring, payments, Supabase, EmailJS, cutoff date, admin hash |
| `js/data.js` | Fixture data: 72 group + 32 knockout matches, team flags, strength ratings |
| `js/i18n.js` | All UI strings in **3 languages**: `pt-BR`, `es`, `en-US` |
| `js/app.js` | Single IIFE (~1430 lines): all state, rendering, validation, scoring, admin |
| `css/styles.css` | All styles — mobile-first, responsive |
| `index.html` | Single page; sections shown/hidden by JS |

### State

- **localStorage key:** `bolao_copa_2026_state`
- **Supabase table:** `bolao_state`, single row `id = "main"`, column `state jsonb`
- **Draft key:** `sessionStorage["bolao_draft_v4"]` (2-hour expiry)
- **Language key:** `localStorage["bolao_lang"]`
- App is local-first: Supabase failure degrades gracefully.

### Scoring (configured in `js/config.js`)

- Exact score: **10 pts**
- Correct advancement: **5 pts**
- One team's goals correct: **1 pt**
- Bonus: champion **+25**, runner-up **+15**, 3rd **+10**, 4th **+5**
- Prize pool: 70% → 1st, 20% → 2nd, 10% → 3rd

### Admin

- Password stored as SHA-256 hash in `config.adminPasswordHash`. Plaintext never in source.
- Lockout: 5 failed attempts → 15-min block.
- Session: 30 min, `sessionStorage`, cleared on tab close.
- `guardAdmin()` called on every admin action.

To generate a new hash:
```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("YourPassword"))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
```

### Cutoff

- `cutoffIso: "2026-06-28T14:00:00-04:00"` — Sunday June 28 2026 at 2 PM ET.
- Enforcement is client-side only (clock manipulation bypasses it).

### EmailJS

- Template body must contain **only** `{{{html_message}}}` — no other fields.
- Rate limit: 30-second throttle per browser.
- Two templates: participant receipt (`participantTemplateId`) + admin notification (`adminTemplateId`).

### i18n

All UI strings are in `js/i18n.js`. **Three language objects:** `pt-BR`, `es`, `en-US`.
When adding a new key, add it to all three objects. Default fallback is `pt-BR`.

### Supabase

- `database.enabled: true` in config to activate.
- Only anon key used — never the service_role key.
- RLS restricts all operations to `id = 'main'`.
- Merge strategy: union entries, local wins for paid/results.
- See `bolao-teste/docs/DATABASE_SETUP_SUPABASE.md` for SQL setup.

### Release process

1. Edit files under `bolao-teste/`.
2. Bump `siteVersion` in `js/config.js`.
3. Add a CHANGELOG entry in `bolao-teste/CHANGELOG.md`.
4. Commit and push to `main`.
5. Run QA checklist from `docs/bolao/QA_CHECKLIST.md`.

### Rollback

```bash
git revert HEAD && git push
# or
git checkout <previous-commit> -- bolao-teste/
git commit -m "Revert bolao to <version>"
git push
```

## Full documentation

All extended documentation is in `docs/bolao/`:

- `PROJECT_CONTEXT.md` — product vision, rules, scoring, tournament facts
- `REQUIREMENTS.md` — all features as implemented
- `ARCHITECTURE.md` — file structure, state shape, key functions, Supabase schema
- `SECURITY.md` — CSP, XSS prevention, admin auth, key exposure, known limitations
- `QA_CHECKLIST.md` — complete test checklist for every deploy
- `BUGS_AND_FEEDBACK.md` — open bugs, fixed bugs, user feedback, wishlist
- `CHANGELOG.md` — consolidated version history
- `ROADMAP.md` — planned and discussed future work

Also see `bolao-teste/docs/` for low-level setup guides (Supabase SQL, API-Football, deploy steps).
