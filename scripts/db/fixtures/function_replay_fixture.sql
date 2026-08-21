-- FIXTURE DE REPLAY — nao e migracao, nao vai para producao.
-- Reproduz, em miniatura, as cinco formas que a DDL real usa. A expectativa correspondente
-- (`function_replay_expectation.json`) foi CAPTURADA de um PostgreSQL 17.10 de verdade rodando
-- exatamente este arquivo sob os default privileges medidos em producao.

-- (1) RPC de cliente feita do jeito certo: revoga PUBLIC e concede so os papeis pretendidos.
create or replace function public.fx_client(p_a text) returns text language sql security definer as $$ select p_a $$;
revoke all on function public.fx_client(text) from public;
grant execute on function public.fx_client(text) to anon, authenticated;

-- (2) RPC de servico do jeito que as SQL de notificacao fazem: concede service_role e NUNCA
--     revoga o que o default deu. E a forma que produziu as 14 heranças.
create or replace function public.fx_service(p_a text) returns text language sql security definer as $$ select p_a $$;
grant execute on function public.fx_service(text) to service_role;

-- (3) Funcao interna sem GRANT nenhum. "Nao tem grant" nao e "ninguem executa".
create or replace function public.fx_internal() returns int language sql as $$ select 1 $$;

-- (4) CREATE OR REPLACE depois de um revoke: a ACL tem de ser PRESERVADA.
create or replace function public.fx_replaced() returns int language sql as $$ select 1 $$;
revoke all on function public.fx_replaced() from public, anon, authenticated;
create or replace function public.fx_replaced() returns int language sql as $$ select 2 $$;

-- (5) DROP + CREATE depois de um revoke: a ACL e DESTRUIDA e a exposicao VOLTA.
create or replace function public.fx_recreated() returns int language sql as $$ select 1 $$;
revoke all on function public.fx_recreated() from public, anon, authenticated;
drop function public.fx_recreated();
create or replace function public.fx_recreated() returns int language sql as $$ select 2 $$;
