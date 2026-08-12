# Cutover observability baseline — the design for metrics that do not exist yet

**Status: DESIGN ONLY. Nothing here is deployed, and deploying it is not authorized.**
**Created 2026-08-11, from the authorized production read.** Companion to `CUTOVER_RUNBOOK.md` step 0.2
and acceptance condition **AC-7**.

---

## 1. Why this document exists

`CUTOVER_RUNBOOK.md` step 0.2 says:

> Capture metric baselines: write error rate, sync lag, authorization denials, request volume

and **AC-7** aborts the cutover on *"a critical error-rate spike above the step 0.2 baseline"*.

The 2026-08-11 read-only window tried to capture that baseline and found that **three of the four metrics
have no catalog-backed source at all**. They cannot be obtained by any `SELECT`, at any privilege level.
So AC-7 currently names a comparison against a baseline that cannot be taken — an abort condition that
could never fire, sitting in a runbook that governs a live money-bearing cutover.

This document does not fix that by inventing thresholds. **No threshold in this document is a number.**
Every one is `UNDEFINED_UNTIL_MEASURED`, because a threshold chosen without a baseline is a guess that
will either abort a healthy cutover or fail to abort a sick one, and there is no way to tell which until
it has fired once.

---

## 2. What the read actually established

| | result |
|---|---|
| Sampled | `pg_stat_database` for the current database, once |
| Nature of the sample | **`BASELINE_POINT`**, not a rate |
| Why not a rate | `pg_stat_database` counters are **cumulative since `stats_reset`** (2026-05-22). One sample of a cumulative counter divided by nothing is not a rate. A rate needs a second sample and the interval between them. |
| Captured | `xact_commit` 1,990,760 · `xact_rollback` 1,344 · `deadlocks` 0 · `conflicts` 0 · cache hit ratio 0.99994 · 8 backends |

`xact_rollback / xact_commit` ≈ 0.000675 is **not** a write error rate. It counts every rollback,
including deliberate ones — the read window's own two transactions are in that number.

---

## 3. The four metrics

### 3.1 `write_error_rate`

| field | value |
|---|---|
| **Definition** | Write attempts rejected by the database, as a fraction of write attempts, over a fixed window. |
| **Producer / source** | **Does not exist.** The nearest catalog value, `pg_stat_database.xact_rollback`, counts all rollbacks and cannot distinguish a rejected write from a deliberate `ROLLBACK` or a read-only transaction ending. Requires **application-side instrumentation** in the Supabase client wrapper: count write calls, count non-2xx/SQLSTATE-bearing responses. |
| **Sampling window** | 60 s tumbling. Short enough that a cutover step's damage is visible inside one step; long enough that a handful of writes does not produce a 100% rate from one failure. |
| **Aggregation** | `errors / attempts` per window, plus raw counts. **The raw counts must be carried alongside the ratio** — at this traffic level (≈3,200 writes total since May) a single failure in a quiet window is a 100% error rate and means nothing. |
| **Cutover comparison** | Compare the **rolling median of the 30 windows before step 0** against each window during steps 5–19. AC-7 fires on a sustained deviation, not one window. |
| **Threshold** | `UNDEFINED_UNTIL_MEASURED` — needs ≥ 7 days of pre-cutover windows to know what normal looks like. |
| **Instrumentation requirement** | Client-side counter in the shared Supabase wrapper across all three apps; emitted to a sink that survives the page. Not built. |
| **Rollback / disable** | Pure measurement, no behaviour change; disable by removing the emit call. Must be behind a flag so it can be switched off without a redeploy. |

### 3.2 `authorization_denials`

| field | value |
|---|---|
| **Definition** | Count of operations refused by the privilege layer (`42501`) or by RLS, per role, per table. |
| **Producer / source** | **Does not exist in any catalog view.** PostgreSQL does not count denials anywhere. Requires **log ingestion**: `log_min_messages`/`log_statement` capture at the server, or the Supabase log drain, filtered on SQLSTATE `42501`. |
| **Sampling window** | 60 s tumbling, aligned with 3.1. |
| **Aggregation** | Count by `(role, table, sqlstate)`. Never by message text — messages quote values. |
| **Cutover comparison** | This is the metric that matters most at **step 11**, and it is expected to RISE: the fence's whole purpose is to deny stale clients. So the comparison is not "did denials increase" but **"did denials on `public.bolao_state` from `anon` increase while denials elsewhere stayed flat"**. A rise anywhere else means the fence over-reached. |
| **Threshold** | `UNDEFINED_UNTIL_MEASURED`. Note KPLUS-F038: a fence refusal and an RLS refusal are **both `42501`**, so SQLSTATE alone cannot separate them — the `CLIENT_TOO_OLD` envelope is what distinguishes them, and it must be in place before this metric can be interpreted at step 11. |
| **Instrumentation requirement** | Server-side log drain plus a parser. Nothing exists. This is the largest of the four. |
| **Rollback / disable** | Disable the drain filter. No effect on the database. |

### 3.3 `sync_lag`

| field | value |
|---|---|
| **Definition** | Delay between a client committing a state change and that change being visible to other clients. |
| **Producer / source** | **Not a database metric.** This is a property of the application's state-sync loop (`js/app.js` ↔ `bolao_state`). Requires client-side timestamping: record write-commit time and observed-refresh time. |
| **Sampling window** | Per-event, aggregated over 5 min — sync events are far rarer than writes. |
| **Aggregation** | p50 / p95 / max. **Not a mean**: a bimodal distribution (fast path vs retry path) has a mean that describes neither. |
| **Cutover comparison** | Steps 13–19 are where reads become authoritative from the new path. p95 must not regress against the pre-cutover p95. |
| **Threshold** | `UNDEFINED_UNTIL_MEASURED` — no sync-lag measurement has ever been taken on this platform. |
| **Instrumentation requirement** | Client-side, all three apps. Not built. |
| **Rollback / disable** | Measurement only; remove the emit. |

### 3.4 `request_volume`

| field | value |
|---|---|
| **Definition** | Reads and writes per minute against the legacy document and the replacement path. |
| **Producer / source** | **Partially available.** `pg_stat_user_tables` (`seq_scan`, `n_tup_ins/upd/del`) gives per-table cumulative counters — the only one of the four with a catalog source. Still cumulative, so it needs two samples. |
| **Sampling window** | 60 s tumbling; a scheduled sampler storing `(t, counter)` pairs. |
| **Aggregation** | First difference between consecutive samples. Must handle `stats_reset` (counters go backwards → discard the interval rather than emitting a negative rate). |
| **Cutover comparison** | Traffic must MOVE from the legacy document to the replacement path across steps 8–13, not disappear. The check is that **the sum stays roughly constant while the split shifts** — a drop in both is an outage, and a drop in one alone proves the migration is working. |
| **Threshold** | `UNDEFINED_UNTIL_MEASURED` for the abort condition. The *shape* assertion above is checkable without a threshold and is the more useful one. |
| **Instrumentation requirement** | A scheduled read-only sampler. This is the **only one of the four that could be built with reads alone**, and it does not exist either. |
| **Rollback / disable** | Stop the sampler. It only reads. |

---

## 4. What this means for AC-7 today

**AC-7 cannot fire.** It compares against a step 0.2 baseline, three quarters of which cannot be captured,
and the fourth of which has never been sampled twice.

Two honest options, both for the operator:

1. **Build the instrumentation** in §3, collect ≥ 7 days, set thresholds from the measured distribution,
   then restate AC-7 in terms of the metric that actually exists.
2. **Restate AC-7 now** in terms of what *can* be observed without new instrumentation — the fence
   verifier, the write-path probes, and the runbook's own per-step checks — and drop the language about an
   error-rate baseline.

**What must not happen** is AC-7 staying as written while everyone assumes a baseline exists. An abort
condition nobody can evaluate is worse than no abort condition, because it is mistaken for coverage.

---

## 5. Deliberate non-goals

- **No thresholds are proposed.** See §1.
- **No instrumentation is deployed.** Explicitly out of scope; `DEPLOYMENT = 0`.
- **No production writes** were made to produce this document. It rests on one read-only window.
- **Supabase-managed schemas are not surveyed** for metric sources. Scope stays evidence-driven.
