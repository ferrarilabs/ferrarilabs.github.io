#!/usr/bin/env node
/**
 * WS9 tests — financial invariants, the complex funding cases, and the financial red team.
 *
 * Every attack in WS9.5 has a fixture that reproduces it and an assertion that it is caught. Every
 * invariant has a negative fixture proving it can fire: an invariant only ever observed to hold is
 * indistinguishable from one that cannot fail.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMoney, money, formatMoney, SETTLEMENT, settlementStatus } from "./financial.mjs";
import {
  checkInvariants, financialArtifact, financialParity, entrySettlement, effectiveAllocated,
  PAYMENT_KIND, FIN_VIOLATION, REVERSING_KINDS, violationReason, FLOAT_PATTERNS,
} from "./financial_evidence.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const usd = (s) => parseMoney(s, "USD");
const brl = (s) => parseMoney(s, "BRL");
const E = (id, expected, extra = {}) => ({ pool_entry_id: id, expected, ...extra });
const PAY = (id, amount, extra = {}) => ({ payment_id: id, amount, kind: PAYMENT_KIND.CONTRIBUTION, ...extra });
const REV = (id, amount, reverses, kind = PAYMENT_KIND.REFUND) => ({
  payment_id: id, amount, kind, reverses_payment_id: reverses,
  reason: "synthetic test reversal", actor: "operator", occurred_at: "2026-03-01T00:00:00Z",
});
const AL = (payment, entry, amount) => ({ payment_id: payment, pool_entry_id: entry, amount });

const violations = (ds) => checkInvariants(ds).violations.map((v) => v.violation);

// =============================================================================================
console.log("\nWS9.1 — invariants, each with a negative fixture\n");
// =============================================================================================

test("a clean dataset has no violations", () => {
  const ds = {
    entries: [E("e1", usd("20.00")), E("e2", usd("20.00"))],
    payments: [PAY("p1", usd("40.00"))],
    allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e2", usd("20.00"))],
    prizes: [],
  };
  eq(checkInvariants(ds).ok, true, `violations: ${violations(ds)}`);
});

test("NEGATIVE: sum(allocations) may not exceed the payment", () => {
  const ds = {
    entries: [E("e1", usd("20.00")), E("e2", usd("20.00"))],
    payments: [PAY("p1", usd("30.00"))],
    allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e2", usd("20.00"))],
  };
  assert(violations(ds).includes(FIN_VIOLATION.OVER_ALLOCATION), `not caught: ${violations(ds)}`);
});

test("allocating exactly the payment amount is allowed", () => {
  const ds = { entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("20.00"))], allocations: [AL("p1", "e1", usd("20.00"))] };
  eq(checkInvariants(ds).ok, true, "an exact allocation must be permitted");
});

test("unallocated balance is payment minus allocated, and stays derived", () => {
  const ds = { entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("50.00"))], allocations: [AL("p1", "e1", usd("20.00"))] };
  eq(financialArtifact(ds).unallocated_total, "30.00", "unallocated");
});

test("NEGATIVE: currency must match within an allocation", () => {
  const ds = { entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("20.00"))], allocations: [AL("p1", "e1", brl("20.00"))] };
  assert(violations(ds).includes(FIN_VIOLATION.ALLOCATION_CURRENCY_MISMATCH), `not caught: ${violations(ds)}`);
});

test("NEGATIVE: a duplicate allocation of one payment to one entry is caught", () => {
  const ds = {
    entries: [E("e1", usd("40.00"))], payments: [PAY("p1", usd("40.00"))],
    allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e1", usd("20.00"))],
  };
  assert(violations(ds).includes(FIN_VIOLATION.DUPLICATE_ALLOCATION), `not caught: ${violations(ds)}`);
});

test("NEGATIVE: an allocation referencing no payment or no entry is caught", () => {
  assert(violations({ entries: [E("e1", usd("1.00"))], payments: [], allocations: [AL("ghost", "e1", usd("1.00"))] })
    .includes(FIN_VIOLATION.ALLOCATION_ORPHAN_PAYMENT), "orphan payment not caught");
  assert(violations({ entries: [], payments: [PAY("p1", usd("1.00"))], allocations: [AL("p1", "ghost", usd("1.00"))] })
    .includes(FIN_VIOLATION.ALLOCATION_ORPHAN_ENTRY), "orphan entry not caught");
});

test("NEGATIVE: a negative non-reversal payment is caught", () => {
  const ds = { entries: [], payments: [PAY("p1", usd("-10.00"))], allocations: [] };
  assert(violations(ds).includes(FIN_VIOLATION.NEGATIVE_NON_REVERSAL), `not caught: ${violations(ds)}`);
});

test("prizes stay separate from entry payments", () => {
  const ds = {
    entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("20.00")), { payment_id: "z1", amount: usd("70.00"), kind: "prize" }],
    allocations: [AL("p1", "e1", usd("20.00")), AL("z1", "e1", usd("70.00"))],
  };
  assert(violations(ds).includes(FIN_VIOLATION.PRIZE_ALLOCATED_AS_ENTRY_PAYMENT), `not caught: ${violations(ds)}`);
});

test("every violation carries a reason", () => {
  for (const v of Object.values(FIN_VIOLATION)) {
    const why = violationReason(v);
    assert(why && why.length > 20, `${v} has no usable reason`);
  }
});

test("this module contains no float arithmetic on money", () => {
  const src = readFileSync(fileURLToPath(new URL("./financial_evidence.mjs", import.meta.url)), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  for (const re of FLOAT_PATTERNS) assert(!re.test(code), `float pattern ${re} appears in code`);
});

// =============================================================================================
console.log("\nWS13-OP-3 — typed reversal semantics\n");
// =============================================================================================

test("a refund is a compensating record and never edits the original", () => {
  const original = PAY("p1", usd("40.00"));
  const snapshot = JSON.stringify(original);
  const ds = { entries: [E("e1", usd("40.00"))], payments: [original, REV("r1", usd("-40.00"), "p1")], allocations: [AL("p1", "e1", usd("40.00"))] };
  eq(checkInvariants(ds).ok, true, `violations: ${violations(ds)}`);
  eq(JSON.stringify(ds.payments[0]), snapshot, "the original payment fact was modified");
});

test("NEGATIVE: a reversal with no original is caught", () => {
  const ds = { entries: [], payments: [REV("r1", usd("-10.00"), "nope")], allocations: [] };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_WITHOUT_ORIGINAL), `not caught: ${violations(ds)}`);
});

test("NEGATIVE: a positive refund is caught", () => {
  const ds = { entries: [], payments: [PAY("p1", usd("10.00")), REV("r1", usd("10.00"), "p1")], allocations: [] };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_NOT_NEGATIVE), `not caught: ${violations(ds)}`);
});

test("NEGATIVE: a double refund summing past the original is caught", () => {
  const ds = {
    entries: [], allocations: [],
    payments: [PAY("p1", usd("40.00")), REV("r1", usd("-40.00"), "p1"), REV("r2", usd("-40.00"), "p1")],
  };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_EXCEEDS_ORIGINAL),
    `two full refunds of one payment must be caught: ${violations(ds)}`);
});

test("two PARTIAL refunds summing exactly to the original are allowed", () => {
  const ds = {
    entries: [], allocations: [],
    payments: [PAY("p1", usd("40.00")), REV("r1", usd("-15.00"), "p1"), REV("r2", usd("-25.00"), "p1")],
  };
  eq(checkInvariants(ds).ok, true, `violations: ${violations(ds)}`);
});

test("NEGATIVE: a cross-currency reversal is caught", () => {
  const ds = { entries: [], allocations: [], payments: [PAY("p1", usd("40.00")), REV("r1", brl("-40.00"), "p1")] };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_CURRENCY_MISMATCH), `not caught: ${violations(ds)}`);
});

test("NEGATIVE: a reversal missing reason, actor or timestamp is caught", () => {
  for (const k of ["reason", "actor", "occurred_at"]) {
    const rev = REV("r1", usd("-10.00"), "p1");
    delete rev[k];
    const ds = { entries: [], allocations: [], payments: [PAY("p1", usd("10.00")), rev] };
    assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_MISSING_METADATA), `missing ${k} not caught`);
  }
});

test("NEGATIVE: reversing a reversal is caught", () => {
  const ds = {
    entries: [], allocations: [],
    payments: [PAY("p1", usd("10.00")), REV("r1", usd("-10.00"), "p1"), REV("r2", usd("-10.00"), "r1")],
  };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_OF_REVERSAL), `not caught: ${violations(ds)}`);
});

test("all three reversing kinds are accepted and behave identically", () => {
  for (const kind of [PAYMENT_KIND.REFUND, PAYMENT_KIND.REVERSAL, PAYMENT_KIND.CHARGEBACK]) {
    assert(REVERSING_KINDS.has(kind), `${kind} not a reversing kind`);
    const ds = { entries: [], allocations: [], payments: [PAY("p1", usd("10.00")), REV("r1", usd("-10.00"), "p1", kind)] };
    eq(checkInvariants(ds).ok, true, `${kind}: ${violations(ds)}`);
  }
});

// =============================================================================================
console.log("\nWS9.2 — the complex funding cases\n");
// =============================================================================================

test("one payment covering many entries", () => {
  const ds = {
    entries: [E("e1", usd("20.00")), E("e2", usd("20.00")), E("e3", usd("20.00"))],
    payments: [PAY("p1", usd("60.00"), { payer_participant_id: "carla" })],
    allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e2", usd("20.00")), AL("p1", "e3", usd("20.00"))],
  };
  eq(checkInvariants(ds).ok, true, `violations: ${violations(ds)}`);
  for (const e of ds.entries) eq(entrySettlement(e, ds, "USD").status, SETTLEMENT.SETTLED, `${e.pool_entry_id}`);
});

test("many payments covering one entry", () => {
  const ds = {
    entries: [E("e1", usd("30.00"))],
    payments: [PAY("p1", usd("10.00")), PAY("p2", usd("20.00"))],
    allocations: [AL("p1", "e1", usd("10.00")), AL("p2", "e1", usd("20.00"))],
  };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.SETTLED, "settlement");
});

test("a third-party payer does not become the participant", () => {
  const ds = {
    entries: [E("e1", usd("20.00"), { participant_id: "ana" })],
    payments: [PAY("p1", usd("20.00"), { payer_participant_id: "carla" })],
    allocations: [AL("p1", "e1", usd("20.00"))],
  };
  eq(checkInvariants(ds).ok, true, "clean");
  eq(ds.payments[0].payer_participant_id, "carla", "the payer must stay recorded as the payer");
  eq(ds.entries[0].participant_id, "ana", "the participant must stay the participant");
});

test("a partial payment is PARTIALLY_PAID, not unpaid and not settled", () => {
  const ds = { entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("5.00"))], allocations: [AL("p1", "e1", usd("5.00"))] };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.PARTIALLY_PAID, "settlement");
});

test("an overpayment is OVERPAID — a reportable state, not an error", () => {
  const ds = { entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("25.00"))], allocations: [AL("p1", "e1", usd("25.00"))] };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.OVERPAID, "settlement");
  eq(checkInvariants(ds).ok, true, "overpaying an entry is not an invariant violation");
});

test("a refund moves settlement BACKWARDS", () => {
  const ds = {
    entries: [E("e1", usd("20.00"))],
    payments: [PAY("p1", usd("20.00")), REV("r1", usd("-20.00"), "p1")],
    allocations: [AL("p1", "e1", usd("20.00"))],
  };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.UNPAID,
    "an entry whose money was returned must not stay settled");
});

test("a PARTIAL refund moves settlement from settled to partially paid", () => {
  const ds = {
    entries: [E("e1", usd("20.00"))],
    payments: [PAY("p1", usd("20.00")), REV("r1", usd("-5.00"), "p1")],
    allocations: [AL("p1", "e1", usd("20.00"))],
  };
  const s = entrySettlement(ds.entries[0], ds, "USD");
  eq(s.status, SETTLEMENT.PARTIALLY_PAID, "settlement");
  eq(formatMoney(s.allocated), "15.00 USD", "effective allocation after the partial refund");
});

test("a refund of a shared payment is apportioned exactly, with no minor unit lost", () => {
  // 10.00 refunded across allocations of 3.33 / 3.33 / 3.34 — the floors lose 2 minor units, which
  // must go somewhere rather than vanishing.
  const ds = {
    entries: [E("e1", usd("3.33")), E("e2", usd("3.33")), E("e3", usd("3.34"))],
    payments: [PAY("p1", usd("10.00")), REV("r1", usd("-10.00"), "p1")],
    allocations: [AL("p1", "e1", usd("3.33")), AL("p1", "e2", usd("3.33")), AL("p1", "e3", usd("3.34"))],
  };
  const total = ds.entries.reduce((s, e) => s + effectiveAllocated(e, ds, "USD").minor, 0);
  eq(total, 0, "a full refund must reduce the effective allocation to exactly zero across all entries");
});

test("a payment spanning two pools is allocated per entry, not per pool", () => {
  const ds = {
    entries: [E("e1", usd("20.00"), { pool_id: "poolA" }), E("e2", usd("20.00"), { pool_id: "poolB" })],
    payments: [PAY("p1", usd("40.00"))],
    allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e2", usd("20.00"))],
  };
  eq(checkInvariants(ds).ok, true, "a cross-pool payment is legitimate");
  for (const e of ds.entries) eq(entrySettlement(e, ds, "USD").status, SETTLEMENT.SETTLED, e.pool_entry_id);
});

test("multiple entries per participant settle independently", () => {
  const ds = {
    entries: [E("e1", usd("20.00"), { participant_id: "ana" }), E("e2", usd("20.00"), { participant_id: "ana" })],
    payments: [PAY("p1", usd("20.00"))],
    allocations: [AL("p1", "e1", usd("20.00"))],
  };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.SETTLED, "first entry");
  eq(entrySettlement(ds.entries[1], ds, "USD").status, SETTLEMENT.UNPAID, "second entry must not inherit the first's payment");
});

// =============================================================================================
console.log("\nWS9.3 — an unknown fee stays UNKNOWN\n");
// =============================================================================================

test("an entry with an unknown expected fee is UNKNOWN, not unpaid", () => {
  const ds = { entries: [E("e1", null)], payments: [], allocations: [] };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.UNKNOWN, "settlement");
  eq(settlementStatus({ expected: null, allocated: usd("0") }), SETTLEMENT.UNKNOWN, "direct call");
});

test("an unknown fee stays UNKNOWN even when money HAS been allocated", () => {
  const ds = { entries: [E("e1", null)], payments: [PAY("p1", usd("20.00"))], allocations: [AL("p1", "e1", usd("20.00"))] };
  eq(entrySettlement(ds.entries[0], ds, "USD").status, SETTLEMENT.UNKNOWN,
    "we know money arrived; we do not know what was owed, so no settlement claim is possible");
});

test("an unknown fee stays UNKNOWN even when marked legacy-asserted", () => {
  eq(settlementStatus({ expected: null, allocated: null, legacyAsserted: true }), SETTLEMENT.UNKNOWN,
    "UNKNOWN must dominate LEGACY_ASSERTED — asserted-paid against an unknown amount is still unknown");
});

test("unknown-fee entries are counted separately and excluded from expected_total", () => {
  const ds = {
    entries: [E("e1", usd("20.00")), E("e2", null), E("e3", null)],
    payments: [PAY("p1", usd("20.00"))], allocations: [AL("p1", "e1", usd("20.00"))],
  };
  const a = financialArtifact(ds);
  eq(a.entries_unknown, 2, "unknown count");
  eq(a.entries_unpaid, 0, "an unknown-fee entry must never be reported as unpaid");
  eq(a.expected_total, "20.00", "expected_total must exclude entries whose fee was never recorded");
  eq(a.expected_total_excludes_unknown_fee_entries, 2, "the exclusion must be stated, not implied");
});

test("no entry fee is ever fabricated", () => {
  const ds = { entries: [E("e1", null)], payments: [], allocations: [] };
  eq(entrySettlement(ds.entries[0], ds, "USD").expected, null, "an expected fee was invented");
});

// =============================================================================================
console.log("\nWS9.4 — the FINANCIAL_PARITY artefact\n");
// =============================================================================================

const CLEAN = {
  entries: [E("e1", usd("20.00")), E("e2", usd("20.00")), E("e3", usd("20.00")), E("e4", null)],
  payments: [PAY("p1", usd("40.00"), { payer_participant_id: "carla" }), PAY("p2", usd("10.00")), REV("r1", usd("-5.00"), "p2")],
  allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e2", usd("20.00")), AL("p2", "e3", usd("10.00"))],
  prizes: [{ prize_id: "z1", amount: usd("70.00") }],
};

test("the artefact carries every field WS9.4 requires", () => {
  const a = financialArtifact(CLEAN);
  for (const f of ["expected_total", "paid_total", "allocated_total", "unallocated_total", "refund_total",
    "prize_total", "entries_unpaid", "entries_partial", "entries_settled", "entries_overpaid", "entries_unknown"]) {
    assert(a[f] !== undefined, `missing field ${f}`);
  }
});

test("the artefact's totals are exact decimal strings, never numbers", () => {
  const a = financialArtifact(CLEAN);
  for (const f of ["expected_total", "paid_total", "allocated_total", "unallocated_total", "refund_total", "prize_total"]) {
    eq(typeof a[f], "string", `${f} must be a string`);
    assert(/^-?\d+\.\d{2}$/.test(a[f]), `${f} is not an exact 2dp decimal: ${a[f]}`);
  }
});

test("the artefact's computed values are correct", () => {
  const a = financialArtifact(CLEAN);
  eq(a.expected_total, "60.00", "expected");
  eq(a.paid_total, "50.00", "paid");
  eq(a.allocated_total, "50.00", "allocated");
  eq(a.refund_total, "5.00", "refund");
  eq(a.prize_total, "70.00", "prize");
  eq(a.unallocated_total, "-5.00", "paid 50 - refund 5 - allocated 50 = -5.00, which is the refunded portion still applied");
  eq(a.entries_settled, 2, "settled");
  eq(a.entries_partial, 1, "e3 lost 5.00 to the refund so it is partial");
  eq(a.entries_unknown, 1, "unknown");
});

test("identical datasets are EXACT parity with zero mismatches", () => {
  const r = financialParity(CLEAN, structuredClone(CLEAN));
  eq(r.verdict, "EXACT", `differences: ${JSON.stringify(r.differences)}`);
  eq(r.FINANCIAL_PARITY.mismatches, 0, "mismatches");
  assert(r.FINANCIAL_PARITY.checked > 0, "checked must be non-zero or the result is vacuous");
  eq(r.tolerance, "ZERO", "tolerance");
});

test("NEGATIVE: a one-cent difference fails parity", () => {
  const b = structuredClone(CLEAN);
  b.allocations[0].amount = usd("20.01");
  const r = financialParity(CLEAN, b);
  eq(r.verdict, "FAIL", "a one-cent difference must fail");
  assert(r.FINANCIAL_PARITY.mismatches > 0, "mismatches");
  assert(r.differences.some((d) => d.field === "allocated_total"), "the differing field must be named");
});

test("NEGATIVE: a missing entry fails parity on counts", () => {
  const b = structuredClone(CLEAN);
  b.entries.pop();
  const r = financialParity(CLEAN, b);
  eq(r.verdict, "FAIL", "a lost entry must fail");
  assert(r.AGGREGATE_PARITY.mismatches > 0, "aggregate parity must also fail");
});

test("NEGATIVE: an invariant violation on either side fails parity even when totals agree", () => {
  const b = structuredClone(CLEAN);
  b.allocations.push(AL("p2", "e3", usd("10.00"))); // duplicate; also over-allocates
  const r = financialParity(CLEAN, b);
  eq(r.verdict, "FAIL", "a broken invariant must fail parity");
  assert(r.invariantFailures.length > 0, "the invariant failure must be reported");
});

test("the parity result is shaped for the WS5 promotion evaluator", () => {
  const r = financialParity(CLEAN, structuredClone(CLEAN));
  for (const cls of ["FINANCIAL_PARITY", "AGGREGATE_PARITY"]) {
    assert(typeof r[cls].checked === "number", `${cls}.checked`);
    assert(typeof r[cls].mismatches === "number", `${cls}.mismatches`);
  }
});

// =============================================================================================
console.log("\nWS9.5 — financial red team\n");
// =============================================================================================

test("RED: money cannot be lost — allocated may not exceed received", () => {
  const ds = {
    entries: [E("e1", usd("20.00"))], payments: [PAY("p1", usd("10.00"))],
    allocations: [AL("p1", "e1", usd("20.00"))],
  };
  assert(violations(ds).includes(FIN_VIOLATION.OVER_ALLOCATION), "allocating money never received was permitted");
});

test("RED: a duplicate allocation cannot double-count one transfer", () => {
  const ds = {
    entries: [E("e1", usd("20.00")), E("e2", usd("20.00"))],
    payments: [PAY("p1", usd("20.00"))],
    allocations: [AL("p1", "e1", usd("20.00")), AL("p1", "e1", usd("20.00"))],
  };
  const v = violations(ds);
  assert(v.includes(FIN_VIOLATION.DUPLICATE_ALLOCATION), "duplicate not caught");
  assert(v.includes(FIN_VIOLATION.OVER_ALLOCATION), "the duplicate must ALSO trip over-allocation — two independent controls");
});

test("RED: a cross-currency allocation cannot smuggle an exchange rate", () => {
  const ds = { entries: [E("e1", brl("100.00"))], payments: [PAY("p1", usd("20.00"))], allocations: [AL("p1", "e1", brl("100.00"))] };
  assert(violations(ds).includes(FIN_VIOLATION.ALLOCATION_CURRENCY_MISMATCH), "a silent conversion was permitted");
});

test("RED: a negative payment cannot masquerade as a contribution", () => {
  const ds = { entries: [], payments: [{ payment_id: "p1", amount: usd("-999.00"), kind: PAYMENT_KIND.CONTRIBUTION }], allocations: [] };
  assert(violations(ds).includes(FIN_VIOLATION.NEGATIVE_NON_REVERSAL), "an untyped negative payment was permitted");
});

test("RED: a refund cannot exist without an original", () => {
  const ds = { entries: [], payments: [REV("r1", usd("-500.00"), null)], allocations: [] };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_WITHOUT_ORIGINAL), "a credit against nothing was permitted");
});

test("RED: the same payment cannot be refunded twice in full", () => {
  const ds = {
    entries: [], allocations: [],
    payments: [PAY("p1", usd("100.00")), REV("r1", usd("-100.00"), "p1"), REV("r2", usd("-100.00"), "p1")],
  };
  assert(violations(ds).includes(FIN_VIOLATION.REVERSAL_EXCEEDS_ORIGINAL), "a double refund was permitted");
});

test("RED: wrong payer attribution does not change what was allocated", () => {
  const a = {
    entries: [E("e1", usd("20.00"), { participant_id: "ana" })],
    payments: [PAY("p1", usd("20.00"), { payer_participant_id: "carla" })],
    allocations: [AL("p1", "e1", usd("20.00"))],
  };
  const b = structuredClone(a);
  b.payments[0].payer_participant_id = "ana"; // the misattribution
  const r = financialParity(a, b);
  // Totals are identical, so the FINANCIAL artefact alone cannot see this — which is the point:
  // payer attribution needs its own comparison, and pretending the money artefact covers it would be
  // a false assurance.
  eq(r.verdict, "EXACT", "totals genuinely do agree");
  eq(a.payments[0].payer_participant_id, "carla", "the source payer must be unchanged");
  assert(a.payments[0].payer_participant_id !== b.payments[0].payer_participant_id,
    "the fixture must actually differ, or this test proves nothing");
});

test("RED: a prize cannot be counted as incoming entry money", () => {
  const ds = {
    entries: [E("e1", usd("20.00"))],
    payments: [{ payment_id: "z1", amount: usd("70.00"), kind: "prize" }],
    allocations: [AL("z1", "e1", usd("70.00"))],
    prizes: [{ prize_id: "z1", amount: usd("70.00") }],
  };
  assert(violations(ds).includes(FIN_VIOLATION.PRIZE_ALLOCATED_AS_ENTRY_PAYMENT), "a prize was allowed to fund an entry");
});

test("RED: an empty dataset produces a clean, zero-valued artefact rather than throwing", () => {
  const a = financialArtifact({});
  eq(a.expected_total, "0.00", "expected");
  eq(a.entries_total, 0, "entries");
  eq(a.invariants_ok, true, "invariants");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ FINANCIAL EVIDENCE TESTS PASSED\n" : "✗ FINANCIAL EVIDENCE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
