/**
 * test_cachebust_app_shared_files.mjs — módulos compartilhados por um SUBCONJUNTO de apps
 * (incidente 2026-09-03, run 33786641021).
 *
 * ─── O QUE ACONTECEU ─────────────────────────────────────────────────────────────────────────
 *
 * `where_to_watch.js` (#391, "Onde assistir") é carregado por br2026 e cdb2026 — nunca por
 * copa2026, arquivado e sem card de próxima partida. Ele entrou em `SHARED_FILES`, que o
 * `checkApp()` de então tratava como universal: TODO app precisava referenciar TODO arquivo da
 * lista. `sync_version.yml` rodou `cachebust.mjs write --app=copa2026,br2026,cdb2026` e:
 *
 *     ✗ [copa2026] WRITE FAILED — ../shared/js/where_to_watch.js: has (no ?v= found)
 *     ✓ [br2026]   cache-bust written and verified
 *     ✓ [cdb2026]  cache-bust written and verified
 *
 * `process.exit(1)` no meio da matriz abortou o step ANTES do commit — br2026/cdb2026 ficaram
 * com a tag certa em memória, mas nada foi commitado para NENHUM dos três, e o deploy do Pages
 * nunca foi disparado.
 *
 * ─── O QUE ESTE GATE PROVA ──────────────────────────────────────────────────────────────────
 *
 * Que um módulo compartilhado por ALGUNS apps (`APP_SHARED_FILES`) nunca é exigido de um app que
 * não o carrega, que É exigido dos apps que o carregam, e que o comando REAL do workflow
 * (`node bolao/scripts/cachebust.mjs write --app=copa2026,br2026,cdb2026`) sai com EXIT 0 —
 * fechando a lacuna que fez `npm run check` passar no PR #391 enquanto o workflow determinístico
 * pós-merge falhava (nenhum gate exercitava os TRÊS apps através do CLI real, com um app que
 * genuinamente não referencia o módulo específico de outro).
 *
 * Hermético: cada teste que toca disco copia `bolao/{shared,copa2026,br2026,cdb2026}` real para
 * um diretório temporário e roda contra a CÓPIA — nenhuma escrita no `bolao/` versionado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computeAppTag, criticalFilesForApp,
  APP_FILES, SHARED_FILES, APP_SHARED_FILES, APPS,
} from "./cachebust.mjs";

const SCRIPTS_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_ROOT, "..", "..");
const CACHEBUST_SCRIPT = join(SCRIPTS_ROOT, "cachebust.mjs");

console.log("\nA. `where_to_watch.js` está em APP_SHARED_FILES, não em SHARED_FILES\n");

test("SHARED_FILES (comum aos três) não contém where_to_watch.js", () => {
  assert.ok(!SHARED_FILES.includes("../shared/js/where_to_watch.js"),
    "onde estava antes do incidente: um módulo de subconjunto na lista universal");
});

test("APP_SHARED_FILES declara where_to_watch.js para br2026 e cdb2026, e NÃO para copa2026", () => {
  assert.ok(!(APP_SHARED_FILES.copa2026 || []).includes("../shared/js/where_to_watch.js"),
    "copa2026 nunca carrega este módulo — não pode ser exigido dele");
  assert.ok((APP_SHARED_FILES.br2026 || []).includes("../shared/js/where_to_watch.js"), "br2026 carrega");
  assert.ok((APP_SHARED_FILES.cdb2026 || []).includes("../shared/js/where_to_watch.js"), "cdb2026 carrega");
});

test("toda chave de APPS existe em APP_SHARED_FILES, mesmo que vazia (nenhum app 'esquecido')", () => {
  for (const app of APPS) {
    assert.ok(Object.prototype.hasOwnProperty.call(APP_SHARED_FILES, app),
      `${app}: sem entrada em APP_SHARED_FILES — indistinguível de "de propósito vazio"`);
  }
});

console.log("\nB. criticalFilesForApp() — copa2026 não exige o que nunca carrega\n");

test("criticalFilesForApp(copa2026) não inclui where_to_watch.js", () => {
  assert.ok(!criticalFilesForApp("copa2026").includes("../shared/js/where_to_watch.js"));
});
test("criticalFilesForApp(br2026) inclui where_to_watch.js", () => {
  assert.ok(criticalFilesForApp("br2026").includes("../shared/js/where_to_watch.js"));
});
test("criticalFilesForApp(cdb2026) inclui where_to_watch.js", () => {
  assert.ok(criticalFilesForApp("cdb2026").includes("../shared/js/where_to_watch.js"));
});
test("app desconhecido cai em [] de extras (comportamento seguro, igual ao antigo CRITICAL_FILES)", () => {
  const desconhecido = criticalFilesForApp("app-que-nao-existe");
  const universal = [...APP_FILES, ...SHARED_FILES];
  assert.deepEqual(desconhecido, universal);
});

console.log("\nC. O COMANDO REAL do workflow, contra o repositório de verdade — a lacuna que passou no #391\n");

// Esta é a prova que faltava: `npm run check` do PR #391 nunca invocou o CLI com os TRÊS apps
// reais simultaneamente e exigiu EXIT 0 — só testava fixtures sintéticas onde todo app tinha o
// mesmo conjunto. O workflow real (`sync_version.yml`) SIM roda os três juntos, e foi isso que
// quebrou. Este teste fecha exatamente essa lacuna.
test("EXATO comando do workflow: `write --app=copa2026,br2026,cdb2026` sai com EXIT 0 (real repo, dry via --root de cópia)", () => {
  // Copia a árvore REAL de bolao/{copa2026,br2026,cdb2026} + bolao/shared para um diretório
  // temporário, para exercitar o COMANDO REAL sem escrever nos index.html versionados.
  const tmp = mkdtempSync(join(tmpdir(), "cachebust-real-workflow-"));
  try {
    const bolaoRoot = join(REPO_ROOT, "bolao");
    execFileSync("cp", ["-R", join(bolaoRoot, "shared"), join(tmp, "shared")]);
    for (const app of ["copa2026", "br2026", "cdb2026"]) {
      execFileSync("cp", ["-R", join(bolaoRoot, app), join(tmp, app)]);
    }

    // O EXATO comando de sync_version.yml, argumento por argumento, só com --root apontando
    // para a cópia (existe somente para este teste não escrever no repositório real).
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [
        CACHEBUST_SCRIPT, "write", "--app=copa2026,br2026,cdb2026", `--root=${tmp}`,
      ], { encoding: "utf8" });
    } catch (e) {
      exitCode = e.status ?? 1;
      console.log("  saída do processo (para diagnóstico se falhar):\n" + (e.stdout || "") + (e.stderr || ""));
    }
    assert.equal(exitCode, 0,
      "o comando EXATO que sync_version.yml roda tem de sair 0 — era exatamente isto que a run 33786641021 provou falso");

    // check, em seguida, também tem de passar — o par write→check é o contrato completo.
    execFileSync(process.execPath, [
      CACHEBUST_SCRIPT, "check", "--app=copa2026,br2026,cdb2026", `--root=${tmp}`,
    ], { encoding: "utf8" });

    // Copa2026 não pode ter ganhado uma referência a where_to_watch.js só para o checker passar.
    const copaHtml = readFileSync(join(tmp, "copa2026", "index.html"), "utf8");
    assert.ok(!copaHtml.includes("where_to_watch"),
      "copa2026 não pode importar um módulo que não usa só para satisfazer o cache-bust");

    // br2026/cdb2026 continuam referenciando e tagueando where_to_watch.js normalmente.
    for (const app of ["br2026", "cdb2026"]) {
      const html = readFileSync(join(tmp, app, "index.html"), "utf8");
      assert.match(html, /where_to_watch\.js\?v=[a-f0-9]{12}"/, `${app}: where_to_watch.js sem tag válida`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("idempotência: write → check PASSA → segundo write não muda nada (cópia real)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cachebust-idempotent-real-"));
  try {
    const bolaoRoot = join(REPO_ROOT, "bolao");
    execFileSync("cp", ["-R", join(bolaoRoot, "shared"), join(tmp, "shared")]);
    for (const app of ["copa2026", "br2026", "cdb2026"]) {
      execFileSync("cp", ["-R", join(bolaoRoot, app), join(tmp, app)]);
    }
    execFileSync(process.execPath, [CACHEBUST_SCRIPT, "write", "--app=copa2026,br2026,cdb2026", `--root=${tmp}`]);
    const once = {};
    for (const app of ["copa2026", "br2026", "cdb2026"]) once[app] = readFileSync(join(tmp, app, "index.html"), "utf8");

    execFileSync(process.execPath, [CACHEBUST_SCRIPT, "check", "--app=copa2026,br2026,cdb2026", `--root=${tmp}`]);
    execFileSync(process.execPath, [CACHEBUST_SCRIPT, "write", "--app=copa2026,br2026,cdb2026", `--root=${tmp}`]);
    for (const app of ["copa2026", "br2026", "cdb2026"]) {
      const twice = readFileSync(join(tmp, app, "index.html"), "utf8");
      assert.equal(twice, once[app], `${app}: segundo write não deveria mudar nada`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("\nD. Conteúdo de where_to_watch.js muda a tag de br/cdb, nunca a de copa2026\n");

test("mudar where_to_watch.js muda computeAppTag(br2026) e computeAppTag(cdb2026), não computeAppTag(copa2026)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cachebust-wtw-content-"));
  try {
    const bolaoRoot = join(REPO_ROOT, "bolao");
    execFileSync("cp", ["-R", join(bolaoRoot, "shared"), join(tmp, "shared")]);
    for (const app of ["copa2026", "br2026", "cdb2026"]) {
      execFileSync("cp", ["-R", join(bolaoRoot, app), join(tmp, app)]);
    }
    const before = {
      copa2026: computeAppTag("copa2026", tmp),
      br2026: computeAppTag("br2026", tmp),
      cdb2026: computeAppTag("cdb2026", tmp),
    };

    writeFileSync(join(tmp, "shared", "js", "where_to_watch.js"),
      readFileSync(join(tmp, "shared", "js", "where_to_watch.js"), "utf8") + "\n// mutação de teste\n");

    const after = {
      copa2026: computeAppTag("copa2026", tmp),
      br2026: computeAppTag("br2026", tmp),
      cdb2026: computeAppTag("cdb2026", tmp),
    };

    assert.equal(after.copa2026, before.copa2026,
      "copa2026 não consome where_to_watch.js — sua tag não pode depender do conteúdo dele");
    assert.notEqual(after.br2026, before.br2026, "br2026 consome — a tag tem de mudar");
    assert.notEqual(after.cdb2026, before.cdb2026, "cdb2026 consome — a tag tem de mudar");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log("\nE. Controle negativo — reintroduzir where_to_watch.js em SHARED_FILES reprova este gate\n");

test("mutante 'where_to_watch.js de volta em SHARED_FILES' é detectável (o próprio código denuncia)", () => {
  const src = readFileSync(join(SCRIPTS_ROOT, "cachebust.mjs"), "utf8");
  // Só o literal do array, não o comentário de prosa acima dele (que CITA where_to_watch.js de
  // propósito, para narrar o incidente) — daí `[` até o `]` que fecha, não até a próxima const.
  const inicio = src.indexOf("const SHARED_FILES = [");
  const fimArray = src.indexOf("];", inicio);
  const arrayLiteral = src.slice(inicio, fimArray);
  assert.ok(!arrayLiteral.includes("where_to_watch.js"),
    "where_to_watch.js voltou para a lista universal — reproduziria o incidente 2026-09-03 em qualquer app que não o carregue");
  // E o inverso — control de sanidade: continua presente em APP_SHARED_FILES.
  assert.ok(criticalFilesForApp("br2026").includes("../shared/js/where_to_watch.js"));
});
