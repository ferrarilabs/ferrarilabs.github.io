#!/usr/bin/env node
/**
 * Property-based / generative invariant tests (Workstream 2).
 *
 * A unit test asserts one case. A property test asserts a LAW over many generated cases, which is how you
 * find the input nobody thought of. The two identity bugs this programme just fixed were both of that kind:
 * an asymmetric alias comparison and a timestamp tie, neither reachable from a hand-picked fixture.
 *
 * DETERMINISM: every case derives from an explicit integer seed. Only seeds are persisted — never generated
 * data — so a failure is reported as "property X failed at seed N", which is reproducible in one command
 * and costs nothing to store.
 *
 * FAILURE REPORTING: on failure the seed is printed, plus the smallest description of the counterexample
 * that does not dump the whole dataset. A property test that prints 100 000 rows is one nobody reads.
 */

import {
  parseMoney, money, add, sub, cmp, sum, splitByShares,
  settlementStatus, unappliedBalance, SETTLEMENT,
} from "./financial.mjs";
import { generate, rng } from "./synthetic_dataset.mjs";
import { runRules } from "./data_quality.mjs";
import { resolveCanonical, mergeIdentities, reverseMerge, findDuplicateCandidates, repointAfterMerge } from "./identity.mjs";
import { transition, createEvent, STATUS, TRANSITIONS, MAX_ATTEMPTS, backoffSeconds, IllegalTransition } from "./outbox.mjs";
import { appendToChain, verifyChain, chainCheckpoint, verifyChainAgainstCheckpoint } from "./audit.mjs";
import { assembleRanking, TIE_CASCADES, inputParity, canonicalPicksFromJson, canonicalPicksFromPredictions } from "./scoring_parity.mjs";
import { decompose, roundTrip } from "./json_parity.mjs";

const USD = "USD";
let pass = 0, fail = 0;

/**
 * Run a property over `n` seeds. The property returns nothing on success and throws with a short message
 * on failure; the runner adds the seed.
 */
function property(name, n, fn) {
  for (let seed = 1; seed <= n; seed++) {
    try { fn(seed); }
    catch (e) {
      console.log(`  ✗ ${name}\n      seed ${seed}: ${e.message}\n      reproduce: property "${name}" at seed ${seed}`);
      fail++;
      return;
    }
  }
  console.log(`  ✓ ${name}  (${n} seeds)`);
  pass++;
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/** Deterministic small-integer helper bound to a seed. */
const gen = (seed) => {
  const r = rng(seed);
  return {
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    minor: (lo, hi) => money(lo + Math.floor(r() * (hi - lo + 1)), USD),
    bool: () => r() > 0.5,
  };
};

console.log("\nFinancial laws\n");

property("addition is associative and commutative over minor units", 200, (seed) => {
  const g = gen(seed);
  const [a, b, c] = [g.minor(-5000, 5000), g.minor(-5000, 5000), g.minor(-5000, 5000)];
  eq(add(add(a, b), c).minor, add(a, add(b, c)).minor, "associativity");
  eq(add(a, b).minor, add(b, a).minor, "commutativity");
});

property("sub is the inverse of add", 200, (seed) => {
  const g = gen(seed);
  const [a, b] = [g.minor(-9999, 9999), g.minor(-9999, 9999)];
  eq(sub(add(a, b), b).minor, a.minor, "a + b - b === a");
});

property("sum equals repeated add, and is order-independent", 150, (seed) => {
  const g = gen(seed);
  const xs = Array.from({ length: g.int(0, 25) }, () => g.minor(-500, 500));
  const viaSum = sum(xs, USD).minor;
  const viaReduce = xs.reduce((acc, x) => acc + x.minor, 0);
  eq(viaSum, viaReduce, "sum matches integer accumulation");
  const shuffled = [...xs].reverse();
  eq(sum(shuffled, USD).minor, viaSum, "order-independent");
});

property("splitByShares never loses or invents a unit, for any total and any share set", 300, (seed) => {
  const g = gen(seed);
  const total = g.minor(0, 1_000_000);
  // Build a share set summing to exactly 100000 milli.
  const k = g.int(1, 5);
  const cuts = Array.from({ length: k - 1 }, () => g.int(1, 99999)).sort((x, y) => x - y);
  const weights = [];
  let prev = 0;
  for (const c of cuts) { weights.push(c - prev); prev = c; }
  weights.push(100000 - prev);
  if (weights.some((w) => w <= 0)) return;                 // degenerate draw; skip
  const shares = weights.map((w, i) => ({ key: `k${i}`, weightMilli: w }));
  const parts = splitByShares(total, shares);
  eq(sum(parts.map((p) => p.amount), USD).minor, total.minor, `parts must sum to the whole (${total.minor})`);
  assert(parts.every((p) => p.amount.minor >= 0), "no negative part from a non-negative total");
});

property("splitByShares is deterministic — same input, same output", 100, (seed) => {
  const g = gen(seed);
  const total = g.minor(1, 100000);
  const shares = [{ key: "a", weightMilli: 70000 }, { key: "b", weightMilli: 20000 }, { key: "c", weightMilli: 10000 }];
  eq(JSON.stringify(splitByShares(total, shares)), JSON.stringify(splitByShares(total, shares)), "deterministic");
});

console.log("\nSettlement laws\n");

property("settlement is a total function of (expected, allocated, legacy) with no gaps", 400, (seed) => {
  const g = gen(seed);
  const expected = g.minor(1, 5000);
  const allocated = g.minor(0, 10000);
  const legacy = g.bool();
  const s = settlementStatus({ expected, allocated, legacyAsserted: legacy });
  assert(Object.values(SETTLEMENT).includes(s), `unknown settlement state ${s}`);
  if (legacy) { eq(s, SETTLEMENT.LEGACY_ASSERTED, "legacy dominates"); return; }
  if (allocated.minor === 0) eq(s, SETTLEMENT.UNPAID, "zero allocated");
  else if (allocated.minor < expected.minor) eq(s, SETTLEMENT.PARTIALLY_PAID, "under");
  else if (allocated.minor === expected.minor) eq(s, SETTLEMENT.SETTLED, "exact");
  else eq(s, SETTLEMENT.OVERPAID, "over");
});

property("settlement is monotonic in allocated: more money never moves you backwards", 200, (seed) => {
  const g = gen(seed);
  const expected = g.minor(100, 5000);
  const order = [SETTLEMENT.UNPAID, SETTLEMENT.PARTIALLY_PAID, SETTLEMENT.SETTLED, SETTLEMENT.OVERPAID];
  let prevRank = -1;
  for (const alloc of [0, 1, expected.minor - 1, expected.minor, expected.minor + 1]) {
    const s = settlementStatus({ expected, allocated: money(alloc, USD) });
    const rank = order.indexOf(s);
    assert(rank >= prevRank, `allocated=${alloc} moved settlement backwards to ${s}`);
    prevRank = rank;
  }
});

property("unapplied balance + allocated always equals the payment amount", 300, (seed) => {
  const g = gen(seed);
  const amount = g.minor(0, 50000);
  const allocs = Array.from({ length: g.int(0, 8) }, () => ({ amount: g.minor(0, 12000) }));
  const u = unappliedBalance({ amount }, allocs);
  const allocated = sum(allocs.map((a) => a.amount), USD);
  eq(add(u, allocated).minor, amount.minor, "unapplied + allocated must reconstruct the payment exactly");
});

property("a legacy_asserted payment has no balance, ever", 100, (seed) => {
  const g = gen(seed);
  const allocs = Array.from({ length: g.int(0, 4) }, () => ({ amount: g.minor(1, 1000) }));
  eq(unappliedBalance({ amount: null }, allocs), null, "null amount ⇒ null balance, never zero");
});

console.log("\nIdentity graph laws\n");

property("the identity graph is acyclic and every participant resolves", 120, (seed) => {
  const g = gen(seed);
  const n = g.int(3, 12);
  let state = {
    participants: Array.from({ length: n }, (_, i) => ({
      participant_id: `p-${i}`, display_name: `Synthetic ${i}`, email: `s${i}@example.invalid`,
      aliases: [], canonical_participant_id: null, superseded_at: null,
    })),
    participant_identity_links: [],
  };
  const OP = { operatorId: "op", reason: "property test" };
  let linkN = 0;
  // Apply a random sequence of merges; every refusal is legitimate and simply skipped.
  for (let k = 0; k < g.int(1, n); k++) {
    const a = `p-${g.int(0, n - 1)}`, b = `p-${g.int(0, n - 1)}`;
    try { state = mergeIdentities(state, { survivingId: a, mergedId: b, confirmation: OP, at: `2026-07-0${(k % 9) + 1}T00:00:00Z`, linkId: `l-${++linkN}` }); }
    catch { /* refused: self-merge, already merged, superseded survivor, or cycle — all correct */ }
  }
  // Every participant must resolve without throwing, which is only possible if the graph is acyclic.
  for (const p of state.participants) {
    const r = resolveCanonical(state.participants, p.participant_id);
    assert(r.hops <= state.participants.length, `resolution took ${r.hops} hops`);
    const canonical = state.participants.find((x) => x.participant_id === r.participant_id);
    eq(canonical.canonical_participant_id, null, "a resolved identity must itself be canonical");
  }
});

property("a merge followed by its reversal restores the prior canonical mapping exactly", 120, (seed) => {
  const g = gen(seed);
  const n = g.int(2, 8);
  const base = {
    participants: Array.from({ length: n }, (_, i) => ({
      participant_id: `p-${i}`, display_name: `Synthetic ${i}`, email: `s${i}@example.invalid`,
      aliases: i % 3 === 0 ? [`Alias ${i}`] : [], canonical_participant_id: null, superseded_at: null,
    })),
    participant_identity_links: [],
  };
  const OP = { operatorId: "op", reason: "property test" };
  const a = `p-${g.int(0, n - 1)}`, b = `p-${g.int(0, n - 1)}`;
  if (a === b) return;
  const before = JSON.stringify(base.participants);
  let merged;
  try { merged = mergeIdentities(base, { survivingId: a, mergedId: b, confirmation: OP, at: "2026-07-01T00:00:00Z", linkId: "l-1" }); }
  catch { return; }
  const back = reverseMerge(merged, { linkId: "l-1", confirmation: OP, at: "2026-07-02T00:00:00Z" });
  eq(JSON.stringify(back.participants), before, "reversal must restore the participant rows byte-for-byte");
  eq(back.participant_identity_links.length, 1, "the link is retained as history");
  assert(back.participant_identity_links[0].reversed_at, "and marked reversed");
});

property("candidate detection never proposes a pair involving a superseded identity", 100, (seed) => {
  const g = gen(seed);
  const n = g.int(4, 14);
  const participants = Array.from({ length: n }, (_, i) => ({
    participant_id: `p-${i}`, display_name: `Synthetic ${i % 4}`,
    email: i % 3 === 0 ? "shared@example.invalid" : `s${i}@example.invalid`,
    aliases: [], canonical_participant_id: g.bool() && i > 0 ? "p-0" : null,
  }));
  const superseded = new Set(participants.filter((p) => p.canonical_participant_id).map((p) => p.participant_id));
  for (const c of findDuplicateCandidates(participants)) {
    assert(!superseded.has(c.a) && !superseded.has(c.b),
      `candidate ${c.a}/${c.b} involves a superseded identity — a resolved pair must not return to the queue`);
    assert(c.autoMergeable === false, "every candidate must carry the auto-merge prohibition");
  }
});

property("re-pointing after a merge never moves a published snapshot or an audit row", 100, (seed) => {
  const g = gen(seed);
  const merged = `p-${g.int(1, 5)}`, surviving = `p-0`;
  const d = repointAfterMerge({
    pool_entries: [{ pool_entry_id: "e-1", participant_id: merged }],
    payments: [{ payment_id: "pay-1", payer_participant_id: merged }],
    prize_allocations: [{ prize_allocation_id: "z-1", participant_id: merged }],
    ranking_snapshots: [{ ranking_snapshot_id: "rs-1", participant_id: merged }],
    audit_events: [{ audit_event_id: "a-1", actor_participant_id: merged }],
  }, { survivingId: surviving, mergedId: merged });
  eq(d.pool_entries[0].participant_id, surviving, "entries follow");
  eq(d.payments[0].payer_participant_id, surviving, "payments follow");
  eq(d.prize_allocations[0].participant_id, surviving, "prizes follow");
  eq(d.ranking_snapshots[0].participant_id, merged, "a published standing must never be rewritten");
  eq(d.audit_events[0].actor_participant_id, merged, "audit rows are immutable");
});

console.log("\nOutbox state-machine laws\n");

property("no random action sequence ever reaches an illegal state", 250, (seed) => {
  const g = gen(seed);
  let e = createEvent({ id: "o-1", channel: "email", eventType: "receipt", idempotencyKey: "k-1", at: "2026-08-01T00:00:00Z" });
  const actions = ["lease", "success", "transient_failure", "permanent_failure", "lease_expired", "poison", "replay"];
  const valid = new Set(Object.values(STATUS));
  for (let k = 0; k < g.int(1, 25); k++) {
    const action = g.pick(actions);
    try {
      e = transition(e, action, { at: `2026-08-0${(k % 9) + 1}T00:00:00Z`, worker: "w", reason: "property test" });
      assert(valid.has(e.status), `reached invalid status ${e.status}`);
      assert(e.attempt_count >= 0, "negative attempt count");
      if (e.status === STATUS.DEAD) assert(e.dead_at, "dead without dead_at");
      if (e.status !== STATUS.IN_FLIGHT) assert(!e.lease_owner, "holds a lease while not in flight");
    } catch (err) {
      if (err instanceof IllegalTransition) continue;       // refusal is the correct outcome
      if (/requires a reason/.test(err.message)) continue;
      throw err;
    }
  }
});

property("a sent event is terminal under every action", 100, (seed) => {
  const g = gen(seed);
  let e = createEvent({ id: "o-1", channel: "email", eventType: "receipt", idempotencyKey: "k-1", at: "2026-08-01T00:00:00Z" });
  e = transition(e, "lease", { at: "2026-08-02T00:00:00Z", worker: "w" });
  e = transition(e, "success", { at: "2026-08-03T00:00:00Z" });
  for (const action of ["lease", "success", "transient_failure", "permanent_failure", "replay", "poison", "lease_expired"]) {
    let threw = false;
    try { transition(e, action, { at: "2026-08-04T00:00:00Z", reason: "r" }); } catch { threw = true; }
    assert(threw, `sent --${action}--> was permitted; a re-send is a duplicate email to a real person`);
  }
  assert(g.bool() || true, "seed consumed");
});

property("retries always terminate: attempt exhaustion reaches dead", 100, (seed) => {
  let e = createEvent({ id: "o-1", channel: "email", eventType: "receipt", idempotencyKey: "k-1", at: "2026-08-01T00:00:00Z" });
  for (let i = 0; i < MAX_ATTEMPTS + 3; i++) {
    if (e.status !== STATUS.PENDING) break;
    e = transition(e, "lease", { at: `2026-08-01T00:00:${String(i * 2).padStart(2, "0")}Z`, worker: "w" });
    if (e.status !== STATUS.IN_FLIGHT) break;
    e = transition(e, "transient_failure", { at: `2026-08-01T00:00:${String(i * 2 + 1).padStart(2, "0")}Z` });
  }
  eq(e.status, STATUS.DEAD, "an event that keeps failing must end dead, never loop forever");
  assert(seed > 0, "seed consumed");
});

property("backoff is monotonic non-decreasing and bounded", 60, (seed) => {
  let prev = -1;
  for (let n = 0; n <= 40; n++) {
    const b = backoffSeconds(n);
    assert(b >= prev, `backoff decreased at attempt ${n}`);
    assert(b <= 3600, `backoff exceeded the cap at attempt ${n}`);
    prev = b;
  }
  assert(seed > 0, "seed consumed");
});

console.log("\nAudit chain laws\n");

property("an appended chain always verifies, at any length", 80, (seed) => {
  const g = gen(seed);
  let chain = [];
  const n = g.int(1, 40);
  for (let i = 0; i < n; i++) {
    chain = appendToChain(chain, {
      id: `a-${i}`, occurredAt: new Date(Date.UTC(2026, 7, 1) + i * 1000).toISOString(),
      actorRole: "service", action: "entry_created", source: "edge_function",
      aggregateType: "pool_entry", aggregateId: `e-${i}`, safeMetadata: { i },
    });
  }
  const v = verifyChain(chain);
  assert(v.valid, `chain of ${n} failed: ${JSON.stringify(v)}`);
});

property("removing or reordering any single row breaks the chain", 60, (seed) => {
  const g = gen(seed);
  let chain = [];
  const n = g.int(3, 15);
  for (let i = 0; i < n; i++) {
    chain = appendToChain(chain, {
      id: `a-${i}`, occurredAt: new Date(Date.UTC(2026, 7, 1) + i * 1000).toISOString(),
      actorRole: "service", action: "entry_created", source: "edge_function",
      aggregateType: "pool_entry", aggregateId: `e-${i}`, safeMetadata: { i },
    });
  }
  // INTERIOR removal only. Tail truncation is a separate, genuinely undetectable case — see below.
  const drop = g.int(1, n - 2);
  assert(!verifyChain(chain.filter((_, i) => i !== drop)).valid, `removing interior row ${drop} was not detected`);
  const swapped = [...chain];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert(!verifyChain(swapped).valid, "reordering was not detected");
});

property("TAIL TRUNCATION is undetectable by chain verification alone — and a checkpoint fixes it", 60, (seed) => {
  /**
   * This property documents a real limitation rather than asserting a capability.
   *
   * A hash chain proves that what REMAINS is internally consistent. It says nothing about what used to
   * follow, so dropping the final k events leaves a perfectly valid chain. An earlier version of the
   * property above picked a random row including the last one and failed — correctly, because the claim
   * "removing any row is detected" was false.
   */
  const g = gen(seed);
  let chain = [];
  const n = g.int(4, 20);
  for (let i = 0; i < n; i++) {
    chain = appendToChain(chain, {
      id: `a-${i}`, occurredAt: new Date(Date.UTC(2026, 7, 1) + i * 1000).toISOString(),
      actorRole: "service", action: "entry_created", source: "edge_function",
      aggregateType: "pool_entry", aggregateId: `e-${i}`, safeMetadata: { i },
    });
  }
  const cp = chainCheckpoint(chain, { at: "2026-08-10T00:00:00Z" });
  const k = g.int(1, Math.max(1, n - 2));
  const truncated = chain.slice(0, n - k);

  assert(verifyChain(truncated).valid,
    "tail truncation must be reported as VALID by chain verification alone — pretending otherwise would hide the gap");

  const withCp = verifyChainAgainstCheckpoint(truncated, cp);
  assert(!withCp.valid, `a checkpoint must detect ${k} removed tail event(s)`);
  assert(/removed from the tail/.test(withCp.reason), "the finding must name what happened");

  // And the checkpoint must not raise a false alarm on an untruncated chain that has since grown.
  const grown = appendToChain(chain, {
    id: "a-new", occurredAt: "2026-08-11T00:00:00Z", actorRole: "service", action: "entry_created",
    source: "edge_function", aggregateType: "pool_entry", aggregateId: "e-new", safeMetadata: {},
  });
  const ok = verifyChainAgainstCheckpoint(grown, cp);
  assert(ok.valid && ok.checkpointVerified, "a chain that only grew must still verify against an older checkpoint");
  eq(ok.sinceCheckpoint, 1, "events added since the checkpoint are counted, not flagged");
});

console.log("\nRanking determinism\n");

property("ranking is a deterministic total order, independent of input order", 150, (seed) => {
  const g = gen(seed);
  const n = g.int(1, 30);
  const scored = Array.from({ length: n }, (_, i) => ({
    pool_entry_id: `e-${i}`,
    metrics: { total: g.int(0, 8), exact: g.int(0, 3), podium: g.int(0, 2) },
  }));
  const key = (rk) => rk.map((x) => `${x.pool_entry_id}:${x.position}`).join(",");
  const a = assembleRanking(scored, TIE_CASCADES.copa2026);
  const b = assembleRanking([...scored].reverse(), TIE_CASCADES.copa2026);
  const c = assembleRanking([...scored].sort((x, y) => x.pool_entry_id.localeCompare(y.pool_entry_id)), TIE_CASCADES.copa2026);
  eq(key(a), key(b), "reversing the input changed the ranking");
  eq(key(a), key(c), "re-sorting the input changed the ranking");
  // Positions must be non-decreasing down the list, and equal only for genuinely tied metric tuples.
  for (let i = 1; i < a.length; i++) {
    assert(a[i].position >= a[i - 1].position, "positions must not decrease");
    if (a[i].position === a[i - 1].position) {
      eq(JSON.stringify(a[i].metrics), JSON.stringify(a[i - 1].metrics), "shared position with different metrics");
    }
  }
});

console.log("\nJSON normalisation and migration-transform laws\n");

property("canonical picks are invariant under key order and integer/string form", 200, (seed) => {
  const g = gen(seed);
  const n = g.int(1, 12);
  const picks = {};
  for (let i = 0; i < n; i++) picks[`m-${g.int(1, 40)}`] = { h: g.int(0, 5), a: g.int(0, 5) };
  const asStrings = Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, { h: String(v.h), a: String(v.a) }]));
  const reordered = Object.fromEntries(Object.entries(picks).reverse());
  const base = JSON.stringify(canonicalPicksFromJson(picks));
  eq(JSON.stringify(canonicalPicksFromJson(asStrings)), base, "string goals must canonicalise identically");
  eq(JSON.stringify(canonicalPicksFromJson(reordered)), base, "key order must not matter");
});

property("picks and prediction rows describing the same thing always achieve input parity", 200, (seed) => {
  const g = gen(seed);
  const n = g.int(1, 15);
  const picks = {}, rows = [];
  for (let i = 0; i < n; i++) {
    const id = `m-${i}`;
    const missing = g.int(0, 5) === 0;
    picks[id] = missing ? null : { h: g.int(0, 4), a: g.int(0, 4) };
    rows.push(missing
      ? { match_id: id, home_goals: null, away_goals: null }
      : { match_id: id, home_goals: picks[id].h, away_goals: picks[id].a });
  }
  const r = inputParity(picks, [...rows].reverse());
  assert(r.identical, `parity failed: ${JSON.stringify(r.diffs.slice(0, 3))}`);
});

property("a missing pick is never equal to a zero-zero pick", 100, (seed) => {
  const g = gen(seed);
  const id = `m-${g.int(1, 9)}`;
  const r = inputParity({ [id]: null }, [{ match_id: id, home_goals: 0, away_goals: 0 }]);
  assert(!r.identical, "collapsing 'no pick' into 0-0 would change scores and must always be a difference");
});

property("decompose preserves entry count and id set for any generated document", 60, (seed) => {
  const g = gen(seed);
  const n = g.int(0, 20);
  const entries = Array.from({ length: n }, (_, i) => ({
    id: `en-${i}`, entryName: `Synthetic ${i}`, participantEmail: i % 4 === 0 ? null : `s${i}@example.invalid`,
    payerName: i % 5 === 0 ? `Synthetic ${i}` : undefined,
    paymentMethod: i % 5 === 0 ? "zelle" : undefined,
    picks: i % 3 === 0 ? null : { "m-1": { h: 1, a: 0 } },
    createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
  }));
  const deleted = entries.filter((_, i) => i % 7 === 0).map((e) => e.id);
  const paid = Object.fromEntries(entries.filter((_, i) => i % 5 === 0).map((e) => [e.id, true]));
  const state = { entries, deletedIds: deleted, paid, auditLog: [], results: {}, siteVersion: "1" };
  const d = decompose(state, { poolId: "pool-x", editionId: "ed-1", expectedFee: parseMoney("5.00", USD) });
  eq(d.pool_entries.length, n, "entry count must be preserved exactly");
  eq(JSON.stringify(d.pool_entries.map((e) => e.pool_entry_id).sort()),
     JSON.stringify(entries.map((e) => e.id).sort()), "entry id set must be preserved");
  eq(d.pool_entries.filter((e) => e.deleted_at).length, deleted.length, "tombstone count must be preserved");
  // Every asserted payment must have a NULL amount and no allocation — no money may be invented.
  for (const p of d.payments) {
    if (!p.legacy_asserted) continue;
    eq(p.amount, null, "a legacy assertion must never gain an amount");
  }
  eq(d.payment_allocations.length, 0, "no allocation may be fabricated from a paid flag");
});

property("round-trip differences are always confined to authorised keys", 60, (seed) => {
  const g = gen(seed);
  const n = g.int(1, 15);
  const entries = Array.from({ length: n }, (_, i) => ({
    id: `en-${i}`, entryName: `Synthetic ${i}`, participantEmail: `s${i}@example.invalid`,
    picks: { "m-1": { h: g.int(0, 3), a: g.int(0, 3) } },
    createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-02T00:00:00Z",
  }));
  const state = { entries, deletedIds: [], paid: {}, auditLog: [], results: {}, siteVersion: "1" };
  const d = decompose(state, { poolId: "pool-x", editionId: "ed-1", expectedFee: parseMoney("5.00", USD) });
  const r = roundTrip(state, d);
  assert(r.unauthorised.length === 0,
    `unauthorised round-trip difference(s): ${r.unauthorised.slice(0, 3).map((x) => `${x.kind} at ${x.path}`).join(", ")}`);
});

console.log("\nWhole-dataset invariants at generated scale\n");

property("a freshly generated dataset violates no data-quality rule except the intended duplicate candidate", 6, (seed) => {
  const d = generate({ scale: seed % 2 === 0 ? "A" : "B", seed });
  const results = runRules(d, { now: new Date(Date.UTC(2026, 1, 20)).toISOString() });
  const firing = results.filter((r) => r.status !== "PASS").map((r) => r.id);
  const allowed = new Set(["DQ-ID-01"]);   // duplicate CANDIDATES are generated on purpose
  const unexpected = firing.filter((id) => !allowed.has(id));
  eq(unexpected.length, 0, `unexpected rule(s) firing: ${unexpected.join(", ")}`);
});

property("generation is reproducible: the same seed yields an identical dataset", 8, (seed) => {
  const a = generate({ scale: "A", seed });
  const b = generate({ scale: "A", seed });
  eq(JSON.stringify(a), JSON.stringify(b), "same seed must produce byte-identical output");
});

property("different seeds yield different datasets", 6, (seed) => {
  const a = JSON.stringify(generate({ scale: "A", seed }));
  const b = JSON.stringify(generate({ scale: "A", seed: seed + 1000 }));
  assert(a !== b, "two different seeds produced identical data — the seed is not being used");
});

console.log(`\n  ${pass} properties passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ PROPERTY TESTS PASSED\n" : "✗ PROPERTY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
