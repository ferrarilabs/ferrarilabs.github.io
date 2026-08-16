#!/usr/bin/env node
/**
 * BR2026 — o hero com vários jogos simultâneos é legível e não estoura a página.
 *
 * Mede GEOMETRIA REAL no navegador, não a folha de estilo: em 1/2/3 jogos ao vivo, nas quatro
 * larguras da matriz responsiva do repositório. `.live-match-grid` é `flex-wrap`, então em tela
 * estreita os cards empilham (scroll vertical), e em tela larga ficam lado a lado — não há
 * carrossel, e por isso não existe "jogo escondido atrás do primeiro".
 *
 * Nada de rede real, nenhum e-mail, nenhum palpite tocado.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const PORT = 8294;   // único: ver bolao/scripts/test_harness_ports_unique.mjs

const VIEWPORTS = [
  { nome: "1440x900",  width: 1440, height: 900 },
  { nome: "1024x768",  width: 1024, height: 768 },
  { nome: "768x1024",  width: 768,  height: 1024 },
  { nome: "390x844",   width: 390,  height: 844 },
];

let pass = 0, fail = 0;
const test = (n, ok, extra = "") => {
  if (ok) { console.log(`    ✓ ${n}`); pass++; }
  else { console.log(`    ✗ ${n}${extra ? `\n        ${extra}` : ""}`); fail++; }
};

const APP = readFileSync(join(RAIZ, "bolao/br2026/js/app.js"), "utf8");
const CLUBES = [["Palmeiras", "Santos"], ["Grêmio", "Internacional"], ["Vasco", "Flamengo"]];

function snapshot(nLive) {
  const agora = new Date().toISOString();
  const matches = [];
  for (let i = 0; i < nLive; i++) {
    const [home, away] = CLUBES[i];
    matches.push({
      id: `live-${i + 1}`, date: new Date(Date.UTC(2026, 7, 16, 20 + i, 0, 0)).toISOString(),
      state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
      statusShortDetail: `${30 + i}'`, statusDetail: `${30 + i}'`, completed: false,
      clockSec: (30 + i) * 60, period: 1, clockStr: `${30 + i}'`,
      homeTeam: home, awayTeam: away, homeTeamId: `h${i}`, awayTeamId: `a${i}`,
      homeScore: i, awayScore: 1, venue: "Estádio", city: "Cidade", details: [],
    });
  }
  return {
    schemaVersion: 1, competition: "br2026", competitionId: "br2026", provider: "test",
    observedAt: agora, generatedAt: agora, sourceUpdatedAt: agora,
    stale: false, staleReason: null, payloadHash: `resp-${nLive}`, matches,
  };
}

const ESTADO = { entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {} };

async function main() {
  const srv = await startStaticServer(PORT, RAIZ);
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n  ${vp.nome}`);
      for (const n of [1, 2, 3]) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await ctx.newPage();
        await page.route("**/js/app.js*", r =>
          r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: APP }));
        await page.route("**/rest/v1/**", r =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ state: ESTADO }]) }));
        const corpo = JSON.stringify(snapshot(n));
        await page.route("**/functions/v1/**", r =>
          r.fulfill({ status: 200, contentType: "application/json", body: corpo }));
        await page.route("**/*espn*", r =>
          r.fulfill({ status: 200, contentType: "application/json", body: corpo }));
        await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);

        const m = await page.evaluate(() => {
          const card = document.getElementById("liveMatchCard");
          const nós = card ? [...card.querySelectorAll(".live-match")] : [];
          const r = nós.map(el => {
            const b = el.getBoundingClientRect();
            const placar = [...el.querySelectorAll(".live-score")].map(x => x.textContent.trim());
            const relogio = el.querySelector(".live-clock");
            return {
              x: b.x, y: b.y, w: b.width, h: b.height,
              placarVisivel: placar.length === 2 && placar.every(p => p.length > 0),
              relogioVisivel: !!relogio && relogio.getBoundingClientRect().width > 0,
              nomesVisiveis: [...el.querySelectorAll(".live-team-name")]
                .every(x => x.getBoundingClientRect().width > 0),
            };
          });
          return {
            cards: r,
            docW: document.documentElement.scrollWidth,
            viewW: document.documentElement.clientWidth,
            cardH: card ? card.getBoundingClientRect().height : 0,
            viewH: window.innerHeight,
          };
        });

        test(`${n} ao vivo: ${n} card(s) desenhados`, m.cards.length === n, `${m.cards.length}`);
        test(`${n} ao vivo: sem overflow horizontal da PÁGINA`,
             m.docW <= m.viewW + 1, `scrollWidth=${m.docW} clientWidth=${m.viewW}`);
        test(`${n} ao vivo: nenhum card cortado à direita`,
             m.cards.every(c => c.x + c.w <= m.viewW + 1),
             m.cards.map(c => `${Math.round(c.x)}+${Math.round(c.w)}`).join(" | "));
        test(`${n} ao vivo: placar, relógio e nomes visíveis em todos`,
             m.cards.every(c => c.placarVisivel && c.relogioVisivel && c.nomesVisiveis));
        // Sobreposição: dois cards não podem ocupar a mesma região.
        let sobrepoe = false;
        for (let i = 0; i < m.cards.length; i++) {
          for (let j = i + 1; j < m.cards.length; j++) {
            const a = m.cards[i], b = m.cards[j];
            if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) sobrepoe = true;
          }
        }
        test(`${n} ao vivo: sem sobreposição entre cards`, !sobrepoe);
        // O hero não pode virar um bloco de altura de página inteira.
        test(`${n} ao vivo: hero não domina a viewport (<= 85% da altura)`,
             m.cardH <= m.viewH * 0.85, `hero=${Math.round(m.cardH)}px view=${m.viewH}px`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail) { console.log("\n✗ MULTI LIVE HERO RESPONSIVE FAILED\n"); process.exit(1); }
  console.log("\n✓ MULTI LIVE HERO RESPONSIVE PASSED\n");
}

main();
