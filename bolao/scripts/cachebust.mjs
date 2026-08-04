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
const CRITICAL_FILES = ["css/styles.css", "js/config.js", "js/data.js", "js/i18n.js", "js/app.js"];

// The three bolão apps this module governs. Powerball is deliberately excluded — see file header.
const APPS = ["copa2026", "br2026", "cdb2026"];

function appRoot(app, bolaoRoot = DEFAULT_BOLAO_ROOT) {
  return join(bolaoRoot, app);
}

function computeTagFromFiles(root, files = CRITICAL_FILES) {
  const hash = createHash("sha256");
  for (const rel of files) hash.update(readFileSync(join(root, rel)));
  return hash.digest("hex").slice(0, 12);
}

function computeAppTag(app, bolaoRoot = DEFAULT_BOLAO_ROOT) {
  return computeTagFromFiles(appRoot(app, bolaoRoot));
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
  const expected = computeAppTag(app, bolaoRoot);
  const found = currentTags(html, CRITICAL_FILES);
  const staleFiles = CRITICAL_FILES.filter(f => found[f] !== expected);

  if (!staleFiles.length) {
    return { app, ok: true, wrote: false, expected, found, staleFiles: [] };
  }

  if (write) {
    const updated = rewriteTags(html, expected, CRITICAL_FILES);
    writeFileSync(indexPath, updated);

    // Only announce success after: (1) writing, (2) re-reading independently from disk (not
    // reusing the in-memory `updated` string), (3) re-validating, (4) confirming all five assets
    // carry the expected tag. A write that "looks right" in memory but didn't land must not be
    // reported as success.
    const rewrittenHtml = readFileSync(indexPath, "utf8");
    const verifyTags = currentTags(rewrittenHtml, CRITICAL_FILES);
    const stillStale = CRITICAL_FILES.filter(f => verifyTags[f] !== expected);
    return { app, ok: stillStale.length === 0, wrote: true, expected, found: verifyTags, staleFiles: stillStale };
  }

  return { app, ok: false, wrote: false, expected, found, staleFiles };
}

export {
  CRITICAL_FILES, APPS, DEFAULT_BOLAO_ROOT,
  appRoot, computeTagFromFiles, computeAppTag,
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
