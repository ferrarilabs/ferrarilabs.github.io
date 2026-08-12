#!/usr/bin/env node
/**
 * Hash-bound policy materialization (T2-LITERAL resolution).
 *
 * THE PROBLEM
 * The captured baseline contains six `CREATE POLICY` statements, each carrying one inline literal. The T2
 * restriction forbids committing those literals. But a baseline that omits them is not replayable, and an
 * unreplayable baseline defeats the entire purpose of M0.
 *
 * Two bad ways out, both rejected:
 *   · commit the literals anyway — violates an explicit restriction
 *   · commit the policies with the predicates gutted — "executable" but no longer describes production,
 *     which weakens provenance to make a file run. That trade is never acceptable here.
 *
 * THE APPROACH — hash-bound substitution
 * The committed migration carries the policy in FULL STRUCTURE with each literal replaced by a named
 * placeholder, plus the sha256 of the true literal and the md5 the *materialized* policy body must hash to.
 * A private companion artifact, held outside Git, maps placeholder → value.
 *
 * Materializing is then a verifiable operation, not a trusting one: substitute, recompute the body hash,
 * and compare against the committed expectation. If the substitution is wrong, incomplete, or applied to
 * the wrong policy, the hash does not match and materialization FAILS. So the committed file proves what
 * the true policy is without containing it.
 *
 * What each requirement gets:
 *   policy provenance          the full predicate structure, operators and columns are committed
 *   policy hash               EXPECTED_POLICY_MD5 is committed and is the acceptance test
 *   semantics evidence        everything except three opaque operands is in Git and reviewable
 *   restore verification      a restored database's policy hashes can be compared to the same constants
 *   the literal itself        never in Git, in any form, including reconstructible form
 *
 * A 4-character lowercase-alphanumeric literal has ~2^20 possibilities, so its sha256 is brute-forceable
 * by anyone who wants it. That is FINE and is stated rather than hidden: the values are already public in
 * 83–129 tracked files. The digest is an integrity binding, not a confidentiality mechanism, and this
 * module never claims otherwise.
 *
 * NOTHING HERE CONNECTS TO A DATABASE. Materialization writes to stdout or a path outside the repo.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");

/** Placeholder syntax: `${LITERAL:name}` — deliberately not valid SQL, so an unmaterialized file cannot run. */
export const PLACEHOLDER_RE = /\$\{LITERAL:([A-Za-z0-9_]+)\}/g;

export const MATERIALIZE_REFUSAL = {
  NO_BINDINGS: "NO_BINDINGS",
  UNBOUND_PLACEHOLDER: "UNBOUND_PLACEHOLDER",
  DIGEST_MISMATCH: "DIGEST_MISMATCH",
  BODY_HASH_MISMATCH: "BODY_HASH_MISMATCH",
  RESIDUAL_PLACEHOLDER: "RESIDUAL_PLACEHOLDER",
  UNKNOWN_POLICY: "UNKNOWN_POLICY",
};

export class MaterializeRefused extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

/** Placeholders present in a template, in order of first appearance. */
export function placeholdersIn(text) {
  const out = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(String(text)))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * A binding set is `{ name: { value, sha256 } }`, loaded from the PRIVATE companion artifact.
 *
 * `value` is present only at materialization time and is never returned, logged or included in any
 * result object — only the fact that it verified.
 */
export function verifyBindings(bindings, expected) {
  const findings = [];
  for (const [name, exp] of Object.entries(expected)) {
    const b = bindings[name];
    if (!b || b.value === undefined || b.value === null) {
      findings.push({ name, code: MATERIALIZE_REFUSAL.UNBOUND_PLACEHOLDER, message: `no binding supplied for ${name}` });
      continue;
    }
    const actual = sha256(String(b.value));
    if (actual !== exp) {
      // Report only that it differs. Printing either digest fully would let a caller confirm a guess.
      findings.push({ name, code: MATERIALIZE_REFUSAL.DIGEST_MISMATCH,
        message: `binding for ${name} does not match the committed digest (expected …${exp.slice(-6)})` });
    }
  }
  for (const name of Object.keys(bindings)) {
    if (!(name in expected)) findings.push({ name, code: MATERIALIZE_REFUSAL.UNBOUND_PLACEHOLDER, message: `binding ${name} corresponds to no committed digest` });
  }
  return findings;
}

/**
 * Materialize a template. Returns the SQL and a verification record.
 *
 * `expectedBodyMd5` maps policy name → the md5 that policy's materialized body must produce. Supplying it
 * is what makes this verifiable rather than hopeful; omitting it is allowed only for synthetic tests and
 * is reported as UNVERIFIED so the distinction cannot be lost.
 */
export function materialize(template, { bindings, digests, expectedBodyMd5 = null } = {}) {
  if (!bindings || Object.keys(bindings).length === 0) {
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.NO_BINDINGS,
      "materialization requires the private binding set; the committed template alone is deliberately not executable");
  }
  const needed = placeholdersIn(template);
  const missing = needed.filter((n) => !(n in bindings));
  if (missing.length) {
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.UNBOUND_PLACEHOLDER,
      `template needs ${needed.length} placeholder(s); ${missing.length} unbound: ${missing.join(", ")}`);
  }
  /**
   * Verify only the placeholders this template actually uses, against the digests committed for them.
   * A placeholder with no committed digest is itself a finding: substituting an unverifiable value is
   * exactly the trust this design removes.
   */
  const d = digests || {};
  const undigested = needed.filter((n) => !d[n]);
  if (undigested.length) {
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.DIGEST_MISMATCH,
      `no committed digest for placeholder(s): ${undigested.join(", ")} — an unverifiable substitution is not permitted`);
  }
  const digestFindings = verifyBindings(
    Object.fromEntries(needed.map((n) => [n, bindings[n]])),
    Object.fromEntries(needed.map((n) => [n, d[n]])),
  );
  if (digestFindings.length) {
    throw new MaterializeRefused(digestFindings[0].code, digestFindings.map((f) => f.message).join("; "));
  }

  let sql = String(template);
  for (const name of needed) sql = sql.split(`\${LITERAL:${name}}`).join(String(bindings[name].value));

  // A residual placeholder means substitution silently missed one. Executing that would create a policy
  // whose predicate contains a literal `${LITERAL:...}` string — syntactically valid, semantically wrong.
  if (PLACEHOLDER_RE.test(sql)) {
    PLACEHOLDER_RE.lastIndex = 0;
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.RESIDUAL_PLACEHOLDER,
      "a placeholder survived substitution; the result would create a policy comparing against a literal placeholder string");
  }

  const bodies = extractPolicyBodies(sql);
  const verification = { policies: [], verified: false, unverifiedReason: null };

  if (!expectedBodyMd5) {
    verification.unverifiedReason = "no expectedBodyMd5 supplied — result is UNVERIFIED and must not be used against any real database";
    verification.policies = bodies.map((b) => ({ name: b.name, md5: md5(b.body), matched: null }));
    return { sql, verification };
  }

  const mismatches = [];
  for (const b of bodies) {
    const want = expectedBodyMd5[b.name];
    const got = md5(b.body);
    if (want === undefined) {
      mismatches.push(`policy ${b.name} has no committed expected hash`);
      verification.policies.push({ name: b.name, md5: got, matched: null });
      continue;
    }
    const matched = want === got;
    verification.policies.push({ name: b.name, md5: got, matched });
    if (!matched) mismatches.push(`policy ${b.name}: materialized body hash does not match the committed expectation`);
  }
  for (const name of Object.keys(expectedBodyMd5)) {
    if (!bodies.some((b) => b.name === name)) mismatches.push(`expected policy ${name} is absent from the materialized SQL`);
  }
  if (mismatches.length) {
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.BODY_HASH_MISMATCH, mismatches.join("; "));
  }
  verification.verified = true;
  return { sql, verification };
}

/**
 * Extract `{name, body}` per policy. `body` is the normalised text the hash is taken over: whitespace
 * collapsed, so a reformat does not read as a semantic change, but nothing else altered.
 */
export function extractPolicyBodies(sql) {
  const out = [];
  const re = /CREATE\s+POLICY\s+"?([A-Za-z0-9_]+)"?\s+ON\s+([\s\S]*?);(?=\s*(?:CREATE|GRANT|ALTER|COMMENT|--|$))/gi;
  let m;
  while ((m = re.exec(String(sql)))) {
    out.push({ name: m[1], body: m[2].replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** Load the private binding set. Refuses a path inside the repository. */
export function loadBindings(path, { repoRoot }) {
  if (!existsSync(path)) {
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.NO_BINDINGS, `binding file not found at the supplied path`);
  }
  const resolved = String(path);
  if (repoRoot && resolved.startsWith(String(repoRoot))) {
    throw new MaterializeRefused(MATERIALIZE_REFUSAL.NO_BINDINGS,
      "the binding file is inside the repository. It must live outside the working tree, or the literals " +
      "are one `git add -A` away from being committed — which is the exact outcome this design exists to prevent");
  }
  return JSON.parse(readFileSync(resolved, "utf8"));
}

/**
 * The eight-category taxonomy required for a definitive classification.
 * Ordered from most to least restrictive so a reviewer reads the serious ones first.
 */
export const LITERAL_CLASSES = [
  "SECRET", "PII", "STATIC_AUTHORIZATION_LITERAL", "LEGACY_AUTHORIZATION_LITERAL",
  "BUSINESS_CONSTANT", "NONSECRET_CONFIGURATION", "PUBLIC_IDENTIFIER", "UNKNOWN",
];

/**
 * Decide committability from evidence, not from vibes. Every input is a measured property; no input is
 * the literal's value.
 */
export function classifyLiteral(evidence) {
  const {
    lengthChars, entropyBitsPerChar, inParticipantList, inPaymentList,
    trackedRepoOccurrences, referencesCallerAttribute, comparedAgainstColumn,
  } = evidence;

  const classes = [];
  if (inParticipantList || inPaymentList) classes.push("PII");
  // Secret-shaped: long AND high entropy. Either alone is not enough — a long low-entropy string is a
  // sentence, and a short high-entropy one is an id.
  if (lengthChars >= 20 && entropyBitsPerChar >= 3.5) classes.push("SECRET");
  if (trackedRepoOccurrences > 0) classes.push("PUBLIC_IDENTIFIER");
  if (comparedAgainstColumn && !referencesCallerAttribute) classes.push("LEGACY_AUTHORIZATION_LITERAL");
  if (referencesCallerAttribute) classes.push("STATIC_AUTHORIZATION_LITERAL");
  if (classes.length === 0) classes.push("UNKNOWN");

  const blocking = classes.filter((c) => ["SECRET", "PII", "UNKNOWN"].includes(c));
  return {
    classes,
    safeToCommit: blocking.length === 0,
    blockingClasses: blocking,
    reason: blocking.length
      ? `classified ${blocking.join("+")} — not committable`
      : trackedRepoOccurrences > 0
        ? `already present in ${trackedRepoOccurrences} tracked file(s), therefore in shipped client code and public URLs; committing it changes no exposure that does not already exist`
        : "no blocking classification, but not already public — prefer the hash-bound representation",
  };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  console.log("\nHash-bound policy materialization\n");
  console.log("  placeholder syntax: ${LITERAL:name}  (deliberately invalid SQL, so an unmaterialized file cannot run)");
  console.log(`  refusals: ${Object.keys(MATERIALIZE_REFUSAL).join(", ")}`);
  console.log(`  literal classes: ${LITERAL_CLASSES.join(", ")}`);
  console.log("\n  This tool never prints a literal value, and never writes one into the repository.\n");
}
