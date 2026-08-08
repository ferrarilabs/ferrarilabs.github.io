#!/usr/bin/env node
/**
 * test_money_interop.mjs — as TRÊS implementações do formatador USD canônico têm de concordar.
 *
 * Decisão de produto (Eduardo, 2026-08-07): o formato humano canônico é `US$ X.XX`.
 *
 * Existem três implementações porque existem três runtimes e este repo não tem build step:
 *   bolao/shared/js/money.js        (navegador — os quatro apps)
 *   bolao/shared/scripts/money.mjs  (Node — emails, receipts)
 *   bolao/shared/scripts/money.py   (Python — emails de resultado)
 *
 * Três cópias da mesma regra é exatamente o arranjo que produz divergência silenciosa — foi assim
 * que a plataforma acabou com QUATRO formatos diferentes para o mesmo tipo de valor
 * (`US$5`, `$1,250.00`, `$5`, `$65`). Este teste é a barreira: compara as três contra a MESMA tabela
 * de valores e falha se qualquer uma sair diferente. Mesmo padrão dos testes de interop de
 * notification_repository.mjs/.py.
 *
 * Uso: node bolao/shared/scripts/test_money_interop.mjs
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = join(HERE, "..");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

// Tabela deliberadamente cruel: inteiro, centavos, arredondamento, milhar, negativo, zero,
// fronteiras de K/M/B e entradas inválidas.
const VALUES = [0, 5, 5.5, 5.005, 20, 65, 999, 1000, 1250, 1250.5, 12345.678,
                1e6, 1.5e6, 707e6, 1e9, 2.25e9, -5, -1250.5, null, undefined, "", "abc", NaN, Infinity];

const mjs = await import(join(SHARED, "scripts", "money.mjs"));

// Browser build: o arquivo é um IIFE que grava em `window`/globalThis — carregado como texto e
// executado num escopo controlado, sem jsdom (o repo não tem dependências de teste).
function loadBrowserMoney() {
  const src = readFileSync(join(SHARED, "js", "money.js"), "utf8");
  const sandboxGlobal = {};
  new Function("window", src)(sandboxGlobal);
  if (!sandboxGlobal.BOLAO_MONEY) throw new Error("money.js não expôs window.BOLAO_MONEY");
  return sandboxGlobal.BOLAO_MONEY;
}
const browser = loadBrowserMoney();

// Python: uma chamada só, devolvendo JSON, para não pagar startup por valor.
function pythonResults(values) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(SHARED, "scripts"))})
import money
vals = json.load(sys.stdin)
out = []
for v in vals:
    # None/"" chegam como null/"" do JSON; "abc" fica string; NaN/Infinity viram null (JSON.stringify)
    out.append([money.usd(v), money.usd_compact(v)])
print(json.dumps(out))
`;
  const payload = JSON.stringify(values.map(v => (typeof v === "number" && !isFinite(v)) || v === undefined ? null : v));
  const raw = execFileSync("python3", ["-c", script], { input: payload, encoding: "utf8" });
  return JSON.parse(raw);
}
const py = pythonResults(VALUES);

console.log("\nFormatador USD canônico — interop navegador / Node / Python\n");

test("valores inteiros SEM centavos; centavos só quando existem", () => {
  // Eduardo: "os centavos continuam aparecendo, só deve aparecer no prêmio final". O prêmio final é
  // justamente o valor que cai em centavo quebrado (70% do pote), então basta sumir com o `.00`.
  eq(mjs.usd(5), "$5", "5");
  eq(mjs.usd(20), "$20", "20");
  eq(mjs.usd(65), "$65", "65 (o pote do CDB2026)");
  eq(mjs.usd(1250), "$1,250", "1250 (separador de milhar, sem centavos)");
  eq(mjs.usd(0), "$0", "zero");
  // com centavos de verdade:
  eq(mjs.usd(80.5), "$80.50", "prêmio final 70% do pote");
  eq(mjs.usd(11.5), "$11.50", "3º lugar");
  eq(mjs.usd(1250.5), "$1,250.50", "milhar com centavos");
});

test("prefixo é `$` sem espaço, igual nos três runtimes", () => {
  eq(mjs.CURRENCY_PREFIX, "$", "prefixo canônico");
  eq(browser.CURRENCY_PREFIX, "$", "prefixo do navegador");
  // Duas casas SEMPRE nos valores: `$5` (sem centavos) era um dos quatro formatos divergentes.
  if (!/^\$\d+$/.test(mjs.usd(5))) throw new Error(`inteiro deveria vir sem centavos: ${mjs.usd(5)}`);
  if (!/^\$\d+\.\d{2}$/.test(mjs.usd(5.5))) throw new Error(`fracionário deveria ter 2 casas: ${mjs.usd(5.5)}`);
});

test("Node e navegador concordam em todos os valores", () => {
  for (const v of VALUES) {
    eq(browser.usd(v), mjs.usd(v), `usd(${String(v)})`);
    eq(browser.usdCompact(v), mjs.usdCompact(v), `usdCompact(${String(v)})`);
  }
});

test("Python concorda com Node em todos os valores", () => {
  VALUES.forEach((v, i) => {
    const [pUsd, pCompact] = py[i];
    eq(pUsd, mjs.usd(v), `python usd(${String(v)})`);
    eq(pCompact, mjs.usdCompact(v), `python usdCompact(${String(v)})`);
  });
});

test("entradas inválidas viram — nos três runtimes (nunca `US$ NaN`)", () => {
  for (const bad of [null, undefined, "", "abc", NaN, Infinity]) {
    eq(mjs.usd(bad), "—", `node usd(${String(bad)})`);
    eq(browser.usd(bad), "—", `browser usd(${String(bad)})`);
  }
});

test("negativos preservam o sinal ANTES do prefixo", () => {
  eq(mjs.usd(-1250.5), "-$1,250.50", "negativo");
  eq(mjs.usd(-1250), "-$1,250", "negativo inteiro");
  eq(mjs.usdCompact(-2.25e9), "-$2.3B", "negativo compacto");
});

test("variante compacta: mesmo prefixo, fronteiras K/M/B corretas", () => {
  eq(mjs.usdCompact(999), "$999", "abaixo de 1000 delega para usd()");
  eq(mjs.usdCompact(1000), "$1K", "fronteira K");
  eq(mjs.usdCompact(1e6), "$1M", "fronteira M");
  eq(mjs.usdCompact(707e6), "$707M", "jackpot real");
  eq(mjs.usdCompact(1e9), "$1B", "fronteira B");
  eq(mjs.usdCompact(2.25e9), "$2.3B", "arredonda a 1 casa");
});

test("arredondamento de centavos é consistente entre runtimes", () => {
  for (const v of [5.005, 1250.5, 12345.678]) {
    eq(browser.usd(v), mjs.usd(v), `browser vs node em ${v}`);
    eq(py[VALUES.indexOf(v)][0], mjs.usd(v), `python vs node em ${v}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ MONEY INTEROP SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
