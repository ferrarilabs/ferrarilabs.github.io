#!/usr/bin/env node
/**
 * CONTADOR REGRESSIVO — NUNCA UMA CÉLULA ÓRFÃ.
 *
 * POR QUE: no print do iPhone que o Eduardo mandou em 2026-08-09, o contador do próximo jogo
 * aparecia como "00 H" e "12 MIN" numa linha e "59 S" sozinho embaixo — ocupando a região central
 * do card, onde deveria estar o placar.
 *
 * CAUSA: `.count-grid` tinha `grid-template-columns: repeat(2, 1fr)` no mobile, um override local
 * que a Copa (referência visual canônica) nunca teve. Com 4 células (D/H/M/S) duas colunas dão
 * 2×2 e parecem propositais. Mas a célula de DIAS some quando falta menos de um dia — sobram 3, e
 * 3 em duas colunas viram 2 + 1 órfã. **O layout quebrava exatamente quando o contador mais
 * importa: perto do jogo.** É por isso que ninguém tinha visto antes; a maior parte do tempo o
 * contador tem 4 células.
 *
 * A lição que vira gate: um grid com número VARIÁVEL de células não pode ter contagem de colunas
 * fixa. A verificação abaixo não olha o CSS — mede quantas linhas as células realmente ocupam, em
 * várias larguras, para pegar qualquer regressão futura independente de como ela seja escrita.
 *
 * Uso: node bolao/scripts/audit_countdown_layout.mjs
 */

import { startStaticServer } from "./static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8213;
const APPS = ["br2026", "cdb2026", "copa2026"];
const WIDTHS = [320, 390, 414, 768, 1280];

let pass = 0, fail = 0, medidos = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const PROBE = () => [...document.querySelectorAll(".count-grid")]
  .filter(g => g.getBoundingClientRect().height > 0)
  .map(g => {
    const cells = [...g.children].map(c => {
      const r = c.getBoundingClientRect();
      return {
        t: c.textContent.replace(/\s+/g, " ").trim(),
        top: Math.round(r.top), w: Math.round(r.width),
        overflow: c.scrollWidth > c.clientWidth + 1,
      };
    });
    return { linhas: new Set(cells.map(c => c.top)).size, cells };
  });

const pw = await import("playwright");
const server = await startStaticServer(PORT, ROOT);
const browser = await pw.chromium.launch();

console.log("\nLayout do contador regressivo (célula órfã / estouro)\n");

for (const app of APPS) {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/bolao/${app}/`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const grids = await page.evaluate(PROBE);
    if (grids.length === 0) { await ctx.close(); continue; }
    medidos += grids.length;

    await test(`[${app} @ ${width}px] todas as células do contador numa única linha`, () => {
      for (const g of grids) {
        assert(g.linhas === 1,
          `contador quebrado em ${g.linhas} linhas (${g.cells.length} células): ` +
          g.cells.map(c => `"${c.t}"`).join(" ") +
          " — é assim que nasce a célula órfã que o Eduardo fotografou");
      }
    });

    await test(`[${app} @ ${width}px] nenhuma célula do contador estoura seu próprio box`, () => {
      for (const g of grids) {
        const est = g.cells.filter(c => c.overflow);
        assert(est.length === 0,
          `célula cortada: ${est.map(c => `"${c.t}" (${c.w}px)`).join(", ")} — ` +
          `caber numa linha não pode custar legibilidade`);
      }
    });

    await ctx.close();
  }
}

await browser.close();
server.stop();

// Um gate que não mediu nada não afirma nada — falha em vez de passar calado.
if (medidos === 0) {
  console.log("\n  ✗ nenhum contador renderizado em nenhum app/largura — a suíte perdeu o alvo\n");
  process.exit(1);
}

console.log(`\n  ${pass} passed, ${fail} failed   (${medidos} contadores medidos)`);
if (fail) { console.log("\n✗ COUNTDOWN LAYOUT FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
