#!/usr/bin/env node
import { detectChangeIntentStale, DETECTOR_ID } from "./detectors/change_intent_stale.mjs";
import { validateFinding } from "./finding_schema.mjs";
import { changeIntentStaleFingerprint } from "./fingerprint.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

const REG_ONE_SURFACE = {
  schemaVersion: 1,
  surfaces: [{ id: "TEST_SURFACE", change_policy: "DECLARE_TO_CHANGE", paths: ["some/fake/path.js"] }],
};
const REG_STRUCTURAL = {
  schemaVersion: 1,
  surfaces: [{ id: "STRUCTURAL_SURFACE", change_policy: "STRUCTURALLY_ENFORCED", paths: ["app.js"] }],
};

function declaration(surfaceId) {
  return { surface_id: surfaceId, reason: "test reason", expected_behavior_change: "test change", tests_required: ["x"] };
}

console.log("\nchange_intent_stale detector\n");

test("clean repo (no declarations) -> zero findings", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [],
  });
  assert(findings.length === 0);
});

test("declaration whose path IS in the diff -> not stale, zero findings", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [declaration("TEST_SURFACE")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => ["some/fake/path.js"], // covered — declaration is CURRENT, not stale
  });
  assert(findings.length === 0, "a currently-valid declaration must never be flagged");
});

test("declaration whose path is NOT in the diff -> exactly one finding, well-formed", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [declaration("TEST_SURFACE")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => ["totally/unrelated.md"],
  });
  assert(findings.length === 1);
  const { ok, errors } = validateFinding(findings[0]);
  assert(ok, `finding does not validate: ${errors.join(", ")}`);
  assert(findings[0].fingerprint === changeIntentStaleFingerprint("TEST_SURFACE"));
  assert(findings[0].detector_id === DETECTOR_ID);
});

test("STRUCTURALLY_ENFORCED surface is NEVER flagged stale, even with zero path overlap", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_STRUCTURAL,
    loadIntentFn: () => ({ declarations: [declaration("STRUCTURAL_SURFACE")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [], // zero overlap — would be stale for DECLARE_TO_CHANGE, but this policy exempts it
  });
  assert(findings.length === 0, "STRUCTURALLY_ENFORCED must be exempt from D3's staleness rule, matching audit_safety_contract.mjs exactly");
});

test("declaration referencing an unknown surface_id is silently skipped (D1's problem, not D3's)", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [declaration("DOES_NOT_EXIST")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [],
  });
  assert(findings.length === 0);
});

test("two simultaneously-stale declarations produce two distinct findings with distinct fingerprints", () => {
  const reg = { schemaVersion: 1, surfaces: [
    { id: "SURF_A", change_policy: "DECLARE_TO_CHANGE", paths: ["a.js"] },
    { id: "SURF_B", change_policy: "DECLARE_TO_CHANGE", paths: ["b.js"] },
  ] };
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => reg,
    loadIntentFn: () => ({ declarations: [declaration("SURF_A"), declaration("SURF_B")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [],
  });
  assert(findings.length === 2);
  assert(findings[0].fingerprint !== findings[1].fingerprint);
});

// ─── Historical ground truth ──────────────────────────────────────────────────────────────────
// These fixtures reproduce (not replay against real Issues) the two real incidents this detector
// exists because of. No historical Issue is read, mutated, or referenced by number here — only the
// underlying repository *condition* is reconstructed, per Step 20's instruction not to touch real
// history.

test("historical ground truth: reproduces the #223 condition (NOTIFICATION_WORKFLOWS-shaped surface stale after merge)", () => {
  // Reconstructs exactly what main looked like right after PR #221/#222 merged: a
  // DECLARE_TO_CHANGE surface whose declaration described a workflow-file change that had
  // already landed, on a branch whose base had since moved past those commits.
  const reg = { schemaVersion: 1, surfaces: [
    { id: "NOTIFICATION_WORKFLOWS", change_policy: "DECLARE_TO_CHANGE", paths: [".github/workflows/*.yml"] },
  ] };
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => reg,
    loadIntentFn: () => ({ declarations: [declaration("NOTIFICATION_WORKFLOWS")] }),
    resolveBaseFn: () => ({ sha: "3cc67825", how: "merge-base com origin/main" }),
    changedPathsFn: () => [], // base already moved past the workflow-file commits — exactly #223's shape
  });
  assert(findings.length === 1, "the detector would have caught #223 automatically");
  assert(findings[0].affected_components.includes("NOTIFICATION_WORKFLOWS"));
});

test("historical ground truth: reproduces the earlier SHARED_VISUAL_FRAMEWORK precedent (commit 4044a438)", () => {
  const reg = { schemaVersion: 1, surfaces: [
    { id: "SHARED_VISUAL_FRAMEWORK", change_policy: "DECLARE_TO_CHANGE", paths: ["bolao/shared/css/*.css"] },
  ] };
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => reg,
    loadIntentFn: () => ({ declarations: [declaration("SHARED_VISUAL_FRAMEWORK")] }),
    resolveBaseFn: () => ({ sha: "56737d34", how: "merge-base com origin/main" }),
    changedPathsFn: () => [], // commit 56737d34 had already landed behind HEAD by the time this was checked
  });
  assert(findings.length === 1, "the detector would have caught the pre-#223 precedent too, not just #223 itself");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
