#!/usr/bin/env node
/**
 * Tests for the scoring parity contract (Workstream N).
 *
 * Every parity function is tested in BOTH directions: identical inputs must compare equal, and each
 * specific way a migration could silently change a result must be caught. The listed differences are
 * not hypothetical — jsonb key reordering, integer-vs-string goals, a missing pick collapsing to 0-0,
 * and timezone-offset timestamps are the four things that actually happen when JSON becomes columns.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalPicksFromJson, canonicalPicksFromPredictions, inputParity,
  assembleRanking, rankingParity, isLocked, lockingParity,
  interpretResult, resultParity, phaseParity,
  TIE_CASCADES, CONTRACT_CLAUSES, AUDIT_SUITES, runAuditSuites, findSiteRoot, runContract,
} from "./scoring_parity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log("\nN-1 input parity — the boundary where a migration silently changes scores\n");

const PICKS = { "m-2": { h: 1, a: 0 }, "m-1": { h: 2, a: 2 }, "m-3": null };
const ROWS = [
  { match_id: "m-1", home_goals: 2, away_goals: 2 },
  { match_id: "m-2", home_goals: 1, away_goals: 0 },
  { match_id: "m-3", home_goals: null, away_goals: null },
];

test("identical picks and predictions produce identical canonical input", () => {
  const r = inputParity(PICKS, ROWS);
  assert(r.identical, `differences: ${JSON.stringify(r.diffs)}`);
});

test("jsonb key order cannot affect the canonical form", () => {
  const reordered = { "m-3": null, "m-1": { h: 2, a: 2 }, "m-2": { h: 1, a: 0 } };
  eq(JSON.stringify(canonicalPicksFromJson(reordered)), JSON.stringify(canonicalPicksFromJson(PICKS)),
    "PostgreSQL does not preserve jsonb key order, so key order must be irrelevant by construction");
});

test("prediction row order cannot affect the canonical form", () => {
  eq(JSON.stringify(canonicalPicksFromPredictions([...ROWS].reverse())),
     JSON.stringify(canonicalPicksFromPredictions(ROWS)), "row order must not matter");
});

test("integer 1 and string \"1\" are the same pick", () => {
  const r = inputParity({ "m-1": { h: "2", a: "2" } }, [{ match_id: "m-1", home_goals: 2, away_goals: 2 }]);
  assert(r.identical, "a jsonb string goal and an integer column must agree, or every migrated pick differs");
});

test("a non-numeric goal value throws rather than coercing", () => {
  let threw = false;
  try { canonicalPicksFromJson({ "m-1": { h: "two", a: 0 } }); } catch { threw = true; }
  assert(threw, "coercing a non-numeric goal would invent a score");
});

test("a fractional goal value throws", () => {
  let threw = false;
  try { canonicalPicksFromJson({ "m-1": { h: 1.5, a: 0 } }); } catch { threw = true; }
  assert(threw, "a fractional goal is not a real pick and must not be silently floored");
});

test("a MISSING pick is distinct from a 0-0 pick", () => {
  const r = inputParity({ "m-1": null }, [{ match_id: "m-1", home_goals: 0, away_goals: 0 }]);
  assert(!r.identical, "collapsing 'no pick' into 0-0 changes scores — this must be a difference, not a default");
  eq(r.diffs[0].kind, "value_differs", "difference kind");
});

test("an absent match is not defaulted into existence", () => {
  const r = inputParity({ "m-1": { h: 1, a: 0 } }, [
    { match_id: "m-1", home_goals: 1, away_goals: 0 },
    { match_id: "m-2", home_goals: 0, away_goals: 0 },
  ]);
  assert(!r.identical, "an extra prediction row must be reported");
  eq(r.diffs[0].kind, "only_in_predictions", "difference kind");
});

test("a dropped pick is reported", () => {
  const r = inputParity(PICKS, ROWS.slice(1));
  assert(!r.identical, "a lost pick must never pass parity");
  assert(r.diffs.some((d) => d.kind === "only_in_picks_json"), "kind");
});

test("a changed goal value is reported", () => {
  const bad = ROWS.map((r) => r.match_id === "m-2" ? { ...r, away_goals: 1 } : r);
  assert(!inputParity(PICKS, bad).identical, "a changed score must never pass parity");
});

test("knockout advancement is carried and compared", () => {
  const r = inputParity({ "t-1": { h: 1, a: 1, advance: "TEAM_A" } },
    [{ match_id: "t-1", home_goals: 1, away_goals: 1, advancing_team: "TEAM_A" }]);
  assert(r.identical, "advancement must round-trip");
  const bad = inputParity({ "t-1": { h: 1, a: 1, advance: "TEAM_A" } },
    [{ match_id: "t-1", home_goals: 1, away_goals: 1, advancing_team: "TEAM_B" }]);
  assert(!bad.identical, "a flipped advancing team changes advancement points and must be caught");
});

test("absent advancement in group matches is not a difference", () => {
  const r = inputParity({ "m-1": { h: 1, a: 0 } }, [{ match_id: "m-1", home_goals: 1, away_goals: 0, advancing_team: null }]);
  assert(r.identical, "a null advancing_team on a group match must not read as a difference");
});

console.log("\nN-3/N-4 ranking and tie cascade\n");

const scored = [
  { pool_entry_id: "e-1", metrics: { total: 30, exact: 2, podium: 1 } },
  { pool_entry_id: "e-2", metrics: { total: 30, exact: 2, podium: 1 } },
  { pool_entry_id: "e-3", metrics: { total: 30, exact: 1, podium: 0 } },
  { pool_entry_id: "e-4", metrics: { total: 45, exact: 3, podium: 2 } },
];

test("ranking orders by the cascade, highest first", () => {
  const r = assembleRanking(scored, TIE_CASCADES.copa2026);
  eq(r[0].pool_entry_id, "e-4", "top entry");
  eq(r[0].position, 1, "top position");
  eq(r[r.length - 1].pool_entry_id, "e-3", "last entry");
});

test("genuinely tied entries share a position", () => {
  const r = assembleRanking(scored, TIE_CASCADES.copa2026);
  const e1 = r.find((x) => x.pool_entry_id === "e-1"), e2 = r.find((x) => x.pool_entry_id === "e-2");
  eq(e1.position, e2.position, "entries equal on every cascade level must share a position");
});

test("ranking is deterministic — the same input always gives the same order", () => {
  const a = assembleRanking([...scored], TIE_CASCADES.copa2026);
  const b = assembleRanking([...scored].reverse(), TIE_CASCADES.copa2026);
  assert(rankingParity(a, b).identical,
    "without a final deterministic disambiguator, two tied entries would order arbitrarily and every parity run would be flaky");
});

test("rankingParity detects a swapped position", () => {
  const a = assembleRanking(scored, TIE_CASCADES.copa2026);
  const b = a.map((r) => r.pool_entry_id === "e-4" ? { ...r, position: 2 } : r);
  assert(!rankingParity(a, b).identical, "a changed position must never pass parity");
});

test("each app's tie cascade is distinct and none is generalised across apps", () => {
  const keys = Object.keys(TIE_CASCADES);
  eq(keys.length, 3, "three apps");
  const serialised = keys.map((k) => TIE_CASCADES[k].join(","));
  eq(new Set(serialised).size, 3,
    "two apps sharing a cascade would mean tournament logic was generalised between them, which the platform rules forbid");
  eq(TIE_CASCADES.copa2026[0], "total", "every cascade starts on total points");
  eq(TIE_CASCADES.br2026.includes("sa6"), true, "br2026 keeps its own SA6 level");
  eq(TIE_CASCADES.cdb2026.includes("champion"), true, "cdb2026 keeps its own champion level");
});

test("dropping a cascade level changes the ranking, so a reordered cascade is detectable", () => {
  const full = assembleRanking(scored, TIE_CASCADES.copa2026);
  const truncated = assembleRanking(scored, ["total"]);
  const e3full = full.find((x) => x.pool_entry_id === "e-3").position;
  const e3trunc = truncated.find((x) => x.pool_entry_id === "e-3").position;
  assert(e3full !== e3trunc, "losing a tiebreak level must be observable in positions");
});

console.log("\nN-5 prediction locking — instants, not strings\n");

test("a prediction after the cutoff is locked; before is not", () => {
  eq(isLocked("2026-06-02T00:00:00Z", "2026-06-01T00:00:00Z"), true, "after");
  eq(isLocked("2026-05-31T00:00:00Z", "2026-06-01T00:00:00Z"), false, "before");
});

test("exactly at the cutoff is NOT locked", () => {
  eq(isLocked("2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"), false,
    "the boundary must be strictly after; treating equality as locked would reject a submission made exactly on time");
});

test("the same instant expressed in different offsets gives the same decision", () => {
  const utc = { id: "c1", jsonSubmittedAt: "2026-06-01T00:00:01Z", jsonCutoffAt: "2026-06-01T00:00:00Z",
    relSubmittedAt: "2026-05-31T20:00:01-04:00", relCutoffAt: "2026-05-31T20:00:00-04:00" };
  assert(lockingParity([utc]).identical,
    "the document stores ISO strings and the column is timestamptz; a string comparison would call these different");
});

test("lockingParity detects a flipped lock decision", () => {
  const c = { id: "c2", jsonSubmittedAt: "2026-06-02T00:00:00Z", jsonCutoffAt: "2026-06-01T00:00:00Z",
    relSubmittedAt: "2026-05-30T00:00:00Z", relCutoffAt: "2026-06-01T00:00:00Z" };
  assert(!lockingParity([c]).identical, "a changed lock decision is a fairness breach and must be caught");
});

test("no cutoff means never locked", () => {
  eq(isLocked("2026-06-02T00:00:00Z", null), false, "a phase with no cutoff cannot lock");
});

console.log("\nN-6/N-7 result interpretation and phase attribution\n");

test("outcomes are interpreted identically from both shapes", () => {
  assert(resultParity([
    { match_id: "m-1", fromJson: { h: 2, a: 1 }, fromRelational: { home_goals: 2, away_goals: 1 } },
    { match_id: "m-2", fromJson: { h: 1, a: 1 }, fromRelational: { home_goals: 1, away_goals: 1 } },
  ]).identical, "identical results must interpret identically");
});

test("home, away and draw are distinguished", () => {
  eq(interpretResult({ h: 2, a: 1 }).outcome, "HOME", "home win");
  eq(interpretResult({ h: 1, a: 2 }).outcome, "AWAY", "away win");
  eq(interpretResult({ h: 1, a: 1 }).outcome, "DRAW", "draw");
});

test("an unknown result is not interpreted as a draw", () => {
  eq(interpretResult(null).known, false, "null");
  eq(interpretResult({ h: null, a: null }).known, false,
    "treating an unrecorded result as 0-0 would award points for a match that has not been played");
});

test("a knockout draw requires an explicit advancing team, never an inferred one", () => {
  const r = interpretResult({ h: 1, a: 1 });
  eq(r.advance, undefined, "advancement must not be inferred — inferring it silently decides a knockout tie");
  eq(interpretResult({ h: 1, a: 1, advance: "TEAM_A" }).advance, "TEAM_A", "explicit advancement is carried");
});

test("resultParity detects a flipped outcome", () => {
  assert(!resultParity([{ match_id: "m-1", fromJson: { h: 2, a: 1 }, fromRelational: { home_goals: 1, away_goals: 2 } }]).identical,
    "a flipped result changes every score in the pool");
});

test("phase attribution parity holds and detects a moved match", () => {
  assert(phaseParity({ "m-1": { phase: "ph-1" } }, [{ match_id: "m-1", competition_edition_phase_id: "ph-1" }]).identical, "identical");
  assert(!phaseParity({ "m-1": { phase: "ph-1" } }, [{ match_id: "m-1", competition_edition_phase_id: "ph-2" }]).identical,
    "a match moved between phases changes which cutoff applies to it");
});

console.log("\nN-2/N-8 function fixity and no reimplementation\n");

test("the three audit suites are located and pass", () => {
  const root = findSiteRoot();
  assert(root, `audit_scoring.py not found — function fixity evidence is MISSING, not passing. Searched from ${HERE}`);
  const res = runAuditSuites({ siteRoot: root });
  eq(res.length, 3, "three suites");
  for (const r of res) eq(r.status, "PASS", `${r.app}: ${r.detail}`);
});

test("a missing suite is reported as UNAVAILABLE, never silently skipped", () => {
  const res = runAuditSuites({ siteRoot: null });
  for (const r of res) {
    eq(r.status, "UNAVAILABLE", "status");
    assert(/MISSING, not passing/.test(r.detail),
      "a parity contract that quietly drops its strongest evidence is worthless");
  }
});

test("all three apps' suites are named in the contract", () => {
  const apps = AUDIT_SUITES.map((s) => s.app);
  for (const a of ["copa2026", "br2026", "cdb2026"]) assert(apps.includes(a), `missing ${a}`);
});

test("this module reimplements no scoring formula (N-8)", () => {
  const src = readFileSync(join(HERE, "scoring_parity.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  // The scoring constants are 10 / 5 / 1 points and 25 / 15 / 10 / 5 bonuses. None may appear as
  // arithmetic here: if this module ever computes points, it becomes a second source of truth for money.
  for (const re of [/\*\s*10\b/, /\+\s*25\b/, /\+\s*15\b/, /points\s*[+*]/i, /function\s+\w*score\w*\s*\(/i]) {
    assert(!re.test(src), `this module appears to compute points (matched ${re}) — scoring must stay in the app`);
  }
});

test("every contract clause states a claim and a proof", () => {
  eq(CONTRACT_CLAUSES.length, 8, "eight clauses");
  for (const c of CONTRACT_CLAUSES) {
    assert(c.claim && c.proof, `${c.id} incomplete`);
  }
});

test("runContract fails closed when the audit suites are unavailable", () => {
  const r = runContract({ siteRoot: null });
  eq(r.verdict, "FAIL", "missing fixity evidence must FAIL, never pass by omission");
});

test("runContract passes on synthetic fixtures with real audit suites", () => {
  const root = findSiteRoot();
  assert(root, "site root required for this test");
  const rankA = assembleRanking(scored, TIE_CASCADES.copa2026);
  const r = runContract({
    siteRoot: root,
    fixtures: {
      inputCases: [{ picks: PICKS, predictions: ROWS }],
      rankingA: rankA, rankingB: assembleRanking([...scored].reverse(), TIE_CASCADES.copa2026),
      lockingCases: [{ id: "c", jsonSubmittedAt: "2026-06-01T00:00:01Z", jsonCutoffAt: "2026-06-01T00:00:00Z",
        relSubmittedAt: "2026-05-31T20:00:01-04:00", relCutoffAt: "2026-05-31T20:00:00-04:00" }],
      resultPairs: [{ match_id: "m-1", fromJson: { h: 2, a: 1 }, fromRelational: { home_goals: 2, away_goals: 1 } }],
      matchesJson: { "m-1": { phase: "ph-1" } },
      matchesRelational: [{ match_id: "m-1", competition_edition_phase_id: "ph-1" }],
    },
  });
  eq(r.verdict, "PASS", `failing clauses: ${r.results.filter((x) => x.status !== "PASS").map((x) => x.id).join(", ")}`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ SCORING PARITY TESTS PASSED\n" : "✗ SCORING PARITY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
