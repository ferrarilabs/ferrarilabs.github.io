# Canonical visual-framework migration — evidence limitations and capture guide

This documents what was and was NOT verified for the Copa-canonical visual-framework migration
(phases 1-6, branch `visual-framework-copa-canonical`), and gives Eduardo exact steps to capture
real before/after screenshots himself, since this Claude Code session has no working screenshot
capability for this task.

## What was actually verified (no browser required)

- **Every shared CSS file and every app's local CSS file is syntactically valid**: brace-balance
  checked programmatically for all 11 CSS files (`bolao/shared/css/*.css` ×8 plus each app's
  `css/styles.css` ×3).
- **All three apps' `index.html` parse without fatal errors** under Python's `html.parser`.
- **Every `<link>` to a shared CSS file resolves with HTTP 200** — verified by running
  `python3 -m http.server` from the repo root and fetching all 14 relevant URLs
  (`bolao/{copa2026,br2026,cdb2026}/index.html` and the 8 `bolao/shared/css/*.css` files, plus
  each app's own `css/styles.css`) with Python's `urllib`. This confirms the relative paths in
  each app's `<link rel="stylesheet">` tags are correct for that app's real folder depth — a
  wrong path here would 404 silently in a real browser (no visible error, just an unstyled
  page), so this check matters even without a browser.
- **The full CSS/HTML/JS diff was read line-by-line during phases 2-5** (not this phase) —
  every rule removed from an app's local `css/styles.css` was checked against the shared file it
  moved to, value for value, before deletion. This is not the same as a rendered screenshot, but
  it is a real verification, not a guess.
- **Static CSS contract check** (`bolao/scripts/check_shared_visual_contract.mjs`, phase 5):
  0 violations — no local app CSS file redefines a protected shared-component property on a
  protected selector without a variant suffix.

## What was NOT verified — honestly

**No browser or screenshot tool was available in this environment for this task.**
`mcp__claude-in-chrome__list_connected_browsers` was checked first, as instructed, and returned
an empty list — no Chrome extension instance is connected to this account/session. The
repo's own Playwright-based visual harness (`bolao/scripts/audit_visual_consistency.mjs`) was
also checked and cannot run here either: `node -e "import('playwright')"` fails with
`Cannot find package 'playwright'` — it is not installed in this environment.

This means the following were **not** verified in this session, and nothing below should be read
as claimed or implied by the "verified" list above:

- Actual rendered appearance in a real browser, at any viewport width.
- Runtime JavaScript console errors or warnings (the `node --check` syntax pass in
  `docs/bolao/evidence/canonical-framework/COMPONENT_AUDIT.md`'s companion test run only proves
  the JS parses — it says nothing about runtime behavior, DOM errors, or whether `app.js`
  actually finds and applies every class the new shared CSS expects).
- Whether the cascade order (shared files load before each app's local `css/styles.css`) produces
  the same *computed* styles as before the migration — this was verified by manual value-by-value
  comparison during phases 2-5, not by a real computed-style diff.
- Font rendering, spacing, or color exactly as a human eye would perceive it.
- Any interactive/hover/focus state, animation, or responsive breakpoint behavior in practice.

`docs/bolao/evidence/canonical-framework/COMPONENT_AUDIT.md` marks every one of the 28 canonical
components `CAPTURE_FAILED` for exactly this reason, rather than guessing `EQUAL`.

## What a real before/after capture would show (if someone runs it)

For each of the 28 canonical components (topbar, brand, nav/tabs, card, game-card, score,
status-badge, probability-bar, ranking-row, rules-table, form-grid, input/select, all button
variants, admin-toolbar, toast, etc.) captured side-by-side across the three apps at desktop
(≥1440px) and mobile (390px) widths, the expected result — based on the CSS value-for-value
comparison actually done in phases 2-5 — is:

- **Pixel-identical**: topbar layout, brand mark, language switcher, primary tabs (aside from
  column count, which is intentionally token-driven per app via `--nav-cols-desktop`), card
  shell, game-card box (background/border/radius/padding), score display, status-badge/chip
  colors and shape, probability-bar colors, ranking-row grid, ranking-position/score typography,
  rules-table, form-grid/input/select, all button variants, admin-toolbar, toast — these all now
  read from the exact same shared CSS file in all three apps, so there is no plausible
  code-level mechanism for them to render differently absent a browser-specific quirk this
  audit can't see.
- **Visibly different, on purpose** (documented divergences, not migration gaps): CDB2026's
  two-leg confronto-card (ida/volta rows) vs Copa/BR2026's single-row game-card; each app's
  `.sticky-submit` alignment (`center` in BR2026/CDB2026 vs `flex-end` in Copa — flagged, not
  resolved, in phases 3-4); each app's desktop tab count (6/7/6).

## Steps for Eduardo to capture real evidence

1. `cd` to the repo root, run `python3 -m http.server 8080`.
2. Open each app in a real browser: `http://localhost:8080/bolao/copa2026/`,
   `http://localhost:8080/bolao/br2026/`, `http://localhost:8080/bolao/cdb2026/`.
3. For each of: topbar (desktop + mobile width), primary tabs, a ranking row, a game/confronto
   card, the rules table, the entry form, and the admin login card — screenshot the same
   component in all three apps at the same viewport width (desktop ≥1440px and mobile 390px are
   the two widths this repo's other visual tooling already uses, e.g.
   `docs/bolao/evidence/visual-comparison/`).
4. Compare side by side. Anything that looks different and isn't one of the documented
   divergences above is a real finding — file it the same way the phase 2-5 CHANGELOG entries
   did (component, property, apps affected, root cause).
5. If Chrome DevTools MCP / claude-in-chrome becomes available in a future session (connect a
   browser via the extension first), re-run this exercise with Claude driving the browser
   directly and update `COMPONENT_AUDIT.md`'s `CAPTURE_FAILED` rows to real `EQUAL`/`DIVERGENT`
   classifications from actual computed-style/screenshot evidence.
