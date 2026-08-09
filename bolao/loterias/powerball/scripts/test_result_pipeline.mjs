#!/usr/bin/env node
/**
 * POWERBALL — pipeline de resultado: buscar, calcular prêmio, gravar, destacar.
 *
 * O QUE ISTO IMPEDE (quatro sintomas relatados pelo Eduardo em 2026-08-09, depois do sorteio de
 * 08/08: "funcionou para puxar o resultado mas não marcou os bilhetes venceram em negrito, não
 * mudou o drop down e não disparou o email com o resultado do sorteio e os ganhos"):
 *
 *   1. A URL da API ia com um ESPAÇO cru ("$order=draw_date DESC"). O urllib recusava antes de
 *      qualquer rede, o erro era engolido por um `except` e o script terminava com exit 0 — o
 *      workflow ficava VERDE tendo falhado em TODA execução. (O navegador funcionava porque o
 *      `fetch()` dele codifica o espaço sozinho: por isso a página mostrava o resultado e o cron
 *      não.)
 *   2. O parser do `data.js` usava `json.loads` num arquivo que é JavaScript de verdade — chaves
 *      sem aspas, comentários, vírgulas finais. NUNCA conseguiu ler. Segundo exit 0 silencioso.
 *   3. `premiosGanhos: 0` era gravado como placeholder "para o script de email preencher". Mas o
 *      site LÊ esse campo e o exibe: com 0 ele afirma "Nenhum prêmio nesse sorteio". No sorteio de
 *      08/08 dois bilhetes acertaram o Powerball ($24) — o site teria mentido sobre dinheiro.
 *   4. Não havia NENHUM destaque de acerto no bilhete. Não é regressão: nunca existiu.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_result_pipeline.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const DATA_JS = join(ROOT, "bolao/loterias/powerball/js/data.js");
const APP_JS = join(ROOT, "bolao/loterias/powerball/js/app.js");
const FETCHER = join(ROOT, "bolao/loterias/powerball/scripts/fetch_and_send_results.py");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(DATA_JS, "utf8"), sandbox);
const DRAWS = sandbox.window.POWERBALL_DRAWS;
const GT = sandbox.window.LOTTERY_GAME_TYPES;
const py = readFileSync(FETCHER, "utf8");
const app = readFileSync(APP_JS, "utf8");

console.log("\nPowerball — pipeline de resultado do sorteio\n");

// ── 1. Os bugs que faziam o cron falhar em silêncio ─────────────────────────
test("a query da API é CODIFICADA (o espaço cru quebrava toda execução)", () => {
  assert(/urlencode\(/.test(py), "a URL voltou a ser montada por f-string sem encoding");
  assert(!/\?\$order=draw_date DESC/.test(py),
    "ainda existe a URL com espaço cru — o urllib recusa antes de qualquer rede");
});

test("o data.js é lido por um runtime JS, não por json.loads", () => {
  assert(/node/.test(py) && /runInContext|vm/.test(py),
    "o parser voltou a tentar json.loads num arquivo que é JavaScript (chaves sem aspas, " +
    "comentários, vírgulas finais) — isso nunca conseguiu ler nada");
});

test("a escrita no data.js é CIRÚRGICA (não reescreve o array inteiro)", () => {
  assert(/write_result_into_data_js/.test(py), "a função de escrita cirúrgica sumiu");
  assert(!/json\.dumps\(draws, indent=2\)/.test(py),
    "voltou a reescrever POWERBALL_DRAWS inteiro com json.dumps — isso apaga os comentários do " +
    "arquivo (vários explicando decisões de dinheiro) e toda a formatação");
});

test("a escrita se RECUSA quando a âncora é ambígua", () => {
  assert(/recusando escrever/.test(py),
    "sumiu o guard que impede escrever no sorteio errado — num arquivo de dinheiro, recusar é " +
    "melhor que escrever no escuro");
});

// ── 2. Prêmio calculado, nunca placeholder ─────────────────────────────────
test("o prêmio é CALCULADO antes de gravar, não deixado como 0", () => {
  assert(/compute_prize_via_node/.test(py), "sumiu o cálculo de prêmio");
  assert(!/"premiosGanhos": 0,\s*#/.test(py),
    "voltou a gravar premiosGanhos: 0 como placeholder — o site LÊ esse campo e afirma " +
    '"Nenhum prêmio nesse sorteio", que é uma declaração FALSA sobre dinheiro');
});

test("o cálculo reusa a prizeTable do data.js (regra de prêmio em UM lugar só)", () => {
  assert(/prizeTable\(/.test(py),
    "o prêmio voltou a ser calculado por uma tabela própria em Python — duas cópias da regra de " +
    "prêmio é a divergência que já mordeu o repo (CHANGELOG v4.57 da Copa)");
});

// ── 3. O caso real do sorteio de 08/08 ─────────────────────────────────────
test("REAL 08/08: dois bilhetes acertam só o Powerball e valem $12 cada", () => {
  const official = { numbers: [5, 9, 35, 54, 63], special: 7, multiplier: 3 };
  const draw = DRAWS.find(d => d.id === "2026-08-08");
  assert(draw, "sorteio de 2026-08-08 sumiu do data.js");
  const gt = GT[draw.gameType];
  let total = 0; const labels = {};
  (draw.sharedTickets?.series || []).forEach(s => (s.numeros || []).forEach(str => {
    const m = String(str).match(/^([\d\s-]+?)\s*—\s*(?:PB|MB)\s*(\d+)$/);
    if (!m) return;
    const nums = m[1].trim().split(/[\s-]+/).map(Number);
    const main = nums.filter(n => official.numbers.includes(n)).length;
    const sp = Number(m[2]) === official.special;
    const r = gt.prizeTable(main, sp, official.multiplier);
    if (r && r.amount) { total += r.amount; labels[r.label] = (labels[r.label] || 0) + 1; }
  }));
  eq(total, 24, "o total premiado do sorteio de 08/08 mudou");
  eq(labels["Powerball"], 2, "número de bilhetes que acertaram só o Powerball mudou");
});

test("REAL 08/08: o resultado gravado no data.js bate com o cálculo", () => {
  const draw = DRAWS.find(d => d.id === "2026-08-08");
  const r = draw.result;
  assert(r && r.numbers, "o sorteio de 08/08 está sem resultado gravado");
  eq(JSON.stringify(r.numbers), JSON.stringify([5, 9, 35, 54, 63]), "números errados");
  eq(r.special, 7, "Powerball errado");
  eq(r.premiosGanhos, 24, "premiosGanhos gravado não bate com o cálculo real");
  assert(!r.jackpotHit, "jackpotHit deveria ser falso");
});

// ── 4. Destaque de acerto e rótulo do dropdown ─────────────────────────────
test("o site destaca os números acertados no bilhete", () => {
  assert(/highlightTicketNumbers/.test(app), "a função de destaque sumiu");
  assert(/pb-hit/.test(app), "a classe de acerto sumiu do render");
  const css = readFileSync(join(ROOT, "bolao/loterias/powerball/css/styles.css"), "utf8");
  assert(/\.pb-hit\b/.test(css), "a classe .pb-hit não tem estilo — o destaque não apareceria");
});

test("o destaque só acontece quando existe resultado oficial", () => {
  const fn = app.slice(app.indexOf("function highlightTicketNumbers"));
  assert(/if \(!result \|\| !result\.numbers/.test(fn),
    "o destaque não checa mais se há resultado — marcaria acerto antes do sorteio");
});

test("o rótulo do dropdown mostra o resultado quando ele existe", () => {
  const fn = app.slice(app.indexOf("function drawSelectorLabel"), app.indexOf("function drawSelectorLabel") + 700);
  assert(/Resultado:/.test(fn), "o rótulo do dropdown não mostra mais o resultado");
  assert(/hasResult/.test(fn), "o rótulo não distingue mais sorteio com e sem resultado");
});

// ── 5. FONTE ÚNICA — o envio errado de 2026-08-09 ──────────────────────────
test("send_result_email.py lê os sorteios do data.js, não de uma cópia própria", () => {
  const py2 = readFileSync(join(ROOT, "bolao/loterias/powerball/scripts/send_result_email.py"), "utf8");
  assert(/_load_draws_from_data_js/.test(py2),
    "o script voltou a manter a própria lista de sorteios");
  assert(!/^DRAWS = \{\s*$[\s\S]{200,}"drawDateIso"/m.test(py2),
    "há de novo uma cópia hardcoded de sorteios no send_result_email.py — foi assim que 15 " +
    "participantes receberam o resultado do sorteio ANTERIOR em 2026-08-09");
});

test("REGRESSÃO 2026-08-09: o sorteio ativo é o mais recente COM resultado do data.js", () => {
  // O envio errado aconteceu porque a cópia hardcoded parava em 05/08: `get_active_draw()`
  // devolvia 05/08 e mandava o resultado anterior, para a lista de participantes anterior.
  const resolved = DRAWS.filter(d => d.result && d.result.numbers);
  const active = resolved[resolved.length - 1];
  eq(active.id, "2026-08-08",
    "o sorteio ativo deixou de ser o mais recente com resultado — é este o cálculo que o " +
    "send_result_email.py faz para escolher o que enviar e para quem");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ POWERBALL RESULT PIPELINE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
