<!-- FDC-20260813-140645Z · no raw PII -->

# FINAL DATA CERTIFICATION

**AUDIT_RUN_ID** `FDC-20260813-140645Z` · started `2026-08-13T14:06:45Z`
**SOURCE_FREEZE_SHA** `23baf6b1` · **ORGIN_MAIN_SHA** `23baf6b1`
**PRODUCTION_LEDGER** 46 → **48** → **50** (post-audit closure) · **DEPLOYED_SHA_AT_START** `23baf6b1`
**MERGED** PR #124 → `5e9dadc1` on `main`, Pages deploy **success**

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

## 7. LEGACY_RETIREMENT_READY = **NO** — one prerequisite left

Post-closure (2026-08-13, ledger 50), two of the three prerequisites are closed:

1. **Stabilization is unmet — still the only open item.** `NATURAL_CDB_SAVES_OBSERVED 0 / 3`,
   `OFFICIAL_RECONCILE_CYCLES_OBSERVED 0 / 1`. Neither may be manufactured. The quartas lifecycle
   (cutoff `2026-08-25T23:00:00Z`, 4 ties) is expected to produce both.
2. ~~R1~~ **CLOSED** — and the original statement of it was wrong in two directions. See §7a.
3. ~~`cdb_update_entry_picks`~~ **CLOSED** — `FAIL_CLOSED_REVOKED`, ledger `20260813220000`.

**LEGACY RETIREMENT WAS NOT EXECUTED.** Nothing was deleted, dropped or truncated.

### 7a. R1 — the correction, and the defect underneath it

The previous issue of this certification carried R1 forward from
`FINAL_WRITE_CUTOVER_REPORT.md`'s addendum as an open blocker. **That was an error in this
document.** The addendum was written before PR #123 merged; commit `163f892e`
(2026-08-13 09:46:39 -0400), *inside the very commit the source freeze was taken at*, had already
rebased `20260813050000` onto `bolao.cdb_authoritative_document()`. The frozen manifest said so
plainly in A3 — "`050000` was rebased in PR #123 so it can no longer revert the cutover" — and this
audit trusted the older report over the newer manifest without reading the file body. Verifying that
the migration was *unapplied* is not the same as verifying what it *contains*.

The closure session read the body, and found the defect the first rebase had left behind:

> The rebase substituted the **input** and not the **write**. `cdb_save_my_picks` is the one writer
> whose cutover also *added* `perform bolao.cdb_mirror_entry_picks(...)`, and the file predates both
> changes. The rebased definition reads normalized, validates against normalized, reports
> `NORMALIZED-INPUT` to every detector — and writes the participant's picks to the legacy document
> alone.

Measured on a clone at production level, `origin/main`'s file applied as it stood: the save returned
`{"updated": true}`, `public.bolao_state` carried the new goals, **`bolao.predictions` stayed at
1045 and `mirrored_at` stayed 0**. Normalized would have gone stale on the first real save, in
silence, with every green light on.

Corrected in this branch, re-proven on the same clone: 4/4 `NORMALIZED-INPUT`, mirror present,
authority probe raises `CUTOFF_PASSADO` (not `FASE_FECHADA`) with the legacy cutoff blanked, and the
save writes normalized `7` = legacy `7` = derived `7`.

`FUTURE_DB_PUSH_REVERTS_CDB_AUTHORITY = NO` · `FUTURE_MIGRATION_CHAIN = PASS`.

### 7b. The clone that lied, and why this section exists

The first clone this session built passed every gate while **silently missing `bolao.participants`
and 45 functions**: `pg_dump --schema=bolao` cannot carry a `citext` column whose type lives in
`extensions`, and the completeness check used `grep '^ERROR'` against a log in which psql writes
`psql:file:line: ERROR:`. Forty-seven restore errors scrolled past as "0".

This is the same trap the write cutover documented — "a prior campaign had atomicity pass green
against a clone that was silently missing the `audit` schema" — and it was walked into anyway. Every
result in this issue comes from the rebuilt clone, asserted **before** any gate was trusted:
**50/50 relations, 114/114 functions, every row count identical, all three document checksums
matching.**

### 7c. A forward-looking note on lineage

`bolao.cdb_mirror_entry_picks` replaces an entry's whole prediction set. On a clone, one save
replaced 24 predictions with 2 and **cascaded 24 rows out of `audit.migration_lineage`**
(1691 → 1667). `ORPHANED_LINEAGE` stayed **0** and runtime *additions* stayed **0**, so both
invariants hold — but the first natural CDB save will move the lineage total off 1691. That is
correct behaviour (a replaced row is no longer a migrated row) and must not be read as loss when
the stabilization counters are finally validated.

## 8. `cdb_update_entry_picks` — now `FAIL_CLOSED_REVOKED`

| | |
|---|---|
| EXECUTE | `service_role` **only** (`anon` false, `authenticated` false) |
| Callers at HEAD | `secure_access_canary.py`, `test_public_projection_and_submit.py`, its defining SQL, two baselines, one doc |
| Production callers | **none** |
| Records it produced | none attributable — superseded by `cdb_save_my_picks` (`7719b45d`, 2026-08-11, after the RPC was found accepting the victim's entry id as a parameter) |
| **Can it bypass normalized authority?** | **YES, before closure** — reads `select state into v_state from bolao_state … for update` (legacy), writes `bolao_state`, **calls no mirror**, **never reads `cdb_authoritative_document()`**. One `service_role` call would have left `bolao.predictions` stale |
| Classification | **`FAIL_CLOSED_REVOKED`** (was `REACHABLE_BUT_UNUSED`) — ledger `20260813220000` revokes `service_role` EXECUTE; `anon`/`authenticated` were already revoked 2026-08-12 |
| Reversal | one statement: `grant execute on function public.cdb_update_entry_picks(text,text,jsonb) to service_role;` |

Not `DEAD_WITH_PROOF`, and that distinction earned its keep: "no caller in the repository" is not
"cannot fire", and the function turned out to be a genuine legacy write path one `service_role`
invocation away from staleness. Every reference on `origin/main` calls it **as anon**, asserting
401/403 — so revoking `service_role` breaks no caller.

**It was not dropped.** The definition, its comments and its history remain as forensic evidence of
a real vulnerability and its supersession. Removal belongs to `LEGACY_RETIREMENT`, as a separate
change with its own rehearsal.

`CDB_LEGACY_WRITE_BYPASS_PATHS = 0`. The nine other functions that write `bolao_state` without a
mirror are all previously dispositioned and none is a cdb2026 path: `copa_apply_operator_mutation`
(archived, NOT_APPLICABLE), `op_append_audit` (br2026 auditLog, legacy by design, D-4), the six
`op_*` (`authenticated` only, **0 principals**), and `submit_entry` (allowlist empty).

## 9. Operator decisions — both closed

`OPERATOR_DECISIONS_REQUIRED = 0`.

- **D-A — CLASSIFIED_AND_DOCUMENTED_NO_REMEDIATION_REQUIRED.** 55 occurrences across 30 files,
  every one classified, `UNKNOWN = 0`. `adminEmail` is never compared (0 matches) — it is an EmailJS
  `to_email`, not a boundary — and the address is on **0** `.html` files and **0** occurrences in
  the HTML the live site delivers. Nothing was rewritten: the policy only moves such values where
  that does not invent complexity, and the three apps call EmailJS from the browser. One stale
  allowlist justification corrected. See `OPERATOR_EMAIL_USAGE_AUDIT.md`.
- **D-B — APPLIED** (ledger `20260813230000`, rule
  `EMAIL_TRAILING_DOMAIN_PUNCTUATION_OPERATOR_APPROVED_V1`). One terminal comma removed from one
  address, bound to the record by the sha256 of its raw value. Raw preserved in all three places it
  lives; the rollback reads it back from `audit.legacy_entry_field` rather than carrying a literal.
  **No participant merged** — 26 people, 23 distinct addresses instead of 24,
  `canonical_participant_id` still NULL on all 26. `CLEANSING_QUARANTINES: 1 → 0`.

  The correction is corroborated, not guessed: the same mailbox already existed, correctly spelled,
  on two other entries in two other pools, and those two resolve to **one** canonical participant.

  `HISTORICAL_COPA_EMAIL_DELIVERY = NOT_DETERMINABLE_FROM_AVAILABLE_DATA` — copa has no delivery
  ledger, and neither success nor failure was inferred.

## 10. NEXT_EXACT_ACTION

> **`STABILIZATION_STATUS = PASSIVE_EVIDENCE_COLLECTION`. Do not modify data.**

R1 is closed, the future migration chain passes, legacy write-bypass paths are 0, the branch is
canonical on `main` and the focused PR is merged. Every remaining prerequisite is a *counter*, and
counters are earned, not produced.

Do not prepare a legacy-retirement execution plan until `NATURAL_CDB_SAVES_OBSERVED ≥ 3` and
`OFFICIAL_RECONCILE_CYCLES_OBSERVED ≥ 1`, each from legitimate production activity. No synthetic
save counts. No reconcile run purely to move a number counts.
