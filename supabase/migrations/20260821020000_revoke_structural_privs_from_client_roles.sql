-- 20260821020000_revoke_structural_privs_from_client_roles.sql
-- Issue #276 — tirar de `anon` e `authenticated` privilegios de ADMINISTRACAO DE TABELA.
--
-- ─── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────────────────────
--
-- `authenticated` tinha TRUNCATE, REFERENCES e TRIGGER em 11 das 12 tabelas de `public` --
-- inclusive `bolao_entry_private` (identidade do participante) e `bolao_state` (o documento de
-- onde sai o rateio). `anon` tinha TRUNCATE em duas e REFERENCES/TRIGGER em dez.
--
-- Vieram de `GRANT ALL ON TABLE` no baseline `20260811160000_baseline_adopted_grants_and_rls.sql`:
-- `ALL` numa tabela inclui TRUNCATE, REFERENCES e TRIGGER. Quase certamente nao era isso que se
-- queria dizer ao capturar o estado -- mas foi isso que se concedeu.
--
-- ─── POR QUE "A RLS SEGURA" NAO VALE AQUI ────────────────────────────────────────────────────
--
-- Este e o ponto que separa a #276 da #131. A RLS aplica policies a SELECT, INSERT, UPDATE e
-- DELETE. Ela NAO governa TRUNCATE: TRUNCATE e operacao de tabela inteira, decidida so pelo
-- privilegio TRUNCATE. Uma tabela com RLS ligada e ZERO policies -- que e o estado destas --
-- continua truncando limpo para quem tiver o privilegio.
--
-- Ou seja: o argumento "a RLS esta bloqueando hoje", que e verdadeiro para os quatro verbos de
-- linha, NAO cobre estes tres. Eram o unico privilegio destas tabelas sem nenhuma rede embaixo.
--
-- ─── ESTADO MEDIDO IMEDIATAMENTE ANTES (2026-08-21, somente leitura) ─────────────────────────
--
--   anon          : TRUNCATE 2/12, REFERENCES 10/12, TRIGGER 10/12
--   authenticated : TRUNCATE 11/12, REFERENCES 11/12, TRIGGER 11/12
--   service_role  : 12/12 -- FORA DESTA REMEDIACAO, intocado
--   PUBLIC        : 0/12 -- nenhum destes privilegios vem por heranca
--   grantor       : `postgres` em todos -- sao grants explicitos, nao efeito de default
--
-- ─── ESCOPO: O DIFF DESCREVE A TRANSICAO REAL ────────────────────────────────────────────────
--
-- Cada statement abaixo revoga SOMENTE privilegio que o papel REALMENTE tinha. Nao ha REVOKE
-- uniforme "para ficar bonito": `public.cdb_entry_access` NAO aparece porque `anon` e
-- `authenticated` ja nao tinham nada nela, e `anon` aparece sem TRUNCATE em nove tabelas porque
-- nao tinha TRUNCATE nelas. Revogar privilegio inexistente e no-op, mas escreve no registro uma
-- remediacao que nao aconteceu -- e o registro e o que alguem vai ler daqui a um ano.
--
-- A mesma disciplina vale para a reversao, e ali ela nao e cosmetica: `legacy_fence.mjs` ja
-- documenta o defeito de um rollback por constante uniforme, que teria CONCEDIDO a `anon`
-- TRUNCATE em seis tabelas de participante e pagamento em nome de "restaurar". O rollback deste
-- patch reproduz a leitura acima, tabela por tabela, papel por papel.
--
-- ─── O QUE NAO MUDA ──────────────────────────────────────────────────────────────────────────
--
-- SELECT/INSERT/UPDATE/DELETE de qualquer papel; `service_role`; dono; RLS; policies; funcoes;
-- triggers instalados; chaves estrangeiras; conteudo das tabelas; scoring; pagamento; dado de
-- participante; e os DEFAULT PRIVILEGES -- que sao a Issue #271 e continuam sendo problema dela.
-- Uma tabela criada amanha ainda nasce com estes tres privilegios para os papeis de cliente.
--
-- ─── REVERSAO ────────────────────────────────────────────────────────────────────────────────
--
-- `supabase/rollbacks/20260821020000_revoke_structural_privs_from_client_roles.rollback.sql`

begin;

revoke truncate, references, trigger on table public.bolao_entry_private from authenticated;
revoke truncate, references, trigger on table public.bolao_notif_jobs from anon;
revoke truncate, references, trigger on table public.bolao_notif_jobs from authenticated;
revoke truncate, references, trigger on table public.bolao_round_notif_jobs from anon;
revoke truncate, references, trigger on table public.bolao_round_notif_jobs from authenticated;
revoke references, trigger on table public.bolao_state from anon;
revoke truncate, references, trigger on table public.bolao_state from authenticated;
revoke references, trigger on table public.live_sports_cache from anon;
revoke truncate, references, trigger on table public.live_sports_cache from authenticated;
revoke references, trigger on table public.lottery_admin_audit from anon;
revoke truncate, references, trigger on table public.lottery_admin_audit from authenticated;
revoke references, trigger on table public.lottery_draws from anon;
revoke truncate, references, trigger on table public.lottery_draws from authenticated;
revoke references, trigger on table public.lottery_participants from anon;
revoke truncate, references, trigger on table public.lottery_participants from authenticated;
revoke references, trigger on table public.lottery_participations from anon;
revoke truncate, references, trigger on table public.lottery_participations from authenticated;
revoke references, trigger on table public.lottery_payment_transactions from anon;
revoke truncate, references, trigger on table public.lottery_payment_transactions from authenticated;
revoke references, trigger on table public.lottery_pools from anon;
revoke truncate, references, trigger on table public.lottery_pools from authenticated;

commit;
