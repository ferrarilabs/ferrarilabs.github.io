#!/usr/bin/env node
// audit_pii_repo_wide.mjs — Repo-wide PII / secret regression guard (P0 hotfix, 2026-08).
//
// Scans every git-TRACKED file (via `git ls-files`, so gitignored/untracked
// paths are excluded automatically — no need to hand-maintain a directory
// skip-list) for:
//   1. email addresses not on the allowlist
//   2. an email/emailAddress/recipient field assigned a literal string value
//      (as opposed to a variable/env-var reference)
//   3. txId / confirmationId / external_reference fields with a literal value
//   4. known real transaction-ID shapes (Zelle 11-digit refs, Cash App "#D-...",
//      Venmo ~17-19 char alphanumeric refs) — pattern-based, not a fixed list,
//      so it also catches IDs this repo hasn't seen redacted yet
//   5. URLs with an embedded password or token
//   6. the literal string "service_role"
//   7. private key material (PEM headers)
//
// Never prints the actual matched value — only file path, detector name, and
// a short masked preview (first char + last char + length), per the P0
// mandate: "não imprimir os valores encontrados".
//
// Usage: node scripts/audit_pii_repo_wide.mjs

import { execSync } from "node:child_process";
/**
 * KNOWN LIMITATIONS — read before trusting a clean run.
 *
 * This gate is a line-oriented pattern scanner over TRACKED files. It is a useful last line of
 * defence, not proof of absence. Specifically it does NOT detect:
 *
 *   1. PII inside binary or opaque files — images, PDFs, .zip/.bundle archives. Screenshots of an
 *      admin or ranking screen can render participant names and are invisible here.
 *   2. Values split across lines, or assembled at runtime by concatenation / template literals.
 *   3. Encoded or encrypted payloads (base64 blobs, compressed JSON).
 *   4. PII in git HISTORY. Only the current tree is scanned; a value committed and later removed
 *      stays in history and is not reported.
 *   5. UNTRACKED files. Local backups and scratch artefacts are out of scope by design.
 *   6. Real names that are not on the private participant list, and payment references not on the
 *      private payment list. Those lists live OUTSIDE this repo and are supplied by the operator;
 *      when they are absent, those two categories silently cannot fire.
 *   7. Semantic PII — a free-text field describing a person without an email or a listed name.
 *
 * FAILURE MODE TO WATCH: adding a real domain to ALLOWED_EMAIL_SUFFIXES converts this gate from
 * noisy to silent. That already happened once with `@email.com`, which suppressed 11 addresses.
 * Only RFC-2606 / RFC-6761 reserved names belong on that list. `scripts/test_audit_pii_repo_wide.mjs`
 * locks this invariant.
 */

import fs from "node:fs";
import { createHash } from "node:crypto";

const ALLOWED_EMAILS = new Set([
  "emferrari@gmail.com", // site owner — deliberate public institutional contact
]);
// RFC-2606 / RFC-6761 reserved names ONLY. These cannot receive mail, so an address
// using one is synthetic by definition. Anything else is treated as a real address.
//
// `@email.com` was REMOVED from this list: email.com is a LIVE webmail domain, so
// allowlisting it silently suppressed real addresses (a false NEGATIVE — strictly worse
// than the noise it saved). `.test` was ADDED: RFC 6761 reserves it exactly as `.invalid`,
// and the bolao/shared/scripts/ suite uses @example.test / @x.test throughout — their
// absence made this detector 100% false-positive and trained reviewers to ignore it.
export const ALLOWED_EMAIL_SUFFIXES = [
  ".invalid", ".test", ".example", ".localhost",
  "@example.com", "@example.org", "@example.net",
];

// Files that are themselves detector source (their pattern strings would self-match)
// or genuinely-synthetic fixtures already verified by hand.
const SELF_EXCLUDE = new Set([
  "scripts/audit_pii_repo_wide.mjs",
  "bolao/loterias/powerball/scripts/audit_pii_tests.mjs",
]);

// Never reveal any character of a matched value. The previous implementation exposed the
// first and last character plus the length, which for a short address or a transaction ID
// is a meaningful partial disclosure — and this output lands in CI logs. A short digest is
// enough to correlate two findings or confirm a fix, without disclosing anything.
export function mask(value) {
  if (!value) return "(empty)";
  const digest = createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
  return `<redacted sha256:${digest} len:${String(value).length}>`;
}

export function isAllowedEmail(addr) {
  if (ALLOWED_EMAILS.has(addr)) return true;
  return ALLOWED_EMAIL_SUFFIXES.some((suf) => addr.toLowerCase().endsWith(suf));
}

function trackedFiles() {
  const out = execSync("git ls-files", { cwd: process.cwd(), encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// field: "literal value" or field: 'literal value' — excludes obvious variable/template refs
// Requires the field name to open a line (optionally indented) or follow a
// typical object-literal delimiter ({ , [ ( or start of a line), so prose
// like "test email: ..." in a comment doesn't false-positive.
const LITERAL_FIELD_RE = (fieldNames) =>
  new RegExp(`(?:^|[{,(\\[]\\s*|["']\\s*,\\s*)(${fieldNames})\\s*[:=]\\s*["']([^"'\`$\\{\\n][^"'\\n]*)["']`, "gim");

const FIELD_DETECTORS = [
  { name: "email-field-literal", re: LITERAL_FIELD_RE("email|emailAddress|recipient") },
  { name: "txId-field-literal", re: LITERAL_FIELD_RE("txId|transactionId") },
  { name: "confirmationId-field-literal", re: LITERAL_FIELD_RE("confirmationId") },
  { name: "external-reference-field-literal", re: LITERAL_FIELD_RE("external_reference|externalReference") },
];

const PATTERN_DETECTORS = [
  { name: "zelle-like-tx-id", re: /\b\d{11}\b/g },
  { name: "cashapp-tx-id", re: /#D-[A-Z0-9]{6,}/g },
  { name: "venmo-tx-id", re: /\b[0-9]{1}[A-Z]{2}\d{5,}[A-Z]{2}\d{5,}[A-Z]\b/g },
  { name: "url-with-embedded-credential", re: /(?:https?|postgres(?:ql)?):\/\/[^:\s\/]+:[^@\s\/]+@[^\s"'<>]+/gi },
  // Only flags service_role when paired with an actual JWT-shaped value nearby
  // (starts "eyJ") — the bare word "service_role" appears throughout docs as a
  // policy term ("never use the service_role key"), which is not a leak.
  { name: "service-role-key-value", re: /service_role[^\n]{0,60}eyJ[A-Za-z0-9_-]{10,}/g },
  { name: "private-key-material", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
];

// Placeholder tokens that are always safe even if they match a pattern detector
// (they show up in doc examples / masked reports, not real data).
const SAFE_LITERALS = new Set([
  "example.invalid", "example.com", "john@example.com", "recipient@email.com",
]);

function main() {
  const files = trackedFiles().filter((f) => !SELF_EXCLUDE.has(f));
  const findings = []; // { file, detector, count, sample }

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable
    }
    if (content.includes("\u0000")) continue; // binary heuristic

    // 1. plain email addresses
    const emails = content.match(EMAIL_RE) || [];
    for (const addr of emails) {
      if (!isAllowedEmail(addr)) {
        findings.push({ file, detector: "email-address", sample: mask(addr) });
      }
    }

    // 2-4. literal-valued sensitive fields
    for (const { name, re } of FIELD_DETECTORS) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(content))) {
        const value = m[2];
        if (!value || SAFE_LITERALS.has(value) || isAllowedEmail(value)) continue;
        if (value === "—" || value === "-" || value.trim() === "") continue;
        if (value.includes("*")) continue; // already-masked placeholder (e.g. audit docs)
        findings.push({ file, detector: name, sample: mask(value) });
      }
    }

    // 5-9. pattern-based secret/tx-id shapes
    const TX_ID_CONTEXT_RE = /zelle|cash\s?app|venmo|txid|transa[çc][ãa]o|transaction/i;
    for (const { name, re } of PATTERN_DETECTORS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content))) {
        const v = m[0];
        // Repeating-digit numbers (e.g. "33333333333") are obviously synthetic
        // placeholders, not real transaction IDs.
        if (/^(\d)\1+$/.test(v)) continue;
        if (name === "zelle-like-tx-id" || name === "cashapp-tx-id" || name === "venmo-tx-id") {
          // Real payment refs only ever appear near payment-context keywords
          // (e.g. "Zelle", "txId") — bare 11-digit numbers alone are too broad
          // a pattern (GH Actions run IDs, phone numbers, etc. also match).
          const windowStart = Math.max(0, m.index - 80);
          const windowEnd = Math.min(content.length, m.index + v.length + 80);
          const window = content.slice(windowStart, windowEnd);
          if (!TX_ID_CONTEXT_RE.test(window)) continue;
        }
        findings.push({ file, detector: name, sample: mask(v) });
      }
    }
  }

  if (findings.length > 0) {
    console.error("❌ REPO-WIDE PII/SECRET AUDIT FAILED\n");
    const byFileDetector = new Map();
    for (const f of findings) {
      const key = `${f.file} :: ${f.detector}`;
      if (!byFileDetector.has(key)) byFileDetector.set(key, { file: f.file, detector: f.detector, count: 0, sample: f.sample });
      byFileDetector.get(key).count++;
    }
    for (const { file, detector, count, sample } of byFileDetector.values()) {
      console.error(`  - ${file} | ${detector} | count=${count} | sample=${sample}`);
    }
    console.error(`\n${findings.length} finding(s) across ${byFileDetector.size} (file, detector) pair(s).`);
    process.exit(1);
  }

  console.log(`✓ Repo-wide PII/secret audit passed — scanned ${files.length} tracked files, 0 findings.`);
}

// Only scan when run directly. Importing this module (e.g. from its test) must not execute.
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
