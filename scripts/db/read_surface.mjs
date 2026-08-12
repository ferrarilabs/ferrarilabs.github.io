/**
 * THE NORMALIZED READ SURFACE — declarative spec plus its emitter.
 *
 * GNG-2C's missing destination. Until this existed, no view or function anywhere returned `bolao.*` in
 * the shape the applications read, so the normalized -> legacy round trip had no origin and a read
 * rollback had nothing to roll back FROM.
 *
 * ── WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────────────────────
 *
 * It is the minimum canonical read model: one function per product section, assembled into the
 * `(id, state, updated_at)` contract the browser already speaks — the same shape as
 * `public.bolao_state_public`, so a client's `readTable` can be re-pointed at it without a code change.
 *
 * It is NOT a reporting API. It has no filters, no pagination and no projection arguments. Every extra
 * degree of freedom here is a second way for the read path to disagree with the write path.
 *
 * ── IT EMITS ONLY WHAT THE CONTRACT PROVES ──────────────────────────────────────────────────────────
 *
 * Sections are listed per product because representability is per product. `m15_contract.mjs` measures
 * the field-level truth against live production; this file may only claim what that measurement
 * supports. A section that is PARTIAL is omitted entirely rather than served short: serving copa2026
 * from 12 of its 23 entries would delete eleven people's picks from the app's view of the pool, and
 * doing it silently is worse than not doing it.
 *
 * Omitted, and why:
 *   entries / picks   Q33-A1 — 9 quarantined identities block 25 entries and 168 predictions
 *   paid              KPLUS-OP-4 — settlement semantics unresolved; bolao.payments is empty by design
 *   auditLog          the audit backfill has not run, and audit.* is held by a concurrent workstream
 *   meta              describes the LEGACY DOCUMENT, not the pool. Synthesised, never claimed migrated.
 *   results (copa)    Q39-A1 — 95 matches held on bracket-slot semantics
 *
 * ── TWO DECLARED NON-TEXTUAL EQUIVALENCES ───────────────────────────────────────────────────────────
 *
 * 1. TIMESTAMP STRING FORM. The document's `kickoff` values are not in one format: production carries
 *    both `2026-08-01T21:00:00-03:00` and `2026-08-05T00:30Z`, and `lockedAt` carries microseconds as
 *    `...+00:00`. `timestamptz` stores the INSTANT, so the original spelling is not recoverable and is
 *    not reproduced. These fields are semantically equal and textually different BY DESIGN, and the
 *    shadow compares them as instants. `cutoffAt` is the exception — production spells it uniformly as
 *    `.000Z`, so it is reproduced exactly.
 *
 * 2. MATCH STATUS VOCABULARY. The document says `FINAL` / `SCHEDULED`; the enum says `finished` /
 *    `scheduled`. The map back is declared below and is FAIL-CLOSED: an enum value with no legacy
 *    spelling yields NULL rather than a guess, and the shadow catches the NULL. A CASE with an ELSE
 *    that invents a default is how a new status silently becomes an old one.
 */

/** normalized enum value -> the spelling the document uses. No ELSE branch: unmapped must surface. */
export const MATCH_STATUS_TO_LEGACY = { finished: "FINAL", scheduled: "SCHEDULED" };

/**
 * The same treatment for result provenance. The document spells it `espn-auto` on all 16 legs that
 * carry it — a closed vocabulary of one observed value — and the matches backfill normalized that to
 * `espn`. The shadow caught the round trip returning `espn` where the document says `espn-auto`.
 *
 * `legacy_unrecorded` is deliberately absent from this map. It is a value THIS CAMPAIGN derived for the
 * 32 legs the document never labelled, so it has no legacy spelling and must never acquire one; the
 * emitter drops those legs before the map is consulted.
 */
export const RESULT_SOURCE_TO_LEGACY = { espn: "espn-auto" };

/** Reproduces the document's uniform millisecond-Z spelling. Used ONLY where production is uniform. */
const isoMs = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * A fail-closed reverse map. No ELSE: a normalized value with no declared legacy spelling yields NULL,
 * and the shadow reports the NULL as a diff. An ELSE that passed the value through unchanged would let
 * a new enum member silently masquerade as a legacy one — which is exactly how `espn` reached the
 * document shape claiming to be `espn-auto`'s equal.
 */
const reverseMap = (expr, map) =>
  `CASE ${expr} ${Object.entries(map).map(([k, v]) => `WHEN '${k}' THEN '${v}'`).join(" ")} END`;

const statusCase = () => reverseMap("m.status::text", MATCH_STATUS_TO_LEGACY);

/**
 * cdb2026's `phases` object, rebuilt whole: phase -> ties -> legs -> result.
 *
 * Every level uses jsonb_object_agg over a COALESCE'd empty object, because a phase with no ties must
 * emit `{}` and not vanish, and `jsonb_object_agg` over zero rows returns NULL. Absent, null and empty
 * are three different answers and the aggregation must not collapse them into one.
 */
const CDB_PHASES = `
    (SELECT COALESCE(jsonb_object_agg(ph.slug, jsonb_build_object(
              'cutoffAt', ${isoMs("ph.cutoff_at")},
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
                                       'status',   ${statusCase()},
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
                                             THEN jsonb_build_object('resultSource', ${reverseMap("mr.source", RESULT_SOURCE_TO_LEGACY)}, 'city', m.city)
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
      WHERE ph.competition_edition_id = pool.competition_edition_id)`;

const CDB_ESPN_SYNC = `
    (SELECT jsonb_build_object(
              'activePhaseId',
              (SELECT p2.slug FROM bolao.competition_edition_phases p2
                WHERE p2.competition_edition_phase_id = ss.active_phase_id)
            ) || ss.seed_flags
       FROM bolao.sync_state ss
      WHERE ss.competition_edition_id = pool.competition_edition_id)`;

const CDB_ACTIVE_PHASE = `
    (SELECT p2.slug
       FROM bolao.sync_state ss
       JOIN bolao.competition_edition_phases p2 ON p2.competition_edition_phase_id = ss.active_phase_id
      WHERE ss.competition_edition_id = pool.competition_edition_id)`;

/**
 * Per-product section list. `sql` produces the jsonb value for that document key.
 *
 * `deletedIds` is an empty array on all three products and the target agrees (EMPTY_BOTH_SIDES), so it
 * is emitted from the target rather than hardcoded: a soft-deleted entry would appear here the moment
 * one exists, instead of being silently swallowed by a literal `[]`.
 */
export const READ_SURFACE = {
  cdb2026: {
    poolSlug: "cdb2026",
    sections: {
      activePhase: CDB_ACTIVE_PHASE,
      espnSync: CDB_ESPN_SYNC,
      phases: CDB_PHASES,
      deletedIds: `(SELECT COALESCE(jsonb_agg(e.entry_label ORDER BY e.entry_label), '[]'::jsonb)
                      FROM bolao.pool_entries e WHERE e.pool_id = pool.pool_id AND e.deleted_at IS NOT NULL)`,
    },
    omitted: { entries: "Q33-A1", paid: "KPLUS-OP-4", auditLog: "AUDIT-BACKFILL-NOT-RUN", meta: "DESCRIBES_THE_LEGACY_DOCUMENT" },
  },
  br2026: {
    poolSlug: "br2026",
    sections: {
      cutoffAt: `(SELECT ${isoMs("pl2.entry_cutoff_at")} FROM bolao.pools pl2 WHERE pl2.pool_id = pool.pool_id)`,
      deletedIds: `(SELECT COALESCE(jsonb_agg(e.entry_label ORDER BY e.entry_label), '[]'::jsonb)
                      FROM bolao.pool_entries e WHERE e.pool_id = pool.pool_id AND e.deleted_at IS NOT NULL)`,
      // br2026's `results` is JSON null in production and the target holds nothing — EMPTY_BOTH_SIDES.
      // Emitted as an explicit null so the key EXISTS, because the app distinguishes absent from null.
      results: `(SELECT NULL::jsonb)`,
    },
    omitted: { entries: "Q33-A1", paid: "KPLUS-OP-4", auditLog: "AUDIT-BACKFILL-NOT-RUN", meta: "DESCRIBES_THE_LEGACY_DOCUMENT", roundEmail: "NO_TARGET_ENTITY" },
  },
  copa2026: {
    poolSlug: "copa2026",
    sections: {
      deletedResults: `(SELECT COALESCE(jsonb_agg(mr.match_result_id ORDER BY mr.match_result_id), '[]'::jsonb)
                          FROM bolao.match_results mr WHERE mr.superseded_by_id IS NOT NULL)`,
    },
    omitted: { entries: "Q33-A1", paid: "KPLUS-OP-4", auditLog: "AUDIT-BACKFILL-NOT-RUN", meta: "DESCRIBES_THE_LEGACY_DOCUMENT", results: "Q39-A1", deletedIds: "ENTRY-DELETION-NOT-BACKFILLED" },
  },
};

/** The document id each pool is known by in `public.bolao_state`. copa2026's is historic. */
export const POOL_TO_DOC_ID = { copa2026: "main", br2026: "br2026", cdb2026: "cdb2026" };

export function readSurfaceDdl() {
  const L = [];
  L.push("-- The assembled document, per product. STABLE, not VOLATILE: it reads and never writes, so a");
  L.push("-- caller may safely use it in a scalar subquery. SECURITY INVOKER (the default) is deliberate —");
  L.push("-- a SECURITY DEFINER read surface owned by postgres would execute with BYPASSRLS and become the");
  L.push("-- exact write-bypass shape KPLUS-F058 was remediated for.");
  L.push("CREATE OR REPLACE FUNCTION bolao.read_document(p_pool_slug text)");
  L.push("RETURNS jsonb");
  L.push("LANGUAGE sql");
  L.push("STABLE");
  L.push("SET search_path = pg_catalog, public");
  L.push("AS $read_document$");
  L.push("WITH pool AS (");
  L.push("  SELECT pl.pool_id, pl.competition_edition_id FROM bolao.pools pl WHERE pl.slug = p_pool_slug");
  L.push(")");
  L.push("SELECT CASE p_pool_slug");
  for (const [product, spec] of Object.entries(READ_SURFACE)) {
    L.push(`  WHEN '${spec.poolSlug}' THEN jsonb_build_object(`);
    const keys = Object.entries(spec.sections);
    keys.forEach(([key, sql], i) => {
      L.push(`    '${key}',`);
      L.push(`${sql}${i < keys.length - 1 ? "," : ""}`);
    });
    L.push("  )");
    L.push(`  -- omitted for ${product}: ${Object.entries(spec.omitted).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  }
  L.push("  ELSE NULL");
  L.push("END");
  L.push("FROM pool;");
  L.push("$read_document$;");
  L.push("");
  L.push("COMMENT ON FUNCTION bolao.read_document(text) IS 'Normalized read surface: the state document assembled from bolao.* for one pool. Emits ONLY sections the field-level contract proves complete; a PARTIAL section is omitted entirely rather than served short.';");
  L.push("");
  L.push("-- KPLUS-F059: every generated function revokes EXECUTE from PUBLIC.");
  L.push("REVOKE ALL ON FUNCTION bolao.read_document(text) FROM PUBLIC;");
  L.push("");
  L.push("-- The browser-shaped contract: the same (id, state, updated_at) columns as");
  L.push("-- public.bolao_state_public, so a client's readTable can be re-pointed here with no code change.");
  L.push("-- security_invoker: the view executes as its CALLER, not as postgres. Without it a non-owner");
  L.push("-- reading this view would run with the owner's authority — KPLUS-F058 exactly.");
  L.push("CREATE OR REPLACE VIEW bolao.v_state_document");
  L.push("WITH (security_invoker = true) AS");
  L.push("SELECT");
  L.push("  d.doc_id                       AS id,");
  L.push("  bolao.read_document(d.slug)    AS state,");
  L.push("  NULL::timestamptz              AS updated_at");
  L.push("FROM (VALUES");
  const rows = Object.entries(READ_SURFACE).map(([, s]) => `  ('${s.poolSlug}', '${POOL_TO_DOC_ID[s.poolSlug]}')`);
  L.push(rows.join(",\n"));
  L.push(") AS d(slug, doc_id);");
  L.push("");
  L.push("-- updated_at is NULL and not now(): it means 'when the document was last written', and the");
  L.push("-- normalized side does not carry that fact. Returning a synthesised timestamp would let a");
  L.push("-- last-writer-wins client conclude this surface is newer than whatever it holds.");
  L.push("COMMENT ON VIEW bolao.v_state_document IS 'Read surface in the legacy (id, state, updated_at) contract. updated_at is deliberately NULL: the normalized model does not record when the document was last written.';");
  L.push("");
  L.push("REVOKE ALL ON TABLE bolao.v_state_document FROM PUBLIC;");
  L.push("");
  L.push("-- PRIVILEGE BOUNDARY, and it is the fail-closed guard for this whole stage.");
  L.push("-- service_role ONLY. No anon. No authenticated. Zero of three products are read-routable today");
  L.push("-- (m15_contract.mjs), so a browser-reachable surface would be a lossy document one config edit");
  L.push("-- away from being served to real participants. Granting the browser roles is a separate,");
  L.push("-- separately-authorized act that must follow a green shadow — not a convenience bundled here.");
  L.push("GRANT EXECUTE ON FUNCTION bolao.read_document(text) TO service_role;");
  L.push("GRANT SELECT ON TABLE bolao.v_state_document TO service_role;");
  return L.join("\n");
}
