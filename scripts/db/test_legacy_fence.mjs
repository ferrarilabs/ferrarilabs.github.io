#!/usr/bin/env node
/**
 * Tests for the legacy write fence (WS5-F4).
 *
 * These are the properties that can be checked without a database: the SQL says what the choreography
 * fixed, the verifier's verdicts fire, and — the load-bearing part — every verdict is shown to be
 * reachable by feeding it the catalog state that should trigger it. A verifier that reports clean
 * against a correct state proves nothing about whether it would report an incorrect one.
 *
 * The proof that the fence actually stops a write on real PostgreSQL lives in the campaign lab.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LEGACY_SCHEMA, LEGACY_TABLES, WRITE_PRIVILEGES, PRESERVED_PRIVILEGES, FENCED_ROLES, UNFENCED_ROLES,
  renderFenceSql, renderFenceRollbackSql, fenceVerifySql, fenceFailures, unfencedExposure, PHASE,
  ORPHAN_PRIVILEGES, renderOrphanRevokeSql, renderOrphanRevokeRollbackSql, legacyAclSql, orphanRevokeFailures,
  MEASURED_ORPHAN_ACL, MEASURED_PRODUCTION_PRIVILEGES, expectedAfterFence, productionDrift, TABLE_ROLES,
  LEGACY_VIEWS, LEGACY_RELATIONS,
} from "./legacy_fence.mjs";
import { stripSqlNoise } from "./migration_harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/** A catalog read in which nothing has been fenced yet: every role holds full CRUD everywhere. */
const openRow = (relname, rolname) => [relname, rolname, "t", "t", "t", "t"];
const OPEN = LEGACY_RELATIONS.flatMap((t) => ["anon", "authenticated", "service_role"].map((r) => openRow(t.name, r)));
/** The same, with the fence correctly closed on the document only. */
const FENCED_NAMES = new Set(LEGACY_RELATIONS.filter((t) => t.fenced).map((t) => t.name));
const FENCED = OPEN.map((r) =>
  (FENCED_NAMES.has(r[0]) && FENCED_ROLES.includes(r[1])) ? [r[0], r[1], "t", "f", "f", "f"] : r);

console.log("\nWS5-F4 — the fence says what the choreography fixed\n");

test("the fence revokes named privileges — never a wildcard, never REVOKE ALL", () => {
  const sql = renderFenceSql();
  /**
   * Over the CODE, not the prose. The header explains that the fence does not use REVOKE ALL, and the
   * first version of this assertion matched that sentence and failed — the test reading a comment as a
   * statement is the same class of mistake test_migration_drafts already records for `stripSqlNoise`.
   */
  const code = stripSqlNoise(sql);
  assert(!/REVOKE\s+ALL/i.test(code), "REVOKE ALL is forbidden by the choreography's ACL rule and would take SELECT with it");
  assert(!/ON\s+ALL\s+TABLES/i.test(code), "a schema wildcard would fence the six Powerball tables this migration does not own");
  const stmts = [...sql.matchAll(/^REVOKE ([A-Z, ]+) ON TABLE ([\w.]+) FROM (\w+);$/gm)];
  const fencedRels = LEGACY_RELATIONS.filter((t) => t.fenced);
  eq(stmts.length, FENCED_ROLES.length * fencedRels.length,
    `expected one REVOKE per (fenced relation, fenced role), found ${stmts.length}`);
  for (const m of stmts) {
    eq(m[1].trim(), WRITE_PRIVILEGES.join(", "), "the privilege list must be exactly the write set");
    assert(fencedRels.some((t) => m[2] === `${LEGACY_SCHEMA}.${t.name}`),
      `${m[2]} is fenced and is not a fenced relation — KPLUS-F058 widened this to the subject AND its views, not to anything else`);
    assert(FENCED_ROLES.includes(m[3]), `${m[3]} is not a fenced role`);
  }
  // KPLUS-F058: the views MUST be here. Without them the fence is bypassable and its verifier blind.
  for (const v of LEGACY_VIEWS) {
    assert(stmts.some((m) => m[2] === `${LEGACY_SCHEMA}.${v.name}`),
      `${v.name} is not fenced — anon writes through it reach bolao_state, proven by NIGHT-27`);
  }
});

test("the fence never touches SELECT — step 11 precedes the read cutover at step 13", () => {
  const sql = renderFenceSql();
  for (const p of PRESERVED_PRIVILEGES) {
    assert(!new RegExp(`REVOKE[^;]*\\b${p}\\b`, "i").test(sql),
      `the fence revokes ${p}; the application still reads the legacy document after step 11, so that is a read outage`);
  }
});

test("the fence never touches policies, and never touches service_role", () => {
  const sql = renderFenceSql();
  assert(!/DROP\s+POLICY|ALTER\s+POLICY|CREATE\s+POLICY/i.test(sql),
    "legacy policies are not modified while any client still reads the document — and a dropped policy cannot be restored without re-authoring it");
  assert(!/ROW LEVEL SECURITY/i.test(sql), "the fence is a privilege denial, not an RLS change");
  assert(!/\bservice_role\b/i.test(stripSqlNoise(sql)),
    "service_role mirrors into the legacy document until step 19 and must not be fenced");
  for (const u of UNFENCED_ROLES) assert(u.why.length > 20, `${u.role} is excluded with no stated reason`);
});

test("the rollback restores exactly what the fence removed, and nothing else", () => {
  const revoked = [...renderFenceSql().matchAll(/^REVOKE ([A-Z, ]+) ON TABLE ([\w.]+) FROM (\w+);$/gm)]
    .map((m) => `${m[1]}|${m[2]}|${m[3]}`).sort();
  const granted = [...renderFenceRollbackSql().matchAll(/^GRANT ([A-Z, ]+) ON TABLE ([\w.]+) TO (\w+);$/gm)]
    .map((m) => `${m[1]}|${m[2]}|${m[3]}`).sort();
  eq(JSON.stringify(granted), JSON.stringify(revoked),
    "a rollback that grants a privilege the fence did not take ends the cutover with the browser holding more than it started with");
  assert(granted.length > 0, "the rollback is empty");
});

test("the fence states its preconditions, because applying it early is a write outage", () => {
  const sql = renderFenceSql();
  for (const [what, re] of [
    ["the replacement write path being live", /server_writes_enabled|SERVER_WRITE_PRIMARY/],
    ["the stale-client refusal being proven distinguishable", /CLIENT_TOO_OLD|minimum_write_version|staleClientFenceReady/],
    ["the flag not being the fence", /FS-4|NOT the fence/],
  ]) assert(re.test(sql), `the fence does not state ${what}`);
});

console.log("\nThe legacy table set is closed, not guessed\n");

test("the ten legacy tables are enumerated, with exactly one fenced (KPLUS-F055)", () => {
  eq(LEGACY_TABLES.length, 10, "public holds ten tables in PRODUCTION, measured 2026-08-11 — not the seven the restored baseline had");
  const fenced = LEGACY_TABLES.filter((t) => t.fenced);
  eq(fenced.length, 1, "only the migration subject is fenced");
  eq(fenced[0].name, "bolao_state", "the migration subject is the bolão document");
  for (const t of LEGACY_TABLES) {
    assert(t.why && t.why.length > 10, `${t.name} has no stated reason`);
    assert(t.product, `${t.name} has no product classification — the orphan proposal selects by product now`);
  }
});

test("KPLUS-F055/F058 — the model matches the measured production surface exactly, in both directions", () => {
  const modelled = new Set(LEGACY_RELATIONS.map((t) => t.name));
  const measured = new Set(MEASURED_PRODUCTION_PRIVILEGES.map((r) => r[0]));
  for (const n of measured) assert(modelled.has(n), `${n} was measured in production and is not in LEGACY_RELATIONS — this is exactly the F055 failure`);
  for (const n of modelled) assert(measured.has(n), `${n} is modelled and was not measured in production — the model is describing something that is not there`);
});

test("KPLUS-F055 REGRESSION CONTROL — the pre-fix seven-table model FAILS against the real production read", () => {
  // The model as it stood before this fix. If someone reverts LEGACY_TABLES to the restored-baseline
  // seven, the production read must once again be rejected — that is the property being locked in.
  const preFix = ["bolao_state", "lottery_admin_audit", "lottery_draws", "lottery_participants",
    "lottery_participations", "lottery_payment_transactions", "lottery_pools"];
  const unmodelled = [...new Set(MEASURED_PRODUCTION_PRIVILEGES.map((r) => r[0]))].filter((n) => !preFix.includes(n));
  eq(unmodelled.length, 5, "the pre-fix model was blind to three tables (F055) and two views (F058)");
  eq(unmodelled.sort().join(","), "bolao_entry_private,bolao_notif_jobs,bolao_state_public,bolao_state_public_cdb,live_sports_cache",
    "three tables and the two views every relkind='r' probe could not see");

  // And the verifier must be what reports them, not a human reading a diff.
  const failures = fenceFailures(MEASURED_PRODUCTION_PRIVILEGES.filter((r) => preFix.includes(r[0]) || unmodelled.includes(r[0])), PHASE.BEFORE);
  const reported = unmodelled.filter((n) => failures.some((f) => f.includes(n)));
  eq(reported.length, 0, "with the tables now modelled, the verifier is clean — the failure is only reachable via the pre-fix list");
});

test("KPLUS-F057 — every table carries a role from the closed vocabulary", () => {
  for (const t of LEGACY_TABLES) {
    assert(TABLE_ROLES.includes(t.role), `${t.name} has role ${t.role}, which is not in the closed vocabulary`);
  }
  // The vocabulary must be able to say "this needs a decision", or classifications become guesses.
  assert(TABLE_ROLES.includes("DEFERRED_WITH_REASON"), "a vocabulary with no deferral forces a wrong answer where none is known");
  assert(LEGACY_TABLES.some((t) => t.role === "DEFERRED_WITH_REASON"), "bolao_notif_jobs overlaps the M9 outbox and is genuinely undecided");
});

test("KPLUS-F057 — provenance is RECORDED for the drifted tables, and never invented", () => {
  const drifted = ["bolao_entry_private", "bolao_notif_jobs", "live_sports_cache"];
  for (const name of drifted) {
    const t = LEGACY_TABLES.find((x) => x.name === name);
    assert(t.origin && /main [0-9a-f]{7}/.test(t.origin),
      `${name} must record the commit on main that created it — the earlier "no provenance" reading came from searching the working tree instead of git log --all`);
  }
  // live_sports_cache is the honest case: origin known, DDL genuinely absent from version control.
  const cache = LEGACY_TABLES.find((t) => t.name === "live_sports_cache");
  assert(/DDL is in NO file in version control/.test(cache.origin),
    "where the DDL does not exist, that must be stated rather than reconstructed");
});

test("KPLUS-F057 — the three drifted tables are NOT silently fenced or silently targeted", () => {
  for (const name of ["bolao_entry_private", "bolao_notif_jobs", "live_sports_cache"]) {
    const t = LEGACY_TABLES.find((x) => x.name === name);
    assert(!t.fenced, `${name} must not be swept into the cutover fence — the fence covers the migration subject`);
    assert(t.why.length > 80, `${name} must record WHY it is classified as it is`);
  }
  // TARGET_ENTITY is a classification, not a migration: it must not have become a fenced subject.
  const priv = LEGACY_TABLES.find((t) => t.name === "bolao_entry_private");
  eq(priv.role, "TARGET_ENTITY", "its attributes are exactly what M2/M4 model");
  assert(/NOT added to the normalized target/.test(priv.why), "classifying is not migrating, and the distinction must be written down");
});

test("KPLUS-F055 — the AFTER matrix is derived from the measured BEFORE, and touches only the subject", () => {
  const after = expectedAfterFence();
  eq(after.length, MEASURED_PRODUCTION_PRIVILEGES.length, "deriving must not add or drop rows");
  for (const [name, role, sel, ins, upd, del] of after) {
    const before = MEASURED_PRODUCTION_PRIVILEGES.find((r) => r[0] === name && r[1] === role);
    const rel = LEGACY_RELATIONS.find((x) => x.name === name);
    if (rel && rel.fenced && FENCED_ROLES.includes(role)) {
      eq(`${ins}${upd}${del}`, "fff", `${role} still holds writes on ${name}, which is fenced`);
      eq(sel, "t", `${role} lost SELECT on ${name} — the app reads the document AND its public projections until step 13`);
    } else {
      eq(`${sel}${ins}${upd}${del}`, before.slice(2).join(""), `${name}/${role} changed and the fence has no business changing it`);
    }
  }
  // The trusted write path must survive the fence — this is the "prove service_role stays usable" check.
  const sr = after.find((r) => r[0] === "bolao_state" && r[1] === "service_role");
  eq(sr.slice(2).join(""), "tttt", "service_role must keep mirroring into the document until step 19");
  eq(fenceFailures(after, PHASE.AFTER).length, 0, `the derived AFTER state must verify clean: ${fenceFailures(after, PHASE.AFTER).join(" · ")}`);
});

test("KPLUS-F055 — the fence's rollback returns production to the EXACT measured prior state", () => {
  const after = expectedAfterFence();
  // Apply the generated rollback (GRANT per table/role) to the AFTER state and require BEFORE back.
  const grants = [...renderFenceRollbackSql().matchAll(/^GRANT ([A-Z, ]+) ON TABLE ([\w.]+) TO (\w+);$/gm)]
    .map((m) => ({ privs: m[1].split(",").map((s) => s.trim()), table: m[2].replace(/^public\./, ""), role: m[3] }));
  const rolledBack = after.map(([name, role, sel, ins, upd, del]) => {
    const g = grants.find((x) => x.table === name && x.role === role);
    if (!g) return [name, role, sel, ins, upd, del];
    return [name, role, sel, g.privs.includes("INSERT") ? "t" : ins, g.privs.includes("UPDATE") ? "t" : upd, g.privs.includes("DELETE") ? "t" : del];
  });
  eq(JSON.stringify(rolledBack), JSON.stringify(MEASURED_PRODUCTION_PRIVILEGES.map((r) => [...r])),
    "rollback must reproduce the measured production matrix exactly — not approximately, and not with extra privileges");
});

test("KPLUS-F055 MUTATION CONTROL — drift in production is detected, in both directions", () => {
  eq(productionDrift(MEASURED_PRODUCTION_PRIVILEGES).length, 0, "the measured matrix must not drift from itself");
  // A new grant appearing on the document.
  const widened = MEASURED_PRODUCTION_PRIVILEGES.map((r) =>
    r[0] === "live_sports_cache" && r[1] === "anon" ? [r[0], r[1], "t", "t", "t", "t"] : [...r]);
  assert(productionDrift(widened).some((f) => /live_sports_cache/.test(f)), "a widened grant must be reported");
  // An eleventh table appearing — the F055 failure happening again.
  const grown = [...MEASURED_PRODUCTION_PRIVILEGES.map((r) => [...r]), ["bolao_new_thing", "anon", "t", "t", "t", "t"]];
  assert(productionDrift(grown).some((f) => /bolao_new_thing/.test(f)), "a new table must be reported as growth of the legacy surface");
  // A table disappearing.
  const shrunk = MEASURED_PRODUCTION_PRIVILEGES.filter((r) => r[0] !== "bolao_notif_jobs").map((r) => [...r]);
  assert(productionDrift(shrunk).some((f) => /bolao_notif_jobs/.test(f)), "a vanished table must be reported");
  assert(productionDrift([]).length === 1, "an empty read must refuse to assess drift rather than report clean");
});

console.log("\nThe verifier — and every verdict can fire\n");

test("a correctly fenced catalog verifies clean AFTER, and the open one verifies clean BEFORE", () => {
  eq(fenceFailures(FENCED, PHASE.AFTER).length, 0, `expected clean: ${fenceFailures(FENCED, PHASE.AFTER).join(" · ")}`);
  eq(fenceFailures(OPEN, PHASE.BEFORE).length, 0, `expected clean: ${fenceFailures(OPEN, PHASE.BEFORE).join(" · ")}`);
});

test("ANTI-VACUITY — an unclosed fence is detected", () => {
  const f = fenceFailures(OPEN, PHASE.AFTER);
  assert(f.some((m) => /still holds .*on public\.bolao_state — the fence did not close/.test(m)),
    `an entirely unapplied fence must be caught, got: ${f.join(" · ") || "nothing"}`);
});

test("ANTI-VACUITY — a PARTIALLY closed fence is detected", () => {
  // anon fenced, authenticated forgotten. This is why the fence emits one statement per role.
  // Fence anon everywhere it should be fenced (subject AND views), and forget authenticated entirely.
  const half = OPEN.map((r) => (FENCED_NAMES.has(r[0]) && r[1] === "anon") ? [r[0], r[1], "t", "f", "f", "f"] : r);
  const f = fenceFailures(half, PHASE.AFTER);
  assert(f.some((m) => /^authenticated still holds/.test(m)), `a half-applied fence must be caught, got: ${f.join(" · ")}`);
  assert(!f.some((m) => /^anon still holds/.test(m)), "the role that WAS fenced must not be reported");
});

test("ANTI-VACUITY — a fence that took SELECT is detected", () => {
  const noRead = FENCED.map((r) => (r[0] === "bolao_state" && r[1] === "anon") ? [r[0], r[1], "f", "f", "f", "f"] : r);
  assert(fenceFailures(noRead, PHASE.AFTER).some((m) => /lost SELECT/.test(m)),
    "taking SELECT is a read outage in the middle of a cutover and must be caught, not celebrated as extra safety");
});

test("ANTI-VACUITY — a fence that broke the service_role mirror is detected", () => {
  const noMirror = FENCED.map((r) => (r[0] === "bolao_state" && r[1] === "service_role") ? [r[0], r[1], "t", "f", "f", "t"] : r);
  assert(fenceFailures(noMirror, PHASE.AFTER).some((m) => /service_role lost INSERT,UPDATE/.test(m)),
    "service_role mirrors until step 19; a fence that takes its writes stops the mirror the parity harness measures");
});

test("ANTI-VACUITY — a fence that reached beyond the legacy document is detected", () => {
  const tooWide = FENCED.map((r) => (r[0] === "lottery_pools" && r[1] === "anon") ? [r[0], r[1], "t", "f", "f", "f"] : r);
  assert(fenceFailures(tooWide, PHASE.AFTER).some((m) => /lottery_pools, which the fence does not cover/.test(m)),
    "a wildcard REVOKE would fence a different product's tables and must be visible");
});

test("ANTI-VACUITY — a no-op fence is detected BEFORE it is applied", () => {
  const f = fenceFailures(FENCED, PHASE.BEFORE);
  assert(f.some((m) => /already holds no write privilege .* the fence would be a no-op/.test(m)),
    "if the path is already closed, 'the fence worked' is a false reading of an unchanged state");
});

test("ANTI-VACUITY — a changed legacy table set is detected in both directions", () => {
  const missing = OPEN.filter((r) => r[0] !== "lottery_draws");
  assert(fenceFailures(missing, PHASE.BEFORE).some((m) => /lottery_draws is missing from the catalog read/.test(m)),
    "a legacy table disappearing changes the fence's scope and must be visible");
  const extra = [...OPEN, openRow("bolao_state_v2", "anon")];
  assert(fenceFailures(extra, PHASE.BEFORE).some((m) => /bolao_state_v2 .* is not in LEGACY_TABLES/.test(m)),
    "a new legacy table must force a decision about whether the fence covers it");
  assert(fenceFailures([], PHASE.AFTER).some((m) => /returned nothing/.test(m)),
    "zero rows must be a failure, not a vacuous clean verdict");
});

test("the verifier reads EVERY legacy table, not only the fenced one", () => {
  const sql = fenceVerifySql();
  assert(/n\.nspname = 'public'/.test(sql) && !/relname\s*=\s*'bolao_state'/.test(sql),
    "a verifier that only looks where it expects its own work cannot see a fence that reached too far");
  assert(/has_table_privilege/.test(sql), "the server's own answer, not a reconstruction from relacl");
});

console.log("\nKPLUS-F058 — the view surface the verifier used to be blind to\n");

test("KPLUS-F058 — the verifier reads views and materialized views, not only ordinary tables", () => {
  const sql = fenceVerifySql();
  assert(/relkind IN \('r', 'v', 'm'\)/.test(sql),
    "filtering relkind='r' is what made the bypass unreportable: the fence's own verifier could not see the relation anon was writing through");
  assert(/relkind IN \('r', 'v', 'm'\)/.test(legacyAclSql()), "the ACL query has the same blind spot to fix");
});

test("KPLUS-F058 REGRESSION CONTROL — a relkind='r' verifier cannot see the bypass", () => {
  // Simulate the pre-fix read: tables only. The fence looks CLOSED while the views stay wide open.
  const tablesOnly = FENCED.filter((r) => !LEGACY_VIEWS.some((v) => v.name === r[0]));
  const viewsStillOpen = fenceFailures(tablesOnly, PHASE.AFTER);
  assert(viewsStillOpen.some((m) => /bolao_state_public/.test(m)),
    "with the views modelled, their ABSENCE from a relkind='r' read must itself be a finding — otherwise the old blindness returns silently");
});

test("KPLUS-F058 — both views are fenced for writes and keep SELECT", () => {
  eq(LEGACY_VIEWS.length, 2, "production carries two projections of the migration subject");
  for (const v of LEGACY_VIEWS) {
    assert(v.fenced, `${v.name} projects the migration subject; an unfenced write through it reaches bolao_state`);
    eq(v.role, "PUBLIC_READ_SURFACE", `${v.name} is the browser's PII-stripped read path`);
    assert(v.dependsOn.includes("public.bolao_state"), `${v.name} must record what it reads`);
    assert(/main [0-9a-f]{7}/.test(v.origin), `${v.name} must record its provenance`);
    assert(/NOT obsolete|live read path/i.test(v.why), `${v.name} must not be treated as obsolete merely because normalized tables exist`);
  }
  // SELECT survives for both, in the derived AFTER state.
  for (const [name, role, sel] of expectedAfterFence()) {
    if (LEGACY_VIEWS.some((v) => v.name === name)) {
      eq(sel, "t", `${role} lost SELECT on ${name} — that is the browser's read path under F10 and CDB2026 is in production`);
    }
  }
});

console.log("\nKPLUS-F036 — what the fence deliberately does not fix\n");

test("the unfenced exposure is computed and reported, not left in a comment", () => {
  const ex = unfencedExposure(FENCED);
  assert(ex.length > 0, "the six Powerball tables grant full CRUD to anon and authenticated; that must be reported");
  for (const e of ex) {
    assert(!/bolao_state/.test(e.table), "the fenced document must not appear in the unfenced exposure");
    assert(e.privileges.length > 0 && e.product, "each exposure names its privileges and whose product it is");
  }
  // 9 unfenced tables x 2 browser-reachable roles, against the synthetic all-open fixture.
  eq(ex.length, 18, "nine unfenced tables times two browser-reachable roles");
});

test("KPLUS-F055/F057 — against MEASURED production, the exposure report names the real one and only it", () => {
  const ex = unfencedExposure(MEASURED_PRODUCTION_PRIVILEGES);
  const anon = ex.filter((e) => e.role === "anon").map((e) => e.table).sort();
  // bolao_notif_jobs is the finding: anon holds full CRUD and the anon key ships in the page source.
  assert(anon.includes("public.bolao_notif_jobs"), "anon's full CRUD on bolao_notif_jobs must be reported — it is KPLUS-F057");
  // These two must NOT appear for anon: measurement says there is no anon write to expose.
  assert(!anon.includes("public.bolao_entry_private"), "anon holds nothing on bolao_entry_private; reporting it would be a false positive");
  assert(!anon.includes("public.live_sports_cache"), "anon holds SELECT only on live_sports_cache; reporting it would be a false positive");
  assert(!ex.some((e) => /bolao_state/.test(e.table)), "the fenced document must not appear in the unfenced exposure");
});


console.log("\nKPLUS-F036 — the orphaned Powerball tables\n");

/** A full-privilege ACL read: every legacy table, both browser roles, all seven privileges held. */
const aclRow = (relname, rolname, held = ORPHAN_PRIVILEGES) =>
  [relname, rolname, ...ORPHAN_PRIVILEGES.map((p) => (held.includes(p) ? "t" : "f"))];
const ACL_OPEN = LEGACY_TABLES.flatMap((t) => FENCED_ROLES.map((r) => aclRow(t.name, r)));
const ACL_REVOKED = ACL_OPEN.map((r) =>
  (r[0] === "bolao_state" ? r : aclRow(r[0], r[1], [])));

test("the proposal covers the six orphans and never the migration subject", () => {
  const sql = renderOrphanRevokeSql();
  const stmts = [...sql.matchAll(/^REVOKE ([A-Z, ]+) ON TABLE ([\w.]+) FROM (\w+);$/gm)];
  eq(stmts.length, 6 * FENCED_ROLES.length, `expected six tables x ${FENCED_ROLES.length} roles`);
  for (const m of stmts) {
    assert(!/bolao_state/.test(m[2]), "the orphan proposal must never touch the bolão document — that is the fence's table");
    assert(/^public\.lottery_/.test(m[2]), `${m[2]} is not an orphaned Powerball table`);
    eq(m[1].trim(), ORPHAN_PRIVILEGES.join(", "), "the privilege list must be the full set, named");
  }
  assert(!/REVOKE\s+ALL/i.test(stripSqlNoise(sql)), "privileges are named so the statement says exactly what it removes");
});

test("it removes TRIGGER and TRUNCATE, not just the obvious four", () => {
  for (const p of ["TRIGGER", "TRUNCATE", "REFERENCES"]) {
    assert(ORPHAN_PRIVILEGES.includes(p), `${p} is held on these tables and must be removed`);
  }
  assert(/TRIGGER/.test(renderOrphanRevokeSql()),
    "TRIGGER lets a principal attach code to a table it does not own, which fires for every writer");
});

test("the proposal states its evidence and its blast radius, because it is another product's decision", () => {
  const sql = renderOrphanRevokeSql();
  for (const [what, re] of [
    ["that it is a proposal and not part of the cutover", /PROPOSAL, NOT PART OF THE BOLAO CUTOVER/],
    ["why it is safe — no app code", /no application code references these tables/],
    ["why it is safe — production statistics", /zero UPDATE and zero\n-- DELETE ever|zero UPDATE and zero DELETE/],
    ["what would break if that is wrong", /WHAT WOULD BREAK IF THAT IS WRONG/],
    ["that RLS is why it is inert today", /RLS enabled with ZERO policies/],
  ]) assert(re.test(sql), `the proposal does not state ${what}`);
});

/**
 * KPLUS-F042. This test replaces one that compared the rollback's GRANT list against the revocation's
 * REVOKE list and passed — while the rollback granted `anon` a TRUNCATE it never held. Mirroring the
 * revocation is precisely the wrong property: revoking a privilege a role lacks is a no-op, granting one
 * it lacks is a privilege the rollback invented.
 */
test("KPLUS-F042 — the orphan rollback restores the MEASURED prior state, not the revocation's list", () => {
  const granted = [...renderOrphanRevokeRollbackSql(MEASURED_ORPHAN_ACL)
    .matchAll(/^GRANT ([A-Z, ]+) ON TABLE ([\w.]+) TO (\w+);$/gm)]
    .map((m) => ({ privs: m[1].split(",").map((x) => x.trim()), rel: m[2], role: m[3] }));
  eq(granted.length, 12, "six orphan tables x two browser roles");
  for (const g of granted) {
    const held = MEASURED_ORPHAN_ACL.find((r) => `public.${r[0]}` === g.rel && r[1] === g.role);
    assert(held, `${g.rel}/${g.role} is not in the measured ACL`);
    const expect = ORPHAN_PRIVILEGES.filter((_, i) => held[2 + i] === "t");
    eq(g.privs.join(","), expect.join(","), `${g.rel}/${g.role} must be restored to what it held`);
  }
  // The specific case that made the old test wrong.
  const anonPool = granted.find((g) => g.rel === "public.lottery_pools" && g.role === "anon");
  assert(!anonPool.privs.includes("TRUNCATE"), "anon never held TRUNCATE; a rollback must not grant it");
  const authPool = granted.find((g) => g.rel === "public.lottery_pools" && g.role === "authenticated");
  assert(authPool.privs.includes("TRUNCATE"), "authenticated did hold TRUNCATE and must get it back");
});

test("KPLUS-F042 — generating the rollback without the prior state is refused, not defaulted", () => {
  for (const bad of [undefined, null, [], "rows"]) {
    let threw = false;
    try { renderOrphanRevokeRollbackSql(bad); } catch (e) { threw = /needs the ACL read taken before/.test(e.message); }
    assert(threw, `renderOrphanRevokeRollbackSql(${JSON.stringify(bad)}) must refuse — a silent default is the bug`);
  }
});

test("the ACL query reads all seven privileges, and is separate from the fence's four", () => {
  const sql = legacyAclSql();
  for (const p of ORPHAN_PRIVILEGES) assert(new RegExp(`'${p}'`).test(sql), `${p} is not read`);
  assert(!/TRIGGER/.test(fenceVerifySql()),
    "the fence verifier stays on its four privileges — widening it would have changed the row shape its verdicts parse");
});

test("ANTI-VACUITY — every orphan verdict fires", () => {
  eq(orphanRevokeFailures(ACL_REVOKED, PHASE.AFTER).length, 0,
    `a fully revoked state must pass: ${orphanRevokeFailures(ACL_REVOKED, PHASE.AFTER).join(" · ")}`);
  eq(orphanRevokeFailures(ACL_OPEN, PHASE.BEFORE).length, 0,
    `the open state must be a valid BEFORE: ${orphanRevokeFailures(ACL_OPEN, PHASE.BEFORE).join(" · ")}`);
  assert(orphanRevokeFailures(ACL_OPEN, PHASE.AFTER).some((m) => /still holds/.test(m)),
    "an unapplied proposal must be caught");
  assert(orphanRevokeFailures(ACL_REVOKED, PHASE.BEFORE).some((m) => /already holds nothing/.test(m)),
    "if nothing is held to begin with, applying the proposal proves nothing and that must be visible");
  // Reaching the migration subject is the one thing this proposal must never do.
  const tookSubject = ACL_REVOKED.map((r) => (r[0] === "bolao_state" ? aclRow(r[0], r[1], []) : r));
  assert(orphanRevokeFailures(tookSubject, PHASE.AFTER).some((m) => /must not touch the migration subject/.test(m)),
    "a proposal that reached the bolão document must be caught");
  assert(orphanRevokeFailures([], PHASE.AFTER).some((m) => /returned nothing/.test(m)),
    "zero rows must be a failure, not a vacuous pass");
});

console.log("\nThe generated drafts on disk\n");

test("both drafts are fresh and carry the refusal banner", () => {
  const dir = join(HERE, "..", "..", "docs", "bolao", "db-modernization", "rls-drafts");
  for (const [name, want] of [["LEGACY_WRITE_FENCE.draft.sql", renderFenceSql()],
    ["LEGACY_WRITE_FENCE_ROLLBACK.draft.sql", renderFenceRollbackSql()],
    ["LEGACY_ORPHAN_TABLES_REVOKE.draft.sql", renderOrphanRevokeSql()],
    ["LEGACY_ORPHAN_TABLES_REVOKE_ROLLBACK.draft.sql", renderOrphanRevokeRollbackSql(MEASURED_ORPHAN_ACL)]]) {
    const body = readFileSync(join(dir, name), "utf8");
    eq(body, want, `${name} is stale — regenerate with legacy_fence.mjs --write`);
    assert(/^-- NOT FOR PRODUCTION APPLY/.test(body), `${name} does not open with the refusal banner`);
    assert(!/^\d{14}_[a-z0-9_]+\.sql$/.test(name), `${name} would be picked up by supabase db push`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ LEGACY FENCE TESTS FAILED"); process.exit(1); }
console.log("✓ LEGACY FENCE TESTS PASSED");
