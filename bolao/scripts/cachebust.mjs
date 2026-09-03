/**
 * cachebust.mjs — shared cache-bust core for the bolão apps (PR120-final review item 2).
 *
 * Run:  node bolao/scripts/cachebust.mjs check|write [--app=copa2026,br2026,cdb2026] [--root=<path>]
 *   (defaults to all three bolão apps if --app is omitted; "write" == the old "--write" flag,
 *   both forms accepted for convenience)
 *
 * Why this file exists: before this fix there were TWO incompatible sources of truth for the
 * `?v=` cache-bust tag on the five critical assets (css/styles.css, js/config.js, js/data.js,
 * js/i18n.js, js/app.js):
 *   - `bolao/cdb2026/scripts/check_cachebust.mjs` (local checker) computed a SHA-256 content hash
 *     of the five files' bytes — a tag that only changes when content actually changes.
 *   - `.github/workflows/sync_version.yml` (CI) used `git rev-parse --short HEAD` — a tag that
 *     changes on EVERY commit, whether or not it touched any of the five files, and is NOT the
 *     same value the checker considers correct. A workflow-applied tag would immediately fail
 *     `check_cachebust.mjs`'s own definition of "up to date", and vice versa — two checkers, two
 *     answers, no single truth.
 *
 * Fix: this module is the ONLY place the tag is computed or the ONLY place `?v=` is inserted or
 * replaced. `bolao/cdb2026/scripts/check_cachebust.mjs` (kept, for backwards-compat CLI + the
 * existing unit test suite) now imports every function from here instead of defining its own
 * copy. `.github/workflows/sync_version.yml` calls `node bolao/scripts/cachebust.mjs write` for
 * the three bolão apps — the exact same code path, not a re-implementation in bash/sed. See
 * `bolao/scripts/cachebust.integration.test.mjs` for a runnable proof of this chain (no query →
 * write → checker passes → idempotent → CLI invocation matches direct function calls).
 *
 * Scope note: `bolao/loterias/powerball/` is NOT covered by this shared module. Fase 2.2-correção
 * treats Powerball as explicitly out of scope for this branch (separate, already-registered PII
 * findings — see docs/bolao/FASE2.2_CORRECAO_FINAL_REPORT.md and CLAUDE.md "hard rules"), so
 * `sync_version.yml` keeps Powerball on its previous, unchanged sed-based step rather than
 * pointing this new module at a directory this branch must not touch.
 *
 * No dependencies beyond Node's stdlib.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCRIPTS_ROOT = dirname(fileURLToPath(import.meta.url)); // .../bolao/scripts
const DEFAULT_BOLAO_ROOT = join(SCRIPTS_ROOT, ".."); // .../bolao

// Fixed order matters for a stable hash — do not reorder without accepting that every existing
// tag becomes stale (harmless, just a one-time re-tag, not a correctness issue).
const APP_FILES = ["css/styles.css", "js/config.js", "js/data.js", "js/i18n.js", "js/app.js"];

// Módulos de runtime COMPARTILHADOS pelos TRÊS apps, referenciados como "../shared/...".
//
// Achado F18 (auditoria independente, 2026-08-10): estes onze arquivos não tinham `?v=` nenhum
// enquanto os cinco locais tinham. Consequência real: a correção de FINAL-não-regride e do
// stop() em football_live_store.js (v4.183/v1.108/v3.120) NÃO chegaria a nenhum navegador que
// já tivesse o arquivo em cache — a correção estaria commitada, deployada e ausente do cliente.
//
// Entram no hash E recebem tag: uma mudança em qualquer módulo desta lista passa a mudar o tag
// dos TRÊS apps, que é a semântica correta para um módulo que os três consomem de fato.
//
// REGRA DE ADMISSÃO — vale para esta lista E para APP_SHARED_FILES logo abaixo: um módulo só
// entra aqui se TODO app governado (`APPS`) o carrega em runtime. Um módulo carregado por
// ALGUNS apps não pertence aqui — ver APP_SHARED_FILES.
const SHARED_FILES = [
  "../shared/js/money.js",
  "../shared/js/live_clock.js",
  "../shared/js/football_live_store.js",
  "../shared/css/tokens.css",
  "../shared/css/reset.css",
  "../shared/css/shell.css",
  "../shared/css/navigation.css",
  "../shared/css/components.css",
  "../shared/css/forms.css",
  "../shared/css/admin.css",
  "../shared/css/responsive.css",
];

// Módulos compartilhados consumidos por um SUBCONJUNTO dos três apps (incidente 2026-09-03).
//
// `where_to_watch.js` (#391, "Onde assistir") é carregado por br2026 e cdb2026 — nunca por
// copa2026, que está arquivado (CONFIG.archived) e não exibe nenhum card de próxima partida.
// Ele tinha entrado em SHARED_FILES acima, que o workflow `sync_version.yml` (via
// `cachebust.mjs write --app=copa2026,br2026,cdb2026`) então exigia como referência EM TODO
// app, inclusive copa2026 — que nunca o carregou. Resultado real, run 33786641021:
//
//     ✗ [copa2026] WRITE FAILED — ../shared/js/where_to_watch.js: has (no ?v= found)
//     ✓ [br2026]   cache-bust written and verified
//     ✓ [cdb2026]  cache-bust written and verified
//
// `process.exit(1)` no meio da matriz de apps aborta o step ANTES do commit de `?v=` e do
// disparo do deploy do Pages — br2026/cdb2026 ficaram com tag correta em memória, mas o
// workflow nunca commitou nem para eles, porque um `for` sequencial em `main()` (cachebust.mjs)
// só reporta `allOk`; ele não separa "app específico falhou" de "toda a corrida falhou".
//
// Correção: um módulo compartilhado por ALGUNS apps, não por todos, entra aqui — nunca de volta
// em SHARED_FILES (que exigiria adicionar `where_to_watch.js` a copa2026/index.html só para
// aplacar o checker, carregando um módulo que aquele app nunca usa — exatamente o que este
// arquivo NÃO deve fazer). Toda chave de APPS precisa aparecer aqui, mesmo que vazia — um app
// esquecido cairia silenciosamente em `[]` via `APP_SHARED_FILES[app] || []` em
// `criticalFilesForApp()`, e "esquecido" é indistinguível de "de propósito vazio" sem a chave.
const APP_SHARED_FILES = {
  copa2026: [],
  br2026: ["../shared/js/where_to_watch.js"],
  cdb2026: ["../shared/js/where_to_watch.js"],
};

// Lista de COMPATIBILIDADE, não a lista real de qualquer app específico. Continua sendo
// exportada porque `cachebust.integration.test.mjs` a usa para montar seu app-fixture sintético
// (que testa o MECANISMO de invalidação por módulo compartilhado, não a associação real de
// nenhum app) — ver a nota na própria suíte. Nenhum caminho de PRODUÇÃO (checkApp/computeAppTag)
// usa este array como a lista final de um app: cada um usa `criticalFilesForApp(app)`, que soma
// isto a APP_SHARED_FILES[app]. Um chamador que precisar do conjunto real de um app deve chamar
// `criticalFilesForApp(app)`, nunca assumir que este array é universal.
const CRITICAL_FILES = [...APP_FILES, ...SHARED_FILES];

// The three bolão apps this module governs. Powerball is deliberately excluded — see file header.
const APPS = ["copa2026", "br2026", "cdb2026"];

// A lista REAL de arquivos críticos de UM app: os 5 locais + os compartilhados por todos + os
// compartilhados só por este. Fonte única de verdade para "o que este app precisa referenciar" —
// `checkApp()` e `computeAppTag()` chamam isto; nenhum dos dois usa CRITICAL_FILES diretamente.
function criticalFilesForApp(app) {
  return [...APP_FILES, ...SHARED_FILES, ...(APP_SHARED_FILES[app] || [])];
}

function appRoot(app, bolaoRoot = DEFAULT_BOLAO_ROOT) {
  return join(bolaoRoot, app);
}

function computeTagFromFiles(root, files = CRITICAL_FILES) {
  const hash = createHash("sha256");
  for (const rel of files) hash.update(readFileSync(join(root, rel)));
  return hash.digest("hex").slice(0, 12);
}

// Tag de UM app: sempre calculada contra o conjunto REAL daquele app (criticalFilesForApp),
// nunca contra CRITICAL_FILES bruto — é exatamente essa diferença que existe desde o incidente
// 2026-09-03 (br2026/cdb2026 incluem where_to_watch.js; copa2026 não).
function computeAppTag(app, bolaoRoot = DEFAULT_BOLAO_ROOT) {
  return computeTagFromFiles(appRoot(app, bolaoRoot), criticalFilesForApp(app));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches the FULL relative path (e.g. "js/config.js"), anchored between the surrounding quote
// characters (lookbehind/lookahead, not consumed) so it only matches a real attribute value
// (href="css/styles.css" or href="css/styles.css?v=abc"), optionally followed by `?v=<hex>`.
// Matching the full path (not just the basename) avoids false positives like "config.js" matching
// inside a hypothetical "app-config.js" reference. Group 2 is the existing hex tag, or undefined
// if there was no query at all.
function tagRegex(rel) {
  return new RegExp(`(?<=["'])${escapeRe(rel)}(\\?v=([a-f0-9]+))?(?=["'])`, "g");
}

function currentTags(html, files = CRITICAL_FILES) {
  const tags = {};
  for (const rel of files) {
    const re = tagRegex(rel);
    const m = re.exec(html);
    tags[rel] = m && m[2] ? m[2] : null;
  }
  return tags;
}

// Rewrites every critical asset reference to `<rel>?v=<tag>` — works whether the input had no
// query, a stale query, or (idempotently) the already-correct query.
function rewriteTags(html, tag, files = CRITICAL_FILES) {
  let updated = html;
  for (const rel of files) {
    updated = updated.replace(tagRegex(rel), `${rel}?v=${tag}`);
  }
  return updated;
}

/**
 * Runs the check (or write) for a single app's index.html.
 * Returns { app, ok, wrote, expected, found, staleFiles }.
 */
function checkApp(app, { write = false, bolaoRoot = DEFAULT_BOLAO_ROOT } = {}) {
  const root = appRoot(app, bolaoRoot);
  const indexPath = join(root, "index.html");
  const html = readFileSync(indexPath, "utf8");
  // O conjunto de arquivos é POR APP — copa2026 nunca é obrigado a referenciar um módulo que só
  // br2026/cdb2026 carregam. Ver APP_SHARED_FILES e criticalFilesForApp() acima.
  const files = criticalFilesForApp(app);
  const expected = computeAppTag(app, bolaoRoot);
  const found = currentTags(html, files);
  const staleFiles = files.filter(f => found[f] !== expected);

  if (!staleFiles.length) {
    return { app, ok: true, wrote: false, expected, found, staleFiles: [] };
  }

  if (write) {
    const updated = rewriteTags(html, expected, files);
    writeFileSync(indexPath, updated);

    // Only announce success after: (1) writing, (2) re-reading independently from disk (not
    // reusing the in-memory `updated` string), (3) re-validating, (4) confirming every critical
    // asset of THIS app carries the expected tag. A write that "looks right" in memory but
    // didn't land must not be reported as success.
    const rewrittenHtml = readFileSync(indexPath, "utf8");
    const verifyTags = currentTags(rewrittenHtml, files);
    const stillStale = files.filter(f => verifyTags[f] !== expected);
    return { app, ok: stillStale.length === 0, wrote: true, expected, found: verifyTags, staleFiles: stillStale };
  }

  return { app, ok: false, wrote: false, expected, found, staleFiles };
}

export {
  CRITICAL_FILES, APP_FILES, SHARED_FILES, APP_SHARED_FILES, APPS, DEFAULT_BOLAO_ROOT,
  appRoot, criticalFilesForApp, computeTagFromFiles, computeAppTag,
  escapeRe, tagRegex, currentTags, rewriteTags, checkApp,
};

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const write = argv.includes("write") || argv.includes("--write");
  const appArg = argv.find(a => a.startsWith("--app="));
  const apps = appArg ? appArg.slice("--app=".length).split(",").filter(Boolean) : APPS;
  const rootArg = argv.find(a => a.startsWith("--root="));
  const bolaoRoot = rootArg ? rootArg.slice("--root=".length) : DEFAULT_BOLAO_ROOT;
  return { write, apps, bolaoRoot };
}

function main(argv = process.argv.slice(2)) {
  const { write, apps, bolaoRoot } = parseArgs(argv);
  let allOk = true;
  for (const app of apps) {
    const result = checkApp(app, { write, bolaoRoot });
    if (result.ok) {
      const verb = result.wrote ? "written and verified" : "up to date";
      console.log(`✓ [${app}] cache-bust ${verb} (${result.expected})`);
    } else {
      allOk = false;
      const verb = write ? "WRITE FAILED post-write verification" : "CACHE-BUST STALE";
      console.error(`✗ [${app}] ${verb} — expected ${result.expected}, stale: ${result.staleFiles.join(", ")}`);
      for (const f of result.staleFiles) console.error(`    ${f}: has ${result.found[f] ?? "(no ?v= found)"}`);
    }
  }
  if (!allOk && !write) {
    console.error(`Fix: node bolao/scripts/cachebust.mjs write --app=${apps.join(",")}`);
  }
  return allOk ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
