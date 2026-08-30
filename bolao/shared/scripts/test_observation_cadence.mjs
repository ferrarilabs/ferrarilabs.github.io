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
 * frescor da observação é a cadência do PRODUTOR. Buscar mais rápido do que a fonte escreve não
 * torna o dado mais novo — o cliente relia o mesmo `observedAt`.
 *
 * Resultado: TODA janela normal passava ~2 dos 5 minutos acima do teto. O app chamava de atraso
 * o que era cadência. Alarme em operação normal é ruído, e ruído ensina o participante a ignorar
 * o alarme justamente quando ele é verdadeiro.
 *
 * ─── E A CADÊNCIA MUDOU (#381) ──────────────────────────────────────────────────────────────
 *
 * O produtor deixou de fazer UMA observação por execução: o mesmo despacho de 5 em 5 minutos abre
 * um runner que observa a cada 15 s enquanto há jogo. Por isso este gate NÃO digita segundos —
 * todos os pontos são derivados das constantes. Uma tabela de números fixos teria virado mentira
 * silenciosa nessa mudança, que é o modo de falha que ele existe para impedir.
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

// Os pontos são DERIVADOS do teto, nunca digitados: a cadência de observação já mudou uma vez
// (#381 trocou uma observação por execução por um ciclo de 15 s dentro dela), e um teste com
// segundos fixos vira mentira silenciosa na próxima mudança. O que se prova é a REGRA — dentro do
// teto o relógio corre — e não uma tabela de números.
const TETO = LC.MAX_INTERPOLATION_MS;
for (const idade of [0, 1000, Math.floor(TETO / 4), Math.floor(TETO / 2),
                     Math.floor(TETO * 0.9), TETO - 1000, TETO]) {
  test(`observação de ${Math.round(idade / 1000)}s: relógio ao vivo, sem atraso`, () => {
    const r = LC.resolveLiveClock(aoVivo(idade), { now: AGORA });
    assert(r.state === S.LIVE_FRESH, `estado ${r.state} — em cadência normal não há atraso`);
    assert(r.stale === false, "marcou atraso dentro da cadência normal");
    assert(r.seconds === 4380 + Math.floor(idade / 1000),
           `relógio congelado em ${r.seconds}: a interpolação parou dentro da janela normal`);
  });
}

test("REGRESSÃO da produção: dentro da cadência o relógio ANDA (antes congelava)", () => {
  // O caso do Eduardo era uma observação de 237 s sendo chamada de atraso porque o produtor
  // escrevia de 5 em 5 min. Com o ciclo de 15 s (#381), 237 s deixou de ser cadência normal — o
  // que se preserva aqui é a REGRA, medida logo abaixo do teto vigente, qualquer que ele seja.
  // Metade do teto, de propósito: a SEGUNDA amostra é 12 s mais velha, e ela também precisa cair
  // dentro da janela normal. Ancorar em `TETO - 5s` faria a segunda amostra cruzar o teto e o
  // teste reprovaria comportamento correto.
  const idade = Math.floor(TETO / 2);
  const a = LC.resolveLiveClock(aoVivo(idade), { now: AGORA });
  const b = LC.resolveLiveClock(aoVivo(idade), { now: AGORA + s(12) });
  assert(a.stale === false, "selo de atraso dentro da cadência normal");
  assert(b.seconds > a.seconds,
         `relógio parado: ${a.seconds} → ${b.seconds}. Foi exatamente isto na tela do Eduardo`);
});

test("a observação típica do ciclo (1 volta de atraso) nunca é chamada de atraso", () => {
  // Uma volta perdida do ciclo é rotina; duas também. O teto tem de cobrir isso com folga, senão
  // o alarme volta a disparar em operação normal — que foi o defeito do #379.
  for (const voltas of [1, 2, 3]) {
    const r = LC.resolveLiveClock(aoVivo(LC.OBSERVATION_CADENCE_MS * voltas), { now: AGORA });
    assert(r.stale === false, `${voltas} volta(s) de ciclo ja marcam atraso`);
  }
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

test("o teto é cadência + folga, e a cadência é a do CICLO do produtor", () => {
  assert(LC.MAX_INTERPOLATION_MS === LC.OBSERVATION_CADENCE_MS + LC.OBSERVATION_JITTER_MS,
         "o teto deixou de ser cadência + folga");
  assert(LC.MAX_INTERPOLATION_MS > LC.OBSERVATION_CADENCE_MS * 3,
         "teto perto demais da cadência: duas voltas perdidas já virariam alarme em operação normal");
  // A folga existe para a TROCA de execução (despacho + checkout + setup), que é a maior lacuna
  // real entre duas observações. Menor que isso e todo intervalo entre runners vira "atrasado".
  assert(LC.OBSERVATION_JITTER_MS >= 60 * 1000,
         "folga menor que a troca de execução: o intervalo entre runners viraria alarme");
});

test("a cadência declarada bate com a que o produtor realmente pratica", () => {
  const prod = readFileSync(join(ROOT, "bolao/shared/scripts/produce_live_cache.mjs"), "utf8");
  const m = prod.match(/const LOOP_INTERVAL_MS = ([0-9_]+);/);
  assert(m, "intervalo do ciclo não encontrado no produtor");
  const real = Number(m[1].replace(/_/g, ""));
  assert(real === LC.OBSERVATION_CADENCE_MS,
         `produtor observa a cada ${real}ms mas o contrato declara ${LC.OBSERVATION_CADENCE_MS}ms — ` +
         `foi essa divergência (poll do cliente x cadência real) que produziu o #379`);
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
    "var MAX_INTERPOLATION_MS = 3 * 15 * 1000;");   // teto colado na cadência: o defeito do #379
  assert(mutado !== CLOCK_SRC, "a mutação não encontrou o alvo — o controle negativo cegou");
  const M = carregar(mutado);
  // Quatro voltas do ciclo (60 s): rotina sob o teto real (90 s), mas ACIMA do teto mutado
  // (3 × cadência = 45 s). É exatamente a faixa onde o defeito do #379 se manifestava.
  const r = M.resolveLiveClock(aoVivo(LC.OBSERVATION_CADENCE_MS * 4), { now: AGORA });
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
