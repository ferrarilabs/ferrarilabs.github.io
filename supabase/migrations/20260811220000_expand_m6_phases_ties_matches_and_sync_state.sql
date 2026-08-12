--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260811220000_expand_m6_phases_ties_matches_and_sync_state.sql
--
-- EXPAND stage M6 — phases, ties, matches and sync state
--
-- ADDITIVE ONLY. This stage creates new objects in new schemas. It does not ALTER, DROP or read any
-- legacy object, so legacy remains authoritative and fully available for fast rollback.
--
-- GENERATED. The body below is emitted byte-for-byte by
-- `scripts/db/generate_migration_drafts.mjs` from model/target_model.json + model/access_model.json,
-- and promoted by `scripts/db/promote_expand_stage.mjs`. Do not edit it here: run
-- `node scripts/db/promote_expand_stage.mjs --check` and it will tell you this file has drifted from
-- the model. Fix the model or the generator, then re-promote.
--
-- ROLLBACK (FULL). FULL. DROP TABLE sync_state, matches, ties, competition_edition_phases. No dependent rows exist until M7, and every row is re-derivable from reference data or from the provider, so a rollback loses only the sync cursor position — which is designed to be restartable.
--
-- ============================================================
-- M6 — phases, ties, matches and sync state
-- ============================================================
--
-- PURPOSE. Competition structure and the provider sync cursor. cutoff_at lives here and is what makes the
--  prediction lock enforceable server-side.
--
-- DEPENDENCIES: M5
-- TABLES CREATED: bolao.competition_edition_phases, bolao.ties, bolao.matches, bolao.sync_state
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
--  receive nothing in this phase. Intended eventual access: competition_edition_phases[anon:SELECT],
--  ties[anon:SELECT], matches[anon:SELECT], sync_state[anon:none]
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. phases and fixtures from reference data; sync_state initialised with no
--  last_success_at
-- APPLICATION COMPATIBILITY. TOTAL — additive.
-- ROLLBACK STRATEGY (FULL). FULL. DROP TABLE sync_state, matches, ties, competition_edition_phases. No
--  dependent rows exist until M7, and every row is re-derivable from reference data or from the provider,
--  so a rollback loses only the sync cursor position — which is designed to be restartable.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M5 is recorded as applied
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

CREATE TABLE bolao."competition_edition_phases" (
  "competition_edition_phase_id"     uuid NOT NULL DEFAULT gen_random_uuid(),
  "competition_edition_id"           uuid NOT NULL,
  "slug"                             text NOT NULL,
  "ordinal"                          integer NOT NULL,
  "cutoff_at"                        timestamptz,
  "cutoff_offset_ms"                 bigint,
  "topology"                         jsonb,
  "draw_state"                       text,
  CONSTRAINT "competition_edition_phases_pkey" PRIMARY KEY ("competition_edition_phase_id"),
  CONSTRAINT "competition_edition_phases_competition_edition_id_fkey" FOREIGN KEY ("competition_edition_id") REFERENCES bolao."competition_editions" ("competition_edition_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."competition_edition_phases" IS 'A phase within an edition (oitavas, quartas, …) carrying its own entry cutoff. Gives the deadline exactly ONE home, closing J-05''s two-sources-of-cutoff problem.';

ALTER TABLE bolao."competition_edition_phases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."competition_edition_phases" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."competition_edition_phases" FROM PUBLIC;

CREATE TABLE bolao."ties" (
  "tie_id"                           uuid NOT NULL DEFAULT gen_random_uuid(),
  "competition_edition_phase_id"     uuid NOT NULL,
  "slug"                             text NOT NULL,
  "team_a"                           text,
  "team_b"                           text,
  "qualified_side"                   char(1),
  "provenance"                       jsonb,
  "predecessor_tie_id"               uuid,
  CONSTRAINT "ties_pkey" PRIMARY KEY ("tie_id"),
  CONSTRAINT "ties_competition_edition_phase_id_fkey" FOREIGN KEY ("competition_edition_phase_id") REFERENCES bolao."competition_edition_phases" ("competition_edition_phase_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ties_predecessor_tie_id_fkey" FOREIGN KEY ("predecessor_tie_id") REFERENCES bolao."ties" ("tie_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "tie_no_self_predecessor" CHECK (predecessor_tie_id IS NULL OR predecessor_tie_id <> tie_id),
  CONSTRAINT "tie_distinct_teams" CHECK (team_a IS NULL OR team_b IS NULL OR team_a <> team_b)
);

COMMENT ON TABLE bolao."ties" IS 'A two-legged knockout tie. CONTAINS matches and carries aggregate/qualification rules — a tie is NOT a match, and collapsing them would lose the aggregate.';
-- CHECK tie_no_self_predecessor: a tie cannot precede itself
-- CHECK tie_distinct_teams: a team cannot play itself

ALTER TABLE bolao."ties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."ties" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."ties" FROM PUBLIC;

CREATE TABLE bolao."matches" (
  "match_id"                         uuid NOT NULL DEFAULT gen_random_uuid(),
  "tie_id"                           uuid,
  "competition_edition_phase_id"     uuid NOT NULL,
  "provider_match_ref"               text,
  "leg"                              integer,
  "home_team"                        text NOT NULL,
  "away_team"                        text NOT NULL,
  "kickoff_at"                       timestamptz,
  "status"                           bolao.match_status NOT NULL DEFAULT 'scheduled',
  CONSTRAINT "matches_pkey" PRIMARY KEY ("match_id"),
  CONSTRAINT "matches_tie_id_fkey" FOREIGN KEY ("tie_id") REFERENCES bolao."ties" ("tie_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "matches_competition_edition_phase_id_fkey" FOREIGN KEY ("competition_edition_phase_id") REFERENCES bolao."competition_edition_phases" ("competition_edition_phase_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "match_distinct_teams" CHECK (home_team <> away_team)
);

COMMENT ON TABLE bolao."matches" IS 'A single fixture. Named ''match'' not ''fixture'' because ''fixture'' already means test fixture in this repository.';
-- CHECK match_distinct_teams: a team cannot play itself

ALTER TABLE bolao."matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."matches" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."matches" FROM PUBLIC;

CREATE TABLE bolao."sync_state" (
  "sync_state_id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
  "provider"                         text NOT NULL,
  "competition_edition_id"           uuid NOT NULL,
  "active_phase_id"                  uuid,
  "cursor"                           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "seed_flags"                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_success_at"                  timestamptz,
  "last_error_at"                    timestamptz,
  "last_error_category"              text,
  CONSTRAINT "sync_state_pkey" PRIMARY KEY ("sync_state_id"),
  CONSTRAINT "sync_state_competition_edition_id_fkey" FOREIGN KEY ("competition_edition_id") REFERENCES bolao."competition_editions" ("competition_edition_id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "sync_state_active_phase_id_fkey" FOREIGN KEY ("active_phase_id") REFERENCES bolao."competition_edition_phases" ("competition_edition_phase_id") ON DELETE SET NULL ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."sync_state" IS 'Provider synchronisation cursor. Gives espnSync a home — it currently lives inside the state document with nowhere else to go.';

ALTER TABLE bolao."sync_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."sync_state" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."sync_state" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- one phase per slug per edition
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "competition_edition_phases_competition_edition_id_slug_uidx" ON bolao."competition_edition_phases" (competition_edition_id, slug);
-- phase order must be unambiguous for transition validation
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "competition_edition_phases_competition_edition_id_ordinal_uidx" ON bolao."competition_edition_phases" (competition_edition_id, ordinal);
-- one tie per slug per phase
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ties_competition_edition_phase_id_slug_uidx" ON bolao."ties" (competition_edition_phase_id, slug);
-- walk the bracket forward
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ties_predecessor_tie_id_idx" ON bolao."ties" (predecessor_tie_id) WHERE predecessor_tie_id IS NOT NULL;
-- 'matches in this tie' — aggregate computation
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_tie_id_idx" ON bolao."matches" (tie_id) WHERE tie_id IS NOT NULL;
-- phase listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_competition_edition_phase_id_idx" ON bolao."matches" (competition_edition_phase_id);
-- idempotent provider sync — prevents double-ingesting one fixture
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "matches_provider_match_ref_uidx" ON bolao."matches" (provider_match_ref) WHERE provider_match_ref IS NOT NULL;
-- 'matches today' for the result-email cron
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_kickoff_at_idx" ON bolao."matches" (kickoff_at);
-- one cursor per provider per edition
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "sync_state_provider_competition_edition_id_uidx" ON bolao."sync_state" (provider, competition_edition_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['competition_edition_phases_competition_edition_id_slug_uidx', 'competition_edition_phases_competition_edition_id_ordinal_uidx', 'ties_competition_edition_phase_id_slug_uidx', 'ties_predecessor_tie_id_idx', 'matches_tie_id_idx', 'matches_competition_edition_phase_id_idx', 'matches_provider_match_ref_uidx', 'matches_kickoff_at_idx', 'sync_state_provider_competition_edition_id_uidx']);
-- Expected: zero rows.
