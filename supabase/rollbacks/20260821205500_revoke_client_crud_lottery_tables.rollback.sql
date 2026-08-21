-- Reversao de 20260821205500_revoke_client_crud_lottery_tables.sql (Issue #131).
--
-- Simetrico porque a medicao de producao era simetrica: em 2026-08-21, imediatamente antes da
-- remediacao, `anon` E `authenticated` tinham os QUATRO verbos nas SEIS tabelas. Reconceder
-- exatamente isso restaura o estado anterior, nem mais nem menos.
--
-- NAO reconcede TRUNCATE, REFERENCES nem TRIGGER: aqueles sao a Issue #276, ja estavam `false`
-- antes desta migracao, e devolve-los aqui seria conceder privilegio que o estado revertido nao
-- tinha. `service_role` nao aparece porque nunca foi tocado.

begin;

grant select, insert, update, delete on table public.lottery_admin_audit          to anon, authenticated;
grant select, insert, update, delete on table public.lottery_draws                to anon, authenticated;
grant select, insert, update, delete on table public.lottery_participants         to anon, authenticated;
grant select, insert, update, delete on table public.lottery_participations       to anon, authenticated;
grant select, insert, update, delete on table public.lottery_payment_transactions to anon, authenticated;
grant select, insert, update, delete on table public.lottery_pools                to anon, authenticated;

commit;
