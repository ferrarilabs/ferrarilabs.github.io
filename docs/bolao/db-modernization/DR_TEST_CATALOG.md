# DR_TEST_CATALOG — recurring disaster-recovery test programme

**Workstream Y.**

Status: **CATALOG DEFINED. NOT YET EXECUTED.**

> **RPO and RTO are NOT claimed anywhere in this document.** No rehearsal has produced a measurement, so
> any number here would be a guess wearing a number's authority. §5 defines how they will be measured;
> §6 states what may be said in the meantime.

---

## 1. Test inventory

Each test names its cadence, what it proves, its evidence, and the failure class (Workstream P taxonomy)
it maps to. `DRY` tests touch nothing; `SCRATCH` tests require a disposable project.

| Id | Test | Cadence | Mode | Proves | Failure class |
|---|---|---|---|---|---|
| Y-1 | **Backup readability** — `pg_restore --list` parses the archive | every backup | DRY | the archive is a well-formed dump, not a truncated file | F1 |
| Y-2 | **Decryptability** — decrypt with the intended key, verify the auth tag | every backup | DRY | the key in custody actually opens this archive | F2 |
| Y-3 | **Integrity** — archive digest and plaintext digest match the manifest | every backup | DRY | the bytes are what was produced | F3 |
| Y-4 | **Toolchain compatibility** — recorded server/client majors are mutually restorable | every backup | DRY | a future restore will not be blocked by version skew | F4 |
| Y-5 | **Schema restore** — restore schema-only into a scratch project | monthly | SCRATCH | the DDL applies cleanly and completely | F5, F6 |
| Y-6 | **Data restore** — full restore into a scratch project | quarterly | SCRATCH | rows arrive | F5, F8 |
| Y-7 | **Constraint validation** — PK/FK/UNIQUE/CHECK counts match expectations | with Y-6 | SCRATCH | restored data is protected, not merely present | F9 |
| Y-8 | **Policy and RLS validation** — RLS enabled per table; policy body hashes match a known generation | with Y-6 | SCRATCH | the restored copy is not more permissive than the original | F10, F11 |
| Y-9 | **Function restore** — functions present; `SECURITY DEFINER` ones carry an explicit `search_path` | with Y-6 | SCRATCH | no privilege-escalation vector arrives with the restore | F6 |
| Y-10 | **Synthetic-auth compatibility** — an identity-aware policy evaluates correctly for a synthetic user | with Y-6 | SCRATCH | policies work against a real `auth.uid()`, not just syntactically | F11 |
| Y-11 | **Application smoke** — the app, pointed at the restored copy, can create an entry, submit a prediction, read every report and verify the audit chain | quarterly | SCRATCH | the restore is *usable*, not merely structurally correct | — |
| Y-12 | **Unexpected-object scan** — nothing arrived that was not expected | with Y-5/Y-6 | SCRATCH | the archive is what it claims and the target was empty | F7 |
| Y-13 | **Isolation audit** — the scratch target has no production secrets, no email sending, no webhooks, no scheduled jobs, no public reachability | before every SCRATCH test | SCRATCH | a rehearsal cannot act on the real world | F12 |
| Y-14 | **Production-reference refusal** — the harness refuses when any input names production | before every SCRATCH test | DRY | the safety gate is live, not decorative | F13 |
| Y-15 | **RPO evidence** — measure the gap between the latest archive and the last committed transaction | quarterly | DRY | how much data a restore would lose | — |
| Y-16 | **RTO evidence** — measure wall-clock from "decision to restore" to "app serving from the restored copy" | quarterly | SCRATCH | how long recovery takes | — |

Y-1 to Y-4 and Y-14 are automatable today and require nothing but the archive and its manifest. They should
run on **every** backup, because a backup nobody has opened is a hope, not a backup.

## 2. Ordering, and why it is fixed

Y-13 and Y-14 run **first**, always. Everything else is worthless — and potentially harmful — if the target
is not isolated or if an input names production. A rehearsal wired to real data is not a rehearsal; it is an
incident with a rehearsal's paperwork.

Y-1..Y-4 then run before any restore is attempted: there is no point measuring restore time for an archive
that will not decrypt.

## 3. Evidence

Every run emits a machine-readable record (the `verifyRestore` observation shape) containing:

- test ids, verdicts, and failure classes
- digests, versions, counts
- timings for Y-15/Y-16
- the scratch project reference, **proven not to be production**

**Digests and counts only.** No participant row, no email, no payment reference, no key. The evidence file
is designed to be shareable; the archive it describes is not.

## 4. Cadence rationale

| Cadence | Tests | Why |
|---|---|---|
| Every backup | Y-1..Y-4, Y-14 | cheap, fully automatable, and they catch the failure that is otherwise SILENT until the day it matters |
| Monthly | Y-5 | schema drift is the most likely thing to break a restore, and schema-only is fast |
| Quarterly | Y-6..Y-13, Y-15, Y-16 | a full restore costs a scratch project and real time; quarterly balances that against the risk |
| Before any destructive phase | **all of them** | M16 and every contract step are irreversible; the backup must be *proven* first, not assumed |

## 5. How RPO and RTO will be measured

**RPO (data loss on recovery):**
```
RPO_observed = (timestamp of latest committed transaction) − (timestamp of latest verified archive)
```
Measured at the moment of the test, not designed as a target. Report the **maximum observed across runs**,
never the average — the average describes a good day, and recovery happens on a bad one.

**RTO (time to recover):**
```
RTO_observed = (app serving from the restored copy) − (decision to restore)
```
Measured wall-clock, **including** the parts nobody thinks to count: locating the key, provisioning the
target, waiting on the restore, repointing configuration, and verifying the app. Excluding those is how
published RTO figures become fiction.

Each run records both. After three runs, report the range and the maximum.

## 6. What may be said before any measurement exists

Permitted: *"A logical backup exists, is encrypted, and its integrity has been verified. Restore has not
yet been rehearsed end to end, so recovery time is unknown."*

**Not** permitted: any RPO or RTO figure, any "we can recover in X", or any claim that recovery is "tested"
because the backup was verified. Verifying an archive proves it is readable; it does not prove anything
about how long recovery takes or how much is lost.

## 7. Blocked

Y-5..Y-13 and Y-16 require a disposable scratch project (B-07). That provisioning is currently unavailable,
so those tests are **BLOCKED, not skipped** — the distinction matters, because a skipped test drops off the
list while a blocked one keeps its place.

Y-1..Y-4, Y-14 and Y-15 are **not blocked** and can run against the existing archive and manifest as soon as
a manifest in the v2 shape exists (Workstream Q).

## 8. Open operator decisions

| Id | Decision |
|---|---|
| **Y-OP-1** | Provision a disposable scratch project so Y-5..Y-13 can run, or accept that restore remains unrehearsed. |
| **Y-OP-2** | Who runs the quarterly cycle, and where is the evidence kept? An unowned recurring test stops recurring. |
| **Y-OP-3** | Is there an RPO/RTO the platform actually needs? The measurement programme produces numbers; only an operator can say whether they are good enough. |
