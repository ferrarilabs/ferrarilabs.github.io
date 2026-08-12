--
-- PROVENANCE: BASELINE_ADOPTED_AT_CURRENT_STATE
--
-- BASELINE — state that pre-dates migration tracking
--
-- This file is ADOPTED, not EXECUTED. It is recorded in supabase_migrations.schema_migrations
-- via `supabase migration repair --status applied`, which inserts a ledger row and runs no SQL.
-- The objects it declares ALREADY EXIST in production; running it against production would
-- attempt to re-create them. Never `supabase db push` this file at production.
--
-- Everything in schema public that existed BEFORE ledger row 20260806143644 (add_minimal_powerball_schema): types, functions, the four football/cache tables with their constraints and indexes, and the ensure_rls event trigger. Ordered strictly before that row.
--
-- Derived mechanically by autonomous-campaign/q6_derive_baseline.mjs from the validated
-- pre-migration schema dump (backup set production-pre-migration-20260811-151516), whose surface
-- fingerprint was re-confirmed against production before derivation. The router is fail-closed:
-- every object block in the dump is routed to exactly one destination or the derivation aborts.
--
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: bolao_notif_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."bolao_notif_status" AS ENUM (
    'pending',
    'processing',
    'sent',
    'failed_retryable',
    'failed_permanent',
    'suppressed'
);

--
-- Name: _bolao_audit("jsonb", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."_bolao_audit"("p_state" "jsonb", "p_action" "text", "p_detail" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select jsonb_set(coalesce(p_state,'{}'::jsonb), '{auditLog}',
    (jsonb_build_array(jsonb_build_object(
        'ts', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'action', p_action, 'admin', true, 'detail', p_detail))
     || coalesce(p_state->'auditLog','[]'::jsonb)), true);
$$;

--
-- Name: _bolao_touch("jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."_bolao_touch"("p_state" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select jsonb_set(coalesce(p_state,'{}'::jsonb), '{meta,updatedAt}',
                   to_jsonb(to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')), true);
$$;

--
-- Name: bolao_notif_health("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."bolao_notif_health"("p_pool_id" "text") RETURNS TABLE("status" "public"."bolao_notif_status", "jobs" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select j.status, count(*) from bolao_notif_jobs j where j.pool_id = p_pool_id group by j.status;
$$;

--
-- Name: bolao_notif_status_by_pool("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."bolao_notif_status_by_pool"("p_pool_id" "text") RETURNS TABLE("idempotency_key" "text", "status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select j.idempotency_key, j.status::text
  from bolao_notif_jobs j
  where j.pool_id = p_pool_id;
$$;

--
-- Name: cdb_apply_operator_mutation("text", "jsonb", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."cdb_apply_operator_mutation"("p_type" "text", "p_payload" "jsonb", "p_actor" "text", "p_client_ref" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_state jsonb;
  v_fase text;
  v_tie text;
  v_agora timestamptz := now();
  v_iso text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_idx int;
  v_entry jsonb;
  v_antes jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cdb_apply_operator_mutation: actor obrigatorio (auditoria)';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_apply_operator_mutation: client_ref obrigatorio (idempotencia)';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'cdb_apply_operator_mutation: payload precisa ser objeto';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'cdb_apply_operator_mutation: estado do cdb2026 inexistente';
  end if;

  -- IDEMPOTENCIA: a mesma operacao reenviada (clique duplo, retry) nao se aplica duas vezes.
  if exists (select 1 from jsonb_array_elements(coalesce(v_state->'auditLog','[]'::jsonb)) a
              where a->>'clientRef' = p_client_ref) then
    return jsonb_build_object('applied', false, 'reason', 'idempotente');
  end if;

  v_antes := v_state;

  -- ── despacho por tipo ─────────────────────────────────────────────────
  if p_type = 'set-payment' then
    if p_payload->>'entryId' is null then
      raise exception 'set-payment: entryId obrigatorio';
    end if;
    if jsonb_typeof(p_payload->'value') <> 'boolean' then
      raise exception 'set-payment: value precisa ser booleano';
    end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
                    where e->>'id' = p_payload->>'entryId') then
      raise exception 'set-payment: entrada % inexistente', p_payload->>'entryId';
    end if;
    v_state := jsonb_set(v_state, array['paid', p_payload->>'entryId'], p_payload->'value');

  elsif p_type = 'delete-entry' then
    if p_payload->>'entryId' is null then
      raise exception 'delete-entry: entryId obrigatorio';
    end if;
    -- Lapide, nunca remocao fisica: a entrada some da UI e continua auditavel.
    v_state := jsonb_set(v_state, '{deletedIds}',
                 (select jsonb_agg(distinct x) from (
                    select jsonb_array_elements_text(coalesce(v_state->'deletedIds','[]'::jsonb)) as x
                    union select p_payload->>'entryId') u));

  elsif p_type = 'set-cutoff' then
    v_fase := p_payload->>'phaseId';
    if v_fase is null or v_state->'phases'->v_fase is null then
      raise exception 'set-cutoff: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if p_payload->>'cutoffAt' is not null then
      perform (p_payload->>'cutoffAt')::timestamptz;   -- levanta se nao for instante valido
    end if;
    v_state := jsonb_set(v_state, array['phases', v_fase, 'cutoffAt'],
                 coalesce(p_payload->'cutoffAt', 'null'::jsonb));

  elsif p_type = 'set-active-phase' then
    v_fase := p_payload->>'phaseId';
    if v_fase is not null and v_state->'phases'->v_fase is null then
      raise exception 'set-active-phase: fase % inexistente', v_fase;
    end if;
    v_state := jsonb_set(v_state, '{activePhase}', coalesce(p_payload->'phaseId','null'::jsonb));

  elsif p_type in ('lock-tie','unlock-tie') then
    v_fase := p_payload->>'phaseId'; v_tie := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception '%: confronto %/% inexistente', p_type, v_fase, v_tie;
    end if;
    if p_type = 'lock-tie' then
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        v_state->'phases'->v_fase->'ties'->v_tie
        || jsonb_build_object('locked', true, 'lockedAt', v_iso,
                              'lockedBy', p_actor,
                              'qualifiedTeamId', p_payload->'qualifiedTeamId'));
    else
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        (v_state->'phases'->v_fase->'ties'->v_tie - 'locked' - 'lockedAt' - 'lockedBy'));
    end if;

  elsif p_type = 'remove-tie' then
    v_fase := p_payload->>'phaseId'; v_tie := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'remove-tie: confronto %/% inexistente', v_fase, v_tie;
    end if;
    -- Confronto travado guarda resultado oficial: destravar e um ato deliberado e separado.
    if coalesce((v_state->'phases'->v_fase->'ties'->v_tie->>'locked')::boolean,false) then
      raise exception 'remove-tie: confronto %/% esta travado; destrave primeiro', v_fase, v_tie;
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties'],
                 (v_state->'phases'->v_fase->'ties') - v_tie);

  else
    -- Tipo desconhecido NUNCA e aplicado em silencio.
    raise exception 'cdb_apply_operator_mutation: tipo nao suportado: %', p_type;
  end if;

  -- ── auditoria ─────────────────────────────────────────────────────────
  v_state := jsonb_set(v_state, '{auditLog}',
    coalesce(v_state->'auditLog','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'type', p_type, 'actor', p_actor, 'at', v_iso,
      'clientRef', p_client_ref, 'payload', p_payload, 'source', 'server-rpc')));

  update bolao_state set state = v_state, updated_at = v_agora where id = 'cdb2026';

  return jsonb_build_object('applied', true, 'type', p_type,
    'auditLogSize', jsonb_array_length(v_state->'auditLog'));
end $$;

--
-- Name: cdb_update_entry_picks("text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."cdb_update_entry_picks"("p_entry_id" "text", "p_client_ref" "text", "p_picks" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_state jsonb;
  v_idx int;
  v_entry jsonb;
  v_cutoff timestamptz;
  v_fase text;
  v_agora timestamptz := now();
begin
  -- ── validacao de entrada ──────────────────────────────────────────────
  if p_entry_id is null or length(trim(p_entry_id)) = 0 then
    raise exception 'cdb_update_entry_picks: entry_id obrigatorio';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_update_entry_picks: client_ref obrigatorio (idempotencia)';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_update_entry_picks: picks precisa ser objeto';
  end if;
  -- Teto de tamanho: o palpite e um mapa pequeno de fase->escolha. Qualquer coisa muito maior
  -- e uso indevido, e o estado inteiro do bolao vive numa unica linha jsonb.
  if length(p_picks::text) > 20000 then
    raise exception 'cdb_update_entry_picks: picks grande demais';
  end if;

  -- Bloqueia a linha: duas abas do mesmo participante, ou participante e operador ao mesmo
  -- tempo, nao podem intercalar leitura e escrita sobre o mesmo documento.
  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'cdb_update_entry_picks: estado do cdb2026 inexistente';
  end if;

  -- ── a entrada tem de existir e nao estar removida ─────────────────────
  select ord - 1, e into v_idx, v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
   where e->>'id' = p_entry_id
   limit 1;

  if v_entry is null then
    raise exception 'ENTRY_NOT_FOUND: nenhuma entrada com id %', p_entry_id;
  end if;
  if coalesce(v_state->'deletedIds','[]'::jsonb) ? p_entry_id then
    raise exception 'ENTRY_REMOVED: entrada % foi removida', p_entry_id;
  end if;

  -- ── IDEMPOTENCIA ──────────────────────────────────────────────────────
  -- Clique duplo, retry de rede e reenvio de formulario sao a MESMA edicao. Repetir com o mesmo
  -- client_ref nao e uma segunda edicao.
  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente', 'entryId', p_entry_id);
  end if;

  -- ── CUTOFF, por fase, falha fechada ───────────────────────────────────
  -- Cada fase tem seu proprio cutoffAt. Um palpite so pode mudar enquanto a fase dele estiver
  -- aberta. Cutoff ilegivel bloqueia em vez de liberar: nao saber se ja fechou nao e permissao.
  for v_fase in select jsonb_object_keys(p_picks) loop
    begin
      v_cutoff := nullif(v_state->'phases'->v_fase->>'cutoffAt','')::timestamptz;
    exception when others then
      raise exception 'CUTOFF_ILEGIVEL: fase % tem cutoffAt invalido', v_fase;
    end;
    if v_cutoff is not null and v_agora > v_cutoff then
      -- So bloqueia se o palpite daquela fase MUDOU. Reenviar identico e inofensivo.
      if coalesce(v_entry->'picks'->v_fase, 'null'::jsonb) is distinct from coalesce(p_picks->v_fase, 'null'::jsonb) then
        raise exception 'CUTOFF_PASSADO: fase % fechou em %', v_fase, v_cutoff;
      end if;
    end if;
  end loop;

  -- ── a mutacao, estreita ───────────────────────────────────────────────
  -- Só `picks`, `updatedAt` e `lastClientRef`. Todo o resto da entrada vem do registro que ja
  -- estava la: nome, e-mail, pagador e metodo de pagamento nao sao regravaveis por esta via.
  v_entry := v_entry
    || jsonb_build_object('picks', p_picks)
    || jsonb_build_object('updatedAt', to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || jsonb_build_object('lastClientRef', p_client_ref);

  update bolao_state
     set state = jsonb_set(state, array['entries', v_idx::text], v_entry),
         updated_at = v_agora
   where id = 'cdb2026';

  return jsonb_build_object('updated', true, 'entryId', p_entry_id);
end $$;

--
-- Name: claim_bolao_notif("text", "text", integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."claim_bolao_notif"("p_pool_id" "text", "p_worker" "text", "p_limit" integer DEFAULT 10, "p_lease_seconds" integer DEFAULT 300) RETURNS TABLE("job_id" "uuid", "entity_id" "text", "event_type" "text", "event_version" integer, "entry_ref" "text", "template_id" "text", "template_version" integer, "payload_snapshot" "jsonb", "idempotency_key" "text", "attempt_count" integer, "max_attempts" integer, "schema_version" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  with eligible as (
    select j.job_id from bolao_notif_jobs j
    where j.pool_id = p_pool_id
      and j.status in ('pending', 'failed_retryable')
      and j.next_attempt_at <= now()
      and j.attempt_count < j.max_attempts
      -- Job que aguarda decisao humana nunca e reivindicado automaticamente, nem de passagem.
      and coalesce((j.payload_snapshot->>'requiresManualAction')::boolean, false) = false
    order by j.next_attempt_at
    limit greatest(coalesce(p_limit, 10), 1)
    for update skip locked
  )
  update bolao_notif_jobs j
     set status = 'processing',
         claimed_at = now(),
         claimed_by = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)),
         attempt_count = j.attempt_count + 1,
         last_attempt_at = now()
   where j.job_id in (select e.job_id from eligible e)
  returning j.job_id, j.entity_id, j.event_type, j.event_version, j.entry_ref,
            j.template_id, j.template_version, j.payload_snapshot,
            j.idempotency_key, j.attempt_count, j.max_attempts, j.schema_version;
end $$;

--
-- Name: delete_canary_job("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."delete_canary_job"("p_idempotency_key" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_n integer;
begin
  -- SO jobs sinteticos. Um erro de digitacao aqui nao pode apagar notificacao real.
  if p_idempotency_key not like '\_\_canary\_\_:%' and p_idempotency_key not like '\_\_test\_\_%' then
    raise exception 'delete_canary_job: chave nao sintetica: %', p_idempotency_key;
  end if;
  delete from bolao_notif_jobs where idempotency_key = p_idempotency_key;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

--
-- Name: enqueue_bolao_notif("text", "text", "text", integer, "text", "text", "jsonb", "text", integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."enqueue_bolao_notif"("p_pool_id" "text", "p_entity_id" "text", "p_event_type" "text", "p_event_version" integer, "p_entry_ref" "text", "p_idempotency_key" "text", "p_payload" "jsonb" DEFAULT '{}'::"jsonb", "p_template_id" "text" DEFAULT 'default'::"text", "p_template_version" integer DEFAULT 1, "p_max_attempts" integer DEFAULT 5, "p_schema_version" integer DEFAULT 1) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_id uuid;
begin
  if p_pool_id is null or p_entity_id is null or p_entry_ref is null or p_idempotency_key is null then
    raise exception 'enqueue_bolao_notif: argumentos obrigatorios ausentes';
  end if;
  insert into bolao_notif_jobs (
    pool_id, entity_id, event_type, event_version, entry_ref, idempotency_key,
    payload_snapshot, template_id, template_version, max_attempts, schema_version
  ) values (
    p_pool_id, p_entity_id, p_event_type, coalesce(p_event_version, 1), p_entry_ref,
    p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_template_id,
    coalesce(p_template_version, 1), coalesce(p_max_attempts, 5), coalesce(p_schema_version, 1)
  )
  on conflict (idempotency_key) do nothing
  returning job_id into v_id;

  if v_id is null then
    select job_id into v_id from bolao_notif_jobs where idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end $$;

--
-- Name: get_bolao_notif_content_hash("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_bolao_notif_content_hash"("p_idempotency_key" "text") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select payload_snapshot->>'contentHash'
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
$$;

--
-- Name: get_bolao_notif_manual_flag("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_bolao_notif_manual_flag"("p_idempotency_key" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((payload_snapshot->>'requiresManualAction')::boolean, false)
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
$$;

--
-- Name: get_bolao_notif_recipients("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."get_bolao_notif_recipients"("p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(payload_snapshot->'recipients', '[]'::jsonb)
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
$$;

--
-- Name: mark_bolao_notif_permanent("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."mark_bolao_notif_permanent"("p_job_id" "uuid", "p_error" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update bolao_notif_jobs
     set status = 'failed_permanent', last_error = left(coalesce(p_error, ''), 2000),
         claimed_by = null, lease_expires_at = null
   where job_id = p_job_id;
  return found;
end $$;

--
-- Name: mark_bolao_notif_retryable("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."mark_bolao_notif_retryable"("p_job_id" "uuid", "p_error" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_attempts integer; v_max integer;
begin
  select attempt_count, max_attempts into v_attempts, v_max
    from bolao_notif_jobs where job_id = p_job_id and status = 'processing';
  if v_attempts is null then return false; end if;

  update bolao_notif_jobs
     set status = case when v_attempts >= v_max then 'failed_permanent' else 'failed_retryable' end,
         last_error = left(coalesce(p_error, ''), 2000),
         next_attempt_at = now() + make_interval(mins => least(power(2, v_attempts)::int, 60)),
         claimed_by = null, lease_expires_at = null
   where job_id = p_job_id;
  return true;
end $$;

--
-- Name: mark_bolao_notif_sent("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."mark_bolao_notif_sent"("p_job_id" "uuid", "p_provider_message_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update bolao_notif_jobs
     set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id,
         claimed_by = null, lease_expires_at = null, last_error = null
   where job_id = p_job_id and status = 'processing';
  return found;
end $$;

--
-- Name: op_confirm_payment("text", "text", boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."op_confirm_payment"("p_pool_id" "text", "p_entry_ref" "text", "p_paid" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

--
-- Name: op_remove_entry("text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."op_remove_entry"("p_pool_id" "text", "p_entry_ref" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

--
-- Name: op_set_phases("text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."op_set_phases"("p_pool_id" "text", "p_phases" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

--
-- Name: op_set_results("text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."op_set_results"("p_pool_id" "text", "p_results" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

--
-- Name: op_set_round_email("text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."op_set_round_email"("p_pool_id" "text", "p_round_email" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_state jsonb;
begin
  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then raise exception 'op_set_round_email: estado inexistente'; end if;
  v_state := jsonb_set(v_state, '{roundEmail}', coalesce(p_round_email,'{}'::jsonb), true);
  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('ok', true);
end $$;

--
-- Name: op_update_entry("text", "text", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."op_update_entry"("p_pool_id" "text", "p_entry_ref" "text", "p_entry_name" "text" DEFAULT NULL::"text", "p_participant_email" "text" DEFAULT NULL::"text", "p_payer_name" "text" DEFAULT NULL::"text", "p_payment_method" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
end $_$;

--
-- Name: release_expired_bolao_notif("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."release_expired_bolao_notif"("p_pool_id" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_count integer;
begin
  with released as (
    update bolao_notif_jobs
       set status = (case when attempt_count >= max_attempts
                          then 'failed_permanent'
                          else 'failed_retryable' end)::bolao_notif_status,
           claimed_by = null, lease_expires_at = null,
           last_error = coalesce(last_error, 'lease expirado: runner/processo terminou sem finalizar')
     where pool_id = p_pool_id and status = 'processing'
       and lease_expires_at is not null and lease_expires_at < now()
    returning 1
  )
  select count(*) into v_count from released;
  return coalesce(v_count, 0);
end $$;

--
-- Name: resolve_notification_recipients("text", "text"[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."resolve_notification_recipients"("p_pool_id" "text", "p_entry_refs" "text"[]) RETURNS TABLE("entry_ref" "text", "participant_email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.entry_ref, p.participant_email
  from bolao_entry_private p
  where p.pool_id = p_pool_id
    and p.entry_ref = any(p_entry_refs)
    and p.participant_email is not null;
$$;

--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

--
-- Name: set_bolao_notif_recipient("text", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."set_bolao_notif_recipient"("p_idempotency_key" "text", "p_entry_ref" "text", "p_state" "text", "p_provider_message_id" "text" DEFAULT NULL::"text", "p_error" "text" DEFAULT NULL::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_n integer;
begin
  if p_entry_ref is null or p_entry_ref = '' then
    raise exception 'set_bolao_notif_recipient: entry_ref obrigatorio';
  end if;
  -- Referencia opaca: endereco de e-mail nunca entra no ledger.
  if position('@' in p_entry_ref) > 0 then
    raise exception 'set_bolao_notif_recipient: entry_ref nao pode ser um endereco';
  end if;
  if p_state not in ('PENDING','SENDING','ACCEPTED','FAILED','UNCERTAIN') then
    raise exception 'set_bolao_notif_recipient: estado invalido %', p_state;
  end if;

  update bolao_notif_jobs
     set payload_snapshot = jsonb_set(
           payload_snapshot, '{recipients}',
           (select coalesce(jsonb_agg(
                     case when r->>'entryRef' = p_entry_ref
                          then r || jsonb_build_object(
                                 'state', p_state,
                                 'providerMessageId', p_provider_message_id,
                                 'lastError', left(coalesce(p_error, ''), 120))
                          else r end order by ord), '[]'::jsonb)
              from jsonb_array_elements(payload_snapshot->'recipients') with ordinality as t(r, ord)))
   where idempotency_key = p_idempotency_key;

  get diagnostics v_n = row_count;
  -- 0 linhas NAO e sucesso silencioso. O PostgREST devolve 204 tanto para "gravou" quanto para
  -- "nao casou nada" -- ambiguidade que ja causou um incidente neste repo.
  if v_n = 0 then
    raise exception 'set_bolao_notif_recipient: nenhum job com a chave %', p_idempotency_key;
  end if;
  return v_n;
end $$;

--
-- Name: settle_bolao_notif("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."settle_bolao_notif"("p_idempotency_key" "text") RETURNS TABLE("status" "text", "accepted" integer, "total" integer, "uncertain" integer, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_recs jsonb; v_total integer; v_ok integer; v_unc integer;
  v_status text; v_reason text;
begin
  select coalesce(payload_snapshot->'recipients', '[]'::jsonb) into v_recs
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
  if v_recs is null then
    raise exception 'settle_bolao_notif: nenhum job com a chave %', p_idempotency_key;
  end if;

  select count(*)::integer into v_total from jsonb_array_elements(v_recs);
  select count(*)::integer into v_ok from jsonb_array_elements(v_recs) e
   where e.value->>'state' = 'ACCEPTED';
  select count(*)::integer into v_unc from jsonb_array_elements(v_recs) e
   where e.value->>'state' = 'UNCERTAIN';

  if v_unc > 0 then
    -- Desfecho desconhecido nunca se resolve sozinho: reenviar duplicaria para quem ja recebeu.
    v_status := 'failed_permanent';
    v_reason := 'NOTIFICATION_UNCERTAIN: requer revisao humana';
  elsif v_total > 0 and v_ok = v_total then
    v_status := 'sent';
  elsif v_ok > 0 then
    -- Parcial JAMAIS vira concluido. Foi 14 de 15 em 08/08.
    v_status := 'failed_retryable';
    v_reason := 'PARTIAL: nem todos aceitos';
  else
    v_status := 'failed_retryable';
    v_reason := 'nenhum destinatario aceito';
  end if;

  update bolao_notif_jobs
     set status = v_status::bolao_notif_status,
         sent_at = case when v_status = 'sent' then now() else sent_at end,
         last_error = v_reason, claimed_by = null, lease_expires_at = null
   where idempotency_key = p_idempotency_key;

  return query select v_status, v_ok, v_total, v_unc, v_reason;
end $$;

--
-- Name: submit_entry("text", "text", "text", "jsonb", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."submit_entry"("p_pool_id" "text", "p_entry_name" "text", "p_participant_email" "text", "p_picks" "jsonb", "p_payer_name" "text" DEFAULT NULL::"text", "p_payment_method" "text" DEFAULT NULL::"text", "p_client_ref" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
end $_$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: bolao_entry_private; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bolao_entry_private" (
    "pool_id" "text" NOT NULL,
    "entry_ref" "text" NOT NULL,
    "participant_email" "text",
    "payer_name" "text",
    "payment_method" "text",
    "payment_to" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: bolao_notif_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bolao_notif_jobs" (
    "job_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pool_id" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_version" integer DEFAULT 1 NOT NULL,
    "entry_ref" "text" NOT NULL,
    "template_id" "text" DEFAULT 'default'::"text" NOT NULL,
    "template_version" integer DEFAULT 1 NOT NULL,
    "payload_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "schema_version" integer DEFAULT 1 NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "status" "public"."bolao_notif_status" DEFAULT 'pending'::"public"."bolao_notif_status" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claimed_at" timestamp with time zone,
    "claimed_by" "text",
    "lease_expires_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "provider_message_id" "text",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: bolao_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."bolao_state" (
    "id" "text" NOT NULL,
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: live_sports_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."live_sports_cache" (
    "competition" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "observed_at" timestamp with time zone NOT NULL,
    "stored_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

--
-- Name: TABLE "live_sports_cache"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE "public"."live_sports_cache" IS 'Cache compartilhado do gateway de dados ao vivo (Edge Function live-football). Somente dado esportivo publico da ESPN. Nunca contem dado de participante.';

--
-- Name: bolao_entry_private bolao_entry_private_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bolao_entry_private"
    ADD CONSTRAINT "bolao_entry_private_pkey" PRIMARY KEY ("pool_id", "entry_ref");

--
-- Name: bolao_notif_jobs bolao_notif_jobs_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bolao_notif_jobs"
    ADD CONSTRAINT "bolao_notif_jobs_idempotency_unique" UNIQUE ("idempotency_key");

--
-- Name: bolao_notif_jobs bolao_notif_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bolao_notif_jobs"
    ADD CONSTRAINT "bolao_notif_jobs_pkey" PRIMARY KEY ("job_id");

--
-- Name: bolao_state bolao_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."bolao_state"
    ADD CONSTRAINT "bolao_state_pkey" PRIMARY KEY ("id");

--
-- Name: live_sports_cache live_sports_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."live_sports_cache"
    ADD CONSTRAINT "live_sports_cache_pkey" PRIMARY KEY ("competition");

--
-- Name: bolao_entry_private_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bolao_entry_private_pool" ON "public"."bolao_entry_private" USING "btree" ("pool_id");

--
-- Name: bolao_notif_jobs_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bolao_notif_jobs_claimable" ON "public"."bolao_notif_jobs" USING "btree" ("pool_id", "status", "next_attempt_at") WHERE ("status" = ANY (ARRAY['pending'::"public"."bolao_notif_status", 'failed_retryable'::"public"."bolao_notif_status"]));

--
-- Name: bolao_notif_jobs_expired_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bolao_notif_jobs_expired_lease" ON "public"."bolao_notif_jobs" USING "btree" ("status", "lease_expires_at") WHERE ("status" = 'processing'::"public"."bolao_notif_status");

--
-- Name: ensure_rls; Type: EVENT TRIGGER; Schema: -; Owner: -
--
-- Database-global, so it is absent from a schema-scoped pg_dump. Measured directly from
-- pg_event_trigger: the only app-owned event trigger; the other six are provider-managed
-- (owner supabase_admin, handler functions in extensions.*) and are deliberately NOT
-- declared here — the repo does not own Supabase's platform triggers.
--
CREATE EVENT TRIGGER "ensure_rls" ON "ddl_command_end"
   WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
   EXECUTE FUNCTION "public"."rls_auto_enable"();
