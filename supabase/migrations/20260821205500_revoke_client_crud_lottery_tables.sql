-- 20260821205500_revoke_client_crud_lottery_tables.sql
-- Issue #131 — tirar de `anon` e `authenticated` o CRUD DIRETO nas seis tabelas do Powerball.
--
-- ─── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────────────────────
--
-- `anon` e `authenticated` tinham SELECT, INSERT, UPDATE e DELETE nas seis tabelas `lottery_*`,
-- que guardam participante (nome, e-mail, telefone) e transacao de pagamento real.
--
-- Ninguem escreveu esses grants. As tabelas NASCERAM com eles, pelo `pg_default_acl` de `public`
-- (Issue #271) -- o mesmo mecanismo que a #276 documentou nas outras onze.
--
-- ─── POR QUE ISTO E DIFERENTE DA #276 ────────────────────────────────────────────────────────
--
-- Aqui a RLS SEGURA de verdade: ela aplica policies aos quatro verbos de linha, as seis tabelas
-- estao com RLS ligada e ZERO policies, e o teste efetivo com `SET LOCAL ROLE` devolveu zero
-- linhas para os dois papeis. A #276 tratou TRUNCATE/REFERENCES/TRIGGER exatamente porque a RLS
-- NAO os governa.
--
-- Entao isto e defesa-em-profundidade, e o motivo de fazer mesmo assim e que a RLS era a UNICA
-- coisa segurando: um `CREATE POLICY` para uma feature nova, ou um `DISABLE ROW LEVEL SECURITY`
-- acidental, e o grant que ja estava la vira acesso total a PII e a pagamento, sem que uma linha
-- de codigo mude.
--
-- ─── PREFLIGHT, RELIDO IMEDIATAMENTE ANTES (2026-08-21, somente leitura) ─────────────────────
--
--   ACL medida  : anon e authenticated com SELECT/INSERT/UPDATE/DELETE nas SEIS;
--                 TRUNCATE/REFERENCES/TRIGGER ja false (a #276 pegou esses);
--                 `service_role` e `postgres` com os sete; PUBLIC sem NENHUMA entrada.
--   RLS         : ligada nas seis, `relforcerowsecurity` false, dono `postgres`, ZERO policies.
--   Dependentes : NENHUMA view e NENHUMA funcao de `public` referencia qualquer uma das seis.
--   Chamadores  : busca no repositorio inteiro -> NENHUM. Zero `supabase.from('lottery_*')`,
--                 zero `rest/v1/lottery_`, zero Edge Function, zero workflow. O Powerball fala
--                 com o Supabase so por `/rest/v1/rpc/<nome>` das RPCs de notificacao.
--
--   EVIDENCIA DE RUNTIME -- e esta e a parte que faltava nas tentativas anteriores:
--   `pg_stat_statements` esta instalado e retem desde 2026-06-27 (criacao do projeto, 4573
--   entradas), ou seja, o historico e COMPLETO, nao uma janela. Ele registra, para as seis
--   tabelas, exatamente DEZ statements de papel de cliente, e nenhum e trafego de aplicacao:
--
--     - OITO consultas com a forma `WITH pgrst_source AS (...)` (assinatura do PostgREST) como
--       `anon`, TODAS entre 2026-08-06 14:39 e 15:12 UTC -- de tres a trinta e cinco minutos
--       depois de `20260806143644_add_minimal_powerball_schema.sql` criar o schema. Cada uma
--       com `calls = 1`, e NENHUMA repetida nos quinze dias seguintes. E alguem conferindo o
--       schema novo pela Data API, nao navegador de participante: trafego real se repete.
--     - DUAS contagens `SELECT ... count(*) ... UNION ALL ...` (uma como `anon`, uma como
--       `authenticated`) em 2026-08-17 17:13 UTC -- o teste de acesso efetivo com
--       `SET LOCAL ROLE` que a propria Issue #131 registra.
--
-- ─── ESCOPO: SOMENTE QUATRO VERBOS, DOIS PAPEIS, SEIS TABELAS ────────────────────────────────
--
-- Nao ha `REVOKE ALL` aqui. `service_role` (credencial do runtime confiavel), o dono, a RLS, as
-- policies, as funcoes, os triggers, as chaves estrangeiras, o schema e TODO o dado ficam
-- exatamente como estavam.
--
-- ─── LEITURA POS-MUDANCA ─────────────────────────────────────────────────────────────────────
--
--   anon          : os sete privilegios FALSE nas seis
--   authenticated : os sete privilegios FALSE nas seis
--   service_role  : os sete TRUE nas seis -- INALTERADO
--   RLS           : ligada, nao forcada, dono postgres, ZERO policies -- INALTERADO
--   linhas        : 1 / 1 / 10 / 10 / 11 / 1 -- IDENTICAS antes e depois, delta de dado NENHUM
--   estrutura     : mesmo conjunto de FK e trigger antes e depois, delta de schema NENHUM
--
-- Nenhum valor de participante foi consultado em momento nenhum -- so metadado e contagem.
--
-- ─── REVERSAO ────────────────────────────────────────────────────────────────────────────────
--
-- `supabase/rollbacks/20260821205500_revoke_client_crud_lottery_tables.rollback.sql`
-- Ele e simetrico porque a medicao era simetrica: os DOIS papeis tinham os QUATRO verbos nas
-- SEIS tabelas. Se nao fosse, o rollback teria de reproduzir a leitura papel por papel, como o
-- da #276 faz -- `legacy_fence.mjs` documenta o defeito de reverter por constante uniforme.

begin;

revoke select, insert, update, delete on table public.lottery_admin_audit          from anon, authenticated;
revoke select, insert, update, delete on table public.lottery_draws                from anon, authenticated;
revoke select, insert, update, delete on table public.lottery_participants         from anon, authenticated;
revoke select, insert, update, delete on table public.lottery_participations       from anon, authenticated;
revoke select, insert, update, delete on table public.lottery_payment_transactions from anon, authenticated;
revoke select, insert, update, delete on table public.lottery_pools                from anon, authenticated;

commit;
