#!/usr/bin/env node
/**
 * change_intent_stale.mjs — Sentinel detector wrapping the EXISTING D3 check.
 *
 * This detector does not invent a new definition of "stale." It reuses the exact same functions
 * scripts/safety/audit_safety_contract.mjs's own D3 check uses (resolveBase, changedPaths,
 * pathMatches, loadSurfaces, loadIntent) and replicates D3's own predicate byte-for-byte in
 * spirit: a declaration is stale when its surface isn't STRUCTURALLY_ENFORCED and none of its
 * paths (or, for SCORING_CONSTANTS-shaped surfaces with no `paths`, its fingerprint files) appear
 * in the changed-paths set. See scripts/safety/audit_safety_contract.mjs lines ~454-474 for the
 * source of truth this mirrors.
 *
 * READ-ONLY. Never writes CHANGE_INTENT.json, never writes anything at all — it only produces
 * zero or more normalized Findings, one per stale declaration (in practice almost always 0 or 1,
 * since CHANGE_INTENT.json's own documented lifecycle keeps `declarations` small).
 */
import { createHash } from "node:crypto";
import {
  loadSurfaces, loadIntent, resolveBase, changedPaths, pathMatches,
} from "../../safety/surfaces.mjs";
import { changeIntentStaleFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "change_intent_stale";
export const DETECTOR_VERSION = "1.0.0";

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/**
 * Same predicate as D3, reused deliberately rather than re-derived: a declaration is stale when
 * its surface isn't STRUCTURALLY_ENFORCED and none of its declared paths intersect the current
 * changed-paths set.
 */
function isStale(declaration, surfaces, changed) {
  const surface = surfaces.find((s) => s.id === declaration.surface_id);
  if (!surface) return false; // unknown surface_id — D1's problem, not D3's; not this detector's concern
  if (surface.change_policy === "STRUCTURALLY_ENFORCED") return false;
  const paths = surface.paths || surface.fingerprint?.files || [];
  return !changed.some((p) => pathMatches(p, paths));
}

/**
 * Runs the detector against the CURRENT repository state (working tree + committed diff since the
 * resolved base — identical semantics to what `npm run check` itself measures). Returns an array
 * of Findings (possibly empty).
 *
 * Dependencies default to the real scripts/safety/surfaces.mjs functions, which are hardcoded to
 * this checkout's own root and can't be pointed at a fixture repo. Tests inject fakes for
 * `loadSurfaces`/`loadIntent`/`resolveBase`/`changedPaths` instead of touching that shared,
 * already-tested module — this detector adds zero new semantics on top of D3, so faking its four
 * inputs is sufficient to exercise every branch of `isStale()` deterministically.
 */
export function detectChangeIntentStale({
  observedAt = new Date().toISOString(),
  loadSurfacesFn = loadSurfaces,
  loadIntentFn = loadIntent,
  resolveBaseFn = resolveBase,
  changedPathsFn = changedPaths,
} = {}) {
  const reg = loadSurfacesFn();
  const intent = loadIntentFn();
  const base = resolveBaseFn();
  const changed = changedPathsFn(base.sha);

  const configHash = hash(JSON.stringify({ schemaVersion: reg.schemaVersion, surfaceIds: reg.surfaces.map((s) => s.id).sort() }));

  const findings = [];
  for (const declaration of intent.declarations) {
    if (!isStale(declaration, reg.surfaces, changed)) continue;

    const fingerprint = changeIntentStaleFingerprint(declaration.surface_id);
    const { canonical, authorization } = applyPolicy(DETECTOR_ID);
    const evidenceHash = hash(JSON.stringify({ surfaceId: declaration.surface_id, baseSha: base.sha, how: base.how }));

    findings.push(makeFinding({
      finding_type: DETECTOR_ID,
      fingerprint,
      detector_id: DETECTOR_ID,
      detector_version: DETECTOR_VERSION,
      observed_at: observedAt,
      facts: [
        `CHANGE_INTENT.json declares surface_id "${declaration.surface_id}" as an active change.`,
        `No path covered by that surface appears in the diff between base (${base.how}) and HEAD.`,
        `Comparison base SHA: ${base.sha ?? "(none — no history to compare against)"}.`,
      ],
      evidence: [
        `surface_id=${declaration.surface_id}`,
        `declaration.reason (verbatim, governance text, safe to quote): ${declaration.reason}`,
      ],
      canonical,
      authorization,
      provenance: {
        source_sha: base.sha,
        detector_version: DETECTOR_VERSION,
        policy_version: POLICY_VERSION,
        config_hash: configHash,
        evidence_hash: evidenceHash,
      },
      status: "DETECTED",
      affected_files: ["CHANGE_INTENT.json"],
      affected_components: ["safety-contract", declaration.surface_id],
      schema_version: SCHEMA_VERSION,
    }));
  }
  return findings;
}

export const REPO = REPOSITORY;
