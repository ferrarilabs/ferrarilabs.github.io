#!/usr/bin/env node
import { renderStateBlock, upsertStateBlockInBody, parseStateBlock, migrateState, STATE_SCHEMA_VERSION } from "./github_state.mjs";

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); console.log(`  ✓ ${name}`); pass++; } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; } }
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\ngithub_state.mjs\n");

test("round-trip: render then parse recovers the same fields", () => {
  const state = { fingerprint: "sha256:abc", occurrence_count: 3 };
  const body = upsertStateBlockInBody("Human text here.", state);
  const parsed = parseStateBlock(body);
  assert(parsed.fingerprint === "sha256:abc");
  assert(parsed.occurrence_count === 3);
});

test("human-readable body text is preserved untouched around the block", () => {
  const body = upsertStateBlockInBody("Some **markdown** a human wrote.", { fingerprint: "x" });
  assert(body.includes("Some **markdown** a human wrote."), "human prose must survive");
});

test("re-upserting REPLACES the block, does not duplicate it", () => {
  let body = upsertStateBlockInBody("Text.", { fingerprint: "a", occurrence_count: 1 });
  body = upsertStateBlockInBody(body, { fingerprint: "a", occurrence_count: 2 });
  const matches = body.match(/ferrarilabs-sentinel/g) || [];
  assert(matches.length === 1, `expected exactly one marker, found ${matches.length}`);
  assert(parseStateBlock(body).occurrence_count === 2);
});

test("editing text OUTSIDE the block is preserved across a re-upsert", () => {
  let body = upsertStateBlockInBody("Original.", { fingerprint: "a" });
  body = "Original.\n\nA human added this paragraph."; // simulate a human edit, block now gone
  body = upsertStateBlockInBody(body, { fingerprint: "a", occurrence_count: 2 });
  assert(body.includes("A human added this paragraph."), "human addition must survive a re-upsert");
});

test("missing block parses to null — recoverable, not fatal", () => {
  assert(parseStateBlock("Just a normal Issue body, no Sentinel marker.") === null);
});

test("malformed JSON inside the block parses to null, not a throw", () => {
  const body = "<!-- ferrarilabs-sentinel\n{not valid json!!\n-->";
  let threw = false;
  let result;
  try { result = parseStateBlock(body); } catch { threw = true; }
  assert(!threw, "parseStateBlock must never throw on malformed content");
  assert(result === null, "malformed content must parse to null");
});

test("empty body parses to null", () => {
  assert(parseStateBlock("") === null);
  assert(parseStateBlock(null) === null);
  assert(parseStateBlock(undefined) === null);
});

test("only allowlisted fields survive rendering — no accidental raw-data leakage", () => {
  const block = renderStateBlock({ fingerprint: "a", raw_participant_email: "REDACTED_EMAIL", token: "ghp_secret" });
  assert(!block.includes("gmail.com"), "a non-allowlisted field must never reach the rendered block");
  assert(!block.includes("ghp_secret"), "a non-allowlisted field must never reach the rendered block");
});

test("migrateState is additive: unrecognized-but-present fields are preserved", () => {
  const migrated = migrateState({ fingerprint: "a", some_future_field: "kept" });
  assert(migrated.some_future_field === "kept", "migration must not drop fields it doesn't recognize");
  assert(migrated.schema_version === STATE_SCHEMA_VERSION);
});

test("migrateState fills required-but-missing fields with safe defaults, never undefined", () => {
  const migrated = migrateState({ fingerprint: "a" });
  assert(migrated.occurrence_count === 1);
  assert(migrated.clean_cycle_count === 0);
  assert(migrated.recurrence_count === 0);
  assert(typeof migrated.canonical_last_written === "object");
});

test("migrateState(null) returns null rather than throwing", () => {
  assert(migrateState(null) === null);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
