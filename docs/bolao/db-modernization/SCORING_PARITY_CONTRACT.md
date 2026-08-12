# SCORING_PARITY CONTRACT

**Batch H, extended in Batch I.** Status: **WIRED AND EXACT FOR ALL THREE COMPETITIONS.**
M0 remains `PREPARED_NOT_EXECUTED`. Production writes: 0.

| Artefact | Role |
|---|---|
| `scripts/db/scoring_parity_producer.py` | invokes the canonical engines; compares; emits evidence. Contains **no scoring arithmetic**. |
| `scripts/db/scoring_scenarios.mjs` | 29 scenarios, each emitted in both representations |
| `scripts/db/scoring_parity_bridge.mjs` | WS7 → WS6 → normalized rows → adapter → producer; exit-status safe |
| `scripts/db/test_scoring_parity_gate.mjs` | 86 tests, 719 assertions, **23 mutants** |

---

## 1. What was actually there, and what it means

`audit_scoring.py` is **not a data-driven scorer**. It is a *static self-audit* of the scoring
implementation, and it takes no input data at all. So it could never have been "fed both
representations": that framing does not match the program.

The real division:

| Competition | Scoring engine | Ranking | Its audit proves |
|---|---|---|---|
| copa2026 | `send_result_email.py` — `score_entry_total`, `exact_match_count`, `podium_hits` | `compute_final_payouts` | 6 checks over that engine |
| br2026 | **`audit_scoring.py` itself** — `score_entry` lives in the audit | `send_round_email.rank_entries` | 5 checks |
| cdb2026 | `send_result_email.py` → its own `audit_scoring.score_entry` | `compute_final_payouts` | 5 checks |

So the audit is used here for what it is: a **precondition**. It must pass before any parity result is
believed, because two representations agreeing through a broken engine proves only that they are wrong
in the same way. `br2026` has no `send_result_email.py` at all.

**The producer contains no points table, no tiebreak comparison and no threshold.** It imports the
engines and calls them. A static guard (STEP 25) scans every DB-modernization tool for a scoring
formula and fires on an injected points table while ignoring a legitimate engine call.

---

## 2. The round trip

```
legacy scenario ──► app-native state (hand-built) ─────────────────┐
                                                                   ├─► SAME canonical engine ─► compare
legacy document ──► WS7 transformers ──► WS6 backfill ──► rows ──► adapter ─┘
                    (transformPredictions,   (SQLite, with the
                     transformMatchResults)   UNIQUE indexes M7 creates)
```

The two states reach the engine by genuinely different paths: one is built directly from the scenario,
the other is reconstructed from the rows the transformers wrote. Ranking comes from the engine's own
`compute_final_payouts` / `rank_entries` — including the sort, the tie grouping and the prize split —
so no ordering logic is reimplemented either.

`compute_final_payouts` identifies entries by **display name**, not id. That is kept rather than worked
around: it means a name lost in transformation surfaces as a ranking difference.

---

## 3. Results

| Competition | Scenarios | Result |
|---|---|---|
| **copa2026** | 12 | **PASS_EXACT** ×12 |
| **br2026** | 8 | **PASS_EXACT** ×8 |
| **cdb2026** | 9 | **PASS_EXACT** ×9 |

Plus 12 randomised property scenarios (constrained to inputs the engine accepts): all exact.

Zero tolerance. A one-point difference is `FAIL_SCORE`.

---

## 4. BATCH-H-F1 — CLOSED in Batch I

br2026 scores against the final **league classification**: G4 and Z4 are *ordered lists of clubs*, SA6
is a *set of clubs*. The target model had no entity able to hold that, and every existing candidate
failed for a concrete reason — `match_results` requires goals, `ranking_snapshots` is keyed on
`pool_entry_id` (a *participant*, not a club), `ties`/`matches` are knockout pairings.

**Two entities now model it explicitly (`DDL-M11`):**

| Entity | Grain |
|---|---|
| `classification_snapshots` | one retrieved classification per edition — the envelope |
| `competition_edition_standings` | one club's line in one snapshot |

Two entities rather than one because the data genuinely has two grains: provider, `generated_at`,
`payload_hash` and staleness describe the *retrieval*, while `position` and `points` describe a *club*.
Folding them together would repeat the envelope across twenty rows and let one snapshot disagree with
itself about when it was taken.

**Zone membership is NOT stored.** `G4 = 1–4`, `SA6 = 7–12`, `Z4 = 17–20` are pure **position slices**,
identical in `send_round_email.py:448-450` and `app.js:629-631`, with `audit_scoring.py` naming
"positions 7-12" for SA6 in a comment on `SA6_HIT`. Storing `is_g4`/`is_z4`/`is_sa6` would be a second
source of truth for a boundary that `position` already determines — the same refusal this model applies
to settlement. The boundaries live in exactly one place, `BR2026_ZONES` in `transformers.mjs`, used by
both the transformer and the adapter.

**`position` IS stored, and that is deliberate.** The ordering is
`provider_rank ASC, goal_difference DESC, goals_for DESC, club_name ASC` — and the app's own comment
records that this tiebreak is *the app's* logic, not the provider's, added because an ESPN rank tie
could *"errar a fronteira entre zonas"* (audit finding, 2026-07-14). Materialising the resolved position
means no reader re-derives it, and **`UNIQUE (classification_snapshot_id, position)` turns that 2026
audit finding into a constraint the database enforces.** An unresolved tie now fails the import instead
of quietly moving a relegation boundary.

### No supersession pointer

A correction needs none. The authoritative classification is the **latest non-stale snapshot** for the
edition, and `(competition_edition_id, provider, generated_at)` is unique — so a corrected import is
simply a later row and ordering resolves it. An earlier draft copied `match_results`' `superseded_by_id`
pattern, which would have required an `UPDATE` and therefore **contradicted the table being
append-only**. `match_results` needs its flag because several results for one match can legitimately
coexist; a classification has exactly one latest.

### Finality

There is no `is_final` column, because the evidence has none: the app calls its table *"classificação
provisória"* and the persisted snapshot carries `stale`/`staleReason` but no finality flag. Whether the
latest classification is *final* is a property of the **edition**, not the row —
`competition_editions.edition_status = 'concluded'`. Inventing a row-level flag would have created a
second source of truth for something the edition already states.

### Source of truth

`sync_espn.py` fetches the ESPN standings server-side and persists
`bolao/br2026/data/espn-standings-normalized.json`. The browser reads that snapshot; it never
establishes standings. `importClassificationSnapshot` is the only write path, `trusted_runtime` only —
`anon` and `authenticated` have no `INSERT` at all. A **stale** snapshot is stored as evidence of a
failed fetch and can never become authoritative, so one transient provider failure cannot become truth.

## 5. Fail-closed

`SCORING_PARITY` fails on: a missing site checkout, a missing engine, an audit failure, an adapter
crash, a producer crash, a timeout, an unknown competition, an empty scenario set, a refused backfill,
a missing representation on either side, and **a run that covers only some competitions**.

> A scoring audit that did not run is never a scoring audit that passed.

An **empty comparison is not a pass**: zero scenarios exits non-zero. A run may declare its `scope`,
and then the all-three requirement applies to exactly what it claimed to check — which keeps a scoped
run honest instead of letting it look like a full one.

### Exit status cannot be masked

The producer is invoked with `execFileSync`, never a shell pipeline. Status is read from the process,
not from text. If the producer exits non-zero, the bridge reports a mismatch **even when the JSON looks
clean** — a producer that crashed after writing a partial file must not be able to present itself as a
pass. A test asserts no pipe into `tail`/`grep`/`awk`/`sed` exists in the scoring path.

The subprocess environment is stripped of `PG*`, `SUPABASE*`, `EMAILJS*` and `DATABASE_URL`. A test
imports all three engines with those removed and asserts none performs I/O at import time. **Zero
production connections.**

---

## 6. Three defects this gate found

**The adapter was guessing the phase.** It inferred a tie's phase from its id
(`id.includes("final") ? "final" : "semi"`). `semi` is not one of the engine's nine real phases
(`fase-1`…`fase-5`, `oitavas`, `quartas`, `semifinal`, `final`), so `_all_ties` skipped the tie and
**five points vanished with no error anywhere**. The adapter now READS the phase from the `ties` rows —
`ties.competition_edition_phase_id` — and **throws** when a tie has no row. An adapter must read the
mapping or fail, never guess it.

**A scenario was passing vacuously.** cdb2026's tie carried `qualifiedTeamId: "Alpha"` and
`teamHomeId`/`teamAwayId`. The engine reads `teamA`/`teamB` and a qualified side of `"A"` or `"B"`, so
*both* representations derived the same wrong podium and parity passed while measuring nothing. The
most dangerous kind of green.

**Two source scans matched my own prose.** The pipe check fired on the docstring *explaining* the pipe
hazard; the snapshot check fired on the sentence explaining why `ranking_snapshots` cannot hold a club
standing. Fixed structurally — comments and string literals are stripped before scanning — not by
allowlisting.

---

## 7. Mutants (13), all changing the REPRESENTATION and never the engine

wrong prediction · wrong match id · wrong result · missing prediction · **duplicate prediction** ·
missing result · null pick turned into 0-0 · wrong advancing side · **wrong phase** · wrong qualified
side · superseded result chosen · lost entry name · lost paid flag.

If a mutant could only be caught by editing scoring logic, the gate would be testing the wrong thing.

**The duplicate-prediction mutant fails at LOAD time**, refused by
`predictions(pool_entry_id, subject_id)` UNIQUE — the index Batch G restored after finding the
generator had been dropping every unique index. Arbitrarily picking one of two predictions would decide
a score by row order, so the correct place to fail is before scoring, and the normalized side is simply
not built.

**Vacuity proven for all four dimensions**: score, tie behaviour (with totals equal), ranking, and rule
semantics.

---

## 8. Corrected results and the snapshot contract

**STEP 16.** The authoritative result is selected by `is_official = 1 AND superseded_by_id IS NULL` —
the model's own definition of current. A superseded 9-9 row is ignored, and a scenario carrying one
still reaches exact parity. Selecting the newest row, or the first, would make a corrected result a
coin flip.

**STEP 15.** `ranking_snapshots` is **derived evidence, never a scoring authority.** The scoring path
never reads it — asserted by a source scan of both the bridge and the producer. Ranking is always
recomputed by the engine, so a corrupted snapshot cannot change a score; it can only *disagree* with
one, and `normalized_result_hash` is what makes that disagreement detectable.

---

## 9. WS5 integration

`SCORING_PARITY: { checked, mismatches }` flows into `choreography.evaluateParity` and
`evaluatePromotion`, and into the integrated pipeline as an eleventh stage.

Proven by negative fixtures:

- a scoring mismatch of **one** yields verdict `ABORT`, not merely fail;
- **clean financial and aggregate parity cannot override it** — the promotion returns `ROLLBACK` at
  `ABORT` severity;
- a result with `checked: 0` is **vacuous** and holds rather than passing.

---

## 10. M7 / M10 readiness — still PARTIAL, on evidence

| Phase | Tables | `PARITY_READY` |
|---|---|---|
| M5 | payments, payment_allocations, prize_allocations | **READY** |
| M7 | match_results, predictions | **READY** |
| M10 | ranking_snapshots | **READY** |
| DDL-M11 | classification_snapshots, competition_edition_standings | **READY** |

`SCORING_PARITY_COVERAGE` in `migration_drift.mjs` derives this from the producer's actual coverage, and
`test_scoring_parity_gate.mjs` asserts the constant matches a **real producer run** — so claiming a
competition is proven while the gate reports otherwise fails the suite. No matrix was hand-edited.

The rule stays load-bearing: **a single blocked competition holds every scoring-critical phase at
PARTIAL**, because a score is only as trustworthy as the least-proven representation feeding it.

---

## 11. Evidence format

Per scenario: `competition`, `scenario_id`, `legacy_audit_status`, `normalized_audit_status`,
`legacy_result_hash`, `normalized_result_hash`, `score_parity`, `ranking_parity`, `rule_parity`,
`overall_status`, `detail`.

Statuses: `PASS_EXACT` · `FAIL_SCORE` · `FAIL_RANKING` · `FAIL_TIE_BEHAVIOR` · `FAIL_RULE_SEMANTICS` ·
`INVALID_INPUT` · `MODEL_GAP` · `AUDIT_FAILED` · `ENGINE_MISSING` · `PRODUCER_ERROR`.

Comparison order is deliberate — **score → tie → ranking → rule** — because a score difference explains
a ranking difference, and reporting the ranking would bury the cause. Tie components (exact counts,
podium hits, per-match detail) are compared **even when totals are equal**: a divergence there changes
rank order without changing a single total, which a totals-only check cannot see.

No PII: identifiers are synthetic entry ids and invented names, asserted by a test.

---

## 12. Recorded, not blocking

`BATCH-G-OP-1` two numbering schemes both called M1–M10 · `BATCH-G-OP-2` `payment_kind.adjustment` sign
semantics · `BATCH-G-OP-3` money-row actor `SET NULL` vs audit retention · `BATCH-G-OP-4` `matches`
lacks `row_version`/`updated_at`.

**`BATCH-H-OP-1` — RESOLVED_MODEL_EXTENDED.** The league classification is modelled (`DDL-M11`),
br2026 reaches `PASS_EXACT`, and M7/M10 are `READY`.

### Two defects Batch I's mutants found

**The adapter was scoring against the wrong season.** `adaptBr` selected the latest non-stale snapshot
in the store *regardless of edition*, so a 2025 table would have been scored against 2026 predictions —
silently, with every constraint satisfied. Found by `MUT-CLASS-WRONG-EDITION`; the adapter is now scoped
to the edition and refuses to borrow another's table, because having no table is a state the engine
already models and borrowing one is not.

**A fixture was internally inconsistent.** The provider-rank-tie scenario set `gd` without adjusting
`gf`/`ga`, and the transformer refused the row — correctly, since a source that contradicts itself about
goal difference is not trustworthy and preferring one field would be a guess.
