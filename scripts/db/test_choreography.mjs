#!/usr/bin/env node
/**
 * WS5 tests — state transition legality, flag combinations, stale clients, financial races,
 * scoring parity, fault injection and the promotion evaluator.
 *
 * The governing rule for this suite: every GATE gets a negative fixture proving it can block. A gate
 * that has only ever been observed to pass is indistinguishable from a gate that cannot fail, and the
 * second one is worse than no gate at all because it produces confidence.
 */

import {
  loadChoreography, useChoreography, resetChoreography, validateChoreography, checkDrift,
  states, stateDef, transitions, canTransition, legalNext, evaluateGuard, rollbackClass,
  pointsOfNoSimpleReturnAt, isReversibleByFlag, flags, flagDefaults, validateFlags, boundFlagRuleIds,
  oldClientClassification, oldClientOutcome, classifyWriteShape, capabilityGrantsAuthority,
  domains, domainDef, evaluateParity, evaluateObservationWindow, gate, evaluateGate, gateForDomain,
  checkAbortCriteria, boundAbortCriterionIds, evaluatePromotion, isSharedDomain, sharedDomainState,
  mayFreezeSharedDomain, checkSchedulingConstraints, runDeltaPass, requiresZeroDelta,
  ChoreographyError, CLASSIFICATIONS,
} from "./choreography.mjs";
import {
  simulateFullCutover, simulateStaleBrowser, simulateFinancialFailure, simulateScoringCutover,
  simulatePartialRollout, simulateFaults, FAULTS, HAPPY_PATH, cents,
} from "./simulate_cutover.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const throws = (fn, re, m) => {
  asserts++;
  try { fn(); } catch (e) { if (re && !re.test(e.message + e.code)) throw new Error(`${m}: wrong error ${e.message}`); return; }
  throw new Error(m || "expected a throw");
};
const clone = () => JSON.parse(JSON.stringify(loadChoreography()));

// =============================================================================================
console.log("\nThe specification must be structurally valid\n");
// =============================================================================================

test("the committed choreography validates with no errors", () => {
  const v = validateChoreography();
  eq(v.errors.length, 0, `errors:\n      ${v.errors.join("\n      ")}`);
});

test("it does not drift from the phase plan, target model, write contracts or RLS model", () => {
  const d = checkDrift();
  eq(d.errors.length, 0, `drift:\n      ${d.errors.join("\n      ")}`);
});

test("all sixteen required states exist with a declared scope", () => {
  eq(states().length, 16, "state count");
  for (const s of states()) assert(["GLOBAL", "DOMAIN", "APP"].includes(stateDef(s).scope), `${s} scope`);
});

test("every state says what schema exists, where reads come from and where writes go", () => {
  for (const s of states()) {
    const d = stateDef(s);
    assert(d.schema && d.reads && d.writes, `${s} is under-specified`);
  }
});

test("every state has a rollback class", () => {
  for (const s of states()) assert(rollbackClass(s), `${s} has no rollback class`);
});

// --- negative fixtures for the validator itself: it must detect each ordering mistake ---

test("NEGATIVE: the validator rejects a missing state", () => {
  const d = clone(); d.states = d.states.filter((s) => s.id !== "LEGACY_FROZEN");
  useChoreography(d);
  assert(validateChoreography(d).errors.some((e) => /required state missing: LEGACY_FROZEN/.test(e)), "not detected");
  resetChoreography();
});

test("NEGATIVE: the validator rejects the fence placed after the read cutover", () => {
  const d = clone();
  const i = d.states.findIndex((s) => s.id === "LEGACY_WRITE_DISABLED");
  const j = d.states.findIndex((s) => s.id === "NEW_READ_PRIMARY");
  [d.states[i], d.states[j]] = [d.states[j], d.states[i]];
  assert(validateChoreography(d).errors.some((e) => /OI-4/.test(e)),
    "a fence after the read cutover must be rejected: the normalized side would be knowably incomplete");
});

test("NEGATIVE: the validator rejects the freeze placed before the read cutover", () => {
  const d = clone();
  const i = d.states.findIndex((s) => s.id === "NEW_READ_PRIMARY");
  const j = d.states.findIndex((s) => s.id === "LEGACY_FROZEN");
  [d.states[i], d.states[j]] = [d.states[j], d.states[i]];
  assert(validateChoreography(d).errors.some((e) => /cheap rollback never exists/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects a state with no rollback class", () => {
  const d = clone(); delete d.states[5].rollbackClass;
  assert(validateChoreography(d).errors.some((e) => /no rollbackClass/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects an unreachable state", () => {
  const d = clone();
  d.transitions = d.transitions.filter((t) => t.to !== "LEGACY_RETIRED");
  assert(validateChoreography(d).errors.some((e) => /LEGACY_RETIRED is unreachable/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects a flag missing any of its five required properties", () => {
  for (const k of ["owner", "default", "scope", "rollbackMeaning", "retirementCondition"]) {
    const d = clone(); delete d.flags[0][k];
    assert(validateChoreography(d).errors.some((e) => new RegExp(`no ${k}`).test(e)), `${k} not required`);
  }
});

test("NEGATIVE: the validator rejects a domain with no race strategy", () => {
  const d = clone(); delete d.domains[4].raceStrategy;
  assert(validateChoreography(d).errors.some((e) => /no race strategy/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects a financial domain that does not require FINANCIAL_PARITY", () => {
  const d = clone();
  const p = d.domains.find((x) => x.id === "payments");
  p.parity = p.parity.filter((c) => c !== "FINANCIAL_PARITY");
  assert(validateChoreography(d).errors.some((e) => /financial but does not require FINANCIAL_PARITY/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects row count offered as a domain's only parity", () => {
  const d = clone();
  const e = d.domains.find((x) => x.id === "entries");
  e.parity = ["ROW_COUNT_PARITY"];
  assert(validateChoreography(d).errors.some((x) => /row count alone is not parity/.test(x)), "not detected");
});

test("NEGATIVE: the validator rejects an old-client cell marked DATA_CORRUPTION_RISK", () => {
  const d = clone();
  d.oldClientMatrix.byState.SERVER_WRITE_PRIMARY.WRITE = "DATA_CORRUPTION_RISK";
  assert(validateChoreography(d).errors.some((e) => /DATA_CORRUPTION_RISK/.test(e)),
    "no state may permit a corrupting old-client operation");
});

test("NEGATIVE: the validator rejects an illegal example that a transition actually declares", () => {
  const d = clone();
  d.transitions.push({ from: "LEGACY_ONLY", to: "SERVER_WRITE_PRIMARY", guards: [], why: "injected" });
  assert(validateChoreography(d).errors.some((e) => /listed as illegal but a transition declares it/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects more than one irreversible deployment step", () => {
  const d = clone(); d.deploymentOrder[3].irreversible = true;
  assert(validateChoreography(d).errors.some((e) => /exactly one irreversible/.test(e)), "not detected");
});

test("NEGATIVE: the validator rejects a backward deployment dependency", () => {
  const d = clone(); d.deploymentOrder[5].dependsOn = [9];
  assert(validateChoreography(d).errors.some((e) => /not earlier/.test(e)), "not detected");
});

test("NEGATIVE: the drift checker notices a readiness row claiming a draft that does not exist", () => {
  const d = clone(); d.readinessMatrix.rows.M13.DRAFT_READY = "YES";
  useChoreography(d);
  assert(checkDrift().errors.some((e) => /DRAFT_READY is YES, expected n\/a/.test(e)),
    "M11+ have no SQL drafts and must not claim one");
  resetChoreography();
});

test("NEGATIVE: the drift checker notices a dropped entry from the ratified correction allowlist", () => {
  const d = clone();
  const adm1 = d.cutoverGates.admin.requirements.find((r) => r.id === "ADM-1");
  adm1.meaning = adm1.meaning.replace("participants.email, ", "");
  useChoreography(d);
  assert(checkDrift().errors.some((e) => /omits the ratified correctable field participants\.email/.test(e)), "not detected");
  resetChoreography();
});

test("NEGATIVE: the drift checker notices R-GAP-1 being quietly closed", () => {
  const d = clone(); d.cutoverGates.admin.rGap1.status = "CLOSED";
  useChoreography(d);
  assert(checkDrift().errors.some((e) => /R-GAP-1 is not OPEN/.test(e)), "not detected");
  resetChoreography();
});

test("every target-model entity belongs to exactly one migration domain", () => {
  eq(checkDrift().errors.filter((e) => /belongs to no migration domain/.test(e)).length, 0, "orphan entity");
});

// =============================================================================================
console.log("\nState transitions — the happy path must work and the shortcuts must not\n");
// =============================================================================================

const FULL_CTX = {
  schemaExpanded: true, referenceRowsPresent: true, auditInfrastructurePresent: true,
  bulkPassComplete: true, deltaPassComplete: true, noUnresolvedDelta: true,
  normalizedReadsShadow: true, backfillComplete: true, parityHarnessRunning: true,
  parityEvidenceSufficient: true, writeContractsDeployed: true, canaryEvidenceSufficient: true,
  serverWritesEnabled: true, idempotencyVerified: true, staleClientFenceReady: true,
  writeErrorRateAcceptable: true, normalizedReadsEnabled: true, finalCatchupComplete: true,
  frozenSourceParity: true, legacyDocumentStillWritten: true, soakComplete: true,
  allDomainsCutoverReady: true, scoringParityExact: true, financialReconciled: true,
  operatorAuthorization: true, hardClientFloorEnforced: true, zeroLegacyReadsObserved: true,
  observationWindowExceedsLongestSession: true, legacyReadFallback: false,
  restoreRehearsed: true, backupVerified: true, newReadPrimary: false,
};

test("the whole happy path is legal, step by step, with sufficient evidence", () => {
  for (let i = 0; i < HAPPY_PATH.length - 1; i++) {
    const from = HAPPY_PATH[i], to = HAPPY_PATH[i + 1];
    // PARITY_OBSERVATION's exit depends on whether reads have already cut over.
    const ctx = { ...FULL_CTX, newReadPrimary: HAPPY_PATH.slice(0, i + 1).includes("NEW_READ_PRIMARY") };
    const r = canTransition(from, to, ctx);
    assert(r.allowed, `${from} → ${to}: ${r.reason}`);
  }
});

test("the path reaches CONTRACT_ELIGIBLE and stops there — nothing is dropped", () => {
  eq(HAPPY_PATH[HAPPY_PATH.length - 1], "CONTRACT_ELIGIBLE", "the path must stop before retirement");
});

test("LEGACY_RETIRED requires a rehearsed restore and explicit authorization", () => {
  assert(canTransition("CONTRACT_ELIGIBLE", "LEGACY_RETIRED", FULL_CTX).allowed, "should be reachable with full evidence");
  assert(!canTransition("CONTRACT_ELIGIBLE", "LEGACY_RETIRED", { ...FULL_CTX, restoreRehearsed: false }).allowed,
    "the irreversible step must require a rehearsed restore");
  assert(!canTransition("CONTRACT_ELIGIBLE", "LEGACY_RETIRED", { ...FULL_CTX, operatorAuthorization: false }).allowed,
    "the irreversible step must require operator authorization");
});

test("every declared illegal transition is in fact refused", () => {
  for (const ex of loadChoreography().illegalTransitionExamples) {
    const r = canTransition(ex.from, ex.to, FULL_CTX);
    assert(!r.allowed, `${ex.from} → ${ex.to} was permitted; it must not be (${ex.why})`);
    eq(r.verdict, "ILLEGAL_TRANSITION", `${ex.from} → ${ex.to} must be structurally illegal, not merely guard-blocked`);
  }
});

test("LEGACY_ONLY → SERVER_WRITE_PRIMARY is refused even with every flag set true", () => {
  const r = canTransition("LEGACY_ONLY", "SERVER_WRITE_PRIMARY", FULL_CTX);
  assert(!r.allowed, "no amount of claimed evidence may create a transition that does not exist");
});

test("DOMAIN_BACKFILLING → CONTRACT_ELIGIBLE is refused", () => {
  assert(!canTransition("DOMAIN_BACKFILLING", "CONTRACT_ELIGIBLE", FULL_CTX).allowed, "permitted");
});

test("NEW_READ_PRIMARY is unreachable before parity is measured", () => {
  const r = canTransition("LEGACY_WRITE_DISABLED", "NEW_READ_PRIMARY", { ...FULL_CTX, parityEvidenceSufficient: false });
  assert(!r.allowed, "the read cutover proceeded without parity evidence");
  assert(r.failures.some((f) => f.key === "parityEvidenceSufficient"), "wrong guard blocked it");
});

test("LEGACY_RETIRED is unreachable while the legacy read fallback is still armed", () => {
  const r = canTransition("LEGACY_FROZEN", "CONTRACT_ELIGIBLE", { ...FULL_CTX, legacyReadFallback: true });
  assert(!r.allowed, "contract eligibility was granted with the fallback armed");
});

test("an unmeasured guard blocks exactly as a false one does, but is reported differently", () => {
  const r = canTransition("EXPANDED_SCHEMA", "REFERENCE_BACKFILLED", {});
  assert(!r.allowed, "an unmeasured guard must block");
  eq(r.unmeasured[0], "referenceRowsPresent", "unmeasured guard not reported as such");
  const g = evaluateGuard("referenceRowsPresent", {});
  eq(g.reason, "UNMEASURED", "reason");
  eq(evaluateGuard("referenceRowsPresent", { referenceRowsPresent: false }).reason, "FALSE", "reason");
});

/**
 * KPLUS-F053. This test used to assert that absence SATISFIES a negation, which contradicted both the
 * test directly above it and evaluateGuard's own docstring: the same absence of evidence refused `foo`
 * and approved `!foo`. It was not academic — `LEGACY_FROZEN → CONTRACT_ELIGIBLE` crosses a point of no
 * simple return behind `!legacyReadFallback`, and that guard passed without anyone having measured
 * whether the fallback was armed. Absence now refuses in both directions; a guard still has to be
 * measured false to satisfy a negation.
 */
test("a negated guard is satisfied only by a measured false — never by absence", () => {
  assert(!evaluateGuard("!newReadPrimary", {}).satisfied, "absence must not satisfy a negation");
  eq(evaluateGuard("!newReadPrimary", {}).reason, "UNMEASURED", "absence must be reported as unmeasured");
  assert(evaluateGuard("!newReadPrimary", { newReadPrimary: false }).satisfied, "a measured false should satisfy");
  assert(!evaluateGuard("!newReadPrimary", { newReadPrimary: true }).satisfied, "true must not satisfy");
});

test("the point-of-no-simple-return crossing refuses when its negated guard was never measured", () => {
  const { legacyReadFallback, ...withoutFallbackEvidence } = FULL_CTX;
  const r = canTransition("LEGACY_FROZEN", "CONTRACT_ELIGIBLE", withoutFallbackEvidence);
  assert(!r.allowed, "contract eligibility was granted without anyone measuring the legacy read fallback");
  assert(r.unmeasured.includes("legacyReadFallback"), "the unmeasured guard was not named");
});

test("PARITY_OBSERVATION's two exits are disambiguated by flag state, not by history", () => {
  const pre = canTransition("PARITY_OBSERVATION", "SERVER_WRITE_CANARY", { ...FULL_CTX, newReadPrimary: false });
  const post = canTransition("PARITY_OBSERVATION", "CUTOVER_READY", { ...FULL_CTX, newReadPrimary: true });
  assert(pre.allowed, "the pre-cutover exit must be available before the read cutover");
  assert(post.allowed, "the post-cutover exit must be available after it");
  assert(!canTransition("PARITY_OBSERVATION", "SERVER_WRITE_CANARY", { ...FULL_CTX, newReadPrimary: true }).allowed,
    "the pre-cutover exit must close once reads have cut over");
  assert(!canTransition("PARITY_OBSERVATION", "CUTOVER_READY", { ...FULL_CTX, newReadPrimary: false }).allowed,
    "the post-cutover exit must not open before the read cutover");
});

test("a failed parity run has a route back, pre- and post-cutover, and they differ", () => {
  assert(canTransition("PARITY_OBSERVATION", "DUAL_READ_SHADOW", { newReadPrimary: false }).allowed,
    "pre-cutover parity failure must be able to return to shadow");
  assert(canTransition("PARITY_OBSERVATION", "LEGACY_READ_FALLBACK", { newReadPrimary: true }).allowed,
    "post-cutover parity failure must be able to fall back to legacy reads");
});

test("re-promotion after a fallback requires fresh evidence", () => {
  assert(!canTransition("LEGACY_READ_FALLBACK", "NEW_READ_PRIMARY", { normalizedReadsEnabled: true }).allowed,
    "re-promotion must not inherit the evidence that preceded the failure");
  assert(canTransition("LEGACY_READ_FALLBACK", "NEW_READ_PRIMARY",
    { normalizedReadsEnabled: true, parityEvidenceSufficient: true }).allowed, "should be allowed with fresh evidence");
});

test("unknown states are rejected rather than silently treated as new", () => {
  throws(() => canTransition("NOT_A_STATE", "LEGACY_ONLY"), /UNKNOWN_STATE/, "unknown from-state accepted");
  throws(() => canTransition("LEGACY_ONLY", "NOT_A_STATE"), /UNKNOWN_STATE/, "unknown to-state accepted");
});

test("legalNext reports only what the evidence actually permits", () => {
  eq(legalNext("LEGACY_ONLY", {}).length, 0, "nothing should be legal with no evidence");
  assert(legalNext("LEGACY_ONLY", { schemaExpanded: true }).includes("EXPANDED_SCHEMA"), "expansion should be legal");
});

// =============================================================================================
console.log("\nRollback classes and points of no simple return\n");
// =============================================================================================

test("every state up to and including CUTOVER_READY is reversible without a restore", () => {
  const upto = HAPPY_PATH.slice(0, HAPPY_PATH.indexOf("LEGACY_FROZEN"));
  for (const s of upto) assert(rollbackClass(s) !== "FORWARD_FIX_ONLY", `${s} must still be reversible`);
});

test("LEGACY_FROZEN is the first state that is not reversible by a flag", () => {
  assert(isReversibleByFlag("NEW_READ_PRIMARY"), "the read cutover must be flag-reversible");
  assert(isReversibleByFlag("CUTOVER_READY"), "cutover-ready must be flag-reversible");
  assert(!isReversibleByFlag("LEGACY_FROZEN"), "the freeze must not be flag-reversible");
  eq(rollbackClass("LEGACY_FROZEN"), "FORWARD_FIX_ONLY", "freeze rollback class");
});

test("the fence's rollback is a privilege write, not a flag flip", () => {
  eq(rollbackClass("LEGACY_WRITE_DISABLED"), "WRITE_PATH_ROLLBACK", "fence rollback class");
  const s = stateDef("LEGACY_WRITE_DISABLED");
  assert(/GRANT/.test(s.rollbackNote), "the fence rollback must state that it is a GRANT");
});

test("LEGACY_RETIRED requires a data restore to reverse", () => {
  eq(rollbackClass("LEGACY_RETIRED"), "DATA_RESTORE_REQUIRED", "retirement rollback class");
});

test("the points of no simple return accumulate in order", () => {
  eq(pointsOfNoSimpleReturnAt("LEGACY_ONLY").length, 0, "nothing crossed at the start");
  const atFreeze = pointsOfNoSimpleReturnAt("LEGACY_FROZEN").map((p) => p.id);
  assert(atFreeze.includes("PNSR-5"), "the freeze boundary must be recorded at the freeze");
  assert(atFreeze.includes("PNSR-1"), "earlier boundaries must still be counted");
  assert(!pointsOfNoSimpleReturnAt("DUAL_READ_SHADOW").some((p) => p.id === "PNSR-5"), "the freeze boundary is not crossed early");
});

test("the allocations boundary is crossed while the STATE is still reversible — they are different questions", () => {
  const p = loadChoreography().pointsOfNoSimpleReturn.find((x) => x.id === "PNSR-1");
  eq(p.state, "SERVER_WRITE_CANARY", "PNSR-1 state");
  assert(isReversibleByFlag("SERVER_WRITE_CANARY") === false, "canary is a write-path rollback");
  assert(/FORWARD_FIX_ONLY/.test(p.rollbackFrom), "the DATA is not reversible even though the state is");
  assert(/different questions|even though the STATE/.test(p.subtlety + p.rollbackFrom),
    "the distinction between a reversible state and irreversible data must be spelled out");
});

// =============================================================================================
console.log("\nFeature flags\n");
// =============================================================================================

test("all eight required flags exist and every rule has a bound predicate", () => {
  eq(flags().length, 8, "flag count");
  const ruleIds = loadChoreography().flagRules.map((r) => r.id);
  for (const r of ruleIds) assert(boundFlagRuleIds().includes(r), `${r} has no predicate — it is prose, not a rule`);
  eq(boundFlagRuleIds().length, ruleIds.length, "predicate/rule count mismatch");
});

test("every flag defaults to the pre-migration behaviour", () => {
  const d = flagDefaults();
  eq(d.normalized_reads_enabled, false, "reads must default to legacy");
  eq(d.server_writes_enabled, false, "server writes must default off");
  eq(d.legacy_writes_allowed, true, "legacy writes must default allowed");
  eq(d.outbox_delivery_enabled, false, "delivery must default off");
  eq(d.new_reporting_enabled, false, "new reporting must default off");
});

test("the canary flag defaults to the RESTRICTIVE value", () => {
  eq(flagDefaults().server_write_canary, true,
    "a flag whose default widens the blast radius fails open; this one must default restrictive");
});

test("the default configuration is valid — a client that cannot fetch flags is safe", () => {
  assert(validateFlags({}, {}).ok, "the defaults must be a legal configuration with no other facts known");
});

// One negative fixture per rule. A rule that cannot be made to fire is not enforcing anything.
const FLAG_NEGATIVES = {
  "FR-1": [{ server_writes_enabled: true }, { schemaExpanded: false, backfillComplete: true, writeContractsDeployed: true }],
  "FR-2": [{ server_writes_enabled: true }, { schemaExpanded: true, backfillComplete: false, writeContractsDeployed: true }],
  "FR-3": [{ normalized_reads_enabled: true, legacy_writes_allowed: false }, { backfillComplete: false, serverWritesPrimary: true }],
  "FR-4": [{ normalized_reads_enabled: true, legacy_writes_allowed: false }, { backfillComplete: true, serverWritesPrimary: false }],
  "FR-5": [{ legacy_writes_allowed: false }, { staleClientFenceReady: false, legacyWriteDeniedAtDatabase: true }],
  "FR-6": [{ legacy_writes_allowed: false, server_writes_enabled: true }, { staleClientFenceReady: true, schemaExpanded: true, backfillComplete: true, writeContractsDeployed: true, legacyWriteDeniedAtDatabase: false }],
  "FR-7": [{ outbox_delivery_enabled: true }, { idempotencyVerified: false }],
  "FR-8": [{ outbox_delivery_enabled: true }, { idempotencyVerified: true, deliveryIdempotencyVerified: true, deadLetterDefined: true, replayControlsDefined: true, historicalLookingEventsInBacklog: true }],
  "FR-9": [{ new_reporting_enabled: true }, { financialReconciled: false }],
  "FR-10": [{ server_write_canary: false }, { canaryEvidenceSufficient: false }],
  "FR-11": [{ legacy_read_fallback: true }, { atOrPastLegacyFrozen: true }],
  "FR-12": [{ normalized_reads_shadow: true, normalized_reads_enabled: true, legacy_writes_allowed: false }, { backfillComplete: true, serverWritesPrimary: true }],
  "FR-13": [{ server_writes_enabled: true }, { schemaExpanded: true, backfillComplete: true, writeContractsDeployed: false }],
  "FR-14": [{ normalized_reads_enabled: true, legacy_writes_allowed: true }, { backfillComplete: true, serverWritesPrimary: true }],
};

for (const [id, [flagState, ctx]] of Object.entries(FLAG_NEGATIVES)) {
  test(`NEGATIVE: ${id} fires on the combination it forbids`, () => {
    const r = validateFlags(flagState, ctx);
    assert(!r.ok, `${id}: the forbidden combination was accepted`);
    assert(r.violations.some((v) => v.id === id), `${id} did not fire; got ${r.violations.map((v) => v.id).join(",")}`);
  });
}

test("every declared rule has a negative fixture — an unfired rule is unproven", () => {
  for (const r of loadChoreography().flagRules) {
    assert(FLAG_NEGATIVES[r.id], `${r.id} has no negative fixture, so nothing proves it can block`);
  }
});

test("NEGATIVE: a rule with no predicate is reported rather than silently skipped", () => {
  const d = clone();
  d.flagRules.push({ id: "FR-999", rule: "invented", severity: "CRITICAL", why: "test" });
  useChoreography(d);
  const r = validateFlags({}, {});
  assert(r.violations.some((v) => v.id === "FR-999" && v.reason === "NO_PREDICATE_BOUND"),
    "an unimplemented rule must be reported, not treated as satisfied");
  resetChoreography();
});

test("the fence flag is documented as the UX half only", () => {
  const f = flags().find((x) => x.id === "legacy_writes_allowed");
  assert(/NOT the fence/.test(f.criticalNote), "the flag must state it is not the fence");
  assert(/privilege/.test(f.criticalNote), "it must name the actual enforcement mechanism");
});

// =============================================================================================
console.log("\nOld client compatibility\n");
// =============================================================================================

test("the matrix is total over every state and operation", () => {
  const ops = loadChoreography().oldClientMatrix.operations;
  for (const s of states()) for (const op of ops) {
    const c = oldClientClassification(s, op);
    assert(CLASSIFICATIONS.includes(c), `${s}.${op} = ${c}`);
  }
});

test("no state classifies any old-client operation as DATA_CORRUPTION_RISK", () => {
  const ops = loadChoreography().oldClientMatrix.operations;
  for (const s of states()) for (const op of ops) {
    assert(oldClientClassification(s, op) !== "DATA_CORRUPTION_RISK", `${s}.${op} risks corruption`);
  }
});

test("an old tab can still write through every additive state", () => {
  for (const s of ["EXPANDED_SCHEMA", "REFERENCE_BACKFILLED", "DOMAIN_BACKFILLING", "DOMAIN_BACKFILLED",
    "DUAL_READ_SHADOW", "PARITY_OBSERVATION", "SERVER_WRITE_CANARY", "SERVER_WRITE_PRIMARY"]) {
    assert(oldClientOutcome(s, "SUBMIT_PREDICTION").proceed, `${s} broke an old tab's write`);
  }
});

test("an old tab's write is refused from the fence onward, distinguishably and without mutation", () => {
  for (const s of ["LEGACY_WRITE_DISABLED", "NEW_READ_PRIMARY", "CUTOVER_READY", "LEGACY_FROZEN", "CONTRACT_ELIGIBLE"]) {
    const o = oldClientOutcome(s, "SUBMIT_PREDICTION");
    assert(!o.proceed, `${s} still permitted a legacy write`);
    eq(o.response, "CLIENT_TOO_OLD", `${s} refusal code`);
    eq(o.partialMutation, false, `${s} partial mutation`);
    eq(o.distinguishable, true, `${s} refusal must be distinguishable from a transient error`);
  }
});

test("an old tab's READ stays safe until the freeze, and is marked stale after it", () => {
  for (const s of ["LEGACY_WRITE_DISABLED", "NEW_READ_PRIMARY", "CUTOVER_READY", "LEGACY_READ_FALLBACK"]) {
    eq(oldClientOutcome(s, "READ").response, "OK", `${s} read`);
  }
  eq(oldClientOutcome("LEGACY_FROZEN", "READ").response, "OK_STALE",
    "after the freeze the document is stale and the read must be recognised as such");
  eq(oldClientOutcome("LEGACY_RETIRED", "READ").proceed, false, "after retirement the read must fail");
});

test("the read classification changes exactly at the freeze — which is why the floor precedes it", () => {
  eq(oldClientClassification("CUTOVER_READY", "READ"), "SAFE_WITH_LEGACY_PATH", "before the freeze");
  eq(oldClientClassification("LEGACY_FROZEN", "READ"), "READ_ONLY", "at the freeze");
});

test("an unknown operation is rejected rather than defaulted to safe", () => {
  throws(() => oldClientClassification("LEGACY_ONLY", "DROP_EVERYTHING"), /UNKNOWN_OPERATION/, "accepted");
});

// =============================================================================================
console.log("\nClient capability and write-shape adaptation\n");
// =============================================================================================

test("a capability claim never grants authority", () => {
  eq(capabilityGrantsAuthority(), false, "a client-supplied capability must never widen permission");
});

test("a client declaring no contract version is refused", () => {
  eq(classifyWriteShape({ minimumWriteVersion: 2 }).action, "REJECT", "no version must be refused");
});

test("an unrecognized shape is refused and never partially applied", () => {
  const r = classifyWriteShape({ contractVersion: 3, minimumWriteVersion: 2, shape: "unrecognized" });
  eq(r.action, "REJECT", "unrecognized shape");
  eq(r.code, "CLIENT_TOO_OLD", "code");
});

test("a lossless adaptation is accepted and records that an adapter was used", () => {
  const r = classifyWriteShape({ contractVersion: 1, minimumWriteVersion: 2 });
  eq(r.action, "ADAPT", "should adapt");
  eq(r.adapterUsed, true, "adapter use must be recorded so we learn when it can be deleted");
});

test("NEGATIVE: the adapter refuses to default a monetary field", () => {
  for (const f of ["amount", "amount_minor", "currency", "expected_fee_amount"]) {
    const r = classifyWriteShape({ contractVersion: 1, minimumWriteVersion: 2, missingFields: [f] });
    eq(r.action, "REJECT", `${f} was defaulted`);
    assert(/monetary/.test(r.why), `${f} rejection must cite the money rule`);
  }
});

test("NEGATIVE: an operator action is never adapted (WS5-F10)", () => {
  const r = classifyWriteShape({ contractVersion: 1, minimumWriteVersion: 2, operation: "ADMIN_ACTION" });
  eq(r.action, "REJECT", "an admin action below the floor must be refused, not adapted");
  const participant = classifyWriteShape({ contractVersion: 1, minimumWriteVersion: 2, operation: "SUBMIT_PREDICTION" });
  eq(participant.action, "ADAPT", "a participant prediction is the case the adapter exists for");
});

test("a current client is accepted without an adapter", () => {
  const r = classifyWriteShape({ contractVersion: 3, minimumWriteVersion: 2 });
  eq(r.action, "ACCEPT", "current client");
  assert(!r.adapterUsed, "no adapter should be involved");
});

// =============================================================================================
console.log("\nParity contracts\n");
// =============================================================================================

test("every domain declares its parity classes and a race strategy with a reason", () => {
  for (const id of domains()) {
    const d = domainDef(id);
    assert(d.raceStrategy && d.raceWhy, `${id} under-specified`);
    assert(Array.isArray(d.parity), `${id} has no parity list`);
  }
});

test("row count alone never passes for a domain that requires more", () => {
  const r = evaluateParity("payments", { ROW_COUNT_PARITY: { checked: 10, mismatches: 0 } });
  assert(!r.ok, "row count alone was accepted as parity");
  assert(r.missing.includes("FINANCIAL_PARITY"), "the financial class must be reported missing");
  eq(r.verdict, "HOLD", "missing evidence must hold");
});

test("NEGATIVE: a financial mismatch of one aborts rather than holds", () => {
  const r = evaluateParity("payments", {
    ROW_COUNT_PARITY: { checked: 10, mismatches: 0 }, KEY_PARITY: { checked: 10, mismatches: 0 },
    VALUE_PARITY: { checked: 10, mismatches: 0 }, AGGREGATE_PARITY: { checked: 10, mismatches: 0 },
    FINANCIAL_PARITY: { checked: 10, mismatches: 1 },
  });
  eq(r.verdict, "ABORT", "a financial mismatch must abort");
  assert(r.financialOrScoringFailure, "zero-tolerance failure not flagged");
});

test("NEGATIVE: a scoring mismatch of one aborts", () => {
  const r = evaluateParity("predictions", {
    ROW_COUNT_PARITY: { checked: 5, mismatches: 0 }, KEY_PARITY: { checked: 5, mismatches: 0 },
    VALUE_PARITY: { checked: 5, mismatches: 0 }, SCORING_PARITY: { checked: 5, mismatches: 1 },
  });
  eq(r.verdict, "ABORT", "a scoring mismatch must abort");
});

test("NEGATIVE: a check that examined zero rows is vacuous, not clean", () => {
  const r = evaluateParity("entries", {
    ROW_COUNT_PARITY: { checked: 0, mismatches: 0 }, KEY_PARITY: { checked: 0, mismatches: 0 },
    VALUE_PARITY: { checked: 0, mismatches: 0 },
  });
  assert(!r.ok, "a check over zero rows was accepted as a pass");
  eq(r.vacuous.length, 3, "all three should be vacuous");
  eq(r.verdict, "HOLD", "vacuous evidence must hold");
});

test("a full clean result passes", () => {
  const r = evaluateParity("entries", {
    ROW_COUNT_PARITY: { checked: 4, mismatches: 0 }, KEY_PARITY: { checked: 4, mismatches: 0 },
    VALUE_PARITY: { checked: 4, mismatches: 0 },
  });
  eq(r.verdict, "PASS", "clean full evidence should pass");
});

test("an unknown domain is rejected rather than defaulted", () => {
  throws(() => evaluateParity("not_a_domain", {}), /UNKNOWN_DOMAIN/, "accepted");
});

// =============================================================================================
console.log("\nObservation windows\n");
// =============================================================================================

test("a financial domain needs five clean runs, 72 hours and observed mutations", () => {
  assert(!evaluateObservationWindow("payments", { cleanRuns: 4, hours: 72, mutationsInWindow: 3, unresolvedDelta: 0 }).ok, "4 runs accepted");
  assert(!evaluateObservationWindow("payments", { cleanRuns: 5, hours: 24, mutationsInWindow: 3, unresolvedDelta: 0 }).ok, "24h accepted");
  assert(evaluateObservationWindow("payments", { cleanRuns: 5, hours: 72, mutationsInWindow: 3, unresolvedDelta: 0 }).ok, "full evidence refused");
});

test("NEGATIVE: a window with clean runs and zero mutations is vacuous (WS5-F5)", () => {
  const r = evaluateObservationWindow("entries", { cleanRuns: 99, hours: 999, mutationsInWindow: 0 });
  assert(!r.ok, "a window in which nobody wrote was accepted as evidence about the live write path");
  assert(r.reasons.some((x) => /VACUOUS/.test(x)), "vacuity not reported");
});

test("a reference domain with no live writer is not required to observe a mutation", () => {
  const r = evaluateObservationWindow("competition_editions", { cleanRuns: 1, hours: 1, mutationsInWindow: 0 });
  assert(r.ok, "requiring a mutation from a domain that has no writer would be requiring the impossible");
});

test("NEGATIVE: an unmeasured unresolved delta blocks a financial domain", () => {
  const r = evaluateObservationWindow("payments", { cleanRuns: 5, hours: 72, mutationsInWindow: 3 });
  assert(!r.ok, "an unmeasured delta was accepted");
  assert(r.reasons.some((x) => /not measured/.test(x)), "not reported");
});

test("NEGATIVE: a nonzero unresolved delta blocks a financial domain", () => {
  const r = evaluateObservationWindow("payments", { cleanRuns: 5, hours: 72, mutationsInWindow: 3, unresolvedDelta: 1 });
  assert(!r.ok, "a single unresolved financial item was accepted");
});

test("NEGATIVE: a scoring domain must show the app's own audit suites passing", () => {
  const r = evaluateObservationWindow("predictions", { cleanRuns: 5, hours: 72, mutationsInWindow: 3, unresolvedDelta: 0 });
  assert(!r.ok, "a scoring domain was promoted without the app's audit suites");
  const ok = evaluateObservationWindow("predictions", { cleanRuns: 5, hours: 72, mutationsInWindow: 3, unresolvedDelta: 0, appAuditSuitesPass: true });
  assert(ok.ok, "full scoring evidence refused");
});

// =============================================================================================
console.log("\nCutover gates\n");
// =============================================================================================

test("the four gates exist and every requirement is conjunctive", () => {
  for (const n of ["financial", "prediction", "result", "admin"]) {
    const g = gate(n);
    assert(g.allRequired === true, `${n} gate is not conjunctive`);
    assert(g.requirements.length > 0, `${n} gate has no requirements`);
  }
});

test("NEGATIVE: each financial requirement, alone, blocks the gate", () => {
  const all = Object.fromEntries(gate("financial").requirements.map((r) => [r.check, true]));
  assert(evaluateGate("financial", all).ok, "the fully satisfied gate must pass");
  for (const r of gate("financial").requirements) {
    const evidence = { ...all, [r.check]: false };
    const g = evaluateGate("financial", evidence);
    assert(!g.ok, `${r.id} does not block when false — it is decoration`);
    assert(g.unmet.some((u) => u.id === r.id), `${r.id} not reported`);
  }
});

test("NEGATIVE: each prediction requirement, alone, blocks the gate", () => {
  const all = Object.fromEntries(gate("prediction").requirements.map((r) => [r.check, true]));
  all.NO_OPEN_CUTOFF = true;
  assert(evaluateGate("prediction", all).ok, "the satisfied prediction gate must pass");
  for (const r of gate("prediction").requirements) {
    assert(!evaluateGate("prediction", { ...all, [r.check]: false }).ok, `${r.id} does not block`);
  }
});

test("NEGATIVE: the prediction gate blocks while a cutoff is open", () => {
  const all = Object.fromEntries(gate("prediction").requirements.map((r) => [r.check, true]));
  const g = evaluateGate("prediction", { ...all, NO_OPEN_CUTOFF: false });
  assert(!g.ok, "a prediction cutover during an open cutoff was permitted");
  assert(g.unmet.some((u) => /TIMING/.test(u.id)), "the timing constraint was not the blocker");
});

test("NEGATIVE: the result gate blocks during an active sync", () => {
  const all = Object.fromEntries(gate("result").requirements.map((r) => [r.check, true]));
  assert(evaluateGate("result", { ...all, NO_ACTIVE_SYNC: true }).ok, "satisfied result gate must pass");
  assert(!evaluateGate("result", { ...all, NO_ACTIVE_SYNC: false }).ok, "a switch during an active sync was permitted");
});

test("unmeasured evidence is not satisfied evidence", () => {
  const g = evaluateGate("financial", {});
  assert(!g.ok, "an empty evidence bag passed a gate");
  assert(g.unmet.every((u) => u.reason === "UNMEASURED"), "should all be unmeasured");
  eq(g.unmet.length, gate("financial").requirements.length, "every requirement should be unmet");
});

test("the prediction gate names the server-side cutoff explicitly", () => {
  const r = gate("prediction").requirements.find((x) => x.id === "PRED-2");
  assert(/clock manipulation/.test(r.meaning),
    "the gate must name the existing client-side cutoff gap so the cutover does not carry it forward");
});

test("the admin gate reproduces the ratified allowlist and forbids a generic update", () => {
  const g = gate("admin");
  const adm2 = g.requirements.find((r) => r.id === "ADM-2");
  assert(/no 'update anything'/i.test(adm2.meaning), "the no-generic-endpoint requirement is missing");
  for (const f of ["pool_entries.entry_label", "participants.display_name", "participants.email",
    "pools.name", "pools.status", "matches.status"]) {
    assert(g.requirements.find((r) => r.id === "ADM-1").meaning.includes(f), `${f} missing from the allowlist`);
  }
});

test("the admin gate keeps R-GAP-1 open and does not claim DB-native operator auth", () => {
  const r = gate("admin").rGap1;
  eq(r.status, "OPEN", "R-GAP-1 status");
  assert(/NO database-verifiable operator principal/i.test(r.claim), "the gap must be stated plainly");
  assert(/does not pretend|not mitigate/i.test(r.consequence), "RLS must not be claimed as mitigation");
});

test("the result gate forbids two competing authorities and requires the old writer to be stopped", () => {
  const g = gate("result");
  assert(/exactly ONE writer/.test(g.singleAuthorityRule), "single-authority rule missing");
  const step2 = g.authoritySwitch.find((s) => s.step === 2);
  assert(/STOPPED, not merely superseded/.test(step2.requirement),
    "a superseded writer that still runs is a second authority, and the gate must say so");
});

test("gateForDomain routes each domain to the right gate", () => {
  eq(gateForDomain("payments"), "financial", "payments");
  eq(gateForDomain("predictions"), "prediction", "predictions");
  eq(gateForDomain("results"), "result", "results");
  eq(gateForDomain("entries"), null, "entries needs no dedicated gate");
});

// =============================================================================================
console.log("\nAbort criteria\n");
// =============================================================================================

test("all nine abort criteria have bound predicates", () => {
  const ids = loadChoreography().abortCriteria.map((a) => a.id);
  eq(ids.length, 9, "criterion count");
  for (const i of ids) assert(boundAbortCriterionIds().includes(i), `${i} has no predicate`);
});

test("a clean world does not abort", () => {
  assert(!checkAbortCriteria({}).abort, "an empty observation set must not abort");
});

const ABORT_NEGATIVES = {
  "AC-1": { financialMismatchCount: 1 }, "AC-2": { scoringMismatch: 1 },
  "AC-3": { authorizationRegression: true }, "AC-4": { schemaDrift: true },
  "AC-5": { backfillConflictSeverity: "FATAL" }, "AC-6": { outboxDuplicates: 1 },
  "AC-7": { errorRateSpike: true }, "AC-8": { unrecognizedStaleClientBehaviour: true },
  "AC-9": { idempotencyStoreUnavailable: true },
};
for (const [id, obs] of Object.entries(ABORT_NEGATIVES)) {
  test(`NEGATIVE: ${id} fires on its condition`, () => {
    const r = checkAbortCriteria(obs);
    assert(r.abort, `${id} did not abort`);
    assert(r.triggered.some((t) => t.id === id), `${id} not the trigger`);
  });
}

test("AC-5 fires on CONFLICT as well as FATAL, and not on WARNING", () => {
  assert(checkAbortCriteria({ backfillConflictSeverity: "CONFLICT" }).abort, "CONFLICT must abort");
  assert(!checkAbortCriteria({ backfillConflictSeverity: "WARNING" }).abort, "a WARNING must not abort");
});

test("AC-9 fires on pruned records as well as an unavailable store", () => {
  assert(checkAbortCriteria({ idempotencyRecordsPrunedInWindow: true }).abort,
    "pruning inside the retention window must abort — expiry must never enable replay");
});

test("one cent aborts exactly as a hundred dollars would", () => {
  eq(checkAbortCriteria({ financialMismatchCount: 1 }).abort, checkAbortCriteria({ financialMismatchCount: 10000 }).abort,
    "there is no small money error");
});

// =============================================================================================
console.log("\nThe promotion evaluator\n");
// =============================================================================================

test("a fully evidenced low-risk promotion returns PROMOTE", () => {
  const r = evaluatePromotion({
    state: "DOMAIN_BACKFILLED", domain: "entries", target: "DUAL_READ_SHADOW",
    flagState: { normalized_reads_shadow: true },
    ctx: { schemaExpanded: true, backfillComplete: true, normalizedReadsShadow: true },
    parityResults: { ROW_COUNT_PARITY: { checked: 4, mismatches: 0 }, KEY_PARITY: { checked: 4, mismatches: 0 }, VALUE_PARITY: { checked: 4, mismatches: 0 } },
    observation: { cleanRuns: 3, hours: 24, mutationsInWindow: 1 },
  });
  eq(r.decision, "PROMOTE", `got ${r.decision}: ${r.reasons.join("; ")}`);
});

test("no manual 'looks good' promotion: a critical domain without gate evidence HOLDs", () => {
  const r = evaluatePromotion({
    state: "SERVER_WRITE_PRIMARY", domain: "payments", target: "LEGACY_WRITE_DISABLED",
    ctx: { staleClientFenceReady: true, writeErrorRateAcceptable: true },
  });
  eq(r.decision, "HOLD", "a financial domain was promoted with no gate evidence");
});

test("an abort overrides an otherwise clean promotion", () => {
  const r = evaluatePromotion({
    state: "DOMAIN_BACKFILLED", domain: "entries", target: "DUAL_READ_SHADOW",
    ctx: { normalizedReadsShadow: true, backfillComplete: true },
    parityResults: { ROW_COUNT_PARITY: { checked: 4, mismatches: 0 }, KEY_PARITY: { checked: 4, mismatches: 0 }, VALUE_PARITY: { checked: 4, mismatches: 0 } },
    observations: { financialMismatchCount: 1 },
  });
  eq(r.decision, "ROLLBACK", "an abort condition did not override");
  eq(r.severity, "ABORT", "severity");
});

test("an illegal transition is BLOCKED, not HOLD — more evidence would not help", () => {
  const r = evaluatePromotion({ state: "LEGACY_ONLY", domain: "entries", target: "NEW_READ_PRIMARY", ctx: FULL_CTX });
  eq(r.decision, "BLOCKED", "an impossible transition must be BLOCKED");
});

test("a missing operator authorization is BLOCKED, not HOLD", () => {
  const r = evaluatePromotion({
    state: "CUTOVER_READY", domain: "entries", target: "LEGACY_FROZEN",
    ctx: { allDomainsCutoverReady: true, scoringParityExact: true, financialReconciled: true },
    operatorAuthorization: false,
  });
  eq(r.decision, "BLOCKED", "an operator decision must block rather than invite more evidence");
});

test("a critical flag violation is ROLLBACK; a low-severity one is HOLD", () => {
  const critical = evaluatePromotion({ state: "DOMAIN_BACKFILLED", domain: "entries",
    flagState: { server_writes_enabled: true }, ctx: { schemaExpanded: false } });
  eq(critical.decision, "ROLLBACK", "critical violation");
  const low = evaluatePromotion({ state: "DOMAIN_BACKFILLED", domain: "entries",
    flagState: { normalized_reads_shadow: true, normalized_reads_enabled: true, legacy_writes_allowed: false,
      server_writes_enabled: true, server_write_canary: true },
    ctx: { schemaExpanded: true, backfillComplete: true, serverWritesPrimary: true, writeContractsDeployed: true,
      staleClientFenceReady: true, legacyWriteDeniedAtDatabase: true } });
  eq(low.decision, "HOLD", "FR-12 is a vacuity warning, not a danger");
});

test("no supplied target yields HOLD rather than an accidental PROMOTE", () => {
  eq(evaluatePromotion({ state: "LEGACY_ONLY", domain: "entries" }).decision, "HOLD", "no target");
});

test("every fault injection case is refused", () => {
  const r = simulateFaults();
  assert(r.ok, `these faults were PROMOTED: ${JSON.stringify(r.promoted)}`);
  eq(r.results.length, FAULTS.length, "fault count");
  for (const x of r.results) assert(["HOLD", "ROLLBACK", "BLOCKED"].includes(x.decision), `${x.id} → ${x.decision}`);
});

test("each fault is refused for its OWN reason, not incidentally", () => {
  const expected = {
    "F-FLAG-WRONG": /FR-3/, "F-RUNTIME-MISSING": /FR-13/, "F-ACL-TOO-EARLY": /FR-5/,
    "F-READ-TOO-EARLY": /FR-14/, "F-OUTBOX-EARLY": /FR-7/, "F-FINANCIAL-MISMATCH": /AC-1/,
    "F-SCORING-MISMATCH": /AC-2/, "F-SCHEMA-DRIFT": /AC-4/, "F-RLS-TOO-EARLY": /AC-3/,
    "F-IDEM-STORE-DOWN": /AC-9/, "F-FALLBACK-ARMED": /FR-11/, "F-VACUOUS-PARITY": /VACUOUS/,
    "F-FREEZE-NO-AUTH": /operatorAuthorization/, "F-CONTRACT-NO-FLOOR": /hardClientFloorEnforced/,
    "F-BACKFILL-PAUSED": /bulkPassComplete/, "F-OLD-CLIENT-WRITE": /parityEvidenceSufficient|finalCatchupComplete/,
  };
  const results = Object.fromEntries(simulateFaults().results.map((r) => [r.id, r.reasons.join(" ")]));
  for (const [id, re] of Object.entries(expected)) {
    assert(re.test(results[id] || ""), `${id} blocked for the wrong reason: ${results[id]}`);
  }
  eq(Object.keys(expected).length, FAULTS.length, "every fault must have an expected reason");
});

// =============================================================================================
console.log("\nBackfill race and delta reconciliation\n");
// =============================================================================================

test("the delta pass picks up an item created after extraction", () => {
  const r = runDeltaPass({ domain: "entries", source: [{ id: "a" }, { id: "b" }], copied: [{ id: "a" }] });
  eq(r.applied.filter((x) => x.action === "INSERT").length, 1, "the new item was not inserted");
  eq(r.unresolvedDelta, 0, "delta");
});

test("the delta pass picks up an in-place update via the content fingerprint", () => {
  const r = runDeltaPass({
    domain: "results", source: [{ id: "m1", h: 3, a: 1 }], copied: [{ id: "m1", h: 2, a: 1 }],
    fingerprintOf: (x) => `${x.h}-${x.a}`,
  });
  assert(r.applied.some((x) => x.action === "UPDATE"), "a corrected result was not detected");
  eq(r.unresolvedDelta, 0, "delta");
});

test("NEGATIVE: a created_at watermark misses a correction made in place (WS5-F6)", () => {
  const d = clone();
  d.domains.find((x) => x.id === "results").raceStrategy = "CREATED_AT_WATERMARK";
  useChoreography(d);
  const r = runDeltaPass({
    domain: "results", source: [{ id: "m1", h: 3, a: 1 }], copied: [{ id: "m1", h: 2, a: 1 }],
    fingerprintOf: (x) => `${x.h}-${x.a}`,
  });
  eq(r.unresolvedDelta, 1, "a created_at watermark must be shown to miss an in-place correction");
  assert(r.missed.some((m) => m.action === "MISSED_INPLACE_UPDATE"), "not reported");
  resetChoreography();
});

test("the real results domain does NOT use a created_at watermark", () => {
  eq(domainDef("results").raceStrategy, "SYNC_WATERMARK",
    "an in-place result correction carries no new created_at, and a missed one changes a rank");
});

test("a domain that is not copied has no delta to reconcile", () => {
  eq(runDeltaPass({ domain: "outbox", source: [{ id: "x" }], copied: [] }).unresolvedDelta, 0, "outbox");
  eq(runDeltaPass({ domain: "rankings", source: [{ id: "x" }], copied: [] }).strategy, "DERIVED_NEVER_BACKFILLED", "rankings");
});

test("every financial and scoring domain requires a zero delta before cutover", () => {
  for (const id of domains()) {
    const d = domainDef(id);
    if (d.riskClass === "HIGH_RISK_FINANCIAL" || d.riskClass === "CRITICAL_SCORING") {
      assert(requiresZeroDelta(id), `${id} does not require a zero delta`);
    }
  }
});

test("the outbox is deliberately not backfilled, and that refusal is recorded", () => {
  const d = domainDef("outbox");
  eq(d.raceStrategy, "NOT_BACKFILLED_BY_DESIGN", "strategy");
  assert(/already sent/.test(d.raceWhy), "the reason must name the real-world consequence");
});

// =============================================================================================
console.log("\nMulti-app coordination\n");
// =============================================================================================

test("shared and per-app domains are correctly separated", () => {
  for (const s of ["participants", "payments", "allocations", "audit", "outbox", "identity_links"]) {
    assert(isSharedDomain(s), `${s} must be shared`);
  }
  for (const p of ["entries", "predictions", "results", "pools"]) {
    assert(!isSharedDomain(p), `${p} must be per-app`);
  }
});

test("a shared domain advances at the slowest app", () => {
  const r = sharedDomainState("participants", { copa2026: "CUTOVER_READY", cdb2026: "DUAL_READ_SHADOW", br2026: "LEGACY_ONLY" });
  eq(r.state, "LEGACY_ONLY", "the slowest app must govern");
  eq(r.limitedBy, "br2026", "limiting app");
});

test("NEGATIVE: a shared domain may not freeze while any app lags", () => {
  const r = mayFreezeSharedDomain("payments", { copa2026: "CUTOVER_READY", br2026: "NEW_READ_PRIMARY" });
  assert(!r.allowed, "the shared document was frozen while an app still read it");
  assert(r.laggards.includes("br2026"), "laggard not identified");
});

test("the recommended app order starts with the concluded competition", () => {
  const m = loadChoreography().multiApp;
  assert(/copa2026/.test(m.recommendedOrder[0]), "the concluded app should go first");
  assert(/concluded|archived/.test(m.recommendedOrder[0]), "the reason should be stated in the entry");
});

test("the cross-app participant duplication hazard is controlled (WS5-F7)", () => {
  const xh1 = loadChoreography().multiApp.crossDomainHazards.find((h) => h.id === "XH-1");
  assert(/global across apps/i.test(xh1.control), "the natural key must be declared global");
  const r = simulatePartialRollout();
  assert(r.ok, `partial rollout failures: ${r.failures.join("; ")}`);
  eq(r.participants, 1, "the migration manufactured a duplicate participant");
});

// =============================================================================================
console.log("\nScheduling constraints\n");
// =============================================================================================

test("NEGATIVE: an unmeasured scheduling constraint blocks", () => {
  const r = checkSchedulingConstraints("predictions", {});
  assert(!r.ok, "an unmeasured timing constraint was treated as satisfied");
  assert(r.violations.every((v) => v.reason === "UNMEASURED"), "should be unmeasured");
});

test("a satisfied constraint set passes", () => {
  assert(checkSchedulingConstraints("predictions", { NO_OPEN_CUTOFF: true, AVOID_MATCH_DAY: true }).ok, "refused");
});

test("NEGATIVE: an open prediction cutoff blocks the prediction domain", () => {
  const r = checkSchedulingConstraints("predictions", { NO_OPEN_CUTOFF: false, AVOID_MATCH_DAY: true });
  assert(!r.ok, "a prediction cutover during an open cutoff was permitted");
  assert(r.violations.some((v) => v.id === "SC-1"), "SC-1 did not fire");
});

test("constraints are event-driven, and the clock-window fallback says so", () => {
  const sc7 = loadChoreography().schedulingConstraints.find((s) => s.id === "SC-7");
  eq(sc7.eventDriven, false, "SC-7 is the exception");
  assert(/not a safety property/.test(sc7.meaning), "a quiet Tuesday is not a safety property");
});

// =============================================================================================
console.log("\nSimulations\n");
// =============================================================================================

test("WS5.38 — the full cutover simulation passes", () => {
  const r = simulateFullCutover();
  assert(r.ok, `failures:\n      ${r.failures.join("\n      ")}`);
  eq(r.finalState, "CONTRACT_ELIGIBLE", "final state");
  assert(r.trace.length >= 15, "the trace must cover every state");
});

test("the cutover simulation conserves money", () => {
  const r = simulateFullCutover();
  eq(r.money.received, "80.00", "received");
  eq(r.money.allocated, "40.00", "allocated");
});

test("the cutover simulation includes the full cast the brief requires", () => {
  const w = simulateFullCutover().world;
  assert(w.rel.participants.length >= 2, "two users");
  assert(w.rel.payments.some((p) => p.payer_participant_id === "p-carla"), "third-party payer");
  assert(w.rel.pool_entries.length >= 4, "multiple entries");
  assert(w.rel.predictions.length + Object.keys(w.legacy.copa2026.results).length > 0, "prediction and result");
  assert(w.rel.payment_allocations.length >= 2, "allocations");
  assert(w.rel.prize_allocations.length >= 1, "prize");
  assert(w.rel.outbox_events.length >= 1, "outbox");
  assert(w.rel.audit_events.length >= 4, "audit");
});

test("NEGATIVE: the simulation fails if the read cutover is made legal too early", () => {
  const d = clone();
  d.transitions.push({ from: "SERVER_WRITE_PRIMARY", to: "NEW_READ_PRIMARY", guards: [], why: "injected" });
  useChoreography(d);
  const r = simulateFullCutover();
  assert(!r.ok, "the simulation passed with a knowably incomplete read cutover — it proves nothing");
  assert(r.failures.some((f) => /must be illegal/.test(f)), "wrong failure");
  resetChoreography();
});

test("NEGATIVE: the simulation fails if the fence accepts a flag as enforcement", () => {
  const d = clone();
  d.flagRules = d.flagRules.filter((r) => r.id !== "FR-6");
  useChoreography(d);
  const r = simulateFullCutover();
  assert(!r.ok, "a UI-only freeze was accepted as a fence");
  resetChoreography();
});

test("WS5.39 — a stale legacy-path write is refused at the fence even when adaptable", () => {
  const r = simulateStaleBrowser({ openedAt: "LEGACY_ONLY", nowState: "LEGACY_WRITE_DISABLED",
    operation: "SUBMIT_PREDICTION", writePath: "legacy" });
  assert(r.ok, `failures: ${r.failures.join("; ")}`);
  eq(r.verdict, "EXPLICITLY_REFUSED", "a legacy-path write must not survive the fence");
  eq(r.governedBy, "oldClientMatrix", "the matrix governs legacy-path writes");
  assert(r.statesAdvanced >= 8, "the tab should have been open across many states");
});

test("WS5.39 — a contract-path client with an older envelope is adapted, not refused (WS5-F9)", () => {
  const r = simulateStaleBrowser({ nowState: "LEGACY_WRITE_DISABLED", operation: "SUBMIT_PREDICTION",
    writePath: "contract", clientContractVersion: 1, minimumWriteVersion: 2 });
  assert(r.ok, `failures: ${r.failures.join("; ")}`);
  eq(r.verdict, "ACCEPTED_OR_ADAPTED", "a contract-path client is not subject to the legacy fence");
  eq(r.governedBy, "writeShapeClassifier", "the classifier governs contract-path writes");
});

test("WS5.39 — a stale write with a missing monetary field is refused on either path", () => {
  const r = simulateStaleBrowser({ nowState: "SERVER_WRITE_PRIMARY", operation: "WRITE",
    writePath: "contract", clientContractVersion: 1, minimumWriteVersion: 2, missingFields: ["amount"] });
  assert(r.ok, `failures: ${r.failures.join("; ")}`);
  eq(r.verdict, "EXPLICITLY_REFUSED", "the adapter must not default an amount");
});

test("WS5.39 — a tab open across the whole migration never causes a silent partial mutation", () => {
  for (const s of states()) for (const op of ["READ", "WRITE", "SUBMIT_PREDICTION", "CREATE_ENTRY", "ADMIN_ACTION"]) {
    for (const path of ["legacy", "contract"]) {
      const r = simulateStaleBrowser({ openedAt: "LEGACY_ONLY", nowState: s, operation: op, writePath: path });
      assert(r.ok, `${s}/${op}/${path}: ${r.failures.join("; ")}`);
      eq(r.silentPartialMutation, false, `${s}/${op}/${path} risked a silent partial mutation`);
    }
  }
});

test("WS5.40 — the financial failure simulation passes all five scenarios", () => {
  const r = simulateFinancialFailure();
  assert(r.ok, `failures:\n      ${r.failures.join("\n      ")}`);
  eq(r.scenarios.length, 5, "scenario count");
});

test("WS5.40 — a retry after commit replays instead of double-writing", () => {
  const s = simulateFinancialFailure().scenarios.find((x) => /retry after commit/.test(x.scenario));
  eq(s.ledgerRows, 1, "the retry double-wrote");
  eq(s.replayed, true, "the retry re-executed");
  eq(s.total, "40.00", "money was doubled");
});

test("WS5.40 — a refund preserves the original and nets to zero", () => {
  const s = simulateFinancialFailure().scenarios.find((x) => /refund/.test(x.scenario));
  eq(s.originalPreserved, true, "the original payment fact was edited");
  eq(s.typed, true, "a negative row must carry typed reversal semantics");
  eq(s.net, "0.00", "net after refund");
});

test("WS5.41 — the scoring cutover simulation passes", () => {
  const r = simulateScoringCutover();
  assert(r.ok, `failures:\n      ${r.failures.join("\n      ")}`);
});

test("WS5.41 — scoring parity holds for all three apps' cascades", () => {
  for (const app of ["copa2026", "br2026", "cdb2026"]) {
    const r = simulateScoringCutover({ app });
    assert(r.ok, `${app}: ${r.failures.join("; ")}`);
  }
});

test("money is never represented as a float anywhere in the simulation", () => {
  eq(cents("20.00"), 2000, "minor units");
  eq(cents("0.01"), 1, "one cent");
  eq(cents("40.00") - cents("20.00") - cents("20.00"), 0, "exact subtraction");
  // The classic float failure, which integer minor units do not have.
  assert(0.1 + 0.2 !== 0.3, "the float hazard this avoids");
  eq(cents("0.10") + cents("0.20"), cents("0.30"), "exact in minor units");
});

// =============================================================================================
console.log("\nReadiness, decisions and honesty checks\n");
// =============================================================================================

test("the readiness matrix covers M1–M17 with all eight columns", () => {
  const m = loadChoreography().readinessMatrix;
  for (let i = 1; i <= 17; i++) {
    const row = m.rows[`M${i}`];
    assert(row, `M${i} missing`);
    for (const c of m.columns) assert(row[c] !== undefined, `M${i} missing column ${c}`);
  }
});

test("RESTORE_REHEARSED is NO everywhere — no rehearsal has happened", () => {
  const rows = Object.values(loadChoreography().readinessMatrix.rows);
  assert(rows.every((r) => r.RESTORE_REHEARSED !== "YES"),
    "a restore rehearsal is claimed that has not been performed");
});

test("M0 is recorded as a programme blocker and remains unexecuted", () => {
  const b = loadChoreography().readinessMatrix.programmeBlockers.find((x) => x.id === "M0");
  eq(b.status, "PREPARED_NOT_EXECUTED", "M0 status");
  eq(b.blocks, "everything", "M0 blocks everything");
});

test("the legacy-fence gap is recorded rather than silently designed around", () => {
  const b = loadChoreography().readinessMatrix.programmeBlockers.find((x) => x.id === "WS5-F4");
  assert(b && /OPEN/.test(b.status), "WS5-F4 must be an open blocker");
  eq(loadChoreography().readinessMatrix.rows.M13.RLS_READY, "NO", "M13 must not claim RLS readiness");
});

test("the Go/No-Go list refuses 'the SQL exists, so we are ready'", () => {
  const g = loadChoreography().goNoGo.find((x) => x.id === "GNG-13");
  assert(/^NO/.test(g.answer), "the question must be answered no");
});

test("the blocking Go/No-Go items that are currently NO are stated as NO", () => {
  const g = loadChoreography().goNoGo;
  for (const id of ["GNG-1", "GNG-2", "GNG-9", "GNG-10"]) {
    const q = g.find((x) => x.id === id);
    assert(q.blocking && /^NO/.test(q.current || ""), `${id} must be recorded as currently NO`);
  }
});

test("the three L-OP decisions are presented with a recommendation and left unexecuted", () => {
  const d = loadChoreography();
  eq(d.freezeOptions.decision, "L-OP-1", "freeze decision id");
  eq(d.freezeOptions.recommendation, "SHORT_WRITE_FREEZE", "freeze recommendation");
  eq(d.freezeOptions.notExecuted, true, "must not be executed");
  eq(d.clientFloorOptions.decision, "L-OP-2", "floor decision id");
  eq(d.clientFloorOptions.notExecuted, true, "must not be executed");
  eq(d.parityRunOptions.decision, "L-OP-3", "parity decision id");
});

test("the freeze options record that per-domain freezing is not available, with the reason", () => {
  const o = loadChoreography().freezeOptions.options.find((x) => x.id === "DOMAIN_SPECIFIC_FREEZE");
  assert(/NOT AVAILABLE/.test(o.verdict), "it must not be offered as a real option");
  assert(/one jsonb row|single/.test(o.why), "the structural reason must be given");
});

test("the client floor recommendation differs per operation", () => {
  const r = loadChoreography().clientFloorOptions.perOperationRecommendation;
  assert(/adapter/.test(r.SUBMIT_PREDICTION.recommended), "predictions are the adapter's best case");
  assert(/hard reject/.test(r.ADMIN_ACTION.recommended), "admin actions must never be adapted");
  assert(/changes at the freeze|before LEGACY_FROZEN/.test(r.READ.recommended + r.READ.why),
    "the correct read behaviour changes at the freeze");
});

test("idempotency retention is POLICY_CONFIGURABLE and never enables replay", () => {
  const r = loadChoreography().idempotencyRetention;
  eq(r.classification, "POLICY_CONFIGURABLE", "classification");
  assert(/indefinite/.test(r.defaults.moneyBearingOrDisputeRelevant), "money-bearing default must be conservative");
  assert(/REFUSED/.test(r.replayRule), "a retry over a pruned money record must be refused, not executed");
});

test("the outbox is never enabled merely because its tables exist", () => {
  const o = loadChoreography().outboxEnablement;
  eq(o.sequence.length, 5, "sequence length");
  assert(/no bulk 'retry everything'/.test(o.replay), "a bulk retry control must be refused");
  assert(/never silently dropped/.test(o.deadLetter), "dead must be a state, not a deletion");
});

test("audit begins before the critical write cutover and fabricates nothing", () => {
  const a = loadChoreography().auditEnablement;
  assert(/BEFORE/.test(a.principle), "audit must precede the writes worth auditing");
  assert(/no audit event is created for an action that cannot be evidenced/.test(a.noFabrication), "fabrication rule");
  assert(/LAGGED/.test(a.legacyAdminTraceability), "the transitional lag must be stated, not discovered");
});

test("reporting lags the transactional cutover and labels asserted payments", () => {
  const r = loadChoreography().reportingCutover;
  eq(r.lagsTransactionalCutover, true, "reporting must lag");
  assert(/asserted rather than allocated/.test(r.assertedPaymentCaveat), "asserted payments must be labelled");
});

test("the write-mirroring analysis forbids browser dual-write", () => {
  const w = loadChoreography().writeMirroring;
  assert(/never the browser/.test(w.whoPerforms), "the browser must not mirror");
  assert(/single database transaction|one PostgreSQL database/.test(w.transactionSemantics + w.notTheClassicProblem),
    "the single-transaction justification must be explicit");
  assert(/cannot wrap/.test(w.browserDualWriteProhibited), "the reason must be that it is impossible, not merely unwise");
});

test("the canary never risks money to prove a write path works", () => {
  const c = loadChoreography().canary;
  eq(c.ordering[0].risk, "NONE", "the first canary step must risk nothing");
  const fin = c.ordering.find((s) => s.risk === "HIGH");
  assert(/gate must pass FIRST/.test(fin.gate), "the financial canary must not substitute for the gate");
  assert(c.rejectedCanaryDesigns.some((d) => /percentage/.test(d.design)), "a percentage canary must be considered and rejected");
});

test("RLS is enabled in the same migration as CREATE TABLE", () => {
  const s = loadChoreography().rlsActivationSequence.perTableSequence;
  assert(/SAME migration as the CREATE/.test(s[1].action), "RLS must not be a later step");
  assert(/no GRANT/.test(s[2].action), "no grant may precede the policies");
  assert(/prove each policy DENIES/.test(s[4].action), "a policy that permits everything passes every positive test");
});

test("financial tables are never browser-writeable in any state", () => {
  const f = loadChoreography().rlsActivationSequence.financialTables;
  assert(/NEVER browser-writeable/.test(f.rule), "rule missing");
  assert(/read model|restricted view|RPC/.test(f.authenticatedReadRule), "WS12-OP-1 must be carried through");
});

test("ownership resolves through the link table, and never assumes one auth user per participant", () => {
  const o = loadChoreography().rlsActivationSequence.ownershipLinkage;
  assert(/^participant_auth_links/.test(o.mechanism), `mechanism: got ${o.mechanism}`);
  assert(/MAY link to multiple/.test(o.cardinality), "WS12-OP-2 cardinality must be preserved");
  assert(/no auth linkage at all/.test(o.historical), "historical participants must remain functional");
  assert(/never|no read policy may be written as/.test(o.choreographyConsequence), "the predicate rule must be stated");
});

test("no role may gain a forbidden privilege", () => {
  for (const r of loadChoreography().aclSequence.roles) {
    assert(Array.isArray(r.mustNeverGain) && r.mustNeverGain.length, `${r.role} declares no forbidden privileges`);
  }
  const anon = loadChoreography().aclSequence.roles.find((r) => r.role === "anon");
  assert(anon.mustNeverGain.some((p) => /TRUNCATE/.test(p)), "anon must never regain TRUNCATE");
});

test("the ACL retirement never uses a wildcard revoke", () => {
  const step = loadChoreography().aclSequence.retirementOfOldAcls.find((s) => /REVOKE/.test(s.action));
  assert(/never a wildcard, never REVOKE ALL/.test(step.action), "wildcard revoke must be forbidden");
});

test("failure is analysed between every pair of steps, and the unsafe ones name a control", () => {
  const f = loadChoreography().failureBetweenSteps;
  assert(f.length >= 12, "too few failure points analysed");
  for (const x of f) {
    assert(x.situation && x.impact && x.recovery, `${x.id} incomplete`);
    if (x.safe === false) assert(x.control, `${x.id} is unsafe and names no control`);
  }
});

test("the adversarial review covers all six lenses and every finding has an outcome", () => {
  const r = loadChoreography().adversarialReview;
  const lenses = new Set(r.map((x) => x.lens));
  for (const l of ["DBA", "SRE", "security engineer", "financial controller",
    "frontend engineer with a stale client", "operator making a mistake"]) {
    assert(lenses.has(l), `no ${l} lens`);
  }
  for (const x of r) assert(x.outcome && x.status, `an attack has no outcome: ${x.attack}`);
});

test("the one unmitigated adversarial finding is labelled as accepted risk, not as covered", () => {
  const r = loadChoreography().adversarialReview.find((x) => /compromised/.test(x.attack));
  eq(r.status, "ACCEPTED_RISK_DOCUMENTED", "a service-role compromise must not be claimed as covered");
  assert(/NOT PREVENTED/.test(r.outcome), "it must say plainly that it is not prevented");
});

test("every finding is actionable and the two highest-severity ones are resolved", () => {
  const f = loadChoreography().findings;
  assert(f.length >= 8, "too few findings");
  for (const x of f) {
    for (const k of ["severity", "title", "found", "why", "resolution"]) assert(x[k], `${x.id} missing ${k}`);
  }
  for (const id of ["WS5-F1", "WS5-F2", "WS5-F3", "WS5-F7"]) {
    const x = f.find((y) => y.id === id);
    assert(x.regressionTest, `${id} has no regression test named`);
  }
});

test("cross-document reconciliation names one authoritative order and every superseded claim", () => {
  const c = loadChoreography().consistencyReconciliation;
  eq(c.authoritativeOrder, "deploymentOrder in this file", "there must be exactly one authoritative order");
  const zd = c.reconciled.find((x) => /ZERO_DOWNTIME/.test(x.document));
  eq(zd.status, "SUPERSEDED_IN_PART", "the superseded document must be named");
  assert(zd.unchanged, "what still stands must be stated too, or the reader cannot trust either document");
  for (const d of ["WS6", "WS7", "WS12", "WS13"].map((w) => c.reconciled.find((x) => x.document.includes(w)))) {
    assert(d, "a prior workstream is not reconciled");
  }
});

test("the deployment order puts the client floor before the freeze (WS5-F1)", () => {
  const o = loadChoreography().deploymentOrder;
  const floor = o.find((s) => /minimum_read_version/.test(s.action));
  const freeze = o.find((s) => /stop mirroring/.test(s.action));
  assert(floor.step < freeze.step, "the floor must precede the freeze: it exists to stop stale reads");
});

test("the deployment order deploys before it enables, everywhere", () => {
  const o = loadChoreography().deploymentOrder;
  const deployRuntime = o.find((s) => /deploy the trusted runtime/.test(s.action));
  const enable = o.find((s) => /server_writes_enabled=on/.test(s.action));
  assert(deployRuntime.step < enable.step, "a deployment and an activation must be two steps, in that order");
  const revoke = o.find((s) => /REVOKE direct write/.test(s.action));
  assert(enable.step < revoke.step, "the replacement path must exist before the old one is denied");
});

test("exactly one deployment step is irreversible, and it is last", () => {
  const o = loadChoreography().deploymentOrder;
  const irr = o.filter((s) => s.irreversible);
  eq(irr.length, 1, "irreversible step count");
  eq(irr[0].step, o.length, "the irreversible step must be last");
  assert(/drop the legacy structures/.test(irr[0].action), "the irreversible step should be the drop");
});

test("every deployment step is labelled with an execution type", () => {
  const TYPES = ["READ_ONLY", "REPO_WRITE", "SCRATCH_WRITE", "PRODUCTION_SCHEMA_WRITE",
    "PRODUCTION_DATA_WRITE", "PRODUCTION_LEDGER_WRITE", "DEPLOYMENT"];
  for (const s of loadChoreography().deploymentOrder) {
    assert(TYPES.includes(s.type), `step ${s.step} has type ${s.type}`);
  }
});

test("the observability gates require a baseline where one is needed", () => {
  const og = loadChoreography().observabilityGates;
  assert(og.length >= 10, "too few gates");
  const err = og.find((g) => g.metric === "writeErrorRate");
  eq(err.baselineRequired, true, "an error-rate gate with no baseline cannot tell a regression from noise");
  const legacyReads = og.find((g) => g.metric === "legacyReadCount");
  assert(/longest plausible session/.test(legacyReads.threshold), "the contract step needs a measured absence of readers");
});

test("the idempotency-conflict metric is documented as expected-nonzero", () => {
  const g = loadChoreography().observabilityGates.find((x) => x.metric === "idempotencyConflicts");
  assert(/EXPECTED and healthy/.test(g.note), "retries being absorbed is success, not failure");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ CHOREOGRAPHY TESTS PASSED\n" : "✗ CHOREOGRAPHY TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
