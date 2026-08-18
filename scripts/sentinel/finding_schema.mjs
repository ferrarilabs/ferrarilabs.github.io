#!/usr/bin/env node
/**
 * finding_schema.mjs — the canonical Sentinel Finding contract.
 *
 * One shape, validated before it's ever handed to fingerprint/policy/writer. Mandatory fields are
 * the ones every downstream stage depends on unconditionally (identity, evidence discipline,
 * authorization, provenance, status) — see the architecture doc's "Finding Contract" section for
 * the reasoning. Domain-specific fields (affected_files, pr_number, ...) are optional and absent
 * by default: most v1.0 findings are platform-wide, not competition-specific.
 *
 * No PII/secrets belong in a Finding — `facts`/`evidence` must already be masked/structural by the
 * time a detector produces one (detectors reuse existing masking, they don't invent their own).
 */

export const SCHEMA_VERSION = 1;

const REQUIRED_TOP_LEVEL = [
  "schema_version", "finding_type", "fingerprint", "detector_id", "detector_version",
  "observed_at", "facts", "evidence", "canonical", "authorization", "provenance", "status",
];

const REQUIRED_CANONICAL = ["severity", "priority", "work_type", "area"];
const REQUIRED_AUTHORIZATION = ["investigation_level", "mutation_level"];
const REQUIRED_PROVENANCE = ["source_sha", "detector_version", "policy_version", "config_hash", "evidence_hash"];

export const INVESTIGATION_LEVELS = ["I0", "I1", "I2", "I3"];
export const MUTATION_LEVELS = ["M0", "M1", "M2", "M3", "M4"];
export const STATUSES = [
  "DETECTED", "TRIAGING", "CONFIRMED", "FALSE_POSITIVE", "QUARANTINED",
  "ISSUE_OPEN", "RESOLVED", "RECURRENT",
];

/**
 * Validates a Finding's shape. Returns { ok, errors }. Never throws — callers decide what to do
 * with an invalid Finding (the writer must refuse to act on one; a detector's own tests should
 * never produce one).
 */
export function validateFinding(f) {
  const errors = [];
  if (!f || typeof f !== "object") return { ok: false, errors: ["finding is not an object"] };

  for (const field of REQUIRED_TOP_LEVEL) {
    if (f[field] === undefined || f[field] === null) errors.push(`missing required field: ${field}`);
  }
  if (f.schema_version !== SCHEMA_VERSION) errors.push(`unsupported schema_version: ${f.schema_version}`);
  if (!Array.isArray(f.facts) || f.facts.length === 0) errors.push("facts must be a non-empty array");
  if (!Array.isArray(f.evidence)) errors.push("evidence must be an array");

  if (f.canonical) {
    for (const field of REQUIRED_CANONICAL) {
      if (!f.canonical[field]) errors.push(`missing canonical.${field}`);
    }
  }
  if (f.authorization) {
    for (const field of REQUIRED_AUTHORIZATION) {
      if (!f.authorization[field]) errors.push(`missing authorization.${field}`);
    }
    if (f.authorization.investigation_level && !INVESTIGATION_LEVELS.includes(f.authorization.investigation_level)) {
      errors.push(`invalid investigation_level: ${f.authorization.investigation_level}`);
    }
    if (f.authorization.mutation_level && !MUTATION_LEVELS.includes(f.authorization.mutation_level)) {
      errors.push(`invalid mutation_level: ${f.authorization.mutation_level}`);
    }
  }
  if (f.provenance) {
    for (const field of REQUIRED_PROVENANCE) {
      if (!f.provenance[field]) errors.push(`missing provenance.${field}`);
    }
  }
  if (f.status && !STATUSES.includes(f.status)) errors.push(`invalid status: ${f.status}`);

  // No raw PII-shaped values belong in a Finding. This is a shape check, not a full PII scan —
  // the real PII engine (scripts/pii_detectors.mjs) already exists for that; this just refuses
  // the most obvious case (a bare email address sitting in facts/evidence).
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const flat = JSON.stringify({ facts: f.facts, evidence: f.evidence });
  if (emailRe.test(flat)) errors.push("facts/evidence appear to contain a raw email address — mask before emitting a Finding");

  return { ok: errors.length === 0, errors };
}

/** Convenience constructor — fills github/optional fields with their documented defaults. */
export function makeFinding(partial) {
  return {
    schema_version: SCHEMA_VERSION,
    github: { issue_number: null, project_item_id: null },
    affected_files: [],
    affected_components: [],
    domain: null,
    competition_family: null,
    season: null,
    competition_instance: null,
    pr_number: null,
    workflow_run_id: null,
    resolution_evidence: null,
    resolved_at: null,
    ...partial,
  };
}
