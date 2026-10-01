#!/usr/bin/env node
/**
 * smoke-public-artifact.mjs — serves the built _site over HTTP (NOT file://) and drives every
 * production entry page in Chromium. Fails on: same-origin 4xx/5xx for anything that is not a
 * deliberately-removed path, uncaught page errors, or any private path that answers 200.
 *   node scripts/smoke-public-artifact.mjs [--dir _site]
 * Network to third parties is blocked (the check is about the repository boundary, not CDNs).
 */
import http from "node:http";
import { existsSync, statSync, createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const dir = resolve(process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : "_site");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".csv": "text/csv", ".xml": "application/xml" };
const PAGES = ["/", "/index.pt.html", "/index.es.html", "/index.jp.html", "/insights.html", "/financial-crimes/", "/small-business/",
  "/bolao/", "/bolao/br2026/", "/bolao/cdb2026/", "/bolao/copa2026/", "/bolao/copa2026/audit-report.html", "/bolao/copa2026/audit-detail-picks.html",
  "/bolao/copa2026/audit-detail-governance.html", "/bolao/copa2026/classificacao-geral.html", "/bolao/audit-report.html", "/bolao/audit-detail-picks.html",
  "/bolao/audit-detail-governance.html", "/bolao/classificacao-geral.html", "/bolao/loterias/powerball/", "/bolao-teste/"];
const MUST_BE_404 = ["/docs/", "/docs/bolao/SECURITY.md", "/scripts/verify.mjs", "/supabase/config.toml", "/workers/live-producer/src/index.ts", "/CLAUDE.md", "/CHATGPT.md",
  "/package.json", "/.git/config", "/.github/workflows/deploy-pages.yml", "/memory/", "/model/", "/bolao/scripts/gate_registry.json", "/bolao/shared/sql/010_notification_durability.sql",
  "/bolao/loterias/powerball/scripts/email/outbox.json", "/bolao/loterias/powerball/email-previews/draw-result-desktop.html", "/bolao/loterias/config/lottery_ledger.jsonl",
  "/bolao/copa2026/scripts/audit_scoring.py", "/bolao/br2026/CHANGELOG.md"];
const MUST_BE_200 = ["/CNAME", "/deployment-meta.json", "/sitemap.xml", "/bolao/sw.js", "/bolao/copa2026/sw.js", "/bolao/loterias/powerball/sw.js"];

const server = http.createServer((q, s) => {
  let f = join(dir, decodeURIComponent(q.url.split("?")[0]));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!f.startsWith(dir) || !existsSync(f)) { s.writeHead(404); return s.end("not found"); }
  s.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const problems = [];
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
try {
  for (const u of PAGES) {
    const pg = await browser.newPage();
    pg.on("response", (r) => { const x = new URL(r.url()); if (x.origin === base && r.status() >= 400 && !x.pathname.endsWith("/favicon.ico")) problems.push(`${u} -> ${x.pathname} HTTP ${r.status()}`); });
    pg.on("pageerror", (e) => problems.push(`${u} pageerror: ${e.message.slice(0, 120)}`));
    await pg.route((url) => url.origin !== base, (r) => r.abort());
    await pg.goto(base + u, { waitUntil: "load" }).catch((e) => problems.push(`${u} goto failed: ${e.message.slice(0, 80)}`));
    await pg.waitForTimeout(1200);
    for (const bt of (await pg.$$("nav button, [data-view], [data-tab]")).slice(0, 25)) { await bt.click({ timeout: 400 }).catch(() => {}); await pg.waitForTimeout(100); }
    await pg.close();
  }
} finally { await browser.close(); }
for (const p of MUST_BE_404) { const r = await fetch(base + p); if (r.status !== 404) problems.push(`PRIVATE PATH SERVED: ${p} -> ${r.status}`); }
for (const p of MUST_BE_200) { const r = await fetch(base + p); if (r.status !== 200) problems.push(`REQUIRED PATH MISSING: ${p} -> ${r.status}`); }
server.close();
if (problems.length) { console.error(`❌ smoke FAILED (${problems.length})\n  ` + problems.join("\n  ")); process.exit(1); }
console.log(`✓ smoke passed — ${PAGES.length} pages, ${MUST_BE_404.length} private paths 404, ${MUST_BE_200.length} required paths 200, no console/network errors`);
