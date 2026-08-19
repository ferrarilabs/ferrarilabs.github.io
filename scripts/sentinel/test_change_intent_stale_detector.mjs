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

function declaration(surfaceId, overrides = {}) {
  return { surface_id: surfaceId, reason: "test reason", expected_behavior_change: "test change", tests_required: ["x"], ...overrides };
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

// ─── Lifecycle model (ADR-018): conditional declarations ────────────────────────────────────────
// See scripts/safety/test_change_intent_lifecycle.mjs for the shape/invariant layer itself
// (validateLifecycle/evaluateConditionalInvariants in isolation). These tests prove the DETECTOR
// consumes that same shared logic correctly — matrix items 2/4/13-16.

const fakeInvariantChecks = {
  ALWAYS_OK: { surface_id: "TEST_SURFACE", run: () => ({ ok: true, detail: null }) },
  ALWAYS_BROKEN: { surface_id: "TEST_SURFACE", run: () => ({ ok: false, detail: "invariant currently false" }) },
};
function conditionalDeclaration(overrides = {}) {
  return {
    surface_id: "TEST_SURFACE",
    reason: "test reason", expected_behavior_change: "test change", tests_required: ["x"],
    lifecycle: "conditional",
    condition_id: "cond-test",
    related_issue: 238,
    exit_conditions: [{ id: "inv", type: "MACHINE_VERIFIABLE", check: "ALWAYS_OK" }],
    ...overrides,
  };
}

test("2. legacy one-shot declaration whose path IS in the diff -> not stale (unchanged predicate)", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [declaration("TEST_SURFACE")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => ["some/fake/path.js"],
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 0);
});

test("4. explicit lifecycle: 'one_shot' declaration whose path is NOT in the diff -> stale, one finding", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [declaration("TEST_SURFACE", { lifecycle: "one_shot" })] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => ["totally/unrelated.md"],
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 1);
});

test("13. Sentinel sees a valid conditional declaration whose invariant holds -> ZERO stale finding, even with zero path overlap and an old base", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [conditionalDeclaration()] }),
    resolveBaseFn: () => ({ sha: "very-old-sha", how: "test" }),
    changedPathsFn: () => [], // zero overlap -- would be stale under one_shot, must NOT matter here
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 0, "a well-formed conditional declaration with a holding invariant must never be flagged, regardless of diff/age");
});

test("14. Sentinel sees a stale one-shot declaration (default lifecycle) -> finding, unchanged from before ADR-018", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [declaration("TEST_SURFACE")] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => ["unrelated.md"],
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 1);
});

test("15. Sentinel sees a malformed conditional (missing condition_id) -> finding, distinct from staleness", () => {
  const d = conditionalDeclaration(); delete d.condition_id;
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [d] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [],
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 1);
  assert(findings[0].facts.some((f) => f.toLowerCase().includes("condition_id")), findings[0].facts.join(" | "));
});

test("16. Sentinel sees a conditional whose MACHINE_VERIFIABLE invariant is violated -> finding", () => {
  const d = conditionalDeclaration({ exit_conditions: [{ id: "inv", type: "MACHINE_VERIFIABLE", check: "ALWAYS_BROKEN" }] });
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [d] }),
    resolveBaseFn: () => ({ sha: "aaa", how: "test" }),
    changedPathsFn: () => [],
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 1);
  assert(findings[0].facts.some((f) => f.includes("VIOLADO") || f.toLowerCase().includes("violat")), findings[0].facts.join(" | "));
});

test("a conditional declaration remains active + non-stale across MANY unrelated commits (simulated by an always-empty changedPaths) as long as its invariant holds", () => {
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => REG_ONE_SURFACE,
    loadIntentFn: () => ({ declarations: [conditionalDeclaration()] }),
    resolveBaseFn: () => ({ sha: "many-commits-ago", how: "test" }),
    changedPathsFn: () => [],
    invariantChecks: fakeInvariantChecks,
  });
  assert(findings.length === 0);
});

test("historical ground truth (Issue #238): reproduces the real BR2026 conditional declaration and its real invariant check function, unmutated -> zero findings", () => {
  const realDeclaration = {
    surface_id: "NOTIFICATION_WORKFLOWS",
    lifecycle: "conditional",
    condition_id: "br2026-email-emergency-disarm-20260818",
    related_issue: 238,
    reason: "r", expected_behavior_change: "e", tests_required: ["x"],
    exit_conditions: [{ id: "workflow_remains_disarmed", type: "MACHINE_VERIFIABLE", check: "BR2026_ROUND_EMAILS_DISARMED" }],
  };
  const reg = { schemaVersion: 1, surfaces: [
    { id: "NOTIFICATION_WORKFLOWS", change_policy: "DECLARE_TO_CHANGE", paths: [".github/workflows/*.yml"] },
  ] };
  const findings = detectChangeIntentStale({
    loadSurfacesFn: () => reg,
    loadIntentFn: () => ({ declarations: [realDeclaration] }),
    resolveBaseFn: () => ({ sha: "4029f29d", how: "test" }),
    changedPathsFn: () => [], // exactly the shape that produced the #238 false positive before this fix
    invariantChecks: { BR2026_ROUND_EMAILS_DISARMED: { surface_id: "NOTIFICATION_WORKFLOWS", run: () => ({ ok: true, detail: null }) } },
  });
  assert(findings.length === 0, "the real BR2026 conditional declaration must not produce the pre-fix recurrence false positive");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
