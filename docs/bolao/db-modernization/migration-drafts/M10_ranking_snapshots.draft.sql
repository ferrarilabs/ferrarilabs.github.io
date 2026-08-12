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
-- M10 — ranking snapshots
-- ============================================================
--
-- PURPOSE. Published leaderboard history. Append-only: no role may UPDATE a snapshot, because editing a
--  published standing rewrites what participants already acted on.
--
-- DEPENDENCIES: M9
-- TABLES CREATED: bolao.ranking_snapshots
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
--  receive nothing in this phase. Intended eventual access: ranking_snapshots[anon:SELECT]
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. none in this phase; snapshots accrue from the ranking job after cutover
-- APPLICATION COMPATIBILITY. TOTAL — additive.
-- ROLLBACK STRATEGY (FULL). FULL. DROP TABLE ranking_snapshots while it is still empty. Snapshots only
--  begin accruing after cutover, so a rollback at this point discards nothing. Once snapshots exist this
--  becomes FORWARD_FIX_ONLY, because a published standing is history a participant may already have acted
--  on.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M9 is recorded as applied
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

CREATE TABLE bolao."ranking_snapshots" (
  "ranking_snapshot_id"              uuid NOT NULL DEFAULT gen_random_uuid(),
  "pool_id"                          uuid NOT NULL,
  "pool_entry_id"                    uuid NOT NULL,
  "computed_at"                      timestamptz NOT NULL DEFAULT now(),
  "position"                         integer NOT NULL,
  "points"                           integer NOT NULL,
  "scoring_rule_version"             text NOT NULL,
  "is_provisional"                   boolean NOT NULL DEFAULT true,
  "published_at"                     timestamptz,
  "tiebreak_detail"                  jsonb,
  CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("ranking_snapshot_id"),
  CONSTRAINT "ranking_snapshots_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES bolao."pools" ("pool_id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "ranking_snapshots_pool_entry_id_fkey" FOREIGN KEY ("pool_entry_id") REFERENCES bolao."pool_entries" ("pool_entry_id") ON DELETE CASCADE ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."ranking_snapshots" IS 'A point-in-time computed standing. The _snapshots suffix is LOAD-BEARING: ranking is derived, and a table named ''rankings'' would become a de-facto source of truth within one release.';

ALTER TABLE bolao."ranking_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."ranking_snapshots" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."ranking_snapshots" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- the ranking-history report; also fetches the latest snapshot
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ranking_snapshots_pool_id_computed_at_idx" ON bolao."ranking_snapshots" (pool_id, computed_at);
-- KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ranking_snapshots_pool_entry_id_idx" ON bolao."ranking_snapshots" (pool_entry_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['ranking_snapshots_pool_id_computed_at_idx', 'ranking_snapshots_pool_entry_id_idx']);
-- Expected: zero rows.
