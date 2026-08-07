#!/usr/bin/env node
// test_notification_repository_interop.mjs — cross-language schema agreement (football-hardening
// readiness follow-up, item 5). Validates real Node-produced and real Python-produced job
// records against the SAME bolao/shared/schemas/notification_job.schema.json file — no ajv/
// jsonschema package available in this environment (confirmed, not assumed), so this uses a
// small dependency-free interpreter of the schema's required/type/enum/const rules, driven by
// the real schema file rather than a second hand-written copy of its rules.
//
// Run: node bolao/shared/scripts/test_notification_repository_interop.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MemoryNotificationRepository, buildIdempotencyKey } from "./notification_repository.mjs";
import { makeFakeClock } from "./fake_clock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "schemas", "notification_job.schema.json"), "utf8"));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

function validateAgainstSchema(record, schema) {
  const errors = [];
  for (const key of schema.required || []) {
    if (!(key in record)) errors.push(`missing required field: ${key}`);
  }
  for (const [key, def] of Object.entries(schema.properties || {})) {
    if (!(key in record)) continue;
    const value = record[key];
    const types = Array.isArray(def.type) ? def.type : [def.type];
    const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const jsType = actualType === "number" && Number.isInteger(value) ? "integer" : actualType;
    if (!types.includes(actualType) && !(types.includes("integer") && jsType === "integer")) {
      errors.push(`${key}: expected type ${types.join("|")}, got ${actualType}`);
    }
    if (def.enum && value !== null && !def.enum.includes(value)) errors.push(`${key}: "${value}" not in enum ${JSON.stringify(def.enum)}`);
    if (def.const !== undefined && value !== def.const) errors.push(`${key}: expected const ${def.const}, got ${value}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in (schema.properties || {}))) errors.push(`unexpected additional property: ${key}`);
    }
  }
  return errors;
}

// ── 1. A real Node-produced job record validates against the schema ─────────────────────────
{
  const clock = makeFakeClock();
  const repo = new MemoryNotificationRepository(clock);
  const { event } = await repo.createEvent({ poolId: "cdb2026", entityType: "tie", entityId: "oitavas:tie-1", eventType: "final_confirmed", eventVersion: 1, payloadSnapshot: { homeScore: 1, awayScore: 1 } });
  const { jobs } = await repo.enqueueJobs(event.eventId, [
    { poolId: "cdb2026", recipient: "alfa@example.test", payloadSnapshot: { x: 1 }, idempotencyKey: buildIdempotencyKey("cdb2026", "oitavas:tie-1", "alfa@example.test", 1) },
  ]);
  const errors = validateAgainstSchema(jobs[0], SCHEMA);
  check("Node MemoryNotificationRepository job record validates against the shared JSON Schema", errors.length === 0, errors);
}

// ── 2. A real Python-produced job record validates against the SAME schema ──────────────────
{
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(HERE)})
from notification_repository import MemoryNotificationRepository, build_idempotency_key

repo = MemoryNotificationRepository()
event, created = repo.create_event({"poolId": "cdb2026", "entityType": "tie", "entityId": "oitavas:tie-1", "eventType": "final_confirmed", "eventVersion": 1, "payloadSnapshot": {"homeScore": 1, "awayScore": 1}})
jobs, new_count = repo.enqueue_jobs(event["eventId"], [
    {"poolId": "cdb2026", "recipient": "alfa@example.test", "payloadSnapshot": {"x": 1}, "idempotencyKey": build_idempotency_key("cdb2026", "oitavas:tie-1", "alfa@example.test", 1)},
])
print(json.dumps(jobs[0]))
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8" });
  const pyJob = JSON.parse(out.trim());
  const errors = validateAgainstSchema(pyJob, SCHEMA);
  check("Python MemoryNotificationRepository job record validates against the SAME shared JSON Schema", errors.length === 0, { errors, pyJob });
}

// ── 3. A record with a DELIBERATELY wrong status is REJECTED by the schema (proves the
// validator actually checks something, not a rubber stamp) ─────────────────────────────────
{
  const bad = { schemaVersion: 2, jobId: "j1", poolId: "cdb2026", eventId: "e1", entityId: "en1", eventVersion: 1, recipient: "a@x.test", templateId: "default", templateVersion: 1, payloadSnapshot: {}, idempotencyKey: "k1", status: "not-a-real-status", attemptCount: 0, nextAttemptAt: null, lastAttemptAt: null, sentAt: null, providerMessageId: null, lastError: null };
  const errors = validateAgainstSchema(bad, SCHEMA);
  check("schema validator REJECTS an invalid status value (not a rubber stamp)", errors.length > 0 && errors.some((e) => e.includes("status")), errors);
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL CROSS-LANGUAGE SCHEMA AGREEMENT CHECKS PASSED");
process.exit(0);
