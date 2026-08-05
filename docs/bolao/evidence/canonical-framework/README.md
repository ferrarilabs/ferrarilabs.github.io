# Canonical visual-framework migration — real visual evidence (phase 7)

Phase 6 of this migration shipped without real screenshots because no browser/Playwright was
available at the time. Phase 7 redid the check properly: a real Chrome binary was found on this
machine, Playwright was installed locally (`npm install --no-save playwright`, scoped to this
repo checkout, not committed as a dependency since the repo intentionally has no build step —
see `docs/bolao/adr/ADR-001-vanilla-javascript.md`), and real headless-Chrome captures were run
against all three apps served locally. Nothing below is fabricated or guessed.

## What was actually done

1. **Real browser confirmed and used.** `ls -d "/Applications/Google Chrome.app"` found a real
   Chrome install. `npx playwright install chromium` reported it already had a cached
   "Chrome for Testing" binary at `~/Library/Caches/ms-playwright/chromium-1234/` (Playwright's
   own bundled Chromium build, not the system Chrome — used via the
   `PLAYWRIGHT_CHROMIUM_PATH` environment variable this repo's own capture scripts already
   support, see `bolao/cdb2026/scripts/visual/capture_evidence.mjs:150`). Confirmed launchable
   headlessly before running anything else.
2. **Real captures, using this repo's own pre-existing, previously-reviewed harness** (not
   reinvented): `bolao/cdb2026/scripts/visual/capture_evidence.mjs` (general screenshots, 7
   sections × 7 viewports × 3 apps) and `capture_admin_auth_evidence.mjs` (authenticated admin
   panel, synthetic `sessionStorage` session seeded per each app's own documented key —
   `adminOk`/`adminUntil` for Copa, `br2026_adminUntil`, `cdb2026_adminUntil` — real admin
   password never touched, same technique already reviewed and in use in this repo before this
   session).
3. **Side-by-side montages**, Copa always the first column, using
   `bolao/scripts/make_visual_comparison_montages.mjs` (also pre-existing) — 28 real PNG images
   (7 screens × 4 viewports: 320×568, 390×844, 768×1024, 1440×900) under
   `docs/bolao/evidence/canonical-framework/montages/`.
4. **A real, previously-undiscovered capture bug found and fixed**: the first capture run had 7
   `failed` entries, all CDB2026 "Palpites" (entry form). Root cause traced to
   `bolao/cdb2026/js/app.js`'s `isPastEntryCutoff()`/`effectivePhaseCutoffMs()`: the visual test
   fixture (`bolao/cdb2026/scripts/visual/game_fixtures.mjs`) had two ties (`fx-t4`/`fx-t5`,
   used to exercise the "postponed" and "live" game states) dated `2026-08-05`/`2026-08-04` —
   which, once this sandbox's simulated "today" reached `2026-08-04`, became the phase's
   earliest known kickoff, pushing the whole "Oitavas" phase's entry cutoff into the past and
   silently defaulting the app to the Ranking tab on load. This is a **test-fixture staleness
   bug in dev tooling** (`game_fixtures.mjs`), not a CSS/framework regression and not app
   business logic — confirmed by reading `routeCdb2026Espn()` in the same file, which resolves
   the postponed/live ESPN mock states by team name only, never by this date. Fixed by moving
   both dates to 2031 (matching every other synthetic date already in that fixture). After the
   fix: 77/77 applicable captures succeeded, 0 failed.
5. **Computed-style cross-app audit**, using this repo's own pre-existing
   `bolao/scripts/audit_visual_consistency.mjs` (getComputedStyle-based, not source-reading) —
   30 components × up to 15 properties each. Before the fixture fix: 8 unapproved DIVERGENT
   findings, all traced to the same root cause above (CDB2026's marked `input`/`select`/
   `button-primary`/`form-grid` elements weren't in the live DOM because the app had defaulted
   to Ranking). After the fixture fix: **0 unapproved DIVERGENT findings** — 383 EQUAL, 23
   JUSTIFIED (documented, approved variants, see `docs/bolao/evidence/visual-comparison/
   ALLOWLIST.json`), 14 N/A (component genuinely doesn't exist in that app).
6. **Console errors, checked live** via Playwright's own `page.on("console")`/`page.on(
   "pageerror")` listeners at 390×844/768×1024/1440×900 for all three apps: every error found
   is an expected external-network failure (ESPN `fetch()` blocked by CORS — this sandbox has no
   real internet access to `site.api.espn.com`/Supabase, and both are unreachable by design in
   an offline capture environment) or a CSP `frame-ancestors`-in-`<meta>` browser warning (also
   pre-existing, unrelated to this migration). **Zero app-code console errors** in any app at
   any tested viewport.
7. **Horizontal overflow, checked live** (`document.documentElement.scrollWidth >
   .clientWidth`) at the same three viewports for all three apps: **zero overflow** anywhere.
8. **Sticky overlap, checked live** via this repo's own pre-existing
   `bolao/cdb2026/scripts/visual/check_sticky_overlap.mjs` (real Chromium, real scroll
   positions 0/25/50/75/100% at 7 viewports): **zero overlap** at any sampled position/viewport.
9. **Probability-bar `min-width` divergence, investigated and fixed** (not left as
   "intentionally different"): see the dedicated note in `docs/bolao/CONSISTENCY_MATRIX.md`'s
   phase 7 entry and the code comment at `bolao/shared/css/components.css`'s `.prob-bar` rule.
   Empirically measured via Playwright (a real 3% segment at 390px, with the shared canonical
   `min-width: 6px`) that the percentage label every app renders inside every segment
   (`label(pct,name)`, `bolao/copa2026/js/app.js:2656` — this is Copa's OWN code, not a BR2026/
   CDB2026 addition) gets genuinely clipped (`scrollWidth 22px > clientWidth 19px`) at 6px, and
   is fully legible (`scrollWidth === clientWidth`, `40px` rendered) at 32px. 32px — the value
   BR2026/CDB2026 already carried as an undocumented local override — was promoted to the
   shared canonical value; BR2026/CDB2026's now-redundant local overrides were deleted.

## Genuinely inaccessible screens (honestly excluded, not silently skipped)

Per `bolao/cdb2026/scripts/visual/capture_evidence.mjs`'s own app-by-app `notApplicable`
config (verified against each app's real product behavior, not assumed) and confirmed again in
this phase's montage run (`docs/bolao/evidence/canonical-framework/montages/
montage_manifest.json`, every `available:false` entry carries a `reason` string):

| App | Screen(s) | Why inaccessible |
|---|---|---|
| Copa (copa2026) | Palpites, Regras, Admin (login + authenticated) | `CONFIG.archived` hides every nav button except Ranking for real visitors — the tournament concluded and the site is intentionally archived (see `CLAUDE.md`, "Copa do Mundo 2026 archive"). Not worked around: `applyArchiveMode()`/`CONFIG.archived` were never touched to force these screens open, matching this repo's own pre-existing rule for this exact situation. |
| BR2026 | Palpites | Entries closed 2026-07-16 (`CLAUDE.md`) — the Palpites nav button is permanently disabled by product decision, not a rendering defect. |

Every other screen × app × viewport combination named in phase 6's coordinator instructions
(topbar, tabs, ranking, full games list, game-card scheduled, game-card completed, rules, form,
admin login, admin authenticated) was captured for real for every app where the screen is
reachable by product design. **Zero `CAPTURE_FAILED` entries remain in
`COMPONENT_AUDIT.md` for any reason other than the two rows above.**

## Where the evidence lives

- `docs/bolao/evidence/visual/manifest.json` — capture_evidence.mjs's own manifest (112 entries:
  77 captured, 35 notApplicable, 0 failed).
- `docs/bolao/evidence/visual/admin_auth_manifest.json` — authenticated-admin capture manifest
  (17 entries: 16 captured, 1 notApplicable).
- `docs/bolao/evidence/visual-comparison/audit_visual_consistency.{md,json}` (and a copy in this
  folder) — the full computed-style comparison, all 30 components, all properties, all three
  apps.
- `docs/bolao/evidence/canonical-framework/montages/` — 28 real side-by-side PNG montages, Copa
  always the first column, plus their manifest.
- `docs/bolao/evidence/canonical-framework/COMPONENT_AUDIT.md` — final classification, now
  backed by the real evidence above instead of source-only inspection.
