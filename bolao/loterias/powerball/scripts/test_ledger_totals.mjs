#!/usr/bin/env node
/**
 * INVARIANTES FINANCEIROS DO POWERBALL — as somas nao podem se confundir.
 *
 * O caso real que originou esta suite: producao tem 76 linhas, 75 contribuicoes somando US$ 888,00
 * e 1 ajuste de US$ 2,00. `SUM(amount)` da US$ 890,00. Uma auditoria que compare esses US$ 890,00
 * com o total historico de contribuicoes (US$ 888,00) reporta uma divergencia de US$ 2,00 que nao
 * existe: os dois numeros estao certos e respondem perguntas diferentes.
 *
 * Aqui tambem fica fixada a correcao de classificacao de 2026-08-22: a transferencia de US$ 12,00
 * era US$ 10,00 de contribuicao mais US$ 2,00 de acerto pessoal alheio ao bolao. O modelo escolhido
 * (estorno append-only) tem de zerar o US$ 2,00 em TODO total do bolao sem apagar historia.
 *
 * Sem rede e sem banco: os cenarios sao fixtures. Uso: node .../test_ledger_totals.mjs
 */

import { ledgerTotals, checkExpectations, toCents, fmt, TXN_TYPES } from "./ledger_totals.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

// Producao em 2026-08-22, antes da remediacao. Sem PII: so tipo e valor.
const PRODUCAO = [
  ...Array.from({ length: 75 }, () => ({ type: "contribution", amount: "11.84" })),
  { type: "adjustment", amount: "2.00" },
];
// Os 75 valores reais variam; o que importa e o TOTAL. Ajusta o ultimo para fechar em 888,00.
PRODUCAO[74] = { type: "contribution", amount: (888 - 11.84 * 74).toFixed(2) };

console.log("\nInvariantes financeiros do Powerball\n");
console.log("A distincao que a auditoria de julho confundiu:");

test("os quatro agregados sao DIFERENTES e tem nomes proprios", () => {
  const t = ledgerTotals(PRODUCAO);
  eq(fmt(t.CONTRIBUTION_TOTAL), "$888.00", "contribuicoes");
  eq(fmt(t.ADJUSTMENT_TOTAL), "$2.00", "ajustes");
  eq(fmt(t.GROSS_LEDGER_SUM), "$890.00", "soma bruta");
  assert(t.CONTRIBUTION_TOTAL !== t.GROSS_LEDGER_SUM,
    "se estes dois forem iguais a suite deixa de provar qualquer coisa");
});

test("US$ 890,00 de soma bruta NAO e divergencia contra US$ 888,00 de contribuicoes", () => {
  // O falso achado, escrito como teste para nunca mais ser aberto como bug.
  const t = ledgerTotals(PRODUCAO);
  eq(t.GROSS_LEDGER_SUM - t.CONTRIBUTION_TOTAL, t.ADJUSTMENT_TOTAL,
    "a diferenca entre bruto e contribuicoes E o ajuste — nao dinheiro faltando");
  eq(checkExpectations(t, { CONTRIBUTION_TOTAL: 88800 }).length, 0,
    "a expectativa de contribuicao tem de continuar batendo sozinha");
});

test("checkExpectations so compara chaves de MESMO nome", () => {
  const t = ledgerTotals(PRODUCAO);
  eq(checkExpectations(t, { GROSS_LEDGER_SUM: 89000, CONTRIBUTION_TOTAL: 88800 }).length, 0, "ambas certas");
  const p = checkExpectations(t, { CONTRIBUTION_TOTAL: 89000 });   // o erro classico
  eq(p.length, 1, "comparar contribuicoes contra o bruto tem de REPROVAR");
  assert(/CONTRIBUTION_TOTAL/.test(p[0]), "a mensagem tem de nomear o agregado errado");
});

console.log("\nCorrecao de classificacao de 2026-08-22 (os US$ 2,00 nao sao do bolao):");

// Modelo B: estorno append-only. Nada e apagado; um contra-lancamento aponta para o original.
const REMEDIADO = [
  ...PRODUCAO,
  { type: "reversal", amount: "-2.00", reverses_transaction_id: "60571944-a9ea-4e85-b4d9-7cfce6fb76a0" },
];

test("apos a remediacao, o acerto pessoal soma ZERO em todo total do bolao", () => {
  const t = ledgerTotals(REMEDIADO);
  eq(fmt(t.ADJUSTMENT_TOTAL + t.REVERSAL_TOTAL), "$0.00",
    "o ajuste alheio ao bolao continua influenciando algum total");
  eq(fmt(t.NET_POOL_TOTAL), "$888.00", "liquido do bolao");
  eq(fmt(t.GROSS_LEDGER_SUM), "$888.00", "soma bruta tambem fecha em 888 depois do estorno");
});

test("INVARIANTE EXIGIDO: contribuicao = US$ 888,00 e repagamento pessoal = US$ 0,00", () => {
  const t = ledgerTotals(REMEDIADO);
  eq(fmt(t.CONTRIBUTION_TOTAL), "$888.00", "a contribuicao autoritativa nao pode mudar");
  eq(fmt(t.ADJUSTMENT_TOTAL + t.REVERSAL_TOTAL), "$0.00", "participacao do valor alheio nos totais");
});

test("a remediacao NAO apaga historia — as 76 linhas originais continuam la", () => {
  const t = ledgerTotals(REMEDIADO);
  eq(t.rowCount, 77, "o razao tem de CRESCER (append-only), nunca encolher");
  eq(t.byType.adjustment.rows, 1, "a evidencia de que a transferencia de US$ 12,00 existiu sumiu");
  eq(t.byType.reversal.rows, 1, "o contra-lancamento tem de existir");
});

test("a contribuicao NAO e tocada pela remediacao", () => {
  const antes = ledgerTotals(PRODUCAO), depois = ledgerTotals(REMEDIADO);
  eq(antes.CONTRIBUTION_TOTAL, depois.CONTRIBUTION_TOTAL, "o estorno mexeu na contribuicao");
  eq(antes.byType.contribution.rows, depois.byType.contribution.rows, "numero de contribuicoes mudou");
});

console.log("\nO modulo falha alto em vez de somar errado:");

test("tipo desconhecido FALHA — nunca cai num balde por omissao", () => {
  let lancou = false;
  try { ledgerTotals([{ type: "donation", amount: "5.00" }]); } catch { lancou = true; }
  eq(lancou, true, "um tipo novo passou batido e foi somado em algum lugar sem ninguem decidir");
});

test("os tipos sao exatamente os do enum de producao, nada inventado", () => {
  eq(JSON.stringify([...TXN_TYPES].sort()),
     JSON.stringify(["adjustment", "carryover", "contribution", "refund", "reversal"]),
     "o conjunto de tipos divergiu do enum payment_txn_type");
});

test("valor nao numerico FALHA em vez de virar zero", () => {
  for (const ruim of [null, undefined, "", "abc", {}]) {
    let lancou = false;
    try { toCents(ruim); } catch { lancou = true; }
    eq(lancou, true, `valor ${JSON.stringify(ruim)} passou como numero`);
  }
});

test("dinheiro e somado em centavos inteiros, nao em float", () => {
  // 0.1 + 0.2 em float da 0.30000000000000004. Em centavos da 30, sempre.
  const t = ledgerTotals([{ type: "contribution", amount: "0.10" }, { type: "contribution", amount: "0.20" }]);
  eq(t.CONTRIBUTION_TOTAL, 30, "erro de ponto flutuante entrou na soma");
  eq(fmt(t.CONTRIBUTION_TOTAL), "$0.30", "formatacao");
});

test("razao vazio da zero em tudo, sem NaN", () => {
  const t = ledgerTotals([]);
  for (const k of ["CONTRIBUTION_TOTAL", "ADJUSTMENT_TOTAL", "GROSS_LEDGER_SUM", "NET_POOL_TOTAL"]) {
    eq(t[k], 0, k);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ INVARIANTES FINANCEIROS REPROVADOS\n"); process.exit(1); }
console.log("✓ INVARIANTES FINANCEIROS OK\n");
