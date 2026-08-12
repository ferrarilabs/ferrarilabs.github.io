#!/usr/bin/env node
/**
 * Tests for the backfill framework (Workstreams 6, 6A, 6B, 6C, 6D, 6E).
 *
 * The framework's central claim is about FAILURE, so most of these tests kill it. Every checkpoint anomaly
 * and every transaction-boundary failure listed in the brief has a fixture, and the money-bearing paths are
 * tested for refusal rather than for best effort.
 *
 * All input is synthetic and constructed here.
 */

import {
  RUN_STATUS, HALT, BackfillHalted,
  makeCheckpoint, validateCheckpoint, defineDomain, runBackfill, reconcileRun,
  makeStore, makeCheckpointStore,
} from "./backfill.mjs";
import {
  ALL_DOMAINS, bindSyntheticSource, resetSyntheticSource, OUTBOX_BACKFILL_DECISION,
  participantsDomain, entriesDomain, paymentsDomain, allocationsDomain, resultsDomain, predictionsDomain,
  identityLinksDomain, auditDomain,
} from "./backfill_domains.mjs";
import { parseMoney } from "./financial.mjs";

let pass = 0, fail = 0;
const test = async (n, fn) => {
  try { await fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const halted = async (fn) => {
  try { await fn(); } catch (e) { if (e instanceof BackfillHalted) return e.code; throw e; }
  throw new Error("expected a BackfillHalted, none thrown");
};

const USD = "USD";
/** A simple deterministic domain used to exercise the framework itself. */
function simpleDomain({ rows, moneyBearing = false, transform, validateRow } = {}) {
  const src = rows || Array.from({ length: 25 }, (_, i) => ({ id: `r-${String(i).padStart(3, "0")}`, v: i }));
  return defineDomain({
    name: "simple", phase: "MX", moneyBearing,
    read: () => src,
    keyOf: (r) => r.id,
    transform: transform || ((r) => ({ id: r.id, doubled: r.v * 2 })),
    validateRow,
    write: null,
  });
}
const wire = (initial = null) => {
  const store = makeStore();
  const cps = makeCheckpointStore(store, { initial });
  return { store, checkpointStore: cps };
};

console.log("\nWS6 — normal operation\n");

await test("a clean run reaches COMPLETE and reconciles", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(run.status, RUN_STATUS.COMPLETE, `status (findings: ${JSON.stringify(run.reconciliation.findings)})`);
  eq(run.rowsSeen, 25, "rowsSeen");
  eq(run.rowsWritten, 25, "rowsWritten");
  eq(run.batches, 3, "batches");
  assert(run.completedAt, "completedAt set");
  assert(run.reconciliation.checksum, "a checksum is recorded as evidence");
});

await test("the run record carries every field the contract requires", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  for (const f of ["backfillId", "phase", "batchSize", "cursor", "startedAt", "updatedAt", "completedAt",
                   "status", "rowsSeen", "rowsWritten", "rowsSkipped", "rowsFailed", "reconciliation"]) {
    assert(run[f] !== undefined, `run record missing ${f}`);
  }
});

await test("a dry run writes nothing and does NOT claim COMPLETE", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10, dryRun: true });
  eq(run.status, RUN_STATUS.EXECUTED, "a dry run cannot be complete — nothing was written");
  eq(store.committedSize(), 0, "nothing written");
  assert(run.reconciliation.dryRun, "reconciliation states it is a dry run");
  assert(!run.completedAt, "completedAt must stay null");
});

await test("EXECUTED and COMPLETE are distinct: reconciliation failure prevents COMPLETE", async () => {
  const d = defineDomain({
    ...simpleDomain(),
    // A domain-level reconciliation that always objects; execution still succeeds.
    reconcile: () => ["synthetic reconciliation objection"],
  });
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(run.status, RUN_STATUS.FAILED, "a run that executed but did not reconcile is not complete");
  eq(run.haltCode, HALT.RECONCILIATION_FAILED, "halt code");
  eq(run.rowsWritten, 25, "the rows were still written — execution succeeded, reconciliation did not");
});

await test("progress is observable per batch", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  const seen = [];
  await runBackfill(d, { store, checkpointStore, batchSize: 10, onProgress: (p) => seen.push(p) });
  eq(seen.length, 3, "one progress callback per batch");
  assert(seen[0].cursor && seen[2].rowsSeen === 25, "progress carries cursor and running totals");
});

console.log("\nWS6 — idempotency and duplicate invocation\n");

await test("re-running a completed backfill writes nothing new", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  const again = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(again.rowsWritten, 25, "the counter carries forward from the checkpoint");
  eq(store.committedSize(), 25, "no duplicate rows were created");
  eq(again.status, RUN_STATUS.COMPLETE, "status");
});

await test("a partially applied target converges rather than duplicating", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  // Pre-write some rows as if a previous run had landed them with no checkpoint.
  await store.begin();
  await store.upsert("r-000", { id: "r-000", doubled: 0 });
  await store.upsert("r-001", { id: "r-001", doubled: 2 });
  await store.commit();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(store.committedSize(), 25, "target converges to exactly the source");
  eq(run.rowsSkipped, 2, "the already-present rows are skipped, not rewritten");
  eq(run.status, RUN_STATUS.COMPLETE, "status");
});

await test("a duplicate key in the source is refused before anything is written", async () => {
  const d = simpleDomain({ rows: [{ id: "dup", v: 1 }, { id: "dup", v: 2 }] });
  const { store, checkpointStore } = wire();
  eq(await halted(() => runBackfill(d, { store, checkpointStore })), HALT.ROW_VALIDATION_FAILED, "halt code");
  eq(store.committedSize(), 0, "nothing may be written when the key space is ambiguous");
});

await test("a non-deterministic source is refused before anything is written", async () => {
  let flip = false;
  const d = defineDomain({
    name: "flaky", phase: "MX",
    read: () => { flip = !flip; return flip ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }, { id: "a" }]; },
    keyOf: (r) => r.id, transform: (r) => r, write: null,
  });
  const { store, checkpointStore } = wire();
  eq(await halted(() => runBackfill(d, { store, checkpointStore })), HALT.NON_DETERMINISTIC_SOURCE, "halt code");
  eq(store.committedSize(), 0, "an unresumable run must not start");
});

console.log("\nWS6A — checkpoint semantics\n");

await test("a missing checkpoint is a normal first run", async () => {
  const r = validateCheckpoint(null, { backfillId: "x", phase: "MX", sourceIds: ["a"], workerId: "w" });
  eq(r.fresh, true, "fresh"); eq(r.resumeIndex, 0, "starts at zero");
});

await test("a valid checkpoint resumes AFTER the recorded cursor", async () => {
  const cp = makeCheckpoint({ backfillId: "x", phase: "MX", cursor: "b", at: "t" });
  const r = validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a", "b", "c"], workerId: null });
  eq(r.resumeIndex, 2, "resumes at the row after the cursor, never re-processing it blindly");
});

await test("a corrupt checkpoint is refused, not obeyed", async () => {
  const cp = { ...makeCheckpoint({ backfillId: "x", phase: "MX", cursor: "b", at: "t" }), rowsWritten: 999 };
  const code = await halted(() => validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a", "b"], workerId: null }));
  eq(code, HALT.CHECKPOINT_CORRUPT, "an integrity mismatch must halt — resuming could skip or repeat an unknown range");
});

await test("a checkpoint AHEAD of the data is refused", async () => {
  const cp = makeCheckpoint({ backfillId: "x", phase: "MX", cursor: "z-not-in-source", at: "t" });
  eq(await halted(() => validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a", "b"], workerId: null })),
    HALT.CHECKPOINT_AHEAD_OF_DATA, "halt code");
});

await test("a checkpoint BEHIND the data simply resumes — that is the normal case", async () => {
  const cp = makeCheckpoint({ backfillId: "x", phase: "MX", cursor: "a", at: "t" });
  const r = validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a", "b", "c", "d"], workerId: null });
  eq(r.resumeIndex, 1, "resume from the next row");
});

await test("a checkpoint from a DIFFERENT phase is refused", async () => {
  const cp = makeCheckpoint({ backfillId: "x", phase: "M4", cursor: "a", at: "t" });
  eq(await halted(() => validateCheckpoint(cp, { backfillId: "x", phase: "M5", sourceIds: ["a"], workerId: null })),
    HALT.CHECKPOINT_PHASE_MISMATCH, "two phases sharing a checkpoint would each claim the other's progress");
});

await test("a checkpoint from a different backfill is refused", async () => {
  const cp = makeCheckpoint({ backfillId: "other", phase: "MX", cursor: "a", at: "t" });
  eq(await halted(() => validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a"], workerId: null })),
    HALT.CHECKPOINT_CORRUPT, "halt code");
});

await test("TWO WORKERS on one checkpoint is refused", async () => {
  const cp = makeCheckpoint({ backfillId: "x", phase: "MX", cursor: "a", at: "t", leaseOwner: "worker-A" });
  const code = await halted(() => validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a", "b"], workerId: "worker-B" }));
  eq(code, HALT.CHECKPOINT_LEASE_CONFLICT, "a second worker must not proceed on another's checkpoint");
});

await test("the same worker resuming its own lease is allowed", async () => {
  const cp = makeCheckpoint({ backfillId: "x", phase: "MX", cursor: "a", at: "t", leaseOwner: "worker-A" });
  const r = validateCheckpoint(cp, { backfillId: "x", phase: "MX", sourceIds: ["a", "b"], workerId: "worker-A" });
  eq(r.resumeIndex, 1, "its own lease is not a conflict");
});

await test("a completed checkpoint at the last row yields an empty resume", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await runBackfill(d, { store, checkpointStore, batchSize: 25 });
  const cp = checkpointStore.peek();
  eq(cp.cursor, "r-024", "cursor is the last row");
  const r = validateCheckpoint(cp, { backfillId: "simple@MX", phase: "MX", sourceIds: Array.from({ length: 25 }, (_, i) => `r-${String(i).padStart(3, "0")}`), workerId: "worker-1" });
  eq(r.resumeIndex, 25, "nothing left to do");
});

console.log("\nWS6B — batch transaction boundaries\n");

await test("a failure BEFORE the transaction leaves the target untouched", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10, faults: { beforeTransaction: 2 } }));
  eq(store.committedSize(), 10, "only the first batch is durable");
  eq(checkpointStore.peek().cursor, "r-009", "the checkpoint matches exactly what is durable");
});

await test("a failure DURING transform rolls the whole batch back", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10, faults: { duringTransform: 2 } }));
  eq(store.committedSize(), 10, "batch 2 wrote nothing");
  eq(checkpointStore.peek().cursor, "r-009", "and recorded nothing");
});

await test("a failure DURING write rolls the whole batch back", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10, faults: { duringWrite: 2 } }));
  eq(store.committedSize(), 10, "partial batch writes are discarded");
});

await test("THE CRITICAL CASE: a failure after write but before checkpoint leaves NEITHER", async () => {
  /**
   * This is the window that duplicates data in a framework where rows and cursor commit separately. Because
   * the checkpoint is saved inside the same transaction, the rollback discards both — the batch is simply
   * not done, and a re-run redoes it.
   */
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10, faults: { afterWriteBeforeCheckpoint: 2 } }));
  eq(store.committedSize(), 10, "the batch's rows were discarded with its checkpoint");
  eq(checkpointStore.peek().cursor, "r-009", "cursor did not advance past undone work");

  // Resuming completes correctly and writes each row exactly once.
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(store.committedSize(), 25, "resume completes the run");
  eq(run.status, RUN_STATUS.COMPLETE, "and reconciles");
});

await test("a failure AFTER the checkpoint commit is safe — the batch is durably done", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10, faults: { afterCheckpoint: 2 } }));
  eq(store.committedSize(), 20, "two batches are durable");
  eq(checkpointStore.peek().cursor, "r-019", "the checkpoint reflects them");
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(store.committedSize(), 25, "resume finishes the remainder");
  eq(run.rowsSkipped, 0, "no row was re-written, so nothing needed skipping");
});

await test("rows and checkpoint always agree after ANY injected fault", async () => {
  for (const fault of ["beforeTransaction", "duringTransform", "duringWrite", "afterWriteBeforeCheckpoint", "afterCheckpoint"]) {
    const d = simpleDomain();
    const { store, checkpointStore } = wire();
    try { await runBackfill(d, { store, checkpointStore, batchSize: 5, faults: { [fault]: 3 } }); } catch { /* expected */ }
    const cp = checkpointStore.peek();
    const durable = store.committedSize();
    const expected = cp ? cp.rowsWritten : 0;
    eq(durable, expected, `after ${fault}: ${durable} durable rows but the checkpoint claims ${expected}`);
  }
});

console.log("\nWS6E — chaos, and fail-closed on money\n");

await test("a bad row in a NON-money domain is isolated and recorded", async () => {
  const d = simpleDomain({ transform: (r) => { if (r.id === "r-005") throw new Error("synthetic bad row"); return { id: r.id }; } });
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(run.rowsFailed, 1, "the bad row is counted");
  eq(run.failures.length, 1, "and recorded with its stage");
  eq(run.failures[0].stage, "transform", "stage");
  eq(run.status, RUN_STATUS.FAILED, "reconciliation notices the missing row, so the run is not complete");
});

await test("a bad row in a MONEY-BEARING domain HALTS rather than skipping", async () => {
  const d = simpleDomain({ moneyBearing: true, transform: (r) => { if (r.id === "r-005") throw new Error("ambiguous amount"); return { id: r.id }; } });
  const { store, checkpointStore } = wire();
  const code = await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10 }));
  eq(code, HALT.MONEY_AMBIGUITY, "skipping a money row would leave totals wrong by an unknown amount");
  eq(store.committedSize(), 0, "the batch containing it wrote nothing");
});

await test("a validation failure in a money domain also halts", async () => {
  const d = simpleDomain({ moneyBearing: true, validateRow: (out) => (out.id === "r-003" ? ["impossible amount"] : []) });
  const { store, checkpointStore } = wire();
  eq(await halted(() => runBackfill(d, { store, checkpointStore, batchSize: 10 })), HALT.MONEY_AMBIGUITY, "halt code");
});

await test("an unexpected null is caught by row validation", async () => {
  const d = simpleDomain({ transform: (r) => ({ id: r.id, doubled: r.id === "r-007" ? null : r.v * 2 }),
    validateRow: (out) => (out.doubled === null ? ["null where a number is required"] : []) });
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(run.rowsFailed, 1, "caught");
  eq(run.failures[0].stage, "validate", "stage");
});

await test("a type mismatch is caught rather than coerced", async () => {
  const d = simpleDomain({ transform: (r) => ({ id: r.id, doubled: r.id === "r-002" ? "12" : r.v * 2 }),
    validateRow: (out) => (typeof out.doubled === "number" ? [] : [`expected a number, got ${typeof out.doubled}`]) });
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(run.rowsFailed, 1, "a string where a number belongs must not be silently accepted");
});

await test("recovery is deterministic: the same faults produce the same durable state every time", async () => {
  const runOnce = async () => {
    const d = simpleDomain();
    const { store, checkpointStore } = wire();
    try { await runBackfill(d, { store, checkpointStore, batchSize: 7, faults: { duringWrite: 2 } }); } catch { /* expected */ }
    return { size: store.committedSize(), cursor: checkpointStore.peek()?.cursor ?? null };
  };
  const a = await runOnce(), b = await runOnce();
  eq(JSON.stringify(a), JSON.stringify(b), "recovery must be deterministic to be investigable");
});

console.log("\nWS6C — domain definitions\n");

const DOC = {
  entries: [
    { id: "en-1", entryName: "Synthetic Alpha", participantEmail: "a@example.invalid", payerName: "Synthetic Alpha", paymentMethod: "zelle", picks: { "m-1": { h: 1, a: 0 } }, createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" },
    { id: "en-2", entryName: "Synthetic Beta", participantEmail: "b@example.invalid", picks: null, createdAt: "2026-06-02T00:00:00Z", updatedAt: "2026-06-02T00:00:00Z" },
    { id: "en-3", entryName: "Synthetic Gamma", participantEmail: null, picks: null, createdAt: "2026-06-03T00:00:00Z", updatedAt: "2026-06-03T00:00:00Z" },
  ],
  paid: { "en-1": true, "en-2": false },
  deletedIds: ["en-3"],
  auditLog: [{ ts: "2026-06-01T00:00:00Z", action: "entry_created", admin: false, detail: "free text that must not survive", entryId: "en-1" }],
  results: { "m-1": { h: 1, a: 0 } },
  lastSync: "2026-06-04T00:00:00Z",
};

await test("all thirteen domains are declared with a phase", async () => {
  eq(ALL_DOMAINS.length, 13, "thirteen domains");
  for (const d of ALL_DOMAINS) {
    assert(d.name && d.phase, `${d.name || "?"} incomplete`);
    assert(typeof d.read === "function" && typeof d.transform === "function", `${d.name} missing read/transform`);
  }
});

await test("money-bearing domains are correctly marked", async () => {
  const money = ALL_DOMAINS.filter((d) => d.moneyBearing).map((d) => d.name);
  eq(JSON.stringify(money.sort()), JSON.stringify(["payment_allocations", "payments"]), "exactly the money domains");
});

await test("every domain runs and reconciles against a synthetic legacy document", async () => {
  bindSyntheticSource(DOC);
  for (const d of ALL_DOMAINS) {
    const { store, checkpointStore } = wire();
    const run = await runBackfill(d, { store, checkpointStore, batchSize: 5 });
    eq(run.status, RUN_STATUS.COMPLETE, `${d.name}: ${JSON.stringify(run.reconciliation.findings)}`);
  }
});

await test("participants dedupe by normalised email and arrive UNMERGED", async () => {
  bindSyntheticSource(DOC);
  const { store, checkpointStore } = wire();
  await runBackfill(participantsDomain, { store, checkpointStore });
  const rows = await store.rows();
  eq(rows.length, 3, "three distinct identities");
  for (const r of rows) eq(r.row.canonical_participant_id, null, "a backfilled participant must never arrive merged");
});

await test("entries preserve count, ids and tombstones", async () => {
  bindSyntheticSource(DOC);
  const { store, checkpointStore } = wire();
  const run = await runBackfill(entriesDomain, { store, checkpointStore });
  eq(run.status, RUN_STATUS.COMPLETE, "status");
  const rows = await store.rows();
  eq(rows.length, 3, "entry count");
  eq(rows.filter((r) => r.row.deleted_at).length, 1, "one tombstone");
});

await test("WS7.11: a transformer FATAL prevents any money-bearing row from being written", async () => {
  /**
   * The refusal now happens in the TRANSFORMER, not per row in the backfill. That is a stronger guarantee:
   * with no expected fee the transformer emits nothing and reports FATAL, so the domain reads zero rows and
   * the backfill cannot commit a partial set. Previously each row failed individually at write time, which
   * left the run half-done before anyone noticed.
   */
  const bound = bindSyntheticSource(DOC, { expectedFee: null });
  const t = bound.transformed.results.transformPoolEntries;
  eq(t.ok, false, "the transformer must refuse");
  assert(t.fatals.some((f) => f.code === "NO_EXPECTED_FEE"), "and name the reason");

  const { store, checkpointStore } = wire();
  const run = await runBackfill(entriesDomain, { store, checkpointStore });
  eq(store.committedSize(), 0, "nothing may be written from a transformation that could not complete");
  eq(run.rowsSeen, 0, "the domain reads nothing when the transformer refused");
  bindSyntheticSource(DOC);   // restore for later tests
});

await test("WS7.11: transformer warnings, unknowns and conflicts propagate to the caller", async () => {
  const bound = bindSyntheticSource(DOC);
  const findings = bound.transformed.findings;
  assert(findings.length > 0, "the fixture produces findings");
  for (const sev of ["UNKNOWN", "WARNING"]) {
    assert(findings.some((f) => f.severity === sev), `no ${sev} finding propagated`);
  }
  // Every propagated finding names the transformer it came from, or it cannot be traced.
  for (const f of findings) assert(f.transformer, `finding ${f.code} does not name its transformer`);
  // The legacy-asserted payment gap in particular must reach the caller.
  assert(findings.some((f) => f.code === "LEGACY_ASSERTED_NO_AMOUNT"),
    "the unknown payment amount must be visible to whoever runs the backfill");
});

await test("payments create one asserted row per flag with NO amount", async () => {
  bindSyntheticSource(DOC);
  const { store, checkpointStore } = wire();
  const run = await runBackfill(paymentsDomain, { store, checkpointStore });
  eq(run.status, RUN_STATUS.COMPLETE, "status");
  const rows = await store.rows();
  eq(rows.length, 1, "only en-1 was flagged paid");
  eq(rows[0].row.amount, null, "amount must stay null");
  eq(rows[0].row.currency, null, "currency is paired with amount");
  assert(rows[0].row.legacy_asserted, "marked as an assertion");
});

await test("a payments domain that invents an amount fails validation", async () => {
  bindSyntheticSource(DOC);
  const bad = defineDomain({ ...paymentsDomain, transform: (r) => ({ ...paymentsDomain.transform(r), amount: 500, currency: "USD" }) });
  const { store, checkpointStore } = wire();
  eq(await halted(() => runBackfill(bad, { store, checkpointStore })), HALT.MONEY_AMBIGUITY,
    "inventing an amount in a money domain must halt, not warn");
});

await test("allocations and predictions are deliberately EMPTY, and a non-empty result is a finding", async () => {
  bindSyntheticSource(DOC);
  for (const d of [allocationsDomain, predictionsDomain, identityLinksDomain]) {
    const { store, checkpointStore } = wire();
    const run = await runBackfill(d, { store, checkpointStore });
    eq(run.rowsWritten, 0, `${d.name} must write nothing`);
    eq(run.status, RUN_STATUS.COMPLETE, `${d.name} status`);
  }
  // And if something were written, reconciliation objects.
  const findings = await allocationsDomain.reconcile({ source: [], targetRows: [{ key: "al-1", row: {} }], run: {} });
  assert(findings.length > 0, "a fabricated allocation must be reported");
});

await test("an incomplete legacy result is refused by the transformer, never treated as 0-0", async () => {
  const bound = bindSyntheticSource({ ...DOC, results: { "m-9": { h: null, a: null } } });
  const t = bound.transformed.results.transformMatchResults;
  eq(t.records.length, 0, "the incomplete result is not emitted");
  assert(t.unknowns.some((f) => f.code === "RESULT_INCOMPLETE"), "and is reported as an unknown");
  const { store, checkpointStore } = wire();
  const run = await runBackfill(resultsDomain, { store, checkpointStore });
  eq(store.committedSize(), 0, "so nothing is written — 0-0 would award points for a match that was not played");
  bindSyntheticSource(DOC);
});

await test("audit backfill drops legacy free text", async () => {
  bindSyntheticSource(DOC);
  const { store, checkpointStore } = wire();
  await runBackfill(auditDomain, { store, checkpointStore });
  const rows = await store.rows();
  for (const r of rows) {
    eq(JSON.stringify(r.row.safe_metadata), "{}", "safe_metadata must be empty — legacy detail is dropped per B1");
    assert(!JSON.stringify(r.row).includes("free text that must not survive"), "the legacy detail must not appear anywhere in the row");
  }
});

await test("the outbox has NO historical backfill, with the reason recorded", async () => {
  assert(!ALL_DOMAINS.some((d) => /outbox/.test(d.name)),
    "there must be no outbox backfill domain — the legacy document holds no record of notification intent");
  eq(OUTBOX_BACKFILL_DECISION.decision, "NO_HISTORICAL_BACKFILL", "decision");
  assert(/invented delivery history/.test(OUTBOX_BACKFILL_DECISION.why), "the reason must be stated");
  assert(/email real participants/.test(OUTBOX_BACKFILL_DECISION.harmIfIgnored),
    "the concrete harm must be stated: replaying fabricated events would email real people");
});

console.log("\nWS6D — reconciliation\n");

await test("reconciliation reports counts, exclusions and a checksum", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  const r = run.reconciliation;
  eq(r.sourceCount, 25, "sourceCount"); eq(r.targetCount, 25, "targetCount");
  eq(r.expectedCount, 25, "expectedCount"); eq(r.missing, 0, "missing"); eq(r.unexpected, 0, "unexpected");
  assert(/^[0-9a-f]{64}$/.test(r.checksum), "checksum");
});

await test("a missing target row fails reconciliation", async () => {
  const d = simpleDomain({ transform: (r) => { if (r.id === "r-004") throw new Error("dropped"); return { id: r.id }; } });
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  assert(run.reconciliation.missing >= 1, "the absent row must be reported");
  eq(run.status, RUN_STATUS.FAILED, "and the run must not be complete");
});

await test("an accepted exclusion is not counted as missing", async () => {
  const d = defineDomain({ ...simpleDomain({ transform: (r) => { if (r.id === "r-004") throw new Error("known gap"); return { id: r.id }; } }),
    acceptedExclusions: () => [{ key: "r-004", reason: "UNKNOWN" }] });
  const { store, checkpointStore } = wire();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  eq(run.reconciliation.missing, 0, "a declared exclusion is not a defect");
  eq(run.reconciliation.unknownCount, 1, "but it IS counted as an unknown");
  eq(run.status, RUN_STATUS.COMPLETE, "so the run can complete honestly");
});

await test("an unexpected target row fails reconciliation", async () => {
  const d = simpleDomain();
  const { store, checkpointStore } = wire();
  await store.begin(); await store.upsert("stowaway", { id: "stowaway" }); await store.commit();
  const run = await runBackfill(d, { store, checkpointStore, batchSize: 10 });
  assert(run.reconciliation.unexpected >= 1, "a row corresponding to no source row must be reported");
  eq(run.status, RUN_STATUS.FAILED, "status");
});

await test("the checksum is order-independent", async () => {
  const d = simpleDomain();
  const a = wire(); const runA = await runBackfill(d, { ...a, batchSize: 25 });
  const b = wire(); const runB = await runBackfill(d, { ...b, batchSize: 3 });
  eq(runA.reconciliation.checksum, runB.reconciliation.checksum,
    "a resumed or differently-batched run covering the same rows must produce the same checksum, or the check fires on a correct outcome");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ BACKFILL TESTS PASSED\n" : "✗ BACKFILL TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
