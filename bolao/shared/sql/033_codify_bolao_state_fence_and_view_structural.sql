-- 033_codify_bolao_state_fence_and_view_structural.sql — Issue #292.
--
-- ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────────
--
-- Duas correcoes que producao JA TEM e que a DDL nao conseguia reproduzir. As duas sao NO-OP contra
-- o estado ao vivo, medido em 2026-08-22 (somente leitura), e nenhuma foi aplicada por este patch.
--
-- 1. A CERCA DE ESCRITA DE `bolao_state` (WS5-F4). Producao mede `anon` com APENAS `MAINTAIN` nesta
--    tabela -- sem SELECT, INSERT, UPDATE nem DELETE. Nenhuma migracao commitada faz esse revoke:
--    ele foi aplicado fora do repositorio. Sem esta codificacao, uma reconstrucao devolve a `anon`
--    CRUD COMPLETO sobre o documento que guarda entradas, pagamentos e o rateio.
--
--    `authenticated` NAO e tocado: producao mede DELETE,INSERT,MAINTAIN,SELECT,UPDATE para ele, e
--    codificar um revoke que producao nao tem faria a reconstrucao divergir para o outro lado.
--
-- 2. OS TRES PRIVILEGIOS ESTRUTURAIS QUE A #135 NAO COBRIU. `031_codify_bolao_state_public_views_
--    revoke.sql` revoga INSERT/UPDATE/DELETE das duas views publicas, mas nao TRUNCATE, REFERENCES
--    nem TRIGGER -- e producao mede as duas com `anon`/`authenticated` em `MAINTAIN,SELECT` apenas.
--    A #276 removeu esses tres das TABELAS; view ficou fora daquele escopo.
--
-- ─── E POR QUE A #135 NAO ESTAVA FUNCIONANDO ────────────────────────────────────────────────────
--
-- Nao era o conteudo dela -- era a ORDEM. Os gates montavam a reconstrucao com todo
-- `bolao/shared/sql/**` ANTES de `supabase/migrations/**`, e as duas views nascem em
-- `20260813200000`. O revoke da #135, escrito em 2026-08-18, rodava ANTES do CREATE de 2026-08-13 e
-- nao alcancava nada. Corrigido em `scripts/db/ddl_execution_order.mjs`, que ordena por QUANDO cada
-- arquivo foi aplicado e nao por qual diretorio ele mora.
--
-- ─── MAINTAIN NAO E TOCADO ──────────────────────────────────────────────────────────────────────
--
-- Producao concede `MAINTAIN` a `anon` nos tres objetos. Ele nao le nem escreve linha
-- (VACUUM/ANALYZE/REINDEX), nao esta em nenhuma autorizacao, e revoga-lo aqui faria a reconstrucao
-- divergir de producao -- que e exatamente o defeito que este arquivo existe para fechar.
--
-- ─── ESTE ARQUIVO E `MANUAL_ONLY`, E ISSO IMPORTA ───────────────────────────────────────────────
--
-- `bolao/shared/sql/**` nao e executado pelo `supabase db push` -- nenhum runner do repositorio o
-- executa, e o CLI nao o enxerga. O modelo de replay dos gates o inclui porque producao FOI
-- construida assim, a mao. A lacuna de mecanismo continua aberta e esta registrada na #292: fechar
-- de verdade exige decidir se `shared/sql` vira migracao, e isso e decisao do dono.

revoke select, insert, update, delete on table public.bolao_state from anon;

revoke truncate, references, trigger on table public.bolao_state_public     from anon, authenticated;
revoke truncate, references, trigger on table public.bolao_state_public_cdb from anon, authenticated;

-- ROLLBACK (nao deveria ser necessario -- e no-op contra o estado ao vivo de 2026-08-22):
-- grant select, insert, update, delete on table public.bolao_state to anon;
-- grant truncate, references, trigger on table public.bolao_state_public     to anon, authenticated;
-- grant truncate, references, trigger on table public.bolao_state_public_cdb to anon, authenticated;
