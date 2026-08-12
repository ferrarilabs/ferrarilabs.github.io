#!/usr/bin/env node
/**
 * Promotion / drift-classification guard tests.
 *
 * WHY THIS FILE EXISTS. `promote_expand_stage.mjs --check` is what proves a file that production has
 * already executed still matches the generator that produced it. Until now it had NO test suite and
 * `gates.mjs` never invoked it — it lived only as a hand-typed step in the resume document. That is the
 * exact shape of a check that gets skipped on the sixth repetition, and it duly was: a comment-only
 * divergence in M14 sat unreported through a full "50/50 gates pass" run.
 *
 * WHAT IT IS GUARDING AGAINST. `classifyDrift()` deliberately does NOT fail on a comment-only difference,
 * because a promoted file is frozen the moment it is applied — `q8_make_ledger_record.mjs` embeds its body
 * VERBATIM into the production ledger row, comments included — while the generator legitimately keeps
 * improving its commentary. Rewriting an applied file to chase a comment would make the repository
 * disagree with what production recorded.
 *
 * That relaxation is only safe if it cannot be used to smuggle anything through. The load-bearing case is
 * the fourth test below: a `--` line INSIDE a dollar-quoted function body is NOT a comment. It lands in
 * `prosrc` verbatim, so changing it changes a real object in the database. A comment-stripper that cannot
 * tell those apart would hide a modified SECURITY DEFINER function behind the word "comment".
 */
import { classifyDrift, checkPromoted } from "./promote_expand_stage.mjs";

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nPromotion — drift classification guard tests\n");

// A fixture shaped like a real promoted stage: a header comment, DDL, and a function whose body contains
// a line that LOOKS like a comment but is part of the stored source.
const BASE = [
  "-- header comment",
  "CREATE TABLE audit.migration_lineage (id uuid);",
  "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$",
  "-- this line is INSIDE the function body and lands in prosrc",
  "BEGIN RETURN 1; END;",
  "$fn$;",
].join("\n");

const kind = (mutated) => classifyDrift(BASE, mutated).kind;

test("an unchanged file is IDENTICAL", () => {
  assert(kind(BASE) === "IDENTICAL", `got ${kind(BASE)}`);
});

test("a changed comment OUTSIDE any dollar quote is COMMENT_ONLY, not a failure", () => {
  const m = BASE.replace("-- header comment", "-- header comment v2");
  assert(kind(m) === "COMMENT_ONLY", `got ${kind(m)}`);
});

test("changed DDL is DRIFTED", () => {
  const m = BASE.replace("id uuid", "id text");
  assert(kind(m) === "DRIFTED", `got ${kind(m)}`);
});

// THE ONE THAT MATTERS. If this ever regresses, a modified function body can be waved through as a comment.
test("a `--` line INSIDE a function body is NOT a comment — changing it is DRIFTED", () => {
  const m = BASE.replace("-- this line is INSIDE the function body and lands in prosrc", "-- tampered");
  assert(kind(m) === "DRIFTED", `got ${kind(m)} — a stored function body was classified as a comment`);
});

test("an added statement is DRIFTED even though the added line is not a comment change", () => {
  assert(kind(BASE + "\nDROP TABLE x;") === "DRIFTED", "an appended statement was not caught");
});

test("a comment replaced BY a grant is DRIFTED, not COMMENT_ONLY", () => {
  const m = BASE.replace("-- header comment", "GRANT ALL ON SCHEMA audit TO anon;");
  assert(kind(m) === "DRIFTED", `got ${kind(m)} — a GRANT hid where a comment used to be`);
});

test("a widened CREATE is DRIFTED", () => {
  const m = BASE.replace("CREATE TABLE", "CREATE UNLOGGED TABLE");
  assert(kind(m) === "DRIFTED", `got ${kind(m)}`);
});

test("an unbalanced dollar quote refuses to classify rather than guessing", () => {
  const truncated = BASE.replace("$fn$;", "");
  assert(classifyDrift(truncated, truncated + "\n-- x").kind === "DRIFTED",
    "an unbalanced dollar quote must fail closed — the scanner cannot know what is inside a body");
});

// ── the live repository, not a fixture ───────────────────────────────────────
test("every promoted EXPAND stage still matches the generator EXECUTABLY", () => {
  const r = checkPromoted();
  assert(r.length > 0, "no promoted stage found — the check would pass vacuously");
  const drifted = r.filter((x) => !x.ok);
  assert(drifted.length === 0,
    `executable drift in: ${drifted.map((d) => `${d.name} (${d.why})`).join("; ")}`);
});

test("every promoted stage is accounted for as IDENTICAL or COMMENT_ONLY — never unclassified", () => {
  for (const x of checkPromoted()) {
    assert(["IDENTICAL", "COMMENT_ONLY", "DRIFTED"].includes(x.kind), `${x.name} has kind ${x.kind}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ PROMOTION GUARD TESTS FAILED"); process.exit(1); }
console.log("\n✓ PROMOTION GUARD TESTS PASSED");
