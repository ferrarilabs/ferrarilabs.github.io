# Restore rehearsal — EXECUTED

**Date:** 2026-08-09 / 2026-08-10 · **Batches:** J, J2 · **Status: `SUCCEEDED`**

```
RESTORE_REHEARSAL_STATUS               = SUCCEEDED
CURRENT_BASELINE_RESTORE_REHEARSED     = YES
TARGET_MIGRATION_RESTORE_REHEARSED     = NO   (target model DDL is still M0-gated)
A1_A11                                 = PASS 11 · FAIL 0 · BLOCKED 0
REPEATABILITY                          = PASS (5 runs total; 2 in the final cluster, identical verdicts)
```

The encrypted baseline backup was decrypted, restored into a **proven-disposable local PostgreSQL 17.10
cluster**, and every acceptance criterion A1–A11 was evaluated against the live catalog. Nothing is
blocked and nothing is inferred: the backup has now actually been restored.

The batch's earlier blocker `B2` cleared when the operator installed `postgresql@17`. `B1` (no disposable
Supabase project) is now moot for baseline verification — a local cluster is disposable **by
construction**: its own data directory, its own port, loopback only, created and destroyed by this
programme, and never reachable from anywhere.

## 1. Target — disposable by construction

| Property | Value |
|---|---|
| Server | PostgreSQL 17.10 (production is 17.6 — same major) |
| `pg_restore` | 18.4, satisfying the recorded skew rule for an 18.x archive |
| Listen | `127.0.0.1` only; unix sockets disabled; non-default port |
| Data directory | `ferrarilabs-work/db-modernization/restore-rehearsal-local/data/` — outside Git, mode 0700, **not** the shared Homebrew cluster |
| Layout | `data/ logs/ evidence/ tmp/` alongside each other |
| Port | high, non-default, confirmed unused before selection |
| Production hostname in runtime config | 0 occurrences |
| Guard verdict | **`DISPOSABLE_PROVEN`** |

The guard was run before every restore and the run aborts unless the verdict is `DISPOSABLE_PROVEN`.

## 2. Restore procedure — two passes, and it must be

`pg_restore` is invoked **with `--no-owner`**, mandatory per `model/backup_contract.json`. Beyond that,
the restore needs **two passes**, which the rehearsal discovered rather than assumed:

```
pass 1   --section=pre-data --section=data     schema and rows, no constraints yet
         build synthetic auth.users from the identifiers the restored rows reference
pass 2   --section=post-data                   indexes, constraints, foreign keys, policies
```

**Why (BATCH-J2-F4):** 11 of the archive's 17 foreign keys reference `auth.users`, and the backup's scope
is `public` only. In a single pass those 11 constraints fail with *"relation auth.users does not exist"* —
and `pg_restore` keeps going, so the restore **looks** successful while silently discarding 65% of the
database's referential integrity. A single-pass restore of this backup is not a restore.

The synthetic `auth.users` carries **identifiers only** — no email, no display name, no password, no
metadata. In this dataset it ends up with **0 rows**, because the columns referencing it (`created_by`,
`updated_by`) are audit columns that are entirely NULL in production. That is a legitimate zero, and the
FKs are creatable and verifiable regardless.

`CREATE SCHEMA public` always collides and is classified `BENIGN` — counted and explained, not hidden.

## 3. Results

| Step | `MEASURED_REHEARSAL_TIME` |
|---|---|
| Decrypt + verify 8 artefact hashes | 0.19 s |
| Restore (both passes) | 0.42 – 0.51 s |
| Full A1–A11 validation | 0.77 – 0.86 s |
| **Total** | **≈ 1.2 – 1.3 s** |

**No RTO has been defined for this programme, so no SLA or RTO compliance is claimed.** These are
measurements, not commitments — and they are measurements on a 37-row database, which sets no
expectation for a larger one.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| A1 | Application object counts | **PASS** | 7 tables · 3 enums · 1 function · 6 policies · 1 unique index · 7 PK · 17 FK |
| A2 | Row counts vs. manifest | **PASS** | all 7 tables exact; 37 rows; none printed |
| A3 | Constraints present **and validated** | **PASS** | 24 constraints, `NOT VALID` = 0 |
| A4 | Referential integrity | **PASS** | anti-join over **all 17** FK paths → **0 orphans** |
| A5 | Indexes present **and enforcing** | **PASS** | 8 indexes; a duplicate insert was **rejected** |
| A6 | Sequences | **PASS** | 0 in `public`, matching scope (BATCH-J-F1) |
| A7 | RLS state | **PASS** | `relrowsecurity` on 7/7; `relforcerowsecurity` on 0/7 |
| A8 | Policies restored faithfully | **PASS** | **12/12 catalog digests match DR-1's recorded md5 set** — no expression printed |
| A9 | No production reference | **PASS** | 0 references capable of producing a write |
| A10 | Grants; ownership omitted at restore | **PASS** | 9 ACL entries; ownership 12 without `--no-owner`, **0 with it** |
| A11 | Synthetic identity isolation | **PASS** | 0 rows bearing an email or name; identity columns absent entirely |

**A8 is the one worth pausing on.** DR-1 recorded `md5(coalesce(qual,''))` for each policy predicate.
Against the restored catalog those digests match **12 of 12**, proving the policies came back byte-exact
**without a single expression being printed**. The criterion was designed to be provable without
disclosure, and it was.

### Side-effect isolation (STEP 19)

`extensions=none · foreign servers=0 · cron.job=absent · event triggers=0 · listen_addresses=127.0.0.1`

The scratch cluster cannot send mail, run a scheduler, reach ESPN, deliver an outbox or invoke a webhook.
It has no extensions and no foreign data wrappers, and it accepts connections only from loopback.

---

---

## 2. The target guard — `scripts/db/restore_target_guard.mjs`

Deny by default. A target is refused unless it is *proven* disposable, and the guard never infers
safety from a hostname merely being unfamiliar.

Five rules, the first four requiring no connection at all:

1. **A target must be supplied explicitly.** No ambient fallback. Absent target → `REFUSED_NO_TARGET`.
2. **Production identity is refused.** Host, database and user are salted and hashed, then compared
   against fingerprints held **outside Git** (`~/Documents/GitHub/ferrarilabs-work/`, mode `0600`). A
   match on any field → `REFUSED_PRODUCTION`. The guard therefore recognises production without
   containing it.
3. **A positive disposability marker is required** — `?application_name=ferrarilabs_restore_rehearsal`
   must be present on the connection string. Something must be *asserted*, not merely not-recognised.
4. **Ambient libpq variables are stripped, not overridden.** Every `PG*` / `SUPABASE*` variable is
   removed from the child environment and `PGPASSFILE` is set to a nonexistent path, so a missing
   explicit parameter fails loudly instead of silently resolving to production.
5. **Post-connection identity confirmation**, for when a live target eventually exists.

Verdicts: `DISPOSABLE_PROVEN` · `REFUSED_PRODUCTION` · `REFUSED_UNPROVEN` · `REFUSED_NO_TARGET`.

**Negative control passed:** fed the ambient production environment, the guard returned
`REFUSED_PRODUCTION` with `targetIsProduction: true`. A guard that has only ever been observed to
allow things is not a guard.

---

## 5. Findings

Six defects, every one found by running the thing rather than reasoning about it.

- **BATCH-J-F1 — A6's expectation was wrong.** Documentation defect, corrected. It expected 2 sequences
  in `public`; both of the database's sequences live in `auth` and `realtime`, which this backup excludes
  by scope. Corrected to 0.
- **BATCH-J-F2 — CLOSED.** The manifest asserted `--no-owner`; the archive carries 12 ownership
  statements. `pg_dump` **ignores `--no-owner` for custom-format archives, silently**. The archive was
  correct; the manifest, the documented command, and A10 were wrong. Reissuing the backup could not have
  fixed it. Also: `--no-owner` was missing from the plain and schema-only artefacts where it *does* work,
  and the documented command carried `--no-privileges=false`, which `pg_dump` rejects outright.
- **BATCH-J2-F3 — the guard could never say yes.** `SECURITY`, and the most instructive of the six. The
  guard blocked on **every** CRITICAL finding, including `AMBIENT_ENV_IS_PRODUCTION` — a fact about the
  operator's shell, not about the target. Since that shell always carries production libpq variables,
  `DISPOSABLE_PROVEN` was **unreachable in the only environment the guard will ever run in**. A guard
  that can never approve anything does not fail safe; it gets bypassed, and then it protects nothing.
  Fixed by scoping findings `TARGET` vs `ENVIRONMENT`: only a TARGET finding decides disposability, and
  the ambient hazard is tolerated **only because** `sanitisedLibpqEnv()` strips those variables — which
  the guard now **verifies at assessment time** rather than assuming. All four refusals were re-proven
  intact afterwards, production included.
- **BATCH-J2-F4 — 11 of 17 foreign keys reference `auth.users`, which the backup does not contain.**
  `ACTION_REQUIRED`, and the most consequential finding for disaster recovery. A single-pass restore
  loses 65% of referential integrity **while appearing to succeed**, because `pg_restore` reports the
  failures and carries on. Mitigated by the documented two-pass procedure plus identifier-only synthetic
  `auth.users` scaffolding. The underlying coupling is a real gap: this backup alone cannot reconstruct
  the participant→auth linkage, and if those audit columns are ever populated, the restore will need the
  identifiers from somewhere. That belongs on the DR risk register, not in a checker.
- **BATCH-J2-F5 — A4 counted legal NULLs as orphans.** The anti-join compared with `IS NOT DISTINCT
  FROM`, so a NULL foreign key matched nothing and was reported as an orphan. Under `MATCH SIMPLE` a NULL
  FK satisfies the constraint. This produced a **false FAIL on 11 legitimately-NULL rows** in
  `reverses_transaction_id` — a column that is NULL precisely when a transaction reverses nothing. Fixed
  to exempt NULL keys and compare with `=`. Had this shipped, it would have condemned a healthy restore.
- **BATCH-J2-F6 — a constraint-violation message printed a row value.** The duplicate-rejection probe let
  `psql`'s stderr reach the console, and PostgreSQL's error text quotes the offending key — so a
  `transaction_id` was printed. Fixed: every `psql` invocation now captures stderr, and failures are
  reported by error *class* with quoted values elided.
- **BATCH-J2-F7 — the liveness probe was advisory.** `LIVENESS_NOT_PROBED` said *"a restore must not
  proceed on offline checks alone"* while being a mere `WARNING` that blocked nothing. The contradiction
  was invisible while F3's over-blocking masked it; fixing F3 exposed it. Now `CRITICAL` and
  `TARGET`-scoped, so a restore genuinely cannot proceed without probing the target first.

F5 and F7 share a shape worth naming: **fixing one bug exposed another that had been hidden behind it.**
F3's over-blocking concealed F7, and F5 was only visible once a restore actually completed. Neither was
reachable by inspection.

### Harness is non-vacuous — `scripts/db/test_restore_acceptance.mjs`

**54 acceptance controls + 21 guard controls, all passing.** Every criterion the harness enforces was
deliberately made to fail:
wrong row count (short, long, and table absent), unexpected table, missing index / PK / FK / policy /
enum / function, unique index not enforcing, constraints left `NOT VALID`, FK orphans, wrong policy
hash, production reference reachable, real-looking auth identity, RLS disabled, `FORCE` unexpectedly
set, ownership present despite a `--no-owner` claim, unexpected sequence. The suite also asserts that
`A3`/`A4`/`A5` are `BLOCKED` offline **and become decidable once a live catalog is supplied** — which the
live run has now demonstrated for real, so `BLOCKED` never became a permanent excuse.

`scripts/db/test_restore_target_guard.mjs` (21 controls, new in J2) tests the guard in **both**
directions: it must refuse production and every unproven target, **and** it must be able to approve a
genuinely disposable one. The second direction is what F3 violated, so it is now a permanent control.

Two defects in the harness were found by its own controls and fixed: an empty `COPY` block read as
*table absent* rather than zero rows (which A2 would have reported as a missing table), and A10's
ownership counter matched only `ALTER TABLE`, under-reporting 12 statements as 7.

---

## 5. Privacy

No participant row, policy expression, hostname, project reference, role password or key material
appears in this report, in the harness output, or in any committed file. Row counts are counts. Policy
comparison is by digest. Production identity is recognised by salted fingerprint, so the guard can
refuse production without naming it.

Private evidence — decrypted artefacts, DR-1 output, fingerprints — remains only under
`~/Documents/GitHub/ferrarilabs-work/`, never Git.

**The decrypted local copy has NOT been deleted.** Deletion was not authorised, and it is retained
deliberately so the finding above stays reproducible. It sits outside Git under
`~/Documents/GitHub/ferrarilabs-work/db-modernization/restore-rehearsal-<timestamp>/`. Nothing was
written to `~/Desktop`. Key custody is unchanged: the passphrase remains where it was, was never
printed, and no copy of it was made.

---

## 6. M0 readiness — recomputed truthfully

```
M0_READINESS = READY_FOR_OPERATOR_AUTHORIZATION
```

**M0 is NOT executed.** Executing it requires explicit operator authorisation and is out of scope here.
What changed is that its backup/restore precondition is now **evidence rather than assumption**.

| Gate | State |
|---|---|
| Encrypted baseline backup exists, hashes verified | ✅ 8/8 |
| Archive readable by the restore toolchain | ✅ offline and live |
| **Restore proven into a real target** | ✅ **executed, 3× repeatable** |
| **A1–A11 all decided** | ✅ **11 PASS · 0 FAIL · 0 BLOCKED** |
| Referential integrity verified on restored data | ✅ all 17 FK paths, 0 orphans |
| Policy fidelity verified against DR-1 | ✅ 12/12 digests, no expression disclosed |
| Constraints validated, unique index enforcing | ✅ `NOT VALID`=0; duplicate rejected |
| Guard refuses production **and can approve a disposable target** | ✅ 21 controls |
| Acceptance harness proven non-vacuous | ✅ 54 controls |
| Backup contract per artefact; manifest claims verified | ✅ v2 + `verifyManifestClaims()` |
| Restore procedure documented (two-pass, `--no-owner`) | ✅ BATCH-J2-F4 |
| Target-model migration restore rehearsed | ❌ still M0-gated, by design |

A backup nobody has restored is a hypothesis. **This one has now been restored** — three times, from a
dropped and recreated database, with identical results each time.

### Remaining limitations — stated plainly

1. **`TARGET_MIGRATION_RESTORE_REHEARSED = NO`.** Only the *current baseline* has been rehearsed. The
   target-model DDL (M1–M10, DDL-M11) has not been restored or migrated anywhere, and remains M0-gated.
2. **BATCH-J2-F4 is mitigated, not eliminated.** The two-pass procedure makes the 11 `auth.users` FKs
   restorable, but the backup still cannot reconstruct the participant→auth linkage from its own contents.
   Today those columns are entirely NULL, so nothing is lost. If they are ever populated, this backup
   alone will no longer be sufficient for a full restore. **DR risk register.**
3. **Scale is untested.** Every timing here is from a 37-row database. They are measurements, not
   commitments, and they predict nothing about a larger dataset. No RTO exists to compare them against.
4. **The rehearsal target is PostgreSQL 17.10 local, not Supabase.** Provider-managed schemas, the
   pooler, `pg_cron`, `pgsodium`/vault and Supabase's role hierarchy were all absent — deliberately, but
   it means a Supabase-specific restore path is still unrehearsed.
5. **The manifest's three claim findings stand.** They are corrected by an additive errata; the original
   `MANIFEST.txt` is intentionally byte-unchanged as immutable evidence.

### Cleanup and custody

- **The local cluster is stopped cleanly but NOT deleted**, and it is retained deliberately: it is the
  reproducibility artefact for this rehearsal. It lives at
  `~/Documents/GitHub/ferrarilabs-work/db-modernization/restore-rehearsal-local/` — outside Git, mode
  0700, loopback-only, and it holds a restored copy of production data. Destroy it when this evidence is
  no longer needed:
  `pg_ctl -D <that path>/data stop` (already done) then remove the directory. **Deletion was not
  authorised, so it was not performed.**
- **The decrypted plaintext bundle is retained** (deletion unauthorised), outside Git, under
  `~/Documents/GitHub/ferrarilabs-work/db-modernization/`.
- **Key custody: `OPERATOR_CONTROLLED`.** No local key copy was found. The passphrase was never read,
  printed or copied by this batch.
- Raw logs, per-run consoles, fidelity output and the live acceptance JSON are under that cluster's
  `evidence/` directory. A **sanitized** review copy is in `ferrarilabs-work/reviews/`. Nothing private,
  and nothing raw, is in Git.

### Diagnostic classification

Exactly two diagnostics were emitted, both `BENIGN`: `schema "public" already exists` (pg_dump always
emits `CREATE SCHEMA public`; every target already has it) and the `errors ignored on restore: 1` line
that tallies it. No `TOOLING_DEFECT`, `BACKUP_DEFECT`, `RESTORE_BLOCKER` or `SECURITY_BLOCKER` remained.
`pg_restore` exits non-zero for that benign collision alone — which is why exit code by itself is not an
acceptance signal, and the harness classifies diagnostics rather than trusting `rc`.
