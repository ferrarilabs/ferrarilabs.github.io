-- reconcile_bolao_notif_historical_delivery — reconciliação ATÔMICA de entregas históricas.
--
-- ─── POR QUE ESTA FUNÇÃO EXISTE ─────────────────────────────────────────────────────────────
--
-- Em 2026-08-26 uma recuperação autorizada entregou 12 e-mails de resultado do CDB2026. O provedor
-- devolveu sucesso para os 12. O ledger registrou ZERO, porque o adaptador da época não conseguia
-- marcar entrega (Issue #352): passava hash de conteúdo onde a RPC quer UUID, e a RPC só atualiza
-- linha em `processing`. As 12 linhas ficaram em `pending`.
--
-- O adaptador foi corrigido. As 12 linhas históricas, não — e elas não podem ser corrigidas pelo
-- caminho canônico, porque foram criadas pelo `reserve()` antigo com `payload_snapshot = '{}'`:
-- não têm o array `recipients` que `settle_bolao_notif` conta. Chamar o settle nelas produziria
-- `failed_retryable` ("nenhum destinatário aceito"), não `sent`.
--
-- ─── POR QUE UMA FUNÇÃO, E NÃO 12 ESCRITAS ──────────────────────────────────────────────────
--
-- No CDB2026 há UM job por destinatário, então reconciliar são 12 linhas. Fazer isso em 12
-- chamadas independentes admite o desfecho que não pode existir: 7 `sent` e 5 `pending` porque o
-- processo morreu no meio — um estado que nenhuma ferramenta saberia interpretar depois.
--
-- Um `update` único é atômico por construção. Ou as 12 mudam, ou nenhuma muda.
--
-- ─── O QUE ELA SE RECUSA A FAZER ────────────────────────────────────────────────────────────
--
-- Não envia e-mail (não tem como: é SQL). Não cria linha. Não apaga linha. Não altera o conjunto
-- de destinatários. Não toca `entry_ref`, `job_id`, `idempotency_key` nem `entity_id` — a
-- identidade histórica é preservada inteira.
--
-- E ela EXIGE que o operador declare quantas linhas espera. Se o número não bater exatamente, ela
-- levanta e não escreve nada. Reconciliação é um ato sobre um conjunto conhecido; se o conjunto
-- mudou desde que alguém o revisou, o ato deixou de estar revisado.
--
-- ─── HONESTIDADE DO DADO ────────────────────────────────────────────────────────────────────
--
-- `provider_message_id` fica NULL. A coluna é anulável, e o id por destinatário é IRRECUPERÁVEL:
-- a execução autorizada registrou só `entry_ref`, de propósito, para não colocar endereço em log.
-- Inventar um id seria fabricar evidência de provedor — exatamente o que não se faz num ledger.
--
-- `sent_at` recebe o instante da EXECUÇÃO AUTORIZADA, passado explicitamente pelo operador, e não
-- `now()`: `now()` seria a hora da reconciliação, apresentada como se fosse a hora da entrega.
--
-- E a procedência fica gravada em `payload_snapshot.reconciliation`, para que um `sent`
-- reconciliado NUNCA seja indistinguível de um `sent` de tempo real.

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
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status not in ('pending','sent')),
         count(distinct entry_ref),
         count(*) filter (where payload_snapshot -> 'reconciliation' is not null)
    into v_total, v_pending, v_sent, v_outros, v_refs, v_ja
    from bolao_notif_jobs
   where pool_id = p_pool_id and entity_id = p_entity_id;

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
   where pool_id = p_pool_id and entity_id = p_entity_id and status = 'pending';

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
