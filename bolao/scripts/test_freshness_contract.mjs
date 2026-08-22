#!/usr/bin/env node
/**
 * CONTRATO DE FRESCOR — fronteiras exatas, fonte única e a proibição de rejuvenescer (Issue #296).
 *
 * ─── O QUE ESTA SUÍTE PROVA ─────────────────────────────────────────────────────────────────
 *
 * 1. As onze fronteiras exigidas pelo dono classificam exatamente como decidido — inclusive as
 *    duas que caem EM CIMA do limite (10 min e 30 min), onde o erro de "<" contra "<=" mora.
 * 2. Não existe segundo conjunto de limiares. O navegador não pode importar ESM (script clássico,
 *    GitHub Pages sem build), então ele carrega uma cópia — e este gate reprova se a cópia
 *    divergir do contrato. É a razão de a cópia ser aceitável.
 * 3. LER NÃO REJUVENESCE. Mil leituras seguidas não movem `observedAt`/`storedAt` um milissegundo,
 *    e a idade só anda para a frente com o relógio. Só uma observação nova do produtor avança o
 *    frescor.
 *
 * Nada aqui toca a rede nem depende do agendador do GitHub: o tempo é injetado (`now`) e o
 * transporte é injetado. Um teste que dependesse da latência real do GitHub seria justamente o
 * tipo de falso-verde intermitente que este repositório já pagou caro.
 *
 * Uso: node bolao/scripts/test_freshness_contract.mjs
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  FRESH_MAX_AGE_MS, STALE_BUT_USABLE_MAX_AGE_MS,
  FRESHNESS, classifyFreshness, isServable, dataAgeMs,
} from "../../supabase/functions/_shared/freshness_contract.js";
import {
  resolveGatewayResponse, HEALTH, healthForFreshness, FRESH_TTL_MS,
} from "../../supabase/functions/_shared/gateway_core.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let pass = 0, fail = 0;
async function test(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); pass++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const cacheComIdade = (idadeMs) => ({
  payload: {
    schemaVersion: 1, competition: "br2026", provider: "espn",
    observedAt: new Date(NOW - idadeMs).toISOString(),
    servedAt: new Date(NOW - idadeMs).toISOString(),
    ageSeconds: 0, stale: false, staleReason: null,
    matches: [{ id: "ev1", state: "in", homeScore: 1, awayScore: 1, clockSec: 2880 }],
  },
  observedAt: new Date(NOW - idadeMs).toISOString(),
  storedAt: NOW - idadeMs,
});

const fonteFalha = (status) => async () => ({ ok: false, status, json: async () => ({}) });

console.log("\nContrato de frescor (Issue #296)\n");
console.log(`  FRESH <= ${FRESH_MAX_AGE_MS / MIN} min · STALE_BUT_USABLE <= ${STALE_BUT_USABLE_MAX_AGE_MS / MIN} min · além disso UNAVAILABLE\n`);

// ─── 1. As fronteiras exigidas, na função pura ──────────────────────────────────────────────
console.log("Fronteiras de classificação (decisão do dono, 2026-08-22):");

const FRONTEIRAS = [
  ["9 min                  -> FRESH",             9 * MIN,   FRESHNESS.FRESH],
  ["10 min (limite exato)  -> FRESH",            10 * MIN,   FRESHNESS.FRESH],
  ["11 min                 -> STALE_BUT_USABLE", 11 * MIN,   FRESHNESS.STALE_BUT_USABLE],
  ["25 min                 -> STALE_BUT_USABLE", 25 * MIN,   FRESHNESS.STALE_BUT_USABLE],
  ["30 min (limite exato)  -> STALE_BUT_USABLE", 30 * MIN,   FRESHNESS.STALE_BUT_USABLE],
  ["31 min                 -> UNAVAILABLE",      31 * MIN,   FRESHNESS.UNAVAILABLE],
  ["100 min                -> UNAVAILABLE",     100 * MIN,   FRESHNESS.UNAVAILABLE],
  ["sem cache              -> UNAVAILABLE",      Infinity,   FRESHNESS.UNAVAILABLE],
];

for (const [nome, idade, esperado] of FRONTEIRAS) {
  await test(nome, () => eq(classifyFreshness(idade), esperado, "classificação"));
}

await test("os limites são INCLUSIVOS dos dois lados (1ms além já vira o próximo estado)", () => {
  eq(classifyFreshness(FRESH_MAX_AGE_MS), FRESHNESS.FRESH, "10min exato");
  eq(classifyFreshness(FRESH_MAX_AGE_MS + 1), FRESHNESS.STALE_BUT_USABLE, "10min + 1ms");
  eq(classifyFreshness(STALE_BUT_USABLE_MAX_AGE_MS), FRESHNESS.STALE_BUT_USABLE, "30min exato");
  eq(classifyFreshness(STALE_BUT_USABLE_MAX_AGE_MS + 1), FRESHNESS.UNAVAILABLE, "30min + 1ms");
});

await test("idade ilegível JAMAIS cai em FRESH por omissão", () => {
  for (const ruim of [NaN, undefined, null, -1, "10", {}]) {
    eq(classifyFreshness(ruim), FRESHNESS.UNAVAILABLE, `entrada ${JSON.stringify(ruim)}`);
  }
});

// ─── 2. As mesmas fronteiras ATRAVÉS do gateway, com a fonte quebrada ───────────────────────
console.log("\nErro do provedor + cache: o rótulo vem da IDADE, não do desfecho do fetch:");

const CASOS_ERRO = [
  ["erro do provedor + cache de 8 min   -> FRESH",             8 * MIN, FRESHNESS.FRESH,            HEALTH.FRESH],
  ["erro do provedor + cache de 20 min  -> STALE_BUT_USABLE", 20 * MIN, FRESHNESS.STALE_BUT_USABLE, HEALTH.STALE],
  ["erro do provedor + cache de 40 min  -> UNAVAILABLE",      40 * MIN, FRESHNESS.UNAVAILABLE,      HEALTH.SOURCE_UNAVAILABLE],
];

for (const [nome, idade, freshEsperado, healthEsperado] of CASOS_ERRO) {
  await test(nome, async () => {
    const r = await resolveGatewayResponse({
      competition: "br2026", cached: cacheComIdade(idade), now: NOW, fetchRaw: fonteFalha(500),
    });
    eq(r.freshness, freshEsperado, "frescor");
    eq(r.health, healthEsperado, "health (alias de fio do mesmo estado)");
  });
}

await test("cache de 8 min com a fonte caída NÃO é rotulado como atrasado na UI", async () => {
  // O dado tem 8 minutos: é fresco de verdade. Antes desta issue, qualquer queda para o cache era
  // marcada `stale`, e a UI acendia aviso de atraso sobre um dado fresco.
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cacheComIdade(8 * MIN), now: NOW, fetchRaw: fonteFalha(503),
  });
  eq(r.payload.stale, false, "`stale` acende o aviso de atraso — não pode acender com dado fresco");
  eq(r.payload.sourceDegraded, true, "mas a falha da fonte NÃO pode sumir do relato");
});

await test("cache de 20 min vem rotulado como atrasado E com a idade utilizável", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cacheComIdade(20 * MIN), now: NOW, fetchRaw: fonteFalha(500),
  });
  eq(r.payload.stale, true, "precisa vir marcado para a UI identificar o atraso");
  eq(r.payload.ageSeconds, 20 * 60, "a UI precisa da idade para dizer 'há 20 min'");
  eq(r.payload.freshness, FRESHNESS.STALE_BUT_USABLE, "estado explícito no payload");
});

await test("cache de 40 min NÃO é apresentado como verdade ao vivo", async () => {
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cacheComIdade(40 * MIN), now: NOW, fetchRaw: fonteFalha(500),
  });
  eq(r.payload.matches, null, "serviu dado de 40 min como se fosse o jogo agora");
  eq(r.payload.status, "SOURCE_UNAVAILABLE", "contrato de fio preservado");
  eq(r.freshness, FRESHNESS.UNAVAILABLE, "frescor");
});

await test("dado velho NUNCA é promovido a fresco por uma tentativa de fetch que falhou", async () => {
  // A tentativa falhada não é observação. Se ela pudesse mexer no rótulo, um provedor fora do ar
  // "renovaria" o cache — exatamente a mentira que o dono proibiu.
  for (const idade of [11 * MIN, 25 * MIN, 30 * MIN]) {
    const r = await resolveGatewayResponse({
      competition: "br2026", cached: cacheComIdade(idade), now: NOW, fetchRaw: fonteFalha(500),
    });
    assert(r.freshness !== FRESHNESS.FRESH, `cache de ${idade / MIN} min virou FRESH`);
  }
});

// ─── 3. Ler não rejuvenesce ─────────────────────────────────────────────────────────────────
console.log("\nLer NÃO rejuvenesce (só o produtor avança o frescor):");

await test("mil leituras não movem observedAt/storedAt nem um milissegundo", async () => {
  const cache = cacheComIdade(20 * MIN);
  const antes = JSON.stringify(cache);
  for (let i = 0; i < 1000; i++) {
    await resolveGatewayResponse({ competition: "br2026", cached: cache, now: NOW, fetchRaw: fonteFalha(500) });
  }
  eq(JSON.stringify(cache), antes, "o gateway mutou o registro de cache ao lê-lo");
});

await test("nenhuma leitura pede gravação — só a observação nova e bem-formada pede", async () => {
  for (const idade of [1 * MIN, 8 * MIN, 20 * MIN, 40 * MIN]) {
    const r = await resolveGatewayResponse({
      competition: "br2026", cached: cacheComIdade(idade), now: NOW, fetchRaw: fonteFalha(500),
    });
    eq(r.shouldStore, false, `leitura de cache de ${idade / MIN} min pediu para gravar`);
  }
});

await test("a idade só ANDA com o relógio — ler de novo mais tarde envelhece, nunca renova", async () => {
  const cache = cacheComIdade(9 * MIN);
  const a = await resolveGatewayResponse({ competition: "br2026", cached: cache, now: NOW, fetchRaw: fonteFalha(500) });
  const b = await resolveGatewayResponse({ competition: "br2026", cached: cache, now: NOW + 3 * MIN, fetchRaw: fonteFalha(500) });
  eq(a.freshness, FRESHNESS.FRESH, "aos 9 min");
  eq(b.freshness, FRESHNESS.STALE_BUT_USABLE, "aos 12 min a segunda leitura tem de PIORAR");
  assert(b.ageSeconds > a.ageSeconds, "a idade não avançou entre leituras");
});

await test("gravação recente de observação VELHA não vira fresco pelo atalho de TTL", async () => {
  // Produtor atrasado grava agora uma observação de 40 min. `storedAt` é novo, `observedAt` não.
  // Classificar por `storedAt` faria a regravação parecer rejuvenescimento.
  const cache = cacheComIdade(40 * MIN);
  cache.storedAt = NOW - 1_000;             // gravado há 1s, dentro do TTL de 15s
  let foiAFonte = false;
  const r = await resolveGatewayResponse({
    competition: "br2026", cached: cache, now: NOW,
    fetchRaw: async () => { foiAFonte = true; return { ok: false, status: 500, json: async () => ({}) }; },
  });
  assert(FRESH_TTL_MS > 1_000, "premissa do teste: 1s está dentro do TTL");
  eq(foiAFonte, true, "o atalho de TTL serviu dado de 40 min sem sequer tentar a fonte");
  eq(r.freshness, FRESHNESS.UNAVAILABLE, "dado de 40 min saiu servível por ter sido gravado agora");
});

await test("dataAgeMs mede pelo observedAt do dado, não pelo storedAt do nosso cache", () => {
  const cache = cacheComIdade(25 * MIN);
  cache.storedAt = NOW;                     // gravado agora, observado há 25 min
  eq(Math.round(dataAgeMs(cache, NOW) / MIN), 25, "idade");
  eq(dataAgeMs(null, NOW), Infinity, "sem cache");
});

// ─── 4. Fonte única: a cópia do navegador é conferida, não confiada ─────────────────────────
console.log("\nFonte única de limiar (a cópia do navegador é vigiada):");

const lojaSrc = readFileSync(resolve(RAIZ, "bolao/shared/js/football_live_store.js"), "utf-8");
const sandbox = {};
new Function("root", lojaSrc.replace(/\(typeof window[^;]+;$/m, "(root);"))(sandbox);
const LOJA = sandbox.BOLAO_FOOTBALL_LIVE;

await test("o navegador carregou e expõe os limiares", () => {
  assert(LOJA && typeof LOJA.STALE_AFTER_MS === "number", "loja não carregou");
});

await test("STALE_AFTER_MS do navegador == FRESH_MAX_AGE_MS do contrato", () => {
  eq(LOJA.STALE_AFTER_MS, FRESH_MAX_AGE_MS,
    "a cópia do navegador divergiu do contrato — servidor e cliente rotulariam o mesmo dado diferente");
});

await test("CRITICAL_STALE_AFTER_MS do navegador == STALE_BUT_USABLE_MAX_AGE_MS do contrato", () => {
  eq(LOJA.CRITICAL_STALE_AFTER_MS, STALE_BUT_USABLE_MAX_AGE_MS,
    "a cópia do navegador divergiu do contrato");
});

await test("os nomes de estado do contrato são idênticos nos dois lados", () => {
  eq(JSON.stringify(LOJA.FRESHNESS), JSON.stringify({ ...FRESHNESS }), "conjunto de estados");
});

await test("navegador e gateway classificam a MESMA idade do mesmo jeito", () => {
  const mapa = [
    [9 * MIN,  LOJA.STATE.LIVE_FRESH],
    [10 * MIN, LOJA.STATE.LIVE_FRESH],
    [11 * MIN, LOJA.STATE.LIVE_STALE],
    [30 * MIN, LOJA.STATE.LIVE_STALE],
    [31 * MIN, LOJA.STATE.LIVE_CRITICAL_STALE],
  ];
  for (const [idade, estadoNavegador] of mapa) {
    eq(LOJA.freshnessOf(estadoNavegador), classifyFreshness(idade),
      `aos ${idade / MIN} min os dois lados discordam`);
  }
});

await test("nenhum TERCEIRO arquivo DEFINE um limiar de frescor por conta própria", () => {
  // O "número mágico duplicado" que o dono proibiu. Só três arquivos podem DEFINIR estes valores:
  // o contrato (dono), a cópia vigiada do navegador, e esta suíte (que compara as duas).
  //
  // O alvo é a DEFINIÇÃO de um limiar — um identificador de frescor recebendo uma duração —, não
  // qualquer aparição de 10 ou 30 minutos. Uma varredura pelo número cru acusa `NOW + 30 * 60000`
  // num teste de relógio e `-iter 600000` do PBKDF2, e um gate que grita em ruído é desligado.
  const DONOS = new Set([
    "supabase/functions/_shared/freshness_contract.js",
    "bolao/shared/js/football_live_store.js",
    "bolao/scripts/test_freshness_contract.mjs",
  ]);
  const NOME_DE_LIMIAR = /(?:STALE|FRESH|CRITICAL)[A-Z_]*(?:AGE|AFTER|TTL|MAX|WINDOW)[A-Z_]*_MS/;
  const DEFINICAO = new RegExp(
    `(?:const|let|var)\\s+(${NOME_DE_LIMIAR.source})\\s*=\\s*([^;\\n]+)`);

  const rastreados = execSync("git ls-files '*.js' '*.mjs'", { cwd: RAIZ, encoding: "utf-8" })
    .split("\n").filter(Boolean);

  const intrusos = [];
  for (const rel of rastreados) {
    if (DONOS.has(rel)) continue;
    let src;
    try { src = readFileSync(resolve(RAIZ, rel), "utf-8"); } catch { continue; }
    src.split("\n").forEach((linha, i) => {
      const t = linha.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      const m = DEFINICAO.exec(linha);
      if (!m) return;
      const [, ident, valor] = m;
      // DERIVAR do contrato é o comportamento correto — o valor continua tendo um dono só.
      if (/FRESH_MAX_AGE_MS|STALE_BUT_USABLE_MAX_AGE_MS/.test(valor)) return;
      // `FRESH_TTL_MS` do gateway é outro conceito: janela anti-martelada da ESPN, não idade do
      // dado. Ele é permitido NOMINALMENTE e só ali — qualquer outro limiar naquele arquivo cai.
      if (rel === "supabase/functions/_shared/gateway_core.js" && ident === "FRESH_TTL_MS") return;
      intrusos.push(`${rel}:${i + 1}  ${ident} = ${valor.trim()}`);
    });
  }
  assert(intrusos.length === 0,
    `limiar de frescor DEFINIDO fora do contrato:\n        ${intrusos.join("\n        ")}`);
});

await test("...e essa varredura realmente morde (controle negativo)", () => {
  // Sem isto, a varredura acima poderia estar passando por não encontrar nada NUNCA — um regex
  // quebrado dá o mesmo verde que um repositório limpo.
  const NOME_DE_LIMIAR = /(?:STALE|FRESH|CRITICAL)[A-Z_]*(?:AGE|AFTER|TTL|MAX|WINDOW)[A-Z_]*_MS/;
  const DEFINICAO = new RegExp(
    `(?:const|let|var)\\s+(${NOME_DE_LIMIAR.source})\\s*=\\s*([^;\\n]+)`);
  assert(DEFINICAO.test("  var STALE_AFTER_MS = 30_000;"), "não pegaria a duplicação clássica");
  assert(DEFINICAO.test("const FRESH_MAX_AGE_MS = 10 * 60_000;"), "não pegaria o limiar do contrato");
  assert(!DEFINICAO.test("const out = clockOf({ pollTime: now - 30 * 60000 });"), "acusaria ruído");
  assert(!DEFINICAO.test('"-iter", "600000",'), "acusaria o PBKDF2");
  // e a exclusão do FRESH_TTL_MS é nominal: um limiar de IDADE no gateway ainda cai.
  const outro = DEFINICAO.exec("const FRESH_MAX_AGE_MS = 5 * 60_000;");
  assert(outro && outro[1] === "FRESH_MAX_AGE_MS", "a exclusão nominal viraria um buraco geral");
});

// ─── 5. health é ALIAS, não segunda verdade ─────────────────────────────────────────────────
console.log("\nhealth é alias de fio do mesmo estado:");

await test("a tradução FRESHNESS -> HEALTH é total e 1:1", () => {
  const vistos = new Set();
  for (const f of Object.values(FRESHNESS)) {
    const h = healthForFreshness(f);
    assert(!vistos.has(h), `dois estados de frescor caem no mesmo health (${h})`);
    vistos.add(h);
  }
  eq(vistos.size, 3, "cobertura");
});

await test("um FRESHNESS desconhecido falha alto, não vira FRESH em silêncio", () => {
  let lancou = false;
  try { healthForFreshness("INVENTADO"); } catch { lancou = true; }
  eq(lancou, true, "estado desconhecido passou batido");
});

await test("os valores de fio antigos NÃO mudaram (navegador já implantado depende deles)", () => {
  eq(HEALTH.FRESH, "FRESH", "wire");
  eq(HEALTH.STALE, "STALE", "wire");
  eq(HEALTH.SOURCE_UNAVAILABLE, "SOURCE_UNAVAILABLE", "wire");
});

await test("isServable: só UNAVAILABLE deixa de ser apresentável", () => {
  eq(isServable(FRESHNESS.FRESH), true, "FRESH");
  eq(isServable(FRESHNESS.STALE_BUT_USABLE), true, "STALE_BUT_USABLE");
  eq(isServable(FRESHNESS.UNAVAILABLE), false, "UNAVAILABLE");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ CONTRATO DE FRESCOR REPROVADO\n"); process.exit(1); }
console.log("✓ CONTRATO DE FRESCOR OK\n");
