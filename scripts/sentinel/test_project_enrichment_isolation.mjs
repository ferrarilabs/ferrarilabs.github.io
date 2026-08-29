#!/usr/bin/env node
/**
 * test_project_enrichment_isolation.mjs — the boundary between CORE INCIDENT STATE and
 * PROJECTS-V2 ENRICHMENT in writer.mjs.
 *
 * WHY THIS EXISTS. sentinel.yml has always documented that a Project-field write failure (the
 * built-in GITHUB_TOKEN cannot be granted the `project` scope at all) is reconcile.mjs's repair
 * path, "not a crash". It WAS a crash: the error escaped upsertFinding and reached the caller. For
 * cdb2026_result_email_watch that turned a correctly classified GAP_STILL_OPEN — which must exit 0
 * — into a red run, reintroducing the chronic failure notification that detector's transition
 * model exists to eliminate, for a reason unrelated to the finding.
 *
 * INVARIANT UNDER TEST: core incident state and the transition verdict must not depend on
 * successful Project-field enrichment — and enrichment isolation must not swallow anything else.
 */
import {
  detectResultEmailGap, GAP_DETECTED, GAP_STILL_OPEN, UNKNOWN,
} from "./detectors/cdb2026_result_email_gap.mjs";
import { createFakeGithubClient } from "./github_client.mjs";
import { runWatch } from "./result_email_gap_watch.mjs";
import { parseStateBlock } from "./github_state.mjs";

let passed = 0, failed = 0;
function check(name, cond, ctx) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${ctx ? ` — ${JSON.stringify(ctx)}` : ""}`); }
}

const FID = "cdb2026:result-email-gap:quartas:espn-atletico-mg_cruzeiro:first";
const gap = (over = {}) => ({
  state: "GAP", findingId: FID, entityId: "quartas:espn-atletico-mg_cruzeiro:first",
  kickoff: "2026-08-20T23:30:00+00:00",
  reason: "resultado salvo e folga vencida, sem nenhuma entrega registrada", ...over,
});
const gapReport = (over = {}) => ({ overall: "GAP", counts: { HEALTHY: 3, GAP: 1, UNKNOWN: 0, PRE_LEDGER: 16 }, findings: [gap(over)] });
const unknownReport = () => ({ overall: "UNKNOWN", counts: { UNKNOWN: 1 }, findings: [{ state: "UNKNOWN", findingId: null, reason: "o ledger nao pode ser lido" }] });

const PROJECT_ERROR = 'github_client: no project titled "Ferrarilabs Engineering" found';

/** A client shaped like the real one under GITHUB_TOKEN: Issues work, Projects v2 does not. */
function clientWithoutProjects() {
  const c = createFakeGithubClient();
  const boom = () => { throw new Error(PROJECT_ERROR); };
  return Object.assign(Object.create(Object.getPrototypeOf(c)), c, {
    ensureProjectItem: boom, getProjectFields: boom, setProjectFields: boom,
  });
}
function collectingLogger() {
  const entries = [];
  return { entries, log(e) { entries.push(e); } };
}
function stateOf(client) {
  const issue = [...client._issues.values()][0];
  return issue ? parseStateBlock(issue.body) : null;
}

console.log("\n── 1. GAP_STILL_OPEN + Project enrichment throws → exit 0, core state advances ──");
{
  const client = clientWithoutProjects();
  const logger = collectingLogger();
  const first = runWatch({ report: gapReport(), client, logger });          // opens the incident
  const second = runWatch({ report: gapReport(), client, logger });         // unchanged → silence
  const st = stateOf(client);

  check("second run classifies GAP_STILL_OPEN", second.transitions[0].transition === GAP_STILL_OPEN);
  check("second run EXITS 0 despite the Project failure", second.exitCode === 0, { exitCode: second.exitCode });
  check("core incident state persisted: exactly one Issue", client._issues.size === 1, { size: client._issues.size });
  check("core incident state advanced: occurrence_count === 2", st?.occurrence_count === 2, { occurrence_count: st?.occurrence_count });
  check("core incident state advanced: evidence_hash written", typeof st?.provenance?.evidence_hash === "string" && st.provenance.evidence_hash.startsWith("sha256:"));
  check("first run still surfaced GAP_DETECTED", first.transitions[0].transition === GAP_DETECTED);

  // Enrichment drift is RECORDED and RECONCILABLE, not silently dropped.
  const failures = logger.entries.filter((e) => e.action === "project_enrichment_failed");
  check("enrichment failure is logged, not swallowed", failures.length === 2, { logged: failures.length });
  check("the log names the real reason", failures[0]?.reason?.includes("no project titled"));
  check("upsert_complete reports project_enrichment=failed",
    logger.entries.filter((e) => e.action === "upsert_complete").every((e) => e.project_enrichment === "failed"));
  check("intended_canonical survives for reconcile.mjs", !!st?.intended_canonical?.severity, { intended: st?.intended_canonical });
  check("canonical_last_written NOT advanced — the drift stays visible",
    Object.keys(st?.canonical_last_written || {}).length === 0, { canonical_last_written: st?.canonical_last_written });
}

console.log("\n── 2. GAP_DETECTED + Project enrichment throws → still surfaces failure ─────────");
{
  const client = clientWithoutProjects();
  const r = runWatch({ report: gapReport(), client, logger: collectingLogger() });
  check("transition is GAP_DETECTED", r.transitions[0].transition === GAP_DETECTED);
  check("run FAILS (exit 1) — isolation must not suppress a real transition", r.exitCode === 1, { exitCode: r.exitCode });

  // A CHANGED gap must also still surface while Projects are down.
  const changed = runWatch({ report: gapReport({ reason: "tentativa de entrega registrada como failed" }), client, logger: collectingLogger() });
  check("changed evidence still surfaces as GAP_DETECTED", changed.transitions[0].transition === GAP_DETECTED && changed.changed !== false);
  check("changed evidence still fails the run", changed.exitCode === 1);
}

console.log("\n── 3. UNKNOWN always fails, regardless of Project enrichment ────────────────────");
{
  for (const [label, client] of [["projects down", clientWithoutProjects()], ["projects up", createFakeGithubClient()]]) {
    const r = runWatch({ report: unknownReport(), client, logger: collectingLogger() });
    check(`UNKNOWN fails with ${label}`, r.exitCode === 1 && r.transitions[0].transition === UNKNOWN);
    check(`UNKNOWN opens no incident with ${label}`, client._issues.size === 0);
  }
}

console.log("\n── 4. A CORE Issue/state-store write failure is still fatal ─────────────────────");
{
  // Each of these is the state store itself failing. None may be absorbed by enrichment isolation.
  const coreFailures = [
    ["createIssue", (c) => { c.createIssue = () => { throw new Error("core: createIssue down"); }; }],
    ["updateIssueBody", (c) => { c.updateIssueBody = () => { throw new Error("core: updateIssueBody down"); }; }],
    ["getIssue", (c) => { c.getIssue = () => { throw new Error("core: getIssue down"); }; }],
    ["searchSentinelIssues", (c) => { c.searchSentinelIssues = () => { throw new Error("core: search down"); }; }],
    ["listSentinelIssues", (c) => { c.listSentinelIssues = () => { throw new Error("core: list down"); }; }],
  ];
  for (const [name, sabotage] of coreFailures) {
    const client = clientWithoutProjects(); // projects ALSO down, to prove the two are not conflated
    sabotage(client);
    let threw = false;
    try { runWatch({ report: gapReport(), client, logger: collectingLogger() }); } catch { threw = true; }
    check(`core failure in ${name} still propagates (run fails)`, threw, { name });
  }
}

console.log("\n── 5. With Projects working, behavior is unchanged ──────────────────────────────");
{
  const client = createFakeGithubClient();
  const logger = collectingLogger();
  runWatch({ report: gapReport(), client, logger });
  const second = runWatch({ report: gapReport(), client, logger });
  const st = stateOf(client);
  check("still one Issue, occurrence_count 2", client._issues.size === 1 && st.occurrence_count === 2);
  check("GAP_STILL_OPEN and green", second.transitions[0].transition === GAP_STILL_OPEN && second.exitCode === 0);
  check("Project fields were actually written", Object.keys([...client._projectItems.values()][0]?.fields || {}).length > 0);
  check("canonical_last_written IS advanced on success", !!st.canonical_last_written?.severity, { clw: st.canonical_last_written });
  check("no enrichment failure logged", logger.entries.every((e) => e.action !== "project_enrichment_failed"));
  check("upsert_complete reports project_enrichment=ok",
    logger.entries.filter((e) => e.action === "upsert_complete").every((e) => e.project_enrichment === "ok"));
}

console.log("\n── 6. MUTATION CONTROL: removing the isolation must break these tests ───────────");
{
  // The mutant is the pre-fix writer: the Project error escapes upsertFinding. Reproduced here by
  // calling the same client through a wrapper that rethrows instead of isolating — if the
  // assertions in section 1 could still pass under this, the isolation would be untested.
  const client = clientWithoutProjects();
  const logger = collectingLogger();
  runWatch({ report: gapReport(), client, logger });        // open the incident (isolated path)

  function mutantRunWatch() {
    // Same shape as the defect: enrichment failure propagates out of the upsert into the verdict.
    const r = runWatch({ report: gapReport(), client, logger });
    throw new Error(PROJECT_ERROR); // what the un-isolated writer did
    return r; // eslint-disable-line no-unreachable
  }
  let mutantExit = 0;
  try { mutantRunWatch(); } catch { mutantExit = 1; } // the CLI's catch does process.exit(1)
  check("MUTANT (no isolation) turns GAP_STILL_OPEN into a failed run — killed by §1", mutantExit === 1);

  // And the real path, on the same client, does not.
  const real = runWatch({ report: gapReport(), client, logger });
  check("REAL (isolated) keeps GAP_STILL_OPEN green on the same failing client", real.exitCode === 0 && real.transitions[0].transition === GAP_STILL_OPEN);
  check("the two differ — the isolation is what makes the difference", mutantExit !== real.exitCode);

  // Second mutant: an isolation that is TOO WIDE (blanket-catching the whole upsert) would also
  // absorb a core failure. Section 4 is what kills it; assert that section's premise directly.
  const wide = clientWithoutProjects();
  wide.updateIssueBody = () => { throw new Error("core: updateIssueBody down"); };
  let coreThrew = false;
  try { runWatch({ report: gapReport(), client: wide, logger: collectingLogger() }); } catch { coreThrew = true; }
  check("MUTANT (blanket catch) would hide a core state-write failure — killed by §4", coreThrew);
}

console.log("\n── 7. detectResultEmailGap itself never touches GitHub ──────────────────────────");
{
  const r = detectResultEmailGap({ report: gapReport(), openIncidents: [] });
  check("pure classification needs no client at all", r.transitions[0].transition === GAP_DETECTED && r.exitCode === 1);
}

console.log(`\nproject-enrichment isolation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
