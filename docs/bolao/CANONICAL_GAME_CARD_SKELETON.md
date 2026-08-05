# Canonical `game-card` DOM skeleton (phase 7-FIX)

Eduardo's real finding: the phase 2-7 migration made Copa/BR2026/CDB2026's game cards share CSS
*values* (font-family, colors, padding, radius — verified via `getComputedStyle`, all EQUAL) but
NOT the same DOM *structure* — three different element trees happened to produce matching
property values in isolation, which is not the same as being the same component. This doc
records the real comparison the canonical skeleton below was built from.

## What each app actually rendered before this fix

**Copa** (`renderGames()`, `bolao/copa2026/js/app.js`):
```
.game-card
  .game-top        → match badge, phase/group text, status-chip        (header row)
  .game-meta       → date pill, time pill, venue pill                  (metadata row)
  .game-teams      → team-name+flag | score-or-"×" | flag+team-name    (3-col grid)
  (live extras: goal scorers, live plays, probability bars)
```

**BR2026** (`renderGamesSection()`, `bolao/br2026/js/app.js`):
```
.game-card
  .game-matchup    → team-name+logo | scoreOrTime | logo+team-name     (3-col grid)
  .game-meta       → ONE joined string: status + match-number + venue  ("·"-separated)
  (probability bar, if pre-match)
```
Real deltas vs Copa: **no separate header row at all** — status lives inside the merged
`.game-meta` string, not as its own badge in its own row. Date lives OUTSIDE the card entirely
(a page-level `.game-date-header` grouping multiple cards). Time is embedded inside the
score-or-time slot, not a `.game-meta` pill.

**CDB2026** (`renderGamesSection()`, `bolao/cdb2026/js/app.js`, `.confronto-card`):
```
.confronto-card
  .confronto-header → tie-level team names + logos ("Time A ⚽ × ⚽ Time B")
  .confronto-legs
    .leg (× 1 or 2)
      .leg-label     → "IDA"/"VOLTA" text
      .leg-teams     → ONE inline span: name+logo × logo+name (compressed, not a grid)
      .leg-info      → ONE joined string: venue + score-or-date + status-chip
    .leg.confronto-result → aggregate line (ida+volta apps only)
```
Real deltas vs Copa: team names/scores/metadata are **not a 3-column grid at all** — `.leg-teams`
is one inline text run, and `.leg-info` merges three different kinds of information (place, score/
date, status) into one string the same way BR2026 does, compounding the same problem.

## The canonical skeleton (this fix)

Modeled on Copa's real current visual order (header → metadata → match → extension), since Copa
is the platform's golden master (`CLAUDE.md`) — not reordered to match either of the other two:

```html
<div class="game-card" data-state="pre|in|post|postponed">
  <div class="game-card__header">
    <span class="game-card__competition">…match/round label…</span>
    <span class="game-card__status">…status badge…</span>
  </div>
  <div class="game-card__metadata">
    <span class="game-card__date">…</span>
    <span class="game-card__time">…</span>
    <span class="game-card__venue">…</span>
  </div>
  <div class="game-card__match">
    <div class="game-card__team game-card__team--home">
      <span class="game-card__team-name">…</span>
      <span class="game-card__logo">…</span>
    </div>
    <div class="game-card__center">
      <span class="game-card__score">…score, or a time/placeholder in that same slot…</span>
    </div>
    <div class="game-card__team game-card__team--away">
      <span class="game-card__logo">…</span>
      <span class="game-card__team-name">…</span>
    </div>
  </div>
  <div class="game-card__extension">…optional: probability bar, aggregate line, live extras…</div>
</div>
```

Rules that apply to every app using this skeleton:
- Metadata is always three SEPARATE elements (date, time, venue) — never merged into one string.
- Status is always in `__header`, never folded into `__metadata` or `__match`.
- The score/time slot is always `__center` → `__score`, whatever its actual content (a number
  pair, a kickoff time, or a placeholder) — never a differently-classed element per state.
- Team name typography, score typography/color/background/radius/padding, and metadata font-size
  are the same shared tokens for every app — no per-tournament variance.
- Optional per-app content (BR2026's probability bar, CDB2026's aggregate/ida-volta line) only
  ever lives inside `__extension` — it must not restructure `__header`/`__metadata`/`__match`.

## CDB2026's two-leg case

CDB2026's real tournament format (ida/volta in several phases, per
`docs/bolao/CDB2026_RULES_AND_MODEL.md`) is a genuine structural difference Copa/BR2026 don't
have — not something to flatten away. The fix: a `tie-group` wrapper (tie-level header + two
`game-card` elements using the exact skeleton above, `game-card--first-leg`/`--second-leg`
variant classes only affecting which leg's data is shown, never the shared skeleton itself).

## Migration status

Tracked incrementally, app by app, each step verified (`node --check`, `audit_scoring.py`,
CDB2026-specific scripts where relevant) and committed separately before moving to the next app —
see `docs/bolao/CONSISTENCY_MATRIX.md`'s phase 7-FIX entry for the running log of which app/
component has been migrated as of any given commit.
