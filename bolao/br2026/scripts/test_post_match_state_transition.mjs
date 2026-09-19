#!/usr/bin/env node
/**
 * test_post_match_state_transition.mjs — BR2026 não pode voltar um jogo terminado para
 * "Em andamento" (Issue #436).
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────────────────────
 *
 * Produção, 2026-09-14/15: Bahia 2 × 1 Remo terminou (`state:"post"`, `completed:true`, FT) e o
 * gateway/cache já tinha o placar correto — mas "Jogos de hoje" voltou a mostrar o card como
 * "Em andamento", sem placar.
 *
 * `renderNextGameCard()` (js/app.js) só tinha DOIS ramos para um jogo de hoje que não está em
 * `_liveMatches`: `isPostponedMatch(g)` e `isFinalMatch(g)`. Os dois exigem que `g.state`
 * (o campo overlay em `_schedule`, vindo do gateway ao vivo — ver `applyLiveMatches()`) já
 * confirme o resultado. Quando isso não acontece — o produtor do cache saiu da janela de
 * rastreio (`WINDOW_LOOKBACK_MS`, 3h, em `bolao/shared/scripts/produce_live_cache.mjs`), o
 * snapshot estático do calendário (`data/espn-normalized.json`) ainda não foi resincronizado, ou
 * a aba simplesmente nunca recebeu a observação final — `g.state` fica PARADO no que o snapshot
 * estático tinha (tipicamente `"pre"`), e o código caía direto no ramo de contagem regressiva:
 *
 *     const diffMs = new Date(g.dateISO).getTime() - now;   // muito negativo, jogo já acabou
 *     const timerHtml = countdownTimerHtml(diffMs);          // diffMs <= 0 -> "Em andamento"
 *
 * `countdownTimerHtml()` trata QUALQUER `diffMs <= 0` como "o jogo começou" — o que é verdade
 * para um jogo que ACABOU DE COMEÇAR, mas falso para um cujo kickoff foi há 4 horas.
 *
 * ─── A CORREÇÃO ─────────────────────────────────────────────────────────────────────────────
 *
 * Um terceiro ramo, entre `isFinalMatch()` e a contagem regressiva: kickoff já passado SEM
 * nenhuma confirmação de estado terminal é ESTADO DESCONHECIDO, não "ao vivo" nem resultado
 * inventado — mostra `gameStatusUnconfirmed` ("Resultado aguardando confirmação"), nunca
 * "Em andamento", nunca um placar que ninguém confirmou. `countdownTimerHtml()` em si não muda —
 * ele nunca mais recebe um `diffMs` negativo vindo deste caminho, então continua sendo só o
 * widget do countdown, sem lógica de provedor misturada (pedido explícito de Eduardo, #436).
 *
 * ─── ESCOPO ──────────────────────────────────────────────────────────────────────────────────
 *
 * Só toca `renderNextGameCard()` (js/app.js) + uma chave de i18n nova. Nenhuma mudança em
 * scoring, ranking, picks, persistência, Supabase, schema, broadcasts ou regra de torneio.
 *
 * ─── FIXTURES: DUAS FONTES, PROPOSITALMENTE DIVERGENTES ────────────────────────────────────
 *
 * Como em check_live_hero_width.mjs, as DUAS fontes são interceptadas separadamente:
 *   - `data/espn-normalized.json`  → `_schedule` inicial (fetchSchedule()) — o "snapshot estático
 *     do calendário", que no bug real fica para trás.
 *   - `functions/v1/live-football` → overlay ao vivo (applyLiveMatches()) — o gateway.
 * O cenário STALE (a reprodução exata do defeito) deixa o snapshot estático em `"pre"` e faz o
 * gateway devolver `SOURCE_UNAVAILABLE`/`matches:null` — exatamente o que acontece quando o
 * produtor sai da janela de rastreio: o overlay NUNCA roda (`applyLiveMatches` retorna cedo
 * quando `matches === null`), então `_schedule[idx].state` nunca é corrigido.
 *
 * Uso: node bolao/br2026/scripts/test_post_match_state_transition.mjs
 *      PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node ... (sandbox sem Playwright gerenciado)
 */
import { launchChromium } from "../../cdb2026/scripts/visual/playwright_loader.mjs";
import { startStaticServer } from "../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 8142; // único: ver bolao/scripts/test_harness_ports_unique.mjs

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Relógio CONGELADO, não `Date.now()` real. Achado ao escrever este teste (não é o defeito de
// produção -- é um defeito NOVO, deste harness): com offsets relativos ao horário real da
// máquina, um fixture "daqui a 2h" cruzou a meia-noite BRT bem na hora em que este teste rodou
// pela primeira vez (a corrida aconteceu ~23:47 BRT) -- o jogo "futuro" saiu silenciosamente do
// filtro `brtDateKey(g.dateISO) === todayKey` de "Jogos de hoje" porque BRT já tinha virado o
// dia. `12:00 BRT` (meio-dia) tem a maior folga possível antes de cruzar qualquer fronteira de
// dia em qualquer offset usado abaixo (±4h). `page.addInitScript` sobrescreve `Date.now`/
// `new Date()` sem argumento ANTES do primeiro script da página rodar -- toda leitura de "agora"
// dentro do app (brtDateKey, countdown, nextUpcomingGame) vê o mesmo instante fixo que os
// fixtures foram construídos com, então o teste é determinístico em qualquer hora real do dia.
const FIXED_NOW = Date.parse("2026-09-15T15:00:00.000Z"); // 12:00 BRT (UTC-3)
const iso = (offsetMs) => new Date(FIXED_NOW + offsetMs).toISOString();
const H = 60 * 60 * 1000, M = 60 * 1000;

async function freezeClock(context) {
  await context.addInitScript((fixedNow) => {
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    }
    // eslint-disable-next-line no-global-assign
    Date = FrozenDate;
  }, FIXED_NOW);
}

// `siteVersion` usado na chave do cache de sessionStorage de `fetchSchedule()`
// (`br2026_schedule_${C.siteVersion}`). LIDO do config.js real, não hardcoded -- achado escrevendo
// este teste: uma string hardcoded aqui fica desatualizada no PRÓXIMO bump de versão (aconteceu
// literalmente nesta mesma tarefa, ao bumpar pra v1.138) e o pré-semeio do cache falha em
// silêncio, reintroduzindo a corrida que ele existe pra eliminar (ver seedScheduleCache).
const SITE_VERSION = (() => {
  const cfgSrc = readFileSync(join(ROOT, "bolao", "br2026", "js", "config.js"), "utf8");
  const m = cfgSrc.match(/siteVersion:\s*"([^"]+)"/);
  if (!m) throw new Error("siteVersion não encontrado em bolao/br2026/js/config.js");
  return m[1];
})();

/**
 * Pré-semeia `_schedule` via o cache de sessionStorage que `fetchSchedule()` já lê ANTES de ir à
 * rede (`br2026_schedule_${C.siteVersion}`). Achado depurando este teste (defeito do HARNESS, não
 * de produção): sem isto, o primeiro ciclo de poll ao vivo (`onLiveObservation`) roda numa
 * corrida real contra o fetch assíncrono de `fetchSchedule()` -- às vezes o overlay do gateway
 * roda ANTES de `_schedule` existir, não acha nenhuma linha pra casar por id, e não faz nada
 * naquele ciclo. Semear o cache síncrono elimina a corrida por completo (o app usa exatamente o
 * mesmo caminho que usaria com uma sessão recente de verdade), em vez de o teste depender de
 * adivinhar quantos ciclos de poll esperar.
 */
async function seedScheduleCache(context, entries) {
  await context.addInitScript(({ ts, cacheKey, events }) => {
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts, events }));
  }, { ts: FIXED_NOW, cacheKey: `br2026_schedule_${SITE_VERSION}`, events: entries });
}

/** Uma linha no formato FINAL de `_schedule` (o que `fetchSchedule()` produz depois de mapear o snapshot). */
function scheduleEntry({ id, offsetMs, homeTeam, awayTeam, state, homeScore, awayScore }) {
  return {
    id, dateISO: iso(offsetMs), state, detail: "", postponed: false,
    homeTeam, awayTeam, homeScore: homeScore ?? null, awayScore: awayScore ?? null,
    venue: "Estádio Fixture", city: "Cidade Fixture",
  };
}

/** Um evento no formato do snapshot ESPN normalizado (o que `data/espn-normalized.json` serve). */
function snapshotEvent({ id, offsetMs, homeTeam, awayTeam, state, completed, homeScore, awayScore, statusShortDetail }) {
  return {
    id, date: iso(offsetMs), state, statusName: state === "post" ? "STATUS_FULL_TIME" : "STATUS_SCHEDULED",
    statusDescription: state, statusShortDetail: statusShortDetail || "", statusDetail: statusShortDetail || "",
    completed: !!completed, homeTeam, awayTeam, homeTeamId: `${id}-h`, awayTeamId: `${id}-a`,
    homeScore: homeScore ?? null, awayScore: awayScore ?? null, homeWinner: null, awayWinner: null,
    venue: "Estádio Fixture", city: "Cidade Fixture", clockSec: null, clockStr: "", period: null, details: [],
  };
}

/** Um match no formato do gateway ao vivo (o que `functions/v1/live-football` serve). */
function gatewayMatch({ id, offsetMs, homeTeam, awayTeam, state, completed, homeScore, awayScore,
                         statusShortDetail, clockSec, clockStr }) {
  return {
    id, date: iso(offsetMs), state, statusName: state === "post" ? "STATUS_FULL_TIME" : "STATUS_IN_PROGRESS",
    statusShortDetail: statusShortDetail || "", statusDetail: statusShortDetail || "",
    completed: !!completed, postponed: false,
    homeTeam, awayTeam, homeScore: homeScore ?? null, awayScore: awayScore ?? null,
    clockSec: clockSec ?? null, clockStr: clockStr || "",
  };
}

/**
 * Intercepta as duas fontes. `snapshotEvents` sempre é servido (é o que `fetchSchedule()` lê
 * sempre). `gatewayBody` é servido quando fornecido; `null` simula `SOURCE_UNAVAILABLE`
 * (contrato real do gateway degradado — ver `validateGatewayBody`/`matches === null`).
 */
async function interceptar(context, { snapshotEvents, gatewayMatches }) {
  await context.route("**/data/espn-normalized.json*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      schemaVersion: 1, competitionId: "bra.1", provider: "espn",
      generatedAt: iso(0), sourceUpdatedAt: iso(0),
      stale: false, staleReason: null, payloadHash: "fixture", matches: snapshotEvents,
    }) });
  });
  await context.route("**/functions/v1/live-football*", async (route) => {
    if (gatewayMatches === null) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        schemaVersion: 1, competition: "br2026", provider: "espn", observedAt: null,
        servedAt: iso(0), ageSeconds: null, stale: true,
        staleReason: "UPSTREAM_403", status: "SOURCE_UNAVAILABLE", matches: null, freshness: "UNAVAILABLE",
      }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      schemaVersion: 1, competition: "br2026", provider: "espn", observedAt: iso(0),
      servedAt: iso(0), ageSeconds: 5, stale: false, staleReason: null,
      status: "OK", matches: gatewayMatches, freshness: "FRESH",
    }) });
  });
}

async function abrirPagina(browser, { snapshotEvents, gatewayMatches, scheduleCache }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
  for (const p of ["**://cdn.jsdelivr.net/**", "**://*.supabase.co/rest/**", "**://site.api.espn.com/**", "**://*.emailjs.com/**"]) {
    await context.route(p, r => r.abort());
  }
  await interceptar(context, { snapshotEvents, gatewayMatches });
  await freezeClock(context);
  await seedScheduleCache(context, scheduleCache);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "load", timeout: 20000 });
  // `_schedule` já vem pronto do cache semeado acima (ver seedScheduleCache) -- só falta o
  // overlay ao vivo rodar pelo menos uma vez (aplica applyLiveMatches() com os fixtures acima).
  await page.waitForTimeout(3000);
  return { context, page, errors };
}

const server = await startStaticServer(PORT, ROOT);
const browser = await launchChromium();

try {
  // ═══ CENÁRIO A — pre + in + post no mesmo dia, sem duplicar, cada um no estado certo ═══════
  {
    const idPre = "fixture-436-pre", idIn = "fixture-436-in", idPost = "fixture-436-post";
    const snapshotEvents = [
      snapshotEvent({ id: idPre, offsetMs: 2 * H, homeTeam: "Fixture FC Alpha", awayTeam: "Fixture FC Beta", state: "pre" }),
      // Snapshot estático ATRASADO de propósito (ainda "pre") -- o overlay ao vivo é quem corrige.
      snapshotEvent({ id: idIn, offsetMs: -48 * M, homeTeam: "Fixture FC Gama", awayTeam: "Fixture FC Delta", state: "pre" }),
      snapshotEvent({ id: idPost, offsetMs: -4 * H, homeTeam: "Fixture FC Epsilon", awayTeam: "Fixture FC Zeta", state: "pre" }),
    ];
    const gatewayMatches = [
      gatewayMatch({ id: idIn, offsetMs: -48 * M, homeTeam: "Fixture FC Gama", awayTeam: "Fixture FC Delta",
        state: "in", homeScore: 1, awayScore: 0, statusShortDetail: "63'", clockSec: 63 * 60, clockStr: "63'" }),
      gatewayMatch({ id: idPost, offsetMs: -4 * H, homeTeam: "Fixture FC Epsilon", awayTeam: "Fixture FC Zeta",
        state: "post", completed: true, homeScore: 2, awayScore: 1, statusShortDetail: "FT" }),
    ];
    const scheduleCache = [
      scheduleEntry({ id: idPre, offsetMs: 2 * H, homeTeam: "Fixture FC Alpha", awayTeam: "Fixture FC Beta", state: "pre" }),
      scheduleEntry({ id: idIn, offsetMs: -48 * M, homeTeam: "Fixture FC Gama", awayTeam: "Fixture FC Delta", state: "pre" }),
      scheduleEntry({ id: idPost, offsetMs: -4 * H, homeTeam: "Fixture FC Epsilon", awayTeam: "Fixture FC Zeta", state: "pre" }),
    ];

    const { context, page, errors } = await abrirPagina(browser, { snapshotEvents, gatewayMatches, scheduleCache });
    try {
      test("A: nenhum erro de página", () => assert(errors.length === 0, JSON.stringify(errors)));

      const dom = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        heroMatchIds: document.getElementById("liveMatchCard")?.dataset.heroMatchIds || "",
        liveScores: [...document.querySelectorAll(".live-score")].map(e => e.textContent.trim()),
        liveClocks: [...document.querySelectorAll(".live-clock")].map(e => e.textContent.trim()),
        todayGameBlocks: [...document.querySelectorAll(".today-game, .next-game-card")].map(e => e.textContent.replace(/\s+/g, " ").trim()),
      }));

      test("A/IN: card AO VIVO contém o jogo em andamento", () =>
        assert(dom.heroMatchIds.split(",").includes(idIn), `heroMatchIds=${dom.heroMatchIds}`));
      test("A/IN: placar 1 × 0 aparece no card ao vivo", () =>
        assert(dom.liveScores.includes("1") && dom.liveScores.includes("0"), JSON.stringify(dom.liveScores)));
      test("A/IN: minuto 63' aparece no card ao vivo", () =>
        assert(dom.liveClocks.some(c => c.includes("63")), JSON.stringify(dom.liveClocks)));
      test("A/IN: não duplica em 'Jogos de hoje' (Gama/Delta não aparece fora do card ao vivo)", () =>
        assert(!dom.todayGameBlocks.some(b => b.includes("Fixture FC Gama") && b.includes("Fixture FC Delta")),
          JSON.stringify(dom.todayGameBlocks)));

      test("A/POST: placar final 2 – 1 aparece em 'Jogos de hoje'", () =>
        assert(dom.todayGameBlocks.some(b => b.includes("Fixture FC Epsilon") && b.includes("2") && b.includes("1")),
          JSON.stringify(dom.todayGameBlocks)));
      test("A/POST: rótulo 'Encerrado' aparece para o jogo terminado", () =>
        assert(dom.todayGameBlocks.some(b => b.includes("Fixture FC Epsilon") && b.includes("Encerrado")),
          JSON.stringify(dom.todayGameBlocks)));

      test("A/PRE: contagem regressiva aparece para o jogo futuro (Alpha × Beta)", () =>
        assert(dom.todayGameBlocks.some(b => b.includes("Fixture FC Alpha")), JSON.stringify(dom.todayGameBlocks)));

      test("A: 'Em andamento' NUNCA aparece na página inteira", () =>
        assert(!dom.bodyText.includes("Em andamento"), dom.bodyText.slice(0, 2000)));
    } finally { await context.close(); }
  }

  // ═══ CENÁRIO B — post SEM confirmação (a reprodução exata do defeito #436) ══════════════════
  {
    const idStale = "fixture-436-stale";
    // Snapshot estático nunca resincronizado -- ainda "pre", 4h depois do kickoff.
    const snapshotEvents = [
      snapshotEvent({ id: idStale, offsetMs: -4 * H, homeTeam: "Fixture FC Bahia", awayTeam: "Fixture FC Remo", state: "pre" }),
    ];
    const scheduleCache = [
      scheduleEntry({ id: idStale, offsetMs: -4 * H, homeTeam: "Fixture FC Bahia", awayTeam: "Fixture FC Remo", state: "pre" }),
    ];
    // Gateway indisponível -- exatamente o que acontece quando o produtor sai da janela de
    // rastreio (WINDOW_LOOKBACK_MS). O overlay NUNCA roda (matches === null), então
    // `_schedule[idx].state` fica travado em "pre" para sempre nesta sessão.
    const { context, page, errors } = await abrirPagina(browser, { snapshotEvents, gatewayMatches: null, scheduleCache });
    try {
      test("B: nenhum erro de página com gateway indisponível", () => assert(errors.length === 0, JSON.stringify(errors)));

      const dom = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        heroMatchIds: document.getElementById("liveMatchCard")?.dataset.heroMatchIds || "",
        todayGameBlocks: [...document.querySelectorAll(".today-game, .next-game-card")].map(e => e.textContent.replace(/\s+/g, " ").trim()),
      }));

      test("B: 'Em andamento' NÃO aparece (era exatamente o defeito relatado)", () =>
        assert(!dom.bodyText.includes("Em andamento"), dom.bodyText.slice(0, 2000)));
      test("B: nenhum placar inventado (nem '2 – 1', nem '0 – 0') para o jogo sem confirmação", () =>
        assert(!dom.todayGameBlocks.some(b => b.includes("Fixture FC Bahia") && /\d\s*[–-]\s*\d/.test(b)),
          JSON.stringify(dom.todayGameBlocks)));
      test("B: estado neutro 'Resultado aguardando confirmação' aparece para o jogo sem confirmação", () =>
        assert(dom.todayGameBlocks.some(b => b.includes("Fixture FC Bahia") && b.includes("Resultado aguardando confirmação")),
          JSON.stringify(dom.todayGameBlocks)));
      test("B: card AO VIVO não afirma esse jogo como ao vivo (post não é live)", () =>
        assert(!dom.heroMatchIds.split(",").includes(idStale), `heroMatchIds=${dom.heroMatchIds}`));
    } finally { await context.close(); }
  }

  // ═══ CENÁRIO C — jogo futuro não regride (contrato de pre preservado) ═══════════════════════
  {
    const idFuturo = "fixture-436-futuro";
    const snapshotEvents = [
      snapshotEvent({ id: idFuturo, offsetMs: 3 * H, homeTeam: "Fixture FC Norte", awayTeam: "Fixture FC Sul", state: "pre" }),
    ];
    const scheduleCache = [
      scheduleEntry({ id: idFuturo, offsetMs: 3 * H, homeTeam: "Fixture FC Norte", awayTeam: "Fixture FC Sul", state: "pre" }),
    ];
    const { context, page, errors } = await abrirPagina(browser, { snapshotEvents, gatewayMatches: [], scheduleCache });
    try {
      test("C: nenhum erro de página", () => assert(errors.length === 0, JSON.stringify(errors)));
      const dom = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        countGrid: !!document.querySelector(".count-grid"),
      }));
      test("C: jogo futuro mostra contador (não regrediu)", () => assert(dom.countGrid, "sem .count-grid na página"));
      test("C: 'Em andamento' não aparece para jogo futuro", () => assert(!dom.bodyText.includes("Em andamento"), dom.bodyText.slice(0, 500)));
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  server.stop();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ BR2026 POST-MATCH STATE TRANSITION OK" : "✗ BR2026 POST-MATCH STATE TRANSITION FAILED");
process.exit(fail === 0 ? 0 : 1);
