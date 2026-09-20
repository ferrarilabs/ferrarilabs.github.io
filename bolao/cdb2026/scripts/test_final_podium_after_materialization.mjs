#!/usr/bin/env node
/**
 * CDB2026 — identidade do TIME previsto sobrevive à materialização (#440).
 *
 * Regressão SIDE vs TEAM, mesma classe já corrigida na Copa do Mundo.
 *
 * O palpite histórico é uma sequência de lados A/B, mas cada lado tinha um TIME concreto
 * quando a pessoa o escolheu. Materializar fases posteriores com os clubes que REALMENTE
 * avançaram pode trocar o id do confronto; nunca pode reaplicar o mesmo "A"/"B" aos novos
 * clubes e reescrever semanticamente o palpite.
 *
 * Fixture espelha os IDs, times e topologia reais do incidente, sem dado de participante:
 *   - quartas: Internacional × Grêmio; participante escolhe Internacional, realidade classifica Grêmio
 *   - semifinal prevista: Internacional × Cruzeiro; participante escolhe Internacional
 *   - semifinal real materializada: Grêmio × Atlético-MG
 *   - final prevista: Internacional × Palmeiras; participante escolhe Internacional campeão
 *
 * O código antigo mostrava Grêmio campeão assim que a semifinal real existia.
 *
 * HERMÉTICO: servidor local, Supabase/CDN bloqueados, nome/e-mail sintéticos.
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
const clone = x => JSON.parse(JSON.stringify(x));

const ESTADO = {
  entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {},
  espnSync: { activePhaseId: "semifinal" },
  phases: {
    quartas: {
      cutoffAt: "2020-01-01T00:00:00Z",
      ties: {
        "espn-gremio_internacional": { teamA: "Internacional", teamB: "Grêmio", matches: {}, qualifiedTeamId: "B" },
        "espn-atletico-mg_cruzeiro": { teamA: "Cruzeiro", teamB: "Atlético-MG", matches: {}, qualifiedTeamId: "B" },
        "espn-vasco_vitoria": { teamA: "Vasco", teamB: "Vitória", matches: {}, qualifiedTeamId: "A" },
        "espn-palmeiras_santos": { teamA: "Palmeiras", teamB: "Santos", matches: {}, qualifiedTeamId: "A" },
      },
      officialDraw: {
        authority: "CBF", source: "fixture",
        ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z",
        bracketHash: "fixture",
      },
    },
    semifinal: {
      cutoffAt: "2099-12-31T00:00:00Z",
      // TIMES REAIS materializados. Eles divergem do bracket previsto da entrada.
      ties: {
        "espn-atletico-mg_gremio": { teamA: "Grêmio", teamB: "Atlético-MG", matches: {} },
        "espn-palmeiras_vasco": { teamA: "Vasco", teamB: "Palmeiras", matches: {} },
      },
      topology: {
        slots: {
          "sf-1": { sideA: { winnerOf: "espn-gremio_internacional" }, sideB: { winnerOf: "espn-atletico-mg_cruzeiro" } },
          "sf-2": { sideA: { winnerOf: "espn-vasco_vitoria" }, sideB: { winnerOf: "espn-palmeiras_santos" } },
        },
        provenance: {
          authority: "CBF", source: "fixture", channel: "fixture",
          ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z",
        },
      },
    },
    final: {
      cutoffAt: "2099-12-31T00:00:00Z",
      ties: {},
      topology: {
        slots: {
          "final-1": {
            sideA: { winnerOf: "espn-atletico-mg_gremio" },
            sideB: { winnerOf: "espn-palmeiras_vasco" },
          },
        },
        provenance: {
          authority: "CBF", source: "fixture", channel: "fixture",
          ingestedAt: "2020-01-01T00:00:00Z", validatedAt: "2020-01-01T00:00:00Z",
        },
      },
    },
  },
};

// Forma REAL das entradas históricas: as semifinais/final foram palpitadas pelos ids de SLOT
// antes da materialização. O participante previu Internacional campeão.
ESTADO.entries = [{
  id: "e1", entryName: "Participante Um", payerName: "Participante Um",
  paymentMethod: "CashApp", participantEmail: "participante.um@example.invalid",
  createdAt: "2020-01-01T00:00:00.000Z",
  picks: {
    matches: {
      "sf-1": {
        first: { goalsHome: 0, goalsAway: 0 },
        second: { goalsHome: 0, goalsAway: 1 },
      },
      "sf-2": {
        first: { goalsHome: 0, goalsAway: 2 },
        second: { goalsHome: 1, goalsAway: 0 },
      },
      "final-1": { single: { goalsHome: 1, goalsAway: 0 } },
    },
    qualified: {
      "espn-gremio_internacional": "A", // Internacional previsto, embora Grêmio tenha avançado de verdade
      "espn-atletico-mg_cruzeiro": "A", // Cruzeiro previsto, embora Atlético-MG tenha avançado
      "espn-vasco_vitoria": "B", // Vitória prevista, embora Vasco tenha avançado
      "espn-palmeiras_santos": "A", // Palmeiras previsto e real
      "sf-1": "A",      // Internacional previsto finalista
      "sf-2": "B",      // Palmeiras previsto finalista
      "final-1": "A",   // Internacional campeão
    },
  },
}];
ESTADO.paid = { e1: true };

const srv = await startStaticServer(PORT, RAIZ);
const browser = await chromium.launch();

async function openState(estado) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript((s) => {
    localStorage.setItem("bolao_cdb2026_state", JSON.stringify(s));
  }, estado);
  await page.route("**/rest/v1/**", route => route.abort());
  await page.route("**/functions/v1/**", route => route.abort());
  await page.route("**cdn.jsdelivr.net/**", route =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("[data-rank-toggle]")]
      .find(b => (b.getAttribute("aria-label") || "").includes("Participante Um"));
    btn?.click();
  });
  await page.waitForTimeout(350);
  const rows = await page.evaluate(() => {
    const d = document.querySelector('[data-rank-detail="e1"]');
    if (!d) return null;
    return [...d.querySelectorAll("tbody tr")].map(tr =>
      [...tr.querySelectorAll("td")].map(td => (td.textContent || "").trim()));
  });
  return { page, errors, rows };
}

const championRow = rows => rows?.find(r => r[0]?.includes("Campeão"));
const runnerRow = rows => rows?.find(r => r[0]?.includes("Vice"));

try {
  console.log("\nCDB2026 — SIDE vs TEAM / campeão previsto\n");

  // 1) A semifinal real JÁ EXISTE com Grêmio, mas isso não pode mudar o bracket previsto.
  const a = await openState(ESTADO);
  test("sem erro ao carregar semifinal materializada", () =>
    assert(a.errors.length === 0, JSON.stringify(a.errors)));
  test("CAMPEAO_PREVISTO_E_INTERNACIONAL — materialização não troca o time previsto", () =>
    assert(championRow(a.rows)?.[1] === "Internacional",
      `campeão mostrado: ${JSON.stringify(championRow(a.rows))}; rows=${JSON.stringify(a.rows)}`));
  test("SIDE_NAO_VIRA_GREMIO — o mesmo lado A não pode ser reaplicado ao bracket real", () =>
    assert(championRow(a.rows)?.[1] !== "Grêmio",
      `regressão SIDE vs TEAM: ${JSON.stringify(championRow(a.rows))}`));
  test("VICE_PREVISTO_E_PALMEIRAS", () =>
    assert(runnerRow(a.rows)?.[1] === "Palmeiras",
      `vice mostrado: ${JSON.stringify(runnerRow(a.rows))}`));
  test("FINAL_PREVISTA_USA_TIMES_DO_PROPRIO_BRACKET", () =>
    assert(a.rows?.some(r => r[0] === "Internacional" && r[2] === "Palmeiras"),
      `final prevista não é Internacional × Palmeiras: ${JSON.stringify(a.rows)}`));
  test("SEMIFINAL_MIGRADA_MOSTRA_REAL_COM_PALPITE_ENTRE_PARENTESES", () =>
    assert(a.rows?.some(r =>
      r[0] === "Grêmio (Internacional)" && r[2] === "Atlético-MG (Cruzeiro)"),
      `esperado Grêmio (Internacional) × Atlético-MG (Cruzeiro): ${JSON.stringify(a.rows)}`));
  test("OUTRA_SEMIFINAL_TAMBEM_PRESERVA_O_PALPITE_ORIGINAL", () =>
    assert(a.rows?.some(r =>
      r[0] === "Vasco (Vitória)" && r[2] === "Palmeiras"),
      `esperado Vasco (Vitória) × Palmeiras: ${JSON.stringify(a.rows)}`));
  await a.page.close();

  // 2) As semifinais terminam. A LINHA factual segue o padrão da Copa:
  //    real (palpite eliminado), mas o resumo de campeão continua sendo o palpite original.
  const aposSemi = clone(ESTADO);
  aposSemi.phases.semifinal.ties["espn-atletico-mg_gremio"].qualifiedTeamId = "A"; // Grêmio
  aposSemi.phases.semifinal.ties["espn-palmeiras_vasco"].qualifiedTeamId = "B";     // Palmeiras
  const b = await openState(aposSemi);
  test("campeão previsto continua Internacional depois do resultado real divergente", () =>
    assert(championRow(b.rows)?.[1] === "Internacional",
      `campeão foi reescrito pela realidade: ${JSON.stringify(championRow(b.rows))}`));
  test("linha factual mantém o padrão da Copa: real (palpite) nos dois lados migrados", () =>
    assert(b.rows?.some(r =>
      r[0] === "Grêmio (Internacional)" && r[2] === "Atlético-MG (Cruzeiro)"),
      `linha factual incorreta: ${JSON.stringify(b.rows)}`));
  test("CLASSIFICADO_NAO_PONTUA_POR_MERA_COINCIDENCIA_DE_SIDE", () => {
    const row = b.rows?.find(r => r.join(" ").includes("Classificado")
      && r.join(" ").includes("Grêmio (Internacional)"));
    assert(row, `linha Classificado da sf-1 não encontrada: ${JSON.stringify(b.rows)}`);
    assert(!row.includes("+5"),
      `Internacional previsto ganhou +5 porque Grêmio também ocupou o lado A: ${JSON.stringify(row)}`);
    assert(row.includes("Internacional") && row.includes("Grêmio"),
      `linha não preserva previsto e real separadamente: ${JSON.stringify(row)}`);
  });
  await b.page.close();

  // 3) FUTURO CRÍTICO: até depois da FINAL real ser materializada, o resumo previsto não pode
  //    passar a usar os finalistas reais. Isso também protege o bônus de campeão/vice, porque
  //    scoreEntry() consome predictedPodium().
  const aposFinalMaterializada = clone(aposSemi);
  aposFinalMaterializada.phases.final.ties = {
    "espn-gremio_palmeiras": {
      teamA: "Grêmio", teamB: "Palmeiras",
      matches: { single: { homeTeam: "Grêmio", awayTeam: "Palmeiras",
                           goalsHome: 2, goalsAway: 1, status: "FINAL" } },
      qualifiedTeamId: "A",
    },
  };
  const c = await openState(aposFinalMaterializada);
  test("FINAL_MATERIALIZADA_NAO_REESCREVE_CAMPEAO_PREVISTO", () =>
    assert(championRow(c.rows)?.[1] === "Internacional",
      `final real reescreveu o palpite: ${JSON.stringify(championRow(c.rows))}`));
  test("campeão previsto errado NÃO recebe bônus só por compartilhar side A com campeão real", () => {
    const r = championRow(c.rows);
    assert(r, "linha de campeão ausente");
    assert(!r.some(cell => /^\+\d+$/.test(cell)),
      `bônus indevido por SIDE vs TEAM: ${JSON.stringify(r)}`);
  });
  test("FINAL_CLASSIFICADO_TAMBEM_NAO_PONTUA_POR_SIDE", () => {
    const row = c.rows?.find(r => r.join(" ").includes("Classificado")
      && r.join(" ").includes("Grêmio (Internacional)"));
    assert(row, `linha Classificado da final não encontrada: ${JSON.stringify(c.rows)}`);
    assert(!row.includes("+5"),
      `final deu +5 por side A apesar de Internacional previsto != Grêmio real: ${JSON.stringify(row)}`);
  });
  await c.page.close();

  // Evidência estrutural: a entrada original continua intacta no fixture.
  test("fixture usa os IDs/topologia reais: Internacional nas quartas, sf-1 A, final-1 A", () =>
    assert(ESTADO.entries[0].picks.qualified["espn-gremio_internacional"] === "A" &&
           ESTADO.entries[0].picks.qualified["sf-1"] === "A" &&
           ESTADO.entries[0].picks.qualified["final-1"] === "A",
      "fixture deixou de representar a cascata que causou o incidente"));
} finally {
  await browser.close();
  await srv.stop();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0
  ? "✓ CDB PREDICTED TEAM IDENTITY PASSED"
  : "✗ CDB PREDICTED TEAM IDENTITY FAILED");
process.exit(fail === 0 ? 0 : 1);
