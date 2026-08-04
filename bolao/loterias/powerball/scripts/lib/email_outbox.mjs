// Powerball email outbox — Part 4/5 of the professionalization audit.
//
// Separates "decide an email should exist" from "actually send it," and makes a job's content
// immutable once created. Fixes the concrete mechanism behind Incident 2 (POWERBALL_INCIDENT_REVIEW.md):
// today's sendResultEmail() re-reads live browser state (localStorage, in-memory DRAWS) at send
// time, so two browsers computing slightly different results can each independently send a
// different email. Here, buildEmailPayload() runs once, producing a frozen payload_snapshot;
// everything downstream (rendering, sending, retrying) reads that snapshot, never live state
// again.
//
// In-memory store only — this is the local, testable reference implementation the audit spec
// asks for ("implemente localmente"). POWERBALL_DATA_MODEL.md's lottery_email_jobs table is the
// same shape for a real Postgres-backed version later; nothing here talks to production Supabase,
// EmailJS, or sends a real email.

export const JOB_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  SENT: "sent",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SUPPRESSED: "suppressed",
});

export function buildIdempotencyKey({ poolId, drawId, eventType, recipient, templateVersion }) {
  return `${poolId}:${drawId}:${eventType}:${recipient}:${templateVersion}`;
}

export class DuplicateEmailJobError extends Error {
  constructor(idempotencyKey) {
    super(`Email job already exists for idempotency key: ${idempotencyKey}`);
    this.name = "DuplicateEmailJobError";
    this.idempotencyKey = idempotencyKey;
  }
}

/**
 * In-memory outbox. Real backend (Supabase table per POWERBALL_DATA_MODEL.md) would implement
 * the same method signatures against Postgres instead of a Map.
 */
export class EmailOutbox {
  constructor() {
    this._jobs = new Map(); // email_job_id -> job
    this._byIdempotencyKey = new Map(); // idempotency_key -> email_job_id
    this._nextId = 1;
  }

  /**
   * Creates a job with an immutable payload_snapshot. Throws DuplicateEmailJobError if the
   * idempotency key already exists — this IS the "não envia duas vezes o mesmo evento" guarantee,
   * enforced at creation time, not left to the sender to remember.
   */
  enqueue({ poolId, drawId, eventType, recipient, templateId, templateVersion, payloadSnapshot }) {
    if (!poolId) throw new Error("enqueue: poolId is required");
    if (!drawId) throw new Error("enqueue: drawId is required");
    if (!eventType) throw new Error("enqueue: eventType is required");
    if (!recipient || !recipient.includes("@")) {
      throw new Error(`enqueue: invalid recipient "${recipient}"`);
    }
    if (!templateId) throw new Error("enqueue: templateId is required");
    if (!templateVersion) throw new Error("enqueue: templateVersion is required");
    if (payloadSnapshot === undefined || payloadSnapshot === null) {
      throw new Error("enqueue: payloadSnapshot is required");
    }

    const idempotencyKey = buildIdempotencyKey({ poolId, drawId, eventType, recipient, templateVersion });
    if (this._byIdempotencyKey.has(idempotencyKey)) {
      throw new DuplicateEmailJobError(idempotencyKey);
    }

    const emailJobId = String(this._nextId++);
    const job = {
      email_job_id: emailJobId,
      pool_id: poolId,
      draw_id: drawId,
      event_type: eventType,
      recipient,
      template_id: templateId,
      template_version: templateVersion,
      // Deep-freeze-by-JSON-roundtrip: guarantees the snapshot can never be mutated in place by
      // a later caller holding a reference to the object they passed in.
      payload_snapshot: JSON.parse(JSON.stringify(payloadSnapshot)),
      idempotency_key: idempotencyKey,
      status: JOB_STATUS.PENDING,
      attempt_count: 0,
      last_attempt_at: null,
      sent_at: null,
      provider_status: null,
      provider_message_id: null,
      last_error: null,
      created_at: new Date().toISOString(),
    };
    this._jobs.set(emailJobId, job);
    this._byIdempotencyKey.set(idempotencyKey, emailJobId);
    return { ...job };
  }

  get(emailJobId) {
    const job = this._jobs.get(emailJobId);
    return job ? { ...job } : null;
  }

  findByIdempotencyKey(idempotencyKey) {
    const id = this._byIdempotencyKey.get(idempotencyKey);
    return id ? this.get(id) : null;
  }

  pending() {
    return [...this._jobs.values()].filter((j) => j.status === JOB_STATUS.PENDING).map((j) => ({ ...j }));
  }

  all() {
    return [...this._jobs.values()].map((j) => ({ ...j }));
  }

  /** Claims a job for processing — worker-side "lock" so two workers can't both pick it up. */
  claim(emailJobId) {
    const job = this._jobs.get(emailJobId);
    if (!job) throw new Error(`claim: no such job ${emailJobId}`);
    if (job.status !== JOB_STATUS.PENDING) {
      throw new Error(`claim: job ${emailJobId} is not pending (status=${job.status})`);
    }
    job.status = JOB_STATUS.PROCESSING;
    job.attempt_count += 1;
    job.last_attempt_at = new Date().toISOString();
    return { ...job };
  }

  recordSuccess(emailJobId, { providerStatus, providerMessageId }) {
    const job = this._jobs.get(emailJobId);
    if (!job) throw new Error(`recordSuccess: no such job ${emailJobId}`);
    job.status = JOB_STATUS.SENT;
    job.sent_at = new Date().toISOString();
    job.provider_status = providerStatus ?? "ok";
    job.provider_message_id = providerMessageId ?? null;
    job.last_error = null;
    return { ...job };
  }

  recordFailure(emailJobId, { error }) {
    const job = this._jobs.get(emailJobId);
    if (!job) throw new Error(`recordFailure: no such job ${emailJobId}`);
    // Failure returns the job to `pending` so a later retry can pick it up — never duplicates the
    // job itself; attempt_count already tracked the try. Content is untouched (still the same
    // frozen payload_snapshot from enqueue time), so retry cannot drift from the original.
    job.status = JOB_STATUS.FAILED;
    job.last_error = String(error && error.message ? error.message : error);
    return { ...job };
  }

  /**
   * Re-queues a failed job for another attempt. Returns null if the job isn't in `failed`, OR if
   * it already used up maxAttempts — a job stuck failing forever must stop consuming worker
   * cycles/provider quota rather than retry indefinitely; it stays `failed` (a human/admin action
   * would be the only way out, not built in this branch — see POWERBALL_EMAIL_RELIABILITY.md).
   */
  retry(emailJobId, { maxAttempts = 5 } = {}) {
    const job = this._jobs.get(emailJobId);
    if (!job) throw new Error(`retry: no such job ${emailJobId}`);
    if (job.status !== JOB_STATUS.FAILED) return null;
    if (job.attempt_count >= maxAttempts) return null;
    job.status = JOB_STATUS.PENDING;
    return { ...job };
  }

  cancel(emailJobId, reason) {
    const job = this._jobs.get(emailJobId);
    if (!job) throw new Error(`cancel: no such job ${emailJobId}`);
    if (job.status === JOB_STATUS.SENT) {
      throw new Error(`cancel: job ${emailJobId} already sent, cannot cancel`);
    }
    job.status = JOB_STATUS.CANCELLED;
    job.last_error = reason ?? null;
    return { ...job };
  }

  suppress(emailJobId, reason) {
    const job = this._jobs.get(emailJobId);
    if (!job) throw new Error(`suppress: no such job ${emailJobId}`);
    job.status = JOB_STATUS.SUPPRESSED;
    job.last_error = reason ?? null;
    return { ...job };
  }
}
