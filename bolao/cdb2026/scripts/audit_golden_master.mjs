/**
 * audit_golden_master.mjs — CDB2026 characterization ("golden master") suite.
 *
 * Run:  node bolao/cdb2026/scripts/audit_golden_master.mjs
 *       node bolao/cdb2026/scripts/audit_golden_master.mjs --print   (show current values)
 *
 * PURPOSE (auditoria 2026-08, fase 2): freeze the CURRENT observable behaviour of the protected
 * areas — scoring, live scoring, ranking order, tiebreak cascade, podium resolution, two-legged
 * aggregate, leg orientation — so that any later refactor that changes a produced RESULT fails
 * loudly instead of drifting silently. This is a real-money pool: "the code got cleaner" is not
 * an acceptable reason for a participant's total to move.
 *
 * HOW IT WORKS: the functions under test are extracted from the real `js/app.js` source at
 * runtime (same technique as audit_state_merge.mjs) and evaluated against an anonymised fixture
 * (`fixtures/golden_state.json`). Nothing is re-implemented here — a hand-copied transcription
 * would drift, which is the exact failure mode audit_scoring.py's own header warns about.
 *
 * IF A CHECK FAILS: do NOT update the expected value to make it pass. Investigate the diff
 * first. Only update an expectation when the change is intentional, justified by the current
 * rules, documented in the changelog, and approved. Run with --print to see actual values.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "..", "js", "app.js"), "utf8");
const cfgSrc = readFileSync(join(HERE, "..", "js", "config.js"), "utf8");
const state = JSON.parse(readFileSync(join(HERE, "fixtures", "golden_state.json"), "utf8"));
const PRINT = process.argv.includes("--print");

function extractFn(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() not found in app.js`);
  if (src.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  let p = src.indexOf("(", start), parens = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === "(") parens++;
    else if (src[j] === ")") { parens--; if (parens === 0) { bodyStart = src.indexOf("{", j); break; } }
  }
  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}()`);
}

// Real config (scoring values) + the real phase definitions, so the extracted engine scores with
// exactly the constants production uses. If someone edits config.js scoring, these hashes move —
// which is correct and intended: that IS a rule change and must be reviewed.
const C = new Function(`const window = {}; ${cfgSrc}; return window.CDB2026_CONFIG;`)();
const DATA = { phases: [
  { id: "oitavas", format: "TWO_LEG" },
  { id: "final",   format: "SINGLE_MATCH" },
] };

const ENGINE = new Function("C", "DATA", "_liveTies", `
  const SCORING_RULE_VERSION = ${JSON.stringify(
    (src.match(/const SCORING_RULE_VERSION = "([^"]+)"/) || [, "unknown"])[1])};
  ${extractFn("legsForFormat")}
  ${extractFn("aggregateFromMatches")}
  ${extractFn("finalTieEntry")}
  ${extractFn("officialPodium")}
  ${extractFn("predictedPodium")}
  ${extractFn("matchPoints")}
  ${extractFn("scoreEntry")}
  ${extractFn("liveScoreEntry")}
  ${extractFn("hitChampion")}
  ${extractFn("hitRunnerUp")}
  ${extractFn("countExactMatches")}
  ${extractFn("rankEntriesBy")}
  ${extractFn("legTeams")}
  ${extractFn("explainScore")}
  return { matchPoints, scoreEntry, liveScoreEntry, rankEntriesBy, officialPodium,
           predictedPodium, aggregateFromMatches, legTeams, explainScore };
`);

/** Deterministic, key-sorted serialisation — so a hash reflects VALUES, not key insertion order. */
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}
const sha = v => createHash("sha256").update(canonical(v)).digest("hex").slice(0, 16);

let failures = 0;
function expect(name, actual, expected) {
  const ok = canonical(actual) === canonical(expected);
  if (!ok) failures++;
  if (PRINT) { console.log(`  · ${name}\n      actual: ${canonical(actual)}`); return; }
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}`);
  if (!ok) {
    console.log(`      esperado: ${canonical(expected)}`);
    console.log(`      obtido  : ${canonical(actual)}`);
  }
}

console.log("Running CDB2026 golden-master (characterization) suite...\n");
const api = ENGINE(C, DATA, []);

// ── Scoring constants pinned (a rule change must be a deliberate, reviewed act) ──────────────
// 2026-08-01: `result` (5 pts for correct win/draw/loss sign, wrong score) removed — Eduardo,
// on seeing the first real result email (Vasco 0x0 Fluminense) score a 2x2 pick 5 pts: "Isso
// está incorreto!!! ... Verifique contra as regras da copa do mundo" — that tier never existed
// in the Copa's own matchPoints() (bolao/copa2026/js/app.js: only exact + side), and was a real,
// undetected drift from CDB2026_RULES_AND_MODEL.md's own "mesmos valores da Copa do Mundo"
// claim. See CHANGELOG.md for the full incident writeup.
expect("scoring constants (match/tie/podium)",
  { m: C.scoring.match, tie: C.scoring.tieBonus, bonus: C.scoring.bonus },
  { m: { exact: 10, side: 1 }, tie: 5, bonus: { champion: 30, runnerUp: 20 } });

// ── matchPoints: every branch, mutually exclusive ────────────────────────────────────────────
const mp = (ph, pa, rh, ra) => api.matchPoints({ goalsHome: ph, goalsAway: pa }, { goalsHome: rh, goalsAway: ra });
expect("matchPoints exact",              mp(2, 1, 2, 1), { pts: 10, type: "exact" });
expect("matchPoints exact 0-0",          mp(0, 0, 0, 0), { pts: 10, type: "exact" });
// Correct win/draw/loss sign but wrong score, no side goals matching either — must score 0
// ("miss"), not the old, now-removed 5pt "result" tier. This is the exact bug Eduardo caught.
expect("matchPoints correct sign, no side goals match", mp(3, 1, 2, 0), { pts: 0,  type: "miss" });
expect("matchPoints correct draw sign, no side goals match", mp(1, 1, 2, 2), { pts: 0,  type: "miss" });
expect("matchPoints one side (home)",    mp(2, 3, 2, 0), { pts: 1,  type: "side" });
expect("matchPoints one side (away)",    mp(3, 1, 0, 1), { pts: 1,  type: "side" });
expect("matchPoints complete miss",      mp(3, 0, 0, 2), { pts: 0,  type: "miss" });
expect("matchPoints no result yet",      api.matchPoints({ goalsHome: 1, goalsAway: 0 }, { goalsHome: null, goalsAway: null }), null);
expect("matchPoints no pick",            api.matchPoints(undefined, { goalsHome: 1, goalsAway: 0 }), null);

// ── Two-legged aggregate (home/away inverts on leg 2) ────────────────────────────────────────
expect("aggregate two-leg (A home 2-1, B home 0-0)",
  api.aggregateFromMatches(state.phases.oitavas.ties["t-oit-1"].matches), { totalA: 2, totalB: 1 });
expect("aggregate incomplete = null",
  api.aggregateFromMatches(state.phases.oitavas.ties["t-oit-3"].matches), null);

// ── Podium resolution ────────────────────────────────────────────────────────────────────────
expect("officialPodium from final tie", api.officialPodium(state), { champion: "Vasco", runnerUp: "Grêmio" });
expect("predictedPodium (A picked)",    api.predictedPodium(state.entries[0], state), { champion: "Vasco", runnerUp: "Grêmio" });
expect("predictedPodium (B picked)",    api.predictedPodium(state.entries[1], state), { champion: "Grêmio", runnerUp: "Vasco" });
expect("predictedPodium no pick",       api.predictedPodium(state.entries[2], state), { champion: null, runnerUp: null });

// ── scoreEntry totals (the numbers that pay real money) ──────────────────────────────────────
// e-bravo: 15 -> 0 after the "result" tier removal (2026-08-01) — its picks in the fixture only
// ever had the correct W/D/L sign, never an exact score or a matching side goal count, so it
// legitimately drops to 0. Confirmed via --print before updating this expectation.
const totals = Object.fromEntries(state.entries.map(e => [e.id, api.scoreEntry(e, state).total]));
expect("scoreEntry totals", totals, { "e-alpha": 105, "e-bravo": 0, "e-charlie": 0, "e-delta": 105 });

// Per-entry detail hash — catches a changed breakdown even when the total happens to match.
expect("scoreEntry detail hash (e-alpha)", sha(api.scoreEntry(state.entries[0], state).detail), "dadc32e2f50ddc80");
expect("scoreEntry detail hash (e-bravo)", sha(api.scoreEntry(state.entries[1], state).detail), "d27b2f346414828c");

// ── Determinism: same input, repeated, must give the identical result ────────────────────────
{
  const runs = new Set();
  for (let i = 0; i < 25; i++) runs.add(canonical(api.scoreEntry(state.entries[0], state)));
  expect("scoreEntry is deterministic over 25 runs", runs.size, 1);
}
// Key order of `entries`/`ties` must not change any total.
{
  const shuffled = JSON.parse(JSON.stringify(state));
  shuffled.phases.oitavas.ties = Object.fromEntries(Object.entries(shuffled.phases.oitavas.ties).reverse());
  expect("tie key order does not change the total",
    api.scoreEntry(shuffled.entries[0], shuffled).total, totals["e-alpha"]);
}

// ── Ranking order + full tiebreak cascade ────────────────────────────────────────────────────
// e-alpha and e-delta are byte-identical picks (same total, champion, runner-up, exact count) —
// they must tie on rank and be ordered by the documented reverse-alpha entryName tiebreak.
{
  // e-bravo and e-charlie now tie at 0 (post 2026-08-01 "result" tier removal) and share rank 3
  // — e-charlie sorts first between them under the documented reverse-alpha display tiebreak.
  const ranked = api.rankEntriesBy(state.entries, e => api.scoreEntry(e, state));
  expect("ranking order (ids)", ranked.map(r => r.e.id), ["e-delta", "e-alpha", "e-charlie", "e-bravo"]);
  expect("ranking ranks",       ranked.map(r => r.rank), [1, 1, 3, 3]);
  expect("ranking totals",      ranked.map(r => r.total), [105, 105, 0, 0]);
  expect("identical entries share rank 1", ranked[0].rank === ranked[1].rank, true);
}

// ── Live scoring: never fabricates a podium bonus while a match is in progress ───────────────
// (documented, deliberate behaviour — see docs/bolao/CDB2026_RULES_AND_MODEL.md §8)
{
  const liveState = JSON.parse(JSON.stringify(state));
  // Unplayed tie t-oit-3 goes live 1-0; e-alpha has NO pick there, e-bravo neither.
  const liveTies = [{ tieId: "t-oit-3", leg: "first", goalsHome: 1, goalsAway: 0 }];
  const liveApi = ENGINE(C, DATA, liveTies);
  expect("live score with no pick on the live tie = official",
    liveApi.liveScoreEntry(liveState.entries[0], liveState).total,
    liveApi.scoreEntry(liveState.entries[0], liveState).total);

  // Now give e-charlie (0 points, no picks) a pick on the live tie and confirm it adds ONLY
  // match points — no champion/runner-up projection.
  const s2 = JSON.parse(JSON.stringify(state));
  s2.entries[2].picks.matches["t-oit-3"] = { first: { goalsHome: 1, goalsAway: 0 } };
  const live2 = ENGINE(C, DATA, liveTies);
  expect("live score adds exact-match points only", live2.liveScoreEntry(s2.entries[2], s2).total, 10);
  expect("live scoring never adds a podium bonus",
    live2.liveScoreEntry(s2.entries[2], s2).detail.champion, undefined);
}

// ── Leg orientation (AUDIT-05 regression, pinned here too) ───────────────────────────────────
{
  const tie = state.phases.oitavas.ties["t-oit-1"];
  expect("leg1 orientation", api.legTeams(tie, "first",  tie.matches.first),  { home: "Vasco", away: "Fluminense" });
  expect("leg2 orientation", api.legTeams(tie, "second", tie.matches.second), { home: "Fluminense", away: "Vasco" });
}

// ── Explainability must ALWAYS reconcile with the official total (§19) ───────────────────────
// This is the invariant that makes a score auditable: the itemised breakdown a reviewer reads
// must sum to the number that actually pays out. If these ever diverge it is a bug, never a
// rounding artefact.
{
  for (const e of state.entries) {
    const x = api.explainScore(e, state);
    const official = api.scoreEntry(e, state).total;
    const sum = x.breakdown.reduce((a, b) => a + b.points, 0);
    expect(`explainScore reconciles for ${e.id}`, { total: x.total, sum, reconciles: x.reconciles },
      { total: official, sum: official, reconciles: true });
  }
  expect("explainScore reports the rule version", api.explainScore(state.entries[0], state).ruleVersion, "rules-2026-07-13");
  // A entrada sem palpite nenhum não deve inventar linhas na explicação.
  expect("explainScore of an empty entry has no line items",
    api.explainScore(state.entries[2], state).breakdown.length, 0);
  // Cada linha precisa dizer qual regra aplicou — é o que torna a pontuação explicável.
  expect("every breakdown line carries a ruleId",
    api.explainScore(state.entries[0], state).breakdown.every(b => typeof b.ruleId === "string" && b.ruleId.length > 0), true);
}

// ── Whole-state canonical hash: the single tripwire for "something moved" ────────────────────
{
  const snapshot = {
    totals,
    ranking: api.rankEntriesBy(state.entries, e => api.scoreEntry(e, state)).map(r => [r.e.id, r.rank, r.total]),
    podium: api.officialPodium(state),
  };
  // 2026-08-01: hash moves because e-bravo's total legitimately changed (15 -> 0, "result" tier
  // removal) — see the scoring-constants/totals/ranking expectations above for the full trail.
  expect("full behavioural snapshot hash", sha(snapshot), "d8d1f15f48120deb");
}

console.log("\n" + (failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ GOLDEN MASTER FAILED — ${failures} check(s)`));
console.log(failures === 0 ? "" : "\nNÃO atualize os valores esperados só para passar. Investigue a diferença primeiro.");
process.exit(failures === 0 ? 0 : 1);
