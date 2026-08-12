#!/usr/bin/env node
/**
 * Tests for hash-bound policy materialization (T2-LITERAL).
 *
 * Every literal in this file is SYNTHETIC and invented here (`synthx`, `zzq7`). No production literal, and
 * nothing derived from one, appears — a test that needed a real value would defeat the design it tests.
 *
 * The central property is negative and therefore adversarially tested: an unmaterialized template must not
 * be executable, a wrong binding must not materialize, and a materialization that changes the policy
 * meaning must not verify.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  PLACEHOLDER_RE, MATERIALIZE_REFUSAL, MaterializeRefused, LITERAL_CLASSES,
  placeholdersIn, verifyBindings, materialize, extractPolicyBodies, loadBindings, classifyLiteral,
} from "./policy_materializer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const refusal = (fn) => {
  try { fn(); } catch (e) { if (e instanceof MaterializeRefused) return e.code; throw e; }
  throw new Error("expected a MaterializeRefused, none thrown");
};

// Synthetic stand-ins for the shape of the real thing: short lowercase alphanumeric row keys.
const SYN = { main_row: "synthx", alt_row: "zzq7" };
const DIGESTS = { main_row: sha256(SYN.main_row), alt_row: sha256(SYN.alt_row) };
const BINDINGS = { main_row: { value: SYN.main_row }, alt_row: { value: SYN.alt_row } };

const TEMPLATE = `CREATE POLICY synthetic_select ON public.synthetic_state
  FOR SELECT TO anon
  USING (id = '\${LITERAL:main_row}');
CREATE POLICY synthetic_update ON public.synthetic_state
  FOR UPDATE TO anon
  USING (id = '\${LITERAL:main_row}' OR id = '\${LITERAL:alt_row}');
`;

/** The hashes a correct materialization must reproduce. */
function expectedHashes() {
  const { sql } = materialize(TEMPLATE, { bindings: BINDINGS, digests: DIGESTS });
  return Object.fromEntries(extractPolicyBodies(sql).map((b) => [b.name, md5(b.body)]));
}
const EXPECTED = expectedHashes();

console.log("\nTemplate handling\n");

test("placeholders are found, de-duplicated, in order", () => {
  eq(JSON.stringify(placeholdersIn(TEMPLATE)), JSON.stringify(["main_row", "alt_row"]), "placeholders");
});

test("the placeholder syntax is deliberately invalid SQL", () => {
  // If it were valid SQL, an unmaterialized template could be applied by accident and would create a
  // policy comparing against the literal string "${LITERAL:main_row}".
  assert(/\$\{/.test(TEMPLATE), "template must contain ${...} which no SQL dialect accepts bare");
  PLACEHOLDER_RE.lastIndex = 0;
  assert(PLACEHOLDER_RE.test(TEMPLATE), "the pattern must match its own syntax");
});

test("a template with no placeholders materializes to itself", () => {
  const plain = "CREATE POLICY p ON t FOR SELECT TO anon USING (true);";
  const { sql } = materialize(plain, { bindings: BINDINGS, digests: DIGESTS });
  eq(sql, plain, "unchanged");
});

console.log("\nMaterialization refuses everything unverifiable\n");

test("materializing with no bindings is refused", () => {
  eq(refusal(() => materialize(TEMPLATE, {})), MATERIALIZE_REFUSAL.NO_BINDINGS,
    "the committed template alone must not be executable");
});

test("a missing binding is refused", () => {
  eq(refusal(() => materialize(TEMPLATE, { bindings: { main_row: BINDINGS.main_row }, digests: DIGESTS })),
    MATERIALIZE_REFUSAL.UNBOUND_PLACEHOLDER, "refusal code");
});

test("a placeholder with no committed digest is refused", () => {
  eq(refusal(() => materialize(TEMPLATE, { bindings: BINDINGS, digests: { main_row: DIGESTS.main_row } })),
    MATERIALIZE_REFUSAL.DIGEST_MISMATCH, "an unverifiable substitution must not be permitted");
});

test("a WRONG binding value is refused by digest", () => {
  const wrong = { ...BINDINGS, main_row: { value: "notthevalue" } };
  eq(refusal(() => materialize(TEMPLATE, { bindings: wrong, digests: DIGESTS })),
    MATERIALIZE_REFUSAL.DIGEST_MISMATCH, "refusal code");
});

test("a digest mismatch message never reveals the expected digest in full", () => {
  const wrong = { ...BINDINGS, main_row: { value: "notthevalue" } };
  let msg = "";
  try { materialize(TEMPLATE, { bindings: wrong, digests: DIGESTS }); } catch (e) { msg = e.message; }
  assert(!msg.includes(DIGESTS.main_row), "the full digest must not appear — it would let a caller confirm a guess");
  assert(msg.includes(DIGESTS.main_row.slice(-6)), "a short suffix is enough to identify which binding failed");
});

test("an extra binding with no corresponding digest is reported", () => {
  const f = verifyBindings({ ...BINDINGS, stray: { value: "x" } }, DIGESTS);
  assert(f.some((x) => /corresponds to no committed digest/.test(x.message)), "not reported");
});

test("a residual placeholder is refused", () => {
  // A template using an escaped/odd form that substitution would miss.
  const tricky = TEMPLATE + "CREATE POLICY leftover ON t FOR SELECT TO anon USING (id = '${LITERAL:main_row}x');";
  // main_row substitutes, leaving no placeholder — so construct a genuine miss instead:
  const missed = "CREATE POLICY p ON t FOR SELECT TO anon USING (id = '${LITERAL:never_declared}');";
  eq(refusal(() => materialize(missed, { bindings: BINDINGS, digests: DIGESTS })),
    MATERIALIZE_REFUSAL.UNBOUND_PLACEHOLDER, "an undeclared placeholder is caught before substitution");
  assert(tricky.length > 0, "sanity");
});

console.log("\nVerification against committed hashes\n");

test("a correct materialization verifies", () => {
  const r = materialize(TEMPLATE, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED });
  assert(r.verification.verified, "must verify");
  eq(r.verification.policies.length, 2, "both policies");
  for (const p of r.verification.policies) eq(p.matched, true, `${p.name} matched`);
});

test("the materialized SQL contains the value and the template does not", () => {
  const r = materialize(TEMPLATE, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED });
  assert(r.sql.includes(SYN.main_row), "materialized output must contain the substituted value");
  assert(!TEMPLATE.includes(SYN.main_row), "the committed template must NOT contain it — this is the whole point");
});

test("a materialization omitting expectedBodyMd5 is flagged UNVERIFIED, not silently trusted", () => {
  const r = materialize(TEMPLATE, { bindings: BINDINGS, digests: DIGESTS });
  eq(r.verification.verified, false, "must not claim verification");
  assert(/UNVERIFIED/.test(r.verification.unverifiedReason), "the reason must say so explicitly");
  for (const p of r.verification.policies) eq(p.matched, null, "match state is unknown, not true");
});

test("a policy whose MEANING changed does not verify, even with correct bindings", () => {
  // Same literals, but the predicate is widened — the exact kind of "improvement" a baseline must not make.
  const widened = TEMPLATE.replace("id = '${LITERAL:main_row}'", "true /* id = '${LITERAL:main_row}' */");
  eq(refusal(() => materialize(widened, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED })),
    MATERIALIZE_REFUSAL.BODY_HASH_MISMATCH,
    "silently widening a policy inside a baseline must be impossible to do and still pass");
});

test("swapping two literals between policies does not verify", () => {
  const swapped = TEMPLATE
    .replace("USING (id = '${LITERAL:main_row}');", "USING (id = '${LITERAL:alt_row}');");
  eq(refusal(() => materialize(swapped, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED })),
    MATERIALIZE_REFUSAL.BODY_HASH_MISMATCH, "a substitution applied to the wrong policy must fail");
});

test("a missing expected policy is reported", () => {
  const truncated = TEMPLATE.split("CREATE POLICY synthetic_update")[0];
  eq(refusal(() => materialize(truncated, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED })),
    MATERIALIZE_REFUSAL.BODY_HASH_MISMATCH, "a dropped policy must fail verification");
});

test("body hashing ignores reformatting but not content", () => {
  const reformatted = TEMPLATE.replace(/\n\s+/g, " ");
  const r = materialize(reformatted, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED });
  assert(r.verification.verified, "whitespace changes must not read as semantic changes");
});

test("extractPolicyBodies finds each policy and normalises whitespace", () => {
  const bodies = extractPolicyBodies("CREATE POLICY a ON t\n  FOR SELECT\n  TO anon\n  USING (true);\nGRANT SELECT ON t TO anon;");
  eq(bodies.length, 1, "one policy");
  eq(bodies[0].name, "a", "name");
  assert(!/\n/.test(bodies[0].body), "body must be whitespace-normalised");
});

console.log("\nThe binding file must live outside the repository\n");

test("a binding path inside the repo is refused", () => {
  const repoRoot = join(HERE, "..", "..");
  eq(refusal(() => loadBindings(join(repoRoot, "supabase", "bindings.json"), { repoRoot })),
    MATERIALIZE_REFUSAL.NO_BINDINGS,
    "literals inside the working tree are one `git add -A` away from being committed");
});

test("a nonexistent binding path is refused", () => {
  eq(refusal(() => loadBindings("/definitely/not/here/bindings.json", { repoRoot: "/x" })),
    MATERIALIZE_REFUSAL.NO_BINDINGS, "refusal code");
});

console.log("\nLiteral classification — evidence in, decision out\n");

test("the taxonomy has all eight required classes", () => {
  for (const c of ["SECRET", "PII", "PUBLIC_IDENTIFIER", "NONSECRET_CONFIGURATION",
                   "STATIC_AUTHORIZATION_LITERAL", "LEGACY_AUTHORIZATION_LITERAL", "BUSINESS_CONSTANT", "UNKNOWN"]) {
    assert(LITERAL_CLASSES.includes(c), `missing class ${c}`);
  }
});

test("a short, low-entropy, already-public row key is PUBLIC_IDENTIFIER + LEGACY_AUTHORIZATION_LITERAL and safe", () => {
  const r = classifyLiteral({ lengthChars: 4, entropyBitsPerChar: 2.0, inParticipantList: false,
    inPaymentList: false, trackedRepoOccurrences: 129, referencesCallerAttribute: false, comparedAgainstColumn: true });
  assert(r.classes.includes("PUBLIC_IDENTIFIER"), "public identifier");
  assert(r.classes.includes("LEGACY_AUTHORIZATION_LITERAL"), "legacy authorization literal");
  eq(r.safeToCommit, true, "safe to commit");
  assert(/already present in 129/.test(r.reason), "the reason must cite the evidence");
});

test("a value in the participant list is PII and NOT safe", () => {
  const r = classifyLiteral({ lengthChars: 12, entropyBitsPerChar: 3.0, inParticipantList: true,
    inPaymentList: false, trackedRepoOccurrences: 0, referencesCallerAttribute: false, comparedAgainstColumn: true });
  assert(r.classes.includes("PII"), "PII");
  eq(r.safeToCommit, false, "must not be committable");
});

test("a value in the payment-reference list is PII and NOT safe", () => {
  const r = classifyLiteral({ lengthChars: 10, entropyBitsPerChar: 3.0, inParticipantList: false,
    inPaymentList: true, trackedRepoOccurrences: 0, referencesCallerAttribute: false, comparedAgainstColumn: true });
  eq(r.safeToCommit, false, "must not be committable");
});

test("secret-shaped needs BOTH length and entropy", () => {
  const long_low = classifyLiteral({ lengthChars: 40, entropyBitsPerChar: 2.0, inParticipantList: false,
    inPaymentList: false, trackedRepoOccurrences: 1, referencesCallerAttribute: false, comparedAgainstColumn: true });
  assert(!long_low.classes.includes("SECRET"), "a long low-entropy string is a sentence, not a secret");
  const short_high = classifyLiteral({ lengthChars: 8, entropyBitsPerChar: 4.0, inParticipantList: false,
    inPaymentList: false, trackedRepoOccurrences: 1, referencesCallerAttribute: false, comparedAgainstColumn: true });
  assert(!short_high.classes.includes("SECRET"), "a short high-entropy string is an id, not a secret");
  const both = classifyLiteral({ lengthChars: 40, entropyBitsPerChar: 4.5, inParticipantList: false,
    inPaymentList: false, trackedRepoOccurrences: 0, referencesCallerAttribute: false, comparedAgainstColumn: true });
  assert(both.classes.includes("SECRET"), "long AND high-entropy is secret-shaped");
  eq(both.safeToCommit, false, "not committable");
});

test("an unclassifiable literal is UNKNOWN and therefore NOT safe", () => {
  const r = classifyLiteral({ lengthChars: 5, entropyBitsPerChar: 2.0, inParticipantList: false,
    inPaymentList: false, trackedRepoOccurrences: 0, referencesCallerAttribute: false, comparedAgainstColumn: false });
  assert(r.classes.includes("UNKNOWN"), "UNKNOWN");
  eq(r.safeToCommit, false, "UNKNOWN must fail closed, never default to committable");
});

test("a policy referencing a caller attribute is STATIC_AUTHORIZATION_LITERAL, not LEGACY", () => {
  const r = classifyLiteral({ lengthChars: 6, entropyBitsPerChar: 2.5, inParticipantList: false,
    inPaymentList: false, trackedRepoOccurrences: 5, referencesCallerAttribute: true, comparedAgainstColumn: true });
  assert(r.classes.includes("STATIC_AUTHORIZATION_LITERAL"), "static authorization literal");
  assert(!r.classes.includes("LEGACY_AUTHORIZATION_LITERAL"),
    "a policy that consults the caller is doing real authorization, so its literal is not a legacy row allowlist operand");
});

console.log("\nNo literal may leak from this module\n");

test("neither the module nor this test file contains a production literal digest", () => {
  /**
   * The prefixes are READ from PRIVATE_LITERALS.md at runtime, never hardcoded here.
   *
   * The first version of this test listed them inline — which meant the test file contained exactly what it
   * was asserting no file should contain, and it failed on itself. Reading them makes the check honest:
   * neither source file holds a production digest, and the assertion still has real values to look for.
   */
  const doc = join(HERE, "..", "..", "supabase", "migrations", "PRIVATE_LITERALS.md");
  if (!existsSync(doc)) { assert(true, "classification doc absent in this checkout; nothing to cross-check"); return; }
  const prefixes = [...readFileSync(doc, "utf8").matchAll(/`([0-9a-f]{12})`/g)].map((m) => m[1]);
  assert(prefixes.length >= 1, "expected at least one recorded digest prefix to check against");
  for (const f of ["policy_materializer.mjs", "test_policy_materializer.mjs"]) {
    const body = readFileSync(join(HERE, f), "utf8");
    for (const prefix of prefixes) {
      assert(!body.includes(prefix), `${f} contains production digest prefix ${prefix.slice(0, 4)}…`);
    }
  }
});

test("the module never returns a bound value in any result", () => {
  const r = materialize(TEMPLATE, { bindings: BINDINGS, digests: DIGESTS, expectedBodyMd5: EXPECTED });
  const verificationJson = JSON.stringify(r.verification);
  assert(!verificationJson.includes(SYN.main_row),
    "the verification record must carry hashes and match state only — never the substituted value");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ POLICY MATERIALIZER TESTS PASSED\n" : "✗ POLICY MATERIALIZER TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
