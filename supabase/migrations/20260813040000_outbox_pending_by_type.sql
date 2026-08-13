-- 20260813040000_outbox_pending_by_type.sql
--
-- ═══ O DIAGNOSTICO FICOU MENTINDO ════════════════════════════════════════════════════════════
--
-- `--status --entry X` perguntava por uma chave EXATA:
--
--     cdb2026:entry-saved-confirmation:<entryId>:v1
--
-- Com a identidade por versao, a chave passou a ser `...:<entryId>:<hash>:v1`. O diagnostico
-- continuou perguntando pela forma antiga, entao respondia "NAO EXISTE" mesmo com obrigacao
-- pendente na fila.
--
-- Isso e pior que nao ter diagnostico. "Nenhum e-mail chegou" tem duas causas opostas -- o save
-- nao criou a obrigacao, ou a obrigacao existe e nenhum consumidor rodou -- e um diagnostico que
-- responde sempre a primeira manda procurar no lugar errado.
--
-- Aqui a pergunta certa e por TIPO, nao por chave: o hash da versao so e conhecido depois do save,
-- entao quem observa de fora nao tem como montar a chave.
--
-- SO CONTAGENS. Nao devolve payload (que carrega `entryId`), nao devolve chave, nao devolve
-- destinatario -- mesma regra de `outbox_event_status`, que ja se recusa a devolver payload.
--
-- ROLLBACK: `drop function public.outbox_pending_count(text)`. Nada de dado e tocado.

create or replace function public.outbox_pending_count(p_event_type text)
  returns table (pending bigint, in_flight bigint, sent bigint, dead bigint)
  language sql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
  select count(*) filter (where status = 'pending')::bigint,
         count(*) filter (where status = 'in_flight')::bigint,
         count(*) filter (where status = 'sent')::bigint,
         count(*) filter (where status = 'dead')::bigint
    from bolao.outbox_events
   where event_type = p_event_type;
$$;

revoke all on function public.outbox_pending_count(text) from public;
revoke all on function public.outbox_pending_count(text) from anon;
revoke all on function public.outbox_pending_count(text) from authenticated;
grant execute on function public.outbox_pending_count(text) to service_role;

select 'outbox_pending_count: pergunta por tipo, porque a chave carrega um hash imprevisivel'
       as resultado;
