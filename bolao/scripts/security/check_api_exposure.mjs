#!/usr/bin/env node
/**
 * check_api_exposure.mjs — endpoint inventory + CDN/SRI check for the bolão platform.
 *
 * Node built-in modules only. Run locally:
 *   node bolao/scripts/security/check_api_exposure.mjs
 *
 * What it does:
 *   1. Inventories every https:// URL referenced in bolao/**\/js/config.js and bolao/**\/*.py —
 *      a quick cross-check against docs/bolao/security/API_INVENTORY.md (this script does not
 *      diff against that doc automatically; it just prints what it finds so a human can compare).
 *   2. Verifies every <script src="https://..."> tag in bolao/**\/index.html carries an
 *      `integrity=` (SRI) attribute — CDN scripts without SRI are a supply-chain risk (RM-030
 *      in docs/bolao/security/SECURITY_RISK_MATRIX.md).
 *   3. Checks that a service_role key never appears in a front-end-served file
 *      (bolao/**\/js/**, bolao/**\/*.html) — narrower and stricter than
 *      check_public_secrets.mjs's general scan, specific to the "never in browser code" rule.
 *
 * Exit code: non-zero only if (2) or (3) fails — a missing SRI on a CDN script, or a
 * service_role-shaped value in a browser-served file, are both CONFIRMED CRITICAL. The endpoint
 * inventory itself (1) never fails the build — it's informational.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const BOLAO = path.join(ROOT, "bolao");

function walk(dir, filterExt, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filterExt, files);
    else if (filterExt.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function main() {
  let failed = false;
  const urlPattern = /https?:\/\/[a-zA-Z0-9.\-]+(?:\/[^\s"'`)>]*)?/g;

  // 1. Endpoint inventory (config.js + Python scripts)
  const configFiles = walk(BOLAO, new Set([".js"])).filter((f) => f.endsWith("config.js"));
  const pyFiles = walk(BOLAO, new Set([".py"]));
  const endpoints = new Set();
  for (const f of [...configFiles, ...pyFiles]) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(urlPattern)) {
      try {
        const u = new URL(m[0].replace(/[)"'`,;]+$/, ""));
        endpoints.add(u.origin);
      } catch {
        // ignore malformed matches
      }
    }
  }
  console.log("=== Endpoint inventory (config.js + scripts/*.py) ===");
  for (const origin of [...endpoints].sort()) console.log(" -", origin);
  console.log(`(${endpoints.size} distinct origins — compare against docs/bolao/security/API_INVENTORY.md by hand)`);

  // 2. SRI check on CDN <script> tags in each app's index.html
  console.log("\n=== SRI check (CDN <script> tags) ===");
  const htmlFiles = walk(BOLAO, new Set([".html"])).filter((f) => f.endsWith("index.html"));
  for (const f of htmlFiles) {
    const rel = path.relative(ROOT, f);
    const text = fs.readFileSync(f, "utf8");
    const scriptTagRe = /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/g;
    for (const m of text.matchAll(scriptTagRe)) {
      const tag = m[0];
      const src = m[1];
      const hasIntegrity = /\bintegrity=/.test(tag);
      if (!hasIntegrity) {
        console.error(`CONFIRMED CRITICAL: ${rel} loads ${src} without integrity= (SRI) attribute`);
        failed = true;
      } else {
        console.log(` OK: ${rel} -> ${src} (SRI present)`);
      }
    }
  }

  // 3. service_role must never appear in a browser-served file
  console.log("\n=== service_role-in-frontend check ===");
  const frontendFiles = [
    ...walk(BOLAO, new Set([".js"])),
    ...walk(BOLAO, new Set([".html"])),
  ];
  let serviceRoleHit = false;
  for (const f of frontendFiles) {
    const text = fs.readFileSync(f, "utf8");
    if (/\bsb_secret_[A-Za-z0-9_-]{10,}/.test(text)) {
      console.error(`CONFIRMED CRITICAL: possible service_role-shaped key in frontend file ${path.relative(ROOT, f)}`);
      serviceRoleHit = true;
      failed = true;
    }
  }
  if (!serviceRoleHit) console.log(" OK: no service_role-shaped value found in any bolao/**/*.js or bolao/**/*.html");

  process.exit(failed ? 1 : 0);
}

main();
