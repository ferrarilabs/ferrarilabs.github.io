#!/usr/bin/env node
/**
 * test_safety_contract.mjs — as MUTACOES que provam que o contrato morde.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────────────────────
 *
 * Um gate que nunca fica vermelho e indistinguivel de um gate desligado. Os dois passam sempre,
 * os dois aparecem na lista, e os dois dao a mesma sensacao de cobertura. A unica diferenca so
 * aparece no dia da regressao — tarde demais para descobrir.
 *
 * Este repositorio ja pagou por essa confusao: em 2026-08-10 uma auditoria achou 17 gates que
 * existiam e nunca rodavam, e um deles estava VERMELHO havia commits tendo pego uma regressao
 * real que nenhuma suite reportou. "Estar no repositorio" nunca foi prova de proteger.
 *
 * Entao este arquivo nao pergunta "o contrato aceita o estado bom?". Ele QUEBRA cada superficie
 * critica, uma por vez, e exige VERMELHO no check especifico que deveria pega-la. Exigir apenas
 * "ficou vermelho em algum lugar" seria fraco demais: um contrato que reprova tudo por um motivo
 * so tambem passaria nesse teste, e nao saberia distinguir um cron apagado de um token perdido.
 *
 * ─── SEGURANCA DESTE PROPRIO ARQUIVO ─────────────────────────────────────────────────────────
 *
 * Toda mutacao e escrita no disco e desfeita BYTE A BYTE no `finally`, com o conteudo original
 * guardado em memoria antes de qualquer escrita. No fim, a secao Z reconfere por hash que cada
 * arquivo tocado voltou identico. Nenhuma mutacao toca dado de participante, banco, provedor de
 * e-mail ou rede: todas mexem em arquivo de configuracao, workflow ou CSS do repositorio.
 *
 * Uso: node scripts/safety/test_safety_contract.mjs
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./surfaces.mjs";

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const abs = (p) => join(ROOT, p);
const sha = (p) => createHash("sha256").update(readFileSync(abs(p))).digest("hex");

/** Executa o contrato e devolve o mapa id -> FAILED/PASSED/SKIPPED. */
function runContract() {
  const r = spawnSync("node", ["scripts/safety/audit_safety_contract.mjs", "--json"],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const out = JSON.parse(r.stdout);
  const status = {};
  for (const f of out.findings) status[f.id] = "FAILED";
  for (const f of out.skipped) status[f.id] = "SKIPPED";
  return { status, exit: r.status, totals: out.totals };
}

const touched = new Set();

/**
 * Arquivos JA modificados antes desta suite rodar. Sem isto, rodar as mutacoes numa arvore com
 * trabalho em andamento acusaria "a suite sujou o repositorio" quando quem sujou foi o
 * desenvolvedor — um falso vermelho que ensina a ignorar a checagem de restauracao, que e
 * justamente a checagem que nao pode ser ignorada num arquivo que escreve no disco.
 */
const preexisting = new Set(
  (spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout || "")
    .split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.slice(3)));

/** Hashes de antes, para provar restauracao byte a byte independentemente do git. */
const hashesBefore = new Map();

/**
 * Aplica uma mutacao, exige VERMELHO no check nomeado, e restaura byte a byte.
 * `expectId` pode ser string ou lista — quando a mutacao pode ser pega por mais de um check,
 * basta que UM deles seja o esperado, mas nunca "qualquer vermelho".
 */
function mutate(label, file, transform, expectId) {
  const original = readFileSync(abs(file));
  touched.add(file);
  if (!hashesBefore.has(file)) hashesBefore.set(file, sha(file));
  const wanted = Array.isArray(expectId) ? expectId : [expectId];
  try {
    const mutated = transform(original.toString("utf8"));
    assert(mutated !== original.toString("utf8"), `a mutacao "${label}" nao alterou ${file}`);
    writeFileSync(abs(file), mutated);
    const { status } = runContract();
    const caught = wanted.filter((id) => status[id] === "FAILED");
    assert(caught.length > 0,
      `${label} => NAO PEGA. Esperado FAILED em [${wanted.join(", ")}], obtido: ` +
      `${wanted.map((id) => `${id}=${status[id] || "PASSED"}`).join(", ")}`);
  } finally {
    writeFileSync(abs(file), original);
  }
}

/** Mutacao que CRIA um arquivo (nao existe original para guardar). */
function mutateNewFile(label, file, content, expectId) {
  assert(!existsSync(abs(file)), `${file} ja existe — a mutacao "${label}" sobrescreveria conteudo real`);
  try {
    writeFileSync(abs(file), content);
    const { status } = runContract();
    assert(status[expectId] === "FAILED",
      `${label} => NAO PEGA. Esperado FAILED em ${expectId}, obtido ${status[expectId] || "PASSED"}`);
  } finally {
    if (existsSync(abs(file))) unlinkSync(abs(file));
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════

console.log("\nMUTACOES DO CONTRATO DE SEGURANCA\n");
console.log("A. Estado limpo");

const baseline = runContract();
test("o contrato passa no estado atual do repositorio", () => {
  assert(baseline.exit === 0,
    `o contrato ja esta VERMELHO antes de qualquer mutacao (${baseline.totals.fail} falha(s)) — ` +
    `mutacao sobre suite vermelha nao prova nada`);
});

console.log("\nB. As oito mutacoes exigidas pelo contrato");

test("M1 elemento estrutural do hero removido => PEGA", () => {
  // O `heroMatches` do BR2026: perder este ancora e reintroduzir exatamente a regressao de
  // 2026-08-16, em que uma rodada com tres jogos simultaneos mostrava UM.
  mutate("hero sem heroMatches", "bolao/br2026/js/app.js",
    (t) => t.replace(/heroMatches/g, "featuredMatch"), "H:br2026");
});

test("M2 token compartilhado de aparencia removido => PEGA", () => {
  mutate("tokens.css sem --radius-pill", "bolao/shared/css/tokens.css",
    (t) => t.replace(/^\s*--radius-pill\s*:.*$/m, "  /* removido */"), "L1");
});

test("M3 constante de scoring alterada => PEGA", () => {
  // Rateio do premio: 70/20/10 -> 60/30/10. Dinheiro real por entrada.
  mutate("prizes do BR2026 alterado", "bolao/br2026/js/config.js",
    (t) => t.replace("first: 0.70, second: 0.20", "first: 0.60, second: 0.30"), "S1");
});

test("M4 gate removido da cadeia do npm test => PEGA", () => {
  mutate("test:scoring sem audit_scoring do CDB", "package.json",
    (t) => t.replace(" && python3 bolao/cdb2026/scripts/audit_scoring.py", ""), "G4");
});

test("M5 cron de workflow alterado => PEGA", () => {
  // A classe de defeito real: powerball-results-email.yml agendava ter+sab enquanto os sorteios
  // sao seg/qua/sab, e o unico sinal foi a AUSENCIA de e-mail.
  mutate("cron de segunda do Powerball apagado", ".github/workflows/powerball-results-email.yml",
    (t) => t.replace("- cron: '*/10 22-23 * * 1'", "- cron: '*/10 22-23 * * 2'"),
    "N:POWERBALL_RESULTS_EMAIL");
});

test("M6 guard de envio real removido => PEGA", () => {
  mutate("br2026_round_emails sem BOLAO_ALLOW_REAL_SEND", ".github/workflows/br2026_round_emails.yml",
    (t) => t.replace(/^\s*BOLAO_ALLOW_REAL_SEND:.*$/m, "          # guard removido"),
    "N:BR2026_ROUND_EMAILS");
});

test("M7 rollback SQL colocado sob migrations/ => PEGA", () => {
  mutateNewFile("rollback na historia de avanco",
    "supabase/migrations/20260817000000_undo_m9.rollback.sql",
    "-- MUTACAO DE TESTE: este arquivo e criado e apagado por test_safety_contract.mjs.\nDROP TABLE IF EXISTS outbox_events;\n",
    "M1");
});

test("M8 allowlist visual alargada => PEGA", () => {
  mutate("ALLOWLIST.json com uma entrada a mais",
    "docs/bolao/evidence/visual-comparison/ALLOWLIST.json", (t) => {
      const a = JSON.parse(t);
      a.entries.push({ ...a.entries[0], component: "mutacao-de-teste", property: "color" });
      return JSON.stringify(a, null, 2) + "\n";
    }, "G8");
});

console.log("\nC. Mutacoes adicionais sobre a autoprotecao dos gates");

test("M9 check removido do verify.mjs => PEGA", () => {
  mutate("verify.mjs sem o check de scoring da Copa", "scripts/verify.mjs",
    (t) => t.replace(/\{ id: "scoring-copa"[\s\S]*?\},\n/, ""), "G3");
});

test("M10 sub-suite removida do npm test => PEGA", () => {
  mutate("npm test sem test:notifications", "package.json",
    (t) => JSON.stringify(Object.assign(JSON.parse(t), {
      scripts: Object.assign(JSON.parse(t).scripts, {
        test: JSON.parse(t).scripts.test.replace(" && npm run test:notifications", ""),
      }),
    }), null, 2) + "\n", ["G1", "G4"]);
});

test("M11 gate silenciosamente pulado => PEGA", () => {
  // O marcador e montado por concatenacao de proposito. Escrito por extenso, ESTE arquivo
  // passaria a conter um marcador de skip e o proprio G6 o acusaria — e a saida facil seria
  // isentar o harness da regra. Uma excecao numa regra de seguranca e por onde a porta dos
  // fundos entra (o repositorio ja aprendeu isso com o ALLOWLIST), entao aqui nao ha excecao:
  // o texto INJETADO e identico, e a fonte do harness continua limpa.
  const marker = "pytest.mark" + ".skip";
  mutate("skip introduzido num gate", "bolao/scripts/test_allowlist_conditionality.mjs",
    (t) => t.replace(/^const ROOT/m, `const SKIP_ME = ${marker};\nconst ROOT`), "G6");
});

test("M12 gate esvaziado (assercoes removidas) => PEGA", () => {
  // O arquivo continua existindo, continua na cadeia, continua "passando" — e prova metade.
  mutate("metade das assercoes apagadas de um gate", "bolao/scripts/test_allowlist_conditionality.mjs",
    (t) => {
      let n = 0;
      return t.replace(/\btest\s*\(/g, (m) => (++n % 2 === 0 ? "noop_(" : m));
    }, "G7");
});

test("M13 gatilho do CI estreitado => PEGA", () => {
  mutate("safety_check.yml sem o gatilho de push", ".github/workflows/safety_check.yml",
    (t) => t.replace(/^on:\n  pull_request:\n  push:\n    branches:\n      - main\n/m,
                     "on:\n  pull_request:\n"), "C1");
});

test("M14 comando canonico trocado no CI => PEGA", () => {
  mutate("safety_check.yml rodando outra coisa no lugar de `npm run check`",
    ".github/workflows/safety_check.yml",
    (t) => t.replace("run: npm run check", "run: echo skip"), "C1");
});

test("M15 registro de gates encolhido => PEGA", () => {
  mutate("gate_registry.json com uma entrada a menos", "bolao/scripts/gate_registry.json",
    (t) => {
      const r = JSON.parse(t);
      delete r.entries[Object.keys(r.entries)[0]];
      return JSON.stringify(r, null, 2) + "\n";
    }, "G5");
});

test("M16 workflow de teste ganha guard de envio real => PEGA", () => {
  // A direcao contraria da M6: aqui a AUSENCIA do guard e a propriedade protegida. Um workflow
  // de teste que ganhasse o guard passaria a mandar e-mail de verdade a cada exercicio.
  mutate("workflow de transporte falso armado com guard real",
    ".github/workflows/cdb2026_confirmation_fake_transport_test.yml",
    (t) => t.replace(/^jobs:/m, "env:\n  BOLAO_ALLOW_REAL_SEND: \"I UNDERSTAND\"\n\njobs:"),
    "N:CDB2026_CONFIRMATION_FAKE_TRANSPORT_TEST");
});

// ══ D. REMEDIACOES DE 2026-08-17 ══════════════════════════════════════════════════════════════
//
// As mutacoes acima miram o meta-gate. Estas miram os gates que foram CONSERTADOS nesta sessao:
// um gate recem-corrigido e exatamente aquele sobre o qual ninguem ainda tem evidencia de que
// continua mordendo. Cada uma roda o gate real e exige saida != 0.

/** Muta um arquivo e exige que o GATE indicado fique vermelho. */
function mutateGate(label, file, transform, gateCmd) {
  const original = readFileSync(abs(file));
  touched.add(file);
  if (!hashesBefore.has(file)) hashesBefore.set(file, sha(file));
  try {
    const mutated = transform(original.toString("utf8"));
    assert(mutated !== original.toString("utf8"), `a mutacao "${label}" nao alterou ${file}`);
    writeFileSync(abs(file), mutated);
    // 300s: a matriz responsiva sobe um navegador e mede 448 verificacoes em 14 larguras x 4
    // apps. Um teto curto aqui nao "pega" nada — so troca o veredito por um timeout, que e um
    // vermelho que nao diz o que houve.
    const r = spawnSync(gateCmd[0], gateCmd.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 300000 });
    assert(r.status !== 0,
      `${label} => NAO PEGA. \`${gateCmd.join(" ")}\` saiu 0 com a mutacao aplicada`);
  } finally {
    writeFileSync(abs(file), original);
  }
}

const GATE_EMAIL = ["python3", "bolao/scripts/test_no_real_email_in_verification.py"];
const GATE_PORTAS = ["node", "bolao/scripts/test_harness_ports_unique.mjs"];

console.log("\nD. Remediacoes desta sessao (gates recem-corrigidos continuam mordendo)");

test("M17 porta de harness duplicada => PEGA", () => {
  // Os numeros sao montados por concatenacao, e nao escritos inteiros.
  //
  // `test_harness_ports_unique.mjs` varre o repositorio procurando `const PORT = NNNN`. Escrita
  // por extenso, a string DESTA mutacao vira uma declaracao de porta aos olhos do scanner — e o
  // gate acusou colisao entre a suite do Powerball e este arquivo, que nao abre socket nenhum.
  // Foi o mesmo erro que ja apareceu duas vezes nesta sessao: gate que le prosa mede prosa.
  //
  // A saida nao e ensinar o scanner a ignorar este arquivo (excecao numa regra de cobertura e por
  // onde a proxima colisao entra) — e nao escrever o padrao aqui. O texto INJETADO e identico.
  const decl = (n) => `const PORT = 82${n};`;
  mutateGate("duas suites na mesma porta",
    "bolao/loterias/powerball/scripts/test_current_balance_unicity.mjs",
    (t) => t.replace(decl("14"), decl("13")), GATE_PORTAS);
});

test("M18 remetente nao declarado falando com o provedor => PEGA", () => {
  // Um sender novo que ninguem registrou e um sender que ninguem revisou.
  mutateGate("sender novo fora do registro", "bolao/cdb2026/scripts/receipt_catchup_tool.py",
    (t) => `import urllib.request\n_U = "https://api.` + `emailjs` + `.com/api/v1.0/email/send"\n${t}`,
    GATE_EMAIL);
});

test("M19 verificador religado ao provedor real => PEGA", () => {
  // A tripwire compartilhada existe para que NENHUM verificador cite o provedor. Voltar a citar
  // dentro de um test_ e exatamente o caminho por onde o operador levou dois e-mails a mais.
  mutateGate("test_ volta a citar o provedor",
    "bolao/cdb2026/scripts/test_entry_saved_confirmation.py",
    (t) => t.replace("import provider_tripwire                   # noqa: E402",
                     `import urllib.request as _r  # noqa: E402\n_ALVO = "https://api.` + `emailjs` + `.com/x"`),
    GATE_EMAIL);
});

test("M20 tripwire enfraquecida para deixar o provedor passar => PEGA", () => {
  // A isencao de TRIPWIRES nao vale por declaracao: o gate EXECUTA a tripwire.
  mutateGate("tripwire deixa de reconhecer o provedor",
    "bolao/shared/scripts/provider_tripwire.py",
    (t) => t.replace("return any(h in u for h in _HOSTS)", "return False"), GATE_EMAIL);
});

test("M21 disjuntor removido de dentro de send_email => PEGA", () => {
  mutateGate("send_email deixa de consultar o disjuntor",
    "bolao/cdb2026/scripts/send_invitation_email.py",
    (t) => t.replace(/    bloqueado, motivo_ks = transport_blocked_by_kill_switch\(\)\n/,
                     "    bloqueado, motivo_ks = (False, None)\n"), GATE_EMAIL);
});

const GATE_NOME = ["node", "bolao/cdb2026/scripts/test_entry_name_readonly.mjs"];

test("M23 nome da entrada volta a ser editavel => PEGA", () => {
  // As DUAS travas de uma vez: a do carregamento por token e a do cartao com roster congelado.
  // Mutar so uma deixaria a outra segurando o campo e o gate passaria — provando nada.
  mutateGate("campo editavel de novo", "bolao/cdb2026/js/app.js",
    (t) => t.replace("  el.readOnly = true;\n  el.setAttribute(\"aria-readonly\", \"true\");",
                     "  el.readOnly = false;")
             .replace("const el = $(id); if (el) el.readOnly = !creating;",
                      "const el = $(id); if (el) el.readOnly = false;"),
    GATE_NOME);
});

test("M24 o save volta a carregar o nome do formulario => PEGA", () => {
  // O caminho que a RPC estreita fechou: se alguem voltar a mandar nome no corpo, a adulteracao
  // do DOM passa a viajar junto — e o teste C existe exatamente para isso.
  mutateGate("save leva entryName no corpo", "bolao/cdb2026/js/app.js",
    (t) => t.replace("        p_picks: picks,\n",
                     "        p_picks: picks,\n        entryName: $(\"entryName\")?.value,\n"),
    GATE_NOME);
});

test("M22 disjuntor deixa de fechar (fechadura quebrada) => PEGA", () => {
  // O modo de falha mais perigoso: o codigo continua consultando, o arquivo continua sendo o
  // mecanismo, e criar o arquivo em producao ja nao para nada.
  mutateGate("transport_blocked_by_kill_switch nunca bloqueia",
    "bolao/cdb2026/scripts/send_invitation_email.py",
    (t) => t.replace("    if KILL_SWITCH.exists():", "    if False:"), GATE_EMAIL);
});

const GATE_RESPONSIVO = ["node", "bolao/scripts/audit_responsive_matrix.mjs"];

test("M25 folga da navegacao removida (estado anterior) => PEGA", () => {
  // Restaura EXATAMENTE os tamanhos de antes da correcao — a condicao de folga zero que fez o
  // primeiro CI acusar `Probabilidades` cortado a 320px e a 902px.
  mutateGate("navegacao volta ao aperto de antes", "bolao/shared/css/responsive.css",
    (t) => t.replace("  .nav button { font-size: 9px; padding: 8px 2px; }",
                     "  .nav button { font-size: 11px; padding: 8px 4px; }")
             .replace("  .nav button { font-size: 10.5px; }",
                      "  .nav button { font-size: 13px; }"),
    GATE_RESPONSIVO);
});

test("M26 rotulo artificialmente mais largo => PEGA", () => {
  // O detector precisa morder por LARGURA DE TEXTO, nao por um numero especifico de fonte. Um
  // rotulo mais longo estoura a mesma coluna de largura fixa, e e assim que a proxima aba nova
  // com nome comprido seria pega antes de chegar ao participante.
  //
  // A mutacao vai no i18n, NAO no index.html. O botao e `data-i18n="navProbs"` e `applyI18n()`
  // reescreve o textContent assim que o app sobe — mutar a marcacao editava um texto que o
  // proprio app substitui em seguida. A primeira versao fazia isso e era INTERMITENTE: passou
  // sozinha e falhou dentro do verify, decidida por qual dos dois chegava primeiro. Teste
  // intermitente e pior que teste nenhum, porque ensina a reexecutar ate passar — e e assim que
  // um vermelho verdadeiro vira ruido.
  mutateGate("rotulo comprido numa aba", "bolao/br2026/js/i18n.js",
    (t) => t.replace('navProbs: "Probabilidades"', 'navProbs: "Probabilidades de Classificacao"'),
    GATE_RESPONSIVO);
});

console.log("\nE. Ciclo de vida CHANGE_INTENT — conditional vs one_shot (ADR-018, Issue #238)");

test("M27 lifecycle conditional rebaixado para one_shot => PEGA", () => {
  // Rebaixar uma declaracao conditional VALIDA de volta para one_shot deve reativar a staleness
  // por diff — exatamente o defeito que o lifecycle model existe para consertar quando feito de
  // proposito (D3), mas que continua reprovando quando feito por acidente ou em ma-fe.
  mutate("conditional vira one_shot", "CHANGE_INTENT.json",
    (t) => t.replace('"lifecycle": "conditional"', '"lifecycle": "one_shot"'), "D3");
});

test("M28 campo lifecycle removido inteiramente => PEGA", () => {
  // Ausencia de `lifecycle` tem o MESMO efeito que "one_shot" explicito (default seguro) — a
  // declaracao volta a staleness por diff e e pega pelo mesmo motivo que M27.
  mutate("lifecycle removido", "CHANGE_INTENT.json",
    (t) => t.replace(/\s*"lifecycle":\s*"conditional",\n/, "\n"), "D3");
});

test("M29 condition_id removido de declaracao conditional => PEGA", () => {
  mutate("condition_id removido", "CHANGE_INTENT.json",
    (t) => t.replace(/\s*"condition_id":\s*"[^"]*",\n/, "\n"), "D1");
});

test("M30 exit_conditions removido de declaracao conditional => PEGA", () => {
  mutate("exit_conditions removido", "CHANGE_INTENT.json",
    (t) => t.replace(/,\s*"exit_conditions":\s*\[[\s\S]*?\]\n(\s*})/, "\n$1"), "D1");
});

test("M31 exit_condition aponta para superficie errada (surface_id trocado) => PEGA", () => {
  // Trocar surface_id para outra superficie real e valida, MANTENDO o check
  // BR2026_ROUND_EMAILS_DISARMED (registrado so para NOTIFICATION_WORKFLOWS) — a declaracao
  // ficaria "protegida" por um invariante que nao verifica nada sobre a superficie nova.
  mutate("surface_id trocado mantendo o check antigo", "CHANGE_INTENT.json",
    (t) => t.replace('"surface_id": "NOTIFICATION_WORKFLOWS"', '"surface_id": "SCORING_CONSTANTS"'), "D1");
});

test("M32 lifecycle com valor malformado (erro de digitacao) => PEGA, nunca vira one_shot nem conditional em silencio", () => {
  mutate("typo em lifecycle", "CHANGE_INTENT.json",
    (t) => t.replace('"lifecycle": "conditional"', '"lifecycle": "conditionall"'), "D1");
});

test("M33 invariante de desarme violado no proprio workflow (nao no CHANGE_INTENT.json) => PEGA", () => {
  // A mutacao mais importante desta secao: prova que D3 nao confia cegamente no JSON dizendo
  // "continua desarmado" — ele LE o arquivo real do workflow a cada execucao. Rearmar o workflow
  // (voltar a --auto + token magico) SEM tocar em CHANGE_INTENT.json ainda reprova D3.
  mutate("workflow rearmado por baixo", ".github/workflows/br2026_round_emails.yml",
    (t) => t.replace("python3 send_round_email.py --dry-run", "python3 send_round_email.py --auto")
             .replace('BOLAO_ALLOW_REAL_SEND: "DISARMED_NEW_INCIDENT_20260818"', 'BOLAO_ALLOW_REAL_SEND: "I UNDERSTAND"'),
    "D3");
});

// ── Limite conhecido, documentado em vez de fingido (STEP 10 item 12) ───────────────────────────
//
// Se alguem APAGAR a declaracao conditional inteira de CHANGE_INTENT.json — sem tocar no arquivo
// do workflow, que continua desarmado por conta do incidente real — NENHUM check existente pega
// isso: D2 so dispara quando um caminho DECLARE_TO_CHANGE aparece no diff (o workflow nao mudou
// nesta arvore), e D3 so avalia declaracoes que EXISTEM. Isto e um limite real do modelo, nao um
// bug deste PR: CHANGE_INTENT.json documenta intenção sobre mudanças/estados detectados por
// diff — ele nunca foi, e este PR nao o torna, uma trava que impede a REMOCAO da propria
// documentacao. Registrar isso explicitamente (em vez de fingir uma protecao que nao existe) é
// exatamente o que ADR-018 pede.
test("LIMITE CONHECIDO: remover a declaracao conditional inteira nao e pego por nenhum check existente (documentado, nao uma regressao deste PR)", () => {
  const original = readFileSync(abs("CHANGE_INTENT.json"), "utf8");
  touched.add("CHANGE_INTENT.json");
  if (!hashesBefore.has("CHANGE_INTENT.json")) hashesBefore.set("CHANGE_INTENT.json", sha("CHANGE_INTENT.json"));
  try {
    const mutated = original.replace(/"declarations":\s*\[[\s\S]*\]\n/, '"declarations": []\n');
    assert(mutated !== original, "a mutacao nao alterou CHANGE_INTENT.json");
    writeFileSync(abs("CHANGE_INTENT.json"), mutated);
    const { status, exit } = runContract();
    assert(exit === 0 && !status.D1 && !status.D2 && !status.D3,
      "esperado: NENHUM check reprova (isso e o limite documentado) — se algo comecou a pegar isso, atualize este teste e o ADR-018, nao remova a checagem");
  } finally {
    writeFileSync(abs("CHANGE_INTENT.json"), original);
  }
});

// ══ Z. RESTAURACAO ════════════════════════════════════════════════════════════════════════════

console.log("\nZ. Nenhuma mutacao ficou para tras");

test("todo arquivo mutado voltou byte a byte (git)", () => {
  const r = spawnSync("git", ["status", "--porcelain", ...touched], { cwd: ROOT, encoding: "utf8" });
  const dirty = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    // Um arquivo que JA estava modificado antes desta suite continua modificado depois: o que
    // importa e que o conteudo seja o mesmo de antes, e a secao seguinte confere isso por hash.
    .filter((l) => !preexisting.has(l.slice(3)));
  assert(dirty.length === 0, `arquivos alterados que nao deviam estar: ${dirty.join(" | ")}`);
});

test("todo arquivo mutado voltou byte a byte (hash sha-256)", () => {
  // Independente do git de proposito: se o indice estivesse mentindo, o hash nao mente.
  const drift = [...hashesBefore].filter(([f, h]) => sha(f) !== h).map(([f]) => f);
  assert(drift.length === 0, `conteudo diferente do original: ${drift.join(", ")}`);
});

test("nenhum artefato de mutacao sobrou no disco", () => {
  const leftovers = ["supabase/migrations/20260817000000_undo_m9.rollback.sql"]
    .filter((p) => existsSync(abs(p)));
  assert(leftovers.length === 0, `sobraram: ${leftovers.join(", ")}`);
});

test("o contrato volta a passar depois de todas as mutacoes", () => {
  const after = runContract();
  assert(after.exit === 0, `o contrato ficou VERMELHO apos as mutacoes (${after.totals.fail} falha(s))`);
  assert(after.totals.pass === baseline.totals.pass,
    `o numero de checks mudou: ${baseline.totals.pass} -> ${after.totals.pass}`);
});

const MUTATIONS = 33;
test(`MUTATIONS_CAUGHT == MUTATIONS_EXECUTED (${MUTATIONS}/${MUTATIONS})`, () => {
  assert(fail === 0, `${fail} mutacao(oes) nao foi(ram) pega(s)`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ ALL MUTATIONS CAUGHT\n" : "✗ MUTATION SUITE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
