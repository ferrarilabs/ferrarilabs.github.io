# CUTOVER RUNBOOK — operator-facing sequence

**Workstream WS5.** Companion to `LIVE_MIGRATION_CHOREOGRAPHY.md`.

> **Nothing in this runbook has been executed.** M0 is `PREPARED_NOT_EXECUTED`. Production writes: 0.
> Production migrations: 0. This document describes a sequence that is *not yet authorized to begin* —
> see §1 Go/No-Go, **three** items of which are currently **NO** (GNG-1, GNG-2, GNG-9).

No secrets, credentials, connection strings, policy literals or participant data appear here, and none
may be added. Where a step needs a credential, it says which *kind* and nothing more.

**Every step carries a label:**

| Label | Meaning |
|---|---|
| `READ_ONLY` | reads production; changes nothing |
| `REPO_WRITE` | changes files in this repository only |
| `SCRATCH_WRITE` | writes to a disposable scratch project, never production |
| `PRODUCTION_SCHEMA_WRITE` | DDL, GRANT, REVOKE, RLS |
| `PRODUCTION_DATA_WRITE` | INSERT / UPDATE / DELETE on production rows |
| `PRODUCTION_LEDGER_WRITE` | `supabase_migrations.schema_migrations` |
| `DEPLOYMENT` | ships code or flips a flag |

---

## 1. Go / No-Go — evidence, not intent

No migration begins because the SQL files exist. Every blocking item must be **YES** with evidence.

| Id | Question | Evidence | Current |
|---|---|---|---|
| GNG-1 | Is M0 resolved and the baseline registered? | the ledger state, read directly | **NO** |
| GNG-2 | Has a restore been rehearsed against production-shaped data? | a rehearsal report with a measured RTO | **NO** |
| GNG-3 | Does the live schema match the expected pre-migration state exactly? | `acceptance_checks.mjs` vs a fresh dump | — |
| GNG-4 | Are the RLS negative fixtures proven to **deny**? | the WS12 adversarial harness | — |
| GNG-5 | Is exactly-once effect proven for every money-bearing contract, including after-commit-before-response? | WS13 fault injection | — |
| GNG-6 | Do all three apps' scoring audits pass, and does `SCORING_PARITY` hold on both representations? | `audit_scoring.py` ×3, `scoring_parity.mjs` | — |
| GNG-7 | Is a stale-client refusal path deployed, distinguishable from a transient error, and verified? | stale-browser simulation + a deployed `CLIENT_TOO_OLD` path | **PARTIAL** — database half measured (`r_stale_client_lab.mjs` 13/13): transient is cleanly separable, but the fence and RLS share `42501`, so the runtime must carry its own signal (KPLUS-F038). The deployed client path is still unbuilt. |
| GNG-8 | Is the observability baseline captured? | pre-migration metric baselines | — |
| GNG-9 | Are L-OP-1, L-OP-2 and L-OP-3 decided? | an operator decision record | **NO** |
| GNG-10 | Is the legacy-document write-denial mechanism designed and modelled? | a policy/privilege model covering the legacy tables | **YES** — `scripts/db/legacy_fence.mjs` + the two generated drafts; proven on the restored baseline by `ws5f4_legacy_fence_lab.mjs` 24/24 |
| GNG-11 | Does every domain have a declared race strategy with a named watermark? | `migration_choreography.json` | **YES** |
| GNG-12 | Is the timing window clear of SC-1…SC-6? | checked state, not a calendar | — |
| GNG-13 | Does the existence of SQL files constitute readiness? | — | **NO, by design** |

**Three blocking items are NO — GNG-1, GNG-2, GNG-9. The sequence below cannot start.**

GNG-10 was the fourth until WS5-F4 closed it. The count is maintained here deliberately: a go/no-go list that says "four" while showing three is a list nobody trusts to be current.

---

## 2. Before anything: capture the baseline

| # | Action | Label |
|---|---|---|
| 0.1 | Capture the pre-change ACL and policy state **outside Git** | `READ_ONLY` |
| 0.2 | Capture metric baselines: write error rate, sync lag, authorization denials, request volume | `READ_ONLY` |
| 0.3 | Take and **verify** a logical backup; confirm it restores into a scratch project | `SCRATCH_WRITE` |
| 0.4 | Record the longest plausible session duration observed in the field — every "wait for old clients" window is measured against it | `READ_ONLY` |

Step 0.3 is not optional and not a formality. Until a backup has been *restored*, it is a file, not a
backup.

---

## 3. The sequence

Per-step rollback is in the right-hand column. Steps 1–20 are all reversible without a restore.
**Step 21 is the first irreversible one**, and it is deliberately the last step that changes anything —
nothing mutating follows it. Step 22 does follow it, but only to read: it is the verification that the
contract worked, and it exists precisely because step 21's only recovery is a restore.

| # | Action | Label | Rollback |
|---|---|---|---|
| 1 | M1–M7 additive DDL. Each table: `CREATE`, then `ENABLE ROW LEVEL SECURITY` **in the same migration**, and **no grants** | `PRODUCTION_SCHEMA_WRITE` | `DROP` — nothing references the new tables |
| 2 | M1 reference rows (competitions, editions, phases). Hand-authored, **never derived from the legacy document** | `PRODUCTION_DATA_WRITE` | delete by source marker |
| 3 | RLS policies per table, then **verify each one denies** with its negative fixture | `PRODUCTION_SCHEMA_WRITE` | drop the policies; the table stays unreachable |
| 4 | M5, M8, M9, M10 backfills — bulk pass then delta passes, per domain, until a delta pass finds nothing | `PRODUCTION_DATA_WRITE` | delete by source marker |
| 5 | Deploy the trusted runtime with the write contracts — **all flags OFF** | `DEPLOYMENT` | previous deployment |
| 6 | Deploy the frontend build that *can* use both paths — **all flags OFF** | `DEPLOYMENT` | previous build |
| 7 | `normalized_reads_shadow=on`; run the parity harness | `DEPLOYMENT` | flag off |
| 8 | `server_writes_enabled=on` with `server_write_canary=on` | `DEPLOYMENT` | flag off |
| 9 | Widen the canary → `SERVER_WRITE_PRIMARY` | `DEPLOYMENT` | re-narrow the canary |
| 10 | Raise `minimum_write_version`; **verify the refusal is distinguishable** from a transient error | `DEPLOYMENT` | lower the floor |
| 11 | **REVOKE** direct write on the legacy document from `anon` — *the fence* | `PRODUCTION_SCHEMA_WRITE` | `GRANT` back |
| 12 | Final reconciliation pass against the now-stationary source | `PRODUCTION_DATA_WRITE` | idempotent; re-run |
| 13 | `normalized_reads_enabled=on` — **the read cutover** | `DEPLOYMENT` | flag off → `LEGACY_READ_FALLBACK` |
| 14 | Post-cutover soak | `READ_ONLY` | — |
| 15 | M15 reporting views; `CREATE INDEX CONCURRENTLY`, checking `indisvalid` after **each** build | `PRODUCTION_SCHEMA_WRITE` | `DROP` |
| 16 | `new_reporting_enabled=on` | `DEPLOYMENT` | flag off |
| 17 | Raise `minimum_read_version` — **the hard client floor** | `DEPLOYMENT` | lower the floor |
| 18 | M16: decompose `picks` → `predictions`; scoring parity gate | `PRODUCTION_DATA_WRITE` | drop the rows; `picks` is retained |
| 19 | Stop mirroring the legacy document — **`LEGACY_FROZEN`** | `DEPLOYMENT` | **forward fix only** |
| 20 | Observe zero legacy reads for longer than the longest plausible session (step 0.4) | `READ_ONLY` | — |
| 21 | **Contract: drop the legacy structures** | `PRODUCTION_SCHEMA_WRITE` | **restore from backup only** |
| 22 | **Verify the contract**: run the reporting parity harness, confirm the money spine row counts are unchanged from the step-20 reading, and re-derive the audit chain with the database's own functions | `READ_ONLY` | — |

Step 22 is not optional and is not the soak. Step 21 is the only step in the sequence whose sole recovery
is a restore, which makes it the step where the gap between "it worked" and "we know it worked" is most
expensive — a restore taken an hour late costs an hour of writes. Until step 22 passes, the cutover is not
complete; it is merely finished.

### Step 4 — the M10 audit backfill runs as `migration_role`, and not as a superuser

The audit backfill is the one step in the sequence that needs a trigger to stand down, so it is the one
step whose *execution context* has to be stated rather than assumed. `scripts/db/audit_chain_backfill.mjs`
is the authority; this is what an operator has to have arranged before step 4 starts.

**Who runs it.** `migration_role`, exactly as `model/rls_model.json` already defines it — non-superuser,
DDL authority, `BYPASSRLS`. Two privileges are load-bearing and there is no third:

| Privilege | What needs it | Already ratified in |
|---|---|---|
| `OWNER` of `audit.audit_events` | `ALTER TABLE … DISABLE/ENABLE TRIGGER` on the one named chain trigger | `model/rls_model.json` — DDL authority |
| `BYPASSRLS` | the promoting `INSERT`, past `FORCE ROW LEVEL SECURITY` (whose only `INSERT` policy is the runtime's) | `model/rls_model.json` — migration_role |

**SUPERUSER is not required and must not be granted for this.** An earlier draft suspended triggers with
`SET LOCAL session_replication_role = replica`. That is superuser-only, and it *also* switches off foreign
key enforcement for the whole session. It is replaced by
`ALTER TABLE audit.audit_events DISABLE TRIGGER audit_events_compute_chain` — one named trigger, inside
the promoting transaction, re-armed before commit. Foreign keys keep firing; the four append-only refusal
triggers keep firing; RLS is never toggled. Proven end to end against a non-superuser role by the F027
lab, including negative controls showing neither the service runtime nor the browser principal can invoke
the bypass. See ADR-K07.

**What to check after step 4.** The plan's final `trigger_state` step: every trigger on
`audit.audit_events` must report `tgenabled = 'O'`. A committed promotion that left the chain trigger
disabled is a silent hole — the next live append would store whatever hash its caller supplied.

**If the promotion fails,** it fails as one transaction and leaves nothing: no rows, and the trigger
re-armed by the rollback. Re-stage and re-run; the preflight refuses a second run against a target that
is already chained.

### Step 11 — the fence, and what it is not

`scripts/db/legacy_fence.mjs` generates the statements, their rollback, and the verifier.
`docs/bolao/db-modernization/rls-drafts/LEGACY_WRITE_FENCE.draft.sql` is the artefact to apply.

**The fence is a privilege denial, not a flag.** `legacy_writes_allowed=false` renders a clear message
instead of an opaque one; it does not stop anything. A stale tab holds the anon key and never re-reads a
flag. Treating the flag as the fence is the FS-4 mistake.

**What it does:** `REVOKE INSERT, UPDATE, DELETE ON public.bolao_state` from `anon` and from
`authenticated` — named privileges on the named table, never `REVOKE ALL`, never a schema wildcard.

**What it deliberately leaves alone**, each for a reason that costs a cutover if ignored:

| Untouched | Why |
|---|---|
| `SELECT` for both roles | step 11 precedes the read cutover at step 13 — the app still reads this document |
| the six legacy policies | "legacy policies are NOT modified while any client still reads the document", and a dropped policy cannot be restored without re-authoring its text, which is not a rollback |
| `service_role`'s writes | it mirrors into the document until `LEGACY_FROZEN` at step 19 |
| the six `lottery_*` tables | another product; a wildcard would silently change its access model mid-cutover |

**Verify immediately after applying**, with `fenceVerifySql()` / `fenceFailures(rows, 'AFTER_FENCE')`.
It reads every legacy table and every app role, so it catches a fence that closed too little *and* one
that reached too far. Run it in the `BEFORE_FENCE` phase first: if the path is already shut, the fence is
a no-op and a green verdict afterwards means nothing.

**The fence covers the VIEWS too, and until 2026-08-11 it did not (KPLUS-F058).** Production carries two
projections of the migration subject — `bolao_state_public` and `bolao_state_public_cdb`. `anon` holds
INSERT/UPDATE/DELETE on both, inherited from Supabase's blanket default privileges on `public` rather than
from their own source files, which grant only SELECT. Both are auto-updatable on their simple columns and
run with their **owner's** privileges (`security_invoker` off), and `bolao_state` is ENABLE RLS, not FORCE,
so the owner is exempt.

NIGHT-27 measured the consequence on real PostgreSQL: with the old fence applied, `UPDATE
public.bolao_state_public SET updated_at = now()` and `DELETE FROM public.bolao_state_public` **both
succeeded and both wrote `bolao_state`**. The step-11 fence was not a write denial. Worse, `fenceVerifySql()`
filtered `relkind = 'r'`, so the verifier could not see the relation the write travelled through and
reported the fence closed. The fence now revokes the write set on the views as well and preserves their
SELECT — they are the browser's read path under F10 and CDB2026 is in production.

**Rollback is one GRANT per (relation, role)** —
`LEGACY_WRITE_FENCE_ROLLBACK.draft.sql`, generated from the same constants so it can only restore what
the fence removed. Reversing the fence does not reverse the cutover: writes the replacement path accepted
while it was closed are in the target schema, so reopening means both representations take writes again.

**A counting trap worth knowing before you verify by hand (KPLUS-F037).** Under RLS, an `UPDATE` or
`DELETE` whose rows are all filtered out **succeeds and affects nothing**. Only `INSERT` raises. So "the
statement did not error" does not mean the write was permitted — check rows affected. `anon` holds
`DELETE` on the document today with no policy admitting one: the delete succeeds and removes zero rows.

### Two open questions the fence work surfaced

**Can `service_role` actually mirror into the legacy document? (KPLUS-F039 — needs one production read.)**
Steps 5–19 assume the runtime mirrors writes into `public.bolao_state` until `LEGACY_FROZEN`. On the
restored baseline it cannot: every policy on that table is `TO anon`, and the local `service_role` has
`rolbypassrls = false`, so its `UPDATE` affects **zero rows** and its `INSERT` is refused by RLS. Roles
are cluster-global and are not carried by a database-level dump, so the local role's attributes are **not
evidence about production** — Supabase conventionally creates `service_role` with `BYPASSRLS`, which would
make mirroring work. This campaign cannot read production to settle it. The check is one row:
`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role';` If it is false, mirroring needs a
policy admitting `service_role` on `bolao_state` before step 5, and that policy is a legacy-policy change
— which the choreography permits at exactly two points, one of them being the fence.

**A stale client's refusal is not distinguishable by SQLSTATE alone (KPLUS-F038).** GNG-7 asks for a
refusal distinguishable from a transient error. Measured: the fence's refusal and a row-level-security
refusal are **both `42501`**. Transient failures are cleanly separable (`57014` cancelled, `40001`
serialization, `40P01` deadlock → retry) and integrity refusals are separable (`23505` → conflict), so
the dangerous confusion — a permanent refusal read as transient, producing the infinite retry — cannot
happen. But "your build may never write here again" and "this row was rejected by a policy" arrive as the
same code. The runtime must carry its own signal; that is what the `CLIENT_TOO_OLD` envelope and the
`legacy_writes_allowed` flag are for. The flag is not the fence — but it *is* how the fence is explained.

### The ordering constraints that are not negotiable

- **5 before 8, 8 before 11.** The replacement write path must be *deployed*, then *enabled*, before the
  old one is denied. Doing 11 before 8 is a total write outage: old path denied, new one absent.
- **10 before 11.** The fence's error path is proven before the fence denies anything. Otherwise open
  tabs get an opaque error and retry forever, and users cannot tell a migration from an outage.
- **11 before 13.** Reads may not become authoritative while stale tabs still write the document
  directly — the normalized side is incomplete by exactly that set of writes.
- **13 before 19.** The cheap rollback (step 13's flag) exists only while the document is still written.
- **17 before 19.** The client floor exists to stop stale reads. Raising it *after* the document goes
  stale protects nothing. (This is the correction recorded as WS5-F1.)
- **20 before 21.** Without a measured absence of readers, the drop is a guess.

A deployment and an activation are always **two steps**, in that order. That is why no step both ships
code and turns it on.

---

## 4. Per-step promotion check

Before advancing any step, run the evaluator. It returns `PROMOTE` / `HOLD` / `ROLLBACK` / `BLOCKED`.

```bash
node scripts/db/test_choreography.mjs      # 187 tests, 1 378 assertions
node scripts/db/simulate_cutover.mjs       # 6 simulations
```

**Missing evidence is `HOLD`, never a pass.** For a `HIGH_RISK_FINANCIAL` or `CRITICAL_SCORING` domain
there is no manual "looks good" promotion: the evaluator refuses to promote without gate evidence.

`BLOCKED` means an operator decision or an external prerequisite is missing — more evidence will not
change it. `HOLD` means keep gathering.

---

## 5. Freeze window (pending L-OP-1)

Recommended: **`SHORT_WRITE_FREEZE`** — writes refused with a clear message; reads unaffected.

The window must satisfy all of:

- `NO_OPEN_CUTOFF` — no pool with an open prediction window
- `NO_ACTIVE_SYNC` — no result synchronization in flight
- `NO_UNRESOLVED_RECONCILIATION` — no open financial discrepancy
- `NO_PENDING_PAYOUT` — not between a pool concluding and its prizes being paid
- `NO_CONCURRENT_ADMIN_SESSION` — no open admin session
- `AVOID_MATCH_DAY` — not while matches are being played

These are **checked states, not calendar guesses**. For copa2026 (concluded, archived) all six are
trivially satisfied — which is the concrete reason it goes first.

---

## 6. Abort criteria — stop immediately, no discussion

| Id | Condition |
|---|---|
| AC-1 | **any** financial mismatch, of any magnitude — one cent and a hundred dollars are the same bug |
| AC-2 | any scoring mismatch — real money is paid on rank |
| AC-3 | an authorization regression: anything reachable that was not reachable before |
| AC-4 | unexpected schema drift — every downstream gate is then evaluating something other than what it thinks |
| AC-5 | a transformer classifies a backfill conflict as `CONFLICT` or `FATAL` |
| AC-6 | outbox duplication — one operation, two delivered notifications. **Damage is external and irreversible.** |
| AC-7 | a critical error-rate spike above the step 0.2 baseline |
| AC-8 | unrecognized stale-client behaviour — the matrix is the whole basis for believing old tabs are safe |
| AC-9 | the idempotency store is unavailable, or records were pruned inside the retention window |

On abort: **stop, do not proceed to the next step, do not "fix forward" past a money or scoring
mismatch.** Roll back to the last state whose rollback class is not `FORWARD_FIX_ONLY` and diagnose
there.

---

## 7. Rollback quick reference

| Currently at | Rollback is |
|---|---|
| steps 1–4 | `DROP` or delete by source marker |
| steps 7–9, 13–16 | a flag flip |
| steps 10–11 | a `GRANT` — a production privilege write, needing the credential that can issue grants |
| steps 17–18 | lower the floor / drop the rows (`picks` is retained) |
| **step 19 onward** | **forward fix only.** The legacy document is stale. |
| step 21 | restore from backup — and no restore has been rehearsed yet (GNG-2) |

---

## 8. Multi-app order

**copa2026 → cdb2026 → br2026.**

Shared domains (`participants`, `identity_links`, `payments`, `allocations`, `audit`, `outbox`) advance
at the **slowest** app and may not freeze until every app is `CUTOVER_READY`. Per-app domains advance
independently.

**The participant natural key is global across apps.** When running the participant backfill for the
second or third app, it must find and reuse rows the first app created. Keying it per app would
manufacture duplicate identities — the exact problem the normalization exists to solve (WS5-F7).

---

## 9. Still to be decided before step 1

| Decision | Status |
|---|---|
| M0 baseline registration | `PREPARED_NOT_EXECUTED` |
| L-OP-1 freeze window | open — recommendation: `SHORT_WRITE_FREEZE` |
| L-OP-2 client floor | open — recommendation: per-operation, see the choreography §14 |
| L-OP-3 parity run counts | open — configurable, minimums proposed |
| WS5-F4 legacy write-denial model | **CLOSED** — generated fence + rollback + verifier, rehearsed on the restored baseline |
| R-GAP-1 operator identity | open — no database-verifiable operator principal exists |
| Restore rehearsal | not performed |
| Backup key custody | out-of-band |
