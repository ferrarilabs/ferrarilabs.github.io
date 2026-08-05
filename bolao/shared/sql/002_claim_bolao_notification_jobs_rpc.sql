-- 002_claim_bolao_notification_jobs_rpc.sql — PROPOSAL ONLY. Do NOT apply to production.
-- Football-hardening NOT READY -> readiness follow-up, item 4.
--
-- Reviewed but not run in this session (no test Supabase project/credentials available). Every
-- function here is SECURITY DEFINER so the anon-key client never needs table-level
-- UPDATE/DELETE grants (see 001's RLS policies) — the function itself is the only privileged
-- write path, and its own logic is the entire safety contract.

-- The atomic claim. Equivalent to `SELECT ... FOR UPDATE SKIP LOCKED` — this is the ONE place
-- in the whole system that decides "this worker, and only this worker, owns this job now."
-- No client-side read-then-separate-update pattern exists anywhere that calls this.
create or replace function claim_bolao_notification_jobs(
  p_pool_id text,
  p_limit integer default 50,
  p_claimed_by text default 'worker'
) returns setof bolao_notification_jobs
language plpgsql
security definer
as $$
begin
  return query
  update bolao_notification_jobs j
  set status = 'processing',
      claimed_at = now(),
      claimed_by = p_claimed_by
  from (
    select job_id
    from bolao_notification_jobs
    where pool_id = p_pool_id
      and status in ('pending', 'failed_retryable')
      and next_attempt_at <= now()
    order by next_attempt_at
    limit p_limit
    for update skip locked  -- <-- the actual concurrency-safety mechanism: a second concurrent
                             -- call to this SAME function, racing at the same instant, will
                             -- simply skip any row already locked by the first call, rather than
                             -- blocking or double-claiming it.
  ) eligible
  where j.job_id = eligible.job_id
  returning j.*;
end;
$$;

create or replace function mark_bolao_notification_sent(
  p_job_id uuid,
  p_provider_message_id text default null
) returns bolao_notification_jobs
language plpgsql
security definer
as $$
declare
  result bolao_notification_jobs;
begin
  update bolao_notification_jobs
  set status = 'sent',
      sent_at = now(),
      last_attempt_at = now(),
      attempt_count = attempt_count + 1,
      provider_message_id = p_provider_message_id,
      claimed_at = null,
      claimed_by = null
  where job_id = p_job_id
  returning * into result;

  insert into bolao_notification_deliveries (job_id, outcome, provider_message_id)
  values (p_job_id, 'sent', p_provider_message_id);

  return result;
end;
$$;

create or replace function mark_bolao_notification_retryable_failure(
  p_job_id uuid,
  p_error text
) returns bolao_notification_jobs
language plpgsql
security definer
as $$
declare
  result bolao_notification_jobs;
  v_attempt_count integer;
  v_max_attempts integer;
begin
  select attempt_count, max_attempts into v_attempt_count, v_max_attempts
  from bolao_notification_jobs where job_id = p_job_id;

  update bolao_notification_jobs
  set status = case when v_attempt_count + 1 >= v_max_attempts then 'failed_permanent' else 'failed_retryable' end,
      last_attempt_at = now(),
      attempt_count = attempt_count + 1,
      last_error = p_error,
      claimed_at = null,
      claimed_by = null,
      -- exponential backoff, capped at 1 hour — never a tight retry loop against a real
      -- outage.
      next_attempt_at = now() + (least(power(2, v_attempt_count + 1)::int, 3600) || ' seconds')::interval
  where job_id = p_job_id
  returning * into result;

  insert into bolao_notification_deliveries (job_id, outcome, error)
  values (p_job_id, result.status, p_error);

  return result;
end;
$$;

create or replace function mark_bolao_notification_permanent_failure(
  p_job_id uuid,
  p_error text
) returns bolao_notification_jobs
language plpgsql
security definer
as $$
declare
  result bolao_notification_jobs;
begin
  update bolao_notification_jobs
  set status = 'failed_permanent',
      last_attempt_at = now(),
      attempt_count = attempt_count + 1,
      last_error = p_error,
      claimed_at = null,
      claimed_by = null
  where job_id = p_job_id
  returning * into result;

  insert into bolao_notification_deliveries (job_id, outcome, error)
  values (p_job_id, 'failed_permanent', p_error);

  return result;
end;
$$;

-- Recovers jobs whose claimant crashed mid-send (claimed_at older than the threshold, still
-- "processing") back to "pending" — the server-side equivalent of
-- notification_outbox.mjs's recoverStuckJobs(), but safe across concurrent workers because the
-- UPDATE itself is the atomic operation, not a read-then-write from the client.
create or replace function release_stale_bolao_processing(
  p_threshold_ms bigint
) returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  with released as (
    update bolao_notification_jobs
    set status = 'pending', claimed_at = null, claimed_by = null,
        last_error = 'released: stuck in processing past threshold'
    where status = 'processing'
      and claimed_at is not null
      and claimed_at < now() - (p_threshold_ms || ' milliseconds')::interval
    returning job_id
  )
  select count(*) into v_count from released;
  return v_count;
end;
$$;

-- Grants: anon role may EXECUTE these RPCs (that's the only privileged path it has — see 001's
-- RLS comment), never UPDATE the tables directly.
grant execute on function claim_bolao_notification_jobs(text, integer, text) to anon;
grant execute on function mark_bolao_notification_sent(uuid, text) to anon;
grant execute on function mark_bolao_notification_retryable_failure(uuid, text) to anon;
grant execute on function mark_bolao_notification_permanent_failure(uuid, text) to anon;
grant execute on function release_stale_bolao_processing(bigint) to anon;
