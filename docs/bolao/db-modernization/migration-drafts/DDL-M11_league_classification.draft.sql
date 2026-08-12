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
-- DDL-M11 — league classification
-- ============================================================
--
-- PURPOSE. classification_snapshots and competition_edition_standings: the league table br2026 scoring
--  consumes. Created because no existing entity can hold it — match_results requires goals,
--  ranking_snapshots is keyed on pool_entry_id (a participant, not a club), and ties/matches are knockout
--  pairings. G4/Z4/SA6 are POSITION SLICES of this table and are therefore derived, never stored.
--
-- DEPENDENCIES: M6
-- TABLES CREATED: bolao.classification_snapshots, bolao.competition_edition_standings
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
--  receive nothing in this phase. Intended eventual access: classification_snapshots[anon:SELECT],
--  competition_edition_standings[anon:SELECT]
-- PII EFFECT. Introduces 1 PII-bearing column(s): classification_snapshots.created_by:PSEUDONYMOUS_ID. All
--  are unreadable until a policy grants access.
-- BACKFILL REQUIREMENT. one snapshot per persisted provider file
--  (bolao/br2026/data/espn-standings-normalized.json). Historical snapshots are NOT reconstructable: the
--  cron overwrites the file, so only the current classification exists and earlier ones were never
--  retained.
-- APPLICATION COMPATIBILITY. TOTAL — additive. The browser reads the provider snapshot directly today and
--  continues to; nothing about the app's own path changes.
-- ROLLBACK STRATEGY (FULL_BEFORE_BACKFILL). FULL before any snapshot is imported — DROP TABLE
--  competition_edition_standings then classification_snapshots, in that order because the FK points that
--  way. After import, FORWARD_FIX_ONLY: a snapshot is provider evidence retrieved at an instant that cannot
--  be re-retrieved, and it is exactly what a past round's zone boundaries were computed against.
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

CREATE TABLE bolao."classification_snapshots" (
  "classification_snapshot_id"       uuid NOT NULL DEFAULT gen_random_uuid(),
  "competition_edition_id"           uuid NOT NULL,
  "provider"                         text NOT NULL,
  "provider_competition_ref"         text,
  "source_url"                       text,
  "schema_version"                   integer NOT NULL,
  "generated_at"                     timestamptz NOT NULL,
  "source_updated_at"                timestamptz,
  "retrieved_at"                     timestamptz NOT NULL DEFAULT now(),
  "payload_hash"                     text NOT NULL,
  "is_stale"                         boolean NOT NULL DEFAULT false,
  "stale_reason"                     text,
  "club_count"                       integer NOT NULL,
  "created_by"                       uuid,
  "created_at"                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "classification_snapshots_pkey" PRIMARY KEY ("classification_snapshot_id"),
  CONSTRAINT "classification_snapshots_competition_edition_id_fkey" FOREIGN KEY ("competition_edition_id") REFERENCES bolao."competition_editions" ("competition_edition_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "classification_snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES auth."users" ("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "classification_snapshots_club_count_positive" CHECK (club_count > 0),
  CONSTRAINT "classification_snapshots_stale_has_reason" CHECK (is_stale IS FALSE OR stale_reason IS NOT NULL)
);

COMMENT ON TABLE bolao."classification_snapshots" IS 'One retrieval of a league classification for a competition edition. The ENVELOPE only: who provided it, when, whether it is stale, and whether a later correction supersedes it. The club rows live in competition_edition_standings. Modelled because br2026 scoring consumes the league table and no existing entity can hold it: match_results requires goals, ranking_snapshots is keyed on pool_entry_id (a participant, not a club), and ties/matches are knockout pairings.';
COMMENT ON COLUMN bolao."classification_snapshots"."created_by" IS 'PII class: PSEUDONYMOUS_ID';
-- CHECK classification_snapshots_club_count_positive: an empty classification is not a classification
-- CHECK classification_snapshots_stale_has_reason: a stale snapshot must say why, or it cannot be triaged

ALTER TABLE bolao."classification_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."classification_snapshots" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."classification_snapshots" FROM PUBLIC;

-- KPLUS-F020. Checked at COMMIT: a snapshot is incomplete for most of its own insert, so this cannot be immediate.
CREATE CONSTRAINT TRIGGER "classification_snapshots_completeness"
  AFTER INSERT OR UPDATE ON bolao."classification_snapshots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bolao.check_snapshot_completeness();

CREATE TABLE bolao."competition_edition_standings" (
  "standing_id"                      uuid NOT NULL DEFAULT gen_random_uuid(),
  "classification_snapshot_id"       uuid NOT NULL,
  "position"                         integer NOT NULL,
  "provider_rank"                    integer,
  "club_name"                        text NOT NULL,
  "club_abbr"                        text,
  "points"                           integer,
  "played"                           integer,
  "wins"                             integer,
  "draws"                            integer,
  "losses"                           integer,
  "goals_for"                        integer,
  "goals_against"                    integer,
  "goal_difference"                  integer,
  CONSTRAINT "competition_edition_standings_pkey" PRIMARY KEY ("standing_id"),
  CONSTRAINT "competition_edition_standings_classification_snapshot_id_fkey" FOREIGN KEY ("classification_snapshot_id") REFERENCES bolao."classification_snapshots" ("classification_snapshot_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "competition_edition_standings_position_positive" CHECK (position > 0),
  CONSTRAINT "competition_edition_standings_gd_consistent" CHECK (goals_for IS NULL OR goals_against IS NULL OR goal_difference IS NULL OR goal_difference = goals_for - goals_against),
  CONSTRAINT "competition_edition_standings_counts_non_negative" CHECK ((played IS NULL OR played >= 0) AND (wins IS NULL OR wins >= 0) AND (draws IS NULL OR draws >= 0) AND (losses IS NULL OR losses >= 0) AND (goals_for IS NULL OR goals_for >= 0) AND (goals_against IS NULL OR goals_against >= 0))
);

COMMENT ON TABLE bolao."competition_edition_standings" IS 'One club''s line in one classification snapshot: its resolved position and its league statistics. This is a LEAGUE TABLE row, not a participant ranking — ranking_snapshots is the participant concept and is keyed on pool_entry_id. br2026''s G4/Z4/SA6 zones are pure POSITION SLICES of this table (G4 = 1-4, SA6 = 7-12, Z4 = 17-20), so no zone membership is stored: it is derived from position plus the competition''s own rules. Evidence: bolao/br2026/scripts/send_round_email.py:448-450 and bolao/br2026/js/app.js:629-631 (identical slicing in both), plus the persisted snapshot bolao/br2026/data/espn-standings-normalized.json.';
-- CHECK competition_edition_standings_position_positive: position is 1-based; a zero or negative position would shift every zone slice
-- CHECK competition_edition_standings_gd_consistent: the source supplies goal difference independently of the goal counts; if they disagree the row is not trustworthy and must be refused rather than reconciled by guesswork
-- CHECK competition_edition_standings_counts_non_negative: a negative match or goal count is impossible and would indicate a parse error

ALTER TABLE bolao."competition_edition_standings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao."competition_edition_standings" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."competition_edition_standings" FROM PUBLIC;

-- KPLUS-F020. DELETE included: removing a standing is how a gap appears and how club_count starts to overstate.
CREATE CONSTRAINT TRIGGER "competition_edition_standings_completeness"
  AFTER INSERT OR UPDATE OR DELETE ON bolao."competition_edition_standings"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bolao.check_snapshot_completeness();

COMMIT;

-- ============================================================
-- INDEXES — each statement runs OUTSIDE a transaction (CONCURRENTLY forbids one)
-- ============================================================
-- the authoritative-snapshot lookup: the latest classification for this edition. The single hottest access path, read once per scoring run.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "classification_snapshots_competition_edition_id_genera_a9914a5b" ON bolao."classification_snapshots" (competition_edition_id, generated_at);
-- one snapshot per provider per instant per edition. Two rows claiming the same instant would make 'the latest' ambiguous.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "classification_snapshots_competition_edition_id_provid_205fedf3" ON bolao."classification_snapshots" (competition_edition_id, provider, generated_at);
-- two clubs cannot occupy the same position in one snapshot. This is the 2026-07-14 zone-boundary audit finding enforced by the database: an unresolved provider rank tie now fails the import instead of moving a relegation boundary.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "competition_edition_standings_classification_snapshot__d00a9b4d" ON bolao."competition_edition_standings" (classification_snapshot_id, position);
-- a club cannot occupy two positions in one snapshot
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "competition_edition_standings_classification_snapshot__00da55e5" ON bolao."competition_edition_standings" (classification_snapshot_id, club_name);
-- the scoring read: fetch a snapshot's table in position order and slice the zones. Covering, so the zone slice needs no heap access.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "competition_edition_standings_classification_snapshot__7e48a927" ON bolao."competition_edition_standings" (classification_snapshot_id, position, club_name);

-- Verify every build succeeded. A failed CONCURRENTLY build leaves an INVALID index that is
-- still maintained on every write: pure cost that looks like a working index in \d.
--   SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
--   WHERE NOT i.indisvalid AND c.relname LIKE ANY (ARRAY['classification_snapshots_competition_edition_id_genera_a9914a5b', 'classification_snapshots_competition_edition_id_provid_205fedf3', 'competition_edition_standings_classification_snapshot__d00a9b4d', 'competition_edition_standings_classification_snapshot__00da55e5', 'competition_edition_standings_classification_snapshot__7e48a927']);
-- Expected: zero rows.
