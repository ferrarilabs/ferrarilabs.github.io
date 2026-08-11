#!/usr/bin/env node
/**
 * CDB2026 — CONTAGEM REGRESSIVA DO SORTEIO OFICIAL DA CBF.
 *
 * POR QUE ESTA SUÍTE EXISTE: o Eduardo relata que a contagem regressiva do sorteio das quartas
 * "ainda não aparece". Investigado em 2026-08-09, a resposta honesta é:
 *
 *   **a CBF ainda não publicou a data.** `phases.quartas.officialDraw` é `null` em produção, e a
 *   página oficial continua sendo casca renderizada no cliente (53 KB, zero menção a "sorteio",
 *   "quartas" ou "confronto") — exatamente a caracterização do Batch 3.
 *
 * Sem data oficial, o app se recusa a inventar uma, e isso é o comportamento CORRETO: uma contagem
 * regressiva para uma data fabricada seria pior que nenhuma.
 *
 * O que esta suíte garante é a outra metade: **no instante em que a data for registrada, a
 * contagem aparece e se comporta certo em cada transição.** Sem isso, "não aparece" seria
 * ambíguo entre "falta o dado" e "está quebrado" — e essas duas coisas exigem ações opostas.
 *
 * IMPORTANTE — NÃO se confunde com o outro contador: existe também a contagem do CUTOFF de
 * palpites da fase. São coisas diferentes, com fontes diferentes (`cutoffAt` × `officialDraw
 * .scheduledAt`) e a suíte cobre a precedência entre elas.
 *
 * Uso: node bolao/cdb2026/scripts/test_draw_countdown.mjs
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
  ${decl(/const DRAW_LIFECYCLE = Object\.freeze\(\{[\s\S]*?\}\);/, "DRAW_LIFECYCLE")}
  ${decl(/const OFFICIAL_DRAW_REQUIRED_FIELDS = \[[^\]]*\];/, "REQUIRED")}
  ${extractFn("officialDrawProvenanceIsValid")}
  ${extractFn("drawLifecycle")}
  function t(k) { return k; }
  function esc(x) { return String(x); }
  ${extractFn("countdownTimerHtml")}
  return { DRAW_LIFECYCLE, drawLifecycle, countdownTimerHtml };
`)();
const { DRAW_LIFECYCLE: LC, drawLifecycle, countdownTimerHtml } = sb;

const H = 3600000, D = 86400000;
const stateWith = (quartas) => ({ phases: { quartas: { cutoffAt: null, ties: {}, ...quartas } } });
const iso = (ms) => new Date(ms).toISOString();

console.log("\nCDB2026 — contagem regressiva do sorteio oficial da CBF\n");

// ── O estado REAL de produção hoje ──────────────────────────────────────────
test("PRODUÇÃO HOJE: sem data oficial ⇒ WAITING, e NENHUMA contagem inventada", () => {
  const lc = drawLifecycle(stateWith({}), "quartas", Date.now());
  eq(lc.state, LC.WAITING, "estado errado sem data oficial");
  assert(lc.countdownMs == null, "apareceu contagem regressiva sem data oficial da CBF");
  assert(lc.scheduledAt == null, "apareceu data agendada do nada");
});

// ── Transições, na ordem em que acontecerão ─────────────────────────────────
test("data futura registrada ⇒ SCHEDULED com contagem positiva", () => {
  const now = Date.now();
  const lc = drawLifecycle(stateWith({
    officialDraw: { authority: "CBF", source: "cbf-publication", scheduledAt: iso(now + 2 * D) },
  }), "quartas", now);
  eq(lc.state, LC.SCHEDULED, "não entrou em SCHEDULED com data futura");
  assert(lc.countdownMs > 0, "contagem não é positiva");
  assert(Math.abs(lc.countdownMs - 2 * D) < 2000, "contagem não bate com a data marcada");
});

test("menos de 24h ⇒ ainda SCHEDULED, contagem em horas", () => {
  const now = Date.now();
  const lc = drawLifecycle(stateWith({
    officialDraw: { authority: "CBF", source: "cbf", scheduledAt: iso(now + 5 * H) },
  }), "quartas", now);
  eq(lc.state, LC.SCHEDULED, "mudou de estado abaixo de 24h");
  assert(lc.countdownMs > 0 && lc.countdownMs < D, "contagem fora da faixa de horas");
});

test("menos de 1h ⇒ ainda SCHEDULED", () => {
  const now = Date.now();
  const lc = drawLifecycle(stateWith({
    officialDraw: { authority: "CBF", source: "cbf", scheduledAt: iso(now + 20 * 60000) },
  }), "quartas", now);
  eq(lc.state, LC.SCHEDULED, "mudou de estado abaixo de 1h");
  assert(lc.countdownMs > 0, "contagem zerou antes da hora");
});

test("hora ATINGIDA ⇒ AWAITING_PUBLICATION, NUNCA contagem negativa", () => {
  // É o ponto que mais erra na prática: o relógio passa e o contador vira número negativo.
  const now = Date.now();
  const lc = drawLifecycle(stateWith({
    officialDraw: { authority: "CBF", source: "cbf", scheduledAt: iso(now - 10 * 60000) },
  }), "quartas", now);
  eq(lc.state, LC.AWAITING_PUBLICATION, "não transicionou ao passar da hora marcada");
  assert(!(lc.countdownMs > 0), "continuou contando depois da hora");
  assert(lc.countdownMs === 0 || lc.countdownMs == null, `contagem negativa/indevida: ${lc.countdownMs}`);
});

test("bracket ingerido ⇒ sai de AWAITING", () => {
  const now = Date.now();
  const lc = drawLifecycle(stateWith({
    ties: { "qf-1": { teamA: "A", teamB: "B" } },
    officialDraw: { authority: "CBF", source: "cbf", scheduledAt: iso(now - D),
                    ingestedAt: iso(now - H) },
  }), "quartas", now);
  assert(lc.state !== LC.AWAITING_PUBLICATION && lc.state !== LC.SCHEDULED,
    `com confronto ingerido o estado deveria avançar, veio ${lc.state}`);
});

test("bracket validado e completo ⇒ LOCKED, sem contagem", () => {
  const now = Date.now();
  const lc = drawLifecycle(stateWith({
    ties: { "qf-1": { teamA: "A", teamB: "B" } },
    officialDraw: { authority: "CBF", source: "cbf", scheduledAt: iso(now - D),
                    ingestedAt: iso(now - H), validatedAt: iso(now - H), bracketHash: "abc" },
  }), "quartas", now);
  eq(lc.state, LC.LOCKED, "não chegou a LOCKED com proveniência completa");
  assert(!(lc.countdownMs > 0), "contagem regressiva num bracket já travado");
});

// ── O renderizador do contador ──────────────────────────────────────────────
test("o contador nunca renderiza número negativo", () => {
  const out = countdownTimerHtml(-5000);
  assert(!/-\d/.test(out), `renderizou valor negativo: ${out}`);
});

test("o contador mostra dias quando faltam dias, e some com eles quando não faltam", () => {
  assert(/\d+/.test(countdownTimerHtml(2 * D + 3 * H)), "não renderizou nada com dias restantes");
  const semDias = countdownTimerHtml(3 * H);
  assert(semDias.length > 0, "não renderizou contador abaixo de um dia");
});

// ── Contrato de UI: a contagem do SORTEIO é diferente da do CUTOFF ──────────
test("CONTRATO: a UI usa o estado derivado do sorteio, não uma data inventada", () => {
  // Recorte por BALANCEAMENTO DE CHAVES, não por contagem de caracteres.
  //
  // Era `slice(i, i + 3000)`. Ao acrescentar o estado de prazo-pendente, as mensagens de espera
  // saíram da janela e o gate reprovou código correto, afirmando que a UI "perdeu as mensagens
  // honestas" — elas estavam lá, 300 caracteres adiante. Terceira vez que um recorte por posição
  // reprova o que deveria proteger; ancorar na estrutura da função não tem esse modo de falha.
  const _i = src.indexOf("function renderCountdown");
  let _d = 0, _started = false, _end = _i;
  for (let j = _i; j < src.length; j++) {
    if (src[j] === "{") { _d++; _started = true; }
    else if (src[j] === "}") { _d--; if (_started && _d === 0) { _end = j + 1; break; } }
  }
  const render = src.slice(_i, _end);
  assert(/drawLifecycle\(/.test(render), "a UI deixou de consultar o ciclo de vida do sorteio");
  assert(/DRAW_LIFECYCLE\.SCHEDULED/.test(render) && /countdownMs > 0/.test(render),
    "a UI não renderiza mais a contagem do sorteio agendado");
  assert(/drawAwaitingPublication/.test(render) && /drawWaiting/.test(render),
    "a UI perdeu as mensagens honestas de espera/publicação");
});

test("CONTRATO: só `register-official-draw`/`set-draw-schedule` criam data de sorteio", () => {
  // Uma data de sorteio que apareça por qualquer outro caminho seria data fabricada.
  assert(/case "set-draw-schedule"/.test(src), "sumiu a mutação de agendamento do sorteio");
  const mut = src.slice(src.indexOf('case "set-draw-schedule"'), src.indexOf('case "register-official-draw"'));
  assert(/authority: "CBF"/.test(mut), "o agendamento deixou de registrar a autoridade CBF");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ DRAW COUNTDOWN SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
