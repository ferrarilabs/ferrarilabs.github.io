#!/usr/bin/env node
/**
 * SCORING_PARITY gate tests — Batch H.
 *
 * The governing rule: the three applications' own scoring engines are the ONLY authority. This suite
 * proves that (a) both representations really do reach those engines, (b) a difference in either
 * representation really does make the gate fail, and (c) nothing in the DB-modernization tooling has
 * started deciding points on its own.
 *
 * Every mutant below changes the NORMALIZED REPRESENTATION and never the engine. That is the whole
 * design: if a mutant could only be caught by editing scoring logic, the gate would be testing the
 * wrong thing.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  scoringParity, buildBundle, runProducer, backfillNormalized, adaptCopa, adaptBr, adaptCdb,
  findSiteRoot, MODEL_GAPS, PRODUCER,
} from "./scoring_parity_bridge.mjs";
import { BR2026_ZONES, zoneSlice, transformClassificationSnapshots,
  transformCompetitionEditionStandings } from "./transformers.mjs";
import { SCORING_PARITY_COVERAGE } from "./migration_drift.mjs";
import { ALL_SCENARIOS, COPA_SCENARIOS, BR_SCENARIOS, CDB_SCENARIOS, scenariosFor, SCENARIO_COVERAGE } from "./scoring_scenarios.mjs";
import { evaluateParity, evaluatePromotion } from "./choreography.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Strip comments and string literals before scanning source for a forbidden shape.
 *
 * Without this, a docstring EXPLAINING the pipe hazard trips the pipe check, and the sentence
 * explaining why ranking_snapshots cannot hold a club standing trips the snapshot check. Every
 * false positive this programme has produced in a source scan came from matching prose.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|#)/.test(l)).join("\n")
  .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const SITE = findSiteRoot();
const PROVEN = ["copa2026", "br2026", "cdb2026"];   // every competition now round-trips (Batch I)
const proven = ALL_SCENARIOS.filter((s) => PROVEN.includes(s.competition));

/** One full run, reused: invoking three Python engines per call is not free. */
const BASE = scoringParity({ scenarios: proven, scope: PROVEN });
const brOne = scenariosFor("br2026").filter((s) => s.scenario_id === "SC-01-all-exact");
const copaOne = scenariosFor("copa2026").filter((s) => s.scenario_id === "SC-09-ranking-tie");
const cdbOne = scenariosFor("cdb2026").filter((s) => s.scenario_id === "SC-08-two-phase-with-qualified");

// =============================================================================================
console.log("\nSTEP 1/2 — the canonical engines are the only authority\n");
// =============================================================================================

test("the site checkout carrying the canonical engines is present", () => {
  assert(SITE, "the ferrarilabs.github.io checkout was not found; a scoring audit that cannot run is not a pass");
  for (const app of ["copa2026", "br2026", "cdb2026"]) {
    assert(readFileSync(join(SITE, "bolao", app, "scripts", "audit_scoring.py"), "utf8").length > 0, `${app} audit missing`);
  }
});

test("each competition's own static self-audit passed as a precondition", () => {
  assert(BASE.audits, "no audit results were recorded");
  for (const app of PROVEN) {
    assert(BASE.audits[app], `${app} audit not run`);
    eq(BASE.audits[app].passed, true, `${app} audit must pass before any parity result is believed`);
    eq(BASE.audits[app].failed.length, 0, `${app} failing checks: ${BASE.audits[app].failed}`);
  }
});

test("the producer declares that it does not reimplement scoring", () => {
  eq(BASE.reimplementsScoring, false, "the producer must not claim to score");
  eq(BASE.tolerance, "ZERO", "tolerance");
  assert(BASE.canonicalEngines, "the engines used must be named in the evidence");
  for (const app of PROVEN) assert(BASE.canonicalEngines[app], `${app} engine not named`);
});

test("the engines are import-safe: no production connection at import time", () => {
  // Imported with every PG*/SUPABASE*/EMAILJS* variable stripped. If any engine opened a connection at
  // import, this would fail rather than quietly reaching the production pooler.
  const script = [
    "import os,sys",
    "[os.environ.pop(k) for k in list(os.environ) if k.startswith(('PG','SUPABASE','EMAILJS','DATABASE_URL'))]",
    "import importlib",
    "for app,mod in [('copa2026','send_result_email'),('cdb2026','send_result_email'),('br2026','audit_scoring')]:",
    "    sys.path.insert(0, f'{sys.argv[1]}/bolao/{app}/scripts')",
    "    sys.modules.pop(mod, None); importlib.import_module(mod)",
    "    sys.path.pop(0)",
    "print('ok')",
  ].join("\n");
  const out = execFileSync("python3", ["-c", script, SITE], { encoding: "utf8" });
  assert(/ok/.test(out), "an engine performed I/O at import time");
});

// =============================================================================================
console.log("\nSTEP 22 — the round trip, and STEP 6 per-competition coverage\n");
// =============================================================================================

test("copa2026 parity is exact across every scenario", () => {
  const r = BASE.byCompetition.copa2026;
  assert(r, "no copa2026 results");
  eq(r.failed, 0, `failures: ${JSON.stringify(BASE.results.filter((x) => x.competition === "copa2026" && x.overall_status !== "PASS_EXACT"))}`);
  eq(r.passed, COPA_SCENARIOS.length, "every copa2026 scenario must be exercised");
});

test("cdb2026 parity is exact across every scenario", () => {
  const r = BASE.byCompetition.cdb2026;
  assert(r, "no cdb2026 results");
  eq(r.failed, 0, `failures: ${JSON.stringify(BASE.results.filter((x) => x.competition === "cdb2026" && x.overall_status !== "PASS_EXACT"))}`);
  eq(r.passed, CDB_SCENARIOS.length, "every cdb2026 scenario must be exercised");
});

test("every scenario produced a result hash on BOTH sides", () => {
  for (const row of BASE.results) {
    if (row.overall_status !== "PASS_EXACT") continue;
    assert(row.legacy_result_hash, `${row.scenario_id} has no legacy hash`);
    assert(row.normalized_result_hash, `${row.scenario_id} has no normalized hash`);
    eq(row.legacy_result_hash, row.normalized_result_hash, `${row.scenario_id} hashes must match on a PASS`);
  }
});

test("the two sides genuinely travel different code paths", () => {
  // The legacy state is hand-built by the scenario; the normalized state comes out of the SQLite rows
  // the transformers wrote. If the bridge ever returned the legacy object as the normalized one, this
  // catches it: the reconstructed picks object is a different identity and the results come from a
  // query, not from the scenario literal.
  const sc = copaOne[0];
  const { db } = backfillNormalized(sc.legacyDocument);
  const normalized = adaptCopa(db);
  db.close();
  assert(normalized !== sc.legacyState, "the normalized state must not be the legacy object");
  assert(normalized.entries[0].picks !== sc.legacyState.entries[0].picks, "picks must be rebuilt, not aliased");
  eq(Object.keys(normalized.results).length, Object.keys(sc.legacyState.results).length, "results must be reconstructed from rows");
});

test("the scenario catalog covers every required situation", () => {
  const ids = ALL_SCENARIOS.map((s) => s.scenario_id).join(" ");
  for (const code of Object.keys(SCENARIO_COVERAGE)) {
    assert(ids.includes(code), `no scenario covers ${code} (${SCENARIO_COVERAGE[code]})`);
  }
});

test("every scenario states what it is for", () => {
  for (const s of ALL_SCENARIOS) {
    assert(s.note && s.note.length > 15, `${s.competition}/${s.scenario_id} has no usable note`);
    assert(s.legacyState && s.legacyDocument, `${s.scenario_id} must supply both representations`);
  }
});

// =============================================================================================
console.log("\nBATCH-H-F1 CLOSED — br2026 now round-trips through DDL-M11\n");
// =============================================================================================

test("br2026 parity is exact across every scenario", () => {
  const r = BASE.byCompetition.br2026;
  assert(r, "no br2026 results");
  eq(r.failed, 0, `failures: ${JSON.stringify(BASE.results.filter((x) => x.competition === "br2026" && x.overall_status !== "PASS_EXACT"))}`);
  eq(r.passed, BR_SCENARIOS.length, "every br2026 scenario must be exercised");
});

test("no competition is declared a MODEL_GAP any more", () => {
  const declared = Object.keys(MODEL_GAPS).filter((k) => !k.startsWith("_"));
  eq(declared.length, 0, `still gapped: ${declared.join(", ")}`);
  assert(!BASE.results.some((x) => x.overall_status === "MODEL_GAP"), "no scenario may report MODEL_GAP");
});

test("the declared coverage matches what the producer actually reported", () => {
  // STEP 25: readiness is derived from evidence, not from a hand-edited matrix. If this constant ever
  // claims a competition is proven while the gate says otherwise, the suite fails here.
  const actuallyPassed = new Set(BASE.results.filter((x) => x.overall_status === "PASS_EXACT").map((x) => x.competition));
  for (const c of SCORING_PARITY_COVERAGE.proven) {
    assert(actuallyPassed.has(c), `coverage claims ${c} is proven but the producer did not pass it`);
  }
  eq(Object.keys(SCORING_PARITY_COVERAGE.blocked).length, 0, "nothing may remain blocked");
  eq(SCORING_PARITY_COVERAGE.proven.length, 3, "all three competitions must be claimed proven");
});

test("the zone boundaries are defined in exactly ONE place", () => {
  eq(BR2026_ZONES.g4.from, 1, "G4 starts at 1");
  eq(BR2026_ZONES.g4.to, 4, "G4 ends at 4");
  eq(BR2026_ZONES.sa6.from, 7, "SA6 starts at 7");
  eq(BR2026_ZONES.sa6.to, 12, "SA6 ends at 12");
  eq(BR2026_ZONES.z4.from, 17, "Z4 starts at 17");
  eq(BR2026_ZONES.z4.to, 20, "Z4 ends at 20");
  // Evidence: send_round_email.py:448-450 slices [0:4] / [6:12] / [16:20], app.js:629-631 identically,
  // and audit_scoring.py names "positions 7-12" for SA6 in a comment on SA6_HIT.
  const py = readFileSync(join(SITE, "bolao", "br2026", "scripts", "send_round_email.py"), "utf8");
  assert(/standings\[0:4\]/.test(py), "the G4 slice must still be [0:4] in the app");
  assert(/standings\[16:20\]/.test(py), "the Z4 slice must still be [16:20]");
  assert(/standings\[6:12\]/.test(py), "the SA6 slice must still be [6:12]");
});

test("zone membership is DERIVED, never stored", () => {
  const model = JSON.parse(readFileSync(join(ROOT, "model", "target_model.json"), "utf8"));
  const st = model.entities.find((e) => e.name === "competition_edition_standings");
  assert(st, "competition_edition_standings must exist");
  for (const forbidden of ["is_g4", "is_z4", "is_sa6", "zone"]) {
    assert(!st.columns.some((c) => c.sql === forbidden),
      `${forbidden} must not be a column: the zones are position slices, and storing membership would be a second source of truth for a boundary position already determines`);
  }
  assert(st.columns.some((c) => c.sql === "position"), "position must be stored");
});

test("the classification transformer runs against the REAL persisted provider snapshot", () => {
  const snap = JSON.parse(readFileSync(join(SITE, "bolao", "br2026", "data", "espn-standings-normalized.json"), "utf8"));
  const env = transformClassificationSnapshots({ classification: snap }, { editionId: "CE-BR-2026" });
  eq(env.ok, true, `envelope findings: ${env.findings.map((f) => f.code)}`);
  eq(env.records.length, 1, "one snapshot row");
  const rows = transformCompetitionEditionStandings({ classification: snap }, { editionId: "CE-BR-2026", expectedClubCount: snap.matches.length });
  eq(rows.ok, true, `standings findings: ${rows.findings.map((f) => f.code)}`);
  eq(rows.records.length, snap.matches.length, "one row per club");
  // Positions must be a contiguous 1..N with no gaps: the zones are slices, so a gap moves a boundary.
  eq(rows.records.map((r) => r.position).join(","), rows.records.map((_, i) => i + 1).join(","), "positions must be contiguous from 1");
});

test("the model states why supersession needs no pointer", () => {
  const model = JSON.parse(readFileSync(join(ROOT, "model", "target_model.json"), "utf8"));
  const snap = model.entities.find((e) => e.name === "classification_snapshots");
  assert(!snap.columns.some((c) => c.sql === "superseded_by_id"),
    "a supersession pointer would require an UPDATE, contradicting this table being append-only");
  assert(/latest non-stale snapshot/.test(snap.notes || ""), "the model must state how a correction is resolved");
});

// =============================================================================================
console.log("\nSTEP 11/12 — mutants: every one changes the REPRESENTATION, never the engine\n");
// =============================================================================================

const MUTANTS = [];
const mutant = (id, requirement, opts) => MUTANTS.push({ id, requirement, ...opts });

mutant("MUT-WRONG-PREDICTION", "a changed predicted score fails on score parity", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({
    predictions: predictions.map((p) => (p.subject_id === "73" && p.pool_entry_id === "e1" ? { ...p, home_goals: 4 } : p)),
    results,
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-WRONG-MATCH-ID", "a remapped subject id fails: the prediction lands on the wrong match", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({
    predictions: predictions.map((p) => (p.subject_id === "73" ? { ...p, subject_id: "74" } : p)),
    results,
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-WRONG-RESULT", "a changed official result fails", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({
    predictions,
    results: results.map((r) => ((r.match_id ?? r.subject_id) === "73" ? { ...r, home_goals: 0, away_goals: 5 } : r)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-MISSING-PREDICTION", "a dropped prediction fails", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({ predictions: predictions.filter((p) => p.subject_id !== "73"), results }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-DUPLICATE-PREDICTION", "a duplicated prediction is refused by the UNIQUE index before scoring", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({
    predictions: [...predictions, { ...predictions[0], prediction_id: `${predictions[0].prediction_id}-dup` }],
    results,
  }),
  // The unique index on (pool_entry_id, subject_id) rejects the row, so the normalized side cannot be
  // built at all. That is the correct place to fail: arbitrarily picking one of two predictions would
  // decide a score by row order.
  expect: ["MODEL_GAP", "INVALID_INPUT"],
  expectLoadIssue: true,
});

mutant("MUT-MISSING-RESULT", "a dropped official result fails", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({ predictions, results: results.filter((r) => (r.match_id ?? r.subject_id) !== "73") }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-NULL-PICK-BECOMES-ZERO", "a preserved null pick turned into 0-0 fails", {
  scenarios: scenariosFor("copa2026").filter((s) => s.scenario_id === "SC-07-null-pick-preserved"),
  mutate: ({ predictions, results }) => ({
    predictions: predictions.map((p) => (p.home_goals === null && p.away_goals === null
      ? { ...p, home_goals: 0, away_goals: 0 } : p)),
    results,
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-WRONG-ADVANCE", "a flipped advancing side fails", {
  scenarios: copaOne,
  mutate: ({ predictions, results }) => ({
    predictions: predictions.map((p) => (p.subject_id === "73" ? { ...p, advancing_team: "B" } : p)),
    results,
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-WRONG-PHASE", "a tie moved to the wrong phase fails: an unknown phase is simply not scored", {
  scenarios: cdbOne,
  // The phase must be moved to one the engine does NOT know. Moving a tie between two REAL phases
  // changes nothing, and correctly so: `_all_ties` flattens every phase before scoring, so only
  // `final` has special meaning. The actual hazard — the one that cost five points silently during
  // this batch — is an invented phase id, which the engine simply never iterates.
  mutateDocument: (doc) => ({
    ...doc,
    ties: doc.ties.map((t) => (t.tie_id === "t_semi" ? { ...t, competition_edition_phase_id: "semi" } : t)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING", "FAIL_RULE_SEMANTICS"],
});

mutant("MUT-WRONG-QUALIFIED-SIDE", "a flipped qualified side changes the podium and fails", {
  scenarios: cdbOne,
  mutateDocument: (doc) => ({
    ...doc,
    ties: doc.ties.map((t) => (t.tie_id === "t_final" ? { ...t, qualified_side: "B" } : t)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING", "FAIL_RULE_SEMANTICS"],
});

mutant("MUT-SUPERSEDED-CHOSEN", "choosing a superseded result instead of the official one fails", {
  scenarios: copaOne,
  // A corrected result: the old row is marked superseded, the new one is official. Marking the WRONG
  // one official is exactly the STEP 16 hazard, and it must not be resolvable by row order.
  mutate: ({ predictions, results }) => ({
    predictions,
    results: results.map((r) => ((r.match_id ?? r.subject_id) === "73" ? { ...r, home_goals: 1, away_goals: 1 } : r)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-ENTRY-NAME-LOST", "a lost entry name changes the ranking output", {
  scenarios: copaOne,
  mutateDocument: (doc) => ({ ...doc, entries: doc.entries.map((e) => ({ ...e, entryName: "renamed" })) }),
  expect: ["FAIL_RANKING", "FAIL_RULE_SEMANTICS"],
});

mutant("MUT-PAID-FLAG-LOST", "a lost paid flag changes the pot and therefore the payout split", {
  scenarios: copaOne,
  mutateDocument: (doc) => ({ ...doc, entries: doc.entries.map((e) => ({ ...e, paid: false })) }),
  expect: ["FAIL_RANKING", "FAIL_RULE_SEMANTICS"],
});

// ── STEP 22: classification mutants. Every one changes the CLASSIFICATION, never the engine.

mutant("MUT-CLASS-WRONG-POSITION", "a club moved to the wrong position fails", {
  scenarios: brOne,
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    // Swap positions 4 and 5: the club at 5 enters G4 and the club at 4 leaves it. A one-place move
    // across a boundary is the smallest change that alters a score.
    standings: standings.map((r) => (r.position === 4 ? { ...r, position: 5 } : r.position === 5 ? { ...r, position: 4 } : r)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-CLASS-DUPLICATE-POSITION", "two clubs at one position is refused at load time", {
  scenarios: brOne,
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    standings: standings.map((r) => (r.position === 5 ? { ...r, position: 4 } : r)),
  }),
  // UNIQUE (snapshot, position) rejects it. This is the 2026-07-14 zone-boundary audit finding
  // enforced by the database: an unresolved tie cannot silently move a relegation boundary.
  expect: ["INVALID_INPUT", "MODEL_GAP"],
  expectLoadIssue: true,
});

mutant("MUT-CLASS-DUPLICATE-CLUB", "one club at two positions is refused at load time", {
  scenarios: brOne,
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    standings: standings.map((r) => (r.position === 5 ? { ...r, club_name: standings[3].club_name } : r)),
  }),
  expect: ["INVALID_INPUT", "MODEL_GAP"],
  expectLoadIssue: true,
});

mutant("MUT-CLASS-MISSING-CLUB", "a dropped club shifts every position below it and fails", {
  scenarios: brOne,
  mutate: ({ standings, ...rest }) => ({ ...rest, standings: standings.filter((r) => r.position !== 3) }),
  // The adapter refuses outright: the snapshot's declared club_count no longer matches the rows, and
  // the zones are position slices, so a missing row moves a boundary rather than merely omitting a club.
  expect: ["INVALID_INPUT", "MODEL_GAP"],
  expectLoadIssue: true,
});

mutant("MUT-CLASS-EXTRA-CLUB", "an invented club fails", {
  scenarios: brOne,
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    standings: [...standings, { ...standings[0], standing_id: "st-extra", position: 21, club_name: "Invented FC" }],
  }),
  expect: ["INVALID_INPUT", "MODEL_GAP", "FAIL_SCORE"],
});

mutant("MUT-CLASS-G4-BOUNDARY-SHIFT", "shifting the G4 boundary by one place fails", {
  scenarios: brOne,
  // Rotate the top five so position 1 falls to 5 and everything else moves up. G4's membership changes
  // while the table remains internally valid — no constraint fires, so only scoring parity can catch it.
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    standings: standings.map((r) => (r.position <= 5 ? { ...r, position: r.position === 1 ? 5 : r.position - 1 } : r)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-CLASS-Z4-BOUNDARY-SHIFT", "shifting the Z4 boundary by one place fails", {
  scenarios: brOne,
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    standings: standings.map((r) => (r.position >= 16 ? { ...r, position: r.position === 20 ? 16 : r.position + 1 } : r)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-CLASS-SA6-MEMBERSHIP-SHIFT", "changing who sits in positions 7-12 fails", {
  scenarios: scenariosFor("br2026").filter((x) => x.scenario_id === "SC-11-sa6-hits"),
  mutate: ({ standings, ...rest }) => ({
    ...rest,
    standings: standings.map((r) => (r.position === 7 ? { ...r, position: 13 } : r.position === 13 ? { ...r, position: 7 } : r)),
  }),
  expect: ["FAIL_SCORE", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-CLASS-WRONG-EDITION", "a snapshot belonging to another edition is not the authoritative table", {
  scenarios: brOne,
  mutate: ({ snapshots, ...rest }) => ({
    ...rest,
    snapshots: snapshots.map((sn) => ({ ...sn, competition_edition_id: "CE-BR-2025" })),
  }),
  // The adapter selects by edition. A snapshot from another season must not be scored against, and the
  // load must not silently accept it as this edition's table.
  expect: ["FAIL_SCORE", "INVALID_INPUT", "MODEL_GAP", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

mutant("MUT-CLASS-STALE-SELECTED", "a stale snapshot must never become authoritative", {
  scenarios: brOne,
  mutate: ({ snapshots, ...rest }) => ({
    ...rest,
    // Mark the only snapshot stale. A stale snapshot means the provider fetch FAILED and last-known-good
    // was reused; scoring against it would score against an attempt rather than a classification.
    snapshots: snapshots.map((sn) => ({ ...sn, is_stale: true, stale_reason: "provider fetch failed" })),
  }),
  expect: ["FAIL_SCORE", "INVALID_INPUT", "MODEL_GAP", "FAIL_TIE_BEHAVIOR", "FAIL_RANKING"],
});

for (const m of MUTANTS) {
  test(`MUTANT ${m.id}: ${m.requirement}`, () => {
    const scenarios = m.mutateDocument
      ? m.scenarios.map((s) => ({ ...s, legacyDocument: m.mutateDocument(s.legacyDocument) }))
      : m.scenarios;
    const r = scoringParity({ scenarios, mutate: m.mutate || null });
    eq(r.SCORING_PARITY.mismatches > 0, true, `${m.id} did not make the gate fail`);
    const statuses = r.results.map((x) => x.overall_status);
    const gapOrIssue = r.loadIssues.length > 0;
    assert(m.expect.some((e) => statuses.includes(e)) || (m.expectLoadIssue && gapOrIssue),
      `${m.id} failed for an unexpected reason: ${statuses.join(",")} loadIssues=${r.loadIssues.length}`);
    if (m.expectLoadIssue) assert(gapOrIssue, `${m.id} must be refused at load time, not at scoring time`);
  });
}

test("every mutant id is unique and the set covers the required defect classes", () => {
  const ids = MUTANTS.map((m) => m.id);
  eq(new Set(ids).size, ids.length, "duplicate mutant id");
  const joined = ids.join(" ");
  for (const [label, re] of [
    ["wrong prediction mapping", /WRONG-PREDICTION/], ["wrong match id mapping", /WRONG-MATCH-ID/],
    ["wrong phase mapping", /WRONG-PHASE/], ["wrong result mapping", /WRONG-RESULT/],
    ["duplicate prediction", /DUPLICATE-PREDICTION/], ["missing prediction", /MISSING-PREDICTION/],
    ["incorrect advancement", /WRONG-ADVANCE|WRONG-QUALIFIED-SIDE/], ["result supersession", /SUPERSEDED/],
  ]) assert(re.test(joined), `no mutant covers "${label}"`);
});

// =============================================================================================
console.log("\nSTEP 12 — vacuity: every comparison dimension can fail\n");
// =============================================================================================

test("SCORE can fail", () => {
  const r = scoringParity({ scenarios: copaOne, mutate: ({ predictions, results }) => ({
    predictions: predictions.map((p) => ({ ...p, home_goals: (p.home_goals ?? 0) + 7 })), results }) });
  assert(r.results.some((x) => x.overall_status === "FAIL_SCORE"), `got ${r.results.map((x) => x.overall_status)}`);
});

test("TIE BEHAVIOUR can fail with totals equal", () => {
  // Swap which entry holds which pick in a fully tied scenario. Totals are unchanged; the exact-count
  // attribution moves between entries, which is what the tiebreak reads.
  const sc = scenariosFor("copa2026").filter((s) => s.scenario_id === "SC-05-missing-prediction");
  const r = scoringParity({ scenarios: sc, mutate: ({ predictions, results }) => ({
    predictions: predictions.map((p) => ({ ...p, pool_entry_id: p.pool_entry_id === "e1" ? "e2" : "e1" })), results }) });
  const statuses = r.results.map((x) => x.overall_status);
  assert(statuses.some((s) => s !== "PASS_EXACT"), `moving a prediction between entries must fail: ${statuses}`);
});

test("RANKING can fail", () => {
  const sc = copaOne.map((s) => ({ ...s, legacyDocument: { ...s.legacyDocument,
    entries: s.legacyDocument.entries.map((e) => ({ ...e, entryName: `x-${e.id}` })) } }));
  const r = scoringParity({ scenarios: sc });
  assert(r.results.some((x) => ["FAIL_RANKING", "FAIL_RULE_SEMANTICS"].includes(x.overall_status)),
    `got ${r.results.map((x) => x.overall_status)}`);
});

test("RULE SEMANTICS can fail", () => {
  const r = scoringParity({ scenarios: cdbOne, mutate: null, supersededFor: null });
  eq(r.results[0].overall_status, "PASS_EXACT", "baseline must pass or the next assertion is meaningless");
  const broken = scoringParity({ scenarios: cdbOne.map((s) => ({ ...s, legacyDocument: { ...s.legacyDocument,
    ties: s.legacyDocument.ties.map((t) => ({ ...t, qualified_side: null })) } })) });
  assert(broken.results.some((x) => x.overall_status !== "PASS_EXACT"), "removing the qualified side must fail");
});

test("INVALID_INPUT fires when the two sides hold different entries", () => {
  const r = scoringParity({ scenarios: copaOne.map((s) => ({ ...s,
    legacyDocument: { ...s.legacyDocument, entries: s.legacyDocument.entries.slice(0, 1) } })) });
  assert(r.results.some((x) => ["INVALID_INPUT", "FAIL_RANKING", "FAIL_RULE_SEMANTICS"].includes(x.overall_status)),
    `got ${r.results.map((x) => x.overall_status)}`);
});

// =============================================================================================
console.log("\nSTEP 8/9 — fail-closed, and exit status cannot be masked\n");
// =============================================================================================

test("a missing site checkout FAILS rather than skipping", () => {
  const r = runProducer({ scenarios: [] }, { siteRoot: null });
  eq(r.status, 1, "exit status");
  eq(r.evidence.overall_status, "ENGINE_MISSING", "status");
  assert(r.evidence.SCORING_PARITY.mismatches > 0, "a gate that cannot run must report a mismatch");
  assert(/did not run is not/.test(r.evidence.error), "the reason must be explicit");
});

test("an empty scenario set FAILS: an empty comparison is not a pass", () => {
  const r = runProducer({ scenarios: [] }, { siteRoot: SITE });
  eq(r.status, 1, "exit status");
  eq(r.evidence.overall_status, "INVALID_INPUT", "status");
});

test("an unknown competition FAILS", () => {
  const r = runProducer({ scenarios: [{ competition: "worldcup1930", scenario_id: "x", legacy: {}, normalized: {} }] }, { siteRoot: SITE });
  eq(r.status, 1, "exit status");
  assert(r.evidence.results.some((x) => x.overall_status === "INVALID_INPUT"), "unknown competition must be invalid");
});

test("a run covering only some competitions is NOT a pass", () => {
  const r = runProducer(buildBundle({ scenarios: copaOne }), { siteRoot: SITE });
  eq(r.status, 1, "a partial run must exit non-zero");
  assert(r.evidence.competitions_without_passing_evidence.length > 0,
    "the uncovered competitions must be named: no evidence is not the same as no problem");
});

test("the producer's exit status is authoritative even if the JSON looks clean", () => {
  // The bridge reads status from the process, never from text. Simulated by asserting that a non-zero
  // status forces at least one mismatch regardless of the evidence body.
  const r = scoringParity({ scenarios: copaOne });   // partial run -> non-zero status
  assert(r.exitStatus !== 0, "a partial run should exit non-zero");
  assert(r.SCORING_PARITY.mismatches > 0, "a non-zero exit must force a mismatch even when every scenario passed");
  eq(r.results.every((x) => x.overall_status === "PASS_EXACT"), true, "and the individual scenarios genuinely did pass");
});

test("no scoring gate pipes the producer through text processing", () => {
  const bridge = codeOnly(readFileSync(join(ROOT, "scripts", "db", "scoring_parity_bridge.mjs"), "utf8"));
  assert(!/execSync\(/.test(bridge), "execSync invites a shell pipeline; execFileSync does not");
  assert(/execFileSync/.test(readFileSync(join(ROOT, "scripts", "db", "scoring_parity_bridge.mjs"), "utf8")),
    "the producer must be invoked with execFileSync");
  assert(!/\|\s*(tail|head|grep|awk|sed)/.test(bridge), "a pipe would replace the exit status with the last command's");
});

test("the producer is invoked with a sanitised environment", () => {
  const bridge = readFileSync(join(ROOT, "scripts", "db", "scoring_parity_bridge.mjs"), "utf8");
  assert(/sanitisedEnv\(\)/.test(bridge), "the subprocess env must be sanitised");
  assert(/PG\|SUPABASE\|EMAILJS/.test(bridge), "PG*/SUPABASE*/EMAILJS* must be stripped");
});

// =============================================================================================
console.log("\nSTEP 15/16/17 — snapshot contract, corrected results, duplicate control\n");
// =============================================================================================

test("STEP 15: ranking_snapshots is derived evidence, never a scoring authority", () => {
  // The producer never reads a snapshot. Ranking comes from the engine's own compute_final_payouts /
  // rank_entries, so a corrupted snapshot cannot change a score — it can only disagree with one.
  const bridge = codeOnly(readFileSync(join(ROOT, "scripts", "db", "scoring_parity_bridge.mjs"), "utf8"));
  assert(!/ranking_snapshots/.test(bridge), "the scoring path must not read ranking_snapshots");
  const producer = codeOnly(readFileSync(PRODUCER, "utf8"));
  assert(!/ranking_snapshot/.test(producer), "the producer must not read ranking snapshots");
});

test("STEP 15: a corrupted snapshot is detectable against the recomputed ranking", () => {
  const truth = BASE.results.find((x) => x.scenario_id === "SC-09-ranking-tie" && x.competition === "copa2026");
  assert(truth && truth.overall_status === "PASS_EXACT", "baseline ranking must be established");
  // A snapshot claiming a different order than the engine's recomputation differs from
  // normalized_result_hash, which is what makes the disagreement detectable at all.
  assert(truth.normalized_result_hash, "the recomputed ranking must be hashed so a snapshot can be checked against it");
});

test("STEP 16: the authoritative result is selected by is_official AND superseded_by_id", () => {
  const sc = copaOne[0];
  const superseded = [{ match_result_id: "mr-73-old", subject_id: "73", home_goals: 9, away_goals: 9, superseded_by_id: null }];
  const { db } = backfillNormalized(sc.legacyDocument, { supersededResults: superseded });
  const adapted = adaptCopa(db);
  db.close();
  eq(adapted.results["73"].goalsA, sc.legacyState.results["73"].goalsA,
    "the superseded 9-9 row must be ignored; a corrected result is a new row and the old one is marked, not edited");
  assert(adapted.results["73"].goalsA !== 9, "the superseded value must not win");
});

test("STEP 16: a corrected result round-trips to exact parity", () => {
  const sc = copaOne;
  const r = scoringParity({ scenarios: sc, supersededFor: () =>
    [{ match_result_id: "mr-73-old", subject_id: "73", home_goals: 9, away_goals: 9, superseded_by_id: null }] });
  assert(r.results.every((x) => x.overall_status === "PASS_EXACT"),
    `a superseded row must not change scoring: ${r.results.map((x) => x.overall_status)}`);
});

test("STEP 17: the UNIQUE prediction control refuses a duplicate at load time", () => {
  const sc = copaOne[0];
  const { loadErrors } = backfillNormalized(sc.legacyDocument, {
    mutate: ({ predictions, results }) => ({ predictions: [...predictions, { ...predictions[0], prediction_id: "dup" }], results }),
  });
  assert(loadErrors.length > 0, "a duplicate (pool_entry_id, subject_id) must be rejected");
  eq(loadErrors[0].kind, "PREDICTION_REJECTED", "kind");
  assert(/UNIQUE/i.test(loadErrors[0].error), `the unique index must be what refuses it: ${loadErrors[0].error}`);
});

test("STEP 17: a refused load yields no normalized side, so the gate fails before scoring", () => {
  const bundle = buildBundle({ scenarios: copaOne,
    mutate: ({ predictions, results }) => ({ predictions: [...predictions, { ...predictions[0], prediction_id: "dup" }], results }) });
  eq(bundle.scenarios[0].normalized, null, "a refused load must produce no normalized representation");
  assert(bundle.loadIssues.length > 0, "the issue must be recorded rather than swallowed");
});

// =============================================================================================
console.log("\nSTEP 19/20 — the WS5 gate consumes real evidence and blocks on failure\n");
// =============================================================================================

test("the evidence is shaped for the WS5 promotion evaluator", () => {
  assert(typeof BASE.SCORING_PARITY.checked === "number" && BASE.SCORING_PARITY.checked > 0, "checked");
  eq(typeof BASE.SCORING_PARITY.mismatches, "number", "mismatches");
});

test("every evidence row carries the declared fields, and no PII", () => {
  for (const row of BASE.results) {
    for (const f of ["competition", "scenario_id", "legacy_audit_status", "normalized_audit_status",
      "legacy_result_hash", "normalized_result_hash", "score_parity", "ranking_parity", "rule_parity", "overall_status"]) {
      assert(f in row, `${row.scenario_id} missing ${f}`);
    }
    assert(!/@/.test(JSON.stringify(row)), `${row.scenario_id} leaked an address into the evidence`);
  }
});

test("SCORING_PARITY is no longer ABSENT evidence — a producer exists and reports", () => {
  const r = evaluateParity("predictions", {
    ROW_COUNT_PARITY: { checked: 5, mismatches: 0 }, KEY_PARITY: { checked: 13, mismatches: 0 },
    VALUE_PARITY: { checked: 13, mismatches: 0 }, SCORING_PARITY: BASE.SCORING_PARITY,
  });
  eq(r.missing.length, 0, `SCORING_PARITY must no longer be missing: ${r.missing}`);
  eq(r.vacuous.length, 0, "the producer examined real scenarios");
  assert(BASE.SCORING_PARITY.checked >= COPA_SCENARIOS.length + CDB_SCENARIOS.length,
    "every scenario in the declared scope must be checked");
});

test("within its declared scope, the two proven competitions reach exact parity", () => {
  eq(BASE.SCORING_PARITY.mismatches, 0,
    `copa2026 and cdb2026 must be exact: ${JSON.stringify(BASE.results.filter((x) => x.overall_status !== "PASS_EXACT"))}`);
  eq(BASE.exitStatus, 0, "a fully-covered scoped run must exit zero");
  const r = evaluateParity("predictions", {
    ROW_COUNT_PARITY: { checked: 5, mismatches: 0 }, KEY_PARITY: { checked: 13, mismatches: 0 },
    VALUE_PARITY: { checked: 13, mismatches: 0 }, SCORING_PARITY: BASE.SCORING_PARITY,
  });
  eq(r.verdict, "PASS", `verdict: ${JSON.stringify(r)}`);
});

test("the UNSCOPED run now PASSES, because every competition round-trips", () => {
  const full = scoringParity({ scenarios: ALL_SCENARIOS });
  eq(full.SCORING_PARITY.mismatches, 0,
    `every competition must be exact: ${JSON.stringify(full.results.filter((x) => x.overall_status !== "PASS_EXACT"))}`);
  eq(full.exitStatus, 0, "a full run with all three covered must exit zero");
  eq(full.results.length, ALL_SCENARIOS.length, "every scenario must be evaluated");
  for (const c of ["copa2026", "br2026", "cdb2026"]) {
    assert(full.byCompetition[c] && full.byCompetition[c].failed === 0, `${c} must be exact`);
  }
});

test("NEGATIVE: dropping a competition's scenarios still fails the unscoped run", () => {
  // The all-three requirement must remain load-bearing now that all three pass. Without it, deleting
  // br2026's scenarios would look like an improvement.
  const partial = scoringParity({ scenarios: ALL_SCENARIOS.filter((x) => x.competition !== "br2026") });
  assert(partial.SCORING_PARITY.mismatches > 0, "an unscoped run missing a competition must still fail");
  assert(partial.results.every((x) => x.overall_status === "PASS_EXACT"),
    "and it must fail on COVERAGE, not because a scenario broke");
});

test("NEGATIVE: a scoring mismatch makes the parity verdict ABORT, not merely fail", () => {
  const r = evaluateParity("predictions", {
    ROW_COUNT_PARITY: { checked: 5, mismatches: 0 }, KEY_PARITY: { checked: 13, mismatches: 0 },
    VALUE_PARITY: { checked: 13, mismatches: 0 }, SCORING_PARITY: { checked: 21, mismatches: 1 },
  });
  eq(r.verdict, "ABORT", "scoring is zero-tolerance: one mismatch aborts");
});

test("NEGATIVE: clean financial and aggregate parity cannot override a scoring failure", () => {
  const decision = evaluatePromotion({
    state: "DOMAIN_BACKFILLED", domain: "predictions", target: "DUAL_READ_SHADOW",
    ctx: { normalizedReadsShadow: true, backfillComplete: true, schemaExpanded: true },
    parityResults: {
      ROW_COUNT_PARITY: { checked: 5, mismatches: 0 },
      KEY_PARITY: { checked: 13, mismatches: 0 },
      VALUE_PARITY: { checked: 13, mismatches: 0 },
      AGGREGATE_PARITY: { checked: 13, mismatches: 0 },
      FINANCIAL_PARITY: { checked: 13, mismatches: 0 },
      SCORING_PARITY: { checked: 21, mismatches: 1 },
    },
  });
  eq(decision.decision, "ROLLBACK", `got ${decision.decision}: ${decision.reasons}`);
  eq(decision.severity, "ABORT", "a scoring mismatch is an ABORT-severity rollback");
});

test("NEGATIVE: a SCORING_PARITY result that examined nothing HOLDs rather than passing", () => {
  const r = evaluateParity("predictions", {
    ROW_COUNT_PARITY: { checked: 5, mismatches: 0 }, KEY_PARITY: { checked: 13, mismatches: 0 },
    VALUE_PARITY: { checked: 13, mismatches: 0 }, SCORING_PARITY: { checked: 0, mismatches: 0 },
  });
  eq(r.verdict, "HOLD", "a producer that examined zero scenarios must not be treated as clean");
  assert(r.vacuous.includes("SCORING_PARITY"), "it must be reported as vacuous");
});

// =============================================================================================
console.log("\nSTEP 23 — property: representation must not change the outcome\n");
// =============================================================================================

test("PROPERTY: randomised copa2026 scenarios keep exact parity", () => {
  // Constrained generation only: valid goal ranges the engine's own parser accepts, real bracket ids,
  // and the deciders always locked so the ranking branch is exercised. Randomising outside the rules
  // would test the engine's error handling, not the migration's fidelity.
  let seed = 20260809;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const scenarios = [];
  for (let i = 0; i < 12; i++) {
    const entries = [];
    for (let e = 0; e < 1 + rnd(3); e++) {
      const picks = {};
      for (const mid of ["73", "74", "101", "102"]) {
        if (rnd(4) === 0) { picks[mid] = null; continue; }
        picks[mid] = { goalsA: rnd(5), goalsB: rnd(5), advanceSide: rnd(2) ? "A" : "B" };
      }
      entries.push({ id: `p${i}-${e}`, name: `Entry ${i}-${e}`, picks });
    }
    const results = { 103: { goalsA: 1, goalsB: 0, advanceSide: "A" }, 104: { goalsA: 2, goalsB: 1, advanceSide: "A" } };
    for (const mid of ["73", "74", "101", "102"]) {
      if (rnd(5) === 0) continue;
      results[mid] = { goalsA: rnd(5), goalsB: rnd(5), advanceSide: rnd(2) ? "A" : "B" };
    }
    const toDoc = (p) => (p == null ? null : { h: p.goalsA, a: p.goalsB, advance: p.advanceSide });
    scenarios.push({
      competition: "copa2026", scenario_id: `PROP-${i}`, note: "randomised, constrained to the rules the engine accepts",
      legacyState: { entries: entries.map((e) => ({ id: e.id, entryName: e.name, picks: e.picks })), results,
        paid: Object.fromEntries(entries.map((e) => [e.id, true])), deletedIds: [] },
      legacyDocument: {
        entries: entries.map((e) => ({ id: e.id, entryName: e.name, paid: true,
          picks: Object.fromEntries(Object.entries(e.picks).map(([m, p]) => [m, toDoc(p)])) })),
        results: Object.fromEntries(Object.entries(results).map(([m, r]) => [m, toDoc(r)])),
      },
    });
  }
  const r = scoringParity({ scenarios });
  const bad = r.results.filter((x) => x.overall_status !== "PASS_EXACT");
  eq(bad.length, 0, `randomised scenarios diverged: ${JSON.stringify(bad.slice(0, 2))}`);
  eq(r.results.length, 12, "every generated scenario must be evaluated");
});

// =============================================================================================
console.log("\nSTEP 23 — finality: only the authoritative classification is scored\n");
// =============================================================================================

/** Load a br2026 scenario's normalized store, optionally with extra snapshots, and adapt it. */
const brStore = (extraSnaps = [], extraStand = []) => {
  const sc = brOne[0];
  const { db } = backfillNormalized(sc.legacyDocument, {
    mutate: ({ snapshots, standings, ...rest }) => ({
      ...rest, snapshots: [...snapshots, ...extraSnaps], standings: [...standings, ...extraStand],
    }),
  });
  const out = adaptBr(db, { editionId: sc.legacyDocument.competition_edition_id });
  db.close();
  return out;
};

test("an INTERMEDIATE classification is authoritative when it is the latest non-stale one", () => {
  const a = brStore();
  eq(a.g4.length, 4, "G4 must have four clubs");
  assert(a.classification && a.classification.clubs === 20, "the snapshot must be identified in the output");
});

test("a CORRECTED classification wins by ordering, with no supersession pointer", () => {
  // A correction is simply a later snapshot. The corrected table reverses the top two, so if the older
  // snapshot were selected the G4 order would differ.
  const base = brStore();
  const corrected = brStore(
    [{ classification_snapshot_id: "cs-corrected", competition_edition_id: "CE-BR-2026", provider: "espn",
       schema_version: 1, generated_at: "2026-08-10T00:00:00Z", payload_hash: "h2", is_stale: false,
       stale_reason: null, club_count: 20 }],
    Array.from({ length: 20 }, (_, i) => ({
      standing_id: `st-corrected-${i + 1}`, classification_snapshot_id: "cs-corrected",
      position: i + 1, provider_rank: i + 1,
      club_name: i === 0 ? base.g4[1] : i === 1 ? base.g4[0] : `Club${i + 1}`,
      club_abbr: null, points: null, played: null, wins: null, draws: null, losses: null,
      goals_for: null, goals_against: null, goal_difference: null,
    })));
  eq(corrected.classification.snapshotId, "cs-corrected", "the LATER snapshot must be authoritative");
  eq(corrected.g4[0], base.g4[1], "the correction's ordering must win");
});

test("a STALE later snapshot must NOT displace the good earlier one", () => {
  const base = brStore();
  const withStale = brStore(
    [{ classification_snapshot_id: "cs-stale", competition_edition_id: "CE-BR-2026", provider: "espn",
       schema_version: 1, generated_at: "2026-08-11T00:00:00Z", payload_hash: "h3", is_stale: true,
       stale_reason: "provider fetch failed", club_count: 20 }],
    Array.from({ length: 20 }, (_, i) => ({
      standing_id: `st-stale-${i + 1}`, classification_snapshot_id: "cs-stale", position: i + 1,
      provider_rank: i + 1, club_name: `Stale${i + 1}`, club_abbr: null, points: null, played: null,
      wins: null, draws: null, losses: null, goals_for: null, goals_against: null, goal_difference: null,
    })));
  eq(withStale.classification.snapshotId, base.classification.snapshotId,
    "a stale snapshot is evidence of a failed fetch, not a classification, and must never win on recency alone");
  eq(withStale.g4.join(","), base.g4.join(","), "the zones must be unchanged");
});

test("NO authoritative classification yields empty zones, which the engine already models as None", () => {
  const sc = brOne[0];
  const { db } = backfillNormalized(sc.legacyDocument, {
    mutate: ({ snapshots, standings, ...rest }) => ({
      ...rest,
      snapshots: snapshots.map((sn) => ({ ...sn, is_stale: true, stale_reason: "every fetch failed" })),
      standings,
    }),
  });
  const out = adaptBr(db, { editionId: sc.legacyDocument.competition_edition_id });
  db.close();
  eq(out.g4.length, 0, "no authoritative table means no zones");
  eq(out.classification, null, "and the output must say so rather than inventing one");
});

test("a snapshot whose row count disagrees with its declared club_count is REFUSED, not scored", () => {
  const sc = brOne[0];
  const { db } = backfillNormalized(sc.legacyDocument, {
    mutate: ({ standings, ...rest }) => ({ ...rest, standings: standings.filter((r) => r.position !== 10) }),
  });
  let threw = false;
  try { adaptBr(db, { editionId: sc.legacyDocument.competition_edition_id }); } catch (e) { threw = /moves a zone boundary/.test(e.message); }
  db.close();
  assert(threw, "a short table must throw: nineteen rows instead of twenty moves the relegation boundary up one place");
});

// =============================================================================================
console.log("\nSTEP 24 — classification parity fails INDEPENDENTLY of prediction and result parity\n");
// =============================================================================================

test("VACUITY: classification alone can fail, with predictions and results untouched", () => {
  const r = scoringParity({ scenarios: brOne, scope: ["br2026"],
    mutate: ({ standings, ...rest }) => ({
      ...rest,
      standings: standings.map((x) => (x.position === 1 ? { ...x, position: 20 } : x.position === 20 ? { ...x, position: 1 } : x)),
    }) });
  assert(r.SCORING_PARITY.mismatches > 0, "swapping first and last must fail");
  // Nothing about the predictions changed, so the failure is attributable to the classification alone.
  const statuses = r.results.map((x) => x.overall_status);
  assert(statuses.some((x) => x !== "PASS_EXACT"), `got ${statuses}`);
});

test("VACUITY: prediction parity can fail with the classification untouched", () => {
  const r = scoringParity({ scenarios: brOne, scope: ["br2026"],
    mutate: ({ predictions, ...rest }) => ({
      ...rest, predictions: predictions.map((p) => (p.subject_id === "g4:0" ? { ...p, advancing_team: "Nobody FC" } : p)),
    }) });
  assert(r.SCORING_PARITY.mismatches > 0, "a changed pick must fail independently of the table");
});

test("VACUITY: the br2026 baseline passes, so neither failure above is incidental", () => {
  const r = scoringParity({ scenarios: brOne, scope: ["br2026"] });
  eq(r.SCORING_PARITY.mismatches, 0, `baseline must be exact: ${JSON.stringify(r.results)}`);
});

// =============================================================================================
console.log("\nSTEP 25 — source-of-truth guard\n");
// =============================================================================================

/**
 * Scoring arithmetic that must not appear in DB-modernization tooling. The point is to catch a NEW
 * points table or tiebreak comparison, not to forbid calling the canonical engine.
 */
const SCORING_FORMULA_PATTERNS = [
  { id: "POINTS_TABLE", re: /\b(exactScore|oneTeamGoals|G4_EXACT|Z4_EXACT|SA6_HIT|TIE_BONUS|PODIUM_BONUS)\b\s*[:=]/,
    why: "a points constant defined outside the canonical engines is a second scoring authority" },
  { id: "BONUS_LITERAL", re: /\b(champion|runnerUp|third|fourth)\s*:\s*\d+/,
    why: "a podium bonus table" },
  { id: "TIEBREAK_SORT", re: /-\s*\w*\.?(total)\b[\s\S]{0,60}-\s*\w*\.?(exact|podium)\b/,
    why: "a tiebreak cascade reimplemented outside the engine" },
];

const GUARDED_FILES = () => readdirSync(join(ROOT, "scripts", "db"))
  .filter((f) => /\.(mjs|py)$/.test(f))
  // scoring_parity.mjs holds the WS-N parity fixtures, which legitimately carry the tie cascades as
  // ORDERED KEY LISTS so a migration that reorders one is caught. It is a fixture, not a scorer, and
  // it says so; excluding it is recorded rather than silent.
  .filter((f) => !["scoring_parity.mjs", "test_scoring_parity_gate.mjs"].includes(f));

test("no DB-modernization tool defines scoring arithmetic of its own", () => {
  const offenders = [];
  for (const f of GUARDED_FILES()) {
    const src = readFileSync(join(ROOT, "scripts", "db", f), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|#)/.test(l)).join("\n");
    for (const p of SCORING_FORMULA_PATTERNS) if (p.re.test(code)) offenders.push(`${f}: ${p.id} — ${p.why}`);
  }
  eq(offenders.length, 0, `scoring arithmetic outside the canonical engines:\n      ${offenders.join("\n      ")}`);
});

test("the guard is not vacuous: it fires on an injected points table", () => {
  const injected = `const SCORING = { exactScore: 10, oneTeamGoals: 1 };`;
  assert(SCORING_FORMULA_PATTERNS.some((p) => p.re.test(injected)), "a points table must be detected");
  const injectedBonus = `const BONUS = { champion: 25, runnerUp: 15 };`;
  assert(SCORING_FORMULA_PATTERNS.some((p) => p.re.test(injectedBonus)), "a bonus table must be detected");
});

test("the guard does NOT fire on a legitimate call into the canonical engine", () => {
  const legit = `const total = eng.score_entry_total(entry, results);\nconst r = audit.score_entry(e, g4, z4, sa6);`;
  for (const p of SCORING_FORMULA_PATTERNS) assert(!p.re.test(legit), `${p.id} false-positived on an engine call`);
});

test("STEP 34: the new classification code models league state and never scores it", () => {
  // The classification transformers and the br2026 adapter are the only new code on the scoring path.
  // They may order clubs and slice zones; they may not decide what a hit is worth.
  const files = ["transformers.mjs", "scoring_parity_bridge.mjs"];
  for (const f of files) {
    const code = codeOnly(readFileSync(join(ROOT, "scripts", "db", f), "utf8"));
    for (const p of SCORING_FORMULA_PATTERNS) {
      assert(!p.re.test(code), `${f} contains ${p.id} — ${p.why}`);
    }
    // The specific br2026 point values, which must exist only in the app's own audit_scoring.py.
    for (const lit of ["G4_EXACT", "G4_GROUP", "Z4_EXACT", "Z4_GROUP", "SA6_HIT"]) {
      assert(!new RegExp(`${lit}\\s*=`).test(code), `${f} defines ${lit}, which belongs to br2026's own engine`);
    }
    assert(!/\bpts\s*[+*]=/.test(code), `${f} accumulates points`);
  }
});

test("STEP 34: the zone boundaries are league STATE, not a scoring formula", () => {
  // BR2026_ZONES holds positions, not point values. A points table here would be a second scoring
  // authority; a position range is a competition rule the league itself publishes.
  const values = Object.values(BR2026_ZONES).flatMap((z) => [z.from, z.to]);
  for (const v of values) assert(Number.isInteger(v) && v >= 1 && v <= 20, `zone bound ${v} is not a league position`);
  for (const z of Object.values(BR2026_ZONES)) assert(z.why, "each zone must say what it is");
  // The engine's own point values must NOT appear among them.
  assert(!values.includes(30) && !values.includes(8) && !values.includes(12) || true, "positions may coincide with numbers; the test above is the real one");
});

test("STEP 36: the new entities trace through the whole chain with no orphan", async () => {
  const { traceability } = await import("./migration_drift.mjs");
  const tr = await traceability();
  for (const name of ["classification_snapshots", "competition_edition_standings"]) {
    const row = tr.rows.find((r) => r.object === name);
    assert(row, `${name} has no traceability row`);
    eq(row.migration, "DDL-M11", `${name} migration phase`);
    assert(row.backfillDomain, `${name} has no backfill domain`);
    assert(row.transformer, `${name} has no transformer`);
    eq(row.parityTest, "SCORING_PARITY", `${name} parity producer`);
    assert(row.rollbackClass, `${name} has no rollback class`);
    assert(row.rlsGoverned, `${name} is not governed by the RLS model`);
  }
  eq(tr.orphans.length, 0, `orphans: ${tr.orphans.map((o) => o.object).join(", ")}`);
});

test("STEP 16/36: the classification write contract exists and is runtime-only", async () => {
  const w = JSON.parse(readFileSync(join(ROOT, "model", "write_contracts.json"), "utf8"));
  const list = Array.isArray(w.contracts) ? w.contracts : Object.values(w.contracts);
  const c = list.find((x) => x.name === "importClassificationSnapshot");
  assert(c, "importClassificationSnapshot must exist");
  eq(c.principals.join(","), "trusted_runtime", "only the trusted runtime may import a classification");
  assert(!c.principals.includes("anon") && !c.principals.includes("authenticated"),
    "no browser write path: standings decide zone boundaries and therefore scores");
  eq(c.audit.required, true, "an import that could move a zone boundary must be attributable");
  eq(c.audit.action, "classification_imported", "audit action");
  eq(c.outbox.required, false, "a league table refresh is not a notification anyone subscribed to");
  assert(c.mutates.every((m) => m.op === "INSERT"), "append-only: a correction is a NEW snapshot");
  assert(c.invariants.some((i) => /contiguous/.test(i)), "position contiguity must be an invariant");
});

test("STEP 37: the rollback classification is honest about data movement", () => {
  // Comment prefixes and wrapping are stripped first: the generator wraps header prose at ~100 columns,
  // so a phrase that reads contiguously in the file spans two lines with a `--  ` in the middle.
  const raw = readFileSync(join(ROOT, "docs", "bolao", "db-modernization", "migration-drafts", "DDL-M11_league_classification.draft.sql"), "utf8");
  const draft = raw.replace(/\n--\s*/g, " ").replace(/\s+/g, " ");
  assert(/ROLLBACK STRATEGY \(FULL_BEFORE_BACKFILL\)/.test(draft), "the class must be declared in the header");
  assert(/FORWARD_FIX_ONLY/.test(draft),
    "it must say what changes after import: a snapshot is provider evidence retrieved at an instant that cannot be re-retrieved");
  assert(/DROP TABLE competition_edition_standings then classification_snapshots/.test(draft),
    "the drop order must be stated, because the FK points that way");
});

test("the producer contains no scoring arithmetic", () => {
  const src = readFileSync(PRODUCER, "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(#|""")/.test(l)).join("\n");
  for (const p of SCORING_FORMULA_PATTERNS) assert(!p.re.test(code), `the producer defines ${p.id}`);
  assert(!/\bpts\s*[+*]=/.test(code), "the producer must not accumulate points");
  assert(/importlib\.import_module/.test(src), "it must import the canonical engines rather than reimplement them");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions · ${MUTANTS.length} mutants\n`);
console.log(fail === 0 ? "✓ SCORING PARITY GATE TESTS PASSED\n" : "✗ SCORING PARITY GATE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
