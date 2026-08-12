--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260811170000_expand_m1_schema_extensions_and_enum_types.sql
--
-- EXPAND stage M1 — schema, extensions and enum types
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
-- ROLLBACK (FULL). FULL — DROP SCHEMA ... RESTRICT and DROP TYPE. Safe because nothing references them yet.
--
-- ============================================================
-- M1 — schema, extensions and enum types
-- ============================================================
--
-- PURPOSE. Create the bolao and audit schemas, the pgcrypto extension gen_random_uuid() depends on, and the
--  14 enum types every later phase references. Nothing else can be created until the types exist.
--
-- DEPENDENCIES: M0
-- TABLES CREATED: none (types only)
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
-- BACKFILL REQUIREMENT. none — reference types only
-- APPLICATION COMPATIBILITY. TOTAL. Purely additive; the legacy app does not know these schemas exist.
-- ROLLBACK STRATEGY (FULL). FULL — DROP SCHEMA ... RESTRICT and DROP TYPE. Safe because nothing references
--  them yet.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M0 is recorded as applied
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

CREATE SCHEMA IF NOT EXISTS bolao;
CREATE SCHEMA IF NOT EXISTS audit;
COMMENT ON SCHEMA bolao IS 'Domain tables. Deliberately NOT public: leaving public removes PostgREST reachability by default.';
COMMENT ON SCHEMA audit IS 'Append-only audit spine plus its redactable payload sidecar.';

-- citext (case-insensitive text) backs the participant email column.
CREATE EXTENSION IF NOT EXISTS citext;
-- gen_random_uuid() lives in pgcrypto on the server version in use.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Privileges are revoked from PUBLIC before any object exists, so no object is ever briefly world-readable.
REVOKE ALL ON SCHEMA bolao FROM PUBLIC;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

-- Schema USAGE, derived from model/privilege_manifest.json's SCHEMA class. Without this every
-- grant inside these schemas is inert: reaching an object requires USAGE on its schema first.
GRANT USAGE ON SCHEMA bolao TO "service_role";
GRANT USAGE ON SCHEMA audit TO "service_role";

-- active, merged away (superseded), or erased in place (redacted). No 'deleted' — participants are never deleted.
CREATE TYPE bolao."participant_state" AS ENUM ('active', 'superseded', 'redacted');
-- mirrors CONFIDENCE in identity.mjs; ordinal labels, never a numeric score, so no threshold can be automated
CREATE TYPE bolao."match_confidence" AS ENUM ('strong', 'moderate', 'weak');
-- how a recorded fact is known. 'unknown' is a first-class value: a fee whose amount was never recorded must stay unknown
CREATE TYPE bolao."evidence_confidence" AS ENUM ('asserted', 'derived', 'inferred', 'unknown');
-- drives phase topology; the three shapes the platform's competitions actually take
CREATE TYPE bolao."competition_kind" AS ENUM ('league', 'knockout', 'group_then_knockout');
-- editions are retired by status, never deleted
CREATE TYPE bolao."edition_status" AS ENUM ('planned', 'active', 'concluded', 'archived');
-- 'frozen' is the M13 read-only window and must be a first-class state, not a flag elsewhere
CREATE TYPE bolao."pool_status" AS ENUM ('open', 'frozen', 'closed', 'settled');
-- per_entry today; per_cota exists because cotas is already a modelled column
CREATE TYPE bolao."fee_basis" AS ENUM ('per_entry', 'per_cota');
-- withdrawal is a state plus deleted_at, never a row removal
CREATE TYPE bolao."entry_state" AS ENUM ('draft', 'submitted', 'withdrawn');
-- mirrors SETTLEMENT in financial.mjs exactly. DERIVED_VIEW only — no table stores it. `unknown` means the EXPECTED FEE was never recorded, so no settlement claim is possible — distinct from legacy_asserted, which means the amount paid is unknown. Reporting such an entry as unpaid would fabricate a fee by implication.
CREATE TYPE bolao."settlement_status" AS ENUM ('unpaid', 'partially_paid', 'settled', 'overpaid', 'legacy_asserted', 'unknown');
-- the sign CHECK depends on this exact set; refund/reversal/chargeback are the negative-amount kinds. `adjustment` is declared but NOT implemented in financial_evidence.mjs PAYMENT_KIND, and is therefore unreachable: no code path produces it and no invariant governs its sign. Left in the enum deliberately rather than removed, because dropping an enum value is impossible once any row uses it — but it must not be written until the sign rule and reconciliation treatment are specified (BATCH-G-OP-2).
CREATE TYPE bolao."payment_kind" AS ENUM ('contribution', 'refund', 'reversal', 'chargeback', 'adjustment');
-- a finished match must have a result (DQ-PR-05); postponed and cancelled must not
CREATE TYPE bolao."match_status" AS ENUM ('scheduled', 'in_progress', 'finished', 'postponed', 'cancelled');
-- mirrors STATUS in outbox.mjs. 'dead' is not terminal — replay returns it to pending
CREATE TYPE bolao."outbox_status" AS ENUM ('pending', 'in_flight', 'sent', 'dead');
-- email today; webhook declared because the outbox is channel-agnostic by design
CREATE TYPE bolao."outbox_channel" AS ENUM ('email', 'webhook');
-- mirrors OUTCOME in outbox.mjs; the transient/permanent split is what decides retry vs dead
CREATE TYPE bolao."delivery_outcome" AS ENUM ('success', 'transient_failure', 'permanent_failure');

-- KPLUS-F013(a): updated_at is server-maintained. A client-supplied value is deliberately overwritten.
CREATE OR REPLACE FUNCTION bolao.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION bolao.set_updated_at() IS 'BEFORE UPDATE trigger: stamps updated_at from the server clock, overriding any client-supplied value. Attached only to entities whose model declares an updated_at column.';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION bolao.set_updated_at() FROM PUBLIC;

-- KPLUS-F014. The canonical serialisation lives in ONE function, and everything that needs a chain
-- hash calls it: the append trigger below, the bulk chain builder the M10 audit backfill runs, and every
-- verifier. It was previously written out inline in the trigger, which meant the backfill and the
-- verifiers each had to restate it — and a restatement that drifts by one separator produces hashes that
-- look fine, verify fine against themselves, and are incompatible with every event appended afterwards.
-- That is the exact failure mode CLAUDE.md records for send_result_email.py, in the audit spine.
--
-- STABLE, not IMMUTABLE: to_char() over a timestamp depends on DateStyle/lc_time and
-- timezone(text, timestamptz) depends on the zone database, so neither is immutable in PostgreSQL's
-- sense. STABLE is the strongest correct marking and it is sufficient here (this is never indexed).
--
-- The column set and order are fixed. Changing either changes every future hash, which is why the
-- version tag 'v1' is the first field: a future v2 is a deliberate, reviewed migration that can be told
-- apart from a v1 hash, rather than a silent break.
--
-- The parameters are SCALARS rather than an audit.audit_events row, and named. A row-typed parameter
-- would need the table to exist, and these functions are created in M1 — seven phases before it. Named
-- arguments are then mandatory at every call site (see below), so fourteen positional parameters cannot
-- silently shift: transposing two same-typed columns is precisely the mistake that would produce a
-- plausible, self-consistent, wrong chain.
CREATE OR REPLACE FUNCTION audit.event_canonical_v1(
  p_previous_event_hash text,
  p_audit_event_id      uuid,
  p_occurred_at         timestamptz,
  p_actor_user_id       uuid,
  p_actor_role          text,
  p_action              text,
  p_aggregate_type      text,
  p_aggregate_id        uuid,
  p_correlation_id      uuid,
  p_request_id          uuid,
  p_source              text,
  p_safe_metadata       jsonb,
  p_reason              text
) RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, audit, pg_temp
AS $$
  -- chr(31) (unit separator) between fields and chr(30) (record separator) for NULL, both written as
  -- SQL function calls rather than string escapes so nothing depends on how an escape survives
  -- generation. Neither character can appear in these columns' real values, so no combination of values
  -- can be re-parsed as a different combination. safe_metadata is rendered through jsonb, which
  -- normalises key order and whitespace, so a semantically identical payload always hashes the same.
  SELECT concat_ws(chr(31),
    'v1',
    coalesce(p_previous_event_hash, chr(30)),
    p_audit_event_id::text,
    to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor_user_id::text, chr(30)),
    coalesce(p_actor_role, chr(30)),
    p_action,
    p_aggregate_type,
    coalesce(p_aggregate_id::text, chr(30)),
    coalesce(p_correlation_id::text, chr(30)),
    coalesce(p_request_id::text, chr(30)),
    p_source,
    p_safe_metadata::text,
    coalesce(p_reason, chr(30))
  );
$$;
COMMENT ON FUNCTION audit.event_canonical_v1(text, uuid, timestamptz, uuid, text, text, text, uuid, uuid, uuid, text, jsonb, text) IS 'Canonical serialisation of an audit event for hashing, version v1. The single definition — the append trigger, the M10 bulk chain builder and every verifier call this rather than restating it (KPLUS-F014). Covers the non-PII columns of audit_events only; the audit_event_details sidecar is excluded so PII can be redacted without breaking the chain (G-02). Call it with NAMED arguments.';

-- sha256() and convert_to() are both built into pg_catalog. digest() would have meant depending on
-- pgcrypto living in a schema this function's pinned search_path deliberately excludes — and pinning the
-- search_path is not negotiable for a SECURITY-relevant function.
CREATE OR REPLACE FUNCTION audit.event_hash_v1(p_canonical text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, audit, pg_temp
AS $$
  SELECT encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex');
$$;
COMMENT ON FUNCTION audit.event_hash_v1(text) IS 'The chain hash of an audit event, over the output of audit.event_canonical_v1(). Given a row whose previous_event_hash is already known, this is the value the append trigger would compute for it — which is what lets the M10 backfill build a chain in bulk that a later live append continues seamlessly.';

-- Unlike the four trigger functions (which return trigger and cannot be called at all), these two ARE
-- callable, so they would inherit EXECUTE from PUBLIC — the silent inheritance KPLUS-F023 warns about,
-- arriving with the first callable function, exactly as predicted. Both are pure functions of their
-- arguments and read no table, so this is hardening rather than an incident; the retrofit of the four
-- existing trigger functions stays a separate change with its own proof.
REVOKE ALL ON FUNCTION audit.event_canonical_v1(text, uuid, timestamptz, uuid, text, text, text, uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.event_hash_v1(text) FROM PUBLIC;

-- KPLUS-F028, found by the F027 least-privilege lab and NOT by anything that ran before it.
--
-- audit.compute_event_chain() is SECURITY INVOKER. The trigger itself fires as part of the table's
-- machinery and needs no EXECUTE — that part of KPLUS-F023's reasoning is correct. But the two calls
-- INSIDE its body are ordinary function calls, checked against the role performing the INSERT. So the
-- REVOKE above, which is right, took EXECUTE away from the runtime as well as from PUBLIC, and every
-- audit append by a non-superuser runtime fails with "permission denied for function event_hash_v1".
--
-- It passed unnoticed because the local rehearsal writes as a superuser, which is the same asymmetry
-- KPLUS-F013 and KPLUS-F027 both turned on. Proven by F027-8a: service_role's append is refused
-- without these grants and succeeds with them, with nothing else changed.
--
-- The grants are narrow by construction rather than by promise: both functions are IMMUTABLE, take
-- everything they use as arguments, read no table and hold no privilege of their own. Being able to
-- call them buys a caller a SHA-256 of a string it already had. It cannot forge a chain entry with
-- them, because the trigger overwrites any client-supplied hash before the row is stored.
GRANT EXECUTE ON FUNCTION audit.event_canonical_v1(text, uuid, timestamptz, uuid, text, text, text, uuid, uuid, uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION audit.event_hash_v1(text) TO service_role;

-- KPLUS-F013(b). The chain is computed by the server. Any client-supplied
-- event_hash or previous_event_hash is discarded: a hash the caller chooses attests to nothing.
CREATE OR REPLACE FUNCTION audit.compute_event_chain() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, audit, pg_temp
AS $$
DECLARE
  tail_hash text;
BEGIN
  -- The tail is read from the single-row chain head, and SELECT ... FOR UPDATE on that row both gives
  -- the value and serialises concurrent appenders: two writers cannot read the same tail, because the
  -- second waits for the first to commit.
  --
  -- The first version of this function searched audit_events for the OPEN END — the event nothing
  -- points back to. That is exact and needs no extra state, and it is also a scan of the entire audit
  -- log on every single insert. Measured: a 200,000-row bulk load did not finish. Appending to a log
  -- must be O(1), so the tail is now kept where it can be read in one row fetch.
  SELECT h.event_hash INTO tail_hash
  FROM audit.audit_chain_head h
  WHERE h.singleton
  FOR UPDATE;

  NEW.previous_event_hash := tail_hash;

  -- The canonical form and the hash come from the shared functions, not from a copy written out here.
  -- See KPLUS-F014 above: the bulk chain builder must produce byte-identical hashes to this trigger, and
  -- the only way to guarantee that is for both to run the same code. Named arguments, so a column can
  -- never be passed in the wrong slot.
  NEW.event_hash := audit.event_hash_v1(audit.event_canonical_v1(
    p_previous_event_hash => NEW.previous_event_hash,
    p_audit_event_id      => NEW.audit_event_id,
    p_occurred_at         => NEW.occurred_at,
    p_actor_user_id       => NEW.actor_user_id,
    p_actor_role          => NEW.actor_role,
    p_action              => NEW.action,
    p_aggregate_type      => NEW.aggregate_type,
    p_aggregate_id        => NEW.aggregate_id,
    p_correlation_id      => NEW.correlation_id,
    p_request_id          => NEW.request_id,
    p_source              => NEW.source,
    p_safe_metadata       => NEW.safe_metadata,
    p_reason              => NEW.reason
  ));

  -- Advance the head. The row lock taken above is still held, so no other appender can interleave.
  UPDATE audit.audit_chain_head
     SET event_hash = NEW.event_hash, event_count = event_count + 1, updated_at = now()
   WHERE singleton;

  RETURN NEW;
END;
$$;
-- The head must exist before the first append can read it. One row, guarded by its own CHECK.
COMMENT ON FUNCTION audit.compute_event_chain() IS 'BEFORE INSERT on audit.audit_events: links the row to the chain tail and computes event_hash over the non-PII columns of THIS table only. The audit_event_details sidecar is excluded so PII can be redacted without breaking the chain (G-02).';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION audit.compute_event_chain() FROM PUBLIC;

-- KPLUS-F013(c). Append-only, enforced by the database rather than by convention. Note this is a
-- trigger and not merely a privilege: a privilege protects against roles that lack it, while a trigger
-- also protects against the role that owns the table — which is the role a migration or a compromised
-- service path actually runs as.
CREATE OR REPLACE FUNCTION audit.refuse_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'audit.% is append-only: % is refused (KPLUS-F013c). An audit log that can be rewritten records what someone last wanted it to say.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
COMMENT ON FUNCTION audit.refuse_mutation() IS 'BEFORE UPDATE/DELETE trigger: refuses the operation unconditionally. Append-only enforcement for the audit spine.';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION audit.refuse_mutation() FROM PUBLIC;

-- KPLUS-F019: the allocation invariants are cross-row, so they live in a trigger, not a CHECK.
CREATE OR REPLACE FUNCTION bolao.check_payment_allocation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pay_amount   numeric;
  pay_currency character(3);
  pay_kind     bolao.payment_kind;
  entry_ccy    character(3);
  allocated    numeric;
BEGIN
  -- FOR UPDATE, not a plain read. This is the serialisation point: concurrent allocations against one
  -- payment queue here, so the total below is computed against a state no other transaction can be
  -- changing. Without it two writers each see the same total and both pass their own check.
  SELECT p.amount, p.currency, p.kind INTO pay_amount, pay_currency, pay_kind
    FROM bolao.payments p WHERE p.payment_id = NEW.payment_id FOR UPDATE;

  IF pay_amount IS NULL THEN
    RAISE EXCEPTION 'payment % carries no amount and cannot be allocated', NEW.payment_id
      USING ERRCODE = 'check_violation',
            HINT = 'A payment with amount IS NULL is a legacy assertion that someone paid, not a record of how much. Allocating against it would invent a settled amount no evidence supports.';
  END IF;

  IF pay_amount <= 0 THEN
    RAISE EXCEPTION 'payment % has a non-positive amount (kind %) and is not allocatable', NEW.payment_id, pay_kind
      USING ERRCODE = 'check_violation',
            HINT = 'Allocations are positive by contract. A refund, reversal or chargeback is recorded as its own payment, not as a negative allocation of another one.';
  END IF;

  IF NEW.allocated_amount IS NULL OR NEW.allocated_amount <= 0 THEN
    RAISE EXCEPTION 'allocated_amount must be positive, got %', NEW.allocated_amount
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.currency <> pay_currency THEN
    RAISE EXCEPTION 'allocation currency % does not match payment currency %', NEW.currency, pay_currency
      USING ERRCODE = 'check_violation',
            HINT = 'Allocating across currencies silently applies an exchange rate of 1.0 to real money.';
  END IF;

  SELECT e.expected_fee_currency INTO entry_ccy
    FROM bolao.pool_entries e WHERE e.pool_entry_id = NEW.pool_entry_id;
  IF entry_ccy IS NOT NULL AND NEW.currency <> entry_ccy THEN
    RAISE EXCEPTION 'allocation currency % does not match the entry fee currency %', NEW.currency, entry_ccy
      USING ERRCODE = 'check_violation';
  END IF;

  -- The row being written is excluded so this is correct for an UPDATE as well as an INSERT.
  SELECT coalesce(sum(a.allocated_amount), 0) INTO allocated
    FROM bolao.payment_allocations a
    WHERE a.payment_id = NEW.payment_id AND a.allocation_id IS DISTINCT FROM NEW.allocation_id;

  IF allocated + NEW.allocated_amount > pay_amount THEN
    RAISE EXCEPTION 'allocating % would take payment % to % of a received %',
      NEW.allocated_amount, NEW.payment_id, allocated + NEW.allocated_amount, pay_amount
      USING ERRCODE = 'check_violation',
            HINT = 'There is deliberately NO cap against the entry fee — exceeding that is OVERPAID, a reportable state. This cap is against the money actually received.';
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION bolao.check_payment_allocation() IS 'BEFORE INSERT/UPDATE trigger on payment_allocations: locks the payment row, then enforces that the payment has a positive amount, that payment, allocation and entry currencies agree, and that the allocated total never exceeds the amount received.';

-- KPLUS-F023. EXECUTE is revoked from PUBLIC even though this function returns trigger and
-- therefore cannot be called at all. The grant is inert today; it is the DEFAULT that is the
-- defect, because the next function in this schema that returns something callable inherits it
-- silently -- audit.event_canonical_v1 and audit.event_hash_v1 are exactly that case, arriving
-- with KPLUS-F014. Revoking EXECUTE does not affect trigger firing: a trigger runs as part of
-- the table's own machinery, not as a call made by the writing role.
REVOKE ALL ON FUNCTION bolao.check_payment_allocation() FROM PUBLIC;

-- KPLUS-F020: contiguity and club_count are facts about a SET of rows, so they are checked at COMMIT.
CREATE OR REPLACE FUNCTION bolao.check_snapshot_completeness() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  snap_id      uuid;
  declared     integer;
  actual       integer;
  distinct_pos integer;
  max_pos      integer;
BEGIN
  -- Both tables carry this column: it is the snapshot's own key and the standings' foreign key, so one
  -- expression serves every table and every operation. OLD is used for DELETE, where NEW is null.
  snap_id := coalesce(NEW.classification_snapshot_id, OLD.classification_snapshot_id);

  SELECT s.club_count INTO declared
    FROM bolao.classification_snapshots s
   WHERE s.classification_snapshot_id = snap_id;
  -- The snapshot itself was removed in this transaction. There is no longer anything to be consistent
  -- with, and raising here would refuse a legitimate teardown rather than catch an inconsistency.
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), count(DISTINCT st.position), max(st.position)
    INTO actual, distinct_pos, max_pos
    FROM bolao.competition_edition_standings st
   WHERE st.classification_snapshot_id = snap_id;

  IF actual <> declared THEN
    RAISE EXCEPTION 'classification snapshot % declares club_count=% but holds % standing row(s)', snap_id, declared, actual
      USING ERRCODE = 'check_violation',
            HINT = 'club_count is what consumers trust to know whether they received a whole league table. A snapshot that overstates it reports a complete table while a club is missing, and the BR2026 zone slices are taken from that list.';
  END IF;

  -- Contiguity, without sorting: the position CHECK already forces every value positive, so N distinct
  -- positive values whose maximum is N can only be exactly 1..N. Stating it this way means the check is
  -- one aggregate rather than a scan of an ordered sequence looking for a step.
  IF actual > 0 AND (distinct_pos <> actual OR max_pos <> actual) THEN
    RAISE EXCEPTION 'classification snapshot % has non-contiguous positions: % row(s), % distinct position(s), highest position %', snap_id, actual, distinct_pos, max_pos
      USING ERRCODE = 'check_violation',
            HINT = 'Positions must be the contiguous range 1..N because the G4/Z4 zones are slices of it. A gap silently moves the boundary, changing which clubs are recorded as qualified or relegated — and the bolao is scored on that.';
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION bolao.check_snapshot_completeness() IS 'DEFERRED constraint trigger on classification_snapshots and competition_edition_standings: at COMMIT, club_count must equal the standing rows that exist and their positions must be the contiguous range 1..N. Cross-row facts, so not expressible as a CHECK. See KPLUS-F020 and ADR-K09.';
REVOKE ALL ON FUNCTION bolao.check_snapshot_completeness() FROM PUBLIC;

-- KPLUS-D01 (second half): a pool may not declare more prize money than it collected.
CREATE OR REPLACE FUNCTION bolao.check_prize_pool_solvency() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p_id     uuid;
  offender record;
BEGIN
  IF TG_TABLE_NAME = 'prize_allocations' THEN
    p_id := coalesce(NEW.pool_id, OLD.pool_id);
  ELSE
    -- payment_allocations: the pool is one hop away, through the entry the payment was applied to.
    SELECT e.pool_id INTO p_id FROM bolao.pool_entries e
     WHERE e.pool_entry_id = coalesce(NEW.pool_entry_id, OLD.pool_entry_id);
  END IF;
  IF p_id IS NULL THEN RETURN NULL; END IF;

  /**
   * Compared PER CURRENCY, not on one total.
   *
   * Summing gross_amount across currencies would compare a number that is not an amount of anything
   * against another number that is not an amount of anything, and the comparison could pass while the
   * pool is insolvent in the currency it actually owes. Grouping makes the check sound without this
   * function having to also decide whether a declaration may mix currencies, which is a separate rule.
   */
  SELECT * INTO offender FROM (
    SELECT coalesce(d.currency, c.currency) AS ccy,
           coalesce(d.declared, 0) AS declared,
           coalesce(c.collected, 0) AS collected
      FROM (SELECT pz.currency, sum(pz.gross_amount) AS declared
              FROM bolao.prize_allocations pz WHERE pz.pool_id = p_id GROUP BY pz.currency) d
      FULL JOIN (SELECT pa.currency, sum(pa.allocated_amount) AS collected
                   FROM bolao.payment_allocations pa
                   JOIN bolao.pool_entries e ON e.pool_entry_id = pa.pool_entry_id
                  WHERE e.pool_id = p_id GROUP BY pa.currency) c ON c.currency = d.currency
  ) t
  WHERE t.declared > t.collected
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'pool % declares % % in prizes but collected only %', p_id, offender.declared, offender.ccy, offender.collected
      USING ERRCODE = 'check_violation',
            HINT = 'Paying out more than was collected is unrecoverable, which is why recordPrize states it as an invariant. Note that a pool whose payments are not yet ALLOCATED to entries reads as having collected nothing — that is the fail-closed direction, and it is the same KPLUS-OP-4(a) dependency that stops the financial reports.';
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION bolao.check_prize_pool_solvency() IS 'DEFERRED constraint trigger: at COMMIT, per currency, a pool''s declared prize gross may not exceed what its entries collected in allocated payments. recordPrize states this invariant; Workstream N measured the database accepting a violation. See KPLUS-D01 and ADR-K09.';
REVOKE ALL ON FUNCTION bolao.check_prize_pool_solvency() FROM PUBLIC;

COMMIT;

-- NOTE ON ENUMS: ALTER TYPE ... ADD VALUE cannot run inside a transaction block and cannot be
-- rolled back. Adding a value later is therefore its own migration, and removing one is not
-- possible at all — which is why each vocabulary above is closed deliberately rather than casually.
