--
-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY
--
-- 20260813000000_copa_bracket_forward_slots.sql
--
-- Q39-A1, decisao B do operador (2026-08-12): referencia estrutural de chaveamento, anulavel.
--
-- ═══ O PROBLEMA ════════════════════════════════════════════════════════════════════════════════
--
-- `bolao.matches.home_team` e `away_team` eram NOT NULL. Isso obriga todo jogo a nomear dois times.
-- A Copa do Mundo 2026 tem 10 jogos cujo participante NUNCA foi um time no momento em que os
-- palpites foram feitos — era uma posicao de chave:
--
--     jogo  95  Round of 16   A: Winner Match 87   B: Winner Match 86
--     jogo  96  Round of 16   A: Winner Match 85   B: Winner Match 88
--     jogo  97  Quarterfinal  A: Winner Match 89   B: Winner Match 90
--     jogo  98  Quarterfinal  A: Winner Match 93   B: Winner Match 94
--     jogo  99  Quarterfinal  A: Winner Match 91   B: Winner Match 92
--     jogo 100  Quarterfinal  A: Winner Match 95   B: Winner Match 96
--     jogo 101  Semifinal     A: Winner Match 97   B: Winner Match 98
--     jogo 102  Semifinal     A: Winner Match 99   B: Winner Match 100
--     jogo 103  3rd Place     A: Loser Match 101   B: Loser Match 102
--     jogo 104  Final         A: Winner Match 101  B: Winner Match 102
--
-- "Winner Match 87" NAO e um time desconhecido nem dado faltando. E o participante historico do
-- jogo, definido ESTRUTURALMENTE. Gravar um time concreto ali seria inventar; resolver pelo
-- resultado de hoje seria reescrever a semantica de um palpite feito quando ninguem sabia quem
-- passaria.
--
-- ═══ O QUE ISTO ADICIONA ═══════════════════════════════════════════════════════════════════════
--
-- Cada lado do jogo passa a ser UMA de duas coisas, nunca as duas e nunca nenhuma:
--
--     um time concreto            (home_team)
--   XOR
--     uma referencia estrutural   (home_source_match_id + home_advancement)
--
-- `advancement_type` tem exatamente dois valores, os dois observados na fonte: winner e loser.
-- Nao e uma linguagem de expressao; nao ha "perdedor do vencedor de", nao ha texto livre. O que
-- nao couber nesses dois valores nao entra.
--
-- ═══ O QUE ISTO EXPLICITAMENTE NAO FAZ ═════════════════════════════════════════════════════════
--
-- NAO calcula progressao de chave. Nao ha trigger, nao ha view, nao ha funcao que olhe um placar e
-- decida quem avanca. O banco GUARDA a referencia estrutural; a estrutura do torneio de origem
-- continua sendo a autoridade. Isto nao vira um segundo motor de chaveamento.
--
-- NAO resolve os 10 jogos usando o resultado final da Copa, mesmo com o torneio encerrado.
--
-- NAO toca scoring, nem entradas, nem participantes, nem Q33, nem `public.*`. Q38 intacto.

-- ── 1. o vocabulario, fechado em dois valores ─────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'bolao' and t.typname = 'advancement_type') then
    create type bolao.advancement_type as enum ('winner', 'loser');
  end if;
end
$$;

-- ── 2. o lado do jogo deixa de exigir um time ─────────────────────────────────────────────────
alter table bolao.matches alter column home_team drop not null;
alter table bolao.matches alter column away_team drop not null;

alter table bolao.matches
  add column if not exists home_source_match_id uuid,
  add column if not exists home_advancement     bolao.advancement_type,
  add column if not exists away_source_match_id uuid,
  add column if not exists away_advancement     bolao.advancement_type;

-- A referencia aponta para um jogo REAL da mesma tabela. FK, nao texto.
alter table bolao.matches
  drop constraint if exists matches_home_source_match_id_fkey,
  add  constraint matches_home_source_match_id_fkey
       foreign key (home_source_match_id) references bolao.matches(match_id)
       on update restrict on delete restrict;

alter table bolao.matches
  drop constraint if exists matches_away_source_match_id_fkey,
  add  constraint matches_away_source_match_id_fkey
       foreign key (away_source_match_id) references bolao.matches(match_id)
       on update restrict on delete restrict;

-- ── 3. exatamente um dos dois, por lado ───────────────────────────────────────────────────────
-- Rejeita simultaneamente: time E slot; nenhum dos dois; slot pela metade (ref sem tipo de
-- avanco, ou tipo sem ref).
alter table bolao.matches
  drop constraint if exists match_home_side_exactly_one,
  add  constraint match_home_side_exactly_one check (
        (home_team is not null and home_source_match_id is null     and home_advancement is null)
     or (home_team is null     and home_source_match_id is not null and home_advancement is not null));

alter table bolao.matches
  drop constraint if exists match_away_side_exactly_one,
  add  constraint match_away_side_exactly_one check (
        (away_team is not null and away_source_match_id is null     and away_advancement is null)
     or (away_team is null     and away_source_match_id is not null and away_advancement is not null));

-- Um jogo nao pode depender de si mesmo. O ciclo mais longo e barrado no backfill por validacao
-- de grafo; o auto-ciclo, que e o erro mais provavel de digitacao, morre aqui.
alter table bolao.matches
  drop constraint if exists match_slot_no_self_reference,
  add  constraint match_slot_no_self_reference check (
        (home_source_match_id is null or home_source_match_id <> match_id)
    and (away_source_match_id is null or away_source_match_id <> match_id));

-- ── 4. indices das arestas ────────────────────────────────────────────────────────────────────
create index if not exists matches_home_source_match_id_idx
  on bolao.matches (home_source_match_id) where home_source_match_id is not null;
create index if not exists matches_away_source_match_id_idx
  on bolao.matches (away_source_match_id) where away_source_match_id is not null;

comment on column bolao.matches.home_source_match_id is
  'Q39-A1: quando o lado mandante era uma POSICAO DE CHAVE e nao um time, aponta para o jogo cujo '
  'vencedor/perdedor ocupa a vaga. NULL nao significa dado faltando — significa que o lado tinha '
  'time concreto. O banco guarda a referencia; nao calcula progressao.';
comment on column bolao.matches.home_advancement is
  'winner|loser — a semantica da vaga, lida da fonte, nunca derivada do resultado.';

select 'matches: lado = time concreto XOR referencia estrutural (winner|loser)' as resultado;
