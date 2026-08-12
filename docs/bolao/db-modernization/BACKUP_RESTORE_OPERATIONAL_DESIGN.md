# BACKUP_RESTORE_OPERATIONAL_DESIGN — executable procedure design

**STATUS:** Design complete. **First logical backup EXECUTED and verified (§8).** Restore rehearsal
**NOT started** — design refined with exact acceptance criteria in §11. No production write.
**EVIDENCE BASIS:** `pg_dump` 18.4 / server PostgreSQL 17.6 (**version skew — see §2.1**); Phase 1/1B
object inventory (7 tables, 3 enums, 1 function, 6 policies, 17 FKs, 8 indexes, ~500 KB total,
0 large objects, 0 replication slots, 0 subscriptions); `DDL_BASELINE_AND_R03_RESOLUTION.md` for what
`pg_dump` omits.
**KNOWN GAPS:** Supabase's managed PITR window and provider backup mechanism were **not** inventoried
(needs console access, not granted) — `PHASE0_BACKUP_GATES.md` G1 remains open. No restore has ever
been attempted, so all timings are estimates.
**ASSUMPTIONS:** restore target is a **separate scratch Supabase project**, never in-place.

> **Relationship to `PHASE0_BACKUP_GATES.md`:** that document defines *what must be true* (8 gates)
> and is frozen and authoritative. This document defines *the exact commands and acceptance criteria*
> to satisfy G2–G6. It does not restate the gates.

---

## 0. Correction accepted: backup mechanics vs. reproducibility

An earlier statement in this programme said the logical backup was "blocked" until `bolao_state` and
`ensure_rls` DDL were captured into version control. **That was wrong and is corrected here.**

`pg_dump` reads the live catalog. It does not consult the repository. A logical backup is therefore
**technically restorable with no versioned DDL whatsoever** — the dump carries its own DDL.

The correct distinction:

| Property | Requires versioned DDL? |
|---|---|
| `pg_dump` → `pg_restore` mechanics | **NO** |
| Restoring to a known-good, *reviewed* state | **NO** (the dump is self-contained) |
| **Reproducibility** — rebuilding from source of truth | **YES** |
| **Auditability** — proving what production *should* be | **YES** |
| **Divergence detection** — is production what we intended? | **YES** |

**Operational consequence: `BACKUP_GATE_READINESS = READY NOW`.** The baseline capture is a
prerequisite for *auditability*, not for *recoverability*, and holding the backup for it was an
error of sequencing. Take the backup first — it is the cheapest risk reduction available and nothing
gates it.

---

## 1. Backup scope

| Include | Why |
|---|---|
| Schema `public` — all 7 tables, **data included** | The application dataset; ~500 KB |
| 3 enum types, `rls_auto_enable()`, 6 policies, all GRANTs, ownership | Required for a faithful restore |
| **`ensure_rls` event trigger** (captured separately) | `pg_dump --schema=public` **omits it**; without it a restored database behaves differently |
| `supabase_migrations.schema_migrations` | The ledger; needed to reason about provenance |
| Role attributes inventory (reference only, not a role dump) | Grants reference roles that must exist |

| Exclude | Why |
|---|---|
| `auth`, `storage`, `realtime`, `_realtime`, `graphql*`, `extensions`, `pgbouncer`, `_analytics` | Provider-managed; restoring them into a scratch project is wrong and may conflict |
| **`vault` — always** | Secret values. Never dump. |
| Large objects | **0 exist** — verified; `--no-blobs` is safe and explicit |
| Replication slots / subscriptions | 0 exist |

**Note on `auth.users`:** 11 of 17 FKs reference `auth.users(id)`. A `public`-only restore into an
empty project will **fail FK validation** unless the referenced rows exist. Handled in §4.2 — this is
the single most likely cause of a failed first rehearsal and must be planned for, not discovered.

## 2. `pg_dump` invocation

Two artefacts per run: a **custom-format archive** (restorable, selective) and a **plain SQL** copy
(diffable, greppable, human-reviewable).

```
# A. custom format — the restore artefact
pg_dump --format=custom --compress=9 \
        --schema=public \
        --no-blobs --no-subscriptions --no-tablespaces \
        --quote-all-identifiers \
        --serializable-deferrable \
        --file=<PRIVATE>/bolao_public_<UTC>.dump

# B. plain SQL — the review/diff artefact
pg_dump --format=plain --schema=public --quote-all-identifiers \
        --no-subscriptions --no-tablespaces --no-blobs --no-owner \
        --file=<PRIVATE>/bolao_public_<UTC>.sql

# C. schema-only — baseline comparison
pg_dump --schema-only --schema=public --quote-all-identifiers --no-owner \
        --file=<PRIVATE>/bolao_public_schema_<UTC>.sql

# D. objects pg_dump omits — MUST accompany every backup AND be replayed at restore
node scripts/db/backup_scope.mjs --capture   > <PRIVATE>/event_triggers_<UTC>.sql
psql -c "<role attributes query>"     > <PRIVATE>/roles_reference_<UTC>.csv
psql -c "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;" \
                                      > <PRIVATE>/migration_ledger_<UTC>.csv
```

### 2.1 The companion is not optional, and capturing it is only half of it (KPLUS-F012)

**Corrected 2026-08-11.** Every version of this document has listed the event-trigger companion under D
and called it mandatory. That was true and it was not enough: **nothing ever replayed it.** No restore
step read it, no acceptance criterion asserted it, and the one place the rehearsal counted event triggers
was a *containment* probe — a check that the scratch cluster cannot reach anything real, where a count of
zero reads as GOOD. So the single number that would have revealed the loss was being read with the
opposite sign, and every rehearsal was green.

The 2026-08-11 production read measured **7 event triggers in production and 0 in the restored baseline**.

What changed:

| | before | now |
|---|---|---|
| capture | ad-hoc query in this document | `scripts/db/backup_scope.mjs`, one generator |
| restore | *nothing* | replay the companion **after** the archive |
| verify | *nothing* | **A12** — `eventTriggerFidelity()`, compared as a set with attributes |
| rehearsal | counted as a containment side-effect | compared against what the companion declares; **a missing companion is a FINDING, not a pass** |

**Only APPLICATION_OWNED triggers are replayed.** A trigger whose function lives in a provider schema
(`extensions`, `graphql`, `storage`, …) is recorded as a comment and never replayed: Supabase recreates
those itself, and replaying one fails on a bare PostgreSQL target and collides on a managed one.
Restoring everything "for completeness" is the broken option here, not the safe one.

**Replay order is AFTER the archive**, because every function these attach to comes from the schema dump.
`pg_dump --schema=public` carries `public.rls_auto_enable()` perfectly well — it is only the *attachment*
that is lost, which is why the loss is invisible to a function-count check and why the fix is cheap.

**Proven on real PostgreSQL** by `night26_event_trigger_restore.mjs` (15/15), which reproduces the loss
under the pre-fix scope, shows a table created in the restored database landing with **RLS OFF**, then
replays the companion and shows the same probe landing with **RLS ON**. Catalog presence was not accepted
as proof; the guard had to fire.

**Still open for production:** the split of production's seven between application-owned and
provider-managed is **UNKNOWN**. `PROBE-2` counted them; enumerating them is a second production read that
was not authorized. The generator classifies at capture time so it is correct whatever the split is — but
the scope gap cannot be called closed for production until a capture has actually run there.

**Option rationale:**
- `--serializable-deferrable` — a genuinely consistent snapshot without blocking writers. Safe here
  because the dataset is tiny and the app tolerates a brief read-only view.
- **`--no-privileges` deliberately NOT set** (i.e. ACLs *are* dumped). The wide `anon` grants are part
  of what we must be able to restore and reason about. `PHASE0_BACKUP_GATES.md` G6 requires ACL
  reconciliation; stripping them would make that impossible.
- **`--no-owner` is NOT passed to the custom archive, deliberately** (corrected 2026-08-09, BATCH-J-F2).
  `pg_dump` ignores it for archive formats — its help text reads *"skip restoration of object ownership
  in plain-text format"* — and ignores it **silently**, exit 0, no warning. Passing it documents an
  intent the tool does not honour, which is exactly how F2 arose: the flag was passed, dropped on the
  floor, and then recorded in the manifest as though it had taken effect. Ownership is omitted at
  **restore** time instead, by `pg_restore --no-owner`, which is now mandatory and recorded as such.
  It *is* passed to the plain and schema-only artefacts, where it works and where v1 omitted it.
- **`--no-privileges=false` removed — it is not a valid option.** `pg_dump` rejects it outright
  (*"option `--no-privileges' doesn't allow an argument"*), so the command as previously documented
  could never have run. ACLs are included by simply omitting the flag.
- `--quote-all-identifiers` — protects against the policy names containing spaces (`allow anon read`).
- `--no-blobs` — explicit, with 0 large objects verified.

### 2.1 Version skew — must be resolved before the first real backup

**Local `pg_dump` is 18.4; the server is 17.6.** A newer `pg_dump` against an older server is the
*supported* direction and is what should be used — but the resulting **custom-format archive can only
be restored by `pg_restore` 18.x or newer**. If the restore target is a Supabase project running 17.x,
its `pg_restore` will refuse the archive.

**Mitigation (mandatory):** restore using the **same 18.4 client** that produced the dump, or pin both
to a client matching the target's major version. Record the client version inside every backup
manifest. **This is exactly the class of surprise a rehearsal exists to find, and it would have
failed the first attempt.**

## 3. Integrity verification

| # | Check | Acceptance criterion |
|---|---|---|
| V1 | SHA-256 of every artefact, recorded in a manifest | Recomputes identically |
| V2 | `pg_restore --list` on the archive | Lists the expected TOC; non-zero entries; no errors |
| V3 | Object count vs. Phase 1 baseline | 7 tables, 3 types, 1 function, 6 policies, 8 indexes, 17 FKs, 7 PKs |
| V4 | Per-table row counts captured **at dump time** | Recorded in the manifest for §4.4 comparison |
| V5 | Uncompressed size sanity | Within an expected band; a sudden collapse means a partial dump |
| V6 | Plain-SQL artefact contains `ENABLE ROW LEVEL SECURITY` ×7 and `CREATE POLICY` ×6 | Policies preserved |
| V7 | Event-trigger companion file non-empty and names `ensure_rls` | The omission trap is covered |
| V8 | `pg_dump` exited 0 **and** stderr empty | Warnings are failures here |

**V4 is the load-bearing check.** Row counts must be captured *inside the same dump transaction*, not
afterwards; otherwise the comparison in §4.4 compares against a moving target. On a live table taking
532 updates, an after-the-fact count is not evidence.

## 4. Isolated restore rehearsal

### 4.1 Target
A **dedicated scratch Supabase project**, created for the rehearsal and destroyed after.
**Never** the production project. **Never** `--clean` or `--if-exists` against anything that could
resolve to production. Restore credentials must be for the scratch project only; the production
connection profile must not be loaded in the same shell.

### 4.2 `auth.users` strategy — OPERATOR RATIFIED

**Decision: do NOT restore real `auth.users` identities in the first rehearsal.** The goal is to prove
application/database recoverability **without propagating production identities or PII**.

**In scope for restore:** application schema; application tables **and data**; PK/FK/UNIQUE/CHECK;
indexes; sequences; RLS enabled/forced state; policies (sanitized where applicable); application
functions and triggers required for data behaviour.

**Out of scope:** real `auth.users` rows, real operator emails, any authentication identity.

**Mechanism — synthetic identities.** Production has **11 FKs referencing `auth.users(id)`** across 6
tables (`created_by`, `updated_by`, `archived_by`, `actor_user_id`). All 11 are **nullable**, which is
what makes this strategy viable. Two admissible approaches:

1. **Synthetic seed (preferred).** Insert a small set of synthetic `auth.users` rows carrying **only
   the UUIDs actually referenced** by the restored data — no email, no name, no metadata. FKs are then
   validated for real. The UUIDs are already non-identifying opaque values.
2. **Null-out on load.** Set the 4 audit-actor columns to `NULL` during restore. Constraints validate
   trivially, but it **destroys actor attribution**, so the rehearsal proves less.

**Approach 1 is preferred** because it exercises the real constraints, which is most of the point.

**Constraints must NOT be weakened silently.** If any FK cannot be validated, the rehearsal report
must record: the constraint name, why, and the exact deviation. `NOT VALID` is permitted **only** as
an explicitly documented deviation, never as a quiet convenience.

#### Documented dependencies on `auth.users`

| Dependency | Tables | Nullable? | Blocks synthetic strategy? |
|---|---|---|---|
| `created_by` → `auth.users(id)` | pools, participants, participations, draws, payment_transactions | YES | **No** — nullable, and synthetic UUIDs satisfy it |
| `updated_by` → `auth.users(id)` | pools, participants, participations, draws | YES | No |
| `archived_by` → `auth.users(id)` | participants | YES | No |
| `actor_user_id` → `auth.users(id)` | admin_audit | YES | No |
| RLS policies referencing caller identity | **none** — DR-1 proved **0 of 6** policies reference `auth.uid`/`auth.role`/`auth.jwt` | — | **No** |
| `rls_auto_enable()` / `ensure_rls` | fires on DDL only; no `auth` dependency | — | No |

**Conclusion: nothing blocks the synthetic-identity strategy.** This is a direct dividend of DR-1 — had
any policy been identity-aware, restoring without real `auth.users` would have changed RLS behaviour
and invalidated the rehearsal. Because none is, application authorization behaviour is **unaffected**
by substituting synthetic identities.

**Explicitly deferred:** full `auth` schema disaster recovery (real identities, sessions, MFA factors,
identity providers) is a **separate, later rehearsal** with its own PII controls. This rehearsal proves
*application* recoverability only, and the report must say so rather than implying full DR coverage.

### 4.3 Sequence
1. Create scratch project; record its version.
2. Restore schema only; verify object counts (V3).
3. Apply the event trigger companion file — **or deliberately skip it and record the difference**.
4. Seed minimal `auth.users` IDs per §4.2.
5. Restore data.
6. Validate all constraints.
7. Run §4.4 verification.
8. Destroy the scratch project; retain only the report.

### 4.4 Verification queries (read-only, on the restored copy)

| # | Query intent | Acceptance |
|---|---|---|
| R1 | Per-table row counts | **Exactly** equal to V4 |
| R2 | PK/FK/UNIQUE constraint counts | 7 / 17 / 1 |
| R3 | All 17 FKs `convalidated = true` | No `NOT VALID` remaining |
| R4 | Anti-join every FK path for orphans | 0 rows |
| R5 | `relrowsecurity` per table | 7 enabled |
| R6 | Policy count and names | 6, names match |
| R7 | Enum types + label counts | 3 types; 3 / 5 / 3 labels |
| R8 | `external_reference` unique index present and enforcing | duplicate insert rejected |
| R9 | Grant set diff vs. production capture | Differences only those explained by `--no-owner` |
| R10 | `md5` of each policy expression vs. the DR-1 recorded hashes | Identical — proves policies restored byte-for-byte **without ever printing them** |

**R10 is the elegant one:** DR-1 already recorded the md5 of every policy predicate. Comparing hashes
proves faithful restoration while fully respecting the no-print rule.

### 4.5 Acceptance criteria (all mandatory)
R1–R10 pass · zero errors during restore · restore duration recorded · the `auth.users` deviation
explicitly documented · client/server versions recorded · a written report produced even on failure —
**a failed rehearsal that is documented is a successful gate.**

## 5. Storage, encryption, retention, cleanup

| Aspect | Requirement |
|---|---|
| Location | `~/Documents/GitHub/ferrarilabs-work/db-modernization/backups/<UTC>/` — **outside Git, always** |
| Encryption | **Mandatory at rest.** `PHASE0_BACKUP_GATES.md` G3 requires it and it is not implemented. Dumps contain participant names, emails and payment references. `age` or `gpg` symmetric; key **not** stored beside the archive. |
| Existing exposure | `bolao/backups/backup-*.json` are **plaintext PII on a laptop** — the largest unprotected PII concentration in the system (`DATA_GOVERNANCE.md` §5) |
| Manifest | Per run: UTC timestamp, client + server versions, SHA-256 per artefact, row counts, object counts, exact command lines, operator identity |
| Retention | 35 days rolling; **encrypted deletion is the erasure horizon** — a data subject's erasure is only eventual until backups expire (G-03) |
| Cleanup | Scratch project destroyed; local decrypted copies shredded; report retained |
| `.gitignore` | Verify the backups path is ignored **before** the first run |

## 6. RISKS

- **Version skew (§2.1) will fail the first rehearsal** if unaddressed. Highest-probability failure.
- **`auth.users` FKs (§4.2) will fail the first restore** if unplanned. Second-highest.
- **Encryption is specified but unimplemented.** Taking a backup now improves recoverability and
  simultaneously creates another plaintext PII artefact. Encrypt from the first run, not later.
- A restore script does not exist at all (`DEPENDENCY_GRAPH.md` DG-01); §4 is its specification.
- `--serializable-deferrable` can wait for a suitable snapshot. Harmless here; would matter under load.

## 7. NEXT DECISION (operator)

1. **Authorize the first logical backup?** Ready now — nothing gates it (§0).
2. **Encryption tool and key custody** — `age` or `gpg`, and where the key lives.
3. **Approve creating a scratch Supabase project** for the rehearsal (has a cost implication).
4. **Choose the `auth.users` strategy** (§4.2) — must be decided before, not during.

---

## 8. First backup — EXECUTED (2026-08-08T00:51:17Z)

| Field | Value |
|---|---|
| Status | **COMPLETE**, integrity **V1–V8 PASS** |
| Artefacts | custom archive + plain SQL + schema-only + 3 companions + TOC |
| Encrypted archive SHA-256 | `4a57bf0da41c54cf1483763de29549f8156579ddfeae27f4010361399ff0ac1c` |
| Plaintext bundle SHA-256 | `45323a2a3dcb6624fb3e8f4811115f1a11458b86d027160cac9cbaf0e6fa3e1f` (manifest only) |
| Encryption | AES-256-CBC, PBKDF2, 600 000 iterations, salted |
| Decrypt round-trip | **PASS** — byte-identical, 8 tar members intact |
| Plaintext copies | 12 shredded then removed; **0 remain from this run** |
| Production writes | **0** — read-only transactions only |
| TOC reconciliation | 73 entries: 7 TABLE, 7 TABLE DATA, 7 ROW SECURITY, 7 CONSTRAINT (PK), 17 FK CONSTRAINT, 6 POLICY, 3 TYPE, 1 INDEX, 1 FUNCTION, 15 ACL/DEFAULT ACL, 1 SCHEMA, 1 COMMENT |
| Exact row counts (in one READ ONLY SERIALIZABLE txn) | `bolao_state` 3 · `admin_audit` 1 · `draws` 1 · `participants` 10 · `participations` 10 · `payment_transactions` 11 · `pools` 1 |

**Two expectation errors corrected during verification** — the dump was right, my §3 expectations
were wrong:
1. **V3 expected 25 constraints; the dump has 24.** Correct: 7 PK + 17 FK = 24. The unique index is a
   standalone `INDEX`, **not** a `UNIQUE CONSTRAINT` (live catalog: `unique_constraint = 0`,
   `unique_index_not_constraint = 1`). Consequence worth carrying to the target model: **a unique
   index cannot be the target of a foreign key; a unique constraint can.** If anything should ever
   reference `external_reference`, it must be promoted to a constraint.
2. **`FUNCTION` appeared as 2**; that was my grep counting the ACL line as well. Live catalog confirms
   **1** function in `public`.

### 8.1 Encryption posture — correction for future backups

AES-256-CBC via `openssl enc` is **unauthenticated**: it provides confidentiality but no integrity,
so tampering is not detectable by the cipher itself. Integrity here rests on the SHA-256 recorded in
the manifest, which is adequate but external to the ciphertext.

**Recommendation for all future backups: use authenticated encryption** — `age` (preferred:
modern, simple, recipient-based) or GPG, or AES-256-GCM. **This does not invalidate the current
backup**, whose integrity is independently established by manifest hashes and a verified decrypt
round-trip. Change the mechanism going forward; do not re-take the verified backup solely for this.

### 8.2 Key custody

Key written **directly** to a mode-600 file in a directory separate from the archive; never printed,
never logged, never committed. Operator transfers out-of-band. **Status remains
`KEY_CUSTODY = PENDING_OPERATOR_TRANSFER` / `LOCAL_KEY_COPY = PRESENT` until the operator confirms
transfer and local removal** — at which point it becomes `EXTERNAL_OPERATOR_CONTROLLED` /
`LOCAL_KEY_COPY = ABSENT`. This programme does not mark that transition on its own inference.

---

## 9. Pre-existing plaintext backup review (READ ONLY — nothing deleted or modified)

Scope: `~/Documents/GitHub/ferrarilabs-work/backups/full-backup-2026-08-06/private-artifacts/`
**199 files, ~581 MB.** Nothing was deleted, moved, or modified.

| Count | Classification |
|---|---|
| 113 | `REQUIRED_AUDIT_EVIDENCE` — screenshots. **PII risk UNVERIFIED**: images cannot be text-scanned, and several are admin/ranking/entry views that plausibly render participant names. |
| 23 | `REQUIRED_AUDIT_EVIDENCE` — test/regression logs |
| 15 | `DUPLICATE` — copies of `.github/workflows` (5 workflows duplicated across two subfolders) |
| 14 | `REQUIRED_AUDIT_EVIDENCE` — review docs |
| 8 | `DUPLICATE` — persistence code since committed to the repo |
| 6 | `REQUIRED_AUDIT_EVIDENCE` — SHA256SUMS / manifests |
| 6 | `DUPLICATE + UNKNOWN_CONTENTS` — opaque `.zip`/`.bundle` archives of repo history (**~545 MB, 94 % of the total**; one bundle alone is 393 MB) |
| 4 | `REQUIRED_AUDIT_EVIDENCE` — operational records |
| **4** | **`PII_BEARING` → operational record** |
| 2 | `DUPLICATE` — fixtures also in the repo |
| **2** | **`PII_BEARING` → financial import record** |
| **1** | **`PII_BEARING` → `UNKNOWN`** (a 4.2 MB full diff patch) |
| 1 | `REQUIRED_AUDIT_EVIDENCE` — financial import record |

**7 confirmed PII-bearing text files** (paths recorded in the private review output; not restated
here). Largest is a 4.2 MB `full-diff.patch`; the rest are send-logs, a financial import script, its
README, and an invalid-email follow-up.

### 9.1 Findings

- **`SAFE_TO_DELETE_AFTER_ENCRYPTED_REPLACEMENT`: the 6 archives (~545 MB).** They are `DUPLICATE` of
  git history *and* `UNKNOWN_CONTENTS` — opaque to any text scan, and git bundles of this repository
  necessarily contain the tracked PII catalogued in `HARDCODED_DATA_AUDIT.md` H-09. They are the
  largest unprotected PII concentration on disk and the cheapest to remediate, because git history is
  the authoritative copy.
- **The 113 screenshots are the honest unknown.** Classifying them `REQUIRED_AUDIT_EVIDENCE` is right
  (they are visual evidence for a completed review), but their PII status is **UNVERIFIED** and cannot
  be settled by the tooling used here. Admin, ranking and entry views are the likely carriers.
- **Nothing in this directory is `OBSOLETE`.** Every file is either evidence for a completed review, a
  duplicate of something authoritative, or a financial record. There is no debris — which is why the
  recommendation is *encrypt*, not *delete*.
- **This directory is unencrypted**, directly contradicting `PHASE0_BACKUP_GATES.md` G3, and it is
  ~1 100× larger than the encrypted backup taken today.

### 9.2 Recommendation (no action taken)

Encrypt the whole directory as a single archive using the §8.1 mechanism, then remove the plaintext —
**the same treatment applied to today's backup.** Do not delete the audit evidence; it is genuinely
required. Retain the manifests outside the encrypted blob so the contents stay discoverable.

---

## 10. Assessment of the prior `SUPABASE_RESTORE_REHEARSAL.md`

Location: `…/backups/full-backup-2026-08-06/SUPABASE_RESTORE_REHEARSAL.md` (81 lines).

**Does it define a valid restore path?** **Partially, and it was never executed.** Its own header
states "documentation only, NOT executed" and "Status: **not run**".

**Does it contradict DG-01?** **No — it corroborates and refines it.** DG-01 said no restore path
exists, meaning none has been exercised and no automation consumes backups. This document is a
*plan*, never run, with no accompanying script. The refinement worth recording: a documented
intention existed; execution and automation did not.

**Overlap with the design in this document:** substantial and genuinely useful — isolated target,
never-restore-to-production, table/PK/FK/unique validation, row-count comparison against the backup
manifest, RLS verification, functions/triggers, financial reconciliation, evidence capture, teardown.
Its instinct that "a backup file existing is not the same as proving it can be restored" is exactly
right.

**Why it must NOT be reused as-is — four blocking defects:**

| # | Defect | Consequence |
|---|---|---|
| 1 | Assumes a 3-file layout (`roles.sql`, `schema.sql`, `data.sql`) | **Does not match the actual backup**, which is a custom-format archive + plain + schema-only + companions. Its step 2 is not executable against what exists. |
| 2 | Step 9 expects the `admin_*` RPCs **and** an "audit-log append-only trigger" to be recreated | **Production has neither** — 19 RPCs were never applied (R-05) and there are **0 user triggers** (R-04). The step would report FAIL for a *correct* restore. A rehearsal that fails on a wrong expectation is worse than no rehearsal: it discredits the backup. |
| 3 | No mention of the `auth.users` FK problem | 11 nullable FKs reference `auth.users`; this is the most likely first-restore failure and it is unaddressed. |
| 4 | No mention of client/server version skew | `pg_restore` must be 18.x for an 18.4-produced archive; unaddressed. |

**Additional handling notes:** it contains the production project ref **unmasked**, one participant
first name, and specific financial amounts. It must **not** be promoted into Git in its current form.

**Verdict: `PARTIALLY_REUSABLE`.** Reuse its *validation intent* — which is already absorbed into
§4.4/§11 here — and supersede it operationally. Recommend adding a header banner pointing to this
document as authoritative, rather than editing or deleting it (it is dated evidence of what was known
on 2026-08-06).

---

## 11. First restore rehearsal — refined design and exact acceptance criteria

Supersedes §4 where they differ. **Not executed. Requires operator approval to create the target.**

### 11.1 Target
A **dedicated disposable Supabase project**, created solely for this rehearsal and destroyed after.
`SCRATCH_PROJECT_REQUIRED = YES`. Never production. Never `--clean`/`--if-exists` against any target
that could resolve to production. The production connection profile must not be loaded in the same
shell as the restore credentials.

### 11.2 Hard prohibitions during the rehearsal
- **No real `auth.users` identities** — synthetic UUID-only identities (operator-ratified).
- **No outbound email.** EmailJS/provider credentials must be absent from the environment.
- **No scheduler execution.** No workflow, cron or worker may be pointed at the target.
- **No external ESPN/API writes.** No provider sync run.
- **No production endpoint or credential referenced** — asserted explicitly, see A9 below.

### 11.3 Sequence
1. Create disposable project; record its PostgreSQL major version.
2. Verify `pg_restore` major = **18** (satisfied locally: 18.4).
3. Decrypt the backup to a working directory outside Git; verify SHA-256 against the manifest.
4. Restore **schema only**; verify object counts (A1).
5. Apply the `ensure_rls` companion file — **or deliberately skip and record the deviation.**
6. Seed synthetic `auth.users` rows carrying **only the UUIDs referenced** by the data — no email, no
   name, no metadata.
7. Restore **data**.
8. Validate all constraints; no constraint may remain `NOT VALID` without a written deviation.
9. Run acceptance criteria A1–A11.
10. Destroy the project; shred decrypted copies; retain only the report.

### 11.4 Acceptance criteria — ALL must pass

| # | Criterion | Exact expectation |
|---|---|---|
| A1 | Application object counts | 7 tables · 3 enum types · 1 function · 6 policies · 1 unique index · 7 PK · 17 FK |
| A2 | Row counts vs. backup manifest | **Exactly** `bolao_state` 3 · `admin_audit` 1 · `draws` 1 · `participants` 10 · `participations` 10 · `payment_transactions` 11 · `pools` 1 |
| A3 | PK / FK / UNIQUE / CHECK present and **validated** | 24 constraints `convalidated = true`; 0 `NOT VALID` |
| A4 | Referential integrity | Anti-join on all 17 FK paths returns **0 orphans** |
| A5 | Indexes | 8 total (7 PK + 1 unique); unique index **enforces** — a duplicate `external_reference` insert must be rejected |
| A6 | Sequences | Count matches source (**0 in `public`** — corrected 2026-08-09, see BATCH-J-F1) |
| A7 | RLS state | `relrowsecurity = true` on all 7; `relforcerowsecurity = false` on all 7 |
| A8 | Policies restored faithfully | 6 policies; **`md5` of each expression matches the hashes recorded by DR-1** — proves byte-exact restoration **without printing any expression** |
| A9 | No production reference | Grep the restored config/connection surface: **0** occurrences of the production project ref, pooler host, or any production credential |
| A10 | Grants vs. expected baseline | Grant set matches the captured baseline, differing **only** by what `--no-owner` explains |
| A11 | Synthetic identity isolation | `auth.users` in the target contains **only** synthetic rows; **0** rows carry an email or display name |

**A8 is the elegant one:** DR-1 already recorded each policy predicate's md5, so faithful restoration
is provable by hash comparison while fully respecting the no-print rule.

#### 11.4.0 Restore procedure — REHEARSED 2026-08-09, and it takes two passes

The baseline backup has been restored into a proven-disposable PostgreSQL 17.10 cluster and all eleven
criteria evaluated live: **PASS 11 · FAIL 0 · BLOCKED 0**, repeatable across three consecutive runs. See
`RESTORE_REHEARSAL_REPORT.md`.

```
pass 1   pg_restore --no-owner --section=pre-data --section=data --dbname=<EXPLICIT_TARGET> <archive>
         CREATE TABLE auth.users (id uuid PRIMARY KEY);          -- identifiers ONLY
         INSERT the ids the restored rows actually reference       -- no email, no name, no credential
pass 2   pg_restore --no-owner --section=post-data --dbname=<EXPLICIT_TARGET> <archive>
```

Three properties of this procedure are non-negotiable:

- **`--no-owner` is mandatory.** For a custom-format archive the ownership guarantee lives in the restore
  command and nowhere in the artefact (§11.4.1, BATCH-J-F2).
- **Two passes are mandatory.** 11 of the 17 foreign keys reference `auth.users`, which a `public`-scoped
  backup does not contain. A single pass loses **65% of referential integrity while appearing to
  succeed**, because `pg_restore` reports the failures and continues (BATCH-J2-F4).
- **Roles must pre-exist.** The ACLs grant to `anon`, `authenticated`, `service_role`, `postgres` and
  `supabase_admin`. Create them `NOLOGIN`, without passwords, before pass 2.

`CREATE SCHEMA public` always collides and is `BENIGN`: `pg_dump` emits it and every target already has
it. `pg_restore` exits non-zero for that alone, so exit code by itself is not an acceptance signal —
which is why the harness classifies diagnostics instead of trusting `rc`.

### 11.4.1 Corrections from the first evaluation (2026-08-09)

The criteria above were evaluated for the first time by `scripts/db/restore_acceptance.mjs`. Three of
them did not behave as written, and the causes are recorded here rather than smoothed over.

**BATCH-J-F1 — A6's expectation was wrong (documentation defect, corrected above).**
A6 expected "2 sequences in `public`". The archive contains none, and it is right not to: Phase 1B
places both of this database's sequences in `auth` and `realtime`, which are `PROVIDER_MANAGED` and
explicitly outside reconciliation scope, and this backup's scope is *"schema public only; provider
schemas excluded"*. So `public` genuinely holds zero sequences and A6 could never have passed for a
public-only backup. The count is corrected to 0; A6's intent — *"count matches source"* — is unchanged,
and `A6_EXPECTED_PUBLIC_SEQUENCES` in the harness carries the reasoning.

**BATCH-J-F2 — RESOLVED 2026-08-09 (Batch J2). The archive was never defective; the manifest was.**

The manifest recorded `options = --no-owner` and `acl_treatment = owner NOT dumped`, while the archive
carries 12 `ALTER … OWNER TO` statements. Root cause, established by measurement rather than inference:

**`--no-owner` is a plain-text-format option.** `pg_dump --help` says so verbatim — *"skip restoration
of object ownership in plain-text format"* — and when emitting a **custom-format archive** it ignores
the flag **silently**: no warning, exit 0. Ownership lives in the archive TOC by design, because an
archive is a catalog replayed selectively, not a script. Omission belongs to `pg_restore --no-owner`:

| Command on this archive | `ALTER … OWNER TO` emitted |
|---|---|
| `pg_restore -f -` | **12** |
| `pg_restore --no-owner -f -` | **0** |

Three consequences follow, and the second is the one that changed this batch's plan:

1. A custom-format archive containing ownership is **correct**. The artefact needs no repair.
2. **Reissuing the backup could not have fixed F2.** Any custom-format dump contains the same ownership
   metadata whatever flags it is given, so a replacement backup would have reproduced the finding exactly
   — while requiring a production read to do it. No replacement backup was taken, and none was needed.
3. `--no-owner` *was* absent from the plain and schema-only artefacts, where it does work. That is why
   both text companions carry ownership. The flag was present where it was ignored and absent where it
   would have taken effect.

A fourth defect surfaced while confirming this: the command recorded above previously included
`--no-privileges=false`, which `pg_dump` **rejects** (*"option `--no-privileges' doesn't allow an
argument"*). The documented command could never have run as written, so the command that produced the
bundle was not the command in this document. Both are corrected in §2.

**Remediation was structural, not cosmetic.** The enabling condition was a single bundle-wide `options`
line describing artefacts built by three different commands — a format in which the false claim was
unavoidable.

- `model/backup_contract.json` **v2** declares flags and ownership behaviour **per artefact**, and records
  why `--no-owner` is deliberately omitted for the custom archive.
- `verifyManifestClaims()` rejects the original manifest's exact shape: a bundle-wide options line
  (`STRUCTURAL`), an ownership claim contradicted by the archive (`FALSE_CLAIM`), and a missing
  `--no-owner` restore command (`MISSING_GUARANTEE`).
- **A10 now checks the property that actually protects the restore** — `pg_restore --no-owner` emitting
  zero ownership statements — instead of counting statements in the archive, which was unsatisfiable.
  This is a stronger criterion, verified at the point where the guarantee is really made. A10 **PASSES**.
- The original manifest is corrected by an additive `MANIFEST.ERRATA.md` beside it. `MANIFEST.txt`
  itself is byte-unchanged: it is immutable evidence.

`pg_restore --no-owner` is now **mandatory** and recorded in the contract. Without it, ownership
statements naming `postgres` abort on a cluster lacking that role, or silently assign ownership the
rehearsal never intended to grant.

**A8 is BLOCKED offline, not failed.** DR-1 recorded `md5(coalesce(qual,''))` — the md5 of the
*catalog's* rendering of each predicate. `pg_dump` emits its own formatting of the same expression
inside `CREATE POLICY`, so the archive text and the catalog text hash differently even when the
predicate is identical, and 0 of 8 archive-text digests coincide with the recorded set. That is
expected and says nothing about fidelity. A8 is a catalog-to-catalog comparison and needs the restored
catalog; hashing the archive text instead would be answering an easier question than the one asked. The
harness compares against `liveCatalog.policyDigests` when a live target exists, and reports BLOCKED
when it does not.

### 11.5 Explicit failure handling
A rehearsal that fails is a **successful gate** if documented. Record: duration, every error (including
worked-around ones), each deviation with its constraint name and reason, and client/server versions.
Do **not** weaken a constraint to obtain a pass.

### 11.6 Scope statement required in the report
This rehearsal proves **application** recoverability only. It does **not** prove full Supabase
disaster recovery: `auth` identities, sessions, MFA factors, identity providers, Storage objects and
provider schemas are all out of scope and remain unrehearsed. The report must say so explicitly rather
than implying full DR coverage.
