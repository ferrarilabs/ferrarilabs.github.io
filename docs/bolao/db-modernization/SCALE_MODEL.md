# SCALE_MODEL — qualitative assessment at 10×, 100× and 1000×

**Workstream W.** Deliberately qualitative: no benchmark has been run, so no latency number appears here.

Status: **ASSESSMENT ONLY.** No partitioning, matview, archival or index change has been implemented.

---

## 0. Where the platform actually is

| Dimension | Today (order of magnitude) |
|---|---|
| pools | ~3 |
| participants | ~tens |
| entries | ~tens |
| predictions | ~hundreds to low thousands |
| matches per edition | ~104 (Copa: 72 group + 32 knockout) |
| payments | ~tens |

**Everything in this document is therefore about avoiding premature complexity as much as about scaling.**
At current volumes, a sequential scan of every table in the schema is faster than the network round-trip
that requested it. The right engineering answer today is "do nothing structural, and know the thresholds".

---

## 1. Scenarios

### 10 pools · ~100 participants · ~10k predictions

**Verdict: no change required. None.**

- Every table fits comfortably in shared buffers.
- The index set in `INDEX_STRATEGY.md` is more than sufficient; several of its entries will not be used by
  the planner at this size, and that is fine — they are cheap and they matter at the next tier.
- `MATVIEW` on R-12 (`competition_performance`) and R-14 (`year_over_year_participation`) is arguably
  premature here. **Keep them as plain views until a real query is slow.** A matview introduces a refresh
  story, and a refresh story introduces staleness — a cost paid for nothing at this size.

**Only real risk at this tier is not performance.** It is the tiny-hot-table autovacuum problem already
recorded: a table with a handful of rows updated constantly (`sync_state`, `bolao_state` today) may not
reach the autovacuum threshold, so dead tuples accumulate relative to a tiny live set. Fix is per-table
`autovacuum_vacuum_scale_factor`, not architecture.

### 100 pools · ~10k participants · ~100k predictions

**Verdict: the index set starts to matter; two reports need materialising.**

| Concern | Threshold reached? | Action |
|---|---|---|
| `predictions(pool_entry_id)` lookups | yes | index is now load-bearing, not decorative |
| R-12 `competition_performance` | yes | **materialise**, refresh on result recorded — not on a timer alone, because a stale leaderboard after a result is a visible incorrectness |
| R-14 `year_over_year_participation` | yes | **materialise**, nightly; a day-stale participation trend has no decision attached to it |
| R-15 `pool_financial_reconciliation` | not yet | stays a view; 100 pools × tens of entries is trivial to aggregate |
| identity resolution in R-01/R-14 | **yes, and this is the real one** | the recursive canonical walk runs per query. Add a resolved-identity projection (a view, then a matview) rather than letting every report re-walk the chain |
| audit hash-chain verification | yes | verifying the whole chain becomes an O(n) job. Verify **incrementally** from the last verified checkpoint, and store the checkpoint |
| outbox | yes | `outbox_events(status, next_attempt_at)` becomes essential; without it the worker's claim query scans everything |

Partitioning: **still no.** 100k rows is not a partitioning problem, and partitioning a table this size
adds planning overhead and operational complexity for no gain.

### 1000 pools · ~100k participants · ~1M predictions

**Verdict: partitioning and archival thresholds are crossed; analytics should separate.**

| Concern | Action | Trigger |
|---|---|---|
| `predictions` | **partition by `competition_edition_id`** (or by phase for very large editions). Natural boundary: a query almost never spans editions, and an old edition becomes read-only forever | >1M rows, or when index maintenance on insert becomes visible |
| `audit_events` | **partition by month** (range on `occurred_at`). Append-only with time-ordered reads is the textbook case | >5M rows, or when the 5-year retention window makes pruning a delete-heavy job |
| `outbox_events` | **partition by status is wrong** (status changes, so rows would migrate between partitions). Instead: archive `sent` rows older than the payload-retention window into `outbox_events_archive` | when pending/dead queries slow because they scan through millions of sent rows |
| ranking snapshots | **archive by edition** once an edition concludes | when snapshot volume × frequency exceeds a few million rows |
| reporting | **separate analytics** — a read replica, or a nightly export. R-14 and R-03 are full-history scans and should not compete with the write path | when a report's runtime affects a participant's page load |
| matviews | R-15 also materialises here; R-01 needs the resolved-identity matview from the previous tier | as above |
| index changes | reconsider partial indexes: `predictions` WHERE the edition is current; `outbox_events` WHERE status IN ('pending','failed') — a partial index over the hot subset is much smaller than one over all history | at partitioning time |

---

## 2. Threshold summary

| Mechanism | Do NOT do it before | Trigger |
|---|---|---|
| Materialized views | 100 pools | a report's runtime is user-visible |
| Resolved-identity projection | 10k participants | reports re-walking the canonical chain per query |
| Incremental audit chain verification | 100k audit rows | full-chain verification stops being instant |
| Partitioning `predictions` | 1M rows | insert-time index maintenance visible |
| Partitioning `audit_events` | 5M rows | retention pruning becomes delete-heavy |
| Outbox archival | millions of `sent` rows | queue queries scan through delivered history |
| Analytics separation | 1000 pools | reporting competes with the write path |
| Partial indexes | partitioning time | the hot subset is a small fraction of the table |

---

## 3. What does NOT scale, independently of volume

Two things get worse with **participants**, not rows, and neither is fixed by an index:

1. **Unresolved duplicate identities.** Every unmerged duplicate makes R-14's "returning participant"
   count wrong, and no amount of hardware corrects a wrong number. This is a Workstream C problem that
   *looks* like a reporting problem.
2. **The client-side authorization posture.** With authorization living in browser JavaScript (DR-1), risk
   scales with the number of people who hold the anon key — which is everyone who loads the page. That is
   a Workstream R problem and it is already at full scale today.

## 4. Explicitly not claimed

- **No measured numbers.** Every threshold above is an order-of-magnitude judgement, not a benchmark
  result. They are starting points for measurement, not conclusions.
- **No claim that any of these mechanisms will be needed.** At the platform's actual growth rate, the
  100-pool tier may never arrive. The value of writing them down is knowing what to watch, not committing
  to build.
