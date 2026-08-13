<!-- FDC-20260813-140645Z · no raw PII -->

# FIELD-LEVEL LINEAGE

Row lineage says *this row came from that document element*. It does not say **which source field
produced this target value, under what transform**. `FIELD_SOURCE_TARGET_MATRIX.csv` carries all
**1 237 distinct source field shapes** across the three documents; this is the part that was
renamed, split, combined, cleaned, derived or canonicalised.

## Transformed fields — the complete set

| Source field | Product | Target | Transform | Deterministic | Operator approval | Raw preserved in |
|---|---|---|---|---|---|---|
| `entries[].createdAt` | all | `pool_entries.submitted_at` | **RENAME** — the legacy creation instant becomes the normalized *submission* instant; `created_at` is a migration clock | yes (46/46 exact) | no | `legacy_document_archive` |
| `entries[].updatedAt` | all | `pool_entries.content_updated_at` | **RENAME + SPLIT** — separated from `updated_at`, which is the migration clock | yes (31/31 exact) | no | `legacy_document_archive` |
| `entries[].payerName` = `""` | br2026 ×2 | `bolao_entry_private.payer_name` = NULL | **`EMPTY_TO_NULL`** | yes | no | **`legacy_entry_field.raw_value`** |
| `entries[].paymentMethod` = `""` | br2026 ×1 | `bolao_entry_private.payment_method` = NULL | **`EMPTY_TO_NULL`** | yes | no | **`legacy_entry_field.raw_value`** |
| `entries[].picks.<match>.{goalsA,goalsB,advanceSide}` | copa | `predictions.{predicted_goals_home,_away,predicted_qualified_side}` | **RENAME** (A/B → home/away) | yes | no | `legacy_document_archive` |
| `entries[].picks.<match>.{displayA,displayB}` | copa | `predictions.{display_home,display_away}` | **RENAME** | yes | no | `legacy_document_archive` |
| `picks.matches.<tie>.{first,second,single}.goals*` | cdb | `predictions.predicted_goals_*` + `match_id` | **SPLIT** — one leg key becomes a match reference plus two goal columns | yes | no | `legacy_document_archive` |
| `picks.qualified.<tie>` | cdb | `predictions.predicted_qualified_side` + `tie_id` | **SPLIT** | yes | no | `legacy_document_archive` |
| `picks.{g4,z4,sa6}[i]` | br | `classification_predictions.{zone, ordinal, club_name}` | **SPLIT** — array position becomes an explicit ordinal | yes | no | `legacy_document_archive` |
| `paid[entryId]` | all | `entry_payment_confirmation` | **RESHAPE** — object key becomes a row; **KPLUS_OP_4A semantics only** | yes | approved (KPLUS_OP_4A) | `legacy_document_archive` |
| `deletedIds[]` | copa | `pool_entry_tombstone` | **RESHAPE** | yes | no | `legacy_document_archive` |
| `auditLog[].ts` ‖ `.at` | all | `legacy_audit_event.{instant_field, instant_raw, occurred_at}` | **PARSE + PROVENANCE** — the *which key* is kept as data | yes (69/69) | no | `legacy_audit_event.raw_event` |
| `auditLog[].action` ‖ `.type` | all | `legacy_audit_event.action_raw` | **COALESCE, both spellings recoverable from `raw_event`** | yes | no | `raw_event` |
| `phases.*.cutoffAt`, `ties[].kickoff`, `ties[].lockedAt` | cdb | `competition_edition_phases.cutoff_at`, `matches.kickoff_at`, `ties.locked_at` | **TIMESTAMP CANONICALISATION** — same instant, canonical offset | yes; 35 divergences → **0** | no | `legacy_document_archive` |
| `meta.{version,updatedAt}` | all | (not migrated) | **SUBSTITUTED** — the derived document emits its own `meta` | n/a | no | `legacy_document_archive` |
| `entries[].participantEmail` (**one** record, `sha256(raw)=66f7b533…`) | copa2026 | `bolao_entry_private.participant_email` + `bolao.participants.email` | **`EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1`** — remove the single terminal comma | yes | **YES — decision D-B** | `legacy_entry_field.raw_value` · `legacy_document_archive` · `public.bolao_state` |

## Fields carried with NO transform

Everything else: **`IDENTITY`**. The `RAWDIFF` measurement is the proof — comparing the legacy value
byte-for-byte against the private table across all 46 entries and all four modelled private fields
produced **exactly 3 differences, all `EMPTY_TO_NULL`, 0 elsewhere**. Emails in particular were
**not** lowercased, trimmed or corrected on the way in.

## Coverage

| | |
|---|---:|
| distinct source field shapes | **1 237** |
| shapes with a stated target and transform | **1 237** |
| **`FIELD_LINEAGE_COVERAGE_PERCENT`** | **100.000** |
| of which non-`IDENTITY` transforms | **16 classes** |
| transforms requiring operator approval | **2** — KPLUS_OP_4A `paid` semantics, and **D-B** (one address, ledger `20260813230000`) |
| transforms involving an identity guess | **0** |
| transforms involving inferred financial semantics | **0** |

100% field lineage is claimed **because every shape is enumerated in the matrix**, not because
every row has a migration record. Those are different claims and only the first one is this one.

## The one field-level record that needed a human

D-B is the only transform on this platform that required operator approval for a *value*, and it is
recorded at field level in `audit.operator_cleansing_decision`:

| Column | Content |
|---|---|
| `decision_ref` / `rule_id` | `D-B` / `EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1` |
| `source_record_token` / `participant_token` | `98356dcf` / `da24a351` (md5 prefixes — never the ids) |
| `raw_fingerprint` / `canonical_fingerprint` | `66f7b533…` / `b6f29448…` |
| `raw_preserved_in` | the three relations that still hold the malformed value |
| `targets_updated` / `rows_affected` | the two canonical columns + the forensic row / **2** |
| `operator_approved` | **true** |

The table stores **fingerprints and tokens only** — no raw value, no canonical value. It is enough
to prove *which* record changed, *by what rule*, and *that the raw survived*, without republishing
the address to do it.
