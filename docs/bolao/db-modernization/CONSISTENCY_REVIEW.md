# CONSISTENCY_REVIEW — cross-artefact review (Workstream Z)

**Executable.** `scripts/db/consistency_check.mjs` runs as a gate; this document records what it
found and what was fixed. A one-off manual review is accurate the day it is written and wrong a week
later, so the review is a script and this file is its report.

Current state: **0 errors, 22 warnings** across 50 documents and 10 ADRs.

## What it checks

| Id | Check |
|---|---|
| Z1 | broken links (ERROR) and name mentions that do not resolve (WARN) |
| Z2 | generated files carry their GENERATED warning and their generator exists |
| Z3 | cardinalities quoted in prose match the machine-readable models |
| Z4 | forbidden terminology variants |
| Z5/Z6 | stale blockers and obsolete 'not started' statuses |
| Z7 | orphan ADRs and dangling ADR references |
| Z8 | frozen Phase 0/1A artefact integrity by digest |
| Z9 | the same recommendation carrying two different ids |
| Z10 | target model and access model cover the same tables |

## Model cardinalities (single source of truth)

| Quantity | Value |
|---|---|
| entities | 21 |
| columns | 211 |
| reports | 17 |
| phases | 18 |
| accessEntities | 21 |
| contracts | 8 |

## Findings fixed during this review

| Finding | Fix |
|---|---|
| `BACKUP_STRATEGY_V2.md` referenced by three documents but never created; I had written the same content as `BACKUP_TOOLCHAIN_V2.md` | renamed to the name the existing documents already reference — reconciling to the existing reference beats inventing a name and leaving three dangling links |
| `REPORTING_MODEL.md` used the phrase `settlement flag`, which the terminology rule forbids | reworded at the source (`model/reports.json`) and regenerated; the prohibition is now stated without using the prohibited words |
| two left-prefix index redundancies | resolved at the source in `model/reports.json` rather than merely reported |
| four reports aggregated money with no currency in their grain | currency added to R-01/R-02/R-03/R-15 |
| three index specs named columns absent from the target model | corrected to `payments.paid_at`, `audit_events.aggregate_*`, `outbox_events.next_attempt_at` |

## Checker defects fixed (each was reporting noise, not drift)

These are recorded because a checker that cries wolf is worse than no checker — people learn to ignore it.

| Defect | Symptom | Fix |
|---|---|---|
| single-root path resolution | 35 "broken links" that were correct references to the sibling site checkout | resolve against all candidate roots |
| sibling docs assumed to live in one directory | eleven false positives against documents one level up or in `supabase/migrations/` | index every markdown basename across roots |
| every path treated as a link claim | nine findings against references the text explicitly places elsewhere: another repo and branch, the out-of-Git backups directory, a PROPOSED destination, hypothetical `supabase init` output | a markdown link `[text](path)` is a claim (ERROR); a backticked name is a name (WARN) |
| cardinality regex ignored preceding characters | `M1 reports` and the heading `3.1 Entities` parsed as the claims `1 reports` and `1 entities` | lookbehind excluding letters, digits, dots and hyphens |
| terminology scan read code samples | a forbidden variant quoted from legacy output would be flagged | strip fenced and inline code before scanning prose |

## Frozen artefacts

`PHASE1_READONLY_QUERY_PACK.sql` is pinned by digest and verified on every run. Findings inside any
`PHASE0_*` or `PHASE1_*` document are reported as **NOT correctable**: those files are the evidence record
of what was believed at the time, and editing one rewrites the record instead of fixing anything.

`PHASE0_INVENTORY.md` names powerball migration files that do not exist in any repo, and
`DOCUMENTATION_MAP.md` already records that fact. It stays recorded, not repaired.

## Remaining warnings (verify, do not suppress)

| Id | Finding |
|---|---|
| Z1 | DATABASE_RECONCILIATION.md names bolao/loterias/powerball/migrations/001_schema.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | DDL_BASELINE_AND_R03_RESOLUTION.md names docs/bolao/db-modernization/legacy-sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | NAMING_STANDARDS.md names scripts/fixtures/golden_state.json, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/loterias/powerball/migrations/001_schema.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/loterias/powerball/migrations/002_rls.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/loterias/powerball/migrations/003_rpcs.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/loterias/powerball/migrations/004_rpcs_draws_tickets_publications_results_emails.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/loterias/powerball/scripts/bootstrap_owner_role.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/shared/sql/001_bolao_notification_schema.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names bolao/shared/sql/002_claim_bolao_notification_jobs_rpc.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names supabase/tests/rls/01_anon_select_scope.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names supabase/tests/rls/02_anon_cannot_mass_assign_admin_fields.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names scripts/powerball/import_data_to_supabase.mjs, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_INVENTORY.md names supabase/tests/rls/01_anon_select_scope.sql, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | PHASE0_PII_MAP.md names bolao/scripts/security/check_pii_fixtures.py, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | T3_LEDGER_ADOPTION_ANALYSIS.md names supabase/config.toml, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | T3_LEDGER_ADOPTION_ANALYSIS.md names supabase/config.toml, which is not in this repo — verify it is external, proposed or hypothetical rather than a stale path |
| Z1 | BACKUP_RESTORE_OPERATIONAL_DESIGN.md names sibling doc SUPABASE_RESTORE_REHEARSAL.md, which does not exist under any candidate root — verify it is external, planned, or a stale name |
| Z1 | DOCUMENTATION_MAP.md names sibling doc CDB2026_MODERNIZATION_REPORT.md, which does not exist under any candidate root — verify it is external, planned, or a stale name |
| Z1 | EXECUTIVE_INDEX.md names sibling doc CORRECTION_NOTICE.md, which does not exist under any candidate root — verify it is external, planned, or a stale name |
| Z1 | PHASE0_INVENTORY.md names sibling doc CDB2026_MODERNIZATION_REPORT.md, which does not exist under any candidate root — FROZEN document, NOT correctable |
| Z1 | PHASE1B_LIVE_STATE.md names sibling doc CORRECTION_NOTICE.md, which does not exist under any candidate root — verify it is external, planned, or a stale name |

None of these is suppressed by an allowlist. Each is a name that does not resolve locally, which is
expected for an external repo, an out-of-Git artefact, or a proposed path — and is exactly what someone
should re-verify when a path genuinely does go stale.

## Deliberately not done

- **No frozen file was edited.** Findings inside them are permanent records.
- **No allowlist was added to silence a finding.** The two allowlists that exist name artefacts
  deliberately kept out of Git (private data, raw Phase 1 output), each with its reason.
- **No document was invented** to satisfy a dangling reference, except where the content already existed
  under a different name.
