--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260811230000_expand_m7_match_results_and_predictions.sql
--
-- EXPAND stage M7 — match results and predictions
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
-- ROLLBACK (FULL). FULL — DROP TABLE; predictions is empty and match_results is re-derivable from the document.
--
-- ============================================================
-- M7 — match results and predictions
-- ============================================================
--
-- PURPOSE. match_results (superseded, never overwritten) and predictions. predictions exists as a table
--  here but stays EMPTY: picks remain in pool_entries.picks jsonb until M16, because decomposing them
--  changes the scoring input path.
--
-- DEPENDENCIES: M6
-- TABLES CREATED: bolao.match_results, bolao.predictions
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
--  receive nothing in this phase. Intended eventual access: match_results[anon:SELECT],
--  predictions[anon:none]
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. match_results from bolao_state.results{}. predictions deliberately NOT backfilled
--  here.
-- APPLICATION COMPATIBILITY. TOTAL — additive. Scoring continues to read picks jsonb.
-- ROLLBACK STRATEGY (FULL). FULL — DROP TABLE; predictions is empty and match_results is re-derivable from
--  the document.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M6 is recorded as applied
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

CREATE TABLE bolao."match_results" (
  "match_result_id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
  "match_id"                         uuid NOT NULL,
  "goals_home"                       integer NOT NULL,
  "goals_away"                       integer NOT NULL,
  "penalties_home"                   integer,
  "penalties_away"                   integer,
  "is_official"                      boolean NOT NULL DEFAULT false,
  "source"                           text NOT NULL,
  "recorded_at"                      timestamptz NOT NULL DEFAULT now(),
  "superseded_by_id"                 uuid,
  CONSTRAINT "match_results_pkey" PRIMARY KEY ("match_result_id"),
  CONSTRAINT "match_results_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES bolao."matches" ("match_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "match_results_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES bolao."match_results" ("match_result_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "mr_no_self_supersede" CHECK (superseded_by_id IS NULL OR superseded_by_id <> match_result_id),
  CONSTRAINT "mr_penalties_paired" CHECK ((penalties_home IS NULL) = (penalties_away IS NULL))
);

COMMENT ON TABLE bolao."match_results" IS 'The authoritative outcome of a match. Named match_results, not results, to keep it distinct from participant SCORES.';
-- CHECK mr_no_self_supersede: a result cannot supersede itself
-- CHECK mr_penalties_paired: a shootout has two scores or none

ALTER TABLE bolao."match_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."match_results" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."match_results" FROM PUBLIC;

CREATE TABLE bolao."predictions" (
  "prediction_id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
  "pool_entry_id"                    uuid NOT NULL,
  "match_id"                         uuid,
  "tie_id"                           uuid,
  "predicted_goals_home"             integer,
  "predicted_goals_away"             integer,
  "predicted_qualified_side"         char(1),
  "submitted_at"                     timestamptz NOT NULL DEFAULT now(),
  "locked"                           boolean NOT NULL DEFAULT false,
  CONSTRAINT "predictions_pkey" PRIMARY KEY ("prediction_id"),
  CONSTRAINT "predictions_pool_entry_id_fkey" FOREIGN KEY ("pool_entry_id") REFERENCES bolao."pool_entries" ("pool_entry_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES bolao."matches" ("match_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "predictions_tie_id_fkey" FOREIGN KEY ("tie_id") REFERENCES bolao."ties" ("tie_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "pred_subject_exactly_one" CHECK ((match_id IS NOT NULL) <> (tie_id IS NOT NULL))
);

COMMENT ON TABLE bolao."predictions" IS 'One participant''s prediction for one subject (match or tie). SCORING-ADJACENT: migrated LAST, with a parity proof.';
-- CHECK pred_subject_exactly_one: a prediction is about a match XOR a tie, never both and never neither

ALTER TABLE bolao."predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."predictions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."predictions" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- at most ONE official current result per match; partial so superseded corrections coexist
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "match_results_match_id_uidx" ON bolao."match_results" (match_id) WHERE superseded_by_id IS NULL AND is_official;
-- result history for a match
CREATE INDEX CONCURRENTLY IF NOT EXISTS "match_results_match_id_idx" ON bolao."match_results" (match_id);
-- all predictions for an entry — the scoring read path
CREATE INDEX CONCURRENTLY IF NOT EXISTS "predictions_pool_entry_id_idx" ON bolao."predictions" (pool_entry_id);
-- score a match across all entries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "predictions_match_id_idx" ON bolao."predictions" (match_id) WHERE match_id IS NOT NULL;
-- one prediction per entry per match
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "predictions_pool_entry_id_match_id_uidx" ON bolao."predictions" (pool_entry_id, match_id) WHERE match_id IS NOT NULL;
-- one qualification pick per entry per tie
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "predictions_pool_entry_id_tie_id_uidx" ON bolao."predictions" (pool_entry_id, tie_id) WHERE tie_id IS NOT NULL;

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['match_results_match_id_uidx', 'match_results_match_id_idx', 'predictions_pool_entry_id_idx', 'predictions_match_id_idx', 'predictions_pool_entry_id_match_id_uidx', 'predictions_pool_entry_id_tie_id_uidx']);
-- Expected: zero rows.
