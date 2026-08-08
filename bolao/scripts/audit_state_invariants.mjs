#!/usr/bin/env node
/**
 * AUDITORIA DE INVARIANTES DE ESTADO — os três apps de futebol.
 *
 * POR QUE ESTA SUÍTE EXISTE (é uma classe de defeito com histórico, não uma precaução teórica):
 *
 * O MESMO defeito apareceu QUATRO vezes neste repositório. Um objeto de estado é reconstruído
 * campo a campo — `{ entries: ..., paid: ..., meta: ... }` — e um campo novo, adicionado depois,
 * não entra na lista. Ele então é DESCARTADO em silêncio a cada merge. Nada falha; o dado
 * simplesmente evapora. Os quatro casos, todos no CDB2026:
 *
 *   1. flags de `espnSync` (AUDIT-01) — rotinas "roda uma vez" voltavam a rodar em toda carga
 *   2. `cutoffOffsetMs` (hotfix 2026-08-01) — a reabertura de prazo era desfeita a cada sync
 *   3. `officialDraw` no `mergeStates()` (Batch 2) — o bracket oficial perdia a proveniência e
 *      voltava a parecer não-oficial, liberando o sanitizador contra confrontos legítimos
 *   4. `officialDraw` no `applyMutationOverRemote()` (Batch 4) — QUALQUER ação administrativa
 *      apagava a proveniência do sorteio
 *
 * O CDB2026 já foi corrigido (spread) e tem cobertura própria em `audit_state_merge.mjs`. O que
 * ninguém tinha auditado é que **Copa2026 e BR2026 têm a mesma forma de código**: os dois
 * `mergeStates()` também devolvem um objeto ENUMERADO à mão. Hoje as listas estão completas — mas
 * a estrutura é a mesma que falhou quatro vezes, e a primeira pessoa a acrescentar um campo de
 * topo vai perdê-lo sem aviso.
 *
 * O QUE ESTA SUÍTE PROVA, e é deliberadamente uma propriedade e não uma lista:
 *   · nenhum campo de topo presente na entrada some da saída do merge — inclusive um campo que
 *     esta suíte inventa e que o código não conhece (é isso que testa a ESTRUTURA, e não a lista
 *     de campos que hoje por acaso está certa)
 *   · a regra de autoridade de cada categoria continua valendo depois do merge
 *   · o ciclo save → remoto → merge → reload não perde nada
 *
 * Uso: node bolao/scripts/audit_state_invariants.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const clone = o => JSON.parse(JSON.stringify(o));

function extractFn(src, name) {
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

// ── Sandbox por app: só o necessário para `mergeStates()` rodar sem o DOM ───
function loadMerge(app) {
  const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
  const extras = app === "cdb2026"
    ? `const DATA = { phases: [{ id: "oitavas" }, { id: "quartas" }, { id: "semifinal" }, { id: "final" }] };
       function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
       ${(() => { const m = src.match(/const DRAW_GATED_PHASES = new Set\(\[[^\]]*\]\);/); return m ? m[0] : ""; })()}
       ${extractFn(src, "officialDrawProvenanceIsValid")}
       ${(() => { const m = src.match(/const OFFICIAL_DRAW_REQUIRED_FIELDS = \[[^\]]*\];/); return m ? m[0] : ""; })()}
       ${extractFn(src, "phaseDrawIsOfficial")}
       ${extractFn(src, "enforceDrawLifecycle")}`
    : "";
  const body = `
    const CONFIG = { siteVersion: "test" };
    const C = CONFIG;
    ${extras}
  `;
  // mergeEntriesTombstonesAuditLog só existe no CDB2026 — os outros dois inlinam o merge de entradas.
  const helper = src.includes("function mergeEntriesTombstonesAuditLog")
    ? extractFn(src, "mergeEntriesTombstonesAuditLog") : "";
  const fn = new Function(`${body}\n${helper}\n${extractFn(src, "mergeStates")}\nreturn mergeStates;`)();
  return { mergeStates: fn, src };
}

// Estado mínimo mas REALISTA por app (mesma forma que a produção usa).
function baseState(app, tag) {
  const common = {
    entries: [{ id: "e1", entryName: `Entrada ${tag}`, createdAt: "2026-07-01T10:00:00.000Z",
                picks: { matches: {}, qualified: {} } }],
    deletedIds: [], paid: { e1: true }, auditLog: [{ ts: `2026-07-01T10:00:0${tag === "L" ? 1 : 2}.000Z`, what: tag }],
    meta: { updatedAt: "2026-07-01T10:00:00.000Z", version: "test" },
  };
  if (app === "copa2026") return clone({ ...common, results: {}, deletedResults: [] });
  if (app === "br2026") return clone({ ...common, results: null, cutoffAt: "2026-08-01T20:00:00.000Z" });
  return clone({ ...common, espnSync: { activePhaseId: "oitavas" },
    phases: { oitavas: { cutoffAt: null, ties: {} }, quartas: { cutoffAt: null, ties: {} },
              semifinal: { cutoffAt: null, ties: {} }, final: { cutoffAt: null, ties: {} } } });
}

const APPS = ["copa2026", "br2026", "cdb2026"];

console.log("\nInvariantes de estado — merge dos três apps de futebol\n");

// ═══ 1. A PROPRIEDADE ESTRUTURAL: nenhum campo de topo desaparece ═══════════
for (const app of APPS) {
  const { mergeStates } = loadMerge(app);

  test(`[${app}] nenhum campo de topo conhecido some no merge (nos dois sentidos)`, () => {
    const local = baseState(app, "L"), remote = baseState(app, "R");
    const expected = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const opts of [{}, { preferRemoteResults: true }, { preferRemoteResults: true, remoteAuthoritative: true }]) {
      const out = mergeStates(clone(local), clone(remote), opts);
      const missing = [...expected].filter(k => !(k in out));
      eq(missing.length, 0, `opts=${JSON.stringify(opts)} perdeu: ${missing.join(", ")}`);
    }
  });

  test(`[${app}] ESTRUTURAL: um campo de topo que o código NÃO conhece sobrevive ao merge`, () => {
    // É este o teste que importa. Os campos acima estão na lista hoje POR SORTE — a lista foi
    // mantida à mão. Este campo inventado prova que o merge preserva por ESTRUTURA, não por
    // enumeração; é exatamente o que faltava nas quatro vezes em que um campo novo evaporou.
    const local = { ...baseState(app, "L"), campoFuturoDoBatchN: { valor: 42, nested: { ok: true } } };
    const remote = baseState(app, "R");
    const out = mergeStates(clone(local), clone(remote), {});
    assert("campoFuturoDoBatchN" in out,
      `o merge DESCARTOU um campo de topo desconhecido. É a mesma classe que já derrubou espnSync, ` +
      `cutoffOffsetMs e officialDraw (2x). O objeto de retorno de mergeStates() precisa de uma base ` +
      `por SPREAD, e não de uma lista de campos mantida à mão.`);
    eq(JSON.stringify(out.campoFuturoDoBatchN), JSON.stringify(local.campoFuturoDoBatchN),
       "o campo desconhecido sobreviveu mas foi alterado");
  });

  test(`[${app}] o merge não inventa entrada, pagamento nem apaga entrada legítima`, () => {
    const local = baseState(app, "L");
    const remote = clone(baseState(app, "R"));
    remote.entries.push({ id: "e2", entryName: "Só no remoto", createdAt: "2026-07-02T10:00:00.000Z",
                          picks: { matches: {}, qualified: {} } });
    const out = mergeStates(clone(local), clone(remote), { preferRemoteResults: true });
    const ids = out.entries.map(e => e.id).sort();
    eq(ids.join(","), "e1,e2", "união de entradas incorreta");
    eq(out.paid.e1, true, "pagamento legítimo perdido no merge");
  });

  test(`[${app}] ciclo save → remoto → merge → reload é estável (idempotente)`, () => {
    const local = baseState(app, "L");
    const saved = clone(mergeStates(clone(local), baseState(app, "R"), {}));
    const reloaded = clone(mergeStates(clone(local), clone(saved), { preferRemoteResults: true }));
    const again = clone(mergeStates(clone(reloaded), clone(saved), { preferRemoteResults: true }));
    // `meta.updatedAt` pode legitimamente avançar (a Copa carimba a hora); o resto não pode oscilar.
    const strip = o => { const c = clone(o); delete c.meta; return c; };
    eq(JSON.stringify(strip(again)), JSON.stringify(strip(reloaded)),
       "o merge não é idempotente: recarregar o mesmo estado muda o resultado");
  });
}

// ═══ 2. MATRIZ DE AUTORIDADE — quem vence, por categoria ═══════════════════
// Deixar isto implícito foi o que permitiu bugs sutis (um `false` local antigo derrubando um
// `true` remoto novo do admin). Cada regra abaixo é executável, não comentário.

test("[todos] AUTORIDADE `paid`: any-true-wins (nunca reverte um pagamento por cache velho)", () => {
  for (const app of APPS) {
    const { mergeStates } = loadMerge(app);
    const local = baseState(app, "L"), remote = baseState(app, "R");
    local.paid = { e1: false };            // navegador com cache anterior ao pagamento
    remote.paid = { e1: true };            // admin marcou como pago
    const out = mergeStates(clone(local), clone(remote), {});
    eq(out.paid.e1, true, `${app}: um false local antigo reverteu um pagamento confirmado`);
  }
});

test("[todos] AUTORIDADE `deletedIds`: tombstone é UNIÃO — exclusão nunca ressuscita", () => {
  for (const app of APPS) {
    const { mergeStates } = loadMerge(app);
    const local = baseState(app, "L"), remote = baseState(app, "R");
    local.deletedIds = ["e1"];             // admin excluiu neste dispositivo
    remote.entries = [...remote.entries];  // remoto ainda tem a entrada
    const out = mergeStates(clone(local), clone(remote), { preferRemoteResults: true });
    assert(out.deletedIds.includes("e1"), `${app}: o tombstone sumiu`);
    assert(!out.entries.some(e => e.id === "e1"), `${app}: entrada excluída ressuscitou no merge`);
  }
});

test("[br2026] AUTORIDADE `cutoffAt`: sempre o MAIS TARDE, nunca null, nunca anda para trás", () => {
  const { mergeStates } = loadMerge("br2026");
  const mk = (l, r) => {
    const local = baseState("br2026", "L"), remote = baseState("br2026", "R");
    local.cutoffAt = l; remote.cutoffAt = r;
    return mergeStates(clone(local), clone(remote), {}).cutoffAt;
  };
  eq(mk("2026-08-01T20:00:00.000Z", "2026-08-05T20:00:00.000Z"), "2026-08-05T20:00:00.000Z",
     "extensão manual do prazo não se propagou");
  eq(mk("2026-08-05T20:00:00.000Z", "2026-08-01T20:00:00.000Z"), "2026-08-05T20:00:00.000Z",
     "o prazo andou para trás");
  eq(mk("2026-08-05T20:00:00.000Z", null), "2026-08-05T20:00:00.000Z", "um null remoto apagou o prazo");
  eq(mk(null, "2026-08-05T20:00:00.000Z"), "2026-08-05T20:00:00.000Z", "prazo remoto ignorado");
});

test("[cdb2026] AUTORIDADE por fase: officialDraw/topology/cutoffOffsetMs sobrevivem", () => {
  const { mergeStates } = loadMerge("cdb2026");
  const local = baseState("cdb2026", "L"), remote = baseState("cdb2026", "R");
  remote.phases.quartas = {
    cutoffAt: null, cutoffOffsetMs: 7200000, ties: {},
    officialDraw: { authority: "CBF", source: "cbf", scheduledAt: "2026-08-09T18:00:00Z",
                    ingestedAt: "2026-08-09T19:00:00Z", validatedAt: "2026-08-09T19:05:00Z",
                    bracketHash: "abc123" },
    topology: { slots: {}, provenance: { authority: "CBF", source: "cbf",
                ingestedAt: "2026-08-09T19:00:00Z", validatedAt: "2026-08-09T19:05:00Z" } },
    campoDeFaseFuturo: "precisa sobreviver",
  };
  const out = mergeStates(clone(local), clone(remote), { preferRemoteResults: true, remoteAuthoritative: true });
  const q = out.phases.quartas;
  assert(q.officialDraw, "officialDraw perdido (defeito 3 da lista do cabeçalho)");
  eq(q.officialDraw.bracketHash, "abc123", "bracketHash alterado");
  assert(q.topology, "topology perdida (Batch 4)");
  eq(q.cutoffOffsetMs, 7200000, "cutoffOffsetMs perdido (defeito 2)");
  eq(q.campoDeFaseFuturo, "precisa sobreviver",
     "um campo de FASE desconhecido sumiu — o objeto de fase voltou a ser enumerado à mão");
});

test("[cdb2026] AUTORIDADE `espnSync`: flags 'roda uma vez' são OR, nunca voltam a false", () => {
  const { mergeStates } = loadMerge("cdb2026");
  const local = baseState("cdb2026", "L"), remote = baseState("cdb2026", "R");
  local.espnSync = { activePhaseId: "oitavas", healedPhantomTies: true };
  remote.espnSync = { activePhaseId: "oitavas", healedPhantomTies: false };
  const out = mergeStates(clone(local), clone(remote), { preferRemoteResults: true });
  eq(out.espnSync.healedPhantomTies, true,
     "um flag de migração já executada voltou a false — a rotina 'roda uma vez' rodaria de novo (AUDIT-01)");
});

// ═══ 2b. O CASO REAL, ENCONTRADO EM PRODUÇÃO ════════════════════════════════
test("[br2026] `roundEmail` (escrito pelo CRON em Python) sobrevive ao merge do NAVEGADOR", () => {
  // Este não é um campo hipotético: foi encontrado no estado de PRODUÇÃO do BR2026 em 2026-08-08,
  // 1KB, com `pendingBatch` / `baseline` / `sentGameIds` / `sentBatches`.
  //
  // Quem escreve é `bolao/br2026/scripts/send_round_email.py` — um cron, direto no Supabase. Quem
  // apagava era o NAVEGADOR: `roundEmail` nunca esteve na lista de campos que o `mergeStates()`
  // reconstruía, então qualquer participante que abrisse a página e salvasse devolvia ao Supabase
  // um estado SEM ele.
  //
  // A consequência não é cosmética: `sentGameIds`/`sentBatches` são o registro de IDEMPOTÊNCIA do
  // envio. Perder esse registro significa poder REENVIAR email de rodada já enviado para
  // participantes reais, e perder `baseline` significa calcular movimento de ranking contra
  // referência errada. É um defeito entre dois escritores (cron e navegador) que nenhum teste de um
  // caminho só poderia ver.
  const { mergeStates } = loadMerge("br2026");
  const remote = baseState("br2026", "R");
  remote.roundEmail = {                                    // como o cron grava
    baseline: { g4: ["A", "B"], z4: ["Y", "Z"] },
    sentGameIds: ["401", "402"], sentBatches: [{ id: "b1", sentAt: "2026-08-01T00:00:00Z" }],
    pendingBatch: null,
  };
  const local = baseState("br2026", "L");                  // navegador, sem ideia do campo
  for (const opts of [{}, { preferRemoteResults: true }]) {
    const out = mergeStates(clone(local), clone(remote), opts);
    assert(out.roundEmail, `opts=${JSON.stringify(opts)}: o merge do navegador apagou roundEmail`);
    eq(JSON.stringify(out.roundEmail.sentGameIds), JSON.stringify(remote.roundEmail.sentGameIds),
       "o registro de idempotência de envio foi alterado — email de rodada pode ser reenviado");
    eq(JSON.stringify(out.roundEmail.baseline), JSON.stringify(remote.roundEmail.baseline),
       "a baseline de movimento do ranking foi perdida");
  }
});

// ═══ 3. CONTRATO DE CÓDIGO: a forma que falhou 4x não pode voltar ══════════
test("CONTRATO: todo mergeStates() monta o retorno a partir de um SPREAD, não de lista à mão", () => {
  const offenders = [];
  for (const app of APPS) {
    const { src } = loadMerge(app);
    const body = extractFn(src, "mergeStates");
    // Procura o objeto RETORNADO e exige que ele comece por um spread da entrada.
    const hasSpreadBase = /return\s*\{\s*\.\.\.|const merged = \{\s*\.\.\./.test(body);
    if (!hasSpreadBase) offenders.push(app);
  }
  eq(offenders.length, 0,
    `${offenders.join(", ")}: o retorno de mergeStates() é enumerado campo a campo. Foi assim que ` +
    `espnSync, cutoffOffsetMs e officialDraw (2x) sumiram. Um campo novo de topo será descartado ` +
    `em silêncio pelo próximo merge.`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ STATE INVARIANTS SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
