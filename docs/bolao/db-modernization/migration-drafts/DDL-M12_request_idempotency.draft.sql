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
-- DDL-M12 — request idempotency
-- ============================================================
--
-- PURPOSE. The request idempotency store. All nine write contracts in model/write_contracts.json specify an
--  idempotency lookup and an idempotency record, and until this phase the target had nowhere to put one —
--  so every retry of a money-bearing request was a possible double-write (KPLUS-F018). Uniqueness on
--  (contract, idempotency_key) lives in the database because check-then-insert races with itself: two
--  concurrent retries both find nothing and both write. Created after the outbox, because exactly-once
--  DELIVERY and exactly-once EFFECT are different guarantees and the delivery side must already exist for
--  the write boundary to be assembled at M11.
--
-- DEPENDENCIES: M9
-- TABLES CREATED: bolao.request_idempotency
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
--  receive nothing in this phase. Intended eventual access: request_idempotency[anon:none]
-- PII EFFECT. No PII-bearing column is introduced.
-- BACKFILL REQUIREMENT. none — the store starts empty. Historical requests are not reconstructable and must
--  not be invented: a fabricated record would tell a genuine retry that its request had already been
--  executed.
-- APPLICATION COMPATIBILITY. TOTAL — additive. Nothing reads or writes it until server-mediated writes are
--  switched on.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL while empty — DROP TABLE. Once it holds money-bearing
--  records this becomes FORWARD_FIX_ONLY: dropping it converts every in-flight retry into a potential
--  double payment, which is the exact failure the table exists to prevent.
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

CREATE TABLE bolao."request_idempotency" (
  "request_idempotency_id"           uuid NOT NULL DEFAULT gen_random_uuid(),
  "contract"                         text NOT NULL,
  "idempotency_key"                  text NOT NULL,
  "payload_fingerprint"              text NOT NULL,
  "payload_version"                  text NOT NULL,
  "response"                         jsonb NOT NULL,
  "money_bearing"                    boolean NOT NULL,
  "request_id"                       uuid,
  "correlation_id"                   uuid,
  "prunable_after"                   timestamptz,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "request_idempotency_pkey" PRIMARY KEY ("request_idempotency_id"),
  CONSTRAINT "ri_money_never_expires" CHECK (NOT (money_bearing AND prunable_after IS NOT NULL)),
  CONSTRAINT "ri_fingerprint_is_sha256" CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE bolao."request_idempotency" IS 'Exactly-once effect for server-mediated writes. All nine write contracts specify an idempotency lookup and record; until this table existed there was nowhere to put one, so every retry was a possible double-write (KPLUS-F018). The record is written INSIDE the business transaction: before it, a crash marks a request done that never happened; after it, a retry doubles the write.';
-- CHECK ri_money_never_expires: the choreography forbids automatic deletion of a money-bearing idempotency record; a CHECK makes that something the database will not permit rather than something a pruner has to remember
-- CHECK ri_fingerprint_is_sha256: a truncated or differently-encoded fingerprint would silently compare unequal and turn every retry into a conflict

ALTER TABLE bolao."request_idempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."request_idempotency" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."request_idempotency" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- THE key. Uniqueness lives in the database because check-then-insert races with itself: two concurrent retries both find nothing and both write.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "request_idempotency_contract_idempotency_key_uidx" ON bolao."request_idempotency" (contract, idempotency_key);
-- a pruner must find its named set without scanning records it is not allowed to touch
CREATE INDEX CONCURRENTLY IF NOT EXISTS "request_idempotency_prunable_after_idx" ON bolao."request_idempotency" (prunable_after);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['request_idempotency_contract_idempotency_key_uidx', 'request_idempotency_prunable_after_idx']);
-- Expected: zero rows.
