#!/usr/bin/env node
/**
 * SCORING_PARITY scenario catalog — Batch H, STEP 3/4/10.
 *
 * Each scenario describes ONE business situation once, and emits it twice:
 *
 *   · `legacyState`   — the app's own native state shape, built DIRECTLY from the scenario
 *   · `legacyDocument`— the bolao_state-shaped document WS7's transformers consume
 *
 * The normalized side is produced by scoring_parity_bridge.mjs, which runs the legacyDocument
 * through the real WS7 transformers and WS6 backfill into the normalized SQLite schema, reads the
 * rows back, and reconstructs the app's native state from THOSE ROWS. So the two states reaching the
 * canonical engine travel genuinely different code paths: one is hand-built, the other is a
 * round-trip through the migration.
 *
 * Nothing here decides points. A scenario states what was predicted and what happened; the canonical
 * engine decides what that is worth.
 *
 * All names are invented. No production participant data.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// copa2026 — knockout bracket, {goalsA, goalsB, advanceSide}, podium bonus, 3rd-place + Final gate
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The engine gates its standings on M103 (3rd place) AND M104 (Final) both being locked, and on a
 * non-zero pot. A scenario wanting a ranking must therefore lock both and mark entries paid; one that
 * omits them is exercising the "standings do not exist yet" branch, which is also worth testing.
 */
const copaPick = (a, b, side) => ({ goalsA: a, goalsB: b, advanceSide: side });
const copaResult = copaPick;

function copaScenario(id, { entries, results, paid = null, note = "" }) {
  const legacyState = {
    entries: entries.map((e) => ({ id: e.id, entryName: e.name, picks: e.picks })),
    results,
    paid: paid ?? Object.fromEntries(entries.map((e) => [e.id, true])),
    deletedIds: [],
  };
  // The WS7 document shape uses {h, a, advance}; the app uses {goalsA, goalsB, advanceSide}. This
  // rename is the representation difference the migration has to survive.
  const toDoc = (p) => (p == null ? null : { h: p.goalsA, a: p.goalsB, advance: p.advanceSide });
  const legacyDocument = {
    entries: entries.map((e) => ({
      id: e.id, entryName: e.name, participantEmail: e.email ?? null, paid: true,
      picks: Object.fromEntries(Object.entries(e.picks).map(([m, p]) => [m, toDoc(p)])),
    })),
    results: Object.fromEntries(Object.entries(results).map(([m, r]) => [m, toDoc(r)])),
  };
  return { competition: "copa2026", scenario_id: id, note, legacyState, legacyDocument };
}

/** Real bracket ids from the app's own MATCH_TEAMS, so the engine's bracket logic is exercised. */
const COPA_DECIDERS = { 103: copaResult(1, 0, "A"), 104: copaResult(2, 1, "A") };

export const COPA_SCENARIOS = [
  copaScenario("SC-01-exact-score", {
    note: "an exact score, the highest-value single outcome",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(2, 1, "A"), ...{} } }],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-02-right-winner-wrong-score", {
    note: "correct advancement, wrong score — must not be worth the same as an exact hit",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(3, 0, "A") } }],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-03-wrong-winner", {
    note: "wrong advancement",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(0, 2, "B") } }],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-04-draw-in-regulation", {
    note: "a knockout draw still resolves an advancing side",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(1, 1, "A") } }],
    results: { 73: copaResult(1, 1, "B"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-05-missing-prediction", {
    note: "no prediction for a played match — must score zero, not be skipped in a way that shifts rank",
    entries: [
      { id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(2, 1, "A") } },
      { id: "e2", name: "Bruno Sintetico", picks: {} },
    ],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-06-missing-result", {
    note: "a prediction for a match with no result yet — no points either way",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(2, 1, "A"), 74: copaPick(1, 0, "A") } }],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-07-null-pick-preserved", {
    note: "an explicitly null pick is a real state and must not become 0-0",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(2, 1, "A"), 74: null } }],
    results: { 73: copaResult(2, 1, "A"), 74: copaResult(0, 0, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-08-podium-bonus", {
    note: "the podium bonus, which is where the July 2026 drift incident actually happened",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 101: copaPick(1, 0, "A"), 102: copaPick(2, 0, "A"), 103: copaPick(1, 0, "A"), 104: copaPick(2, 1, "A") } }],
    results: { 101: copaResult(1, 0, "A"), 102: copaResult(2, 0, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-09-ranking-tie", {
    note: "two entries fully tied — the engine must group them at one rank and split the share",
    entries: [
      { id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(2, 1, "A") } },
      { id: "e2", name: "Bruno Sintetico", picks: { 73: copaPick(2, 1, "A") } },
    ],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-10-multiple-entries-one-participant", {
    note: "one participant holding two entries; each must score independently",
    entries: [
      { id: "e1", name: "Ana 1", email: "ana@example.test", picks: { 73: copaPick(2, 1, "A") } },
      { id: "e2", name: "Ana 2", email: "ana@example.test", picks: { 73: copaPick(0, 3, "B") } },
    ],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
  copaScenario("SC-11-standings-not-yet-decided", {
    note: "the deciders are NOT locked, so the engine must return no standings at all — a real outcome",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick(2, 1, "A") } }],
    results: { 73: copaResult(2, 1, "A") },
  }),
  copaScenario("SC-12-string-goals-in-document", {
    note: "legacy documents contain goals as strings; the engine's own parser accepts them and the transformer must not lose them",
    entries: [{ id: "e1", name: "Ana Sintetica", picks: { 73: copaPick("2", "1", "A") } }],
    results: { 73: copaResult(2, 1, "A"), ...COPA_DECIDERS },
  }),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// br2026 — league zones. picks are ORDERED LISTS: g4[4], z4[4], sa6[]
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * br2026 — league zones. Picks are ORDERED LISTS: g4[4], z4[4], sa6[].
 *
 * The zone RESULTS are no longer passed as three bare lists. They come from a CLASSIFICATION SNAPSHOT
 * in the legacy document — the same shape sync_espn.py persists to
 * bolao/br2026/data/espn-standings-normalized.json — because that is what the normalized model now
 * holds (DDL-M11, added in Batch I to close BATCH-H-OP-1). The zones are position slices of it:
 * G4 = 1-4, SA6 = 7-12, Z4 = 17-20.
 *
 * A scenario therefore states the TABLE, and both representations derive the zones from it. Passing
 * pre-sliced lists would have skipped the very thing under test.
 */
function brScenario(id, { entries, table, note = "", stale = false, staleReason = null, extraSnapshots = [] }) {
  // The LEGACY side reproduces the app's own two steps: fetch_standings() SORTS, then the caller
  // slices. The sort key is rank ASC, goal difference DESC, goals for DESC, name ASC
  // (send_round_email.py:134, mirrored in app.js:943). It is written out here rather than imported
  // from the transformer, because a legacy side computed by the code under test would compare a
  // function to itself.
  const sorted = [...table].sort((a, b) =>
    (a.rank ?? 99) - (b.rank ?? 99) ||
    (b.gd ?? 0) - (a.gd ?? 0) ||
    (b.gf ?? 0) - (a.gf ?? 0) ||
    a.name.localeCompare(b.name, "pt-BR"));
  const zone = (from, to) => sorted.slice(from - 1, to).map((t) => t.name);
  const legacyState = {
    entries: entries.map((e) => ({ id: e.id, entryName: e.name, picks: e.picks })),
    // Sliced exactly as send_round_email.py:448-450 does: [0:4], [16:20], [6:12].
    g4: zone(1, 4), z4: zone(17, 20), sa6: zone(7, 12),
  };
  const legacyDocument = {
    competition_edition_id: "CE-BR-2026",
    expectedClubCount: table.length,
    entries: entries.map((e) => ({
      id: e.id, entryName: e.name, participantEmail: e.email ?? null, paid: true,
      // Position IS the meaning: g4[0] is the title, not merely "one of four", so each slot is its own
      // subject in the normalized model.
      picks: Object.fromEntries([
        ...(e.picks.g4 || []).map((t, i) => [`g4:${i}`, t ? { h: null, a: null, advance: t } : null]),
        ...(e.picks.z4 || []).map((t, i) => [`z4:${i}`, t ? { h: null, a: null, advance: t } : null]),
        ...(e.picks.sa6 || []).map((t, i) => [`sa6:${i}`, t ? { h: null, a: null, advance: t } : null]),
      ]),
    })),
    results: {},
    classification: {
      schemaVersion: 1, competitionId: "bra.1", provider: "espn",
      generatedAt: "2026-08-09T16:49:53Z", sourceUpdatedAt: "2026-08-09T16:49:53Z",
      stale, staleReason, payloadHash: `hash-${id}`,
      matches: table.map((t, i) => ({
        name: t.name, abbr: t.abbr ?? null, rank: t.rank ?? i + 1,
        points: t.points ?? 0, played: t.played ?? 20, wins: t.wins ?? 0, draws: t.draws ?? 0,
        losses: t.losses ?? 0, gf: t.gf ?? 0, ga: t.ga ?? 0,
        gd: t.gd ?? ((t.gf ?? 0) - (t.ga ?? 0)),
      })),
    },
    extraSnapshots,
  };
  return { competition: "br2026", scenario_id: id, note, legacyState, legacyDocument };
}

/** A full twenty-club table with strictly decreasing ranks, so positions are unambiguous. */
function brTable(names) {
  return names.map((name, i) => ({ name, abbr: name.slice(0, 3).toUpperCase(), rank: i + 1,
    points: 60 - i * 2, played: 20, wins: 20 - i, draws: 0, losses: i, gf: 40 - i, ga: 10 + i,
    gd: (40 - i) - (10 + i) }));
}

const BR_CLUBS = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta",
  "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon"];
const BR_TABLE = brTable(BR_CLUBS);

// Zones derived from BR_TABLE, so a scenario never restates a boundary the model already defines.
const BR_G4 = BR_TABLE.slice(0, 4).map((t) => t.name);      // positions 1-4
const BR_SA6 = BR_TABLE.slice(6, 12).map((t) => t.name);    // positions 7-12
const BR_Z4 = BR_TABLE.slice(16, 20).map((t) => t.name);    // positions 17-20

export const BR_SCENARIOS = [
  brScenario("SC-01-all-exact", {
    note: "every G4 and Z4 position exactly right — the maximum, and position-sensitive",
    entries: [{ id: "b1", name: "Ana Sintetica", picks: { g4: [...BR_G4], z4: [...BR_Z4], sa6: [] } }],
    table: BR_TABLE,
  }),
  brScenario("SC-02-right-zone-wrong-position", {
    note: "correct clubs in the wrong order — the group/exact distinction a set comparison would lose",
    entries: [{ id: "b1", name: "Ana Sintetica", picks: { g4: [...BR_G4].reverse(), z4: [...BR_Z4], sa6: [] } }],
    table: BR_TABLE,
  }),
  brScenario("SC-03-complete-miss", {
    note: "no club in either zone",
    entries: [{ id: "b1", name: "Ana Sintetica", picks: { g4: ["Nu", "Xi", "Rho", "Tau"], z4: ["Iota", "Kappa", "Lambda", "Mu"], sa6: [] } }],
    table: BR_TABLE,
  }),
  brScenario("SC-05-missing-prediction", {
    note: "empty slots must score nothing and must survive the round trip as empty, not as a club",
    entries: [{ id: "b1", name: "Ana Sintetica", picks: { g4: ["Alpha", "", "", ""], z4: ["", "", "", ""], sa6: [] } }],
    table: BR_TABLE,
  }),
  brScenario("SC-09-ranking-tie", {
    note: "two entries with identical picks — the reverse-alphabetical final tiebreak must be reproduced",
    entries: [
      { id: "b1", name: "Ana Sintetica", picks: { g4: [...BR_G4], z4: [...BR_Z4], sa6: [] } },
      { id: "b2", name: "Zeta Sintetica", picks: { g4: [...BR_G4], z4: [...BR_Z4], sa6: [] } },
    ],
    table: BR_TABLE,
  }),
  brScenario("SC-11-sa6-hits", {
    note: "the SA6 band (positions 7-12) — a set-membership rule with no position component, br2026-specific",
    entries: [{ id: "b1", name: "Ana Sintetica", picks: { g4: [...BR_G4], z4: [...BR_Z4], sa6: [BR_SA6[0], "Alpha", "Nu"] } }],
    table: BR_TABLE,
  }),
  brScenario("SC-13-zone-boundary-exact", {
    note: "the clubs immediately OUTSIDE each boundary (positions 5, 6, 13, 16) must score nothing — this is what a one-place boundary shift would change",
    entries: [{ id: "b1", name: "Ana Sintetica",
      picks: { g4: [BR_TABLE[4].name, BR_TABLE[5].name, "", ""], z4: [BR_TABLE[15].name, "", "", ""], sa6: [BR_TABLE[12].name, BR_TABLE[5].name] } }],
    table: BR_TABLE,
  }),
  brScenario("SC-14-provider-rank-tie-resolved", {
    note: "two clubs share the provider's rank; the app's own goal-difference tiebreak resolves them, and the resolved positions decide the zone boundary",
    entries: [{ id: "b1", name: "Ana Sintetica", picks: { g4: ["Delta", "Epsilon", "", ""], z4: [], sa6: [] } }],
    // Both clubs carry the provider's rank 4. Goal difference breaks the tie, and gf/ga are adjusted
    // with it so the row stays internally consistent — the transformer refuses a row whose gd does not
    // equal gf - ga, which is what caught the first version of this fixture.
    table: BR_TABLE.map((t, i) =>
      i === 3 ? { ...t, rank: 4, gf: 20, ga: 15, gd: 5 } :
      i === 4 ? { ...t, rank: 4, gf: 24, ga: 15, gd: 9 } : t),
  }),
];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// cdb2026 — two-legged knockout ties, qualified side, champion/runner-up bonus
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * cdb2026 — two-legged knockout ties.
 *
 * Phase ids are the engine's OWN nine: fase-1..fase-5, oitavas, quartas, semifinal, final. Inventing
 * one ("semi") made `_all_ties` skip the tie entirely and five points vanished with no error — the
 * engine iterates its PHASES constant, so an unknown phase is simply not scored.
 *
 * A tie carries teamA/teamB and a qualifiedTeamId of "A" or "B", NOT a team name. Getting that wrong
 * produced a scenario where BOTH representations derived the same wrong podium, so parity passed
 * while measuring nothing — the most dangerous kind of green.
 */
function cdbScenario(id, { entries, ties, note = "" }) {
  const phases = {};
  for (const t of ties) {
    const tie = { matches: t.legs || {}, qualifiedTeamId: t.qualifiedSide || null, teamA: t.teamA, teamB: t.teamB };
    ((phases[t.phase] ||= { ties: {} }).ties)[t.id] = tie;
  }
  const legacyState = {
    entries: entries.map((e) => ({
      id: e.id, entryName: e.name, picks: e.picks,
      predictedChampion: e.predictedChampion ?? null,
      predictedRunnerUp: e.predictedRunnerUp ?? null,
    })),
    phases,
    paid: Object.fromEntries(entries.map((e) => [e.id, true])),
    deletedIds: [],
  };
  // Each leg is its own subject (`tie:leg`), because the normalized model stores one prediction row
  // per subject: a tie's two legs are two distinct predicted facts. The qualified-side pick is a
  // third subject (`qual:tie`).
  const docPicks = (e) => {
    const out = {};
    for (const [tieId, legs] of Object.entries(e.picks.matches || {})) {
      for (const [leg, p] of Object.entries(legs)) {
        out[`${tieId}:${leg}`] = p == null ? null : { h: p.goalsHome, a: p.goalsAway, advance: null };
      }
    }
    for (const [tieId, side] of Object.entries(e.picks.qualified || {})) {
      out[`qual:${tieId}`] = { h: null, a: null, advance: side };
    }
    return out;
  };
  const docResults = {};
  for (const t of ties) {
    for (const [leg, r] of Object.entries(t.legs || {})) {
      docResults[`${t.id}:${leg}`] = { h: r.goalsHome, a: r.goalsAway, advance: null };
    }
    if (t.qualifiedSide) docResults[`qual:${t.id}`] = { h: null, a: null, advance: t.qualifiedSide };
  }
  const legacyDocument = {
    entries: entries.map((e) => ({
      id: e.id, entryName: e.name, participantEmail: e.email ?? null, paid: true, picks: docPicks(e),
      predictedChampion: e.predictedChampion ?? null, predictedRunnerUp: e.predictedRunnerUp ?? null,
    })),
    results: docResults,
    // The `ties` rows the normalized model owns. The adapter READS the phase and teams from here
    // rather than inferring them from the tie id.
    ties: ties.map((t) => ({ tie_id: t.id, competition_edition_phase_id: t.phase,
      team_a: t.teamA, team_b: t.teamB, qualified_side: t.qualifiedSide || null })),
  };
  return { competition: "cdb2026", scenario_id: id, note, legacyState, legacyDocument };
}

const FINAL_TIE = (qualifiedSide, legs = { 1: { goalsHome: 2, goalsAway: 1 } }) =>
  ({ id: "t_final", phase: "final", teamA: "Alpha", teamB: "Beta", qualifiedSide, legs });

export const CDB_SCENARIOS = [
  cdbScenario("SC-01-exact-leg", {
    note: "an exact leg score",
    entries: [{ id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 2, goalsAway: 1 } } }, qualified: {} } }],
    ties: [FINAL_TIE("A")],
  }),
  cdbScenario("SC-02-right-result-wrong-score", {
    note: "correct outcome, wrong score — the mutually-exclusive points rule the audit checks",
    entries: [{ id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 3, goalsAway: 0 } } }, qualified: {} } }],
    ties: [FINAL_TIE("A")],
  }),
  cdbScenario("SC-03-wrong-result", {
    note: "wrong outcome entirely",
    entries: [{ id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 0, goalsAway: 3 } } }, qualified: {} } }],
    ties: [FINAL_TIE("A")],
  }),
  cdbScenario("SC-04-draw-leg", {
    note: "a drawn leg still resolves a qualified side",
    entries: [{ id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 1, goalsAway: 1 } } }, qualified: {} } }],
    ties: [FINAL_TIE("B", { 1: { goalsHome: 1, goalsAway: 1 } })],
  }),
  cdbScenario("SC-05-missing-prediction", {
    note: "no prediction for a played leg",
    entries: [
      { id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 2, goalsAway: 1 } } }, qualified: {} } },
      { id: "c2", name: "Bruno Sintetico", picks: { matches: {}, qualified: {} } },
    ],
    ties: [FINAL_TIE("A")],
  }),
  cdbScenario("SC-06-no-result", {
    note: "the Final is not decided, so there is no podium and no standings",
    entries: [{ id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 2, goalsAway: 1 } } }, qualified: {} }, predictedChampion: "Alpha" }],
    ties: [{ id: "t_final", phase: "final", teamA: "Alpha", teamB: "Beta", qualifiedSide: null, legs: {} }],
  }),
  cdbScenario("SC-08-two-phase-with-qualified", {
    note: "a real phase transition (semifinal -> final) plus the qualified-side bonus on both ties",
    entries: [{
      id: "c1", name: "Ana Sintetica",
      picks: { matches: { t_semi: { 1: { goalsHome: 1, goalsAway: 0 }, 2: { goalsHome: 0, goalsAway: 0 } }, t_final: { 1: { goalsHome: 2, goalsAway: 1 } } },
        qualified: { t_semi: "A", t_final: "A" } },
      predictedChampion: "Alpha", predictedRunnerUp: "Beta",
    }],
    ties: [
      { id: "t_semi", phase: "semifinal", teamA: "Alpha", teamB: "Gamma", qualifiedSide: "A",
        legs: { 1: { goalsHome: 1, goalsAway: 0 }, 2: { goalsHome: 0, goalsAway: 0 } } },
      FINAL_TIE("A"),
    ],
  }),
  cdbScenario("SC-09-ranking-tie", {
    note: "two identically-scoring entries must share a rank and split the share",
    entries: [
      { id: "c1", name: "Ana Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 2, goalsAway: 1 } } }, qualified: {} } },
      { id: "c2", name: "Zeta Sintetica", picks: { matches: { t_final: { 1: { goalsHome: 2, goalsAway: 1 } } }, qualified: {} } },
    ],
    ties: [FINAL_TIE("A")],
  }),
  cdbScenario("SC-11-podium-bonus", {
    note: "champion and runner-up bonuses — cdb2026-specific, derived from the Final tie's qualified side",
    entries: [
      { id: "c1", name: "Ana Sintetica", picks: { matches: {}, qualified: {} }, predictedChampion: "Alpha", predictedRunnerUp: "Beta" },
      { id: "c2", name: "Bruno Sintetico", picks: { matches: {}, qualified: {} }, predictedChampion: "Beta", predictedRunnerUp: "Alpha" },
    ],
    ties: [FINAL_TIE("A")],
  }),
];

export const ALL_SCENARIOS = [...COPA_SCENARIOS, ...BR_SCENARIOS, ...CDB_SCENARIOS];

export function scenariosFor(competition) {
  return ALL_SCENARIOS.filter((s) => s.competition === competition);
}

export const SCENARIO_COVERAGE = Object.freeze({
  "SC-01": "exact score", "SC-02": "correct winner, wrong score", "SC-03": "wrong winner",
  "SC-04": "draw", "SC-05": "missing prediction", "SC-06": "missing result",
  "SC-07": "corrected/null result handling", "SC-08": "phase transition",
  "SC-09": "ranking tie", "SC-10": "multiple entries per participant",
  "SC-11": "competition-specific rule", "SC-12": "stale/legacy input shape",
});

export default { ALL_SCENARIOS, COPA_SCENARIOS, BR_SCENARIOS, CDB_SCENARIOS, scenariosFor, SCENARIO_COVERAGE };
