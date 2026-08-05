-- 001_bolao_notification_schema.sql — PROPOSAL ONLY. Do NOT apply to production.
-- Football-hardening NOT READY -> readiness follow-up, item 3.
--
-- Reviewed but not run in this session (no test Supabase project/credentials available — see
-- docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_EXECUTION.md). Written to the same conventions
-- this repo's existing Supabase setup already uses (see
-- bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md), RLS-restricted, anon-key-only from any
-- client.

create table if not exists bolao_events (
  event_id        uuid primary key default gen_random_uuid(),
  pool_id         text not null,              -- 'copa2026' | 'br2026' | 'cdb2026' | future pools
  entity_type     text not null,              -- 'match' | 'tie' | 'round_batch'
  entity_id       text not null,              -- e.g. 'oitavas:tie-1:first', 'M95', 'round:g1,g2'
  event_type      text not null,              -- 'final_confirmed' | 'result_corrected' | ...
  event_version   integer not null default 1,
  payload_snapshot jsonb not null,
  source_timestamp timestamptz,               -- when the SOURCE (ESPN) says this happened
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,                -- set once this event's notification jobs are all terminal
  correlation_id  text,                       -- ties together events from the same processing run

  constraint bolao_events_unique_event
    unique (pool_id, entity_id, event_type, event_version)
);

create index if not exists bolao_events_pool_unprocessed
  on bolao_events (pool_id, event_type) where processed_at is null;

create type bolao_notification_job_status as enum (
  'pending', 'processing', 'sent', 'failed_retryable', 'failed_permanent', 'suppressed', 'cancelled'
);

create table if not exists bolao_notification_jobs (
  job_id              uuid primary key default gen_random_uuid(),
  event_id            uuid not null references bolao_events(event_id) on delete cascade,
  pool_id             text not null,
  -- Denormalized from the parent event (canonical schema requires them on the job record
  -- itself, not only reachable via a join) — set at enqueue time, never recomputed.
  entity_id           text not null,
  event_version       integer not null,
  recipient           text not null,          -- PII — see RLS note below
  template_id         text not null default 'default',
  template_version    integer not null default 1,
  payload_snapshot    jsonb not null,          -- frozen at enqueue time, retries never recompute
  idempotency_key     text not null,
  status              bolao_notification_job_status not null default 'pending',
  attempt_count       integer not null default 0,
  max_attempts        integer not null default 5,
  next_attempt_at     timestamptz not null default now(),
  claimed_at          timestamptz,
  claimed_by          text,                    -- worker/run identifier, for observability only
  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),

  constraint bolao_notification_jobs_unique_idempotency
    unique (idempotency_key)
);

-- The index the atomic-claim RPC's FOR UPDATE SKIP LOCKED relies on.
create index if not exists bolao_notification_jobs_claimable
  on bolao_notification_jobs (pool_id, status, next_attempt_at)
  where status in ('pending', 'failed_retryable');

create index if not exists bolao_notification_jobs_stuck_processing
  on bolao_notification_jobs (status, claimed_at) where status = 'processing';

-- Delivery audit trail — one row per SEND ATTEMPT (a job may have several rows here across
-- retries), distinct from bolao_notification_jobs which holds only the CURRENT state.
create table if not exists bolao_notification_deliveries (
  delivery_id         uuid primary key default gen_random_uuid(),
  job_id              uuid not null references bolao_notification_jobs(job_id) on delete cascade,
  attempted_at        timestamptz not null default now(),
  outcome             text not null,           -- 'sent' | 'failed_retryable' | 'failed_permanent'
  provider_message_id text,
  error               text,
  provider_status_code integer
);

create index if not exists bolao_notification_deliveries_job
  on bolao_notification_deliveries (job_id);

-- One row per reconciler/worker run — the section-6-required observability trail proving a run
-- happened, what it found, and what it did, independent of the jobs it touched.
create table if not exists bolao_processing_runs (
  run_id              uuid primary key default gen_random_uuid(),
  pool_id             text not null,
  run_type            text not null,           -- 'provider_sync' | 'result_detection' | 'notification_worker' | 'reconciler' | 'health_check'
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  dry_run             boolean not null default false,
  events_created      integer not null default 0,
  jobs_enqueued       integer not null default 0,
  jobs_claimed        integer not null default 0,
  jobs_sent           integer not null default 0,
  jobs_failed         integer not null default 0,
  jobs_recovered_stuck integer not null default 0,
  error               text
);

-- RLS: same posture as this repo's existing bolao_state table (anon key only, no service_role
-- anywhere client-side). Real writes to these tables happen ONLY via the SECURITY DEFINER RPC
-- functions in 002_claim_bolao_notification_jobs_rpc.sql, which enforce their own row-level
-- checks internally — direct table UPDATE/DELETE from the anon role is intentionally NOT
-- granted, only INSERT (createEvent/enqueueJobs, which are idempotent-by-constraint) and SELECT.
alter table bolao_events enable row level security;
alter table bolao_notification_jobs enable row level security;
alter table bolao_notification_deliveries enable row level security;
alter table bolao_processing_runs enable row level security;

create policy bolao_events_insert_anon on bolao_events for insert to anon with check (true);
create policy bolao_events_select_anon on bolao_events for select to anon using (true);
create policy bolao_notification_jobs_insert_anon on bolao_notification_jobs for insert to anon with check (true);
create policy bolao_notification_jobs_select_anon on bolao_notification_jobs for select to anon using (true);
-- Deliberately NO update/delete policy for anon — all state transitions go through the
-- SECURITY DEFINER RPCs in 002_claim_bolao_notification_jobs_rpc.sql.
create policy bolao_processing_runs_insert_anon on bolao_processing_runs for insert to anon with check (true);
create policy bolao_processing_runs_select_anon on bolao_processing_runs for select to anon using (true);
create policy bolao_notification_deliveries_select_anon on bolao_notification_deliveries for select to anon using (true);
