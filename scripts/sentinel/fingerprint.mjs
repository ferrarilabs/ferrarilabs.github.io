#!/usr/bin/env node
/**
 * fingerprint.mjs — deterministic Finding identity.
 *
 * A fingerprint is built ONLY from fields that identify the same underlying problem, never from
 * fields that describe one observation of it. No timestamp, no source SHA, no line number, no
 * workflow run ID — those change on every re-observation of the exact same problem, and including
 * any of them would mean every scan creates a new Issue instead of updating one (the "one Issue
 * per scan" failure this architecture exists to avoid). See the architecture doc's "Fingerprinting"
 * section for the full reasoning.
 */
import { createHash } from "node:crypto";

const REPO = "ferrarilabs/ferrarilabs.github.io";

function hash(parts) {
  return "sha256:" + createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

/**
 * CHANGE_INTENT Stale: identity is the repo + finding type + the declaration's own surface_id.
 * A surface_id is already a stable, unique identifier (assigned once, in critical_surfaces.json) —
 * no additional entropy needed.
 */
export function changeIntentStaleFingerprint(surfaceId) {
  return hash([REPO, "change_intent_stale", surfaceId]);
}

export const REPOSITORY = REPO;
