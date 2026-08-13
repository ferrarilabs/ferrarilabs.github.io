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

## Post-audit closure — D-B applied (ledger `20260813230000`)

The one quarantine is closed. The operator approved the correction; the rule is versioned and
**record-scoped**, not a generic transform.

| | |
|---|---|
| `RULE_ID` | `EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1` |
| Bound by | `sha256(raw) = 66f7b533…` — **one record**. Any other value, including another address ending in a comma, does not match |
| Transformation | remove the single terminal comma. Nothing else |
| Rows affected | **2** (`public.bolao_entry_private.participant_email`, `bolao.participants.email`) + 1 forensic row gains a `canonical_value` |
| Raw preserved | `audit.legacy_entry_field.raw_value` · `audit.legacy_document_archive.raw_document` · `public.bolao_state` — **all three untouched**, asserted in the migration |
| Rollback | reads the raw value **back from `audit.legacy_entry_field`**. It carries no literal and cannot drift from the source — which is only possible because raw and canonical were kept apart |
| Identity | **unchanged.** 26 participants, `canonical_participant_id` NULL on all 26. Distinct addresses 24 → **23**: a third shared-mailbox group, not a merge |
| Delivery | **no claim.** `HISTORICAL_COPA_EMAIL_DELIVERY = NOT_DETERMINABLE_FROM_AVAILABLE_DATA` |
| Lineage | `audit.operator_cleansing_decision` — decision ref, rule, product, entry token, participant token, raw fingerprint, canonical fingerprint, targets, approval, rationale. **No raw or canonical value is stored there** |

Rehearsed forward → rollback → forward → forward on a clone proven complete against production
(50/50 relations, 114/114 functions, matching checksums). Production applied, then re-verified
read-only: `malformed_private=0 · malformed_participants=0 · invalid_syntax=0 · distinct_emails=23 ·
participants=26 · canonical_merges=0`, with `forensic_raw_malformed=1` and `legacy_doc_malformed=1`
— the raw evidence exactly where it was.

## Totals

```
CLEANSING_RULES_DEFINED        9   (+ EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1)
CLEANSING_RULES_APPLIED        5     (+ the operator-approved email rule)
CLEANSING_RECORDS_CHANGED      2     one address, in two canonical targets (D-B)
CLEANSING_RECORDS_CREATED    319     private forensic rows (3 + 69 + 247)
CLEANSING_FIELDS_CHANGED       2
CLEANSING_RAW_VALUES_PRESERVED 319   (none overwritten; D-B's raw survives in three places)
CLEANSING_QUARANTINES          0     (C8 closed by operator approval D-B)
```
