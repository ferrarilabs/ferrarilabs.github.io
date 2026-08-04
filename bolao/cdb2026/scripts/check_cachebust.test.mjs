/**
 * check_cachebust.test.mjs — unit tests for check_cachebust.mjs's tag-rewrite logic.
 *
 * Run:  node bolao/cdb2026/scripts/check_cachebust.test.mjs
 *
 * Covers the Fase 2.2-correção requirement: the tag regex/rewrite must handle both an ABSENT
 * query (`css/styles.css"`) and a STALE query (`css/styles.css?v=old123"`), turning both into
 * `css/styles.css?v=<tag>"` — plus multiple assets in one file and idempotent re-runs.
 *
 * No test framework dependency — uses Node's built-in `node:test` + `node:assert` (available
 * since Node 18, matches this repo's "no build step, no npm dependency" convention).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { tagRegex, currentTags, rewriteTags } from "./check_cachebust.mjs";

const FILES = ["css/styles.css", "js/config.js", "js/data.js", "js/i18n.js", "js/app.js"];
const TAG = "abc123def456";

function htmlWith(assets) {
  // assets: map of rel path -> query suffix ("" | "?v=old" | "?v=" + TAG)
  return `<!doctype html><html><head>
  <link rel="stylesheet" href="css/styles.css${assets["css/styles.css"] ?? ""}">
</head><body>
  <script src="js/config.js${assets["js/config.js"] ?? ""}"></script>
  <script src="js/data.js${assets["js/data.js"] ?? ""}"></script>
  <script src="js/i18n.js${assets["js/i18n.js"] ?? ""}"></script>
  <script defer src="js/app.js${assets["js/app.js"] ?? ""}"></script>
</body></html>`;
}

test("missing query on all five assets: currentTags reports null for each", () => {
  const html = htmlWith({});
  const tags = currentTags(html, FILES);
  for (const f of FILES) assert.equal(tags[f], null, `${f} should have no tag`);
});

test("missing query: rewriteTags inserts ?v=<tag> on every asset", () => {
  const html = htmlWith({});
  const updated = rewriteTags(html, TAG, FILES);
  const tags = currentTags(updated, FILES);
  for (const f of FILES) assert.equal(tags[f], TAG, `${f} should now carry the tag`);
  // sanity: the actual href/src strings look right, not just what currentTags re-parses
  assert.match(updated, /href="css\/styles\.css\?v=abc123def456"/);
  assert.match(updated, /src="js\/app\.js\?v=abc123def456"/);
});

test("stale query (old tag) on all five assets: currentTags reports the old value", () => {
  const stale = {};
  for (const f of FILES) stale[f] = "?v=58d393d0aaaa";
  const html = htmlWith(stale);
  const tags = currentTags(html, FILES);
  for (const f of FILES) assert.equal(tags[f], "58d393d0aaaa");
});

test("stale query: rewriteTags replaces the old tag with the new one, no leftover old tag", () => {
  const stale = {};
  for (const f of FILES) stale[f] = "?v=58d393d0aaaa";
  const html = htmlWith(stale);
  const updated = rewriteTags(html, TAG, FILES);
  assert.ok(!updated.includes("58d393d0aaaa"), "old tag must not survive rewrite");
  const tags = currentTags(updated, FILES);
  for (const f of FILES) assert.equal(tags[f], TAG);
});

test("already-correct query: currentTags matches, rewriteTags is a no-op (idempotent)", () => {
  const correct = {};
  for (const f of FILES) correct[f] = `?v=${TAG}`;
  const html = htmlWith(correct);
  const tags = currentTags(html, FILES);
  for (const f of FILES) assert.equal(tags[f], TAG);
  const rewritten = rewriteTags(html, TAG, FILES);
  assert.equal(rewritten, html, "rewriting an already-correct file must change nothing");
});

test("mixed: some assets missing query, some stale, some already correct — rewrite fixes all", () => {
  const mixed = {
    "css/styles.css": "",                 // missing
    "js/config.js": "?v=aaaa11112222",         // stale
    "js/data.js": `?v=${TAG}`,            // already correct
    "js/i18n.js": "",                     // missing
    "js/app.js": "?v=bbbb33334444",            // stale
  };
  const html = htmlWith(mixed);
  const before = currentTags(html, FILES);
  assert.equal(before["css/styles.css"], null);
  assert.equal(before["js/config.js"], "aaaa11112222");
  assert.equal(before["js/data.js"], TAG);

  const updated = rewriteTags(html, TAG, FILES);
  const after = currentTags(updated, FILES);
  for (const f of FILES) assert.equal(after[f], TAG, `${f} must be ${TAG} after rewrite`);
});

test("running rewriteTags twice in a row (idempotent execution) yields the same final string", () => {
  const html = htmlWith({}); // start with no queries at all, worst case
  const once = rewriteTags(html, TAG, FILES);
  const twice = rewriteTags(once, TAG, FILES);
  assert.equal(twice, once, "a second --write pass must not change anything further");
});

test("tagRegex matches the full relative path only, not a substring inside another asset's path", () => {
  // "js/config.js" must not accidentally match inside a hypothetical "js/app-config.js" reference
  const html = `<script src="js/app-config.js"></script><script src="js/config.js?v=abc123"></script>`;
  const re = tagRegex("js/config.js");
  const matches = [...html.matchAll(re)];
  assert.equal(matches.length, 1, "must match only the standalone js/config.js reference");
  assert.equal(matches[0][2], "abc123");
});
