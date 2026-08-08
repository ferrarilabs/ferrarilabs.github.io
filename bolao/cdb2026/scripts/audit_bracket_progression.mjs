#!/usr/bin/env node
/**
 * CDB2026 — Batch 4: progressão determinística quartas → semifinal → final.
 *
 * A Copa do Brasil tem UM sorteio, a partir das quartas. Não existe sorteio de semifinal nem de
 * final: os participantes das fases seguintes são DERIVADOS dos vencedores. Mas "derivado" não é
 * "convencional": o mapeamento vencedor-de-QF → vaga-de-SF é DADO OFICIAL da competição. A CBF não
 * publicou nem o sorteio nem esse mapeamento, então a topologia é REGISTRADA, nunca inferida —
 * supor qf-1×qf-2 / qf-3×qf-4 seria fabricar chaveamento oficial.
 *
 * Esta suíte prova as cinco preocupações separadas do módulo (topologia / resolução / resultado /
 * qualificação / renderização) e, sobretudo, as duas propriedades que protegem dinheiro real:
 * NENHUM caminho fabrica identidade de time, e NADA aqui toca entradas, palpites, pagamento ou
 * pontuação.
 *
 * Uso: node bolao/cdb2026/scripts/audit_bracket_progression.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(HERE, "..", "js", "app.js");
const I18N_JS = join(HERE, "..", "js", "i18n.js");
const src = readFileSync(APP_JS, "utf8");
const i18nSrc = readFileSync(I18N_JS, "utf8");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function throwsCode(fn, code, m) {
  try { fn(); } catch (e) { if (e.code === code || String(e.message).startsWith(code)) return; throw new Error(`${m}: esperava ${code}, veio ${e.code || e.message}`); }
  throw new Error(`${m}: não lançou (esperava ${code})`);
}

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
const decl = (re, label) => { const m = src.match(re); if (!m) throw new Error(`${label} não encontrado`); return m[0]; };

// Dicionário REAL do app: se uma chave não existir, participantLabel() devolveria o próprio nome da
// chave e um rótulo cru vazaria para produção. É por isso que o t() daqui não é um stub.
const DICT = new Function("window", `${i18nSrc}\n return window.CDB2026_I18N;`)({})["pt-BR"];

const sb = new Function(`
  const DATA = { phases: [{ id: "oitavas" }, { id: "quartas" }, { id: "semifinal" }, { id: "final" }],
                 phasesConcludedNoData: [] };
  const C = { entryRosterFrozen: true, siteVersion: "test" };
  const DICT = ${JSON.stringify(DICT)};
  function t(k) { return Object.prototype.hasOwnProperty.call(DICT, k) ? DICT[k] : k; }
  function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
  function isEntryCreationAllowed() { return false; }
  ${decl(/const DRAW_LIFECYCLE = Object\.freeze\(\{[\s\S]*?\}\);/, "DRAW_LIFECYCLE")}
  ${decl(/const OFFICIAL_DRAW_REQUIRED_FIELDS = \[[^\]]*\];/, "OFFICIAL_DRAW_REQUIRED_FIELDS")}
  ${decl(/const TOPOLOGY_REQUIRED_FIELDS = \[[^\]]*\];/, "TOPOLOGY_REQUIRED_FIELDS")}
  ${decl(/const DRAW_GATED_PHASES = new Set\(\[[^\]]*\]\);/, "DRAW_GATED_PHASES")}
  ${decl(/const DERIVED_PHASES = Object\.freeze\(\{[^}]*\}\);/, "DERIVED_PHASES")}
  ${extractFn("hashString")}
  ${extractFn("bracketFingerprint")}
  ${extractFn("officialDrawProvenanceIsValid")}
  ${extractFn("drawLifecycle")}
  ${extractFn("phaseDrawIsOfficial")}
  ${extractFn("enforceDrawLifecycle")}
  ${extractFn("qualifiedTeamsForQuartas")}
  ${extractFn("drawIngestError")}
  ${extractFn("normalizeCbfDraw")}
  ${extractFn("officialDrawReingestDecision")}
  ${extractFn("topologyProvenanceIsValid")}
  ${extractFn("topologyFingerprint")}
  ${extractFn("validateTopology")}
  ${extractFn("topologyReregisterDecision")}
  ${extractFn("tieQualifiedTeam")}
  ${extractFn("resolveParticipant")}
  ${extractFn("derivedPhaseView")}
  ${extractFn("participantLabel")}
  ${extractFn("tieDisplayName")}
  ${extractFn("mergeEntriesTombstonesAuditLog")}
  ${extractFn("mergeStates")}
  ${extractFn("applyAdminMutation")}
  ${extractFn("applyMutationOverRemote")}
  return { normalizeCbfDraw, applyAdminMutation, applyMutationOverRemote, mergeStates,
           validateTopology, topologyFingerprint, topologyReregisterDecision, derivedPhaseView,
           resolveParticipant, tieQualifiedTeam, participantLabel, tieDisplayName, DERIVED_PHASES };
`)();
const { normalizeCbfDraw, applyAdminMutation, applyMutationOverRemote, mergeStates,
        validateTopology, topologyFingerprint, topologyReregisterDecision, derivedPhaseView,
        resolveParticipant, tieQualifiedTeam, participantLabel, tieDisplayName,
        DERIVED_PHASES } = sb;

// ─── Fixtures ────────────────────────────────────────────────────────────────
const Q8 = ["Santos", "Grêmio", "Palmeiras", "Vasco", "Cruzeiro", "Flamengo", "Corinthians", "Fluminense"];
const OFFICIAL_PAIRS = [["Santos", "Grêmio"], ["Palmeiras", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
const SOURCE_URL = "https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/2026";
const clone = o => JSON.parse(JSON.stringify(o));

function baseState() {
  return clone({
    entries: [{ id: "e1", entryName: "Participante Real",
                picks: { matches: { "oitavas:o1:first": { home: 1, away: 0 } }, qualified: { o1: "A" } } }],
    deletedIds: [], paid: { e1: true }, auditLog: [],
    espnSync: { activePhaseId: "oitavas" },
    phases: {
      oitavas: { cutoffAt: "2026-08-01T20:30:00.000Z", ties: Object.fromEntries(
        Q8.map((tm, i) => [`o${i + 1}`, { teamA: tm, teamB: `Eliminado${i + 1}`, qualifiedTeamId: "A" }])) },
      quartas: { cutoffAt: null, ties: {} },
      semifinal: { cutoffAt: null, ties: {} },
      final: { cutoffAt: null, ties: {} },
    },
    meta: { updatedAt: "2026-08-07T00:00:00Z" },
  });
}

// Estado com as quartas oficialmente sorteadas (Batch 3), SEM topologia registrada.
function withQuartas() {
  return applyAdminMutation(baseState(), {
    type: "register-official-draw", phaseId: "quartas", pairs: OFFICIAL_PAIRS, qualified: Q8,
    source: "cbf-publication", sourceUrl: SOURCE_URL, publishedAt: "2026-08-09T19:00:00Z",
    validatedBy: "admin",
  });
}
const qfIds = s => Object.keys(s.phases.quartas.ties).sort();

// TOPOLOGIA DECLARADA — fixture de TESTE, nunca convenção do produto. Escolhida deliberadamente
// FORA de qualquer padrão óbvio (qf-1×qf-4, qf-2×qf-3) justamente para que um código que "adivinha"
// 1×2 / 3×4 falhe aqui em vez de passar por acidente.
function sfTopology(s) {
  const [a, b, c, d] = qfIds(s);
  return { "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: d } },
           "sf-2": { sideA: { winnerOf: b }, sideB: { winnerOf: c } } };
}
const registerTopology = (s, phaseId, slots, over = {}) => applyAdminMutation(s, {
  type: "register-bracket-topology", phaseId, slots, source: "cbf-publication",
  sourceUrl: SOURCE_URL, publishedAt: "2026-08-09T19:00:00Z", validatedBy: "admin", ...over,
});

// Marca o vencedor de um confronto (caminho canônico do admin: lock-tie).
const lockTie = (s, phaseId, tieId, side) => applyAdminMutation(s, {
  type: "lock-tie", phaseId, tieId, qualifiedTeamId: side,
  lockedAt: "2026-09-01T22:00:00Z", lockedBy: "admin",
});

// Cria os confrontos reais de uma fase derivada a partir da topologia já resolvida (é o que o admin
// faz quando as duas vagas de uma semifinal têm dono).
function materializeSlot(s, phaseId, slotId) {
  const view = derivedPhaseView(s, phaseId);
  const slot = view.slots.find(x => x.slotId === slotId);
  assert(slot && slot.bothResolved, `slot ${slotId} não resolvido`);
  return applyAdminMutation(s, { type: "add-tie", phaseId, tieId: slotId,
    tie: { teamA: slot.sideA.team, teamB: slot.sideB.team } });
}

console.log("\nCDB2026 — Batch 4: progressão QF → SF → Final\n");

// ═══ 1. TOPOLOGIA: ausência, registro, validação ═════════════════════════════

test("1. sem sorteio de quartas -> topologia impossível, NENHUM confronto futuro", () => {
  const s = baseState();
  eq(Object.keys(s.phases.quartas.ties).length, 0, "quartas não deveriam ter confronto");
  throwsCode(() => registerTopology(s, "semifinal", { "sf-1": { sideA: { winnerOf: "qf-1" }, sideB: { winnerOf: "qf-2" } } }),
    "TOPOLOGY_PREDECESSOR_EMPTY", "registrou topologia sem fase predecessora");
  eq(derivedPhaseView(s, "semifinal").topologyKnown, false, "inventou topologia");
  eq(derivedPhaseView(s, "semifinal").slots.length, 0, "fabricou vaga");
});

test("2. sorteio de quartas existe MAS topologia ausente -> semifinal permanece desconhecida", () => {
  const s = withQuartas();
  eq(Object.keys(s.phases.quartas.ties).length, 4, "quartas deveriam ter 4 confrontos");
  const view = derivedPhaseView(s, "semifinal");
  eq(view.topologyKnown, false, "derivou topologia a partir do sorteio (proibido)");
  eq(view.slots.length, 0, "fabricou vaga de semifinal");
  eq(Object.keys(s.phases.semifinal.ties).length, 0, "fabricou confronto de semifinal");
});

test("3. topologia válida -> registrada com proveniência e fingerprint", () => {
  const s0 = withQuartas();
  const s = registerTopology(s0, "semifinal", sfTopology(s0));
  const topo = s.phases.semifinal.topology;
  assert(topo && topo.slots, "topologia não gravada");
  eq(Object.keys(topo.slots).length, 2, "número de vagas errado");
  eq(topo.provenance.authority, "CBF", "autoridade errada");
  eq(topo.provenance.sourceUrl, SOURCE_URL, "evidência (sourceUrl) não preservada");
  assert(topo.provenance.ingestedAt && topo.provenance.validatedAt, "proveniência incompleta");
  eq(topo.provenance.topologyFingerprint, topologyFingerprint(topo.slots), "fingerprint não confere");
  eq(derivedPhaseView(s, "semifinal").topologyKnown, true, "topologia registrada não foi reconhecida");
});

test("4. topologia OBRIGATÓRIA -> mutação sem slots é recusada (nunca infere 1×2 / 3×4)", () => {
  const s = withQuartas();
  throwsCode(() => applyAdminMutation(s, { type: "register-bracket-topology", phaseId: "semifinal" }),
    "TOPOLOGY_REQUIRED", "derivou topologia sozinha");
});

test("5. topologia malformada -> REJEITADA (nunca 'consertada')", () => {
  const s = withQuartas();
  const [a, b, c, d] = qfIds(s);
  const bad = [
    null, 42, [], "sf-1",
    { "sf-1": { sideA: { winnerOf: a } } },                                     // lado faltando
    { "sf-1": { sideA: {}, sideB: { winnerOf: b } } },                          // winnerOf vazio
    { "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: b } },
      "sf-2": { sideA: { winnerOf: c }, sideB: { winnerOf: 7 } } },             // winnerOf não-string
  ];
  for (const slots of bad) {
    let threw = false;
    try { registerTopology(s, "semifinal", slots); } catch (e) { threw = /^TOPOLOGY_/.test(e.code || ""); }
    assert(threw, `aceitou topologia malformada: ${JSON.stringify(slots)}`);
  }
  eq(d.length > 0, true, "fixture inválida");
});

test("6. predecessor desconhecido -> REJEITADO", () => {
  const s = withQuartas();
  const [a] = qfIds(s);
  throwsCode(() => registerTopology(s, "semifinal", {
    "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: "qf-inexistente" } },
    "sf-2": { sideA: { winnerOf: qfIds(s)[1] }, sideB: { winnerOf: qfIds(s)[2] } } }),
    "TOPOLOGY_UNKNOWN_TIE", "aceitou predecessor inexistente");
});

test("7. predecessor DUPLICADO -> REJEITADO (duas vagas esperando o mesmo vencedor)", () => {
  const s = withQuartas();
  const [a, b, c] = qfIds(s);
  throwsCode(() => registerTopology(s, "semifinal", {
    "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: b } },
    "sf-2": { sideA: { winnerOf: a }, sideB: { winnerOf: c } } }),
    "TOPOLOGY_DUPLICATE_PREDECESSOR", "aceitou predecessor duplicado entre vagas");
  throwsCode(() => registerTopology(s, "semifinal", {
    "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: a } },
    "sf-2": { sideA: { winnerOf: b }, sideB: { winnerOf: c } } }),
    "TOPOLOGY_DUPLICATE_PREDECESSOR", "aceitou o mesmo predecessor nos dois lados da mesma vaga");
});

test("8. dependência circular / auto-referência -> REJEITADA", () => {
  const s = withQuartas();
  const ids = qfIds(s);
  // Auto-referência direta: a vaga depende de si mesma.
  throwsCode(() => validateTopology({ "sf-1": { sideA: { winnerOf: "sf-1" }, sideB: { winnerOf: ids[0] } } },
    { predecessorTieIds: [...ids, "sf-1"], expectedSlots: 1 }), "TOPOLOGY_CIRCULAR",
    "aceitou vaga que depende de si mesma");
  // Ciclo indireto entre fases: a final aponta para a semifinal e a semifinal para a final. Como o
  // predecessor de cada fase é fixo (DERIVED_PHASES), o ciclo cai como fase errada/desconhecida —
  // o ponto é que NUNCA é aceito.
  let threw = false;
  try {
    registerTopology(s, "semifinal", { "sf-1": { sideA: { winnerOf: "final-1" }, sideB: { winnerOf: ids[0] } },
                                       "sf-2": { sideA: { winnerOf: ids[1] }, sideB: { winnerOf: ids[2] } } });
  } catch (e) { threw = /^TOPOLOGY_/.test(e.code || ""); }
  assert(threw, "aceitou ciclo entre fases");
});

test("9. predecessor da FASE ERRADA -> REJEITADO com código próprio", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  s = lockTie(s, "quartas", ids[0], "A");
  s = lockTie(s, "quartas", ids[3], "B");
  s = lockTie(s, "quartas", ids[1], "A");
  s = lockTie(s, "quartas", ids[2], "B");
  s = materializeSlot(s, "semifinal", "sf-1");
  s = materializeSlot(s, "semifinal", "sf-2");
  // A final deriva da SEMIFINAL. Apontá-la para um confronto das QUARTAS é dependência na fase
  // errada — existe, mas não é predecessor legítimo desta fase.
  throwsCode(() => registerTopology(s, "final", {
    "final-1": { sideA: { winnerOf: ids[0] }, sideB: { winnerOf: "sf-1" } } }),
    "TOPOLOGY_WRONG_PHASE", "aceitou predecessor de outra fase");
});

test("10. topologia INCOMPLETA -> REJEITADA (completude exigida no registro)", () => {
  const s = withQuartas();
  const [a, b] = qfIds(s);
  throwsCode(() => registerTopology(s, "semifinal", { "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: b } } }),
    "TOPOLOGY_SLOT_COUNT", "aceitou topologia parcial (1 de 2 vagas)");
});

test("11. re-registro IDÊNTICO -> no-op idempotente (mesmo fingerprint)", () => {
  const s0 = withQuartas();
  const s1 = registerTopology(s0, "semifinal", sfTopology(s0));
  const fp = s1.phases.semifinal.topology.provenance.topologyFingerprint;
  const s2 = registerTopology(s1, "semifinal", sfTopology(s1));
  eq(s2.phases.semifinal.topology.provenance.topologyFingerprint, fp, "fingerprint mudou no re-registro idêntico");
  eq(JSON.stringify(s2.phases.semifinal.topology.slots), JSON.stringify(s1.phases.semifinal.topology.slots),
     "vagas mudaram no re-registro idêntico");
  // Mesma topologia em ORDEM diferente também é a mesma topologia.
  const [a, b, c, d] = qfIds(s1);
  const reordered = { "sf-2": { sideA: { winnerOf: b }, sideB: { winnerOf: c } },
                      "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: d } } };
  eq(topologyReregisterDecision(s1.phases.semifinal, validateTopology(reordered,
      { predecessorTieIds: qfIds(s1), expectedSlots: 2 })).action, "noop", "ordem mudou a identidade da topologia");
});

test("12. topologia travada + registro DIFERENTE -> REJEITADO", () => {
  const s0 = withQuartas();
  const s1 = registerTopology(s0, "semifinal", sfTopology(s0));
  const [a, b, c, d] = qfIds(s1);
  const different = { "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: b } },
                      "sf-2": { sideA: { winnerOf: c }, sideB: { winnerOf: d } } };
  throwsCode(() => registerTopology(s1, "semifinal", different), "TOPOLOGY_LOCKED_DIFFERENT",
    "sobrescreveu topologia oficial em silêncio");
  for (const bad of [{ reason: "x" }, { authorizedBy: "y" }, {}]) {
    throwsCode(() => registerTopology(s1, "semifinal", different, { correction: bad }),
      "TOPOLOGY_LOCKED_DIFFERENT", `aceitou correção incompleta: ${JSON.stringify(bad)}`);
  }
});

test("13. correção autorizada -> permitida E registrada na proveniência", () => {
  const s0 = withQuartas();
  const s1 = registerTopology(s0, "semifinal", sfTopology(s0));
  const oldFp = s1.phases.semifinal.topology.provenance.topologyFingerprint;
  const [a, b, c, d] = qfIds(s1);
  const different = { "sf-1": { sideA: { winnerOf: a }, sideB: { winnerOf: b } },
                      "sf-2": { sideA: { winnerOf: c }, sideB: { winnerOf: d } } };
  const s2 = registerTopology(s1, "semifinal", different,
    { correction: { reason: "CBF republicou o chaveamento corrigido", authorizedBy: "Eduardo" } });
  const prov = s2.phases.semifinal.topology.provenance;
  assert(prov.correction, "correção não registrada");
  eq(prov.correction.previousTopologyFingerprint, oldFp, "fingerprint anterior não registrado");
  eq(prov.correction.authorizedBy, "Eduardo", "autorizador não registrado");
  assert(prov.topologyFingerprint !== oldFp, "a topologia não mudou na correção");
});

test("14. fase NÃO derivada (quartas) -> registro de topologia recusado", () => {
  const s = withQuartas();
  throwsCode(() => registerTopology(s, "quartas", sfTopology(s)), "TOPOLOGY_PHASE_NOT_DERIVED",
    "aceitou topologia numa fase que tem sorteio próprio");
  throwsCode(() => registerTopology(s, "oitavas", sfTopology(s)), "TOPOLOGY_PHASE_NOT_DERIVED",
    "aceitou topologia nas oitavas");
});

test("15. proveniência inválida (não-CBF) -> topologia NÃO é reconhecida", () => {
  const s0 = withQuartas();
  const s = clone(registerTopology(s0, "semifinal", sfTopology(s0)));
  s.phases.semifinal.topology.provenance.authority = "ESPN";
  const view = derivedPhaseView(s, "semifinal");
  eq(view.topologyKnown, false, "autoridade não-CBF foi aceita");
  eq(view.slots.length, 0, "fabricou vaga com proveniência inválida");
});

// ═══ 2. RESOLUÇÃO DE PARTICIPANTE ════════════════════════════════════════════

test("16. topologia registrada, NENHUM resultado de quartas -> zero vaga resolvida", () => {
  const s0 = withQuartas();
  const s = registerTopology(s0, "semifinal", sfTopology(s0));
  const view = derivedPhaseView(s, "semifinal");
  eq(view.slots.length, 2, "número de vagas errado");
  eq(view.slots.every(x => !x.sideA.resolved && !x.sideB.resolved), true, "resolveu vaga sem resultado");
  eq(view.slots.some(x => x.bothResolved), false, "vaga completa sem resultado nenhum");
});

test("17. UM resultado de quartas -> exatamente UM lado resolvido", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  s = lockTie(s, "quartas", ids[0], "A");
  const view = derivedPhaseView(s, "semifinal");
  const resolved = view.slots.flatMap(x => [x.sideA, x.sideB]).filter(x => x.resolved);
  eq(resolved.length, 1, "número de lados resolvidos errado");
  eq(resolved[0].team, s.phases.quartas.ties[ids[0]].teamA, "resolveu o time errado");
  eq(view.slots.some(x => x.bothResolved), false, "vaga completa com um só resultado");
});

test("18. VÁRIOS resultados de quartas -> UM lado de cada semifinal resolvido", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  s = lockTie(s, "quartas", ids[0], "A");   // sf-1.sideA
  s = lockTie(s, "quartas", ids[1], "B");   // sf-2.sideA
  const view = derivedPhaseView(s, "semifinal");
  eq(view.slots.filter(x => x.sideA.resolved && !x.sideB.resolved).length, 2, "resolução parcial errada");
  eq(view.slots.some(x => x.bothResolved), false, "semifinal completa cedo demais");
});

test("19. TODOS os resultados de quartas -> as duas semifinais completas, times corretos", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  ["A", "B", "A", "B"].forEach((side, i) => { s = lockTie(s, "quartas", ids[i], side); });
  const view = derivedPhaseView(s, "semifinal");
  eq(view.slots.every(x => x.bothResolved), true, "nem todas as vagas resolveram");
  const q = s.phases.quartas.ties;
  const sf1 = view.slots.find(x => x.slotId === "sf-1");
  eq(sf1.sideA.team, q[ids[0]].teamA, "sf-1.sideA errado");
  eq(sf1.sideB.team, q[ids[3]].teamB, "sf-1.sideB errado (topologia não respeitada)");
  const sf2 = view.slots.find(x => x.slotId === "sf-2");
  eq(sf2.sideA.team, q[ids[1]].teamB, "sf-2.sideA errado");
  eq(sf2.sideB.team, q[ids[2]].teamA, "sf-2.sideB errado");
});

test("20. resultado INCOMPLETO (placar sem classificado) NÃO resolve a vaga", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  // Placar lançado, mas o confronto NÃO foi travado: placar não é qualificação.
  s = applyAdminMutation(s, { type: "save-leg", phaseId: "quartas", tieId: ids[0], leg: "first",
    match: { goalsHome: 3, goalsAway: 0, status: "FINAL" } });
  eq(resolveParticipant(s, { winnerOf: ids[0] }).resolved, false, "placar sozinho resolveu a vaga");
  eq(derivedPhaseView(s, "semifinal").slots.some(x => x.sideA.resolved || x.sideB.resolved), false,
     "vaga resolvida sem classificado");
});

test("21. jogo ADIADO não resolve nem fabrica vencedor", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  s = applyAdminMutation(s, { type: "save-leg", phaseId: "quartas", tieId: ids[0], leg: "first",
    match: { goalsHome: null, goalsAway: null, status: "POSTPONED" } });
  eq(tieQualifiedTeam(s, ids[0]), null, "confronto adiado produziu classificado");
  eq(participantLabel(resolveParticipant(s, { winnerOf: ids[0] })).startsWith(DICT.winnerOfPrefix), true,
     "vaga de confronto adiado não mostra dependência");
});

test("22. classificação por PÊNALTIS resolve normalmente (qualificação ≠ placar)", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  // Agregado empatado; quem avança é decidido nos pênaltis e gravado em qualifiedTeamId.
  s = applyAdminMutation(s, { type: "save-leg", phaseId: "quartas", tieId: ids[0], leg: "first",
    match: { goalsHome: 1, goalsAway: 1, status: "FINAL" } });
  s = lockTie(s, "quartas", ids[0], "B");
  eq(tieQualifiedTeam(s, ids[0]), s.phases.quartas.ties[ids[0]].teamB, "pênaltis não respeitados");
  eq(derivedPhaseView(s, "semifinal").slots.find(x => x.slotId === "sf-1").sideA.team,
     s.phases.quartas.ties[ids[0]].teamB, "vaga não seguiu a qualificação por pênaltis");
});

test("23. correção AUTORIZADA de resultado propaga sozinha (identidade derivada, nunca copiada)", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  s = lockTie(s, "quartas", ids[0], "A");
  const before = derivedPhaseView(s, "semifinal").slots.find(x => x.slotId === "sf-1").sideA.team;
  eq(before, s.phases.quartas.ties[ids[0]].teamA, "resolução inicial errada");
  // Correção do resultado da QF: destrava e regrava o outro classificado.
  s = applyAdminMutation(s, { type: "unlock-tie", phaseId: "quartas", tieId: ids[0] });
  s = lockTie(s, "quartas", ids[0], "B");
  const after = derivedPhaseView(s, "semifinal").slots.find(x => x.slotId === "sf-1").sideA.team;
  eq(after, s.phases.quartas.ties[ids[0]].teamB, "a correção não propagou para a semifinal");
  assert(after !== before, "identidade a jusante ficou velha");
  // E NADA de identidade duplicada guardada na fase derivada.
  assert(!JSON.stringify(s.phases.semifinal.topology).includes(before),
    "nome de time copiado para dentro da topologia");
});

test("24. correção de QUALIFICAÇÃO propaga por toda a cadeia até a final", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  ["A", "B", "A", "B"].forEach((side, i) => { s = lockTie(s, "quartas", ids[i], side); });
  s = materializeSlot(s, "semifinal", "sf-1");
  s = materializeSlot(s, "semifinal", "sf-2");
  s = registerTopology(s, "final", { "final-1": { sideA: { winnerOf: "sf-1" }, sideB: { winnerOf: "sf-2" } } });
  s = lockTie(s, "semifinal", "sf-1", "A");
  s = lockTie(s, "semifinal", "sf-2", "A");
  const finalBefore = derivedPhaseView(s, "final").slots[0];
  eq(finalBefore.bothResolved, true, "final não resolveu com as duas semifinais decididas");
  const wasA = finalBefore.sideA.team;
  s = applyAdminMutation(s, { type: "unlock-tie", phaseId: "semifinal", tieId: "sf-1" });
  s = lockTie(s, "semifinal", "sf-1", "B");
  const finalAfter = derivedPhaseView(s, "final").slots[0];
  assert(finalAfter.sideA.team !== wasA, "correção na semifinal não propagou para a final");
  eq(finalAfter.sideA.team, s.phases.semifinal.ties["sf-1"].teamB, "finalista errado após correção");
});

test("25. cadeia completa QF → SF → Final, sem nenhuma identidade fabricada", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  const ids = qfIds(s);
  ["A", "B", "A", "B"].forEach((side, i) => { s = lockTie(s, "quartas", ids[i], side); });
  s = materializeSlot(s, "semifinal", "sf-1");
  s = materializeSlot(s, "semifinal", "sf-2");
  s = registerTopology(s, "final", { "final-1": { sideA: { winnerOf: "sf-1" }, sideB: { winnerOf: "sf-2" } } });
  eq(derivedPhaseView(s, "final").slots[0].bothResolved, false, "final resolveu antes das semifinais");
  s = lockTie(s, "semifinal", "sf-1", "A");
  eq(derivedPhaseView(s, "final").slots[0].bothResolved, false, "final resolveu com uma semifinal só");
  s = lockTie(s, "semifinal", "sf-2", "B");
  const fin = derivedPhaseView(s, "final").slots[0];
  eq(fin.bothResolved, true, "final não resolveu com as duas semifinais decididas");
  s = materializeSlot(s, "final", "final-1");
  s = lockTie(s, "final", "final-1", "A");
  eq(tieQualifiedTeam(s, "final-1"), s.phases.final.ties["final-1"].teamA, "campeão não derivado");
  // Todo clube que apareceu em qualquer fase é um dos 8 classificados — nada inventado.
  const seen = new Set();
  for (const ph of ["quartas", "semifinal", "final"]) {
    for (const tie of Object.values(s.phases[ph].ties)) { seen.add(tie.teamA); seen.add(tie.teamB); }
  }
  for (const tm of seen) assert(Q8.includes(tm), `time fabricado apareceu no bracket: ${tm}`);
});

// ═══ 3. PERSISTÊNCIA: save → remoto → merge → reload ═════════════════════════

test("26. reload (serializa/desserializa) preserva topologia e resolução", () => {
  const s0 = withQuartas();
  let s = registerTopology(s0, "semifinal", sfTopology(s0));
  s = lockTie(s, "quartas", qfIds(s)[0], "A");
  const reloaded = clone(s);
  eq(JSON.stringify(derivedPhaseView(reloaded, "semifinal")), JSON.stringify(derivedPhaseView(s, "semifinal")),
     "a visão derivada mudou depois do reload");
});

test("27. mergeStates (load remoto-autoritativo E save) preserva a topologia", () => {
  const s0 = withQuartas();
  const withTopo = registerTopology(s0, "semifinal", sfTopology(s0));
  const fp = withTopo.phases.semifinal.topology.provenance.topologyFingerprint;
  // (a) load: remoto tem a topologia, local (cache velho) não.
  const loaded = mergeStates(baseState(), withTopo, { preferRemoteResults: true, remoteAuthoritative: true });
  eq(loaded.phases.semifinal.topology?.provenance?.topologyFingerprint, fp, "load descartou a topologia");
  // (b) save: local acabou de registrar, remoto ainda não conhece.
  const saved = mergeStates(withTopo, baseState(), {});
  eq(saved.phases.semifinal.topology?.provenance?.topologyFingerprint, fp, "save descartou a topologia");
  // (c) contrato estrutural: o objeto de fase é montado por SPREAD, não campo a campo — é o que
  // impede a classe de regressão que já matou espnSync, cutoffOffsetMs e officialDraw.
  assert(/\{\s*\.\.\.carried/.test(extractFn("mergeStates")), "mergeStates voltou a enumerar campos de fase");
});

test("28. mutação administrativa sobre o remoto preserva topologia E officialDraw", () => {
  const s0 = withQuartas();
  const remote = registerTopology(s0, "semifinal", sfTopology(s0));
  const fp = remote.phases.semifinal.topology.provenance.topologyFingerprint;
  const bracketHash = remote.phases.quartas.officialDraw.bracketHash;
  // Mutação NÃO relacionada, em outra fase: não pode apagar proveniência nenhuma.
  const out = applyMutationOverRemote(baseState(), remote, { type: "set-payment", entryId: "e1", value: false });
  eq(out.phases.semifinal.topology?.provenance?.topologyFingerprint, fp, "mutação apagou a topologia");
  eq(out.phases.quartas.officialDraw?.bracketHash, bracketHash, "mutação apagou o officialDraw");
  assert(/\{\s*\.\.\.remoteP/.test(extractFn("applyMutationOverRemote")),
    "applyMutationOverRemote voltou a enumerar campos de fase");
});

test("29. ciclo completo save → remoto → merge → reload → resolução idêntica", () => {
  const s0 = withQuartas();
  let local = registerTopology(s0, "semifinal", sfTopology(s0));
  local = lockTie(local, "quartas", qfIds(local)[0], "A");
  const remote = clone(mergeStates(local, baseState(), {}));          // "gravado" no Supabase
  const reloaded = mergeStates(baseState(), remote, { preferRemoteResults: true, remoteAuthoritative: true });
  const roundTripped = clone(reloaded);
  eq(JSON.stringify(derivedPhaseView(roundTripped, "semifinal")),
     JSON.stringify(derivedPhaseView(local, "semifinal")), "a resolução mudou no ciclo completo");
});

// ═══ 4. RENDERIZAÇÃO HONESTA ═════════════════════════════════════════════════

test("30. vaga não resolvida mostra a DEPENDÊNCIA, nunca um clube", () => {
  const s0 = withQuartas();
  const s = registerTopology(s0, "semifinal", sfTopology(s0));
  const slot = derivedPhaseView(s, "semifinal").slots[0];
  const label = participantLabel(slot.sideA, tieDisplayName(s, slot.sideA.winnerOf));
  assert(label.startsWith(DICT.winnerOfPrefix), `rótulo não mostra a dependência: ${label}`);
  const tie = s.phases.quartas.ties[slot.sideA.winnerOf];
  assert(label.includes(tie.teamA) && label.includes(tie.teamB), "rótulo não nomeia o confronto de origem");
  eq(participantLabel({ resolved: false, winnerOf: null }), DICT.toBeDefined, "rótulo sem dependência errado");
});

test("31. NENHUMA chave crua de tradução vaza (as duas chaves existem de verdade)", () => {
  for (const k of ["winnerOfPrefix", "toBeDefined", "topologyUnpublished"]) {
    assert(Object.prototype.hasOwnProperty.call(DICT, k), `chave i18n ausente: ${k}`);
    assert(DICT[k] && DICT[k] !== k, `chave i18n vazia/idêntica ao nome: ${k}`);
  }
  const s0 = withQuartas();
  const s = registerTopology(s0, "semifinal", sfTopology(s0));
  for (const slot of derivedPhaseView(s, "semifinal").slots) {
    for (const side of [slot.sideA, slot.sideB]) {
      const label = participantLabel(side, tieDisplayName(s, side.winnerOf));
      assert(!/^[a-z][A-Za-z]+$/.test(label), `rótulo parece uma chave crua: ${label}`);
    }
  }
});

test("32. sem topologia a UI NÃO fabrica card de confronto futuro", () => {
  const s = withQuartas();
  const view = derivedPhaseView(s, "semifinal");
  eq(view.topologyKnown, false, "topologia inventada");
  eq(view.slots.length, 0, "vaga fabricada sem topologia");
  // O caminho de render exige topologyKnown antes de desenhar qualquer vaga.
  const games = extractFn("renderGamesSection");
  assert(/derivedPhaseView\(/.test(games), "renderGamesSection não consulta a visão derivada");
  assert(/topologyKnown/.test(games), "renderGamesSection desenha vaga sem checar topologyKnown");
});

// ═══ 5. NÃO-REGRESSÃO: dinheiro, entradas, palpites, pontuação ═══════════════

test("33. topologia e progressão NÃO alteram entradas, palpites, pagamento nem oitavas", () => {
  const before = withQuartas();
  const entriesBefore = JSON.stringify(before.entries);
  const paidBefore = JSON.stringify(before.paid);
  const oitavasBefore = JSON.stringify(before.phases.oitavas);
  let s = registerTopology(before, "semifinal", sfTopology(before));
  const ids = qfIds(s);
  ["A", "B", "A", "B"].forEach((side, i) => { s = lockTie(s, "quartas", ids[i], side); });
  s = materializeSlot(s, "semifinal", "sf-1");
  eq(JSON.stringify(s.entries), entriesBefore, "entradas alteradas");
  eq(JSON.stringify(s.paid), paidBefore, "pagamentos alterados");
  eq(JSON.stringify(s.phases.oitavas), oitavasBefore, "oitavas alteradas");
});

test("34. NENHUM caminho de falha deixa estado parcial ou fabrica confronto", () => {
  const s = withQuartas();
  const snapshot = JSON.stringify(s);
  const bad = [
    { phaseId: "semifinal" },                                                    // sem slots
    { phaseId: "semifinal", slots: { "sf-1": { sideA: { winnerOf: "nope" }, sideB: { winnerOf: "nope2" } },
                                     "sf-2": { sideA: { winnerOf: qfIds(s)[0] }, sideB: { winnerOf: qfIds(s)[1] } } } },
    { phaseId: "quartas", slots: sfTopology(s) },
    { phaseId: "semifinal", slots: { "sf-1": { sideA: { winnerOf: qfIds(s)[0] }, sideB: { winnerOf: qfIds(s)[1] } } } },
  ];
  for (const m of bad) {
    try { applyAdminMutation(s, { type: "register-bracket-topology", ...m }); } catch { /* esperado */ }
    eq(JSON.stringify(s), snapshot, `estado mutado por uma mutação recusada: ${JSON.stringify(m)}`);
    eq(Object.keys(s.phases.semifinal.ties).length, 0, "falha fabricou confronto de semifinal");
  }
});

test("35. CONTRATO: o motor NUNCA infere convenção de chaveamento", () => {
  const mut = src.slice(src.indexOf('case "register-bracket-topology"'),
                        src.indexOf('case "set-cutoff"'));
  assert(/TOPOLOGY_REQUIRED/.test(mut), "a mutação não exige topologia explícita");
  assert(!/Math\.random/.test(src), "Math.random apareceu no app");
  assert(!/qf-1.*qf-2|slice\(\s*0\s*,\s*2\s*\)/.test(mut), "a mutação parece emparelhar confrontos sozinha");
  // A resolução lê SEMPRE a qualificação canônica, nunca um nome guardado.
  const rp = extractFn("resolveParticipant");
  assert(/tieQualifiedTeam\(/.test(rp), "resolveParticipant não deriva do estado canônico");
  assert(!/teamA|teamB/.test(rp), "resolveParticipant lê time diretamente (identidade copiada)");
});

test("36. produção HOJE: sem sorteio e sem topologia, tudo permanece vazio e honesto", () => {
  const s = baseState();                                        // espelha o estado real de produção
  eq(Object.keys(s.phases.quartas.ties).length, 0, "quartas não estão vazias");
  eq(Object.keys(s.phases.semifinal.ties).length, 0, "semifinal não está vazia");
  eq(Object.keys(s.phases.final.ties).length, 0, "final não está vazia");
  for (const phaseId of Object.keys(DERIVED_PHASES)) {
    const view = derivedPhaseView(s, phaseId);
    eq(view.topologyKnown, false, `${phaseId}: topologia inventada`);
    eq(view.slots.length, 0, `${phaseId}: vaga fabricada`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ BRACKET PROGRESSION SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
