#!/usr/bin/env node
/**
 * Audit event model (Workstream U).
 *
 * THE RULE (ratified as B1, recorded as ADR-008)
 * `audit_events.safe_metadata` carries NO raw PII: no names, emails, phone numbers, payment references,
 * memos or free text copied from user input. An audit log is the artefact most likely to be exported,
 * pasted into a ticket, or handed to a third party during an investigation — so it is the worst place to
 * accumulate personal data, and the place where nobody notices it has.
 *
 * WHAT REPLACES PII
 * References, not values. `aggregate_type` + `aggregate_id` identify the row; a reader with authorisation
 * can join to it. A reader without authorisation learns nothing, which is the point.
 *
 * IMMUTABILITY, AND THE ONE EXCEPTION
 * Audit rows are immutable after insert and hash-chained, so tampering is detectable. That conflicts with
 * an erasure request — you cannot delete a chained row without breaking the chain. The resolution is a
 * REDACTABLE SIDECAR: `audit_event_details` holds before/after snapshots and may be nulled in place
 * (`redacted_at`), while the chained `audit_events` row keeps only references and never needs redaction.
 * The chain stays verifiable and erasure stays possible, because the two concerns live in different tables.
 *
 * Everything here is pure. No database access.
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const ACTOR_ROLES = ["participant", "operator", "service", "system", "migration"];
export const SOURCES = ["browser", "edge_function", "scheduled_job", "migration", "manual_operator"];

/** Retention: audit rows 5 years (financial evidence); payload sidecar 90 days then redactable. */
export const RETENTION = {
  audit_events: { policy: "RETAIN_5Y_AUDIT", why: "financial evidence must survive a dispute window" },
  audit_event_details: { policy: "RETAIN_90D_PAYLOAD", why: "before/after snapshots are only useful while an incident is live, and they are the part that carries PII" },
};

/**
 * Keys forbidden in safe_metadata, and the shapes forbidden in its values.
 *
 * Keys are checked by EXACT NAME or explicit suffix, never by substring: a substring check on "name"
 * would reject `aggregate_name` and `event_name`, which carry no personal data. Value shapes are checked
 * because the key name is not evidence — `note: "call bob@example.com"` is a leak whatever it is called.
 */
export const FORBIDDEN_KEYS = new Set([
  "email", "emails", "email_address", "participant_email", "payer_email",
  "phone", "phone_number", "whatsapp",
  "display_name", "participant_name", "payer_name", "entry_name", "full_name",
  "external_reference", "payment_reference", "reference", "txid", "tx_id",
  "memo", "note", "notes", "detail", "details", "comment", "message", "free_text",
  "password", "token", "api_key", "secret", "authorization", "cookie", "jwt",
  "address", "cpf", "ssn", "dob", "date_of_birth", "card", "card_number", "iban",
]);

export const VALUE_PATTERNS = [
  { id: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, why: "an email address" },
  { id: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, why: "a JSON Web Token" },
  { id: "PHONE", re: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,3}\)[\s-]?)?\d{4,5}[\s-]?\d{4}\b/, why: "a phone number" },
  { id: "PG_URI", re: /postgres(?:ql)?:\/\//i, why: "a database connection string" },
  { id: "PRIVATE_KEY", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: "a private key" },
  { id: "LONG_FREE_TEXT", re: /^[^\n]{200,}$/, why: "free text long enough to contain anything; audit metadata should be short references" },
];

/** Values whose type alone is safe: ids, counts, enums, booleans, timestamps. */
function scanValue(path, v, findings) {
  if (v === null || v === undefined) return;
  if (typeof v === "number" || typeof v === "boolean") return;
  if (typeof v === "string") {
    for (const p of VALUE_PATTERNS) {
      if (p.re.test(v)) findings.push({ path, id: p.id, why: `value looks like ${p.why}` });
    }
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => scanValue(`${path}[${i}]`, x, findings)); return; }
  if (typeof v === "object") { for (const [k, x] of Object.entries(v)) scanKeyValue(`${path}.${k}`, k, x, findings); return; }
  findings.push({ path, id: "UNSUPPORTED_TYPE", why: `type ${typeof v} is not a safe metadata value` });
}

function scanKeyValue(path, key, value, findings) {
  const k = String(key).toLowerCase();
  if (FORBIDDEN_KEYS.has(k)) findings.push({ path, id: "FORBIDDEN_KEY", why: `key "${key}" names a category of personal or secret data` });
  scanValue(path, value, findings);
}

/** Validate safe_metadata. Returns findings; empty means safe. */
export function checkSafeMetadata(metadata) {
  const findings = [];
  if (metadata === null || metadata === undefined) return findings;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return [{ path: "$", id: "SHAPE", why: "safe_metadata must be a JSON object" }];
  }
  for (const [k, v] of Object.entries(metadata)) scanKeyValue(`$.${k}`, k, v, findings);
  return findings;
}

/**
 * Build an audit event. Refuses to construct one that violates B1, rather than validating afterwards:
 * a validate-later design means the unsafe row exists in memory and can be written by any path that
 * forgets to call the validator.
 */
export function buildAuditEvent({
  id, occurredAt, actorRole, actorUserId = null, action,
  aggregateType, aggregateId, correlationId = null, requestId = null,
  source, reason = null, safeMetadata = {}, previousEventHash = null,
}) {
  if (!id) throw new Error("audit event needs an id");
  if (!occurredAt) throw new Error("audit event needs occurred_at");
  if (!ACTOR_ROLES.includes(actorRole)) throw new Error(`actor_role must be one of ${ACTOR_ROLES.join("|")}`);
  if (!action) throw new Error("audit event needs an action");
  if (!aggregateType || !aggregateId) {
    throw new Error("audit event needs aggregate_type and aggregate_id — an event that does not say WHAT it " +
      "happened to cannot be used in an investigation, which is the only reason the log exists");
  }
  if (!SOURCES.includes(source)) throw new Error(`source must be one of ${SOURCES.join("|")}`);

  const findings = checkSafeMetadata(safeMetadata);
  if (findings.length) {
    throw new Error(`safe_metadata violates B1/ADR-008: ${findings.map((f) => `${f.path} (${f.id})`).join(", ")}. ` +
      `Put the value in the redactable audit_event_details sidecar and reference it, or drop it.`);
  }
  // Operator and migration actions must say WHY. A privileged action with no stated reason is
  // indistinguishable from an unauthorised one when someone reads the log a year later.
  if (["operator", "migration"].includes(actorRole) && !reason) {
    throw new Error(`actor_role=${actorRole} requires a reason — a privileged action with no stated reason cannot be reviewed`);
  }

  const row = {
    audit_event_id: id,
    occurred_at: occurredAt,
    actor_role: actorRole,
    actor_user_id: actorUserId,
    action,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    correlation_id: correlationId,
    request_id: requestId,
    source,
    reason,
    safe_metadata: safeMetadata,
    previous_event_hash: previousEventHash,
  };
  return Object.freeze({ ...row, event_hash: hashEvent(row) });
}

/**
 * Chain hash. Computed over a CANONICAL serialisation with sorted keys, so a JSON key-order difference
 * between two writers cannot break a chain that is otherwise intact.
 */
export function hashEvent(row) {
  const canonical = JSON.stringify(sortDeep({
    audit_event_id: row.audit_event_id, occurred_at: row.occurred_at, actor_role: row.actor_role,
    actor_user_id: row.actor_user_id, action: row.action, aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id, correlation_id: row.correlation_id, request_id: row.request_id,
    source: row.source, reason: row.reason, safe_metadata: row.safe_metadata,
    previous_event_hash: row.previous_event_hash,
  }));
  return createHash("sha256").update(canonical).digest("hex");
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  }
  return v;
}

/** Append to a chain, wiring previous_event_hash automatically so a caller cannot get it wrong. */
export function appendToChain(chain, spec) {
  const prev = chain.length ? chain[chain.length - 1].event_hash : null;
  return [...chain, buildAuditEvent({ ...spec, previousEventHash: prev })];
}

/** Verify a chain. Reports the FIRST broken link, since everything after it is unverifiable anyway. */
export function verifyChain(chain) {
  let prev = null;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.previous_event_hash !== prev) {
      return { valid: false, brokenAt: i, id: e.audit_event_id, reason: "previous_event_hash does not match the preceding row" };
    }
    if (hashEvent(e) !== e.event_hash) {
      return { valid: false, brokenAt: i, id: e.audit_event_id, reason: "event_hash does not match the row contents — the row was modified after insert" };
    }
    prev = e.event_hash;
  }
  return { valid: true, length: chain.length };
}

/**
 * CHAIN CHECKPOINT — the mitigation for tail truncation.
 *
 * A property test exposed a real limitation: `verifyChain` cannot detect removal of the LAST rows. Drop the
 * final k events and rows 0..n-k-1 still form a perfectly valid chain, because a hash chain proves only
 * that what remains is internally consistent — it says nothing about what used to follow. An attacker (or a
 * botched retention job) removing the most recent events leaves no trace in the chain itself.
 *
 * The fix is external: periodically record `{count, lastHash, at}`. Verification then checks the chain AND
 * that it still reaches at least the checkpointed count ending in the checkpointed hash. Truncation back
 * past a checkpoint becomes detectable; truncation of events added since the last checkpoint remains
 * undetectable, which is why checkpoint frequency is an operator decision (U-OP-1) and is stated rather
 * than glossed.
 */
export function chainCheckpoint(chain, { at }) {
  return Object.freeze({
    count: chain.length,
    last_event_hash: chain.length ? chain[chain.length - 1].event_hash : null,
    checkpointed_at: at,
  });
}

export function verifyChainAgainstCheckpoint(chain, checkpoint) {
  const base = verifyChain(chain);
  if (!base.valid) return { ...base, checkpointVerified: false };
  if (!checkpoint) {
    return { ...base, checkpointVerified: false,
      reason: "no checkpoint supplied — the chain is internally consistent but tail truncation is undetectable" };
  }
  if (chain.length < checkpoint.count) {
    return { valid: false, checkpointVerified: false, brokenAt: chain.length,
      reason: `chain holds ${chain.length} events but a checkpoint recorded ${checkpoint.count} — ${checkpoint.count - chain.length} event(s) were removed from the tail` };
  }
  const atCheckpoint = chain[checkpoint.count - 1];
  if (checkpoint.count > 0 && (!atCheckpoint || atCheckpoint.event_hash !== checkpoint.last_event_hash)) {
    return { valid: false, checkpointVerified: false, brokenAt: checkpoint.count - 1,
      reason: "the event at the checkpointed position does not carry the checkpointed hash — history before the checkpoint was rewritten" };
  }
  return { valid: true, checkpointVerified: true, length: chain.length, sinceCheckpoint: chain.length - checkpoint.count };
}

/**
 * The redactable sidecar. Holds what safe_metadata may not, and can be nulled in place for erasure
 * without touching the chained row.
 */
export function buildDetail({ id, auditEventId, beforeSnapshot = null, afterSnapshot = null, createdAt }) {
  return { audit_event_detail_id: id, audit_event_id: auditEventId, before_snapshot: beforeSnapshot, after_snapshot: afterSnapshot, redacted_at: null, created_at: createdAt };
}

export function redactDetail(detail, { at }) {
  return { ...detail, before_snapshot: null, after_snapshot: null, redacted_at: at };
}

/** Actions the platform must audit, and what each one's aggregate is. */
export const AUDITED_ACTIONS = [
  { action: "entry_created", aggregateType: "pool_entry", why: "an entry is a claim on a prize pool" },
  { action: "entry_updated", aggregateType: "pool_entry", why: "picks and labels change what is scored" },
  { action: "entry_withdrawn", aggregateType: "pool_entry", why: "removes an entry from the prize split" },
  { action: "prediction_submitted", aggregateType: "prediction", why: "directly determines score" },
  { action: "payment_recorded", aggregateType: "payment", why: "money in" },
  { action: "payment_allocated", aggregateType: "payment_allocation", why: "which entry the money settled" },
  { action: "payment_reversed", aggregateType: "payment", why: "money out" },
  { action: "prize_declared", aggregateType: "prize_allocation", why: "money owed" },
  { action: "prize_paid", aggregateType: "prize_allocation", why: "money out" },
  { action: "identity_merged", aggregateType: "participant", why: "moves money attribution between people" },
  { action: "identity_merge_reversed", aggregateType: "participant", why: "moves it back" },
  { action: "result_recorded", aggregateType: "match_result", why: "changes every score in the pool" },
  { action: "result_corrected", aggregateType: "match_result", why: "changes scores after they were published" },
  { action: "ranking_published", aggregateType: "ranking_snapshot", why: "the standing participants act on" },
  { action: "classification_imported", aggregateType: "classification_snapshot",
    why: "the league table decides br2026's G4/Z4/SA6 zone boundaries, and those boundaries decide points. An import that moved a boundary must be attributable." },
  { action: "classification_corrected", aggregateType: "classification_snapshot",
    why: "a corrected table changes scores that were already published. Recorded as its own action so a correction is distinguishable from a routine sync import in the trail." },
  { action: "admin_correction", aggregateType: "any", why: "the highest-privilege action available" },
  { action: "freeze_toggled", aggregateType: "pool", why: "denies or restores the ability to enter" },
];

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  console.log("\nAudit event model\n");
  console.log(`  actor roles: ${ACTOR_ROLES.join(", ")}`);
  console.log(`  sources:     ${SOURCES.join(", ")}`);
  console.log(`  forbidden metadata keys: ${FORBIDDEN_KEYS.size}`);
  console.log(`  value patterns: ${VALUE_PATTERNS.map((p) => p.id).join(", ")}`);
  console.log(`\n  audited actions (${AUDITED_ACTIONS.length}):`);
  for (const a of AUDITED_ACTIONS) console.log(`    ${a.action.padEnd(26)} ${a.aggregateType.padEnd(20)} ${a.why}`);
  console.log("");
  for (const [t, r] of Object.entries(RETENTION)) console.log(`  ${t}: ${r.policy} — ${r.why}`);
  console.log("");
}
