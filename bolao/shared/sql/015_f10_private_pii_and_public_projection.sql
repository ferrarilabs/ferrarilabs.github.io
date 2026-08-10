-- 015_f10_private_pii_and_public_projection.sql — F10, STAGE 1 (EXPAND).
--
-- ADITIVA. Nao altera nem remove nada existente. Nenhuma permissao e revogada aqui: revogar
-- antes de os clientes migrarem criaria uma janela em que o app implantado precisa de algo que
-- ja nao tem. A revogacao e a Stage 6.
--
-- ─── O PROBLEMA ──────────────────────────────────────────────────────────────────────────────
--
-- `bolao_state.state->'entries'` carrega, por entrada: participantEmail, payerName,
-- paymentMethod e paymentTo. A anon key e publica por construcao -- vai no js/config.js de todo
-- navegador. Medido em 2026-08-10: 46 entradas, 46 e-mails, 44 nomes de pagador, todos
-- anonimamente enumeraveis.
--
-- ─── O DESENHO ───────────────────────────────────────────────────────────────────────────────
--
--   bolao_entry_private   PII, RLS sem policy nenhuma -> anon nao alcanca, nem para ler
--   bolao_state_public    VIEW que devolve o estado SEM os quatro campos privados
--
-- A view existe para que o navegador continue lendo UM documento, do jeito que ja le -- a
-- migracao do cliente vira trocar o nome da tabela, nao reescrever o app. Views no Postgres
-- executam com os privilegios do dono (security_invoker desligado, que e o padrao), entao ela
-- consegue ler `bolao_state` mesmo depois de anon perder o SELECT na tabela crua.
--
-- A chave de ligacao e o `id` OPACO da entrada, que ja existe e nao muda. Nenhuma identidade e
-- reconstruida, nenhuma associacao se perde.
--
-- ─── RESOLUCAO DE DESTINATARIO ───────────────────────────────────────────────────────────────
--
-- `resolve_notification_recipients` NAO e chamavel por anon (revoke explicito abaixo). Ela existe
-- para o remetente confiavel resolver e-mail a partir de entry_ref no momento do envio. O ledger
-- do F7 ja guarda apenas `entry_ref` opaco -- esta funcao fecha o circuito sem que o e-mail volte
-- a aparecer em lugar publico.
--
-- ROLLBACK: ver o rodape.

-- ── 1. Armazenamento privado ────────────────────────────────────────────────────────────────
create table if not exists bolao_entry_private (
  pool_id            text not null,
  entry_ref          text not null,
  participant_email  text,
  payer_name         text,
  payment_method     text,
  payment_to         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (pool_id, entry_ref)
);

alter table bolao_entry_private enable row level security;
-- NENHUMA policy. Deliberado. Com RLS ligada e zero policies, todo acesso direto de `anon` e
-- negado -- inclusive SELECT. Nunca escrever `create policy ... to anon` nesta tabela.

revoke all on bolao_entry_private from anon;

create index if not exists bolao_entry_private_pool on bolao_entry_private (pool_id);

-- ── 2. Projecao publica ─────────────────────────────────────────────────────────────────────
--
-- Remove os quatro campos privados de CADA entrada, preservando todo o resto do documento
-- (paid, results, officialDraw, phases, roundEmail, meta...). Entrada sem `entries` continua
-- funcionando: coalesce protege o caso de estado novo ou vazio.
create or replace view bolao_state_public as
select
  s.id,
  case
    when s.state ? 'entries' then jsonb_set(
      s.state, '{entries}',
      coalesce((
        select jsonb_agg(e - 'participantEmail' - 'payerName' - 'paymentMethod' - 'paymentTo'
                         order by ord)
        from jsonb_array_elements(s.state->'entries') with ordinality as t(e, ord)
      ), '[]'::jsonb))
    else s.state
  end as state,
  s.updated_at
from bolao_state s;

grant select on bolao_state_public to anon;

-- ── 3. Resolucao de destinatario, so para caminho confiavel ─────────────────────────────────
create or replace function resolve_notification_recipients(p_pool_id text, p_entry_refs text[])
returns table (entry_ref text, participant_email text)
language sql security definer set search_path = public stable as $$
  select p.entry_ref, p.participant_email
  from bolao_entry_private p
  where p.pool_id = p_pool_id
    and p.entry_ref = any(p_entry_refs)
    and p.participant_email is not null;
$$;

-- Sem isto a funcao seria chamavel com a anon key e viraria justamente o endpoint enumeravel de
-- contatos que esta migracao existe para eliminar.
revoke execute on function resolve_notification_recipients(text, text[]) from anon, public;

-- ROLLBACK (so se preciso reverter):
-- drop function if exists resolve_notification_recipients(text, text[]);
-- drop view if exists bolao_state_public;
-- drop table if exists bolao_entry_private;
