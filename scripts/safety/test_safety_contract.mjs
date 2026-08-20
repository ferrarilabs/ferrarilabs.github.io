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

import { readFileSync, writeFileSync, existsSync, unlinkSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
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
 * Worktrees JA existentes antes desta suite rodar (ex.: worktrees de outras tarefas do usuario,
 * como `ferrarilabs-br2026-rearm`). M25/M26 criam e removem worktrees PROPRIAS mais abaixo — esta
 * lista existe so para provar, na secao Z, que nenhuma delas foi tocada.
 */
const worktreesBefore = (spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout || "");

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

// ── M25/M26 EM PARALELO — ISOLAMENTO POR GIT WORKTREE ────────────────────────────────────────
//
// M25 e M26 prova duas classes DIFERENTES de regressao do MESMO gate real (audit_responsive_
// matrix.mjs, ~89s cada — sobe Chromium, navega 4 apps em 14 larguras): M25 volta o CSS exato
// do defeito real de 2026 (folga zero), M26 prova que o detector morde por LARGURA DE TEXTO
// (rotulo mais longo), nao so pelo numero de fonte daquele incidente especifico. Nenhuma das
// duas e removivel nem substitui a outra — sao REQUIRED_MUTATED_EXECUTION independentes (ver
// CHANGE_INTENT.json / analise de performance desta suite). Como PAR, porem, sao independentes
// entre si (arquivos-alvo diferentes, sem dependencia de ordem), e essa e a unica coisa que este
// bloco otimiza: rodar as duas SIMULTANEAMENTE em vez de serialmente, cada uma na sua propria
// arvore git isolada — o gate serve o repositorio INTEIRO por HTTP, entao aplicar as duas
// mutacoes na MESMA arvore ao mesmo tempo faria cada gate medir as duas mutacoes juntas, nunca a
// sua sozinha. max workers = 2, escopo estrito a este par; nenhuma outra mutacao desta suite usa
// este mecanismo, e verify.mjs continua 100% serial fora daqui.

const WORKTREE_PARENT = dirname(ROOT);
const WORKTREE_PREFIX = `.ferrarilabs-safety-mutation-${process.pid}-`;
const activeWorktrees = new Set();

/** Cria uma worktree git descartavel a partir de HEAD, com node_modules linkado (nao copiado). */
function criarWorktree(label) {
  const dir = join(WORKTREE_PARENT, `${WORKTREE_PREFIX}${label}`);
  if (existsSync(dir)) {
    throw new Error(`worktree temporaria ja existe: ${dir} (execucao anterior travou sem limpar?)`);
  }
  const r = spawnSync("git", ["worktree", "add", "--detach", "--quiet", dir, "HEAD"],
    { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git worktree add falhou (${dir}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  activeWorktrees.add(dir);
  // node_modules nao e rastreado pelo git — sem isto, `import "playwright"` dentro da worktree
  // falharia com MODULE_NOT_FOUND. Link simbolico UNICO, nunca copia: os pacotes instalados sao
  // so lidos durante o teste (nunca escritos), entao compartilhar entre worktrees e seguro.
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/** Remove uma worktree criada por ESTA execucao. Trava de seguranca: nunca remove outra coisa. */
function removerWorktree(dir) {
  const base = dir.slice(WORKTREE_PARENT.length + 1);
  if (!base.startsWith(WORKTREE_PREFIX)) {
    throw new Error(`recusando remover worktree fora do padrao criado por esta execucao: ${dir}`);
  }
  spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: ROOT, encoding: "utf8" });
  spawnSync("git", ["worktree", "prune"], { cwd: ROOT, encoding: "utf8" });
  activeWorktrees.delete(dir);
}

// Ctrl-C durante o par paralelo: melhor esforco de limpeza antes de sair. Nao cobre SIGKILL (nao
// e interceptavel), mas cobre o caso pratico (operador cancelando a suite manualmente).
process.on("SIGINT", () => {
  for (const dir of [...activeWorktrees]) { try { removerWorktree(dir); } catch { /* melhor esforco */ } }
  process.exit(130);
});

/** Spawna um comando de forma assincrona, com timeout, sem bloquear o processo principal. */
function spawnAsync(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, opts);
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: null, error: err.message, stdout, stderr, timedOut }); });
  });
}

/**
 * Roda `cases` (M25, M26) em PARALELO, cada um na sua propria worktree descartavel e na sua
 * propria porta. Devolve os resultados atribuidos por ROTULO (nunca por ordem de conclusao) —
 * cada `test()` chamador confere o SEU proprio resultado de forma independente, entao um worker
 * rapido nunca mascara a falha do outro. Falha de infraestrutura (worktree/porta) NUNCA vira
 * skip silencioso: cai no catch do chamador e marca as duas mutacoes como nao verificadas.
 */
async function mutateGatePairParallel(cases) {
  const criadas = [];
  try {
    for (const c of cases) criadas.push({ label: c.label, dir: criarWorktree(c.label) });

    // Aplica cada mutacao SO dentro da sua propria worktree — a arvore principal (ROOT) nunca e
    // tocada por este bloco, e nenhuma das duas arvores ve a mutacao da outra.
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const target = join(criadas[i].dir, c.file);
      const original = readFileSync(target, "utf8");
      const mutated = c.transform(original);
      if (mutated === original) throw new Error(`a mutacao "${c.label}" nao alterou ${c.file} na worktree`);
      writeFileSync(target, mutated);
    }

    // spawn() assincrono para as duas — cada uma roda a PROPRIA copia do gate dentro da sua
    // worktree, entao ROOT (derivado de import.meta.url dentro do proprio script) resolve para a
    // worktree certa, nunca para a arvore principal.
    const jobs = cases.map((c, i) => {
      const dir = criadas[i].dir;
      const scriptPath = join(dir, "bolao/scripts/audit_responsive_matrix.mjs");
      const env = { ...process.env };
      if (c.port) env.RESPONSIVE_MATRIX_PORT = String(c.port); else delete env.RESPONSIVE_MATRIX_PORT;
      return spawnAsync("node", [scriptPath], { cwd: dir, env }, 300000).then((r) => ({ label: c.label, ...r }));
    });

    return await Promise.all(jobs);
  } finally {
    for (const { dir } of criadas) removerWorktree(dir);
  }
}

let resultadoM25M26;
try {
  resultadoM25M26 = await mutateGatePairParallel([
    {
      label: "M25", file: "bolao/shared/css/responsive.css",
      // porta padrao (sem override) — comportamento identico ao worker unico de antes
      transform: (t) => t.replace("  .nav button { font-size: 9px; padding: 8px 2px; }",
                                   "  .nav button { font-size: 11px; padding: 8px 4px; }")
                          .replace("  .nav button { font-size: 10.5px; }",
                                   "  .nav button { font-size: 13px; }"),
    },
    {
      label: "M26", file: "bolao/br2026/js/i18n.js", port: 4612,
      transform: (t) => t.replace('navProbs: "Probabilidades"', 'navProbs: "Probabilidades de Classificacao"'),
    },
  ]);
} catch (e) {
  // Infra (worktree/porta) falhou ANTES de qualquer teste rodar — falha FECHADA: as duas
  // mutacoes ficam marcadas como nao verificadas (code: null), nunca puladas em silencio.
  const falha = { code: null, error: e.message, stdout: "", stderr: "", timedOut: false };
  resultadoM25M26 = [{ label: "M25", ...falha }, { label: "M26", ...falha }];
}

function assertGatePararCapturou(label) {
  const r = resultadoM25M26.find((x) => x.label === label);
  const pegou = r.code !== 0 && r.code !== null;
  if (!pegou) {
    const motivo = r.timedOut ? "timeout apos 300s" : r.error ? `erro de infraestrutura: ${r.error}` : `saiu ${r.code}`;
    const tail = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").slice(-20).join("\n");
    throw new Error(`${label} => NAO PEGA. \`node audit_responsive_matrix.mjs\` ${motivo} com a mutacao aplicada\n${tail}`);
  }
}

test("M25 folga da navegacao removida (estado anterior) => PEGA", () => {
  // Restaura EXATAMENTE os tamanhos de antes da correcao — a condicao de folga zero que fez o
  // primeiro CI acusar `Probabilidades` cortado a 320px e a 902px.
  assertGatePararCapturou("M25");
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
  assertGatePararCapturou("M26");
});

console.log("\nE. Ciclo de vida CHANGE_INTENT — conditional vs one_shot (ADR-018, Issue #238)");

// Esta secao usa conteudo SINTETICO, nunca a declaracao real de producao. A declaracao real do
// BR2026 (Issue #238) e transiente por natureza -- existe so enquanto o incidente estiver aberto,
// e e removida no mesmo commit que rearma (exatamente o que aconteceu em 2026-08-19). Testar
// contra o conteudo real de producao tornaria esta suite fragil ao ciclo de vida normal de um
// incidente -- foi isso que quebrou M27-M33 na primeira tentativa de rearme: a declaracao real
// sumiu, e as mutacoes pararam de achar o que mutar. `BR2026_ROUND_EMAILS_DISARMED` continua
// sendo o UNICO invariante MACHINE_VERIFIABLE registrado hoje (scripts/safety/surfaces.mjs) --
// usado aqui como fixture generico do mecanismo, nao como referencia ao incidente especifico.
function syntheticConditionalIntent(overrides = {}) {
  const decl = {
    surface_id: "NOTIFICATION_WORKFLOWS",
    lifecycle: "conditional",
    condition_id: "test-synthetic-condition",
    related_issue: 1,
    reason: "fixture sintetica de mutacao — nunca intencao real de producao",
    expected_behavior_change: "test",
    tests_required: ["x"],
    exit_conditions: [
      { id: "inv", type: "MACHINE_VERIFIABLE", check: "BR2026_ROUND_EMAILS_DISARMED" },
    ],
    ...overrides,
  };
  return JSON.stringify({ declarations: [decl] }, null, 2);
}

/** Sobrescreve `file` com `content`, roda o contrato, exige `status[expectId] === "FAILED"`, restaura. */
function mutateFixture(label, file, content, expectId) {
  const original = readFileSync(abs(file));
  touched.add(file);
  if (!hashesBefore.has(file)) hashesBefore.set(file, sha(file));
  try {
    writeFileSync(abs(file), content);
    const { status } = runContract();
    const wanted = Array.isArray(expectId) ? expectId : [expectId];
    const caught = wanted.filter((id) => status[id] === "FAILED");
    assert(caught.length > 0,
      `${label} => NAO PEGA. Esperado FAILED em [${wanted.join(", ")}], obtido: ` +
      `${wanted.map((id) => `${id}=${status[id] || "PASSED"}`).join(", ")}`);
  } finally {
    writeFileSync(abs(file), original);
  }
}

test("M27 declaracao lifecycle=one_shot (explicito) cujo caminho nao esta no diff => PEGA por staleness", () => {
  // A propriedade central: uma declaracao que NAO e conditional (explicitamente one_shot, ou por
  // downgrade de uma que antes era conditional) volta a staleness por diff normal — exatamente o
  // que reativar D3's autolimpeza deveria fazer. SCORING_CONSTANTS (nao tem check registrado, e
  // por isso nunca pode ser conditional valida) e usada aqui so como superficie real,
  // DECLARE_TO_CHANGE, cujos caminhos nunca estao no diff desta suite.
  mutateFixture("one_shot com caminho fora do diff", "CHANGE_INTENT.json",
    syntheticConditionalIntent({ surface_id: "SCORING_CONSTANTS", lifecycle: "one_shot", exit_conditions: undefined,
      condition_id: undefined, related_issue: undefined }),
    "D3");
});

test("M28 campo lifecycle ausente (default one_shot) cujo caminho nao esta no diff => PEGA por staleness", () => {
  // Mesmo efeito que M27 — ausencia de `lifecycle` e o default seguro "one_shot", nao um escape.
  const decl = JSON.parse(syntheticConditionalIntent()).declarations[0];
  delete decl.lifecycle; delete decl.condition_id; delete decl.related_issue; delete decl.exit_conditions;
  decl.surface_id = "SCORING_CONSTANTS";
  mutateFixture("lifecycle ausente com caminho fora do diff", "CHANGE_INTENT.json",
    JSON.stringify({ declarations: [decl] }, null, 2), "D3");
});

test("M29 condition_id removido de declaracao conditional => PEGA", () => {
  const decl = JSON.parse(syntheticConditionalIntent()).declarations[0];
  delete decl.condition_id;
  mutateFixture("condition_id removido", "CHANGE_INTENT.json",
    JSON.stringify({ declarations: [decl] }, null, 2), "D1");
});

test("M30 exit_conditions removido de declaracao conditional => PEGA", () => {
  const decl = JSON.parse(syntheticConditionalIntent()).declarations[0];
  delete decl.exit_conditions;
  mutateFixture("exit_conditions removido", "CHANGE_INTENT.json",
    JSON.stringify({ declarations: [decl] }, null, 2), "D1");
});

test("M31 exit_condition aponta para superficie errada (surface_id trocado) => PEGA", () => {
  // Troca surface_id para outra superficie real e valida, MANTENDO o check
  // BR2026_ROUND_EMAILS_DISARMED (registrado so para NOTIFICATION_WORKFLOWS) — a declaracao
  // ficaria "protegida" por um invariante que nao verifica nada sobre a superficie nova.
  mutateFixture("surface_id trocado mantendo o check antigo", "CHANGE_INTENT.json",
    syntheticConditionalIntent({ surface_id: "SCORING_CONSTANTS" }), "D1");
});

test("M32 lifecycle com valor malformado (erro de digitacao) => PEGA, nunca vira one_shot nem conditional em silencio", () => {
  mutateFixture("typo em lifecycle", "CHANGE_INTENT.json",
    syntheticConditionalIntent({ lifecycle: "conditionall" }), "D1");
});

test("M33 invariante de desarme violado no proprio workflow (nao no CHANGE_INTENT.json) => PEGA", () => {
  // A mutacao mais importante desta secao: prova que D3 nao confia cegamente no JSON dizendo
  // "continua desarmado" — ele LE o arquivo real do workflow a cada execucao. Precisa mutar DOIS
  // arquivos juntos: injeta uma declaracao conditional sintetica (real teria sido removida no
  // rearme) E simula o workflow real desarmado antes de rearma-lo por baixo — a unica forma de
  // testar isso hoje, ja que `BR2026_ROUND_EMAILS_DISARMED` le um caminho fixo no disco.
  const ciFile = "CHANGE_INTENT.json";
  const wfFile = ".github/workflows/br2026_round_emails.yml";
  const ciOriginal = readFileSync(abs(ciFile));
  const wfOriginal = readFileSync(abs(wfFile));
  touched.add(ciFile); touched.add(wfFile);
  if (!hashesBefore.has(ciFile)) hashesBefore.set(ciFile, sha(ciFile));
  if (!hashesBefore.has(wfFile)) hashesBefore.set(wfFile, sha(wfFile));
  try {
    writeFileSync(abs(ciFile), syntheticConditionalIntent());
    const disarmed = 'name: t\non: { workflow_dispatch: {} }\njobs:\n  x:\n    runs-on: ubuntu-latest\n' +
      '    steps:\n      - name: send\n        env:\n          BOLAO_ALLOW_REAL_SEND: "NOT_THE_TOKEN"\n' +
      '        run: python3 send_round_email.py --dry-run\n';
    const armed = disarmed.replace("--dry-run", "--auto").replace('"NOT_THE_TOKEN"', '"I UNDERSTAND"');
    assert(armed !== disarmed, "a mutacao sintetica nao alterou o conteudo");
    writeFileSync(abs(wfFile), armed);
    const { status } = runContract();
    assert(status.D3 === "FAILED", `esperado D3=FAILED, obtido ${status.D3 || "PASSED"}`);
  } finally {
    writeFileSync(abs(ciFile), ciOriginal);
    writeFileSync(abs(wfFile), wfOriginal);
  }
});

// ── Limite conhecido, documentado em vez de fingido (STEP 10 item 12) ───────────────────────────
//
// Se alguem APAGAR a declaracao conditional inteira de CHANGE_INTENT.json — sem tocar no arquivo
// que ela protege — NENHUM check existente pega isso: D2 so dispara quando um caminho
// DECLARE_TO_CHANGE aparece no diff, e D3 so avalia declaracoes que EXISTEM. Isto e um limite real
// do modelo, nao um bug: CHANGE_INTENT.json documenta intencao sobre mudancas/estados detectados
// por diff — ele nunca foi, e nenhum PR o torna, uma trava que impede a REMOCAO da propria
// documentacao. Registrar isso explicitamente (em vez de fingir uma protecao que nao existe) é
// exatamente o que ADR-018 pede.
test("LIMITE CONHECIDO: remover a declaracao conditional inteira nao e pego por nenhum check existente (documentado, nao uma regressao)", () => {
  // Isola do diff DESTE PR sem depender do conteudo de nenhum arquivo: `changedPaths()` uniona o
  // diff de COMMITS (base..HEAD) com o diff da arvore de trabalho -- uma vez que este branch
  // COMMITOU uma mudanca real em .github/workflows/**, nenhuma reescrita da arvore de trabalho
  // consegue tirar esse caminho do lado `base..HEAD` da uniao (tentativa anterior quebrou por
  // isso: reverter o arquivo pra base nao adianta se a base em si e ANTES do commit que o mudou).
  // A forma correta e apontar SAFETY_BASE_SHA para o proprio HEAD so durante este teste --
  // resolveBase() respeita essa variavel antes de qualquer outra logica, entao `base..HEAD` fica
  // vazio por definicao, e a unica coisa que sobra no diff e o que este teste mesmo escreve na
  // arvore de trabalho (so CHANGE_INTENT.json).
  const ciFile = "CHANGE_INTENT.json";
  const ciOriginal = readFileSync(abs(ciFile));
  touched.add(ciFile);
  if (!hashesBefore.has(ciFile)) hashesBefore.set(ciFile, sha(ciFile));
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const prevBaseEnv = process.env.SAFETY_BASE_SHA;
  try {
    process.env.SAFETY_BASE_SHA = headSha;
    writeFileSync(abs(ciFile), syntheticConditionalIntent());
    const removed = JSON.stringify({ declarations: [] }, null, 2);
    assert(removed !== syntheticConditionalIntent(), "fixture nao mudou");
    writeFileSync(abs(ciFile), removed);
    const { status, exit } = runContract();
    assert(exit === 0 && !status.D1 && !status.D2 && !status.D3,
      "esperado: NENHUM check reprova (isso e o limite documentado) — se algo comecou a pegar isso, atualize este teste e o ADR-018, nao remova a checagem");
  } finally {
    writeFileSync(abs(ciFile), ciOriginal);
    if (prevBaseEnv === undefined) delete process.env.SAFETY_BASE_SHA;
    else process.env.SAFETY_BASE_SHA = prevBaseEnv;
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

test("nenhuma worktree temporaria de M25/M26 sobrou no disco", () => {
  const atual = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout || "";
  const sobrando = atual.split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => p.includes(WORKTREE_PREFIX));
  assert(sobrando.length === 0 && activeWorktrees.size === 0,
    `worktrees nao removidas: ${sobrando.join(", ") || [...activeWorktrees].join(", ")}`);
});

test("worktree pre-existente do usuario (ex.: ferrarilabs-br2026-rearm) nao foi tocada", () => {
  const atual = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).stdout || "";
  const linhasAntes = worktreesBefore.split("\n").filter((l) => l.startsWith("worktree "));
  const faltando = linhasAntes.filter((l) => !atual.includes(l));
  assert(faltando.length === 0, `worktree pre-existente sumiu ou mudou: ${faltando.join(", ")}`);
});

test("o contrato volta a passar depois de todas as mutacoes", () => {
  const after = runContract();
  assert(after.exit === 0, `o contrato ficou VERMELHO apos as mutacoes (${after.totals.fail} falha(s))`);
  assert(after.totals.pass === baseline.totals.pass,
    `o numero de checks mudou: ${baseline.totals.pass} -> ${after.totals.pass}`);
});

test("M34 mudanca em Edge Function (deploy automatico em producao) sem declaracao => PEGA", () => {
  // Issue #253. Merge em `supabase/functions/**` IMPLANTA em producao: a integracao do Supabase
  // roda a cada push em main e implantou a funcao 39s depois do merge do PR #252, um PR que nao
  // tocou arquivo de funcao nenhum. Antes desta superficie, uma alteracao no gateway ao vivo
  // passava por review como mudanca de repositorio e ja estava no ar.
  //
  // A mutacao acrescenta UMA linha inerte -- nao muda comportamento, e nem precisa: o que se
  // prova aqui e que a superficie e vigiada por IDENTIDADE de caminho, nao por gravidade do diff.
  const file = "supabase/functions/live-football/index.ts";
  mutateFixture("Edge Function alterada sem CHANGE_INTENT",
    file, readFileSync(abs(file)) + "\n// mutacao M34\n", "D2");
});

test("M35 bump normal de siteVersion NAO pode ressuscitar uma declaracao SCORING_CONSTANTS obsoleta => PEGA", () => {
  // REGRESSAO da Issue #261, o caso exato que quebrou na vida real.
  //
  // SCORING_CONSTANTS nao tem `paths`: e definida por FINGERPRINT, cujos `files` sao os tres
  // `js/config.js`. O D3 resolvia staleness por ARQUIVO no diff, entao um bump de release -- que
  // mexe SO em `siteVersion`, uma chave que o proprio fingerprint lista em `ignored_keys` -- fazia
  // uma declaracao obsoleta parecer viva. D3 ficava verde, M27/M28 reprovavam, e a suite acusava um
  // problema que nao existia num PR que so subia versao.
  //
  // Muta DOIS arquivos de proposito: o bump precisa estar no diff para reproduzir o defeito, e a
  // declaracao obsoleta precisa existir para haver o que detectar. Se algum dia o D3 voltar a
  // perguntar "o arquivo foi tocado?" em vez de "a chave observada driftou?", esta mutacao reprova.
  const ciFile = "CHANGE_INTENT.json";
  const cfgFile = "bolao/cdb2026/js/config.js";
  const ciOriginal = readFileSync(abs(ciFile));
  // utf8 de proposito: sem encoding readFileSync devolve Buffer, e Buffer nao tem .replace().
  const cfgOriginal = readFileSync(abs(cfgFile), "utf8");
  touched.add(ciFile); touched.add(cfgFile);
  if (!hashesBefore.has(ciFile)) hashesBefore.set(ciFile, sha(ciFile));
  if (!hashesBefore.has(cfgFile)) hashesBefore.set(cfgFile, sha(cfgFile));
  try {
    const bumped = cfgOriginal.replace(/siteVersion:\s*"([^"]+)"/, 'siteVersion: "v99.999"');
    assert(bumped !== cfgOriginal, "a mutacao sintetica nao alterou siteVersion");
    writeFileSync(abs(cfgFile), bumped);
    writeFileSync(abs(ciFile), syntheticConditionalIntent({
      surface_id: "SCORING_CONSTANTS", lifecycle: "one_shot",
      exit_conditions: undefined, condition_id: undefined, related_issue: undefined,
    }));
    const { status } = runContract();
    assert(status.D3 === "FAILED",
      `bump de siteVersion mascarou a declaracao obsoleta: esperado D3=FAILED, obtido ${status.D3 || "PASSED"}`);
  } finally {
    writeFileSync(abs(ciFile), ciOriginal);
    writeFileSync(abs(cfgFile), cfgOriginal);
  }
});

const MUTATIONS = 35;
test(`MUTATIONS_CAUGHT == MUTATIONS_EXECUTED (${MUTATIONS}/${MUTATIONS})`, () => {
  assert(fail === 0, `${fail} mutacao(oes) nao foi(ram) pega(s)`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ ALL MUTATIONS CAUGHT\n" : "✗ MUTATION SUITE FAILED\n");
process.exit(fail === 0 ? 0 : 1);
