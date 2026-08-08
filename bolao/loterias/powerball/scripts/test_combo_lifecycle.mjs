#!/usr/bin/env node
/**
 * BATCH 9 — ciclo de vida de listeners do combobox de sorteio do Powerball.
 *
 * `test_draw_combo.mjs` (Batch 6) já cobre o COMPORTAMENTO do componente: ARIA, teclado,
 * sincronização, clique fora, foco visível, alvo de toque. O que ele NÃO cobre — e é o que esta
 * suíte adiciona — é o que acontece ao componente ao longo do TEMPO, com uso repetido:
 *
 *   - listener de `document` registrado mais de uma vez (vazamento clássico deste padrão)
 *   - handler de teclado duplicado (uma tecla executando a ação duas vezes)
 *   - clique fora fechando "duas vezes" (dois listeners concorrentes)
 *   - Escape mutando a seleção depois de N ciclos
 *   - foco não voltando ao botão depois de N ciclos
 *   - rótulo do botão dessincronizando do estado real depois de N trocas de sorteio
 *
 * POR QUE ISSO IMPORTA AQUI ESPECIFICAMENTE: `buildDrawCombo()` monta o componente com
 * `root.innerHTML = ...`, o que descarta os nós antigos — e com eles os listeners de botão/listbox.
 * Mas o listener de clique-fora vive em `document`, que NÃO é descartado. Se `buildDrawCombo()` for
 * chamado de novo (hoje não é, mas o próprio código diz "pode, em teoria"), cada chamada empilharia
 * mais um listener de `document` para sempre. A guarda `docClickWired` existe exatamente para isso.
 * Esta suíte é o que impede essa guarda de ser removida sem alguém perceber.
 *
 * MÉTODO: `EventTarget.prototype.addEventListener` é instrumentado via `addInitScript`, ou seja
 * ANTES de `app.js` rodar — então a contagem inclui o registro real da aplicação, não só o que
 * acontece depois que a página já carregou.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_combo_lifecycle.mjs
 */

import { launchChromium } from "../../../cdb2026/scripts/visual/playwright_loader.mjs";
import { startStaticServer } from "../../../scripts/static_server.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const APP_JS = join(HERE, "..", "js", "app.js");
const PORT = 8204;                       // distinto do 8203 de test_draw_combo.mjs
const PATH = "/bolao/loterias/powerball/";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const server = await startStaticServer(PORT, ROOT);
const browser = await launchChromium();

// Página com contagem de listeners instrumentada ANTES do app rodar.
async function freshPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    window.__listenerLog = [];
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      let target = "other";
      if (this === document) target = "document";
      else if (this === window) target = "window";
      else if (this && this.id) target = "#" + this.id;
      window.__listenerLog.push(target + ":" + type);
      return orig.call(this, type, fn, opts);
    };
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}${PATH}`, { waitUntil: "load" });
  await page.waitForSelector("#pbDrawButton");
  return { ctx, page, consoleErrors };
}

const counts = page => page.evaluate(() => {
  const log = window.__listenerLog || [];
  const tally = {};
  for (const k of log) tally[k] = (tally[k] || 0) + 1;
  return tally;
});

const snapshot = page => page.evaluate(() => {
  const btn = document.getElementById("pbDrawButton");
  const lb = document.getElementById("pbDrawListbox");
  const opts = [...lb.querySelectorAll('[role="option"]')];
  return {
    expanded: btn.getAttribute("aria-expanded"),
    hidden: lb.hidden,
    selectedIdx: opts.findIndex(o => o.getAttribute("aria-selected") === "true"),
    label: document.getElementById("pbDrawLabel").textContent.trim(),
    focusIsButton: document.activeElement === btn,
    jackpot: (document.getElementById("pbJackpot") || {}).textContent,
    optionCount: opts.length,
  };
});

console.log("\nPowerball — ciclo de vida de listeners do combobox (Batch 9)\n");

// ── 1. O vazamento clássico: um único listener de document ───────────────────
await test("EXATAMENTE UM listener de clique em `document` depois da carga completa", async () => {
  const { ctx, page } = await freshPage();
  const t = await counts(page);
  eq(t["document:click"] || 0, 1, "número errado de listeners de clique em document");
  await ctx.close();
});

await test("uso intenso NÃO acumula listener nenhum (document/window)", async () => {
  const { ctx, page } = await freshPage();
  const before = await counts(page);
  const n = (await snapshot(page)).optionCount;
  // 12 ciclos completos de abrir/navegar/selecionar/fechar por fora e por Escape.
  for (let i = 0; i < 12; i++) {
    await page.click("#pbDrawButton");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press(i % 2 ? "Escape" : "Enter");
    await page.click("body", { position: { x: 5, y: 5 } });
  }
  const after = await counts(page);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!key.startsWith("document:") && !key.startsWith("window:")) continue;
    eq(after[key] || 0, before[key] || 0, `listener acumulou em "${key}" depois de 12 ciclos`);
  }
  assert(n > 1, "fixture inútil: o listbox precisa de mais de uma opção");
  await ctx.close();
});

// ── 2. Clique fora fecha UMA vez só ──────────────────────────────────────────
await test("clique FORA fecha exatamente uma vez (sem handler duplicado)", async () => {
  const { ctx, page } = await freshPage();
  // Um segundo listener registrado por engano se manifestaria como transição dupla; conta as
  // mudanças reais de aria-expanded via MutationObserver, que vê CADA escrita, não só o valor final.
  await page.evaluate(() => {
    window.__expandedWrites = 0;
    const btn = document.getElementById("pbDrawButton");
    new MutationObserver(muts => { for (const m of muts) if (m.attributeName === "aria-expanded") window.__expandedWrites++; })
      .observe(btn, { attributes: true, attributeFilter: ["aria-expanded"] });
  });
  await page.click("#pbDrawButton");                     // abre  -> 1 escrita
  await page.click("body", { position: { x: 5, y: 5 } }); // fecha -> 1 escrita
  const writes = await page.evaluate(() => window.__expandedWrites);
  eq(writes, 2, "aria-expanded foi escrito mais vezes que o esperado — handler duplicado?");
  eq((await snapshot(page)).expanded, "false", "não fechou no clique de fora");
  await ctx.close();
});

// ── 3. Teclado não duplica ───────────────────────────────────────────────────
await test("uma tecla = uma ação (setas movem exatamente uma posição)", async () => {
  const { ctx, page } = await freshPage();
  const activeIdx = () => page.evaluate(() => {
    const lb = document.getElementById("pbDrawListbox");
    return [...lb.querySelectorAll('[role="option"]')].findIndex(o => o.classList.contains("is-active"));
  });
  await page.click("#pbDrawButton");
  // Parte do INÍCIO da lista de propósito: o sorteio selecionado costuma ser o último, e ali
  // ArrowDown é corretamente CLAMPEADO (sem wrap, ver test_draw_combo.mjs) — medir a partir da
  // ponta confundiria "handler duplicado" com "clamp funcionando".
  await page.keyboard.press("Home");
  const start = await activeIdx();
  eq(start, 0, "Home não levou para a primeira opção");
  await page.keyboard.press("ArrowDown");
  eq(await activeIdx(), 1, "ArrowDown moveu ≠ 1 posição — keydown registrado duas vezes?");
  await page.keyboard.press("ArrowDown");
  eq(await activeIdx(), 2, "segundo ArrowDown moveu ≠ 1 posição");
  await page.keyboard.press("ArrowUp");
  eq(await activeIdx(), 1, "ArrowUp moveu ≠ 1 posição");
  await ctx.close();
});

// ── 4. Escape nunca muta a seleção, por mais que se repita ───────────────────
await test("Escape NUNCA muda a seleção, mesmo após 10 repetições", async () => {
  const { ctx, page } = await freshPage();
  const before = await snapshot(page);
  for (let i = 0; i < 10; i++) {
    await page.click("#pbDrawButton");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
  }
  const after = await snapshot(page);
  eq(after.selectedIdx, before.selectedIdx, "Escape mudou o sorteio selecionado");
  eq(after.label, before.label, "Escape mudou o rótulo do botão");
  eq(after.jackpot, before.jackpot, "Escape mudou o conteúdo da página");
  await ctx.close();
});

// ── 5. Foco volta ao botão, sempre ───────────────────────────────────────────
await test("foco volta ao botão depois de Escape e depois de selecionar, repetidamente", async () => {
  const { ctx, page } = await freshPage();
  for (let i = 0; i < 6; i++) {
    await page.click("#pbDrawButton");
    await page.keyboard.press("Escape");
    assert((await snapshot(page)).focusIsButton, `foco perdido depois de Escape (ciclo ${i})`);
    await page.click("#pbDrawButton");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert((await snapshot(page)).focusIsButton, `foco perdido depois de selecionar (ciclo ${i})`);
  }
  await ctx.close();
});

// ── 6. Seleção continua sincronizada com a página ────────────────────────────
await test("rótulo, aria-selected e conteúdo da página continuam sincronizados após N trocas", async () => {
  const { ctx, page } = await freshPage();
  const n = (await snapshot(page)).optionCount;
  for (let i = 0; i < n; i++) {
    await page.click("#pbDrawButton");
    await page.click(`#pbDrawOpt-${i}`);
    const s = await snapshot(page);
    eq(s.selectedIdx, i, `aria-selected fora de sincronia na opção ${i}`);
    const optText = await page.textContent(`#pbDrawOpt-${i}`);
    eq(s.label, optText.trim(), `rótulo do botão não bate com a opção ${i}`);
    eq(s.expanded, "false", `listbox continuou aberto depois de escolher a opção ${i}`);
  }
  await ctx.close();
});

// ── 7. Contrato de código: a guarda do vazamento não pode sumir ──────────────
await test("CONTRATO: a guarda `docClickWired` continua existindo no código", async () => {
  const src = readFileSync(APP_JS, "utf8");
  assert(/docClickWired/.test(src), "a guarda docClickWired desapareceu — o listener de document volta a vazar");
  const wire = src.slice(src.indexOf("function wireDrawCombo"), src.indexOf("function renderDrawSelector"));
  assert(/if\s*\(docClickWired\)\s*return;/.test(wire), "a guarda existe mas não protege mais o registro");
  assert(/document\.addEventListener/.test(wire), "o listener de document saiu de wireDrawCombo — revalidar esta suíte");
  // Só UM addEventListener de document no arquivo inteiro (o DOMContentLoaded do bootstrap é o outro).
  const docListeners = (src.match(/document\.addEventListener/g) || []).length;
  assert(docListeners <= 2, `document.addEventListener aparece ${docListeners}x — cada um precisa de guarda própria`);
});

// ── 8. Nenhum erro novo no console durante todo o exercício ──────────────────
await test("nenhum erro de console além do aviso conhecido de CSP frame-ancestors", async () => {
  const { ctx, page, consoleErrors } = await freshPage();
  for (let i = 0; i < 5; i++) {
    await page.click("#pbDrawButton");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  const unexpected = consoleErrors.filter(e => !/frame-ancestors/i.test(e));
  eq(unexpected.length, 0, `erros inesperados: ${unexpected.join(" | ")}`);
  await ctx.close();
});

await browser.close();
server.stop();   // `startStaticServer` devolve { proc, stop, baseUrl } — não um http.Server.

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ COMBO LIFECYCLE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
