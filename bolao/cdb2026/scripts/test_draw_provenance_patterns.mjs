#!/usr/bin/env node
/**
 * META-TESTE da asserção 13 de `audit_draw_provenance.mjs`.
 *
 * A asserção 13 protege um invariante de dinheiro (nenhum caminho de admin fabrica confronto) usando
 * inspeção de TEXTO-FONTE. Inspeção de texto é legítima para "esta chamada perigosa não pode
 * aparecer", mas é frágil: já produziu um falso positivo (palavra solta `derive` casando com
 * `DERIVED_PHASES`) e um falso negativo (ordem de escrita invertida escapando).
 *
 * Este teste é o que impede a asserção de regredir em silêncio: mede PRECISÃO (0 falso positivo em
 * código benigno) e RECALL (0 falso negativo em código adversarial) sobre os padrões REAIS
 * importados de `draw_provenance_patterns.mjs` — não sobre uma cópia.
 *
 * Uso: node bolao/cdb2026/scripts/test_draw_provenance_patterns.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectTieFabrication, PAIRING_FROM_QUALIFIED, RANDOM_PAIRING } from "./draw_provenance_patterns.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/**
 * BENIGNO — precisa passar. Cada entrada é código que menciona palavras suspeitas por motivo
 * legítimo. As três primeiras são o falso positivo REAL que quebrou a suíte no Batch 4.
 */
const BENIGN = [
  ["DERIVED_PHASES (constante de guarda)", 'const DERIVED_PHASES = new Set(["semifinal", "final"]);'],
  ["TOPOLOGY_PHASE_NOT_DERIVED (erro de guarda)", 'throw new Error("TOPOLOGY_PHASE_NOT_DERIVED");'],
  ["prosa mencionando derivada", "// a topologia derivada NAO escreve ties, so phases[x].topology"],
  ["derivedPhaseView (nome de variavel)", "const derivedPhaseView = buildView(phase);"],
  ["leitura inocente de teamA", "const label = `${tie.teamA} x ${tie.teamB}`;"],
  ["itera classificados sem emparelhar", "for (const q of qualified) { render(q.name); }"],
  ["conta classificados", "const n = qualified.length;"],
  ["le teamA e menciona qualified em linhas separadas", "const a = tie.teamA;\nconst qs = qualified;"],
  ["random como parte de outra palavra", "const randomizerDisabled = true;"],
];

/**
 * ADVERSARIAL — precisa ser detectado. Inclui as duas ordens de escrita, que é o falso negativo
 * que este arquivo corrige.
 */
const ADVERSARIAL = [
  ["qualified antes de teamA", 'ties[id] = {}; ties[id].teamA = qualified[0].id;'],
  ["teamA antes de qualified (FALSO NEGATIVO CORRIGIDO)", 'ties[id] = { teamA: qualified.map(q => q.id)[0] };'],
  ["objeto literal com ambos os times", 'ties[id] = { teamA: qualified[0].id, teamB: qualified[1].id };'],
  ["shuffle de classificados", "const pairs = shuffle(qualified);"],
  ["autoPair", "autoPair(qualifiedTeams);"],
  ["Math.random", "const i = Math.floor(Math.random() * 4);"],
  ["Math . random com espaco", "const i = Math . random();"],
  ["atribuicao com =", 'let teamA = qualified.pop();'],
];

console.log("\nMETA-TESTE — padrões da asserção 13 (fabricação de confronto)\n");

test("precisão: nenhum falso positivo em código benigno", () => {
  const fp = BENIGN.filter(([, code]) => detectTieFabrication(code).length > 0);
  assert(fp.length === 0,
    `${fp.length} falso(s) positivo(s): ${fp.map(([l]) => l).join("; ")}`);
});

test("recall: todo código adversarial é detectado", () => {
  const fn = ADVERSARIAL.filter(([, code]) => detectTieFabrication(code).length === 0);
  assert(fn.length === 0,
    `${fn.length} falso(s) negativo(s): ${fn.map(([l]) => l).join("; ")}`);
});

test("regressão Batch 4: a palavra solta `derive` NÃO é mais um padrão", () => {
  const all = [PAIRING_FROM_QUALIFIED, RANDOM_PAIRING].map(String).join(" ");
  assert(!/\bderive\b/i.test(all),
    "o heurístico de palavra solta `derive` voltou — ele casa com DERIVED_PHASES e quebra a suíte");
  assert(detectTieFabrication("const DERIVED_PHASES = new Set([]);").length === 0,
    "DERIVED_PHASES voltou a ser sinalizado");
});

test("regressão de ordem: as DUAS ordens de escrita são detectadas", () => {
  assert(detectTieFabrication('t.teamA = qualified[0]').length > 0, "ordem team→qualified não detectada");
  assert(detectTieFabrication('qualified[0] ... teamA:').length > 0, "ordem qualified→team não detectada");
});

test("a asserção real importa os padrões deste módulo (sem cópia divergente)", () => {
  const audit = readFileSync(join(HERE, "audit_draw_provenance.mjs"), "utf8");
  assert(/from "\.\/draw_provenance_patterns\.mjs"/.test(audit),
    "audit_draw_provenance.mjs não importa draw_provenance_patterns.mjs — os padrões podem divergir");
  assert(/detectTieFabrication\s*\(/.test(audit),
    "audit_draw_provenance.mjs não usa detectTieFabrication() — a asserção pode ter voltado a um regex local");
});

test("o app real está limpo — ESCOPO applyAdminMutation, igual à asserção 13", () => {
  // O invariante é sobre o CAMINHO DE ADMIN, não sobre o arquivo inteiro. Varrer app.js todo foi um
  // erro de escopo deste meta-teste: `tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB` é leitura
  // legítima ("qual time avançou") e aparece 8× fora de applyAdminMutation.
  const src = readFileSync(join(HERE, "..", "js", "app.js"), "utf8");
  const i = src.indexOf("function applyAdminMutation");
  assert(i !== -1, "applyAdminMutation() não encontrada");
  let depth = 0, end = -1;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) { end = j; break; }
  }
  const hits = detectTieFabrication(src.slice(i, end + 1));
  assert(hits.length === 0, `applyAdminMutation casou com: ${hits.join(", ")}`);
});

test("precisão sobre código REAL: qualifiedTeamId não é emparelhamento", () => {
  // Fixture extraída do app.js real (8 ocorrências). Foi o falso positivo que motivou a fronteira
  // de palavra em `\bqualified\b`.
  const real = [
    'out.push(t.qualifiedTeamId === "A" ? t.teamA : t.teamB);',
    'champion: tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB,',
    'const tie = { teamA: ev.homeTeam, teamB: ev.awayTeam, matches: {}, qualifiedTeamId: null };',
  ];
  const flagged = real.filter((l) => detectTieFabrication(l).length > 0);
  assert(flagged.length === 0, `${flagged.length} linha(s) legítima(s) de app.js sinalizada(s)`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ DRAW PROVENANCE PATTERN META-TESTS PASSED\n" : "✗ DRAW PROVENANCE PATTERN META-TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
