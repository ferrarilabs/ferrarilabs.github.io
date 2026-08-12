# DATABASE_RECONCILIATION — repository vs. live production catalog

**Status:** COMPLETE for the `public` schema. Evidence-backed, no usage inference.
**Evidence basis:** Phase 1 live discovery (35 COLLECTED / 1 SKIPPED_BY_PROBE / 1 BLOCKED),
plus targeted Phase 1B read-only queries recovering the S09 gap.
**Collection window (UTC):** 2026-08-07T21:00:37Z → 21:00:52Z. Phase 1B: 21:32Z–21:40Z.
**Production identifier:** `<KNOWN_PROJECT_REF>` (masked). PostgreSQL 17.6.

> **Reading rule.** This document reconciles *declared* objects against *existing* objects.
> It deliberately does **not** conclude usage. Usage classification lives in
> `PHASE1B_LIVE_STATE.md`. Catalog existence is never promoted to CONFIRMED_IN_USE here.

---

## 0. Scope and the three states kept separate

| State | Meaning here |
|---|---|
| REPOSITORY_STATE | What versioned SQL/migrations in the local repos *declare* |
| PRODUCTION_STATE | What the live catalog *contains* |
| DEPLOYMENT_STATE | Not in scope for this document. Never inferred from the other two. |

Reconciliation covers schema `public` only. Provider-managed schemas (`auth`, `storage`,
`realtime`, `vault`, `supabase_migrations`, `extensions`, …) are **out of reconciliation scope
by design**: they are vendor-owned, not declared by this repository, and changing them is not
a modernization goal. They are inventoried, not reconciled.

---

## 1. Sources of declared truth (and the first finding)

Versioned SQL is **split across two repositories and is not co-located with the app**:

| # | Path | Repo | Declares |
|---|---|---|---|
| D1 | `bolao/loterias/powerball/migrations/001_schema.sql` | `ferrarilabs-visual-framework-powerball-admin` (branch `powerball-admin-supabase-audit`) | 13 tables, 3 enums, 3 functions, 3 triggers |
| D2 | `…/migrations/002_rls.sql` | same | 13 policies, 1 view, 1 function |
| D3 | `…/migrations/003_rpcs.sql` | same | 8 RPCs + 2 helpers |
| D4 | `…/migrations/004_rpcs_draws_tickets_publications_results_emails.sql` | same | 11 RPCs |
| D5 | `…/scripts/supabase_setup.sql` | same **and** `ferrarilabs.github.io` (duplicated) | 5 tables, 14 indexes, 9 policies |
| D6 | `…/scripts/bootstrap_owner_role.sql` | powerball-admin only | role bootstrap |

> **FINDING R-01 — CRITICAL (traceability).** The DDL that defines production's application
> tables lives on an **unmerged feature branch of a different repository** than the deployed
> application. `ferrarilabs.github.io` (the deployed repo) contains only D5, which declares
> *five tables that do not exist in production*. An auditor reading the deployed repository
> alone cannot derive the production schema. Severity is traceability/recoverability, not
> availability.

> **FINDING R-02 — HIGH (duplication, already divergent).** D5 exists in two repositories with no
> canonical marker, and the two copies **have already diverged**: 200 lines vs 194 lines, 38
> changed lines, different SHA. The set of *declared DDL objects* is still identical (same 5
> tables, 14 indexes, 9 policies), so the divergence is in bodies/comments/policy text rather
> than structure — but it is real drift, not a hypothetical risk, and there is no marker telling a
> reader which copy is authoritative. Split-brain has begun.

---

## 2. Migration ledger vs. declared migrations

Production `supabase_migrations.schema_migrations` contains **exactly one row**:

| version | name |
|---|---|
| `20260806143644` | `add_minimal_powerball_schema` |

The repository declares migrations numbered `001`–`004` plus two setup scripts. **None of those
identifiers appear in the ledger.**

> **FINDING R-03 — CRITICAL (schema provenance).** There is no mapping between the repository's
> migration files and the single applied migration. The applied migration's own name
> (`add_minimal_powerball_schema`) states it is a *subset*. Consequences:
> - the repo cannot be replayed to reproduce production;
> - production cannot be diffed against the repo by version;
> - `001_schema.sql` is **not** the DDL that built production, despite appearing to be.
>
> This is the single most important blocker for the migration program. Any migration designed
> against `001_schema.sql` would target a schema that does not exist.

---

## 3. Object-level reconciliation, `public` schema

Production `public` contains **7 tables, 7 primary keys, 17 foreign keys, 8 indexes,
3 enum types, 7 composite types, 1 function, 0 views, 0 user triggers, 6 RLS policies.**

### 3.1 Present in BOTH repo and production (declared and applied)

| Object | Declared in | Production | Structural match |
|---|---|---|---|
| `lottery_pools` | D1 | table | PK `pool_id`; FKs `created_by`/`updated_by` → `auth.users` |
| `lottery_participants` | D1 | table | PK `participant_id`; 3 FKs → `auth.users`; `state` = `participant_state` enum |
| `lottery_participations` | D1 | table | PK `participation_id`; FKs → participants, pools, draws, `auth.users` ×2 |
| `lottery_draws` | D1 | table | PK `draw_id`; FK → pools; FKs → `auth.users` ×2 |
| `lottery_payment_transactions` | D1 | table | PK `transaction_id`; FK → participations; **self-FK** `reverses_transaction_id`; `type` = `payment_txn_type` enum |
| `lottery_admin_audit` | D1 | table | PK `audit_id`; FK `actor_user_id` → `auth.users`; hash-chain columns present |
| `participant_state`, `payment_txn_type`, `lottery_role` | D1 | enum types in `public` | 3 / 5 / 3 labels (labels not read) |

Referential integrity **is** materialised: 17 FKs exist, all `ON DELETE NO ACTION`. The
declared relational skeleton for these six tables was applied faithfully.

### 3.2 Objects only in the REPOSITORY (declared, **absent** from production)

| Object | Kind | Declared in | Classification |
|---|---|---|---|
| `lottery_tickets` | table | D1 | NOT_APPLIED |
| `lottery_ticket_publications` | table | D1 | NOT_APPLIED |
| `lottery_ticket_publication_items` | table | D1 | NOT_APPLIED |
| `lottery_results` | table | D1 | NOT_APPLIED |
| `lottery_email_jobs` | table | D1 | NOT_APPLIED |
| `lottery_email_deliveries` | table | D1 | NOT_APPLIED |
| `lottery_admin_roles` | table | D1 | NOT_APPLIED |
| `lottery_public_projection` | view | D2 | NOT_APPLIED (production has 0 views in `public`) |
| `trg_lottery_audit_hash`, `trg_lottery_audit_no_update`, `trg_lottery_audit_no_delete` | triggers | D1 | **NOT_APPLIED** — see R-04 |
| `lottery_audit_compute_hash`, `lottery_audit_block_mutation`, `verify_powerball_audit_chain` | functions | D1 | NOT_APPLIED |
| `lottery_current_role`, `lottery_write_audit`, `lottery_validate_reason` | functions | D2/D3 | NOT_APPLIED |
| 19 × `admin_*` RPCs | functions | D3, D4 | **NOT_APPLIED** — see R-05 |
| 13 policies (`*_admin_read`, `roles_owner_all`, `audit_read`) | policies | D2 | NOT_APPLIED |
| `users`, `user_bolao_participation`, `email_log`, `bolao_types`, `audit_log` | tables | D5 | **LEGACY / NEVER_APPLIED** — see R-06 |
| 14 `idx_*` indexes | indexes | D5 | NEVER_APPLIED (dependent on the above) |

> **FINDING R-04 — CRITICAL (audit integrity).** `lottery_admin_audit` carries the hash-chain
> columns (`previous_entry_hash`, `entry_hash NOT NULL`) but **the three triggers that compute
> and protect the chain do not exist in production**. Production confirms **0 user triggers in
> `public`** (`S13`); the `has_triggers = true` flag on these tables comes from *internal FK
> enforcement* triggers only. Therefore:
> - `entry_hash` is `NOT NULL` but nothing computes it → any insert must supply it, and nothing
>   validates it;
> - UPDATE and DELETE on the audit table are **not** blocked, so the table is *not* append-only;
> - `verify_powerball_audit_chain` does not exist, so the chain cannot be verified in-database.
>
> The audit table has the *shape* of a tamper-evident log without the *mechanism*. For a
> Big4-style review this is worse than having no audit table, because the schema advertises a
> control that is not enforced. Currently 1 row exists, so remediation cost is near zero today
> and grows with every row.

> **FINDING R-05 — HIGH (architecture gap).** All 19 `admin_*` RPCs are absent. The repository
> documents an RPC-mediated write path (validation, audit writing, reason enforcement); the
> database has no such path. Any writes reaching these tables today bypass every control the
> RPCs were designed to impose.

> **FINDING R-06 — MEDIUM (dead declaration).** D5's five tables (`users`,
> `user_bolao_participation`, `email_log`, `bolao_types`, `audit_log`) exist in **no**
> production schema and are referenced by no runtime code path found in the audit. They are
> aspirational/legacy DDL. They are also the *only* DDL in the deployed repository, which makes
> the deployed repo actively misleading. Recommend explicit tombstoning, not silent deletion.

### 3.3 Objects only in PRODUCTION (exist, **not declared** in any versioned SQL)

| Object | Kind | Declared anywhere? | Classification |
|---|---|---|---|
| `public.bolao_state` | table | **No `.sql` file in any repo declares it.** Described only in prose in `docs/bolao/PROJECT_MEMORY.md`. | **UNDECLARED_PRODUCTION_OBJECT** |
| `public.rls_auto_enable()` | function, SECURITY DEFINER, pinned `search_path` | No | **UNDECLARED_PRODUCTION_OBJECT** |
| `ensure_rls` | event trigger (`ddl_command_end`) → `public.rls_auto_enable` | No | **UNDECLARED_PRODUCTION_OBJECT** |
| 6 policies on `bolao_state` | policies | No | UNDECLARED_PRODUCTION_OBJECT |
| 7 composite types in `public` | types | No — these are the implicit row-types of the 7 tables | Benign (PostgreSQL-generated) |

> **FINDING R-07 — CRITICAL (the load-bearing undeclared object).** `bolao_state` is the table
> the three live bolão apps actually depend on — one row per app, `state jsonb` — and it has
> **no versioned DDL anywhere**. Its structure (`id text PK`, `state jsonb NOT NULL`,
> `updated_at timestamptz NOT NULL DEFAULT now()`), its 6 RLS policies, and its grants exist
> only in production. If the project were rebuilt from the repository, the money-bearing table
> would not be recreated. This is the highest-priority recoverability gap in the program.

> **FINDING R-08 — HIGH (invisible platform mechanism).** `ensure_rls` is an event trigger
> owned by `postgres` that fires on **every** `ddl_command_end` and calls a SECURITY DEFINER
> function to auto-enable RLS on newly created tables. This explains the otherwise puzzling
> Phase 1 observation that all 7 tables have `rowsecurity = true` while six of them have zero
> policies: RLS was switched on automatically, not deliberately. Consequences:
> - future migrations will silently acquire RLS-enabled tables with **no policies**, i.e.
>   default-deny, which will look like a broken migration to whoever runs it;
> - a SECURITY DEFINER function fires on all DDL and is not in version control;
> - it is *not* a Supabase built-in (the other six event triggers are `supabase_admin`-owned;
>   this one is `postgres`-owned), so it was authored locally and lost.
>
> This must be captured in version control before any migration work begins.

### 3.4 Unknown / requires further evidence

| Object | Question | Route |
|---|---|---|
| 3 enum types | Label *values* not collected (pack policy). Do the applied labels match D1's declarations? | Directed review, authorized separately |
| `bolao_state.state` jsonb | Internal shape never read (PII policy). | `JSON_CLASSIFICATION.md`, derived from app code not DB rows |
| 6 `bolao_state` policies | Expression semantics deliberately not extracted (only structural flags + md5) | DIRECTED_POLICY_REVIEW_REQUIRED |
| `lottery_payment_transactions_external_reference_uidx` | Unique index exists in production; is it declared in D1? Not confirmed in this pass. | Low-cost text diff, next pass |

### 3.5 Candidate orphans

| Object | Why candidate | Why **not** yet confirmed |
|---|---|---|
| `users`, `user_bolao_participation`, `email_log`, `bolao_types`, `audit_log` (D5) | Declared, never applied, no runtime reference | Orphan *declarations*, not orphan DB objects. Safe to tombstone; nothing to drop. |
| 7 NOT_APPLIED lottery tables | Declared, never applied | Represent unfinished roadmap, not debris. Not orphans. |
| **Zero** production objects | — | **No production object is an orphan candidate.** All 7 tables are reachable via FK topology or active traffic. `S08` found 2 sequences, both correctly owned. `S06` found no invalid indexes. |

> Stated plainly for the audit trail: this reconciliation found **nothing in production that
> should be dropped**. The drift is overwhelmingly *repo-declares-more-than-exists*, plus three
> critical *exists-but-undeclared* objects. There is no cleanup task here — there is a
> **capture** task.

---

## 4. Reconciliation scorecard

| Dimension | Count | Verdict |
|---|---|---|
| Declared objects applied to production | 6 tables, 3 enums, 17 FKs, 7 PKs | Faithful where applied |
| Declared objects NOT applied | 12 tables, 1 view, 25 functions, 3 triggers, 22 policies, 14 indexes | Large unapplied surface |
| Production objects NOT declared | 1 table, 1 function, 1 event trigger, 6 policies | **Recoverability gap** |
| Migration ledger ↔ repo mapping | 1 applied vs. 6 declared files, **0 matched** | **Broken provenance** |
| Production objects requiring drop | 0 | Clean |
| Controls declared but not enforced | audit hash chain, append-only audit, 19 RPC write path | **Advertised, not enforced** |

## 5. Prioritised remediation (design only — no DDL in this phase)

| P | Action | Finding | Risk if skipped |
|---|---|---|---|
| P0 | Capture `bolao_state` DDL + policies + grants into versioned SQL | R-07 | Money-bearing table unreproducible |
| P0 | Capture `rls_auto_enable()` + `ensure_rls` into versioned SQL | R-08 | Every future migration behaves surprisingly |
| P0 | Establish repo↔ledger migration provenance (baseline migration reflecting reality) | R-03 | Migration program builds on a fiction |
| P1 | Decide: enforce the audit hash chain, or remove the columns that imply it | R-04 | Advertised control that does not exist |
| P1 | Consolidate DDL into one repository; merge or tombstone the feature branch | R-01, R-02 | Split-brain DDL |
| P2 | Decide fate of the 7 NOT_APPLIED tables and 19 RPCs (roadmap vs. abandon) | R-05 | Ambiguous target model |
| P2 | Tombstone D5's five never-applied tables with a written reason | R-06 | Deployed repo stays misleading |

---

## 6. Provenance

Derived from the Phase 1 artifact set at
`~/Documents/GitHub/ferrarilabs-work/db-modernization/phase1-live-20260807T205916Z/output/`
(77 sanitized files, manifest-covered, exit gate passed with all 8 counters at 0) and the
Phase 1B artifacts at `…/phase1b-20260807T213231Z/`. Raw evidence is deliberately **outside
Git**. No participant row, payment value, prediction, or `bolao_state` JSON content was read to
produce this document.

**Known evidence limitation carried forward:** Phase 1 section **S09 (types/enums) BLOCKED** due
to a deterministic defect in the approved query pack (`GROUP BY` on `aclitem[]`). The type
inventory in §3.1/§3.3 was recovered by targeted Phase 1B queries. See
`PHASE1B_LIVE_STATE.md` §Corrections. Phase 1A artifacts were not modified.

## 7. KNOWN GAPS

- A **column-level diff** of the six shared tables against `001_schema.sql` has not been performed, so
  they remain `PARTIAL` rather than `EXACT` or an enumerated delta. Largest remaining gap here.
- Enum **label parity** between production and declaration is **UNVERIFIED**.
- `CHECK` constraint bodies were not read; production reports 0 beyond `NOT NULL`.
- Provider schemas are inventoried, not reconciled — deliberate.

## 8. NEXT DECISION (operator)

1. Authorize the column-level diff (read-only, repo-side) to close the `PARTIAL` classifications.
2. Confirm which repository copy of `supabase_setup.sql` is canonical (R-02 — already diverged).
3. Decide the fate of the 7 declared-but-unapplied tables and 19 unapplied RPCs (R-05).
