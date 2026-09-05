#!/usr/bin/env node
/**
 * test_sentinel_hardening.mjs — os três consertos do endurecimento do Sentinel.
 *
 *   #404  reconcile.mjs: Projects v2 indisponível não é erro de reconciliação
 *   #405  scheduler_stale: a entrega de eventos `schedule` parou
 *   #406  cdb2026_phase_advance: fase decidida, sucessora nunca materializada
 *
 * Os três moram numa suíte só porque compartilham subsistema e fixtures; cada bloco cita a sua
 * Issue e falha por conta própria.
 *
 * Hermético: sem rede, sem provedor, sem participante. Clientes e estado são injetados.
 */
import { reconcile, isProjectsV2Unavailable } from "./reconcile.mjs";
import { createFakeGithubClient } from "./github_client.mjs";
import { upsertFinding } from "./writer.mjs";
import {
  classifyScheduler, detectSchedulerStale,
  FRESH, STALE, NO_SCHEDULED_RUN, UNKNOWN as SCHED_UNKNOWN, STALE_THRESHOLD_HOURS,
} from "./detectors/scheduler_stale.mjs";
import {
  classifyPhaseAdvance, detectCdb2026PhaseAdvance,
  HEALTHY, SUCCESSOR_NOT_MATERIALIZED, UNKNOWN,
} from "./detectors/cdb2026_phase_advance.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readFileSyncSafe = (rel) => readFileSync(join(RAIZ, rel), "utf8");

let ok = 0, fail = 0;
function test(nome, fn) {
  try { fn(); console.log(`  ✓ ${nome}`); ok++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
}
function A(c, m) { if (!c) throw new Error(m); }

const H = 3600000;
const AGORA = new Date("2026-09-05T12:00:00Z");
const atras = (h) => new Date(AGORA.getTime() - h * H).toISOString();

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n#404 — Projects v2 indisponível não é erro de reconciliação\n");

test("o predicado reconhece a mensagem REAL do run 33659441406", () => {
  A(isProjectsV2Unavailable(new Error('github_client: no project titled "Ferrarilabs Engineering" found')),
    "a mensagem exata que deixou o Sentinel vermelho desde 2026-08-29 não foi reconhecida");
});

test("reconhece também token sem escopo `project` e erro da API Projects v2", () => {
  A(isProjectsV2Unavailable(new Error("resource not accessible: missing project scope")), "escopo");
  A(isProjectsV2Unavailable(new Error("GraphQL: could not resolve ProjectV2 node")), "projectsV2");
});

test("NÃO reconhece — e portanto não engole — erros de verdade", () => {
  for (const m of [
    "reconcile: read-back mismatch repairing \"Severity\" on issue #377",
    "gh: HTTP 502 Bad Gateway",
    "state block malformed on issue #12",
    "ENOTFOUND api.github.com",
  ]) {
    A(!isProjectsV2Unavailable(new Error(m)), `engoliria um erro real: ${m}`);
  }
});

/** Cliente que se comporta como o real sob GITHUB_TOKEN: Issues funcionam, Projects v2 não. */
function clienteSemProjects(erro = 'github_client: no project titled "Ferrarilabs Engineering" found') {
  const c = createFakeGithubClient();
  // O fake comeca com o mapa de Issues VAZIO e expoe `_issues` para semear — passar `{issues:[...]}`
  // no construtor e ignorado em silencio, e o teste ficaria verde sem exercitar `repairOne`.
  // Marcador REAL do github_state.mjs e `state: "OPEN"`, como listSentinelIssues() filtra.
  c._issues.set(377, {
    number: 377, nodeId: "N1", state: "OPEN",
    title: "[Sentinel] cdb2026 result email gap",
    body: '<!-- ferrarilabs-sentinel\n{"intended_canonical":{"severity":"High"},"fingerprint":"fp-1"}\n-->',
    labels: ["sentinel-managed"],
  });
  const boom = () => { throw new Error(erro); };
  return Object.assign(Object.create(Object.getPrototypeOf(c)), c, {
    ensureProjectItem: boom, getProjectFields: boom, setProjectFields: boom,
  });
}

test("sweep com Projects v2 fora: errors=0 (era 1 e saía exit 1)", () => {
  const s = reconcile(clienteSemProjects(), { dryRun: false });
  A(s.errors.length === 0, `errors=${s.errors.length}: ${JSON.stringify(s.errors)}`);
});

test("a condição fica REGISTRADA, não escondida", () => {
  const s = reconcile(clienteSemProjects(), { dryRun: false });
  A(s.projects_v2_unavailable.length === 1,
    `esperava 1 registro de indisponibilidade, veio ${s.projects_v2_unavailable.length}`);
  A(String(s.projects_v2_unavailable[0].detail).includes("no project titled"),
    "o detalhe original tem de sobreviver no registro");
});

test("REGRESSÃO: um erro que NÃO é Projects v2 continua reprovando", () => {
  const s = reconcile(clienteSemProjects("gh: HTTP 502 Bad Gateway"), { dryRun: false });
  A(s.errors.length === 1, "um erro real deixou de contar — o check foi silenciado");
  A(s.projects_v2_unavailable.length === 0, "erro real classificado como indisponibilidade");
});

test("MUTAÇÃO: predicado abrangente (sempre true) engoliria o erro real — logo o estreito protege", () => {
  const abrangente = () => true;
  A(abrangente(new Error("gh: HTTP 502 Bad Gateway")) === true
    && isProjectsV2Unavailable(new Error("gh: HTTP 502 Bad Gateway")) === false,
    "o predicado real precisa DISCORDAR do abrangente num erro de verdade");
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n#405 — heartbeat de agendamento\n");

const sched = (h) => ({ event: "schedule", createdAt: atras(h), workflowName: "w" });
const disp = (h) => ({ event: "workflow_dispatch", createdAt: atras(h), workflowName: "Produtor do cache ao vivo" });

test("run agendado FRESCO => FRESH, sem finding", () => {
  const c = classifyScheduler([sched(0.5), disp(0.01)], { now: AGORA });
  A(c.state === FRESH, c.state);
  const r = detectSchedulerStale({ fetchRecentRuns: () => [sched(0.5)], now: AGORA });
  A(r.findings.length === 0, "não pode emitir finding com o agendador saudável");
});

test("run agendado VELHO => STALE, com finding", () => {
  const c = classifyScheduler([sched(45)], { now: AGORA });
  A(c.state === STALE, c.state);
  A(c.ageHours === 45, c.ageHours);
  const r = detectSchedulerStale({ fetchRecentRuns: () => [sched(45)], now: AGORA });
  A(r.findings.length === 1, "parada de 45 h tem de emitir finding");
});

test("O VERDE FALSO DA #396: dispatch recente COM agendado velho => STALE", () => {
  // Exatamente a forma do incidente: o produtor rodando a cada 5 min por dispatch externo,
  // enquanto TODO o cron estava morto havia 45 h.
  const runs = [disp(0.01), disp(0.09), disp(0.18), sched(45)];
  const c = classifyScheduler(runs, { now: AGORA });
  A(c.state === STALE, `dispatch recente mascarou a parada: ${c.state}`);
  A(c.newestAt === atras(45), "pegou o timestamp do run errado");
});

test("push e repository_dispatch também não produzem verde falso", () => {
  const runs = [
    { event: "push", createdAt: atras(0.01) },
    { event: "repository_dispatch", createdAt: atras(0.02) },
    { event: "pull_request", createdAt: atras(0.03) },
    sched(30),
  ];
  A(classifyScheduler(runs, { now: AGORA }).state === STALE, "gatilho não-cron produziu verde");
});

test("nenhum agendado numa amostra que COBRE o limiar => NO_SCHEDULED_RUN, com finding", () => {
  // Dispatches cobrindo 30 h sem um unico `schedule`: aqui a ausencia PROVA parada.
  const runs = [disp(0.01), disp(10), disp(20), disp(30)];
  const c = classifyScheduler(runs, { now: AGORA });
  A(c.state === NO_SCHEDULED_RUN, `${c.state} — span=${c.sampleSpanHours}h`);
  A(c.newestAt === null && c.ageHours === null, "não pode inventar idade");
  A(detectSchedulerStale({ fetchRecentRuns: () => runs, now: AGORA }).findings.length === 1,
    "ausência de cron numa janela ampla tem de alertar");
});

test("AUSÊNCIA NÃO É EVIDÊNCIA: amostra vazia => UNKNOWN, sem finding", () => {
  // Pego pelo gate de aceitação já existente: com cliente vazio o detector ACUSAVA parada.
  // Amostra vazia é "não medi", nunca "o cron parou".
  A(classifyScheduler([], { now: AGORA }).state === SCHED_UNKNOWN, "vazio virou acusação");
  A(detectSchedulerStale({ fetchRecentRuns: () => [], now: AGORA }).findings.length === 0,
    "amostra vazia emitiu finding");
});

test("amostra CURTA sem `schedule` => UNKNOWN (este repo faz ~288 dispatches/dia)", () => {
  // 200 runs podem abranger poucas horas so de dispatch, sem nenhum `schedule`, com tudo saudável.
  const c = classifyScheduler([disp(0.01), disp(0.5), disp(1.2)], { now: AGORA });
  A(c.state === SCHED_UNKNOWN, `${c.state} — span=${c.sampleSpanHours}h`);
  A(detectSchedulerStale({ fetchRecentRuns: () => [disp(0.01), disp(1.2)], now: AGORA }).findings.length === 0,
    "amostra curta produziu alarme falso");
});

test("a evidência traz timestamp E idade (é o que torna o alerta acionável)", () => {
  const r = detectSchedulerStale({ fetchRecentRuns: () => [sched(45)], now: AGORA });
  const ev = r.findings[0].evidence.join(" ");
  A(ev.includes(`newest_scheduled_at=${atras(45)}`), ev);
  A(ev.includes("age_hours=45"), ev);
  A(ev.includes(`threshold_hours=${STALE_THRESHOLD_HOURS}`), ev);
});

test("o limiar de 6 h NÃO dispara no pior intervalo saudável já medido (3.12 h)", () => {
  // Medido nas ~200 execuções agendadas de 2026-08-30..09-05: o maior intervalo saudável foi
  // 3.12 h (2026-08-31 01:46Z -> 04:53Z). Um limiar de 3 h teria dado alarme falso ali.
  A(classifyScheduler([sched(3.12)], { now: AGORA }).state === FRESH,
    "3.12 h é operação NORMAL — alertar aqui seria o alarme falso que o limiar de 3 h causaria");
  A(classifyScheduler([sched(3.12)], { now: AGORA, thresholdHours: 3 }).state === STALE,
    "controle: com 3 h o mesmo intervalo saudável dispararia — é por isso que 6 h é mais seguro");
});

test("teria disparado ANTES do Gre-Nal na janela real da #396", () => {
  // Parada em 2026-09-02T23:55Z; apito do Gre-Nal em 2026-09-03T23:00Z.
  const inicio = new Date("2026-09-02T23:55:51Z").toISOString();
  const seisHorasDepois = new Date("2026-09-03T06:00:00Z");
  const c = classifyScheduler([{ event: "schedule", createdAt: inicio }], { now: seisHorasDepois });
  A(c.state === STALE, "não teria disparado a tempo");
  const horasAntesDoJogo = (new Date("2026-09-03T23:00:00Z") - seisHorasDepois) / H;
  A(horasAntesDoJogo >= 16, `só ${horasAntesDoJogo} h de antecedência`);
});

test("erro de leitura => UNKNOWN, nunca acusação de parada", () => {
  const r = detectSchedulerStale({ fetchRecentRuns: () => { throw new Error("gh offline"); }, now: AGORA });
  A(r.findings.length === 0, "não medir virou acusar");
  A(String(r.unknown).includes("gh offline"), r.unknown);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n#406 — avanço de fase do CDB2026\n");

const TOPO = {
  slots: { "sf-1": { sideA: { winnerOf: "t1" }, sideB: { winnerOf: "t2" } },
           "sf-2": { sideA: { winnerOf: "t3" }, sideB: { winnerOf: "t4" } } },
  provenance: { authority: "CBF", validatedAt: "2026-08-11T16:10:00Z" },
};
const tieDecidido = (g = 1) => ({ qualifiedTeamId: "A", matches: { first: { goalsHome: g, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 0 } } });
const tieAberto = () => ({ qualifiedTeamId: null, matches: { first: { goalsHome: 0, goalsAway: 0 }, second: { goalsHome: null, goalsAway: null } } });

const estado = ({ quartasDecidida = true, semiTopo = true, semiTies = {} } = {}) => ({
  espnSync: { activePhaseId: "quartas" },
  phases: {
    quartas: { ties: quartasDecidida ? { t1: tieDecidido(), t2: tieDecidido(2) } : { t1: tieDecidido(), t2: tieAberto() } },
    semifinal: { ties: semiTies, ...(semiTopo ? { topology: TOPO } : {}) },
    final: { ties: {} },
  },
});

test("O CASO REAL: quartas decidida + semifinal com topologia e ZERO ties => alerta", () => {
  const c = classifyPhaseAdvance(estado());
  A(c.state === SUCCESSOR_NOT_MATERIALIZED, `${c.state} — ${c.reason}`);
  A(c.activePhaseId === "quartas" && c.successorPhaseId === "semifinal", JSON.stringify(c));
  A(detectCdb2026PhaseAdvance({ fetchState: () => estado(), now: AGORA }).findings.length === 1, "sem finding");
});

test("transição SAUDÁVEL: sucessora já materializada => silêncio", () => {
  const c = classifyPhaseAdvance(estado({ semiTies: { "sf-1": tieAberto() } }));
  A(c.state === HEALTHY, `${c.state} — ${c.reason}`);
  A(detectCdb2026PhaseAdvance({ fetchState: () => estado({ semiTies: { "sf-1": tieAberto() } }) }).findings.length === 0, "");
});

test("sucessora AINDA SEM topologia autoritativa => silêncio (não há o que materializar)", () => {
  const c = classifyPhaseAdvance(estado({ semiTopo: false }));
  A(c.state === HEALTHY, `${c.state} — ${c.reason}`);
  A(/topologia autoritativa/.test(c.reason), c.reason);
});

test("topologia sem proveniência da CBF não conta como autoritativa", () => {
  const e = estado();
  e.phases.semifinal.topology = { slots: TOPO.slots, provenance: { authority: "palpite" } };
  A(classifyPhaseAdvance(e).state === HEALTHY, "aceitou topologia não validada como autoritativa");
});

test("fase corrente PARCIALMENTE decidida => silêncio", () => {
  const c = classifyPhaseAdvance(estado({ quartasDecidida: false }));
  A(c.state === HEALTHY, `${c.state} — ${c.reason}`);
  A(/nao esta inteiramente decidida/.test(c.reason), c.reason);
});

test("#395: CONFRONTO CONHECIDO SEM DATA/HORÁRIO é saudável — nunca alerta", () => {
  // O caso legítimo da #395: a semifinal materializada, com os dois clubes conhecidos, e SEM
  // kickoff porque a CBF ainda não publicou a tabela. Isso é estado normal do produto.
  const semDatas = {
    "sf-1": { teamA: "Grêmio", teamB: "Atlético-MG", qualifiedTeamId: null,
              matches: { first: { kickoff: null, venue: null, goalsHome: null, goalsAway: null },
                         second: { kickoff: null, venue: null, goalsHome: null, goalsAway: null } } },
  };
  const c = classifyPhaseAdvance(estado({ semiTies: semDatas }));
  A(c.state === HEALTHY, `alertou no caso legítimo da #395: ${c.state} — ${c.reason}`);
  A(detectCdb2026PhaseAdvance({ fetchState: () => estado({ semiTies: semDatas }) }).findings.length === 0,
    "emitiu finding para 'confronto conhecido sem data' — é operação normal, não defeito");
});

test("a LÓGICA DE DECISÃO não olha kickoff/venue/broadcast (materialização, não data)", () => {
  // Só as funções que DECIDEM. O texto do finding cita `kickoff` de propósito — para dizer que a
  // condição NÃO é essa — e uma varredura sobre o arquivo inteiro reprovaria a documentação
  // correta. Mesma técnica dos outros gates deste repo.
  const src = readFileSyncSafe("scripts/sentinel/detectors/cdb2026_phase_advance.mjs");
  const decisao = ["hasAuthoritativeTopology", "isPhaseFullyDecided", "classifyPhaseAdvance"]
    .map((n) => {
      const i = src.indexOf(`export function ${n}(`);
      A(i !== -1, `função ${n}() não encontrada`);
      let d = 0, started = false, j = i;
      for (; j < src.length; j++) {
        if (src[j] === "{") { d++; started = true; }
        else if (src[j] === "}") { d--; if (started && d === 0) { j++; break; } }
      }
      return src.slice(i, j);
    }).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");
  for (const p of ["kickoff", "venue", "broadcast", "where_to_watch", "dateISO"]) {
    A(!decisao.includes(p), `a decisão referencia \`${p}\` — ela decide por materialização, nunca por data`);
  }
});

test("estado ilegível/ausente => UNKNOWN, nunca acusação", () => {
  A(classifyPhaseAdvance(null).state === UNKNOWN, "null virou acusação");
  A(classifyPhaseAdvance({ phases: {} }).state === UNKNOWN, "sem activePhaseId virou acusação");
  const r = detectCdb2026PhaseAdvance({ fetchState: () => { throw new Error("supabase fora"); } });
  A(r.findings.length === 0 && String(r.unknown).includes("supabase fora"), JSON.stringify(r));
});

test("não escreve estado: sem saveState/upsert/PATCH no detector", () => {
  const src = readFileSyncSafe("scripts/sentinel/detectors/cdb2026_phase_advance.mjs");
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.split("//")[0]).join("\n");
  for (const p of ["saveState", "upsert", "PATCH", "POST", "setProjectFields", "activePhaseId ="]) {
    A(!codigo.includes(p), `o detector referencia \`${p}\` — ele é somente leitura`);
  }
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\nContrato do WRITER — um finding invalido derruba o run inteiro\n");

// POR QUE ISTO EXISTE: a primeira versao destes dois detectores punha `source_sha: null`. Os
// testes de unidade passavam (eles so olhavam o detector), o `npm run check` passava, o CI do PR
// passava — e o primeiro run REAL do Sentinel morreu com
// `writer.mjs refuses an invalid Finding: missing provenance.source_sha`.
// O #406 tinha disparado CORRETAMENTE e o writer recusou o finding.
//
// Nenhum teste exercitava o caminho detector -> writer, porque o gate de aceitacao roda contra um
// repo limpo (zero findings) e nunca chega ao writer. Estes testes fecham exatamente essa junta.

test("finding do #405 ATRAVESSA o writer (era `source_sha: null` e derrubava o run)", () => {
  const r = detectSchedulerStale({ fetchRecentRuns: () => [sched(45)], now: AGORA });
  A(r.findings.length === 1, "sem finding para exercitar o writer");
  A(r.findings[0].provenance.source_sha, "source_sha ausente — o writer recusaria");
  const client = createFakeGithubClient();
  const out = upsertFinding(r.findings[0], client, { log() {} });   // lanca se invalido
  A(out.issueNumber, "o writer nao criou a Issue");
});

test("finding do #406 ATRAVESSA o writer", () => {
  const r = detectCdb2026PhaseAdvance({ fetchState: () => estado(), now: AGORA });
  A(r.findings.length === 1, "sem finding para exercitar o writer");
  A(r.findings[0].provenance.source_sha, "source_sha ausente — o writer recusaria");
  const client = createFakeGithubClient();
  const out = upsertFinding(r.findings[0], client, { log() {} });
  A(out.issueNumber, "o writer nao criou a Issue");
});

test("MUTACAO: com source_sha null o writer REPROVA (logo o teste acima morde)", () => {
  const r = detectSchedulerStale({ fetchRecentRuns: () => [sched(45)], now: AGORA });
  const invalido = { ...r.findings[0], provenance: { ...r.findings[0].provenance, source_sha: null } };
  let lancou = false;
  try { upsertFinding(invalido, createFakeGithubClient(), { log() {} }); }
  catch (e) { lancou = /source_sha/.test(String(e.message)); }
  A(lancou, "o writer aceitou source_sha null — o teste acima nao prova nada");
});



// ─── #415: o detector de avanço de fase tem de saber SE RETRATAR ────────────────────────────────
//
// Ele sabia acusar e não sabia dar alta. O `run.mjs` exige impressão digital explícita em
// `confirmedRecoveries` quando o detector fornece o conjunto — ausência do achado NÃO basta. Com o
// conjunto sempre vazio, a #409 ficou OPEN mesmo depois de a semifinal ser materializada em
// produção e o detector reportar `finding_count: 0`. Mesma forma do #404: vermelho para sempre.
{
  const { detectCdb2026PhaseAdvance } =
    await import("./detectors/cdb2026_phase_advance.mjs");
  const { phaseAdvanceFingerprint } = await import("./fingerprint.mjs");

  const PROV = { authority: "CBF", validatedAt: "2026-08-12T19:00:00Z" };
  const tie = (a, b, q) => ({ teamA: a, teamB: b, qualifiedTeamId: q,
    matches: { first: { goalsHome: 1, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 0 } } });
  const base = (semiTies) => ({
    espnSync: { activePhaseId: "quartas" },
    phases: {
      quartas: { ties: { t1: tie("Vasco", "Vitória", "A"), t2: tie("Grêmio", "Internacional", "A") } },
      semifinal: { ties: semiTies, topology: { provenance: PROV, slots: { "sf-1": {}, "sf-2": {} } } },
    },
  });

  const FP = phaseAdvanceFingerprint("quartas", "semifinal");

  test("#415 sucessora materializada => recuperação CONFIRMADA com a digital do par", () => {
    const r = detectCdb2026PhaseAdvance({ fetchState: () => base({ sf1: tie("Vasco", "Grêmio", null) }) });
    A(r.findings.length === 0, "não deveria acusar com a sucessora materializada");
    A(r.confirmedRecoveries.has(FP),
      `alta não confirmada — o achado nunca fecharia. Conjunto: ${[...r.confirmedRecoveries]}`);
  });

  test("#415 a digital confirmada é IDÊNTICA à emitida no achado", () => {
    const aberto = detectCdb2026PhaseAdvance({ fetchState: () => base({}) });
    A(aberto.findings.length === 1, "deveria acusar com a sucessora vazia");
    const fechado = detectCdb2026PhaseAdvance({ fetchState: () => base({ sf1: tie("V", "G", null) }) });
    A(fechado.confirmedRecoveries.has(aberto.findings[0].fingerprint),
      "confirma um par diferente do que abriu — o achado real continuaria aberto");
  });

  test("#415 condição quebrada continua ACUSANDO e não dá alta", () => {
    const r = detectCdb2026PhaseAdvance({ fetchState: () => base({}) });
    A(r.findings.length === 1, "parou de acusar — o outro lado do gate se perdeu");
    A(r.confirmedRecoveries.size === 0, "deu alta enquanto acusava");
  });

  test("#415 estado ilegível (UNKNOWN) NÃO confirma recuperação", () => {
    const r = detectCdb2026PhaseAdvance({ fetchState: () => { throw new Error("sem rede"); } });
    A(r.confirmedRecoveries.size === 0,
      "não conseguir ler virou prova de saúde — é ausência de prova, não alta");
    const semAtiva = detectCdb2026PhaseAdvance({ fetchState: () => ({ phases: {} }) });
    A(semAtiva.confirmedRecoveries.size === 0, "sem activePhaseId não há par para confirmar");
  });

  test("#415 fase ativa ainda indecisa: saudável, mas sem confirmar par não observado", () => {
    const s = base({});
    s.phases.quartas.ties.t2.qualifiedTeamId = null;
    const r = detectCdb2026PhaseAdvance({ fetchState: () => s });
    A(r.findings.length === 0, "fase pela metade não é acusação");
    // `size === 0`, nao apenas "nao contem FP": com a fase ativa indecisa nao se observou NADA
    // sobre sucessora nenhuma, entao nao ha par a confirmar. A versao fraca deste assert deixava
    // passar uma digital calculada com `successorPhaseId` indefinido -- lixo que nao casa com
    // achado nenhum hoje, e que casa com o achado errado no dia em que a numeracao mudar.
    A(r.confirmedRecoveries.size === 0,
      `confirmou ${[...r.confirmedRecoveries]} sem ter observado sucessora — alta por engano`);
  });
}


console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ SENTINEL HARDENING FAILED" : "✓ SENTINEL HARDENING OK");
process.exit(fail ? 1 : 0);
