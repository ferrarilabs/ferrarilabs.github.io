#!/usr/bin/env node
/**
 * Scheduled-workflow coverage verification.
 *
 * WHY THIS EXISTS
 * A cron that does not fire emits NOTHING. There is no error, no failed run, no alert — the absence
 * is the failure. This class of defect already occurred and cost real notifications:
 *
 *   powerball-results-email.yml previously scheduled Tuesday + Saturday only. Real Powerball draws
 *   are Monday / Wednesday / Saturday at 22:59 ET, so the workflow silently never fired after any
 *   Monday or Wednesday drawing — including 2026-08-05, a Wednesday. It was found by reading the
 *   file on 2026-08-06, not by any signal.
 *
 * This test encodes the expected event calendar and fails when the union of a workflow's cron windows
 * stops covering it. It is deliberately HERMETIC: it parses YAML text and reasons about wall-clock
 * windows. It makes no network call, touches no GitHub API, and asserts nothing about whether runs
 * actually happened (that is a runtime heartbeat — a separate, later concern).
 *
 * Usage: node bolao/scripts/cron_coverage.test.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WF_DIR = join(REPO, ".github", "workflows");

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

// ── cron parsing ────────────────────────────────────────────────────────────────
/** Expand one 5-field cron field into the set of integers it matches. */
function expandField(spec, min, max) {
  const out = new Set();
  for (const part of String(spec).split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo, hi;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      lo = a; hi = b;
    } else { lo = hi = Number(range); }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`non-numeric range in "${part}"`);
    if (lo < min || hi > max || lo > hi) throw new Error(`range ${lo}-${hi} outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** @returns {{minute:Set,hour:Set,dom:Set,month:Set,dow:Set,raw:string}} */
function parseCron(raw) {
  const f = raw.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`expected 5 fields, got ${f.length}: "${raw}"`);
  return {
    raw,
    minute: expandField(f[0], 0, 59),
    hour: expandField(f[1], 0, 23),
    dom: expandField(f[2], 1, 31),
    month: expandField(f[3], 1, 12),
    dow: expandField(f[4], 0, 7), // 0 and 7 both mean Sunday
  };
}

/** Does this cron fire at the given UTC weekday+hour? (dow 0..6, Sun=0) */
function firesAt(cron, dowUtc, hourUtc, monthUtc) {
  const dowOk = cron.dow.has(dowUtc) || (dowUtc === 0 && cron.dow.has(7));
  return dowOk && cron.hour.has(hourUtc) && cron.month.has(monthUtc);
}

// ── workflow loading ────────────────────────────────────────────────────────────
function loadWorkflows() {
  return readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).map((file) => {
    const text = readFileSync(join(WF_DIR, file), "utf8");
    const crons = [...text.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    return {
      file,
      text,
      crons,
      declaresSchedule: /^\s*schedule:/m.test(text),
      declaresDispatch: /workflow_dispatch/.test(text),
      declaresPush: /^\s*push:/m.test(text),
    };
  });
}

/**
 * EXPECTED CALENDAR — the contract. Each entry says: this workflow must have a cron window that
 * fires on these UTC weekdays, within this UTC hour range.
 *
 * TIMEZONE ASSUMPTION, stated explicitly because it is where the original bug lived:
 * schedules are written in UTC; the business events are in US Eastern (EDT = UTC-4 in season).
 * A 22:59 ET draw on Monday is 02:59 UTC on TUESDAY. Coverage therefore needs BOTH the Monday
 * late-evening UTC window AND the Tuesday early-morning UTC window. Omitting the second half is
 * exactly how the Mon/Wed defect happened.
 */
const EXPECTED = [
  {
    // Issue #246: produtor do cache ao vivo. Se deixar de rodar, `live_sports_cache` envelhece
    // alem do teto de 10 min do gateway e o hero volta a SOURCE_UNAVAILABLE -- o mesmo sintoma do
    // incidente, so que por ausencia de cron em vez de bloqueio da Akamai. A janela vem do
    // histograma das 532 partidas com data nos snapshots de br2026+cdb2026: kickoffs as 14h e das
    // 18h as 00h UTC, e ZERO partidas entre 01h e 13h.
    file: "live_cache_producer.yml",
    why: "sem este produtor o cache ao vivo expira e o gateway volta a SOURCE_UNAVAILABLE durante jogo",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [14, 23], overnight: [0, 2] },
  },
  {
    // Issue #180: vigia do e-mail de resultado do CDB2026. Ele nao envia nada -- le o ledger
    // duravel e responde "terminou uma perna e o e-mail nao saiu?". Se deixar de rodar, volta-se
    // ao estado que a #180 descreve: uma lacuna e um dia tranquilo produzem o mesmo verde.
    // Duas execucoes diarias, longe das janelas de envio (16-23 e 0-5 UTC), porque a folga de 3h
    // do proprio detector ja evita acusar perna recente.
    file: "cdb2026_result_email_watch.yml",
    why: "sem este vigia, e-mail de resultado perdido volta a ser indistinguivel de dia tranquilo",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [20, 20], overnight: [8, 8] },
  },
  {
    file: "powerball-results-email.yml",
    why: "Powerball draws Mon/Wed/Sat 22:59 ET; results land after the draw",
    // ET draw day -> (UTC weekday of the late-evening window, UTC weekday of the after-midnight window)
    // Each event pins the UTC weekday to the SPECIFIC window that must cover it. The draw itself
    // happens at 22:59 ET, i.e. 02:59 UTC on the FOLLOWING UTC day, so the mandatory coverage is the
    // overnight window on `afterUtcDow`. Pinning dow to window is what makes this test able to
    // reject the historical bug: the buggy schedule fired Tuesday EVENING, which looks like
    // "something runs on Tuesday" but is 18:00-19:59 ET Monday — hours BEFORE the draw.
    events: [
      { label: "Monday draw",    afterUtcDow: 2, drawDayUtcDow: 1 },
      { label: "Wednesday draw", afterUtcDow: 4, drawDayUtcDow: 3 },
      { label: "Saturday draw",  afterUtcDow: 0, drawDayUtcDow: 6 },
    ],
    hourWindows: { evening: [22, 23], overnight: [0, 6] },
  },
  {
    file: "cdb2026_result_emails.yml",
    why: "CDB2026 is the live competition; result emails must run every day in the match window",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [16, 23], overnight: [0, 5] },
  },
  {
    file: "br2026_round_emails.yml",
    why: "BR2026 round emails run daily in the evening kickoff window",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [21, 23], overnight: [0, 4] },
  },
  {
    // Vigia da tabela oficial das quartas do CDB. Se deixar de rodar, os palpites nunca abrem
    // sozinhos e a transicao volta a depender de alguem perceber que a CBF publicou.
    file: "cdb2026_schedule_watch.yml",
    why: "sem este vigia a abertura dos palpites das quartas volta a depender de intervencao manual",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [16, 23], overnight: [0, 6] },
  },
  {
    // Atualizacao de jackpot do sorteio ABERTO. Nao envia e-mail e nao toca em resultado; se
    // deixar de rodar, a pagina publica de um bolao aberto volta a mostrar estado de espera com
    // o valor oficial ja disponivel -- que foi o defeito de 2026-08-11.
    file: "powerball_jackpot_refresh.yml",
    why: "sem esta atualizacao o sorteio ABERTO exibe estado de espera com o jackpot oficial ja publicado",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [18, 23], overnight: [0, 6] },
  },
  {
    // 2026-08-08: era UNSCHEDULED, e a nota lá já dizia que a defasagem do snapshot era ilimitada
    // (DG-04). O efeito real foi medido no mesmo dia: `bolao/br2026/data/espn-normalized.json`
    // tinha UM único commit em toda a história (o da migração), então o hero de jogo ao vivo nunca
    // podia aparecer em app nenhum. O schedule existe agora, na MESMA janela dos emails de
    // resultado — as duas coisas dependem exatamente do mesmo dado.
    file: "bolao_provider_snapshot.yml",
    why: "the ESPN snapshot is the ONLY match-data source the browsers read; it must refresh " +
         "every day in the match window or live matches can never appear",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [16, 23], overnight: [0, 5] },
  },
  {
    // Consumidor do comprovante de "entrada salva". Drena os eventos de
    // `cdb2026.entry_saved_confirmation` de 5 em 5 minutos, o dia inteiro.
    //
    // O QUE ESTA COBERTURA PROTEGE: o participante salva a entrada e espera o comprovante. Se o
    // consumidor deixar de rodar, o evento fica na fila e o e-mail simplesmente nunca sai -- sem
    // erro, sem run vermelho, sem sinal nenhum. Nao ha janela de negocio aqui: alguem pode salvar
    // a qualquer hora, entao a exigencia e cobertura em TODOS os dias, e nao so numa janela.
    //
    // O teto de envio nao vem do cron e sim do banco (permissao nominal que se apaga na primeira
    // entrega + UNIQUE em notification_deliveries), entao rodar com folga e barato e nao arrisca
    // envio duplo -- ver o cabecalho do proprio workflow.
    file: "cdb2026_entry_saved_confirmation.yml",
    why: "sem este consumidor o comprovante de entrada salva fica parado na fila e nunca chega ao " +
         "participante -- a ausencia de envio nao produz nenhum sinal de erro",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [0, 23], overnight: [0, 23] },
  },
  {
    // Engineering Sentinel V1.0-A (scripts/sentinel/). Nao envia e-mail, nao toca em nenhum
    // ledger de notificacao -- e monitoramento (deteccao CHANGE_INTENT Stale -> GitHub Issue).
    // Mesma forma do consumidor de comprovante acima: nao ha janela de negocio, o requisito e
    // rodar pelo menos uma vez por dia, qualquer hora. Se este cron parar de disparar, o unico
    // efeito e "Sentinel nao detecta nada hoje" -- nunca bloqueia desenvolvimento normal nem
    // notificacao existente (ver docs/bolao/sentinel/README.md, secao Failure Semantics).
    file: "sentinel.yml",
    why: "Sentinel V1.0-A e monitoramento, nao notificacao -- cobertura diaria evita que o cron " +
         "fique parado sem ninguem perceber, mas a ausencia nunca afeta um participante real",
    events: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: `UTC dow ${d}`, utcDows: [d] })),
    hourWindows: { evening: [0, 23], overnight: [0, 23] },
  },
  {
    // Coleta do resultado oficial das duas loterias. Nao envia e-mail e nao credita premio: e o
    // passo que REGISTRA o que a fonte publicou. Se ele nao rodar, todo o resto do pipeline
    // (e-mail de resultado, saldo, elegibilidade) fica sem insumo.
    //
    // Mesma aritmetica de fuso do powerball-results-email acima, e pela mesma razao: Powerball
    // sorteia seg/qua/sab 22:59 ET e Mega Millions ter/sex 23:00 ET, entao o instante do sorteio
    // cai em ~03:00 UTC do dia SEGUINTE. A cobertura obrigatoria e a janela da madrugada UTC no
    // dia seguinte ao sorteio -- exatamente o erro que derrubou o Powerball em 2026-08-06 se for
    // ancorada no dia da noite do sorteio.
    file: "lottery_poll.yml",
    why: "sem esta coleta nenhum resultado oficial e registrado, e todo o pipeline de loteria " +
         "(e-mail, saldo, elegibilidade) fica sem insumo",
    events: [
      { label: "Powerball Monday draw",       afterUtcDow: 2 },
      { label: "Powerball Wednesday draw",    afterUtcDow: 4 },
      { label: "Powerball Saturday draw",     afterUtcDow: 0 },
      { label: "Mega Millions Tuesday draw",  afterUtcDow: 3 },
      { label: "Mega Millions Friday draw",   afterUtcDow: 6 },
    ],
    hourWindows: { evening: [22, 23], overnight: [0, 6] },
  },
];

/**
 * DORMANT — declares a schedule that cannot fire in the general case, deliberately.
 * Listing a workflow here is an assertion that the dormancy is intended and understood.
 */
const DORMANT = new Map([
  ["auto_results.yml",
   "Copa do Mundo 2026 concluded 2026-07-19 and is archived. The month filter `* 6-7 *` restricts " +
   "firing to June/July, so it is permanently dormant by design. Retire deliberately; do not " +
   "'fix' the schedule."],
]);

/** Declares no schedule at all, deliberately. */
const UNSCHEDULED = new Map([
  ["powerball_record_payment.yml",
   "Painel de administracao do Powerball (Issue #130, Opcao C). NAO e agendado porque nao e um " +
   "ciclo: e um operador humano registrando um pagamento que acabou de acontecer. Um cron aqui nao " +
   "teria o que fazer -- nao existe 'pagamento pendente' que o sistema descubra sozinho; a " +
   "informacao chega por Zelle/Venmo, fora do repositorio. O formulario do workflow_dispatch E a " +
   "interface: autenticacao do GitHub em vez de um hash de senha no navegador, credencial " +
   "privilegiada que nunca sai do runner, e o log da execucao como trilha de auditoria. " +
   "`apply` e false por default, entao o caminho seguro e o que acontece quando ninguem pensa."],
  ["cdb2026_qf_reminder.yml",
   "Lembrete unico para quem ainda nao concluiu os palpites das quartas. NAO e agendado de " +
   "proposito: e uma CAMPANHA com janela propria (o prazo das quartas), nao um ciclo. Um cron " +
   "aqui transformaria 'lembrar uma vez' em 'lembrar toda hora', e a unica coisa entre isso e a " +
   "caixa de entrada do participante passaria a ser o ledger -- uma trava em vez de duas. Pior: " +
   "o modo de envio ROTACIONA a credencial de acesso antes de mandar, entao um disparo repetido " +
   "nao seria so e-mail a mais, seria o link da pessoa morrendo de novo a cada volta do relogio. " +
   "A ausencia aqui nao e silenciosa como a de um consumidor de fila: se o lembrete nao sair, o " +
   "operador ve o manifesto no modo `medir` e dispara a mao."],
  ["safety_check.yml",
   "Contrato permanente de seguranca de mudanca. NAO e agendado de proposito: ele reage a " +
   "MUDANCA, nao ao relogio. Os gates deste repositorio protegem superficies criticas contra o " +
   "que um commit faz com elas, entao o evento certo e `pull_request` + `push` em main -- rodar " +
   "de hora em hora sobre um repositorio parado gastaria minuto de runner para reprovar sempre " +
   "a mesma coisa ou passar sempre pelo mesmo motivo. Um cron aqui tambem daria a impressao " +
   "errada de que a verificacao acontece 'sozinha' quando na verdade ela precisa acontecer " +
   "ANTES de a mudanca entrar."],
  ["cdb2026_register_topology.yml",
   "Registro da topologia oficial da semifinal (caminho ate a final definido no sorteio de " +
   "2026-08-11). Ato UNICO e deliberado: a funcao recusa sobrescrever topologia ja registrada " +
   "com outra diferente, porque mudar o caminho depois que participantes palpitaram reescreveria " +
   "o significado dos palpites. Agendar nao faria sentido -- nao ha evento recorrente."],
  ["cdb2026_restore_picks.yml",
   "Restauracao de palpites de UMA entrada, a partir de backup verificado. Acionamento humano " +
   "com entrada e conteudo passados a mao. NAO agendado de proposito: um script que restaura " +
   "palpite sozinho e um script que pode desfazer o palpite de alguem sem ninguem pedir. " +
   "Criado em 2026-08-12, quando um canario substituiu os palpites reais de um participante."],
  ["copa2026_operator.yml",
   "CLI de operador da Copa: so roda por acionamento humano com uma operacao escolhida a mao " +
   "(workflow_dispatch com input `command`). Agendar seria executar mutacao de operador sem " +
   "ninguem ter pedido -- e a Copa esta ARQUIVADA desde 19/07, entao nao existe evento recorrente " +
   "que justifique uma execucao automatica."],
  ["m8m9_probe.yml",
   "Diagnostico sob demanda de M8/M9: mede o alcance real do PostgREST para audit_events/" +
   "outbox_events e roda a matriz de queda contra a producao. Deliberadamente NAO agendado -- a " +
   "matriz espera ~70s de backoff real do outbox e escreve eventos de canario na fila de " +
   "producao (removidos ao fim). Rodar sozinho de tempos em tempos seria escrita e ruido sem " +
   "nenhum evento de negocio por tras. Executado apos mudanca na ponte M8/M9."],
  ["deploy-pages.yml", "Triggered by push to main."],
  ["sync_version.yml", "Triggered by push to main, path-filtered."],
  ["cdb2026_operator.yml",
   "Operacao de operador do CDB2026 (snapshot, sorteio oficial, abertura de palpites). E disparada " +
   "por uma DECISAO humana -- aplicar um sorteio oficial nao tem cadencia. Agendar isto seria " +
   "gravar estado de competicao por relogio, que e exatamente o que nao pode acontecer."],
  ["cdb2026_grant_receipt_allowance.yml",
   "Concede a permissao nominal de comprovante para o roster congelado. E o ato que ARMA o envio: " +
   "o consumidor agendado so manda e-mail para quem tem permissao aberta. Agendar a concessao " +
   "destruiria o proprio controle -- a permissao existe justamente para que nenhum envio comece " +
   "sem uma decisao humana nomeada. Nao envia e-mail; so grava a permissao."],
  ["cdb2026_receipt_catchup.yml",
   "Catch-up de comprovantes, com escopo SEMPRE explicito: `medir` e so leitura e `enviar` exige a " +
   "data alvo digitada a mao, o manifesto do run de medicao e a frase de aprovacao. Substitui os " +
   "dois one-off de 12/08 e 16/08 (scripts arquivados e desarmados). NAO agendado de proposito: " +
   "um catch-up que dispara sozinho e um reenvio em massa sem ninguem ter pedido."],
  ["cdb2026_receipt_template_test.yml",
   "UM e-mail de validacao de template para o proprio operador, atras de --approve HUMAN_APPROVED. " +
   "Familia de negocio separada, nao toca o historico de entrega de producao. Agendar um workflow " +
   "cujo unico efeito e mandar e-mail de teste seria ruido recorrente na caixa de alguem."],
  ["cdb2026_confirmation_readiness.yml",
   "Prontidao (so leitura) antes de o operador validar UM e-mail: confere se ha permissao aberta, " +
   "se a chave de negocio ainda esta sem entrega e se a credencial do participante esta viva. " +
   "Responde a uma pergunta pontual de operacao; sem decisao humana em curso a resposta nao " +
   "interessa a ninguem. Incapaz de enviar (nao define BOLAO_ALLOW_REAL_SEND)."],
  ["cdb2026_confirmation_forensics.yml",
   "Pericia SO LEITURA do caminho do comprovante, para depois do fato. Incapaz de enviar: nao " +
   "define BOLAO_ALLOW_REAL_SEND e o script periciado nao importa transporte nem expoe --run. " +
   "Roda quando alguem esta investigando algo -- nao ha evento recorrente que a justifique."],
  ["cdb2026_confirmation_fake_transport_test.yml",
   "Prova do consumidor com TRANSPORTE FALSO. Vive aqui, e nao na maquina do operador, porque " +
   "precisa da SUPABASE_SERVICE_ROLE_KEY (secret do repositorio) e do banco real -- fila, reserva " +
   "e unicidade. Deliberadamente so workflow_dispatch: um teste que mexe na fila REAL nao deve " +
   "rodar sozinho a cada push."],
  ["lottery_production_state.yml",
   "Leitura do estado de producao das loterias, com reparo sob demanda. A credencial de servico " +
   "vive no repositorio, entao esta e a unica forma de inspecionar o estado real sem copiar " +
   "segredo para fora. `repair=true` fecha uma obrigacao orfa do outbox e so quando o ledger por " +
   "destinatario ja prova a entrega -- uma escrita corretiva assim precisa de um humano decidindo, " +
   "nunca de um relogio. Nenhum caminho envia e-mail."],
]);

const workflows = loadWorkflows();
const byFile = new Map(workflows.map((w) => [w.file, w]));

console.log("\nScheduled-workflow coverage\n");

// ── structural checks ───────────────────────────────────────────────────────────
test("every workflow referenced by the expected calendar exists", () => {
  const missing = EXPECTED.filter((e) => !byFile.has(e.file)).map((e) => e.file);
  assert(missing.length === 0, `missing workflow file(s): ${missing.join(", ")}`);
});

test("every cron expression parses and is well-formed", () => {
  const bad = [];
  for (const w of workflows) {
    for (const c of w.crons) {
      try { parseCron(c); } catch (e) { bad.push(`${w.file}: ${e.message}`); }
    }
  }
  assert(bad.length === 0, `malformed cron(s):\n      ${bad.join("\n      ")}`);
});

test("no cron is impossible (a schedule that can never fire)", () => {
  const impossible = [];
  for (const w of workflows) {
    for (const c of w.crons) {
      const p = parseCron(c);
      for (const [name, set] of [["minute", p.minute], ["hour", p.hour], ["dom", p.dom],
                                 ["month", p.month], ["dow", p.dow]]) {
        if (set.size === 0) impossible.push(`${w.file}: "${c}" matches no ${name}`);
      }
      // day-of-month restricted AND day-of-week restricted is a cron footgun: they OR together,
      // which is almost never what an author means.
      const domRestricted = p.dom.size < 31, dowRestricted = p.dow.size < 8;
      if (domRestricted && dowRestricted) {
        impossible.push(`${w.file}: "${c}" restricts BOTH day-of-month and day-of-week — ` +
          `cron ORs these, so it fires more often than it appears to`);
      }
    }
  }
  assert(impossible.length === 0, `\n      ${impossible.join("\n      ")}`);
});

test("no workflow claims a schedule while defining zero crons", () => {
  const liars = workflows
    .filter((w) => w.declaresSchedule && w.crons.length === 0)
    .map((w) => w.file);
  assert(liars.length === 0,
    `workflow(s) declare schedule: but define no cron — they will never run: ${liars.join(", ")}`);
});

test("no unintended duplicate cron within one workflow", () => {
  const dups = [];
  for (const w of workflows) {
    const seen = new Set();
    for (const c of w.crons) {
      const norm = c.trim().replace(/\s+/g, " ");
      if (seen.has(norm)) dups.push(`${w.file}: "${norm}" appears more than once`);
      seen.add(norm);
    }
  }
  assert(dups.length === 0, `\n      ${dups.join("\n      ")}`);
});

test("every scheduled workflow is either covered by the calendar or declared dormant", () => {
  const expectedFiles = new Set(EXPECTED.map((e) => e.file));
  const unaccounted = workflows
    .filter((w) => w.crons.length > 0 && !expectedFiles.has(w.file) && !DORMANT.has(w.file))
    .map((w) => w.file);
  assert(unaccounted.length === 0,
    `scheduled but neither covered nor declared dormant: ${unaccounted.join(", ")}. ` +
    `Add it to EXPECTED or to DORMANT with a written reason.`);
});

test("every unscheduled workflow is declared, with a reason", () => {
  const undeclared = workflows
    .filter((w) => w.crons.length === 0 && !UNSCHEDULED.has(w.file))
    .map((w) => w.file);
  assert(undeclared.length === 0,
    `no schedule and not declared in UNSCHEDULED: ${undeclared.join(", ")}`);
});

test("declared-dormant workflows really are dormant (documentation matches reality)", () => {
  const wrong = [];
  for (const [file, reason] of DORMANT) {
    const w = byFile.get(file);
    if (!w) { wrong.push(`${file}: declared dormant but the file is gone`); continue; }
    const monthRestricted = w.crons.some((c) => parseCron(c).month.size < 12);
    assert(reason.length > 20, `${file}: dormancy reason is too thin to be a decision`);
    if (!monthRestricted) {
      wrong.push(`${file}: declared dormant, but no cron restricts the month — it CAN fire`);
    }
  }
  assert(wrong.length === 0, `\n      ${wrong.join("\n      ")}`);
});

/**
 * Is this event covered? An event with `afterUtcDow` REQUIRES a firing on that UTC weekday inside the
 * overnight window — that is the window containing the actual 22:59 ET event. `drawDayUtcDow` evening
 * coverage is a useful lead-in but is NOT sufficient on its own.
 * Events expressed as a plain `utcDows` list (the daily competitions) accept either window.
 */
function eventCovered(ev, crons, hourWindows) {
  const [eLo, eHi] = hourWindows.evening;
  const [oLo, oHi] = hourWindows.overnight;
  const firesInWindow = (dow, lo, hi) =>
    crons.some((c) => { for (let h = lo; h <= hi; h++) if (firesAt(c, dow, h, 8)) return true; return false; });
  if (typeof ev.afterUtcDow === "number") {
    return firesInWindow(ev.afterUtcDow, oLo, oHi);
  }
  return ev.utcDows.some((dow) => firesInWindow(dow, eLo, eHi) || firesInWindow(dow, oLo, oHi));
}

// ── coverage checks — the point of the file ─────────────────────────────────────
for (const spec of EXPECTED) {
  test(`${spec.file}: covers every expected event (${spec.why})`, () => {
    const w = byFile.get(spec.file);
    assert(w && w.crons.length > 0, `${spec.file} has no cron`);
    const crons = w.crons.map(parseCron);
    const gaps = spec.events.filter((ev) => !eventCovered(ev, crons, spec.hourWindows))
                            .map((ev) => ev.label);
    assert(gaps.length === 0,
      `uncovered event(s): ${gaps.join(", ")} — a cron that does not fire produces NO signal`);
  });
}

test("REGRESSION: the historical Tue+Sat-only Powerball schedule is rejected", () => {
  // The exact defect from 2026-08-06, as a fixture. This is the acceptance criterion for this
  // whole file: it must FAIL against the buggy schedule and PASS against the fixed one.
  const buggy = ["*/10 22-23 * * 2", "*/10 0-6 * * 3", "*/10 22-23 * * 6", "*/10 0-6 * * 0"]
    .map(parseCron);
  const spec = EXPECTED.find((e) => e.file === "powerball-results-email.yml");
  const uncovered = spec.events.filter((ev) => !eventCovered(ev, buggy, spec.hourWindows));
  assert(uncovered.length > 0,
    "the buggy Tue+Sat-only schedule was NOT rejected — this test cannot catch the defect it exists for");
  const labels = uncovered.map((e) => e.label);
  assert(labels.includes("Monday draw"),
    `expected the Monday gap to be detected, got: ${labels.join(", ")}`);
});

test("Powerball has DAILY catch-up coverage after the draw-night window closes", () => {
  // THE 2026-08-10 DEFECT. The draw-night windows end at 06:50 UTC and silently assume the
  // official source publishes within them. data.ny.gov published the 08-10 row AFTER the last
  // scheduled run (07:11 UTC), and no run existed again until the next draw night — so the
  // result sat there, available, and the email never went out. Every run that night was GREEN,
  // because "not published yet" is a normal state that exits 0.
  //
  // Draw-night coverage alone cannot detect this: the previous version of this file asserted
  // exactly that and passed throughout the incident. What must be true is that the schedule
  // REVISITS the day AFTER the overnight window closes.
  const w = byFile.get("powerball-results-email.yml");
  const crons = w.crons.map(parseCron);

  // Hours 7..21 UTC — the blind spot between the overnight window (ends 06:50) and the next
  // evening window (starts 22:00). At least one cron must fire in there, every day of the week.
  const cobreHora = (h, dow) => crons.some((c) => firesAt(c, dow, h, 1));

  const diasSemCatchUp = [];
  for (let dow = 0; dow <= 6; dow++) {
    const horasCobertas = [];
    for (let h = 7; h <= 21; h++) if (cobreHora(h, dow)) horasCobertas.push(h);
    if (horasCobertas.length === 0) diasSemCatchUp.push(dow);
  }
  assert(diasSemCatchUp.length === 0,
    `sem catch-up diurno nos dias (UTC dow): ${diasSemCatchUp.join(", ")} — ` +
    "um resultado publicado tarde nao seria revisitado, que foi exatamente o 2026-08-10");

  // E o intervalo entre revisitas nao pode virar um novo buraco de meio dia.
  const horasCatchUp = [];
  for (let h = 7; h <= 21; h++) if (cobreHora(h, 1)) horasCatchUp.push(h);
  const maiorSalto = Math.max(...horasCatchUp.slice(1).map((h, i) => h - horasCatchUp[i]));
  assert(maiorSalto <= 6,
    `maior intervalo entre revisitas e ${maiorSalto}h — grande demais para um e-mail de resultado`);
});

test("REGRESSION: draw-night-only coverage is rejected as insufficient", () => {
  // Acceptance criterion for the test above: the schedule as it existed DURING the incident --
  // correct draw-night coverage, zero catch-up -- must be rejected. Without this, the new test
  // could be trivially satisfied and would not encode the defect it exists for.
  const noIncidente = [
    "*/10 22-23 * * 1", "*/10 0-6 * * 2",
    "*/10 22-23 * * 3", "*/10 0-6 * * 4",
    "*/10 22-23 * * 6", "*/10 0-6 * * 0",
  ].map(parseCron);

  const cobreHora = (h, dow) => noIncidente.some((c) => firesAt(c, dow, h, 1));
  let algumaHoraDiurna = false;
  for (let dow = 0; dow <= 6; dow++)
    for (let h = 7; h <= 21; h++) if (cobreHora(h, dow)) algumaHoraDiurna = true;

  assert(!algumaHoraDiurna,
    "o cronograma do incidente foi considerado coberto — este teste nao pega o defeito que existe para pegar");
});

test("timezone assumption is documented in the workflow itself", () => {
  // The UTC↔ET offset arithmetic is hand-written and unverifiable from the cron alone. The only
  // defence is that the intent is written down next to it.
  const w = byFile.get("powerball-results-email.yml");
  assert(/ET\b|EDT|Eastern/i.test(w.text),
    "powerball-results-email.yml no longer states its timezone assumption — the UTC offsets " +
    "become unreviewable, which is how the Mon/Wed defect survived");
  assert(/UTC/.test(w.text), "workflow does not state that crons are UTC");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ CRON COVERAGE PASSED\n" : "✗ CRON COVERAGE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
