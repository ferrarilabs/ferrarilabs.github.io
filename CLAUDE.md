# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

No build step. Push to `main` and GitHub Pages auto-deploys to `ferrarilabs.github.io`.

- Main site: `ferrarilabs.github.io`
- Bolão app: `ferrarilabs.github.io/bolao-teste/`

To preview locally, open the HTML files directly in a browser or use a static server:
```
python3 -m http.server 8080
```

## Repository structure

Two independent sub-projects live here:

**Main site** (`index.html`, `index.pt.html`, `index.es.html`, `index.jp.html`, `styles.css`) — static multilingual personal site about Eduardo Ferrari's work in financial crime/AML/AI compliance. Contact form uses Formspree + Cloudflare Turnstile (keys must be set manually in the HTML).

**Bolão app** (`bolao-teste/`) — a Copa do Mundo 2026 bracket pool app. Vanilla JS, no framework, no build system.

## Bolão app architecture

All JS is plain ES5-compatible inside an IIFE in `app.js`. Three globals are loaded before `app.js`:

| File | Global | Purpose |
|---|---|---|
| `js/config.js` | `window.BOLAO_CONFIG` | All runtime config (scoring, payments, Supabase, EmailJS, cutoff date) |
| `js/data.js` | `window.BOLAO_DATA` | Tournament fixture data (teams, groups, bracket) |
| `js/i18n.js` | `window.BOLAO_I18N` | All UI strings in pt-BR, es, en-US, ja |

**State** is stored in `localStorage` under `CONFIG.storeKey` (`"bolao2026_v3_clean"`), with an optional real-time mirror to Supabase. The app is local-first: Supabase failure degrades gracefully to localStorage.

**Config changes** to make before a new tournament: update `cutoffIso`/`cutoffLabel`, `storeKey`, `siteVersion`, payment handles, and optionally `database` keys in `js/config.js`.

**Supabase** (`database.enabled: true` in config): state is upserted to a single `bolao_state` table row with `id = "main"`. See `docs/DATABASE_SETUP_SUPABASE.md` for SQL setup.

**EmailJS** is used for participant receipts and admin notifications. Template body must contain only `{{{html_message}}}`. Keys live in `config.js` under `emailjs`.

**Admin** access is password-protected via SHA-256 hash (`adminPasswordHash` in config). The plaintext password is not in source — ask Eduardo.

**Scoring** (configurable in `config.js`):
- Exact score: 10 pts
- Correct advancement: 5 pts
- One team's goals correct: 1 pt
- Bonus: champion 25, runner-up 15, 3rd 10, 4th 5

## Adding or editing i18n strings

All UI text is in `js/i18n.js`. The app reads the active language at runtime. When adding a new key, add it to all four language objects (`pt-BR`, `es`, `en-US`, `ja`).

## Release process for bolao-teste

1. Edit files under `bolao-teste/`.
2. Bump `siteVersion` in `js/config.js`.
3. Add a CHANGELOG entry in `CHANGELOG.md`.
4. Commit and push to `main`.
