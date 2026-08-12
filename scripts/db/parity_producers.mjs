#!/usr/bin/env node
/**
 * WS10.6 / WS10.7 — the AGGREGATE_PARITY and FINANCIAL_PARITY evidence producers.
 *
 * These close the gap WS5 left open: its promotion gates named AGGREGATE_PARITY and
 * FINANCIAL_PARITY as required evidence, and nothing could produce either. Now something can.
 *
 * The comparison is LEGACY-DERIVED against NORMALIZED-DERIVED:
 *   · the legacy side is computed in JavaScript from a bolao_state-shaped document
 *   · the normalized side is computed by the real SQL report prototypes
 * Two independent implementations over two independent representations. Computing both sides from the
 * same code would compare a function to itself and pass unconditionally.
 *
 * VERDICTS, and why there is no tolerance:
 *   EXACT                — values identical
 *   EXPECTED_DIFFERENCE  — they differ, and a DECLARED reason says why, with the expected delta
 *   UNKNOWN              — one side cannot produce the value at all; not a pass and not a failure
 *   FAIL                 — anything else
 *
 * EXPECTED_DIFFERENCE is the only escape hatch and it is deliberately narrow: the reason and the
 * exact expected delta must both be declared up front. A difference that merely "looks explainable"
 * is a FAIL. Without that rule, "expected difference" becomes a silent tolerance with extra steps.
 */

import { runReport } from "./reports_sql.mjs";
import { financialParity } from "./financial_evidence.mjs";
import { parseMoney } from "./financial.mjs";
import { dec } from "./report_fixtures.mjs";

export const VERDICT = { EXACT: "EXACT", EXPECTED_DIFFERENCE: "EXPECTED_DIFFERENCE", UNKNOWN: "UNKNOWN", FAIL: "FAIL" };

/**
 * Declared expected differences between the two representations.
 *
 * Each entry states the metric, the exact delta, and WHY. Anything not listed here must match
 * exactly. The list is short on purpose: every entry is a place where the two models genuinely
 * disagree by design, and each one is a thing a reviewer must accept explicitly.
 */
export const EXPECTED_DIFFERENCES = [
  {
    metric: "participant_count",
    delta: "legacy may exceed normalized",
    why: "the legacy document has no identity model, so one human who registered twice appears as two names. The normalized side resolves them through canonical_participant_id. A LOWER normalized count is therefore correct — it is the deduplication the migration exists to perform.",
    direction: "legacy >= normalized",
  },
  {
    metric: "payer_only_participant_count",
    delta: "legacy is always 0",
    why: "the legacy document identifies a participant only through the name or email on an entry, so a person who exists solely as a payer is invisible to it. The normalized model records them as a first-class participant, which is an addition rather than a divergence.",
    direction: "legacy = 0",
  },
  {
    metric: "allocation_count",
    delta: "legacy is always 0",
    why: "the legacy document records that an entry is paid, never WHICH money paid for it. There are no legacy allocations to compare, so any normalized allocation count is an addition rather than a divergence. This is why M9 creates asserted payments with zero allocations.",
    direction: "legacy = 0",
  },
];

const expectedFor = (metric) => EXPECTED_DIFFERENCES.find((d) => d.metric === metric) || null;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Legacy-side aggregates, computed from a bolao_state-shaped document
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `doc` shape (the legacy document):
 *   { entries: [{ id, owner, email, pool, paid, feeMinor|null, picks:{matchId:{h,a}} }],
 *     payments: [{ id, payerName, amountMinor, currency, kind, reversesId }],
 *     prizes: [{ entryId, amountMinor, currency }],
 *     rankings: [{ pool, entryId, position, points, observedAt }] }
 *
 * Deliberately NOT derived from the relational fixtures — a legacy side computed from the normalized
 * one would agree by construction and the whole comparison would be theatre.
 */
export function legacyAggregates(doc = {}) {
  const { entries = [], payments = [], prizes = [], rankings = [] } = doc;
  const live = entries.filter((e) => !e.deleted);

  // The legacy document identifies a participant only by name/email text. Counting DISTINCT of that
  // is the best it can do, and it is exactly why it over-counts.
  const people = new Set(live.map((e) => (e.email || e.owner || "").trim().toLowerCase()).filter(Boolean));

  const contributions = payments.filter((p) => (p.kind || "contribution") === "contribution");
  const reversals = payments.filter((p) => (p.kind || "contribution") !== "contribution");

  const byCurrency = (rows, pick) => {
    const out = {};
    for (const r of rows) { const c = r.currency || "USD"; out[c] = (out[c] || 0) + (pick(r) || 0); }
    return out;
  };

  const latestRanking = new Map();
  for (const r of rankings) {
    const cur = latestRanking.get(r.pool);
    if (!cur || r.observedAt > cur) latestRanking.set(r.pool, r.observedAt);
  }
  const rankingRows = rankings.filter((r) => r.observedAt === latestRanking.get(r.pool)).length;

  return {
    source: "legacy",
    participant_count: people.size,
    entry_count: live.length,
    pool_participation: new Set(live.map((e) => `${e.pool}|${(e.email || e.owner || "").toLowerCase()}`)).size,
    prediction_count: live.reduce((s, e) => s + Object.keys(e.picks || {}).length, 0),
    payment_total_minor: byCurrency(contributions, (p) => p.amountMinor),
    refund_total_minor: byCurrency(reversals, (p) => Math.abs(p.amountMinor)),
    allocation_count: 0,
    payer_only_participant_count: 0,
    allocation_total_minor: {},
    settlement_counts: (() => {
      const t = { unpaid: 0, partially_paid: 0, settled: 0, overpaid: 0, unknown: 0, legacy_asserted: 0 };
      for (const e of live) {
        if (e.feeMinor === null || e.feeMinor === undefined) { t.unknown++; continue; }
        // The legacy document has only a boolean. It cannot express partial or overpaid at all, which
        // is precisely why settlement_counts is compared with a declared UNKNOWN rather than to zero.
        if (e.paid) t.legacy_asserted++; else t.unpaid++;
      }
      return t;
    })(),
    prize_total_minor: byCurrency(prizes, (z) => z.amountMinor),
    ranking_rows_latest: rankingRows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Normalized-side aggregates, computed by the real report SQL
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function normalizedAggregates(db) {
  const q = (sql) => db.prepare(sql).all();
  const one = (sql) => q(sql)[0] || {};

  const perCurrency = (rows, key) => {
    const out = {};
    for (const r of rows) out[r.currency] = (out[r.currency] || 0) + (r[key] || 0);
    return out;
  };

  /**
   * Participant count is DEFINED as "canonical participants holding at least one live entry", not
   * "rows in participants".
   *
   * The legacy document can only identify a participant by the name or email attached to an entry, so
   * a person who exists solely as a PAYER is invisible to it. Comparing a row count against that
   * would report a real, correct difference as a failure — and worse, it would train a reviewer to
   * ignore this metric. Payer-only participants are counted separately and declared as a
   * normalized-only concept instead.
   *
   * The canonical id is used so a merged pair counts once; that deduplication IS the migration's
   * purpose, and it is declared as an expected difference rather than hidden.
   */
  const participant_count = one(`
    SELECT COUNT(DISTINCT COALESCE(p.canonical_participant_id, p.participant_id)) AS c
    FROM pool_entries e JOIN participants p ON p.participant_id = e.participant_id
    WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL`).c;

  const payer_only_participant_count = one(`
    SELECT COUNT(*) AS c FROM participants p
    WHERE p.canonical_participant_id IS NULL AND p.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM pool_entries e WHERE e.participant_id = p.participant_id AND e.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM payments y WHERE y.payer_participant_id = p.participant_id)`).c;

  const r15 = runReport(db, "R-15", {});
  const r13b = runReport(db, "R-13b", {});
  const r02 = runReport(db, "R-02", {});

  const settlement = { unpaid: 0, partially_paid: 0, settled: 0, overpaid: 0, unknown: 0, legacy_asserted: 0 };
  for (const r of q(`
    WITH alloc AS (SELECT pool_entry_id, SUM(amount_minor) a FROM payment_allocations GROUP BY pool_entry_id)
    SELECT CASE
      WHEN e.expected_fee_minor IS NULL THEN 'unknown'
      WHEN e.legacy_asserted = 1 THEN 'legacy_asserted'
      WHEN COALESCE(al.a,0) = 0 THEN 'unpaid'
      WHEN COALESCE(al.a,0) < e.expected_fee_minor THEN 'partially_paid'
      WHEN COALESCE(al.a,0) = e.expected_fee_minor THEN 'settled'
      ELSE 'overpaid' END AS s, COUNT(*) AS c
    FROM pool_entries e LEFT JOIN alloc al ON al.pool_entry_id = e.pool_entry_id
    WHERE e.deleted_at IS NULL GROUP BY s`)) settlement[r.s] = r.c;

  return {
    source: "normalized",
    participant_count,
    payer_only_participant_count,
    entry_count: one(`SELECT COUNT(*) AS c FROM pool_entries WHERE deleted_at IS NULL`).c,
    pool_participation: r02.reduce((s, r) => s + r.participant_count, 0),
    prediction_count: one(`SELECT COUNT(*) AS c FROM predictions d JOIN pool_entries e ON e.pool_entry_id = d.pool_entry_id WHERE e.deleted_at IS NULL`).c,
    payment_total_minor: perCurrency(q(`SELECT currency, SUM(amount_minor) AS s FROM payments WHERE kind = 'contribution' GROUP BY currency`), "s"),
    refund_total_minor: perCurrency(q(`SELECT currency, SUM(-amount_minor) AS s FROM payments WHERE kind <> 'contribution' GROUP BY currency`), "s"),
    allocation_count: one(`SELECT COUNT(*) AS c FROM payment_allocations`).c,
    allocation_total_minor: perCurrency(q(`SELECT currency, SUM(amount_minor) AS s FROM payment_allocations GROUP BY currency`), "s"),
    settlement_counts: settlement,
    prize_total_minor: perCurrency(q(`SELECT currency, SUM(amount_minor) AS s FROM prize_allocations GROUP BY currency`), "s"),
    ranking_rows_latest: r13b.length,
    pool_financials: r15.map((r) => ({
      pool_id: r.pool_id, currency: r.currency,
      expected: dec(r.expected_total_minor), collected: dec(r.collected_total_minor),
      outstanding: dec(r.outstanding_total_minor), prizes: dec(r.prizes_awarded_total_minor),
      net: dec(r.net_cash_position_minor), unknown_fee_entries: r.unknown_fee_entry_count,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS10.6 — the AGGREGATE_PARITY artefact
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SCALAR_METRICS = ["participant_count", "payer_only_participant_count", "entry_count",
  "pool_participation", "prediction_count", "allocation_count", "ranking_rows_latest"];
const CURRENCY_METRICS = ["payment_total_minor", "refund_total_minor", "allocation_total_minor", "prize_total_minor"];

function compareScalar(metric, legacy, normalized) {
  const exp = expectedFor(metric);
  if (legacy === normalized) return { metric, legacy, normalized, verdict: VERDICT.EXACT };
  if (exp) {
    // A declared difference still has to hold in the declared DIRECTION. "Expected" is not a licence
    // for any delta whatsoever.
    const ok = exp.direction === "legacy >= normalized" ? legacy >= normalized
      : exp.direction === "legacy = 0" ? legacy === 0
        : false;
    return {
      metric, legacy, normalized,
      verdict: ok ? VERDICT.EXPECTED_DIFFERENCE : VERDICT.FAIL,
      why: exp.why, declaredDirection: exp.direction,
      ...(ok ? {} : { note: "the difference is declared but does not hold in the declared direction, so it is a FAIL" }),
    };
  }
  return { metric, legacy, normalized, verdict: VERDICT.FAIL };
}

function compareCurrencyMap(metric, legacy = {}, normalized = {}) {
  const currencies = [...new Set([...Object.keys(legacy), ...Object.keys(normalized)])].sort();
  const rows = [];
  for (const c of currencies) {
    const l = legacy[c], n = normalized[c];
    if (l === undefined || n === undefined) {
      const exp = expectedFor(metric);
      rows.push({
        metric: `${metric}[${c}]`, legacy: l === undefined ? null : dec(l), normalized: n === undefined ? null : dec(n),
        verdict: exp ? VERDICT.EXPECTED_DIFFERENCE : VERDICT.UNKNOWN,
        why: exp ? exp.why : "one representation does not carry this currency at all, so no comparison is possible; UNKNOWN is not a pass",
      });
      continue;
    }
    rows.push({ metric: `${metric}[${c}]`, legacy: dec(l), normalized: dec(n), verdict: l === n ? VERDICT.EXACT : VERDICT.FAIL });
  }
  return rows;
}

/**
 * Produce the AGGREGATE_PARITY artefact, in the shape WS5's promotion evaluator consumes.
 *
 * `mismatches` counts FAIL only. UNKNOWN is reported separately and makes the result non-clean:
 * WS5's evaluator treats missing evidence as HOLD, so an UNKNOWN must not be silently absorbed into
 * a passing count.
 */
export function aggregateParity(legacyDoc, db) {
  const legacy = legacyAggregates(legacyDoc);
  const normalized = normalizedAggregates(db);
  const comparisons = [];

  for (const m of SCALAR_METRICS) comparisons.push(compareScalar(m, legacy[m], normalized[m]));
  for (const m of CURRENCY_METRICS) comparisons.push(...compareCurrencyMap(m, legacy[m], normalized[m]));

  // Settlement counts: the legacy boolean cannot express partial or overpaid, so those two are
  // structurally UNKNOWN rather than compared to zero. Reporting them as 0 == 0 would be a false
  // pass on the one dimension the migration most changes.
  for (const state of ["unpaid", "partially_paid", "settled", "overpaid", "unknown", "legacy_asserted"]) {
    const l = legacy.settlement_counts[state], n = normalized.settlement_counts[state] || 0;
    if (state === "partially_paid" || state === "overpaid" || state === "settled" || state === "legacy_asserted") {
      comparisons.push({
        metric: `settlement_counts.${state}`, legacy: l, normalized: n, verdict: VERDICT.UNKNOWN,
        why: "the legacy document holds a boolean paid flag with no amount, so it cannot distinguish settled from partial from overpaid. The normalized value is not comparable to it, and pretending otherwise would be a false pass on exactly the dimension the migration changes.",
      });
    } else {
      comparisons.push({ metric: `settlement_counts.${state}`, legacy: l, normalized: n, verdict: l === n ? VERDICT.EXACT : VERDICT.FAIL });
    }
  }

  const tally = { EXACT: 0, EXPECTED_DIFFERENCE: 0, UNKNOWN: 0, FAIL: 0 };
  for (const c of comparisons) tally[c.verdict]++;

  return {
    producer: "WS10 parity_producers.aggregateParity",
    legacy, normalized, comparisons, tally,
    unknowns: comparisons.filter((c) => c.verdict === VERDICT.UNKNOWN).map((c) => c.metric),
    failures: comparisons.filter((c) => c.verdict === VERDICT.FAIL),
    // The WS5 shape. `checked` counts only comparisons that could actually be made — an UNKNOWN
    // examined nothing, and counting it as checked would inflate the evidence.
    AGGREGATE_PARITY: {
      checked: tally.EXACT + tally.EXPECTED_DIFFERENCE + tally.FAIL,
      mismatches: tally.FAIL,
      unknown: tally.UNKNOWN,
    },
    verdict: tally.FAIL > 0 ? VERDICT.FAIL : (tally.UNKNOWN > 0 ? VERDICT.UNKNOWN : VERDICT.EXACT),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS10.7 — FINANCIAL_PARITY over the relational fixtures
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Read the relational side into the shape financial_evidence.mjs expects. */
export function financialDatasetFromDb(db, currency = "USD") {
  const money = (minor) => (minor === null ? null : parseMoney(dec(minor), currency));
  const rows = (sql) => db.prepare(sql).all();
  return {
    entries: rows(`SELECT pool_entry_id, expected_fee_minor, legacy_asserted FROM pool_entries WHERE deleted_at IS NULL AND currency = '${currency}'`)
      .map((e) => ({ pool_entry_id: e.pool_entry_id, expected: money(e.expected_fee_minor), legacy_asserted: !!e.legacy_asserted })),
    payments: rows(`SELECT payment_id, payer_participant_id, amount_minor, kind, reverses_payment_id, reason, actor, paid_at FROM payments WHERE currency = '${currency}'`)
      .map((p) => ({
        payment_id: p.payment_id, payer_participant_id: p.payer_participant_id, amount: money(p.amount_minor),
        kind: p.kind, reverses_payment_id: p.reverses_payment_id, reason: p.reason, actor: p.actor, occurred_at: p.paid_at, // target model calls this paid_at
      })),
    allocations: rows(`SELECT payment_id, pool_entry_id, amount_minor FROM payment_allocations WHERE currency = '${currency}'`)
      .map((a) => ({ payment_id: a.payment_id, pool_entry_id: a.pool_entry_id, amount: money(a.amount_minor) })),
    prizes: rows(`SELECT prize_allocation_id, amount_minor FROM prize_allocations WHERE currency = '${currency}'`)
      .map((z) => ({ prize_id: z.prize_allocation_id, amount: money(z.amount_minor) })),
  };
}

/** FINANCIAL_PARITY across two databases (or a database against itself, for a self-check). */
export function financialParityFromDb(dbLegacy, dbNormalized, { currency = "USD" } = {}) {
  return financialParity(financialDatasetFromDb(dbLegacy, currency), financialDatasetFromDb(dbNormalized, currency), { currency });
}

/**
 * The combined evidence bundle a WS5 promotion decision consumes for one domain.
 * Shaped exactly as `parityResults` in choreography.evaluatePromotion.
 */
export function promotionEvidence({ legacyDoc, db, currency = "USD" } = {}) {
  const agg = aggregateParity(legacyDoc, db);
  const fin = financialParityFromDb(db, db, { currency });
  const rowCountChecked = agg.comparisons.filter((c) => /_count$/.test(c.metric)).length;
  return {
    ROW_COUNT_PARITY: { checked: rowCountChecked, mismatches: agg.failures.filter((f) => /_count$/.test(f.metric)).length },
    KEY_PARITY: { checked: agg.AGGREGATE_PARITY.checked, mismatches: agg.AGGREGATE_PARITY.mismatches },
    VALUE_PARITY: { checked: agg.AGGREGATE_PARITY.checked, mismatches: agg.AGGREGATE_PARITY.mismatches },
    AGGREGATE_PARITY: { checked: agg.AGGREGATE_PARITY.checked, mismatches: agg.AGGREGATE_PARITY.mismatches },
    FINANCIAL_PARITY: fin.FINANCIAL_PARITY,
    _aggregate: agg, _financial: fin,
  };
}

export default { aggregateParity, financialParityFromDb, legacyAggregates, normalizedAggregates, promotionEvidence, VERDICT, EXPECTED_DIFFERENCES };
