#!/usr/bin/env node
/**
 * CDB2026 — Batch 2: ciclo de vida EXPLÍCITO do sorteio das quartas + proveniência oficial.
 *
 * Antes disto o "estado" do sorteio existia só implicitamente, espalhado em condições de UI
 * (`ties` vazio? `cutoffAt` nulo? o countdown apareceu?). Não dava para testar, e duas telas podiam
 * discordar sobre em que ponto do torneio estamos. Agora há uma derivação única e pura
 * (`drawLifecycle`) que a UI consome e nunca decide.
 *
 * Já vivo e NÃO reaberto aqui: sanitizador de fantasma, load remoto autoritativo, invariante de
 * quartas vazias, `add-tie` fail-closed. Esta suíte cobre o que o Batch 2 acrescenta.
 *
 * A Copa do Brasil tem UM sorteio a partir das quartas. Semifinal e final NÃO têm sorteio.
 *
 * Uso: node bolao/cdb2026/scripts/audit_draw_provenance.mjs
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
function extractDecl(re, label) {
  const m = src.match(re);
  if (!m) throw new Error(`${label} não encontrado`);
  return m[0];
}

const sandbox = new Function(`
  const DATA = { phases: [{ id: "oitavas" }, { id: "quartas" }, { id: "semifinal" }, { id: "final" }] };
  const C = { entryRosterFrozen: true, siteVersion: "test" };
  function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
  ${extractDecl(/const DRAW_LIFECYCLE = Object\.freeze\(\{[\s\S]*?\}\);/, "DRAW_LIFECYCLE")}
  ${extractDecl(/const OFFICIAL_DRAW_REQUIRED_FIELDS = \[[^\]]*\];/, "OFFICIAL_DRAW_REQUIRED_FIELDS")}
  ${extractDecl(/const DRAW_GATED_PHASES = new Set\(\[[^\]]*\]\);/, "DRAW_GATED_PHASES")}
  ${extractFn("hashString")}
  ${extractFn("bracketFingerprint")}
  ${extractFn("officialDrawProvenanceIsValid")}
  ${extractFn("drawLifecycle")}
  ${extractFn("drawBracketIsLocked")}
  ${extractFn("phaseDrawIsOfficial")}
  ${extractFn("enforceDrawLifecycle")}
  ${extractFn("applyAdminMutation")}
  return { DRAW_LIFECYCLE, drawLifecycle, drawBracketIsLocked, officialDrawProvenanceIsValid,
           bracketFingerprint, phaseDrawIsOfficial, enforceDrawLifecycle, applyAdminMutation };
`)();
const { DRAW_LIFECYCLE: LC, drawLifecycle, drawBracketIsLocked, officialDrawProvenanceIsValid,
        bracketFingerprint, phaseDrawIsOfficial, enforceDrawLifecycle, applyAdminMutation } = sandbox;

const NOW = Date.parse("2026-08-10T12:00:00Z");
const REAL_TIES = {
  "qf-1": { teamA: "Santos", teamB: "Grêmio" },
  "qf-2": { teamA: "Palmeiras", teamB: "Vasco" },
};

function baseState(quartas = {}) {
  return JSON.parse(JSON.stringify({
    entries: [{ id: "e1", entryName: "Participante Real", picks: { matches: {}, qualified: {} } }],
    deletedIds: [], paid: { e1: true }, auditLog: [],
    espnSync: { activePhaseId: "oitavas" },
    phases: {
      oitavas: { cutoffAt: "2026-08-01T20:30:00.000Z", ties: { t1: { teamA: "Santos", teamB: "Remo", qualifiedTeamId: "A" } } },
      quartas: { cutoffAt: null, ties: {}, ...quartas },
      semifinal: { cutoffAt: null, ties: {} },
      final: { cutoffAt: null, ties: {} },
    },
    meta: { updatedAt: "2026-08-07T00:00:00Z" },
  }));
}
const validProvenance = (over = {}) => ({
  authority: "CBF", source: "cbf-publication", sourceUrl: "https://www.cbf.com.br/…",
  scheduledAt: "2026-08-09T18:00:00Z", publishedAt: "2026-08-09T19:00:00Z",
  ingestedAt: "2026-08-09T19:30:00Z", validatedAt: "2026-08-09T19:35:00Z",
  validatedBy: "admin", bracketHash: bracketFingerprint(REAL_TIES), ...over,
});

console.log("\nCDB2026 — Batch 2: ciclo de vida e proveniência do sorteio\n");

// ── 1. sem sorteio agendado ─────────────────────────────────────────────────
test("1 sem sorteio agendado -> WAITING_FOR_QUARTERFINAL_DRAW", () => {
  const lc = drawLifecycle(baseState(), "quartas", NOW);
  eq(lc.state, LC.WAITING, "estado errado");
  eq(lc.countdownMs, null, "não deveria haver countdown");
  eq(drawBracketIsLocked(baseState(), "quartas", NOW), false, "bracket não pode estar travado");
});

// ── 2. agendado no futuro ───────────────────────────────────────────────────
test("2 sorteio agendado no futuro -> SCHEDULED com countdown positivo", () => {
  const s = baseState({ officialDraw: { authority: "CBF", source: "cbf-publication",
    scheduledAt: new Date(NOW + 3 * 86400000).toISOString() } });
  const lc = drawLifecycle(s, "quartas", NOW);
  eq(lc.state, LC.SCHEDULED, "estado errado");
  assert(lc.countdownMs > 0, `countdown deveria ser positivo, veio ${lc.countdownMs}`);
  eq(lc.ties, 0, "agendar não pode criar confronto");
});

// ── 3. countdown expirou sem publicação ─────────────────────────────────────
test("3 data passou sem publicação -> AWAITING_PUBLICATION (nem WAITING, nem oficial)", () => {
  const s = baseState({ officialDraw: { authority: "CBF", source: "cbf-publication",
    scheduledAt: new Date(NOW - 3600000).toISOString() } });
  const lc = drawLifecycle(s, "quartas", NOW);
  eq(lc.state, LC.AWAITING_PUBLICATION, "estado errado");
  eq(lc.countdownMs, 0, "countdown deveria estar zerado");
  eq(drawBracketIsLocked(s, "quartas", NOW), false, "bracket travado sem publicação");
});

// ── 4. proveniência malformada ──────────────────────────────────────────────
test("4 proveniência malformada NUNCA destrava o bracket (fail closed)", () => {
  const bad = [
    { ...validProvenance(), authority: "ESPN" },        // autoridade errada
    { ...validProvenance(), validatedAt: undefined },   // sem validação
    { ...validProvenance(), ingestedAt: undefined },
    { ...validProvenance(), scheduledAt: "não-é-data" },
    { ...validProvenance(), validatedAt: "lixo" },
    {}, null, "string", 42,
  ];
  for (const od of bad) {
    eq(officialDrawProvenanceIsValid(od), false, `aceitou proveniência inválida: ${JSON.stringify(od)}`);
    const s = baseState({ ties: { ...REAL_TIES }, officialDraw: od });
    eq(drawBracketIsLocked(s, "quartas", NOW), false, `travou com proveniência inválida: ${JSON.stringify(od)}`);
  }
});

// ── 5. ingerido mas não validado ────────────────────────────────────────────
test("5 ingerido sem validação -> INGESTED, explícito e não oficial", () => {
  const s = baseState({ ties: { ...REAL_TIES }, officialDraw: {
    authority: "CBF", source: "cbf-publication", scheduledAt: "2026-08-09T18:00:00Z",
    ingestedAt: "2026-08-09T19:30:00Z" } });   // sem validatedAt
  const lc = drawLifecycle(s, "quartas", NOW);
  eq(lc.state, LC.INGESTED, "estado errado");
  eq(drawBracketIsLocked(s, "quartas", NOW), false, "não pode estar travado sem validação");
});

// ── 6. validado ─────────────────────────────────────────────────────────────
test("6 proveniência validada -> QUARTERFINAL_BRACKET_LOCKED", () => {
  const s = baseState({ ties: { ...REAL_TIES }, officialDraw: validProvenance() });
  const lc = drawLifecycle(s, "quartas", NOW);
  eq(lc.state, LC.LOCKED, "estado errado");
  eq(lc.ties, 2, "confrontos oficiais não contabilizados");
  eq(drawBracketIsLocked(s, "quartas", NOW), true, "bracket deveria estar travado");
});

// ── 7. registro manual ──────────────────────────────────────────────────────
test("7 registro manual oficial funciona e produz proveniência completa", () => {
  const s = baseState();
  const out = applyAdminMutation(s, { type: "register-official-draw", phaseId: "quartas",
    ties: REAL_TIES, source: "manual-admin", sourceUrl: "https://www.cbf.com.br/…",
    scheduledAt: "2026-08-09T18:00:00Z", validatedBy: "admin" });
  const od = out.phases.quartas.officialDraw;
  assert(officialDrawProvenanceIsValid(od), "proveniência gerada é inválida");
  eq(od.authority, "CBF", "autoridade errada");
  eq(Object.keys(out.phases.quartas.ties).length, 2, "confrontos não registrados");
  eq(drawBracketIsLocked(out, "quartas", NOW), true, "não travou após registro manual");
  eq(od.bracketHash, bracketFingerprint(REAL_TIES), "bracketHash não corresponde ao bracket");
});

test("7b registro oficial REJEITA bracket vazio ou confronto incompleto", () => {
  for (const ties of [null, {}, { "qf-1": { teamA: "Santos" } }, { "qf-1": {} }]) {
    let threw = false;
    try { applyAdminMutation(baseState(), { type: "register-official-draw", phaseId: "quartas", ties }); }
    catch { threw = true; }
    assert(threw, `aceitou bracket inválido: ${JSON.stringify(ties)}`);
  }
});

test("7c agendar o sorteio NÃO cria confronto nem torna oficial", () => {
  const out = applyAdminMutation(baseState(), { type: "set-draw-schedule", phaseId: "quartas",
    scheduledAt: new Date(NOW + 86400000).toISOString(), sourceUrl: "https://www.cbf.com.br/…" });
  eq(Object.keys(out.phases.quartas.ties).length, 0, "agendar fabricou confronto");
  eq(drawLifecycle(out, "quartas", NOW).state, LC.SCHEDULED, "não entrou em SCHEDULED");
  eq(drawBracketIsLocked(out, "quartas", NOW), false, "agendar travou o bracket");
});

// ── 8/9. reload e merge (derivação é pura, então basta round-trip do estado) ─
test("8 reload: a derivação sobrevive a round-trip JSON (é pura, sem estado oculto)", () => {
  const s = baseState({ ties: { ...REAL_TIES }, officialDraw: validProvenance() });
  const reloaded = JSON.parse(JSON.stringify(s));
  eq(drawLifecycle(reloaded, "quartas", NOW).state, LC.LOCKED, "estado mudou depois do reload");
});

test("9 merge: proveniência não é perdida por um merge de estado", () => {
  // O merge reconstrói `phases[id]` campo a campo; se `officialDraw` não for carregado adiante, o
  // bracket oficial voltaria a parecer não-oficial no próximo load. Este teste protege isso.
  const s = baseState({ ties: { ...REAL_TIES }, officialDraw: validProvenance() });
  const mergeStatesSrc = extractFn("mergeStates");
  assert(/officialDraw/.test(mergeStatesSrc),
    "mergeStates() não carrega `officialDraw` adiante — a proveniência seria descartada no sync");
  eq(drawLifecycle(s, "quartas", NOW).state, LC.LOCKED, "sanidade");
});

// ── 10. estado local contaminado ────────────────────────────────────────────
test("10 estado contaminado: confronto fantasma sem proveniência não vira bracket oficial", () => {
  const s = baseState({ ties: { phantom: { teamA: "Bahia", teamB: "Santos" } } });
  eq(drawLifecycle(s, "quartas", NOW).state, LC.WAITING, "fantasma virou estado de sorteio");
  eq(drawBracketIsLocked(s, "quartas", NOW), false, "fantasma travou o bracket");
  // E o sanitizador (já vivo) continua limpando.
  eq(enforceDrawLifecycle(s), true, "sanitizador não removeu o fantasma");
  eq(Object.keys(s.phases.quartas.ties).length, 0, "fantasma sobreviveu");
});

// ── 11. compatibilidade com o cutoff ────────────────────────────────────────
test("11 cutoff manual continua permitindo confrontos (não quebra o fluxo do admin)", () => {
  // phaseDrawIsOfficial é PERMISSIVO de propósito (protege cadastro manual); drawBracketIsLocked é
  // ESTRITO (exige proveniência). As duas perguntas são diferentes e ambas precisam continuar certas.
  const s = baseState({ cutoffAt: "2026-08-12T20:00:00.000Z", ties: { ...REAL_TIES } });
  eq(phaseDrawIsOfficial(s.phases.quartas), true, "cutoff deixou de proteger o cadastro manual");
  eq(enforceDrawLifecycle(s), false, "sanitizador apagou confronto de fase com cutoff");
  eq(drawBracketIsLocked(s, "quartas", NOW), false, "cutoff sozinho NÃO deveria travar o bracket");
});

// ── 12. interação com o sanitizador ────────────────────────────────────────
test("12 bracket oficial validado é PRESERVADO pelo sanitizador", () => {
  const s = baseState({ ties: { ...REAL_TIES }, officialDraw: validProvenance() });
  eq(enforceDrawLifecycle(s), false, "sanitizador mexeu num bracket oficial");
  eq(Object.keys(s.phases.quartas.ties).length, 2, "sanitizador apagou o bracket oficial");
});

// ── 13. nenhum confronto fabricado ─────────────────────────────────────────
test("13 nenhum caminho fabrica confronto: só register-official-draw insere ties nas quartas", () => {
  const body = extractFn("applyAdminMutation");
  // Os únicos ramos que podem popular `ties` são add-tie/espn-add-tie (com gate fail-closed) e
  // register-official-draw. Nenhum deriva par de time a partir de classificados.
  assert(/register-official-draw/.test(body), "o caminho oficial de registro desapareceu");
  assert(/QF_DRAW_NOT_OFFICIAL/.test(body), "o gate fail-closed de add-tie desapareceu");
  assert(!/qualified.*=>.*teamA|derive|autoPair|shuffle|random/i.test(body),
    "apareceu no admin algo que parece derivar/sortear confronto");
  // E o próprio arquivo não tem gerador de par aleatório.
  assert(!/Math\.random/.test(src), "Math.random apareceu no app — sorteio não se fabrica");
});

test("semifinal e final continuam FORA do gate de sorteio (resolvem por vencedores)", () => {
  assert(!/"semifinal"/.test(extractDecl(/const DRAW_GATED_PHASES = new Set\(\[[^\]]*\]\);/, "gate")),
    "semifinal entrou no gate de sorteio");
  assert(!/"final"/.test(extractDecl(/const DRAW_GATED_PHASES = new Set\(\[[^\]]*\]\);/, "gate")),
    "final entrou no gate de sorteio");
});

test("a UI consome o estado derivado (não decide sozinha)", () => {
  const cd = extractFn("renderCountdown");
  assert(/drawLifecycle\(/.test(cd), "renderCountdown() não usa o estado derivado");
  assert(/DRAW_LIFECYCLE\./.test(cd), "renderCountdown() compara com string literal em vez do enum");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DRAW PROVENANCE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
