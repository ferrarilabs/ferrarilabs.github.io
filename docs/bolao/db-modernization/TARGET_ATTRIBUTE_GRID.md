<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: model/target_model.json
     Generator:       scripts/db/generate_model_docs.mjs
     Regenerate:      node scripts/db/generate_model_docs.mjs
     Any hand edit will be overwritten and will fail `--check` in CI.
     Workstream A — implementation-grade attribute grid -->

# TARGET_ATTRIBUTE_GRID — every column of every target entity

**Model version:** 1.0.0 · **Entities:** 28 · **Columns:** 283 · **FKs:** 46

**Currency policy:** ISO-4217 code stored explicitly per monetary row. USD is the CURRENT value, never an assumption baked into the schema. No DEFAULT on currency columns that carry unknown historical amounts.

**Money type:** numeric(14,2) — exact decimal. FLOAT/REAL/DOUBLE are prohibited platform-wide.

**STATUS:** specification only. No executable DDL is generated from this model.

> Column attributes omitted from the model take these defaults: `nullable=NO`, `pk=NO`,
> `pii=NONE`, `financial=NONE`, `encryption=NONE`, `retention=WITH_PARENT`,
> `audit=CHANGES_AUDITED`, `mutable=YES`, `api=INTERNAL`, `conflict=LAST_WRITE_WINS`.

---

## Domain: identity

### `bolao.participants`

**Purpose.** A durable person who takes part in pools, across competitions and years. PII lives here and ONLY here.

**Owner:** `app_owner` · **Migration phase:** M2

**Rollback implication.** Dropping loses the identity graph; participant_identity_links must be dropped first (FK).

**RLS intent** — anon: none · authenticated: own row via view · admin: select/insert/update via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Participant ID | `participant_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Display name | `display_name` | `text` | YES | — | — | — | — | — | YES |
| Email | `email` | `citext` | YES | — | — | — | — | PARTIAL_WHERE_NOT_NULL | YES |
| Phone | `phone` | `text` | YES | — | — | — | — | — | YES |
| Lifecycle state | `state` | `bolao.participant_state` | NO | `'active'` | — | — | — | — | YES |
| Canonical participant | `canonical_participant_id` | `uuid` | YES | — | — | `bolao.participants.participant_id` | RESTRICT | — | YES |
| Optimistic version | `version` | `integer` | NO | `1` | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Updated at | `updated_at` | `timestamptz` | NO | `now()` | — | — | — | — | YES |
| Created by | `created_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |
| Redacted at | `redacted_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Redaction reason | `redaction_reason` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `participant_id` | PSEUDONYMOUS_ID | NONE | NONE | INDEFINITE_REFERENCE | CHANGES_AUDITED | VIA_VIEW | LAST_WRITE_WINS |
| `display_name` | DIRECT_IDENTIFIER | NONE | NONE | REDACT_IN_PLACE | CHANGES_AUDITED | VIA_VIEW | LAST_WRITE_WINS |
| `email` | CONTACT | NONE | NONE | REDACT_IN_PLACE | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `phone` | CONTACT | NONE | NONE | REDACT_IN_PLACE | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `state` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `canonical_participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | OPTIMISTIC_VERSION |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `updated_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `redacted_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `redaction_reason` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `participant_id` | — | — | — | — | — | — | — | Surrogate. Never derived from PII. |
| `display_name` | — | — | bolao_state | `entries[].entryName` | trim; collapse internal whitespace | one participant per historical entry; ZERO merges on first pass | length between 1 and 120 | — |
| `email` | — | — | bolao_state | `entries[].participantEmail` | lower(trim()) | — | RFC-shaped or NULL | Nullable by evidence — many historical entries have none. Uniqueness is partial, never a merge trigger. |
| `phone` | — | — | — | — | — | — | — | RETAIN ONLY IF A PURPOSE IS CONFIRMED — data minimisation (DATA_GOVERNANCE G-01). Currently no identified use. |
| `state` | — | enum: active | archived | redacted | — | — | — | — | — | — |
| `canonical_participant_id` | — | — | — | — | — | — | — | NULL ⇒ this row IS canonical. Non-NULL ⇒ superseded by a merge; see participant_identity_links. |
| `updated_at` | — | — | — | — | — | — | — | Maintained by trigger, not by the application — bolao_state's updated_at was app-maintained and therefore unreliable. |
| `redacted_at` | — | — | — | — | — | — | — | Erasure-by-redaction (G-02). Row and FKs survive; PII columns are nulled. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `email` | YES | `email IS NOT NULL AND redacted_at IS NULL` | dedup candidate lookup; partial because email is nullable and redacted rows must not block reuse |
| `canonical_participant_id` | NO | — | resolve a superseded identity to its canonical row; unindexed FK would full-scan |
| `lower(display_name)` | NO | — | candidate-match workflow searches by name; expression index avoids a scan |
| `created_by` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 15,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `participants_canonical_not_self` | `canonical_participant_id IS NULL OR canonical_participant_id <> participant_id` | a row cannot supersede itself — would create a 1-cycle |
| `participants_redaction_complete` | `redacted_at IS NULL OR (display_name IS NULL AND email IS NULL AND phone IS NULL)` | a redacted row must not retain PII; makes partial redaction impossible |
| `participants_display_name_present_unless_redacted` | `display_name IS NOT NULL OR redacted_at IS NOT NULL` | display_name was NOT NULL, which made participants_redaction_complete unsatisfiable: that check requires display_name IS NULL once redacted_at is set, so no row could ever be redacted at all (KPLUS-F008, found by workstream F against a real server). The column is now nullable and this check carries the original guarantee exactly — every LIVE participant still must have a name, and NULL is reachable only in the redacted state the model already describes. |

---

### `bolao.participant_identity_links`

**Purpose.** Audited, REVERSIBLE record of every identity merge. Over-merging money is unrecoverable, so the merge itself must be an undoable, attributable act.

**Owner:** `app_owner` · **Migration phase:** M2

**Rollback implication.** Dropping loses merge provenance — the merges themselves would become irreversible. Never drop without exporting.

**RLS intent** — anon: none · authenticated: none · admin: select; insert/update via RPC only · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Link ID | `link_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Surviving participant | `surviving_participant_id` | `uuid` | NO | — | — | `bolao.participants.participant_id` | RESTRICT | — | YES |
| Merged participant | `merged_participant_id` | `uuid` | NO | — | — | `bolao.participants.participant_id` | RESTRICT | — | YES |
| Match confidence | `confidence` | `bolao.match_confidence` | NO | — | — | — | — | — | YES |
| Evidence | `evidence` | `jsonb` | NO | `'{}'::jsonb` | — | — | — | — | YES |
| Reason | `reason` | `text` | NO | — | — | — | — | — | YES |
| Merged at | `merged_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Merged by | `merged_by` | `uuid` | NO | — | — | `auth.users.id` | RESTRICT | — | YES |
| Reverted at | `reverted_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Reverted by | `reverted_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |
| Revert reason | `revert_reason` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `link_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `surviving_participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `merged_participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `confidence` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `evidence` | SENSITIVE_SNAPSHOT | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `reason` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `merged_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `merged_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `reverted_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `reverted_by` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `revert_reason` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `surviving_participant_id` | — | — | — | — | — | — | — | RESTRICT deliberately: deleting a participant that absorbed another would orphan the provenance. |
| `merged_participant_id` | — | — | — | — | — | — | — | The row that was superseded. RETAINED, never deleted — that is what makes the merge reversible. |
| `confidence` | — | enum: exact_email | operator_asserted | probable_name | — | — | — | — | — | — |
| `evidence` | — | — | — | — | — | — | — | What the candidate-match workflow found. MUST NOT contain raw email/name — store field NAMES and match kinds, not values (B1). |
| `reason` | — | — | — | — | — | — | non-empty; an unexplained merge is not acceptable | — |
| `merged_by` | — | — | — | — | — | — | — | RESTRICT: an unattributable merge is worse than no record. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `merged_participant_id` | YES | `reverted_at IS NULL` | a participant may be actively merged into at most ONE survivor; partial so a reverted merge frees it for re-merge |
| `surviving_participant_id` | NO | — | list everything absorbed by a canonical participant |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `pil_no_self_merge` | `surviving_participant_id <> merged_participant_id` | merging a row into itself is meaningless and creates a cycle |
| `pil_revert_complete` | `(reverted_at IS NULL) = (reverted_by IS NULL)` | a revert without an actor is unattributable |
| `pil_reason_present` | `length(btrim(reason)) > 0` | every merge must carry a written justification |

---

### `bolao.participant_auth_links`

**Purpose.** Which auth identities own which participants. KPLUS-F047: this table is RATIFIED (WS12-OP-2), every ownership policy in the RLS model queries it, and write_contracts authorizes against it ('caller owns pool_entry_id via participant_auth_links') — and it was in no model entry and no migration phase. The RLS draft shipped it as a COMMENTED-OUT prerequisite, so applying the migration as generated would have left every ownership policy referencing a relation that does not exist. Found by NIGHT-1, the first run to apply RLS to a database built from zero.

**Owner:** `app_owner` · **Migration phase:** M2

**Rollback implication.** Dropping it breaks every ownership policy — authenticated users lose access to their own rows. Fully rebuildable from the auth provider, but not while policies reference it.

**RLS intent** — anon: none · authenticated: none · admin: select · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Participant | `participant_id` | `uuid` | NO | — | **PK** | `bolao.participants.participant_id` | RESTRICT | — | NO |
| Auth user | `auth_user_id` | `uuid` | NO | — | **PK** | `auth.users.id` | RESTRICT | — | NO |
| Linked at | `linked_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `auth_user_id` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `linked_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `participant_id` | — | — | — | — | — | — | — | Composite PK with auth_user_id: identity and participant are DIFFERENT things. One user may own several participants, and a historical participant may have no auth row at all — which is why ownership is a link table and not a column comparison on participants. |
| `auth_user_id` | — | — | — | — | — | — | — | RESTRICT, not CASCADE: silently dropping a link would silently revoke a participant's access to their own data. |
| `linked_at` | — | — | — | — | — | — | — | When the link was established. Immutable — a re-link is a new row, not an edit. |

---

## Domain: competition

### `bolao.competitions`

**Purpose.** The durable tournament (e.g. 'Copa do Brasil'), independent of any year.

**Owner:** `app_owner` · **Migration phase:** M3

**Rollback implication.** Reference data; safe to drop only if no editions exist.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Competition ID | `competition_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Slug | `slug` | `text` | NO | — | — | — | — | YES | YES |
| Name | `name` | `text` | NO | — | — | — | — | — | YES |
| Sport | `sport` | `text` | NO | `'football'` | — | — | — | — | YES |
| Kind | `kind` | `bolao.competition_kind` | NO | — | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `competition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `slug` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `name` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `sport` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `kind` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `slug` | — | — | — | — | — | — | ^[a-z][a-z0-9_-]{2,40}$ | Stable public identifier. The legacy bolao_state row keys are of this shape. |
| `kind` | — | enum: knockout | league | group_then_knockout | lottery | — | — | — | — | — | DESCRIPTIVE ONLY. Rules/scoring are NEVER driven from this column — repo governance forbids generalising tournament logic (DEC-09). |

---

### `bolao.competition_editions`

**Purpose.** One running of a competition (e.g. 'Copa do Brasil 2026'). The unit that makes year-over-year reporting possible.

**Owner:** `app_owner` · **Migration phase:** M3

**Rollback implication.** Dropping cascades conceptually to pools; use RESTRICT so it cannot be dropped while pools exist.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Edition ID | `competition_edition_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Competition | `competition_id` | `uuid` | NO | — | — | `bolao.competitions.competition_id` | RESTRICT | — | YES |
| Season label | `season_label` | `text` | NO | — | — | — | — | — | YES |
| Season start year | `season_start_year` | `integer` | NO | — | — | — | — | — | YES |
| Status | `status` | `bolao.edition_status` | NO | `'planned'` | — | — | — | — | YES |
| Starts on | `starts_on` | `date` | YES | — | — | — | — | — | YES |
| Ends on | `ends_on` | `date` | YES | — | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `competition_edition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `season_label` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `season_start_year` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `status` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `starts_on` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `ends_on` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `season_label` | — | — | — | — | — | — | — | e.g. '2026'. Text not integer: some competitions span two calendar years ('2026/27'). |
| `season_start_year` | — | between 2000 and 2100 | — | — | — | — | — | Numeric handle for year-over-year reporting; season_label stays the display form. |
| `status` | — | enum: planned | active | concluded | archived | — | — | — | — | — | — |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `competition_id, season_start_year` | YES | — | one edition per competition per season; also the year-over-year join key |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `ce_dates_ordered` | `starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on` | an edition cannot end before it starts |

---

### `bolao.competition_edition_phases`

**Purpose.** A phase within an edition (oitavas, quartas, …) carrying its own entry cutoff. Gives the deadline exactly ONE home, closing J-05's two-sources-of-cutoff problem.

**Owner:** `app_owner` · **Migration phase:** M6

**Rollback implication.** Ties reference phases; RESTRICT.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Phase ID | `competition_edition_phase_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Edition | `competition_edition_id` | `uuid` | NO | — | — | `bolao.competition_editions.competition_edition_id` | RESTRICT | — | YES |
| Phase slug | `slug` | `text` | NO | — | — | — | — | — | YES |
| Ordinal | `ordinal` | `integer` | NO | — | — | — | — | — | YES |
| Entry cutoff | `cutoff_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Cutoff offset ms | `cutoff_offset_ms` | `bigint` | YES | — | — | — | — | — | YES |
| Topology | `topology` | `jsonb` | YES | — | — | — | — | — | YES |
| Draw state | `draw_state` | `text` | YES | — | — | — | — | — | YES |
| undefined | `official_draw` | `jsonb` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `competition_edition_phase_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_edition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `slug` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `ordinal` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `cutoff_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `cutoff_offset_ms` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `topology` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `draw_state` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `official_draw` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `slug` | — | — | bolao_state | `phases{} key` | — | — | ^[a-z][a-z0-9_-]{2,40}$ | — |
| `ordinal` | — | > 0 | — | — | — | — | — | Phase sequence. Drives the valid-transition check in the data-quality framework. |
| `cutoff_at` | — | — | bolao_state | `phases{}.cutoffAt` | — | — | — | Deadlines gate money; this is the authoritative copy. CONFIG.cutoffIso becomes a deploy-time default only. |
| `cutoff_offset_ms` | — | — | bolao_state | `phases{}.cutoffOffsetMs` | — | READ FROM THE LIVE DOCUMENT, not from emptyPhaseState() — this key exists only post-merge and was already silently dropped once (J-06). | — | — |
| `topology` | — | — | — | — | — | — | — | Bracket topology + provenance. Document-shaped by nature; stays JSONB as a column on a relational row. |
| `draw_state` | — | — | — | — | — | — | — | Mirrors the existing DRAW_LIFECYCLE derivation. DERIVED in the app today; stored here only as a materialised convenience, never as the source of truth. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `competition_edition_id, slug` | YES | — | one phase per slug per edition |
| `competition_edition_id, ordinal` | YES | — | phase order must be unambiguous for transition validation |

---

### `bolao.classification_snapshots`

**Purpose.** One retrieval of a league classification for a competition edition. The ENVELOPE only: who provided it, when, whether it is stale, and whether a later correction supersedes it. The club rows live in competition_edition_standings. Modelled because br2026 scoring consumes the league table and no existing entity can hold it: match_results requires goals, ranking_snapshots is keyed on pool_entry_id (a participant, not a club), and ties/matches are knockout pairings.

**Owner:** `trusted sync runtime` · **Migration phase:** DDL-M11

**Rollback implication.** FULL before any snapshot is imported. After import, FORWARD_FIX_ONLY: a snapshot is provider evidence retrieved at a moment that cannot be re-retrieved, and the zone boundaries a past round's scoring was computed against are exactly this row.

**RLS intent** — anon: select via public projection — a league table is public information already published by the provider · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Classification snapshot ID | `classification_snapshot_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Competition edition | `competition_edition_id` | `uuid` | NO | — | — | `bolao.competition_editions.competition_edition_id` | RESTRICT | — | NO |
| Provider | `provider` | `text` | NO | — | — | — | — | — | NO |
| Provider competition ref | `provider_competition_ref` | `text` | YES | — | — | — | — | — | NO |
| Source URL | `source_url` | `text` | YES | — | — | — | — | — | NO |
| Snapshot schema version | `schema_version` | `integer` | NO | — | — | — | — | — | NO |
| Generated at | `generated_at` | `timestamptz` | NO | — | — | — | — | — | NO |
| Source updated at | `source_updated_at` | `timestamptz` | YES | — | — | — | — | — | NO |
| Retrieved at | `retrieved_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Payload hash | `payload_hash` | `text` | NO | — | — | — | — | — | NO |
| Is stale | `is_stale` | `boolean` | NO | `false` | — | — | — | — | YES |
| Stale reason | `stale_reason` | `text` | YES | — | — | — | — | — | YES |
| Club count | `club_count` | `integer` | NO | — | — | — | — | — | NO |
| Created by | `created_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `classification_snapshot_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_edition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider_competition_ref` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_url` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `schema_version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `generated_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_updated_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `retrieved_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payload_hash` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `is_stale` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `stale_reason` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `club_count` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `competition_edition_id` | — | — | — | — | — | — | — | A classification is meaningless without its edition: position 1 of which season. |
| `provider` | — | — | — | — | — | — | ^[a-z][a-z0-9_-]{1,30}$ | Evidence: the snapshot envelope's `provider` field, currently always 'espn'. |
| `provider_competition_ref` | — | — | — | — | — | — | — | Evidence: the envelope's `competitionId`, e.g. 'bra.1'. Kept so a snapshot can be traced back to the exact feed it came from. |
| `source_url` | — | — | — | — | — | — | — | Evidence: sync_espn.py's STANDINGS_CONFIG.source_url. |
| `schema_version` | — | — | — | — | — | — | — | Evidence: the envelope's `schemaVersion`. Stored so a shape change is a data fact rather than a silent reinterpretation. |
| `generated_at` | — | — | — | — | — | — | — | Evidence: `generatedAt`. The instant the provider snapshot was produced; this is what orders snapshots. |
| `source_updated_at` | — | — | — | — | — | — | — | Evidence: `sourceUpdatedAt`. May lag generated_at when the provider served a cached response. |
| `payload_hash` | — | — | — | — | — | — | — | Evidence: `payloadHash`. NOT unique: the cron re-runs on an unchanged table and an identical payload at a later instant is a legitimate second snapshot. |
| `is_stale` | — | — | — | — | — | — | — | Evidence: the envelope's `stale`. A stale snapshot means the fetch failed and the last known good data was reused. It must never be authoritative. |
| `stale_reason` | — | — | — | — | — | — | — | Evidence: `staleReason`. Required whenever is_stale, enforced by a CHECK: a snapshot that cannot say why it is stale cannot be triaged. |
| `club_count` | — | — | — | — | — | — | — | How many standing rows this snapshot carries. Stored so a TRUNCATED import is refusable: the zone boundaries are position slices, so nineteen rows instead of twenty silently moves the relegation zone. |
| `created_by` | — | — | — | — | — | — | — | NULL for the sync runtime, set for an operator correction. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `competition_edition_id, generated_at` | NO | — | the authoritative-snapshot lookup: the latest classification for this edition. The single hottest access path, read once per scoring run. |
| `competition_edition_id, provider, generated_at` | YES | — | one snapshot per provider per instant per edition. Two rows claiming the same instant would make 'the latest' ambiguous. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `classification_snapshots_club_count_positive` | `club_count > 0` | an empty classification is not a classification |
| `classification_snapshots_stale_has_reason` | `is_stale IS FALSE OR stale_reason IS NOT NULL` | a stale snapshot must say why, or it cannot be triaged |

---

### `bolao.competition_edition_standings`

**Purpose.** One club's line in one classification snapshot: its resolved position and its league statistics. This is a LEAGUE TABLE row, not a participant ranking — ranking_snapshots is the participant concept and is keyed on pool_entry_id. br2026's G4/Z4/SA6 zones are pure POSITION SLICES of this table (G4 = 1-4, SA6 = 7-12, Z4 = 17-20), so no zone membership is stored: it is derived from position plus the competition's own rules. Evidence: bolao/br2026/scripts/send_round_email.py:448-450 and bolao/br2026/js/app.js:629-631 (identical slicing in both), plus the persisted snapshot bolao/br2026/data/espn-standings-normalized.json.

**Owner:** `trusted sync runtime` · **Migration phase:** DDL-M11

**Rollback implication.** FULL before any snapshot is imported. After import, FORWARD_FIX_ONLY: these rows are what a past round's zone boundaries were computed from.

**RLS intent** — anon: select via public projection — the league table is public information · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Standing ID | `standing_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Classification snapshot | `classification_snapshot_id` | `uuid` | NO | — | — | `bolao.classification_snapshots.classification_snapshot_id` | RESTRICT | — | NO |
| Position | `position` | `integer` | NO | — | — | — | — | — | NO |
| Provider rank | `provider_rank` | `integer` | YES | — | — | — | — | — | NO |
| Club name | `club_name` | `text` | NO | — | — | — | — | — | NO |
| Club abbreviation | `club_abbr` | `text` | YES | — | — | — | — | — | NO |
| Points | `points` | `integer` | YES | — | — | — | — | — | YES |
| Played | `played` | `integer` | YES | — | — | — | — | — | YES |
| Wins | `wins` | `integer` | YES | — | — | — | — | — | YES |
| Draws | `draws` | `integer` | YES | — | — | — | — | — | YES |
| Losses | `losses` | `integer` | YES | — | — | — | — | — | YES |
| Goals for | `goals_for` | `integer` | YES | — | — | — | — | — | YES |
| Goals against | `goals_against` | `integer` | YES | — | — | — | — | — | YES |
| Goal difference | `goal_difference` | `integer` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `standing_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `classification_snapshot_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `position` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider_rank` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `club_name` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `club_abbr` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `points` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `played` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `wins` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `draws` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `losses` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `goals_for` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `goals_against` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `goal_difference` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `classification_snapshot_id` | — | — | — | — | — | — | — | The edition is reached through the snapshot and is deliberately NOT repeated here: a copy could disagree with its parent about which season it belongs to. |
| `position` | — | — | — | — | — | — | — | The RESOLVED position, 1..club_count, after the app's own deterministic tiebreak. Materialised so no reader re-derives it; the UNIQUE (snapshot, position) index is the 2026-07-14 zone-boundary audit finding made structural. |
| `provider_rank` | — | — | — | — | — | — | — | The provider's own rank, which CAN TIE — that tie is precisely why `position` exists as a separate resolved value. Kept as evidence of what the provider actually said. |
| `club_name` | — | — | — | — | — | — | — | The club identity br2026 scoring compares picks against — the provider's displayName. NOT a foreign key: there is no clubs entity, and inventing a global club master for one competition's league table would be a much larger model change than the evidence supports. The app warns on a name absent from its own DATA.teams list rather than rejecting it. |
| `goal_difference` | — | — | — | — | — | — | — | Provided by the source independently of goals_for/goals_against, so a CHECK asserts the three agree when all are present. A provider that contradicts itself is a CONFLICT the transformer must surface, not silently prefer one field over another. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `classification_snapshot_id, position` | YES | — | two clubs cannot occupy the same position in one snapshot. This is the 2026-07-14 zone-boundary audit finding enforced by the database: an unresolved provider rank tie now fails the import instead of moving a relegation boundary. |
| `classification_snapshot_id, club_name` | YES | — | a club cannot occupy two positions in one snapshot |
| `classification_snapshot_id, position, club_name` | NO | — | the scoring read: fetch a snapshot's table in position order and slice the zones. Covering, so the zone slice needs no heap access. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `competition_edition_standings_position_positive` | `position > 0` | position is 1-based; a zero or negative position would shift every zone slice |
| `competition_edition_standings_gd_consistent` | `goals_for IS NULL OR goals_against IS NULL OR goal_difference IS NULL OR goal_difference = goals_for - goals_against` | the source supplies goal difference independently of the goal counts; if they disagree the row is not trustworthy and must be refused rather than reconciled by guesswork |
| `competition_edition_standings_counts_non_negative` | `(played IS NULL OR played >= 0) AND (wins IS NULL OR wins >= 0) AND (draws IS NULL OR draws >= 0) AND (losses IS NULL OR losses >= 0) AND (goals_for IS NULL OR goals_for >= 0) AND (goals_against IS NULL OR goals_against >= 0)` | a negative match or goal count is impossible and would indicate a parse error |

---

### `bolao.ties`

**Purpose.** A two-legged knockout tie. CONTAINS matches and carries aggregate/qualification rules — a tie is NOT a match, and collapsing them would lose the aggregate.

**Owner:** `app_owner` · **Migration phase:** M6

**Rollback implication.** Matches and predictions reference ties; RESTRICT.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Tie ID | `tie_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Phase | `competition_edition_phase_id` | `uuid` | NO | — | — | `bolao.competition_edition_phases.competition_edition_phase_id` | RESTRICT | — | YES |
| Tie slug | `slug` | `text` | NO | — | — | — | — | — | YES |
| Team A | `team_a` | `text` | YES | — | — | — | — | — | YES |
| Team B | `team_b` | `text` | YES | — | — | — | — | — | YES |
| Qualified side | `qualified_side` | `char(1)` | YES | — | — | — | — | — | YES |
| Provenance | `provenance` | `jsonb` | YES | — | — | — | — | — | YES |
| Predecessor tie | `predecessor_tie_id` | `uuid` | YES | — | — | `bolao.ties.tie_id` | RESTRICT | — | YES |
| undefined | `locked_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| undefined | `locked_by` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `tie_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_edition_phase_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `slug` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `team_a` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `team_b` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `qualified_side` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provenance` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `predecessor_tie_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `locked_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `locked_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `slug` | — | — | bolao_state | `phases{}.ties{} key` | — | — | — | — |
| `qualified_side` | — | in ('A','B') | bolao_state | `phases{}.ties{}.qualifiedTeamId` | — | — | — | Which side advanced. NOT a pairing input — see the draw-provenance invariant: nothing may derive a pairing from qualified teams. |
| `provenance` | — | — | — | — | — | — | — | Official-draw provenance (authority, source, validatedAt, bracketHash). Preserved verbatim from the existing model — it is what makes the bracket auditable. |
| `predecessor_tie_id` | — | — | — | — | — | — | — | Bracket progression QF→SF→Final. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `competition_edition_phase_id, slug` | YES | — | one tie per slug per phase |
| `predecessor_tie_id` | NO | `predecessor_tie_id IS NOT NULL` | walk the bracket forward |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `tie_no_self_predecessor` | `predecessor_tie_id IS NULL OR predecessor_tie_id <> tie_id` | a tie cannot precede itself |
| `tie_distinct_teams` | `team_a IS NULL OR team_b IS NULL OR team_a <> team_b` | a team cannot play itself |

---

### `bolao.matches`

**Purpose.** A single fixture. Named 'match' not 'fixture' because 'fixture' already means test fixture in this repository.

**Owner:** `app_owner` · **Migration phase:** M6

**Rollback implication.** Predictions and results reference matches; RESTRICT.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Match ID | `match_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Tie | `tie_id` | `uuid` | YES | — | — | `bolao.ties.tie_id` | RESTRICT | — | YES |
| Phase | `competition_edition_phase_id` | `uuid` | NO | — | — | `bolao.competition_edition_phases.competition_edition_phase_id` | RESTRICT | — | YES |
| External match ref | `provider_match_ref` | `text` | YES | — | — | — | — | — | YES |
| Leg | `leg` | `integer` | YES | — | — | — | — | — | YES |
| Home team | `home_team` | `text` | NO | — | — | — | — | — | YES |
| Away team | `away_team` | `text` | NO | — | — | — | — | — | YES |
| Kickoff at | `kickoff_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Status | `status` | `bolao.match_status` | NO | `'scheduled'` | — | — | — | — | YES |
| undefined | `venue` | `text` | YES | — | — | — | — | — | YES |
| undefined | `city` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `match_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `tie_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_edition_phase_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider_match_ref` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `leg` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `home_team` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `away_team` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `kickoff_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `status` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `venue` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `city` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `tie_id` | — | — | — | — | — | — | — | NULL for league competitions with no tie structure. |
| `provider_match_ref` | — | — | — | — | — | — | — | ESPN/CBF identifier. Sync correlation only; never an internal key. |
| `leg` | — | in (1,2) | — | — | — | — | — | — |
| `status` | — | enum: scheduled | live | finished | postponed | cancelled | — | — | — | — | — | — |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `tie_id` | NO | `tie_id IS NOT NULL` | 'matches in this tie' — aggregate computation |
| `competition_edition_phase_id` | NO | — | phase listing |
| `provider_match_ref` | YES | `provider_match_ref IS NOT NULL` | idempotent provider sync — prevents double-ingesting one fixture |
| `kickoff_at` | NO | — | 'matches today' for the result-email cron |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `match_distinct_teams` | `home_team <> away_team` | a team cannot play itself |

---

### `bolao.match_results`

**Purpose.** The authoritative outcome of a match. Named match_results, not results, to keep it distinct from participant SCORES.

**Owner:** `app_owner` · **Migration phase:** M7

**Rollback implication.** Scoring reads this. Changing it changes money — treat as append-with-correction, not update-in-place.

**RLS intent** — anon: select via public projection · authenticated: select · admin: write via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Match result ID | `match_result_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Match | `match_id` | `uuid` | NO | — | — | `bolao.matches.match_id` | RESTRICT | — | YES |
| Goals home | `goals_home` | `integer` | NO | — | — | — | — | — | YES |
| Goals away | `goals_away` | `integer` | NO | — | — | — | — | — | YES |
| Penalties home | `penalties_home` | `integer` | YES | — | — | — | — | — | YES |
| Penalties away | `penalties_away` | `integer` | YES | — | — | — | — | — | YES |
| Is official | `is_official` | `boolean` | NO | `false` | — | — | — | — | YES |
| Source | `source` | `text` | NO | — | — | — | — | — | YES |
| Recorded at | `recorded_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Superseded by | `superseded_by_id` | `uuid` | YES | — | — | `bolao.match_results.match_result_id` | RESTRICT | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `match_result_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `match_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `goals_home` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `goals_away` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `penalties_home` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `penalties_away` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `is_official` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `recorded_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `superseded_by_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `goals_home` | — | >= 0 | — | — | — | — | — | — |
| `goals_away` | — | >= 0 | — | — | — | — | — | — |
| `penalties_home` | — | >= 0 | — | — | — | — | — | — |
| `penalties_away` | — | >= 0 | — | — | — | — | — | — |
| `is_official` | — | — | — | — | — | — | — | Preserves ADR-003's official-vs-provisional distinction. Provisional results must never be presented as final. |
| `source` | — | — | — | — | — | — | — | espn | cbf | manual_admin |
| `superseded_by_id` | — | — | — | — | — | — | — | Corrections create a NEW row pointing back. The original is retained — a scoring input must never be silently rewritten. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `match_id` | YES | `superseded_by_id IS NULL AND is_official` | at most ONE official current result per match; partial so superseded corrections coexist |
| `match_id` | NO | — | result history for a match |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `mr_no_self_supersede` | `superseded_by_id IS NULL OR superseded_by_id <> match_result_id` | a result cannot supersede itself |
| `mr_penalties_paired` | `(penalties_home IS NULL) = (penalties_away IS NULL)` | a shootout has two scores or none |

---

## Domain: pool

### `bolao.pools`

**Purpose.** A betting pool for one edition. The money boundary: fees, prize split and entries all hang off it.

**Owner:** `app_owner` · **Migration phase:** M4

**Rollback implication.** Money-bearing children (entries, allocations). RESTRICT everywhere; never cascade.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Pool ID | `pool_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Edition | `competition_edition_id` | `uuid` | NO | — | — | `bolao.competition_editions.competition_edition_id` | RESTRICT | — | YES |
| Slug | `slug` | `text` | NO | — | — | — | — | — | YES |
| Name | `name` | `text` | NO | — | — | — | — | — | YES |
| Status | `status` | `bolao.pool_status` | NO | `'open'` | — | — | — | — | YES |
| Prize split | `prize_split` | `jsonb` | NO | `'{"first":0.70,"second":0.20,"third":0.10}'::jsonb` | — | — | — | — | YES |
| Optimistic version | `version` | `integer` | NO | `1` | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Created by | `created_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |
| undefined | `entry_cutoff_at` | `timestamptz` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `pool_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_edition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `slug` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `name` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | PUBLIC_PROJECTION | LAST_WRITE_WINS |
| `status` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `prize_split` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | OPTIMISTIC_VERSION |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `entry_cutoff_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `slug` | — | — | bolao_state | `row id (text PK)` | — | — | ^[a-z][a-z0-9_-]{2,40}$ | — |
| `status` | — | enum: draft | open | closed | settled | archived | — | — | — | — | — | — |
| `prize_split` | — | — | js/config.js | `CONFIG.prizes` | — | — | values are exact decimals summing to 1.0 | AUTHORITATIVE evidence: identical 70/20/10 in all three configs. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `slug` | YES | — | stable public identifier |

---

### `bolao.pool_entries`

**Purpose.** One competitive entry: this participant, in this pool, with these predictions. Ratified name (E1); replaces 'participation'.

**Owner:** `app_owner` · **Migration phase:** M4

**Rollback implication.** Money-bearing. Allocations and predictions reference it. RESTRICT; soft-delete instead.

**RLS intent** — anon: none (public ranking reads a projection instead) · authenticated: own entries via view · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Entry ID | `pool_entry_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Pool | `pool_id` | `uuid` | NO | — | — | `bolao.pools.pool_id` | RESTRICT | — | YES |
| Participant | `participant_id` | `uuid` | NO | — | — | `bolao.participants.participant_id` | RESTRICT | — | YES |
| Entry label | `entry_label` | `text` | NO | — | — | — | — | — | YES |
| Expected fee amount | `expected_fee_amount` | `numeric(14,2)` | NO | — | — | — | — | — | NO |
| Expected fee currency | `expected_fee_currency` | `char(3)` | NO | — | — | — | — | — | NO |
| Fee schedule provenance | `pool_fee_schedule_id` | `uuid` | YES | — | — | `bolao.pool_fee_schedule.pool_fee_schedule_id` | SET NULL | — | YES |
| Cotas | `cotas` | `numeric(10,4)` | NO | `1` | — | — | — | — | YES |
| State | `state` | `bolao.entry_state` | NO | `'submitted'` | — | — | — | — | YES |
| Settlement status | `settlement_status` | `bolao.settlement_status` | NO | — | — | — | — | — | YES |
| Submitted at | `submitted_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Optimistic version | `version` | `integer` | NO | `1` | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Updated at | `updated_at` | `timestamptz` | NO | `now()` | — | — | — | — | YES |
| Deleted at | `deleted_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Created by | `created_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `pool_entry_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `entry_label` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `expected_fee_amount` | NONE | MONETARY_AMOUNT | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `expected_fee_currency` | NONE | CURRENCY_CODE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_fee_schedule_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `cotas` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `state` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `settlement_status` | NONE | DERIVED_MONETARY | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `submitted_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | OPTIMISTIC_VERSION |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `updated_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `deleted_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `pool_entry_id` | — | — | bolao_state | `entries[].id` | — | reuse the client-generated uuid verbatim — it is already a stable surrogate | — | — |
| `participant_id` | — | — | — | — | — | — | — | NO unique constraint on (participant_id, pool_id) — multiple entries per participant per pool is a RATIFIED requirement. This deliberately supersedes M-3. |
| `entry_label` | — | — | — | — | — | — | non-empty | MANDATORY. With uniqueness on (participant_id, pool_id) removed, this is the only thing distinguishing an intentional second entry from an accidental duplicate. |
| `expected_fee_amount` | — | > 0 | — | — | — | — | — | SNAPSHOT, not a lookup. A 2026 entry keeps its 2026 fee after a 2027 re-price. Deriving from the CURRENT schedule row would silently rewrite history — the single most important modelling decision in the financial domain. |
| `expected_fee_currency` | — | ^[A-Z]{3}$ | — | — | — | — | — | Snapshotted with the amount. NOT NULL, no default — an entry whose currency is unknown cannot be created, forcing the gap into the open. |
| `pool_fee_schedule_id` | — | — | — | — | — | — | — | Which schedule row the snapshot came from. Nullable because legacy entries predate the schedule. |
| `cotas` | — | > 0 | lottery_participations | `cotas` | — | — | — | Share count for per_cota pools. 1 for per_entry pools. |
| `state` | — | enum: draft | submitted | void | — | — | — | — | — | — |
| `settlement_status` | DERIVED_VIEW | — | — | — | — | — | — | NEVER STORED as an authoritative boolean. Derived in bolao_api from allocations vs expected fee. Values: unpaid | partially_paid | settled | overpaid | legacy_asserted. |
| `created_at` | — | — | bolao_state | `entries[].createdAt` | — | — | — | — |
| `updated_at` | — | — | bolao_state | `entries[].updatedAt` | — | — | — | — |
| `deleted_at` | — | — | bolao_state | `deletedIds[]` | — | tombstone set → per-row soft delete. RETIRE deletedIds LAST, only after writes are server-mediated. | — | — |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `participant_id, pool_id, entry_label` | YES | — | multiple entries per pool are allowed, but two entries with the SAME label are an accident, not an intent |
| `pool_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. This is also the read behind every ranking screen: workload W1 sequentially scanned all 20,000 entries without it. |
| `pool_fee_schedule_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `pe_label_present` | `length(btrim(entry_label)) > 0` | the only discriminator between deliberate and accidental duplicates |

---

## Domain: financial

### `bolao.pool_fee_schedule`

**Purpose.** The entry fee for a pool, over time. A schedule rather than a column because a pool may be re-priced and history must stay stable.

**Owner:** `app_owner` · **Migration phase:** M4

**Rollback implication.** Entries snapshot the fee, so dropping the schedule does not corrupt existing entries — that is the point of the snapshot.

**RLS intent** — anon: none · authenticated: select via view · admin: full via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Fee schedule ID | `pool_fee_schedule_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Pool | `pool_id` | `uuid` | NO | — | — | `bolao.pools.pool_id` | RESTRICT | — | YES |
| Fee amount | `fee_amount` | `numeric(14,2)` | NO | — | — | — | — | — | YES |
| Currency | `currency` | `char(3)` | NO | — | — | — | — | — | YES |
| Basis | `basis` | `bolao.fee_basis` | NO | `'per_entry'` | — | — | — | — | YES |
| Effective from | `effective_from` | `timestamptz` | NO | — | — | — | — | — | NO |
| Effective to | `effective_to` | `timestamptz` | YES | — | — | — | — | — | YES |
| Evidence confidence | `confidence` | `bolao.evidence_confidence` | NO | — | — | — | — | — | YES |
| Source | `source` | `text` | NO | — | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `pool_fee_schedule_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `fee_amount` | NONE | MONETARY_AMOUNT | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `currency` | NONE | CURRENCY_CODE | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `basis` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `effective_from` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `effective_to` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `confidence` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `fee_amount` | — | > 0 | js/config.js | `CONFIG.entryFee` | — | 5 for all three football pools — AUTHORITATIVE, and verified unchanged across ~40 historical revisions of each config. Powerball is per-cota at 20 (PROBABLE: the figure lives in prose). | — | — |
| `currency` | — | ^[A-Z]{3}$ (ISO-4217) | — | — | — | — | — | NO DEFAULT, NOT NULL — deliberate. U1 ratified CURRENT_POOL_CURRENCY=USD, but a defaulted currency would let a future pool silently inherit USD and produce wrong money. Backfill sets 'USD' explicitly per row. |
| `basis` | — | enum: per_entry | per_cota | — | — | — | — | — | Football pools are per_entry; Powerball is per_cota. Modelling this avoids forcing one shape onto both. |
| `effective_to` | — | — | — | — | — | — | — | NULL ⇒ currently in force. |
| `confidence` | — | enum: authoritative | probable | historical | unknown | — | — | — | — | — | Carries B-08's evidence classification INTO the data. A fee whose provenance is weak is visible as such rather than laundered into a bare number. |
| `source` | — | — | — | — | — | — | — | e.g. 'versioned_config:CONFIG.entryFee'. Provenance of the value. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `pool_id, effective_from` | NO | — | resolve the fee in force at a point in time |
| `pool_id` | YES | `effective_to IS NULL` | at most ONE currently-in-force fee per pool — prevents two live prices |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `pfs_period_ordered` | `effective_to IS NULL OR effective_from < effective_to` | a fee period cannot end before it begins |

---

### `bolao.payments`

**Purpose.** An inbound money movement as it actually happened. Deliberately NOT tied to a single entry — a payer may fund several.

**Owner:** `app_owner` · **Migration phase:** M5

**Rollback implication.** Financial record. NEVER cascade-delete. Reversal is modelled, not deletion.

**RLS intent** — anon: none · authenticated: none · admin: select; write via RPC only · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Payment ID | `payment_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Payer participant | `payer_participant_id` | `uuid` | YES | — | — | `bolao.participants.participant_id` | RESTRICT | — | YES |
| Amount | `amount` | `numeric(14,2)` | YES | — | — | — | — | — | NO |
| Currency | `currency` | `char(3)` | YES | — | — | — | — | — | NO |
| Kind | `kind` | `bolao.payment_kind` | NO | — | — | — | — | — | YES |
| Method | `method` | `text` | YES | — | — | — | — | — | YES |
| Provider | `provider` | `text` | YES | — | — | — | — | — | YES |
| External reference | `external_reference` | `text` | YES | — | — | — | — | PARTIAL_WHERE_NOT_NULL | YES |
| Paid at | `paid_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Reverses payment | `reverses_payment_id` | `uuid` | YES | — | — | `bolao.payments.payment_id` | RESTRICT | — | YES |
| Memo | `memo` | `text` | YES | — | — | — | — | — | YES |
| Proof object path | `proof_object_path` | `text` | YES | — | — | — | — | — | YES |
| Unapplied amount | `unapplied_amount` | `numeric(14,2)` | NO | — | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Created by | `created_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `payment_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payer_participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `amount` | NONE | MONETARY_AMOUNT | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `currency` | NONE | CURRENCY_CODE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `kind` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `method` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `external_reference` | SENSITIVE_SNAPSHOT | EXTERNAL_REFERENCE | AT_REST_PROVIDER | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `paid_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `reverses_payment_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `memo` | SENSITIVE_SNAPSHOT | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `proof_object_path` | SENSITIVE_SNAPSHOT | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `unapplied_amount` | NONE | DERIVED_MONETARY | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `payer_participant_id` | — | — | bolao_state | `entries[].payerName` | — | — | — | THIS IS HOW payer ≠ participant IS EXPRESSED. Nullable only for legacy rows where the payer is unrecoverable. |
| `amount` | — | — | — | — | — | — | — | NULLABLE ONLY for legacy_asserted rows migrated from the paid boolean, where no amount ever existed. A NULL amount can never be allocated. |
| `currency` | — | ^[A-Z]{3}$ | — | — | — | — | — | — |
| `kind` | — | enum: contribution | adjustment | refund | reversal | chargeback | void | — | — | — | — | — | — |
| `method` | — | — | bolao_state | `entries[].paymentMethod` | — | — | — | — |
| `provider` | — | — | — | — | — | — | — | zelle | venmo | cashapp | pix | paypal | other |
| `external_reference` | — | — | — | — | — | — | — | Carries forward the ONE genuinely enforced constraint in the current schema. MUST NOT appear in any report or public view — the txId governance rule. |
| `reverses_payment_id` | — | — | — | — | — | — | — | Self-reference. A reversal points at what it reverses; neither row is ever deleted. |
| `memo` | — | — | — | — | — | — | — | Free text — treat as potentially PII-bearing and keep out of reports. |
| `unapplied_amount` | DERIVED_VIEW | — | — | — | — | — | — | amount − SUM(allocations). DERIVED, never stored: a stored balance is a second truth that drifts. See FINANCIAL_MODEL reconciliation equations. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `external_reference` | YES | `external_reference IS NOT NULL` | makes double-recording a payment reference impossible; observed firing 11/11 on inserts in production |
| `payer_participant_id` | NO | — | 'everything this person paid' — the payment-history report |
| `reverses_payment_id` | NO | `reverses_payment_id IS NOT NULL` | find the reversal of a payment without scanning |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `pay_no_self_reverse` | `reverses_payment_id IS NULL OR reverses_payment_id <> payment_id` | a payment cannot reverse itself |
| `pay_amount_currency_together` | `(amount IS NULL) = (currency IS NULL)` | an amount without a currency is not money |
| `pay_amount_sign` | `amount IS NULL OR (kind IN ('refund','reversal','chargeback') AND amount < 0) OR (kind NOT IN ('refund','reversal','chargeback') AND amount > 0)` | sign convention is explicit rather than assumed; zero is never valid |

---

### `bolao.payment_allocations`

**Purpose.** Applies part of a payment to a specific entry. Resolves the real many-to-many: one payment may fund several entries; one entry may be funded by several payments.

**Owner:** `app_owner` · **Migration phase:** M5

**Rollback implication.** Deleting an allocation silently changes settlement. Prefer a compensating negative allocation over deletion.

**RLS intent** — anon: none · authenticated: none · admin: select; write via RPC only · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Allocation ID | `allocation_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Payment | `payment_id` | `uuid` | NO | — | — | `bolao.payments.payment_id` | RESTRICT | — | YES |
| Entry | `pool_entry_id` | `uuid` | NO | — | — | `bolao.pool_entries.pool_entry_id` | RESTRICT | — | YES |
| Allocated amount | `allocated_amount` | `numeric(14,2)` | NO | — | — | — | — | — | NO |
| Currency | `currency` | `char(3)` | NO | — | — | — | — | — | NO |
| Allocated at | `allocated_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Allocated by | `allocated_by` | `uuid` | YES | — | — | `auth.users.id` | SET NULL | — | YES |
| Note | `note` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `allocation_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payment_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_entry_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `allocated_amount` | NONE | MONETARY_AMOUNT | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `currency` | NONE | CURRENCY_CODE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `allocated_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `allocated_by` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `note` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `allocated_amount` | — | <> 0 | — | — | — | — | — | — |
| `currency` | — | ^[A-Z]{3}$ | — | — | — | — | — | MUST equal the payment's currency AND the entry's expected_fee_currency. Cross-currency allocation is a data-quality violation, not a feature. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `pool_entry_id` | NO | — | sum allocations per entry — the settlement derivation; the single most important index in the financial domain |
| `payment_id, pool_entry_id` | YES | — | one allocation row per (payment, entry) pair; adjust by amending the row, not by adding a second |

---

### `bolao.prize_allocations`

**Purpose.** OUTBOUND money: a prize awarded to an entry. Kept strictly separate from entry payments — conflating inbound and outbound makes reconciliation ambiguous.

**Owner:** `app_owner` · **Migration phase:** M5

**Rollback implication.** Financial record; never cascade.

**RLS intent** — anon: none · authenticated: own via view · admin: select; write via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Prize allocation ID | `prize_allocation_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Pool | `pool_id` | `uuid` | NO | — | — | `bolao.pools.pool_id` | RESTRICT | — | YES |
| Entry | `pool_entry_id` | `uuid` | NO | — | — | `bolao.pool_entries.pool_entry_id` | RESTRICT | — | YES |
| Participant | `participant_id` | `uuid` | NO | — | — | `bolao.participants.participant_id` | RESTRICT | — | YES |
| Rank | `rank` | `integer` | NO | — | — | — | — | — | YES |
| Gross amount | `gross_amount` | `numeric(14,2)` | NO | — | — | — | — | — | YES |
| Net amount | `net_amount` | `numeric(14,2)` | YES | — | — | — | — | — | YES |
| Currency | `currency` | `char(3)` | NO | — | — | — | — | — | YES |
| Share of pool | `share_of_pool` | `numeric(6,5)` | YES | — | — | — | — | — | YES |
| Awarded at | `awarded_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Paid out at | `paid_out_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Payout reference | `payout_external_reference` | `text` | YES | — | — | — | — | — | YES |
| Payout method | `payout_method` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `prize_allocation_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_entry_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `participant_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `rank` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `gross_amount` | NONE | MONETARY_AMOUNT | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `net_amount` | NONE | MONETARY_AMOUNT | NONE | RETAIN_5Y_FINANCIAL | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `currency` | NONE | CURRENCY_CODE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `share_of_pool` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `awarded_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `paid_out_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payout_external_reference` | SENSITIVE_SNAPSHOT | EXTERNAL_REFERENCE | NONE | WITH_PARENT | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `payout_method` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `participant_id` | — | — | — | — | — | — | — | Denormalised from the entry for reporting. Kept consistent by a data-quality rule, not by trust. |
| `rank` | — | > 0 | — | — | — | — | — | — |
| `gross_amount` | — | > 0 | — | — | — | — | — | — |
| `currency` | — | ^[A-Z]{3}$ | — | — | — | — | — | — |
| `share_of_pool` | — | > 0 AND <= 1 | — | — | — | — | — | e.g. 0.70000. Lets a prize be split across multiple entries on the same rank. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `participant_id` | NO | — | 'everything this person won' — the winnings report |
| `pool_entry_id` | NO | — | prize per entry |
| `pool_id, rank, pool_entry_id` | YES | — | an entry cannot be awarded the same rank twice, while a rank may still be split across entries |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `prz_net_le_gross` | `net_amount IS NULL OR net_amount <= gross_amount` | net cannot exceed gross |

---

## Domain: prediction

### `bolao.predictions`

**Purpose.** One participant's prediction for one subject (match or tie). SCORING-ADJACENT: migrated LAST, with a parity proof.

**Owner:** `app_owner` · **Migration phase:** M7

**Rollback implication.** Scoring input. Revert to pool_entries.picks jsonb if parity fails.

**RLS intent** — anon: none before cutoff; projection after · authenticated: own via view · admin: select; write via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Prediction ID | `prediction_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Entry | `pool_entry_id` | `uuid` | NO | — | — | `bolao.pool_entries.pool_entry_id` | RESTRICT | — | YES |
| Match | `match_id` | `uuid` | YES | — | — | `bolao.matches.match_id` | RESTRICT | — | YES |
| Tie | `tie_id` | `uuid` | YES | — | — | `bolao.ties.tie_id` | RESTRICT | — | YES |
| Predicted goals home | `predicted_goals_home` | `integer` | YES | — | — | — | — | — | YES |
| Predicted goals away | `predicted_goals_away` | `integer` | YES | — | — | — | — | — | YES |
| Predicted qualified side | `predicted_qualified_side` | `char(1)` | YES | — | — | — | — | — | YES |
| Submitted at | `submitted_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Locked | `locked` | `boolean` | NO | `false` | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `prediction_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_entry_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `match_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `tie_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `predicted_goals_home` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `predicted_goals_away` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `predicted_qualified_side` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `submitted_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `locked` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `match_id` | — | — | bolao_state | `entries[].picks.matches{}` | — | — | — | — |
| `tie_id` | — | — | bolao_state | `entries[].picks.qualified{}` | — | — | — | — |
| `predicted_goals_home` | — | >= 0 | — | — | — | — | — | — |
| `predicted_goals_away` | — | >= 0 | — | — | — | — | — | — |
| `predicted_qualified_side` | — | in ('A','B') | — | — | — | — | — | — |
| `submitted_at` | — | — | — | — | — | — | — | Compared against the phase cutoff by a data-quality rule — a prediction after lock is a fairness violation. |
| `locked` | — | — | — | — | — | — | — | Set when the cutoff passes. Once true the row is immutable. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `pool_entry_id` | NO | — | all predictions for an entry — the scoring read path |
| `match_id` | NO | `match_id IS NOT NULL` | score a match across all entries |
| `pool_entry_id, match_id` | YES | `match_id IS NOT NULL` | one prediction per entry per match |
| `pool_entry_id, tie_id` | YES | `tie_id IS NOT NULL` | one qualification pick per entry per tie |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `pred_subject_exactly_one` | `(match_id IS NOT NULL) <> (tie_id IS NOT NULL)` | a prediction is about a match XOR a tie, never both and never neither |

---

### `bolao.classification_predictions`

**Purpose.** A participant's prediction that a named club finishes in a given ZONE at a given POSITION within that zone. br2026's entries[].picks is {g4:[4], sa6:[6], z4:[4]} — fourteen club-zone assertions per entry, 154 live. It cannot go in bolao.predictions: that table's CHECK pred_subject_exactly_one requires a match_id XOR a tie_id, and a zone pick has neither. It is equally NOT classification_snapshots/competition_edition_standings, which model the PROVIDER's observed league table (points, played, wins) — an observation, not a prediction. A queued task proposed exactly that mapping; the schema refutes it.

**Owner:** `app_owner` · **Migration phase:** M17

**Rollback implication.** Dropping loses every zone pick; they are re-derivable from bolao_state[br2026].entries[].picks for as long as legacy is retained.

**RLS intent** — anon: none · authenticated: own entry via view · admin: select via RPC · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Classification prediction ID | `classification_prediction_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Pool entry | `pool_entry_id` | `uuid` | NO | — | — | `bolao.pool_entries.pool_entry_id` | RESTRICT | — | YES |
| Zone | `zone` | `text` | NO | — | — | — | — | — | YES |
| Ordinal | `ordinal` | `integer` | NO | — | — | — | — | — | YES |
| Club name | `club_name` | `text` | NO | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `classification_prediction_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_entry_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `zone` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `ordinal` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `club_name` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `pool_entry_id` | — | — | bolao_state | `entries[].id` | — | — | — | — |
| `zone` | — | — | bolao_state | `entries[].picks{} key` | — | — | ^[a-z][a-z0-9_-]{1,20}$ | The zone slug as the application names it: g4, sa6, z4. Validated by SHAPE, not against a value list — a CHECK enumerating those three would freeze br2026's vocabulary into the schema and refuse the next competition's zones, which is a business rule wearing an integrity constraint's clothes. |
| `ordinal` | — | > 0 | bolao_state | `entries[].picks{}[] array index` | — | — | — | 1-based position WITHIN the zone. LOAD-BEARING, not decorative: bolao/br2026/scripts/audit_scoring.py compares pg4[i] positionally and pays G4_EXACT for the right club in the right position but only G4_GROUP for the right club in the wrong one. Storing these as an unordered set would silently change what every br2026 entry scores. |
| `club_name` | — | — | bolao_state | `entries[].picks{}[] element` | — | — | — | — |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `pool_entry_id, zone, ordinal` | YES | — | one club per position per zone per entry — the natural key, and what makes the backfill idempotent |
| `pool_entry_id` | NO | — | this entry's zone picks — the read the scoring path makes |

---

## Domain: reporting

### `bolao.ranking_snapshots`

**Purpose.** A point-in-time computed standing. The _snapshots suffix is LOAD-BEARING: ranking is derived, and a table named 'rankings' would become a de-facto source of truth within one release.

**Owner:** `app_owner` · **Migration phase:** M10

**Rollback implication.** Fully recomputable. Safe to truncate and rebuild.

**RLS intent** — anon: select via public projection · authenticated: select · admin: full · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Snapshot ID | `ranking_snapshot_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Pool | `pool_id` | `uuid` | NO | — | — | `bolao.pools.pool_id` | CASCADE | — | YES |
| Entry | `pool_entry_id` | `uuid` | NO | — | — | `bolao.pool_entries.pool_entry_id` | CASCADE | — | YES |
| Computed at | `computed_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Position | `position` | `integer` | NO | — | — | — | — | — | YES |
| Points | `points` | `integer` | NO | — | — | — | — | — | YES |
| Scoring rule version | `scoring_rule_version` | `text` | NO | — | — | — | — | — | YES |
| Is provisional | `is_provisional` | `boolean` | NO | `true` | — | — | — | — | YES |
| Published at | `published_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Tiebreak detail | `tiebreak_detail` | `jsonb` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `ranking_snapshot_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `pool_entry_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `computed_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `position` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `points` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `scoring_rule_version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `is_provisional` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `published_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `tiebreak_detail` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `pool_id` | — | — | — | — | — | — | — | CASCADE is justified HERE and nowhere else in the model: a snapshot has no independent value and is fully recomputable. |
| `position` | — | > 0 | — | — | — | — | — | — |
| `scoring_rule_version` | — | — | — | — | — | — | — | Preserves ADR-005. A snapshot without its rule version is uninterpretable. |
| `is_provisional` | — | — | — | — | — | — | — | Preserves ADR-003 and the BR2026 projection language rules. |
| `published_at` | — | — | — | — | — | — | — | KPLUS-F032. NULL means the snapshot is a draft and is visible to no browser principal; a timestamp publishes it. The RLS model has gated anon and authenticated reads on this column since it was written (published_at IS NOT NULL) and the column did not exist, so CREATE POLICY refused it and the entire RLS draft aborted at that statement — every policy and every table privilege after it never ran. The column is added rather than the predicate relaxed: relaxing it would make every computed ranking world-readable the moment it is written, which is a visibility decision the model never took, and it required deleting a mutation-tested security assertion to pass. Distinct from is_provisional, which is a PRESENTATION contract (a provisional standing is shown, labelled as a projection) and not an access-control one. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `pool_id, computed_at` | NO | — | the ranking-history report; also fetches the latest snapshot |
| `pool_entry_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. |

---

## Domain: operations

### `bolao.sync_state`

**Purpose.** Provider synchronisation cursor. Gives espnSync a home — it currently lives inside the state document with nowhere else to go.

**Owner:** `app_owner` · **Migration phase:** M6

**Rollback implication.** Operational; losing it re-runs a sync, which is idempotent by design.

**RLS intent** — anon: none · authenticated: none · admin: select · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Sync state ID | `sync_state_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Provider | `provider` | `text` | NO | — | — | — | — | — | YES |
| Edition | `competition_edition_id` | `uuid` | NO | — | — | `bolao.competition_editions.competition_edition_id` | CASCADE | — | YES |
| Active phase | `active_phase_id` | `uuid` | YES | — | — | `bolao.competition_edition_phases.competition_edition_phase_id` | SET NULL | — | YES |
| Cursor | `cursor` | `jsonb` | NO | `'{}'::jsonb` | — | — | — | — | YES |
| Seed flags | `seed_flags` | `jsonb` | NO | `'{}'::jsonb` | — | — | — | — | YES |
| Last success at | `last_success_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Last error at | `last_error_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Last error category | `last_error_category` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `sync_state_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `competition_edition_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `active_phase_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `cursor` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `seed_flags` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `last_success_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `last_error_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `last_error_category` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `provider` | — | — | — | — | — | — | — | espn | cbf |
| `competition_edition_id` | — | — | — | — | — | — | — | CASCADE justified: a cursor for a deleted edition is meaningless. |
| `active_phase_id` | — | — | bolao_state | `espnSync.activePhaseId` | — | — | — | Explicitly an operator decision that cannot be inferred from provider data. |
| `seed_flags` | — | — | bolao_state | `espnSync.seededKnownConfrontos` | — | — | — | One-shot idempotency latches. |
| `last_success_at` | — | — | — | — | — | — | — | Drives the snapshot-freshness monitor (O-02) and the stale-sync data-quality rule. |
| `last_error_category` | — | — | — | — | — | — | — | CATEGORY only, never a raw provider message — error text can embed data. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `provider, competition_edition_id` | YES | — | one cursor per provider per edition |

---

## Domain: audit

### `audit.audit_chain_head`

**Purpose.** The current tail of the audit hash chain, as a single row. Exists so that appending an event is O(1): without it the trigger has to find the one event nothing points back to, which is a scan of the whole audit log on every insert and makes bulk insertion quadratic (measured — a 200,000-row load did not finish). Locking this row FOR UPDATE also gives the serialisation the chain needs, so concurrent writers are ordered rather than failed. See ADR-K01.

**Owner:** `app_owner` · **Migration phase:** M8

**Rollback implication.** Dropping it disables audit appends entirely; it is rebuildable from audit_events by walking to the open end.

**RLS intent** — anon: none · authenticated: none · admin: none · service: none — maintained only by the audit trigger

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Singleton guard | `singleton` | `boolean` | NO | `true` | **PK** | — | — | — | NO |
| Tail event hash | `event_hash` | `text` | YES | — | — | — | — | — | YES |
| Events appended | `event_count` | `bigint` | NO | `0` | — | — | — | — | YES |
| Updated at | `updated_at` | `timestamptz` | NO | `now()` | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `singleton` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `event_hash` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `event_count` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `updated_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `singleton` | — | — | — | — | — | — | — | Always true. With the CHECK below this makes a second row impossible, so 'the chain head' can never become ambiguous. |
| `event_hash` | — | — | — | — | — | — | — | NULL before the first event exists. Never chosen by a caller. |
| `event_count` | — | — | — | — | — | — | — | Independent count of chain links, so a verifier can detect events removed behind the triggers without walking the whole chain. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `audit_chain_head_singleton` | `singleton` | one chain, one head; a second row would make the tail ambiguous and permit two parallel chains |

---

### `audit.audit_events`

**Purpose.** Append-only, hash-chained record of what a human did. B1-compliant: identifiers, not PII.

**Owner:** `app_owner` · **Migration phase:** M8

**Rollback implication.** APPEND-ONLY. Never dropped, never updated. Rollback of a migration must not delete audit rows.

**RLS intent** — anon: none · authenticated: none · admin: select only · service: insert only

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Audit event ID | `audit_event_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Occurred at | `occurred_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Actor user | `actor_user_id` | `uuid` | YES | — | — | `auth.users.id` | RESTRICT | — | NO |
| Actor role | `actor_role` | `text` | YES | — | — | — | — | — | NO |
| Action | `action` | `text` | NO | — | — | — | — | — | NO |
| Aggregate type | `aggregate_type` | `text` | NO | — | — | — | — | — | NO |
| Aggregate ID | `aggregate_id` | `uuid` | YES | — | — | — | — | — | NO |
| Correlation ID | `correlation_id` | `uuid` | YES | — | — | — | — | — | NO |
| Request ID | `request_id` | `uuid` | YES | — | — | — | — | — | NO |
| Source | `source` | `text` | NO | `'edge_function'` | — | — | — | — | NO |
| Safe metadata | `safe_metadata` | `jsonb` | NO | `'{}'::jsonb` | — | — | — | — | NO |
| Reason | `reason` | `text` | YES | — | — | — | — | — | NO |
| Previous event hash | `previous_event_hash` | `text` | YES | — | — | — | — | — | NO |
| Event hash | `event_hash` | `text` | NO | — | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `audit_event_id` | NONE | NONE | NONE | WITH_PARENT | IMMUTABLE_AFTER_INSERT | INTERNAL | LAST_WRITE_WINS |
| `occurred_at` | NONE | NONE | NONE | WITH_PARENT | IMMUTABLE_AFTER_INSERT | INTERNAL | LAST_WRITE_WINS |
| `actor_user_id` | PSEUDONYMOUS_ID | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `actor_role` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `action` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `aggregate_type` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `aggregate_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `correlation_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `request_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `safe_metadata` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `reason` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `previous_event_hash` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `event_hash` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `actor_user_id` | — | — | — | — | — | — | — | RESTRICT: deleting a user must not orphan the audit trail. ID only — NEVER an email snapshot (that is what B1 prohibits). |
| `action` | — | — | — | — | — | — | ^[a-z_]+\.[a-z_]+$ | aggregate.past_tense, e.g. pool_entry.created |
| `aggregate_id` | — | — | — | — | — | — | — | Polymorphic by design — no FK is possible. A data-quality rule checks resolvability instead. |
| `correlation_id` | — | — | — | — | — | — | — | Groups every event of one logical operation, across audit and outbox. |
| `safe_metadata` | — | — | — | — | — | — | — | IDs, enum values, counts, amounts. MUST NOT contain names, emails, phones, payment references or large payloads (B1). A data-quality rule scans for shapes that look like PII. |
| `event_hash` | — | — | — | — | — | — | — | Computed by a BEFORE INSERT trigger over the NON-PII columns only. Excluding the sidecar is what lets PII be redacted without breaking the chain (G-02). |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `aggregate_type, aggregate_id` | NO | — | 'what happened to this object' — the audit lookup path, currently a full scan in the legacy table |
| `occurred_at` | NO | — | chronological audit reads |
| `previous_event_hash` | YES | `previous_event_hash IS NOT NULL` | KPLUS-F013(b). At most ONE event may follow any given event. This makes a forked hash chain structurally impossible rather than merely unlikely: two concurrent inserts that both read the same tail cannot both commit, because the second violates this index. The chain-building trigger also serialises on an advisory lock, so this is the second of two independent defences — the one that still holds if the first is ever removed. Partial because the genesis event has no predecessor. |
| `event_hash` | YES | — | KPLUS-F013(b). The chain is walked by matching previous_event_hash to event_hash, which is only unambiguous if event_hash identifies exactly one row. Also the lookup path for chain verification. |
| `correlation_id` | NO | `correlation_id IS NOT NULL` | reconstruct one logical operation end to end |
| `actor_user_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 200,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `ae_action_shape` | `action ~ '^[a-z_]+\.[a-z_]+$'` | a free-text action makes the audit log unqueryable |

---

### `audit.audit_event_details`

**Purpose.** Sidecar for genuinely-required sensitive detail. SEPARATE from audit_events and EXCLUDED from the hash chain — that exclusion is what makes erasure and integrity coexist (G-02).

**Owner:** `app_owner` · **Migration phase:** M8

**Rollback implication.** Redactable independently of the chain.

**RLS intent** — anon: none · authenticated: none · admin: select via RPC with reason · service: insert only

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Detail ID | `audit_event_detail_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Audit event | `audit_event_id` | `uuid` | NO | — | — | `audit.audit_events.audit_event_id` | RESTRICT | YES | YES |
| Before snapshot | `before_snapshot` | `jsonb` | YES | — | — | — | — | — | YES |
| After snapshot | `after_snapshot` | `jsonb` | YES | — | — | — | — | — | YES |
| Redacted at | `redacted_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `audit_event_detail_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `audit_event_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `before_snapshot` | SENSITIVE_SNAPSHOT | NONE | AT_REST_PROVIDER | RETAIN_90D_PAYLOAD | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `after_snapshot` | SENSITIVE_SNAPSHOT | NONE | AT_REST_PROVIDER | RETAIN_90D_PAYLOAD | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `redacted_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `redacted_at` | — | — | — | — | — | — | — | Redaction here does NOT break audit_events.event_hash — by design. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `aed_redaction_complete` | `redacted_at IS NULL OR (before_snapshot IS NULL AND after_snapshot IS NULL)` | a redacted detail row must retain no payload |

---

### `audit.migration_lineage`

**Purpose.** Row-level provenance for every application row a backfill creates. The campaign requires that every target row resolve to a SOURCE or an APPROVED_DERIVATION, and that every source element resolve to a target — and until now there was nowhere in the database to record either direction. PRODMIG-Q25 could not have satisfied its own lineage criterion without this.

**Owner:** `app_owner` · **Migration phase:** M14

**Rollback implication.** FULL before any backfill writes lineage. Afterwards this table IS the backout mechanism: a run's rows are identified by migration_run_id, so dropping it would destroy the ability to reverse the backfill it describes.

**RLS intent** — anon: none · authenticated: none · admin: select only · service: insert only — append-only

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Lineage ID | `lineage_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Migration run ID | `migration_run_id` | `uuid` | NO | — | — | — | — | — | NO |
| Transform version | `transform_version` | `text` | NO | — | — | — | — | — | NO |
| Target schema | `target_schema` | `text` | NO | — | — | — | — | — | NO |
| Target relation | `target_relation` | `text` | NO | — | — | — | — | — | NO |
| Target row ID | `target_row_id` | `uuid` | NO | — | — | — | — | — | NO |
| Source product | `source_product` | `text` | NO | — | — | — | — | — | NO |
| Source pool | `source_pool` | `text` | YES | — | — | — | — | — | NO |
| Source relation | `source_relation` | `text` | NO | — | — | — | — | — | NO |
| Source path | `source_path` | `text` | NO | — | — | — | — | — | NO |
| Source fingerprint | `source_fingerprint` | `text` | NO | — | — | — | — | — | NO |
| Disposition | `disposition` | `text` | NO | — | — | — | — | — | NO |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `lineage_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `migration_run_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `transform_version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `target_schema` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `target_relation` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `target_row_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_product` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_pool` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_relation` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_path` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `source_fingerprint` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `disposition` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `migration_run_id` | NO | — | the backout path: every row one run created. Without it, reversing a run scans the whole lineage table. |
| `target_schema, target_relation, target_row_id` | NO | — | TARGET -> SOURCE: 'where did this row come from', the question an auditor asks about one row. |
| `source_product, source_pool, source_relation, source_path` | NO | — | SOURCE -> TARGET: the direction that finds a source element nothing migrated. |
| `migration_run_id, target_schema, target_relation, target_row_id, source_path` | YES | — | the IDEMPOTENCY key. A retry of the same run over the same source path must be a no-op rather than a second lineage row — and idempotency has to be a supported workflow, not a constraint violation somebody catches. |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `ml_disposition_known` | `disposition IN ('MIGRATED','DERIVED_WITH_PROOF','APPROVED_EXCLUSION')` | UNKNOWN is not a disposition a row may carry; an unresolved element blocks its domain instead of being recorded as migrated-ish |
| `ml_source_path_present` | `length(btrim(source_path)) > 0` | lineage that does not say where a row came from is not lineage |
| `ml_fingerprint_present` | `length(btrim(source_fingerprint)) > 0` | a fingerprint is what makes the source claim checkable later |

---

## Domain: outbox

### `bolao.outbox_events`

**Purpose.** Something that must be delivered exactly once — email now, webhooks later. The intent; attempts are a separate table.

**Owner:** `app_owner` · **Migration phase:** M9

**Rollback implication.** Deleting a pending event silently loses a notification. Never cascade.

**RLS intent** — anon: none · authenticated: none · admin: select · service: full

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Outbox event ID | `outbox_event_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Idempotency key | `idempotency_key` | `text` | NO | — | — | — | — | YES | NO |
| Channel | `channel` | `bolao.outbox_channel` | NO | — | — | — | — | — | YES |
| Event type | `event_type` | `text` | NO | — | — | — | — | — | YES |
| Payload | `payload` | `jsonb` | NO | — | — | — | — | — | YES |
| Status | `status` | `bolao.outbox_status` | NO | `'pending'` | — | — | — | — | YES |
| Attempt count | `attempt_count` | `integer` | NO | `0` | — | — | — | — | YES |
| Next attempt at | `next_attempt_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Lease owner | `lease_owner` | `text` | YES | — | — | — | — | — | YES |
| Lease expires at | `lease_expires_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Correlation ID | `correlation_id` | `uuid` | YES | — | — | — | — | — | YES |
| Dead at | `dead_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `outbox_event_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `idempotency_key` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `channel` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `event_type` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payload` | SENSITIVE_SNAPSHOT | NONE | NONE | RETAIN_90D_PAYLOAD | CHANGES_AUDITED | VIA_RPC_ONLY | LAST_WRITE_WINS |
| `status` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `attempt_count` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `next_attempt_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `lease_owner` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `lease_expires_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `correlation_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `dead_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `idempotency_key` | — | — | — | — | — | — | — | MANDATORY, not optional. GitHub Actions gives at-least-once execution with jitter, so a DUPLICATE send is the likely failure — not a lost one. |
| `channel` | — | enum: email | webhook | internal | — | — | — | — | — | — |
| `event_type` | — | — | — | — | — | — | ^[a-z_]+\.[a-z_]+$ | — |
| `payload` | — | — | — | — | — | — | — | Recipient addresses live here. Purge the payload after the retention window while keeping the delivery OUTCOME. |
| `status` | — | enum: pending | in_flight | sent | failed | dead | — | — | — | — | — | — |
| `attempt_count` | — | >= 0 | — | — | — | — | — | — |
| `lease_owner` | — | — | — | — | — | — | — | Concurrency control: one worker leases an event before sending. |
| `lease_expires_at` | — | — | — | — | — | — | — | A crashed worker's lease must expire or the event is stuck forever. |
| `dead_at` | — | — | — | — | — | — | — | Terminal. Any dead event is a lost notification and needs a human (monitor O-10). |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `status, next_attempt_at` | NO | — | the worker's claim query; without it the worker scans the whole table every cycle |
| `idempotency_key` | YES | — | dedupe — the single most important constraint in this domain |
| `correlation_id` | NO | `correlation_id IS NOT NULL` | trace one operation across audit and outbox |
| `status` | NO | `status = 'dead'` | dead-letter queue listing |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `oe_dead_has_timestamp` | `(status = 'dead') = (dead_at IS NOT NULL)` | a dead event must carry terminal evidence |
| `oe_lease_paired` | `(lease_owner IS NULL) = (lease_expires_at IS NULL)` | a lease without an expiry can strand an event forever |

---

### `bolao.outbox_delivery_attempts`

**Purpose.** One row per delivery attempt. Split from the event because a status column cannot explain WHY three attempts failed.

**Owner:** `app_owner` · **Migration phase:** M9

**Rollback implication.** Append-only forensics; retain with the parent.

**RLS intent** — anon: none · authenticated: none · admin: select · service: insert only

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Attempt ID | `outbox_delivery_attempt_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Outbox event | `outbox_event_id` | `uuid` | NO | — | — | `bolao.outbox_events.outbox_event_id` | RESTRICT | — | YES |
| Attempt number | `attempt_number` | `integer` | NO | — | — | — | — | — | YES |
| Started at | `started_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |
| Finished at | `finished_at` | `timestamptz` | YES | — | — | — | — | — | YES |
| Outcome | `outcome` | `bolao.delivery_outcome` | NO | — | — | — | — | — | YES |
| Failure category | `failure_category` | `text` | YES | — | — | — | — | — | YES |
| Provider message ID | `provider_message_id` | `text` | YES | — | — | — | — | — | YES |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `outbox_delivery_attempt_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `outbox_event_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `attempt_number` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `started_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `finished_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `outcome` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `failure_category` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `provider_message_id` | NONE | NONE | NONE | WITH_PARENT | IMMUTABLE_AFTER_INSERT | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `attempt_number` | — | > 0 | — | — | — | — | — | — |
| `outcome` | — | enum: success | transient_failure | permanent_failure | — | — | — | — | — | — |
| `failure_category` | — | — | — | — | — | — | — | CATEGORY, never a raw provider response — provider errors can echo the payload, including recipient addresses. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `outbox_event_id, attempt_number` | YES | — | attempt numbering must be unambiguous; also detects retry-count mismatch |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `oda_finish_after_start` | `finished_at IS NULL OR finished_at >= started_at` | an attempt cannot finish before it starts |

---

## Domain: write_contracts

### `bolao.request_idempotency`

**Purpose.** Exactly-once effect for server-mediated writes. All nine write contracts specify an idempotency lookup and record; until this table existed there was nowhere to put one, so every retry was a possible double-write (KPLUS-F018). The record is written INSIDE the business transaction: before it, a crash marks a request done that never happened; after it, a retry doubles the write.

**Owner:** `app_owner` · **Migration phase:** DDL-M12

**Rollback implication.** FULL while empty. Once it holds money-bearing records, FORWARD_FIX_ONLY: dropping it converts every in-flight retry into a potential double payment.

**RLS intent** — anon: none · authenticated: none · admin: select · service: select + insert only

| Logical | SQL | Type | Null | Default | PK | FK → | ON DELETE | Unique | Mutable |
|---|---|---|---|---|---|---|---|---|---|
| Record ID | `request_idempotency_id` | `uuid` | NO | `gen_random_uuid()` | **PK** | — | — | — | NO |
| Contract | `contract` | `text` | NO | — | — | — | — | — | NO |
| Idempotency key | `idempotency_key` | `text` | NO | — | — | — | — | — | NO |
| Payload fingerprint | `payload_fingerprint` | `text` | NO | — | — | — | — | — | NO |
| Payload version | `payload_version` | `text` | NO | — | — | — | — | — | NO |
| Response | `response` | `jsonb` | NO | — | — | — | — | — | NO |
| Money bearing | `money_bearing` | `boolean` | NO | — | — | — | — | — | NO |
| Request ID | `request_id` | `uuid` | YES | — | — | — | — | — | NO |
| Correlation ID | `correlation_id` | `uuid` | YES | — | — | — | — | — | NO |
| Prunable after | `prunable_after` | `timestamptz` | YES | — | — | — | — | — | NO |
| Created at | `created_at` | `timestamptz` | NO | `now()` | — | — | — | — | NO |

| SQL | PII class | Financial class | Encryption | Retention | Audit | API exposure | Conflict |
|---|---|---|---|---|---|---|---|
| `request_idempotency_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `contract` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `idempotency_key` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payload_fingerprint` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `payload_version` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `response` | NONE | NONE | NONE | WITH_PARENT | IMMUTABLE_AFTER_INSERT | INTERNAL | LAST_WRITE_WINS |
| `money_bearing` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `request_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `correlation_id` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `prunable_after` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |
| `created_at` | NONE | NONE | NONE | WITH_PARENT | CHANGES_AUDITED | INTERNAL | LAST_WRITE_WINS |

| SQL | Generated | Check | Legacy source | Legacy JSON path | Transformation | Backfill rule | Validation | Notes |
|---|---|---|---|---|---|---|---|---|
| `contract` | — | — | — | — | — | — | — | The write contract name. Part of the key, so the same client key in two contracts is two independent requests. |
| `idempotency_key` | — | — | — | — | — | — | — | Client-supplied. One of the few values a client legitimately controls; it names the request, never its effect. |
| `payload_fingerprint` | — | — | — | — | — | — | — | sha256 hex over the canonicalised payload with sorted keys, excluding request_id and correlation_id. Stored, not just compared: telling a retry from a key collision needs the original to compare against. |
| `response` | — | — | — | — | — | — | — | PII class: SENSITIVE_SNAPSHOT. Replayed verbatim on a matching retry; recomputing it could return a different answer than the call being replayed. |
| `money_bearing` | — | — | — | — | — | — | — | Drives retention. A money-bearing record is never automatically deleted, and a pruned one makes a retry REFUSED rather than executed. |
| `prunable_after` | — | — | — | — | — | — | — | NULL means never automatically prunable. A money-bearing record must have NULL here, enforced by ri_money_never_expires. |

**Indexes**

| Columns | Unique | Partial condition | Rationale |
|---|---|---|---|
| `contract, idempotency_key` | YES | — | THE key. Uniqueness lives in the database because check-then-insert races with itself: two concurrent retries both find nothing and both write. |
| `prunable_after` | NO | — | a pruner must find its named set without scanning records it is not allowed to touch |

**Check constraints**

| Name | Expression | Why |
|---|---|---|
| `ri_money_never_expires` | `NOT (money_bearing AND prunable_after IS NOT NULL)` | the choreography forbids automatic deletion of a money-bearing idempotency record; a CHECK makes that something the database will not permit rather than something a pruner has to remember |
| `ri_fingerprint_is_sha256` | `payload_fingerprint ~ '^[0-9a-f]{64}$'` | a truncated or differently-encoded fingerprint would silently compare unequal and turn every retry into a conflict |

---

## Entities added beyond the requested list

**`audit_event_details`** — NOT in the operator's list, but required by ratified decision B1. The hash chain must cover non-PII fields only, otherwise redacting PII for an erasure request breaks audit integrity. Splitting sensitive detail into an unchained sidecar is the mechanism that lets right-to-erasure and tamper-evidence coexist (G-02). Without it, B1 and G-02 are contradictory.
