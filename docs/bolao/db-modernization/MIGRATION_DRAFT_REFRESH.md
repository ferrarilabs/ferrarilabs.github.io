# MIGRATION DRAFT REFRESH — M1–M10 against the validated target model

**Batch G.** Status: **DRAFTS REFRESHED, NOTHING APPLIED.** M0 remains `PREPARED_NOT_EXECUTED`.
Production writes: 0. Production migrations: 0.

| Artefact | Role |
|---|---|
| `scripts/db/migration_drift.mjs` | source-of-truth map, independent SQL parser, fourteen drift comparators, hazard scan, traceability, readiness |
| `scripts/db/test_migration_drift.mjs` | 89 tests, 798 assertions, **46 mutants** |
| `scripts/db/generate_migration_drafts.mjs` | the generator — three defects fixed here |
| `model/target_model.json` | ten index removals, one enum correction |
| `docs/.../migration-drafts/M*.draft.sql` | regenerated; all ten still carry the not-for-production banner |

---

## 0. The premise was wrong, and that mattered

The batch brief said the drafts predate WS10/WS11 and the model refinements. They do not: the drafts
are **generated** from `model/target_model.json`, and regenerating them before any change produced
**byte-identical files**. There was no generator-level staleness to fix.

The drift was one level up — between the **model** and the decisions WS9/WS10/WS11 reached after it
was written. That distinction is the whole finding: *a generated artefact is exactly as current as its
generator's input, so an out-of-date model produces confidently out-of-date SQL, and regenerating it
proves nothing.*

---

## 1. The three generator defects, which silently weakened the schema

The drafts contained **52 index statements, zero `CREATE UNIQUE INDEX`, and zero `WHERE` clauses.**

**The emitter never read `idx.unique`.** Every unique index in the model was emitted as a plain
non-unique index. The controls lost that way are not cosmetic:

| Index | What it enforces | Where it is relied on |
|---|---|---|
| `payments(external_reference)` UNIQUE | double-recording a payment reference is impossible | WS13 idempotency |
| `predictions(pool_entry_id, match_id)` UNIQUE | two concurrent submissions for one (entry, match) cannot both win | WS13 `submitPrediction`; a failure here is a **scoring** error |
| `payment_allocations(payment_id, pool_entry_id)` UNIQUE | one payment cannot be applied twice to one entry | WS9 `DUPLICATE_ALLOCATION` |
| `match_results(match_id)` UNIQUE `WHERE is_official` | one official result per match | GATE-RESULT's single-authority rule |
| `outbox_events(idempotency_key)` UNIQUE | one notification per event | outbox delivery idempotency |
| `participant_identity_links(merged_participant_id)` UNIQUE `WHERE reverted_at IS NULL` | an identity cannot be merged twice | WS8 |

Every WS13 test of these properties passes — against the JS reference store, which declares its own
`UNIQUE_INDEXES`. **None of them was testing this DDL.** That is the gap: the controls were verified in
a simulation of the database, not in the database the migration would build.

**The emitter read `idx.where`; the model declares `idx.partial`.** A one-word key mismatch turned
every partial index into a full one. The generated comment still said *"partial because email is
nullable and redacted rows must not block reuse"* — a file asserting a property its own SQL did not
have, which is worse than silence.

**Index names were derived from columns alone, so collisions were swallowed by `IF NOT EXISTS`.**
`match_results` declared a partial-unique and a plain index on `match_id`; `pool_entries` declared a
plain and a partial index on `pool_id`. Each pair generated one name, so one index of each pair was
silently never created while the file appeared to create both.

**After the fix: 19 unique indexes, 16 partial predicates, no duplicate names.**

---

## 2. Model corrections

### Ten indexes removed (52 → 42)

| Removed | Why |
|---|---|
| `pool_entries(pool_id)` | duplicate of the partial on the same column; the partial `WHERE deleted_at IS NULL` is the one worth keeping, since every report filters it |
| `pool_entries(participant_id)` | leading subset of the unique `(participant_id, pool_id, entry_label)` — a unique index is a btree and serves prefix lookups |
| `payment_allocations(payment_id)` | leading subset of the unique `(payment_id, pool_entry_id)`; WS11's IX-04 requirement is satisfied by that composite |
| `prize_allocations(pool_id)` | leading subset of the unique `(pool_id, rank, pool_entry_id)` |
| `outbox_delivery_attempts(outbox_event_id)` | leading subset of the unique `(outbox_event_id, attempt_number)` |
| `ranking_snapshots(pool_id, computed_at, position)` | WS11 IX-14 prefix overlap; `position` adds a third column to every insert to avoid a sort over tens of rows |
| `payments(paid_at)` | **WS11 IX-07 DEFER** — R-05 has no date *filter*, only an ORDER BY. Write cost inside the money-bearing transaction for no read benefit |
| `audit_events(actor_user_id)` | **WS11 IX-18 DEFER** — R-GAP-1 is open, so the column is mostly NULL, on the most write-heavy table, for a query no report issues |
| `pools(competition_edition_id)` | **WS11 IX-22 DEFER** — single-digit reference rows; competitions are never deleted, so the FK-check argument does not apply |

No index survives merely because an older draft had it. Every deferral records what would change the
decision.

### One enum corrected

`bolao.settlement_status` gained **`unknown`**. Its own `why` declares that it mirrors
`financial.mjs`'s `SETTLEMENT`, which gained that value in WS9. An enum missing a value the code can
produce is an insert that fails at runtime; here it would have been the state meaning *the expected fee
was never recorded*, which the platform is explicit must never be reported as `unpaid`.

`bolao.payment_kind` retains **`adjustment`**, which `PAYMENT_KIND` does not implement. Left in place
deliberately — an enum value cannot be dropped once any row uses it — but recorded as unreachable, and
raised as **BATCH-G-OP-2**: it must not be written until its sign rule and reconciliation treatment are
specified. Changing money semantics is not something this batch may do unauthorised.

---

## 3. A WS11 conclusion reversed

**IX-12 `match_results(match_id)` was classified REDUNDANT "with the primary key". That was wrong.**

The target model gives `match_results` a **surrogate** key (`match_result_id`) and models supersession
through `superseded_by_id` and `is_official`, precisely so a corrected result is a new row rather than
an in-place edit. `match_id` is an ordinary foreign key.

The claim came from the SQLite report fixture, which had made `match_id` the `PRIMARY KEY` — a shape
that cannot represent a corrected result at all. **A conclusion drawn from a fixture is only as good as
that fixture's fidelity.** The fixture now matches the model, carries a superseded row so a report
filtering on `is_official` can be distinguished from one that merely happens to be right, and R-12
filters accordingly. IX-12 is `LIKELY_USEFUL`, with the reversal recorded on the candidate itself.

---

## 4. Two numbering schemes, both called "M1–M10"

| Scheme | Source | M8 means | M9 means | M10 means |
|---|---|---|---|---|
| **Draft** | `migration-drafts/M*.draft.sql` | create audit tables | create outbox tables | create `ranking_snapshots` |
| **Phase plan** | `model/migration_phases.json` | backfill entries | backfill asserted payments | backfill results, audit, sync |

The draft scheme is **DDL only** and contains no backfill phase at all. The phase plan interleaves DDL
and backfill across M0–M17.

So an instruction like *"M8/M9 must match the canonical audit and outbox model"* is meaningful only in
the draft scheme. Read against the phase plan it is a category error, and **an operator following the
wrong one would apply a backfill where DDL was intended.**

Not resolved by renaming, because renaming either scheme invalidates the WS5 choreography, the
readiness matrix, the ordering invariants and every commit message citing a phase. Raised as
**BATCH-G-OP-1**. Every cross-reference in `migration_drift.mjs` states which scheme it means.

---

## 5. What was NOT proven, and why

**There is no local PostgreSQL server.** libpq ships `initdb` and `pg_ctl` but no `postgres` binary,
and there is no container runtime. The draft sequence was never applied to an empty database.

Worse, and worth recording: **a bare `pg_isready` in this environment resolves to the production
pooler** from the ambient configuration. Any `psql` invoked here without an explicit target would hit
production, so no libpq client is used by this tooling at all.

What replaces it — **the model round-trip (STEP 20)**: the drafts are parsed by an *independent*
parser, not the generator that wrote them, and the resulting schema is diffed back against the model.
A test asserts neither module imports the other, so the round-trip cannot be a tautology.

**Round-trip result: 0 diffs.**

That proves the files say what the model says. It does **not** prove:

- that PostgreSQL parses the DDL;
- that constraint validation succeeds;
- that any index builds;
- that the report prototypes' monetary column names match the drafted schema (§6).

---

## 6. The declared representation difference

SQLite has two numeric types, `INTEGER` and `REAL`, and `REAL` is a float. Storing money as `REAL` in
the fixtures used to verify **financial** reports would break the platform's hardest financial rule
inside the test meant to protect it. So the fixture uses integer minor units (`*_minor`) where the
model uses `numeric(14,2)`.

This is declared, not normalised away, and it has a cost stated plainly:

> **The 17 report prototypes are proven against the fixture, not against the drafted schema.** Their
> joins, grain, filters and arithmetic are verified. Their literal monetary column names are not.

The mapping is checked **total**: a `_minor` name with no entry is still an ERROR, every target must
exist in the drafted schema, and every target must be an exact numeric — so a rename in the model
breaks the check rather than quietly widening it.

It also records its own fidelity loss: the fixture's single `amount_minor` maps to three differently
named model columns (`amount`, `allocated_amount`, `gross_amount`), and `prize_allocations.net_amount`
has no fixture column at all — **no report prototype exercises the gross/net distinction.**

---

## 7. Findings by class

| Class | Count | Content |
|---|---|---|
| **ERROR** | **0** | — |
| REVIEW_REQUIRED | 6 | 3 × actor `SET NULL`, 1 × `payment_kind` unreachable value, 1 × `matches` has no concurrency column, 1 × WS11 IX-12 reconciliation note |
| EXPECTED_PHASE_DIFFERENCE | 24 | the declared money-name mapping across the report prototypes |
| DEFERRED | 0 | all three WS11 deferrals actioned |
| FALSE_POSITIVE | 3 | prefix-served index, and two hazard dispositions |

### The six review items

**Actor `SET NULL` on `payments.created_by`, `payment_allocations.allocated_by`,
`participant_identity_links.reverted_by`** — a deliberate tradeoff, recorded as one. `RESTRICT` would
make an auth user undeletable forever, conflicting with erasure. `SET NULL` keeps the financial row and
loses only the actor pointer; attribution survives in `audit_events.actor_user_id`, whose retention is
governed separately. **The risk: if audit retention is ever shortened, this becomes unattributable
money.**

**`matches` has no `row_version` or `updated_at`** while `adminCorrection` may change
`matches.status`. WS13's optimistic concurrency compares a version or a before-state fingerprint; with
neither, two concurrent corrections cannot be distinguished and the second silently overwrites the
first.

---

## 8. Traceability and readiness

**21 objects, 0 orphans.** Every created table traces: model → migration phase → WS6 backfill domain →
WS7 transformer → parity producer → cutover gate → RLS coverage → write contracts → report consumers →
rollback class.

| Phase | Tables | Blocked on |
|---|---|---|
| M1 | (enum types only) | — |
| M2 | participants, participant_identity_links | — |
| M3 | competitions, competition_editions | — |
| M4 | pools, pool_fee_schedule, pool_entries | — |
| M5 | payments, payment_allocations, prize_allocations | — |
| M6 | competition_edition_phases, ties, matches, sync_state | — |
| M7 | match_results, predictions | `PARITY_READY = PARTIAL` |
| M8 | audit_events, audit_event_details | — |
| M9 | outbox_events, outbox_delivery_attempts | — |
| M10 | ranking_snapshots | `PARITY_READY = PARTIAL` |

No phase is `BLOCKED` on schema, constraints, enums, RLS, ordering or write contracts. M7 and M10 are
`PARTIAL` on parity for one honest reason: **`SCORING_PARITY` still has no producer.** It must come
from the three apps' own `audit_scoring.py` over both representations, never from a SQL
reimplementation, and that remains the last unwired promotion gate.

---

## 9. Vacuity

**46 mutants**, each a deliberate defect that a named comparator must catch: wrong column name, missing
index, wrong FK, wrong enum, wrong nullability, money float, missing constraint, wrong `ON DELETE`,
stale report dependency, missing WS13 field, plus 36 more.

Three of those mutants exist because the detector was **already broken when written**:

- the **nullability** check never fired for any of the 211 columns. The model marks nullable columns
  with `nullable: true` and says nothing for `NOT NULL`, so `nullable === false` was never true. It
  reported a clean sweep across the entire schema.
- the **FK-target** check destructured a three-part path as four, reading the *column* as the table, so
  every foreign key reported a wrong target.
- the **partial-predicate** recovery matched across statement boundaries and attached a postcheck's
  `WHERE NOT i.indisvalid AND ...` to nine indexes — asserting predicates the files never claimed.

One mutant was itself wrong and had to be corrected: it mutated `payments.currency` to nullable, which
the model already permits (a legacy asserted payment has neither amount nor currency), so it proved
nothing. It now mutates `kind`.

Every hazard the committed drafts raise is **dispositioned** — a hazard with no disposition is an
unreviewed hazard.

---

## 10. Open operator decisions

| Id | Decision |
|---|---|
| **BATCH-G-OP-1** | Whether to rename one of the two M-numbering schemes. Renaming invalidates every existing cross-reference; not renaming leaves a label that means two different things. |
| **BATCH-G-OP-2** | `bolao.payment_kind.adjustment` — specify its sign rule and reconciliation treatment, or accept it as permanently unreachable. It must not be written until then. |
| **BATCH-G-OP-3** | Actor `SET NULL` on money-bearing rows: accept the tradeoff, or add a durable actor snapshot so attribution survives independently of audit retention. |
| **BATCH-G-OP-4** | Add `row_version` or `updated_at` to `matches` so `adminCorrection` has something to compare, or narrow the correction allowlist to exclude `matches.status`. |
