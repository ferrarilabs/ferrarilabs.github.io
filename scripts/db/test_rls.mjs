#!/usr/bin/env node
/**
 * Synthetic authorization harness and security red team (Workstream 12.15–12.32).
 *
 * Every identity, row and id below is synthetic and constructed here. No production data, no real policy.
 *
 * EXPECTATIONS DERIVE FROM THE MODEL, NOT FROM A HAND-MAINTAINED TABLE. The generated matrix drives the
 * exhaustive ALLOW/DENY sweep, so a policy change moves the expectation with it. The hand-written tests below
 * that are additional to the sweep assert properties the matrix cannot express — ownership scoping, which
 * ROW is visible, and what happens when an attacker substitutes another user's identifier.
 *
 * MUTATION TESTING is the load-bearing part. A harness that passes against a correct model proves nothing
 * about whether it would catch an incorrect one, so twelve dangerous mutants are applied and every one must
 * kill at least one assertion. The kill rate is reported and must be 100%.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  COMMANDS, VERDICT, loadRlsModel, authorize, evaluatePredicate, operationMatrix,
  renderPolicySql, renderPredicate, lintPolicies, detectDrift, policyFingerprints, policyFingerprint,
  deriveGrants, renderGrantSql, renderTargetAclSql, entitySchemas, qualify, entityColumns, predicateColumns,
} from "./rls.mjs";
import { loadAccessModel } from "./validate_access_model.mjs";
import { loadModel } from "./validate_target_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, assertions = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { assertions++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { assertions++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const MODEL = loadRlsModel();

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic world (WS12.15)
// ─────────────────────────────────────────────────────────────────────────────
const PA = "participant-A", PB = "participant-B", PC = "participant-C-third-party-payer";
const EA = "entry-A", EB = "entry-B";
const entriesById = new Map([
  [EA, { pool_entry_id: EA, pool_id: "pool-A", participant_id: PA }],
  [EB, { pool_entry_id: EB, pool_id: "pool-B", participant_id: PB }],
]);

/** Caller contexts. user_A owns participant A; user_B owns B. Neither owns C. */
const asAnon = { ownedParticipantIds: new Set(), entriesById };
/**
 * `authUserId` is the caller's auth identity. KPLUS-F048 added AUTH_UID_EQUALS, which compares a column
 * to it directly — a context without one can only ever deny, which would make every cell that predicate
 * governs look correctly closed for the wrong reason.
 */
const AUTH_A = "auth-user-A", AUTH_B = "auth-user-B";
const asUserA = { ownedParticipantIds: new Set([PA]), entriesById, authUserId: AUTH_A };
const asUserB = { ownedParticipantIds: new Set([PB]), entriesById, authUserId: AUTH_B };
/** A historical participant with no auth linkage: the set is empty, so ownership correctly denies. */
const asUnlinked = { ownedParticipantIds: new Set(), entriesById };

const ROW = {
  participants_A: { participant_id: PA, display_name: "Synthetic A", email: "a@example.invalid" },
  participants_B: { participant_id: PB, display_name: "Synthetic B", email: "b@example.invalid" },
  entry_A: entriesById.get(EA),
  entry_B: entriesById.get(EB),
  payment_A: { payment_id: "pay-A", payer_participant_id: PA, amount: "5.00", currency: "USD" },
  payment_B: { payment_id: "pay-B", payer_participant_id: PB, amount: "5.00", currency: "USD" },
  payment_C: { payment_id: "pay-C", payer_participant_id: PC, amount: "5.00", currency: "USD" },
  alloc_A: { allocation_id: "al-A", payment_id: "pay-A", pool_entry_id: EA, allocated_amount: "5.00" },
  alloc_B: { allocation_id: "al-B", payment_id: "pay-B", pool_entry_id: EB, allocated_amount: "5.00" },
  prize_A: { prize_allocation_id: "z-A", participant_id: PA, pool_entry_id: EA, published_at: "2026-07-01T00:00:00Z" },
  prize_B: { prize_allocation_id: "z-B", participant_id: PB, pool_entry_id: EB, published_at: null },
  prediction_A: { prediction_id: "pr-A", pool_entry_id: EA, home_goals: 1, away_goals: 0 },
  prediction_B: { prediction_id: "pr-B", pool_entry_id: EB, home_goals: 2, away_goals: 2 },
  audit: { audit_event_id: "a-1", aggregate_type: "pool_entry", aggregate_id: EA },
  outbox: { outbox_event_id: "o-1", status: "pending", attempt_count: 0 },
  attempt: { outbox_delivery_attempt_id: "oa-1", outbox_event_id: "o-1", outcome: "success" },
  result_current: { match_result_id: "r-1", match_id: "m-1", is_official: true, superseded_by_id: null },
  result_superseded: { match_result_id: "r-0", match_id: "m-1", is_official: true, superseded_by_id: "r-1" },
  fee_current: { pool_fee_schedule_id: "f-1", pool_id: "pool-A", effective_to: null },
  fee_historical: { pool_fee_schedule_id: "f-0", pool_id: "pool-A", effective_to: "2026-01-01T00:00:00Z" },
  snapshot_published: { ranking_snapshot_id: "rs-1", pool_id: "pool-A", published_at: "2026-07-01T00:00:00Z" },
  snapshot_draft: { ranking_snapshot_id: "rs-2", pool_id: "pool-A", published_at: null },
  sync: { sync_state_id: "s-1", provider: "espn" },
  competition: { competition_id: "c-1", slug: "copa" },
};

const can = (model, entity, command, principal, row, ctx, newRow = null) =>
  authorize(model, { entity, command, principal, row, newRow, ctx }).allowed;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nWS12.1/12.2 — model integrity\n");

test("every target entity has policies, and no policy names an unknown entity", () => {
  const target = loadModel().entities.map((e) => e.name);
  const withPolicies = new Set(MODEL.policies.map((p) => p.entity));
  for (const e of target) assert(withPolicies.has(e), `${e} has no policy — with RLS on it is unreachable even by the runtime`);
  for (const e of withPolicies) assert(target.includes(e), `${e} has policies but is not a target entity`);
  eq(withPolicies.size, 28, "twenty-eight entities covered — the 21 original, plus classification_snapshots and competition_edition_standings (Batch I), plus audit_chain_head (KPLUS-F013b, ADR-K01), plus request_idempotency (KPLUS-F018, ADR-K05), plus participant_auth_links (WS12-OP-2, KPLUS-F047), plus migration_lineage (M14 — row-level provenance, which the campaign required from the start and had nowhere to store)");
});

test("all five principals are modelled, with dbVerifiable stated honestly", () => {
  for (const p of ["anon", "authenticated", "trusted_runtime", "operator_context", "migration_role"]) {
    assert(MODEL.principals[p], `missing principal ${p}`);
    assert(typeof MODEL.principals[p].dbVerifiable === "boolean", `${p} does not state whether the database can verify it`);
    assert(MODEL.principals[p].meaning.length > 40, `${p} has no usable description`);
  }
  eq(MODEL.principals.operator_context.dbVerifiable, false,
    "R-GAP-1: claiming the database can verify an operator would be the one thing this model must not do");
  eq(MODEL.principals.migration_role.dbVerifiable, true, "the migration role IS a real database role");
});

test("both operator paths are documented and neither is claimed as available now", () => {
  const A = MODEL.operatorPaths.A_runtime_acts_for_operator;
  const B = MODEL.operatorPaths.B_database_verifiable_operator;
  assert(/AVAILABLE NOW/.test(A.status), "path A is the current reality");
  assert(/FUTURE/.test(B.status), "path B must not be presented as available");
  assert(A.weakness && /cannot verify the operator/.test(A.weakness), "path A's weakness must be stated, not glossed");
});

test("the lint and drift gates are clean", () => {
  // KPLUS-F032 — with the column map, so "well-formed" also means "can actually be applied".
  const lint = lintPolicies(MODEL, { columnsByEntity: entityColumns() });
  eq(lint.findings.filter((f) => f.severity === "ERROR").length, 0,
    `lint errors: ${lint.findings.map((f) => f.code).join(", ")}`);
  const drift = detectDrift(MODEL, loadAccessModel());
  eq(drift.findings.length, 0, `drift: ${drift.findings.map((f) => f.message).join(" | ")}`);
});

console.log("\nWS12.3 — the derived operation matrix\n");

test("every entity × command × principal cell has a verdict from the closed vocabulary", () => {
  const m = operationMatrix(MODEL);
  let cells = 0;
  for (const e of m.entities) for (const c of COMMANDS) for (const p of m.principals) {
    const cell = m.matrix[e][c][p];
    assert(Object.values(VERDICT).includes(cell.verdict), `${e}.${c}.${p}: bad verdict ${cell.verdict}`);
    cells++;
  }
  eq(cells, 28 * 4 * 5, "560 cells — every entity x command x principal must carry a verdict");
});

test("every ALLOW cell carries a justification", () => {
  const m = operationMatrix(MODEL);
  for (const e of m.entities) for (const c of COMMANDS) for (const p of m.principals) {
    const cell = m.matrix[e][c][p];
    if (cell.verdict === VERDICT.ALLOW || cell.verdict === VERDICT.TRUSTED_RUNTIME_ONLY) {
      assert(cell.why && cell.why.length > 20, `${e}.${c}.${p} is ${cell.verdict} with no justification`);
    }
  }
});

test("DELETE is DENY for every entity and every principal", () => {
  const m = operationMatrix(MODEL);
  for (const e of m.entities) for (const p of ["anon", "authenticated", "trusted_runtime"]) {
    eq(m.matrix[e].DELETE[p].verdict, VERDICT.DENY, `${e}: ${p} may DELETE`);
  }
});

test("operator_context is FUTURE_OPERATOR_IDENTITY everywhere, never ALLOW", () => {
  const m = operationMatrix(MODEL);
  for (const e of m.entities) for (const c of COMMANDS) {
    eq(m.matrix[e][c].operator_context.verdict, VERDICT.FUTURE_OPERATOR_IDENTITY, `${e}.${c}`);
  }
});

console.log("\nWS12.18 — exhaustive sweep, expectations derived from the model\n");

test("the evaluator agrees with the derived matrix on all 500 cells", () => {
  const m = operationMatrix(MODEL);
  const sample = { SELECT: ROW.competition, INSERT: ROW.competition, UPDATE: ROW.competition, DELETE: ROW.competition };
  for (const e of m.entities) for (const c of COMMANDS) for (const p of m.principals) {
    const expectedAllow = m.matrix[e][c][p].verdict === VERDICT.ALLOW || m.matrix[e][c][p].verdict === VERDICT.TRUSTED_RUNTIME_ONLY;
    // Use a permissive context so a DENY here means "no policy", not "ownership rejected".
    // A permissive context so a DENY means "no policy" and not "ownership rejected" — which now also
    // means supplying an auth identity AND a row that carries it, because KPLUS-F048's AUTH_UID_EQUALS
    // compares the two directly.
    const ctx = { ownedParticipantIds: new Set([PA, PB, PC]), entriesById, authUserId: AUTH_A };
    const row = { ...sample[c], participant_id: PA, payer_participant_id: PA, pool_entry_id: EA,
      auth_user_id: AUTH_A,
      published_at: "t", effective_to: null, is_official: true, superseded_by_id: null };
    const got = authorize(MODEL, { entity: e, command: c, principal: p, row, newRow: row, ctx }).allowed;
    if (expectedAllow) assert(got, `${e}.${c}.${p}: matrix says reachable but the evaluator denied it`);
    else assert(!got, `${e}.${c}.${p}: matrix says unreachable but the evaluator allowed it`);
  }
});

test("anon can write NOTHING, anywhere", () => {
  const m = operationMatrix(MODEL);
  for (const e of m.entities) for (const c of ["INSERT", "UPDATE", "DELETE"]) {
    assert(!can(MODEL, e, c, "anon", ROW.competition, asAnon, ROW.competition),
      `anon may ${c} ${e} — the anon key is in the page source`);
  }
});

test("anon can read NOTHING that carries a person's money or data", () => {
  // pool_fee_schedule is deliberately NOT here: its current row is a published price, not a person's money.
  // A separate test below proves only the in-force row is visible and historical prices are not.
  for (const e of [...MODEL.financialNoAnonEntities, ...MODEL.sensitiveEntities, ...MODEL.internalOnlyEntities]) {
    assert(!can(MODEL, e, "SELECT", "anon", { participant_id: PA, published_at: "t", effective_to: null }, asAnon),
      `anon may read ${e}`);
  }
});

console.log("\nWS12.16 — horizontal isolation\n");

test("A cannot read B's participant row, and vice versa", () => {
  assert(can(MODEL, "participants", "SELECT", "authenticated", ROW.participants_A, asUserA), "A reads A");
  assert(!can(MODEL, "participants", "SELECT", "authenticated", ROW.participants_B, asUserA), "A must not read B");
  assert(can(MODEL, "participants", "SELECT", "authenticated", ROW.participants_B, asUserB), "B reads B");
  assert(!can(MODEL, "participants", "SELECT", "authenticated", ROW.participants_A, asUserB), "B must not read A");
});

test("A cannot read or mutate B's entry", () => {
  assert(can(MODEL, "pool_entries", "SELECT", "authenticated", ROW.entry_A, asUserA), "A reads own entry");
  assert(!can(MODEL, "pool_entries", "SELECT", "authenticated", ROW.entry_B, asUserA), "A must not read B's entry — it contains their picks");
  assert(!can(MODEL, "pool_entries", "UPDATE", "authenticated", ROW.entry_B, asUserA, ROW.entry_B), "A must not mutate B's entry");
  assert(!can(MODEL, "pool_entries", "UPDATE", "authenticated", ROW.entry_A, asUserA, ROW.entry_A), "not even their own — entries are server-mediated");
});

test("A cannot read B's prediction — a FAIRNESS boundary, not only privacy", () => {
  assert(can(MODEL, "predictions", "SELECT", "authenticated", ROW.prediction_A, asUserA), "A reads own");
  assert(!can(MODEL, "predictions", "SELECT", "authenticated", ROW.prediction_B, asUserA),
    "reading another's picks before a cutoff would let A copy a better player");
  assert(!can(MODEL, "predictions", "SELECT", "authenticated", ROW.prediction_A, asUserB), "reciprocal");
});

test("A cannot read B's financial rows — and cannot read their OWN either", () => {
  for (const [entity, rowA, rowB] of [
    ["payments", ROW.payment_A, ROW.payment_B],
    ["payment_allocations", ROW.alloc_A, ROW.alloc_B],
    ["prize_allocations", ROW.prize_A, ROW.prize_B],
  ]) {
    assert(!can(MODEL, entity, "SELECT", "authenticated", rowB, asUserA), `A must not read B's ${entity}`);
    assert(!can(MODEL, entity, "SELECT", "authenticated", rowA, asUserA),
      `${entity} is not directly readable even by its owner — financial reads go through a view the runtime owns, which can project away external_reference and paid_amount as a row policy cannot`);
  }
});

test("a historical participant with NO auth linkage owns nothing", () => {
  assert(!can(MODEL, "participants", "SELECT", "authenticated", ROW.participants_A, asUnlinked),
    "an empty ownership set must deny every ownership predicate — historical participants have no auth row");
  assert(!can(MODEL, "predictions", "SELECT", "authenticated", ROW.prediction_A, asUnlinked), "same via entry");
});

console.log("\nWS12.17 — public reads expose only what they should\n");

test("public reference data is readable by anon", () => {
  for (const e of ["competitions", "competition_editions", "competition_edition_phases", "matches", "ties", "pools"]) {
    assert(can(MODEL, e, "SELECT", "anon", ROW.competition, asAnon), `anon should read ${e}`);
  }
});

test("only the CURRENT fee is public; historical prices are not", () => {
  assert(can(MODEL, "pool_fee_schedule", "SELECT", "anon", ROW.fee_current, asAnon), "the in-force price is public");
  assert(!can(MODEL, "pool_fee_schedule", "SELECT", "anon", ROW.fee_historical, asAnon),
    "a closed schedule row is history, not a published price");
});

test("only the CURRENT official result is public; a superseded one is not", () => {
  assert(can(MODEL, "match_results", "SELECT", "anon", ROW.result_current, asAnon), "current result public");
  assert(!can(MODEL, "match_results", "SELECT", "anon", ROW.result_superseded, asAnon),
    "a superseded result would confuse a reader about which score counts");
});

test("only PUBLISHED ranking snapshots are public; drafts are not", () => {
  assert(can(MODEL, "ranking_snapshots", "SELECT", "anon", ROW.snapshot_published, asAnon), "published");
  assert(!can(MODEL, "ranking_snapshots", "SELECT", "anon", ROW.snapshot_draft, asAnon), "an unpublished computation is a draft");
});

test("sync_state is invisible to both anon and authenticated", () => {
  assert(!can(MODEL, "sync_state", "SELECT", "anon", ROW.sync, asAnon), "anon");
  assert(!can(MODEL, "sync_state", "SELECT", "authenticated", ROW.sync, asUserA),
    "a client has no use for a provider cursor; staleness reaches operators through a health report");
});

console.log("\nWS12.21 — role confusion\n");

test("operator_context is refused BY NAME, not silently allowed", () => {
  for (const e of ["payments", "participants", "audit_events"]) {
    const r = authorize(MODEL, { entity: e, command: "INSERT", principal: "operator_context", row: {}, newRow: {}, ctx: asUserA });
    eq(r.allowed, false, `operator_context must not be authorized on ${e}`);
    eq(r.reason, "R_GAP_1_NO_DB_VERIFIABLE_OPERATOR", "and the reason must name R-GAP-1 rather than pretending a policy denied it");
  }
});

test("migration_role is refused as an application principal", () => {
  const r = authorize(MODEL, { entity: "payments", command: "INSERT", principal: "migration_role", row: {}, newRow: {}, ctx: asUserA });
  eq(r.allowed, false, "denied");
  eq(r.reason, "MIGRATION_ROLE_NOT_APPLICATION_RUNTIME", "the migration role holds BYPASSRLS and must never be reachable from application runtime");
});

test("an unknown principal is refused, never defaulted to a known one", () => {
  const r = authorize(MODEL, { entity: "pools", command: "SELECT", principal: "superuser", row: {}, ctx: asAnon });
  eq(r.allowed, false, "denied");
  eq(r.reason, "UNKNOWN_PRINCIPAL", "reason");
});

test("authenticated cannot reach a trusted_runtime path by claiming it", () => {
  // The principal is an input; the test is that naming trusted_runtime does not require any secret the
  // evaluator checks. That is precisely why the SERVICE KEY, not a request field, selects this principal in
  // production — recorded here so the harness does not imply otherwise.
  assert(can(MODEL, "payments", "INSERT", "trusted_runtime", {}, asUserA, ROW.payment_A),
    "the runtime principal can insert a payment");
  assert(!can(MODEL, "payments", "INSERT", "authenticated", {}, asUserA, ROW.payment_A),
    "an authenticated caller cannot, and the only thing separating them in production is possession of the service key");
});

console.log("\nWS12.22 — IDOR\n");

const IDOR = [
  ["participants", "SELECT", ROW.participants_B, "substituted another participant_id"],
  ["pool_entries", "SELECT", ROW.entry_B, "substituted another pool_entry_id"],
  ["pool_entries", "UPDATE", ROW.entry_B, "substituted another entry to mutate"],
  ["predictions", "SELECT", ROW.prediction_B, "substituted another prediction_id"],
  ["predictions", "UPDATE", ROW.prediction_B, "substituted another prediction to overwrite"],
  ["payments", "SELECT", ROW.payment_B, "substituted another payment_id"],
  ["payment_allocations", "SELECT", ROW.alloc_B, "substituted another allocation"],
  ["prize_allocations", "SELECT", ROW.prize_B, "substituted another prize target"],
  ["pool_entries", "SELECT", { ...ROW.entry_B, pool_id: "pool-A" }, "kept own pool id but another's entry"],
];
for (const [entity, command, row, description] of IDOR) {
  test(`IDOR: ${entity}.${command} — ${description}`, () => {
    assert(!can(MODEL, entity, command, "authenticated", row, asUserA, row),
      `A reached ${entity} by ${description}; a valid-but-other-user identifier must not grant access`);
  });
}

console.log("\nWS12.23 — financial red team\n");

const FINANCIAL_ATTACKS = [
  ["record a payment as authenticated", "payments", "INSERT", ROW.payment_A],
  ["record a payment attributed to another participant", "payments", "INSERT", ROW.payment_B],
  ["change a payment amount", "payments", "UPDATE", { ...ROW.payment_A, amount: "500.00" }],
  ["reassign an allocation to own entry", "payment_allocations", "UPDATE", { ...ROW.alloc_B, pool_entry_id: EA }],
  ["allocate another payer's payment", "payment_allocations", "INSERT", { allocation_id: "al-X", payment_id: "pay-C", pool_entry_id: EA }],
  ["forge a prize for self", "prize_allocations", "INSERT", { prize_allocation_id: "z-X", participant_id: PA, pool_entry_id: EA }],
  ["mutate a prize", "prize_allocations", "UPDATE", { ...ROW.prize_A, paid_amount: "999.00" }],
  ["change the fee schedule", "pool_fee_schedule", "UPDATE", { ...ROW.fee_current, fee_amount: "0.01" }],
  ["insert a fee schedule row", "pool_fee_schedule", "INSERT", { pool_fee_schedule_id: "f-X", pool_id: "pool-A" }],
];
for (const [name, entity, command, row] of FINANCIAL_ATTACKS) {
  test(`financial: authenticated cannot ${name}`, () => {
    assert(!can(MODEL, entity, command, "authenticated", row, asUserA, row), `authenticated performed: ${name}`);
    assert(!can(MODEL, entity, command, "anon", row, asAnon, row), `anon performed: ${name}`);
  });
}

test("financial: a compromised browser cannot read the payment ledger to enumerate participants", () => {
  for (const row of [ROW.payment_A, ROW.payment_B, ROW.payment_C]) {
    assert(!can(MODEL, "payments", "SELECT", "authenticated", row, asUserA), "payment enumeration must be impossible");
    assert(!can(MODEL, "payments", "SELECT", "anon", row, asAnon), "including anonymously");
  }
});

console.log("\nWS12.24 — prediction red team\n");

test("prediction: authenticated cannot submit for ANY entry, including their own", () => {
  assert(!can(MODEL, "predictions", "INSERT", "authenticated", {}, asUserA, ROW.prediction_A),
    "submission is server-mediated: the cutoff can only be enforced against a trusted clock");
  assert(!can(MODEL, "predictions", "INSERT", "authenticated", {}, asUserA, ROW.prediction_B),
    "and certainly not for another entry");
});

test("prediction: the runtime CAN submit, which is where the business rules live", () => {
  assert(can(MODEL, "predictions", "INSERT", "trusted_runtime", {}, asUserA, ROW.prediction_A), "runtime may insert");
});

test("prediction: authorization failure is distinct from a business-rule failure", () => {
  /**
   * Submitting after the cutoff is NOT an RLS decision. RLS answers "may this principal touch this row";
   * the cutoff is a temporal business rule needing a trusted clock, and the phase's cutoff is not even a
   * column on predictions. Putting it in RLS would spread one invariant across two enforcement layers with
   * no single place to read it — so the harness asserts the boundary rather than pretending RLS covers it.
   */
  const r = authorize(MODEL, { entity: "predictions", command: "INSERT", principal: "authenticated", row: {}, newRow: ROW.prediction_A, ctx: asUserA });
  eq(r.allowed, false, "denied");
  eq(r.reason, "NO_POLICY_FOR_COMMAND",
    "the denial is an AUTHORIZATION denial. Lock state is enforced in the submit_prediction transaction, not here.");
});

console.log("\nWS12.26 — audit and outbox red team\n");

const AUDIT_OUTBOX_ATTACKS = [
  ["fake an audit event", "audit_events", "INSERT", ROW.audit],
  ["alter an audit event", "audit_events", "UPDATE", ROW.audit],
  ["delete an audit event", "audit_events", "DELETE", ROW.audit],
  ["read the audit log", "audit_events", "SELECT", ROW.audit],
  ["read a redactable detail payload", "audit_event_details", "SELECT", { audit_event_detail_id: "d-1" }],
  ["inject an outbox event", "outbox_events", "INSERT", ROW.outbox],
  ["mark an outbox event delivered", "outbox_events", "UPDATE", { ...ROW.outbox, status: "sent" }],
  ["reset a retry count", "outbox_events", "UPDATE", { ...ROW.outbox, attempt_count: 0 }],
  ["steal a lease", "outbox_events", "UPDATE", { ...ROW.outbox, lease_owner: "attacker" }],
  ["forge a delivery attempt", "outbox_delivery_attempts", "INSERT", ROW.attempt],
  ["alter a delivery attempt", "outbox_delivery_attempts", "UPDATE", ROW.attempt],
];
for (const [name, entity, command, row] of AUDIT_OUTBOX_ATTACKS) {
  test(`audit/outbox: no client may ${name}`, () => {
    for (const [principal, ctx] of [["anon", asAnon], ["authenticated", asUserA]]) {
      assert(!can(MODEL, entity, command, principal, row, ctx, row), `${principal} performed: ${name}`);
    }
  });
}

test("audit_events permits UPDATE to NOBODY, including the runtime", () => {
  assert(!can(MODEL, "audit_events", "UPDATE", "trusted_runtime", ROW.audit, asUserA, ROW.audit),
    "immutability is the property that makes the hash chain worth computing");
  assert(can(MODEL, "audit_events", "INSERT", "trusted_runtime", {}, asUserA, ROW.audit), "but append is permitted");
});

test("audit_event_details is the ONE table where runtime UPDATE is intentional", () => {
  assert(can(MODEL, "audit_event_details", "UPDATE", "trusted_runtime", { audit_event_detail_id: "d-1" }, asUserA, { redacted_at: "t" }),
    "erasure nulls the snapshots in place, which is the whole reason the sidecar exists");
});

test("append-only tables permit UPDATE to nobody at all", () => {
  for (const e of MODEL.appendOnlyEntities) {
    for (const p of ["anon", "authenticated", "trusted_runtime"]) {
      assert(!can(MODEL, e, "UPDATE", p, {}, asUserA, {}), `${p} may UPDATE append-only ${e}`);
    }
  }
});

console.log("\nWS12.27 — policy fingerprints\n");

test("fingerprints are stable, content-sensitive and leak no literal", () => {
  const fp = policyFingerprints(MODEL);
  eq(Object.keys(fp.policies).length, MODEL.policies.length, "one per policy");
  assert(/^[0-9a-f]{64}$/.test(fp.rollup), "rollup is a sha256");
  eq(policyFingerprints(MODEL).rollup, fp.rollup, "stable across runs");

  const p = MODEL.policies.find((x) => x.name === "participants_authenticated_select");
  const widened = { ...p, using: { kind: "TRUE" } };
  assert(policyFingerprint(p) !== policyFingerprint(widened), "widening a predicate must change the fingerprint");

  // Formatting must not matter: the fingerprint is over the structure, not over rendered SQL.
  const reordered = { command: p.command, using: p.using, entity: p.entity, principal: p.principal, withCheck: p.withCheck, name: p.name };
  eq(policyFingerprint(reordered), policyFingerprint(p), "key order must not change the fingerprint");

  // No literal value appears in the fingerprint output.
  assert(!JSON.stringify(fp).includes("example.invalid"), "no data may appear in a fingerprint");
});

console.log("\nWS12.29 — the linter must be able to fire\n");

const LINT_CASES = [
  ["POLICY_MISSING_USING", (m) => { m.policies[0].using = null; m.policies[0].command = "SELECT"; }],
  ["POLICY_MISSING_WITH_CHECK", (m) => { const p = m.policies.find((x) => x.command === "INSERT"); p.withCheck = null; }],
  ["UNEXPECTED_ANON_WRITE", (m) => { m.policies.push({ ...m.policies[0], name: "pools_anon_insert", entity: "pools", principal: "anon", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, why: "a deliberately dangerous mutant for the linter" }); }],
  ["UNEXPECTED_AUTHENTICATED_FINANCIAL_WRITE", (m) => { m.policies.push({ name: "payments_authenticated_insert", entity: "payments", principal: "authenticated", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "a deliberately dangerous mutant for the linter" }); }],
  ["UNEXPECTED_ANON_READ", (m) => { m.policies.push({ name: "payments_anon_select", entity: "payments", principal: "anon", command: "SELECT", using: { kind: "TRUE" }, withCheck: null, ownership: "NONE", why: "a deliberately dangerous mutant for the linter" }); }],
  ["UPDATE_ON_APPEND_ONLY", (m) => { m.policies.push({ name: "audit_events_trusted_runtime_update", entity: "audit_events", principal: "trusted_runtime", command: "UPDATE", using: { kind: "TRUE" }, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "a deliberately dangerous mutant for the linter" }); }],
  ["MISSING_OWNERSHIP_PREDICATE", (m) => { m.policies.find((x) => x.name === "pool_entries_authenticated_select").using = { kind: "TRUE" }; }],
  ["UNEXPECTED_DELETE_POLICY", (m) => { m.policies.push({ name: "pools_trusted_runtime_delete", entity: "pools", principal: "trusted_runtime", command: "DELETE", using: { kind: "TRUE" }, withCheck: null, ownership: "NONE", why: "a deliberately dangerous mutant for the linter" }); }],
  ["DUPLICATE_POLICY_NAME", (m) => { m.policies.push({ ...m.policies[0] }); }],
  ["POLICY_NAME_NONSTANDARD", (m) => { m.policies[0].name = "some_ad_hoc_name"; }],
  ["POLICY_WITHOUT_RATIONALE", (m) => { m.policies[0].why = "x"; }],
  ["UNKNOWN_PRINCIPAL", (m) => { m.policies[0].principal = "wizard"; }],
  ["SUSPICIOUS_STATIC_LITERAL", (m) => { m.policies.find((x) => x.name === "pool_entries_authenticated_select").using = { kind: "COLUMN_EQUALS", column: "pool_id", value: "abc123" }; }],
];
for (const [code, mutate] of LINT_CASES) {
  test(`linter fires ${code}`, () => {
    const m = JSON.parse(JSON.stringify(MODEL));
    mutate(m);
    const r = lintPolicies(m);
    assert(r.findings.some((f) => f.code === code), `${code} did not fire — an unexercised lint rule is unproven`);
  });
}

test("the linter detects a table with no policy and a policy for an unknown table", () => {
  const m = JSON.parse(JSON.stringify(MODEL));
  const r1 = lintPolicies(m, { targetEntities: [...new Set(m.policies.map((p) => p.entity)), "orphan_table"] });
  assert(r1.findings.some((f) => f.code === "TABLE_WITHOUT_POLICY"), "missing table not detected");
  const r2 = lintPolicies(m, { targetEntities: ["pools"] });
  assert(r2.findings.some((f) => f.code === "POLICY_FOR_UNKNOWN_TABLE"), "unknown table not detected");
});

console.log("\nWS12.19/12.20 — MUTATION TESTING with kill-rate tracking\n");

/**
 * Twelve dangerous mutants. Each must be KILLED — that is, cause at least one assertion in the security
 * suite below to fail. A mutant that survives means the harness would not notice that policy change in
 * production, which makes the harness decorative.
 */
const MUTANTS = [
  { id: "REMOVE_OWNERSHIP_PREDICATE", why: "participants read becomes a full directory",
    mutate: (m) => { m.policies.find((p) => p.name === "participants_authenticated_select").using = { kind: "TRUE" }; } },
  { id: "REMOVE_ENTRY_OWNERSHIP", why: "any user reads any entry, exposing picks",
    mutate: (m) => { m.policies.find((p) => p.name === "pool_entries_authenticated_select").using = { kind: "TRUE" }; } },
  { id: "REMOVE_PREDICTION_OWNERSHIP", why: "any user reads any prediction — a fairness breach",
    mutate: (m) => { m.policies.find((p) => p.name === "predictions_authenticated_select").using = { kind: "TRUE" }; } },
  { id: "AND_TO_OR_MATCH_RESULTS", why: "superseded results become public",
    mutate: (m) => { const p = m.policies.find((x) => x.name === "match_results_anon_select"); p.using = { kind: "OR", operands: p.using.operands }; } },
  { id: "REMOVE_WITH_CHECK_ON_INSERT", why: "an INSERT policy admits any post-image",
    mutate: (m) => { m.policies.find((p) => p.name === "payments_trusted_runtime_insert").withCheck = null; } },
  { id: "BROADEN_ROLE_TO_AUTHENTICATED", why: "the runtime's payment insert becomes reachable by any user",
    mutate: (m) => { m.policies.find((p) => p.name === "payments_trusted_runtime_insert").principal = "authenticated"; } },
  { id: "ALLOW_ANON_INSERT", why: "the internet can create entries",
    mutate: (m) => { m.policies.push({ name: "pool_entries_anon_insert", entity: "pool_entries", principal: "anon", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "ALLOW_ANON_UPDATE", why: "the internet can mutate entries",
    mutate: (m) => { m.policies.push({ name: "pool_entries_anon_update", entity: "pool_entries", principal: "anon", command: "UPDATE", using: { kind: "TRUE" }, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "ALLOW_AUTHENTICATED_PAYMENT_INSERT", why: "a browser can record a payment",
    mutate: (m) => { m.policies.push({ name: "payments_authenticated_insert", entity: "payments", principal: "authenticated", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "ALLOW_AUTHENTICATED_ALLOCATION_UPDATE", why: "a browser can reassign an allocation",
    mutate: (m) => { m.policies.push({ name: "payment_allocations_authenticated_update", entity: "payment_allocations", principal: "authenticated", command: "UPDATE", using: { kind: "TRUE" }, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "ALLOW_AUDIT_INSERT", why: "a client can forge an audit event",
    mutate: (m) => { m.policies.push({ name: "audit_events_authenticated_insert", entity: "audit_events", principal: "authenticated", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "ALLOW_OUTBOX_INSERT", why: "a client can inject a notification",
    mutate: (m) => { m.policies.push({ name: "outbox_events_authenticated_insert", entity: "outbox_events", principal: "authenticated", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "ALLOW_CROSS_USER_PREDICTION", why: "a user submits for another's entry",
    mutate: (m) => { m.policies.push({ name: "predictions_authenticated_insert", entity: "predictions", principal: "authenticated", command: "INSERT", using: null, withCheck: { kind: "TRUE" }, ownership: "NONE", why: "dangerous mutant" }); } },
  { id: "DISABLE_RLS", why: "every table becomes readable and writable by everyone",
    mutate: (m) => { for (const p of m.policies) { p.principal = "anon"; p.using = { kind: "TRUE" }; p.withCheck = { kind: "TRUE" }; } } },
];

/**
 * The security assertions a mutant must break. Deliberately a FUNCTION of the model, so it runs against a
 * mutant exactly as it runs against the real thing.
 */
function securityAssertions(m) {
  const failures = [];
  const chk = (cond, label) => { if (!cond) failures.push(label); };
  // isolation
  chk(!can(m, "participants", "SELECT", "authenticated", ROW.participants_B, asUserA), "A read B's participant");
  chk(!can(m, "pool_entries", "SELECT", "authenticated", ROW.entry_B, asUserA), "A read B's entry");
  chk(!can(m, "predictions", "SELECT", "authenticated", ROW.prediction_B, asUserA), "A read B's prediction");
  // anon writes nothing
  for (const e of ["pool_entries", "payments", "predictions", "audit_events", "outbox_events"]) {
    for (const c of ["INSERT", "UPDATE"]) chk(!can(m, e, c, "anon", {}, asAnon, {}), `anon ${c} ${e}`);
  }
  // financial: no client reads or writes
  for (const e of ["payments", "payment_allocations", "prize_allocations", "pool_fee_schedule"]) {
    for (const c of ["INSERT", "UPDATE"]) chk(!can(m, e, c, "authenticated", {}, asUserA, {}), `authenticated ${c} ${e}`);
  }
  for (const e of ["payments", "payment_allocations", "prize_allocations"]) {
    chk(!can(m, e, "SELECT", "authenticated", { participant_id: PA, payer_participant_id: PA, pool_entry_id: EA }, asUserA), `authenticated read ${e}`);
    chk(!can(m, e, "SELECT", "anon", { published_at: "t" }, asAnon), `anon read ${e}`);
  }
  // audit / outbox client denial
  for (const e of ["audit_events", "outbox_events", "outbox_delivery_attempts"]) {
    for (const c of ["INSERT", "UPDATE"]) chk(!can(m, e, c, "authenticated", {}, asUserA, {}), `authenticated ${c} ${e}`);
  }
  chk(!can(m, "audit_events", "UPDATE", "trusted_runtime", ROW.audit, asUserA, ROW.audit), "runtime updated audit");
  // predictions are server-mediated
  chk(!can(m, "predictions", "INSERT", "authenticated", {}, asUserA, ROW.prediction_A), "authenticated submitted a prediction");
  // public reads stay narrow
  chk(!can(m, "match_results", "SELECT", "anon", ROW.result_superseded, asAnon), "anon read a superseded result");
  chk(!can(m, "ranking_snapshots", "SELECT", "anon", ROW.snapshot_draft, asAnon), "anon read a draft snapshot");
  chk(!can(m, "pool_fee_schedule", "SELECT", "anon", ROW.fee_historical, asAnon), "anon read a historical fee");
  chk(!can(m, "sync_state", "SELECT", "authenticated", ROW.sync, asUserA), "authenticated read sync_state");
  // lint must also stay clean
  const lint = lintPolicies(m);
  chk(lint.findings.filter((f) => f.severity === "ERROR").length === 0, "lint errors");
  return failures;
}

test("the REAL model passes every security assertion", () => {
  const failures = securityAssertions(MODEL);
  eq(failures.length, 0, `the real model failed: ${failures.join("; ")}`);
});

let killed = 0;
for (const mut of MUTANTS) {
  test(`mutant KILLED: ${mut.id} (${mut.why})`, () => {
    const m = JSON.parse(JSON.stringify(MODEL));
    mut.mutate(m);
    const failures = securityAssertions(m);
    assert(failures.length > 0,
      `mutant ${mut.id} SURVIVED — the harness would not notice this policy change in production, which makes it decorative`);
    killed++;
  });
}

test(`mutation score is 100% (${MUTANTS.length} mutants)`, () => {
  eq(killed, MUTANTS.length, `only ${killed}/${MUTANTS.length} mutants killed; a surviving dangerous mutant must be fixed before this workstream can be called done`);
});

console.log("\nWS12.13/12.14 — SQL drafts and naming\n");

test("the SQL draft carries the refusal banner and is outside every migration path", () => {
  const p = join(HERE, "..", "..", "docs", "bolao", "db-modernization", "rls-drafts", "TARGET_RLS.draft.sql");
  const body = readFileSync(p, "utf8");
  assert(/^-- NOT FOR PRODUCTION APPLY/.test(body), "banner missing");
  assert(/-- TARGET RLS REVIEW DRAFT/.test(body), "draft marker missing");
  assert(/REQUIRES RESTORE REHEARSAL/.test(body), "prerequisites missing");
  assert(!p.includes(join("supabase", "migrations")), "must not live in a migration path");
  assert(!/^\d{14}_/.test("TARGET_RLS.draft.sql"), "name must not be CLI-recognisable");
});

test("the SQL draft is fresh and every policy appears in it", () => {
  const p = join(HERE, "..", "..", "docs", "bolao", "db-modernization", "rls-drafts", "TARGET_RLS.draft.sql");
  eq(readFileSync(p, "utf8"), renderTargetAclSql(MODEL), "stale — regenerate with --write");
  const body = readFileSync(p, "utf8");
  for (const pol of MODEL.policies) assert(body.includes(`CREATE POLICY ${pol.name}`), `${pol.name} missing from the draft`);
  /**
   * KPLUS-F031. This loop used to assert `ALTER TABLE bolao.${e}` for every entity — so the test AGREED
   * with the defect, which is why three audit tables were addressed in the wrong schema for as long as
   * they were. The expectation now comes from the same authority the generator uses.
   */
  const schemas = entitySchemas();
  for (const e of new Set(MODEL.policies.map((x) => x.entity))) {
    assert(body.includes(`ALTER TABLE ${qualify(e, schemas)} ENABLE ROW LEVEL SECURITY`), `${e} does not enable RLS in its own schema`);
  }
});

test("no policy name is duplicated and every name is deterministic", () => {
  const names = MODEL.policies.map((p) => p.name);
  eq(new Set(names).size, names.length, "duplicate policy name");
  for (const p of MODEL.policies) eq(p.name, `${p.entity}_${p.principal}_${p.command.toLowerCase()}`, "nonstandard name");
});

test("ownership predicates render as a link-table subquery, not an auth.uid() column comparison", () => {
  const sql = renderPredicate({ kind: "OWNS_PARTICIPANT", column: "participant_id" });
  assert(/participant_auth_links/.test(sql),
    "participant identity and auth identity are different: one user may own several participants, and a historical participant may have no auth row");
  assert(/auth\.uid\(\)/.test(sql), "and it must consult the caller — that is what DR-1's policies never did");
});

test("no private production literal appears anywhere in the model or the draft", () => {
  const draft = readFileSync(join(HERE, "..", "..", "docs", "bolao", "db-modernization", "rls-drafts", "TARGET_RLS.draft.sql"), "utf8");
  const model = readFileSync(join(HERE, "..", "..", "model", "rls_model.json"), "utf8");
  const doc = join(HERE, "..", "..", "supabase", "migrations", "PRIVATE_LITERALS.md");
  let prefixes = [];
  try { prefixes = [...readFileSync(doc, "utf8").matchAll(/`([0-9a-f]{12})`/g)].map((m) => m[1]); } catch { /* absent in this checkout */ }
  for (const pre of prefixes) {
    assert(!draft.includes(pre), "the draft contains a production literal digest");
    assert(!model.includes(pre), "the model contains a production literal digest");
  }
  // And no DR-1-style bare identifier comparison on a sensitive table.
  assert(!/id = '[a-z0-9]{4,8}'/.test(draft), "the draft contains a DR-1-style static row allowlist");
});

// ─────────────────────────────────────────────────────────────────────────────
// KPLUS-F031 — every statement names the schema the table actually lives in
// ─────────────────────────────────────────────────────────────────────────────
/**
 * This file used to write `bolao.` in front of every entity. Twenty-two of twenty-five are in `bolao`,
 * which is exactly why nobody noticed the three that are not.
 */
test("KPLUS-F031 — the audit spine is addressed in the audit schema, not bolao", () => {
  const draft = renderPolicySql(loadRlsModel());
  for (const e of ["audit_chain_head", "audit_events", "audit_event_details"]) {
    assert(new RegExp(`ALTER TABLE audit\\.${e} ENABLE ROW LEVEL SECURITY`).test(draft), `${e} must be addressed as audit.${e}`);
    assert(!new RegExp(`bolao\\.${e}\\b`).test(draft),
      `${e} is addressed as bolao.${e}, a relation that does not exist — the statement would abort and the ` +
      `audit spine would keep FORCE RLS with zero policies, reachable by nobody`);
  }
});

test("KPLUS-F031 — an entity with no schema in the target model is a hard error, never a default", () => {
  const schemas = entitySchemas();
  eq(qualify("audit_events", schemas), "audit.audit_events", "the schema comes from the model");
  eq(qualify("participants", schemas), "bolao.participants", "and so does this one");
  let threw = false;
  try { qualify("a_table_the_model_does_not_declare", schemas); } catch { threw = true; }
  assert(threw, "defaulting an unknown entity to bolao is precisely how KPLUS-F031 survived");
});

// ─────────────────────────────────────────────────────────────────────────────
// KPLUS-F029 — the grants, derived from the access model
// ─────────────────────────────────────────────────────────────────────────────
test("KPLUS-F029 — every entity the access model gives a principal is granted to that principal", () => {
  const access = loadAccessModel();
  const { tables } = deriveGrants(access);
  const byKey = new Map(tables.map((t) => [`${t.entity}|${t.principal}`, t]));
  const ROLE = { anon: "anon", authenticated: "authenticated", service: "service_role" };
  let checked = 0;
  for (const e of access.entities) {
    for (const [principal, verbs] of Object.entries(e.permissions || {})) {
      if (principal === "operator") continue;              // R-GAP-1 — folded into service, asserted below
      const t = byKey.get(`${e.name}|${principal}`);
      if (!verbs.length) { assert(!t, `${e.name}/${principal} has no permissions but produced a grant`); continue; }
      assert(t, `${e.name}/${principal} declares ${verbs.join(",")} but produced no GRANT — a policy alone grants nothing`);
      eq(t.role, ROLE[principal], "principal must map to its database role");
      // SELECT_OWN is a SELECT grant; the ownership policy narrows the rows.
      const want = [...new Set(verbs.map((v) => (v === "SELECT_OWN" ? "SELECT" : v)))].sort();
      eq(t.verbs.join(","), want.join(","), `${e.name}/${principal} verbs`);
      checked++;
    }
  }
  assert(checked >= 40, `expected the model to produce many grants, checked only ${checked}`);
});

test("KPLUS-F029 — operator receives no grant, and that is only sound because operator ⊆ service", () => {
  const access = loadAccessModel();
  const { tables, operatorFolded } = deriveGrants(access);
  assert(!tables.some((t) => t.principal === "operator" || /operator/.test(t.role)),
    "operator is not a database principal (R-GAP-1); a grant to it would be inventing authorization");
  assert(operatorFolded.length > 0, "the fold must actually be exercised, or this assertion is vacuous");
  for (const e of access.entities) {
    const op = new Set(e.permissions?.operator || []);
    const svc = new Set(e.permissions?.service || []);
    for (const v of op) assert(svc.has(v), `${e.name}: operator holds ${v} that service does not — the fold loses it`);
  }
});

test("ANTI-VACUITY — an operator permission service lacks is REFUSED, not silently dropped", () => {
  const access = JSON.parse(JSON.stringify(loadAccessModel()));
  const victim = access.entities.find((e) => (e.permissions?.service || []).length);
  victim.permissions.operator = [...new Set([...(victim.permissions.operator || []), "DELETE"])];
  let msg = "";
  try { deriveGrants(access); } catch (e) { msg = e.message; }
  assert(/operator holds DELETE/.test(msg),
    `folding operator into service must fail loudly when the fold would lose a permission, got: ${msg || "no error"}`);
});

test("KPLUS-F029 — no DELETE is granted anywhere, and PUBLIC is revoked before every grant", () => {
  const sql = renderGrantSql();
  assert(!/GRANT[^;]*\bDELETE\b/.test(sql), "nothing in this schema is deleted; a DELETE grant has no policy behind it");
  const granted = [...sql.matchAll(/GRANT [A-Z, ]+ ON TABLE ([\w.]+) TO/g)].map((m) => m[1]);
  const revoked = new Set([...sql.matchAll(/REVOKE ALL ON TABLE ([\w.]+) FROM PUBLIC/g)].map((m) => m[1]));
  assert(granted.length > 0, "the generator produced no grants at all");
  for (const rel of new Set(granted)) assert(revoked.has(rel), `${rel} is granted without first revoking PUBLIC`);
});

test("KPLUS-F029 — reaching a table also grants USAGE on its schema, and only to roles that need it", () => {
  const sql = renderGrantSql();
  assert(/GRANT USAGE ON SCHEMA bolao TO anon, authenticated, service_role;/.test(sql),
    "a table grant is unusable without schema USAGE");
  const auditUsage = sql.match(/GRANT USAGE ON SCHEMA audit TO ([^;]+);/);
  assert(auditUsage, "the audit schema needs a USAGE grant for the runtime");
  eq(auditUsage[1].trim(), "service_role",
    "anon and authenticated have no permission on any audit table, so they must not reach the schema either");
});

test("KPLUS-F029 — no browser principal is granted anything on a financial or audit table", () => {
  const sql = renderGrantSql();
  const grant = (rel, role) => new RegExp(`GRANT ([A-Z, ]+) ON TABLE ${rel.replace(/\./g, "\\.")} TO ${role};`).exec(sql);
  for (const rel of ["bolao.payments", "bolao.payment_allocations", "bolao.prize_allocations",
    "audit.audit_events", "audit.audit_chain_head", "audit.audit_event_details"]) {
    for (const role of ["anon", "authenticated"]) {
      assert(!grant(rel, role), `${role} is granted a privilege on ${rel}`);
    }
  }

  /**
   * The ownership-scoped tables are a DIFFERENT claim and must not be lumped in with the ones above —
   * the first version of this test did exactly that and failed, correctly, against a generator that was
   * right. `participants`, `pool_entries` and `predictions` carry SELECT_OWN for a signed-in user, so
   * they MUST be reachable by `authenticated` or every ownership policy on them is dead code. What has
   * to hold is: anon gets nothing at all, and authenticated gets SELECT and nothing wider.
   */
  for (const rel of ["bolao.participants", "bolao.pool_entries", "bolao.predictions"]) {
    assert(!grant(rel, "anon"),
      `anon is granted a privilege on ${rel} — it holds names, emails and picks, and the anon key is in the page source`);
    const g = grant(rel, "authenticated");
    assert(g, `${rel} carries a SELECT_OWN policy; without the grant that policy can never admit a row`);
    eq(g[1].trim(), "SELECT",
      `${rel} grants authenticated more than SELECT — a browser principal must never hold a write privilege on it`);
  }
});

test("KPLUS-F029 — the published draft carries both halves of the access model", () => {
  const draft = readFileSync(join(HERE, "..", "..", "docs", "bolao", "db-modernization", "rls-drafts", "TARGET_RLS.draft.sql"), "utf8");
  assert(/CREATE POLICY/.test(draft), "the draft must still carry the policies");
  assert(/GRANT SELECT/.test(draft), "and now the privileges too — a policy grants nothing");
  eq(draft, renderTargetAclSql(loadRlsModel()), "the checked-in draft is stale; regenerate with rls.mjs --write");
});

test("KPLUS-F032 — a predicate naming a column the target model does not declare is an ERROR", () => {
  const cols = entityColumns();
  eq(lintPolicies(MODEL, { columnsByEntity: cols }).findings.filter((f) => f.code === "POLICY_COLUMN_NOT_IN_MODEL").length, 0,
    "the real model must be clean");
  // ANTI-VACUITY: reintroduce the exact defect and require the lint to name it.
  const m = JSON.parse(JSON.stringify(MODEL));
  // The historical defect was `ranking_snapshots.published_at`. KPLUS-F032 resolved it by ADDING that
  // column, so the mutant has to name a different absent one — reusing the original would now be testing
  // a column that exists and would pass for the wrong reason.
  m.policies.find((p) => p.name === "ranking_snapshots_anon_select").using = { kind: "COLUMN_NOT_NULL", column: "released_at" };
  const bad = lintPolicies(m, { columnsByEntity: cols }).findings.filter((f) => f.code === "POLICY_COLUMN_NOT_IN_MODEL");
  eq(bad.length, 1, "the lint must catch a predicate on a column that does not exist");
  assert(/ranking_snapshots\.released_at/.test(bad[0].message), "and name the column, so the fix is obvious");
  // It must reach columns nested inside AND/OR/NOT, not only top-level ones.
  const nested = JSON.parse(JSON.stringify(MODEL));
  nested.policies.find((p) => p.name === "ranking_snapshots_anon_select").using =
    { kind: "AND", operands: [{ kind: "TRUE" }, { kind: "NOT", operands: [{ kind: "COLUMN_IS_NULL", column: "not_a_column" }] }] };
  assert(lintPolicies(nested, { columnsByEntity: cols }).findings.some((f) => /not_a_column/.test(f.message)),
    "a predicate buried inside AND/NOT is still a predicate on a column that must exist");
  assert(predicateColumns({ kind: "OR", operands: [{ kind: "COLUMN_EQUALS", column: "a" }, { kind: "COLUMN_IS_NULL", column: "b" }] }).size === 2,
    "predicateColumns must walk operands");
});

test("KPLUS-F032 — every RLS predicate column exists, checked against the whole model", () => {
  const cols = entityColumns();
  let checked = 0;
  for (const p of MODEL.policies) {
    for (const pred of [p.using, p.withCheck]) {
      for (const c of predicateColumns(pred)) {
        assert(cols.get(p.entity)?.has(c), `${p.name} filters on ${p.entity}.${c}, which does not exist`);
        checked++;
      }
    }
  }
  // Nine today. Pinned rather than loose: if a policy stops filtering on a column, that is either a
  // deliberate widening or a mistake, and both deserve to be looked at.
  eq(checked, 13, "the number of column-bearing predicates changed — a policy gained or lost a filter");
});

console.log(`\n  ${pass} passed, ${fail} failed  ·  ${assertions} assertions  ·  mutants killed ${killed}/${MUTANTS.length}\n`);
console.log(fail === 0 ? "✓ RLS AUTHORIZATION TESTS PASSED\n" : "✗ RLS AUTHORIZATION TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
