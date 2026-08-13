<!-- FDC-20260813-140645Z · no raw PII -->

# MIGRATION LEDGER AND PROVENANCE AUDIT

Ledger **46 → 48** (this session added two, both **with** `statements` and `rollback`).

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

| Version | Ledger `sha256(statements[1])` | Repo file (trailing newline stripped) | Match |
|---|---|---|---|
| `20260813200000` | `0a2e2d0bde528fb5…` | `0a2e2d0bde528fb5…` | **yes** |
| `20260813210000` | `3e628eab013457f6…` | `3e628eab013457f6…` | **yes** |

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
| `20260813050000_confirmation_payload_carries_snapshot.sql` | adds a receipt snapshot to the confirmation payload | **CONFLICTING — HAZARD (R1), still open** |

**R1 re-verified in this audit and still true.** `…050000` contains
`create or replace function cdb_save_my_picks` whose body reads
`select state into v_state from bolao_state where id='cdb2026' for update` — the **legacy** input.
Production's live definition reads `bolao.cdb_authoritative_document()`. Its version sorts *before*
the cutover (`…180000`), which is already ledgered, so a `supabase db push` would apply `…040000`
and `…050000` only and silently overwrite `cdb_save_my_picks` with the legacy-input body while the
other three writers stay normalized-authoritative — **mixed authority inside one domain**, with no
error.

Confirmed unchanged after this session: all four writers still report `NORMALIZED-INPUT`.

**Neither was applied here.** `…050000` must be rebased onto the inverted definition (keep the
receipt-snapshot feature, keep the normalized input) and re-verified with the authority probe —
blank the legacy `cutoffAt`, expect `CUTOFF_PASSADO`, not `FASE_FECHADA` — before that workstream
deploys. Owned by that workstream. This is a **legacy-retirement prerequisite**: retiring the legacy
document with a queued migration that reintroduces a legacy read would be worse than the hazard is
today.

`UNAPPLIED_MIGRATIONS = 2` · dispositions: **FUTURE_WORK**, **CONFLICTING_MUST_REBASE**.
