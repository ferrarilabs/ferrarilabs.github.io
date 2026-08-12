#!/usr/bin/env node
/**
 * Tests for the surface inventory — the guard that generalizes F039/F012/F055/F058.
 *
 * The property under test is unusual and worth naming: this suite does not check that the database is
 * correct. It checks that the QUESTION SET is complete, and that "we looked and found nothing" cannot be
 * confused with "we never looked". Every one of the four findings above was a class nobody had queried.
 */
import {
  SURFACE_CLASSES, CLASS_IDS, SCOPE, completenessFailures, summarize, notMeasured,
  notCarriedByPublicSchemaDump,
} from "./surface_inventory.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log("\nThe inventory covers every object class that has ever hidden a finding\n");

test("all four historical blind spots are declared classes, each naming its finding", () => {
  for (const [id, finding] of [["ROLES", "KPLUS-F039"], ["EVENT_TRIGGERS", "KPLUS-F012"],
    ["TABLES", "KPLUS-F055"], ["VIEWS", "KPLUS-F058"]]) {
    const c = SURFACE_CLASSES.find((x) => x.id === id);
    assert(c, `${id} is not a declared class — the finding that came from it could recur unseen`);
    eq(c.finding, finding, `${id} does not record which finding its blind spot produced`);
  }
});

test("the classes a relkind filter would miss are all present", () => {
  for (const id of ["PARTITIONED_TABLES", "VIEWS", "MATERIALIZED_VIEWS", "FOREIGN_TABLES", "SEQUENCES"]) {
    assert(CLASS_IDS.includes(id), `${id} is missing; a relkind='r' filter silently excludes it, which is exactly KPLUS-F058`);
  }
});

test("the classes a --schema=public dump cannot carry are marked, and event triggers are among them", () => {
  const uncarried = notCarriedByPublicSchemaDump().map((c) => c.id);
  for (const id of ["ROLES", "EVENT_TRIGGERS", "DEFAULT_PRIVILEGES", "EXTENSIONS", "SCHEMAS", "MIGRATION_LEDGER"]) {
    assert(uncarried.includes(id), `${id} is marked as carried by a public-schema dump, and it is not — that mark is what KPLUS-F012 turned on`);
  }
  // And the scope must be right: roles are cluster-global, event triggers are database-scoped.
  eq(SURFACE_CLASSES.find((c) => c.id === "ROLES").scope, SCOPE.CLUSTER, "roles are cluster-global — a database dump never carries them");
  eq(SURFACE_CLASSES.find((c) => c.id === "EVENT_TRIGGERS").scope, SCOPE.DATABASE, "event triggers are database-scoped, not schema-scoped");
});

test("every class states why it matters and how to query it", () => {
  assert(SURFACE_CLASSES.length >= 19, `only ${SURFACE_CLASSES.length} classes; the surface is larger than that`);
  for (const c of SURFACE_CLASSES) {
    assert(c.sql && c.sql.length > 20, `${c.id} has no query`);
    assert(c.why && c.why.length > 30, `${c.id} does not say why it matters`);
    assert(Object.values(SCOPE).includes(c.scope), `${c.id} has an invalid scope`);
  }
  eq(new Set(CLASS_IDS).size, CLASS_IDS.length, "duplicate class ids");
});

console.log("\nThe completeness check — the point of the whole file\n");

test("a full run reports no failures", () => {
  eq(completenessFailures(CLASS_IDS).length, 0, "a run covering every class must be clean");
});

test("ANTI-VACUITY — omitting VIEWS fails, and the message names the finding it caused", () => {
  const f = completenessFailures(CLASS_IDS.filter((id) => id !== "VIEWS"));
  eq(f.length, 1, "exactly one class is missing");
  assert(/VIEWS was never queried/.test(f[0]), "the missing class must be named");
  assert(/KPLUS-F058/.test(f[0]), "the message must carry the cost of that blind spot, not just the fact of it");
});

test("ANTI-VACUITY — every single class, omitted alone, is detected", () => {
  for (const id of CLASS_IDS) {
    const f = completenessFailures(CLASS_IDS.filter((x) => x !== id));
    eq(f.length, 1, `omitting ${id} was not detected — a class nobody can forget to check is the only safe kind`);
    assert(f[0].startsWith(`${id} was never queried`), `omitting ${id} produced the wrong message: ${f[0]}`);
  }
});

test("an UNDECLARED class that gets queried is also a failure — the model and the run must agree", () => {
  const f = completenessFailures([...CLASS_IDS, "SOMETHING_NEW"]);
  assert(f.some((m) => /SOMETHING_NEW was queried but is not a declared surface class/.test(m)),
    "a run that knows about an object class the model does not is a model that has fallen behind");
});

console.log("\nMEASURED_EMPTY is not NOT_MEASURED\n");

test("an empty result and an absent query render differently", () => {
  const results = Object.fromEntries(CLASS_IDS.map((id) => [id, []]));
  const s = summarize(results);
  assert(s.every((x) => x.status === "MEASURED_EMPTY"), "an empty result is evidence and must say so");
  eq(notMeasured(results).length, 0, "nothing is unmeasured when everything was queried");

  delete results.PUBLICATIONS;
  const s2 = summarize(results);
  eq(s2.find((x) => x.id === "PUBLICATIONS").status, "NOT_MEASURED", "an absent query must NOT read as empty");
  eq(notMeasured(results).length, 1, "the unmeasured class must be reportable on its own");
  // This is the distinction the whole file exists for.
  assert(s2.find((x) => x.id === "SUBSCRIPTIONS").status === "MEASURED_EMPTY",
    "a genuinely empty class must stay distinguishable from the unmeasured one beside it");
});

test("counts are carried, so a class that shrinks is visible as well as one that vanishes", () => {
  const s = summarize({ ...Object.fromEntries(CLASS_IDS.map((id) => [id, []])), VIEWS: [{}, {}] });
  eq(s.find((x) => x.id === "VIEWS").count, 2, "production has two views; a drop to one must be a diff, not a shrug");
  eq(s.find((x) => x.id === "VIEWS").status, "MEASURED", "a non-empty class is MEASURED");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ SURFACE INVENTORY TESTS PASSED\n" : "✗ SURFACE INVENTORY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
