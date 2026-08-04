# Classification of commit `5a9dad4` (already merged to `origin/main`)

Commit `5a9dad4a4d048defd4a8cec52ac497b078645a74` — "fix(cdb2026): anchor live-monitoring
deadline to kickoff, backfill volta leg kickoff/venue" — audited against its parent with
`git diff 5a9dad4^ 5a9dad4`. Per-change classification below; narrative context and the
proposed (unauthorized, unapplied) minimal patch are in
`docs/bolao/governance/BREAK_GLASS_PRODUCTION_RUNBOOK.md`.

Files touched: `bolao/cdb2026/js/app.js`, `bolao/cdb2026/js/config.js`,
`bolao/cdb2026/scripts/send_result_email.py`, `bolao/copa2026/scripts/send_result_email.py`,
plus both apps' `CHANGELOG.md`.

## Change-by-change classification (`bolao/cdb2026/js/app.js`)

| # | Change | Classification | Notes |
|---|---|---|---|
| 1 | `sendResultEmail.py` deadline anchored to kickoff (`config.js`, `send_result_email.py` both apps) | **HOTFIX INTENCIONAL** | Matches commit message exactly; scoring untouched, `audit_scoring.py` re-run per commit message. |
| 2 | `autoSyncEspn()` volta-leg kickoff/venue backfill block (~34 new lines, `save-leg` mutation) | **HOTFIX INTENCIONAL** | Matches commit message ("backfill volta leg kickoff/venue"); schedule-only, explicitly never touches `goalsHome`/`goalsAway`/`status`/`qualifiedTeamId`. |
| 3 | `teamLogoImg(team, cls, visualRole)` — new 3rd param, conditionally appends `data-visual-role="..."` attribute to `<img>` | **MARKER DATA-\* INERTE** | Attribute-only; no change to tag structure, classes, or whitespace. No layout impact. |
| 4 | `data-visual-role="ranking-row"` / `"ranking-position"` / `"ranking-name"` / `"ranking-points"` / `"ranking-detail"` on existing ranking elements | **MARKER DATA-\* INERTE** | Attributes added to pre-existing elements; no new elements, no whitespace/text change inside them. |
| 5 | `data-visual-role="game-stage"` on `<h3 class="games-round-header">` | **MARKER DATA-\* INERTE** | Attribute only. |
| 6 | `scoreOrDate` non-live branch: `esc(fmtDate(...))` (bare text) → `` `<span data-visual-role="game-date">${esc(fmtDate(...))}</span>` `` | **WRAPPER DOM NÃO RELACIONADO** | This is a genuine new element, not an inert attribute — it wraps previously-bare text in a `<span>`. Checked for layout impact: `span` is inline with no CSS rule targeting `[data-visual-role="game-date"]` or a bare `.leg-info > span` selector in `bolao/cdb2026/css/*`, so it does not introduce new box-model participants (no margin/padding/display change) and screenshots of `.leg-info` are pixel-identical before/after in this branch's regenerated evidence for `cdb2026_*_game-date.png`. Classified as unrelated-but-verified-harmless, not auto-classified as inert, per the task instruction that new wrappers must not be assumed inert. |
| 7 | `data-visual-role="game-score"` on the two `<b>` score branches | **MARKER DATA-\* INERTE** | Attribute on pre-existing `<b>`, no structural change. |
| 8 | `data-visual-role="game-status"` on `<span class="game-status ...">` | **MARKER DATA-\* INERTE** | Attribute only. |
| 9 | `leg-teams` inner markup: `${esc(home)} ${logo} × ${logo} ${esc(away)}` (bare text + two inline logos) → nested `<span data-visual-role="home-team"><span class="team-name" data-visual-role="team-name">...</span> ${logo}</span> × <span data-visual-role="away-team">${logo} <span class="team-name" data-visual-role="team-name">...</span></span>` | **MUDANÇA ACIDENTAL** | **Not inert.** This is a real DOM restructuring: two new wrapper `<span>`s per leg (`home-team`, `away-team`) plus two new `<span class="team-name">` elements — the `class="team-name"` is itself new (didn't exist pre-hotfix) and is a real styling hook, not just an audit marker, so any CSS rule written against `.team-name` after this commit changes rendering for real users regardless of the `data-visual-role` attribute riding along with it. This is genuinely unrelated to the commit's stated purpose (kickoff-anchoring / volta backfill) and was not mentioned in the commit message. It is the one item in this commit that must not be waved through as "just a marker." Not reverted here (would require touching `main`, out of scope for this branch); see the runbook's proposed minimal patch. |
| 10 | `data-visual-role="game-card"` on `.confronto-card` | **MARKER DATA-\* INERTE** | Attribute only. |

## Summary

- 7 of 10 changes: inert `data-*` markers, correctly out of scope for a hotfix revert.
- 2 of 10 changes: the stated hotfix itself (kickoff-anchored deadline, volta backfill) — legitimate.
- 1 of 10 changes (`leg-teams` restructuring, item 9): genuine unrelated DOM change bundled
  into a hotfix commit without being mentioned in the commit message. This is the item that
  matters — flagged as **MUDANÇA ACIDENTAL**, not silently reclassified as a harmless marker.

No scoring logic was touched by any of these ten changes. `audit_scoring.py` was re-run as
part of this branch's own regression pass (see part 15 in the task report) and passes.
