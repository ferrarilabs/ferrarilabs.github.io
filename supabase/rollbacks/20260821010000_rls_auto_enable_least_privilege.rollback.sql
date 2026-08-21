-- ROLLBACK de 20260821010000_rls_auto_enable_least_privilege.sql — Issue #270.
--
-- Restaura EXATAMENTE a ACL medida em producao antes da mudanca:
--
--   =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- `GRANT ALL ON FUNCTION` e `GRANT EXECUTE ON FUNCTION` sao equivalentes -- EXECUTE e o unico
-- privilegio que existe para funcao -- entao isto reproduz o baseline
-- `20260811160000_baseline_adopted_grants_and_rls.sql` sem ampliar nada.
--
-- O grant a PUBLIC faz parte da reversao porque fazia parte do estado anterior. Ele NAO veio de
-- `pg_default_acl` (que nao tem entrada PUBLIC para `public`): veio do default embutido do
-- `CREATE FUNCTION` na epoca em que a funcao foi criada, antes do rastreamento de migracoes.
--
-- `postgres` nao aparece: e o dono e nunca perdeu o privilegio.

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "service_role";
