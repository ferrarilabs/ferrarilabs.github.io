#!/usr/bin/env node
/**
 * BARRA DE PROBABILIDADE — ESPESSURA UNIFORME EM TODA A PLATAFORMA.
 *
 * POR QUE ESTA SUÍTE EXISTE: em 2026-08-09 o Eduardo mandou um print do iPhone mostrando barras
 * com alturas visivelmente diferentes na MESMA tela. Medido: 30px, 31px, 44px e 56px — e o mesmo
 * jogo (Bahia×Vasco) aparecia com 44px numa seção e 56px em outra.
 *
 * CAUSA RAIZ: o limiar que decide manter o nome do time é PERCENTUAL (`pct >= 12`), mas o que
 * decide se o rótulo CABE é PIXEL. Um segmento de 17% num viewport de 390px tem ~56px — não cabe
 * "Vasco da Gam… 17%". Com `white-space: normal` no mobile, o rótulo quebrava em três linhas e
 * esticava a linha inteira (`.prob-bars { height: auto }`). Como a largura vem da probabilidade,
 * cada partida esticava um tanto diferente. A espessura desigual era um SINTOMA de um limiar
 * medido na unidade errada.
 *
 * A defesa não pode ser "não deixe o texto quebrar" sozinha — foi justamente a proibição de quebra
 * que, na Fase 7, cortava o rótulo no meio e motivou a quebra de linha. Por isso esta suíte trava
 * as DUAS propriedades ao mesmo tempo, que é o que a correção real precisa garantir:
 *
 *   1. TODA barra tem exatamente a mesma altura, em qualquer jogo e em qualquer seção;
 *   2. a PORCENTAGEM nunca é cortada — é o dado que importa e sobrevive a qualquer largura.
 *
 * Uma correção futura que sacrifique (2) para conseguir (1) falha aqui, e é isso que se quer.
 *
 * Uso: node bolao/scripts/audit_prob_bar_geometry.mjs
 */

import { startStaticServer } from "./static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8212;
const APPS = ["br2026", "copa2026", "cdb2026"];
const VIEWPORTS = [
  { name: "iPhone", width: 390, height: 844 },
  { name: "iPhone-pequeno", width: 320, height: 700 },
  { name: "desktop", width: 1280, height: 900 },
];

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const PROBE = () => {
  const rows = [...document.querySelectorAll(".prob-bars")];
  return rows.map(r => ({
    h: Math.round(r.getBoundingClientRect().height),
    segs: [...r.children].map(c => {
      const pct = c.querySelector(".prob-bar__pct");
      return {
        h: Math.round(c.getBoundingClientRect().height),
        w: Math.round(c.getBoundingClientRect().width),
        text: c.textContent.trim(),
        // O trecho da porcentagem cabe inteiro na sua caixa?
        pctClipped: pct ? pct.scrollWidth > pct.clientWidth + 1 : null,
        pctText: pct ? pct.textContent.trim() : null,
      };
    }),
  })).filter(r => r.segs.length > 0 && r.h > 0);
};

const pw = await import("playwright");
const server = await startStaticServer(PORT, ROOT);
const browser = await pw.chromium.launch();

console.log("\nGeometria da barra de probabilidade (todos os apps × todos os viewports)\n");

for (const app of APPS) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/bolao/${app}/`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    // Percorre as seções que renderizam barras — o defeito relatado aparecia justamente
    // por comparação ENTRE seções, então medir uma só não serviria.
    let rows = [];
    // Navega por `data-section`, não por rótulo de texto. A primeira versão desta suíte clicava
    // em "Jogos"/"Probabilidades" e, por isso, mediu ZERO barras na Copa e na CDB — e passou
    // verde mesmo assim. Um gate que não encontra o alvo e cala é pior que gate nenhum: dá a
    // impressão de cobertura em três apps quando só cobria um. `force: true` porque a Copa está
    // arquivada e esconde os botões de nav — a seção continua existindo e renderizável.
    for (const section of ["games", "probs", "entry", "ranking"]) {
      const btn = await page.$(`[data-section="${section}"]`);
      if (!btn) continue;
      await btn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
      rows = rows.concat(await page.evaluate(PROBE));
    }

    if (rows.length === 0) {
      // NÃO é "pular em silêncio". Ou o app legitimamente não tem barra, e isso precisa estar
      // declarado aqui, ou a suíte perdeu o alvo — e aí é falha.
      // A ausência precisa ser explicada por uma CAUSA verificável no runtime, não por uma lista
      // de apps isentos. Lista por nome envelhece calada: no dia em que a CBF publicar o sorteio,
      // "cdb2026 está isento" continuaria verde mesmo se as barras quebrassem de vez.
      const motivo = await page.evaluate(() => {
        const cfg = window.BOLAO_CONFIG || {};
        if (cfg.archived) return "torneio arquivado (CONFIG.archived) — não há partida futura";
        // Mesma chave que o próprio app usa (`C.storeKey`) — sem hook de teste inventado.
        let st = null;
        try { st = JSON.parse(localStorage.getItem(cfg.storeKey) || "null"); } catch { /* estado ilegível conta como ausente */ }
        const phases = (st && st.phases) || {};
        const algumConfronto = Object.values(phases)
          .some(p => p && p.ties && Object.keys(p.ties).length > 0);
        if (!algumConfronto) return "nenhum confronto definido ainda — o sorteio oficial não saiu";
        return null;
      });
      await test(`[${app} @ ${vp.name}] nenhuma barra: há causa legítima?`, () => {
        assert(motivo,
          `${app} não renderizou barra nenhuma e não há causa que explique isso — ` +
          `ou o produto quebrou, ou a suíte perdeu o alvo. Ambos exigem ação.`);
        console.log(`      motivo: ${motivo}`);
      });
      await ctx.close();
      continue;
    }

    await test(`[${app} @ ${vp.name}] todas as ${rows.length} barras têm a MESMA altura`, () => {
      const alturas = [...new Set(rows.map(r => r.h))];
      assert(alturas.length === 1,
        `alturas diferentes na mesma plataforma: ${alturas.sort((a, b) => a - b).join("px, ")}px — ` +
        `foi exatamente isso que o Eduardo fotografou`);
    });

    await test(`[${app} @ ${vp.name}] dentro de cada barra, os segmentos têm a mesma altura`, () => {
      for (const r of rows) {
        const hs = [...new Set(r.segs.map(s => s.h))];
        assert(hs.length === 1,
          `segmentos desalinhados (${hs.join("/")}px) em: ${r.segs.map(s => s.text).join(" | ")}`);
      }
    });

    await test(`[${app} @ ${vp.name}] a PORCENTAGEM nunca é cortada, nem no segmento mais estreito`, () => {
      const comPct = rows.flatMap(r => r.segs).filter(s => s.pctClipped !== null);
      assert(comPct.length > 0,
        "nenhum segmento expõe `.prob-bar__pct` — o rótulo voltou a ser texto solto, e sem elemento " +
        "próprio a porcentagem pode ser cortada junto com o nome do time");
      const cortados = comPct.filter(s => s.pctClipped);
      assert(cortados.length === 0,
        `porcentagem cortada em: ${cortados.map(s => `"${s.pctText}" (${s.w}px)`).join(", ")}`);
    });

    await test(`[${app} @ ${vp.name}] o rótulo continua legível (nome presente quando cabe)`, () => {
      // Guarda contra a "correção" preguiçosa: esconder o nome de todo mundo também deixaria
      // todas as alturas iguais, e seria uma piora.
      const largos = rows.flatMap(r => r.segs).filter(s => s.w >= 100);
      if (largos.length === 0) return;
      const semNome = largos.filter(s => !/[A-Za-zÀ-ú]/.test(s.text));
      assert(semNome.length === 0,
        `segmento largo (${largos[0].w}px) perdeu o nome do time: "${semNome[0]?.text}"`);
    });

    await ctx.close();
  }
}

await browser.close();
server.stop();
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ PROB BAR GEOMETRY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
