<!-- FDC-20260813-140645Z · no raw PII -->

# AUDITLOG AUDIT — THREE SHAPES, NOT TWO

The frozen manifest registered `auditLog` as **43 records on cdb2026 in two shapes**. Measured:
**69 records across three pools in three shapes.** The unregistered third shape is the only one on
the platform that carries contact and network data, and it was publicly readable (finding G1).

## The three shapes

| Shape | Pools | Records | Keys |
|---|---|---:|---|
| `TS_ACTION_ADMIN_DETAIL` | br2026 **7** · cdb2026 **28** | **35** | `ts, action, admin, detail` |
| `TYPE_ACTOR_AT_CLIENTREF` | cdb2026 **15** | **15** | `type, actor, at, clientRef, payload, source` |
| **`COPA_EDIT_WITH_DIAGNOSTICS`** | copa2026 **19** | **19** | `ts, action, entryId, entryName, **email, ip, userAgent, screen, platform, lang**, changes, changeCount` |
| `UNCLASSIFIED` | — | **0** | — |

## Per-record disposition

Every one of the 69 is now a row in `audit.legacy_audit_event` with:

| Column | Rule |
|---|---|
| `raw_event` | the **complete original record**, nothing removed, nothing reordered. Asserted byte-equal to `state->'auditLog'->ordinal` at commit time |
| `shape` | derived from the keys actually present; the migration refuses to commit if any record lands in `UNCLASSIFIED` |
| `instant_field` | **`ts` or `at` — recorded, never collapsed.** The two spellings are different source facts and merging them would erase which writer produced the record |
| `instant_raw` | the raw string |
| `occurred_at` | parsed **only when it parses**. 69 / 69 parsed; a record that had not would keep `null` and its raw string, never an inferred instant |
| `action_raw` / `actor_raw` | `action`‖`type` and `admin`‖`actor` — the shape-specific spellings resolved without discarding either |
| `client_ref` | present on the 15 `TYPE_ACTOR_AT_CLIENTREF` records, null elsewhere |
| `source_fingerprint` | sha256 of the raw record; the record is high-entropy so this is not a reversible hash of a low-entropy secret |

Deduplication is **not** applied on `instant` alone. The platform's own `auditKey()` dedupes on
`(instant, clientRef)` precisely because the server writes whole-second `at` values and 10 of 14
cdb records share only two instants. `legacy_audit_event` keys on `(run, pool, ordinal)` — array
position — so two records that share an instant remain two records.

## Actions observed

- **copa2026** — `edit` (all 19), each carrying `changes[]`: **195 before/after pairs** over
  `goalsA, goalsB, displayA, displayB, advanceSide`.
- **cdb2026** — `apply-official-draw`, `backfill-kickoff`, `backfill-schedule`, `lock-tie`,
  `manual-save-picks`, `revert-mistaken-oitavas-results`, `save-leg`, `set-active-phase`,
  `set-cutoff`, `set-schedule-provenance`, `toggle-paid`.
- **br2026** — `extend-cutoff`, `op-confirm-payment`, `rename-entry`, `round-email-sent`.

## auditLog is not public — and now actually is not

`AUDITLOG_PUBLIC_PROJECTION = EXCLUDED` was already the contract: `bolao.read_document()` emits no
`auditLog`, and all three browsers read the normalized surface. The legacy projections had never
been told. Ledger `20260813200000` removes the section from both; ledger `20260813210000` gives it
a private home. `audit` schema USAGE for `anon`/`authenticated` = **false**; the three forensic
tables have RLS **enabled and FORCED with zero policies**; the live API returns **404**.

`AUDITLOG_RECORDS_DISCOVERED = 69` · `AUDITLOG_SHAPES = 3` · `AUDITLOG_PRIVATELY_PRESERVED = 69`.
`AUDITLOG_MODELING` moves from `LEGACY_RETIREMENT_PREREQUISITE` to **SATISFIED (private forensic)**.
