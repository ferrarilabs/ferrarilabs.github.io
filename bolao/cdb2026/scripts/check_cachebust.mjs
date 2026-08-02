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
 *
 * Fase 2.2-correção fix (2026-08): the original `currentTags()`/`--write` regexes only matched
 * when a `?v=` query was ALREADY present (`app\.js\?v=([a-f0-9]+)`) — they could replace an old
 * tag but could not insert a missing one. Found in production: all three apps' `index.html`
 * (Copa, BR2026, CDB2026) currently reference the five critical assets with NO `?v=` at all, and
 * both this script and `sync_version.yml`'s `sed` silently no-op on that shape (sed's pattern is
 * sed's original pattern only matched `?v=[^"' >]` followed by a literal `?v=` that already
 * exists in the file). This file now
 * exports/uses `tagRegex()`, which matches the bare filename with an OPTIONAL `?v=<hex>` suffix,
 * anchored on the following quote so it only matches the real attribute value — so it handles
 * both `styles.css` (no query) and `styles.css?v=abc` (stale query) as input, and always
 * produces `styles.css?v=<current-hash>` as output.
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

function computeTagFromFiles(root, files) {
  const hash = createHash("sha256");
  for (const rel of files) hash.update(readFileSync(join(root, rel)));
  return hash.digest("hex").slice(0, 12);
}

function computeTag() {
  return computeTagFromFiles(ROOT, CRITICAL_FILES);
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
    const updated = rewriteTags(html, expected);
    writeFileSync(INDEX_HTML, updated);

    // --write may only announce success after: (1) writing the file, (2) re-reading it back
    // from disk independently (not reusing the in-memory `updated` string), (3) re-running the
    // same validation this script uses in check mode, and (4) confirming all five critical
    // assets carry the expected tag. This is deliberately paranoid: a write that "looks right"
    // in memory but didn't actually land (disk full, permission error swallowed elsewhere,
    // regex edge case) must not be reported as success.
    const rewrittenHtml = readFileSync(INDEX_HTML, "utf8");
    const verifyTags = currentTags(rewrittenHtml);
    const stillStale = CRITICAL_FILES.filter(f => verifyTags[f] !== expected);
    if (stillStale.length) {
      console.error(`✗ --write FAILED post-write verification — after writing and re-reading index.html from disk, these assets still don't carry tag ${expected}: ${stillStale.join(", ")}`);
      for (const f of stillStale) console.error(`  ${f}: has ${verifyTags[f] ?? "(no ?v= found)"}`);
      return 1;
    }

    console.log(`✓ cache-bust written and verified: ${expected} in index.html (was stale/missing for: ${staleFiles.join(", ")})`);
    return 0;
  }

  console.error(`✗ CACHE-BUST STALE — index.html would serve old cached files for: ${staleFiles.join(", ")}`);
  console.error(`  expected tag (hash of current file contents): ${expected}`);
  for (const f of staleFiles) console.error(`  ${f}: index.html has ${found[f] ?? "(no ?v= found)"}`);
  console.error(`  Fix: node bolao/cdb2026/scripts/check_cachebust.mjs --write`);
  return 1;
}

// Exported for the test suite (check_cachebust.test.mjs) — pure functions, no I/O, so they can
// be unit-tested against synthetic HTML fixtures without touching the real index.html.
export { tagRegex, currentTags, rewriteTags, computeTagFromFiles };

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
