# ADR-K09 — the cross-row invariants, as deferred constraint triggers

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F020, KPLUS-D01 (second half) · Found on the way: KPLUS-F034 (lab vacuity), KPLUS-F035
Explicitly NOT resolved: KPLUS-D01 (first half) — see "What this does not decide"
Governs: `bolao.check_snapshot_completeness()`, `bolao.check_prize_pool_solvency()` and their four
constraint triggers, in `scripts/db/generate_migration_drafts.mjs`

## Decision

Three invariants that no single-row control can hold are enforced by **`DEFERRABLE INITIALLY DEFERRED`
constraint triggers**, checked at COMMIT:

1. **Position contiguity** — a classification snapshot's standings occupy the contiguous range 1..N.
2. **`club_count` accuracy** — the declared count equals the standing rows that actually exist.
3. **Prize solvency, per currency** — a pool's declared prize gross may not exceed what its entries
   collected in allocated payments.

Four triggers, attached to every table that can break an invariant — which is not the same as every
table an invariant is about:

| Table | Events | Why those |
|---|---|---|
| `classification_snapshots` | INSERT, UPDATE | the count is declared here |
| `competition_edition_standings` | INSERT, UPDATE, **DELETE** | removing a row is how a gap appears |
| `prize_allocations` | INSERT, UPDATE | the declaration |
| `payment_allocations` | **UPDATE, DELETE only** | an INSERT can only *raise* what a pool collected, so firing on it would cost a check that can never fail |

## Why deferred, and why that is not a detail

`positions are contiguous 1..N` is **false after the first of twenty rows**. A CHECK sees one row and
cannot express it at all; an immediate trigger would reject the legitimate load at row one.

This is measured rather than argued. F020-4a runs the identical, correct 20-club transaction under
`SET CONSTRAINTS ALL IMMEDIATE` and it fails at the first statement:

> `classification snapshot … declares club_count=20 but holds 0 standing row(s)`

and F020-3c runs the same transaction deferred and it commits. The deferral is what makes the control
possible, not a tuning choice.

## Why in the database at all

`importClassificationSnapshot` already states contiguity as an invariant, and `recordPrize` already
states `SUM(gross) <= collected`. Workstream N put all three to the real server with the contract out of
the call path and **the database accepted every one**. A rule that lives only in the importer is a rule a
psql session, a repair script or a future service does not have. This is the KPLUS-F019 pattern
(ADR-K03) applied to the next three invariants.

## The decisions inside this one

**1. Contiguity, checked how?** *Chosen:* one aggregate — `count(*)`, `count(DISTINCT position)`,
`max(position)`. The existing `position > 0` CHECK forces every value positive, so N distinct positive
values with maximum N can only be exactly 1..N. *Alternative:* a window function walking the ordered
sequence looking for a step. Rejected as more code for the same answer, and it reads as if insertion
order matters — F020-3d proves it does not by committing positions in the order 3, 1, 4, 2.

**2. Solvency, on one total or per currency?** *Chosen:* per currency, via `FULL JOIN`. Summing
`gross_amount` across currencies compares two numbers that are not amounts of anything. F020-6d measures
the difference: a 4.00 **BRL** prize against a 5.00 **USD** collection is refused, where a single mixed
total would have compared 4 against 5 and passed — declaring a payout in a currency the pool never
collected. The `FULL JOIN` is load-bearing too: an inner join would make a currency declared but never
collected *vanish from the comparison*, which is exactly the insolvent case.

**3. What happens when the snapshot itself is deleted?** *Chosen:* the control returns early when the
snapshot row is gone — there is nothing left to be consistent with, and raising there would refuse a
legitimate teardown rather than catch a corruption (F020-5b).

**4. One check per row, or deduplicated?** *Chosen:* one per row, un-deduplicated. `CREATE CONSTRAINT
TRIGGER` is `FOR EACH ROW` by definition, so a 20-club snapshot runs the same aggregate twenty times at
commit. Measured: **238ms for 500 rows**, 25x the worst real league table. *Alternative:* a
transaction-local memo skipping snapshots already validated. Rejected — it adds state whose failure mode
is silently **skipping** a check, which is a worse thing to be wrong about than 238ms.

## The consequence an operator has to know about (KPLUS-F035)

**Two statements can no longer tear down a snapshot.** `DELETE FROM competition_edition_standings;` then
`DELETE FROM classification_snapshots;` passes through exactly the state the control refuses — a snapshot
whose `club_count` no longer matches its rows — and fails at the first COMMIT. It must be one
transaction.

This was found by the control refusing the Workstream N lab's own teardown, and it applies to any repair
or cleanup script touching these two tables, not just to that lab. It is correct behaviour and it is a
real change to how these tables are operated, which is why it is written down here rather than
rediscovered at 2am.

**And the fixture that was wrong.** The same N lab created a snapshot in one autocommitted statement and
added standings one statement at a time. `importClassificationSnapshot`'s steps put both inside one
`BEGIN..COMMIT`; the old shape was only possible *because nothing enforced the rule*. The fixture was
corrected to match the contract. The control finding a violator in the campaign's own harness on first
contact is the most direct evidence available that it does something.

## The KPLUS-OP-4(a) consequence, stated plainly

All 46 real payments carry `amount IS NULL` — they are legacy assertions that someone paid, not records
of how much — so `payment_allocations` is empty and **every pool reads as having collected nothing**. The
solvency control therefore refuses *every* prize declaration today.

That is fail-closed and correct: a payout declared against an unknown pot is precisely the unrecoverable
case `recordPrize` names. It also makes the KPLUS-OP-4(a) dependency **structural** rather than
documentary — the same RED that stops 12 of 17 reports now also stops prize declaration, in the database,
with an error message that names it. No new blocker is created: the runtime contract computes the same
sum and would refuse identically.

## KPLUS-F034 — the lab's own vacuity, caught before it was believed

Four of the solvency probes built their state and then `ROLLBACK`ed. **A deferred constraint fires at
COMMIT**, so the check never ran: F020-6b *passed* without the control executing, and 6c/6d/6e "failed"
for the same reason and would have been read as defects in the DDL. Fixed by ending each probe
`SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`, which forces the pending checks to run without committing.

A second lab defect in the same session: the "re-measure the finding first" section assumed a target that
had never had the triggers, so it proved the finding exactly once and failed on every re-run. It now
DROPS the controls, measures, and restores — the before/after is real on every run. **A lab that passes
once is not a regression test.** Fifth and sixth instances of the KPLUS-F024 pattern.

## What this does not decide

**KPLUS-D01, first half — whether a prize rank may be split across two entries.** `write_contracts.json`
says ranks are distinct; `target_model.json`'s unique index is `(pool_id, rank, pool_entry_id)` with the
stated rationale that a rank *may* be split. Both cannot be the rule. That is a prize-distribution rule,
and `DECISION_POLICY.md` puts a scoring/prize rule outside what this campaign may decide. The database
continues to implement the model's reading, unchanged, and no prize rows exist. Untouched deliberately.

## Evidence

| Claim | Where |
|---|---|
| Both violations reproduce on the real server with the controls removed | F020-1a/1b |
| Two functions + four triggers apply; catalog agrees they are deferrable and initially deferred | F020-2a/2b |
| The gap and the overstated count are refused | F020-3a/3b |
| **A legitimate 20-club snapshot still COMMITS** | F020-3c |
| Positions inserted out of order are accepted — the rule is about the set | F020-3d |
| **The same load fails under SET CONSTRAINTS ALL IMMEDIATE** | F020-4a |
| Deleting the middle standing is refused; deleting the whole snapshot is accepted | F020-5a/5b |
| A declaration against a pool that collected nothing is refused | F020-6a |
| **A covered declaration is accepted** — the rule is not "refuse everything" | F020-6b |
| One cent over is refused; the boundary is exact | F020-6c |
| A BRL prize is not covered by a USD collection | F020-6d |
| Reducing an allocation under a declared prize is refused | F020-6e |
| 500 rows commit in 238ms | F020-7a |
| Dropping the trigger makes the violation acceptable again | F020-8a/8b |
| All four controls armed on exit; money spine untouched; no structural trace | F020-9a–9d |
| N14 and N15 now report **DATABASE**, not CONTRACT_ONLY | `n_write_contract_pg` 16/16 |

Fingerprints: `fingerprints/F020_cross_row_invariants.json` (23/23, idempotent across consecutive runs),
`fingerprints/N_write_contract_pg.json` (**16/16**, was 13/16). Repo: `scripts/gates.mjs` 45/45 over 33
suites; `test_migration_drafts.mjs` 98 tests including omission tests for each new rule. Target
re-verified: a15 0 unexplained differences, `c_catalog_fidelity` 524 comparisons 0 defects. Regression:
B 29/29, F023 12/12, F029 22/22, O 8/8; the three `audit_scoring.py` pass.

## How to reverse it

`DROP TRIGGER` the four, and `DROP FUNCTION` the two. The tables return to accepting every violation —
F020-8a is that reversal, performed and measured. Nothing else depends on them, and no data written
under them becomes invalid. The N lab's transactional teardown and contract-shaped fixture should stay
regardless: both were wrong before the controls existed, and the controls only made them visible.
