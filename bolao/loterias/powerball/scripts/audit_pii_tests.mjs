// audit_pii_tests.mjs — P0.1 PII regression guard (2026-08 hotfix)
//
// Fails (exit 1) if any file that gets published to GitHub Pages (i.e. not
// gitignored, not a log/backup dir) contains:
//   1. an "email:" or "txId:" field inside bolao/loterias/powerball/js/data.js
//   2. any email address that is not on the small allowlist (the site owner's
//      own public contact address, or a synthetic *@example.invalid / *@example.com
//      fixture address)
//   3. any of the known real transaction IDs that were previously public in data.js
//
// This does not scan git history — see the P0.1 summary for the HISTORY_EXPOSURE
// note (history scrub is out of scope for this hotfix, tracked separately).

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

const ALLOWED_EMAILS = new Set([
  "emferrari@gmail.com", // site owner — already the public admin contact everywhere
  "recipient@email.com", // generic doc placeholder (AUDIT_LOGGING.md query examples)
]);

const ALLOWED_EMAIL_SUFFIXES = [
  "@example.invalid",
  "@example.com",
];

// txIds that were confirmed present in data.js before the P0.1 strip — if any of
// these show up again in a scanned file, something re-introduced real PII.
const KNOWN_REAL_TX_IDS = [
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
  "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE", "REDACTED_PAYMENT_REFERENCE",
];

const IGNORE_DIRS = new Set(["node_modules", "logs", ".git"]);
const IGNORE_FILES = new Set([
  "private-participant-data.local.json", // gitignored, local-only sidecar — allowed to hold real PII
  "audit_pii_tests.mjs", // this file — its own allowlist source (KNOWN_REAL_TX_IDS) would self-flag
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (!IGNORE_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function isAllowedEmail(addr) {
  if (ALLOWED_EMAILS.has(addr)) return true;
  return ALLOWED_EMAIL_SUFFIXES.some((suf) => addr.endsWith(suf));
}

function main() {
  const files = walk(ROOT);
  const failures = [];

  const dataJsPath = path.join(ROOT, "js", "data.js");
  if (fs.existsSync(dataJsPath)) {
    const dataJs = fs.readFileSync(dataJsPath, "utf8");
    if (/\bemail\s*:/.test(dataJs)) {
      failures.push("js/data.js contains an 'email:' field — this file is public and must never carry participant emails.");
    }
    if (/\btxId\s*:/.test(dataJs)) {
      failures.push("js/data.js contains a 'txId:' field — this file is public and must never carry transaction IDs.");
    }
  } else {
    failures.push("js/data.js not found — cannot verify PII was removed.");
  }

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable — skip
    }
    const rel = path.relative(ROOT, file);

    const emails = content.match(EMAIL_RE) || [];
    for (const addr of emails) {
      if (!isAllowedEmail(addr)) {
        failures.push(`${rel}: contains non-allowlisted email address (masked: ${addr[0]}***@${addr.split("@")[1] || "?"})`);
      }
    }

    for (const txId of KNOWN_REAL_TX_IDS) {
      if (content.includes(txId)) {
        failures.push(`${rel}: contains a known real transaction ID (masked: ${txId.slice(0, 3)}***)`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("❌ PII AUDIT FAILED\n");
    for (const f of failures) console.error("  - " + f);
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }

  console.log(`✓ PII audit passed — scanned ${files.length} files under ${path.relative(process.cwd(), ROOT)}, no public PII found.`);
}

main();
