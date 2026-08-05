# Component audit — Copa canonical visual framework, phase 7 (real capture)

Classification of the 28 canonical components (per
`docs/bolao/CANONICAL_VISUAL_COMPONENT_CATALOG.md`, phase 1) across the three bolão apps, after
phases 2-5 migrated all three onto `bolao/shared/css/` and phase 7 verified the result with a
real browser (Playwright + real Chrome-for-Testing binary, headless) instead of source-only
comparison.

**Method**: every row's classification is now backed by real evidence, not source reading alone:

- **Computed-style verdict** — `getComputedStyle()` comparison across all three apps via
  `bolao/scripts/audit_visual_consistency.mjs` (real Chromium), for `fontFamily`, `fontSize`,
  `fontWeight`, `lineHeight`, `letterSpacing`, `color`, `backgroundColor`, `border`,
  `borderRadius`, `padding`, `margin`, `gap`, `height`, `minHeight`, `gridTemplateColumns` (as
  applicable per component). Full property-by-property results:
  `docs/bolao/evidence/canonical-framework/audit_visual_consistency.md`.
- **Screenshot verdict** — real PNG captures via `bolao/cdb2026/scripts/visual/
  capture_evidence.mjs`/`capture_admin_auth_evidence.mjs`, composited into Copa-first
  side-by-side montages via `bolao/scripts/make_visual_comparison_montages.mjs`:
  `docs/bolao/evidence/canonical-framework/montages/`.

Legend: **EQUAL** = identical computed style, no per-app override, confirmed via real
`getComputedStyle()`. **VARIANT_APPROVED** = per-app difference that is documented, intentional,
and confirmed to only affect non-token properties (layout/structure), not typography/color/
spacing/shape. **DIVERGENT** = unexplained difference found. **MISSING** = component doesn't
exist in that app. **N/A** = screen genuinely inaccessible by product design (see `README.md`'s
table), not a capture failure.

| # | Component | Copa | BR2026 | CDB2026 | Real classification |
|---|---|---|---|---|---|
| 1 | app-shell | shared reset.css/shell.css | same | same | EQUAL (screenshots + computed style confirm) |
| 2 | topbar | shared navigation.css | same | same + local iOS overflow fix (non-token) | EQUAL typography/color/spacing/shape (computed-style: fontFamily/Size/Weight/lineHeight/padding/margin/gap/borderRadius/backgroundColor/color all EQUAL); height differs (108.5px Copa/BR2026 vs 118.5px CDB2026 at 1280×900) — JUSTIFIED, caused by nav/brand/switcher wrap count at that exact width, not a token, per ALLOWLIST.json |
| 3 | brand | shared navigation.css | same | same | EQUAL |
| 4 | support-button (whatsapp-btn) | shared navigation.css | same | same | EQUAL (screenshot-confirmed, all three montages show identical pill/color/icon) |
| 5 | language-switcher (lang-links) | shared navigation.css | same | same | EQUAL |
| 6 | tournament-switcher (bolao-switcher) | shared navigation.css | same | same | EQUAL |
| 7 | primary-tabs (.nav) | `--nav-cols-desktop:6` | `--nav-cols-desktop:7` | `--nav-cols-desktop:6` | EQUAL on every typography/color/spacing/shape property (fontFamily/Size/Weight/lineHeight/padding/margin/gap/borderRadius/backgroundColor/color/height ALL EQUAL, confirmed by computed style); only `gridTemplateColumns` differs, VARIANT_APPROVED (BR2026 genuinely has 7 real tabs vs 6) |
| 8 | page-container (`main`) | shared shell.css | same | same + local iOS overflow fix (non-token) | EQUAL (max-width/margin/padding confirmed identical; `height` differs only because total page content differs per app — JUSTIFIED, not a token, per ALLOWLIST.json) |
| 9 | section-heading | shared shell.css | same | same | EQUAL |
| 10 | card | shared shell.css | same | same | EQUAL |
| 11 | game-card (box) | shared components.css | same box + local flex layout | `.confronto-card` = `.card` + local padding/radius/margin override | EQUAL on fontFamily/Size/Weight/lineHeight/padding/margin/borderRadius/backgroundColor/color (confirmed via real computed-style diff, zero unexplained mismatch); `gap`/`height` differ, VARIANT_APPROVED (BR2026's internal flex layout; CDB2026's genuinely different ida/volta component, CONSISTENCY_MATRIX item 72) |
| 12 | game-row / game-teams | own class names per app (documented, not renamed) | own class names | own class names | VARIANT_APPROVED — screenshots confirm visually consistent typography/color/spacing across all three despite different class names; structure genuinely differs by tournament format |
| 13 | team-name | shared `.team`/`.game-team` | own `.match-team-name` | own `.leg-teams` | VARIANT_APPROVED by screenshot + declared-value inspection (not by a shared reference — see "known gap" below, unchanged from phase 6) |
| 14 | score | shared `.game-score` | own `.game-score-live`/`.game-score-final` | own inline score inputs | VARIANT_APPROVED (same as #13) |
| 15 | status-badge | shared `.status-chip` | own `.game-status` | own `.game-status` | EQUAL on fontFamily/Size/Weight/lineHeight/padding/margin/borderRadius/backgroundColor/color, confirmed via real computed-style diff for the "encerrado"/post state (zero unexplained mismatch); `gap`/`height`/`minHeight` differ, JUSTIFIED (Copa's `.status-chip` has no `display` set, BR2026/CDB2026's `.game-status` does — same rendered outcome via two CSS mechanisms, per ALLOWLIST.json) |
| 16 | probability-bar | shared `min-width:32px` (fixed this phase, was 6px) | shared (local override removed, now redundant) | shared (local override removed, now redundant) | FIXED — was DIVERGENT (32px vs 6px), promoted 32px to canonical after empirically confirming 6px clips the percentage label all three apps render. Now EQUAL by shared reference, not just matching values. |
| 17 | ranking-row | shared components.css | same + local `.rank-pos` movement addition | same + local `.rank-pos` movement addition | EQUAL base; VARIANT_APPROVED addition (movement-arrow stacking, no Copa equivalent) |
| 18 | ranking-position | shared `.rank-pos` | same | same | EQUAL |
| 19 | ranking-score | shared `.points` | same | same | EQUAL |
| 20 | rules-table | shared components.css | same + local `th`/extra-column additions | same + local `th` additions | EQUAL on shared `td` rule; VARIANT_APPROVED additions (extra tournament-specific columns) |
| 21 | form-grid | shared forms.css | same | same | EQUAL (confirmed post-fixture-fix: `gridTemplateColumns` now resolves to the identical `527px 527px` in all three, was showing CDB2026 as unresolved `repeat(2, minmax(0px,1fr))` before the fixture-date fix because the marked element wasn't in the live DOM) |
| 22 | input / select | shared forms.css | same | same | EQUAL (confirmed post-fixture-fix: `height`/`minHeight` now resolve to real pixel values identically across all three, was showing CDB2026 as `auto`/unresolved before the fixture-date fix, same root cause as #21) |
| 23 | button (primary) | shared forms.css | same | same | EQUAL (confirmed post-fixture-fix, same root cause as #21/#22) |
| 24 | button-secondary | shared forms.css | same | same | EQUAL |
| 25 | button-danger | shared forms.css | same | same | EQUAL |
| 26 | admin-toolbar | shared admin.css | same | same | EQUAL (confirmed via real authenticated-admin screenshots, `capture_admin_auth_evidence.mjs`) |
| 27 | admin-card | reuses shared `.card` (Copa: `admin-entry-full` variant) | own `.admin-row` (dense variant) | own `.admin-row` (dense variant) | VARIANT_APPROVED — two FORMALIZED design-system variants (`admin-entry-full`/`admin-entry-dense`, `docs/bolao/DESIGN_SYSTEM.md`), confirmed via computed style: fontFamily/fontWeight/color EQUAL across both variants; fontSize/lineHeight/padding/margin/gap/borderRadius/backgroundColor differ by variant, not by drift (Copa's own OTHER `.card` instances also use the full-variant tokens consistently — this isn't a one-off) |
| 28 | toast | shared components.css | same | same | EQUAL |

## Genuinely N/A (not CAPTURE_FAILED) — see README.md for full explanation

- **Copa**: Palpites, Regras, Admin (login + authenticated) — `CONFIG.archived` hides these nav
  buttons for real visitors (tournament concluded, archived by product decision).
- **BR2026**: Palpites — entries permanently closed 2026-07-16.

No other component/screen combination in this table is unverified. Zero `CAPTURE_FAILED` rows
remain from phase 6.

## Known gaps still open (documented technical debt, not silently ignored)

- **team-name/score (#13/#14) "VARIANT_APPROVED by inspection"**: BR2026/CDB2026 keep their own
  JS-generated class names for these two components (documented in phases 3-4 as a deliberate
  choice to avoid touching `.js`). This audit's "values match" claim for these two specific rows
  is a screenshot + declared-value comparison, not a shared CSS reference — if the shared token
  changes in the future, these hand-copied duplicates could silently drift with no
  `check_shared_visual_contract.mjs` gate to catch it (that script's protected-selector list
  doesn't include these app-specific class names). Real, acknowledged debt — reclassified with
  a category in `docs/bolao/CONSISTENCY_MATRIX.md`'s phase 7 entry (INCONSISTÊNCIA DE
  FRAMEWORK), not swept under "structural difference."
