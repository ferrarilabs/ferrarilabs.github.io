#!/usr/bin/env node
/**
 * SCORING_PARITY bridge — Batch H, STEP 4/7/8/9/18/19/22.
 *
 * The round trip this file performs, which is the core proof:
 *
 *   legacy document
 *     → WS7 transformers (transformPredictions / transformMatchResults)
 *     → WS6-style backfill into the normalized SQLite schema
 *     → read the normalized ROWS back out
 *     → reconstruct the app's native state FROM THOSE ROWS   ← the adapter
 *     → canonical scoring engine
 *
 * compared against:
 *
 *   legacy scenario → app's native state (hand-built) → the SAME canonical engine
 *
 * The adapter transforms REPRESENTATION only. It never decides a point value, a tiebreak or a rank:
 * both sides are handed to the same Python function, and that function is the sole authority.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * EXIT-STATUS SAFETY (STEP 9)
 *
 * The producer is invoked with execFileSync and its status is read from the thrown error, never from
 * parsed text and never through a shell pipeline. A previous batch lost a red gate to
 * `node gate.mjs | tail -1 && git commit`, because a pipe replaces the exit status with the last
 * command's. `runProducer` therefore returns the real status alongside the parsed evidence, and
 * `scoringParity()` treats a non-zero status as authoritative even if the JSON happens to look clean.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { transformPredictions, transformMatchResults, transformClassificationSnapshots,
  transformCompetitionEditionStandings, zoneSlice, BR2026_ZONES } from "./transformers.mjs";
import { ALL_SCENARIOS, scenariosFor } from "./scoring_scenarios.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PRODUCER = join(ROOT, "scripts", "db", "scoring_parity_producer.py");

/** Where the three canonical engines live. A missing site checkout is a FAIL, never a skip. */
export function findSiteRoot(candidates = [join(ROOT, "..", "ferrarilabs.github.io")]) {
  for (const c of candidates) if (existsSync(join(c, "bolao", "copa2026", "scripts", "audit_scoring.py"))) return c;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The normalized store: the two tables scoring actually reads from
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A minimal slice of the normalized model — predictions and match_results — with the constraints the
 * refreshed M7 draft creates. The UNIQUE index is the point: Batch G found the generator had been
 * dropping every unique index, so `predictions(pool_entry_id, subject_id)` did not exist. Here it
 * does, and a duplicate prediction fails at INSERT rather than being silently resolved by whichever
 * row a SELECT happens to return first.
 */
const NORMALIZED_SCHEMA = `
CREATE TABLE pool_entries (
  pool_entry_id TEXT PRIMARY KEY,
  entry_label   TEXT NOT NULL,
  participant_key TEXT,
  paid          INTEGER NOT NULL DEFAULT 0,
  predicted_champion  TEXT,
  predicted_runner_up TEXT
);
CREATE TABLE predictions (
  prediction_id TEXT PRIMARY KEY,
  pool_entry_id TEXT NOT NULL REFERENCES pool_entries(pool_entry_id),
  subject_id    TEXT NOT NULL,
  home_goals    INTEGER,
  away_goals    INTEGER,
  advancing_team TEXT,
  lock_context  TEXT
);
CREATE UNIQUE INDEX predictions_pool_entry_id_subject_id_uidx ON predictions (pool_entry_id, subject_id);
CREATE TABLE ties (
  tie_id TEXT PRIMARY KEY,
  competition_edition_phase_id TEXT NOT NULL,
  team_a TEXT,
  team_b TEXT,
  qualified_side TEXT
);
CREATE TABLE classification_snapshots (
  classification_snapshot_id TEXT PRIMARY KEY,
  competition_edition_id TEXT NOT NULL,
  provider TEXT,
  schema_version INTEGER,
  generated_at TEXT NOT NULL,
  payload_hash TEXT,
  is_stale INTEGER NOT NULL DEFAULT 0,
  stale_reason TEXT,
  club_count INTEGER NOT NULL,
  CHECK (club_count > 0),
  CHECK (is_stale = 0 OR stale_reason IS NOT NULL)
);
CREATE UNIQUE INDEX classification_snapshots_edition_provider_generated_at_uidx
  ON classification_snapshots (competition_edition_id, provider, generated_at);
CREATE TABLE competition_edition_standings (
  standing_id TEXT PRIMARY KEY,
  classification_snapshot_id TEXT NOT NULL REFERENCES classification_snapshots(classification_snapshot_id),
  position INTEGER NOT NULL,
  provider_rank INTEGER,
  club_name TEXT NOT NULL,
  club_abbr TEXT,
  points INTEGER, played INTEGER, wins INTEGER, draws INTEGER, losses INTEGER,
  goals_for INTEGER, goals_against INTEGER, goal_difference INTEGER,
  CHECK (position > 0)
);
-- The 2026-07-14 zone-boundary audit finding, enforced: an unresolved provider rank tie fails the
-- import instead of quietly moving a relegation boundary.
CREATE UNIQUE INDEX competition_edition_standings_snapshot_position_uidx
  ON competition_edition_standings (classification_snapshot_id, position);
CREATE UNIQUE INDEX competition_edition_standings_snapshot_club_uidx
  ON competition_edition_standings (classification_snapshot_id, club_name);
CREATE TABLE match_results (
  match_result_id TEXT PRIMARY KEY,
  subject_id      TEXT NOT NULL,
  home_goals      INTEGER,
  away_goals      INTEGER,
  advancing_team  TEXT,
  is_official     INTEGER NOT NULL DEFAULT 1,
  superseded_by_id TEXT REFERENCES match_results(match_result_id)
);
CREATE UNIQUE INDEX match_results_subject_id_uidx ON match_results (subject_id)
  WHERE superseded_by_id IS NULL AND is_official = 1;
`;

/**
 * Scoring inputs the NORMALIZED TARGET MODEL cannot represent (BATCH-H-F1).
 *
 * br2026 scores against the final LEAGUE CLASSIFICATION: G4 and Z4 are ordered lists of CLUBS, and
 * SA6 is a set of clubs. `model/target_model.json` has no entity for that. The nearest candidates all
 * fail for a concrete reason:
 *
 *   · match_results  — a match result needs goals. The transformer correctly REFUSES a
 *                      {h: null, a: null} row, because treating a missing score as 0-0 would award
 *                      points for a match that was not played. Zone standings are not matches.
 *   · ranking_snapshots — keyed on pool_entry_id, i.e. a PARTICIPANT's standing. A club is not a
 *                      participant, and forcing one into that column would make the snapshot table
 *                      mean two different things.
 *   · ties / matches — knockout pairings. A league has neither.
 *
 * So br2026's scoring inputs cannot round-trip through the migration, and its parity CANNOT be
 * proven. This is declared rather than worked around: inventing a table here would make the gate
 * green against a schema the migration does not build, which is worse than a red gate.
 */
export const MODEL_GAPS = Object.freeze({
  // br2026's gap was CLOSED in Batch I by modelling classification_snapshots and
  // competition_edition_standings (DDL-M11). The entry is kept as an empty object rather than deleted
  // so the mechanism stays exercised and a future gap has somewhere to be declared.
  _closed_br2026: "the normalized target model has no entity for a league classification: G4/Z4 are ordered lists of CLUBS and SA6 is a set of clubs, while match_results requires goals and ranking_snapshots is keyed on pool_entry_id (a participant, not a club). br2026 scoring inputs therefore cannot round-trip through the migration. Recorded as BATCH-H-F1; adding the entity is a target-model change and belongs to its own batch.",
});

export const BACKFILL_CONFLICT = "BACKFILL_CONFLICT";

/**
 * Run the real WS7 transformers over the legacy document and load the results into the normalized
 * store, exactly as a WS6 backfill would: idempotent on the record's own id, one statement per row,
 * every FATAL or CONFLICT finding refusing the load rather than coercing past it.
 */
export function backfillNormalized(legacyDocument, { supersededResults = [], mutate = null } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(NORMALIZED_SCHEMA);

  const tctx = { sourceVersion: "batch-h", editionId: legacyDocument.competition_edition_id ?? "CE-TEST",
    expectedClubCount: legacyDocument.expectedClubCount ?? null };
  const predOut = transformPredictions(legacyDocument, tctx);
  const resOut = transformMatchResults(legacyDocument, tctx);
  const snapOut = transformClassificationSnapshots(legacyDocument, tctx);
  const standOut = transformCompetitionEditionStandings(legacyDocument, tctx);

  const blocking = [...predOut.findings, ...resOut.findings, ...snapOut.findings, ...standOut.findings]
    .filter((f) => f.severity === "CONFLICT" || f.severity === "FATAL");

  let predictions = predOut.records.map((r) => ({ ...r }));
  let results = resOut.records.map((r) => ({ ...r }));
  let snapshots = snapOut.records.map((r) => ({ ...r }));
  let standings = standOut.records.map((r) => ({ ...r }));
  if (mutate) {
    const m = mutate({ predictions, results, snapshots, standings });
    predictions = m.predictions ?? predictions;
    results = m.results ?? results;
    snapshots = m.snapshots ?? snapshots;
    standings = m.standings ?? standings;
  }

  const entries = (legacyDocument.entries || []).map((e) => ({
    pool_entry_id: e.id,
    entry_label: e.entryName ?? e.id,
    participant_key: (e.participantEmail || e.entryName || "").toLowerCase() || null,
    paid: e.paid ? 1 : 0,
    predicted_champion: e.predictedChampion ?? null,
    predicted_runner_up: e.predictedRunnerUp ?? null,
  }));

  const insertEntry = db.prepare(
    `INSERT INTO pool_entries (pool_entry_id, entry_label, participant_key, paid, predicted_champion, predicted_runner_up)
     VALUES (?,?,?,?,?,?)`);
  for (const e of entries) insertEntry.run(e.pool_entry_id, e.entry_label, e.participant_key, e.paid, e.predicted_champion, e.predicted_runner_up);

  const insertTie = db.prepare(
    `INSERT INTO ties (tie_id, competition_edition_phase_id, team_a, team_b, qualified_side) VALUES (?,?,?,?,?)`);
  for (const t of legacyDocument.ties || []) {
    insertTie.run(t.tie_id, t.competition_edition_phase_id, t.team_a ?? null, t.team_b ?? null, t.qualified_side ?? null);
  }

  const insertSnap = db.prepare(
    `INSERT INTO classification_snapshots (classification_snapshot_id, competition_edition_id, provider,
       schema_version, generated_at, payload_hash, is_stale, stale_reason, club_count)
     VALUES (?,?,?,?,?,?,?,?,?)`);
  const insertStand = db.prepare(
    `INSERT INTO competition_edition_standings (standing_id, classification_snapshot_id, position,
       provider_rank, club_name, club_abbr, points, played, wins, draws, losses,
       goals_for, goals_against, goal_difference)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insertPred = db.prepare(
    `INSERT INTO predictions (prediction_id, pool_entry_id, subject_id, home_goals, away_goals, advancing_team, lock_context)
     VALUES (?,?,?,?,?,?,?)`);
  const loadErrors = [];
  for (const sn of snapshots) {
    try {
      insertSnap.run(sn.classification_snapshot_id, sn.competition_edition_id, sn.provider,
        sn.schema_version, sn.generated_at, sn.payload_hash, sn.is_stale ? 1 : 0, sn.stale_reason, sn.club_count);
    } catch (e) { loadErrors.push({ kind: "SNAPSHOT_REJECTED", subject: sn.classification_snapshot_id, error: String(e.message).slice(0, 120) }); }
  }
  for (const st of standings) {
    try {
      insertStand.run(st.standing_id, st.classification_snapshot_id, st.position, st.provider_rank,
        st.club_name, st.club_abbr, st.points, st.played, st.wins, st.draws, st.losses,
        st.goals_for, st.goals_against, st.goal_difference);
    } catch (e) { loadErrors.push({ kind: "STANDING_REJECTED", subject: `${st.club_name}@${st.position}`, error: String(e.message).slice(0, 120) }); }
  }
  for (const p of predictions) {
    try {
      insertPred.run(p.prediction_id, p.pool_entry_id, p.subject_id, p.home_goals, p.away_goals, p.advancing_team ?? null, p.lock_context ?? null);
    } catch (e) { loadErrors.push({ kind: "PREDICTION_REJECTED", subject: p.subject_id, entry: p.pool_entry_id, error: String(e.message).slice(0, 120) }); }
  }

  const insertRes = db.prepare(
    `INSERT INTO match_results (match_result_id, subject_id, home_goals, away_goals, advancing_team, is_official, superseded_by_id)
     VALUES (?,?,?,?,?,?,?)`);
  // Superseded rows are inserted FIRST so the live row can point at nothing while they point forward,
  // matching the model: a correction is a new row, and the old one is marked rather than edited.
  for (const s of supersededResults) {
    try { insertRes.run(s.match_result_id, s.subject_id, s.home_goals, s.away_goals, s.advancing_team ?? null, 0, s.superseded_by_id ?? null); }
    catch (e) { loadErrors.push({ kind: "SUPERSEDED_REJECTED", subject: s.subject_id, error: String(e.message).slice(0, 120) }); }
  }
  for (const r of results) {
    const id = `mr-${r.match_id ?? r.subject_id}`;
    try { insertRes.run(id, r.match_id ?? r.subject_id, r.home_goals ?? r.goals_home ?? null, r.away_goals ?? r.goals_away ?? null, r.advancing_team ?? null, 1, null); }
    catch (e) { loadErrors.push({ kind: "RESULT_REJECTED", subject: r.match_id ?? r.subject_id, error: String(e.message).slice(0, 120) }); }
  }

  return { db, findings: [...predOut.findings, ...resOut.findings, ...snapOut.findings, ...standOut.findings],
    blocking, loadErrors,
    counts: { predictions: predictions.length, results: results.length, entries: entries.length,
      snapshots: snapshots.length, standings: standings.length } };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The adapters: normalized ROWS → the app's native state. Representation only.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Read the authoritative result per subject. `is_official = 1 AND superseded_by_id IS NULL` is the
 * model's definition of current, and selecting anything else — the newest row, the first row, any row
 * — would make a corrected result a coin flip. This is the STEP 16 requirement expressed as a query.
 */
const OFFICIAL_RESULTS = `SELECT subject_id, home_goals, away_goals, advancing_team
  FROM match_results WHERE is_official = 1 AND superseded_by_id IS NULL ORDER BY subject_id`;

const rows = (db, sql) => db.prepare(sql).all();

function readEntries(db) {
  return rows(db, `SELECT pool_entry_id, entry_label, paid, predicted_champion, predicted_runner_up
                   FROM pool_entries ORDER BY pool_entry_id`);
}
function readPredictions(db) {
  return rows(db, `SELECT pool_entry_id, subject_id, home_goals, away_goals, advancing_team
                   FROM predictions ORDER BY pool_entry_id, subject_id`);
}

/** copa2026: {goalsA, goalsB, advanceSide} keyed by match id. */
export function adaptCopa(db) {
  const preds = readPredictions(db);
  const byEntry = new Map();
  for (const p of preds) {
    if (!byEntry.has(p.pool_entry_id)) byEntry.set(p.pool_entry_id, {});
    // A row whose goals are BOTH null is a preserved null pick, not a 0-0. It is re-emitted as null so
    // the engine's own `if (!pick) continue` sees exactly what the legacy document held.
    byEntry.get(p.pool_entry_id)[p.subject_id] =
      (p.home_goals === null && p.away_goals === null && !p.advancing_team)
        ? null
        : { goalsA: p.home_goals, goalsB: p.away_goals, advanceSide: p.advancing_team };
  }
  const entries = readEntries(db).map((e) => ({
    id: e.pool_entry_id, entryName: e.entry_label, picks: byEntry.get(e.pool_entry_id) || {},
  }));
  const results = {};
  for (const r of rows(db, OFFICIAL_RESULTS)) {
    results[r.subject_id] = { goalsA: r.home_goals, goalsB: r.away_goals, advanceSide: r.advancing_team };
  }
  const paid = Object.fromEntries(readEntries(db).map((e) => [e.pool_entry_id, !!e.paid]));
  return { entries, results, paid, deletedIds: [] };
}

/** br2026: ordered lists rebuilt from position-keyed subjects. Position is the meaning. */
/**
 * br2026: ordered pick lists, and the zone lists read from the NORMALIZED CLASSIFICATION.
 *
 * The authoritative table is the LATEST NON-STALE snapshot for the edition. Not the newest row
 * outright: a stale snapshot means the provider fetch failed and the last known good data was reused,
 * so it is evidence of an attempt rather than a classification. Not the first row either — ordering is
 * the only thing that resolves a correction, since a corrected import is simply a later snapshot.
 *
 * The zone lists are produced by `zoneSlice`, which lives with BR2026_ZONES in transformers.mjs so the
 * boundaries are written down exactly once. This adapter SELECTS clubs by position; it does not decide
 * what a hit is worth. The points remain entirely inside br2026's own scoring engine.
 */
export function adaptBr(db, { editionId = null } = {}) {
  const preds = readPredictions(db);
  const byEntry = new Map();
  for (const p of preds) {
    const m = /^(g4|z4|sa6):(\d+)$/.exec(p.subject_id);
    if (!m) continue;
    if (!byEntry.has(p.pool_entry_id)) byEntry.set(p.pool_entry_id, { g4: [], z4: [], sa6: [] });
    // The empty string, not null: br2026's engine tests `if not picked`, and an ordered list with a
    // hole must keep the hole at its index rather than collapsing and shifting every later position.
    byEntry.get(p.pool_entry_id)[m[1]][Number(m[2])] = p.advancing_team ?? "";
  }
  const fill = (arr, n) => { const out = arr || []; for (let i = 0; i < n; i++) if (out[i] === undefined) out[i] = ""; return out; };
  const entries = readEntries(db).map((e) => {
    const p = byEntry.get(e.pool_entry_id) || { g4: [], z4: [], sa6: [] };
    return { id: e.pool_entry_id, entryName: e.entry_label,
      picks: { g4: fill(p.g4, 4), z4: fill(p.z4, 4), sa6: (p.sa6 || []).filter((x) => x !== undefined) } };
  });

  // Scoped to the EDITION being scored. Without this filter the adapter took the latest non-stale
  // snapshot in the store regardless of season — so a 2025 table would have been scored against 2026
  // predictions, silently, with every constraint satisfied. Found by MUT-CLASS-WRONG-EDITION.
  //
  // An edition with no snapshot of its own does NOT fall back to another edition's: borrowing a table
  // is worse than having none, because having none is a state the engine already models.
  const authoritative = editionId
    ? db.prepare(`
        SELECT classification_snapshot_id, club_count FROM classification_snapshots
        WHERE is_stale = 0 AND competition_edition_id = ?
        ORDER BY generated_at DESC, classification_snapshot_id DESC LIMIT 1`).get(editionId)
    : db.prepare(`
        SELECT classification_snapshot_id, club_count FROM classification_snapshots
        WHERE is_stale = 0
        ORDER BY generated_at DESC, classification_snapshot_id DESC LIMIT 1`).get();

  if (!authoritative) {
    // No authoritative classification is a REAL state, and the engine already models it: score_entry
    // returns None when the zone lists are empty. Returning empty lists reproduces that exactly rather
    // than inventing a table.
    return { entries, g4: [], z4: [], sa6: [], classification: null };
  }

  const table = db.prepare(`
    SELECT position, club_name FROM competition_edition_standings
    WHERE classification_snapshot_id = ? ORDER BY position`).all(authoritative.classification_snapshot_id);

  if (table.length !== authoritative.club_count) {
    throw new Error(`snapshot ${authoritative.classification_snapshot_id} declares ${authoritative.club_count} clubs but carries ${table.length}: the zones are position slices, so a missing row moves a zone boundary`);
  }

  const names = (zone) => zoneSlice(table, zone).map((r) => r.club_name);
  return {
    entries,
    g4: names("g4"), z4: names("z4"), sa6: names("sa6"),
    classification: { snapshotId: authoritative.classification_snapshot_id, clubs: table.length, zones: BR2026_ZONES },
  };
}

/** cdb2026: phases → ties → legs, rebuilt from `tie:leg` and `qual:tie` subjects. */
export function adaptCdb(db) {
  const preds = readPredictions(db);
  const byEntry = new Map();
  for (const p of preds) {
    if (!byEntry.has(p.pool_entry_id)) byEntry.set(p.pool_entry_id, { matches: {}, qualified: {} });
    const acc = byEntry.get(p.pool_entry_id);
    const qual = /^qual:(.+)$/.exec(p.subject_id);
    if (qual) { if (p.advancing_team) acc.qualified[qual[1]] = p.advancing_team; continue; }
    const m = /^(.+):(\d+)$/.exec(p.subject_id);
    if (!m) continue;
    if (p.home_goals === null && p.away_goals === null) continue; // a null leg pick stays absent
    (acc.matches[m[1]] ||= {})[m[2]] = { goalsHome: p.home_goals, goalsAway: p.away_goals };
  }
  const entries = readEntries(db).map((e) => ({
    id: e.pool_entry_id, entryName: e.entry_label,
    picks: byEntry.get(e.pool_entry_id) || { matches: {}, qualified: {} },
    predictedChampion: e.predicted_champion, predictedRunnerUp: e.predicted_runner_up,
  }));

  // Tie identity, teams and phase come from the `ties` ROWS, which the model owns
  // (ties.competition_edition_phase_id, ties.team_a, ties.team_b, ties.qualified_side).
  //
  // An earlier version INFERRED the phase from the tie id — `id.includes("final") ? "final" : "semi"`.
  // That is the wrong-phase-mapping hazard in person: it produced the phase id "semi", which is not
  // one of the engine's nine real phases, so `_all_ties` skipped the tie entirely and five points
  // vanished with no error anywhere. An adapter must READ the mapping or FAIL, never guess it.
  const tieRows = rows(db, `SELECT tie_id, competition_edition_phase_id, team_a, team_b, qualified_side FROM ties ORDER BY tie_id`);
  const tieMeta = new Map(tieRows.map((t) => [t.tie_id, t]));

  const ties = {};
  for (const r of rows(db, OFFICIAL_RESULTS)) {
    const qual = /^qual:(.+)$/.exec(r.subject_id);
    const tieId = qual ? qual[1] : (/^(.+):(\d+)$/.exec(r.subject_id) || [])[1];
    if (!tieId) continue;
    if (!tieMeta.has(tieId)) {
      throw new Error(`no ties row for ${tieId}: the phase and teams cannot be resolved, and inferring them would decide scoring by guesswork`);
    }
    const t = (ties[tieId] ||= { matches: {} });
    if (qual) continue;
    const leg = /^(.+):(\d+)$/.exec(r.subject_id)[2];
    t.matches[leg] = { goalsHome: r.home_goals, goalsAway: r.away_goals };
  }

  const phases = {};
  for (const [tieId, meta] of tieMeta) {
    const tie = ties[tieId] || { matches: {} };
    // The engine reads teamA/teamB and a qualifiedTeamId of "A" or "B"; the model stores team_a,
    // team_b and qualified_side. This is a rename, not a decision.
    tie.teamA = meta.team_a;
    tie.teamB = meta.team_b;
    tie.qualifiedTeamId = meta.qualified_side || null;
    ((phases[meta.competition_edition_phase_id] ||= { ties: {} }).ties)[tieId] = tie;
  }

  const paid = Object.fromEntries(readEntries(db).map((e) => [e.pool_entry_id, !!e.paid]));
  return { entries, phases, paid, deletedIds: [] };
}

const ADAPTERS = { copa2026: adaptCopa, br2026: adaptBr, cdb2026: adaptCdb };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Bundle construction
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the scenario bundle the Python producer consumes: for each scenario, the hand-built legacy
 * state and the round-tripped normalized state.
 *
 * `mutate` and `supersededResults` exist for the negative fixtures. A backfill that refuses a row —
 * a duplicate prediction hitting the unique index, or a CONFLICT finding — is recorded and the
 * scenario is marked so the gate fails BEFORE scoring rather than scoring whatever survived.
 */
export function buildBundle({ scenarios = ALL_SCENARIOS, mutate = null, supersededFor = null, scope = null } = {}) {
  const out = [], loadIssues = [];
  for (const sc of scenarios) {
    if (MODEL_GAPS[sc.competition]) {
      out.push({ competition: sc.competition, scenario_id: sc.scenario_id, note: sc.note,
        legacy: sc.legacyState, normalized: null, model_gap: MODEL_GAPS[sc.competition] });
      continue;
    }
    const superseded = supersededFor ? (supersededFor(sc) || []) : [];
    const { db, blocking, loadErrors, findings } = backfillNormalized(sc.legacyDocument, {
      supersededResults: superseded, mutate: mutate ? (rec) => mutate(rec, sc) : null,
    });
    const adapter = ADAPTERS[sc.competition];
    let normalized = null, adapterError = null;
    try { normalized = adapter(db, { editionId: sc.legacyDocument.competition_edition_id ?? null }); }
    catch (e) { adapterError = String(e.message).slice(0, 160); }
    db.close();

    if (blocking.length || loadErrors.length || adapterError) {
      loadIssues.push({ scenario_id: sc.scenario_id, competition: sc.competition,
        blocking: blocking.map((f) => f.code || f.id || f.severity), loadErrors, adapterError });
    }
    out.push({
      competition: sc.competition, scenario_id: sc.scenario_id, note: sc.note,
      legacy: sc.legacyState,
      // A refused load or a crashed adapter yields NO normalized representation. The producer treats
      // a missing side as INVALID_INPUT, which is the fail-closed outcome: "we could not build it" is
      // never "it matched".
      normalized: (blocking.length || loadErrors.length || adapterError) ? null : normalized,
      backfill: { findings: findings.length, blocking: blocking.length, loadErrors: loadErrors.length },
    });
  }
  return { scenarios: out, loadIssues, ...(scope ? { scope } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Producer invocation — exit status is authoritative
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function runProducer(bundle, { siteRoot = findSiteRoot(), timeoutMs = 120000 } = {}) {
  if (!siteRoot) {
    return { status: 1, evidence: { overall_status: "ENGINE_MISSING", results: [],
      error: "the ferrarilabs.github.io checkout was not found next to this repository, so the canonical scoring engines cannot be reached. A scoring audit that did not run is not a scoring audit that passed.",
      SCORING_PARITY: { checked: 0, mismatches: 1 } } };
  }
  if (!existsSync(PRODUCER)) {
    return { status: 1, evidence: { overall_status: "PRODUCER_ERROR", results: [], error: "producer script missing",
      SCORING_PARITY: { checked: 0, mismatches: 1 } } };
  }
  const dir = mkdtempSync(join(tmpdir(), "scoring-parity-"));
  const bundlePath = join(dir, "bundle.json");
  const outPath = join(dir, "evidence.json");
  try {
    writeFileSync(bundlePath, JSON.stringify(bundle));
    let status = 0;
    try {
      // execFileSync, NOT a shell pipeline. The status comes from the process, never from text.
      execFileSync("python3", [PRODUCER, "--scenarios", bundlePath, "--site-root", siteRoot, "--out", outPath],
        { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, env: sanitisedEnv() });
    } catch (e) {
      status = typeof e.status === "number" ? e.status : 1;
      if (e.killed || e.signal) {
        return { status: status || 1, evidence: { overall_status: "PRODUCER_ERROR", results: [],
          error: `producer killed (${e.signal || "timeout"})`, SCORING_PARITY: { checked: 0, mismatches: 1 } } };
      }
    }
    let evidence;
    try { evidence = JSON.parse(readFileSync(outPath, "utf8")); }
    catch {
      return { status: status || 1, evidence: { overall_status: "PRODUCER_ERROR", results: [],
        error: "producer wrote no readable evidence", SCORING_PARITY: { checked: 0, mismatches: 1 } } };
    }
    return { status, evidence };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Strip anything that could give a subprocess a route to production. */
function sanitisedEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(PG|SUPABASE|EMAILJS|DATABASE_URL)/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The WS5 producer
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Produce SCORING_PARITY evidence in the shape choreography.evaluatePromotion consumes.
 *
 * The exit status is authoritative: if the producer exited non-zero, this reports a mismatch even
 * when the JSON looks clean. That ordering is deliberate — a producer that crashed after writing a
 * partial file must not be able to present itself as a pass.
 */
export function scoringParity({ scenarios = ALL_SCENARIOS, siteRoot = findSiteRoot(), mutate = null,
  supersededFor = null, scope = null } = {}) {
  const bundle = buildBundle({ scenarios, mutate, supersededFor, scope });
  const { status, evidence } = runProducer(bundle, { siteRoot });

  const declared = evidence.SCORING_PARITY || { checked: 0, mismatches: 1 };
  const buildFailures = bundle.loadIssues.length;
  const statusMismatch = status !== 0 ? Math.max(1, declared.mismatches) : declared.mismatches;

  return {
    producer: "scoring_parity_bridge.scoringParity",
    exitStatus: status,
    overall_status: status === 0 ? evidence.overall_status : (evidence.overall_status || "PRODUCER_ERROR"),
    tolerance: "ZERO",
    reimplementsScoring: false,
    canonicalEngines: evidence.canonical_engines || null,
    audits: evidence.audits || null,
    byCompetition: evidence.by_competition || {},
    results: evidence.results || [],
    loadIssues: bundle.loadIssues,
    SCORING_PARITY: {
      checked: declared.checked,
      // A scenario whose normalized side could not even be BUILT counts as a mismatch, not as an
      // untested absence. Otherwise breaking the backfill would improve the gate's numbers.
      mismatches: statusMismatch + buildFailures,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  const scenarios = only ? scenariosFor(only) : ALL_SCENARIOS;
  const r = scoringParity({ scenarios });
  for (const row of r.results) {
    const ok = row.overall_status === "PASS_EXACT";
    console.log(`${ok ? "✓" : "✗"} ${row.competition.padEnd(9)} ${row.scenario_id.padEnd(38)} ${row.overall_status}` +
      (ok ? "" : `  ${JSON.stringify(row.detail).slice(0, 150)}`));
  }
  console.log(`\nby competition: ${JSON.stringify(r.byCompetition)}`);
  console.log(`audits: ${JSON.stringify(r.audits)}`);
  console.log(`SCORING_PARITY: checked=${r.SCORING_PARITY.checked} mismatches=${r.SCORING_PARITY.mismatches}`);
  console.log(r.SCORING_PARITY.mismatches === 0 ? "\n✓ SCORING PARITY EXACT\n" : `\n✗ SCORING PARITY FAILED (${r.overall_status})\n`);
  process.exit(r.SCORING_PARITY.mismatches === 0 ? 0 : 1);
}

export default { scoringParity, buildBundle, runProducer, backfillNormalized, adaptCopa, adaptBr, adaptCdb, findSiteRoot };
