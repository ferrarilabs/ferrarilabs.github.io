#!/usr/bin/env node
/**
 * CDB2026 — o id de confronto do operador tem de ser IDÊNTICO ao do app.
 *
 * POR QUE ISTO IMPORTA
 * `espnTieId()` no js/app.js é determinístico de propósito: quando a sincronização automática da
 * ESPN publicar as quartas, ela gera o id a partir dos nomes dos times, e o merge por chave
 * colapsa o confronto em vez de duplicá-lo.
 *
 * O `operator_cli.py` grava o sorteio oficial ANTES de a ESPN publicar, e precisa validar o id em
 * Python — então existe uma segunda cópia da regra. Duas cópias da mesma verdade divergem; é
 * questão de tempo, não de cuidado (este repositório já pagou por isso: o send_result_email.py da
 * Copa afastou-se em silêncio da lógica de scoring do site, CHANGELOG v4.57).
 *
 * Uma divergência aqui não dá erro: cria um confronto PARALELO. Dois cards do mesmo jogo, com os
 * palpites das pessoas divididos entre eles.
 *
 * Este gate executa as DUAS implementações sobre os mesmos nomes e compara.
 *
 * Uso: node bolao/cdb2026/scripts/test_operator_tie_id_matches_app.mjs
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(HERE, "..", "js", "app.js");
const CLI = join(HERE, "operator_cli.py");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

// A função REAL do app, recortada da fonte — não uma reescrita aqui.
const src = readFileSync(APP_JS, "utf8");
const i = src.indexOf("function espnTieId(");
assert(i >= 0, "espnTieId sumiu do app.js");
const fnSrc = src.slice(i, src.indexOf("\n}", i) + 2);
const espnTieId = new Function(`${fnSrc}; return espnTieId;`)();

// Nomes reais do estado + armadilhas de acentuação, hífen, caixa e ordem.
const CASOS = [
  ["Internacional", "Grêmio"],
  ["Cruzeiro", "Atlético-MG"],
  ["Vasco", "Vitória"],
  ["Palmeiras", "Santos"],
  ["Grêmio", "Internacional"],          // ordem invertida => MESMO id
  ["Athletico-PR", "Atlético-GO"],
  ["São Paulo", "Juventude"],
  ["Confiança-SE", "Grêmio"],
  ["Jacuipense-BA", "Palmeiras"],
  ["Operário-PR", "Fluminense"],
  ["Red Bull Bragantino", "Mirassol"],
  ["CRB-AL", "Fortaleza"],
];

const py = spawnSync("python3", ["-c", `
import sys, json
sys.path.insert(0, ${JSON.stringify(HERE)})
import operator_cli as O
casos = json.loads(sys.argv[1])
print(json.dumps([O._espn_tie_id(a, b) for a, b in casos]))
`, JSON.stringify(CASOS)], { encoding: "utf8" });

console.log("\nCDB2026 — paridade do id de confronto (app.js × operator_cli.py)\n");

test("o operator_cli.py é importável e expõe a função", () => {
  assert(py.status === 0, `python falhou: ${(py.stderr || "").slice(0, 300)}`);
});

if (py.status === 0) {
  const doPy = JSON.parse(py.stdout);
  CASOS.forEach(([a, b], k) => {
    test(`"${a}" × "${b}" — mesmo id nas duas implementações`, () => {
      const doJs = espnTieId(a, b);
      assert(doJs === doPy[k],
        `app.js="${doJs}" operator_cli.py="${doPy[k]}" — ids divergentes criam confronto PARALELO`);
    });
  });

  test("a ordem dos times não muda o id (chave canônica)", () => {
    assert(espnTieId("Grêmio", "Internacional") === espnTieId("Internacional", "Grêmio"),
      "o id deixou de ser independente da ordem — dois cards para o mesmo jogo");
  });
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ TIE ID PARITY PASSED\n" : "✗ TIE ID PARITY FAILED\n");
process.exit(fail === 0 ? 0 : 1);
