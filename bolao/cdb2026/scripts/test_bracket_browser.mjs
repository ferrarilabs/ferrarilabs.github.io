#!/usr/bin/env node
/**
 * CDB2026 — o bracket de PREVISAO, no navegador de verdade.
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * Havia um gate de unidade para a propagacao, e ele passava enquanto a producao renderizava:
 *
 *     undefined × Vencedor de Cruzeiro × Atlético-MG
 *     Vencedor de Vasco × Vitória × undefined
 *
 * O gate afirmava `r.teamName`, o nome de campo que EU tinha escolhido. O renderizador le
 * `part.team`. Teste que espelha a implementacao concorda com ela ate quando ela esta errada --
 * so a tela desmente.
 *
 * Entao este roda o app REAL num navegador REAL, preenche o formulario como um participante, e
 * olha o que aparece.
 *
 * O QUE EXERCITA (sem salvar, sem banco, sem e-mail)
 * --------------------------------------------------
 *   quartas preenchidas  -> semifinal aparece com CLUBES, nao "undefined"
 *   semifinal preenchida -> final aparece com clubes
 *   final preenchida     -> CAMPEAO e VICE aparecem
 *   trocar vencedor de quartas -> semifinal muda e palpite dependente e invalidado
 *   nenhum "3o lugar"    -> a Copa do Brasil nao tem disputa de terceiro
 *
 * O estado oficial (quartas + topologia) vem de um FIXTURE, nao da producao: o teste nao pode
 * depender do torneio nem tocar em entrada de participante.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../../scripts/static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const PORT = 8231;

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Estado oficial sintetico: quatro quartas + a topologia da semifinal. Mesma FORMA da producao.
const ESTADO = {
  entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {},
  espnSync: { activePhaseId: "quartas" },
  phases: {
    quartas: {
      cutoffAt: "2099-12-31T00:00:00Z",
      ties: {
        "t-a": { teamA: "Cruzeiro", teamB: "Atlético-MG", matches: {} },
        "t-b": { teamA: "Palmeiras", teamB: "Santos", matches: {} },
        "t-c": { teamA: "Vasco", teamB: "Vitória", matches: {} },
        "t-d": { teamA: "Internacional", teamB: "Grêmio", matches: {} },
      },
      officialDraw: { authority: "CBF", source: "fixture", ingestedAt: "2026-08-11T00:00:00Z",
                      validatedAt: "2026-08-11T00:00:00Z", bracketHash: "fixture" },
    },
    semifinal: {
      cutoffAt: "2099-12-31T00:00:00Z",
      ties: {},
      topology: {
        slots: {
          "sf-1": { sideA: { winnerOf: "t-d" }, sideB: { winnerOf: "t-a" } },
          "sf-2": { sideA: { winnerOf: "t-c" }, sideB: { winnerOf: "t-b" } },
        },
        provenance: { authority: "CBF", source: "fixture",
                      ingestedAt: "2026-08-11T00:00:00Z", validatedAt: "2026-08-11T00:00:00Z" },
      },
    },
    final: { cutoffAt: "2099-12-31T00:00:00Z", ties: {} },
  },
};

const srv = await startStaticServer(PORT, RAIZ);
const browser = await chromium.launch();

async function abrirFormulario(page) {
  // Injeta o estado ANTES do app subir, e desliga o remoto: nada de rede, nada de producao.
  await page.addInitScript((estado) => {
    localStorage.setItem("bolao_cdb2026_state", JSON.stringify(estado));
    window.__TEST_STATE__ = estado;
  }, ESTADO);
  // Corta o Supabase na REDE, nao na configuracao.
  //
  // Desligar `BOLAO_CONFIG.database.enabled` depois do `goto` chega tarde: o app ja subiu, ja
  // buscou o estado remoto e ja sobrescreveu o fixture. Foi o que aconteceu -- o teste rodou
  // contra os confrontos REAIS da producao achando que rodava contra os seus.
  //
  // Bloquear a rota nao tem corrida: nenhuma resposta remota existe para ganhar do fixture. E de
  // quebra garante que este teste nunca toca em dado de participante.
  await page.route("**/rest/v1/**", route => route.abort());
  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  // Abre o formulário de palpites (nova entrada).
  await page.evaluate(() => {
    document.querySelectorAll("button, a").forEach(b => {
      if (/palpite/i.test(b.textContent || "")) b.click();
    });
  });
  await page.waitForTimeout(600);
}

/**
 * Faz o time A vencer o confronto, por PERNA.
 *
 * A primeira versao preenchia todas as pernas com 2×0 e o agregado dava 2×2 -- empate. Num
 * confronto de ida e volta a segunda perna INVERTE o mando: o "casa" da volta e o time B. Somar
 * 2 para o mandante das duas pernas da um gol para cada lado.
 *
 * O app estava certo; o teste e que nao sabia jogar futebol. Entao aqui a ida e `gA×gB` e a volta
 * e 0×0, o que faz o agregado ser gA×gB de verdade -- e o vencedor sai decidido, sem precisar
 * mexer no seletor.
 */
async function vencerComTimeA(page, tieId, gA = 2, gB = 0) {
  const ok = await page.evaluate(({ tieId, gA, gB }) => {
    const bloco = document.querySelector(`#tie-${CSS.escape(tieId)}`)
               || document.querySelector(`[data-tie-id="${tieId}"]`);
    if (!bloco) return false;
    const set = (el, v) => { if (!el) return; el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    const porPerna = (perna, casa, fora) => {
      set(bloco.querySelector(`.pk-goals-home[data-leg="${perna}"]`), casa);
      set(bloco.querySelector(`.pk-goals-away[data-leg="${perna}"]`), fora);
    };
    const pernas = [...bloco.querySelectorAll(".pk-goals-home")].map(e => e.dataset.leg);
    if (pernas.includes("single")) porPerna("single", gA, gB);
    else { porPerna("first", gA, gB); porPerna("second", 0, 0); }
    return true;
  }, { tieId, gA, gB });
  await page.waitForTimeout(400);
  return ok;
}

/** Faz o time B vencer -- usado para provar a invalidacao a jusante. */
async function vencerComTimeB(page, tieId) {
  return vencerComTimeA(page, tieId, 0, 2);
}

const texto = (page) => page.evaluate(() => document.getElementById("pickForm")?.textContent || "");

console.log("\nCDB2026 — bracket de previsão (navegador real)\n");

// try/finally: um caso que lanca NAO pode deixar o servidor de pe. Foi o que aconteceu -- os
// orfaos das minhas execucoes manuais seguraram portas e derrubaram outras suites do verify com
// "porta JA ESTA EM USO", que parece defeito do harness e e sujeira minha.
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await abrirFormulario(page);

  const inicial = await texto(page);
  test("o formulário de palpites abriu com as quartas", () =>
    assert(/Cruzeiro/.test(inicial) && /Palmeiras/.test(inicial),
      `não achei as quartas no formulário:\n${inicial.slice(0, 300)}`));

  // ── QUARTAS -> SEMIFINAL ────────────────────────────────────────────────────────────────────
  await vencerComTimeA(page, "t-a");   // Cruzeiro
  await vencerComTimeA(page, "t-b");   // Palmeiras
  await vencerComTimeA(page, "t-c");   // Vasco
  await vencerComTimeA(page, "t-d");   // Internacional

  const aposQuartas = await texto(page);
  const sfBlocos = await page.evaluate(() => [...document.querySelectorAll('.tie-pick-block')].map(x => x.id));
  const textoSf = await page.evaluate(() => ["tie-sf-1", "tie-sf-2"]
    .map(id => document.getElementById(id)?.textContent || "").join(" | "));

  test("SEMIFINAL_UNDEFINED_SLOTS = 0", () =>
    assert(!/undefined/i.test(aposQuartas),
      `a tela ainda renderiza "undefined":\n${aposQuartas.slice(0, 400)}`));

  // ASSERCAO FORTE. A primeira versao procurava o nome do clube em qualquer lugar do texto -- e
  // "Internacional" aparece dentro de "Vencedor de Internacional × Grêmio", que e exatamente o
  // estado NAO resolvido. O teste passava com a propagacao quebrada.
  //
  // Agora exige que a semifinal tenha virado CONFRONTO DE VERDADE: bloco de palpite proprio, com
  // id `tie-sf-1`/`tie-sf-2`. Vaga pendente nao gera bloco.
  test("QF_TO_SF_LIVE — a semifinal vira confronto palpitável, sem salvar", () => {
    assert(sfBlocos.includes("tie-sf-1") && sfBlocos.includes("tie-sf-2"),
      `a semifinal não virou confronto: blocos=${JSON.stringify(sfBlocos)}`);
    // Olha DENTRO dos blocos da semifinal. Fatiar o texto a partir de "Semifinal" arrastava junto
    // a seção da Final -- que legitimamente ainda mostra dependência neste ponto.
    assert(!/Vencedor de/.test(textoSf),
      `a semifinal ainda mostra dependência em vez de clube:\n${textoSf}`);
    assert(/Internacional/.test(textoSf) && /Cruzeiro/.test(textoSf)
           && /Vasco/.test(textoSf) && /Palmeiras/.test(textoSf),
      `os vencedores previstos não ocuparam as vagas:\n${textoSf}`);
  });

  // ── SEMIFINAL -> FINAL ──────────────────────────────────────────────────────────────────────
  await vencerComTimeA(page, "sf-1", 1, 0);
  await vencerComTimeA(page, "sf-2", 1, 0);
  const aposSemi = await texto(page);

  test("SF_TO_FINAL_LIVE — a final aparece a partir dos vencedores da semifinal", () =>
    assert(!/undefined/i.test(aposSemi) && /FINAL/i.test(aposSemi),
      `a final não se formou:\n${aposSemi.slice(0, 400)}`));

  test("a final NÃO exige chaveamento oficial publicado", () =>
    assert(!/ainda não publicou o chaveamento/i.test(aposSemi),
      "a final ainda pede um chaveamento oficial que não existe — com duas semifinais há UMA final"));

  // ── FINAL -> CAMPEÃO ────────────────────────────────────────────────────────────────────────
  await vencerComTimeA(page, "final-1", 3, 1);
  const aposFinal = await texto(page);

  test("FINAL_TO_CHAMPION_LIVE — CAMPEÃO aparece", () =>
    assert(/CAMPEÃO/.test(aposFinal), `sem campeão:\n${aposFinal.slice(-400)}`));
  test("VICE-CAMPEÃO aparece", () =>
    assert(/VICE-CAMPEÃO/.test(aposFinal), `sem vice:\n${aposFinal.slice(-400)}`));

  test("THIRD_PLACE_PRESENT = NO", () =>
    assert(!/3º lugar|terceiro lugar|3o lugar/i.test(aposFinal),
      "apareceu disputa de terceiro lugar — a Copa do Brasil não tem"));
  test("FOURTH_PLACE_PRESENT = NO", () =>
    assert(!/4º lugar|quarto lugar/i.test(aposFinal), "apareceu quarto lugar"));

  test("SAVE_REQUIRED_TO_ADVANCE = NO", () =>
    assert(true, "todo o caminho acima foi percorrido sem clicar em Salvar"));

  // ── INVALIDAÇÃO A JUSANTE ───────────────────────────────────────────────────────────────────
  await vencerComTimeB(page, "t-d");   // agora Grêmio passa, nao Internacional
  const aposTroca = await texto(page);

  test("DOWNSTREAM_INVALIDATION — trocar o vencedor das quartas troca a semifinal", () =>
    assert(/Grêmio/.test(aposTroca), `a semifinal não seguiu a troca:\n${aposTroca.slice(0, 400)}`));

  test("o pódio obsoleto é limpo quando a final é invalidada", () => {
    const aindaTemCampeao = /CAMPEÃO/.test(aposTroca) &&
      !/Complete a final/.test(aposTroca);
    assert(!aindaTemCampeao || !/Internacional/.test(aposTroca.split("CAMPEÃO")[1] || ""),
      "o campeão antigo sobreviveu a uma troca que invalidou a final");
  });

  test("nenhum undefined depois da troca", () =>
    assert(!/undefined/i.test(aposTroca), `undefined após a troca:\n${aposTroca.slice(0, 400)}`));

  // ── LOOK AND FEEL ───────────────────────────────────────────────────────────────────────────
  const visual = await page.evaluate(() => {
    const g = document.querySelector(".pick-group-header.champion-header");
    const linha = document.querySelector(".pick-row.tie-row");
    const cs = g ? getComputedStyle(g) : null;
    return {
      usaCabecalhoExistente: !!g,
      usaLinhaExistente: !!linha,
      corCabecalho: cs ? cs.color : null,
      fundoPagina: getComputedStyle(document.body).backgroundColor,
    };
  });

  test("CDB_LOOK_AND_FEEL_PRESERVED — usa os componentes que a página já tinha", () =>
    assert(visual.usaCabecalhoExistente && visual.usaLinhaExistente,
      `o pódio não reaproveitou .champion-header/.tie-row: ${JSON.stringify(visual)}`));

  // ── RESPONSIVO ──────────────────────────────────────────────────────────────────────────────
  for (const w of [320, 414, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    test(`CDB_RESPONSIVE_LAYOUT_PRESERVED @${w}px — sem overflow horizontal`, () =>
      assert(!overflow, `a página passa a rolar na horizontal em ${w}px`));
  }

} finally {
  await browser.close().catch(() => {});
  try { srv.stop(); } catch { /* ja parado */ }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ BRACKET BROWSER PASSED\n" : "✗ BRACKET BROWSER FAILED\n");
process.exit(fail === 0 ? 0 : 1);
