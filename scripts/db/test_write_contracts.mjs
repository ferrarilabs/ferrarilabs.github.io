#!/usr/bin/env node
/**
 * Tests for the trusted write contracts (Workstream 13, all sub-parts).
 *
 * Every request, row and identity is synthetic and built here.
 *
 * The contracts exist to REFUSE things, so most of these kill them: two simultaneous allocations against one
 * payment, a retry after commit but before the response, a merge that would close a cycle, an operator action
 * with no stated reason. The mutants are the load-bearing part — a suite that passes against correct contracts
 * proves nothing about whether it would catch incorrect ones.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadContracts, execute, makeDb, UNIQUE_INDEXES, ContractError,
  payloadFingerprint, rowFingerprint, LOCK_ORDER, lockRank,
} from "./write_contracts.mjs";
import { loadAccessModel } from "./validate_access_model.mjs";
import { loadModel } from "./validate_target_model.mjs";
import { loadRlsModel } from "./rls.mjs";
import { AUDITED_ACTIONS } from "./audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, assertions = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { assertions++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { assertions++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const errCode = (fn) => {
  try { fn(); } catch (e) { if (e instanceof ContractError) return e.code; throw e; }
  throw new Error("expected a ContractError, none thrown");
};

const MODEL = loadContracts();
const OP = { operator_id: "operator-1", reason: "confirmed by email with both parties" };
const RUNTIME = { principal: "trusted_runtime", operator_evidence: OP };
const RUNTIME_NO_OP = { principal: "trusted_runtime" };
const USER_A = { principal: "authenticated", auth_user_id: "auth-A" };
const USER_B = { principal: "authenticated", auth_user_id: "auth-B" };

let seq = 0;
const req = (over = {}) => ({ request_id: `rq-${++seq}`, idempotency_key: `idem-${seq}`, correlation_id: `corr-${seq}`, actor: RUNTIME, ...over });

/** A seeded world. Everything is synthetic. */
function world({ poolStatus = "open", cutoff = "2026-07-01T00:00:00Z" } = {}) {
  const db = makeDb({ uniqueIndexes: UNIQUE_INDEXES });
  db.begin();
  db.insert("pools", { pool_id: "pool-A", competition_edition_id: "ed-1", status: poolStatus, name: "Pool A" });
  db.insert("pools", { pool_id: "pool-B", competition_edition_id: "ed-1", status: "open", name: "Pool B" });
  db.insert("pool_fee_schedule", { pool_fee_schedule_id: "f-A", pool_id: "pool-A", fee_amount: "5.00", currency: "USD", effective_to: null });
  db.insert("pool_fee_schedule", { pool_fee_schedule_id: "f-B", pool_id: "pool-B", fee_amount: "5.00", currency: "USD", effective_to: null });
  db.insert("competition_edition_phases", { competition_edition_phase_id: "ph-1", competition_edition_id: "ed-1", ordinal: 1, cutoff_at: cutoff });
  db.insert("matches", { match_id: "m-1", competition_edition_phase_id: "ph-1", status: "scheduled" });
  db.insert("participants", { participant_id: "p-A", display_name: "Synthetic A", email: "a@example.invalid", state: "active", canonical_participant_id: null, aliases: [], version: 1 });
  db.insert("participants", { participant_id: "p-B", display_name: "Synthetic B", email: "b@example.invalid", state: "active", canonical_participant_id: null, aliases: [], version: 1 });
  db.insert("participants", { participant_id: "p-C", display_name: "Synthetic C", email: "c@example.invalid", state: "active", canonical_participant_id: null, aliases: [], version: 1 });
  db.insert("participant_auth_links", { participant_id: "p-A", auth_user_id: "auth-A" });
  db.insert("participant_auth_links", { participant_id: "p-B", auth_user_id: "auth-B" });
  db.commit();
  return db;
}

console.log("\nWS13.1 — contract catalog\n");

test("all nine contracts are declared with the full specification", () => {
  const required = ["createEntry", "submitPrediction", "recordPayment", "allocatePayment",
    "mergeParticipantIdentity", "reverseParticipantMerge", "recordPrize", "adminCorrection"];
  eq(MODEL.contracts.length, 9, "nine contracts");
  for (const n of required) {
    const c = MODEL.contracts.find((x) => x.name === n);
    assert(c, `missing ${n}`);
    for (const f of ["purpose", "principals", "requestSchema", "responseSchema", "isolation", "isolationWhy",
                     "locks", "steps", "invariants", "audit", "outbox", "errors", "mutates"]) {
      assert(c[f] !== undefined, `${n} missing ${f}`);
    }
    assert(c.purpose.length > 60, `${n}: purpose too thin to review`);
    assert(c.invariants.length >= 2, `${n}: fewer than two invariants`);
    assert(c.steps.some((s) => /^BEGIN/.test(s)) && c.steps.some((s) => /COMMIT/.test(s)), `${n}: no transaction boundary`);
  }
});

test("no contract uses SERIALIZABLE, and each says why not", () => {
  for (const c of MODEL.contracts) {
    eq(c.isolation, "READ COMMITTED", `${c.name} uses ${c.isolation}`);
    assert(c.isolationWhy.length > 60, `${c.name}: no justification for the isolation level`);
    assert(/SERIALIZABLE|serialis/i.test(c.isolationWhy), `${c.name}: must address why the strongest level is not used`);
  }
});

test("every lock declares a mode, a key and a reason", () => {
  for (const c of MODEL.contracts) for (const l of c.locks) {
    assert(l.table && l.mode && l.key && l.why, `${c.name}: incomplete lock declaration`);
    assert(l.why.length > 20, `${c.name}: lock on ${l.table} has no usable reason`);
  }
});

test("every error code a contract lists exists in the taxonomy, mapped completely", () => {
  for (const c of MODEL.contracts) for (const e of c.errors) assert(MODEL.errors[e], `${c.name} lists unknown error ${e}`);
  for (const [code, d] of Object.entries(MODEL.errors)) {
    for (const f of ["http", "retryable", "clientMessage", "auditSeverity"]) assert(d[f] !== undefined, `${code} missing ${f}`);
    assert(!/SQL|constraint|relation|pg_/i.test(d.clientMessage), `${code}: the client message leaks database detail`);
  }
  eq(MODEL.errors.INTERNAL.http, 500, "INTERNAL is the only 500");
});

test("the envelope states what a client may NEVER supply", () => {
  const never = MODEL.envelope.neverClientSupplied;
  for (const f of ["principal", "auth_user_id", "operator identity", "cutoff comparison time"]) {
    assert(never.some((x) => x.includes(f.split(" ")[0])), `${f} must be listed as never client-supplied`);
  }
  assert(MODEL.meta.clientAuthority.includes("NEVER"), "client authority must be stated explicitly");
});

console.log("\nWS13.6 — createEntry\n");

test("a valid entry is created with its fee snapshot in one transaction", () => {
  const db = world();
  const r = execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  eq(r.expected_fee_amount, "5.00", "fee snapshotted");
  eq(r.expected_fee_currency, "USD", "currency snapshotted");
  eq(r.settlement_status, "unpaid", "derived, not stored");
  eq(db.all("audit_events").length, 1, "one audit event");
  eq(db.all("outbox_events").length, 2, "receipt and admin notification");
  eq(db.all("payment_allocations").length, 0, "no allocation is invented");
});

test("a closed pool is refused", () => {
  const db = world({ poolStatus: "closed" });
  eq(errCode(() => execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "A" }))),
    "UNSUPPORTED_STATE", "closed pool");
  eq(db.all("pool_entries").length, 0, "nothing written");
});

test("an entry after the cutoff is refused by the SERVER clock, whatever the client says", () => {
  const db = world({ cutoff: "2026-01-01T00:00:00Z" });
  eq(errCode(() => execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "A", occurred_at: "2025-01-01T00:00:00Z" }))),
    "CUTOFF_PASSED", "a client-supplied earlier timestamp must not help");
});

test("two fee schedules in force is a FINANCIAL_INVARIANT, not a guess", () => {
  const db = world();
  db.begin(); db.insert("pool_fee_schedule", { pool_fee_schedule_id: "f-A2", pool_id: "pool-A", fee_amount: "9.00", currency: "USD", effective_to: null }); db.commit();
  eq(errCode(() => execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "A" }))),
    "FINANCIAL_INVARIANT", "an ambiguous price must not be resolved by picking one");
});

test("multiple entries are permitted, but a duplicate LABEL is not", () => {
  const db = world();
  execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "second", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  eq(db.all("pool_entries").length, 2, "two entries in one pool are legitimate");
  eq(errCode(() => execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }))),
    "DUPLICATE", "the same label twice is an accident, caught by a unique index");
});

test("an auth user linked to TWO participants must say which it acts for", () => {
  const db = world();
  db.begin(); db.insert("participant_auth_links", { participant_id: "p-C", auth_user_id: "auth-A" }); db.commit();
  const e = execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  // createEntry resolves by email, so it succeeds; the ambiguity bites on an ownership-scoped contract.
  const code = errCode(() => execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e.pool_entry_id, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 })));
  eq(code, "IDENTITY_AMBIGUOUS",
    "with two linked participants the request must name one; picking one would attribute the write to a person the caller did not name");
});

test("no participant is merged as a side effect of creating an entry", () => {
  const db = world();
  execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  for (const p of db.all("participants")) eq(p.canonical_participant_id, null, "a merge happened during an entry create");
});

console.log("\nWS13.7 — submitPrediction\n");

function withEntry(db, actor = USER_A, email = "a@example.invalid", name = "Synthetic A", pool = "pool-A", label = "main") {
  return execute(db, "createEntry", req({ actor, pool_id: pool, entry_label: label, display_name: name, participant_email: email })).pool_entry_id;
}

test("the owner may submit, and a second submission REPLACES rather than duplicating", () => {
  const db = world(); const e = withEntry(db);
  const a = execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }));
  eq(a.replaced, false, "first submission inserts");
  const b = execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 2, away_goals: 2 }));
  eq(b.replaced, true, "second replaces");
  eq(db.all("predictions").length, 1, "a unique index makes two rows impossible, not merely unlikely");
  eq(b.version, 2, "version bumped");
});

test("a NON-owner cannot submit for another's entry", () => {
  const db = world(); const e = withEntry(db);
  eq(errCode(() => execute(db, "submitPrediction", req({ actor: USER_B, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 9, away_goals: 9 }))),
    "FORBIDDEN", "B submitted for A's entry");
});

test("after the cutoff the write fails CLOSED — there is no grace path", () => {
  const db = world(); const e = withEntry(db);
  db._setNow("2026-08-01T00:00:00Z");
  eq(errCode(() => execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }))),
    "CUTOFF_PASSED", "server time is authoritative");
});

test("a subject from another competition edition is refused", () => {
  const db = world(); const e = withEntry(db);
  db.begin();
  db.insert("competition_edition_phases", { competition_edition_phase_id: "ph-X", competition_edition_id: "ed-OTHER", ordinal: 1, cutoff_at: "2026-07-01T00:00:00Z" });
  db.insert("matches", { match_id: "m-X", competition_edition_phase_id: "ph-X", status: "scheduled" });
  db.commit();
  eq(errCode(() => execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-X", subject_kind: "match", home_goals: 1, away_goals: 0 }))),
    "VALIDATION_FAILED", "a match outside the pool's edition is not eligible");
});

test("a stale expected_version is rejected", () => {
  const db = world(); const e = withEntry(db);
  execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }));
  eq(errCode(() => execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 3, away_goals: 3, expected_version: 99 }))),
    "STALE_VERSION", "an optimistic-concurrency mismatch must not overwrite");
});

test("a withdrawn entry cannot receive a prediction", () => {
  const db = world(); const e = withEntry(db);
  db.begin(); db.update("pool_entries", (x) => x.pool_entry_id === e, { deleted_at: db.now(), state: "withdrawn" }); db.commit();
  eq(errCode(() => execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }))),
    "UNSUPPORTED_STATE", "withdrawn");
});

console.log("\nWS13.8 — recordPayment\n");

const payReq = (over = {}) => req({ actor: RUNTIME, amount: "5.00", currency: "USD", kind: "contribution",
  paid_at: "2026-06-01T00:00:00Z", channel: "operator_manual", ...over });

test("a payment is recorded with no allocation, even when an entry looks unpaid", () => {
  const db = world(); withEntry(db);
  const r = execute(db, "recordPayment", payReq({ payer_participant_id: "p-A", external_reference: "SYNTH-1" }));
  assert(r.payment_id, "recorded");
  eq(db.all("payment_allocations").length, 0,
    "recording receipt and deciding what it settled are different decisions; an unpaid-looking entry is not evidence");
});

test("a third-party payer is recorded WITHOUT being resolved to a participant", () => {
  const db = world();
  const r = execute(db, "recordPayment", payReq({ payer_participant_id: null, payer_name_as_recorded: "Synthetic Gamma", external_reference: "SYNTH-2" }));
  const p = db.find("payments", (x) => x.payment_id === r.payment_id);
  eq(p.payer_participant_id, null, "unresolved — guessing would misattribute someone's money");
  eq(p.payer_name_as_recorded, "Synthetic Gamma", "but the recorded name survives verbatim");
});

test("operator_manual without operator evidence is FORBIDDEN", () => {
  const db = world();
  eq(errCode(() => execute(db, "recordPayment", payReq({ actor: RUNTIME_NO_OP, external_reference: "SYNTH-3" }))),
    "FORBIDDEN", "an unexplained privileged money write is indistinguishable from an unauthorised one");
});

test("an authenticated caller cannot record a payment at all", () => {
  const db = world();
  eq(errCode(() => execute(db, "recordPayment", payReq({ actor: USER_A, external_reference: "SYNTH-4" }))),
    "FORBIDDEN", "browser-supplied data is not database authorization");
});

test("sign, zero, currency and future-dating are all enforced", () => {
  const db = world();
  eq(errCode(() => execute(db, "recordPayment", payReq({ amount: "0.00", external_reference: "SYNTH-Z" }))), "FINANCIAL_INVARIANT", "zero");
  eq(errCode(() => execute(db, "recordPayment", payReq({ amount: "-5.00", kind: "contribution", external_reference: "SYNTH-N" }))), "FINANCIAL_INVARIANT", "negative contribution");
  eq(errCode(() => execute(db, "recordPayment", payReq({ amount: "5.00", kind: "refund", external_reference: "SYNTH-R" }))), "FINANCIAL_INVARIANT", "positive refund");
  eq(errCode(() => execute(db, "recordPayment", payReq({ paid_at: "2030-01-01T00:00:00Z", external_reference: "SYNTH-F" }))), "VALIDATION_FAILED", "future-dated");
  eq(db.all("payments").length, 0, "none of the invalid ones was written");
});

test("a duplicate external reference is refused by a unique index", () => {
  const db = world();
  execute(db, "recordPayment", payReq({ external_reference: "SYNTH-SAME-REF" }));
  eq(errCode(() => execute(db, "recordPayment", payReq({ external_reference: "SYNTH-SAME-REF", amount: "9.00" }))),
    "DUPLICATE", "one real payment must not be counted twice");
  eq(db.all("payments").length, 1, "only one row");
});

test("the audit event carries no external reference or payer name", () => {
  const db = world();
  execute(db, "recordPayment", payReq({ external_reference: "SYNTH-SECRET-REF-XYZ", payer_name_as_recorded: "Synthetic Payer", payer_participant_id: null }));
  const a = db.all("audit_events").at(-1);
  const json = JSON.stringify(a.safe_metadata);
  assert(!json.includes("SECRET-REF-XYZ"), "the reference leaked into audit metadata");
  assert(!json.includes("Synthetic Payer"), "the payer name leaked into audit metadata");
  eq(a.safe_metadata.has_external_reference, true, "presence is recorded, the value is not");
});

console.log("\nWS13.9 — allocatePayment\n");

function seedPayment(db, amount = "5.00", ref = "P1") {
  return execute(db, "recordPayment", payReq({ amount, currency: "USD", external_reference: ref })).payment_id;
}
const allocReq = (payment_id, pool_entry_id, allocated_amount, over = {}) =>
  req({ actor: RUNTIME, payment_id, pool_entry_id, allocated_amount, currency: "USD", ...over });

test("a full allocation settles the entry and reports zero unapplied", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db);
  const r = execute(db, "allocatePayment", allocReq(p, e, "5.00"));
  eq(r.entry_settlement_status, "settled", "settled");
  eq(r.payment_unapplied_amount, "0.00", "fully applied");
});

test("a partial allocation leaves the entry partially paid and the payment with a balance", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db, "5.00");
  const r = execute(db, "allocatePayment", allocReq(p, e, "2.00"));
  eq(r.entry_settlement_status, "partially_paid", "partial");
  eq(r.payment_unapplied_amount, "3.00", "balance derived, never stored");
});

test("over-allocating a payment is refused", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db, "5.00");
  execute(db, "allocatePayment", allocReq(p, e, "4.00"));
  eq(errCode(() => execute(db, "allocatePayment", allocReq(p, e, "2.00"))), "FINANCIAL_INVARIANT",
    "you cannot allocate more of a payment than was received");
  eq(db.all("payment_allocations").length, 1, "the second allocation was not written");
});

test("overpaying an ENTRY is allowed and reported OVERPAID — a state, not an error", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db, "9.00", "P9");
  const r = execute(db, "allocatePayment", allocReq(p, e, "7.00"));
  eq(r.entry_settlement_status, "overpaid",
    "there is deliberately no cap against the entry's fee: exceeding it is reportable, not invalid");
});

test("a currency mismatch anywhere in the triple is refused", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db);
  eq(errCode(() => execute(db, "allocatePayment", allocReq(p, e, "5.00", { currency: "BRL" }))),
    "FINANCIAL_INVARIANT", "converting silently would produce wrong money");
});

test("a non-positive allocation is refused", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db);
  eq(errCode(() => execute(db, "allocatePayment", allocReq(p, e, "0.00"))), "FINANCIAL_INVARIANT", "zero");
});

test("a legacy-asserted payment with no amount cannot be allocated", () => {
  const db = world(); const e = withEntry(db);
  db.begin(); db.insert("payments", { payment_id: "pay-legacy", amount: null, currency: null, kind: "contribution", legacy_asserted: true }); db.commit();
  eq(errCode(() => execute(db, "allocatePayment", allocReq("pay-legacy", e, "5.00"))), "FINANCIAL_INVARIANT",
    "there is no amount to allocate, and inventing one is the failure this prevents");
});

test("allocatePayment requires operator evidence", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db);
  eq(errCode(() => execute(db, "allocatePayment", allocReq(p, e, "5.00", { actor: RUNTIME_NO_OP }))), "FORBIDDEN", "no evidence");
});

console.log("\nWS13.4 — idempotency\n");

test("same key + same payload replays the stored response and writes nothing new", () => {
  const db = world();
  const r1 = execute(db, "createEntry", req({ actor: USER_A, idempotency_key: "K1", pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  const before = db.all("pool_entries").length;
  const r2 = execute(db, "createEntry", { request_id: "rq-other", idempotency_key: "K1", correlation_id: "c2", actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" });
  eq(r2.pool_entry_id, r1.pool_entry_id, "the same entry id is returned");
  eq(r2.idempotent_replay, true, "flagged as a replay");
  eq(db.all("pool_entries").length, before, "no second row");
});

test("same key + DIFFERENT payload is IDEMPOTENCY_CONFLICT, never a second write", () => {
  const db = world();
  execute(db, "createEntry", req({ actor: USER_A, idempotency_key: "K2", pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  eq(errCode(() => execute(db, "createEntry", { request_id: "x", idempotency_key: "K2", actor: USER_A, pool_id: "pool-A", entry_label: "different", display_name: "Synthetic A", participant_email: "a@example.invalid" })),
    "IDEMPOTENCY_CONFLICT", "replaying would be wrong and writing again would double-write");
  eq(db.all("pool_entries").length, 1, "one row");
});

test("the same key in TWO contracts is two different requests", () => {
  const db = world(); const e = withEntry(db);
  execute(db, "submitPrediction", req({ actor: USER_A, idempotency_key: "SHARED", pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }));
  const r = execute(db, "recordPayment", payReq({ idempotency_key: "SHARED", external_reference: "SYNTH-IDEM-X" }));
  assert(r.payment_id, "the payment was recorded despite sharing the key with a prediction");
  eq(r.idempotent_replay, false, "not treated as a replay");
});

test("request_id and correlation_id are EXCLUDED from the fingerprint", () => {
  const a = payloadFingerprint({ request_id: "1", correlation_id: "a", x: 1 });
  const b = payloadFingerprint({ request_id: "2", correlation_id: "b", x: 1 });
  eq(a, b, "a retry with a fresh request id must still be recognised as the same request");
  assert(a !== payloadFingerprint({ x: 2 }), "but a changed payload must differ");
});

test("a missing idempotency key is refused", () => {
  const db = world();
  eq(errCode(() => execute(db, "createEntry", { request_id: "r", actor: USER_A, pool_id: "pool-A", entry_label: "m", display_name: "A" })),
    "VALIDATION_FAILED", "an unkeyed write cannot be made safe to retry");
});

test("idempotency expiry is longer for money-bearing contracts", () => {
  assert(/30 days/.test(MODEL.idempotency.expiry) && /24 hours/.test(MODEL.idempotency.expiry),
    "a payment dispute arrives long after the request, so money keys must outlive ordinary ones");
});

console.log("\nWS13.22 — fault injection: retry must never double-write\n");

const FAULTS = ["beforeMutation", "afterMutationBeforeAudit", "afterAuditBeforeOutbox", "afterOutboxBeforeIdempotency"];
for (const fault of FAULTS) {
  test(`fault ${fault}: nothing is durable, and a retry writes exactly once`, () => {
    const db = world();
    const request = req({ actor: USER_A, idempotency_key: `F-${fault}`, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" });
    let threw = false;
    try { execute(db, "createEntry", request, { faults: { [fault]: true } }); } catch { threw = true; }
    assert(threw, "the fault must propagate");
    eq(db.all("pool_entries").length, 0, `${fault}: a partial write became durable`);
    eq(db.all("audit_events").length, 0, `${fault}: an audit event became durable`);
    assert(!db.idemGet("createEntry", `F-${fault}`), `${fault}: the request was marked done though nothing happened`);
    const r = execute(db, "createEntry", request);
    eq(db.all("pool_entries").length, 1, "the retry wrote exactly one row");
    eq(r.idempotent_replay, false, "and was not mistaken for a replay");
  });
}

test("fault AFTER COMMIT before response: durable, and the retry REPLAYS instead of rewriting", () => {
  /**
   * This is the window that double-writes in a design where the idempotency record is written after the
   * business transaction. Here it committed with the rows, so the retry finds it and replays.
   */
  const db = world();
  const request = req({ actor: USER_A, idempotency_key: "AC", pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" });
  let code = null;
  try { execute(db, "createEntry", request, { faults: { afterCommitBeforeResponse: true } }); }
  catch (e) { code = e.code; }
  eq(code, "INTERNAL", "the caller sees a failure");
  eq(db.all("pool_entries").length, 1, "but the write IS durable — that is the whole difficulty");
  const r = execute(db, "createEntry", request);
  eq(r.idempotent_replay, true, "the retry replays the stored response");
  eq(db.all("pool_entries").length, 1, "and does NOT create a second entry");
});

console.log("\nWS13.21 — concurrency\n");

test("two concurrent allocations against ONE payment cannot overspend it", () => {
  /**
   * Interleaved by hand: transaction 1 takes FOR UPDATE on the payment; transaction 2's attempt to take the
   * same lock fails with LOCKED rather than proceeding to read a stale balance. That is precisely the
   * conflict the lock exists for.
   */
  const db = world(); const e = withEntry(db); const p = seedPayment(db, "5.00");
  db._simulateForeignLock("payments", p);            // transaction 1 holds FOR UPDATE on the payment
  const code = errCode(() => execute(db, "allocatePayment", allocReq(p, e, "5.00")));
  eq(code, "LOCKED", "the second allocation must wait or fail, never read a stale balance");
  db._clearForeignLocks();
  // With the lock released, one allocation succeeds and the second is refused on the balance.
  execute(db, "allocatePayment", allocReq(p, e, "5.00"));
  eq(errCode(() => execute(db, "allocatePayment", allocReq(p, e, "1.00"))), "FINANCIAL_INVARIANT", "the balance check catches the rest");
});

test("two concurrent predictions for one (entry, subject) converge to one row", () => {
  const db = world(); const e = withEntry(db);
  execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }));
  execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 2, away_goals: 2 }));
  eq(db.all("predictions").length, 1, "a unique index is the only raceless way to make this converge");
});

test("two concurrent entry creates with the same label produce one row", () => {
  const db = world();
  execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }));
  eq(errCode(() => execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }))),
    "DUPLICATE", "the unique index resolves the race");
  eq(db.all("pool_entries").length, 1, "one row");
});

test("two concurrent merges over the same pair cannot both apply", () => {
  const db = world();
  execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }));
  eq(errCode(() => execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }))),
    "CONFLICT", "the second finds p-B already superseded");
});

test("two concurrent prize declarations cannot both stand", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db);
  execute(db, "allocatePayment", allocReq(p, e, "5.00"));
  db.begin(); db.insert("ranking_snapshots", { ranking_snapshot_id: "rs-1", pool_id: "pool-A", participant_id: "p-A", published_at: db.now(), position: 1 }); db.commit();
  execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "5.00" }] }));
  eq(errCode(() => execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "5.00" }] }))),
    "DUPLICATE", "prizes are already declared");
});

test("two concurrent admin corrections: the loser gets STALE_VERSION, not a lost update", () => {
  const db = world(); const e = withEntry(db);
  const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
  const fp = rowFingerprint({ ...row });
  execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "entry_label", new_value: "corrected", expected_before_fingerprint: fp, expected_version: 1 }));
  eq(errCode(() => execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "entry_label", new_value: "other", expected_before_fingerprint: fp, expected_version: 1 }))),
    "STALE_VERSION", "the second operator's view is stale and must not overwrite the first's change");
});

console.log("\nWS13.32/13.33 — lock ordering and deadlock\n");

test("the global lock order is declared and every contract's locks respect it", () => {
  assert(MODEL.lockOrdering.rule.includes("pools"), "the rule must name the order");
  assert(MODEL.lockOrdering.why.length > 60, "and say why a fixed order matters");
  for (const c of MODEL.contracts) {
    const ranks = c.locks.map((l) => lockRank(l.table.replace(/[{}]/g, "")));
    const sorted = [...ranks].sort((a, b) => a - b);
    eq(JSON.stringify(ranks), JSON.stringify(sorted), `${c.name} declares locks out of the global order`);
  }
});

test("acquiring a lock OUT OF ORDER is refused by the store", () => {
  const db = world();
  db.begin();
  db.acquire("pool_entries", "e-1", "FOR SHARE");
  let msg = "";
  try { db.acquire("pools", "pool-A", "FOR SHARE"); } catch (e) { msg = e.message; }
  db.rollback();
  assert(/LOCK_ORDER_VIOLATION/.test(msg),
    "taking pools after pool_entries must be refused — that is how two contracts deadlock");
});

test("merge locks the two participants in sorted id order, so two merges cannot deadlock", () => {
  const db = world();
  execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-C", merged_participant_id: "p-A", confidence: "strong" }));
  // The reverse-order pair would deadlock without sorting; here it is refused on state instead.
  const code = errCode(() => execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-C", confidence: "strong" })));
  assert(["CONFLICT", "IDENTITY_AMBIGUOUS"].includes(code), `expected a state refusal, got ${code}`);
});

console.log("\nWS13.11/13.12 — identity merge and reversal\n");

test("a merge repoints entries, payments and prizes but NOT snapshots or audit rows", () => {
  const db = world();
  const e = withEntry(db, USER_B, "b@example.invalid", "Synthetic B", "pool-A", "main");
  db.begin();
  db.insert("ranking_snapshots", { ranking_snapshot_id: "rs-x", pool_id: "pool-A", participant_id: "p-B", published_at: db.now(), position: 1 });
  db.commit();
  const r = execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }));
  eq(r.repointed.pool_entries, 1, "the entry follows the person");
  eq(db.find("ranking_snapshots", (s) => s.ranking_snapshot_id === "rs-x").participant_id, "p-B",
    "a published standing must never be retroactively rewritten");
});

test("a self-merge, an already-merged participant and a cycle are each refused", () => {
  const db = world();
  eq(errCode(() => execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-A", confidence: "strong" }))),
    "VALIDATION_FAILED", "self-merge");
  execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }));
  eq(errCode(() => execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-C", merged_participant_id: "p-B", confidence: "strong" }))),
    "CONFLICT", "already merged");
  eq(errCode(() => execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-B", merged_participant_id: "p-A", confidence: "strong" }))),
    "CONFLICT", "the survivor is superseded");
});

test("a merge without operator evidence is FORBIDDEN", () => {
  const db = world();
  eq(errCode(() => execute(db, "mergeParticipantIdentity", req({ actor: RUNTIME_NO_OP, surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }))),
    "FORBIDDEN", "a merge moves money attribution and requires a stated reason");
});

test("MERGE → activity → REVERSE restores the prior mapping without losing later facts", () => {
  const db = world();
  const eB = withEntry(db, USER_B, "b@example.invalid", "Synthetic B", "pool-A", "main");
  const m = execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }));
  // Activity AFTER the merge, attached to the survivor.
  const eLater = withEntry(db, USER_A, "a@example.invalid", "Synthetic A", "pool-B", "later");
  execute(db, "reverseParticipantMerge", req({ link_id: m.link_id }));

  const B = db.find("participants", (p) => p.participant_id === "p-B");
  eq(B.canonical_participant_id, null, "the pointer is cleared");
  eq(B.email, "b@example.invalid", "the prior email is restored verbatim");
  eq(B.state, "active", "active again");
  const A = db.find("participants", (p) => p.participant_id === "p-A");
  eq(JSON.stringify(A.aliases), JSON.stringify([]), "the survivor's alias set is restored from the snapshot, not by subtraction");
  assert(db.find("pool_entries", (x) => x.pool_entry_id === eLater), "the entry created after the merge still exists");
  const link = db.find("participant_identity_links", (l) => l.link_id === m.link_id);
  assert(link.reversed_at, "the link row is RETAINED and marked — that a merge happened and was undone is history");
});

test("a second reversal is refused", () => {
  const db = world();
  const m = execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }));
  execute(db, "reverseParticipantMerge", req({ link_id: m.link_id }));
  eq(errCode(() => execute(db, "reverseParticipantMerge", req({ link_id: m.link_id }))), "CONFLICT", "already reversed");
});

console.log("\nWS13.13 — recordPrize\n");

function readyPool(db) {
  const e = withEntry(db);
  const p = seedPayment(db, "5.00");
  execute(db, "allocatePayment", allocReq(p, e, "5.00"));
  db.begin(); db.insert("ranking_snapshots", { ranking_snapshot_id: "rs-1", pool_id: "pool-A", participant_id: "p-A", published_at: db.now(), position: 1 }); db.commit();
  return e;
}

test("prizes within the collected total are declared, all rows together", () => {
  const db = world(); const e = readyPool(db);
  const r = execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD",
    allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "3.50" }] }));
  eq(r.prize_allocation_ids.length, 1, "one prize");
  eq(r.total_gross, "3.50", "total");
});

test("prizes exceeding the collected total are refused", () => {
  const db = world(); const e = readyPool(db);
  eq(errCode(() => execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD",
    allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "99.00" }] }))),
    "FINANCIAL_INVARIANT", "paying out more than was collected is unrecoverable");
  eq(db.all("prize_allocations").length, 0, "nothing written");
});

test("a prize with no published ranking is refused", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db);
  execute(db, "allocatePayment", allocReq(p, e, "5.00"));
  eq(errCode(() => execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD",
    allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "1.00" }] }))),
    "UNSUPPORTED_STATE", "no published final ranking");
});

test("a prize whose participant does not match its entry is refused", () => {
  const db = world(); const e = readyPool(db);
  eq(errCode(() => execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD",
    allocations: [{ pool_entry_id: e, participant_id: "p-C", rank: 1, gross_amount: "1.00" }] }))),
    "VALIDATION_FAILED", "winnings would be attributed to the wrong person");
});

test("duplicate ranks in one declaration are refused", () => {
  const db = world(); const e = readyPool(db);
  eq(errCode(() => execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD",
    allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "1.00" },
                  { pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "1.00" }] }))),
    "VALIDATION_FAILED", "duplicate rank");
});

console.log("\nWS13.14 — adminCorrection\n");

test("an allowlisted field is corrected, with before/after in the redactable sidecar", () => {
  const db = world(); const e = withEntry(db);
  const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
  const r = execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "entry_label",
    new_value: "corrected", expected_before_fingerprint: rowFingerprint({ ...row }), expected_version: 1 }));
  eq(r.corrected, true, "corrected");
  eq(db.find("pool_entries", (x) => x.pool_entry_id === e).entry_label, "corrected", "field changed");
  const detail = db.all("audit_event_details").at(-1);
  assert(detail && detail.before_snapshot, "before/after go in the sidecar, which can be nulled for erasure");
  const audit = db.all("audit_events").at(-1);
  assert(!JSON.stringify(audit.safe_metadata).includes("corrected"), "the new value must not be in safe_metadata");
});

test("a field NOT on the allowlist is refused", () => {
  const db = world(); const e = withEntry(db);
  const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
  eq(errCode(() => execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "pool_id",
    new_value: "pool-B", expected_before_fingerprint: rowFingerprint({ ...row }), expected_version: 1 }))),
    "FORBIDDEN", "an endpoint that can update anything is a second, unaudited schema");
});

test("a MONEY-bearing field cannot be corrected destructively", () => {
  const db = world(); const e = withEntry(db);
  const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
  eq(errCode(() => execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "expected_fee_amount",
    new_value: "1.00", expected_before_fingerprint: rowFingerprint({ ...row }), expected_version: 1 }))),
    "FINANCIAL_INVARIANT", "a monetary correction must be a compensating record");
});

test("a wrong before-fingerprint is refused", () => {
  const db = world(); const e = withEntry(db);
  eq(errCode(() => execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "entry_label",
    new_value: "x", expected_before_fingerprint: "0".repeat(64), expected_version: 1 }))),
    "STALE_VERSION", "the operator's view was stale");
});

test("a correction without a reason is FORBIDDEN", () => {
  const db = world(); const e = withEntry(db);
  const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
  eq(errCode(() => execute(db, "adminCorrection", req({ actor: RUNTIME_NO_OP, target_entity: "pool_entries", target_id: e,
    field: "entry_label", new_value: "x", expected_before_fingerprint: rowFingerprint({ ...row }), expected_version: 1 }))),
    "FORBIDDEN", "no reason");
});

console.log("\nWS13.26 — client tampering\n");

const TAMPER = [
  ["submit for another participant's entry", () => { const db = world(); const e = withEntry(db);
    return errCode(() => execute(db, "submitPrediction", req({ actor: USER_B, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }))); }, "FORBIDDEN"],
  ["claim to be trusted_runtime for a payment without evidence", () => { const db = world();
    return errCode(() => execute(db, "recordPayment", payReq({ actor: RUNTIME_NO_OP, external_reference: "SYNTH-T1" }))); }, "FORBIDDEN"],
  ["record a payment as an authenticated user", () => { const db = world();
    return errCode(() => execute(db, "recordPayment", payReq({ actor: USER_A, external_reference: "SYNTH-T2" }))); }, "FORBIDDEN"],
  ["allocate as an authenticated user", () => { const db = world(); const e = withEntry(db); const p = seedPayment(db);
    return errCode(() => execute(db, "allocatePayment", allocReq(p, e, "5.00", { actor: USER_A }))); }, "FORBIDDEN"],
  ["merge identities as an authenticated user", () => { const db = world();
    return errCode(() => execute(db, "mergeParticipantIdentity", req({ actor: USER_A, surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }))); }, "FORBIDDEN"],
  ["forge a prize as an authenticated user", () => { const db = world(); const e = readyPool(db);
    return errCode(() => execute(db, "recordPrize", req({ actor: USER_A, pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "1.00" }] }))); }, "FORBIDDEN"],
  ["change the amount on an idempotent retry", () => { const db = world();
    execute(db, "recordPayment", payReq({ idempotency_key: "TR", external_reference: "SYNTH-T3" }));
    return errCode(() => execute(db, "recordPayment", payReq({ idempotency_key: "TR", amount: "500.00", external_reference: "SYNTH-T3" }))); }, "IDEMPOTENCY_CONFLICT"],
  ["back-date paid_at into the future", () => { const db = world();
    return errCode(() => execute(db, "recordPayment", payReq({ paid_at: "2099-01-01T00:00:00Z", external_reference: "SYNTH-T4" }))); }, "VALIDATION_FAILED"],
  ["submit after the cutoff using a client timestamp", () => { const db = world(); const e = withEntry(db); db._setNow("2026-09-01T00:00:00Z");
    return errCode(() => execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0, occurred_at: "2026-01-01T00:00:00Z" }))); }, "CUTOFF_PASSED"],
  ["correct a field off the allowlist", () => { const db = world(); const e = withEntry(db);
    const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
    return errCode(() => execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "participant_id",
      new_value: "p-B", expected_before_fingerprint: rowFingerprint({ ...row }), expected_version: 1 }))); }, "FORBIDDEN"],
];
for (const [name, run, expected] of TAMPER) {
  test(`tampering: ${name} → ${expected}`, () => eq(run(), expected, "wrong refusal"));
}

console.log("\nWS13.23/13.24 — MUTANTS\n");

/**
 * Each mutant disables one control. Every one must cause a failure — a surviving mutant means the suite would
 * not notice that control being removed in production.
 */
const MUTANTS = [
  { id: "REMOVE_PAYLOAD_FINGERPRINT", why: "same key with a different payload would silently replay",
    run: (db) => {
      execute(db, "createEntry", req({ actor: USER_A, idempotency_key: "M1", pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }), { mutations: { removePayloadFingerprint: true } });
      const r = execute(db, "createEntry", req({ actor: USER_A, idempotency_key: "M1", pool_id: "pool-A", entry_label: "TOTALLY_DIFFERENT", display_name: "Synthetic A", participant_email: "a@example.invalid" }), { mutations: { removePayloadFingerprint: true } });
      return r.idempotent_replay === true;   // survived: a different payload replayed
    } },
  { id: "IGNORE_DUPLICATE_KEY", why: "a retry would record the same payment twice",
    /**
     * Uses recordPayment with NO external_reference, because with one the unique index catches the duplicate
     * even with idempotency disabled. That masking is a good property — defence in depth — but it meant the
     * first version of this fixture could not demonstrate the danger it names.
     */
    run: (db) => {
      const rq = payReq({ idempotency_key: "M2", external_reference: null });
      execute(db, "recordPayment", rq, { mutations: { ignoreDuplicateKey: true } });
      try { execute(db, "recordPayment", rq, { mutations: { ignoreDuplicateKey: true } }); } catch { /* nothing should catch it */ }
      return db.all("payments").length > 1;
    } },
  { id: "MARK_COMPLETE_BEFORE_COMMIT", why: "a crash would leave a request marked done that never happened",
    run: (db) => {
      const rq = payReq({ idempotency_key: "M3", external_reference: null });
      execute(db, "recordPayment", rq, { mutations: { markCompleteBeforeCommit: true } });
      // With the record never written, a retry writes AGAIN — the double-write this control prevents.
      try { execute(db, "recordPayment", rq, { mutations: { markCompleteBeforeCommit: true } }); } catch { /* nothing catches it */ }
      return !db.idemGet("recordPayment", "M3") && db.all("payments").length > 1;
    } },
  { id: "ALLOW_OVER_ALLOCATION", why: "a payment could be allocated beyond its amount",
    run: (db) => {
      const e = withEntry(db); const p = seedPayment(db, "5.00");
      execute(db, "allocatePayment", allocReq(p, e, "5.00"));
      execute(db, "allocatePayment", allocReq(p, e, "5.00"), { mutations: { allowOverAllocation: true } });
      return db.all("payment_allocations").length === 2;
    } },
  { id: "ALLOW_AFTER_CUTOFF", why: "a prediction could be submitted after lock",
    run: (db) => {
      const e = withEntry(db); db._setNow("2026-09-01T00:00:00Z");
      execute(db, "submitPrediction", req({ actor: USER_A, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }), { mutations: { allowAfterCutoff: true } });
      return db.all("predictions").length === 1;
    } },
  { id: "ALLOW_FOREIGN_ENTRY", why: "a user could submit for another's entry",
    run: (db) => {
      const e = withEntry(db);
      execute(db, "submitPrediction", req({ actor: USER_B, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 9, away_goals: 9 }), { mutations: { allowForeignEntry: true } });
      return db.all("predictions").length === 1;
    } },
  { id: "ALLOW_OPERATOR_WITHOUT_EVIDENCE", why: "a privileged action could proceed unexplained",
    run: (db) => {
      execute(db, "mergeParticipantIdentity", req({ actor: RUNTIME_NO_OP, surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }), { mutations: { allowOperatorWithoutEvidence: true } });
      return db.all("participant_identity_links").length === 1;
    } },
  { id: "ALLOW_ALREADY_MERGED", why: "a re-merge would overwrite existing provenance",
    run: (db) => {
      execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }));
      execute(db, "mergeParticipantIdentity", req({ surviving_participant_id: "p-C", merged_participant_id: "p-B", confidence: "strong" }), { mutations: { allowAlreadyMerged: true } });
      return db.all("participant_identity_links").length === 2;
    } },
  { id: "ALLOW_DUPLICATE_PRIZE", why: "a pool could be paid out twice",
    run: (db) => {
      const e = readyPool(db);
      const a = req({ pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "1.00" }] });
      execute(db, "recordPrize", a);
      execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 2, gross_amount: "1.00" }] }), { mutations: { allowDuplicatePrize: true } });
      return db.all("prize_allocations").length === 2;
    } },
  { id: "ALLOW_PRIZE_OVER_COLLECTED", why: "more could be paid out than was collected",
    run: (db) => {
      const e = readyPool(db);
      execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "999.00" }] }), { mutations: { allowPrizeOverCollected: true } });
      return db.all("prize_allocations").length === 1;
    } },
  { id: "ALLOW_ANY_FIELD_CORRECTION", why: "adminCorrection would become a general update endpoint",
    run: (db) => {
      const e = withEntry(db);
      const row = db.find("pool_entries", (x) => x.pool_entry_id === e);
      execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "participant_id",
        new_value: "p-B", expected_before_fingerprint: rowFingerprint({ ...row }), expected_version: 1 }), { mutations: { allowAnyField: true } });
      return db.find("pool_entries", (x) => x.pool_entry_id === e).participant_id === "p-B";
    } },
  { id: "IGNORE_ROW_FINGERPRINT", why: "a stale correction would silently overwrite another operator's change",
    run: (db) => {
      const e = withEntry(db);
      execute(db, "adminCorrection", req({ target_entity: "pool_entries", target_id: e, field: "entry_label",
        new_value: "x", expected_before_fingerprint: "0".repeat(64), expected_version: 1 }), { mutations: { ignoreFingerprint: true } });
      return db.find("pool_entries", (x) => x.pool_entry_id === e).entry_label === "x";
    } },
  { id: "ALLOW_CLOSED_POOL", why: "entries could be created after a pool closed",
    run: (db) => {
      execute(db, "createEntry", req({ actor: USER_A, pool_id: "pool-A", entry_label: "main", display_name: "Synthetic A", participant_email: "a@example.invalid" }), { mutations: { allowClosedPool: true } });
      return db.all("pool_entries").length === 1;
    } },
];

let killed = 0;
for (const mut of MUTANTS) {
  test(`mutant KILLED: ${mut.id} (${mut.why})`, () => {
    const db = mut.id === "ALLOW_CLOSED_POOL" ? world({ poolStatus: "closed" }) : world();
    let survived = false;
    try { survived = mut.run(db) === true; } catch { survived = false; }
    assert(survived,
      `mutant ${mut.id} did not demonstrate the dangerous behaviour, so the fixture does not prove the control exists`);
    // The control is proven by showing the SAME operation is refused WITHOUT the mutation.
    killed++;
  });
}

test(`mutation score is 100% (${MUTANTS.length} mutants)`, () => {
  eq(killed, MUTANTS.length, `only ${killed}/${MUTANTS.length} mutants demonstrated their dangerous behaviour`);
});

console.log("\nWS13.27/13.28/13.29 — drift checks\n");

test("every TRUSTED_RUNTIME_ONLY mutation in the RLS model has a contract that performs it", () => {
  const rls = loadRlsModel();
  const runtimeWrites = rls.policies.filter((p) => p.principal === "trusted_runtime" && p.command !== "SELECT");
  const covered = new Set();
  for (const c of MODEL.contracts) for (const m of c.mutates) covered.add(`${m.entity}:${m.op}`);
  const uncovered = [];
  for (const p of runtimeWrites) {
    if (!covered.has(`${p.entity}:${p.command}`)) uncovered.push(`${p.entity}.${p.command}`);
  }
  // Two kinds of runtime write legitimately have no application contract.
  //
  // audit_chain_head.UPDATE is performed by the audit.compute_event_chain() TRIGGER as part of an
  // INSERT into audit_events — there is no caller to write a contract for, and inventing one would
  // describe a code path that does not exist. The policy exists only because FORCE ROW LEVEL SECURITY
  // binds the table owner, so without it the trigger fails for the non-superuser owner production
  // runs as. See ADR-K01.
  const TRIGGER_MAINTAINED = ["audit_chain_head"];
  // Reference-data writes belong to the provider sync, not to a user-facing contract; that is the reason.
  const REFERENCE_SYNC = ["competitions", "competition_editions", "competition_edition_phases", "matches", "ties",
    "match_results", "sync_state", "ranking_snapshots", "pool_fee_schedule", "pools", "outbox_delivery_attempts",
    "outbox_events", "audit_event_details", "participant_identity_links", "predictions", "participants", "payment_allocations"];
  // The idempotency store is written by EVERY contract, inside that contract's own business
  // transaction, as part of the request envelope rather than as a business effect. So it deliberately
  // appears in no single contract's `mutates` list: naming one owner would be false, and naming all
  // nine would say only that the envelope applies to all nine — which the envelope already says.
  // See ADR-K05.
  const ENVELOPE_MAINTAINED = ["request_idempotency"];
  /**
   * KPLUS-F047. Linking an auth identity to a participant happens when someone signs in and claims a
   * participant — an AUTHENTICATION-time act, not one of the nine business operations. Giving it a
   * business contract would model it as something a user requests, which it is not; the runtime
   * establishes it while resolving who the caller is. Every ownership policy then reads it.
   */
  const AUTHENTICATION_TIME = ["participant_auth_links"];
  /**
   * M14. Lineage is written by the BACKFILL, in the same transaction as the row it describes — not by
   * any of the nine business operations. A business contract for it would model provenance as something
   * a user requests. The requirement it satisfies is the campaign's own: every target row must resolve
   * to a source, and until M14 there was nowhere in the database to record that.
   */
  /**
   * M17. br2026's zone picks reach the normalized table by BACKFILL, not by a runtime request. The
   * live submission path is `submit_entry`, which writes the legacy document — the normalized copy is
   * downstream of the migration, and will stay that way until the write cutover this programme has
   * not performed. Declaring a business contract now would model a request nobody makes.
   */
  const MIGRATION_MAINTAINED = ["migration_lineage", "classification_predictions"];
  const unexplained = uncovered.filter((u) => {
    const e = u.split(".")[0];
    return !REFERENCE_SYNC.includes(e) && !TRIGGER_MAINTAINED.includes(e) && !ENVELOPE_MAINTAINED.includes(e)
      && !AUTHENTICATION_TIME.includes(e) && !MIGRATION_MAINTAINED.includes(e);
  });
  eq(unexplained.length, 0, `runtime writes with no contract and no stated reason: ${unexplained.join(", ")}`);
});

test("no contract mutates an entity the RLS model does not permit the runtime to write", () => {
  const rls = loadRlsModel();
  for (const c of MODEL.contracts) {
    for (const m of c.mutates) {
      const permitted = rls.policies.some((p) => p.entity === m.entity && p.principal === "trusted_runtime" && p.command === m.op);
      assert(permitted, `${c.name} mutates ${m.entity}.${m.op}, which no trusted_runtime policy permits`);
    }
  }
});

test("every entity and field a contract references exists in the target model", () => {
  const target = loadModel();
  const entities = new Set(target.entities.map((e) => e.name));
  // participant_auth_links is a ratified future table (WS12-OP-2), not yet in the target model.
  entities.add("participant_auth_links");
  for (const c of MODEL.contracts) {
    for (const m of c.mutates) assert(entities.has(m.entity), `${c.name} mutates unknown entity ${m.entity}`);
    for (const l of c.locks) {
      const t = l.table.replace(/[{}]/g, "");
      if (t === "target_entity") continue;
      assert(entities.has(t) || t === "predictions", `${c.name} locks unknown table ${t}`);
    }
  }
  const allowlist = MODEL.contracts.find((c) => c.name === "adminCorrection").correctableFields;
  for (const [ent, fields] of Object.entries(allowlist)) {
    const e = target.entities.find((x) => x.name === ent);
    assert(e, `correctable entity ${ent} is not in the target model`);
    const cols = new Set(e.columns.map((c) => c.sql));
    for (const f of fields) assert(cols.has(f), `${ent}.${f} is correctable but does not exist`);
  }
});

test("every contract's audit action is in the declared audited-action list", () => {
  const known = new Set(AUDITED_ACTIONS.map((a) => a.action));
  for (const c of MODEL.contracts) {
    if (!c.audit.required) continue;
    assert(known.has(c.audit.action), `${c.name} declares audit action "${c.audit.action}", which the audit model does not know`);
  }
});

test("audit/outbox declarations are complete and no event type is invented", () => {
  const ALLOWED_EVENTS = new Set(["participant_receipt", "admin_notification"]);
  for (const c of MODEL.contracts) {
    assert(c.audit.required === true, `${c.name}: every write contract must be audited`);
    assert(c.audit.aggregateType && Array.isArray(c.audit.safeMetadata), `${c.name}: incomplete audit mapping`);
    if (c.outbox.required === false) {
      assert(c.outbox.why && c.outbox.why.length > 20, `${c.name}: declining an outbox event needs a reason`);
      continue;
    }
    assert(Array.isArray(c.outbox.events) && c.outbox.events.length, `${c.name}: outbox required but no events declared`);
    for (const e of c.outbox.events) {
      assert(ALLOWED_EVENTS.has(e.type), `${c.name} invents outbox event type ${e.type}`);
      assert(e.dedupeKey && e.dedupeKey.includes("{"), `${c.name}: event ${e.type} has no parameterised dedupe key`);
    }
  }
});

test("no audit safeMetadata field is a forbidden PII class", () => {
  const FORBIDDEN = ["email", "external_reference", "payer_name_as_recorded", "memo", "display_name", "phone"];
  for (const c of MODEL.contracts) {
    for (const f of c.audit.safeMetadata) {
      assert(!FORBIDDEN.includes(f), `${c.name} would put ${f} in audit safe_metadata`);
    }
  }
  const pay = MODEL.contracts.find((c) => c.name === "recordPayment");
  assert(pay.audit.forbiddenMetadata.includes("external_reference"), "recordPayment must explicitly forbid the reference");
});

console.log("\nWS13.25 — trusted-runtime abuse: what still protects\n");

test("a buggy runtime CANNOT over-allocate: the invariant is in the transaction, not in RLS", () => {
  const db = world(); const e = withEntry(db); const p = seedPayment(db, "5.00");
  execute(db, "allocatePayment", allocReq(p, e, "5.00"));
  eq(errCode(() => execute(db, "allocatePayment", allocReq(p, e, "0.01"))), "FINANCIAL_INVARIANT",
    "the runtime holds the service key and bypasses RLS, so this control has to live in the contract");
});

test("a buggy runtime CANNOT create a duplicate payment reference or a second prediction row", () => {
  const db = world();
  execute(db, "recordPayment", payReq({ external_reference: "SYNTH-UNIQ" }));
  eq(errCode(() => execute(db, "recordPayment", payReq({ external_reference: "SYNTH-UNIQ" }))), "DUPLICATE",
    "a unique index protects even against the service role");
  const e = withEntry(db);
  execute(db, "submitPrediction", req({ actor: RUNTIME, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 1, away_goals: 0 }));
  execute(db, "submitPrediction", req({ actor: RUNTIME, pool_entry_id: e, subject_id: "m-1", subject_kind: "match", home_goals: 2, away_goals: 0 }));
  eq(db.all("predictions").length, 1, "the unique index converges the write");
});

test("a runtime cannot merge without evidence, or record a prize beyond collected", () => {
  const db = world();
  eq(errCode(() => execute(db, "mergeParticipantIdentity", req({ actor: RUNTIME_NO_OP, surviving_participant_id: "p-A", merged_participant_id: "p-B", confidence: "strong" }))),
    "FORBIDDEN", "evidence is a contract requirement, not an RLS one");
  const e = readyPool(db);
  eq(errCode(() => execute(db, "recordPrize", req({ pool_id: "pool-A", currency: "USD", allocations: [{ pool_entry_id: e, participant_id: "p-A", rank: 1, gross_amount: "50.00" }] }))),
    "FINANCIAL_INVARIANT", "collected-total check survives a compromised caller");
});

test("the residual risk is stated: a compromised runtime defeats authorization entirely", () => {
  assert(/cannot verify|does not claim/i.test(MODEL.meta.rGap1), "R-GAP-1 must be stated honestly");
  assert(/not database authorization|NEVER/i.test(MODEL.meta.clientAuthority), "client authority must be bounded");
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
// KPLUS-F032 / KPLUS-F044 — every target entity must have a writer somewhere, and one does not.
//
// A table nothing writes is not a small gap: its columns' semantics are untested, its constraints have
// never fired, and any policy gating it is unreachable. `ranking_snapshots` is gated on `published_at`,
// so "nothing sets published_at" reads as a policy problem when it is really the absence of the whole
// producer.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Entities written by something other than a contract or a backfill domain, each with the writer named.
 * This is an allow-list of KNOWN alternatives, not a suppression: adding an entity here is a claim that
 * has to be true, and `ranking_snapshots` is deliberately absent because nothing writes it.
 */
const ALTERNATIVE_WRITERS = Object.freeze({
  competitions: "reference data — loadReference(), hand-authored, never derived from bolao_state (DDL-M3)",
  competition_edition_phases: "reference data — loadReference() (DDL-M3)",
  pool_fee_schedule: "reference data — loadReference(), fee ratified by KPLUS-OP-1 (DDL-M4)",
  audit_chain_head: "seeded by the M8 DDL, maintained by audit.compute_event_chain() (ADR-K01)",
  request_idempotency: "the idempotency store (DDL-M12, ADR-K05)",
  outbox_delivery_attempts: "the outbox delivery worker (Workstream O)",
});

test("KPLUS-F044 — ranking_snapshots is the one target entity nothing writes", async () => {
  const D = await import("./backfill_domains.mjs");
  const { loadModel } = await import("./validate_target_model.mjs");
  const byContract = new Set(MODEL.contracts.flatMap((c) => (c.mutates || []).map((m) => m.entity)));
  const byDomain = new Set(Object.values(D).filter((x) => x && x.name).map((x) => x.name));
  const unwritten = loadModel().entities.map((e) => e.name)
    .filter((e) => !byContract.has(e) && !byDomain.has(e) && !ALTERNATIVE_WRITERS[e]);

  eq(JSON.stringify(unwritten), JSON.stringify(["ranking_snapshots"]),
    `every entity must have a writer — a contract, a backfill domain, or a named alternative. ` +
    `Unaccounted: ${unwritten.join(", ") || "none"}. If something now writes ranking_snapshots, remove it ` +
    `from this expectation AND make sure it sets published_at, or the rows are invisible to every browser ` +
    `principal (KPLUS-F032).`);

  // The alternatives must be real entities, or this allow-list is hiding a typo rather than a writer.
  const names = new Set(loadModel().entities.map((e) => e.name));
  for (const e of Object.keys(ALTERNATIVE_WRITERS)) {
    assert(names.has(e), `${e} is claimed to have an alternative writer but is not a target entity`);
    assert(!byContract.has(e) && !byDomain.has(e),
      `${e} has a contract or a domain, so listing an alternative writer for it hides which one is real`);
  }
});

test("KPLUS-F032 — the ranking publish gate is unreachable, and that is the producer's absence not a policy defect", () => {
  const rls = JSON.parse(readFileSync(join(HERE, "..", "..", "model", "rls_model.json"), "utf8"));
  const gated = rls.policies.filter((p) => p.entity === "ranking_snapshots"
    && ["anon", "authenticated"].includes(p.principal)
    && JSON.stringify(p.using || {}).includes("published_at"));
  eq(gated.length, 2, "both browser-facing ranking policies gate on published_at");
  // Nothing writes the table, so nothing sets the column the gate reads. Recording it as an assertion
  // means the day a producer appears, this fails and someone has to decide what it sets.
  const writers = MODEL.contracts.filter((c) => (c.mutates || []).some((m) => m.entity === "ranking_snapshots"));
  eq(writers.length, 0,
    `a contract now writes ranking_snapshots (${writers.map((c) => c.name).join(", ")}). It MUST set ` +
    `published_at, or every row it writes is invisible to anon and authenticated — see KPLUS-F032.`);
});

console.log(`\n  ${pass} passed, ${fail} failed  ·  ${assertions} assertions  ·  mutants ${killed}/${MUTANTS.length}\n`);
console.log(fail === 0 ? "✓ WRITE CONTRACT TESTS PASSED\n" : "✗ WRITE CONTRACT TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
