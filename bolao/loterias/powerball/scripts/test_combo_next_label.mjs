#!/usr/bin/env node
/**
 * POWERBALL — o sufixo "· próximo" do seletor de sorteio é ESTÁVEL.
 *
 * O DEFEITO
 * ---------
 * Relatado como: o sufixo "· próximo" some depois de Escape, na janela entre a hora do sorteio e a
 * gravação do resultado. Observado uma vez em 2026-08-11 (`test_combo_lifecycle`, medido com o
 * sorteio de 10/08 ainda sem resultado) e depois não reproduzível — porque o resultado chegou.
 *
 * O QUE A INVESTIGAÇÃO ACHOU
 * --------------------------
 * `drawSelectorLabel(d, getEffectiveDraw(d))` é PURA e é usada nos TRÊS pontos de render (build da
 * lista, refresh das opções, sync do botão). O rótulo só pode mudar se `getEffectiveDraw()` mudar
 * — e ele lê `localStorage["powerball_local_results_v1"]`. Ou seja: o rótulo mudou porque um
 * RESULTADO chegou durante o teste, não porque Escape mexeu em alguma coisa.
 *
 * O gate original não fixava esse armazenamento, então media um alvo que se movia sozinho.
 *
 * Este arquivo prende a variável: com o estado local CONTROLADO, o rótulo tem de ser idêntico
 * antes e depois de Escape — nas três fases do ciclo de vida, teclado e mouse, desktop e mobile.
 *
 * Uso: node bolao/loterias/powerball/scripts/test_combo_next_label.mjs
 */

import pw from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStaticServer } from "../../../scripts/static_server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const PORT = 8241;
const LOCAL_KEY = "powerball_local_results_v1";
const SUFIXO = "· próximo";

let pass = 0, fail = 0;
const test = async (n, f) => { try { await f(); console.log(`  ✓ ${n}`); pass++; }
                               catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };

const server = await startStaticServer(PORT, ROOT);
const browser = await pw.chromium.launch();

/**
 * Abre a página com o armazenamento local de resultados FIXADO.
 * `overrides` é o conteúdo exato de `powerball_local_results_v1`.
 */
async function abrir(overrides, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await ctx.newPage();
  // Nada de rede externa: uma consulta que devolvesse resultado no meio do teste voltaria a
  // mover o alvo, que é exatamente o defeito de medição que este arquivo existe para eliminar.
  await ctx.route("**://data.ny.gov/**", (r) => r.abort());
  await ctx.route("**://*.supabase.co/**", (r) => r.abort());
  await page.addInitScript(([k, v]) => {
    localStorage.setItem(k, JSON.stringify(v));
  }, [LOCAL_KEY, overrides]);
  await page.goto(`http://localhost:${PORT}/bolao/loterias/powerball/`, { waitUntil: "load" });
  await page.waitForSelector("#pbDrawButton", { timeout: 8000 });
  await page.waitForFunction(() => {
    const b = document.getElementById("pbDrawButton");
    return b && (b.textContent || "").trim().length > 0;
  }, { timeout: 8000 });
  return { ctx, page };
}

const rotulo = (page) => page.evaluate(() =>
  (document.getElementById("pbDrawButton")?.textContent || "").trim());

/** Lê os sorteios reais do data.js servido, para escolher alvos verdadeiros. */
async function draws() {
  const { ctx, page } = await abrir({});
  const ds = await page.evaluate(() => (window.POWERBALL_DRAWS || []).map((d) => ({
    id: d.id, temResultado: !!(d.result && d.result.numbers),
  })));
  await ctx.close();
  return ds;
}

const DS = await draws();
const ABERTO = DS.filter((d) => !d.temResultado).slice(-1)[0];
const RESOLVIDO = DS.filter((d) => d.temResultado).slice(-1)[0];

console.log("\nPowerball — estabilidade do sufixo \"· próximo\"\n");

await test("premissa: existe um sorteio ABERTO e um RESOLVIDO no data.js", () => {
  assert(ABERTO, "nenhum sorteio sem resultado — o sufixo não teria onde aparecer");
  assert(RESOLVIDO, "nenhum sorteio com resultado — não haveria contraste para testar");
});

// ── O sufixo aparece exatamente quando deve ─────────────────────────────────────────────────
await test("sorteio SEM resultado mostra o sufixo; com resultado, não mostra", async () => {
  const { ctx, page } = await abrir({});
  const r = await rotulo(page);
  assert(r.includes(SUFIXO), `o sorteio aberto (${ABERTO.id}) não mostra "${SUFIXO}": "${r}"`);

  // Mesmo sorteio, agora COM resultado local: o sufixo tem de sumir — é a informação correta.
  await ctx.close();
  const comResultado = { [ABERTO.id]: { result: { numbers: [1, 2, 3, 4, 5], special: 6, multiplier: 1 } } };
  const b = await abrir(comResultado);
  const r2 = await rotulo(b.page);
  assert(!r2.includes(SUFIXO),
    `o sufixo permaneceu num sorteio que já tem resultado: "${r2}"`);
  await b.ctx.close();
});

// ── ESTABILIDADE: o que o defeito relatado afirma ───────────────────────────────────────────
for (const [rot, viewport] of [["desktop", { width: 1280, height: 900 }],
                               ["mobile", { width: 390, height: 844 }]]) {
  for (const [fase, overrides] of [
    ["sem resultado (pré/pós-sorteio)", {}],
    ["com resultado", { [ABERTO.id]: { result: { numbers: [1, 2, 3, 4, 5], special: 6, multiplier: 1 } } }],
  ]) {
    await test(`[${rot}] ${fase}: Escape pelo TECLADO não altera o rótulo (10x)`, async () => {
      const { ctx, page } = await abrir(overrides, viewport);
      const antes = await rotulo(page);
      for (let i = 0; i < 10; i++) {
        await page.click("#pbDrawButton");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("Escape");
      }
      eq(await rotulo(page), antes, "Escape alterou o rótulo do botão");
      await ctx.close();
    });

    await test(`[${rot}] ${fase}: fechar com o MOUSE não altera o rótulo (10x)`, async () => {
      const { ctx, page } = await abrir(overrides, viewport);
      const antes = await rotulo(page);
      for (let i = 0; i < 10; i++) {
        await page.click("#pbDrawButton");
        await page.mouse.click(5, 5);            // clique fora fecha a lista
      }
      eq(await rotulo(page), antes, "fechar com o mouse alterou o rótulo do botão");
      await ctx.close();
    });
  }
}

await test("trocar de sorteio e voltar restaura EXATAMENTE o rótulo original", async () => {
  const { ctx, page } = await abrir({});
  const antes = await rotulo(page);
  await page.click("#pbDrawButton");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");            // seleciona o anterior
  const outro = await rotulo(page);
  assert(outro !== antes, "a seleção não mudou — o teste não exercitou nada");
  await page.click("#pbDrawButton");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");            // volta
  eq(await rotulo(page), antes, "voltar ao sorteio original não restaurou o rótulo");
  await ctx.close();
});

// ── CONTRATO: os três pontos de render usam a MESMA derivação ───────────────────────────────
await test("CONTRATO: todo render do rótulo passa por getEffectiveDraw", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(HERE, "..", "js", "app.js"), "utf8");
  const chamadas = [...src.matchAll(/drawSelectorLabel\(([^)]*)\)/g)]
    .map((m) => m[1]).filter((a) => !a.includes("d, effectiveDraw"));
  assert(chamadas.length >= 3, `esperava ao menos 3 chamadas de render, achei ${chamadas.length}`);
  for (const c of chamadas) {
    assert(/getEffectiveDraw\(/.test(c),
      `um render do rótulo não usa getEffectiveDraw: "${c}" — dois renders com derivações ` +
      "diferentes é como o sufixo passa a aparecer e sumir sozinho");
  }
});

await browser.close();
server.stop();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ COMBO NEXT LABEL PASSED\n" : "✗ COMBO NEXT LABEL FAILED\n");
process.exit(fail === 0 ? 0 : 1);
