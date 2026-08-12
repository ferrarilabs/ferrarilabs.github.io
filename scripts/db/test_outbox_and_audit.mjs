#!/usr/bin/env node
/**
 * Tests for the outbox state machine (T) and the audit event model (U).
 *
 * Both modules encode rules whose value is that they REFUSE things, so most of these tests assert a
 * refusal. Synthetic fixtures only; nothing is sent and nothing is stored.
 */

import {
  STATUS, OUTCOME, TRANSITIONS, MAX_ATTEMPTS, backoffSeconds, IllegalTransition,
  createEvent, transition, recordAttempt, claimable, expiredLeases, isDuplicate, checkInvariants,
} from "./outbox.mjs";
import {
  ACTOR_ROLES, SOURCES, FORBIDDEN_KEYS, VALUE_PATTERNS, RETENTION, AUDITED_ACTIONS,
  checkSafeMetadata, buildAuditEvent, hashEvent, appendToChain, verifyChain,
  buildDetail, redactDetail,
} from "./audit.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const throws = (fn, re, m) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  assert(msg !== null, `${m}: expected a throw, none happened`);
  if (re) assert(re.test(msg), `${m}: message ${JSON.stringify(msg)} does not match ${re}`);
  return msg;
};

const T = (n) => new Date(Date.UTC(2026, 7, 7, 12, 0, n)).toISOString();
const mkEvent = (over = {}) => createEvent({
  id: "o-1", channel: "email", eventType: "participant_receipt",
  payload: { entry: "e-1" }, idempotencyKey: "k-1", correlationId: "corr-1", at: T(0), ...over,
});

console.log("\nOutbox — envelope\n");

test("an event without an idempotency key is refused", () => {
  throws(() => createEvent({ id: "o", channel: "email", eventType: "t", at: T(0) }),
    /idempotency key/, "a channel that accepts the same send twice would produce a duplicate receipt");
});

test("an event without a channel or type is refused", () => {
  throws(() => createEvent({ id: "o", idempotencyKey: "k", at: T(0) }), /channel and an event type/, "refused");
});

test("a new event starts pending with zero attempts", () => {
  const e = mkEvent();
  eq(e.status, STATUS.PENDING, "status"); eq(e.attempt_count, 0, "attempts");
  eq(e.dead_at, null, "dead_at"); eq(e.lease_owner, null, "lease");
});

test("events are frozen — transitions cannot mutate in place", () => {
  const e = mkEvent();
  let threw = false;
  try { "use strict"; e.status = STATUS.SENT; } catch { threw = true; }
  assert(threw || e.status === STATUS.PENDING, "an event must not be mutable");
});

console.log("\nOutbox — state machine\n");

test("the happy path is pending → in_flight → sent", () => {
  let e = mkEvent();
  e = transition(e, "lease", { at: T(1), worker: "w1" });
  eq(e.status, STATUS.IN_FLIGHT, "leased"); eq(e.attempt_count, 1, "attempt counted on lease");
  assert(e.lease_expires_at, "a lease must have an expiry or the row can never be reclaimed");
  e = transition(e, "success", { at: T(2) });
  eq(e.status, STATUS.SENT, "sent"); eq(e.lease_owner, null, "lease released");
});

test("every declared transition is legal and every undeclared one is refused", () => {
  for (const t of TRANSITIONS) {
    const e = { ...mkEvent(), status: t.from, attempt_count: 0 };
    const out = transition(e, t.event, { at: T(1), worker: "w", reason: "test reason" });
    eq(out.status, t.to, `${t.from} --${t.event}-->`);
  }
  // A sample of illegal ones, including the dangerous "resend a sent event".
  for (const [from, event] of [[STATUS.SENT, "lease"], [STATUS.SENT, "replay"], [STATUS.PENDING, "success"],
                               [STATUS.DEAD, "lease"], [STATUS.IN_FLIGHT, "lease"]]) {
    let err = null;
    try { transition({ ...mkEvent(), status: from }, event, { at: T(1), reason: "r" }); } catch (e) { err = e; }
    assert(err instanceof IllegalTransition, `${from} --${event}--> should be illegal`);
  }
});

test("a sent event can never be re-sent", () => {
  const sent = { ...mkEvent(), status: STATUS.SENT };
  for (const ev of ["lease", "replay", "success", "transient_failure"]) {
    let threw = false;
    try { transition(sent, ev, { at: T(1), reason: "r" }); } catch { threw = true; }
    assert(threw, `sent --${ev}--> must be illegal; a re-send is a duplicate email to a real participant`);
  }
});

test("every transition states why it exists", () => {
  for (const t of TRANSITIONS) assert(t.why, `${t.from}--${t.event} has no rationale`);
});

test("a transient failure returns the event to pending with backoff", () => {
  let e = transition(mkEvent(), "lease", { at: T(1), worker: "w" });
  e = transition(e, "transient_failure", { at: T(2) });
  eq(e.status, STATUS.PENDING, "back to pending");
  assert(new Date(e.available_at).getTime() > new Date(T(2)).getTime(), "available_at must be pushed out");
  eq(e.lease_owner, null, "lease released");
});

test("backoff grows and is capped", () => {
  const seq = [0, 1, 2, 3, 4, 5].map((n) => backoffSeconds(n));
  for (let i = 1; i < seq.length; i++) assert(seq[i] > seq[i - 1], "backoff must grow");
  eq(backoffSeconds(100), 3600, "backoff must cap, or a retry lands years away");
});

test("attempt exhaustion lands in dead, not an infinite loop", () => {
  let e = mkEvent();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    e = transition(e, "lease", { at: T(i * 2 + 1), worker: "w" });
    if (e.status !== STATUS.IN_FLIGHT) break;
    e = transition(e, "transient_failure", { at: T(i * 2 + 2) });
  }
  eq(e.status, STATUS.DEAD, `after ${MAX_ATTEMPTS} attempts the event must be dead`);
  assert(e.dead_at, "dead_at set");
  eq(e.dead_reason, "attempts exhausted", "reason recorded");
});

test("a permanent failure and a poison payload both go straight to dead", () => {
  const inflight = transition(mkEvent(), "lease", { at: T(1), worker: "w" });
  eq(transition(inflight, "permanent_failure", { at: T(2), reason: "recipient rejected" }).status, STATUS.DEAD, "permanent");
  eq(transition(mkEvent(), "poison", { at: T(2), reason: "payload unparseable" }).status, STATUS.DEAD, "poison");
});

test("an expired lease returns to pending WITHOUT extra backoff", () => {
  const e = transition(mkEvent(), "lease", { at: T(1), worker: "w" });
  const back = transition(e, "lease_expired", { at: T(99) });
  eq(back.status, STATUS.PENDING, "pending");
  eq(back.available_at, e.available_at, "a crashed worker is not the event's fault; delaying the retry punishes the wrong party");
});

test("dead is not terminal — replay is possible and requires a reason", () => {
  const dead = transition(mkEvent(), "poison", { at: T(2), reason: "bad payload" });
  throws(() => transition(dead, "replay", { at: T(3) }), /requires a reason/, "unexplained replay");
  const back = transition(dead, "replay", { at: T(3), reason: "payload fixed by operator" });
  eq(back.status, STATUS.PENDING, "replayed");
  eq(back.dead_at, null, "dead_at cleared");
  eq(back.replay_reason, "payload fixed by operator", "reason recorded");
});

test("replay does NOT reset attempt_count", () => {
  let e = transition(mkEvent(), "lease", { at: T(1), worker: "w" });
  e = transition(e, "permanent_failure", { at: T(2), reason: "x" });
  const back = transition(e, "replay", { at: T(3), reason: "retry after fix" });
  eq(back.attempt_count, 1, "resetting the count would hide a chronic failure");
});

console.log("\nOutbox — leases, claiming, dedupe\n");

test("only due pending events are claimable", () => {
  const future = { ...mkEvent({ id: "o-2", idempotencyKey: "k-2" }), available_at: T(50) };
  const events = [mkEvent(), future, { ...mkEvent({ id: "o-3", idempotencyKey: "k-3" }), status: STATUS.SENT }];
  const c = claimable(events, { now: T(10) });
  eq(c.length, 1, "only the due pending event");
  eq(c[0].outbox_event_id, "o-1", "which one");
});

test("claimable respects a limit and orders by availability", () => {
  const events = [3, 1, 2].map((n) => ({ ...mkEvent({ id: `o-${n}`, idempotencyKey: `k-${n}` }), available_at: T(n) }));
  const c = claimable(events, { now: T(10), limit: 2 });
  eq(c.length, 2, "limit"); eq(c[0].outbox_event_id, "o-1", "oldest first");
});

test("expired leases are detected", () => {
  const e = transition(mkEvent(), "lease", { at: T(0), worker: "w", leaseSeconds: 30 });
  eq(expiredLeases([e], { now: T(10) }).length, 0, "not yet expired");
  eq(expiredLeases([e], { now: T(59) }).length, 1, "expired");
});

test("duplicate idempotency keys are detected", () => {
  assert(isDuplicate([mkEvent()], "k-1"), "duplicate");
  assert(!isDuplicate([mkEvent()], "k-other"), "not duplicate");
});

console.log("\nOutbox — invariants\n");

test("a healthy outbox has no invariant findings", () => {
  let e = transition(mkEvent(), "lease", { at: T(1), worker: "w" });
  let attempts = recordAttempt([], { eventId: "o-1", attemptNumber: 1, outcome: OUTCOME.SUCCESS, at: T(2) });
  e = transition(e, "success", { at: T(2) });
  eq(checkInvariants([e], attempts).length, 0, `findings: ${checkInvariants([e], attempts).join("; ")}`);
});

test("sent with no successful attempt is caught", () => {
  const e = { ...mkEvent(), status: STATUS.SENT, attempt_count: 1 };
  const attempts = recordAttempt([], { eventId: "o-1", attemptNumber: 1, outcome: OUTCOME.TRANSIENT_FAILURE, at: T(2) });
  assert(checkInvariants([e], attempts).some((f) => /unverifiable claim of delivery/.test(f)), "not caught");
});

test("attempt_count disagreeing with attempt rows is caught", () => {
  const e = { ...mkEvent(), attempt_count: 5 };
  assert(checkInvariants([e], []).some((f) => /disagrees/.test(f)), "not caught");
});

test("in_flight with no lease expiry is caught", () => {
  const e = { ...mkEvent(), status: STATUS.IN_FLIGHT, lease_expires_at: null, attempt_count: 0 };
  assert(checkInvariants([e], []).some((f) => /never be reclaimed/.test(f)), "not caught");
});

test("holding a lease while not in flight is caught", () => {
  const e = { ...mkEvent(), lease_owner: "w", attempt_count: 0 };
  assert(checkInvariants([e], []).some((f) => /holds a lease/.test(f)), "not caught");
});

test("an orphan attempt and a duplicate key are caught", () => {
  assert(checkInvariants([], recordAttempt([], { eventId: "ghost", attemptNumber: 1, outcome: OUTCOME.SUCCESS, at: T(1) }))
    .some((f) => /has no event/.test(f)), "orphan");
  const dup = [mkEvent(), mkEvent({ id: "o-2" })];
  assert(checkInvariants(dup, []).some((f) => /duplicate idempotency key/.test(f)), "duplicate key");
});

test("an unknown attempt outcome is refused", () => {
  throws(() => recordAttempt([], { eventId: "o-1", attemptNumber: 1, outcome: "maybe", at: T(1) }), /unknown attempt outcome/, "refused");
});

console.log("\nAudit — safe metadata (B1 / ADR-008)\n");

test("safe metadata of ids, counts and enums passes", () => {
  eq(checkSafeMetadata({ pool_id: "pool-x", entry_count: 3, settlement: "settled", ok: true }).length, 0, "should be safe");
});

test("every forbidden key is rejected", () => {
  for (const k of FORBIDDEN_KEYS) {
    const f = checkSafeMetadata({ [k]: "x" });
    assert(f.some((x) => x.id === "FORBIDDEN_KEY"), `key "${k}" was not rejected`);
  }
});

test("an email-shaped value is rejected whatever the key is called", () => {
  const f = checkSafeMetadata({ harmless_looking_field: "someone@example.invalid" });
  assert(f.some((x) => x.id === "EMAIL"), "the key name is not evidence; the value must be scanned");
});

test("every value pattern fires on its own example", () => {
  // These examples are deliberately leak-shaped, so two rules keep them out of the repo-wide PII
  // gate's findings without asking that gate for an exemption: the address uses an RFC-reserved
  // domain, and the PEM header is assembled at runtime rather than written down. A fixture that
  // needs no permission is better than a fixture with one.
  const pem = ["-".repeat(5), "BEGIN", " ", "RSA", " ", "PRIVATE", " ", "KEY", "-".repeat(5)].join("");
  const examples = {
    EMAIL: "a@b.test", JWT: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0",
    PHONE: "+55 (11) 98765-4321", PG_URI: "postgresql://host/db",
    PRIVATE_KEY: pem, LONG_FREE_TEXT: "x".repeat(250),
  };
  for (const p of VALUE_PATTERNS) {
    assert(examples[p.id], `no example for ${p.id}`);
    const f = checkSafeMetadata({ field: examples[p.id] });
    assert(f.some((x) => x.id === p.id), `${p.id} did not fire on its example`);
  }
});

test("every value pattern states what it detects", () => {
  for (const p of VALUE_PATTERNS) assert(p.why, `${p.id} has no rationale`);
});

test("nested objects and arrays are scanned", () => {
  assert(checkSafeMetadata({ outer: { inner: { email: "x" } } }).some((f) => /FORBIDDEN_KEY/.test(f.id)), "nested key");
  assert(checkSafeMetadata({ list: ["fine", "leak@example.invalid"] }).some((f) => f.id === "EMAIL"), "array value");
});

test("keys are matched exactly, not by substring", () => {
  // A substring check on "name" would reject these, which carry no personal data.
  eq(checkSafeMetadata({ aggregate_name: "pool_entry", event_name: "entry_created", table_name: "payments" }).length, 0,
    "exact-name matching keeps the check from producing noise on harmless structural keys");
});

test("a non-object metadata value is rejected", () => {
  assert(checkSafeMetadata("just a string").some((f) => f.id === "SHAPE"), "shape");
  assert(checkSafeMetadata(["a"]).some((f) => f.id === "SHAPE"), "array is not an object here");
});

console.log("\nAudit — event construction\n");

const baseEvent = {
  id: "a-1", occurredAt: T(0), actorRole: "service", action: "payment_recorded",
  aggregateType: "payment", aggregateId: "pay-1", source: "edge_function",
  correlationId: "corr-1", requestId: "req-1", safeMetadata: { amount_minor_known: true },
};

test("a valid event is built and hashed", () => {
  const e = buildAuditEvent(baseEvent);
  eq(e.action, "payment_recorded", "action");
  assert(/^[0-9a-f]{64}$/.test(e.event_hash), "hash");
});

test("construction REFUSES unsafe metadata rather than validating afterwards", () => {
  throws(() => buildAuditEvent({ ...baseEvent, safeMetadata: { payer_name: "Synthetic A" } }),
    /B1\/ADR-008/, "a validate-later design leaves the unsafe row constructible");
});

test("the refusal message says what to do instead", () => {
  const msg = throws(() => buildAuditEvent({ ...baseEvent, safeMetadata: { memo: "x" } }), /sidecar/, "refused");
  assert(/redactable/.test(msg), "the message must point at the sidecar, not just refuse");
});

test("an event with no aggregate is refused", () => {
  throws(() => buildAuditEvent({ ...baseEvent, aggregateId: null }), /aggregate_type and aggregate_id/, "refused");
});

test("an unknown actor role or source is refused", () => {
  throws(() => buildAuditEvent({ ...baseEvent, actorRole: "wizard" }), /actor_role must be/, "role");
  throws(() => buildAuditEvent({ ...baseEvent, source: "telepathy" }), /source must be/, "source");
});

test("operator and migration actions require a reason", () => {
  throws(() => buildAuditEvent({ ...baseEvent, actorRole: "operator" }), /requires a reason/, "operator");
  throws(() => buildAuditEvent({ ...baseEvent, actorRole: "migration" }), /requires a reason/, "migration");
  const ok = buildAuditEvent({ ...baseEvent, actorRole: "operator", reason: "corrected a mis-keyed amount" });
  eq(ok.reason, "corrected a mis-keyed amount", "reason kept");
});

test("a participant action does not require a reason", () => {
  const e = buildAuditEvent({ ...baseEvent, actorRole: "participant", source: "browser" });
  eq(e.reason, null, "no reason needed for an ordinary user action");
});

console.log("\nAudit — hash chain\n");

test("a chain of appended events verifies", () => {
  let chain = [];
  for (let i = 0; i < 5; i++) {
    chain = appendToChain(chain, { ...baseEvent, id: `a-${i}`, occurredAt: T(i) });
  }
  const v = verifyChain(chain);
  assert(v.valid, `chain invalid: ${JSON.stringify(v)}`);
  eq(v.length, 5, "length");
});

test("the first event's previous hash is null", () => {
  const chain = appendToChain([], baseEvent);
  eq(chain[0].previous_event_hash, null, "genesis");
});

test("a modified row breaks the chain and the break is located", () => {
  let chain = [];
  for (let i = 0; i < 4; i++) chain = appendToChain(chain, { ...baseEvent, id: `a-${i}`, occurredAt: T(i) });
  const tampered = chain.map((e, i) => i === 2 ? { ...e, action: "payment_reversed" } : e);
  const v = verifyChain(tampered);
  assert(!v.valid, "tampering must be detected");
  eq(v.brokenAt, 2, "the break must be located, since everything after it is unverifiable anyway");
  assert(/modified after insert/.test(v.reason), "reason");
});

test("a deleted row breaks the chain", () => {
  let chain = [];
  for (let i = 0; i < 4; i++) chain = appendToChain(chain, { ...baseEvent, id: `a-${i}`, occurredAt: T(i) });
  const v = verifyChain([chain[0], chain[2], chain[3]]);
  assert(!v.valid, "a removed row must be detected — otherwise the log can be silently pruned");
});

test("a reordered chain is detected", () => {
  let chain = [];
  for (let i = 0; i < 3; i++) chain = appendToChain(chain, { ...baseEvent, id: `a-${i}`, occurredAt: T(i) });
  assert(!verifyChain([chain[1], chain[0], chain[2]]).valid, "reordering destroys causality and must be caught");
});

test("hashing is stable under JSON key order", () => {
  const a = { ...baseEvent, safeMetadata: { x: 1, y: 2 } };
  const b = { ...baseEvent, safeMetadata: { y: 2, x: 1 } };
  eq(buildAuditEvent(a).event_hash, buildAuditEvent(b).event_hash,
    "a key-order difference between two writers must not break an otherwise intact chain");
});

test("hashing is sensitive to every field that matters", () => {
  const base = buildAuditEvent(baseEvent);
  for (const [k, v] of [["action", "other"], ["aggregate_id", "pay-2"], ["actor_role", "operator"],
                        ["occurred_at", T(9)], ["correlation_id", "corr-2"], ["source", "browser"]]) {
    const h = hashEvent({ ...base, [k]: v, reason: k === "actor_role" ? "r" : base.reason });
    assert(h !== base.event_hash, `changing ${k} must change the hash`);
  }
});

console.log("\nAudit — redactable sidecar and retention\n");

test("the sidecar can be redacted in place without touching the chain", () => {
  const chain = appendToChain([], baseEvent);
  const d = buildDetail({ id: "d-1", auditEventId: chain[0].audit_event_id, beforeSnapshot: { email: "x@example.invalid" }, createdAt: T(0) });
  const r = redactDetail(d, { at: T(5) });
  eq(r.before_snapshot, null, "payload nulled");
  eq(r.redacted_at, T(5), "redaction timestamped");
  assert(verifyChain(chain).valid, "the chained row must remain verifiable after the sidecar is redacted — this is the whole reason the sidecar exists");
});

test("retention is declared for both tables with a reason", () => {
  for (const [t, r] of Object.entries(RETENTION)) {
    assert(r.policy && r.why, `${t} retention incomplete`);
  }
  assert(/5Y/.test(RETENTION.audit_events.policy), "audit rows are financial evidence");
  assert(/90D/.test(RETENTION.audit_event_details.policy), "the payload sidecar is the PII-carrying part and must expire sooner");
});

test("every money-affecting and privilege action is in the audited list", () => {
  const actions = AUDITED_ACTIONS.map((a) => a.action);
  for (const required of ["payment_recorded", "payment_allocated", "payment_reversed", "prize_declared",
    "prize_paid", "identity_merged", "identity_merge_reversed", "result_recorded", "result_corrected",
    "admin_correction", "entry_created", "prediction_submitted"]) {
    assert(actions.includes(required), `unaudited action: ${required}`);
  }
  for (const a of AUDITED_ACTIONS) assert(a.aggregateType && a.why, `${a.action} incomplete`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ OUTBOX + AUDIT TESTS PASSED\n" : "✗ OUTBOX + AUDIT TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
