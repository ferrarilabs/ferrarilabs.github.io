#!/usr/bin/env node
/**
 * Tests for the migration phase plan (Workstream K).
 *
 * The deliverable of K is the six ordering CORRECTIONS, not the phase list. So each correction's
 * invariant is tested by reordering a copy of the real plan into the naive (unsafe) order and
 * asserting the invariant fires. An ordering rule that cannot detect the ordering it forbids is a
 * comment.
 */

import { loadPhases, validatePhases } from "./validate_migration_phases.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const clone = () => JSON.parse(JSON.stringify(loadPhases()));
const errs = (doc) => validatePhases(doc).errors;
/** Move the phase named `name` to just before `beforeName`, rebuilding dependsOn to stay consistent. */
function move(doc, name, beforeName) {
  const from = doc.phases.findIndex((p) => p.name === name);
  const [ph] = doc.phases.splice(from, 1);
  const to = doc.phases.findIndex((p) => p.name === beforeName);
  doc.phases.splice(to, 0, ph);
  // Re-chain dependencies to the new linear order so the test isolates the ORDERING invariant
  // rather than tripping the generic backward-dependency check first.
  doc.phases.forEach((p, i) => { p.dependsOn = i === 0 ? [] : [doc.phases[i - 1].id]; });
  return doc;
}

console.log("\nThe real plan must be valid\n");

test("the committed phase plan validates with no errors", () => {
  const e = errs(loadPhases());
  eq(e.length, 0, `errors:\n      ${e.join("\n      ")}`);
});

test("all required phase topics are covered", () => {
  const names = loadPhases().phases.map((p) => p.name).join(" ");
  for (const [topic, re] of [
    ["baseline adoption", /baseline/], ["reference entities", /reference_entities/],
    ["identity", /identity/], ["competitions", /reference_entities|competition/],
    ["pools", /pool/], ["financial", /financial/], ["matches/results", /fact_tables/],
    ["predictions/picks", /picks|fact_tables/], ["audit", /audit/], ["outbox", /outbox/],
    ["reporting", /reporting/], ["backfill", /backfill_/], ["dual-read", /dual_read/],
    ["server-mediated writes", /server_mediated/], ["cutover", /cutover/],
    ["legacy freeze", /freeze/], ["legacy removal", /removal/],
  ]) {
    assert(re.test(names), `no phase covers ${topic}`);
  }
});

test("every phase declares all nine required properties", () => {
  for (const p of loadPhases().phases) {
    for (const f of ["objects", "dataMovement", "backfill", "compatibility", "validation", "rollback", "appDependency", "risk", "lockBehavior"]) {
      assert(p[f] !== undefined && p[f] !== "", `${p.id} missing ${f}`);
    }
  }
});

test("the declared order is a valid execution order (dependencies point backward)", () => {
  const phases = loadPhases().phases;
  const pos = new Map(phases.map((p, i) => [p.id, i]));
  for (const p of phases) for (const d of p.dependsOn) {
    assert(pos.get(d) < pos.get(p.id), `${p.id} depends on ${d}, which is not earlier`);
  }
});

test("every high-risk phase has a rollback that is not 'none'", () => {
  for (const p of loadPhases().phases.filter((x) => x.risk === "HIGH")) {
    assert(!/^(none|n\/a)$/i.test(p.rollback.trim()), `${p.id} is HIGH risk with no rollback`);
  }
});

test("every destructive phase is explicitly flagged and has a rollback", () => {
  const d = loadPhases().phases.filter((p) => p.destructive);
  assert(d.length >= 1, "at least one phase must be honestly marked destructive");
  for (const p of d) assert(!/^(none|n\/a)$/i.test(p.rollback.trim()), `${p.id} destructive with no rollback`);
});

console.log("\nOrdering invariants — each must fire on the naive ordering it forbids\n");

test("OI-1 fires when audit infrastructure is moved after the backfills", () => {
  const doc = move(clone(), "audit_and_outbox_infrastructure", "write_through_via_server_mediated_writes");
  assert(errs(doc).some((e) => /OI-1 violated/.test(e)),
    "an audit table created after the backfill leaves the largest data movement unaudited, and the check must say so");
});

test("OI-2 fires when dual-read precedes write-through", () => {
  const doc = move(clone(), "dual_read_comparison", "write_through_via_server_mediated_writes");
  assert(errs(doc).some((e) => /OI-2 violated/.test(e)),
    "comparing against a stale relational copy reports method artefacts as defects");
});

test("OI-3 fires when the reporting layer is built before cutover", () => {
  const doc = move(clone(), "reporting_layer", "legacy_freeze_window");
  assert(errs(doc).some((e) => /OI-3 violated/.test(e)),
    "a matview over partially backfilled data caches confident wrong numbers");
});

test("OI-4 fires when the freeze follows cutover", () => {
  const doc = move(clone(), "legacy_freeze_window", "reporting_layer");
  assert(errs(doc).some((e) => /OI-4 violated/.test(e)),
    "parity cannot be proven against a mutating source");
});

test("OI-5 fires when the backfill is collapsed into a single phase", () => {
  const doc = clone();
  doc.phases = doc.phases.filter((p) => !/^backfill_(payments|results)/.test(p.name));
  doc.phases.forEach((p, i) => { p.dependsOn = i === 0 ? [] : [doc.phases[i - 1].id]; });
  assert(errs(doc).some((e) => /OI-5 violated/.test(e)),
    "one monolithic backfill has no partial-success state, so the only recovery is to start over");
});

test("OI-6 fires when the identity backfill stops declaring zero merges", () => {
  const doc = clone();
  const p = doc.phases.find((x) => x.name === "identity_backfill_zero_merges");
  p.backfill = "one participant per distinct email; merge obvious duplicates automatically";
  p.notes = "merges high-confidence pairs during the batch";
  assert(errs(doc).some((e) => /OI-6 violated/.test(e)),
    "an automated merge inside a batch makes an irreversible money-affecting decision with no operator confirmation");
});

test("OI-6 fires when any pre-review phase performs a merge", () => {
  const doc = clone();
  doc.phases.find((p) => p.name === "backfill_entries").dataMovement = "entries → pool_entries; merges duplicate participants";
  assert(errs(doc).some((e) => /OI-6 violated/.test(e)), "a merge before the operator review phase must be caught");
});

test("OI-8 fires when the picks-decomposition phase drops scoring parity from its validation", () => {
  const doc = clone();
  const p = doc.phases.find((x) => /picks/i.test(x.name));
  p.validation = "row counts match";
  assert(errs(doc).some((e) => /OI-8 violated/.test(e)),
    "changing the scoring input path without a scoring parity gate is the one thing this programme must never do");
});

test("every ordering correction has an invariant enforcing it", () => {
  const doc = loadPhases();
  const enforced = new Set(doc.orderingInvariants.map((i) => i.enforces));
  for (const c of doc.meta.orderingCorrections) {
    assert(enforced.has(c.id), `correction ${c.id} has no invariant — a correction nobody checks is a comment`);
  }
});

test("removing an invariant's correction linkage is detected", () => {
  const doc = clone();
  doc.orderingInvariants = doc.orderingInvariants.filter((i) => i.enforces !== "OC-1");
  assert(errs(doc).some((e) => /OC-1 has no invariant/.test(e)), "unenforced correction not detected");
});

console.log("\nGeneric safety checks\n");

test("a backward-dependency error is reported", () => {
  const doc = clone();
  doc.phases[1].dependsOn = [doc.phases[5].id];
  assert(errs(doc).some((e) => /not earlier in the declared order/.test(e)), "not reported");
});

test("an unknown dependency is reported", () => {
  const doc = clone();
  doc.phases[2].dependsOn = ["M99"];
  assert(errs(doc).some((e) => /unknown phase M99/.test(e)), "not reported");
});

test("a destructive phase with no rollback is reported", () => {
  const doc = clone();
  const p = doc.phases.find((x) => x.destructive);
  p.rollback = "none";
  assert(errs(doc).some((e) => /destructive phase with no rollback/.test(e)), "not reported");
});

test("a data-moving phase with no validation is reported", () => {
  const doc = clone();
  doc.phases.find((p) => p.name === "backfill_entries").validation = "none";
  assert(errs(doc).some((e) => /moves data but declares no validation/.test(e)), "not reported");
});

test("a non-concurrent CREATE INDEX is reported", () => {
  const doc = clone();
  const p = doc.phases.find((x) => x.name === "reporting_layer");
  p.objects = "views and CREATE INDEX on payment_allocations";
  p.lockBehavior = "brief";
  assert(errs(doc).some((e) => /without CONCURRENTLY/.test(e)),
    "a plain CREATE INDEX blocks writes for its whole duration");
});

test("an unanchored phase is reported", () => {
  const doc = clone();
  doc.phases[3].dependsOn = [];
  assert(errs(doc).some((e) => /no dependencies declared/.test(e)), "not reported");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ MIGRATION PHASE TESTS PASSED\n" : "✗ MIGRATION PHASE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
