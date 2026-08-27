-- Corrige `42702: column reference "status" is ambiguous` na reconciliacao historica (#352).
--
-- ─── O QUE ACONTECEU ────────────────────────────────────────────────────────────────────────
--
-- A funcao 20260827090000 declara `returns table(..., "status" text, ...)`. Dentro do corpo, um
-- `count(*) filter (where status = 'pending')` nao diz de QUEM e o `status`: pode ser a coluna da
-- tabela ou o parametro de saida de mesmo nome. O PostgreSQL nao adivinha -- levanta 42702.
--
-- Na execucao autorizada de 2026-08-27 isso apareceu como HTTP 400 no apply. NENHUMA linha foi
-- escrita: a excecao desfez a transacao inteira, que e exatamente o que a atomicidade prometia.
-- O preflight tinha dito READY corretamente -- o defeito nao estava no estado, estava na funcao.
--
-- ─── O QUE MUDA, E O QUE NAO MUDA ───────────────────────────────────────────────────────────
--
-- Muda SO a qualificacao dos identificadores. Cada referencia a coluna passa a dizer de qual
-- relacao e (`j.status`, `bolao_notif_jobs.status`). Nenhuma guarda foi afrouxada, removida ou
-- reordenada; a contagem, a exigencia de conjunto exato, a recusa de reconciliacao parcial, a
-- recusa de entry_ref duplicado, o NULL em provider_message_id, o `sent_at` vindo do operador e a
-- procedencia em payload_snapshot continuam identicos, palavra por palavra.
--
-- A assinatura e o formato de retorno tambem nao mudam: renomear a saida `status` resolveria a
-- ambiguidade, mas quebraria quem le `linha["status"]` -- trocar contrato para corrigir digitacao
-- e pagar caro por um erro barato.
--
-- Migracao de AVANCO, nao rollback: `create or replace` sobre a mesma assinatura.

create or replace function "public"."reconcile_bolao_notif_historical_delivery"(
  "p_pool_id" text,
  "p_entity_id" text,
  "p_expected_rows" integer,
  "p_reason" text,
  "p_source_run" text,
  "p_delivered_at" timestamp with time zone
) returns table("reconciled" integer, "already" integer, "status" text, "detail" text)
    language "plpgsql" security definer
    set "search_path" to 'public'
    as $$
declare
  v_total integer; v_pending integer; v_sent integer; v_outros integer;
  v_refs integer; v_ja integer; v_n integer;
begin
  if coalesce(p_reason, '') = '' or coalesce(p_source_run, '') = '' then
    raise exception 'reconcile: reason e source_run sao obrigatorios (procedencia)';
  end if;
  if p_delivered_at is null then
    raise exception 'reconcile: delivered_at obrigatorio — nao usar now() como hora de entrega';
  end if;

  select count(*),
         count(*) filter (where j.status = 'pending'),
         count(*) filter (where j.status = 'sent'),
         count(*) filter (where j.status not in ('pending','sent')),
         count(distinct j.entry_ref),
         count(*) filter (where j.payload_snapshot -> 'reconciliation' is not null)
    into v_total, v_pending, v_sent, v_outros, v_refs, v_ja
    from bolao_notif_jobs j
   where j.pool_id = p_pool_id and j.entity_id = p_entity_id;

  -- IDEMPOTÊNCIA: já reconciliado por esta mesma operação => nada muda, e isso não é erro.
  if v_total > 0 and v_ja = v_total and v_sent = v_total then
    return query select 0, v_total, 'ALREADY_RECONCILED'::text,
                        'todas as linhas ja carregam procedencia de reconciliacao'::text;
    return;
  end if;

  if v_total <> p_expected_rows then
    raise exception 'reconcile: esperadas % linhas, encontradas % — conjunto mudou desde a revisao',
      p_expected_rows, v_total;
  end if;
  if v_refs <> v_total then
    raise exception 'reconcile: entry_ref duplicado (% linhas, % refs distintos)', v_total, v_refs;
  end if;
  if v_outros > 0 then
    raise exception 'reconcile: % linha(s) em estado nao previsto — so pending/sent sao aceitos', v_outros;
  end if;
  if v_pending <> v_total then
    raise exception 'reconcile: % de % linhas nao estao pending — reconciliacao parcial nao e permitida',
      v_total - v_pending, v_total;
  end if;

  -- UM update: atômico por construção. Ou as 12, ou nenhuma.
  update bolao_notif_jobs
     set status = 'sent',
         sent_at = p_delivered_at,
         provider_message_id = null,      -- irrecuperavel; NUNCA inventado
         last_error = null,
         claimed_by = null,
         lease_expires_at = null,
         payload_snapshot = payload_snapshot || jsonb_build_object(
           'reconciliation', jsonb_build_object(
             'reason', p_reason,
             'sourceRun', p_source_run,
             'deliveredAt', to_char(p_delivered_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'reconciledAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'providerMessageId', 'UNRECOVERABLE',
             'sentAtSource', 'authorized-run-timestamp'))
   where bolao_notif_jobs.pool_id = p_pool_id
     and bolao_notif_jobs.entity_id = p_entity_id
     and bolao_notif_jobs.status = 'pending';

  get diagnostics v_n = row_count;
  if v_n <> p_expected_rows then
    -- Não deveria acontecer (as guardas acima já contaram), mas 0 linhas nunca é sucesso
    -- silencioso neste esquema — e a exceção desfaz o update inteiro.
    raise exception 'reconcile: atualizou % linhas, esperado % — desfazendo', v_n, p_expected_rows;
  end if;

  return query select v_n, 0, 'RECONCILED'::text,
                      format('%s linha(s) marcadas como sent com procedencia', v_n)::text;
end $$;

revoke all on function "public"."reconcile_bolao_notif_historical_delivery"(
  text, text, integer, text, text, timestamp with time zone) from public;
revoke all on function "public"."reconcile_bolao_notif_historical_delivery"(
  text, text, integer, text, text, timestamp with time zone) from anon;
revoke all on function "public"."reconcile_bolao_notif_historical_delivery"(
  text, text, integer, text, text, timestamp with time zone) from authenticated;
grant execute on function "public"."reconcile_bolao_notif_historical_delivery"(
  text, text, integer, text, text, timestamp with time zone) to "service_role";
