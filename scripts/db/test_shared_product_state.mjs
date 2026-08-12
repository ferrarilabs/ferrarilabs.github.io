#!/usr/bin/env node
/**
 * Tests for SHARED_PRODUCT_STATE (PRODMIG-Q4).
 *
 * The property: a football operation cannot touch Powerball rows and vice versa. Both directions are
 * asserted, because a control that only guards one direction guards nothing — the table is shared, so
 * either product can damage the other.
 */
import { SHARED_RELATIONS, isShared, scopeValues, scopeViolations, scopeFingerprintSql, foreignScopeChanged }
  from "./shared_product_state.mjs";
let pass = 0, fail = 0;
const test = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log("\nThe shared relation is declared from production evidence\n");
test("bolao_notif_jobs is SHARED_PRODUCT_STATE with a measured two-product split", () => {
  assert(isShared("bolao_notif_jobs"), "the table proven to hold both products' rows must be declared shared");
  const r = SHARED_RELATIONS.find((x) => x.relation === "bolao_notif_jobs");
  eq(r.scopeColumn, "pool_id", "the separating column");
  eq(r.measured.powerball, 4, "4 Powerball rows measured in production 2026-08-11");
  eq(r.measured.br2026, 20, "20 football rows");
  assert(scopeValues("bolao_notif_jobs", "POWERBALL").includes("powerball"), "Powerball scope");
  assert(scopeValues("bolao_notif_jobs", "FOOTBALL").includes("br2026"), "football scope");
  eq(scopeValues("bolao_notif_jobs", "NOT_A_PRODUCT"), null, "an unknown product must return null, never an empty list that reads as 'no scope needed'");
});

console.log("\nBoth directions of the cross-product hazard\n");
test("a FOOTBALL operation with no scope is refused", () => {
  const v = scopeViolations("bolao_notif_jobs", "DELETE FROM bolao_notif_jobs WHERE status = 'sent'", "FOOTBALL");
  assert(v.length === 1 && /does not constrain pool_id/.test(v[0]),
    `unscoped housekeeping would take Powerball's delivery history with it: ${JSON.stringify(v)}`);
});
test("a FOOTBALL operation touching a Powerball scope is refused", () => {
  const v = scopeViolations("bolao_notif_jobs", "UPDATE bolao_notif_jobs SET status='x' WHERE pool_id IN ('br2026','powerball')", "FOOTBALL");
  assert(v.some((m) => /belongs to another product/.test(m)), `a football statement naming 'powerball' must be caught: ${JSON.stringify(v)}`);
});
test("a POWERBALL operation touching a football scope is refused — the mirror case", () => {
  const v = scopeViolations("bolao_notif_jobs", "DELETE FROM bolao_notif_jobs WHERE pool_id = 'br2026'", "POWERBALL");
  assert(v.some((m) => /belongs to another product/.test(m)), `the reverse direction must be guarded too: ${JSON.stringify(v)}`);
});
test("TRUNCATE is refused outright — it cannot be scoped", () => {
  const v = scopeViolations("bolao_notif_jobs", "TRUNCATE TABLE bolao_notif_jobs", "FOOTBALL");
  assert(v.length === 1 && /cannot be product-scoped at all/.test(v[0]), "TRUNCATE has no WHERE clause to scope");
});
test("a correctly scoped operation passes, in both directions", () => {
  eq(scopeViolations("bolao_notif_jobs", "UPDATE bolao_notif_jobs SET status='x' WHERE pool_id = 'br2026'", "FOOTBALL").length, 0, "football scoped to football");
  eq(scopeViolations("bolao_notif_jobs", "UPDATE bolao_notif_jobs SET status='x' WHERE pool_id = 'powerball'", "POWERBALL").length, 0, "powerball scoped to powerball");
});
test("reads are not constrained, and unrelated tables are ignored", () => {
  eq(scopeViolations("bolao_notif_jobs", "SELECT count(*) FROM bolao_notif_jobs", "FOOTBALL").length, 0, "a read cannot damage another product");
  eq(scopeViolations("bolao_notif_jobs", "DELETE FROM bolao_state WHERE id='main'", "FOOTBALL").length, 0, "a statement not touching the shared table is out of scope");
});

console.log("\nPre/post fingerprints prove the other product did not move\n");
test("the fingerprint query groups by scope and digests rather than exposing rows", () => {
  const sql = scopeFingerprintSql("bolao_notif_jobs");
  assert(/GROUP BY pool_id/.test(sql) && /md5\(/.test(sql), "counts and a digest per scope");
  assert(!/SELECT \*/.test(sql), "row content must never be selected");
});
test("ANTI-VACUITY — a change in the FOREIGN scope is detected, and in the operating scope is not", () => {
  const before = [["br2026", 20, "d1"], ["powerball", 4, "d2"]];
  eq(foreignScopeChanged(before, before, "FOOTBALL").length, 0, "nothing changed");
  // Operating scope may legitimately change.
  eq(foreignScopeChanged(before, [["br2026", 19, "d9"], ["powerball", 4, "d2"]], "FOOTBALL").length, 0,
    "the product being operated on is allowed to change; flagging it would make the control unusable");
  // Foreign scope must not.
  assert(foreignScopeChanged(before, [["br2026", 20, "d1"], ["powerball", 3, "d3"]], "FOOTBALL").some((m) => /changed/.test(m)),
    "a football operation that altered Powerball rows must be caught");
  assert(foreignScopeChanged(before, [["br2026", 20, "d1"]], "FOOTBALL").some((m) => /disappeared/.test(m)),
    "a vanished foreign scope must be caught");
  assert(foreignScopeChanged(before, [...before, ["cdb2026", 1, "d4"]], "POWERBALL").some((m) => /appeared/.test(m)),
    "a foreign scope appearing during a Powerball operation must be caught");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ SHARED PRODUCT STATE TESTS PASSED\n" : "✗ SHARED PRODUCT STATE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
