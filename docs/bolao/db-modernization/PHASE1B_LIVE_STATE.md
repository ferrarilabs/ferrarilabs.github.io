# PHASE 1B — LIVE STATE: operational evidence and usage classification

**Status:** COMPLETE (read-only). No DDL, no migration, no privilege change.
**Collected (UTC):** 2026-08-07T21:32Z–21:41Z. **Server:** PostgreSQL 17.6.
**Production identifier:** `<KNOWN_PROJECT_REF>` (masked).
**Objective:** resolve `PRESENT_USAGE_UNKNOWN` using aggregate operational evidence, without
reading participant or business rows.

---

## 0. Corrections to the Phase 1 record (read this first)

Two corrections. Both were found in Phase 1B and both change conclusions previously reported.

### C-01 — Phase 1 section S09 was BLOCKED, not COLLECTED

`section_results.tsv` originally recorded S09 (types/enums) as `COLLECTED, row_count 0`. It had
actually failed:

```
ERROR:  could not implement GROUP BY
DETAIL:  Some of the datatypes only support hashing, while others only support sorting.
```

**Cause of the misclassification:** the collection harness classified failures by grepping
per-section stderr for `^ERROR:`. psql emits `psql:<file>:<line>: ERROR: …`, so the anchored
pattern never matched, and *any* failing section would have been silently recorded as
`COLLECTED` with `row_count 0` — indistinguishable from a legitimately empty section. A
re-audit with an unanchored pattern found **exactly one** failing section across all 37.

**Cause of the S09 failure — a defect in the approved query pack:** S09 ends with
`GROUP BY … t.typacl`, and `pg_type.typacl` is `aclitem[]`, which supports neither hashing nor
sorting. This is **deterministic and environment-independent**: S09 cannot succeed on any
PostgreSQL instance as written. It was never caught because the pack was authored as
`NOT EXECUTED` and this was its first live run.

**Corrected Phase 1 tally:** 35 COLLECTED / 1 SKIPPED_BY_PROBE (S16) / **1 BLOCKED (S09)**.

**Status:** NOT FIXED. Phase 1A artifacts are frozen. A corrected S09 (`GROUP BY t.oid`, or
`typacl::text`) requires an authorized Phase 1A revision with a new approved pack SHA. Recorded,
not patched.

**Evidence recovered instead** (targeted read-only, no enum labels printed): `public` holds
**3 enum types** (`participant_state` 3 labels, `payment_txn_type` 5, `lottery_role` 3) and 7
composite types; application schemas hold 61 enum/domain/composite/range types in total.

### C-02 — `anon` held `TRUNCATE` on 10 tables, not 7

The remediation report scoped "all 7 application tables" to schema `public`. The full pre-change
grant set was **10**: the 7 `public` tables plus `storage.buckets`,
`storage.buckets_analytics`, `storage.objects`. The authorized REVOKE covered the 7; the 3
`storage` tables were deliberately left untouched and remain `anon`-TRUNCATE-able.
`GLOBAL_ANON_TRUNCATE_ALL_SCHEMAS` = **3** (was 10). Open decision, see §5.

---

## 1. Statistics epoch — the interpretation constraint

| Field | Value |
|---|---|
| `stats_reset` | 2026-05-22 15:13:20 UTC |
| Accumulation window | **77 days 06:19** |

Every counter below is cumulative over that 77-day window. This matters: a low counter means
"little activity in 77 days", which is a materially stronger statement than "no activity
observed". Conversely no counter can prove an object is *unused* — only that it was not used
*during this window*. A single window is not a trend; nothing here is extrapolated.

---

## 2. Aggregate operational evidence (no row contents read)

| Table | seq_scan | idx_scan | ins | upd | del | live | dead | last autovacuum/analyze |
|---|---|---|---|---|---|---|---|---|
| `bolao_state` | **17 829** | 856 | 3 | **532** | 0 | 3 | 15 | 2026-08-05 |
| `lottery_admin_audit` | 3 | 0 | 1 | 0 | 0 | 1 | 0 | never |
| `lottery_draws` | 8 | 21 | 2 | 0 | 0 | 1 | 1 | never |
| `lottery_participants` | 6 | 30 | 20 | 0 | 0 | 10 | 10 | never |
| `lottery_participations` | 8 | 11 | 20 | 0 | 0 | 10 | 10 | never |
| `lottery_payment_transactions` | 4 | 11 | 11 | 0 | 0 | 11 | 0 | never |
| `lottery_pools` | 5 | 26 | 2 | 0 | 0 | 1 | 1 | never |

Buffer evidence: `bolao_state` 28 267 heap block hits, 0 disk reads (fully cached, hot). The six
lottery tables total 448 heap hits — three orders of magnitude lower.

Index read paths actually exercised:

| Index | idx_scan | Interpretation |
|---|---|---|
| `bolao_state_pkey` | 856 | Primary lookup path in use |
| `lottery_participants_pkey` | 30 | Light |
| `lottery_pools_pkey` | 26 | Light |
| `lottery_draws_pkey` | 21 | Light |
| `lottery_participations_pkey` | 11 | Light |
| `lottery_payment_transactions_external_reference_uidx` | 11 | **Uniqueness probes on 11 inserts** — the txId governance rule is being enforced by the database |
| `lottery_payment_transactions_pkey` | 0 | Never read |
| `lottery_admin_audit_pkey` | 0 | Never read |

**Zero unused-index findings of concern.** Two indexes at `idx_scan = 0` are PK indexes on
near-empty new tables; that is expected, not debt.

### 2.1 A signal worth naming: aborted inserts

`lottery_participants` and `lottery_participations` each show `n_tup_ins = 20`, `n_live_tup = 10`,
`n_dead_tup = 10`, with `n_tup_upd = 0` and `n_tup_del = 0`. Dead tuples with no updates and no
deletes mean **rolled-back inserts**: 20 attempted, 10 committed, 10 aborted. `lottery_pools`
and `lottery_draws` show the same 2-attempt/1-commit pattern.

This is the fingerprint of **idempotent re-runnable seeding** (insert, fail on conflict or
validation, retry) — consistent with setup and smoke-testing, not with production traffic. It is
evidence *for* the "newly provisioned" classification, not against it.

---

## 3. PHASE1B_OBJECT_USAGE_CLASSIFICATION

Classification ladder, strictly applied. `CONFIRMED_IN_USE` requires **operational evidence of
both read and write traffic across the window**, never catalog existence.

| Object | CATALOG_EXISTS | STRUCTURALLY_CONFIGURED | OPERATIONALLY_OBSERVED | Final classification | Confidence |
|---|---|---|---|---|---|
| `bolao_state` | ✅ | ✅ PK, 6 policies, RLS on | ✅ 17 829 seq scans, 532 updates, autovacuumed 2 days ago, fully cached | **CONFIRMED_IN_USE** | **HIGH** |
| `lottery_payment_transactions` | ✅ | ✅ PK, 2 FKs, self-FK, unique idx enforced | ⚠️ 11 inserts, 11 uniqueness probes, 0 updates, 0 reads via PK | **PROVISIONED_SEEDED_NOT_PRODUCTION_BEARING** | MEDIUM |
| `lottery_participants` | ✅ | ✅ PK, 3 FKs, enum-typed state | ⚠️ 20 ins / 10 live / 10 aborted, 30 idx reads | **PROVISIONED_SEEDED_NOT_PRODUCTION_BEARING** | MEDIUM |
| `lottery_participations` | ✅ | ✅ PK, 4 FKs | ⚠️ same aborted-insert pattern | **PROVISIONED_SEEDED_NOT_PRODUCTION_BEARING** | MEDIUM |
| `lottery_pools` | ✅ | ✅ PK, 2 FKs | ⚠️ 2 ins / 1 live | **PROVISIONED_SEEDED_NOT_PRODUCTION_BEARING** | MEDIUM |
| `lottery_draws` | ✅ | ✅ PK, 3 FKs | ⚠️ 2 ins / 1 live | **PROVISIONED_SEEDED_NOT_PRODUCTION_BEARING** | MEDIUM |
| `lottery_admin_audit` | ✅ | ⚠️ hash columns present, **enforcement triggers absent** | ⚠️ 1 insert, never read | **PROVISIONED_CONTROL_NOT_ENFORCED** | MEDIUM |

**No object was classified `ORPHAN_CANDIDATE`.** All seven are recent (created by migration
`20260806143644` on 2026-08-06, one day before collection), FK-reachable, and show non-zero
activity. Dormancy cannot be claimed against a one-day-old object.

**No object remains `PRESENT_USAGE_UNKNOWN`.** Phase 1B's objective is met: the 7 tables that
entered Phase 1B unknown now carry evidence-backed classifications. `bolao_state` is promoted to
`CONFIRMED_IN_USE`; the other six are demoted from "unknown" to a *positively characterised*
state — provisioned and seeded, not yet carrying production traffic.

> **Why the six are not `CONFIRMED_IN_USE`.** They have writes but effectively no application
> read traffic (two PKs never scanned; the others in single/double digits over 77 days), no
> updates at all, and never triggered autovacuum or autoanalyze. Combined with a one-day-old
> creation date and rolled-back seed inserts, the evidence supports *provisioning*, not
> *operation*. Promoting them on insert-count alone would be exactly the inference this
> programme forbids.

---

## 4. UNOWNED_OBJECT_RECONCILIATION — the 44 S20b objects

S20b listed 44 objects with no owning extension. Reconciled by ownership domain:

| Schema | Objects | Owner | Verdict |
|---|---|---|---|
| `auth` | 23 tables + 1 sequence | `supabase_auth_admin` | **PROVIDER_MANAGED** — out of reconciliation scope |
| `storage` | 8 tables | `supabase_storage_admin` | **PROVIDER_MANAGED** — out of scope |
| `realtime` | 2 tables + 1 partitioned table + 1 sequence | `supabase_realtime_admin` | **PROVIDER_MANAGED** — out of scope |
| `supabase_migrations` | 1 table | provider | **PROVIDER_MANAGED** — but is the migration ledger; see `DATABASE_RECONCILIATION.md` R-03 |
| **`public`** | **7 tables** | `postgres` | **APPLICATION — the real reconciliation surface** |

**Conclusion: 37 of 44 are false-positive "unowned" findings.** S20b's predicate detects absence
of an *extension* dependency; Supabase's managed schemas are provisioned by the platform, not by
extensions, so they legitimately have no `pg_extension` dependency. They are not unmanaged — they
are managed by a party other than this repository. Only the 7 `public` tables are genuinely
this project's responsibility, and their reconciliation is complete in
`DATABASE_RECONCILIATION.md` §3.

> **Methodological note for future phases.** S20b as written cannot distinguish
> "created outside version control" from "created by the platform". Its output must always be
> partitioned by schema ownership before being read as a finding. Left unpartitioned it inflates
> a 7-object problem into a 44-object one.

---

## 5. DEFERRED_EVIDENCE_GAPS — closed vs. still open

The Phase 1A pack deferred five gaps. Four are now **closed** (safely obtainable read-only,
no privilege broadening, no credential-bearing field selected):

| Gap | Status | Result |
|---|---|---|
| **Event triggers** | ✅ CLOSED | **7 event triggers.** Six are `supabase_admin`-owned platform hooks (`pgrst_ddl_watch`, `pgrst_drop_watch`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `issue_graphql_placeholder`). **One, `ensure_rls`, is `postgres`-owned, fires on every `ddl_command_end`, calls SECURITY DEFINER `public.rls_auto_enable()`, and is in no repository.** See `DATABASE_RECONCILIATION.md` R-08. All 7 enabled_origin; none disabled. |
| **Database-level ACL** | ✅ CLOSED | 10 grants on `postgres`. `PUBLIC` holds `CONNECT` + `TEMPORARY` (PostgreSQL default). `CREATE` held by `postgres`, `dashboard_user`, `supabase_etl_admin`, `supabase_storage_admin`. No unexpected grantee. |
| **Type/domain privileges** | ✅ CLOSED | **0 rows** — no type or domain carries a non-default ACL. The `TYPE_DOMAIN_PRIVILEGES` gap flagged in S09's commentary is resolved as *empty*, not unknown. |
| **Replication slots** | ✅ CLOSED | **0 slots.** Combined with S15c (0 subscriptions) and S15a (1 publication), there is no active logical-replication consumer. Reduces the exposure surface of the `FOR ALL TABLES` publication concern. |
| **FDW metadata** | ⛔ **STILL DEFERRED** | Existence-only probe: **0 foreign servers, 0 user mappings, 0 foreign tables.** The gap remains formally open because `pg_foreign_server.srvoptions` / `pg_user_mapping.umoptions` can contain credentials and are excluded by policy — but with all three counts at zero, the *risk* is nil. Practically closed, formally deferred. |

No privilege was broadened to obtain any of this.

---

## 6. Readiness assessment

| Next step | Ready? | Blocker |
|---|---|---|
| **LOGICAL BACKUP** | ✅ **READY NOW** *(corrected)* | An earlier revision of this row said a DDL capture was a prerequisite. **That was wrong.** `pg_dump` reads the live catalog and carries its own DDL, so a logical backup is restorable with no versioned DDL at all. Versioned DDL is required for **reproducibility and auditability**, not for restore mechanics. See `BACKUP_RESTORE_OPERATIONAL_DESIGN.md` §0. |
| **BACKUP INTEGRITY VERIFICATION** | ✅ Ready | Object inventory, PK/FK topology, and row-order-independent structure are all now documented, so a restored copy can be diffed structurally. |
| **RESTORE REHEARSAL** | ✅ Ready | Target is small (7 tables, ~500 KB total). The 3 enum types and 17 FKs are the ordering constraints; both are documented. Rehearse into a scratch project, never in place. |
| **ARCHITECTURE DECISIONS** | ⚠️ **Blocked on one decision, not on evidence** | Evidence is now sufficient. The blocker is R-03: with no repo↔ledger provenance, any target model risks being designed against `001_schema.sql`, which is **not** what production runs. Establish a baseline migration reflecting reality before designing forward. |

**None of these steps were started.** Reported as readiness only, per the stop point.

---

## 7. Provenance and hygiene

Raw evidence outside Git at
`~/Documents/GitHub/ferrarilabs-work/db-modernization/phase1b-20260807T213231Z/`
(`01_usage_evidence.txt`, `02_deferred_gaps.txt`, `03_s09_defect_check.txt`, query files), plus
the corrected Phase 1 `section_results.tsv` and `CORRECTION_NOTICE.md` in the Phase 1 output
directory (original preserved as `section_results.ORIGINAL_UNCORRECTED.tsv`).

No participant row, email, payment value, prediction, score, enum label, or `bolao_state` JSON
content was read. All evidence is catalog metadata or aggregate statistics.
