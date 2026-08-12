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
-- M17 — classification zone predictions
-- ============================================================
--
-- PURPOSE. bolao.classification_predictions — a home for br2026's entries[].picks {g4:[4], sa6:[6],
--  z4:[4]}, 154 live club-zone assertions that had no normalized representation at all. They cannot live in
--  bolao.predictions: CHECK pred_subject_exactly_one requires a match_id XOR a tie_id and a zone pick has
--  neither. They are equally not classification_snapshots/competition_edition_standings, which model the
--  PROVIDER's observed league table and are an observation rather than a prediction — a queued task
--  proposed exactly that mapping and the schema refutes it. The ordinal column is load-bearing: br2026
--  scoring compares picks POSITIONALLY and pays a different score for the right club in the wrong position,
--  so an unordered representation would change what every entry scores.
--
-- DEPENDENCIES: M7
-- TABLES CREATED: bolao.classification_predictions
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
--  receive nothing in this phase. Intended eventual access: classification_predictions[anon:none]
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. a separate step reads bolao_state['br2026'].entries[].picks. 154 assertions across
--  11 entries; only the 4 entries not blocked by Q33-A1 are insertable today, so the backfill is scoped and
--  its denominator stated.
-- APPLICATION COMPATIBILITY. TOTAL — additive, in a schema the legacy app cannot reach. br2026 continues to
--  score from the document.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL. DROP TABLE bolao.classification_predictions. Every row is
--  re-derivable from bolao_state['br2026'] for as long as legacy is retained, and legacy is retained.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M7 is recorded as applied
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

CREATE TABLE bolao."classification_predictions" (
  "classification_prediction_id"     uuid NOT NULL DEFAULT gen_random_uuid(),
  "pool_entry_id"                    uuid NOT NULL,
  "zone"                             text NOT NULL,
  "ordinal"                          integer NOT NULL,
  "club_name"                        text NOT NULL,
  CONSTRAINT "classification_predictions_pkey" PRIMARY KEY ("classification_prediction_id"),
  CONSTRAINT "classification_predictions_pool_entry_id_fkey" FOREIGN KEY ("pool_entry_id") REFERENCES bolao."pool_entries" ("pool_entry_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."classification_predictions" IS 'A participant''s prediction that a named club finishes in a given ZONE at a given POSITION within that zone. br2026''s entries[].picks is {g4:[4], sa6:[6], z4:[4]} — fourteen club-zone assertions per entry, 154 live. It cannot go in bolao.predictions: that table''s CHECK pred_subject_exactly_one requires a match_id XOR a tie_id, and a zone pick has neither. It is equally NOT classification_snapshots/competition_edition_standings, which model the PROVIDER''s observed league table (points, played, wins) — an observation, not a prediction. A queued task proposed exactly that mapping; the schema refutes it.';

ALTER TABLE bolao."classification_predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."classification_predictions" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."classification_predictions" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- one club per position per zone per entry — the natural key, and what makes the backfill idempotent
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "classification_predictions_pool_entry_id_zone_ordinal_uidx" ON bolao."classification_predictions" (pool_entry_id, zone, ordinal);
-- this entry's zone picks — the read the scoring path makes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "classification_predictions_pool_entry_id_idx" ON bolao."classification_predictions" (pool_entry_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['classification_predictions_pool_entry_id_zone_ordinal_uidx', 'classification_predictions_pool_entry_id_idx']);
-- Expected: zero rows.
