# Changelog — Bolão do Ferrari

This file consolidates the full version history. The source of truth for the latest entry is `bolao-teste/CHANGELOG.md`.

---

## v4.0-clean — 2026-06-27

Full clean rebuild from scratch. No code carried over from v3.x.

### Added
- Single IIFE `app.js` — no globals leaking, no module bundler required.
- `config.js`, `data.js`, `i18n.js` as plain `window.*` assignments loaded before `app.js`.
- Admin auth: SHA-256 via `crypto.subtle`, per-action `guardAdmin()`, 30-min session, lockout after N attempts.
- Bracket slot resolution propagates across all rounds; auto-advance when score is non-tie.
- Draft: `sessionStorage` with restore offer on page reload; key `bolao_draft_v4`; 2-hour expiry.
- Scoring: called once per entry in `renderRanking`; bonus computed from `finalPodiumForEntry`.
- Supabase: merge-before-save (fetch remote `updated_at` first); local-first with graceful fallback.
- i18n: 3 languages (PT-BR / ES-MX / EN-US), flag button toggle, no dropdown.
- Receipt: Blob URL + `window.open` — no `document.write`.
- EmailJS: `limitRate: { throttle: 30000 }`, HTML only via `html_message` field.
- CSV exports: `\r\n` line endings for Excel compatibility.
- CSP meta tag (default-src, script-src, connect-src, img-src, style-src, base-uri, frame-ancestors).
- `escapeHtml` applied on every user-data DOM insertion.
- WhatsApp group button and QR in payment section and header.
- Countdown timer with seconds.
- Payment section: CashApp, Zelle (with QR), Venmo.
- Games section: all 72 group + 32 knockout matches.
- Admin exports: master CSV, backup CSV, backup JSON, master HTML.
- Demo data loader.
- API-Football cache refresh in admin (disabled by default).
- Polymarket odds in smart simulator config.
- Transparency disclaimer in rules section.
- `noindex,nofollow` robots meta tag.

### Removed from v3.x
- `i18n-repair.js` patch file.
- PayPal payment method.
- All legacy patch files (`FIX_LOG_*`, `QA_CHECKLIST_v3_*`, `RELEASE_LOCK.md`).

---

## v3.3.4-stable-repair — 2025

- Removed visible language dropdown; replaced with flag buttons.
- Added seconds to countdown timer.
- Removed "A / B" score input labels.
- Repaired rules i18n strings.
- Added Supabase reload on browser focus and visibility change.
- Added admin button to clear remote state.

## v3.3.1-db-ui-fixes — 2025

- Desktop/mobile header layout fix.
- Language selector redesigned as flag buttons.
- Games section redesigned.
- Rules scoring table restored.
- Admin demo data restored.
- Optional API-Football refresh added (caches only).

## v3.3-db-ready — 2025

- Optional Supabase remote state adapter (local-first mirror).
- Phase labels polished.
- Supabase setup docs added.

## v3.2.1-rc1 — 2025

- Corrected UK nation flag emojis.
- Removed initial "Time A / Time B" flash.
- Softer score >20 guard while typing.
- Receipt HTML labels use i18n.

## v3.0 — 2025

Clean rebuild from unstable v2. Fixed from Claude audit: CSV CRLF, admin password handling, EmailJS throttle, score validation, receipt Blob URL, simulator guards, HTML escaping, event delegation, scoring performance.
