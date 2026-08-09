#!/usr/bin/env node
/**
 * LIVE_HERO_RELIABILITY — o hero de jogo ao vivo não pode sumir por falha transitória.
 *
 * ─── HISTÓRICO ───────────────────────────────────────────────────────────────────────────────
 *
 * O hero já sumiu da tela do Eduardo TRÊS vezes, cada uma por causa diferente:
 *
 *   1. o workflow escrevia o snapshot num runner efêmero e nunca commitava;
 *   2. o cron era cego das 06:00 às 16:00 UTC e não acordava no horário do jogo;
 *   3. dado velho fazia a mensagem de atraso SUBSTITUIR o minuto confirmado.
 *
 * E em 2026-08-09, uma quarta: às 19:07 UTC dois jogos das 19:00 já tinham começado e o snapshot
 * de produção tinha 138 minutos. Medição das execuções agendadas naquele dia: 24, 28, 34, 38, 40
 * e 47 minutos de intervalo — apesar de o cron declarar dez minutos. **O agendador do GitHub não entrega
 * a cadência declarada**, e nenhuma correção nossa muda isso.
 *
 * A conclusão estrutural: enquanto o hero for controlado por `_liveMatches.length > 0`, ou seja
 * pela observação ATUAL e nada mais, ele vai continuar sumindo — só muda o motivo.
 *
 * ─── O INVARIANTE QUE ESTA SUÍTE TRAVA ──────────────────────────────────────────────────────
 *
 *   AUSÊNCIA DE EVIDÊNCIA NOVA NÃO É EVIDÊNCIA DE QUE A PARTIDA ACABOU.
 *
 * Confirmado ao vivo uma vez, o hero permanece com o último estado confirmado até que:
 *   a) uma observação autoritativa diga explicitamente terminal (final/adiado/suspenso); ou
 *   b) o TTL de retenção (15 min) expire — degradando para DESCONHECIDO, nunca para um resultado
 *      inventado.
 *
 * Uso: node bolao/scripts/audit_live_hero_reliability.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sandbox = {};
new Function("globalThis", "window", readFileSync(join(ROOT, "bolao/shared/js/live_clock.js"), "utf8"))
  .call(sandbox, sandbox, undefined);
const { resolveFeaturedMatchState, FEATURED, RETENTION_TTL_MS } = sandbox.BOLAO_LIVE_CLOCK;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const NOW = 1_800_000_000_000;

// ─── Linha do tempo da fixture (a do print real) ────────────────────────────────────────────
const T2 = { id: "m-1", homeTeam: "Cruzeiro", awayTeam: "Mirassol", homeScore: 1, awayScore: 1,
             clockSeconds: 48 * 60, clockStr: "48'", period: 2, state: "in",
             details: [{ minute: 48 }, { minute: 27 }] };
const RETAINED = { match: T2, confirmedAt: NOW - 60_000 }; // confirmado há 1 min

console.log("\nLIVE_HERO_RELIABILITY\n");
console.log(`TTL de retenção: ${RETENTION_TTL_MS / 60000} min\n`);

// ─── Caminho feliz ──────────────────────────────────────────────────────────────────────────
console.log("Observação atual válida:");

test("jogo ao vivo observado → LIVE_CONFIRMED", () => {
  const r = resolveFeaturedMatchState({ observed: T2, retained: null, now: NOW });
  eq(r.state, FEATURED.LIVE_CONFIRMED, "estado");
  eq(r.retained, false, "não deveria estar usando cache");
});

test("observação atual SEMPRE supera o retido (não vira segunda fonte de verdade)", () => {
  const novo = { ...T2, homeScore: 2, clockSeconds: 60 * 60 };
  const r = resolveFeaturedMatchState({ observed: novo, retained: RETAINED, now: NOW });
  eq(r.match.homeScore, 2, "o cache sobrepôs a observação nova — inversão de autoridade");
});

// ─── Injeção de falhas: A–D devem MANTER o hero ─────────────────────────────────────────────
console.log("\nFalhas transitórias (hero deve permanecer):");

test("A. fonte fica velha (sourceOk, mas sem jogo ao vivo agora) → LIVE_RETAINED", () => {
  const r = resolveFeaturedMatchState({ observed: null, retained: RETAINED, sourceOk: true, now: NOW });
  eq(r.state, FEATURED.LIVE_RETAINED, "hero sumiu por snapshot sem a partida");
  eq(r.reason, "OMITTED_FROM_SNAPSHOT", "motivo");
});

test("B. requisição ao provedor FALHOU → LIVE_RETAINED, motivo distinto", () => {
  const r = resolveFeaturedMatchState({ observed: null, retained: RETAINED, sourceOk: false, now: NOW });
  eq(r.state, FEATURED.LIVE_RETAINED, "falha de fonte apagou o hero");
  eq(r.reason, "SOURCE_UNAVAILABLE", "motivo precisa distinguir de omissão");
});

test("C. snapshot retorna erro (sourceOk=false, sem retido) → SOURCE_UNAVAILABLE, não 'sem jogo'", () => {
  const r = resolveFeaturedMatchState({ observed: null, retained: null, sourceOk: false, now: NOW });
  eq(r.state, FEATURED.SOURCE_UNAVAILABLE,
    "fonte quebrada foi tratada como 'não há jogo' — são coisas diferentes");
});

test("D. snapshot válido mas OMITE a partida → hero mantido", () => {
  const r = resolveFeaturedMatchState({ observed: null, retained: RETAINED, sourceOk: true, now: NOW });
  assert(r.match && r.match.id === "m-1", "a partida sumiu do hero por omissão temporária");
});

test("G. observação MALFORMADA é descartada, e o estado anterior é preservado", () => {
  const lixo = { homeScore: 9 }; // sem id, sem times
  const r = resolveFeaturedMatchState({ observed: lixo, retained: RETAINED, sourceOk: true, now: NOW });
  eq(r.state, FEATURED.LIVE_RETAINED, "payload quebrado foi aceito como observação válida");
  eq(r.match.homeScore, 1, "o placar veio do lixo em vez do último confirmado");
});

test("placar e minuto do último confirmado são preservados intactos", () => {
  const r = resolveFeaturedMatchState({ observed: null, retained: RETAINED, sourceOk: false, now: NOW });
  eq(r.match.homeScore, 1, "placar mandante");
  eq(r.match.awayScore, 1, "placar visitante");
  eq(r.match.clockSeconds, 48 * 60, "minuto confirmado");
});

test("o minuto retido NÃO avança com o relógio local", () => {
  const depois = resolveFeaturedMatchState({ observed: null, retained: RETAINED, sourceOk: false, now: NOW + 10 * 60000 });
  eq(depois.match.clockSeconds, 48 * 60,
    "o minuto avançou sem confirmação da fonte — invenção de tempo de futebol");
});

// ─── Transições terminais: só evidência POSITIVA tira o hero ────────────────────────────────
console.log("\nTransições terminais (evidência positiva):");

test("H. FINAL observado → transição determinística", () => {
  const fim = { ...T2, state: "post", completed: true };
  const r = resolveFeaturedMatchState({ observed: fim, retained: RETAINED, now: NOW });
  eq(r.state, FEATURED.FINAL, "final observado não transicionou");
});

test("I. ADIADO observado → POSTPONED", () => {
  const ad = { ...T2, postponed: true };
  eq(resolveFeaturedMatchState({ observed: ad, retained: RETAINED, now: NOW }).state, FEATURED.POSTPONED, "estado");
});

test("SUSPENSO observado → SUSPENDED", () => {
  const su = { ...T2, suspended: true };
  eq(resolveFeaturedMatchState({ observed: su, retained: RETAINED, now: NOW }).state, FEATURED.SUSPENDED, "estado");
});

test("FINAL NUNCA é inferido pela passagem do tempo", () => {
  // 3 horas depois, sem nenhuma observação terminal: o correto é DESCONHECIDO, jamais "acabou".
  const r = resolveFeaturedMatchState({ observed: null, retained: RETAINED, sourceOk: false, now: NOW + 3 * 3600_000 });
  assert(r.state !== FEATURED.FINAL,
    "inferiu FINAL só porque o tempo passou — inventaria um resultado que ninguém confirmou");
  eq(r.state, FEATURED.UNKNOWN, "deveria degradar para desconhecido");
});

// ─── Fronteiras exatas do TTL ───────────────────────────────────────────────────────────────
console.log("\nFronteira do TTL (sem ambiguidade de off-by-one):");

const at = (age) => resolveFeaturedMatchState({
  observed: null, retained: { match: T2, confirmedAt: NOW - age }, sourceOk: false, now: NOW });

test("TTL − 1ms → ainda retido", () => eq(at(RETENTION_TTL_MS - 1).state, FEATURED.LIVE_RETAINED, "estado"));
test("TTL exato → ainda retido (limite INCLUSIVO)", () => eq(at(RETENTION_TTL_MS).state, FEATURED.LIVE_RETAINED, "estado"));
test("TTL + 1ms → expira", () => eq(at(RETENTION_TTL_MS + 1).state, FEATURED.UNKNOWN, "estado"));
test("na expiração NÃO fabrica resultado nem mantém 'ao vivo'", () => {
  const r = at(RETENTION_TTL_MS + 1);
  eq(r.match, null, "manteve uma partida no ar depois do TTL");
  eq(r.reason, "RETENTION_EXPIRED", "motivo precisa ser legível por máquina");
});

// ─── Monotonicidade (multi-aba) ─────────────────────────────────────────────────────────────
console.log("\nMonotonicidade entre abas:");

test("observação MAIS NOVA vence a mais antiga", () => {
  const antiga = { match: { ...T2, clockSeconds: 48 * 60 }, confirmedAt: NOW - 300_000 };
  const nova = { ...T2, clockSeconds: 51 * 60 };
  const r = resolveFeaturedMatchState({ observed: nova, retained: antiga, now: NOW });
  eq(r.match.clockSeconds, 51 * 60, "a aba com dado mais novo perdeu para a mais velha");
});

test("cache mais NOVO não é sobrescrito por observação ausente", () => {
  const recente = { match: { ...T2, clockSeconds: 51 * 60 }, confirmedAt: NOW - 1000 };
  const r = resolveFeaturedMatchState({ observed: null, retained: recente, sourceOk: false, now: NOW });
  eq(r.match.clockSeconds, 51 * 60, "regrediu para um estado anterior");
});

// ─── Contratos de integração ────────────────────────────────────────────────────────────────
console.log("\nContrato de integração:");

const brSrc = readFileSync(join(ROOT, "bolao/br2026/js/app.js"), "utf8");

test("CONTRATO: o hero NÃO é mais decidido por `_liveMatches.length` sozinho", () => {
  assert(/resolveFeaturedMatchState\(/.test(brSrc),
    "o app voltou a decidir a visibilidade do hero pela observação atual e nada mais");
  assert(!/if \(!_liveMatches\.length\) \{ card\.classList\.add\("hidden"\); return; \}/.test(brSrc),
    "o atalho frágil voltou ao código");
});

test("CONTRATO: falha de fonte é distinguida de 'não há jogo'", () => {
  assert(/_snapshotOk\s*=\s*false/.test(brSrc),
    "sem esta distinção, um fetch que falha e um domingo sem jogo produzem o mesmo estado");
});

test("CONTRATO: cache de resiliência em sessionStorage, sem dado privado", () => {
  assert(/sessionStorage\.setItem\(HERO_CACHE_KEY/.test(brSrc), "sumiu a persistência do último confirmado");
  const bloco = brSrc.slice(brSrc.indexOf("function writeRetainedHero"), brSrc.indexOf("function clearRetainedHero"));
  assert(!/email|participant|payer|cpf|telefone/i.test(bloco),
    "dado de participante entrou no cache de apresentação");
});

test("CONTRATO: estado do hero é observável no DOM (diagnóstico em <1 min)", () => {
  for (const k of ["heroState", "heroReason", "heroRetained"]) {
    assert(new RegExp(`dataset\\.${k}`).test(brSrc), `sumiu \`data-${k}\` — o diagnóstico volta a exigir reprodução`);
  }
});

test("CONTRATO: a marca de atraso aparece quando o estado veio da retenção", () => {
  assert(/_clockStale \|\| _heroRetained/.test(brSrc),
    "estado retido seria exibido como se fosse deste segundo");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE HERO RELIABILITY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
