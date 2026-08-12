--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812210000_cdb_register_bracket_topology.sql
--
-- ═══ POR QUE ISTO PRECISA EXISTIR ════════════════════════════════════════════════════════════
--
-- `register-bracket-topology` so existia em `applyAdminMutation()` no NAVEGADOR. Desde que a
-- escrita de documento inteiro pelo navegador foi removida, aquele caminho e letra morta: nao ha
-- como registrar a topologia oficial da semifinal.
--
-- O sorteio das quartas de 2026-08-11 definiu tambem o caminho ate a final. Sem um caminho
-- confiavel para gravar isso, a semifinal fica sem confronto e o participante nao consegue
-- palpitar alem das quartas -- que e o defeito relatado.
--
-- ═══ O QUE ESTA FUNCAO NAO FAZ ═══════════════════════════════════════════════════════════════
--
-- Nao DERIVA emparelhamento. Nao existe convencao embutida (nada de "qf-1 x qf-2"): as vagas vem
-- inteiras no payload, e a funcao so as valida. Topologia inventada e chaveamento oficial falso,
-- e decide quem avanca -- ou seja, decide dinheiro.
--
-- ═══ VALIDACAO (espelha validateTopology() do app.js) ════════════════════════════════════════
--
--   fase derivada          semifinal<-quartas, final<-semifinal; qualquer outra e recusada
--   predecessora com ties  registrar topologia sobre fase vazia nao significa nada
--   contagem de vagas      exatamente metade dos confrontos da predecessora
--   winnerOf conhecido     cada lado aponta para um confronto QUE EXISTE na predecessora
--   sem duplicata          um confronto alimenta UMA vaga; dois lados iguais e recusado
--   proveniencia           authority='CBF' + ingestedAt + validatedAt + sourceUrl obrigatorios
--
-- A proveniencia e exigida pela mesma razao que no sorteio: `officialDrawProvenanceIsValid()`
-- trata registro sem proveniencia como NAO validado, e uma topologia que o app se recusa a
-- reconhecer seria pior que nenhuma -- pareceria configurada.
--
-- IDEMPOTENTE: registrar a MESMA topologia de novo e no-op. Registrar DIFERENTE, com a fase ja
-- travada, e recusado -- mudar o caminho depois que participantes palpitaram reescreveria o
-- significado dos palpites deles.
--
-- ROLLBACK: `drop function public.cdb_register_bracket_topology(...)`. Nada existente e alterado.

create or replace function public.cdb_register_bracket_topology(
  p_phase_id   text,
  p_slots      jsonb,
  p_provenance jsonb,
  p_actor      text default 'operator',
  p_client_ref text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_state      jsonb;
  v_pred       text;
  v_pred_ties  jsonb;
  v_n_pred     int;
  v_n_slots    int;
  v_slot       record;
  v_a          text;
  v_b          text;
  v_usados     text[] := '{}';
  v_atual      jsonb;
  v_iso        text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- Fase DERIVADA. Semifinal e final nao tem sorteio proprio; as demais tem, e registrar
  -- topologia nelas seria contornar o sorteio.
  v_pred := case p_phase_id when 'semifinal' then 'quartas'
                            when 'final'     then 'semifinal' end;
  if v_pred is null then
    raise exception 'TOPOLOGY_PHASE_NOT_DERIVED: %', p_phase_id;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'object' then
    raise exception 'TOPOLOGY_MALFORMED: slots ausente ou nao e objeto';
  end if;

  -- Proveniencia: sem ela o app trata a topologia como nao validada.
  if coalesce(p_provenance->>'authority','') <> 'CBF' then
    raise exception 'TOPOLOGY_PROVENANCE: authority deve ser CBF (veio %)',
      coalesce(p_provenance->>'authority','(vazio)');
  end if;
  if coalesce(p_provenance->>'sourceUrl','') = ''
     or coalesce(p_provenance->>'ingestedAt','') = ''
     or coalesce(p_provenance->>'validatedAt','') = '' then
    raise exception 'TOPOLOGY_PROVENANCE: sourceUrl, ingestedAt e validatedAt sao obrigatorios';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then raise exception 'ESTADO_AUSENTE'; end if;

  v_pred_ties := v_state->'phases'->v_pred->'ties';
  if v_pred_ties is null or jsonb_typeof(v_pred_ties) <> 'object' then
    raise exception 'TOPOLOGY_PREDECESSOR_EMPTY: %', v_pred;
  end if;
  select count(*) into v_n_pred from jsonb_object_keys(v_pred_ties);
  if v_n_pred = 0 then raise exception 'TOPOLOGY_PREDECESSOR_EMPTY: %', v_pred; end if;
  if v_n_pred % 2 <> 0 then
    raise exception 'TOPOLOGY_PREDECESSOR_ODD: %: %', v_pred, v_n_pred;
  end if;

  select count(*) into v_n_slots from jsonb_object_keys(p_slots);
  if v_n_slots <> v_n_pred / 2 then
    raise exception 'TOPOLOGY_SLOT_COUNT: esperava % vagas, veio %', v_n_pred / 2, v_n_slots;
  end if;

  for v_slot in select key as slot_id, value as slot from jsonb_each(p_slots) loop
    v_a := v_slot.slot->'sideA'->>'winnerOf';
    v_b := v_slot.slot->'sideB'->>'winnerOf';
    if v_a is null or v_b is null then
      raise exception 'TOPOLOGY_MALFORMED: %.sideA/sideB sem winnerOf', v_slot.slot_id;
    end if;
    if v_a = v_slot.slot_id or v_b = v_slot.slot_id then
      raise exception 'TOPOLOGY_CIRCULAR: % depende de si mesmo', v_slot.slot_id;
    end if;
    if v_a = v_b then
      raise exception 'TOPOLOGY_DUPLICATE_PREDECESSOR: %', v_a;
    end if;
    if v_pred_ties->v_a is null then
      raise exception 'TOPOLOGY_UNKNOWN_TIE: %.sideA -> %', v_slot.slot_id, v_a;
    end if;
    if v_pred_ties->v_b is null then
      raise exception 'TOPOLOGY_UNKNOWN_TIE: %.sideB -> %', v_slot.slot_id, v_b;
    end if;
    if v_a = any(v_usados) then raise exception 'TOPOLOGY_DUPLICATE_PREDECESSOR: %', v_a; end if;
    if v_b = any(v_usados) then raise exception 'TOPOLOGY_DUPLICATE_PREDECESSOR: %', v_b; end if;
    v_usados := v_usados || v_a || v_b;
  end loop;

  -- Idempotencia / imutabilidade: mesma topologia = no-op; diferente com fase ja registrada =
  -- recusa. Mudar o caminho depois que gente palpitou reescreve o significado dos palpites.
  v_atual := v_state->'phases'->p_phase_id->'topology'->'slots';
  if v_atual is not null then
    if v_atual = p_slots then
      return jsonb_build_object('applied', false, 'reason', 'topologia identica ja registrada');
    end if;
    raise exception 'TOPOLOGY_ALREADY_REGISTERED: % ja tem topologia diferente; mudar depois de '
                    'palpites reescreveria o significado deles', p_phase_id;
  end if;

  v_state := jsonb_set(
    v_state,
    array['phases', p_phase_id, 'topology'],
    jsonb_build_object(
      'slots', p_slots,
      'provenance', p_provenance || jsonb_build_object('registeredAt', v_iso, 'actor', p_actor)
    ),
    true
  );

  update bolao_state set state = v_state, updated_at = now() where id = 'cdb2026';
  return jsonb_build_object('applied', true, 'phaseId', p_phase_id, 'slots', v_n_slots);
end;
$$;

revoke all on function public.cdb_register_bracket_topology(text,jsonb,jsonb,text,text) from public;
revoke all on function public.cdb_register_bracket_topology(text,jsonb,jsonb,text,text) from anon;
revoke all on function public.cdb_register_bracket_topology(text,jsonb,jsonb,text,text) from authenticated;
grant execute on function public.cdb_register_bracket_topology(text,jsonb,jsonb,text,text) to service_role;

select 'cdb_register_bracket_topology criada (valida, nao deriva)' as resultado;
