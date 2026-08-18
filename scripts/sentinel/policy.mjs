#!/usr/bin/env node
/**
 * policy.mjs — the ONLY place a Finding's canonical fields get set.
 *
 * No AI in this vertical slice (CHANGE_INTENT Stale has no `suggested` block at all — see the
 * architecture doc: it's absent, not an error, whenever no Triage/AI pass ran). Every value below
 * is a deterministic rule-floor set once, in code, matching this repo's existing Project taxonomy
 * exactly — no new fields, no new options.
 *
 * The clamp function exists here even though this detector never receives an AI suggestion,
 * because policy.mjs is where EVERY future detector's clamp will live too — this is the one place
 * "AI may raise, never lower, below the rule floor" is enforced, structurally, for the whole
 * system, not per-detector.
 */

export const POLICY_VERSION = "1.0.0";

const SEVERITY_ORDER = ["None", "Low", "Medium", "High", "Critical"];
const PRIORITY_ORDER = ["P3 - Low", "P2 - Medium", "P1 - High", "P0 - Critical"];

function clampOrdered(order, floor, suggested) {
  if (!suggested) return floor;
  const floorIdx = order.indexOf(floor);
  const suggestedIdx = order.indexOf(suggested);
  if (suggestedIdx < 0) return floor; // unrecognized suggestion never wins
  return suggestedIdx > floorIdx ? suggested : floor; // AI may only raise, never lower
}

/** The one function every detector's canonical severity/priority must pass through. */
export function clampSeverity(floor, suggested) { return clampOrdered(SEVERITY_ORDER, floor, suggested); }
export function clampPriority(floor, suggested) { return clampOrdered(PRIORITY_ORDER, floor, suggested); }

/**
 * Rule-level defaults, keyed by detector_id. Adding a new detector means adding one entry here —
 * this is intentionally the single place a new detector's severity floor is decided, not scattered
 * per-detector logic.
 */
const RULE_DEFAULTS = {
  change_intent_stale: {
    severity: "Medium",
    priority: "P2 - Medium",
    work_type: "Governance / Drift",
    area: "Governance",
    environment: "Development",
    domain: "Shared Platform",
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
  },
};

/**
 * Builds the canonical block + authorization pair for a detector's raw finding. `suggested` is
 * optional and, for this vertical slice, always absent (no AI runs on this detector) — the clamp
 * functions handle its absence correctly (floor wins).
 */
export function applyPolicy(detectorId, suggested = {}) {
  const rule = RULE_DEFAULTS[detectorId];
  if (!rule) throw new Error(`policy.mjs: no rule defaults registered for detector_id "${detectorId}"`);

  return {
    canonical: {
      severity: clampSeverity(rule.severity, suggested.severity),
      priority: clampPriority(rule.priority, suggested.priority),
      work_type: rule.work_type,
      area: rule.area,
      environment: rule.environment,
      domain: rule.domain,
      data_impact: rule.data_impact,
      scoring_ranking_impact: rule.scoring_ranking_impact,
    },
    authorization: {
      investigation_level: rule.investigation_level,
      mutation_level: rule.mutation_level,
    },
  };
}
