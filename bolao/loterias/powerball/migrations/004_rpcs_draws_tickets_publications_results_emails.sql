-- Powerball Admin — RPC migration part 2 (PROPOSAL ONLY, NOT APPLIED TO PRODUCTION)
-- Draws, tickets, publications, results, email jobs. Same guarantees as 003_rpcs.sql:
-- auth.uid() + role check, input validation, optimistic-concurrency version check where the
-- entity is mutable, mandatory-reason validation, atomic execution, audit write, no partial
-- writes on error (implicit function-body transaction).

-- ============================================================
-- Draws
-- ============================================================
create or replace function admin_create_draw(
  p_pool_id uuid, p_draw_date date, p_jackpot_estimate numeric, p_cash_value_estimate numeric,
  p_reason text, p_request_id uuid
) returns lottery_draws
language plpgsql security definer set search_path = public as $$
declare v_row lottery_draws;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if p_draw_date is null then raise exception 'draw_date required'; end if;
  insert into lottery_draws(pool_id, draw_date, jackpot_estimate, cash_value_estimate, created_by, updated_by)
  values (p_pool_id, p_draw_date, p_jackpot_estimate, p_cash_value_estimate, auth.uid(), auth.uid())
  returning * into v_row;
  perform lottery_write_audit('create_draw','draw', v_row.draw_id, null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

create or replace function admin_update_draw_estimates(
  p_draw_id uuid, p_jackpot_estimate numeric, p_cash_value_estimate numeric,
  p_expected_version int, p_reason text, p_request_id uuid
) returns lottery_draws
language plpgsql security definer set search_path = public as $$
declare v_before lottery_draws; v_after lottery_draws;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_before from lottery_draws where draw_id = p_draw_id for update;
  if v_before is null then raise exception 'draw not found'; end if;
  if v_before.version <> p_expected_version then
    raise exception 'STALE_VERSION: Este registro foi alterado por outro processo. Recarregue os dados antes de continuar.';
  end if;
  update lottery_draws set
    jackpot_estimate = p_jackpot_estimate, cash_value_estimate = p_cash_value_estimate,
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where draw_id = p_draw_id
  returning * into v_after;
  perform lottery_write_audit('update_draw_estimates','draw', p_draw_id, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_request_id, p_request_id);
  return v_after;
end;
$$;

-- ============================================================
-- Tickets (draft only — publication is a separate, immutable step)
-- ============================================================
create or replace function admin_create_ticket(
  p_draw_id uuid, p_numbers int[], p_powerball int, p_power_play boolean,
  p_reason text, p_request_id uuid
) returns lottery_tickets
language plpgsql security definer set search_path = public as $$
declare v_row lottery_tickets;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if array_length(p_numbers,1) <> 5 then raise exception 'a Powerball ticket requires exactly 5 numbers'; end if;
  if p_powerball is null or p_powerball < 1 or p_powerball > 26 then raise exception 'invalid powerball number'; end if;
  insert into lottery_tickets(draw_id, numbers, powerball, power_play, created_by, updated_by)
  values (p_draw_id, p_numbers, p_powerball, coalesce(p_power_play,false), auth.uid(), auth.uid())
  returning * into v_row;
  perform lottery_write_audit('create_ticket','ticket', v_row.ticket_id, null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

create or replace function admin_update_draft_ticket(
  p_ticket_id uuid, p_numbers int[], p_powerball int, p_power_play boolean,
  p_expected_version int, p_reason text, p_request_id uuid
) returns lottery_tickets
language plpgsql security definer set search_path = public as $$
declare v_before lottery_tickets; v_after lottery_tickets;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_before from lottery_tickets where ticket_id = p_ticket_id for update;
  if v_before is null then raise exception 'ticket not found'; end if;
  if v_before.status <> 'draft' then
    raise exception 'published tickets are immutable — use admin_correct_ticket_publication instead';
  end if;
  if v_before.version <> p_expected_version then
    raise exception 'STALE_VERSION: Este registro foi alterado por outro processo. Recarregue os dados antes de continuar.';
  end if;
  update lottery_tickets set
    numbers = p_numbers, powerball = p_powerball, power_play = coalesce(p_power_play,false),
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where ticket_id = p_ticket_id
  returning * into v_after;
  perform lottery_write_audit('update_draft_ticket','ticket', p_ticket_id, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_request_id, p_request_id);
  return v_after;
end;
$$;

-- ============================================================
-- Publications — publishing freezes the referenced tickets (immutable thereafter).
-- Corrections never edit a published row; they create a new publication version that
-- supersedes the old one, and re-freeze a fresh set of ticket rows.
-- ============================================================
create or replace function admin_publish_tickets(
  p_draw_id uuid, p_ticket_ids uuid[], p_manifest jsonb, p_financial_snapshot jsonb,
  p_participant_snapshot jsonb, p_reason text, p_confirmation_text text, p_request_id uuid
) returns lottery_ticket_publications
language plpgsql security definer set search_path = public as $$
declare v_pub lottery_ticket_publications; v_hash text; v_tid uuid;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if p_confirmation_text <> 'CONFIRMAR' then
    raise exception 'critical action requires typing CONFIRMAR literally';
  end if;
  v_hash := encode(digest(p_manifest::text, 'sha256'), 'hex');
  insert into lottery_ticket_publications(
    draw_id, status, manifest_json, manifest_hash, financial_snapshot, participant_snapshot,
    published_at, created_by
  ) values (
    p_draw_id, 'published', p_manifest, v_hash, p_financial_snapshot, p_participant_snapshot,
    now(), auth.uid()
  ) returning * into v_pub;

  foreach v_tid in array p_ticket_ids loop
    update lottery_tickets set status = 'published', version = version + 1, updated_at = now(), updated_by = auth.uid()
      where ticket_id = v_tid and status = 'draft';
    if not found then
      raise exception 'ticket % is not in draft state — publication aborted, no partial writes', v_tid;
    end if;
    insert into lottery_ticket_publication_items(publication_id, ticket_id) values (v_pub.publication_id, v_tid);
  end loop;

  perform lottery_write_audit('publish_tickets','ticket_publication', v_pub.publication_id,
    null, to_jsonb(v_pub), p_reason, p_request_id, p_request_id);
  return v_pub;
end;
$$;

create or replace function admin_correct_ticket_publication(
  p_publication_id uuid, p_new_ticket_ids uuid[], p_manifest jsonb, p_financial_snapshot jsonb,
  p_participant_snapshot jsonb, p_reason text, p_confirmation_text text, p_request_id uuid
) returns lottery_ticket_publications
language plpgsql security definer set search_path = public as $$
declare v_old lottery_ticket_publications; v_new lottery_ticket_publications; v_hash text; v_tid uuid;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if p_confirmation_text <> 'CONFIRMAR' then
    raise exception 'critical action requires typing CONFIRMAR literally';
  end if;
  select * into v_old from lottery_ticket_publications where publication_id = p_publication_id for update;
  if v_old is null then raise exception 'publication not found'; end if;

  v_hash := encode(digest(p_manifest::text, 'sha256'), 'hex');
  insert into lottery_ticket_publications(
    draw_id, version, status, manifest_json, manifest_hash, financial_snapshot, participant_snapshot,
    supersedes_publication_id, published_at, created_by
  ) values (
    v_old.draw_id, v_old.version + 1, 'published', p_manifest, v_hash, p_financial_snapshot,
    p_participant_snapshot, p_publication_id, now(), auth.uid()
  ) returning * into v_new;

  update lottery_ticket_publications set status = 'corrected' where publication_id = p_publication_id;

  foreach v_tid in array p_new_ticket_ids loop
    insert into lottery_ticket_publication_items(publication_id, ticket_id) values (v_new.publication_id, v_tid);
  end loop;

  perform lottery_write_audit('correct_ticket_publication','ticket_publication', v_new.publication_id,
    to_jsonb(v_old), to_jsonb(v_new), p_reason, p_request_id, p_request_id);
  return v_new;
end;
$$;

-- ============================================================
-- Results — correction supersedes, never edits in place.
-- ============================================================
create or replace function admin_record_result(
  p_draw_id uuid, p_numbers int[], p_powerball int, p_jackpot_amount numeric,
  p_reason text, p_request_id uuid
) returns lottery_results
language plpgsql security definer set search_path = public as $$
declare v_row lottery_results;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if array_length(p_numbers,1) <> 5 then raise exception 'a Powerball result requires exactly 5 numbers'; end if;
  insert into lottery_results(draw_id, numbers, powerball, jackpot_amount, created_by)
  values (p_draw_id, p_numbers, p_powerball, p_jackpot_amount, auth.uid())
  returning * into v_row;
  perform lottery_write_audit('record_result','result', v_row.result_id, null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

create or replace function admin_correct_result(
  p_result_id uuid, p_numbers int[], p_powerball int, p_jackpot_amount numeric,
  p_reason text, p_confirmation_text text, p_request_id uuid
) returns lottery_results
language plpgsql security definer set search_path = public as $$
declare v_old lottery_results; v_new lottery_results;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if p_confirmation_text <> 'CONFIRMAR' then
    raise exception 'critical action requires typing CONFIRMAR literally';
  end if;
  select * into v_old from lottery_results where result_id = p_result_id for update;
  if v_old is null then raise exception 'result not found'; end if;
  insert into lottery_results(draw_id, numbers, powerball, jackpot_amount, version, supersedes_result_id, created_by)
  values (v_old.draw_id, p_numbers, p_powerball, p_jackpot_amount, v_old.version + 1, p_result_id, auth.uid())
  returning * into v_new;
  update lottery_results set status = 'superseded' where result_id = p_result_id;
  perform lottery_write_audit('correct_result','result', v_new.result_id, to_jsonb(v_old), to_jsonb(v_new), p_reason, p_request_id, p_request_id);
  return v_new;
end;
$$;

-- ============================================================
-- Email jobs — the RPC only ever enqueues into the persisted outbox (lottery_email_jobs).
-- Actual sending is done by the existing email-worker code from
-- powerball-email-professionalization, reused as-is; it is that worker, not the browser,
-- that ever talks to the email provider.
-- ============================================================
create or replace function admin_enqueue_email(
  p_job_type text, p_entity_type text, p_entity_id uuid, p_recipient_email text,
  p_reason text, p_request_id uuid
) returns lottery_email_jobs
language plpgsql security definer set search_path = public as $$
declare v_row lottery_email_jobs;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  if p_recipient_email is null or p_recipient_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid recipient email';
  end if;
  insert into lottery_email_jobs(job_type, entity_type, entity_id, recipient_email, created_by)
  values (p_job_type, p_entity_type, p_entity_id, p_recipient_email, auth.uid())
  returning * into v_row;
  perform lottery_write_audit('enqueue_email','email_job', v_row.job_id, null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

create or replace function admin_retry_email(
  p_job_id uuid, p_reason text, p_request_id uuid
) returns lottery_email_jobs
language plpgsql security definer set search_path = public as $$
declare v_before lottery_email_jobs; v_after lottery_email_jobs;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_before from lottery_email_jobs where job_id = p_job_id for update;
  if v_before is null then raise exception 'job not found'; end if;
  if v_before.status not in ('failed','cancelled') then
    raise exception 'only failed or cancelled jobs can be retried (current status: %)', v_before.status;
  end if;
  update lottery_email_jobs set status = 'pending', attempts = 0, last_error = null
  where job_id = p_job_id
  returning * into v_after;
  perform lottery_write_audit('retry_email','email_job', p_job_id, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_request_id, p_request_id);
  return v_after;
end;
$$;

create or replace function admin_cancel_email_job(
  p_job_id uuid, p_reason text, p_request_id uuid
) returns lottery_email_jobs
language plpgsql security definer set search_path = public as $$
declare v_before lottery_email_jobs; v_after lottery_email_jobs;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_before from lottery_email_jobs where job_id = p_job_id for update;
  if v_before is null then raise exception 'job not found'; end if;
  if v_before.status not in ('pending','processing') then
    raise exception 'only pending or processing jobs can be cancelled (current status: %)', v_before.status;
  end if;
  update lottery_email_jobs set status = 'cancelled' where job_id = p_job_id returning * into v_after;
  perform lottery_write_audit('cancel_email_job','email_job', p_job_id, to_jsonb(v_before), to_jsonb(v_after), p_reason, p_request_id, p_request_id);
  return v_after;
end;
$$;
