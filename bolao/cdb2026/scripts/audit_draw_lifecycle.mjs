#!/usr/bin/env node
/**
 * AUDITORIA — INVARIANTE DE CICLO DE VIDA DO SORTEIO (hotfix 2026-08-07)
 * ============================================================================
 *
 * Regra sob teste:
 *
 *     Enquanto uma fase com sorteio (hoje só `quartas`) não tiver sorteio oficial,
 *     `phases.quartas.ties` DEVE estar vazio — na leitura/render, no merge, na gravação local e
 *     no payload remoto. Qualquer confronto ali é fantasma por definição.
 *
 * Contexto real: depois do reparo manual da produção, o navegador do Eduardo seguia mostrando
 * "próxima partida Bahia × Santos". A produção estava limpa (quartas 0 ties, cutoffAt null) e o par
 * é IMPOSSÍVEL no bracket real (Bahia eliminado na fase-5). Era estado sintético no localStorage
 * dele, que o merge por UNIÃO nunca apagava — e que um save de admin devolveria à produção.
 *
 * As funções testadas são extraídas do `js/app.js` REAL (mesma técnica de
 * audit_entry_roster_freeze.mjs), não transcritas.
 *
 * Uso: node bolao/cdb2026/scripts/audit_draw_lifecycle.mjs
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
  if (!m) throw new Error(`const ${name} (Set) não encontrada`);
  return `const ${name} = new Set([${m[1]}]);`;
}

const sandbox = new Function(`
  ${extractSet("DRAW_GATED_PHASES")}
  ${extractFn("phaseDrawIsOfficial")}
  ${extractFn("enforceDrawLifecycle")}
  return { DRAW_GATED_PHASES, phaseDrawIsOfficial, enforceDrawLifecycle };
`)();
const { enforceDrawLifecycle, phaseDrawIsOfficial } = sandbox;

// O confronto fabricado real do incidente.
const PHANTOM = { teamA: "Bahia", teamB: "Santos", matches: { first: { kickoff: "2026-08-20T21:00:00-03:00" } } };
const OITAVAS_REAL = {
  "espn-remo_santos": { teamA: "Santos", teamB: "Remo", qualifiedTeamId: "A" },
  "espn-gremio_mirassol": { teamA: "Mirassol", teamB: "Grêmio", qualifiedTeamId: "B" },
};

function contaminatedState(over = {}) {
  return JSON.parse(JSON.stringify({
    entries: [
      { id: "e1", entryName: "Participante Um", picks: { matches: {}, qualified: {} } },
      { id: "e2", entryName: "Participante Dois", picks: { matches: {}, qualified: {} } },
    ],
    deletedIds: [],
    paid: { e1: true, e2: false },
    auditLog: [{ at: "2026-08-01T00:00:00Z", what: "algo" }],
    espnSync: { activePhaseId: "oitavas", healedPhantomTies: true },
    phases: {
      oitavas: { cutoffAt: "2026-08-01T20:30:00.000Z", ties: JSON.parse(JSON.stringify(OITAVAS_REAL)) },
      quartas: { cutoffAt: null, ties: { "phantom-bahia-santos": JSON.parse(JSON.stringify(PHANTOM)) } },
      semifinal: { cutoffAt: null, ties: {} },
      final: { cutoffAt: null, ties: {} },
    },
    meta: { updatedAt: "2026-08-07T00:00:00Z" },
    ...over,
  }));
}

console.log("\nCDB2026 — invariante de ciclo de vida do sorteio\n");

// ── 1 ────────────────────────────────────────────────────────────────────────
test("1 local com tie sintético + remoto vazio + sem sorteio oficial -> quartas fica vazia", () => {
  const s = contaminatedState();
  eq(Object.keys(s.phases.quartas.ties).length, 1, "fixture não estava contaminado");
  const changed = enforceDrawLifecycle(s);
  eq(changed, true, "sanitizador não reportou mudança");
  eq(Object.keys(s.phases.quartas.ties).length, 0, "tie fantasma sobreviveu");
});

// ── 2 ────────────────────────────────────────────────────────────────────────
// saveState() chama enforceDrawLifecycle ANTES de serializar, e o payload remoto deriva desse
// objeto. Prova o contrato no ponto de gravação, sem depender de DOM/localStorage.
test("2 gravação: o objeto entregue ao persist já vai com quartas.ties vazio", () => {
  const s = contaminatedState();
  enforceDrawLifecycle(s);                       // o que saveState() faz na primeira linha
  const persisted = JSON.parse(JSON.stringify(s)); // o que vai pro localStorage / payload
  eq(Object.keys(persisted.phases.quartas.ties).length, 0, "payload persistido levou tie fantasma");
  assert(!JSON.stringify(persisted).includes("Bahia"), "o par fabricado ainda aparece no payload");
});

// ── 3 ────────────────────────────────────────────────────────────────────────
test("3 oitavas válidas permanecem INTACTAS", () => {
  const s = contaminatedState();
  enforceDrawLifecycle(s);
  eq(Object.keys(s.phases.oitavas.ties).length, 2, "oitavas perdeu confronto");
  eq(s.phases.oitavas.ties["espn-remo_santos"].qualifiedTeamId, "A", "qualified das oitavas mudou");
  eq(s.phases.oitavas.cutoffAt, "2026-08-01T20:30:00.000Z", "cutoffAt das oitavas mudou");
});

// ── 4 ────────────────────────────────────────────────────────────────────────
test("4 entries permanecem INTACTAS", () => {
  const s = contaminatedState();
  const before = JSON.stringify(s.entries);
  enforceDrawLifecycle(s);
  eq(JSON.stringify(s.entries), before, "entries foram alteradas");
  eq(s.entries.length, 2, "número de entradas mudou");
});

// ── 5 ────────────────────────────────────────────────────────────────────────
test("5 paid permanece INTACTO", () => {
  const s = contaminatedState();
  const before = JSON.stringify(s.paid);
  enforceDrawLifecycle(s);
  eq(JSON.stringify(s.paid), before, "paid foi alterado");
});

// ── 6 ────────────────────────────────────────────────────────────────────────
test("6a sorteio oficial validado (proveniência) -> quartas válidas SOBREVIVEM", () => {
  const s = contaminatedState();
  s.phases.quartas.officialDraw = { source: "CBF", validatedAt: "2026-08-10T12:00:00Z" };
  s.phases.quartas.ties = { "qf-1": { teamA: "Santos", teamB: "Grêmio" } };
  const changed = enforceDrawLifecycle(s);
  eq(changed, false, "sanitizador mexeu numa fase com sorteio oficial");
  eq(Object.keys(s.phases.quartas.ties).length, 1, "confronto oficial das quartas foi apagado");
});

test("6b cutoff registrado pelo admin -> quartas válidas SOBREVIVEM (fluxo manual atual)", () => {
  // Sem este caminho o sanitizador apagaria o sorteio real assim que o Eduardo o cadastrasse.
  const s = contaminatedState();
  s.phases.quartas.cutoffAt = "2026-08-12T20:00:00.000Z";
  s.phases.quartas.ties = { "qf-1": { teamA: "Santos", teamB: "Grêmio" } };
  eq(enforceDrawLifecycle(s), false, "sanitizador apagou confronto de fase já registrada");
  eq(Object.keys(s.phases.quartas.ties).length, 1, "confronto legítimo apagado");
});

// ── 7 ────────────────────────────────────────────────────────────────────────
test("7 reload com localStorage contaminado -> nada fabricado é renderizado nem persistido", () => {
  // state() sanea a leitura (chokepoint 1) e saveState a gravação (chokepoint 2). Aqui simulamos
  // os dois na ordem em que acontecem num reload real.
  const fromLocalStorage = contaminatedState();
  enforceDrawLifecycle(fromLocalStorage);              // state()
  eq(Object.keys(fromLocalStorage.phases.quartas.ties).length, 0, "render receberia tie fantasma");
  enforceDrawLifecycle(fromLocalStorage);              // saveState() no primeiro save
  eq(Object.keys(fromLocalStorage.phases.quartas.ties).length, 0, "persistiria tie fantasma");
  // idempotente: rodar de novo não deve reportar mudança
  eq(enforceDrawLifecycle(fromLocalStorage), false, "sanitizador não é idempotente");
});

// ── 8 ────────────────────────────────────────────────────────────────────────
test("8 nenhum fixture sintético reentra na produção por um save de admin comum", () => {
  // Cenário exato do risco: admin marca um pagamento num navegador com cache sujo. A mutação
  // dirigida não passa por mergeStates, então o chokepoint 4 (payload remoto) é o que segura.
  const local = contaminatedState();
  const remoteClean = contaminatedState({ phases: {
    oitavas: { cutoffAt: "2026-08-01T20:30:00.000Z", ties: JSON.parse(JSON.stringify(OITAVAS_REAL)) },
    quartas: { cutoffAt: null, ties: {} },
    semifinal: { cutoffAt: null, ties: {} },
    final: { cutoffAt: null, ties: {} },
  } });
  eq(Object.keys(remoteClean.phases.quartas.ties).length, 0, "remoto de referência não estava limpo");

  // applyMutationOverRemote-like: parte do REMOTO e aplica só a mutação — mas o objeto local
  // contaminado é a fonte de `paid`, e historicamente os ties locais vinham de carona.
  const payload = JSON.parse(JSON.stringify(remoteClean));
  payload.paid = { ...payload.paid, e2: true };                 // a mutação real
  payload.phases.quartas.ties = { ...local.phases.quartas.ties }; // a contaminação de carona
  eq(Object.keys(payload.phases.quartas.ties).length, 1, "cenário não reproduziu a contaminação");

  enforceDrawLifecycle(payload);                                 // chokepoint 4
  eq(Object.keys(payload.phases.quartas.ties).length, 0, "tie sintético voltaria para a produção");
  eq(payload.paid.e2, true, "a mutação legítima do admin foi perdida");
  assert(!JSON.stringify(payload).includes("Bahia"), "par fabricado ainda no payload remoto");
});

// ── extras de contrato ───────────────────────────────────────────────────────
test("semifinal/final NÃO estão no gate (resolvem por vencedores, Batch 4)", () => {
  assert(!sandbox.DRAW_GATED_PHASES.has("semifinal"), "semifinal entrou no gate de sorteio");
  assert(!sandbox.DRAW_GATED_PHASES.has("final"), "final entrou no gate de sorteio");
  assert(sandbox.DRAW_GATED_PHASES.has("quartas"), "quartas saiu do gate");
});

test("phaseDrawIsOfficial: null/undefined/vazio não contam como oficial", () => {
  eq(phaseDrawIsOfficial(null), false, "phase null virou oficial");
  eq(phaseDrawIsOfficial({ cutoffAt: null }), false, "cutoffAt null virou oficial");
  eq(phaseDrawIsOfficial({}), false, "phase sem campos virou oficial");
  eq(phaseDrawIsOfficial({ officialDraw: {} }), false, "officialDraw sem validatedAt virou oficial");
  eq(phaseDrawIsOfficial({ officialDraw: { validatedAt: "2026-08-10T12:00:00Z" } }), true,
    "proveniência validada não foi aceita");
});

test("o guard de add-tie existe e lança QF_DRAW_NOT_OFFICIAL (falha explícita, não perda silenciosa)", () => {
  const body = extractFn("applyAdminMutation");
  assert(body.includes("QF_DRAW_NOT_OFFICIAL"), "add-tie não recusa fase sem sorteio oficial");
  assert(body.includes("DRAW_GATED_PHASES.has(mutation.phaseId)"),
    "o guard de add-tie não consulta DRAW_GATED_PHASES");
});

test("o invariante está em TODO chokepoint que ainda existe", () => {
  // O quarto chokepoint era `saveRemoteState()` — o payload remoto. Em 2026-08-12 ele virou
  // lápide: lança incondicionalmente, porque o navegador não grava mais documento inteiro.
  //
  // Exigir `enforceDrawLifecycle` lá dentro seria exigir uma guarda para uma travessia que não
  // acontece mais, e o único jeito de satisfazer isso seria RESSUSCITAR a escrita. Chokepoint
  // removido é mais forte que chokepoint guardado: não há o que atravessar.
  //
  // A lápide precisa lançar SEM CONDIÇÃO e não pode alcançar a rede — senão não é lápide, é uma
  // porta com aviso.
  for (const [fn, why] of [["state", "leitura/render"], ["saveState", "gravação local"],
                           ["mergeStates", "merge"]]) {
    assert(extractFn(fn).includes("enforceDrawLifecycle("),
      `${fn}() (${why}) não aplica enforceDrawLifecycle — chokepoint descoberto`);
  }

  const remoto = extractFn("saveRemoteState");
  const lapide = remoto.includes("throw new Error(")
                 && !remoto.includes("fetchJson") && !remoto.includes("fetch(");
  if (lapide) {
    assert(!/\bif\s*\(/.test(remoto),
      "a lápide de saveRemoteState() ganhou um `if` — condição ali é uma porta, e o payload " +
      "remoto voltaria a existir sem passar por enforceDrawLifecycle");
    return;
  }
  assert(remoto.includes("enforceDrawLifecycle("),
    "saveRemoteState() voltou a gravar e NÃO aplica enforceDrawLifecycle — chokepoint descoberto");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DRAW LIFECYCLE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
