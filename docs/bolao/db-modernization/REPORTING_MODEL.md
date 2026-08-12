<!-- GENERATED FILE — do not edit by hand. Source: model/reports.json + model/target_model.json. Regenerate: node scripts/db/reports_and_indexes.mjs --write -->

# REPORTING_MODEL — read model for every platform report

**Workstream G.** Generated from `model/reports.json`. Validated by
`scripts/db/reports_and_indexes.mjs`.

Status: **DESIGN ONLY.** No view, materialized view or index exists anywhere as a result of this document.

17 reports.

## Summary

| Id | Report | Grain | PII | RLS roles | Materialization | Refresh |
|---|---|---|---|---|---|---|
| R-01 | `participant_history` | one row per (participant, pool_entry) per currency | CONTACT | operator | QUERY | n/a |
| R-02 | `pool_participation` | one row per pool_entry per currency | CONTACT | operator | VIEW | n/a |
| R-03 | `competition_history` | one row per (competition_edition, pool) per currency | NONE | operator | VIEW | n/a |
| R-04 | `multiple_entries` | one row per (participant, pool) with entry_count > 1 | CONTACT | operator | QUERY | n/a |
| R-05 | `payment_history` | one row per payment | FINANCIAL | operator | QUERY | n/a |
| R-06 | `payment_allocations` | one row per payment_allocation | FINANCIAL | operator | QUERY | n/a |
| R-07 | `unpaid_balances` | one row per pool_entry with settlement = UNPAID | CONTACT | operator | VIEW | n/a |
| R-08 | `partial_balances` | one row per pool_entry with settlement = PARTIALLY_PAID | CONTACT | operator | VIEW | n/a |
| R-09 | `overpayments` | one row per pool_entry with settlement = OVERPAID, plus one row per payment with unapplied > 0 | FINANCIAL | operator | VIEW | n/a |
| R-10 | `prizes_and_winnings` | one row per prize_allocation | FINANCIAL | operator | VIEW | n/a |
| R-11 | `participant_net_position` | one row per participant per currency | FINANCIAL | operator | QUERY | n/a |
| R-12 | `competition_performance` | one row per (pool_entry, competition_edition) | PSEUDONYMOUS | operator | MATVIEW | on result recorded, and on demand; never on a timer alone — a stale leaderboard after a result is a visible incorrectness |
| R-13 | `ranking_history` | one row per (pool, computed_at, position) | PSEUDONYMOUS | operator | VIEW | n/a |
| R-14 | `year_over_year_participation` | one row per (competition, season_label) | NONE | operator | MATVIEW | nightly; a day-stale participation trend has no decision attached to it |
| R-15 | `pool_financial_reconciliation` | one row per (pool, currency) | FINANCIAL | operator | VIEW | n/a |
| R-16 | `audit_history` | one row per audit_event | PSEUDONYMOUS | operator | QUERY | n/a |
| R-17 | `operational_health` | one row per (sync_state) plus one row per outbox status bucket | NONE | operator, service | QUERY | n/a |

## Cross-cutting rules

- **Settlement is always derived** from `payment_allocations`. No report may read a stored settlement value; the validator rejects it.
- **Canonical identity must be resolved before filtering by participant.** A merged participant's history otherwise appears empty (R-01), and returning-participant counts silently overstate growth (R-14).
- **`LEGACY_ASSERTED` entries are shown beside money, never inside it.** They have no recoverable amount, so any total that folds them in is wrong (R-07, R-15).
- **Per-currency grain** on every money aggregate. Summing across currencies is the error the financial engine refuses (R-11, R-15).
- **Published snapshots are never re-pointed** after an identity merge; R-13 shows history as published.

## R-01 — `participant_history`

**Question.** Everything this participant has ever done on the platform.

**Grain.** one row per (participant, pool_entry) per currency

| | |
|---|---|
| Dimensions | `participant_id`, `display_name`, `competition_id`, `competition_edition_id`, `pool_id`, `entry_label`, `created_at`, `currency` |
| Measures | `entry_count`, `total_expected_fee`, `total_allocated`, `total_won` |
| Joins | participants → pool_entries → pools → competition_editions → competitions · LEFT JOIN payment_allocations · LEFT JOIN prize_allocations |
| Filters | `participant_id = :id` · `canonical identity resolved first (a superseded id must return the surviving identity's history)` |
| PII exposure | **CONTACT** |
| RLS roles | **operator** |
| RLS notes | operator; a participant-facing variant must be a separate projection restricted to their own canonical id |
| Indexes | `pool_entries(participant_id, pool_id)`, `prize_allocations(participant_id)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** MUST resolve canonical identity before filtering, or a merged participant's history appears empty. This is the most likely reporting bug in the whole set. Grain includes currency: a money aggregate without it would sum across currencies, which the financial engine refuses as wrong rather than approximate.

## R-02 — `pool_participation`

**Question.** Who is in this pool, and what is each entry's standing?

**Grain.** one row per pool_entry per currency

| | |
|---|---|
| Dimensions | `pool_id`, `pool_entry_id`, `participant_id`, `display_name`, `entry_label`, `created_at`, `deleted_at`, `currency` |
| Measures | `expected_fee`, `allocated`, `settlement_status_derived` |
| Joins | pools → pool_entries → participants · LEFT JOIN payment_allocations |
| Filters | `pool_id = :id` · `deleted_at IS NULL unless :include_withdrawn` |
| PII exposure | **CONTACT** |
| RLS roles | **operator** |
| RLS notes | operator; public variant exposes display_name only, never email |
| Indexes | `pool_entries(pool_id, deleted_at)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** Soft-deleted entries must be excluded by default — a withdrawn entry appearing in a pool list has previously been reported as a live bug class. Grain includes currency because expected_fee and allocated are money.

## R-03 — `competition_history`

**Question.** Every edition of a competition and its pools.

**Grain.** one row per (competition_edition, pool) per currency

| | |
|---|---|
| Dimensions | `competition_id`, `competition_edition_id`, `season_label`, `pool_id`, `status`, `currency` |
| Measures | `entry_count`, `distinct_participant_count`, `collected_total`, `prizes_awarded_total` |
| Joins | competitions → competition_editions → pools → pool_entries |
| Filters | `competition_id = :id` |
| PII exposure | **NONE** |
| RLS roles | **operator** |
| RLS notes | operator; safe to expose as an aggregate public projection |
| Indexes | `competition_editions(competition_id)`, `pools(competition_edition_id)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** distinct_participant_count must count CANONICAL participants, otherwise a pre-merge duplicate inflates the headline number. Grain includes currency: a money aggregate without it would sum across currencies, which the financial engine refuses as wrong rather than approximate.

## R-04 — `multiple_entries`

**Question.** Which participants hold more than one entry in the same pool?

**Grain.** one row per (participant, pool) with entry_count > 1

| | |
|---|---|
| Dimensions | `pool_id`, `participant_id`, `display_name` |
| Measures | `entry_count`, `labels` |
| Joins | pool_entries → participants |
| Filters | `deleted_at IS NULL` · `HAVING count(*) > 1` |
| PII exposure | **CONTACT** |
| RLS roles | **operator** |
| RLS notes | operator |
| Indexes | `pool_entries(participant_id, pool_id)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** Multiple entries are LEGITIMATE (this is why there is no unique constraint on (participant, pool) — see the M-3 supersession). This report is for review, not for enforcement. Rule DQ-ST-04 catches the accidental case: same label.

## R-05 — `payment_history`

**Question.** Every payment recorded, by whom, how, and when.

**Grain.** one row per payment

| | |
|---|---|
| Dimensions | `payment_id`, `payer_participant_id`, `payer_display_name`, `method`, `kind`, `received_at`, `currency` |
| Measures | `amount`, `allocated_total`, `unapplied_balance_derived` |
| Joins | payments → participants (payer) · LEFT JOIN payment_allocations |
| Filters | `received_at BETWEEN :from AND :to` · `kind = :kind` |
| PII exposure | **FINANCIAL** |
| RLS roles | **operator** |
| RLS notes | operator ONLY — never exposed to anon or authenticated |
| Indexes | `payments(payer_participant_id)`, `payments(paid_at)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** external_reference must NOT appear in any shared export. Legacy rows have amount IS NULL (LEGACY_ASSERTED); the report must render that as 'asserted, amount unknown', never as 0 — rendering it as 0 would understate cash collected.

## R-06 — `payment_allocations`

**Question.** How was each payment split across entries?

**Grain.** one row per payment_allocation

| | |
|---|---|
| Dimensions | `allocation_id`, `payment_id`, `pool_entry_id`, `pool_id`, `participant_id`, `currency`, `allocated_at` |
| Measures | `allocated_amount` |
| Joins | payment_allocations → payments · payment_allocations → pool_entries → participants |
| Filters | `payment_id = :id OR pool_entry_id = :id` |
| PII exposure | **FINANCIAL** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `payment_allocations(payment_id)`, `payment_allocations(pool_entry_id)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** This report is the audit trail for one payment funding several entries. Currency must match payment and entry (DQ-FN-05); a mismatch is a data defect, not a display issue.

## R-07 — `unpaid_balances`

**Question.** Which entries have received nothing?

**Grain.** one row per pool_entry with settlement = UNPAID

| | |
|---|---|
| Dimensions | `pool_id`, `pool_entry_id`, `participant_id`, `display_name`, `email`, `currency` |
| Measures | `expected_fee`, `outstanding` |
| Joins | pool_entries → participants · LEFT JOIN payment_allocations |
| Filters | `derived settlement = 'unpaid'` · `deleted_at IS NULL` |
| PII exposure | **CONTACT** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `payment_allocations(pool_entry_id)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** LEGACY_ASSERTED entries must be EXCLUDED from this report and reported separately (R-07b concern). Chasing a participant who paid years ago for a payment nobody recorded is a real-world harm this report can cause.

## R-08 — `partial_balances`

**Question.** Which entries are partially funded?

**Grain.** one row per pool_entry with settlement = PARTIALLY_PAID

| | |
|---|---|
| Dimensions | `pool_id`, `pool_entry_id`, `participant_id`, `display_name`, `currency` |
| Measures | `expected_fee`, `allocated`, `shortfall` |
| Joins | pool_entries → participants → payment_allocations |
| Filters | `derived settlement = 'partially_paid'` |
| PII exposure | **CONTACT** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `payment_allocations(pool_entry_id)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** shortfall = expected - allocated, exact decimal. Never computed in the client.

## R-09 — `overpayments`

**Question.** Which entries received more than their fee, and which payments have an unapplied balance?

**Grain.** one row per pool_entry with settlement = OVERPAID, plus one row per payment with unapplied > 0

| | |
|---|---|
| Dimensions | `pool_entry_id`, `payment_id`, `participant_id`, `display_name`, `currency` |
| Measures | `expected_fee`, `allocated`, `excess`, `unapplied_balance` |
| Joins | pool_entries → payment_allocations → payments |
| Filters | `derived settlement = 'overpaid' OR unapplied_balance > 0` |
| PII exposure | **FINANCIAL** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `payment_allocations(pool_entry_id)`, `payment_allocations(payment_id)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** OVERPAID is a reportable state, not an error — there is deliberately no cap of allocation against expected fee. An unapplied balance is money held and owed: this report is how it stops being forgotten.

## R-10 — `prizes_and_winnings`

**Question.** Who won what, in which pool, under which rule version?

**Grain.** one row per prize_allocation

| | |
|---|---|
| Dimensions | `pool_id`, `prize_allocation_id`, `pool_entry_id`, `participant_id`, `display_name`, `rank_position`, `scoring_rule_version`, `declared_at`, `currency` |
| Measures | `gross_amount`, `paid_amount`, `outstanding_prize` |
| Joins | prize_allocations → pool_entries → participants · prize_allocations → pools |
| Filters | `pool_id = :id` |
| PII exposure | **FINANCIAL** |
| RLS roles | **operator** |
| RLS notes | operator; a public projection may show display_name + rank + gross, never payment state |
| Indexes | `prize_allocations(pool_id)`, `prize_allocations(participant_id)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** prize_allocations.participant_id is denormalised for this report; DQ-FN-10 asserts it agrees with the entry, or winnings get attributed to the wrong person.

## R-11 — `participant_net_position`

**Question.** Across everything, is this participant up or down?

**Grain.** one row per participant per currency

| | |
|---|---|
| Dimensions | `participant_id`, `display_name`, `currency` |
| Measures | `paid_as_payer`, `won_as_participant`, `net` |
| Joins | participants → payments (as payer) · participants → prize_allocations |
| Filters | `participant_id = :id` · `canonical identity resolved` |
| PII exposure | **FINANCIAL** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `payments(payer_participant_id)`, `prize_allocations(participant_id)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** Grain is PER CURRENCY, deliberately: summing across currencies is the cross-currency error the financial engine refuses. A single 'net' number across currencies would be meaningless even when USD is the only value present.

## R-12 — `competition_performance`

**Question.** How did each entry score in a competition edition?

**Grain.** one row per (pool_entry, competition_edition)

| | |
|---|---|
| Dimensions | `competition_edition_id`, `pool_id`, `pool_entry_id`, `participant_id`, `display_name`, `scoring_rule_version` |
| Measures | `total_points`, `exact_scores`, `correct_advancements`, `bonus_points`, `final_position` |
| Joins | pool_entries → predictions → matches → match_results |
| Filters | `competition_edition_id = :id` |
| PII exposure | **PSEUDONYMOUS** |
| RLS roles | **operator** |
| RLS notes | operator; public projection is the published ranking only |
| Indexes | `predictions(pool_entry_id)`, `match_results(match_id)` |
| Materialization | **MATVIEW** |
| Refresh | on result recorded, and on demand; never on a timer alone — a stale leaderboard after a result is a visible incorrectness |

**Notes.** Scoring is computed by the app's own scoring logic, NOT reimplemented in SQL. Workstream N exists to guarantee no migration changes any of these numbers. A SQL reimplementation would be a second source of truth for money.

## R-13 — `ranking_history`

**Question.** How did the leaderboard change over time?

**Grain.** one row per (pool, computed_at, position)

| | |
|---|---|
| Dimensions | `pool_id`, `computed_at`, `position`, `pool_entry_id`, `participant_id`, `display_name`, `scoring_rule_version` |
| Measures | `total_points`, `position_delta_vs_previous_snapshot` |
| Joins | ranking_snapshots → pool_entries → participants |
| Filters | `pool_id = :id` · `computed_at BETWEEN :from AND :to` |
| PII exposure | **PSEUDONYMOUS** |
| RLS roles | **operator** |
| RLS notes | operator; published snapshots are public |
| Indexes | `ranking_snapshots(pool_id, computed_at)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** position_delta must be computed against a STABLE BASELINE snapshot, not merely the previous row — the BR2026 rule that club movement and participant movement are distinct concepts applies here. Snapshots are never re-pointed after an identity merge (see IDENTITY_MODEL §6): this report shows history as published.

## R-14 — `year_over_year_participation`

**Question.** Is participation growing, and who returns?

**Grain.** one row per (competition, season_label)

| | |
|---|---|
| Dimensions | `competition_id`, `season_label` |
| Measures | `distinct_participants`, `returning_participants`, `new_participants`, `churned_participants`, `entries_total` |
| Joins | competitions → competition_editions → pools → pool_entries → participants |
| Filters | `competition_id = :id` |
| PII exposure | **NONE** |
| RLS roles | **operator** |
| RLS notes | operator; aggregate-only public projection is safe |
| Indexes | `pool_entries(pool_id, deleted_at)`, `pools(competition_edition_id)` |
| Materialization | **MATVIEW** |
| Refresh | nightly; a day-stale participation trend has no decision attached to it |

**Notes.** 'Returning' is meaningless without canonical identity resolution — an unmerged duplicate reads as a NEW participant every season, which would systematically overstate growth and understate retention. This report is the strongest business argument for Workstream C.

## R-15 — `pool_financial_reconciliation`

**Question.** For this pool: expected, collected, outstanding, awarded, net.

**Grain.** one row per (pool, currency)

| | |
|---|---|
| Dimensions | `pool_id`, `currency` |
| Measures | `expected_total`, `collected_total`, `outstanding_total`, `prizes_awarded_total`, `net_cash_position`, `legacy_asserted_entry_count` |
| Joins | pools → pool_entries → payment_allocations · pools → prize_allocations |
| Filters | `pool_id = :id` |
| PII exposure | **FINANCIAL** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `payment_allocations(pool_entry_id)`, `prize_allocations(pool_id)` |
| Materialization | **VIEW** |
| Refresh | n/a |

**Notes.** Mirrors poolReconciliation() in financial.mjs exactly; if the two ever disagree, that is a finding. legacy_asserted_entry_count is shown BESIDE the money, never folded into it: those entries have no recoverable amount, so any total that silently includes them is wrong.

## R-16 — `audit_history`

**Question.** What happened, when, by whom, and does the chain verify?

**Grain.** one row per audit_event

| | |
|---|---|
| Dimensions | `audit_event_id`, `occurred_at`, `actor_role`, `actor_id`, `action`, `aggregate_type`, `aggregate_id`, `correlation_id`, `request_id`, `source` |
| Measures | `chain_verified` |
| Joins | audit_events → audit_event_details (optional, redactable sidecar) |
| Filters | `occurred_at BETWEEN :from AND :to` · `aggregate_type = :t AND aggregate_id = :id` · `correlation_id = :cid` |
| PII exposure | **PSEUDONYMOUS** |
| RLS roles | **operator** |
| RLS notes | operator only |
| Indexes | `audit_events(occurred_at)`, `audit_events(aggregate_type, aggregate_id)`, `audit_events(correlation_id)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** safe_metadata carries no names, emails, phones or payment references (B1/ADR-008, enforced by DQ-AU-01). chain_verified comes from recomputing the hash chain (DQ-AU-02): an audit log that advertises tamper evidence and cannot verify is worse than none.

## R-17 — `operational_health`

**Question.** Is the provider snapshot fresh, and is the outbox delivering?

**Grain.** one row per (sync_state) plus one row per outbox status bucket

| | |
|---|---|
| Dimensions | `sync_state_id`, `competition_edition_id`, `provider`, `status`, `last_success_at`, `outbox_status` |
| Measures | `staleness_seconds`, `pending_count`, `failed_count`, `dead_count`, `oldest_pending_age_seconds`, `p95_attempts_to_success` |
| Joins | sync_state · outbox_events → outbox_delivery_attempts |
| Filters | `staleness_seconds > :threshold` · `outbox_status IN ('pending','failed','dead')` |
| PII exposure | **NONE** |
| RLS roles | **operator, service** |
| RLS notes | operator; safe as a service-role health endpoint |
| Indexes | `outbox_events(status, next_attempt_at)`, `sync_state(last_success_at)` |
| Materialization | **QUERY** |
| Refresh | n/a |

**Notes.** This is the report that turns the platform's worst failure mode — a silently stale provider snapshot, which produces NO signal at all — into something observable. dead_count > 0 means a notification was lost and needs triage, so it must alert rather than merely display.
