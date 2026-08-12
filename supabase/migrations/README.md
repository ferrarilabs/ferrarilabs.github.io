# `supabase/migrations/` — migration source of truth

**Established:** 2026-08-07 (T1, operator-authorized). **Ratified by decision A3.**

## Status of this directory

| Fact | Value |
|---|---|
| Source of truth for database evolution | **YES** — this directory, per A3 |
| Anything applied to production from here | **NO** — nothing has been applied |
| Anything recorded in `supabase_migrations.schema_migrations` | **NO** — T3 is not authorized |
| Baseline present | `BASELINE_current_production_state.reference.sql` |

## Why the baseline is a a non-CLI-recognised reference file

Six legacy RLS policies embed three literal row identifiers. Operator restriction: **privately
captured literals must not be substituted into a Git-tracked file.** They therefore appear as psql
variables and the file is deliberately **not executable as committed**. See `DEPLOYMENT.md` for the
substitution mechanism and `PRIVATE_LITERALS.md` for their classification and recommended future
treatment.

## Rules for this directory

1. **Filenames:** `<utc_timestamp>_<snake_case_description>.sql` (Supabase CLI convention). This is
   part of resolving finding R-03 — the previous `001_`/`002_` numbering mapped to nothing in the
   ledger. See `docs/bolao/db-modernization/NAMING_STANDARDS.md` R3.
2. **The baseline describes production as-is, defects included.** Remediation is a *later* migration,
   never an edit to the baseline. Editing the baseline to "fix" production makes the drift
   untraceable.
3. **Legacy SQL is forensic reference only.** `bolao/loterias/powerball/scripts/supabase_setup.sql`
   and `migrations/001..004_*.sql` in `ferrarilabs-visual-framework-powerball-admin` are **not**
   sources of truth. They declare 7 tables production does not have and 5 tables that exist nowhere.
4. **No secret, PII, participant datum, payment reference, credential, or private configuration value
   may be committed here** — including to make a file executable.

## Not yet done (requires separate authorization)

- **T3** — recording the baseline in `supabase_migrations.schema_migrations`. A **production write**.
  See `docs/bolao/db-modernization/T3_LEDGER_ADOPTION_ANALYSIS.md` for the mechanism comparison and
  recommendation. **R-03 does not close until T3 completes.**
- Applying or executing the baseline anywhere.
- Migrating or deleting legacy SQL (steps T4–T8 of the A3 transition plan).
