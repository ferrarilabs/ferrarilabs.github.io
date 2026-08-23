#!/usr/bin/env node
/**
 * HIGIENE DOS ARQUIVOS QUE O SCAN NAO VARRE — o ponto cego do proprio detector.
 *
 * ─── O ACHADO (2026-08-23) ──────────────────────────────────────────────────────────────────
 *
 * `audit_pii_repo_wide.mjs` PULA cinco arquivos (`DETECTOR_SOURCES`) porque neles "o padrao E o
 * conteudo" — um detector de e-mail precisa conter algo com forma de e-mail para ser testado. A
 * exclusao e correta e esta documentada.
 *
 * Mas ela cria um ponto cego, e o ponto cego estava ocupado:
 *
 *   - `scripts/test_audit_pii_repo_wide.mjs` continha QUATRO enderecos REAIS de participantes,
 *     copiados do vazamento historico para servir de fixture;
 *   - `bolao/loterias/powerball/scripts/audit_pii_tests.mjs` continha DEZESSEIS referencias de
 *     pagamento REAIS em texto claro — e se auto-excluia do proprio scan para nao se acusar.
 *
 * Ou seja: os dois arquivos que existem para impedir vazamento de PII eram, eles mesmos, o
 * vazamento — num repositorio publico, invisiveis para o gate que existe para encontra-los.
 *
 * ─── A REGRA ────────────────────────────────────────────────────────────────────────────────
 *
 * Um arquivo isento do scan nao fica isento de disciplina. Dentro de `DETECTOR_SOURCES`:
 *
 *   1. todo e-mail literal precisa ser reservado, o contato publico declarado do dono, ou usar um
 *      prefixo local INVENTADO desta lista — nada de "parecia um bom exemplo";
 *   2. nenhuma referencia de pagamento em texto claro: o valor conhecido vive como SHA-256, que
 *      detecta igualmente bem e nao publica nada.
 *
 * Uso: node scripts/test_detector_source_hygiene.mjs
 *
 * NAO ha declaracao `@pii-fixture` aqui, de proposito: os enderecos dos controles negativos sao
 * MONTADOS em tempo de execucao (ver `end()`/`amostra()`), entao o arquivo nao contem endereco
 * nenhum e nao precisa de permissao para conter. Uma declaracao cujo detector nunca dispara e
 * reportada como obsoleta — e estaria certa.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import { isReservedEmail, PUBLISHED_CONTACTS, classifyValue } from "./pii_detectors.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Precisa espelhar `DETECTOR_SOURCES` de audit_pii_repo_wide.mjs — conferido abaixo. */
export const FONTES_DO_DETECTOR = [
  "scripts/pii_detectors.mjs",
  "scripts/test_pii_detectors.mjs",
  "scripts/audit_pii_repo_wide.mjs",
  "scripts/test_audit_pii_repo_wide.mjs",
  "bolao/loterias/powerball/scripts/audit_pii_tests.mjs",
];

/**
 * Prefixos de parte local INVENTADOS. Um nome comum de pessoa NAO serve: `um nome proprio comum` estava
 * neste papel e era o endereco real de uma participante — parecia fixture e nao era.
 */
export const PREFIXOS_INVENTADOS = /^(someone|naoexiste|fixture|synthetic|placeholder|redacted|nobody|test)\d*$/i;


/**
 * Enderecos de teste MONTADOS EM TEMPO DE EXECUCAO, nunca escritos como literal.
 *
 * `scripts/test_fixture_privacy.mjs` tem regra de exceção zero: nenhum endereço de terceiro pode
 * aparecer literalmente num teste — se um dia um teste alcançar o provedor, ele manda e-mail para
 * uma pessoa real. Mas este gate PRECISA exercitar dominios de webmail reais, porque a regra que
 * ele protege e exatamente "parte local nao declarada NUM WEBMAIL REAL".
 *
 * Montar em runtime satisfaz as duas coisas: o arquivo nao contem endereco nenhum, e o teste
 * continua exercitando o dominio de verdade. CLAUDE.md prevê essa saida explicitamente.
 */
const dom = (...partes) => partes.join(".");
const end = (local, dominio) => `${local}@${dominio}`;
/** Conteudo de arquivo FALSO contendo o endereco montado — e ele que o gate varre. */
const amostra = (local, dominio) => `const a = "${end(local, dominio)}";`;
const GMAIL = dom("gmail", "com");
const HOTMAIL = dom("hotmail", "com");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Onde um endereco REAL de participante pode morar: provedores de webmail de verdade.
 *
 * A exigencia de prefixo inventado vale SO aqui. Num dominio inventado (`b.com`, `nottest.io`,
 * `testcompany.com`) o endereco nao pode ser de um participante, porque o dominio nao entrega
 * e-mail para ninguem — cobrar disciplina de nomenclatura ali seria ruido, e um gate ruidoso e um
 * gate que alguem desliga. Foi num destes provedores que as quatro reais estavam.
 */
const WEBMAIL_REAL = /@(gmail|yahoo|hotmail|outlook|msn|live|icloud|me|aol|protonmail|proton|gmx|zoho|uol|bol|terra|ig|globo|r7)\.[a-z.]+$/i;

/** Formas de referencia de pagamento em texto claro. Um SHA-256 (64 hex) nao casa com nenhuma. */
const REF_EM_TEXTO_CLARO = [
  { nome: "Cash App (#D-)", re: /"#D-[A-Z0-9]{6,14}"/g },
  { nome: "Zelle numerico", re: /"\d{10,12}"/g },
  { nome: "PayPal 15-20", re: /"[0-9A-Z]{15,20}"/g },
];

export function problemasNoArquivo(rel, src) {
  const out = [];

  for (const addr of src.match(EMAIL_RE) || []) {
    if (isReservedEmail(addr)) continue;
    const ehContatoPublico = (() => {
      try {
        if (PUBLISHED_CONTACTS instanceof Set) return PUBLISHED_CONTACTS.has(addr) || PUBLISHED_CONTACTS.has(addr.toLowerCase());
        if (Array.isArray(PUBLISHED_CONTACTS)) return PUBLISHED_CONTACTS.includes(addr);
        return Object.keys(PUBLISHED_CONTACTS || {}).some((k) => k.toLowerCase() === addr.toLowerCase());
      } catch { return false; }
    })();
    if (ehContatoPublico) continue;
    if (!WEBMAIL_REAL.test(addr)) continue;   // dominio inventado: nao pode ser de participante
    const local = addr.split("@")[0];
    if (PREFIXOS_INVENTADOS.test(local)) continue;
    // Mensagem sem o valor: este log e publico.
    out.push(`${rel}: e-mail com parte local nao declarada como inventada (dominio ${addr.split("@")[1]}). ` +
      `Use um prefixo de PREFIXOS_INVENTADOS — um nome de pessoa plausivel ja foi, aqui, um endereco real.`);
  }

  for (const { nome, re } of REF_EM_TEXTO_CLARO) {
    for (const achado of src.match(re) || []) {
      if (/^"[0-9a-f]{64}"$/.test(achado)) continue;  // ja e um hash
      const valor = achado.slice(1, -1);
      // O proprio detector ja sabe reconhecer valor sinteticamente construido (digito repetido,
      // prefixo declarado). Reimplementar esse julgamento aqui criaria uma segunda definicao de
      // "sintetico" que divergiria da primeira no primeiro dia.
      const cls = (() => { try { return classifyValue("zelle-like-tx-id", valor); } catch { return null; } })();
      if (cls === "RESERVED_SYNTHETIC") continue;
      out.push(`${rel}: referencia de pagamento em TEXTO CLARO (forma: ${nome}). ` +
        `Guarde o SHA-256 — detecta igual e nao publica nada.`);
    }
  }
  return out;
}

let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                          catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nHigiene dos arquivos isentos do scan\n");

test("a lista espelha DETECTOR_SOURCES do scan repo-wide", () => {
  const src = readFileSync(join(RAIZ, "scripts/audit_pii_repo_wide.mjs"), "utf-8");
  const bloco = /const DETECTOR_SOURCES = \[(.*?)\];/s.exec(src);
  assert(bloco, "nao encontrei DETECTOR_SOURCES — o gate perdeu o alvo");
  const declarados = [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(declarados) === JSON.stringify([...FONTES_DO_DETECTOR].sort()),
    `a lista divergiu do scan:\n        scan=${declarados.join(", ")}\n        gate=${[...FONTES_DO_DETECTOR].sort().join(", ")}`);
});

for (const rel of FONTES_DO_DETECTOR) {
  test(`${rel} nao carrega PII real`, () => {
    const p = problemasNoArquivo(rel, readFileSync(join(RAIZ, rel), "utf-8"));
    assert(p.length === 0, p.join("\n      "));
  });
}

console.log("\nControles negativos (o gate morde de verdade):");

test("endereco com nome de pessoa plausivel e ACUSADO", () => {
  // A parte local aqui e deliberadamente uma NAO-pessoa ("pessoa.inventada"): a primeira versao
  // deste caso usava `um nome proprio comum`, que era justamente um dos enderecos REAIS que este gate
  // existe para expulsar. O scan repo-wide pegou. O controle negativo precisa parecer um nome sem
  // ser o nome de ninguem.
  const p = problemasNoArquivo("x.mjs", amostra("pessoa.inventada", GMAIL));
  assert(p.length === 1, "um endereco que parece fixture mas pode ser real passou batido");
});

test("endereco com prefixo inventado passa", () => {
  assert(problemasNoArquivo("x.mjs", amostra("someone7", GMAIL)).length === 0, "falso positivo");
  assert(problemasNoArquivo("x.mjs", amostra("naoexiste3", HOTMAIL)).length === 0, "falso positivo");
});

test("endereco reservado passa", () => {
  assert(problemasNoArquivo("x.mjs", amostra("qualquer", dom("example", "invalid"))).length === 0, "falso positivo");
});

test("dominio INVENTADO nao exige prefixo (nao ha participante la)", () => {
  for (const a of [end("x", dom("b", "com")), end("user", dom("nottest", "io")), end("algo", dom("testcompany", "com")), end("n", dom("invalid-domain", "com"))]) {
    assert(problemasNoArquivo("x.mjs", `const a = "${a}";`).length === 0, `ruido em ${a}`);
  }
});

test("...mas o mesmo nome num WEBMAIL REAL e acusado", () => {
  assert(problemasNoArquivo("x.mjs", amostra("x", GMAIL)).length === 1,
    "o gate deixaria passar um endereco de webmail real com parte local curta");
});

test("referencia de pagamento em texto claro e ACUSADA, nas tres formas", () => {
  for (const amostra of ['"90000000006"', '"#D-SYNTH00002"', '"SYNTH000000000025"']) {
    assert(problemasNoArquivo("x.mjs", `const v = ${amostra};`).length === 1, `forma nao pega: ${amostra}`);
  }
});

test("valor que o DETECTOR chama de sintetico nao e acusado", () => {
  assert(problemasNoArquivo("x.mjs", 'const v = "11111111111";').length === 0,
    "digito repetido e sintetico pelo proprio classificador — acusa-lo seria ruido");
});

test("um SHA-256 NAO e acusado (senao a propria correcao reprovaria)", () => {
  const h = "a".repeat(64);
  assert(problemasNoArquivo("x.mjs", `const v = "${h}";`).length === 0, "o gate acusaria o proprio hash");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ HIGIENE DAS FONTES DO DETECTOR REPROVADA\n"); process.exit(1); }
console.log("✓ HIGIENE DAS FONTES DO DETECTOR OK\n");
