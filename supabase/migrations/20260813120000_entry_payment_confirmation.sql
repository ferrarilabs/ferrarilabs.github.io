--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813120000_entry_payment_confirmation.sql
--
-- ═══ KPLUS-OP-4A — WHAT THE LEGACY `paid` FLAG ACTUALLY ASSERTS ══════════════════════════════
--
-- The operator resolved the semantics; this table is that resolution given a shape. A row here
-- means EXACTLY ONE THING:
--
--     this source entry was explicitly marked as paid by the legacy operational process.
--
-- It does not mean a payment transaction exists, that an amount or a payer or a currency is
-- known, that the owner of the entry is who paid, that settlement completed, or that a balance
-- is zero. None of those facts are in the source, so none of them are in this table, and the
-- column names are chosen so that no reader can mistake one for the other. `settled`,
-- `balance_paid`, `payment_complete`, `paid_in_full` and `amount_paid` are all forbidden names
-- for this relation and none of them appear.
--
-- KPLUS-OP-4B — the actual financial accounting — remains PARKED. `bolao.payments`,
-- `bolao.payment_allocations` and `bolao.prize_allocations` stay at zero rows. This table is
-- deliberately NOT one of them and deliberately does not reference them: a confirmation is an
-- OPERATIONAL ASSERTION, and wiring it to the finance model would make it a financial fact by
-- adjacency, which is precisely the guess KPLUS-OP-4 exists to prevent.
--
-- ═══ POSITIVE ASSERTIONS ONLY, AND WHY THAT IS THE HONEST SHAPE ══════════════════════════════
--
-- All 50 stored flags in the source are `true`. Not one is `false`. The legacy contract only ever
-- records a positive confirmation, so `paid[x]` being absent has never meant "x owes money" — it
-- has meant nobody wrote anything down. `confirmed_paid` is therefore CHECKed to be true and the
-- table holds no negative rows: storing 0 false rows is not a gap, it is the source's own shape.
--
-- The public projection derives falsity by absence:
--
--     paid[entry] is true  iff  a source-backed confirmation exists for that entry
--
-- ABSENCE IS NOT AN ACCOUNTING PROOF OF AN UNPAID BALANCE. It is the absence of a source-backed
-- paid confirmation. Any future reader tempted to sum "unconfirmed" entries into a receivable is
-- reading a fact that this table does not contain.
--
-- ═══ THE NULLABLE FK, AND THE ORPHAN BUCKET IT IS NOT ═══════════════════════════════════════
--
-- 46 of the 50 assertions point at an entry that still exists. FOUR — all Copa — point at entries
-- the document lists in `deletedIds`. They are historically true and must stay representable:
-- discarding them would silently reduce a measured 50 to a convenient 46, and attaching them to
-- some surviving entry to satisfy an FK would be worse, because it would move a real payment
-- confirmation onto the wrong person.
--
-- So `pool_entry_id` is NULLABLE — and that NULL is prevented from meaning "unidentified" by two
-- constraints working together:
--
--   · `source_entry_key` is NOT NULL on every row, tombstoned or not. Every assertion names its
--     source entry, so every assertion is auditable back to the document.
--   · `entry_disposition` is a closed vocabulary and `epc_link_matches_disposition` ties it to
--     the FK: CURRENT_ENTRY requires the link, HISTORICAL_TOMBSTONED forbids it. A NULL FK is
--     therefore never merely missing — it is a POSITIVE CLAIM that the entry is gone, and a row
--     cannot sit in between.
--
-- Without that pairing a nullable FK degrades into a bucket where "we could not resolve this" and
-- "this genuinely has no live entry" are the same row.
--
-- ═══ UNIQUENESS IS THE SOURCE ASSERTION, NOT THE PAYER ══════════════════════════════════════
--
-- (pool_id, source_entry_key). The identity of an assertion is WHICH SOURCE FACT it is, and the
-- source fact is one key in one pool's `paid` object. Email and payer are deliberately absent
-- from the key and from the table: one person may pay for several entries and one entry may have
-- been paid by someone else entirely, so keying on a payer would collapse distinct assertions and
-- invent a relationship the source never recorded.
--
-- Re-running the backfill therefore inserts nothing: ON CONFLICT DO NOTHING against this index is
-- what makes the 50-row load idempotent — 0 new rows, 0 mutations, 0 new lineage.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- PLATFORM_SHARED · ADDITIVE_DDL only. One new table in the bolao schema. No existing object is
-- altered, dropped or read. Constraints are declared inline and validated immediately, which is
-- correct HERE and only here: the table is new and empty, so validation scans zero rows.
--
-- APPLICATION COMPATIBILITY. TOTAL. Nothing is granted to any browser role; the apps read
-- public.bolao_state_public and cannot reach this table. It stays empty until a separate,
-- separately-verified backfill loads exactly 50 rows.
--
-- ROLLBACK (FULL). DROP TABLE bolao.entry_payment_confirmation. Every row is re-derivable from
-- public.bolao_state[*].paid for as long as legacy is retained, and legacy is retained. Once the
-- public read path derives `paid` from this table the class becomes FORWARD_FIX_ONLY: dropping it
-- would unpay 50 participants in public.
--
-- PRECHECKS: the table does not exist · bolao.pools and bolao.pool_entries exist · backup verified
-- POSTCHECKS: RLS enabled + FORCE + zero policies · every FK/CHECK convalidated · index valid ·
--             no GRANT to anon or authenticated · payments/payment_allocations/prize_allocations
--             all still 0 rows
--

BEGIN;

CREATE TABLE IF NOT EXISTS bolao.entry_payment_confirmation (
  entry_payment_confirmation_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope. The source `paid` object is per document, so an assertion is only meaningful inside
  -- its pool: the same uuid in two pools would be two unrelated facts.
  pool_id                       uuid        NOT NULL,

  -- Source identity. MANDATORY on every row including the tombstoned ones — this is what stops
  -- a NULL pool_entry_id from meaning "we do not know which entry this was".
  source_entry_key              uuid        NOT NULL,

  -- Resolution. NULL only when entry_disposition says the entry is historically gone.
  pool_entry_id                 uuid,

  entry_disposition             text        NOT NULL,

  -- The assertion itself. CHECKed true: this relation stores confirmations, never denials.
  confirmed_paid                boolean     NOT NULL,

  -- Provenance, in the same vocabulary audit.migration_lineage uses, so a confirmation can be
  -- audited without a join to prove where it came from.
  source_relation               text        NOT NULL,
  source_path                   text        NOT NULL,
  source_fingerprint            text        NOT NULL,
  migration_run_id              uuid        NOT NULL,
  transform_version             text        NOT NULL,

  -- When this campaign MIGRATED the assertion. Emphatically not when the payment was confirmed:
  -- the source carries no timestamp for that and one is not invented. A column called
  -- confirmed_at defaulting to now() would have dated 50 historical operational decisions to the
  -- afternoon of the migration and looked entirely plausible doing it.
  migrated_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entry_payment_confirmation_pool_id_fkey
    FOREIGN KEY (pool_id) REFERENCES bolao.pools (pool_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT entry_payment_confirmation_pool_entry_id_fkey
    FOREIGN KEY (pool_entry_id) REFERENCES bolao.pool_entries (pool_entry_id) ON UPDATE RESTRICT ON DELETE RESTRICT,

  CONSTRAINT epc_positive_assertions_only
    CHECK (confirmed_paid),
  CONSTRAINT epc_disposition_known
    CHECK (entry_disposition IN ('CURRENT_ENTRY', 'HISTORICAL_TOMBSTONED')),
  CONSTRAINT epc_link_matches_disposition
    CHECK ((entry_disposition = 'CURRENT_ENTRY'        AND pool_entry_id IS NOT NULL)
        OR (entry_disposition = 'HISTORICAL_TOMBSTONED' AND pool_entry_id IS NULL)),
  CONSTRAINT epc_source_identity_present
    CHECK (length(btrim(source_relation)) > 0
       AND length(btrim(source_path)) > 0
       AND length(btrim(source_fingerprint)) > 0)
);

COMMENT ON TABLE bolao.entry_payment_confirmation IS
  'A source-backed positive assertion that a legacy entry was marked paid by the legacy operational process. NOT a payment transaction: no amount, no payer, no currency, no settlement, no balance — none of those facts exist in the source. Absence of a row is absence of a confirmation, never an accounting claim that a balance is owed. KPLUS-OP-4A closed; KPLUS-OP-4B (financial accounting) remains parked and bolao.payments stays empty.';

COMMENT ON COLUMN bolao.entry_payment_confirmation.source_entry_key IS
  'The entry id in the legacy document''s paid{} object. NOT NULL on every row, tombstoned included: it is what guarantees a nullable pool_entry_id can never mean "source unidentified".';
COMMENT ON COLUMN bolao.entry_payment_confirmation.pool_entry_id IS
  'The current entry this assertion resolves to, or NULL when entry_disposition is HISTORICAL_TOMBSTONED. NULL is a positive claim that the entry no longer exists, not an unresolved lookup — epc_link_matches_disposition makes the two states mutually exclusive.';
COMMENT ON COLUMN bolao.entry_payment_confirmation.entry_disposition IS
  'CURRENT_ENTRY (46 assertions) or HISTORICAL_TOMBSTONED (4 Copa assertions whose entries the document lists in deletedIds). Closed vocabulary; a third disposition needs a migration, not a write.';
COMMENT ON COLUMN bolao.entry_payment_confirmation.confirmed_paid IS
  'Always true, by CHECK. The legacy contract only ever recorded positive confirmations — all 50 stored flags are true and not one is false — so a negative row would be a fact the source never asserted.';
COMMENT ON COLUMN bolao.entry_payment_confirmation.migrated_at IS
  'When this campaign migrated the assertion. NOT when the payment was confirmed: the source records no such timestamp and none is manufactured.';

CREATE UNIQUE INDEX IF NOT EXISTS entry_payment_confirmation_pool_id_source_entry_key_uidx
  ON bolao.entry_payment_confirmation (pool_id, source_entry_key);

CREATE INDEX IF NOT EXISTS entry_payment_confirmation_pool_entry_id_idx
  ON bolao.entry_payment_confirmation (pool_entry_id) WHERE pool_entry_id IS NOT NULL;

ALTER TABLE bolao.entry_payment_confirmation ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.entry_payment_confirmation FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.entry_payment_confirmation FROM PUBLIC;

COMMIT;
