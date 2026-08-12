# DDL_BASELINE_AND_R03_RESOLUTION — forensic current-state capture and migration provenance

**STATUS:** Capture **COMPLETE**. R-03 **MATERIALLY ADVANCED** — not yet closed (closure requires
placing the baseline under `supabase/migrations/`, which is explicitly deferred).
**EVIDENCE BASIS:** `pg_dump --schema-only --schema=public` against production (read-only, 23 600
bytes), plus read-only catalog queries for global objects `pg_dump` omits. Independently
cross-checked against Phase 1 `S03`–`S13` — **all counts agree**.
**KNOWN GAPS:** capture covers schema `public` only; provider schemas (`auth`, `storage`, `realtime`,
`vault`, `supabase_migrations`) are deliberately excluded as vendor-owned. Enum **label values** are
present in the captured DDL (they are schema, not data) but were never inspected against the private
term lists beyond the automated gate. Vault secret values, participant rows and business data were
not captured.
**ASSUMPTIONS:** none — every object below was read from the live catalog.

> **This is not a migration.** No file was placed in `supabase/migrations/`. No DDL was executed.
> Cross-references: `DATABASE_RECONCILIATION.md` (R-01…R-08), `RLS_ASSUMPTIONS_REVIEW.md` §6a (DR-1),
> `ARCHITECTURE_DECISION_REVIEW.md` DEC-17 (backup ordering).

---

## 1. Capture inventory

**Private raw evidence** (outside Git, `~/Documents/GitHub/ferrarilabs-work/db-modernization/ddl-baseline-20260807T225629Z/`):

| Artefact | Contents |
|---|---|
| `raw/public_schema.sql` | Full `pg_dump` schema-only output, 23 600 bytes — includes policy bodies with literals |
| `raw/event_triggers.sql` | The non-provider event trigger `pg_dump` omits |
| `raw/ownership_rls.csv` | Owner + `rls_enabled` + `rls_forced` per object (9 rows) |
| `raw/literal_mapping.private.txt` | `<LITERAL_n>` → SHA-256(12) of the redacted value. **The values themselves are not stored.** |
| `sanitized/public_schema.sanitized.sql` | Versionable candidate. SHA-256 `aada07b4…998ce` |

**Sanitized baseline gate result:** 0 findings for email / JWT / connection string / unmasked project
ref / API secret / private key / participant name / payment reference. **0 non-placeholder literals
remain on any policy line.** `BASELINE_VERSIONABLE = true`.

### 1.1 What `pg_dump --schema-only` silently omits — and why it matters

A `--schema-only` dump of one schema is **not** a complete reconstruction source. Captured separately:

| Omitted by the dump | Captured how | Consequence if missed |
|---|---|---|
| **Event triggers** (global, not schema-scoped) | direct catalog query | `ensure_rls` would be lost — and it is the mechanism that auto-enables RLS on every new table (R-08). A restore without it behaves differently from production. |
| Roles and role attributes (`BYPASSRLS`, etc.) | Phase 1 `S14e` | Grants would reference non-existent roles |
| Database-level ACL | Phase 1B | — |
| Provider schemas | deliberately excluded | Vendor-owned |

**This is the single most important technical finding of the capture**: anyone who assumed
`pg_dump --schema-only` was a sufficient baseline would have produced a baseline missing the one
object that changes the behaviour of every future migration.

---

## 2. Reconciliation — `CURRENT_PRODUCTION_OBJECT` × `VERSIONED_DEFINITION_FOUND`

`DEFINITION_MATCH` values: `EXACT` · `PARTIAL` (declared, applied differently or incompletely) ·
`NONE` (no versioned definition) · `N/A`.

### 2.1 Tables

| Production object | Versioned definition found | Match | Proposed baseline action |
|---|---|---|---|
| `public.bolao_state` | **NONE** — no `.sql` in any repo | **NONE** | **`BASELINE_FROM_PRODUCTION`** — capture as-is. This is the R-07 fix. |
| `public.lottery_pools` | `001_schema.sql` | PARTIAL | `BASELINE_FROM_PRODUCTION`, reconcile against declaration |
| `public.lottery_participants` | `001_schema.sql` | PARTIAL | as above |
| `public.lottery_participations` | `001_schema.sql` | PARTIAL | as above |
| `public.lottery_draws` | `001_schema.sql` | PARTIAL | as above |
| `public.lottery_payment_transactions` | `001_schema.sql` | PARTIAL | as above |
| `public.lottery_admin_audit` | `001_schema.sql` | **PARTIAL — control missing** | Baseline from production **and** record that the declared triggers are absent (R-04) |

`PARTIAL` rather than `EXACT` because the six tables exist with the declared relational skeleton
(7 PKs, 17 FKs, 3 enum-typed columns all verified) but the migration that created them
(`add_minimal_powerball_schema`) is not `001_schema.sql` and omitted seven sibling tables. A
line-by-line column-level diff against the declaration has **not** been performed and is the one
remaining step to upgrade these rows to `EXACT` or an enumerated delta.

### 2.2 Types, functions, triggers, indexes, policies

| Production object | Versioned definition | Match | Proposed baseline action |
|---|---|---|---|
| `participant_state`, `payment_txn_type`, `lottery_role` (3 enums) | `001_schema.sql` | PARTIAL — labels unverified | `BASELINE_FROM_PRODUCTION`; labels are schema and must be in the baseline |
| `public.rls_auto_enable()` | **NONE** | **NONE** | **`BASELINE_FROM_PRODUCTION`** — R-08 fix, part 1 |
| `ensure_rls` (event trigger) | **NONE** | **NONE** | **`BASELINE_FROM_PRODUCTION`** — R-08 fix, part 2. Must be captured explicitly; the dump omits it. |
| `lottery_payment_transactions_external_reference_uidx` | not confirmed in `001` | PARTIAL | `BASELINE_FROM_PRODUCTION` — the most valuable constraint in the schema |
| 6 `bolao_state` policies | **NONE** | **NONE** | **`BASELINE_FROM_PRODUCTION_SANITIZED`** — literals placeheld; see §2.4 |
| **0 triggers** | 3 declared in `001_schema.sql` | **NONE APPLIED** | **`DECLARED_NOT_APPLIED`** — do **not** silently add to the baseline; a baseline must describe production, not intent (R-04) |
| **0 indexes** beyond the 1 unique + 7 PKs | 14 declared in `supabase_setup.sql` | NONE APPLIED | `DECLARED_NOT_APPLIED` |
| 52 GRANT statements | none | NONE | `BASELINE_FROM_PRODUCTION` — includes the wide `anon` grants; baseline records reality, remediation is separate |

### 2.3 Declared but absent from production — machine-verified

`001_schema.sql` declares **13** tables; production has **6** of them plus one undeclared. Verified
by set difference:

- **In both (6):** `lottery_admin_audit`, `lottery_draws`, `lottery_participants`,
  `lottery_participations`, `lottery_payment_transactions`, `lottery_pools`
- **Production only (1):** `bolao_state`
- **Declared only (7):** `lottery_admin_roles`, `lottery_email_deliveries`, `lottery_email_jobs`,
  `lottery_results`, `lottery_ticket_publication_items`, `lottery_ticket_publications`,
  `lottery_tickets`

`PROPOSED_BASELINE_ACTION` for all 7 declared-only: **`EXCLUDE_FROM_BASELINE`, retain as roadmap.**
A baseline that creates tables production does not have is not a baseline.

### 2.4 Policy literals in the versionable baseline

The 6 policy predicates contain literals (DR-1: `SENSITIVE_LITERAL_PRESENT = YES` on all six). In the
sanitized baseline these are `<LITERAL_1..3>` placeholders — **3 distinct literals across 6
policies**, consistent with DR1-F1 (two predicate generations).

**Consequence, stated plainly:** the sanitized file is **not directly executable**. It is a
reviewable, committable *representation*. Producing an executable baseline requires substituting the
real literals, which must happen from the private raw capture at the moment of use, never through Git.
This is a deliberate trade of executability for committability, and it must be documented wherever the
baseline is used.

---

## 3. R-03 status

| Component of R-03 | Before | Now |
|---|---|---|
| Is production's schema knowable? | No — no reproducible capture existed | ✅ **Yes** — complete, gate-passed capture with SHA-256 |
| Is `bolao_state` defined anywhere? | ❌ No | ✅ **Captured** (not yet versioned) |
| Is `ensure_rls` defined anywhere? | ❌ No | ✅ **Captured** (not yet versioned) |
| Does the repo↔ledger mapping exist? | ❌ 1 applied vs 6 declared, 0 mapped | ⚠️ **Explained and enumerated**, still 0 mapped |
| Can the repo reproduce production? | ❌ No | ⚠️ **Not yet** — requires the baseline to be committed under `supabase/migrations/` |

**`R03_STATUS = MATERIALLY_ADVANCED`.** The *evidence* blocker is removed: the schema is captured,
reconciled object-by-object, and the three previously-undeclared objects are identified with proposed
actions. What remains is an **authorized placement step**, not a discovery step — and that step was
explicitly deferred by the operator ("Do NOT migrate files yet").

R-03 closes when: (a) the baseline lands as the first migration in `supabase/migrations/`;
(b) the ledger records it; (c) parity check O-29 passes.

---

## 4. A3 transition plan — legacy SQL → `supabase/migrations/`

Per ratified **A3**: `supabase/migrations/` in the canonical application repository becomes the source
of truth after the modernization branch is integrated. Legacy setup SQL may remain temporarily for
forensic reference but **must not remain a competing source of truth**.

| Step | Action | Gate |
|---|---|---|
| T1 | Create `supabase/migrations/` in the canonical repo (`ferrarilabs.github.io`) | Branch integration |
| T2 | Place the baseline as `<utc>_baseline_current_production_state.sql` — the executable form, literals substituted from the private capture | T1; operator authorization |
| T3 | Record the baseline in the ledger so O-29 parity holds | T2 |
| T4 | Mark legacy SQL **`FORENSIC_REFERENCE_ONLY`** with an explicit header banner naming `supabase/migrations/` as authoritative | T2 |
| T5 | Move legacy SQL to `docs/bolao/db-modernization/legacy-sql/` (or equivalent) so it cannot be mistaken for live DDL | T4 |
| T6 | Resolve the `supabase_setup.sql` split-brain: the two copies have **already diverged** (200 vs 194 lines, 38 differing lines) — pick one, banner both | T4 |
| T7 | Tombstone the 5 never-applied `supabase_setup.sql` tables with a written reason (T-07) | T5 |
| T8 | Tombstone or roadmap-flag the 7 declared-only `lottery_*` tables | T5 |

**Explicitly NOT done in this task:** no file moved, no legacy SQL deleted, nothing placed in
`supabase/migrations/`. Steps T1–T8 are a plan awaiting authorization.

### 4.1 Banner text proposed for T4

> `-- FORENSIC REFERENCE ONLY — NOT A SOURCE OF TRUTH.`
> `-- Authoritative DDL lives in supabase/migrations/.`
> `-- This file describes an intended schema that was only partially applied to production.`
> `-- See docs/bolao/db-modernization/DDL_BASELINE_AND_R03_RESOLUTION.md §2.3.`

---

## 5. RISKS

- **The baseline records production faithfully, including its defects** — wide `anon` grants,
  6 duplicate policies, missing triggers, missing FK indexes. That is correct for a baseline and
  **must not** be "tidied" during capture, or the baseline stops describing reality and remediation
  becomes untraceable. Remediation is a *subsequent* migration.
- **The sanitized baseline is not executable** (§2.4). Anyone treating it as runnable will produce
  policies referencing placeholder strings.
- **Enum labels are in the captured DDL.** The automated gate found nothing, but labels were never
  human-verified against the private lists. Low risk, explicitly unclosed.
- **A column-level diff against `001_schema.sql` has not been done**, so the six shared tables remain
  `PARTIAL` rather than `EXACT`. This is the largest remaining gap in the reconciliation.

## 6. NEXT DECISION (operator)

1. **Authorize T1–T3** (place the baseline under `supabase/migrations/`)? This is what closes R-03.
2. **Column-level diff of the 6 shared tables against `001_schema.sql`** — authorize as a follow-up?
   It is read-only and repo-side.
3. **Which repository copy of `supabase_setup.sql` is canonical** for T6?
