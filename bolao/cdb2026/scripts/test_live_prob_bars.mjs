#!/usr/bin/env node
/**
 * CDB2026 — barras de probabilidade no card AO VIVO + leitura do snapshot ESPN.
 *
 * Achado do Eduardo (2026-08-07): "quando tem jogo ao vivo ... não mostra as probabilidades igual
 * da copa do mundo mostrava". Causa confirmada por inspeção: `tieProbBarsHtml()` existia, mas era
 * chamada SÓ em `renderProbsSection()`; `renderLiveTieCard()` nunca a chamava, ao contrário da Copa
 * (que chama `liveProbBarsHtml(m, live)` no card dela).
 *
 * Esta suíte roda num browser REAL porque a regressão só é observável no DOM renderizado do card ao
 * vivo — e o card ao vivo só existe quando o app casa uma partida "in" da fonte com um confronto da
 * fase ativa. Nenhum stub de DOM reproduz isso com honestidade.
 *
 * Cobre também a migração para o snapshot: o app NÃO pode mais requisitar site.api.espn.com.
 *
 * Uso: node bolao/cdb2026/scripts/test_live_prob_bars.mjs
 */

import { launchChromium } from "./visual/playwright_loader.mjs";
import { startStaticServer } from "../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 8208;

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

// Confronto real de oitavas (TWO_LEG) com times que existem em data.js, para que
// tieAdvanceProb() tenha rating dos dois lados.
const TEAM_A = "Santos", TEAM_B = "Grêmio";
const TIE_ID = "live-test-tie";

function stateWithLiveTie() {
  return {
    entries: [{ id: "e1", entryName: "Entrada Teste", picks: { matches: {}, qualified: {} } }],
    deletedIds: [], paid: {}, auditLog: [],
    espnSync: { activePhaseId: "oitavas", seededKnownConfrontos: true, healedPhantomTies: true },
    phases: {
      oitavas: {
        cutoffAt: "2026-08-01T20:30:00.000Z",
        ties: { [TIE_ID]: { teamA: TEAM_A, teamB: TEAM_B, matches: {
          // leg 1 ao vivo: homeTeam = teamA
          first: { kickoff: new Date(Date.now() - 45 * 60000).toISOString(), status: "IN" },
        } } },
      },
      quartas: { cutoffAt: null, ties: {} },
      semifinal: { cutoffAt: null, ties: {} },
      final: { cutoffAt: null, ties: {} },
    },
    meta: { updatedAt: new Date().toISOString() },
  };
}

// Snapshot normalizado com a partida AO VIVO (state:"in") casando os nomes do confronto acima.
function liveSnapshot() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, competitionId: "bra.copa_do_brazil", provider: "espn",
    generatedAt: now, sourceUpdatedAt: now, stale: false, staleReason: null, payloadHash: "fixture",
    matches: [{
      id: "live-1", date: new Date(Date.now() - 45 * 60000).toISOString(),
      state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
      statusShortDetail: "45'", statusDetail: "45'", completed: false,
      homeTeam: TEAM_A, awayTeam: TEAM_B, homeTeamId: "2674", awayTeamId: "6273",
      homeScore: 1, awayScore: 0, homeWinner: false, awayWinner: false,
      venue: "Vila Belmiro", city: "Santos",
      clockSec: 2700, clockStr: "45'", period: 1,
      details: [{ type: { text: "Goal" }, scoringPlay: true, team: { id: "2674" },
                  clock: { value: 1200, displayValue: "20'" },
                  athletesInvolved: [{ displayName: "Jogador Teste" }] }],
    }],
  };
}

const server = await startStaticServer(PORT, ROOT);
const browser = await launchChromium();

async function load({ stale = false, snapshotStatus = 200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const espnRequests = [], consoleErrors = [];
  await ctx.route("**://*.supabase.co/**", r => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await ctx.route("**://site.api.espn.com/**", r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }));
  await ctx.route("**/data/espn-normalized.json", r => {
    if (snapshotStatus !== 200) return r.fulfill({ status: snapshotStatus, body: "nope" });
    const snap = liveSnapshot();
    if (stale) { snap.stale = true; snap.staleReason = "fetch_failed"; }
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snap) });
  });
  const page = await ctx.newPage();
  page.on("request", r => { if (/api\.espn\.com/.test(r.url())) espnRequests.push(r.url()); });
  // Filtra dois ruídos que NÃO são erro da aplicação:
  //  - o aviso de CSP frame-ancestors via <meta> (dead config conhecida, os 4 apps têm);
  //  - o log do próprio browser para o recurso que ESTE teste devolve 404 de propósito
  //    ("Failed to load resource: ... 404"). O que importa é o app NÃO logar erro nem inventar
  //    dado — verificado pelas asserções de card oculto e entrada preservada.
  page.on("console", m => {
    const txt = m.text();
    if (m.type() !== "error") return;
    if (/frame-ancestors/.test(txt)) return;
    if (snapshotStatus !== 200 && /Failed to load resource/.test(txt)) return;
    consoleErrors.push(txt.slice(0, 120));
  });
  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "load" });
  await page.evaluate(st => localStorage.setItem("bolao_cdb2026_state", JSON.stringify(st)), stateWithLiveTie());
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(3500);
  return { ctx, page, espnRequests, consoleErrors };
}

const liveState = page => page.evaluate(() => {
  const card = document.getElementById("liveTieCard");
  const st = JSON.parse(localStorage.getItem("bolao_cdb2026_state") || "{}");
  return {
    hidden: card ? card.classList.contains("hidden") : null,
    liveMatches: card ? card.querySelectorAll(".live-match").length : 0,
    probBars: card ? card.querySelectorAll(".prob-bars").length : 0,
    probSegments: card ? card.querySelectorAll(".prob-bar").length : 0,
    barText: card ? [...card.querySelectorAll(".prob-bar")].map(b => b.textContent.trim()).join(" | ") : "",
    quartasTies: Object.keys(st.phases?.quartas?.ties || {}).length,
    entries: (st.entries || []).length,
  };
});

console.log("\nCDB2026 — card ao vivo: probabilidades + snapshot\n");

await test("o card ao vivo aparece a partir do SNAPSHOT (não da ESPN)", async () => {
  const { ctx, page, espnRequests } = await load();
  const s = await liveState(page);
  eq(espnRequests.length, 0, `o navegador chamou a ESPN direto: ${espnRequests.slice(0, 2)}`);
  eq(s.hidden, false, "o card ao vivo não apareceu — a partida do snapshot não casou com o confronto");
  eq(s.liveMatches, 1, "esperava exatamente 1 partida ao vivo");
  await ctx.close();
});

await test("REGRESSÃO: renderLiveTieCard renderiza as barras de probabilidade", async () => {
  const { ctx, page } = await load();
  const s = await liveState(page);
  eq(s.probBars, 1, "nenhum .prob-bars dentro do #liveTieCard — a regressão do Eduardo voltou");
  assert(s.probSegments >= 2, `esperava >= 2 segmentos .prob-bar, veio ${s.probSegments}`);
  assert(/%/.test(s.barText), `as barras não mostram porcentagem: "${s.barText}"`);
  await ctx.close();
});

await test("as barras usam o MESMO resolvedor da aba Probabilidades (sem segunda fonte de verdade)", async () => {
  const { ctx, page } = await load();
  const same = await page.evaluate(() => {
    const inLive = document.querySelector("#liveTieCard .prob-bars");
    // A aba Probabilidades usa tieProbBarsHtml() para o MESMO confronto; se as duas usam o mesmo
    // resolvedor, os rótulos de porcentagem batem.
    const btn = document.querySelector('[data-section="probs"]');
    if (btn) btn.click();
    const inProbs = document.querySelector("#probsContent .prob-bars");
    const pct = el => el ? [...el.querySelectorAll(".prob-bar")].map(b => (b.textContent.match(/(\d+)%/) || [])[1]) : null;
    return { live: pct(inLive), probs: pct(inProbs) };
  });
  assert(same.live && same.live.length, "não achei as barras no card ao vivo");
  if (same.probs && same.probs.length) {
    eq(JSON.stringify(same.live), JSON.stringify(same.probs),
      "porcentagens divergem entre o card ao vivo e a aba Probabilidades — há dois cálculos");
  }
  await ctx.close();
});

await test("snapshot marcado stale ainda renderiza (dado velho conhecido > nenhum dado)", async () => {
  const { ctx, page, consoleErrors } = await load({ stale: true });
  const s = await liveState(page);
  eq(s.hidden, false, "um snapshot stale escondeu o card ao vivo — degradação errada");
  eq(s.probBars, 1, "stale removeu as barras de probabilidade");
  assert(!consoleErrors.length, `stale gerou erro de console: ${consoleErrors.slice(0, 1)}`);
  await ctx.close();
});

await test("snapshot indisponível (404) falha seguro: sem card, sem erro, sem resultado inventado", async () => {
  const { ctx, page, consoleErrors } = await load({ snapshotStatus: 404 });
  const s = await liveState(page);
  eq(s.hidden, true, "sem snapshot o card ao vivo apareceu — de onde veio o dado?");
  eq(s.entries, 1, "a entrada local foi perdida quando o snapshot falhou");
  assert(!consoleErrors.length, `404 do snapshot gerou erro de console: ${consoleErrors.slice(0, 1)}`);
  await ctx.close();
});

await test("o invariante do sorteio das quartas continua intacto durante tudo isso", async () => {
  const { ctx, page } = await load();
  const s = await liveState(page);
  eq(s.quartasTies, 0, "apareceu confronto nas quartas sem sorteio oficial");
  await ctx.close();
});

await browser.close();
server.stop();

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE PROB BARS SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
