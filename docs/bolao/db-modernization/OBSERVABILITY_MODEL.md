# OBSERVABILITY_MODEL — signals for the data layer and pipelines

**STATUS:** COMPLETE as a design. **No monitoring infrastructure was added.**
**EVIDENCE BASIS:** `DEPENDENCY_GRAPH.md` §2.1 (13 cron entries, real cadences), Phase 1B statistics
(`stats_reset` 77 days, per-table counters), `TECHNICAL_DEBT_REPORT.md` (defect classes to detect),
`RLS_ASSUMPTIONS_REVIEW.md` (security drift surface).
**KNOWN GAPS:** there is **no metrics pipeline, no dashboard, no alert channel, and no log
aggregation** today. Everything below is greenfield. Supabase's built-in observability was not
inventoried (would require console access, not granted).
**ASSUMPTIONS:** GitHub Actions remains the execution substrate; any collector must work without a
long-running server, since none exists.

---

## 1. The governing observation

**Every incident this programme has uncovered was silent.**

| Incident | How it failed | How long it was invisible |
|---|---|---|
| Powerball cron missed Mon/Wed draw nights | A cron that does not fire emits nothing | Unknown; fixed 2026-08-06 after ≥1 missed drawing |
| S09 discovery section failed | Error text present, but classified as success by an anchored grep | Until re-audit, same session |
| `auditLog` truncation at 200 entries | Deletion is a normal write | Ongoing, unmeasured |
| `anon` held TRUNCATE on 10 tables | A grant emits nothing | Unknown, until Phase 1 |
| `auto_results.yml` permanently dormant | Month filter; no run = no signal | Since 2026-08-01 |
| ESPN snapshot refreshed only by hand | Stale cache serves successfully | Ongoing, unbounded |

**Therefore the primary design requirement is not "monitor errors" — it is "detect absence".** Five
of six failures above produced *no error at all*. A monitoring design centred on error rates would
have caught **one**. This inverts the usual priority: **heartbeats and expected-run counters come
first; error metrics second.**

---

## 2. Signal catalogue

`Threshold` is a *concept*, not a tuned value — tuning requires baseline data that does not exist.

### 2.1 Absence detection (priority 1)

| # | Metric | Signal source | Sev | Threshold concept | Response expectation |
|---|---|---|---|---|---|
| O-01 | **Expected-run heartbeat** per scheduled workflow | GitHub Actions run history vs. the declared cron | **CRITICAL** | No successful run within 2× the declared interval during a live window | Investigate the workflow, not the data. Directly catches the Powerball class of defect. |
| O-02 | **ESPN snapshot freshness** | `mtime`/commit time of `espn-normalized.json` vs. now | **HIGH** | Age > 24 h while a competition is live | Trigger the snapshot workflow. Catches DG-04 (manual-only refresh). |
| O-03 | **Result-email fired per completed match** | matches with a result ∧ no outbox record | **CRITICAL** | Any match complete > 30 min with no delivery attempt | Money/fairness-adjacent. The most user-visible silent failure. |
| O-04 | **Backup freshness** | newest `backup-*` artefact age | **CRITICAL** | > 26 h | Backups exist but nothing asserts they are recent |
| O-05 | **Restore-rehearsal age** | date of last successful rehearsal | **HIGH** | > 90 days, **or never** | **Currently `never`** — no restore path exists at all (`DEPENDENCY_GRAPH.md` DG-01) |
| O-06 | **Cron-window coverage assertion** | static test over workflow YAML vs. expected event calendar | **HIGH** | Any expected event date not covered by a window | A unit test, not a runtime metric. Would have prevented the Powerball defect outright. |

### 2.2 Outbox and delivery (priority 2 — depends on the outbox table existing)

| # | Metric | Source | Sev | Threshold concept | Response |
|---|---|---|---|---|---|
| O-07 | Outbox depth (pending) | `count(*) where status='pending'` | HIGH | Depth > N **or** rising across 3 consecutive samples | Rising depth = worker not draining |
| O-08 | Outbox oldest-pending age | `now() - min(created_at)` pending | **CRITICAL** | > 15 min in a live window | Age beats depth: depth 1 stuck for a day is worse than depth 50 draining |
| O-09 | Delivery failure rate | `failed / attempted` windowed | HIGH | > 5 % | Distinguish provider errors from payload errors |
| O-10 | Dead-letter count | `count(*) where status='dead'` | **CRITICAL** | **> 0** | Any DLQ entry is a lost notification and needs a human |
| O-11 | Retry-exhaustion rate | attempts = max | MEDIUM | any | Signals a systemic provider issue |
| O-12 | Duplicate-send detection | distinct idempotency keys vs. sends | **CRITICAL** | any duplicate | Double-sending result emails to real participants is directly reputational |

Today: none of these are computable. The outbox is a Git-tracked JSON file (T-12) with no status
model, so **delivery state is currently unobservable by construction.**

### 2.3 Data quality and integrity (priority 2)

| # | Metric | Source | Sev | Threshold |
|---|---|---|---|---|
| O-13 | Orphan records | anti-join on each FK path | HIGH | > 0 |
| O-14 | Audit-chain verification | recompute `entry_hash` chain | **CRITICAL** | any break | **Not possible today** — no trigger computes the chain (R-04) |
| O-15 | Audit-log truncation events | count of entries dropped by the 200-cap | **CRITICAL** | > 0 | Currently happening and uncounted (J-04) |
| O-16 | Payments without allocation | `payments` ⟂ `payment_allocations` | HIGH | > 0 |
| O-17 | Allocation ≠ payment total | `sum(allocated) <> amount` | **CRITICAL** | any | Money reconciliation invariant |
| O-18 | Duplicate participant identity | same normalised email, > 1 `participant_id` | MEDIUM | > 0 |
| O-19 | Entries whose predictions fail validation | re-run `validatePicks` server-side | HIGH | > 0 |
| O-20 | `bolao_state` document-schema conformance | validate `state` against a per-app JSON schema | HIGH | any non-conforming row | Would have caught the `cutoffOffsetMs` drift (J-06) |
| O-21 | Unbounded `deletedIds` growth | array length per app row | MEDIUM | > N and monotonically rising | T-16 |

### 2.4 Security drift (priority 1 — cheap and high value)

| # | Metric | Source | Sev | Threshold |
|---|---|---|---|---|
| O-22 | **Privilege snapshot diff** | periodic re-run of the Phase 1 ACL sections; compare to a stored baseline | **CRITICAL** | any unexplained delta | This programme already produced the baseline and the tooling. **Cheapest high-value monitor available.** |
| O-23 | `anon` holds destructive privilege (`TRUNCATE`/`DELETE`) | catalog query | **CRITICAL** | > 0 for TRUNCATE | Would have surfaced the 10-table TRUNCATE grant immediately |
| O-24 | RLS enabled ∧ zero policies | catalog query | HIGH | any *newly* appearing table | Detects the `ensure_rls` surprise (R-08) at creation time |
| O-25 | Policies exist ∧ RLS off | catalog query | **CRITICAL** | > 0 | Currently 0; the most dangerous misconfiguration |
| O-26 | New SECURITY DEFINER function without pinned `search_path` | catalog query | **CRITICAL** | > 0 | Currently 0 — protect that |
| O-27 | Undeclared object appears in production | catalog vs. versioned DDL | HIGH | any | Would have caught `bolao_state` and `ensure_rls` (R-07, R-08) |
| O-28 | Failed admin operations | `audit_events` where outcome = failure | MEDIUM | spike | Requires an admin path that writes audit events (does not exist) |

### 2.5 Migration observability (priority 1 when migrations begin)

| # | Metric | Sev | Threshold |
|---|---|---|---|
| O-29 | Ledger ↔ repo migration-file parity | **CRITICAL** | any mismatch — **currently failing** (R-03) |
| O-30 | Dual-write divergence (JSON vs. relational) | **CRITICAL** | any row differing | The gate that decides whether the read switch is safe |
| O-31 | Backfill completeness | HIGH | source count ≠ target count |
| O-32 | Post-migration constraint validation | **CRITICAL** | any `NOT VALID` constraint remaining |
| O-33 | Migration duration vs. lock time | HIGH | lock > 2 s on a live table |

---

## 3. Health checks

| Check | Question | Implementable today? |
|---|---|---|
| Liveness | Does Supabase REST answer? | ✅ |
| `bolao_state` readable per app | Can each app fetch its row? | ✅ |
| Snapshot freshness | Is the ESPN cache current? | ✅ (file mtime) |
| Scheduler liveness | Did the crons run? | ✅ via Actions API |
| Backup freshness | Recent backup present? | ✅ (file mtime) |
| Restore integrity | Can a backup be restored? | ❌ **no restore path** |
| Audit-chain integrity | Is the chain intact? | ❌ no chain enforcement |
| Privilege baseline | Has the ACL drifted? | ✅ **baseline and tooling already exist** |

## 4. Implementation posture

No infrastructure is proposed. Given no long-running server exists, the pragmatic substrate is a
scheduled workflow emitting to a durable store, ordered by cost-to-value:

1. **Privilege-drift check (O-22/O-23/O-25/O-26).** Reuses this programme's existing read-only query
   pack and baseline. Read-only, no new dependency, catches the highest-severity class. **Start here.**
2. **Cron-coverage unit test (O-06)** and **heartbeat (O-01).** Pure repo-side; no DB access.
3. **Freshness checks (O-02, O-04).** File `mtime` comparisons.
4. **Data-quality anti-joins (O-13…O-18).** After normalisation exists.
5. **Outbox metrics (O-07…O-12).** After the outbox table exists.

**Deliberately rejected:** an APM/tracing stack. There is no request-scoped server to trace; it
would add a dependency and observe nothing that matters here.

## 5. RISKS

- **Alert fatigue would kill this immediately.** The repo's own PII detector is currently 100 %
  false-positive (`HARDCODED_DATA_AUDIT.md` H-00) and has therefore stopped functioning as a gate.
  Any monitor added must be zero-false-positive at introduction or it will be ignored.
- Several signals (O-14, O-15, O-28) **cannot be implemented until the thing they observe exists**.
  Listing them as "planned monitoring" would misrepresent readiness — they are blocked on
  architecture, not on tooling.
- O-22 requires storing a privilege baseline. That baseline is sanitized catalog metadata and must
  stay outside Git like all other raw evidence.

## 6. NEXT DECISION (operator)

1. **Authorise a recurring read-only privilege-drift check?** Highest value per unit effort in this
   entire document; needs a recurring read-only credential path, which is a security decision.
2. **Where do metrics land?** A table in Supabase, a Git-committed JSON, or an external service.
   Determines everything downstream.
3. **Who receives a CRITICAL alert, and by what channel?** Currently: nobody, nowhere.
