#!/usr/bin/env node
/**
 * Deterministic synthetic dataset generator (Workstream 1).
 *
 * WHY THIS EXISTS
 * The FMEA recorded X-13's residual risk as "a parity harness that passes on synthetic fixtures but not on
 * production-shaped data". Hand-written fixtures are a dozen rows chosen to exercise a branch; they say
 * nothing about behaviour at 10 000 participants, and nothing about whether an invariant that holds for
 * three payments holds for a hundred thousand allocations.
 *
 * NO REAL DATA. Every name is `Synthetic Person <n>`, every address is `@example.invalid`, every payment
 * reference is `SYNTH-<n>`. Nothing is copied, sampled or derived from production, and nothing here reads
 * production. That is not a courtesy — a generator seeded from real data would put real data in the repo's
 * test output.
 *
 * DETERMINISM
 * A seeded PRNG (mulberry32), so a scenario is reproducible from `{seed, scale}` alone. Only that metadata
 * is persisted, never a generated dataset: a million-row fixture in Git would be both useless and enormous.
 * Re-running the same seed reproduces the same dataset byte-for-byte, which is what makes a regression
 * investigable.
 *
 * SHAPE COVERAGE — the generator must produce every awkward case the model claims to handle, or a green run
 * proves only that the easy path works:
 *   multiple entries per participant · payer ≠ player · partial payments · overpayments · multiple pools ·
 *   multiple competition editions · ties · phase transitions · ranking snapshots · outbox retries ·
 *   identity aliases · duplicate-candidate participants (never merged)
 *
 * Usage:
 *   node scripts/db/synthetic_dataset.mjs --scale=A [--seed=1] [--stats]
 */

import { pathToFileURL } from "node:url";
import { parseMoney, money, sum } from "./financial.mjs";
import { appendToChain } from "./audit.mjs";

/** mulberry32 — small, fast, adequate for fixtures, and identical across platforms. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCALES = {
  A: { name: "SCALE-A", participants: 10, pools: 1, predictions: 100, editions: 1 },
  B: { name: "SCALE-B", participants: 100, pools: 5, predictions: 5_000, editions: 2 },
  C: { name: "SCALE-C", participants: 1_000, pools: 25, predictions: 100_000, editions: 3 },
  D: { name: "SCALE-D", participants: 10_000, pools: 100, predictions: 1_000_000, editions: 4 },
};

const USD = "USD";
const FEE = parseMoney("5.00", USD);

/**
 * Generate a dataset in the target-model shape.
 *
 * Returns plain arrays. At SCALE-D this is a large object held in memory; `generate` is written so the
 * caller can request `predictionsAsCount: true` to get the shape without materialising a million rows —
 * see the bounded-representative note in SCALE_TEST_RESULTS.md.
 */
export function generate({ scale = "A", seed = 1, predictionsAsCount = false } = {}) {
  const cfg = SCALES[scale];
  if (!cfg) throw new Error(`unknown scale ${scale}`);
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const iso = (dayOffset, h = 12) =>
    new Date(Date.UTC(2026, 0, 1 + dayOffset, h, 0, 0)).toISOString();

  // ── competitions, editions, phases ─────────────────────────────────────────
  const competitions = [{ competition_id: "c-1" }];
  const competition_editions = [];
  const competition_edition_phases = [];
  for (let e = 0; e < cfg.editions; e++) {
    const ed = `ed-${e + 1}`;
    competition_editions.push({ competition_edition_id: ed, competition_id: "c-1", season_label: `20${26 + e}` });
    // Phase transitions: contiguous ordinals, each with a cutoff, so DQ-CP-01 and lock logic are exercised.
    for (let p = 0; p < 3; p++) {
      competition_edition_phases.push({
        competition_edition_phase_id: `${ed}-ph-${p + 1}`,
        competition_edition_id: ed,
        ordinal: p + 1,
        cutoff_at: iso(e * 60 + p * 10 + 5),
      });
    }
  }

  // ── participants, with aliases and deliberate duplicate CANDIDATES ─────────
  const participants = [];
  for (let i = 0; i < cfg.participants; i++) {
    const id = `p-${i + 1}`;
    participants.push({
      participant_id: id,
      display_name: `Synthetic Person ${i + 1}`,
      email: i % 7 === 0 ? null : `synthetic-${i + 1}@example.invalid`,
      aliases: i % 11 === 0 ? [`S. Person ${i + 1}`] : [],
      canonical_participant_id: null,
      superseded_at: null,
    });
  }
  // Duplicate candidates: same normalised email, different display name — the shared-mailbox false
  // positive. Never merged; they exist so the candidate detector has something honest to find.
  const dupCount = Math.max(1, Math.floor(cfg.participants / 50));
  const withEmail = participants.filter((p) => p.email);
  for (let i = 0; i < dupCount; i++) {
    // Pick from participants that HAVE an email. The first version indexed by i*2 and skipped when the
    // chosen participant happened to be one of the every-7th email-less ones — so at SCALE-A it produced
    // zero duplicate candidates and the detector had nothing to find.
    const src = withEmail[i % Math.max(1, withEmail.length)];
    if (!src || !src.email) continue;
    participants.push({
      participant_id: `p-dup-${i + 1}`,
      display_name: `Synthetic Relative ${i + 1}`,
      email: src.email.toUpperCase(),
      aliases: [], canonical_participant_id: null, superseded_at: null,
    });
  }

  // ── pools spread across editions ──────────────────────────────────────────
  const pools = [], pool_fee_schedule = [];
  for (let i = 0; i < cfg.pools; i++) {
    const pid = `pool-${i + 1}`;
    pools.push({ pool_id: pid, competition_edition_id: competition_editions[i % cfg.editions].competition_edition_id });
    pool_fee_schedule.push({ pool_fee_schedule_id: `fee-${i + 1}`, pool_id: pid, effective_to: null });
  }

  // ── entries: multiple per participant, spread across pools ────────────────
  const pool_entries = [];
  let entryN = 0;
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    // Every 9th participant holds two entries in the SAME pool with distinct labels (legitimate), and
    // every 13th holds entries in two different pools.
    const nEntries = i % 9 === 0 ? 2 : 1;
    for (let k = 0; k < nEntries; k++) {
      const poolIdx = (i + (i % 13 === 0 ? k * 3 : 0)) % cfg.pools;
      entryN++;
      pool_entries.push({
        pool_entry_id: `e-${entryN}`,
        pool_id: pools[poolIdx].pool_id,
        participant_id: p.participant_id,
        entry_label: k === 0 ? "main" : `alt-${k}`,
        expected: FEE,
        picks: null,
        created_at: iso(i % 30, 9),
        updated_at: iso(i % 30, 9),
        version: 1,
        deleted_at: i % 37 === 0 ? iso(i % 30, 10) : null,   // some withdrawals
        legacy_asserted: false,
      });
    }
  }

  // ── payments and allocations: the awkward financial cases ────────────────
  const payments = [], payment_allocations = [];
  let payN = 0, allocN = 0;
  for (let i = 0; i < pool_entries.length; i++) {
    const e = pool_entries[i];
    if (e.deleted_at) continue;
    const mode = i % 10;

    // Third-party payer on every 5th entry: payer ≠ player.
    const payer = mode === 5 && participants[(i + 1) % participants.length]
      ? participants[(i + 1) % participants.length].participant_id
      : e.participant_id;

    if (mode === 7) continue;                       // UNPAID
    if (mode === 8) {                                // LEGACY_ASSERTED: no amount, no allocation
      payN++;
      payments.push({ payment_id: `pay-${payN}`, payer_participant_id: payer,
        asserted_for_pool_entry_id: e.pool_entry_id, payer_name_as_recorded: null,
        amount: null, currency: USD, kind: "contribution", method: "zelle",
        external_reference: null, legacy_asserted: true });
      e.legacy_asserted = true;
      continue;
    }

    const amountStr = mode === 3 ? "2.50" : mode === 4 ? "7.00" : "5.00";   // partial · overpaid · exact
    payN++;
    const paymentId = `pay-${payN}`;
    payments.push({
      payment_id: paymentId, payer_participant_id: payer,
      asserted_for_pool_entry_id: e.pool_entry_id, payer_name_as_recorded: null,
      amount: parseMoney(amountStr, USD), currency: USD, kind: "contribution",
      method: pick(["zelle", "venmo", "cashapp"]),
      external_reference: `SYNTH-${payN}`, legacy_asserted: false,
      paid_at: iso(i % 30, 14),
    });

    if (mode === 6) {
      // One entry funded by TWO payments: 2.00 + 3.00 = settled exactly.
      allocN++;
      payment_allocations.push({ allocation_id: `al-${allocN}`, payment_id: paymentId,
        pool_entry_id: e.pool_entry_id, allocated_amount: parseMoney("2.00", USD) });
      payN++;
      const second = `pay-${payN}`;
      payments.push({ payment_id: second, payer_participant_id: payer,
        asserted_for_pool_entry_id: e.pool_entry_id, payer_name_as_recorded: null,
        amount: parseMoney("3.00", USD), currency: USD, kind: "contribution", method: "venmo",
        external_reference: `SYNTH-${payN}`, legacy_asserted: false, paid_at: iso(i % 30, 15) });
      allocN++;
      payment_allocations.push({ allocation_id: `al-${allocN}`, payment_id: second,
        pool_entry_id: e.pool_entry_id, allocated_amount: parseMoney("3.00", USD) });
    } else {
      allocN++;
      payment_allocations.push({ allocation_id: `al-${allocN}`, payment_id: paymentId,
        pool_entry_id: e.pool_entry_id, allocated_amount: parseMoney(amountStr, USD) });
    }
  }

  // ── matches, ties, results ───────────────────────────────────────────────
  const matches = [], ties = [], match_results = [];
  const matchesPerEdition = Math.max(8, Math.ceil(cfg.predictions / Math.max(1, pool_entries.length)) * 2);
  let matchN = 0, tieN = 0, resN = 0;
  for (const ed of competition_editions) {
    const phases = competition_edition_phases.filter((p) => p.competition_edition_id === ed.competition_edition_id);
    for (let m = 0; m < matchesPerEdition; m++) {
      matchN++;
      const phase = phases[m % phases.length];
      const finished = m % 4 !== 3;                    // most finished, some not
      matches.push({ match_id: `m-${matchN}`, competition_edition_phase_id: phase.competition_edition_phase_id,
        status: finished ? "finished" : "scheduled" });
      if (finished) {
        resN++;
        const h = matchN % 4, a = (matchN + 1) % 4;
        match_results.push({ match_result_id: `r-${resN}`, match_id: `m-${matchN}`,
          is_official: true, superseded_by_id: null, h, a });
      }
      // Knockout ties with an explicit advancing team, so draws are resolved not inferred.
      if (m % 6 === 5) {
        tieN++;
        ties.push({ tie_id: `t-${tieN}`, competition_edition_phase_id: phase.competition_edition_phase_id,
          advancing_team: `TEAM_${tieN % 2 === 0 ? "A" : "B"}` });
      }
    }
  }

  // ── predictions ──────────────────────────────────────────────────────────
  const activeEntries = pool_entries.filter((e) => !e.deleted_at);
  const predictionsTarget = cfg.predictions;
  let predictions = [];
  let predictionCount = 0;
  if (predictionsAsCount) {
    predictionCount = predictionsTarget;
  } else {
    const perEntry = Math.max(1, Math.floor(predictionsTarget / Math.max(1, activeEntries.length)));
    let n = 0, entryIdx = 0;
    for (const e of activeEntries) {
      const entryOffset = (entryIdx++ * 3) % Math.max(1, matches.length);
      /**
       * Each entry's predictions must address DISTINCT matches. The first version indexed by `(n + k)`,
       * which repeats a match within an entry once k wraps — DQ-PR-02 caught 10 duplicate (entry, subject)
       * pairs on the first run. Stepping by k from a per-entry offset guarantees distinctness while still
       * spreading entries across the fixture.
       */
      const used = new Set();
      for (let k = 0; k < perEntry && n < predictionsTarget && used.size < matches.length; k++) {
        const match = matches[(entryOffset + k) % matches.length];
        if (used.has(match.match_id)) continue;
        used.add(match.match_id);
        const phase = competition_edition_phases.find((p) => p.competition_edition_phase_id === match.competition_edition_phase_id);
        n++;
        predictions.push({
          prediction_id: `pr-${n}`,
          pool_entry_id: e.pool_entry_id,
          match_id: match.match_id,
          tie_id: null,
          home_goals: n % 4,
          away_goals: (n + 2) % 4,
          // Always before the cutoff: a prediction after lock is a defect the DQ rules must catch, so it
          // is injected deliberately by the fault-injection helper, never by the baseline generator.
          submitted_at: new Date(new Date(phase.cutoff_at).getTime() - 3600_000).toISOString(),
        });
      }
      if (n >= predictionsTarget) break;
    }
    predictionCount = predictions.length;
  }

  // ── ranking snapshots ────────────────────────────────────────────────────
  const ranking_snapshots = [];
  for (const pool of pools) {
    const inPool = activeEntries.filter((e) => e.pool_id === pool.pool_id);
    inPool.slice(0, 10).forEach((e, idx) => {
      ranking_snapshots.push({
        ranking_snapshot_id: `rs-${pool.pool_id}-${idx + 1}`,
        pool_id: pool.pool_id, participant_id: e.participant_id, pool_entry_id: e.pool_entry_id,
        computed_at: iso(40), position: idx + 1, scoring_rule_version: "v1",
      });
    });
  }

  // ── prizes: 70/20/10 on the first pool only, within collected ────────────
  const prize_allocations = [];
  const firstPool = pools[0];
  const firstPoolEntries = new Set(activeEntries.filter((e) => e.pool_id === firstPool.pool_id).map((e) => e.pool_entry_id));
  const collected = sum(payment_allocations.filter((a) => firstPoolEntries.has(a.pool_entry_id))
    .map((a) => a.allocated_amount), USD);
  if (collected.minor > 0) {
    const top = ranking_snapshots.filter((s) => s.pool_id === firstPool.pool_id).slice(0, 3);
    const shares = [70000, 20000, 10000];
    top.forEach((s, i) => {
      const share = money(Math.floor((collected.minor * shares[i]) / 100000), USD);
      prize_allocations.push({ prize_allocation_id: `z-${i + 1}`, pool_id: firstPool.pool_id,
        pool_entry_id: s.pool_entry_id, participant_id: s.participant_id, gross: share, rank_position: i + 1 });
    });
  }

  // ── sync state, outbox with retries ──────────────────────────────────────
  /**
   * `last_success_at` is set to the dataset's own reference "now" (day 60), not an arbitrary earlier day.
   * The first version used day 45 while the harness evaluated freshness at day 50, so DQ-OP-01 reported
   * every cursor stale — a fixture artefact masquerading as a finding. A stale cursor is a case worth
   * testing, so it is injected deliberately by injectFault(), never present in the clean baseline.
   */
  const sync_state = competition_editions.map((ed, i) => ({
    sync_state_id: `s-${i + 1}`, competition_edition_id: ed.competition_edition_id,
    active_phase_id: null, last_success_at: iso(60),
  }));

  const outbox_events = [], outbox_delivery_attempts = [];
  const outboxCount = Math.min(500, Math.max(10, Math.floor(activeEntries.length / 4)));
  for (let i = 0; i < outboxCount; i++) {
    const id = `o-${i + 1}`;
    const mode = i % 5;
    // 0,1 sent first try · 2 sent after a retry · 3 pending after a transient failure · 4 dead
    const status = mode <= 1 ? "sent" : mode === 2 ? "sent" : mode === 3 ? "pending" : "dead";
    const attempts = mode <= 1 ? 1 : mode === 2 ? 2 : mode === 3 ? 1 : 3;
    outbox_events.push({
      outbox_event_id: id, idempotency_key: `k-${i + 1}`, channel: "email",
      event_type: "participant_receipt", payload: null, status, attempt_count: attempts,
      next_attempt_at: iso(46), dead_at: status === "dead" ? iso(47) : null,
      correlation_id: `corr-${i + 1}`, created_at: iso(45),
    });
    for (let k = 1; k <= attempts; k++) {
      const last = k === attempts;
      const outcome = status === "sent" ? (last ? "success" : "transient_failure")
        : status === "dead" ? (last ? "permanent_failure" : "transient_failure")
        : "transient_failure";
      outbox_delivery_attempts.push({ outbox_delivery_attempt_id: `${id}#${k}`, outbox_event_id: id,
        attempt_number: k, outcome, occurred_at: iso(45 + k) });
    }
  }

  // ── audit chain ──────────────────────────────────────────────────────────
  /**
   * Built with the real audit module, so the chain genuinely verifies.
   * The first version used placeholder hashes (`h1`, `h2`, …); verifyChain recomputes the hash from the row
   * contents and correctly rejected them, reporting a broken chain that was only ever a fixture artefact.
   * A fixture that cannot pass the check it feeds is worse than no fixture.
   */
  let audit_events = [];
  const auditCount = Math.min(1000, activeEntries.length);
  for (let i = 0; i < auditCount; i++) {
    audit_events = appendToChain(audit_events, {
      // Monotonic: minute-resolution offsets from a fixed base. The first version cycled the HOUR every
      // 20 events, so timestamps moved backwards — harmless to the chain itself, but it made any
      // timestamp-ordered reader see a scrambled sequence.
      id: `a-${i + 1}`, occurredAt: new Date(Date.UTC(2026, 1, 20, 0, 0, 0) + i * 60_000).toISOString(),
      actorRole: "service", action: "entry_created", source: "edge_function",
      aggregateType: "pool_entry", aggregateId: activeEntries[i].pool_entry_id,
      correlationId: `corr-a-${i + 1}`, safeMetadata: { entry_index: i },
    });
  }

  return {
    meta: { scale: cfg.name, seed, predictionsMaterialized: !predictionsAsCount, predictionCount },
    participants, participant_identity_links: [],
    competitions, competition_editions, competition_edition_phases,
    pools, pool_fee_schedule, pool_entries,
    payments, payment_allocations, prize_allocations,
    ties, matches, match_results, predictions,
    ranking_snapshots, sync_state, audit_events,
    outbox_events, outbox_delivery_attempts,
  };
}

/** Row counts per collection — the cheap way to describe a dataset without printing it. */
export function datasetStats(d) {
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(d)) {
    if (!Array.isArray(v)) continue;
    out[k] = v.length;
    total += v.length;
  }
  out._total = total;
  return out;
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const scale = (argv.find((a) => a.startsWith("--scale=")) || "--scale=A").split("=")[1];
  const seed = Number((argv.find((a) => a.startsWith("--seed=")) || "--seed=1").split("=")[1]);
  const t0 = Date.now();
  const d = generate({ scale, seed });
  const ms = Date.now() - t0;
  const stats = datasetStats(d);
  console.log(`\n${d.meta.scale} seed=${seed} generated in ${ms} ms\n`);
  for (const [k, v] of Object.entries(stats)) if (k !== "_total") console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(`  ${"TOTAL ROWS".padEnd(30)} ${stats._total}\n`);
}
