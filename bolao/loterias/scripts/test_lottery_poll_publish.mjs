#!/usr/bin/env node
/**
 * test_lottery_poll_publish.mjs — o estado da loteria chega ao site por PR, e o aviso nao depende disso.
 *
 * Ate 2026-10-28 `lottery_poll.yml` empurrava o estado direto para `main`. Desde 2026-10-14 o
 * ruleset `main-protection` recusa esse push (GH013); o workflow emitia um `::warning::`, saia 0 e
 * ficava verde. O estado publicado parou em 2026-10-08, com a Powerball ja acima de US$500M, e
 * ninguem foi avisado -- a elegibilidade existia so dentro do runner.
 *
 * Este gate prova, so lendo o YAML (sem rede, sem API do GitHub), que:
 *   1. nenhum passo empurra para main;
 *   2. a publicacao passa por scripts/ci/publish_data_via_pr.sh, num branch auto/data/, levando
 *      EXATAMENTE os dois arquivos de dado;
 *   3. a coleta tem so contents/pull-requests/actions: write, e nada mais amplo;
 *   4. o checkout traz historico completo (o branch de dado recebe origin/main por merge);
 *   5. o aviso e decidido ANTES da publicacao, e o job que mexe em issue roda mesmo se ela falhar,
 *      com `issues: write` so nele;
 *   6. nenhum caminho de falha da publicacao vira `::warning::` com saida 0.
 * E prova que morde: cada mutacao abaixo tem de ser reprovada.
 *
 * Uso: node bolao/loterias/scripts/test_lottery_poll_publish.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const POLL = readFileSync(join(ROOT, ".github", "workflows", "lottery_poll.yml"), "utf8");
const DADOS = ["bolao/loterias/config/lottery_results.jsonl", "bolao/loterias/config/lottery_status.json"];

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Bloco indentado sob `chave:` no nivel `indent`, ate a proxima linha de mesmo nivel ou menor. */
function block(src, key, indent = "") {
  const m = src.match(new RegExp(`^${indent}${key}:[^\\n]*\\n((?:${indent}[ \\t]+[^\\n]*\\n|[ \\t]*\\n)*)`, "m"));
  return m ? m[1] : null;
}
const linhas = (b) => (b || "").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);

/** Passos de um job, em ordem: cada item comeca em "      - ". */
function steps(jobText) {
  const i = jobText.indexOf("    steps:\n");
  if (i < 0) return [];
  return jobText.slice(i + "    steps:\n".length).split(/\n(?=      - )/).map((t) => ({
    text: t,
    name: (t.match(/name:\s*(.+?)\s*$/m) || [])[1] || "",
    id: (t.match(/^\s+id:\s*(\S+)\s*$/m) || [])[1],
  }));
}

function violations(poll) {
  const v = [];
  const jobs = block(poll, "jobs") || "";
  const coleta = block(jobs, "coleta", "  ");
  const aviso = block(jobs, "aviso", "  ");
  if (!coleta) return ["sem job `coleta`"];

  if (/git push[^\n]*\bmain\b/.test(poll)) v.push("algum passo empurra para main");

  const perms = linhas(block(poll, "permissions"));
  const quer = ["contents: write", "pull-requests: write", "actions: write"];
  for (const p of quer) if (!perms.includes(p)) v.push(`falta \`${p}\` no topo`);
  const extra = perms.filter((p) => !quer.includes(p));
  if (extra.length) v.push(`permissoes alem do necessario no topo: ${extra.join(", ")}`);
  if (/permissions:\s*write-all/.test(poll)) v.push("permissions: write-all");

  if (!/uses: actions\/checkout@[^\n]*\n\s+with:\s*\n(?:\s+#[^\n]*\n)*\s+fetch-depth:\s*0\b/.test(coleta)) {
    v.push("checkout raso: o merge de origin/main no branch de dado falharia");
  }

  const st = steps(coleta);
  const pubIdx = st.findIndex((s) => /scripts\/ci\/publish_data_via_pr\.sh/.test(s.text));
  if (pubIdx < 0) v.push("a publicacao nao passa por publish_data_via_pr.sh");
  else {
    const pub = st[pubIdx].text;
    const branch = (pub.match(/publish_data_via_pr\.sh\s+"([^"]+)"/) || [])[1];
    if (!branch || !branch.startsWith("auto/data/")) v.push(`branch de dado fora de auto/data/: ${branch}`);
    const args = pub.slice(pub.indexOf("publish_data_via_pr.sh"));
    const caminhos = [...args.matchAll(/(bolao\/[^\s"\\]+)/g)].map((m) => m[1]);
    if (JSON.stringify([...caminhos].sort()) !== JSON.stringify([...DADOS].sort())) {
      v.push(`caminhos publicados != dado da coleta: ${caminhos.join(", ")}`);
    }
    if (!/GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/.test(pub)) v.push("publicacao sem GH_TOKEN");
    if (/::warning::/.test(pub)) v.push("falha de publicacao rebaixada a ::warning::");
    if (/publish_data_via_pr\.sh[\s\S]*\|\|\s*true/.test(pub)) v.push("falha de publicacao engolida com || true");
  }

  const avIdx = st.findIndex((s) => s.id === "aviso");
  if (avIdx < 0 || !/eligibility_alert\.py/.test(st[avIdx].text)) v.push("sem passo `aviso` rodando eligibility_alert.py");
  else if (pubIdx >= 0 && avIdx > pubIdx) v.push("o aviso e decidido DEPOIS da publicacao");

  const outs = block(coleta, "outputs", "    ");
  for (const k of ["known", "alert", "key", "title", "body"]) {
    if (!new RegExp(`^\\s+${k}:\\s*\\$\\{\\{\\s*steps\\.aviso\\.outputs\\.${k}\\s*\\}\\}`, "m").test(outs || "")) {
      v.push(`job coleta nao exporta \`${k}\` do passo aviso`);
    }
  }

  if (!aviso) v.push("sem job `aviso`");
  else {
    if (!/^\s+needs:\s*coleta\s*$/m.test(aviso)) v.push("job aviso nao depende de coleta");
    const cond = (aviso.match(/^\s+if:\s*(.+?)\s*$/m) || [])[1] || "";
    if (!/always\(\)/.test(cond)) v.push("job aviso nao roda quando a publicacao falha (falta always())");
    if (!/needs\.coleta\.outputs\.known == 'true'/.test(cond)) v.push("job aviso age sem medicao confiavel");
    const ap = linhas(block(aviso, "permissions", "    "));
    if (JSON.stringify(ap) !== JSON.stringify(["issues: write"])) v.push(`permissoes do job aviso: ${ap.join(", ")}`);
    if (/\$\{\{\s*needs\.coleta\.outputs\.(title|body)\s*\}\}/.test(aviso.split("run: |")[1] || "")) {
      v.push("titulo/corpo interpolados direto no script (use env)");
    }
  }
  if (/issues:\s*write/.test(coleta)) v.push("`issues: write` concedido a coleta");
  return v;
}

console.log("\nlottery_poll.yml — estado por PR rolante, aviso independente da publicacao\n");

test("o workflow real cumpre a invariante", () => {
  const v = violations(POLL);
  assert(v.length === 0, v.join("; "));
});

// Mutacoes: cada uma reintroduz uma forma concreta do defeito. Se alguma passar, o gate nao morde.
const MUTATIONS = [
  ["push direto em main (o defeito original)",
    (s) => s.replace("          scripts/ci/publish_data_via_pr.sh", "          git push origin HEAD:main\n          scripts/ci/publish_data_via_pr.sh")],
  ["publicacao rebaixada a warning",
    (s) => s.replace('          scripts/ci/publish_data_via_pr.sh "auto', '          scripts/ci/publish_data_via_pr.sh || echo "::warning::falhou"\n          true "auto')],
  ["sem publish_data_via_pr.sh", (s) => s.replace(/scripts\/ci\/publish_data_via_pr\.sh/g, "scripts/ci/outro.sh")],
  ["branch fora de auto/data", (s) => s.replace('"auto/data/lottery-status"', '"lottery-status"')],
  ["um arquivo de dado a menos", (s) => s.replace(/\\\n\s+bolao\/loterias\/config\/lottery_results\.jsonl\s*\\\n(\s+bolao\/loterias\/config\/lottery_status\.json)\n/, "\\\n$1\n")],
  ["sem pull-requests: write", (s) => s.replace(/^  pull-requests: write\n/m, "")],
  ["permissao ampliada no topo", (s) => s.replace(/^  actions: write$/m, "  actions: write\n  issues: write")],
  ["checkout raso", (s) => s.replace(/fetch-depth: 0/, "fetch-depth: 1")],
  ["aviso depois da publicacao", (s) => {
    const a = s.indexOf("      # ANTES da publicacao"), b = s.indexOf("      - name: Publicar o estado");
    const c = s.indexOf("\n  # Job separado");
    return s.slice(0, a) + s.slice(b, c) + "\n\n" + s.slice(a, b).trimEnd() + "\n" + s.slice(c);
  }],
  ["aviso sem always()", (s) => s.replace("always() && ", "")],
  ["aviso sem exigir medicao", (s) => s.replace(" && needs.coleta.outputs.known == 'true'", "")],
  ["job aviso com permissao a mais", (s) => s.replace(/^      issues: write$/m, "      issues: write\n      contents: write")],
  ["corpo interpolado no script", (s) => s.replace('--body "$BODY"', '--body "${{ needs.coleta.outputs.body }}"')],
  ["saida body nao exportada", (s) => s.replace(/^      body: \$\{\{ steps\.aviso\.outputs\.body \}\}\n/m, "")],
];
for (const [name, mutate] of MUTATIONS) {
  test(`mutacao reprovada: ${name}`, () => {
    const mutated = mutate(POLL);
    assert(mutated !== POLL, "a mutacao nao alterou nada (padrao do YAML mudou?)");
    assert(violations(mutated).length > 0, "a mutacao passou despercebida");
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
