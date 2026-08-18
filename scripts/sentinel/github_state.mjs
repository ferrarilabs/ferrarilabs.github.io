#!/usr/bin/env node
/**
 * github_state.mjs — the embedded, machine-readable Sentinel state block.
 *
 * GitHub IS the state store (see the architecture doc's "GitHub-Native State" section) — this
 * module is the only place that reads or writes the block, so its format only needs to be agreed
 * with itself. Format:
 *
 *   <!-- ferrarilabs-sentinel
 *   { ...json... }
 *   -->
 *
 * Rules enforced here:
 *   - only machine-safe fields ever go in the block (schema_version, fingerprint, finding_type,
 *     detector_id, detector_version, first_seen_at, last_seen_at, occurrence_count, source_sha,
 *     policy_version, status, clean_cycle_count, recurrence_count, canonical_last_written,
 *     provenance hashes) — never raw logs, never PII, enforced by an explicit allowlist below, not
 *     by convention;
 *   - the human-readable part of the Issue body is untouched — only the exact HTML-comment
 *     substring is ever replaced;
 *   - a missing or malformed block is recoverable, never fatal — parse failure returns `null`,
 *     callers rebuild fresh from observable GitHub truth (see writer.mjs/reconcile.mjs), they never
 *     crash the run;
 *   - schema migration is additive-only: `migrateState()` upgrades an older block to the current
 *     shape without dropping fields it doesn't recognize yet, on the theory that a future version
 *     added them for a reason.
 */

export const STATE_SCHEMA_VERSION = 1;
export const MARKER_START = "<!-- ferrarilabs-sentinel";
export const MARKER_END = "-->";

const ALLOWED_FIELDS = new Set([
  "schema_version", "fingerprint", "finding_type", "detector_id", "detector_version",
  "first_seen_at", "last_seen_at", "occurrence_count", "source_sha", "policy_version", "status",
  "clean_cycle_count", "recurrence_count", "canonical_last_written", "intended_canonical", "provenance",
]);

function stripDisallowedFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

/** Serializes a state object into the exact embeddable comment block. */
export function renderStateBlock(state) {
  const clean = stripDisallowedFields({ schema_version: STATE_SCHEMA_VERSION, ...state });
  return `${MARKER_START}\n${JSON.stringify(clean, null, 2)}\n${MARKER_END}`;
}

/**
 * Replaces (or appends, if absent) the state block inside an Issue body, leaving every other
 * character of the body untouched — this is the human-edit-protection guarantee: Sentinel never
 * rewrites prose it didn't write.
 */
export function upsertStateBlockInBody(body, state) {
  const block = renderStateBlock(state);
  const re = new RegExp(`${escapeRe(MARKER_START)}[\\s\\S]*?${escapeRe(MARKER_END)}`);
  if (re.test(body || "")) return body.replace(re, block);
  const sep = body && !body.endsWith("\n") ? "\n\n" : (body ? "\n" : "");
  return `${body || ""}${sep}${block}`;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Extracts and parses the state block from an Issue body. Returns `null` on absence OR malformed
 * JSON — never throws. A `null` return means "rebuild from observable GitHub truth," per this
 * module's own recovery contract; it is not an error condition callers need to special-case beyond
 * that.
 */
export function parseStateBlock(body) {
  if (!body) return null;
  const re = new RegExp(`${escapeRe(MARKER_START)}([\\s\\S]*?)${escapeRe(MARKER_END)}`);
  const m = re.exec(body);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].trim());
    return migrateState(parsed);
  } catch {
    return null; // malformed — recoverable, not fatal
  }
}

/**
 * Additive-only migration: brings an older-schema state block up to the current shape. A field
 * this version doesn't recognize is preserved as-is rather than dropped (it might matter to a
 * newer version that reads this same Issue later); a field this version requires but an older
 * block lacks gets a safe default, never `undefined`.
 */
export function migrateState(state) {
  if (!state || typeof state !== "object") return null;
  const out = { ...state };
  if (out.schema_version === undefined) out.schema_version = 1; // pre-versioning blocks are v1
  if (out.occurrence_count === undefined) out.occurrence_count = 1;
  if (out.clean_cycle_count === undefined) out.clean_cycle_count = 0;
  if (out.recurrence_count === undefined) out.recurrence_count = 0;
  if (out.canonical_last_written === undefined) out.canonical_last_written = {};
  if (out.intended_canonical === undefined) out.intended_canonical = {};
  out.schema_version = STATE_SCHEMA_VERSION;
  return out;
}
