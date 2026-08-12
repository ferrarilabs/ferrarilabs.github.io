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
-- M15 — match location, tie lock provenance and the official draw
-- ============================================================
--
-- PURPOSE. Five additive nullable columns for five live document fields that had nowhere to go:
--  bolao.matches.venue and .city, bolao.ties.locked_at and .locked_by, and
--  bolao.competition_edition_phases.official_draw. All five were found by PRODMIG-M15's FIELD-level
--  read-surface contract, after element-level accounting had reported 56 of 56 matches and 28 of 28 ties
--  migrated — which was true, and was concealing every one of them. official_draw is deliberately NOT
--  folded into the existing `topology` column: a draw EVENT and a bracket SHAPE are different facts,
--  `draw_state` is declared derived from the draw, and hiding the draw inside a column named topology is
--  what produced M15-F2. In the same pass `topology` loses its declared legacyPath `phases{}.topology`, a
--  key none of the three production documents carries.
--
-- DEPENDENCIES: M6
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
-- BACKFILL REQUIREMENT. a separate step reads the five values out of bolao_state['cdb2026'] — 12 venues, 12
--  cities, 8 locked_at, 8 locked_by, 1 official_draw. This stage adds the columns and writes nothing.
-- APPLICATION COMPATIBILITY. TOTAL. Five additive nullable columns; the legacy app does not read the target
--  schema. ADD COLUMN with no DEFAULT and no NOT NULL is catalogue-only in PostgreSQL 11+, so no table is
--  rewritten and no lock is held for a scan.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL. ALTER TABLE ... DROP COLUMN, five times. Safe while the
--  columns are empty; once the backfill has run, dropping them discards the only normalized copy of
--  operator lock provenance and the official draw record — so after backfill this is FORWARD_FIX_ONLY, for
--  the same reason M8 is.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M6 is recorded as applied
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

ALTER TABLE bolao."competition_edition_phases" ADD COLUMN IF NOT EXISTS "official_draw" jsonb;
COMMENT ON COLUMN bolao."competition_edition_phases"."official_draw" IS 'The official draw record for this phase: the event that fixed its bracket, with its authority, sources, corroboration, hashes and validation stamps. Kept as its own column and NOT folded into `topology`, which is declared for bracket TOPOLOGY — a draw event and a bracket shape are different facts, and `draw_state` is explicitly DERIVED from this one, so hiding it inside a differently-named column is what produced M15-F2 in the first place.';
-- SOURCE. bolao_state['cdb2026'].phases{}.officialDraw. Measured 2026-08-12: present on `quartas` only,
--  carrying authority, event, source, sourceUrl, corroboratedBy, bracketHash, ingestedAt, scheduledAt,
--  validatedAt, validatedBy and note. Consumed by enforceDrawLifecycle() in bolao/cdb2026/js/app.js, which
--  wipes a gated phase's ties unless officialDraw.validatedAt is present — so this object currently gates
--  whether a phase's ties are shown at all.
-- NULL. NULL means no official draw has been recorded for that phase. Eight of cdb2026's nine phases are in
--  that state, and it is not the same as an empty draw: a phase with no draw is gated shut, a phase with an
--  empty one would claim a draw happened and produced nothing.
-- NO DEFAULT. deliberately no DEFAULT. An empty object would assert that a draw occurred.

ALTER TABLE bolao."ties" ADD COLUMN IF NOT EXISTS "locked_at" timestamptz;
COMMENT ON COLUMN bolao."ties"."locked_at" IS 'When this tie was frozen by an operator. Operator-action provenance on a result-bearing object: after a tie is locked its picks can no longer be edited, so this is the instant that decided which predictions counted.';
-- SOURCE. bolao_state['cdb2026'].phases{}.ties{}.lockedAt. Measured 2026-08-12: present on 8 of 28 ties.
--  Found by PRODMIG-M15-F4.
-- TIMEZONE. an absolute instant, stored as timestamptz. The source strings are ISO-8601 with a Z suffix.
-- NULL. NULL means the tie was never locked. That is the ordinary state for 20 of the 28 ties and must not
--  be confused with 'locked at an unknown time'.
-- MUTABILITY. written once when an operator locks the tie. Not immutable by trigger: an operator may
--  unlock, and forcing immutability here would make a legitimate correction impossible.
-- NO DEFAULT. deliberately no DEFAULT. A now() default would record every unlocked tie as having been
--  locked at migration time — a fabricated operator action.

ALTER TABLE bolao."ties" ADD COLUMN IF NOT EXISTS "locked_by" text;
COMMENT ON COLUMN bolao."ties"."locked_by" IS 'Who froze this tie. Kept as the source''s own actor label rather than resolved to a participant_id: the value is an operator/automation identifier, not a pool participant, and mapping it onto the identity graph would assert a link the source does not make.';
-- SOURCE. bolao_state['cdb2026'].phases{}.ties{}.lockedBy. Measured 2026-08-12: present on the same 8 ties
--  that carry lockedAt.
-- NULL. NULL means no operator lock is recorded. Paired with locked_at: the source carries them together on
--  all 8.
-- NO DEFAULT. deliberately no DEFAULT.

ALTER TABLE bolao."matches" ADD COLUMN IF NOT EXISTS "venue" text;
COMMENT ON COLUMN bolao."matches"."venue" IS 'The stadium a leg is played at, as the provider named it. Free text, not a reference: there is no venues entity and inventing one would assert that two spellings of the same ground are the same ground, which the source does not establish.';
-- SOURCE. bolao_state['cdb2026'].phases{}.ties{}.matches{}.venue. Measured 2026-08-12: present on all 56
--  legs, non-null on 12. Discovered by PRODMIG-M15's FIELD-level contract after element-level accounting
--  had reported 56 of 56 matches migrated — which was true, and was concealing this.
-- NULL. NULL means the provider did not publish a venue for that leg. It is not 'unknown to us' and must
--  not be filled from the home team's usual ground: 44 of the 56 legs genuinely carry no venue, and the
--  ones that do come from the ESPN payload.
-- NO DEFAULT. deliberately no DEFAULT. A fabricated venue is a factual claim about where a match was
--  played.

ALTER TABLE bolao."matches" ADD COLUMN IF NOT EXISTS "city" text;
COMMENT ON COLUMN bolao."matches"."city" IS 'The city a leg is played in, as the provider named it. Stored beside venue rather than derived from it — the source supplies both independently and neither determines the other.';
-- SOURCE. bolao_state['cdb2026'].phases{}.ties{}.matches{}.city. Measured 2026-08-12: non-null on 12 legs,
--  the same 12 that carry a venue.
-- NULL. NULL means the provider did not publish a city. Deliberately NOT derived from venue: the two travel
--  together in the source today, and encoding that coincidence as a rule would break the first time a venue
--  arrives without one.
-- NO DEFAULT. deliberately no DEFAULT.

COMMIT;
