#!/usr/bin/env node
/**
 * test_report_ui.mjs — o modal "Reportar problema" (Issue #321).
 *
 * `report_ui.js` e script de navegador (IIFE sobre um `root`), nao modulo. Em vez de duplicar as
 * strings aqui para "testar" copias, o arquivo REAL e carregado sobre um `root` sintetico -- entao
 * o que este teste mede e o codigo que vai para producao, nao um retrato dele.
 *
 * O caso mais importante do arquivo e o mais chato: com a flag desligada, NADA acontece. Nenhum
 * botao, nenhum listener, nenhum no no DOM. Um botao morto e pior que a ausencia dele.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CAMPOS_ACEITOS }
  from "../../support-intake/supabase/functions/user-report-intake/policy.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
function test(nome, fn) {
  try { fn(); pass++; console.log(`  ✓ ${nome}`); }
  catch (e) { fail++; console.log(`  ✗ ${nome}\n      ${e.message}`); }
}

/** DOM minimo: exatamente o que `montar()` toca no caminho ligado. Nada de jsdom por um botao. */
function domFalso() {
  const criados = [];
  function no(tag) {
    const n = {
      tagName: String(tag).toUpperCase(), filhos: [], attrs: {}, textContent: "",
      listeners: {}, open: false, value: "",
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this.filhos.push(c); return c; },
      removeChild(c) { this.filhos = this.filhos.filter((x) => x !== c); return c; },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      querySelectorAll() { return []; },
      focus() {},
      get firstChild() { return this.filhos[0] || null; },
    };
    criados.push(n);
    return n;
  }
  const body = no("body");
  return {
    criados,
    doc: {
      readyState: "complete",
      documentElement: { lang: "pt-BR" },
      body,
      createElement: no,
      createTextNode: (t) => ({ nodeValue: t, tagName: "#text" }),
      addEventListener() {},
      querySelectorAll() { return []; },
      activeElement: null,
    },
  };
}

function carregar(extra = {}) {
  const { doc, criados } = domFalso();
  const root = {
    document: doc,
    navigator: { onLine: true, userAgent: "Mozilla/5.0 Chrome/120" },
    location: { pathname: "/bolao/cdb2026/" },
    innerWidth: 1280, innerHeight: 800,
    crypto: { randomUUID: () => "3ea26fa2-828d-49e5-8a5e-11a15f23f168" },
    fetch: () => Promise.resolve({ ok: true, status: 201 }),
    ...extra,
  };
  // O coletor primeiro: `report_ui.js` le `root.BOLAO_REPORT_CONTEXT` no momento em que carrega.
  for (const f of ["bolao/shared/js/report_safe_context.js", "bolao/shared/js/report_ui.js"]) {
    new Function("window", "globalThis", readFileSync(join(RAIZ, f), "utf8"))(root, root);
  }
  return { root, criados, doc };
}

console.log("\nUI de reporte (#321)\n");

console.log("Idiomas:");

test("os quatro idiomas existem", () => {
  const { root } = carregar();
  const idiomas = root.BOLAO_REPORT_UI.IDIOMAS;
  for (const l of ["pt-BR", "en-US", "es", "ja"]) {
    ok(idiomas.includes(l), `faltando ${l}`);
  }
  eq(idiomas.length, 4, "nem mais nem menos que quatro");
});

test("nenhum idioma tem chave faltando nem sobrando", () => {
  const { root } = carregar();
  const U = root.BOLAO_REPORT_UI;
  const base = Object.keys(U.textos("pt-BR")).sort();
  for (const l of U.IDIOMAS) {
    const k = Object.keys(U.textos(l)).sort();
    eq(k.join(","), base.join(","), `${l} divergiu do pt-BR`);
  }
});

test("nenhuma string ficou vazia em nenhum idioma", () => {
  const { root } = carregar();
  const U = root.BOLAO_REPORT_UI;
  for (const l of U.IDIOMAS) {
    const t = U.textos(l);
    for (const k of Object.keys(t)) {
      ok(typeof t[k] === "string" && t[k].trim().length > 0, `${l}.${k} vazio`);
    }
  }
});

test("idioma desconhecido cai para pt-BR; prefixo de duas letras resolve", () => {
  const { root } = carregar();
  const U = root.BOLAO_REPORT_UI;
  eq(U.textos("kl-KL").trigger, U.textos("pt-BR").trigger, "desconhecido -> pt-BR");
  eq(U.textos(undefined).trigger, U.textos("pt-BR").trigger, "ausente -> pt-BR");
  eq(U.textos("en").trigger, U.textos("en-US").trigger, "en -> en-US");
  eq(U.textos("ja-JP").trigger, U.textos("ja").trigger, "ja-JP -> ja");
  eq(U.textos("es-AR").trigger, U.textos("es").trigger, "es-AR -> es");
});

test("o aviso de privacidade nomeia o que NAO queremos, em todos os idiomas", () => {
  const { root } = carregar();
  const U = root.BOLAO_REPORT_UI;
  // O texto pode ser traduzido, mas nao pode PERDER o aviso -- e o unico texto da plataforma que
  // nao pode divergir em conteudo entre idiomas.
  for (const l of U.IDIOMAS) {
    const p = U.textos(l).privacy;
    ok(p.length > 40, `${l}: aviso curto demais para dizer o que precisa`);
  }
});

console.log("\nBotao morto — a flag desligada nao pode produzir UI:");

for (const [rotulo, valor] of [
  ["ausente", undefined], ["false", false], ['string "true"', "true"],
  ["1", 1], ["null", null], ["objeto", {}],
]) {
  test(`enabled = ${rotulo} => nenhuma UI`, () => {
    const { root, doc } = carregar();
    const destino = doc.createElement("div");
    const antes = destino.filhos.length;
    const r = root.BOLAO_REPORT_UI.montar({
      app: "cdb2026", destino,
      config: { reportProblem: { enabled: valor, endpoint: "https://x.supabase.co/f" } },
    });
    eq(r, null, "montar() devia desistir");
    eq(destino.filhos.length, antes, "nada podia ser anexado ao destino");
  });
}

test("enabled = true mas SEM endpoint => nenhuma UI", () => {
  const { root, doc } = carregar();
  const destino = doc.createElement("div");
  const r = root.BOLAO_REPORT_UI.montar({
    app: "cdb2026", destino, config: { reportProblem: { enabled: true } },
  });
  eq(r, null, "sem endpoint nao ha o que montar");
  eq(destino.filhos.length, 0, "nada anexado");
});

test("sem o coletor de contexto seguro => nenhuma UI", () => {
  // Se `report_safe_context.js` nao carregou, montar assim mesmo significaria enviar um payload
  // montado a mao em outro lugar -- exatamente o que a allowlist existe para impedir.
  const { doc } = domFalso();
  const root = { document: doc, navigator: {}, location: {} };
  new Function("window", "globalThis", readFileSync(join(RAIZ, "bolao/shared/js/report_ui.js"), "utf8"))(root, root);
  const destino = doc.createElement("div");
  const r = root.BOLAO_REPORT_UI.montar({
    app: "cdb2026", destino,
    config: { reportProblem: { enabled: true, endpoint: "https://x.supabase.co/f" } },
  });
  eq(r, null, "sem coletor, nao monta");
});

console.log("\nLigado — o caminho que so existe apos a aceitacao:");

test("enabled = true monta UM gatilho, com rotulo traduzido", () => {
  const { root, doc } = carregar();
  const destino = doc.createElement("div");
  const r = root.BOLAO_REPORT_UI.montar({
    app: "cdb2026", destino,
    config: { reportProblem: { enabled: true, endpoint: "https://x.supabase.co/f" },
              defaultLang: "ja" },
  });
  ok(r && r.gatilho, "devia devolver o gatilho");
  eq(destino.filhos.length, 1, "exatamente um no anexado");
  eq(destino.filhos[0].tagName, "BUTTON", "o gatilho e um <button>, nao um <div> clicavel");
  eq(destino.filhos[0].getAttribute("type"), "button", "type=button para nao submeter formulario");
  eq(destino.filhos[0].textContent, root.BOLAO_REPORT_UI.textos("ja").trigger, "rotulo em japones");
});

test("o gatilho responde a clique (tem listener registrado)", () => {
  const { root, doc } = carregar();
  const destino = doc.createElement("div");
  root.BOLAO_REPORT_UI.montar({
    app: "cdb2026", destino,
    config: { reportProblem: { enabled: true, endpoint: "https://x.supabase.co/f" } },
  });
  const b = destino.filhos[0];
  ok(b.listeners.click && b.listeners.click.length === 1, "um listener de clique");
});

console.log("\nAuto-montagem declarativa:");

test("sem ponto de montagem no DOM, autoMontar nao faz nada", () => {
  const { root } = carregar();
  root.BOLAO_REPORT_UI.autoMontar();  // nao pode lancar
  pass += 0;
});

test("o payload montado pela UI respeita a allowlist do coletor", () => {
  const { root } = carregar();
  const p = root.BOLAO_REPORT_CONTEXT.montarPayload({ app: "cdb2026", window: root });
  // A allowlist vem do SERVIDOR, nao de uma copia aqui. Uma terceira copia so criaria mais um
  // lugar para divergir -- foi exatamente por isso que este caso reprovou quando `noticeVersion`
  // nasceu: a lista estava escrita a mao e envelheceu na primeira mudanca.
  const permitidos = CAMPOS_ACEITOS;
  for (const k of Object.keys(p)) ok(permitidos.includes(k), `campo fora da allowlist: ${k}`);
});

console.log("\nIntegracao contextual (#258): so codigo, nunca o motivo do servidor:");

test("o mapeamento do save do CDB usa SO codigos da allowlist", () => {
  const src = readFileSync(join(RAIZ, "bolao/cdb2026/js/app.js"), "utf8");
  const m = src.match(/function publicaDiagnosticoDeSave[\s\S]*?\n}/);
  ok(m, "helper nao encontrado em bolao/cdb2026/js/app.js");
  const corpo = m[0];
  const { root } = carregar();
  const permitidos = root.BOLAO_REPORT_CONTEXT.DIAGNOSTICOS;
  const usados = (corpo.match(/"[A-Z_]{4,}"/g) || []).map((s) => s.slice(1, -1));
  ok(usados.length > 0, "o helper precisa nomear ao menos um codigo");
  for (const c of usados) ok(permitidos.includes(c), `codigo fora da allowlist: ${c}`);
});

test("o helper NUNCA publica err.message", () => {
  const src = readFileSync(join(RAIZ, "bolao/cdb2026/js/app.js"), "utf8");
  const corpo = src.match(/function publicaDiagnosticoDeSave[\s\S]*?\n}/)[0];
  // `m` existe so para CASAR padrao; o que vai para publicarDiagnostico e sempre `codigo`.
  ok(/publicarDiagnostico\(codigo\)/.test(corpo), "so a variavel `codigo` pode ser publicada");
  ok(!/publicarDiagnostico\((?!codigo\))/.test(corpo), "nada alem de `codigo` pode ser publicado");
});

test("o bus normaliza qualquer codigo desconhecido, mesmo se alguem errar o mapeamento", () => {
  const { root } = carregar();
  const c = root.BOLAO_REPORT_CONTEXT;
  eq(c.publicarDiagnostico("RPC cdb_save_my_picks respondeu 400 ACESSO_NEGADO"),
     "UNKNOWN_SAFE_ERROR", "texto cru jamais vira diagnostico");
  eq(c.publicarDiagnostico("SAVE_ACCESS_DENIED"), "SAVE_ACCESS_DENIED", "codigo valido passa");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ UI DE REPORTE REPROVADA\n"); process.exit(1); }
console.log("✓ UI DE REPORTE OK\n");
