#!/usr/bin/env node
/**
 * WS8 tests — candidate identity resolution.
 *
 * The governing property: NO input, however strong, may produce an automatic merge. Every test that
 * asserts a HIGH band also asserts the candidate is not auto-mergeable, because the danger in an
 * identity engine is not a missed duplicate — it is two real people silently becoming one.
 *
 * All names are synthetic; all addresses use RFC-reserved domains.
 */

import {
  analyseIdentities, proposeMerge, simulateApply, simulateReverse, financialAttribution,
  BAND, RISK, riskReason, ALL_SIGNALS, SIGNAL_STRENGTH, STRENGTH, EXTRA_SIGNAL, PLAN_REFUSAL,
  PLAN_REPOINT, PLAN_NEVER_REWRITE,
} from "./identity_engine.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const P = (id, name, email = null, extra = {}) => ({ participant_id: id, display_name: name, email, ...extra });
const E = (id, participant, pool) => ({ pool_entry_id: id, participant_id: participant, pool_id: pool });
const PAY = (id, payer, minor) => ({ payment_id: id, payer_participant_id: payer, amount_minor: minor, currency: "USD" });
const AL = (payment, entry, minor) => ({ payment_id: payment, pool_entry_id: entry, amount_minor: minor });

const find = (cands, a, b) => cands.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));

// =============================================================================================
console.log("\nWS8.1 — signals: no single signal may be sufficient\n");
// =============================================================================================

test("every signal has a declared strength", () => {
  for (const s of Object.values(ALL_SIGNALS)) {
    assert(SIGNAL_STRENGTH[s], `${s} has no declared strength`);
    assert(Object.values(STRENGTH).includes(SIGNAL_STRENGTH[s]), `${s} has an unknown strength`);
  }
});

test("no signal is classified as sufficient on its own", () => {
  // There is deliberately no SUFFICIENT strength value. If a future edit adds one, this fails.
  assert(!Object.values(STRENGTH).includes("SUFFICIENT"), "a SUFFICIENT strength was introduced");
  eq(Object.keys(STRENGTH).length, 3, "strength levels");
});

test("a single discriminating signal reaches MEDIUM, never HIGH", () => {
  const ds = { participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Zeta Nine", "one@example.test")] };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c, "no candidate produced for a shared email");
  assert(c.signals.includes(ALL_SIGNALS.EXACT_EMAIL), "email signal missing");
  eq(c.band, BAND.MEDIUM, "a shared email alone must not reach HIGH — different people share a household address");
  eq(c.autoMergeable, false, "auto-merge");
});

test("a discriminating signal plus a supporting one reaches HIGH but never auto-merges", () => {
  const ds = { participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "one@example.test")] };
  const c = find(analyseIdentities(ds), "p1", "p2");
  eq(c.band, BAND.HIGH, "same email and same name should be HIGH");
  eq(c.autoMergeable, false, "HIGH must still not auto-merge");
  eq(c.requiresOperatorConfirmation, true, "confirmation must be required");
});

test("EVERY candidate ever produced is non-auto-mergeable", () => {
  const ds = {
    participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "one@example.test"),
      P("p3", "Beta Two", "two@example.test"), P("p4", "Two Beta", "two@example.test")],
    aliases: [{ participant_id: "p1", alias: "Alpha One" }, { participant_id: "p2", alias: "Alpha One" }],
    authLinks: [{ auth_user_id: "u1", participant_id: "p1" }, { auth_user_id: "u1", participant_id: "p2" }],
    mergeHistory: [{ surviving_participant_id: "p3", merged_participant_id: "p4" }],
  };
  const cands = analyseIdentities(ds);
  assert(cands.length > 0, "no candidates to check");
  for (const c of cands) {
    eq(c.autoMergeable, false, `${c.a}/${c.b} was auto-mergeable`);
    eq(c.requiresOperatorConfirmation, true, `${c.a}/${c.b} did not require confirmation`);
  }
});

test("an unsalted email hash is demoted, not trusted", () => {
  const base = {
    participants: [P("p1", "Alpha One"), P("p2", "Alpha One")],
    emailHashes: [{ participant_id: "p1", hash: "h1" }, { participant_id: "p2", hash: "h1" }],
  };
  const salted = find(analyseIdentities({ ...base, emailHashSalted: true }), "p1", "p2");
  const unsalted = find(analyseIdentities({ ...base, emailHashSalted: false }), "p1", "p2");
  eq(salted.band, BAND.HIGH, "a salted hash match plus a name match should be HIGH");
  eq(unsalted.band, BAND.MEDIUM, "an unsalted hash is a reversible digest of a low-entropy value and must be demoted");
});

test("auth linkage alone never drives a merge proposal (WS12-OP-2)", () => {
  const ds = {
    participants: [P("p1", "Alpha One"), P("p2", "Zeta Nine")],
    authLinks: [{ auth_user_id: "u1", participant_id: "p1" }, { auth_user_id: "u1", participant_id: "p2" }],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c.risks.includes(RISK.MULTI_IDENTITY_AUTH_USER), "the multi-identity flag must be raised");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "one auth user holding two identities is expected and permitted, not evidence of sameness");
});

// =============================================================================================
console.log("\nWS8.3 — false positives: the cases that must NOT be proposed for merge\n");
// =============================================================================================

test("FP: same name, different people with different emails", () => {
  const ds = { participants: [P("p1", "Joao Silva", "joao.silva@example.test"), P("p2", "Joao Silva", "j.silva.2@example.test")] };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c.risks.includes(RISK.DISTINCT_EMAILS), "distinct verified emails must be flagged");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "two verified addresses that differ is the strongest evidence of two people");
});

test("FP: an email-like pattern is not an email match", () => {
  const ds = { participants: [P("p1", "Alpha One", "alpha.one@example.test"), P("p2", "Alpha Onee", "alpha.onee@example.test")] };
  const c = find(analyseIdentities(ds), "p1", "p2");
  if (c) assert(c.band !== BAND.HIGH, "near-identical addresses are not the same address");
});

test("FP: a payer is not the participant they pay for", () => {
  const ds = {
    participants: [P("p1", "Carla Payer"), P("p2", "Dina Player")],
    entries: [E("e2", "p2", "pool1")],
    payments: [PAY("pay1", "p1", 2000)],
    allocations: [AL("pay1", "e2", 2000)],
    aliases: [{ participant_id: "p1", alias: "shared" }, { participant_id: "p2", alias: "shared" }],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c, "no candidate");
  assert(c.risks.includes(RISK.PAYER_NOT_PARTICIPANT), "the payer relationship must be flagged");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "paying for someone is the opposite of being them");
});

test("FP: family members sharing a surname and a payer", () => {
  const ds = {
    participants: [P("p1", "Ana Costa"), P("p2", "Bruno Costa")],
    entries: [E("e1", "p1", "pool1"), E("e2", "p2", "pool1")],
    payments: [PAY("pay1", "p3", 4000)],
    allocations: [AL("pay1", "e1", 2000), AL("pay1", "e2", 2000)],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  if (c) {
    eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "a shared surname plus a shared payer is a family, not a duplicate");
    assert(c.risks.length > 0, "a family pattern must raise at least one risk");
  }
});

test("FP: both active in the same pool must never be a clean merge", () => {
  const ds = {
    participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "one@example.test")],
    entries: [E("e1", "p1", "pool1"), E("e2", "p2", "pool1")],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c.risks.includes(RISK.SAME_POOL_BOTH_ACTIVE), "not flagged");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "merging two active competitors in one pool would change a ranking");
});

test("FP: an alias used by three or more participants identifies nobody", () => {
  const ds = {
    participants: [P("p1", "One"), P("p2", "Two"), P("p3", "Three")],
    aliases: [{ participant_id: "p1", alias: "Zeh" }, { participant_id: "p2", alias: "Zeh" }, { participant_id: "p3", alias: "Zeh" }],
  };
  const cands = analyseIdentities(ds);
  for (const c of cands) {
    assert(c.risks.includes(RISK.ALIAS_COLLISION), `${c.a}/${c.b} colliding alias not flagged`);
    eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "a colliding alias must force review");
  }
});

test("FP: a previously reversed merge is a decision, not noise", () => {
  const ds = {
    participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "one@example.test")],
    mergeHistory: [{ surviving_participant_id: "p1", merged_participant_id: "p2", reversed_at: "2026-01-01T00:00:00Z" }],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c.risks.includes(RISK.PREVIOUSLY_REVERSED), "the earlier reversal must be surfaced");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "re-proposing a reversed merge without review would loop an operator decision");
});

test("FP: shared participation history alone produces no HIGH band", () => {
  const ds = {
    participants: [P("p1", "Alpha One"), P("p2", "Zeta Nine")],
    entries: [E("e1", "p1", "pool1"), E("e2", "p2", "pool1")],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  if (c) assert(c.band !== BAND.HIGH, "playing the same pool describes everyone in it");
});

test("every risk flag carries a reason", () => {
  for (const r of Object.values(RISK)) {
    const why = riskReason(r);
    assert(why && why.length > 20, `${r} has no usable reason`);
  }
});

test("a risk flag always forces MANUAL_REVIEW_REQUIRED, whatever the positive evidence", () => {
  const ds = {
    participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "two@example.test")],
    aliases: [{ participant_id: "p1", alias: "Alpha One" }, { participant_id: "p2", alias: "Alpha One" }],
    emailHashes: [{ participant_id: "p1", hash: "h" }, { participant_id: "p2", hash: "h" }],
    emailHashSalted: true,
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c.risks.length > 0, "expected a risk");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "risk must dominate positive evidence, not be averaged against it");
});

// =============================================================================================
console.log("\nWS8.4 — merge plans are proposals, never mutations\n");
// =============================================================================================

const DS = {
  participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "one@example.test"), P("p9", "Payer Nine")],
  entries: [E("e1", "p1", "poolA"), E("e2", "p2", "poolB")],
  payments: [PAY("pay1", "p2", 2000)],
  allocations: [AL("pay1", "e2", 2000)],
  predictions: [{ pool_entry_id: "e2", match_id: "m1", home_goals: 1, away_goals: 0 }],
  prizes: [],
  mergeHistory: [],
};

test("a plan does not mutate the dataset", () => {
  const before = JSON.stringify(DS);
  const plan = proposeMerge(DS, { sourceId: "p2", targetId: "p1", band: BAND.HIGH });
  assert(plan.ok, `plan refused: ${JSON.stringify(plan.refusals)}`);
  eq(plan.mutates, false, "a plan must declare it does not mutate");
  eq(JSON.stringify(DS), before, "proposeMerge mutated its input");
});

test("a plan names source, target, evidence, confirmation, records affected and reversal", () => {
  const plan = proposeMerge(DS, { sourceId: "p2", targetId: "p1", band: BAND.HIGH, evidence: [{ signal: "EXACT_EMAIL" }] });
  eq(plan.sourceId, "p2", "source");
  eq(plan.targetId, "p1", "target");
  eq(plan.operatorConfirmationRequired, true, "confirmation");
  assert(plan.confirmationPhrase.includes("p2") && plan.confirmationPhrase.includes("p1"),
    "the confirmation phrase must name both identities so it cannot be copy-pasted between merges");
  assert(plan.recordsAffected, "records affected");
  assert(plan.reversalPlan && plan.reversalPlan.mechanism, "reversal plan");
  assert(Array.isArray(plan.evidence), "evidence");
});

test("a plan distinguishes records repointed from records never rewritten", () => {
  const plan = proposeMerge(DS, { sourceId: "p2", targetId: "p1" });
  const repointed = plan.repoints.map((r) => r.table);
  const never = plan.notRewritten.map((r) => r.table);
  assert(repointed.includes("pool_entries"), "entries must be repointed");
  for (const t of ["payments", "payment_allocations", "prize_allocations", "audit_events"]) {
    assert(never.includes(t), `${t} must be in the never-rewritten set`);
    assert(!repointed.includes(t), `${t} must not be repointed`);
  }
  for (const r of [...PLAN_REPOINT, ...PLAN_NEVER_REWRITE]) assert(r.why, `${r.table} has no reason`);
});

test("the plan counts what it will NOT rewrite, so the operator sees the whole picture", () => {
  const plan = proposeMerge(DS, { sourceId: "p2", targetId: "p1" });
  eq(plan.recordsAffected.pool_entries, 1, "entries repointed");
  eq(plan.recordsAffected.payments_as_payer_NOT_rewritten, 1, "payments left alone must still be counted");
  eq(plan.recordsAffected.predictions_indirectly, 1, "predictions move with their entry");
});

const REFUSALS = {
  SAME_IDENTITY: { sourceId: "p1", targetId: "p1" },
  UNKNOWN_PARTICIPANT: { sourceId: "nope", targetId: "p1" },
};
for (const [flag, args] of Object.entries(REFUSALS)) {
  test(`NEGATIVE: a plan refuses ${flag}`, () => {
    const plan = proposeMerge(DS, args);
    eq(plan.ok, false, "should refuse");
    assert(plan.refusals.includes(PLAN_REFUSAL[flag]), `expected ${flag}, got ${plan.refusals}`);
  });
}

test("NEGATIVE: a plan refuses when the source is already merged", () => {
  const ds = structuredClone(DS);
  ds.participants.find((p) => p.participant_id === "p2").canonical_participant_id = "p1";
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  eq(plan.ok, false, "should refuse");
  assert(plan.refusals.includes(PLAN_REFUSAL.SOURCE_ALREADY_MERGED), `got ${plan.refusals}`);
});

test("NEGATIVE: a plan refuses when the target is not canonical", () => {
  const ds = structuredClone(DS);
  ds.participants.push(P("p3", "Third", "three@example.test", { canonical_participant_id: "p1" }));
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p3" });
  eq(plan.ok, false, "should refuse merging into a non-canonical target");
  assert(plan.refusals.includes(PLAN_REFUSAL.TARGET_NOT_CANONICAL), `got ${plan.refusals}`);
});

test("NEGATIVE: a plan refuses a merge that would create a cycle", () => {
  const ds = structuredClone(DS);
  ds.participants.find((p) => p.participant_id === "p1").canonical_participant_id = "p2";
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  eq(plan.ok, false, "a cycle must be refused");
  assert(plan.refusals.includes(PLAN_REFUSAL.WOULD_CYCLE) || plan.refusals.includes(PLAN_REFUSAL.TARGET_NOT_CANONICAL),
    `got ${plan.refusals}`);
});

test("NEGATIVE: a plan refuses when both hold an entry in the same pool", () => {
  const ds = structuredClone(DS);
  ds.entries.push(E("e3", "p2", "poolA"));
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  eq(plan.ok, false, "should refuse");
  assert(plan.refusals.includes(PLAN_REFUSAL.BOTH_ACTIVE_IN_POOL), `got ${plan.refusals}`);
});

test("NEGATIVE: a plan refuses when one paid for the other", () => {
  const ds = structuredClone(DS);
  ds.payments = [PAY("pay2", "p1", 2000)];
  ds.allocations = [AL("pay2", "e2", 2000)];
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  eq(plan.ok, false, "should refuse");
  assert(plan.refusals.includes(PLAN_REFUSAL.PAYER_RELATIONSHIP), `got ${plan.refusals}`);
});

test("a plan warns when the pair was merged and reversed before", () => {
  const ds = structuredClone(DS);
  ds.mergeHistory = [{ surviving_participant_id: "p1", merged_participant_id: "p2", reversed_at: "2026-01-01T00:00:00Z" }];
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  assert(plan.ok, "a prior reversal warns; it does not refuse, because circumstances change");
  eq(plan.priorReversalExists, true, "prior reversal not detected");
  assert(plan.warnings.length > 0, "a prior reversal must produce a warning");
});

// =============================================================================================
console.log("\nWS8.5 — merge reversal preserves financial attribution exactly\n");
// =============================================================================================

const RICH = {
  participants: [P("pA", "Alpha One", "one@example.test"), P("pB", "Alpha One", "one@example.test"), P("pC", "Carla Payer")],
  entries: [E("eA", "pA", "poolA"), E("eB", "pB", "poolB")],
  payments: [PAY("payA", "pA", 2000), PAY("payC", "pC", 4000)],
  allocations: [AL("payA", "eA", 2000), AL("payC", "eB", 2000)],
  prizes: [{ pool_entry_id: "eA", amount_minor: 7000, currency: "USD" }],
  predictions: [{ pool_entry_id: "eA", match_id: "m1" }, { pool_entry_id: "eB", match_id: "m1" }],
  mergeHistory: [],
};

test("merge → activity → reverse restores financial attribution byte-for-byte", () => {
  const before = financialAttribution(RICH);
  const plan = proposeMerge(RICH, { sourceId: "pB", targetId: "pA" });
  assert(plan.ok, `refused: ${JSON.stringify(plan.refusals)}`);

  const { dataset: merged, linkId } = simulateApply(RICH, plan);
  eq(financialAttribution(merged), before, "the MERGE itself changed financial attribution");
  eq(merged.entries.find((e) => e.pool_entry_id === "eB").participant_id, "pA", "the entry did not repoint");

  // Post-merge activity: a new payment and allocation land while merged.
  merged.payments.push(PAY("payNew", "pA", 1500));
  merged.allocations.push(AL("payNew", "eA", 1500));
  const afterActivity = financialAttribution(merged);

  const reversed = simulateReverse(merged, linkId);
  eq(financialAttribution(reversed), afterActivity,
    "the REVERSAL changed financial attribution — reversal must move ownership pointers only");
  eq(reversed.entries.find((e) => e.pool_entry_id === "eB").participant_id, "pB", "the entry did not return to its source");
  eq(reversed.participants.find((p) => p.participant_id === "pB").canonical_participant_id, null, "the source was not un-merged");
});

test("post-merge activity survives the reversal rather than being discarded", () => {
  const plan = proposeMerge(RICH, { sourceId: "pB", targetId: "pA" });
  const { dataset: merged, linkId } = simulateApply(RICH, plan);
  merged.payments.push(PAY("payNew", "pA", 1500));
  const reversed = simulateReverse(merged, linkId);
  assert(reversed.payments.some((p) => p.payment_id === "payNew"),
    "a payment made during the merged period was lost by the reversal");
});

test("the prize stays attached to its entry through merge and reversal", () => {
  const plan = proposeMerge(RICH, { sourceId: "pB", targetId: "pA" });
  const { dataset: merged, linkId } = simulateApply(RICH, plan);
  eq(merged.prizes[0].pool_entry_id, "eA", "the prize moved");
  const reversed = simulateReverse(merged, linkId);
  eq(reversed.prizes[0].pool_entry_id, "eA", "the prize moved on reversal");
});

test("NEGATIVE: a reversal cannot be applied twice", () => {
  const plan = proposeMerge(RICH, { sourceId: "pB", targetId: "pA" });
  const { dataset: merged, linkId } = simulateApply(RICH, plan);
  const once = simulateReverse(merged, linkId);
  let threw = false;
  try { simulateReverse(once, linkId); } catch { threw = true; }
  assert(threw, "reversing twice must be refused — the second one has no prior state to restore");
});

test("NEGATIVE: a refused plan cannot be applied", () => {
  const plan = proposeMerge(RICH, { sourceId: "pA", targetId: "pA" });
  let threw = false;
  try { simulateApply(RICH, plan); } catch { threw = true; }
  assert(threw, "a refused plan must not be applicable");
});

test("the reversal plan states why it works, not merely that it does", () => {
  const plan = proposeMerge(RICH, { sourceId: "pB", targetId: "pA" });
  assert(/prior_state|prior values/.test(plan.reversalPlan.whyItWorks), "the mechanism must be named");
  assert(/never rewritten|unchanged/.test(plan.reversalPlan.financialAttribution), "the financial guarantee must be stated");
  assert(plan.reversalPlan.requires.some((r) => /confirmation/.test(r)), "a reversal must need its own confirmation");
});

// =============================================================================================
console.log("\nWS8.6 — red team\n");
// =============================================================================================

test("RED: two different people cannot reach a clean merge proposal", () => {
  // Strongest plausible attack: identical names, a shared payer, shared pools, and an alias match.
  const ds = {
    participants: [P("p1", "Maria Souza", "maria.a@example.test"), P("p2", "Maria Souza", "maria.b@example.test")],
    entries: [E("e1", "p1", "poolA"), E("e2", "p2", "poolA")],
    payments: [PAY("pay1", "p9", 4000)],
    allocations: [AL("pay1", "e1", 2000), AL("pay1", "e2", 2000)],
    aliases: [{ participant_id: "p1", alias: "Maria" }, { participant_id: "p2", alias: "Maria" }],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "two people with distinct emails reached a non-review band");
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  eq(plan.ok, false, "a plan was produced for two competitors in the same pool");
});

test("RED: one person fragmented across four identities is proposed pairwise, not collapsed at once", () => {
  const ds = {
    participants: [P("p1", "Alpha One", "one@example.test"), P("p2", "Alpha One", "one@example.test"),
      P("p3", "Alpha One", "one@example.test"), P("p4", "Alpha One", "one@example.test")],
  };
  const cands = analyseIdentities(ds);
  eq(cands.length, 6, "all pairs of four identities should be proposed"); // C(4,2)
  for (const c of cands) eq(c.autoMergeable, false, "a fragmented identity must not bulk-merge");
});

test("RED: a payer mistaken for a participant is refused at both layers", () => {
  const ds = {
    participants: [P("p1", "Carla Payer", "carla@example.test"), P("p2", "Carla Payer", "carla@example.test")],
    entries: [E("e2", "p2", "poolA")],
    payments: [PAY("pay1", "p1", 2000)],
    allocations: [AL("pay1", "e2", 2000)],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  assert(c.risks.includes(RISK.PAYER_NOT_PARTICIPANT), "the analyser missed the payer relationship");
  const plan = proposeMerge(ds, { sourceId: "p2", targetId: "p1" });
  eq(plan.ok, false, "the planner must refuse independently of the analyser — two layers, not one");
});

test("RED: a merge cycle is impossible to propose", () => {
  const ds = {
    participants: [P("a", "A", "a@example.test", { canonical_participant_id: "b" }),
      P("b", "B", "a@example.test", { canonical_participant_id: "c" }), P("c", "C", "a@example.test")],
    entries: [], payments: [], allocations: [], prizes: [], predictions: [], mergeHistory: [],
  };
  const plan = proposeMerge(ds, { sourceId: "c", targetId: "a" });
  eq(plan.ok, false, "a chain that loops back must be refused");
});

test("RED: a superseded identity cannot be reused as a merge target", () => {
  const ds = {
    participants: [P("dead", "Old", "x@example.test", { canonical_participant_id: "live" }),
      P("live", "Live", "x@example.test"), P("new", "New", "x@example.test")],
    entries: [], payments: [], allocations: [], prizes: [], predictions: [], mergeHistory: [],
  };
  const plan = proposeMerge(ds, { sourceId: "new", targetId: "dead" });
  eq(plan.ok, false, "merging into a superseded identity must be refused");
  assert(plan.refusals.includes(PLAN_REFUSAL.TARGET_NOT_CANONICAL), `got ${plan.refusals}`);
});

test("RED: an alias collision cannot be laundered into a HIGH band by adding a name match", () => {
  const ds = {
    participants: [P("p1", "Zeh Silva"), P("p2", "Zeh Silva"), P("p3", "Zeh Costa")],
    aliases: [{ participant_id: "p1", alias: "Zeh" }, { participant_id: "p2", alias: "Zeh" }, { participant_id: "p3", alias: "Zeh" }],
  };
  const c = find(analyseIdentities(ds), "p1", "p2");
  eq(c.band, BAND.MANUAL_REVIEW_REQUIRED, "a colliding alias plus a name match must still require review");
});

test("RED: an empty dataset produces no candidates and does not throw", () => {
  eq(analyseIdentities({}).length, 0, "empty");
  eq(analyseIdentities({ participants: [] }).length, 0, "no participants");
});

test("RED: a participant with no email and no alias is never paired on nothing", () => {
  const ds = { participants: [P("p1", "Alpha One"), P("p2", "Zeta Nine")] };
  eq(analyseIdentities(ds).length, 0, "two unrelated participants must not be paired");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ IDENTITY ENGINE TESTS PASSED\n" : "✗ IDENTITY ENGINE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
