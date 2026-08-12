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
-- M9 — outbox events and delivery attempts
-- ============================================================
--
-- PURPOSE. Durable notification intent, so a delivery failure becomes a retry rather than a silent loss.
--  Created before write-through (M11) needs it.
--
-- DEPENDENCIES: M8
-- TABLES CREATED: bolao.outbox_events, bolao.outbox_delivery_attempts
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
--  receive nothing in this phase. Intended eventual access: outbox_events[anon:none],
--  outbox_delivery_attempts[anon:none]
-- PII EFFECT. Introduces 1 PII-bearing column(s): outbox_events.payload:SENSITIVE_SNAPSHOT. All are
--  unreadable until a policy grants access.
-- BACKFILL REQUIREMENT. none — the outbox starts empty; historical notifications are not reconstructable
-- APPLICATION COMPATIBILITY. TOTAL — additive.
-- ROLLBACK STRATEGY (FULL). FULL — DROP TABLE. Any undelivered event is lost, which is why rollback must
--  happen while the outbox is empty.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M8 is recorded as applied
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

CREATE TABLE bolao."outbox_events" (
  "outbox_event_id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_key"                  text NOT NULL,
  "channel"                          bolao.outbox_channel NOT NULL,
  "event_type"                       text NOT NULL,
  "payload"                          jsonb NOT NULL,
  "status"                           bolao.outbox_status NOT NULL DEFAULT 'pending',
  "attempt_count"                    integer NOT NULL DEFAULT 0,
  "next_attempt_at"                  timestamptz,
  "lease_owner"                      text,
  "lease_expires_at"                 timestamptz,
  "correlation_id"                   uuid,
  "dead_at"                          timestamptz,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("outbox_event_id"),
  CONSTRAINT "outbox_events_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "oe_dead_has_timestamp" CHECK ((status = 'dead') = (dead_at IS NOT NULL)),
  CONSTRAINT "oe_lease_paired" CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

COMMENT ON TABLE bolao."outbox_events" IS 'Something that must be delivered exactly once — email now, webhooks later. The intent; attempts are a separate table.';
COMMENT ON COLUMN bolao."outbox_events"."payload" IS 'PII class: SENSITIVE_SNAPSHOT';
-- CHECK oe_dead_has_timestamp: a dead event must carry terminal evidence
-- CHECK oe_lease_paired: a lease without an expiry can strand an event forever

ALTER TABLE bolao."outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."outbox_events" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."outbox_events" FROM PUBLIC;

CREATE TABLE bolao."outbox_delivery_attempts" (
  "outbox_delivery_attempt_id"       uuid NOT NULL DEFAULT gen_random_uuid(),
  "outbox_event_id"                  uuid NOT NULL,
  "attempt_number"                   integer NOT NULL,
  "started_at"                       timestamptz NOT NULL DEFAULT now(),
  "finished_at"                      timestamptz,
  "outcome"                          bolao.delivery_outcome NOT NULL,
  "failure_category"                 text,
  "provider_message_id"              text,
  CONSTRAINT "outbox_delivery_attempts_pkey" PRIMARY KEY ("outbox_delivery_attempt_id"),
  CONSTRAINT "outbox_delivery_attempts_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES bolao."outbox_events" ("outbox_event_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "oda_finish_after_start" CHECK (finished_at IS NULL OR finished_at >= started_at)
);

COMMENT ON TABLE bolao."outbox_delivery_attempts" IS 'One row per delivery attempt. Split from the event because a status column cannot explain WHY three attempts failed.';
-- CHECK oda_finish_after_start: an attempt cannot finish before it starts

ALTER TABLE bolao."outbox_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."outbox_delivery_attempts" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."outbox_delivery_attempts" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- the worker's claim query; without it the worker scans the whole table every cycle
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_events_status_next_attempt_at_idx" ON bolao."outbox_events" (status, next_attempt_at);
-- trace one operation across audit and outbox
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_events_correlation_id_idx" ON bolao."outbox_events" (correlation_id) WHERE correlation_id IS NOT NULL;
-- dead-letter queue listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_events_status_idx" ON bolao."outbox_events" (status) WHERE status = 'dead';
-- attempt numbering must be unambiguous; also detects retry-count mismatch
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "outbox_delivery_attempts_outbox_event_id_attempt_number_uidx" ON bolao."outbox_delivery_attempts" (outbox_event_id, attempt_number);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['outbox_events_status_next_attempt_at_idx', 'outbox_events_correlation_id_idx', 'outbox_events_status_idx', 'outbox_delivery_attempts_outbox_event_id_attempt_number_uidx']);
-- Expected: zero rows.
