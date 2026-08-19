#!/usr/bin/env node
/**
 * test_change_intent_lifecycle.mjs — unit tests for the ONE_SHOT/CONDITIONAL lifecycle model
 * (ADR-018), against the pure, dependency-injectable functions in scripts/safety/surfaces.mjs:
 * `validateLifecycle` (D1's shape validation) and `evaluateConditionalInvariants` (D3's
 * live-invariant evaluation). These are the SAME functions audit_safety_contract.mjs and the
 * Sentinel change_intent_stale detector both import — this file proves the shared logic itself,
 * independent of either caller.
 */
import { validateLifecycle, evaluateConditionalInvariants, makeInvariantChecks } from "./surfaces.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.stack || e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

const fakeChecks = {
  ALWAYS_OK: { surface_id: "X", run: () => ({ ok: true, detail: null }) },
  ALWAYS_BROKEN: { surface_id: "X", run: () => ({ ok: false, detail: "invariant is currently false" }) },
  WRONG_SURFACE: { surface_id: "SOME_OTHER_SURFACE", run: () => ({ ok: true, detail: null }) },
};

function oneShot(overrides = {}) {
  return { surface_id: "X", ...overrides };
}
function conditional(overrides = {}) {
  return {
    surface_id: "X",
    lifecycle: "conditional",
    condition_id: "cond-1",
    related_issue: 238,
    exit_conditions: [{ id: "inv", type: "MACHINE_VERIFIABLE", check: "ALWAYS_OK" }],
    ...overrides,
  };
}

console.log("\nCHANGE_INTENT lifecycle model (ADR-018)\n");

// ── 1/3. legacy + explicit one_shot valid ───────────────────────────────────────────────────────
test("1. legacy one-shot (no lifecycle field) is valid — zero problems", () => {
  const problems = validateLifecycle(oneShot(), fakeChecks, new Set());
  assert(problems.length === 0, problems.join("; "));
});
test("3. explicit lifecycle: 'one_shot' is valid — identical to absence", () => {
  const problems = validateLifecycle(oneShot({ lifecycle: "one_shot" }), fakeChecks, new Set());
  assert(problems.length === 0, problems.join("; "));
});

// ── 2/4. staleness itself (path-diff) is D3's job, not validateLifecycle's — covered in the
// audit_safety_contract.mjs mutation suite and the Sentinel detector's own test file. This file
// only proves the SHAPE/invariant layer.

// ── 5/10. valid conditional, across unrelated commits (age is irrelevant to this layer) ────────
test("5/10. valid conditional with a holding invariant: zero shape problems, invariant evaluates ok", () => {
  const d = conditional();
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.length === 0, problems.join("; "));
  const results = evaluateConditionalInvariants(d, fakeChecks);
  assert(results.length === 1 && results[0].ok === true);
});

// ── 6. missing condition_id -> FAIL ─────────────────────────────────────────────────────────────
test("6. conditional with missing condition_id -> FAIL", () => {
  const d = conditional(); delete d.condition_id;
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("condition_id")), problems.join("; "));
});

// ── 7. malformed lifecycle value -> FAIL, does not silently become one_shot or conditional ──────
test("7. malformed lifecycle value ('conditinal' typo) -> FAIL, not silently downgraded", () => {
  const problems = validateLifecycle(oneShot({ lifecycle: "conditinal" }), fakeChecks, new Set());
  assert(problems.length === 1 && problems[0].includes("desconhecido"), problems.join("; "));
});

// ── 8/9. invariant maintained -> PASS ; invariant violated -> FAIL ──────────────────────────────
test("8. conditional whose MACHINE_VERIFIABLE invariant is maintained -> evaluates ok, no violation", () => {
  const results = evaluateConditionalInvariants(conditional(), fakeChecks);
  assert(results.every((r) => r.ok));
});
test("9. conditional whose MACHINE_VERIFIABLE invariant is violated -> evaluates NOT ok", () => {
  const d = conditional({ exit_conditions: [{ id: "inv", type: "MACHINE_VERIFIABLE", check: "ALWAYS_BROKEN" }] });
  const results = evaluateConditionalInvariants(d, fakeChecks);
  assert(results.length === 1 && results[0].ok === false && results[0].detail.includes("false"));
});

// ── additional shape requirements (still within the required matrix's spirit) ──────────────────
test("conditional with no exit_conditions -> FAIL", () => {
  const d = conditional({ exit_conditions: [] });
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("exit_conditions")), problems.join("; "));
});
test("conditional with missing related_issue -> FAIL", () => {
  const d = conditional(); delete d.related_issue;
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("related_issue")), problems.join("; "));
});
test("conditional referencing an unregistered check name -> FAIL (cannot invent a check)", () => {
  const d = conditional({ exit_conditions: [{ id: "inv", type: "MACHINE_VERIFIABLE", check: "DOES_NOT_EXIST" }] });
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("nao existe") || p.includes("inexistente")), problems.join("; "));
});
test("conditional with ONLY HUMAN_OPERATIONS_VERIFIED exit_conditions (no MACHINE_VERIFIABLE) -> FAIL — prose alone is never sufficient (the core anti-escape-hatch rule)", () => {
  const d = conditional({ exit_conditions: [{ id: "root_cause", type: "HUMAN_OPERATIONS_VERIFIED", satisfied: false }] });
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("MACHINE_VERIFIABLE")), problems.join("; "));
});
test("HUMAN_OPERATIONS_VERIFIED exit_condition missing boolean 'satisfied' -> FAIL", () => {
  const d = conditional({
    exit_conditions: [
      { id: "inv", type: "MACHINE_VERIFIABLE", check: "ALWAYS_OK" },
      { id: "root_cause", type: "HUMAN_OPERATIONS_VERIFIED" },
    ],
  });
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("satisfied")), problems.join("; "));
});
test("duplicate condition_id across two declarations sharing one Set -> second FAILS", () => {
  const seen = new Set();
  const p1 = validateLifecycle(conditional(), fakeChecks, seen);
  const p2 = validateLifecycle(conditional(), fakeChecks, seen); // same condition_id, same surface
  assert(p1.length === 0, p1.join("; "));
  assert(p2.some((p) => p.includes("duplicado")), p2.join("; "));
});
test("malformed exit_condition entry (missing id/type) -> FAIL", () => {
  const d = conditional({ exit_conditions: [{ check: "ALWAYS_OK" }] });
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("malformada")), problems.join("; "));
});
test("exit_condition's check is registered for a DIFFERENT surface_id than the declaration -> FAIL (cannot borrow an unrelated invariant)", () => {
  const d = conditional({ exit_conditions: [{ id: "inv", type: "MACHINE_VERIFIABLE", check: "WRONG_SURFACE" }] });
  const problems = validateLifecycle(d, fakeChecks, new Set());
  assert(problems.some((p) => p.includes("superficie")), problems.join("; "));
});

// ── makeInvariantChecks: the real, production BR2026 check, against fixture file content ───────
test("makeInvariantChecks: BR2026_ROUND_EMAILS_DISARMED — disarmed workflow content -> ok", () => {
  const checks = makeInvariantChecks((p) => (p.endsWith("br2026_round_emails.yml")
    ? 'BOLAO_ALLOW_REAL_SEND: "DISARMED_X"\nrun: python3 send_round_email.py --dry-run\n' : null));
  const { ok } = checks.BR2026_ROUND_EMAILS_DISARMED.run();
  assert(ok === true);
});
test("makeInvariantChecks: BR2026_ROUND_EMAILS_DISARMED — armed workflow content (--auto) -> NOT ok", () => {
  const checks = makeInvariantChecks((p) => (p.endsWith("br2026_round_emails.yml")
    ? 'BOLAO_ALLOW_REAL_SEND: "I UNDERSTAND"\nrun: python3 send_round_email.py --auto\n' : null));
  const { ok } = checks.BR2026_ROUND_EMAILS_DISARMED.run();
  assert(ok === false);
});
test("makeInvariantChecks: BR2026_ROUND_EMAILS_DISARMED — missing file -> NOT ok, never throws", () => {
  const checks = makeInvariantChecks(() => null);
  const { ok, detail } = checks.BR2026_ROUND_EMAILS_DISARMED.run();
  assert(ok === false && typeof detail === "string");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
