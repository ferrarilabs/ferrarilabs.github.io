<!-- FDC-20260813-140645Z · no raw PII · counts, tokens and fingerprints only -->

# BR2026 — DATA CERTIFICATION

Pool `br2026` · legacy document id `br2026` · entries closed 2026-07-16 · not published.
Epoch: **HISTORICAL_LEGACY**. `NORMALIZED_RUNTIME` records: **0**.

BR's field universe is **not** copa's and no copa field is manufactured here.

| Class | Source | Target | Count |
|---|---|---|---:|
| ENTRIES | `entries[]` | `bolao.pool_entries` | **11** |
| PARTICIPANTS | | `bolao.participants` | **11 links** |
| CLASSIFICATION PREDICTIONS | `entries[].picks.{g4,z4,sa6}` | `bolao.classification_predictions` | **154** = 44 + 44 + 66 |
| MATCH PREDICTIONS | — | — | **0 — ABSENT_BY_DESIGN** (BR is a zone-classification pool) |
| TIE PREDICTIONS | — | — | **0 — ABSENT_BY_DESIGN** |
| RESULTS | `results` | `bolao.match_results` | **0** (`null` in source; the Brasileirão is still running) |
| PHASES | — | `bolao.competition_edition_phases` | **1** |
| MATCHES / TIES | — | `bolao.matches` / `bolao.ties` | **0 / 0 — ABSENT_BY_DESIGN.** BR is scored against ESPN standings, not against a fixture model |
| PAID CONFIRMATIONS | `paid{}` | `bolao.entry_payment_confirmation` | **11** |
| TOMBSTONES | `deletedIds` | — | **0** |
| EMAIL_SOURCE_RECORDS | `entries[].participantEmail` | `bolao_entry_private` | **11** |
| EMAIL_PRIVATELY_PRESERVED | | | **11** |
| IP / userAgent / screen / platform / viewport / timezone / lang | — | — | **0 — ABSENT_IN_SOURCE.** BR never captured device or network metadata |
| ENTRY_CREATED / SUBMITTED / UPDATED | `createdAt` 11 · `updatedAt` **3** | `pool_entries.*` | 11 / 11 / **3** |
| AUDIT EVENTS | `auditLog[]` | `audit.legacy_audit_event` | **7** — shape `TS_ACTION_ADMIN_DETAIL`, actions: `extend-cutoff`, `op-confirm-payment`, `rename-entry`, `round-email-sent` |
| ROUND EMAIL LEDGER | `roundEmail` | `audit.legacy_document_archive` | **1 ledger key · 11 recipients** |
| STATIC JS/JSON | `bolao/br2026/data/espn-*.json` | — | **0 business records** (ESPN fixtures/standings) |
| LOCALSTORAGE KEYS | `bolao_br2026_state` + 12 non-business | — | **13** |
| BACKUP_ONLY / GIT_HISTORY_ONLY | | | **0 / 0** |
| MIGRATED_CLEANSED_WITH_RAW_PRESERVED | 2 × `payerName` `""`, 1 × `paymentMethod` `""` | `audit.legacy_entry_field` | **3** |
| QUARANTINED / UNRECOVERABLE / UNKNOWN | | | **0 / 0 / 0** |

**The three cleansed values are BR's only cleansing on the platform.** Legacy stores the key with
an empty string; `public.bolao_entry_private` stores NULL. The transform is deterministic
(`EMPTY_TO_NULL`) and now falsifiable: `audit.legacy_entry_field` holds the raw `""` beside the
NULL canonical, and the preservation migration refuses to commit unless every canonical value
reproduces `bolao_entry_private` exactly.

`roundEmail` carries **no address** — `entryRef` (UUID), `state`, `providerMessageId`, `lastError`
only, asserted by a `like '%@%'` scan returning false. It is delivery metadata, not participant
identity, and is **not** evidence that a business submission occurred.

**BR ACCOUNTING = 100.000%  ·  BR RECOVERY = 100.000%.** Certification: `PASS`.
