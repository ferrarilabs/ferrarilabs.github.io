-- 029_op_append_audit.sql — a narrow audit append, so the last whole-document writer can stop.
--
-- POR QUE ISTO EXISTE
--
-- `bolao/br2026/scripts/send_round_email.py` regravava o DOCUMENTO INTEIRO num cron DIARIO para
-- acrescentar UMA entrada de auditoria. Era o ultimo gravador de documento inteiro do br2026, e o
-- unico campo de negocio que ele realmente mudava era `auditLog` (insert no indice 0, cap 200) --
-- mais `meta.updatedAt`, que `_bolao_touch` ja faz.
--
-- `op_set_round_email` NAO servia: aquela grava `{roundEmail}`. Um nome parecido nao e um contrato.
--
-- POR QUE `_bolao_audit` NAO BASTAVA
--
-- `_bolao_audit(p_state, p_action, p_detail)` e uma funcao PURA: recebe um documento e devolve
-- outro. Ela nao grava. Usa-la do cliente exigiria ler o documento, passar por ela e regravar o
-- todo -- exatamente o formato que se quer aposentar. Esta RPC faz a leitura, a aplicacao e a
-- gravacao do lado do servidor, sob `for update`.
--
-- AUTORIZACAO: service_role apenas, como toda a familia op_*. anon nao alcanca.
-- ROLLBACK: `drop function op_append_audit(text, text, jsonb, text);`

create or replace function op_append_audit(
  p_pool_id text,
  p_action text,
  p_detail jsonb,
  p_client_ref text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_state jsonb;
begin
  if p_pool_id is null or p_pool_id not in ('br2026','cdb2026','main') then
    raise exception 'op_append_audit: competicao invalida: %', coalesce(p_pool_id,'(nula)');
  end if;
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'op_append_audit: action obrigatoria';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'op_append_audit: client_ref obrigatorio (idempotencia)';
  end if;

  select state into v_state from bolao_state where id = p_pool_id for update;
  if v_state is null then
    raise exception 'op_append_audit: estado inexistente para %', p_pool_id;
  end if;

  -- Idempotencia: o mesmo ref reenviado nao acrescenta uma segunda entrada. Um cron que roda a
  -- cada 30 minutos e reprocessa a mesma rodada nao deve encher o log com duplicatas.
  if exists (select 1 from jsonb_array_elements(coalesce(v_state->'auditLog','[]'::jsonb)) a
              where a->>'clientRef' = p_client_ref) then
    return jsonb_build_object('applied', false, 'reason', 'idempotente');
  end if;

  -- Insere no INDICE 0 e corta em 200, que e exatamente o que o script fazia. `_bolao_audit`
  -- prepende mas nao corta; o cap vive aqui porque e a regra do documento, nao da funcao pura.
  v_state := jsonb_set(v_state, '{auditLog}',
    (jsonb_build_array(jsonb_build_object(
        'ts', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'action', p_action, 'admin', true, 'clientRef', p_client_ref,
        'detail', coalesce(p_detail,'{}'::jsonb)))
     || coalesce(v_state->'auditLog','[]'::jsonb)), true);
  if jsonb_array_length(v_state->'auditLog') > 200 then
    v_state := jsonb_set(v_state, '{auditLog}',
      (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
         from jsonb_array_elements(v_state->'auditLog') with ordinality as t(e, ord)
        where ord <= 200), true);
  end if;

  update bolao_state set state = _bolao_touch(v_state), updated_at = now() where id = p_pool_id;
  return jsonb_build_object('applied', true, 'pool', p_pool_id, 'action', p_action);
end
$$;

comment on function op_append_audit(text, text, jsonb, text) is
  'Narrow audit append for any pool. service_role only. Replaces the last whole-document writer, which rewrote the entire document daily to add one log line.';

revoke all on function op_append_audit(text, text, jsonb, text) from public;
revoke all on function op_append_audit(text, text, jsonb, text) from anon;
revoke all on function op_append_audit(text, text, jsonb, text) from authenticated;
grant execute on function op_append_audit(text, text, jsonb, text) to service_role;
