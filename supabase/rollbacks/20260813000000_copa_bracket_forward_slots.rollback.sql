--
-- PLANO DE ROLLBACK de 20260813000000_copa_bracket_forward_slots.sql
--
-- Nao e uma migracao: `.rollback.sql` esta em NON_MIGRATION_SUFFIXES, entao este arquivo nunca
-- entra no conjunto de migracoes nem no ledger. Existe porque o harness classifica a migracao como
-- DESTRUCTIVE_DDL (ela usa `drop constraint if exists` como guarda de idempotencia) e exige o plano
-- ao lado.
--
-- ═══ REVERSIVEL, MAS SO ENQUANTO NENHUM JOGO USAR UMA VAGA ESTRUTURAL ═══════════════════════════
--
-- A migracao tornou `home_team`/`away_team` anulaveis e adicionou a referencia estrutural
-- (`*_source_match_id` + `*_advancement`). Reverter significa devolver o NOT NULL.
--
-- Isso FUNCIONA enquanto nenhuma linha tiver time nulo, e FALHA depois que os 10 jogos de chave da
-- Copa existirem — porque esses jogos, por definicao historica, NAO tinham time nos dois lados:
--
--     95, 96, 97, 98, 99, 100, 101, 102, 104   -> Winner Match N
--     103                                       -> Loser Match N
--
-- Se este rollback falhar, NAO "resolva" preenchendo os times pelo resultado final da Copa. Isso
-- seria inventar o participante historico de um jogo — exatamente o que a decisao Q39-A1 do
-- operador proibiu, e o que tornaria falsa a semantica de todo palpite feito antes do jogo.
--
-- A restricao NOT NULL e que era incompativel com a Copa, nao os dados.
--
-- ═══ VERIFICACAO ANTES DE TENTAR ═══════════════════════════════════════════════════════════════
--
--   select count(*) from bolao.matches where home_team is null or away_team is null;
--
-- Qualquer valor > 0 e o rollback NAO e aplicavel. Pare.
--
-- ═══ ROLLBACK, COM GUARDA ══════════════════════════════════════════════════════════════════════

do $$
declare
  estruturais int;
begin
  select count(*) into estruturais
    from bolao.matches
   where home_team is null or away_team is null
      or home_source_match_id is not null or away_source_match_id is not null;

  if estruturais > 0 then
    raise exception
      'ROLLBACK RECUSADO: % jogo(s) usam vaga estrutural de chaveamento. Devolver NOT NULL a '
      'home_team/away_team exigiria inventar um time concreto para "Winner Match N" / '
      '"Loser Match N" — a decisao Q39-A1 proibe isso explicitamente. Nenhum objeto foi alterado.',
      estruturais;
  end if;

  drop index if exists bolao.matches_home_source_match_id_idx;
  drop index if exists bolao.matches_away_source_match_id_idx;

  alter table bolao.matches
    drop constraint if exists match_home_side_exactly_one,
    drop constraint if exists match_away_side_exactly_one,
    drop constraint if exists match_slot_no_self_reference,
    drop constraint if exists matches_home_source_match_id_fkey,
    drop constraint if exists matches_away_source_match_id_fkey;

  alter table bolao.matches
    drop column if exists home_source_match_id,
    drop column if exists home_advancement,
    drop column if exists away_source_match_id,
    drop column if exists away_advancement;

  alter table bolao.matches alter column home_team set not null;
  alter table bolao.matches alter column away_team set not null;

  -- O tipo so cai se nada mais o referenciar.
  drop type if exists bolao.advancement_type;

  raise notice 'vagas estruturais removidas; nenhum jogo as usava.';
end
$$;
