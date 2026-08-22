-- Issue #130 — o banco vira o SISTEMA DE REGISTRO do pagamento do Powerball.
--
-- EXECUTADO EM PRODUCAO em 2026-08-22, sob decisao explicita do dono: "YES. O banco
-- PostgreSQL/Supabase passa a ser o sistema de registro autoritativo de participantes,
-- participacoes e transacoes de pagamento. GitHub secrets NAO sao banco de pagamento."
--
-- ─── O QUE ESTA MIGRACAO FAZ, E O QUE ELA NAO TOCA ───────────────────────────────────────────
--
-- Ela so acrescenta INVARIANTE. Nenhuma linha de pagamento foi criada, editada ou removida:
-- contagem 11 e soma 102.00 antes e depois, identicas.
--
-- ─── 1. IDEMPOTENCIA DE ACAO DE OPERADOR ────────────────────────────────────────────────────
--
-- Ja existia unicidade em `external_reference` (parcial, onde nao nulo). Ela NAO basta: identifica
-- a transacao no PROVEDOR (Zelle/Venmo) e e legitimamente nula num ajuste manual, que e
-- exatamente o caso em que um operador reexecuta um dispatch depois de um erro transitorio e cria
-- a segunda cobranca. `operator_client_ref` identifica a ACAO, nao o pagamento.
--
-- ─── 2. INVARIANTES DE REVERSAO, DERIVADAS E NAO ADIVINHADAS ────────────────────────────────
--
-- O enum `payment_txn_type` ja tem `reversal`, e a coluna `reverses_transaction_id` ja existe. Daí
-- saem tres invariantes que NAO dependem de eu supor semantica financeira:
--   - `reverses_transaction_id <> transaction_id`  (auto-reversao e sempre incoerente);
--   - `type = 'reversal'` exige alvo                (uma reversao sem o que reverter nao e uma);
--   - no maximo UMA reversao por transacao          (duas contariam o estorno duas vezes).
--
-- Deliberadamente NAO constrangido: o SINAL do `amount` de uma reversao, e se um `adjustment` pode
-- referenciar a transacao que ajusta. Os dados vivos (10 contribution + 1 adjustment, todos
-- positivos, zero reversoes) nao decidem nenhum dos dois, e inventar a regra aqui seria adivinhar
-- semantica financeira. Registrado como invariante em aberto.
--
-- ─── 3. HISTORICO FINANCEIRO APPEND-ONLY ────────────────────────────────────────────────────
--
-- Nao havia NENHUM trigger em nenhuma tabela `lottery_*`: o modelo append-only existia como
-- intencao no schema (`reverses_transaction_id`, `reason`, `source`) e como nada na execucao.
-- Um UPDATE em `amount` passava.
--
-- O trigger bloqueia DELETE e bloqueia UPDATE dos campos FINANCEIROS (participation_id, type,
-- amount, external_reference, reverses_transaction_id, paid_at, created_at). Campo nao-financeiro
-- (memo, proof_object_path) continua editavel -- travar tudo transformaria uma correcao de anotacao
-- numa reversao contabil, que e desproporcional.
--
-- ESCAPE EXPLICITO PARA RECUPERACAO DO DONO: `set local lottery.allow_history_rewrite = 'on'`.
-- Ele existe porque bloquear irrestritamente tambem bloquearia uma restauracao legitima; e e um
-- GUC de sessao, deliberado e visivel no log, nunca um caminho acidental.
--
-- ─── VERIFICADO ANTES DE APLICAR ────────────────────────────────────────────────────────────
--
-- Toda esta migracao foi executada dentro de uma transacao contra a PRODUCAO REAL e revertida, com
-- as sete assercoes medidas no caminho:
--   UPDATE de amount BLOQUEADO · DELETE BLOQUEADO · UPDATE de memo PERMITIDO ·
--   reversao com alvo ACEITA · reversao sem alvo REJEITADA · reversao dupla REJEITADA ·
--   operator_client_ref duplicado REJEITADO
-- Depois do rollback, coluna e trigger ausentes e dados intactos; so entao foi aplicada de fato.
--
-- ─── REVERSAO ───────────────────────────────────────────────────────────────────────────────
--
-- `supabase/rollbacks/` com o mesmo basename.

-- ── 1. IDEMPOTENCIA DE ACAO DE OPERADOR ─────────────────────────────────────────────────────
alter table public.lottery_payment_transactions
  add column if not exists operator_client_ref text;

create unique index if not exists lottery_payment_transactions_operator_client_ref_uidx
  on public.lottery_payment_transactions (operator_client_ref)
  where operator_client_ref is not null;

comment on column public.lottery_payment_transactions.operator_client_ref is
  'Chave de idempotencia da ACAO DE OPERADOR. Distinta de external_reference, que identifica a '
  'transacao no provedor (Zelle/Venmo) e pode ser nula em ajuste manual. Mesmo ref + mesma '
  'requisicao semantica = mesmo resultado, sem transacao duplicada.';

-- ── 2. INVARIANTES DE REVERSAO ──────────────────────────────────────────────────────────────
alter table public.lottery_payment_transactions
  add constraint lottery_payment_txn_no_self_reversal
  check (reverses_transaction_id is distinct from transaction_id);

alter table public.lottery_payment_transactions
  add constraint lottery_payment_txn_reversal_needs_target
  check (type <> 'reversal' or reverses_transaction_id is not null);

create unique index if not exists lottery_payment_transactions_reverses_uidx
  on public.lottery_payment_transactions (reverses_transaction_id)
  where reverses_transaction_id is not null;

-- ── 3. HISTORICO FINANCEIRO IMUTAVEL ────────────────────────────────────────────────────────
create or replace function public.lottery_payment_history_is_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if current_setting('lottery.allow_history_rewrite', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'lottery_payment_transactions e APPEND-ONLY: DELETE proibido (transaction_id=%). '
      'Corrija com uma transacao de reversao/ajuste.', old.transaction_id
      using errcode = 'restrict_violation';
  end if;

  if new.transaction_id is distinct from old.transaction_id
     or new.participation_id is distinct from old.participation_id
     or new.type is distinct from old.type
     or new.amount is distinct from old.amount
     or new.external_reference is distinct from old.external_reference
     or new.reverses_transaction_id is distinct from old.reverses_transaction_id
     or new.paid_at is distinct from old.paid_at
     or new.created_at is distinct from old.created_at then
    raise exception
      'lottery_payment_transactions e APPEND-ONLY: fato financeiro nao pode ser editado '
      '(transaction_id=%). Insira uma transacao de reversao/ajuste.', old.transaction_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$fn$;

revoke all on function public.lottery_payment_history_is_immutable() from public, anon, authenticated;

drop trigger if exists lottery_payment_transactions_immutable on public.lottery_payment_transactions;
create trigger lottery_payment_transactions_immutable
  before update or delete on public.lottery_payment_transactions
  for each row execute function public.lottery_payment_history_is_immutable();
