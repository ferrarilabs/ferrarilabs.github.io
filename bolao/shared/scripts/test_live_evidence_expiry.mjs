/**
 * test_live_evidence_expiry.mjs — evidência ao vivo tem prazo (incidente 2026-09-02/03).
 *
 * ─── O QUE ACONTECEU ────────────────────────────────────────────────────────────────────────
 *
 * `bolao_provider_snapshot.yml` parou às 22:44:17Z com Flamengo × Mirassol no 14'. O snapshot
 * commitado congelou com `state:"in"` e passou a ser re-servido como observação NOVA a cada
 * carregamento. 829 minutos depois a produção ainda estampava:
 *
 *     Flamengo 0 × 0 Mirassol · AO VIVO · 14:00 · "Atualização atrasada · há 829 min"
 *
 * O jogo terminara 2 × 0 na véspera. Um navegador LIMPO reproduzia — não era retenção de
 * cliente, era a fonte afirmando "in" para sempre e ninguém checando a idade da afirmação.
 *
 * A página CALCULAVA e IMPRIMIA "há 829 min" e mesmo assim dizia AO VIVO: a idade existia, só
 * não participava da decisão.
 *
 * ─── O QUE ESTE GATE PROVA ──────────────────────────────────────────────────────────────────
 *
 * Que a idade participa da decisão, nas duas camadas onde ela pode ser ignorada, e que os três
 * conceitos continuam distintos: FINAL, LIVE e UNKNOWN. Idade NUNCA vira FINAL.
 *
 * Hermético: sem rede, sem provedor, sem participante.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const carregar = (p) => { const r = {}; new Function("window", readFileSync(join(RAIZ, p), "utf8")).call(r, r); return r; };

const LC = carregar("bolao/shared/js/live_clock.js").BOLAO_LIVE_CLOCK;
const STORE = carregar("bolao/shared/js/football_live_store.js").BOLAO_FOOTBALL_LIVE;
const HERO_M = carregar("bolao/shared/js/football_hero_state.js").BOLAO_FOOTBALL_HERO;
const { HERO } = HERO_M;

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

// A partida REAL do incidente, como o snapshot congelado a descrevia.
const KICKOFF = "2026-09-02T22:30:00Z";
const T0 = Date.parse("2026-09-02T22:44:31Z");   // generatedAt real do snapshot
const flamengo = (observedAt = T0) => ({
  id: "401913077", state: "in", statusName: "STATUS_FIRST_HALF",
  homeTeam: "Flamengo", awayTeam: "Mirassol", homeScore: 0, awayScore: 0,
  clockStr: "14'", period: 1, kickoff: KICKOFF,
  observedAt: new Date(observedAt).toISOString(),
});
const min = (n) => n * 60_000;

console.log("\nEvidência ao vivo tem prazo — incidente 2026-09-02/03\n");
console.log("A. Limiares vêm do contrato compartilhado, não são números soltos");

test("LIVE_EVIDENCE_MAX_AGE_MS === CRITICAL_STALE_AFTER_MS do store (não podem divergir)", () => {
  A(LC.LIVE_EVIDENCE_MAX_AGE_MS === STORE.CRITICAL_STALE_AFTER_MS,
    `live_clock=${LC.LIVE_EVIDENCE_MAX_AGE_MS} vs store=${STORE.CRITICAL_STALE_AFTER_MS} — ` +
    "dois limiares para a mesma pergunta sempre discordam");
});

test("o horizonte de apito cobre prorrogação + pênaltis + atraso (4 h)", () => {
  A(LC.KICKOFF_LIVE_HORIZON_MS === 4 * 60 * 60_000, `horizonte = ${LC.KICKOFF_LIVE_HORIZON_MS}`);
  // 90 + 15 intervalo + ~10 acréscimos + 35 prorrogação + ~15 pênaltis ≈ 165 min. O horizonte
  // tem de ficar FOLGADAMENTE acima disso, ou apagaria da tela justamente a decisão por pênaltis.
  A(LC.KICKOFF_LIVE_HORIZON_MS > min(165) + min(30),
    "horizonte apertado demais: uma final com pênaltis e atraso seria suprimida");
});

console.log("\nB. Fronteira, ao milissegundo");

const casos = [
  ["fresco (0 min)",                        0,                                   true],
  ["atrasado mas utilizável (15 min)",      min(15),                             true],
  ["1 ms ANTES do limiar crítico",          LC.LIVE_EVIDENCE_MAX_AGE_MS - 1,     true],
  ["EXATAMENTE no limiar crítico",          LC.LIVE_EVIDENCE_MAX_AGE_MS,         true],
  ["1 ms DEPOIS do limiar crítico",         LC.LIVE_EVIDENCE_MAX_AGE_MS + 1,     false],
  ["2 horas",                               min(120),                            false],
  ["829 min (o incidente real)",            min(829),                            false],
];

for (const [rotulo, idade, esperadoAoVivo] of casos) {
  test(`${rotulo} ⇒ afirmação ao vivo ${esperadoAoVivo ? "SUSTENTADA" : "RETIRADA"}`, () => {
    const agora = T0 + idade;
    const r = LC.resolveFeaturedMatchState({ observed: flamengo(), retained: null, sourceOk: true, now: agora });
    if (esperadoAoVivo) {
      A(r.state === LC.FEATURED.LIVE_CONFIRMED, `esperava LIVE_CONFIRMED, veio ${r.state}`);
    } else {
      A(r.state !== LC.FEATURED.LIVE_CONFIRMED && r.state !== LC.FEATURED.LIVE_RETAINED,
        `${idade / 60000} min de idade ainda produz "${r.state}" — é a afirmação desonesta do incidente`);
      A(r.state === LC.FEATURED.UNKNOWN, `esperava UNKNOWN, veio ${r.state}`);
      A(r.match === null, "o placar velho não pode viajar junto como se fosse atual");
    }
  });
}

console.log("\nC. UNKNOWN != FINAL, e terminal declarado pela fonte manda");

test("idade NUNCA converte em FINAL — não se inventa resultado", () => {
  const r = LC.resolveFeaturedMatchState({ observed: flamengo(), retained: null, sourceOk: true, now: T0 + min(829) });
  A(r.state !== LC.FEATURED.FINAL, "a passagem do tempo concluiu que a partida acabou — isso é invenção");
  A(r.reason === "LIVE_EVIDENCE_EXPIRED" || r.reason === "KICKOFF_HORIZON_EXCEEDED", `motivo opaco: ${r.reason}`);
});

test("FINAL explícito continua FINAL, com qualquer idade", () => {
  const m = { ...flamengo(), state: "post", completed: true, homeScore: 2, awayScore: 0 };
  const r = LC.resolveFeaturedMatchState({ observed: m, retained: null, sourceOk: true, now: T0 + min(829) });
  A(r.state === LC.FEATURED.FINAL, `esperava FINAL, veio ${r.state}`);
});

test("POSTPONED / SUSPENDED mantêm semântica própria, não viram UNKNOWN genérico", () => {
  for (const [campo, esperado] of [["postponed", LC.FEATURED.POSTPONED], ["suspended", LC.FEATURED.SUSPENDED]]) {
    const m = { ...flamengo(), [campo]: true };
    const r = LC.resolveFeaturedMatchState({ observed: m, retained: null, sourceOk: true, now: T0 + min(829) });
    A(r.state === esperado, `${campo}: esperava ${esperado}, veio ${r.state}`);
  }
});

console.log("\nD. Horizonte de apito — o modo de falha OPOSTO (timestamp fresco, estado preso em 'in')");

test("observação FRESCA mas apito há 5 h ⇒ afirmação retirada", () => {
  const agora = Date.parse(KICKOFF) + 5 * 60 * 60_000;
  const r = LC.resolveFeaturedMatchState({
    observed: flamengo(agora - min(1)), retained: null, sourceOk: true, now: agora });
  A(r.state !== LC.FEATURED.LIVE_CONFIRMED,
    "produtor publicando timestamp fresco com estado preso em 'in' passaria despercebido");
  A(r.reason === "KICKOFF_HORIZON_EXCEEDED", `motivo: ${r.reason}`);
});

test("observação fresca e apito há 3 h (prorrogação + pênaltis plausíveis) ⇒ SEGUE ao vivo", () => {
  const agora = Date.parse(KICKOFF) + 3 * 60 * 60_000;
  const r = LC.resolveFeaturedMatchState({
    observed: flamengo(agora - min(1)), retained: null, sourceOk: true, now: agora });
  A(r.state === LC.FEATURED.LIVE_CONFIRMED,
    "o horizonte não pode apagar uma decisão por pênaltis legítima");
});

test("sem carimbo de observação, o comportamento anterior é preservado (não se inventa idade)", () => {
  const m = { id: "x", homeTeam: "A", awayTeam: "B", state: "in" };
  const r = LC.resolveFeaturedMatchState({ observed: m, retained: null, sourceOk: true, now: T0 });
  A(r.state === LC.FEATURED.LIVE_CONFIRMED, `esperava LIVE_CONFIRMED, veio ${r.state}`);
});

console.log("\nE. Política do hero — a camada que contradizia o contrato");

test("LIVE_CRITICAL_STALE não pode render estado ao vivo", () => {
  const r = HERO_M.deriveFootballHeroState({
    liveState: "LIVE_CRITICAL_STALE", liveMatches: [flamengo()], sourceOk: true, now: T0 + min(829) });
  A(r.state !== HERO.LIVE_FRESH && r.state !== HERO.LIVE_DELAYED, `hero disse "${r.state}"`);
  A(r.visible === true, "o hero tem de continuar montado — invariante do #246");
  A(r.matches.length === 0, "o placar velho não pode continuar apresentado");
});

test("com próxima partida conhecida, cai no calendário LOCAL (fallback informativo)", () => {
  const r = HERO_M.deriveFootballHeroState({
    liveState: "LIVE_CRITICAL_STALE", liveMatches: [flamengo()],
    nextMatch: { id: "9", homeTeam: "Bahia", awayTeam: "Vitória", kickoff: "2026-09-05T19:00:00Z" },
    sourceOk: true, now: T0 + min(829) });
  A(r.state === HERO.UPCOMING, `esperava UPCOMING, veio ${r.state}`);
  A(r.degraded === true, "a degradação tem de continuar declarada");
});

console.log("\nF. Controles negativos — a mutação que reintroduz o defeito precisa MORDER");

test("mutante 'observação nunca expira' reprova a fronteira de 829 min", () => {
  const mutante = (m, now) => ({ ok: true });   // comportamento de ANTES do patch
  const idade = min(829);
  A(mutante(flamengo(), T0 + idade).ok === true,
    "controle de sanidade: o mutante representa mesmo o comportamento antigo");
  // A prova real: a implementação de verdade REPROVA o que o mutante aprova.
  A(LC.liveClaimSupported(flamengo(), T0 + idade).ok === false,
    "a implementação aceita 829 min — o defeito do incidente voltaria a passar verde");
});

test("mutante 'LIVE_CRITICAL_STALE ⇒ LIVE_DELAYED' (a expectativa antiga) é detectável", () => {
  const r = HERO_M.deriveFootballHeroState({
    liveState: "LIVE_CRITICAL_STALE", liveMatches: [flamengo()], sourceOk: true, now: T0 });
  A(r.state !== HERO.LIVE_DELAYED,
    "voltou a mapear crítico-obsoleto para LIVE_DELAYED — era exatamente o que o teste antigo exigia");
});

test("a fonte declara o limiar no PRÓPRIO código, não em prosa de teste", () => {
  const src = readFileSync(join(RAIZ, "bolao/shared/js/live_clock.js"), "utf8");
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map(l => l.split("//")[0]).join("\n");
  A(/liveClaimSupported/.test(codigo), "o guard sumiu de live_clock.js");
  A(/LIVE_EVIDENCE_EXPIRED/.test(codigo), "o motivo de expiração sumiu — o log ficaria mudo");
  A(/KICKOFF_HORIZON_EXCEEDED/.test(codigo), "o guard de horizonte sumiu");
  A(/terminalState\(observed\)/.test(codigo), "o terminal declarado deixou de vir antes dos guards");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ LIVE EVIDENCE EXPIRY FAILED" : "✓ LIVE EVIDENCE EXPIRY OK");
process.exit(fail ? 1 : 0);
