# Integration record — how this corpus reached `main`

**Date:** 2026-08-12 · **Branch:** `final-integration-20260812` · **Base:** `origin/main` @ `5db54951`

This file exists so a maintainer who never saw the campaign can answer three questions without
archaeology: where did `scripts/db/` and `model/` come from, why are the migrations here but not
"added" by this change, and what must never be undone.

---

## 1. Where this came from

The database modernization campaign ran on `db-modernization-architecture`, a branch that
accumulated **113 commits and was never pushed**. Its content was integrated into `main` by porting
the **minimum complete semantic set**, not by merging the branch.

Integrated (absent from `main` before):

| Path | What |
|---|---|
| `model/*.json` | Target model, access model, RLS model, migration phases and choreography, write contracts |
| `scripts/db/**` | Generators, transformers, migration harness, privilege model, concurrency/integrity labs, 39 test suites |
| `scripts/gates.mjs` | The campaign's gate runner (propagates exit status; a pipe once let a commit past a red gate) |
| `docs/bolao/db-modernization/**` | ADR-K01..K11, matrices, data dictionary, ERD, migration drafts |
| `docs/bolao/adr/ADR-006..010` | Architecture decisions that `main` lacked |

---

## 2. Why the migrations are here but were not added by this change

**`supabase/migrations/` was already complete on `main` before this integration.** Every migration
file on the campaign branch was byte-for-byte identical to `main`'s, and `main` had **five more**
that the branch never saw, from a concurrent workstream.

> Copying the branch's migration directory over `main` would have **deleted five applied production
> migrations** from versioned history. On that one directory the campaign branch is *behind*, not ahead.

This integration therefore added **no migration**. It made two comment-level corrections:

1. **PROVENANCE headers on 7 files.** `scripts/db/migration_harness.mjs` requires every file in
   `supabase/migrations/` to declare its provenance; seven concurrent-workstream migrations declared
   none. All seven were confirmed present in the production ledger by a `BEGIN READ ONLY` query
   *before* the declaration was written, so `MIGRATION_APPLIED_HISTORICALLY` is verified fact.
   Comments only — `migration_drift.mjs` strips comments before structural comparison, so drift
   detection is unaffected.

2. **A rollback plan for `20260812080000_cdb_revoke_anon_raw_state`.** See §3.

**Do not** rename, renumber, merge, re-time or re-apply any file in `supabase/migrations/`. They
describe history that already happened.

---

## 3. The rollback plan that refuses

`20260812080000_cdb_revoke_anon_raw_state.sql` classifies as `DESTRUCTIVE_DDL` because it uses
`drop policy … create policy` to narrow anon scope. The harness requires a rollback plan beside any
destructive migration.

`20260812080000_cdb_revoke_anon_raw_state.rollback.sql` is that plan, and it is a **refusal**.
Reverting the migration re-opens anonymous reads of participant email, payer name and payment method
for the 12 CDB2026 participants — the Q38 regression the platform closed. The file documents the
measured exposure and raises an exception if executed.

It never enters the migration ledger (`.rollback.sql` is in `NON_MIGRATION_SUFFIXES`), and nothing in
this repository applies migrations automatically: there is no CI running `db push`; the procedure is
a manual `psql -f` against an explicitly named file.

---

## 4. The two migration channels (ADR-K10) — still two

| Channel | Location | Enters the ledger? |
|---|---|---|
| A — campaign | `supabase/migrations/` (`bolao.*`, `audit.*`) | Yes |
| B — product | `bolao/shared/sql/NNN_*.sql` (`public.*`) | No, by ADR-K10 |

Both write the same production database, deliberately and separately. This integration
**preserved both and invented no third**. ADR-K10 is described, not remediated — that remains its
recorded state. Do not "tidy" an applied migration from one channel into the other.

---

## 5. The PII engine is one engine now

`scripts/audit_pii_repo_wide.mjs` was edited by both workstreams for different, individually correct
reasons. The reconciliation kept the campaign's refactor (thin CLI + testable engine in
`scripts/pii_detectors.mjs`) and ported `main`'s three hardenings into the engine:

- `@email.com` removed from the reserved-suffix allowlist — it is a **live webmail domain** and
  allowlisting it suppressed 11 real addresses;
- the `lottery-ticket-serial` detector, plus `DECLARED_EXPOSURES` as a central path-keyed map;
- `mask()` as a short sha256 digest, revealing no character of the value.

The CLI re-exports `isAllowedEmail`, `mask` and `ALLOWED_EMAIL_SUFFIXES` under `main`'s names so
`scripts/test_audit_pii_repo_wide.mjs` keeps passing unmodified — that suite is what locks the
`@email.com` invariant. **Do not "simplify" those re-exports away.**

---

## 6. The DB gates are registered but standalone — and there is a trigger

The 40 suites under `scripts/db/` are classified `INTENTIONALLY_STANDALONE_WITH_REASON` in
`bolao/scripts/gate_registry.json`. They **are** executed, by `node scripts/gates.mjs`, but not by
the site's aggregator, because the code they guard is not yet on the production path
(`READ_CUTOVER = NO`, `WRITE_CUTOVER = NO`).

> **Promotion trigger, written into every one of those registry entries:** the moment either cutover
> flips to YES, these gates start protecting production and must become `REGISTERED_AND_EXECUTED` —
> added to `package.json` **and** `scripts/verify.mjs`.

`scripts/test_pii_detectors.mjs` is the exception and is already `REGISTERED_AND_EXECUTED`: the
engine it guards is load-bearing for the live PII gate.

---

## 7. What this integration did not do

- No merge of the 113-commit branch; that branch is untouched and still unpushed.
- No application code change. The diff against `origin/main` for `bolao/` and `.github/` is empty
  apart from gate registration.
- No scoring, tournament rule or business-semantics change.
- No cutover. No production mutation. No legacy drop, delete, truncate or restore.
- No resolution of Q33-A1, Q39-A1 or KPLUS-OP-4 — those are operator decisions and remain parked.
