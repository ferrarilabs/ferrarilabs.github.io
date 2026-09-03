#!/usr/bin/env node
/**
 * BR2026 — o hero ao vivo representa TODOS os jogos simultâneos.
 *
 * O DEFEITO (2026-08-16)
 * ----------------------
 * Numa rodada com dois ou três jogos ao mesmo tempo, o hero mostrava UM.
 *
 * Causa: `5b66389e` ("hero ao vivo sobrevive a falha transitória da fonte") introduziu a camada
 * de retenção. `resolveFeaturedMatchState()` é, por contrato, de UMA partida — recebe `observed`
 * e devolve `match`. Para encaixar, o seletor passou a ser `_liveMatches[0]` e o resultado voltou
 * embrulhado em `[resolved.match]`.
 *
 * O renderizador NUNCA foi de uma partida só: `heroMatches.map(...)`, o cabeçalho
 * `heroMatches.length > 1`, a chave i18n `liveMatchesLabel` e o `.live-match-grid` (flex-wrap) já
 * estavam lá. Uma correção de robustez estreitou a entrada de um renderizador multi.
 *
 * O QUE ESTE TESTE MEDE
 * ---------------------
 * O app REAL, num navegador REAL, com a rota do Supabase e do snapshot interceptadas. Compara as
 * IDENTIDADES das partidas no DOM com as identidades dos dados — contar cards deixaria o teste
 * passar com o card errado repetido N vezes.
 *
 * Nada de rede real, nenhum e-mail, nenhum palpite tocado.
 *
 * Uso:
 *   node audit_multi_live_hero.mjs            suíte inteira
 *   node audit_multi_live_hero.mjs --mutate   reintroduz `_liveMatches[0]` e exige VERMELHO
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const PORT = 8293;   // único: ver bolao/scripts/test_harness_ports_unique.mjs
const MUTAR = process.argv.includes("--mutate");

let pass = 0, fail = 0;
const test = (n, ok, extra = "") => {
  if (ok) { console.log(`  ✓ ${n}`); pass++; }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ""}`); fail++; }
};

const APP_PATH = join(RAIZ, "bolao/br2026/js/app.js");
const APP_SRC = readFileSync(APP_PATH, "utf8");

// A MUTAÇÃO: volta o seletor de primeiro-jogo-só. Tem de ser encontrada — patch que não aplica
// mediria o código original e passaria verde por engano.
const ALVO_MUTACAO = "  const resolved = resolveLiveHeroMatches();\n  const entradas = resolved.matches;";
const MUTACAO = "  const resolved = resolveLiveHeroMatches();\n"
  + "  const entradas = resolved.matches.slice(0, 1);";
if (MUTAR && !APP_SRC.includes(ALVO_MUTACAO)) {
  console.error("MUTAÇÃO NÃO APLICÁVEL — padrão ausente em app.js; o teste mediria o original");
  process.exit(2);
}
const APP = MUTAR ? APP_SRC.replace(ALVO_MUTACAO, MUTACAO) : APP_SRC;

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
// Apitos RELATIVOS ao agora, nao uma data fixa de agosto/2026.
//
// Motivo (incidente 2026-09-02/03): `KICKOFF_LIVE_HORIZON_MS` passou a recusar a afirmacao "ao
// vivo" quando o apito ficou para tras alem de 4 h -- defesa contra produtor preso em "in". Com
// data fixa, estas fixtures descreviam um jogo que comecou HA DIAS e seguia ao vivo com
// observacao fresca: exatamente o cenario implausivel que o guard existe para recusar. O gate
// reprovava por fixture irreal, nao por defeito de produto.
//
// As ASSERCOES nao mudaram; so o apito virou plausivel (~1 h atras, jogo em andamento).
const AGORA_FIXTURE = Date.now();
const apitoHa = (min) => new Date(AGORA_FIXTURE - min * 60_000).toISOString();

const CLUBES = [
  ["Palmeiras", "Santos"], ["Grêmio", "Internacional"],
  ["Vasco", "Flamengo"], ["Cruzeiro", "Atlético-MG"],
];

/**
 * Snapshot no formato que `snapshotEventsToEspnShape` consome. Ordem EMBARALHADA de propósito.
 *
 * `jaVistos` são jogos que JÁ estiveram ao vivo nesta sessão e agora saíram do conjunto. Eles
 * entram como FINAL, não são omitidos: omitir dispararia a RETENÇÃO (que mantém no ar por 15 min
 * um jogo sumido do snapshot) e o teste reprovaria um comportamento correto e desejado. A única
 * forma legítima de o hero soltar uma partida antes do TTL é a fonte declarar o terminal.
 */
function snapshot(nLive, { extraFinal = true, jaVistos = 0 } = {}) {
  const matches = [];
  for (let i = 0; i < nLive; i++) {
    const [home, away] = CLUBES[i];
    matches.push({
      id: `live-${i + 1}`,
      // Cronologia DECRESCENTE em relação ao índice: o primeiro do array é o que começou por
      // ÚLTIMO. Se a ordem do hero seguisse a resposta da fonte, o teste de ordem falharia.
      date: apitoHa(60 + i * 10),
      state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
      statusShortDetail: `${20 + i}'`, statusDetail: `${20 + i}'`, completed: false,
      clockSec: (20 + i) * 60, period: 1, clockStr: `${20 + i}'`,
      homeTeam: home, awayTeam: away, homeTeamId: `h${i}`, awayTeamId: `a${i}`,
      homeScore: i, awayScore: 0, venue: "Estádio", city: "Cidade", details: [],
    });
  }
  for (let i = nLive; i < jaVistos; i++) {
    const [home, away] = CLUBES[i];
    matches.push({
      id: `live-${i + 1}`,
      date: apitoHa(60 + i * 10),
      state: "post", statusName: "STATUS_FINAL", statusDescription: "Final",
      statusShortDetail: "FT", statusDetail: "FT", completed: true,
      clockSec: 5400, period: 2, clockStr: "90'",
      homeTeam: home, awayTeam: away, homeTeamId: `h${i}`, awayTeamId: `a${i}`,
      homeScore: i, awayScore: 0, venue: "Estádio", city: "Cidade", details: [],
    });
  }
  if (extraFinal) {
    // Um jogo ENCERRADO no mesmo payload: o hero não pode mostrá-lo, e um teste que só conta
    // cards não perceberia se ele entrasse.
    matches.push({
      id: "final-1", date: apitoHa(200),
      state: "post", statusName: "STATUS_FINAL", statusDescription: "Final",
      statusShortDetail: "FT", statusDetail: "FT", completed: true,
      clockSec: 5400, period: 2, clockStr: "90'",
      homeTeam: "Bahia", awayTeam: "Fortaleza", homeTeamId: "hb", awayTeamId: "af",
      homeScore: 1, awayScore: 1, venue: "Estádio", city: "Cidade", details: [],
    });
  }
  // Satisfaz os DOIS consumidores: `validateGatewayBody` (exige `schemaVersion:1` e
  // `observedAt`) e o caminho do snapshot commitado (`generatedAt`/`sourceUpdatedAt`/`stale`).
  // Faltando `schemaVersion` o corpo era rejeitado com SCHEMA_NAO_SUPORTADO_undefined e o hero
  // nunca aparecia — o teste reprovava por fixture inválida, não por defeito do produto.
  const agora = new Date().toISOString();
  return {
    schemaVersion: 1, competition: "br2026", competitionId: "br2026", provider: "test",
    observedAt: agora, generatedAt: agora, sourceUpdatedAt: agora,
    stale: false, staleReason: null, payloadHash: `test-${nLive}-${jaVistos}`,
    matches,
  };
}

const ESTADO = { entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {} };

async function comApp(page, getSnap) {
  await page.route("**/js/app.js*", r =>
    r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: APP }));
  await page.route("**/rest/v1/**", r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ state: ESTADO }]) }));
  await page.route("**/functions/v1/**", r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(getSnap()) }));
  await page.route("**/*espn*", r =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(getSnap()) }));
}

/** Identidades REAIS no hero: um id por card, lido do DOM. */
async function idsNoHero(page) {
  return page.evaluate(() => {
    const card = document.getElementById("liveMatchCard");
    if (!card || card.classList.contains("hidden")) return [];
    return (card.dataset.heroMatchIds || "").split(",").filter(Boolean);
  });
}

async function cardsNoHero(page) {
  return page.evaluate(() => {
    const card = document.getElementById("liveMatchCard");
    if (!card || card.classList.contains("hidden")) return { n: 0, times: [] };
    const nós = [...card.querySelectorAll(".live-match")];
    return {
      n: nós.length,
      times: nós.map(el => [...el.querySelectorAll(".live-team-name")].map(x => x.textContent.trim()).join(" x ")),
      count: card.dataset.heroLiveCount,
      hidden: false,
    };
  });
}

async function main() {
  const srv = await startStaticServer(PORT, RAIZ);
  const browser = await chromium.launch();
  try {
    // ══ 7. sem limite silencioso: 0..4 simultâneos ═════════════════════════════════════════
    console.log(`\n1. LIVE_MATCH_RENDER_COUNT == LIVE_MATCH_DATA_COUNT${MUTAR ? "  [MUTADO]" : ""}`);
    for (const n of [0, 1, 2, 3, 4]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await comApp(page, () => snapshot(n));
      await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      const ids = await idsNoHero(page);
      const dom = await cardsNoHero(page);
      // COBERTURA de identidade, comparada como CONJUNTO. A ORDEM é assunto do bloco 2 — a
      // fixture usa cronologia decrescente de propósito, então exigir a ordem da fonte aqui
      // reprovaria justamente o comportamento correto (ordenar por kickoff ascendente).
      const esperados = Array.from({ length: n }, (_, i) => `live-${i + 1}`).sort();
      test(`${n} ao vivo -> hero representa exatamente ${n}`,
           JSON.stringify([...ids].sort()) === JSON.stringify(esperados) && dom.n === n,
           `ids=${JSON.stringify(ids)} esperado=${JSON.stringify(esperados)} cards=${dom.n}`);
      if (n > 0) {
        test(`  ${n} ao vivo -> o jogo ENCERRADO não entra no hero`, !ids.includes("final-1"),
             JSON.stringify(ids));
      }
      await ctx.close();
    }

    // ══ 4. ordem determinística ════════════════════════════════════════════════════════════
    console.log("\n2. DETERMINISTIC_ORDER — cronologia, não a ordem da fonte");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await comApp(page, () => snapshot(3));
      await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      const ids = await idsNoHero(page);
      // A fonte devolveu live-1 (22h), live-2 (21h), live-3 (20h). Kickoff ASCENDENTE inverte.
      test("ordena por kickoff ascendente, invertendo a ordem da fonte",
           JSON.stringify(ids) === JSON.stringify(["live-3", "live-2", "live-1"]),
           JSON.stringify(ids));
      await ctx.close();
    }

    // ══ 8. transições sem card fantasma nem duplicado ══════════════════════════════════════
    console.log("\n3. STALE_LIVE_CARDS = 0 · DUPLICATE_LIVE_CARDS = 0");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      let n = 0, maxVisto = 0;
      await comApp(page, () => snapshot(n, { jaVistos: maxVisto }));
      await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "networkidle" });

      for (const alvo of [1, 2, 3, 2, 1, 0]) {
        const antes = n;
        maxVisto = Math.max(maxVisto, n);
        n = alvo;
        // `window.focus` dispara `resumeLivePolling()` -> `_liveStore.refresh()` (app.js:3818):
        // é o caminho de atualização REAL do produto, não um atalho de teste.
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.waitForTimeout(900);
        const ids = await idsNoHero(page);
        const dom = await cardsNoHero(page);
        const dup = ids.length !== new Set(ids).size;
        const esperados = Array.from({ length: alvo }, (_, i) => `live-${i + 1}`).sort();
        test(`  ${antes} -> ${alvo} ao vivo: identidades exatas (sem fantasma)`,
             JSON.stringify([...ids].sort()) === JSON.stringify(esperados),
             `ids=${JSON.stringify(ids)} esperado=${JSON.stringify(esperados)}`);
        test(`  ${antes} -> ${alvo} ao vivo: sem duplicado`, !dup, JSON.stringify(ids));
        test(`  ${antes} -> ${alvo} ao vivo: DOM e dataset concordam`,
             dom.n === ids.length, `cards=${dom.n} ids=${ids.length}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (MUTAR) {
    // Sob mutação a suíte TEM de reprovar. Verde aqui significa portão inútil.
    if (fail === 0) {
      console.log("\n✗ MUTAÇÃO NÃO PEGA — o portão não é load-bearing\n");
      process.exit(1);
    }
    console.log(`\n✓ MULTI_LIVE_MUTATION_CAUGHT = YES (${fail} asserções vermelhas)\n`);
    process.exit(0);
  }
  if (fail) { console.log("\n✗ MULTI LIVE HERO FAILED\n"); process.exit(1); }
  console.log("\n✓ MULTI LIVE HERO PASSED\n");
}

main();
