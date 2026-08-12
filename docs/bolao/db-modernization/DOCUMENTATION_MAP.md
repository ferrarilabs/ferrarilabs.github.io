# DOCUMENTATION_MAP — consolidation analysis, gap analysis, and quality-gate results

**STATUS:** COMPLETE. Workstream 1 (consolidation/gaps) + Workstream 14 (quality gate).
**EVIDENCE BASIS:** automated cross-reference resolution, orphan detection, required-section checking,
hash validation and finding-ID collision detection across **43 documents** (33 in
`docs/bolao/db-modernization/` + 10 ADRs), plus a manual inventory of the 14 pre-existing
`docs/bolao/` guides.
**KNOWN GAPS:** link *anchors* (`§n`) are not validated, only filenames. Portuguese/English mixing
across the corpus is catalogued but not normalised. Prose quality is not assessed.
**ASSUMPTIONS:** none.

---

## 1. Workstream 1 — why 18 new guides were NOT created

The brief asked for Executive/Developer/Operator Guides, Runbooks, DR, Maintenance, Architecture,
Troubleshooting, Release, Deployment, Operational, Support, Audit, Security, Governance Guides plus
Coding/Contribution/Repository Standards. **Most already have a home.** Creating parallel versions
would violate the repo's own anti-sprawl rule and split authority for the same topic.

| Requested guide | Existing home | Action taken |
|---|---|---|
| Executive Guide | `EXECUTIVE_INDEX.md` | **Extended** (ADR index, namespace registry, A19–A25) |
| Architecture Manual | `docs/bolao/ARCHITECTURE.md` (434 ln) + `PLATFORM_ARCHITECTURE.md` (93) + `TARGET_DATA_MODEL.md` | Referenced; no duplicate |
| Coding / Contribution / Repository Standards | `ENGINEERING_STANDARD.md` (51) + `PLATFORM_GOVERNANCE.md` (90) + root `CLAUDE.md` | Referenced; **DB naming gap filled** by `NAMING_STANDARDS.md` |
| Operator Guide / Operational Guide / Runbook | `CDB2026_OPERATIONS_RUNBOOK.md` (121) | Referenced |
| Disaster Recovery / Maintenance | `PHASE0_BACKUP_GATES.md` (223) + `CDB2026_BACKUP_AND_RECOVERY.md` (94) + `BACKUP_RESTORE_OPERATIONAL_DESIGN.md` | **Extended** (§8–§11); no `BACKUP_STRATEGY_V2.md` authored — deliberate |
| Audit Guide | `AUDIT_PROTOCOL.md` (195) + `AUDIT_READINESS.md` | Referenced |
| Security Guide | `docs/bolao/SECURITY.md` (100) + `RLS_ASSUMPTIONS_REVIEW.md` | Referenced |
| Data Governance Guide | `PHASE0_PII_MAP.md` (236) + `DATA_GOVERNANCE.md` | **Extended**, inventory not restated |
| Release / Deployment Guide | `QA_CHECKLIST.md` (154) + `QA_MASTER_CHECKLIST.md` (373) + `CLAUDE.md` release process | Referenced |
| Troubleshooting / Support Guide | `LESSONS_LEARNED.md` (817) + `BUGS_AND_FEEDBACK.md` | Referenced |
| Developer Guide | `PROJECT_MEMORY.md` (1 357) + `DESIGN_SYSTEM.md` (784) | Referenced |

**Genuine gaps found and filled this sprint:** DB naming standards · object/index/constraint/policy
catalogues · measured performance baseline · test-suite measurement · phased roadmap · living backlog ·
ledger-adoption analysis · 5 new ADRs. **Genuine duplication avoided: 11 documents.**

### 1.1 Oversized documents (split candidates, not split)
`PROJECT_MEMORY.md` (1 357 ln), `LESSONS_LEARNED.md` (817), `DESIGN_SYSTEM.md` (784),
`ARCHITECTURE.md` (434), `QA_MASTER_CHECKLIST.md` (373). All are **pre-existing, referenced, and
outside this programme's scope**. Splitting them would break inbound references across the repo for
cosmetic benefit. Recorded as a candidate, **not actioned** — this is the kind of change that should be
requested, not volunteered.

---

## 2. Workstream 14 — quality-gate results

### 2.1 Cross-reference validation
**225 document references** scanned across 43 files. Initial run reported 20 unresolved; **triage
found 13 were defects in my own checker** (its known-file set excluded repo-root `CLAUDE.md`,
`supabase/migrations/*.md`, `docs/bolao/loterias/*`, and files that legitimately live outside Git).

**Genuinely dangling references — 5, all in FROZEN Phase 0/1A documents:**

| Referencing doc | Dangling target | Assessment |
|---|---|---|
| `PHASE1_EXECUTION_RUNBOOK.md` (×3) | `PHASE1_LIVE_STATE.md` | The file was created as `PHASE1B_LIVE_STATE.md`. **Frozen — cannot fix.** Recorded. |
| `PHASE1_LIVE_STATE_TEMPLATE.md` | `PHASE1_LIVE_STATE.md` | Same |
| `PHASE0_EVIDENCE_GAPS.md` | `PHASE1_LIVE_STATE.md` | Same |
| `PHASE0_INVENTORY.md` | `POWERBALL_DATA_MIGRATION_PLAN.md`, `POWERBALL_PII_AUDIT.md`, `CDB2026_MODERNIZATION_REPORT.md` | Referenced documents that do not exist. **Frozen.** |

**One intentional non-reference:** `ARCHITECTURE_DECISION_REVIEW.md` mentions `BACKUP_STRATEGY_V2.md`
precisely to record that it was **deliberately not created**. Correct prose, not a broken link.

### 2.2 Orphan detection
Initial: **10 orphans — every ADR** (no document referenced them *by filename*; they were cited as
"ADR-004" without extension). **Fixed:** `EXECUTIVE_INDEX.md` §2a now indexes all ten with status and
the challenging decision. **Orphans now: 0.**

### 2.3 Finding-ID namespace collision — the most serious finding
**The `D-` prefix was overloaded three ways:**

| Owner | Range | Resolution |
|---|---|---|
| `PHASE0_DIVERGENCES.md` (**frozen**) | `D-01…D-10` | **Keeps `D-`** — frozen, and it was first |
| `ARCHITECTURE_DECISION_REVIEW.md` | `D-01…D-17` (decisions) | **Renamed → `DEC-`**, matching the `DEC-07` convention already used in `PHASE0_BACKUP_GATES.md` |
| `DEPENDENCY_GRAPH.md` | `D-01…D-05` (findings) | **Renamed → `DG-`** |

Before the fix, "`D-01`" meant *PII in an anon-readable blob* (Phase 0), *the Vanilla-JS decision*
(ADR review), **and** *no restore path exists* (dependency graph) — simultaneously. For a corpus
intended to be read by an auditor with no history, that is a material defect. Renamed across **12
files**; registry published in `EXECUTIVE_INDEX.md` §5a.

**One collision remains and is documented, not fixed:** `RLS_ASSUMPTIONS_REVIEW.md` §3.1 uses
`O-1…O-7` (over-permissive findings) while `OBSERVABILITY_MODEL.md` uses `O-01…O-33` (signals). The
zero-padding distinguishes them in practice and both are heavily cross-referenced; renaming carries
more churn risk than the ambiguity costs. **Accepted with a written reason.**

### 2.4 Artifact quality contract
Checked 23 programme documents for `STATUS` / `EVIDENCE BASIS` / `KNOWN GAPS` / `RISKS` /
`NEXT DECISION`. Initial: 17/23 conforming. **Sections added** to `OBJECT_CATALOG.md`,
`MODERNIZATION_BACKLOG.md`, `DATABASE_RECONCILIATION.md`. Remaining non-conformances are
**checker artefacts** — three docs express the same content under different headings
(`PHASE1B_LIVE_STATE.md` "Provenance and hygiene", `LOGICAL_DATA_MODEL_ASIS.md` "Evidence
limitations", `RLS_ASSUMPTIONS_REVIEW.md` "Outstanding directed reviews"). Substance present, wording
differs. Not rewritten for a checker's benefit.

### 2.5 Hash validation — all PASS

| Artefact | Claimed | Verified |
|---|---|---|
| `PHASE1_READONLY_QUERY_PACK.sql` | `731028a9…18e89` | ✅ **matches approved SHA** |
| Sanitized DDL baseline | `aada07b4…998ce` | ✅ matches |
| Encrypted backup archive | `4a57bf0d…0ac1c` | ✅ matches |

Every hash asserted in prose was independently recomputed. **No documentation claim about an artefact
hash is unverified.**

### 2.6 Duplicated guidance
Checked for the same recommendation stated authoritatively in two places. **Found and resolved
earlier in the programme:** backup gates (Phase 0 authoritative, D-17 amends), PII inventory (Phase 0
authoritative, governance references), PII detection (repo tool authoritative, audit extends), visual
consistency (explicitly out of scope). **No new duplication introduced.**

---

## 3. Corpus statistics

| Metric | Value |
|---|---|
| Programme documents | 25 (`docs/bolao/db-modernization/`, excl. frozen Phase 0/1A) |
| Frozen Phase 0/1A artefacts | 11 (unmodified; query-pack SHA verified) |
| ADRs | 10 (5 pre-existing re-challenged, 5 new) |
| Pre-existing `docs/bolao/` guides referenced | 14 |
| Document cross-references | 225 |
| Dangling references | 5 (all in frozen docs) |
| Orphans | **0** |
| Hash claims verified | 3/3 |
| Finding-ID namespaces | 16, registered |

## 4. RISKS

- **Frozen-document decay.** 5 dangling references live in Phase 0/1A files that cannot be edited. They
  will confuse future readers. The only clean remedy is an authorized Phase 0/1A revision.
- **This map is itself a snapshot.** It was generated by a checker that had defects on first run; a
  future run should re-derive rather than trust these counts.
- **The `O-` collision is accepted, not solved.** If either namespace grows, revisit.

## 5. NEXT DECISION (operator)

1. **Authorize a minimal Phase 0/1A revision** solely to fix the 5 dangling references (and the S09
   `GROUP BY` defect while the file is open)?
2. **Split the 5 oversized pre-existing documents?** Recommended only if inbound references are updated
   in the same change.
3. **Promote the quality gate to a script** in the repo so it runs on documentation changes.
