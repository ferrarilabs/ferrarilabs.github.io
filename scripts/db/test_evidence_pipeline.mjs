#!/usr/bin/env node
/**
 * Integrated evidence pipeline tests, and the WS5 gate integration.
 *
 * The point of this suite is the LAST section: WS5's AGGREGATE_PARITY and FINANCIAL_PARITY gates now
 * have real producers, and each gate must be shown able to HOLD or BLOCK on evidence the producers
 * actually generate. A gate wired to a producer that can only ever say "clean" is no better than the
 * unwired gate it replaced.
 */

import { runPipeline, evaluateWithEvidence, LEGACY_STATE, STAGE_STATUS } from "./evidence_pipeline.mjs";
import { buildDatabase } from "./report_fixtures.mjs";
import { aggregateParity, financialParityFromDb, promotionEvidence } from "./parity_producers.mjs";
import { evaluateParity, evaluatePromotion, evaluateObservationWindow } from "./choreography.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const byStage = (p) => Object.fromEntries(p.stages.map((s) => [s.stage, s]));

// =============================================================================================
console.log("\nThe integrated flow runs end to end\n");
// =============================================================================================

const P = runPipeline();

test("every stage runs and passes", () => {
  assert(P.ok, `failed stages: ${JSON.stringify(P.failed)}`);
  eq(P.stages.length, 11, "stage count");
  for (const s of P.stages) eq(s.status, STAGE_STATUS.PASS, `${s.stage}`);
});

test("the flow covers every stage the brief requires, in order", () => {
  const names = P.stages.map((s) => s.stage);
  for (const n of ["choreography_model", "identity_candidates", "financial_invariants", "report_queries",
    "aggregate_parity", "financial_parity", "index_validation", "authorization_surfaces",
    "write_contract_posture", "scoring_parity", "scoring_parity_canonical"]) {
    assert(names.includes(n), `stage ${n} missing`);
  }
  assert(names.indexOf("aggregate_parity") > names.indexOf("report_queries"),
    "aggregate parity must follow the report queries it is computed from");
  assert(names.indexOf("index_validation") > names.indexOf("report_queries"),
    "index validation must follow the queries it validates against");
});

test("no stage reports success by skipping", () => {
  for (const s of P.stages) {
    assert(s.status !== STAGE_STATUS.UNAVAILABLE, `${s.stage} was unavailable and would have been silently skipped`);
  }
});

test("the identity stage produces candidates and none is auto-mergeable", () => {
  const s = byStage(P).identity_candidates;
  eq(s.autoMergeableCount, 0, "no candidate may be auto-mergeable");
  assert(s.candidateCount >= 1, "the fixture has a merged identity, so at least one candidate is expected");
});

test("the scoring stage proves ranking order is representation-independent", () => {
  const s = byStage(P).scoring_parity;
  eq(s.rankingOrderStable, true, "the ranking depended on input order");
  eq(s.inputDifferences.length, 0, `prediction inputs diverge: ${JSON.stringify(s.inputDifferences)}`);
});

test("stages whose scope is narrower than their name say so", () => {
  const auth = byStage(P).authorization_surfaces;
  const wc = byStage(P).write_contract_posture;
  assert(/Live RLS enforcement is verified by WS12/.test(auth.scope),
    "a local SQLite run has no policies and must not imply it tested any");
  assert(/verified by WS13's suite, not by this pipeline/.test(wc.scope), "the write-contract scope must be stated");
  const ix = byStage(P).index_validation;
  assert(/not PostgreSQL performance/.test(ix.planEvidenceCaveat), "the plan caveat must travel with the evidence");
});

test("the bundle records what it did not do", () => {
  assert(P.scopeNotes.some((n) => /no production system was contacted/.test(n)), "production scope");
  assert(P.scopeNotes.some((n) => /shape-only/.test(n)), "plan scope");
  assert(P.scopeNotes.some((n) => /covers all three competitions/.test(n)),
    "the scoring scope must travel with the bundle");
});

// =============================================================================================
console.log("\nWS5 gate integration — AGGREGATE_PARITY and FINANCIAL_PARITY now have producers\n");
// =============================================================================================

test("the pipeline emits parityResults in exactly the shape the evaluator consumes", () => {
  for (const cls of ["ROW_COUNT_PARITY", "KEY_PARITY", "VALUE_PARITY", "AGGREGATE_PARITY", "FINANCIAL_PARITY"]) {
    const v = P.parityResults[cls];
    assert(v, `${cls} missing`);
    assert(typeof v.checked === "number" && v.checked > 0, `${cls}.checked must be a positive number, got ${v.checked}`);
    eq(typeof v.mismatches, "number", `${cls}.mismatches`);
  }
});

test("a financial domain's parity now evaluates against real evidence rather than absent evidence", () => {
  const r = evaluateParity("payments", P.parityResults);
  eq(r.missing.length, 0, `payments still has missing parity classes: ${r.missing}`);
  eq(r.vacuous.length, 0, `vacuous classes: ${r.vacuous}`);
  eq(r.verdict, "PASS", `verdict: ${JSON.stringify(r)}`);
});

test("a scoring domain now has real SCORING_PARITY evidence (Batch H)", () => {
  const r = evaluateParity("predictions", P.parityResults);
  eq(r.missing.length, 0, `SCORING_PARITY is now produced and must not be reported missing: ${r.missing}`);
  eq(r.vacuous.length, 0, "the producer examined real scenarios");
  eq(r.verdict, "PASS", `verdict: ${JSON.stringify(r)}`);
});

test("the scoring evidence is produced by the canonical engines and declares its scope", () => {
  const s = byStage(P).scoring_parity_canonical;
  assert(/own scoring engines/.test(s.authority), "the authority must be named");
  assert(/reimplements/.test(s.authority), "it must state that nothing is reimplemented");
  eq(s.mismatches, 0, "the scoped run must be exact");
  assert(s.scenarios >= 29, `too few scenarios exercised: ${s.scenarios}`);
  eq(s.exitStatus, 0, "the producer must exit zero");
  eq(Object.keys(s.excluded).length, 0, "no competition may remain excluded");
  assert(s.closedGaps && /DDL-M11/.test(s.closedGaps["BATCH-H-F1"]),
    "the closed gap must cite what closed it, so a future reader can tell an absence of exclusions from an absence of checking");
  eq(s.declaredScope.length, 3, "all three competitions must be in scope");
  for (const app of s.declaredScope) eq(s.audits[app].passed, true, `${app} self-audit must pass as a precondition`);
});

test("NEGATIVE: a scoring mismatch aborts even with every other class clean", () => {
  const r = evaluateParity("predictions", { ...P.parityResults, SCORING_PARITY: { checked: 21, mismatches: 1 } });
  eq(r.verdict, "ABORT", "scoring is zero-tolerance");
});

test("a fully evidenced promotion of a financial domain returns PROMOTE", () => {
  const gateEvidence = {
    historicalBackfillPass: true, financialReconciliationPass: true, idempotencyVerified: true,
    allocationInvariantsVerified: true, reversalModelVerified: true, trustedRuntimeVerified: true,
    rlsVerified: true, rollbackEvidence: true, zeroUnresolvedDelta: true,
  };
  const r = evaluateWithEvidence({
    state: "DOMAIN_BACKFILLED", domain: "payments", target: "DUAL_READ_SHADOW",
    ctx: { normalizedReadsShadow: true, backfillComplete: true, schemaExpanded: true },
    flagState: { normalized_reads_shadow: true },
    observation: { cleanRuns: 5, hours: 72, mutationsInWindow: 3, unresolvedDelta: 0 },
    gateEvidence, pipeline: P,
  });
  eq(r.decision.decision, "PROMOTE", `got ${r.decision.decision}: ${r.decision.reasons.join("; ")}`);
});

// --- NEGATIVE FIXTURES: each gate must be able to block on producer-generated evidence ---

test("NEGATIVE: AGGREGATE_PARITY blocks when the producer finds a real difference", () => {
  const db = buildDatabase();
  const doc = structuredClone(LEGACY_STATE);
  doc.entries = doc.entries.filter((e) => e.id !== "e3"); // an entry the legacy side has lost
  const agg = aggregateParity(doc, db);
  assert(agg.failures.length > 0, "the producer must find the lost entry");

  const results = { ...P.parityResults, AGGREGATE_PARITY: agg.AGGREGATE_PARITY };
  const r = evaluateParity("entries", { ...results, KEY_PARITY: agg.AGGREGATE_PARITY, VALUE_PARITY: agg.AGGREGATE_PARITY });
  eq(r.verdict, "ROLLBACK", "a real aggregate mismatch must not PASS");

  const decision = evaluatePromotion({
    state: "DOMAIN_BACKFILLED", domain: "entries", target: "DUAL_READ_SHADOW",
    ctx: { normalizedReadsShadow: true, backfillComplete: true, schemaExpanded: true },
    parityResults: { ...results, KEY_PARITY: agg.AGGREGATE_PARITY, VALUE_PARITY: agg.AGGREGATE_PARITY },
  });
  eq(decision.decision, "ROLLBACK", `got ${decision.decision}`);
});

test("NEGATIVE: FINANCIAL_PARITY blocks on a one-cent producer-detected difference", () => {
  const other = buildDatabase();
  other.exec("UPDATE payment_allocations SET amount_minor = 2001 WHERE payment_allocation_id = 'a1'");
  const fin = financialParityFromDb(buildDatabase(), other);
  eq(fin.verdict, "FAIL", "the producer must detect one cent");
  assert(fin.FINANCIAL_PARITY.mismatches > 0, "mismatches");

  const r = evaluateParity("payments", { ...P.parityResults, FINANCIAL_PARITY: fin.FINANCIAL_PARITY });
  eq(r.verdict, "ABORT", "a financial mismatch is zero-tolerance and must ABORT, not merely fail");

  const decision = evaluatePromotion({
    state: "SERVER_WRITE_PRIMARY", domain: "payments", target: "LEGACY_WRITE_DISABLED",
    ctx: { staleClientFenceReady: true, writeErrorRateAcceptable: true },
    parityResults: { ...P.parityResults, FINANCIAL_PARITY: fin.FINANCIAL_PARITY },
  });
  eq(decision.decision, "ROLLBACK", `got ${decision.decision}`);
  eq(decision.severity, "ABORT", "severity");
});

test("NEGATIVE: an invariant violation the producer finds blocks the gate even when totals agree", () => {
  const db = buildDatabase();
  // Duplicate an allocation: totals still reconcile against the payment sum, but the invariant breaks.
  db.exec(`INSERT INTO payment_allocations VALUES ('a99','y2','e3',500,'USD','2026-03-01T00:00:00Z')`);
  const fin = financialParityFromDb(db, db);
  assert(fin.invariantFailures.length > 0, "the duplicate allocation must be reported");
  assert(fin.FINANCIAL_PARITY.mismatches > 0, "an invariant failure must count as a mismatch");
  eq(evaluateParity("payments", { ...P.parityResults, FINANCIAL_PARITY: fin.FINANCIAL_PARITY }).verdict, "ABORT", "verdict");
});

test("NEGATIVE: a producer result with checked=0 is vacuous and holds rather than passes", () => {
  const r = evaluateParity("entries", {
    ROW_COUNT_PARITY: { checked: 0, mismatches: 0 },
    KEY_PARITY: { checked: 0, mismatches: 0 },
    VALUE_PARITY: { checked: 0, mismatches: 0 },
  });
  eq(r.verdict, "HOLD", "a producer that examined nothing must not be treated as clean");
  eq(r.vacuous.length, 3, "all three classes vacuous");
});

test("NEGATIVE: the pipeline fails loudly when a stage genuinely breaks", () => {
  // Feed a legacy state whose money disagrees, and confirm the pipeline reports the failing stage
  // rather than returning ok.
  const doc = structuredClone(LEGACY_STATE);
  doc.payments.find((p) => p.id === "y1").amountMinor = 9999;
  const broken = runPipeline({ legacyState: doc });
  eq(broken.ok, false, "the pipeline must not report ok with a money mismatch");
  assert(broken.failed.some((f) => f.stage === "aggregate_parity"), `failed stages: ${JSON.stringify(broken.failed)}`);
});

test("NEGATIVE: the observation window still gates independently of the parity producers", () => {
  const w = evaluateObservationWindow("payments", { cleanRuns: 5, hours: 72, mutationsInWindow: 0, unresolvedDelta: 0 });
  assert(!w.ok, "a window with zero mutations must remain vacuous even when the parity producers are clean");
  const r = evaluateWithEvidence({
    state: "DOMAIN_BACKFILLED", domain: "payments", target: "DUAL_READ_SHADOW",
    ctx: { normalizedReadsShadow: true, backfillComplete: true, schemaExpanded: true },
    observation: { cleanRuns: 5, hours: 72, mutationsInWindow: 0, unresolvedDelta: 0 },
    pipeline: P,
  });
  eq(r.decision.decision, "HOLD", "clean parity must not override a vacuous observation window");
});

test("the producers do not make a critical domain promotable without gate evidence", () => {
  const r = evaluateWithEvidence({
    state: "SERVER_WRITE_PRIMARY", domain: "payments", target: "LEGACY_WRITE_DISABLED",
    ctx: { staleClientFenceReady: true, writeErrorRateAcceptable: true },
    observation: { cleanRuns: 5, hours: 72, mutationsInWindow: 3, unresolvedDelta: 0 },
    pipeline: P,
  });
  eq(r.decision.decision, "HOLD",
    "having a parity producer is not the same as having passed the financial gate");
});

test("promotionEvidence and the pipeline agree — one producer, not two", () => {
  const db = buildDatabase();
  const direct = promotionEvidence({ legacyDoc: LEGACY_STATE, db });
  for (const cls of ["AGGREGATE_PARITY", "FINANCIAL_PARITY"]) {
    eq(direct[cls].checked, P.parityResults[cls].checked, `${cls}.checked must agree`);
    eq(direct[cls].mismatches, P.parityResults[cls].mismatches, `${cls}.mismatches must agree`);
  }
});

test("the pipeline is deterministic — two runs produce identical evidence", () => {
  const a = runPipeline(), b = runPipeline();
  eq(JSON.stringify(a.parityResults), JSON.stringify(b.parityResults), "parity results must be reproducible");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ EVIDENCE PIPELINE TESTS PASSED\n" : "✗ EVIDENCE PIPELINE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
