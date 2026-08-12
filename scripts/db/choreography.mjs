#!/usr/bin/env node
/**
 * WS5 — live expand/contract migration choreography: the executable half.
 *
 * model/migration_choreography.json is the specification; this file is the evaluator that makes it
 * checkable. Everything here operates on plain objects. Nothing connects to a database, and nothing
 * in this file can affect production.
 *
 * The design intent is that a promotion is never a judgement call for a critical domain. The
 * evaluator takes the current state, the domain and the evidence, and returns one of PROMOTE / HOLD
 * / ROLLBACK / BLOCKED. Missing evidence is HOLD — never a pass. That single rule is the difference
 * between a gate and a comment.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CHOREOGRAPHY_PATH = join(ROOT, "model", "migration_choreography.json");

export function loadChoreography(p = CHOREOGRAPHY_PATH) {
  return JSON.parse(readFileSync(p, "utf8"));
}

let DOC = null;
const doc = () => (DOC ||= loadChoreography());
/** Test seam: run the evaluator against a mutated copy of the spec. */
export function useChoreography(d) { DOC = d; }
export function resetChoreography() { DOC = null; }

// ---------------------------------------------------------------------------------------------
// States and transitions
// ---------------------------------------------------------------------------------------------

export function states() { return doc().states.map((s) => s.id); }
export function stateDef(id) { return doc().states.find((s) => s.id === id) || null; }
export function transitions() { return doc().transitions; }

export class ChoreographyError extends Error {
  constructor(code, message, detail = {}) { super(message); this.code = code; this.detail = detail; }
}

/**
 * Evaluate one guard expression against an evidence bag.
 * `foo` requires ctx.foo truthy; `!foo` requires it falsy. An UNKNOWN guard (absent from ctx) is
 * treated as unsatisfied rather than as an error, because "we did not measure it" and "it is false"
 * must lead to the same refusal. They are distinguished in the returned reason, not in the verdict.
 *
 * KPLUS-F053. That rule used to hold only for positive guards. A NEGATED guard read an absent key as
 * `!undefined` → true and reported itself SATISFIED, so the same absence of evidence refused `foo` and
 * approved `!foo`. It mattered: `LEGACY_FROZEN → CONTRACT_ELIGIBLE` is a crossing into a point of no
 * simple return guarded on `!legacyReadFallback`, and that guard passed without anyone measuring
 * whether a legacy read fallback was engaged. Presence is now required in both directions — a guard
 * nobody evaluated cannot be satisfied, whichever way it points.
 */
export function evaluateGuard(expr, ctx) {
  const negated = expr.startsWith("!");
  const key = negated ? expr.slice(1) : expr;
  const present = Object.prototype.hasOwnProperty.call(ctx, key);
  const value = !!ctx[key];
  const satisfied = present && (negated ? !value : value);
  return { key, negated, present, satisfied, reason: !present ? "UNMEASURED" : satisfied ? "OK" : "FALSE" };
}

export function canTransition(from, to, ctx = {}) {
  if (!stateDef(from)) throw new ChoreographyError("UNKNOWN_STATE", `unknown from-state ${from}`);
  if (!stateDef(to)) throw new ChoreographyError("UNKNOWN_STATE", `unknown to-state ${to}`);

  const edge = transitions().find((t) => t.from === from && t.to === to);
  if (!edge) {
    return { allowed: false, verdict: "ILLEGAL_TRANSITION", edge: null, failures: [],
      reason: `no declared transition ${from} → ${to}` };
  }
  const results = (edge.guards || []).map((g) => ({ expr: g, ...evaluateGuard(g, ctx) }));
  const failures = results.filter((r) => !r.satisfied);
  return {
    allowed: failures.length === 0,
    verdict: failures.length === 0 ? "ALLOWED" : "GUARD_FAILED",
    edge, failures,
    unmeasured: failures.filter((f) => f.reason === "UNMEASURED").map((f) => f.key),
    reason: failures.length === 0
      ? "all guards satisfied"
      : `guards failed: ${failures.map((f) => `${f.expr} (${f.reason})`).join(", ")}`,
  };
}

/** Every state reachable from `from` given the evidence — what the operator may actually do next. */
export function legalNext(from, ctx = {}) {
  return transitions().filter((t) => t.from === from)
    .map((t) => ({ to: t.to, ...canTransition(from, t.to, ctx) }))
    .filter((r) => r.allowed).map((r) => r.to);
}

export function rollbackClass(state) {
  const s = stateDef(state);
  if (!s) throw new ChoreographyError("UNKNOWN_STATE", `unknown state ${state}`);
  return s.rollbackClass;
}

/** The PNSR boundaries crossed at or before `state`, in declared order. */
export function pointsOfNoSimpleReturnAt(state) {
  const order = states();
  const i = order.indexOf(state);
  return doc().pointsOfNoSimpleReturn.filter((p) => {
    const j = order.indexOf(p.state);
    return j !== -1 && j <= i;
  });
}

export function isReversibleByFlag(state) {
  return rollbackClass(state) === "FEATURE_FLAG_ROLLBACK";
}

// ---------------------------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------------------------

export function flags() { return doc().flags; }
export function flagDefaults() {
  return Object.fromEntries(doc().flags.map((f) => [f.id, f.default]));
}

/**
 * Check a flag configuration against the declared rules.
 *
 * `flagState` holds the flags; `ctx` holds the facts the rules depend on (schemaExpanded,
 * backfillComplete, ...). The rules are expressed in prose in the model — this function is the
 * single place where each rule's prose is bound to a predicate, so a rule cannot exist as text
 * without an implementation. The test suite asserts that binding is total.
 */
const FLAG_PREDICATES = {
  "FR-1": (f, c) => !f.server_writes_enabled || !!c.schemaExpanded,
  "FR-2": (f, c) => !f.server_writes_enabled || !!c.backfillComplete,
  "FR-3": (f, c) => !f.normalized_reads_enabled || !!c.backfillComplete,
  "FR-4": (f, c) => !f.normalized_reads_enabled || !!c.serverWritesPrimary,
  "FR-5": (f, c) => f.legacy_writes_allowed !== false || (!!c.staleClientFenceReady && !!f.server_writes_enabled),
  "FR-6": (f, c) => f.legacy_writes_allowed !== false || !!c.legacyWriteDeniedAtDatabase,
  "FR-7": (f, c) => !f.outbox_delivery_enabled ||
    (!!c.idempotencyVerified && !!c.deliveryIdempotencyVerified && !!c.deadLetterDefined && !!c.replayControlsDefined),
  "FR-8": (f, c) => !f.outbox_delivery_enabled || !c.historicalLookingEventsInBacklog,
  "FR-9": (f, c) => !f.new_reporting_enabled || !!c.financialReconciled,
  "FR-10": (f, c) => f.server_write_canary !== false || !!c.canaryEvidenceSufficient,
  "FR-11": (f, c) => !c.atOrPastLegacyFrozen || f.legacy_read_fallback === false,
  "FR-12": (f) => !(f.normalized_reads_shadow && f.normalized_reads_enabled),
  "FR-13": (f, c) => !f.server_writes_enabled || !!c.writeContractsDeployed,
  "FR-14": (f, c) => !f.normalized_reads_enabled || f.legacy_writes_allowed === false,
};

export function validateFlags(flagState = {}, ctx = {}) {
  const f = { ...flagDefaults(), ...flagState };
  const violations = [];
  for (const rule of doc().flagRules) {
    const pred = FLAG_PREDICATES[rule.id];
    if (!pred) { violations.push({ id: rule.id, severity: "CRITICAL", rule: rule.rule, reason: "NO_PREDICATE_BOUND" }); continue; }
    if (!pred(f, ctx)) violations.push({ id: rule.id, severity: rule.severity, rule: rule.rule, why: rule.why });
  }
  return { ok: violations.length === 0, violations, effective: f };
}

export function boundFlagRuleIds() { return Object.keys(FLAG_PREDICATES); }

// ---------------------------------------------------------------------------------------------
// Old client compatibility
// ---------------------------------------------------------------------------------------------

export const CLASSIFICATIONS = ["SAFE", "SAFE_WITH_LEGACY_PATH", "READ_ONLY",
  "REJECT_WITH_REFRESH_REQUIRED", "BLOCKED", "DATA_CORRUPTION_RISK"];

export function oldClientClassification(state, operation) {
  const row = doc().oldClientMatrix.byState[state];
  if (!row) throw new ChoreographyError("UNKNOWN_STATE", `no old-client row for ${state}`);
  const c = row[operation];
  if (!c) throw new ChoreographyError("UNKNOWN_OPERATION", `no classification for ${operation} at ${state}`);
  return c;
}

/** Whether an old client's attempt may proceed, and what the server must answer if not. */
export function oldClientOutcome(state, operation) {
  const c = oldClientClassification(state, operation);
  switch (c) {
    case "SAFE": case "SAFE_WITH_LEGACY_PATH":
      return { classification: c, proceed: true, response: "OK" };
    case "READ_ONLY":
      return { classification: c, proceed: operation === "READ", response: operation === "READ" ? "OK_STALE" : "CLIENT_TOO_OLD" };
    case "REJECT_WITH_REFRESH_REQUIRED":
      return { classification: c, proceed: false, response: "CLIENT_TOO_OLD", distinguishable: true, partialMutation: false };
    case "BLOCKED":
      return { classification: c, proceed: false, response: "CLIENT_TOO_OLD", distinguishable: true, partialMutation: false };
    case "DATA_CORRUPTION_RISK":
      return { classification: c, proceed: false, response: "MUST_NOT_BE_REACHABLE", partialMutation: true };
    default:
      throw new ChoreographyError("UNKNOWN_CLASSIFICATION", c);
  }
}

// ---------------------------------------------------------------------------------------------
// Client capability / write-shape adaptation
// ---------------------------------------------------------------------------------------------

const MONEY_FIELDS = new Set(["amount", "amount_minor", "currency", "expected_fee_amount", "fee_amount"]);

/**
 * Decide how to handle a write from a client declaring `contract_version` and `capabilities`.
 * The capability claim decides parsing only; authorization is not consulted here and must not be.
 */
export function classifyWriteShape({ contractVersion, minimumWriteVersion, shape = "recognized",
  missingFields = [], operation = "WRITE" } = {}) {
  if (contractVersion === undefined || contractVersion === null) {
    return { action: "REJECT", code: "CLIENT_TOO_OLD", why: "no contract version declared" };
  }
  // An operator action is never adapted. An adapted admin action is an action nobody specified, and
  // the operator can always reload — so there is nothing to preserve and everything to lose.
  if (operation === "ADMIN_ACTION" && contractVersion < minimumWriteVersion) {
    return { action: "REJECT", code: "CLIENT_TOO_OLD", why: "operator actions are never adapted" };
  }
  if (shape === "unrecognized") {
    return { action: "REJECT", code: "CLIENT_TOO_OLD", why: "unrecognized shape; never partially applied" };
  }
  const money = missingFields.filter((f) => MONEY_FIELDS.has(f));
  if (money.length) {
    return { action: "REJECT", code: "CLIENT_TOO_OLD", why: `adapter would have to default monetary field(s): ${money.join(", ")}`,
      rule: "the adapter may never default a monetary amount, currency, actor or timestamp" };
  }
  const unfillable = missingFields.filter((f) => !["entry_label", "display_name"].includes(f));
  if (unfillable.length) {
    return { action: "REJECT", code: "CLIENT_TOO_OLD", why: `not losslessly adaptable: ${unfillable.join(", ")}` };
  }
  if (contractVersion < minimumWriteVersion) {
    if (missingFields.length === 0) {
      return { action: "ADAPT", code: "OK", adapterUsed: true, why: "below floor but losslessly adaptable" };
    }
    return { action: "REJECT", code: "CLIENT_TOO_OLD", why: "below the write floor" };
  }
  return { action: "ACCEPT", code: "OK" };
}

/** A capability claim must never widen what a principal may do. */
export function capabilityGrantsAuthority() { return false; }

// ---------------------------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------------------------

export function domainDef(id) {
  const d = doc().domains.find((x) => x.id === id);
  if (!d) throw new ChoreographyError("UNKNOWN_DOMAIN", `unknown domain ${id}`);
  return d;
}
export function domains() { return doc().domains.map((d) => d.id); }

/**
 * Evaluate a parity result set for a domain.
 * `results` maps a parity class to { checked, mismatches }. A class the domain requires and the
 * result set omits is NOT a pass — it is NO_EVIDENCE, and it holds.
 */
export function evaluateParity(domainId, results = {}) {
  const d = domainDef(domainId);
  const required = d.parity || [];
  const zeroTolerance = new Set(["FINANCIAL_PARITY", "SCORING_PARITY"]);
  const missing = [], failed = [], vacuous = [];
  for (const cls of required) {
    const r = results[cls];
    if (!r) { missing.push(cls); continue; }
    if (r.checked === 0) { vacuous.push(cls); continue; }
    const m = r.mismatches || 0;
    if (m > 0) failed.push({ cls, mismatches: m, zeroTolerance: zeroTolerance.has(cls) });
  }
  const financialOrScoringFailure = failed.some((f) => f.zeroTolerance);
  return {
    ok: missing.length === 0 && failed.length === 0 && vacuous.length === 0,
    required, missing, failed, vacuous, financialOrScoringFailure,
    verdict: financialOrScoringFailure ? "ABORT" : (failed.length ? "ROLLBACK" : (missing.length || vacuous.length ? "HOLD" : "PASS")),
  };
}

// ---------------------------------------------------------------------------------------------
// Observation windows
// ---------------------------------------------------------------------------------------------

/**
 * Is the observation evidence sufficient for this domain's risk class?
 * A window with clean runs but zero mutations, for a domain that HAS a live writer, is vacuous —
 * it measured a copy, not a live path. See WS5-F5.
 */
export function evaluateObservationWindow(domainId, evidence = {}) {
  const d = domainDef(domainId);
  const w = doc().observationWindows[d.riskClass];
  const { cleanRuns = 0, hours = 0, mutationsInWindow = 0, unresolvedDelta = null,
    appAuditSuitesPass = null, hasLiveWriter = d.raceStrategy !== "NONE_REQUIRED" && d.raceStrategy !== "NOT_BACKFILLED_BY_DESIGN" } = evidence;
  const reasons = [];

  if (cleanRuns < w.minCleanRuns) reasons.push(`needs ${w.minCleanRuns} clean runs, has ${cleanRuns}`);
  const minHours = evidence.configuredHours ?? w.defaultHours;
  if (hours < minHours) reasons.push(`needs ${minHours}h of observation, has ${hours}h`);
  if (w.requiresChangeDuringWindow && hasLiveWriter && mutationsInWindow < 1) {
    reasons.push("VACUOUS: zero mutations observed in the window for a domain with a live writer");
  }
  if (w.requiresZeroUnresolvedDelta) {
    if (unresolvedDelta === null) reasons.push("unresolved delta not measured");
    else if (unresolvedDelta !== 0) reasons.push(`unresolved delta is ${unresolvedDelta}, must be 0`);
  }
  if (w.requiresAppAuditSuites && appAuditSuitesPass !== true) {
    reasons.push("the app's own scoring audit suites have not been shown to pass");
  }
  return { ok: reasons.length === 0, riskClass: d.riskClass, window: w, reasons };
}

// ---------------------------------------------------------------------------------------------
// Cutover gates
// ---------------------------------------------------------------------------------------------

export function gate(name) {
  const g = doc().cutoverGates[name];
  if (!g) throw new ChoreographyError("UNKNOWN_GATE", `unknown gate ${name}`);
  return g;
}

/** Every requirement must be explicitly true. Absent is not satisfied. */
export function evaluateGate(name, evidence = {}) {
  const g = gate(name);
  const unmet = [];
  for (const r of g.requirements) {
    const v = evidence[r.check];
    if (v !== true) unmet.push({ id: r.id, check: r.check, reason: v === undefined ? "UNMEASURED" : "FALSE", meaning: r.meaning });
  }
  const timingOk = !g.timingConstraint || evidence[g.timingConstraint] === true;
  if (!timingOk) unmet.push({ id: `${g.id}-TIMING`, check: g.timingConstraint, reason: evidence[g.timingConstraint] === undefined ? "UNMEASURED" : "FALSE" });
  return { ok: unmet.length === 0, gate: g.id, unmet };
}

export function gateForDomain(domainId) {
  const d = domainDef(domainId);
  for (const [name, g] of Object.entries(doc().cutoverGates)) {
    if ((g.appliesTo || []).includes(domainId)) return name;
  }
  return d.riskClass === "HIGH_RISK_FINANCIAL" ? "financial" : null;
}

// ---------------------------------------------------------------------------------------------
// Abort criteria
// ---------------------------------------------------------------------------------------------

const ABORT_PREDICATES = {
  "AC-1": (o) => (o.financialMismatchCount ?? 0) > 0,
  "AC-2": (o) => (o.scoringMismatch ?? 0) > 0,
  "AC-3": (o) => o.authorizationRegression === true,
  "AC-4": (o) => o.schemaDrift === true,
  "AC-5": (o) => o.backfillConflictSeverity === "CONFLICT" || o.backfillConflictSeverity === "FATAL",
  "AC-6": (o) => (o.outboxDuplicates ?? 0) > 0,
  "AC-7": (o) => o.errorRateSpike === true,
  "AC-8": (o) => o.unrecognizedStaleClientBehaviour === true,
  "AC-9": (o) => o.idempotencyStoreUnavailable === true || o.idempotencyRecordsPrunedInWindow === true,
};

export function checkAbortCriteria(observations = {}) {
  const triggered = [];
  for (const c of doc().abortCriteria) {
    const p = ABORT_PREDICATES[c.id];
    if (!p) { triggered.push({ id: c.id, condition: c.condition, reason: "NO_PREDICATE_BOUND" }); continue; }
    if (p(observations)) triggered.push({ id: c.id, condition: c.condition, why: c.why });
  }
  return { abort: triggered.length > 0, triggered };
}

export function boundAbortCriterionIds() { return Object.keys(ABORT_PREDICATES); }

// ---------------------------------------------------------------------------------------------
// Promotion evaluator (WS5.35)
// ---------------------------------------------------------------------------------------------

/**
 * The reusable promotion decision. Order matters and is deliberate:
 *   1. abort criteria first — an abort overrides every other consideration, including a clean gate
 *   2. flag validity — an invalid flag combination means the observed evidence describes a
 *      configuration that should not exist, so the evidence cannot be trusted
 *   3. parity, window, gate — the substance
 *   4. the transition itself
 * BLOCKED is reserved for "an operator decision or an external prerequisite is missing", which is
 * different from HOLD ("keep gathering evidence") and from ROLLBACK ("go back").
 */
export function evaluatePromotion({ state, domain, target = null, flagState = {}, ctx = {},
  parityResults = null, observation = null, gateEvidence = null, observations = {},
  operatorAuthorization = false } = {}) {
  const notes = [];

  const abort = checkAbortCriteria(observations);
  if (abort.abort) {
    return { decision: "ROLLBACK", severity: "ABORT", reasons: abort.triggered.map((t) => `${t.id}: ${t.condition}`), notes };
  }

  const flagCheck = validateFlags(flagState, ctx);
  if (!flagCheck.ok) {
    const critical = flagCheck.violations.filter((v) => v.severity === "CRITICAL");
    return {
      decision: critical.length ? "ROLLBACK" : "HOLD",
      severity: critical.length ? "CRITICAL" : "WARNING",
      reasons: flagCheck.violations.map((v) => `${v.id}: ${v.rule}`), notes,
    };
  }

  if (parityResults) {
    const p = evaluateParity(domain, parityResults);
    if (p.verdict === "ABORT") return { decision: "ROLLBACK", severity: "ABORT", reasons: [`parity: ${p.failed.map((f) => f.cls).join(", ")} — zero tolerance`], notes };
    if (p.verdict === "ROLLBACK") return { decision: "ROLLBACK", severity: "HIGH", reasons: [`parity mismatches in ${p.failed.map((f) => f.cls).join(", ")}`], notes };
    if (p.verdict === "HOLD") return { decision: "HOLD", severity: "INFO", reasons: [
      ...p.missing.map((m) => `no evidence for ${m}`), ...p.vacuous.map((v) => `${v} examined zero rows (vacuous)`)], notes };
  }

  if (observation) {
    const w = evaluateObservationWindow(domain, observation);
    if (!w.ok) return { decision: "HOLD", severity: "INFO", reasons: w.reasons, notes };
  }

  const gateName = gateForDomain(domain);
  if (gateName && gateEvidence) {
    const g = evaluateGate(gateName, gateEvidence);
    if (!g.ok) {
      const unmeasured = g.unmet.filter((u) => u.reason === "UNMEASURED");
      return {
        decision: unmeasured.length === g.unmet.length ? "HOLD" : "BLOCKED",
        severity: "HIGH",
        reasons: g.unmet.map((u) => `${u.id} ${u.check}: ${u.reason}`), notes,
      };
    }
  } else if (gateName && !gateEvidence) {
    const d = domainDef(domain);
    if (d.riskClass === "HIGH_RISK_FINANCIAL" || d.riskClass === "CRITICAL_SCORING") {
      return { decision: "HOLD", severity: "HIGH",
        reasons: [`${gateName} gate applies to ${domain} and no gate evidence was supplied`], notes };
    }
  }

  if (!target) return { decision: "HOLD", severity: "INFO", reasons: ["no target state supplied"], notes };

  const t = canTransition(state, target, ctx);
  if (!t.allowed) {
    const needsOperator = (t.edge?.guards || []).includes("operatorAuthorization") && !operatorAuthorization;
    return {
      decision: t.verdict === "ILLEGAL_TRANSITION" ? "BLOCKED" : (needsOperator ? "BLOCKED" : "HOLD"),
      severity: t.verdict === "ILLEGAL_TRANSITION" ? "CRITICAL" : "INFO",
      reasons: [t.reason], notes,
    };
  }

  const d = domainDef(domain);
  if ((d.riskClass === "HIGH_RISK_FINANCIAL" || d.riskClass === "CRITICAL_SCORING") && !gateEvidence) {
    return { decision: "HOLD", severity: "HIGH", reasons: ["a critical domain may not be promoted without gate evidence"], notes };
  }

  return { decision: "PROMOTE", severity: "OK", reasons: [`${state} → ${target}`], notes };
}

// ---------------------------------------------------------------------------------------------
// Multi-app coordination
// ---------------------------------------------------------------------------------------------

export function isSharedDomain(domainId) { return doc().multiApp.sharedDomains.includes(domainId); }

/**
 * MA-1: a shared domain advances at the slowest app's readiness.
 * `perApp` maps app → state for this domain.
 */
export function sharedDomainState(domainId, perApp = {}) {
  if (!isSharedDomain(domainId)) return { shared: false };
  const order = states();
  const entries = Object.entries(perApp);
  if (!entries.length) return { shared: true, state: null, reason: "no app state supplied" };
  let slowest = entries[0];
  for (const e of entries) if (order.indexOf(e[1]) < order.indexOf(slowest[1])) slowest = e;
  return { shared: true, state: slowest[1], limitedBy: slowest[0],
    reason: `a shared domain advances at the slowest app (${slowest[0]} at ${slowest[1]})` };
}

/** MA-4: the freeze of a shared domain requires every app to be at CUTOVER_READY for it. */
export function mayFreezeSharedDomain(domainId, perApp = {}) {
  if (!isSharedDomain(domainId)) return { allowed: true, reason: "not a shared domain" };
  const order = states();
  const ready = order.indexOf("CUTOVER_READY");
  const laggards = Object.entries(perApp).filter(([, s]) => order.indexOf(s) < ready).map(([a]) => a);
  return { allowed: laggards.length === 0, laggards,
    reason: laggards.length ? `apps not yet CUTOVER_READY: ${laggards.join(", ")}` : "all apps ready" };
}

// ---------------------------------------------------------------------------------------------
// Scheduling constraints
// ---------------------------------------------------------------------------------------------

export function checkSchedulingConstraints(domainId, worldState = {}) {
  const violations = [];
  for (const sc of doc().schedulingConstraints) {
    if (!sc.eventDriven) continue;
    // "all operator contracts" is an OPERATOR scope, not a wildcard over every domain. Treating it
    // as a wildcard made SC-5 (no concurrent admin session) block every domain promotion, which
    // would have trained an operator to ignore it.
    const applies = (sc.appliesTo || []).some((a) => a === domainId) ||
      ((sc.appliesTo || []).includes("all operator contracts") && domainId === "audit");
    if (!applies) continue;
    const satisfied = worldState[sc.constraint];
    if (satisfied !== true) {
      violations.push({ id: sc.id, constraint: sc.constraint,
        reason: satisfied === undefined ? "UNMEASURED" : "VIOLATED", why: sc.why });
    }
  }
  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------------------------
// Backfill race / delta reconciliation
// ---------------------------------------------------------------------------------------------

/**
 * A minimal delta-pass model, used to prove that each domain's declared strategy actually catches
 * the writes that land after extraction. `source` is the legacy items; `copied` is what the bulk
 * pass produced; `mutations` are writes that happened after extraction.
 */
export function runDeltaPass({ domain, source = [], copied = [], keyOf = (x) => x.id,
  fingerprintOf = (x) => JSON.stringify(x) }) {
  const d = domainDef(domain);
  if (d.raceStrategy === "NOT_BACKFILLED_BY_DESIGN" || d.raceStrategy === "DERIVED_NEVER_BACKFILLED") {
    return { applied: [], missed: [], strategy: d.raceStrategy, unresolvedDelta: 0,
      reason: "this domain is not copied, so there is no delta to reconcile" };
  }
  const byKey = new Map(copied.map((c) => [keyOf(c), c]));
  const applied = [], missed = [];
  for (const item of source) {
    const k = keyOf(item);
    const have = byKey.get(k);
    if (!have) { applied.push({ key: k, action: "INSERT" }); byKey.set(k, item); continue; }
    if (fingerprintOf(have) !== fingerprintOf(item)) {
      // An in-place correction. Only a content-fingerprinting strategy detects it.
      if (d.raceStrategy === "CREATED_AT_WATERMARK") missed.push({ key: k, action: "MISSED_INPLACE_UPDATE" });
      else applied.push({ key: k, action: "UPDATE" });
    }
  }
  return { applied, missed, strategy: d.raceStrategy, unresolvedDelta: missed.length };
}

export function requiresZeroDelta(domainId) {
  const d = domainDef(domainId);
  return d.noUnresolvedDeltaBeforeCutover === true ||
    d.riskClass === "HIGH_RISK_FINANCIAL" || d.riskClass === "CRITICAL_SCORING";
}

// ---------------------------------------------------------------------------------------------
// Structural validation and cross-artefact drift (WS5.48)
// ---------------------------------------------------------------------------------------------

const REQUIRED_STATES = ["LEGACY_ONLY", "EXPANDED_SCHEMA", "REFERENCE_BACKFILLED", "DOMAIN_BACKFILLING",
  "DOMAIN_BACKFILLED", "DUAL_READ_SHADOW", "SERVER_WRITE_CANARY", "SERVER_WRITE_PRIMARY",
  "LEGACY_WRITE_DISABLED", "NEW_READ_PRIMARY", "LEGACY_READ_FALLBACK", "PARITY_OBSERVATION",
  "CUTOVER_READY", "LEGACY_FROZEN", "CONTRACT_ELIGIBLE", "LEGACY_RETIRED"];

const REQUIRED_FLAGS = ["normalized_reads_enabled", "normalized_reads_shadow", "server_writes_enabled",
  "server_write_canary", "legacy_writes_allowed", "legacy_read_fallback", "outbox_delivery_enabled",
  "new_reporting_enabled"];

export function validateChoreography(d = doc()) {
  const errors = [];
  const ids = d.states.map((s) => s.id);
  const seen = new Set();
  for (const id of ids) { if (seen.has(id)) errors.push(`duplicate state ${id}`); seen.add(id); }
  for (const r of REQUIRED_STATES) if (!seen.has(r)) errors.push(`required state missing: ${r}`);

  const SCOPES = ["GLOBAL", "DOMAIN", "APP"];
  for (const s of d.states) {
    if (!SCOPES.includes(s.scope)) errors.push(`${s.id}: invalid scope ${s.scope}`);
    if (!s.rollbackClass) errors.push(`${s.id}: no rollbackClass — WS5.21 requires one per state`);
    if (!s.reads) errors.push(`${s.id}: does not say where reads come from`);
    if (!s.writes) errors.push(`${s.id}: does not say where writes go`);
    if (!s.schema) errors.push(`${s.id}: does not say what schema exists`);
  }
  const CLASSES = ["APP_ROLLBACK_ONLY", "FEATURE_FLAG_ROLLBACK", "WRITE_PATH_ROLLBACK",
    "SCHEMA_ROLLBACK", "FORWARD_FIX_ONLY", "DATA_RESTORE_REQUIRED"];
  for (const s of d.states) if (s.rollbackClass && !CLASSES.includes(s.rollbackClass)) {
    errors.push(`${s.id}: unknown rollback class ${s.rollbackClass}`);
  }

  for (const t of d.transitions) {
    if (!seen.has(t.from)) errors.push(`transition from unknown state ${t.from}`);
    if (!seen.has(t.to)) errors.push(`transition to unknown state ${t.to}`);
  }
  // Reachability: every state except the entry point must be reachable.
  const reach = new Set(["LEGACY_ONLY"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of d.transitions) if (reach.has(t.from) && !reach.has(t.to)) { reach.add(t.to); grew = true; }
  }
  for (const id of ids) if (!reach.has(id)) errors.push(`${id} is unreachable from LEGACY_ONLY`);

  // Every declared illegal example must in fact be illegal.
  for (const ex of d.illegalTransitionExamples) {
    if (d.transitions.some((t) => t.from === ex.from && t.to === ex.to)) {
      errors.push(`${ex.from} → ${ex.to} is listed as illegal but a transition declares it`);
    }
  }

  // Ordering invariants that the whole design rests on.
  const idx = (s) => ids.indexOf(s);
  if (idx("LEGACY_WRITE_DISABLED") > idx("NEW_READ_PRIMARY")) {
    errors.push("OI-4: the legacy write fence must precede the read cutover");
  }
  if (idx("NEW_READ_PRIMARY") > idx("LEGACY_FROZEN")) {
    errors.push("the read cutover must precede the freeze, or the cheap rollback never exists");
  }
  if (idx("LEGACY_FROZEN") > idx("CONTRACT_ELIGIBLE")) errors.push("the freeze must precede contract eligibility");

  // Flags.
  const flagIds = d.flags.map((f) => f.id);
  for (const r of REQUIRED_FLAGS) if (!flagIds.includes(r)) errors.push(`required flag missing: ${r}`);
  for (const f of d.flags) {
    for (const k of ["owner", "default", "scope", "rollbackMeaning", "retirementCondition"]) {
      if (f[k] === undefined) errors.push(`flag ${f.id}: no ${k} — WS5.19 requires all five`);
    }
  }
  // Every rule must have a predicate, and every predicate a rule. A rule with no predicate is prose.
  const ruleIds = d.flagRules.map((r) => r.id);
  for (const r of ruleIds) if (!FLAG_PREDICATES[r]) errors.push(`flag rule ${r} has no bound predicate`);
  for (const p of Object.keys(FLAG_PREDICATES)) if (!ruleIds.includes(p)) errors.push(`predicate ${p} has no declared rule`);

  const acIds = d.abortCriteria.map((a) => a.id);
  for (const a of acIds) if (!ABORT_PREDICATES[a]) errors.push(`abort criterion ${a} has no bound predicate`);
  for (const p of Object.keys(ABORT_PREDICATES)) if (!acIds.includes(p)) errors.push(`abort predicate ${p} has no declared criterion`);

  // Old-client matrix must be total, and must never permit a corrupting operation.
  const ops = d.oldClientMatrix.operations;
  for (const id of ids) {
    const row = d.oldClientMatrix.byState[id];
    if (!row) { errors.push(`old-client matrix has no row for ${id}`); continue; }
    for (const op of ops) {
      if (!row[op]) errors.push(`old-client matrix: ${id} has no classification for ${op}`);
      else if (!CLASSIFICATIONS.includes(row[op])) errors.push(`old-client matrix: ${id}.${op} unknown class ${row[op]}`);
      else if (row[op] === "DATA_CORRUPTION_RISK") errors.push(`old-client matrix: ${id}.${op} is DATA_CORRUPTION_RISK — no state may permit this`);
    }
  }

  // Domains.
  for (const dom of d.domains) {
    if (!dom.riskClass) errors.push(`domain ${dom.id}: no risk class`);
    if (!d.observationWindows[dom.riskClass]) errors.push(`domain ${dom.id}: risk class ${dom.riskClass} has no observation window`);
    if (!dom.raceStrategy) errors.push(`domain ${dom.id}: no race strategy — WS5.17 requires one per domain`);
    if (!dom.raceWhy) errors.push(`domain ${dom.id}: race strategy is asserted without a reason`);
    if (dom.raceStrategy && !Object.prototype.hasOwnProperty.call(d.backfillRace.watermarkTypes, dom.raceStrategy)) {
      errors.push(`domain ${dom.id}: race strategy ${dom.raceStrategy} is not a declared watermark type`);
    }
    const money = dom.riskClass === "HIGH_RISK_FINANCIAL";
    if (money && !(dom.parity || []).includes("FINANCIAL_PARITY")) {
      errors.push(`domain ${dom.id} is financial but does not require FINANCIAL_PARITY`);
    }
    if (dom.riskClass === "CRITICAL_SCORING" && !(dom.parity || []).includes("SCORING_PARITY")) {
      errors.push(`domain ${dom.id} is scoring-critical but does not require SCORING_PARITY`);
    }
    if ((dom.parity || []).length === 1 && dom.parity[0] === "ROW_COUNT_PARITY" && !dom.parityWhy && dom.raceStrategy !== "NONE_REQUIRED") {
      errors.push(`domain ${dom.id}: row count alone is not parity`);
    }
  }

  // Points of no simple return must be ordered and must name a real state.
  for (const p of d.pointsOfNoSimpleReturn) {
    if (p.state !== "post-M17" && !seen.has(p.state)) errors.push(`PNSR ${p.id} names unknown state ${p.state}`);
  }

  // Deployment order must be acyclic and forward-referencing only.
  for (const s of d.deploymentOrder) {
    for (const dep of s.dependsOn || []) {
      if (typeof dep === "number" && dep >= s.step) errors.push(`deployment step ${s.step} depends on ${dep}, which is not earlier`);
    }
  }
  const irreversible = d.deploymentOrder.filter((s) => s.irreversible);
  if (irreversible.length !== 1) errors.push(`expected exactly one irreversible deployment step, found ${irreversible.length}`);
  else if (irreversible[0].step !== d.deploymentOrder.length) errors.push("the irreversible step must be last");

  // Findings must be actionable.
  for (const f of d.findings) {
    for (const k of ["severity", "title", "found", "why", "resolution"]) {
      if (!f[k]) errors.push(`finding ${f.id}: missing ${k}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** WS5.48 — drift against the artefacts WS5 must not contradict. */
export function checkDrift() {
  const d = doc();
  const errors = [];
  const read = (p) => JSON.parse(readFileSync(join(ROOT, "model", p), "utf8"));

  // 1. migration_phases.json — every phase in the readiness matrix must exist, and vice versa.
  const phases = read("migration_phases.json").phases.map((p) => p.id);
  const rows = Object.keys(d.readinessMatrix.rows);
  for (const r of rows) {
    // A `DDL-` prefixed phase belongs to the DRAFT scheme only. model/migration_phases.json describes
    // the PROGRAMME scheme, which interleaves backfills and has no counterpart for a pure-DDL addition.
    // The namespace exists precisely so a new phase cannot collide with the programme scheme's own M11.
    if (/^DDL-M/.test(r)) continue;
    if (!phases.includes(r)) errors.push(`readiness matrix names ${r}, which is not a declared phase`);
  }
  for (const p of phases) {
    if (p === "M0") continue; // M0 is a baseline registration decision, tracked separately
    if (!rows.includes(p)) errors.push(`phase ${p} has no readiness matrix row`);
  }
  // DRAFT_READY must be YES exactly for M1..M10 and n/a beyond.
  for (const [id, row] of Object.entries(d.readinessMatrix.rows)) {
    if (/^DDL-M/.test(id)) {
      if (row.DRAFT_READY !== "YES") errors.push(`readiness ${id}: DRAFT_READY is ${row.DRAFT_READY}, expected YES (a namespaced DDL phase has a draft)`);
      continue;
    }
    const n = Number(id.slice(1));
    const expected = n >= 1 && n <= 10 ? "YES" : "n/a";
    if (row.DRAFT_READY !== expected) {
      errors.push(`readiness ${id}: DRAFT_READY is ${row.DRAFT_READY}, expected ${expected} (only M1–M10 have SQL drafts)`);
    }
  }

  // 2. target_model.json — every domain must map onto real entities.
  const entities = new Set(read("target_model.json").entities.map((e) => e.name));
  const DOMAIN_ENTITIES = {
    competition_editions: ["competitions", "competition_editions", "competition_edition_phases"],
    participants: ["participants"], identity_links: ["participant_identity_links"],
    pools: ["pools", "pool_fee_schedule"], entries: ["pool_entries"], payments: ["payments"],
    allocations: ["payment_allocations"], prize_allocations: ["prize_allocations"],
    matches: ["matches"], ties: ["ties"], results: ["match_results"], predictions: ["predictions"],
    // M17. br2026's zone picks are their own domain, not part of `predictions`: they carry no
    // match_id and no tie_id, which is exactly why bolao.predictions cannot hold them, and their
    // race strategy differs — a zone pick has no per-pick timestamp to watermark on.
    classificationPredictions: ["classification_predictions"],
    rankings: ["ranking_snapshots"], sync_state: ["sync_state"],
    audit: ["audit_events", "audit_event_details", "audit_chain_head"], outbox: ["outbox_events", "outbox_delivery_attempts"],
    classification: ["classification_snapshots", "competition_edition_standings"],
    write_contracts: ["request_idempotency"],
    // KPLUS-F047 — ratified as WS12-OP-2 and referenced by every ownership policy, but mapped to no domain.
    participant_auth_links: ["participant_auth_links"],
    // M14. Lineage is not a business domain — it is the record of what the migration DID to the other
    // domains. Mapping it into one of them (audit, say) would make provenance look like an application
    // fact and put it behind that domain's gates, when in truth every domain writes it.
    migration_lineage: ["migration_lineage"],
    reporting: [],
  };
  for (const dom of d.domains) {
    const mapped = DOMAIN_ENTITIES[dom.id];
    if (!mapped) { errors.push(`domain ${dom.id} maps to no target entity`); continue; }
    for (const e of mapped) if (!entities.has(e)) errors.push(`domain ${dom.id} maps to unknown entity ${e}`);
  }
  const covered = new Set(Object.values(DOMAIN_ENTITIES).flat());
  for (const e of entities) if (!covered.has(e)) errors.push(`target entity ${e} belongs to no migration domain`);

  // 3. write_contracts.json — the gates may only name contracts that exist.
  const wc = read("write_contracts.json");
  const contractNames = new Set(Object.values(wc.contracts).map((c) => c.name).filter(Boolean));
  for (const step of d.canary.ordering) {
    for (const c of step.contracts || []) {
      if (contractNames.size && !contractNames.has(c)) errors.push(`canary step ${step.step} names unknown contract ${c}`);
    }
  }
  // WS13-OP-1's allowlist must be reproduced exactly, not paraphrased.
  const ALLOWLIST = ["pool_entries.entry_label", "participants.display_name", "participants.email",
    "pools.name", "pools.status", "matches.status"];
  const adm1 = d.cutoverGates.admin.requirements.find((r) => r.id === "ADM-1");
  for (const f of ALLOWLIST) if (!adm1.meaning.includes(f)) errors.push(`ADM-1 omits the ratified correctable field ${f}`);

  // 4. R-GAP-1 must remain declared open in both places, and must not be claimed closed here.
  if (d.cutoverGates.admin.rGap1.status !== "OPEN") errors.push("R-GAP-1 is not OPEN in the admin gate");
  if (wc.meta.rGap1 && /closed|resolved/i.test(JSON.stringify(wc.meta.rGap1)) === false) { /* consistent: still open */ }
  if (/DB-native operator auth|database-verifiable operator/i.test(d.cutoverGates.admin.rGap1.doNotClaim) === false) {
    errors.push("the admin gate does not record what must not be claimed about operator identity");
  }

  // 5. rls_model.json — WS5-F4: the legacy fence has no modelled policy, and that must stay recorded.
  const rls = read("rls_model.json");
  const rlsText = JSON.stringify(rls);
  const legacyModelled = /bolao_state/.test(rlsText);
  const f4Recorded = d.findings.some((f) => f.id === "WS5-F4") &&
    d.readinessMatrix.rows.M13.RLS_READY === "NO";
  if (!legacyModelled && !f4Recorded) errors.push("no legacy-document policy is modelled and WS5-F4 no longer records the gap");
  if (legacyModelled && f4Recorded) errors.push("WS5-F4 claims no legacy policy is modelled, but rls_model.json now covers bolao_state");

  return { ok: errors.length === 0, errors };
}

export default { loadChoreography, canTransition, validateFlags, evaluatePromotion, validateChoreography, checkDrift };
