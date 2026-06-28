# CHANGELOG

## v4.2-patch — 2026-06-27

Surgical patch on v4.1-patch. Data updates and receipt improvements.

### Fixed / Updated
- `data.js`: All 32 knockout match venues now filled in (was "A confirmar"). Times added in EDT format for matches 74–104.
- `data.js`: Fixed M74 (Brazil vs Japan) kickoff time: 12:00 → 13:00 EDT.
- Sources: NBC Sports schedule + Wikipedia Copa 2026 knockout bracket.

### Added
- Receipt HTML: scoring legend section showing all point values.
- Receipt HTML: manual point verification table (fill-in area for double-checking scores).
- i18n: 12 new keys (`receiptLegendTitle`, `receiptLegendExact`, `receiptLegendAdvance`, `receiptLegendOneTeam`, `receiptLegendChampion`, `receiptLegendRunnerUp`, `receiptLegendThird`, `receiptLegendFourth`, `receiptCheckTitle`, `receiptCheckBy`, `receiptCheckDate`, `receiptCheckTotal`) added to all 3 languages (pt-BR, es, en-US).

### Confirmed (no change needed)
- Supabase already `enabled: true` in `config.js` with correct credentials.

---

## v4.1-patch — 2026-06-27

Surgical patch on v4.0-clean. No architecture changes.

### Fixed
- `mergeStates()`: `paid` now uses "any true wins" (payment confirmed on one device is never overwritten by another). `results` now uses remote-wins (admin is sole source of truth).
- `adminLogin()`: wrapped `sha256Hex()` in try/catch; alerts `adminLoginError` if `crypto.subtle` is unavailable (e.g. HTTP).
- `updateDynamic()`: `saveDraft()` now runs debounced at 400 ms instead of on every keystroke.
- CSP: removed unused `https://api.ipify.org` from `connect-src`.
- Supabase CDN: pinned to `@2.45.4`, added `integrity` (SRI) and `crossorigin="anonymous"`.
- Deleted `js/i18n-repair.js` (not loaded anywhere; legacy artifact).

### Added (optional improvements)
- Duplicate entry name check in `saveEntry()` — prompts confirmation before saving.
- `demo-badge` visual label on demo entries in ranking.
- CSS `:focus-visible` outline on buttons/inputs/selects for keyboard accessibility.
- `<link rel="canonical">` in `index.html`.
- i18n keys: `adminLoginError`, `duplicateEntryConfirm` (pt-BR, es, en-US).

---

## v4.0-clean — 2026-06-27

Full clean rebuild from scratch. No code carried over from v3.x.

### What changed
- Single IIFE `app.js` — no globals, no module bundler required.
- `config.js`, `data.js`, `i18n.js` are plain `window.*` assignments.
- Admin auth: SHA-256 via `crypto.subtle`, per-action `guardAdmin()`, 30-min session, lockout after N attempts.
- Bracket: slot resolution propagates across rounds; auto-advance when score is non-tie.
- Draft: `sessionStorage` with restore offer; key `bolao_draft_v4`.
- Scoring: called once per entry in `renderRanking`; bonus computed from `finalPodiumForEntry`.
- Supabase: merge-before-save (fetch remote `updated_at` first); local-first.
- i18n: 3 languages (PT-BR / ES-MX / EN-US), button toggle, no dropdown.
- Receipt: Blob URL — no `document.write`.
- EmailJS: `limitRate:{throttle:30000}`, HTML only via `html_message` field.
- CSV: `\r\n` line endings for Excel.
- CSP meta tag with all required directives.
- `escapeHtml` applied on every user-data DOM insertion.
- WhatsApp group button and QR in payment section.

### Removed from v3.x
- `i18n-repair.js` — no longer needed.
- PayPal payment method.
- All legacy patch files (`FIX_LOG_*`, `RELEASE_LOCK.md`).

---

## v3.3.4-stable-repair

- Removed visible language dropdown.
- Added timer seconds.
- Removed A/B score labels.
- Repaired rules i18n.
- Added Supabase focus/visibility reload and remote clear.

## v3.3.1-db-ui-fixes

- Desktop/mobile header fix.
- Language selector changed to flag buttons.
- Games view redesigned.
- Rules scoring table restored.
- Admin demo data restored.
- Optional API-Football refresh added as cached data only.

## v3.3-db-ready

- Optional Supabase remote state adapter.
- Local-first remote mirror.
- Phase labels polished.
- Supabase setup docs added.

## v3.2.1-rc1

- Final release-lock patch.
- Corrected UK nation flag emojis.
- Removed initial `Time A` / `Time B` dropdown flash.
- Softer score >20 guard while typing.
- Receipt HTML labels now use i18n.

## v3.0

- Clean rebuild from the unstable v2 branch.
- CSV backups, receipts, admin, ranking, i18n, EmailJS and validation stabilized.
