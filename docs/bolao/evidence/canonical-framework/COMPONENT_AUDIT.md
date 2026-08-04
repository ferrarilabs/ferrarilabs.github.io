# Component audit — Copa canonical visual framework, phase 6

Classification of the 28 canonical components (per
`docs/bolao/CANONICAL_VISUAL_COMPONENT_CATALOG.md`, phase 1) across the three bolão apps, after
phases 2-5 migrated all three onto `bolao/shared/css/`.

**Method and honesty note**: every row below has two independent verdicts:

- **Source classification** — determined by actually reading the CSS source (not guessed):
  does each app's markup/CSS reference the exact same shared rule for this component, a
  documented variant, or does it diverge/not exist? This was verified by reading every relevant
  file during phases 2-5 and again in this phase.
- **Rendered verification** — whether the component was confirmed to look the same/different in
  an actual rendered browser. **No browser or screenshot tool was available in this session**
  (`mcp__claude-in-chrome__list_connected_browsers` returned empty; the repo's own
  `bolao/scripts/audit_visual_consistency.mjs` Playwright harness has no `playwright` package
  installed here) — see `README.md` in this same folder for the full explanation and capture
  steps for Eduardo. Every row's rendered verdict is honestly `CAPTURE_FAILED`, not a guessed
  `EQUAL`.

Legend: **EQUAL** = identical shared rule, no per-app override. **VARIANT_APPROVED** = per-app
difference that is documented and intentional (tournament-specific or a formally tracked token
override). **DIVERGENT** = unexplained difference found, not yet resolved/approved. **MISSING** =
component doesn't exist in that app. **CAPTURE_FAILED** = could not be verified without tooling
this session doesn't have.

| # | Component | Copa | BR2026 | CDB2026 | Source classification | Rendered verification |
|---|---|---|---|---|---|---|
| 1 | app-shell | shared reset.css/shell.css | same | same | EQUAL | CAPTURE_FAILED |
| 2 | topbar | shared navigation.css | same | same + local `width`/`overflow-x`/`overflow-y` (iOS side-scroll fix, non-protected properties) | VARIANT_APPROVED (CDB2026 addition documented phase 4) | CAPTURE_FAILED |
| 3 | brand | shared navigation.css | same | same | EQUAL | CAPTURE_FAILED |
| 4 | support-button (whatsapp-btn) | shared navigation.css | same | same | EQUAL | CAPTURE_FAILED |
| 5 | language-switcher (lang-links) | shared navigation.css | same | same | EQUAL | CAPTURE_FAILED |
| 6 | tournament-switcher (bolao-switcher) | shared navigation.css | same | same | EQUAL | CAPTURE_FAILED |
| 7 | primary-tabs (.nav) | shared navigation.css/responsive.css, `--nav-cols-desktop:6` (default) | same shared rule, `--nav-cols-desktop:7` (7 tabs incl. "Tabela") | same shared rule, `--nav-cols-desktop:6` (explicit) + local `nth-child(3n+1)` mobile-orphan override (no hidden nav siblings, unlike Copa/BR2026) | VARIANT_APPROVED (tab count is a documented per-app token; CDB2026's orphan-formula override documented phase 4) | CAPTURE_FAILED |
| 8 | page-container (`main`) | shared shell.css | same | same + local `overflow-x`/`overflow-y` (iOS fix, non-protected) | VARIANT_APPROVED (CDB2026 addition documented phase 4) | CAPTURE_FAILED |
| 9 | section-heading | shared shell.css | same | same | EQUAL | CAPTURE_FAILED |
| 10 | card | shared shell.css | same | same | EQUAL | CAPTURE_FAILED |
| 11 | game-card (box: bg/border/radius/padding/margin) | shared components.css | same shared box + local `display:flex;flex-direction:column;gap:4px` (BR2026's own internal layout) | `.confronto-card` = `.card` (shared) + local padding/radius/margin override matching the shared game-card box exactly | VARIANT_APPROVED (BR2026 flex addition + CDB2026's two-leg structural difference, both documented phases 3-4) | CAPTURE_FAILED |
| 12 | game-row / game-teams | shared components.css (`.game-teams`/`.game-team`) | own class names (`.game-matchup`/`.match-team`) — deliberately not renamed, see phase 3 note | own class names (`.confronto-legs`/`.leg`/`.leg-label`) — deliberately not renamed, see phase 4 note; genuinely different structure (two legs, not one row) | VARIANT_APPROVED (documented: renaming JS-generated class names was judged not worth the risk for zero visual gain; CDB2026's structure is a real tournament-format difference) | CAPTURE_FAILED |
| 13 | team-name | shared components.css (`.team`/`.game-team` typography) | own `.match-team-name` — same declared font-size/weight values as Copa's, not literally shared | own `.leg-teams` — same declared font-size/weight values as Copa's, not literally shared | VARIANT_APPROVED (values match by inspection, not by shared reference — see "known gap" below) | CAPTURE_FAILED |
| 14 | score | shared components.css `.game-score` | uses own `.game-score-live`/`.game-score-final` (not `.game-score`) with matching hand-copied values | uses `.leg` grid + inline score inputs, not `.game-score` | VARIANT_APPROVED (BR2026/CDB2026 predate this migration's `.game-score` and weren't renamed onto it — same "no `.js` touch" judgment call) | CAPTURE_FAILED |
| 15 | status-badge | shared components.css `.status-chip` | own `.game-status`/`.paid-badge`/`.unpaid-badge` — declared values match `.status-chip`'s by inspection | own `.game-status`/`.paid-badge`/`.unpaid-badge` — same | VARIANT_APPROVED (documented phases 3-4: JS-generated class names kept, values verified to mirror the shared token 1:1) | CAPTURE_FAILED |
| 16 | probability-bar | shared components.css `.prob-bars`/`.prob-bar` | own `.prob-bar` rule, `min-width:32px` vs shared `6px` (real declared difference, not renamed away) | own `.prob-bar` rule, same `min-width:32px` difference | DIVERGENT (kept, not silently fixed — see "known gaps" below; flagged now for the first time in this phase) | CAPTURE_FAILED |
| 17 | ranking-row | shared components.css | same shared rule + local `.rank-pos` movement-arrow stacking addition | same shared rule + same local `.rank-pos` addition | VARIANT_APPROVED (BR2026/CDB2026 additions documented phases 3-4) | CAPTURE_FAILED |
| 18 | ranking-position | shared components.css `.rank-pos` | same | same | EQUAL | CAPTURE_FAILED |
| 19 | ranking-score | shared components.css `.points` | same | same | EQUAL | CAPTURE_FAILED |
| 20 | rules-table | shared components.css | same shared `td`/`td:last-child` rules + local `th`/`margin-bottom`/`.z4-zone` additions (BR2026 has no Copa-equivalent columns) | same shared rules + local `th`/`margin-bottom` additions | VARIANT_APPROVED (BR2026/CDB2026 have extra table columns Copa's rules table doesn't; additions are additive, not redefinitions of the shared `td` rule) | CAPTURE_FAILED |
| 21 | form-grid | shared forms.css | same | same | EQUAL | CAPTURE_FAILED |
| 22 | input / select | shared forms.css | same | same | EQUAL | CAPTURE_FAILED |
| 23 | button (primary, unclassed default) | shared forms.css | same | same | EQUAL | CAPTURE_FAILED |
| 24 | button-secondary | shared forms.css `button.secondary` | same | same | EQUAL | CAPTURE_FAILED |
| 25 | button-danger | shared forms.css `button.danger` | same | same | EQUAL | CAPTURE_FAILED |
| 26 | admin-toolbar | shared admin.css | same | same | EQUAL | CAPTURE_FAILED |
| 27 | admin-card | reuses shared `.card` (no distinct component, per phase 1 catalog) | same | same | EQUAL (all three reuse `.card`, none has a distinct admin-card) | CAPTURE_FAILED |
| 28 | toast | shared components.css | same | same | EQUAL | CAPTURE_FAILED |

## Known gaps this audit surfaced (not fixed here — flagged per governance)

- **`.prob-bar` min-width (#16) is a real, previously-undocumented DIVERGENT**: BR2026 and
  CDB2026 both set `min-width: 32px` on `.prob-bar`, vs the shared/Copa value of `6px`. This
  predates this migration (both apps' probability bars show a percentage label inside the
  segment, which needs more room than Copa's bare color segment) and was carried forward as a
  local override in phases 3-4 without being explicitly called out as DIVERGENT at the time —
  this audit is the first place it's named as such rather than silently treated as "matches
  by inspection." Recommend: either promote to a documented `VARIANT_APPROVED` with a named
  reason (label-width need) in a future small patch, or leave as-is — Eduardo's call, not
  changed in this migration.
- **team-name/score/status-badge "VARIANT_APPROVED by inspection"**: for components where
  BR2026/CDB2026 keep their own JS-generated class names (documented in phases 3-4 as a
  deliberate choice to avoid touching `.js`), this audit's "values match" claim is a source-level
  comparison of the declared CSS values, not a shared reference and not a rendered check. If a
  future change updates the shared token but a maintainer forgets these hand-copied duplicates
  exist, they will silently drift — this is real, documented technical debt, not a false
  EQUAL claim.
