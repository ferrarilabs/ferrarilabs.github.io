#!/usr/bin/env node
/**
 * Duas suites de navegador NAO podem declarar a mesma porta.
 *
 * O DEFEITO QUE ISTO FECHA (2026-08-12)
 * -------------------------------------
 * Acrescentei uma suite nova com `const PORT = 8231` -- que `audit_live_card_dom.mjs` ja usava.
 * O `static_server` recusa reusar porta ocupada (de proposito: medir o checkout errado ja
 * aconteceu neste projeto). Entao a segunda suite a rodar MORRIA com "porta JA ESTA EM USO".
 *
 * O sintoma nao aponta para a causa: quem falha e a suite que chegou depois, muitas vezes uma
 * que nao tem relacao nenhuma com a mudanca. Passei tres execucoes de verify culpando orfaos de
 * processo antes de olhar a lista de portas.
 *
 * Colisao de porta e um fato ESTATICO: da para ler do codigo, sem subir nada.
 *
 * HERMETICO: le fonte, nao abre socket.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const arquivos = execFileSync("git", ["ls-files"], { cwd: RAIZ, encoding: "utf8" })
  .split("\n").filter(f => f.endsWith(".mjs"));

const porPorta = new Map();
for (const f of arquivos) {
  const src = readFileSync(join(RAIZ, f), "utf8");
  // Só declarações executáveis: comentário que cita uma porta não reserva porta.
  for (const linha of src.split("\n")) {
    if (linha.trim().startsWith("//")) continue;
    const m = /const\s+PORT\s*=\s*(\d{2,5})/.exec(linha);
    if (!m) continue;
    const porta = m[1];
    if (!porPorta.has(porta)) porPorta.set(porta, []);
    porPorta.get(porta).push(f);
  }
}

console.log("\nPortas dos harnesses de navegador\n");

test("nenhuma porta é declarada por duas suítes", () => {
  const colisoes = [...porPorta.entries()].filter(([, fs]) => fs.length > 1);
  assert(colisoes.length === 0,
    "porta declarada mais de uma vez:\n      " +
    colisoes.map(([p, fs]) => `${p}: ${fs.join(", ")}`).join("\n      ") +
    "\n      O static_server recusa reusar porta ocupada, então a suíte que rodar depois morre " +
    "com 'porta JÁ ESTÁ EM USO' — e quem falha costuma ser uma suíte sem relação com a mudança.");
});

test("há portas declaradas para inspecionar (a regra não pode virar vácuo)", () =>
  assert(porPorta.size >= 5, `só ${porPorta.size} porta(s) encontrada(s) — o parser quebrou?`));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ HARNESS PORTS UNIQUE PASSED\n" : "✗ HARNESS PORTS UNIQUE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
