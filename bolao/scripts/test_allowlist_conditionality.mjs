#!/usr/bin/env node
/**
 * test_allowlist_conditionality.mjs — as MUTAÇÕES que provam que a exceção condicional morde.
 *
 * ─── POR QUE ESTE GATE EXISTE ────────────────────────────────────────────────────────────────
 *
 * `audit_visual_consistency.mjs` tem uma regra dura e certa: uma entrada de ALLOWLIST.json que não
 * suprimiu nada nesta rodada é lixo acumulado, e o gate fica VERMELHO até alguém removê-la. Em
 * 2026-08-12 essa regra deu o veredito errado UMA vez: `ranking-row:gridTemplateColumns` foi
 * removida de manhã por estar "não utilizada" e teve de voltar à tarde, quando as quartas do CDB
 * abriram e a divergência reapareceu. O CSS nunca mudou — o ESTADO do torneio mudou.
 *
 * A resposta foi `conditionality`: uma exceção ESTREITA à contagem de "não utilizada". Uma exceção
 * a uma regra de segurança é exatamente o tipo de coisa que envelhece virando porta dos fundos, e
 * uma proteção sem mutação que a derrube é uma proteção que ninguém sabe se está ligada. Então
 * este arquivo não pergunta "a função aceita a entrada boa?" — ele MUTA cada guarda, uma por vez,
 * e exige VERMELHO em cada uma.
 *
 * Vereditos exigidos (todos exercitados abaixo):
 *   CURRENTLY_EQUAL     + metadado condicional válido            = PASSA (não conta como não-utilizada)
 *   CURRENTLY_DIVERGENT + bate o gatilho documentado             = PASSA (JUSTIFIED)
 *   CURRENTLY_DIVERGENT + causa não relacionada                  = VERMELHO (DIVERGENT)
 *   EXPIRED_CONDITIONAL_ENTRY                                    = VERMELHO
 *   MISSING_TRIGGER                                              = VERMELHO
 *   MISSING_LAST_DIVERGENT_DATE                                  = VERMELHO
 *   STATIC_ENTRY_USING_CONDITIONALITY                            = VERMELHO
 *
 * Uso: node bolao/scripts/test_allowlist_conditionality.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CONDITIONAL_SIGNATURES, validateConditionality, validateAllowlistEntrySchema, classify,
} from "./audit_visual_consistency.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWLIST_PATH = join(ROOT, "docs/bolao/evidence/visual-comparison/ALLOWLIST.json");

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Data ISO deslocada por N dias a partir de hoje — para provar expiração sem congelar o relógio. */
function isoOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// A entrada REAL, lida do arquivo real. Mutar uma cópia de fantasia provaria o teste, não o gate.
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
const REAL = allowlist.entries.find(e => e.component === "ranking-row" && e.property === "gridTemplateColumns");

console.log("\nExceção condicional do ALLOWLIST.json — mutações\n");

test("BASE: a entrada real de ranking-row:gridTemplateColumns é condicional e VÁLIDA", () => {
  assert(REAL, "a entrada sumiu do ALLOWLIST.json");
  assert(REAL.conditionality, "a entrada deixou de declarar conditionality");
  const problems = validateAllowlistEntrySchema(REAL, 0);
  assert(problems.length === 0, `entrada real inválida: ${problems.join(" | ")}`);
});

// ── MUTAÇÕES DE METADADO — cada guarda derrubada isoladamente ───────────────────────────────
const mutations = [
  {
    label: "MISSING_TRIGGER = VERMELHO",
    marker: "MISSING_TRIGGER",
    mutate: (e) => { delete e.conditionality.trigger; },
  },
  {
    label: "MISSING_TRIGGER (gatilho curto demais para ser uma decisão) = VERMELHO",
    marker: "MISSING_TRIGGER",
    mutate: (e) => { e.conditionality.trigger = "muda as vezes"; },
  },
  {
    label: "MISSING_LAST_DIVERGENT_DATE = VERMELHO",
    marker: "MISSING_LAST_DIVERGENT_DATE",
    mutate: (e) => { delete e.conditionality.lastObservedDivergent; },
  },
  {
    label: "observação só de UM estado (nunca vista IGUAL) = VERMELHO",
    marker: "MISSING_LAST_EQUAL_DATE",
    mutate: (e) => { delete e.conditionality.lastObservedEqual; },
  },
  {
    label: "EXPIRED_CONDITIONAL_ENTRY = VERMELHO",
    marker: "EXPIRED_CONDITIONAL_ENTRY",
    mutate: (e) => { e.conditionality.reviewBy = isoOffset(-1); },
  },
  {
    label: "STATIC_ENTRY_USING_CONDITIONALITY (expectedType=exact) = VERMELHO",
    marker: "STATIC_ENTRY_USING_CONDITIONALITY",
    mutate: (e) => {
      e.expectedType = "exact";
      e.expected = Object.fromEntries(e.apps.map(a => [a, "48px 1fr auto auto"]));
    },
  },
  {
    label: "signature desconhecida (exceção declarada mas não verificável) = VERMELHO",
    marker: "signature",
    mutate: (e) => { e.conditionality.signature = "PORQUE_SIM"; },
  },
  {
    label: "observação no FUTURO não é observação = VERMELHO",
    marker: "está no futuro",
    mutate: (e) => { e.conditionality.lastObservedDivergent = isoOffset(+30); },
  },
];

for (const m of mutations) {
  test(m.label, () => {
    const mutated = JSON.parse(JSON.stringify(REAL));
    m.mutate(mutated);
    const problems = validateAllowlistEntrySchema(mutated, 0);
    assert(problems.length > 0, "a mutação NÃO foi detectada — a guarda não está ligada");
    assert(problems.some(p => p.includes(m.marker)),
      `detectou algo, mas não o esperado ("${m.marker}"): ${problems.join(" | ")}`);
  });
}

// ── O PREDICADO EXECUTÁVEL — é ele que separa "a causa documentada" de "outra causa" ────────
test("TRAILING_TRACK_COLLAPSE reconhece o colapso real do botão 'Ver palpites'", () => {
  const sig = CONDITIONAL_SIGNATURES.TRAILING_TRACK_COLLAPSE;
  // O estado medido em 2026-08-12: copa/cdb renderizam o botão, br2026 colapsa.
  assert(sig(["48px 882px 18px 99.3125px", "48px 882px 18px 0px", "48px 882px 18px 99.3125px"]),
    "não reconheceu o colapso de trilha que é a causa documentada");
});

test("CURRENTLY_DIVERGENT + causa NÃO relacionada = VERMELHO (o predicado recusa)", () => {
  const sig = CONDITIONAL_SIGNATURES.TRAILING_TRACK_COLLAPSE;
  // Larguras diferentes SEM colapso: é diferença de token/layout, não de estado do torneio.
  assert(!sig(["48px 882px 18px 99px", "48px 700px 18px 99px", "48px 882px 18px 99px"]),
    "aceitou uma divergência de largura como se fosse o colapso condicional — a exceção viraria porta dos fundos");
  // Trilhas restantes divergentes ALÉM do colapso: idem.
  assert(!sig(["48px 882px 18px 0px", "48px 700px 18px 99px", "48px 882px 18px 99px"]),
    "aceitou divergência nas trilhas remanescentes");
});

test("sem NENHUM colapso o predicado recusa (valores só diferentes não bastam)", () => {
  const sig = CONDITIONAL_SIGNATURES.TRAILING_TRACK_COLLAPSE;
  assert(!sig(["48px 100px", "48px 200px"]), "aceitou diferença sem colapso de trilha");
});

// ── classify(): o caminho ponta-a-ponta, com a entrada real ─────────────────────────────────
function makeAllowlistMap(entry) {
  return new Map([[`${entry.component}:${entry.property}`, { ...entry, used: false }]]);
}

test("CURRENTLY_DIVERGENT + bate o gatilho documentado = JUSTIFIED", () => {
  const map = makeAllowlistMap(REAL);
  const r = classify("ranking-row", "gridTemplateColumns", {
    copa2026: "48px 882px 18px 99.3125px",
    br2026:   "48px 882px 18px 0px",
    cdb2026:  "48px 882px 18px 99.3125px",
  }, map);
  assert(r.status === "JUSTIFIED", `esperava JUSTIFIED, veio ${r.status} (${r.reason})`);
  assert(map.get("ranking-row:gridTemplateColumns").used === true,
    "suprimiu o achado mas não se marcou como utilizada");
});

test("CURRENTLY_DIVERGENT + causa não relacionada = DIVERGENT (não suprime)", () => {
  const map = makeAllowlistMap(REAL);
  const r = classify("ranking-row", "gridTemplateColumns", {
    copa2026: "48px 882px 18px 99px",
    br2026:   "48px 700px 18px 99px",   // largura diferente, nenhuma trilha colapsada
    cdb2026:  "48px 882px 18px 99px",
  }, map);
  assert(r.status === "DIVERGENT", `esperava DIVERGENT, veio ${r.status}`);
  assert(/CONDITIONAL MISMATCH/.test(r.reason || ""), `motivo não explica a recusa: ${r.reason}`);
  assert(map.get("ranking-row:gridTemplateColumns").used === false,
    "marcou-se como utilizada sem ter suprimido nada");
});

test("CURRENTLY_EQUAL = EQUAL, e a entrada condicional NÃO é marcada como utilizada", () => {
  const map = makeAllowlistMap(REAL);
  const same = "48px 882.484px 18.2031px 99.3125px";   // o estado medido em 2026-08-16
  const r = classify("ranking-row", "gridTemplateColumns",
    { copa2026: same, br2026: same, cdb2026: same }, map);
  assert(r.status === "EQUAL", `esperava EQUAL, veio ${r.status}`);
  assert(map.get("ranking-row:gridTemplateColumns").used === false,
    "uma entrada não pode se marcar utilizada quando não havia divergência nenhuma");
});

test("a exceção NÃO vale para entrada sem conditionality (regra geral intacta)", () => {
  const semCond = JSON.parse(JSON.stringify(REAL));
  delete semCond.conditionality;
  const map = makeAllowlistMap(semCond);
  const r = classify("ranking-row", "gridTemplateColumns", {
    copa2026: "48px 882px 18px 99px",
    br2026:   "48px 700px 18px 99px",
    cdb2026:  "48px 882px 18px 99px",
  }, map);
  // Sem conditionality, uma entrada content-driven aprovada suprime qualquer divergência — que é o
  // comportamento ANTERIOR, preservado. A exceção condicional só RESTRINGE, nunca amplia.
  assert(r.status === "JUSTIFIED",
    `o comportamento pré-existente de content-driven mudou (veio ${r.status}) — esta mudança devia só restringir`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ ALLOWLIST CONDITIONALITY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
