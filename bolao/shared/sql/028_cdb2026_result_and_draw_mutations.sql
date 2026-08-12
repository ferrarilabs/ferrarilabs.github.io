-- 028_cdb2026_result_and_draw_mutations.sql — as quatro operacoes estreitas que faltavam.
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- PLATFORM-WHOLE-DOC-WRITERS. Gravar um placar do cdb2026 so era possivel reescrevendo o
-- DOCUMENTO INTEIRO: `send_result_email.py:255` (POST) e `operator_cli.py:69` (PATCH) liam,
-- mudavam um campo em Python e regravavam o todo, sem token de concorrencia comum. Duas
-- gravacoes de legs diferentes perdiam uma.
--
-- Os quatro tipos novos -- save-leg, clear-leg, backfill-kickoff, create-tie -- foram DERIVADOS
-- daqueles dois scripts campo a campo. NAO sao copia do copa2026: o cdb tem confronto de duas
-- maos, e a inversao de mando da volta e regra propria dele.
--
-- A funcao inteira e reemitida a partir da DEFINICAO VIVA (pg_get_functiondef), com os ramos
-- novos inseridos antes do else. Os sete tipos que ja existiam passam byte a byte.
--
-- AUTORIZACAO: inalterada. service_role apenas. Nenhum tipo novo alcanca anon.
-- ROLLBACK: reaplique 026_cdb2026_operator_mutations.sql, que reemite a versao de sete tipos.

CREATE OR REPLACE FUNCTION public.cdb_apply_operator_mutation(p_type text, p_payload jsonb, p_actor text, p_client_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- OS DOIS CAMPOS, e este e um defeito corrigido, nao um enfeite.
    --
    -- `entryCutoffMs()` no js/app.js le `s.espnSync.activePhaseId`, NAO `s.activePhase`. Gravar so
    -- o segundo foi exatamente o incidente que o operator_cli.py documenta: o banco passou a dizer
    -- "quartas", o app continuou em "oitavas" -- cujo prazo ja vencera -- e tratou a entrada como
    -- ENCERRADA. Os confrontos estavam em producao, o formulario existia no DOM, e nenhum
    -- participante via nada. O CLI ja gravava os dois; esta RPC gravava so um.
    v_state := jsonb_set(v_state, '{activePhase}', coalesce(p_payload->'phaseId','null'::jsonb));
    v_state := jsonb_set(v_state, '{espnSync}',
                 coalesce(v_state->'espnSync','{}'::jsonb)
                 || jsonb_build_object('activePhaseId', coalesce(p_payload->'phaseId','null'::jsonb)), true);

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


  -- ── PLATFORM-WHOLE-DOC-WRITERS: as quatro operacoes que faltavam ──────────────────────────
  --
  -- Ate aqui, gravar um placar do cdb2026 so era possivel reescrevendo o DOCUMENTO INTEIRO --
  -- `send_result_email.py` e `operator_cli.py` liam, mudavam um campo em Python e regravavam o
  -- todo. Duas gravacoes concorrentes de legs diferentes perdiam uma. O contrato abaixo foi
  -- DERIVADO desses dois scripts, campo a campo, nao copiado do copa2026: o cdb tem confronto de
  -- duas maos e o copa nao, e a convencao de mando da volta e do proprio cdb.

  elsif p_type = 'save-leg' then
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'save-leg: confronto %/% inexistente', coalesce(v_fase,'(nula)'), coalesce(v_tie,'(nulo)');
    end if;
    if p_payload->>'leg' not in ('first','second') then
      raise exception 'save-leg: leg precisa ser first ou second, veio %', coalesce(p_payload->>'leg','(nulo)');
    end if;
    -- Teste de TIPO, nunca de verdade: 0-0 e um placar real e um `if (!goals)` o descartaria.
    if jsonb_typeof(p_payload->'goalsHome') <> 'number' or jsonb_typeof(p_payload->'goalsAway') <> 'number' then
      raise exception 'save-leg: goalsHome e goalsAway precisam ser numeros';
    end if;
    -- MANDO DE CAMPO DA VOLTA. A segunda mao inverte: home=teamB, away=teamA. Isto e regra do
    -- cdb2026 (send_result_email.py sb_save_leg, espelhando renderAdminResults no app.js) e e
    -- calculada AQUI a partir do confronto gravado -- nunca aceita do chamador, senao o cliente
    -- poderia declarar o mando ao contrario e o placar entraria trocado.
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie,'matches',p_payload->>'leg'],
      coalesce(v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg'), '{}'::jsonb)
      || jsonb_build_object(
           'homeTeam', case when p_payload->>'leg' = 'second'
                            then v_state->'phases'->v_fase->'ties'->v_tie->'teamB'
                            else v_state->'phases'->v_fase->'ties'->v_tie->'teamA' end,
           'awayTeam', case when p_payload->>'leg' = 'second'
                            then v_state->'phases'->v_fase->'ties'->v_tie->'teamA'
                            else v_state->'phases'->v_fase->'ties'->v_tie->'teamB' end,
           'goalsHome', p_payload->'goalsHome',
           'goalsAway', p_payload->'goalsAway',
           'status', 'FINAL',
           'resultSource', coalesce(p_payload->>'resultSource','espn-auto')), true);

  elsif p_type = 'clear-leg' then
    -- RETRATACAO, e ela e composta de proposito: limpar o placar sem destravar o confronto
    -- deixaria um classificado apoiado num resultado que nao existe mais. Os dois campos andam
    -- juntos porque o script que isto substitui ja os movia juntos.
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie is null then
      raise exception 'clear-leg: confronto %/% inexistente', coalesce(v_fase,'(nula)'), coalesce(v_tie,'(nulo)');
    end if;
    if p_payload->>'leg' not in ('first','second') then
      raise exception 'clear-leg: leg precisa ser first ou second';
    end if;
    if v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg') is not null then
      -- NULL explicito, nao remocao da chave: o app distingue "sem resultado" de "sem jogo".
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie,'matches',p_payload->>'leg'],
        (v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg'))
        || jsonb_build_object('goalsHome', 'null'::jsonb, 'goalsAway', 'null'::jsonb, 'status', 'SCHEDULED'), true);
    end if;
    if coalesce(v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId','') <> '' then
      v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie],
        (v_state->'phases'->v_fase->'ties'->v_tie)
        || jsonb_build_object('qualifiedTeamId','null'::jsonb,'lockedAt','null'::jsonb,'lockedBy','null'::jsonb), true);
    end if;

  elsif p_type = 'backfill-kickoff' then
    -- So o horario. NAO toca placar, status nem classificacao: o backfill de agenda roda depois
    -- que a ESPN publica a tabela detalhada, e um leg ja finalizado nao pode voltar a SCHEDULED
    -- porque a data chegou atrasada.
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase->'ties'->v_tie->'matches'->(p_payload->>'leg') is null then
      raise exception 'backfill-kickoff: leg %/%/% inexistente', coalesce(v_fase,'(nula)'), coalesce(v_tie,'(nulo)'), coalesce(p_payload->>'leg','(nulo)');
    end if;
    if p_payload->>'kickoff' is null then
      raise exception 'backfill-kickoff: kickoff obrigatorio';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie,'matches',p_payload->>'leg','kickoff'],
                         to_jsonb(p_payload->>'kickoff'), true);

  elsif p_type = 'set-official-draw' then
    -- A PROVENIENCIA do sorteio, e ela mora DENTRO da fase, nao na raiz do estado. O
    -- operator_cli.py registra que a primeira versao gravou na raiz e os confrontos ficaram
    -- invisiveis, porque `enforceDrawLifecycle` procura `phase.officialDraw`.
    --
    -- O objeto passa INTEIRO e sem interpretacao: authority, source, sourceUrl, corroboratedBy,
    -- bracketHash, ingestedAt, scheduledAt, validatedAt, validatedBy, note. Reescrever qualquer
    -- um deles aqui seria inventar procedencia de sorteio oficial.
    v_fase := p_payload->>'phaseId';
    if v_state->'phases'->v_fase is null then
      raise exception 'set-official-draw: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if jsonb_typeof(p_payload->'officialDraw') <> 'object' then
      raise exception 'set-official-draw: officialDraw precisa ser objeto';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'officialDraw'], p_payload->'officialDraw', true);

  elsif p_type = 'set-schedule-provenance' then
    -- A procedencia da AGENDA, irma de set-official-draw e deliberadamente separada dela: um
    -- sorteio e uma tabela de horarios sao duas afirmacoes diferentes sobre a mesma fase, com
    -- fontes e instantes diferentes. Fundi-las num campo so perderia qual delas foi atualizada.
    v_fase := p_payload->>'phaseId';
    if v_state->'phases'->v_fase is null then
      raise exception 'set-schedule-provenance: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if jsonb_typeof(p_payload->'scheduleProvenance') <> 'object' then
      raise exception 'set-schedule-provenance: scheduleProvenance precisa ser objeto';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'scheduleProvenance'],
                         p_payload->'scheduleProvenance', true);

  elsif p_type = 'create-tie' then
    -- O sorteio oficial. Cria o confronto E as duas maos numa transacao so: um confronto sem
    -- `matches` e uma estrutura pela metade que o app renderiza como jogo inexistente.
    --
    -- NAO aceita fragmento de documento. Os campos sao nomeados um a um; o que o payload trouxer
    -- alem disto e ignorado, e o que faltar levanta.
    v_fase := p_payload->>'phaseId';
    v_tie  := p_payload->>'tieId';
    if v_state->'phases'->v_fase is null then
      raise exception 'create-tie: fase % inexistente', coalesce(v_fase,'(nula)');
    end if;
    if v_tie is null or v_tie = '' then
      raise exception 'create-tie: tieId obrigatorio';
    end if;
    if v_state->'phases'->v_fase->'ties'->v_tie is not null then
      raise exception 'create-tie: confronto %/% ja existe — use remove-tie primeiro', v_fase, v_tie;
    end if;
    if coalesce(p_payload->>'teamA','') = '' or coalesce(p_payload->>'teamB','') = '' then
      raise exception 'create-tie: teamA e teamB obrigatorios';
    end if;
    if p_payload->>'teamA' = p_payload->>'teamB' then
      raise exception 'create-tie: um time nao joga contra si mesmo';
    end if;
    v_state := jsonb_set(v_state, array['phases',v_fase,'ties',v_tie], jsonb_build_object(
      'teamA', p_payload->'teamA',
      'teamB', p_payload->'teamB',
      -- Sem classificado e sem trava: um confronto recem-sorteado nao tem vencedor. Inventar
      -- qualifiedTeamId aqui seria decidir o jogo no momento do sorteio.
      'qualifiedTeamId', 'null'::jsonb,
      'matches', jsonb_build_object(
        'first',  jsonb_build_object('homeTeam', p_payload->'teamA', 'awayTeam', p_payload->'teamB',
                                     'goalsHome','null'::jsonb,'goalsAway','null'::jsonb,
                                     'status','SCHEDULED','kickoff', coalesce(p_payload->'kickoffFirst','null'::jsonb)),
        -- A volta inverte o mando, mesma regra que save-leg aplica.
        'second', jsonb_build_object('homeTeam', p_payload->'teamB', 'awayTeam', p_payload->'teamA',
                                     'goalsHome','null'::jsonb,'goalsAway','null'::jsonb,
                                     'status','SCHEDULED','kickoff', coalesce(p_payload->'kickoffSecond','null'::jsonb))
      )), true);

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
end $function$
