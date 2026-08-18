#!/usr/bin/env node
// audit_commit_message_pii.mjs — commit-message PII regression guard.
//
// Why this exists: the HIST-091/HIST-093 git-history investigation (2026-08-18) found real
// participant emails and a real participant name typed directly into commit-message BODIES — a
// surface `audit_pii_repo_wide.mjs` never covers, because it only scans file/blob content. Root
// cause: the original 2026-08-06 PII fix deliberately scanned blob content only, to avoid false
// positives from git author/committer metadata — a reasonable call on its own terms that left
// commit-message text (recipient lists, "fix: wrong email was X, now Y" notes, incident
// narratives) completely unscanned. See docs/bolao/adr/ADR-011-forward-only-pii-prevention.md and
// docs/bolao/SECURITY.md ("Commit-message PII prevention").
//
// Scope: forward-only, by design. This gate scans only commits NEW since the same base every
// other safety-contract gate uses (`resolveBase()` in scripts/safety/surfaces.mjs — SAFETY_BASE_SHA
// in CI, merge-base/HEAD~1 fallback locally). It never walks full repository history — that is a
// separate, explicitly-authorized, not-yet-decided remediation (HIST-091/HIST-093), not something
// a normal PR should pay the cost of on every run.
//
// Reuses the SAME detection engine as the file/blob scanner (scripts/pii_detectors.mjs) — same
// detectors, same reserved-domain/synthetic-prefix allowlists, same masked output. No duplicated
// detection logic, and no new allowlist surface to maintain separately.
//
// Usage: node scripts/audit_commit_message_pii.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolveBase } from "./safety/surfaces.mjs";
import { scanContent } from "./pii_detectors.mjs";

function newCommitShas(baseSha, headRef, cwd) {
  const out = execFileSync("git", ["log", `${baseSha}..${headRef}`, "--format=%H"], { cwd, encoding: "utf8" }).trim();
  return out ? out.split("\n") : [];
}

function commitMessage(sha, cwd) {
  return execFileSync("git", ["log", "-1", "--format=%B", sha], { cwd, encoding: "utf8" });
}

/**
 * Testable core: scan every commit message in (baseSha, headRef] for PII. Takes an explicit base
 * and cwd (rather than calling resolveBase() itself) so it can run against an isolated fixture
 * repo in tests — resolveBase() is hardcoded to this repo's own real root and cannot be pointed at
 * a temp repo, which is why this function exists separately from main().
 */
export function scanCommitRange(baseSha, { headRef = "HEAD", cwd = process.cwd() } = {}) {
  const commits = newCommitShas(baseSha, headRef, cwd);
  const findings = [];
  for (const sha of commits) {
    const msg = commitMessage(sha, cwd);
    // Path is a synthetic tag, not a real file path — this guarantees DECLARED_EXPOSURES (which is
    // keyed to real file paths for legitimate, per-path exposures) can never accidentally match a
    // commit message. A commit message has no legitimate reason to carry a real participant value.
    const { findings: f } = scanContent(msg, { path: `<commit-message:${sha.slice(0, 10)}>` });
    findings.push(...f);
  }
  return { commits, findings };
}

function main() {
  const { sha: baseSha, how } = resolveBase();
  if (!baseSha) {
    console.log(`✓ Commit-message PII audit skipped — no comparison base resolvable (${how ?? "no base"}); nothing new to scan.`);
    process.exit(0);
  }

  const { commits, findings } = scanCommitRange(baseSha);

  if (commits.length === 0) {
    console.log(`✓ Commit-message PII audit passed — 0 new commit(s) since base (${how}). Historical commits are not rescanned by this gate.`);
    process.exit(0);
  }

  if (findings.length === 0) {
    console.log(`✓ Commit-message PII audit passed — scanned ${commits.length} new commit message(s) since ${how}, 0 findings.`);
    process.exit(0);
  }

  console.error("❌ COMMIT-MESSAGE PII AUDIT FAILED\n");
  for (const f of findings) {
    console.error(`  - ${f.file} | ${f.detector} | sample=${f.sample}`);
  }
  console.error(
    `\n${findings.length} finding(s) across ${commits.length} new commit message(s) since ${how}. ` +
    "A commit message must never contain a real participant email, payment reference, or name — " +
    "use a synthetic value (SYNTH-/FIXTURE-/... prefix, or a reserved .invalid/.test/.example " +
    "domain) if the message needs to illustrate a shape. See docs/bolao/SECURITY.md."
  );
  process.exit(1);
}

// So varre quando executado diretamente — importar este modulo (do teste, por exemplo) nao pode
// executar o scan. Mesmo invariante de scripts/audit_pii_repo_wide.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
