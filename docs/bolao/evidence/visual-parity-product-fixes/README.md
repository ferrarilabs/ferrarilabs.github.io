# Visual parity product fixes (proposal only — NOT MERGED)

This branch documents proposed *product* visual fixes found by the forensic audit
(`forensic-visual-audit-v2`), kept separate from the harness per governance ("não misture o
harness com os fixes de produto"). Nothing here is merged or deployed. Every item needs
Eduardo's explicit authorization plus before/after evidence before it ships.

## 1. team-name token (real, confirmed values)

- Copa (golden master): 18px / weight 800 / line-height 27px.
- BR2026: 13px / weight 700 / line-height 19.5px.
- CDB2026: 14px / weight 700 / line-height 21px.

(The earlier draft executive summary reported BR2026 as 15px/400 — wrong; corrected here to
the values actually measured against the real computed styles.)

Proposed fix: introduce a shared `--team-name-font-size/-weight/-line-height` CSS custom
property set to Copa's values in each app's `css/styles.css`, applied to
`.match-team-name`/`.team-name`. Not applied in this commit — proposal only.

## 2. score token + primitive

Copa shows the score large/bold in a pill (`.game-score-live`/`.game-score-final`); BR2026
renders it smaller/transparent; CDB2026 smaller still and secondary-styled (`<b>` inline, no
pill). Root cause: three independently-evolved score components, no shared primitive.
Proposed fix: a `.score-pill` primitive component in a shared stylesheet fragment, each app
opting in. Not applied — proposal only.

## 3. Ranking row variants

Row height, grid-template-columns, position-column width, action-button placement, and
metadata density differ across the three apps' `.rank-row`. Root cause: each app's ranking
grew its own columns (BR2026/CDB2026 added "Ver palpites" inline; Copa's is archived/frozen).
Proposed fix: formalize 2 variants — `--ranking-active` (BR2026/CDB2026, with actions) and
`--ranking-archived` (Copa, static) — sharing row height/grid math, diverging only on the
actions column. Not applied — proposal only.

## 4. Game card base primitive

Card width, internal `display`/`gap`, alignment, date/status placement differ, partly because
CDB2026's ida/volta ties are a structurally different unit than Copa/BR2026's single match.
Proposed fix: a `.game-card-base` primitive (padding, border-radius, shadow tokens) that
Copa/BR2026's single-match card and CDB2026's multi-leg confronto-card both extend, without
forcing CDB2026's extra ida/volta/agregado layer into the base. Not applied — proposal only.

## 5. Status/date primitive

`round-date-header` (BR2026's per-day group header) and `game-date`/`game-time` (Copa/CDB2026
per-card) are semantically different components that should never have been diffed against
each other (see forensic report methodology note, part 7). Proposed fix: two separate
primitives, `.round-date-header` and `.game-date-chip`, so future audits compare like with
like. Not applied — proposal only.

## Status

All five items above are findings + proposals only. No CSS/JS changes are included in this
commit. Applying any of them requires: a scoped patch per item, a before/after screenshot
pair per affected app, confirmation the change doesn't alter tournament-specific logic, and
Eduardo's explicit sign-off — per governance, this branch is never auto-merged.
