#!/usr/bin/env node
/**
 * check_public_secrets.mjs — secret scanning for the bolão platform.
 *
 * Node built-in modules only (fs, path) — no npm install, no dependency.
 * Produced by the 2026-08-02 read-only security review. Run locally:
 *   node bolao/scripts/security/check_public_secrets.mjs
 *
 * What it does:
 *   - Walks the repo (skips .git, node_modules if present) looking for patterns that could be
 *     a privileged secret (service_role key, private key blocks, generic high-entropy tokens
 *     next to SECRET/TOKEN/PASSWORD-looking variable names).
 *   - Cross-checks matches against a small allowlist of values already known to be
 *     intentionally public in this repo (documented in docs/bolao/security/SECURITY_ASSESSMENT_REPORT.md
 *     "Chaves encontradas") so it doesn't cry wolf on every run.
 *   - Masks every value it prints — never writes a full secret to stdout, even for a
 *     CONFIRMED finding, to avoid this script itself becoming a leak vector.
 *   - Exits non-zero only on a CONFIRMED critical finding (an unrecognized value matching a
 *     privileged-key shape). Exits 0 (with a report) when only known-public/allowlisted values
 *     or no matches are found. Never exits non-zero on a merely "REVIEW" finding — those are
 *     reported but don't fail CI, per the task's "don't build a scanner that's just noise
 *     without classification" instruction.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const SKIP_DIRS = new Set([".git", "node_modules", ".claude"]);
const TEXT_EXT = new Set([".js", ".py", ".html", ".md", ".yml", ".yaml", ".json", ".sql", ".css", ".txt"]);

// Values already confirmed public-by-design in this repo (masked here on purpose — this
// allowlist only needs enough of the value to match, never the full secret even for a key
// that's already public).
const KNOWN_PUBLIC_PREFIXES = [
  "sb_publishable_", // Supabase anon/publishable key — public by design, RLS-scoped
  "GBZFujsJBET6modve", // EmailJS public key
  "0x4AAAAAADBOZDvkES97y2fW", // Cloudflare Turnstile site key
];

const PRIVILEGED_PATTERNS = [
  { name: "Supabase service_role key (JWT-shaped)", re: /\bsb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: "Generic JWT-looking token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GitHub personal access token", re: /\bghp_[0-9A-Za-z]{36}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: "PEM private key block", re: /-----BEGIN (RSA|EC|OPENSSH|PGP|PRIVATE) KEY-----/g },
];

// Weaker signal: variable-name-adjacent secrets ("SECRET", "TOKEN", "PASSWORD" assigned a
// non-trivial literal). Reported as REVIEW, never auto-failed, because this repo legitimately
// has strings like adminPasswordHash (a hash, not a secret) and doc prose mentioning these words.
const REVIEW_PATTERNS = [
  { name: "Possible secret-like assignment", re: /\b(SECRET|PRIVATE_KEY|API_KEY|PASSWORD)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/gi },
];

function mask(value) {
  if (value.length <= 12) return value.slice(0, 3) + "…" + value.slice(-2);
  return value.slice(0, 10) + "…" + value.slice(-4);
}

function isAllowlisted(value) {
  return KNOWN_PUBLIC_PREFIXES.some((p) => value.startsWith(p) || value.includes(p));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (TEXT_EXT.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function main() {
  const files = walk(ROOT);
  const confirmed = [];
  const review = [];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable — skip
    }
    const rel = path.relative(ROOT, file);

    for (const { name, re } of PRIVILEGED_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const value = m[0];
        if (isAllowlisted(value)) continue;
        confirmed.push({ file: rel, pattern: name, masked: mask(value) });
      }
    }
    for (const { name, re } of REVIEW_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const value = m[0];
        if (isAllowlisted(value)) continue;
        // Skip well-known false positives already documented by this audit.
        if (/adminPasswordHash/.test(value)) continue;
        review.push({ file: rel, pattern: name, masked: mask(value) });
      }
    }
  }

  const report = {
    tool: "check_public_secrets.mjs",
    scannedFiles: files.length,
    confirmed_critical: confirmed,
    review_needed: review,
  };
  console.log(JSON.stringify(report, null, 2));

  if (confirmed.length > 0) {
    console.error(`\nCONFIRMED CRITICAL: ${confirmed.length} finding(s) matching a privileged-key shape that is NOT on the known-public allowlist. Do not print full values — inspect the listed file/line manually.`);
    process.exit(1);
  }
  console.error(`\nNo confirmed privileged-secret shape found outside the known-public allowlist. ${review.length} lower-confidence "review needed" match(es) reported above (not a failure).`);
  process.exit(0);
}

main();
