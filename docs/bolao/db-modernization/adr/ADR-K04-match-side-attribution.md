# ADR-K04 — `home_team` / `away_team` are the fixture's first- and second-listed sides

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F017 (M6 matches) · Governs: `transformMatches` in `scripts/db/transformers.mjs`

## Decision

`transformMatches` emits `home_team` and `away_team`, resolved by match id from a fixture index passed
in through `ctx.fixtures` — the same channel competitions, editions, phases and pools already arrive
on. `teamA` maps to `home_team` and `teamB` to `away_team`, **positionally**. A match whose sides
cannot be resolved, or which resolves to only one side, is reported as `MATCH_SIDES_UNRESOLVED` and
**excluded**; it is never given a placeholder.

## The problem, as measured

`bolao.matches.home_team` and `away_team` are both NOT NULL with no default, and `transformMatches`
emitted neither. Every match record it produced was unloadable, which is why Workstream B scoped the
money spine to M2–M5 and left M6 out.

Proven against the real column rather than read off the schema — KPLUS-F015 and KPLUS-F016 were both
found only when real data met a real column, and both looked correct on paper
(`f017_matches_evidence.mjs`, all inserts rolled back, nothing written):

- the columns `bolao.matches` requires with no default are
  `{competition_edition_phase_id, home_team, away_team}`; the transformer emitted
  `{competition_edition_phase_id, leg, match_id, status, tie_id}` for **95 real matches**. Unmet:
  `{home_team, away_team}`.
- a real transformed record offered to the real table was **refused — `not_null_violation` on
  `home_team`**. The negative control, the identical row with both sides supplied, was **accepted**, so
  the refusal is specifically the missing attribution and not a row malformed some other way.

## Why this is not invention

The team attribution was never missing; it was never in `bolao_state`. It is **reference data**, of the
same class DDL-M3 already describes for competitions and editions: "hand-authored rows, never derived
from `bolao_state`, which has no competition entity at all." Each app's `js/data.js` carries
`teamA`/`teamB` keyed by the same match id the state's `results` object is keyed by.

Measured coverage: **95 of 95** match ids the real legacy state references resolve against
copa2026's 104 declared fixtures. `br2026` and `cdb2026` have no `results` object at all, so they
contribute zero matches and there is nothing to attribute. The mapping is therefore deterministic and
total over the real data — nothing is guessed, and the evidence hierarchy is satisfied at level 2
(application config actually used by that edition).

## The one semantic question, and how it is answered

The fixture list says `teamA` / `teamB`; the target says `home_team` / `away_team`. Those name the
same two positions, but "home" ordinarily asserts a hosting relationship — and a World Cup is played
at neutral grounds, which the fixture list's own `venue` field makes plain (a Netherlands–Morocco
fixture in Monterrey).

The mapping is therefore declared **positional and not a hosting claim**: `home_team` is the
first-listed side, `away_team` the second. That is the only reading consistent with the rest of the
data — the same fixture rows carry `goalsA`/`goalsB` in that order and a prediction is stored as
`predicted_goals_home` / `predicted_goals_away`. **Inverting the pair would invert every stored
score**, silently, everywhere. The order is load-bearing and is asserted by a test that fails if it is
swapped.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Placeholder sides (`"TBD"`, `""`) to satisfy NOT NULL | A match row naming a team nobody played is worse than an absent one: predictions are scored against these names. |
| Make the columns nullable | The model requires both, and a match without two sides is not a match. Weakening a constraint to fit a transformer is the failure mode the charter forbids. |
| Have the transformer read `js/data.js` | Reference data enters through `ctx` for every other domain. A transformer that reads the filesystem cannot be tested on a fixture and couples the migration to an app's layout. |
| Infer sides from `results` values | The values are goals, not identities. Nothing to infer from. |
| Rename the columns to `side_a` / `side_b` | A schema change to avoid a naming discomfort, touching the model, the reports and the RLS drafts. The ADR records the meaning instead, at no migration cost. |

## What changed

- `scripts/db/transformers.mjs` — `transformMatches` builds a fixture index from `ctx.fixtures`,
  attaches both sides on both paths (supplied fixture list and derivation from result keys), and fails
  closed with `MATCH_SIDES_UNRESOLVED`.
- `scripts/db/test_transformers.mjs` — 5 tests.

No scoring rule, bracket, report or bolão app is touched. Nothing is written to any database: M6 is
still not authorised to load.

## Tests that prove it

`test_transformers.mjs` (81 passed): both sides are taken from the declaring fixture; the mapping is
positional and the order is asserted explicitly; an unresolvable match is excluded and reported; a
half-attributed fixture (one side only) is refused rather than filled in; and every emitted record
carries a value for each column `bolao.matches` declares NOT NULL.

Proven non-vacuous by mutation: swapping `teamA`/`teamB` fails two tests by name, and replacing the
both-sides-or-nothing rule with a `"TBD"` placeholder fails the half-attribution test. Gates 44/44
across 32 suites; the three `audit_scoring.py` all pass — scoring untouched.

## How to reverse it

Revert the commit. Nothing is persisted by this change, so there is no data to restore. If the
positional reading is later judged wrong, the correction is a data fix over `bolao.matches` plus the
matching inversion of every prediction — which is precisely why the order is asserted by a test now
rather than discovered later.

## What remains before M6 can load

The fixture index has no producer yet: `b_real_source.mjs` builds `ctx` without `fixtures`, so the
real backfill would currently exclude all 95 matches and say so. Supplying the index from each app's
declared fixture list — as reference data, alongside `competitions`, `editions`, `phases` and `pools`
— is the remaining step, queued as `F017-M6`. That is mechanical; this ADR settles the semantics it
depends on.

---

## ADDENDUM (KPLUS-F043) — the positional rule is single-leg only

**Status:** ACCEPTED · added 2026-08-10 · Class: GREEN (a defect fix preserving the app's own semantics)

### What this ADR got right, and where it stopped

The decision above — `teamA` → `home_team`, `teamB` → `away_team`, positionally, *"not a claim about who
hosted"* — is correct for the World Cup and correct for the reason given: a World Cup is played at
neutral grounds, the fixture list's own venues say so, and what the mapping preserves is the ORDER that
`goalsA`/`goalsB` and `predicted_goals_home`/`predicted_goals_away` already share.

It was decided on one tournament shape and stated without a scope. That is the gap this addendum closes.

### The shape it does not cover

Copa do Brasil 2026 is a two-leg knockout. There, `teamA`/`teamB` **is** a hosting assertion, and it
inverts between the legs. The app states it in code and calls the signal unambiguous:

```js
home = leg === "second" ? tie.teamB : tie.teamA
// "ida e volta têm mandantes sempre invertidos entre si por definição de mata-mata"
```

`cdb2026/js/data.js` says the same in prose where it declares the drawn ties: *"teamA = manda o jogo de
ida; teamB = manda o jogo de volta (decisivo)"*.

Applying this ADR's rule unchanged to a second leg puts the wrong club in `home_team` for **every**
decisive leg of every tie. It does not fail — it stores a well-formed match with its sides swapped, and
scoring reads it happily.

### The rule, restated with its scope

| Fixture form | Rule |
|---|---|
| explicit `home_team` / `away_team` | authoritative; never re-derived, never inverted |
| positional `teamA` / `teamB`, single match or first leg | `teamA` hosts (this ADR's original decision) |
| positional `teamA` / `teamB`, **second leg** | `teamB` hosts — the tie's hosts invert |

`SECOND_LEG` accepts `2`, `"2"`, `"second"` and `"volta"`, because the leg reaches the transformer from
more than one producer and rejecting a spelling would fail closed on a correct fixture.

### Why the fix was not one line

The fixture index collapsed both forms as it was built — `home: f.home_team ?? f.teamA` — so by the time
side assignment ran, every fixture looked as if it had named its host explicitly. The leg rule could
never have fired even once written. The index now preserves which form the fixture used, and that
distinction is the thing the rule turns on.

### Evidence

- `home = leg === "second" ? tie.teamB : tie.teamA` — `bolao/cdb2026/js/app.js`, with the comment
  calling the signal unambiguous. Tier-2: application code actually used by that edition.
- `bolao/cdb2026/js/data.js` `knownConfrontos` — *"teamA = manda o jogo de ida; teamB = manda o jogo de
  volta (decisivo)"*.
- `test_transformers.mjs`: first leg keeps `teamA` home; second leg inverts; a single-leg fixture with
  leg `null`/`1`/`"first"` is untouched; an explicit host survives a second leg; and an anti-vacuity case
  that fails against the pre-fix mapping.
- The 95 real copa2026 matches still transform, load and reconcile both ways — `F017-M6` 17/17.

### How to reverse it

Restore the unconditional `{ home: teamA, away: teamB }` in `sidesOf` and re-collapse the index. Doing so
returns the World Cup to identical behaviour and restores the second-leg inversion defect for every
two-leg tournament. The three leg tests fail immediately.
