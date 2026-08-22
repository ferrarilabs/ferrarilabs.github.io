-- Reversao da migracao de mesmo nome (Issue #130).
--
-- Remove APENAS os invariantes acrescentados. Nao restaura nada, porque nada foi removido: a
-- migracao nao tocou em nenhuma linha de pagamento.
--
-- Reverter isto devolve o banco ao estado em que um UPDATE de `amount` e um DELETE de historico
-- financeiro passam sem obstaculo. So faca isso com um motivo escrito.

begin;

drop trigger if exists lottery_payment_transactions_immutable on public.lottery_payment_transactions;
drop function if exists public.lottery_payment_history_is_immutable();

drop index if exists public.lottery_payment_transactions_reverses_uidx;
alter table public.lottery_payment_transactions
  drop constraint if exists lottery_payment_txn_reversal_needs_target;
alter table public.lottery_payment_transactions
  drop constraint if exists lottery_payment_txn_no_self_reversal;

drop index if exists public.lottery_payment_transactions_operator_client_ref_uidx;
alter table public.lottery_payment_transactions drop column if exists operator_client_ref;

commit;
