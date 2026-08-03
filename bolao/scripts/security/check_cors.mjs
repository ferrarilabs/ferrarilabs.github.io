#!/usr/bin/env node
/**
 * check_cors.mjs — CORS misconfiguration pattern scan for the bolão platform.
 *
 * Node built-in modules only. Run locally:
 *   node bolao/scripts/security/check_cors.mjs
 *
 * Context: this repo has no Edge Function/API of its own today (confirmed by this same 2026-08-02
 * review — see docs/bolao/security/CORS_AND_ORIGIN_POLICY.md), so there is no first-party CORS
 * configuration to audit. This script exists as a forward-looking gate: if a future commit adds
 * server-side code that sets CORS headers, this script flags the unsafe patterns the task asked
 * to watch for, so they get caught in review instead of relying on someone remembering to look.
 *
 * What it flags as CONFIRMED CRITICAL:
 *   - `Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true` in
 *     the same file (the one combination browsers themselves reject, and a common
 *     copy-paste mistake).
 *   - Origin validation done with `.endsWith(` or `.includes(` against a hardcoded domain suffix
 *     (e.g. `origin.endsWith(".ferrarilabs.com")`) — insecure, allows an attacker-registered
 *     domain like `evilferrarilabs.com` or `ferrarilabs.com.evil.tld` to pass. The task's
 *     instruction is explicit: allowlist exact origins, never suffix/substring matching.
 *   - A literal wildcard `Access-Control-Allow-Origin: *` in server-side code (not a browser
 *     preflight response you don't control, like Supabase's — only code THIS repo authors).
 *
 * Exit code: non-zero only on a CONFIRMED CRITICAL match above. Today this should always report
 * zero findings, because no such code exists yet — that's a pass, not a skipped check.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const SKIP_DIRS = new Set([".git", "node_modules"]);
const EXTS = new Set([".js", ".mjs", ".py", ".ts", ".json", ".yml", ".yaml"]);

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function main() {
  // Exclude this script's own directory — its doc comment above necessarily contains the exact
  // strings it searches for as examples.
  const selfDir = path.dirname(new URL(import.meta.url).pathname);
  const files = walk(ROOT).filter((f) => path.dirname(f) !== selfDir);

  const findings = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, "utf8");

    const hasWildcardOrigin = /Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]?\*/i.test(text);
    const hasCredentialsTrue = /Access-Control-Allow-Credentials['"]?\s*[:=]\s*['"]?true/i.test(text);
    if (hasWildcardOrigin && hasCredentialsTrue) {
      findings.push({ file: rel, issue: "Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true in the same file" });
    }

    const suffixMatchRe = /origin[a-zA-Z]*\s*\.\s*(endsWith|includes)\s*\(/gi;
    for (const m of text.matchAll(suffixMatchRe)) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({ file: rel, line, issue: `insecure origin match via .${m[1]}(...) — use an exact allowlist instead (see docs/bolao/security/CORS_AND_ORIGIN_POLICY.md)` });
    }
  }

  console.log(JSON.stringify({ tool: "check_cors.mjs", findings }, null, 2));

  if (findings.length > 0) {
    console.error(`\nCONFIRMED CRITICAL: ${findings.length} insecure CORS pattern(s) found.`);
    process.exit(1);
  }
  console.error("\nNo insecure CORS pattern found in first-party code. Expected today: this repo has no Edge Function/API of its own (see docs/bolao/security/CORS_AND_ORIGIN_POLICY.md) — this check exists for when one is added.");
  process.exit(0);
}

main();
