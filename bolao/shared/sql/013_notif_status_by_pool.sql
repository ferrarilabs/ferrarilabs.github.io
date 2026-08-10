-- 013_notif_status_by_pool.sql — F7. Leitura de estado por rodada, sem PII.
--
-- POR QUE EXISTE: o reconciliador precisa saber, por chave de idempotencia, se a rodada ja foi
-- notificada. A tabela tem RLS sem policy alguma, entao SELECT direto com a anon key devolve
-- lista VAZIA -- e um repositorio que "nao encontra nada" e pior que um que falha, porque
-- pareceria autorizar reenvio de tudo.
--
-- ESCOPO DELIBERADAMENTE ESTREITO: devolve apenas `idempotency_key` e `status`. Nao devolve
-- entry_ref, payload, provider_message_id nem erro. Nao ha PII na tabela, e esta RPC tambem nao
-- abre caminho para enumerar o que houver de sensivel no futuro.
--
-- ROLLBACK: drop function if exists bolao_notif_status_by_pool(text);

create or replace function bolao_notif_status_by_pool(p_pool_id text)
returns table (idempotency_key text, status text)
language sql security definer set search_path = public stable as $$
  select j.idempotency_key, j.status::text
  from bolao_notif_jobs j
  where j.pool_id = p_pool_id;
$$;
