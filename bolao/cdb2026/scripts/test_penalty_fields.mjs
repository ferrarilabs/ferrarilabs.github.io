#!/usr/bin/env node
/**
 * test_penalty_fields.mjs — CDB2026 penalty-fields regression suite (football-hardening
 * checkpoint B [written RED] -> checkpoint E [implemented, now GREEN, permanent guard]).
 *
 * Run:  node bolao/cdb2026/scripts/test_penalty_fields.mjs
 *
 * HISTORY: originally written RED against the pre-checkpoint-E bolao/cdb2026/js/app.js (see git
 * history / checkpoint B commit 51dd9a7) to prove CDB2026 could not yet represent Eduardo's
 * mandatory scenario:
 *
 *   Ida:     Time Alfa 1 x 0 Time Beta
 *   Volta:   Time Beta 1 x 0 Time Alfa
 *   Agregado final: Time Alfa 1 x 1 Time Beta
 *   Pênaltis: Time Alfa 5 x 4 Time Beta
 *   Classificado: Time Alfa
 *
 * as four DISTINCT pieces of information (match score, aggregate, penalties, advancing team) —
 * see docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md section 2.
 *
 * Checkpoint E implemented the additive fields (penaltiesHome, penaltiesAway,
 * penaltiesWinnerTeamId) in tieProgressDisplay() — additive/backward-compatible only, regulation
 * score/aggregate/scoring/ranking/historical persistence untouched, penalties team-keyed (never
 * leg-orientation-keyed) so a reversed home/away between legs can't flip them. This file is now
 * the PERMANENT regression guard for that behavior, per its own original instruction to flip to
 * asserting the new passing behaviour once the fix landed.
 *
 * Extraction technique matches test_aggregate_hero.mjs / audit_golden_master.mjs: the real
 * function source is pulled out of js/app.js and evaluated in an isolated Function scope, never
 * re-implemented, so this test tracks the real production code, not a copy that could drift.
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

// 3. Penalties must be surfaced as their own distinct field, 5x4 for Time Alfa/Time Beta
// respectively — read from the new additive penaltiesHome/penaltiesAway fields.
check(
  "3. penalties surfaced as a distinct 5x4 value, separate from aggregate",
  progress.penalties,
  { teamA: 5, teamB: 4 }
);

// 4. Advancing team must be Time Alfa (penaltiesWinnerTeamId = "A"), decided by penalties even
// though the aggregate itself is tied 1-1.
check(
  "4. advancingTeamId is 'A' (Time Alfa) when aggregate is tied and penalties decide it",
  progress.advancingTeamId,
  "A"
);

// 5. Structural guarantee: penalties are NEVER summed into aggregate. teamA aggregate + teamA
// penalties would be 1+5=6; this must not appear anywhere as "aggregate".
check(
  "5. aggregate.teamA is never inflated by penalties (1, not 6)",
  progress.aggregate?.teamA,
  1
);
check(
  "5b. aggregate.teamB is never inflated by penalties (1, not 5)",
  progress.aggregate?.teamB,
  1
);

// 5c. Reversed home/away between legs must preserve canonical team order in BOTH the aggregate
// AND the penalty display — penalties are team-keyed (penaltiesHome/penaltiesAway map to
// teamA/teamB directly, never to "whichever team happened to be home in leg 2"), so swapping
// which team is home in leg 2 must not change which team's penalty count is which.
const reversedHomeAwayTie = tie({
  matches: {
    first:  { goalsHome: 0, goalsAway: 2 }, // Ida: Beta(home) 0 x 2 Alfa -- Alfa is AWAY in leg 1
    second: { goalsHome: 2, goalsAway: 0 }, // Volta: Alfa(home) 2 x 0 Beta -- Alfa is HOME in leg 2
  },
  // aggregateFromMatches() convention: totalA = first.goalsHome + second.goalsAway = 0+0 = 0;
  // totalB = first.goalsAway + second.goalsHome = 2+2 = 4. Beta wins the aggregate outright, but
  // penalties are still recorded (a hypothetical extra-time-decided-by-penalties edge case) to
  // prove they stay correctly attributed regardless of the leg-2 home/away swap.
  penaltiesHome: 3, penaltiesAway: 6, // arbitrary — proves team-keying, not leg-keying
  penaltiesWinnerTeamId: "B",
});
const reversedProgress = tieProgressDisplay(reversedHomeAwayTie, "TWO_LEG");
check(
  "5c. reversed home/away between legs: aggregate follows canonical teamA/teamB order (0x4, not flipped)",
  reversedProgress.aggregate,
  { teamA: 0, teamB: 4 }
);
check(
  "5c. reversed home/away between legs: penalties still correctly team-keyed (3x6 = teamA x teamB), not flipped by leg-2 home/away",
  reversedProgress.penalties,
  { teamA: 3, teamB: 6 }
);
check(
  "5c. reversed home/away between legs: advancingTeamId reflects penaltiesWinnerTeamId untouched by orientation ('B')",
  reversedProgress.advancingTeamId,
  "B"
);

// 6. Backward compatibility: an OLD fixture with no penalty fields at all must still resolve
// exactly as before (penalties: null, stage/aggregate/advancingTeamId unchanged) - proves this
// is additive, not a breaking schema change. Tested, not assumed.
const oldFixtureTie = {
  teamA: "Time Alfa", teamB: "Time Beta", qualifiedTeamId: "A",
  matches: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 1 } },
  // no penaltiesHome/penaltiesAway/penaltiesWinnerTeamId keys at all
};
check(
  "6. old fixture without penalty fields still resolves unchanged (backward compatible)",
  tieProgressDisplay(oldFixtureTie, "TWO_LEG"),
  { stage: "final", aggregate: { teamA: 3, teamB: 2 }, penalties: null, advancingTeamId: "A" }
);

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL PENALTY-FIELD CHECKS PASSED");
process.exit(0);
