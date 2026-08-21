-- ROLLBACK de 20260821040000_retire_cdb_reserve_entry_saved_email_client_grant.sql — Issue #274.
--
-- Restaura EXATAMENTE o estado medido antes da mudanca:
--   proacl = {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- `service_role` nao aparece porque nunca foi revogado, e PUBLIC nao aparece porque nunca teve.
-- Reverter o que nao mudou seria inventar historia -- a mesma disciplina da #276.
--
-- AVISO: aplicar isto devolve ao navegador o direito de reservar uma entrega de comprovante numa
-- RPC que nenhum navegador chama.

begin;

grant execute on function public.cdb_reserve_entry_saved_email(text) to anon, authenticated;

commit;
