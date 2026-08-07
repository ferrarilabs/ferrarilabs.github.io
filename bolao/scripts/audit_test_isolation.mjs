#!/usr/bin/env node
/**
 * AUDITORIA — TEST ISOLATION (P0, 2026-08-07)
 * ============================================================================
 *
 * O incidente de produção do CDB2026 foi causado por uma fixture de harness que carregou a
 * aplicação com a configuração REAL do Supabase (url/anonKey/stateId são hardcoded em
 * `js/config.js`) e gravou entradas sintéticas na tabela de produção. Não havia nenhuma flag
 * de teste impedindo isso — porque não existia nenhuma.
 *
 * Esta suíte prova que o guard fail-closed existe, está no CHOKEPOINT certo, e está presente
 * nos TRÊS apps. Ela extrai as funções reais de cada `js/app.js` (mesma técnica de
 * `audit_entry_roster_freeze.mjs`) — não uma transcrição.
 *
 * Regra sob teste:
 *
 *     Gravação remota é NEGADA por padrão sempre que a origem não é a produção OU o navegador
 *     está sob automação. Só um override explícito, digitado no console e preso à sessão,
 *     libera.
 *
 * Uso: node bolao/scripts/audit_test_isolation.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APPS = ["copa2026", "br2026", "cdb2026"];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Extrai o texto-fonte de uma função de nível superior por chaves balanceadas. */
function extractFn(src, name) {
  const m = src.match(new RegExp(`\\n(?:async )?function ${name}\\s*\\(`));
  if (!m) throw new Error(`função ${name}() não encontrada`);
  const start = m.index + 1;
  // O corpo começa depois do FECHA-PARÊNTESES da assinatura, não no primeiro "{" — assinaturas
  // como `(s, opts = {})` têm chaves em parâmetros default, e começar nelas fecha na hora,
  // devolvendo um corpo vazio que passaria qualquer asserção de ausência por acidente.
  let p = src.indexOf("(", start), parens = 0, i = -1;
  for (; p < src.length; p++) {
    if (src[p] === "(") parens++;
    else if (src[p] === ")" && --parens === 0) { i = src.indexOf("{", p); break; }
  }
  if (i < 0) throw new Error(`assinatura de ${name}() não fechou`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`chaves desbalanceadas em ${name}()`);
}
function extractConst(src, name) {
  const m = src.match(new RegExp(`\\nconst ${name} = ("[^"]*");`));
  if (!m) throw new Error(`const ${name} não encontrada`);
  return `const ${name} = ${m[1]};`;
}

/**
 * Monta o gate REAL de um app dentro de um contexto onde `location`, `navigator` e
 * `sessionStorage` são controlados pelo teste.
 */
function buildGate(app, { origin, webdriver = false, override = undefined, sessionThrows = false }) {
  const src = readFileSync(join(REPO, "bolao", app, "js", "app.js"), "utf8");
  const code = `
    const location = { origin: ${JSON.stringify(origin)} };
    const navigator = { webdriver: ${webdriver} };
    const sessionStorage = {
      getItem(k) {
        if (${sessionThrows}) throw new Error("sessionStorage bloqueado");
        return ${override === undefined ? "null" : JSON.stringify(override)};
      },
    };
    ${extractConst(src, "PRODUCTION_ORIGIN")}
    ${extractConst(src, "ALLOW_PROD_WRITES_KEY")}
    ${extractFn(src, "productionWriteBlockReason")}
    ${extractFn(src, "productionWritesAllowed")}
    return { productionWritesAllowed, productionWriteBlockReason, PRODUCTION_ORIGIN, ALLOW_PROD_WRITES_KEY };
  `;
  return new Function(code)();
}

const PROD = "https://ferrarilabs.github.io";

for (const app of APPS) {
  console.log(`\n── ${app} ──`);

  test(`[${app}] o guard existe e está DENTRO de saveRemoteState (o chokepoint)`, () => {
    const src = readFileSync(join(REPO, "bolao", app, "js", "app.js"), "utf8");
    const body = extractFn(src, "saveRemoteState");
    assert(body.includes("productionWritesAllowed()"),
      "saveRemoteState() não consulta o guard — a fronteira não é a fronteira");
    // O guard precisa vir ANTES de qualquer fetch remoto, senão já vazou.
    const gateAt = body.indexOf("productionWritesAllowed()");
    const fetchAt = body.search(/fetchJson|fetch\(/);
    assert(fetchAt === -1 || gateAt < fetchAt,
      "o guard roda DEPOIS da primeira chamada remota — escrita/leitura já vazou");
  });

  test(`[${app}] produção real: gravação PERMITIDA`, () => {
    const g = buildGate(app, { origin: PROD, webdriver: false });
    assertEqual(g.productionWritesAllowed().allowed, true, "produção legítima foi bloqueada");
  });

  test(`[${app}] localhost: gravação NEGADA (fail closed)`, () => {
    const g = buildGate(app, { origin: "http://localhost:8080" });
    const r = g.productionWritesAllowed();
    assertEqual(r.allowed, false, "preview local pôde gravar na produção");
    assert(/localhost/.test(r.reason), `motivo não menciona a origem: ${r.reason}`);
  });

  test(`[${app}] 127.0.0.1: gravação NEGADA`, () => {
    assertEqual(buildGate(app, { origin: "http://127.0.0.1:8080" }).productionWritesAllowed().allowed,
      false, "127.0.0.1 pôde gravar na produção");
  });

  test(`[${app}] file:// : gravação NEGADA`, () => {
    assertEqual(buildGate(app, { origin: "null" }).productionWritesAllowed().allowed,
      false, "file:// pôde gravar na produção");
  });

  test(`[${app}] Playwright/Selenium na origem de produção: gravação NEGADA`, () => {
    // Este é EXATAMENTE o vetor do incidente: harness apontado para o site publicado.
    const r = buildGate(app, { origin: PROD, webdriver: true }).productionWritesAllowed();
    assertEqual(r.allowed, false, "um harness automatizado pôde gravar na produção");
    assert(/webdriver|automa/i.test(r.reason), `motivo não menciona automação: ${r.reason}`);
  });

  test(`[${app}] override correto libera (escape hatch deliberado)`, () => {
    const r = buildGate(app, { origin: "http://localhost:8080", override: "I UNDERSTAND" })
      .productionWritesAllowed();
    assertEqual(r.allowed, true, "o escape hatch deliberado não funciona");
    assertEqual(r.overridden, true, "o override não é sinalizado (não vai gerar aviso no console)");
  });

  test(`[${app}] override com valor errado NÃO libera`, () => {
    for (const v of ["true", "1", "yes", "", "i understand", "I UNDERSTAND "]) {
      assertEqual(buildGate(app, { origin: "http://localhost:8080", override: v })
        .productionWritesAllowed().allowed, false, `o valor de override ${JSON.stringify(v)} liberou a gravação`);
    }
  });

  test(`[${app}] sessionStorage lançando exceção NÃO libera (fail closed)`, () => {
    assertEqual(buildGate(app, { origin: "http://localhost:8080", sessionThrows: true })
      .productionWritesAllowed().allowed, false,
      "sessionStorage indisponível virou liberação — fail OPEN");
  });

  test(`[${app}] a chave de override é namespaced por app (não vaza entre apps)`, () => {
    const g = buildGate(app, { origin: PROD });
    assert(g.ALLOW_PROD_WRITES_KEY.startsWith(app),
      `chave de override "${g.ALLOW_PROD_WRITES_KEY}" não é namespaced por ${app}`);
  });

  test(`[${app}] a origem de produção não é um wildcard nem substring frouxa`, () => {
    const g = buildGate(app, { origin: PROD });
    assertEqual(g.PRODUCTION_ORIGIN, PROD, "origem de produção inesperada");
    // Um atacante/typo hospedando ferrarilabs.github.io.evil.com não pode passar.
    assertEqual(buildGate(app, { origin: "https://ferrarilabs.github.io.evil.com" })
      .productionWritesAllowed().allowed, false, "match de origem é por substring — frouxo");
  });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ TEST ISOLATION SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
