<!-- GENERATED FILE — do not edit by hand. Source: model/reports.json + model/target_model.json. Regenerate: node scripts/db/reports_and_indexes.mjs --write -->

# INDEX_STRATEGY — indexes derived from actual report workloads

**Workstream V.** Generated from `model/reports.json` + `model/target_model.json`.

Status: **PROPOSAL ONLY. No index has been created in production.**

Every index below traces to a named report workload. An index no report justifies has no owner:
write amplification is paid on every INSERT for a read nobody performs. That traceability is the
reason this document is generated from the report model rather than written beside it.

## Proposals

| Table | Columns | Unique | Partial | Write cost | Workloads |
|---|---|---|---|---|---|
| `audit_events` | `aggregate_type, aggregate_id` | no | — | MODERATE — hot table, composite | R-16 audit_history |
| `audit_events` | `correlation_id` | no | — | LOW-MODERATE — hot table, narrow | R-16 audit_history |
| `audit_events` | `occurred_at` | no | — | LOW-MODERATE — hot table, narrow | R-16 audit_history |
| `competition_editions` | `competition_id` | no | — | LOW — cold table, narrow | R-03 competition_history |
| `match_results` | `match_id` | no | — | LOW — cold table, narrow | R-12 competition_performance |
| `outbox_events` | `status, next_attempt_at` | no | — | MODERATE — hot table, composite | R-17 operational_health |
| `payment_allocations` | `payment_id` | no | — | LOW-MODERATE — hot table, narrow | R-06 payment_allocations<br>R-09 overpayments |
| `payment_allocations` | `pool_entry_id` | no | — | LOW-MODERATE — hot table, narrow | R-06 payment_allocations<br>R-07 unpaid_balances<br>R-08 partial_balances<br>R-09 overpayments<br>R-15 pool_financial_reconciliation |
| `payments` | `paid_at` | no | — | LOW — cold table, narrow | R-05 payment_history |
| `payments` | `payer_participant_id` | no | — | LOW — cold table, narrow | R-05 payment_history<br>R-11 participant_net_position |
| `pool_entries` | `participant_id, pool_id` | no | — | LOW — cold table, composite | R-01 participant_history<br>R-04 multiple_entries |
| `pool_entries` | `pool_id, deleted_at` | no | — | LOW — cold table, composite | R-02 pool_participation<br>R-14 year_over_year_participation |
| `pools` | `competition_edition_id` | no | — | LOW — cold table, narrow | R-03 competition_history<br>R-14 year_over_year_participation |
| `predictions` | `pool_entry_id` | no | — | LOW-MODERATE — hot table, narrow | R-12 competition_performance |
| `prize_allocations` | `participant_id` | no | — | LOW — cold table, narrow | R-01 participant_history<br>R-10 prizes_and_winnings<br>R-11 participant_net_position |
| `prize_allocations` | `pool_id` | no | — | LOW — cold table, narrow | R-10 prizes_and_winnings<br>R-15 pool_financial_reconciliation |
| `ranking_snapshots` | `pool_id, computed_at` | no | — | LOW — cold table, composite | R-13 ranking_history |
| `sync_state` | `last_success_at` | no | — | LOW — cold table, narrow | R-17 operational_health |

### Ordering guidance

- `audit_events(aggregate_type, aggregate_id)` — leading column is the equality predicate; trailing column is the range/sort key
- `outbox_events(status, next_attempt_at)` — leading column is the equality predicate; trailing column is the range/sort key
- `pool_entries(participant_id, pool_id)` — leading column is the equality predicate; trailing column is the range/sort key
- `pool_entries(pool_id, deleted_at)` — leading column is the equality predicate; trailing column is the range/sort key
- `ranking_snapshots(pool_id, computed_at)` — leading column is the equality predicate; trailing column is the range/sort key

## Redundancy findings

None. No proposed index is a left prefix of another on the same table.

## Drift against `model/target_model.json`

Drift is reported in **both** directions deliberately. An index in the model that no report needs is
unowned write cost; a report that needs an index the model does not declare will be slow the day it ships.

**Proposed by reports, absent from the model (4):**

- `competition_editions(competition_id)`
- `pool_entries(participant_id, pool_id)`
- `pool_entries(pool_id, deleted_at)`
- `sync_state(last_success_at)`

**Declared in the model, not required by any report (36):**

- `participants(email)`
- `participants(canonical_participant_id)`
- `participants(lower(display_name))`
- `participant_identity_links(merged_participant_id)`
- `participant_identity_links(surviving_participant_id)`
- `competition_editions(competition_id, season_start_year)`
- `competition_edition_phases(competition_edition_id, slug)`
- `competition_edition_phases(competition_edition_id, ordinal)`
- `pools(slug)`
- `pool_fee_schedule(pool_id, effective_from)`
- `pool_fee_schedule(pool_id)`
- `pool_entries(pool_id)`
- `pool_entries(participant_id)`
- `pool_entries(participant_id, pool_id, entry_label)`
- `payments(external_reference)`
- `payments(reverses_payment_id)`
- `payment_allocations(payment_id, pool_entry_id)`
- `prize_allocations(pool_entry_id)`
- `prize_allocations(pool_id, rank, pool_entry_id)`
- `ties(competition_edition_phase_id, slug)`
- `ties(predecessor_tie_id)`
- `matches(tie_id)`
- `matches(competition_edition_phase_id)`
- `matches(provider_match_ref)`
- `matches(kickoff_at)`
- `predictions(match_id)`
- `predictions(pool_entry_id, match_id)`
- `predictions(pool_entry_id, tie_id)`
- `ranking_snapshots(pool_id, computed_at, position)`
- `sync_state(provider, competition_edition_id)`
- `audit_events(actor_user_id)`
- `outbox_events(idempotency_key)`
- `outbox_events(correlation_id)`
- `outbox_events(status)`
- `outbox_delivery_attempts(outbox_event_id, attempt_number)`
- `outbox_delivery_attempts(outbox_event_id)`

These lists are **informational, not errors**: a model index may legitimately exist to support a
constraint, a foreign-key lookup, or a write path rather than a report. What matters is that no entry on
either list is a surprise. Each one should be either justified or removed before Workstream K applies any
index-creating migration.
