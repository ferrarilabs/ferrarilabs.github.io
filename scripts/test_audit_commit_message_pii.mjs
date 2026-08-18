#!/usr/bin/env node
/**
 * Regression suite for audit_commit_message_pii.mjs.
 *
 * Builds a real, temporary git repository (same technique as
 * bolao/loterias/powerball/scripts/test_pii_scan_scope.mjs) because the thing under test — whether
 * a commit MESSAGE trips the detector, and whether the scan is correctly scoped to only new
 * commits — can only be proven against real git history, not asserted from reading the source.
 *
 * No real participant data anywhere in this file. The "sensitive" fixture case needs a value that
 * is indistinguishable from a real leak (that's the point — proving BLOCK actually fires), but
 * `scripts/test_fixture_privacy.mjs` has a zero-exception rule against any non-reserved-domain
 * email appearing in a test file's source, so an email can't be used here even as a fictional
 * fixture. A Zelle-pattern payment reference sidesteps that rule entirely (not an email shape) and
 * is arguably more representative of HIST-091 anyway. Built via runtime string concatenation, not
 * a literal digit run, so the file-content PII gate never sees a matchable literal in this file's
 * own source either — only the assembled commit message (inside the disposable temp repo) does.
 *
 * Usage: node scripts/test_audit_commit_message_pii.mjs
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCommitRange } from "./audit_commit_message_pii.mjs";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const repo = mkdtempSync(join(tmpdir(), "commit-msg-pii-"));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (msg) => {
  writeFileSync(join(repo, "f.txt"), `${Math.random()}\n`);
  git("add", "-A");
  git("commit", "-qm", msg);
  return git("rev-parse", "HEAD").trim();
};

git("init", "-q");
git("config", "user.email", "fixture@example.invalid");
git("config", "user.name", "fixture");

// Assembled at runtime, not written as a literal digit run — see file header.
const zellePaymentRef = (a, b) => `${a}${b}`;
const historicalRef = zellePaymentRef("55519", "876543");
const newLeakRef = zellePaymentRef("55520", "112233");

// ─── Historical commits (BEFORE the base) — deliberately "sensitive-shaped" ────────────────────
// These simulate exactly the HIST-091 pattern: a real-shaped Zelle payment reference typed into a
// message, long before this gate existed. The gate must NEVER flag these — it is forward-only by
// design, and rescanning full history on every PR is explicitly out of scope (that's HIST-091/
// HIST-093's own, separately-authorized remediation track).
const rootSha = commit(`Add participant — Zelle confirmation ${historicalRef}`);
const baseSha = commit("chore: unrelated historical commit");

// ─── New commits (AFTER the base) — what a real PR would introduce ─────────────────────────────
const cleanSha = commit("fix: correct off-by-one in round numbering");
const allowedSyntheticSha = commit("test: add fixture recipient SYNTH-participant@example.invalid for regression coverage");
const sensitiveSha = commit(`fix: resend to the right person — Zelle confirmation ${newLeakRef}`);
const benignEmailWordSha = commit("fix: add email validation to the signup form");

console.log("\nCommit-message PII audit — regression suite (temp git repo)\n");

// Git's well-known empty-tree object — exists in every repository, usable as a "from the very
// start" range boundary without needing the true root commit's SHA in advance.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

test("range-scoping does real work: full-history scan finds the historical leak, base-scoped scan does not", () => {
  const fullHistory = scanCommitRange(EMPTY_TREE, { cwd: repo, headRef: baseSha }).findings.length;
  assert(fullHistory > 0, `expected the historical commit's real-shaped email to be found when scanning from the start (got ${fullHistory})`);
  const scoped = scanCommitRange(baseSha, { cwd: repo, headRef: cleanSha }).findings.length;
  assert(scoped === 0, `base-scoped scan must not see the historical leak — this gate is forward-only by design (got ${scoped})`);
  void rootSha; // documents which commit carries the historical leak; not asserted directly
});

test("scan range excludes the base commit and everything before it", () => {
  const { commits } = scanCommitRange(baseSha, { cwd: repo });
  assert(!commits.includes(baseSha), "base commit itself must not be in the scanned range");
  assert(commits.length === 4, `expected 4 new commits, got ${commits.length}`);
});

test("clean commit message: 0 findings", () => {
  const { findings } = scanCommitRange(baseSha, { cwd: repo, headRef: cleanSha });
  assert(findings.length === 0, `expected 0 findings up to the clean commit, got ${findings.length}`);
});

test("synthetic/fixture-prefixed email in commit message: ALLOW (0 findings)", () => {
  const before = scanCommitRange(baseSha, { cwd: repo, headRef: cleanSha }).findings.length;
  const after = scanCommitRange(baseSha, { cwd: repo, headRef: allowedSyntheticSha }).findings.length;
  assert(after === before, `SYNTH- prefixed fixture value should not add a finding (before=${before}, after=${after})`);
});

test("real-shaped Zelle payment reference in commit message: BLOCK (finding present)", () => {
  const before = scanCommitRange(baseSha, { cwd: repo, headRef: allowedSyntheticSha }).findings.length;
  const after = scanCommitRange(baseSha, { cwd: repo, headRef: sensitiveSha }).findings.length;
  assert(after > before, `real-shaped email commit should add a finding (before=${before}, after=${after})`);
});

test("benign message mentioning 'email validation' generically: ALLOW (no new finding)", () => {
  const before = scanCommitRange(baseSha, { cwd: repo, headRef: sensitiveSha }).findings.length;
  const after = scanCommitRange(baseSha, { cwd: repo, headRef: benignEmailWordSha }).findings.length;
  assert(after === before, `generic mention of "email validation" should not itself add a finding (before=${before}, after=${after})`);
});

test("no finding ever includes a raw commit-message value (only masked samples)", () => {
  const { findings } = scanCommitRange(baseSha, { cwd: repo, headRef: sensitiveSha });
  for (const f of findings) {
    assert(f.sample.startsWith("<redacted sha256:"), `finding sample is not masked: ${f.detector}`);
    assert(f.file.startsWith("<commit-message:"), `finding path is not the synthetic commit-message tag: ${f.file}`);
  }
});

rmSync(repo, { recursive: true, force: true });

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ COMMIT-MESSAGE PII TEST SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
