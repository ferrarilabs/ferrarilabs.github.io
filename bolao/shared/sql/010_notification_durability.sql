-- 010_notification_durability.sql
-- Batch 1 — persistência durável e SEGURA da fila de notificações.
--
-- POR QUE EXISTE: o outbox do Batch 1 persiste num ARQUIVO JSON em disco. Num runner do GitHub
-- Actions o sistema de arquivos é EFÊMERO — não sobrevive entre execuções. Então retry, catch-up e
-- idempotência não são duráveis em CI, que é exatamente onde o cron roda.
--
-- POR QUE NÃO REAPROVEITAR 001_/002_ (REJEITADOS): eles concedem
--     create policy ... for select to anon using (true)
-- numa tabela cuja coluna `recipient` o próprio schema rotula como PII. A anon key é pública por
-- construção (vai no js/config.js servido a todo navegador), então qualquer pessoa poderia enumerar
-- o e-mail de todos os participantes.
--
-- O QUE MUDA AQUI:
--   1. A tabela NÃO tem coluna de e-mail. Guarda `entry_ref` — o id opaco da entrada. O endereço
--      real é resolvido só no momento do envio, pelo executor confiável.
--   2. `anon` NÃO recebe policy nenhuma nesta tabela. Com RLS habilitada e zero policies, todo
--      acesso direto de `anon` é negado, inclusive SELECT. Isso é o ponto central da migração.
--   3. Nenhuma RPC devolve e-mail — não existe e-mail aqui para devolver.
--
-- ADITIVA E NÃO DESTRUTIVA: só `create ... if not exists` / `create or replace function`. Nenhuma
-- tabela, coluna ou policy existente é alterada. `bolao_state` não é tocada.
--
-- LIMITAÇÃO REGISTRADA: as RPCs são chamáveis por `anon`, como todo o resto da plataforma hoje.
-- Elas não vazam PII (não há PII na tabela), mas um chamador hostil poderia reivindicar jobs para
-- atrapalhar a fila. O dano é limitado pela expiração de lease. Fechar isso exige identidade de
-- chamador — parte do programa de modernização do banco (HA-1), não desta feature.
--
-- ROLLBACK: ver o rodapé.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'bolao_notif_status') then
    create type bolao_notif_status as enum (
      'pending', 'processing', 'sent', 'failed_retryable', 'failed_permanent', 'suppressed'
    );
  end if;
end $$;

create table if not exists bolao_notif_jobs (
  job_id              uuid primary key default gen_random_uuid(),
  pool_id             text not null,
  entity_id           text not null,
  event_type          text not null,
  event_version       integer not null default 1,

  -- REFERÊNCIA OPACA, NÃO ENDEREÇO. Nunca adicionar coluna de e-mail/telefone aqui: quebraria a
  -- premissa de segurança desta feature.
  entry_ref           text not null,

  template_id         text not null default 'default',
  template_version    integer not null default 1,
  payload_snapshot    jsonb not null default '{}'::jsonb,   -- congelado no enqueue; retry não recalcula
  schema_version      integer not null default 1,

  idempotency_key     text not null,                        -- idempotência DURÁVEL

  status              bolao_notif_status not null default 'pending',
  attempt_count       integer not null default 0,
  max_attempts        integer not null default 5,
  next_attempt_at     timestamptz not null default now(),

  claimed_at          timestamptz,
  claimed_by          text,
  lease_expires_at    timestamptz,

  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),

  constraint bolao_notif_jobs_idempotency_unique unique (idempotency_key)
);

create index if not exists bolao_notif_jobs_claimable
  on bolao_notif_jobs (pool_id, status, next_attempt_at)
  where status in ('pending', 'failed_retryable');

create index if not exists bolao_notif_jobs_expired_lease
  on bolao_notif_jobs (status, lease_expires_at)
  where status = 'processing';

alter table bolao_notif_jobs enable row level security;
-- NENHUMA policy para `anon`. Deliberado. Não escrever `create policy ... to anon` aqui NUNCA.

create or replace function enqueue_bolao_notif(
  p_pool_id text, p_entity_id text, p_event_type text, p_event_version integer,
  p_entry_ref text, p_idempotency_key text, p_payload jsonb default '{}'::jsonb,
  p_template_id text default 'default', p_template_version integer default 1,
  p_max_attempts integer default 5, p_schema_version integer default 1
) returns uuid
language plpgsql security definer set search_path = public as $$
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

create or replace function claim_bolao_notif(
  p_pool_id text, p_worker text, p_limit integer default 10, p_lease_seconds integer default 300
) returns table (
  job_id uuid, entity_id text, event_type text, event_version integer, entry_ref text,
  template_id text, template_version integer, payload_snapshot jsonb,
  idempotency_key text, attempt_count integer, max_attempts integer, schema_version integer
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with eligible as (
    select j.job_id from bolao_notif_jobs j
    where j.pool_id = p_pool_id
      and j.status in ('pending', 'failed_retryable')
      and j.next_attempt_at <= now()
      and j.attempt_count < j.max_attempts
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

create or replace function mark_bolao_notif_sent(p_job_id uuid, p_provider_message_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update bolao_notif_jobs
     set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id,
         claimed_by = null, lease_expires_at = null, last_error = null
   where job_id = p_job_id and status = 'processing';
  return found;
end $$;

create or replace function mark_bolao_notif_retryable(p_job_id uuid, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
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

create or replace function mark_bolao_notif_permanent(p_job_id uuid, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update bolao_notif_jobs
     set status = 'failed_permanent', last_error = left(coalesce(p_error, ''), 2000),
         claimed_by = null, lease_expires_at = null
   where job_id = p_job_id;
  return found;
end $$;

create or replace function release_expired_bolao_notif(p_pool_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with released as (
    update bolao_notif_jobs
       set status = case when attempt_count >= max_attempts then 'failed_permanent' else 'failed_retryable' end,
           claimed_by = null, lease_expires_at = null,
           last_error = coalesce(last_error, 'lease expirado: runner/processo terminou sem finalizar')
     where pool_id = p_pool_id and status = 'processing'
       and lease_expires_at is not null and lease_expires_at < now()
    returning 1
  )
  select count(*) into v_count from released;
  return coalesce(v_count, 0);
end $$;

create or replace function bolao_notif_health(p_pool_id text)
returns table (status bolao_notif_status, jobs bigint)
language sql security definer set search_path = public as $$
  select j.status, count(*) from bolao_notif_jobs j where j.pool_id = p_pool_id group by j.status;
$$;

-- ROLLBACK (só se preciso reverter; nada existente é afetado):
-- drop function if exists bolao_notif_health(text);
-- drop function if exists release_expired_bolao_notif(text);
-- drop function if exists mark_bolao_notif_permanent(uuid, text);
-- drop function if exists mark_bolao_notif_retryable(uuid, text);
-- drop function if exists mark_bolao_notif_sent(uuid, text);
-- drop function if exists claim_bolao_notif(text, text, integer, integer);
-- drop function if exists enqueue_bolao_notif(text, text, text, integer, text, text, jsonb, text, integer, integer, integer);
-- drop table if exists bolao_notif_jobs;
-- drop type if exists bolao_notif_status;
