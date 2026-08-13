<!-- FDC-20260813-140645Z · no raw PII -->

# DATA CLEANSING EXECUTION

## Procedure actually followed, per §70

| Step | Evidence |
|---|---|
| 1. backup / evidence gate | `snapshots/20_pre_remediation.txt` (document sha256 ×3, all counts, both view definitions' sha256) + a fresh logical `pg_dump` of `bolao_state`, `bolao_entry_private`, `cdb_entry_access` (217 647 bytes) |
| 2. disposable rehearsal | local PostgreSQL 17, database `fdc_rehearsal`, loaded from a read-only `pg_dump` of production. **Rehearsal fidelity proven**: document sha256 in the clone equals production's, all three |
| 3. expected affected-record manifest | 3 documents · 69 audit records · 247 entry fields · 2 view definitions. **0 business rows** |
| 4. dry run | full forward apply in the clone, then rollback, then forward again, then forward a second time (idempotency) — all clean |
| 5. production mutation | `20260813200000` then `20260813210000`, each in one transaction with in-migration assertions |
| 6. post-write counts | `archive 3 · events 69 · fields 247` · `ARCHIVE_MATCHES_LIVE = 3` |
| 7. source–target reconciliation | in-migration `DO` blocks that **refuse to commit** on any mismatch (see below) |
| 8. security verification | live anon API, real publishable key — see `PUBLIC_SECURITY_RECERTIFICATION.md` |
| 9. scoring / read regression | `audit_scoring.py` ×3 **ALL CHECKS PASSED** · `read_contract_parity.mjs` **BUG 0 · UNKNOWN 0** |
| 10. run id + rule | `FDC-20260813` stamped on every inserted row |

**No migration file containing an internal `COMMIT` was production-dry-run.** Both files open with
`begin;` and close with a single `commit;`, and both were exercised end-to-end in the disposable
clone first. The prior process defect did not recur.

## The reconciliation is inside the migration

`20260813210000` cannot commit unless all of the following hold — they are `raise exception`, not
report lines:

- archive row count == `public.bolao_state` row count, and every `raw_document` **is not distinct
  from** its live `state`;
- `legacy_audit_event` count == the sum of `jsonb_array_length(auditLog)` over all pools;
- **zero** records classified `UNCLASSIFIED`;
- every `raw_event` **is not distinct from** `state->'auditLog'->ordinal`;
- every `legacy_entry_field.raw_value` **is not distinct from** its source leaf;
- every `canonical_value` for the four modelled fields **reproduces `public.bolao_entry_private`
  exactly** — this is what makes the historical `EMPTY_TO_NULL` falsifiable rather than asserted;
- `anon` and `authenticated` hold neither `audit` schema USAGE nor SELECT on any of the three
  tables.

## Rollback and recovery

| | |
|---|---|
| `20260813200000.rollback.sql` | restores both F10 view definitions verbatim. Rehearsed: the projections return to **byte-identical** sizes (9 280 / 47 656 / 141 841). The file states plainly that applying it **re-exposes the PII** |
| `20260813210000.rollback.sql` | drops the three tables. Rehearsed: drop → recreate → identical 3 / 69 / 247. The file states that it is safe **only while `public.bolao_state` still exists**, and must not be applied after retirement |
| Idempotency | both re-applied twice with no change (`INSERT 0 0`, view definitions stable) |

## Totals

```
CLEANSING_RULES_DEFINED        8
CLEANSING_RULES_APPLIED        4     (RAW_ONLY, IDENTITY, EMPTY_TO_NULL capture, INSTANT_PARSE_WITH_PROVENANCE)
CLEANSING_RECORDS_CHANGED      0     business records
CLEANSING_RECORDS_CREATED    319     private forensic rows (3 + 69 + 247)
CLEANSING_FIELDS_CHANGED       0
CLEANSING_RAW_VALUES_PRESERVED 319
CLEANSING_QUARANTINES          1     (C8 — malformed address, operator decision D-B)
```
