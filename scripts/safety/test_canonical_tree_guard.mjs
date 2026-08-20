#!/usr/bin/env node
// CONTRATO DA GUARDA DA ÁRVORE CANÔNICA — Issue #251.
//
// Mede os DOIS lados, como o gate de closure-keyword (#250): uma guarda que não bloqueia dá falsa
// segurança, e uma que bloqueia o dono do repositório é desligada com `--no-verify` e aí não
// protege nada. A decisão do Eduardo foi explícita — proteger contra AGENTE, nunca contra humano.
//
// A parte que mais importa aqui é a integração: os testes de matriz são puros e baratos, mas só o
// repositório git temporário — com uma worktree principal E uma vinculada de verdade — prova que
// a detecção estrutural funciona e que o gancho realmente barra o commit.
//
// Uso: node scripts/safety/test_canonical_tree_guard.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BYPASS_ENV, decide, evaluate, isAgentSession, isCi, isMainWorktree,
} from "./canonical_tree_guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nGuarda da árvore canônica — matriz de decisão e integração\n");

// ─── Matriz de decisão ──────────────────────────────────────────────────────
console.log("  — matriz de decisão:");

test("BLOQUEIA: agente mutando a worktree principal", () => {
  const d = decide({ mainWorktree: true, agent: true, ci: false, bypass: false });
  assert(d.blocked, "este é exatamente o caso que originou a Issue #251 e precisa bloquear");
});

test("PERMITE: humano na árvore canônica (decisão explícita do Eduardo)", () => {
  const d = decide({ mainWorktree: true, agent: false, ci: false, bypass: false });
  assert(!d.blocked, "a guarda nunca pode brigar com o dono do repositório");
});

test("PERMITE: agente numa worktree vinculada — o caminho correto", () => {
  const d = decide({ mainWorktree: false, agent: true, ci: false, bypass: false });
  assert(!d.blocked, "trabalho automatizado em worktree dedicada é o comportamento desejado");
});

test("PERMITE: CI — o snapshot da ESPN commita de um runner de verdade", () => {
  const d = decide({ mainWorktree: true, agent: true, ci: true, bypass: false });
  assert(!d.blocked, "bloquear CI trocaria um incidente por outro: bolao_provider_snapshot.yml commita");
});

test("PERMITE: escape explícito", () => {
  const d = decide({ mainWorktree: true, agent: true, ci: false, bypass: true });
  assert(!d.blocked, `${BYPASS_ENV} existe para ser deliberado e visível no comando`);
});

test("PERMITE: humano em worktree vinculada", () => {
  assert(!decide({ mainWorktree: false, agent: false, ci: false, bypass: false }).blocked, "nada a bloquear");
});

test("toda decisão vem com motivo legível", () => {
  for (const mainWorktree of [true, false]) for (const agent of [true, false])
    for (const ci of [true, false]) for (const bypass of [true, false]) {
      const d = decide({ mainWorktree, agent, ci, bypass });
      assert(typeof d.reason === "string" && d.reason.length > 10,
        `motivo ausente para ${JSON.stringify({ mainWorktree, agent, ci, bypass })}`);
    }
});

// ─── Detecção de ambiente ───────────────────────────────────────────────────
console.log("\n  — detecção de ambiente:");

test("marcador de agente é reconhecido, e ausência também", () => {
  assert(isAgentSession({ CLAUDECODE: "1" }), "CLAUDECODE deveria marcar sessão de agente");
  assert(isAgentSession({ CLAUDE_CODE_SESSION_ID: "abc" }), "SESSION_ID também marca");
  assert(!isAgentSession({}), "ambiente limpo não é sessão de agente");
  assert(!isAgentSession({ CLAUDECODE: "0" }), '"0" não pode contar como ligado');
  assert(!isAgentSession({ CLAUDECODE: "" }), "string vazia não pode contar como ligado");
});

test("CI é reconhecido", () => {
  assert(isCi({ CI: "true" }) && isCi({ GITHUB_ACTIONS: "true" }), "CI/GITHUB_ACTIONS marcam runner");
  assert(!isCi({}), "ambiente limpo não é CI");
  assert(!isCi({ CI: "false" }), '"false" não é CI');
});

test("fora de um repositório git a guarda falha ABERTO", () => {
  const outside = mkdtempSync(join(tmpdir(), "not-a-repo-"));
  try { assert(isMainWorktree(outside) === false, "sem repo não há árvore canônica a proteger"); }
  finally { rmSync(outside, { recursive: true, force: true }); }
});

// ─── Integração: repositório real, worktree principal E vinculada ───────────
console.log("\n  — integração contra worktrees git de verdade:");

const base = mkdtempSync(join(tmpdir(), "canonical-guard-"));
const main = join(base, "main-tree");
const linked = join(base, "linked-tree");
try {
  mkdirSync(main);
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git(main, "init", "-q");
  git(main, "config", "user.email", "guard@example.invalid");
  git(main, "config", "user.name", "Guard Test");
  writeFileSync(join(main, "a.txt"), "base\n");
  // A guarda é VERSIONADA, e o gancho a resolve pelo toplevel de cada worktree. Commitá-la ANTES
  // de criar a worktree vinculada é o que reproduz a realidade: as duas árvores a enxergam.
  mkdirSync(join(main, "scripts", "safety"), { recursive: true });
  cpSync(join(HERE, "canonical_tree_guard.mjs"), join(main, "scripts", "safety", "canonical_tree_guard.mjs"));
  git(main, "add", "."); git(main, "commit", "-q", "-m", "base");
  git(main, "worktree", "add", "-q", linked, "-b", "linked-branch");

  test("a worktree principal é identificada estruturalmente", () => {
    assert(isMainWorktree(main) === true, "a árvore principal precisa ser reconhecida");
  });

  test("a worktree vinculada é identificada estruturalmente", () => {
    assert(isMainWorktree(linked) === false, "a vinculada NÃO pode ser tratada como canônica");
  });

  test("evaluate() bloqueia agente na principal e libera na vinculada", () => {
    const env = { CLAUDECODE: "1" };
    assert(evaluate({ cwd: main, env }).blocked === true, "principal + agente deveria bloquear");
    assert(evaluate({ cwd: linked, env }).blocked === false, "vinculada + agente deveria liberar");
  });

  // ─── O gancho de verdade ──────────────────────────────────────────────────
  // Copiamos os ganchos versionados e apontamos core.hooksPath, exatamente como o instalador faz.
  const hooks = join(base, "githooks");
  cpSync(join(ROOT, ".githooks"), hooks, { recursive: true });
  for (const h of ["pre-commit", "pre-merge-commit", "pre-rebase", "pre-push"]) chmodSync(join(hooks, h), 0o755);
  git(main, "config", "core.hooksPath", hooks);

  const commitAs = (cwd, env, msg) => {
    writeFileSync(join(cwd, `f-${Math.random().toString(36).slice(2)}.txt`), "x\n");
    execFileSync("git", ["add", "."], { cwd });
    return spawnSync("git", ["commit", "-m", msg], {
      cwd, encoding: "utf8",
      env: { ...process.env, CLAUDECODE: "", CLAUDE_CODE_ENTRYPOINT: "", CLAUDE_CODE_SESSION_ID: "",
             CI: "", GITHUB_ACTIONS: "", [BYPASS_ENV]: "", ...env },
    });
  };

  test("o gancho BLOQUEIA um commit de agente na árvore principal", () => {
    const r = commitAs(main, { CLAUDECODE: "1" }, "agente tentando commitar");
    assert(r.status !== 0, "o commit deveria ter sido barrado e não foi");
    assert(/BLOQUEADO/.test(r.stderr || ""), `mensagem inesperada: ${(r.stderr || "").slice(0, 200)}`);
    assert(/git worktree add/.test(r.stderr || ""), "a mensagem precisa dizer o que fazer no lugar");
  });

  test("o gancho PERMITE um commit humano na mesma árvore", () => {
    const r = commitAs(main, {}, "humano commitando de propósito");
    assert(r.status === 0, `commit humano foi barrado indevidamente: ${(r.stderr || "").slice(0, 200)}`);
  });

  test("o gancho PERMITE um commit de agente na worktree vinculada", () => {
    const r = commitAs(linked, { CLAUDECODE: "1" }, "agente na worktree correta");
    assert(r.status === 0, `worktree vinculada foi barrada indevidamente: ${(r.stderr || "").slice(0, 200)}`);
  });

  test("o gancho PERMITE quando CI está marcado", () => {
    const r = commitAs(main, { CLAUDECODE: "1", GITHUB_ACTIONS: "true" }, "runner de CI commitando");
    assert(r.status === 0, `CI foi barrado indevidamente: ${(r.stderr || "").slice(0, 200)}`);
  });

  test(`o gancho PERMITE com ${BYPASS_ENV}=1 explícito`, () => {
    const r = commitAs(main, { CLAUDECODE: "1", [BYPASS_ENV]: "1" }, "escape deliberado");
    assert(r.status === 0, `escape explícito não funcionou: ${(r.stderr || "").slice(0, 200)}`);
  });

  // POR ÚLTIMO de propósito: remove o script e não repõe.
  test("o gancho FALHA ABERTO quando o script da guarda não existe no checkout", () => {
    // `core.hooksPath` é config do REPOSITÓRIO e vale para toda worktree, mas o script é
    // versionado POR BRANCH. Num branch anterior a esta Issue o arquivo simplesmente não existe.
    // Sem o guarda-chuva no gancho, ele estourava e tornava impossível commitar ali — a proteção
    // viraria um bloqueio geral. Isto foi encontrado pelo próprio teste de integração.
    rmSync(join(main, "scripts", "safety", "canonical_tree_guard.mjs"));
    const r = commitAs(main, { CLAUDECODE: "1" }, "branch sem a guarda versionada");
    assert(r.status === 0,
      `sem o script, o gancho tem de deixar passar em vez de estourar: ${(r.stderr || "").slice(0, 200)}`);
  });
} finally {
  try { execFileSync("git", ["worktree", "remove", "--force", linked], { cwd: main }); } catch { /* o rm abaixo limpa */ }
  rmSync(base, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ CANONICAL TREE GUARD TESTS FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
