#!/usr/bin/env node
/**
 * test_main_ci_red_acceptance.mjs — Main CI Red's own acceptance scenarios, run through the real
 * runOnce() orchestration (not the detector in isolation — test_main_ci_red_detector.mjs already
 * covers that). This is what proves run.mjs's confirmed-recovery gating actually works end to end:
 * a fingerprint's clean-cycle counter must advance ONLY on an explicit SUCCESS, never on mere
 * absence (CANCELLED/IN_PROGRESS/UNKNOWN), and Main CI Red resolves after exactly 1 clean cycle,
 * not CHANGE_INTENT Stale's 3 — see policy.mjs's per-detector `clean_cycles_to_resolve`.
 *
 * All against createFakeGithubClient() — no real GitHub call.
 */
import { createFakeGithubClient } from "./github_client.mjs";
import { runOnce } from "./run.mjs";
import { parseStateBlock } from "./github_state.mjs";
import { MONITORED_WORKFLOW } from "./detectors/main_ci_red.mjs";
import { mainCiRedFingerprint } from "./fingerprint.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.stack || e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

function ciRun(overrides = {}) {
  return { headSha: "aaa", createdAt: new Date().toISOString(), status: "completed", conclusion: "failure", jobs: [{ name: "npm run check" }], ...overrides };
}

function findMainCiRedIssue(client) {
  const fp = mainCiRedFingerprint(MONITORED_WORKFLOW, "npm run check");
  return client.listSentinelIssues({}).find((i) => (i.body || "").includes(fp));
}

console.log("\nMain CI Red — acceptance tests (via runOnce)\n");

test("a FAILURE run produces exactly one Issue via runOnce", () => {
  const client = createFakeGithubClient();
  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  const results = runOnce({ client, logger: { log() {} }, dryRun: false });
  assert(results.upserts.length === 1, `expected 1 upsert, got ${results.upserts.length}`);
  const issue = findMainCiRedIssue(client);
  assert(issue && issue.state === "OPEN");
});

test("the same FAILURE observed again -> same Issue, occurrence_count increments (never a duplicate)", () => {
  const client = createFakeGithubClient();
  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  runOnce({ client, logger: { log() {} }, dryRun: false });
  runOnce({ client, logger: { log() {} }, dryRun: false });
  const matches = client.listSentinelIssues({}).filter((i) => i.body?.includes(mainCiRedFingerprint(MONITORED_WORKFLOW, "npm run check")));
  assert(matches.length === 1, "must still be exactly one Issue");
  const state = parseStateBlock(matches[0].body);
  assert(state.occurrence_count === 2, `expected occurrence_count 2, got ${state.occurrence_count}`);
});

test("a CANCELLED run after a FAILURE does NOT advance the clean-cycle counter or resolve (absence is not recovery)", () => {
  const client = createFakeGithubClient();
  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  runOnce({ client, logger: { log() {} }, dryRun: false });
  client._setWorkflowRuns([ciRun({ conclusion: "cancelled" })]);
  const results = runOnce({ client, logger: { log() {} }, dryRun: false });
  assert(results.cleanCycles.length === 0, "a cancelled run must never be treated as a clean cycle");
  const issue = findMainCiRedIssue(client);
  assert(issue.state === "OPEN", "the Issue must remain open — no confirmed recovery yet");
  const state = parseStateBlock(issue.body);
  assert((state.clean_cycle_count || 0) === 0);
});

test("a confirmed SUCCESS after a FAILURE resolves the Issue after exactly 1 clean cycle (not 3)", () => {
  const client = createFakeGithubClient();
  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  runOnce({ client, logger: { log() {} }, dryRun: false });
  const openBefore = findMainCiRedIssue(client);
  assert(openBefore.state === "OPEN");

  client._setWorkflowRuns([ciRun({ conclusion: "success" })]);
  const results = runOnce({ client, logger: { log() {} }, dryRun: false });
  assert(results.cleanCycles.length === 1, `expected exactly 1 clean-cycle action, got ${results.cleanCycles.length}`);
  assert(results.cleanCycles[0].action === "resolved", `expected 'resolved' on the first confirmed green run, got '${results.cleanCycles[0].action}'`);

  const issue = findMainCiRedIssue(client);
  assert(issue.state === "CLOSED", "a confirmed recovery must close the Issue after just 1 clean cycle");
});

test("recurrence: a FAILURE after resolution reopens the SAME Issue and increments recurrence_count", () => {
  const client = createFakeGithubClient();
  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  runOnce({ client, logger: { log() {} }, dryRun: false });
  const originalNumber = findMainCiRedIssue(client).number;

  client._setWorkflowRuns([ciRun({ conclusion: "success" })]);
  runOnce({ client, logger: { log() {} }, dryRun: false });
  assert(findMainCiRedIssue(client).state === "CLOSED");

  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  runOnce({ client, logger: { log() {} }, dryRun: false });
  const reopened = findMainCiRedIssue(client);
  assert(reopened.number === originalNumber, "recurrence must reopen the SAME Issue, not create a new one");
  assert(reopened.state === "OPEN");
  const state = parseStateBlock(reopened.body);
  assert(state.recurrence_count === 1, `expected recurrence_count 1, got ${state.recurrence_count}`);
});

test("dry-run never mutates GitHub state even when a real FAILURE is present", () => {
  const client = createFakeGithubClient();
  client._setWorkflowRuns([ciRun({ conclusion: "failure" })]);
  const before = client.calls.length;
  runOnce({ client, logger: { log() {} }, dryRun: true });
  const mutatingCalls = client.calls.slice(before).filter((c) => ["createIssue", "updateIssueBody", "closeIssue", "reopenIssue", "setProjectFields", "addComment"].includes(c.name));
  assert(mutatingCalls.length === 0, `dry-run must make zero mutating calls, got ${mutatingCalls.map((c) => c.name).join(",")}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
