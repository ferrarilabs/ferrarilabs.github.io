/**
 * THE COMPLETE NORMALIZED READ SURFACE — the sections M16 could not yet claim, and the sanitized
 * public projection over them.
 *
 * ── WHY THIS IS A SECOND MODULE AND NOT AN EDIT TO read_surface.mjs ─────────────────────────────
 *
 * `read_surface.mjs` is the spec M16 was GENERATED from, and `promote_expand_stage.mjs --check`
 * proves the promoted M16 file still matches it byte for byte. Editing that spec would break a
 * check whose whole job is to notice edits, on a migration that is already applied and whose bytes
 * are embedded in the production ledger row. So M16's spec is frozen where it is, and the surface
 * it could not yet claim is specified here. The two are read together; neither is the whole shape.
 *
 * ── WHAT M16 OMITTED, AND WHAT ACTUALLY UNBLOCKED IT ───────────────────────────────────────────
 *
 *   entries/picks   was Q33-A1. Now buildable — but NOT from the columns the handoff assumed.
 *                   `pool_entry_id` is not the document's entry id (Q33-A1 re-minted 25 of 46) and
 *                   `participants.display_name` is not the entry name (canonical on 20 of 46). Both
 *                   now come from source-identity columns backfilled for this purpose.
 *   paid            was KPLUS-OP-4. Now a projection of bolao.entry_payment_confirmation — 50
 *                   source-backed positive assertions, and NOT a financial fact.
 *   results (copa)  was Q39-A1. Now the 95 backfilled copa match_results.
 *   deletedIds      was derived from pool_entries.deleted_at, which is empty on all 46 rows, so it
 *                   returned [] while Copa's document listed 8. Now bolao.pool_entry_tombstone.
 *   meta            still describes the LEGACY DOCUMENT. It is the one section that cannot be
 *                   migrated, so it is DERIVED and labelled as such — see below.
 *   auditLog        EXCLUDED, permanently and deliberately. See below.
 *
 * ── auditLog IS NOT MISSING, IT IS REFUSED ─────────────────────────────────────────────────────
 *
 * The legacy public view strips four payment fields from entries and passes everything else
 * through, so `auditLog` — with `ip`, `userAgent`, `platform`, `screen` — is publicly readable on
 * all three products TODAY. `audit.audit_events` is a different, campaign-authored spine and is not
 * a reproduction of it. No participant-visible behavior reads `auditLog`: the only render sits
 * inside `renderAdmin()`, whose first line returns unless the admin session is active.
 *
 * Excluding it is therefore a security improvement that closes a live leak, at the cost of the
 * in-browser admin audit panel losing its data — a real, admin-only behavior change, recorded
 * rather than discovered later. Forensic access remains via the operator CLI against legacy.
 *
 * `entries[].diagnostics` is the SAME LEAK CLASS and was not previously catalogued: it carries
 * `userAgent`, `timezone` and `viewport` on 21 Copa entries and is public right now. Only its
 * `demo` flag has publicly-visible behavior, so only that is normalized and only that is emitted.
 *
 * ── THREE DECLARED NON-IDENTITIES, EACH WITH ITS PROOF ─────────────────────────────────────────
 *
 * 1. CDB PICKS AGAINST TIES THAT DO NOT EXIST. 20 of 308 CDB pick assertions name `sf-1`, `sf-2`
 *    or `final-1` — tie slugs absent from the document's own `phases` object and from bolao.ties.
 *    They are residue of an earlier bracket. They are NOT projected, and nothing reads them:
 *    `audit_scoring.py` iterates the TIES and looks each one up in the picks
 *    (`picks["matches"].get(tie_id)`), and the app renders per tie from `phases`. A pick whose tie
 *    is not in the bracket is unreachable from both. Registering the three ties to preserve the
 *    keys would mean inventing bracket structure the source itself does not contain.
 * 2. deletedIds ORDER. The document's array order is its insertion order, which was never
 *    migrated. Both apps consume it as `new Set(...)`, so order carries no meaning; the projection
 *    orders deterministically instead of arbitrarily.
 * 3. meta. `updatedAt`/`version` describe when the LEGACY DOCUMENT was last written by which app
 *    build. The normalized model has no such fact and must not manufacture one, so `updatedAt` is
 *    derived as the pool's newest normalized content instant and `version` names the contract that
 *    produced the document. `meta.version` is written by the apps and never read by them;
 *    `meta.updatedAt` is displayed as a "last sync" stamp and is compared in mergeStates.
 */

/** Reproduces the document's millisecond-Z spelling, used where production is uniformly millisecond. */
const isoMs = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The document's timestamps are NOT uniform, and truncating them is not free.
 *
 * 28 of 30 entry `updatedAt` values are spelled to milliseconds (`...829Z`); two br2026 entries
 * carry microseconds (`...887256Z`). `timestamptz` stores the instant either way, so a single
 * millisecond format reproduces 28 exactly and SHORTENS two — which the leaf-level parity run
 * caught and which is a real behavior change, not a cosmetic one: `mergeStates()` compares these
 * as STRINGS, and `...887Z` sorts BEFORE `...887256Z`. A returning browser holding the microsecond
 * value would judge its own stale copy newer than the server's and keep it.
 *
 * So the precision is reproduced rather than normalized: microseconds when the stored value has
 * them, milliseconds when it does not. The test is on the value, never on the product — a
 * per-product rule would be right today and wrong the first time someone saves.
 */
const isoExact = (col) => `CASE WHEN date_part('microseconds', ${col})::bigint % 1000 = 0
                                THEN to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ELSE to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END`;

/** The contract version this surface emits. Named, not inherited from an app build. */
export const DOCUMENT_CONTRACT_VERSION = "normalized/1";

/**
 * One entry, in the shape the PUBLIC document carries it — which is the legacy shape minus the four
 * fields `public.bolao_state_public` already strips. `participantEmail`, `payerName`,
 * `paymentMethod` and `paymentTo` are not emitted because they were never public, and they are not
 * emitted from a stripping step either: they are simply never selected. A projection that built the
 * private shape and then removed fields would be one edit away from serving them.
 *
 * `updatedAt` and `diagnostics` are MERGED CONDITIONALLY so absent stays absent: 16 of 46 entries
 * carry no `updatedAt` key at all, and emitting a null for them would be a different document.
 */
const entryObject = (picksSql) => `
            jsonb_build_object(
              'id',        pe.legacy_entry_id,
              'entryName', pe.display_label,
              'createdAt', ${isoExact("pe.submitted_at")},
              'picks',     ${picksSql}
            )
            || CASE WHEN pe.content_updated_at IS NOT NULL
                    THEN jsonb_build_object('updatedAt', ${isoExact("pe.content_updated_at")}) ELSE '{}'::jsonb END
            -- Only the demo flag. The rest of the legacy diagnostics object is forensic device
            -- metadata and is deliberately not reproduced; see the module header.
            || CASE WHEN pe.is_demo THEN jsonb_build_object('diagnostics', jsonb_build_object('demo', true))
                    ELSE '{}'::jsonb END`;

/**
 * The entries array. Ordered by submitted_at, which reproduces the document's own order — verified
 * on all three products, whose arrays are already in createdAt order. `deleted_at IS NULL` is belt
 * and braces: no row carries it today, and a tombstone is a pool_entry_tombstone row, not this.
 */
const entries = (picksSql) => `
    (SELECT COALESCE(jsonb_agg(${entryObject(picksSql)} ORDER BY pe.submitted_at, pe.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL)`;

/**
 * Copa picks: one object per knockout match, keyed by the document's own match number, which is
 * exactly `matches.provider_match_ref`.
 *
 * `displayA`/`displayB` come from the PREDICTION and not from the match, because on the 10
 * structural slots they are the participant's own projected bracket — match 89 reads "Canada ×
 * Morocco" only for the entries that sent Canada and Morocco through. bolao.matches carries no team
 * on those slots by design.
 */
const COPA_PICKS = `(
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
            )`;

/**
 * br2026 picks: {g4:[4], sa6:[6], z4:[4]}. The ORDINAL IS THE SCORE — br scoring compares
 * positionally and pays a different score for the right club in the wrong slot — so the array is
 * aggregated ORDER BY ordinal and never as an unordered set.
 */
const BR_PICKS = `(
              SELECT COALESCE(jsonb_object_agg(z.zone, z.clubs), '{}'::jsonb)
                FROM (SELECT cp.zone, jsonb_agg(cp.club_name ORDER BY cp.ordinal) AS clubs
                        FROM bolao.classification_predictions cp
                       WHERE cp.pool_entry_id = pe.pool_entry_id
                       GROUP BY cp.zone) z
            )`;

/**
 * cdb2026 picks: {matches: {tie: {leg: {goalsHome, goalsAway}}}, qualified: {tie: side}}.
 *
 * The leg key map is FAIL-CLOSED and has three members, not two: the document spells a single-leg
 * tie's only leg `single`, and `bolao.matches.leg` records 1 for it. A two-member map would emit
 * `first` there and quietly change which leg a participant's score is read from. No ELSE branch —
 * an unmapped leg number yields NULL and the parity harness reports it.
 *
 * Both halves emit `{}` rather than vanishing when an entry has no picks, because the app reads
 * `picks.matches[tieId]` and `picks.qualified[tieId]` directly.
 */
const CDB_LEG_KEY = `CASE m.leg WHEN 1 THEN CASE WHEN (SELECT count(*) FROM bolao.matches m2 WHERE m2.tie_id = m.tie_id) = 1
                                                 THEN 'single' ELSE 'first' END
                               WHEN 2 THEN 'second' END`;

const CDB_PICKS = `jsonb_build_object(
              'matches', (
                SELECT COALESCE(jsonb_object_agg(x.slug, x.legs), '{}'::jsonb) FROM (
                  SELECT ti.slug,
                         jsonb_object_agg(${CDB_LEG_KEY}, jsonb_build_object(
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
            )`;

/**
 * `paid`, in the exact compatibility shape the three apps already read: an object keyed by entry id
 * whose values are `true`. Derived from source-backed confirmations and from nothing else.
 *
 * ALL confirmations for the pool are emitted, tombstoned ones included. That is not an oversight:
 * the CURRENT legacy public contract passes `paid` through untouched, so the four Copa keys whose
 * entries are deleted ARE in today's public document. Dropping them here would be a divergence
 * introduced by this projection rather than by the source. They are inert — the app looks up
 * `paid[entry.id]` and no entry carries those ids — but parity is measured, not assumed.
 *
 * An absent key means NO SOURCE-BACKED PAID CONFIRMATION. It is not an accounting claim.
 */
const PAID = `
    (SELECT COALESCE(jsonb_object_agg(c.source_entry_key::text, true), '{}'::jsonb)
       FROM bolao.entry_payment_confirmation c
      WHERE c.pool_id = pool.pool_id)`;

/** Tombstones. Ordered deterministically; the apps consume this as a Set. */
const DELETED_IDS = `
    (SELECT COALESCE(jsonb_agg(t.legacy_entry_id::text ORDER BY t.legacy_entry_id), '[]'::jsonb)
       FROM bolao.pool_entry_tombstone t
      WHERE t.pool_id = pool.pool_id)`;

/**
 * Copa's results, keyed by the document's match number. `advanceSide` is merged CONDITIONALLY
 * because the document carries it on the 32 knockout results and on none of the 63 group ones —
 * emitting a null for the group stage would add 63 keys that were never there.
 *
 * No `resultSource` key is ever emitted: every Copa result carries source `legacy_unrecorded`,
 * a value this campaign derived for results the document never labelled. Emitting it back would
 * invent a field on 95 results that never had one.
 */
const COPA_RESULTS = `
    (SELECT COALESCE(jsonb_object_agg(m.provider_match_ref,
              jsonb_build_object('goalsA', mr.goals_home, 'goalsB', mr.goals_away)
              || CASE WHEN mr.advance_side IS NOT NULL
                      THEN jsonb_build_object('advanceSide', mr.advance_side) ELSE '{}'::jsonb END
            ), '{}'::jsonb)
       FROM bolao.match_results mr
       JOIN bolao.matches m ON m.match_id = mr.match_id
       JOIN bolao.competition_edition_phases ph ON ph.competition_edition_phase_id = m.competition_edition_phase_id
      WHERE ph.competition_edition_id = pool.competition_edition_id
        AND mr.superseded_by_id IS NULL)`;

/**
 * `meta`. The only section that is DERIVED rather than migrated, and it says so in its own value.
 *
 * `updatedAt` is the newest content instant the normalized model holds for this pool — the entries'
 * own timestamps, not a row clock and not now(). A synthesised now() would let a last-writer-wins
 * client conclude this surface is newer than whatever it holds, which is the same mistake
 * v_state_document's NULL updated_at was written to avoid.
 */
const META = `
    (SELECT jsonb_build_object(
              'updatedAt', ${isoMs("GREATEST(max(pe.content_updated_at), max(pe.submitted_at))")},
              'version',   '${DOCUMENT_CONTRACT_VERSION}')
       FROM bolao.pool_entries pe
      WHERE pe.pool_id = pool.pool_id AND pe.deleted_at IS NULL)`;

/** Per-product section list. Order here is the order the CASE arms are emitted in. */
export const READ_SURFACE_COMPLETE = {
  cdb2026: {
    poolSlug: "cdb2026",
    sections: { entries: entries(CDB_PICKS), paid: PAID, deletedIds: DELETED_IDS, meta: META },
    inheritsFromM16: ["activePhase", "espnSync", "phases"],
    omitted: {
      auditLog: "INTENTIONAL_SECURITY_REDUCTION — forensic ip/userAgent/platform/screen, no public behavior",
      "entries[].lastClientRef": "NO_CONSUMER — an idempotency echo on 1 entry, read by nothing",
    },
  },
  br2026: {
    poolSlug: "br2026",
    sections: { entries: entries(BR_PICKS), paid: PAID, deletedIds: DELETED_IDS, meta: META },
    inheritsFromM16: ["cutoffAt", "results"],
    omitted: {
      auditLog: "INTENTIONAL_SECURITY_REDUCTION — see cdb2026",
      roundEmail: "NO_TARGET_ENTITY — an operator outbox ledger; not in the browser's read contract",
    },
  },
  copa2026: {
    poolSlug: "copa2026",
    sections: { entries: entries(COPA_PICKS), results: COPA_RESULTS, paid: PAID, deletedIds: DELETED_IDS, meta: META },
    inheritsFromM16: ["deletedResults"],
    omitted: {
      auditLog: "INTENTIONAL_SECURITY_REDUCTION — see cdb2026",
      "entries[].diagnostics.*": "INTENTIONAL_SECURITY_REDUCTION — userAgent/timezone/viewport on 21 entries; only the demo flag has public behavior and only it is emitted",
    },
  },
};

/** The document id each pool is known by in public.bolao_state. copa2026's is historic. */
export const POOL_TO_DOC_ID = { copa2026: "main", br2026: "br2026", cdb2026: "cdb2026" };
