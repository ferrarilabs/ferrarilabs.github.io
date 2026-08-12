<!-- GENERATED FILE — do not edit by hand. Source: model/migration_phases.json. Regenerate: node scripts/db/validate_migration_phases.mjs --write -->

# MIGRATION_PHASING — phase plan, ordering challenge and rollback per phase

**Workstream K.** Generated from `model/migration_phases.json`; ordering invariants enforced by
`scripts/db/validate_migration_phases.mjs`.

Status: **DESIGN ONLY — no migration has been applied, no ledger row written, no DDL executed anywhere**

## Why the naive ordering is unsafe

The value of this plan is not the phase list — it is these six corrections. Each prevents a specific
concrete failure, and each is enforced by an executable invariant, because a prose ordering argument
does not survive the next person who finds it convenient to reorder.

### OC-1

- **Naive.** audit tables created at phase 9, after the financial backfill
- **Corrected.** audit infrastructure moves to M4, before ANY backfill
- **Why.** the backfill is the largest data movement in the programme. Creating the audit tables after it means that movement is the one operation with no trail. If a backfill mis-attributes a payment, there is then no record of what it did.

### OC-2

- **Naive.** server-mediated writes at phase 14, after dual-read
- **Corrected.** write-through to the relational tables (M11) precedes dual-read comparison (M12)
- **Why.** dual-read compares JSON against relational. If the app is still writing only to the JSON document, the relational copy is stale from the moment the backfill ends, and every comparison reports a difference that is an artefact of the method rather than a defect. You cannot validate parity against a moving target.

### OC-3

- **Naive.** reporting views at phase 11, before backfill and cutover
- **Corrected.** reporting views and matviews move to M15, after cutover
- **Why.** a materialized view built over a partially backfilled table returns confident, wrong numbers. Worse, it caches them. Reporting must never be the first consumer of unvalidated data.

### OC-4

- **Naive.** legacy freeze at phase 16, after cutover
- **Corrected.** a read-only freeze window (M13) precedes final parity validation and cutover (M14)
- **Why.** parity cannot be proven while the source is mutating. Without a freeze the final comparison is against a document that changed between the two reads, so a genuine mismatch and a concurrent write are indistinguishable.

### OC-5

- **Naive.** 'backfill' as one phase
- **Corrected.** backfill is decomposed per entity (M8–M10), ordered by FK dependency, each idempotent, restartable and independently validated
- **Why.** a single backfill phase is a single point of failure with no partial-success state. Halfway through, there is no way to answer 'what is done?' — so the only recovery is to start over, and starting over is only safe if each step was idempotent anyway. Making that explicit costs nothing and removes the all-or-nothing risk.

### OC-6

- **Naive.** identity de-duplication treated as part of the identity migration
- **Corrected.** the identity backfill produces ZERO merges (M5); merging is a separate, operator-driven, post-cutover activity (M17)
- **Why.** a migration that merges identities makes an irreversible money-affecting decision inside an automated batch, at the exact moment nobody is watching individual rows. Every merge requires an operator confirmation (Workstream C), and a migration cannot supply one.

## Phase order

| Phase | Name | Depends on | Risk | Destructive |
|---|---|---|---|---|
| M0 | `baseline_adoption` | — | LOW | no |
| M1 | `schema_and_reference_entities` | M0 | LOW | no |
| M2 | `identity_tables` | M1 | LOW | no |
| M3 | `pool_and_entry_tables` | M2 | LOW | no |
| M4 | `audit_and_outbox_infrastructure` | M3 | LOW | no |
| M5 | `identity_backfill_zero_merges` | M4 | MEDIUM | no |
| M6 | `financial_tables` | M5 | LOW | no |
| M7 | `competition_fact_tables` | M6 | LOW | no |
| M8 | `backfill_entries` | M7 | MEDIUM | no |
| M9 | `backfill_payments_asserted_only` | M8 | HIGH | no |
| M10 | `backfill_results_audit_and_sync` | M9 | MEDIUM | no |
| M11 | `write_through_via_server_mediated_writes` | M10 | HIGH | no |
| M12 | `dual_read_comparison` | M11 | LOW | no |
| M13 | `legacy_freeze_window` | M12 | MEDIUM | no |
| M14 | `cutover` | M13 | HIGH | no |
| M15 | `reporting_layer` | M14 | LOW | no |
| M16 | `legacy_write_removal_and_picks_decomposition` | M15 | HIGH | **yes** |
| M17 | `post_cutover_operator_identity_review` | M16 | MEDIUM | no |

## Ordering invariants (executable)

| Id | Rule | Enforces |
|---|---|---|
| OI-1 | audit_and_outbox_infrastructure must precede every phase whose name starts with backfill_ | OC-1 |
| OI-2 | write_through_via_server_mediated_writes must precede dual_read_comparison | OC-2 |
| OI-3 | reporting_layer must follow cutover | OC-3 |
| OI-4 | legacy_freeze_window must precede cutover | OC-4 |
| OI-5 | at least three distinct backfill_ phases must exist | OC-5 |
| OI-6 | the identity backfill phase must declare zero merges, and no phase before post_cutover_operator_identity_review may perform a merge | OC-6 |
| OI-7 | every destructive phase must have a rollback that is not 'none' | general safety |
| OI-8 | scoring_parity validation must be named by the phase that decomposes picks | Workstream N linkage |

## M0 — `baseline_adoption`

| | |
|---|---|
| Depends on | — |
| Objects introduced | none — records the existing production schema as the migration baseline |
| Data movement | none |
| Backfill | none |
| Compatibility | total; nothing changes |
| Validation | the baseline reference file's digest matches a fresh schema dump; acceptance_checks.mjs EXPECTED_STRUCTURE matches live (7 tables, 3 enums, 1 function, 6 policies, 7 PK, 17 FK, 1 unique index, 8 indexes, 0 user triggers, 7 RLS enabled, 0 forced) |
| Rollback | n/a — no change to roll back |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | none |
| Destructive | no |

**Notes.** BLOCKED on an operator decision about how the baseline is registered in supabase_migrations.schema_migrations. The two candidate migration-repair calls are NOT authorized, and the previously discussed 'Option E' is de-authorized pending a full restatement of its definition and consequences. Everything from M1 onward is designed to be independent of how M0 is finally recorded, so this blocker does not block the design.

## M1 — `schema_and_reference_entities`

| | |
|---|---|
| Depends on | M0 |
| Objects introduced | bolao and audit schemas; competitions, competition_editions, competition_edition_phases; enum types |
| Data movement | none — reference rows are inserted, not moved |
| Backfill | insert the known competitions and editions (Copa do Mundo 2026, Brasileirão 2026, Copa do Brasil 2026) and their phases |
| Compatibility | additive only; the legacy app does not read these tables |
| Validation | phase ordinals contiguous per edition (DQ-CP-01); every edition resolves to a competition |
| Rollback | DROP the new schema; no legacy object touched |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | CREATE TABLE takes no lock on existing objects |
| Destructive | no |

**Notes.** Reference data is small, hand-authored and reviewable. It must NOT be derived from bolao_state, which contains no competition entity at all.

## M2 — `identity_tables`

| | |
|---|---|
| Depends on | M1 |
| Objects introduced | participants, participant_identity_links |
| Data movement | none yet |
| Backfill | none yet — tables only |
| Compatibility | additive |
| Validation | self-reference CHECKs present (canonical_participant_id <> participant_id; surviving <> merged) |
| Rollback | DROP TABLE; nothing references them yet |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | none |
| Destructive | no |

**Notes.** Created before pools and financial because both reference participant_id. Tables first, data later (M5): separating DDL from DML keeps each phase's rollback trivial.

## M3 — `pool_and_entry_tables`

| | |
|---|---|
| Depends on | M2 |
| Objects introduced | pools, pool_fee_schedule, pool_entries |
| Data movement | none yet |
| Backfill | pool rows and one in-force fee schedule row per pool |
| Compatibility | additive |
| Validation | exactly one fee schedule in force per pool (DQ-FN-08); expected_fee_amount is a snapshot column, not a lookup |
| Rollback | DROP TABLE |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | none |
| Destructive | no |

**Notes.** The fee is a property of the pool rule; pool_entries snapshots it at entry time so a later price change cannot retroactively alter an existing entry's settlement.

## M4 — `audit_and_outbox_infrastructure`

| | |
|---|---|
| Depends on | M3 |
| Objects introduced | audit.audit_events, audit.audit_event_details, outbox_events, outbox_delivery_attempts |
| Data movement | none yet |
| Backfill | none |
| Compatibility | additive |
| Validation | audit rows immutable after insert except the redactable sidecar; hash-chain columns present |
| Rollback | DROP TABLE |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | none |
| Destructive | no |

**Notes.** MOVED EARLY (OC-1). Every backfill from M5 onward writes audit events, so the audit tables must exist before the first row moves. Creating them after the backfill would leave the largest data movement in the programme as the only unaudited one.

## M5 — `identity_backfill_zero_merges`

| | |
|---|---|
| Depends on | M4 |
| Objects introduced | none new |
| Data movement | bolao_state.entries[].entryName / participantEmail → participants |
| Backfill | one participant per distinct (normalised email, else normalised name). Idempotent on that key. ZERO merges. |
| Compatibility | additive; legacy app unaffected |
| Validation | PAR-04/PAR-05 (no identity split, no orphan participant); DQ-ID-01 reports duplicate CANDIDATES without acting |
| Rollback | DELETE FROM participants WHERE created_by = 'backfill:M5' — safe because nothing references them yet |
| Application dependency | none |
| Risk | **MEDIUM** |
| Expected lock behaviour | bulk INSERT; row locks only on new rows |
| Destructive | no |

**Notes.** ZERO merges by design (OC-6). Duplicate candidates are recorded for operator review in M17. A migration cannot supply the operator confirmation that Workstream C requires for a merge, and an automated merge here would make an irreversible money-affecting decision at the moment nobody is watching individual rows.

## M6 — `financial_tables`

| | |
|---|---|
| Depends on | M5 |
| Objects introduced | payments, payment_allocations, prize_allocations |
| Data movement | none yet |
| Backfill | none yet |
| Compatibility | additive |
| Validation | no ON DELETE CASCADE on any money-bearing FK; every MONETARY_AMOUNT has a CURRENCY_CODE companion; no currency column has a default |
| Rollback | DROP TABLE |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | none |
| Destructive | no |

**Notes.** No stored settlement column exists, by design. Settlement is derived from payment_allocations; a stored flag would be a second source of truth for money.

## M7 — `competition_fact_tables`

| | |
|---|---|
| Depends on | M6 |
| Objects introduced | matches, ties, match_results, predictions, ranking_snapshots, sync_state |
| Data movement | none yet |
| Backfill | none yet |
| Compatibility | additive |
| Validation | at most one official current result per match (DQ-PR-04); predictions have exactly one subject |
| Rollback | DROP TABLE |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | none |
| Destructive | no |

**Notes.** predictions exists as a table from here, but picks stay in pool_entries.picks jsonb until M16. Decomposing picks changes the scoring input path and is deliberately the very last data change.

## M8 — `backfill_entries`

| | |
|---|---|
| Depends on | M7 |
| Objects introduced | none new |
| Data movement | bolao_state.entries[] → pool_entries (1:1 element→row); deletedIds[] → deleted_at |
| Backfill | idempotent on pool_entry_id (the client uuid is kept as-is, already a stable surrogate); restartable; batched |
| Compatibility | additive |
| Validation | PAR-01/PAR-02/PAR-03 (count, id set, tombstones); PAR-12 (picks byte-identical); PAR-13 (fee explicit) |
| Rollback | DELETE by pool_id — no legacy row touched |
| Application dependency | none |
| Risk | **MEDIUM** |
| Expected lock behaviour | bulk INSERT into a new table; no lock on anything the app reads |
| Destructive | no |

**Notes.** Decomposed per entity (OC-5). expected_fee_amount is passed in explicitly, never inferred: B-08 established entryFee=5 as authoritative for current pools and U1 ratified USD, but a historical pool with an unknown fee stays UNKNOWN.

## M9 — `backfill_payments_asserted_only`

| | |
|---|---|
| Depends on | M8 |
| Objects introduced | none new |
| Data movement | bolao_state.paid{entryId→true} → payments with amount NULL and legacy_asserted |
| Backfill | one asserted payment per paid=true entry; NO payment_allocations rows; idempotent on (asserted_for_pool_entry_id) |
| Compatibility | additive |
| Validation | PAR-06 (one assertion per flag, no invented amount), PAR-07 (no fabricated allocation), PAR-14/PAR-15 (payer attribution and self-payment) |
| Rollback | DELETE WHERE legacy_asserted AND created_by = 'backfill:M9' |
| Application dependency | none |
| Risk | **HIGH** |
| Expected lock behaviour | bulk INSERT |
| Destructive | no |

**Notes.** The highest-risk backfill in the programme, because it is the one that touches money. The legacy `paid` boolean carries no amount, date, method, reference or actor (D-1), so nothing may be invented: settlement for these entries is LEGACY_ASSERTED, an honest fifth state rather than a fabricated number. Third-party payers known only by free-text name stay UNKNOWN-1.

## M10 — `backfill_results_audit_and_sync`

| | |
|---|---|
| Depends on | M9 |
| Objects introduced | none new |
| Data movement | results{} → match_results; auditLog[] → audit.audit_events (PII stripped); lastSync → sync_state |
| Backfill | idempotent on match_id and on (occurred_at, action) respectively; audit hash chain computed in document order |
| Compatibility | additive |
| Validation | PAR-08 (line count), PAR-09 (no free-text detail carried), PAR-10 (order preserved), PAR-11 (result keys), DQ-AU-01/02 |
| Rollback | DELETE by source marker; the audit chain is recomputed rather than patched |
| Application dependency | none |
| Risk | **MEDIUM** |
| Expected lock behaviour | bulk INSERT |
| Destructive | no |

**Notes.** auditLog[].detail is deliberately dropped (B1/ADR-008): carrying free text across would reintroduce exactly the PII the audit model exists to keep out. Ordering must be preserved or the hash chain is meaningless.

## M11 — `write_through_via_server_mediated_writes`

| | |
|---|---|
| Depends on | M10 |
| Objects introduced | Edge Function write endpoints (Workstream S contracts); RLS policies for the service role (Workstream R) |
| Data movement | new writes land in BOTH the legacy jsonb document and the relational tables, in one transaction where possible |
| Backfill | n/a |
| Compatibility | the legacy app keeps working unchanged; new writes are additionally captured relationally |
| Validation | every write contract produces an audit event and an outbox event; idempotency keys enforced |
| Rollback | disable the write-through flag; the legacy document remains authoritative and complete |
| Application dependency | app must call the new endpoints; old clients still writing directly to the document are the reason M12 measures divergence rather than assuming zero |
| Risk | **HIGH** |
| Expected lock behaviour | normal row locks; no DDL |
| Destructive | no |

**Notes.** MOVED BEFORE dual-read (OC-2). Without write-through, the relational copy is stale from the instant M10 finishes, so every dual-read comparison reports method artefacts instead of defects. Dual-WRITE is justified here specifically and only here: it is the only way to hold two representations comparable during a cutover, and it is removed at M16.

## M12 — `dual_read_comparison`

| | |
|---|---|
| Depends on | M11 |
| Objects introduced | none — a comparison job |
| Data movement | none; reads both representations and records differences |
| Backfill | n/a |
| Compatibility | read-only; the legacy document remains authoritative |
| Validation | json_parity.mjs coverage + 15 invariants + round-trip against live pairs; zero UNAUTHORISED differences required for N consecutive runs |
| Rollback | stop the job |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | read-only |
| Destructive | no |

**Notes.** The exit criterion is zero unauthorised differences, not zero differences: paid, deletedIds, auditLog[].detail and siteVersion differ BY DESIGN, each citing the decision authorising it. 'The round trip differs' is not actionable; 'it differs in a way nobody authorised' is.

## M13 — `legacy_freeze_window`

| | |
|---|---|
| Depends on | M12 |
| Objects introduced | none |
| Data movement | none — writes to the legacy document are rejected for the duration |
| Backfill | a final catch-up pass for anything written between the last dual-read run and the freeze |
| Compatibility | the app is read-only for the window; entries cannot be created or edited |
| Validation | post-freeze parity run must show zero unauthorised differences on a static source |
| Rollback | lift the freeze; nothing has changed structurally |
| Application dependency | the UI must show an explicit read-only state, not fail silently |
| Risk | **MEDIUM** |
| Expected lock behaviour | application-level, not database-level; no table lock is taken |
| Destructive | no |

**Notes.** MOVED BEFORE cutover (OC-4). Parity cannot be proven against a mutating source: without the freeze, a genuine mismatch and a concurrent write look identical. The window must be scheduled outside a match/cutoff period — a freeze during a prediction deadline would deny entries and directly affect who can play.

## M14 — `cutover`

| | |
|---|---|
| Depends on | M13 |
| Objects introduced | none new |
| Data movement | authority moves: the relational tables become the source of truth; the legacy document becomes a shadow copy |
| Backfill | n/a |
| Compatibility | the app reads relationally; the document is still written for one release as a rollback path |
| Validation | post-cutover smoke: create an entry, submit a prediction, record a payment, read every report, verify the audit chain |
| Rollback | flip the authority flag back; the document is still current because it is still being written |
| Application dependency | a release that reads relationally must be deployed and confirmed healthy first |
| Risk | **HIGH** |
| Expected lock behaviour | none — a configuration flip, not a DDL change |
| Destructive | no |

**Notes.** The rollback path is what makes this survivable: for one release the legacy document is still maintained, so reverting is a flag flip rather than a restore. That is the entire reason M16 is a separate phase.

## M15 — `reporting_layer`

| | |
|---|---|
| Depends on | M14 |
| Objects introduced | views and materialized views from model/reports.json; the index set from INDEX_STRATEGY.md |
| Data movement | none |
| Backfill | initial matview population |
| Compatibility | additive, read-only |
| Validation | each report returns rows consistent with the equivalent computation in financial.mjs; R-15 must agree exactly with poolReconciliation() |
| Rollback | DROP VIEW / DROP MATERIALIZED VIEW; no base data affected |
| Application dependency | none |
| Risk | **LOW** |
| Expected lock behaviour | CREATE INDEX CONCURRENTLY for every index; a plain CREATE INDEX would block writes for the duration |
| Destructive | no |

**Notes.** MOVED AFTER cutover (OC-3). A matview over a partially backfilled table returns confident, wrong numbers and then caches them. Reporting must never be the first consumer of unvalidated data.

## M16 — `legacy_write_removal_and_picks_decomposition`

| | |
|---|---|
| Depends on | M15 |
| Objects introduced | predictions rows populated from pool_entries.picks |
| Data movement | picks jsonb → predictions rows; legacy document writes stop |
| Backfill | one prediction per (entry, match) from the preserved picks blob; idempotent |
| Compatibility | BREAKING for any client still writing the document; requires the stale-session handling in the zero-downtime strategy |
| Validation | Workstream N scoring parity — every score, rank and tie identical before and after, computed by the app's own scoring logic on both representations |
| Rollback | predictions rows can be dropped; picks jsonb is RETAINED as the fallback until N passes on production-shaped data |
| Application dependency | all clients must be on a release that neither reads nor writes the legacy document |
| Risk | **HIGH** |
| Expected lock behaviour | bulk INSERT into predictions; picks column is not dropped in this phase |
| Destructive | **yes** |

**Notes.** Deliberately last, because it is the only phase that changes the scoring input path. picks is not dropped here — keeping the blob costs storage and removes the need to be right the first time. Dropping it is a later, separate decision once N has passed repeatedly.

## M17 — `post_cutover_operator_identity_review`

| | |
|---|---|
| Depends on | M16 |
| Objects introduced | none new |
| Data movement | operator-confirmed merges only |
| Backfill | none — this is not a batch |
| Compatibility | n/a |
| Validation | every merge carries {operatorId, reason}; DQ-ID-02/03/04/05 clean afterwards; reversibility exercised at least once on a synthetic pair before touching a real one |
| Rollback | reverseMerge per link, restoring prior_state exactly |
| Application dependency | an operator UI for the candidate queue |
| Risk | **MEDIUM** |
| Expected lock behaviour | single-row updates |
| Destructive | no |

**Notes.** Separate from the migration by design (OC-6). Merges move money attribution and require a human decision per pair; a migration cannot supply one. This phase has no completion date — it is ongoing operational work, and treating it as a migration step would create pressure to bulk-approve.
