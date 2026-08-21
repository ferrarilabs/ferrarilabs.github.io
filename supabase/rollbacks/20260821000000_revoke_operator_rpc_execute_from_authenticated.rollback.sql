-- ROLLBACK de 20260821000000_revoke_operator_rpc_execute_from_authenticated.sql (Issue #267).
--
-- Restaura EXACTAMENTE o estado anterior: EXECUTE para `authenticated` nas sete assinaturas.
--
-- ATENCAO: aplicar isto REINTRODUZ a exposicao descrita na Issue #267 -- sete RPCs SECURITY
-- DEFINER de operador (pagamento, resultado, fases, e-mail de rodada, identidade da entrada e
-- destinatarios) voltam a ser chamaveis por qualquer requisicao que apresente um JWT de usuario.
-- Use somente se a revogacao tiver quebrado um chamador legitimo que o levantamento nao encontrou.
--
-- O baseline usava `GRANT ALL`; para funcao, ALL == EXECUTE, entao o GRANT abaixo e equivalente e
-- mais estreito. Nada alem de EXECUTE e devolvido.

grant execute on function public.op_confirm_payment(p_pool_id text, p_entry_ref text, p_paid boolean) to authenticated;
grant execute on function public.op_remove_entry(p_pool_id text, p_entry_ref text) to authenticated;
grant execute on function public.op_set_phases(p_pool_id text, p_phases jsonb) to authenticated;
grant execute on function public.op_set_results(p_pool_id text, p_results jsonb) to authenticated;
grant execute on function public.op_set_round_email(p_pool_id text, p_round_email jsonb) to authenticated;
grant execute on function public.op_update_entry(p_pool_id text, p_entry_ref text, p_entry_name text, p_participant_email text, p_payer_name text, p_payment_method text) to authenticated;
grant execute on function public.resolve_notification_recipients(p_pool_id text, p_entry_refs text[]) to authenticated;
