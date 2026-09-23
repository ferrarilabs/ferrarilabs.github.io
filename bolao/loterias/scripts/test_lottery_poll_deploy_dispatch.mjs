#!/usr/bin/env node
/**
 * test_lottery_poll_deploy_dispatch.mjs — a coleta de loteria que chega a `main` tem de ir ao ar.
 *
 * `lottery_poll.yml` commita o estado do ciclo (jackpots, elegibilidade, saldo) que a pagina do
 * Powerball le, e empurra com o GITHUB_TOKEN. Um push com esse token nao dispara nenhum outro
 * workflow, entao o `push:` de deploy-pages.yml nunca roda para esses commits: sem um pedido
 * explicito de deploy, o dado novo fica em `main` e a pagina publicada continua mostrando o velho.
 *
 * Este gate prova, so lendo o YAML (sem rede, sem API do GitHub), que:
 *   1. o workflow alvo existe com o nome usado no pedido e aceita `workflow_dispatch`;
 *   2. lottery_poll tem `actions: write` (exigido por `gh workflow run`) e nada mais amplo;
 *   3. o passo de commit marca `pushed=true` so no ramo em que o push deu certo;
 *   4. um passo posterior, condicionado a essa saida, pede o deploy existente em `main`.
 * E prova que morde: cada mutacao abaixo tem de ser reprovada.
 *
 * Uso: node bolao/loterias/scripts/test_lottery_poll_deploy_dispatch.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WF_DIR = join(ROOT, ".github", "workflows");
const POLL = readFileSync(join(WF_DIR, "lottery_poll.yml"), "utf8");
const DEPLOY = readFileSync(join(WF_DIR, "deploy-pages.yml"), "utf8");

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Bloco de nivel superior (`permissions:`) ate a proxima chave sem indentacao. */
function topLevelBlock(src, key) {
  const m = src.match(new RegExp(`^${key}:[^\\n]*\\n((?:[ \\t]+[^\\n]*\\n|[ \\t]*\\n)*)`, "m"));
  return m ? m[1] : null;
}

/** Passos do job, em ordem: cada item comeca em "      - " (indentacao de `steps:`). */
function steps(src) {
  const after = src.slice(src.indexOf("    steps:\n") + "    steps:\n".length);
  return after.split(/\n(?=      - )/).map((block) => ({
    text: block,
    id: (block.match(/^\s+id:\s*(\S+)\s*$/m) || [])[1],
    ifExpr: (block.match(/^\s+if:\s*(.+?)\s*$/m) || [])[1],
  }));
}

/** Lista de violacoes da invariante; vazia = ok. */
function violations(poll, deploy) {
  const v = [];
  const deployName = (deploy.match(/^name:\s*(.+?)\s*$/m) || [])[1];
  if (!deployName) v.push("deploy-pages.yml sem `name:`");
  if (!/^\s+workflow_dispatch:/m.test(topLevelBlock(deploy, "on") || "")) {
    v.push("deploy-pages.yml nao aceita workflow_dispatch");
  }

  const perms = topLevelBlock(poll, "permissions");
  if (perms === null) v.push("lottery_poll.yml sem bloco `permissions:`");
  else {
    const granted = perms.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
    if (!granted.includes("actions: write")) v.push("falta `actions: write` (exigido por gh workflow run)");
    if (!granted.includes("contents: write")) v.push("falta `contents: write` (o commit da coleta)");
    const extra = granted.filter((g) => g !== "actions: write" && g !== "contents: write");
    if (extra.length) v.push(`permissoes alem do necessario: ${extra.join(", ")}`);
  }
  if (/^permissions:\s*write-all/m.test(poll)) v.push("permissions: write-all");

  const all = steps(poll);
  const commitIdx = all.findIndex((s) => /git push origin HEAD:main/.test(s.text));
  if (commitIdx < 0) { v.push("nenhum passo empurra para main"); return v; }
  const commit = all[commitIdx];
  if (!commit.id) v.push("o passo de push nao tem `id:` para expor a saida");
  const successBranch = commit.text.match(/if git push origin HEAD:main; then([\s\S]*?)\n\s*fi\b/);
  if (!successBranch || !/echo "pushed=true" >> "\$GITHUB_OUTPUT"/.test(successBranch[1])) {
    v.push("`pushed=true` nao e marcado no ramo de push bem-sucedido");
  }
  const outside = commit.text.replace(successBranch ? successBranch[0] : "", "");
  if (/pushed=true/.test(outside)) v.push("`pushed=true` marcado fora do ramo de push bem-sucedido");

  const dispatch = all.slice(commitIdx + 1).find((s) => /gh workflow run/.test(s.text));
  if (!dispatch) v.push("nenhum passo depois do push pede o deploy do Pages");
  else {
    const want = `gh workflow run "${deployName}" --ref main`;
    if (!dispatch.text.includes(want)) v.push(`o pedido nao e exatamente: ${want}`);
    const cond = commit.id && `steps.${commit.id}.outputs.pushed == 'true'`;
    if (!cond || dispatch.ifExpr !== cond) {
      v.push(`o pedido de deploy nao esta condicionado a \`${cond}\` (esta: ${dispatch.ifExpr || "sem if"})`);
    }
    if (!/GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/.test(dispatch.text)) {
      v.push("o pedido de deploy nao recebe GH_TOKEN");
    }
  }
  return v;
}

console.log("\nlottery_poll.yml — commit que chega a main pede o deploy do Pages\n");

test("o workflow real cumpre a invariante", () => {
  const v = violations(POLL, DEPLOY);
  assert(v.length === 0, v.join("; "));
});

// Mutacoes: cada uma reintroduz uma forma concreta do defeito. Se alguma passar, o gate nao morde.
const MUTATIONS = [
  ["sem o passo de deploy (o defeito original)",
    (s) => s.replace(/\n\n?[ \t]*#[^\n]*\n[ \t]*#[^\n]*\n[ \t]*- name: Pedir o deploy[\s\S]*$/, "\n")],
  ["sem `actions: write`", (s) => s.replace(/^\s+actions: write\n/m, "\n")],
  ["permissao ampliada", (s) => s.replace(/^(\s+)actions: write$/m, "$1actions: write\n$1pull-requests: write")],
  ["deploy sem condicao (dispararia sem commit)", (s) => s.replace(/^\s+if: steps\.commit\.outputs\.pushed == 'true'\n/m, "")],
  ["pushed=true marcado antes do push", (s) => s.replace('git add bolao/loterias', 'echo "pushed=true" >> "$GITHUB_OUTPUT"\n          git add bolao/loterias')],
  ["pushed=true removido do ramo de sucesso", (s) => s.replace(/\n\s+echo "pushed=true" >> "\$GITHUB_OUTPUT"/, "")],
  ["nome de workflow errado", (s) => s.replace('gh workflow run "Deploy GitHub Pages"', 'gh workflow run "Deploy Pages"')],
  ["ref diferente de main", (s) => s.replace("--ref main", "--ref ${{ github.ref_name }}")],
  ["passo de push sem id", (s) => s.replace(/^\s+id: commit\n/m, "\n")],
];
for (const [name, mutate] of MUTATIONS) {
  test(`mutacao reprovada: ${name}`, () => {
    const mutated = mutate(POLL);
    assert(mutated !== POLL, "a mutacao nao alterou nada (padrao do YAML mudou?)");
    assert(violations(mutated, DEPLOY).length > 0, "a mutacao passou despercebida");
  });
}
test("mutacao reprovada: deploy-pages sem workflow_dispatch", () => {
  const mutated = DEPLOY.replace(/^\s+workflow_dispatch:\n/m, "\n");
  assert(mutated !== DEPLOY, "a mutacao nao alterou nada");
  assert(violations(POLL, mutated).length > 0, "a mutacao passou despercebida");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
