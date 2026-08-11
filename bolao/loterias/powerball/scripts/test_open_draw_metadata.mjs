#!/usr/bin/env node
/**
 * POWERBALL — o sorteio ABERTO tem de mostrar informação real, não estado de "não inicializado".
 *
 * O DEFEITO QUE ISTO FECHA (2026-08-11)
 * ------------------------------------
 * O sorteio de 12/08 foi aberto com `jackpot: null`, porque a loteria só anuncia o prêmio depois
 * do sorteio anterior. Isso é correto no minuto zero. Mas o valor oficial passou a existir, e
 * nada o copiava — então a página pública ficou anunciando "a anunciar" com o dado disponível o
 * tempo todo. Um bolão aberto que parece indefinido é um defeito de produto, não um estado.
 *
 * A regra que este gate trava: se o sorteio ABERTO tem jackpot verificado no estado canônico, a
 * UI NÃO pode cair no texto de espera. E se o jackpot existe, ele tem de vir com procedência —
 * um número de dinheiro sem origem é indistinguível de um número inventado.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_open_draw_metadata.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const DATA_JS = join(ROOT, "bolao/loterias/powerball/js/data.js");
const APP_JS = join(ROOT, "bolao/loterias/powerball/js/app.js");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(readFileSync(DATA_JS, "utf8"), sandbox);
const DRAWS = sandbox.window.POWERBALL_DRAWS;
const app = readFileSync(APP_JS, "utf8");
// Só CÓDIGO. A primeira versão deste gate procurava o literal no arquivo inteiro e acusava o
// próprio comentário que explica por que o literal foi removido — um gate que reprova a sua
// própria documentação.
const appCode = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const abertos = DRAWS.filter((d) => !(d.result && d.result.numbers));

console.log("\nPowerball — metadados do sorteio aberto\n");

test("existe no máximo UM sorteio aberto por vez", () => {
  assert(abertos.length <= 1,
    `${abertos.length} sorteios abertos (${abertos.map((d) => d.id).join(", ")}) — a página " +
     "inicial mostra o último da lista, então dois abertos escondem um deles`);
});

test("o sorteio ABERTO tem jackpot oficial (não fica em estado de espera)", () => {
  if (abertos.length === 0) return;                 // sem sorteio aberto não há o que exigir
  const d = abertos[0];
  assert(typeof d.drawing.jackpot === "number" && d.drawing.jackpot > 0,
    `sorteio aberto ${d.id} está sem jackpot — a página pública cai no texto de espera ` +
    `enquanto o valor oficial existe. Rode refresh_jackpot.py --apply`);
});

test("o jackpot do sorteio aberto tem PROCEDÊNCIA", () => {
  if (abertos.length === 0) return;
  const d = abertos[0];
  if (typeof d.drawing.jackpot !== "number") return;  // já reprovado acima
  assert(d.drawing.jackpotSource, `${d.id}: jackpot sem jackpotSource`);
  assert(d.drawing.jackpotFetchedAt, `${d.id}: jackpot sem jackpotFetchedAt`);
  assert(d.drawing.jackpotDrawId === d.id,
    `${d.id}: jackpotDrawId é "${d.drawing.jackpotDrawId}" — o valor foi copiado de OUTRO sorteio`);
});

test("nenhum sorteio herdou o jackpot de outro", () => {
  for (const d of DRAWS) {
    if (!d.drawing.jackpotDrawId) continue;
    assert(d.drawing.jackpotDrawId === d.id,
      `${d.id} carrega jackpot cuja procedência aponta para ${d.drawing.jackpotDrawId}`);
  }
});

test("a UI não exibe mais o texto que descrevia o sorteio como indefinido", () => {
  assert(!/["']a anunciar["']/.test(appCode),
    'voltou o literal "a anunciar" — ele descreve o SORTEIO como indefinido, quando o que falta ' +
    "é apenas uma leitura do prêmio");
});

test("o texto de espera fala do DADO, não do evento", () => {
  assert(/Atualizando jackpot/.test(appCode),
    "sumiu o estado transitório de atualização — sem ele, um jackpot ausente volta a parecer " +
    "um sorteio inexistente");
});

test("o render do jackpot passa pelo helper (não formata o campo cru)", () => {
  // Formatar `draw.drawing.jackpot` direto é o que produzia "$NaN" com jackpot ausente.
  // Duas tentativas de recortar a função falharam: a janela de 1500 chars não alcançava a
  // chamada, e `indexOf("function renderDraw")` casa antes com outra função de nome parecido.
  // Recortar por posição é frágil por natureza. A asserção real é sobre UMA linha — o elemento
  // que recebe o valor — então é essa linha que o gate verifica, sem recorte nenhum.
  assert(/getElementById\("pbJackpot"\)\.textContent = fmtJackpot\(draw\)/.test(appCode),
    "renderDraw voltou a formatar o jackpot cru — com valor ausente isso imprime $NaN");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ OPEN DRAW METADATA PASSED\n" : "✗ OPEN DRAW METADATA FAILED\n");
process.exit(fail === 0 ? 0 : 1);
