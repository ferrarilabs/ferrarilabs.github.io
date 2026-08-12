--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812190000_delivery_uniqueness_and_rapid_send_breaker.sql
--
-- ═══ O QUE ACONTECEU (2026-08-12) ════════════════════════════════════════════════════════════
--
-- O operador recebeu QUATRO e-mails do CDB em 45 minutos. A idempotencia por EVENTO existia e
-- funcionou: nunca houve dois envios do mesmo evento de negocio. O que faltava era a camada de
-- baixo -- DESTINATARIO. Cada "conserto" criava um evento NOVO (correcao v1, v2, v3), e cada
-- evento novo era, para o sistema, uma obrigacao legitima de escrever para a mesma pessoa.
--
-- Idempotencia de evento responde "este evento ja saiu?". Nao responde "esta PESSOA acabou de
-- receber?". As duas perguntas sao diferentes e hoje so a primeira tinha resposta.
--
-- ═══ DUAS TRAVAS, PROPOSITOS DIFERENTES ══════════════════════════════════════════════════════
--
--   notification_deliveries   identidade DURAVEL de entrega: (app, evento, destinatario,
--                             geracao). UNIQUE no banco. Rerun de workflow, dois workers
--                             simultaneos e reinicio de processo colidem na chave, nao no Python.
--
--   check_rapid_send          ANOMALIA: a mesma pessoa prestes a receber de novo do mesmo app
--                             dentro de 45 minutos. Independe de evento -- e exatamente o caso
--                             que passou hoje, porque cada envio tinha evento diferente.
--
-- A segunda nao substitui a primeira. Unicidade impede repetir o MESMO fato; o disjuntor de
-- anomalia impede uma sequencia de fatos diferentes que, vista de fora, e spam.
--
-- ═══ POR QUE O DESTINATARIO E HASH ═══════════════════════════════════════════════════════════
--
-- `recipient_hash` = sha256 do endereco normalizado. O banco precisa reconhecer a pessoa entre
-- execucoes sem GUARDAR o endereco: esta tabela existe para proteger participantes, e guardar
-- e-mail em claro aqui criaria a exposicao que o resto da plataforma passou o dia fechando.
--
-- ROLLBACK: `drop table bolao.notification_deliveries` + `drop function`. Nada existente e
-- alterado; esta migracao so cria.

create table if not exists bolao.notification_deliveries (
  delivery_id      uuid        not null default gen_random_uuid(),
  app              text        not null,
  business_key     text        not null,
  recipient_hash   text        not null,
  generation       integer     not null default 1,
  status           text        not null default 'claimed',
  provider_msg_id  text,
  claimed_at       timestamptz not null default now(),
  settled_at       timestamptz,
  constraint notification_deliveries_pkey primary key (delivery_id),
  -- A TRAVA. Um destinatario, um evento, uma geracao: uma entrega. Duas tentativas colidem aqui,
  -- no banco, antes de qualquer provedor -- e nao dependem de dois processos concordarem.
  constraint notification_deliveries_identity
    unique (app, business_key, recipient_hash, generation),
  constraint nd_status_valido
    check (status in ('claimed', 'accepted', 'failed', 'uncertain'))
);

comment on table bolao.notification_deliveries is
  'Identidade duravel de entrega por DESTINATARIO. A idempotencia por evento responde "este '
  'evento ja saiu?"; esta tabela responde "esta pessoa ja recebeu?". Sao perguntas diferentes, e '
  'em 2026-08-12 so a primeira tinha resposta -- o operador recebeu quatro e-mails porque cada '
  'conserto criou um evento novo.';

alter table bolao.notification_deliveries enable row level security;
alter table bolao.notification_deliveries force row level security;
revoke all on table bolao.notification_deliveries from public;

create index concurrently if not exists notification_deliveries_recent_idx
  on bolao.notification_deliveries (app, recipient_hash, claimed_at desc);

-- ── RESERVA ATOMICA ─────────────────────────────────────────────────────────────────────────
--
-- Devolve `reserved=false` quando a entrega ja existe. NAO levanta: o chamador precisa saber que
-- ja foi feito para PULAR aquele destinatario, nao para abortar o lote inteiro.
--
-- A janela de anomalia e checada AQUI dentro, na mesma transacao da reserva. Checar antes, no
-- Python, deixaria espaco entre a verificacao e a escrita -- que e onde corrida mora.
create or replace function public.reserve_delivery(
  p_app            text,
  p_business_key   text,
  p_recipient      text,
  p_generation     integer default 1,
  p_anomaly_window interval default '45 minutes',
  p_bypass_anomaly boolean default false
)
  returns table (reserved boolean, reason text, delivery_id uuid)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_hash text := encode(sha256(convert_to(lower(trim(p_recipient)), 'utf8')), 'hex');
  v_id   uuid;
  v_recente timestamptz;
begin
  -- ANOMALIA: mesma pessoa, mesmo app, outro evento, minutos atras. Foi o padrao exato de hoje.
  if not p_bypass_anomaly then
    select max(d.claimed_at) into v_recente
      from bolao.notification_deliveries d
     where d.app = p_app
       and d.recipient_hash = v_hash
       and d.business_key <> p_business_key
       and d.status in ('accepted', 'claimed')
       and d.claimed_at > now() - p_anomaly_window;
    if v_recente is not null then
      return query select false,
        format('ANOMALIA_ENVIO_RAPIDO: este destinatario recebeu de %s em %s (janela %s). '
               'Exige aprovacao explicita.', p_app, v_recente, p_anomaly_window), null::uuid;
      return;
    end if;
  end if;

  insert into bolao.notification_deliveries (app, business_key, recipient_hash, generation)
  values (p_app, p_business_key, v_hash, p_generation)
  on conflict (app, business_key, recipient_hash, generation) do nothing
  returning bolao.notification_deliveries.delivery_id into v_id;

  if v_id is null then
    return query select false, 'JA_ENTREGUE: reserva existente para este destinatario/evento',
                        null::uuid;
    return;
  end if;
  return query select true, null::text, v_id;
end;
$$;

create or replace function public.settle_delivery(
  p_delivery_id     uuid,
  p_status          text,
  p_provider_msg_id text default null
)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
begin
  if p_status not in ('accepted', 'failed', 'uncertain') then
    raise exception 'STATUS_INVALIDO: %', p_status;
  end if;
  -- ACEITO e TERMINAL. Reabrir um aceito e como se reenvia sem querer.
  update bolao.notification_deliveries
     set status = p_status, provider_msg_id = p_provider_msg_id, settled_at = now()
   where delivery_id = p_delivery_id
     and status <> 'accepted';
  if not found then
    return 'JA_TERMINAL';
  end if;
  return p_status;
end;
$$;

-- Leitura para verificacao; nao devolve o hash, so contagens.
create or replace function public.delivery_count(p_app text, p_business_key text)
  returns table (total bigint, accepted bigint)
  language sql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
  select count(*)::bigint,
         count(*) filter (where status = 'accepted')::bigint
    from bolao.notification_deliveries
   where app = p_app and business_key = p_business_key;
$$;

-- Limpeza restrita a canario, prefixo soldado no corpo (mesma regra da purga do outbox).
create or replace function public.purge_canary_deliveries()
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare v_n integer;
begin
  delete from bolao.notification_deliveries where business_key like 'canary:%';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.reserve_delivery(text,text,text,integer,interval,boolean)',
    'public.settle_delivery(uuid,text,text)',
    'public.delivery_count(text,text)',
    'public.purge_canary_deliveries()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;

select 'unicidade por destinatario + disjuntor de anomalia criados' as resultado;
