-- NOT FOR PRODUCTION APPLY
-- REVIEW DRAFT ONLY
-- REQUIRES M0 + RESTORE REHEARSAL + EXPLICIT OPERATOR AUTHORIZATION
--
-- GENERATED FILE — do not edit by hand.
-- Source: model/target_model.json + model/access_model.json
-- Regenerate: node scripts/db/generate_migration_drafts.mjs --write
--
-- This file is deliberately NOT in supabase/migrations/ and its name is not CLI-recognisable,
-- so `supabase db push` cannot see it. Applying it requires copying it elsewhere on purpose.

-- ============================================================
-- M3 — competitions and editions
-- ============================================================
--
-- PURPOSE. Reference data for the three competitions and their editions. Hand-authored rows, never derived
--  from bolao_state, which has no competition entity at all.
--
-- DEPENDENCIES: M2
-- TABLES CREATED: bolao.competitions, bolao.competition_editions
--
-- LOCK RISK. CREATE TABLE / CREATE TYPE take no lock on any existing object, so concurrent traffic is
--  unaffected. FKs do take a brief ACCESS EXCLUSIVE lock on the REFERENCED table while the constraint is
--  registered — participants and pools are referenced here — but that is catalogue-only and does not scan.
--  Every index is built CONCURRENTLY outside the transaction. Expected worst-case lock on a live object: a
--  sub-millisecond catalogue lock on referenced parents.
-- TABLE REWRITE RISK. NONE. This phase creates new tables only; it never ALTERs an existing one, so no
--  rewrite is possible.
-- INDEX BUILD STRATEGY. CREATE INDEX CONCURRENTLY, one statement per index, each outside a transaction
--  block. A concurrent build can fail and leave an INVALID index that is still maintained on write, so the
--  postchecks assert pg_index.indisvalid for every index created here.
-- CONSTRAINT VALIDATION STRATEGY. FKs, UNIQUEs and CHECKs are declared INLINE in CREATE TABLE and are
--  therefore validated immediately. That is correct and deliberate HERE and only here: the table is brand
--  new and empty, so validation scans zero rows and the NOT VALID / VALIDATE two-step would add ceremony
--  with no benefit. Any LATER migration that adds a constraint to a POPULATED table must use ADD CONSTRAINT
--  ... NOT VALID followed by a separate VALIDATE CONSTRAINT, because a plain ADD holds a lock for the whole
--  scan — the static analyser enforces that distinction.
-- RLS EFFECT. Every table is created with RLS ENABLED and ZERO policies, which in PostgreSQL denies all
--  access to everyone except table owners and BYPASSRLS roles. Policies are a separate, later migration.
--  This ordering is deliberate: a table that exists without RLS, even briefly, is an exposure window.
-- ACL EFFECT. No GRANT is issued. Default privileges are revoked from PUBLIC. anon and authenticated
--  receive nothing in this phase. Intended eventual access: competitions[anon:SELECT],
--  competition_editions[anon:SELECT]
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. insert the known competitions and editions as reference data
-- APPLICATION COMPATIBILITY. TOTAL — additive.
-- ROLLBACK STRATEGY (FULL). FULL. DROP TABLE competition_editions then competitions, in that order because
--  the FK points that way. Safe while no pool references an edition, which is true until M4 runs. The
--  reference rows are hand-authored and re-insertable from the same source, so nothing is lost.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M2 is recorded as applied
--   2. none of the tables this phase creates already exists
--   3. a verified backup exists (restore_rehearsal.mjs preflight green)
--   4. acceptance_checks.mjs structural counts match the recorded expectation
--   5. supabase db diff is EMPTY before starting
-- POSTCHECKS (all READ_ONLY):
--   1. every table exists with RLS enabled and zero policies
--   2. every FK and CHECK reports convalidated = true
--   3. every index reports indisvalid = true
--   4. no GRANT exists to anon or authenticated on any new table
--   5. prePostValidate reports no UNACCOUNTED change
-- FAIL-CLOSED CONDITIONS (stop, do not improvise):
--   · any precheck fails
--   · a table already exists (this phase was partially applied — establish state first)
--   · an index reports indisvalid = false (drop it CONCURRENTLY and retry; do not proceed)
--   · db diff is non-empty afterwards in any way not declared above
--   · any statement errors — the transaction aborts and nothing is left half-created

BEGIN;

CREATE TABLE bolao."competitions" (
  "competition_id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
  "slug"                             text NOT NULL,
  "name"                             text NOT NULL,
  "sport"                            text NOT NULL DEFAULT 'football',
  "kind"                             bolao.competition_kind NOT NULL,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "competitions_pkey" PRIMARY KEY ("competition_id"),
  CONSTRAINT "competitions_slug_key" UNIQUE ("slug")
);

COMMENT ON TABLE bolao."competitions" IS 'The durable tournament (e.g. ''Copa do Brasil''), independent of any year.';

ALTER TABLE bolao."competitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."competitions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."competitions" FROM PUBLIC;

CREATE TABLE bolao."competition_editions" (
  "competition_edition_id"           uuid NOT NULL DEFAULT gen_random_uuid(),
  "competition_id"                   uuid NOT NULL,
  "season_label"                     text NOT NULL,
  "season_start_year"                integer NOT NULL,
  "status"                           bolao.edition_status NOT NULL DEFAULT 'planned',
  "starts_on"                        date,
  "ends_on"                          date,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "competition_editions_pkey" PRIMARY KEY ("competition_edition_id"),
  CONSTRAINT "competition_editions_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES bolao."competitions" ("competition_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ce_dates_ordered" CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
);

COMMENT ON TABLE bolao."competition_editions" IS 'One running of a competition (e.g. ''Copa do Brasil 2026''). The unit that makes year-over-year reporting possible.';
-- CHECK ce_dates_ordered: an edition cannot end before it starts

ALTER TABLE bolao."competition_editions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."competition_editions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."competition_editions" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- one edition per competition per season; also the year-over-year join key
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "competition_editions_competition_id_season_start_year_uidx" ON bolao."competition_editions" (competition_id, season_start_year);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['competition_editions_competition_id_season_start_year_uidx']);
-- Expected: zero rows.
