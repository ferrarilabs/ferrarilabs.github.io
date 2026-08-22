/**
 * TOTAIS DO LIVRO-RAZAO — as somas sao DIFERENTES e tem nomes diferentes.
 *
 * ─── O DEFEITO DE AUDITORIA QUE ISTO IMPEDE ─────────────────────────────────────────────────
 *
 * A producao mostra 76 linhas: 75 contribuicoes somando US$ 888,00 e 1 ajuste de US$ 2,00. Somar
 * a coluna inteira da US$ 890,00 — e uma auditoria que compare esses US$ 890,00 com o total
 * historico de contribuicoes de US$ 888,00 "descobre" uma divergencia de US$ 2,00 que nao existe.
 *
 * Os dois numeros estao certos. Eles respondem perguntas diferentes:
 *
 *   CONTRIBUTION_TOTAL   quanto entrou como participacao no bolao;
 *   ADJUSTMENT_TOTAL     correcoes de reconciliacao, que NAO sao receita;
 *   GROSS_LEDGER_SUM     a soma bruta de tudo, util so para conferir integridade da tabela;
 *   NET_POOL_TOTAL       o que de fato pertence ao bolao, ja liquido de estorno/reembolso.
 *
 * Nenhum deles substitui outro. Este modulo existe para que a pergunta seja feita pelo nome, e
 * para que `SUM(*)` nunca mais seja confundido com "quanto o bolao arrecadou".
 *
 * ─── SEMANTICA: NAO INVENTADA ───────────────────────────────────────────────────────────────
 *
 * Os tipos sao exatamente os do enum `payment_txn_type` em producao — contribution, refund,
 * adjustment, reversal, carryover. Nada aqui cria um tipo novo, um estado novo ou uma regra
 * contabil nova; o modulo so separa somas que ja existiam confundidas numa so.
 *
 * Puro: recebe linhas, devolve numeros. Sem rede, sem banco, sem relogio.
 */

/** Os tipos do enum de producao. Um tipo desconhecido FALHA — nunca cai num balde por omissao. */
export const TXN_TYPES = Object.freeze(["contribution", "refund", "adjustment", "reversal", "carryover"]);

/** Centavos como inteiro. Somar float de dinheiro e como o erro de 1 centavo aparece. */
export function toCents(amount) {
  // `Number("")` e `Number("   ")` valem 0, e 0 e finito: uma celula vazia viraria US$ 0,00 em
  // silencio, somando "nada" onde deveria gritar. Por isso a string vazia e rejeitada ANTES.
  if (typeof amount === "string" && amount.trim() === "") {
    throw new Error("valor vazio no razao — um lancamento sem valor nao vale zero, vale erro");
  }
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error(`valor nao numerico no razao: ${JSON.stringify(amount)}`);
  return Math.round(n * 100);
}

export const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

/**
 * Separa as somas por tipo e devolve os agregados NOMEADOS.
 *
 * `reversal` e o mecanismo append-only do proprio schema (constraint
 * `lottery_payment_txn_reversal_needs_target` exige alvo): um lancamento errado nunca e apagado,
 * e anulado por um contra-lancamento que aponta para ele. Por isso um estorno entra no liquido
 * com o sinal que tiver — anular US$ 2,00 e lancar -US$ 2,00, e a soma liquida vira zero sozinha,
 * sem nenhuma consulta precisar lembrar de filtrar nada.
 */
export function ledgerTotals(rows) {
  const byType = Object.fromEntries(TXN_TYPES.map((t) => [t, { rows: 0, cents: 0 }]));

  for (const r of rows) {
    const t = r.type;
    if (!byType[t]) {
      throw new Error(
        `tipo de transacao desconhecido: ${JSON.stringify(t)}. ` +
        `Um tipo novo tem de ser classificado explicitamente aqui — cair num balde por omissao ` +
        `e como uma soma passa a mentir em silencio.`);
    }
    byType[t].rows += 1;
    byType[t].cents += toCents(r.amount);
  }

  const c = (t) => byType[t].cents;
  const grossCents = TXN_TYPES.reduce((s, t) => s + c(t), 0);

  return {
    byType,
    rowCount: rows.length,

    /** Quanto entrou como participacao. E o numero que a historia do bolao conhece. */
    CONTRIBUTION_TOTAL: c("contribution"),

    /** Correcoes de reconciliacao. NAO sao receita e NAO pertencem ao total de contribuicoes. */
    ADJUSTMENT_TOTAL: c("adjustment"),

    REFUND_TOTAL: c("refund"),
    REVERSAL_TOTAL: c("reversal"),
    CARRYOVER_TOTAL: c("carryover"),

    /** Soma bruta da coluna. Serve para conferir integridade da tabela, NAO para relatar receita. */
    GROSS_LEDGER_SUM: grossCents,

    /**
     * O que pertence ao bolao, liquido. Estorno e reembolso reduzem; ajuste tambem entra, porque
     * um ajuste legitimo de reconciliacao corrige o liquido — e um ajuste que NAO pertence ao
     * bolao e anulado por `reversal`, zerando a si mesmo.
     */
    NET_POOL_TOTAL: c("contribution") + c("adjustment") + c("carryover") + c("refund") + c("reversal"),
  };
}

/**
 * Confere os agregados contra o esperado e devolve as divergencias.
 *
 * Compara SO chaves com o mesmo nome. Era exatamente comparar nomes diferentes — o bruto contra o
 * total de contribuicoes — que produzia a divergencia fantasma de US$ 2,00.
 */
export function checkExpectations(totals, expected) {
  const problems = [];
  for (const [chave, centsEsperado] of Object.entries(expected)) {
    if (!(chave in totals)) { problems.push(`agregado inexistente: ${chave}`); continue; }
    if (totals[chave] !== centsEsperado) {
      problems.push(`${chave}: esperado ${fmt(centsEsperado)}, veio ${fmt(totals[chave])}`);
    }
  }
  return problems;
}
