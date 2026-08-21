-- ROLLBACK de 20260821030000_secure_default_privileges_public.sql — Issue #271.
--
-- Restaura os defaults MEDIDOS antes da mudanca:
--   postgres/public TABLES     = {postgres=arwdDxtm/postgres, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
--   postgres/public SEQUENCES  = {postgres=rwU/postgres,      anon=rwU,      authenticated=rwU,      service_role=rwU}
--
-- `arwdDxtm` e exatamente `ALL` para tabela e `rwU` e `ALL` para sequencia, entao `GRANT ALL`
-- reproduz o estado anterior sem ampliar nada.
--
-- FUNCTIONS nao aparece porque nunca foi alterado, e `supabase_admin` nao aparece porque a
-- alteracao dele foi recusada por privilegio -- reverter o que nao mudou seria inventar historia.
--
-- AVISO: aplicar isto faz toda tabela nova voltar a nascer com CRUD + TRUNCATE + REFERENCES +
-- TRIGGER para `anon` e `authenticated`. Foi assim que `bolao_round_notif_jobs` nasceu exposta.

begin;

alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

commit;
