#!/usr/bin/env node
/**
 * CDB2026 — campeão/vice previstos continuam resolvendo depois que a semifinal vira confronto
 * REAL (#428, 2026-09-10).
 *
 * O DEFEITO QUE ISTO FECHA
 * ------------------------
 * `virtualDerivedTies(s, "final", picks)` monta o bracket da final a partir da SEMIFINAL virtual
 * (`virtualDerivedTies(s, "semifinal", ...)`), que — antes desta correção — SEMPRE recalculava por
 * topologia, usando ids de SLOT (`sf-1`/`sf-2`). Isso era certo enquanto a semifinal nunca tinha
 * sido materializada por time. Mas a partir do momento em que `materialize-derived-phase` (#410)
 * grava os confrontos REAIS (ids `espn-<time>_<time>`), `renderPickForm()` passa a salvar o
 * palpite de classificação sob o id REAL — nunca mais sob `sf-1`. Como neste torneio a topologia
 * só foi registrada em 2026-09-05 (DEPOIS do prazo original das quartas), NENHUM participante
 * jamais teve a chance de palpitar pelo id de slot: o único id possível, desde sempre, é o real.
 *
 * Resultado sem a correção: `predictedPodium()` nunca encontrava o palpite de campeão/vice de
 * NINGUÉM, porque procurava a chave errada. `bonusRow()` em "Ver palpites" ficava vazio, e o
 * bônus de campeão/vice em `scoreEntry()` (a MESMA função) nunca teria pontuado ninguém — sem
 * nenhum erro visível, silenciosamente, exatamente o tipo de falha que só aparece na hora que
 * mais importa (a final decidida, dinheiro real em jogo).
 *
 * Achado por verificação manual contra um espelho dos dados reais de produção (não fixture
 * inventada) — ver Issue #428.
 *
 * CORREÇÃO NO PRÓPRIO TESTE (mesmo dia, achado investigando um pedido em seguida): a sub-suite
 * "mesmo que incorreto" simulava um resultado real divergente com `page.evaluate()` + `reload()`.
 * `page.addInitScript()` fica registrado na página e roda de novo em TODA navegação, inclusive
 * reload — reescrevendo o localStorage com o estado ORIGINAL (sem a mutação) antes do app carregar,
 * fazendo a asserção "passar" mesmo que a divergência nunca tivesse existido para o app. Corrigido
 * com uma segunda página/navegação, já com o estado mutado desde o load inicial (sem reload). Esse
 * mesmo achado também é o motivo de agora existir `predictedPodiumDisplay()` (Eduardo, mesmo dia,
 * "faz igual a copa do mundo, bota entre parentesis o time que foi selecionado mas nao passou") —
 * a asserção corrigida cobre o parêntese, não mais o palpite puro sem indicação nenhuma.
 *
 * HERMETICO: servidor estático local, sem rede, sem dado de participante real (nomes/emails
 * sintéticos, ver docs/bolao/SECURITY.md "Commit-message PII prevention").
 *
 * Uso: node bolao/cdb2026/scripts/test_final_podium_after_materialization.mjs
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../../scripts/static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const PORT = 8255; // único: ver bolao/scripts/test_harness_ports_unique.mjs

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// Confrontos REAIS de quartas (decididos) + semifinal JÁ MATERIALIZADA por time (mesma forma que
// materialize-derived-phase grava) -- é exatamente o estado real do torneio a partir de 2026-09-10.
// Times sintéticos: o fixture não precisa dos nomes reais da Copa do Brasil para provar o
// mecanismo, e usar nomes fictícios deixa claro que isto não depende de dado de produção.
const ESTADO = {
  entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {},
  espnSync: { activePhaseId: "semifinal" },
  phases: {
    quartas: {
      cutoffAt: "2020-01-01T00:00:00Z",
      ties: {
        "q-1": { teamA: "Alfa", teamB: "Beta", matches: {}, qualifiedTeamId: "A" },
        "q-2": { teamA: "Gama", teamB: "Delta", matches: {}, qualifiedTeamId: "B" },
        "q-3": { teamA: "Epsilon", teamB: "Zeta", matches: {}, qualifiedTeamId: "A" },
        "q-4": { teamA: "Eta", teamB: "Theta", matches: {}, qualifiedTeamId: "B" },
      },
      officialDraw: { authority: "CBF", source: "fixture", ingestedAt: "2020-01-01T00:00:00Z",
                      validatedAt: "2020-01-01T00:00:00Z", bracketHash: "fixture" },
    },
    // Confrontos REAIS -- ids no MESMO formato que materialize-derived-phase grava em produção,
    // NUNCA "sf-1"/"sf-2". Ainda sem resultado (qualifiedTeamId ausente): a semifinal está
    // aberta, exatamente o estado de 2026-09-10 depois do open-picks.
    semifinal: {
      cutoffAt: "2099-12-31T00:00:00Z",
      ties: {
        "fix-alfa_delta": { teamA: "Alfa", teamB: "Delta", matches: {} },
        "fix-epsilon_theta": { teamA: "Epsilon", teamB: "Theta", matches: {} },
      },
      topology: {
        slots: {
          "sf-1": { sideA: { winnerOf: "q-1" }, sideB: { winnerOf: "q-2" } },
          "sf-2": { sideA: { winnerOf: "q-3" }, sideB: { winnerOf: "q-4" } },
        },
        provenance: { authority: "CBF", source: "fixture", channel: "fixture",
                      ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z" },
      },
    },
    final: {
      cutoffAt: "2099-12-31T00:00:00Z",
      ties: {},
      topology: {
        slots: { "final-1": { sideA: { winnerOf: "fix-alfa_delta" }, sideB: { winnerOf: "fix-epsilon_theta" } } },
        provenance: { authority: "CBF", source: "fixture", channel: "fixture",
                      ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z" },
      },
    },
  },
};

// Uma entrada que palpitou Delta campeã (perdendo a final para quem escolheu Epsilon) -- picks
// pelo id REAL da semifinal (o único caminho possível neste torneio, ver cabeçalho).
ESTADO.entries = [{
  id: "e1", entryName: "Participante Um", payerName: "Participante Um",
  paymentMethod: "CashApp", participantEmail: "participante.um@example.invalid",
  createdAt: "2020-01-01T00:00:00.000Z",
  picks: { matches: {}, qualified: {
    "fix-alfa_delta": "B",       // Delta avança
    "fix-epsilon_theta": "A",    // Epsilon avança
    "final-1": "A",              // Delta (lado A da final) é campeã, no palpite
  } },
}];
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
  // CDN scripts (EmailJS/Supabase JS) não são exercitados por este teste -- stub evita esperar
  // por rede que este harness não precisa.
  await page.route("**cdn.jsdelivr.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));

  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  test("nenhum erro de página ao carregar com semifinal já materializada", () =>
    assert(errors.length === 0, `erros: ${JSON.stringify(errors)}`));

  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("[data-rank-toggle]")];
    const btn = btns.find(b => (b.getAttribute("aria-label") || "").includes("Participante Um"));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(400);

  test("clicou em 'Ver palpites' com sucesso", () => assert(clicked, "botão não encontrado"));

  const detail = await page.evaluate(() => {
    const d = document.querySelector('[data-rank-detail="e1"]');
    if (!d) return null;
    const rows = [...d.querySelectorAll("tbody tr")].map(tr =>
      [...tr.querySelectorAll("td")].map(td => (td.textContent || "").trim()));
    return { html: d.innerHTML, rows };
  });

  test("PODIUM_CHAMPION_ROW_PRESENT — a linha de campeão aparece", () =>
    assert(detail?.rows?.some(r => r[0]?.includes("Campeão")),
      `linhas encontradas: ${JSON.stringify(detail?.rows)}`));

  test("PODIUM_RUNNERUP_ROW_PRESENT — a linha de vice aparece", () =>
    assert(detail?.rows?.some(r => r[0]?.includes("Vice")),
      `linhas encontradas: ${JSON.stringify(detail?.rows)}`));

  // O PONTO CENTRAL: campeão mostrado é o PALPITE (Delta), nunca inferido de resultado real --
  // não há resultado real aqui, e mesmo que houvesse, "Ver palpites" mostra o que a pessoa
  // apostou, não o que aconteceu (isso é uma coluna separada, "Resultado real").
  test("PREDICTED_CHAMPION_IS_DELTA — mostra o palpite do participante, não um resultado", () =>
    assert(detail?.rows?.some(r => r[0]?.includes("Campeão") && r[1] === "Delta"),
      `linhas encontradas: ${JSON.stringify(detail?.rows)}`));

  test("PREDICTED_RUNNERUP_IS_EPSILON", () =>
    assert(detail?.rows?.some(r => r[0]?.includes("Vice") && r[1] === "Epsilon"),
      `linhas encontradas: ${JSON.stringify(detail?.rows)}`));

  // "mesmo que incorreto (time não avançou)" -- Eduardo, 2026-09-10. Simula a semifinal decidida
  // com um resultado que DISCORDA do palpite: na vida real, Alfa venceu (não Delta).
  //
  // NAVEGACAO NOVA, NAO reload() na mesma pagina: `page.addInitScript()` fica registrado na
  // pagina e RODA DE NOVO em toda navegacao subsequente -- inclusive reload(). Um `page.evaluate()`
  // mutando o localStorage e DEPOIS um `page.reload()` faz o addInitScript ORIGINAL (closure com o
  // ESTADO sem a mutacao) reescrever o localStorage por cima da mutacao ANTES do app le-lo --
  // fazendo o teste "passar" mesmo que a mutacao nunca tenha chegado a existir para o app.
  // Achado real (#428, 2026-09-10) ao investigar o pedido de Eduardo de colocar o time eliminado
  // entre parenteses: essa sub-suite media a mesma coisa desde v3.146 sem nunca ter exercitado de
  // verdade a divergencia que afirmava cobrir. Corrigido com uma pagina/navegacao PROPRIA, com o
  // estado ja mutado ANTES do primeiro load -- sem reload, sem corrida com o addInitScript antigo.
  const ESTADO_APOS_RESULTADO = JSON.parse(JSON.stringify(ESTADO));
  ESTADO_APOS_RESULTADO.phases.semifinal.ties["fix-alfa_delta"].qualifiedTeamId = "A"; // Alfa avançou de verdade, não Delta

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors2 = [];
  page2.on("pageerror", e => errors2.push(e.message));
  await page2.addInitScript((estado) => {
    localStorage.setItem("bolao_cdb2026_state", JSON.stringify(estado));
  }, ESTADO_APOS_RESULTADO);
  await page2.route("**/rest/v1/**", route => route.abort());
  await page2.route("**/functions/v1/**", route => route.abort());
  await page2.route("**cdn.jsdelivr.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page2.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "domcontentloaded" });
  await page2.waitForTimeout(1200);

  test("nenhum erro de página com resultado real divergindo do palpite", () =>
    assert(errors2.length === 0, `erros: ${JSON.stringify(errors2)}`));

  await page2.evaluate(() => {
    const btns = [...document.querySelectorAll("[data-rank-toggle]")];
    const btn = btns.find(b => (b.getAttribute("aria-label") || "").includes("Participante Um"));
    if (btn) btn.click();
  });
  await page2.waitForTimeout(400);
  const detailAposResultado = await page2.evaluate(() => {
    const d = document.querySelector('[data-rank-detail="e1"]');
    if (!d) return null;
    return [...d.querySelectorAll("tbody tr")].map(tr =>
      [...tr.querySelectorAll("td")].map(td => (td.textContent || "").trim()));
  });
  await page2.close();

  // DISPLAY apenas (predictedPodiumDisplay(), pedido de Eduardo em seguida no mesmo dia: "faz
  // igual a copa do mundo, bota entre parentesis o time que foi selecionado mas nao passou"):
  // agora que o resultado real da semifinal diverge do palpite e é CONHECIDO, "Ver palpites"
  // troca a exibição para o time REAL, com o eliminado (o que a pessoa escolheu) entre parênteses.
  test("PREDICTED_CHAMPION_SHOWS_REAL_TEAM_WITH_ELIMINATED_PICK_IN_PARENS", () =>
    assert(detailAposResultado?.some(r => r[0]?.includes("Campeão") && r[1] === "Alfa (Delta)"),
      `o palpite de campeão não ganhou o parêntese esperado depois do resultado real divergir: ` +
      `${JSON.stringify(detailAposResultado)}`));

  await page.screenshot({ path: "/tmp/test_final_podium_after_materialization.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await srv.stop();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ FINAL PODIUM AFTER MATERIALIZATION OK" : "✗ FINAL PODIUM AFTER MATERIALIZATION FAILED");
process.exit(fail === 0 ? 0 : 1);
