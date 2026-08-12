<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source of truth: model/target_model.json
     Generator:       scripts/db/generate_model_docs.mjs
     Regenerate:      node scripts/db/generate_model_docs.mjs
     Any hand edit will be overwritten and will fail `--check` in CI.
     Workstream J — target ERD and migration dependency order -->

# TARGET_ERD — logical model, financial flow, and dependency ordering

Generated from the model, so the diagram cannot drift from the attribute grid.

---

## 1. Logical ERD — full target model

```mermaid
erDiagram
    participants ||--o{ participant_identity_links : "surviving_participant_id"
    participants ||--o{ participant_identity_links : "merged_participant_id"
    participants ||--o{ participant_auth_links : "participant_id"
    competitions ||--o{ competition_editions : "competition_id"
    competition_editions ||--o{ competition_edition_phases : "competition_edition_id"
    competition_editions ||--o{ classification_snapshots : "competition_edition_id"
    classification_snapshots ||--o{ competition_edition_standings : "classification_snapshot_id"
    competition_editions ||--o{ pools : "competition_edition_id"
    pools ||--o{ pool_fee_schedule : "pool_id"
    pools ||--o{ pool_entries : "pool_id"
    participants ||--o{ pool_entries : "participant_id"
    pool_fee_schedule |o--o{ pool_entries : "pool_fee_schedule_id"
    participants |o--o{ payments : "payer_participant_id"
    payments ||--o{ payment_allocations : "payment_id"
    pool_entries ||--o{ payment_allocations : "pool_entry_id"
    pools ||--o{ prize_allocations : "pool_id"
    pool_entries ||--o{ prize_allocations : "pool_entry_id"
    participants ||--o{ prize_allocations : "participant_id"
    competition_edition_phases ||--o{ ties : "competition_edition_phase_id"
    ties |o--o{ matches : "tie_id"
    competition_edition_phases ||--o{ matches : "competition_edition_phase_id"
    matches ||--o{ match_results : "match_id"
    pool_entries ||--o{ predictions : "pool_entry_id"
    matches |o--o{ predictions : "match_id"
    ties |o--o{ predictions : "tie_id"
    pools ||--o{ ranking_snapshots : "pool_id"
    pool_entries ||--o{ ranking_snapshots : "pool_entry_id"
    competition_editions ||--o{ sync_state : "competition_edition_id"
    competition_edition_phases |o--o{ sync_state : "active_phase_id"
    audit_events ||--o{ audit_event_details : "audit_event_id"
    outbox_events ||--o{ outbox_delivery_attempts : "outbox_event_id"
    pool_entries ||--o{ classification_predictions : "pool_entry_id"
```

## 2. Self-references and identity graph

```mermaid
graph LR
    participants -->|"canonical_participant_id"| participants
    payments -->|"reverses_payment_id"| payments
    ties -->|"predecessor_tie_id"| ties
    match_results -->|"superseded_by_id"| match_results
    participants -->|superseded by merge| participant_identity_links
    participant_identity_links -->|reversible| participants
```

## 3. Financial flow — inbound and outbound kept separate

```mermaid
graph LR
    payer["participants (payer)"] -->|makes| P[payments]
    P -->|allocated via| A[payment_allocations]
    A -->|funds| E[pool_entries]
    F[pool_fee_schedule] -->|snapshotted onto| E
    E -.->|DERIVED settlement| S(["unpaid / partially_paid / settled / overpaid"])
    P -.->|DERIVED| U([unapplied_amount])
    POOL[pools] -->|awards| Z[prize_allocations]
    Z -->|to| E
    classDef out fill:#5a4a1a,color:#fff
    class Z out
```

Inbound (`payments` → `payment_allocations`) and outbound (`prize_allocations`) never share a
table. Conflating them is the classic accounting modelling error that makes reconciliation
ambiguous.

## 4. Competition hierarchy

```mermaid
graph TD
    C[competitions] --> CE[competition_editions]
    CE --> CEP[competition_edition_phases]
    CE --> POOL[pools]
    CEP --> T[ties]
    CEP --> M[matches]
    T --> M
    M --> MR[match_results]
    POOL --> PE[pool_entries]
    PE --> PR[predictions]
    M --> PR
    T --> PR
    POOL --> RS[ranking_snapshots]
```

## 5. Outbox and audit flow

```mermaid
graph LR
    RPC["Edge Function RPC"] -->|writes| DB[(base tables)]
    RPC -->|appends| AE[audit_events]
    AE -.->|sensitive detail, unchained| AED[audit_event_details]
    RPC -->|enqueues| OE[outbox_events]
    OE -->|leased by| W[worker]
    W -->|one row per try| ODA[outbox_delivery_attempts]
    W -.->|external| PROV[email / webhook provider]
    OE -.->|terminal| DEAD([dead — needs a human])
```

`audit_event_details` is deliberately OUTSIDE the hash chain: that is what lets PII be
redacted for an erasure request without breaking audit integrity (G-02).

## 6. Migration dependency order (topological)

Creation order that satisfies every FK. Derived from the model, not hand-sequenced.

| # | Entity | Phase | Depends on |
|---|---|---|---|
| 1 | `participants` | M2 | — |
| 2 | `participant_identity_links` | M2 | `participants` |
| 3 | `participant_auth_links` | M2 | `participants` |
| 4 | `competitions` | M3 | — |
| 5 | `competition_editions` | M3 | `competitions` |
| 6 | `competition_edition_phases` | M6 | `competition_editions` |
| 7 | `classification_snapshots` | DDL-M11 | `competition_editions` |
| 8 | `competition_edition_standings` | DDL-M11 | `classification_snapshots` |
| 9 | `pools` | M4 | `competition_editions` |
| 10 | `pool_fee_schedule` | M4 | `pools` |
| 11 | `pool_entries` | M4 | `pools`, `participants`, `pool_fee_schedule` |
| 12 | `payments` | M5 | `participants` |
| 13 | `payment_allocations` | M5 | `payments`, `pool_entries` |
| 14 | `prize_allocations` | M5 | `pools`, `pool_entries`, `participants` |
| 15 | `ties` | M6 | `competition_edition_phases` |
| 16 | `matches` | M6 | `ties`, `competition_edition_phases` |
| 17 | `match_results` | M7 | `matches` |
| 18 | `predictions` | M7 | `pool_entries`, `matches`, `ties` |
| 19 | `ranking_snapshots` | M10 | `pools`, `pool_entries` |
| 20 | `sync_state` | M6 | `competition_editions`, `competition_edition_phases` |
| 21 | `audit_chain_head` | M8 | — |
| 22 | `audit_events` | M8 | — |
| 23 | `audit_event_details` | M8 | `audit_events` |
| 24 | `outbox_events` | M9 | — |
| 25 | `outbox_delivery_attempts` | M9 | `outbox_events` |
| 26 | `request_idempotency` | DDL-M12 | — |
| 27 | `migration_lineage` | M14 | — |
| 28 | `classification_predictions` | M17 | `pool_entries` |
