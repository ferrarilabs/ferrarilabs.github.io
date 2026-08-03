#!/usr/bin/env node
/**
 * check_xss_sinks.mjs — DOM XSS sink inventory for the bolão platform.
 *
 * Node built-in modules only. Run locally:
 *   node bolao/scripts/security/check_xss_sinks.mjs
 *
 * What it does:
 *   - Finds every innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/new Function/
 *     setTimeout(string)/setInterval(string) occurrence in bolao/**\/*.js.
 *   - Hard-fails (CONFIRMED CRITICAL) on eval(/new Function(/document.write( — this codebase's
 *     documented standard (docs/bolao/SECURITY.md, docs/bolao/PROJECT_MEMORY.md) is zero
 *     tolerance for these regardless of context.
 *   - For innerHTML/outerHTML/insertAdjacentHTML, applies a heuristic: if `escapeHtml(` or
 *     `esc(` appears anywhere in the same function body (approximated as the enclosing
 *     ~40-line window, since this is a plain grep-based script with no AST parser and no
 *     dependency install), classify as "heuristic OK"; otherwise "REVIEW NEEDED". This is a
 *     heuristic, not a proof — it does not replace the manual review already documented in
 *     docs/bolao/security/INJECTION_REVIEW.md, and it never fails the build on its own, per the
 *     task's instruction not to build a scanner that's just noise without classification.
 *
 * Exit code: non-zero only on eval/new Function/document.write. innerHTML-family findings are
 * always reported, never auto-failed (too many legitimate false positives without a real AST).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
const BOLAO = path.join(ROOT, "bolao");

function walkJs(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, files);
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

const HARD_FAIL = [
  { name: "eval(", re: /\beval\s*\(/g },
  { name: "new Function(", re: /\bnew\s+Function\s*\(/g },
  { name: "document.write(", re: /\bdocument\.write\s*\(/g },
  { name: "setTimeout(string)", re: /\bsetTimeout\s*\(\s*["'`]/g },
  { name: "setInterval(string)", re: /\bsetInterval\s*\(\s*["'`]/g },
];

const SINKS = [
  { name: "innerHTML", re: /\.innerHTML\s*=/g },
  { name: "outerHTML", re: /\.outerHTML\s*=/g },
  { name: "insertAdjacentHTML", re: /\.insertAdjacentHTML\s*\(/g },
];

const ESCAPE_HINT = /\b(escapeHtml|esc)\s*\(/;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// Strips `// ...` line comments before matching hard-fail patterns, so a comment that merely
// *mentions* document.write/eval (e.g. explaining why the code deliberately avoids it — this
// codebase's changelogs do exactly that) isn't reported as a confirmed call. This is a
// line-based heuristic, not a real JS parser (no dependency install allowed) — it does not
// handle `//` inside a string literal correctly, but that's rare enough in this codebase's
// style (checked manually) to accept as a known limitation rather than pull in a parser.
function stripLineComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

function main() {
  const files = walkJs(BOLAO);
  let failed = false;
  const hardFailFindings = [];
  const sinkFindings = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    const codeOnly = stripLineComments(text);
    const lines = text.split("\n");

    for (const { name, re } of HARD_FAIL) {
      for (const m of codeOnly.matchAll(re)) {
        hardFailFindings.push({ file: rel, line: lineOf(codeOnly, m.index), pattern: name });
      }
    }

    for (const { name, re } of SINKS) {
      for (const m of text.matchAll(re)) {
        const ln = lineOf(text, m.index);
        const windowStart = Math.max(0, ln - 20);
        const windowEnd = Math.min(lines.length, ln + 20);
        const windowText = lines.slice(windowStart, windowEnd).join("\n");
        const heuristicOk = ESCAPE_HINT.test(windowText);
        sinkFindings.push({ file: rel, line: ln, pattern: name, heuristic: heuristicOk ? "OK (escape helper found nearby)" : "REVIEW NEEDED (no escapeHtml/esc nearby)" });
      }
    }
  }

  console.log(`=== Hard-fail patterns (eval/new Function/document.write/setTimeout|setInterval(string)) ===`);
  if (hardFailFindings.length === 0) {
    console.log(" none found — matches the documented standard (docs/bolao/SECURITY.md)");
  } else {
    for (const f of hardFailFindings) console.error(`CONFIRMED CRITICAL: ${f.file}:${f.line} — ${f.pattern}`);
    failed = true;
  }

  console.log(`\n=== innerHTML/outerHTML/insertAdjacentHTML sinks (${sinkFindings.length} found) ===`);
  const reviewCount = sinkFindings.filter((f) => f.heuristic.startsWith("REVIEW")).length;
  for (const f of sinkFindings) {
    console.log(` ${f.file}:${f.line} [${f.pattern}] ${f.heuristic}`);
  }
  console.log(`\n${sinkFindings.length - reviewCount} heuristic-OK, ${reviewCount} flagged REVIEW NEEDED (heuristic only — see docs/bolao/security/INJECTION_REVIEW.md for the actual manual audit result).`);

  process.exit(failed ? 1 : 0);
}

main();
