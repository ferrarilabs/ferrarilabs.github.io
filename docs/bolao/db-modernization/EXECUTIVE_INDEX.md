# EXECUTIVE INDEX — DB modernization documentation set

**Entry point to the programme.** Updated 2026-08-07 (third sprint: DR-1, DDL baseline, backup design, remediation plans, target model).
**Status:** of the original 20-task sprint, **18 are COMPLETE, 2 are PARTIAL.** Four operator
decisions (A3/B1/E1/E3) are now **RATIFIED**. **20 documents** in this directory are **UNCOMMITTED**
pending review.
Unstarted/partial items state their blocker; nothing here is a placeholder.

---

## 1. Programme state

| Phase | State | Authority |
|---|---|---|
| Phase 0 | COMPLETE (frozen, not re-reviewed) | `PHASE0_*.md` |
| Phase 1A | COMPLETE, frozen at commit `2f7074ee0` (pack SHA `731028a9…18e89`) | `PHASE1_READONLY_QUERY_PACK.sql` |
| Phase 1 live discovery | **COMPLETE** — 35 COLLECTED / 1 SKIPPED_BY_PROBE / **1 BLOCKED (S09)** | `PHASE1B_LIVE_STATE.md` §0 |
| TRUNCATE remediation | **COMPLETE AND VERIFIED** — `anon` TRUNCATE on the 7 `public` tables = 0 | evidence outside Git |
| Phase 1B | **COMPLETE** | `PHASE1B_LIVE_STATE.md` |
| Documentation programme | **18/20 complete, 2 partial** | this index §3 |
| Phase 2 (migration execution) | **NOT STARTED** — correctly gated | `AUDIT_READINESS.md` §3.1 |

## 2. Artifacts (all versioned, all uncommitted)

| # | Artifact | Purpose | Task |
|---|---|---|---|
| A1 | `PHASE1B_LIVE_STATE.md` | Operational evidence; usage classification; unowned-object reconciliation; deferred-gap closure; **corrections to the Phase 1 record** | Phase 1B |
| A2 | `DATABASE_RECONCILIATION.md` | Repo ↔ production reconciliation; findings **R-01…R-08** | 1 |
| A3 | `LOGICAL_DATA_MODEL_ASIS.md` | As-is model, keys, cardinalities, Mermaid ERDs, **M-1…M-10** missing constraints | 2 |
| A4 | `RLS_ASSUMPTIONS_REVIEW.md` | Effective access model; **O-1…O-7** over-permissive findings; 6 retired assumptions; DR-1…DR-4 | 8 |
| A5 | `JSON_CLASSIFICATION.md` | `bolao_state` field-by-field classification; **J-01…J-06**; normalisation order | 4 |
| A6 | `DEPENDENCY_GRAPH.md` | Current + target topology; **DG-01…DG-05**; real cron cadences | 5 |
| A7 | `TECHNICAL_DEBT_REPORT.md` | 31 debt items **T-01…T-31**, P0–P3, with evidence paths | 6 |
| A8 | `HARDCODED_DATA_AUDIT.md` | Locations only, **H-00…H-22**; corrects the earlier email over-count | 7 |
| A9 | `DATA_GOVERNANCE.md` | Classification taxonomy, retention, deletion, **G-01…G-04**, GDPR/LGPD readiness | 13 |
| A10 | `NAMING_STANDARDS.md` | Object naming + terminology rulings (**R1–R5**) | 15 |
| A11 | `OBSERVABILITY_MODEL.md` | 33 signals **O-01…O-33**; absence-detection-first design | 14 |
| A12 | `ARCHITECTURE_DECISION_REVIEW.md` | **DEC-01…DEC-17** challenged; target model verdict table | 16, 3, 9, 10 |
| A13 | `AUDIT_READINESS.md` | Big4 assessment, 12-domain scorecard, 7-epic backlog, critical path | 17, 18, 19 |
| A14 | `EXECUTIVE_INDEX.md` | This document | 20 |
| A15 | `DDL_BASELINE_AND_R03_RESOLUTION.md` | Forensic current-state capture; object-by-object reconciliation; A3 transition plan T1–T8 | A1/A2, R-03 |
| A16 | `BACKUP_RESTORE_OPERATIONAL_DESIGN.md` | Exact `pg_dump` procedure, V1–V8 integrity checks, R1–R10 restore verification, acceptance criteria | 12 (operational) |
| A17 | `REMEDIATION_PLANS.md` | B2 / C6 / F1 as three independently committable plans | B2, C6, F1 |
| A18 | `TARGET_DATA_MODEL.md` | Refined normalized model under the four ratified decisions | 3 (refined) |
| A19 | `OBJECT_CATALOG.md` | Generated object/index/constraint/policy/function/enum catalogs + permission & **effective CRUD** matrices | WS5 |
| A20 | `PERFORMANCE_BASELINE.md` | Measured baseline; **P-01…P-06**; capacity analysis | WS7 |
| A21 | `TEST_STRATEGY.md` | Suites **executed**; **TS-01…TS-03**; 4 of 9 classes absent | WS9 |
| A22 | `ROADMAP_PHASED.md` | Phases 1–4 committed, 5–10 conditional with triggers | WS11 |
| A23 | `MODERNIZATION_BACKLOG.md` | **The living queue** — B-01…B-42, 9 corrections | WS13 |
| A24 | `T3_LEDGER_ADOPTION_ANALYSIS.md` | Ledger adoption mechanism comparison + recommendation | T3 |
| A25 | `DOCUMENTATION_MAP.md` | Consolidation/gap analysis + quality-gate results | WS1, WS14 |

**Frozen, unmodified:** all `PHASE0_*.md`, `PHASE1_EXECUTION_RUNBOOK.md`,
`PHASE1_READONLY_QUERY_PACK.sql`, `PHASE1_RESULT_SCHEMA.json`, `PHASE1_LIVE_STATE_TEMPLATE.md`.

**Raw evidence (outside Git, never committed):**
`…-work/db-modernization/phase1-live-20260807T205916Z/` (37 section files, 77 sanitized outputs,
corrected `section_results.tsv`, `CORRECTION_NOTICE.md`, original preserved) ·
`…/phase1b-20260807T213231Z/` · `…/revoke-truncate-anon-20260807T210829Z/` ·
`…/dr1-policy-review-20260807T225551Z/` (DR-1 classification; **no expression text stored**) ·
`…/ddl-baseline-20260807T225629Z/` (`raw/` = private DDL incl. policy literals; `sanitized/` =
versionable candidate, SHA-256 `aada07b4…998ce`).

## 2a. Architecture Decision Records (`docs/bolao/adr/`)

| ADR | Decision | Status |
|---|---|---|
| `ADR-001-vanilla-javascript.md` | Vanilla JS, no framework, no build step | Accepted — upheld, "therefore duplicate" corollary rejected (DEC-01) |
| `ADR-002-state-merge-strategy.md` | Read-merge-write without CAS | Accepted with known limitation — **challenged** (DEC-02) |
| `ADR-003-official-vs-provisional-results.md` | Official vs. provisional scoring | Accepted — upheld unchanged (DEC-03) |
| `ADR-004-client-side-audit-log-limitations.md` | Client-side audit log limits | Accepted — **amendment recommended**: the 200-cap is a defect, not the documented limitation (DEC-04) |
| `ADR-005-scoring-rule-versioning.md` | Scoring rule versioning | Accepted and implemented — upheld and protected (DEC-05) |
| `ADR-006-migration-source-of-truth.md` | `supabase/migrations/` is the single source of truth | Accepted (operator decision A3) |
| `ADR-007-baseline-not-executable-by-design.md` | Baseline committed non-executable; literals stay out of Git | Accepted, temporary limitation |
| `ADR-008-audit-events-exclude-pii.md` | `audit_events` stores IDs, not PII; hash-chain excludes the sidecar | Accepted (operator decision B1) |
| `ADR-009-server-mediated-writes.md` | Edge Functions are the transactional write boundary | Accepted (operator decision E3) |
| `ADR-010-reject-event-sourcing.md` | Full event sourcing **rejected**; append-only log adopted | Accepted (deliberate rejection) |

ADR-001…005 are pre-existing and were re-challenged in `ARCHITECTURE_DECISION_REVIEW.md` §1.
ADR-006…010 were authored by this programme.

## 3. Task ledger

| Task | Deliverable | Status |
|---|---|---|
| 1 Reconciliation | A2 | ✅ COMPLETE |
| 2 Logical model | A3 | ✅ COMPLETE |
| 3 Target model | A12 §3 + **A18** | ✅ **COMPLETE as design** — refined under ratified A3/B1/E1/E3; `prize_allocations` gap closed; `audit_event_details` sidecar resolves G-02. Executable DDL deliberately not generated. |
| 4 JSON classification | A5 | ✅ COMPLETE |
| 5 Dependency graph | A6 | ✅ COMPLETE |
| 6 Technical debt | A7 | ✅ COMPLETE |
| 7 Hardcoded audit | A8 | ✅ COMPLETE |
| 8 RLS assumptions | A4 | ✅ COMPLETE |
| 9 Outbox architecture | A12 DEC-13 | ⚠️ **PARTIAL** — idempotency, retry, DLQ, delivery guarantees and audit trail decided; execution substrate is `BLOCKED_BY_OPERATOR_DECISION` (E3) |
| 10 Event-sourcing boundaries | A12 DEC-14 | ✅ COMPLETE — full ES **rejected** with justification; commands/events/aggregates/snapshots/projections classified |
| 11 Migration roadmap | A12 DEC-16 + A13 EPIC E + A15 §4 | ⚠️ **PARTIAL** — sequence **challenged and re-sequenced** (DEC-11 must precede dual write); A3 transition steps T1–T8 specified. Step-level migration plan remains `BLOCKED_BY_OPERATOR_DECISION` (authorize T1–T3) and gated on R-03 closure. |
| 12 Backup strategy | `PHASE0_BACKUP_GATES.md` + A12 DEC-17 + **A16** | ✅ **COMPLETE** — gates upheld (not duplicated); A16 adds the executable procedure. The Phase 0 gates are already correct and more detailed than a V2; DEC-17 amends them with 2 items. Anti-sprawl rule applied deliberately. |
| 13 Data governance | A9 | ✅ COMPLETE |
| 14 Observability | A11 | ✅ COMPLETE |
| 15 Naming standards | A10 | ✅ COMPLETE |
| 16 Challenge decisions | A12 | ✅ COMPLETE |
| 17 Big4 audit package | A13 §1–2 | ✅ COMPLETE |
| 18 Readiness scorecard | A13 §2 | ✅ COMPLETE |
| 19 Implementation kanban | A13 §3 | ✅ COMPLETE |
| 20 Executive index | A14 | ✅ COMPLETE |

## 4. Recommended reading order

1. **`PHASE1B_LIVE_STATE.md` §0** — corrections first; two earlier conclusions changed.
2. **`DATABASE_RECONCILIATION.md`** — R-03 and R-07 are the programme's real blockers.
3. **`AUDIT_READINESS.md` §1–2** — where the system actually stands (scorecard).
4. **`ARCHITECTURE_DECISION_REVIEW.md`** — what to build and what was rejected.
5. **`AUDIT_READINESS.md` §3** — the backlog and critical path.
6. Reference as needed: A3 (model), A5 (JSON), A6 (topology), A4 (RLS), A7 (debt), A8 (hardcoded),
   A9 (governance), A10 (naming), A11 (observability).

## 5. The four findings that gate everything

| ID | Finding | Why it blocks |
|---|---|---|
| **R-03** | 1 applied migration vs. 6 declared files, **0 mapped** | Any migration designed on `001_schema.sql` targets a schema that does not exist |
| **R-07** | `bolao_state` (money-bearing, CONFIRMED_IN_USE) has **no versioned DDL** | Cannot be rebuilt from the repo; "restore" has no definition |
| **R-08** | Undeclared `postgres`-owned event trigger auto-enables RLS on all new tables | Every future migration yields RLS-on/zero-policy tables and looks broken |
| **G-02** | Right-to-erasure vs. audit hash chain, unresolved | **Irreversible once `audit_events` exists** — decide before building |

## 5a. Finding-ID namespace registry

Three documents independently adopted a `D-` prefix, producing genuinely ambiguous citations. Resolved
2026-08-08; `PHASE0_*` is frozen and keeps its namespace, so the newer documents moved.

| Prefix | Owner | Meaning |
|---|---|---|
| `D-01…D-10` | `PHASE0_DIVERGENCES.md` (**frozen**) | Phase 0 divergences |
| `DEC-01…DEC-17` | `ARCHITECTURE_DECISION_REVIEW.md` | Architecture decisions (was `D-`; matches the `DEC-07` convention already used in `PHASE0_BACKUP_GATES.md`) |
| `DG-01…DG-05` | `DEPENDENCY_GRAPH.md` | Dependency/topology findings (was `D-`) |
| `R-01…R-08` | `DATABASE_RECONCILIATION.md` | Reconciliation findings |
| `J-01…J-06` | `JSON_CLASSIFICATION.md` | JSON model findings |
| `T-01…T-31` | `TECHNICAL_DEBT_REPORT.md` | Debt items |
| `H-00…H-22` | `HARDCODED_DATA_AUDIT.md` | Hardcoded-value findings |
| `G-01…G-04` | `DATA_GOVERNANCE.md` | Governance findings |
| `M-1…M-10` | `LOGICAL_DATA_MODEL_ASIS.md` | Missing constraints |
| `O-01…O-33` | `OBSERVABILITY_MODEL.md` | Observability signals |
| `O-1…O-7` | `RLS_ASSUMPTIONS_REVIEW.md` §3.1 | Over-permissive findings — **still collides with observability `O-0x`**; see `DOCUMENTATION_MAP.md` |
| `P-01…P-06` | `PERFORMANCE_BASELINE.md` | Performance findings |
| `TS-01…TS-03` | `TEST_STRATEGY.md` | Test findings |
| `DR1-F1…F5` | `RLS_ASSUMPTIONS_REVIEW.md` §6a | DR-1 sub-findings |
| `B-01…B-42` | `MODERNIZATION_BACKLOG.md` | Backlog items |
| `C-1…C-9` | `MODERNIZATION_BACKLOG.md` §5 | Self-corrections |

## 6. Open security findings

| ID | Finding | Severity | Status |
|---|---|---|---|
| `HARDCODED_ANON_JWT` | Real anon JWT in 2 tracked scripts (`H-01`, `H-02`) | HIGH | **OPEN** — out of scope by instruction |
| `ANON_DML_GRANTS` | `anon` holds DELETE/INSERT/UPDATE on all 7 tables | HIGH (latent) | **OPEN** — neutralised only by default-deny RLS |
| `ANON_TRUNCATE_STORAGE` | 3 `storage` tables still `anon`-TRUNCATE-able | MEDIUM | **OPEN** — mitigated by 0 buckets |
| `DB_PASSWORD_EXPOSED` | Password pasted in an operator transcript | HIGH | **OPEN** — rotation verified dependency-free |
| `S09_PACK_DEFECT` | Approved pack cannot execute S09 on any PostgreSQL | MEDIUM | **OPEN** — needs authorised Phase 1A revision |
| `DR-1` | 6 `bolao_state` policies: **none identity-aware**; row-allowlist only; effective mechanism `CLIENT_ENFORCED_DEPENDENCY` | HIGH | ✅ **COMPLETE** — read under explicit authorization; expressions never printed. `RLS_ASSUMPTIONS_REVIEW.md` §6a |
| `H-00` | Repo's own PII detector is 100 % false-positive today | MEDIUM | **OPEN** — one-line allowlist fix |

## 7. Readiness

| Gate | State |
|---|---|
| **LOGICAL BACKUP** | ✅ **READY NOW** — nothing gates it; `pg_dump` is self-contained (`BACKUP_RESTORE_OPERATIONAL_DESIGN.md` §0). Procedure fully specified. |
| **BACKUP INTEGRITY VERIFICATION** | ✅ Ready — structure now fully documented |
| **RESTORE REHEARSAL** | ⚠️ **Design complete, not executed** — restore path still does not exist (DG-01); two failure modes pre-identified (client/server version skew; `auth.users` FKs) |
| **ARCHITECTURE DECISIONS** | ✅ **A3/B1/E1/E3 RATIFIED**; target model refined accordingly (`TARGET_DATA_MODEL.md`) |
| **MIGRATION** | ❌ Not authorized. R-03 `MATERIALLY_ADVANCED` (baseline captured, not placed); DEC-11 must precede DEC-16 |

## 8. Governance compliance

- All raw evidence outside Git; no temporary artefact inside any repository.
- All 14 documents scanned against private participant (46 terms) and payment (26 terms) lists plus
  fixed secret patterns: **0 findings**; project ref masked as `<KNOWN_PROJECT_REF>`.
- No participant row, email, payment value, prediction, score, or `bolao_state` JSON content was read
  at any point.
- **DR-1 correction to this claim:** RLS policy expressions *were* read in the third sprint, under
  explicit operator authorization. They were classified **inside SQL**; the expression text was never
  returned to the session, printed, or written to any versioned file. Enum **labels** are present in
  the private DDL capture (they are schema, not data) and were gate-scanned but never printed.
- No production write, DDL, migration, GRANT/REVOKE or RLS change in this sprint.
- Phase 0 / Phase 1A artefacts unmodified. Application, scoring and frontend code untouched.
- **Uncommitted by design.** Three scoring audit suites re-run: copa2026/br2026/cdb2026 all PASS.
