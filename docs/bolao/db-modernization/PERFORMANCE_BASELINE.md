# PERFORMANCE_BASELINE — measured baseline and forward analysis

**STATUS:** COMPLETE. Read-only measurement, 2026-08-08T13:32Z. No production write.
**EVIDENCE BASIS:** `pg_class` (relpages, TOAST), `pg_stat_user_tables`, `pg_stat_all_indexes`,
`pg_stats`, `pg_stat_database`, `pg_attribute.attstorage`, plus a programmatic FK-index-coverage check.
**KNOWN GAPS:** `pg_stat_statements` **was not queried** — the extension is installed but its views are
`PUBLIC SELECT` in `extensions`, and reading them would expose *query text* which can embed literals
and participant values. Deliberately excluded under the same rule that governs policy expressions. So
**no slow-query list exists** and none is fabricated here. No `EXPLAIN` was run (would require crafting
queries against production).
**ASSUMPTIONS:** the 77-day statistics window (`stats_reset` 2026-05-22) is representative.

> Cross-references: `OBJECT_CATALOG.md` §2–§3 (indexes, FKs), `JSON_CLASSIFICATION.md`
> (document model), `OBSERVABILITY_MODEL.md` (what to monitor), `TARGET_DATA_MODEL.md` (where this leads).

---

## 1. Headline: the system is fast because it is tiny, not because it is well-tuned

| Metric | Value | Assessment |
|---|---|---|
| Cache hit ratio | **99.994 %** (22 768 332 hits / 1 479 disk reads) | Excellent — but a 288 kB working set fits in any buffer pool |
| Transactions committed | 1 840 255 | Real traffic |
| Rollbacks | 449 (0.024 %) | Healthy |
| Deadlocks | **0** | Healthy |
| Temp files | 21 | Negligible |
| Largest table | **288 kB** (`bolao_state`) | Entire database ≈ 500 kB |

**Nothing here is currently slow, and no query optimisation is warranted today.** The value of this
baseline is that it identifies the *structural* issues that will bite at 100× volume, while they are
still free to fix.

---

## 2. Finding P-01 — CRITICAL for the target model: `bolao_state` is TOAST-dominated

| Component | Size | Share |
|---|---|---|
| Heap | 16 kB | 6 % |
| Index (PK) | 16 kB | 6 % |
| **TOAST** | **176 kB** | **61 %** |
| (remainder: TOAST index / FSM / VM) | ~80 kB | 27 % |
| **Total** | **288 kB** | |

`relpages = 2` — the heap is two pages for three rows. The `state jsonb` column exceeds the ~2 kB
TOAST threshold and is stored **out-of-line**, with `attstorage = extended` (compressed + external).

**Consequences, all measurable today:**

1. **Every read of `state` requires a TOAST fetch.** With **17 829 sequential scans** over the window,
   that is ~17 829 detoast operations — each a separate index lookup into the TOAST relation plus
   decompression. The seq scan on a 2-page heap is nearly free; **the TOAST fetch is the actual cost.**
2. **Every update rewrites the entire TOAST chain.** PostgreSQL cannot update a jsonb value in place.
   532 updates ⇒ 532 full-document rewrites. This is the mechanical explanation for P-02 below.
3. **The document is already ~60 kB/row** (176 kB across 3 rows, compressed). It grows monotonically:
   `deletedIds` is never pruned and `auditLog` holds up to 200 entries per app.

**This is the strongest performance argument for the hybrid normalisation in `ARCHITECTURE_DECISION_REVIEW.md`
DEC-06.** Splitting `entries`, `paid` and `auditLog` into rows converts "rewrite 60 kB to change one
boolean" into "update one 100-byte row". At present scale it costs nothing; at 10× participants it is
the dominant cost.

---

## 3. Finding P-02 — `bolao_state` bloat ratio is 500 %

| Table | Live | Dead | Dead % | Autovacuum runs | Autoanalyze runs |
|---|---|---|---|---|---|
| **`bolao_state`** | **3** | **15** | **500 %** | 9 | 10 |
| `lottery_participants` | 10 | 10 | 100 % | 0 | 0 |
| `lottery_participations` | 10 | 10 | 100 % | 0 | 0 |
| `lottery_draws` | 1 | 1 | 100 % | 0 | 0 |
| `lottery_pools` | 1 | 1 | 100 % | 0 | 0 |
| `lottery_payment_transactions` | 11 | 0 | 0 % | 0 | 0 |
| `lottery_admin_audit` | 1 | 0 | 0 % | 0 | 0 |

`bolao_state` carries **five dead tuples for every live one**. Autovacuum has run 9 times and has not
converged, because the default threshold (`autovacuum_vacuum_threshold = 50` +
`scale_factor × reltuples`) means a 3-row table needs ~50 dead tuples before a vacuum triggers — and
the table only ever holds 3 live rows. **A tiny, hot table is the pathological case for default
autovacuum settings.**

Harmless at 288 kB. But the *pattern* — whole-document rewrite on a permanently tiny table — is
precisely the shape that produces unbounded bloat if the document grows. **Recommendation (not
applied, requires DDL authorization):** per-table `autovacuum_vacuum_scale_factor = 0.0` +
`autovacuum_vacuum_threshold = 5` on `bolao_state`. `reloptions` is currently **NULL on all 7 tables**
— no per-table tuning exists anywhere.

The `100 %` rows on four lottery tables are the **rolled-back seed inserts** already characterised in
`PHASE1B_LIVE_STATE.md` §2.1, not update churn. No action.

---

## 4. Finding P-03 — SEVERE: the planner has no statistics for 6 of 7 tables

`pg_stats` contains rows for **`bolao_state` only** (3 columns). The other **six tables have zero
column statistics**, and `reltuples = -1` / `relpages = 0` on all six.

**The planner is therefore flying blind on six tables**, falling back to hard-coded default
selectivity. Combined with §5 (no FK indexes), the first non-trivial join across these tables will
produce a poor plan — and it will look like a query problem rather than a statistics problem.

This is a *latent* correctness-of-planning issue, invisible today because every table fits in one page
so every plan is a trivially correct sequential scan.

**Recommendation:** run `ANALYZE` on the six tables as part of any backfill or data load. `ANALYZE` is
a read-mostly maintenance operation but **does write to `pg_statistic`**, so it requires authorization
and is **not** performed here. It is the cheapest single performance action available and should be a
standing step in any migration runbook.

---

## 5. Finding P-04 — all 17 foreign keys are unindexed (verified, not inferred)

Confirmed programmatically: for each of the 17 FK constraints, no index exists whose leading columns
cover the constrained column. **17/17 uncovered.**

| Impact | Explanation |
|---|---|
| Join performance | Every parent→child traversal is a sequential scan |
| **Parent DELETE/UPDATE** | PostgreSQL must scan the child table to enforce `NO ACTION`. With 17 FKs and no indexes, cascading integrity checks are all sequential |
| Lock duration | Longer scans hold row locks longer, widening the window for contention |

Highest-value indexes, in priority order (the access paths the application actually needs):

1. `lottery_participations(participant_id)` — "which pools has this person entered"
2. `lottery_participations(pool_id)` and `(draw_id)`
3. `lottery_payment_transactions(participation_id)` — the payment-reconciliation path
4. `lottery_draws(pool_id)`
5. `lottery_admin_audit(entity_type, entity_id)` and `(server_created_at)` — audit lookup, currently full-scan only

The 11 `auth.users` FKs (`created_by`/`updated_by`/`archived_by`/`actor_user_id`) are **lower**
priority: they are nullable audit-attribution columns, rarely joined from the parent side.

**Cost of fixing now vs. later:** at 1–11 rows, `CREATE INDEX` is instantaneous. Once tables carry
volume it needs `CREATE INDEX CONCURRENTLY` and a maintenance window. **This is the clearest
"do it while it's free" item in the programme.**

---

## 6. Finding P-05 — no redundant indexes, and the reason matters

8 indexes, all `btree`, all single-column, all unique. **Zero redundancy, zero invalid, zero bloat.**

That is not a tuning achievement — it is a consequence of there being **no secondary indexes at all**
(§5). The index set is minimal because it was never designed, not because it was pruned. Worth stating
so a future reader does not read "no redundant indexes" as evidence of care.

Two PK indexes at `idx_scan = 0` (`lottery_payment_transactions_pkey`, `lottery_admin_audit_pkey`):
expected on tables that are written but not yet read by PK. **Not** drop candidates — a PK index is
structural.

---

## 7. Finding P-06 — TOAST storage strategy is default everywhere

All 28 `text`/`jsonb` columns carry `attstorage = extended` (PostgreSQL default: compress, then move
out-of-line if still too large). Correct for `state`, `before_snapshot`, `after_snapshot`,
`client_metadata`.

Two forward observations:
- `lottery_admin_audit` has **three** jsonb columns plus 8 text columns. Once it carries volume it will
  be the second TOAST-heavy table. The B1 decision (audit stores IDs, not raw payloads) *also* reduces
  TOAST pressure — a performance dividend of a governance decision.
- Short, high-cardinality columns (`entry_hash`, `previous_entry_hash`, `external_reference`) would
  never TOAST anyway; `attstorage = plain` would be a micro-optimisation with no measurable benefit.
  **Not recommended** — changing storage strategy for cosmetic reasons adds risk for nothing.

---

## 8. Deliberately not measured, and why

| Not done | Reason |
|---|---|
| `pg_stat_statements` slow-query list | Query text can embed literals and participant values. Excluded under the same rule as policy expressions. **No slow-query list is fabricated in its absence.** |
| `EXPLAIN (ANALYZE)` plans | Requires executing crafted queries against production; every plan on a 1-page table is a trivial seq scan, so the informational value is nil |
| Bloat estimation via `pgstattuple` | Extension not installed; installing it is DDL |
| Connection-pool saturation | Pooler-side metric, not visible from SQL |
| Index bloat | All indexes are 16 kB — the minimum. Nothing to measure |

**A note on honesty:** Workstream 7 asks for "slow queries". There is no evidence of any slow query,
and the one mechanism that would reveal them was excluded on privacy grounds. Reporting an empty list
is the accurate answer; inventing candidates from intuition would be worse than useless.

---

## 9. Forward capacity analysis

| Scenario | Current | 10× participants | 100× | Binding constraint |
|---|---|---|---|---|
| `bolao_state` document size | ~60 kB/row | ~600 kB/row | ~6 MB/row | **TOAST rewrite per update (P-01)** — fails first |
| Update cost | rewrite 60 kB | rewrite 600 kB | rewrite 6 MB | Same |
| `localStorage` client limit | fine | fine | **exceeds ~5 MB** | Client-side, not DB |
| Bloat | 500 % of 16 kB | material | severe | **Autovacuum defaults (P-03)** |
| Join performance | irrelevant | noticeable | **severe** | **Unindexed FKs (P-04)** |
| Planner quality | irrelevant | poor | **very poor** | **Missing statistics (P-03)** |

**The document model fails before the relational model does.** `bolao_state` hits its wall at roughly
10–20× current volume, driven by full-document rewrite; the `lottery_*` tables would survive far
longer once indexed and analyzed. That ordering is an argument for prioritising the `entries`/`paid`/
`auditLog` normalisation over anything else in the target model.

---

## 10. Prioritised actions (none applied — all require authorization)

| P | Action | Auth needed | Cost now | Cost later |
|---|---|---|---|---|
| P1 | `CREATE INDEX` on the 6 high-value FK columns (§5) | DDL | seconds | `CONCURRENTLY` + window |
| P1 | `ANALYZE` the 6 unanalyzed tables (§4) | write to `pg_statistic` | seconds | same, but plans stay bad meanwhile |
| P2 | Per-table autovacuum tuning on `bolao_state` (§3) | DDL (`ALTER TABLE ... SET`) | seconds | bloat accrues |
| P2 | Prune `deletedIds`; uncap `auditLog` (`REMEDIATION_PLANS.md` B2) | app change | small | document grows |
| P3 | Normalise `entries`/`paid`/`auditLog` out of the document (DEC-06) | full migration | large | larger |
| — | Promote `external_reference` unique index → constraint | DDL | seconds | needed before any FK references it |

## 11. RISKS

- **This baseline will read as "all green" to a casual reader.** Cache hit 99.994 %, zero deadlocks,
  no redundant indexes. Every one of those is true and none of them means the database is well tuned —
  they mean it is 500 kB. The findings that matter (P-01, P-03, P-04) are all *latent*.
- **Re-baselining after any data load is mandatory.** Every number here is anchored to a 77-day window
  on a near-empty database.
- Excluding `pg_stat_statements` is a deliberate privacy/observability trade. If slow-query visibility
  becomes necessary, it needs its own authorization with a plan for handling query text.

## 12. NEXT DECISION (operator)

1. **Authorize the P1 index + `ANALYZE` batch?** Cheapest, highest-value, reversible (`DROP INDEX`).
2. **Authorize `pg_stat_statements` reads** under a query-text handling rule, or accept no slow-query
   visibility?
3. **Accept the capacity conclusion** that the document model, not the relational model, is the first
   scaling constraint — it reorders the migration roadmap toward `entries`/`paid`/`auditLog` first.
