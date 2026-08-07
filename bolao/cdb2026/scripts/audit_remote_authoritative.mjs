#!/usr/bin/env node
/**
 * CDB2026 — REMOTO AUTORITATIVO NO LOAD.
 *
 * Incidente real (Eduardo, 2026-08-07, depois de a produção estar comprovadamente limpa):
 * o navegador dele mostrava "Próxima partida Bahia × Santos / Oitavas de Final", entradas
 * "Participante A"/"Participante D" e pote de $65 (13 x $5). Leitura read-only da produção no mesmo
 * momento: 12 entradas REAIS, nenhum confronto Bahia × Santos em fase alguma, nenhum marcador de
 * fixture. Ou seja: o dado errado estava só no navegador dele.
 *
 * Por que sobrevivia:
 *   - `ties` era UNIÃO nas duas direções e ties NÃO têm tombstone -> confronto só-local imortal;
 *   - o invariante de sorteio (enforceDrawLifecycle) cobre QUARTAS, e este fantasma estava nas
 *     OITAVAS, uma fase já oficial — fora do alcance dele;
 *   - entradas eram unidas por id, então entrada sintética só-local também era imortal;
 *   - e o caminho de SAVE reenviaria tudo isso de volta para a produção.
 *
 * Regra sob teste: no LOAD (quando um estado remoto foi REALMENTE lido), o remoto é a verdade —
 * o CONJUNTO de confrontos de uma fase que o remoto possui é o do remoto, e (com o roster
 * congelado) o CONJUNTO de entradas é o do remoto. Fora do load segue união, de propósito.
 *
 * Uso: node bolao/cdb2026/scripts/audit_remote_authoritative.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "js", "app.js");
const src = readFileSync(APP_JS, "utf8");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

function extractFn(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() não encontrada`);
  if (src.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  let p = src.indexOf("(", start), parens = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === "(") parens++;
    else if (src[j] === ")") { parens--; if (parens === 0) { bodyStart = src.indexOf("{", j); break; } }
  }
  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`chaves desbalanceadas em ${name}()`);
}
function extractSet(name) {
  const m = src.match(new RegExp(`\\nconst ${name} = new Set\\(\\[([^\\]]*)\\]\\);`));
  if (!m) throw new Error(`const ${name} não encontrada`);
  return `const ${name} = new Set([${m[1]}]);`;
}

// Sandbox com as funções REAIS do app.js. `frozen` controla C.entryRosterFrozen.
function build(frozen = true) {
  const code = `
    const C = { entryRosterFrozen: ${frozen}, siteVersion: "test" };
    const DATA = { phases: [{ id: "oitavas" }, { id: "quartas" }, { id: "semifinal" }, { id: "final" }] };
    function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
    ${extractSet("DRAW_GATED_PHASES")}
    ${extractFn("phaseDrawIsOfficial")}
    ${extractFn("enforceDrawLifecycle")}
    ${extractFn("mergeEntriesTombstonesAuditLog")}
    ${extractFn("mergeStates")}
    return { mergeStates };
  `;
  return new Function(code)();
}

const REAL_ENTRIES = [
  { id: "r1", entryName: "Eduardo Ferrari", createdAt: "2026-07-20T10:00:00Z" },
  { id: "r2", entryName: "Gabriel Ferrari", createdAt: "2026-07-20T11:00:00Z" },
];
const OITAVAS_REAL = { "espn-remo_santos": { teamA: "Santos", teamB: "Remo", qualifiedTeamId: "A" } };

// Remoto = produção limpa.
function cleanRemote() {
  return JSON.parse(JSON.stringify({
    entries: REAL_ENTRIES, deletedIds: [], paid: { r1: true }, auditLog: [],
    espnSync: { activePhaseId: "oitavas" },
    phases: {
      oitavas: { cutoffAt: "2026-08-01T20:30:00.000Z", ties: OITAVAS_REAL },
      quartas: { cutoffAt: null, ties: {} }, semifinal: { cutoffAt: null, ties: {} }, final: { cutoffAt: null, ties: {} },
    },
    meta: { updatedAt: "2026-08-07T14:50:39.754Z" },
  }));
}
// Local = navegador contaminado do incidente.
function contaminatedLocal() {
  const s = cleanRemote();
  s.entries = [...REAL_ENTRIES,
    { id: "synth-a", entryName: "Participante A", createdAt: "2026-08-01T00:00:00Z" },
    { id: "synth-d", entryName: "Participante D", createdAt: "2026-08-01T00:00:00Z" }];
  s.paid = { r1: true, "synth-a": true }; // chave de pagamento fantasma inflava o pote
  s.phases.oitavas.ties = { ...OITAVAS_REAL,
    "phantom-bahia-santos": { teamA: "Bahia", teamB: "Santos",
      matches: { first: { kickoff: "2026-08-10T19:30:00-03:00", status: "SCHEDULED" } } } };
  s.meta.updatedAt = "2026-08-07T23:00:00.000Z"; // local MAIS NOVO: não pode ganhar por isso
  return s;
}

const LOAD = { preferRemoteResults: true, remoteAuthoritative: true };
const SAVE = { preferRemoteResults: true };

console.log("\nCDB2026 — remoto autoritativo no load\n");

test("LOAD: confronto fantasma nas OITAVAS (fase já oficial) é eliminado", () => {
  const { mergeStates } = build(true);
  const m = mergeStates(contaminatedLocal(), cleanRemote(), LOAD);
  const ties = Object.keys(m.phases.oitavas.ties);
  assert(!ties.includes("phantom-bahia-santos"), `o fantasma sobreviveu: ${ties}`);
  eq(ties.length, 1, "conjunto de confrontos das oitavas não ficou igual ao remoto");
  assert(!JSON.stringify(m).includes("Bahia"), "o par fabricado ainda aparece no estado mesclado");
});

test("LOAD: entradas sintéticas só-locais são eliminadas (roster congelado)", () => {
  const { mergeStates } = build(true);
  const m = mergeStates(contaminatedLocal(), cleanRemote(), LOAD);
  const names = m.entries.map(e => e.entryName);
  eq(m.entries.length, 2, `esperava só as 2 entradas reais, veio ${names}`);
  assert(!names.includes("Participante A") && !names.includes("Participante D"),
    `entrada sintética sobreviveu: ${names}`);
});

test("LOAD: chave de `paid` órfã é removida (era o pote de $65 com 12 entradas)", () => {
  const { mergeStates } = build(true);
  const m = mergeStates(contaminatedLocal(), cleanRemote(), LOAD);
  assert(!("synth-a" in m.paid), "chave de pagamento fantasma sobreviveu e inflaria o pote");
  eq(m.paid.r1, true, "pagamento de entrada REAL foi perdido");
});

test("LOAD: dado remoto legítimo é preservado integralmente", () => {
  const { mergeStates } = build(true);
  const m = mergeStates(contaminatedLocal(), cleanRemote(), LOAD);
  eq(m.phases.oitavas.ties["espn-remo_santos"].qualifiedTeamId, "A", "qualified real alterado");
  eq(m.phases.oitavas.cutoffAt, "2026-08-01T20:30:00.000Z", "cutoffAt real alterado");
  eq(m.entries.find(e => e.id === "r1").entryName, "Eduardo Ferrari", "entrada real alterada");
});

test("LOAD: `updatedAt` local mais novo NÃO ressuscita resíduo", () => {
  // O local do incidente era mais recente que o remoto; a autoridade não pode depender disso.
  const { mergeStates } = build(true);
  const m = mergeStates(contaminatedLocal(), cleanRemote(), LOAD);
  eq(m.entries.length, 2, "local mais novo trouxe as entradas sintéticas de volta");
});

test("SAVE (união) PRESERVA confronto local que o admin acabou de cadastrar", () => {
  // Contrapartida obrigatória: fora do load, um confronto novo ainda não está no remoto e
  // descartá-lo perderia trabalho real do admin.
  const { mergeStates } = build(true);
  const local = cleanRemote();
  local.phases.quartas.cutoffAt = "2026-08-12T20:00:00.000Z"; // sorteio oficial registrado
  local.phases.quartas.ties = { "qf-1": { teamA: "Santos", teamB: "Grêmio" } };
  const m = mergeStates(local, cleanRemote(), SAVE);
  eq(Object.keys(m.phases.quartas.ties).length, 1, "o save descartou confronto novo do admin");
});

test("SAVE (união) PRESERVA entrada local ainda não sincronizada", () => {
  const { mergeStates } = build(true);
  const local = cleanRemote();
  local.entries = [...REAL_ENTRIES, { id: "new1", entryName: "Recém salvo", createdAt: "2026-08-07T23:59:00Z" }];
  const m = mergeStates(local, cleanRemote(), SAVE);
  eq(m.entries.length, 3, "o save perdeu uma entrada local ainda não sincronizada");
});

test("ROSTER ABERTO: o load NÃO descarta entrada local (trabalho offline legítimo)", () => {
  // A autoridade sobre ENTRADAS depende do congelamento: com roster aberto, entrada local só
  // significa "ainda não sincronizou".
  const { mergeStates } = build(false);
  const local = cleanRemote();
  local.entries = [...REAL_ENTRIES, { id: "offline1", entryName: "Offline", createdAt: "2026-08-07T23:00:00Z" }];
  const m = mergeStates(local, cleanRemote(), LOAD);
  eq(m.entries.length, 3, "com roster ABERTO o load descartou entrada local legítima");
});

test("ROSTER ABERTO: a autoridade sobre TIES continua valendo (é do admin, não do participante)", () => {
  const { mergeStates } = build(false);
  const m = mergeStates(contaminatedLocal(), cleanRemote(), LOAD);
  assert(!Object.keys(m.phases.oitavas.ties).includes("phantom-bahia-santos"),
    "fantasma de confronto sobreviveu com roster aberto");
});

test("fase que o remoto NÃO possui não é apagada (proteção contra remoto parcial)", () => {
  const { mergeStates } = build(true);
  const local = cleanRemote();
  local.phases.quartas.cutoffAt = "2026-08-12T20:00:00.000Z";
  local.phases.quartas.ties = { "qf-1": { teamA: "Santos", teamB: "Grêmio" } };
  const remote = cleanRemote();
  delete remote.phases.quartas;                       // remoto sem a fase
  const m = mergeStates(local, remote, LOAD);
  eq(Object.keys(m.phases.quartas.ties).length, 1,
    "o load apagou confrontos de uma fase que o remoto nem tinha");
});

test("o load é o ÚNICO lugar que passa remoteAuthoritative", () => {
  const load = extractFn("loadRemoteState");
  assert(/remoteAuthoritative:\s*true/.test(load), "loadRemoteState() não pede autoridade remota");
  const save = extractFn("saveRemoteState");
  assert(!/remoteAuthoritative:\s*true/.test(save),
    "saveRemoteState() pede autoridade remota — descartaria trabalho local não sincronizado");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ REMOTE AUTHORITATIVE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
