#!/usr/bin/env node
/**
 * SEMÂNTICA DO RELÓGIO AO VIVO — matriz de estados, com a reprodução exata do print do Eduardo.
 *
 * FAMÍLIA DE REGRESSÃO, não bug isolado. Esta região do produto já quebrou de quatro formas
 * diferentes, cada uma "consertada" antes da seguinte aparecer:
 *
 *   1. relógio disparava sozinho (interpolava com o relógio local indefinidamente);
 *   2. relógio congelava e PARECIA ao vivo (capado, mas sem dizer que era antigo);
 *   3. workflow não commitava o snapshot → nunca chegava dado novo;
 *   4. cron cego das 06:00 às 16:00 UTC → nada rodava no horário do jogo;
 *   5. e agora: passado o teto, a mensagem de atraso SUBSTITUÍA o minuto confirmado.
 *
 * O padrão é sempre o mesmo: alguém trata "não sei se ainda é 48'" como "não sei nada". São
 * perguntas diferentes, e esta suíte trava as três separadamente:
 *
 *   A. a partida está ao vivo?          → a fonte declara; não expira
 *   B. qual o último minuto confirmado?  → fato observado; não expira
 *   C. há quanto tempo não observamos?   → só isto envelhece
 *
 * Uso: node bolao/scripts/audit_live_clock_semantics.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHARED = join(ROOT, "bolao", "shared", "js", "live_clock.js");

// Carrega o módulo compartilhado exatamente como o navegador carrega: script global.
const sandbox = {};
new Function("globalThis", "window", readFileSync(SHARED, "utf8")).call(sandbox, sandbox, undefined);
const { resolveLiveClock, clockFeedConsistency, STATE } = sandbox.BOLAO_LIVE_CLOCK;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const NOW = 1_800_000_000_000;
const MAX = 180_000; // 3 min
const min = (n) => n * 60;

console.log("\nSemântica do relógio ao vivo (matriz de estados)\n");

// ─── A REPRODUÇÃO EXATA DO PRINT ────────────────────────────────────────────────────────────
console.log("Reprodução do print de produção (Cruzeiro 1×1 Mirassol):");

const PRINT = {
  clockSeconds: min(48),          // 48' confirmado pela fonte
  period: 2,
  pollTime: NOW - 15 * 60 * 1000, // observado há 15 minutos — bem além do teto
  isHalftime: false, isPenalties: false, clockPaused: false, isFinal: false,
};

test("o minuto confirmado (48') NÃO desaparece quando a observação envelhece", () => {
  const r = resolveLiveClock(PRINT, { now: NOW, maxInterpolationMs: MAX });
  assert(r.seconds != null, "o relógio ficou sem valor — é exatamente o bug do print");
  eq(Math.floor(r.seconds / 60), 48, "o minuto exibido não é o último confirmado");
});

test("e ele fica marcado como ATRASADO, não apresentado como se fosse deste segundo", () => {
  const r = resolveLiveClock(PRINT, { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.LIVE_STALE, "estado errado");
  eq(r.stale, true, "o atraso não foi sinalizado — o número pareceria ao vivo");
});

test("o relógio local NÃO inventa minuto: 15 min locais não viram 63'", () => {
  const r = resolveLiveClock(PRINT, { now: NOW, maxInterpolationMs: MAX });
  eq(Math.floor(r.seconds / 60), 48,
    "o minuto avançou com o relógio local depois da fonte parar — invenção de tempo");
  eq(r.usesConfirmedOnly, true);
});

test("CONSISTÊNCIA: feed com lance aos 48' + relógio sem valor = contradição detectada", () => {
  // O formato exato do bug relatado. O feed não é autoridade de relógio, mas é sinal de que a
  // resolução falhou: a tela tinha o dado e não o mostrava.
  const quebrado = { state: STATE.UNKNOWN, seconds: null };
  const c = clockFeedConsistency(quebrado, [26, 27, 48]);
  assert(c, "a contradição do print não seria detectada");
  eq(c.feedMinute, 48, "minuto do feed errado");
});

test("CONSISTÊNCIA: feed com lances + relógio congelado no 48' = consistente", () => {
  const r = resolveLiveClock(PRINT, { now: NOW, maxInterpolationMs: MAX });
  eq(clockFeedConsistency(r, [26, 27, 48]), null, "estado correto acusado como contraditório");
});

// ─── MATRIZ DE ESTADOS ──────────────────────────────────────────────────────────────────────
console.log("\nMatriz de estados:");

test("LIVE_FRESH: observação recente interpola a partir do confirmado", () => {
  const r = resolveLiveClock(
    { clockSeconds: min(30), pollTime: NOW - 40_000, period: 1 },
    { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.LIVE_FRESH);
  eq(r.stale, false);
  eq(Math.floor(r.seconds / 60), 30, "40s de interpolação não deveriam virar outro minuto");
  assert(r.seconds > min(30), "não interpolou nada estando fresco");
});

test("INTERVALO é estado declarado — dado velho NÃO o transforma em desconhecido", () => {
  const r = resolveLiveClock(
    { isHalftime: true, clockSeconds: min(45), pollTime: NOW - 60 * 60 * 1000 },
    { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.HALFTIME, "intervalo virou outro estado só por ser observação antiga");
});

test("INTERVALO não continua incrementando", () => {
  const a = resolveLiveClock({ isHalftime: true, clockSeconds: min(45), pollTime: NOW - 1000 }, { now: NOW, maxInterpolationMs: MAX });
  const b = resolveLiveClock({ isHalftime: true, clockSeconds: min(45), pollTime: NOW - 1000 }, { now: NOW + 600_000, maxInterpolationMs: MAX });
  eq(a.seconds, b.seconds, "o relógio andou durante o intervalo");
});

test("PÊNALTIS também é estado declarado e sobrevive a dado velho", () => {
  const r = resolveLiveClock(
    { isPenalties: true, clockSeconds: min(120), pollTime: NOW - 60 * 60 * 1000 },
    { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.PENALTIES);
});

test("SEGUNDO TEMPO usa o valor da fonte, sem somar 45 de novo", () => {
  // O deslocamento duplo de 45 minutos é um erro clássico: a fonte já entrega o minuto absoluto.
  const r = resolveLiveClock(
    { clockSeconds: min(52), period: 2, pollTime: NOW - 5000 },
    { now: NOW, maxInterpolationMs: MAX });
  eq(Math.floor(r.seconds / 60), 52, "o minuto do 2º tempo foi deslocado indevidamente");
});

test("FINAL: sem timer, sem aviso de atraso, placar congelado", () => {
  const r = resolveLiveClock(
    { isFinal: true, clockSeconds: min(90), pollTime: NOW - 24 * 60 * 60 * 1000 },
    { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.FINAL);
  eq(r.stale, false, "jogo encerrado não pode sugerir que ainda pode mudar");
  eq(r.usesConfirmedOnly, true);
});

test("RELÓGIO PAUSADO pela fonte (VAR/atendimento) não interpola, mas não é atraso", () => {
  const r = resolveLiveClock(
    { clockSeconds: min(33), clockPaused: true, pollTime: NOW - 30_000 },
    { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.LIVE_FRESH);
  eq(r.seconds, min(33), "interpolou apesar de a fonte dizer que o relógio está parado");
  eq(r.stale, false);
});

test("UNKNOWN só quando NÃO há minuto confirmado NEM estado declarado", () => {
  const r = resolveLiveClock({ pollTime: NOW - 60 * 60 * 1000 }, { now: NOW, maxInterpolationMs: MAX });
  eq(r.state, STATE.UNKNOWN, "este é o único caso em que a mensagem genérica pode substituir tudo");
  eq(r.seconds, null);
});

test("dado velho COM minuto confirmado nunca cai em UNKNOWN", () => {
  const r = resolveLiveClock(
    { clockSeconds: min(12), pollTime: NOW - 10 * 60 * 60 * 1000 },
    { now: NOW, maxInterpolationMs: MAX });
  assert(r.state !== STATE.UNKNOWN,
    "voltou a tratar 'não sei se ainda é 12' como 'não sei nada' — é o bug do print de novo");
});

// ─── FRONTEIRA DO LIMIAR (< vs <=) ──────────────────────────────────────────────────────────
console.log("\nFronteira exata do limiar de frescor:");

const at = (ageMs) => resolveLiveClock(
  { clockSeconds: min(20), pollTime: NOW - ageMs }, { now: NOW, maxInterpolationMs: MAX });

test("teto − 1s: ainda fresco", () => eq(at(MAX - 1000).state, STATE.LIVE_FRESH, "estado na borda inferior"));
test("teto exato: ainda fresco (limite é EXCLUSIVO)", () => eq(at(MAX).state, STATE.LIVE_FRESH, "estado no limite"));
test("teto + 1s: atrasado", () => eq(at(MAX + 1000).state, STATE.LIVE_STALE, "estado na borda superior"));
test("a transição acontece UMA vez, não oscila", () => {
  const antes = at(MAX).state, depois = at(MAX + 1);
  assert(antes === STATE.LIVE_FRESH && depois.state === STATE.LIVE_STALE, "borda inconsistente");
});

// ─── CONTRATO: os apps usam o módulo compartilhado, não uma cópia ───────────────────────────
console.log("\nContrato cross-app:");

for (const app of ["br2026", "cdb2026"]) {
  test(`[${app}] delega a decisão ao módulo compartilhado`, () => {
    const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
    assert(/BOLAO_LIVE_CLOCK\.resolveLiveClock/.test(src),
      "voltou a decidir localmente — os dois apps já divergiram exatamente assim antes");
    assert(!/observationTooOld\s*&&\s*!\w+\.clockPaused\s*\?\s*t\("liveClockStale"\)/.test(src),
      "o padrão que APAGAVA o minuto confirmado voltou ao código");
  });
  test(`[${app}] carrega o módulo compartilhado no HTML`, () => {
    const html = readFileSync(join(ROOT, "bolao", app, "index.html"), "utf8");
    assert(/shared\/js\/live_clock\.js/.test(html), "o script compartilhado não é carregado");
  });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ LIVE CLOCK SEMANTICS FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
