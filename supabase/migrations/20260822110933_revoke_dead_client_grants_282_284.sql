-- Issue #282 (com evidencia da #284) — retirar privilegio de cliente que ninguem usa e ninguem
-- decidiu conceder.
--
-- EXECUTADO EM PRODUCAO em 2026-08-22, sob autorizacao explicita e pontual do Eduardo, que nomeou
-- os tres objetos e os privilegios exatos.
--
-- ─── O QUE ESTAVA ERRADO, E A RAIZ COMPARTILHADA ─────────────────────────────────────────────
--
-- `PUBLIC` e um PSEUDO-PAPEL. `REVOKE ... FROM PUBLIC` NAO remove um grant explicito de `anon` ou
-- de `authenticated` -- eles tem entrada propria na ACL. Os tres objetos abaixo sao a mesma
-- confusao, cometida em dois arquivos diferentes:
--
--   `017_n22_narrow_mutations.sql`      revoga `from anon, public` e ESQUECE `authenticated`;
--   `20260816020000_cdb_public_...sql`  revoga `all ... from public` e depois concede SELECT,
--                                       deixando intactos os sete privilegios que `anon` e
--                                       `authenticated` herdaram no nascimento (Issue #271).
--
-- Nenhum dos dois era exploravel, e nenhum dos dois foi escrito por engano de digitacao: os dois
-- vieram de achar que revogar o pseudo-papel limpava os papeis nomeados.
--
-- ─── PREFLIGHT, RELIDO IMEDIATAMENTE ANTES (2026-08-22, somente leitura) ─────────────────────
--
--   _bolao_audit(jsonb,text,jsonb) : prosecdef=false, PUBLIC=false, anon=false,
--                                    authenticated=TRUE, service_role=true
--   _bolao_touch(jsonb)            : identico
--   bolao_state_normalized_public  : `anon` e `authenticated` com
--                                    SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN
--
-- ─── POR QUE REVOGAR `authenticated` NAO QUEBRA OS CHAMADORES ────────────────────────────────
--
-- Os dois helpers sao SECURITY INVOKER e sao chamados de dentro das RPCs de operador
-- (`op_confirm_payment`, `op_update_entry`, `op_remove_entry`, `op_set_results`, `op_set_phases`,
-- `op_set_round_email`), que sao SECURITY DEFINER e pertencem a `postgres`. O corpo delas executa
-- COMO `postgres`, entao a chamada aninhada e verificada contra `postgres`, que mantem EXECUTE.
-- Esse e o argumento que sustenta a mudanca -- nao "ninguem chama".
--
-- ─── O SELECT DA VIEW E INTENCIONAL E FICA ───────────────────────────────────────────────────
--
-- `bolao_state_normalized_public` e a projecao publica que o site le. `pg_stat_statements`
-- registra mais de 61 mil chamadas de leitura de `anon` desde 2026-08-13. SELECT NAO e tocado.
-- Os seis privilegios revogados nunca passaram por ela: a view NAO e atualizavel
-- (`is_updatable = NO`), e uma tentativa de INSERT como `anon` devolvia o erro 55000 do PostgreSQL
-- antes mesmo de a ACL importar. Eram privilegio morto -- e privilegio morto e o que sobra ligado
-- quando alguem, um dia, torna a view atualizavel.
--
-- `MAINTAIN` NAO e revogado. Ele nao estava na autorizacao, e alargar o revoke porque "estava
-- ali" e exatamente o tipo de improviso que esta migracao existe para nao fazer.
--
-- ─── LEITURA POS-MUDANCA ─────────────────────────────────────────────────────────────────────
--
--   _bolao_audit / _bolao_touch : PUBLIC=false, anon=false, authenticated=FALSE, service_role=true
--   view, anon e authenticated  : MAINTAIN,SELECT  (os seis foram embora, SELECT ficou)
--   view, service_role e dono   : INALTERADOS
--   caminho publico de leitura  : GET .../bolao_state_normalized_public respondeu HTTP 200 antes e
--                                 depois, com os MESMOS bytes e as mesmas tres linhas
--                                 (br2026, cdb2026, main)
--   corpo das funcoes, definicao da view, policies, linhas : INALTERADOS (md5 conferido)
--
-- Nenhuma RPC de operador foi invocada como teste -- elas mutam estado.
--
-- ─── REVERSAO ────────────────────────────────────────────────────────────────────────────────
--
-- `supabase/rollbacks/` com o mesmo basename. Simetrico, e sem `MAINTAIN`, que nunca saiu.

begin;

revoke execute on function public._bolao_audit(jsonb, text, jsonb) from authenticated;
revoke execute on function public._bolao_touch(jsonb)              from authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.bolao_state_normalized_public from anon, authenticated;

commit;
