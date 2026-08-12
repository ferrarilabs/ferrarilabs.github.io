<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: model/target_model.json
     Generator:       scripts/db/generate_model_docs.mjs
     Regenerate:      node scripts/db/generate_model_docs.mjs
     Any hand edit will be overwritten and will fail `--check` in CI.
     Workstream H — target data dictionary -->

# TARGET_DATA_DICTIONARY

Business and technical definition of every target field, with classification, ownership,
source and consumer. Generated from the same model as the attribute grid, so the two
cannot disagree.

Cross-links: ratified decisions A3, B1, E1, E3, U1=USD · ADRs ADR-006, ADR-007, ADR-008, ADR-009, ADR-010

---

| Entity | Field | Business definition | Technical definition | Allowed values | Owner | Classification | Source of truth | Consumers |
|---|---|---|---|---|---|---|---|---|
| `participants` | `participant_id` | Participant ID — Surrogate. Never derived from PII. | `uuid` NOT NULL | any | app_owner | PII:PSEUDONYMOUS_ID · RET:INDEFINITE_REFERENCE | THIS_TABLE | authenticated views, reports |
| `participants` | `display_name` | Display name | `text` NULL | length between 1 and 120 | app_owner | PII:DIRECT_IDENTIFIER · RET:REDACT_IN_PLACE | legacy: bolao_state entries[].entryName | authenticated views, reports |
| `participants` | `email` | Email — Nullable by evidence — many historical entries have none. Uniqueness is partial, never a merge trigger. | `citext` NULL | RFC-shaped or NULL | app_owner | PII:CONTACT · RET:REDACT_IN_PLACE | legacy: bolao_state entries[].participantEmail | RPC only — never a report |
| `participants` | `phone` | Phone — RETAIN ONLY IF A PURPOSE IS CONFIRMED — data minimisation (DATA_GOVERNANCE G-01). Currently no identified use. | `text` NULL | any, or NULL | app_owner | PII:CONTACT · RET:REDACT_IN_PLACE | THIS_TABLE | RPC only — never a report |
| `participants` | `state` | Lifecycle state | `bolao.participant_state` NOT NULL | enum: active \| archived \| redacted | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `canonical_participant_id` | Canonical participant — NULL ⇒ this row IS canonical. Non-NULL ⇒ superseded by a merge; see participant_identity_links. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `version` | Optimistic version | `integer` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `updated_at` | Updated at — Maintained by trigger, not by the application — bolao_state's updated_at was app-maintained and therefore unreliable. | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `created_by` | Created by | `uuid` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `redacted_at` | Redacted at — Erasure-by-redaction (G-02). Row and FKs survive; PII columns are nulled. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participants` | `redaction_reason` | Redaction reason | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `link_id` | Link ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `surviving_participant_id` | Surviving participant — RESTRICT deliberately: deleting a participant that absorbed another would orphan the provenance. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `merged_participant_id` | Merged participant — The row that was superseded. RETAINED, never deleted — that is what makes the merge reversible. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `confidence` | Match confidence | `bolao.match_confidence` NOT NULL | enum: exact_email \| operator_asserted \| probable_name | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `evidence` | Evidence — What the candidate-match workflow found. MUST NOT contain raw email/name — store field NAMES and match kinds, not values (B1). | `jsonb` NOT NULL | any | app_owner | PII:SENSITIVE_SNAPSHOT · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `reason` | Reason | `text` NOT NULL | non-empty; an unexplained merge is not acceptable | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `merged_at` | Merged at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `merged_by` | Merged by — RESTRICT: an unattributable merge is worse than no record. | `uuid` NOT NULL | any | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `reverted_at` | Reverted at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `reverted_by` | Reverted by | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_identity_links` | `revert_reason` | Revert reason | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_auth_links` | `participant_id` | Participant — Composite PK with auth_user_id: identity and participant are DIFFERENT things. One user may own several participants, and a historical participant may have no auth row at all — which is why ownership is a link table and not a column comparison on participants. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_auth_links` | `auth_user_id` | Auth user — RESTRICT, not CASCADE: silently dropping a link would silently revoke a participant's access to their own data. | `uuid` NOT NULL | any | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `participant_auth_links` | `linked_at` | Linked at — When the link was established. Immutable — a re-link is a new row, not an edit. | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competitions` | `competition_id` | Competition ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competitions` | `slug` | Slug — Stable public identifier. The legacy bolao_state row keys are of this shape. | `text` NOT NULL | ^[a-z][a-z0-9_-]{2,40}$ | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `competitions` | `name` | Name | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `competitions` | `sport` | Sport | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competitions` | `kind` | Kind — DESCRIPTIVE ONLY. Rules/scoring are NEVER driven from this column — repo governance forbids generalising tournament logic (DEC-09). | `bolao.competition_kind` NOT NULL | enum: knockout \| league \| group_then_knockout \| lottery | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competitions` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `competition_edition_id` | Edition ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `competition_id` | Competition | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `season_label` | Season label — e.g. '2026'. Text not integer: some competitions span two calendar years ('2026/27'). | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `competition_editions` | `season_start_year` | Season start year — Numeric handle for year-over-year reporting; season_label stays the display form. | `integer` NOT NULL | between 2000 and 2100 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `status` | Status | `bolao.edition_status` NOT NULL | enum: planned \| active \| concluded \| archived | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `starts_on` | Starts on | `date` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `ends_on` | Ends on | `date` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_editions` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_phases` | `competition_edition_phase_id` | Phase ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_phases` | `competition_edition_id` | Edition | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_phases` | `slug` | Phase slug | `text` NOT NULL | ^[a-z][a-z0-9_-]{2,40}$ | app_owner | RET:WITH_PARENT | legacy: bolao_state phases{} key | public projection, reports |
| `competition_edition_phases` | `ordinal` | Ordinal — Phase sequence. Drives the valid-transition check in the data-quality framework. | `integer` NOT NULL | > 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_phases` | `cutoff_at` | Entry cutoff — Deadlines gate money; this is the authoritative copy. CONFIG.cutoffIso becomes a deploy-time default only. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state phases{}.cutoffAt | internal / server only |
| `competition_edition_phases` | `cutoff_offset_ms` | Cutoff offset ms | `bigint` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state phases{}.cutoffOffsetMs | internal / server only |
| `competition_edition_phases` | `topology` | Topology — Bracket topology + provenance. Document-shaped by nature; stays JSONB as a column on a relational row. | `jsonb` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_phases` | `draw_state` | Draw state — Mirrors the existing DRAW_LIFECYCLE derivation. DERIVED in the app today; stored here only as a materialised convenience, never as the source of truth. | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_phases` | `official_draw` | undefined | `jsonb` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `classification_snapshot_id` | Classification snapshot ID | `uuid` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `competition_edition_id` | Competition edition — A classification is meaningless without its edition: position 1 of which season. | `uuid` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `provider` | Provider — Evidence: the snapshot envelope's `provider` field, currently always 'espn'. | `text` NOT NULL | ^[a-z][a-z0-9_-]{1,30}$ | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `provider_competition_ref` | Provider competition ref — Evidence: the envelope's `competitionId`, e.g. 'bra.1'. Kept so a snapshot can be traced back to the exact feed it came from. | `text` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `source_url` | Source URL — Evidence: sync_espn.py's STANDINGS_CONFIG.source_url. | `text` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `schema_version` | Snapshot schema version — Evidence: the envelope's `schemaVersion`. Stored so a shape change is a data fact rather than a silent reinterpretation. | `integer` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `generated_at` | Generated at — Evidence: `generatedAt`. The instant the provider snapshot was produced; this is what orders snapshots. | `timestamptz` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `source_updated_at` | Source updated at — Evidence: `sourceUpdatedAt`. May lag generated_at when the provider served a cached response. | `timestamptz` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `retrieved_at` | Retrieved at | `timestamptz` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `payload_hash` | Payload hash — Evidence: `payloadHash`. NOT unique: the cron re-runs on an unchanged table and an identical payload at a later instant is a legitimate second snapshot. | `text` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `is_stale` | Is stale — Evidence: the envelope's `stale`. A stale snapshot means the fetch failed and the last known good data was reused. It must never be authoritative. | `boolean` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `stale_reason` | Stale reason — Evidence: `staleReason`. Required whenever is_stale, enforced by a CHECK: a snapshot that cannot say why it is stale cannot be triaged. | `text` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `club_count` | Club count — How many standing rows this snapshot carries. Stored so a TRUNCATED import is refusable: the zone boundaries are position slices, so nineteen rows instead of twenty silently moves the relegation zone. | `integer` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `created_by` | Created by — NULL for the sync runtime, set for an operator correction. | `uuid` NULL | any, or NULL | trusted sync runtime | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_snapshots` | `created_at` | Created at | `timestamptz` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `standing_id` | Standing ID | `uuid` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `classification_snapshot_id` | Classification snapshot — The edition is reached through the snapshot and is deliberately NOT repeated here: a copy could disagree with its parent about which season it belongs to. | `uuid` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `position` | Position — The RESOLVED position, 1..club_count, after the app's own deterministic tiebreak. Materialised so no reader re-derives it; the UNIQUE (snapshot, position) index is the 2026-07-14 zone-boundary audit finding made structural. | `integer` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `provider_rank` | Provider rank — The provider's own rank, which CAN TIE — that tie is precisely why `position` exists as a separate resolved value. Kept as evidence of what the provider actually said. | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `club_name` | Club name — The club identity br2026 scoring compares picks against — the provider's displayName. NOT a foreign key: there is no clubs entity, and inventing a global club master for one competition's league table would be a much larger model change than the evidence supports. The app warns on a name absent from its own DATA.teams list rather than rejecting it. | `text` NOT NULL | any | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `club_abbr` | Club abbreviation | `text` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `points` | Points | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `played` | Played | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `wins` | Wins | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `draws` | Draws | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `losses` | Losses | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `goals_for` | Goals for | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `goals_against` | Goals against | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `competition_edition_standings` | `goal_difference` | Goal difference — Provided by the source independently of goals_for/goals_against, so a CHECK asserts the three agree when all are present. A provider that contradicts itself is a CONFLICT the transformer must surface, not silently prefer one field over another. | `integer` NULL | any, or NULL | trusted sync runtime | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `pool_id` | Pool ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `competition_edition_id` | Edition | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `slug` | Slug | `text` NOT NULL | ^[a-z][a-z0-9_-]{2,40}$ | app_owner | RET:WITH_PARENT | legacy: bolao_state row id (text PK) | public projection, reports |
| `pools` | `name` | Name | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `pools` | `status` | Status | `bolao.pool_status` NOT NULL | enum: draft \| open \| closed \| settled \| archived | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `prize_split` | Prize split — AUTHORITATIVE evidence: identical 70/20/10 in all three configs. | `jsonb` NOT NULL | values are exact decimals summing to 1.0 | app_owner | RET:WITH_PARENT | legacy: js/config.js CONFIG.prizes | internal / server only |
| `pools` | `version` | Optimistic version | `integer` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `created_by` | Created by | `uuid` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pools` | `entry_cutoff_at` | undefined | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `pool_fee_schedule_id` | Fee schedule ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `pool_id` | Pool | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `fee_amount` | Fee amount | `numeric(14,2)` NOT NULL | > 0 | app_owner | FIN:MONETARY_AMOUNT · RET:RETAIN_5Y_FINANCIAL | legacy: js/config.js CONFIG.entryFee | internal / server only |
| `pool_fee_schedule` | `currency` | Currency — NO DEFAULT, NOT NULL — deliberate. U1 ratified CURRENT_POOL_CURRENCY=USD, but a defaulted currency would let a future pool silently inherit USD and produce wrong money. Backfill sets 'USD' explicitly per row. | `char(3)` NOT NULL | ^[A-Z]{3}$ (ISO-4217) | app_owner | FIN:CURRENCY_CODE · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `basis` | Basis — Football pools are per_entry; Powerball is per_cota. Modelling this avoids forcing one shape onto both. | `bolao.fee_basis` NOT NULL | enum: per_entry \| per_cota | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `effective_from` | Effective from | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `effective_to` | Effective to — NULL ⇒ currently in force. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `confidence` | Evidence confidence — Carries B-08's evidence classification INTO the data. A fee whose provenance is weak is visible as such rather than laundered into a bare number. | `bolao.evidence_confidence` NOT NULL | enum: authoritative \| probable \| historical \| unknown | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `source` | Source — e.g. 'versioned_config:CONFIG.entryFee'. Provenance of the value. | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_fee_schedule` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `pool_entry_id` | Entry ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].id | internal / server only |
| `pool_entries` | `pool_id` | Pool | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `participant_id` | Participant — NO unique constraint on (participant_id, pool_id) — multiple entries per participant per pool is a RATIFIED requirement. This deliberately supersedes M-3. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `entry_label` | Entry label — MANDATORY. With uniqueness on (participant_id, pool_id) removed, this is the only thing distinguishing an intentional second entry from an accidental duplicate. | `text` NOT NULL | non-empty | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `expected_fee_amount` | Expected fee amount — SNAPSHOT, not a lookup. A 2026 entry keeps its 2026 fee after a 2027 re-price. Deriving from the CURRENT schedule row would silently rewrite history — the single most important modelling decision in the financial domain. | `numeric(14,2)` NOT NULL | > 0 | app_owner | FIN:MONETARY_AMOUNT · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | internal / server only |
| `pool_entries` | `expected_fee_currency` | Expected fee currency — Snapshotted with the amount. NOT NULL, no default — an entry whose currency is unknown cannot be created, forcing the gap into the open. | `char(3)` NOT NULL | ^[A-Z]{3}$ | app_owner | FIN:CURRENCY_CODE · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `pool_fee_schedule_id` | Fee schedule provenance — Which schedule row the snapshot came from. Nullable because legacy entries predate the schedule. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `cotas` | Cotas — Share count for per_cota pools. 1 for per_entry pools. | `numeric(10,4)` NOT NULL | > 0 | app_owner | RET:WITH_PARENT | legacy: lottery_participations cotas | internal / server only |
| `pool_entries` | `state` | State | `bolao.entry_state` NOT NULL | enum: draft \| submitted \| void | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `settlement_status` | Settlement status — NEVER STORED as an authoritative boolean. Derived in bolao_api from allocations vs expected fee. Values: unpaid \| partially_paid \| settled \| overpaid \| legacy_asserted. | `bolao.settlement_status` NOT NULL DERIVED_VIEW | any | app_owner | FIN:DERIVED_MONETARY · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `submitted_at` | Submitted at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `version` | Optimistic version | `integer` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `pool_entries` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].createdAt | internal / server only |
| `pool_entries` | `updated_at` | Updated at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].updatedAt | internal / server only |
| `pool_entries` | `deleted_at` | Deleted at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state deletedIds[] | internal / server only |
| `pool_entries` | `created_by` | Created by | `uuid` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `payment_id` | Payment ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `payer_participant_id` | Payer participant — THIS IS HOW payer ≠ participant IS EXPRESSED. Nullable only for legacy rows where the payer is unrecoverable. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].payerName | internal / server only |
| `payments` | `amount` | Amount — NULLABLE ONLY for legacy_asserted rows migrated from the paid boolean, where no amount ever existed. A NULL amount can never be allocated. | `numeric(14,2)` NULL | any, or NULL | app_owner | FIN:MONETARY_AMOUNT · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | internal / server only |
| `payments` | `currency` | Currency | `char(3)` NULL | ^[A-Z]{3}$ | app_owner | FIN:CURRENCY_CODE · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `kind` | Kind | `bolao.payment_kind` NOT NULL | enum: contribution \| adjustment \| refund \| reversal \| chargeback \| void | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `method` | Method | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].paymentMethod | internal / server only |
| `payments` | `provider` | Provider — zelle \| venmo \| cashapp \| pix \| paypal \| other | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `external_reference` | External reference — Carries forward the ONE genuinely enforced constraint in the current schema. MUST NOT appear in any report or public view — the txId governance rule. | `text` NULL | any, or NULL | app_owner | PII:SENSITIVE_SNAPSHOT · FIN:EXTERNAL_REFERENCE · ENC:AT_REST_PROVIDER · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | RPC only — never a report |
| `payments` | `paid_at` | Paid at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `reverses_payment_id` | Reverses payment — Self-reference. A reversal points at what it reverses; neither row is ever deleted. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `memo` | Memo — Free text — treat as potentially PII-bearing and keep out of reports. | `text` NULL | any, or NULL | app_owner | PII:SENSITIVE_SNAPSHOT · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `proof_object_path` | Proof object path | `text` NULL | any, or NULL | app_owner | PII:SENSITIVE_SNAPSHOT · RET:WITH_PARENT | THIS_TABLE | RPC only — never a report |
| `payments` | `unapplied_amount` | Unapplied amount — amount − SUM(allocations). DERIVED, never stored: a stored balance is a second truth that drifts. See FINANCIAL_MODEL reconciliation equations. | `numeric(14,2)` NOT NULL DERIVED_VIEW | any | app_owner | FIN:DERIVED_MONETARY · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payments` | `created_by` | Created by | `uuid` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `allocation_id` | Allocation ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `payment_id` | Payment | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `pool_entry_id` | Entry | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `allocated_amount` | Allocated amount | `numeric(14,2)` NOT NULL | <> 0 | app_owner | FIN:MONETARY_AMOUNT · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | internal / server only |
| `payment_allocations` | `currency` | Currency — MUST equal the payment's currency AND the entry's expected_fee_currency. Cross-currency allocation is a data-quality violation, not a feature. | `char(3)` NOT NULL | ^[A-Z]{3}$ | app_owner | FIN:CURRENCY_CODE · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `allocated_at` | Allocated at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `allocated_by` | Allocated by | `uuid` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `payment_allocations` | `note` | Note | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `prize_allocation_id` | Prize allocation ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `pool_id` | Pool | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `pool_entry_id` | Entry | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `participant_id` | Participant — Denormalised from the entry for reporting. Kept consistent by a data-quality rule, not by trust. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `rank` | Rank | `integer` NOT NULL | > 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `gross_amount` | Gross amount | `numeric(14,2)` NOT NULL | > 0 | app_owner | FIN:MONETARY_AMOUNT · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | internal / server only |
| `prize_allocations` | `net_amount` | Net amount | `numeric(14,2)` NULL | any, or NULL | app_owner | FIN:MONETARY_AMOUNT · RET:RETAIN_5Y_FINANCIAL | THIS_TABLE | internal / server only |
| `prize_allocations` | `currency` | Currency | `char(3)` NOT NULL | ^[A-Z]{3}$ | app_owner | FIN:CURRENCY_CODE · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `share_of_pool` | Share of pool — e.g. 0.70000. Lets a prize be split across multiple entries on the same rank. | `numeric(6,5)` NULL | > 0 AND <= 1 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `awarded_at` | Awarded at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `paid_out_at` | Paid out at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `prize_allocations` | `payout_external_reference` | Payout reference | `text` NULL | any, or NULL | app_owner | PII:SENSITIVE_SNAPSHOT · FIN:EXTERNAL_REFERENCE · RET:WITH_PARENT | THIS_TABLE | RPC only — never a report |
| `prize_allocations` | `payout_method` | Payout method | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ties` | `tie_id` | Tie ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ties` | `competition_edition_phase_id` | Phase | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ties` | `slug` | Tie slug | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state phases{}.ties{} key | internal / server only |
| `ties` | `team_a` | Team A | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `ties` | `team_b` | Team B | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `ties` | `qualified_side` | Qualified side — Which side advanced. NOT a pairing input — see the draw-provenance invariant: nothing may derive a pairing from qualified teams. | `char(1)` NULL | in ('A','B') | app_owner | RET:WITH_PARENT | legacy: bolao_state phases{}.ties{}.qualifiedTeamId | internal / server only |
| `ties` | `provenance` | Provenance — Official-draw provenance (authority, source, validatedAt, bracketHash). Preserved verbatim from the existing model — it is what makes the bracket auditable. | `jsonb` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ties` | `predecessor_tie_id` | Predecessor tie — Bracket progression QF→SF→Final. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ties` | `locked_at` | undefined | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ties` | `locked_by` | undefined | `text` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `match_id` | Match ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `tie_id` | Tie — NULL for league competitions with no tie structure. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `competition_edition_phase_id` | Phase | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `provider_match_ref` | External match ref — ESPN/CBF identifier. Sync correlation only; never an internal key. | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `leg` | Leg | `integer` NULL | in (1,2) | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `home_team` | Home team | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `matches` | `away_team` | Away team | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | public projection, reports |
| `matches` | `kickoff_at` | Kickoff at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `status` | Status | `bolao.match_status` NOT NULL | enum: scheduled \| live \| finished \| postponed \| cancelled | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `venue` | undefined | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `matches` | `city` | undefined | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `match_result_id` | Match result ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `match_id` | Match | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `goals_home` | Goals home | `integer` NOT NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `goals_away` | Goals away | `integer` NOT NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `penalties_home` | Penalties home | `integer` NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `penalties_away` | Penalties away | `integer` NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `is_official` | Is official — Preserves ADR-003's official-vs-provisional distinction. Provisional results must never be presented as final. | `boolean` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `source` | Source — espn \| cbf \| manual_admin | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `recorded_at` | Recorded at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `match_results` | `superseded_by_id` | Superseded by — Corrections create a NEW row pointing back. The original is retained — a scoring input must never be silently rewritten. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `prediction_id` | Prediction ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `pool_entry_id` | Entry | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `match_id` | Match | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].picks.matches{} | internal / server only |
| `predictions` | `tie_id` | Tie | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].picks.qualified{} | internal / server only |
| `predictions` | `predicted_goals_home` | Predicted goals home | `integer` NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `predicted_goals_away` | Predicted goals away | `integer` NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `predicted_qualified_side` | Predicted qualified side | `char(1)` NULL | in ('A','B') | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `submitted_at` | Submitted at — Compared against the phase cutoff by a data-quality rule — a prediction after lock is a fairness violation. | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `predictions` | `locked` | Locked — Set when the cutoff passes. Once true the row is immutable. | `boolean` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `ranking_snapshot_id` | Snapshot ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `pool_id` | Pool — CASCADE is justified HERE and nowhere else in the model: a snapshot has no independent value and is fully recomputable. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `pool_entry_id` | Entry | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `computed_at` | Computed at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `position` | Position | `integer` NOT NULL | > 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `points` | Points | `integer` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `scoring_rule_version` | Scoring rule version — Preserves ADR-005. A snapshot without its rule version is uninterpretable. | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `is_provisional` | Is provisional — Preserves ADR-003 and the BR2026 projection language rules. | `boolean` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `published_at` | Published at — KPLUS-F032. NULL means the snapshot is a draft and is visible to no browser principal; a timestamp publishes it. The RLS model has gated anon and authenticated reads on this column since it was written (published_at IS NOT NULL) and the column did not exist, so CREATE POLICY refused it and the entire RLS draft aborted at that statement — every policy and every table privilege after it never ran. The column is added rather than the predicate relaxed: relaxing it would make every computed ranking world-readable the moment it is written, which is a visibility decision the model never took, and it required deleting a mutation-tested security assertion to pass. Distinct from is_provisional, which is a PRESENTATION contract (a provisional standing is shown, labelled as a projection) and not an access-control one. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `ranking_snapshots` | `tiebreak_detail` | Tiebreak detail | `jsonb` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `sync_state_id` | Sync state ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `provider` | Provider — espn \| cbf | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `competition_edition_id` | Edition — CASCADE justified: a cursor for a deleted edition is meaningless. | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `active_phase_id` | Active phase — Explicitly an operator decision that cannot be inferred from provider data. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | legacy: bolao_state espnSync.activePhaseId | internal / server only |
| `sync_state` | `cursor` | Cursor | `jsonb` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `seed_flags` | Seed flags — One-shot idempotency latches. | `jsonb` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state espnSync.seededKnownConfrontos | internal / server only |
| `sync_state` | `last_success_at` | Last success at — Drives the snapshot-freshness monitor (O-02) and the stale-sync data-quality rule. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `last_error_at` | Last error at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `sync_state` | `last_error_category` | Last error category — CATEGORY only, never a raw provider message — error text can embed data. | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_chain_head` | `singleton` | Singleton guard — Always true. With the CHECK below this makes a second row impossible, so 'the chain head' can never become ambiguous. | `boolean` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_chain_head` | `event_hash` | Tail event hash — NULL before the first event exists. Never chosen by a caller. | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_chain_head` | `event_count` | Events appended — Independent count of chain links, so a verifier can detect events removed behind the triggers without walking the whole chain. | `bigint` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_chain_head` | `updated_at` | Updated at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `audit_event_id` | Audit event ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `occurred_at` | Occurred at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `actor_user_id` | Actor user — RESTRICT: deleting a user must not orphan the audit trail. ID only — NEVER an email snapshot (that is what B1 prohibits). | `uuid` NULL | any, or NULL | app_owner | PII:PSEUDONYMOUS_ID · RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `actor_role` | Actor role | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `action` | Action — aggregate.past_tense, e.g. pool_entry.created | `text` NOT NULL | ^[a-z_]+\.[a-z_]+$ | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `aggregate_type` | Aggregate type | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `aggregate_id` | Aggregate ID — Polymorphic by design — no FK is possible. A data-quality rule checks resolvability instead. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `correlation_id` | Correlation ID — Groups every event of one logical operation, across audit and outbox. | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `request_id` | Request ID | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `source` | Source | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `safe_metadata` | Safe metadata — IDs, enum values, counts, amounts. MUST NOT contain names, emails, phones, payment references or large payloads (B1). A data-quality rule scans for shapes that look like PII. | `jsonb` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `reason` | Reason | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `previous_event_hash` | Previous event hash | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_events` | `event_hash` | Event hash — Computed by a BEFORE INSERT trigger over the NON-PII columns only. Excluding the sidecar is what lets PII be redacted without breaking the chain (G-02). | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_event_details` | `audit_event_detail_id` | Detail ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_event_details` | `audit_event_id` | Audit event | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_event_details` | `before_snapshot` | Before snapshot | `jsonb` NULL | any, or NULL | app_owner | PII:SENSITIVE_SNAPSHOT · ENC:AT_REST_PROVIDER · RET:RETAIN_90D_PAYLOAD | THIS_TABLE | RPC only — never a report |
| `audit_event_details` | `after_snapshot` | After snapshot | `jsonb` NULL | any, or NULL | app_owner | PII:SENSITIVE_SNAPSHOT · ENC:AT_REST_PROVIDER · RET:RETAIN_90D_PAYLOAD | THIS_TABLE | RPC only — never a report |
| `audit_event_details` | `redacted_at` | Redacted at — Redaction here does NOT break audit_events.event_hash — by design. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `audit_event_details` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `outbox_event_id` | Outbox event ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `idempotency_key` | Idempotency key — MANDATORY, not optional. GitHub Actions gives at-least-once execution with jitter, so a DUPLICATE send is the likely failure — not a lost one. | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `channel` | Channel | `bolao.outbox_channel` NOT NULL | enum: email \| webhook \| internal | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `event_type` | Event type | `text` NOT NULL | ^[a-z_]+\.[a-z_]+$ | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `payload` | Payload — Recipient addresses live here. Purge the payload after the retention window while keeping the delivery OUTCOME. | `jsonb` NOT NULL | any | app_owner | PII:SENSITIVE_SNAPSHOT · RET:RETAIN_90D_PAYLOAD | THIS_TABLE | RPC only — never a report |
| `outbox_events` | `status` | Status | `bolao.outbox_status` NOT NULL | enum: pending \| in_flight \| sent \| failed \| dead | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `attempt_count` | Attempt count | `integer` NOT NULL | >= 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `next_attempt_at` | Next attempt at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `lease_owner` | Lease owner — Concurrency control: one worker leases an event before sending. | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `lease_expires_at` | Lease expires at — A crashed worker's lease must expire or the event is stuck forever. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `correlation_id` | Correlation ID | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `dead_at` | Dead at — Terminal. Any dead event is a lost notification and needs a human (monitor O-10). | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_events` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `outbox_delivery_attempt_id` | Attempt ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `outbox_event_id` | Outbox event | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `attempt_number` | Attempt number | `integer` NOT NULL | > 0 | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `started_at` | Started at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `finished_at` | Finished at | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `outcome` | Outcome | `bolao.delivery_outcome` NOT NULL | enum: success \| transient_failure \| permanent_failure | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `failure_category` | Failure category — CATEGORY, never a raw provider response — provider errors can echo the payload, including recipient addresses. | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `outbox_delivery_attempts` | `provider_message_id` | Provider message ID | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `request_idempotency_id` | Record ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `contract` | Contract — The write contract name. Part of the key, so the same client key in two contracts is two independent requests. | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `idempotency_key` | Idempotency key — Client-supplied. One of the few values a client legitimately controls; it names the request, never its effect. | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `payload_fingerprint` | Payload fingerprint — sha256 hex over the canonicalised payload with sorted keys, excluding request_id and correlation_id. Stored, not just compared: telling a retry from a key collision needs the original to compare against. | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `payload_version` | Payload version | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `response` | Response — PII class: SENSITIVE_SNAPSHOT. Replayed verbatim on a matching retry; recomputing it could return a different answer than the call being replayed. | `jsonb` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `money_bearing` | Money bearing — Drives retention. A money-bearing record is never automatically deleted, and a pruned one makes a retry REFUSED rather than executed. | `boolean` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `request_id` | Request ID | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `correlation_id` | Correlation ID | `uuid` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `prunable_after` | Prunable after — NULL means never automatically prunable. A money-bearing record must have NULL here, enforced by ri_money_never_expires. | `timestamptz` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `request_idempotency` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `lineage_id` | Lineage ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `migration_run_id` | Migration run ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `transform_version` | Transform version | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `target_schema` | Target schema | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `target_relation` | Target relation | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `target_row_id` | Target row ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `source_product` | Source product | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `source_pool` | Source pool | `text` NULL | any, or NULL | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `source_relation` | Source relation | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `source_path` | Source path | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `source_fingerprint` | Source fingerprint | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `disposition` | Disposition | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `migration_lineage` | `created_at` | Created at | `timestamptz` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_predictions` | `classification_prediction_id` | Classification prediction ID | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | THIS_TABLE | internal / server only |
| `classification_predictions` | `pool_entry_id` | Pool entry | `uuid` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].id | internal / server only |
| `classification_predictions` | `zone` | Zone — The zone slug as the application names it: g4, sa6, z4. Validated by SHAPE, not against a value list — a CHECK enumerating those three would freeze br2026's vocabulary into the schema and refuse the next competition's zones, which is a business rule wearing an integrity constraint's clothes. | `text` NOT NULL | ^[a-z][a-z0-9_-]{1,20}$ | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].picks{} key | internal / server only |
| `classification_predictions` | `ordinal` | Ordinal — 1-based position WITHIN the zone. LOAD-BEARING, not decorative: bolao/br2026/scripts/audit_scoring.py compares pg4[i] positionally and pays G4_EXACT for the right club in the right position but only G4_GROUP for the right club in the wrong one. Storing these as an unordered set would silently change what every br2026 entry scores. | `integer` NOT NULL | > 0 | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].picks{}[] array index | internal / server only |
| `classification_predictions` | `club_name` | Club name | `text` NOT NULL | any | app_owner | RET:WITH_PARENT | legacy: bolao_state entries[].picks{}[] element | internal / server only |
