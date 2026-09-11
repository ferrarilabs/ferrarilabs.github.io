#!/usr/bin/env node
/**
 * CDB2026 — palpite de fase derivada feito ANTES da materialização por time continua contando
 * depois dela, tanto em "Ver palpites" quanto na PONTUAÇÃO real (#428, 2026-09-10).
 *
 * O DEFEITO QUE ISTO FECHA (achado real, contra dado de produção)
 * -----------------------------------------------------------------
 * A correção anterior desta mesma Issue (`test_final_podium_after_materialization.mjs`) cobria o
 * caso em que o palpite já estava salvo sob o id REAL do confronto. Verificação em navegador real
 * contra o estado público de produção (`bolao_state_normalized_public`) mostrou que isso não é o
 * que acontece: as 12 entradas reais palpitaram a semifinal ANTES da materialização, quando o
 * único id que existia era o de SLOT da topologia (`sf-1`/`sf-2`) — porque `virtualDerivedTies()`,
 * antes de `materialize-derived-phase` gravar os times, só sabe construir a vaga por topologia, e
 * é sob esse id que `renderPickForm()`/`getPickValues()` salvam o palpite.
 *
 * Depois que os times reais são materializados, o confronto passa a existir com um id DIFERENTE
 * (`espn-<time>_<time>`), e três funções passaram a procurar o palpite só por esse id novo:
 * `renderPickDisplay()` ("Ver palpites"), `scoreEntry()` (pontuação real) e `explainScore()`
 * (auditoria). Resultado, verificado ao vivo: 0 das 12 entradas reais mostravam a semifinal em
 * "Ver palpites", e — mais grave — teriam pontuado ZERO nos jogos e no bônus de classificação da
 * semifinal quando o resultado saísse, silenciosamente, sem erro nenhum.
 *
 * A CORREÇÃO: `legacyDerivedTieIds()` + `pickByTieId()` (`app.js`) casam o confronto real com o
 * slot de topologia que produz os MESMOS DOIS TIMES hoje, e toda leitura de palpite de fase
 * derivada passa a cair para esse id legado quando o id real não tiver nada salvo.
 *
 * Este teste cobre o caminho que o teste irmão não cobria: palpite salvo sob id de SLOT
 * (`sf-1`/`sf-2`), nunca sob o id real — o único caminho que existiu de verdade neste torneio —,
 * e prova tanto a EXIBIÇÃO quanto a PONTUAÇÃO (`scoreEntry`, via o app carregado no navegador).
 *
 * TAMBÉM cobre `finalSideLabels()` (mesmo dia, pedido em seguida: "faz igual a copa do mundo,
 * bota entre parentesis o time que foi selecionado mas nao passou"). PRIMEIRA versão (errada)
 * botava o parêntese direto nas linhas "Campeão"/"Vice" -- conferido contra dado REAL de produção
 * da Copa do Mundo: o resumo de pódio de lá (`.picks-podium`) é SEMPRE puro, sem parêntese; quem
 * tem o parêntese é a LINHA do confronto na tabela de partidas. Corrigido: campeão/vice
 * continuam sempre o palpite puro (nunca recalculados — "mesmo que incorreto" preservado), e uma
 * linha nova de confronto da final ganha o parêntese quando a semifinal correspondente já decidiu
 * diferente do palpite.
 *
 * HERMÉTICO: servidor estático local, sem rede, sem dado de participante real (nomes sintéticos).
 *
 * Uso: node bolao/cdb2026/scripts/test_legacy_derived_pick_continuity.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../../scripts/static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const PORT = 8256; // único: ver bolao/scripts/test_harness_ports_unique.mjs

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Times sintéticos (o mecanismo não depende de dado real da Copa do Brasil).
const ESTADO = {
  entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {},
  espnSync: { activePhaseId: "semifinal" },
  phases: {
    quartas: {
      cutoffAt: "2020-01-01T00:00:00Z",
      ties: {
        "q-1": { teamA: "Alfa", teamB: "Beta", matches: {}, qualifiedTeamId: "A" },       // Alfa avança
        "q-2": { teamA: "Gama", teamB: "Delta", matches: {}, qualifiedTeamId: "B" },      // Delta avança
        "q-3": { teamA: "Epsilon", teamB: "Zeta", matches: {}, qualifiedTeamId: "A" },    // Epsilon avança
        "q-4": { teamA: "Eta", teamB: "Theta", matches: {}, qualifiedTeamId: "B" },       // Theta avança
      },
      officialDraw: { authority: "CBF", source: "fixture", ingestedAt: "2020-01-01T00:00:00Z",
                      validatedAt: "2020-01-01T00:00:00Z", bracketHash: "fixture" },
    },
    // Confrontos REAIS materializados -- ids DIFERENTES dos ids de slot (sf-1/sf-2) que a
    // topologia usa. AMBOS já decididos, com placar real, para exercitar a pontuação por partida
    // e o bônus de classificação, não só a exibição.
    semifinal: {
      cutoffAt: "2020-06-01T00:00:00Z",
      ties: {
        "real-alfa_delta": {
          teamA: "Alfa", teamB: "Delta",
          matches: {
            first:  { goalsHome: 2, goalsAway: 1 },
            second: { goalsHome: 1, goalsAway: 1 },
          },
          qualifiedTeamId: "A", // Alfa avança (agregado 3-2)
        },
        "real-epsilon_theta": {
          teamA: "Epsilon", teamB: "Theta",
          matches: {
            first:  { goalsHome: 0, goalsAway: 0 },
            second: { goalsHome: 1, goalsAway: 2 },
          },
          qualifiedTeamId: "B", // Theta avança (agregado 1-2)
        },
      },
      topology: {
        slots: {
          "sf-1": { sideA: { winnerOf: "q-1" }, sideB: { winnerOf: "q-2" } }, // -> Alfa x Delta
          "sf-2": { sideA: { winnerOf: "q-3" }, sideB: { winnerOf: "q-4" } }, // -> Epsilon x Theta
        },
        provenance: { authority: "CBF", source: "fixture", channel: "fixture",
                      ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z" },
      },
    },
    final: {
      cutoffAt: "2099-12-31T00:00:00Z",
      ties: {},
      topology: {
        slots: { "final-1": { sideA: { winnerOf: "real-alfa_delta" }, sideB: { winnerOf: "real-epsilon_theta" } } },
        provenance: { authority: "CBF", source: "fixture", channel: "fixture",
                      ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z" },
      },
    },
  },
};

// Entrada que palpitou a semifinal ANTES da materialização -- só existia o id de SLOT então, e é
// sob ele que o palpite está salvo. NUNCA sob "real-alfa_delta"/"real-epsilon_theta" -- esse id
// só passou a existir depois, e é exatamente isso que o mecanismo de continuidade tem de superar.
ESTADO.entries = [{
  id: "e1", entryName: "Participante Um",
  createdAt: "2020-01-01T00:00:00.000Z",
  picks: {
    matches: {
      // sf-1 (vira "real-alfa_delta"): acerta o placar exato nas duas pernas.
      "sf-1": { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 1 } },
      // sf-2 (vira "real-epsilon_theta"): acerta parcialmente (1 gol certo na ida, nada na volta).
      "sf-2": { first: { goalsHome: 1, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 0 } },
    },
    qualified: {
      "sf-1": "A",       // Alfa avança -- BATE com o resultado real (tie bonus)
      "sf-2": "A",       // Epsilon avança -- ERRA (quem passou de verdade foi Theta)
      "final-1": "A",    // campeão previsto: o lado A da final
    },
  },
}];
// Placar da final: sem isso a linha de confronto da final (finalSideLabels()) não tem o que
// mostrar e não aparece.
// Aninhado sob a perna "single" (final é SINGLE_MATCH, legsForFormat()) -- igual a TODO palpite
// de partida real (picks.matches[tieId][leg]), NUNCA {goalsHome,goalsAway} direto sob o id do
// confronto. Achado real (2026-09-11): o fixture anterior usava a forma achatada errada, e por
// isso este teste nunca teria pego o bug de verdade (11 das 12 entradas reais de produção têm
// o placar aninhado sob "single" e a linha da final nunca aparecia para nenhuma).
ESTADO.entries[0].picks.matches["final-1"] = { single: { goalsHome: 1, goalsAway: 0 } };
ESTADO.paid = { e1: true };

const srv = await startStaticServer(PORT, RAIZ);
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.addInitScript((estado) => {
    localStorage.setItem("bolao_cdb2026_state", JSON.stringify(estado));
  }, ESTADO);
  await page.route("**/rest/v1/**", route => route.abort());
  await page.route("**/functions/v1/**", route => route.abort());
  await page.route("**cdn.jsdelivr.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));

  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  test("nenhum erro de página com palpite salvo sob id de slot legado", () =>
    assert(errors.length === 0, `erros: ${JSON.stringify(errors)}`));

  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('[data-rank-toggle="e1"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(400);
  test("clicou em 'Ver palpites' com sucesso", () => assert(clicked, "botão não encontrado"));

  const rows = await page.evaluate(() => {
    const d = document.querySelector('[data-rank-detail="e1"]');
    if (!d) return null;
    return [...d.querySelectorAll("tbody tr")].map(tr =>
      [...tr.querySelectorAll("td")].map(td => (td.textContent || "").trim()));
  });

  test("LEGACY_SEMIFINAL_MATCH_ROW_PRESENT — placar da semifinal aparece (id de slot -> id real)", () =>
    assert(rows?.some(r => r[0]?.includes("Alfa") && r[0]?.includes("Delta")),
      `linhas: ${JSON.stringify(rows)}`));

  test("LEGACY_SEMIFINAL_TIE_ROW_PRESENT — linha 'Classificado' da semifinal aparece", () =>
    assert(rows?.some(r => r[0]?.includes("Classificado") && r[0]?.includes("Alfa") && r[0]?.includes("Delta")),
      `linhas: ${JSON.stringify(rows)}`));

  test("LEGACY_CHAMPION_RESOLVES — campeão previsto resolve mesmo com palpite de semifinal legado", () =>
    assert(rows?.some(r => r[0]?.includes("Campeão") && r[1] === "Alfa"),
      `linhas: ${JSON.stringify(rows)}`));

  test("LEGACY_RUNNERUP_RESOLVES — vice previsto continua o palpite puro, nunca recalculado", () =>
    assert(rows?.some(r => r[0]?.includes("Vice") && r[1] === "Epsilon"),
      `linhas: ${JSON.stringify(rows)}`));

  // sf-2 (real-epsilon_theta) já está DECIDIDO e discorda do palpite: quem passou de verdade foi
  // Theta, não Epsilon (que o participante escolheu). Igual à Copa do Mundo (conferido contra
  // dado real de produção, Eduardo 2026-09-10 "bota entre parentesis o time que foi selecionado
  // mas nao passou"): a LINHA de confronto da final (nunca o resumo de campeão/vice, que lá
  // também é sempre puro) mostra o time REAL, com o selecionado mas eliminado entre parênteses.
  test("FINAL_MATCH_ROW_SHOWS_REAL_TEAM_WITH_ELIMINATED_PICK_IN_PARENS", () =>
    assert(rows?.some(r => r[0] === "Alfa" && r[2] === "Theta (Epsilon)"),
      `linhas: ${JSON.stringify(rows)}`));

  // O PONTO MAIS CRÍTICO: pontuação real, não só exibição. sf-1 acerta placar exato nas duas
  // pernas (10+10) e o bônus de classificação (5) = 25. sf-2 acerta só um lado do placar na ida
  // (+1) e erra a classificação (0) = 1. Total esperado da semifinal: 26 pontos -- SEM a
  // correção, ambos ficam de fora da busca por id real e a soma seria 0.
  const pontuacao = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("bolao_cdb2026_state"));
    const entry = s.entries.find(e => e.id === "e1");
    // scoreEntry() é função interna da IIFE -- não está em window. Em vez de expor só para o
    // teste, lê a MESMA pontuação que "Ver palpites" mostrou (ptsCell), que é o que o
    // participante e o admin realmente veem -- e é gerada pela mesma scoreEntry() por baixo.
    const d = document.querySelector('[data-rank-detail="e1"]');
    const rows = [...d.querySelectorAll("tbody tr")].map(tr =>
      [...tr.querySelectorAll("td")].map(td => (td.textContent || "").trim()));
    return rows;
  });
  // Linhas de placar agora têm Time A e Time B em células SEPARADAS (5 células: TimeA/Placar/
  // TimeB/Real/Pts), diferente das linhas "Classificado" (4 células, rótulo com colspan) --
  // r.length distingue as duas sem ambiguidade.
  const ehPlacar = (r, a, b) => r.length === 5 && ((r[0] === a && r[2] === b) || (r[0] === b && r[2] === a));
  const linhaSf1Placar = pontuacao.find(r => ehPlacar(r, "Alfa", "Delta"));
  const linhaSf1Tie    = pontuacao.find(r => r[0]?.includes("Classificado") && r[0]?.includes("Alfa") && r[0]?.includes("Delta"));
  const linhaSf2Placar = pontuacao.find(r => ehPlacar(r, "Epsilon", "Theta"));
  const linhaSf2Tie    = pontuacao.find(r => r[0]?.includes("Classificado") && r[0]?.includes("Epsilon") && r[0]?.includes("Theta"));

  test("LEGACY_SCORING_SF1_MATCH_EXACT — placar exato pontua (+10) via id legado", () =>
    assert(linhaSf1Placar?.[4] === "+10", `linha: ${JSON.stringify(linhaSf1Placar)}`));
  test("LEGACY_SCORING_SF1_TIE_BONUS_HIT — bônus de classificação pontua (+5) via id legado", () =>
    assert(linhaSf1Tie?.[3] === "+5", `linha: ${JSON.stringify(linhaSf1Tie)}`));
  test("LEGACY_SCORING_SF2_TIE_BONUS_MISS — classificação errada não pontua (—) via id legado", () =>
    assert(linhaSf2Tie?.[3] === "—", `linha: ${JSON.stringify(linhaSf2Tie)}`));
  test("LEGACY_SCORING_SF2_MATCH_ROW_PRESENT — segunda perna da semifinal também aparece", () =>
    assert(!!linhaSf2Placar, `linhas: ${JSON.stringify(pontuacao)}`));

  await page.screenshot({ path: "/tmp/test_legacy_derived_pick_continuity.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await srv.stop();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ LEGACY DERIVED PICK CONTINUITY OK" : "✗ LEGACY DERIVED PICK CONTINUITY FAILED");
process.exit(fail === 0 ? 0 : 1);
