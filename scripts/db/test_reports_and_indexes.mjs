#!/usr/bin/env node
/**
 * Tests for the report model and derived index strategy (Workstreams G and V).
 *
 * The redundancy detector currently finds NOTHING in the real model, because the two redundancies it
 * found were resolved at the source. A detector that reports zero is indistinguishable from a detector
 * that cannot report — so it is tested against a synthetic model that deliberately contains a
 * left-prefix pair. Every validator rule likewise gets a synthetic violation.
 */

import { loadReports, validateReports, deriveIndexStrategy, parseIndexSpec, RLS_ROLES } from "./reports_and_indexes.mjs";
import { loadModel } from "./validate_target_model.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const reports = loadReports();
const model = loadModel();

/** A minimal synthetic model so validator tests do not depend on the real one's shape. */
const synthModel = {
  entities: [{
    name: "t", schema: "bolao", domain: "core", purpose: "p", migrationPhase: "M1", rlsIntent: "operator",
    columns: [{ sql: "id", type: "uuid", pk: true, mutable: false }, { sql: "a", type: "text" }, { sql: "b", type: "text" }],
    indexes: [],
  }],
};
const okReport = () => ({
  id: "X-01", name: "x", question: "q?", grain: "one row per t", dimensions: ["a"], measures: ["m"],
  joins: ["t"], filters: ["a = :a"], piiExposure: "NONE", rlsRoles: ["operator"], rlsNotes: "operator",
  indexes: ["t(a)"], materialization: "QUERY", refresh: "n/a", notes: "n",
});
const errsFor = (mutate, m = synthModel) => {
  const r = okReport(); mutate(r);
  return validateReports({ reports: [r] }, m).errors;
};

console.log("\nReport model — the real model must be valid\n");

test("the real report model validates with no errors", () => {
  const { errors } = validateReports(reports, model);
  eq(errors.length, 0, `errors:\n      ${errors.join("\n      ")}`);
});

test("all 17 required reports are present", () => {
  assert(reports.reports.length >= 17, `expected at least 17 reports, got ${reports.reports.length}`);
  const names = reports.reports.map((r) => r.name);
  for (const required of ["participant_history", "pool_participation", "competition_history", "multiple_entries",
    "payment_history", "payment_allocations", "unpaid_balances", "partial_balances", "overpayments",
    "prizes_and_winnings", "participant_net_position", "competition_performance", "ranking_history",
    "year_over_year_participation", "pool_financial_reconciliation", "audit_history", "operational_health"]) {
    assert(names.includes(required), `missing required report: ${required}`);
  }
});

test("report ids are unique", () => {
  const ids = reports.reports.map((r) => r.id);
  eq(new Set(ids).size, ids.length, "duplicate report id");
});

test("every money report is per-currency, never a single cross-currency total", () => {
  /**
   * Reads the DECLARED `monetaryMeasures`, not the measure names.
   *
   * The keyword version of this check matched `total_points` and `entries_total` and demanded a
   * currency dimension on three points-based reports — and I propagated that spurious dimension into
   * the model before catching it. No regex over English measure names can tell money from points, so
   * the classification is declared and reviewable instead of inferred.
   */
  for (const r of reports.reports) {
    if (!r.monetaryMeasures || r.monetaryMeasures.length === 0) continue;
    const perCurrency = /currency/i.test(r.grain) || r.dimensions.includes("currency");
    assert(perCurrency,
      `${r.id} ${r.name} aggregates money (${r.monetaryMeasures.join(", ")}) without currency in its grain or dimensions`);
  }
});

test("monetaryMeasures is declared on every report and references real measures", () => {
  for (const r of reports.reports) {
    assert(Array.isArray(r.monetaryMeasures),
      `${r.id} has no monetaryMeasures declaration — an undeclared report would silently skip the currency check`);
    for (const m of r.monetaryMeasures) {
      assert(r.measures.includes(m), `${r.id}: monetaryMeasures names "${m}", which is not one of its measures`);
    }
  }
});

test("points and counts are NOT classified as money", () => {
  for (const r of reports.reports) {
    for (const m of r.monetaryMeasures || []) {
      // Anchored on whole words. The loose version flagged `net_cash_position`, where "position"
      // means a FINANCIAL position — the opposite of what the check is looking for.
      assert(!/(^|_)(points?|count|rank|attempts|seconds)($|_)|(^|_)(final|rank)_position($|_)/i.test(m),
        `${r.id}: "${m}" is classified as money but looks like a score, count or duration`);
    }
  }
});

test("every FINANCIAL or CONTACT report is operator-gated", () => {
  for (const r of reports.reports) {
    if (!["FINANCIAL", "CONTACT"].includes(r.piiExposure)) continue;
    assert(r.rlsRoles.includes("operator"), `${r.id} exposes ${r.piiExposure} without an operator role`);
    assert(!r.rlsRoles.includes("anon"), `${r.id} exposes ${r.piiExposure} to anon`);
  }
});

test("every MATVIEW declares refresh behaviour", () => {
  for (const r of reports.reports.filter((x) => x.materialization === "MATVIEW")) {
    assert(r.refresh && r.refresh !== "n/a", `${r.id} is a MATVIEW with no refresh story — stale results read as wrong results`);
  }
});

console.log("\nValidator — each rule must fire on a synthetic violation\n");

test("a missing required field is reported", () => {
  assert(errsFor((r) => { delete r.grain; }).some((e) => /missing "grain"/.test(e)), "missing grain not reported");
});

test("an unknown PII class is reported", () => {
  assert(errsFor((r) => { r.piiExposure = "SECRET"; }).some((e) => /piiExposure/.test(e)), "not reported");
});

test("a MATVIEW without refresh is reported", () => {
  assert(errsFor((r) => { r.materialization = "MATVIEW"; r.refresh = "n/a"; }).some((e) => /MATVIEW with no refresh/.test(e)), "not reported");
});

test("anon reading a non-NONE report is reported", () => {
  assert(errsFor((r) => { r.piiExposure = "CONTACT"; r.rlsRoles = ["anon", "operator"]; }).some((e) => /anon may read/.test(e)), "not reported");
});

test("a FINANCIAL report without an operator role is reported", () => {
  assert(errsFor((r) => { r.piiExposure = "FINANCIAL"; r.rlsRoles = ["service"]; }).some((e) => /operator-gated/.test(e)), "not reported");
});

test("authenticated reading a FINANCIAL report is reported", () => {
  assert(errsFor((r) => { r.piiExposure = "FINANCIAL"; r.rlsRoles = ["operator", "authenticated"]; })
    .some((e) => /server-mediated/.test(e)), "financial reads must be server-mediated");
});

test("an unknown role is reported", () => {
  assert(errsFor((r) => { r.rlsRoles = ["superuser"]; }).some((e) => /unknown rls role/.test(e)), "not reported");
});

test("rlsNotes is never pattern-matched for access control", () => {
  // R-05's note reads "never exposed to anon". The prose version of this check concluded the opposite.
  const e = errsFor((r) => { r.rlsNotes = "operator ONLY — never exposed to anon or authenticated"; r.piiExposure = "FINANCIAL"; });
  eq(e.length, 0, `prose in rlsNotes triggered a finding: ${e.join("; ")}`);
});

test("reading a stored settlement flag is reported", () => {
  assert(errsFor((r) => { r.measures = ["settlement_status"]; r.notes = "reads the stored flag"; })
    .some((e) => /stored settlement|always derived/.test(e)), "not reported");
});

test("a derived settlement measure is accepted", () => {
  eq(errsFor((r) => { r.measures = ["settlement_status_derived"]; }).length, 0, "derived settlement must be fine");
});

test("an index on an unknown table or column is reported", () => {
  assert(errsFor((r) => { r.indexes = ["nosuch(a)"]; }).some((e) => /unknown table/.test(e)), "unknown table");
  assert(errsFor((r) => { r.indexes = ["t(zzz)"]; }).some((e) => /unknown column/.test(e)), "unknown column");
});

test("a malformed index spec is reported", () => {
  assert(errsFor((r) => { r.indexes = ["t a b"]; }).some((e) => /not of the form/.test(e)), "not reported");
});

test("parseIndexSpec handles single and composite specs and rejects junk", () => {
  eq(JSON.stringify(parseIndexSpec("t(a)")), JSON.stringify({ table: "t", cols: ["a"] }), "single");
  eq(JSON.stringify(parseIndexSpec("t(a, b)")), JSON.stringify({ table: "t", cols: ["a", "b"] }), "composite");
  eq(parseIndexSpec("garbage"), null, "junk");
});

console.log("\nIndex derivation (V)\n");

test("every proposed index traces to at least one report workload", () => {
  const s = deriveIndexStrategy(reports, model);
  const orphans = s.proposals.filter((p) => p.workloads.length === 0);
  eq(orphans.length, 0, "an index with no workload is write cost with no owner");
});

test("the real model currently has zero redundant proposals", () => {
  eq(deriveIndexStrategy(reports, model).redundant.length, 0,
    "the two left-prefix redundancies were resolved at the source; a regression here means one came back");
});

test("the redundancy detector is NOT vacuous — it fires on a synthetic prefix pair", () => {
  const synthReports = {
    reports: [
      { ...okReport(), id: "Y-01", indexes: ["t(a)"] },
      { ...okReport(), id: "Y-02", indexes: ["t(a, b)"] },
    ],
  };
  const s = deriveIndexStrategy(synthReports, synthModel);
  eq(s.redundant.length, 1, "a narrow index that is a left prefix of a wider one must be flagged");
  eq(s.redundant[0].drop, "t(a)", "the NARROW index is the one to drop");
  eq(s.redundant[0].keep, "t(a, b)", "the wider index is kept");
});

test("a non-prefix pair on the same table is NOT flagged", () => {
  const synthReports = { reports: [{ ...okReport(), id: "Y-03", indexes: ["t(a)"] }, { ...okReport(), id: "Y-04", indexes: ["t(b, a)"] }] };
  eq(deriveIndexStrategy(synthReports, synthModel).redundant.length, 0,
    "t(a) is not a left prefix of t(b, a) — flagging it would drop an index PostgreSQL cannot substitute");
});

test("same columns on DIFFERENT tables are not confused", () => {
  const m2 = { entities: [synthModel.entities[0], { ...synthModel.entities[0], name: "u" }] };
  const synthReports = { reports: [{ ...okReport(), id: "Y-05", indexes: ["t(a)"] }, { ...okReport(), id: "Y-06", indexes: ["u(a, b)"] }] };
  eq(deriveIndexStrategy(synthReports, m2).redundant.length, 0, "cross-table prefix matching would be nonsense");
});

test("write cost is classified, and hot tables cost more than cold ones", () => {
  const s = deriveIndexStrategy(reports, model);
  const hot = s.proposals.find((p) => p.table === "predictions");
  const cold = s.proposals.find((p) => p.table === "competition_editions");
  assert(hot && /MODERATE/.test(hot.writeCost), "a hot table's index must be classified above LOW");
  assert(cold && /^LOW/.test(cold.writeCost), "a cold table's index should be LOW");
});

test("drift is reported in both directions", () => {
  const s = deriveIndexStrategy(reports, model);
  assert(Array.isArray(s.inReportsNotModel) && Array.isArray(s.inModelNotReports),
    "one-directional drift detection would hide unowned model indexes");
});

test("every proposal states ordering guidance and a rationale", () => {
  const bad = deriveIndexStrategy(reports, model).proposals.filter((p) => !p.ordering || !p.rationale || !p.writeCost);
  eq(bad.length, 0, "an index proposal without rationale cannot be reviewed");
});

test("RLS_ROLES is a closed vocabulary", () => {
  eq(JSON.stringify(RLS_ROLES), JSON.stringify(["anon", "authenticated", "operator", "service"]), "role vocabulary changed");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ REPORT/INDEX TESTS PASSED\n" : "✗ REPORT/INDEX TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
