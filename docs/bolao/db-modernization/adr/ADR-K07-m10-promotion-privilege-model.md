# ADR-K07 — the M10 promotion's trigger suspension and privilege model

Status: ACCEPTED · Campaign K++ (Governor Mode) · Class: YELLOW (autonomous with ADR)
Resolves: KPLUS-F027 · Found and resolved on the way: KPLUS-F028, KPLUS-F026b (test defect)
Supersedes: the promotion mechanism in ADR-K06 (everything else in ADR-K06 stands)
Governs: `scripts/db/audit_chain_backfill.mjs`, `AUDIT_CHAIN_DDL` in
`scripts/db/generate_migration_drafts.mjs`, `model/migration_choreography.json` `auditEnablement`,
`docs/bolao/db-modernization/CUTOVER_RUNBOOK.md` step 4

## Decision

The M10 bulk promotion stands down **one named trigger** for the length of **one transaction**:

```sql
BEGIN;
  ALTER TABLE audit.audit_events DISABLE TRIGGER "audit_events_compute_chain";
  INSERT INTO audit.audit_events (...) SELECT ... FROM audit_backfill.audit_events_staging ORDER BY ordinal;
  ALTER TABLE audit.audit_events ENABLE TRIGGER "audit_events_compute_chain";
COMMIT;
```

It runs as **`migration_role`**: non-superuser, owner of `audit.audit_events`, holding `BYPASSRLS`.
Both privileges are already ratified in `model/rls_model.json`. **No new production privilege is
required, and SUPERUSER is not required.**

`SET LOCAL session_replication_role = replica` is removed from the procedure, from the F014 lab, and
from the F023 lab.

## The problem

ADR-K06's promotion suspended triggers with `session_replication_role = replica`. The local rehearsal
passed because `rehearsal_owner` is a superuser and owns every audit object. Production is not that:

1. `session_replication_role` is **SUSET** — a non-superuser migration role cannot set it. The procedure
   would have failed at cutover, not in rehearsal.
2. It disables **foreign key** triggers along with user triggers, session-wide. ADR-K06 compensated with
   a post-hoc `orphan_actor` read, which is a constraint enforced by a report instead of by the database.
3. It disables the four **append-only refusal** triggers too, creating — for the duration — exactly the
   tool the audit design refuses to build: a session in which audit history can be UPDATEd or DELETEd.

## Why this was not an operator question

The privilege set is one that `model/rls_model.json` already grants `migration_role`. Nothing is
broadened; a superuser requirement is *narrowed away*. Business, financial, scoring meaning and PII
exposure are unchanged, production is untouched, and the change is reversible by replaying the previous
definition of the module. That is YELLOW, and it stays YELLOW precisely because the answer did **not**
turn out to need a new high-risk production privilege — which is the condition under which the operator
directive said to escalate.

## Why the trigger has to stand down at all

Not for hash agreement. F014-7b measured the bulk builder and the append trigger producing **identical**
hashes over the same rows in the same order. Two other reasons, both measured:

- **Order.** The bulk chain is defined by `ordinal`, a stated input. The trigger chains rows in whatever
  order the executor emits them, which PostgreSQL does not promise for a `BEFORE` trigger. F014-7c: the
  same 52 rows fed in reverse matched the bulk chain on **0** rows.
- **Cost.** F014-9c: 200,000 events through the per-row trigger did not finish inside a 60s budget —
  19x what the bulk chain pass needed for the same rows (KPLUS-F014).

## The decisions inside this one

**1. What mechanism replaces the session-wide switch?**
*Chosen:* `ALTER TABLE … DISABLE TRIGGER <name>`, which requires table ownership and nothing more.
*Alternatives considered:*
- *A maintenance-flag table the trigger consults.* Rejected. It keeps a permanent bypass branch inside
  the security-relevant trigger, and a transaction that commits with the flag set leaves the bypass on
  globally with no catalog evidence that anything is wrong.
- *A custom GUC (`SET LOCAL audit.backfill = on`) read by the trigger.* Rejected outright: any role may
  set a GUC in a custom namespace, so the "privileged" flag would be forgeable by `anon`.
- *`ALTER TABLE … NO FORCE ROW LEVEL SECURITY` for the load.* Rejected. It edits the table's own security
  declaration, so the production stance would depend on a migration having remembered to put it back.
  F027-2c records that the owner *can* do this — the procedure not doing it is a choice, not a limit.
- *Making `compute_event_chain()` SECURITY DEFINER and branching inside it.* Rejected as a larger change
  to a security-relevant function than the problem needs, and it adds an escalation surface.

**2. How is the suspension prevented from widening later?**
Three independent guards, all of which are shown to fail:
- `triggerStateSql()` / `triggerStateFailures()` — a postcondition step in the plan asserting every
  trigger on the table, internal RI triggers included, is `tgenabled = 'O'`. F027-9a disables the chain
  trigger and confirms the check reports it.
- The repo test forbids `session_replication_role` and `DISABLE TRIGGER ALL|USER` in any plan step, and
  forbids any step touching `ROW LEVEL SECURITY`.
- PostgreSQL itself: F027-2b shows `DISABLE TRIGGER ALL` is **refused** to the non-superuser owner. The
  narrowness is enforced by the server, not by convention.

**3. How does the promotion get past `FORCE ROW LEVEL SECURITY`?**
*Chosen:* `BYPASSRLS` on `migration_role`, the attribute `model/rls_model.json` already assigns it.
F027-5a/5b prove it is the *minimum*: removing the attribute refuses the identical statement with
`new row violates row-level security policy`, restoring it makes the identical statement succeed.
*Alternative:* an INSERT policy `TO migration_role`. Rejected — the RLS model states migration_role has
no policies by design, so that it can never be reachable as an application principal.

## KPLUS-F028, found by proving this

Building the F027 lab surfaced a live defect nothing before it could see. `audit.compute_event_chain()`
is SECURITY INVOKER, so the two calls **inside its body** are ordinary calls checked against the writing
role. KPLUS-F023's `REVOKE ALL … FROM PUBLIC` on `audit.event_canonical_v1` and `audit.event_hash_v1` is
correct, and it also took EXECUTE away from the runtime: **every audit append by a non-superuser writer
fails** with `permission denied for function event_hash_v1`. Every rehearsal before this one wrote as a
superuser, so it passed unnoticed — the same asymmetry as KPLUS-F013 and as this ADR's own subject.

*Fix:* `GRANT EXECUTE … TO service_role` on those two functions, and nothing else. Both are `IMMUTABLE`,
take everything they use as arguments, read no table and hold no privilege; being able to call them buys
a caller a SHA-256 of a string it already had, and it cannot forge a chain entry because the trigger
overwrites any client-supplied hash. The KPLUS-F023 gate is narrowed accordingly: a grant back to
`PUBLIC`, `anon` or `authenticated` is still forbidden, and anything granted must still be revoked from
PUBLIC first.

## Evidence

| Claim | Where |
|---|---|
| The migration role is NOSUPERUSER and owns the audit spine it migrated | F027-1a/1b |
| It **cannot** set `session_replication_role` | F027-2a |
| It **cannot** `DISABLE TRIGGER ALL` — the FK triggers are out of reach | F027-2b |
| Foreign keys fire during promotion: a dangling actor refuses the whole load | F027-3a |
| An aborted promotion re-arms the trigger with no compensating step | F027-3b/3c |
| The full plan runs end to end as that role; the chain verifies | F027-4a/4b |
| Every trigger is armed afterwards; FORCE RLS unchanged on all three tables | F027-4c/4d |
| BYPASSRLS is necessary and sufficient — removed, then restored | F027-5a/5b |
| Neither the runtime nor the browser principal can invoke the bypass, by any of three routes | F027-6a–6f |
| Append-only refusal is armed **during** the suspension | F027-7a |
| KPLUS-F028: the append fails without the grant and succeeds with it | F027-8a/8a' |
| The postcondition catches a promotion that forgot to re-arm | F027-9a |
| The lab disposes of its database and all three roles | F027-10a |
| M10 rehearsal on the real target, new mechanism, 200,000 events | F014 27/27 |
| The live target's runtime can execute both chain functions | F023-2c |

Fingerprints: `fingerprints/F027_m10_least_privilege.json` (32/32),
`fingerprints/F014_audit_chain_backfill.json` (27/27), `fingerprints/F023_function_acl.json` (12/12).
Repo: `node scripts/gates.mjs` 45/45, 33 suites; the three `audit_scoring.py` all pass.

## Also fixed: a timing-dependent control (KPLUS-F026b)

F014-9b asserted a specific stale query plan while reading `reltuples` as it found it. That made the
control depend on whether an autovacuum worker had visited the table, and it failed for that reason
during this work. The condition under test is "the planner's statistics predate the bulk load", so the
lab now `ANALYZE`s the **empty** table to establish it deterministically. The KPLUS-F026 finding is
unaffected and the evidence is sharper: estimate `0 → 200,000`, plan `Nested Loop → Nested Loop` before,
`Nested Loop → Hash Anti Join → Seq Scan` after.

## How to reverse it

Replace the three `txn: "promote"` steps in `backfillPlan()` with a single `promote` step wrapped in
`SET LOCAL session_replication_role = replica`, and drop `triggerStateSql`/`triggerStateFailures`,
`disableChainTriggerSql`/`enableChainTriggerSql` and `MIGRATION_ROLE_PRIVILEGES`. Doing so reinstates
the superuser requirement and the session-wide FK suspension, and F027 fails at 2a, 3a, 6c and 7a.
The KPLUS-F028 grants are independent of this and must **not** be reverted with it — reverting them
breaks audit appends for every non-superuser writer.
