#!/usr/bin/env node
/**
 * Tests for the restore-rehearsal orchestrator and its acceptance table.
 *
 * WHY THIS EXISTS
 * The rehearsal's whole value is that its guards fire. This session has now produced three separate
 * bugs of exactly one shape — a check that reported green over a scope that had quietly shrunk:
 *
 *   1. the PII gate passed because the file under test was untracked;
 *   2. the verification runner reported 35/0 because two suites were declared unavailable;
 *   3. THIS script shipped with an INVENTED production-ref digest, so guard G3 would have accepted
 *      the production project as a rehearsal target while printing PASS.
 *
 * (3) is the most dangerous of the three, because the thing it guards is irreversible. So the guard
 * itself is tested here rather than trusted.
 *
 * Usage: node scripts/db/test_restore_rehearsal.mjs
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ACCEPTANCE_CHECKS, EXPECTED_STRUCTURE, APP_TABLES, EXPECTED_POLICY_MD5 } from "./acceptance_checks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "restore_rehearsal.mjs");

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** Run the orchestrator with a clean environment (no PG* leakage from this shell). */
function run(args) {
  const env = { ...process.env };
  for (const k of ["PGHOST", "PGUSER", "PGPASSWORD", "PGPASSFILE", "PGDATABASE", "PGPORT", "PGSSLMODE"]) delete env[k];
  const r = spawnSync("node", [RUNNER, ...args], { encoding: "utf8", env, timeout: 120000 });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

const src = readFileSync(RUNNER, "utf8");

console.log("\nRestore rehearsal — guard tests\n");

// ── the guard that must not be decorative ────────────────────────────────────
test("G3 digest is a real sha256, not a placeholder", () => {
  const m = src.match(/PRODUCTION_REF_SHA256 = "([0-9a-f]{64})"/);
  assert(m, "PRODUCTION_REF_SHA256 is missing or not a 64-hex digest");
  assert(!/^0+$|^1cf7ca2f/.test(m[1]),
    "PRODUCTION_REF_SHA256 looks like the invented placeholder — G3 cannot fire and would accept " +
    "production as a rehearsal target while reporting PASS");
});

test("G3 REFUSES a target whose ref matches production", () => {
  // Derive the real ref from the operator's local profile, hash it, and confirm the runner rejects it.
  // The ref is never printed by this test.
  const prof = join(process.env.HOME, "Documents/GitHub/ferrarilabs-work/.phase1-conn.env");
  if (!existsSync(prof)) { console.log("      (skipped: no local connection profile to derive a ref from)"); return; }
  const ref = (readFileSync(prof, "utf8").match(/postgres\.([a-z0-9]{20})/) || [])[1];
  assert(ref, "could not derive a production ref from the local profile");
  const digest = createHash("sha256").update(ref).digest("hex");
  const declared = src.match(/PRODUCTION_REF_SHA256 = "([0-9a-f]{64})"/)[1];
  assert(digest === declared,
    "the declared digest does not match the real production ref — G3 would not fire on production");
  const r = run(["--execute", `--target-dsn=postgresql://postgres.${ref}:x@h:5432/postgres`]);
  assert(r.status === 1, `expected exit 1 (refusal), got ${r.status}`);
  assert(/TARGET IS THE PRODUCTION PROJECT/.test(r.out), "G3 did not report the production refusal");
});

test("G3 ACCEPTS a disposable target with a different ref", () => {
  const r = run(["--execute", "--target-dsn=postgresql://postgres.abcdefghijklmnopqrst:x@h:5432/postgres"]);
  assert(/✓ G3/.test(r.out), "G3 rejected a legitimate disposable target");
});

test("G3 refuses rather than guesses when no ref can be extracted", () => {
  const r = run(["--execute", "--target-dsn=postgresql://user:x@localhost:5432/db"]);
  assert(/✗ G3/.test(r.out) && /could not extract a project ref/.test(r.out),
    "an unparseable DSN was allowed through — the guard must fail closed");
});

test("--execute without a target fails closed", () => {
  const r = run(["--execute"]);
  assert(r.status === 1, `expected exit 1, got ${r.status}`);
  assert(/--execute requires --target-dsn/.test(r.out), "missing-target refusal not reported");
});

// ── dry-run is the default and writes nothing ────────────────────────────────
test("default mode is DRY RUN", () => {
  const r = run([]);
  assert(/DRY RUN/.test(r.out), "default mode is not dry-run — the dangerous mode must be opt-in");
  assert(/nothing was written anywhere/.test(r.out), "dry-run does not state that nothing was written");
});

test("dry-run passes preflight on the current backup", () => {
  const r = run([]);
  assert(r.status === 0, `dry-run preflight failed (exit ${r.status})`);
  for (const g of ["G1", "G2", "G5", "G6", "G8", "G9", "G10"]) {
    assert(new RegExp(`✓ ${g}\\b`).test(r.out), `${g} did not pass in dry-run`);
  }
});

test("G4 catches a leaked production connection profile", () => {
  const r = spawnSync("node", [RUNNER, "--execute",
    "--target-dsn=postgresql://postgres.abcdefghijklmnopqrst:x@h:5432/postgres"],
    { encoding: "utf8", env: { ...process.env, PGHOST: "example.invalid" }, timeout: 120000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  assert(/✗ G4/.test(out), "a stray PGHOST was not caught — psql could be silently redirected");
});

// ── evidence discipline ──────────────────────────────────────────────────────
test("evidence manifest contains no DSN, key path or project ref", () => {
  const out = "/tmp/_rehearsal_test_evidence.json";
  run([`--json-out=${out}`]);
  const txt = readFileSync(out, "utf8");
  for (const forbidden of ["postgres://", "postgresql://", "pooler", ".key", "PGPASSWORD"]) {
    assert(!txt.includes(forbidden), `evidence leaked "${forbidden}"`);
  }
  const ev = JSON.parse(txt);
  assert(ev.verdict, "evidence has no verdict");
  assert(ev.executionBlocker, "evidence does not record the execution blocker");
});

// ── acceptance table integrity ───────────────────────────────────────────────
test("A1–A11 are all present and uniquely identified", () => {
  const ids = ACCEPTANCE_CHECKS.map((c) => c.id);
  assert(ids.length === 11, `expected 11 acceptance checks, got ${ids.length}`);
  assert(new Set(ids).size === 11, "duplicate acceptance-check ids");
  for (let i = 1; i <= 11; i++) assert(ids.includes(`A${i}`), `A${i} is missing`);
});

/**
 * Strip SQL string literals before scanning for DML keywords.
 *
 * WHY: a first draft of this check flagged A10 as mutating because its SQL contains
 * `privilege_type='TRUNCATE'` — the NAME of a privilege being compared, not a TRUNCATE statement.
 * That is the third time in this session that a bare keyword scan produced a false positive on a
 * word appearing in a benign context (the others: `/derive/i` matching `DERIVED_PHASES`, and a
 * reserved-domain substring matching a real domain). Keyword scanning over code needs the syntactic
 * context removed first; excepting the offending check would have hidden the flaw instead.
 */
const stripSqlLiterals = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

test("every acceptance check is read-only", () => {
  const writing = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\s+\w|ALTER\s+\w|TRUNCATE\s+\w|GRANT\s+\w|REVOKE\s+\w)/i;
  const offenders = ACCEPTANCE_CHECKS
    .filter((c) => c.sql && writing.test(stripSqlLiterals(c.sql)))
    .map((c) => c.id);
  assert(offenders.length === 0, `acceptance checks must not mutate: ${offenders.join(", ")}`);
});

test("the read-only detector distinguishes a statement from a quoted keyword", () => {
  const writing = /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\s+\w|ALTER\s+\w|TRUNCATE\s+\w|GRANT\s+\w|REVOKE\s+\w)/i;
  // benign: privilege names compared as string literals (this is A10's real shape)
  for (const benign of [
    "SELECT count(*) FROM x WHERE privilege_type='TRUNCATE'",
    "SELECT 1 WHERE p IN ('INSERT','UPDATE','DELETE')",
    "SELECT 'DROP TABLE t' AS example",
  ]) {
    assert(!writing.test(stripSqlLiterals(benign)), `false positive on: ${benign}`);
  }
  // adversarial: real statements must still be caught
  for (const bad of [
    "TRUNCATE TABLE public.bolao_state",
    "DELETE FROM public.lottery_pools",
    "GRANT SELECT ON t TO anon",
    "ALTER TABLE t DISABLE ROW LEVEL SECURITY",
    "UPDATE t SET x=1",
    "INSERT INTO t VALUES (1)",
    "DROP INDEX i",
  ]) {
    assert(writing.test(stripSqlLiterals(bad)), `false negative on: ${bad}`);
  }
});

test("A2 compares against the manifest, never a hard-coded count", () => {
  const a2 = ACCEPTANCE_CHECKS.find((c) => c.id === "A2");
  assert(a2.expect.length >= 3, "A2's expect() does not accept the manifest row counts argument");
  // A2's SQL must cover every app table, so adding a table cannot silently escape the check.
  for (const t of APP_TABLES) assert(a2.sql.includes(t), `A2 does not count ${t}`);
});

test("A8 verifies policies by hash and never selects an expression", () => {
  const a8 = ACCEPTANCE_CHECKS.find((c) => c.id === "A8");
  assert(/md5\(/.test(a8.sql), "A8 does not hash");
  assert(!/\bselect\s+qual\b|\bselect\s+with_check\b/i.test(a8.sql),
    "A8 selects a raw policy expression — DR-1's no-print rule forbids it");
  assert(Object.values(EXPECTED_POLICY_MD5).every((h) => /^[0-9a-f]{32}$/.test(h)),
    "a recorded policy md5 is malformed");
});

test("A11 asserts synthetic identity isolation", () => {
  const a11 = ACCEPTANCE_CHECKS.find((c) => c.id === "A11");
  assert(/auth\.users/.test(a11.sql), "A11 does not inspect auth.users");
  assert(/email/.test(a11.sql), "A11 does not assert the absence of emails");
});

test("structural expectations match the Phase 1 evidence set", () => {
  const e = EXPECTED_STRUCTURE;
  assert(e.tables === 7 && e.primaryKeys === 7, "table/PK expectation drifted from Phase 1 (7/7)");
  assert(e.foreignKeys === 17, "FK expectation drifted from Phase 1 (17)");
  assert(e.policies === 6, "policy expectation drifted from Phase 1 (6)");
  assert(e.userTriggers === 0, "user-trigger expectation drifted — production has 0 (finding R-04)");
  assert(e.uniqueConstraints === 0 && e.uniqueIndexesNotConstraints === 1,
    "the unique thing is an INDEX not a CONSTRAINT — this distinction matters for FK targets");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ RESTORE REHEARSAL GUARD TESTS PASSED\n" : "✗ RESTORE REHEARSAL GUARD TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
