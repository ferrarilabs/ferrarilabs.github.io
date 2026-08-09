#!/usr/bin/env node
/**
 * MODELO DE SORTEIO DO POWERBALL — ciclo de vida, seletor e carry-forward financeiro.
 *
 * ─── POR QUE ESTE ARQUIVO FOI REESCRITO (2026-08-09) ─────────────────────────────────────────
 *
 * A versão anterior fixava `2026-08-08` como "o próximo sorteio" e `2026-08-05` como "o anterior".
 * Isso era verdade no dia em que foi escrito e deixou de ser assim que o 08/08 recebeu resultado e
 * o 10/08 foi aberto. Resultado: 2 falhas que não apontavam defeito nenhum do produto.
 *
 * Trocar 08/08 por 10/08 teria recriado exatamente a mesma dívida para o sorteio seguinte. Então o
 * teste passou a DESCOBRIR o sorteio corrente pela mesma semântica que a aplicação usa, em vez de
 * afirmar uma data.
 *
 * ─── TRÊS COISAS QUE A INVESTIGAÇÃO REVELOU, E QUE MUDAM O DESENHO ───────────────────────────
 *
 * 1. `status: "planejamento"` NÃO é confiável para decidir ciclo de vida. Em produção, hoje, o
 *    sorteio 2026-08-08 tem `status: "planejamento"` E resultado oficial gravado — o campo ficou
 *    obsoleto quando o resultado chegou. Verificado: NENHUM código de produto lê `draw.status`
 *    (só o teste antigo lia). A aplicação decide por PRESENÇA DE RESULTADO:
 *    `var hasResult = effectiveDraw.result && effectiveDraw.result.numbers;`
 *    O teste agora usa o mesmo predicado, e há um teste de contrato abaixo proibindo que a decisão
 *    volte a depender de `status`. Não corrigi o dado de produção — isto é dívida de teste, e
 *    mexer em dado real não está no escopo.
 *
 * 2. O rótulo do seletor era COPIADO aqui, com o comentário "kept in sync manually". Não estava:
 *    o app mudou para o formato compacto (`🔴 Powerball — 10/08/2026 · próximo`) e esta cópia
 *    seguia no formato antigo (`Próximo sorteio — ... — Em planejamento`). Ou seja, três testes
 *    de rótulo passavam verde testando uma função que não existe mais em lugar nenhum — verde
 *    falso clássico. Agora a função REAL é extraída do `js/app.js` e executada; se o app mudar o
 *    rótulo, estes testes acompanham ou falham, nunca divergem em silêncio.
 *
 * 3. A seleção do sorteio corrente é `DRAWS[DRAWS.length - 1]` (`var currentIdx = DRAWS.length - 1`
 *    em app.js). É ordem de array, não data — então há um teste de contrato garantindo que a
 *    ordem do array e a ordem cronológica não divirjam, porque se divergirem o app exibe o
 *    sorteio errado sem nenhum sintoma visível.
 *
 * DRAW_TEST_SELECTION: sorteio corrente = último elemento de DRAWS; "por sortear" = sem
 * `result.numbers`; encadeamento histórico via `previousDrawId`. Nenhuma data fixada.
 *
 * Uso: node bolao/loterias/powerball/scripts/audit_draw_model_tests.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllDraws } from "./email/snapshot.mjs";
import { loadRealPrizeCalculator } from "./email/prize-calc-bridge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(HERE, "..", "js", "app.js");
const appSrc = readFileSync(APP_JS, "utf8");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

// ─── A função REAL do app, não uma cópia ────────────────────────────────────────────────────
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() não encontrada em js/app.js`);
  let depth = 0;
  for (let j = src.indexOf("{", start); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`chaves desbalanceadas em ${name}()`);
}

const { DRAWS: RAW_DRAWS, GAME_TYPES } = loadRealPrizeCalculator();
const realDrawSelectorLabel = new Function("GAME_TYPES", `
  ${extractFn(appSrc, "drawSelectorLabel")}
  return drawSelectorLabel;
`)(GAME_TYPES);

// O app rotula com base no sorteio EFETIVO (data.js + overrides de localStorage). Fora do
// navegador não há localStorage, então o efetivo é o próprio sorteio — mesma função, mesmo
// caminho, sem override.
const label = (d) => realDrawSelectorLabel(d, d);

const draws = loadAllDraws();
const isResolved = (d) => !!(d.result && d.result.numbers);

// Semântica de seleção da aplicação: `var currentIdx = DRAWS.length - 1`.
const currentDraw = draws[draws.length - 1];

console.log("Powerball — modelo de sorteio (descoberto, não fixado em data)\n");
console.log(`  sorteio corrente descoberto: ${currentDraw.id} (${isResolved(currentDraw) ? "com resultado" : "por sortear"})`);
console.log(`  total de sorteios: ${draws.length}\n`);

// ─── Contratos: a semântica que o teste assume tem que continuar sendo a do app ──────────────

test("CONTRATO: o app seleciona o sorteio corrente como o ÚLTIMO do array", () => {
  assert.ok(/var currentIdx = DRAWS\.length - 1/.test(appSrc),
    "app.js não seleciona mais o último sorteio — a descoberta deste teste ficou inválida e " +
    "precisa acompanhar a nova regra, não continuar verde em cima da antiga");
});

test("CONTRATO: o app decide 'já sorteado' por PRESENÇA DE RESULTADO, nunca por `status`", () => {
  assert.ok(/result && \w+\.result\.numbers/.test(appSrc),
    "o app deixou de usar presença de resultado como predicado de ciclo de vida");
  const statusReads = appSrc.match(/\b\w+\.status\s*===\s*["']planejamento["']/g) || [];
  assert.equal(statusReads.length, 0,
    "o app passou a decidir ciclo de vida por `status` — em produção esse campo já está obsoleto " +
    "(2026-08-08 tem status 'planejamento' COM resultado oficial), então essa decisão nasceria errada");
});

test("CONTRATO: a ordem do array coincide com a ordem cronológica", () => {
  // A seleção é por índice. Se alguém inserir um sorteio fora de ordem, o app passa a exibir o
  // sorteio errado como "corrente" sem nenhum sintoma visível — nem erro, nem tela quebrada.
  const dates = draws.map((d) => new Date(d.drawing.drawDateIso).getTime());
  for (let i = 1; i < dates.length; i++) {
    assert.ok(dates[i] > dates[i - 1],
      `sorteio ${draws[i].id} vem depois de ${draws[i - 1].id} no array mas não no tempo — ` +
      `com seleção por índice, isso faz o app exibir o sorteio errado silenciosamente`);
  }
});

// ─── Identidade e rótulo ────────────────────────────────────────────────────────────────────

test("nenhum drawId duplicado", () => {
  const ids = draws.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, `drawId duplicado: ${ids}`);
});

test("nenhum rótulo duplicado no seletor (usando a função REAL do app)", () => {
  const labels = draws.map(label);
  assert.equal(new Set(labels).size, labels.length,
    `rótulo duplicado — duas opções indistinguíveis no seletor: ${JSON.stringify(labels)}`);
});

test("nenhum rótulo embute marcador de seleção (✓/✔) — seleção é estilo + aria, não glifo", () => {
  for (const l of draws.map(label)) {
    assert.ok(!/[✓✔☑✅]/.test(l), `rótulo com glifo de seleção: ${JSON.stringify(l)}`);
  }
});

test("nenhum rótulo embute o resultado — o seletor serve para ESCOLHER, não para exibir", () => {
  for (const l of draws.map(label)) {
    assert.ok(!/Resultado:/i.test(l), `rótulo embute resultado: ${JSON.stringify(l)}`);
    assert.ok(l.length <= 46, `rótulo longo demais (${l.length} chars): ${JSON.stringify(l)}`);
  }
});

// ─── Ciclo de vida do sorteio corrente ──────────────────────────────────────────────────────

test("o sorteio corrente aparece no seletor de forma distinta de todos os históricos", () => {
  const mine = label(currentDraw);
  const others = draws.filter((d) => d.id !== currentDraw.id).map(label);
  assert.ok(!others.includes(mine),
    `o sorteio corrente (${currentDraw.id}) tem o mesmo rótulo de um histórico: ${JSON.stringify(mine)}`);
});

test("um sorteio POR SORTEAR não tem resultado nem lucro apurado", () => {
  for (const d of draws.filter((x) => !isResolved(x))) {
    assert.equal(d.result, null, `${d.id} está por sortear mas tem result não-nulo`);
    assert.equal(d.profit, null, `${d.id} está por sortear mas já tem profit apurado`);
  }
});

test("sorteios já realizados NUNCA são confundidos com o próximo (sufixo ' · próximo' é exclusivo)", () => {
  for (const d of draws) {
    const temSufixo = / · próximo$/.test(label(d));
    assert.equal(temSufixo, !isResolved(d),
      `${d.id}: ${isResolved(d) ? "tem resultado mas está marcado como próximo" : "está por sortear mas não está marcado como próximo"}`);
  }
});

test("todo sorteio por sortear vem DEPOIS de todos os já realizados", () => {
  // Um sorteio sem resultado no meio da lista significa resultado perdido, não sorteio futuro.
  const primeiroPorSortear = draws.findIndex((d) => !isResolved(d));
  if (primeiroPorSortear === -1) return; // todos resolvidos: estado legítimo entre sorteios
  for (let i = primeiroPorSortear; i < draws.length; i++) {
    assert.ok(!isResolved(draws[i]),
      `${draws[i].id} tem resultado mas vem depois de ${draws[primeiroPorSortear].id}, que não tem — ` +
      `provavelmente um resultado que nunca foi gravado, não um sorteio futuro`);
  }
});

// ─── Encadeamento histórico ─────────────────────────────────────────────────────────────────

const byId = new Map(draws.map((d) => [d.id, d]));
const chained = draws.filter((d) => d.previousDrawId);

test("todo previousDrawId aponta para um sorteio que existe e é anterior", () => {
  for (const d of chained) {
    const prev = byId.get(d.previousDrawId);
    assert.ok(prev, `${d.id} aponta para previousDrawId inexistente: ${d.previousDrawId}`);
    assert.ok(draws.indexOf(prev) < draws.indexOf(d),
      `${d.id} aponta para ${prev.id}, que não vem antes dele`);
  }
});

test("bilhetes do sorteio anterior não vazam para o seguinte (serial compartilhado = copy-paste)", () => {
  for (const d of chained) {
    const prev = byId.get(d.previousDrawId);
    const prevSerials = new Set((prev.sharedTickets?.series || []).map((s) => s.serial));
    for (const s of d.sharedTickets?.series || []) {
      assert.ok(!prevSerials.has(s.serial),
        `serial aparece em ${prev.id} e em ${d.id} — parece cópia, não compra independente`);
    }
  }
});

test("o resultado oficial de um sorteio realizado tem forma sã e é rastreável", () => {
  for (const d of draws.filter(isResolved)) {
    const r = d.result;
    assert.equal(r.numbers.length, 5, `${d.id}: resultado sem 5 bolas brancas`);
    assert.equal(new Set(r.numbers).size, 5, `${d.id}: bola branca repetida`);
    for (const n of r.numbers) {
      assert.ok(Number.isInteger(n) && n >= 1 && n <= 69, `${d.id}: bola branca fora de 1–69: ${n}`);
    }
    assert.ok(Number.isInteger(r.special) && r.special >= 1 && r.special <= 26,
      `${d.id}: Powerball fora de 1–26: ${r.special}`);
    assert.ok(r.checkedAt, `${d.id}: resultado sem carimbo de conferência`);
  }
});

test("toda data de sorteio cai num dia real do Powerball (seg/qua/sáb, ET)", () => {
  // Substitui a antiga verificação que afirmava "2026-08-05 é quarta, logo o próximo é sábado
  // 08/08" — verdadeira e inútil: valia para um par específico de datas.
  const DIAS = { 1: "segunda", 3: "quarta", 6: "sábado" };
  for (const d of draws) {
    const [y, m, day] = d.drawing.drawDateIso.slice(0, 10).split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    assert.ok(DIAS[wd],
      `${d.id} cai em dia sem sorteio do Powerball (weekday ${wd}) — sorteios são seg/qua/sáb`);
  }
});

// ─── Carry-forward financeiro ───────────────────────────────────────────────────────────────

console.log("\nReconciliação do carry-forward financeiro:");

test("creditoSorteioAnterior = saldo guardado + prêmios CONFIRMADOS do sorteio anterior", () => {
  for (const d of chained) {
    const prev = byId.get(d.previousDrawId);
    if (!isResolved(prev)) continue; // anterior ainda sem resultado: nada a carregar
    const esperado = prev.finance.valorGuardadoProximoSorteio + prev.result.premiosGanhos;
    assert.equal(d.finance.creditoSorteioAnterior, esperado,
      `${d.id}: crédito ${d.finance.creditoSorteioAnterior} ≠ ${esperado} ` +
      `(guardado ${prev.finance.valorGuardadoProximoSorteio} + prêmios ${prev.result.premiosGanhos} de ${prev.id})`);
  }
});

// A identidade do razão só vale para sorteio LIQUIDADO. Minha primeira versão deste teste a
// aplicou a todos e falhou no 2026-08-10 (74 disponíveis, 0 utilizados, 0 guardados) — e a falha
// era do teste, não do dado: um sorteio ABERTO tem saldo ainda não aplicado, que por definição
// não está nem em `valorUtilizado` nem em `valorGuardadoProximoSorteio`. Tratar os dois estados
// como um só é o mesmo erro de categoria que fez a versão anterior deste arquivo fixar uma data.
test("sorteio LIQUIDADO: o razão fecha (arrecadado + crédito === utilizado + guardado)", () => {
  const liquidados = draws.filter(isResolved);
  assert.ok(liquidados.length > 0, "sanidade: deveria haver ao menos um sorteio liquidado");
  for (const d of liquidados) {
    const f = d.finance;
    assert.equal(f.totalArrecadado + (f.creditoSorteioAnterior || 0),
      f.valorUtilizado + f.valorGuardadoProximoSorteio,
      `${d.id}: razão de sorteio liquidado não fecha`);
  }
});

test("sorteio ABERTO: nunca gasta mais do que tem, e nada fica negativo", () => {
  for (const d of draws.filter((x) => !isResolved(x))) {
    const f = d.finance;
    const disponivel = f.totalArrecadado + (f.creditoSorteioAnterior || 0);
    assert.ok(f.valorUtilizado <= disponivel,
      `${d.id}: gastou ${f.valorUtilizado} tendo ${disponivel} disponíveis`);
    for (const [k, v] of Object.entries(f)) {
      assert.ok(v >= 0, `${d.id}: ${k} negativo (${v})`);
    }
  }
});

test("nenhum prêmio não-confirmado entra no carry-forward", () => {
  for (const d of chained) {
    const prev = byId.get(d.previousDrawId);
    if (!isResolved(prev)) continue;
    assert.ok(prev.result.checkedAt,
      `${prev.id} alimenta o crédito de ${d.id} sem carimbo de conferência`);
  }
});

// ─── Regressão sobre modelo sintético: o teste não pode quebrar quando um sorteio termina ────

console.log("\nRegressão de ciclo de vida (dados sintéticos, isolados da produção):");

const fx = (id, iso, opts = {}) => ({
  id, gameType: "powerball", previousDrawId: opts.prev || null,
  drawing: { drawDateIso: iso, drawDateLabel: opts.dateLabel || `${id} 22:59 ET` },
  sharedTickets: { series: opts.series || [] },
  finance: { totalArrecadado: 0, creditoSorteioAnterior: 0, valorUtilizado: 0, valorGuardadoProximoSorteio: 0 },
  result: opts.result || null,
  profit: opts.result ? 0 : null,
  ...(opts.status ? { status: opts.status } : {}),
});
const RES = { numbers: [1, 2, 3, 4, 5], special: 6, premiosGanhos: 0, checkedAt: "x" };

// Cenário completo pedido: histórico antigo, histórico recente, e o planejado sem resultado.
const cenario = [
  fx("s-01", "2026-01-05T22:59:00-05:00", { result: RES }),
  fx("s-02", "2026-01-07T22:59:00-05:00", { prev: "s-01", result: RES }),
  // Reproduz o defeito REAL de produção: status obsoleto num sorteio já realizado.
  fx("s-03", "2026-01-10T22:59:00-05:00", { prev: "s-02", result: RES, status: "planejamento" }),
  fx("s-04", "2026-01-12T22:59:00-05:00", { prev: "s-03", status: "planejamento" }),
];
const resolvedFx = (d) => !!(d.result && d.result.numbers);

test("um sorteio JÁ REALIZADO com `status: planejamento` obsoleto não é tomado como o próximo", () => {
  const corrente = cenario[cenario.length - 1];
  assert.equal(corrente.id, "s-04");
  assert.equal(resolvedFx(corrente), false);
  const falsosProximos = cenario.filter((d) => d.status === "planejamento" && resolvedFx(d));
  assert.equal(falsosProximos.length, 1, "o cenário deveria conter o caso obsoleto");
  assert.ok(!falsosProximos.includes(corrente),
    "o sorteio corrente foi escolhido por `status` — é assim que um sorteio já realizado vira 'o próximo'");
});

test("quando o planejado recebe resultado, o corrente passa a ser o novo planejado", () => {
  // É exatamente a transição que quebrou a versão anterior deste arquivo.
  const depois = cenario.map((d) => d.id === "s-04" ? { ...d, result: RES, profit: 0 } : d)
    .concat([fx("s-05", "2026-01-14T22:59:00-05:00", { prev: "s-04" })]);
  const corrente = depois[depois.length - 1];
  assert.equal(corrente.id, "s-05");
  assert.equal(resolvedFx(corrente), false);
  assert.equal(depois.filter((d) => !resolvedFx(d)).length, 1, "deveria haver exatamente um por sortear");
});

test("o seletor distingue histórico de próximo também no cenário sintético", () => {
  const labels = cenario.map((d) => realDrawSelectorLabel(d, d));
  assert.equal(new Set(labels).size, labels.length, "rótulos sintéticos colidiram");
  const proximos = labels.filter((l) => / · próximo$/.test(l));
  assert.equal(proximos.length, 1, `esperava exatamente um marcado como próximo, veio ${proximos.length}`);
  assert.ok(/ · próximo$/.test(realDrawSelectorLabel(cenario[3], cenario[3])),
    "o marcado como próximo não é o sorteio sem resultado");
});

test("estado legítimo: TODOS realizados e nenhum próximo aberto ainda", () => {
  // Entre um sorteio e a abertura do seguinte, não existe "próximo". Isso não é erro, e o teste
  // não pode exigir que sempre haja um planejado.
  const todos = cenario.map((d) => resolvedFx(d) ? d : { ...d, result: RES, profit: 0 });
  assert.equal(todos.filter((d) => !resolvedFx(d)).length, 0);
  const labels = todos.map((d) => realDrawSelectorLabel(d, d));
  assert.equal(labels.filter((l) => / · próximo$/.test(l)).length, 0,
    "com todos realizados, nada pode estar marcado como próximo");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
