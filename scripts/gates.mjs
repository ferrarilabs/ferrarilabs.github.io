#!/usr/bin/env node
/**
 * Pre-commit gate runner.
 *
 * Exists because of a real mistake: `node audit_pii_repo_wide.mjs | tail -1 && git commit` allowed a
 * commit to proceed past a RED gate, because a pipe replaces the exit status with the last command's.
 * The standing rule is that gate execution and commit must never be combined such that a failed gate
 * cannot prevent the commit — so the gate now lives in a script that propagates status properly and
 * prints a single verdict line.
 *
 * Usage:
 *   node scripts/gates.mjs            # every gate
 *   node scripts/gates.mjs --quick    # tests + leakage only
 *
 * Exits non-zero if any gate fails. Never commits anything; it only reports.
 */

import { execFileSync, execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

const results = [];
const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); return ok; };

function run(name, cmd, args) {
  try {
    const out = execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return record(name, true, (out.trim().split("\n").pop() || "").slice(0, 110));
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim().split("\n").filter(Boolean);
    return record(name, false, out.slice(-3).join(" | ").slice(0, 300));
  }
}

// ── 1. every test suite
const suites = readdirSync(join(ROOT, "scripts", "db")).filter((f) => f.startsWith("test_") && f.endsWith(".mjs"))
  .map((f) => join("scripts", "db", f));
suites.push(join("scripts", "test_pii_detectors.mjs"));
let suitePass = 0, suiteFail = 0;
for (const s of suites) {
  const ok = run(`suite ${s.split("/").pop()}`, "node", [s]);
  ok ? suitePass++ : suiteFail++;
}

// ── 2. leakage gate — exit status propagated, never piped
run("leakage gate", "node", ["scripts/audit_pii_repo_wide.mjs"]);

if (!quick) {
  // ── 3. model validators + consistency
  for (const v of ["validate_target_model.mjs", "validate_access_model.mjs", "validate_migration_phases.mjs", "consistency_check.mjs"]) {
    if (existsSync(join(ROOT, "scripts", "db", v))) run(v, "node", [join("scripts", "db", v)]);
  }

  // ── 4. frozen Phase 0 / 1A artefacts must be untouched
  try {
    const dirty = execSync(
      "git status --porcelain docs/bolao/db-modernization/PHASE0_* docs/bolao/db-modernization/PHASE1_*",
      { cwd: ROOT, encoding: "utf8" }).trim();
    record("frozen Phase0/1A unchanged", dirty === "", dirty ? dirty.split("\n").join(" | ") : "0 modified");
  } catch (e) { record("frozen Phase0/1A unchanged", false, String(e.message).slice(0, 120)); }

  // ── 5. query pack digest
  const PACK = join(ROOT, "docs", "bolao", "db-modernization", "PHASE1_READONLY_QUERY_PACK.sql");
  const EXPECTED = "731028a901831f37";
  try {
    const digest = createHash("sha256").update(readFileSync(PACK)).digest("hex").slice(0, 16);
    record("query pack digest", digest === EXPECTED, `${digest}${digest === EXPECTED ? "" : ` (expected ${EXPECTED})`}`);
  } catch (e) { record("query pack digest", false, String(e.message).slice(0, 120)); }

  // ── 6. whitespace errors in the staged diff
  try {
    execSync("git diff --cached --check", { cwd: ROOT, encoding: "utf8" });
    record("git diff --cached --check", true, "clean");
  } catch (e) { record("git diff --cached --check", false, String(e.stdout || "").slice(0, 200)); }

  // ── 7. no literal NUL in any tracked text file — a NUL makes a file binary to git, so it can no
  //       longer be diffed or reviewed. This has happened twice in this programme.
  const NUL = String.fromCharCode(0);
  const offenders = [];
  for (const f of execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean)) {
    if (!/\.(mjs|js|json|md|sql|py|ya?ml|txt|html|css)$/.test(f)) continue;
    try { if (readFileSync(join(ROOT, f), "utf8").includes(NUL)) offenders.push(f); } catch { /* unreadable */ }
  }
  record("no NUL bytes in tracked text files", offenders.length === 0, offenders.join(" | ") || "0 offenders");

  // ── 8. scoring audits in the site repo — the standing rule is to run all three on every change
  const SITE = join(ROOT, "..", "ferrarilabs.github.io");
  if (existsSync(SITE)) {
    for (const app of ["copa2026", "br2026", "cdb2026"]) {
      const script = join(SITE, "bolao", app, "scripts", "audit_scoring.py");
      if (!existsSync(script)) { record(`scoring ${app}`, false, "audit_scoring.py not found"); continue; }
      try {
        const out = execFileSync("python3", [script], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        record(`scoring ${app}`, /ALL CHECKS PASSED/.test(out), (out.trim().split("\n").pop() || "").slice(0, 80));
      } catch (e) { record(`scoring ${app}`, false, `${e.stdout || ""}${e.stderr || ""}`.trim().slice(-160)); }
    }
  } else {
    record("scoring audits", false, "site repo not found next to this one — cannot verify, so this is a FAIL not a skip");
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}\n      ${r.detail}`);
console.log(`\n  suites: ${suitePass} passed, ${suiteFail} failed`);
console.log(`  gates : ${results.length - failed.length}/${results.length} passed`);
console.log(failed.length === 0 ? "\n✓ ALL GATES PASS — safe to commit\n" : `\n✗ ${failed.length} GATE(S) FAILED — do not commit\n`);
process.exit(failed.length === 0 ? 0 : 1);
