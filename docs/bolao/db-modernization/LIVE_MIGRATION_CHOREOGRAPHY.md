# LIVE MIGRATION CHOREOGRAPHY — expand / contract against a browser-resident app

**Workstream WS5.** Status: **DESIGN + LOCAL IMPLEMENTATION.** No DDL, no DML, no deploy, no flag,
no GRANT and no REVOKE exists as a result of this document. M0 remains `PREPARED_NOT_EXECUTED`.

| Artefact | Role |
|---|---|
| `model/migration_choreography.json` | the specification — states, transitions, flags, gates, domains, findings |
| `scripts/db/choreography.mjs` | the evaluator: transition legality, flag rules, gates, promotion decisions |
| `scripts/db/simulate_cutover.mjs` | the six synthetic simulations |
| `scripts/db/test_choreography.mjs` | 187 tests, 1 378 assertions |
| `docs/.../CUTOVER_RUNBOOK.md` | the operator-facing sequence |

This document explains the design and records what it deliberately does not claim. The JSON is
authoritative for every value; where they could disagree, the drift checker fails the build.

---

## 0. Why this platform needs its own choreography

Three properties, none of which a server-rendered app has, decide everything below:

1. **There is no release boundary.** A deploy replaces files on a CDN. It does not restart sessions.
   An open tab keeps running the previous build for as long as it stays open.
2. **The database is reachable from the browser.** A tab holds the anon key and writes directly. So
   "old app / new schema" is not a window measured in seconds — it lasts **days**.
3. **Flags are fetched, not compiled in.** A tab that never re-fetches the flag document never learns
   that anything changed.

The consequence that shapes the whole design: **"we deployed the fix" is never evidence that the old
path is gone.** Every control that matters has to be enforced where the old client cannot ignore it —
which means at the database, not in the client.

---

## 1. The state machine

Sixteen states. Three scopes, because collapsing them into one linear counter cannot express the
states this platform actually passes through:

- **GLOBAL** — schema and contract steps. A table either exists or it does not.
- **DOMAIN** — the seventeen domains cut over independently, and are *meant* to.
- **APP** — the legacy document is per-app, so freezing it is per-app.

```
LEGACY_ONLY → EXPANDED_SCHEMA → REFERENCE_BACKFILLED → DOMAIN_BACKFILLING → DOMAIN_BACKFILLED
  → DUAL_READ_SHADOW → PARITY_OBSERVATION → SERVER_WRITE_CANARY → SERVER_WRITE_PRIMARY
  → LEGACY_WRITE_DISABLED → NEW_READ_PRIMARY → PARITY_OBSERVATION → CUTOVER_READY
  → LEGACY_FROZEN → CONTRACT_ELIGIBLE → LEGACY_RETIRED
                                      ↘ LEGACY_READ_FALLBACK ↗   (the only cheap post-cutover rollback)
```

Two states earn their place by being non-obvious.

**`PARITY_OBSERVATION` is entered twice** — once before the write cutover, once as the post-read-cutover
soak. Its exit is decided by flag state, not by how it was entered, so the machine stays deterministic
without duplicating the state.

**`LEGACY_READ_FALLBACK` is a real state, not an error.** It is the destination of the only cheap
rollback that exists after writes have moved, and it is reachable *only while the legacy document is
still being written*. That single fact is why the freeze is a separate, later state.

### The split that resolved a contradiction (WS5-F3)

"The freeze" was two different things, and read as one it was a contradiction: the phase plan requires
the freeze **before** cutover (OI-4), while the write mirror must **outlive** cutover.

| State | Phase | What it means | Rollback |
|---|---|---|---|
| `LEGACY_WRITE_DISABLED` | M13 | direct browser writes to the document are **denied at the database**. Writes still happen — through the trusted runtime, which mirrors both representations. | a `GRANT` |
| `LEGACY_FROZEN` | M16 | the document **stops being written at all**. The mirror is removed. | forward fix only |

OI-4 is satisfied by the first. The mirror survives to the second. The cheap rollback exists in
between, which is the whole point.

---

## 2. What an old client may do

An old client is a tab loaded before the current state, on the previous build, holding the anon key,
**not expected to reload**. Sessions of minutes, hours and days are all in scope.

| State | READ | WRITE / PREDICTION / ENTRY / ADMIN |
|---|---|---|
| `LEGACY_ONLY` | SAFE | SAFE |
| `EXPANDED_SCHEMA` … `SERVER_WRITE_PRIMARY` | SAFE | SAFE_WITH_LEGACY_PATH |
| `LEGACY_WRITE_DISABLED` … `CUTOVER_READY` | SAFE | **REJECT_WITH_REFRESH_REQUIRED** |
| `LEGACY_FROZEN`, `CONTRACT_ELIGIBLE` | **READ_ONLY** (stale) | BLOCKED |
| `LEGACY_RETIRED` | BLOCKED | BLOCKED |

**No state classifies any old-client operation as `DATA_CORRUPTION_RISK`.** That is a design output,
not luck. It holds only because two things are true: M1–M10 never alter the legacy document's shape,
and the fence *denies* rather than partially accepts. The validator refuses any specification in which
a cell says otherwise.

The read classification changes **exactly at the freeze** — which is why the client floor must be
raised *before* it.

### Two populations of stale client (WS5-F9)

They are not the same and must not be handled the same way:

| | governed by | fence applies? | adapter can help? |
|---|---|---|---|
| a build predating the trusted runtime — writes the document directly | the old-client matrix | **yes**, by database privilege | **no**, and it must never appear to |
| a build that reaches the runtime with an older envelope | the write-shape classifier | no | yes, when lossless |

Conflating them made the adapter look capable of defeating a privilege denial. An adapter believed to
defeat the fence is how the fence quietly stops being a fence.

---

## 3. Client capability, not client version

A capability claim decides **compatibility**. It never decides **authorization**. The two must not
share a field, because the client controls one of them.

Version strings are the weaker mechanism: they force a total order on builds that were never totally
ordered, and they answer "is this newer?" when the real question is "does this understand
`payment_allocations`?" So the envelope carries `contract_version`, a set of capability tokens, and an
opaque `build_id` that never gates behaviour.

Obsolete write shapes resolve three ways and no more:

| shape | action |
|---|---|
| recognized, losslessly adaptable | adapt, execute the current contract, **record that an adapter was used** |
| recognized, not losslessly adaptable | reject `CLIENT_TOO_OLD` |
| unrecognized | reject `CLIENT_TOO_OLD`; never partially apply |

**The adapter rule:** it may fill a field only from data the request already contains or the database
already holds. It may **never** default a monetary amount, a currency, an actor or a timestamp. And an
operator action is never adapted (WS5-F10) — an adapted admin action is an action nobody specified, and
unlike a participant mid-entry, the operator has nothing to lose by reloading.

Every refusal must be **distinguishable from a transient error**, or the client retries forever and the
user cannot tell a migration from an outage.

---

## 4. Writes: one transaction, server-side, never the browser

A browser-side dual-write is not merely undesirable — it is **unavailable**. A browser cannot wrap a
document update and N relational inserts in one transaction over the REST API, so every browser-side
attempt produces exactly the partial states this design exists to make unreachable.

What is used instead: the trusted runtime writes **both representations in one database transaction**,
from `SERVER_WRITE_CANARY` until `LEGACY_FROZEN`. There is no commit in which only one succeeded, so
there is no state in which they disagree. This is acceptable only because both targets sit in **one
PostgreSQL database** — if the legacy document ever moved out of it, this design would be invalid.

Throughout the mirroring window the **legacy document remains authoritative**. The mirror exists to
make the two comparable, not to make the new one true.

**Old clients writing the document directly are not mirrored.** That divergence is expected, is
*measured* rather than assumed to be zero, and is eliminated by the fence — not by hoping tabs reload.
It is also precisely why `SERVER_WRITE_PRIMARY → NEW_READ_PRIMARY` is an illegal transition: the
normalized side is knowably incomplete by exactly that set of writes.

---

## 5. Parity means six different things

| Class | Meaning | Alone sufficient? |
|---|---|---|
| `ROW_COUNT_PARITY` | counts match | **no** — detects a truncated backfill and nothing else |
| `KEY_PARITY` | the business-key set matches **in both directions** | no |
| `VALUE_PARITY` | every MAPPED field equal after canonicalization | no |
| `AGGREGATE_PARITY` | sums, per-group counts, derived totals | no |
| `FINANCIAL_PARITY` | exact decimal equality per currency; allocations never exceed the payment | tolerance **zero** |
| `SCORING_PARITY` | every score, rank and tie byte-identical, computed by **the app's own logic** | tolerance **zero** |

A one-directional key check catches loss but not fabrication. A field excluded from `VALUE_PARITY`
must be excluded by a declared WS7 coverage class, never by omission — excluding a field because it is
inconvenient is how a real divergence hides.

`SCORING_PARITY` may **never** be computed by a SQL reimplementation of scoring. That would create a
second source of truth for money.

### A clean parity run can be worthless (WS5-F5)

A clean run over a domain nobody wrote to during the window proves the backfill **copied** faithfully.
It says nothing about whether the live write path **stays** faithful — which is the actual question
before a write cutover. So the evidence unit is `(clean runs) AND (mutations observed in the window)`,
and a window with zero mutations for a domain that has a live writer counts as **no evidence**.

A green result from a check that could not have failed is the most expensive kind of false confidence.

### Observation windows (durations are L-OP-3; the *kinds* of evidence are not)

| Risk class | Clean runs | Default hours | Mutations required | Zero delta |
|---|---|---|---|---|
| `LOW_RISK_REFERENCE` | 1 | 1 | no (no live writer exists) | — |
| `MEDIUM_OPERATIONAL` | 3 | 24 | yes | — |
| `HIGH_RISK_FINANCIAL` | 5 | 72 | yes (payment, allocation, reversal) | **required** |
| `CRITICAL_SCORING` | 5 | 72 | yes (prediction, result, ranking) | **required**, plus the app's own audit suites |

---

## 6. The backfill / live-write race

The bulk pass reads a snapshot; writes continue after that read. Any strategy that ends at the bulk
pass loses everything that landed afterwards.

Three passes: **BULK** (batched 500–2 000 rows, each its own transaction — a single long transaction
holds `xmin` back and blocks autovacuum database-wide), **DELTA** (repeated until a pass finds nothing;
convergence observed, not assumed), and **FINAL RECONCILIATION** (after the fence, against a source
that has stopped moving — the only pass whose result can be *asserted*).

Per-domain strategies, each with a stated reason, are in the JSON. Two are worth surfacing:

**`created_at` is rejected as a watermark for this platform (WS5-F6).** A match result corrected in
place carries no new `created_at`. A `created_at` watermark skips it, the normalized side keeps the
superseded result, and scoring diverges — from a bug whose only symptom is a wrong rank. Results use
the sync cursor plus a **content fingerprint**. The legacy document also gives nested items no reliable
per-item modification timestamp at all.

**Predictions' race strategy is the schedule.** The decomposition happens at M16, *after* the fence,
so no concurrent legacy writer exists by construction. The riskiest decomposition is placed where the
race does not exist.

For financial and scoring domains, the final reconciliation is a **gate, not a report**: no promotion
with an unresolved delta. Not "small". Zero.

---

## 7. Feature flags

Eight flags, each with an owner, default, scope, rollback meaning and retirement condition. Every flag
defaults to the **old** behaviour, so a client that fails to fetch the flag document degrades to the
pre-migration path rather than an untested one.

`server_write_canary` defaults to **true** — restrictive. A flag whose default widens the blast radius
is a flag that fails open.

Fourteen dependency rules (`FR-1` … `FR-14`) forbid the invalid combinations. Every rule has a bound
predicate in the evaluator and a negative fixture in the suite: a rule that cannot be made to fire is
prose, not a rule, and the validator says so.

### `legacy_writes_allowed` is not the fence (WS5-F2)

The previous design listed it as a client-readable flag *and* stated that a UI-only freeze is not a
freeze. Both are true of different mechanisms, and nothing said there were two — so an operator reading
the flag table would reasonably believe flipping it closes the fence.

It does not. A stale tab holds the anon key and never re-reads the flag.

- **The flag** renders a clear message instead of an opaque error. That is its whole job.
- **The fence** is a database privilege denial. `FR-6` refuses the configuration where the flag is off
  and the privilege is not.

The correction that follows: the fence's rollback is a **`GRANT`** — a production privilege write, not
a flag flip. Cheap, but no longer free, and it needs the credential that can issue grants.

---

## 8. Cutover gates

Four gates, each conjunctive, each requirement with its own negative fixture proving it can block.

**`GATE-FIN`** (payments, allocations, prizes) — nine requirements. They are conjunctive because each
detects something the others do not: reconciliation clean *with idempotency broken* means a retry
doubles a payment and reconciliation reports the doubled figure as correct. Includes the ratified
WS13-OP-3 rule that a refund is a **typed compensating record**, never an edit to the original fact.

**`GATE-PRED`** (predictions) — six requirements, plus the timing constraint `NO_OPEN_CUTOFF`. The
cutoff must be enforced **server-side against server time**; the legacy cutoff is client-side only and
bypassable by clock manipulation, and the cutover must not carry that gap forward. Moving prediction
writes while a cutoff is open means a failure denies entries during the only window in which they can
be made — the participant cannot retry later, so the damage outlives the fix.

**`GATE-RESULT`** (results, matches, sync) — the single-authority rule. At every instant exactly one
writer is authoritative for a result. Two competing authorities is worse than either being wrong: an
alternating overwrite produces a result that changes back and forth, and scoring changes with it. The
old sync writer must be **stopped, not merely superseded** — a superseded writer that still runs is a
second authority.

**`GATE-ADMIN`** — every operator write goes through a named WS13 contract. The ratified allowlist
(WS13-OP-1) is the only mutable surface: `pool_entries.entry_label`, `participants.display_name`,
`participants.email`, `pools.name`, `pools.status`, `matches.status`. Anything else needs a new explicit
contract. **No generic "update anything" capability exists.**

### R-GAP-1 stays open, and it is load-bearing here

`operator_context` is an abstraction owned by the trusted runtime. **There is no database-verifiable
operator principal today.** `operator_evidence` records that the *runtime* checked authority — nothing
more.

A compromised trusted runtime can forge it, and no database control detects that. RLS does not mitigate
a service-role compromise and this design does not pretend it does. The compensating control is
detection and reversal, not prevention: append-only hash-chained audit plus reversible merges. The
future stronger state is a real authenticated operator role, so identity is verified where it is used
rather than asserted upstream.

---

## 9. RLS and ACL sequencing

**Secure by default.** A table must never exist in a state where a client can reach it and no policy
governs it.

1. `CREATE TABLE`
2. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` — **in the same migration**. RLS enabled with no policy
   denies everything, which is the right default for an empty table with no reader. Enabling it later
   leaves an exposure window of whatever duration passes before someone remembers.
3. **No grant yet.** RLS is not the only gate; a table with RLS on and no grant is unreachable twice
   over, and the second lock is the one that survives a policy mistake.
4. Create the policies from `model/rls_model.json`.
5. **Verify with negative fixtures** — prove each policy *denies*. A policy that permits everything
   passes every positive test.
6. Grant only what the read model needs.

Legacy policies are **not touched** while any client still reads the document. They change at exactly
two points: the fence, and retirement.

Financial tables are **never browser-writeable in any state** — there is no migration state in which a
browser needs to write a financial row, so there is no state in which the grant should exist. Per
WS12-OP-1, an authenticated participant reaches their financial rows through a trusted-runtime read
model, restricted view or RPC; raw payment and allocation metadata stays protected.

Per WS12-OP-2, ownership resolves through `participant_auth_links`. One auth user **may** link to
several participant identities, and historical participants may have no linkage at all and must remain
fully functional. So no read policy may be written as "the participant whose id equals the auth uid" —
every ownership predicate resolves through the link table, and an unlinked participant resolves to no
rows rather than to an error.

ACLs evolve by least privilege, and old ones are retired with **specific** revokes — never a wildcard,
never `REVOKE ALL`. A wildcard revoke on a shared role removes privileges nobody remembered were
load-bearing, and the resulting outage is hard to attribute. The migration role is **separate** from the
trusted runtime: a runtime that can DDL is a runtime whose compromise is a schema compromise.

---

## 10. Rollback, and where it stops being cheap

| Class | States |
|---|---|
| `APP_ROLLBACK_ONLY` | `LEGACY_ONLY` |
| `SCHEMA_ROLLBACK` | `EXPANDED_SCHEMA`, `REFERENCE_BACKFILLED` |
| `DATA_RESTORE_REQUIRED` | `DOMAIN_BACKFILLING`, `DOMAIN_BACKFILLED`, `LEGACY_RETIRED` |
| `FEATURE_FLAG_ROLLBACK` | `DUAL_READ_SHADOW`, `PARITY_OBSERVATION`, `NEW_READ_PRIMARY`, `LEGACY_READ_FALLBACK`, `CUTOVER_READY` |
| `WRITE_PATH_ROLLBACK` | `SERVER_WRITE_CANARY`, `SERVER_WRITE_PRIMARY`, `LEGACY_WRITE_DISABLED` |
| `FORWARD_FIX_ONLY` | `LEGACY_FROZEN`, `CONTRACT_ELIGIBLE` |

### Points of no simple return

| Id | Boundary | Note |
|---|---|---|
| PNSR-1 | the first `payment_allocations` row | it has **no legacy representation at all** |
| PNSR-2 | the first identity merge | reversible by compensating record, not by discarding tables |
| PNSR-3 | the first financial compensating record | a refund a participant can see in their bank statement |
| PNSR-4 | legacy writes denied | reversal is a `GRANT` |
| **PNSR-5** | **the legacy document stops being written** | **the boundary** |
| PNSR-6 | legacy structures dropped | restore only |

PNSR-1 carries the subtlety worth keeping: **the state is reversible and the data is not.** Those are
different questions, and conflating them is how a rollback plan turns out to be fiction.

If one line of this document survives, it is PNSR-5: before the freeze, every rollback is a flag flip.
After it, the legacy representation is stale, and rolling back to it means silently serving data missing
every write since the freeze.

---

## 11. Failure between every two steps

Twelve analysed transitions are in the JSON. The four unsafe ones and their controls:

- **the fence closes before its refusal path is proven** — tabs get an opaque error and retry forever.
  Blocked by `FR-5` and the `staleClientFenceReady` guard; the error path is proven at deployment step
  10, one step before step 11 denies anything.
- **the legacy ACL is revoked before the new write path is deployed** — a total write outage: old path
  denied, new one absent. Blocked by `FR-13` and `writeContractsDeployed`. The ordering is
  machine-checkable rather than clerical, which matters because the previous plan's only protection was
  the runbook's step numbering.
- **RLS enabled after the table was granted** — an exposure window of unknown duration. What already
  leaked cannot be recalled. Fixed by ordering, not by a check.
- **outbox delivery enabled over a backlog** — a mass duplicate-notification incident aimed at real
  participants. The **only** failure in the list whose damage is external and irreversible: a sent email
  is sent. It therefore has two independent rules (`FR-7`, `FR-8`) rather than one.

A stall mid-migration with domains in different states is **not** an incident — domain-scoped state
exists so that a stall is a resting place. The single exception is a domain left in
`DOMAIN_BACKFILLING`, which is neither one thing nor the other.

---

## 12. Multi-app: shared spine, independent apps

Shared domains — `participants`, `identity_links`, `payments`, `allocations`, `audit`, `outbox` —
advance at the **slowest** app (MA-1) and may not freeze until every app is `CUTOVER_READY` (MA-4).
Per-app domains advance independently.

**Recommended order: copa2026 → cdb2026 → br2026.** copa2026 is concluded and archived: no open cutoff,
no pending payout, no active sync, so every timing constraint is trivially satisfied. Choosing the
busiest app first means satisfying the hardest constraints first for no benefit.

### The hazard the migration itself creates (WS5-F7)

Migrating copa2026 creates participants. Migrating br2026 later, keyed **per app**, would create a second
row for the same person — the platform's duplicate-identity problem, manufactured silently by the tool
built to normalize it.

The control: **the participant natural key is global across apps.** A later app's backfill must find and
reuse the earlier app's row. This is the most important cross-app control in WS5, and it has a
regression test.

`XH-2` is the related financial hazard: a third-party payment covering entries in a migrated and an
unmigrated app can never be fully allocated, so a derived settlement state reads as permanently
under-applied. MA-1 is what prevents it — which is why MA-1 is a rule and not a preference.

---

## 13. Scheduling: events, not clock windows

`NO_OPEN_CUTOFF`, `NO_ACTIVE_SYNC`, `NO_UNRESOLVED_RECONCILIATION`, `NO_PENDING_PAYOUT`,
`NO_CONCURRENT_ADMIN_SESSION`, `AVOID_MATCH_DAY` — all checkable states, all checked by the evaluator.

"A quiet Tuesday" is not a safety property. It is a guess about where the events are. If the event can
be checked, check the event.

`NO_PENDING_PAYOUT` deserves naming: the window between a pool concluding and its prizes being paid is
when humans read the numbers in order to move real money.

---

## 14. Open operator decisions

**L-OP-1 — freeze window. Recommended: `SHORT_WRITE_FREEZE`.** It is the only option that produces a
stationary source (which the financial and scoring gates require) without taking reads down.
`NO_FREEZE` means parity can only ever be sampled, never asserted. `FULL_MAINTENANCE_WINDOW` pays a
high availability cost for no additional safety, since reads can continue throughout.

`DOMAIN_SPECIFIC_FREEZE` is **not available** at the point it would be needed (WS5-F8) — and that is a
structural fact, not a preference. The fence is a privilege on the legacy *document*, which is one jsonb
row containing every domain. No privilege denies "writes to the payments part of a row". Worth knowing
before it is proposed in a meeting.

**L-OP-2 — client floor.** The recommendation differs **per operation**, because a single global policy
is wrong: a stale read is harmless while the document is still written and harmful the moment it is not.

| Operation | Recommended |
|---|---|
| READ | read-only degradation before the freeze, hard reject after |
| WRITE | hard reject — the one operation that can partially mutate |
| SUBMIT_PREDICTION | adapter while lossless, hard reject otherwise — highest-value adapter in the system |
| CREATE_ENTRY | hard reject with a refresh prompt; nothing to preserve |
| ADMIN_ACTION | hard reject, always, no adapter |

Default if undecided: read-only degradation plus hard write reject — the pair that cannot silently
corrupt anything.

**L-OP-3 — parity runs.** Configurable, with the minimums in §5 and the vacuity rule as the
non-negotiable part.

**WS13-OP-2 — idempotency retention.** `POLICY_CONFIGURABLE`. Money-bearing records: **indefinite** until
an exact dispute period is established, with no automatic premature deletion. Where a record has been
pruned, a money-bearing retry is **refused**, not executed — the safe answer to "did this already
happen?" when the answer is unknown is not "do it again". `AC-9` aborts the migration if the store is
unavailable, because the entire exactly-once-effect argument rests on it.

---

## 15. Outbox, audit, reporting

**Outbox.** The existence of a table is not a reason to deliver from it. Five steps: schema → events
created (event idempotency proven) → shadow logging (references only, no address, no PII) → delivery
canary to one synthetic recipient (delivery idempotency, dead-letter state, replay controls) →
enabled. **No historical events are created** — those notifications were sent by EmailJS months ago; an
inert historical row is a lie about history and a delivered one is a mass re-notification. Dead is a
*state*, never a deletion. Replay is explicit, audited and scoped to a named event set: there is no bulk
"retry everything" control, because its blast radius is every participant's inbox.

**Audit.** Must be recording *before* the writes worth auditing move, or the cutover is the
least-documented change in the system's history. Historical entries at M10 are a **re-representation of
entries that already exist** — the distinction from the outbox decision is exactly that: the legacy
document *has* an audit trail; it has no outbox. During the transition, legacy admin actions are swept in
by the delta pass, so coverage is complete but **lagged** by the delta interval. That lag is stated here
rather than discovered later; a real-time audit claim would be false during the transition.

**Reporting.** Lags the transactional cutover deliberately: a report is derived and recomputable, so
moving it early buys nothing, while a wrong number with an authoritative presentation is worse than an
honestly missing one. Historical financial reporting requires reconciled data and must **refuse to
render** over an unresolved delta rather than produce a figure that will change.

One labelling requirement: M9 creates **asserted** payments with no allocations, because the legacy
document records that an entry is paid and never *which money* paid for it. Every financial report
covering the pre-migration period must label those figures as asserted rather than allocated. A report
that presents an asserted payment as a reconciled one is fabricating precision the source never had.

---

## 16. What this design does not claim

- **No restore has been rehearsed.** `RESTORE_REHEARSED` is `NO` for every phase. Until one is, every
  rollback classified `DATA_RESTORE_REQUIRED` is an intention, not a capability.
- **No protection against a compromised trusted runtime.** R-GAP-1 is open. RLS does not help here.
- **No measured RPO/RTO.** No number is claimed until a rehearsal produces one.
- **No legacy-document write-denial mechanism is modelled (WS5-F4).** The fence is the single control
  that makes the normalized representation complete, and it is the one control with no design artefact:
  `model/rls_model.json` covers the 25 target entities, not `public.bolao_state`. Recorded as an open
  blocker and `GNG-10` rather than designed here — the legacy policies are live production objects, and
  inventing a replacement without reading them first is how the TRUNCATE exposure happened.
- **No claim that old clients are gone.** That is unobservable today. `OG-10` is how it becomes
  observable, and the previous plan had no metric for it at all.
- **No claim of readiness.** M0 is unresolved, three L-OP decisions are open, and `GNG-13` exists
  specifically to be answered *no*: the existence of SQL files is not readiness.

---

## 17. Findings

| Id | Sev | Finding |
|---|---|---|
| WS5-F1 | HIGH | the client floor was sequenced **after** the freeze — the protection scheduled after the harm |
| WS5-F2 | HIGH | the freeze was described as a flag and as a database control, with nothing saying there were two |
| WS5-F3 | MED | "the freeze" conflated two states, making OI-4 read as a contradiction |
| WS5-F4 | HIGH | no model covers denying writes to the legacy document — the fence has no artefact |
| WS5-F5 | MED | a parity run over an idle domain was treated as evidence |
| WS5-F6 | MED | a `created_at` watermark would silently miss corrected results |
| WS5-F7 | HIGH | cross-app participant duplication caused by the migration itself |
| WS5-F8 | LOW | `DOMAIN_SPECIFIC_FREEZE` was offered as an option it is not |
| WS5-F9 | MED | two different populations of stale client were treated as one |
| WS5-F10 | LOW | the write-shape classifier would have adapted an operator action |

F1, F2, F3, F5, F6, F7, F9 and F10 are fixed with regression tests. F4 is an open blocker by choice.
F8 is a documentation correction.

---

## 18. Reconciliation with the earlier documents

**One authoritative cutover order:** `deploymentOrder` in `model/migration_choreography.json`. The
drift checker fails if any other artefact disagrees.

| Document | Status |
|---|---|
| `ZERO_DOWNTIME_STRATEGY.md` §8 | **SUPERSEDED IN PART** — the client floor moves before the freeze (F1); "the freeze" splits in two (F3); the freeze's rollback is a `GRANT` (F2). Everything else stands: the expand/contract rules, the schema-change safety table, the backfill batching properties, FS-1…FS-8, and the single-transaction justification. |
| `model/migration_phases.json` | **CONSISTENT** — M0–M17 and OI-1…OI-8 unchanged |
| WS6 backfill framework | **CONSISTENT** — plus the per-domain watermark choice and the general rejection of `created_at` |
| WS7 transformers | **CONSISTENT** — coverage classes drive `VALUE_PARITY`; money-ambiguity-is-FATAL drives the adapter rule and `AC-5` |
| WS12 RLS model | **CONSISTENT WITH A GAP** — WS12-OP-1/2 carried through; the gap is WS5-F4 |
| WS13 write contracts | **CONSISTENT** — WS13-OP-1 → `ADM-1`; WS13-OP-2 → `idempotencyRetention`; WS13-OP-3 → `FIN-5` |
| `REPORTING_MODEL.md` | **EXTENDED** — the four-step sequence and the asserted-payment labelling requirement |
| ADR-009 server-mediated writes | **CONSISTENT** — plus the stronger point that browser dual-write is impossible, not merely unwise |

---

## 19. Definition of done

| Requirement | Status |
|---|---|
| formal state machine | ✅ 16 states, 26 transitions, 3 scopes |
| M1–M17 choreography | ✅ (M1–M10 have drafts; M11–M17 are runtime phases by design) |
| old-client matrix | ✅ total over 16 states × 5 operations |
| feature-flag model | ✅ 8 flags, 14 rules, all bound and all fired by a negative fixture |
| live-write race solved | ✅ per domain, with a named watermark and a stated reason |
| delta reconciliation | ✅ bulk / delta / final, zero-delta gate for money and scoring |
| financial cutover | ✅ `GATE-FIN`, 9 conjunctive requirements |
| prediction cutover | ✅ `GATE-PRED`, 6 requirements + `NO_OPEN_CUTOFF` |
| result / admin cutover | ✅ `GATE-RESULT` single authority; `GATE-ADMIN` allowlist only |
| RLS / ACL sequencing | ✅ secure-by-default, per table, negative fixtures required |
| rollback matrix | ✅ every state classified |
| failure between every two steps | ✅ 12 analysed, every unsafe one names a control |
| cutover simulation | ✅ full path, two users, third-party payer, money, prize, outbox, audit |
| stale-browser simulation | ✅ all 16 states × 5 operations × 2 write paths |
| financial failure simulation | ✅ 5 scenarios, no money lost or doubled |
| scoring simulation | ✅ all three apps' cascades |
| promotion evaluator | ✅ PROMOTE / HOLD / ROLLBACK / BLOCKED; missing evidence is HOLD |
| readiness matrix | ✅ M1–M17 × 8 columns |
| operator runbook | ✅ `CUTOVER_RUNBOOK.md`, every step labelled |
| adversarial review | ✅ 6 lenses, 16 attacks, one accepted risk labelled as such |
| no unexplained HIGH/CRITICAL risk | ✅ the residual HIGH risks are WS5-F4 and R-GAP-1, both recorded as open blockers |
