#!/usr/bin/env node
/**
 * test_aggregate_hero.mjs — CDB2026 aggregate-in-hero feature test suite (phase 7-FIX).
 *
 * Run:  node bolao/cdb2026/scripts/test_aggregate_hero.mjs
 *
 * Extracts and re-executes tieProgressDisplay()/aggregateFromMatches() from the real
 * bolao/cdb2026/js/app.js source (regex-extracted function bodies, evaluated in an isolated
 * Function scope — same technique this repo's other pure-function test scripts use when a
 * function lives inside a non-module IIFE with no browser DOM available) — not a reimplementation
 * copy that could drift from the real logic. Every case below maps to one of the scenarios
 * Eduardo asked to be covered.
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
  return { teamA: "Time Alfa", teamB: "Time Beta", matches: {}, qualifiedTeamId: null, ...overrides };
}

// 1. First leg still in progress — no aggregate shown (would just duplicate the live score).
check(
  "1. first leg not yet finished -> stage=first-leg, aggregate=null",
  tieProgressDisplay(tie({ matches: { first: { goalsHome: null, goalsAway: null } } }), "TWO_LEG"),
  { stage: "first-leg", aggregate: null, penalties: null, advancingTeamId: null }
);

// 2. Second leg scheduled (leg 1 done, leg 2 has no score yet, not live).
check(
  "2. second leg scheduled -> aggregate = leg 1 score only, canonical team order",
  tieProgressDisplay(tie({ matches: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: null, goalsAway: null } } }), "TWO_LEG"),
  { stage: "second-leg-pending", aggregate: { teamA: 2, teamB: 1 }, penalties: null, advancingTeamId: null }
);

// 3. Second leg live — aggregate updates with the live score (leg 2 home=teamB, away=teamA).
check(
  "3. second leg live -> aggregate reflects live score, orientation-safe",
  tieProgressDisplay(
    tie({ matches: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: null, goalsAway: null } } }),
    "TWO_LEG",
    { goalsHome: 0, goalsAway: 1 } // leg2: home=teamB scored 0, away=teamA scored 1
  ),
  { stage: "second-leg-live", aggregate: { teamA: 2 + 1, teamB: 1 + 0 }, penalties: null, advancingTeamId: null }
);

// 4. Goal updates the aggregate (simulate a second live goal by teamA, i.e. leg2 away scorer).
check(
  "4. a live goal changes the aggregate immediately (no stale caching)",
  tieProgressDisplay(
    tie({ matches: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: null, goalsAway: null } } }),
    "TWO_LEG",
    { goalsHome: 0, goalsAway: 2 } // teamA scored again
  ).aggregate,
  { teamA: 4, teamB: 1 }
);

// 5. Final, no penalties.
check(
  "5. final, no penalties -> aggregate final + advancingTeamId",
  tieProgressDisplay(
    tie({ matches: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 1 } }, qualifiedTeamId: "A" }),
    "TWO_LEG"
  ),
  { stage: "final", aggregate: { teamA: 2 + 1, teamB: 1 + 1 }, penalties: null, advancingTeamId: "A" }
);

// 6. Final with penalties (regulation/ET tied 2-2). CDB2026 has no penalty-score data field
// anywhere (verified by reading the whole file — same as Copa, which also never tracks a
// numeric penalty score, bolao/copa2026/js/i18n.js: "Pênaltis não entram no placar") — so
// "penalties" MUST stay null here; qualifiedTeamId (admin-picked, same mechanism as Copa's
// advanceSide) still resolves the winner correctly even when the aggregate itself is tied.
check(
  "6. final with a tied aggregate (would-be-penalties case) -> aggregate stays tied, penalties still null (no data field exists), advancingTeamId from qualifiedTeamId",
  tieProgressDisplay(
    tie({ matches: { first: { goalsHome: 1, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 1 } }, qualifiedTeamId: "B" }),
    "TWO_LEG"
  ),
  { stage: "final", aggregate: { teamA: 2, teamB: 2 }, penalties: null, advancingTeamId: "B" }
);

// 7. Penalties never summed into the aggregate — since penalties is always null (no data field),
// this is true by construction, but assert it explicitly so a future change that DID add a
// penalty field would have to deliberately break this assertion, not silently regress it.
check(
  "7. penalties are never summed into the aggregate field (structural guarantee, not just today's null)",
  (() => {
    const r = tieProgressDisplay(
      tie({ matches: { first: { goalsHome: 1, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 1 } }, qualifiedTeamId: "A" }),
      "TWO_LEG"
    );
    // aggregate must equal the real regulation/ET totals (2-2), never inflated by any
    // hypothetical penalty count (e.g. NOT 7-6 if penalties were 5-4).
    return r.aggregate.teamA === 2 && r.aggregate.teamB === 2 && r.penalties === null;
  })(),
  true
);

// 8. Classificado (advancingTeamId) resolves correctly even when decided beyond regulation (i.e.
// qualifiedTeamId is the sole source of truth for who advances, same as Copa's advanceSide).
check(
  "8. advancingTeamId always comes from qualifiedTeamId, independent of the (possibly tied) aggregate",
  tieProgressDisplay(
    tie({ matches: { first: { goalsHome: 0, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 0 } }, qualifiedTeamId: "B" }),
    "TWO_LEG"
  ).advancingTeamId,
  "B"
);

// 9. Reversed home/away in leg 2 — aggregate must follow canonical teamA/teamB order, not raw
// leg-2 home/away. aggregateFromMatches() already encodes this (leg2 home=teamB, away=teamA);
// this test proves tieProgressDisplay's own live-leg-2 branch uses the SAME orientation.
check(
  "9. reversed home/away in leg 2 does not flip the aggregate's team order",
  tieProgressDisplay(
    tie({ matches: { first: { goalsHome: 3, goalsAway: 0 }, second: { goalsHome: null, goalsAway: null } } }),
    "TWO_LEG",
    { goalsHome: 2, goalsAway: 0 } // leg2 home (teamB) scored 2, leg2 away (teamA) scored 0
  ).aggregate,
  { teamA: 3 + 0, teamB: 0 + 2 } // teamA: leg1 home(3) + leg2 away(0); teamB: leg1 away(0) + leg2 home(2)
);

// 10. Incomplete data produces no NaN/undefined.
check(
  "10a. no matches at all -> stage=first-leg, no NaN/undefined",
  tieProgressDisplay(tie({ matches: {} }), "TWO_LEG"),
  { stage: "first-leg", aggregate: null, penalties: null, advancingTeamId: null }
);
check(
  "10b. leg 1 partially scored (goalsAway missing) -> treated as not-yet-done, no NaN",
  tieProgressDisplay(tie({ matches: { first: { goalsHome: 2, goalsAway: null } } }), "TWO_LEG"),
  { stage: "first-leg", aggregate: null, penalties: null, advancingTeamId: null }
);
check(
  "10c. single-match format (Final) -> no aggregate concept, returns null",
  tieProgressDisplay(tie({ matches: { single: { goalsHome: 1, goalsAway: 0 } } }), "SINGLE_MATCH"),
  null
);

// Regression: aggregateFromMatches() itself (used by both the confronto-card result line and
// tieProgressDisplay's "final" stage) is unchanged — same values as before phase 7-FIX.
check(
  "regression: aggregateFromMatches() unchanged (scoring/ranking/persistence logic untouched)",
  aggregateFromMatches({ first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 3 } }),
  { totalA: 2 + 3, totalB: 1 + 1 }
);
check(
  "regression: aggregateFromMatches() returns null on incomplete data (no crash)",
  aggregateFromMatches({ first: { goalsHome: 2, goalsAway: 1 }, second: null }),
  null
);

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL AGGREGATE-HERO CHECKS PASSED");
process.exit(0);
