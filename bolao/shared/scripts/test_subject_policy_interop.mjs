#!/usr/bin/env node
/**
 * INTEROPERABILIDADE — a política de assunto em Python e a em JS têm de ser a MESMA.
 *
 * ═══ POR QUE ESTE ARQUIVO PRECISA EXISTIR ═══════════════════════════════════════════════════
 *
 * A plataforma manda e-mail por dois runtimes, então a política vive em dois arquivos. Duas
 * cópias da mesma verdade divergem — é questão de tempo, não de cuidado; este repositório já
 * registrou exatamente isso quando `send_result_email.py` derivou da lógica de pontuação do
 * site (CHANGELOG v4.57), e de novo quando a matriz da Mega Millions em `data.js` ficou para
 * trás da oficial.
 *
 * Mesmo padrão de `test_money_interop.mjs` para `money.py`/`money.mjs`: uma implementação por
 * runtime, e um portão que fica VERMELHO se as duas discordarem em qualquer propósito.
 *
 * O teste NÃO recopia a tabela. Ele lê a tabela de CADA lado e compara uma com a outra — copiar
 * os valores para cá criaria uma TERCEIRA cópia, que é o problema que ele existe para impedir.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as js from "./subject_policy.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));

let falhas = [];
const checa = (nome, cond, detalhe = "") => {
  console.log(`  [${cond ? "PASS" : "FALHA"}] ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!cond) falhas.push(nome);
};

// Lê a política Python pelo próprio Python — nada de reimplementar o parser do arquivo.
const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(AQUI)})
import subject_policy as P
print(json.dumps({
    "propositos": P.PROPOSITOS,
    "icones": {"POWERBALL": P.POWERBALL, "MEGA_MILLIONS": P.MEGA_MILLIONS,
               "FUTEBOL": P.FUTEBOL, "FUTEBOL_CAMPEAO": P.FUTEBOL_CAMPEAO},
    "trofeu": sorted(P.EXCLUSIVOS_DO_TROFEU),
}))
`], { encoding: "utf8" }));

console.log("\nINTEROPERABILIDADE DA POLÍTICA DE ASSUNTO (python x js)\n");

// ── os quatro ícones ────────────────────────────────────────────────────────────────────────
for (const [nome, valor] of Object.entries(py.icones)) {
  checa(`ícone ${nome} idêntico`, js[nome] === valor, `py=${valor} js=${js[nome]}`);
}

// ── o mapa inteiro, nos dois sentidos ───────────────────────────────────────────────────────
const chavesPy = Object.keys(py.propositos).sort();
const chavesJs = Object.keys(js.PROPOSITOS).sort();
checa("os dois runtimes declaram os MESMOS propósitos",
  JSON.stringify(chavesPy) === JSON.stringify(chavesJs),
  `só em py: ${chavesPy.filter((k) => !chavesJs.includes(k))} | ` +
  `só em js: ${chavesJs.filter((k) => !chavesPy.includes(k))}`);

const divergentes = chavesPy.filter((k) => py.propositos[k] !== js.PROPOSITOS[k]);
checa("todo propósito mapeia para o MESMO ícone nos dois", divergentes.length === 0,
  divergentes.map((k) => `${k}: py=${py.propositos[k]} js=${js.PROPOSITOS[k]}`).join(" | "));

// ── o troféu continua reservado nos dois ────────────────────────────────────────────────────
const trofeuJs = chavesJs.filter((k) => js.PROPOSITOS[k] === js.FUTEBOL_CAMPEAO).sort();
checa("🏆 pertence aos mesmos propósitos nos dois runtimes",
  JSON.stringify(trofeuJs) === JSON.stringify(py.trofeu),
  `py=${py.trofeu} js=${trofeuJs}`);
checa("🏆 pertence a EXATAMENTE um propósito", trofeuJs.length === 1, trofeuJs.join(","));

// ── a saída montada é byte a byte a mesma ───────────────────────────────────────────────────
const AMOSTRAS = [
  ["LOTERIA_POWERBALL_RESULTADO", "Resultado Powerball — 12.08.2026"],
  ["LOTERIA_MEGAMILLIONS_RESULTADO", "Resultado Mega Millions — 14.08.2026"],
  ["FUTEBOL_RESULTADO_RODADA", "Resultado da rodada — Brasileirão 2026"],
  ["FUTEBOL_RESULTADO_FINAL_CAMPEAO", "Resultado final — Copa do Brasil 2026"],
];
const pySaidas = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(AQUI)})
import subject_policy as P
print(json.dumps([P.assunto(p, t) for p, t in ${JSON.stringify(AMOSTRAS)}]))
`], { encoding: "utf8" }));
AMOSTRAS.forEach(([prop, texto], i) => {
  const saidaJs = js.assunto(prop, texto);
  checa(`assunto idêntico: ${prop}`, saidaJs === pySaidas[i],
    `py=${JSON.stringify(pySaidas[i])} js=${JSON.stringify(saidaJs)}`);
});

// ── falha fechado nos dois ──────────────────────────────────────────────────────────────────
try {
  js.icone("PROPOSITO_INEXISTENTE");
  checa("js: propósito desconhecido levanta", false, "não levantou");
} catch (e) {
  checa("js: propósito desconhecido levanta", e instanceof js.PropositoDesconhecido);
}
try {
  js.jogo("keno");
  checa("js: jogo desconhecido levanta (não vira Powerball)", false, "não levantou");
} catch (e) {
  checa("js: jogo desconhecido levanta (não vira Powerball)", /JOGO_NAO_DECLARADO/.test(e.message));
}

// ── identidade por jogo: o defeito latente da Mega Millions ─────────────────────────────────
checa("powerball -> 🔴 / rótulo Powerball / bola PB",
  js.icone(js.jogo("powerball").propositoResultado) === "🔴" &&
  js.jogo("powerball").label === "Powerball" && js.jogo("powerball").bola === "PB");
checa("megamillions -> 🔵 / rótulo Mega Millions / bola MB",
  js.icone(js.jogo("megamillions").propositoResultado) === "🔵" &&
  js.jogo("megamillions").label === "Mega Millions" && js.jogo("megamillions").bola === "MB");

console.log("\n" + "=".repeat(78));
if (falhas.length) {
  console.log(`SUBJECT_POLICY_INTEROP = FALHOU (${falhas.length})`);
  falhas.forEach((f) => console.log(`    - ${f}`));
  process.exit(1);
}
console.log("SUBJECT_POLICY_INTEROP = PASS — as duas políticas são a mesma");
