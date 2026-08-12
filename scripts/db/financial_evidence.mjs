#!/usr/bin/env node
/**
 * WS9 — financial model hardening and the FINANCIAL_PARITY evidence producer.
 *
 * Extends scripts/db/financial.mjs (exact money, settlement, unapplied balance, reconciliation) with
 * the parts WS9 requires: typed reversal semantics, currency enforcement inside an allocation, the
 * complex funding cases, and a machine-readable artefact that WS5's FINANCIAL_PARITY gate can
 * actually consume. Before this, that gate named evidence nothing could produce.
 *
 * Every amount is an integer number of minor units. There is no float anywhere in this file, and the
 * test suite asserts that against this file's own source.
 */

import {
  money, parseMoney, formatMoney, add, sub, cmp, sum, zero, isZero,
  SETTLEMENT, settlementStatus, unappliedBalance,
} from "./financial.mjs";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS9.1 / WS13-OP-3 — typed payment kinds
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A negative amount is permitted ONLY under an explicitly typed reversal kind, and only with a
 * reference to the payment it reverses. That is the whole content of WS13-OP-3: a refund is a
 * compensating record, never an edit, and never an arbitrary negative payment.
 */
export const PAYMENT_KIND = {
  CONTRIBUTION: "contribution",
  REFUND: "refund",
  REVERSAL: "reversal",
  CHARGEBACK: "chargeback",
};

export const REVERSING_KINDS = new Set([PAYMENT_KIND.REFUND, PAYMENT_KIND.REVERSAL, PAYMENT_KIND.CHARGEBACK]);

export const FIN_VIOLATION = {
  NEGATIVE_NON_REVERSAL: "NEGATIVE_NON_REVERSAL",
  REVERSAL_WITHOUT_ORIGINAL: "REVERSAL_WITHOUT_ORIGINAL",
  REVERSAL_NOT_NEGATIVE: "REVERSAL_NOT_NEGATIVE",
  REVERSAL_EXCEEDS_ORIGINAL: "REVERSAL_EXCEEDS_ORIGINAL",
  REVERSAL_CURRENCY_MISMATCH: "REVERSAL_CURRENCY_MISMATCH",
  REVERSAL_MISSING_METADATA: "REVERSAL_MISSING_METADATA",
  REVERSAL_OF_REVERSAL: "REVERSAL_OF_REVERSAL",
  OVER_ALLOCATION: "OVER_ALLOCATION",
  ALLOCATION_CURRENCY_MISMATCH: "ALLOCATION_CURRENCY_MISMATCH",
  DUPLICATE_ALLOCATION: "DUPLICATE_ALLOCATION",
  ALLOCATION_ORPHAN_PAYMENT: "ALLOCATION_ORPHAN_PAYMENT",
  ALLOCATION_ORPHAN_ENTRY: "ALLOCATION_ORPHAN_ENTRY",
  PRIZE_ALLOCATED_AS_ENTRY_PAYMENT: "PRIZE_ALLOCATED_AS_ENTRY_PAYMENT",
  NEGATIVE_ALLOCATION_NOT_REVERSING: "NEGATIVE_ALLOCATION_NOT_REVERSING",
};

const WHY = Object.freeze({
  [FIN_VIOLATION.NEGATIVE_NON_REVERSAL]: "a negative contribution is money appearing from nowhere; only a typed reversal may be negative",
  [FIN_VIOLATION.REVERSAL_WITHOUT_ORIGINAL]: "a refund with nothing to refund creates a credit against no payment",
  [FIN_VIOLATION.REVERSAL_NOT_NEGATIVE]: "a positive refund adds money instead of returning it",
  [FIN_VIOLATION.REVERSAL_EXCEEDS_ORIGINAL]: "refunding more than was received is the double-refund exploit",
  [FIN_VIOLATION.REVERSAL_CURRENCY_MISMATCH]: "a reversal must return the currency that was received; converting it silently invents an exchange rate",
  [FIN_VIOLATION.REVERSAL_MISSING_METADATA]: "WS13-OP-3 requires reason, actor and timestamp preserved on every compensating record",
  [FIN_VIOLATION.REVERSAL_OF_REVERSAL]: "reversing a reversal is an un-refund; it must be recorded as a new contribution so the chain stays readable",
  [FIN_VIOLATION.OVER_ALLOCATION]: "sum of allocations exceeds the payment; the surplus is money that was never received",
  [FIN_VIOLATION.ALLOCATION_CURRENCY_MISMATCH]: "an allocation in a different currency from its payment implies a conversion nobody recorded",
  [FIN_VIOLATION.DUPLICATE_ALLOCATION]: "the same payment applied twice to the same entry double-counts a single transfer",
  [FIN_VIOLATION.ALLOCATION_ORPHAN_PAYMENT]: "an allocation referencing no payment is money with no source",
  [FIN_VIOLATION.ALLOCATION_ORPHAN_ENTRY]: "an allocation referencing no entry is money applied to nothing",
  [FIN_VIOLATION.PRIZE_ALLOCATED_AS_ENTRY_PAYMENT]: "prizes flow out of a pool and entry payments flow in; mixing them makes the pool's net position wrong in both directions at once",
  [FIN_VIOLATION.NEGATIVE_ALLOCATION_NOT_REVERSING]: "a negative allocation is only meaningful when it un-applies a reversing payment",
});

export function violationReason(v) { return WHY[v] || null; }

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS9.1 — invariant checking
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Check every declared financial invariant over a dataset.
 *
 * `dataset`: { entries, payments, allocations, prizes } where amounts are `{minor, currency}`.
 * `entries[i].expected` may be `null`, meaning the fee is UNKNOWN — never a number we invented.
 *
 * Returns `{ ok, violations }`. Nothing is mutated and nothing is corrected: this reports.
 */
export function checkInvariants(dataset = {}) {
  const { entries = [], payments = [], allocations = [], prizes = [] } = dataset;
  const violations = [];
  const flag = (v, subject, detail = {}) => violations.push({ violation: v, subject, why: WHY[v], ...detail });

  const paymentById = new Map(payments.map((p) => [p.payment_id, p]));
  const entryById = new Map(entries.map((e) => [e.pool_entry_id, e]));

  // ── payments
  for (const p of payments) {
    const kind = p.kind || PAYMENT_KIND.CONTRIBUTION;
    const amt = p.amount;
    const reversing = REVERSING_KINDS.has(kind);

    if (amt && amt.minor < 0 && !reversing) flag(FIN_VIOLATION.NEGATIVE_NON_REVERSAL, p.payment_id, { kind });
    if (reversing) {
      if (amt && amt.minor >= 0) flag(FIN_VIOLATION.REVERSAL_NOT_NEGATIVE, p.payment_id, { kind });
      const origId = p.reverses_payment_id;
      const orig = origId ? paymentById.get(origId) : null;
      if (!orig) { flag(FIN_VIOLATION.REVERSAL_WITHOUT_ORIGINAL, p.payment_id, { kind }); }
      else {
        if (REVERSING_KINDS.has(orig.kind)) flag(FIN_VIOLATION.REVERSAL_OF_REVERSAL, p.payment_id);
        else if (orig.amount && amt) {
          if (orig.amount.currency !== amt.currency) flag(FIN_VIOLATION.REVERSAL_CURRENCY_MISMATCH, p.payment_id);
          else {
            // Total reversed against this original, across ALL reversing rows — a single-row check
            // would let two half-refunds sum past the original.
            const totalReversed = payments.filter((q) => REVERSING_KINDS.has(q.kind) && q.reverses_payment_id === origId)
              .reduce((s, q) => s + Math.abs(q.amount?.minor ?? 0), 0);
            if (totalReversed > orig.amount.minor) {
              flag(FIN_VIOLATION.REVERSAL_EXCEEDS_ORIGINAL, p.payment_id,
                { totalReversedMinor: totalReversed, originalMinor: orig.amount.minor });
            }
          }
        }
      }
      for (const k of ["reason", "actor", "occurred_at"]) {
        if (!p[k]) { flag(FIN_VIOLATION.REVERSAL_MISSING_METADATA, p.payment_id, { missing: k }); break; }
      }
    }
  }

  // ── allocations
  const seenPair = new Set();
  for (const a of allocations) {
    const p = paymentById.get(a.payment_id);
    if (!p) { flag(FIN_VIOLATION.ALLOCATION_ORPHAN_PAYMENT, a.payment_id || "(none)"); continue; }
    if (!entryById.has(a.pool_entry_id)) flag(FIN_VIOLATION.ALLOCATION_ORPHAN_ENTRY, a.pool_entry_id || "(none)");
    if (p.amount && a.amount && p.amount.currency !== a.amount.currency) {
      flag(FIN_VIOLATION.ALLOCATION_CURRENCY_MISMATCH, `${a.payment_id}->${a.pool_entry_id}`,
        { paymentCurrency: p.amount.currency, allocationCurrency: a.amount.currency });
    }
    const key = `${a.payment_id}|${a.pool_entry_id}`;
    if (seenPair.has(key)) flag(FIN_VIOLATION.DUPLICATE_ALLOCATION, key);
    seenPair.add(key);
    if (a.amount && a.amount.minor < 0 && !REVERSING_KINDS.has(p.kind)) {
      flag(FIN_VIOLATION.NEGATIVE_ALLOCATION_NOT_REVERSING, key);
    }
    if (p.kind === "prize") flag(FIN_VIOLATION.PRIZE_ALLOCATED_AS_ENTRY_PAYMENT, key);
  }

  // ── sum(allocations) <= payment.amount, per payment
  for (const p of payments) {
    if (!p.amount) continue; // legacy_asserted: no amount ever existed
    const mine = allocations.filter((a) => a.payment_id === p.payment_id && a.amount);
    if (!mine.length) continue;
    if (mine.some((a) => a.amount.currency !== p.amount.currency)) continue; // already reported
    const allocated = mine.reduce((s, a) => s + a.amount.minor, 0);
    const exceeds = p.amount.minor >= 0 ? allocated > p.amount.minor : allocated < p.amount.minor;
    if (exceeds) {
      flag(FIN_VIOLATION.OVER_ALLOCATION, p.payment_id,
        { allocatedMinor: allocated, paymentMinor: p.amount.minor });
    }
  }

  // ── prizes must not be represented as entry payments
  for (const z of prizes) {
    if (allocations.some((a) => a.payment_id === z.prize_id)) {
      flag(FIN_VIOLATION.PRIZE_ALLOCATED_AS_ENTRY_PAYMENT, z.prize_id);
    }
  }

  return { ok: violations.length === 0, violations };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS9.2 / WS9.3 — per-entry settlement across the complex funding cases
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Effective allocation for one entry: allocations applied, minus the portion of any allocation whose
 * payment was later reversed. A refund must move settlement BACKWARDS — otherwise an entry stays
 * "settled" on money that was returned.
 *
 * The reversal is apportioned across the original payment's allocations in proportion to each
 * allocation's share, using integer arithmetic with the remainder given to the largest share so the
 * parts always sum exactly to the whole. Nothing is rounded away.
 */
export function effectiveAllocated(entry, { payments = [], allocations = [] }, currency) {
  const paymentById = new Map(payments.map((p) => [p.payment_id, p]));
  const mine = allocations.filter((a) => a.pool_entry_id === entry.pool_entry_id && a.amount);
  if (!mine.length) return zero(currency);

  let total = 0;
  for (const a of mine) {
    const p = paymentById.get(a.payment_id);
    if (!p) continue;
    if (REVERSING_KINDS.has(p.kind)) { total += a.amount.minor; continue; } // an explicit negative allocation
    total += a.amount.minor;

    // Reversals recorded against this payment WITHOUT their own allocations reduce it pro rata.
    const reversals = payments.filter((q) => REVERSING_KINDS.has(q.kind) && q.reverses_payment_id === p.payment_id
      && !allocations.some((x) => x.payment_id === q.payment_id));
    if (!reversals.length || !p.amount || p.amount.minor === 0) continue;
    const reversedMinor = reversals.reduce((s, q) => s + Math.abs(q.amount?.minor ?? 0), 0);
    const siblings = allocations.filter((x) => x.payment_id === p.payment_id && x.amount);
    const allocatedTotal = siblings.reduce((s, x) => s + x.amount.minor, 0);
    if (allocatedTotal === 0) continue;

    // Apportion the reversal across the payment's allocations, pro rata.
    //
    // BigInt, not `Math.floor(a / b)`. IEEE division returns the correctly-rounded quotient, and
    // flooring a value that rounded UP to an integer yields a share one minor unit too large. The
    // magnitudes here would almost certainly never trigger it — which is exactly the kind of
    // "correct because the numbers are small" reasoning that stops holding when someone changes the
    // currency or the scale. BigInt division is integer division; there is no rounding to be wrong.
    const rev = BigInt(reversedMinor), tot = BigInt(allocatedTotal);
    const floorShare = (allocMinor) => (rev * BigInt(allocMinor)) / tot;
    let share = floorShare(a.amount.minor);

    // The floors lose up to (siblings-1) minor units. Give the remainder to the LARGEST allocation,
    // deterministically tie-broken by id, so the parts always sum to exactly the reversed amount and
    // the same input always produces the same split.
    const distributed = siblings.reduce((s, x) => s + floorShare(x.amount.minor), 0n);
    const remainder = rev - distributed;
    const largest = [...siblings].sort((x, y) => (y.amount.minor - x.amount.minor) ||
      `${x.payment_id}|${x.pool_entry_id}`.localeCompare(`${y.payment_id}|${y.pool_entry_id}`))[0];
    if (remainder > 0n && largest.payment_id === a.payment_id && largest.pool_entry_id === a.pool_entry_id) {
      share += remainder;
    }
    total -= Number(share);
  }
  return money(total, currency);
}

export function entrySettlement(entry, dataset, currency) {
  if (entry.expected === null || entry.expected === undefined) {
    return { status: SETTLEMENT.UNKNOWN, expected: null, allocated: effectiveAllocated(entry, dataset, currency) };
  }
  const allocated = effectiveAllocated(entry, dataset, currency);
  return {
    status: settlementStatus({ expected: entry.expected, allocated, legacyAsserted: !!entry.legacy_asserted }),
    expected: entry.expected, allocated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WS9.4 — the FINANCIAL_PARITY artefact
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Produce the machine-readable financial artefact WS5's FINANCIAL_PARITY gate consumes.
 *
 * Every total is an exact decimal string. Counts of entries are broken out per settlement state,
 * including `entries_unknown`, which must never be folded into `entries_unpaid`: an entry whose fee
 * we never knew is not an entry that failed to pay, and reporting it as one would manufacture a
 * finding a human would then go chasing.
 */
export function financialArtifact(dataset = {}, { currency = "USD" } = {}) {
  const { entries = [], payments = [], allocations = [], prizes = [] } = dataset;
  const inv = checkInvariants(dataset);

  const contributions = payments.filter((p) => !REVERSING_KINDS.has(p.kind || PAYMENT_KIND.CONTRIBUTION));
  const reversals = payments.filter((p) => REVERSING_KINDS.has(p.kind));

  const known = entries.filter((e) => e.expected !== null && e.expected !== undefined);
  const expectedTotal = known.reduce((s, e) => s + e.expected.minor, 0);
  const paidTotal = contributions.reduce((s, p) => s + (p.amount?.minor ?? 0), 0);
  const allocatedTotal = allocations.reduce((s, a) => s + (a.amount?.minor ?? 0), 0);
  const refundTotal = reversals.reduce((s, p) => s + Math.abs(p.amount?.minor ?? 0), 0);
  const prizeTotal = prizes.reduce((s, z) => s + (z.amount?.minor ?? z.gross?.minor ?? 0), 0);

  const tally = { unpaid: 0, partially_paid: 0, settled: 0, overpaid: 0, legacy_asserted: 0, unknown: 0 };
  for (const e of entries) tally[entrySettlement(e, dataset, currency).status]++;

  const dec = (minor) => formatMoney(money(minor, currency)).replace(` ${currency}`, "");

  return {
    producer: "WS9 financial_evidence.financialArtifact",
    currency,
    expected_total: dec(expectedTotal),
    paid_total: dec(paidTotal),
    allocated_total: dec(allocatedTotal),
    unallocated_total: dec(paidTotal - refundTotal - allocatedTotal),
    refund_total: dec(refundTotal),
    prize_total: dec(prizeTotal),
    entries_unpaid: tally.unpaid,
    entries_partial: tally.partially_paid,
    entries_settled: tally.settled,
    entries_overpaid: tally.overpaid,
    entries_legacy_asserted: tally.legacy_asserted,
    entries_unknown: tally.unknown,
    entries_total: entries.length,
    invariants_ok: inv.ok,
    violations: inv.violations.map((v) => ({ violation: v.violation, subject: v.subject })),
    // Entries whose fee was never recorded are excluded from expected_total. Stated explicitly so a
    // reader cannot mistake the total for "everything owed".
    expected_total_excludes_unknown_fee_entries: entries.length - known.length,
  };
}

/**
 * FINANCIAL_PARITY verdict, in the shape WS5's promotion evaluator expects:
 * `{ checked, mismatches }` per parity class, plus the full artefacts for audit.
 *
 * Tolerance is ZERO. A mismatch is any field that differs, and the fields are exact decimal strings,
 * so the comparison is string equality on values that were never floats.
 */
export function financialParity(legacyDataset, normalizedDataset, { currency = "USD" } = {}) {
  const a = financialArtifact(legacyDataset, { currency });
  const b = financialArtifact(normalizedDataset, { currency });

  const MONEY_FIELDS = ["expected_total", "paid_total", "allocated_total", "unallocated_total", "refund_total", "prize_total"];
  const COUNT_FIELDS = ["entries_unpaid", "entries_partial", "entries_settled", "entries_overpaid",
    "entries_legacy_asserted", "entries_unknown", "entries_total"];

  const differences = [];
  for (const f of [...MONEY_FIELDS, ...COUNT_FIELDS]) {
    if (a[f] !== b[f]) differences.push({ field: f, legacy: a[f], normalized: b[f] });
  }
  const invariantFailures = [...a.violations, ...b.violations];

  return {
    producer: "WS9 financial_evidence.financialParity",
    tolerance: "ZERO",
    legacy: a, normalized: b,
    differences,
    // The shape WS5 consumes.
    FINANCIAL_PARITY: {
      checked: MONEY_FIELDS.length + COUNT_FIELDS.length,
      mismatches: differences.length + invariantFailures.length,
    },
    AGGREGATE_PARITY: {
      checked: COUNT_FIELDS.length,
      mismatches: differences.filter((d) => COUNT_FIELDS.includes(d.field)).length,
    },
    verdict: differences.length === 0 && invariantFailures.length === 0 ? "EXACT" : "FAIL",
    invariantFailures: invariantFailures.map((v) => v.violation),
  };
}

/** Guard: this module must contain no float arithmetic on money. Asserted against its own source. */
export const FLOAT_PATTERNS = [/parseFloat\s*\(/, /\.toFixed\s*\(/, /\/\s*100(?![0-9])/];

export default { checkInvariants, financialArtifact, financialParity, entrySettlement, effectiveAllocated, PAYMENT_KIND, FIN_VIOLATION };
