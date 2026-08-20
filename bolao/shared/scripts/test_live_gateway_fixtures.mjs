#!/usr/bin/env node
/**
 * CONTRATO DOS FIXTURES DO GATEWAY — determinístico, sem rede.
 *
 * Um mock só é seguro enquanto continua parecido com produção. No instante em que o schema do
 * gateway andar e o fixture não, `audit_accessibility.mjs` passa a testar uma interface que
 * responde a dados que o produto nunca emite — verde, e sem valor nenhum.
 *
 * Esta suíte é o que impede isso: ela confere os fixtures contra os construtores REAIS da Edge
 * Function, campo a campo, e trava as distinções que já custaram incidente
 * (`matches: null` ≠ `matches: []`, `stale` ≠ `SOURCE_UNAVAILABLE`).
 *
 * NÃO toca a rede e NÃO abre navegador — roda no CI hermético como gate obrigatório.
 *
 * Uso: node bolao/shared/scripts/test_live_gateway_fixtures.mjs
 */

import {
  GATEWAY_STATES, fixtureMatches, gatewayFixture,
} from "./live_gateway_fixtures.mjs";
import {
  SCHEMA_VERSION, buildGatewayPayload, sourceUnavailablePayload,
} from "../../../supabase/functions/_shared/normalize.js";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => {
  if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("\nContrato dos fixtures do gateway live-football\n");

// ─── 1. Os quatro estados existem e são distintos ───────────────────────────
test("os quatro estados do contrato estão declarados", () => {
  eq(GATEWAY_STATES.length, 4, "o contrato do gateway tem quatro estados servíveis");
  for (const s of ["FRESH", "STALE", "EMPTY", "SOURCE_UNAVAILABLE"]) {
    assert(GATEWAY_STATES.includes(s), `estado ausente: ${s}`);
  }
});

test("um estado desconhecido FALHA em vez de devolver algo plausível", () => {
  let threw = false;
  try { gatewayFixture("br2026", "PROVAVELMENTE_OK"); } catch { threw = true; }
  assert(threw, "um estado inventado precisa estourar — devolver um corpo 'parecido' esconde o erro");
});

// ─── 2. A forma vem dos construtores REAIS ──────────────────────────────────
test("FRESH tem exatamente as chaves que buildGatewayPayload() emite", () => {
  const { payload } = gatewayFixture("br2026", "FRESH");
  const canonical = buildGatewayPayload({
    competition: "br2026", matches: [], observedAt: payload.observedAt,
    servedAt: payload.servedAt, stale: false, staleReason: null,
  });
  eq(Object.keys(payload).sort().join(","), Object.keys(canonical).sort().join(","),
     "o fixture divergiu do schema que a Edge Function realmente monta");
});

test("SOURCE_UNAVAILABLE tem exatamente as chaves que sourceUnavailablePayload() emite", () => {
  const { payload } = gatewayFixture("br2026", "SOURCE_UNAVAILABLE");
  const canonical = sourceUnavailablePayload("br2026", "UPSTREAM_403");
  eq(Object.keys(payload).sort().join(","), Object.keys(canonical).sort().join(","),
     "o fixture de indisponibilidade divergiu do schema real");
});

test("schemaVersion do fixture acompanha o do produto", () => {
  for (const s of GATEWAY_STATES) {
    eq(gatewayFixture("br2026", s).payload.schemaVersion, SCHEMA_VERSION, `schemaVersion errado em ${s}`);
  }
});

// ─── 3. As distinções que já custaram incidente ─────────────────────────────
test("SOURCE_UNAVAILABLE devolve matches:null — jamais lista vazia", () => {
  const { payload, httpStatus } = gatewayFixture("br2026", "SOURCE_UNAVAILABLE");
  eq(payload.matches, null, "'não sei' precisa ser null; [] afirmaria que não há jogo");
  eq(payload.status, "SOURCE_UNAVAILABLE", "o status explícito faz parte do contrato");
  eq(payload.stale, true, "fonte indisponível é sempre stale");
  eq(payload.observedAt, null, "sem observação boa não há observedAt");
  eq(httpStatus, 503, "SOURCE_UNAVAILABLE responde 503, como live-football/index.ts:167");
});

test("EMPTY devolve matches:[] fresco — 'não há jogo agora' é resposta BOA", () => {
  const { payload, httpStatus } = gatewayFixture("br2026", "EMPTY");
  assert(Array.isArray(payload.matches), "EMPTY precisa de lista de verdade");
  eq(payload.matches.length, 0, "EMPTY é lista vazia");
  eq(payload.stale, false, "uma observação recente sem jogo NÃO é stale");
  eq(payload.status, undefined, "resposta saudável não carrega campo status");
  eq(httpStatus, 200, "EMPTY é servível: 200");
});

test("EMPTY e SOURCE_UNAVAILABLE nunca são confundíveis", () => {
  const empty = gatewayFixture("br2026", "EMPTY").payload;
  const down = gatewayFixture("br2026", "SOURCE_UNAVAILABLE").payload;
  assert(empty.matches !== down.matches, "os dois estados não podem ter o mesmo matches");
  assert(!(Array.isArray(down.matches)), "indisponível não pode virar array");
  assert(empty.stale !== down.stale, "stale precisa separar os dois");
});

test("STALE serve dados ANTIGOS com motivo declarado, e ainda 200", () => {
  const { payload, httpStatus } = gatewayFixture("br2026", "STALE");
  eq(payload.stale, true, "STALE é stale");
  assert(typeof payload.staleReason === "string" && payload.staleReason.length > 0,
         "stale sem motivo é indistinguível de fresco quebrado");
  assert(Array.isArray(payload.matches) && payload.matches.length > 0,
         "STALE serve o último bom conhecido — tem conteúdo");
  assert(payload.ageSeconds > 0, "STALE precisa declarar idade real da observação");
  eq(httpStatus, 200, "dentro da janela de 10 min o gateway ainda serve: 200");
});

test("FRESH não se disfarça de STALE", () => {
  const { payload } = gatewayFixture("br2026", "FRESH");
  eq(payload.stale, false, "FRESH não é stale");
  eq(payload.staleReason, null, "FRESH não tem motivo de degradação");
  assert(payload.matches.length > 0, "FRESH do fixture carrega partida — é o caso que exercita o hero");
});

// ─── 4. As partidas passam pelo normalizador real ───────────────────────────
test("as partidas do fixture saem de normalizeScoreboard(), com os campos do produto", () => {
  const [m] = fixtureMatches(new Date().toISOString());
  for (const k of ["id", "date", "state", "statusName", "completed", "homeTeam", "awayTeam",
                   "homeScore", "awayScore", "clockSec", "clockStr", "period", "details"]) {
    assert(k in m, `campo ausente no match normalizado: ${k}`);
  }
  eq(m.state, "in", "o fixture representa uma partida EM ANDAMENTO — é o que exercita o card ao vivo");
  eq(typeof m.homeScore, "number", "placar precisa ser número, como safeInt() entrega");
});

// ─── 5. Competição ──────────────────────────────────────────────────────────
test("a competição pedida aparece no corpo", () => {
  for (const c of ["br2026", "cdb2026"]) {
    eq(gatewayFixture(c, "FRESH").payload.competition, c, `competição errada no corpo para ${c}`);
  }
});

test("competição desconhecida degrada para um corpo válido, nunca para undefined", () => {
  const { payload } = gatewayFixture("nao-existe", "FRESH");
  assert(typeof payload.competition === "string" && payload.competition.length > 0,
         "um rótulo vazio deixaria o app sem saber a que a resposta se refere");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log(`\n✗ FIXTURE CONTRACT FAILED\n`); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
