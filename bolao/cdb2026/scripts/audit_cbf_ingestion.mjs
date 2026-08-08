#!/usr/bin/env node
/**
 * CDB2026 — Batch 3: ingestão do sorteio oficial da CBF.
 *
 * CARACTERIZAÇÃO DA FONTE (2026-08-07) — é o que justifica o desenho:
 *   - `cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/2026` responde 200, mas o HTML é casca:
 *     82 KB sem nenhum dado estruturado (zero JSON-LD, zero __NEXT_DATA__), sem nome de time, sem a
 *     palavra "quartas". Conteúdo renderizado no cliente.
 *   - A CBF tem CMS Strapi em `cms.cbf.com.br/api/` que responde (menus, logo), mas NENHUMA coleção
 *     de competição/partida/chave existe: `campeonatos`, `partidas`, `jogos`, `tabelas`,
 *     `confrontos`, `chaves` → todas 404.
 *   - O sorteio das quartas ainda não aconteceu, então não existe exemplar real de resposta para
 *     escrever parser contra.
 *
 * Logo: ingestão CONTROLADA com validação estrita, e não scraping especulativo. `normalizeCbfDraw()`
 * é PURO e não sabe da origem dos pares — é o seam para um fetcher automático futuro reusar a MESMA
 * validação sem mudar o contrato.
 *
 * Uso: node bolao/cdb2026/scripts/audit_cbf_ingestion.mjs
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

const sb = new Function(`
  const DATA = { phases: [{ id: "oitavas" }, { id: "quartas" }, { id: "semifinal" }, { id: "final" }] };
  const C = { entryRosterFrozen: true, siteVersion: "test" };
  function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
  ${decl(/const DRAW_LIFECYCLE = Object\.freeze\(\{[\s\S]*?\}\);/, "DRAW_LIFECYCLE")}
  ${decl(/const OFFICIAL_DRAW_REQUIRED_FIELDS = \[[^\]]*\];/, "REQUIRED")}
  ${decl(/const DRAW_GATED_PHASES = new Set\(\[[^\]]*\]\);/, "GATE")}
  ${extractFn("hashString")}
  ${extractFn("bracketFingerprint")}
  ${extractFn("officialDrawProvenanceIsValid")}
  ${extractFn("drawLifecycle")}
  ${extractFn("drawBracketIsLocked")}
  ${extractFn("phaseDrawIsOfficial")}
  ${extractFn("enforceDrawLifecycle")}
  ${extractFn("qualifiedTeamsForQuartas")}
  ${extractFn("drawIngestError")}
  ${extractFn("normalizeCbfDraw")}
  ${extractFn("officialDrawReingestDecision")}
  ${extractFn("applyAdminMutation")}
  return { normalizeCbfDraw, bracketFingerprint, officialDrawReingestDecision,
           qualifiedTeamsForQuartas, applyAdminMutation, drawBracketIsLocked, drawLifecycle,
           DRAW_LIFECYCLE, enforceDrawLifecycle };
`)();
const { normalizeCbfDraw, bracketFingerprint, officialDrawReingestDecision,
        qualifiedTeamsForQuartas, applyAdminMutation, drawBracketIsLocked,
        drawLifecycle, DRAW_LIFECYCLE: LC, enforceDrawLifecycle } = sb;

const Q8 = ["Santos", "Grêmio", "Palmeiras", "Vasco", "Cruzeiro", "Flamengo", "Corinthians", "Fluminense"];
const OFFICIAL_PAIRS = [["Santos", "Grêmio"], ["Palmeiras", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
const SOURCE_URL = "https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/2026";

function baseState(quartas = {}) {
  return JSON.parse(JSON.stringify({
    entries: [{ id: "e1", entryName: "Participante Real",
                picks: { matches: { "oitavas:o1:first": { home: 1, away: 0 } }, qualified: { o1: "A" } } }],
    deletedIds: [], paid: { e1: true }, auditLog: [],
    espnSync: { activePhaseId: "oitavas" },
    phases: {
      oitavas: { cutoffAt: "2026-08-01T20:30:00.000Z", ties: Object.fromEntries(
        Q8.map((t, i) => [`o${i + 1}`, { teamA: t, teamB: `Eliminado${i + 1}`, qualifiedTeamId: "A" }])) },
      quartas: { cutoffAt: null, ties: {}, ...quartas },
      semifinal: { cutoffAt: null, ties: {} },
      final: { cutoffAt: null, ties: {} },
    },
    meta: { updatedAt: "2026-08-07T00:00:00Z" },
  }));
}
const ingest = (s, over = {}) => applyAdminMutation(s, {
  type: "register-official-draw", phaseId: "quartas", pairs: OFFICIAL_PAIRS, qualified: Q8,
  source: "cbf-publication", sourceUrl: SOURCE_URL, scheduledAt: "2026-08-09T18:00:00Z",
  publishedAt: "2026-08-09T19:00:00Z", validatedBy: "admin", ...over,
});

console.log("\nCDB2026 — Batch 3: ingestão oficial da CBF\n");

// ── classificados vêm do RESULTADO, não de lista digitada ───────────────────
test("os 8 classificados são derivados do resultado das oitavas", () => {
  const q = qualifiedTeamsForQuartas(baseState());
  eq(q.length, 8, "número de classificados errado");
  eq(JSON.stringify([...q].sort()), JSON.stringify([...Q8].sort()), "classificados errados");
});

test("oitavas incompletas -> sem classificados -> ingestão impossível", () => {
  const s = baseState();
  delete s.phases.oitavas.ties.o1.qualifiedTeamId;   // um confronto sem resultado
  eq(qualifiedTeamsForQuartas(s).length, 7, "não deveria haver 8 classificados");
  throwsCode(() => ingest(s, { qualified: undefined }), "QUALIFIED_SET_INVALID",
    "aceitou ingerir com oitavas incompletas");
});

// ── idempotência e determinismo ─────────────────────────────────────────────
test("mesma fonte duas vezes -> idempotente (mesmo bracket, mesmo hash)", () => {
  const a = normalizeCbfDraw({ pairs: OFFICIAL_PAIRS, qualified: Q8 });
  const b = normalizeCbfDraw({ pairs: OFFICIAL_PAIRS, qualified: Q8 });
  eq(JSON.stringify(a), JSON.stringify(b), "normalização não é determinística");
  eq(bracketFingerprint(a), bracketFingerprint(b), "hash divergiu");
});

test("MESMO bracket em formatações diferentes -> MESMO bracketHash", () => {
  // Três formas de entrada + ordem trocada + lados invertidos: a identidade do bracket é o CONJUNTO
  // de confrontos, não a formatação da fonte.
  const asArrays = OFFICIAL_PAIRS;
  const asObjects = OFFICIAL_PAIRS.map(([teamA, teamB]) => ({ teamA, teamB }));
  const asMap = Object.fromEntries(OFFICIAL_PAIRS.map((p, i) => [`x${i}`, { teamA: p[0], teamB: p[1] }]));
  const shuffled = [...OFFICIAL_PAIRS].reverse();
  const flipped = OFFICIAL_PAIRS.map(([a, b]) => [b, a]);
  const hashes = [asArrays, asObjects, asMap, shuffled, flipped]
    .map(pairs => bracketFingerprint(normalizeCbfDraw({ pairs, qualified: Q8 })));
  eq(new Set(hashes).size, 1, `hashes divergiram entre formatações: ${hashes.join(" | ")}`);
});

test("ids de confronto são determinísticos e independentes da ordem da fonte", () => {
  const a = normalizeCbfDraw({ pairs: OFFICIAL_PAIRS, qualified: Q8 });
  const b = normalizeCbfDraw({ pairs: [...OFFICIAL_PAIRS].reverse(), qualified: Q8 });
  eq(JSON.stringify(Object.keys(a)), JSON.stringify(Object.keys(b)), "ids mudaram com a ordem");
  eq(JSON.stringify(a), JSON.stringify(b), "conteúdo mudou com a ordem");
});

// ── rejeições ───────────────────────────────────────────────────────────────
test("sorteio parcial -> REJEITADO", () => {
  throwsCode(() => normalizeCbfDraw({ pairs: OFFICIAL_PAIRS.slice(0, 3), qualified: Q8 }),
    "DRAW_PARTIAL", "aceitou sorteio parcial");
});

test("confrontos extra -> REJEITADO", () => {
  throwsCode(() => normalizeCbfDraw({ pairs: [...OFFICIAL_PAIRS, ["Santos", "Vasco"]], qualified: Q8 }),
    "DRAW_EXTRA_TIES", "aceitou confronto extra");
});

test("clube repetido -> REJEITADO", () => {
  const dup = [["Santos", "Grêmio"], ["Santos", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
  throwsCode(() => normalizeCbfDraw({ pairs: dup, qualified: Q8 }), "TEAM_DUPLICATE", "aceitou clube repetido");
});

test("clube desconhecido (não classificado) -> REJEITADO", () => {
  const unk = [["Santos", "Bahia"], ["Palmeiras", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
  throwsCode(() => normalizeCbfDraw({ pairs: unk, qualified: Q8 }), "TEAM_UNKNOWN", "aceitou clube não classificado");
});

test("confronto incompleto / clube contra si mesmo -> REJEITADO", () => {
  throwsCode(() => normalizeCbfDraw({ pairs: [["Santos", ""], ["Palmeiras", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]], qualified: Q8 }),
    "TIE_INCOMPLETE", "aceitou confronto incompleto");
  throwsCode(() => normalizeCbfDraw({ pairs: [["Santos", "Santos"], ["Palmeiras", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]], qualified: Q8 }),
    "TIE_SELF_PAIR", "aceitou clube contra si mesmo");
});

test("fonte malformada -> REJEITADA (nunca 'consertada')", () => {
  for (const pairs of [null, undefined, 42, "Santos x Grêmio"]) {
    throwsCode(() => normalizeCbfDraw({ pairs, qualified: Q8 }), "SOURCE_MALFORMED",
      `aceitou fonte malformada: ${JSON.stringify(pairs)}`);
  }
});

test("autoridade que não é a CBF -> REJEITADA", () => {
  // A proveniência exige authority === "CBF"; a mutação sempre grava CBF, então o vetor real é um
  // estado montado à mão com outra autoridade — que o ciclo de vida recusa como não-validado.
  const s = baseState({ ties: normalizeCbfDraw({ pairs: OFFICIAL_PAIRS, qualified: Q8 }),
    officialDraw: { authority: "ESPN", source: "espn", scheduledAt: "2026-08-09T18:00:00Z",
      ingestedAt: "2026-08-09T19:00:00Z", validatedAt: "2026-08-09T19:05:00Z" } });
  eq(drawBracketIsLocked(s, "quartas", Date.parse("2026-08-10T12:00:00Z")), false,
    "autoridade não-CBF travou o bracket");
});

// ── fonte indisponível ──────────────────────────────────────────────────────
test("fonte indisponível -> NENHUMA mutação de estado, torneio continua esperando", () => {
  const before = baseState();
  const snapshot = JSON.stringify(before);
  let threw = false;
  try { applyAdminMutation(before, { type: "register-official-draw", phaseId: "quartas",
    pairs: null, qualified: Q8 }); } catch { threw = true; }
  assert(threw, "não recusou fonte indisponível");
  eq(JSON.stringify(before), snapshot, "o estado foi mutado apesar da falha");
  eq(drawLifecycle(before, "quartas", Date.now()).state, LC.WAITING, "saiu do estado de espera");
});

// ── re-ingestão sobre bracket travado ───────────────────────────────────────
test("bracket travado + re-ingestão IDÊNTICA -> no-op seguro", () => {
  const s = ingest(baseState());
  eq(drawBracketIsLocked(s, "quartas", Date.now()), true, "não travou na primeira ingestão");
  const hashBefore = s.phases.quartas.officialDraw.bracketHash;
  const again = ingest(s);                                  // mesma fonte outra vez
  eq(again.phases.quartas.officialDraw.bracketHash, hashBefore, "hash mudou numa re-ingestão idêntica");
  eq(Object.keys(again.phases.quartas.ties).length, 4, "confrontos alterados numa re-ingestão idêntica");
  eq(officialDrawReingestDecision(s.phases.quartas,
      normalizeCbfDraw({ pairs: OFFICIAL_PAIRS, qualified: Q8 })).action, "noop", "decisão errada");
});

test("bracket travado + re-ingestão DIFERENTE -> REJEITADA", () => {
  const s = ingest(baseState());
  const different = [["Santos", "Vasco"], ["Palmeiras", "Grêmio"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
  throwsCode(() => ingest(s, { pairs: different }), "BRACKET_LOCKED_DIFFERENT",
    "sobrescreveu um bracket oficial em silêncio");
});

test("correção controlada e autorizada -> permitida E registrada na proveniência", () => {
  const s = ingest(baseState());
  const oldHash = s.phases.quartas.officialDraw.bracketHash;
  const different = [["Santos", "Vasco"], ["Palmeiras", "Grêmio"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
  const out = ingest(s, { pairs: different,
    correction: { reason: "CBF republicou o sorteio corrigido", authorizedBy: "Eduardo" } });
  const od = out.phases.quartas.officialDraw;
  assert(od.correction, "a correção não foi registrada");
  eq(od.correction.previousBracketHash, oldHash, "hash anterior não registrado");
  eq(od.correction.authorizedBy, "Eduardo", "autorizador não registrado");
  assert(od.bracketHash !== oldHash, "o bracket não mudou na correção");
});

test("correção SEM motivo/autorizador -> REJEITADA", () => {
  const s = ingest(baseState());
  const different = [["Santos", "Vasco"], ["Palmeiras", "Grêmio"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]];
  for (const bad of [{ reason: "x" }, { authorizedBy: "y" }, {}]) {
    throwsCode(() => ingest(s, { pairs: different, correction: bad }), "BRACKET_LOCKED_DIFFERENT",
      `aceitou correção incompleta: ${JSON.stringify(bad)}`);
  }
});

// ── proveniência, estado e efeitos colaterais ───────────────────────────────
test("ingestão produz proveniência completa e leva a BRACKET_LOCKED", () => {
  const s = ingest(baseState());
  const od = s.phases.quartas.officialDraw;
  eq(od.authority, "CBF", "autoridade errada");
  eq(od.sourceUrl, SOURCE_URL, "sourceUrl (evidência) não preservado");
  assert(od.ingestedAt && od.validatedAt, "ingestedAt/validatedAt ausentes");
  eq(od.bracketHash, bracketFingerprint(s.phases.quartas.ties), "bracketHash não corresponde");
  eq(drawLifecycle(s, "quartas", Date.now()).state, LC.LOCKED, "não chegou a BRACKET_LOCKED");
});

test("reload/merge preserva a proveniência", () => {
  const s = ingest(baseState());
  const reloaded = JSON.parse(JSON.stringify(s));
  eq(drawBracketIsLocked(reloaded, "quartas", Date.now()), true, "perdeu a proveniência no reload");
  assert(/officialDraw/.test(extractFn("mergeStates")), "mergeStates não carrega officialDraw adiante");
});

test("a ingestão NÃO altera entradas nem palpites de participante", () => {
  const before = baseState();
  const entriesBefore = JSON.stringify(before.entries);
  const paidBefore = JSON.stringify(before.paid);
  const out = ingest(before);
  eq(JSON.stringify(out.entries), entriesBefore, "entradas foram alteradas pela ingestão");
  eq(JSON.stringify(out.paid), paidBefore, "pagamentos foram alterados pela ingestão");
  eq(Object.keys(out.phases.oitavas.ties).length, 8, "oitavas foram alteradas");
});

test("bracket oficial ingerido SOBREVIVE ao sanitizador", () => {
  const s = ingest(baseState());
  eq(enforceDrawLifecycle(s), false, "sanitizador mexeu no bracket oficial");
  eq(Object.keys(s.phases.quartas.ties).length, 4, "sanitizador apagou o bracket oficial");
});

test("NENHUM caminho de falha fabrica confronto", () => {
  for (const pairs of [null, OFFICIAL_PAIRS.slice(0, 2), [["Santos", "Bahia"], ["Palmeiras", "Vasco"], ["Cruzeiro", "Flamengo"], ["Corinthians", "Fluminense"]]]) {
    const s = baseState();
    try { ingest(s, { pairs }); } catch { /* esperado */ }
    eq(Object.keys(s.phases.quartas.ties).length, 0, `falha fabricou confronto: ${JSON.stringify(pairs)}`);
  }
});

test("CONTRATO: nada deriva o bracket da ESPN, de sorteio ou dos classificados", () => {
  const norm = extractFn("normalizeCbfDraw");
  assert(!/espn/i.test(norm), "o normalizador menciona ESPN");
  assert(!/random|shuffle|sort\(\)\s*\[0\]/i.test(norm.replace(/\.sort\(\)/g, "")), "há aleatoriedade no normalizador");
  assert(!/Math\.random/.test(src), "Math.random apareceu no app");
  // O normalizador USA a lista de classificados apenas para VALIDAR, nunca para gerar pares.
  assert(/known\.has\(team\)/.test(norm), "o normalizador não valida contra os classificados");
  assert(!/pop\(\)|splice\(|slice\(0,\s*2\)\s*\)/.test(norm), "parece emparelhar classificados programaticamente");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ CBF INGESTION SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
