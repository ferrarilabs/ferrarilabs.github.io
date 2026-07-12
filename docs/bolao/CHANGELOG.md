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

<!-- AUTO:GOVERNANCE_CHANGELOG:START -->
## Platform governance audit — baseline snapshot (Copa v4.125 / BR2026 v1.13 / CDB2026 v1.6)

Introduced platform-level governance documentation and a cross-app consistency audit covering
all three bolão apps (`bolao/`, `bolao/br2026/`, `bolao/cdb2026/`). Documentation only — no
functional code was changed.

### Added
- `docs/bolao/PLATFORM_GOVERNANCE.md` — change classification categories (`PLATFORM_SHARED`,
  `TOURNAMENT_SPECIFIC`, `DATA_ONLY`, `SECURITY`, `EMERGENCY_HOTFIX`) and propagation rules
  between the three apps.
- `docs/bolao/CONSISTENCY_MATRIX.md` — 60-area audit comparing the three apps (design system,
  admin, security, email/receipts, live scores, i18n, accessibility, CSP, and more).
- `docs/bolao/QA_MASTER_CHECKLIST.md` — cross-app QA checklist (pre-change, static checks,
  functional, visual, cross-app, post-change).
- `AUTO:PLATFORM_RULES` block in `CLAUDE.md` with the mandatory propagation rule.
- `AUTO:PLATFORM_CONTEXT`, `AUTO:MULTI_APP_ARCHITECTURE`, `AUTO:CROSS_APP_QA` blocks in the
  corresponding existing docs, cross-linking to the new governance files.

### Findings summary (see CONSISTENCY_MATRIX.md for detail)
- No Critical divergences found.
- High: BR2026/CDB2026 have no scoring self-audit script equivalent to
  `bolao/scripts/audit_scoring.py`, and no receipt/PDF/email-receipt system for participants
  despite promising "comprovantes" in their own transparency disclaimer.
- Medium: CSV exports in BR2026/CDB2026 use LF instead of the CRLF fix already applied in
  Copa v3.0; no WhatsApp support button or `assets/` folder (payment QR codes) in the two
  newer apps; no `AbortController`/timeout on their `fetch()` calls; CDB2026 has no postponed-
  match detection (BR2026 has it since v1.13); no "clear data" admin action or JSON backup
  export in the two newer apps.

## Governance documentation — permanent memory, lessons learned, DoD/smoke/regression/risk

Documentation-only session. No functional code was changed.

### Added
- `docs/bolao/PROJECT_MEMORY.md` — permanent project memory (history, architecture, per-app
  structure, tech stack, architectural decisions, limitations, database, email, PDF, scoring,
  ranking, admin, APIs, i18n, security, audits performed, historical bugs, tech debt, roadmap),
  extracted entirely from existing docs/code, no invented content.
- `docs/bolao/LESSONS_LEARNED.md` — historical bugs in problem/root-cause/fix/prevention
  format, covering CSV line endings, receipt/PDF flow, EmailJS payload shape, mobile flag/name
  ordering, i18n gaps, admin hash/lockout, hardcoded credentials, event delegation, ranking
  tie-break drift, bonus-scoring drift, popup blockers, Supabase merge strategy, multi-tab/
  bfcache sync, clear-data, API-Football, countdown, mobile layout, Safari/WebKit quirks,
  receipts, backups, localStorage recovery, cross-app consistency drift, and QA process gaps.
- `docs/bolao/QA_MASTER_CHECKLIST.md`: added sections G (Definition of Done), H (Smoke Tests),
  I (Regression Tests), J (Risk Assessment) inside the existing `AUTO:QA_MASTER_CHECKLIST`
  block.
- `CLAUDE.md`: added a "Permanent rules" block inside `AUTO:PLATFORM_RULES` — mandatory reading
  list before any change (`PROJECT_MEMORY.md`, `ENGINEERING_STANDARD.md`,
  `PLATFORM_GOVERNANCE.md`, `CONSISTENCY_MATRIX.md`, `QA_MASTER_CHECKLIST.md`, `CHANGELOG.md`),
  pre-modification checklist, and an explicit never/always list.

### Known gap introduced by this session
- `CLAUDE.md`'s new permanent-rules block and this session's own instructions reference
  `docs/bolao/ENGINEERING_STANDARD.md`, which **does not exist yet**. Tracked as missing
  documentation — see the consistency audit note below and `PROJECT_MEMORY.md`/
  `CONSISTENCY_MATRIX.md` for context. Not created in this session because it wasn't explicitly
  requested as content to author, only as a rule to reference.
<!-- AUTO:GOVERNANCE_CHANGELOG:END -->
