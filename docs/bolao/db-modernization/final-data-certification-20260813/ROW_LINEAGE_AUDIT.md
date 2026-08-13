<!-- FDC-20260813-140645Z · no raw PII -->

# ROW-LEVEL LINEAGE AUDIT

## Current state

```
audit.migration_lineage        1 691 rows
distinct (schema, relation, row_id)  1 691      → no duplicate lineage
dispositions   MIGRATED 1 668 · DERIVED_WITH_PROOF 23
UNKNOWN / UNACCOUNTED / ORPHANED / QUARANTINED      0
migration runs 17 · transform versions 7
newest row     2026-08-13 00:50:01Z   (BEFORE the write cutover at ~13:1xZ)
runtime lineage additions since cutover             0
```

## Every migrated business row has a source

| Target relation | Lineage rows | Live rows | Coverage |
|---|---:|---:|---|
| `bolao.predictions` | 1 045 | 1 045 | 100% |
| `bolao.classification_predictions` | 154 | 154 | 100% |
| `bolao.matches` | 160 | 160 | 100% |
| `bolao.match_results` | 143 | 143 | 100% |
| `bolao.entry_payment_confirmation` | 50 | 50 | 100% |
| `bolao.pool_entries` | 46 | 46 | 100% |
| `bolao.ties` | 28 | 28 | 100% |
| `bolao.participants` | 26 | 26 | 100% |
| `bolao.competition_edition_phases` | 18 | 18 | 100% |
| `bolao.pool_entry_tombstone` | 8 | 8 | 100% |
| `bolao.competitions` / `competition_editions` / `pools` / `pool_fee_schedule` | 3 / 3 / 3 / 3 | 3 / 3 / 3 / 3 | 100% |
| `bolao.sync_state` | 1 | 1 | 100% |
| **total** | **1 691** | **1 691** | **100%** |

`MIGRATED_TARGET_WITHOUT_SOURCE = 0` · `ROW_LINEAGE_COVERAGE_PERCENT = 100.000`.

## By source product

| Source | Rows |
|---|---:|
| `football/cdb2026` | 308 |
| `bolao/main` (copa) | 855 |
| `bolao/cdb2026` | 175 |
| `football/main` | 130 |
| `bolao/br2026` | 105 |
| `football/br2026` | 76 |
| `football/copa2026` | 27 |
| `bolao/(null)` | 11 |
| `football/br2026,cdb2026` · `football/br2026,cdb2026,main` | 2 · 2 |

## Transform versions

`q39-copa-bracket/1` 844 · `q25-canary/1` 312 · `q33-identity-unblock/1` 302 ·
`readcut-entry-contract/1` 103 · `m17-zone-picks/1` 56 · `kplus-op-4a-paid-confirmation/1` 50 ·
`readcut-cdb-missing-predictions/1` 24.

## No runtime row was added to migration lineage

`audit.migration_lineage` is for **migration** provenance. The newest row is
`2026-08-13 00:50:01Z`, before the write cutover; the count was 1 691 before this session's
remediation and is 1 691 after it. **`NORMALIZED_RUNTIME_LINEAGE_WRITES = 0`**, which is the
invariant, not a coincidence — and the two migrations applied here write nothing to it.
