#!/usr/bin/env node
/**
 * Outbox state machine (Workstream T).
 *
 * WHY AN OUTBOX AT ALL
 * The platform sends participant receipts and admin notifications by email. Today that happens inline:
 * if the send fails, the notification is simply lost, and nothing records that it was owed. An outbox
 * makes the intent to notify a DURABLE ROW written in the same transaction as the business change, so a
 * delivery failure becomes a retry rather than a silent loss.
 *
 * The invariant that makes it worth the complexity:
 *   a business change and its notification intent commit together, or neither commits.
 * Anything weaker and the two can disagree — a payment recorded with no receipt owed, or a receipt sent
 * for a payment that rolled back.
 *
 * STATE MACHINE — transitions are DATA, not code branches. An illegal transition is refused by table
 * lookup, so adding a state cannot silently create a path nobody reviewed.
 *
 *   pending ──lease──▶ in_flight ──success──▶ sent          (terminal)
 *                          │
 *                          ├─transient_failure─▶ pending    (backoff, attempt_count++)
 *                          ├─permanent_failure─▶ dead       (terminal, needs triage)
 *                          └─lease_expired─────▶ pending    (a crashed worker must not strand the row)
 *   pending ──poison──▶ dead
 *   dead ──replay──▶ pending                                (operator-initiated only)
 *
 * Everything here is pure. No email is sent, no database is touched.
 */

import { pathToFileURL } from "node:url";

export const STATUS = { PENDING: "pending", IN_FLIGHT: "in_flight", SENT: "sent", DEAD: "dead" };
export const OUTCOME = { SUCCESS: "success", TRANSIENT_FAILURE: "transient_failure", PERMANENT_FAILURE: "permanent_failure" };
export const TERMINAL = new Set([STATUS.SENT]);

/**
 * Legal transitions. `dead` is deliberately NOT terminal: a dead event is a LOST notification, and the
 * only way to make it not lost is to replay it. Making it terminal would mean the recovery path required
 * hand-editing rows.
 */
export const TRANSITIONS = [
  { from: STATUS.PENDING, event: "lease", to: STATUS.IN_FLIGHT, why: "a worker claimed the event" },
  { from: STATUS.IN_FLIGHT, event: "success", to: STATUS.SENT, why: "the channel confirmed delivery" },
  { from: STATUS.IN_FLIGHT, event: "transient_failure", to: STATUS.PENDING, why: "retryable; goes back to the queue with backoff" },
  { from: STATUS.IN_FLIGHT, event: "permanent_failure", to: STATUS.DEAD, why: "not retryable; needs a human" },
  { from: STATUS.IN_FLIGHT, event: "lease_expired", to: STATUS.PENDING, why: "a crashed worker must not strand the row forever" },
  { from: STATUS.PENDING, event: "poison", to: STATUS.DEAD, why: "the payload cannot be processed at all" },
  { from: STATUS.DEAD, event: "replay", to: STATUS.PENDING, why: "operator-initiated recovery of a lost notification" },
];

export const MAX_ATTEMPTS = 6;
/** Exponential backoff with a cap. Deterministic; jitter is applied by the caller if it wants it. */
export function backoffSeconds(attemptCount) {
  const base = Math.min(2 ** Math.max(0, attemptCount), 3600);
  return base;
}

export class IllegalTransition extends Error {
  constructor(from, event) {
    super(`illegal outbox transition: ${from} --${event}--> (no such transition)`);
    this.from = from; this.event = event;
  }
}

/**
 * Event envelope. Every field exists for a reason a failure taught someone:
 *   idempotency_key   the channel may accept a send twice; the key is what stops a duplicate receipt
 *   correlation_id    ties the notification to the business action and its audit event
 *   payload           the message content, retained only as long as it is useful (90 days)
 *   available_at      when a retry may next be attempted (backoff)
 *   lease_owner/expires_at  who is working it, and when their claim lapses
 */
export function createEvent({ id, channel, eventType, payload, idempotencyKey, correlationId, at }) {
  if (!id) throw new Error("outbox event needs an id");
  if (!channel || !eventType) throw new Error("outbox event needs a channel and an event type");
  if (!idempotencyKey) {
    throw new Error("outbox event needs an idempotency key — without one, a channel that accepts the same " +
      "send twice produces a duplicate participant receipt, and the participant cannot tell which is real");
  }
  return Object.freeze({
    outbox_event_id: id,
    channel, event_type: eventType,
    payload: payload ?? null,
    idempotency_key: idempotencyKey,
    correlation_id: correlationId ?? null,
    status: STATUS.PENDING,
    attempt_count: 0,
    available_at: at,
    lease_owner: null,
    lease_expires_at: null,
    dead_at: null,
    created_at: at,
  });
}

/** Apply a transition. Returns a NEW event; never mutates. */
export function transition(event, action, { at, worker, leaseSeconds = 60, reason } = {}) {
  const rule = TRANSITIONS.find((t) => t.from === event.status && t.event === action);
  if (!rule) throw new IllegalTransition(event.status, action);

  const next = { ...event, status: rule.to };
  switch (action) {
    case "lease":
      next.lease_owner = worker ?? null;
      next.lease_expires_at = new Date(new Date(at).getTime() + leaseSeconds * 1000).toISOString();
      next.attempt_count = event.attempt_count + 1;
      break;
    case "success":
      next.lease_owner = null; next.lease_expires_at = null;
      break;
    case "transient_failure": {
      next.lease_owner = null; next.lease_expires_at = null;
      next.available_at = new Date(new Date(at).getTime() + backoffSeconds(event.attempt_count) * 1000).toISOString();
      // Attempt exhaustion is a PERMANENT condition, so it lands in dead rather than looping forever.
      if (next.attempt_count >= MAX_ATTEMPTS) { next.status = STATUS.DEAD; next.dead_at = at; next.dead_reason = "attempts exhausted"; }
      break;
    }
    case "lease_expired":
      next.lease_owner = null; next.lease_expires_at = null;
      // available_at is NOT pushed out here: a crashed worker is not the event's fault, and delaying a
      // retry because the infrastructure died would punish the wrong party.
      break;
    case "permanent_failure":
    case "poison":
      next.lease_owner = null; next.lease_expires_at = null;
      next.dead_at = at; next.dead_reason = reason ?? action;
      break;
    case "replay":
      if (!reason) throw new Error("replay requires a reason — an unexplained replay cannot be reviewed, and replay can re-send a real email");
      next.dead_at = null; next.dead_reason = null;
      next.available_at = at;
      // attempt_count is deliberately NOT reset: the history of how hard this fought to send is the
      // most useful thing about a replayed event, and resetting it hides a chronic failure.
      next.replayed_at = at; next.replay_reason = reason;
      break;
  }
  return Object.freeze(next);
}

/** Record an attempt. Attempts are append-only evidence; the event's counter must agree with them. */
export function recordAttempt(attempts, { eventId, attemptNumber, outcome, at, detail }) {
  if (!Object.values(OUTCOME).includes(outcome)) throw new Error(`unknown attempt outcome ${outcome}`);
  return [...attempts, Object.freeze({
    outbox_delivery_attempt_id: `${eventId}#${attemptNumber}`,
    outbox_event_id: eventId, attempt_number: attemptNumber, outcome, occurred_at: at,
    detail: detail ?? null,
  })];
}

/** Claimable events: pending, due, and not already leased by a live worker. */
export function claimable(events, { now, limit = 10 }) {
  return events
    .filter((e) => e.status === STATUS.PENDING)
    .filter((e) => !e.available_at || new Date(e.available_at).getTime() <= new Date(now).getTime())
    .sort((a, b) => String(a.available_at).localeCompare(String(b.available_at)))
    .slice(0, limit);
}

/** Leases that have lapsed and must be returned to the queue. */
export function expiredLeases(events, { now }) {
  return events.filter((e) => e.status === STATUS.IN_FLIGHT && e.lease_expires_at &&
    new Date(e.lease_expires_at).getTime() <= new Date(now).getTime());
}

/**
 * Dedupe on idempotency key.
 *
 * Enforced by a UNIQUE INDEX in the target model, not only here: an application-level check has a race
 * between the SELECT and the INSERT, and two concurrent requests would both pass it. The database
 * constraint is the actual guarantee; this function is what turns the resulting error into a decision.
 */
export function isDuplicate(events, idempotencyKey) {
  return events.some((e) => e.idempotency_key === idempotencyKey);
}

/** Invariants over a whole outbox. Mirrors DQ-OB-01..04, kept here so a worker can self-check. */
export function checkInvariants(events, attempts) {
  const findings = [];
  const byId = new Map(events.map((e) => [e.outbox_event_id, e]));
  for (const a of attempts) if (!byId.has(a.outbox_event_id)) findings.push(`attempt ${a.outbox_delivery_attempt_id} has no event`);
  for (const e of events) {
    const mine = attempts.filter((a) => a.outbox_event_id === e.outbox_event_id);
    if (mine.length !== e.attempt_count) findings.push(`${e.outbox_event_id}: attempt_count ${e.attempt_count} disagrees with ${mine.length} attempt row(s)`);
    if (e.status === STATUS.SENT && !mine.some((a) => a.outcome === OUTCOME.SUCCESS)) {
      findings.push(`${e.outbox_event_id}: claims sent with no successful attempt — an unverifiable claim of delivery`);
    }
    if (e.status === STATUS.DEAD && !e.dead_at) findings.push(`${e.outbox_event_id}: dead without dead_at`);
    if (e.status === STATUS.IN_FLIGHT && !e.lease_expires_at) findings.push(`${e.outbox_event_id}: in flight with no lease expiry — it can never be reclaimed`);
    if (e.status !== STATUS.IN_FLIGHT && e.lease_owner) findings.push(`${e.outbox_event_id}: holds a lease while not in flight`);
  }
  const keys = events.map((e) => e.idempotency_key);
  if (new Set(keys).size !== keys.length) findings.push("duplicate idempotency key present");
  return findings;
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  console.log("\nOutbox state machine\n");
  for (const t of TRANSITIONS) console.log(`  ${t.from.padEnd(10)} --${t.event.padEnd(18)}--> ${t.to.padEnd(10)}  ${t.why}`);
  console.log(`\n  max attempts: ${MAX_ATTEMPTS}`);
  console.log(`  backoff (s): ${[0, 1, 2, 3, 4, 5, 6].map((n) => backoffSeconds(n)).join(", ")}\n`);
}
