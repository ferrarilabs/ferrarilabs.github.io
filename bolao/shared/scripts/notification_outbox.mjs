// notification_outbox.mjs — persisted (file-backed, NOT localStorage/in-memory-only) idempotent
// job store for match-result notification emails (football-hardening checkpoint D).
//
// Reuses the proven pattern from bolao/loterias/powerball/scripts/email/outbox.mjs (commit
// a3589c3, "feat(powerball): add email snapshots and idempotent outbox"): one JSON file per
// environment, one job per recipient, idempotency key lookup before insert, a frozen
// payloadSnapshot that retries replay verbatim rather than recompute. Extended here with:
//   - an explicit "processing" lock state (so two concurrent reconciler runs can't both pick up
//     the same pending job) with a processingStartedAt timestamp the reconciler uses to detect
//     and recover stuck jobs;
//   - a `resultVersion` folded into the idempotency key, so a correction to an already-notified
//     result creates NEW jobs (new version) rather than mutating/resending the old ones in place.
//
// Every timestamp comes from an injected `clock` (see fake_clock.mjs) — never Date.now() — so
// callers can run fully deterministic tests with no real sleep/wall-clock dependency.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultOutboxPath() {
  return path.join(__dirname, "notification_outbox.json");
}

export function readAll(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; }
}

function writeAll(jobs, file) {
  // Atomic-ish write: temp file + rename, same discipline as espn_provider.py's
  // write_snapshot_atomic() — a crash mid-write must never leave a corrupt/partial outbox file
  // that a concurrent reconciler run would read as truth.
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function idempotencyKey(app, matchId, recipient, resultVersion) {
  return `${app}:${matchId}:${recipient}:v${resultVersion}`;
}

/** Enqueues one job per recipient, unless a job with the SAME idempotencyKey already exists —
 * that is the whole duplicate-prevention contract. Returns { job, created }. A duplicated
 * workflow run (same matchId/recipient/resultVersion) calling this twice returns the SAME job
 * the second time, created:false, and writes nothing new to disk. */
export function enqueue(job, clock, file = defaultOutboxPath()) {
  const jobs = readAll(file);
  const existing = jobs.find((j) => j.idempotencyKey === job.idempotencyKey);
  if (existing) return { job: existing, created: false };
  const record = {
    jobId: `job_${clock.nowMs()}_${Math.random().toString(36).slice(2, 10)}`,
    app: job.app,
    matchId: job.matchId,
    recipient: job.recipient,
    resultVersion: job.resultVersion,
    payloadSnapshot: job.payloadSnapshot, // frozen at enqueue time — retries NEVER recompute this
    idempotencyKey: job.idempotencyKey,
    status: "pending", // pending -> processing -> sent | failed (failed is retryable up to maxAttempts)
    attemptCount: 0,
    maxAttempts: job.maxAttempts ?? 5,
    processingStartedAt: null,
    lastAttemptAt: null,
    sentAt: null,
    lastError: null,
    createdAt: clock.nowIso(),
  };
  jobs.push(record);
  writeAll(jobs, file);
  return { job: record, created: true };
}

/** Atomically claims a pending (or previously-failed-and-retryable) job for processing. Returns
 * null if the job doesn't exist, is already terminal (sent), or is already being processed by
 * someone else — this is what makes two concurrent executions safe: only one of them can
 * successfully flip a given job from pending to processing. */
export function claimForProcessing(jobId, clock, file = defaultOutboxPath()) {
  const jobs = readAll(file);
  const idx = jobs.findIndex((j) => j.jobId === jobId);
  if (idx === -1) return null;
  const j = jobs[idx];
  if (j.status === "sent") return null; // already done — never re-send
  if (j.status === "processing") return null; // someone else already has the lock
  if (j.status === "failed" && j.attemptCount >= j.maxAttempts) return null; // exhausted
  j.status = "processing";
  j.processingStartedAt = clock.nowIso();
  jobs[idx] = j;
  writeAll(jobs, file);
  return j;
}

export function recordResult(jobId, result, clock, file = defaultOutboxPath()) {
  const jobs = readAll(file);
  const idx = jobs.findIndex((j) => j.jobId === jobId);
  if (idx === -1) throw new Error(`unknown jobId: ${jobId}`);
  const j = jobs[idx];
  j.attemptCount += 1;
  j.lastAttemptAt = clock.nowIso();
  j.processingStartedAt = null;
  j.status = result.ok ? "sent" : "failed";
  j.lastError = result.ok ? null : (result.error || "unknown error");
  if (result.ok) j.sentAt = j.lastAttemptAt;
  jobs[idx] = j;
  writeAll(jobs, file);
  return j;
}

/** Recovers jobs stuck in "processing" for longer than `thresholdMs` (e.g. the worker that
 * claimed them crashed / the process was killed mid-send) back to "pending" so the reconciler
 * can retry them. Never touches a job that's genuinely still within its processing window, and
 * never touches a job that already reached a terminal "sent" state. */
export function recoverStuckJobs(thresholdMs, clock, file = defaultOutboxPath()) {
  const jobs = readAll(file);
  const nowMs = clock.nowMs();
  let recovered = 0;
  for (const j of jobs) {
    if (j.status !== "processing" || !j.processingStartedAt) continue;
    const startedMs = new Date(j.processingStartedAt).getTime();
    if (nowMs - startedMs >= thresholdMs) {
      j.status = "pending";
      j.processingStartedAt = null;
      j.lastError = `recovered from stuck 'processing' state after ${nowMs - startedMs}ms`;
      recovered += 1;
    }
  }
  if (recovered > 0) writeAll(jobs, file);
  return recovered;
}

export function findByIdempotencyKey(key, file = defaultOutboxPath()) {
  return readAll(file).find((j) => j.idempotencyKey === key) || null;
}

export function jobsForMatch(matchId, file = defaultOutboxPath()) {
  return readAll(file).filter((j) => j.matchId === matchId);
}

export function retryableFailed(file = defaultOutboxPath()) {
  return readAll(file).filter((j) => j.status === "failed" && j.attemptCount < j.maxAttempts);
}
