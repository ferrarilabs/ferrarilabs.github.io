# NAMING_STANDARDS — database object naming and terminology

**STATUS:** COMPLETE as a standard. **Nothing renamed; nothing implemented.**
**EVIDENCE BASIS:** existing production names (Phase 1 `S03`–`S06`: 7 tables, 7 PKs, 17 FKs,
8 indexes, 3 enums), declared-but-unapplied names from `migrations/001–004`, and the three apps'
JSON key vocabulary (`JSON_CLASSIFICATION.md`).
**KNOWN GAPS:** none material — naming is a closed design question.
**ASSUMPTIONS:** PostgreSQL/Supabase target; PostgREST exposes table and column names directly to
the public API, so **names are part of the public interface**, not an internal detail.

> Cross-references: `LOGICAL_DATA_MODEL_ASIS.md` (what exists), `ARCHITECTURE_DECISION_REVIEW.md`
> (the target entity set these names apply to).

---

## 1. What the existing code already gets right

The standard below is largely **ratification, not invention** — Model B is internally consistent and
should be the baseline:

| Convention already in use | Example |
|---|---|
| `snake_case` throughout | `lottery_payment_transactions` |
| Domain prefix on tables | `lottery_*` |
| Singular-entity + `_id` surrogate PK | `participant_id`, `pool_id`, `draw_id` |
| PostgreSQL-default PK index naming | `lottery_pools_pkey` |
| Explicit unique-index suffix | `lottery_payment_transactions_external_reference_uidx` |
| `created_at` / `updated_at` / `created_by` / `updated_by` audit columns | all 6 tables |
| `version integer` for optimistic locking | 4 of 6 tables |
| Enum types named as the concept | `participant_state`, `payment_txn_type`, `lottery_role` |

**The outlier is `bolao_state`**, which follows none of it (`id text` rather than `<entity>_id`, no
domain prefix, no `version`). It is the *older* object and should not set the standard.

---

## 2. Terminology decisions

These are the ambiguities that will otherwise be resolved inconsistently by different authors.
Each ruling states *why*, because a naming standard without reasons gets overridden.

| Ambiguity | **Ruling** | Reasoning |
|---|---|---|
| `participant` vs. `user` | **`participant`** for a person in a pool; **`user`** reserved exclusively for `auth.users` (authenticated operator) | These are genuinely different populations. Most participants have no login. Production already uses both correctly: `lottery_participants` for people, `auth.users` for the 11 `created_by`/`updated_by` FKs. Overloading `user` would collide with Supabase's own schema. |
| `pool` vs. `bolao` | **`pool`** in the database; **"bolão"** in the UI/i18n | Never mix languages inside identifiers. Portuguese belongs in `i18n.js`, which already exists for exactly this. `lottery_pools` already chose `pool`. |
| `entry` vs. `participation` | **`pool_entry`** for the durable "this person is in this pool with these predictions"; **retire `participation`** | The apps say `entries`; the relational model says `participations`. Two words for one concept across two models is the exact confusion to eliminate. `entry` wins on: shorter, already used by all three live apps, and reads correctly with "multiple entries per pool". `lottery_participations` becomes the legacy name. |
| `competition` vs. `competition_edition` | **Both, distinctly.** `competition` = the durable tournament ("Copa do Brasil"); `competition_edition` = one running of it ("Copa do Brasil 2026") | Required for year-over-year reporting, which is an explicit goal. Without the split, "participation history across competitions" cannot be expressed. |
| `match` vs. `fixture` | **`match`** | `fixture` is overloaded in this repo — it already means *test fixture* (`scripts/fixtures/golden_state.json`). Reusing it for a football match guarantees confusion in a repo that has both. |
| `tie` (CDB knockout two-legged tie) | **Keep `tie` as a distinct concept**, do not collapse into `match` | A tie *contains* matches and has its own aggregate/qualification rules. `phases[].ties` models a real thing that is not a match. |
| `payment` vs. `payment_allocation` | **Both, separately** | Evidence-driven, not theoretical: the JSON already distinguishes `payerName` from `entryName`, so one person can pay for another. A payment can settle several entries; an entry can be settled by several payments. Many-to-many ⇒ an allocation table is mandatory, not optional. |
| `event` vs. `audit_event` | **`audit_event`** for the immutable record of *what a human did*; **`outbox_event`** for *something to be delivered*. Do **not** use bare `event`. | Bare `event` invites the assumption that event sourcing is in play. It is not — see `ARCHITECTURE_DECISION_REVIEW.md` DEC-09. |
| `result` vs. `score` | **`result`** = the authoritative match outcome; **`score`** = points a participant earned | Currently both are called "results" in different places. Scoring is the untouchable subsystem; its vocabulary must be unambiguous. |
| `state` | **Avoid as a table or column name in new objects** | Already overloaded three ways: `bolao_state.state` (a document), `participant_state` (an enum), `lottery_participations.state` (free text). Prefer `status` for lifecycle, and name documents for their content. |

---

## 3. Object naming rules

| Object | Rule | Example |
|---|---|---|
| **Schema** | `snake_case`, singular domain. Prefer a dedicated app schema over `public` — `public` is PostgREST-exposed by default and carries `PUBLIC USAGE`. | `bolao`, `lottery`, `audit` |
| **Table** | `snake_case`, **plural** | `participants`, `pool_entries`, `payment_allocations` |
| **Column** | `snake_case`, singular; no table-name prefix except on the PK | `display_name`, not `participant_display_name` |
| **Primary key column** | `<singular_table>_id` | `pool_entries.pool_entry_id` |
| **Foreign key column** | Same name as the referenced PK; add a role prefix when a table has two FKs to the same parent | `pool_id`; `reverses_transaction_id`; `created_by` |
| **Boolean** | `is_` / `has_` prefix; never a bare adjective | `is_active`, not `active` |
| **Timestamp** | `_at` suffix, always `timestamptz` — never `timestamp` | `created_at`, `paid_at`, `redacted_at` |
| **Date-only** | `_date` suffix | `draw_date` |
| **Monetary** | `numeric(14,2)`, `_amount` suffix; **never** float | `allocated_amount` |
| **Enum type** | Singular concept, no `_enum` suffix | `payment_txn_type` |
| **Primary key constraint** | `<table>_pkey` (PostgreSQL default — do not fight it) | `participants_pkey` |
| **Foreign key constraint** | `<table>_<column>_fkey` | `pool_entries_participant_id_fkey` |
| **Unique constraint** | `<table>_<cols>_key` | `participants_email_key` |
| **Unique index** (not a constraint) | `<table>_<cols>_uidx` | `payments_external_reference_uidx` |
| **Non-unique index** | `<table>_<cols>_idx` | `pool_entries_pool_id_idx` |
| **Partial index** | append `_partial` | `participants_email_partial_uidx` |
| **Check constraint** | `<table>_<column>_check` describing the rule | `payment_allocations_allocated_amount_check` |
| **View** | `<subject>_v` or a descriptive plural; **always** `security_invoker = true` | `public_ranking_v` |
| **Materialized view** | `<subject>_mv` | `ranking_snapshot_mv` |
| **Function (internal)** | `verb_noun` | `compute_entry_score` |
| **RPC (client-callable)** | `<domain>_<verb>_<noun>` — this name **is public API** via PostgREST | `admin_record_payment` |
| **Trigger function** | `trg_fn_<table>_<purpose>` | `trg_fn_audit_events_hash` |
| **Trigger** | `trg_<table>_<timing>_<purpose>` | `trg_audit_events_before_block_update` |
| **RLS policy** | `<table>_<role>_<command>` — lowercase, no spaces | `pool_entries_anon_select` |
| **Event type value** | `<aggregate>.<past_tense_verb>` | `pool_entry.created`, `payment.reversed` |
| **Outbox record type** | `<channel>.<purpose>` | `email.result_notification` |
| **Migration file** | `<utc_timestamp>_<snake_case_description>.sql` (Supabase CLI convention) | `20260806143644_add_minimal_powerball_schema.sql` |

### 3.1 Rules that carry real weight here

**R1 — Policy names must not contain spaces.** Production currently has policies named
`allow anon read bolao state`. These are quoted identifiers requiring `"..."` forever, they sort
unpredictably, and they are painful in scripts. New policies use `<table>_<role>_<command>`.

**R2 — Never two policies for one rule.** Production has 6 policies where 3 suffice, from two
generations stacked (`TECHNICAL_DEBT_REPORT.md` T-23). Permissive policies OR together, so a
duplicate silently *widens* access. One rule, one policy, replaced not appended.

**R3 — Migration filenames must match the ledger.** The current mismatch between
`001_schema.sql`-style names and the single `20260806143644` ledger entry is the direct cause of
`DATABASE_RECONCILIATION.md` R-03. Adopting the Supabase CLI timestamp convention *is* part of
fixing R-03, not a cosmetic preference.

**R4 — `status` is `text` only with a `CHECK`, otherwise an enum.** Three columns are currently free
`text` while three siblings use enums (T-24). Pick per column and justify; never by accident.

**R5 — Names are public API.** PostgREST exposes table and column names as REST paths and JSON keys.
Renaming later is a breaking client change. This is why the terminology rulings in §2 must be settled
*before* the target tables exist, not after.

---

## 4. Applying the standard to the proposed target entities

Names below reflect §2's rulings. This is naming only — the entity set itself is challenged in
`ARCHITECTURE_DECISION_REVIEW.md`.

| Proposed name (task prompt) | **Standard-conformant name** | Change and why |
|---|---|---|
| `participants` | `participants` | ✅ unchanged |
| `competitions` | `competitions` | ✅ |
| `competition_editions` | `competition_editions` | ✅ |
| `pools` | `pools` | ✅ |
| `pool_entries` | `pool_entries` | ✅ — and `participations` retired (§2) |
| `payments` | `payments` | ✅ |
| `payment_allocations` | `payment_allocations` | ✅ |
| `matches` | `matches` | ✅ — and `fixtures` rejected (§2) |
| `predictions` | `predictions` | ✅ |
| `results` | `match_results` | Disambiguates from participant scores (§2 `result` vs. `score`) |
| `ranking_snapshots` | `ranking_snapshots` | ✅ — the `_snapshots` suffix correctly signals "derived, point-in-time", preventing it being read as a source of truth |
| `audit_events` | `audit_events` | ✅ |
| `outbox_events` | `outbox_events` | ✅ |
| *(missing)* | `competition_edition_phases` | Needed — CDB has per-phase cutoffs (`JSON_CLASSIFICATION.md` §2.4) |
| *(missing)* | `ties` | Needed — a two-legged tie is not a match (§2) |
| *(missing)* | `sync_state` | Needed — `espnSync` cursor has nowhere else to live |
| *(missing)* | `entry_scores` | Needed if scores are ever persisted; must be explicitly named as derived |

## 5. RISKS

- **Renaming existing production objects is a breaking API change** via PostgREST and is **not**
  recommended. This standard governs *new* objects. `bolao_state` and `lottery_*` keep their names
  until they are retired or migrated; the divergence is documented, not "fixed".
- Adopting `pool_entry` while three live apps say `entries` in their JSON creates a translation layer
  during migration. Acceptable and temporary, but it must be written down or it will be
  re-litigated.
- Over-prefixing (`lottery_`) worked when there was one domain. With `bolao` and `lottery` both in
  play, **schema separation is better than table prefixes** — the prefix should not be extended to
  new tables in a dedicated schema.

## 6. NEXT DECISION (operator)

1. **Dedicated schema (`bolao`) or stay in `public`?** Determines whether the `lottery_` prefix
   continues. Also a security decision — `public` carries `PUBLIC USAGE` and PostgREST exposure.
2. **Ratify `entry` over `participation`** — affects every downstream document and cannot be
   deferred past the target-model design.
3. **Ratify the migration-filename convention** as part of resolving R-03.
