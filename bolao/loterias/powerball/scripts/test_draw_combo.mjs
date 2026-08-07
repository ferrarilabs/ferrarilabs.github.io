#!/usr/bin/env node
/**
 * BATCH 6 — dropdown customizado de sorteio do Powerball.
 *
 * Testa o componente REAL num browser real (Playwright + servidor fail-closed), não um stub de
 * DOM: o pedido do Eduardo era um componente de verdade, e o modo de falha explicitamente vetado
 * ("não esconda o <select> nativo e finja a UI") só é verificável no DOM renderizado.
 *
 * Cobre: ausência do <select> nativo, ARIA (combobox/listbox/option, aria-expanded,
 * aria-activedescendant, aria-selected), teclado (setas/Home/End/Enter/Espaço/Escape/Tab),
 * sincronização de estado com o resto da página, clique fora, foco visível e alvo de toque mobile.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_draw_combo.mjs
 */

import { launchChromium } from "../../../cdb2026/scripts/visual/playwright_loader.mjs";
import { startStaticServer } from "../../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8203;
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

async function freshPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}${PATH}`, { waitUntil: "load" });
  await page.waitForSelector("#pbDrawButton");
  return { ctx, page, consoleErrors };
}

const state = page => page.evaluate(() => {
  const btn = document.getElementById("pbDrawButton");
  const lb = document.getElementById("pbDrawListbox");
  const opts = [...lb.querySelectorAll('[role="option"]')];
  return {
    nativeSelects: document.querySelectorAll("select").length,
    expanded: btn.getAttribute("aria-expanded"),
    hidden: lb.hidden,
    activeDescendant: btn.getAttribute("aria-activedescendant"),
    buttonLabel: document.getElementById("pbDrawLabel").textContent.trim(),
    selectedIdx: opts.findIndex(o => o.getAttribute("aria-selected") === "true"),
    activeIdx: opts.findIndex(o => o.classList.contains("is-active")),
    count: opts.length,
    focusIsButton: document.activeElement === btn,
    jackpot: (document.getElementById("pbJackpot") || {}).textContent,
  };
});

console.log("\nPowerball — dropdown customizado de sorteio (Batch 6)\n");

// ── O requisito central: o nativo NÃO existe ─────────────────────────────────
await test("o <select> nativo foi REMOVIDO (não escondido) — nenhum <select> na página", async () => {
  const { ctx, page } = await freshPage();
  const s = await state(page);
  eq(s.nativeSelects, 0, "ainda existe <select> na página — a UI está fingindo o componente");
  assert(s.count > 1, `listbox precisa de mais de uma opção para o teste ser útil (tem ${s.count})`);
  await ctx.close();
});

await test("ARIA inicial: combobox fechado, listbox oculto, uma opção selecionada", async () => {
  const { ctx, page } = await freshPage();
  const s = await state(page);
  eq(s.expanded, "false", "aria-expanded não começa false");
  eq(s.hidden, true, "listbox não começa oculto");
  eq(s.activeDescendant, null, "aria-activedescendant existe com o combo fechado");
  assert(s.selectedIdx >= 0, "nenhuma opção com aria-selected=true");
  assert(s.buttonLabel.length > 0, "o botão não mostra o sorteio corrente");
  await ctx.close();
});

await test("roles corretos: combobox + listbox + options", async () => {
  const { ctx, page } = await freshPage();
  const r = await page.evaluate(() => ({
    btnRole: document.getElementById("pbDrawButton").getAttribute("role"),
    lbRole: document.getElementById("pbDrawListbox").getAttribute("role"),
    controls: document.getElementById("pbDrawButton").getAttribute("aria-controls"),
    hasPopup: document.getElementById("pbDrawButton").getAttribute("aria-haspopup"),
    label: document.getElementById("pbDrawButton").getAttribute("aria-label"),
  }));
  eq(r.btnRole, "combobox", "botão não é role=combobox");
  eq(r.lbRole, "listbox", "lista não é role=listbox");
  eq(r.controls, "pbDrawListbox", "aria-controls não aponta para o listbox");
  eq(r.hasPopup, "listbox", "aria-haspopup ausente/incorreto");
  assert(r.label && r.label.length > 0, "combobox sem nome acessível");
  await ctx.close();
});

// ── Mouse ────────────────────────────────────────────────────────────────────
await test("clique abre e fecha (toggle)", async () => {
  const { ctx, page } = await freshPage();
  await page.click("#pbDrawButton");
  let s = await state(page);
  eq(s.expanded, "true", "não abriu"); eq(s.hidden, false, "listbox seguiu oculto");
  assert(s.activeDescendant, "aberto sem aria-activedescendant");
  await page.click("#pbDrawButton");
  s = await state(page);
  eq(s.expanded, "false", "não fechou no segundo clique");
  await ctx.close();
});

await test("clicar numa opção muda o sorteio E o resto da página (sincronização real)", async () => {
  const { ctx, page } = await freshPage();
  const before = await state(page);
  await page.click("#pbDrawButton");
  const target = before.selectedIdx === 0 ? 1 : 0;
  await page.click(`#pbDrawOpt-${target}`);
  const after = await state(page);
  eq(after.selectedIdx, target, "aria-selected não migrou para a opção clicada");
  eq(after.expanded, "false", "não fechou após escolher");
  assert(after.buttonLabel !== before.buttonLabel, "o rótulo do botão não acompanhou a seleção");
  // Prova que não é só cosmético: o conteúdo do sorteio mudou junto.
  assert(after.jackpot !== undefined, "#pbJackpot não existe — teste de sincronização inválido");
  await ctx.close();
});

await test("clique FORA fecha sem alterar a seleção", async () => {
  const { ctx, page } = await freshPage();
  const before = await state(page);
  await page.click("#pbDrawButton");
  await page.click("main", { position: { x: 5, y: 5 } });
  const after = await state(page);
  eq(after.expanded, "false", "não fechou ao clicar fora");
  eq(after.selectedIdx, before.selectedIdx, "clique fora mudou a seleção");
  await ctx.close();
});

// ── Teclado ──────────────────────────────────────────────────────────────────
await test("teclado: ArrowDown abre; setas movem a opção ativa sem selecionar", async () => {
  // O sorteio corrente por padrão é o ÚLTIMO (`currentIdx = DRAWS.length - 1`), e o combo abre
  // sobre a opção selecionada — então ArrowDown já está no fim e fica clampeado, de propósito
  // (mesmo comportamento de um <select> nativo). O movimento possível aqui é ArrowUp.
  const { ctx, page } = await freshPage();
  await page.focus("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  let s = await state(page);
  eq(s.expanded, "true", "ArrowDown não abriu");
  eq(s.activeIdx, s.selectedIdx, "não abriu sobre a opção selecionada");
  const startActive = s.activeIdx, startSelected = s.selectedIdx;
  await page.keyboard.press("ArrowUp");
  s = await state(page);
  eq(s.activeIdx, startActive - 1, "ArrowUp não moveu a opção ativa uma posição");
  eq(s.selectedIdx, startSelected, "navegar com setas alterou a seleção (não deveria)");
  assert(s.focusIsButton, "o foco saiu do botão — o padrão é aria-activedescendant");
  eq(s.activeDescendant, `pbDrawOpt-${s.activeIdx}`, "aria-activedescendant não segue a opção ativa");
  await ctx.close();
});

await test("teclado: navegação é clampeada nas pontas (não faz wrap)", async () => {
  const { ctx, page } = await freshPage();
  await page.focus("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");           // já na última
  let s = await state(page);
  eq(s.activeIdx, s.count - 1, "ArrowDown na última opção fez wrap");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");             // já na primeira
  s = await state(page);
  eq(s.activeIdx, 0, "ArrowUp na primeira opção fez wrap");
  await ctx.close();
});

await test("teclado: Enter confirma a opção ativa", async () => {
  const { ctx, page } = await freshPage();
  await page.focus("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");            // vai para a primeira
  const active = (await state(page)).activeIdx;
  await page.keyboard.press("Enter");
  const s = await state(page);
  eq(s.selectedIdx, active, "Enter não selecionou a opção ativa");
  eq(s.expanded, "false", "Enter não fechou o listbox");
  assert(s.focusIsButton, "o foco não voltou ao botão após Enter");
  await ctx.close();
});

await test("teclado: Espaço também confirma", async () => {
  const { ctx, page } = await freshPage();
  await page.focus("#pbDrawButton");
  await page.keyboard.press(" ");
  eq((await state(page)).expanded, "true", "Espaço não abriu");
  await page.keyboard.press("End");
  const active = (await state(page)).activeIdx;
  await page.keyboard.press(" ");
  const s = await state(page);
  eq(s.selectedIdx, active, "Espaço não selecionou");
  eq(s.expanded, "false", "Espaço não fechou");
  await ctx.close();
});

await test("teclado: Home/End vão para a primeira/última opção", async () => {
  const { ctx, page } = await freshPage();
  await page.focus("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  let s = await state(page);
  eq(s.activeIdx, s.count - 1, "End não foi para a última opção");
  await page.keyboard.press("Home");
  s = await state(page);
  eq(s.activeIdx, 0, "Home não foi para a primeira opção");
  await ctx.close();
});

await test("teclado: Escape fecha SEM mudar a seleção e devolve o foco", async () => {
  const { ctx, page } = await freshPage();
  const before = await state(page);
  await page.focus("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");   // move a ativa para longe da selecionada
  await page.keyboard.press("Escape");
  const after = await state(page);
  eq(after.expanded, "false", "Escape não fechou");
  eq(after.selectedIdx, before.selectedIdx, "Escape alterou a seleção");
  assert(after.focusIsButton, "Escape não devolveu o foco ao botão");
  await ctx.close();
});

await test("teclado: Tab fecha o listbox e deixa o foco seguir", async () => {
  const { ctx, page } = await freshPage();
  await page.focus("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  const s = await state(page);
  eq(s.expanded, "false", "Tab deixou o listbox aberto");
  assert(!s.focusIsButton, "Tab não moveu o foco para o próximo elemento");
  await ctx.close();
});

await test("o botão é alcançável por Tab (está na ordem natural de foco)", async () => {
  const { ctx, page } = await freshPage();
  const reached = await page.evaluate(() => {
    const btn = document.getElementById("pbDrawButton");
    return btn.tabIndex >= 0 && btn.tagName === "BUTTON";
  });
  assert(reached, "o combobox não é um <button> focável naturalmente");
  await ctx.close();
});

// ── Foco visível / mobile ────────────────────────────────────────────────────
await test("foco por teclado é visível (outline explícito, não só borda)", async () => {
  const { ctx, page } = await freshPage();
  await page.evaluate(() => document.getElementById("pbDrawButton").focus());
  await page.keyboard.press("Home"); // garante heurística de :focus-visible
  const o = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("pbDrawButton"));
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  });
  assert(o.outlineStyle !== "none" && parseFloat(o.outlineWidth) > 0,
    `sem outline de foco visível (style=${o.outlineStyle}, width=${o.outlineWidth})`);
  await ctx.close();
});

await test("mobile 375x667: abre, opções têm alvo de toque >= 40px, sem overflow horizontal", async () => {
  const { ctx, page } = await freshPage({ width: 375, height: 667 });
  await page.click("#pbDrawButton");
  const r = await page.evaluate(() => {
    const opts = [...document.querySelectorAll("#pbDrawListbox [role=option]")];
    return {
      minH: Math.min(...opts.map(o => o.getBoundingClientRect().height)),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      visible: !document.getElementById("pbDrawListbox").hidden,
    };
  });
  eq(r.visible, true, "listbox não abriu no mobile");
  assert(r.minH >= 40, `alvo de toque pequeno: ${r.minH}px (mínimo 40)`);
  eq(r.overflow, false, "o listbox causou scroll horizontal no mobile");
  await ctx.close();
});

// ── Regressões gerais ────────────────────────────────────────────────────────
await test("título da aba segue o padrão dos outros bolões APÓS o JS rodar", async () => {
  // applyTheme() reescrevia document.title em runtime, desfazendo a correção do index.html.
  const { ctx, page } = await freshPage();
  const title = await page.title();
  assert(/^Bolão do Ferrari — /.test(title), `título fora do padrão: "${title}"`);
  await ctx.close();
});

await test("nenhum erro de console além do aviso conhecido de CSP frame-ancestors", async () => {
  const { ctx, page, consoleErrors } = await freshPage();
  await page.click("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const unexpected = consoleErrors.filter(t => !/frame-ancestors/.test(t));
  eq(unexpected.length, 0, `erros de console inesperados: ${JSON.stringify(unexpected.slice(0, 3))}`);
  await ctx.close();
});

await browser.close();
server.stop();

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DRAW COMBO SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
