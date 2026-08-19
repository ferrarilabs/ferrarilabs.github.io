#!/usr/bin/env node
/**
 * audit_responsive_matrix.mjs — matriz de 14 larguras, todos os apps.
 *
 * ─── POR QUE 14 E NÃO 8 ──────────────────────────────────────────────────────────────────────
 *
 * A cobertura anterior parava em 8 larguras e ficou registrada como dívida aprovada. As que
 * faltavam não eram arbitrárias: 393 é o Pixel 8 / iPhone 15, 414 é a família iPhone Plus, e
 * 899/900/901/902 cercam um breakpoint real do design system — bugs de layout moram exatamente
 * na fronteira, não no meio da faixa.
 *
 * ─── O QUE ISTO MEDE, E O QUE NÃO ────────────────────────────────────────────────────────────
 *
 * Mede GEOMETRIA REAL do DOM renderizado: transbordo horizontal, controle cortado pelo próprio
 * container, altura de barra de probabilidade, distância medida entre nome e porcentagem, e se
 * data/hora foi parar na posição do placar. Não mede "a página carregou" — uma página em branco
 * passa nesse critério, e foi assim que regressões de layout sobreviveram a suítes verdes aqui.
 *
 * Os apps são exercitados com fixture determinística nas duas fontes ao vivo. Sem isso a suíte
 * mediria o jogo real de produção e mudaria de resultado conforme o dia.
 *
 * Uso: node bolao/scripts/audit_responsive_matrix.mjs
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStaticServer } from "./static_server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4611;

// Override explícito e determinístico da porta efetiva — nunca porta aleatória. Ausente (caso
// padrão) => comportamento idêntico a antes: EFFECTIVE_PORT === PORT. Existe só para permitir uma
// segunda instância isolada (ex.: worktree paralela de mutação) coexistir com a instância padrão
// sem colidir. `const PORT = 4611` acima fica intocado de propósito: é o que
// test_harness_ports_unique.mjs escaneia estaticamente, e reescrevê-lo tornaria este arquivo
// invisível para aquele gate.
const PORT_OVERRIDE = process.env.RESPONSIVE_MATRIX_PORT;
if (PORT_OVERRIDE !== undefined && (!/^\d+$/.test(PORT_OVERRIDE) || Number(PORT_OVERRIDE) === 0)) {
  throw new Error(`RESPONSIVE_MATRIX_PORT inválido: "${PORT_OVERRIDE}" (esperado inteiro positivo)`);
}
const EFFECTIVE_PORT = PORT_OVERRIDE ? Number(PORT_OVERRIDE) : PORT;

const WIDTHS = [320, 360, 375, 390, 393, 414, 430, 768, 899, 900, 901, 902, 1024, 1280];

/**
 * Folga mínima exigida do rótulo de navegação, como fração da largura do próprio texto.
 *
 * 12% tem piso e teto MEDIDOS, não é um número de gosto.
 *
 * O piso vem do defeito: a navegação rodava com 1,8% de folga a 320px e aparecia cortada fora do
 * macOS. O teto vem do que este layout consegue entregar — com a fonte real do runner (medida em
 * ~13,1% mais larga que a do macOS, ver `responsive.css`), o ponto mais apertado do estado
 * corrigido fica em ~15,7%. Um limite de 15% passaria a 0,7 ponto da borda: qualquer variação de
 * fonte entre versões do runner viraria vermelho, e vermelho por variação legítima é o que ensina
 * a ignorar vermelho.
 *
 * 12% fica a ~6,7× do nível do defeito e a ~3,7 pontos do pior caso corrigido — longe dos dois.
 * A mutação M25 (voltar ao aperto antigo) continua sendo PEGA, que é a prova de que o limite não
 * foi afrouxado até deixar de morder.
 */
const FOLGA_MINIMA_NAV = 0.12;

const APPS = [
  { nome: "br2026", url: "/bolao/br2026/", live: true },
  { nome: "cdb2026", url: "/bolao/cdb2026/", live: true },
  { nome: "copa2026", url: "/bolao/copa2026/", live: false, arquivado: true },
  { nome: "powerball", url: "/bolao/loterias/powerball/", live: false },
];

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else { failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

function fixtureMatch() {
  const agora = new Date(Date.now() - 48 * 60000);
  return {
    id: "900001",
    date: agora.toISOString().slice(0, 16) + "Z",
    state: "in", statusName: "STATUS_IN_PROGRESS", statusDescription: "In Progress",
    statusShortDetail: "48'", statusDetail: "48'", completed: false,
    homeTeam: "Atlético Mineiro Clube", awayTeam: "Red Bull Bragantino",
    homeTeamId: "1", awayTeamId: "2",
    homeScore: 2, awayScore: 1, homeWinner: false, awayWinner: false,
    venue: "Arena", city: "Cidade",
    clockSec: 2880, clockStr: "48'", period: 1, details: [],
  };
}

const pw = await import("playwright");
const server = await startStaticServer(EFFECTIVE_PORT, ROOT);
const browser = await pw.chromium.launch();

async function abrir(app, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  if (app.live) {
    const m = fixtureMatch();
    const observedAt = new Date(Date.now() - 60000).toISOString();
    await page.route("**/data/espn-normalized.json*", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, generatedAt: observedAt, matches: [m] }) }));
    await page.route("**/functions/v1/live-football*", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, competition: app.nome, observedAt,
                             stale: false, matches: [m] }) }));
  }
  await page.goto(`http://localhost:${EFFECTIVE_PORT}${app.url}`, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  return { ctx, page };
}

console.log(`RESPONSIVE_MATRIX — ${WIDTHS.length} larguras × ${APPS.length} apps\n`);

for (const app of APPS) {
  process.stdout.write(`${app.nome}: `);
  for (const width of WIDTHS) {
    const { ctx, page } = await abrir(app, width);
    const tag = `[${app.nome} @ ${width}px]`;
    try {
      // 1. A página tem conteúdo. Sem isto, tudo abaixo passaria numa página em branco.
      const conteudo = await page.evaluate(() =>
        (document.querySelector("main")?.innerText || "").trim().length);
      check(`${tag} a página renderizou conteúdo`, conteudo > 50, `${conteudo} caracteres`);

      // 2. Transbordo horizontal da página.
      const over = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      check(`${tag} sem transbordo horizontal`, over.scroll <= over.client + 1,
        `scrollWidth=${over.scroll} > clientWidth=${over.client}`);

      // 3. Nenhum elemento visível ultrapassa a viewport pela direita.
      const vazando = await page.evaluate((w) => {
        const out = [];
        for (const el of document.querySelectorAll("main *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          if (cs.position === "fixed") continue;
          // Containers com rolagem podem exceder de propósito — e o scroller costuma ser um
          // ANCESTRAL, não o próprio elemento: uma tabela larga dentro de `div.overflow-x:auto`
          // é o padrão CORRETO, não um defeito. Checar só o próprio elemento acusava o Powerball
          // por fazer exatamente a coisa certa.
          let temScroller = /auto|scroll/.test(cs.overflowX);
          for (let a = el.parentElement; a && a !== document.body && !temScroller; a = a.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(a).overflowX)) temScroller = true;
          }
          if (temScroller) continue;
          if (r.right > w + 1.5) {
            out.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}@${Math.round(r.right)}`);
          }
        }
        return out.slice(0, 3);
      }, width);
      check(`${tag} nenhum elemento vaza para fora da viewport`, vazando.length === 0,
        vazando.join(", "));

      // 4. Controles não podem ser cortados pelo próprio container.
      const cortados = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll("button, a.btn, select, input")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === "hidden") {
            out.push(`${el.tagName.toLowerCase()}:${(el.innerText || el.value || "").slice(0, 18)}`);
          }
        }
        return out.slice(0, 3);
      });
      check(`${tag} nenhum controle com texto cortado`, cortados.length === 0, cortados.join(", "));

      // 4b. FOLGA do rótulo de navegação — não basta "não está cortado agora".
      //
      // POR QUE ISTO EXISTE. O check 4 acima só vê o texto DEPOIS de estourar, e estourar depende
      // da fonte que a máquina tem. `--font-family` pede `Inter`, este repositório não serve a
      // fonte e ela não está instalada em lugar nenhum — então cada sistema cai num substituto
      // diferente, e a mesma página cabe num e corta no outro.
      //
      // Foi exatamente o que aconteceu: `Probabilidades` cabia no macOS por 1,5px e aparecia
      // CORTADO no runner Linux. Pior, a condição de folga zero era INDETECTÁVEL aqui — restaurar
      // o CSS antigo não deixava este gate vermelho no macOS, porque no macOS ele nunca cortou.
      // Um gate que só acusa na máquina de outra pessoa não protege ninguém.
      //
      // Medir a FOLGA remove a fonte da equação: exige-se margem sobre o texto renderizado,
      // qualquer que seja a fonte resolvida. Cabendo "no limite" reprova aqui, antes de virar
      // texto cortado no aparelho de um participante.
      const semFolga = await page.evaluate((min) => {
        const out = [];
        const s = document.createElement("span");
        s.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden;top:-9999px";
        document.body.appendChild(s);
        for (const el of document.querySelectorAll(".nav button")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          s.style.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          s.textContent = (el.innerText || "").trim();
          if (!s.textContent) continue;
          const precisa = s.getBoundingClientRect().width;
          const caixa = r.width
            - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
            - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
          const folga = (caixa - precisa) / precisa;
          if (folga < min) out.push(`${s.textContent.slice(0, 18)}:${(folga * 100).toFixed(1)}%`);
        }
        s.remove();
        return out.slice(0, 3);
      }, FOLGA_MINIMA_NAV);
      check(`${tag} rótulos de navegação com folga >= ${(FOLGA_MINIMA_NAV * 100).toFixed(0)}%`,
        semFolga.length === 0, semFolga.join(", "));

      // 5. Barras de probabilidade: todas com a MESMA altura (a "barra gorda" já regrediu aqui).
      const barras = await page.evaluate(() => {
        const els = [...document.querySelectorAll(".prob-bar, [data-prob-bar], .probability-bar")];
        const alturas = els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0);
        return { n: alturas.length, unicas: [...new Set(alturas)] };
      });
      if (barras.n > 1) {
        check(`${tag} todas as barras de probabilidade com a mesma altura`,
          barras.unicas.length === 1, `alturas=${barras.unicas.join(",")}`);
      }

      // 6. Data/hora não pode aparecer na posição do placar — regressão real já vista.
      const placar = await page.evaluate(() => {
        const el = document.querySelector(".live-score, [data-live-score], .match-score");
        return el ? (el.innerText || "").trim() : null;
      });
      if (placar) {
        check(`${tag} a posição do placar não mostra data/hora`,
          !/\d{1,2}[/:]\d{2}(?!\s*$)/.test(placar) || /^\d+\s*[x×-]\s*\d+$/.test(placar),
          `conteúdo="${placar.slice(0, 30)}"`);
      }

      // 7. Alvos de toque nas larguras de celular.
      if (width <= 430) {
        const pequenos = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll("button, a[href], select")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (getComputedStyle(el).visibility === "hidden") continue;
            if (r.height < 24 || r.width < 24) out.push(`${el.tagName.toLowerCase()}:${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out.slice(0, 3);
        });
        check(`${tag} alvos de toque >= 24px`, pequenos.length === 0, pequenos.join(", "));
      }

      // 8. Semântica de tabela: toda tabela visível precisa de cabeçalho com scope.
      const tabelas = await page.evaluate(() => {
        const out = [];
        for (const t of document.querySelectorAll("table")) {
          const r = t.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const ths = [...t.querySelectorAll("th")];
          if (!ths.length) { out.push("tabela sem <th>"); continue; }
          if (ths.some((th) => !th.getAttribute("scope"))) out.push("<th> sem scope");
        }
        return out.slice(0, 2);
      });
      check(`${tag} tabelas visíveis com cabeçalho semântico`, tabelas.length === 0, tabelas.join(", "));

      // 9. Rodapé presente e dentro da viewport.
      const rodape = await page.evaluate((w) => {
        const f = document.querySelector("footer");
        if (!f) return { existe: false };
        const r = f.getBoundingClientRect();
        return { existe: true, vaza: r.right > w + 1.5 };
      }, width);
      check(`${tag} rodapé presente e sem vazar`, rodape.existe && !rodape.vaza,
        JSON.stringify(rodape));
    } finally {
      await ctx.close();
    }
  }
  console.log("ok");
}

await browser.close();
await server.stop();

console.log(`\n  ${passed} verificações, ${failures.length} falha(s)`);
if (failures.length) {
  console.log("\n🛑 RESPONSIVE_MATRIX FAILED");
  process.exit(1);
}
console.log(`\n✓ VISUAL_14_WIDTH_MATRIX PASSED (${WIDTHS.length} larguras)`);
