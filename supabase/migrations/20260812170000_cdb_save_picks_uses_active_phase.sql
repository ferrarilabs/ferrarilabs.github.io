--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812170000_cdb_save_picks_uses_active_phase.sql
--
-- ═══ O DEFEITO, MEDIDO EM PRODUCAO ═══════════════════════════════════════════════════════════
--
-- `cdb_save_my_picks` (migracao 20260812070000, minha) tratava CADA CHAVE DE PRIMEIRO NIVEL de
-- `p_picks` como um id de fase, e exigia `cutoffAt` para cada uma.
--
-- Mas os palpites deste app nao sao indexados por fase. A forma real, tanto no estado gravado
-- quanto no que o navegador envia (`getPickValues()` em js/app.js), e PLANA:
--
--     {"matches": {<tieId>: {...}}, "qualified": {<tieId>: "A"|"B"}}
--
-- Entao a validacao lia "matches" e "qualified" como se fossem fases, procurava
-- `phases.matches.cutoffAt`, nao achava, e recusava:
--
--     FASE_FECHADA: fase matches ainda nao tem prazo oficial publicado
--
-- Consequencia: NENHUM participante conseguia salvar. Doze convites foram enviados hoje para um
-- formulario cujo botao Salvar sempre falharia.
--
-- ═══ POR QUE NAO FOI PEGO ANTES ══════════════════════════════════════════════════════════════
--
-- O canario exercitava a escrita com `{"quartas": {...}}` -- um payload com forma de fase, que
-- NAO e a forma que o app produz. Ele confirmou o modelo errado em vez de confrontar o real.
-- Mesma classe de engano de `officialDraw.ties` (o reconciliador lia o no errado e o teste
-- carregava o mesmo engano na fixture): quando o teste e o codigo compartilham a suposicao, os
-- dois concordam e ninguem reclama.
--
-- ═══ A CORRECAO ══════════════════════════════════════════════════════════════════════════════
--
-- O prazo que governa a edicao de um participante e o da FASE ATIVA -- a que esta aberta para
-- palpite --, e nao o de uma chave qualquer do payload. A fase ativa e a mesma que o resto da
-- plataforma usa: `espnSync.activePhaseId`.
--
-- NENHUMA propriedade de seguranca e afrouxada:
--
--   · quem decide o prazo continua sendo o SERVIDOR; o relogio do cliente nao participa
--   · sem fase ativa declarada        -> RECUSA
--   · fase ativa sem cutoffAt         -> RECUSA (regra 50: sem data oficial nao ha palpite)
--   · cutoffAt ilegivel               -> RECUSA (nao saber se fechou nao e permissao)
--   · cutoff vencido                  -> RECUSA
--   · payload identico ao gravado     -> permitido, porque reenviar nao e editar
--
-- A entrada continua vindo do TOKEN, e continua nao existindo `p_entry_id`.
--
-- ROLLBACK: reaplicar o corpo de 20260812070000. Nada de dado e tocado por esta migracao.

create or replace function cdb_save_my_picks(
  p_token      text,
  p_client_ref text,
  p_picks      jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_entry_id text;
  v_state    jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_cutoff   timestamptz;
  v_fase     text;
  v_agora    timestamptz := now();
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

  if v_entry->>'lastClientRef' = p_client_ref then
    return jsonb_build_object('updated', false, 'reason', 'idempotente');
  end if;

  -- Reenviar EXATAMENTE o que ja esta gravado nao e edicao, e nunca e bloqueado. Isto tambem e o
  -- que permite a um verificador exercitar o caminho de escrita sem alterar dado de ninguem.
  if coalesce(v_entry->'picks','null'::jsonb) is not distinct from coalesce(p_picks,'null'::jsonb) then
    return jsonb_build_object('updated', false, 'reason', 'identico');
  end if;

  -- ── O PRAZO E O DA FASE ATIVA ───────────────────────────────────────────────────────────
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

  return jsonb_build_object('updated', true);
end $$;

revoke all on function cdb_save_my_picks(text, text, jsonb) from public;
grant execute on function cdb_save_my_picks(text, text, jsonb) to anon, authenticated, service_role;

select 'cdb_save_my_picks passa a validar o prazo da FASE ATIVA' as resultado;
