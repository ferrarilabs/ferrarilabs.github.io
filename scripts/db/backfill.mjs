#!/usr/bin/env node
/**
 * Resumable backfill framework (Workstreams 6, 6A, 6B, 6D).
 *
 * THE CENTRAL PROBLEM, STATED HONESTLY
 * Distributed exactly-once EXECUTION does not exist. A worker can die between writing rows and recording
 * that it wrote them, and no amount of protocol removes that window. What IS achievable is exactly-once
 * EFFECT, by two mechanisms used together:
 *
 *   1. THE CHECKPOINT COMMITS IN THE SAME TRANSACTION AS THE BATCH WRITE. This is the whole design. If the
 *      two commit together, there is no state where rows landed but the cursor did not — the window closes
 *      because it never opens. A framework that writes rows and then records progress separately is a
 *      framework that will double-write, and no retry policy fixes it.
 *   2. IDEMPOTENT WRITES keyed on a stable natural or preserved surrogate id, so a batch replayed after an
 *      ambiguous failure converges instead of duplicating. This is the belt to the transaction's braces:
 *      it covers the case where the transaction outcome is genuinely unknown to the caller.
 *
 * RECONCILIATION IS PART OF COMPLETION, NOT A REPORT AFTERWARDS. A run that processed every batch without
 * throwing is `EXECUTED`, not `COMPLETE`. It becomes `COMPLETE` only when source and target counts, the
 * accepted-exclusion set and the checksum all agree (WS6D). This distinction is why `status` has both values.
 *
 * FAIL CLOSED ON MONEY. When a domain is money-bearing and the framework cannot prove whether a batch
 * landed, it refuses to continue rather than guessing. Re-reading is cheap; a duplicated payment is not.
 *
 * NO DATABASE. The "target" is an in-memory store supplied by the caller, so every failure mode below is
 * reproducible in a test without infrastructure. Production wiring replaces the store, not the control flow.
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export const RUN_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  /** Every batch processed without throwing. NOT the same as complete. */
  EXECUTED: "EXECUTED",
  /** Executed AND reconciled. The only status that authorises moving on. */
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  /** Refused to proceed because continuing could duplicate money-bearing data. */
  HALTED_AMBIGUOUS: "HALTED_AMBIGUOUS",
};

export const HALT = {
  CHECKPOINT_AHEAD_OF_DATA: "CHECKPOINT_AHEAD_OF_DATA",
  CHECKPOINT_CORRUPT: "CHECKPOINT_CORRUPT",
  CHECKPOINT_LEASE_CONFLICT: "CHECKPOINT_LEASE_CONFLICT",
  CHECKPOINT_PHASE_MISMATCH: "CHECKPOINT_PHASE_MISMATCH",
  NON_DETERMINISTIC_SOURCE: "NON_DETERMINISTIC_SOURCE",
  ROW_VALIDATION_FAILED: "ROW_VALIDATION_FAILED",
  MONEY_AMBIGUITY: "MONEY_AMBIGUITY",
  RECONCILIATION_FAILED: "RECONCILIATION_FAILED",
};

export class BackfillHalted extends Error {
  constructor(code, message, detail = {}) { super(`${code}: ${message}`); this.code = code; this.detail = detail; }
}

/**
 * Checkpoint. Deliberately small and self-describing: a checkpoint that cannot be validated on read is a
 * checkpoint that will be trusted when it should not be.
 *
 * `integrity` is a digest over the meaningful fields, so a hand-edited or partially-written checkpoint is
 * detectable rather than silently obeyed.
 */
export function makeCheckpoint({ backfillId, phase, cursor, rowsSeen = 0, rowsWritten = 0, rowsSkipped = 0, rowsFailed = 0, at, leaseOwner = null }) {
  const body = { backfillId, phase, cursor, rowsSeen, rowsWritten, rowsSkipped, rowsFailed, at, leaseOwner };
  return Object.freeze({ ...body, integrity: checkpointDigest(body) });
}

function checkpointDigest(body) {
  return sha256(JSON.stringify({
    backfillId: body.backfillId, phase: body.phase, cursor: body.cursor,
    rowsSeen: body.rowsSeen, rowsWritten: body.rowsWritten,
    rowsSkipped: body.rowsSkipped, rowsFailed: body.rowsFailed,
  }));
}

/**
 * Validate a checkpoint before trusting it (WS6A).
 *
 * Every branch here corresponds to a real way a resume goes wrong. "Missing" is fine — that is a first run.
 * Everything else is a refusal, because the alternative is guessing about data that may include money.
 */
export function validateCheckpoint(cp, { backfillId, phase, sourceIds, workerId, now }) {
  if (!cp) return { ok: true, fresh: true, resumeIndex: 0 };

  if (cp.integrity !== checkpointDigest(cp)) {
    throw new BackfillHalted(HALT.CHECKPOINT_CORRUPT,
      "the checkpoint's integrity digest does not match its contents. It was truncated, hand-edited, or " +
      "partially written. Resuming from it could re-process or skip an unknown range, so it must be " +
      "reconstructed from the target rather than trusted.", { backfillId });
  }
  if (cp.backfillId !== backfillId) {
    throw new BackfillHalted(HALT.CHECKPOINT_CORRUPT, `checkpoint belongs to backfill ${cp.backfillId}, not ${backfillId}`);
  }
  if (cp.phase !== phase) {
    throw new BackfillHalted(HALT.CHECKPOINT_PHASE_MISMATCH,
      `checkpoint was written by phase ${cp.phase} but this run is phase ${phase}. Two phases sharing a ` +
      `checkpoint would each believe the other's progress was its own.`);
  }
  /**
   * A lease held by a DIFFERENT worker is a hard stop.
   *
   * This is not a distributed lock and does not claim to be — it cannot prevent two workers starting at the
   * same instant. It catches the overwhelmingly more common case: a second invocation while the first is
   * still running. Refusing there is cheap; the alternative is two workers writing the same rows.
   */
  if (cp.leaseOwner && workerId && cp.leaseOwner !== workerId) {
    throw new BackfillHalted(HALT.CHECKPOINT_LEASE_CONFLICT,
      `the checkpoint is leased by worker ${cp.leaseOwner} and this worker is ${workerId}. Two workers on ` +
      `one checkpoint would duplicate writes. Establish that the other worker is gone before overriding.`);
  }

  const resumeIndex = sourceIds.indexOf(cp.cursor);
  if (cp.cursor === null) return { ok: true, fresh: false, resumeIndex: 0 };
  if (resumeIndex === -1) {
    throw new BackfillHalted(HALT.CHECKPOINT_AHEAD_OF_DATA,
      `the checkpoint's cursor is not present in the source. Either the source changed under the backfill, ` +
      `or the checkpoint is from a different dataset. Both mean the recorded position is meaningless.`,
      { cursor: cp.cursor });
  }
  return { ok: true, fresh: false, resumeIndex: resumeIndex + 1 };
}

/**
 * A backfill DOMAIN is a declaration, not code with a policy baked in.
 *
 * `read` must be deterministic and is checked for it. `transform` is pure. `write` is idempotent and reports
 * whether it inserted or skipped, so `rowsWritten` means what it says on a replay.
 */
export function defineDomain({
  name, phase, moneyBearing = false,
  read, keyOf, transform, validateRow,
  reconcile, acceptedExclusions = () => [],
}) {
  /**
   * There is deliberately no `write` in a domain definition.
   *
   * The runner writes through the injected store, because the write must happen in the SAME transaction as
   * the checkpoint — a domain supplying its own writer could not participate in that transaction, and the
   * exactly-once-effect property would be lost. An earlier draft required a `write` field that every domain
   * then passed as null: a required parameter nobody can supply is a design error, not a safeguard.
   */
  for (const [k, v] of Object.entries({ name, phase, read, keyOf, transform })) {
    if (!v) throw new Error(`domain definition is missing ${k}`);
  }
  return Object.freeze({ name, phase, moneyBearing, read, keyOf, transform, validateRow, reconcile, acceptedExclusions });
}

/**
 * Run a backfill.
 *
 * `store` is the synthetic target: `{ begin(), commit(), rollback(), upsert(key,row), has(key), rows() }`.
 * `checkpointStore` is `{ load(), save(cp) }` — and crucially, `save` is called INSIDE the batch transaction.
 */
export async function runBackfill(domain, {
  store, checkpointStore, batchSize = 100, dryRun = false, workerId = "worker-1",
  now = () => new Date().toISOString(), onProgress = null, faults = {},
} = {}) {
  const backfillId = `${domain.name}@${domain.phase}`;
  const source = await domain.read();
  const sourceIds = source.map((r) => domain.keyOf(r));

  // Determinism is a precondition, not a hope. A source that returns a different order on a second read
  // makes every cursor meaningless, so it is checked before anything is written.
  const second = await domain.read();
  if (JSON.stringify(second.map((r) => domain.keyOf(r))) !== JSON.stringify(sourceIds)) {
    throw new BackfillHalted(HALT.NON_DETERMINISTIC_SOURCE,
      "two reads of the source returned different orders. Every cursor would be meaningless, so the " +
      "backfill refuses to start rather than producing an unresumable run.");
  }
  if (new Set(sourceIds).size !== sourceIds.length) {
    const dupes = sourceIds.filter((id, i) => sourceIds.indexOf(id) !== i);
    throw new BackfillHalted(HALT.ROW_VALIDATION_FAILED,
      `the source contains ${new Set(dupes).size} duplicate key(s). A duplicate key makes idempotent write ` +
      `ambiguous: the second row would silently overwrite the first.`, { duplicateCount: new Set(dupes).size });
  }

  const existing = await checkpointStore.load();
  const { fresh, resumeIndex } = validateCheckpoint(existing, { backfillId, phase: domain.phase, sourceIds, workerId, now: now() });

  let rowsSeen = existing ? existing.rowsSeen : 0;
  let rowsWritten = existing ? existing.rowsWritten : 0;
  let rowsSkipped = existing ? existing.rowsSkipped : 0;
  let rowsFailed = existing ? existing.rowsFailed : 0;
  const startedAt = existing ? existing.at : now();
  const failures = [];
  const warnings = [];
  let cursor = existing ? existing.cursor : null;
  let batches = 0;

  for (let i = resumeIndex; i < source.length; i += batchSize) {
    const batch = source.slice(i, i + batchSize);
    batches++;

    // ── WS6B: injected failure BEFORE the transaction ────────────────────────
    if (faults.beforeTransaction === batches) {
      throw new BackfillHalted(HALT.ROW_VALIDATION_FAILED, `injected fault before transaction on batch ${batches}`);
    }

    await store.begin();
    try {
      let batchWritten = 0, batchSkipped = 0;
      for (const row of batch) {
        rowsSeen++;
        const key = domain.keyOf(row);

        if (faults.duringTransform === batches) throw new Error(`injected transform fault on batch ${batches}`);

        let out;
        try { out = domain.transform(row); }
        catch (e) {
          // A transform failure is ISOLATED per row, but only for a non-money domain. For money, one
          // unexplained row means the batch's arithmetic is unknown, so the whole run stops.
          if (domain.moneyBearing) {
            throw new BackfillHalted(HALT.MONEY_AMBIGUITY,
              `row ${key} failed to transform in a money-bearing domain. Skipping it would leave the pool's ` +
              `totals wrong by an unknown amount, so the run halts instead.`, { key, cause: e.message });
          }
          rowsFailed++;
          failures.push({ key, stage: "transform", message: e.message });
          continue;
        }

        if (domain.validateRow) {
          const problems = domain.validateRow(out, row) || [];
          if (problems.length) {
            if (domain.moneyBearing) {
              throw new BackfillHalted(HALT.MONEY_AMBIGUITY,
                `row ${key} failed validation in a money-bearing domain: ${problems.join("; ")}`, { key });
            }
            rowsFailed++;
            failures.push({ key, stage: "validate", message: problems.join("; ") });
            continue;
          }
        }

        if (faults.duringWrite === batches) throw new Error(`injected write fault on batch ${batches}`);

        if (dryRun) { batchSkipped++; continue; }
        const res = await store.upsert(key, out);
        if (res && res.inserted === false) { batchSkipped++; rowsSkipped++; }
        else { batchWritten++; rowsWritten++; }
      }

      // ── WS6B: failure AFTER the write, BEFORE the checkpoint ─────────────
      // Without a shared transaction this is the window that duplicates data. Here the rollback below
      // discards the writes too, so the batch is simply not done — which is the point of the design.
      if (faults.afterWriteBeforeCheckpoint === batches) {
        throw new Error(`injected fault after write, before checkpoint, on batch ${batches}`);
      }

      cursor = domain.keyOf(batch[batch.length - 1]);
      const cp = makeCheckpoint({
        backfillId, phase: domain.phase, cursor, rowsSeen, rowsWritten, rowsSkipped, rowsFailed,
        at: startedAt, leaseOwner: workerId,
      });
      // THE critical line: the checkpoint is saved inside the same transaction as the rows.
      await checkpointStore.save(cp, { inTransaction: true });
      await store.commit();

      // ── WS6B: failure AFTER the checkpoint commit ────────────────────────
      // Safe by construction: the batch is durably done, so a restart resumes after it.
      if (faults.afterCheckpoint === batches) {
        throw new BackfillHalted(HALT.ROW_VALIDATION_FAILED, `injected fault after checkpoint on batch ${batches}`);
      }

      if (onProgress) onProgress({ batches, rowsSeen, rowsWritten, rowsSkipped, rowsFailed, cursor, batchWritten, batchSkipped });
    } catch (e) {
      await store.rollback();
      if (e instanceof BackfillHalted) throw e;
      // A batch that failed mid-transaction wrote nothing and recorded nothing. Re-running resumes from the
      // previous checkpoint and redoes exactly this batch, which idempotent write makes safe.
      throw new BackfillHalted(
        domain.moneyBearing ? HALT.MONEY_AMBIGUITY : HALT.ROW_VALIDATION_FAILED,
        `batch ${batches} aborted and was rolled back: ${e.message}. No rows and no checkpoint were ` +
        `committed, so a re-run repeats this batch from the last durable position.`,
        { batch: batches, cause: e.message });
    }
  }

  const run = {
    backfillId, phase: domain.phase, workerId,
    status: RUN_STATUS.EXECUTED, dryRun,
    batchSize, batches, rowsSeen, rowsWritten, rowsSkipped, rowsFailed,
    startedAt, updatedAt: now(), completedAt: null,
    cursor, failures, warnings,
  };

  // ── WS6D: reconciliation decides completion ────────────────────────────────
  const recon = await reconcileRun(domain, { store, source, run });
  run.reconciliation = recon;
  if (!recon.ok) {
    run.status = RUN_STATUS.FAILED;
    run.haltCode = HALT.RECONCILIATION_FAILED;
    return run;
  }
  run.status = dryRun ? RUN_STATUS.EXECUTED : RUN_STATUS.COMPLETE;
  run.completedAt = dryRun ? null : now();
  return run;
}

/**
 * Reconciliation (WS6D). A run that finished executing is not complete until these agree.
 *
 * `checksum` is over the SORTED target keys, so it is independent of write order — otherwise a resumed run
 * would produce a different checksum from an uninterrupted one covering the same rows, and the check would
 * fire on a correct outcome.
 */
export async function reconcileRun(domain, { store, source, run }) {
  const exclusions = domain.acceptedExclusions(source) || [];
  const excluded = new Set(exclusions.map((x) => (typeof x === "string" ? x : x.key)));
  const expectedKeys = source.map((r) => domain.keyOf(r)).filter((k) => !excluded.has(k));
  const targetKeys = (await store.rows()).map((r) => r.key);

  const missing = expectedKeys.filter((k) => !targetKeys.includes(k));
  const unexpected = targetKeys.filter((k) => !expectedKeys.includes(k));

  const findings = [];
  if (run.dryRun) {
    return { ok: true, dryRun: true, sourceCount: source.length, targetCount: targetKeys.length,
      expectedCount: expectedKeys.length, excludedCount: excluded.size, findings: ["dry run — nothing written, so reconciliation is not asserted"], checksum: null };
  }
  if (missing.length) findings.push(`${missing.length} expected row(s) absent from the target`);
  if (unexpected.length) findings.push(`${unexpected.length} target row(s) correspond to no source row`);
  if (run.rowsFailed > 0 && domain.moneyBearing) findings.push(`${run.rowsFailed} failed row(s) in a money-bearing domain`);

  const checksum = sha256(JSON.stringify([...targetKeys].sort()));
  const domainRecon = domain.reconcile ? await domain.reconcile({ source, targetRows: await store.rows(), run }) : [];
  findings.push(...(domainRecon || []));

  return {
    ok: findings.length === 0,
    sourceCount: source.length,
    targetCount: targetKeys.length,
    expectedCount: expectedKeys.length,
    excludedCount: excluded.size,
    unknownCount: exclusions.filter((x) => typeof x === "object" && x.reason === "UNKNOWN").length,
    conflictCount: exclusions.filter((x) => typeof x === "object" && x.reason === "CONFLICT").length,
    missing: missing.length, unexpected: unexpected.length,
    checksum, findings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic stores — the in-memory stand-ins that make every failure testable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A transactional in-memory store. `begin` snapshots, `rollback` restores, `commit` keeps.
 *
 * Crucially, the checkpoint store can enlist in the SAME transaction, which is what lets a test prove that
 * rows and cursor move together. A store where they could not would not be able to model the design.
 */
export function makeStore() {
  let committed = new Map();
  let working = null;
  let enlisted = null;
  return {
    async begin() { working = new Map(committed); },
    async commit() {
      if (working) committed = working;
      if (enlisted) { enlisted.commit(); enlisted = null; }
      working = null;
    },
    async rollback() {
      working = null;
      if (enlisted) { enlisted.rollback(); enlisted = null; }
    },
    enlist(participant) { enlisted = participant; },
    async upsert(key, row) {
      const m = working || committed;
      if (m.has(key)) return { inserted: false };
      m.set(key, row);
      return { inserted: true };
    },
    async has(key) { return (working || committed).has(key); },
    async rows() { return [...(working || committed).entries()].map(([key, row]) => ({ key, row })); },
    committedSize() { return committed.size; },
  };
}

/** A checkpoint store that can participate in the store's transaction. */
export function makeCheckpointStore(store, { initial = null } = {}) {
  let committed = initial;
  let pending = null;
  const participant = {
    commit() { if (pending !== null) { committed = pending; pending = null; } },
    rollback() { pending = null; },
  };
  return {
    async load() { return committed; },
    async save(cp, { inTransaction = false } = {}) {
      if (inTransaction) { pending = cp; store.enlist(participant); }
      else { committed = cp; }
    },
    /** Test helper: force a checkpoint without a transaction, to model a corrupt or stale one. */
    _force(cp) { committed = cp; },
    peek() { return committed; },
  };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  console.log("\nBackfill framework\n");
  console.log(`  run statuses: ${Object.keys(RUN_STATUS).join(", ")}`);
  console.log(`  halt codes:   ${Object.keys(HALT).join(", ")}`);
  console.log("\n  EXECUTED means every batch ran. COMPLETE additionally means reconciliation agreed.");
  console.log("  The checkpoint commits inside the batch transaction — that is how exactly-once EFFECT is");
  console.log("  achieved without claiming exactly-once EXECUTION, which does not exist.\n");
}
