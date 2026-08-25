#!/usr/bin/env node
/**
 * test_mutation_isolation.mjs — a corrida da Issue #334, provada de forma DETERMINISTICA.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────────────────────
 *
 * `verify.mjs` roda os checks em paralelo. `safety-contract-mutations` escrevia mutacoes na arvore
 * de trabalho REAL e as desfazia depois; `live-function-drift` lia os mesmos arquivos do disco para
 * calcular o SHA de `supabase/functions/**`. Quando a leitura caia na janela da mutacao, o gate
 * reprovava com o hash do codigo MUTADO -- e, pior, mandava o operador colar esse valor em
 * `deploy_manifest.js`.
 *
 * Um teste de harness virava instrucao errada para um humano, e o valor gravado seria o de um
 * codigo que nunca existiu: exatamente a cegueira que a #306 criou o detector para acabar.
 *
 * ─── POR QUE ESTE TESTE NAO DEPENDE DE SORTE ────────────────────────────────────────────────
 *
 * A tentacao seria rodar tudo em paralelo e torcer para a janela abrir. Isso prova nada: verde por
 * sorte e indistinguivel de verde por correcao, e um teste assim envelhece para "flaky, ignora".
 *
 * Aqui a mutacao fica ATIVA no disco, comprovadamente, enquanto o leitor canonico roda. Nao ha
 * janela a acertar -- se a arquitetura estivesse errada, o leitor observaria a mutacao em 100% das
 * execucoes. O controle negativo abaixo demonstra exatamente isso, lendo da arvore mutada.
 *
 * Uso: node scripts/safety/test_mutation_isolation.mjs
 */

import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { ROOT } from "./surfaces.mjs";
import { limparOrfas } from "./worktree_isolation.mjs";
import { FONTES, calcularSha, caminhosSujos, podeRecomendarHash, CAMINHOS_DO_HASH, FONTE }
  from "../db/audit_live_function_drift.mjs";

let pass = 0, fail = 0;
const test = (nome, fn) => {
  try { fn(); console.log(`  ✓ ${nome}`); pass++; }
  catch (e) { console.log(`  ✗ ${nome}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const git = (args, cwd = ROOT) => spawnSync("git", args, { cwd, encoding: "utf8" });

/** O arquivo que a mutacao M34 toca — a mesma superficie que originou a #334. */
const ALVO = "supabase/functions/live-football/index.ts";
const MARCA = "// MUTACAO SINTETICA DO TESTE DE ISOLAMENTO (#334)\n";

const PREFIXO = `.ferrarilabs-isolation-test-${process.pid}-`;
const criadas = new Set();

function criarWorktree(label) {
  const dir = join(dirname(ROOT), `${PREFIXO}${label}`);
  assert(!existsSync(dir), `worktree temporaria ja existe: ${dir}`);
  const r = git(["worktree", "add", "--detach", "--quiet", dir, "HEAD"]);
  assert(r.status === 0, `git worktree add falhou: ${(r.stderr || r.stdout || "").trim()}`);
  criadas.add(dir);
  instalarAuditorAtual(dir);
  return dir;
}

/** O auditor sob teste e o da ARVORE DE TRABALHO, nao o que estiver commitado em HEAD.
 *
 * `git worktree add` materializa HEAD, entao sem esta copia o teste exercitaria a versao ANTERIOR
 * do detector e passaria a medir o passado -- foi exatamente o que aconteceu na primeira execucao
 * deste arquivo: os casos 3 e 4 reprovaram porque a worktree rodava o codigo de antes da correcao.
 *
 * O arquivo copiado NAO entra em `CAMINHOS_DO_HASH`, entao ele nao suja a decisao de procedencia. */
function instalarAuditorAtual(dir) {
  const rel = "scripts/db/audit_live_function_drift.mjs";
  copyFileSync(join(ROOT, rel), join(dir, rel));
}

function removerWorktree(dir) {
  // Trava: so remove o que ESTA execucao criou. Um bug de caminho aqui apagaria trabalho real.
  assert(dir.slice(dirname(ROOT).length + 1).startsWith(PREFIXO),
    `recusando remover caminho fora do padrao desta execucao: ${dir}`);
  git(["worktree", "remove", "--force", dir]);
  git(["worktree", "prune"]);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  criadas.delete(dir);
}

// Limpeza garantida no caminho feliz, na excecao e no Ctrl-C. SIGKILL nao e interceptavel -- para
// esse caso a criacao RECUSA uma worktree preexistente, entao a sobra vira erro visivel na proxima
// execucao, nunca silencio (documentado em CHANGE_SAFETY_CONTRACT.md).
const limparTudo = () => { for (const d of [...criadas]) { try { removerWorktree(d); } catch { /* melhor esforco */ } } };
process.on("exit", limparTudo);
process.on("SIGINT", () => { limparTudo(); process.exit(130); });

limparOrfas("isolation-test", ROOT);

console.log("\nIsolamento de mutacao — a corrida da #334\n");

// ── Estado canonico ANTES de qualquer coisa ─────────────────────────────────────────────────
const statusAntes = git(["status", "--porcelain"]).stdout || "";
const hashesAntes = new Map(CAMINHOS_DO_HASH.map((p) => [p, sha256(join(ROOT, p))]));
const shaCanonicoAntes = calcularSha();

let mutada = null;
try {
  console.log("1. A mutacao esta MESMO ativa (sem isso, o teste nao prova nada):");

  mutada = criarWorktree("mutada");
  const alvoNaMutada = join(mutada, ALVO);
  const originalNaMutada = readFileSync(alvoNaMutada, "utf-8");
  writeFileSync(alvoNaMutada, MARCA + originalNaMutada);

  test("o arquivo alvo esta alterado na worktree isolada", () => {
    assert(readFileSync(alvoNaMutada, "utf-8").startsWith(MARCA), "a mutacao nao chegou ao disco");
    const st = git(["status", "--porcelain", "--", ALVO], mutada).stdout || "";
    assert(st.trim().length > 0, "o git da worktree isolada nao ve a mutacao");
  });

  test("CONTROLE NEGATIVO: quem le a arvore MUTADA observa o hash mutado", () => {
    // Isto e a arquitetura ANTIGA reproduzida deliberadamente: ler as fontes do mesmo disco onde a
    // mutacao mora. Se este caso passar a NAO observar a mutacao, o teste inteiro perdeu o sentido
    // e precisa ser reescrito — nao removido.
    const shaDaMutada = calcularSha((rel) => readFileSync(join(mutada, rel), "utf-8"));
    assert(shaDaMutada !== shaCanonicoAntes,
      "CONTROLE NEGATIVO FALHOU: ler a arvore mutada devolveu o hash canonico — " +
      "sem esta diferenca, o caso abaixo nao prova isolamento nenhum");
  });

  // ── 2. O leitor canonico, com a mutacao ATIVA ──────────────────────────────────────────────
  console.log("\n2. O leitor canonico NAO observa a mutacao (ela continua ativa agora):");

  test("o hash canonico calculado do disco canonico nao mudou", () => {
    eq(calcularSha(), shaCanonicoAntes, "a mutacao vazou para a arvore canonica");
  });

  test("os arquivos do hash continuam byte a byte identicos na arvore canonica", () => {
    const divergentes = [...hashesAntes].filter(([p, h]) => sha256(join(ROOT, p)) !== h).map(([p]) => p);
    assert(divergentes.length === 0, `alterados na arvore canonica: ${divergentes.join(", ")}`);
  });

  test("`live-function-drift` roda VERDE na arvore canonica com a mutacao ativa", () => {
    // O gate de verdade, processo separado, exatamente como o `verify.mjs` o executa.
    const r = spawnSync("node", ["scripts/db/audit_live_function_drift.mjs"],
      { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    assert(r.status === 0,
      `o gate reprovou com a mutacao ativa noutra worktree — a corrida da #334 nao foi fechada:\n${r.stdout}`);
    assert(!/Corrija trocando o valor por/.test(r.stdout),
      "o gate recomendou trocar o hash do manifesto — foi assim que a #334 virou instrucao errada");
  });

  test("a arvore canonica continua com o mesmo `git status` de antes", () => {
    eq(git(["status", "--porcelain"]).stdout || "", statusAntes, "a arvore canonica mudou");
  });

  // ── 3. Seguranca do operador, na arvore SUJA ───────────────────────────────────────────────
  console.log("\n3. Arvore suja NUNCA rende hash acionavel (seguranca do operador):");

  test("na worktree mutada o gate acusa, mas RECUSA ditar o hash", () => {
    const r = spawnSync("node", ["scripts/db/audit_live_function_drift.mjs"],
      { cwd: mutada, encoding: "utf8", timeout: 120000 });
    // Deriva legitima nao pode ser escondida: o gate continua VERMELHO.
    assert(r.status !== 0, "o gate passou numa arvore cujo manifesto nao bate com as fontes");
    assert(/SOURCE_NOT_CANONICAL/.test(r.stdout), `faltou o diagnostico estavel:\n${r.stdout}`);
    assert(/DIRTY_OR_TRANSIENT_WORKTREE/.test(r.stdout), `faltou a procedencia:\n${r.stdout}`);
    assert(!/Corrija trocando o valor por/.test(r.stdout),
      `ARVORE SUJA RENDEU HASH ACIONAVEL — e exatamente o dano da #334:\n${r.stdout}`);
  });

  test("o hash recusado seria mesmo o hash do codigo mutado (o dano era real)", () => {
    const shaDaMutada = calcularSha((rel) => readFileSync(join(mutada, rel), "utf-8"));
    assert(shaDaMutada !== shaCanonicoAntes, "sem divergencia, nao haveria valor errado a colar");
  });

  // ── 4. A recusa e condicional, nao um `console.log` apagado ────────────────────────────────
  console.log("\n4. A recomendacao continua existindo quando a fonte E canonica:");

  test("mutacao COMMITADA (arvore limpa) volta a render hash acionavel", () => {
    // Sem este caso, "nunca recomendar nada" passaria no teste acima — e o gate teria sido
    // esvaziado em vez de corrigido.
    const c1 = git(["add", "--", ALVO], mutada);
    assert(c1.status === 0, "git add falhou na worktree isolada");
    const c2 = git(["-c", "user.email=teste@invalid", "-c", "user.name=teste",
                    "commit", "-q", "-m", "mutacao sintetica do teste de isolamento (#334)"], mutada);
    assert(c2.status === 0, `git commit falhou: ${(c2.stderr || c2.stdout || "").trim()}`);

    const sujos = caminhosSujos(git(["status", "--porcelain", "--", ...CAMINHOS_DO_HASH], mutada).stdout || "");
    eq(sujos.length, 0, "a worktree deveria estar limpa apos o commit");

    const r = spawnSync("node", ["scripts/db/audit_live_function_drift.mjs"],
      { cwd: mutada, encoding: "utf8", timeout: 120000 });
    assert(r.status !== 0, "o manifesto esta desatualizado — o gate tem de reprovar");
    assert(/Corrija trocando o valor por/.test(r.stdout),
      `fonte canonica e mesmo assim sem recomendacao — o gate foi esvaziado, nao consertado:\n${r.stdout}`);
    assert(new RegExp(FONTE.CANONICAL).test(r.stdout), `faltou declarar a procedencia canonica:\n${r.stdout}`);
  });

  // ── 5. Decisao pura, sem git ───────────────────────────────────────────────────────────────
  console.log("\n5. A decisao de recomendar e pura e exercitavel sem git:");

  test("caminho sujo => recusa", () => {
    const d = podeRecomendarHash({ sujos: [FONTES[0]], shaDisco: "aaaa", shaCommitado: "aaaa" });
    assert(!d.ok && d.motivo === "FONTE_SUJA", `esperado FONTE_SUJA, veio ${d.motivo}`);
  });

  test("disco divergindo do objeto commitado => recusa, mesmo com status limpo", () => {
    // O status pode mentir (indice velho, arquivo trocado por fora). A segunda condicao existe
    // para que "o git disse que estava limpo" nao seja a unica prova.
    const d = podeRecomendarHash({ sujos: [], shaDisco: "aaaa", shaCommitado: "bbbb" });
    assert(!d.ok && d.motivo === "DISCO_DIVERGE_DO_COMMITADO", `veio ${d.motivo}`);
  });

  test("sem objeto commitado => recusa", () => {
    const d = podeRecomendarHash({ sujos: [], shaDisco: "aaaa", shaCommitado: null });
    assert(!d.ok && d.motivo === "SEM_OBJETO_COMMITADO", `veio ${d.motivo}`);
  });

  test("limpo e igual ao commitado => recomenda", () => {
    const d = podeRecomendarHash({ sujos: [], shaDisco: "aaaa", shaCommitado: "aaaa" });
    assert(d.ok && d.motivo === FONTE.CANONICAL, `veio ${d.motivo}`);
  });

  test("`caminhosSujos` entende rename e ignora caminho que nao entra no hash", () => {
    eq(caminhosSujos(` M ${FONTES[0]}\n?? outro/arquivo.txt\n`).join(","), FONTES[0], "modificado");
    eq(caminhosSujos(`R  velho.ts -> ${FONTES[1]}\n`).join(","), FONTES[1], "rename (lado novo)");
    eq(caminhosSujos(" M docs/bolao/README.md\n").length, 0, "caminho fora do hash contaminou");
    eq(caminhosSujos("").length, 0, "entrada vazia");
  });

  // ── 5-B. Recuperacao de orfas (o caso que o SIGKILL cria) ────────────────────────────────
  console.log("\n5-B. Worktree orfa de execucao morta e recuperada; a de execucao viva, nunca:");

  test("orfa de PID morto e removida; worktree de PID VIVO e preservada", () => {
    // PID morto de verdade: um processo que ja terminou. `sh -c :` sai na hora.
    const morto = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    assert(/^\d+$/.test(morto), "nao consegui um PID encerrado");

    const dirMorto = join(dirname(ROOT), `.ferrarilabs-orphan-probe-${morto}-morta`);
    const dirVivo = join(dirname(ROOT), `.ferrarilabs-orphan-probe-${process.pid}-viva`);
    for (const d of [dirMorto, dirVivo]) {
      assert(!existsSync(d), `caminho de sonda ja existe: ${d}`);
      const r = git(["worktree", "add", "--detach", "--quiet", d, "HEAD"]);
      assert(r.status === 0, `nao consegui criar a sonda: ${(r.stderr || "").trim()}`);
    }
    try {
      const removidas = limparOrfas("orphan-probe", ROOT);
      assert(removidas.includes(dirMorto), `a orfa de PID morto sobreviveu: ${removidas.join(", ")}`);
      assert(!existsSync(dirMorto), "a orfa continua no disco");
      assert(existsSync(dirVivo),
        "a worktree de um processo VIVO foi removida — isso destruiria a execucao concorrente de outro agente");
    } finally {
      git(["worktree", "remove", "--force", dirVivo]);
      if (existsSync(dirVivo)) rmSync(dirVivo, { recursive: true, force: true });
      git(["worktree", "prune"]);
    }
  });

} finally {
  // ── 6. Limpeza ────────────────────────────────────────────────────────────────────────────
  const paraRemover = [...criadas];
  limparTudo();
  console.log("\n6. Limpeza:");
  test("nenhuma worktree do teste sobrou no disco", () => {
    const sobrando = paraRemover.filter((d) => existsSync(d));
    eq(sobrando.length, 0, `sobraram: ${sobrando.join(", ")}`);
    const lista = git(["worktree", "list", "--porcelain"]).stdout || "";
    assert(!lista.includes(PREFIXO), `git ainda registra worktree desta execucao:\n${lista}`);
  });
  test("a arvore canonica terminou como comecou", () => {
    eq(git(["status", "--porcelain"]).stdout || "", statusAntes, "a arvore canonica mudou");
    const divergentes = [...hashesAntes].filter(([p, h]) => sha256(join(ROOT, p)) !== h).map(([p]) => p);
    assert(divergentes.length === 0, `alterados: ${divergentes.join(", ")}`);
  });
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) { console.log("✗ ISOLAMENTO DE MUTACAO REPROVADO\n"); process.exit(1); }
console.log("✓ ISOLAMENTO DE MUTACAO OK\n");
