/**
 * supabase_notification_repository.mjs — the PRODUCTION NotificationRepository adapter
 * (football-hardening NOT READY -> readiness follow-up, items 1/3/4).
 *
 * Talks to the `bolao_events` / `bolao_notification_jobs` tables (proposal:
 * bolao/shared/sql/001_bolao_notification_schema.sql) via Postgres RPC functions (proposal:
 * bolao/shared/sql/002_claim_bolao_notification_jobs_rpc.sql) — never raw
 * select-then-update from the client, which is exactly the race condition the RPC exists to
 * close (two workers reading "pending", both deciding to claim, both writing "processing").
 *
 * HONESTY NOTE (do not remove): this file is CODE-COMPLETE but has NOT been executed against a
 * real Supabase project in this session — no test Supabase project/credentials were available.
 * See docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_EXECUTION.md for the explicit
 * "NÃO EXECUTADO — AGUARDANDO SUPABASE DE TESTE" status. Do not present this adapter as proven
 * until that real run has actually happened.
 *
 * Zero service_role key anywhere in this file or any caller — only the anon key, matching this
 * repo's existing rule (CLAUDE.md: "Only anon key used — never the service_role key"). The RPC
 * functions themselves run with definer rights server-side (see the SQL proposal's SECURITY
 * DEFINER + RLS notes) so the anon-key client never needs elevated privileges to claim a job.
 */
import { SCHEMA_VERSION, JOB_STATUS } from "./notification_repository.mjs";

export class SupabaseNotificationRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} client */
  constructor(client) {
    if (!client) throw new Error("SupabaseNotificationRepository requires a real Supabase client — never a lazily-undefined one");
    this.client = client;
  }

  async createEvent(event) {
    // ON CONFLICT (pool_id, entity_id, event_type, event_version) DO NOTHING, then re-select —
    // see the schema proposal's unique constraint. upsert() with ignoreDuplicates mirrors that.
    const { data, error } = await this.client
      .from("bolao_events")
      .upsert(
        {
          pool_id: event.poolId, entity_type: event.entityType, entity_id: event.entityId,
          event_type: event.eventType, event_version: event.eventVersion,
          payload_snapshot: event.payloadSnapshot, source_timestamp: event.sourceTimestamp ?? null,
          correlation_id: event.correlationId ?? null,
        },
        { onConflict: "pool_id,entity_id,event_type,event_version", ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();
    if (error) throw new Error(`createEvent failed: ${error.message}`);
    if (data) return { event: this._mapEvent(data), created: true };
    // Conflict — the row already existed and upsert returned nothing; re-fetch it.
    const { data: existing, error: fetchErr } = await this.client
      .from("bolao_events").select()
      .eq("pool_id", event.poolId).eq("entity_id", event.entityId)
      .eq("event_type", event.eventType).eq("event_version", event.eventVersion)
      .single();
    if (fetchErr) throw new Error(`createEvent re-fetch failed: ${fetchErr.message}`);
    return { event: this._mapEvent(existing), created: false };
  }

  async enqueueJobs(eventId, jobDrafts) {
    const rows = jobDrafts.map((d) => ({
      event_id: eventId, pool_id: d.poolId, recipient: d.recipient,
      template_id: d.templateId ?? "default", template_version: d.templateVersion ?? 1,
      payload_snapshot: d.payloadSnapshot, idempotency_key: d.idempotencyKey,
      status: JOB_STATUS.PENDING, attempt_count: 0,
    }));
    const { data, error } = await this.client
      .from("bolao_notification_jobs")
      .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select();
    if (error) throw new Error(`enqueueJobs failed: ${error.message}`);
    // Re-fetch the full set by idempotency key so callers see EVERY job (including ones that
    // already existed and were skipped by ignoreDuplicates) — same "created vs existing"
    // transparency the file/memory adapters give.
    const keys = jobDrafts.map((d) => d.idempotencyKey);
    const { data: all, error: fetchErr } = await this.client
      .from("bolao_notification_jobs").select().in("idempotency_key", keys);
    if (fetchErr) throw new Error(`enqueueJobs re-fetch failed: ${fetchErr.message}`);
    return { jobs: (all ?? []).map(this._mapJob), createdCount: (data ?? []).length };
  }

  /** Atomic claim — NEVER a client-side read-then-update. Calls the server-side RPC
   * (claim_bolao_notification_jobs, proposal SQL) which does the equivalent of
   * `SELECT ... FOR UPDATE SKIP LOCKED` inside one transaction. */
  async claimPendingJobs(poolId, limit = 50, claimedBy = "worker") {
    const { data, error } = await this.client.rpc("claim_bolao_notification_jobs", {
      p_pool_id: poolId, p_limit: limit, p_claimed_by: claimedBy,
    });
    if (error) throw new Error(`claimPendingJobs RPC failed: ${error.message}`);
    return (data ?? []).map(this._mapJob);
  }

  async markSent(jobId, { providerMessageId = null } = {}) {
    const { data, error } = await this.client.rpc("mark_bolao_notification_sent", {
      p_job_id: jobId, p_provider_message_id: providerMessageId,
    });
    if (error) throw new Error(`markSent RPC failed: ${error.message}`);
    return this._mapJob(data);
  }

  async markRetryableFailure(jobId, { error: errMsg } = {}) {
    const { data, error } = await this.client.rpc("mark_bolao_notification_retryable_failure", {
      p_job_id: jobId, p_error: errMsg ?? "unknown error",
    });
    if (error) throw new Error(`markRetryableFailure RPC failed: ${error.message}`);
    return this._mapJob(data);
  }

  async markPermanentFailure(jobId, { error: errMsg } = {}) {
    const { data, error } = await this.client.rpc("mark_bolao_notification_permanent_failure", {
      p_job_id: jobId, p_error: errMsg ?? "unknown error",
    });
    if (error) throw new Error(`markPermanentFailure RPC failed: ${error.message}`);
    return this._mapJob(data);
  }

  async releaseStuckJobs(thresholdMs) {
    const { data, error } = await this.client.rpc("release_stale_bolao_processing", {
      p_threshold_ms: thresholdMs,
    });
    if (error) throw new Error(`releaseStuckJobs RPC failed: ${error.message}`);
    return data ?? 0;
  }

  async findMissingNotifications(poolId) {
    const { data, error } = await this.client
      .from("bolao_events")
      .select("*, bolao_notification_jobs!left(job_id)")
      .eq("pool_id", poolId)
      .is("bolao_notification_jobs.job_id", null);
    if (error) throw new Error(`findMissingNotifications failed: ${error.message}`);
    return (data ?? []).map(this._mapEvent);
  }

  async findUnprocessedFinalResults(poolId) {
    const { data, error } = await this.client
      .from("bolao_events")
      .select("entity_id")
      .eq("pool_id", poolId).eq("event_type", "final_confirmed").is("processed_at", null);
    if (error) throw new Error(`findUnprocessedFinalResults failed: ${error.message}`);
    return (data ?? []).map((r) => r.entity_id);
  }

  _mapEvent(row) {
    return {
      eventId: row.event_id, poolId: row.pool_id, entityType: row.entity_type, entityId: row.entity_id,
      eventType: row.event_type, eventVersion: row.event_version, payloadSnapshot: row.payload_snapshot,
      sourceTimestamp: row.source_timestamp, createdAt: row.created_at, processedAt: row.processed_at,
      correlationId: row.correlation_id,
    };
  }
  _mapJob(row) {
    return {
      schemaVersion: SCHEMA_VERSION, jobId: row.job_id, eventId: row.event_id, poolId: row.pool_id,
      recipient: row.recipient, templateId: row.template_id, templateVersion: row.template_version,
      payloadSnapshot: row.payload_snapshot, idempotencyKey: row.idempotency_key, status: row.status,
      attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, claimedAt: row.claimed_at,
      claimedBy: row.claimed_by, lastAttemptAt: row.last_attempt_at, sentAt: row.sent_at,
      providerMessageId: row.provider_message_id, lastError: row.last_error, createdAt: row.created_at,
    };
  }
}
