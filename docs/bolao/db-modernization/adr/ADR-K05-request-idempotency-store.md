# ADR-K05 — the request idempotency store

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F018 (Workstream N, N2) · Governs: `bolao.request_idempotency`

## Decision

A single table, `bolao.request_idempotency`, keyed `UNIQUE (contract, idempotency_key)`, storing the
request's payload fingerprint and its response. The record is written **inside the business
transaction**. A money-bearing record carries no automatic expiry and the database refuses to let it
have one.

## Why this was not an operator question

Nothing here is a new rule. `model/write_contracts.json` already states the scope
(*"per (contract, idempotency_key)"*), the key namespace, the fingerprint definition, the conflict
behaviour (*"same key + DIFFERENT fingerprint → IDEMPOTENCY_CONFLICT, never a second write"*) and the
commit rule (*"the idempotency record is written INSIDE the business transaction"*).
`model/migration_choreography.json` → `idempotencyRetention` already states the retention stance
(*"no automatic deletion of a money-bearing idempotency record"*) and the replay rule (*"the safe answer
to 'did this already happen?' when the answer is unknown is not 'do it again'"*).

Every business meaning, financial meaning, scoring meaning and PII exposure is unchanged; production is
untouched; the whole thing is reversible with `DROP TABLE` while it is empty. That is YELLOW.

**What KPLUS-F018 actually found** is that all nine write contracts specify an idempotency lookup and an
idempotency record, and the target model has nowhere to put one. The contracts describe a store that
does not exist. This ADR is the store, not a new policy about it.

## The decisions inside this one

**1. One table, or one per contract?** *Chosen:* one table, with `contract` as the first column of the
key. *Alternative:* a per-contract store. *Why:* the spec already namespaces the key by contract, so a
single table expresses exactly the stated scope with one index; nine tables would express the same
thing nine times and make "has this key been used anywhere?" a nine-way union. There is no per-contract
retention difference — the split that matters is money-bearing vs not, which is a column.

**2. Where does uniqueness live?** *Chosen:* a `UNIQUE` constraint in the database. *Alternative:*
application-level check-then-insert. *Why:* check-then-insert is a race with itself — two concurrent
retries both find nothing and both write. The unique constraint makes the second one fail on the way in,
which is the only version of this that holds under concurrency. It also makes the rule true for any
future writer, not only the one that remembered to check. KPLUS-F013's lesson, applied before the fact.

**3. Is the fingerprint stored, or only compared?** *Chosen:* stored. *Why:* distinguishing "same
request retried" from "different request, same key" requires the original to compare against. Without it
the store can only answer "seen", and `IDEMPOTENCY_CONFLICT` becomes unimplementable — the conflict is
the case that protects against a client bug reusing a key across genuinely different money movements.

**4. Is the response stored?** *Chosen:* yes, as `jsonb`, replayed verbatim. *Why:* the spec says
*"the response is stored with the record and replayed verbatim on a matching retry"*. Recomputing it
instead would re-read state that may have moved on, so a retry could return a different answer than the
call it is replaying — which defeats the point of having replayed it.

**5. How is retention enforced?** *Chosen:* a nullable `prunable_after`, plus a CHECK that a
money-bearing record cannot have one. *Alternative:* a retention period column, or a scheduled delete.
*Why:* the choreography forbids automatic deletion of money-bearing records and refuses to hardcode a
period for them. A CHECK constraint turns "we must not prune this" from a convention someone has to
remember into something the database will not permit. Pruning stays an explicit operation over a named
set, exactly as the choreography requires; the column tells a pruner which rows it is even allowed to
look at.

**6. What happens when a record is missing?** *Not decided here — already decided.* The choreography's
`replayRule` says a retry of a money-bearing request whose record was pruned is REFUSED, not executed.
That is a write-contract behaviour, not a schema one; the schema's contribution is `money_bearing`,
which is what lets the contract tell the two cases apart.

## What changed

- `model/target_model.json` — new entity `bolao.request_idempotency`, `migrationPhase: "DDL-M12"`.
- `model/access_model.json` — matching access entry: `anon` and `authenticated` get nothing; `service`
  gets `SELECT, INSERT`; there is deliberately **no UPDATE for anyone** — a completed request's record
  is a statement about something that already happened.
- `scripts/db/generate_migration_drafts.mjs` — `PHASE_META["DDL-M12"]`. Namespaced for the reason
  DDL-M11 is namespaced (BATCH-G-OP-1): a bare `M12` would be a third meaning for a label two schemes
  already disagree about.
- `docs/bolao/db-modernization/migration-drafts/DDL-M12_request_idempotency.draft.sql` — generated.
- `a13_apply_target_ddl.mjs` — `DDL-M12` appended to the declared sequence.

## Tests that prove it

`n_idempotency_lab.mjs`, against real PostgreSQL, all controls proven non-vacuous:

1. a first request writes one business row and one idempotency record, in one transaction;
2. the identical request replays the stored response and writes **no** second business row;
3. the same key with a different fingerprint raises `IDEMPOTENCY_CONFLICT` and writes nothing;
4. **fault injection** — the session is KILLED after the business transaction commits and before the
   response is returned. The retry finds the committed record and REPLAYS. It does not rewrite;
5. the negative control for (4): with the record written AFTER commit instead of inside it, the same
   kill produces a **double write** — which is the defect the commit rule exists to prevent, and the
   proof that the rule is doing work rather than describing something that was safe anyway;
6. two concurrent identical requests: exactly one writes, the other gets a conflict or a replay, never
   two business rows;
7. a money-bearing record cannot be given an expiry — the CHECK rejects it.

## How to reverse it

`DROP TABLE bolao.request_idempotency;` while it is empty (rollback class `FULL`), and revert the four
model/generator files. After it holds records for money-bearing requests it becomes FORWARD_FIX_ONLY:
dropping it converts every in-flight retry into a potential double payment, which is the precise failure
the table exists to prevent.
