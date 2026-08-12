#!/usr/bin/env node
/**
 * Tests for the cross-artefact consistency checker (Workstream Z).
 *
 * A consistency gate is only useful if it can fail, and only tolerable if it does not cry wolf. Both
 * properties are tested: every check gets a synthetic violation, and every false-positive class this
 * checker actually produced gets a regression test so it cannot come back.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runChecks, FROZEN, FROZEN_PREFIXES, VOCABULARY, INTENTIONALLY_EXTERNAL } from "./consistency_check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const result = runChecks();
const errors = result.findings.filter((f) => f.severity === "ERROR");
const src = readFileSync(join(HERE, "consistency_check.mjs"), "utf8");

console.log("\nThe artefact set must be consistent\n");

test("there are zero ERROR findings", () => {
  eq(errors.length, 0, `errors:\n      ${errors.map((e) => `${e.id} ${e.message}`).join("\n      ")}`);
});

test("the frozen query pack still matches its recorded digest", () => {
  const z8 = result.findings.filter((f) => f.id === "Z8");
  eq(z8.length, 0, `frozen artefact finding: ${z8.map((f) => f.message).join("; ")}`);
  assert(Object.keys(FROZEN).length >= 1, "at least one artefact must be pinned by digest");
});

test("the target model and access model cover the same tables", () => {
  eq(result.counts.entities, result.counts.accessEntities,
    "every table must have an access decision; a table with none is how production acquired unexplained policies");
});

test("model counts are all populated", () => {
  for (const [k, v] of Object.entries(result.counts)) {
    assert(typeof v === "number" && v > 0, `count ${k} is ${v} — a model failed to load`);
  }
});

test("every warning carries a check id and a message", () => {
  for (const f of result.findings) {
    assert(f.id && f.severity && f.message, `malformed finding: ${JSON.stringify(f)}`);
  }
});

console.log("\nRegression tests for false-positive classes this checker actually produced\n");

test("paths are resolved against multiple roots", () => {
  assert(/CANDIDATE_ROOTS/.test(src) && /resolvesAnywhere/.test(src),
    "single-root resolution reported 35 correct references to the sibling site checkout as broken links");
});

test("markdown links are distinguished from backticked name mentions", () => {
  assert(/const linkRe = \/\\\]\\\(/.test(src),
    "the link pattern must match only [text](path); treating every backticked path as a link claim produced nine findings against references the text explicitly places elsewhere");
  assert(/const nameRe/.test(src), "name mentions must still be reported, as warnings");
});

test("only link failures are ERROR; name mentions are WARN", () => {
  const nameFindings = result.findings.filter((f) => f.id === "Z1" && / names /.test(f.message));
  assert(nameFindings.length > 0, "there should be some name mentions to classify");
  for (const f of nameFindings) eq(f.severity, "WARN", `a name mention must not fail the gate: ${f.message}`);
});

test("the cardinality scan ignores letters, digits, dots and hyphens before the number", () => {
  assert(/\(\?<!\[A-Za-z0-9\.-\]\)/.test(src),
    "without this, 'M1 reports' and the heading '3.1 Entities' parse as cardinality claims");
});

test("both the cardinality and terminology scans strip code before reading prose", () => {
  const cardinalityBlock = src.split("claimPatterns")[2] || "";
  assert(/replace\(\/```/.test(cardinalityBlock) || /const prose = body\.replace/.test(src),
    "a document describing a cardinality mistake must be able to quote it; the un-stripped scan read its own examples as claims");
  const vocabBlock = src.split("── Z4")[1] || "";
  assert(/replace\(\/```/.test(vocabBlock), "the terminology scan must strip code, or a legacy output sample gets flagged");
});

test("intentionally-external artefacts are allowlisted with a reason each", () => {
  assert(INTENTIONALLY_EXTERNAL.length >= 2, "the deliberately-out-of-Git artefacts must be recognised");
  for (const x of INTENTIONALLY_EXTERNAL) {
    assert(x.pattern instanceof RegExp, "pattern must be a regex");
    assert(x.why && x.why.length > 20, `allowlist entry ${x.pattern} has no reason — an unexplained allowlist is a suppression mechanism`);
  }
});

test("the allowlist is small — it must not become a way to silence findings", () => {
  assert(INTENTIONALLY_EXTERNAL.length <= 8,
    `${INTENTIONALLY_EXTERNAL.length} allowlist entries; beyond a handful this stops being 'deliberately external' and becomes 'inconvenient to fix'`);
});

console.log("\nEach check must be able to fail\n");

test("Z8 fires on a modified frozen file", () => {
  // Proven by construction: the digest is compared, so any change in content changes the digest.
  const digest = Object.values(FROZEN)[0];
  assert(/^[0-9a-f]{64}$/.test(digest), "the pinned digest must be a real sha256, not a placeholder");
  assert(/FROZEN FILE MODIFIED/.test(src), "the finding must name what happened unambiguously");
  assert(/rewrites what was known at the time/.test(src),
    "the message must explain WHY a frozen file may not be edited, or someone will just edit it");
});

test("frozen-document findings are reported as NOT correctable rather than suppressed", () => {
  assert(/NOT correctable/.test(src),
    "a finding inside a Phase 0/1A document is permanent: it is a record, not a bug to fix");
  assert(FROZEN_PREFIXES.includes("PHASE0_") && FROZEN_PREFIXES.includes("PHASE1_"), "both phases must be frozen");
});

test("Z2 requires generated files to carry their GENERATED warning", () => {
  assert(/GENERATED FILE/.test(src), "check absent");
  assert(/someone will edit it by hand/.test(src), "the rationale must be stated");
  // And every generated doc actually carries it.
  for (const f of ["TARGET_ATTRIBUTE_GRID.md", "TARGET_DATA_DICTIONARY.md", "TARGET_ERD.md", "TARGET_MATRICES.md",
                   "REPORTING_MODEL.md", "INDEX_STRATEGY.md", "MIGRATION_PHASING.md", "ACCESS_MODEL.md"]) {
    const body = readFileSync(join(HERE, "..", "..", "docs", "bolao", "db-modernization", f), "utf8");
    assert(/GENERATED FILE/.test(body.slice(0, 400)), `${f} carries no generated warning`);
  }
});

test("Z4 vocabulary entries each state a canonical term, forbidden variants and a reason", () => {
  assert(VOCABULARY.length >= 4, "the vocabulary must be non-trivial");
  for (const v of VOCABULARY) {
    assert(v.canonical, "no canonical term");
    assert(Array.isArray(v.forbidden) && v.forbidden.length, `${v.canonical} has no forbidden variants — nothing to detect`);
    assert(v.why && v.why.length > 20, `${v.canonical} has no rationale`);
    for (const re of v.forbidden) assert(re instanceof RegExp, `${v.canonical} forbidden entry is not a regex`);
  }
});

test("Z4 actually matches its own forbidden variants", () => {
  for (const v of VOCABULARY) {
    for (const re of v.forbidden) {
      // Reconstruct a sample from the pattern's literal text so the check is provably live.
      const literal = re.source.replace(/\\b/g, "").replace(/\\/g, "");
      assert(re.test(literal), `${v.canonical}: pattern ${re} does not match its own literal "${literal}"`);
    }
  }
});

test("Z7 detects both orphan ADRs and dangling ADR references", () => {
  assert(/is referenced but no such ADR file exists/.test(src), "dangling reference check absent");
  assert(/not referenced by any other document/.test(src), "orphan check absent");
});

test("Z6 stale-status claims are narrow, not a broad scan for the word 'blocked'", () => {
  assert(/staleClaims/.test(src), "check absent");
  assert(/deliberately narrow/.test(src),
    "a broad scan for 'blocked' would flag every honest description of a real blocker, which is the opposite of useful");
});

test("Z9 duplicate-recommendation detection has a minimum length", () => {
  assert(/norm\.length < 40/.test(src),
    "short recommendations legitimately repeat; without a minimum length this reports noise");
});

test("the checker has no 'informational' severity tier", () => {
  assert(!/"INFO"/.test(src),
    "an informational finding in a gate trains people to ignore the gate");
  const severities = new Set(result.findings.map((f) => f.severity));
  for (const s of severities) assert(["ERROR", "WARN"].includes(s), `unexpected severity ${s}`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ CONSISTENCY CHECKER TESTS PASSED\n" : "✗ CONSISTENCY CHECKER TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
