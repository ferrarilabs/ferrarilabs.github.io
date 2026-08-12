#!/usr/bin/env node
/**
 * Scale harness (Workstreams 1 and 37).
 *
 * Runs the REAL validators — not stand-ins — against generated datasets at increasing scale, and records
 * runtime, memory class and dataset size. Its purpose is to answer the FMEA's X-13 residual: whether the
 * checks that pass on a dozen hand-written rows still pass, and still terminate, at production shape.
 *
 * WHAT IS AND IS NOT CLAIMED
 * These are in-process JavaScript timings over in-memory arrays on one developer machine. They are a
 * RELATIVE regression baseline: "reconciliation at SCALE-C costs ~N× SCALE-B". They are **not** production
 * performance, not PostgreSQL query timings, and not a capacity statement. Anyone quoting a number from
 * here as a production figure is misreading it, so the report says so in the output itself.
 *
 * Usage:
 *   node scripts/db/scale_harness.mjs --scale=A|B|C|D [--seed=1] [--json]
 *   node scripts/db/scale_harness.mjs --all
 */

import { pathToFileURL } from "node:url";
import { generate, datasetStats, SCALES } from "./synthetic_dataset.mjs";
import { runRules } from "./data_quality.mjs";
import { poolReconciliation, settlementStatus, unappliedBalance, sum, parseMoney, SETTLEMENT } from "./financial.mjs";
import { checkInvariants } from "./outbox.mjs";
import { findDuplicateCandidates } from "./identity.mjs";
import { verifyChain } from "./audit.mjs";
import { canonicalPicksFromPredictions, assembleRanking, TIE_CASCADES } from "./scoring_parity.mjs";

const USD = "USD";
const MB = 1024 * 1024;

/** Time a function, returning ms and the result. */
function timed(fn) {
  const t0 = process.hrtime.bigint();
  const value = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms: Math.round(ms * 100) / 100, value };
}

const memMb = () => Math.round((process.memoryUsage().heapUsed / MB) * 10) / 10;

/**
 * Memory CLASS rather than a byte figure. A precise heap number is noise — it depends on GC timing — while
 * the class is the actionable fact: does this fit comfortably, or is it the thing that will fall over first.
 */
export function memoryClass(mb) {
  if (mb < 64) return "SMALL (<64 MB)";
  if (mb < 256) return "MODERATE (64–256 MB)";
  if (mb < 1024) return "LARGE (256 MB–1 GB)";
  return "VERY LARGE (>1 GB)";
}

export function runScale({ scale = "A", seed = 1, bounded = false } = {}) {
  const cfg = SCALES[scale];
  /**
   * SCALE-D materialises by default.
   *
   * It was initially assumed impractical and run as a bounded representative with predictions counted
   * rather than built. Measuring it showed otherwise: 1,039,801 rows generate in about a second at ~218 MB
   * heap. Assuming a limit instead of measuring it would have left the largest scenario permanently
   * unproven for no reason. `--bounded` remains available for a machine where it genuinely does not fit.
   */
  const boundedD = bounded;
  const steps = [];

  const gen = timed(() => generate({ scale, seed, predictionsAsCount: boundedD }));
  const d = gen.value;
  steps.push({ step: "generate", ms: gen.ms, note: boundedD ? "predictions NOT materialised — bounded representative" : null });

  const stats = datasetStats(d);
  const sizeBytes = Buffer.byteLength(JSON.stringify({ ...d, predictions: boundedD ? [] : d.predictions }));

  // ── data quality: all 35 rules over the whole dataset ────────────────────
  const dq = timed(() => runRules(d, { now: new Date(Date.UTC(2026, 1, 20)).toISOString() }));
  const dqFailed = dq.value.filter((r) => r.status !== "PASS");
  steps.push({ step: "data_quality (35 rules)", ms: dq.ms, note: `${dqFailed.length} rule(s) firing` });

  // ── financial reconciliation per pool, plus settlement for every entry ───
  const fin = timed(() => {
    const perPool = [];
    for (const pool of d.pools) {
      const entries = d.pool_entries.filter((e) => e.pool_id === pool.pool_id && !e.deleted_at);
      const ids = new Set(entries.map((e) => e.pool_entry_id));
      const allocs = d.payment_allocations.filter((a) => ids.has(a.pool_entry_id));
      const prizes = d.prize_allocations.filter((z) => z.pool_id === pool.pool_id);
      perPool.push(poolReconciliation({
        currency: USD,
        entries: entries.filter((e) => e.expected).map((e) => ({ expected: e.expected })),
        allocations: allocs.map((a) => ({ amount: a.allocated_amount })),
        prizes: prizes.map((z) => ({ gross: z.gross })),
      }));
    }
    // Settlement classification for every entry — the O(entries × allocations) path that matters at scale.
    const byEntry = new Map();
    for (const a of d.payment_allocations) {
      if (!byEntry.has(a.pool_entry_id)) byEntry.set(a.pool_entry_id, []);
      byEntry.get(a.pool_entry_id).push(a.allocated_amount);
    }
    const tally = { unpaid: 0, partially_paid: 0, settled: 0, overpaid: 0, legacy_asserted: 0 };
    for (const e of d.pool_entries) {
      if (!e.expected || e.deleted_at) continue;
      const allocated = sum(byEntry.get(e.pool_entry_id) || [], USD);
      tally[settlementStatus({ expected: e.expected, allocated, legacyAsserted: !!e.legacy_asserted })]++;
    }
    // Unapplied balance per payment.
    const allocsByPayment = new Map();
    for (const a of d.payment_allocations) {
      if (!allocsByPayment.has(a.payment_id)) allocsByPayment.set(a.payment_id, []);
      allocsByPayment.get(a.payment_id).push({ amount: a.allocated_amount });
    }
    let unappliedTotal = 0, overAllocated = 0;
    for (const p of d.payments) {
      const u = unappliedBalance({ amount: p.amount }, allocsByPayment.get(p.payment_id) || []);
      if (u === null) continue;
      if (u.minor < 0) overAllocated++;
      else unappliedTotal += u.minor;
    }
    return { perPool, tally, unappliedTotal, overAllocated };
  });
  steps.push({ step: "financial reconciliation + settlement", ms: fin.ms,
    note: `${fin.value.perPool.length} pool(s); over-allocated=${fin.value.overAllocated}` });

  // ── scoring input canonicalisation + ranking assembly ────────────────────
  const scoring = timed(() => {
    if (boundedD) return { canonicalised: 0, ranked: 0 };
    const byEntry = new Map();
    for (const p of d.predictions) {
      if (!byEntry.has(p.pool_entry_id)) byEntry.set(p.pool_entry_id, []);
      byEntry.get(p.pool_entry_id).push(p);
    }
    let canonicalised = 0;
    for (const rows of byEntry.values()) { canonicalPicksFromPredictions(rows); canonicalised++; }
    // Ranking assembly with a synthetic metric set — ordering logic only, no scoring formula.
    const scored = [...byEntry.keys()].map((id, i) => ({ pool_entry_id: id,
      metrics: { total: (i * 7) % 50, exact: i % 5, podium: i % 3 } }));
    const ranking = assembleRanking(scored, TIE_CASCADES.copa2026);
    return { canonicalised, ranked: ranking.length };
  });
  steps.push({ step: "scoring input canonicalisation + ranking", ms: scoring.ms,
    note: boundedD ? "skipped — predictions not materialised" : `${scoring.value.canonicalised} entries, ${scoring.value.ranked} ranked` });

  // ── identity candidate detection: the O(n²) path, and the one to watch ───
  const ident = timed(() => findDuplicateCandidates(d.participants));
  steps.push({ step: "identity candidate detection", ms: ident.ms,
    note: `${ident.value.length} candidate pair(s) from ${d.participants.length} participants (blocked, was O(n²))` });

  // ── outbox invariants + audit chain verification ─────────────────────────
  const ob = timed(() => checkInvariants(d.outbox_events, d.outbox_delivery_attempts));
  steps.push({ step: "outbox invariants", ms: ob.ms, note: `${ob.value.length} finding(s)` });

  const chain = timed(() => verifyChain(d.audit_events.map((e) => ({ ...e }))));
  steps.push({ step: "audit chain verification", ms: chain.ms,
    note: `${d.audit_events.length} events; valid=${chain.value.valid === true}` });

  const totalMs = Math.round(steps.reduce((n, s) => n + s.ms, 0) * 100) / 100;
  const heap = memMb();

  return {
    scale: cfg.name, seed, bounded: boundedD,
    stats, sizeBytes, sizeMb: Math.round((sizeBytes / MB) * 100) / 100,
    steps, totalMs, heapMb: heap, memoryClass: memoryClass(heap),
    settlement: fin.value.tally,
    dqFailing: dqFailed.map((r) => ({ id: r.id, findings: r.findings.length })),
    identityCandidates: ident.value.length,
    outboxFindings: ob.value.length,
    auditChainValid: chain.value.valid === true,
  };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const scales = all ? ["A", "B", "C", "D"] : [(argv.find((a) => a.startsWith("--scale=")) || "--scale=A").split("=")[1]];
  const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").split("=")[1]);
  const bounded = argv.includes("--bounded");
  const results = scales.map((s) => runScale({ scale: s, seed, bounded }));

  if (argv.includes("--json")) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

  for (const r of results) {
    console.log(`\n${"=".repeat(72)}\n${r.scale}  seed=${r.seed}${r.bounded ? "  [BOUNDED REPRESENTATIVE]" : ""}\n${"=".repeat(72)}`);
    console.log(`  rows: ${r.stats._total.toLocaleString()}   in-memory JSON: ${r.sizeMb} MB   heap: ${r.heapMb} MB (${r.memoryClass})`);
    console.log(`  settlement mix: ${Object.entries(r.settlement).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    console.log("");
    for (const s of r.steps) {
      console.log(`  ${String(s.ms).padStart(9)} ms  ${s.step.padEnd(42)}${s.note ? "  " + s.note : ""}`);
    }
    console.log(`  ${String(r.totalMs).padStart(9)} ms  TOTAL`);
    if (r.dqFailing.length) {
      console.log(`\n  data-quality rules firing: ${r.dqFailing.map((x) => `${x.id}(${x.findings})`).join(" ")}`);
    }
  }
  console.log("\n  These are in-process JS timings over in-memory arrays on one machine.");
  console.log("  They are a RELATIVE regression baseline, NOT production performance and NOT SQL timings.\n");
}
