#!/usr/bin/env node
/**
 * CARD AO VIVO — CONTRATO DE DOM/RENDER (a outra metade do contrato semântico).
 *
 * `audit_live_clock_semantics.mjs` prova que o RESOLVEDOR decide certo. Isso não basta: o bug do
 * print era de RENDERIZAÇÃO tanto quanto de decisão — a tela tinha o minuto e não o mostrava. Um
 * resolvedor correto ligado a um render errado produz exatamente o mesmo print.
 *
 * Por isso esta suíte renderiza a página de verdade, injeta a fixture do estado relatado e mede
 * o DOM: texto visível, caixas delimitadoras, alturas computadas.
 *
 * NENHUMA DEPENDÊNCIA DE REDE: a fixture é injetada localmente; a ESPN nunca é chamada.
 *
 * Uso: node bolao/scripts/audit_live_card_dom.mjs
 */

import { startStaticServer } from "./static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8231;
const WIDTHS = [320, 375, 390, 430, 899, 900, 901, 1024];

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// A fixture EXATA do print: Cruzeiro 1 × 1 Mirassol, ao vivo, 48' confirmado, observado há 15
// minutos (bem além do teto), com lances aos 26', 27' e 48'. Times reais porque o card resolve
// escudo e posição por nome; nenhum dado de participante envolvido.
const FIXTURE = {
  id: "fixture-live-stale",
  homeTeam: "Cruzeiro", awayTeam: "Mirassol",
  homeScore: 1, awayScore: 1,
  clockSeconds: 48 * 60, clockStr: "48'", period: 2,
  isHalftime: false, isPenalties: false, clockPaused: false,
  plays: [
    { minute: 48, text: "Cartão amarelo" },
    { minute: 27, text: "Gol" },
    { minute: 26, text: "Substituição" },
  ],
};

const pw = await import("playwright");
const server = await startStaticServer(PORT, ROOT);
const browser = await pw.chromium.launch();

console.log("\nCard ao vivo — contrato de DOM (fixture determinística, sem rede)\n");

// Constrói um snapshot normalizado SINTÉTICO no mesmo formato que o provedor grava, com
// `generatedAt` 15 minutos no passado — que é como o app aprende que a observação envelheceu.
// Interceptar o snapshot (em vez de injetar estado via gancho de teste) exercita o pipeline
// INTEIRO: parse → resolvedor de partida ao vivo → resolvedor de atraso → modelo do card →
// render. O bug do print morava entre a decisão e o desenho; um gancho que pulasse essas etapas
// não o teria pego. E nenhum gancho de teste entra em código de produção.
function syntheticSnapshot(ageMinutes) {
  const generatedAt = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return {
    schemaVersion: 1, competitionId: "bra.1", provider: "espn",
    generatedAt, sourceUpdatedAt: generatedAt, stale: false, staleReason: null,
    payloadHash: "fixture",
    matches: [{
      id: FIXTURE.id,
      date: new Date(Date.now() - (ageMinutes + 48) * 60 * 1000).toISOString().slice(0, 16) + "Z",
      state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
      statusShortDetail: "48'", statusDetail: "48'", completed: false,
      homeTeam: FIXTURE.homeTeam, awayTeam: FIXTURE.awayTeam,
      homeTeamId: "1", awayTeamId: "2",
      homeScore: FIXTURE.homeScore, awayScore: FIXTURE.awayScore,
      homeWinner: false, awayWinner: false,
      venue: "Estadio Fixture", city: "Cidade Fixture",
      clockSec: FIXTURE.clockSeconds, clockStr: FIXTURE.clockStr, period: FIXTURE.period,
      details: FIXTURE.plays.map((p) => ({ minute: p.minute, text: p.text, type: "play" })),
    }],
  };
}

async function openWithFixture(width, ageMinutes = 15) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.route("**/data/espn-normalized.json*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(syntheticSnapshot(ageMinutes)) });
  });
  await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

// ─── 1. O print, reproduzido e verificado ───────────────────────────────────────────────────
console.log("Reprodução do print (390px):");

{
  const { ctx, page } = await openWithFixture(390);
  const card = await page.evaluate(() => {
    const el = document.getElementById("liveMatchCard");
    if (!el || el.classList.contains("hidden")) return { ausente: true };
    return {
      ausente: false,
      texto: el.textContent.replace(/\s+/g, " ").trim(),
      clock: el.querySelector(".live-clock")?.textContent.trim() ?? null,
      staleBadge: el.querySelector(".live-clock-stale")?.textContent.trim() ?? null,
      badge: el.querySelector(".live-badge")?.textContent.trim() ?? null,
      scores: [...el.querySelectorAll(".live-score")].map((s) => s.textContent.trim()),
    };
  });

  await test("o card ao vivo aparece com a fixture injetada", () => {
    assert(!card.ausente, "o card não renderizou — sem isso nada abaixo afirma nada");
  });

  if (!card.ausente) {
    await test('badge "AO VIVO" continua visível com observação atrasada', () => {
      assert(card.badge && /AO VIVO/i.test(card.badge), `badge: ${JSON.stringify(card.badge)}`);
    });

    await test("o minuto confirmado 48' PERMANECE visível (o defeito do print)", () => {
      assert(card.clock && /48/.test(card.clock),
        `o relógio não mostra o minuto confirmado: ${JSON.stringify(card.clock)}`);
    });

    await test('"Atualização pendente" aparece como estado SECUNDÁRIO, não no lugar do minuto', () => {
      assert(!/Atualiza/i.test(card.clock || ""),
        `a mensagem de atraso voltou a ocupar o relógio: ${JSON.stringify(card.clock)}`);
      assert(card.staleBadge && /Atualiza/i.test(card.staleBadge),
        "o atraso deixou de ser sinalizado — o número pareceria ao vivo");
    });

    await test("placar 1 × 1 preservado", () => {
      assert(card.scores.includes("1") && card.scores.length >= 2,
        `placar inesperado: ${JSON.stringify(card.scores)}`);
    });

    await test("nenhuma data/hora AGENDADA no centro onde vai o placar", () => {
      // Cuidado com o falso positivo que eu mesmo escrevi primeiro: o relógio da partida é
      // `MM:SS` ("48:00"), então procurar `\d+:\d+` acusa o relógio legítimo. O que caracteriza
      // horário AGENDADO é outra coisa: fuso ("EDT"/"BRT"), data (`DD/MM`), ou o rótulo de
      // agendamento. Um relógio de partida nunca traz nenhum dos três.
      const centro = `${card.clock} ${card.staleBadge || ""}`;
      assert(/^\d{1,3}(:\d{2})?['’]?$/.test((card.clock || "").trim()),
        `o relógio não tem forma de relógio de partida: ${JSON.stringify(card.clock)}`);
      assert(!/\b(EDT|EST|BRT|GMT|UTC|AM|PM)\b/i.test(centro),
        `fuso horário (marca de horário agendado) na região do placar: ${JSON.stringify(centro)}`);
      assert(!/\d{2}\/\d{2}/.test(centro),
        `data apareceu na região do placar: ${JSON.stringify(centro)}`);
    });
  }
  await ctx.close();
}

// ─── 2. Rótulo de probabilidade: separação MEDIDA, não inferida do texto ────────────────────
console.log("\nSeparação do rótulo de probabilidade (medida em pixels):");

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const btn = await page.$('[data-section="games"]');
  if (btn) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(700); }

  const dados = await page.evaluate(() => {
    const segs = [...document.querySelectorAll(".prob-bar")].filter((s) => s.getBoundingClientRect().height > 0);
    return segs.map((s) => {
      const nome = s.querySelector(".prob-bar__name");
      const pct = s.querySelector(".prob-bar__pct");
      const rs = s.getBoundingClientRect();
      const rn = nome?.getBoundingClientRect();
      const rp = pct?.getBoundingClientRect();
      return {
        temNome: !!nome, temPct: !!pct,
        gap: rn && rp ? Math.round(rp.left - rn.right) : null,
        nomeW: rn ? Math.round(rn.width) : 0,
        altura: Math.round(rs.height),
        pctCortado: pct ? pct.scrollWidth > pct.clientWidth + 1 : null,
        texto: s.textContent.replace(/\s+/g, " ").trim(),
      };
    });
  });

  if (dados.length === 0) { await ctx.close(); continue; }

  await test(`[${width}px] a porcentagem é um elemento próprio em todos os segmentos`, () => {
    for (const d of dados) assert(d.temPct, `segmento sem .prob-bar__pct: ${d.texto}`);
  });

  await test(`[${width}px] separação MEDIDA entre nome e porcentagem >= 4px`, () => {
    // Medida em pixels, não "o texto contém um espaço": o espaço textual é a primeira coisa que
    // o `text-overflow: ellipsis` come, justamente nos segmentos estreitos.
    const comNome = dados.filter((d) => d.temNome && d.nomeW > 0);
    assert(comNome.length > 0, "fixture inútil: nenhum segmento com nome visível");
    for (const d of comNome) {
      assert(d.gap >= 4,
        `separação de ${d.gap}px em "${d.texto}" — a porcentagem encosta no nome/reticências`);
    }
  });

  await test(`[${width}px] a porcentagem nunca é cortada`, () => {
    const cortados = dados.filter((d) => d.pctCortado);
    assert(cortados.length === 0, `porcentagem cortada em: ${cortados.map((d) => d.texto).join(", ")}`);
  });

  await test(`[${width}px] TODAS as barras têm a mesma altura (a "barra gorda")`, () => {
    const alturas = [...new Set(dados.map((d) => d.altura))];
    assert(alturas.length === 1,
      `alturas diferentes: ${alturas.sort((a, b) => a - b).join("px, ")}px — a porcentagem só pode mudar LARGURA`);
  });

  await test(`[${width}px] sem overflow horizontal na página`, () => {
    // (medido abaixo, no mesmo contexto)
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await test(`[${width}px] scrollWidth não excede a viewport`, () => {
    assert(overflow <= 1, `overflow horizontal de ${overflow}px`);
  });

  await ctx.close();
}

await browser.close();
server.stop();
console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE CARD DOM FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
