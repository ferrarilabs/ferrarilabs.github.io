--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260812200000_lock_tie_never_overwrites.sql
--
-- ═══ REGRESSAO REAL, ACHADA POR GATE (2026-08-12) ════════════════════════════════════════════
--
-- O `sb_lock_tie` em Python tinha esta guarda:
--
--     if tie.get("qualifiedTeamId"):
--         return 200, state          # already locked -- never overwrite
--
-- A migracao para mutacoes estreitas moveu o travamento para `cdb_apply_operator_mutation`
-- ('lock-tie'), e a guarda NAO veio junto: a versao SQL sobrescreve `qualifiedTeamId`
-- incondicionalmente.
--
-- O caminho automatico continua seguro -- `_maybe_decide_tie()` sai cedo quando o confronto ja
-- tem classificado. Mas a defesa passou de DUAS camadas para UMA, e a que sobrou e a de cima. Uma
-- chamada direta a RPC (CLI de operador, invocacao manual, chamador futuro) reescreve quem
-- avancou.
--
-- Isso vale dinheiro: quem avanca define pontuacao e premio, e o resultado ja foi comunicado aos
-- participantes quando o confronto travou.
--
-- ═══ O QUE MUDA ══════════════════════════════════════════════════════════════════════════════
--
--   travar de novo com o MESMO lado   -> no-op silencioso (era o comportamento antigo: `return
--                                        200`). Reexecucao e retry nao podem virar erro.
--   travar com lado DIFERENTE          -> RECUSA com mensagem explicita.
--
-- Destravar (`unlock-tie`) continua existindo e nao e tocado: corrigir um travamento errado
-- segue possivel, mas passa a ser um ato DELIBERADO e separado, em vez de efeito colateral de um
-- segundo lock.
--
-- NAO reverte a arquitetura de mutacoes estreitas -- so devolve a invariante que a migracao
-- dela deixou cair. Aditivo: recria a funcao com o mesmo nome e assinatura.
--
-- ROLLBACK: reaplicar 026 sobre esta.

do $$
declare
  v_src text;
  v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cdb_apply_operator_mutation'
   limit 1;

  if v_src is null then
    raise exception 'cdb_apply_operator_mutation nao existe — nada a endurecer';
  end if;

  -- Insere a guarda imediatamente antes da escrita de 'lock-tie'.
  v_novo := replace(
    v_src,
    '    if p_type = ''lock-tie'' then',
    '    if p_type = ''lock-tie'' then' || E'\n' ||
    '      -- NUNCA SOBRESCREVER UM CONFRONTO JA TRAVADO.' || E'\n' ||
    '      --' || E'\n' ||
    '      -- Quem avanca define pontuacao e premio, e ao travar o resultado ja foi comunicado.' || E'\n' ||
    '      -- Retravar com o MESMO lado e no-op (retry/reexecucao nao podem virar erro); com lado' || E'\n' ||
    '      -- DIFERENTE e recusado. Corrigir exige unlock-tie: ato deliberado, nao efeito colateral.' || E'\n' ||
    '      if v_state->''phases''->v_fase->''ties''->v_tie->>''qualifiedTeamId'' is not null then' || E'\n' ||
    '        if v_state->''phases''->v_fase->''ties''->v_tie->>''qualifiedTeamId''' || E'\n' ||
    '           is distinct from (p_payload->>''qualifiedTeamId'') then' || E'\n' ||
    '          raise exception ''lock-tie: %/% ja travado com %; use unlock-tie antes de mudar'',' || E'\n' ||
    '            v_fase, v_tie, v_state->''phases''->v_fase->''ties''->v_tie->>''qualifiedTeamId'';' || E'\n' ||
    '        end if;' || E'\n' ||
    '        return jsonb_build_object(''applied'', false, ''reason'', ''ja travado com o mesmo lado'');' || E'\n' ||
    '      end if;'
  );

  if v_novo = v_src then
    raise exception 'nao achei o ramo lock-tie para endurecer — a funcao mudou de forma';
  end if;

  execute v_novo;
end
$$;

select 'lock-tie deixa de sobrescrever confronto ja travado' as resultado;
