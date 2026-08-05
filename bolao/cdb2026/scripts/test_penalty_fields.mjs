#!/usr/bin/env node
/**
 * test_penalty_fields.mjs — CDB2026 penalty-fields regression suite (football-hardening
 * checkpoint B, then E).
 *
 * Run:  node bolao/cdb2026/scripts/test_penalty_fields.mjs
 *
 * PURPOSE: written RED, against the current (pre-fix) bolao/cdb2026/js/app.js, to prove with a
 * real failing test — not a guess — that CDB2026 cannot yet represent Eduardo's mandatory
 * scenario:
 *
 *   Ida:     Time Alfa 1 x 0 Time Beta
 *   Volta:   Time Beta 1 x 0 Time Alfa
 *   Agregado final: Time Alfa 1 x 1 Time Beta
 *   Pênaltis: Time Alfa 5 x 4 Time Beta
 *   Classificado: Time Alfa
 *
 * as four DISTINCT pieces of information (match score, aggregate, penalties, advancing team) —
 * see docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md section 2. tieProgressDisplay() hard-codes
 * `penalties: null` at every return site today, so any assertion that penalties are populated
 * MUST fail until the additive fields (penaltiesHome, penaltiesAway, penaltiesWinnerTeamId,
 * advancingTeamId) authorized by Eduardo are actually implemented.
 *
 * Extraction technique matches test_aggregate_hero.mjs / audit_golden_master.mjs: the real
 * function source is pulled out of js/app.js and evaluated in an isolated Function scope, never
 * re-implemented, so this test tracks the real production code, not a copy that could drift.
 *
 * Once Section E implements the additive fields, this file's expectations should be updated to
 * assert the NEW passing behaviour (turning it from a red proof into a permanent regression
 * guard) — do not delete it after the fix lands.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "js", "app.js");
const src = readFileSync(APP_JS, "utf8");

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in app.js`);
  let depth = 0, i = src.indexOf("{", start), bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const aggregateFromMatchesSrc = extractFn("aggregateFromMatches");
const tieProgressDisplaySrc = extractFn("tieProgressDisplay");
// eslint-disable-next-line no-new-func
const { aggregateFromMatches, tieProgressDisplay } = new Function(
  `${aggregateFromMatchesSrc}\n${tieProgressDisplaySrc}\nreturn { aggregateFromMatches, tieProgressDisplay };`
)();

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass) {
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function tie(overrides = {}) {
  return {
    teamA: "Time Alfa", teamB: "Time Beta", matches: {}, qualifiedTeamId: null,
    // New additive fields (post-Section-E). Deliberately passed in already so this test isolates
    // "does the resolver READ and SURFACE them" from "does the caller supply them" — a
    // backward-compatible resolver should ignore them harmlessly on old fixtures that omit them,
    // and expose them when present.
    penaltiesHome: null, penaltiesAway: null, penaltiesWinnerTeamId: null,
    ...overrides,
  };
}

// Eduardo's mandatory scenario, exactly:
//   Ida: Time Alfa 1x0 Time Beta          -> matches.first  = { goalsHome: 1, goalsAway: 0 }
//   Volta: Time Beta 1x0 Time Alfa        -> matches.second = { goalsHome: 1, goalsAway: 0 }
//     (leg 2 home=teamB, away=teamA per the established orientation convention)
//   Agregado final: Time Alfa 1x1 Time Beta
//   Pênaltis: Time Alfa 5x4 Time Beta
//   Classificado: Time Alfa
const mandatoryTie = tie({
  matches: {
    first:  { goalsHome: 1, goalsAway: 0 }, // Ida: Alfa(home) 1 x 0 Beta
    second: { goalsHome: 1, goalsAway: 0 }, // Volta: Beta(home) 1 x 0 Alfa
  },
  qualifiedTeamId: "A",
  penaltiesHome: 5,        // Time Alfa's penalty count (leg-2 "home" slot is teamB, so this is
                            // deliberately keyed by TEAM, not by leg-2 home/away, to avoid the
                            // exact orientation-flip bug class covered elsewhere in this suite)
  penaltiesAway: 4,        // Time Beta's penalty count
  penaltiesWinnerTeamId: "A",
});

// 1. Aggregate must be the real regulation aggregate (1-1), independent of penalties.
check(
  "1. mandatory scenario: aggregate is 1x1 (regulation only, penalties not summed in)",
  aggregateFromMatches(mandatoryTie.matches),
  { totalA: 1, totalB: 1 }
);

// 2. tieProgressDisplay's aggregate must match, still 1x1 - NOT 6x5 (the exact combined-score
// bug class this task exists to prevent).
const progress = tieProgressDisplay(mandatoryTie, "TWO_LEG");
check(
  "2. tieProgressDisplay aggregate is 1x1, never 6x5 (aggregate+penalties must never be combined)",
  progress.aggregate,
  { teamA: 1, teamB: 1 }
);

// 3. THE RED ASSERTION: penalties must be surfaced as their own distinct field, 5x4 for Time
// Alfa/Time Beta respectively. This FAILS today because tieProgressDisplay() hard-codes
// `penalties: null` at every return site (see js/app.js ~line 693-740) - there is no code path
// that reads penaltiesHome/penaltiesAway/penaltiesWinnerTeamId at all yet.
check(
  "3. [EXPECTED RED pre-fix] penalties surfaced as a distinct 5x4 value, separate from aggregate",
  progress.penalties,
  { teamA: 5, teamB: 4 }
);

// 4. THE RED ASSERTION: advancing team must be Time Alfa (qualifiedTeamId/penaltiesWinnerTeamId
// = "A"), decided by penalties even though the aggregate itself is tied 1-1.
check(
  "4. [EXPECTED RED pre-fix, may coincidentally pass via qualifiedTeamId] advancingTeamId is 'A' (Time Alfa) when aggregate is tied and penalties decide it",
  progress.advancingTeamId,
  "A"
);

// 5. Structural guarantee: even once penalties exist, they must NEVER be summed into aggregate.
// teamA aggregate + teamA penalties would be 1+5=6; this must not appear anywhere as "aggregate".
check(
  "5. [EXPECTED RED pre-fix] aggregate.teamA is never inflated by penalties (1, not 6)",
  progress.aggregate?.teamA,
  1
);
check(
  "5b. [EXPECTED RED pre-fix] aggregate.teamB is never inflated by penalties (1, not 5)",
  progress.aggregate?.teamB,
  1
);

// 6. Backward compatibility: an OLD fixture with no penalty fields at all must still resolve
// exactly as before (penalties: null, stage/aggregate/advancingTeamId unchanged) - this proves
// the eventual fix is additive, not a breaking schema change. This assertion should PASS both
// before and after the fix (it is the anti-regression half of this suite).
const oldFixtureTie = {
  teamA: "Time Alfa", teamB: "Time Beta", qualifiedTeamId: "A",
  matches: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 1 } },
  // no penaltiesHome/penaltiesAway/penaltiesWinnerTeamId keys at all
};
check(
  "6. [MUST STAY GREEN before AND after fix] old fixture without penalty fields still resolves unchanged",
  tieProgressDisplay(oldFixtureTie, "TWO_LEG"),
  { stage: "final", aggregate: { teamA: 3, teamB: 2 }, penalties: null, advancingTeamId: "A" }
);

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED (checks 3, 4, 5, 5b expected to fail pre-fix — this is the RED baseline for checkpoint B)`);
  process.exit(1);
}
console.log("✓ ALL PENALTY-FIELD CHECKS PASSED (post-fix state)");
process.exit(0);
