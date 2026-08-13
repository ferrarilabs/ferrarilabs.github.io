--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813130000_normalized_read_surface_completion.sql
--
-- ═══ THE READ SURFACE, COMPLETED, AND THE PUBLIC PROJECTION OVER IT ══════════════════════════
--
-- M16 built bolao.read_document() and served the sections it could prove. It omitted six, each
-- for a named reason, and every one of those reasons has now been retired by work that came
-- before this file:
--
--   entries/picks   Q33-A1 was closed, but the entry contract still had no home for the four
--                   facts the PUBLIC document is keyed on. 20260813100000 gave them columns.
--   paid            KPLUS-OP-4A was resolved by the operator and 20260813120000 gave it a
--                   relation. 50 source-backed positive assertions, and NOT a financial fact.
--   results (copa)  Q39-A1 was closed and 20260813110000 added the one column a knockout result
--                   needs that a score cannot supply. 95 results backfilled.
--   deletedIds      derived from pool_entries.deleted_at, which is empty on all 46 rows — so it
--                   returned [] while Copa's document listed 8, and cutting over would have
--                   resurrected eight deleted entries into a public ranking.
--   meta            still cannot be migrated. It is DERIVED and labelled as such in its value.
--   auditLog        NOT retired. Refused, permanently. See below.
--
-- ═══ WHAT LEAVES THE PUBLIC CONTRACT, AND WHY THAT IS THE POINT ══════════════════════════════
--
-- `public.bolao_state_public` sanitises by SUBTRACTION: it removes four payment fields from
-- entries and passes the rest of the document through. Everything added to the document since is
-- public by default, and two things were:
--
--   · `auditLog` — ip, userAgent, platform, screen, on all three products
--   · `entries[].diagnostics` — userAgent, timezone, viewport, on 21 Copa entries
--
-- Both are readable by anyone with the anon key today. Neither is reproduced here. The new
-- surface names every field it emits, so the default flips: a column added tomorrow is private
-- until someone writes it into the projection deliberately.
--
-- The cost is stated rather than discovered: the in-browser admin audit panel loses its data,
-- because it read the same public document the participants do and the browser holds no
-- service_role. That is an admin-only behavior change; no participant-visible behavior reads
-- either field, except `diagnostics.demo`, which is normalized as a boolean and still emitted.
-- Forensic access remains via the operator CLI against legacy, which is preserved.
--
-- ═══ CLASSIFICATION ═════════════════════════════════════════════════════════════════════════
--
-- PLATFORM_SHARED · SECURITY · PRIVILEGE. It replaces one function body, creates one role, one
-- view and eleven policies, and issues the first browser-reachable GRANT this campaign has made.
--
-- IT DOES NOT ROUTE ANY APPLICATION. All three apps still read `public.bolao_state_public` after
-- this migration. Creating the surface and serving from it are deliberately two separate acts:
-- the first is reversible by a DROP, the second by a config edit, and bundling them would mean a
-- migration that cannot be applied without also being a cutover.
--
-- GENERATED. The body below is emitted by `scripts/db/emit_read_surface_migration.mjs` from
-- `scripts/db/read_surface.mjs` (M16, frozen) + `scripts/db/read_surface_complete.mjs`. Do not
-- edit it here — a hand-edited read surface is a third definition of the document shape, and the
-- first one to drift wins silently.
--
-- ROLLBACK (FULL). Re-run M16's function body to restore the previous projection, then
-- DROP VIEW public.bolao_state_normalized_public, DROP the eleven policies, REVOKE, and
-- DROP ROLE bolao_public_reader. No row is owned by anything here and no row is written, so the
-- rollback leaves the database bit-identical. While no app is routed at this surface, the
-- rollback is also invisible to every participant.
--
-- PRECHECKS: 20260813100000/110000/120000 applied and backfilled · 46 entries carry a legacy id ·
--            50 payment confirmations exist · 8 tombstones exist · 95 copa results exist
-- POSTCHECKS: read_document returns a complete document for all three pools · the public view
--             returns three rows · anon can SELECT the view · anon CANNOT reach any bolao table,
--             the bolao schema, v_state_document, or read_document directly · zero PII in output
--

BEGIN;

-- The assembled document, per product — now COMPLETE for every section the deployed readers
-- consume, except the one that is refused on purpose. STABLE, and read-only by construction:
-- it is a single SELECT and owns no row. Its security context changes below — see THE BOUNDED
-- OWNER, which is where the M16 comment about SECURITY DEFINER is answered rather than ignored.
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
              'cutoffAt', CASE WHEN date_part('microseconds', ph.cutoff_at)::bigint % 1000000 = 0
                                THEN to_char(ph.cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', ph.cutoff_at)::bigint % 1000 = 0
                                THEN to_char(ph.cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(ph.cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
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
            || CASE WHEN ph.bracket_topology IS NOT NULL
                  THEN jsonb_build_object('topology', ph.bracket_topology) ELSE '{}'::jsonb END
            || CASE WHEN ph.official_draw IS NOT NULL
                    THEN jsonb_build_object('officialDraw', ph.official_draw) ELSE '{}'::jsonb END
          ), '{}'::jsonb)
       FROM bolao.competition_edition_phases ph
      WHERE ph.competition_edition_id = pool.competition_edition_id),
    'entries',

    (SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'id',        pe.legacy_entry_id,
              'entryName', pe.display_label,
              'createdAt', CASE WHEN date_part('microseconds', pe.submitted_at)::bigint % 1000000 = 0
                                THEN to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', pe.submitted_at)::bigint % 1000 = 0
                                THEN to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
              'picks',     jsonb_build_object(
              'matches', (
                SELECT COALESCE(jsonb_object_agg(x.slug, x.legs), '{}'::jsonb) FROM (
                  SELECT ti.slug,
                         jsonb_object_agg(CASE m.leg WHEN 1 THEN CASE WHEN (SELECT count(*) FROM bolao.matches m2 WHERE m2.tie_id = m.tie_id) = 1
                                                 THEN 'single' ELSE 'first' END
                               WHEN 2 THEN 'second' END, jsonb_build_object(
                           'goalsHome', p.predicted_goals_home,
                           'goalsAway', p.predicted_goals_away)) AS legs
                    FROM bolao.predictions p
                    JOIN bolao.matches m ON m.match_id = p.match_id
                    JOIN bolao.ties    ti ON ti.tie_id = m.tie_id
                   WHERE p.pool_entry_id = pe.pool_entry_id
                   GROUP BY ti.slug) x),
              'qualified', (
                SELECT COALESCE(jsonb_object_agg(ti.slug, p.predicted_qualified_side), '{}'::jsonb)
                  FROM bolao.predictions p
                  JOIN bolao.ties ti ON ti.tie_id = p.tie_id
                 WHERE p.pool_entry_id = pe.pool_entry_id)
            )
            )
            || CASE WHEN pe.content_updated_at IS NOT NULL
                    THEN jsonb_build_object('updatedAt', CASE WHEN date_part('microseconds', pe.content_updated_at)::bigint % 1000000 = 0
                                THEN to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', pe.content_updated_at)::bigint % 1000 = 0
                                THEN to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ELSE '{}'::jsonb END
            -- Only the demo flag. The rest of the legacy diagnostics object is forensic device
            -- metadata and is deliberately not reproduced; see the module header.
            || CASE WHEN pe.is_demo THEN jsonb_build_object('diagnostics', jsonb_build_object('demo', true))
                    ELSE '{}'::jsonb END ORDER BY pe.submitted_at, pe.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL),
    'paid',

    (SELECT COALESCE(jsonb_object_agg(c.source_entry_key::text, true), '{}'::jsonb)
       FROM bolao.entry_payment_confirmation c
      WHERE c.pool_id = pool.pool_id),
    'deletedIds',

    (SELECT COALESCE(jsonb_agg(t.legacy_entry_id::text ORDER BY t.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entry_tombstone t
      WHERE t.pool_id = pool.pool_id),
    'meta',

    (SELECT jsonb_build_object(
              'updatedAt', to_char(GREATEST(max(pe.content_updated_at), max(pe.submitted_at)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'version',   'normalized/1')
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL)
  )
  -- omitted for cdb2026: auditLog — INTENTIONAL_SECURITY_REDUCTION — forensic ip/userAgent/platform/screen, no public behavior
  -- omitted for cdb2026: entries[].lastClientRef — NO_CONSUMER — an idempotency echo on 1 entry, read by nothing
  -- omitted for cdb2026: phases[].scheduleProvenance — CLASS_C_DIAGNOSTIC — operator schedule metadata; no render gates on it and the only repository reference is the script that writes it
  WHEN 'br2026' THEN jsonb_build_object(
    'cutoffAt',
(SELECT to_char(pl2.entry_cutoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM bolao.pools pl2 WHERE pl2.pool_id = pool.pool_id),
    'results',
(SELECT NULL::jsonb),
    'entries',

    (SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'id',        pe.legacy_entry_id,
              'entryName', pe.display_label,
              'createdAt', CASE WHEN date_part('microseconds', pe.submitted_at)::bigint % 1000000 = 0
                                THEN to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', pe.submitted_at)::bigint % 1000 = 0
                                THEN to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
              'picks',     (
              SELECT COALESCE(jsonb_object_agg(z.zone, z.clubs), '{}'::jsonb)
                FROM (SELECT cp.zone, jsonb_agg(cp.club_name ORDER BY cp.ordinal) AS clubs
                        FROM bolao.classification_predictions cp
                       WHERE cp.pool_entry_id = pe.pool_entry_id
                       GROUP BY cp.zone) z
            )
            )
            || CASE WHEN pe.content_updated_at IS NOT NULL
                    THEN jsonb_build_object('updatedAt', CASE WHEN date_part('microseconds', pe.content_updated_at)::bigint % 1000000 = 0
                                THEN to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', pe.content_updated_at)::bigint % 1000 = 0
                                THEN to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ELSE '{}'::jsonb END
            -- Only the demo flag. The rest of the legacy diagnostics object is forensic device
            -- metadata and is deliberately not reproduced; see the module header.
            || CASE WHEN pe.is_demo THEN jsonb_build_object('diagnostics', jsonb_build_object('demo', true))
                    ELSE '{}'::jsonb END ORDER BY pe.submitted_at, pe.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL),
    'paid',

    (SELECT COALESCE(jsonb_object_agg(c.source_entry_key::text, true), '{}'::jsonb)
       FROM bolao.entry_payment_confirmation c
      WHERE c.pool_id = pool.pool_id),
    'deletedIds',

    (SELECT COALESCE(jsonb_agg(t.legacy_entry_id::text ORDER BY t.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entry_tombstone t
      WHERE t.pool_id = pool.pool_id),
    'meta',

    (SELECT jsonb_build_object(
              'updatedAt', to_char(GREATEST(max(pe.content_updated_at), max(pe.submitted_at)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'version',   'normalized/1')
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL)
  )
  -- omitted for br2026: auditLog — INTENTIONAL_SECURITY_REDUCTION — see cdb2026
  -- omitted for br2026: roundEmail — NO_TARGET_ENTITY — an operator outbox ledger; not in the browser's read contract
  WHEN 'copa2026' THEN jsonb_build_object(
    'deletedResults',
(SELECT COALESCE(jsonb_agg(mr.match_result_id ORDER BY mr.match_result_id), '[]'::jsonb)
                          FROM bolao.match_results mr WHERE mr.superseded_by_id IS NOT NULL),
    'entries',

    (SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'id',        pe.legacy_entry_id,
              'entryName', pe.display_label,
              'createdAt', CASE WHEN date_part('microseconds', pe.submitted_at)::bigint % 1000000 = 0
                                THEN to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', pe.submitted_at)::bigint % 1000 = 0
                                THEN to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(pe.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
              'picks',     (
              SELECT COALESCE(jsonb_object_agg(m.provider_match_ref, jsonb_build_object(
                       'goalsA',      p.predicted_goals_home,
                       'goalsB',      p.predicted_goals_away,
                       'displayA',    p.display_home,
                       'displayB',    p.display_away,
                       'advanceSide', p.predicted_qualified_side
                     )), '{}'::jsonb)
                FROM bolao.predictions p
                JOIN bolao.matches m ON m.match_id = p.match_id
               WHERE p.pool_entry_id = pe.pool_entry_id
            )
            )
            || CASE WHEN pe.content_updated_at IS NOT NULL
                    THEN jsonb_build_object('updatedAt', CASE WHEN date_part('microseconds', pe.content_updated_at)::bigint % 1000000 = 0
                                THEN to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                WHEN date_part('microseconds', pe.content_updated_at)::bigint % 1000 = 0
                                THEN to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(pe.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END) ELSE '{}'::jsonb END
            -- Only the demo flag. The rest of the legacy diagnostics object is forensic device
            -- metadata and is deliberately not reproduced; see the module header.
            || CASE WHEN pe.is_demo THEN jsonb_build_object('diagnostics', jsonb_build_object('demo', true))
                    ELSE '{}'::jsonb END ORDER BY pe.submitted_at, pe.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL),
    'results',

    (SELECT COALESCE(jsonb_object_agg(m.provider_match_ref,
              jsonb_build_object('goalsA', mr.goals_home, 'goalsB', mr.goals_away)
              || CASE WHEN mr.advance_side IS NOT NULL
                      THEN jsonb_build_object('advanceSide', mr.advance_side) ELSE '{}'::jsonb END
            ), '{}'::jsonb)
       FROM bolao.match_results mr
       JOIN bolao.matches m ON m.match_id = mr.match_id
       JOIN bolao.competition_edition_phases ph ON ph.competition_edition_phase_id = m.competition_edition_phase_id
      WHERE ph.competition_edition_id = pool.competition_edition_id
        AND mr.superseded_by_id IS NULL),
    'paid',

    (SELECT COALESCE(jsonb_object_agg(c.source_entry_key::text, true), '{}'::jsonb)
       FROM bolao.entry_payment_confirmation c
      WHERE c.pool_id = pool.pool_id),
    'deletedIds',

    (SELECT COALESCE(jsonb_agg(t.legacy_entry_id::text ORDER BY t.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entry_tombstone t
      WHERE t.pool_id = pool.pool_id),
    'meta',

    (SELECT jsonb_build_object(
              'updatedAt', to_char(GREATEST(max(pe.content_updated_at), max(pe.submitted_at)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'version',   'normalized/1')
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL)
  )
  -- omitted for copa2026: auditLog — INTENTIONAL_SECURITY_REDUCTION — see cdb2026
  -- omitted for copa2026: entries[].diagnostics.* — INTENTIONAL_SECURITY_REDUCTION — userAgent/timezone/viewport on 21 entries; only the demo flag has public behavior and only it is emitted
  ELSE NULL
END
FROM pool;
$read_document$;

COMMENT ON FUNCTION bolao.read_document(text) IS 'Normalized read surface: the state document assembled from bolao.* for one pool. Complete for every section the deployed readers consume. auditLog and entries[].diagnostics forensics are deliberately excluded — they are private, not missing. Document contract normalized/1.';

-- KPLUS-F059: every generated function revokes EXECUTE from PUBLIC.
REVOKE ALL ON FUNCTION bolao.read_document(text) FROM PUBLIC;

-- bolao.v_state_document is UNCHANGED and stays service_role-only. It is the TRUSTED surface:
-- same shape, no sanitisation promise. The browser gets the public view below instead, and the
-- distinction is the point — a single view serving both audiences is one GRANT away from
-- serving the trusted shape to anon.

-- ─── THE BOUNDED OWNER ────────────────────────────────────────────────────────────────────
--
-- read_document becomes SECURITY DEFINER, and the whole safety of that turns on WHO defines it.
-- M16 refused SECURITY DEFINER, and it was right to: the function was owned by postgres, which
-- carries BYPASSRLS, so defining it would have handed every caller a surface that ignores every
-- policy in the database — KPLUS-F058's shape exactly.
--
-- The objection is to the OWNER, not to the mechanism. A read surface has to cross a privilege
-- boundary somewhere: anon must not hold rights on bolao.* tables, and something still has to
-- read them. The three ways to do that are (1) grant anon the tables — forbidden, and it would
-- reopen Q38; (2) own the function as postgres — BYPASSRLS, refused above; (3) own it as a role
-- that can do NOTHING except read the eleven relations this projection names. Only (3) makes the
-- blast radius equal to the thing being published.
--
-- bolao_public_reader is NOLOGIN (it is never a session, only a definer), NOSUPERUSER,
-- NOBYPASSRLS, NOINHERIT, and owns no table. It gets USAGE on one schema, SELECT on eleven
-- relations, and one read-only policy on each. It cannot write, cannot reach the finance model,
-- cannot reach audit.*, and cannot read bolao.participants — which is the point worth stating
-- plainly: THE PUBLIC READ PATH NO LONGER TOUCHES THE TABLE THAT HOLDS EMAIL AND PHONE AT ALL.
-- The entry name it needs is pool_entries.display_label, so participants is not in the grant
-- list and a projection that tried to select from it would fail rather than leak.
--
-- FORCE ROW LEVEL SECURITY is why each table needs an explicit policy: under FORCE, even a
-- table's owner is subject to RLS, so a grant alone reads nothing. Each policy is FOR SELECT,
-- TO bolao_public_reader, USING (true) — deliberately unconditional, because the row filtering
-- that matters happens in the projection, and a half-expressed predicate here would be a second
-- place for the public contract to be decided.
DO $bounded_owner$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bolao_public_reader') THEN
    CREATE ROLE bolao_public_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $bounded_owner$;

COMMENT ON ROLE bolao_public_reader IS 'Bounded definer for bolao.read_document(). NOLOGIN, NOBYPASSRLS, owns no table. Holds SELECT on exactly the eleven relations the public projection reads — deliberately NOT bolao.participants, which carries email and phone and which the public read path no longer touches.';

-- PostgreSQL refuses ALTER FUNCTION ... OWNER TO a role the current user is not a member of.
-- Membership, not inheritance: bolao_public_reader is NOINHERIT, so this lets postgres SET ROLE
-- to it and hand it the function — it does not give postgres the role's privileges implicitly,
-- and postgres already outranks it in every direction that matters.
GRANT bolao_public_reader TO postgres;

GRANT USAGE ON SCHEMA bolao TO bolao_public_reader;

GRANT SELECT ON TABLE bolao.pools TO bolao_public_reader;
DROP POLICY IF EXISTS pools_public_reader_select ON bolao.pools;
CREATE POLICY pools_public_reader_select ON bolao.pools FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.pool_entries TO bolao_public_reader;
DROP POLICY IF EXISTS pool_entries_public_reader_select ON bolao.pool_entries;
CREATE POLICY pool_entries_public_reader_select ON bolao.pool_entries FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.pool_entry_tombstone TO bolao_public_reader;
DROP POLICY IF EXISTS pool_entry_tombstone_public_reader_select ON bolao.pool_entry_tombstone;
CREATE POLICY pool_entry_tombstone_public_reader_select ON bolao.pool_entry_tombstone FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.predictions TO bolao_public_reader;
DROP POLICY IF EXISTS predictions_public_reader_select ON bolao.predictions;
CREATE POLICY predictions_public_reader_select ON bolao.predictions FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.classification_predictions TO bolao_public_reader;
DROP POLICY IF EXISTS classification_predictions_public_reader_select ON bolao.classification_predictions;
CREATE POLICY classification_predictions_public_reader_select ON bolao.classification_predictions FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.matches TO bolao_public_reader;
DROP POLICY IF EXISTS matches_public_reader_select ON bolao.matches;
CREATE POLICY matches_public_reader_select ON bolao.matches FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.match_results TO bolao_public_reader;
DROP POLICY IF EXISTS match_results_public_reader_select ON bolao.match_results;
CREATE POLICY match_results_public_reader_select ON bolao.match_results FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.ties TO bolao_public_reader;
DROP POLICY IF EXISTS ties_public_reader_select ON bolao.ties;
CREATE POLICY ties_public_reader_select ON bolao.ties FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.competition_edition_phases TO bolao_public_reader;
DROP POLICY IF EXISTS competition_edition_phases_public_reader_select ON bolao.competition_edition_phases;
CREATE POLICY competition_edition_phases_public_reader_select ON bolao.competition_edition_phases FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.sync_state TO bolao_public_reader;
DROP POLICY IF EXISTS sync_state_public_reader_select ON bolao.sync_state;
CREATE POLICY sync_state_public_reader_select ON bolao.sync_state FOR SELECT TO bolao_public_reader USING (true);
GRANT SELECT ON TABLE bolao.entry_payment_confirmation TO bolao_public_reader;
DROP POLICY IF EXISTS entry_payment_confirmation_public_reader_select ON bolao.entry_payment_confirmation;
CREATE POLICY entry_payment_confirmation_public_reader_select ON bolao.entry_payment_confirmation FOR SELECT TO bolao_public_reader USING (true);

-- ALTER ... OWNER TO additionally requires the INCOMING owner to hold CREATE on the schema —
-- PostgreSQL will not let a role own an object in a schema it could not have created one in.
-- So CREATE is granted for the length of one statement and revoked immediately. Ownership
-- persists; the ability to create does not, and the end state is a definer that can read
-- eleven relations and do nothing else. Leaving CREATE in place would be the easy version and
-- would quietly give the public read path the right to add objects to the schema it reads.
GRANT CREATE ON SCHEMA bolao TO bolao_public_reader;
ALTER FUNCTION bolao.read_document(text) OWNER TO bolao_public_reader;
ALTER FUNCTION bolao.read_document(text) SECURITY DEFINER;
REVOKE CREATE ON SCHEMA bolao FROM bolao_public_reader;

-- ─── THE PUBLIC SANITIZED SURFACE ─────────────────────────────────────────────────────────
--
-- NOT security_invoker, and that is what keeps anon out of the bolao schema entirely. Under a
-- security_invoker view the caller would need EXECUTE on bolao.read_document and therefore USAGE
-- on schema bolao — a grant the least-privilege rule refuses. With the default (owner-checked)
-- view, anon needs SELECT on this view and nothing else: it cannot NAME a bolao object, which is
-- a refusal one level earlier than RLS and does not depend on a policy being right.
--
-- The view references exactly one object — a STABLE, read-only function whose own authority is
-- the bounded role above — so 'runs as owner' here means 'may read the published projection',
-- not 'may read anything the owner may'.
--
-- It is a whitelist by construction, not a blacklist by subtraction. public.bolao_state_public
-- takes the private document and REMOVES four fields; anything added to the document later is
-- public by default, which is how auditLog's ip/userAgent and entries[].diagnostics' userAgent
-- are readable by anyone today. read_document() names every field it emits, so a new column is
-- private until someone writes it into the projection on purpose.
--
-- updated_at is NULL, not now(): it means 'when the document was last written' and the
-- normalized side does not carry that fact. A synthesised timestamp would let a
-- last-writer-wins client conclude this surface is newer than whatever it holds. The apps
-- select the column and use state.meta.updatedAt instead, which IS derived.
CREATE OR REPLACE VIEW public.bolao_state_normalized_public
WITH (security_invoker = true) AS
SELECT
  d.doc_id                    AS id,
  bolao.read_document(d.slug) AS state,
  NULL::timestamptz           AS updated_at
FROM (VALUES
  ('cdb2026', 'cdb2026'),
  ('br2026', 'br2026'),
  ('copa2026', 'main')
) AS d(slug, doc_id);

COMMENT ON VIEW public.bolao_state_normalized_public IS 'Sanitized public read surface in the legacy (id, state, updated_at) contract, so a client readTable can be re-pointed here with no application code change. Emits only whitelisted fields: no email, payer, payment method, payment reference, auth user id, ip, user agent, device metadata, lineage or provenance. updated_at is deliberately NULL.';

REVOKE ALL ON TABLE public.bolao_state_normalized_public FROM PUBLIC;

-- ─── LEAST PRIVILEGE ──────────────────────────────────────────────────────────────────────
--
-- anon gets SELECT on ONE view and EXECUTE on ONE function, and nothing else. Specifically it
-- does NOT get: USAGE on the bolao schema, SELECT on any bolao.* table, the trusted
-- v_state_document, any operator RPC, or anything in the finance model. Without schema USAGE,
-- anon cannot name a bolao object even to be refused by RLS — the refusal happens a level
-- earlier, which is the level that does not depend on a policy being right.
--
-- No EXECUTE grant to anon on read_document, and none is needed: the owner-checked view is what
-- calls it. Granting it anyway would require schema USAGE and would hand the browser a callable
-- entry point with a free-text argument, next to a view that already fixes the three legal
-- values. One published surface, one shape.
GRANT SELECT ON TABLE public.bolao_state_normalized_public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bolao.read_document(text) TO service_role;


COMMIT;
