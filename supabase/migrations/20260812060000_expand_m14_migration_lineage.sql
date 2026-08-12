--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812060000_expand_m14_migration_lineage.sql
--
-- EXPAND stage M14 — migration lineage
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
-- ROLLBACK (FULL_BEFORE_BACKFILL). FULL while empty. Once a backfill has written lineage this becomes the BACKOUT MECHANISM itself: a run's rows are exactly those naming its migration_run_id, so dropping this table would destroy the ability to reverse the backfill it describes.
--
-- ============================================================
-- M14 — migration lineage
-- ============================================================
--
-- PURPOSE. audit.migration_lineage — row-level provenance for every application row a backfill creates. The
--  campaign has required since its start that every target row resolve to a SOURCE or an
--  APPROVED_DERIVATION and every source element to a target, and there was nowhere in the database to
--  record either direction. PRODMIG-Q25 could not have met its own lineage criterion without this, which is
--  why the canary stopped before writing rather than deferring lineage.
--
-- DEPENDENCIES: M13
-- TABLES CREATED: audit.migration_lineage
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
--  receive nothing in this phase.
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. none — it is written BY the backfills, one row per created target row, in the same
--  transaction.
-- APPLICATION COMPATIBILITY. TOTAL — additive, in a schema the legacy app cannot reach.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL while empty. Once a backfill has written lineage this
--  becomes the BACKOUT MECHANISM itself: a run's rows are exactly those naming its migration_run_id, so
--  dropping this table would destroy the ability to reverse the backfill it describes.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M13 is recorded as applied
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

CREATE TABLE audit."migration_lineage" (
  "lineage_id"                       uuid NOT NULL DEFAULT gen_random_uuid(),
  "migration_run_id"                 uuid NOT NULL,
  "transform_version"                text NOT NULL,
  "target_schema"                    text NOT NULL,
  "target_relation"                  text NOT NULL,
  "target_row_id"                    uuid NOT NULL,
  "source_product"                   text NOT NULL,
  "source_pool"                      text,
  "source_relation"                  text NOT NULL,
  "source_path"                      text NOT NULL,
  "source_fingerprint"               text NOT NULL,
  "disposition"                      text NOT NULL,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "migration_lineage_pkey" PRIMARY KEY ("lineage_id"),
  CONSTRAINT "ml_disposition_known" CHECK (disposition IN ('MIGRATED','DERIVED_WITH_PROOF','APPROVED_EXCLUSION')),
  CONSTRAINT "ml_source_path_present" CHECK (length(btrim(source_path)) > 0),
  CONSTRAINT "ml_fingerprint_present" CHECK (length(btrim(source_fingerprint)) > 0)
);

COMMENT ON TABLE audit."migration_lineage" IS 'Row-level provenance for every application row a backfill creates. The campaign requires that every target row resolve to a SOURCE or an APPROVED_DERIVATION, and that every source element resolve to a target — and until now there was nowhere in the database to record either direction. PRODMIG-Q25 could not have satisfied its own lineage criterion without this.';
-- CHECK ml_disposition_known: UNKNOWN is not a disposition a row may carry; an unresolved element blocks its domain instead of being recorded as migrated-ish
-- CHECK ml_source_path_present: lineage that does not say where a row came from is not lineage
-- CHECK ml_fingerprint_present: a fingerprint is what makes the source claim checkable later

ALTER TABLE audit."migration_lineage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit."migration_lineage" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit."migration_lineage" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- the backout path: every row one run created. Without it, reversing a run scans the whole lineage table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "migration_lineage_migration_run_id_idx" ON audit."migration_lineage" (migration_run_id);
-- TARGET -> SOURCE: 'where did this row come from', the question an auditor asks about one row.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "migration_lineage_target_schema_target_relation_target_2a8e0147" ON audit."migration_lineage" (target_schema, target_relation, target_row_id);
-- SOURCE -> TARGET: the direction that finds a source element nothing migrated.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "migration_lineage_source_product_source_pool_source_re_f143d7a3" ON audit."migration_lineage" (source_product, source_pool, source_relation, source_path);
-- the IDEMPOTENCY key. A retry of the same run over the same source path must be a no-op rather than a second lineage row — and idempotency has to be a supported workflow, not a constraint violation somebody catches.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "migration_lineage_migration_run_id_target_schema_targe_7abf917c" ON audit."migration_lineage" (migration_run_id, target_schema, target_relation, target_row_id, source_path);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['migration_lineage_migration_run_id_idx', 'migration_lineage_target_schema_target_relation_target_2a8e0147', 'migration_lineage_source_product_source_pool_source_re_f143d7a3', 'migration_lineage_migration_run_id_target_schema_targe_7abf917c']);
-- Expected: zero rows.
