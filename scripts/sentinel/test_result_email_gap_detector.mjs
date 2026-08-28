#!/usr/bin/env node
/**
 * test_result_email_gap_detector.mjs — Issue #373.
 *
 * Proves the full lifecycle of the CDB2026 result-email watchdog's incident layer:
 *
 *   open  →  unchanged (SILENCE)  →  changed (SURFACE AGAIN)  →  recovery (CLOSE)
 *
 * plus the two properties that make the silence safe rather than convenient:
 *   - UNKNOWN is never deduplicated and never green;
 *   - a MUTATION control proves the dedupe cannot silently stop detecting a NEW gap.
 *
 * The fixture report uses the SHAPE of the real run 33207263422 (overall=GAP, HEALTHY=3, GAP=1,
 * UNKNOWN=0, PRE_LEDGER=16) with its real finding id — a phase/tie/leg identifier. No participant
 * data of any kind appears in this file (finding_schema.mjs enforces that independently).
 */
import assert from "node:assert/strict";
import {
  detectResultEmailGap, classifyGapTransition, gapEvidenceHash,
  DETECTOR_ID, GAP_DETECTED, GAP_STILL_OPEN, RECOVERED, HEALTHY, UNKNOWN,
} from "./detectors/cdb2026_result_email_gap.mjs";
import { resultEmailGapFingerprint } from "./fingerprint.mjs";
import { createFakeGithubClient } from "./github_client.mjs";
import { runWatch, readOpenIncidents } from "./result_email_gap_watch.mjs";
import { parseStateBlock } from "./github_state.mjs";
import { cleanCyclesToResolve } from "./policy.mjs";

let passed = 0, failed = 0;
function check(name, cond, ctx) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${ctx ? ` — ${JSON.stringify(ctx)}` : ""}`); }
}

const FINDING_ID = "cdb2026:result-email-gap:quartas:espn-atletico-mg_cruzeiro:first";
const FP = resultEmailGapFingerprint(FINDING_ID);

const gap = (over = {}) => ({
  state: "GAP", findingId: FINDING_ID, entityId: "quartas:espn-atletico-mg_cruzeiro:first",
  kickoff: "2026-08-20T23:30:00+00:00",
  reason: "resultado salvo e folga vencida, sem nenhuma entrega registrada", ...over,
});
const gapReport = (over = {}) => ({ overall: "GAP", counts: { HEALTHY: 3, GAP: 1, UNKNOWN: 0, PRE_LEDGER: 16 }, findings: [gap(over)] });
const healthyReport = () => ({ overall: "HEALTHY", counts: { HEALTHY: 4, GAP: 0, UNKNOWN: 0, PRE_LEDGER: 16 }, findings: [] });
const unknownReport = () => ({ overall: "UNKNOWN", counts: { UNKNOWN: 1 }, findings: [{ state: "UNKNOWN", findingId: null, reason: "o ledger nao pode ser lido" }] });

const logger = { log() {} };
const seed = () => createFakeGithubClient();

console.log("\n── 1. Pure transition classification ─────────────────────────────────────");
{
  const h = gapEvidenceHash(gap());
  check("no prior incident → GAP_DETECTED", classifyGapTransition(null, h).transition === GAP_DETECTED);
  check("prior with identical evidence → GAP_STILL_OPEN", classifyGapTransition({ evidence_hash: h }, h).transition === GAP_STILL_OPEN);
  const changed = classifyGapTransition({ evidence_hash: "sha256:something-else" }, h);
  check("prior with different evidence → GAP_DETECTED, changed", changed.transition === GAP_DETECTED && changed.changed === true);
  check("evidence hash is stable across observations of the same gap", gapEvidenceHash(gap()) === gapEvidenceHash(gap()));
  check("evidence hash ignores fields outside the allowlist (run id, counts, timestamps)",
    gapEvidenceHash({ ...gap(), runId: 33207263422, observedAt: "2026-08-28T00:00:00Z" }) === h);
  check("fingerprint carries no observation entropy", resultEmailGapFingerprint(FINDING_ID) === FP);
}

console.log("\n── 2. Lifecycle: open → unchanged silence → changed → recovery ────────────");
{
  const client = seed();

  // (a) FIRST observation of the gap: incident opens, run surfaces as a failure.
  const r1 = runWatch({ report: gapReport(), client, logger });
  const issueNumber = [...client._issues.keys()][0];
  check("open: exactly one Sentinel Issue created", client._issues.size === 1, { size: client._issues.size });
  check("open: transition is GAP_DETECTED", r1.transitions[0].transition === GAP_DETECTED);
  check("open: run surfaces as failure (exit 1)", r1.exitCode === 1);
  check("open: incident belongs to this detector", parseStateBlock(client._issues.get(issueNumber).body).detector_id === DETECTOR_ID);

  // (b) SECOND and THIRD observations, unchanged: NO new Issue, NO failure — but the incident
  //     keeps accruing occurrences. Detection is never deduplicated; only notification is.
  const r2 = runWatch({ report: gapReport(), client, logger });
  const r3 = runWatch({ report: gapReport(), client, logger });
  check("unchanged: still exactly one Issue (no duplicate)", client._issues.size === 1, { size: client._issues.size });
  check("unchanged: transition is GAP_STILL_OPEN", r2.transitions[0].transition === GAP_STILL_OPEN && r3.transitions[0].transition === GAP_STILL_OPEN);
  check("unchanged: run is GREEN — no repeated failure notification", r2.exitCode === 0 && r3.exitCode === 0);
  const st = parseStateBlock(client._issues.get(issueNumber).body);
  check("unchanged: occurrence_count still advanced (detection not silenced)", st.occurrence_count === 3, { occurrence_count: st.occurrence_count });
  check("unchanged: incident stayed open", client._issues.get(issueNumber).state === "OPEN");

  // (c) The SAME leg, but the gap's evidence changed → surface again, same incident.
  const r4 = runWatch({ report: gapReport({ reason: "resultado salvo e folga vencida; tentativa de entrega registrada como failed" }), client, logger });
  check("changed: still one Issue — the incident is updated, not duplicated", client._issues.size === 1, { size: client._issues.size });
  check("changed: transition is GAP_DETECTED with changed=true", r4.transitions[0].transition === GAP_DETECTED && r4.transitions[0].changed === true);
  check("changed: run surfaces again (exit 1)", r4.exitCode === 1);

  // (d) The changed gap, now unchanged again, must converge back to silence.
  const r5 = runWatch({ report: gapReport({ reason: "resultado salvo e folga vencida; tentativa de entrega registrada como failed" }), client, logger });
  check("changed then stable: converges back to GAP_STILL_OPEN and green", r5.transitions[0].transition === GAP_STILL_OPEN && r5.exitCode === 0);

  // (e) RECOVERY: the detector read the ledger and asserted the pool clean.
  const r6 = runWatch({ report: healthyReport(), client, logger });
  check("recovery: transition is RECOVERED", r6.transitions.some((t) => t.transition === RECOVERED));
  check("recovery: incident closed automatically", client._issues.get(issueNumber).state === "CLOSED");
  check("recovery: run is green", r6.exitCode === 0);
  check("recovery: policy resolves this detector on one confirmation", cleanCyclesToResolve(DETECTOR_ID) === 1);

  // (f) A run after recovery, still clean, is HEALTHY and opens nothing.
  const r7 = runWatch({ report: healthyReport(), client, logger });
  check("post-recovery: HEALTHY, no incident, green", r7.transitions[0].transition === HEALTHY && r7.exitCode === 0 && client._issues.size === 1);

  // (g) The same gap AFTER recovery is a recurrence: reopened, surfaced again.
  const r8 = runWatch({ report: gapReport(), client, logger });
  check("recurrence: reopened rather than duplicated", client._issues.size === 1 && client._issues.get(issueNumber).state === "OPEN");
  check("recurrence: surfaces as failure", r8.exitCode === 1 && r8.transitions[0].transition === GAP_DETECTED);
}

console.log("\n── 3. UNKNOWN is never healthy and never deduplicated ────────────────────");
{
  const client = seed();
  const a = runWatch({ report: unknownReport(), client, logger });
  const b = runWatch({ report: unknownReport(), client, logger });
  check("UNKNOWN surfaces as failure", a.exitCode === 1 && b.exitCode === 1);
  check("UNKNOWN surfaces EVERY run — repetition never silences it", b.transitions[0].transition === UNKNOWN);
  check("UNKNOWN opens no gap incident (an outage is not a missed email)", client._issues.size === 0, { size: client._issues.size });
  check("UNKNOWN produces no finding", a.findings.length === 0);
  check("UNKNOWN never confirms recovery", a.confirmedRecoveries.size === 0);

  // An UNKNOWN report while an incident is open must NOT close it.
  const c2 = seed();
  runWatch({ report: gapReport(), client: c2, logger });
  const n = [...c2._issues.keys()][0];
  const r = runWatch({ report: unknownReport(), client: c2, logger });
  check("UNKNOWN does not close an open incident", c2._issues.get(n).state === "OPEN" && r.exitCode === 1);
}

console.log("\n── 4. Recovery is positive, never inferred from absence ──────────────────");
{
  // Two gaps open; a report where only one recovered still says overall=GAP — nothing closes.
  const other = { ...gap(), findingId: "cdb2026:result-email-gap:quartas:espn-flamengo_gremio:first", entityId: "quartas:espn-flamengo_gremio:first" };
  const client = seed();
  runWatch({ report: { overall: "GAP", counts: {}, findings: [gap(), other] }, client, logger });
  check("two distinct gaps → two distinct incidents", client._issues.size === 2, { size: client._issues.size });
  const partial = runWatch({ report: { overall: "GAP", counts: {}, findings: [gap()] }, client, logger });
  check("partial clearance closes NOTHING (absence is not evidence of a fix)",
    [...client._issues.values()].every((i) => i.state === "OPEN"), { states: [...client._issues.values()].map((i) => i.state) });
  check("partial clearance is green — the remaining gap is unchanged", partial.exitCode === 0);
  const done = runWatch({ report: healthyReport(), client, logger });
  check("full clearance closes both", [...client._issues.values()].every((i) => i.state === "CLOSED") && done.exitCode === 0);
}

console.log("\n── 5. The detector layer sends nothing and touches no ledger ─────────────");
{
  const src = (await import("node:fs")).readFileSync(new URL("./detectors/cdb2026_result_email_gap.mjs", import.meta.url), "utf8")
    + (await import("node:fs")).readFileSync(new URL("./result_email_gap_watch.mjs", import.meta.url), "utf8");
  const forbidden = [/send_result_email/, /send_round_email/, /emailjs/i, /sendMail/i, /BOLAO_ALLOW_REAL_SEND/, /notification_outbox/, /bolao_notif_jobs.*(insert|update|upsert)/i, /supabase/i];
  for (const re of forbidden) check(`no email/ledger symbol matching ${re}`, !re.test(src), { re: String(re) });
  const client = seed();
  runWatch({ report: gapReport(), client, logger });
  const mutations = client.calls.map((c) => c.name).filter((n) => !["searchSentinelIssues", "listSentinelIssues", "getIssue", "getProjectFields"].includes(n));
  check("only GitHub Issue/Project writes occur — nothing else is mutated",
    mutations.every((m) => ["createIssue", "updateIssueBody", "addComment", "closeIssue", "reopenIssue", "ensureProjectItem", "setProjectFields", "ensureLabel"].includes(m)), { mutations });
}

console.log("\n── 6. MUTATION CONTROL: dedupe cannot silently stop detecting a NEW gap ──");
{
  // The danger this whole change introduces is exactly one: a dedupe that is too eager stops
  // reporting a gap it has never seen. These are the mutants that would express that bug. Each is
  // applied to the pure classifier and MUST be caught by an assertion below — if a mutant survives,
  // the silence is not proven safe and this gate fails.
  const h = gapEvidenceHash(gap());
  const mutants = [
    { name: "M1: always GAP_STILL_OPEN (dedupe everything)", fn: () => ({ transition: GAP_STILL_OPEN, changed: false }) },
    { name: "M2: treat a missing prior as already-seen", fn: (prior, hh) => classifyGapTransition(prior || { evidence_hash: hh }, hh) },
    { name: "M3: ignore evidence change (never re-surface)", fn: (prior) => (prior ? { transition: GAP_STILL_OPEN, changed: false } : { transition: GAP_DETECTED, changed: false }) },
  ];
  for (const m of mutants) {
    const newGapCaught = m.fn(null, h).transition !== GAP_DETECTED;
    const changedGapCaught = m.fn({ evidence_hash: "sha256:different" }, h).transition !== GAP_DETECTED;
    check(`${m.name} is KILLED (a new or changed gap would stop surfacing)`, newGapCaught || changedGapCaught);
  }
  // And the real implementation survives none of those mutations — it is the one that is correct.
  check("real classifier surfaces a never-seen gap", classifyGapTransition(null, h).transition === GAP_DETECTED);
  check("real classifier surfaces a changed gap", classifyGapTransition({ evidence_hash: "sha256:different" }, h).transition === GAP_DETECTED);

  // End-to-end mutation control: with an incident already open for ONE gap, a DIFFERENT gap in the
  // same report must still open its own incident and fail the run. This is the property a naive
  // "we already have an open incident, stay quiet" dedupe would break.
  const client = seed();
  runWatch({ report: gapReport(), client, logger });
  const before = client._issues.size;
  const withNew = runWatch({ report: { overall: "GAP", counts: {}, findings: [gap(), { ...gap(), findingId: "cdb2026:result-email-gap:semis:espn-x_y:first", entityId: "semis:espn-x_y:first" }] }, client, logger });
  check("a NEW gap alongside an open one still opens its own incident", client._issues.size === before + 1, { before, after: client._issues.size });
  check("a NEW gap alongside an open one still fails the run", withNew.exitCode === 1);
  check("...and the OLD unchanged gap is still GAP_STILL_OPEN in the same run",
    withNew.transitions.filter((t) => t.transition === GAP_STILL_OPEN).length === 1 && withNew.transitions.filter((t) => t.transition === GAP_DETECTED).length === 1);
}

console.log("\n── 7. A missing/unreadable report is an operational failure ──────────────");
{
  let threw = false;
  try { detectResultEmailGap({ report: null }); } catch { threw = true; }
  check("no report → throws, never silently HEALTHY", threw);
  const client = seed();
  check("readOpenIncidents on an empty repo is empty, not an error", readOpenIncidents(client).length === 0);
}

console.log(`\nresult-email-gap detector: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
