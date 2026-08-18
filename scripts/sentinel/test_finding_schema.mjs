#!/usr/bin/env node
import { validateFinding, makeFinding } from "./finding_schema.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

const VALID = makeFinding({
  finding_type: "change_intent_stale", fingerprint: "sha256:abc", detector_id: "change_intent_stale",
  detector_version: "1.0.0", observed_at: "2026-08-18T00:00:00Z",
  facts: ["fact one"], evidence: ["evidence one"],
  canonical: { severity: "Medium", priority: "P2 - Medium", work_type: "Governance / Drift", area: "Governance" },
  authorization: { investigation_level: "I1", mutation_level: "M1" },
  provenance: { source_sha: "deadbeef", detector_version: "1.0.0", policy_version: "1.0.0", config_hash: "sha256:x", evidence_hash: "sha256:y" },
  status: "DETECTED",
});

console.log("\nfinding_schema.mjs\n");

test("a well-formed finding validates", () => {
  const { ok, errors } = validateFinding(VALID);
  assert(ok, `unexpected errors: ${errors.join(", ")}`);
});

test("missing top-level field is rejected", () => {
  const f = { ...VALID }; delete f.fingerprint;
  assert(!validateFinding(f).ok, "missing fingerprint should fail");
});

test("empty facts array is rejected", () => {
  const { ok } = validateFinding({ ...VALID, facts: [] });
  assert(!ok, "empty facts should fail");
});

test("invalid investigation_level is rejected", () => {
  const f = { ...VALID, authorization: { investigation_level: "I9", mutation_level: "M1" } };
  assert(!validateFinding(f).ok, "I9 is not a valid level");
});

test("invalid mutation_level is rejected", () => {
  const f = { ...VALID, authorization: { investigation_level: "I1", mutation_level: "M9" } };
  assert(!validateFinding(f).ok, "M9 is not a valid level");
});

test("missing canonical.severity is rejected", () => {
  const f = { ...VALID, canonical: { ...VALID.canonical, severity: undefined } };
  assert(!validateFinding(f).ok, "missing severity should fail");
});

test("missing provenance field is rejected", () => {
  const f = { ...VALID, provenance: { ...VALID.provenance, config_hash: undefined } };
  assert(!validateFinding(f).ok, "missing config_hash should fail");
});

test("wrong schema_version is rejected", () => {
  const f = { ...VALID, schema_version: 99 };
  assert(!validateFinding(f).ok, "schema_version 99 should fail");
});

test("a raw email address in facts is rejected — no PII in a Finding", () => {
  const f = { ...VALID, facts: ["contact REDACTED_EMAIL about this"] };
  assert(!validateFinding(f).ok, "a bare email in facts must be refused");
});

test("makeFinding() fills documented optional defaults", () => {
  const f = makeFinding({});
  assert(f.github.issue_number === null, "github.issue_number should default to null");
  assert(Array.isArray(f.affected_files) && f.affected_files.length === 0, "affected_files should default to []");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
