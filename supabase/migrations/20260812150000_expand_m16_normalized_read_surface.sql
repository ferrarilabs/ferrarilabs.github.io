--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812150000_expand_m16_normalized_read_surface.sql
--
-- EXPAND stage M16 — normalized read surface
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
-- ROLLBACK (FULL). FULL. DROP VIEW bolao.v_state_document then DROP FUNCTION bolao.read_document(text). Nothing depends on either, no row is owned by either, and no privilege outside the two objects is touched — so a rollback leaves the database bit-identical to the state before the stage.
--
-- ============================================================
-- M16 — normalized read surface
-- ============================================================
--
-- PURPOSE. bolao.read_document(text) and bolao.v_state_document — the first objects anywhere that return
--  bolao.* in the shape the applications read. GNG-2C's missing DESTINATION: until this existed the
--  normalized -> legacy round trip had no origin, so a read rollback had nothing to roll back FROM and
--  could not be proven. The view deliberately matches public.bolao_state_public's (id, state, updated_at)
--  contract so a client's readTable can be re-pointed at it without an application code change.
--
-- DEPENDENCIES: M15
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
-- BACKFILL REQUIREMENT. none — it reads. It writes nothing and owns no rows.
-- APPLICATION COMPATIBILITY. TOTAL, and by construction: no browser role is granted anything. service_role
--  only. Zero of three products are read-routable today, so a browser-reachable surface would be a lossy
--  document one config edit away from being served.
-- ROLLBACK STRATEGY (FULL). FULL. DROP VIEW bolao.v_state_document then DROP FUNCTION
--  bolao.read_document(text). Nothing depends on either, no row is owned by either, and no privilege
--  outside the two objects is touched — so a rollback leaves the database bit-identical to the state before
--  the stage.
--
-- PRECHECKS (all READ_ONLY, all must pass):
--   1. every dependency in M15 is recorded as applied
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

-- The assembled document, per product. STABLE, not VOLATILE: it reads and never writes, so a
-- caller may safely use it in a scalar subquery. SECURITY INVOKER (the default) is deliberate —
-- a SECURITY DEFINER read surface owned by postgres would execute with BYPASSRLS and become the
-- exact write-bypass shape KPLUS-F058 was remediated for.
CREATE OR REPLACE FUNCTION bolao.read_document(p_pool_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $read_document$
WITH pool AS (
  SELECT pl.pool_id, pl.competition_edition_id FROM bolao.pools pl WHERE pl.slug = p_pool_slug
)
SELECT CASE p_pool_slug
  WHEN 'cdb2026' THEN jsonb_build_object(
    'activePhase',

    (SELECT p2.slug
       FROM bolao.sync_state ss
       JOIN bolao.competition_edition_phases p2 ON p2.competition_edition_phase_id = ss.active_phase_id
      WHERE ss.competition_edition_id = pool.competition_edition_id),
    'espnSync',

    (SELECT jsonb_build_object(
              'activePhaseId',
              (SELECT p2.slug FROM bolao.competition_edition_phases p2
                WHERE p2.competition_edition_phase_id = ss.active_phase_id)
            ) || ss.seed_flags
       FROM bolao.sync_state ss
      WHERE ss.competition_edition_id = pool.competition_edition_id),
    'phases',

    (SELECT COALESCE(jsonb_object_agg(ph.slug, jsonb_build_object(
              'cutoffAt', to_char(ph.cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'ties', (
                SELECT COALESCE(jsonb_object_agg(ti.slug, jsonb_build_object(
                          'teamA', ti.team_a,
                          'teamB', ti.team_b,
                          'qualifiedTeamId', ti.qualified_side,
                          'matches', (
                            SELECT COALESCE(jsonb_object_agg(
                                     CASE m.leg WHEN 1 THEN 'first' WHEN 2 THEN 'second' END,
                                     jsonb_build_object(
                                       'homeTeam', m.home_team,
                                       'awayTeam', m.away_team,
                                       'status',   CASE m.status::text WHEN 'finished' THEN 'FINAL' WHEN 'scheduled' THEN 'SCHEDULED' END,
                                       'kickoff',  m.kickoff_at,
                                       'venue',    m.venue,
                                       'goalsHome', mr.goals_home,
                                       'goalsAway', mr.goals_away
                                     )
                                     -- resultSource AND city are added ONLY on legs that carry an ESPN
                                     -- provider payload, because that is exactly where the document
                                     -- has them. Measured on live production: the 16 legs with a 'city'
                                     -- key are the SAME 16 that have a 'resultSource' key, the same 16
                                     -- with a non-null kickoff, and the same 16 whose match_results.source
                                     -- is 'espn' — set equality, not a matching count.
                                     --
                                     -- The distinction being preserved is ABSENT vs PRESENT-AND-NULL.
                                     -- 'city' is absent on 40 legs, null on 4 and valued on 12; the
                                     -- column stores NULL for both of the first two, so emitting it
                                     -- unconditionally produced 40 spurious nulls — which is precisely
                                     -- what the shadow caught. 'venue' is NOT conditional: its key is
                                     -- present on all 56 legs (null on 44), so the two fields genuinely
                                     -- differ and must not be treated alike because they look alike.
                                     --
                                     -- The 32 legs whose source is 'legacy_unrecorded' got that value
                                     -- from this campaign, not from the document; emitting it back would
                                     -- invent a field on rows that never had one.
                                     || CASE WHEN mr.source IS NOT NULL AND mr.source <> 'legacy_unrecorded'
                                             THEN jsonb_build_object('resultSource', CASE mr.source WHEN 'espn' THEN 'espn-auto' END, 'city', m.city)
                                             ELSE '{}'::jsonb END
                                   ), '{}'::jsonb)
                              FROM bolao.matches m
                              LEFT JOIN bolao.match_results mr ON mr.match_id = m.match_id
                             WHERE m.tie_id = ti.tie_id
                          )
                        )
                        -- lockedAt/lockedBy are present on 8 of 28 ties and absent on the rest. Merged
                        -- conditionally so an unlocked tie carries no key, rather than a null one.
                        || CASE WHEN ti.locked_at IS NOT NULL OR ti.locked_by IS NOT NULL
                                THEN jsonb_build_object('lockedAt', ti.locked_at, 'lockedBy', ti.locked_by)
                                ELSE '{}'::jsonb END
                      ), '{}'::jsonb)
                  FROM bolao.ties ti
                 WHERE ti.competition_edition_phase_id = ph.competition_edition_phase_id
              )
            )
            || CASE WHEN ph.cutoff_offset_ms IS NOT NULL
                    THEN jsonb_build_object('cutoffOffsetMs', ph.cutoff_offset_ms) ELSE '{}'::jsonb END
            || CASE WHEN ph.official_draw IS NOT NULL
                    THEN jsonb_build_object('officialDraw', ph.official_draw) ELSE '{}'::jsonb END
          ), '{}'::jsonb)
       FROM bolao.competition_edition_phases ph
      WHERE ph.competition_edition_id = pool.competition_edition_id),
    'deletedIds',
(SELECT COALESCE(jsonb_agg(e.entry_label ORDER BY e.entry_label), '[]'::jsonb)
                      FROM bolao.pool_entries e WHERE e.pool_id = pool.pool_id AND e.deleted_at IS NOT NULL)
  )
  -- omitted for cdb2026: entries (Q33-A1), paid (KPLUS-OP-4), auditLog (AUDIT-BACKFILL-NOT-RUN), meta (DESCRIBES_THE_LEGACY_DOCUMENT)
  WHEN 'br2026' THEN jsonb_build_object(
    'cutoffAt',
(SELECT to_char(pl2.entry_cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM bolao.pools pl2 WHERE pl2.pool_id = pool.pool_id),
    'deletedIds',
(SELECT COALESCE(jsonb_agg(e.entry_label ORDER BY e.entry_label), '[]'::jsonb)
                      FROM bolao.pool_entries e WHERE e.pool_id = pool.pool_id AND e.deleted_at IS NOT NULL),
    'results',
(SELECT NULL::jsonb)
  )
  -- omitted for br2026: entries (Q33-A1), paid (KPLUS-OP-4), auditLog (AUDIT-BACKFILL-NOT-RUN), meta (DESCRIBES_THE_LEGACY_DOCUMENT), roundEmail (NO_TARGET_ENTITY)
  WHEN 'copa2026' THEN jsonb_build_object(
    'deletedResults',
(SELECT COALESCE(jsonb_agg(mr.match_result_id ORDER BY mr.match_result_id), '[]'::jsonb)
                          FROM bolao.match_results mr WHERE mr.superseded_by_id IS NOT NULL)
  )
  -- omitted for copa2026: entries (Q33-A1), paid (KPLUS-OP-4), auditLog (AUDIT-BACKFILL-NOT-RUN), meta (DESCRIBES_THE_LEGACY_DOCUMENT), results (Q39-A1), deletedIds (ENTRY-DELETION-NOT-BACKFILLED)
  ELSE NULL
END
FROM pool;
$read_document$;

COMMENT ON FUNCTION bolao.read_document(text) IS 'Normalized read surface: the state document assembled from bolao.* for one pool. Emits ONLY sections the field-level contract proves complete; a PARTIAL section is omitted entirely rather than served short.';

-- KPLUS-F059: every generated function revokes EXECUTE from PUBLIC.
REVOKE ALL ON FUNCTION bolao.read_document(text) FROM PUBLIC;

-- The browser-shaped contract: the same (id, state, updated_at) columns as
-- public.bolao_state_public, so a client's readTable can be re-pointed here with no code change.
-- security_invoker: the view executes as its CALLER, not as postgres. Without it a non-owner
-- reading this view would run with the owner's authority — KPLUS-F058 exactly.
CREATE OR REPLACE VIEW bolao.v_state_document
WITH (security_invoker = true) AS
SELECT
  d.doc_id                       AS id,
  bolao.read_document(d.slug)    AS state,
  NULL::timestamptz              AS updated_at
FROM (VALUES
  ('cdb2026', 'cdb2026'),
  ('br2026', 'br2026'),
  ('copa2026', 'main')
) AS d(slug, doc_id);

-- updated_at is NULL and not now(): it means 'when the document was last written', and the
-- normalized side does not carry that fact. Returning a synthesised timestamp would let a
-- last-writer-wins client conclude this surface is newer than whatever it holds.
COMMENT ON VIEW bolao.v_state_document IS 'Read surface in the legacy (id, state, updated_at) contract. updated_at is deliberately NULL: the normalized model does not record when the document was last written.';

REVOKE ALL ON TABLE bolao.v_state_document FROM PUBLIC;

-- PRIVILEGE BOUNDARY, and it is the fail-closed guard for this whole stage.
-- service_role ONLY. No anon. No authenticated. Zero of three products are read-routable today
-- (m15_contract.mjs), so a browser-reachable surface would be a lossy document one config edit
-- away from being served to real participants. Granting the browser roles is a separate,
-- separately-authorized act that must follow a green shadow — not a convenience bundled here.
GRANT EXECUTE ON FUNCTION bolao.read_document(text) TO service_role;
GRANT SELECT ON TABLE bolao.v_state_document TO service_role;

COMMIT;
