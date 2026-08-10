-- 014_fix_release_expired_cast.sql — F7. Correcao de defeito real na 010.
--
-- `release_expired_bolao_notif` nunca conseguiu executar: o CASE devolve `text` e a coluna
-- `status` e do enum `bolao_notif_status`, e o Postgres nao converte implicitamente numa
-- atribuicao de UPDATE. Toda chamada falhava com 42804.
--
-- Por que os testes locais nao pegaram: o contrato estatico verificava a PRESENCA das construcoes
-- no arquivo SQL (`for update skip locked`, `unique`, `security definer`, `lease_expires_at`),
-- nunca a EXECUCAO das funcoes. Um teste que le texto nao descobre erro de tipo -- so a chamada
-- real contra o banco descobre. Registrado como N23.
--
-- O impacto seria silencioso e serio: jobs cujo runner morreu ficariam presos em `processing`
-- para sempre, porque a unica rotina que os liberaria nao roda. A fila pararia sem alarme.
--
-- ROLLBACK: reaplicar a definicao anterior (rodape da 010). Nao ha estado a reverter --
-- a funcao antiga nunca teve efeito.

create or replace function release_expired_bolao_notif(p_pool_id text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with released as (
    update bolao_notif_jobs
       set status = (case when attempt_count >= max_attempts
                          then 'failed_permanent'
                          else 'failed_retryable' end)::bolao_notif_status,
           claimed_by = null, lease_expires_at = null,
           last_error = coalesce(last_error, 'lease expirado: runner/processo terminou sem finalizar')
     where pool_id = p_pool_id and status = 'processing'
       and lease_expires_at is not null and lease_expires_at < now()
    returning 1
  )
  select count(*) into v_count from released;
  return coalesce(v_count, 0);
end $$;
