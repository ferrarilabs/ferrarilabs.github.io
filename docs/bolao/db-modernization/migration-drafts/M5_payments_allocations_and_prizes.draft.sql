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
-- M5 — payments, allocations and prizes
-- ============================================================
--
-- PURPOSE. The money tables. No stored settlement column exists by design: settlement is derived from
--  payment_allocations, and a stored flag would be a second source of truth for money.
--
-- DEPENDENCIES: M4
-- TABLES CREATED: bolao.payments, bolao.payment_allocations, bolao.prize_allocations
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
--  receive nothing in this phase. Intended eventual access: payments[anon:none],
--  payment_allocations[anon:none], prize_allocations[anon:none]
-- PII EFFECT. Introduces 6 PII-bearing column(s): payments.external_reference:SENSITIVE_SNAPSHOT,
--  payments.memo:SENSITIVE_SNAPSHOT, payments.proof_object_path:SENSITIVE_SNAPSHOT,
--  payments.created_by:PSEUDONYMOUS_ID, payment_allocations.allocated_by:PSEUDONYMOUS_ID,
--  prize_allocations.payout_external_reference:SENSITIVE_SNAPSHOT. All are unreadable until a policy grants
--  access.
-- BACKFILL REQUIREMENT. M9-backfill creates one asserted payment per legacy paid=true with amount NULL and
--  NO allocation
-- APPLICATION COMPATIBILITY. TOTAL — additive; all writes service-only.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL before backfill. After backfill DATA-RESTORE-REQUIRED for
--  any allocation an operator has since made, because an allocation records a human decision that cannot be
--  recomputed.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M4 is recorded as applied
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

CREATE TABLE bolao."payments" (
  "payment_id"                       uuid NOT NULL DEFAULT gen_random_uuid(),
  "payer_participant_id"             uuid,
  "amount"                           numeric(14,2),
  "currency"                         char(3),
  "kind"                             bolao.payment_kind NOT NULL,
  "method"                           text,
  "provider"                         text,
  "external_reference"               text,
  "paid_at"                          timestamptz,
  "reverses_payment_id"              uuid,
  "memo"                             text,
  "proof_object_path"                text,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  "created_by"                       uuid,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("payment_id"),
  CONSTRAINT "payments_payer_participant_id_fkey" FOREIGN KEY ("payer_participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES bolao."payments" ("payment_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "pay_no_self_reverse" CHECK (reverses_payment_id IS NULL OR reverses_payment_id <> payment_id),
  CONSTRAINT "pay_amount_currency_together" CHECK ((amount IS NULL) = (currency IS NULL)),
  CONSTRAINT "pay_amount_sign" CHECK (amount IS NULL OR (kind IN ('refund','reversal','chargeback') AND amount < 0) OR (kind NOT IN ('refund','reversal','chargeback') AND amount > 0))
);

COMMENT ON TABLE bolao."payments" IS 'An inbound money movement as it actually happened. Deliberately NOT tied to a single entry — a payer may fund several.';
COMMENT ON COLUMN bolao."payments"."external_reference" IS 'PII class: SENSITIVE_SNAPSHOT';
COMMENT ON COLUMN bolao."payments"."memo" IS 'PII class: SENSITIVE_SNAPSHOT';
COMMENT ON COLUMN bolao."payments"."proof_object_path" IS 'PII class: SENSITIVE_SNAPSHOT';
COMMENT ON COLUMN bolao."payments"."created_by" IS 'PII class: PSEUDONYMOUS_ID';
-- NOTE: payments.(derived) is DERIVED_VIEW and is deliberately NOT a column.
-- CHECK pay_no_self_reverse: a payment cannot reverse itself
-- CHECK pay_amount_currency_together: an amount without a currency is not money
-- CHECK pay_amount_sign: sign convention is explicit rather than assumed; zero is never valid

ALTER TABLE bolao."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."payments" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."payments" FROM PUBLIC;

CREATE TABLE bolao."payment_allocations" (
  "allocation_id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
  "payment_id"                       uuid NOT NULL,
  "pool_entry_id"                    uuid NOT NULL,
  "allocated_amount"                 numeric(14,2) NOT NULL,
  "currency"                         char(3) NOT NULL,
  "allocated_at"                     timestamptz NOT NULL DEFAULT now(),
  "allocated_by"                     uuid,
  "note"                             text,
  CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("allocation_id"),
  CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES bolao."payments" ("payment_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payment_allocations_pool_entry_id_fkey" FOREIGN KEY ("pool_entry_id") REFERENCES bolao."pool_entries" ("pool_entry_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "payment_allocations_allocated_by_fkey" FOREIGN KEY ("allocated_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT
);

COMMENT ON TABLE bolao."payment_allocations" IS 'Applies part of a payment to a specific entry. Resolves the real many-to-many: one payment may fund several entries; one entry may be funded by several payments.';
COMMENT ON COLUMN bolao."payment_allocations"."allocated_by" IS 'PII class: PSEUDONYMOUS_ID';

ALTER TABLE bolao."payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."payment_allocations" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."payment_allocations" FROM PUBLIC;

-- The allocation invariants are enforced for EVERY writer, not only for callers that remember
-- to take the payment row lock themselves. See KPLUS-F019 and ADR-K03.
CREATE TRIGGER "payment_allocations_check"
  BEFORE INSERT OR UPDATE ON bolao."payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION bolao.check_payment_allocation();

-- KPLUS-D01. Not INSERT: an allocation can only raise what a pool collected, so only lowering or removing one can make a declared prize table insolvent.
CREATE CONSTRAINT TRIGGER "payment_allocations_prize_solvency"
  AFTER UPDATE OR DELETE ON bolao."payment_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bolao.check_prize_pool_solvency();

CREATE TABLE bolao."prize_allocations" (
  "prize_allocation_id"              uuid NOT NULL DEFAULT gen_random_uuid(),
  "pool_id"                          uuid NOT NULL,
  "pool_entry_id"                    uuid NOT NULL,
  "participant_id"                   uuid NOT NULL,
  "rank"                             integer NOT NULL,
  "gross_amount"                     numeric(14,2) NOT NULL,
  "net_amount"                       numeric(14,2),
  "currency"                         char(3) NOT NULL,
  "share_of_pool"                    numeric(6,5),
  "awarded_at"                       timestamptz NOT NULL DEFAULT now(),
  "paid_out_at"                      timestamptz,
  "payout_external_reference"        text,
  "payout_method"                    text,
  CONSTRAINT "prize_allocations_pkey" PRIMARY KEY ("prize_allocation_id"),
  CONSTRAINT "prize_allocations_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES bolao."pools" ("pool_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "prize_allocations_pool_entry_id_fkey" FOREIGN KEY ("pool_entry_id") REFERENCES bolao."pool_entries" ("pool_entry_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "prize_allocations_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES bolao."participants" ("participant_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "prz_net_le_gross" CHECK (net_amount IS NULL OR net_amount <= gross_amount)
);

COMMENT ON TABLE bolao."prize_allocations" IS 'OUTBOUND money: a prize awarded to an entry. Kept strictly separate from entry payments — conflating inbound and outbound makes reconciliation ambiguous.';
COMMENT ON COLUMN bolao."prize_allocations"."payout_external_reference" IS 'PII class: SENSITIVE_SNAPSHOT';
-- CHECK prz_net_le_gross: net cannot exceed gross

ALTER TABLE bolao."prize_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."prize_allocations" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."prize_allocations" FROM PUBLIC;

-- KPLUS-D01. Checked at COMMIT because recordPrize inserts the whole prize table in one statement group.
CREATE CONSTRAINT TRIGGER "prize_allocations_solvency"
  AFTER INSERT OR UPDATE ON bolao."prize_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bolao.check_prize_pool_solvency();

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- makes double-recording a payment reference impossible; observed firing 11/11 on inserts in production
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "payments_external_reference_uidx" ON bolao."payments" (external_reference) WHERE external_reference IS NOT NULL;
-- 'everything this person paid' — the payment-history report
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_payer_participant_id_idx" ON bolao."payments" (payer_participant_id);
-- find the reversal of a payment without scanning
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_reverses_payment_id_idx" ON bolao."payments" (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
-- sum allocations per entry — the settlement derivation; the single most important index in the financial domain
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payment_allocations_pool_entry_id_idx" ON bolao."payment_allocations" (pool_entry_id);
-- one allocation row per (payment, entry) pair; adjust by amending the row, not by adding a second
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "payment_allocations_payment_id_pool_entry_id_uidx" ON bolao."payment_allocations" (payment_id, pool_entry_id);
-- 'everything this person won' — the winnings report
CREATE INDEX CONCURRENTLY IF NOT EXISTS "prize_allocations_participant_id_idx" ON bolao."prize_allocations" (participant_id);
-- prize per entry
CREATE INDEX CONCURRENTLY IF NOT EXISTS "prize_allocations_pool_entry_id_idx" ON bolao."prize_allocations" (pool_entry_id);
-- an entry cannot be awarded the same rank twice, while a rank may still be split across entries
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "prize_allocations_pool_id_rank_pool_entry_id_uidx" ON bolao."prize_allocations" (pool_id, rank, pool_entry_id);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['payments_external_reference_uidx', 'payments_payer_participant_id_idx', 'payments_reverses_payment_id_idx', 'payment_allocations_pool_entry_id_idx', 'payment_allocations_payment_id_pool_entry_id_uidx', 'prize_allocations_participant_id_idx', 'prize_allocations_pool_entry_id_idx', 'prize_allocations_pool_id_rank_pool_entry_id_uidx']);
-- Expected: zero rows.
