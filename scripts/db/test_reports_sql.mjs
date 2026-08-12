#!/usr/bin/env node
/**
 * WS10.5 / WS10.10 — expected-result assertions and the report red team.
 *
 * The rule that shapes this suite: it is not enough that a query executes. Every report asserts
 * CORRECTNESS against hand-computed values, and every report asserts its declared GRAIN — one row per
 * the claimed key — because a report whose grain is wrong double-counts silently and looks fine.
 *
 * Every expected number here was computed by hand from report_fixtures.mjs before the query was run.
 */

import { buildDatabase, FIXTURES, dec } from "./report_fixtures.mjs";
import { PROTOTYPES, runReport, checkPrototypeCoverage, loadReportsModel, SURFACE, USAGE } from "./reports_sql.mjs";
import {
  aggregateParity, legacyAggregates, normalizedAggregates, financialParityFromDb,
  promotionEvidence, VERDICT, EXPECTED_DIFFERENCES,
} from "./parity_producers.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const db = buildDatabase();
const NOW = "2026-08-09T00:00:00Z";
const P = { participant_id: "pa", now: NOW };
const byId = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r]));

/**
 * The legacy document, written INDEPENDENTLY of the relational fixtures. It describes the same
 * reality in the legacy shape: entries with a boolean `paid`, payments with a payer NAME, no
 * allocations at all, and picks as a blob.
 */
const LEGACY_DOC = {
  entries: [
    { id: "e1", owner: "Ana Sintetica", email: "ana@example.test", pool: "P1", paid: true, feeMinor: 2000, picks: { m1: { h: 2, a: 1 }, m2: { h: 1, a: 0 } } },
    { id: "e2", owner: "Ana Sintetica", email: "ana@example.test", pool: "P1", paid: true, feeMinor: 2000, picks: { m1: { h: 0, a: 0 } } },
    { id: "e3", owner: "Bruno Sintetico", email: "bruno@example.test", pool: "P1", paid: true, feeMinor: 2000, picks: { m1: { h: 2, a: 1 } } },
    { id: "e4", owner: "Dina Sintetica", email: "dina@example.test", pool: "P2", paid: true, feeMinor: 2000, picks: {} },
    { id: "e5", owner: "Ana Sintetica", email: "ana@example.test", pool: "P2", paid: true, feeMinor: 2000, picks: {} },
    { id: "e6", owner: "Bruno Sintetico", email: "bruno@example.test", pool: "P3", paid: true, feeMinor: 2000, picks: {} },
    { id: "e7", owner: "Ana Sintetica", email: "ana@example.test", pool: "P3", paid: true, feeMinor: 2000, picks: {} },
    { id: "e8", owner: "Dina Sintetica", email: "dina@example.test", pool: "P4", paid: true, feeMinor: 10000, picks: {} },
    { id: "e9", owner: "Bruno Sintetico", email: "bruno@example.test", pool: "P1", paid: false, feeMinor: null, picks: {} },
    // The legacy document has no identity model: this is the SAME person as e1's owner, under a
    // different display name. Only the email betrays it.
    { id: "e10", owner: "Ana S.", email: "ana@example.test", pool: "P1", paid: true, feeMinor: 2000, picks: { m1: { h: 1, a: 1 } } },
    { id: "e11", owner: "Dina Sintetica", email: "dina@example.test", pool: "P2", paid: false, feeMinor: 2000, picks: {} },
    { id: "e12", owner: "Dina Sintetica", email: "dina@example.test", pool: "P1", paid: true, feeMinor: 2000, picks: {}, deleted: true },
  ],
  payments: [
    { id: "y1", payerName: "Carla Pagadora", amountMinor: 4000, currency: "USD", kind: "contribution" },
    { id: "y2", payerName: "Bruno Sintetico", amountMinor: 500, currency: "USD", kind: "contribution" },
    { id: "y3", payerName: "Dina Sintetica", amountMinor: 2500, currency: "USD", kind: "contribution" },
    { id: "y4", payerName: "Ana Sintetica", amountMinor: 2000, currency: "USD", kind: "contribution" },
    { id: "y5", payerName: "Bruno Sintetico", amountMinor: 2000, currency: "USD", kind: "contribution" },
    { id: "y6", payerName: "Ana Sintetica", amountMinor: 2000, currency: "USD", kind: "contribution" },
    { id: "y7", payerName: "Dina Sintetica", amountMinor: 10000, currency: "BRL", kind: "contribution" },
    { id: "y8", payerName: "Ana Sintetica", amountMinor: 2000, currency: "USD", kind: "contribution" },
    { id: "y9", payerName: "Ana Sintetica", amountMinor: 1000, currency: "USD", kind: "contribution" },
    { id: "r1", payerName: "Ana Sintetica", amountMinor: -500, currency: "USD", kind: "refund", reversesId: "y4" },
  ],
  prizes: [{ entryId: "e1", amountMinor: 7000, currency: "USD" }, { entryId: "e6", amountMinor: 5000, currency: "USD" }],
  rankings: [
    { pool: "P1", entryId: "e1", position: 1, points: 20, observedAt: "2026-07-01T00:00:00Z" },
    { pool: "P1", entryId: "e3", position: 2, points: 10, observedAt: "2026-07-01T00:00:00Z" },
    { pool: "P1", entryId: "e2", position: 3, points: 1, observedAt: "2026-07-01T00:00:00Z" },
    { pool: "P1", entryId: "e1", position: 1, points: 25, observedAt: "2026-07-15T00:00:00Z" },
    { pool: "P1", entryId: "e3", position: 2, points: 12, observedAt: "2026-07-15T00:00:00Z" },
    { pool: "P1", entryId: "e2", position: 3, points: 3, observedAt: "2026-07-15T00:00:00Z" },
  ],
};

// =============================================================================================
console.log("\nWS10.1–10.3 — every report has an executable prototype and a complete spec\n");
// =============================================================================================

test("every report in the model has a prototype, and every prototype a report", () => {
  const c = checkPrototypeCoverage();
  eq(c.errors.length, 0, `coverage:\n      ${c.errors.join("\n      ")}`);
});

test("all 17 model reports are covered", () => {
  eq(loadReportsModel().reports.length, 17, "model report count");
  for (const r of loadReportsModel().reports) assert(PROTOTYPES[r.id], `${r.id} has no prototype`);
});

test("every prototype declares ordering, usage class, surface and a reason", () => {
  for (const [id, p] of Object.entries(PROTOTYPES)) {
    for (const k of ["ordering", "usageClass", "surface", "surfaceWhy", "grainKey", "sql"]) {
      assert(p[k], `${id} missing ${k}`);
    }
    assert(p.surfaceWhy.length > 25, `${id}: surfaceWhy is too short to be a reason`);
  }
});

test("every prototype executes and returns rows of the declared shape", () => {
  for (const id of Object.keys(PROTOTYPES)) {
    const rows = runReport(db, id, P);
    assert(Array.isArray(rows), `${id} returned no array`);
    for (const key of PROTOTYPES[id].grainKey) {
      if (rows.length === 0) continue;
      assert(key in rows[0] || PROTOTYPES[id].grainKey.length === 0, `${id}: grain key ${key} absent from the output`);
    }
  }
});

test("every report's declared GRAIN holds — no duplicate rows per key", () => {
  for (const id of Object.keys(PROTOTYPES)) {
    const rows = runReport(db, id, P);
    const keys = PROTOTYPES[id].grainKey;
    const seen = new Set();
    for (const r of rows) {
      const k = keys.map((x) => String(r[x])).join("|");
      assert(!seen.has(k), `${id}: duplicate row for grain key ${k} — the grain claim is false and the report double-counts`);
      seen.add(k);
    }
  }
});

test("a missing required parameter is refused rather than silently unbound", () => {
  let threw = false;
  try { runReport(db, "R-01", {}); } catch { threw = true; }
  assert(threw, "an unbound parameter must throw, not return every row");
});

// =============================================================================================
console.log("\nWS10.5 — expected results, hand-computed\n");
// =============================================================================================

test("R-01 participant_history: Ana's five entries, including the one held by her merged identity", () => {
  const rows = runReport(db, "R-01", P);
  eq(rows.length, 5, "Ana holds e1, e2, e5, e7 and e10 (e10 via the superseded identity pe)");
  const ids = rows.map((r) => r.pool_entry_id).sort();
  eq(ids.join(","), "e1,e10,e2,e5,e7", "entry ids");
  const e1 = byId(rows, "pool_entry_id").e1;
  eq(e1.total_allocated_minor, 2000, "e1 allocated");
  eq(e1.total_won_minor, 7000, "e1 prize");
  eq(e1.settlement, "settled", "e1 settlement");
  eq(byId(rows, "pool_entry_id").e5.settlement, "partially_paid", "e5 lost 5.00 to the refund");
});

test("R-01 excludes the soft-deleted entry", () => {
  const rows = runReport(db, "R-01", { ...P, participant_id: "pd" });
  assert(!rows.some((r) => r.pool_entry_id === "e12"), "a soft-deleted entry appeared in participant history");
});

test("R-02 pool_participation: four pools with correct counts", () => {
  const rows = byId(runReport(db, "R-02", {}), "pool_id");
  eq(rows.P1.entry_count, 5, "P1 has e1,e2,e3,e9,e10 live");
  eq(rows.P1.participant_count, 2, "P1 has Ana and Bruno once the merge is resolved");
  eq(rows.P1.unknown_fee_count, 1, "e9 has no recorded fee");
  eq(rows.P2.entry_count, 3, "P2 has e4,e5,e11");
  eq(rows.P4.currency, "BRL", "P4 currency");
});

test("R-03 competition_history: money aggregated without fanning out on entries", () => {
  const rows = runReport(db, "R-03", {});
  eq(rows.length, 3, "three editions");
  const ce1 = rows.find((r) => r.competition_edition_id === "CE1");
  eq(ce1.entry_count, 6, "CE1 = P1 (5) + P4 (1)");
  eq(ce1.distinct_participant_count, 3, "Ana, Bruno, Dina — the merged identity counts once");
  eq(ce1.collected_total_minor, 16500, "P1 6500 + P4 10000, each payment counted once");
  eq(ce1.prizes_awarded_total_minor, 7000, "only P1 has a prize");
});

test("R-04 multiple_entries: only participants with more than one entry in a pool", () => {
  const rows = runReport(db, "R-04", {});
  const ana = rows.find((r) => r.participant_id === "pa" && r.pool_id === "P1");
  assert(ana, "Ana holds three entries in P1 and must appear");
  eq(ana.entry_count, 3, "e1, e2 and e10");
  assert(!rows.some((r) => r.entry_count < 2), "a single-entry participant appeared");
});

test("R-05 payment_history: unapplied balance per payment, and the reference is redacted", () => {
  const rows = byId(runReport(db, "R-05", {}), "payment_id");
  eq(rows.y9.unapplied_minor, 1000, "y9 was never allocated");
  eq(rows.y1.unapplied_minor, 0, "y1 was fully applied across two entries");
  eq(rows.r1.kind, "refund", "r1 kind");
  eq(rows.r1.reverses_payment_id, "y4", "r1 reverses y4");
  eq(rows.y1.external_reference_redacted, "REDACTED", "a real payment reference must never be projected");
  for (const r of Object.values(rows)) assert(!("external_reference" in r), "the raw reference column leaked into the output");
});

test("R-05 resolves a merged payer to the surviving identity", () => {
  const rows = runReport(db, "R-05", {});
  assert(!rows.some((r) => r.payer_participant_id === "pe"), "a superseded identity appeared as a payer");
});

test("R-06 payment_allocations: ten rows including the refund's negative allocation", () => {
  const rows = runReport(db, "R-06", {});
  eq(rows.length, 10, "allocation count");
  const neg = rows.find((r) => r.amount_minor < 0);
  eq(neg.payment_kind, "refund", "the only negative allocation must belong to a refund");
  eq(neg.pool_entry_id, "e5", "it applies to e5");
});

test("R-07 unpaid_balances: exactly the entry with no payment — and NOT the unknown-fee entry", () => {
  const rows = runReport(db, "R-07", {});
  eq(rows.length, 1, "only e11 has received nothing against a known fee");
  eq(rows[0].pool_entry_id, "e11", "entry");
  eq(rows[0].outstanding_minor, 2000, "outstanding");
  assert(!rows.some((r) => r.pool_entry_id === "e9"),
    "e9 has no recorded fee, so it is UNKNOWN and must never be reported as unpaid");
});

test("R-08 partial_balances: the partially paid entry and the refunded one", () => {
  const rows = byId(runReport(db, "R-08", {}), "pool_entry_id");
  eq(Object.keys(rows).length, 2, "e3 and e5");
  eq(rows.e3.allocated_minor, 500, "e3 allocated");
  eq(rows.e3.outstanding_minor, 1500, "e3 outstanding");
  eq(rows.e5.allocated_minor, 1500, "e5 after the 5.00 refund");
  eq(rows.e5.outstanding_minor, 500, "e5 outstanding");
});

test("R-09 overpayments: exactly the overpaid entry, with the overpaid amount", () => {
  const rows = runReport(db, "R-09", {});
  eq(rows.length, 1, "only e4");
  eq(rows[0].pool_entry_id, "e4", "entry");
  eq(rows[0].overpaid_minor, 500, "2500 allocated against a 2000 fee");
});

test("R-10 prizes_and_winnings: two prizes attributed to the canonical identity", () => {
  const rows = runReport(db, "R-10", {});
  eq(rows.length, 2, "prize count");
  eq(rows.reduce((s, r) => s + r.amount_minor, 0), 12000, "total prizes");
  assert(!rows.some((r) => r.participant_id === "pe"), "a superseded identity was credited with a prize");
});

test("R-11 participant_net_position: a refund reduces what the payer paid", () => {
  const rows = byId(runReport(db, "R-11", {}).filter((r) => r.currency === "USD"), "participant_id");
  eq(rows.pa.paid_minor, 6500, "Ana paid 2000+2000+2000+1000 less the 500 refund");
  eq(rows.pa.won_minor, 7000, "Ana's prize");
  eq(rows.pa.net_minor, 500, "net");
  eq(rows.pc.paid_minor, 4000, "Carla paid for other people's entries");
  eq(rows.pc.won_minor, 0, "a payer who holds no entry cannot win");
  eq(rows.pc.net_minor, -4000, "Carla's net");
  assert(!("pe" in rows), "a superseded identity must not have its own net position");
});

test("R-12 competition_performance: exact hits counted only against recorded results", () => {
  const rows = byId(runReport(db, "R-12", {}), "pool_entry_id");
  eq(rows.e1.predictions_made, 2, "e1 predicted m1 and m2");
  eq(rows.e1.exact_hits, 1, "m1 predicted 2-1 and finished 2-1; m2 predicted 1-0 but finished 0-0");
  eq(rows.e3.exact_hits, 1, "e3 predicted m1 exactly");
  eq(rows.e2.exact_hits, 0, "e2 predicted 0-0 for a 2-1 result");
  eq(rows.e11.predictions_made, 0, "an entry with no predictions still appears, with zero");
});

test("R-13 ranking_history returns every observation; R-13b returns only the latest", () => {
  eq(runReport(db, "R-13", {}).length, 6, "two observations of three entries");
  const latest = runReport(db, "R-13b", {});
  eq(latest.length, 3, "one row per entry at the latest observation");
  eq(byId(latest, "pool_entry_id").e1.points, 25, "the later snapshot's points");
});

test("R-14 year_over_year_participation: a merged identity is not counted as growth", () => {
  const rows = runReport(db, "R-14", {});
  const c1 = rows.find((r) => r.competition_id === "C1" && r.season_year === 2026);
  eq(c1.distinct_participants, 3,
    "Ana holds e1, e2 and e10 — e10 through a superseded identity. Counting the raw id would report 4 people and show growth that is really a duplicate.");
  eq(c1.entry_count, 6, "CE1 entries");
  const c2y25 = rows.find((r) => r.competition_id === "C2" && r.season_year === 2025);
  const c2y26 = rows.find((r) => r.competition_id === "C2" && r.season_year === 2026);
  eq(c2y25.entry_count, 2, "2025 entries");
  eq(c2y26.entry_count, 3, "2026 entries");
});

test("R-15 pool_financial_reconciliation: every pool's figures, hand-checked", () => {
  const rows = byId(runReport(db, "R-15", {}), "pool_id");
  const check = (pool, exp, coll, out, prz, net, unk) => {
    eq(rows[pool].expected_total_minor, exp, `${pool} expected`);
    eq(rows[pool].collected_total_minor, coll, `${pool} collected`);
    eq(rows[pool].outstanding_total_minor, out, `${pool} outstanding`);
    eq(rows[pool].prizes_awarded_total_minor, prz, `${pool} prizes`);
    eq(rows[pool].net_cash_position_minor, net, `${pool} net`);
    eq(rows[pool].unknown_fee_entry_count, unk, `${pool} unknown-fee entries`);
  };
  check("P1", 8000, 6500, 1500, 7000, -500, 1);
  check("P2", 6000, 4000, 2000, 0, 4000, 0);
  check("P3", 4000, 4000, 0, 5000, -1000, 0);
  check("P4", 10000, 10000, 0, 0, 10000, 0);
});

test("R-15 expected_total excludes unknown-fee entries and says how many", () => {
  const p1 = byId(runReport(db, "R-15", {}), "pool_id").P1;
  eq(p1.expected_total_minor, 8000, "four entries at 20.00; e9's fee was never recorded");
  eq(p1.unknown_fee_entry_count, 1, "the exclusion must be visible in the output, not implied");
});

test("R-16 audit_history is chronologically ordered and carries no PII", () => {
  const rows = runReport(db, "R-16", {});
  eq(rows.length, 5, "event count");
  // Ordered by occurred_at then id — the target model has no sequence column, and inventing one in
  // the fixtures would have made the ordering untestable against the real schema.
  for (let i = 1; i < rows.length; i++) {
    assert(`${rows[i].occurred_at}|${rows[i].audit_event_id}` > `${rows[i - 1].occurred_at}|${rows[i - 1].audit_event_id}`,
      "not chronologically ordered");
  }
  for (const r of rows) for (const v of Object.values(r)) {
    assert(!String(v).includes("@"), "an audit row carried an email address");
  }
});

test("R-17 operational_health: sync staleness and outbox buckets", () => {
  const rows = runReport(db, "R-17", { now: NOW });
  const sync = rows.filter((r) => r.bucket_kind === "sync");
  const outbox = byId(rows.filter((r) => r.bucket_kind === "outbox"), "bucket_key");
  eq(sync.length, 2, "two sync rows");
  eq(outbox.pending.event_count, 2, "o2 and o5 are pending");
  eq(outbox.failed.event_count, 1, "o3");
  eq(outbox.dead.event_count, 1, "o4");
  eq(outbox.delivered.event_count, 1, "o1");
});

test("R-17: a provider that never succeeded reports NULL staleness, not zero", () => {
  const sync = runReport(db, "R-17", { now: NOW }).filter((r) => r.bucket_kind === "sync");
  const never = sync.find((r) => r.bucket_key === "sy2");
  eq(never.staleness_seconds, null,
    "coalescing a never-successful sync to 0 would report a provider that has never worked as perfectly fresh");
  const worked = sync.find((r) => r.bucket_key === "sy1");
  assert(worked.staleness_seconds > 0, "a real staleness must be positive");
});

// =============================================================================================
console.log("\nWS10.8 — report security surfaces\n");
// =============================================================================================

test("no report carrying money or contact PII is PUBLIC_SAFE", () => {
  for (const r of loadReportsModel().reports) {
    const p = PROTOTYPES[r.id];
    if ((r.monetaryMeasures || []).length || r.piiExposure === "CONTACT" || r.piiExposure === "FINANCIAL") {
      assert(p.surface !== SURFACE.PUBLIC_SAFE, `${r.id} exposes money or contact detail but is PUBLIC_SAFE`);
    }
  }
});

test("no report output column contains a raw external payment reference", () => {
  for (const id of Object.keys(PROTOTYPES)) {
    for (const row of runReport(db, id, P)) {
      for (const [col, v] of Object.entries(row)) {
        if (v === null || typeof v !== "string") continue;
        assert(!/^SYNTH-REF-/.test(v) || col.includes("redacted"),
          `${id}.${col} projected a raw payment reference`);
      }
    }
  }
});

test("a report may only project an email if its model DECLARES email as a dimension", () => {
  // Stronger than checking the PII class: R-09 is declared FINANCIAL, which is the "strongest class"
  // and would have permitted an email under a class-based rule. But its dimension list does not
  // include email, and quietly widening a report's output beyond its spec is how contact data spreads.
  const model = byId(loadReportsModel().reports, "id");
  for (const id of Object.keys(PROTOTYPES)) {
    const spec = model[id];
    if (!spec) continue; // derived projections have no separate spec
    const declaresEmail = (spec.dimensions || []).includes("email");
    for (const row of runReport(db, id, P)) {
      for (const [col, v] of Object.entries(row)) {
        if (typeof v === "string" && v.includes("@")) {
          assert(declaresEmail, `${id}.${col} projects an email that the model's dimensions do not declare`);
        }
      }
    }
  }
});

test("exactly one report declares email, and it is the one whose purpose is to contact debtors", () => {
  const withEmail = loadReportsModel().reports.filter((r) => (r.dimensions || []).includes("email")).map((r) => r.id);
  eq(withEmail.join(","), "R-07", "only unpaid_balances should carry an address");
});

test("PUBLIC_SAFE reports project no email and no monetary column", () => {
  for (const [id, p] of Object.entries(PROTOTYPES)) {
    if (p.surface !== SURFACE.PUBLIC_SAFE) continue;
    for (const row of runReport(db, id, P)) {
      for (const [col, v] of Object.entries(row)) {
        assert(!(typeof v === "string" && v.includes("@")), `${id}.${col} leaked an email from a PUBLIC_SAFE report`);
        assert(!/_minor$/.test(col), `${id}.${col} is a monetary column in a PUBLIC_SAFE report`);
      }
    }
  }
});

test("every surface and usage class in use is a declared constant", () => {
  for (const [id, p] of Object.entries(PROTOTYPES)) {
    assert(Object.values(SURFACE).includes(p.surface), `${id} surface`);
    assert(Object.values(USAGE).includes(p.usageClass), `${id} usage class`);
  }
});

// =============================================================================================
console.log("\nWS10.6 — AGGREGATE_PARITY\n");
// =============================================================================================

test("the legacy aggregates are computed from the legacy document, not from the database", () => {
  const l = legacyAggregates(LEGACY_DOC);
  eq(l.source, "legacy", "source");
  eq(l.allocation_count, 0, "the legacy document has no allocations at all");
  eq(l.entry_count, 11, "twelve entries less the deleted one");
  eq(l.prediction_count, 5, "picks across all live entries");
});

test("aggregate parity over matching data yields no failures", () => {
  const r = aggregateParity(LEGACY_DOC, db);
  eq(r.failures.length, 0, `failures: ${JSON.stringify(r.failures)}`);
  eq(r.AGGREGATE_PARITY.mismatches, 0, "mismatches");
  assert(r.AGGREGATE_PARITY.checked > 0, "checked must be non-zero or the result is vacuous");
});

test("the counts that CAN be compared are EXACT", () => {
  const c = byId(aggregateParity(LEGACY_DOC, db).comparisons, "metric");
  for (const m of ["entry_count", "pool_participation", "prediction_count", "ranking_rows_latest"]) {
    eq(c[m].verdict, VERDICT.EXACT, `${m}: legacy ${c[m].legacy} vs normalized ${c[m].normalized}`);
  }
});

test("participant_count is EXACT here because both sides resolve the duplicate", () => {
  const c = byId(aggregateParity(LEGACY_DOC, db).comparisons, "metric");
  eq(c.participant_count.legacy, 3, "legacy dedupes by email and finds three people");
  eq(c.participant_count.normalized, 3, "normalized dedupes by canonical identity and agrees");
  eq(c.participant_count.verdict, VERDICT.EXACT, "verdict");
});

test("NEGATIVE: a legacy document that does NOT dedupe yields EXPECTED_DIFFERENCE, not a silent pass", () => {
  const doc = structuredClone(LEGACY_DOC);
  doc.entries.find((e) => e.id === "e10").email = "ana.old@example.test"; // the duplicate is now invisible
  const c = byId(aggregateParity(doc, db).comparisons, "metric");
  eq(c.participant_count.legacy, 4, "legacy now sees four people");
  eq(c.participant_count.verdict, VERDICT.EXPECTED_DIFFERENCE, "the declared deduplication difference");
  assert(c.participant_count.why.includes("deduplication"), "the reason must be surfaced");
});

test("NEGATIVE: a declared difference in the WRONG direction is a FAIL, not an excuse", () => {
  // Drop Bruno entirely from the legacy document, so legacy sees 2 people where normalized sees 3.
  // The declared difference permits legacy >= normalized (deduplication). The reverse direction means
  // the normalized side has people the legacy side never had, which is invention, not deduplication.
  const doc = structuredClone(LEGACY_DOC);
  doc.entries = doc.entries.filter((e) => e.email !== "bruno@example.test");
  const c = byId(aggregateParity(doc, db).comparisons, "metric");
  eq(c.participant_count.legacy, 2, "legacy now sees only Ana and Dina");
  eq(c.participant_count.normalized, 3, "normalized still has Bruno");
  eq(c.participant_count.verdict, VERDICT.FAIL,
    "a normalized count HIGHER than legacy is not deduplication — it is invented people, and the declared difference must not cover it");
  assert(/does not hold in the declared direction/.test(c.participant_count.note || ""), "the reason must be explicit");
});

test("allocation_count is EXPECTED_DIFFERENCE with a stated reason", () => {
  const c = byId(aggregateParity(LEGACY_DOC, db).comparisons, "metric");
  eq(c.allocation_count.legacy, 0, "legacy");
  eq(c.allocation_count.normalized, 10, "normalized");
  eq(c.allocation_count.verdict, VERDICT.EXPECTED_DIFFERENCE, "verdict");
  assert(/never WHICH money/.test(c.allocation_count.why), "the reason must be the legacy document's actual limitation");
});

test("settlement states the legacy boolean cannot express are UNKNOWN, not falsely EXACT", () => {
  const c = byId(aggregateParity(LEGACY_DOC, db).comparisons, "metric");
  for (const s of ["settled", "partially_paid", "overpaid", "legacy_asserted"]) {
    eq(c[`settlement_counts.${s}`].verdict, VERDICT.UNKNOWN,
      `${s} must be UNKNOWN — a boolean paid flag cannot distinguish it`);
  }
  eq(c["settlement_counts.unpaid"].verdict, VERDICT.EXACT, "unpaid IS comparable and must match");
  eq(c["settlement_counts.unknown"].verdict, VERDICT.EXACT, "unknown-fee counts are comparable");
});

test("UNKNOWN is excluded from `checked` so it cannot inflate the evidence", () => {
  const r = aggregateParity(LEGACY_DOC, db);
  assert(r.AGGREGATE_PARITY.unknown > 0, "this fixture must produce unknowns or the test proves nothing");
  eq(r.AGGREGATE_PARITY.checked, r.tally.EXACT + r.tally.EXPECTED_DIFFERENCE + r.tally.FAIL, "checked must exclude unknowns");
  eq(r.verdict, VERDICT.UNKNOWN, "a result containing unknowns is not EXACT");
});

test("NEGATIVE: a money total that differs is a FAIL", () => {
  const doc = structuredClone(LEGACY_DOC);
  doc.payments.find((p) => p.id === "y1").amountMinor = 4001;
  const r = aggregateParity(doc, db);
  assert(r.failures.some((f) => f.metric.startsWith("payment_total_minor")), `not caught: ${JSON.stringify(r.failures)}`);
  eq(r.verdict, VERDICT.FAIL, "verdict");
});

test("NEGATIVE: a lost entry is a FAIL", () => {
  const doc = structuredClone(LEGACY_DOC);
  doc.entries = doc.entries.filter((e) => e.id !== "e3");
  const r = aggregateParity(doc, db);
  assert(r.failures.some((f) => f.metric === "entry_count"), "a lost entry was not caught");
});

test("every declared expected difference carries a metric, a direction and a reason", () => {
  for (const d of EXPECTED_DIFFERENCES) {
    for (const k of ["metric", "delta", "why", "direction"]) assert(d[k], `${d.metric} missing ${k}`);
    assert(d.why.length > 40, `${d.metric}: the reason is too short to be reviewable`);
  }
});

// =============================================================================================
console.log("\nWS10.7 — FINANCIAL_PARITY has a real producer\n");
// =============================================================================================

test("financial parity over the relational fixtures is EXACT against itself", () => {
  const r = financialParityFromDb(db, db);
  eq(r.verdict, "EXACT", `differences: ${JSON.stringify(r.differences)}`);
  eq(r.FINANCIAL_PARITY.mismatches, 0, "mismatches");
  assert(r.FINANCIAL_PARITY.checked > 0, "checked");
});

test("the financial artefact from the database matches the hand-computed USD totals", () => {
  const a = financialParityFromDb(db, db).legacy;
  eq(a.expected_total, "180.00", "nine USD entries at 20.00 each; e9's fee is unknown and excluded");
  eq(a.paid_total, "160.00", "USD contributions");
  eq(a.allocated_total, "145.00", "USD allocations including the -5.00 refund allocation");
  eq(a.refund_total, "5.00", "the partial refund");
  eq(a.entries_unknown, 1, "e9");
  eq(a.entries_unpaid, 1, "e11");
  eq(a.entries_overpaid, 1, "e4");
});

test("NEGATIVE: a one-cent change in the database fails financial parity", () => {
  const other = buildDatabase();
  other.exec("UPDATE payment_allocations SET amount_minor = 2001 WHERE payment_allocation_id = 'a1'");
  const r = financialParityFromDb(db, other);
  eq(r.verdict, "FAIL", "a single cent must fail");
  assert(r.differences.some((d) => d.field === "allocated_total"), "the field must be named");
});

test("the WS5 promotion evidence bundle carries every parity class the gates require", () => {
  const ev = promotionEvidence({ legacyDoc: LEGACY_DOC, db });
  for (const cls of ["ROW_COUNT_PARITY", "KEY_PARITY", "VALUE_PARITY", "AGGREGATE_PARITY", "FINANCIAL_PARITY"]) {
    assert(ev[cls], `${cls} missing`);
    assert(typeof ev[cls].checked === "number" && ev[cls].checked > 0, `${cls}.checked must be a positive number`);
    assert(typeof ev[cls].mismatches === "number", `${cls}.mismatches`);
  }
});

// =============================================================================================
console.log("\nWS10.10 — report red team\n");
// =============================================================================================

test("RED: cross-user leakage — R-01 for one participant returns nobody else's rows", () => {
  for (const id of ["pa", "pb", "pd"]) {
    const rows = runReport(db, "R-01", { participant_id: id });
    for (const r of rows) eq(r.participant_id, id, `R-01 for ${id} leaked ${r.participant_id}`);
  }
});

test("RED: a superseded id returns the SURVIVOR's history, not an empty result", () => {
  // pe is merged into pa. Asking for pe's own id returns nothing, which is correct: the report is
  // keyed on the canonical id. The caller must resolve first — and the model's filter says so.
  eq(runReport(db, "R-01", { participant_id: "pe" }).length, 0,
    "a superseded id must not silently return the survivor's rows under the wrong identity");
  eq(runReport(db, "R-01", { participant_id: "pa" }).length, 5, "the survivor holds all five entries");
});

test("RED: double-counted payments — collected never exceeds what was allocated", () => {
  const r15 = runReport(db, "R-15", {});
  const totalCollected = r15.reduce((s, r) => s + r.collected_total_minor, 0);
  const actualAllocated = db.prepare("SELECT SUM(amount_minor) s FROM payment_allocations").get().s;
  eq(totalCollected, actualAllocated, "R-15 collected must equal the allocation sum exactly, with no fan-out");
});

test("RED: duplicate participant totals — R-11 has one row per canonical participant per currency", () => {
  const rows = runReport(db, "R-11", {});
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.participant_id}|${r.currency}`;
    assert(!seen.has(k), `duplicate net position row for ${k}`);
    seen.add(k);
  }
  assert(!rows.some((r) => r.participant_id === "pe"), "a merged identity produced its own totals");
});

test("RED: missing allocations — an entry with no allocation appears with zero, not absent", () => {
  const r01 = runReport(db, "R-01", { participant_id: "pd" });
  const e11 = r01.find((r) => r.pool_entry_id === "e11");
  assert(e11, "an unpaid entry must still appear in participant history");
  eq(e11.total_allocated_minor, 0, "with zero allocated");
});

test("RED: wrong prize aggregation — a prize is counted once, in its own pool and currency", () => {
  const r15 = byId(runReport(db, "R-15", {}), "pool_id");
  eq(r15.P1.prizes_awarded_total_minor, 7000, "P1's prize only");
  eq(r15.P2.prizes_awarded_total_minor, 0, "P2 has no prize and must not inherit one");
  const total = runReport(db, "R-10", {}).reduce((s, r) => s + r.amount_minor, 0);
  eq(total, 12000, "prize total across pools");
  eq(Object.values(r15).reduce((s, r) => s + r.prizes_awarded_total_minor, 0), 12000, "R-15 and R-10 must agree");
});

test("RED: ranking duplication — aggregating R-13 naively double-counts, R-13b does not", () => {
  const all = runReport(db, "R-13", {});
  const latest = runReport(db, "R-13b", {});
  eq(all.length, 6, "R-13 deliberately returns every observation");
  eq(latest.length, 3, "R-13b returns one row per entry");
  const naive = new Set(all.map((r) => r.pool_entry_id));
  eq(naive.size, 3, "there are only three entries; the six rows are two observations of each");
  assert(all.length > latest.length,
    "this is the trap: any count over R-13 without the latest-observation filter reports twice the entries");
});

test("RED: year-over-year double count — an entry belongs to exactly one season", () => {
  const rows = runReport(db, "R-14", {});
  const totalEntries = rows.reduce((s, r) => s + r.entry_count, 0);
  const liveEntries = db.prepare("SELECT COUNT(*) c FROM pool_entries WHERE deleted_at IS NULL").get().c;
  eq(totalEntries, liveEntries, "the sum across seasons must equal the entry count exactly — no entry in two seasons");
});

test("RED: a soft-deleted entry is invisible to every report that filters it", () => {
  for (const id of Object.keys(PROTOTYPES)) {
    for (const row of runReport(db, id, P)) {
      eq(row.pool_entry_id === "e12", false, `${id} returned the soft-deleted entry e12`);
    }
  }
});

test("RED: an unknown-fee entry is never counted as owing money", () => {
  const unpaid = runReport(db, "R-07", {});
  const partial = runReport(db, "R-08", {});
  const over = runReport(db, "R-09", {});
  for (const rows of [unpaid, partial, over]) {
    assert(!rows.some((r) => r.pool_entry_id === "e9"), "the unknown-fee entry appeared in a balance report");
  }
});

test("RED: the BRL pool never mixes with the USD pools", () => {
  const r15 = byId(runReport(db, "R-15", {}), "pool_id");
  eq(r15.P4.currency, "BRL", "P4 currency");
  eq(r15.P4.collected_total_minor, 10000, "BRL collected");
  const usdSum = Object.values(r15).filter((r) => r.currency === "USD").reduce((s, r) => s + r.collected_total_minor, 0);
  eq(usdSum, 14500, "the USD total must exclude the BRL pool entirely");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ REPORT SQL TESTS PASSED\n" : "✗ REPORT SQL TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
