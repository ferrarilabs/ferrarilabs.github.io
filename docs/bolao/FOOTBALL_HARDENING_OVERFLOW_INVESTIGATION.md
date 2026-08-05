# Overflow Violations — Investigated and Fixed (section 7 follow-up)

Found by `bolao/cdb2026/scripts/visual/check_manifest.mjs` after checkpoint H's real Playwright
run. Investigated properly (real bounding-box measurements via `page.evaluate` +
`getBoundingClientRect()`), root-caused, and fixed — not allowlisted.

## Violation 1 & 2 (same root cause)

- **App**: CDB2026 (shared CSS in `bolao/shared/css/`, so the same fix applies to BR2026/Copa2026
  wherever they render the same component).
- **Route**: `/bolao/cdb2026/` → "Jogos" section, default (unseeded) load — i.e. real production
  data (`Palmeiras`, `Chapecoense`, `Internacional`, `Athletico-PR`, `Vasco`, `Mirassol`), not
  a synthetic fixture. **This affects real usage, which is why it was fixed rather than
  allowlisted.**
- **Viewports**: 320x568 and 375x667 (both listed as violations in the manifest; 390x844+ never
  affected).
- **Selector**: `.game-card__team-name` (specifically the away-team name inside
  `.game-card__team.game-card__team--away`, within a `.game-card.game-card--second-leg` whose
  `data-state="pre"`).
- **Bounding box (before fix, 320px viewport, "Palmeiras")**: `left: 314, right: 385, width: 71`
  — the span started at x=314, six pixels from the 320px viewport edge, and extended to 385:
  **65px past the viewport**.
- **Root cause**: `.game-card__center` is `display: contents`, so `.game-card__score.muted`
  (holding the pre-match date string, e.g. `"16:30 (EDT) · qui., 01/08, 17:30 BRT"` from
  `fmtDate()` in `legCardHtml()`) becomes a direct child of the `.game-card__match` grid
  (`grid-template-columns: 1fr auto 1fr`). The `auto` track sizes to that span's max-content
  (single-line) width — a ~40-character date string with no `white-space`/`max-width`
  constraint — forcing the auto column far wider than a 320px card can hold, which pushes the
  away-team column (and its team-name span) off the right edge. **Not** a team-name wrapping
  failure — the team-name CSS (`min-width: 0`, `overflow-wrap: break-word`) was already correct;
  it simply never had room, because the center column consumed it.
- **Real-world impact**: real. Any CDB2026 tie whose second leg is scheduled-but-not-yet-played,
  viewed on a phone at 320-375px width (iPhone SE class and similar), had its away-team name
  pushed off-screen. Confirmed via `getBoundingClientRect()` on the actual page, not assumed from
  a screenshot.
- **Fix**: `bolao/shared/css/responsive.css`, inside the existing `@media (max-width: 500px)`
  block — added `white-space: normal; max-width: 92px; line-height: 1.25; text-align: center;`
  to `.game-score.muted, .game-card__score.muted`, letting the date string wrap onto multiple
  lines within a capped width instead of forcing one unbroken line that inflates the grid's
  `auto` track.
- **Screenshot**: re-captured at `docs/bolao/evidence/visual/cdb2026/cdb2026_games_320x568.png`
  and `..._375x667.png` after the fix (see checkpoint's visual harness rerun).

## Residual overflow found after the primary fix, also fixed

After the date-string fix, two team names (`Chapecoense`, `Internacional`) still overflowed at
320px by **7-8px** (down from 37-91px before) — `right: 328`/`327` against a 320px viewport.
**Root cause**: `overflow-wrap: break-word` only forces a mid-word break when no other wrap
opportunity exists, and can still leave the final fragment a few pixels wider than its column
for a long, unhyphenated single word. **Fix**: added `hyphens: auto` to
`.game-team .team-name, .game-card__team-name` in the same media-query block — `<html
lang="pt-BR">` is already set (confirmed), so the browser's Portuguese hyphenation dictionary
applies, giving the browser a real hyphenation point instead of relying on break-word alone.

## Verification

Re-ran the real Playwright measurement script (not the full harness alone) directly against
`getBoundingClientRect()` for every element wider than its viewport, at both 320x568 and
375x667, before and after each fix:

| Stage | 320px offenders | 375px offenders |
|---|---|---|
| Before any fix | 6 (Vasco, Palmeiras, Mirassol, Chapecoense, Internacional, Athletico-PR) | 6 (same set) |
| After date-string fix | 2 (Chapecoense, Internacional, 7-8px over) | 0 |
| After hyphenation fix | **0** | **0** |

Then reran the full cross-app harness (`capture_evidence.mjs`, 112 records) and its validator
(`check_manifest.mjs`): **`✓ ALL CHECKS PASSED — manifest is internally consistent, no
failed/inconsistent records`**, exit 0. Zero unjustified violations remain.
