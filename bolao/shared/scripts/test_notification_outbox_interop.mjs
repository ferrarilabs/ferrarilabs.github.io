#!/usr/bin/env node
// test_notification_outbox_interop.mjs — proves notification_outbox.py (Python, used by
// Copa2026/CDB2026's send_result_email.py) and notification_outbox.mjs (JS, used by the
// checkpoint D reconciler) share ONE real outbox file and enforce the SAME idempotency
// guarantee across languages (football-hardening checkpoint F).
//
// Run: node bolao/shared/scripts/test_notification_outbox_interop.mjs
//
// No real emails, no real network, no Supabase — spawns `python3` as a subprocess against a
// synthetic temp outbox file and inspects the resulting JSON directly.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import * as jsOutbox from "./notification_outbox.mjs";
import { makeFakeClock } from "./fake_clock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

function tmpOutboxPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bolao-outbox-interop-"));
  return path.join(dir, "notification_outbox.json");
}

function pyEnqueue(outboxPath, job) {
  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(HERE)})
import json
import notification_outbox as ob
job = json.loads(sys.argv[2])
record, created = ob.enqueue(job, path=sys.argv[1])
print(json.dumps({"record": record, "created": created}))
`;
  const out = execFileSync("python3", ["-c", script, outboxPath, JSON.stringify(job)], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

function pyRecordResult(outboxPath, jobId, ok) {
  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(HERE)})
import json
import notification_outbox as ob
j = ob.record_result(sys.argv[1], sys.argv[2] == "true", path=sys.argv[3])
print(json.dumps(j))
`;
  const out = execFileSync("python3", ["-c", script, jobId, ok ? "true" : "false", outboxPath], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

// ── 1. Idempotency key format is byte-identical across languages ────────────
{
  const jsKey = jsOutbox.idempotencyKey("cdb2026", "tie-final", "alfa@example.test", 2);
  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(HERE)})
import notification_outbox as ob
print(ob.idempotency_key("cdb2026", "tie-final", "alfa@example.test", 2))
`;
  const pyKey = execFileSync("python3", ["-c", script], { encoding: "utf8" }).trim();
  check("idempotency_key() format is byte-identical between JS and Python", jsKey === pyKey, { jsKey, pyKey });
}

// ── 2. Python enqueues first — JS sees it, and a duplicate JS enqueue is rejected ──
{
  const outboxPath = tmpOutboxPath();
  const clock = makeFakeClock();
  const key = jsOutbox.idempotencyKey("cdb2026", "cross-lang-tie-1", "alfa@example.test", 1);
  const job = {
    app: "cdb2026", matchId: "cross-lang-tie-1", recipient: "alfa@example.test", resultVersion: 1,
    payloadSnapshot: { homeScore: 1, awayScore: 1, penaltiesHome: 5, penaltiesAway: 4 },
    idempotencyKey: key,
  };
  const pyResult = pyEnqueue(outboxPath, job);
  check("Python enqueue() creates a job on first call", pyResult.created === true, pyResult);

  // JS reads the SAME file and sees the Python-created job.
  const seenByJs = jsOutbox.findByIdempotencyKey(key, outboxPath);
  check("JS reads the job Python wrote (same file, same schema)", seenByJs !== null && seenByJs.jobId === pyResult.record.jobId, { seenByJs, pyJobId: pyResult.record.jobId });

  // JS attempts to enqueue the SAME idempotency key — must be rejected as a duplicate.
  const jsAttempt = jsOutbox.enqueue(job, clock, outboxPath);
  check("JS enqueue() of the SAME key returns created:false (no duplicate written)", jsAttempt.created === false && jsAttempt.job.jobId === pyResult.record.jobId, jsAttempt);

  const allJobs = jsOutbox.readAll(outboxPath);
  check("exactly ONE job exists on disk after both languages tried to enqueue the same event", allJobs.length === 1, allJobs.length);
}

// ── 3. JS enqueues — Python sees it, and a duplicate Python enqueue is rejected ──
{
  const outboxPath = tmpOutboxPath();
  const clock = makeFakeClock();
  const key = jsOutbox.idempotencyKey("copa2026", "cross-lang-tie-2", "beta@example.test", 1);
  const job = {
    app: "copa2026", matchId: "cross-lang-tie-2", recipient: "beta@example.test", resultVersion: 1,
    payloadSnapshot: { homeScore: 2, awayScore: 0 },
    idempotencyKey: key,
  };
  const jsResult = jsOutbox.enqueue(job, clock, outboxPath);
  check("JS enqueue() creates a job on first call", jsResult.created === true, jsResult);

  const pyAttempt = pyEnqueue(outboxPath, job);
  check("Python enqueue() of the SAME key returns created:false (no duplicate written)", pyAttempt.created === false && pyAttempt.record.jobId === jsResult.job.jobId, pyAttempt);

  const allJobs = jsOutbox.readAll(outboxPath);
  check("exactly ONE job exists on disk after both languages tried to enqueue the same event (JS-first direction)", allJobs.length === 1, allJobs.length);
}

// ── 4. Python records a result — JS reads the SAME final status ─────────────
{
  const outboxPath = tmpOutboxPath();
  const key = jsOutbox.idempotencyKey("cdb2026", "cross-lang-tie-3", "alfa@example.test", 1);
  const job = { app: "cdb2026", matchId: "cross-lang-tie-3", recipient: "alfa@example.test", resultVersion: 1, payloadSnapshot: { x: 1 }, idempotencyKey: key };
  const { record } = pyEnqueue(outboxPath, job);
  const afterSend = pyRecordResult(outboxPath, record.jobId, true);
  check("Python record_result(ok=true) sets status 'sent'", afterSend.status === "sent", afterSend);

  const jsView = jsOutbox.findByIdempotencyKey(key, outboxPath);
  check("JS reads the same 'sent' status Python recorded (single shared source of truth)", jsView.status === "sent" && jsView.sentAt === afterSend.sentAt, jsView);
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL CROSS-LANGUAGE OUTBOX INTEROP CHECKS PASSED");
process.exit(0);
