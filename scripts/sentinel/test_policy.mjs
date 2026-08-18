#!/usr/bin/env node
import { applyPolicy, clampSeverity, clampPriority, POLICY_VERSION } from "./policy.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\npolicy.mjs\n");

test("change_intent_stale gets its documented defaults", () => {
  const { canonical, authorization } = applyPolicy("change_intent_stale");
  assert(canonical.severity === "Medium", `expected Medium, got ${canonical.severity}`);
  assert(canonical.priority === "P2 - Medium", `expected P2 - Medium, got ${canonical.priority}`);
  assert(canonical.work_type === "Governance / Drift");
  assert(canonical.area === "Governance");
  assert(authorization.investigation_level === "I1");
  assert(authorization.mutation_level === "M1");
});

test("unknown detector_id throws rather than silently guessing", () => {
  let threw = false;
  try { applyPolicy("nonexistent_detector"); } catch { threw = true; }
  assert(threw, "applyPolicy must refuse an unregistered detector_id");
});

test("clamp: no suggestion -> floor wins", () => {
  assert(clampSeverity("Medium", undefined) === "Medium");
});

test("clamp: AI suggestion ABOVE floor is allowed (may raise)", () => {
  assert(clampSeverity("Medium", "High") === "High");
});

test("clamp: AI suggestion BELOW floor is rejected (never lowers)", () => {
  assert(clampSeverity("High", "Low") === "High", "a downgrade suggestion must never win");
});

test("clamp: unrecognized suggestion value never wins", () => {
  assert(clampSeverity("Medium", "Super Critical") === "Medium");
});

test("priority clamp behaves the same direction as severity clamp", () => {
  assert(clampPriority("P2 - Medium", "P0 - Critical") === "P0 - Critical", "raise allowed");
  assert(clampPriority("P1 - High", "P3 - Low") === "P1 - High", "downgrade rejected");
});

test("POLICY_VERSION is a non-empty string (provenance depends on it)", () => {
  assert(typeof POLICY_VERSION === "string" && POLICY_VERSION.length > 0);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
