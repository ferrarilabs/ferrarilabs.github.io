-- 20260812090000_m8m9_trusted_producer_bridge.sql
--
-- ═══ O PROBLEMA MEDIDO, NÃO SUPOSTO ══════════════════════════════════════════════════════════
--
-- M8 (audit.audit_events) e M9 (bolao.outbox_events) existem em produção desde 2026-08-12. Medido
-- pelo probe (bolao/scripts/audit_outbox_probe.py), com a chave de service_role:
--
--     GET  /rest/v1/outbox_events  (Accept-Profile: bolao)  -> 406  "Invalid schema: bolao"
--     GET  /rest/v1/audit_events   (Accept-Profile: audit)  -> 406  "Invalid schema: audit"
--
-- Os schemas `bolao` e `audit` NÃO estão expostos no PostgREST. Isso não é defeito: é o que torna
-- a forja anônima estruturalmente impossível — o probe mediu 9 ataques de anon (inserir auditoria,
-- apagar, alterar, ler, inserir notificação, marcar SENT, tomar lease, apagar, ler) e os 9 param
-- em 406, antes de qualquer verificação de RLS ou GRANT. Negado por não existir alcance é mais
-- forte que negado por policy.
--
-- Mas o produtor CONFIÁVEL também não alcança. Sem uma ponte, M8/M9 permanecem infraestrutura sem
-- integração — que é exatamente a lacuna a fechar.
--
-- ═══ POR QUE RPC EM `public` E NÃO EXPOR OS SCHEMAS ══════════════════════════════════════════
--
-- Expor `bolao` e `audit` no PostgREST resolveria o alcance do produtor E devolveria à anon uma
-- superfície de ataque que hoje não existe. Ela passaria a ser barrada por GRANT/RLS em vez de por
-- inexistência — mais fraco, e dependente de nunca alguém adicionar uma policy permissiva.
--
-- Estas funções são SECURITY DEFINER, vivem em `public` (o único schema exposto), e são REVOGADAS
-- de anon/authenticated e concedidas SOMENTE a service_role. A anon continua sem alcance nenhum:
-- as tabelas seguem invisíveis, e a porta nova é fechada para ela.
--
-- ATENÇÃO A QUEM MEXER AQUI: função SECURITY DEFINER em `public` é chamável pelo PostgREST. O
-- REVOKE abaixo é o que separa "ponte para o produtor confiável" de "endpoint público de forja de
-- auditoria". test_m8m9_security.py mede isso contra produção com a chave anon real.
--
-- `search_path` está fixado em todas: SECURITY DEFINER sem search_path fixo é sequestrável por
-- um schema que o chamador controle.
--
-- ═══ MÁQUINA DE ESTADOS ══════════════════════════════════════════════════════════════════════
--
-- Reproduz scripts/db/outbox.mjs (worktree db-modernization), que é a definição canônica:
--
--   pending ──lease──▶ in_flight ──success──▶ sent            (terminal)
--                          ├─transient_failure─▶ pending      (backoff, attempt_count++)
--                          ├─permanent_failure─▶ dead
--                          └─lease_expired─────▶ pending
--
-- MAX_ATTEMPTS = 6 e backoff = min(2^attempt, 3600)s vêm de lá. Não são reinventados aqui: se
-- divergirem, o teste de paridade (test_m8m9_outbox.py) reprova.
--
-- ROLLBACK: `drop function` das cinco. Nada de dado é perdido — as tabelas não são tocadas.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- AUDITORIA
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- Chave de negócio (texto: "2026-08-12", "quartas", "R22") -> uuid determinístico e opaco.
-- Determinístico para o mesmo evento sempre apontar ao mesmo agregado; opaco porque `aggregate_id`
-- é indexado e legível por quem lê a auditoria, e nenhuma chave de negócio nossa precisa ser
-- reconstruível a partir dali.
create or replace function public.business_key_to_uuid(p_key text)
  returns uuid
  language sql
  immutable
  set search_path = pg_catalog, public, pg_temp
as $$
  select md5(coalesce(p_key, ''))::uuid;
$$;

create or replace function public.emit_audit_event(
  p_action         text,
  p_aggregate_type text,
  p_aggregate_key  text default null,
  p_source         text default 'github_actions',
  p_safe_metadata  jsonb default '{}'::jsonb,
  p_correlation_id uuid default null,
  p_reason         text default null,
  p_actor_role     text default 'automation'
)
  returns uuid
  language plpgsql
  security definer
  set search_path = pg_catalog, public, audit, pg_temp
as $$
declare
  v_id uuid;
begin
  -- `ae_action_shape` exige '^[a-z_]+\.[a-z_]+$'. Falhar aqui com mensagem própria é melhor que
  -- devolver violação de CHECK crua para um script que só queria registrar um evento.
  if p_action !~ '^[a-z_]+\.[a-z_]+$' then
    raise exception 'ACAO_INVALIDA: % (esperado minusculas.com_ponto, ex: draw.opened)', p_action;
  end if;

  -- event_hash é NOT NULL mas o trigger BEFORE INSERT o calcula e sobrescreve; passar '' aqui só
  -- satisfaz o parser. actor_user_id fica NULL: automação não é usuário do auth.users, e a FK é
  -- ON DELETE RESTRICT — inventar um id seria criar dependência falsa.
  insert into audit.audit_events (
    actor_user_id, actor_role, action, aggregate_type, aggregate_id,
    correlation_id, source, safe_metadata, reason, event_hash
  ) values (
    null, p_actor_role, p_action, p_aggregate_type,
    case when p_aggregate_key is null then null else public.business_key_to_uuid(p_aggregate_key) end,
    p_correlation_id, p_source, coalesce(p_safe_metadata, '{}'::jsonb), p_reason, ''
  )
  returning audit_event_id into v_id;

  return v_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- OUTBOX — produtor
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- Idempotente por construção: `outbox_events_idempotency_key_key` é UNIQUE, e o ON CONFLICT DO
-- NOTHING transforma produtor chamado duas vezes em no-op. `created` diz ao chamador qual dos dois
-- aconteceu, porque "já existia" e "criei agora" levam a decisões diferentes na auditoria.
create or replace function public.emit_outbox_event(
  p_idempotency_key text,
  p_event_type      text,
  p_payload         jsonb,
  p_channel         text default 'email',
  p_correlation_id  uuid default null
)
  returns table (outbox_event_id uuid, created boolean)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into bolao.outbox_events (idempotency_key, channel, event_type, payload, correlation_id)
  values (p_idempotency_key, p_channel::bolao.outbox_channel, p_event_type,
          coalesce(p_payload, '{}'::jsonb), p_correlation_id)
  on conflict (idempotency_key) do nothing
  returning bolao.outbox_events.outbox_event_id into v_id;

  if v_id is not null then
    return query select v_id, true;
  else
    return query
      select e.outbox_event_id, false
        from bolao.outbox_events e
       where e.idempotency_key = p_idempotency_key;
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- OUTBOX — consumidor
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- Reivindicação ATÔMICA. `for update skip locked` é o que permite dois consumidores em paralelo
-- sem que os dois peguem a mesma linha: o segundo pula a linha travada em vez de esperar por ela.
-- Sem `skip locked` o segundo bloquearia e depois processaria o MESMO evento.
create or replace function public.claim_outbox_event(
  p_lease_owner   text,
  p_lease_seconds integer default 300,
  p_event_type    text default null
)
  returns table (outbox_event_id uuid, idempotency_key text, event_type text,
                 payload jsonb, attempt_count integer, correlation_id uuid)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
begin
  return query
  with alvo as (
    select e.outbox_event_id
      from bolao.outbox_events e
     where e.status = 'pending'
       and (e.next_attempt_at is null or e.next_attempt_at <= now())
       and (p_event_type is null or e.event_type = p_event_type)
     order by e.created_at
     limit 1
       for update skip locked
  )
  update bolao.outbox_events e
     set status           = 'in_flight',
         lease_owner      = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    from alvo
   where e.outbox_event_id = alvo.outbox_event_id
  returning e.outbox_event_id, e.idempotency_key, e.event_type,
            e.payload, e.attempt_count, e.correlation_id;
end;
$$;

-- Lease vencido volta para a fila. Um worker que morreu entre reivindicar e liquidar deixaria a
-- linha presa em in_flight para sempre; esta função é o que impede que "o processo caiu" vire
-- "a notificação nunca mais sai".
create or replace function public.recover_expired_outbox_leases()
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_n integer;
begin
  update bolao.outbox_events
     set status = 'pending', lease_owner = null, lease_expires_at = null
   where status = 'in_flight'
     and lease_expires_at is not null
     and lease_expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Liquidação. A transição é decidida AQUI, no banco, e não pelo chamador: um consumidor que
-- calcule o próximo estado sozinho pode calcular errado, e a tabela aceitaria.
--
-- MAX_ATTEMPTS = 6 e backoff = min(2^attempt, 3600)s espelham scripts/db/outbox.mjs.
create or replace function public.settle_outbox_event(
  p_outbox_event_id     uuid,
  p_outcome             text,
  p_provider_message_id text default null,
  p_failure_category    text default null
)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_status    bolao.outbox_status;
  v_attempts  integer;
  v_novo      bolao.outbox_status;
  v_backoff   integer;
  MAX_ATTEMPTS constant integer := 6;
begin
  select status, attempt_count into v_status, v_attempts
    from bolao.outbox_events
   where outbox_event_id = p_outbox_event_id
     for update;

  if not found then
    raise exception 'EVENTO_INEXISTENTE: %', p_outbox_event_id;
  end if;

  -- Liquidar o que não está in_flight é sintoma de duas execuções em cima do mesmo evento, ou de
  -- lease recuperado no meio. Recusar é o comportamento seguro: a segunda liquidação não pode
  -- sobrescrever a primeira.
  if v_status <> 'in_flight' then
    raise exception 'TRANSICAO_ILEGAL: evento em % nao pode ser liquidado (esperado in_flight)', v_status;
  end if;

  v_attempts := v_attempts + 1;

  if p_outcome = 'success' then
    v_novo := 'sent';
  elsif p_outcome = 'permanent_failure' then
    v_novo := 'dead';
  elsif p_outcome = 'transient_failure' then
    v_novo := case when v_attempts >= MAX_ATTEMPTS then 'dead' else 'pending' end;
  else
    raise exception 'DESFECHO_INVALIDO: % (esperado success|transient_failure|permanent_failure)', p_outcome;
  end if;

  v_backoff := least(power(2, v_attempts)::integer, 3600);

  update bolao.outbox_events
     set status          = v_novo,
         attempt_count   = v_attempts,
         lease_owner     = null,
         lease_expires_at = null,
         dead_at         = case when v_novo = 'dead' then now() else null end,
         next_attempt_at = case when v_novo = 'pending'
                                then now() + make_interval(secs => v_backoff) end
   where outbox_event_id = p_outbox_event_id;

  insert into bolao.outbox_delivery_attempts (
    outbox_event_id, attempt_number, finished_at, outcome, failure_category, provider_message_id
  ) values (
    p_outbox_event_id, v_attempts, now(), p_outcome::bolao.delivery_outcome,
    p_failure_category, p_provider_message_id
  );

  return v_novo::text;
end;
$$;

-- Leitura de estado para os testes e para a observabilidade. NÃO devolve payload: o payload pode
-- carregar destinatários, e quem só quer saber o estado não precisa vê-los.
create or replace function public.outbox_event_status(p_idempotency_key text)
  returns table (status text, attempt_count integer, dead_at timestamptz)
  language sql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
  select e.status::text, e.attempt_count, e.dead_at
    from bolao.outbox_events e
   where e.idempotency_key = p_idempotency_key;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ACL — a parte que separa ponte de buraco
-- ════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.emit_audit_event(text,text,text,text,jsonb,uuid,text,text)',
    'public.emit_outbox_event(text,text,jsonb,text,uuid)',
    'public.claim_outbox_event(text,integer,text)',
    'public.recover_expired_outbox_leases()',
    'public.settle_outbox_event(uuid,text,text,text)',
    'public.outbox_event_status(text)',
    'public.business_key_to_uuid(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

select 'ponte M8/M9 criada; anon revogada; service_role concedida' as resultado;
