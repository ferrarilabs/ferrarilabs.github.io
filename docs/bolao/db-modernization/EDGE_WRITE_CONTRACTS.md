# EDGE_WRITE_CONTRACTS — transactional invariants, idempotency, errors, observability and threats

**Workstream 13.** Consolidates WS13.35's six requested documents into one. Splitting a single design across
`EDGE_WRITE_CONTRACTS`, `TRANSACTION_INVARIANTS`, `IDEMPOTENCY_MODEL`, `ERROR_CATALOG`,
`WRITE_OBSERVABILITY` and `WRITE_SECURITY_THREAT_SUMMARY` would restate the same rules six times and let
them drift.

Canonical model: `model/write_contracts.json`. Reference implementation: `scripts/db/write_contracts.mjs`.
Cross-references: `TARGET_RLS_MODEL.md` (§8's invariant-placement table is what this workstream implements),
`ACCESS_MATRIX.md`, `model/rls_model.json`.

Status: **REVIEW DRAFT. No Edge Function deployed. No production write of any kind.**

---

## 1. Why a reference implementation, not only a specification

WS12 deliberately left business invariants outside RLS: the cutoff needs a trusted clock, the per-payment
allocation invariant spans sibling rows, a merge needs operator confirmation. A document saying "the
transaction enforces this" is unfalsifiable.

An executable orchestrator over a synthetic store makes each claim a fixture instead of an assertion of
intent. It is how the concurrency, fault-injection and idempotency behaviour below is *demonstrated* rather
than described — and it is how the deadlock in §12 was found.

## 2. The three rules that shape everything

1. **One business transaction is one contract.** An entry without its snapshotted fee is an entry whose
   settlement is undefined, so creating one is a single transaction — never three browser writes because the
   tables happen to be normalised.
2. **The idempotency record commits inside the business transaction.** Writing it before commit lets a crash
   leave a request marked done that never happened; writing it after lets a retry double-write. Same lesson
   as the backfill checkpoint, and the same fault fixtures prove it.
3. **READ COMMITTED everywhere.** Every conflict here is closed by a UNIQUE index or a `FOR UPDATE` on
   exactly the contended row. `SERIALIZABLE` is used **nowhere** — deliberately, not by omission: it would
   serialise requests that do not conflict and still require the same retry handling.

## 3. The eight contracts

| Contract | Principals | Critical lock | Audit | Outbox |
|---|---|---|---|---|
| `createEntry` | authenticated, runtime | `pools` FOR SHARE, `pool_fee_schedule` FOR SHARE | yes | receipt + admin |
| `submitPrediction` | authenticated, runtime | UNIQUE (entry, subject) | yes | **no** — a receipt per pick would mean 64 emails |
| `recordPayment` | runtime only | UNIQUE (external_reference) | yes | admin |
| `allocatePayment` | runtime only | **`payments` FOR UPDATE** | yes | conditional — only when the entry becomes settled |
| `mergeParticipantIdentity` | runtime only | `participants` FOR UPDATE, **sorted by id** | yes + reason | **no** — internal bookkeeping |
| `reverseParticipantMerge` | runtime only | `participants` then link, same sorted order | yes + reason | **no** |
| `recordPrize` | runtime only | `pools` FOR UPDATE, UNIQUE (pool, rank) | yes + reason | receipt per winner + admin |
| `adminCorrection` | runtime only | target row FOR UPDATE | yes + sidecar | admin |

## 4. Client authority — what a client may never supply

Permitted: `request_id`, `idempotency_key`, `correlation_id`, `payload_version`, payload.

**Never** permitted: the acting principal, `auth_user_id`, an operator identity, the timestamp used for a
cutoff decision, a settlement status, an unapplied balance. A client-chosen id is for correlation; it never
selects a row, a participant or an actor.

## 5. Idempotency

| Aspect | Decision |
|---|---|
| scope | per `(contract, idempotency_key)` — the same key in two contracts is two requests |
| fingerprint | sha256 over the canonicalised payload with sorted keys, **excluding** `request_id` and `correlation_id`, so a retry with a fresh request id is still recognised |
| same key, same payload | replay the stored response with `idempotent_replay: true` |
| same key, **different** payload | `IDEMPOTENCY_CONFLICT`. Replaying would be wrong and writing again would double-write, so neither happens |
| commit point | **inside** the business transaction, after the rows |
| expiry | 24 h ordinary, **30 days money-bearing** — a payment dispute arrives long after the request |

## 6. Failure windows, and what each one costs

| Window | Durable? | Retry behaviour |
|---|---|---|
| before mutation | no | writes once |
| after mutation, before audit | no — rolled back | writes once |
| after audit, before outbox | no — rolled back | writes once |
| after outbox, before idempotency | no — rolled back | writes once |
| **after commit, before response** | **yes** | **replays** — the caller sees a failure, the write is durable, and the retry returns the stored response |

The last row is the whole difficulty. It is the window that double-writes in any design where the
idempotency record is written after the business transaction.

## 7. Concurrency

| Conflict | Mechanism |
|---|---|
| two allocations against one payment | `SELECT payments FOR UPDATE` — serialises exactly the two requests that conflict |
| two predictions for one (entry, subject) | UNIQUE index + upsert. The only raceless way to converge |
| two entries with the same label | UNIQUE (participant, pool, label) |
| two merges over one pair | both participants locked `FOR UPDATE` in **sorted id order** |
| two prize declarations | `pools` FOR UPDATE + UNIQUE (pool, rank) |
| two admin corrections | row `FOR UPDATE` + before-fingerprint + version; the loser gets `STALE_VERSION`, never a lost update |

## 8. Lock ordering

```
pools → participants → participant_identity_links → payments → pool_entries
      → predictions → prize_allocations → audit_events → outbox_events
```

Within a table, ascending id. The identity contracts additionally sort the two participant ids, because two
merges over the same pair locking in opposite orders is the one deadlock this design would otherwise have.

The synthetic store **refuses** an out-of-order acquisition, which turns the rule from documentation into
something a test can violate and observe.

## 9. Error taxonomy

| Code | HTTP | Retryable | Audit severity |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | no | INFO |
| `AUTH_REQUIRED` | 401 | no | INFO |
| `FORBIDDEN` | 403 | no | **WARN** — on an operator-sensitive contract it may be a probe |
| `NOT_FOUND` | 404 | no | INFO |
| `CONFLICT` | 409 | yes | INFO |
| `DUPLICATE` | 409 | no | INFO |
| `LOCKED` | 423 | yes | INFO |
| `CUTOFF_PASSED` | 422 | no | INFO |
| `FINANCIAL_INVARIANT` | 422 | no | **ERROR** — either a client is attacking a money path or a contract is wrong |
| `IDENTITY_AMBIGUOUS` | 409 | no | WARN |
| `IDEMPOTENCY_CONFLICT` | 409 | no | WARN |
| `STALE_VERSION` | 409 | yes | INFO |
| `UNSUPPORTED_STATE` | 422 | no | INFO |
| `INTERNAL` | 500 | yes | ERROR |

`NOT_FOUND` is deliberately indistinguishable from `FORBIDDEN` for a row the caller may not see, so the
status difference cannot be used to enumerate. `INTERNAL` is the only code a raw database error may map to,
and the client message never carries the underlying text.

## 10. Audit and outbox

Every contract is audited — there is no unaudited write. `safeMetadata` carries references and enum values
only; `recordPayment` **explicitly forbids** `external_reference` and `payer_name_as_recorded`, because the
payment id identifies the row and carrying the reference into a log that gets pasted into tickets adds
exposure for no investigative gain.

Outbox events are declared per contract, and **declining one requires a reason**. Payloads carry references
only: the recipient address is resolved at delivery time from the participant row, so a queued payload never
contains an email. Dedupe keys are parameterised (`entry:{pool_entry_id}:receipt`).

## 11. Observability

Per contract: a success/failure counter tagged by error code, a latency measurement, a structured log
carrying `request_id`, `correlation_id`, contract name and outcome, and a link to the audit event id. Never
logged: payloads, payer names, external references, operator reasons (they live in the audit row), or any
token.

Alert-worthy: any `FINANCIAL_INVARIANT` (a money invariant was attacked or a contract is wrong), a rising
`IDEMPOTENCY_CONFLICT` rate (a client bug or a replay attempt), and any `LOCKED` sustained above baseline
(lock contention that ordering was supposed to prevent).

## 12. Defect found by this workstream's own tooling

`reverseParticipantMerge` locked `participant_identity_links` **before** `participants` — the opposite order
from `mergeParticipantIdentity`. Two of them running concurrently is exactly the deadlock the global ordering
rule exists to prevent. The store's ordering check caught it; review had not.

Fixed by reading the link unlocked to discover the participant ids, locking participants first in sorted id
order, then locking the link and **re-checking `reversed_at` under that lock**.

Three further findings, all in the test fixtures rather than the contracts, and all of the same kind — a
mutant that appeared killed for the wrong reason:

- `IGNORE_DUPLICATE_KEY` was masked by the unique index on `(participant_id, pool_id, entry_label)` catching
  the duplicate anyway. The masking is a good property; the fixture moved to a contract with no index to hide
  behind.
- `MARK_COMPLETE_BEFORE_COMMIT` was masked the same way.
- `ALLOW_OPERATOR_WITHOUT_EVIDENCE` was masked by a **crash**: with the check bypassed the implementation
  dereferenced `operator_evidence.reason`. A mutant killed by a TypeError proves nothing about the control.

## 13. Threat summary

| Threat | Control | Residual risk |
|---|---|---|
| browser records a payment | runtime-only; 10 tampering cases | none at this layer |
| browser submits for another's entry | ownership resolved server-side from `participant_auth_links` | none at this layer |
| submission after the cutoff | server clock only; a client timestamp is never consulted | none at this layer |
| double-charge via retry | idempotency key + payload fingerprint, committed with the rows | a client that reuses one key for genuinely different requests gets `IDEMPOTENCY_CONFLICT`, which is correct but needs a good client message |
| over-allocating a payment | `FOR UPDATE` + in-transaction sum | none at this layer |
| paying out more than collected | collected-total check under `pools` FOR UPDATE | the collected total counts allocations, so a mis-allocation upstream propagates |
| wrong-person merge | operator evidence + reason + cycle/self/superseded checks + reversibility | **R-GAP-1**: the database does not verify the operator |
| operator without authority | `operator_evidence` recorded in the audit event | R-GAP-1 again. This is the largest residual risk in the design |
| **compromised trusted runtime** | constraints, unique indexes and in-transaction invariants still hold; RLS does **not** | **the runtime holds the service key and bypasses RLS entirely.** What survives is exactly what lives in constraints and contracts — which is why the allocation invariant is in the transaction and not in a policy |

## 14. Deliberately not claimed

- **No Edge Function exists.** This is a specification plus a reference implementation over an in-memory store.
- **The store is not PostgreSQL.** It models snapshot rollback, row locks, unique indexes and lock ordering.
  It does not model MVCC visibility, real deadlock detection, or lock waiting — a conflicting `FOR UPDATE`
  fails immediately here where PostgreSQL would block.
- **`participant_auth_links` does not exist yet.** Ratified as the mechanism (WS12-OP-2); creating it is a
  future migration.
- **RLS does not protect against service-role compromise**, and this document does not suggest it does.

## 15. Open operator decisions

| Id | Decision |
|---|---|
| **R-GAP-1** | Unchanged and now load-bearing for six contracts: adopt database-verifiable operator identity, or accept that operator authority is enforced in the runtime and record that acceptance. |
| **WS13-OP-1** | Confirm the correctable-field allowlist (`pool_entries.entry_label`, `participants.display_name`/`email`, `pools.name`/`status`, `matches.status`). Anything absent from it requires a new contract rather than an exception. |
| **WS13-OP-2** | Confirm the idempotency retention split — 24 h ordinary, 30 days money-bearing — against any dispute window you know of. |
| **WS13-OP-3** | Confirm that a refund/reversal is recorded as a compensating `payments` row with a negative amount (the model's design) rather than by editing the original. |
