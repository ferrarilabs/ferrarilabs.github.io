#!/usr/bin/env node
/**
 * CDB2026 — a recusa do servidor no save precisa CHEGAR ao diagnóstico. Issue #258.
 *
 * ─── DE ONDE VEIO ────────────────────────────────────────────────────────────────────────────
 *
 * Em 2026-08-20 um participante reportou "Erro ao salvar. Tente novamente." ao salvar a entrada.
 * A investigação conseguiu EXCLUIR causas com evidência de produção — a fase ativa fecha só em
 * 2026-08-25T23:00Z (então nem `CUTOFF_PASSADO` nem `FASE_FECHADA`), e a versão no ar era a mesma
 * do repositório (v3.129, então não era deploy velho). E parou aí.
 *
 * Parou porque o motivo real nunca existiu em lugar nenhum: `cdbRpc()` descartava o corpo da
 * resposta do PostgREST e lançava só "RPC ... respondeu 400". `cdb_save_my_picks` recusa por
 * motivos MUITO diferentes — `ACESSO_NEGADO` (token/entrada), `FASE_FECHADA`, `CUTOFF_PASSADO`,
 * `CUTOFF_ILEGIVEL`, payload inválido — e todos chegavam idênticos: o mesmo toast na tela e o
 * mesmo "respondeu 400" no console. Um relato de usuário virava um beco sem saída.
 *
 * ─── AS DUAS METADES, JUNTAS ─────────────────────────────────────────────────────────────────
 *
 * Este gate trava as duas coisas ao mesmo tempo, porque uma sem a outra seria uma regressão:
 *
 *   1. o MOTIVO do servidor aparece no erro (e portanto no console de quem chama);
 *   2. a MENSAGEM DO PARTICIPANTE continua exatamente a mesma.
 *
 * A metade 2 não é detalhe. Expor `ACESSO_NEGADO` na tela seria trocar um problema de suporte por
 * um oráculo de enumeração — a própria RPC devolve falha genérica de propósito quando o token não
 * resolve (ver `loadOwnEntryByToken`). Diagnóstico é para quem lê o console, não para a tela.
 *
 * ─── HERMÉTICO ──────────────────────────────────────────────────────────────────────────────
 *
 * Servidor estático local + Playwright, toda rota `/rest/v1/**` interceptada. Nenhuma chamada sai
 * da máquina e nenhum dado real é usado — as entradas são sintéticas.
 *
 * Uso: node bolao/cdb2026/scripts/test_save_error_diagnosable.mjs
 */

import { chromium } from "playwright";
import { startStaticServer } from "../../scripts/static_server.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..", "..");
const PORT = 8216;   // unico: ver bolao/scripts/test_harness_ports_unique.mjs

let pass = 0, fail = 0;
const test = async (n, f) => {
  try { await f(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const TOKEN = "tok-sintetico-258";
const ENTRADA = { id: "e-sintetica-258", entryName: "Entrada Sintetica .invalid", picks: {}, updatedAt: "2026-08-16T12:00:00Z" };
const ESTADO = { entries: [{ ...ENTRADA }], results: {}, deletedIds: [], auditLog: [] };

/** O texto que o participante vê hoje. Se mudar, este gate reprova — de propósito. */
const TOAST_ESPERADO = "Erro ao salvar. Tente novamente.";

const srv = await startStaticServer(PORT, RAIZ);
const browser = await chromium.launch();

/** Abre uma página cujo `cdb_save_my_picks` recusa com o motivo pedido. */
async function paginaComRecusa(motivo, status = 400) {
  const page = await browser.newPage();
  const erros = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  page.on("pageerror", (e) => erros.push(String(e)));

  await page.addInitScript((st) => {
    localStorage.setItem("bolao_cdb2026_state", JSON.stringify(st));
  }, ESTADO);

  await page.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/cdb_my_entry")) {
      let token = "";
      try { token = JSON.parse(route.request().postData() || "{}").p_token || ""; } catch { /* corpo ausente */ }
      return route.fulfill({ status: 200, contentType: "application/json",
                             body: JSON.stringify(token === TOKEN ? ENTRADA : null) });
    }
    if (url.includes("/rpc/cdb_save_my_picks")) {
      // Forma REAL de erro do PostgREST para um `raise exception` em plpgsql.
      return route.fulfill({ status, contentType: "application/json",
                             body: JSON.stringify({ code: "P0001", message: motivo, details: null, hint: null }) });
    }
    return route.abort();
  });

  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/?e=${encodeURIComponent(TOKEN)}#t=${TOKEN}`,
                  { waitUntil: "load" });
  await page.waitForTimeout(900);
  // Mesmo motivo do harness irmão (test_entry_name_readonly.mjs): o botão de navegação fica
  // desabilitado depois do cutoff e o app cai em "ranking". Quem está sob teste é o caminho de
  // erro do save, não o portão de prazo — que tem gate próprio.
  await page.evaluate(() => {
    const b = document.querySelector('[data-section="entry"]');
    if (b) { b.disabled = false; b.click(); }
  });
  await page.waitForTimeout(500);
  return { page, erros };
}

async function salvarECapturar(page, erros) {
  erros.length = 0;
  // Limpa os toasts JÁ presentes antes de clicar. Sem isto o teste lia o toast de "Entrada
  // carregada" — emitido na abertura do link — e concluía que a mensagem de erro tinha mudado.
  // O harness estava medindo a tela do passo anterior.
  await page.evaluate(() => {
    document.querySelectorAll(".toast, [class*=toast]").forEach((e) => e.remove());
    document.getElementById("saveEntryBtn")?.click();
  });
  await page.waitForTimeout(900);
  const toast = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".toast, [class*=toast]")].filter((e) => e.offsetParent !== null);
    return els.length ? els[els.length - 1].textContent.trim() : "";
  });
  return { toast, erros: [...erros] };
}

console.log("\nCDB2026 — a recusa do servidor no save é diagnosticável (Issue #258)\n");

// ── 1. o motivo do servidor chega ao console ─────────────────────────────────────────────────
for (const motivo of ["ACESSO_NEGADO", "CUTOFF_PASSADO: fase fase-6 fechou em 2026-08-25 23:00:00+00", "FASE_FECHADA: nenhuma fase ativa declarada"]) {
  await test(`o motivo "${motivo.split(":")[0]}" aparece no erro registrado`, async () => {
    const { page, erros } = await paginaComRecusa(motivo);
    try {
      const r = await salvarECapturar(page, erros);
      const juntos = r.erros.join(" | ");
      assert(r.erros.length > 0, "nenhum erro foi registrado no console — a recusa passou despercebida");
      assert(juntos.includes(motivo.split(":")[0]),
        `o motivo do servidor não chegou ao console. Registrado: ${juntos.slice(0, 300)}`);
    } finally { await page.close(); }
  });
}

// ── 2. a tela do participante NÃO muda ───────────────────────────────────────────────────────
await test("o participante continua vendo a MESMA mensagem genérica", async () => {
  const { page, erros } = await paginaComRecusa("ACESSO_NEGADO");
  try {
    const r = await salvarECapturar(page, erros);
    assert(r.toast === TOAST_ESPERADO,
      `a mensagem visível mudou: ${JSON.stringify(r.toast)} (esperado ${JSON.stringify(TOAST_ESPERADO)})`);
  } finally { await page.close(); }
});

await test("o motivo técnico NUNCA vaza para a tela", async () => {
  const { page, erros } = await paginaComRecusa("ACESSO_NEGADO");
  try {
    const r = await salvarECapturar(page, erros);
    const visivel = await page.evaluate(() => document.body.innerText);
    for (const proibido of ["ACESSO_NEGADO", "P0001", "PostgREST", "respondeu 400"]) {
      assert(!visivel.includes(proibido),
        `detalhe técnico apareceu na tela: ${proibido} — isso seria um oráculo de enumeração`);
    }
    assert(r.toast === TOAST_ESPERADO, "a mensagem genérica precisa continuar sendo a da tela");
  } finally { await page.close(); }
});

// ── 3. resposta sem corpo JSON não pode derrubar o tratamento ────────────────────────────────
await test("recusa sem corpo JSON ainda registra o status, sem estourar", async () => {
  const page = await browser.newPage();
  const erros = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  await page.addInitScript((st) => { localStorage.setItem("bolao_cdb2026_state", JSON.stringify(st)); }, ESTADO);
  await page.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/cdb_my_entry")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ENTRADA) });
    }
    if (url.includes("/rpc/cdb_save_my_picks")) {
      return route.fulfill({ status: 502, contentType: "text/html", body: "<html>gateway</html>" });
    }
    return route.abort();
  });
  try {
    await page.goto(`http://localhost:${PORT}/bolao/cdb2026/?e=${encodeURIComponent(TOKEN)}#t=${TOKEN}`, { waitUntil: "load" });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const b = document.querySelector('[data-section="entry"]');
      if (b) { b.disabled = false; b.click(); }
    });
    await page.waitForTimeout(400);
    erros.length = 0;
    await page.evaluate(() => document.getElementById("saveEntryBtn")?.click());
    await page.waitForTimeout(900);
    const juntos = erros.join(" | ");
    assert(juntos.includes("502"), `o status deveria aparecer mesmo sem corpo JSON. Registrado: ${juntos.slice(0, 200)}`);
  } finally { await page.close(); }
});

await browser.close();
srv.stop();

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ SAVE-ERROR DIAGNOSABILITY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
