#!/usr/bin/env node
/**
 * COMBOBOX DO POWERBALL — exatamente UM indicador de seleção.
 *
 * POR QUE: o Eduardo relatou "double checkbox / duplicated check-selection indicator" no seletor
 * de sorteio. Eu **não consegui reproduzir um segundo ✓** — nem em Chromium nem em WebKit/iPhone,
 * local ou em produção: existe uma única fonte do marcador
 * (`.pb-select__option.is-selected::after`) e o CSS compartilhado não estiliza `aria-selected`.
 *
 * O que EXISTIA de verdade era outra coisa, e é plausível que seja o que ele viu: SELEÇÃO e
 * NAVEGAÇÃO usavam tratamentos que competiam. Ao abrir, a opção escolhida recebia `is-selected` E
 * `is-active` ao mesmo tempo; ao navegar com as setas, **duas linhas ficavam marcadas
 * simultaneamente** — uma com preenchimento, outra com verde + ✓. Duas marcações de estado ao
 * mesmo tempo leem como indicador de seleção duplicado.
 *
 * Agora: seleção = verde + ✓ (um indicador). Navegação = anel de foco, sem preenchimento que
 * compita. Esta suíte trava as duas coisas — a contagem de marcadores e a distinção entre os
 * estados — porque a próxima pessoa a mexer no CSS não vai saber dessa história.
 *
 * Roda em WebKit quando disponível (mesmo motor do Safari/iOS, que é onde foi relatado).
 *
 * Uso: node bolao/loterias/powerball/scripts/test_combo_visual.mjs
 */

import { startStaticServer } from "../../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8206;
const PATH = "/bolao/loterias/powerball/";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const pw = await import("playwright");
const server = await startStaticServer(PORT, ROOT);

// Conta QUALQUER coisa que pareça um marcador de seleção: ::before, ::after, ou um elemento
// dedicado. Contar só o ::after conhecido não pegaria um segundo marcador vindo de outro lugar —
// que é exatamente o defeito que este teste precisa ser capaz de enxergar.
const MARKER_PROBE = () => {
  const opts = [...document.querySelectorAll('#pbDrawListbox [role="option"]')];
  const isMark = (txt) => /[✓✔☑✅]/.test(txt || "");
  return opts.map(o => {
    const a = getComputedStyle(o, "::after").content;
    const b = getComputedStyle(o, "::before").content;
    const inner = [...o.querySelectorAll("*")].filter(el => isMark(el.textContent)).length;
    return {
      selected: o.getAttribute("aria-selected") === "true",
      active: o.classList.contains("is-active"),
      markers: (isMark(a) ? 1 : 0) + (isMark(b) ? 1 : 0) + inner + (isMark(o.childNodes.length === 1 ? "" : o.textContent) ? 0 : 0),
      bg: getComputedStyle(o).backgroundColor,
      outline: getComputedStyle(o).outlineStyle,
      color: getComputedStyle(o).color,
    };
  });
};

for (const engineName of ["chromium", "webkit"]) {
  const engine = pw[engineName];
  if (!engine) { console.log(`  (motor ${engineName} indisponível — pulando)`); continue; }
  let browser;
  try { browser = await engine.launch(); }
  catch { console.log(`  (motor ${engineName} não pôde iniciar — pulando)`); continue; }

  const open = async (viewport) => {
    const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}${PATH}`, { waitUntil: "load" });
    await page.waitForSelector("#pbDrawButton");
    await page.waitForTimeout(600);
    await page.click("#pbDrawButton");
    // O WebKit não deixa o foco no botão depois do clique como o Chromium deixa; sem foco
    // explícito o teclado não chega ao combobox e o teste falharia por artefato do motor,
    // não por defeito do produto.
    await page.evaluate(() => document.getElementById("pbDrawButton")?.focus());
    await page.waitForTimeout(400);
    return { ctx, page };
  };

  await test(`[${engineName}] a opção selecionada tem EXATAMENTE um marcador`, async () => {
    const { ctx, page } = await open({ width: 390, height: 844 });
    const opts = await page.evaluate(MARKER_PROBE);
    const sel = opts.filter(o => o.selected);
    eq(sel.length, 1, "número de opções marcadas como selecionadas");
    eq(sel[0].markers, 1,
      `a opção selecionada tem ${sel[0].markers} marcadores de seleção — era exatamente isto que ` +
      `o Eduardo descreveu como "double checkbox"`);
    await ctx.close();
  });

  await test(`[${engineName}] opções NÃO selecionadas não têm marcador nenhum`, async () => {
    const { ctx, page } = await open({ width: 390, height: 844 });
    const opts = await page.evaluate(MARKER_PROBE);
    const semMarca = opts.filter(o => !o.selected);
    assert(semMarca.length > 0, "fixture inútil: precisa de opção não selecionada");
    for (const o of semMarca) eq(o.markers, 0, "opção não selecionada exibindo marcador");
    await ctx.close();
  });

  await test(`[${engineName}] SELEÇÃO e NAVEGAÇÃO são visualmente distintas`, async () => {
    const { ctx, page } = await open({ width: 390, height: 844 });
    // Navega para uma opção que NÃO é a selecionada.
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
    const opts = await page.evaluate(MARKER_PROBE);
    const sel = opts.find(o => o.selected);
    const act = opts.find(o => o.active && !o.selected);
    assert(act, "não consegui mover a navegação para fora da opção selecionada");
    // Só a selecionada carrega marcador; a navegada usa anel, não marcador.
    eq(sel.markers, 1, "a selecionada perdeu ou ganhou marcador ao navegar");
    eq(act.markers, 0,
      "a opção só NAVEGADA está exibindo marcador de seleção — duas linhas marcadas ao mesmo " +
      "tempo é o que lê como indicador duplicado");
    assert(act.outline !== "none", "a navegação não tem indicação visível própria");
    await ctx.close();
  });

  await test(`[${engineName}] trocar de sorteio move o marcador, não acumula`, async () => {
    const { ctx, page } = await open({ width: 390, height: 844 });
    await page.click("#pbDrawOpt-0");
    await page.waitForTimeout(400);
    await page.click("#pbDrawButton");
    await page.waitForTimeout(400);
    const opts = await page.evaluate(MARKER_PROBE);
    eq(opts.filter(o => o.markers > 0).length, 1, "sobrou marcador na opção antiga");
    eq(opts.filter(o => o.selected).length, 1, "mais de uma opção marcada como selecionada");
    await ctx.close();
  });

  await browser.close();
}

server.stop();
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ COMBO VISUAL SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
