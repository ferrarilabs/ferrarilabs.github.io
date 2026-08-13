<!-- FDC-20260813-140645Z · no raw PII -->

# MIGRATION LEDGER AND PROVENANCE AUDIT

Ledger **46 → 48 → 50**. Four migrations added across the audit and its closure, **all four with
`statements` and `rollback` populated** — none is a seventh unchecksummed row.

## 1. The six rows without `statements` — A1, each resolved

| Version | Migration file | Ledger state | Repo state | Historical reason | Objects created | Provenance available | Reconstructable SHA | Disposition |
|---|---|---|---|---|---|---|---|---|
| `20260806000000` | `baseline_adopted_pre_tracking.sql` | `statements` NULL | present | **adopted baseline** — production predated the ledger; M0 had to adopt what existed | none (declarative baseline) | yes — the file describes the adopted state | **no** — no statement was ever executed from it | `LEGACY_LEDGER_FORMAT` |
| `20260811160000` | `baseline_adopted_grants_and_rls.sql` | NULL | present | adopted baseline (grants/RLS) | none | yes | no | `LEGACY_LEDGER_FORMAT` |
| `20260811160001` | `baseline_adopted_policies.sql` | NULL | present | adopted baseline (policies) | none | yes | no | `LEGACY_LEDGER_FORMAT` |
| `20260812230000` | `participants_email_is_not_identity.sql` | NULL | present | **manual ledger insert** — applied by hand during the Q33-A1 identity work | `bolao.participants` constraint semantics | yes — file on `origin/main` | **no** — the applied text was not captured at apply time | `CHECKSUM_NOT_HISTORICALLY_CAPTURED` |
| `20260813180000` | `cdb_write_cutover_normalized_authority.sql` | NULL | present + `.rollback.sql` | manual insert during the write cutover | the four inverted writers, `cdb_authoritative_document()`, `predictions.mirrored_at` | yes — file + `FINAL_WRITE_CUTOVER_REPORT.md` §7 | **no** — but the objects were verified file-to-catalogue | `CHECKSUM_NOT_HISTORICALLY_CAPTURED` |
| `20260813190000` | `submit_entry_pool_allowlist.sql` | NULL | present + `.rollback.sql` | manual insert, same session | `submit_entry` allowlist (empty) | yes — file + report §8 | **no** | `CHECKSUM_NOT_HISTORICALLY_CAPTURED` |

`UNKNOWN = 0`. **No checksum was invented for any of the six.** Three are baselines that never
executed a statement, so a statement checksum is not a thing they can have; three are manual
inserts whose applied text was not captured, and reconstructing a SHA from the current file would
assert an equality nobody measured. `MIGRATION_PARITY = EXACT by version set` — every ledger
version has a repo file, and no repo file is applied without a ledger row.

**This session did not repeat the pattern.** `20260813200000` and `20260813210000` were registered
with `statements[1]` and `rollback[1]` populated from the files, and their checksums are computable
and verified:

| Version | What | Checksum computable |
|---|---|---|
| `20260813200000` | public projection PII closure | **yes** — `0a2e2d0bde528fb5…` matches the repo file |
| `20260813210000` | private forensic preservation | **yes** — `3e628eab013457f6…` matches |
| `20260813220000` | `cdb_update_entry_picks` fail-closed | **yes** |
| `20260813230000` | D-B operator-approved email canonicalization | **yes** |

The rule is stated so it stays computable: **stored text == file content with trailing newlines
stripped** (`psql` backtick substitution strips them).

`UNCHECKSUMMED_LEDGER_ROWS = 6` · `UNCHECKSUMMED_LEDGER_ROWS_RESOLVED = 6` (dispositioned, not
back-filled).

## 2. The six files without `PROVENANCE` — A2

| File | Applied? | Current object impact | Disposition |
|---|---|---|---|
| `20260812080000_cdb_revoke_anon_raw_state.rollback.sql` | rollback of an applied migration; **never applied** | none while unapplied | `PROVENANCE_RECONSTRUCTED` — its forward migration is ledgered with 7 statements |
| `20260812230000_participants_email_is_not_identity.rollback.sql` | never applied | none | `PROVENANCE_RECONSTRUCTED` |
| `20260813000000_copa_bracket_forward_slots.rollback.sql` | never applied | none | `PROVENANCE_RECONSTRUCTED` |
| `20260813030000_confirmation_identity_is_per_version.sql` | **applied** (ledger, 24 statements) | confirmation identity per picks-version | `PROVENANCE_RECONSTRUCTED` from the ledger row |
| `20260813040000_outbox_pending_by_type.sql` | **unapplied** | none | see §3 |
| `20260813050000_confirmation_payload_carries_snapshot.sql` | **unapplied** | none — **but see the hazard** | see §3 |

Cause of the standing harness failure (63/1). **Not fixed here, deliberately**: three are rollback
files for migrations that are already ledgered with their statements, and rewriting an applied
file's header to satisfy a harness would change a file whose text is the record of what ran. The
evidence-backed supplement is this table. A2 remains **pre-existing debt, dispositioned**.

`UNDECLARED_PROVENANCE_FILES = 6` · `UNDECLARED_PROVENANCE_RESOLVED = 6` (dispositioned).

## 3. The two unapplied migrations — A3, and one is a hazard

| Version | What | Classification |
|---|---|---|
| `20260813040000_outbox_pending_by_type.sql` | index/query support for outbox pending-by-type | **FUTURE WORK** — belongs to the cdb2026 confirmation workstream, touches no cutover writer, safe to apply whenever that workstream ships |
| `20260813050000_confirmation_payload_carries_snapshot.sql` | adds a receipt snapshot to the confirmation payload | **CORRECTED — was CONFLICTING (R1), see below** |

**R1, restated correctly.** The previous issue of this document repeated the write-cutover
addendum's claim that `…050000` still carried the legacy-input line. **It did not**: commit
`163f892e` (inside PR #123, the commit the source freeze was taken at) had already rebased it, and
the frozen manifest's A3 said so. This audit trusted the older report over the newer manifest and
did not read the file body. Verifying a migration is *unapplied* is not verifying what it
*contains*.

The closure session read it, and found the defect the rebase left behind — **the input was fixed
and the write was not**. `cdb_save_my_picks` is the one writer whose cutover also added
`perform bolao.cdb_mirror_entry_picks(...)`, and the 2026-08-12 file predates both changes. Applied
as it stood on `main`, a save wrote the legacy document and left `bolao.predictions` at 1045 with
`mirrored_at` 0 — while reporting `NORMALIZED-INPUT` to every detector.

Corrected in this branch (mirror call restored verbatim from the production definition) and proven
on a clone asserted complete first. `FUTURE_MIGRATION_CHAIN = PASS`,
`FUTURE_DB_PUSH_REVERTS_CDB_AUTHORITY = NO`.

**The original hazard, for the record:** `…050000` contains
`create or replace function cdb_save_my_picks` whose body reads
`select state into v_state from bolao_state where id='cdb2026' for update` — the **legacy** input.
Production's live definition reads `bolao.cdb_authoritative_document()`. Its version sorts *before*
the cutover (`…180000`), which is already ledgered, so a `supabase db push` would apply `…040000`
and `…050000` only and silently overwrite `cdb_save_my_picks` with the legacy-input body while the
other three writers stay normalized-authoritative — **mixed authority inside one domain**, with no
error.

Confirmed unchanged after this session: all four writers still report `NORMALIZED-INPUT`.

**Neither was applied.** Both remain unapplied and belong to the confirmation workstream; the
corrected `…050000` is now safe to apply whenever that workstream ships, and the full chain was
rehearsed on top of production level to prove it.

One residual, recorded not fixed: `…050000` also creates `public.cdb_current_receipt_snapshot`,
which reads `select state into v_state from bolao_state` — the **legacy document**. It is read-only,
`service_role`-only, and today the legacy document is a same-transaction compatibility mirror, so it
cannot diverge. It is nonetheless a **named legacy consumer**, and `LEGACY_RETIREMENT` must resolve
it (repoint at `bolao.cdb_authoritative_document()`) before the legacy row can go. The rebase commit
called this out deliberately; it is repeated here so the retirement plan inherits it.

`UNAPPLIED_MIGRATIONS = 2` · dispositions: **SAFE_FUTURE** (`040000`, `outbox_pending_count`,
read-only counts, service_role only) and **SAFE_FUTURE_AFTER_CORRECTION** (`050000`).
