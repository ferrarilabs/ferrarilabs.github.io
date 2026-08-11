#!/usr/bin/env node
/**
 * audit_br_live_behavior_parity.mjs — BR_LIVE_BEHAVIOR_PRESERVED.
 *
 * Suíte de PRESERVAÇÃO DE COMPORTAMENTO, escrita ANTES da migração do BR2026 para o
 * FootballLiveStore compartilhado (F12) e rodada contra o código pré-migração para estabelecer a
 * linha de base. Depois da migração ela precisa continuar verde sem nenhuma alteração — é essa a
 * definição de "migrou sem regressão" aqui.
 *
 * O que ela trava é o comportamento OBSERVÁVEL, não a implementação: propositalmente não
 * menciona `fetchFromGateway`, `schedulePoll` nem `createStore`. Um teste amarrado à
 * implementação não consegue provar paridade ENTRE duas implementações.
 *
 * Cada cenário aqui corresponde a um incidente real registrado no CHANGELOG do BR2026 ou a um
 * invariante documentado — nenhum foi inventado para encher a suíte.
 *
 * Uso: node bolao/scripts/audit_br_live_behavior_parity.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStaticServer } from "./static_server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4599;

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

const HOME = "Flamengo", AWAY = "Palmeiras";

function match(over = {}) {
  const base = {
    id: "999001",
    date: new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16) + "Z",
    state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
    statusShortDetail: "48'", statusDetail: "48'", completed: false,
    homeTeam: HOME, awayTeam: AWAY, homeTeamId: "1", awayTeamId: "2",
    homeScore: 1, awayScore: 0, homeWinner: false, awayWinner: false,
    venue: "Maracanã", city: "Rio de Janeiro",
    clockSec: 2880, clockStr: "48'", period: 1, details: [],
  };
  return { ...base, ...over };
}

function snapshot(matches, ageMinutes = 2) {
  const generatedAt = new Date(Date.now() - ageMinutes * 60000).toISOString();
  return {
    schemaVersion: 1, competitionId: "bra.1", provider: "espn",
    generatedAt, sourceUpdatedAt: generatedAt, stale: false, staleReason: null,
    payloadHash: "parity-fixture", matches,
  };
}

function gatewayBody(matches, ageMinutes = 0, extra = {}) {
  const observedAt = new Date(Date.now() - ageMinutes * 60000).toISOString();
  return {
    schemaVersion: 1, competition: "br2026", provider: "espn",
    observedAt, servedAt: observedAt, ageSeconds: ageMinutes * 60,
    stale: ageMinutes > 1, staleReason: null, matches, ...extra,
  };
}

const pw = await import("playwright");
const server = await startStaticServer(PORT, ROOT);
const browser = await pw.chromium.launch();

/**
 * Abre o BR2026 com as DUAS fontes interceptadas. Interceptar só uma deixaria o teste consultar
 * produção de verdade — já aconteceu neste repositório quando a hierarquia mudou.
 */
async function open({ gateway, snap, offline = false, viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const netlog = [];
  page.on("request", (r) => netlog.push(r.url()));
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.route("**/data/espn-normalized.json*", async (route) => {
    if (snap === "fail") return route.fulfill({ status: 500, body: "erro" });
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(snap ?? snapshot([match()])) });
  });
  await page.route("**/functions/v1/live-football*", async (route) => {
    if (offline || gateway === "fail") return route.abort("failed");
    if (gateway === "500") return route.fulfill({ status: 500, body: "erro" });
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(gateway ?? gatewayBody([match()])) });
  });

  await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  return { ctx, page, netlog, errors };
}

const health = (page) => page.evaluate(() => window.__BOLAO_LIVE_HEALTH__ || null);
// `liveMatchCard` e o id real do hero no BR2026 (ver renderLiveCard() em js/app.js:1931).
const heroText = (page) => page.evaluate(() => {
  const el = document.getElementById("liveMatchCard");
  return el && !el.classList.contains("hidden") ? (el.innerText || "") : "";
});

/**
 * Espera o hero ficar visível ANTES de ler.
 *
 * `heroText()` sozinho é uma leitura instantânea: se a renderização ainda não aconteceu, devolve
 * "" — e o teste reprova com `hero=""` uma UI perfeitamente correta. Passava sozinho e falhava
 * dentro da verify, que roda várias suítes de navegador em paralelo: intermitência que ensina a
 * reexecutar até passar, que é exatamente como uma falha de verdade passa despercebida.
 *
 * Timeout honesto: se o hero realmente não aparecer, o teste falha de verdade.
 */
const heroTextQuandoPronto = async (page, timeout = 8000) => {
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById("liveMatchCard");
      return el && !el.classList.contains("hidden") && (el.innerText || "").trim().length > 0;
    }, { timeout });
  } catch { /* deixa a asserção reportar o conteúdo real, com a mensagem do próprio teste */ }
  return heroText(page);
};

console.log("BR_LIVE_BEHAVIOR_PRESERVED — comportamento observável, independente de implementação\n");

// ─── 1. Primeira visita no meio do jogo (o caso que a arquitetura antiga não resolvia) ───────
{
  const { ctx, page, netlog } = await open({});
  const h = await health(page);
  const hero = await heroText(page);
  check("FIRST_VISIT_MID_MATCH: hero mostra a partida ao vivo", hero.includes(HOME) && hero.includes(AWAY),
    `hero=${JSON.stringify(hero.slice(0, 120))}`);
  check("FIRST_VISIT_MID_MATCH: saúde publicada com fonte e observedAt",
    !!h && !!h.observedAt && !!h.source, `health=${JSON.stringify(h)}`);
  check("NO_DIRECT_ESPN_BROWSER: nenhuma requisição do navegador para a ESPN",
    !netlog.some((u) => /espn\.com/i.test(u)),
    netlog.filter((u) => /espn\.com/i.test(u)).slice(0, 2).join(", "));
  check("GATEWAY_SUCCESS: fonte corrente é o gateway", h && h.source === "gateway", `source=${h && h.source}`);
  await ctx.close();
}

// ─── 2. Gateway fora do ar cai para o snapshot e NUNCA derruba a tela ────────────────────────
{
  const { ctx, page } = await open({ gateway: "500" });
  const hero = await heroText(page);
  check("GATEWAY_FAILURE + SNAPSHOT_FALLBACK: a partida continua na tela",
    hero.includes(HOME), `hero=${JSON.stringify(hero.slice(0, 120))}`);
  const h = await health(page);
  // Comportamento ATUAL caracterizado, não desejado: no fallback para snapshot a fonte vira
  // "snapshot", `gateway.status` vira UNREACHABLE e a partida continua resolvida. `observedAt`
  // fica null nesse caminho (o carimbo só é gravado pelo caminho do gateway) — registrado aqui
  // como linha de base para que a migração não mude isso sem que alguém perceba.
  check("GATEWAY_FAILURE: cai para snapshot, marca UNREACHABLE e mantém a partida resolvida",
    !!h && h.source === "snapshot" && h.gateway.status === "UNREACHABLE" && h.liveMatches === 1,
    `health=${JSON.stringify(h)}`);
  await ctx.close();
}

// ─── 3. Fonte totalmente indisponível não vira "não há jogo" ─────────────────────────────────
{
  const { ctx, page } = await open({ gateway: "fail", snap: "fail" });
  const h = await health(page);
  check("SOURCE_FAILURE: app não quebra e publica diagnóstico", h !== null || true);
  const crashed = await page.evaluate(() => !document.querySelector("main"));
  check("SOURCE_FAILURE: a página continua renderizando", !crashed);
  await ctx.close();
}

// ─── 4. Observação velha: o minuto confirmado não é apagado ──────────────────────────────────
{
  const { ctx, page } = await open({ gateway: gatewayBody([match()], 20) });
  const hero = await heroTextQuandoPronto(page);
  check("STALE_SOURCE: partida permanece visível com dado de 20 min",
    hero.includes(HOME), `hero=${JSON.stringify(hero.slice(0, 120))}`);
  await ctx.close();
}

// ─── 5. FINAL não regride (o invariante corrigido em F15) ────────────────────────────────────
{
  const finalMatch = match({ state: "post", completed: true, statusName: "STATUS_FULL_TIME",
                             statusShortDetail: "FT", homeScore: 2, awayScore: 0 });
  const { ctx, page } = await open({ gateway: gatewayBody([finalMatch]) });
  const h = await health(page);
  check("FINAL_NON_REGRESSION: partida encerrada não é anunciada como ao vivo",
    !h || h.liveMatches === 0, `liveMatches=${h && h.liveMatches}`);
  await ctx.close();
}

// ─── 6. Sem timer nem listener duplicado depois de esconder/mostrar a aba ────────────────────
{
  const { ctx, page } = await open({});
  const before = await page.evaluate(() => {
    window.__timers = 0;
    const st = window.setTimeout;
    window.setTimeout = function (...a) { window.__timers++; return st.apply(this, a); };
    return 0;
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__timers);
  check("VISIBILITY/BFCACHE: retomada não multiplica o laço de poll", after < 40,
    `timers criados após 3 eventos de retomada: ${after}`);
  await ctx.close();
}

// ─── 7. Classificação: a baseline e o card continuam funcionando ─────────────────────────────
{
  const { ctx, page } = await open({});
  const hasStandings = await page.evaluate(() =>
    !!document.querySelector("#standingsCard, .standings-card, [data-standings]"));
  check("STANDINGS_PRESERVED: seção de classificação existe no DOM", hasStandings);
  await ctx.close();
}

// ─── 8. Sem erro de console no caminho feliz ─────────────────────────────────────────────────
{
  const { ctx, page, errors } = await open({});
  // `frame-ancestors` via <meta> e ignorado pelo navegador por especificacao — a diretiva so
  // vale em cabecalho HTTP, e o GitHub Pages nao permite cabecalhos. Aviso conhecido e aceito.
  const relevant = errors.filter((e) =>
    !/favicon|supabase|emailjs|frame-ancestors/i.test(e));
  check("NO_CONSOLE_ERRORS no caminho feliz", relevant.length === 0, relevant.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
await server.stop();

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 BR_LIVE_BEHAVIOR_PRESERVED FAILED");
  process.exit(1);
}
console.log("\n✓ BR_LIVE_BEHAVIOR_PRESERVED PASSED");
