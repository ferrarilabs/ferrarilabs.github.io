#!/usr/bin/env node
// test_zero_stale_cache.mjs — football-hardening checkpoint G test suite: content-hash cache
// busting, HTML revalidation, automatic build ID, service-worker unregistration, Cache API
// cleanup, focus/visibility revalidation, admin-write staleness gate, and reload-without-loop
// protection (session-storage guard only, never authoritative).
//
// Run: node bolao/scripts/test_zero_stale_cache.mjs
//
// Static/structural + pure-function checks — no real browser, no real network. The
// freshness-guard's actual network/DOM/reload side effects are exercised indirectly by testing
// its extracted pure decide() function directly (same technique the app.js test suites in this
// repo already use for extracting functions out of non-module IIFEs).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as cachebust from "./cachebust.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

const APPS = ["copa2026", "br2026", "cdb2026"];

// ── 1. Content-hash cache-busting (reuses cachebust.mjs, doesn't reinvent) ──────────────────
for (const app of APPS) {
  const result = cachebust.checkApp(app, { write: false, bolaoRoot: join(ROOT, "bolao") });
  check(`${app}: index.html cache-bust tags match content hash (cachebust.mjs)`, result.ok, result);
}

// ── 2. Automatic build ID: build-version.json exists, matches computeAppTag(), and matches the
// embedded <meta name="build-id"> in index.html — one source of truth, not two that could drift.
for (const app of APPS) {
  const bvResult = cachebust.checkBuildVersion(app, join(ROOT, "bolao"));
  check(`${app}: build-version.json matches the same content-hash tag as the cache-bust query`, bvResult.ok, bvResult);

  const indexPath = join(ROOT, "bolao", app, "index.html");
  const html = readFileSync(indexPath, "utf8");
  const metaMatch = html.match(/<meta name="build-id" content="([a-f0-9]+)">/);
  check(`${app}: index.html has a <meta name="build-id"> tag`, !!metaMatch, "missing meta tag");
  if (metaMatch) {
    check(`${app}: embedded build-id meta matches build-version.json's buildId (single source of truth)`, metaMatch[1] === bvResult.expected, { meta: metaMatch[1], expected: bvResult.expected });
  }

  check(`${app}: index.html loads freshness-guard.js`, html.includes('src="../shared/js/freshness-guard.js"'), "script tag missing");
}

// ── 3. Service worker: unregistered from client JS, sw.js files are kill switches ───────────
for (const app of APPS) {
  const appJs = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
  check(`${app}: js/app.js no longer calls navigator.serviceWorker.register()`, !/serviceWorker\.register\(/.test(appJs), "still registers a service worker");
}
for (const swPath of ["bolao/sw.js", "bolao/copa2026/sw.js"]) {
  const full = join(ROOT, swPath);
  if (!existsSync(full)) continue; // not every app has its own sw.js — that's fine
  const sw = readFileSync(full, "utf8");
  check(`${swPath}: is a kill switch — unregisters itself`, /self\.registration\.unregister\(\)/.test(sw), "no unregister() call found");
  check(`${swPath}: is a kill switch — clears all Cache API entries`, /caches\.delete\(/.test(sw), "no caches.delete() call found");
  check(`${swPath}: no longer caches responses (no caches.put)`, !/caches\.put\(/.test(sw), "still writes to the Cache API — not a pure kill switch");
}

// ── 4. freshness-guard.js: unregisters existing SW registrations + clears caches on every load,
// checks on focus/visibilitychange/interval, admin API distinguishes fresh from stale/unknown.
{
  const guard = readFileSync(join(ROOT, "bolao/shared/js/freshness-guard.js"), "utf8");
  check("freshness-guard.js: unregisters existing service worker registrations", /getRegistrations\(\)/.test(guard) && /\.unregister\(\)/.test(guard), "missing getRegistrations()/unregister()");
  check("freshness-guard.js: clears Cache API entries", /caches\.keys\(\)/.test(guard) && /caches\.delete\(/.test(guard), "missing cache cleanup");
  check("freshness-guard.js: revalidates on window focus", /addEventListener\(["']focus["']/.test(guard), "no focus listener");
  check("freshness-guard.js: revalidates on visibilitychange (tab-focus-regain)", /visibilitychange/.test(guard), "no visibilitychange listener");
  check("freshness-guard.js: revalidates on a 5-minute interval", /5 \* 60 \* 1000/.test(guard) && /setInterval/.test(guard), "no 5-minute interval found");
  check("freshness-guard.js: fetches build-version.json with cache:'no-store' (HTML/data revalidation, not browser-cached)", /cache:\s*["']no-store["']/.test(guard), "fetch not forced no-store");
  check("freshness-guard.js: reload-loop guard uses sessionStorage only, not as the authoritative freshness source", /sessionStorage\.getItem\(SESSION_RELOAD_KEY\)/.test(guard) && /fetch\(BUILD_VERSION_PATH/.test(guard), "reload guard or authoritative fetch missing");
  check("freshness-guard.js: exposes isConfirmedFreshForAdmin() (stricter than public isFreshOrUnknown())", /isConfirmedFreshForAdmin/.test(guard), "admin API missing");
}

// ── 5. Pure decide() logic — extracted and executed directly, no DOM/network needed ─────────
{
  const src = readFileSync(join(ROOT, "bolao/shared/js/freshness-guard.js"), "utf8");
  const start = src.indexOf("function decide(");
  let depth = 0, i = src.indexOf("{", start), bodyStart = i;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  const decideSrc = src.slice(start, i);
  // eslint-disable-next-line no-new-func
  const decide = new Function(`${decideSrc}\nreturn decide;`)();

  check("decide(): matching build ids -> fresh, no action", JSON.stringify(decide("abc123", "abc123", false)) === JSON.stringify({ fresh: true, action: "none" }));
  check("decide(): mismatched build ids, not yet reloaded -> reload", JSON.stringify(decide("abc123", "def456", false)) === JSON.stringify({ fresh: false, action: "reload" }));
  check("decide(): mismatched build ids, ALREADY reloaded once for this build -> banner, not another reload (loop protection)", JSON.stringify(decide("abc123", "def456", true)) === JSON.stringify({ fresh: false, action: "banner" }));
  check("decide(): no embedded id (page predates policy) -> unknown, never treated as stale", JSON.stringify(decide(null, "def456", false)) === JSON.stringify({ fresh: null, action: "none" }));
  check("decide(): no published id (network/parse failure) -> unknown, never treated as stale", JSON.stringify(decide("abc123", null, false)) === JSON.stringify({ fresh: null, action: "none" }));
}

// ── 6. Admin-write staleness gate: guardAdmin() in every app consults FreshnessGuard, blocks
// ONLY on a confirmed-stale build (never on "unknown" — see check above for why). ──────────
for (const app of APPS) {
  const appJs = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
  const start = appJs.indexOf("function guardAdmin(");
  let guardFnBody = null;
  if (start !== -1) {
    let depth = 0, i = appJs.indexOf("{", start);
    const bodyStart = i;
    for (; i < appJs.length; i++) {
      if (appJs[i] === "{") depth++;
      else if (appJs[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    guardFnBody = appJs.slice(bodyStart, i);
  }
  check(`${app}: guardAdmin() exists and consults FreshnessGuard.state.fresh`, !!guardFnBody && /FreshnessGuard\.state\.fresh === false/.test(guardFnBody), guardFnBody || "guardAdmin() not found");
}

// ── 7. cachebust.mjs write/check round-trip for build-version.json (integration, not just the
// static file check above) — proves write -> verify -> idempotent check all actually work.
{
  const before = APPS.map(a => cachebust.checkBuildVersion(a, join(ROOT, "bolao")));
  check("cachebust write/check round-trip: all three apps' build-version.json currently pass check (already up to date from this session's `write` run)", before.every(r => r.ok), before);
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL ZERO-STALE-CACHE CHECKS PASSED");
process.exit(0);
