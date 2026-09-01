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
import { classificar, classificarComJanela, agregar, transicao, produtorAtrasado, ESTADO, STALE_MS, CRITICAL_MS }
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


console.log("\nE. Janela de atividade (#372) — inatividade esperada nao e degradacao");

/**
 * Uma resposta do gateway EXATAMENTE como a que manteve a #372 aberta por cinco dias:
 * 503 com `SOURCE_UNAVAILABLE` e o motivo real do provedor.
 */
const RESPOSTA_403 = { status: 503, corpo: { status: "SOURCE_UNAVAILABLE", staleReason: "UPSTREAM_403" } };
const RESPOSTA_FRESCA = { status: 200, corpo: { observedAt: haMin(1) } };

/**
 * As PROVAS, isoladas do sujeito.
 *
 * Elas recebem a implementacao como argumento para que os controles negativos possam aplicar as
 * MESMAS provas a uma implementacao mutante. Um controle negativo que verifica outra coisa prova
 * outra coisa — e foi assim que a #372 passou despercebida: havia gate de cadencia, nao de
 * semantica.
 */
const provaInWindow403Alarma = (fn) =>
  fn({ ...RESPOSTA_403, agoraMs: AGORA, emJanela: true }).estado === ESTADO.GATEWAY_UNAVAILABLE;
const provaOutOfWindow403NaoAlarma = (fn) =>
  fn({ ...RESPOSTA_403, agoraMs: AGORA, emJanela: false }).estado === ESTADO.SEM_JANELA;

test("1. EM JANELA + gateway fresco ⇒ OK (saudavel)", () => {
  const r = classificarComJanela({ ...RESPOSTA_FRESCA, agoraMs: AGORA, emJanela: true });
  A(r.estado === ESTADO.OK, r.estado);
});

test("2. EM JANELA + UPSTREAM_403 ⇒ INCIDENTE (a queda real continua alarmando)", () => {
  A(provaInWindow403Alarma(classificarComJanela),
    "estar dentro da janela e nao alcancar o dado ao vivo E degradacao — este e o caso que nunca pode ser abrandado");
  const r = classificarComJanela({ ...RESPOSTA_403, agoraMs: AGORA, emJanela: true });
  A(/UPSTREAM_403/.test(r.detalhe), `o motivo do provedor sumiu: ${r.detalhe}`);
});

test("3. FORA DA JANELA + UPSTREAM_403 antigo ⇒ SEM_JANELA (inatividade esperada)", () => {
  A(provaOutOfWindow403NaoAlarma(classificarComJanela),
    "sem partida na janela o produtor nem foi a fonte; cobrar frescor do cache aqui e alarmar sobre o comportamento normal");
  const r = classificarComJanela({ ...RESPOSTA_403, agoraMs: AGORA, emJanela: false });
  A(/UPSTREAM_403/.test(r.detalhe), `o motivo real tem de continuar visivel, so deixa de ser incidente: ${r.detalhe}`);
});

test("3b. FORA DA JANELA + observacao FRESCA continua OK — dado fresco e dado fresco", () => {
  const r = classificarComJanela({ ...RESPOSTA_FRESCA, agoraMs: AGORA, emJanela: false });
  A(r.estado === ESTADO.OK,
    `so o que o produtor decidiu NAO produzir e abrandado; uma observacao saudavel vale sempre: ${r.estado}`);
});

test("4. FORA DA JANELA nao mascara outra competicao quebrada EM JANELA", () => {
  A(agregar([{ estado: ESTADO.SEM_JANELA }, { estado: ESTADO.GATEWAY_UNAVAILABLE }]) === ESTADO.GATEWAY_UNAVAILABLE,
    "uma competicao inativa nunca pode esconder outra que esta quebrada de verdade");
});

test("4b. FORA DA JANELA nao FECHA incidente aberto sem observacao positiva", () => {
  const t = transicao(ESTADO.GATEWAY_UNAVAILABLE, ESTADO.SEM_JANELA);
  A(t.acao === "SILENCIO", `fechar por ausencia de dado seria declarar recuperacao sem medir nenhuma: ${t.acao}`);
  A(t.incidente === ESTADO.GATEWAY_UNAVAILABLE, "o incidente aberto tem de continuar nomeado");
  A(agregar([{ estado: ESTADO.SEM_JANELA }, { estado: ESTADO.SEM_JANELA }]) === ESTADO.SEM_JANELA,
    "todas inativas nao e OK — OK autorizaria o fechamento");
  A(agregar([{ estado: ESTADO.SEM_JANELA }, { estado: ESTADO.OK }]) === ESTADO.OK,
    "uma observacao saudavel de verdade E o que autoriza a recuperacao");
  A(transicao(ESTADO.GATEWAY_UNAVAILABLE, ESTADO.OK).acao === "RECUPERAR",
    "o contrato de recuperacao por observacao positiva foi quebrado");
});

test("4c. SEM_JANELA nao abre incidente, nem depois de um ciclo saudavel", () => {
  A(transicao(ESTADO.OK, ESTADO.SEM_JANELA).acao === "SILENCIO", "");
  A(transicao(ESTADO.SEM_JANELA, ESTADO.OK).acao === "SILENCIO",
    "sair da inatividade para saudavel nao e recuperacao de incidente — nao havia incidente");
});

test("4d. o workflow roteia SEM_JANELA para um terceiro caminho: nem abre, nem fecha", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const wf = readFileSync(join(raiz, ".github", "workflows", "live_pipeline_monitor.yml"), "utf8");
  A(/SEM_JANELA\)\s*DEGRADADO=2/.test(wf),
    "o classificador distingue, mas quem decide alarme e o workflow — sem este ramo a correcao nao chega ao incidente");
  A(/\[ "\$DEGRADADO" = "2" \]/.test(wf), "o ramo que nao abre nem fecha sumiu do workflow");
  A(/OK\|CACHE_STALE\)\s*DEGRADADO=0/.test(wf), "o caminho de recuperacao por observacao positiva sumiu");
  A(/\*\)\s*DEGRADADO=1/.test(wf), "o caminho de abertura de incidente sumiu");
});

console.log("\nF. Controles negativos por mutação (#372)");

test("5. mutacao 'EM JANELA + 403 e saudavel' REPROVA a prova 2", () => {
  // A mutacao que esconderia uma queda real durante um jogo — o modo de falha mais caro possivel.
  const mutante = (a) => (a.emJanela && a.status >= 500 ? { estado: ESTADO.OK, detalhe: "mutante" } : classificarComJanela(a));
  A(provaInWindow403Alarma(mutante) === false,
    "a prova 2 aceitou uma implementacao que trata queda em janela como saudavel — ela nao morde");
});

test("6. mutacao 'ignorar a janela' (comportamento de ANTES do #372) REPROVA a prova 3", () => {
  // Este mutante NAO e hipotetico: e literalmente a implementacao anterior, que manteve a #372
  // aberta por cinco dias. Se a prova 3 nao o reprova, a correcao nao esta sendo verificada.
  const mutanteComportamentoAtual = ({ emJanela, ...resto }) => classificar(resto);
  A(provaOutOfWindow403NaoAlarma(mutanteComportamentoAtual) === false,
    "a prova 3 aceitou o comportamento anterior — o defeito da #372 passaria de novo");
  A(provaInWindow403Alarma(mutanteComportamentoAtual) === true,
    "controle de sanidade: o comportamento anterior sempre acertou o caso EM JANELA; a correcao so muda o caso FORA");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ PIPELINE MONITOR FAILED" : "✓ PIPELINE MONITOR OK");
process.exit(fail ? 1 : 0);
