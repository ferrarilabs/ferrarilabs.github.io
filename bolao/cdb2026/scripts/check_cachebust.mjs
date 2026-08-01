/**
 * check_cachebust.mjs — CDB2026 cache-bust staleness guard (Fase 2.1 §5).
 *
 * Run:  node bolao/cdb2026/scripts/check_cachebust.mjs
 *
 * Why this exists: `bolao/cdb2026/index.html`'s `<script src="js/app.js?v=XXXX">` query params
 * exist so a browser/CDN cache that already has an old `app.js` under that exact URL is forced
 * to refetch when the content changes (a URL with a query string it has never seen is always a
 * cache miss). If the tag is bumped by hand (a commit hash, a version string) it is trivially
 * possible to edit a critical file and forget to bump the tag — the deploy looks fine, the file
 * changed on the server, but every browser/CDN edge that already cached the old URL keeps
 * serving the OLD file forever (or until its own cache TTL expires), because the URL never
 * changed. Found on this branch on 2026-08: `?v=58d393d` predates every Fase 1/2/2.1 change to
 * app.js/config.js/data.js/i18n.js/styles.css.
 *
 * Fix used here: the cache-bust tag is not chosen by hand at all — it is the first 12 hex chars
 * of a SHA-256 hash of the five critical files' concatenated bytes (styles.css, config.js,
 * data.js, i18n.js, app.js, in that fixed order). Editing ANY of those files necessarily changes
 * the hash, so "content changed but tag didn't move" cannot happen once this check is green — it
 * is mathematically tied, not a convention someone has to remember. This single check therefore
 * covers both failure modes named in the Fase 2.1 spec ("CONFIG.siteVersion mudar" and "arquivos
 * críticos mudarem", "mas o cache-bust permanecer antigo") — a siteVersion bump lives inside
 * config.js, which is one of the five hashed files, so it is covered by construction.
 *
 * No dependencies beyond Node's stdlib. Exit code 0 = tag matches content, 1 = stale (must be
 * regenerated with --write before any deploy).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = join(ROOT, "index.html");

// Fixed order matters for a stable hash — do not reorder without also accepting every existing
// tag becomes stale (that's fine, it's just a one-time re-tag, not a correctness issue).
const CRITICAL_FILES = ["css/styles.css", "js/config.js", "js/data.js", "js/i18n.js", "js/app.js"];

function computeTag() {
  const hash = createHash("sha256");
  for (const rel of CRITICAL_FILES) hash.update(readFileSync(join(ROOT, rel)));
  return hash.digest("hex").slice(0, 12);
}

function currentTags(html) {
  const tags = {};
  for (const rel of CRITICAL_FILES) {
    const base = rel.split("/").pop();
    const m = html.match(new RegExp(`${base.replace(".", "\\.")}\\?v=([a-f0-9]+)`));
    tags[rel] = m ? m[1] : null;
  }
  return tags;
}

function main() {
  const write = process.argv.includes("--write");
  const html = readFileSync(INDEX_HTML, "utf8");
  const expected = computeTag();
  const found = currentTags(html);
  const staleFiles = CRITICAL_FILES.filter(f => found[f] !== expected);

  if (!staleFiles.length) {
    console.log(`✓ cache-bust up to date (${expected}) — matches content of all ${CRITICAL_FILES.length} critical files`);
    return 0;
  }

  if (write) {
    let updated = html;
    for (const rel of CRITICAL_FILES) {
      const base = rel.split("/").pop();
      updated = updated.replace(new RegExp(`(${base.replace(".", "\\.")}\\?v=)[a-f0-9]+`), `$1${expected}`);
    }
    writeFileSync(INDEX_HTML, updated);
    console.log(`✓ cache-bust rewritten to ${expected} in index.html (was stale for: ${staleFiles.join(", ")})`);
    return 0;
  }

  console.error(`✗ CACHE-BUST STALE — index.html would serve old cached files for: ${staleFiles.join(", ")}`);
  console.error(`  expected tag (hash of current file contents): ${expected}`);
  for (const f of staleFiles) console.error(`  ${f}: index.html has ${found[f] ?? "(no ?v= found)"}`);
  console.error(`  Fix: node bolao/cdb2026/scripts/check_cachebust.mjs --write`);
  return 1;
}

process.exit(main());
