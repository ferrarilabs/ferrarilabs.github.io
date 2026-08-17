#!/usr/bin/env node
/**
 * CDB2026 — a identidade da entrada e VISIVEL para o participante e editavel por ninguem.
 *
 * ─── DE ONDE VEIO ────────────────────────────────────────────────────────────────────────────
 *
 * Pedido do Alan Rech: ao abrir o link personalizado, o participante precisa ver de imediato QUAL
 * entrada esta editando. Sem essa confirmacao, a unica forma de saber que se abriu o link certo e
 * reconhecer os proprios palpites — e quem ainda nao palpitou nao tem como reconhecer nada.
 *
 * ─── O QUE ESTE GATE TRAVA, E POR QUE CADA METADE IMPORTA ────────────────────────────────────
 *
 * A metade de INTEGRIDADE ja estava garantida no servidor antes deste pedido: o salvamento do
 * participante vai por `cdb_save_my_picks(p_token, p_client_ref, p_picks)`, uma RPC que nao aceita
 * nome nenhum. Renomear pelo formulario era estruturalmente impossivel.
 *
 * Mas "impossivel" e "obviamente impossivel" nao sao a mesma coisa para quem esta olhando a tela.
 * Um campo editavel convida a editar, e a edicao seria descartada em silencio. Este gate trava as
 * duas metades juntas — o que a tela PROMETE e o que o servidor FAZ — porque elas ja divergiram
 * uma vez e nada media isso.
 *
 * ─── HERMETICO ───────────────────────────────────────────────────────────────────────────────
 *
 * Servidor estatico local + Playwright. TODA rota `/rest/v1/**` e interceptada: `cdb_my_entry`
 * devolve entradas SINTETICAS, `cdb_save_my_picks` e capturado e nunca sai da maquina, e qualquer
 * outra rota e abortada. Nenhum participante real, nenhum token real, nenhum e-mail, nenhuma
 * escrita em producao.
 *
 * Uso: node bolao/cdb2026/scripts/test_entry_name_readonly.mjs
 */

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStaticServer } from "../../scripts/static_server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(HERE, "..", "..", "..");
const PORT = 8215;   // unico: ver bolao/scripts/test_harness_ports_unique.mjs

let pass = 0, fail = 0;
const test = async (n, f) => {
  try { await f(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

// Entradas sinteticas. "Alan CDB" e o nome do proprio pedido; a segunda existe so para provar que
// abrir outra entrada nao mostra a primeira.
const ENTRADAS = {
  "tok-alan-sintetico":  { id: "e-alan",  entryName: "Alan CDB",        picks: {}, updatedAt: "2026-08-16T12:00:00Z" },
  "tok-outra-sintetica": { id: "e-outra", entryName: "Entrada Dois .invalid", picks: {}, updatedAt: "2026-08-16T12:00:00Z" },
};

const salvamentos = [];

const srv = await startStaticServer(PORT, RAIZ);
const browser = await chromium.launch();

/**
 * Estado local sintetico com as duas entradas.
 *
 * NAO e decoracao: `renderNewEntryCard()` so revela o cartao quando `editingEntryIsValid()` acha
 * o id da entrada no roster carregado. Sem o roster, o campo existe, tem o valor certo, esta
 * readonly — e fica INVISIVEL. A primeira versao deste harness bloqueava toda a rota `/rest/v1/**`
 * e por isso media uma tela que a producao nunca mostra: reprovava a visibilidade por culpa do
 * proprio teste. Um harness que nao modela o estado de producao mede outra coisa.
 */
const ESTADO = {
  entries: Object.values(ENTRADAS).map((e) => ({ ...e, picks: {} })),
  results: {}, deletedIds: [], auditLog: [],
};

async function novaPagina() {
  const page = await browser.newPage();
  await page.addInitScript((st) => {
    localStorage.setItem("bolao_cdb2026_state", JSON.stringify(st));
  }, ESTADO);
  await page.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/cdb_my_entry")) {
      let token = "";
      try { token = JSON.parse(route.request().postData() || "{}").p_token || ""; } catch {}
      const entrada = ENTRADAS[token] || null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(entrada) });
    }
    if (url.includes("/rpc/cdb_save_my_picks")) {
      let corpo = {};
      try { corpo = JSON.parse(route.request().postData() || "{}"); } catch {}
      salvamentos.push(corpo);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.abort();
  });
  return page;
}

async function abrirComToken(page, token) {
  // `?e=` alem do fragmento: navegar para uma URL que difere SO no `#` e navegacao de mesmo
  // documento — a pagina nao recarrega e o app nunca reexecuta a carga por token. O harness
  // mediria "o nome antigo ficou" quando na verdade nada tinha sido pedido de novo. Abrir um link
  // personalizado e sempre uma carga completa; e isso que se modela aqui.
  await page.goto(`http://localhost:${PORT}/bolao/cdb2026/?e=${encodeURIComponent(token)}#t=${token}`,
                  { waitUntil: "load" });
  await page.waitForTimeout(900);
  await irParaPalpites(page);
}

/**
 * Abre a secao de palpites, como o participante faz.
 *
 * `autoLoadFromSecureLink()` carrega a entrada e monta o formulario, mas NAO troca de secao: o
 * link personalizado cai na secao padrao e o participante clica em "Palpites". Medir a
 * visibilidade logo apos o load reprovava um `<section id="entry">` com `display:none` que a
 * producao tambem tem naquele instante — o campo estava certo, a tela e que ainda nao tinha sido
 * aberta. Um harness que pula o passo que o usuario da mede uma tela que ninguem ve.
 */
async function irParaPalpites(page) {
  // Por `data-section`, nao por texto: o rotulo passa pelo i18n (tres idiomas) e casar por
  // "palpite" clicaria no elemento errado no dia em que a traducao mudar.
  //
  // O botao e DESABILITADO depois do cutoff da fase (`navEntryBtn.disabled = isPastEntryCutoff()`,
  // init()), e o app cai em "ranking". Isso esta certo e nao se mexe aqui. Mas quem esta sob teste
  // e o CAMPO — se o nome aparece e se da para edita-lo —, nao o portao de prazo, que tem gate
  // proprio (`test_phase_lifecycle.mjs`). Entao o botao e reabilitado so para alcancar a tela.
  //
  // Fabricar uma fase "aberta" no fixture exigiria inventar sorteio oficial com proveniencia
  // valida: seria o teste ensinando o app a aceitar um sorteio que nao existe — muito mais
  // perigoso do que clicar num botao.
  await page.evaluate(() => {
    const b = document.querySelector('[data-section="entry"]');
    if (b) { b.disabled = false; b.click(); }
  });
  await page.waitForTimeout(500);
}

const campo = (page) => page.evaluate(() => {
  const el = document.getElementById("entryName");
  if (!el) return null;
  return {
    valor: el.value,
    readOnly: el.readOnly,
    disabled: el.disabled,
    ariaReadonly: el.getAttribute("aria-readonly"),
    visivel: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    placeholder: el.getAttribute("placeholder"),
  };
});

console.log("\nCDB2026 — nome da entrada visivel e nao editavel\n");

// ── A. a entrada autenticada aparece ──────────────────────────────────────────────────────────
const pA = await novaPagina();
await abrirComToken(pA, "tok-alan-sintetico");

await test("A. o nome da entrada autenticada aparece exatamente", async () => {
  const c = await campo(pA);
  assert(c, "#entryName nao existe na pagina");
  assert(c.valor === "Alan CDB", `esperado "Alan CDB", veio ${JSON.stringify(c.valor)}`);
});

await test("A2. o campo esta VISIVEL (confirmacao so serve se der para ler)", async () => {
  const c = await campo(pA);
  assert(c.visivel, "#entryName existe mas nao esta visivel");
});

await test("A3. nao parece campo vazio esperando digitacao", async () => {
  const c = await campo(pA);
  assert(!c.placeholder, `placeholder presente (${c.placeholder}) — some atras do valor hoje e `
    + "reaparece como 'campo vazio' no dia em que o valor faltar");
});

// ── B. nao editavel ───────────────────────────────────────────────────────────────────────────
await test("B. readonly (e NAO disabled — disabled sai do form e do foco)", async () => {
  const c = await campo(pA);
  assert(c.readOnly === true, "#entryName nao esta readonly");
  assert(c.disabled === false, "#entryName esta disabled; readonly e a semantica certa aqui");
  assert(c.ariaReadonly === "true", "falta aria-readonly para o leitor de tela");
});

await test("B2. digitar no campo nao muda o valor", async () => {
  await pA.focus("#entryName");
  await pA.keyboard.type("XXXX");
  const c = await campo(pA);
  assert(c.valor === "Alan CDB", `o teclado alterou o campo: ${JSON.stringify(c.valor)}`);
});

await test("B3. colar no campo nao muda o valor", async () => {
  await pA.evaluate(() => {
    const el = document.getElementById("entryName");
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", "COLADO");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const c = await campo(pA);
  assert(c.valor === "Alan CDB", `a colagem alterou o campo: ${JSON.stringify(c.valor)}`);
});

// ── C. adulteracao direta do DOM ──────────────────────────────────────────────────────────────
await test("C. adulterar o DOM nao faz o save carregar nome nenhum", async () => {
  salvamentos.length = 0;
  await pA.evaluate(() => {
    document.getElementById("entryName").value = "HACKED NAME";
    document.getElementById("saveEntryBtn")?.click();
  });
  await pA.waitForTimeout(900);
  assert(salvamentos.length > 0, "nenhuma chamada a cdb_save_my_picks foi capturada");
  for (const s of salvamentos) {
    const chaves = Object.keys(s).sort().join(",");
    assert(chaves === "p_client_ref,p_picks,p_token",
      `o save levou parametros alem de token/ref/picks: ${chaves}`);
    const bruto = JSON.stringify(s);
    assert(!/HACKED/.test(bruto), "o nome adulterado viajou no corpo do save");
    assert(!/entryName/i.test(bruto), "o corpo do save menciona entryName — a RPC nao aceita nome");
  }
});

// ── D. o save legitimo continua funcionando ───────────────────────────────────────────────────
await test("D. o save do participante continua chamando a RPC de palpites", async () => {
  assert(salvamentos.length > 0, "o caminho de save nao foi exercitado");
  assert("p_picks" in salvamentos[0], "o save nao levou p_picks");
});

// ── E. recarga ────────────────────────────────────────────────────────────────────────────────
await test("E. depois de recarregar, o mesmo nome autenticado volta", async () => {
  await pA.reload({ waitUntil: "load" });
  await pA.waitForTimeout(900);
  await irParaPalpites(pA);
  const c = await campo(pA);
  assert(c.valor === "Alan CDB", `apos recarga veio ${JSON.stringify(c.valor)}`);
  assert(c.readOnly === true, "apos recarga o campo voltou editavel");
});

// ── F/G. outra entrada, sem vazamento ─────────────────────────────────────────────────────────
await test("F. outra entrada autenticada mostra o PROPRIO nome", async () => {
  const pB = await novaPagina();
  await abrirComToken(pB, "tok-outra-sintetica");
  const c = await campo(pB);
  assert(c.valor === "Entrada Dois .invalid", `veio ${JSON.stringify(c.valor)}`);
  await pB.close();
});

await test("G. navegar entre entradas na MESMA aba nao deixa nome velho", async () => {
  // O caso que um teste de aba nova nunca pega: estado em memoria sobrevivendo a troca de token.
  await abrirComToken(pA, "tok-outra-sintetica");
  const c = await campo(pA);
  assert(c.valor !== "Alan CDB", "o nome da entrada ANTERIOR sobreviveu a troca de token");
  assert(c.valor === "Entrada Dois .invalid", `veio ${JSON.stringify(c.valor)}`);
});

// ── H. identidade irresolvivel falha fechada ──────────────────────────────────────────────────
await test("H. token invalido nao inventa nome", async () => {
  const pC = await novaPagina();
  await abrirComToken(pC, "tok-que-nao-existe");
  const c = await campo(pC);
  assert(!c.valor, `token invalido produziu um nome: ${JSON.stringify(c.valor)}`);
  await pC.close();
});

await pA.close();
await browser.close();
await srv.close?.();

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ ENTRY NAME READONLY PASSED\n" : "✗ ENTRY NAME READONLY FAILED\n");
process.exit(fail === 0 ? 0 : 1);
