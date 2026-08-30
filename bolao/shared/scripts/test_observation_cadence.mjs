/**
 * test_observation_cadence.mjs — o teto de interpolação é medido contra quem ESCREVE (Issue #379).
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────────────────────
 *
 * Em 2026-08-30, com dois jogos do Brasileirão ao vivo e o pipeline perfeitamente saudável, o
 * relógio do hero congelava e a tela dizia `Atualização atrasada · há 4 min` — em ciclo, umas
 * duas vezes a cada cinco minutos. Medido em produção:
 *
 *     idade da observação  49 s  →  relógio 74:16 → 74:28 (anda), sem selo
 *     idade da observação 237 s  →  relógio 73:00 → 73:00 (congelado), selo "há 4 min"
 *
 * O teto de interpolação era `3 × intervalo de poll do CLIENTE` = 180 s. Mas quem limita o
 * frescor da observação, desde a virada para o produtor agendado pelo Cloudflare (#369), é a
 * cadência do PRODUTOR: de cinco em cinco minutos. Buscar de minuto em minuto não torna o dado
 * mais novo — o cliente relia o mesmo `observedAt`.
 *
 * Resultado: TODA janela normal passava ~2 dos 5 minutos acima do teto. O app chamava de atraso
 * o que era cadência. Alarme em operação normal é ruído, e ruído ensina o participante a ignorar
 * o alarme justamente quando ele é verdadeiro.
 *
 * ─── O INVARIANTE ───────────────────────────────────────────────────────────────────────────
 *
 *   O teto de interpolação é medido contra a cadência de OBSERVAÇÃO (quem escreve), nunca contra
 *   o intervalo de poll (quem lê).
 *
 * Este gate prova os dois lados: dentro da cadência normal o relógio CORRE e não há atraso;
 * acima dela o atraso é real, o relógio CONGELA no último confirmado e isso é dito. Silenciar o
 * atraso verdadeiro seria trocar um defeito por outro.
 *
 * Determinístico e hermético: sem rede, sem browser, `now` injetado.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLOCK_SRC = readFileSync(join(ROOT, "bolao/shared/js/live_clock.js"), "utf8");

function carregar(fonte) {
  const escopo = {};
  new Function("globalThis", "window", fonte).call(escopo, escopo, escopo);
  return escopo.BOLAO_LIVE_CLOCK;
}

const LC = carregar(CLOCK_SRC);
const S = LC.STATE;

let ok = 0, fail = 0;
function test(nome, fn) {
  try { fn(); console.log(`  ✓ ${nome}`); ok++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const AGORA = Date.parse("2026-08-30T20:40:00Z");
const s = (n) => n * 1000;

/** Partida ao vivo observada aos 73', que é exatamente o caso medido em produção. */
function aoVivo(idadeMs) {
  return { clockSeconds: 4380, clockStr: "73'", period: 2, pollTime: AGORA - idadeMs };
}

console.log("\n#379 — o teto de interpolação segue quem ESCREVE, não quem lê\n");
console.log("A. Dentro da cadência normal do produtor o relógio CORRE:");

// A cadência é de 5 min; a folga cobre a duração do run e o jitter do agendador. Os pontos abaixo
// varrem a janela inteira, incluindo o valor exato que reproduziu o defeito em produção (237 s).
for (const idade of [0, 30, 49, 120, 179, 181, 237, 299, 300, 350, LC.MAX_INTERPOLATION_MS]) {
  test(`observação de ${Math.round(idade / 1000)}s: relógio ao vivo, sem atraso`, () => {
    const r = LC.resolveLiveClock(aoVivo(idade), { now: AGORA });
    assert(r.state === S.LIVE_FRESH, `estado ${r.state} — em cadência normal não há atraso`);
    assert(r.stale === false, "marcou atraso dentro da cadência normal");
    assert(r.seconds === 4380 + Math.floor(idade / 1000),
           `relógio congelado em ${r.seconds}: a interpolação parou dentro da janela normal`);
  });
}

test("REGRESSÃO da produção: aos 237s o relógio ANDA (antes congelava em 73:00)", () => {
  const a = LC.resolveLiveClock(aoVivo(s(237)), { now: AGORA });
  const b = LC.resolveLiveClock(aoVivo(s(237)), { now: AGORA + s(12) });
  assert(a.stale === false && b.stale === false, "selo de atraso voltou na cadência normal");
  assert(b.seconds > a.seconds,
         `relógio parado: ${a.seconds} → ${b.seconds}. Foi exatamente isto na tela do Eduardo`);
});

console.log("\nB. Acima da cadência o atraso é REAL — e continua sendo dito:");

test("bem acima da cadência: congela no confirmado e declara atraso", () => {
  const r = LC.resolveLiveClock(aoVivo(s(600)), { now: AGORA });
  assert(r.state === S.LIVE_STALE, `estado ${r.state}`);
  assert(r.stale === true, "atraso REAL silenciado — trocar um defeito por outro");
  assert(r.seconds === 4380, `inventou minuto novo (${r.seconds}) a partir de observação velha`);
});

test("fronteira: no teto ainda é fresco, um segundo depois é atraso", () => {
  const teto = LC.MAX_INTERPOLATION_MS;
  assert(LC.resolveLiveClock(aoVivo(teto), { now: AGORA }).stale === false, "no teto já marcou atraso");
  assert(LC.resolveLiveClock(aoVivo(teto + 1000), { now: AGORA }).stale === true,
         "passado o teto não marcou atraso");
});

test("o teto NUNCA deixa o relógio disparar além dele", () => {
  const r = LC.resolveLiveClock(aoVivo(s(3600)), { now: AGORA });
  assert(r.seconds === 4380, `interpolou ${r.seconds - 4380}s de uma observação de uma hora`);
});

console.log("\nC. A constante é derivada da cadência de OBSERVAÇÃO:");

test("o teto cobre a cadência do produtor mais folga", () => {
  assert(LC.OBSERVATION_CADENCE_MS === 5 * 60 * 1000,
         `cadência declarada ${LC.OBSERVATION_CADENCE_MS} não é a do cron do produtor`);
  assert(LC.MAX_INTERPOLATION_MS === LC.OBSERVATION_CADENCE_MS + LC.OBSERVATION_JITTER_MS,
         "o teto deixou de ser cadência + folga");
  assert(LC.MAX_INTERPOLATION_MS > LC.OBSERVATION_CADENCE_MS,
         "teto menor ou igual à cadência: TODO ciclo normal seria chamado de atraso");
});

test("os DOIS apps consomem o teto compartilhado, e nenhum recalcula pelo poll do cliente", () => {
  for (const app of ["br2026", "cdb2026"]) {
    const src = readFileSync(join(ROOT, `bolao/${app}/js/app.js`), "utf8");
    const m = src.match(/const \w*MAX_INTERPOLATION_MS = ([^;]+);/);
    assert(m, `${app}: constante de teto de interpolação não encontrada`);
    assert(/BOLAO_LIVE_CLOCK\.MAX_INTERPOLATION_MS/.test(m[1]),
           `${app}: teto derivado localmente (\`${m[1].trim()}\`) em vez do contrato compartilhado`);
    assert(!/poll/i.test(m[1]),
           `${app}: teto voltou a ser medido contra o intervalo de POLL do cliente — o defeito do #379`);
  }
});

console.log("\nD. Controles negativos — o gate tem de morder:");

test("controle negativo: voltar o teto para 3× o poll do cliente quebra o gate", () => {
  const mutado = CLOCK_SRC.replace(
    "var MAX_INTERPOLATION_MS = OBSERVATION_CADENCE_MS + OBSERVATION_JITTER_MS;",
    "var MAX_INTERPOLATION_MS = 3 * 60 * 1000;");
  assert(mutado !== CLOCK_SRC, "a mutação não encontrou o alvo — o controle negativo cegou");
  const M = carregar(mutado);
  const r = M.resolveLiveClock(aoVivo(s(237)), { now: AGORA });
  assert(r.stale === true,
         "a mutação não reintroduziu o defeito — o controle negativo perdeu o sentido");
});

test("controle negativo: silenciar o atraso REAL também quebra o gate", () => {
  const mutado = CLOCK_SRC.replace("var stale = ageMs > maxInterp;", "var stale = false;");
  assert(mutado !== CLOCK_SRC, "a mutação não encontrou o alvo — o controle negativo cegou");
  const M = carregar(mutado);
  const r = M.resolveLiveClock(aoVivo(s(600)), { now: AGORA });
  assert(r.stale === false && r.state !== S.LIVE_STALE,
         "a mutação não silenciou o atraso — o controle negativo perdeu o sentido");
});

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${ok} ok, ${fail} falhas\n`);
process.exit(fail === 0 ? 0 : 1);
