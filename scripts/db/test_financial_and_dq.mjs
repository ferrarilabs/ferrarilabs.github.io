#!/usr/bin/env node
/**
 * Tests for the financial engine and the data-quality rule set.
 *
 * FIXTURE DISCIPLINE: every identifier below is synthetic and obviously so — `p-alpha`, `pool-x`,
 * `synthetic-a@example.invalid`. No real participant name, email or payment reference appears, and
 * none is copied from production. Amounts are round synthetic figures.
 *
 * TESTING SHAPE: each data-quality rule gets a NEGATIVE fixture (clean data ⇒ PASS) and a POSITIVE
 * fixture (a deliberately broken dataset ⇒ FAIL). A rule that cannot be made to fail is not a rule,
 * it is decoration — this session has already found four checks that could not fire.
 *
 * Usage: node scripts/db/test_financial_and_dq.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  money, parseMoney, formatMoney, add, sub, sum, cmp, splitByShares,
  settlementStatus, unappliedBalance, poolReconciliation, participantNetPosition,
  SETTLEMENT, FLOAT_ARITHMETIC_PATTERNS,
} from "./financial.mjs";
import { RULES, runRules, EMPTY } from "./data_quality.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const USD = "USD";
const usd = (dec) => parseMoney(dec, USD);

console.log("\nFinancial engine\n");

test("parseMoney is exact — no float rounding", () => {
  eq(usd("5").minor, 500, "5");
  eq(usd("5.00").minor, 500, "5.00");
  eq(usd("0.01").minor, 1, "0.01");
  eq(usd("0.1").minor, 10, "0.1");
  eq(usd("1234.56").minor, 123456, "1234.56");
});

test("the classic float failure does not occur", () => {
  // 0.1 + 0.2 !== 0.3 in IEEE-754. Here it must be exact.
  eq(add(usd("0.10"), usd("0.20")).minor, 30, "0.10 + 0.20");
  // Ten additions of 0.10 must be exactly 1.00, not 0.9999999999999999.
  let acc = usd("0");
  for (let i = 0; i < 10; i++) acc = add(acc, usd("0.10"));
  eq(acc.minor, 100, "ten times 0.10");
});

test("cross-currency arithmetic is refused, not coerced", () => {
  let threw = false;
  try { add(money(500, "USD"), money(500, "BRL")); } catch { threw = true; }
  assert(threw, "adding USD to BRL must throw — silent coercion produces wrong money");
});

test("currency must be ISO-4217 shaped", () => {
  for (const bad of ["usd", "US", "DOLLAR", "", "US$"]) {
    let threw = false;
    try { money(100, bad); } catch { threw = true; }
    assert(threw, `currency ${JSON.stringify(bad)} should be rejected`);
  }
});

test("non-integer minor units are refused", () => {
  let threw = false;
  try { money(1.5, USD); } catch { threw = true; }
  assert(threw, "a fractional cent is not representable and must be rejected");
});

test("splitByShares never loses or invents a cent (70/20/10)", () => {
  const shares = [{ key: "first", weightMilli: 70000 }, { key: "second", weightMilli: 20000 }, { key: "third", weightMilli: 10000 }];
  for (const total of ["100.00", "0.01", "0.07", "33.33", "5.00", "1.00"]) {
    const parts = splitByShares(usd(total), shares);
    const back = sum(parts.map((p) => p.amount), USD);
    eq(back.minor, usd(total).minor, `split of ${total} must sum back exactly`);
  }
});

test("splitByShares rejects shares that do not sum to 1", () => {
  let threw = false;
  try { splitByShares(usd("10.00"), [{ key: "a", weightMilli: 60000 }, { key: "b", weightMilli: 30000 }]); } catch { threw = true; }
  assert(threw, "shares summing to 0.9 must be rejected, not silently normalised");
});

console.log("\nSettlement derivation (Workstream D/F)\n");

test("all five settlement states derive correctly", () => {
  const e = usd("5.00");
  eq(settlementStatus({ expected: e, allocated: usd("0") }), SETTLEMENT.UNPAID, "unpaid");
  eq(settlementStatus({ expected: e, allocated: usd("2.50") }), SETTLEMENT.PARTIALLY_PAID, "partial");
  eq(settlementStatus({ expected: e, allocated: usd("5.00") }), SETTLEMENT.SETTLED, "settled");
  eq(settlementStatus({ expected: e, allocated: usd("7.00") }), SETTLEMENT.OVERPAID, "overpaid");
  eq(settlementStatus({ expected: e, allocated: usd("0"), legacyAsserted: true }), SETTLEMENT.LEGACY_ASSERTED, "legacy");
});

test("boundary: one cent under and over the fee", () => {
  const e = usd("5.00");
  eq(settlementStatus({ expected: e, allocated: usd("4.99") }), SETTLEMENT.PARTIALLY_PAID, "4.99");
  eq(settlementStatus({ expected: e, allocated: usd("5.01") }), SETTLEMENT.OVERPAID, "5.01");
});

test("unapplied balance is derived; over-allocation is negative", () => {
  const p = { amount: usd("20.00") };
  eq(unappliedBalance(p, [{ amount: usd("5.00") }, { amount: usd("5.00") }]).minor, 1000, "10.00 unapplied");
  eq(unappliedBalance(p, [{ amount: usd("20.00") }]).minor, 0, "fully applied");
  assert(unappliedBalance(p, [{ amount: usd("25.00") }]).minor < 0, "over-allocation must be negative");
});

test("a legacy_asserted payment has no amount and therefore no balance", () => {
  eq(unappliedBalance({ amount: null }, []), null, "null amount ⇒ null balance, never zero");
});

test("one payment funds many entries; one entry funded by many payments", () => {
  // payer funds three entries from a single 15.00 payment
  const p = { amount: usd("15.00") };
  const allocs = [{ amount: usd("5.00") }, { amount: usd("5.00") }, { amount: usd("5.00") }];
  eq(unappliedBalance(p, allocs).minor, 0, "one-to-many fully applied");
  // one entry receives two partial allocations
  const allocated = sum([usd("2.00"), usd("3.00")], USD);
  eq(settlementStatus({ expected: usd("5.00"), allocated }), SETTLEMENT.SETTLED, "many-to-one settles");
});

test("pool reconciliation balances cash in against prizes out", () => {
  const r = poolReconciliation({
    currency: USD,
    entries: [{ expected: usd("5.00") }, { expected: usd("5.00") }, { expected: usd("5.00") }],
    allocations: [{ amount: usd("5.00") }, { amount: usd("5.00") }],
    prizes: [{ gross: usd("7.00") }],
  });
  eq(r.expectedTotal.minor, 1500, "expected");
  eq(r.collected.minor, 1000, "collected");
  eq(r.outstanding.minor, 500, "outstanding");
  eq(r.netCashPosition.minor, 300, "net cash");
  eq(r.fullyCollected, false, "not fully collected");
});

test("participant net position respects payer != participant", () => {
  // synthetic-a paid for their own and someone else's entry, and won nothing
  const r = participantNetPosition({ currency: USD, paidAsPayer: [usd("10.00")], wonAsParticipant: [] });
  eq(r.net.minor, -1000, "net -10.00");
  const w = participantNetPosition({ currency: USD, paidAsPayer: [usd("5.00")], wonAsParticipant: [usd("21.00")] });
  eq(w.net.minor, 1600, "net +16.00");
});

/**
 * Strip comments and the pattern list before scanning.
 *
 * A code scanner must scan CODE. This programme has already produced several findings that were
 * nothing but prose — the word "real" matching a FLOAT check twice, `'TRUNCATE'` inside a string
 * literal flagged as DML. A comment explaining a forbidden shape necessarily contains that shape;
 * matching it is a scanner defect, not a code defect. Stripping is structural: it narrows WHAT is
 * scanned, it does not except any particular offending line.
 */
function codeOnly(src) {
  return src
    .replace(/export const FLOAT_ARITHMETIC_PATTERNS[\s\S]*$/, "") // the list names the shapes it forbids
    .replace(/\/\*[\s\S]*?\*\//g, "")                              // block comments
    .replace(/^[ \t]*\/\/.*$/gm, "");                              // whole-line comments
}

test("this module contains no float arithmetic on money", () => {
  const body = codeOnly(readFileSync(join(HERE, "financial.mjs"), "utf8"));
  for (const re of FLOAT_ARITHMETIC_PATTERNS) {
    assert(!re.test(body), `financial.mjs contains float-shaped arithmetic matching ${re}`);
  }
});

test("the float scan is not vacuous — it fires on planted float arithmetic", () => {
  // Guard against the scan silently becoming unable to fail (a green check over a shrunken scope
  // is the recurring defect class in this programme, now caught by construction).
  const planted = `const cents = parseFloat(s) * 100;\nconst out = (x).toFixed(2);\nconst c = Number(s) * 100;`;
  const hits = FLOAT_ARITHMETIC_PATTERNS.filter((re) => re.test(codeOnly(planted)));
  eq(hits.length, FLOAT_ARITHMETIC_PATTERNS.length, "every float pattern must match its own planted example");
});

test("parseMoney is exact by construction, not by float luck (property check)", () => {
  // Independent oracle: digit-string manipulation, no arithmetic at all.
  for (let w = 0; w < 400; w++) {
    for (const frac of ["", ".00", ".01", ".09", ".10", ".99", ".5"]) {
      const s = `${w}${frac}`;
      const f = frac ? (frac.slice(1) + "00").slice(0, 2) : "00";
      const expected = Number(String(w) + f);
      eq(parseMoney(s, USD).minor, expected, `parseMoney(${s})`);
      eq(parseMoney("-" + s, USD).minor, -expected, `parseMoney(-${s})`);
    }
  }
});

test("parseMoney refuses amounts beyond exact integer range instead of rounding", () => {
  let threw = false;
  try { parseMoney("99999999999999.99", USD); } catch { threw = true; }
  assert(threw, "an amount past 2^53 minor units must be refused, never silently rounded");
});

test("formatMoney round-trips every parsed amount", () => {
  for (const s of ["0.00", "0.01", "5.00", "1234.56", "-7.05"]) {
    const m = parseMoney(s, USD);
    eq(formatMoney(m), `${s.replace(/^(-?)(\d+)$/, "$1$2.00")} ${USD}`, `round-trip ${s}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nData-quality rules — negative fixture (clean data must PASS)\n");

const P_A = "p-alpha", P_B = "p-beta", POOL = "pool-x", ED = "ed-1", COMP = "c-1", PHASE = "ph-1";
const E_A = "e-alpha-1", E_B = "e-beta-1";

function cleanDataset() {
  return {
    ...EMPTY,
    participants: [
      { participant_id: P_A, email: "synthetic-a@example.invalid", canonical_participant_id: null },
      { participant_id: P_B, email: "synthetic-b@example.invalid", canonical_participant_id: null },
    ],
    competitions: [{ competition_id: COMP }],
    competition_editions: [{ competition_edition_id: ED, competition_id: COMP }],
    competition_edition_phases: [
      { competition_edition_phase_id: PHASE, competition_edition_id: ED, ordinal: 1, cutoff_at: "2026-06-01T00:00:00Z" },
    ],
    pools: [{ pool_id: POOL, competition_edition_id: ED }],
    pool_fee_schedule: [{ pool_fee_schedule_id: "f-1", pool_id: POOL, effective_to: null }],
    pool_entries: [
      { pool_entry_id: E_A, pool_id: POOL, participant_id: P_A, entry_label: "main", expected: usd("5.00") },
      { pool_entry_id: E_B, pool_id: POOL, participant_id: P_B, entry_label: "main", expected: usd("5.00") },
    ],
    payments: [{ payment_id: "pay-1", payer_participant_id: P_A, amount: usd("10.00"), kind: "contribution", external_reference: "SYNTH-REF-1" }],
    payment_allocations: [
      { allocation_id: "al-1", payment_id: "pay-1", pool_entry_id: E_A, allocated_amount: usd("5.00") },
      { allocation_id: "al-2", payment_id: "pay-1", pool_entry_id: E_B, allocated_amount: usd("5.00") },
    ],
    prize_allocations: [{ prize_allocation_id: "z-1", pool_id: POOL, pool_entry_id: E_A, participant_id: P_A, gross: usd("7.00") }],
    matches: [{ match_id: "m-1", competition_edition_phase_id: PHASE, status: "finished" }],
    match_results: [{ match_result_id: "r-1", match_id: "m-1", is_official: true, superseded_by_id: null }],
    predictions: [{ prediction_id: "pr-1", pool_entry_id: E_A, match_id: "m-1", submitted_at: "2026-05-01T00:00:00Z" }],
    ranking_snapshots: [{ ranking_snapshot_id: "rs-1", pool_id: POOL, computed_at: "2026-06-02T00:00:00Z", position: 1, scoring_rule_version: "v1" }],
    sync_state: [{ sync_state_id: "s-1", competition_edition_id: ED, active_phase_id: PHASE, last_success_at: "2026-06-02T00:00:00Z" }],
    audit_events: [
      { audit_event_id: "a-1", occurred_at: "2026-06-01T00:00:00Z", previous_event_hash: null, event_hash: "h1", safe_metadata: { pool_id: POOL } },
      { audit_event_id: "a-2", occurred_at: "2026-06-01T00:01:00Z", previous_event_hash: "h1", event_hash: "h2", safe_metadata: { count: 2 } },
    ],
    outbox_events: [{ outbox_event_id: "o-1", status: "sent", attempt_count: 1, idempotency_key: "k-1" }],
    outbox_delivery_attempts: [{ outbox_delivery_attempt_id: "oa-1", outbox_event_id: "o-1", attempt_number: 1, outcome: "success" }],
  };
}

test("clean synthetic dataset passes every rule", () => {
  const results = runRules(cleanDataset(), { now: "2026-06-02T01:00:00Z" });
  const bad = results.filter((r) => r.status !== "PASS");
  assert(bad.length === 0,
    `${bad.length} rule(s) fired on clean data:\n      ` +
    bad.map((r) => `${r.id} ${r.status} ${r.findings.join("; ")}${r.error ? " ERROR:" + r.error : ""}`).join("\n      "));
});

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nData-quality rules — positive fixtures (each rule must be able to FAIL)\n");

/** Each mutator breaks exactly one thing; the named rule must fire. */
const BREAKAGES = [
  ["DQ-ID-01", (d) => { d.participants.push({ participant_id: "p-dup", email: "SYNTHETIC-A@example.invalid", canonical_participant_id: null }); }],
  ["DQ-ID-02", (d) => { d.participant_identity_links.push({ link_id: "l-1", surviving_participant_id: P_A, merged_participant_id: P_A }); }],
  ["DQ-ID-03", (d) => { d.participants[0].canonical_participant_id = P_B; d.participants[1].canonical_participant_id = P_A; }],
  ["DQ-ID-04", (d) => { d.participant_identity_links.push({ link_id: "l-2", surviving_participant_id: P_A, merged_participant_id: "p-ghost" }); }],
  ["DQ-ID-05", (d) => { d.participants[0].canonical_participant_id = P_B; }],
  ["DQ-ST-01", (d) => { d.pools[0].competition_edition_id = "ed-ghost"; }],
  ["DQ-ST-02", (d) => { d.pool_entries[0].pool_id = "pool-ghost"; }],
  ["DQ-ST-03", (d) => { d.pool_entries[0].participant_id = "p-ghost"; }],
  ["DQ-ST-04", (d) => { d.pool_entries.push({ ...d.pool_entries[0], pool_entry_id: "e-dup" }); }],
  ["DQ-ST-05", (d) => { d.pool_entries[0].entry_label = "   "; }],
  ["DQ-FN-01", (d) => { d.payments.push({ payment_id: "pay-2", amount: usd("5.00"), kind: "contribution", external_reference: "SYNTH-REF-1" }); }],
  ["DQ-FN-02", (d) => { d.payments.push({ payment_id: "pay-3", amount: usd("5.00"), kind: "refund" }); }],
  ["DQ-FN-03", (d) => { d.payment_allocations.push({ allocation_id: "al-3", payment_id: "pay-1", pool_entry_id: E_A, allocated_amount: usd("50.00") }); }],
  ["DQ-FN-04", (d) => { d.payment_allocations.push({ allocation_id: "al-4", payment_id: "pay-ghost", pool_entry_id: E_A, allocated_amount: usd("1.00") }); }],
  ["DQ-FN-05", (d) => { d.payment_allocations[0].allocated_amount = money(500, "BRL"); }],
  ["DQ-FN-06", (d) => { d.pool_entries[0].stored_settlement_status = "unpaid"; }],
  ["DQ-FN-07", (d) => { d.pool_entries[0].expected = usd("0"); }],
  ["DQ-FN-08", (d) => { d.pool_fee_schedule.push({ pool_fee_schedule_id: "f-2", pool_id: POOL, effective_to: null }); }],
  ["DQ-FN-09", (d) => { d.prize_allocations[0].gross = usd("999.00"); }],
  ["DQ-FN-10", (d) => { d.prize_allocations[0].participant_id = P_B; }],
  ["DQ-PR-01", (d) => { d.predictions.push({ prediction_id: "pr-bad", pool_entry_id: E_A, match_id: "m-1", tie_id: "t-1" }); }],
  ["DQ-PR-02", (d) => { d.predictions.push({ ...d.predictions[0], prediction_id: "pr-dup" }); }],
  ["DQ-PR-03", (d) => { d.predictions[0].submitted_at = "2026-07-01T00:00:00Z"; }],
  ["DQ-PR-04", (d) => { d.match_results.push({ match_result_id: "r-2", match_id: "m-1", is_official: true, superseded_by_id: null }); }],
  ["DQ-PR-05", (d) => { d.matches.push({ match_id: "m-2", competition_edition_phase_id: PHASE, status: "finished" }); }],
  ["DQ-CP-01", (d) => { d.competition_edition_phases.push({ competition_edition_phase_id: "ph-3", competition_edition_id: ED, ordinal: 5 }); }],
  ["DQ-CP-02", (d) => { d.ranking_snapshots.push({ ...d.ranking_snapshots[0], ranking_snapshot_id: "rs-2" }); }],
  ["DQ-OP-01", (d) => { d.sync_state[0].last_success_at = "2020-01-01T00:00:00Z"; }],
  ["DQ-OP-02", (d) => { d.sync_state[0].active_phase_id = "ph-ghost"; }],
  ["DQ-OB-01", (d) => { d.outbox_delivery_attempts.push({ outbox_delivery_attempt_id: "oa-x", outbox_event_id: "o-ghost", attempt_number: 1, outcome: "success" }); }],
  ["DQ-OB-02", (d) => { d.outbox_delivery_attempts[0].outcome = "transient_failure"; }],
  ["DQ-OB-03", (d) => { d.outbox_events[0].attempt_count = 9; }],
  ["DQ-OB-04", (d) => { d.outbox_events.push({ outbox_event_id: "o-dead", status: "dead", attempt_count: 0, dead_at: null }); }],
  ["DQ-AU-01", (d) => { d.audit_events[0].safe_metadata = { email: "leak@example.invalid" }; }],
  ["DQ-AU-02", (d) => { d.audit_events[1].previous_event_hash = "wrong"; }],
];

for (const [ruleId, mutate] of BREAKAGES) {
  test(`${ruleId} fires on its positive fixture`, () => {
    const d = cleanDataset();
    mutate(d);
    const results = runRules(d, { now: "2026-06-02T01:00:00Z" });
    const r = results.find((x) => x.id === ruleId);
    assert(r, `rule ${ruleId} is not registered`);
    assert(r.status === "FAIL",
      `${ruleId} did not fire — a rule that cannot fail is decoration, not a control (status=${r.status}${r.error ? ", error=" + r.error : ""})`);
  });
}

test("every registered rule has a positive fixture", () => {
  const covered = new Set(BREAKAGES.map(([id]) => id));
  const missing = RULES.map((r) => r.id).filter((id) => !covered.has(id));
  assert(missing.length === 0,
    `rule(s) with no positive fixture — unprovable, therefore untrusted: ${missing.join(", ")}`);
});

test("every rule declares severity, why and a SQL sketch", () => {
  const bad = RULES.filter((r) => !r.severity || !r.why || !r.sql).map((r) => r.id);
  assert(bad.length === 0, `incomplete rule metadata: ${bad.join(", ")}`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ FINANCIAL + DATA-QUALITY TESTS PASSED\n" : "✗ FINANCIAL + DATA-QUALITY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
