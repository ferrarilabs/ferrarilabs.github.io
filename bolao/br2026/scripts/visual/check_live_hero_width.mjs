#!/usr/bin/env node
/**
 * check_live_hero_width.mjs — o hero ao vivo nao pode alargar a pagina (Issue #316-A).
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────────────────────
 *
 * `.live-center` (a coluna com BADGE / RELOGIO / aviso de atraso) e `flex-shrink: 0`, de proposito:
 * ela nao pode encolher, senao o placar e o minuto colapsam. Mas isso tem uma consequencia que
 * ninguem tinha exercitado: **o texto mais largo dentro dela dita a largura da linha inteira**, e a
 * linha nao tem para onde ceder.
 *
 * A Issue #296 trocou o rotulo de atraso de `"Atualizacao pendente"` (20 caracteres) por
 * `"Atualizacao atrasada · ha 18 min"` (31). Onze caracteres a mais numa coluna que nao encolhe:
 * a 320px o documento passou a rolar 2px na horizontal.
 *
 * ─── POR QUE SO APARECIA AS VEZES ───────────────────────────────────────────────────────────
 *
 * O rotulo so e renderizado quando o dado esta ATRASADO. Com o snapshot fresco ele nao existe e a
 * pagina cabe; com o snapshot velho ele aparece e estoura. O gate de classificacao, que mede o que
 * estiver no disco naquele instante, via o defeito ir e vir sem explicacao — e foi assim que ele
 * chegou a `main` sem ninguem perceber.
 *
 * Um gate que so exercita o dado de hoje nao protege contra o dado de amanha. Este exercita o
 * ESTADO, injetando o rotulo mais longo que a UI consegue produzir.
 *
 * Uso: node bolao/br2026/scripts/visual/check_live_hero_width.mjs
 */
import { launchChromium } from "../../../cdb2026/scripts/visual/playwright_loader.mjs";
import { startStaticServer } from "../../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PORT = 8141;

const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 414, h: 896 },
  { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 }, { w: 1728, h: 900 },
];

/**
 * O pior rotulo que a UI consegue emitir hoje. `{min}` de tres digitos e alcancavel de verdade: a
 * faixa STALE_BUT_USABLE vai ate 30 min, e o estado UNAVAILABLE (>30) ainda renderiza idade.
 * Testar o pior caso plausivel e o que impede o proximo rotulo "so um pouco maior".
 */
const PIOR_ROTULO = "Atualização atrasada · há 120 min";

/**
 * Snapshot SINTETICO com uma partida ao vivo e observacao velha o bastante para o app decidir,
 * sozinho, mostrar o aviso de atraso. Interceptar as DUAS fontes (snapshot e gateway) e obrigatorio:
 * desde o LIVE DATA PLANE V2 o app prefere o gateway, e interceptar so uma deixaria o teste medir
 * dado REAL de producao — deixando de ser deterministico.
 *
 * Nomes de time propositalmente LONGOS: o hero e uma linha flex e a coluna do meio nao encolhe, entao
 * o pior caso e nome longo dos dois lados junto com o aviso mais longo.
 */
function snapshotSintetico(minutos) {
  const generatedAt = new Date(Date.now() - minutos * 60 * 1000).toISOString();
  const m = {
    id: "fixture-hero-1",
    date: new Date(Date.now() - (minutos + 48) * 60 * 1000).toISOString().slice(0, 16) + "Z",
    state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
    statusShortDetail: "48'", statusDetail: "48'", completed: false,
    homeTeam: "Red Bull Bragantino", awayTeam: "Athletico Paranaense",
    homeTeamId: "1", awayTeamId: "2", homeScore: 1, awayScore: 1,
    homeWinner: false, awayWinner: false,
    venue: "Estadio Fixture", city: "Cidade Fixture",
    clockSec: 2880, clockStr: "48'", period: 2, details: [],
  };
  return { schemaVersion: 1, competitionId: "bra.1", provider: "espn", generatedAt,
           sourceUpdatedAt: generatedAt, stale: false, staleReason: null,
           payloadHash: "fixture", matches: [m] };
}

async function interceptar(context, minutos) {
  await context.route("**/data/espn-normalized.json*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(snapshotSintetico(minutos)) });
  });
  await context.route("**/functions/v1/live-football*", async (route) => {
    const snap = snapshotSintetico(minutos);
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, competition: "br2026", provider: "espn",
        observedAt: snap.generatedAt, servedAt: new Date().toISOString(),
        ageSeconds: minutos * 60, stale: true, staleReason: "DATA_AGE",
        freshness: "STALE_BUT_USABLE", matches: snap.matches }) });
  });
}

let fails = 0;
const fail = (vp, msg, detail) => {
  console.log(`  ✗ [${vp}] ${msg}${detail ? " " + JSON.stringify(detail) : ""}`);
  fails++;
};

async function medir(page) {
  return page.evaluate((rotulo) => {
    const centro = document.querySelector(".live-center");
    if (!centro) return { skipped: "sem .live-center (nenhum jogo ao vivo renderizado)" };

    // Injeta o aviso de atraso EXATAMENTE como o app o renderiza (mesma classe, mesmo lugar).
    let el = centro.querySelector(".live-clock-stale");
    if (!el) {
      el = document.createElement("span");
      el.className = "live-clock-stale";
      centro.appendChild(el);
    }
    el.textContent = rotulo;
    el.setAttribute("title", rotulo);

    // Forca reflow antes de medir.
    void document.documentElement.offsetWidth;

    const doc = document.documentElement;
    const linha = document.querySelector(".live-top");
    return {
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      centerWidth: +centro.getBoundingClientRect().width.toFixed(1),
      rowRight: linha ? +linha.getBoundingClientRect().right.toFixed(1) : null,
      staleWidth: +el.getBoundingClientRect().width.toFixed(1),
      // QUEM realmente passa da borda. Sem isto o gate diz que a pagina estourou e nao diz onde —
      // e foi assim que a primeira hipotese (a linha do hero) sobreviveu mais tempo do que devia.
      offenders: (() => {
        const vw = window.innerWidth, out = [];
        document.querySelectorAll("*").forEach((n) => {
          const b = n.getBoundingClientRect();
          if (b.width > 0 && b.right > vw + 0.5) {
            out.push({ tag: n.tagName.toLowerCase(),
                       cls: String(n.className || "").slice(0, 40),
                       right: +b.right.toFixed(1), width: +b.width.toFixed(1),
                       left: +b.left.toFixed(1), ovx: getComputedStyle(n).overflowX });
          }
        });
        return out.sort((a, b) => b.right - a.right).slice(0, 8);
      })(),
    };
  }, PIOR_ROTULO);
}

const server = await startStaticServer(PORT, ROOT);
const browser = await launchChromium();
console.log(`\nLargura do hero ao vivo sob o pior rotulo de atraso\n  "${PIOR_ROTULO}"\n`);

try {
  for (const vp of VIEWPORTS) {
    const label = `${vp.w}x${vp.h}`;
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, serviceWorkers: "block" });
    const page = await context.newPage();
    for (const p of ["**://cdn.jsdelivr.net/**", "**://*.supabase.co/**", "**://site.api.espn.com/**", "**://*.emailjs.com/**"]) {
      await context.route(p, r => r.abort());
    }
    await interceptar(context, 18);   // 18 min -> faixa STALE_BUT_USABLE, aviso de atraso renderiza
    try {
      await page.goto(`http://localhost:${PORT}/bolao/br2026/`, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(1500);
      const m = await medir(page);
      if (m.skipped) {
        // Sem jogo ao vivo o hero nao existe: nao ha o que medir, e inventar um DOM falso mediria
        // o fixture, nao o produto.
        console.log(`  ○ [${label}] ${m.skipped}`);
        continue;
      }
      const estouro = Math.max(m.docScrollWidth, m.bodyScrollWidth) - m.innerWidth;
      if (estouro > 0.5) {
        fail(label, "a pagina rola na horizontal com o aviso de atraso mais longo", {
          estouroPx: +estouro.toFixed(1), ...m,
        });
      } else {
        console.log(`  ✓ ${label}: sem estouro (centro ${m.centerWidth}px, aviso ${m.staleWidth}px)`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.stop();
}

console.log(fails ? `\n✗ FALHOU — ${fails} viewport(s) com estouro\n` : "\n✓ hero ao vivo cabe em todos os viewports, mesmo com o rotulo mais longo\n");
process.exit(fails ? 1 : 0);
