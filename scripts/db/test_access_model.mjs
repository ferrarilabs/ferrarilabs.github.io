#!/usr/bin/env node
/**
 * Tests for the target RLS model (R) and write contracts (S).
 *
 * Every validator rule gets a synthetic violation, because the rules are the deliverable: an access model
 * whose checks cannot fire is a table of good intentions.
 */

import { loadAccessModel, validateAccessModel, ROLES, COMMANDS, FINANCIAL_NO_ANON, FINANCIAL_WRITE_SERVICE_ONLY, SENSITIVE_TABLES, APPEND_ONLY_TABLES } from "./validate_access_model.mjs";
import { loadModel } from "./validate_target_model.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const model = loadModel();
const clone = () => JSON.parse(JSON.stringify(loadAccessModel()));
const errs = (doc) => validateAccessModel(doc, model).errors;
const ent = (doc, name) => doc.entities.find((e) => e.name === name);

console.log("\nThe committed access model must be valid\n");

test("the access model validates with no errors or warnings", () => {
  const { errors, warnings } = validateAccessModel(loadAccessModel(), model);
  eq(errors.length, 0, `errors:\n      ${errors.join("\n      ")}`);
  eq(warnings.length, 0, `warnings:\n      ${warnings.join("\n      ")}`);
});

test("every table in the target model has an access decision", () => {
  const doc = loadAccessModel();
  const names = new Set(doc.entities.map((e) => e.name));
  for (const e of model.entities) {
    assert(names.has(e.name), `${e.name} has no access model — an undecided table is how production acquired policies no migration explains`);
  }
  eq(doc.entities.length, model.entities.length, "entity counts must match exactly");
});

test("anon can write nothing, anywhere", () => {
  for (const e of loadAccessModel().entities) {
    const writes = (e.permissions.anon || []).filter((p) => p !== "SELECT");
    eq(writes.length, 0, `${e.name}: anon may ${writes.join(", ")} — the anon key is in the page source`);
  }
});

test("anon can read nothing carrying a person's money or contact data", () => {
  for (const e of loadAccessModel().entities) {
    if (!FINANCIAL_NO_ANON.has(e.name) && !SENSITIVE_TABLES.has(e.name)) continue;
    eq((e.permissions.anon || []).length, 0, `${e.name} is readable by anon`);
  }
});

test("the published entry fee IS readable by anon, and its writes are not", () => {
  const fee = ent(loadAccessModel(), "pool_fee_schedule");
  assert((fee.permissions.anon || []).includes("SELECT"),
    "a published price must be visible before sign-in; it is not a person's money");
  assert(FINANCIAL_WRITE_SERVICE_ONLY.has("pool_fee_schedule"), "price changes must still be server-mediated");
  eq((fee.permissions.operator || []).filter((p) => p !== "SELECT").length, 0, "operator must not write a price directly");
});

test("nobody, in any role, is granted DELETE", () => {
  for (const e of loadAccessModel().entities) {
    for (const r of ROLES) {
      assert(!(e.permissions[r] || []).includes("DELETE"), `${e.name}: ${r} may DELETE`);
    }
  }
});

test("append-only tables grant UPDATE to nobody, including service", () => {
  for (const e of loadAccessModel().entities) {
    if (!APPEND_ONLY_TABLES.has(e.name)) continue;
    for (const r of ROLES) assert(!(e.permissions[r] || []).includes("UPDATE"), `${e.name}: ${r} may UPDATE`);
  }
});

test("audit_event_details is the ONE table where UPDATE is intentional", () => {
  const d = ent(loadAccessModel(), "audit_event_details");
  assert((d.permissions.service || []).includes("UPDATE"),
    "erasure requires nulling the snapshots in place; that is the whole reason the sidecar exists");
  assert(/erasure|redact/i.test(d.notes + JSON.stringify(d.policies)), "the exception must be justified in place");
});

test("every financial and identity write is service-only", () => {
  for (const e of loadAccessModel().entities) {
    if (!FINANCIAL_WRITE_SERVICE_ONLY.has(e.name) && e.name !== "participant_identity_links") continue;
    for (const r of ["anon", "authenticated", "operator"]) {
      const w = (e.permissions[r] || []).filter((p) => ["INSERT", "UPDATE"].includes(p));
      eq(w.length, 0, `${e.name}: ${r} may ${w.join(", ")}`);
    }
  }
});

test("RLS is enabled on every table and FORCE RLS is declared explicitly", () => {
  for (const e of loadAccessModel().entities) {
    eq(e.rlsEnabled, true, `${e.name}: RLS must be enabled — default deny`);
    eq(typeof e.forceRls, "boolean", `${e.name}: forceRls must be an explicit boolean`);
  }
});

test("every identity-scoped permission has an identity-aware predicate", () => {
  for (const e of loadAccessModel().entities) {
    for (const r of ROLES) {
      if (!(e.permissions[r] || []).some((p) => p.endsWith("_OWN"))) continue;
      const pol = (e.policies || []).filter((p) => (p.roles || [p.role]).includes(r) && p.commands.includes("SELECT"));
      assert(pol.length, `${e.name}: ${r} has _OWN but no SELECT policy`);
      for (const p of pol) {
        assert(/auth\.uid\(\)/.test(p.predicate),
          `${e.name}.${p.name}: _OWN scoping with predicate "${p.predicate}" — this is finding DR-1 again, an allowlist masquerading as authorization`);
      }
    }
  }
});

console.log("\nValidator rules must each fire\n");

test("an anon write is rejected", () => {
  const d = clone(); ent(d, "pool_entries").permissions.anon = ["INSERT"];
  assert(errs(d).some((e) => /grants the internet write access/.test(e)), "not reported");
});

test("anon reading a payments table is rejected", () => {
  const d = clone(); ent(d, "payments").permissions.anon = ["SELECT"];
  assert(errs(d).some((e) => /person's money or contact data/.test(e)), "not reported");
});

test("an operator writing a financial table is rejected", () => {
  const d = clone(); ent(d, "payments").permissions.operator = ["SELECT", "INSERT"];
  assert(errs(d).some((e) => /server-mediated/.test(e)), "not reported");
});

test("a DELETE grant is rejected", () => {
  const d = clone(); ent(d, "pool_entries").permissions.operator.push("DELETE");
  assert(errs(d).some((e) => /may DELETE/.test(e)), "not reported");
});

test("an UPDATE on an append-only table is rejected", () => {
  const d = clone(); ent(d, "audit_events").permissions.service.push("UPDATE");
  assert(errs(d).some((e) => /append-only/.test(e)), "not reported");
});

test("RLS disabled is rejected", () => {
  const d = clone(); ent(d, "payments").rlsEnabled = false;
  assert(errs(d).some((e) => /default deny/.test(e)), "not reported");
});

test("a policy granting a command the permission map does not list is rejected", () => {
  const d = clone();
  ent(d, "competitions").policies[0].commands = ["SELECT", "DELETE"];
  assert(errs(d).some((e) => /permission map does not list/.test(e)), "not reported");
});

test("an _OWN permission with a 'true' predicate is rejected as DR-1 repeated", () => {
  const d = clone();
  const e = ent(d, "pool_entries");
  e.policies.find((p) => p.name === "entries_self_select").predicate = "true";
  assert(errs(d).some((x) => /DR-1/.test(x)), "an allowlist masquerading as authorization must be caught");
});

test("a missing table is rejected", () => {
  const d = clone(); d.entities = d.entities.filter((e) => e.name !== "payments");
  assert(errs(d).some((e) => /has no access model/.test(e)), "not reported");
});

test("a table not in the target model is rejected", () => {
  const d = clone(); d.entities.push({ ...ent(d, "competitions"), name: "invented_table" });
  assert(errs(d).some((e) => /not in target_model/.test(e)), "not reported");
});

test("a table with no noDelete rationale is rejected", () => {
  const d = clone(); delete ent(d, "payments").noDelete;
  assert(errs(d).some((e) => /why DELETE is not granted/.test(e)), "not reported");
});

test("a multi-role policy is accepted and validated for every role it names", () => {
  const d = clone();
  const pol = ent(d, "competitions").policies.find((p) => p.roles);
  assert(pol, "the model should contain at least one multi-role policy");
  eq(errs(d).length, 0, "a valid multi-role policy must not error");
  pol.roles = ["anon", "operator", "nonsense"];
  assert(errs(d).some((e) => /unknown role nonsense/.test(e)), "each named role must be checked");
});

console.log("\nWrite contracts (S)\n");

test("all eight required contracts exist and are complete", () => {
  const doc = loadAccessModel();
  for (const n of ["create_entry", "submit_prediction", "record_payment", "allocate_payment",
                   "merge_identity", "reverse_merge", "record_prize", "admin_correction"]) {
    const c = doc.writeContracts.find((x) => x.name === n);
    assert(c, `missing contract ${n}`);
    for (const f of ["auth", "validation", "transaction", "idempotency", "audit", "outbox", "errors", "retry", "why"]) {
      assert(c[f] !== undefined && c[f] !== "" && !(Array.isArray(c[f]) && c[f].length === 0), `${n} missing ${f}`);
    }
  }
});

test("every contract writes its audit event inside one transaction", () => {
  for (const c of loadAccessModel().writeContracts) {
    assert(/one transaction/i.test(c.transaction), `${c.name}: transaction boundary not stated as single`);
    assert(/audit event/i.test(c.transaction),
      `${c.name}: the audit event must commit with the business change, or the two can disagree`);
  }
});

test("a contract missing its audit event is rejected", () => {
  const d = clone();
  d.writeContracts[0].transaction = "one transaction: insert the row";
  assert(errs(d).some((e) => /unaudited write/.test(e)), "not reported");
});

test("a contract spanning two transactions is rejected", () => {
  const d = clone();
  d.writeContracts[0].transaction = "insert the row, then write the audit event afterwards";
  assert(errs(d).some((e) => /single transaction/.test(e)), "not reported");
});

test("a contract with fewer than two error cases is rejected", () => {
  const d = clone(); d.writeContracts[0].errors = ["OOPS"];
  assert(errs(d).some((e) => /fewer than two named error cases/.test(e)), "not reported");
});

test("merge_identity is explicitly NOT blindly retryable", () => {
  const c = loadAccessModel().writeContracts.find((x) => x.name === "merge_identity");
  assert(/NOT blindly retryable/i.test(c.retry),
    "a silent retry of a merge would perform a second merge; here a visible failure is safer than a retry");
});

test("both cutoff-bearing contracts enforce the cutoff against the SERVER clock", () => {
  for (const n of ["create_entry", "submit_prediction"]) {
    const c = loadAccessModel().writeContracts.find((x) => x.name === n);
    assert(c.validation.some((v) => /SERVER clock/i.test(v)),
      `${n}: a client-side cutoff is a suggestion, not an enforcement`);
  }
});

test("record_payment requires an explicit currency and never defaults one", () => {
  const c = loadAccessModel().writeContracts.find((x) => x.name === "record_payment");
  assert(c.validation.some((v) => /never defaulted/i.test(v)), "a defaulted currency lets a pool silently inherit USD");
});

test("allocate_payment enforces the per-payment invariant inside the transaction", () => {
  const c = loadAccessModel().writeContracts.find((x) => x.name === "allocate_payment");
  assert(c.validation.some((v) => /SUM\(allocations\) <= payment\.amount/.test(v)), "invariant not stated");
  assert(/transaction/i.test(c.validation.join(" ") + c.transaction),
    "a CHECK constraint cannot see sibling rows, so the transaction is the only place this holds");
});

test("admin_correction restricts itself to an allowlist of fields", () => {
  const c = loadAccessModel().writeContracts.find((x) => x.name === "admin_correction");
  assert(c.validation.some((v) => /ALLOWLIST/i.test(v)),
    "an endpoint that can update anything is a second, unaudited schema");
});

console.log("\nGaps must be honest\n");

test("every gap states a consequence and a decision", () => {
  const gaps = loadAccessModel().gaps;
  assert(gaps.length >= 3, "the known gaps must be recorded, not omitted");
  for (const g of gaps) {
    assert(g.consequence && g.decision, `${g.id} incomplete`);
  }
});

test("a gap missing its decision is rejected", () => {
  const d = clone(); delete d.gaps[0].decision;
  assert(errs(d).some((e) => /must state a consequence and a decision/.test(e)), "not reported");
});

test("the operator-identity gap is recorded rather than papered over", () => {
  const g = loadAccessModel().gaps.find((x) => x.id === "R-GAP-1");
  assert(/cannot verify|not an identity|NOT an identity/i.test(g.detail),
    "operator permissions in this model are really 'service acting for an operator' until real auth exists, and that must be stated");
});

test("COMMANDS and ROLES are closed vocabularies", () => {
  eq(JSON.stringify(ROLES), JSON.stringify(["anon", "authenticated", "operator", "service"]), "roles changed");
  eq(JSON.stringify(COMMANDS), JSON.stringify(["SELECT", "INSERT", "UPDATE", "DELETE"]), "commands changed");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ ACCESS MODEL TESTS PASSED\n" : "✗ ACCESS MODEL TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
