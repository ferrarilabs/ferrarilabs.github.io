#!/usr/bin/env node
/**
 * audit_log.mjs — structured, append-only run logging.
 *
 * One JSON line per event, to stdout (Actions captures it as the run's own log — no separate log
 * store needed for v1). Never logs tokens, PII, or raw sensitive evidence — callers pass already-
 * masked values; this module doesn't scan for leaks itself (that's `pii_detectors.mjs`'s job, not
 * a second implementation here), it just refuses the two field names most likely to carry a
 * secret by convention (`token`, `secret`) as a last-resort guard.
 */
import { randomUUID } from "node:crypto";

const REDACT_KEYS = new Set(["token", "secret", "password", "authorization"]);

function redact(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "<redacted>" : (v && typeof v === "object" ? redact(v) : v);
  }
  return out;
}

export function createRunLogger(runId = randomUUID()) {
  return {
    runId,
    log(event) {
      const line = JSON.stringify({ run_id: runId, at: new Date().toISOString(), ...redact(event) });
      console.log(line);
    },
  };
}
