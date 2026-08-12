--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812100000_m8m9_canary_purge.sql
--
-- ═══ POR QUE ISTO PRECISA EXISTIR ════════════════════════════════════════════════════════════
--
-- O canário de M9 exercita a máquina de estados inteira contra a PRODUÇÃO: produzir, reivindicar,
-- lease vencido, recuperar, liquidar, falha transitória, esgotar tentativas, morrer. Sem limpeza,
-- cada execução deixa lixo permanente em `bolao.outbox_events` — e a fila real passaria a conter
-- eventos que nunca foram obrigação de notificar ninguém.
--
-- Apagar pelo PostgREST é impossível (schema `bolao` não exposto, 406 — de propósito), e
-- `outbox_delivery_attempts` referencia o evento com ON DELETE RESTRICT, então a remoção tem de
-- ser feita na ordem certa, do lado do banco.
--
-- ═══ O QUE IMPEDE ISTO DE VIRAR UMA ARMA ═════════════════════════════════════════════════════
--
-- Uma função que apaga notificações é exatamente o que não se quer ao alcance de ninguém: apagar
-- um evento `pending` faz a obrigação de notificar desaparecer sem que nada registre que sumiu —
-- o modo de falha que o outbox inteiro existe para eliminar.
--
-- Por isso o filtro NÃO é um parâmetro. Está soldado no corpo: só remove chaves com prefixo
-- `canary:`. Nenhuma chave de negócio usa esse prefixo (são `powerball:`, `br2026:`, `cdb2026:`),
-- então não existe argumento que faça esta função tocar num evento real. Um `p_prefixo text`
-- pareceria mais geral e seria uma porta para apagar a fila inteira.
--
-- Concedida somente a service_role, como as demais da ponte.

create or replace function public.purge_canary_outbox_events()
  returns integer
  language plpgsql
  security definer
  set search_path = pg_catalog, public, bolao, pg_temp
as $$
declare
  v_n integer;
begin
  -- Tentativas primeiro: a FK é ON DELETE RESTRICT, então o pai não sai antes dos filhos.
  delete from bolao.outbox_delivery_attempts a
   where a.outbox_event_id in (
     select e.outbox_event_id from bolao.outbox_events e
      where e.idempotency_key like 'canary:%'
   );

  delete from bolao.outbox_events e
   where e.idempotency_key like 'canary:%';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
begin
  execute 'revoke all on function public.purge_canary_outbox_events() from public';
  execute 'revoke all on function public.purge_canary_outbox_events() from anon';
  execute 'revoke all on function public.purge_canary_outbox_events() from authenticated';
  execute 'grant execute on function public.purge_canary_outbox_events() to service_role';
end
$$;

select 'purga de canario criada (prefixo canary: soldado no corpo)' as resultado;
