// outbox.mjs — persisted (file-backed, not localStorage-only) idempotent job store.
// One JSON file per environment: scripts/email/outbox.json (git-ignored in practice
// for real sends; committed here only with the 3 synthetic test-mode records as
// evidence — see email-test-results.txt).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function outboxPath(file) {
  return file || path.join(__dirname, "outbox.json");
}

function readAll(file) {
  const p = outboxPath(file);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}
function writeAll(jobs, file) {
  fs.writeFileSync(outboxPath(file), JSON.stringify(jobs, null, 2) + "\n");
}

export function idempotencyKeyForParticipant(poolId, participantId, templateVersion) {
  return `powerball:${poolId}:participant-added:${participantId}:v${templateVersion}`;
}
export function idempotencyKeyForPublication(poolId, drawId, publicationVersion, templateVersion) {
  return `powerball:${poolId}:${drawId}:tickets-published:v${publicationVersion}.${templateVersion}`;
}

/**
 * Enqueues a job unless one already exists with the same idempotencyKey.
 * Returns { job, created: boolean }.
 */
export function enqueueEmailJob(job, file) {
  const jobs = readAll(file);
  const existing = jobs.find((j) => j.idempotencyKey === job.idempotencyKey);
  if (existing) return { job: existing, created: false };
  const record = {
    emailJobId: `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    poolId: job.poolId,
    drawId: job.drawId,
    participantId: job.participantId,
    eventType: job.eventType,
    recipient: job.recipient,
    templateId: job.templateId,
    templateVersion: job.templateVersion,
    payloadSnapshot: job.payloadSnapshot,
    idempotencyKey: job.idempotencyKey,
    status: "pending",
    attemptCount: 0,
    lastAttemptAt: null,
    sentAt: null,
    providerStatus: null,
    providerMessageId: null,
    lastError: null,
    testMode: !!job.testMode,
    createdAt: new Date().toISOString(),
  };
  jobs.push(record);
  writeAll(jobs, file);
  return { job: record, created: true };
}

export function recordEmailResult(emailJobId, result, file) {
  const jobs = readAll(file);
  const idx = jobs.findIndex((j) => j.emailJobId === emailJobId);
  if (idx === -1) throw new Error("Unknown emailJobId: " + emailJobId);
  const j = jobs[idx];
  j.attemptCount += 1;
  j.lastAttemptAt = new Date().toISOString();
  j.status = result.ok ? "sent" : "failed";
  j.providerStatus = result.providerStatus ?? null;
  j.providerMessageId = result.providerMessageId ?? null;
  j.lastError = result.ok ? null : (result.error || "unknown error");
  if (result.ok) j.sentAt = j.lastAttemptAt;
  jobs[idx] = j;
  writeAll(jobs, file);
  return j;
}

export function getJob(emailJobId, file) {
  return readAll(file).find((j) => j.emailJobId === emailJobId) || null;
}
export function findByIdempotencyKey(key, file) {
  return readAll(file).find((j) => j.idempotencyKey === key) || null;
}
export function listJobs(file) {
  return readAll(file);
}
