#!/usr/bin/env node
/**
 * Integrated WS6 + WS7 + WS12 scenario (Workstream 12.30).
 *
 * One synthetic legacy document travels the whole pipeline and every stage's guarantee is asserted on the
 * SAME data, which is the thing no single-workstream test can do:
 *
 *   legacy JSON → transformers → backfill → normalized target
 *              → authorization simulation → financial reconciliation → scoring parity → report read model
 *
 * The scenario deliberately contains the awkward cases, because a pipeline that only handles the easy path
 * proves nothing: participant A, participant B, a THIRD-PARTY payer who is neither, A holding two entries,
 * a partial payment, an unallocatable legacy assertion, predictions from both users, and a match result.
 *
 * No production data. No database.
 */

import { transformAll, SEVERITY } from "./transformers.mjs";
import { bindSyntheticSource, ALL_DOMAINS, participantsDomain, entriesDomain, paymentsDomain, resultsDomain } from "./backfill_domains.mjs";
import { runBackfill, makeStore, makeCheckpointStore, RUN_STATUS } from "./backfill.mjs";
import { loadRlsModel, authorize } from "./rls.mjs";
import { parseMoney, sum, settlementStatus, poolReconciliation, SETTLEMENT } from "./financial.mjs";
import { inputParity, canonicalPicksFromJson, canonicalPicksFromPredictions, assembleRanking, TIE_CASCADES } from "./scoring_parity.mjs";

let pass = 0, fail = 0, assertions = 0;
const test = async (n, fn) => {
  try { await fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { assertions++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { assertions++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const USD = "USD";
const FEE = parseMoney("5.00", USD);
const RLS = loadRlsModel();

/**
 * The legacy document. Note what it does NOT contain: any amount for the paid flags. That absence is the
 * whole reason the financial stage below expects LEGACY_ASSERTED rather than a total.
 */
const LEGACY = {
  entries: [
    { id: "en-A1", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid",
      payerName: "Synthetic Alpha", paymentMethod: "zelle",
      picks: { "m-1": { h: 1, a: 0 }, "m-2": { h: 2, a: 2 } },
      createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z" },
    { id: "en-A2", entryName: "Synthetic Alpha", participantEmail: "alpha@example.invalid",
      entryLabel: "second", picks: { "m-1": { h: 0, a: 0 } },
      createdAt: "2026-06-01T01:00:00Z", updatedAt: "2026-06-01T01:00:00Z" },
    { id: "en-B1", entryName: "Synthetic Beta", participantEmail: "beta@example.invalid",
      payerName: "Synthetic Gamma", paymentMethod: "venmo",     // THIRD-PARTY payer
      picks: { "m-1": { h: 3, a: 1 } },
      createdAt: "2026-06-02T00:00:00Z", updatedAt: "2026-06-02T00:00:00Z" },
  ],
  paid: { "en-A1": true, "en-B1": true, "en-A2": false },
  deletedIds: [],
  auditLog: [{ ts: "2026-06-01T00:00:00Z", action: "entry_created", admin: false, detail: "must not survive", entryId: "en-A1" }],
  results: { "m-1": { h: 1, a: 0 } },
  lastSync: "2026-06-05T00:00:00Z",
  siteVersion: "4.159",
};

const CTX = { sourceVersion: "v4-copa", poolId: "pool-X", editionId: "ed-1", expectedFee: FEE };

console.log("\nSTAGE 1 — transformation\n");

let transformed;
await test("the legacy document transforms with no FATAL", async () => {
  transformed = transformAll(LEGACY, CTX);
  const fatals = transformed.findings.filter((f) => f.severity === SEVERITY.FATAL);
  eq(fatals.length, 0, `fatals: ${fatals.map((f) => f.code).join(", ")}`);
});

await test("three entries, two participants, and the third-party payer is NOT resolved", async () => {
  eq(transformed.results.transformPoolEntries.records.length, 3, "three entries");
  eq(transformed.results.transformParticipants.records.length, 2, "two distinct identities — A's two entries are one person");
  const pays = transformed.results.transformPayments.records;
  eq(pays.length, 2, "two asserted payments");
  const b = pays.find((p) => p.asserted_for_pool_entry_id === "en-B1");
  eq(b.payer_identity_key, null, "the third-party payer must NOT be resolved to a participant");
  eq(b.payer_name_as_recorded, "Synthetic Gamma", "but the recorded payer name must survive verbatim");
  const a = pays.find((p) => p.asserted_for_pool_entry_id === "en-A1");
  assert(a.payer_identity_key, "self-payment resolves — one entry, one name");
});

await test("no amount, currency or allocation is invented anywhere", async () => {
  for (const p of transformed.results.transformPayments.records) {
    eq(p.amount, null, "amount invented");
    eq(p.currency, null, "currency invented");
  }
  eq(transformed.results.transformPaymentAllocations.records.length, 0, "an allocation was fabricated");
});

console.log("\nSTAGE 2 — backfill\n");

const stores = new Map();
await test("every domain backfills to COMPLETE against the transformed records", async () => {
  bindSyntheticSource(LEGACY, CTX);
  for (const d of ALL_DOMAINS) {
    const store = makeStore();
    const cps = makeCheckpointStore(store);
    const run = await runBackfill(d, { store, checkpointStore: cps, batchSize: 2 });
    stores.set(d.name, store);
    eq(run.status, RUN_STATUS.COMPLETE, `${d.name}: ${JSON.stringify(run.reconciliation.findings)}`);
  }
});

await test("payer attribution survives the backfill", async () => {
  const rows = await stores.get("payments").rows();
  eq(rows.length, 2, "two payments landed");
  const b = rows.find((r) => r.row.asserted_for_pool_entry_id === "en-B1");
  eq(b.row.payer_identity_key, null, "the third party is still unresolved after the backfill");
  eq(b.row.payer_name_as_recorded, "Synthetic Gamma", "and the name is still there — this is the attribution that must not be lost");
});

await test("the audit backfill carried no legacy free text", async () => {
  const rows = await stores.get("audit_events").rows();
  for (const r of rows) {
    assert(!JSON.stringify(r.row).includes("must not survive"), "legacy detail leaked through the whole pipeline");
  }
});

console.log("\nSTAGE 3 — authorization over the normalized state\n");

/** The identities the pipeline produced, mapped to synthetic auth users. */
let PA, PB;
await test("participant ids resolve so ownership can be simulated", async () => {
  const rows = await stores.get("participants").rows();
  eq(rows.length, 2, "two participants");
  PA = rows.find((r) => r.row.email === "alpha@example.invalid").key;
  PB = rows.find((r) => r.row.email === "beta@example.invalid").key;
  assert(PA && PB && PA !== PB, "two distinct identity keys");
});

await test("A reads only A's entries; B reads only B's — on the ACTUAL backfilled rows", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  const entriesById = new Map(entries.map((e) => [e.pool_entry_id, { ...e, participant_id: e.identity_key }]));
  const asA = { ownedParticipantIds: new Set([PA]), entriesById };
  const asB = { ownedParticipantIds: new Set([PB]), entriesById };

  const mine = entries.filter((e) => authorize(RLS, { entity: "pool_entries", command: "SELECT", principal: "authenticated",
    row: { ...e, participant_id: e.identity_key }, ctx: asA }).allowed);
  eq(mine.length, 2, "A sees exactly their two entries");
  assert(mine.every((e) => e.identity_key === PA), "and nothing else");

  const theirs = entries.filter((e) => authorize(RLS, { entity: "pool_entries", command: "SELECT", principal: "authenticated",
    row: { ...e, participant_id: e.identity_key }, ctx: asB }).allowed);
  eq(theirs.length, 1, "B sees exactly their one entry");
  eq(theirs[0].pool_entry_id, "en-B1", "the right one");
});

await test("no user can read any payment row, and anon can read none of it", async () => {
  const payments = (await stores.get("payments").rows()).map((r) => r.row);
  const asA = { ownedParticipantIds: new Set([PA]), entriesById: new Map() };
  const asAnon = { ownedParticipantIds: new Set(), entriesById: new Map() };
  for (const p of payments) {
    assert(!authorize(RLS, { entity: "payments", command: "SELECT", principal: "authenticated", row: p, ctx: asA }).allowed,
      "a browser must not read the payment ledger, even its own row — financial reads go through a runtime-owned view");
    assert(!authorize(RLS, { entity: "payments", command: "SELECT", principal: "anon", row: p, ctx: asAnon }).allowed,
      "and certainly not anonymously");
  }
});

await test("no cross-user prediction access on the backfilled predictions", async () => {
  // predictions is intentionally empty at M7 (picks stay in jsonb), so the check is on the ENTRY that owns them.
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  const entriesById = new Map(entries.map((e) => [e.pool_entry_id, { ...e, participant_id: e.identity_key }]));
  const asA = { ownedParticipantIds: new Set([PA]), entriesById };
  const bPrediction = { prediction_id: "pr-B", pool_entry_id: "en-B1" };
  assert(!authorize(RLS, { entity: "predictions", command: "SELECT", principal: "authenticated", row: bPrediction, ctx: asA }).allowed,
    "A must not reach a prediction belonging to B's entry");
});

console.log("\nSTAGE 4 — financial reconciliation\n");

await test("every entry settles as LEGACY_ASSERTED or UNPAID — never as a fabricated total", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  const payments = (await stores.get("payments").rows()).map((r) => r.row);
  const assertedFor = new Set(payments.map((p) => p.asserted_for_pool_entry_id));

  const tally = { unpaid: 0, legacy_asserted: 0, other: 0 };
  for (const e of entries) {
    const legacy = assertedFor.has(e.pool_entry_id);
    const s = settlementStatus({
      // KPLUS-F015: `expected_fee_amount` is the TARGET COLUMN's representation — an exact decimal in
      // MAJOR units — so it is parsed, not spliced into a minor-unit money object. Reading it as minor
      // was the consumer-side half of the same defect.
      expected: parseMoney(e.expected_fee_amount, e.expected_fee_currency),
      allocated: { minor: 0, currency: e.expected_fee_currency },
      legacyAsserted: legacy,
    });
    if (s === SETTLEMENT.LEGACY_ASSERTED) tally.legacy_asserted++;
    else if (s === SETTLEMENT.UNPAID) tally.unpaid++;
    else tally.other++;
  }
  eq(tally.legacy_asserted, 2, "the two asserted entries");
  eq(tally.unpaid, 1, "the unpaid one");
  eq(tally.other, 0, "no entry may be reported settled: no allocation exists, so no money is provably collected");
});

await test("pool reconciliation reports zero collected, and states the outstanding honestly", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  const r = poolReconciliation({
    currency: USD,
    entries: entries.map((e) => ({ expected: parseMoney(e.expected_fee_amount, e.expected_fee_currency) })),
    allocations: [],
    prizes: [],
  });
  eq(r.expectedTotal.minor, 1500, "three entries at 5.00");
  eq(r.collected.minor, 0, "nothing is provably collected — the legacy flags carried no amount");
  eq(r.outstanding.minor, 1500, "so the whole expected total is outstanding, which is the honest statement");
  eq(r.fullyCollected, false, "and it must not claim otherwise");
});

console.log("\nSTAGE 5 — scoring parity\n");

await test("picks survive the pipeline byte-identically", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  for (const src of LEGACY.entries) {
    const migrated = entries.find((e) => e.pool_entry_id === src.id);
    assert(migrated, `entry ${src.id} lost`);
    eq(JSON.stringify(migrated.picks ?? null), JSON.stringify(src.picks ?? null),
      `entry ${src.id}: picks were altered, which would change scores`);
  }
});

await test("the canonical scoring input from the migrated picks matches the legacy picks exactly", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  for (const src of LEGACY.entries) {
    const migrated = entries.find((e) => e.pool_entry_id === src.id);
    const rows = Object.entries(migrated.picks || {}).map(([mid, p]) => ({ match_id: mid, home_goals: p.h, away_goals: p.a }));
    const r = inputParity(src.picks ?? {}, rows);
    assert(r.identical, `entry ${src.id}: input parity failed — ${JSON.stringify(r.diffs)}`);
  }
});

await test("ranking assembly over the migrated entries is deterministic", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  const scored = entries.map((e, i) => ({ pool_entry_id: e.pool_entry_id, metrics: { total: (i * 5) % 11, exact: i % 3, podium: i % 2 } }));
  const a = assembleRanking(scored, TIE_CASCADES.copa2026);
  const b = assembleRanking([...scored].reverse(), TIE_CASCADES.copa2026);
  eq(a.map((x) => `${x.pool_entry_id}:${x.position}`).join(","),
     b.map((x) => `${x.pool_entry_id}:${x.position}`).join(","), "ranking depends on input order");
});

await test("the recorded match result survives and is the only public one", async () => {
  const results = (await stores.get("match_results").rows()).map((r) => r.row);
  eq(results.length, 1, "one result");
  eq(results[0].home_goals, 1, "goals preserved");
  const asAnon = { ownedParticipantIds: new Set(), entriesById: new Map() };
  assert(authorize(RLS, { entity: "match_results", command: "SELECT", principal: "anon", row: results[0], ctx: asAnon }).allowed,
    "the current official result is public");
});

console.log("\nSTAGE 6 — report read model\n");

await test("a participant-history read model is buildable and leaks nothing across users", async () => {
  const entries = (await stores.get("pool_entries").rows()).map((r) => r.row);
  const entriesById = new Map(entries.map((e) => [e.pool_entry_id, { ...e, participant_id: e.identity_key }]));
  const build = (owner) => {
    const ctx = { ownedParticipantIds: new Set([owner]), entriesById };
    return entries
      .filter((e) => authorize(RLS, { entity: "pool_entries", command: "SELECT", principal: "authenticated",
        row: { ...e, participant_id: e.identity_key }, ctx }).allowed)
      .map((e) => ({ pool_entry_id: e.pool_entry_id, entry_label: e.entry_label,
        expected_fee: `${e.expected_fee_amount} ${e.expected_fee_currency}` }));
  };
  const forA = build(PA), forB = build(PB);
  eq(forA.length, 2, "A's history has two entries");
  eq(forB.length, 1, "B's has one");
  const overlap = forA.filter((x) => forB.some((y) => y.pool_entry_id === x.pool_entry_id));
  eq(overlap.length, 0, "the two read models must not overlap");
  // Currency is explicit in the projection: an amount without one is not money.
  for (const row of [...forA, ...forB]) assert(/USD$/.test(row.expected_fee), "currency lost in the read model");
});

await test("no read model built through the authorization layer can expose a payment", async () => {
  const payments = (await stores.get("payments").rows()).map((r) => r.row);
  const ctx = { ownedParticipantIds: new Set([PA, PB]), entriesById: new Map() };
  const visible = payments.filter((p) => authorize(RLS, { entity: "payments", command: "SELECT", principal: "authenticated", row: p, ctx }).allowed);
  eq(visible.length, 0, "even a caller owning BOTH participants sees no payment row directly");
});

console.log(`\n  ${pass} passed, ${fail} failed  ·  ${assertions} assertions\n`);
console.log(fail === 0 ? "✓ INTEGRATED SCENARIO PASSED\n" : "✗ INTEGRATED SCENARIO FAILED\n");
process.exit(fail === 0 ? 0 : 1);
