#!/usr/bin/env node
// CONTRATO DO PRODUTOR DO CACHE AO VIVO — Issue #246. Determinístico, SEM rede e SEM banco.
//
// O produtor escreve numa tabela de produção. As propriedades que precisam ser verdade antes de
// qualquer deploy não são "o caminho feliz funciona" — são as de FALHA:
//
//   · fonte caída NUNCA sobrescreve o último-bom-conhecido (senão degradação vira apagão);
//   · 200 com forma inválida conta como falha da fonte, igual ao gateway;
//   · a única tabela tocada é live_sports_cache;
//   · o corpo gravado é o MESMO envelope que a Edge Function monta — nada de campo do snapshot;
//   · reexecutar é idempotente;
//   · nenhum dado privado entra no payload.
//
// Tudo é injetado (`fetchImpl`/`writeImpl`), então esta suíte roda no CI hermético.
//
// Uso: node bolao/shared/scripts/test_produce_live_cache.mjs

import {
  CACHE_TABLE, PRODUCED_COMPETITIONS, WINDOW_LOOKAHEAD_MS, WINDOW_LOOKBACK_MS,
  isWithinWindow, produceOne,
} from "./produce_live_cache.mjs";
import { buildGatewayPayload } from "../../../supabase/functions/_shared/normalize.js";

let pass = 0, fail = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ✓ ${name}`); pass++; })
    .catch((e) => { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; });
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const NOW = Date.parse("2026-08-20T18:00:00Z");

/** Evento cru no formato REAL da ESPN — a mesma entrada que produção recebe. */
const rawEvent = (state = "in") => ({
  events: [{
    id: "900001", date: "2026-08-20T17:30Z",
    competitions: [{
      status: { clock: 1800, displayClock: "30'", period: 1,
                type: { state, name: "STATUS_IN_PROGRESS", description: "In Progress",
                        shortDetail: "30'", detail: "30'", completed: false } },
      venue: { fullName: "Arena", address: { city: "Cidade" } },
      competitors: [
        { homeAway: "home", score: "1", winner: false, team: { id: "1", displayName: "Cruzeiro" } },
        { homeAway: "away", score: "0", winner: false, team: { id: "2", displayName: "Mirassol" } },
      ],
      details: [],
    }],
  }],
});

const okFetch = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const failFetch = (status) => async () => ({ ok: false, status, json: async () => ({}) });

/** Escritor espião: registra o que seria gravado, sem tocar em nada. */
function spyWriter() {
  const calls = [];
  const impl = async (rec) => { calls.push(rec); return true; };
  return { impl, calls };
}

console.log("\nContrato do produtor do cache ao vivo\n");

// ─── Caminho feliz e forma do envelope ──────────────────────────────────────
console.log("  — observação boa:");

await test("uma observação válida é gravada, com o envelope CANÔNICO do gateway", async () => {
  const w = spyWriter();
  const r = await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW, force: true });
  eq(r.action, "WRITTEN", "deveria ter gravado");
  eq(w.calls.length, 1, "exatamente uma escrita");

  const { payload } = w.calls[0];
  const canonical = buildGatewayPayload({
    competition: "br2026", matches: [], observedAt: payload.observedAt,
    servedAt: payload.servedAt, stale: false, staleReason: null,
  });
  eq(Object.keys(payload).sort().join(","), Object.keys(canonical).sort().join(","),
     "o envelope divergiu do que a Edge Function monta — o gateway serviria campos errados");
  // Guarda explícita contra o envelope do snapshot (espn_provider.py), que é DIFERENTE.
  assert(!("competitionId" in payload), "competitionId e do snapshot, nao do gateway");
  assert(!("generatedAt" in payload), "generatedAt e do snapshot, nao do gateway");
  eq(payload.competition, "br2026", "competition precisa estar no corpo");
  eq(payload.stale, false, "observação nova nao e stale");
  eq(payload.matches.length, 1, "a partida normalizada precisa estar la");
});

await test("a partida passa pelo normalizador REAL (campos do produto)", async () => {
  const w = spyWriter();
  await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW, force: true });
  const [m] = w.calls[0].payload.matches;
  for (const k of ["id", "date", "state", "statusName", "homeTeam", "awayTeam", "homeScore", "awayScore", "clockSec", "period"]) {
    assert(k in m, `campo ausente na partida normalizada: ${k}`);
  }
  eq(m.state, "in", "estado da fonte preservado");
  eq(typeof m.homeScore, "number", "placar numerico, como safeInt entrega");
});

await test("scoreboard vazio é observação BOA: matches [] e stale false", async () => {
  const w = spyWriter();
  const r = await produceOne("br2026", { fetchImpl: okFetch({ events: [] }), writeImpl: w.impl, now: NOW, force: true });
  eq(r.action, "WRITTEN", "'nao ha jogo agora' e uma observacao valida");
  eq(w.calls[0].payload.matches.length, 0, "lista vazia");
  eq(w.calls[0].payload.stale, false, "vazio recente NAO e stale");
});

// ─── Falha da fonte nunca envenena o cache ──────────────────────────────────
console.log("\n  — falha da fonte (o que realmente importa):");

for (const status of [403, 429, 500]) {
  await test(`upstream ${status} => NAO grava (ultimo-bom-conhecido preservado)`, async () => {
    const w = spyWriter();
    const r = await produceOne("br2026", { fetchImpl: failFetch(status), writeImpl: w.impl, now: NOW, force: true });
    eq(r.action, "NO_WRITE", "fonte caida nao pode escrever");
    eq(w.calls.length, 0, "nenhuma escrita podia ter acontecido");
    eq(r.upstreamStatus, status, "o status da fonte precisa ser reportado");
  });
}

await test("timeout/erro de transporte => NAO grava", async () => {
  const w = spyWriter();
  const boom = async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; };
  const r = await produceOne("br2026", { fetchImpl: boom, writeImpl: w.impl, now: NOW, force: true });
  eq(r.action, "NO_WRITE", "erro de transporte nao pode escrever");
  eq(w.calls.length, 0, "nenhuma escrita");
});

await test("HTTP 200 com FORMA INVALIDA => NAO grava (igual ao gateway)", async () => {
  const w = spyWriter();
  const r = await produceOne("br2026", { fetchImpl: okFetch({ nao: "e um scoreboard" }), writeImpl: w.impl, now: NOW, force: true });
  eq(r.action, "NO_WRITE", "200 com corpo quebrado e falha da fonte, nao 'sem jogo'");
  eq(w.calls.length, 0, "um 200 malformado jamais pode sobrescrever observacao boa");
});

await test("uma queda DEPOIS de um sucesso deixa o registro anterior intacto", async () => {
  const w = spyWriter();
  await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW, force: true });
  await produceOne("br2026", { fetchImpl: failFetch(403), writeImpl: w.impl, now: NOW + 60_000, force: true });
  eq(w.calls.length, 1, "a segunda execucao (falha) nao podia escrever nada");
  eq(w.calls[0].payload.matches.length, 1, "o registro bom continua sendo o bom");
});

// ─── Escopo, idempotência e privacidade ─────────────────────────────────────
console.log("\n  — escopo, idempotência e privacidade:");

await test("reexecutar é idempotente: mesma chave, upsert, sem duplicar", async () => {
  const w = spyWriter();
  await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW, force: true });
  await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW + 300_000, force: true });
  eq(w.calls.length, 2, "duas execucoes");
  eq(w.calls[0].competition, w.calls[1].competition, "mesma chave de upsert");
  const a = { ...w.calls[0].payload }, b = { ...w.calls[1].payload };
  for (const k of ["observedAt", "servedAt", "ageSeconds"]) { delete a[k]; delete b[k]; }
  eq(JSON.stringify(a), JSON.stringify(b), "fora os carimbos de tempo, o corpo tem de ser identico");
});

await test("o payload não carrega NENHUM campo além do envelope público", async () => {
  const w = spyWriter();
  await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW, force: true });
  const permitido = new Set(["schemaVersion", "competition", "provider", "observedAt", "servedAt",
                             "ageSeconds", "stale", "staleReason", "matches"]);
  const extra = Object.keys(w.calls[0].payload).filter((k) => !permitido.has(k));
  eq(extra.length, 0, `campo inesperado no payload: ${extra.join(", ")}`);
  const blob = JSON.stringify(w.calls[0]);
  for (const proibido of ["email", "cpf", "telefone", "payment", "txId", "participant", "bolao_state"]) {
    assert(!blob.toLowerCase().includes(proibido.toLowerCase()), `dado nao-publico vazou: ${proibido}`);
  }
});

await test("o registro gravado tem exatamente as colunas da tabela, e só ela", async () => {
  const w = spyWriter();
  await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: w.impl, now: NOW, force: true });
  eq(Object.keys(w.calls[0]).sort().join(","), "competition,observedAt,payload",
     "o produtor nao pode inventar coluna");
  eq(CACHE_TABLE, "live_sports_cache", "a unica tabela alvo");
});

await test("competição fora da whitelist é REJEITADA sem tocar a rede", async () => {
  let touched = false;
  const w = spyWriter();
  const r = await produceOne("../etc/passwd", {
    fetchImpl: async () => { touched = true; return { ok: true, status: 200, json: async () => ({}) }; },
    writeImpl: w.impl, now: NOW, force: true,
  });
  eq(r.action, "REJECTED", "a whitelist fechada precisa barrar");
  assert(!touched, "nem sequer podia ter ido a rede");
  eq(w.calls.length, 0, "nenhuma escrita");
});

await test("dry-run não grava nada, mas ainda monta o payload", async () => {
  const r = await produceOne("br2026", { fetchImpl: okFetch(rawEvent()), writeImpl: null, now: NOW, force: true });
  eq(r.action, "DRY_RUN", "sem escritor injetado e dry-run");
  assert(r.payload && r.payload.matches.length === 1, "o dry-run ainda precisa provar que o payload sai certo");
});

// ─── Janela derivada do calendário ──────────────────────────────────────────
console.log("\n  — janela derivada do calendário commitado:");

await test("partida dentro da janela liga o produtor", () => {
  assert(isWithinWindow(["2026-08-20T17:30Z"], NOW), "jogo em andamento tem de estar na janela");
  assert(isWithinWindow([new Date(NOW + 30 * 60_000).toISOString()], NOW), "jogo prestes a comecar tambem");
});

await test("partida muito no passado ou muito no futuro fica FORA", () => {
  assert(!isWithinWindow([new Date(NOW - WINDOW_LOOKBACK_MS - 60_000).toISOString()], NOW), "jogo velho demais");
  assert(!isWithinWindow([new Date(NOW + WINDOW_LOOKAHEAD_MS + 60_000).toISOString()], NOW), "jogo distante demais");
});

await test("sem calendário conhecido o produtor NAO se cala", () => {
  assert(isWithinWindow([], NOW), "silencio por ignorancia e indistinguivel de produtor quebrado");
  assert(isWithinWindow(["nao-e-data"], NOW) === false, "data ilegivel nao inventa janela");
});

await test("as competições produzidas são as que o gateway serve", () => {
  eq(PRODUCED_COMPETITIONS.join(","), "br2026,cdb2026", "Copa esta arquivada e nao chama o gateway");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ PRODUCER CONTRACT FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
