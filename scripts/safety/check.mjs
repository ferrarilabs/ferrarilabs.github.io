#!/usr/bin/env node
/**
 * check.mjs — O COMANDO CANONICO. `npm run check`.
 *
 * ─── O QUE ELE COMPOE ────────────────────────────────────────────────────────────────────────
 *
 *   1. classificacao da mudanca      quais superficies criticas o diff tocou (CHANGE_SAFETY_REPORT)
 *   2. contrato de seguranca         o meta-gate: invariantes + autoprotecao dos gates
 *   3. suite canonica                scripts/verify.mjs — os 150 checks, agregados
 *   4. arvore/evidencia              nada gerado pela propria execucao pode ficar para tras
 *
 * ─── POR QUE A SUITE CANONICA E O verify.mjs E NAO O `npm test` ──────────────────────────────
 *
 * Porque o verify.mjs DOMINA a cadeia do `npm test`, e isso e verificado, nao suposto: o check
 * G2 do contrato reprova se um so comando da cadeia do `npm test` deixar de ser um check daqui.
 * Enquanto G2 esta verde, rodar o verify executa tudo que o `npm test` executa — mais 46 gates
 * que o `npm test` nunca alcancou, incluindo a matriz de crash do Powerball, os readers privados
 * da Copa e a politica de assunto.
 *
 * E o verify agrega: ele roda TODOS os checks e falha no fim. A cadeia `&&` do `npm test`
 * curto-circuita no primeiro vermelho — numa execucao medida deste repositorio, UMA falha
 * escondeu OITO suites que passavam, entre elas state-merge, golden-master e money-interop.
 * "test:node FAILED" nao dizia nada sobre nenhuma delas.
 *
 * Quem quiser a cadeia literal tem `npm run check -- --with-npm-test`. Ela nao roda por padrao
 * porque reexecutaria 99 suites — incluindo as de navegador, que levam minutos cada — para
 * produzir exatamente a mesma informacao que o verify ja produziu.
 *
 * Uso:
 *   npm run check
 *   npm run check -- --with-npm-test    # roda tambem a cadeia literal do npm test
 *   npm run check -- --fast             # pula o grupo `browser` (NAO vale como verificacao final)
 */

import { spawnSync, spawn } from "node:child_process";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, git, gitOrNull } from "./surfaces.mjs";

const ARGS = process.argv.slice(2);
const WITH_NPM_TEST = ARGS.includes("--with-npm-test");
const FAST = ARGS.includes("--fast");

const VERIFY_JSON = join(ROOT, "verify-summary.json");
const SAFETY_JSON = join(ROOT, "safety-summary.json");

// ── sharding do grupo `browser` — max concorrencia = 2 ──────────────────────────────────────────
//
// Profiling mediu o grupo `browser` em ~606s, 76% do `npm run check` local. Nenhum dos 21 checks
// muta arquivo de repositorio (so `visual-consistency` escreve, e so a sua propria evidencia) e
// cada um ja declara sua PROPRIA porta fixa (harness-ports-unique garante isso) — entao, ao
// contrario de M25/M26 na suite de mutacao, nao ha necessidade de isolamento por worktree aqui:
// os dois shards podem rodar direto contra a MESMA arvore, em paralelo.
//
// Composicao: bin-packing pelas duraticoes medidas (nao agrupamento tematico) para equilibrar o
// caminho critico entre os dois shards. Ver CHANGE_INTENT.json para o raciocinio completo.
const BROWSER_SHARD_A = [
  "countdown-layout", "prob-bar-geometry", "br-live-behavior-parity", "live-card-dom",
  "multi-live-hero-responsive", "cdb-sticky-overlap", "br-standings-layout",
  "cdb-bracket-browser", "visual-consistency", "draw-combo",
];
const BROWSER_SHARD_B = [
  "accessibility", "responsive-14-width", "live-prob-bars", "combo-visual", "multi-live-hero",
  "structural-parity", "cdb-bracket-persistence", "cdb-entry-name-readonly", "combo-next-label",
  "combo-lifecycle", "aria-nav",
];

/** Arquivos que ESTA execucao gera. Sao evidencia efemera, nunca conteudo do repositorio. */
const GENERATED = [VERIFY_JSON, SAFETY_JSON];

const line = (s = "") => console.log(s);
const rule = () => line("─".repeat(78));

function run(cmd, args, { label }) {
  line(`\n▶ ${label}`);
  rule();
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", timeout: 3_600_000 });
  if (r.error) { console.error(`  erro ao executar: ${r.error.message}`); return 2; }
  return r.status === null ? 2 : r.status;
}

/**
 * Roda um shard de forma assincrona (nunca bloqueia o outro shard concorrente), capturando toda
 * a saida em memoria em vez de `stdio: "inherit"` — dois processos concorrentes escrevendo
 * "inherit" ao mesmo tempo intercalariam linha a linha, tornando uma falha dificil de atribuir a
 * um check especifico. Teto de 20min: bem acima do esperado por shard (~5-6min), existe so como
 * rede de seguranca contra um hang total — falha FECHADA (timeout conta como falha, nunca skip).
 */
function runShardAsync(label, args) {
  return new Promise((resolve) => {
    const child = spawn("node", args, { cwd: ROOT });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 1_200_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ label, code, stdout, stderr, timedOut }); });
    child.on("error", (err) => { clearTimeout(timer); resolve({ label, code: null, error: err.message, stdout, stderr, timedOut }); });
  });
}

// ── estado inicial da arvore ──────────────────────────────────────────────────────────────────
// Medido ANTES de gerar qualquer evidencia. Comparar depois com a arvore ja suja pela propria
// execucao confundiria "o repositorio tinha mudanca pendente" com "o check sujou o repositorio".
const dirtyBefore = (gitOrNull(["status", "--porcelain"]) || "")
  .split("\n").map((l) => l.trim()).filter(Boolean);

line("\n╔══════════════════════════════════════════════════════════════════════════════╗");
line("║  FERRARILABS — CONTRATO PERMANENTE DE SEGURANCA DE MUDANCA                    ║");
line("╚══════════════════════════════════════════════════════════════════════════════╝");

const results = {};

// ── 1. classificacao ──────────────────────────────────────────────────────────────────────────
results.classify = run("node", ["scripts/safety/classify.mjs", `--json-out=${SAFETY_JSON}`],
  { label: "1/4  Classificacao da mudanca (CHANGE_SAFETY_REPORT)" });
// A classificacao e informativa por contrato — quem REPROVA mudanca nao declarada e o meta-gate.
if (results.classify === 2) { console.error("\n✗ a classificacao nao pode ser executada"); process.exit(2); }
{
  const rep = JSON.parse(readFileSync(SAFETY_JSON, "utf8"));
  line("");
  line(`  CRITICAL_SURFACES_CHANGED = ${rep.CRITICAL_SURFACES_CHANGED.length ? rep.CRITICAL_SURFACES_CHANGED.join(", ") : "none"}`);
}

// ── 2. contrato ───────────────────────────────────────────────────────────────────────────────
// Roda ANTES da suite longa: ele custa ~1s e responde "esta mudanca tem direito de existir?".
// Descobrir isso depois de vinte minutos de navegador seria desperdicio puro. Ele TAMBEM e um
// check do verify (id `safety-contract`), para que `npm run verify` sozinho continue completo.
results.contract = run("node", ["scripts/safety/audit_safety_contract.mjs"],
  { label: "2/4  Contrato de seguranca (invariantes + autoprotecao dos gates)" });

if (results.contract !== 0) {
  line("\n╔══════════════════════════════════════════════════════════════════════════════╗");
  line("║  ✗ CONTRATO DE SEGURANCA REPROVADO — a suite canonica NAO foi executada      ║");
  line("╚══════════════════════════════════════════════════════════════════════════════╝");
  line("\n  Uma superficie critica mudou sem declaracao, ou um invariante deixou de valer.");
  line("  Se a mudanca e INTENCIONAL, declare-a em CHANGE_INTENT.json:\n");
  line('    { "declarations": [ { "surface_id": "...", "reason": "...",');
  line('        "expected_behavior_change": "...", "tests_required": ["..."] } ] }\n');
  line("  Ver docs/bolao/CHANGE_SAFETY_CONTRACT.md.\n");
  process.exit(1);
}

// ── 3. suite canonica ─────────────────────────────────────────────────────────────────────────
//
// Grupos, sempre PERGUNTADOS ao verify em vez de escritos aqui — uma lista de grupos escrita a
// mao vira mentira no dia em que alguem cria um grupo novo, e a falha e silenciosa (ja aconteceu:
// a primeira versao do --fast esquecia o grupo `provider`).
const listed = spawnSync("node", ["scripts/verify.mjs", "--list"], { cwd: ROOT, encoding: "utf8" });
const listedLines = listed.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
const allGroups = [...new Set(listedLines.map((l) => l[1]))].filter(Boolean);
const liveBrowserIds = new Set(listedLines.filter((l) => l[1] === "browser").map((l) => l[0]));

if (FAST) {
  line("\n  AVISO: --fast pula o grupo `browser`. Isso NAO vale como verificacao final —");
  line("  geometria e regressao visual so existem no navegador.");
  const groups = allGroups.filter((g) => g !== "browser");
  results.verify = run("node",
    ["scripts/verify.mjs", `--json-out=${VERIFY_JSON}`, `--only=${groups.join(",")}`],
    { label: "3/4  Suite canonica — scripts/verify.mjs (--fast)" });
} else {
  // Drift entre a composicao dos shards (escrita a mao acima) e o grupo `browser` REAL: qualquer
  // divergencia falha FECHADO em vez de rodar um shard incompleto em silencio — a mesma classe de
  // defeito que os 17 gates orfaos de 2026-08-10 (N11) ensinou a nunca deixar passar despercebida.
  {
    const declared = new Set([...BROWSER_SHARD_A, ...BROWSER_SHARD_B]);
    const faltando = [...liveBrowserIds].filter((id) => !declared.has(id));
    const sobrando = [...declared].filter((id) => !liveBrowserIds.has(id));
    const duplicado = BROWSER_SHARD_A.filter((id) => BROWSER_SHARD_B.includes(id));
    if (faltando.length || sobrando.length || duplicado.length) {
      line("\n╔══════════════════════════════════════════════════════════════════════════════╗");
      line("║  ✗ COMPOSICAO DOS SHARDS DE BROWSER DIVERGE DO GRUPO REAL — falha fechada    ║");
      line("╚══════════════════════════════════════════════════════════════════════════════╝");
      if (faltando.length) line(`  faltando nos shards (nao rodaria em nenhum lugar): ${faltando.join(", ")}`);
      if (sobrando.length) line(`  sobrando nos shards (nao existe mais no grupo browser): ${sobrando.join(", ")}`);
      if (duplicado.length) line(`  duplicado nos dois shards: ${duplicado.join(", ")}`);
      line("\n  Atualize BROWSER_SHARD_A / BROWSER_SHARD_B em scripts/safety/check.mjs.\n");
      process.exit(1);
    }
  }

  // 3a. grupos NAO-browser — serial, processo unico, como sempre foi.
  const nonBrowserGroups = allGroups.filter((g) => g !== "browser");
  const NONBROWSER_JSON = join(ROOT, "verify-summary-nonbrowser.json");
  const rNonBrowser = run("node",
    ["scripts/verify.mjs", `--json-out=${NONBROWSER_JSON}`, `--only=${nonBrowserGroups.join(",")}`],
    { label: "3a/4  Suite canonica — grupos nao-browser" });

  // 3b. grupo `browser` — 2 shards em paralelo. Concorrencia MAXIMA = 2, nunca mais, e nunca ao
  // mesmo tempo que 3a (que ja terminou). Nenhum dos 21 checks muta arquivo do repositorio nem
  // compartilha porta — sem necessidade de worktree isolada (diferente de M25/M26).
  line("\n▶ 3b/4  Suite canonica — grupo `browser`, 2 shards em paralelo (concorrencia max = 2)");
  rule();
  const SHARD_A_JSON = join(ROOT, "verify-summary-browser-a.json");
  const SHARD_B_JSON = join(ROOT, "verify-summary-browser-b.json");
  const GENERATED_SHARDS = [NONBROWSER_JSON, SHARD_A_JSON, SHARD_B_JSON];

  const [shardA, shardB] = await Promise.all([
    runShardAsync("Shard A", ["scripts/verify.mjs", `--json-out=${SHARD_A_JSON}`, `--only=${BROWSER_SHARD_A.join(",")}`]),
    runShardAsync("Shard B", ["scripts/verify.mjs", `--json-out=${SHARD_B_JSON}`, `--only=${BROWSER_SHARD_B.join(",")}`]),
  ]);

  // Saida de cada shard impressa por INTEIRO, um de cada vez — nunca intercalada caractere a
  // caractere entre os dois processos concorrentes, para que uma falha continue atribuivel a um
  // check especifico.
  for (const r of [shardA, shardB]) {
    line(`\n  ── ${r.label} (exit ${r.code ?? "n/a"}${r.timedOut ? ", timeout" : ""}) ──`);
    for (const l of `${r.stdout}${r.stderr}`.split("\n")) line(`  ${l}`);
  }

  const shardFailedHard = [shardA, shardB].some((r) => r.code !== 0);
  results.verify = (rNonBrowser === 0 && !shardFailedHard) ? 0 : 1;

  // Resumo combinado (nao-browser + os dois shards) escrito no MESMO caminho canonico que o CI ja
  // sobe como evidencia de falha — nenhuma mudanca necessaria em safety_check.yml.
  try {
    const parts = [NONBROWSER_JSON, SHARD_A_JSON, SHARD_B_JSON]
      .filter((p) => existsSync(p)).map((p) => JSON.parse(readFileSync(p, "utf8")));
    const checks = parts.flatMap((p) => p.checks || []);
    const totals = { passed: 0, failed: 0, skipped: 0, missing: 0 };
    for (const c of checks) {
      if (c.status === "PASSED") totals.passed++;
      else if (c.status === "FAILED") totals.failed++;
      else if (c.status === "SKIPPED") totals.skipped++;
      else if (c.status === "MISSING") totals.missing++;
    }
    const starts = parts.map((p) => p.startedAt).filter(Boolean).sort();
    const ends = parts.map((p) => p.finishedAt).filter(Boolean).sort();
    writeFileSync(VERIFY_JSON, JSON.stringify({
      schemaVersion: 1,
      startedAt: starts[0] || null,
      finishedAt: ends.at(-1) || null,
      capabilities: parts[0]?.capabilities || null,
      totals,
      checks,
      verdict: results.verify === 0 ? "PASSED" : "FAILED",
      sharded: { nonBrowser: true, browserShards: ["A", "B"] },
    }, null, 2) + "\n");
  } catch (e) {
    line(`  ✗ nao foi possivel combinar os resumos dos shards: ${e.message}`);
    results.verify = 1;
  }
  for (const f of GENERATED_SHARDS) { try { if (existsSync(f)) unlinkSync(f); } catch { /* evidencia efemera, best-effort */ } }
}

if (WITH_NPM_TEST) {
  results.npmTest = run("npm", ["test"], { label: "3b/4  Cadeia literal do npm test (--with-npm-test)" });
}

// ── 4. arvore / evidencia ─────────────────────────────────────────────────────────────────────
line("\n▶ 4/4  Arvore de trabalho e evidencia gerada");
rule();

// A evidencia so e apagada quando TUDO passou.
//
// Apagar sempre era o comportamento anterior e estava errado: numa execucao vermelha o passo de
// upload do CI procuraria `verify-summary.json` e nao acharia nada, porque este passo o tinha
// removido segundos antes. O artefato de falha existe exatamente para a execucao que falha —
// remove-lo justamente ai e o unico caso em que ele importava. Os dois arquivos estao no
// .gitignore, entao mante-los nao suja a arvore nem entra em commit.
const somethingFailed = Object.values(results).some((v) => v !== 0);
if (!somethingFailed) for (const f of GENERATED) if (existsSync(f)) unlinkSync(f);
else line("  · evidencia preservada para inspecao (verify-summary.json, safety-summary.json)");

let treeOk = true;

// ── evidencia regenerada pela propria suite ───────────────────────────────────────────────────
// Estes artefatos carregam um carimbo de geracao (hora + commit), entao ficam "modificados"
// depois de TODA execucao mesmo quando nenhum achado mudou. Ignora-los esconderia uma mudanca
// real de achado visual; reprovar sempre ensinaria a ignorar `git status`. A saida certa e
// comparar o conteudo com os campos volateis normalizados.
{
  const { loadSurfaces } = await import("./surfaces.mjs");
  const arts = loadSurfaces().generated_evidence?.artifacts || [];
  const beforeSet = new Set(dirtyBefore.map((l) => l.slice(3)));

  for (const a of arts) {
    if (beforeSet.has(a.path)) continue;            // ja estava sujo antes: trabalho do dev, nao nosso
    const cur = gitOrNull(["diff", "--name-only", "--", a.path]);
    if (!cur) continue;                              // nao mudou

    // `.trim()` nas DUAS pontas. `gitOrNull` ja devolve a saida do git aparada, e o
    // `readFileSync` nao — entao um arquivo terminado em nova linha comparava DIFERENTE de si
    // mesmo, e o check anunciava "um achado da auditoria visual mudou" quando so o carimbo de
    // geracao tinha mudado. Um alarme que dispara sozinho e um alarme que se aprende a ignorar.
    const norm = (s) => (a.volatile || []).reduce(
      (acc, re) => acc.replace(new RegExp(re, "gm"), "<volatile>"), (s || "").trim());
    const committed = gitOrNull(["show", `HEAD:${a.path}`]);
    const current = existsSync(join(ROOT, a.path)) ? readFileSync(join(ROOT, a.path), "utf8") : "";

    const soCarimbo = norm(committed) === norm(current);
    git(["checkout", "--", a.path]);
    if (soCarimbo) {
      line(`  ✓ evidencia regenerada sem mudanca de conteudo, restaurada: ${a.path}`);
    } else {
      // Restaurada TAMBEM quando o conteudo mudou, e isto merece justificativa.
      //
      // A primeira versao reprovava aqui. Estava errada na pratica: o relatorio mede geometria
      // REAL, e boa parte dela e dirigida por conteudo — a altura de `main` do BR2026 caiu de
      // 2032px para 1972px entre duas execucoes desta sessao, porque o hero ao vivo some quando
      // nao ha jogo. O proprio ALLOWLIST classifica essa linha como "content-driven, not a fixed
      // design token". Exigir um commit de evidencia a cada partida jogada e ruido, e ruido
      // ensina a ignorar `git status` — que era exatamente o que este passo existia para evitar.
      //
      // Nada fica escondido: quem REPROVA divergencia visual e o gate `visual-consistency`, pelo
      // codigo de saida, e ele roda na suite canonica. Um achado DIVERGENT reprova a execucao
      // inteira independentemente deste arquivo. O .md/.json sao o retrato legivel da rodada,
      // nao o mecanismo de aplicacao — e um retrato nao precisa ser commitado a cada respiracao.
      line(`  · evidencia regenerada COM mudanca de conteudo, restaurada: ${a.path}`);
      line("      (geometria dirigida por conteudo — quem reprova divergencia e o gate");
      line("       visual-consistency, pelo codigo de saida, nao o diff deste arquivo)");
    }
  }
}

const dirtyAfter = (gitOrNull(["status", "--porcelain"]) || "")
  .split("\n").map((l) => l.trim()).filter(Boolean);
const before = new Set(dirtyBefore);
const introduced = dirtyAfter.filter((l) => !before.has(l));

if (introduced.length) {
  treeOk = false;
  line("  ✗ a execucao deixou alteracao para tras no repositorio:");
  for (const l of introduced) line(`      ${l}`);
  line("\n    Um check que suja o repositorio ensina a ignorar `git status` — e `git status`");
  line("    ignorado e como uma edicao acidental viaja junto com um commit legitimo.");
} else {
  line("  ✓ nenhuma alteracao introduzida pela propria execucao");
  line("  ✓ evidencia gerada foi removida (nao entra em commit nem em cache)");
}
if (dirtyBefore.length) {
  line(`\n  NOTA: a arvore JA tinha ${dirtyBefore.length} alteracao(oes) pendente(s) antes do check.`);
  line("  Isso nao reprova nada — mas nada disso foi commitado, e o contrato mediu essas");
  line("  alteracoes junto com o diff (a arvore de trabalho entra na classificacao).");
}

// ── veredito ──────────────────────────────────────────────────────────────────────────────────
const failed = Object.entries(results).filter(([, v]) => v !== 0).map(([k]) => k);
if (!treeOk) failed.push("tree");

line("");
rule();
line("  RESUMO");
line(`    classificacao        ${results.classify === 0 ? "OK" : "ERRO"}`);
line(`    contrato             ${results.contract === 0 ? "PASS" : "FAIL"}`);
line(`    suite canonica       ${results.verify === 0 ? "PASS" : "FAIL"}${FAST ? "  (--fast: browser NAO executado)" : ""}`);
if (WITH_NPM_TEST) line(`    npm test (literal)   ${results.npmTest === 0 ? "PASS" : "FAIL"}`);
line(`    arvore limpa         ${treeOk ? "YES" : "NO"}`);
rule();

if (failed.length) { line(`\n✗ CHECK REPROVADO (${failed.join(", ")})\n`); process.exit(1); }
line("\n✓ CHECK APROVADO\n");
process.exit(0);
