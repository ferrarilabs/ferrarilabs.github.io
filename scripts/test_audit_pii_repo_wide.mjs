#!/usr/bin/env node
/**
 * Tests for the repo-wide PII/secret gate (`scripts/audit_pii_repo_wide.mjs`).
 *
 * WHY THIS EXISTS
 * The gate was 100% false-positive: it reported 82 findings across 13 (file, detector) pairs, and
 * every single one was a `@example.test` / `@x.test` address in `bolao/shared/scripts/`. A gate that
 * always cries wolf stops being read, which is worse than no gate — reviewers learn to skip it, and a
 * real finding then goes unnoticed.
 *
 * It also had the opposite defect, which was worse: `@email.com` was on the allowlist, and email.com
 * is a LIVE webmail domain. Eleven real-domain addresses were therefore suppressed. Noise is
 * annoying; silence is dangerous.
 *
 * This test locks BOTH directions — precision (no false positives on RFC-reserved/synthetic
 * addresses) and recall (real domains, credentials, JWTs and transaction IDs are still caught).
 * It imports the real module, so the fixtures cannot drift from the shipped allowlist.
 *
 * Usage: node scripts/test_audit_pii_repo_wide.mjs
 */

import { execFileSync } from "node:child_process";
import { isAllowedEmail, mask, ALLOWED_EMAIL_SUFFIXES } from "./audit_pii_repo_wide.mjs";

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/** SYNTHETIC — must NOT be flagged. RFC 2606 / RFC 6761 reserved names. */
const SYNTHETIC = [
  "alice@example.test",          // the exact class that made the gate 100% false-positive
  "bob@x.test",
  "carol@sub.domain.test",
  "dave@foo.invalid",
  "erin@example.com",
  "frank@example.org",
  "grace@example.net",
  "heidi@host.localhost",
  "ivan@my.example",
];

/** REAL DOMAINS — must be flagged. `@email.com` is the false negative this test locks. */
const REAL = [
  "naoexiste1@gmail.com",
  "someone@email.com",           // LIVE webmail domain — was wrongly allowlisted
  "naoexiste1@outlook.com",
  "someone@protonmail.com",
  "someone@ferrarilabs.com",
  "someone@testcompany.com",     // contains "test" but is NOT a reserved TLD
  "someone@invalid-domain.com",  // contains "invalid" but is NOT the reserved TLD
  "someone@example.com.br",      // example.com is reserved; example.com.br is NOT
];

console.log("\nPII/secret gate — precision and recall\n");

test("precision: no RFC-reserved/synthetic address is flagged", () => {
  const fp = SYNTHETIC.filter((a) => !isAllowedEmail(a));
  assert(fp.length === 0, `${fp.length} synthetic address(es) wrongly flagged (masked): ` +
    fp.map(mask).join(", "));
});

test("recall: every real-domain address is flagged", () => {
  const fn = REAL.filter((a) => isAllowedEmail(a));
  assert(fn.length === 0, `${fn.length} real address(es) wrongly allowed (masked): ` +
    fn.map(mask).join(", "));
});

test("adversarial: reserved-looking substrings do not grant a pass", () => {
  // Each of these embeds a reserved name but is a real, deliverable domain.
  for (const a of ["x@example.com.br", "x@testcompany.com", "x@invalid-domain.com", "x@nottest.io"]) {
    assert(!isAllowedEmail(a), `wrongly allowed (masked): ${mask(a)}`);
  }
});

test("regression: @email.com is NOT on the allowlist", () => {
  assert(!ALLOWED_EMAIL_SUFFIXES.includes("@email.com"),
    "@email.com is back on the allowlist — it is a live webmail domain and suppresses real addresses");
  assert(!isAllowedEmail("someone@email.com"), "@email.com is being allowed again");
});

test("regression: .test IS on the allowlist", () => {
  assert(ALLOWED_EMAIL_SUFFIXES.includes(".test"),
    ".test was removed — the gate returns to 100% false-positive on bolao/shared/scripts/");
  assert(isAllowedEmail("a@example.test"), ".test addresses are being flagged again");
});

test("the owner's institutional address stays allowed (deliberate, documented)", () => {
  assert(isAllowedEmail("emferrari@gmail.com"),
    "the site owner's public contact address must stay allowlisted by exact match, not by domain");
  assert(!isAllowedEmail("naoexiste2@gmail.com"),
    "the exact-match allowlist leaked into a whole-domain allowance");
});

test("mask() never reveals any character of the value", () => {
  const secret = "naoexiste9@gmail.com";
  const masked = mask(secret);
  assert(!masked.includes("naoexiste9"), "mask leaked the local part");
  assert(!masked.includes("gmail"), "mask leaked the domain");
  assert(!masked.includes(secret[0]) || /^<redacted/.test(masked),
    "mask leaked the first character");
  assert(!masked.includes(secret[secret.length - 1]) || /^<redacted/.test(masked),
    "mask leaked the last character");
  assert(/sha256:[0-9a-f]{8}/.test(masked), "mask lost its correlation digest");
  assert(mask(secret) === mask(secret), "mask is not deterministic — findings cannot be correlated");
  assert(mask("a@b.com") !== mask("c@d.com"), "mask collapses distinct values");
});

test("the whole gate passes on the current tree (deterministic exit 0)", () => {
  // Runs the real scan. If this fails, either a genuine finding was introduced or the allowlist
  // regressed — both must be triaged, never suppressed.
  try {
    execFileSync("node", ["scripts/audit_pii_repo_wide.mjs"], { stdio: "pipe" });
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`;
    throw new Error(`gate failed; masked findings follow:\n${out.split("\n").slice(-12).join("\n")}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ PII GATE TESTS PASSED\n" : "✗ PII GATE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
