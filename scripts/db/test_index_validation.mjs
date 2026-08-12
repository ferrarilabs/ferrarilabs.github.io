#!/usr/bin/env node
/**
 * WS11 tests — index validation against the real query prototypes.
 *
 * The governing rule: no speculative index. Every candidate must trace to a report that really runs,
 * or to a constraint it enforces. A candidate justified by neither is a guess, and this suite fails
 * on it rather than letting it into a draft migration.
 */

import { readFileSync } from "node:fs";
import {
  CANDIDATES, CLASS, WRITE_COST, WRITE_SENSITIVE, detectRedundancy, comparePlans,
  candidateIsUsable, candidateDdl, feedbackToDrafts, checkModelAlignment, summary, explain,
} from "./index_validation.mjs";
import { PROTOTYPES } from "./reports_sql.mjs";
import { buildDatabase } from "./report_fixtures.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const byId = Object.fromEntries(CANDIDATES.map((c) => [c.id, c]));

// =============================================================================================
console.log("\nWS11.1 — every candidate traces to a real workload\n");
// =============================================================================================

test("every candidate declares a table, columns, predicate, cardinality, class, write cost and reason", () => {
  for (const c of CANDIDATES) {
    for (const k of ["id", "table", "cols", "predicate", "cardinality", "klass", "writeCost", "why"]) {
      assert(c[k], `${c.id || "?"} missing ${k}`);
    }
    assert(Array.isArray(c.cols) && c.cols.length, `${c.id} has no columns`);
    assert(c.why.length > 40, `${c.id}: the reason is too short to be reviewable`);
  }
});

test("no candidate exists without either a report workload or a constraint it enforces", () => {
  for (const c of CANDIDATES) {
    const hasWorkload = (c.reports || []).length > 0;
    const isConstraint = c.klass === CLASS.REQUIRED_FOR_CONSTRAINT;
    const isRejected = [CLASS.DEFER, CLASS.REDUNDANT, CLASS.REMOVE_FROM_DRAFT].includes(c.klass);
    assert(hasWorkload || isConstraint || isRejected,
      `${c.id} is proposed with no identified workload and no constraint — that is a speculative index`);
  }
});

test("every report named by a candidate is a real prototype", () => {
  for (const c of CANDIDATES) for (const r of c.reports || []) {
    assert(PROTOTYPES[r], `${c.id} names report ${r}, which has no prototype`);
  }
});

test("every candidate's columns exist in the executable schema", () => {
  const db = buildDatabase();
  for (const c of CANDIDATES) {
    const cols = db.prepare(`SELECT * FROM pragma_table_info('${c.table}')`).all().map((r) => r.name);
    assert(cols.length > 0, `${c.id}: table ${c.table} does not exist`);
    for (const col of c.cols) {
      assert(cols.includes(col), `${c.id}: ${c.table}.${col} does not exist — the index map would be fiction`);
    }
  }
});

test("every candidate is actually creatable and usable by the planner", () => {
  for (const c of CANDIDATES) {
    const u = candidateIsUsable(c);
    assert(u.usable, `${c.id} cannot be used even in the best case: ${JSON.stringify(u.plan)}`);
  }
});

test("a composite index leads with its equality column", () => {
  // IX-01 is (participant_id, pool_id) because participant_id is the equality in R-01. Reversing it
  // would make the index unusable for that lookup, which is the most common composite-index mistake.
  eq(byId["IX-01"].cols[0], "participant_id", "the equality column must lead");
  eq(byId["IX-13"].cols[0], "pool_id", "IX-13 must lead with the equality, not the timestamp");
});

test("NEGATIVE: a composite with the wrong leading column is detectably unusable", () => {
  const reversed = { ...byId["IX-01"], id: "IX-BAD", cols: ["pool_id", "participant_id"] };
  const db = buildDatabase({ indexes: [{ sql: candidateDdl(reversed) }] });
  const plan = explain(db, "SELECT 1 FROM pool_entries WHERE participant_id = 'pa'");
  // With pool_id leading, an equality on participant_id alone cannot drive an index seek.
  assert(!plan.some((l) => /SEARCH.*ix_pool_entries_pool_id_participant_id/.test(l)),
    "a reversed composite should not serve an equality on its second column");
});

// =============================================================================================
console.log("\nWS11.2 — classification\n");
// =============================================================================================

test("every class in use is a declared constant, and every class is exercised", () => {
  const used = new Set(CANDIDATES.map((c) => c.klass));
  for (const c of CANDIDATES) assert(Object.values(CLASS).includes(c.klass), `${c.id} unknown class ${c.klass}`);
  for (const k of Object.values(CLASS)) {
    assert(used.has(k), `class ${k} is declared but no candidate uses it — an unused classification is decoration`);
  }
});

test("the constraint-backed indexes are the ones WS13's controls actually depend on", () => {
  const required = CANDIDATES.filter((c) => c.klass === CLASS.REQUIRED_FOR_CONSTRAINT).map((c) => c.id);
  assert(required.includes("IX-05"), "the unique payment reference index enforces idempotency");
  assert(required.includes("IX-11"), "the unique (pool_entry_id, match_id) index prevents a duplicated prediction");
  assert(required.includes("IX-04"), "allocatePayment sums sibling allocations under a row lock");
  for (const id of required) {
    assert(/constraint|idempotency|unique|impossible|FOR UPDATE|lock/i.test(byId[id].why),
      `${id} is REQUIRED_FOR_CONSTRAINT but its reason does not name the constraint`);
  }
});

test("a REQUIRED_FOR_CONSTRAINT index is never downgraded for lack of a reading report", () => {
  const ix05 = byId["IX-05"];
  eq(ix05.reports.length, 0, "IX-05 has no reading report");
  eq(ix05.klass, CLASS.REQUIRED_FOR_CONSTRAINT, "and must still be required — it IS the control");
});

test("every DEFER and REMOVE_FROM_DRAFT candidate says what would change the decision", () => {
  for (const c of CANDIDATES.filter((x) => [CLASS.DEFER, CLASS.REMOVE_FROM_DRAFT].includes(x.klass))) {
    assert(/becomes|revisit|when|never|does not apply|no planner/i.test(c.why),
      `${c.id} is deferred or removed with no statement of what would change the decision`);
  }
});

// =============================================================================================
console.log("\nWS11.3 — redundancy\n");
// =============================================================================================

test("prefix overlap is detected", () => {
  const f = detectRedundancy();
  const prefix = f.filter((x) => x.kind === "PREFIX_OVERLAP");
  assert(prefix.length >= 1, "the (pool_id, computed_at) / (pool_id, computed_at, position) overlap must be found");
  assert(prefix.some((x) => x.shorter === "IX-13" && x.longer === "IX-14"), `got ${JSON.stringify(prefix)}`);
});

test("NEGATIVE: an injected duplicate index is detected", () => {
  const dup = [...CANDIDATES, { ...byId["IX-03"], id: "IX-DUP" }];
  const f = detectRedundancy(dup);
  assert(f.some((x) => x.kind === "DUPLICATE"), "an identical column list must be reported");
});

test("a unique index already satisfying a lookup makes a separate index redundant", () => {
  // IX-14 is the genuine case: (pool_id, computed_at) is a leading subset of
  // (pool_id, computed_at, position), so keeping both pays two write costs for one read benefit.
  eq(byId["IX-14"].klass, CLASS.REDUNDANT, "a prefix overlap is redundant");
  eq(byId["IX-14"].redundantWith, "IX-13", "and must name what it duplicates");
});

test("a partial unique index does NOT make an unconditional index redundant (IX-12 correction)", () => {
  // This test exists because the opposite was asserted here, wrongly. IX-12 was classified REDUNDANT
  // "with the primary key" on the basis of the SQLite fixture, which had made match_id the PK. The
  // target model gives match_results a surrogate key and models supersession, so match_id is an
  // ordinary FK and the partial unique on it covers only the current official row.
  eq(byId["IX-12"].klass, CLASS.LIKELY_USEFUL, "an unconditional lookup is not served by a partial index");
  assert(byId["IX-12"].correctionNote, "a reversed classification must record that it was reversed, and why");
  assert(/PREVIOUSLY CLASSIFIED REDUNDANT/.test(byId["IX-12"].correctionNote), "the correction must be explicit");
  assert(!byId["IX-12"].redundantWith, "it must no longer claim to duplicate anything");
});

test("the fixture that caused the IX-12 error now matches the target model", () => {
  const db = buildDatabase();
  const cols = db.prepare("SELECT * FROM pragma_table_info('match_results')").all();
  const pk = cols.filter((c) => c.pk).map((c) => c.name);
  eq(pk.join(","), "match_result_id", "match_results must have a surrogate primary key, as the model declares");
  for (const c of ["match_id", "is_official", "superseded_by_id"]) {
    assert(cols.some((x) => x.name === c), `match_results.${c} is required to represent a corrected result`);
  }
});

test("a superseded index is named rather than silently dropped", () => {
  assert(byId["IX-11"].supersedes.includes("predictions(pool_entry_id)"),
    "the unique composite supersedes the single-column index the model declared");
});

test("every REDUNDANT candidate names the index it duplicates", () => {
  const f = detectRedundancy();
  assert(!f.some((x) => x.kind === "UNEXPLAINED_REDUNDANCY"), `unexplained redundancy: ${JSON.stringify(f)}`);
  for (const c of CANDIDATES.filter((x) => x.klass === CLASS.REDUNDANT)) {
    assert(c.redundantWith, `${c.id} is REDUNDANT with nothing named`);
  }
});

test("the prefix-overlap pair states which one to keep", () => {
  assert(/keep exactly one/i.test(byId["IX-14"].resolution || ""),
    "a detected overlap must resolve to a decision, not just a warning");
});

// =============================================================================================
console.log("\nWS11.4 — write cost\n");
// =============================================================================================

test("every candidate has a qualitative write cost", () => {
  for (const c of CANDIDATES) assert(Object.values(WRITE_COST).includes(c.writeCost), `${c.id} write cost`);
});

test("write-sensitive tables are named with a reason", () => {
  for (const [t, why] of Object.entries(WRITE_SENSITIVE)) assert(why.length > 30, `${t} has no usable reason`);
  for (const t of ["payments", "predictions", "outbox_events"]) {
    assert(WRITE_SENSITIVE[t], `${t} must be declared write-sensitive`);
  }
});

test("no candidate on a write-sensitive table is LOW cost", () => {
  for (const c of CANDIDATES) {
    if (!WRITE_SENSITIVE[c.table]) continue;
    assert(c.writeCost !== WRITE_COST.LOW,
      `${c.id} is on ${c.table}, which is write-sensitive, and claims LOW cost — that understates what every index there costs`);
  }
});

test("every HIGH write-cost index is either constraint-backed or justified against the cost", () => {
  for (const c of CANDIDATES.filter((x) => x.writeCost === WRITE_COST.HIGH)) {
    const ok = c.klass === CLASS.REQUIRED_FOR_CONSTRAINT || c.klass === CLASS.DEFER ||
      /accepted|hot path|affordable|partial|append-only|dense/i.test(c.why);
    assert(ok, `${c.id} is HIGH write cost with no argument that the read benefit outweighs it`);
  }
});

test("the payments, predictions and outbox indexes are counted, not multiplied", () => {
  const per = {};
  for (const c of CANDIDATES) {
    if (![CLASS.REQUIRED_FOR_CONSTRAINT, CLASS.HIGH_VALUE, CLASS.LIKELY_USEFUL].includes(c.klass)) continue;
    per[c.table] = (per[c.table] || 0) + 1;
  }
  assert((per.payments || 0) <= 3, `payments would carry ${per.payments} indexes — over-indexing the money table`);
  assert((per.predictions || 0) <= 1, `predictions would carry ${per.predictions} indexes`);
  assert((per.outbox_events || 0) <= 1, `outbox_events would carry ${per.outbox_events} indexes`);
});

// =============================================================================================
console.log("\nWS11.5 — synthetic EXPLAIN comparison, plan SHAPE only\n");
// =============================================================================================

const plans = comparePlans();

test("every report's plan is obtainable with and without the candidate indexes", () => {
  eq(plans.length, Object.keys(PROTOTYPES).length, "plan count");
  for (const p of plans) {
    assert(!p.before.some((l) => /^ERROR/.test(l)), `${p.report} plan failed without indexes: ${p.before[0]}`);
    assert(!p.after.some((l) => /^ERROR/.test(l)), `${p.report} plan failed with indexes: ${p.after[0]}`);
  }
});

test("at least one report's plan shape genuinely improves", () => {
  const improved = plans.filter((p) => p.improved).map((p) => p.report);
  assert(improved.length > 0, "no plan changed at all — the candidates would be indistinguishable from none");
  // Recorded rather than asserted per-report: at 12 fixture rows the planner is right to ignore most
  // indexes, so a report showing no change is expected and is not a finding.
  assert(improved.includes("R-05"), `R-05's payer and paid_at access should change shape; improved: ${improved}`);
});

test("no plan gets WORSE with the candidate indexes present", () => {
  for (const p of plans) {
    assert(p.scansAfter <= p.scansBefore,
      `${p.report} gained a scan (${p.scansBefore} → ${p.scansAfter}) — an index made the plan worse`);
    assert(p.sortsAfter <= p.sortsBefore, `${p.report} gained a sort (${p.sortsBefore} → ${p.sortsAfter})`);
  }
});

test("no timing is recorded anywhere in the plan evidence", () => {
  for (const p of plans) {
    for (const k of Object.keys(p)) {
      assert(!/ms|time|duration|elapsed/i.test(k), `${p.report} records ${k} — a timing from a 12-row table reads as a benchmark`);
    }
  }
});

test("the module states plainly that SQLite plans are not PostgreSQL evidence", () => {
  const src = new URL("./index_validation.mjs", import.meta.url);
  const text = readFileSync(src, "utf8");
  assert(/NOT evidence about PostgreSQL/.test(text), "the limitation must be stated in the module");
  assert(/never promoted to REQUIRED on the strength of a plan/.test(text), "the rule must be stated");
});

// =============================================================================================
console.log("\nWS11.6 — feedback into the draft artefacts\n");
// =============================================================================================

test("the feedback keeps only the classes worth creating", () => {
  const f = feedbackToDrafts();
  const keptIds = f.createConcurrently.map((x) => x.id);
  for (const c of CANDIDATES) {
    const shouldKeep = [CLASS.REQUIRED_FOR_CONSTRAINT, CLASS.HIGH_VALUE, CLASS.LIKELY_USEFUL].includes(c.klass);
    eq(keptIds.includes(c.id), shouldKeep, `${c.id} (${c.klass}) kept=${keptIds.includes(c.id)}`);
  }
});

test("every generated DDL uses CONCURRENTLY", () => {
  for (const x of feedbackToDrafts().createConcurrently) {
    assert(/CREATE (UNIQUE )?INDEX CONCURRENTLY/.test(x.ddl), `${x.id} is not concurrent: ${x.ddl}`);
  }
});

test("the feedback carries the invalid-index warning, which is easy to miss", () => {
  const notes = feedbackToDrafts().notes.join(" ");
  assert(/indisvalid/.test(notes), "a failed concurrent build leaves an INVALID index that is still maintained on writes");
  assert(/no index in this list has been created/i.test(notes), "the draft-only status must be stated");
  assert(/QUALITATIVE|no production measurement/i.test(notes), "write costs must not be presented as measured");
});

test("removed and deferred candidates are reported with their reasons, not dropped silently", () => {
  const f = feedbackToDrafts();
  eq(f.removeFromDraft.length, CANDIDATES.filter((c) => [CLASS.REDUNDANT, CLASS.REMOVE_FROM_DRAFT].includes(c.klass)).length, "removed count");
  for (const x of f.removeFromDraft) assert(x.why, `${x.id} removed with no reason`);
  for (const x of f.deferred) assert(x.why, `${x.id} deferred with no reason`);
});

test("the generated DDL targets the bolao schema, not the fixture schema", () => {
  for (const x of feedbackToDrafts().createConcurrently) {
    assert(/ON bolao\./.test(x.ddl), `${x.id} does not target the real schema: ${x.ddl}`);
  }
});

// =============================================================================================
console.log("\nAlignment with the declared model, and the summary\n");
// =============================================================================================

test("every index declared in model/reports.json is accounted for", () => {
  const a = checkModelAlignment();
  eq(a.missing.length, 0, `declared but unaccounted for: ${JSON.stringify(a.missing)}`);
  assert(a.declared >= 18, "the model should declare at least eighteen indexes");
});

test("indexes WS11 added beyond the model are attributed", () => {
  const a = checkModelAlignment();
  assert(a.extra.length > 0, "WS11 should find at least one access path the report model missed");
  for (const e of a.extra) assert(e.discoveredBy, `${e.id} was added with no attribution`);
  assert(a.extra.some((e) => e.id === "IX-23"),
    "the canonical-identity index is used by five reports and is absent from the model's declared list");
});

test("the summary reports every dimension WS11 must answer", () => {
  const s = summary();
  eq(s.total, CANDIDATES.length, "total");
  for (const k of Object.values(CLASS)) assert(s.byClass[k], `class ${k} missing from the summary`);
  assert(s.highWriteCost.length > 0, "high write-cost indexes must be listed");
  assert(s.writeSensitiveTablesTouched.length > 0, "write-sensitive tables must be listed");
});

test("the counts add up: reviewed = required + high + likely + deferred + redundant + removed", () => {
  const s = summary();
  const total = Object.values(s.byClass).reduce((n, ids) => n + ids.length, 0);
  eq(total, CANDIDATES.length, "every candidate must fall in exactly one class");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ INDEX VALIDATION TESTS PASSED\n" : "✗ INDEX VALIDATION TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
