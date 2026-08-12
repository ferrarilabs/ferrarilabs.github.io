#!/usr/bin/env node
/**
 * Tests for the JSON→relational parity harness (Workstream M).
 *
 * THE SHAPE OF THESE TESTS
 * The harness is a control over the migration. A control is only worth its runtime if it can fail
 * when the thing it guards is broken. So for each parity invariant there is a CORRUPTED TRANSFORM —
 * a decompose() output deliberately damaged in exactly the way that invariant exists to catch — and
 * the invariant must fire on it. Tests that only ever feed the harness a correct transform prove
 * nothing except that the harness does not crash.
 *
 * All fixtures are synthetic: `example.invalid` addresses, `Synthetic A` names, round amounts.
 * No production document is read, and no real participant, email or payment reference appears.
 *
 * Usage: node scripts/db/test_json_parity.mjs
 */

import {
  DISPOSITIONS, LOSSY_BY_DESIGN, OPAQUE_CONTAINERS, observedPaths, coverage,
  decompose, recompose, roundTrip, runParity, PARITY_INVARIANTS,
} from "./json_parity.mjs";
import { parseMoney } from "./financial.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const FEE = parseMoney("5.00", "USD");
const OPTS = { poolId: "pool-x", editionId: "ed-1", expectedFee: FEE };

/** A synthetic document exercising every disposition class at once. */
function syntheticState() {
  return {
    entries: [
      { id: "en-1", entryName: "Synthetic A", participantEmail: "synthetic-a@example.invalid",
        payerName: "Synthetic A", paymentMethod: "zelle",
        picks: { "m-1": { h: 1, a: 0 } }, createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" },
      { id: "en-2", entryName: "Synthetic B", participantEmail: "synthetic-b@example.invalid",
        picks: { "m-1": { h: 2, a: 2 } }, createdAt: "2026-06-01T01:00:00Z", updatedAt: "2026-06-01T01:00:00Z" },
      { id: "en-3", entryName: "Synthetic C", participantEmail: null,
        picks: null, createdAt: "2026-06-01T02:00:00Z", updatedAt: "2026-06-02T00:00:00Z" },
    ],
    paid: { "en-1": true, "en-2": false },
    deletedIds: ["en-3"],
    auditLog: [
      { ts: "2026-06-01T00:00:00Z", action: "entry_created", admin: false, detail: "free text that must not survive" },
      { ts: "2026-06-01T03:00:00Z", action: "entry_deleted", admin: true, detail: "another free text detail" },
    ],
    results: { "m-1": { h: 1, a: 0 } },
    lastSync: "2026-06-02T00:00:00Z",
    siteVersion: "4.159",
  };
}

console.log("\nCoverage — an unaccounted key IS the silent-loss mechanism\n");

test("every key in the synthetic document has a disposition", () => {
  const c = coverage(syntheticState());
  assert(c.unaccounted.length === 0,
    `unaccounted key path(s): ${c.unaccounted.join(", ")} — a key nobody decided about is how data is lost silently`);
});

test("coverage detects a brand-new undeclared key", () => {
  const s = syntheticState();
  s.entries[0].mysteryNewField = "x";
  const c = coverage(s);
  assert(c.unaccounted.includes("entries[].mysteryNewField"),
    "a key added by a future app version must be reported as unaccounted, not silently ignored");
});

test("observedPaths collapses arrays so element index does not multiply paths", () => {
  const p = observedPaths({ entries: [{ a: 1 }, { a: 2 }] });
  assert(p.has("entries[].a"), "array elements must collapse to a single [] path");
  assert(!p.has("entries[0].a"), "indexed paths would make coverage grow with row count");
});

test("every opaque container is itself a declared key", () => {
  const undeclared = [...OPAQUE_CONTAINERS].filter((p) => !(p in DISPOSITIONS));
  assert(undeclared.length === 0,
    `opaque container(s) with no disposition: ${undeclared.join(", ")} — declaring a container opaque ` +
    `stops coverage descending into it, so the container itself must be accounted for or the whole subtree escapes review`);
});

test("opacity does not hide a new sibling key next to an opaque container", () => {
  const s = syntheticState();
  s.entries[0].picksMetadata = { source: "x" };  // sibling of the opaque `picks`
  assert(coverage(s).unaccounted.includes("entries[].picksMetadata"),
    "opacity must be scoped to the named container only, never to its neighbours");
});

test("every LOSSY_BY_DESIGN entry cites a decision and a reason", () => {
  const bad = LOSSY_BY_DESIGN.filter((l) => !l.decision || !l.why).map((l) => l.path);
  assert(bad.length === 0, `authorised loss without a citation: ${bad.join(", ")} — the allowlist must never be the easy path out`);
});

test("every authorised loss names a key that actually has a disposition", () => {
  const roots = LOSSY_BY_DESIGN.map((l) => l.path.split(/[.[]/)[0]);
  const orphans = roots.filter((r) => !(r in DISPOSITIONS));
  assert(orphans.length === 0, `authorised loss for unknown key(s): ${orphans.join(", ")}`);
});

console.log("\nParity — correct transform must pass every invariant\n");

test("the reference transform passes all parity invariants", () => {
  const r = runParity(syntheticState(), OPTS);
  const bad = r.invariants.filter((i) => i.status !== "PASS");
  assert(bad.length === 0, `${bad.length} invariant(s) fired on a correct transform:\n      ` +
    bad.map((i) => `${i.id} ${i.findings.join("; ")}${i.error ? " ERROR:" + i.error : ""}`).join("\n      "));
});

test("verdict is PASS end to end on the synthetic document", () => {
  eq(runParity(syntheticState(), OPTS).verdict, "PASS", "verdict");
});

test("decompose refuses to run without an explicit expected fee (B-08)", () => {
  let threw = false;
  try { decompose(syntheticState(), { poolId: "pool-x", editionId: "ed-1" }); } catch { threw = true; }
  assert(threw, "an inferred entry fee would fabricate money and must be impossible to reach by accident");
});

test("a legacy paid flag never produces an amount or an allocation (D-1)", () => {
  const d = decompose(syntheticState(), OPTS);
  eq(d.payments.length, 1, "one paid=true ⇒ one payment");
  eq(d.payments[0].amount, null, "amount must stay NULL — the flag carried none");
  eq(d.payment_allocations.length, 0, "no allocation may be fabricated from a flag");
});

test("paid=false produces no payment at all", () => {
  const d = decompose(syntheticState(), OPTS);
  assert(!d.pool_entries.find((e) => e.pool_entry_id === "en-2").legacy_asserted,
    "an explicit paid=false must not be recorded as an assertion of payment");
});

test("participants dedupe by email, not by display name", () => {
  const s = syntheticState();
  // Same person, differently typed name, same email — must collapse to one identity.
  s.entries.push({ id: "en-4", entryName: "synthetic a", participantEmail: "SYNTHETIC-A@example.invalid",
    picks: null, createdAt: "2026-06-01T04:00:00Z", updatedAt: "2026-06-01T04:00:00Z" });
  const d = decompose(s, OPTS);
  const forA = d.pool_entries.filter((e) => ["en-1", "en-4"].includes(e.pool_entry_id)).map((e) => e.participant_id);
  eq(new Set(forA).size, 1, "case/whitespace variants of one email must resolve to one participant");
  eq(d.pool_entries.length, 4, "deduplicating identities must NOT reduce the entry count");
});

test("an entry with no email is not merged with another email-less entry by accident", () => {
  const s = syntheticState();
  s.entries.push({ id: "en-5", entryName: "Synthetic D", participantEmail: null, picks: null,
    createdAt: "2026-06-01T05:00:00Z", updatedAt: "2026-06-01T05:00:00Z" });
  const d = decompose(s, OPTS);
  const ids = d.pool_entries.filter((e) => ["en-3", "en-5"].includes(e.pool_entry_id)).map((e) => e.participant_id);
  eq(new Set(ids).size, 2, "two different names with no email are two people until an operator says otherwise");
});

console.log("\nParity — each invariant must fire on the damage it guards against\n");

/** Each mutator damages the DATASET (the transform output), which is what parity actually guards. */
const CORRUPTIONS = [
  ["PAR-01", (s, d) => { d.pool_entries.pop(); }],
  ["PAR-02", (s, d) => { d.pool_entries[0].pool_entry_id = "en-substituted"; }],
  ["PAR-03", (s, d) => { d.pool_entries.find((e) => e.pool_entry_id === "en-3").deleted_at = null; }],
  ["PAR-04", (s, d) => { d.participants.push({ participant_id: "p-split", display_name: "Synthetic A", email: "synthetic-a@example.invalid" }); d.pool_entries[0].participant_id = "p-split"; }],
  ["PAR-05", (s, d) => { d.participants.push({ participant_id: "p-orphan", display_name: "Synthetic Z", email: null }); }],
  ["PAR-06", (s, d) => { d.payments[0].amount = parseMoney("5.00", "USD"); }],
  ["PAR-07", (s, d) => { d.payment_allocations.push({ allocation_id: "al-fab", payment_id: d.payments[0].payment_id, pool_entry_id: "en-1", allocated_amount: parseMoney("5.00", "USD") }); }],
  ["PAR-08", (s, d) => { d.audit_events.pop(); }],
  ["PAR-09", (s, d) => { d.audit_events[0].safe_metadata = { detail: "free text that must not survive" }; }],
  ["PAR-10", (s, d) => { d.audit_events.reverse(); }],
  ["PAR-11", (s, d) => { d.match_results[0].match_id = "m-wrong"; }],
  ["PAR-12", (s, d) => { d.pool_entries[0].picks = { "m-1": { h: 9, a: 9 } }; }],
  ["PAR-13", (s, d) => { d.pool_entries[1].expected = parseMoney("5.00", "BRL"); }],
  ["PAR-14", (s, d) => { d.payments[0].asserted_for_pool_entry_id = null; }],
  ["PAR-15", (s, d) => { d.payments[0].payer_participant_id = "p-someone-else"; }],
];

for (const [id, corrupt] of CORRUPTIONS) {
  test(`${id} fires on a transform corrupted in exactly its failure mode`, () => {
    const s = syntheticState();
    const d = decompose(s, OPTS);
    corrupt(s, d);
    const rule = PARITY_INVARIANTS.find((r) => r.id === id);
    assert(rule, `${id} is not registered`);
    const findings = rule.check(s, d);
    assert(findings.length > 0,
      `${id} did not fire on its own corruption — an invariant that cannot fail does not protect the migration`);
  });
}

test("every registered invariant has a corruption fixture", () => {
  const covered = new Set(CORRUPTIONS.map(([id]) => id));
  const missing = PARITY_INVARIANTS.map((r) => r.id).filter((id) => !covered.has(id));
  assert(missing.length === 0, `invariant(s) never proven able to fail: ${missing.join(", ")}`);
});

test("every invariant states why it exists", () => {
  const bad = PARITY_INVARIANTS.filter((r) => !r.why || !r.title).map((r) => r.id);
  assert(bad.length === 0, `invariant(s) with no stated purpose: ${bad.join(", ")}`);
});

test("a third-party payer stays a distinct identity (UNKNOWN-1 is not guessed away)", () => {
  const s = syntheticState();
  s.entries[1].payerName = "Synthetic Payer";   // a different person paid for entry en-2
  s.paid["en-2"] = true;
  const d = decompose(s, OPTS);
  const pay = d.payments.find((p) => p.asserted_for_pool_entry_id === "en-2");
  const entry = d.pool_entries.find((e) => e.pool_entry_id === "en-2");
  assert(pay.payer_participant_id !== entry.participant_id,
    "a payer with a different name must not be collapsed into the entrant — that would misattribute their money");
  eq(pay.payer_name_as_recorded, "Synthetic Payer", "the recorded payer name must survive verbatim");
});

test("a self-paying entrant resolves to one identity, not two", () => {
  const d = decompose(syntheticState(), OPTS);
  const pay = d.payments.find((p) => p.asserted_for_pool_entry_id === "en-1");
  const entry = d.pool_entries.find((e) => e.pool_entry_id === "en-1");
  eq(pay.payer_participant_id, entry.participant_id,
    "same name on the same entry is self-payment, and splitting it detaches the payment from the payer");
});

console.log("\nRound-trip — the only check that catches a field moved to the WRONG column\n");

test("round-trip differences are all authorised on a correct transform", () => {
  const s = syntheticState();
  const r = roundTrip(s, decompose(s, OPTS));
  assert(r.unauthorised.length === 0,
    `unauthorised round-trip difference(s):\n      ` +
    r.unauthorised.map((d) => `${d.kind} at ${d.path}`).join("\n      "));
  assert(r.diffs.length > 0,
    "zero differences would mean the authorised-loss list is untested — paid/deletedIds/siteVersion must differ");
});

test("round-trip catches a field written to the wrong column", () => {
  const s = syntheticState();
  const d = decompose(s, OPTS);
  // The classic silent defect: email and display name transposed during backfill.
  const p = d.participants[0];
  [p.display_name, p.email] = [p.email, p.display_name];
  const r = roundTrip(s, d);
  assert(r.unauthorised.length > 0,
    "transposing name and email must surface as an unauthorised round-trip difference — no other check sees it");
});

test("round-trip catches a lost timestamp", () => {
  const s = syntheticState();
  const d = decompose(s, OPTS);
  d.pool_entries[0].created_at = null;
  assert(roundTrip(s, d).unauthorised.length > 0, "a dropped createdAt must be unauthorised");
});

test("authorised loss is scoped to its own key, not blanket-forgiven", () => {
  const s = syntheticState();
  const d = decompose(s, OPTS);
  // `paid` is authorised-lossy. That must NOT also excuse damage to `entries`.
  d.pool_entries[0].updated_at = "1999-01-01T00:00:00Z";
  const r = roundTrip(s, d);
  assert(r.unauthorised.some((x) => x.path.startsWith("entries")),
    "an authorised loss on one key must never suppress a defect on another");
});

test("recompose is pure — it does not mutate the dataset it reads", () => {
  const s = syntheticState();
  const d = decompose(s, OPTS);
  const before = JSON.stringify(d);
  recompose(d);
  eq(JSON.stringify(d), before, "recompose mutated its input");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ JSON PARITY TESTS PASSED\n" : "✗ JSON PARITY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
