-- 030_br_round_notification_durability.sql
-- Durable, atomic per-round notification ledger for BR2026 round-completion emails (Issue #221).
--
-- ─── O DEFEITO ───────────────────────────────────────────────────────────────────────────────
--
-- SupabaseStateRoundLedgerRepo (o repositorio de producao de round_notification_ledger.py ate
-- aqui) alegava durabilidade na propria docstring, mas `put()` so mutava um dict em memoria
-- construido de um `sb_fetch()` -- um GET, sem NENHUM caminho de escrita de volta ao Supabase.
-- O caminho de documento inteiro (`sb_upsert`) tinha sido removido antes por outro motivo real de
-- seguranca (anon key publica sobrescrevendo o documento inteiro), e nada o substituiu para este
-- ledger. Toda execucao agendada lia o MESMO documento obsoleto, via a rodada como nao reivindicada
-- e reenviava. A rodada 23 foi enviada 4x para os 11 participantes reais (44 envios em vez de 11)
-- em quatro execucoes agendadas independentes entre 2026-08-17 22:45 ET e 2026-08-18 00:57 ET.
--
-- ─── POR QUE UMA TABELA NOVA, E NAO bolao_notif_jobs ────────────────────────────────────────────
--
-- `bolao_notif_jobs` (010_notification_durability.sql) modela UM job POR DESTINATARIO
-- (entry_ref singular, idempotency_key por par job+destinatario). O ledger de rodada do BR2026
-- modela UM job POR RODADA com N destinatarios rastreados dentro dele (READY -> CLAIMED ->
-- SENDING -> {PARTIAL|SENT|FAILED|NEEDS_MANUAL_REVIEW}, cada destinatario com seu proprio estado).
-- Forcar o segundo modelo dentro do primeiro exigiria traducao com perda -- e `round_notification_ledger.py`/`.mjs`
-- ja implementam essa maquina de estados por rodada, testada e com interop provado entre as duas
-- linguagens (test_round_ledger_interop.mjs). Mudar a maquina de estados para caber em
-- `bolao_notif_jobs` arriscaria exatamente o tipo de deriva que esse interop existe para pegar.
--
-- O que MUDA aqui e so a CAMADA DE PERSISTENCIA por baixo de `RoundLedger`: a logica de negocio
-- (ensure_job decide recriar/recusar por hash mudado, settle decide SENT/PARTIAL/FAILED/
-- NEEDS_MANUAL_REVIEW a partir do estado por destinatario) continua em Python/JS, ja testada.
-- Esta migracao fornece so o que faltava: armazenamento DURAVEL com UMA operacao verdadeiramente
-- atomica (reivindicar), reaproveitando exatamente o padrao de seguranca ja provado em 010/020:
-- entry_ref e um id opaco (nunca e-mail), RLS habilitada sem NENHUMA policy para `anon`, e todo
-- acesso passa por RPC `security definer`.
--
-- ─── POR QUE UM UPDATE DE LINHA UNICA BASTA (sem `for update skip locked`) ──────────────────────
--
-- `claim_bolao_notif` (010) usa `for update skip locked` porque reivindica N linhas ELEGIVEIS de
-- um POOL (quem quer que esteja disponivel). Aqui o chamador ja sabe EXATAMENTE qual rodada quer
-- (o resolver de rodada decide isso antes). Um UNICO `update ... where idempotency_key = X and
-- state in (...) and (lease_until is null or lease_until <= now()) returning *` ja e atomico para
-- este caso: o Postgres serializa UPDATEs concorrentes na MESMA linha, e a segunda transacao, ao
-- ser liberada, reavalia o WHERE e encontra zero linhas se a primeira ja tiver mudado o estado.
-- Nenhum lock explicito adicional e necessario.
--
-- ADITIVA E NAO DESTRUTIVA: so `create ... if not exists` / `create or replace function`. Nenhuma
-- tabela, coluna ou policy existente e alterada. `bolao_state` e `bolao_notif_jobs` nao sao
-- tocadas.
--
-- ROLLBACK: ver o rodape.

create table if not exists bolao_round_notif_jobs (
  idempotency_key           text primary key,        -- br2026:round-results:<n>:v1
  pool_id                   text not null,
  round_number              integer not null,
  state                     text not null default 'READY',
  content_hash              text not null,
  recipient_set_hash        text not null,
  fixture_set_hash          text not null,
  expected_recipient_count  integer not null,
  -- Espelha `resolvedRecipientCount` do dict que `RoundLedger` mantem -- persistido como campo
  -- proprio (nao derivado de `len(recipients)`) porque o chamador Python trata os dois como
  -- independentes e este repositorio so precisa devolver fielmente o que recebeu.
  resolved_recipient_count integer not null default 0,
  -- [{entryRef, state, providerMessageId, lastError}, ...]. entry_ref e um id opaco -- NUNCA
  -- um endereco de e-mail. Validado pela RPC de escrita, nao so por convencao de chamador.
  recipients                jsonb not null default '[]'::jsonb,
  attempt_count             integer not null default 0,
  claimed_by                text,
  lease_until               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  sent_at                   timestamptz,

  constraint bolao_round_notif_jobs_state_check
    check (state in ('READY','CLAIMED','SENDING','PARTIAL','SENT','FAILED','NEEDS_MANUAL_REVIEW'))
);

create index if not exists bolao_round_notif_jobs_pool
  on bolao_round_notif_jobs (pool_id, round_number);

create index if not exists bolao_round_notif_jobs_expired_lease
  on bolao_round_notif_jobs (state, lease_until)
  where state in ('CLAIMED', 'SENDING');

alter table bolao_round_notif_jobs enable row level security;
-- NENHUMA policy para `anon`. Deliberado -- mesmo padrao de bolao_notif_jobs (010). Com RLS
-- habilitada e zero policies, todo acesso direto de `anon` e negado, inclusive SELECT. Todo
-- acesso legitimo passa pelas RPCs abaixo, que sao `security definer` e tem GRANT restrito a
-- `service_role` no rodape desta migracao -- nao existe intervalo em que `anon` tenha acesso.

-- Le o job inteiro (ou nenhuma linha). Usado para reconstruir o dict que `RoundLedger` espera.
create or replace function get_bolao_notif_round_job(p_idempotency_key text)
returns bolao_round_notif_jobs
language sql security definer set search_path = public as $$
  select * from bolao_round_notif_jobs where idempotency_key = p_idempotency_key;
$$;

-- Le todos os jobs de um pool (para o resolver saber quais rodadas ja tem disposicao registrada).
create or replace function list_bolao_notif_round_jobs(p_pool_id text)
returns setof bolao_round_notif_jobs
language sql security definer set search_path = public as $$
  select * from bolao_round_notif_jobs where pool_id = p_pool_id order by round_number;
$$;

-- Cria OU atualiza o job inteiro. A logica de "conteudo mudou em job ativo recusa, em READY
-- recria" continua em `RoundLedger.ensure_job()` (Python/JS) -- esta RPC so persiste o que o
-- chamador ja decidiu ser seguro escrever. `insert ... on conflict ... do update` e atomico por
-- construcao do Postgres: duas primeiras-criacoes concorrentes da MESMA rodada nunca duplicam a
-- linha (chave primaria), e como toda mutacao pos-criacao so acontece depois de uma reivindicacao
-- vencida (ver `claim_bolao_notif_round_job` abaixo), nao ha dois escritores legitimos
-- simultaneos disputando o mesmo UPDATE.
create or replace function upsert_bolao_notif_round_job(
  p_idempotency_key text, p_pool_id text, p_round_number integer,
  p_state text, p_content_hash text, p_recipient_set_hash text, p_fixture_set_hash text,
  p_expected_recipient_count integer, p_resolved_recipient_count integer, p_recipients jsonb,
  p_attempt_count integer, p_claimed_by text, p_lease_until timestamptz, p_sent_at timestamptz
) returns bolao_round_notif_jobs
language plpgsql security definer set search_path = public as $$
declare v_row bolao_round_notif_jobs;
begin
  if p_idempotency_key is null or p_pool_id is null or p_round_number is null then
    raise exception 'upsert_bolao_notif_round_job: argumentos obrigatorios ausentes';
  end if;
  if p_recipients is not null then
    if exists (
      select 1 from jsonb_array_elements(p_recipients) r
       where position('@' in coalesce(r->>'entryRef', '')) > 0
    ) then
      raise exception 'upsert_bolao_notif_round_job: entryRef nao pode ser um endereco de e-mail';
    end if;
  end if;

  insert into bolao_round_notif_jobs (
    idempotency_key, pool_id, round_number, state, content_hash, recipient_set_hash,
    fixture_set_hash, expected_recipient_count, resolved_recipient_count, recipients,
    attempt_count, claimed_by, lease_until, sent_at, updated_at
  ) values (
    p_idempotency_key, p_pool_id, p_round_number, coalesce(p_state, 'READY'), p_content_hash,
    p_recipient_set_hash, p_fixture_set_hash, coalesce(p_expected_recipient_count, 0),
    coalesce(p_resolved_recipient_count, 0), coalesce(p_recipients, '[]'::jsonb),
    coalesce(p_attempt_count, 0), p_claimed_by, p_lease_until, p_sent_at, now()
  )
  on conflict (idempotency_key) do update set
    state = excluded.state,
    content_hash = excluded.content_hash,
    recipient_set_hash = excluded.recipient_set_hash,
    fixture_set_hash = excluded.fixture_set_hash,
    expected_recipient_count = excluded.expected_recipient_count,
    resolved_recipient_count = excluded.resolved_recipient_count,
    recipients = excluded.recipients,
    attempt_count = excluded.attempt_count,
    claimed_by = excluded.claimed_by,
    lease_until = excluded.lease_until,
    sent_at = excluded.sent_at,
    updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- A UNICA operacao que precisa ser atomica de verdade: reivindicar a rodada antes de qualquer
-- chamada ao provedor. Estados reivindicaveis: READY, PARTIAL, FAILED (mesma regra de
-- CLAIMABLE_STATES em round_notification_ledger.py -- SENT e NEEDS_MANUAL_REVIEW nunca).
create or replace function claim_bolao_notif_round_job(
  p_idempotency_key text, p_owner text, p_lease_seconds integer default 300
) returns bolao_round_notif_jobs
language plpgsql security definer set search_path = public as $$
declare v_row bolao_round_notif_jobs;
begin
  update bolao_round_notif_jobs
     set state = 'CLAIMED',
         claimed_by = p_owner,
         lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30)),
         updated_at = now()
   where idempotency_key = p_idempotency_key
     and state in ('READY', 'PARTIAL', 'FAILED')
     and (lease_until is null or lease_until <= now())
  returning * into v_row;
  return v_row;   -- NULL (nenhuma linha) = nao reivindicavel: outra execucao tem o lease, ou
                  -- o job ja esta em estado terminal. O chamador distingue os dois lendo o
                  -- estado atual via get_bolao_notif_round_job, exatamente como hoje.
end $$;

-- NAO existe uma RPC dedicada de "liberar leases vencidos": `RoundLedger.recover_expired_leases()`
-- (Python/JS, ja testado) ja implementa essa recuperacao de forma inteiramente generica sobre
-- get/put/list_by_prefix -- ler todos os jobs do pool, decidir CLAIMED->READY ou SENDING->
-- NEEDS_MANUAL_REVIEW em memoria, e escrever de volta com `upsert_bolao_notif_round_job`. Uma RPC
-- dedicada faria a MESMA coisa por um caminho paralelo, e o unico jeito de mante-los concordando
-- seria repetir o interop test que ja existe para o Python/.mjs. `list`+`upsert` bastam.
--
-- ROLLBACK (so se preciso reverter; nada existente e afetado):
-- drop function if exists claim_bolao_notif_round_job(text, text, integer);
-- drop function if exists upsert_bolao_notif_round_job(text, text, integer, text, text, text, text, integer, integer, jsonb, integer, text, timestamptz, timestamptz);
-- drop function if exists list_bolao_notif_round_jobs(text);
-- drop function if exists get_bolao_notif_round_job(text);
-- drop table if exists bolao_round_notif_jobs;

-- ─── N24-EQUIVALENTE: nenhum intervalo em que `anon` tenha acesso ───────────────────────────────
--
-- 010 nasceu sem grant/revoke explicito e uma migracao SEPARADA (021) teve que fechar o acesso
-- de `anon` depois -- um incidente de exposicao evitavel. Aqui o revoke/grant e PARTE desta MESMA
-- migracao, escopado explicitamente as funcoes criadas acima (nao um wildcard que tocaria funcoes
-- de outras features).
revoke all on function get_bolao_notif_round_job(text) from anon, public, authenticated;
revoke all on function list_bolao_notif_round_jobs(text) from anon, public, authenticated;
revoke all on function upsert_bolao_notif_round_job(text, text, integer, text, text, text, text, integer, integer, jsonb, integer, text, timestamptz, timestamptz) from anon, public, authenticated;
revoke all on function claim_bolao_notif_round_job(text, text, integer) from anon, public, authenticated;

grant execute on function get_bolao_notif_round_job(text) to service_role;
grant execute on function list_bolao_notif_round_jobs(text) to service_role;
grant execute on function upsert_bolao_notif_round_job(text, text, integer, text, text, text, text, integer, integer, jsonb, integer, text, timestamptz, timestamptz) to service_role;
grant execute on function claim_bolao_notif_round_job(text, text, integer) to service_role;
