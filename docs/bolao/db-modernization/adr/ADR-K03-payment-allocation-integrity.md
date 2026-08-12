# ADR-K03 — the payment-allocation invariants are enforced by the database, not by the caller

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F019 · Governs: `bolao.check_payment_allocation()` emitted by
`scripts/db/generate_migration_drafts.mjs` into DDL-M1 (function) and DDL-M5 (trigger)

## Decision

A `BEFORE INSERT OR UPDATE` trigger on `bolao.payment_allocations` locks the referenced payment row
with `SELECT … FOR UPDATE` and then enforces, for every writer:

1. the payment carries an amount — a payment with `amount IS NULL` cannot be allocated at all;
2. the payment's amount is positive — a refund, reversal or chargeback is its own payment, not a
   negative allocation of another one;
3. `allocated_amount` is positive;
4. the allocation's currency equals the payment's currency **and** the entry's
   `expected_fee_currency`;
5. the total allocated against the payment, excluding the row being written, plus this row, does not
   exceed the payment's amount.

There is deliberately **no** cap against the entry's `expected_fee_amount`. Exceeding the fee is
`OVERPAID` — a reportable state the settlement model already has a word for — and capping it here
would refuse a real overpayment instead of recording one.

## The problem, as measured

Workstream N attempted each invariant against the real migrated target on PostgreSQL 17.10, in raw
SQL, with the reference contract implementation out of the call path. The server accepted all three
money-bearing violations:

- **Over-allocation.** Two concurrent transactions each allocated `60.00` of the same `100.00`
  payment, neither taking a row lock. Both committed. Recorded total: `120.00` against `100.00`
  received. No error was raised.
- **Cross-currency allocation.** A `BRL` allocation of a `USD` payment, against a `USD` entry, was
  accepted — an exchange rate of 1.0 applied to someone's money and stored as fact.
- **Legacy-asserted payment.** An allocation was accepted against a payment with `amount IS NULL`.
  That is the exact shape the M9 backfill gives every legacy `paid: true` flag: a record that someone
  *said* a person had paid, carrying no amount. Allocating against it manufactures a settled amount
  from an assertion that contains none — which is precisely the question KPLUS-OP-4(a) is unresolved
  about, being decided silently by a write.

`model/write_contracts.json` states all three as invariants of `allocatePayment`, and all three were
implemented — in the JavaScript reference contract, and nowhere else. Every WS13 test of them passes
against the in-memory store, which declares its own indexes and its own locking; none of them was
ever testing this database.

## Why the trigger, and why the lock inside it

**Not a CHECK constraint.** All five rules span rows. A CHECK sees one row of one table and can
answer none of these questions.

**Not a stored `allocated_total` on `payments` with a CHECK against it.** That creates a second
source of truth for money which must be kept correct by the same writes it exists to police. The
model rejects stored settlement state for exactly this reason — DDL-M5's own purpose note says "no
stored settlement column exists by design … a stored flag would be a second source of truth for
money". Adding one for the enforcement mechanism would contradict the model it enforces.

**The lock belongs in the trigger.** The over-allocation above is not a missing check — the contract
has the check. It is a missing *lock* in every writer that is not the contract. `FOR UPDATE` inside
the trigger moves serialisation from something each caller must remember into something no caller can
skip: a psql session, a future service, a well-meant repair script all get it. Workstream N proves
this directly: after the change, the same two lock-less writers are serialised by the trigger's own
lock and the second is refused, without either of them asking to be.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Leave it in the contract layer | Correct only while that file is the sole writer. The migration, the reporting layer, and any operator repair are all writers that are not it. |
| Stored `allocated_total` + CHECK | Second source of truth for money; contradicts DDL-M5's stated design. |
| `SERIALIZABLE` isolation | Serialises requests that do not conflict, still needs the same retry handling, and the contracts' stated stance is READ COMMITTED everywhere. |
| Application-side advisory lock | Same failure as today: only binds callers that take it. |
| Deferred constraint trigger | The invariant would be checked at commit, after other work in the transaction has been done on a state that was never valid; and a deferred check cannot hold a row lock across the window. |

## What changed

- `scripts/db/generate_migration_drafts.mjs`: `PAYMENT_ALLOCATION_DDL` (the function, emitted in
  DDL-M1 beside `bolao.set_updated_at()` so it exists before DDL-M5 references it) and
  `paymentAllocationTriggerDdl()` (attached to `payment_allocations` only).
- Regenerated drafts: `M1_schema_extensions_and_enum_types.draft.sql`,
  `M5_payments_allocations_and_prizes.draft.sql`.
- `scripts/db/test_migration_drafts.mjs`: 7 tests.

Nothing in the scoring path, the transformers, the reports or the three bolão apps is touched.

## Tests that prove it

**Static (repo, `test_migration_drafts.mjs`, 88 passed):** the trigger exists and is attached to
exactly one table; the function is emitted in a phase at or before its first reference; the payment
row is locked; each of the six refusals is present; the running total excludes the row under
consideration so an UPDATE is not counted twice; the trigger fires on UPDATE as well as INSERT; the
raise carries an ERRCODE and the function pins its `search_path`; and the entry fee is *not* used as a
cap. Proven non-vacuous by mutation — removing `FOR UPDATE`, narrowing the trigger to `BEFORE INSERT`,
and letting the sum include the current row each produce a named failure.

**Live (`n_write_contract_pg.mjs` against real PostgreSQL 17.10):** N7, N8 and N9 moved from
`FINDING / CONTRACT_ONLY` to `PASS / DATABASE`. N7 carries its mutation as evidence: two writers that
omit the row lock are now parked on `Lock/transactionid` by the trigger's own lock and the second is
refused with `check_violation`, leaving `60.00` allocated of `100.00`. Negative controls hold — a
matching-currency allocation, an allocation against a payment that does carry an amount, and a second
allocation within the remaining balance are all still accepted, so the control is not simply refusing
everything.

**Regression:** `node scripts/gates.mjs` 44/44 across 32 suites; the three `audit_scoring.py` all
pass; `a15_verify_target_model.mjs` reports 0 unexplained structural differences; `c_catalog_fidelity`
506 comparisons / 0 defects.

## What this does NOT decide

It does not decide which entry a legacy-asserted payment settles. It makes that question
unanswerable-by-accident instead of answerable-by-default: KPLUS-OP-4(a) stays RED and open, and the
database now refuses the write that would have quietly resolved it.

## How to reverse it

`DROP TRIGGER "payment_allocations_check" ON bolao.payment_allocations;` and, if the function is also
unwanted, `DROP FUNCTION bolao.check_payment_allocation();` — then delete `PAYMENT_ALLOCATION_DDL`,
`paymentAllocationTriggerDdl` and their two call sites from the generator, regenerate, and drop the
seven tests. No data is written or altered by this change, so nothing needs restoring.

## Known limitation, recorded not hidden

The amended DDL sequence has been applied to the already-migrated local target, not rehearsed from a
fresh baseline restore. `TARGET_MIGRATION_RESTORE_REHEARSED` remains `NO`, and re-running
`a13_apply_target_ddl.mjs` over a fresh restore with the amended M1/M5 is queued as task `N-DDL`.
