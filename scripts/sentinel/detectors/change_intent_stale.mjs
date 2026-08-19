#!/usr/bin/env node
/**
 * change_intent_stale.mjs — Sentinel detector wrapping the EXISTING D1/D3 checks.
 *
 * This detector does not invent a new definition of "stale," "malformed," or "invariant
 * violated." It imports the SAME canonical lifecycle functions
 * (validateLifecycle/evaluateConditionalInvariants/makeInvariantChecks) that
 * scripts/safety/audit_safety_contract.mjs's own D1/D3 checks use — see ADR-018. Two
 * implementations of "is this declaration okay" would be exactly the class of defect this
 * repo's whole safety-contract module system exists to prevent (surfaces.mjs's own docstring).
 *
 * A declaration produces a Finding when:
 *   - malformed: fails validateLifecycle (unknown lifecycle, conditional missing condition_id /
 *     related_issue / exit_conditions / a real MACHINE_VERIFIABLE check, duplicate condition_id).
 *   - one_shot (explicit or by absence) and stale: no declared path intersects the current
 *     changed-paths set — identical predicate to before lifecycle existed.
 *   - conditional and a MACHINE_VERIFIABLE exit_condition's invariant is currently violated.
 * A conditional declaration that is well-formed AND whose invariants currently hold produces NO
 * finding, regardless of how many unrelated commits have landed since it was written — see
 * ADR-018: age/unrelated-commit-count is deliberately not a staleness signal for conditional
 * intent (a future CONDITIONAL_INTENT_REVIEW_DUE detector could add an age-based nudge later;
 * this detector does not).
 *
 * READ-ONLY. Never writes CHANGE_INTENT.json, never writes anything at all — it only produces
 * zero or more normalized Findings.
 */
import { createHash } from "node:crypto";
import {
  loadSurfaces, loadIntent, resolveBase, changedPaths, pathMatches,
  LIFECYCLES, makeInvariantChecks, validateLifecycle, evaluateConditionalInvariants, ROOT,
} from "../../safety/surfaces.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { changeIntentStaleFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "change_intent_stale";
export const DETECTOR_VERSION = "1.1.0";

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/** Real production reader for makeInvariantChecks — reads the CURRENT file from this checkout's ROOT. */
function realRead(p) {
  const full = join(ROOT, p);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

function baseFinding({ observedAt, declaration, kind, facts, evidence, sourceSha, evidenceExtra }) {
  const fingerprint = changeIntentStaleFingerprint(declaration.surface_id);
  const { canonical, authorization } = applyPolicy(DETECTOR_ID);
  const evidenceHash = hash(JSON.stringify({ surfaceId: declaration.surface_id, kind, ...evidenceExtra }));
  return makeFinding({
    finding_type: DETECTOR_ID,
    fingerprint,
    detector_id: DETECTOR_ID,
    detector_version: DETECTOR_VERSION,
    observed_at: observedAt,
    facts,
    evidence,
    canonical,
    authorization,
    provenance: {
      source_sha: sourceSha,
      detector_version: DETECTOR_VERSION,
      policy_version: POLICY_VERSION,
      config_hash: hash(JSON.stringify({ kind })),
      evidence_hash: evidenceHash,
    },
    status: "DETECTED",
    affected_files: ["CHANGE_INTENT.json"],
    affected_components: ["safety-contract", declaration.surface_id],
    schema_version: SCHEMA_VERSION,
  });
}

/**
 * Runs the detector against the CURRENT repository state (working tree + committed diff since the
 * resolved base — identical semantics to what `npm run check` itself measures). Returns an array
 * of Findings (possibly empty).
 *
 * Dependencies default to the real scripts/safety/surfaces.mjs functions, which are hardcoded to
 * this checkout's own root and can't be pointed at a fixture repo. Tests inject fakes instead of
 * touching that shared, already-tested module.
 */
export function detectChangeIntentStale({
  observedAt = new Date().toISOString(),
  loadSurfacesFn = loadSurfaces,
  loadIntentFn = loadIntent,
  resolveBaseFn = resolveBase,
  changedPathsFn = changedPaths,
  invariantChecks = makeInvariantChecks(realRead),
} = {}) {
  const reg = loadSurfacesFn();
  const intent = loadIntentFn();
  const base = resolveBaseFn();
  const changed = changedPathsFn(base.sha);
  const ids = reg.surfaces.map((s) => s.id);

  const findings = [];
  const seenConditionIds = new Set();
  for (const declaration of intent.declarations) {
    if (!ids.includes(declaration.surface_id)) continue; // unknown surface_id — D1's problem, not this detector's concern

    const lifecycleProblems = validateLifecycle(declaration, invariantChecks, seenConditionIds);
    if (lifecycleProblems.length) {
      findings.push(baseFinding({
        observedAt, declaration, kind: "malformed_lifecycle",
        facts: [
          `CHANGE_INTENT.json's declaration for surface_id "${declaration.surface_id}" has a malformed lifecycle shape.`,
          ...lifecycleProblems,
        ],
        evidence: [`surface_id=${declaration.surface_id}`, `lifecycle=${declaration.lifecycle ?? "(absent)"}`],
        sourceSha: base.sha,
        evidenceExtra: { problems: lifecycleProblems },
      }));
      continue;
    }

    const surface = reg.surfaces.find((s) => s.id === declaration.surface_id);
    if (surface.change_policy === "STRUCTURALLY_ENFORCED") continue;

    const lifecycle = declaration.lifecycle === undefined ? "one_shot" : declaration.lifecycle;

    if (lifecycle === "conditional") {
      const results = evaluateConditionalInvariants(declaration, invariantChecks);
      const broken = results.filter((r) => !r.ok);
      if (broken.length) {
        findings.push(baseFinding({
          observedAt, declaration, kind: "conditional_invariant_violated",
          facts: [
            `CHANGE_INTENT.json's conditional declaration for surface_id "${declaration.surface_id}" (condition_id "${declaration.condition_id}") asserts an invariant that is currently VIOLATED.`,
            ...broken.map((b) => `${b.id}: ${b.detail}`),
          ],
          evidence: [
            `surface_id=${declaration.surface_id}`,
            `condition_id=${declaration.condition_id}`,
            `related_issue=${declaration.related_issue}`,
          ],
          sourceSha: base.sha,
          evidenceExtra: { conditionId: declaration.condition_id, broken: broken.map((b) => b.id) },
        }));
      }
      // Well-formed + invariant holds: NOT stale, regardless of base/age/unrelated commits — see
      // module docstring and ADR-018. Deliberately does not fall through to the one_shot check.
      continue;
    }

    // one_shot (explicit or by absence): identical predicate to before lifecycle existed.
    const paths = surface.paths || surface.fingerprint?.files || [];
    const isStale = !changed.some((p) => pathMatches(p, paths));
    if (!isStale) continue;

    findings.push(baseFinding({
      observedAt, declaration, kind: "one_shot_stale",
      facts: [
        `CHANGE_INTENT.json declares surface_id "${declaration.surface_id}" as an active change.`,
        `No path covered by that surface appears in the diff between base (${base.how}) and HEAD.`,
        `Comparison base SHA: ${base.sha ?? "(none — no history to compare against)"}.`,
      ],
      evidence: [
        `surface_id=${declaration.surface_id}`,
        `declaration.reason (verbatim, governance text, safe to quote): ${declaration.reason}`,
      ],
      sourceSha: base.sha,
      evidenceExtra: { baseSha: base.sha, how: base.how },
    }));
  }
  return findings;
}

export const REPO = REPOSITORY;
