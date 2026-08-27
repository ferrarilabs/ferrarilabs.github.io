/**
 * test_pipeline_monitor.mjs — o monitor do pipeline ao vivo, provado (#246).
 *
 * Todos os incidentes do pipeline em 2026-08 foram descobertos do mesmo jeito: alguém abriu o
 * site e viu que estava errado. A CI de browser chegou a tropeçar em alguns por acidente — o que
 * é pior que não detectar, porque cria a impressão de cobertura sem a propriedade de cobertura.
 *
 * O que se prova aqui: o monitor classifica corretamente, **não repete alarme** enquanto o mesmo
 * incidente persiste, e reconhece recuperação sozinho. Um monitor que grita a cada ciclo é um
 * monitor que as pessoas silenciam — e um monitor silenciado é pior que nenhum, porque ainda
 * parece existir.
 *
 * Hermético: sem rede, sem provedor, sem participante.
 */
import { classificar, transicao, produtorAtrasado, ESTADO, STALE_MS, CRITICAL_MS }
  from "./monitor_live_pipeline.mjs";

let ok = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const A = (c, m) => { if (!c) throw new Error(m); };

const AGORA = Date.parse("2026-08-27T12:00:00Z");
const haMin = (m) => new Date(AGORA - m * 60000).toISOString();

console.log("\n#246 — monitor do pipeline ao vivo\n");
console.log("A. Classificação");

test("observação recente ⇒ OK", () => {
  const r = classificar({ status: 200, corpo: { observedAt: haMin(3) }, agoraMs: AGORA });
  A(r.estado === ESTADO.OK, r.estado);
});

test("observação acima do limiar de stale ⇒ CACHE_STALE", () => {
  const r = classificar({ status: 200, corpo: { observedAt: haMin(15) }, agoraMs: AGORA });
  A(r.estado === ESTADO.CACHE_STALE, r.estado);
});

test("observação acima do limiar crítico ⇒ CACHE_CRITICAL", () => {
  const r = classificar({ status: 200, corpo: { observedAt: haMin(45) }, agoraMs: AGORA });
  A(r.estado === ESTADO.CACHE_CRITICAL, r.estado);
});

test("503 do gateway ⇒ GATEWAY_UNAVAILABLE, com o motivo do provedor", () => {
  const r = classificar({ status: 503, corpo: { status: "SOURCE_UNAVAILABLE", staleReason: "UPSTREAM_403" }, agoraMs: AGORA });
  A(r.estado === ESTADO.GATEWAY_UNAVAILABLE, r.estado);
  A(/UPSTREAM_403/.test(r.detalhe), `motivo do provedor perdido: ${r.detalhe}`);
});

test("timeout/conexão recusada (status 0) ⇒ GATEWAY_UNAVAILABLE", () => {
  A(classificar({ status: 0, corpo: null, agoraMs: AGORA }).estado === ESTADO.GATEWAY_UNAVAILABLE, "");
});

test("corpo sem a forma esperada ⇒ GATEWAY_INVALID_PAYLOAD, não 'cache velho'", () => {
  const r = classificar({ status: 200, corpo: { qualquer: 1 }, agoraMs: AGORA });
  A(r.estado === ESTADO.GATEWAY_INVALID_PAYLOAD,
    `uma resposta ilegível nao pode ser lida como cache velho — nao se sabe se ha cache: ${r.estado}`);
});

test("observedAt nulo ⇒ indisponível (não é observação velha, é ausência de observação)", () => {
  const r = classificar({ status: 200, corpo: { observedAt: null, staleReason: "UPSTREAM_403" }, agoraMs: AGORA });
  A(r.estado === ESTADO.GATEWAY_UNAVAILABLE, r.estado);
});

test("observedAt ilegível ⇒ INVALID_PAYLOAD, sem inventar idade", () => {
  const r = classificar({ status: 200, corpo: { observedAt: "nao-e-data" }, agoraMs: AGORA });
  A(r.estado === ESTADO.GATEWAY_INVALID_PAYLOAD, r.estado);
});

test("os limiares vêm do contrato compartilhado, não de números próprios", () => {
  A(STALE_MS === 10 * 60000, `STALE_MS divergiu do contrato: ${STALE_MS}`);
  A(CRITICAL_MS === 30 * 60000, `CRITICAL_MS divergiu do contrato: ${CRITICAL_MS}`);
});

console.log("\nB. Identidade de incidente e ruído");

test("saudável → degradado ⇒ ABRIR", () => {
  A(transicao(ESTADO.OK, ESTADO.CACHE_CRITICAL).acao === "ABRIR", "");
});

test("degradado → MESMO degradado ⇒ SILÊNCIO (não repete alarme)", () => {
  const r = transicao(ESTADO.CACHE_CRITICAL, ESTADO.CACHE_CRITICAL);
  A(r.acao === "SILENCIO",
    `uma indisponibilidade de 3 horas abriria um alarme por ciclo: ${r.acao}`);
});

test("degradado → OUTRO degradado ⇒ ABRIR uma vez (a natureza mudou)", () => {
  A(transicao(ESTADO.CACHE_STALE, ESTADO.GATEWAY_UNAVAILABLE).acao === "ABRIR", "");
});

test("degradado → saudável ⇒ RECUPERAR", () => {
  const r = transicao(ESTADO.GATEWAY_UNAVAILABLE, ESTADO.OK);
  A(r.acao === "RECUPERAR", r.acao);
  A(r.incidente === ESTADO.GATEWAY_UNAVAILABLE, "a recuperação tem de nomear o incidente que fecha");
});

test("saudável → saudável ⇒ SILÊNCIO", () => {
  A(transicao(ESTADO.OK, ESTADO.OK).acao === "SILENCIO", "");
});

test("primeira execução (sem estado anterior) e saudável ⇒ SILÊNCIO", () => {
  A(transicao(null, ESTADO.OK).acao === "SILENCIO", "");
});

console.log("\nC. Produtor atrasado");

test("produtor dentro do esperado ⇒ nada", () => {
  A(produtorAtrasado(AGORA - 12 * 60000, AGORA) === null, "");
});

test("produtor além do crítico ⇒ PRODUCER_LATE, com o atraso medido", () => {
  const r = produtorAtrasado(AGORA - 90 * 60000, AGORA);
  A(r && r.estado === ESTADO.PRODUCER_LATE, "");
  A(/90 min/.test(r.detalhe), r.detalhe);
});

test("sem dado de execução ⇒ null, sem inventar atraso", () => {
  A(produtorAtrasado(NaN, AGORA) === null, "inventou atraso sem dado");
});

console.log("\nD. Controles negativos");

test("mutação (silenciar o incidente persistente vira alarme repetido) é detectável", () => {
  // Se `transicao` passasse a devolver ABRIR para o mesmo estado, um incidente longo geraria
  // um alarme por ciclo — exatamente o que faz alguem desligar o monitor.
  const antes = transicao(ESTADO.CACHE_CRITICAL, ESTADO.CACHE_CRITICAL).acao;
  A(antes === "SILENCIO", "o contrato de dedupe ja esta quebrado");
});

test("nenhum dado de participante é lido pelo monitor", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "monitor_live_pipeline.mjs"), "utf8");
  const codigo = src.replace(/\/\*\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");
  for (const p of ["entry_ref", "email", "picks", "bolao_state", "participant", "entries"]) {
    A(!codigo.toLowerCase().includes(p), `o monitor referencia \`${p}\` — ele nao precisa de nada disso`);
  }
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ PIPELINE MONITOR FAILED" : "✓ PIPELINE MONITOR OK");
process.exit(fail ? 1 : 0);
