<!-- FDC-20260813-140645Z · no raw PII -->

# FINAL DATA CERTIFICATION

**AUDIT_RUN_ID** `FDC-20260813-140645Z` · started `2026-08-13T14:06:45Z`
**SOURCE_FREEZE_SHA** `23baf6b1` · **ORGIN_MAIN_SHA** `23baf6b1`
**PRODUCTION_LEDGER** 46 → **48** · **DEPLOYED_SHA_AT_START** `23baf6b1`

## STATUS: `PASS_WITH_DOCUMENTED_UNRECOVERABLE_CLIENT_SCOPE`

Not plain `PASS`. `bolao_copa_2026_state` is client-only by design since `8d6dbf98`, and a
participant's browser can hold copa state the server will never receive. **0 surviving instances
were found**, but the class exists and its fate is known, which is exactly what this status is for.

---

## 1. Global accounting

| | |
|---|---:|
| SOURCE_RECORDS_DISCOVERED | **8 933** field/record instances |
| SOURCE_FIELDS_DISCOVERED | **1 237** distinct field shapes (legacy) + 12 non-legacy source classes |
| SOURCE_RECORDS_ACCOUNTED | **8 933** |
| SOURCE_FIELDS_ACCOUNTED | **1 237** |
| **DATA_ACCOUNTING_COMPLETENESS_PERCENT** | **100.000** |
| **DATA_RECOVERY_COMPLETENESS_PERCENT** | **100.000** of everything reachable; the client-only class is unbounded below and unmeasurable, not lost |
| **RECOVERABLE_DATA_PRESERVATION_PERCENT** | **100.000** |
| **UNKNOWN** | **0** |
| SOURCE_WITHOUT_DISPOSITION | **0** |
| TARGET_WITHOUT_PROVENANCE | **0** |

### Dispositions

| Disposition | Instances |
|---|---:|
| `MIGRATED_EXACT` | **5 387** |
| `PRESERVED_PRIVATE_FORENSIC` | **2 867** |
| `PRESERVED_PRIVATE_NORMALIZED` | **219** |
| `TEST_FIXTURE` | **161** |
| `PRESERVED_PRIVATE_ARCHIVE` | **160** |
| `DERIVED_WITH_PROOF` | **59** |
| `HISTORICAL_SUPERSEDED` | **29** |
| `PHYSICALLY_UNRECOVERABLE_CLIENT_ONLY` | **27** (storage keys; **0** known instances) |
| `TOMBSTONED_WITH_PROOF` | **11** |
| `APPROVED_NON_BUSINESS_ARTIFACT` | **7** |
| `PRESERVED_UNMODELLED_WITH_SEMANTICS` | **6** |
| `MIGRATED_CLEANSED_WITH_RAW_PRESERVED` | **3** |
| `QUARANTINED_WITH_REASON` | **1** |
| `DUPLICATE_WITH_CANONICAL_LINK` | **0** |
| `SYNTHETIC` | **0** |
| **`UNKNOWN`** | **0** |

## 2. Product certification

| | Certification | Accounting | Recovery |
|---|---|---:|---:|
| **WORLD CUP / copa2026** | `PASS_WITH_DOCUMENTED_UNRECOVERABLE_CLIENT_SCOPE` | 100.000% | 100.000% reachable |
| **BR2026** | `PASS` | 100.000% | 100.000% |
| **CDB2026** | `PASS` | 100.000% | 100.000% |
| Other real competitions discovered | **1** — Powerball (`public.lottery_*`) | registered, **out of bolão retirement scope** | n/a |

## 3. What this audit changed in production

Two migrations, both rehearsed against a disposable clone whose document checksums were proven
identical to production, both idempotent, both with an exercised rollback, both registered in the
ledger **with** `statements` and `rollback` — so neither is a seventh unchecksummed row.

| Ledger | What | Business rows touched |
|---|---|---:|
| `20260813200000` | **G1** — closes a live anonymous PII exposure in the two legacy public projections | **0** |
| `20260813210000` | **G2** — three private, fail-closed forensic tables + backfill (3 documents · 69 audit records · 247 entry fields) | **0** |

All three legacy document checksums are **byte-identical before and after**.
`predictions 1045 · pool_entries 46 · entry_private 46 · lineage 1691 · finance 0/0/0` — unchanged.

## 4. The five sources the frozen manifest did not have

1. **auditLog has three shapes, not two** — copa2026's 19 records carry `email`, `ip`, `userAgent`,
   `screen`, `platform`, `lang`. It is the only shape with PII, and it was public.
2. **copa2026 `entries[].diagnostics`** — 21 entries × 4 fields. Also public.
3. **br2026 auditLog** — 7 records, uncounted.
4. **The residue is 16 prediction records, not 6** — 6 `qualified` + 10 `matches` legs, 26 leaves.
   The manifest counted the `qualified` slots.
5. **Two anon-readable legacy projections** — Q38 had been verified against the base table and the
   normalized contract, never against the F10 sanitisers.

The source freeze is reissued at ledger **48** with all five registered.

## 5. Regression gates

```
audit_scoring.py   copa2026 ALL CHECKS PASSED · br2026 ALL CHECKS PASSED · cdb2026 ALL CHECKS PASSED
read_contract_parity.mjs   copa 4017 · br 323 · cdb 1188 leaves   BUG 0 · UNKNOWN 0 · ALL PRODUCTS PASS
   deletedIds set-equal x3 · paid object identical x3
mirror_contract_tests.mjs  30 ok, 0 failed
cdb_authoritative_document()  1598 / 1598 leaves · 0 stored-only · 0 derived-only
four cdb writers              4/4 NORMALIZED-INPUT (comment-stripped detection)
submit_entry                  allowlist empty
PUBLIC_PII_FINDINGS 0 · Q38 CLOSED · anon 401/401/401 on raw, 404 on all three forensic tables
```

**`no_redrift_test.mjs` reports 2 failures and they are not regressions.** It runs against a
*stale* local disposable clone (`/tmp/rcsock`, db `cdbdrift`) which has **no `supabase_migrations`
schema, 0 `audit.legacy_*` tables, the pre-fix view definition, lineage 1688 and predictions 1042** —
it does not contain this session's changes at all. Both failures are re-run artifacts of the
harness against its own already-applied state (`{"reason":"idempotente","updated":false}`), and
every downstream invariant in the same run passes. Reported rather than silently omitted; **not
fixed**, because the fixture belongs to another workstream.

## 6. Cutover state — not regressed

```
READ_CUTOVER YES · BR/CDB/COPA_READ_SOURCE NORMALIZED · LEGACY_READ_FALLBACK PRESERVED
CDB_WRITE_AUTHORITY NORMALIZED · LEGACY = COMPATIBILITY MIRROR · WHOLE_DOCUMENT_WRITERS 0
KPLUS_OP_4A CLOSED · KPLUS_OP_4B PARKED · CANONICAL_PAYMENTS 0 · PAYMENT_ALLOCATIONS 0 · PRIZE_ALLOCATIONS 0
NATURAL_CDB_SAVES_OBSERVED 0 / 3 · OFFICIAL_RECONCILE_CYCLES_OBSERVED 0 / 1
STABILIZATION_STATUS INCOMPLETE · BACKUP_STATUS INTACT
AUDITLOG_MODELING  LEGACY_RETIREMENT_PREREQUISITE → SATISFIED (private forensic)
```

## 7. LEGACY_RETIREMENT_READY = **NO**

The data gates pass. Three prerequisites do not, and none of them is a data-accounting problem:

1. **Stabilization is unmet** — `NATURAL_CDB_SAVES_OBSERVED 0 / 3`,
   `OFFICIAL_RECONCILE_CYCLES_OBSERVED 0 / 1`. Neither may be manufactured. The quartas lifecycle
   (cutoff `2026-08-25T23:00:00Z`, 4 ties) is expected to produce both.
2. **R1 is still open** — unapplied `20260813050000` would overwrite `cdb_save_my_picks` with a
   legacy-input body, silently, on the next `supabase db push`. Must be rebased onto the inverted
   definition and re-verified with the authority probe.
3. **`cdb_update_entry_picks` is `REACHABLE_BUT_UNUSED`, not `DEAD_WITH_PROOF`** — see §8.

**LEGACY RETIREMENT WAS NOT EXECUTED.** Nothing was deleted, dropped or truncated.

## 8. `cdb_update_entry_picks`

| | |
|---|---|
| EXECUTE | `service_role` **only** (`anon` false, `authenticated` false) |
| Callers at HEAD | `secure_access_canary.py`, `test_public_projection_and_submit.py`, its defining SQL, two baselines, one doc |
| Production callers | **none** |
| Records it produced | none attributable — superseded by `cdb_save_my_picks` (`7719b45d`, 2026-08-11, after the RPC was found accepting the victim's entry id as a parameter) |
| Classification | **`REACHABLE_BUT_UNUSED`** |

Not `DEAD_WITH_PROOF`: a `service_role`-executable function is reachable by every operator script
and cron job on the platform, and "no caller in the repository" is not the same as "cannot fire".
**It was not dropped** — its removal belongs after certification, as a separate hygiene change with
its own rehearsal.

## 9. Operator decisions

`OPERATOR_DECISIONS_REQUIRED = 2`. Both are genuinely semantic. See `OPERATOR_DECISIONS.md`.

- **D-A** — the operator's own address is at HEAD in 30 files, and is also a participant address.
- **D-B** — one copa2026 participant address has a trailing comma in its domain. Quarantined, not
  guessed.

## 10. NEXT_EXACT_ACTION

> **Continue passive stabilization evidence collection. Do not modify data.**

The forensic audit passes; the stabilization gate does not, and they are separate gates. The
quartas lifecycle should produce both counters naturally. In parallel, and owned by the confirmation
workstream rather than by this one: rebase `20260813050000` onto the normalized-input
`cdb_save_my_picks` and re-verify with the authority probe.

Do not prepare a legacy-retirement execution plan until `NATURAL_CDB_SAVES_OBSERVED ≥ 3`,
`OFFICIAL_RECONCILE_CYCLES_OBSERVED ≥ 1`, and R1 is closed.
