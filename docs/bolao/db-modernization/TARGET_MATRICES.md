<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: model/target_model.json
     Generator:       scripts/db/generate_model_docs.mjs
     Regenerate:      node scripts/db/generate_model_docs.mjs
     Any hand edit will be overwritten and will fail `--check` in CI.
     Workstreams B / R / V — constraint, PII, RLS and index matrices -->

# TARGET_MATRICES — constraints, PII, RLS intent and indexes

---

## 1. Constraint matrix

| Entity | PK | FKs | Unique | Checks | Cascades | Preservation posture |
|---|---|---|---|---|---|---|
| `participants` | `participant_id` | 2 | 1 | 3 | 0 | **preserve** (no cascade) |
| `participant_identity_links` | `link_id` | 4 | 1 | 3 | 0 | **preserve** (no cascade) |
| `participant_auth_links` | `participant_id, auth_user_id` | 2 | 0 | 0 | 0 | **preserve** (no cascade) |
| `competitions` | `competition_id` | 0 | 1 | 0 | 0 | **preserve** (no cascade) |
| `competition_editions` | `competition_edition_id` | 1 | 1 | 1 | 0 | **preserve** (no cascade) |
| `competition_edition_phases` | `competition_edition_phase_id` | 1 | 2 | 0 | 0 | **preserve** (no cascade) |
| `classification_snapshots` | `classification_snapshot_id` | 2 | 1 | 2 | 0 | **preserve** (no cascade) |
| `competition_edition_standings` | `standing_id` | 1 | 2 | 3 | 0 | **preserve** (no cascade) |
| `pools` | `pool_id` | 2 | 1 | 0 | 0 | **preserve** (no cascade) |
| `pool_fee_schedule` | `pool_fee_schedule_id` | 1 | 1 | 1 | 0 | **preserve** (no cascade) |
| `pool_entries` | `pool_entry_id` | 4 | 1 | 1 | 0 | **preserve** (no cascade) |
| `payments` | `payment_id` | 3 | 1 | 3 | 0 | **preserve** (no cascade) |
| `payment_allocations` | `allocation_id` | 3 | 1 | 0 | 0 | **preserve** (no cascade) |
| `prize_allocations` | `prize_allocation_id` | 3 | 1 | 1 | 0 | **preserve** (no cascade) |
| `ties` | `tie_id` | 2 | 1 | 2 | 0 | **preserve** (no cascade) |
| `matches` | `match_id` | 2 | 1 | 1 | 0 | **preserve** (no cascade) |
| `match_results` | `match_result_id` | 2 | 1 | 2 | 0 | **preserve** (no cascade) |
| `predictions` | `prediction_id` | 3 | 2 | 1 | 0 | **preserve** (no cascade) |
| `ranking_snapshots` | `ranking_snapshot_id` | 2 | 0 | 0 | 2 | cascade on pool_id, pool_entry_id |
| `sync_state` | `sync_state_id` | 2 | 1 | 0 | 1 | cascade on competition_edition_id |
| `audit_chain_head` | `singleton` | 0 | 0 | 1 | 0 | **preserve** (no cascade) |
| `audit_events` | `audit_event_id` | 1 | 2 | 1 | 0 | **preserve** (no cascade) |
| `audit_event_details` | `audit_event_detail_id` | 1 | 1 | 1 | 0 | **preserve** (no cascade) |
| `outbox_events` | `outbox_event_id` | 0 | 2 | 2 | 0 | **preserve** (no cascade) |
| `outbox_delivery_attempts` | `outbox_delivery_attempt_id` | 1 | 1 | 1 | 0 | **preserve** (no cascade) |
| `request_idempotency` | `request_idempotency_id` | 0 | 1 | 2 | 0 | **preserve** (no cascade) |
| `migration_lineage` | `lineage_id` | 0 | 1 | 3 | 0 | **preserve** (no cascade) |
| `classification_predictions` | `classification_prediction_id` | 1 | 1 | 0 | 0 | **preserve** (no cascade) |

### Every cascade, challenged

| Entity.column | ON DELETE | Justification |
|---|---|---|
| `ranking_snapshots.pool_id` | CASCADE | CASCADE is justified HERE and nowhere else in the model: a snapshot has no independent value and is fully recomputable. |
| `ranking_snapshots.pool_entry_id` | CASCADE | **UNJUSTIFIED — review** |
| `sync_state.competition_edition_id` | CASCADE | CASCADE justified: a cursor for a deleted edition is meaningless. |

Everything else is `RESTRICT` or `SET NULL`. For money-bearing records preservation beats
cascade: a deleted allocation silently changes settlement, and a deleted payment destroys
financial history. Cascade appears only where the child is fully recomputable.

## 2. PII matrix

| Entity | Column | PII class | Encryption | Retention | API exposure |
|---|---|---|---|---|---|
| `participants` | `participant_id` | **PSEUDONYMOUS_ID** | NONE | INDEFINITE_REFERENCE | VIA_VIEW |
| `participants` | `display_name` | **DIRECT_IDENTIFIER** | NONE | REDACT_IN_PLACE | VIA_VIEW |
| `participants` | `email` | **CONTACT** | NONE | REDACT_IN_PLACE | VIA_RPC_ONLY |
| `participants` | `phone` | **CONTACT** | NONE | REDACT_IN_PLACE | VIA_RPC_ONLY |
| `participants` | `created_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `participant_identity_links` | `evidence` | **SENSITIVE_SNAPSHOT** | NONE | WITH_PARENT | INTERNAL |
| `participant_identity_links` | `merged_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `participant_auth_links` | `auth_user_id` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `classification_snapshots` | `created_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `pools` | `created_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `pool_entries` | `created_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `payments` | `external_reference` | **SENSITIVE_SNAPSHOT** | AT_REST_PROVIDER | RETAIN_5Y_FINANCIAL | VIA_RPC_ONLY |
| `payments` | `memo` | **SENSITIVE_SNAPSHOT** | NONE | WITH_PARENT | INTERNAL |
| `payments` | `proof_object_path` | **SENSITIVE_SNAPSHOT** | NONE | WITH_PARENT | VIA_RPC_ONLY |
| `payments` | `created_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `payment_allocations` | `allocated_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `prize_allocations` | `payout_external_reference` | **SENSITIVE_SNAPSHOT** | NONE | WITH_PARENT | VIA_RPC_ONLY |
| `ties` | `locked_by` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `audit_events` | `actor_user_id` | **PSEUDONYMOUS_ID** | NONE | WITH_PARENT | INTERNAL |
| `audit_event_details` | `before_snapshot` | **SENSITIVE_SNAPSHOT** | AT_REST_PROVIDER | RETAIN_90D_PAYLOAD | VIA_RPC_ONLY |
| `audit_event_details` | `after_snapshot` | **SENSITIVE_SNAPSHOT** | AT_REST_PROVIDER | RETAIN_90D_PAYLOAD | VIA_RPC_ONLY |
| `outbox_events` | `payload` | **SENSITIVE_SNAPSHOT** | NONE | RETAIN_90D_PAYLOAD | VIA_RPC_ONLY |

**22 classified PII columns.** Direct identifiers and contact data appear in
`participants` **only** — that is the point of the participant-master model: PII stored once,
referenced by FK everywhere else.

## 3. RLS intent matrix

| Entity | anon | authenticated | admin/operator | service runtime |
|---|---|---|---|---|
| `bolao.participants` | none | own row via view | select/insert/update via RPC | full |
| `bolao.participant_identity_links` | none | none | select; insert/update via RPC only | full |
| `bolao.participant_auth_links` | none | none | select | full |
| `bolao.competitions` | select via public projection | select | full via RPC | full |
| `bolao.competition_editions` | select via public projection | select | full via RPC | full |
| `bolao.competition_edition_phases` | select via public projection | select | full via RPC | full |
| `bolao.classification_snapshots` | select via public projection — a league table is public information already published by the provider | select | full via RPC | full |
| `bolao.competition_edition_standings` | select via public projection — the league table is public information | select | full via RPC | full |
| `bolao.pools` | select via public projection | select | full via RPC | full |
| `bolao.pool_fee_schedule` | none | select via view | full via RPC | full |
| `bolao.pool_entries` | none (public ranking reads a projection instead) | own entries via view | full via RPC | full |
| `bolao.payments` | none | none | select; write via RPC only | full |
| `bolao.payment_allocations` | none | none | select; write via RPC only | full |
| `bolao.prize_allocations` | none | own via view | select; write via RPC | full |
| `bolao.ties` | select via public projection | select | full via RPC | full |
| `bolao.matches` | select via public projection | select | full via RPC | full |
| `bolao.match_results` | select via public projection | select | write via RPC | full |
| `bolao.predictions` | none before cutoff; projection after | own via view | select; write via RPC | full |
| `bolao.ranking_snapshots` | select via public projection | select | full | full |
| `bolao.sync_state` | none | none | select | full |
| `audit.audit_chain_head` | none | none | none | none — maintained only by the audit trigger |
| `audit.audit_events` | none | none | select only | insert only |
| `audit.audit_event_details` | none | none | select via RPC with reason | insert only |
| `bolao.outbox_events` | none | none | select | full |
| `bolao.outbox_delivery_attempts` | none | none | select | insert only |
| `bolao.request_idempotency` | none | none | select | select + insert only |
| `audit.migration_lineage` | none | none | select only | insert only — append-only |
| `bolao.classification_predictions` | none | own entry via view | select via RPC | full |

**No entity grants `anon` any write.** Critical financial and admin writes are server-mediated
(ratified E3), and base tables live outside the PostgREST-exposed schema (ratified E1).

## 4. Index recommendations

| Entity | Columns | Unique | Partial | Rationale | Write cost |
|---|---|---|---|---|---|
| `participants` | `email` | YES | `email IS NOT NULL AND redacted_at IS NULL` | dedup candidate lookup; partial because email is nullable and redacted rows must not block reuse | insert/update must check uniqueness |
| `participants` | `canonical_participant_id` | NO | — | resolve a superseded identity to its canonical row; unindexed FK would full-scan | one extra write per insert/update |
| `participants` | `lower(display_name)` | NO | — | candidate-match workflow searches by name; expression index avoids a scan | one extra write per insert/update |
| `participants` | `created_by` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 15,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. | one extra write per insert/update |
| `participant_identity_links` | `merged_participant_id` | YES | `reverted_at IS NULL` | a participant may be actively merged into at most ONE survivor; partial so a reverted merge frees it for re-merge | insert/update must check uniqueness |
| `participant_identity_links` | `surviving_participant_id` | NO | — | list everything absorbed by a canonical participant | one extra write per insert/update |
| `competition_editions` | `competition_id, season_start_year` | YES | — | one edition per competition per season; also the year-over-year join key | insert/update must check uniqueness |
| `competition_edition_phases` | `competition_edition_id, slug` | YES | — | one phase per slug per edition | insert/update must check uniqueness |
| `competition_edition_phases` | `competition_edition_id, ordinal` | YES | — | phase order must be unambiguous for transition validation | insert/update must check uniqueness |
| `classification_snapshots` | `competition_edition_id, generated_at` | NO | — | the authoritative-snapshot lookup: the latest classification for this edition. The single hottest access path, read once per scoring run. | one extra write per insert/update |
| `classification_snapshots` | `competition_edition_id, provider, generated_at` | YES | — | one snapshot per provider per instant per edition. Two rows claiming the same instant would make 'the latest' ambiguous. | insert/update must check uniqueness |
| `competition_edition_standings` | `classification_snapshot_id, position` | YES | — | two clubs cannot occupy the same position in one snapshot. This is the 2026-07-14 zone-boundary audit finding enforced by the database: an unresolved provider rank tie now fails the import instead of moving a relegation boundary. | insert/update must check uniqueness |
| `competition_edition_standings` | `classification_snapshot_id, club_name` | YES | — | a club cannot occupy two positions in one snapshot | insert/update must check uniqueness |
| `competition_edition_standings` | `classification_snapshot_id, position, club_name` | NO | — | the scoring read: fetch a snapshot's table in position order and slice the zones. Covering, so the zone slice needs no heap access. | one extra write per insert/update |
| `pools` | `slug` | YES | — | stable public identifier | insert/update must check uniqueness |
| `pool_fee_schedule` | `pool_id, effective_from` | NO | — | resolve the fee in force at a point in time | one extra write per insert/update |
| `pool_fee_schedule` | `pool_id` | YES | `effective_to IS NULL` | at most ONE currently-in-force fee per pool — prevents two live prices | insert/update must check uniqueness |
| `pool_entries` | `participant_id, pool_id, entry_label` | YES | — | multiple entries per pool are allowed, but two entries with the SAME label are an accident, not an intent | insert/update must check uniqueness |
| `pool_entries` | `pool_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. This is also the read behind every ranking screen: workload W1 sequentially scanned all 20,000 entries without it. | one extra write per insert/update |
| `pool_entries` | `pool_fee_schedule_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. | one extra write per insert/update |
| `payments` | `external_reference` | YES | `external_reference IS NOT NULL` | makes double-recording a payment reference impossible; observed firing 11/11 on inserts in production | insert/update must check uniqueness |
| `payments` | `payer_participant_id` | NO | — | 'everything this person paid' — the payment-history report | one extra write per insert/update |
| `payments` | `reverses_payment_id` | NO | `reverses_payment_id IS NOT NULL` | find the reversal of a payment without scanning | one extra write per insert/update |
| `payment_allocations` | `pool_entry_id` | NO | — | sum allocations per entry — the settlement derivation; the single most important index in the financial domain | one extra write per insert/update |
| `payment_allocations` | `payment_id, pool_entry_id` | YES | — | one allocation row per (payment, entry) pair; adjust by amending the row, not by adding a second | insert/update must check uniqueness |
| `prize_allocations` | `participant_id` | NO | — | 'everything this person won' — the winnings report | one extra write per insert/update |
| `prize_allocations` | `pool_entry_id` | NO | — | prize per entry | one extra write per insert/update |
| `prize_allocations` | `pool_id, rank, pool_entry_id` | YES | — | an entry cannot be awarded the same rank twice, while a rank may still be split across entries | insert/update must check uniqueness |
| `ties` | `competition_edition_phase_id, slug` | YES | — | one tie per slug per phase | insert/update must check uniqueness |
| `ties` | `predecessor_tie_id` | NO | `predecessor_tie_id IS NOT NULL` | walk the bracket forward | one extra write per insert/update |
| `matches` | `tie_id` | NO | `tie_id IS NOT NULL` | 'matches in this tie' — aggregate computation | one extra write per insert/update |
| `matches` | `competition_edition_phase_id` | NO | — | phase listing | one extra write per insert/update |
| `matches` | `provider_match_ref` | YES | `provider_match_ref IS NOT NULL` | idempotent provider sync — prevents double-ingesting one fixture | insert/update must check uniqueness |
| `matches` | `kickoff_at` | NO | — | 'matches today' for the result-email cron | one extra write per insert/update |
| `match_results` | `match_id` | YES | `superseded_by_id IS NULL AND is_official` | at most ONE official current result per match; partial so superseded corrections coexist | insert/update must check uniqueness |
| `match_results` | `match_id` | NO | — | result history for a match | one extra write per insert/update |
| `predictions` | `pool_entry_id` | NO | — | all predictions for an entry — the scoring read path | one extra write per insert/update |
| `predictions` | `match_id` | NO | `match_id IS NOT NULL` | score a match across all entries | one extra write per insert/update |
| `predictions` | `pool_entry_id, match_id` | YES | `match_id IS NOT NULL` | one prediction per entry per match | insert/update must check uniqueness |
| `predictions` | `pool_entry_id, tie_id` | YES | `tie_id IS NOT NULL` | one qualification pick per entry per tie | insert/update must check uniqueness |
| `ranking_snapshots` | `pool_id, computed_at` | NO | — | the ranking-history report; also fetches the latest snapshot | one extra write per insert/update |
| `ranking_snapshots` | `pool_entry_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. | one extra write per insert/update |
| `sync_state` | `provider, competition_edition_id` | YES | — | one cursor per provider per edition | insert/update must check uniqueness |
| `audit_events` | `aggregate_type, aggregate_id` | NO | — | 'what happened to this object' — the audit lookup path, currently a full scan in the legacy table | one extra write per insert/update |
| `audit_events` | `occurred_at` | NO | — | chronological audit reads | one extra write per insert/update |
| `audit_events` | `previous_event_hash` | YES | `previous_event_hash IS NOT NULL` | KPLUS-F013(b). At most ONE event may follow any given event. This makes a forked hash chain structurally impossible rather than merely unlikely: two concurrent inserts that both read the same tail cannot both commit, because the second violates this index. The chain-building trigger also serialises on an advisory lock, so this is the second of two independent defences — the one that still holds if the first is ever removed. Partial because the genesis event has no predecessor. | insert/update must check uniqueness |
| `audit_events` | `event_hash` | YES | — | KPLUS-F013(b). The chain is walked by matching previous_event_hash to event_hash, which is only unambiguous if event_hash identifies exactly one row. Also the lookup path for chain verification. | insert/update must check uniqueness |
| `audit_events` | `correlation_id` | NO | `correlation_id IS NOT NULL` | reconstruct one logical operation end to end | one extra write per insert/update |
| `audit_events` | `actor_user_id` | NO | — | KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 200,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. | one extra write per insert/update |
| `outbox_events` | `status, next_attempt_at` | NO | — | the worker's claim query; without it the worker scans the whole table every cycle | one extra write per insert/update |
| `outbox_events` | `idempotency_key` | YES | — | dedupe — the single most important constraint in this domain | insert/update must check uniqueness |
| `outbox_events` | `correlation_id` | NO | `correlation_id IS NOT NULL` | trace one operation across audit and outbox | one extra write per insert/update |
| `outbox_events` | `status` | NO | `status = 'dead'` | dead-letter queue listing | one extra write per insert/update |
| `outbox_delivery_attempts` | `outbox_event_id, attempt_number` | YES | — | attempt numbering must be unambiguous; also detects retry-count mismatch | insert/update must check uniqueness |
| `request_idempotency` | `contract, idempotency_key` | YES | — | THE key. Uniqueness lives in the database because check-then-insert races with itself: two concurrent retries both find nothing and both write. | insert/update must check uniqueness |
| `request_idempotency` | `prunable_after` | NO | — | a pruner must find its named set without scanning records it is not allowed to touch | one extra write per insert/update |
| `migration_lineage` | `migration_run_id` | NO | — | the backout path: every row one run created. Without it, reversing a run scans the whole lineage table. | one extra write per insert/update |
| `migration_lineage` | `target_schema, target_relation, target_row_id` | NO | — | TARGET -> SOURCE: 'where did this row come from', the question an auditor asks about one row. | one extra write per insert/update |
| `migration_lineage` | `source_product, source_pool, source_relation, source_path` | NO | — | SOURCE -> TARGET: the direction that finds a source element nothing migrated. | one extra write per insert/update |
| `migration_lineage` | `migration_run_id, target_schema, target_relation, target_row_id, source_path` | YES | — | the IDEMPOTENCY key. A retry of the same run over the same source path must be a no-op rather than a second lineage row — and idempotency has to be a supported workflow, not a constraint violation somebody catches. | insert/update must check uniqueness |
| `classification_predictions` | `pool_entry_id, zone, ordinal` | YES | — | one club per position per zone per entry — the natural key, and what makes the backfill idempotent | insert/update must check uniqueness |
| `classification_predictions` | `pool_entry_id` | NO | — | this entry's zone picks — the read the scoring path makes | one extra write per insert/update |

**62 indexes across 28 entities.** Every one carries a rationale — the
validator rejects an index without one, because an unjustified index is write cost with no owner.

### Redundancy pre-check

- ⚠ match_results:match_id
- ⚠ migration_lineage: (migration_run_id) is a prefix of unique (migration_run_id,target_schema,target_relation,target_row_id,source_path)
- ⚠ classification_predictions: (pool_entry_id) is a prefix of unique (pool_entry_id,zone,ordinal)
