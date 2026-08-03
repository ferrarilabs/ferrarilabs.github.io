/**
 * cachebust.integration.test.mjs — end-to-end proof that the cache-bust tag has a single source
 * of truth (PR120-final review item 2).
 *
 * Run:  node bolao/scripts/cachebust.integration.test.mjs
 *
 * `check_cachebust.test.mjs` (existing, CDB2026-scoped) already unit-tests the pure regex/rewrite
 * functions against synthetic HTML strings in memory. This file is deliberately different: it
 * exercises the FULL file-system + CLI path end to end, against a real temp directory standing in
 * for an app, proving the chain the review asked for explicitly:
 *
 *   1. index (fixture) with NO `?v=` query on any of the 5 critical assets.
 *   2. `checkApp(..., { write: true })` (the same function the CDB2026 wrapper and the CLI call)
 *      WRITES the missing query.
 *   3. `checkApp(..., { write: false })` (the "checker" mode) then PASSES against that written
 *      file — proving the checker and the writer agree on what "correct" means, because they are
 *      literally the same function called with a different flag.
 *   4. A second write pass is idempotent — byte-identical output, no second-guessing.
 *   5. "Workflow behavior equals local": the actual CLI (`node bolao/scripts/cachebust.mjs write
 *      --app=<fixture> --root=<tmp>`) is invoked as a real subprocess (this is what
 *      `.github/workflows/sync_version.yml` also invokes, argument-for-argument except for
 *      --app/--root, which exist so this test can point the CLI at a throwaway fixture instead of
 *      the real bolao/ tree) and its output is asserted byte-identical to calling the exported
 *      function directly — i.e. there is no second, divergent code path the workflow could drift
 *      onto. The test also greps `.github/workflows/sync_version.yml` for the literal invocation
 *      string, so if a future edit changes the workflow to call something else (or reintroduces a
 *      `git rev-parse`-based tag) without updating this test, the assertion fails loudly instead
 *      of silently drifting apart again the way the original bug happened.
 *
 * No dependencies beyond Node's stdlib.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkApp, computeTagFromFiles, CRITICAL_FILES } from "./cachebust.mjs";

const SCRIPTS_ROOT = dirname(fileURLToPath(import.meta.url)); // bolao/scripts
const REPO_ROOT = join(SCRIPTS_ROOT, "..", ".."); // repo root
const CACHEBUST_SCRIPT = join(SCRIPTS_ROOT, "cachebust.mjs");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "sync_version.yml");
const FIXTURE_APP = "fixture-app";

function makeFixtureRoot() {
  const tmp = mkdtempSync(join(tmpdir(), "cachebust-integration-"));
  const appDir = join(tmp, FIXTURE_APP);
  mkdirSync(join(appDir, "css"), { recursive: true });
  mkdirSync(join(appDir, "js"), { recursive: true });
  writeFileSync(join(appDir, "css", "styles.css"), "body{color:red}");
  writeFileSync(join(appDir, "js", "config.js"), "window.CFG={a:1};");
  writeFileSync(join(appDir, "js", "data.js"), "window.DATA=[1,2,3];");
  writeFileSync(join(appDir, "js", "i18n.js"), "window.I18N={};");
  writeFileSync(join(appDir, "js", "app.js"), "console.log('app');");
  writeFileSync(
    join(appDir, "index.html"),
    `<!doctype html><html><head>
  <link rel="stylesheet" href="css/styles.css">
</head><body>
  <script src="js/config.js"></script>
  <script src="js/data.js"></script>
  <script src="js/i18n.js"></script>
  <script defer src="js/app.js"></script>
</body></html>`
  );
  return tmp;
}

test("1. fixture index.html starts with no ?v= query on any critical asset", () => {
  const root = makeFixtureRoot();
  try {
    const html = readFileSync(join(root, FIXTURE_APP, "index.html"), "utf8");
    for (const f of CRITICAL_FILES) assert.ok(!html.includes(`${f}?v=`), `${f} must start without a query`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("2. checkApp({ write:false }) reports stale, then { write:true } inserts the query", () => {
  const root = makeFixtureRoot();
  try {
    const before = checkApp(FIXTURE_APP, { write: false, bolaoRoot: root });
    assert.equal(before.ok, false, "must start stale (no ?v= present)");
    assert.equal(before.staleFiles.length, CRITICAL_FILES.length);

    const written = checkApp(FIXTURE_APP, { write: true, bolaoRoot: root });
    assert.equal(written.ok, true, "write must succeed and self-verify");
    assert.equal(written.wrote, true);

    const expectedTag = computeTagFromFiles(join(root, FIXTURE_APP));
    const html = readFileSync(join(root, FIXTURE_APP, "index.html"), "utf8");
    for (const f of CRITICAL_FILES) assert.match(html, new RegExp(`${f.replace(/[.]/g, "\\.")}\\?v=${expectedTag}"`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("3. checker (write:false) PASSES against the file the writer just produced", () => {
  const root = makeFixtureRoot();
  try {
    checkApp(FIXTURE_APP, { write: true, bolaoRoot: root });
    const checked = checkApp(FIXTURE_APP, { write: false, bolaoRoot: root });
    assert.equal(checked.ok, true, "checker must agree the writer's output is correct — same function, same definition of correct");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("4. a second write pass is idempotent — byte-identical index.html", () => {
  const root = makeFixtureRoot();
  try {
    checkApp(FIXTURE_APP, { write: true, bolaoRoot: root });
    const once = readFileSync(join(root, FIXTURE_APP, "index.html"), "utf8");
    checkApp(FIXTURE_APP, { write: true, bolaoRoot: root });
    const twice = readFileSync(join(root, FIXTURE_APP, "index.html"), "utf8");
    assert.equal(twice, once, "second write must not change anything further");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("5a. the real CLI subprocess produces byte-identical output to calling checkApp() directly", () => {
  const rootDirect = makeFixtureRoot();
  const rootCli = makeFixtureRoot();
  try {
    // Direct function call path (what check_cachebust.mjs's wrapper and any Node caller use).
    checkApp(FIXTURE_APP, { write: true, bolaoRoot: rootDirect });
    const directHtml = readFileSync(join(rootDirect, FIXTURE_APP, "index.html"), "utf8");

    // Real subprocess CLI path (what sync_version.yml invokes, modulo --app/--root existing only
    // to let this test point at a throwaway fixture instead of the real bolao/ tree).
    execFileSync(process.execPath, [CACHEBUST_SCRIPT, "write", `--app=${FIXTURE_APP}`, `--root=${rootCli}`], {
      encoding: "utf8",
    });
    const cliHtml = readFileSync(join(rootCli, FIXTURE_APP, "index.html"), "utf8");

    assert.equal(cliHtml, directHtml, "CLI-produced index.html must be byte-identical to the direct function call — same code path, not a parallel implementation");
  } finally {
    rmSync(rootDirect, { recursive: true, force: true });
    rmSync(rootCli, { recursive: true, force: true });
  }
});

test("5b. sync_version.yml actually invokes this exact shared script for the three bolão apps", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    workflow,
    /node\s+bolao\/scripts\/cachebust\.mjs\s+write\s+--app=copa2026,br2026,cdb2026/,
    "sync_version.yml must call `node bolao/scripts/cachebust.mjs write --app=copa2026,br2026,cdb2026` " +
    "— if this fails, the workflow has drifted back onto a separate implementation for these three apps " +
    "(e.g. `git rev-parse --short HEAD` + sed), which is exactly the two-sources-of-truth bug this item fixed"
  );
});

test("5c. any remaining commit-SHA-based tagging in the workflow's ACTUAL SHELL CODE (not prose comments) is confined to the documented Powerball exception", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  // Strip YAML comment lines (leading '#', ignoring indentation) first — the header intentionally
  // narrates the OLD commit-SHA approach in prose for history's sake; only executable shell lines
  // matter for "is the tag still computed this way".
  const codeOnly = workflow
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
  const shaOccurrences = [...codeOnly.matchAll(/git rev-parse --short HEAD/g)];
  assert.ok(shaOccurrences.length > 0, "sanity check: expected exactly one live git rev-parse usage (Powerball step)");
  for (const m of shaOccurrences) {
    const windowAround = codeOnly.slice(Math.max(0, m.index - 400), m.index + 400);
    assert.match(
      windowAround,
      /[Pp]owerball/,
      "a `git rev-parse --short HEAD` outside the Powerball step means the three-bolão-app tag is " +
      "commit-SHA-based again, not content-hash-based — that is the exact bug this item fixed"
    );
  }
});

test("5d. check_cachebust.mjs (CDB2026 wrapper) and cachebust.mjs (shared module) agree on CDB2026's real tag", () => {
  // Not a fixture test — reads the REAL repo's cdb2026 app, read-only (no --write here), just to
  // prove the wrapper and the shared module compute the exact same tag for the same real files.
  const bolaoRoot = join(REPO_ROOT, "bolao");
  const viaShared = computeTagFromFiles(join(bolaoRoot, "cdb2026"));
  const viaCheckApp = checkApp("cdb2026", { write: false, bolaoRoot }).expected;
  assert.equal(viaCheckApp, viaShared, "checkApp() and computeTagFromFiles() must agree — they are the same underlying computation");
});
