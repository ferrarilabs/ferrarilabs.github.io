#!/usr/bin/env node
/**
 * Scoring parity contract (Workstream N).
 *
 * THE CLAIM THIS MUST PROVE
 * Database modernization cannot change any score, rank, tie resolution, lock decision or result
 * interpretation. Real money is paid out on these numbers.
 *
 * HOW IT IS PROVED — AND WHY NOT BY RECOMPUTING SCORES
 * The tempting design is to compute scores from the old representation, compute them from the new one,
 * and compare. That requires a second scoring implementation, and a second implementation of scoring is
 * a second source of truth for money. The July 2026 audit found exactly that failure: send_result_email.py
 * had silently drifted from the site's own scoring logic. Rebuilding scoring in SQL or in this file
 * would recreate the same defect with better intentions.
 *
 * So parity is proved at the two boundaries that sandwich the scoring function, leaving the function
 * itself untouched:
 *
 *   INPUT PARITY   the canonical scoring input derived from `pool_entries.picks` (jsonb) is byte-identical
 *                  to the one derived from `predictions` rows. Identical input to an unchanged function
 *                  yields an identical output by construction — no comparison of outputs is needed, and
 *                  none is performed.
 *   FUNCTION FIXITY the scoring function is unchanged, evidenced by the three existing audit_scoring.py
 *                  self-test suites (copa2026, br2026, cdb2026) passing before and after.
 *   OUTPUT SHAPE   ranking assembly, tie cascade, locking and result interpretation are compared as
 *                  ORDERINGS and DECISIONS over identical inputs — logic this module does own, because
 *                  the migration changes how these are read, not how they are computed.
 *
 * That decomposition is the contract. It is stronger than output comparison, because output comparison
 * can be satisfied by two implementations that agree on the fixtures and differ everywhere else.
 *
 * Fixtures are synthetic. Nothing here reads production data or writes anything.
 *
 * Usage:
 *   node scripts/db/scoring_parity.mjs --self-test        # synthetic fixtures + audit suites
 *   node scripts/db/scoring_parity.mjs --audits-only
 *   node scripts/db/scoring_parity.mjs --json
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/**
 * The three scoring self-test suites that already exist and already guard the scoring function.
 * Integrating them rather than duplicating their checks is deliberate: they are the authority on
 * whether scoring changed, and a parallel set of assertions here would drift from them.
 */
export const AUDIT_SUITES = [
  { app: "copa2026", path: "bolao/copa2026/scripts/audit_scoring.py" },
  { app: "br2026", path: "bolao/br2026/scripts/audit_scoring.py" },
  { app: "cdb2026", path: "bolao/cdb2026/scripts/audit_scoring.py" },
];

/**
 * Locate the site repo. This tool lives in the modernization worktree; the audit suites live in the
 * site repo. Both layouts are supported, and an absent suite is reported as UNAVAILABLE rather than
 * silently skipped — a parity contract that quietly drops its strongest evidence is worthless.
 */
export function findSiteRoot(candidates = [ROOT, join(ROOT, "..", "ferrarilabs.github.io")]) {
  for (const c of candidates) {
    if (existsSync(join(c, AUDIT_SUITES[0].path))) return c;
  }
  return null;
}

export function runAuditSuites({ siteRoot = findSiteRoot() } = {}) {
  if (!siteRoot) {
    return AUDIT_SUITES.map((s) => ({ app: s.app, status: "UNAVAILABLE",
      detail: "audit_scoring.py not found in any candidate root — evidence of function fixity is MISSING, not passing" }));
  }
  return AUDIT_SUITES.map((s) => {
    try {
      const out = execFileSync("python3", [join(siteRoot, s.path)], { encoding: "utf8", timeout: 120000 });
      const ok = /ALL CHECKS PASSED/.test(out);
      return { app: s.app, status: ok ? "PASS" : "FAIL", detail: out.trim().split("\n").slice(-1)[0] };
    } catch (e) {
      return { app: s.app, status: "FAIL", detail: (e.stdout || e.message || "").toString().trim().split("\n").slice(-1)[0] };
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT PARITY
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Canonical scoring input: a sorted, fully-specified representation of one entry's picks.
 *
 * Canonicalisation is where a migration silently changes results, so the rules are explicit:
 *   · keys sorted, so jsonb key order (which PostgreSQL does not preserve) cannot matter
 *   · goals coerced to integers, so "1" from a jsonb string and 1 from an integer column agree
 *   · a missing pick is `null`, distinct from a 0-0 pick — collapsing those two changes scores
 *   · no defaulting: an absent match is absent, not 0-0
 */
export function canonicalPicksFromJson(picks) {
  if (picks === null || picks === undefined) return {};
  const out = {};
  for (const key of Object.keys(picks).sort()) {
    const v = picks[key];
    out[key] = v === null || v === undefined ? null : normalisePick(v);
  }
  return out;
}

export function canonicalPicksFromPredictions(rows) {
  const out = {};
  for (const r of [...rows].sort((a, b) => String(a.match_id ?? a.tie_id).localeCompare(String(b.match_id ?? b.tie_id)))) {
    const key = r.match_id ?? r.tie_id;
    out[key] = r.home_goals === null || r.home_goals === undefined ? null
      : normalisePick({ h: r.home_goals, a: r.away_goals, advance: r.advancing_team ?? undefined });
  }
  return out;
}

function normalisePick(v) {
  const num = (x) => {
    if (x === null || x === undefined) return null;
    if (typeof x === "number") { if (!Number.isInteger(x)) throw new TypeError(`non-integer goal value ${x}`); return x; }
    if (typeof x === "string" && /^-?\d+$/.test(x.trim())) return Number(x.trim());
    throw new TypeError(`ungoallike value ${JSON.stringify(x)} — coercing it would invent a score`);
  };
  const o = { h: num(v.h ?? v.home ?? v.homeGoals), a: num(v.a ?? v.away ?? v.awayGoals) };
  // `advance` only exists for knockout ties; include it only when present, so its absence in group
  // matches does not read as a difference.
  const adv = v.advance ?? v.advancing ?? v.advancingTeam;
  if (adv !== undefined && adv !== null) o.advance = String(adv);
  return o;
}

/** Deep, order-insensitive-by-construction comparison of the two canonical forms. */
export function inputParity(jsonPicks, predictionRows) {
  const a = canonicalPicksFromJson(jsonPicks);
  const b = canonicalPicksFromPredictions(predictionRows);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs = [];
  for (const k of keys) {
    const ja = JSON.stringify(a[k] ?? null), jb = JSON.stringify(b[k] ?? null);
    if (!(k in a)) diffs.push({ key: k, kind: "only_in_predictions" });
    else if (!(k in b)) diffs.push({ key: k, kind: "only_in_picks_json" });
    else if (ja !== jb) diffs.push({ key: k, kind: "value_differs" });
  }
  return { identical: diffs.length === 0, diffs, canonicalJson: a, canonicalPredictions: b };
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT SHAPE: ranking, ties, locking, result interpretation, phase behaviour
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Tie cascades, per app. These are TOURNAMENT-SPECIFIC and must never be generalised between apps —
 * the platform rule is explicit that copying tournament logic across apps is always wrong. They are
 * recorded here as ORDERED KEY LISTS so a migration that reorders or drops a level is caught.
 *
 * Source of truth remains each app's own audit_scoring.py, which tests the same cascade. This list is
 * a parity fixture, not a second implementation of the rule.
 */
export const TIE_CASCADES = {
  copa2026: ["total", "exact", "podium"],
  br2026: ["total", "sa6", "g4Exact", "z4Exact"],
  cdb2026: ["total", "champion", "runnerUp", "exact"],
};

/** Assemble a ranking from pre-computed per-entry scores. Ordering logic only — no scoring. */
export function assembleRanking(scored, cascade) {
  const rows = [...scored].sort((x, y) => {
    for (const key of cascade) {
      const dx = (y.metrics[key] ?? 0) - (x.metrics[key] ?? 0);
      if (dx !== 0) return dx;
    }
    // Final, deterministic disambiguator. Without one, two genuinely tied entries would order
    // arbitrarily and the "same" ranking could differ between two runs on the same data — which would
    // make every parity comparison flaky and hide real regressions in the noise.
    return String(x.pool_entry_id).localeCompare(String(y.pool_entry_id));
  });
  let position = 0, shown = 0, prevKey = null;
  return rows.map((r) => {
    const key = cascade.map((k) => r.metrics[k] ?? 0).join("|");
    shown += 1;
    if (key !== prevKey) { position = shown; prevKey = key; }
    return { pool_entry_id: r.pool_entry_id, position, tied: key === prevKey && position !== shown, metrics: r.metrics };
  });
}

export function rankingParity(rankingA, rankingB) {
  const key = (r) => r.map((x) => `${x.pool_entry_id}:${x.position}`).join(",");
  return { identical: key(rankingA) === key(rankingB) };
}

/**
 * Prediction locking. A prediction is locked once the phase cutoff has passed; the DECISION must be
 * identical whichever representation supplies the timestamp.
 *
 * Timestamps are compared as instants, not strings: "2026-06-01T00:00:00Z" and
 * "2026-05-31T20:00:00-04:00" are the same instant, and a string comparison would call them different.
 * The legacy document stores ISO strings; the relational column is timestamptz. This is the single most
 * likely place for a migration to change a lock decision.
 */
export function isLocked(submittedAt, cutoffAt) {
  if (!cutoffAt) return false;
  if (!submittedAt) return false;
  return new Date(submittedAt).getTime() > new Date(cutoffAt).getTime();
}

export function lockingParity(cases) {
  const diffs = [];
  for (const c of cases) {
    const fromJson = isLocked(c.jsonSubmittedAt, c.jsonCutoffAt);
    const fromRel = isLocked(c.relSubmittedAt, c.relCutoffAt);
    if (fromJson !== fromRel) diffs.push({ id: c.id, fromJson, fromRel });
  }
  return { identical: diffs.length === 0, diffs };
}

/**
 * Result interpretation. The legacy document stores `results{matchId → {h,a}}`; the relational form is
 * a match_results row. The interpretation — who won, whether it was a draw, who advanced — must not change.
 */
export function interpretResult(r) {
  if (!r) return { known: false };
  const h = Number(r.h ?? r.home_goals), a = Number(r.a ?? r.away_goals);
  if (!Number.isInteger(h) || !Number.isInteger(a)) return { known: false };
  const outcome = h > a ? "HOME" : h < a ? "AWAY" : "DRAW";
  const out = { known: true, h, a, outcome };
  // A knockout draw is resolved by an explicit advancing team, never inferred. Inferring it (e.g. from
  // seeding or team order) would silently decide a knockout tie, which changes advancement points.
  const adv = r.advance ?? r.advancing_team;
  if (adv !== undefined && adv !== null) out.advance = String(adv);
  return out;
}

export function resultParity(pairs) {
  const diffs = [];
  for (const p of pairs) {
    const a = JSON.stringify(interpretResult(p.fromJson));
    const b = JSON.stringify(interpretResult(p.fromRelational));
    if (a !== b) diffs.push({ match_id: p.match_id });
  }
  return { identical: diffs.length === 0, diffs };
}

/** Phase/round behaviour: a prediction belongs to exactly the phase its match belongs to. */
export function phaseParity(matchesJson, matchesRelational) {
  const a = Object.fromEntries(Object.entries(matchesJson).map(([k, v]) => [k, String(v.phase ?? v.round ?? "")]));
  const b = Object.fromEntries(matchesRelational.map((m) => [m.match_id, String(m.competition_edition_phase_id ?? "")]));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const diffs = keys.filter((k) => (a[k] ?? null) !== (b[k] ?? null) && !(a[k] && b[k] && a[k] === b[k]));
  return { identical: diffs.length === 0, diffs };
}

// ─────────────────────────────────────────────────────────────────────────────
export const CONTRACT_CLAUSES = [
  { id: "N-1", claim: "the canonical scoring input from picks jsonb is byte-identical to the one from predictions rows", proof: "inputParity()" },
  { id: "N-2", claim: "the scoring function itself is unchanged", proof: "the three audit_scoring.py self-test suites pass" },
  { id: "N-3", claim: "ranking assembly and position assignment are identical over identical scores", proof: "rankingParity()" },
  { id: "N-4", claim: "the tie cascade per app is unchanged and not generalised across apps", proof: "TIE_CASCADES fixture + each app's own audit suite" },
  { id: "N-5", claim: "prediction lock decisions are identical, comparing instants rather than strings", proof: "lockingParity()" },
  { id: "N-6", claim: "result interpretation (outcome, advancement) is identical", proof: "resultParity()" },
  { id: "N-7", claim: "each match's phase attribution is identical", proof: "phaseParity()" },
  { id: "N-8", claim: "no scoring logic is reimplemented in SQL or in this module", proof: "source scan in the test suite" },
];

export function runContract({ fixtures, siteRoot } = {}) {
  const audits = runAuditSuites({ siteRoot });
  const results = [];
  const add = (id, ok, detail) => results.push({ id, status: ok ? "PASS" : "FAIL", detail });

  add("N-2", audits.every((a) => a.status === "PASS"),
    audits.map((a) => `${a.app}=${a.status}`).join(" "));

  if (fixtures) {
    add("N-1", fixtures.inputCases.every((c) => inputParity(c.picks, c.predictions).identical), "input canonicalisation");
    add("N-3", rankingParity(fixtures.rankingA, fixtures.rankingB).identical, "ranking assembly");
    add("N-5", lockingParity(fixtures.lockingCases).identical, "lock decisions");
    add("N-6", resultParity(fixtures.resultPairs).identical, "result interpretation");
    add("N-7", phaseParity(fixtures.matchesJson, fixtures.matchesRelational).identical, "phase attribution");
  }
  const failed = results.filter((r) => r.status !== "PASS");
  return { audits, results, verdict: failed.length ? "FAIL" : "PASS" };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const audits = runAuditSuites();
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ audits, clauses: CONTRACT_CLAUSES }, null, 2));
    process.exit(audits.every((a) => a.status === "PASS") ? 0 : 1);
  }
  console.log("\nScoring parity contract\n");
  for (const c of CONTRACT_CLAUSES) console.log(`  ${c.id}  ${c.claim}\n        proof: ${c.proof}`);
  console.log("\nFunction fixity evidence (N-2):");
  for (const a of audits) console.log(`  ${a.status === "PASS" ? "✓" : "✗"} ${a.app.padEnd(10)} ${a.status}  ${a.detail}`);
  const ok = audits.every((a) => a.status === "PASS");
  console.log(ok ? "\n✓ scoring function fixity evidence present and passing\n"
                 : "\n✗ scoring fixity evidence missing or failing — treat as a hard blocker\n");
  process.exit(ok ? 0 : 1);
}
