#!/usr/bin/env node
import { detectMainCiRed, classifyRun, DETECTOR_ID, MONITORED_WORKFLOW } from "./detectors/main_ci_red.mjs";
import { validateFinding } from "./finding_schema.mjs";
import { mainCiRedFingerprint } from "./fingerprint.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

function run(overrides = {}) {
  return { status: "completed", conclusion: "success", headSha: "aaa", createdAt: new Date().toISOString(), jobs: [{ name: "npm run check" }], ...overrides };
}

console.log("\nmain_ci_red detector\n");

// ─── classifyRun: every GitHub status/conclusion value the taxonomy must distinguish ───────────

test("classifyRun: completed + success -> SUCCESS", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "success" })) === "SUCCESS");
});
test("classifyRun: completed + failure -> FAILURE", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "failure" })) === "FAILURE");
});
test("classifyRun: completed + cancelled -> CANCELLED", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "cancelled" })) === "CANCELLED");
});
test("classifyRun: completed + timed_out -> TIMED_OUT", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "timed_out" })) === "TIMED_OUT");
});
test("classifyRun: completed + action_required -> ACTION_REQUIRED", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "action_required" })) === "ACTION_REQUIRED");
});
test("classifyRun: completed + skipped -> SKIPPED_INTENTIONAL", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "skipped" })) === "SKIPPED_INTENTIONAL");
});
test("classifyRun: completed + neutral -> SKIPPED_INTENTIONAL", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "neutral" })) === "SKIPPED_INTENTIONAL");
});
test("classifyRun: completed + unrecognized conclusion -> UNKNOWN (fail visible, not silent)", () => {
  assert(classifyRun(run({ status: "completed", conclusion: "some_future_github_value" })) === "UNKNOWN");
});
test("classifyRun: in_progress, recent -> IN_PROGRESS (not yet stale)", () => {
  const createdAt = new Date(Date.now() - 5 * 60000).toISOString();
  assert(classifyRun(run({ status: "in_progress", conclusion: null, createdAt })) === "IN_PROGRESS");
});
test("classifyRun: in_progress, older than the stale threshold -> STALE (hung run, FMEA case)", () => {
  const createdAt = new Date(Date.now() - 200 * 60000).toISOString();
  assert(classifyRun(run({ status: "in_progress", conclusion: null, createdAt })) === "STALE");
});
test("classifyRun: null run -> UNKNOWN, never throws", () => {
  assert(classifyRun(null) === "UNKNOWN");
});

// ─── detectMainCiRed: findings + confirmedRecoveries shape ─────────────────────────────────────

test("no runs at all -> zero findings, empty confirmedRecoveries (fail open, no signal)", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({ fetchLatestRuns: () => [] });
  assert(findings.length === 0);
  assert(confirmedRecoveries.size === 0);
});

test("latest run SUCCESS -> zero findings, fingerprint present in confirmedRecoveries", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({ fetchLatestRuns: () => [run()] });
  assert(findings.length === 0);
  const fp = mainCiRedFingerprint(MONITORED_WORKFLOW, "npm run check");
  assert(confirmedRecoveries.has(fp), "a confirmed green run must be a positive recovery signal");
});

test("latest run FAILURE -> exactly one well-formed finding, not in confirmedRecoveries", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({ fetchLatestRuns: () => [run({ conclusion: "failure" })] });
  assert(findings.length === 1);
  const { ok, errors } = validateFinding(findings[0]);
  assert(ok, `finding does not validate: ${errors.join(", ")}`);
  assert(findings[0].detector_id === DETECTOR_ID);
  assert(confirmedRecoveries.size === 0);
});

test("latest run CANCELLED -> zero findings, zero confirmedRecoveries (no signal either way)", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({ fetchLatestRuns: () => [run({ conclusion: "cancelled" })] });
  assert(findings.length === 0, "a cancelled run is not evidence main is broken");
  assert(confirmedRecoveries.size === 0, "a cancelled run is not evidence main is fixed either");
});

test("latest run IN_PROGRESS (recent) -> zero findings, zero confirmedRecoveries (still running, no verdict yet)", () => {
  const createdAt = new Date(Date.now() - 5 * 60000).toISOString();
  const { findings, confirmedRecoveries } = detectMainCiRed({ fetchLatestRuns: () => [run({ status: "in_progress", conclusion: null, createdAt })] });
  assert(findings.length === 0);
  assert(confirmedRecoveries.size === 0);
});

test("latest run STALE (hung) -> exactly one finding — a hung run is itself the failure mode", () => {
  const createdAt = new Date(Date.now() - 200 * 60000).toISOString();
  const { findings } = detectMainCiRed({ fetchLatestRuns: () => [run({ status: "in_progress", conclusion: null, createdAt })] });
  assert(findings.length === 1);
});

test("fingerprint depends only on workflow+job — the same failing job across two different SHAs is ONE fingerprint", () => {
  const { findings: f1 } = detectMainCiRed({ fetchLatestRuns: () => [run({ conclusion: "failure", headSha: "aaa" })] });
  const { findings: f2 } = detectMainCiRed({ fetchLatestRuns: () => [run({ conclusion: "failure", headSha: "bbb" })] });
  assert(f1[0].fingerprint === f2[0].fingerprint, "same job, different SHA, must be the same ongoing incident");
});

test("two different jobs failing on one run produce two distinct findings with distinct fingerprints", () => {
  const { findings } = detectMainCiRed({
    fetchLatestRuns: () => [run({ conclusion: "failure", jobs: [{ name: "npm run check" }, { name: "other-job" }] })],
  });
  assert(findings.length === 2);
  assert(findings[0].fingerprint !== findings[1].fingerprint);
});

test("missing job list falls back to the workflow name itself as the sole job — never silently drops the finding", () => {
  const { findings } = detectMainCiRed({ fetchLatestRuns: () => [run({ conclusion: "failure", jobs: [] })] });
  assert(findings.length === 1);
  assert(findings[0].affected_components.includes(MONITORED_WORKFLOW));
});

// ─── Historical ground truth ────────────────────────────────────────────────────────────────────
// Real data captured directly from the GitHub API for this repo's "Safety check" workflow —
// reconstructs the actual condition, never replays against the real Issues/runs by number.

test("historical ground truth: reproduces run 32072791434 — the real #219 gate-registry FAILURE", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({
    fetchLatestRuns: () => [{
      headSha: "1555cadaa3ee1f04eb3e4885f8a6ce60f21499b5",
      createdAt: "2026-08-17T21:46:06Z",
      status: "completed",
      conclusion: "failure",
      jobs: [{ name: "npm run check", conclusion: "failure" }],
    }],
  });
  assert(findings.length === 1, "the detector would have caught the real #219 CI failure automatically");
  assert(confirmedRecoveries.size === 0);
  assert(findings[0].facts.some((f) => f.includes("FAILURE")));
});

test("historical ground truth: reproduces run 32086458159 — the real PR #220 recovery to SUCCESS", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({
    fetchLatestRuns: () => [{
      headSha: "968a5b901b290a556b71b908e13210eef02c49d2",
      createdAt: "2026-08-18T00:57:33Z",
      status: "completed",
      conclusion: "success",
      jobs: [{ name: "npm run check", conclusion: "success" }],
    }],
  });
  assert(findings.length === 0);
  const fp = mainCiRedFingerprint(MONITORED_WORKFLOW, "npm run check");
  assert(confirmedRecoveries.has(fp), "the real PR #220 fix must register as a confirmed recovery");
});

test("historical ground truth: reproduces the real CANCELLED-by-concurrency-group anomaly (run 32166437045) — no finding, no false recovery", () => {
  const { findings, confirmedRecoveries } = detectMainCiRed({
    fetchLatestRuns: () => [{
      headSha: "945e60d8",
      createdAt: "2026-08-18T10:00:00Z",
      status: "completed",
      conclusion: "cancelled",
      jobs: [{ name: "npm run check", conclusion: "cancelled" }],
    }],
  });
  assert(findings.length === 0, "a concurrency-group cancellation is not a real CI red — this was directly observed this session");
  assert(confirmedRecoveries.size === 0, "a cancellation must never be mistaken for a green run either");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
