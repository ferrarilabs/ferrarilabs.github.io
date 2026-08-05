-- Powerball Admin — RPC migration (PROPOSAL ONLY, NOT APPLIED TO PRODUCTION)
-- All writes to primary tables happen exclusively through these SECURITY DEFINER functions.
-- Each RPC: (1) confirms auth.uid(), (2) confirms role via lottery_current_role(),
-- (3) validates inputs, (4) validates expected_version for optimistic concurrency,
-- (5) executes atomically, (6) writes an audit entry, (7) returns the result,
-- (8) fails entirely on any error (function body is one implicit transaction).

-- Internal helper — not exposed to anon/authenticated directly as a callable "write" surface
-- for anything other than audit bookkeeping; still SECURITY DEFINER since it inserts into
-- lottery_admin_audit, which has no INSERT policy for any role.
create or replace function lottery_write_audit(
  p_action_type text, p_entity_type text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_reason text,
  p_request_id uuid, p_correlation_id uuid, p_source text default 'admin-ui'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role lottery_role;
  v_email text;
  v_id uuid;
begin
  v_role := lottery_current_role();
  select email into v_email from auth.users where id = auth.uid();
  insert into lottery_admin_audit(
    actor_user_id, actor_email_snapshot, actor_role, action_type, entity_type, entity_id,
    before_snapshot, after_snapshot, reason, request_id, correlation_id, source
  ) values (
    auth.uid(), v_email, v_role, p_action_type, p_entity_type, p_entity_id,
    p_before, p_after, p_reason, p_request_id, p_correlation_id, p_source
  ) returning audit_id into v_id;
  return v_id;
end;
$$;

-- Mandatory-reason validation: reject empty/trivial reasons.
create or replace function lottery_validate_reason(p_reason text) returns void
language plpgsql immutable as $$
begin
  if p_reason is null or length(trim(p_reason)) < 8
     or lower(trim(p_reason)) in ('.', 'teste', 'test', 'n/a', 'na', 'x') then
    raise exception 'Motivo obrigatório e não pode ser trivial (mínimo 8 caracteres, sem valores como ".", "teste", "n/a").';
  end if;
end;
$$;

-- ============================================================
-- Participants
-- ============================================================
create or replace function admin_create_participant(
  p_display_name text, p_email text, p_phone text, p_reason text, p_request_id uuid
) returns lottery_participants
language plpgsql security definer set search_path = public as $$
declare v_row lottery_participants;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  insert into lottery_participants(display_name, email, phone, created_by, updated_by)
  values (p_display_name, p_email, p_phone, auth.uid(), auth.uid())
  returning * into v_row;
  perform lottery_write_audit('create_participant','participant', v_row.participant_id,
    null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

create or replace function admin_update_participant(
  p_participant_id uuid, p_display_name text, p_email text, p_phone text,
  p_expected_version int, p_reason text, p_request_id uuid
) returns lottery_participants
language plpgsql security definer set search_path = public as $$
declare v_before lottery_participants; v_after lottery_participants;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_before from lottery_participants where participant_id = p_participant_id for update;
  if v_before is null then raise exception 'participant not found'; end if;
  if v_before.version <> p_expected_version then
    raise exception 'STALE_VERSION: Este registro foi alterado por outro processo. Recarregue os dados antes de continuar.';
  end if;
  update lottery_participants set
    display_name = p_display_name, email = p_email, phone = p_phone,
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where participant_id = p_participant_id
  returning * into v_after;
  perform lottery_write_audit('update_participant','participant', p_participant_id,
    to_jsonb(v_before), to_jsonb(v_after), p_reason, p_request_id, p_request_id);
  return v_after;
end;
$$;

create or replace function admin_archive_participant(
  p_participant_id uuid, p_expected_version int, p_reason text, p_request_id uuid
) returns lottery_participants
language plpgsql security definer set search_path = public as $$
declare v_before lottery_participants; v_after lottery_participants;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_before from lottery_participants where participant_id = p_participant_id for update;
  if v_before is null then raise exception 'participant not found'; end if;
  if v_before.version <> p_expected_version then
    raise exception 'STALE_VERSION: Este registro foi alterado por outro processo. Recarregue os dados antes de continuar.';
  end if;
  update lottery_participants set
    state = 'archived', version = version + 1, updated_at = now(), updated_by = auth.uid(),
    archived_at = now(), archived_by = auth.uid()
  where participant_id = p_participant_id
  returning * into v_after;
  perform lottery_write_audit('archive_participant','participant', p_participant_id,
    to_jsonb(v_before), to_jsonb(v_after), p_reason, p_request_id, p_request_id);
  return v_after;
end;
$$;

create or replace function admin_add_participation(
  p_participant_id uuid, p_pool_id uuid, p_draw_id uuid, p_cotas numeric,
  p_reason text, p_request_id uuid
) returns lottery_participations
language plpgsql security definer set search_path = public as $$
declare v_row lottery_participations;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  insert into lottery_participations(participant_id, pool_id, draw_id, cotas, created_by, updated_by)
  values (p_participant_id, p_pool_id, p_draw_id, p_cotas, auth.uid(), auth.uid())
  returning * into v_row;
  perform lottery_write_audit('add_participation','participation', v_row.participation_id,
    null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

-- ============================================================
-- Payments (append-only ledger — corrections are new reversal rows, never edits)
-- ============================================================
create or replace function admin_record_payment(
  p_participation_id uuid, p_type payment_txn_type, p_amount numeric,
  p_external_reference text, p_proof_object_path text, p_reason text, p_request_id uuid
) returns lottery_payment_transactions
language plpgsql security definer set search_path = public as $$
declare v_row lottery_payment_transactions;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  insert into lottery_payment_transactions(
    participation_id, type, amount, external_reference, proof_object_path, reason, created_by
  ) values (
    p_participation_id, p_type, p_amount, p_external_reference, p_proof_object_path, p_reason, auth.uid()
  ) returning * into v_row;
  perform lottery_write_audit('record_payment','payment_transaction', v_row.transaction_id,
    null, to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

create or replace function admin_reverse_payment(
  p_transaction_id uuid, p_reason text, p_request_id uuid
) returns lottery_payment_transactions
language plpgsql security definer set search_path = public as $$
declare v_orig lottery_payment_transactions; v_row lottery_payment_transactions;
begin
  if lottery_current_role() not in ('owner','admin') then raise exception 'not authorized'; end if;
  perform lottery_validate_reason(p_reason);
  select * into v_orig from lottery_payment_transactions where transaction_id = p_transaction_id;
  if v_orig is null then raise exception 'transaction not found'; end if;
  insert into lottery_payment_transactions(
    participation_id, type, amount, reverses_transaction_id, reason, created_by
  ) values (
    v_orig.participation_id, 'reversal', -v_orig.amount, p_transaction_id, p_reason, auth.uid()
  ) returning * into v_row;
  perform lottery_write_audit('reverse_payment','payment_transaction', v_row.transaction_id,
    to_jsonb(v_orig), to_jsonb(v_row), p_reason, p_request_id, p_request_id);
  return v_row;
end;
$$;

-- ============================================================
-- Draws / Tickets / Publications / Results (signatures only — bodies follow the same
-- audit+version+reason+role pattern as above; abbreviated here to keep this migration
-- reviewable rather than repeating ~80 lines of near-identical boilerplate seven more times.
-- Each MUST be filled in with the same guarantees before this migration is considered final —
-- tracked as an open item in POWERBALL_ADMIN_ARCHITECTURE.md, not silently assumed complete.)
-- ============================================================
-- admin_create_draw(pool_id, draw_date, jackpot_estimate, cash_value_estimate, reason, request_id)
-- admin_update_draw_estimates(draw_id, jackpot_estimate, cash_value_estimate, expected_version, reason, request_id)
-- admin_create_ticket(draw_id, numbers, powerball, power_play, reason, request_id)
-- admin_update_draft_ticket(ticket_id, numbers, powerball, power_play, expected_version, reason, request_id)
-- admin_publish_tickets(publication draft payload, draw_id, ticket_ids[], reason, request_id) -- requires typed "CONFIRMAR"
-- admin_correct_ticket_publication(publication_id, new manifest, reason, request_id) -- creates new version, never edits published rows
-- admin_record_result(draw_id, numbers, powerball, jackpot_amount, reason, request_id)
-- admin_correct_result(result_id, numbers, powerball, jackpot_amount, reason, request_id) -- supersedes, never edits
-- admin_enqueue_email(job_type, entity_type, entity_id, recipient_email, reason, request_id)
-- admin_retry_email(job_id, reason, request_id)
