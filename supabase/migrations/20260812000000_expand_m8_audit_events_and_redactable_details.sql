--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812000000_expand_m8_audit_events_and_redactable_details.sql
--
-- EXPAND stage M8 — audit events and redactable details
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
-- ROLLBACK (FULL_BEFORE_BACKFILL). FULL before backfill. After: FORWARD-FIX-ONLY — dropping audit rows destroys the evidence of what the migration itself did.
--
-- ============================================================
-- M8 — audit events and redactable details
-- ============================================================
--
-- PURPOSE. The audit spine, created BEFORE any backfill runs (ordering correction OC-1) so the largest data
--  movement in the programme is not the one operation with no trail.
--
-- DEPENDENCIES: M7
-- TABLES CREATED: audit.audit_chain_head, audit.audit_events, audit.audit_event_details
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
--  receive nothing in this phase. Intended eventual access: audit_chain_head[anon:none],
--  audit_events[anon:none], audit_event_details[anon:none]
-- PII EFFECT. Introduces 3 PII-bearing column(s): audit_events.actor_user_id:PSEUDONYMOUS_ID,
--  audit_event_details.before_snapshot:SENSITIVE_SNAPSHOT,
--  audit_event_details.after_snapshot:SENSITIVE_SNAPSHOT. All are unreadable until a policy grants access.
-- BACKFILL REQUIREMENT. auditLog[] with free-text detail DROPPED per B1/ADR-008; hash chain computed in
--  document order
-- APPLICATION COMPATIBILITY. TOTAL — additive.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL before backfill. After: FORWARD-FIX-ONLY — dropping audit
--  rows destroys the evidence of what the migration itself did.
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

CREATE TABLE audit."audit_chain_head" (
  "singleton"                        boolean NOT NULL DEFAULT true,
  "event_hash"                       text,
  "event_count"                      bigint NOT NULL DEFAULT 0,
  "updated_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "audit_chain_head_pkey" PRIMARY KEY ("singleton"),
  CONSTRAINT "audit_chain_head_singleton" CHECK (singleton)
);

COMMENT ON TABLE audit."audit_chain_head" IS 'The current tail of the audit hash chain, as a single row. Exists so that appending an event is O(1): without it the trigger has to find the one event nothing points back to, which is a scan of the whole audit log on every insert and makes bulk insertion quadratic (measured — a 200,000-row load did not finish). Locking this row FOR UPDATE also gives the serialisation the chain needs, so concurrent writers are ordered rather than failed. See ADR-K01.';
-- CHECK audit_chain_head_singleton: one chain, one head; a second row would make the tail ambiguous and permit two parallel chains

ALTER TABLE audit."audit_chain_head" ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit."audit_chain_head" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit."audit_chain_head" FROM PUBLIC;

-- updated_at is maintained here, not by callers. The WHEN guard means a no-op write does not
-- advance it, so the column reads as "when this row last actually changed".
CREATE TRIGGER "audit_chain_head_set_updated_at"
  BEFORE UPDATE ON audit."audit_chain_head"
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION bolao.set_updated_at();

-- One row, created with the table. NULL event_hash means "no events yet"; the first append
-- links to nothing and becomes the genesis of the chain.
INSERT INTO audit."audit_chain_head" (singleton, event_hash) VALUES (true, NULL)
  ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE audit."audit_events" (
  "audit_event_id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
  "occurred_at"                      timestamptz NOT NULL DEFAULT now(),
  "actor_user_id"                    uuid,
  "actor_role"                       text,
  "action"                           text NOT NULL,
  "aggregate_type"                   text NOT NULL,
  "aggregate_id"                     uuid,
  "correlation_id"                   uuid,
  "request_id"                       uuid,
  "source"                           text NOT NULL DEFAULT 'edge_function',
  "safe_metadata"                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reason"                           text,
  "previous_event_hash"              text,
  "event_hash"                       text NOT NULL,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("audit_event_id"),
  CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES auth."users" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ae_action_shape" CHECK (action ~ '^[a-z_]+\.[a-z_]+$')
);

COMMENT ON TABLE audit."audit_events" IS 'Append-only, hash-chained record of what a human did. B1-compliant: identifiers, not PII.';
COMMENT ON COLUMN audit."audit_events"."actor_user_id" IS 'PII class: PSEUDONYMOUS_ID';
-- CHECK ae_action_shape: a free-text action makes the audit log unqueryable

ALTER TABLE audit."audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit."audit_events" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit."audit_events" FROM PUBLIC;

-- The chain is built by the server on the way in.
CREATE TRIGGER "audit_events_compute_chain"
  BEFORE INSERT ON audit."audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit.compute_event_chain();

-- Append-only. Row-level triggers refuse any row that is targeted; the statement-level pair refuses
-- the operation even when it matches nothing, so a bulk delete cannot be reported as a success.
CREATE TRIGGER "audit_events_refuse_update"
  BEFORE UPDATE ON audit."audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit.refuse_mutation();
CREATE TRIGGER "audit_events_refuse_delete"
  BEFORE DELETE ON audit."audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit.refuse_mutation();
CREATE TRIGGER "audit_events_refuse_update_stmt"
  BEFORE UPDATE ON audit."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_mutation();
CREATE TRIGGER "audit_events_refuse_delete_stmt"
  BEFORE DELETE ON audit."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_mutation();

CREATE TABLE audit."audit_event_details" (
  "audit_event_detail_id"            uuid NOT NULL DEFAULT gen_random_uuid(),
  "audit_event_id"                   uuid NOT NULL,
  "before_snapshot"                  jsonb,
  "after_snapshot"                   jsonb,
  "redacted_at"                      timestamptz,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "audit_event_details_pkey" PRIMARY KEY ("audit_event_detail_id"),
  CONSTRAINT "audit_event_details_audit_event_id_fkey" FOREIGN KEY ("audit_event_id") REFERENCES audit."audit_events" ("audit_event_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "audit_event_details_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "aed_redaction_complete" CHECK (redacted_at IS NULL OR (before_snapshot IS NULL AND after_snapshot IS NULL))
);

COMMENT ON TABLE audit."audit_event_details" IS 'Sidecar for genuinely-required sensitive detail. SEPARATE from audit_events and EXCLUDED from the hash chain — that exclusion is what makes erasure and integrity coexist (G-02).';
COMMENT ON COLUMN audit."audit_event_details"."before_snapshot" IS 'PII class: SENSITIVE_SNAPSHOT';
COMMENT ON COLUMN audit."audit_event_details"."after_snapshot" IS 'PII class: SENSITIVE_SNAPSHOT';
-- CHECK aed_redaction_complete: a redacted detail row must retain no payload

ALTER TABLE audit."audit_event_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit."audit_event_details" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit."audit_event_details" FROM PUBLIC;

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- 'what happened to this object' — the audit lookup path, currently a full scan in the legacy table
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_aggregate_type_aggregate_id_idx" ON audit."audit_events" (aggregate_type, aggregate_id);
-- chronological audit reads
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_occurred_at_idx" ON audit."audit_events" (occurred_at);
-- KPLUS-F013(b). At most ONE event may follow any given event. This makes a forked hash chain structurally impossible rather than merely unlikely: two concurrent inserts that both read the same tail cannot both commit, because the second violates this index. The chain-building trigger also serialises on an advisory lock, so this is the second of two independent defences — the one that still holds if the first is ever removed. Partial because the genesis event has no predecessor.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_previous_event_hash_uidx" ON audit."audit_events" (previous_event_hash) WHERE previous_event_hash IS NOT NULL;
-- KPLUS-F013(b). The chain is walked by matching previous_event_hash to event_hash, which is only unambiguous if event_hash identifies exactly one row. Also the lookup path for chain verification.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_event_hash_uidx" ON audit."audit_events" (event_hash);
-- reconstruct one logical operation end to end
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_correlation_id_idx" ON audit."audit_events" (correlation_id) WHERE correlation_id IS NOT NULL;
-- KPLUS-OP-2, added on measured workload evidence and on nothing else. Without this index PostgreSQL's referential-integrity check on a parent delete or key update reads 200,000 rows at TIER_100X and the count tracks the table; with it the check examines only rows that match. Twelve other unindexed foreign keys were measured the same way and deliberately NOT indexed — for ten the planner declines the index even when it exists. Evidence: fingerprints/P_performance_baseline.json.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_actor_user_id_idx" ON audit."audit_events" (actor_user_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['audit_events_aggregate_type_aggregate_id_idx', 'audit_events_occurred_at_idx', 'audit_events_previous_event_hash_uidx', 'audit_events_event_hash_uidx', 'audit_events_correlation_id_idx', 'audit_events_actor_user_id_idx']);
-- Expected: zero rows.
