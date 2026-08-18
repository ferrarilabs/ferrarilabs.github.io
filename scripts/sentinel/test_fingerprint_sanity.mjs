#!/usr/bin/env node
import { changeIntentStaleFingerprint, REPOSITORY } from "./fingerprint.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nfingerprint.mjs\n");

test("is deterministic: same surface_id always produces the same fingerprint", () => {
  assert(changeIntentStaleFingerprint("SURF") === changeIntentStaleFingerprint("SURF"));
});

test("different surface_ids produce different fingerprints", () => {
  assert(changeIntentStaleFingerprint("SURF_A") !== changeIntentStaleFingerprint("SURF_B"));
});

test("fingerprint format is a stable, greppable string (sha256: prefix)", () => {
  assert(changeIntentStaleFingerprint("SURF").startsWith("sha256:"));
});

test("REPOSITORY constant is set (fingerprint identity includes which repo, not just surface_id)", () => {
  assert(REPOSITORY === "ferrarilabs/ferrarilabs.github.io");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
