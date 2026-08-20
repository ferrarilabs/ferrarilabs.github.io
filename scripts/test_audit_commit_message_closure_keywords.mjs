#!/usr/bin/env node
// PRECISÃO E COBERTURA DO GATE DE PALAVRA-CHAVE SOB NEGAÇÃO — Issue #250.
//
// Um gate quebrado é pior que gate nenhum: um que não morde dá falsa segurança, e um que morde
// demais é desligado na primeira semana e para de proteger. Por isso esta suíte mede os DOIS
// lados — o caso real que causou o incidente e a redação legítima que NÃO pode reprovar.
//
// O caso negativo mais importante é a fronteira de frase: "This is not a refactor. Fixes #248."
// é uma mensagem correta e comum. Se o gate reprovasse isso, ele estaria errado.
//
// Uso: node scripts/test_audit_commit_message_closure_keywords.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findNegatedClosures, scanCommitRange } from "./audit_commit_message_closure_keywords.mjs";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const fires = (t) => findNegatedClosures(t).length > 0;

console.log("\nGate de palavra-chave de fechamento sob negação — precisão e cobertura\n");

// ─── DEVE REPROVAR ──────────────────────────────────────────────────────────
console.log("  — deve REPROVAR (o GitHub fecharia mesmo assim):");

test('o caso real: "Does NOT fix #246: ..."', () => {
  const f = findNegatedClosures("Does NOT fix #246: ESPN still returns 403 and live data is unavailable");
  assert(f.length === 1, `esperado 1 achado, veio ${f.length}`);
  assert(f[0].reference === "#246", `referência errada: ${f[0].reference}`);
  assert(f[0].keyword.toLowerCase() === "fix", `keyword errada: ${f[0].keyword}`);
});

for (const [label, text] of [
  ["contração", "This doesn't close #12 yet"],
  ["negação direta", "not fixes #7"],
  ["verbo resolve", "This change does not resolve #99"],
  ["negação em português", "Este commit nao fix #5 de verdade"],
  ["never", "This will never close #3"],
  ["cannot", "We cannot fix #44 in this patch"],
  ["referência owner/repo", "It does not fix ferrarilabs/ferrarilabs.github.io#42"],
  ["palavra intermediária", "This does not really fix #77"],
]) {
  test(`${label}: ${JSON.stringify(text)}`, () => assert(fires(text), "deveria ter reprovado e não reprovou"));
}

// ─── NÃO PODE REPROVAR ──────────────────────────────────────────────────────
console.log("\n  — NÃO pode reprovar (redação legítima):");

for (const [label, text] of [
  ["fechamento intencional", "Closes #248"],
  ["Fixes intencional", "Fixes #42"],
  ["Resolves intencional", "Resolves #7"],
  ["referência sem keyword", "Relates to #246"],
  ["menção simples", "See #246 for the incident timeline"],
  ["substantivo na frente", "Issue #246 remains unresolved"],
  ["'unresolved' não é 'resolved'", "#246 is still unresolved and stays open"],
  ["fronteira de frase (ponto)", "This is not a refactor. Fixes #248"],
  ["fronteira de frase (quebra de linha)", "No behavior change\nCloses #10"],
  ["fronteira de frase (ponto-e-vírgula)", "Not a revert; Closes #11"],
  ["negação longe demais", "This is not the kind of change we usually make when we fix #21"],
  ["keyword sem referência colada", "This does not fix the bug described in #246"],
  ["negação depois da keyword", "Closes #9, but not the related regression"],
  ["mensagem comum sem nada", "chore(espn): refresh br2026 snapshot"],
]) {
  test(`${label}: ${JSON.stringify(text)}`, () => assert(!fires(text), `reprovou indevidamente: ${JSON.stringify(findNegatedClosures(text))}`));
}

// ─── INTEGRAÇÃO: repositório git real e temporário ──────────────────────────
console.log("\n  — integração contra um repositório git de verdade:");

const repo = mkdtempSync(join(tmpdir(), "closure-gate-"));
try {
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "gate@example.invalid");
  git("config", "user.name", "Gate Test");

  writeFileSync(join(repo, "a.txt"), "base\n");
  git("add", "."); git("commit", "-q", "-m", "base commit");
  const base = git("rev-parse", "HEAD").trim();

  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", "."); git("commit", "-q", "-m", "chore: something harmless\n\nRelates to #1");

  test("commits limpos não produzem achado", () => {
    const { commits, findings } = scanCommitRange(base, { cwd: repo });
    assert(commits.length === 1, `esperado 1 commit novo, veio ${commits.length}`);
    assert(findings.length === 0, `achado indevido: ${JSON.stringify(findings)}`);
  });

  writeFileSync(join(repo, "a.txt"), "two\n");
  git("add", "."); git("commit", "-q", "-m", "fix(x): algo\n\nDoes NOT fix #246: ainda quebrado");

  test("o commit ofensivo é detectado, com o SHA certo", () => {
    const { commits, findings } = scanCommitRange(base, { cwd: repo });
    assert(commits.length === 2, `esperado 2 commits novos, veio ${commits.length}`);
    assert(findings.length === 1, `esperado 1 achado, veio ${findings.length}`);
    assert(findings[0].reference === "#246", `referência errada: ${findings[0].reference}`);
    assert(/^[0-9a-f]{10}$/.test(findings[0].sha), `sha ausente ou malformado: ${findings[0].sha}`);
  });

  test("o escopo é forward-only: história anterior à base fica de fora", () => {
    // A mensagem ofensiva já está no repo; varrendo a partir do PRÓPRIO HEAD não há commit novo.
    const head = git("rev-parse", "HEAD").trim();
    const { commits, findings } = scanCommitRange(head, { cwd: repo });
    assert(commits.length === 0, `esperado 0 commits novos, veio ${commits.length}`);
    assert(findings.length === 0, "não pode achar nada fora da janela forward-only");
  });
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ CLOSURE-KEYWORD GATE TESTS FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
