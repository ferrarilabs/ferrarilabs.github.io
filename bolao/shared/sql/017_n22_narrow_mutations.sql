-- 017_n22_narrow_mutations.sql — N22, STAGE 1 (EXPAND). Mutações estreitas.
--
-- ADITIVA. Nenhuma permissão é revogada aqui — a Stage 6 faz isso, depois de os clientes
-- migrarem.
--
-- ─── A REGRA QUE ORIGINA O DESENHO ───────────────────────────────────────────────────────────
--
-- NÃO existe `write_state(json)`, `save_state(json)` nem equivalente. Uma RPC que aceita o
-- documento inteiro só esconde a substituição irrestrita atrás de `security definer` — a
-- vulnerabilidade continua, com outro nome.
--
-- Cada função abaixo altera UM aspecto do estado e é incapaz de tocar no resto. `submit_entry`
-- não consegue marcar pago; `confirm_payment` não consegue mexer em palpite; nenhuma delas
-- alcança `results`, `officialDraw`, `phases` ou `roundEmail`.
--
-- ─── MODELO DE AUTORIZAÇÃO (decisão C do Eduardo, 2026-08-10) ────────────────────────────────
--
-- O site é estático e o navegador só possui a anon key PÚBLICA. Não existe identidade no
-- servidor: hoje `guardAdmin()` é `sessionStorage` verificado no cliente. Portanto:
--
--   ANÔNIMO   -> apenas `submit_entry`. É a única mutação que um visitante legítimo precisa.
--   OPERADOR  -> todas as demais, via credencial privilegiada (script/Action), NUNCA pelo
--                navegador público.
--
-- As funções de operador têm `revoke execute ... from anon`. Não é decoração: sem isso, uma RPC
-- `security definer` chamável por anon daria a mesma autoridade de hoje.
--
-- Quando um admin autenticado existir (fase futura), ele chama ESTAS MESMAS funções — as regras
-- de negócio não mudam, só passa a haver um segundo chamador autorizado.
--
-- ROLLBACK: ver o rodapé.

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────
create or replace function _bolao_touch(p_state jsonb)
returns jsonb language sql immutable as $$
  select jsonb_set(coalesce(p_state,'{}'::jsonb), '{meta,updatedAt}',
                   to_jsonb(to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')), true);
$$;

create or replace function _bolao_audit(p_state jsonb, p_action text, p_detail jsonb)
returns jsonb language sql immutable as $$
  select jsonb_set(coalesce(p_state,'{}'::jsonb), '{auditLog}',
    (jsonb_build_array(jsonb_build_object(
        'ts', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'action', p_action, 'admin', true, 'detail', p_detail))
     || coalesce(p_state->'auditLog','[]'::jsonb)), true);
$$;

-- ── SUBMIT_ENTRY — a ÚNICA mutação anônima ───────────────────────────────────────────────────
--
-- O servidor decide o `id`. Campos privilegiados vindos do cliente são IGNORADOS por construção:
-- a função monta a entrada campo a campo a partir de argumentos nomeados, então não há como
-- injetar `paid`, `results`, `officialDraw` ou chave desconhecida — eles simplesmente não têm
-- por onde entrar.
create or replace function submit_entry(
  p_pool_id           text,
  p_entry_name        text,
  p_participant_email text,
  p_picks             jsonb,
  p_payer_name        text default null,
  p_payment_method    text default null,
  p_client_ref        text default null   -- idempotência: reenvio do mesmo formulário
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
end $$;

-- ── OPERADOR — nenhuma destas e chamavel por anon ────────────────────────────────────────────

create or replace function op_confirm_payment(p_pool_id text, p_entry_ref text, p_paid boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_confirm_payment: estado inexistente'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
                 where e->>'id' = p_entry_ref) then
    raise exception 'op_confirm_payment: entrada % inexistente em %', p_entry_ref, p_pool_id;
  end if;
  -- Toca EXCLUSIVAMENTE o mapa `paid`. Nao alcanca entries, results nem qualquer outra coisa.
  v_state := jsonb_set(v_state, array['paid', p_entry_ref], to_jsonb(p_paid), true);
  v_state := _bolao_audit(v_state, 'op-confirm-payment',
                          jsonb_build_object('entryRef', p_entry_ref, 'paid', p_paid));
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('entryRef', p_entry_ref, 'paid', p_paid);
end $$;

create or replace function op_update_entry(
  p_pool_id text, p_entry_ref text,
  p_entry_name text default null, p_participant_email text default null,
  p_payer_name text default null, p_payment_method text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb; v_entries jsonb; v_found boolean := false;
begin
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_update_entry: estado inexistente'; end if;
  if p_participant_email is not null
     and p_participant_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'op_update_entry: e-mail com sintaxe invalida';
  end if;

  select jsonb_agg(case when e->>'id' = p_entry_ref then
           e || jsonb_strip_nulls(jsonb_build_object(
                  'entryName', p_entry_name, 'participantEmail', p_participant_email,
                  'payerName', p_payer_name, 'paymentMethod', p_payment_method,
                  'updatedAt', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')))
         else e end order by ord)
    into v_entries
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e,ord);

  select exists(select 1 from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
                where e->>'id' = p_entry_ref) into v_found;
  if not v_found then raise exception 'op_update_entry: entrada % inexistente', p_entry_ref; end if;

  v_state := jsonb_set(v_state, '{entries}', coalesce(v_entries,'[]'::jsonb), true);
  v_state := _bolao_audit(v_state, 'op-update-entry', jsonb_build_object('entryRef', p_entry_ref));
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;

  update bolao_entry_private set
      participant_email = coalesce(p_participant_email, participant_email),
      payer_name        = coalesce(p_payer_name, payer_name),
      payment_method    = coalesce(p_payment_method, payment_method),
      updated_at = now()
  where pool_id = p_pool_id and entry_ref = p_entry_ref;

  return jsonb_build_object('entryRef', p_entry_ref, 'updated', true);
end $$;

create or replace function op_remove_entry(p_pool_id text, p_entry_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_remove_entry: estado inexistente'; end if;
  -- Remocao LOGICA, igual ao comportamento atual do app: entra em deletedIds, nada e destruido.
  v_state := jsonb_set(v_state, '{deletedIds}',
    coalesce(v_state->'deletedIds','[]'::jsonb) || jsonb_build_array(p_entry_ref), true);
  v_state := _bolao_audit(v_state, 'op-remove-entry', jsonb_build_object('entryRef', p_entry_ref));
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('entryRef', p_entry_ref, 'removed', true);
end $$;

create or replace function op_set_results(p_pool_id text, p_results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'object' then
    raise exception 'op_set_results: results precisa ser objeto';
  end if;
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_set_results: estado inexistente'; end if;
  v_state := jsonb_set(v_state, '{results}', p_results, true);
  v_state := _bolao_audit(v_state, 'op-set-results', jsonb_build_object('locked', p_results->'locked'));
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function op_set_phases(p_pool_id text, p_phases jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  if p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    raise exception 'op_set_phases: phases precisa ser array';
  end if;
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_set_phases: estado inexistente'; end if;
  v_state := jsonb_set(v_state, '{phases}', p_phases, true);
  v_state := _bolao_audit(v_state, 'op-set-phases',
                          jsonb_build_object('phaseCount', jsonb_array_length(p_phases)));
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('ok', true, 'phases', jsonb_array_length(p_phases));
end $$;

create or replace function op_set_round_email(p_pool_id text, p_round_email jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_set_round_email: estado inexistente'; end if;
  v_state := jsonb_set(v_state, '{roundEmail}', coalesce(p_round_email,'{}'::jsonb), true);
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('ok', true);
end $$;

-- ── AUTORIZAÇÃO ──────────────────────────────────────────────────────────────────────────────
--
-- `submit_entry` é a única concedida a anon. As demais são revogadas explicitamente: uma RPC
-- `security definer` chamável por anon devolveria exatamente a autoridade que N22 remove.
grant  execute on function submit_entry(text,text,text,jsonb,text,text,text) to anon;

revoke execute on function op_confirm_payment(text,text,boolean)                     from anon, public;
revoke execute on function op_update_entry(text,text,text,text,text,text)            from anon, public;
revoke execute on function op_remove_entry(text,text)                                from anon, public;
revoke execute on function op_set_results(text,jsonb)                                from anon, public;
revoke execute on function op_set_phases(text,jsonb)                                 from anon, public;
revoke execute on function op_set_round_email(text,jsonb)                            from anon, public;
revoke execute on function _bolao_touch(jsonb)                                       from anon, public;
revoke execute on function _bolao_audit(jsonb,text,jsonb)                            from anon, public;

-- ROLLBACK:
-- drop function if exists submit_entry(text,text,text,jsonb,text,text,text);
-- drop function if exists op_confirm_payment(text,text,boolean);
-- drop function if exists op_update_entry(text,text,text,text,text,text);
-- drop function if exists op_remove_entry(text,text);
-- drop function if exists op_set_results(text,jsonb);
-- drop function if exists op_set_phases(text,jsonb);
-- drop function if exists op_set_round_email(text,jsonb);
-- drop function if exists _bolao_audit(jsonb,text,jsonb);
-- drop function if exists _bolao_touch(jsonb);
