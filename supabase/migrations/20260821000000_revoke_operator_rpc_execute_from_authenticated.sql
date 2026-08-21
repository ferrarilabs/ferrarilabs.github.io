-- 20260821000000_revoke_operator_rpc_execute_from_authenticated.sql
-- Issue #267 — menor privilegio nas SETE RPCs de operador.
--
-- ─── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────────────────────
--
-- As seis `op_*` e `resolve_notification_recipients` sao SECURITY DEFINER e mutam estado
-- privilegiado: pagamento, resultado, fases, e-mail de rodada, identidade da entrada; a setima
-- devolve destinatarios (dado de participante). Todas tinham EXECUTE para `authenticated`,
-- concedido explicitamente pelo baseline `20260811160000_baseline_adopted_grants_and_rls.sql`
-- (`GRANT ALL ON FUNCTION ... TO "authenticated"`).
--
-- Em Supabase/PostgREST, `authenticated` NAO e "um usuario cadastrado": e o papel assumido por
-- QUALQUER requisicao que apresente um JWT de usuario. Contagem de membros do papel no Postgres
-- nao e prova de nao-uso -- e por isso "auth.users = 0" nao serve como evidencia de seguranca.
-- Bastava um provedor de auth ser ligado no painel para essas RPCs ficarem alcancaveis.
--
-- ─── POR QUE REVOGAR NAO QUEBRA NINGUEM ──────────────────────────────────────────────────────
--
-- Levantamento de chamadores feito antes da mudanca, classificado por credencial:
--
--   · `bolao/{br2026,copa2026}/scripts/operator_cli.py` -> POSTGRES/ADMIN. `run_rpc()` executa
--     via `supabase db query --linked` (sessao privilegiada da CLI), nao via PostgREST.
--   · `bolao/br2026/js/app.js` (`callNarrowRpc`) -> ANON. `anon` JA nao tinha EXECUTE nestas sete;
--     o proprio comentario do arquivo diz "revogadas de anon; rodam por script com credencial
--     privilegiada". Esse caminho ja falhava fechado e continua igual.
--   · `bolao/shared/sql/**`, `supabase/migrations/**` -> definicoes DDL, nao chamadores em runtime.
--   · testes -> nao usam credencial de usuario autenticado.
--
--   AUTHENTICATED_USER: ZERO.   UNKNOWN: ZERO.
--
-- Nenhum codigo deste repositorio obtem JWT de usuario: nao existe `signInWith`, `supabase.auth`
-- nem `getSession` em lugar nenhum. Ninguem assume `authenticated`.
--
-- ─── ESCOPO — DELIBERADAMENTE ESTREITO ───────────────────────────────────────────────────────
--
-- SO revoga EXECUTE de `authenticated` nestas sete assinaturas. NAO toca:
--   `anon`, `PUBLIC`, `service_role`, RLS, grants de tabela, policies, schema, corpo de funcao,
--   nem DEFAULT PRIVILEGES.
--
-- O `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO "authenticated"` do baseline continua
-- valendo e fara TODA funcao nova nascer com EXECUTE para `authenticated`. Isso e uma decisao
-- mais ampla, com outro risco, e NAO entra aqui -- fica registrado na Issue #267 e vigiado pelo
-- gate de regressao adicionado junto com esta migracao.
--
-- Rollback: supabase/rollbacks/20260821000000_revoke_operator_rpc_execute_from_authenticated.rollback.sql

revoke execute on function public.op_confirm_payment(p_pool_id text, p_entry_ref text, p_paid boolean) from authenticated;
revoke execute on function public.op_remove_entry(p_pool_id text, p_entry_ref text) from authenticated;
revoke execute on function public.op_set_phases(p_pool_id text, p_phases jsonb) from authenticated;
revoke execute on function public.op_set_results(p_pool_id text, p_results jsonb) from authenticated;
revoke execute on function public.op_set_round_email(p_pool_id text, p_round_email jsonb) from authenticated;
revoke execute on function public.op_update_entry(p_pool_id text, p_entry_ref text, p_entry_name text, p_participant_email text, p_payer_name text, p_payment_method text) from authenticated;
revoke execute on function public.resolve_notification_recipients(p_pool_id text, p_entry_refs text[]) from authenticated;
