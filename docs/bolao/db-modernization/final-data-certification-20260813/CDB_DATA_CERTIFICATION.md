<!-- FDC-20260813-140645Z · no raw PII · counts, tokens and fingerprints only -->

# CDB2026 — DATA CERTIFICATION

Pool `cdb2026` · in production · quartas open, cutoff 2026-08-25T23:00:00Z ·
`CDB_WRITE_AUTHORITY = NORMALIZED` since 2026-08-13.

## 1. The three epochs, separated

| Epoch | Discriminator (measured, not assumed) | Records |
|---|---|---:|
| **HISTORICAL_LEGACY** | `audit.migration_lineage` rows for cdb2026 sources; `predictions.mirrored_at IS NULL` | lineage **175** (`bolao/cdb2026`) + **308** (`football/cdb2026`) |
| **CUTOVER_COMPATIBILITY** | `public.bolao_state['cdb2026']` after 2026-08-13T13:1xZ; the sections `cdb_authoritative_document()` carries over | 1 document · last write the operational canary `2026-08-13T13:23:09Z` |
| **NORMALIZED_RUNTIME** | `predictions.mirrored_at IS NOT NULL` = **0**; `pool_entries.content_updated_at` after cutover = **0**; `outbox_events` after cutover = **0**; migration lineage additions = **0** | **0 business records** |

**No natural participant save has occurred.** One token *was* used at `2026-08-13T14:04:34.775Z`
(`public.cdb_entry_access.last_used_at`, entry token `bfb1573d…`) — minutes before this audit
opened. It produced no save: `predictions.mirrored_at` stayed 0 and the document's `updated_at` did
not move off the canary. `last_used_at` is **access metadata**, not an entry modification stamp,
and is deliberately not counted toward `NATURAL_CDB_SAVES_OBSERVED`.

## 2. Exact counts

| Class | Source | Target | Count |
|---|---|---|---:|
| ENTRIES | `entries[]` | `bolao.pool_entries` | **12** |
| PARTICIPANTS | | `bolao.participants` | **12 links** |
| TIE PREDICTIONS (`qualified`) | `picks.qualified` | `bolao.predictions` (`tie_id`) | **110 source → 104 normalized + 6 residue** |
| MATCH PREDICTIONS (legs) | `picks.matches.<tie>.{first,second,single}` | `bolao.predictions` (`match_id`) | **218 source → 208 normalized + 10 residue** |
| **TOTAL PREDICTIONS** | | | **328 source = 312 normalized + 16 residue** |
| PHASES | `phases{}` | `bolao.competition_edition_phases` | **9 → 9** (platform total 18 = cdb 9 + copa 8 + br 1) |
| TIES | `phases.*.ties` | `bolao.ties` | **28** |
| MATCHES | tie legs | `bolao.matches` | **56** |
| RESULTS | `phases.*.ties[].legs` | `bolao.match_results` | **48** (platform total 143 = cdb 48 + copa 95) |
| SCHEDULE / CUTOFF / KICKOFF | `cutoffAt`, `cutoffOffsetMs`, kickoffs | `competition_edition_phases`, `matches` | in parity (0 divergences, §TIMESTAMP_FORENSICS) |
| TOPOLOGY | `phases.*.topology`, `officialDraw` | `bolao.ties` + phases | migrated |
| SCHEDULE PROVENANCE | `phases.quartas.scheduleProvenance` | `audit.legacy_document_archive` | **1** (5 leaves) |
| PAID CONFIRMATIONS | `paid{}` | `bolao.entry_payment_confirmation` | **12** |
| TOMBSTONES | `deletedIds` | — | **0** |
| PRIVATE ENTRY FIELDS | email 12 · payer 12 · method 12 | `bolao_entry_private` + `legacy_entry_field` | **36** |
| `lastClientRef` | `entries[].lastClientRef` | `audit.legacy_entry_field` | **2** |
| DIAGNOSTICS / IP / userAgent / screen / platform | — | — | **0 — ABSENT_IN_SOURCE** |
| AUDIT EVENTS | `auditLog[]` | `audit.legacy_audit_event` | **43** — **28** `TS_ACTION_ADMIN_DETAIL` + **15** `TYPE_ACTOR_AT_CLIENTREF` |
| OUTBOX | `bolao.outbox_events` | | **5** cdb events, all `sent` |
| ACCESS STATE | `public.cdb_entry_access` | | **12** tokens, 3 used |
| `espnSync` | 5 flags | `bolao.sync_state` + archive | **1** |
| UPDATED_AT / content_updated_at / mirrored_at | | | 12 / **5** / **0** |
| QUARANTINED / UNRECOVERABLE / UNKNOWN | | | **0 / 0 / 0** |

## 3. The four normalized-authority writer domains — certified

| Writer | Domain | Input | Verified |
|---|---|---|---|
| `cdb_save_my_picks` | PREDICTIONS | `cdb_authoritative_document()` | **NORMALIZED-INPUT** |
| `cdb_apply_operator_mutation` | SCHEDULE · PHASES · RESULTS · TOMBSTONES · ENTRY_METADATA · SYSTEM_META | same | **NORMALIZED-INPUT** |
| `cdb_register_bracket_topology` | TOPOLOGY | same | **NORMALIZED-INPUT** |
| `cdb_refresh_topology_provenance` | TOPOLOGY | same | **NORMALIZED-INPUT** |

Detected by matching the function body **with SQL comments stripped** — the naive detector reports
all four `LEGACY-INPUT`, because it matches the sentence inside the comment that explains what
changed. Re-verified after this session's two migrations: still 4/4 NORMALIZED-INPUT.

`bolao.cdb_authoritative_document()` re-verified leaf-for-leaf against the stored document **after**
remediation: **1 598 / 1 598 · 0 stored-only · 0 derived-only.**

**CDB ACCOUNTING = 100.000%  ·  CDB RECOVERY = 100.000%.** Certification: `PASS`.
