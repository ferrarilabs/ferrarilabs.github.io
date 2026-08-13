--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- ROLLBACK for 20260813190000_submit_entry_pool_allowlist.sql
--
-- Restores the prior pool list ('br2026','cdb2026','main'). Note this also restores RED-1: cdb2026
-- and main become reachable for anon entry creation again, with no deadline gate. Only roll this
-- back if the allowlist itself is causing a problem.
--

begin;

CREATE OR REPLACE FUNCTION public.submit_entry(p_pool_id text, p_entry_name text, p_participant_email text, p_picks jsonb, p_payer_name text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_client_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_state jsonb;
  v_id    text;
  v_now   timestamptz := now();
  v_cutoff timestamptz;
  v_existing jsonb;
begin
  -- Competição permitida. Lista fechada: nada de criar pool novo por parâmetro.
  if p_pool_id is null or p_pool_id not in ('br2026','cdb2026','main') then
    raise exception 'submit_entry: competicao invalida';
  end if;

  if p_entry_name is null or length(trim(p_entry_name)) = 0 or length(p_entry_name) > 80 then
    raise exception 'submit_entry: entryName ausente ou fora do limite (1..80)';
  end if;

  if p_participant_email is null or length(p_participant_email) > 254
     or p_participant_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'submit_entry: e-mail ausente ou com sintaxe invalida';
  end if;

  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'submit_entry: picks precisa ser objeto';
  end if;
  if length(p_picks::text) > 20000 then
    raise exception 'submit_entry: picks excede o tamanho maximo';
  end if;

  if p_payer_name is not null and length(p_payer_name) > 120 then
    raise exception 'submit_entry: payerName excede o limite';
  end if;
  if p_payment_method is not null and p_payment_method not in ('zelle','venmo','cashapp','pix','other') then
    raise exception 'submit_entry: paymentMethod fora da lista permitida';
  end if;

  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then
    raise exception 'submit_entry: estado inexistente para %', p_pool_id;
  end if;

  -- Prazo. Fechado o bolão, nem mesmo uma submissão bem formada entra.
  v_cutoff := nullif(v_state->>'cutoffAt','')::timestamptz;
  if v_cutoff is not null and v_now > v_cutoff then
    raise exception 'submit_entry: prazo encerrado em %', v_cutoff;
  end if;

  -- Idempotência: mesmo clientRef devolve a entrada já criada, não uma segunda.
  if p_client_ref is not null then
    select e into v_existing
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
    where e->>'clientRef' = p_client_ref limit 1;
    if v_existing is not null then
      return jsonb_build_object('entryId', v_existing->>'id', 'created', false);
    end if;
  end if;

  v_id := 'e_' || replace(gen_random_uuid()::text,'-','');

  -- A entrada e montada AQUI, campo a campo. Nao ha spread de payload do cliente.
  v_state := jsonb_set(v_state, '{entries}',
    coalesce(v_state->'entries','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'entryName', trim(p_entry_name),
      'participantEmail', p_participant_email,
      'payerName', p_payer_name,
      'paymentMethod', p_payment_method,
      'picks', p_picks,
      'clientRef', p_client_ref,
      'createdAt', to_char(v_now at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'updatedAt', to_char(v_now at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )), true);

  update bolao_state set state = _bolao_touch(v_state), updated_at = v_now where id = p_pool_id;

  insert into bolao_entry_private (pool_id, entry_ref, participant_email, payer_name, payment_method)
  values (p_pool_id, v_id, p_participant_email, p_payer_name, p_payment_method)
  on conflict (pool_id, entry_ref) do update
    set participant_email = excluded.participant_email,
        payer_name = excluded.payer_name,
        payment_method = excluded.payment_method,
        updated_at = now();

  return jsonb_build_object('entryId', v_id, 'created', true);
end $function$;

commit;
