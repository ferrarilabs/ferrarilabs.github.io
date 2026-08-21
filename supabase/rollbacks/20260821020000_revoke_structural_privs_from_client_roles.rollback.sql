-- ROLLBACK de 20260821020000_revoke_structural_privs_from_client_roles.sql — Issue #276.
--
-- Restaura EXATAMENTE o estado medido em producao antes da mudanca, tabela por tabela e papel por
-- papel -- nao uma constante uniforme.
--
-- Isso importa e ja custou caro uma vez. `scripts/db/legacy_fence.mjs` registra o defeito
-- KPLUS-F042: um rollback gerado como espelho constante do REVOKE teria CONCEDIDO a `anon`
-- TRUNCATE em seis tabelas de participante e pagamento -- privilegio que `anon` nunca teve. Um
-- rollback que nao consulta o estado anterior nao e rollback: e uma segunda mudanca.
--
-- Por isso `anon` aparece com TRUNCATE em apenas DUAS tabelas (as de notificacao, as unicas onde
-- realmente tinha) e `public.cdb_entry_access` nao aparece de forma nenhuma.
--
-- AVISO: aplicar isto reintroduz a exposicao descrita na Issue #276.

begin;

grant truncate, references, trigger on table public.bolao_entry_private to authenticated;
grant truncate, references, trigger on table public.bolao_notif_jobs to anon;
grant truncate, references, trigger on table public.bolao_notif_jobs to authenticated;
grant truncate, references, trigger on table public.bolao_round_notif_jobs to anon;
grant truncate, references, trigger on table public.bolao_round_notif_jobs to authenticated;
grant references, trigger on table public.bolao_state to anon;
grant truncate, references, trigger on table public.bolao_state to authenticated;
grant references, trigger on table public.live_sports_cache to anon;
grant truncate, references, trigger on table public.live_sports_cache to authenticated;
grant references, trigger on table public.lottery_admin_audit to anon;
grant truncate, references, trigger on table public.lottery_admin_audit to authenticated;
grant references, trigger on table public.lottery_draws to anon;
grant truncate, references, trigger on table public.lottery_draws to authenticated;
grant references, trigger on table public.lottery_participants to anon;
grant truncate, references, trigger on table public.lottery_participants to authenticated;
grant references, trigger on table public.lottery_participations to anon;
grant truncate, references, trigger on table public.lottery_participations to authenticated;
grant references, trigger on table public.lottery_payment_transactions to anon;
grant truncate, references, trigger on table public.lottery_payment_transactions to authenticated;
grant references, trigger on table public.lottery_pools to anon;
grant truncate, references, trigger on table public.lottery_pools to authenticated;

commit;
