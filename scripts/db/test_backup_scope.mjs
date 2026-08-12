#!/usr/bin/env node
/**
 * Tests for the backup scope (KPLUS-F012).
 *
 * The properties checkable without a database: the classification is right, the rendered DDL rebuilds the
 * attachment faithfully, the fidelity verdict fires on every way a restore can be unfaithful, and — the
 * load-bearing one — the PRE-FIX scope is shown to FAIL on the same input. A fix whose absence nothing
 * detects is a fix that will be reverted by accident.
 *
 * The proof against real PostgreSQL is `night26_event_trigger_restore.mjs` in the campaign lab.
 */
import {
  ET_CLASS, PROVIDER_FUNCTION_SCHEMAS, classifyEventTrigger, eventTriggerCaptureSql,
  renderEventTriggerDdl, renderEventTriggerCompanion, eventTriggerFidelity, preFixScopeWouldDetect,
  DUMP_OMISSIONS, replayedOmissions, PRODUCTION_EVENT_TRIGGER_FACTS, productionSplitIsKnown,
  eventTriggerRestoreVerdict,
} from "./backup_scope.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const APP = { name: "rls_auto_enable_trg", event: "ddl_command_end", enabled: "O", function_schema: "public", function_name: "rls_auto_enable", tags: "CREATE TABLE" };
const PROV = { name: "pgrst_ddl_watch", event: "ddl_command_end", enabled: "O", function_schema: "extensions", function_name: "pgrst_ddl_watch", tags: "" };
const DISABLED = { ...APP, name: "disabled_trg", enabled: "D", tags: "" };

console.log("\nClassification — which triggers the backup must carry\n");

test("an application-owned trigger is carried; a provider one is recorded and not replayed", () => {
  eq(classifyEventTrigger("public"), ET_CLASS.APPLICATION_OWNED, "public is ours");
  eq(classifyEventTrigger("extensions"), ET_CLASS.PROVIDER_MANAGED, "extensions is the platform's");
  for (const s of PROVIDER_FUNCTION_SCHEMAS) eq(classifyEventTrigger(s), ET_CLASS.PROVIDER_MANAGED, `${s} must be provider-managed`);
});

test("an UNKNOWN schema defaults to APPLICATION_OWNED — over-inclusive fails loudly, under-inclusive fails silently", () => {
  eq(classifyEventTrigger("some_new_schema"), ET_CLASS.APPLICATION_OWNED, "an unrecognised schema must be carried, not dropped");
  eq(classifyEventTrigger(null), ET_CLASS.APPLICATION_OWNED, "a missing schema must not silently classify as provider");
});

test("the capture query reads the attachment and never the function body", () => {
  const sql = eventTriggerCaptureSql();
  for (const col of ["evtname", "evtevent", "evtenabled", "evttags", "evtfoid"]) assert(sql.includes(col), `the capture omits ${col}`);
  assert(!/prosrc|pg_get_functiondef/i.test(sql), "the function body comes from the schema dump; capturing it here would create two sources for one object");
});

console.log("\nRendering — the attachment must come back identical, not merely present\n");

test("an application-owned trigger renders replayable DDL including its tag filter", () => {
  const r = renderEventTriggerDdl(APP);
  eq(r.class, ET_CLASS.APPLICATION_OWNED, "wrong class");
  assert(/^CREATE EVENT TRIGGER "rls_auto_enable_trg" ON ddl_command_end WHEN TAG IN \('CREATE TABLE'\) EXECUTE FUNCTION "public"\."rls_auto_enable"\(\);$/m.test(r.sql), `unexpected DDL: ${r.sql}`);
});

test("a DISABLED trigger renders its ALTER — otherwise it comes back live and fires on everything", () => {
  const r = renderEventTriggerDdl(DISABLED);
  assert(/ALTER EVENT TRIGGER "disabled_trg" DISABLE;/.test(r.sql), `the disabled state was lost: ${r.sql}`);
  eq(r.enabledState, "DISABLED", "state label wrong");
  // And the default state must NOT emit a pointless ALTER.
  assert(!/ALTER EVENT TRIGGER/.test(renderEventTriggerDdl(APP).sql), "an enabled trigger needs no ALTER");
});

test("a provider trigger renders NO sql and states why, so the count still reconciles", () => {
  const r = renderEventTriggerDdl(PROV);
  eq(r.sql, null, "a provider trigger must not be replayed");
  assert(/NOT REPLAYED/.test(r.note) && /extensions/.test(r.note), "the reason must name the owning schema");
});

test("identifiers and tag literals are quoted — a trigger named oddly must not become injection", () => {
  const nasty = { ...APP, name: 'weird"name', tags: "DROP TABLE,CREATE TABLE" };
  const r = renderEventTriggerDdl(nasty);
  assert(r.sql.includes('"weird""name"'), "the identifier was not escaped");
  assert(r.sql.includes("WHEN TAG IN ('DROP TABLE', 'CREATE TABLE')"), `tags not rendered: ${r.sql}`);
});

test("the companion is deterministic and accounts for every trigger it was given", () => {
  const a = renderEventTriggerCompanion([APP, PROV, DISABLED], { capturedAt: "T" });
  const b = renderEventTriggerCompanion([DISABLED, PROV, APP], { capturedAt: "T" });
  eq(a.sha256, b.sha256, "input order must not change the artefact — its digest goes in the manifest");
  eq(a.total, 3, "wrong total");
  eq(a.applicationOwned.length, 2, "two application-owned");
  eq(a.providerManaged.length, 1, "one provider-managed");
  assert(a.text.includes("total: 3"), "the header must state the accounting");
  assert(a.replayableSql.includes("rls_auto_enable_trg") && !a.replayableSql.includes("pgrst_ddl_watch"),
    "only application-owned DDL is replayable");
});

console.log("\nFidelity — every way a restore can be unfaithful must be caught\n");

test("an identical restore is faithful", () => {
  const v = eventTriggerFidelity([APP, PROV], [APP, PROV]);
  assert(v.ok, `expected clean: ${v.problems.join(" · ")}`);
});

test("ANTI-VACUITY — a LOST trigger is caught (this is KPLUS-F012 itself)", () => {
  const v = eventTriggerFidelity([APP], []);
  assert(!v.ok && /is in the source and absent from the restore/.test(v.problems[0]), `not caught: ${JSON.stringify(v.problems)}`);
});

test("ANTI-VACUITY — a trigger that comes back ENABLED when it was DISABLED is caught", () => {
  const v = eventTriggerFidelity([DISABLED], [{ ...DISABLED, enabled: "O" }]);
  assert(!v.ok && /different attributes/.test(v.problems[0]), `a behaviour change passed as faithful: ${JSON.stringify(v.problems)}`);
});

test("ANTI-VACUITY — a changed event or tag filter is caught", () => {
  assert(!eventTriggerFidelity([APP], [{ ...APP, event: "sql_drop" }]).ok, "a changed event passed");
  assert(!eventTriggerFidelity([APP], [{ ...APP, tags: "" }]).ok, "a dropped tag filter passed — it now fires on statements it never fired on");
});

test("ANTI-VACUITY — a count-equal swap is caught, which a count comparison would miss", () => {
  const other = { ...APP, name: "something_else" };
  const v = eventTriggerFidelity([APP], [other]);
  eq(v.sourceApplicationOwned, v.restoredApplicationOwned, "the counts are deliberately equal in this fixture");
  assert(!v.ok, "one lost and one gained must not pass merely because the totals match");
});

test("an EXTRA trigger in the restore is caught — the target carries what the backup never described", () => {
  const v = eventTriggerFidelity([], [APP]);
  assert(!v.ok && /exists in the restore and not in the source/.test(v.problems[0]), "an unexplained attachment passed");
});

test("provider triggers differing between source and target is NOT a failure", () => {
  // A bare PostgreSQL target legitimately has none of them; failing on that makes every honest rehearsal red.
  const v = eventTriggerFidelity([APP, PROV], [APP]);
  assert(v.ok, `provider drift must not fail the restore: ${v.problems.join(" · ")}`);
  eq(v.sourceProviderManaged, 1, "provider counts are still reported");
  eq(v.restoredProviderManaged, 0, "provider counts are still reported");
});

console.log("\nThe regression control — the pre-fix scope must FAIL\n");

test("KPLUS-F012 REGRESSION CONTROL — the pre-fix backup scope loses application-owned triggers", () => {
  const r = preFixScopeWouldDetect([APP, DISABLED, PROV]);
  assert(r.wouldDetect, "the pre-fix scope must be shown to lose them — if this passes, the fix is not doing anything");
  eq(r.lostTriggers.length, 2, "both application-owned triggers are lost under the pre-fix scope");
  assert(r.lostTriggers.includes("rls_auto_enable_trg"), "the RLS guard is among the losses — that is the whole finding");
});

test("the regression control is not vacuous — with nothing to lose, it detects nothing", () => {
  assert(!preFixScopeWouldDetect([]).wouldDetect, "an empty source must not report a loss");
  assert(!preFixScopeWouldDetect([PROV]).wouldDetect, "provider-only sources lose nothing the backup was meant to carry");
});

console.log("\nThe rehearsal's verdict — a missing companion is a FINDING, not a pass\n");

test("a restore matching the companion is FAITHFUL", () => {
  const v = eventTriggerRestoreVerdict(["a", "b"], ["a", "b"]);
  assert(v.ok, `expected clean: ${v.problems.join(" · ")}`);
  eq(v.verdict, "FAITHFUL", "wrong verdict");
});

test("KPLUS-F012 — a bundle with NO companion is not a pass, however few triggers the target has", () => {
  const v = eventTriggerRestoreVerdict(null, []);
  assert(!v.ok, "no companion + no triggers is precisely the state every green rehearsal was in");
  eq(v.verdict, "NO_COMPANION", "wrong verdict");
});

test("ANTI-VACUITY — a declared-but-absent trigger and an undeclared-but-present one both fire", () => {
  assert(!eventTriggerRestoreVerdict(["a"], []).ok, "a companion declaring a trigger the restore lacks must fail");
  assert(!eventTriggerRestoreVerdict([], ["a"]).ok, "a trigger nothing declared must fail");
  const v = eventTriggerRestoreVerdict([], []);
  assert(v.ok && v.verdict === "NONE_DECLARED_NONE_PRESENT", "an honestly empty pair is a pass, and is labelled as such rather than as FAITHFUL");
});

console.log("\nThe omission inventory, and what is honestly unknown\n");

test("every omission states a restore action, and CAPTURE_ONLY must justify itself", () => {
  assert(DUMP_OMISSIONS.length >= 3, "the inventory is too small to be the contract's data");
  for (const o of DUMP_OMISSIONS) {
    assert(o.object && o.why && o.restoreAction && o.consequenceIfMissed, `${o.object} is under-specified`);
    if (o.restoreAction === "CAPTURE_ONLY") {
      assert(o.captureOnlyWhy && o.captureOnlyWhy.length > 40,
        `${o.object} is captured but never replayed with no reason recorded — that is exactly the shape of KPLUS-F012`);
    }
  }
  eq(replayedOmissions().length, 1, "event triggers are the one omission that must be replayed");
  eq(replayedOmissions()[0].object, "event triggers", "wrong replayed omission");
});

test("production's event triggers are ENUMERATED, and the split is 1 application-owned of 7", () => {
  eq(PRODUCTION_EVENT_TRIGGER_FACTS.count, 7, "the measured production count");
  eq(PRODUCTION_EVENT_TRIGGER_FACTS.restoredBaselineCount, 0, "the restored baseline count");
  assert(productionSplitIsKnown(), "the split was read on 2026-08-11 and must be recorded as known");
  eq(PRODUCTION_EVENT_TRIGGER_FACTS.applicationOwnedCount, 1, "exactly one is ours");
  eq(PRODUCTION_EVENT_TRIGGER_FACTS.providerManagedCount, 6, "six belong to the platform");
  eq(PRODUCTION_EVENT_TRIGGER_FACTS.applicationOwnedCount + PRODUCTION_EVENT_TRIGGER_FACTS.providerManagedCount,
    PRODUCTION_EVENT_TRIGGER_FACTS.count, "the split must account for every trigger counted by PROBE-2");
});

test("KPLUS-F012 — the classifier reproduces the REAL production split with no adjustment", () => {
  const rows = [
    ...PRODUCTION_EVENT_TRIGGER_FACTS.applicationOwned,
    ...PRODUCTION_EVENT_TRIGGER_FACTS.providerManaged.map((name) => ({ name, event: "ddl_command_end", enabled: "O", function_schema: "extensions", function_name: name, tags: "" })),
  ];
  const c = renderEventTriggerCompanion(rows, { capturedAt: "prod" });
  eq(c.total, 7, "all seven accounted for");
  eq(c.applicationOwned.join(","), "ensure_rls", "exactly ensure_rls is replayed");
  eq(c.providerManaged.length, 6, "the six platform triggers are recorded and not replayed");
  // The tag list is what makes the attachment faithful: three tags, not one.
  assert(c.replayableSql.includes("WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')"),
    `production's ensure_rls fires on three tags and all three must be replayed: ${c.replayableSql}`);
});

test("KPLUS-F012 — the guard IS attached in production, so the RLS-off branch was never production's state", () => {
  assert(PRODUCTION_EVENT_TRIGGER_FACTS.guardIsAttachedInProduction, "ensure_rls is present and ENABLED in production");
  eq(PRODUCTION_EVENT_TRIGGER_FACTS.applicationOwned[0].enabled, "O",
    "an ENABLED guard means a table created outside the migration path still lands with RLS on — that branch of F012 is false for production and true only of the restored baseline");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ BACKUP SCOPE TESTS PASSED\n" : "✗ BACKUP SCOPE TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
