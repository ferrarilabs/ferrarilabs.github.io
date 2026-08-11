-- 023_claim_skips_manual_action.sql — reivindicacao nao toca job que aguarda decisao humana.
--
-- ─── O DEFEITO ───────────────────────────────────────────────────────────────────────────────
--
-- `claim_bolao_notif` reivindica ATE p_limit jobs elegiveis do pool. O chamador pede um sorteio
-- especifico e filtra o retorno -- mas os OUTROS jobs ja foram reivindicados como efeito
-- colateral: status vira 'processing', attempt_count incrementa, lease e criado.
--
-- Consequencia concreta: processar o sorteio de 2026-08-10 mutava o job historico de 2026-08-08,
-- que esta marcado `requiresManualAction` e cujo unico destinatario pendente e uma pessoa real
-- que ainda nao recebeu o resultado. Cada execucao agendada -- de 10 em 10 minutos -- somava uma
-- tentativa naquele job. Ao bater `max_attempts` ele sairia da elegibilidade para sempre, e o
-- catch-up legitimo, quando o Eduardo o autorizasse, nao teria mais como acontecer.
--
-- Descoberto por um teste que reproduz a noite de hoje: 08/08 marcado + 08/10 com resultado.
-- O `attempt_count` do job historico e ele proprio um dado de auditoria, e estava sendo corroido
-- por execucoes que nunca tiveram intencao de toca-lo.
--
-- ─── A CORRECAO ──────────────────────────────────────────────────────────────────────────────
--
-- A exclusao vive AQUI, na consulta de elegibilidade, e nao no chamador. Um filtro no chamador
-- protege quem lembra de filtrar; um filtro no banco protege todo mundo, inclusive o script que
-- alguem escrever daqui a seis meses.
--
-- ADITIVA: nenhuma coluna, tabela ou grant muda. Apenas a clausula de elegibilidade.
-- ROLLBACK: reaplicar a definicao anterior (ver git deste arquivo / migracao 010).

create or replace function claim_bolao_notif(
  p_pool_id text, p_worker text, p_limit integer default 10, p_lease_seconds integer default 300
) returns table (
  job_id uuid, entity_id text, event_type text, event_version integer, entry_ref text,
  template_id text, template_version integer, payload_snapshot jsonb, idempotency_key text,
  attempt_count integer, max_attempts integer, schema_version integer
)
language plpgsql security definer set search_path = public as $function$
begin
  return query
  with eligible as (
    select j.job_id from bolao_notif_jobs j
    where j.pool_id = p_pool_id
      and j.status in ('pending', 'failed_retryable')
      and j.next_attempt_at <= now()
      and j.attempt_count < j.max_attempts
      -- Job que aguarda decisao humana nunca e reivindicado automaticamente, nem de passagem.
      and coalesce((j.payload_snapshot->>'requiresManualAction')::boolean, false) = false
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
end $function$;

revoke all on function claim_bolao_notif(text, text, integer, integer) from anon, public, authenticated;
grant execute on function claim_bolao_notif(text, text, integer, integer) to service_role;

-- Devolve o job historico ao estado correto caso alguma execucao ja o tenha reivindicado.
update bolao_notif_jobs
   set status = 'failed_retryable'::bolao_notif_status, claimed_by = null,
       claimed_at = null, lease_expires_at = null
 where idempotency_key = 'powerball:draw-result:2026-08-08:v1'
   and status = 'processing';

select idempotency_key, status::text, attempt_count, max_attempts
  from bolao_notif_jobs where pool_id = 'powerball' order by entity_id;

-- O job historico ja tinha 3 de 5 tentativas consumidas por execucoes agendadas que nunca
-- tiveram intencao de toca-lo. Mais duas e ele sairia da elegibilidade para sempre -- e o
-- catch-up legitimo do Rodrigo, quando autorizado, nao teria mais como acontecer.
--
-- O contador volta a zero porque aquelas tentativas nao foram tentativas de entrega: nenhuma
-- chegou ao provedor. O fato fica registrado no payload, que e onde a auditoria olha.
update bolao_notif_jobs
   set attempt_count = 0,
       payload_snapshot = payload_snapshot || jsonb_build_object(
         'attemptCountResetAt', now(),
         'attemptCountResetReason',
         'Tres tentativas foram consumidas por claim_bolao_notif reivindicando este job de '
         || 'passagem enquanto processava outro sorteio (corrigido na migracao 023). Nenhuma '
         || 'delas chegou ao provedor: providerCalls = 0 em todas. Contador zerado para nao '
         || 'inviabilizar o catch-up legitimo.')
 where idempotency_key = 'powerball:draw-result:2026-08-08:v1';

select attempt_count, payload_snapshot->>'requiresManualAction' as manual,
       payload_snapshot->>'attemptCountResetReason' is not null as registrado
  from bolao_notif_jobs where idempotency_key = 'powerball:draw-result:2026-08-08:v1';
