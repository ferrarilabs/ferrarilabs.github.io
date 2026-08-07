/**
 * notification_repository.mjs — the shared NotificationRepository contract, plus the
 * MemoryNotificationRepository and FileNotificationRepository adapters (football-hardening
 * NOT READY -> readiness follow-up, item 2/5).
 *
 * WHY THIS EXISTS: the previous pass's outbox (notification_outbox.mjs/.py) hard-coded
 * file-backed JSON as the only storage. Eduardo's architecture decision (item 1 of this
 * follow-up): PRODUCTION persistence is Supabase, matching this repo's existing production
 * pattern (Copa/CDB/BR2026 all already use Supabase for their real scoring state) —
 * file-backed storage is UNIT TESTS AND LOCAL DEV ONLY, never production. Copa/BR/CDB must
 * never know which backend they're talking to; they call this interface only.
 *
 * ============================================================================================
 * CANONICAL SCHEMA (item 5) — the ONE field-name set going forward, Node and Python both:
 *   schemaVersion, jobId, poolId, eventId, entityId, eventVersion, recipient, templateId,
 *   templateVersion, payloadSnapshot, idempotencyKey, status, attemptCount, nextAttemptAt,
 *   lastAttemptAt, sentAt, providerMessageId, lastError
 *
 * status enum: pending | processing | sent | failed_retryable | failed_permanent | suppressed
 *              | cancelled
 *
 * The PREVIOUS field names (app, matchId, resultVersion, processingStartedAt, maxAttempts) are
 * accepted temporarily via toCanonical()/fromCanonical() compatibility functions below — three
 * production call sites (send_result_email.py x2, send_round_email.py) still use the old names
 * and were not force-migrated in the same patch as this contract (see
 * docs/bolao/FOOTBALL_HARDENING_PERSISTENCE_ARCHITECTURE.md). Do not add a THIRD field-name
 * variant anywhere — extend the canonical set or extend the compatibility adapter, never both a
 * new ad-hoc name and the canonical one for the same concept.
 * ============================================================================================
 *
 * INTERFACE (every adapter below implements all nine methods, same signatures):
 *   createEvent(event)                          -> { event, created }
 *   enqueueJobs(eventId, jobs)                  -> { jobs, createdCount }
 *   claimPendingJobs(poolId, limit, claimedBy)  -> job[]  (atomically transitions pending->processing)
 *   markSent(jobId, { providerMessageId })      -> job
 *   markRetryableFailure(jobId, { error })      -> job
 *   markPermanentFailure(jobId, { error })      -> job
 *   releaseStuckJobs(thresholdMs)               -> recoveredCount
 *   findMissingNotifications(poolId)            -> event[]  (events with zero jobs)
 *   findUnprocessedFinalResults(poolId)         -> entityId[]
 */

export const SCHEMA_VERSION = 2; // v1 was the pre-repository app/matchId/resultVersion shape

export const JOB_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED_RETRYABLE: "failed_retryable",
  FAILED_PERMANENT: "failed_permanent",
  SUPPRESSED: "suppressed",
  CANCELLED: "cancelled",
});

/** Old (v1) job shape -> canonical (v2). Pure, no I/O — safe to unit test directly. */
export function toCanonical(old) {
  if (old.schemaVersion === SCHEMA_VERSION) return old; // already canonical
  return {
    schemaVersion: SCHEMA_VERSION,
    jobId: old.jobId,
    poolId: old.app,
    eventId: old.eventId ?? `${old.app}:${old.matchId}:v${old.resultVersion}`,
    entityId: old.matchId,
    eventVersion: old.resultVersion,
    recipient: old.recipient,
    templateId: old.templateId ?? "default",
    templateVersion: old.templateVersion ?? 1,
    payloadSnapshot: old.payloadSnapshot,
    idempotencyKey: old.idempotencyKey,
    status: old.status === "failed" ? JOB_STATUS.FAILED_RETRYABLE : old.status,
    attemptCount: old.attemptCount ?? 0,
    nextAttemptAt: old.nextAttemptAt ?? null,
    lastAttemptAt: old.lastAttemptAt ?? null,
    sentAt: old.sentAt ?? null,
    providerMessageId: old.providerMessageId ?? null,
    lastError: old.lastError ?? null,
    createdAt: old.createdAt,
  };
}

/** Canonical (v2) -> old (v1) shape, for the three not-yet-migrated production call sites. */
export function fromCanonical(job) {
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    app: job.poolId,
    matchId: job.entityId,
    resultVersion: job.eventVersion,
    recipient: job.recipient,
    payloadSnapshot: job.payloadSnapshot,
    idempotencyKey: job.idempotencyKey,
    status: job.status === JOB_STATUS.FAILED_RETRYABLE || job.status === JOB_STATUS.FAILED_PERMANENT ? "failed" : job.status,
    attemptCount: job.attemptCount,
    maxAttempts: 5,
    processingStartedAt: job.status === JOB_STATUS.PROCESSING ? job.claimedAt ?? job.lastAttemptAt : null,
    lastAttemptAt: job.lastAttemptAt,
    sentAt: job.sentAt,
    providerMessageId: job.providerMessageId,
    lastError: job.lastError,
    createdAt: job.createdAt,
  };
}

export function buildIdempotencyKey(poolId, entityId, recipient, eventVersion) {
  return `${poolId}:${entityId}:${recipient}:v${eventVersion}`;
}

// ── MemoryNotificationRepository — fastest adapter, unit tests only, no I/O at all ───────────
export class MemoryNotificationRepository {
  constructor(clock) {
    this.clock = clock;
    this.events = new Map(); // eventId -> event
    this.jobs = new Map(); // jobId -> job
    this._jobSeq = 0;
  }

  async createEvent(event) {
    const key = `${event.poolId}|${event.entityId}|${event.eventType}|${event.eventVersion}`;
    const existing = [...this.events.values()].find(
      (e) => `${e.poolId}|${e.entityId}|${e.eventType}|${e.eventVersion}` === key
    );
    if (existing) return { event: existing, created: false };
    const record = { eventId: event.eventId ?? `evt_${this.clock.nowMs()}_${this._jobSeq++}`, ...event, createdAt: this.clock.nowIso(), processedAt: null };
    this.events.set(record.eventId, record);
    return { event: record, created: true };
  }

  async enqueueJobs(eventId, jobDrafts) {
    const created = [];
    let newCount = 0;
    const parentEvent = this.events.get(eventId);
    for (const draft of jobDrafts) {
      const existing = [...this.jobs.values()].find((j) => j.idempotencyKey === draft.idempotencyKey);
      if (existing) { created.push(existing); continue; }
      const job = {
        schemaVersion: SCHEMA_VERSION,
        jobId: `job_${this.clock.nowMs()}_${this._jobSeq++}`,
        eventId,
        entityId: draft.entityId ?? parentEvent?.entityId,
        eventVersion: draft.eventVersion ?? parentEvent?.eventVersion,
        poolId: draft.poolId,
        recipient: draft.recipient,
        templateId: draft.templateId ?? "default",
        templateVersion: draft.templateVersion ?? 1,
        payloadSnapshot: draft.payloadSnapshot,
        idempotencyKey: draft.idempotencyKey,
        status: JOB_STATUS.PENDING,
        attemptCount: 0,
        nextAttemptAt: this.clock.nowIso(),
        claimedAt: null,
        claimedBy: null,
        lastAttemptAt: null,
        sentAt: null,
        providerMessageId: null,
        lastError: null,
        createdAt: this.clock.nowIso(),
      };
      this.jobs.set(job.jobId, job);
      created.push(job);
      newCount++;
    }
    return { jobs: created, createdCount: newCount };
  }

  async claimPendingJobs(poolId, limit = 50, claimedBy = "worker") {
    const eligible = [...this.jobs.values()].filter((j) => j.poolId === poolId && j.status === JOB_STATUS.PENDING).slice(0, limit);
    for (const j of eligible) { j.status = JOB_STATUS.PROCESSING; j.claimedAt = this.clock.nowIso(); j.claimedBy = claimedBy; }
    return eligible;
  }

  async markSent(jobId, { providerMessageId = null } = {}) {
    const j = this._require(jobId);
    j.status = JOB_STATUS.SENT; j.sentAt = this.clock.nowIso(); j.lastAttemptAt = j.sentAt;
    j.attemptCount += 1; j.providerMessageId = providerMessageId; j.claimedAt = null; j.claimedBy = null;
    return j;
  }

  async markRetryableFailure(jobId, { error } = {}) {
    const j = this._require(jobId);
    j.status = JOB_STATUS.FAILED_RETRYABLE; j.lastAttemptAt = this.clock.nowIso();
    j.attemptCount += 1; j.lastError = error ?? "unknown error"; j.claimedAt = null; j.claimedBy = null;
    j.nextAttemptAt = this.clock.nowIso();
    return j;
  }

  async markPermanentFailure(jobId, { error } = {}) {
    const j = this._require(jobId);
    j.status = JOB_STATUS.FAILED_PERMANENT; j.lastAttemptAt = this.clock.nowIso();
    j.attemptCount += 1; j.lastError = error ?? "unknown error"; j.claimedAt = null; j.claimedBy = null;
    return j;
  }

  async releaseStuckJobs(thresholdMs) {
    let n = 0;
    const now = this.clock.nowMs();
    for (const j of this.jobs.values()) {
      if (j.status !== JOB_STATUS.PROCESSING || !j.claimedAt) continue;
      if (now - new Date(j.claimedAt).getTime() >= thresholdMs) {
        j.status = JOB_STATUS.PENDING; j.claimedAt = null; j.claimedBy = null;
        j.lastError = `released from stuck processing after ${now - new Date(j.claimedAt || now).getTime()}ms`;
        n++;
      }
    }
    return n;
  }

  async findMissingNotifications(poolId) {
    return [...this.events.values()].filter((e) => e.poolId === poolId && ![...this.jobs.values()].some((j) => j.eventId === e.eventId));
  }

  async findUnprocessedFinalResults(_poolId) {
    return []; // memory adapter has no match-state concept of its own — caller supplies events directly
  }

  _require(jobId) {
    const j = this.jobs.get(jobId);
    if (!j) throw new Error(`unknown jobId: ${jobId}`);
    return j;
  }
}

// ── FileNotificationRepository — local dev / integration tests ONLY, never production ────────
// Wraps the same file-backed JSON pattern as notification_outbox.mjs (kept for backward
// compatibility with the three not-yet-migrated production call sites), exposed through the
// canonical NotificationRepository interface.
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export class FileNotificationRepository {
  constructor(clock, { eventsPath, jobsPath } = {}) {
    this.clock = clock;
    this.eventsPath = eventsPath || join(HERE, "notification_events.json");
    this.jobsPath = jobsPath || join(HERE, "notification_jobs.json");
  }

  _readAll(path) {
    if (!existsSync(path)) return [];
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return []; }
  }
  _writeAll(path, records) {
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n");
    renameSync(tmp, path);
  }

  async createEvent(event) {
    const events = this._readAll(this.eventsPath);
    const existing = events.find((e) => e.poolId === event.poolId && e.entityId === event.entityId && e.eventType === event.eventType && e.eventVersion === event.eventVersion);
    if (existing) return { event: existing, created: false };
    const record = { eventId: event.eventId ?? `evt_${this.clock.nowMs()}_${Math.random().toString(36).slice(2, 8)}`, ...event, createdAt: this.clock.nowIso(), processedAt: null };
    events.push(record);
    this._writeAll(this.eventsPath, events);
    return { event: record, created: true };
  }

  async enqueueJobs(eventId, jobDrafts) {
    const jobs = this._readAll(this.jobsPath);
    const events = this._readAll(this.eventsPath);
    const parentEvent = events.find((e) => e.eventId === eventId);
    const created = [];
    let newCount = 0;
    for (const draft of jobDrafts) {
      const existing = jobs.find((j) => j.idempotencyKey === draft.idempotencyKey);
      if (existing) { created.push(existing); continue; }
      const job = {
        schemaVersion: SCHEMA_VERSION,
        jobId: `job_${this.clock.nowMs()}_${Math.random().toString(36).slice(2, 8)}`,
        eventId,
        entityId: draft.entityId ?? parentEvent?.entityId,
        eventVersion: draft.eventVersion ?? parentEvent?.eventVersion,
        poolId: draft.poolId,
        recipient: draft.recipient,
        templateId: draft.templateId ?? "default",
        templateVersion: draft.templateVersion ?? 1,
        payloadSnapshot: draft.payloadSnapshot,
        idempotencyKey: draft.idempotencyKey,
        status: JOB_STATUS.PENDING,
        attemptCount: 0,
        nextAttemptAt: this.clock.nowIso(),
        claimedAt: null,
        claimedBy: null,
        lastAttemptAt: null,
        sentAt: null,
        providerMessageId: null,
        lastError: null,
        createdAt: this.clock.nowIso(),
      };
      jobs.push(job);
      created.push(job);
      newCount++;
    }
    this._writeAll(this.jobsPath, jobs);
    return { jobs: created, createdCount: newCount };
  }

  async claimPendingJobs(poolId, limit = 50, claimedBy = "worker") {
    // File backend cannot offer a real cross-process atomic lock (see the explicit "NOT FOR
    // PRODUCTION" warning at the top of this file / the architecture doc) — this is a
    // single-process best-effort claim for local dev/tests only.
    const jobs = this._readAll(this.jobsPath);
    const eligible = jobs.filter((j) => j.poolId === poolId && j.status === JOB_STATUS.PENDING).slice(0, limit);
    for (const j of eligible) { j.status = JOB_STATUS.PROCESSING; j.claimedAt = this.clock.nowIso(); j.claimedBy = claimedBy; }
    this._writeAll(this.jobsPath, jobs);
    return eligible;
  }

  async markSent(jobId, { providerMessageId = null } = {}) {
    return this._update(jobId, (j) => {
      j.status = JOB_STATUS.SENT; j.sentAt = this.clock.nowIso(); j.lastAttemptAt = j.sentAt;
      j.attemptCount += 1; j.providerMessageId = providerMessageId; j.claimedAt = null; j.claimedBy = null;
    });
  }
  async markRetryableFailure(jobId, { error } = {}) {
    return this._update(jobId, (j) => {
      j.status = JOB_STATUS.FAILED_RETRYABLE; j.lastAttemptAt = this.clock.nowIso();
      j.attemptCount += 1; j.lastError = error ?? "unknown error"; j.claimedAt = null; j.claimedBy = null;
      j.nextAttemptAt = this.clock.nowIso();
    });
  }
  async markPermanentFailure(jobId, { error } = {}) {
    return this._update(jobId, (j) => {
      j.status = JOB_STATUS.FAILED_PERMANENT; j.lastAttemptAt = this.clock.nowIso();
      j.attemptCount += 1; j.lastError = error ?? "unknown error"; j.claimedAt = null; j.claimedBy = null;
    });
  }
  async releaseStuckJobs(thresholdMs) {
    const jobs = this._readAll(this.jobsPath);
    const now = this.clock.nowMs();
    let n = 0;
    for (const j of jobs) {
      if (j.status !== JOB_STATUS.PROCESSING || !j.claimedAt) continue;
      if (now - new Date(j.claimedAt).getTime() >= thresholdMs) {
        j.status = JOB_STATUS.PENDING; j.claimedAt = null; j.claimedBy = null; n++;
      }
    }
    if (n) this._writeAll(this.jobsPath, jobs);
    return n;
  }
  async findMissingNotifications(poolId) {
    const events = this._readAll(this.eventsPath);
    const jobs = this._readAll(this.jobsPath);
    return events.filter((e) => e.poolId === poolId && !jobs.some((j) => j.eventId === e.eventId));
  }
  async findUnprocessedFinalResults(_poolId) { return []; }

  _update(jobId, mutator) {
    const jobs = this._readAll(this.jobsPath);
    const idx = jobs.findIndex((j) => j.jobId === jobId);
    if (idx === -1) throw new Error(`unknown jobId: ${jobId}`);
    mutator(jobs[idx]);
    this._writeAll(this.jobsPath, jobs);
    return jobs[idx];
  }
}
