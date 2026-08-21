# OBJECT_CATALOG — generated reference catalogs and matrices

**STATUS:** GENERATED from sanitized Phase 1/1B evidence plus the 2026-08-08 performance baseline.
**EVIDENCE BASIS:** Phase 1 sections `S02`–`S21f` (35 COLLECTED / 1 SKIPPED / 1 BLOCKED), the
`pg_dump` DDL capture, and read-only `pg_stat_*` / `pg_class` / `pg_stats` queries.
**KNOWN GAPS:** enum **label values** deliberately not catalogued (directed-review rule); policy
**expressions** not catalogued (DR-1 output rule — hashes only); `CHECK` constraint bodies not read.
**REGENERATION:** derived mechanically from the evidence set; not hand-maintained. If production
changes, this file is stale until regenerated — treat it as a snapshot, not a live view.

> Scope: schema `public` only. Provider schemas (`auth`, `storage`, `realtime`, `vault`,
> `supabase_migrations`, `extensions`) are inventoried in `PHASE1B_LIVE_STATE.md` §4 and are
> deliberately out of catalogue scope — they are vendor-owned.

---

## 1. OBJECT CATALOG (schema `public`)

| Object | Kind | Owner | RLS | Forced | Triggers | Total bytes |
|---|---|---|---|---|---|---|
| `bolao_state` | ordinary_table | `postgres` | ✅ | ❌ | no | 294912 |
| `lottery_admin_audit` | ordinary_table | `postgres` | ✅ | ❌ | yes (FK-internal only) | 32768 |
| `lottery_draws` | ordinary_table | `postgres` | ✅ | ❌ | yes (FK-internal only) | 32768 |
| `lottery_participants` | ordinary_table | `postgres` | ✅ | ❌ | yes (FK-internal only) | 32768 |
| `lottery_participations` | ordinary_table | `postgres` | ✅ | ❌ | yes (FK-internal only) | 32768 |
| `lottery_payment_transactions` | ordinary_table | `postgres` | ✅ | ❌ | yes (FK-internal only) | 49152 |
| `lottery_pools` | ordinary_table | `postgres` | ✅ | ❌ | yes (FK-internal only) | 32768 |

**7 tables. 0 views. 0 materialized views. 2 sequences. 3 enum types. 1 function. 0 user triggers.**
`has_triggers = yes` reflects **internal FK-enforcement** triggers only — `S13` confirms **0 user
triggers** in `public`, independently corroborated by `CREATE TRIGGER` count 0 in the `pg_dump`
capture. This is finding R-04.

## 2. INDEX CATALOG

| Table | Index | Unique | Primary | Method | Key cols | Scans (77d) | Size |
|---|---|---|---|---|---|---|---|
| `bolao_state` | `bolao_state_pkey` | ✅ | ✅ | btree | `{id}` | 856 | 16 kB |
| `lottery_admin_audit` | `lottery_admin_audit_pkey` | ✅ | ✅ | btree | `{audit_id}` | 0 | 16 kB |
| `lottery_draws` | `lottery_draws_pkey` | ✅ | ✅ | btree | `{draw_id}` | 21 | 16 kB |
| `lottery_participants` | `lottery_participants_pkey` | ✅ | ✅ | btree | `{participant_id}` | 30 | 16 kB |
| `lottery_participations` | `lottery_participations_pkey` | ✅ | ✅ | btree | `{participation_id}` | 11 | 16 kB |
| `lottery_payment_transactions` | `lottery_payment_transactions_external_reference_uidx` | ✅ | — | btree | `{external_reference}` | 11 | 16 kB |
| `lottery_payment_transactions` | `lottery_payment_transactions_pkey` | ✅ | ✅ | btree | `{transaction_id}` | 0 | 16 kB |
| `lottery_pools` | `lottery_pools_pkey` | ✅ | ✅ | btree | `{pool_id}` | 26 | 16 kB |

**8 indexes for 7 tables — 7 PK + 1 unique. Zero secondary indexes.**
- **0 invalid indexes**, 0 partial, 0 expression, 0 `INCLUDE` columns, all `btree`, all single-column.
- `lottery_payment_transactions_external_reference_uidx` is a **standalone unique INDEX, not a
  UNIQUE CONSTRAINT** (`pg_constraint` contype='u' count = 0). Consequence: **it cannot be the
  target of a foreign key.** If anything must ever reference `external_reference`, promote it.
- Two PK indexes sit at `idx_scan = 0` — expected on near-empty new tables, not debt.

## 3. CONSTRAINT CATALOG

| Type | Count |
|---|---|
| FOREIGN KEY | 17 |
| PRIMARY KEY | 7 |
| **TOTAL** | **24** |

### 3.1 Foreign keys — all 17, with index coverage

| Child | Column(s) | → Parent | On delete | Supporting index? |
|---|---|---|---|---|
| `lottery_admin_audit` | `{actor_user_id}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_draws` | `{created_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_draws` | `{pool_id}` | `public.lottery_pools{pool_id}` | NO ACTION | ❌ **NO** |
| `lottery_draws` | `{updated_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_participants` | `{archived_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_participants` | `{created_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_participants` | `{updated_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_participations` | `{created_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_participations` | `{draw_id}` | `public.lottery_draws{draw_id}` | NO ACTION | ❌ **NO** |
| `lottery_participations` | `{participant_id}` | `public.lottery_participants{participant_id}` | NO ACTION | ❌ **NO** |
| `lottery_participations` | `{pool_id}` | `public.lottery_pools{pool_id}` | NO ACTION | ❌ **NO** |
| `lottery_participations` | `{updated_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_payment_transactions` | `{created_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_payment_transactions` | `{participation_id}` | `public.lottery_participations{participation_id}` | NO ACTION | ❌ **NO** |
| `lottery_payment_transactions` | `{reverses_transaction_id}` | `public.lottery_payment_transactions{transaction_id}` | NO ACTION | ❌ **NO** |
| `lottery_pools` | `{created_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |
| `lottery_pools` | `{updated_by}` | `auth.users{id}` | NO ACTION | ❌ **NO** |

**All 17 foreign keys lack a supporting index — verified programmatically, not inferred.**
11 of 17 reference `auth.users(id)`; all 17 are `ON DELETE NO ACTION`; all are `convalidated`.
**0 CHECK constraints** beyond `NOT NULL`, and **0 UNIQUE constraints** — see §2.

## 4. POLICY CATALOG (expressions never printed — DR-1 rule)

| Table | Policy | Cmd | Roles | USING | WITH CHECK | Identity-aware | Predicate hash |
|---|---|---|---|---|---|---|---|
| `bolao_state` | `allow anon insert` | INSERT | `{anon}` | — | ✅ | **NO** | `b3fa0ec7dede` |
| `bolao_state` | `allow anon upsert bolao state` | INSERT | `{anon}` | — | ✅ | **NO** | `57801f75ec4c` |
| `bolao_state` | `allow anon read` | SELECT | `{anon}` | ✅ | — | **NO** | `b3fa0ec7dede` |
| `bolao_state` | `allow anon read bolao state` | SELECT | `{anon}` | ✅ | — | **NO** | `57801f75ec4c` |
| `bolao_state` | `allow anon update` | UPDATE | `{anon}` | ✅ | ✅ | **NO** | `b3fa0ec7dede` |
| `bolao_state` | `allow anon update bolao state` | UPDATE | `{anon}` | ✅ | ✅ | **NO** | `57801f75ec4c` |

**6 policies, all on `bolao_state`, all `{anon}`, all `PERMISSIVE`, none identity-aware.**
Only **two distinct predicate hashes** across six policies — two stacked generations (T-23).
The other 6 tables have **RLS enabled and zero policies** = default-deny for normal roles.
`DELETE` is covered by no policy, so it is denied despite the grant (DR1-F4).

## 5. PERMISSION MATRIX & CRUD MATRIX

### 5.1 Granted privileges (raw ACL — before RLS)

| Table | `anon` | `authenticated` | `postgres` | `service_role` |
|---|---|---|---|---|
| `bolao_state` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |
| `lottery_admin_audit` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |
| `lottery_draws` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |
| `lottery_participants` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |
| `lottery_participations` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |
| `lottery_payment_transactions` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |
| `lottery_pools` | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M | S,I,U,D,T,R,Tg,M |

`S`=SELECT `I`=INSERT `U`=UPDATE `D`=DELETE `T`=TRUNCATE `R`=REFERENCES `Tg`=TRIGGER `M`=MAINTAIN

### 5.2 EFFECTIVE CRUD — grants crossed with RLS (the matrix that matters)

A grant is only exercisable if RLS permits it. This crosses §5.1 with §4.

| Table | `anon` C | `anon` R | `anon` U | `anon` D | Why |
|---|---|---|---|---|---|
| `bolao_state` | ✅ | ✅ | ✅ | ❌ | Policies cover INSERT/SELECT/UPDATE only; DELETE has no policy ⇒ denied |
| `lottery_admin_audit` | ❌ | ❌ | ❌ | ❌ | RLS enabled, **0 policies** ⇒ default-deny for normal roles |
| `lottery_draws` | ❌ | ❌ | ❌ | ❌ | RLS enabled, **0 policies** ⇒ default-deny for normal roles |
| `lottery_participants` | ❌ | ❌ | ❌ | ❌ | RLS enabled, **0 policies** ⇒ default-deny for normal roles |
| `lottery_participations` | ❌ | ❌ | ❌ | ❌ | RLS enabled, **0 policies** ⇒ default-deny for normal roles |
| `lottery_payment_transactions` | ❌ | ❌ | ❌ | ❌ | RLS enabled, **0 policies** ⇒ default-deny for normal roles |
| `lottery_pools` | ❌ | ❌ | ❌ | ❌ | RLS enabled, **0 policies** ⇒ default-deny for normal roles |

**`service_role`, `postgres`, `supabase_admin`, `supabase_etl_admin`, `supabase_read_only_user`
hold `BYPASSRLS`** — for those five the effective matrix is §5.1, not §5.2. This is the single
most important qualification on this entire catalogue.

**TRUNCATE is absent from `anon` on all 7 tables** following the 2026-08-07 remediation. It
remains present on 3 `storage` tables (out of authorized scope).

## 6. OWNERSHIP MATRIX

| Schema | Owner | Class | Objects |
|---|---|---|---|
| `public` | `pg_database_owner` | APPLICATION | 7 relations |
| `auth` | `supabase_admin` | PROVIDER_MANAGED | 23 relations |
| `extensions` | `postgres` | PROVIDER_MANAGED | 0 relations |
| `extensions` | `postgres` | PROVIDER_MANAGED | 0 relations |
| `extensions` | `postgres` | PROVIDER_MANAGED | 0 relations |
| `graphql` | `supabase_admin` | PROVIDER_MANAGED | 0 relations |
| `graphql_public` | `supabase_admin` | PROVIDER_MANAGED | 0 relations |
| `pgbouncer` | `pgbouncer` | PROVIDER_MANAGED | 0 relations |
| `realtime` | `supabase_admin` | PROVIDER_MANAGED | 3 relations |
| `storage` | `supabase_admin` | PROVIDER_MANAGED | 8 relations |
| `supabase_migrations` | `postgres` | PROVIDER_MANAGED | 1 relations |
| `vault` | `supabase_admin` | PROVIDER_MANAGED | 1 relations |

All 7 `public` tables are owned by `postgres`. Schema `public` is owned by `pg_database_owner`.
**No dedicated application owner role exists** — a target-model gap (`NAMING_STANDARDS.md` §5).

## 7. FUNCTION, TRIGGER, ENUM & EXTENSION CATALOGS

### 7.1 Functions in `public`

| Function | Lang | Volatility | SECURITY DEFINER | search_path pinned | Finding |
|---|---|---|---|---|---|
| `rls_auto_enable()` | plpgsql | volatile | ✅ | ✅ | `SECURITY_DEFINER_WITH_SEARCH_PATH` — EXECUTE revoked from PUBLIC/`anon`/`authenticated`/`service_role` on 2026-08-21 (Issue #270); `proacl` is now `{postgres=X/postgres}`, owner only |

**1 function. `SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH` = 0 across every schema** — the
highest-severity privilege-escalation shape is absent platform-wide. `rls_auto_enable()` is
**undeclared in version control** before the 2026-08-07 baseline capture (R-08).

**Inventory as of 2026-08-21 (Issue #273).** The "1 function" above is the Phase-1 figure and is
kept as the dated record; `public` has since grown to **57 `SECURITY DEFINER` functions**, of which
**4** are reachable by a client role and **0** by `PUBLIC`. All 57 pin `search_path`, so
`SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH = 0` still holds. The static model in
`scripts/db/audit_security_definer_exposure.mjs` was validated against the live catalog and
reproduces it exactly — same 57, same 4, nothing missing or extra on either side. Ratified client
exposure is declared in `bolao/shared/safety/ratified_rpc_exposure.json`.

Since 2026-08-21 it is also no longer executable by any client role (Issue #270). It never needed to
be: PostgreSQL does not consult `EXECUTE` when firing an event trigger, and `anon`, `authenticated`
and `service_role` all have `has_schema_privilege(…,'public','CREATE') = false`, so none of them can
run the DDL that would fire `ensure_rls` in the first place. Proven, not assumed — the firing
behaviour was reproduced on an ephemeral local PostgreSQL 17 cluster, including the negative control
that a disabled trigger leaves RLS off. Gate: `scripts/db/audit_rls_auto_enable_privilege.mjs`.

### 7.2 Triggers

| Scope | Count | Note |
|---|---|---|
| User triggers in `public` | **0** | 3 declared in `001_schema.sql`, never applied (R-04) |
| Event triggers (global) | **7** | 6 `supabase_admin`-owned platform hooks + **`ensure_rls`** (`postgres`-owned, undeclared) |

`ensure_rls` fires on **every** `ddl_command_end` and auto-enables RLS on new tables. It is
omitted by `pg_dump --schema=public` and must be captured separately (R-08).

### 7.3 Enum types

| Type | Labels | Used by |
|---|---|---|
| `participant_state` | 3 | `lottery_participants.state` |
| `payment_txn_type` | 5 | `lottery_payment_transactions.type` |
| `lottery_role` | 3 | `lottery_admin_audit.actor_role` |

**Label values deliberately not catalogued** — directed-review rule. Whether applied labels match
`001_schema.sql`'s declarations is **UNVERIFIED**. Recovered in Phase 1B after `S09` failed.

### 7.4 Extensions

| Extension | Version | Schema |
|---|---|---|
| `pg_stat_statements` | 1.11 | `extensions` |
| `pgcrypto` | 1.3 | `extensions` |
| `plpgsql` | 1.0 | `pg_catalog` |
| `supabase_vault` | 0.3.1 | `vault` |
| `uuid-ossp` | 1.1 | `extensions` |

## 8. RISKS

- **This catalogue is a snapshot, not a live view.** It is generated from a fixed evidence set; any
  production change makes it stale silently. Regenerate rather than hand-edit.
- **§5.1 reads as alarming and §5.2 as reassuring; both are true.** A reader who stops at the raw ACL
  will overstate exposure; one who stops at the effective matrix will forget the five `BYPASSRLS` roles.
  The two must be read together.
- Enum labels and policy expressions are absent by design. A future reader may mistake absence for
  "none exist".

## 9. NEXT DECISION (operator)

1. **Promote `external_reference` from unique index to unique constraint?** Required before any FK can
   reference it (§2).
2. **Authorize the FK index batch** (`PERFORMANCE_BASELINE.md` §5) — currently 0/17 covered.
3. **Schedule regeneration** of this catalogue as part of any migration runbook.
