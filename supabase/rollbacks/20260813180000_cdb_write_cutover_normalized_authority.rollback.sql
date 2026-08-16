--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- ROLLBACK for 20260813180000_cdb_write_cutover_normalized_authority.sql
--
-- Restores LEGACY as the input authority for the four CDB writers by reinstating their prior
-- definitions verbatim. `bolao.cdb_authoritative_document()` is deliberately LEFT IN PLACE: it is
-- read-only, nothing references it after this file runs, and dropping it would make re-advancing
-- a two-step operation for no benefit.
--
-- No data is reconstructed and none needs to be. Every write accepted while normalized was
-- authoritative was merged into the legacy document inside the same transaction, so the legacy
-- document is already current the moment this file is applied. Proven by GNG-3W: four authority
-- transitions, every prior write preserved across each, zero backfill statements between them.
--

begin;

CREATE OR REPLACE FUNCTION public.cdb_save_my_picks(p_token text, p_client_ref text, p_picks jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_entry_id text;
  v_state    jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_cutoff   timestamptz;
  v_fase     text;
  v_agora    timestamptz := now();
  v_versao   text;
begin
  if p_client_ref is null or length(trim(p_client_ref)) = 0 then
    raise exception 'cdb_save_my_picks: client_ref obrigatorio (idempotencia)';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then
    raise exception 'cdb_save_my_picks: picks precisa ser objeto';
  end if;
  if length(p_picks::text) > 20000 then
    raise exception 'cdb_save_my_picks: picks grande demais';
  end if;

  v_entry_id := _cdb_entry_id_from_token(p_token);
  if v_entry_id is null then
    raise exception 'ACESSO_NEGADO';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  if v_state is null then
    raise exception 'ACESSO_NEGADO';
  end if;
  if coalesce(v_state->'deletedIds','[]'::jsonb) ? v_entry_id then
    raise exception 'ACESSO_NEGADO';
  end if;

  select ord - 1, e into v_idx, v_entry
    from jsonb_array_elements(coalesce(v_state->'entries','[]'::jsonb)) with ordinality as t(e, ord)
   where e->>'id' = v_entry_id
   limit 1;
  if v_entry is null then
    raise exception 'ACESSO_NEGADO';
  end if;

  -- NENHUM EVENTO PARA SAVE QUE NAO GRAVOU NADA. Os dois ramos abaixo saem ANTES do UPDATE e
  -- antes da criacao da obrigacao. O comprovante confirma um estado gravado novo, nao um clique
  -- no botao Salvar.
  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente');
  end if;

  if coalesce(v_entry->'picks','null'::jsonb) is not distinct from coalesce(p_picks,'null'::jsonb) then
    return jsonb_build_object('updated', false, 'reason', 'identico');
  end if;

  v_fase := nullif(v_state->'espnSync'->>'activePhaseId','');
  if v_fase is null then
    raise exception 'FASE_FECHADA: nenhuma fase ativa declarada';
  end if;

  begin
    v_cutoff := nullif(v_state->'phases'->v_fase->>'cutoffAt','')::timestamptz;
  exception when others then
    raise exception 'CUTOFF_ILEGIVEL: fase % tem cutoffAt invalido', v_fase;
  end;

  if v_cutoff is null then
    raise exception 'FASE_FECHADA: fase % ainda nao tem prazo oficial publicado', v_fase;
  end if;
  if v_agora >= v_cutoff then
    raise exception 'CUTOFF_PASSADO: fase % fechou em %', v_fase, v_cutoff;
  end if;

  v_entry := v_entry
    || jsonb_build_object('picks', p_picks)
    || jsonb_build_object('updatedAt', to_char(v_agora at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || jsonb_build_object('lastClientRef', p_client_ref);

  update bolao_state
     set state = jsonb_set(state, array['entries', v_idx::text], v_entry),
         updated_at = v_agora
   where id = 'cdb2026';

  -- ─── NORMALIZED WRITE MIRROR (20260813140000, stamp added 20260813150000) ──────────────────
  --
  -- Same transaction as the legacy UPDATE above. Legacy remains the write AUTHORITY; this keeps
  -- the normalized read model from going stale the moment a participant saves.
  --
  -- NO exception handler, deliberately. Catching here would produce a committed legacy write
  -- beside a stale normalized model — the exact silent divergence the mirror exists to prevent.
  --
  -- v_agora is passed rather than re-read: the mirror must record the SAME instant the legacy
  -- entry was stamped with, not the instant the mirror happened to run.
  perform bolao.cdb_mirror_entry_picks(
            (select pe.pool_entry_id
               from bolao.pool_entries pe
               join bolao.pools pl on pl.pool_id = pe.pool_id and pl.slug = 'cdb2026'
              where pe.legacy_entry_id = v_entry_id::uuid),
            p_picks, v_agora);

  -- ── A OBRIGACAO, IDENTIFICADA PELA VERSAO GRAVADA ─────────────────────────────────────────
  --
  -- Forma canonica por LISTA DE PERMISSAO: so `matches` e `qualified` entram. Campo transitorio
  -- que apareca no payload amanha fica de fora sem ninguem precisar proibi-lo, e token/endereco/
  -- PII nunca entram porque nunca estao aqui.
  --
  -- O hash sai do `jsonb`, que ja e canonico: chaves ordenadas, sem espaco em branco, numeros
  -- normalizados. Mesma previsao escrita em outra ordem de propriedades da o MESMO hash.
  if exists (select 1 from bolao.cdb_confirmation_allowance a where a.entry_id = v_entry_id) then
    -- UMA definicao de versao, compartilhada com o teste. Ver `cdb_picks_version` acima.
    v_versao := public.cdb_picks_version(p_picks);

    insert into bolao.outbox_events (idempotency_key, channel, event_type, payload)
    values ('cdb2026:entry-saved-confirmation:' || v_entry_id || ':' || v_versao || ':v1',
            'email',
            'cdb2026.entry_saved_confirmation',
            -- `picksVersion` e hash, nao conteudo: o consumidor precisa dele para montar a chave
            -- de entrega, e um hash nao reidrata palpite nem identifica pessoa.
            jsonb_build_object('entryId', v_entry_id, 'savedAt', v_agora,
                               'picksVersion', v_versao))
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('updated', true);
end $function$
;
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
      -- NUNCA SOBRESCREVER UM CONFRONTO JA TRAVADO.
      --
      -- Quem avanca define pontuacao e premio, e ao travar o resultado ja foi comunicado.
      -- Retravar com o MESMO lado e no-op (retry/reexecucao nao podem virar erro); com lado
      -- DIFERENTE e recusado. Corrigir exige unlock-tie: ato deliberado, nao efeito colateral.
      if v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId' is not null then
        if v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId'
           is distinct from (p_payload->>'qualifiedTeamId') then
          raise exception 'lock-tie: %/% ja travado com %; use unlock-tie antes de mudar',
            v_fase, v_tie, v_state->'phases'->v_fase->'ties'->v_tie->>'qualifiedTeamId';
        end if;
        return jsonb_build_object('applied', false, 'reason', 'ja travado com o mesmo lado');
      end if;
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

  -- ─── NORMALIZED MIRROR (20260813160000) ────────────────────────────────────────────────
  --
  -- Same transaction as the authoritative UPDATE below. Reached only AFTER the dispatch above has
  -- accepted the mutation, so every validation still decides; this only reflects the result.
  --
  -- It reads v_state — the document this function has just finished computing — rather than
  -- p_payload. That is deliberate: twelve payload interpretations would be twelve chances to
  -- disagree with the twelve directly above, and a thirteenth mutation kind would silently mirror
  -- nothing. Reading the result cannot disagree with itself.
  --
  -- No exception handler. A mirror that cannot represent an accepted mutation must fail the whole
  -- mutation; a caught error would commit legacy beside a stale normalized model, which is the
  -- divergence being closed.
  perform bolao.cdb_mirror_phase(v_fase, v_state->'phases'->v_fase);
  perform bolao.cdb_mirror_entry_scoped(v_state);
  perform bolao.cdb_mirror_sync_state(v_state);

  update bolao_state set state = v_state, updated_at = v_agora where id = 'cdb2026';

  return jsonb_build_object('applied', true, 'type', p_type,
    'auditLogSize', jsonb_array_length(v_state->'auditLog'));
end $function$
;
CREATE OR REPLACE FUNCTION public.cdb_register_bracket_topology(p_phase_id text, p_slots jsonb, p_provenance jsonb, p_actor text DEFAULT 'operator'::text, p_client_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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

  -- ─── NORMALIZED MIRROR (20260813160000) ────────────────────────────────────────────────
  -- Topology is class A: cdb2026 renders no slots for a phase whose topology provenance does not
  -- validate, so a registration that reached legacy but not the normalized model would make the
  -- phase disappear at read cutover. Same transaction, no exception handler.
  perform bolao.cdb_mirror_phase(p_phase_id, v_state->'phases'->p_phase_id);

  update bolao_state set state = v_state, updated_at = now() where id = 'cdb2026';
  return jsonb_build_object('applied', true, 'phaseId', p_phase_id, 'slots', v_n_slots);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cdb_refresh_topology_provenance(p_phase_id text, p_slots jsonb, p_provenance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_state jsonb;
  v_atual jsonb;
  v_iso   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if coalesce(p_provenance->>'authority','') <> 'CBF' then
    raise exception 'TOPOLOGY_PROVENANCE: authority deve ser CBF';
  end if;
  if coalesce(p_provenance->>'source','') = '' then
    raise exception 'TOPOLOGY_PROVENANCE: campo `source` obrigatorio (o app exige)';
  end if;

  select state into v_state from bolao_state where id = 'cdb2026' for update;
  v_atual := v_state->'phases'->p_phase_id->'topology'->'slots';
  if v_atual is null then
    raise exception 'TOPOLOGY_AUSENTE: registre a topologia antes de refrescar a proveniencia';
  end if;
  -- As VAGAS tem de ser identicas. Esta funcao documenta; nao rechaveia.
  if v_atual <> p_slots then
    raise exception 'TOPOLOGY_SLOTS_DIFEREM: esta funcao so atualiza proveniencia';
  end if;

  v_state := jsonb_set(v_state, array['phases', p_phase_id, 'topology', 'provenance'],
                       p_provenance || jsonb_build_object('refreshedAt', v_iso), true);
  -- ─── NORMALIZED MIRROR (20260813160000) ────────────────────────────────────────────────
  -- Topology is class A: cdb2026 renders no slots for a phase whose topology provenance does not
  -- validate, so a registration that reached legacy but not the normalized model would make the
  -- phase disappear at read cutover. Same transaction, no exception handler.
  perform bolao.cdb_mirror_phase(p_phase_id, v_state->'phases'->p_phase_id);

  update bolao_state set state = v_state, updated_at = now() where id = 'cdb2026';
  return jsonb_build_object('refreshed', true, 'phaseId', p_phase_id);
end;
$function$
;

commit;
