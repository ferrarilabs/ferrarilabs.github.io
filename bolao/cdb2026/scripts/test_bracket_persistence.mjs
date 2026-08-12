#!/usr/bin/env node
/**
 * CDB2026 — o bracket completo sobrevive a Salvar + recarregar?
 *
 * O DEFEITO RELATADO (2026-08-12)
 * -------------------------------
 * O operador completou quartas -> semifinal -> final -> campeao, salvou, recarregou -- e a
 * parte de baixo do bracket sumiu. Quartas voltaram; semifinal, final e campeao viraram texto
 * derivado/pendente outra vez.
 *
 * "Salvou com sucesso" e "os dados voltam" sao coisas diferentes, e so a segunda importa para
 * quem palpitou. A RPC devolver 200 nao prova nada sobre a volta.
 *
 * O QUE ESTE TESTE FAZ (caminho REAL, dados sinteticos)
 * ----------------------------------------------------
 * Usa o app deployado com o caminho SEGURO (token no fragmento), e intercepta o Supabase na
 * ROTA -- entao nada de rede real e nenhuma entrada de participante e tocada:
 *
 *   1. abre o formulario com uma entrada sintetica
 *   2. completa QF -> SF -> Final -> campeao
 *   3. clica Salvar UMA vez
 *   4. CAPTURA o payload exato que iria para a RPC
 *   5. recarrega a pagina, devolvendo esse payload como o que ficou gravado
 *   6. compara o bracket renderizado com o de antes
 *
 * O invariante e o do enunciado: `antes == canonicalize(deserialize(persisted(serialize(antes))))`.
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../../scripts/static_server.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const PORT = 8254;   // único: ver bolao/scripts/test_harness_ports_unique.mjs

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const ENTRADA_ID = "e-sintetica-1";

const ESTADO = {
  entries: [{ id: ENTRADA_ID, entryName: "Participante Sintético", picks: {} }],
  deletedIds: [], paid: {}, results: {}, auditLog: [], meta: {},
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
      cutoffAt: "2099-12-31T00:00:00Z", ties: {},
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

/** Sobe a página no caminho SEGURO, com o Supabase inteiramente falsificado na rota. */
async function abrir(page, picksGravados, capturarSave) {
  await page.addInitScript((e) => localStorage.setItem("bolao_cdb2026_state", JSON.stringify(e)), ESTADO);

  await page.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    const corpo = (() => { try { return JSON.parse(route.request().postData() || "{}"); }
                          catch { return {}; } })();

    if (url.includes("cdb_my_entry")) {
      // A entrada que o servidor "tem": identidade + os palpites gravados.
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ id: ENTRADA_ID, entryName: "Participante Sintético",
                               picks: picksGravados || {} }) });
    }
    if (url.includes("cdb_save_my_picks")) {
      if (capturarSave) capturarSave(corpo.p_picks);
      return route.fulfill({ status: 200, contentType: "application/json",
                             body: JSON.stringify({ updated: true }) });
    }
    // Estado remoto: devolve o mesmo fixture, para o app não divergir do que já está local.
    if (url.includes("bolao_state")) {
      return route.fulfill({ status: 200, contentType: "application/json",
                             body: JSON.stringify([{ state: ESTADO }]) });
    }
    return route.abort();
  });

  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/#t=token-sintetico`, { waitUntil: "load" });
  await page.waitForTimeout(1100);   // deixa o auto-load pelo link seguro terminar
}

async function vencerComTimeA(page, tieId, gA = 2, gB = 0) {
  await page.evaluate(({ tieId, gA, gB }) => {
    const bloco = document.querySelector(`#tie-${CSS.escape(tieId)}`);
    if (!bloco) return false;
    const set = (el, v) => { if (!el) return; el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true })); };
    const porPerna = (p, c, f) => {
      set(bloco.querySelector(`.pk-goals-home[data-leg="${p}"]`), c);
      set(bloco.querySelector(`.pk-goals-away[data-leg="${p}"]`), f);
    };
    const pernas = [...bloco.querySelectorAll(".pk-goals-home")].map(e => e.dataset.leg);
    if (pernas.includes("single")) porPerna("single", gA, gB);
    else { porPerna("first", gA, gB); porPerna("second", 0, 0); }
    return true;
  }, { tieId, gA, gB });
  await page.waitForTimeout(400);
}

/** Retrato do bracket como a TELA o mostra -- é isso que o participante perde ou recupera. */
const retrato = (page) => page.evaluate(() => {
  const blocos = [...document.querySelectorAll("#pickForm .tie-pick-block")].map(b => ({
    tieId: b.dataset.tieId,
    times: [...b.querySelectorAll(".pk-team-name, .tie-team")].map(e => e.textContent.trim()),
    placar: [...b.querySelectorAll(".pk-goals-home, .pk-goals-away")].map(e => e.value),
    vencedor: b.querySelector(".pk-qualified")?.value || "",
  }));
  const podio = document.getElementById("podio-previsto")?.textContent.replace(/\s+/g, " ").trim() || "";
  return { blocos, podio };
});

console.log("\nCDB2026 — o bracket sobrevive a Salvar + recarregar?\n");

try {
  // ── 1. completa o bracket e SALVA ────────────────────────────────────────────────────────
  let payloadSalvo = null;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await abrir(page, {}, (p) => { payloadSalvo = p; });

  for (const t of ["t-a", "t-b", "t-c", "t-d"]) await vencerComTimeA(page, t);
  await vencerComTimeA(page, "sf-1", 1, 0);
  await vencerComTimeA(page, "sf-2", 1, 0);
  await vencerComTimeA(page, "final-1", 3, 1);

  const antes = await retrato(page);
  test("o bracket completo está na tela antes de salvar", () => {
    const ids = antes.blocos.map(b => b.tieId);
    assert(ids.includes("sf-1") && ids.includes("sf-2") && ids.includes("final-1"),
      `faltam confrontos: ${JSON.stringify(ids)}`);
    assert(/CAMPE|Cruzeiro|Vasco|Palmeiras|Internacional/.test(antes.podio),
      `pódio vazio antes de salvar: ${antes.podio}`);
  });

  await page.evaluate(() => document.getElementById("saveEntryBtn")?.click());
  await page.waitForTimeout(900);

  // ── 2. o PAYLOAD tem o bracket inteiro? ──────────────────────────────────────────────────
  test("SAVE_SERIALIZATION_COMPLETE — o payload leva QF, SF e final", () => {
    assert(payloadSalvo, "o Salvar não chegou a chamar cdb_save_my_picks");
    const q = payloadSalvo.qualified || {};
    const m = payloadSalvo.matches || {};
    for (const id of ["t-a", "t-b", "t-c", "t-d", "sf-1", "sf-2", "final-1"]) {
      assert(id in m, `matches sem ${id}: ${JSON.stringify(Object.keys(m))}`);
      assert(id in q, `qualified sem ${id}: ${JSON.stringify(Object.keys(q))}`);
    }
  });

  test("OVERLAY_MERGED_BEFORE_SAVE — nada ficou só no cliente", () => {
    const q = payloadSalvo.qualified || {};
    assert(q["final-1"], "o vencedor da final não entrou no payload — ficou só na tela");
  });

  await page.close();

  // ── 3. RECARREGA devolvendo exatamente o que foi salvo ───────────────────────────────────
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await abrir(page2, payloadSalvo, null);
  await page2.waitForTimeout(600);
  const depois = await retrato(page2);


  const bloco = (r, id) => r.blocos.find(b => b.tieId === id);

  test("QF_PERSISTENCE — as quartas voltam", () => {
    for (const id of ["t-a", "t-b", "t-c", "t-d"]) {
      const a = bloco(antes, id), d = bloco(depois, id);
      assert(d, `sumiu o confronto ${id} depois do reload`);
      assert(JSON.stringify(a.placar) === JSON.stringify(d.placar),
        `${id}: placar ${JSON.stringify(a.placar)} -> ${JSON.stringify(d.placar)}`);
      assert(a.vencedor === d.vencedor, `${id}: vencedor ${a.vencedor} -> ${d.vencedor}`);
    }
  });

  test("SF_PERSISTENCE — a semifinal volta, com placar e vencedor", () => {
    for (const id of ["sf-1", "sf-2"]) {
      const a = bloco(antes, id), d = bloco(depois, id);
      assert(d, `a semifinal ${id} NÃO voltou depois do reload`);
      assert(JSON.stringify(a.placar) === JSON.stringify(d.placar),
        `${id}: placar ${JSON.stringify(a.placar)} -> ${JSON.stringify(d.placar)}`);
      assert(a.vencedor === d.vencedor, `${id}: vencedor ${a.vencedor} -> ${d.vencedor}`);
    }
  });

  test("FINAL_PERSISTENCE — a final volta, com placar e vencedor", () => {
    const a = bloco(antes, "final-1"), d = bloco(depois, "final-1");
    assert(d, "a final NÃO voltou depois do reload");
    assert(JSON.stringify(a.placar) === JSON.stringify(d.placar),
      `final: placar ${JSON.stringify(a.placar)} -> ${JSON.stringify(d.placar)}`);
    assert(a.vencedor === d.vencedor, `final: vencedor ${a.vencedor} -> ${d.vencedor}`);
  });

  test("CHAMPION_PERSISTENCE / RUNNER_UP_PERSISTENCE — o pódio volta idêntico", () =>
    assert(antes.podio === depois.podio,
      `pódio antes: ${JSON.stringify(antes.podio)}\n      depois: ${JSON.stringify(depois.podio)}`));

  test("COMPLETE_BRACKET_AFTER_RELOAD — nenhum texto de pendência sobrou", async () => {
    assert(!/Vencedor de/.test(JSON.stringify(depois.blocos)),
      "algum confronto voltou como dependência em vez de clube");
  });

  // ── FALSE_SAVE_SUCCESS ──────────────────────────────────────────────────────────────────
  //
  // "Salvo" so pode aparecer DEPOIS de o servidor aceitar. Dizer sucesso a partir do estado
  // local e a forma mais cara de mentir para quem palpitou: a pessoa fecha a aba confiando, e o
  // palpite nao existe em lugar nenhum.
  const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page3.addInitScript((e) => localStorage.setItem("bolao_cdb2026_state", JSON.stringify(e)), ESTADO);
  await page3.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("cdb_my_entry")) {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ id: ENTRADA_ID, entryName: "Participante Sintético",
                               picks: payloadSalvo }) });
    }
    if (url.includes("cdb_save_my_picks")) {
      // O servidor RECUSA (prazo vencido, por exemplo).
      return route.fulfill({ status: 400, contentType: "application/json",
        body: JSON.stringify({ message: "CUTOFF_PASSADO: fase quartas fechou" }) });
    }
    if (url.includes("bolao_state")) {
      return route.fulfill({ status: 200, contentType: "application/json",
                             body: JSON.stringify([{ state: ESTADO }]) });
    }
    return route.abort();
  });
  await page3.goto(`http://localhost:${PORT}/bolao/cdb2026/#t=token-sintetico`, { waitUntil: "load" });
  await page3.waitForTimeout(1100);
  await page3.evaluate(() => document.getElementById("saveEntryBtn")?.click());
  await page3.waitForTimeout(900);
  const avisos = await page3.evaluate(() =>
    [...document.querySelectorAll(".toast, [class*=toast]")].map(e => e.textContent || "").join(" | "));
  await page3.close();

  test("FALSE_SAVE_SUCCESS = 0 — servidor recusando não vira 'salvo'", () =>
    assert(!/salvo com sucesso|savedSuccess/i.test(avisos),
      `a tela disse sucesso com o servidor recusando: ${avisos}`));

  test("SAVE_RELOAD_ROUNDTRIP — o retrato do bracket é o mesmo", () =>
    assert(JSON.stringify(antes) === JSON.stringify(depois),
      "o bracket renderizado difere depois do round-trip"));

} finally {
  await browser.close().catch(() => {});
  try { srv.stop(); } catch { /* já parado */ }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ BRACKET PERSISTENCE PASSED\n" : "✗ BRACKET PERSISTENCE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
