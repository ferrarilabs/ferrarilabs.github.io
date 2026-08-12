/**
 * Decimal-safe money + the financial reconciliation engine (Workstreams D and F).
 *
 * WHY INTEGER MINOR UNITS
 * JavaScript numbers are IEEE-754 doubles. `0.1 + 0.2 === 0.30000000000000004`. A settlement engine
 * built on doubles will eventually declare a fully-paid entry underpaid by a cent, and the failure
 * will be intermittent and unreproducible. So: every amount is carried as an INTEGER number of minor
 * units (cents), parsed once at the boundary and formatted once at the edge. There is no float
 * arithmetic anywhere in this module, and `assertNoFloatArithmetic` is enforced by the test suite.
 *
 * The database side matches: numeric(14,2), never FLOAT/REAL/MONEY — enforced by
 * validate_target_model.mjs.
 *
 * CURRENCY IS NEVER IMPLICIT. Every amount is a {minor, currency} pair. Adding two amounts in
 * different currencies throws rather than silently coercing — cross-currency allocation is a
 * data-quality violation, not a feature (U1: USD is the CURRENT value, not an assumption).
 */

/** @typedef {{ minor: number, currency: string }} Money */

const ISO4217 = /^[A-Z]{3}$/;

export function money(minor, currency) {
  if (!Number.isInteger(minor)) throw new TypeError(`amount must be an integer number of minor units, got ${minor}`);
  if (!ISO4217.test(currency)) throw new TypeError(`currency must be an ISO-4217 code, got ${JSON.stringify(currency)}`);
  return Object.freeze({ minor, currency });
}

/**
 * Parse a decimal string like "5.00" WITHOUT going through a float.
 *
 * The minor-unit value is produced by CONCATENATING digit strings and parsing ONCE, deliberately
 * avoiding `Number(whole) * 100`. That multiplication would in fact be exact here (the regex
 * guarantees `whole` is digits-only), but "exact because of a guarantee three lines up" is the kind
 * of local reasoning that stops holding the moment someone edits the regex. Concatenation needs no
 * such argument: there is no arithmetic to be wrong. It also means the module contains no
 * `Number(...) * 100` shape at all, so the float-pattern scan needs no exception carved out for it.
 */
export function parseMoney(decimalString, currency) {
  const s = String(decimalString).trim();
  const m = s.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new TypeError(`unparseable amount ${JSON.stringify(decimalString)} — expected e.g. "5" or "5.00"`);
  const [, sign, whole, frac = ""] = m;
  const digits = whole + (frac + "00").slice(0, 2); // "5" + "00" -> "500"
  if (digits.length > 15) {
    throw new RangeError(`amount ${JSON.stringify(decimalString)} exceeds the exactly-representable integer range`);
  }
  const cents = Number(digits);
  return money(sign === "-" ? -cents : cents, currency);
}

export function formatMoney(a) {
  const neg = a.minor < 0;
  const abs = Math.abs(a.minor);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${a.currency}`;
}

function sameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new Error(`cross-currency arithmetic refused: ${a.currency} vs ${b.currency}. ` +
      `Converting silently would produce wrong money; an explicit FX step is required.`);
  }
}

export const add = (a, b) => { sameCurrency(a, b); return money(a.minor + b.minor, a.currency); };
export const sub = (a, b) => { sameCurrency(a, b); return money(a.minor - b.minor, a.currency); };
export const cmp = (a, b) => { sameCurrency(a, b); return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0; };
export const isZero = (a) => a.minor === 0;
export const zero = (currency) => money(0, currency);

export function sum(amounts, currency) {
  if (amounts.length === 0) return zero(currency);
  return amounts.reduce((acc, a) => add(acc, a), zero(currency));
}

/**
 * Split an amount by exact decimal shares, distributing the remainder deterministically.
 * Used for prize splits (70/20/10). Never loses or invents a cent: the parts always sum to the whole.
 */
export function splitByShares(total, shares) {
  const denom = shares.reduce((n, s) => n + s.weightMilli, 0);
  if (denom !== 100000) throw new Error(`shares must sum to 1.00000 (100000 milli), got ${denom}`);
  const parts = shares.map((s) => ({ key: s.key, minor: Math.floor((total.minor * s.weightMilli) / 100000) }));
  let remainder = total.minor - parts.reduce((n, p) => n + p.minor, 0);
  // Deterministic: give the remainder to the largest shares first, in declared order.
  const order = [...parts.keys()].sort((i, j) => shares[j].weightMilli - shares[i].weightMilli || i - j);
  for (const i of order) { if (remainder === 0) break; parts[i].minor += 1; remainder -= 1; }
  return parts.map((p) => ({ key: p.key, amount: money(p.minor, total.currency) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONCILIATION EQUATIONS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * SETTLEMENT_STATUS(entry) — derived, never stored.
 *
 *   allocated(e) = SUM(payment_allocations.allocated_amount WHERE pool_entry_id = e)
 *   expected(e)  = pool_entries.expected_fee_amount              (a SNAPSHOT, not a lookup)
 *
 *   allocated = 0            AND expected > 0  -> UNPAID
 *   0 < allocated < expected                   -> PARTIALLY_PAID
 *   allocated = expected                       -> SETTLED
 *   allocated > expected                       -> OVERPAID
 *   legacy paid=true, no recoverable amount    -> LEGACY_ASSERTED
 *
 * LEGACY_ASSERTED exists because the legacy `paid` boolean recorded no amount, date, method or
 * reference. Reconstructing a payment from it would require inventing money. An honest fifth state
 * is strictly better than a fabricated number.
 */
export const SETTLEMENT = {
  UNPAID: "unpaid",
  PARTIALLY_PAID: "partially_paid",
  SETTLED: "settled",
  OVERPAID: "overpaid",
  LEGACY_ASSERTED: "legacy_asserted",
  /**
   * UNKNOWN — the EXPECTED FEE is not known, so no settlement claim can be made.
   *
   * Distinct from LEGACY_ASSERTED, which means "we know it was paid but not how much". UNKNOWN means
   * "we do not know what was owed", so even a known allocation cannot be compared to anything. The
   * ratified rule is that historical unknown fee amounts remain UNKNOWN and entry fees are never
   * fabricated — and calling such an entry `unpaid` or `settled` would be fabricating one by
   * implication, which is worse than a fabricated number because it looks like a finding.
   */
  UNKNOWN: "unknown",
};

export function settlementStatus({ expected, allocated, legacyAsserted = false }) {
  // Order matters: an unknown expected fee cannot be settled, asserted or otherwise, because there
  // is nothing to settle AGAINST. The UNKNOWN check therefore precedes every other branch.
  if (expected === null || expected === undefined) return SETTLEMENT.UNKNOWN;
  if (legacyAsserted) return SETTLEMENT.LEGACY_ASSERTED;
  if (allocated === null || allocated === undefined) return SETTLEMENT.UNKNOWN;
  sameCurrency(expected, allocated);
  if (allocated.minor === 0) return SETTLEMENT.UNPAID;
  if (allocated.minor < expected.minor) return SETTLEMENT.PARTIALLY_PAID;
  if (allocated.minor === expected.minor) return SETTLEMENT.SETTLED;
  return SETTLEMENT.OVERPAID;
}

/**
 * UNAPPLIED BALANCE(payment) — derived, never stored.
 *
 *   unapplied(p) = p.amount - SUM(allocations of p)
 *
 * DECISION: unapplied balance IS supported, and is DERIVED rather than stored.
 * Why supported: a payer may legitimately send one amount covering several entries and have the
 * remainder applied later. Refusing to model it would force either a fake allocation or a rejected
 * payment, and both lose information.
 * Why derived: a stored balance is a second source of truth that drifts the moment an allocation is
 * amended. The invariant below is what keeps it honest.
 *
 * INVARIANT: SUM(allocations of p) <= p.amount  — you cannot allocate more of a payment than exists.
 * Note this is per-PAYMENT. There is deliberately NO cap of allocation against an entry's expected
 * fee: exceeding that is OVERPAID, a reportable state, not an error.
 */
export function unappliedBalance(payment, allocations) {
  if (payment.amount === null) return null; // legacy_asserted: no amount ever existed
  const allocated = sum(allocations.map((a) => a.amount), payment.amount.currency);
  return sub(payment.amount, allocated);
}

export function paymentOverAllocated(payment, allocations) {
  const u = unappliedBalance(payment, allocations);
  return u !== null && u.minor < 0;
}

/** POOL RECONCILIATION — cash in, prizes out, and the difference. */
export function poolReconciliation({ currency, entries, allocations, prizes }) {
  const expectedTotal = sum(entries.map((e) => e.expected), currency);
  const collected = sum(allocations.map((a) => a.amount), currency);
  const prizesAwarded = sum(prizes.map((p) => p.gross), currency);
  return {
    currency,
    expectedTotal,
    collected,
    outstanding: sub(expectedTotal, collected),
    prizesAwarded,
    netCashPosition: sub(collected, prizesAwarded),
    fullyCollected: cmp(collected, expectedTotal) >= 0,
  };
}

/** PARTICIPANT NET POSITION — paid in, won out. Payer ≠ participant is respected. */
export function participantNetPosition({ currency, paidAsPayer, wonAsParticipant }) {
  const paid = sum(paidAsPayer, currency);
  const won = sum(wonAsParticipant, currency);
  return { currency, paid, won, net: sub(won, paid) };
}

/**
 * Guard used by the test suite: this module must contain no float arithmetic on money.
 * Exported so the test can assert it against this file's own source.
 */
export const FLOAT_ARITHMETIC_PATTERNS = [
  /parseFloat\s*\(/,
  /Number\s*\(\s*[^)]*\)\s*[*/]\s*100\b(?!0)/, // Number(x) * 100 style coercion
  /\.toFixed\s*\(/,
];
