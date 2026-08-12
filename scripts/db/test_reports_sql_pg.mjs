#!/usr/bin/env node
/**
 * Tests for the PostgreSQL projection of the WS10 reports (KPLUS-OP-3).
 *
 * These do NOT test that the SQL runs — only a PostgreSQL server can decide that, and the campaign's
 * workstream D harness plans all six against the migrated target on every run. What is tested here is
 * the thing a server cannot check: that the PORT stayed inside the authorization it was written
 * under. The authorization permits a vocabulary and dialect translation and nothing else, and the
 * failure mode it exists to prevent is a financial semantic quietly changing while the SQL keeps
 * working perfectly.
 *
 * So every assertion below is about restraint rather than about results: no report may pick a side of
 * a split money column, invent a value the target does not carry, introduce a rounding rule, or use
 * an approximate type — and every report must be explicitly ported, explicitly stopped, or explicitly
 * already portable, with no fourth category and no silence.
 */
import { PROTOTYPES, loadReportsModel } from "./reports_sql.mjs";
import { PG_REPORTS, STOPPED, ALREADY_PORTABLE, AMBIGUITY, VOCABULARY, checkCoverage } from "./reports_sql_pg.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log("\nPOSTGRESQL REPORT PROJECTION (KPLUS-OP-3)\n");

test("every report is ported, stopped, or already portable — exactly one", () => {
  const r = checkCoverage();
  assert(r.ok, r.errors.join("; "));
});

test("no ported report picks a side of the prize gross/net split", () => {
  // The reference store has one prize amount and the target has two. Choosing between them decides
  // what a winner is reported as having won, which is a financial decision, not a port.
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    assert(!/gross_amount|net_amount/.test(p.sql), `${id} reads a prize amount column and must therefore be stopped, not ported`);
  }
});

test("no ported report invents a source for legacy_asserted", () => {
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    assert(!/legacy_asserted/i.test(p.sql), `${id} references legacy_asserted, which the target carries no per-entry source for`);
  }
});

test("no ported report still speaks the reference store's minor-unit vocabulary", () => {
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    assert(!/_minor\b/.test(p.sql), `${id} still names a _minor column; the target stores exact numeric`);
  }
});

test("no ported report uses an approximate numeric type for anything", () => {
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    assert(!/\b(real|float4|float8|double precision)\b/i.test(p.sql), `${id} uses an approximate type — money must stay exact`);
  }
});

test("no ported report introduces a rounding rule on money", () => {
  // R-17's trunc() is on a duration in seconds and PRESERVES SQLite's CAST-to-INTEGER truncation;
  // it is the one permitted occurrence and it touches no amount.
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    for (const m of p.sql.matchAll(/\b(round|ceil|ceiling|floor|trunc)\s*\(/gi)) {
      assert(id === "R-17" && m[1].toLowerCase() === "trunc",
        `${id} calls ${m[1]}() — no rounding rule may be introduced by the port`);
    }
  }
});

test("a ported report keeps the grain the report model declares", () => {
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    const original = PROTOTYPES[id];
    assert(original, `${id} has no SQLite prototype to be a projection OF`);
    eq(JSON.stringify(p.grainKey), JSON.stringify(original.grainKey), `${id}: the port changed the report's grain`);
    eq(p.name, original.name, `${id}: the port renamed the report`);
    eq(JSON.stringify(p.params), JSON.stringify(original.params), `${id}: the port changed the report's parameters`);
  }
});

test("a ported report still SELECTs every grain column the model declares", () => {
  // A rename in the target must be aliased back, not passed through: the grain is the report's
  // contract with its callers. R-06's allocation_id is the live case.
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    for (const col of p.grainKey) {
      assert(new RegExp(`\\b${col}\\b`).test(p.sql), `${id}: grain column ${col} does not appear in the ported SQL`);
    }
  }
});

test("every stopped report names an ambiguity that is actually defined", () => {
  for (const [id, classes] of Object.entries(STOPPED)) {
    assert(classes.length > 0, `${id} is stopped for no stated reason`);
    for (const c of classes) {
      assert(AMBIGUITY[c], `${id} is stopped on undefined ambiguity ${c}`);
      assert(AMBIGUITY[c].needs && AMBIGUITY[c].needs.length > 40,
        `${c} does not state what operator input would resolve it — an unresolvable stop is indistinguishable from an abandoned one`);
    }
  }
});

test("a stopped report carries no SQL, so it cannot be run by accident", () => {
  for (const id of Object.keys(STOPPED)) {
    assert(!PG_REPORTS[id], `${id} is stopped but also has ported SQL — one of the two is a mistake`);
  }
});

test("every stopped report is genuinely blocked by what it is stopped on", () => {
  // A stop must be earned. If the original prototype never touches the ambiguous thing, stopping it
  // is over-caution that hides a report nobody needs to wait for.
  for (const [id, classes] of Object.entries(STOPPED)) {
    const sql = PROTOTYPES[id].sql;
    for (const c of classes) {
      if (c === "LEGACY_ASSERTED_HAS_NO_ENTRY_LEVEL_SOURCE") {
        assert(/legacy_asserted/.test(sql), `${id} is stopped on legacy_asserted but never reads it`);
      }
      if (c === "PRIZE_AMOUNT_IS_SPLIT_GROSS_AND_NET") {
        assert(/prize_allocations/.test(sql), `${id} is stopped on the prize split but never reads prize_allocations`);
      }
    }
  }
});

test("no report that reads an ambiguous value escaped the stop list", () => {
  // The other direction, which is the one that would cause harm: a report that touches the ambiguity
  // and got ported anyway.
  const ids = [...loadReportsModel().reports.map((r) => r.id), "R-13b"];
  for (const id of ids) {
    if (STOPPED[id]) continue;
    const sql = PROTOTYPES[id].sql;
    assert(!/legacy_asserted/.test(sql), `${id} reads legacy_asserted but is not stopped`);
    assert(!/prize_allocations/.test(sql), `${id} reads prize_allocations but is not stopped`);
  }
});

test("the SQLite prototypes were not modified by the port", () => {
  // The financial parity gate runs against them. If the port had edited them in place, that gate
  // would have lost its subject at the moment it was most needed.
  for (const [id, p] of Object.entries(PG_REPORTS)) {
    assert(PROTOTYPES[id].sql !== p.sql, `${id}: the projection is identical to the prototype, which means one of them is not what it claims`);
    assert(/_minor\b/.test(PROTOTYPES[id].sql) || id === "R-17",
      `${id}: the SQLite prototype no longer speaks minor units — it appears to have been edited by the port`);
  }
});

test("the vocabulary map explains every rename the port relies on", () => {
  assert(VOCABULARY.length >= 5, "the vocabulary map is the reviewable artefact of this port; it cannot be near-empty");
  for (const [from, to, why] of VOCABULARY) {
    assert(from && to && why && why.length > 10, `vocabulary entry ${from} has no stated reason`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ POSTGRESQL REPORT PROJECTION TESTS PASSED\n" : "✗ POSTGRESQL REPORT PROJECTION TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
