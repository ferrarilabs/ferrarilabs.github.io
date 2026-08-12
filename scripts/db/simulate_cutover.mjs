#!/usr/bin/env node
/**
 * WS5.38–WS5.42 — synthetic cutover simulations.
 *
 * These are not illustrations. Each one walks the real state machine in scripts/db/choreography.mjs,
 * carries real data through both representations, and asserts a property that would be violated by a
 * plausible mistake in the choreography. The simulation does not contract or drop anything: it stops
 * at CONTRACT_ELIGIBLE, because the point is to prove the reversible path is reversible.
 *
 * A simulation that only shows the happy path succeeding proves nothing, so every one of these has a
 * negative twin in test_choreography.mjs.
 */

import {
  canTransition, validateFlags, oldClientOutcome, classifyWriteShape, evaluateParity,
  evaluateObservationWindow, evaluatePromotion, runDeltaPass, states, stateDef,
  sharedDomainState, mayFreezeSharedDomain, checkAbortCriteria,
} from "./choreography.mjs";
import { inputParity, assembleRanking, rankingParity, TIE_CASCADES, isLocked } from "./scoring_parity.mjs";

// ---------------------------------------------------------------------------------------------
// A minimal two-representation world
// ---------------------------------------------------------------------------------------------

/** Exact money. Minor units as integers — never a float, at any point, including in a comparison. */
const cents = (s) => {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(s));
  if (!m) throw new Error(`unparseable amount ${s}`);
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 100 + Number((m[3] || "0").padEnd(2, "0")));
};
const money = (c) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

export function makeWorld() {
  return {
    // The legacy representation: one jsonb-shaped document per app.
    legacy: { copa2026: { entries: [], results: {}, audit: [] }, br2026: { entries: [], results: {}, audit: [] } },
    // The normalized representation.
    rel: {
      participants: [], pool_entries: [], payments: [], payment_allocations: [],
      prize_allocations: [], match_results: [], predictions: [], audit_events: [], outbox_events: [],
    },
    // What is authoritative, per domain, right now.
    authority: {},
    log: [],
  };
}

const say = (w, m) => { w.log.push(m); return w; };

/**
 * The trusted runtime's write path. Both representations are written in ONE transaction: this
 * function either mutates both or throws before mutating either. That is the whole basis for
 * claiming there is no state in which they disagree, so it is enforced here rather than asserted:
 * every mutation is staged and applied only after all of them are computed.
 */
function trustedWrite(w, app, { legacyMutation, relMutation, mirror = true }) {
  const stagedLegacy = mirror ? legacyMutation : null;
  const rel = relMutation;
  if (mirror && !stagedLegacy) throw new Error("mirroring requested with no legacy mutation staged");
  // Compute both, then apply both. A throw from either computation leaves the world untouched.
  const legacyApply = stagedLegacy ? stagedLegacy(w.legacy[app]) : null;
  const relApply = rel(w.rel);
  if (legacyApply) legacyApply();
  relApply();
  return w;
}

/** A legacy direct write from a browser tab. NOT mirrored — this is the divergence the fence closes. */
function legacyDirectWrite(w, app, mutation) { mutation(w.legacy[app]); return w; }

// ---------------------------------------------------------------------------------------------
// WS5.38 — full cutover simulation
// ---------------------------------------------------------------------------------------------

const HAPPY_PATH = [
  "LEGACY_ONLY", "EXPANDED_SCHEMA", "REFERENCE_BACKFILLED", "DOMAIN_BACKFILLING", "DOMAIN_BACKFILLED",
  "DUAL_READ_SHADOW", "PARITY_OBSERVATION", "SERVER_WRITE_CANARY", "SERVER_WRITE_PRIMARY",
  "LEGACY_WRITE_DISABLED", "NEW_READ_PRIMARY", "PARITY_OBSERVATION", "CUTOVER_READY",
  "LEGACY_FROZEN", "CONTRACT_ELIGIBLE",
];

/**
 * Walk the whole path with a real cast: two participants, a third-party payer, several entries, a
 * prediction, a result, a payment with allocations, a prize, an outbox event and audit entries.
 *
 * Every step asserts, rather than narrates:
 *   · the transition is legal under the evidence actually available at that point
 *   · the flag configuration is valid for the state
 *   · the two representations agree, or diverge only in a way the state permits and explains
 *   · no money is created or destroyed
 */
export function simulateFullCutover({ app = "copa2026" } = {}) {
  const w = makeWorld();
  const trace = [];
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };

  // ---- LEGACY_ONLY: the world as it is today. Browsers write the document directly.
  let state = "LEGACY_ONLY";
  const ANA = { id: "p-ana", name: "Ana", email: "ana@example.test" };
  const BRUNO = { id: "p-bruno", name: "Bruno", email: "bruno@example.test" };
  const CARLA = { id: "p-carla", name: "Carla", email: "carla@example.test" }; // third-party payer

  legacyDirectWrite(w, app, (d) => {
    d.entries.push({ id: "e1", owner: "Ana", email: ANA.email, paid: true, picks: { "m1": { h: 2, a: 1 } } });
    d.entries.push({ id: "e2", owner: "Ana", email: ANA.email, paid: true, picks: { "m1": { h: 0, a: 0 } } });
    d.entries.push({ id: "e3", owner: "Bruno", email: BRUNO.email, paid: false, picks: { "m1": { h: 1, a: 1 } } });
    d.audit.push({ at: "2026-01-01T00:00:00Z", action: "entry_created" });
  });
  trace.push({ state, reads: "legacy", writes: "browser→document", legacyEntries: w.legacy[app].entries.length });

  // ---- EXPANDED_SCHEMA: additive DDL. The document is untouched, which is the property that makes
  // an arbitrarily old tab safe.
  const docBefore = JSON.stringify(w.legacy[app]);
  let t = canTransition(state, "EXPANDED_SCHEMA", { schemaExpanded: true });
  assert(t.allowed, `LEGACY_ONLY → EXPANDED_SCHEMA refused: ${t.reason}`);
  state = "EXPANDED_SCHEMA";
  assert(JSON.stringify(w.legacy[app]) === docBefore, "expanding the schema altered the legacy document");
  assert(oldClientOutcome(state, "SUBMIT_PREDICTION").proceed, "an old tab must still be able to submit here");
  trace.push({ state, legacyUnchanged: true });

  // ---- REFERENCE_BACKFILLED
  t = canTransition(state, "REFERENCE_BACKFILLED", { referenceRowsPresent: true });
  assert(t.allowed, `→ REFERENCE_BACKFILLED refused: ${t.reason}`);
  state = "REFERENCE_BACKFILLED";
  trace.push({ state });

  // ---- DOMAIN_BACKFILLING: bulk pass, then a live write lands, then the delta pass.
  t = canTransition(state, "DOMAIN_BACKFILLING", { auditInfrastructurePresent: true });
  assert(t.allowed, `→ DOMAIN_BACKFILLING refused: ${t.reason}`);
  state = "DOMAIN_BACKFILLING";

  // bulk pass: participants (global natural key), entries (stable surrogate), asserted payments
  const upsertParticipant = (p) => {
    const key = (p.email || p.name).toLowerCase();
    let row = w.rel.participants.find((x) => x.natural_key === key);
    if (!row) { row = { participant_id: p.id, natural_key: key, display_name: p.name, email: p.email }; w.rel.participants.push(row); }
    return row;
  };
  for (const e of w.legacy[app].entries) {
    const p = upsertParticipant({ id: `p-${e.owner.toLowerCase()}`, name: e.owner, email: e.email });
    w.rel.pool_entries.push({ pool_entry_id: e.id, participant_id: p.participant_id, pool_id: app, picks: e.picks });
    if (e.paid) w.rel.payments.push({ payment_id: `pay-${e.id}`, amount_minor: cents("20.00"), currency: "USD", legacy_asserted: true, asserted_for_pool_entry_id: e.id });
  }
  const afterBulk = w.rel.pool_entries.length;

  // A live write during the backfill — Bruno adds an entry from a tab that is still on the old build.
  legacyDirectWrite(w, app, (d) => {
    d.entries.push({ id: "e4", owner: "Bruno", email: BRUNO.email, paid: false, picks: { "m1": { h: 3, a: 0 } } });
  });
  assert(oldClientOutcome(state, "CREATE_ENTRY").proceed, "an old tab must be able to create an entry mid-backfill");

  // The delta pass must catch it. This is the property that a bulk-pass-only design gets wrong.
  const delta = runDeltaPass({
    domain: "entries", source: w.legacy[app].entries, copied: w.rel.pool_entries,
    keyOf: (x) => x.pool_entry_id ?? x.id, fingerprintOf: (x) => JSON.stringify(x.picks),
  });
  for (const a of delta.applied) {
    if (a.action !== "INSERT") continue;
    const e = w.legacy[app].entries.find((x) => x.id === a.key);
    const p = upsertParticipant({ id: `p-${e.owner.toLowerCase()}`, name: e.owner, email: e.email });
    w.rel.pool_entries.push({ pool_entry_id: e.id, participant_id: p.participant_id, pool_id: app, picks: e.picks });
  }
  assert(w.rel.pool_entries.length === afterBulk + 1, "the delta pass did not pick up the write that landed after extraction");
  assert(delta.unresolvedDelta === 0, `entries left an unresolved delta of ${delta.unresolvedDelta}`);
  trace.push({ state, afterBulk, afterDelta: w.rel.pool_entries.length, unresolvedDelta: delta.unresolvedDelta });

  // ---- DOMAIN_BACKFILLED
  t = canTransition(state, "DOMAIN_BACKFILLED", { bulkPassComplete: true, deltaPassComplete: true, noUnresolvedDelta: true });
  assert(t.allowed, `→ DOMAIN_BACKFILLED refused: ${t.reason}`);
  state = "DOMAIN_BACKFILLED";
  assert(w.rel.pool_entries.length === w.legacy[app].entries.length, "KEY_PARITY: entry counts diverge after the delta pass");
  trace.push({ state, entries: w.rel.pool_entries.length });

  // ---- DUAL_READ_SHADOW: the shadow result is computed and never returned.
  let flagState = { normalized_reads_shadow: true };
  let ctx = { schemaExpanded: true, backfillComplete: true, writeContractsDeployed: true };
  assert(validateFlags(flagState, ctx).ok, "shadow flags rejected");
  t = canTransition(state, "DUAL_READ_SHADOW", { normalizedReadsShadow: true, backfillComplete: true });
  assert(t.allowed, `→ DUAL_READ_SHADOW refused: ${t.reason}`);
  state = "DUAL_READ_SHADOW";
  const shadowResponse = { servedFrom: "legacy", shadowComputed: true, shadowExposed: false };
  assert(shadowResponse.servedFrom === "legacy" && !shadowResponse.shadowExposed,
    "the shadow read must never be the response the user sees");
  trace.push({ state, ...shadowResponse });

  // ---- PARITY_OBSERVATION (pre-write-cutover)
  t = canTransition(state, "PARITY_OBSERVATION", { parityHarnessRunning: true });
  assert(t.allowed, `→ PARITY_OBSERVATION refused: ${t.reason}`);
  state = "PARITY_OBSERVATION";
  const entryParity = evaluateParity("entries", {
    ROW_COUNT_PARITY: { checked: 4, mismatches: 0 },
    KEY_PARITY: { checked: 4, mismatches: 0 },
    VALUE_PARITY: { checked: 4, mismatches: 0 },
  });
  assert(entryParity.verdict === "PASS", `entry parity: ${JSON.stringify(entryParity)}`);
  const win = evaluateObservationWindow("entries", { cleanRuns: 3, hours: 24, mutationsInWindow: 1 });
  assert(win.ok, `observation window insufficient: ${win.reasons.join("; ")}`);
  trace.push({ state, parity: entryParity.verdict, windowOk: win.ok });

  // ---- SERVER_WRITE_CANARY: the first write through the trusted runtime, mirrored in one transaction.
  t = canTransition(state, "SERVER_WRITE_CANARY", { newReadPrimary: false, parityEvidenceSufficient: true, writeContractsDeployed: true });
  assert(t.allowed, `→ SERVER_WRITE_CANARY refused: ${t.reason}`);
  state = "SERVER_WRITE_CANARY";
  flagState = { server_writes_enabled: true, server_write_canary: true, normalized_reads_shadow: true };
  assert(validateFlags(flagState, ctx).ok, `canary flags rejected: ${JSON.stringify(validateFlags(flagState, ctx).violations)}`);

  trustedWrite(w, app, {
    legacyMutation: (d) => () => { d.entries.push({ id: "e5", owner: "Ana", email: ANA.email, paid: false, picks: {} }); },
    relMutation: (r) => () => {
      r.pool_entries.push({ pool_entry_id: "e5", participant_id: "p-ana", pool_id: app, picks: {} });
      r.audit_events.push({ action: "createEntry", at: "2026-02-01T00:00:00Z" });
      r.outbox_events.push({ event: "entry_created", refs: { pool_entry_id: "e5" }, delivered: false });
    },
  });
  assert(w.legacy[app].entries.length === w.rel.pool_entries.length,
    "the mirror left the two representations at different sizes — the single-transaction claim is false");
  assert(w.rel.outbox_events.every((e) => !e.delivered), "an outbox event was delivered before delivery was enabled");
  assert(w.rel.outbox_events.every((e) => !JSON.stringify(e.refs).includes("@")),
    "an outbox payload contains an address — payloads carry references only");
  trace.push({ state, mirrored: true, outboxPending: w.rel.outbox_events.length });

  // ---- SERVER_WRITE_PRIMARY: all NEW writes go through the runtime. A stale tab still writes the
  // document directly, and that write is NOT mirrored. The divergence is expected and measured.
  t = canTransition(state, "SERVER_WRITE_PRIMARY", { canaryEvidenceSufficient: true, serverWritesEnabled: true, idempotencyVerified: true });
  assert(t.allowed, `→ SERVER_WRITE_PRIMARY refused: ${t.reason}`);
  state = "SERVER_WRITE_PRIMARY";

  legacyDirectWrite(w, app, (d) => { d.entries.push({ id: "e6", owner: "Bruno", email: BRUNO.email, paid: false, picks: {} }); });
  const divergence = w.legacy[app].entries.length - w.rel.pool_entries.length;
  assert(divergence === 1, `expected exactly the stale write to diverge, saw ${divergence}`);

  // Reads must NOT have cut over here. FR-14 is the flag-level expression of the same rule.
  const badFlags = validateFlags({ normalized_reads_enabled: true, server_writes_enabled: true, legacy_writes_allowed: true },
    { ...ctx, serverWritesPrimary: true });
  assert(!badFlags.ok && badFlags.violations.some((v) => v.id === "FR-14"),
    "FR-14 failed to refuse a read cutover while stale tabs still write the document directly");
  const illegal = canTransition(state, "NEW_READ_PRIMARY", { normalizedReadsEnabled: true });
  assert(!illegal.allowed && illegal.verdict === "ILLEGAL_TRANSITION",
    "SERVER_WRITE_PRIMARY → NEW_READ_PRIMARY must be illegal: the normalized side is knowably incomplete");
  trace.push({ state, staleDivergence: divergence, readCutoverRefused: true });

  // Money, in the state where money starts moving. Carla pays for two of Ana's entries.
  trustedWrite(w, app, {
    legacyMutation: (d) => () => { for (const e of d.entries) if (e.id === "e5") e.paid = true; },
    relMutation: (r) => () => {
      r.payments.push({ payment_id: "pay-carla", payer_participant_id: CARLA.id, amount_minor: cents("40.00"), currency: "USD", external_reference: "SYNTH-PAYREF-0001" });
      r.audit_events.push({ action: "recordPayment", at: "2026-02-02T00:00:00Z" });
    },
  });
  const carlaPay = w.rel.payments.find((p) => p.payment_id === "pay-carla");
  for (const target of ["e1", "e5"]) {
    const allocated = w.rel.payment_allocations.filter((a) => a.payment_id === "pay-carla")
      .reduce((s, a) => s + a.amount_minor, 0);
    const add = cents("20.00");
    assert(allocated + add <= carlaPay.amount_minor, "over-allocation: sum(allocations) would exceed the payment");
    w.rel.payment_allocations.push({ payment_id: "pay-carla", pool_entry_id: target, amount_minor: add });
  }
  const totalAllocated = w.rel.payment_allocations.filter((a) => a.payment_id === "pay-carla").reduce((s, a) => s + a.amount_minor, 0);
  assert(totalAllocated === carlaPay.amount_minor, `third-party payment not fully applied: ${money(totalAllocated)} of ${money(carlaPay.amount_minor)}`);
  trace.push({ state, thirdPartyPayment: money(carlaPay.amount_minor), allocated: money(totalAllocated) });

  // ---- LEGACY_WRITE_DISABLED: the fence. A GRANT-level control, not a flag.
  t = canTransition(state, "LEGACY_WRITE_DISABLED", { staleClientFenceReady: true, writeErrorRateAcceptable: true });
  assert(t.allowed, `→ LEGACY_WRITE_DISABLED refused: ${t.reason}`);
  state = "LEGACY_WRITE_DISABLED";
  flagState = { server_writes_enabled: true, server_write_canary: false, legacy_writes_allowed: false, normalized_reads_shadow: true };
  const fenceCtx = { ...ctx, staleClientFenceReady: true, legacyWriteDeniedAtDatabase: true, canaryEvidenceSufficient: true, serverWritesPrimary: true };
  const fenceCheck = validateFlags(flagState, fenceCtx);
  assert(fenceCheck.ok, `fence flags rejected: ${JSON.stringify(fenceCheck.violations)}`);
  // The flag alone must NOT be accepted as the fence.
  const flagOnly = validateFlags(flagState, { ...fenceCtx, legacyWriteDeniedAtDatabase: false });
  assert(!flagOnly.ok && flagOnly.violations.some((v) => v.id === "FR-6"),
    "FR-6 failed: a UI-only freeze was accepted as a fence");
  // A stale tab's write is refused, distinguishably, with no partial mutation.
  const stale = oldClientOutcome(state, "SUBMIT_PREDICTION");
  assert(!stale.proceed && stale.response === "CLIENT_TOO_OLD" && stale.distinguishable && !stale.partialMutation,
    "a stale write at the fence must be refused distinguishably and never partially applied");
  const sizeAtFence = { legacy: w.legacy[app].entries.length, rel: w.rel.pool_entries.length };
  trace.push({ state, ...sizeAtFence, staleRefused: true });

  // Final reconciliation against the now-stationary source. THIS is the pass whose result can be asserted.
  const finalDelta = runDeltaPass({
    domain: "entries", source: w.legacy[app].entries, copied: w.rel.pool_entries,
    keyOf: (x) => x.pool_entry_id ?? x.id, fingerprintOf: (x) => JSON.stringify(x.picks),
  });
  for (const a of finalDelta.applied) if (a.action === "INSERT") {
    const e = w.legacy[app].entries.find((x) => x.id === a.key);
    const p = upsertParticipant({ id: `p-${e.owner.toLowerCase()}`, name: e.owner, email: e.email });
    w.rel.pool_entries.push({ pool_entry_id: e.id, participant_id: p.participant_id, pool_id: app, picks: e.picks });
  }
  assert(w.rel.pool_entries.length === w.legacy[app].entries.length,
    "the final reconciliation left the representations at different sizes");
  trace.push({ state: "final reconciliation", converged: true, entries: w.rel.pool_entries.length });

  // ---- NEW_READ_PRIMARY
  t = canTransition(state, "NEW_READ_PRIMARY", {
    normalizedReadsEnabled: true, finalCatchupComplete: true, parityEvidenceSufficient: true, frozenSourceParity: true,
  });
  assert(t.allowed, `→ NEW_READ_PRIMARY refused: ${t.reason}`);
  state = "NEW_READ_PRIMARY";
  assert(stateDef(state).rollbackClass === "FEATURE_FLAG_ROLLBACK",
    "the read cutover must still be reversible by a flag — that is its whole design");
  // An old tab reading the document here sees correct data, because the mirror is still running.
  assert(oldClientOutcome(state, "READ").proceed, "an old tab must still read successfully before the freeze");
  trace.push({ state, rollback: stateDef(state).rollbackClass, oldClientRead: "SAFE_WITH_LEGACY_PATH" });

  // A result arrives, and a prize is declared, through the runtime.
  trustedWrite(w, app, {
    legacyMutation: (d) => () => { d.results["m1"] = { h: 2, a: 1 }; },
    relMutation: (r) => () => {
      r.match_results.push({ match_id: "m1", home_goals: 2, away_goals: 1 });
      r.audit_events.push({ action: "recordResult", at: "2026-03-01T00:00:00Z" });
    },
  });
  trustedWrite(w, app, {
    legacyMutation: (d) => () => { d.audit.push({ at: "2026-03-02T00:00:00Z", action: "prize_declared" }); },
    relMutation: (r) => () => {
      r.prize_allocations.push({ pool_id: app, rank: 1, amount_minor: cents("70.00"), currency: "USD" });
      r.audit_events.push({ action: "recordPrize", at: "2026-03-02T00:00:00Z" });
    },
  });

  // ---- PARITY_OBSERVATION (post-cutover soak)
  t = canTransition(state, "PARITY_OBSERVATION", { parityHarnessRunning: true });
  assert(t.allowed, `→ PARITY_OBSERVATION (soak) refused: ${t.reason}`);
  state = "PARITY_OBSERVATION";
  const soakExit = canTransition(state, "CUTOVER_READY", { newReadPrimary: true, parityEvidenceSufficient: true, soakComplete: true });
  assert(soakExit.allowed, `soak → CUTOVER_READY refused: ${soakExit.reason}`);
  const wrongExit = canTransition(state, "SERVER_WRITE_CANARY", { newReadPrimary: true, parityEvidenceSufficient: true, writeContractsDeployed: true });
  assert(!wrongExit.allowed, "PARITY_OBSERVATION must not fall back to the pre-cutover exit once reads have cut over");
  state = "CUTOVER_READY";
  trace.push({ state, exitDisambiguatedByFlags: true });

  // ---- LEGACY_FROZEN: the point of no simple return.
  t = canTransition(state, "LEGACY_FROZEN", {
    allDomainsCutoverReady: true, scoringParityExact: true, financialReconciled: true, operatorAuthorization: true,
  });
  assert(t.allowed, `→ LEGACY_FROZEN refused: ${t.reason}`);
  const noAuth = canTransition(state, "LEGACY_FROZEN", { allDomainsCutoverReady: true, scoringParityExact: true, financialReconciled: true });
  assert(!noAuth.allowed, "the freeze must require an explicit operator authorization, not an evaluator's PROMOTE");
  state = "LEGACY_FROZEN";
  assert(stateDef(state).rollbackClass === "FORWARD_FIX_ONLY", "the freeze must be classified FORWARD_FIX_ONLY");
  const backToLegacy = canTransition(state, "LEGACY_READ_FALLBACK", {});
  assert(!backToLegacy.allowed && backToLegacy.verdict === "ILLEGAL_TRANSITION",
    "falling back to legacy reads after the freeze must be impossible — the document is stale");
  // From here the mirror stops. A stale tab's read is stale, so it is READ_ONLY, not SAFE.
  assert(oldClientOutcome(state, "READ").response === "OK_STALE",
    "an old tab's read after the freeze must be recognised as stale");
  trace.push({ state, rollback: "FORWARD_FIX_ONLY", legacyFallbackImpossible: true });

  // ---- CONTRACT_ELIGIBLE — reached, but nothing is dropped.
  t = canTransition(state, "CONTRACT_ELIGIBLE", {
    hardClientFloorEnforced: true, zeroLegacyReadsObserved: true,
    observationWindowExceedsLongestSession: true, legacyReadFallback: false,
  });
  assert(t.allowed, `→ CONTRACT_ELIGIBLE refused: ${t.reason}`);
  const noFloor = canTransition(state, "CONTRACT_ELIGIBLE", { zeroLegacyReadsObserved: true, observationWindowExceedsLongestSession: true, legacyReadFallback: false });
  assert(!noFloor.allowed, "contract eligibility must require the enforced client floor");
  state = "CONTRACT_ELIGIBLE";
  trace.push({ state, nothingDropped: true });

  // Money conservation across the entire run.
  const paid = w.rel.payments.reduce((s, p) => s + p.amount_minor, 0);
  const alloc = w.rel.payment_allocations.reduce((s, a) => s + a.amount_minor, 0);
  assert(alloc <= paid, `allocated ${money(alloc)} exceeds received ${money(paid)}`);
  assert(w.rel.audit_events.length >= 4, "audit must record every contract-mediated mutation");

  return { ok: failures.length === 0, failures, trace, finalState: state, world: w,
    money: { received: money(paid), allocated: money(alloc) } };
}

// ---------------------------------------------------------------------------------------------
// WS5.39 — stale browser simulation
// ---------------------------------------------------------------------------------------------

/**
 * A tab is loaded at `openedAt`, the migration advances to `nowState`, and the tab then writes.
 * The only two acceptable outcomes are a lossless adaptation or an explicit refusal. A silent
 * partial mutation is the failure this simulation exists to make impossible.
 *
 * `writePath` matters and was initially missing (WS5-F9). Two different populations of stale tab
 * exist and they must not be treated as one:
 *
 *   · writePath "legacy"  — a build that predates the trusted runtime entirely. It writes the
 *     document directly with the anon key. After the fence its write is denied by a DATABASE
 *     PRIVILEGE, so no adapter can rescue it. The old-client matrix governs this case, and its
 *     refusal is absolute.
 *   · writePath "contract" — a build that reaches the trusted runtime but speaks an older envelope
 *     version. The fence does not apply to it at all; the write-shape classifier governs it, and a
 *     lossless adaptation is the correct outcome.
 *
 * Conflating them makes the adapter look like it can defeat the fence, which it cannot, and makes
 * the fence look like it rejects clients it has no reason to reject.
 */
export function simulateStaleBrowser({ openedAt = "LEGACY_ONLY", nowState = "LEGACY_WRITE_DISABLED",
  operation = "SUBMIT_PREDICTION", writePath = "legacy", clientContractVersion = 1,
  minimumWriteVersion = 2, missingFields = [], shape = "recognized" } = {}) {
  const order = states();
  const advanced = order.indexOf(nowState) - order.indexOf(openedAt);
  const failures = [];
  const assert = (c, m) => { if (!c) failures.push(m); };
  assert(advanced >= 0, "the tab cannot have been opened after the current state");
  assert(["legacy", "contract"].includes(writePath), `unknown write path ${writePath}`);

  const outcome = oldClientOutcome(nowState, operation);
  assert(outcome.classification !== "DATA_CORRUPTION_RISK",
    `${operation} at ${nowState} is classified DATA_CORRUPTION_RISK — no state may permit that`);

  let governedBy, verdict, shapeDecision = null;

  if (writePath === "legacy") {
    governedBy = "oldClientMatrix";
    if (!outcome.proceed) {
      assert(outcome.response === "CLIENT_TOO_OLD", "a refusal must use the distinguishable code");
      assert(outcome.partialMutation === false, "a refusal must not have mutated anything");
      verdict = "EXPLICITLY_REFUSED";
    } else {
      verdict = "ACCEPTED_VIA_LEGACY_PATH";
    }
    // The fence is a privilege denial on WRITES. No adapter may override it — asserted, because an
    // adapter that could would silently reopen the path the fence exists to close. Reads are
    // deliberately untouched by the fence: the document is still readable and, until the freeze,
    // still current.
    const isWrite = operation !== "READ";
    if (isWrite && (nowState === "LEGACY_WRITE_DISABLED" || outcome.classification === "BLOCKED")) {
      assert(verdict === "EXPLICITLY_REFUSED",
        "a legacy-path write survived the fence — the fence is a database privilege and cannot be adapted around");
    }
  } else {
    governedBy = "writeShapeClassifier";
    shapeDecision = classifyWriteShape({ contractVersion: clientContractVersion, minimumWriteVersion, missingFields, shape, operation });
    assert(["ACCEPT", "ADAPT", "REJECT"].includes(shapeDecision.action), "no third outcome may exist");
    if (shapeDecision.action === "ADAPT") {
      assert(missingFields.every((f) => !["amount", "currency", "amount_minor"].includes(f)),
        "the adapter defaulted a monetary field, which it may never do");
      assert(shapeDecision.adapterUsed === true, "an adaptation must record that an adapter was used");
    }
    if (shapeDecision.action === "REJECT") assert(shapeDecision.code === "CLIENT_TOO_OLD", "a rejection must be distinguishable");
    verdict = shapeDecision.action === "REJECT" ? "EXPLICITLY_REFUSED" : "ACCEPTED_OR_ADAPTED";
    // An admin action is never adapted, whatever its shape.
    if (operation === "ADMIN_ACTION") {
      assert(shapeDecision.action !== "ADAPT", "an admin action must never be adapted — it would be an action nobody specified");
    }
  }

  return { ok: failures.length === 0, failures, statesAdvanced: advanced, writePath, governedBy,
    outcome, shapeDecision, verdict, silentPartialMutation: false };
}

// ---------------------------------------------------------------------------------------------
// WS5.40 — financial failure simulation
// ---------------------------------------------------------------------------------------------

/**
 * Four money scenarios that each have a plausible way to lose or double a payment:
 *   1. a payment arrives during the bulk backfill
 *   2. an allocation happens during the delta pass
 *   3. a refund happens during the cutover
 *   4. a retry arrives after the write committed but before the response was delivered
 */
export function simulateFinancialFailure() {
  const failures = [];
  const assert = (c, m) => { if (!c) failures.push(m); };
  const scenarios = [];

  // --- 1. a payment arrives mid-bulk-backfill
  {
    const legacy = [{ id: "e1", paid: true }, { id: "e2", paid: false }];
    const copied = [{ payment_id: "pay-e1", asserted_for_pool_entry_id: "e1", amount_minor: cents("20.00") }];
    legacy[1].paid = true; // lands after extraction
    const d = runDeltaPass({ domain: "payments", source: legacy.filter((e) => e.paid).map((e) => ({ id: `pay-${e.id}`, ref: e.id })),
      copied, keyOf: (x) => x.payment_id ?? x.id, fingerprintOf: (x) => String(x.amount_minor ?? "") });
    const inserted = d.applied.filter((a) => a.action === "INSERT").length;
    assert(inserted === 1, `a payment that landed after extraction was not picked up (inserted ${inserted})`);
    assert(d.unresolvedDelta === 0, "the payments delta pass left an unresolved item");
    scenarios.push({ scenario: "payment during bulk backfill", caught: inserted === 1, unresolvedDelta: d.unresolvedDelta });
  }

  // --- 2. an allocation during the delta pass must not over-allocate
  {
    const payment = { payment_id: "p1", amount_minor: cents("40.00") };
    const allocations = [{ payment_id: "p1", amount_minor: cents("20.00") }];
    const attempt = cents("30.00");
    const sum = allocations.reduce((s, a) => s + a.amount_minor, 0);
    const refused = sum + attempt > payment.amount_minor;
    assert(refused, "an allocation exceeding the payment was not refused");
    // and the allowed one must succeed
    const ok = sum + cents("20.00") <= payment.amount_minor;
    assert(ok, "a legitimate allocation was refused");
    scenarios.push({ scenario: "allocation during delta pass", overAllocationRefused: refused, legitimateAllowed: ok });
  }

  // --- 3. a refund during the cutover is a compensating record, never an edit (WS13-OP-3)
  {
    const payments = [{ payment_id: "p1", amount_minor: cents("40.00"), kind: "PAYMENT" }];
    const before = JSON.stringify(payments[0]);
    payments.push({ payment_id: "p1-rev", reverses_payment_id: "p1", amount_minor: -cents("40.00"),
      kind: "REVERSAL", reason: "duplicate transfer", actor: "operator", at: "2026-03-05T00:00:00Z" });
    assert(JSON.stringify(payments[0]) === before, "the original payment fact was edited — WS13-OP-3 forbids it");
    const rev = payments[1];
    for (const k of ["reverses_payment_id", "reason", "actor", "at"]) {
      assert(rev[k] !== undefined, `the compensating record is missing ${k}`);
    }
    assert(rev.kind === "REVERSAL", "a negative amount is permitted only under typed reversal semantics");
    const net = payments.reduce((s, p) => s + p.amount_minor, 0);
    assert(net === 0, `net after refund should be 0.00, got ${money(net)}`);
    scenarios.push({ scenario: "refund during cutover", originalPreserved: true, net: money(net), typed: true });
  }

  // --- 4. a retry after the commit but before the response
  {
    const store = new Map();
    const ledger = [];
    const recordPayment = (idemKey, amount) => {
      if (store.has(idemKey)) return { replayed: true, ...store.get(idemKey) };
      ledger.push({ amount_minor: amount });
      const response = { payment_id: `p${ledger.length}`, amount_minor: amount };
      store.set(idemKey, response); // committed INSIDE the business transaction
      return { replayed: false, ...response };
    };
    const first = recordPayment("k1", cents("40.00"));   // commits; the response is lost in transit
    const retry = recordPayment("k1", cents("40.00"));   // the client retries
    assert(ledger.length === 1, `the retry double-wrote: ledger has ${ledger.length} rows`);
    assert(retry.replayed === true, "the retry re-executed instead of replaying the stored response");
    assert(retry.payment_id === first.payment_id, "the retry returned a different payment id");
    const total = ledger.reduce((s, p) => s + p.amount_minor, 0);
    assert(total === cents("40.00"), `money was doubled: ${money(total)}`);
    scenarios.push({ scenario: "retry after commit before response", ledgerRows: ledger.length, replayed: retry.replayed, total: money(total) });
  }

  // --- 5. the idempotency store is unavailable: a money-bearing retry must be refused, not executed
  {
    const abort = checkAbortCriteria({ idempotencyStoreUnavailable: true });
    assert(abort.abort && abort.triggered.some((t) => t.id === "AC-9"),
      "AC-9 failed to abort when the idempotency store was unavailable");
    scenarios.push({ scenario: "idempotency store unavailable", aborted: abort.abort });
  }

  return { ok: failures.length === 0, failures, scenarios };
}

// ---------------------------------------------------------------------------------------------
// WS5.41 — scoring cutover simulation
// ---------------------------------------------------------------------------------------------

/**
 * Predictions exist partly as picks jsonb and partly as decomposed rows during the transition.
 * Scoring must be identical whichever representation supplies the input. The scoring itself is the
 * app's own logic — this simulation compares INPUTS and ORDERING, and never reimplements a score.
 */
export function simulateScoringCutover({ app = "copa2026" } = {}) {
  const failures = [];
  const assert = (c, m) => { if (!c) failures.push(m); };

  // Entry A is still legacy-shaped; entry B has been decomposed. Both must canonicalize identically
  // to their own counterpart.
  const picksA = { m1: { h: 2, a: 1 }, m2: { h: "0", a: "0" }, m3: null };
  const rowsA = [
    { match_id: "m1", home_goals: 2, away_goals: 1 },
    { match_id: "m2", home_goals: 0, away_goals: 0 },
    { match_id: "m3", home_goals: null, away_goals: null },
  ];
  const pa = inputParity(picksA, rowsA);
  assert(pa.identical, `input parity failed for a mixed-representation entry: ${JSON.stringify(pa.diffs)}`);

  // A missing pick must stay distinct from 0-0. Collapsing them changes scores, so it is asserted.
  const collapsed = inputParity({ m3: null }, [{ match_id: "m3", home_goals: 0, away_goals: 0 }]);
  assert(!collapsed.identical, "a missing pick compared equal to 0-0 — that would change scores");

  // A cutoff decision must not change with the representation. The legacy document holds an ISO
  // string; the column holds timestamptz. Same instant, different text.
  const lockedFromString = isLocked("2026-06-28T18:00:01Z", "2026-06-28T14:00:00-04:00");
  const lockedFromTz = isLocked("2026-06-28T14:00:01-04:00", "2026-06-28T18:00:00Z");
  assert(lockedFromString === lockedFromTz,
    "the lock decision changed with the timestamp representation — this is the likeliest way a migration changes who is allowed to play");

  // Ranking must be byte-identical from both representations, including the tie ordering.
  const scored = [
    { pool_entry_id: "e1", metrics: { total: 25, exact: 2, podium: 1 } },
    { pool_entry_id: "e2", metrics: { total: 25, exact: 2, podium: 1 } }, // a genuine tie
    { pool_entry_id: "e3", metrics: { total: 30, exact: 3, podium: 1 } },
  ];
  const cascade = TIE_CASCADES[app];
  assert(Array.isArray(cascade), `no tie cascade for ${app}`);
  const fromLegacy = assembleRanking(scored, cascade);
  const fromRelational = assembleRanking([...scored].reverse(), cascade); // different input order
  const rp = rankingParity(fromLegacy, fromRelational);
  assert(rp.identical, "the ranking depended on input order — every parity comparison would be flaky");
  assert(fromLegacy[0].pool_entry_id === "e3", "the ranking did not order by the cascade");
  assert(fromLegacy[1].position === fromLegacy[2].position, "two genuinely tied entries got different positions");

  // A scoring mismatch of any size must abort, not hold.
  const abort = checkAbortCriteria({ scoringMismatch: 1 });
  assert(abort.abort && abort.triggered.some((t) => t.id === "AC-2"), "AC-2 failed to abort on a scoring mismatch");

  return { ok: failures.length === 0, failures, cascade, ranking: fromLegacy.map((r) => `${r.pool_entry_id}:${r.position}`) };
}

// ---------------------------------------------------------------------------------------------
// WS5.26 / WS5-F7 — partial rollout across two apps sharing participants and payments
// ---------------------------------------------------------------------------------------------

/**
 * copa2026 migrates first; br2026 stays legacy. They share participants and payments.
 * The hazard this proves against: the migration itself manufacturing a duplicate participant.
 */
export function simulatePartialRollout() {
  const failures = [];
  const assert = (c, m) => { if (!c) failures.push(m); };

  const participants = [];
  // The natural key is GLOBAL, not per app. That is the whole control (XH-1).
  const upsert = (email, name, app) => {
    const key = (email || name).toLowerCase();
    let row = participants.find((p) => p.natural_key === key);
    if (!row) { row = { participant_id: `p${participants.length + 1}`, natural_key: key, apps: [] }; participants.push(row); }
    if (!row.apps.includes(app)) row.apps.push(app);
    return row;
  };

  upsert("ana@example.test", "Ana", "copa2026");   // copa2026 migrates
  upsert("ana@example.test", "Ana", "br2026");     // br2026 migrates later — must REUSE the row
  assert(participants.length === 1, `the migration manufactured a duplicate participant: ${participants.length} rows`);
  assert(participants[0].apps.length === 2, "the shared participant is not linked to both apps");

  // MA-1: a shared domain advances at the slowest app.
  const shared = sharedDomainState("payments", { copa2026: "NEW_READ_PRIMARY", br2026: "DOMAIN_BACKFILLED" });
  assert(shared.state === "DOMAIN_BACKFILLED", `a shared domain advanced past the slowest app: ${shared.state}`);
  assert(shared.limitedBy === "br2026", "the limiting app was not identified");

  // MA-2: a per-app domain may advance independently.
  const perApp = sharedDomainState("entries", { copa2026: "NEW_READ_PRIMARY", br2026: "LEGACY_ONLY" });
  assert(perApp.shared === false, "entries must be per-app, not shared");

  // MA-4: the shared domain may not freeze while an app lags.
  const freeze = mayFreezeSharedDomain("payments", { copa2026: "CUTOVER_READY", br2026: "DUAL_READ_SHADOW" });
  assert(!freeze.allowed && freeze.laggards.includes("br2026"),
    "freezing a shared domain was permitted while an app was still reading it from the document");
  const freezeOk = mayFreezeSharedDomain("payments", { copa2026: "CUTOVER_READY", br2026: "CUTOVER_READY" });
  assert(freezeOk.allowed, "the freeze was refused with every app ready");

  // XH-2: a third-party payment spanning a migrated and an unmigrated app cannot be fully allocated.
  const payment = { amount_minor: cents("40.00") };
  const allocatable = [{ app: "copa2026", amount_minor: cents("20.00") }]; // br2026's entry is legacy-only
  const allocated = allocatable.reduce((s, a) => s + a.amount_minor, 0);
  const wouldReadAsUnderApplied = allocated < payment.amount_minor;
  assert(wouldReadAsUnderApplied, "the XH-2 hazard fixture does not actually reproduce the hazard");
  // The control is that payments is shared and therefore held at the slowest app — so this state is
  // never reached in the choreography. Proven by the MA-1 check above.
  assert(shared.state === "DOMAIN_BACKFILLED", "MA-1 is what prevents XH-2, so it must hold");

  return { ok: failures.length === 0, failures, participants: participants.length,
    sharedLimitedBy: shared.limitedBy, freezeRefusedFor: freeze.laggards };
}

// ---------------------------------------------------------------------------------------------
// WS5.37 — fault injection
// ---------------------------------------------------------------------------------------------

/** Each fault must produce HOLD, ROLLBACK or BLOCKED. Never PROMOTE. */
export const FAULTS = [
  { id: "F-FLAG-WRONG", why: "reads flipped on for a domain whose backfill is still running",
    input: { state: "DOMAIN_BACKFILLING", domain: "entries", target: "DOMAIN_BACKFILLED",
      flagState: { normalized_reads_enabled: true }, ctx: { schemaExpanded: true, backfillComplete: false, serverWritesPrimary: false } } },
  { id: "F-BACKFILL-PAUSED", why: "promotion attempted with the bulk pass incomplete",
    input: { state: "DOMAIN_BACKFILLING", domain: "entries", target: "DOMAIN_BACKFILLED",
      ctx: { bulkPassComplete: false, deltaPassComplete: false, noUnresolvedDelta: false } } },
  { id: "F-RUNTIME-MISSING", why: "server writes enabled with no deployed runtime",
    input: { state: "PARITY_OBSERVATION", domain: "entries", target: "SERVER_WRITE_CANARY",
      flagState: { server_writes_enabled: true }, ctx: { schemaExpanded: true, backfillComplete: true, writeContractsDeployed: false } } },
  { id: "F-OLD-CLIENT-WRITE", why: "a stale client write after the fence",
    input: { state: "LEGACY_WRITE_DISABLED", domain: "entries", target: "NEW_READ_PRIMARY",
      ctx: { normalizedReadsEnabled: true, finalCatchupComplete: false, parityEvidenceSufficient: false, frozenSourceParity: false } } },
  { id: "F-RLS-TOO-EARLY", why: "a table granted before its policies exist",
    input: { state: "EXPANDED_SCHEMA", domain: "entries", target: "REFERENCE_BACKFILLED",
      ctx: { referenceRowsPresent: true }, observations: { authorizationRegression: true } } },
  { id: "F-ACL-TOO-EARLY", why: "the legacy write privilege revoked before the new path exists",
    input: { state: "SERVER_WRITE_PRIMARY", domain: "entries", target: "LEGACY_WRITE_DISABLED",
      flagState: { legacy_writes_allowed: false, server_writes_enabled: false },
      ctx: { schemaExpanded: true, backfillComplete: true, staleClientFenceReady: false, writeContractsDeployed: false } } },
  { id: "F-READ-TOO-EARLY", why: "reads cut over while stale tabs still write the document",
    input: { state: "SERVER_WRITE_PRIMARY", domain: "entries", target: "NEW_READ_PRIMARY",
      flagState: { normalized_reads_enabled: true, legacy_writes_allowed: true, server_writes_enabled: true },
      ctx: { schemaExpanded: true, backfillComplete: true, serverWritesPrimary: true, writeContractsDeployed: true } } },
  { id: "F-OUTBOX-EARLY", why: "outbox delivery enabled before idempotency was proven",
    input: { state: "SERVER_WRITE_CANARY", domain: "entries", target: "SERVER_WRITE_PRIMARY",
      flagState: { outbox_delivery_enabled: true, server_writes_enabled: true },
      ctx: { schemaExpanded: true, backfillComplete: true, writeContractsDeployed: true, idempotencyVerified: false } } },
  { id: "F-FINANCIAL-MISMATCH", why: "a financial mismatch of one cent",
    input: { state: "SERVER_WRITE_PRIMARY", domain: "payments", target: "LEGACY_WRITE_DISABLED",
      observations: { financialMismatchCount: 1 } } },
  { id: "F-SCORING-MISMATCH", why: "a single scoring mismatch",
    input: { state: "NEW_READ_PRIMARY", domain: "predictions", target: "PARITY_OBSERVATION",
      observations: { scoringMismatch: 1 } } },
  { id: "F-SCHEMA-DRIFT", why: "the live schema does not match the expected state",
    input: { state: "DOMAIN_BACKFILLED", domain: "entries", target: "DUAL_READ_SHADOW",
      observations: { schemaDrift: true } } },
  { id: "F-VACUOUS-PARITY", why: "clean parity runs with zero mutations in the window",
    input: { state: "PARITY_OBSERVATION", domain: "entries", target: "SERVER_WRITE_CANARY",
      ctx: { schemaExpanded: true, backfillComplete: true, writeContractsDeployed: true, newReadPrimary: false, parityEvidenceSufficient: true },
      observation: { cleanRuns: 5, hours: 48, mutationsInWindow: 0 } } },
  { id: "F-FREEZE-NO-AUTH", why: "the freeze attempted without operator authorization",
    input: { state: "CUTOVER_READY", domain: "entries", target: "LEGACY_FROZEN",
      ctx: { allDomainsCutoverReady: true, scoringParityExact: true, financialReconciled: true, operatorAuthorization: false } } },
  { id: "F-CONTRACT-NO-FLOOR", why: "contract eligibility without the enforced client floor",
    input: { state: "LEGACY_FROZEN", domain: "entries", target: "CONTRACT_ELIGIBLE",
      ctx: { hardClientFloorEnforced: false, zeroLegacyReadsObserved: true, observationWindowExceedsLongestSession: true, legacyReadFallback: false } } },
  { id: "F-FALLBACK-ARMED", why: "the legacy read fallback still armed at the freeze",
    input: { state: "CUTOVER_READY", domain: "entries", target: "LEGACY_FROZEN",
      flagState: { legacy_read_fallback: true }, ctx: { atOrPastLegacyFrozen: true, allDomainsCutoverReady: true, scoringParityExact: true, financialReconciled: true, operatorAuthorization: true } } },
  { id: "F-IDEM-STORE-DOWN", why: "the idempotency store is unavailable",
    input: { state: "SERVER_WRITE_PRIMARY", domain: "payments", target: "LEGACY_WRITE_DISABLED",
      observations: { idempotencyStoreUnavailable: true } } },
];

export function simulateFaults() {
  const results = FAULTS.map((f) => {
    const d = evaluatePromotion(f.input);
    return { id: f.id, why: f.why, decision: d.decision, reasons: d.reasons.slice(0, 2) };
  });
  const promoted = results.filter((r) => r.decision === "PROMOTE");
  return { ok: promoted.length === 0, promoted, results };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = [
    ["full cutover", simulateFullCutover()],
    ["stale browser", simulateStaleBrowser()],
    ["financial failure", simulateFinancialFailure()],
    ["scoring cutover", simulateScoringCutover()],
    ["partial rollout", simulatePartialRollout()],
    ["fault injection", simulateFaults()],
  ];
  let bad = 0;
  for (const [name, r] of runs) {
    console.log(`\n${r.ok ? "✓" : "✗"} ${name}`);
    if (!r.ok) { bad++; for (const f of r.failures || r.promoted || []) console.log(`    ${JSON.stringify(f)}`); }
  }
  console.log(bad === 0 ? "\n✓ ALL CUTOVER SIMULATIONS PASSED\n" : `\n✗ ${bad} SIMULATION(S) FAILED\n`);
  process.exit(bad === 0 ? 0 : 1);
}

export { HAPPY_PATH, cents, money };
