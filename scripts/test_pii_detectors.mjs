#!/usr/bin/env node
/**
 * Tests for the PII / secret detector engine.
 *
 * Two obligations, and the second is the one that was missing before:
 *
 *   1. REGRESSION — each previously-false-positive shape must now be accepted.
 *   2. VACUITY — each detector must be PROVEN to fire. A gate that has never been observed to
 *      fire is indistinguishable from a gate that cannot, and this gate spent a whole batch
 *      reporting RED on its own fixtures while nobody could tell whether it would catch a real
 *      leak.
 *
 * Every leak-shaped value in this file is ASSEMBLED AT RUNTIME from fragments, so no scannable
 * literal exists in the repo. That is why this file needs no fixture declaration of its own for the
 * shapes it tests: the shapes are never written down. The test at the end of the file proves it, by
 * scanning this suite's own source with no exemption of any kind.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  scanContent, scanFiles, classifyValue, isReservedEmail, isSyntheticReference, mask,
  parseDeclarations, DETECTORS, DETECTOR_NAMES, formatReport,
} from "./pii_detectors.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/** Assemble a value from fragments so it never appears as a literal in this repo. */
const j = (...parts) => parts.join("");
const AT = String.fromCharCode(64);
const DASH5 = "-".repeat(5);

const scan = (content) => scanContent(content, { path: "fixture.mjs" });
const detectorsThatFired = (content) => [...new Set(scan(content).findings.map((f) => f.detector))];

// =============================================================================================
console.log("\nVACUITY — every detector must be proven able to fire\n");
// =============================================================================================

/**
 * One live fixture per detector, each assembled at runtime. If any detector cannot be made to fire,
 * it is decoration and this suite says so by name.
 */
const VACUITY_FIXTURES = {
  "email-address": () => `const owner = "${j("realperson", AT, "gmail", ".com")}";`,
  "email-field-literal": () => `{ email: "${j("someone", AT, "realmail", ".net")}" }`,
  "txId-field-literal": () => `{ txId: "${j("A9", "F32K", "8812")}" }`,
  "confirmationId-field-literal": () => `{ confirmationId: "${j("CNF", "99231", "44")}" }`,
  "external-reference-field-literal": () => `{ external_reference: "${j("bank", "ref", "7781")}" }`,
  "zelle-like-tx-id": () => `Zelle transaction ${j("9", "1827", "364501")}`,
  "cashapp-tx-id": () => `Cash App payment ${j("#D", "-", "K9F2M4")}`,
  "venmo-tx-id": () => `Venmo transaction ${j("3", "AB", "123456", "CD", "789012", "Z")}`,
  "url-with-embedded-credential": () => `const dsn = "${j("postgresql://", "user", ":", "hunter2pass", AT, "db.host:5432/x")}";`,
  "service-role-key-value": () => `const k = { service_role: "${j("eyJ", "hbGciOiJIUzI1NiJ9", ".payload")}" };`,
  "private-key-material": () => `${DASH5}${j("BEGIN", " ", "RSA", " ", "PRIVATE", " ", "KEY")}${DASH5}`,
  // Detector portado de main na integracao de 2026-08-12. Montado em pedacos como todos os outros:
  // um serial hex literal neste arquivo faria o proprio gate disparar sobre o suite dele.
  "lottery-ticket-serial": () => `{ serial: "${j("A1B2", "C3D4", "E5F6")}" }`,
};

for (const name of DETECTOR_NAMES) {
  test(`VACUITY: ${name} fires on a real-looking value`, () => {
    const make = VACUITY_FIXTURES[name];
    assert(make, `${name} has no vacuity fixture — nothing proves it can fire`);
    const fired = detectorsThatFired(make());
    assert(fired.includes(name), `${name} did not fire; fired: ${fired.join(", ") || "(nothing)"}`);
  });
}

test("every declared detector has a vacuity fixture", () => {
  for (const n of DETECTOR_NAMES) assert(VACUITY_FIXTURES[n], `${n} has no vacuity fixture`);
  eq(Object.keys(VACUITY_FIXTURES).length, DETECTOR_NAMES.length, "fixture/detector count mismatch");
});

// =============================================================================================
console.log("\nREGRESSION — the shapes that were wrongly failing must now be accepted\n");
// =============================================================================================

test("REGRESSION 1: a synthetic reference prefix is accepted (SYNTH-)", () => {
  const c = `{ external_reference: "${j("SYNTH", "-REF-1")}" }`;
  eq(scan(c).findings.length, 0, "a declared-synthetic reference was reported as a leak");
  assert(isSyntheticReference("SYNTH-REF-1"), "prefix not recognised");
  assert(isSyntheticReference("FIXTURE_001"), "underscore form not recognised");
});

test("REGRESSION 1b: a reference WITHOUT the synthetic prefix still fails", () => {
  const c = `{ external_reference: "${j("ZL", "9928", "31")}" }`;
  assert(scan(c).findings.length > 0, "an unprefixed reference must still be reported — the prefix is the whole control");
});

test("REGRESSION 2: a column type is a schema declaration, not an address", () => {
  const c = `{ tables: { participants: { participant_id: "uuid", email: "text" } } }`;
  eq(scan(c).findings.length, 0, "`email: \"text\"` was read as an email address");
  eq(classifyValue("email-field-literal", "text"), "SCHEMA_DECLARATION", "type not classified");
  eq(classifyValue("email-field-literal", "numeric(14,2)"), "SCHEMA_DECLARATION", "parameterised type not classified");
});

test("REGRESSION 2b: a real address in an email field still fails even near a schema", () => {
  const c = `{ tables: { p: { email: "text" } }, seed: { email: "${j("bob", AT, "realmail", ".org")}" } }`;
  assert(scan(c).findings.length > 0, "a real address next to a schema declaration must still be reported");
});

test("REGRESSION 3: RFC-reserved email domains are accepted", () => {
  for (const dom of ["example.invalid", "example.test", "foo.example", "example.com", "host.localhost"]) {
    const c = `const x = "${j("user", AT, dom)}";`;
    eq(scan(c).findings.length, 0, `${dom} was reported`);
    assert(isReservedEmail(`user${AT}${dom}`), `${dom} not recognised as reserved`);
  }
});

test("REGRESSION 3b: a non-reserved domain still fails", () => {
  assert(!isReservedEmail(j("user", AT, "gmail.com")), "gmail must not be reserved");
  assert(scan(`const x = "${j("user", AT, "gmail", ".com")}";`).findings.length > 0, "a real domain must be reported");
});

test("REGRESSION 4: a reserved secret token in a DSN is accepted", () => {
  const c = `run(["--target-dsn=${j("postgresql://", "postgres.abcdefghijklmnopqrst", ":x", AT, "h:5432/postgres")}"])`;
  eq(scan(c).findings.length, 0, "a DSN whose password is the reserved token 'x' was reported");
});

test("REGRESSION 4b: a DSN with a real-looking password still fails", () => {
  const c = `const dsn = "${j("postgresql://", "u", ":", "Tr0ub4dor3", AT, "h:5432/db")}";`;
  assert(scan(c).findings.length > 0, "a real-looking DSN password must still be reported");
});

test("REGRESSION 5: an already-masked value is accepted", () => {
  eq(classifyValue("email-field-literal", "a****o"), "ALREADY_MASKED", "masked value not recognised");
  eq(scan(`{ email: "a****o" }`).findings.length, 0, "a masked value was reported");
});

test("REGRESSION 6: a repeated-digit number is not a transaction id", () => {
  eq(classifyValue("zelle-like-tx-id", "33333333333"), "RESERVED_SYNTHETIC", "repeated digits not recognised");
});

test("REGRESSION 7: an 11-digit number with no payment context is not reported", () => {
  const n = j("1234", "5678", "901"); // assembled: an 11-digit literal here would trip the scanner
  eq(scan(`const runId = ${n};`).findings.length, 0, "a bare 11-digit number was reported as a payment ref");
  assert(scan(`Zelle ref ${n}`).findings.length > 0, "the same number IN payment context must be reported");
});

test("REGRESSION 8: the bare word service_role is a policy term, not a leak", () => {
  eq(scan(`Never use the service_role key from the browser.`).findings.length, 0, "the policy term was reported");
});

test("REGRESSION 10: a non-address value in an email field is not a leaked address", () => {
  eq(scan(`{ outer: { inner: { email: "x" } } }`).findings.length, 0,
    "a one-character value in an email field was reported as a leaked address");
  eq(classifyValue("email-field-literal", "x"), "NOT_ADDRESS_SHAPED", "shape check missing");
  eq(classifyValue("email-field-literal", "not an email at all"), "NOT_ADDRESS_SHAPED", "prose accepted as address");
});

test("REGRESSION 10b: an address-shaped value in an email field still fails", () => {
  const c = `{ email: "${j("p", AT, "realmail", ".co", ".uk")}" }`;
  assert(scan(c).findings.length > 0, "a real address-shaped value must still be reported");
});

test("REGRESSION 9: a variable or template reference is not a literal", () => {
  eq(scan("{ email: process.env.ADMIN_EMAIL }").findings.length, 0, "a variable reference was reported");
  eq(scan("{ email: `${user}@${domain}` }").findings.length, 0, "a template was reported");
});

// =============================================================================================
console.log("\nPER-DETECTOR FIXTURE DECLARATIONS — scoped, reasoned, and self-expiring\n");
// =============================================================================================

const PEM = `${DASH5}${j("BEGIN", " ", "RSA", " ", "PRIVATE", " ", "KEY")}${DASH5}`;

test("a declaration suppresses only its own detector", () => {
  const c = `// ${j("@pii", "-fixture")} private-key-material — proves the redactor catches a PEM header\n` +
    `const KEY = "${PEM}";`;
  const r = scan(c);
  eq(r.findings.length, 0, "the declared detector was still reported");
  eq(r.declarationErrors.length, 0, "declaration rejected");
});

test("NEGATIVE: a declaration does NOT suppress a different detector", () => {
  const c = `// ${j("@pii", "-fixture")} private-key-material — proves the redactor catches a PEM header\n` +
    `const KEY = "${PEM}";\n` +
    `const owner = "${j("real", AT, "gmail", ".com")}";`;
  const r = scan(c);
  eq(r.findings.length, 1, "a file excused for PEM fixtures must still fail on a leaked email");
  eq(r.findings[0].detector, "email-address", "wrong detector reported");
});

test("NEGATIVE: a declaration with no usable reason is rejected", () => {
  const c = `// ${j("@pii", "-fixture")} private-key-material\nconst K = "${PEM}";`;
  const r = scan(c);
  assert(r.declarationErrors.some((e) => /no usable reason/.test(e.message)),
    "a permission without a reason cannot be reviewed and must be rejected");
});

test("NEGATIVE: a declaration naming an unknown detector is reported, not silently ignored", () => {
  const c = `// ${j("@pii", "-fixture")} privat-key-materail — a typo in the detector name here`;
  const r = scan(c);
  assert(r.declarationErrors.some((e) => /unknown detector/.test(e.message)),
    "a typo would silently disable nothing and leave the author believing it worked");
});

test("NEGATIVE: a stale declaration whose detector never fires is reported", () => {
  const c = `// ${j("@pii", "-fixture")} private-key-material — the fixture this excused has been deleted\n` +
    `const nothing = 1;`;
  const r = scan(c);
  eq(r.unusedDeclarations.length, 1, "a stale declaration must be reported so permissions shrink");
  eq(r.unusedDeclarations[0].detector, "private-key-material", "wrong detector");
});

test("a stale declaration fails the whole run", () => {
  const r = scanFiles(["a.mjs"], () => `// ${j("@pii", "-fixture")} private-key-material — nothing matches this any more`);
  eq(r.ok, false, "a stale declaration must fail the gate, not merely warn");
});

test("parseDeclarations accepts em-dash, colon and hyphen separators", () => {
  for (const sep of ["—", ":", "-"]) {
    const { declared, errors } = parseDeclarations(`${j("@pii", "-fixture")} email-address ${sep} a sufficiently long reason`);
    eq(errors.length, 0, `separator ${sep} rejected: ${errors.map((e) => e).join()}`);
    eq(declared.size, 1, `separator ${sep} not parsed`);
  }
});

// =============================================================================================
console.log("\nVALUES ARE NEVER PRINTED\n");
// =============================================================================================

// O contrato de `mask` ENDURECEU na integracao cross-workstream de 2026-08-12. A forma antiga
// ("a******h (len 8)") revelava o primeiro e o ultimo caractere — divulgacao parcial real para um
// endereco curto ou um ID de transacao, e essa saida vai parar em log de CI. A forma de main
// substitui isso por um digest sha256 curto: correlaciona dois achados e confirma uma correcao sem
// revelar caractere nenhum. Estes asserts foram reescritos para o contrato mais forte, nao
// afrouxados — `scripts/test_audit_pii_repo_wide.mjs` tranca a mesma propriedade do outro lado.
test("mask never reveals ANY character of a value", () => {
  const v = "abcdefgh";
  const m = mask(v);
  assert(/^<redacted sha256:[0-9a-f]{8} len:8>$/.test(m), `mask shape: got ${m}`);
  // Um caractere isolado nao prova vazamento: o proprio molde ("<redacted sha256: len:>") contem
  // letras, e o digest e hex. O que prova vazamento e um PEDACO do valor sobreviver. Nenhuma
  // substring de 2+ caracteres do valor pode aparecer na mascara.
  const digest = m.slice(m.indexOf(":") + 1, m.indexOf(" len:"));
  for (let i = 0; i + 2 <= v.length; i++) {
    assert(!digest.includes(v.slice(i, i + 2)), `mask leaked the fragment "${v.slice(i, i + 2)}"`);
  }
  eq(mask("ab"), `<redacted sha256:${createHash("sha256").update("ab").digest("hex").slice(0, 8)} len:2>`,
    "two-char value is digested, not starred");
  eq(mask(""), "(empty)", "empty");
  assert(mask("a") !== "a", "one-char value must never pass through");
});

test("a report contains the masked preview and never the raw value", () => {
  const secret = j("verysecret", AT, "realmail", ".com");
  const r = scanFiles(["f.mjs"], () => `const a = "${secret}";`);
  const out = formatReport(r);
  assert(!out.includes(secret), "the report printed the raw value");
  assert(out.includes("f.mjs"), "the report must name the file");
  assert(out.includes("email-address"), "the report must name the detector");
  assert(/len:\d+/.test(out), "the report must give a masked preview");
  assert(/<redacted sha256:[0-9a-f]{8} len:\d+>/.test(out),
    "the preview must be the digest form, never the first/last-character form");
});

test("no interior substring of a long value survives into the report", () => {
  const secret = j("abcdefghij", AT, "klmnopqrs", ".com");
  const out = formatReport(scanFiles(["f.mjs"], () => `x = "${secret}"`));
  for (let i = 0; i + 4 <= secret.length - 1; i++) {
    const frag = secret.slice(i + 1, i + 5); // any 4 chars not touching the first character
    if (frag.length < 4) continue;
    assert(!out.includes(frag), `the report leaked the fragment at ${i}`);
  }
});

// =============================================================================================
console.log("\nSCANNER MECHANICS\n");
// =============================================================================================

test("the binary heuristic uses a NUL byte, not whitespace", () => {
  // The original of this check compared against a literal NUL that had been corrupted into a space,
  // which would have skipped every text file in the repo and turned the gate permanently green.
  const withNul = `const a = "x";${String.fromCharCode(0)}more`;
  const r = scanFiles(["bin.dat"], () => withNul);
  eq(r.scanned, 0, "a NUL-containing file must be skipped as binary");
  const plain = `const a = "hello world with spaces";`;
  eq(scanFiles(["ok.mjs"], () => plain).scanned, 1, "a file with spaces must NOT be skipped");
});

test("this file's own source contains no scannable literal", () => {
  // Every leak-shaped value here is assembled at runtime, so the engine finds nothing in it even
  // when it is scanned as an ordinary file with no declaration and no detector-source exemption.
  const self = new URL(import.meta.url).pathname;
  const content = readFileSync(self, "utf8");
  const r = scanContent(content, { path: "test_pii_detectors.mjs", isDetectorSource: false });
  eq(r.findings.length, 0, `this suite would trip the scanner: ${r.findings.map((f) => f.detector).join(", ")}`);
  eq(r.declarationErrors.length, 0, "this suite has a malformed declaration");
});

test("an unreadable file is skipped rather than crashing the run", () => {
  const r = scanFiles(["gone.mjs"], () => { throw new Error("ENOENT"); });
  eq(r.scanned, 0, "scanned");
  eq(r.ok, true, "an unreadable file must not fail the gate");
});

test("a clean repo reports ok with a count of accepted values", () => {
  const r = scanFiles(["a.mjs", "b.mjs"], () => `const x = "${j("u", AT, "example.invalid")}";`);
  eq(r.ok, true, "clean scan");
  eq(r.scanned, 2, "scanned count");
  assert(r.suppressed >= 2, "accepted values must be counted so the scanner's leniency is auditable");
  assert(/0 findings/.test(formatReport(r)), "report shape");
});

test("findings are grouped by (file, detector) with a count", () => {
  const bad = j("a", AT, "realmail", ".com");
  const r = scanFiles(["f.mjs"], () => `x="${bad}"; y="${bad}";`);
  const out = formatReport(r);
  assert(/count=2/.test(out), "duplicate findings in one file must be grouped with a count");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions\n`);
console.log(fail === 0 ? "✓ PII DETECTOR TESTS PASSED\n" : "✗ PII DETECTOR TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
