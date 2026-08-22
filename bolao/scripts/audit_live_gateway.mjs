#!/usr/bin/env node
/**
 * GATEWAY DE DADOS AO VIVO — injeção de falhas e contrato de degradação.
 *
 * ─── O QUE ESTA SUÍTE PROTEGE ───────────────────────────────────────────────────────────────
 *
 * A regra que origina o desenho inteiro:
 *
 *     "a fonte falhou"   ≠   "não há jogo ao vivo"
 *
 * Colapsar os dois é exatamente como o hero sumia da tela: um erro de rede virava lista vazia,
 * a lista vazia virava "não há jogo", e o card desaparecia com uma partida acontecendo.
 *
 * Nenhum teste aqui toca a rede. O transporte é injetado, então cada modo de falha da ESPN
 * (403, 429, 500, timeout, JSON quebrado, resposta parcial) é exercitado de verdade, sem depender
 * de a ESPN estar fora do ar no momento do teste.
 *
 * Uso: node bolao/scripts/audit_live_gateway.mjs
 */

import {
  resolveGatewayResponse, validateRequest, espnUrlFor,
  FRESH_TTL_MS, LAST_KNOWN_GOOD_MAX_AGE_MS, HEALTH,
} from "../../supabase/functions/_shared/gateway_core.js";
import { ALLOWED_COMPETITIONS } from "../../supabase/functions/_shared/normalize.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const NOW = 1_800_000_000_000;

// Payload cru mínimo, no formato real da ESPN.
const rawOk = (state = "in", clock = 2880) => ({
  events: [{
    id: "ev1", date: "2026-08-09T19:00Z",
    competitions: [{
      status: { clock, displayClock: "48'", period: 2, type: { state, name: "STATUS_IN_PROGRESS", completed: state === "post" } },
      competitors: [
        { homeAway: "home", score: "1", team: { id: "1", displayName: "Cruzeiro" } },
        { homeAway: "away", score: "1", team: { id: "2", displayName: "Mirassol" } },
      ],
      venue: { fullName: "Mineirão", address: { city: "BH" } },
      details: [],
    }],
  }],
});

const okTransport = (raw = rawOk()) => async () => ({ ok: true, status: 200, json: async () => raw });
const failTransport = (status) => async () => ({ ok: false, status, json: async () => ({}) });
const throwTransport = () => async () => { throw new Error("network"); };
const malformedTransport = () => async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) });

const cachedGood = (storedAtOffset = 0) => ({
  payload: {
    schemaVersion: 1, competition: "br2026", provider: "espn",
    observedAt: new Date(NOW - storedAtOffset).toISOString(),
    servedAt: new Date(NOW - storedAtOffset).toISOString(),
    ageSeconds: 0, stale: false, staleReason: null,
    matches: [{ id: "ev1", state: "in", homeScore: 1, awayScore: 1, clockSec: 2880 }],
  },
  observedAt: new Date(NOW - storedAtOffset).toISOString(),
  storedAt: NOW - storedAtOffset,
});

console.log("\nGateway de dados ao vivo\n");
console.log(`TTL fresco: ${FRESH_TTL_MS / 1000}s · janela de último bom conhecido: ${LAST_KNOWN_GOOD_MAX_AGE_MS / 60000} min\n`);

// ─── Caminho feliz e cache ──────────────────────────────────────────────────────────────────
console.log("Cache:");

await test("cache FRESCO responde sem tocar na fonte", async () => {
  let chamou = false;
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(5_000), now: NOW,
    fetchRaw: async () => { chamou = true; return { ok: true, status: 200, json: async () => rawOk() }; },
  });
  eq(chamou, false, "foi à fonte com cache fresco — anula o efeito de coalescência");
  eq(r.health, HEALTH.FRESH, "saúde");
  eq(r.cacheHit, true, "deveria ser hit");
});

await test("cache VENCIDO busca a fonte e promove o resultado", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(FRESH_TTL_MS + 1000), now: NOW, fetchRaw: okTransport(),
  });
  eq(r.health, HEALTH.FRESH, "saúde");
  eq(r.shouldStore, true, "resultado bom precisa virar último bom conhecido");
  eq(r.payload.matches.length, 1, "normalizou");
  eq(r.payload.stale, false, "não é stale");
});

await test("sem cache nenhum busca a fonte", async () => {
  const r = await resolveGatewayResponse({ competition: "br2026", cached: null, now: NOW, fetchRaw: okTransport() });
  eq(r.health, HEALTH.FRESH, "saúde");
  eq(r.payload.matches[0].homeTeam, "Cruzeiro", "normalização");
});

// ─── Fronteira exata do TTL ─────────────────────────────────────────────────────────────────
console.log("\nFronteira do TTL (sem ambiguidade):");

const atAge = async (age) => {
  let bateu = false;
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(age), now: NOW,
    fetchRaw: async () => { bateu = true; return { ok: true, status: 200, json: async () => rawOk() }; },
  });
  return { ...r, bateu };
};

await test("TTL − 1ms: serve do cache, sem ir à fonte", async () => eq((await atAge(FRESH_TTL_MS - 1)).bateu, false, "ida à fonte"));
await test("TTL exato: JÁ vai à fonte (limite exclusivo)", async () => eq((await atAge(FRESH_TTL_MS)).bateu, true, "ida à fonte"));
await test("TTL + 1ms: vai à fonte", async () => eq((await atAge(FRESH_TTL_MS + 1)).bateu, true, "ida à fonte"));

// ─── Injeção de falhas da fonte ─────────────────────────────────────────────────────────────
console.log("\nFalha da fonte COM último bom conhecido (serve degradado):");

// A saúde segue a IDADE DO DADO, não o desfecho do fetch (Issue #296). Antes, qualquer queda para
// o cache era rotulada STALE — inclusive um cache de 16 segundos. Cada modo de falha é exercitado
// nas DUAS faixas: com dado ainda fresco (o aviso de atraso NÃO pode acender) e com dado na faixa
// atrasada (o aviso TEM de acender, com motivo legível).
const IDADE_FRESCA = FRESH_TTL_MS + 1000;   // 16s — dado fresco, fonte quebrada
const IDADE_ATRASADA = 20 * 60_000;         // 20 min — dentro de STALE_BUT_USABLE

for (const status of [403, 429, 500, 503]) {
  await test(`ESPN ${status} + dado FRESCO → serve sem mentir que está atrasado`, async () => {
    const r = await resolveGatewayResponse({
      competition: "br2026", cached: cachedGood(IDADE_FRESCA), now: NOW, fetchRaw: failTransport(status),
    });
    eq(r.health, HEALTH.FRESH, "saúde: o dado tem 16s, é fresco de verdade");
    eq(r.payload.stale, false, "acenderia aviso de atraso sobre dado fresco");
    eq(r.payload.sourceDegraded, true, "a falha da fonte não pode sumir do relato");
    eq(r.upstreamStatus, status, "status da fonte preservado para telemetria");
    assert(Array.isArray(r.payload.matches) && r.payload.matches.length === 1,
      "perdeu as partidas do último bom conhecido");
  });

  await test(`ESPN ${status} + dado ATRASADO → serve marcado, com motivo`, async () => {
    const r = await resolveGatewayResponse({
      competition: "br2026", cached: cachedGood(IDADE_ATRASADA), now: NOW, fetchRaw: failTransport(status),
    });
    eq(r.health, HEALTH.STALE, "saúde");
    eq(r.payload.stale, true, "precisa vir marcado como stale");
    eq(r.payload.staleReason, `UPSTREAM_${status}`, "motivo legível por máquina");
    eq(r.payload.ageSeconds, 20 * 60, "a UI precisa da idade para dizer 'há 20 min'");
    assert(Array.isArray(r.payload.matches) && r.payload.matches.length === 1,
      "perdeu as partidas do último bom conhecido");
  });
}

await test("ESPN inalcançável (timeout/DNS) → último bom conhecido, motivo distinto", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(IDADE_ATRASADA), now: NOW, fetchRaw: throwTransport(),
  });
  eq(r.health, HEALTH.STALE, "saúde");
  eq(r.payload.staleReason, "UPSTREAM_UNREACHABLE", "motivo");
});

await test("ESPN inalcançável com dado fresco → FRESH, mas a degradação é relatada", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(IDADE_FRESCA), now: NOW, fetchRaw: throwTransport(),
  });
  eq(r.health, HEALTH.FRESH, "saúde");
  eq(r.payload.sourceDegraded, true, "a queda da fonte ficaria invisível ao monitor");
});

await test("JSON MALFORMADO com HTTP 200 NÃO envenena o cache", async () => {
  // O caso mais traiçoeiro: a fonte responde "sucesso" com corpo quebrado. Se isso virasse último
  // bom conhecido, uma observação boa seria destruída por uma resposta inútil.
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(IDADE_FRESCA), now: NOW, fetchRaw: malformedTransport(),
  });
  eq(r.shouldStore, false, "payload malformado seria promovido a último bom conhecido");
  eq(r.payload.matches[0].id, "ev1", "as partidas boas anteriores sumiram");
  eq(r.payload.sourceDegraded, true, "200 malformado é falha de fonte e precisa aparecer");
});

await test("JSON MALFORMADO com dado ATRASADO degrada para o cache anterior", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(IDADE_ATRASADA), now: NOW, fetchRaw: malformedTransport(),
  });
  eq(r.shouldStore, false, "payload malformado seria promovido a último bom conhecido");
  eq(r.health, HEALTH.STALE, "deveria degradar para o cache anterior");
  eq(r.payload.matches[0].id, "ev1", "as partidas boas anteriores sumiram");
});

// ─── A distinção central ────────────────────────────────────────────────────────────────────
console.log("\n'Fonte falhou' NUNCA vira 'não há jogo':");

await test("falha sem cache → SOURCE_UNAVAILABLE com `matches: null`, não `[]`", async () => {
  const r = await resolveGatewayResponse({ competition: "br2026", cached: null, now: NOW, fetchRaw: failTransport(500) });
  eq(r.health, HEALTH.SOURCE_UNAVAILABLE, "saúde");
  eq(r.payload.matches, null,
    "devolveu lista vazia — o app concluiria 'não há jogo' e o hero sumiria com jogo acontecendo");
  eq(r.payload.status, "SOURCE_UNAVAILABLE", "status explícito");
});

await test("dia SEM jogo devolve `[]` com stale:false — sabemos que não há", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: null, now: NOW,
    fetchRaw: async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) }),
  });
  assert(Array.isArray(r.payload.matches) && r.payload.matches.length === 0, "deveria ser lista vazia");
  eq(r.payload.stale, false, "não é degradação; é conhecimento");
  eq(r.health, HEALTH.FRESH, "saúde");
});

await test("os dois casos são DISTINGUÍVEIS pelo cliente", async () => {
  const falhou = await resolveGatewayResponse({ competition: "br2026", cached: null, now: NOW, fetchRaw: failTransport(500) });
  const semJogo = await resolveGatewayResponse({
    competition: "br2026", cached: null, now: NOW,
    fetchRaw: async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) }) });
  assert(falhou.payload.matches === null && Array.isArray(semJogo.payload.matches),
    "os dois estados são indistinguíveis na resposta — é o bug de origem");
});

// ─── Janela do último bom conhecido ─────────────────────────────────────────────────────────
console.log("\nJanela do último bom conhecido:");

await test("dentro da janela → serve degradado", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(LAST_KNOWN_GOOD_MAX_AGE_MS - 1000), now: NOW, fetchRaw: failTransport(500) });
  eq(r.health, HEALTH.STALE, "saúde");
});

await test("no limite exato → ainda serve (inclusivo)", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(LAST_KNOWN_GOOD_MAX_AGE_MS), now: NOW, fetchRaw: failTransport(500) });
  eq(r.health, HEALTH.STALE, "saúde no limite");
});

await test("além da janela → admite que não sabe, sem inventar", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(LAST_KNOWN_GOOD_MAX_AGE_MS + 1), now: NOW, fetchRaw: failTransport(500) });
  eq(r.health, HEALTH.SOURCE_UNAVAILABLE, "saúde");
  eq(r.payload.matches, null, "manteve dado velho demais no ar");
});

// ─── Segurança ──────────────────────────────────────────────────────────────────────────────
console.log("\nSegurança (o gateway não pode virar proxy aberto):");

await test("competição desconhecida é REJEITADA", () => {
  eq(validateRequest("nao-existe", "GET").ok, false, "aceitou id desconhecido");
  eq(validateRequest("nao-existe", "GET").error, "UNKNOWN_COMPETITION", "erro");
});

await test("tentativas de injeção/traversal são rejeitadas, e a URL nunca as concatena", () => {
  for (const mau of ["../../etc/passwd", "bra.1", "http://evil.test/x", "br2026;rm -rf", "", null, 42, "BR2026"]) {
    eq(validateRequest(mau, "GET").ok, false, `aceitou entrada maliciosa: ${JSON.stringify(mau)}`);
    eq(espnUrlFor(mau), null, `montou URL para entrada não permitida: ${JSON.stringify(mau)}`);
  }
});

await test("a chave é ÍNDICE, não parte da URL (sem superfície de injeção)", () => {
  for (const k of Object.keys(ALLOWED_COMPETITIONS)) {
    const u = espnUrlFor(k);
    assert(u.startsWith("https://site.api.espn.com/apis/site/v2/sports/soccer/"), `URL inesperada: ${u}`);
    assert(!u.includes(k), `a chave da competição vazou para a URL — indício de concatenação: ${u}`);
  }
});

await test("métodos não-GET são rejeitados", () => {
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    eq(validateRequest("br2026", m).ok, false, `aceitou ${m}`);
    eq(validateRequest("br2026", m).status, 405, "status");
  }
});

await test("a resposta de erro NÃO ecoa a entrada do usuário", () => {
  const r = validateRequest("<script>alert(1)</script>", "GET");
  assert(!JSON.stringify(r).includes("script"), "entrada refletida na resposta de erro");
});

// ─── Contrato de schema ─────────────────────────────────────────────────────────────────────
console.log("\nContrato de schema:");

await test("toda resposta carrega schemaVersion", async () => {
  const r = await resolveGatewayResponse({ competition: "br2026", cached: null, now: NOW, fetchRaw: okTransport() });
  eq(r.payload.schemaVersion, 1, "versão");
  const f = await resolveGatewayResponse({ competition: "br2026", cached: null, now: NOW, fetchRaw: failTransport(500) });
  eq(f.payload.schemaVersion, 1, "a resposta de falha também precisa ser versionada");
});

await test("a resposta expõe idade da observação (o cliente decide se confia)", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cachedGood(FRESH_TTL_MS + 60_000), now: NOW, fetchRaw: failTransport(500) });
  assert(typeof r.payload.ageSeconds === "number" && r.payload.ageSeconds >= 60,
    `idade ausente ou errada: ${r.payload.ageSeconds}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE GATEWAY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
