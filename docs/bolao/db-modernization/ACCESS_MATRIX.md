<!-- GENERATED FILE — do not edit by hand. Source: model/rls_model.json. Regenerate: node scripts/db/rls.mjs --write -->

# ACCESS_MATRIX — target row-level access, all entities × all commands × all principals

**Workstream 12.** Derived from `model/rls_model.json` — 28 entities × 4 commands × 5 principals = 560 cells.
A hand-maintained table of that size is a table that disagrees with the policies, so this one is generated.

Legend: **A** ALLOW · **R** TRUSTED_RUNTIME_ONLY · **F** FUTURE_OPERATOR_IDENTITY · **—** NOT_APPLICABLE · **·** DENY

Status: **REVIEW DRAFT.** No policy exists in any database as a result of this document.

| Entity | SELECT<br>an/au/rt/op/mig | INSERT<br>an/au/rt/op/mig | UPDATE<br>an/au/rt/op/mig | DELETE<br>an/au/rt/op/mig |
|---|---|---|---|---|
| `audit_chain_head` | · · R F — | · · · F — | · · R F — | · · · F — |
| `audit_event_details` | · · R F — | · · R F — | · · R F — | · · · F — |
| `audit_events` | · · R F — | · · R F — | · · · F — | · · · F — |
| `classification_predictions` | · A R F — | · · R F — | · · R F — | · · · F — |
| `classification_snapshots` | A A R F — | · · R F — | · · · F — | · · · F — |
| `competition_edition_phases` | A A R F — | · · R F — | · · R F — | · · · F — |
| `competition_edition_standings` | A A R F — | · · R F — | · · · F — | · · · F — |
| `competition_editions` | A A R F — | · · R F — | · · R F — | · · · F — |
| `competitions` | A A R F — | · · R F — | · · R F — | · · · F — |
| `match_results` | A A R F — | · · R F — | · · R F — | · · · F — |
| `matches` | A A R F — | · · R F — | · · R F — | · · · F — |
| `migration_lineage` | · · R F — | · · R F — | · · · F — | · · · F — |
| `outbox_delivery_attempts` | · · R F — | · · R F — | · · · F — | · · · F — |
| `outbox_events` | · · R F — | · · R F — | · · R F — | · · · F — |
| `participant_auth_links` | · A R F — | · · R F — | · · R F — | · · · F — |
| `participant_identity_links` | · · R F — | · · R F — | · · R F — | · · · F — |
| `participants` | · A R F — | · · R F — | · · R F — | · · · F — |
| `payment_allocations` | · · R F — | · · R F — | · · R F — | · · · F — |
| `payments` | · · R F — | · · R F — | · · R F — | · · · F — |
| `pool_entries` | · A R F — | · · R F — | · · R F — | · · · F — |
| `pool_fee_schedule` | A A R F — | · · R F — | · · R F — | · · · F — |
| `pools` | A A R F — | · · R F — | · · R F — | · · · F — |
| `predictions` | · A R F — | · · R F — | · · R F — | · · · F — |
| `prize_allocations` | · · R F — | · · R F — | · · R F — | · · · F — |
| `ranking_snapshots` | A A R F — | · · R F — | · · · F — | · · · F — |
| `request_idempotency` | · · R F — | · · R F — | · · · F — | · · · F — |
| `sync_state` | · · R F — | · · R F — | · · R F — | · · · F — |
| `ties` | A A R F — | · · R F — | · · R F — | · · · F — |
