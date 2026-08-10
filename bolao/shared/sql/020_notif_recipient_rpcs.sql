-- 020_notif_recipient_rpcs.sql — operacoes de destinatario como RPC, nao como CLI.
--
-- ─── POR QUE ─────────────────────────────────────────────────────────────────────────────────
--
-- Tres execucoes do workflow real falharam em 2026-08-10 com:
--     RuntimeError: SQL falhou: Cannot find project ref. Have you run supabase link?
--
-- O ledger fazia suas escritas por `npx supabase db query --linked`, que depende de um vinculo
-- criado na maquina do DESENVOLVEDOR. No runner do GitHub Actions esse vinculo nao existe, entao
-- o ledger inteiro -- testado, verde localmente -- era inoperante em producao.
--
-- Estas funcoes dao ao runner o mesmo poder por HTTPS, sem CLI e sem sessao local.
--
-- ADITIVA. Nenhum drop, nenhuma alteracao de tabela, nenhum revoke. O revoke vive na 021 e SO
-- pode ser aplicado depois que o runner tiver credencial propria -- nunca deve existir um
-- intervalo em que o deployado precise de permissao ja revogada.

-- Grava a disposicao de UM destinatario dentro do payload do job.
create or replace function set_bolao_notif_recipient(
  p_idempotency_key text, p_entry_ref text, p_state text,
  p_provider_message_id text default null, p_error text default null
) returns integer
language plpgsql security definer set search_path = public as $$
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

-- Le as disposicoes por destinatario.
create or replace function get_bolao_notif_recipients(p_idempotency_key text)
returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(payload_snapshot->'recipients', '[]'::jsonb)
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
$$;

-- Le o hash de conteudo (imutabilidade).
create or replace function get_bolao_notif_content_hash(p_idempotency_key text)
returns text
language sql security definer set search_path = public as $$
  select payload_snapshot->>'contentHash'
    from bolao_notif_jobs where idempotency_key = p_idempotency_key;
$$;

-- Fecha o job a partir do estado por destinatario, e devolve o que decidiu.
-- A REGRA DE NEGOCIO VIVE AQUI, no banco, junto do dado que ela le -- e nao em quem chama.
create or replace function settle_bolao_notif(p_idempotency_key text)
returns table (status text, accepted integer, total integer, uncertain integer, reason text)
language plpgsql security definer set search_path = public as $$
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
