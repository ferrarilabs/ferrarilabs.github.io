# Correção de classificação — os US$ 2,00 não pertencem ao bolão

**Status: RED — PREPARADO, NÃO EXECUTADO.** Nenhum comando desta página foi rodado contra
produção. A mutação altera um registro financeiro existente e exige autorização explícita e
separada do Eduardo.

**Data:** 2026-08-22 · **Escopo:** `lottery_payment_transactions` · **Linhas afetadas:** 1 inserção

---

## 1. A classificação do dono

A transferência histórica de **US$ 12,00** (Zelle, 2026-08-06) foi classificada definitivamente:

| Parcela | Classificação |
|---|---|
| US$ 10,00 | Contribuição do Powerball |
| US$ 2,00 | Acerto pessoal **alheio** ao bolão |

Os US$ 2,00 **não são** contribuição, ajuste, correção, receita nem histórico de pagamento do
Powerball. Estão fora do domínio financeiro do bolão.

O ajuste de US$ 2,00 hoje em `lottery_payment_transactions` existe apenas porque, no momento da
reconciliação, a finalidade da parcela era desconhecida — o próprio registro diz isso: seu `reason`
começa com *"Pending classification. Excluded from Powerball contribution"*. A classificação chegou;
o registro precisa acompanhar.

## 2. Estado atual verificado em produção (somente leitura, 2026-08-22)

| Agregado | Linhas | Valor |
|---|---|---|
| `CONTRIBUTION_TOTAL` | 75 | **US$ 888,00** |
| `ADJUSTMENT_TOTAL` | 1 | US$ 2,00 |
| `GROSS_LEDGER_SUM` | 76 | US$ 890,00 |

A linha do ajuste: `transaction_id = 60571944-a9ea-4e85-b4d9-7cfce6fb76a0`, `type = adjustment`,
`amount = 2.00`, `method = Zelle`, `provider = Chase`, `paid_at = 2026-08-06`,
`reverses_transaction_id = NULL`.

**Os US$ 888,00 já excluem os US$ 2,00.** A contribuição autoritativa está correta hoje e **não
muda** com esta remediação — o que muda é os US$ 2,00 deixarem de aparecer em qualquer total.

## 3. Modelo escolhido: **B**, por estorno append-only

O pedido apresentou duas opções. A recomendação é **B**, e a razão é que o schema **já foi
construído para isto**:

- o tipo `reversal` existe no enum `payment_txn_type` de produção;
- a constraint `lottery_payment_txn_reversal_needs_target` **exige** que um estorno aponte para o
  lançamento que anula;
- o gatilho `lottery_payment_transactions_immutable` **proíbe** `UPDATE` e `DELETE`.

Ou seja: a forma correta de anular um lançamento nesta tabela nunca foi editá-lo ou removê-lo — é
acrescentar um contra-lançamento. Nada é apagado.

**Por que não a opção A** (marcar como `NON_POOL`/`EXCLUDED`): exigiria um valor de enum novo ou uma
coluna nova, e — mais grave — transformaria a correção num **filtro subtrativo** que toda consulta
futura precisaria lembrar de aplicar. Uma consulta que esquecesse o filtro voltaria a somar os
US$ 2,00 silenciosamente. Além disso, inventaria semântica contábil, contra a instrução explícita de
usar as definições de tipo existentes.

Com o estorno, `SUM(amount)` já sai certo **sem nenhum caso especial**. A correção se autoaplica.

## 4. SQL de avanço (NÃO EXECUTADO)

```sql
begin;

-- Guarda: aborta se o alvo nao estiver exatamente como auditado.
do $$
declare v_amount numeric; v_type text; v_reversed int;
begin
  select amount, type::text into v_amount, v_type
    from lottery_payment_transactions
   where transaction_id = '60571944-a9ea-4e85-b4d9-7cfce6fb76a0';
  if v_amount is null then raise exception 'alvo inexistente — abortado'; end if;
  if v_amount <> 2.00 or v_type <> 'adjustment' then
    raise exception 'alvo mudou (%, %) — abortado', v_type, v_amount;
  end if;
  select count(*) into v_reversed from lottery_payment_transactions
   where reverses_transaction_id = '60571944-a9ea-4e85-b4d9-7cfce6fb76a0';
  if v_reversed > 0 then raise exception 'ja estornado — abortado (idempotencia)'; end if;
end $$;

insert into lottery_payment_transactions
  (participation_id, type, amount, method, provider, source,
   paid_at, reverses_transaction_id, reason, operator_client_ref)
select participation_id,
       'reversal'::payment_txn_type,
       -2.00,
       method, provider, 'operator',
       paid_at,
       transaction_id,
       'NON_POOL: classificado pelo dono em 2026-08-22 como acerto pessoal alheio ao Powerball. '
       'A transferencia de origem foi de USD 12.00 = USD 10.00 de contribuicao + USD 2.00 fora do '
       'dominio do bolao. O ajuste original e preservado como evidencia da reconciliacao; este '
       'contra-lancamento o zera em todos os totais do bolao.',
       'nonpool-reclass-2026-08-22'
  from lottery_payment_transactions
 where transaction_id = '60571944-a9ea-4e85-b4d9-7cfce6fb76a0';

-- Verificacao dentro da transacao: se nao fechar exatamente, nada e gravado.
do $$
declare v_contrib numeric; v_net numeric;
begin
  select coalesce(sum(amount),0) into v_contrib
    from lottery_payment_transactions where type = 'contribution';
  select coalesce(sum(amount),0) into v_net from lottery_payment_transactions;
  if v_contrib <> 888.00 then raise exception 'contribuicao virou % — abortado', v_contrib; end if;
  if v_net <> 888.00 then raise exception 'liquido virou % — abortado', v_net; end if;
end $$;

commit;
```

## 5. Totais depois (previstos, a conferir na execução)

| Agregado | Antes | Depois |
|---|---|---|
| `CONTRIBUTION_TOTAL` | US$ 888,00 | **US$ 888,00** (inalterado) |
| `ADJUSTMENT_TOTAL` | US$ 2,00 | US$ 2,00 (preservado como evidência) |
| `REVERSAL_TOTAL` | US$ 0,00 | −US$ 2,00 |
| Participação do valor alheio nos totais | US$ 2,00 | **US$ 0,00** |
| `GROSS_LEDGER_SUM` | US$ 890,00 | US$ 888,00 |
| Linhas | 76 | 77 (o razão **cresce**, nunca encolhe) |

Invariante exigido pelo dono, satisfeito: contribuição do Powerball = **US$ 888,00**; repagamento
pessoal incluído em totais do Powerball = **US$ 0,00**.

## 6. Rollback

```sql
-- O gatilho de imutabilidade proibe DELETE. Desfazer exige um contra-contra-lancamento,
-- que e o comportamento correto de um razao append-only: o erro tambem fica registrado.
begin;
insert into lottery_payment_transactions
  (participation_id, type, amount, method, provider, source, paid_at,
   reverses_transaction_id, reason, operator_client_ref)
select participation_id, 'reversal'::payment_txn_type, 2.00, method, provider, 'operator', paid_at,
       transaction_id,
       'ROLLBACK de nonpool-reclass-2026-08-22: reclassificacao revertida por decisao do dono.',
       'nonpool-reclass-2026-08-22-rollback'
  from lottery_payment_transactions
 where operator_client_ref = 'nonpool-reclass-2026-08-22';
commit;
```

Depois do rollback os totais voltam a `CONTRIBUTION_TOTAL = 888,00` e `GROSS_LEDGER_SUM = 890,00`.

## 7. Testes

`bolao/loterias/powerball/scripts/test_ledger_totals.mjs` (gate `powerball-ledger-totals`, 12 casos)
fixa, entre outros:

- os quatro agregados são distintos e nomeados (`CONTRIBUTION_TOTAL`, `ADJUSTMENT_TOTAL`,
  `GROSS_LEDGER_SUM`, `NET_POOL_TOTAL`);
- **US$ 890,00 de soma bruta não é divergência** contra US$ 888,00 de contribuições — o falso
  achado, escrito como teste para não ser reaberto;
- comparar `CONTRIBUTION_TOTAL` contra o bruto **reprova**;
- após a remediação, a parcela alheia soma **zero** em todo total do bolão;
- a remediação **não apaga** história (o razão cresce de 76 para 77 linhas) e **não toca** a
  contribuição;
- tipo de transação desconhecido **falha alto** em vez de cair num balde por omissão.

## 8. O que falta

Autorização explícita e separada do Eduardo para executar a seção 4 contra produção.
