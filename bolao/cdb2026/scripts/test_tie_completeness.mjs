#!/usr/bin/env node
/**
 * CDB2026 — completude de confronto na validação de palpites (Issue #167).
 *
 * O DEFEITO
 * ---------
 * Um confronto REQUERIDO/ABERTO pode existir em `phase.ties` (estado canônico, contado para
 * `drawLocked`) enquanto seu `teamA`/`teamB` ainda não chegaram no estado LOCAL de um cliente
 * específico (ex.: sincronização desatualizada). `renderPickForm()` pula esse confronto por
 * completo -- sem bloco, sem erro, sem placeholder (`if (!tie.teamA || !tie.teamB) return;`).
 * `getPickValues()`/`validatePicks()` liam SÓ `$$(".tie-pick-block.open")` -- o DOM que a
 * renderização já filtrou, não `phase.ties` (estado canônico) -- então o confronto omitido era
 * estruturalmente invisível para toda checagem da cadeia, cliente e servidor.
 *
 * Reproduzido por execução isolada (não hipótese): com um confronto renderizado e outro
 * inteiramente ausente do DOM simulado, `getPickValues()` omitia o confronto ausente e
 * `validatePicks()` devolvia zero erros.
 *
 * As funções são recortadas do app.js REAL -- não reescritas aqui. `state()` é substituída por
 * uma versão de teste que devolve o fixture direto (a real lê localStorage, inacessível aqui).
 *
 * Uso: node bolao/cdb2026/scripts/test_tie_completeness.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(HERE, "..", "js", "app.js");
const src = readFileSync(APP_JS, "utf8");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`); };

/** Recorta uma função de nível superior do app.js pelo balanceamento de chaves. */
function cut(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`função ${name} sumiu do app.js`);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") { depth++; started = true; }
    else if (src[j] === "}") { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`não consegui recortar ${name}`);
}

// Fixture minimal de DATA.phases -- só o que phaseFullyResolved/tiesInvisibleForIncompleteTeams
// e validatePicks tocam (id, format). legsForFormat/predictedAggFromPicks não são exercitadas
// pelos testes deste arquivo (a lacuna é sobre COMPLETUDE, não sobre pontuação de mão).
const harness = `
const DATA = { phases: [
  { id: "quartas", format: "single" },
  { id: "semifinal", format: "single" },
] };
function legsForFormat() { return ["single"]; }
function predictedAggFromPicks() { return null; }
function $$() { return []; }  // nenhum bloco no DOM -- o cenário exato do defeito
let t_calls = [];
function t(key) { t_calls.push(key); return key; }

${cut("emptyPhaseState")}
${cut("phaseFullyResolved")}
${cut("tiesInvisibleForIncompleteTeams")}
${cut("validatePicks")}
function state() { return globalThis.__FIXTURE_STATE__; }

return { validatePicks, tiesInvisibleForIncompleteTeams, setFixture: (s) => { globalThis.__FIXTURE_STATE__ = s; } };
`;
const { validatePicks, tiesInvisibleForIncompleteTeams, setFixture } = new Function(harness)();

const tieCompleto = (a, b) => ({ teamA: a, teamB: b });
const tieIncompleto = () => ({ teamA: null, teamB: null });

console.log("\nCDB2026 — completude de confronto na validação de palpites\n");

test("REGRESSÃO (Issue #167): confronto sem teamA/teamB é detectado mesmo sem bloco no DOM", () => {
  setFixture({
    phases: {
      quartas: { ties: {
        "tie-1": tieCompleto("Flamengo", "Palmeiras"),
        "tie-2": tieIncompleto(),   // sincronização desatualizada -- servidor tem, cliente não
      } },
    },
  });
  const picks = { matches: { "tie-1": { single: { goalsHome: 1, goalsAway: 0 } } }, qualified: { "tie-1": "A" } };
  const errors = validatePicks(picks);
  assert(errors.length > 0, "confronto incompleto tem de gerar erro mesmo sem bloco renderizado");
});

test("tiesInvisibleForIncompleteTeams identifica exatamente o confronto incompleto", () => {
  setFixture({
    phases: {
      quartas: { ties: { "tie-1": tieCompleto("A", "B"), "tie-2": tieIncompleto() } },
    },
  });
  eq(tiesInvisibleForIncompleteTeams(globalThis.__FIXTURE_STATE__), ["tie-2"], "conjunto de confrontos invisíveis");
});

test("confronto JÁ DECIDIDO (qualifiedTeamId) sem teamA/teamB não conta -- nada a apostar", () => {
  setFixture({
    phases: {
      quartas: { ties: { "tie-1": { teamA: null, teamB: null, qualifiedTeamId: "A" } } },
    },
  });
  eq(tiesInvisibleForIncompleteTeams(globalThis.__FIXTURE_STATE__), [], "confronto decidido não deveria ser flagged");
});

test("fase sem sorteio nenhum (ties vazio) não gera falso positivo", () => {
  setFixture({ phases: { semifinal: { ties: {} } } });
  eq(tiesInvisibleForIncompleteTeams(globalThis.__FIXTURE_STATE__), [], "fase derivada/sem sorteio não deve ser tocada por este check");
});

test("fase TOTALMENTE resolvida (todos qualifiedTeamId) não gera falso positivo", () => {
  setFixture({
    phases: {
      quartas: { ties: {
        "tie-1": { teamA: "A", teamB: "B", qualifiedTeamId: "A" },
        "tie-2": { teamA: "C", teamB: "D", qualifiedTeamId: "B" },
      } },
    },
  });
  eq(tiesInvisibleForIncompleteTeams(globalThis.__FIXTURE_STATE__), [], "fase totalmente resolvida não tem nada a apostar");
});

test("conjunto totalmente completo não gera erro de completude", () => {
  setFixture({
    phases: { quartas: { ties: { "tie-1": tieCompleto("A", "B") } } },
  });
  const picks = { matches: { "tie-1": { single: { goalsHome: 1, goalsAway: 0 } } }, qualified: { "tie-1": "A" } };
  const errors = validatePicks(picks);
  eq(errors, [], "conjunto completo não deveria gerar erro");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
