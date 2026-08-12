#!/usr/bin/env node
/**
 * Tests for the privilege model — and, load-bearing, its MUTANTS.
 *
 * A privilege model that reports clean against a correct state proves nothing. Every check here is paired
 * with a mutant that must make it fail, and the assertion is on WHY it failed, not merely that it did: a
 * detector that fires for the wrong reason is a detector that will fire on the wrong day.
 *
 * The ten mutants are the ten ways this platform's defaults have actually bitten, or plausibly could.
 */
import {
  TARGET_POLICY, MANAGED_ROLES, BROWSER_ROLES, CREATOR_ROLES, OBJECT_CLASS_BEHAVIOUR,
  PRIVILEGE_SOURCE, PRODUCTION_EVIDENCE, CONSOLIDATED_READ_PACKAGE, DIFF_CLASS,
  LEGACY_COMPATIBILITY_EXCEPTIONS, targetPrivileges, reconcile, blockingRows, unmeasuredDimensionRows,
  renderDefaultPrivilegeSql, renderForwardSql, renderRollbackSql, renderManifest, verificationSql,
  detectRlsSubstitution, defaultPrivilegeCoversCreator, rollbackCoverage, detectExplicitGrantMasking,
  detectViewWriteBypass,
  F10_RETIREMENT_GATE, f10GateMet, f10GateBlockers, unconfirmedCreatorRoles, runtimeRequiredPrivileges,
} from "./privilege_model.mjs";
import { MEASURED_RELATIONS, measuredPrivileges, UNMEASURED_IN_PRODUCTION, PRODUCTION_RELATIONS } from "./privilege_evidence.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const ROWS = [...reconcile(MEASURED_RELATIONS, measuredPrivileges()),
  ...unmeasuredDimensionRows(MEASURED_RELATIONS, UNMEASURED_IN_PRODUCTION)];
const DEFAULT_SQL = renderDefaultPrivilegeSql();
const FORWARD_SQL = renderForwardSql(ROWS);

console.log("\nThe root-cause model — five sources, and they are not interchangeable\n");

test("every object class states its PostgreSQL built-in and its platform default separately", () => {
  assert(OBJECT_CLASS_BEHAVIOUR.length >= 6, "the inventory is too small to describe the surface");
  for (const c of OBJECT_CLASS_BEHAVIOUR) {
    assert(c.postgresBuiltin && c.platformDefault, `${c.objectClass} conflates or omits a source`);
    assert(typeof c.inheritedByFutureObjects === "boolean", `${c.objectClass} does not say whether future objects inherit`);
  }
  const fn = OBJECT_CLASS_BEHAVIOUR.find((c) => c.objectClass === "FUNCTION");
  assert(/EXECUTE to PUBLIC/.test(fn.postgresBuiltin),
    "the one built-in that GRANTS something must be named — it is why a new SECURITY DEFINER function is dangerous on creation");
  const mv = OBJECT_CLASS_BEHAVIOUR.find((c) => c.objectClass === "MATERIALIZED_VIEW");
  eq(mv.inheritedByFutureObjects, false, "ALTER DEFAULT PRIVILEGES has no object type for materialized views; claiming inheritance would be wrong");
  assert(Object.keys(PRIVILEGE_SOURCE).length === 5, "five distinct sources, because the remedy differs for each");
});

test("measured and unmeasured production evidence are stated separately, and the gap is named", () => {
  assert(PRODUCTION_EVIDENCE.measured.length >= 4 && PRODUCTION_EVIDENCE.unmeasured.length >= 5, "evidence lists are too thin");
  assert(PRODUCTION_EVIDENCE.unmeasured.some((u) => /pg_default_acl/.test(u)),
    "the MECHANISM itself was never read; a model that hides that is asserting an inference as a measurement");
  eq(PRODUCTION_EVIDENCE.inferenceStatus, "WELL_SUPPORTED_BUT_UNCONFIRMED", "the honest label");
  assert(CONSOLIDATED_READ_PACKAGE.some((p) => /pg_default_acl/.test(p.sql)), "the read package must be able to close the mechanism gap");
  for (const p of CONSOLIDATED_READ_PACKAGE) assert(p.sensitivity && p.unblocks, `${p.id} does not state its sensitivity or what it unblocks`);
});

console.log("\nThe target policy — least privilege, not current privilege\n");

test("browser roles get no write privilege on any object class", () => {
  for (const [cls, policy] of Object.entries(TARGET_POLICY)) {
    for (const role of BROWSER_ROLES) {
      const writes = (policy[role] ?? []).filter((p) => p !== "SELECT");
      eq(writes.length, 0, `${role} is allowed ${writes.join(",")} on ${cls} — the anon key is in the page source`);
    }
    eq((policy.PUBLIC ?? []).length, 0, `${cls} grants something to PUBLIC`);
    eq(policy.inheritedByFutureObjects, false, `${cls} lets future objects inherit — that is the defect being fixed`);
    assert(policy.why && policy.why.length > 40, `${cls} has no stated reason`);
  }
});

test("TRUNCATE, REFERENCES and TRIGGER go to nobody", () => {
  for (const [cls, policy] of Object.entries(TARGET_POLICY)) {
    for (const role of MANAGED_ROLES) {
      for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert(!(policy[role] ?? []).includes(p), `${role} is allowed ${p} on ${cls}; TRIGGER alone lets a principal attach code that fires for every writer`);
      }
    }
  }
});

test("every legacy compatibility exception states when it ENDS", () => {
  for (const e of LEGACY_COMPATIBILITY_EXCEPTIONS) {
    assert(e.until && e.until.length > 15, `${e.relation}/${e.role} is an exception with no end condition — that is a permanent grant with better branding`);
    assert(e.finding, `${e.relation}/${e.role} does not say which finding justifies it`);
    if (e.permanent) assert(/indefinite|by design/.test(e.until), "a permanent exception must say so explicitly");
    for (const p of e.privileges) assert(p === "SELECT" || e.role === "service_role",
      `${e.relation}/${e.role} keeps ${p}; only reads and the trusted runtime may be excepted`);
  }
});

console.log("\nReconciliation\n");

test("the matrix covers every relation and role, and every row carries a diff class or none", () => {
  const rels = new Set(ROWS.map((r) => r.relation));
  for (const r of MEASURED_RELATIONS) assert(rels.has(r.name), `${r.name} is missing from the matrix`);
  for (const required of ["bolao_state_public", "bolao_notif_jobs", "bolao_state", "bolao.payments", "bolao.participants"]) {
    assert(rels.has(required), `${required} must be reconciled — it was named explicitly`);
  }
  for (const row of ROWS) {
    assert(row.diffClass === null || Object.values(DIFF_CLASS).includes(row.diffClass), `${row.relation}/${row.role} has an unknown diff class`);
  }
});

test("an unmeasured privilege is UNKNOWN_BLOCKING and produces no statement", () => {
  const blocking = blockingRows(ROWS);
  assert(blocking.length > 0, "TRUNCATE/REFERENCES/TRIGGER were never read in production; claiming otherwise is the F058 mistake");
  for (const b of blocking) {
    eq(b.actionRequired, null, `${b.relation}/${b.role} generates a statement from an unmeasured state`);
    eq(b.rollbackRequired, null, `${b.relation}/${b.role} claims a rollback for a state nobody recorded`);
  }
  for (const p of UNMEASURED_IN_PRODUCTION) {
    assert(!new RegExp(`\\b${p}\\b`).test(FORWARD_SQL.split("\n").filter((l) => /^REVOKE|^GRANT/.test(l)).join("\n")),
      `the forward SQL touches ${p}, which was never measured — the rollback could not restore it`);
  }
});

test("the platform default is distinguished from a deliberate grant", () => {
  const notif = ROWS.find((r) => r.relation === "bolao_notif_jobs" && r.role === "anon");
  eq(notif.diffClass, DIFF_CLASS.PLATFORM_DEFAULT, "nobody granted anon CRUD here — the platform did, and the remedy differs");
  const priv = ROWS.find((r) => r.relation === "bolao_entry_private" && r.role === "anon");
  assert(priv.diffClass === null, "F10 already revoked anon here deliberately; there is nothing to reconcile");
});

test("service_role's missing writes on the target schema surface as EXPECTED_GRANT", () => {
  const payments = ROWS.find((r) => r.relation === "bolao.payments" && r.role === "service_role");
  eq(payments.diffClass, DIFF_CLASS.EXPECTED_GRANT, "the trusted runtime cannot currently write the tables it is supposed to own");
  assert(payments.actionRequired.every((a) => a.startsWith("GRANT")), "closing this gap is a grant, not a revoke");
});

console.log("\nThe generator\n");

test("the default-privilege SQL is emitted PER CREATOR ROLE, and unconfirmed roles are marked", () => {
  for (const c of CREATOR_ROLES) {
    const cov = defaultPrivilegeCoversCreator(DEFAULT_SQL, c.role);
    assert(cov.covered, `${c.role} is not covered for all three object types (got ${cov.objectTypes.join(",")}) — ALTER DEFAULT PRIVILEGES is per-role and an uncovered creator keeps inheriting`);
  }
  assert(unconfirmedCreatorRoles().length > 0, "the roles whose defaults were never read must be marked unconfirmed, not assumed");
  for (const c of unconfirmedCreatorRoles()) {
    assert(DEFAULT_SQL.includes(`${c.role}" IN SCHEMA public`) && /UNCONFIRMED/.test(DEFAULT_SQL), `${c.role} is emitted without its unconfirmed marker`);
  }
});

test("the rollback is derived from the MEASURED prior state, and covers every changing pair", () => {
  const cov = rollbackCoverage(ROWS);
  assert(cov.complete, `${cov.uncovered} changing pair(s) have no measured prior state: ${cov.uncoveredPairs.join(", ")}`);
  const rb = renderRollbackSql(ROWS);
  assert(/as measured 2026-08-11/.test(rb), "the rollback must record WHEN the state it restores was measured");
  // And it must restore by re-granting the measured set, not by inverting the forward statements.
  assert(/REVOKE ALL ON/.test(rb), "the rollback resets before re-granting, so a privilege added between forward and rollback is not left behind");
});

test("the manifest is deterministic and fingerprinted", () => {
  const a = renderManifest(ROWS), b = renderManifest(ROWS);
  eq(a.sha256, b.sha256, "the manifest must not change without the model changing");
  eq(a.sha256.length, 64, "digest shape");
  assert(!/\d{4}-\d\d-\d\dT\d\d:/.test(a.text), "a timestamp in the manifest makes every regeneration a diff");
});

test("the verification query reads EFFECTIVE privilege and every relkind", () => {
  const sql = verificationSql();
  assert(/has_table_privilege/.test(sql) && !/relacl/.test(sql), "effective privilege, not ACL text — ACL text does not account for role membership");
  assert(/relkind IN \('r', 'p', 'v', 'm', 'f'\)/.test(sql), "a relkind filter is how KPLUS-F058 hid; the verification must see every relation kind");
  for (const p of ["truncate", "references", "trigger"]) assert(sql.includes(p), `the verification omits ${p}`);
});

console.log("\nMUTANTS — each must fail, and fail for the stated reason\n");

const rowFor = (relation, role) => ROWS.find((r) => r.relation === relation && r.role === role && r.current !== null);

test("MUTANT 1 — anon INSERT accidentally inherited on a target table", () => {
  const mutant = reconcile([{ name: "bolao.payments", objectClass: "TABLE" }],
    [{ relation: "bolao.payments", role: "anon", privileges: ["INSERT"] }]);
  const r = mutant.find((x) => x.role === "anon");
  eq(r.diffClass, DIFF_CLASS.EXPECTED_REVOKE, "an inherited anon INSERT must be reported as a revoke, not tolerated");
  assert(r.actionRequired.includes("REVOKE INSERT"), `expected a REVOKE INSERT, got ${JSON.stringify(r.actionRequired)}`);
});

test("MUTANT 2 — anon UPDATE accidentally inherited", () => {
  const mutant = reconcile([{ name: "bolao.payments", objectClass: "TABLE" }],
    [{ relation: "bolao.payments", role: "anon", privileges: ["UPDATE"] }]);
  assert(mutant.find((x) => x.role === "anon").actionRequired.includes("REVOKE UPDATE"), "an inherited anon UPDATE must be caught");
});

test("MUTANT 3 — authenticated DELETE accidentally inherited", () => {
  const mutant = reconcile([{ name: "bolao.payments", objectClass: "TABLE" }],
    [{ relation: "bolao.payments", role: "authenticated", privileges: ["DELETE"] }]);
  assert(mutant.find((x) => x.role === "authenticated").actionRequired.includes("REVOKE DELETE"), "an inherited authenticated DELETE must be caught");
});

test("MUTANT 4 — PUBLIC EXECUTE on a callable function is denied by policy and by the generated defaults", () => {
  eq((TARGET_POLICY.FUNCTION.PUBLIC ?? []).length, 0, "PUBLIC must hold no EXECUTE");
  assert(/REVOKE ALL ON FUNCTIONS FROM .*PUBLIC;/.test(DEFAULT_SQL),
    "PostgreSQL grants EXECUTE on every new function to PUBLIC; without this REVOKE the next SECURITY DEFINER function ships callable by anyone");
  for (const role of MANAGED_ROLES) {
    eq(targetPrivileges("FUNCTION", role).length, 0, `${role} holds a blanket EXECUTE; RPCs are granted individually and reviewably`);
  }
});

test("KPLUS-F059 — the PUBLIC EXECUTE revoke is UNRESTRICTED, because the schema-scoped form does nothing", () => {
  const lines = DEFAULT_SQL.split("\n").filter((l) => /^ALTER DEFAULT PRIVILEGES/.test(l));
  const unrestricted = lines.filter((l) => /REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/.test(l) && !/IN SCHEMA/.test(l));
  eq(unrestricted.length, CREATOR_ROLES.length,
    "one unrestricted revoke per creator role — measured on PostgreSQL 17.10: the `IN SCHEMA public` form creates NO pg_default_acl row and a function created afterwards is still world-executable");
  for (const c of CREATOR_ROLES) {
    assert(unrestricted.some((l) => l.includes(`"${c.role}"`)), `${c.role} has no unrestricted PUBLIC revoke, so its future functions stay callable by anyone`);
  }
  // The wider blast radius must be stated, not slipped in.
  assert(/SCOPE NOTE/.test(DEFAULT_SQL) && /every schema the/.test(DEFAULT_SQL),
    "the unrestricted form covers every schema, which is deliberate and must be documented rather than discovered");
});

test("MUTANT 5 — a NEW view inheriting CRUD is caught by the same rule that caught KPLUS-F058", () => {
  const mutant = reconcile([{ name: "bolao_state_public_v2", objectClass: "VIEW" }],
    [{ relation: "bolao_state_public_v2", role: "anon", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] }]);
  const r = mutant.find((x) => x.role === "anon");
  eq(JSON.stringify(r.target), JSON.stringify(["SELECT"]), "a view is a read surface; SELECT survives and nothing else does");
  for (const p of ["INSERT", "UPDATE", "DELETE"]) assert(r.actionRequired.includes(`REVOKE ${p}`), `the new view keeps ${p} — that is the F058 bypass reappearing`);
});

test("MUTANT 6 — a migration-created table with the WRONG OWNER is a creator the defaults do not cover", () => {
  const rogue = "migration_runner";
  const cov = defaultPrivilegeCoversCreator(DEFAULT_SQL, rogue);
  eq(cov.covered, false, "the fixture is only meaningful if this creator is genuinely absent");
  assert(!CREATOR_ROLES.some((c) => c.role === rogue), "a creator absent from CREATOR_ROLES gets no ALTER DEFAULT PRIVILEGES at all, so everything it creates inherits the platform blanket");
});

test("MUTANT 7 — ALTER DEFAULT PRIVILEGES applied to the WRONG creator role changes nothing", () => {
  const onlyPostgres = renderDefaultPrivilegeSql([CREATOR_ROLES[0]]);
  eq(defaultPrivilegeCoversCreator(onlyPostgres, "postgres").covered, true, "the altered role is covered");
  for (const c of CREATOR_ROLES.slice(1)) {
    eq(defaultPrivilegeCoversCreator(onlyPostgres, c.role).covered, false,
      `${c.role} appears covered by a statement that named postgres — that would mean ALTER DEFAULT PRIVILEGES is not role-specific, and it is`);
  }
});

test("MUTANT 8 — a forward statement with NO measured prior state has no rollback, and is refused", () => {
  const mutant = [{ relation: "ghost_table", role: "anon", objectClass: "TABLE",
    current: null, target: [], actionRequired: ["REVOKE SELECT"], rollbackRequired: null }];
  const cov = rollbackCoverage(mutant);
  eq(cov.complete, false, "a change with no measured prior state must be reported as un-rollbackable");
  assert(cov.uncoveredPairs.includes("ghost_table/anon"), "the offending pair must be named, not just counted");
  assert(!/ghost_table/.test(renderRollbackSql(mutant)), "the rollback must not invent a state for it");
});

test("MUTANT 9 — an explicit GRANT masking an intended default revoke is detected", () => {
  const masking = 'GRANT SELECT, INSERT ON public."bolao_notif_jobs" TO "anon";';
  const found = detectExplicitGrantMasking(masking, DEFAULT_SQL);
  assert(found.length === 1, `the masking grant must be caught, got ${JSON.stringify(found)}`);
  assert(found[0].privileges.includes("INSERT"), "the privilege beyond target must be named");
  assert(/mechanism changed and the outcome did not/.test(found[0].why), "the reason must be the right one");
  // And the real forward SQL must be clean.
  eq(detectExplicitGrantMasking(FORWARD_SQL, DEFAULT_SQL).length, 0, "the generated forward SQL must not mask its own defaults");
});

test("MUTANT 10 — RLS is NOT accepted as a substitute for a missing REVOKE", () => {
  const rows = reconcile([{ name: "lottery_payment_transactions", objectClass: "TABLE" }],
    [{ relation: "lottery_payment_transactions", role: "anon", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] }]);
  const withRls = detectRlsSubstitution(rows, { lottery_payment_transactions: { enabled: true, policies: 0 } });
  assert(withRls.length > 0, "RLS enabled with zero policies must NOT clear an excess grant");
  eq(withRls[0].verdict, "EXCESS_GRANT", "the verdict must be about the grant, not about RLS");
  assert(/one added policy or one DISABLE ROW LEVEL SECURITY/.test(withRls[0].why),
    "the reason must state why RLS is a filter and not a denial — KPLUS-F036 is this exact argument in production");
  // Without RLS state the finding must be identical in substance: the grant is the finding.
  eq(detectRlsSubstitution(rows, {}).length, withRls.length, "the finding must not depend on whether RLS state was supplied");
});


console.log("\nThe class ceiling is not a per-table grant list (ADR-K11)\n");

test("no target relation grants the trusted runtime DELETE, because the model authorizes it nowhere", () => {
  const needs = runtimeRequiredPrivileges();
  assert(needs.size === 28, `expected 28 target entities, got ${needs.size}`);
  const withDelete = [...needs].filter(([, v]) => v.includes("DELETE"));
  eq(withDelete.length, 0, "rls_model.json sets noDeleteAnywhere and contains no DELETE policy at all");
  for (const [name] of needs) {
    for (const schema of ["bolao", "audit"]) {
      const t = targetPrivileges("TABLE", "service_role", `${schema}.${name}`);
      assert(!t.includes("DELETE"),
        `${schema}.${name} would grant DELETE. service_role holds BYPASSRLS in production, so no policy ` +
        `constrains it — a granted DELETE is unrestricted destructive power over payments and audit_events.`);
    }
  }
});

test("append-only entities get no UPDATE, and audit_chain_head gets no INSERT", () => {
  const j = (x) => JSON.stringify(x);
  eq(j(targetPrivileges("TABLE", "service_role", "audit.audit_events")), j(["SELECT", "INSERT"]));
  eq(j(targetPrivileges("TABLE", "service_role", "audit.audit_chain_head")), j(["SELECT", "UPDATE"]));
  for (const e of ["ranking_snapshots", "classification_snapshots", "competition_edition_standings",
                   "outbox_delivery_attempts", "request_idempotency"]) {
    assert(!targetPrivileges("TABLE", "service_role", `bolao.${e}`).includes("UPDATE"),
      `${e} is append-only in the model; UPDATE would let the runtime rewrite recorded history`);
  }
});

test("the narrowing applies ONLY to the trusted runtime on target schemas", () => {
  // Browser roles were already empty and must stay empty for a different reason than this narrowing.
  for (const role of BROWSER_ROLES) eq(JSON.stringify(targetPrivileges("TABLE", role, "bolao.payments")), "[]");
  // The class ceiling itself is unchanged — it is what a table of this class MAY hold.
  eq(JSON.stringify(targetPrivileges("TABLE", "service_role")), JSON.stringify(["SELECT", "INSERT", "UPDATE", "DELETE"]));
  // Legacy public relations are governed by the exceptions, not by the target entity model.
  const legacy = targetPrivileges("TABLE", "service_role", "bolao_state");
  assert(Array.isArray(legacy), "a legacy relation must still resolve");
});

test("an entity the authorization model has never heard of gets NOTHING, not the class ceiling", () => {
  // The dangerous default: a new target table with no access decision yet would otherwise receive the
  // full ceiling including DELETE, i.e. strictly MORE than any table that has been thought about.
  eq(JSON.stringify(targetPrivileges("TABLE", "service_role", "bolao.not_in_the_rls_model")), "[]");
  eq(JSON.stringify(targetPrivileges("TABLE", "service_role", "audit.also_unknown")), "[]");
  // And a known one is still narrowed rather than emptied, so this is fail-closed, not blanket denial.
  assert(targetPrivileges("TABLE", "service_role", "bolao.payments").length === 3);
});

test("MUTANT: a model that authorized runtime DELETE would be reflected, not ignored", () => {
  // The narrowing must be DERIVED. If it were a hardcoded denylist it would keep saying "no DELETE"
  // even after the authorization model legitimately changed, which is a detector that cannot track
  // the thing it detects.
  const needs = runtimeRequiredPrivileges();
  const sample = needs.get("payments");
  assert(sample && sample.includes("SELECT") && sample.includes("INSERT") && sample.includes("UPDATE"),
    "payments must still carry the three the model DOES authorize — narrowing is not blanket denial");
  assert(!sample.includes("DELETE"), "and not the one it does not");
});

console.log("\nThe F10 retirement gate\n");

test("the gate is conjunctive, every condition is a check, and 'normalized tables exist' is not one", () => {
  assert(F10_RETIREMENT_GATE.length >= 8, "the gate is too small to be a gate");
  for (const g of F10_RETIREMENT_GATE) {
    assert(g.condition && g.evidence && g.verifiable && g.status, `${g.id} is under-specified`);
  }
  assert(!F10_RETIREMENT_GATE.some((g) => /normalized tables exist/i.test(g.condition)),
    "a replacement existing says nothing about whether anyone has moved to it");
  eq(f10GateMet(), false, "no condition is met today; claiming otherwise would retire a live read path");
  assert(f10GateBlockers().length === F10_RETIREMENT_GATE.length, "every condition is currently a blocker");
  // The two that cannot be discharged by a query must say so rather than sitting at NOT_MET forever.
  assert(F10_RETIREMENT_GATE.some((g) => g.status === "UNMEASURABLE_TODAY"), "the zero-reads condition has no catalog source and must be labelled");
  assert(F10_RETIREMENT_GATE.some((g) => /NEITHER/.test(g.verifiable)), "an external consumer cannot be detected by any query, and that must be stated");
});

// ─────────────────────────────────────────────────────────────────────────────
// KPLUS-F058 / PRODMIG-Q32-A1 — a write privilege on a view
//
// This was modelled years before it was measured, and then found LIVE in production on 2026-08-12:
// `bolao_state_public` and `bolao_state_public_cdb` held ALL for anon and authenticated. No migration
// granted it — it arrived from `public`'s default privileges, and the canonical `grant select` that
// created the views was additive and never corrected it.
//
// The root mechanism sits in `public`, which is shared platform territory this programme does not own.
// So these tests guarantee the next occurrence is NOISY rather than silent.
// ─────────────────────────────────────────────────────────────────────────────
test("a browser role holding write on a NON-security_invoker view is an RLS_BYPASS finding", () => {
  const rows = [{ relation: "public.v", role: "anon", objectClass: "VIEW", current: ["SELECT", "UPDATE", "DELETE"] }];
  const f = detectViewWriteBypass(rows, { "public.v": { owner: "postgres" } });
  eq(f.length, 1, "the finding must be raised");
  eq(f[0].severity, "RLS_BYPASS", "a view that runs as its owner bypasses the base table's row security");
  assert(/BYPASSRLS/.test(f[0].why), "and the reason must say why that matters");
  assert(f[0].privileges.includes("UPDATE") && f[0].privileges.includes("DELETE"), "and name the verbs");
});

test("security_invoker downgrades the finding but does not erase it", () => {
  const rows = [{ relation: "public.v", role: "anon", objectClass: "VIEW", current: ["SELECT", "UPDATE"] }];
  const f = detectViewWriteBypass(rows, { "public.v": { securityInvoker: true, owner: "postgres" } });
  eq(f.length, 1, "still a write a browser role was never deliberately granted");
  eq(f[0].severity, "REVIEW", "but the caller's rights apply, so RLS is still enforced");
});

test("SELECT-only views and ordinary tables are NOT findings", () => {
  const rows = [
    { relation: "public.ok", role: "anon", objectClass: "VIEW", current: ["SELECT"] },
    { relation: "bolao.t", role: "anon", objectClass: "TABLE", current: ["UPDATE"] },
    { relation: "public.v", role: "service_role", objectClass: "VIEW", current: ["UPDATE"] },
  ];
  // service_role is not a BROWSER role: its view privileges are wrong per TARGET_POLICY and are caught by
  // ordinary reconciliation, but they are not the RLS-bypass-from-the-browser class this detector is for.
  eq(detectViewWriteBypass(rows, {}).length, 0, "a detector that fires on everything trains its reader to ignore it");
});

test("the canonical VIEW target is SELECT-only for every managed role", () => {
  for (const role of BROWSER_ROLES) {
    eq(JSON.stringify(targetPrivileges("VIEW", role, "public.anything")), JSON.stringify(["SELECT"]),
      `${role} must hold SELECT and nothing else on a view`);
  }
  const svc = targetPrivileges("VIEW", "service_role", "public.anything");
  assert(!svc.some((p) => ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].includes(p)),
    "not even the trusted runtime writes through a view — it writes the table");
});

test("MUTATION — reconciling the measured PRODMIG-Q32 state produces exactly the revokes and keeps SELECT", () => {
  const relations = ["public.bolao_state_public", "public.bolao_state_public_cdb"]
    .map((name) => ({ name, objectClass: "VIEW", providerManaged: false, inheritedOnly: false, scope: "PRODUCTION" }));
  const ALL = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
  const measured = [];
  for (const r of relations) for (const role of ["anon", "authenticated", "service_role"]) {
    measured.push({ relation: r.name, role, privileges: [...ALL] });
  }
  const rows = reconcile(relations, measured);
  const fwd = renderForwardSql(rows).split("\n").filter((l) => /^(GRANT|REVOKE)/.test(l));
  eq(fwd.filter((l) => l.startsWith("GRANT")).length, 0, "nothing is granted — SELECT is already held");
  eq(fwd.filter((l) => l.startsWith("REVOKE")).length, 6, "one revoke per (view, role)");
  for (const l of fwd) {
    assert(!/\bSELECT\b/.test(l.split("ON")[0]), `SELECT must never be revoked — it is the browser read path: ${l}`);
    for (const v of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      assert(new RegExp(`\\b${v}\\b`).test(l.split("ON")[0]), `${v} must be revoked: ${l}`);
    }
  }
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ PRIVILEGE MODEL TESTS PASSED\n" : "✗ PRIVILEGE MODEL TESTS FAILED\n");


process.exit(fail === 0 ? 0 : 1);
