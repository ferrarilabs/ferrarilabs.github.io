-- 026_cdb2026_operator_mutations.sql — mutacoes de operador do CDB2026, do lado do servidor.
--
-- ─── POR QUE ISTO NAO E `write_state(json)` ──────────────────────────────────────────────────
--
-- Uma RPC generica que aceita o documento inteiro nao e melhora nenhuma: e o upsert atual com
-- outro nome. Esta funcao NAO substitui estado. Ela recebe um TIPO e um payload, valida os
-- campos daquele tipo especifico, e aplica so a transicao correspondente. Campo nao previsto
-- pelo tipo e ignorado; tipo desconhecido levanta.
--
-- O despacho unico existe porque o cliente ja fala nesta linguagem: `applyAdminMutation` no
-- app.js e um switch sobre 16 tipos, e `batch` os aplica em sequencia numa gravacao so. Espelhar
-- esse contrato mantem a semantica identica; espalhar em 16 RPCs com nomes diferentes obrigaria
-- a reimplementar o batch e abriria espaco para divergencia entre as duas metades.
--
-- ─── AUTORIZACAO ─────────────────────────────────────────────────────────────────────────────
--
-- Revogada de anon, de public e de authenticated. So `service_role` executa -- ou seja, so quem
-- roda a partir de um ambiente confiavel com a credencial privilegiada. O navegador nunca a
-- alcanca, com ou sem senha de admin: a senha de admin protege a UI, nao o banco.
--
-- ─── AUDITORIA ───────────────────────────────────────────────────────────────────────────────
--
-- Toda aplicacao acrescenta uma entrada em `auditLog` com tipo, ator, instante e client_ref.
-- Sem isso, "quem marcou este pagamento?" nao tem resposta.
--
-- ADITIVA: nao revoga permissao existente, nao altera policy, nao muda o app deployado.
-- ROLLBACK: `drop function cdb_apply_operator_mutation(text, jsonb, text, text);`

create or replace function cdb_apply_operator_mutation(
  p_type text,
  p_payload jsonb,
  p_actor text,
  p_client_ref text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
  v_fase text;
  v_tie text;
  v_agora timestamptz := now();
  v_iso text := to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_idx int;
  v_entry jsonb;
  v_antes jsonb;
begin
  if p_actor is null or length(trim(p_actor)) = 0 then
    raise exception 'cdb_apply_operator_mutation: actor obrigatorio (auditoria)';
  end if;
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_apply_operator_mutation: client_ref obrigatorio (idempotencia)';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'cdb_apply_operator_mutation: payload precisa ser objeto';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'cdb_apply_operator_mutation: estado do cdb2026 inexistente';
  end if;

  -- IDEMPOTENCIA: a mesma operacao reenviada (clique duplo, retry) nao se aplica duas vezes.
  if exists (select 1 from jsonb_array_elements(coalesce(v_state->'auditLog','[]'::jsonb)) a
              where a->>'clientRef' = p_client_ref) then
    return jsonb_build_object('applied', false, 'reason', 'idempotente');
  end if;

  v_antes := v_state;

  -- ── despacho por tipo ─────────────────────────────────────────────────
  if p_type = 'set-payment' then
    if p_payload->>'entryId' is null then
      raise exception 'set-payment: entryId obrigatorio';
    end if;
    if jsonb_typeof(p_payload->'value') <> 'boolean' then
      raise exception 'set-payment: value precisa ser booleano';
    end if;
    if not exists (select 1 from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) e
                    where e->>'id' = p_payload->>'entryId') then
      raise exception 'set-payment: entrada % inexistente', p_payload->>'entryId';
    end if;
    v_state := jsonb_set(v_state, array['paid', p_payload->>'entryId'], p_payload->'value');

  elsif p_type = 'delete-entry' then
    if p_payload->>'entryId' is null then
      raise exception 'delete-entry: entryId obrigatorio';
    end if;
    -- Lapide, nunca remocao fisica: a entrada some da UI e continua auditavel.
    v_state := jsonb_set(v_state, '{deletedIds}',
                 (select jsonb_agg(distinct x) from (
                    select jsonb_array_elements_text(coalesce(v_state->'deletedIds','[]'::jsonb)) as x
                    union select p_payload->>'entryId') u));

  elsif p_type = 'set-cutoff' then
    v_fase := p_payload->>'phaseId';
    if v_fase is null or v_state->'phases'->v_fase is null then
      raise exception 'set-cutoff: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if p_payload->>'cutoffAt' is not null then
      perform (p_payload->>'cutoffAt')::timestamptz;   -- levanta se nao for instante valido
    end if;
    v_state := jsonb_set(v_state, array['phases', v_fase, 'cutoffAt'],
                 coalesce(p_payload->'cutoffAt', 'null'::jsonb));

  elsif p_type = 'set-active-phase' then
    v_fase := p_payload->>'phaseId';
    if v_fase is not null and v_state->'phases'->v_fase is null then
      raise exception 'set-active-phase: fase % inexistente', v_fase;
    end if;
    v_state := jsonb_set(v_state, '{activePhase}', coalesce(p_payload->'phaseId','null'::jsonb));

  elsif p_type in ('lock-tie','unlock-tie') then
    v_fase := p_payload->>'phaseId'; v_tie := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception '%: confronto %/% inexistente', p_type, v_fase, v_tie;
    end if;
    if p_type = 'lock-tie' then
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        v_state->'phases'->v_fase->'ties'->v_tie
        || jsonb_build_object('locked', true, 'lockedAt', v_iso,
                              'lockedBy', p_actor,
                              'qualifiedTeamId', p_payload->'qualifiedTeamId'));
    else
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        (v_state->'phases'->v_fase->'ties'->v_tie - 'locked' - 'lockedAt' - 'lockedBy'));
    end if;

  elsif p_type = 'remove-tie' then
    v_fase := p_payload->>'phaseId'; v_tie := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'remove-tie: confronto %/% inexistente', v_fase, v_tie;
    end if;
    -- Confronto travado guarda resultado oficial: destravar e um ato deliberado e separado.
    if coalesce((v_state->'phases'->v_fase->'ties'->v_tie->>'locked')::boolean,false) then
      raise exception 'remove-tie: confronto %/% esta travado; destrave primeiro', v_fase, v_tie;
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties'],
                 (v_state->'phases'->v_fase->'ties') - v_tie);

  else
    -- Tipo desconhecido NUNCA e aplicado em silencio.
    raise exception 'cdb_apply_operator_mutation: tipo nao suportado: %', p_type;
  end if;

  -- ── auditoria ─────────────────────────────────────────────────────────
  v_state := jsonb_set(v_state, '{auditLog}',
    coalesce(v_state->'auditLog','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'type', p_type, 'actor', p_actor, 'at', v_iso,
      'clientRef', p_client_ref, 'payload', p_payload, 'source', 'server-rpc')));

  update bolao_state set state = v_state, updated_at = v_agora where id = 'cdb2026';

  return jsonb_build_object('applied', true, 'type', p_type,
    'auditLogSize', jsonb_array_length(v_state->'auditLog'));
end $$;

revoke all on function cdb_apply_operator_mutation(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function cdb_apply_operator_mutation(text, jsonb, text, text) to service_role;

select 'cdb_apply_operator_mutation criada, revogada de anon' as resultado;
