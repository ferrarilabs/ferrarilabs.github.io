--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260811200000_expand_m4_pools_fee_schedule_and_entries.sql
--
-- EXPAND stage M4 — pools, fee schedule and entries
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
-- ROLLBACK (FULL_BEFORE_BACKFILL). FULL before backfill; FORWARD-FIX-ONLY after, because deleting backfilled entries would discard rows the app may already have created through the new path.
--
-- ============================================================
-- M4 — pools, fee schedule and entries
-- ============================================================
--
-- PURPOSE. pools, pool_fee_schedule and pool_entries. expected_fee_amount is a SNAPSHOT on the entry, so a
--  later price change cannot retroactively alter an existing entry's settlement.
--
-- DEPENDENCIES: M3
-- TABLES CREATED: bolao.pools, bolao.pool_fee_schedule, bolao.pool_entries
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
--  receive nothing in this phase. Intended eventual access: pools[anon:SELECT],
--  pool_fee_schedule[anon:SELECT], pool_entries[anon:none]
-- PII EFFECT. Introduces 2 PII-bearing column(s): pools.created_by:PSEUDONYMOUS_ID,
--  pool_entries.created_by:PSEUDONYMOUS_ID. All are unreadable until a policy grants access.
-- BACKFILL REQUIREMENT. M8-backfill copies bolao_state.entries[] 1:1; deletedIds[] becomes deleted_at
-- APPLICATION COMPATIBILITY. TOTAL — additive. anon cannot write these; entry creation becomes
--  server-mediated at M11.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL before backfill; FORWARD-FIX-ONLY after, because deleting
--  backfilled entries would discard rows the app may already have created through the new path.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M3 is recorded as applied
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

CREATE TABLE bolao."pools" (
  "pool_id"                          uuid NOT NULL DEFAULT gen_random_uuid(),
  "competition_edition_id"           uuid NOT NULL,
  "slug"                             text NOT NULL,
  "name"                             text NOT NULL,
  "status"                           bolao.pool_status NOT NULL DEFAULT 'open',
  "prize_split"                      jsonb NOT NULL DEFAULT '{"first":0.70,"second":0.20,"third":0.10}'::jsonb,
  "version"                          integer NOT NULL DEFAULT 1,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  "created_by"                       uuid,
  CONSTRAINT "pools_pkey" PRIMARY KEY ("pool_id"),
  CONSTRAINT "pools_competition_edition_id_fkey" FOREIGN KEY ("competition_edition_id") REFERENCES bolao."competition_editions" ("competition_edition_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "pools_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."pools" IS 'A betting pool for one edition. The money boundary: fees, prize split and entries all hang off it.';
COMMENT ON COLUMN bolao."pools"."created_by" IS 'PII class: PSEUDONYMOUS_ID';

ALTER TABLE bolao."pools" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."pools" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."pools" FROM PUBLIC;

CREATE TABLE bolao."pool_fee_schedule" (
  "pool_fee_schedule_id"             uuid NOT NULL DEFAULT gen_random_uuid(),
  "pool_id"                          uuid NOT NULL,
  "fee_amount"                       numeric(14,2) NOT NULL,
  "currency"                         char(3) NOT NULL,
  "basis"                            bolao.fee_basis NOT NULL DEFAULT 'per_entry',
  "effective_from"                   timestamptz NOT NULL,
  "effective_to"                     timestamptz,
  "confidence"                       bolao.evidence_confidence NOT NULL,
  "source"                           text NOT NULL,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pool_fee_schedule_pkey" PRIMARY KEY ("pool_fee_schedule_id"),
  CONSTRAINT "pool_fee_schedule_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES bolao."pools" ("pool_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "pfs_period_ordered" CHECK (effective_to IS NULL OR effective_from < effective_to)
);

COMMENT ON TABLE bolao."pool_fee_schedule" IS 'The entry fee for a pool, over time. A schedule rather than a column because a pool may be re-priced and history must stay stable.';
-- CHECK pfs_period_ordered: a fee period cannot end before it begins

ALTER TABLE bolao."pool_fee_schedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."pool_fee_schedule" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."pool_fee_schedule" FROM PUBLIC;

CREATE TABLE bolao."pool_entries" (
  "pool_entry_id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
  "pool_id"                          uuid NOT NULL,
  "participant_id"                   uuid NOT NULL,
  "entry_label"                      text NOT NULL,
  "expected_fee_amount"              numeric(14,2) NOT NULL,
  "expected_fee_currency"            char(3) NOT NULL,
  "pool_fee_schedule_id"             uuid,
  "cotas"                            numeric(10,4) NOT NULL DEFAULT 1,
  "state"                            bolao.entry_state NOT NULL DEFAULT 'submitted',
  "submitted_at"                     timestamptz,
  "version"                          integer NOT NULL DEFAULT 1,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  "updated_at"                       timestamptz NOT NULL DEFAULT now(),
  "deleted_at"                       timestamptz,
  "created_by"                       uuid,
  CONSTRAINT "pool_entries_pkey" PRIMARY KEY ("pool_entry_id"),
  CONSTRAINT "pool_entries_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES bolao."pools" ("pool_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "pool_entries_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "pool_entries_pool_fee_schedule_id_fkey" FOREIGN KEY ("pool_fee_schedule_id") REFERENCES bolao."pool_fee_schedule" ("pool_fee_schedule_id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "pool_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "pe_label_present" CHECK (length(btrim(entry_label)) > 0)
);

COMMENT ON TABLE bolao."pool_entries" IS 'One competitive entry: this participant, in this pool, with these predictions. Ratified name (E1); replaces ''participation''.';
COMMENT ON COLUMN bolao."pool_entries"."created_by" IS 'PII class: PSEUDONYMOUS_ID';
-- NOTE: pool_entries.(derived) is DERIVED_VIEW and is deliberately NOT a column.
-- CHECK pe_label_present: the only discriminator between deliberate and accidental duplicates

ALTER TABLE bolao."pool_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."pool_entries" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."pool_entries" FROM PUBLIC;

-- updated_at is maintained here, not by callers. The WHEN guard means a no-op write does not
-- advance it, so the column reads as "when this row last actually changed".
CREATE TRIGGER "pool_entries_set_updated_at"
  BEFORE UPDATE ON bolao."pool_entries"
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION bolao.set_updated_at();

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- stable public identifier
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "pools_slug_uidx" ON bolao."pools" (slug);
-- resolve the fee in force at a point in time
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pool_fee_schedule_pool_id_effective_from_idx" ON bolao."pool_fee_schedule" (pool_id, effective_from);
-- at most ONE currently-in-force fee per pool — prevents two live prices
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "pool_fee_schedule_pool_id_uidx" ON bolao."pool_fee_schedule" (pool_id) WHERE effective_to IS NULL;
-- multiple entries per pool are allowed, but two entries with the SAME label are an accident, not an intent
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "pool_entries_participant_id_pool_id_entry_label_uidx" ON bolao."pool_entries" (participant_id, pool_id, entry_label);
-- KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json. This is also the read behind every ranking screen: workload W1 sequentially scanned all 20,000 entries without it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pool_entries_pool_id_idx" ON bolao."pool_entries" (pool_id);
-- KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 20,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pool_entries_pool_fee_schedule_id_idx" ON bolao."pool_entries" (pool_fee_schedule_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['pools_slug_uidx', 'pool_fee_schedule_pool_id_effective_from_idx', 'pool_fee_schedule_pool_id_uidx', 'pool_entries_participant_id_pool_id_entry_label_uidx', 'pool_entries_pool_id_idx', 'pool_entries_pool_fee_schedule_id_idx']);
-- Expected: zero rows.
