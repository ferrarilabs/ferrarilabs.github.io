#!/usr/bin/env node
/**
 * Tests for the M10 audit backfill's chain construction (KPLUS-F014).
 *
 * These are the rules that can be checked without a database: the preconditions that make the builder
 * refuse, the verdicts that make the verifier fail, and — the load-bearing one — that the SQL calls the
 * shared hash functions rather than restating the canonical serialisation. The proof that the bulk chain
 * is byte-identical to what the append trigger produces needs a real server and lives in the campaign
 * lab; what lives here is the guarantee that there is only one implementation to be identical to.
 */

import {
  STAGING_TABLE, CHAINED_COLUMNS, hashExpr, stagingDdl, preflightSql, preflightRefusals,
  chainSql, promoteSql, sealSql, verifySql, verifyFailures, backfillPlan, analyzeSql,
  CHAIN_TRIGGER, disableChainTriggerSql, enableChainTriggerSql, triggerStateSql, triggerStateFailures,
  MIGRATION_ROLE_PRIVILEGES, REQUIRES_SUPERUSER,
} from "./audit_chain_backfill.mjs";
import { AUDIT_CHAIN_DDL } from "./generate_migration_drafts.mjs";

let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/** A preflight row describing a target that is ready: empty table, empty head, 4 staged, no gaps. */
const READY = { existing_events: 0, head_count: 0, head_seeded: 0, staged: 4, staged_already_chained: 0, ordinal_gaps: 0 };
/** A verify row describing a sound 4-event chain. */
const SOUND = {
  events: 4, recomputed_mismatch: 0, genesis: 1, open_ends: 1, broken_links: 0, linked: 3,
  head_count: 4, head_points_at_an_event: 1, head_has_a_successor: 0, orphan_actor: 0,
};

console.log("\nKPLUS-F014 — one implementation of the chain hash\n");

test("the builder does not restate the canonical serialisation — it calls the shared function", () => {
  for (const [name, sql] of [["chain", chainSql()], ["verify", verifySql()]]) {
    assert(sql.includes("audit.event_canonical_v1("), `${name} must call the shared canonical function`);
    assert(sql.includes("audit.event_hash_v1("), `${name} must call the shared hash function`);
    // chr(31)/chr(30)/sha256 appearing here would mean a second copy of the serialisation exists, which
    // is the entire defect this design prevents.
    assert(!/chr\(3[01]\)|sha256\(|convert_to\(/.test(sql), `${name} restates the canonical form instead of calling it`);
  }
});

test("every call into the canonical function is by NAME, never positional", () => {
  // CREATE FUNCTION declares it and COMMENT/REVOKE name it by signature; none of those are calls. A call
  // is an occurrence that immediately binds the first parameter by name.
  const calls = [chainSql(), verifySql(), AUDIT_CHAIN_DDL]
    .flatMap((s) => s.split("audit.event_canonical_v1(").slice(1))
    .filter((c) => /^\s*p_previous_event_hash\s*=>/.test(c));
  assert(calls.length >= 4, `expected the function to be called from the builder, the verifier and the trigger; found ${calls.length}`);
  for (const c of calls) {
    const head = c.slice(0, c.indexOf(")"));
    eq((head.match(/=>/g) || []).length, 13, "all thirteen arguments must be passed by name");
  }
});

test("the chained column list matches the shared function's parameter list", () => {
  const sig = AUDIT_CHAIN_DDL.slice(AUDIT_CHAIN_DDL.indexOf("FUNCTION audit.event_canonical_v1("));
  const params = [...sig.slice(0, sig.indexOf(") RETURNS text")).matchAll(/^\s{2}(p_\w+)/gm)].map((m) => m[1].slice(2));
  // previous_event_hash is a chain input rather than a source column, so it is in the signature and not
  // in CHAINED_COLUMNS. Everything else must correspond exactly.
  eq(params[0], "previous_event_hash", "the predecessor is the first field of the canonical form");
  eq(JSON.stringify(params.slice(1)), JSON.stringify([...CHAINED_COLUMNS]),
    "a column added to the chain without updating CHAINED_COLUMNS would be hashed but never promoted");
});

test("promotion carries exactly the chained columns plus the two chain columns", () => {
  const cols = promoteSql().slice(promoteSql().indexOf("(") + 1, promoteSql().indexOf(")")).split(",").map((s) => s.trim());
  eq(JSON.stringify(cols), JSON.stringify([...CHAINED_COLUMNS, "previous_event_hash", "event_hash"]),
    "promotion must not invent a column and must not drop one");
});

console.log("\nPreconditions — the builder refuses a target it could corrupt\n");

test("a genuinely un-chained target is accepted", () => {
  eq(preflightRefusals(READY).length, 0, `expected no refusal, got: ${preflightRefusals(READY).join(" · ")}`);
});

test("a target that already holds events is refused", () => {
  const r = preflightRefusals({ ...READY, existing_events: 7 });
  assert(r.some((m) => /already holds 7 event/.test(m)), `expected a refusal naming the existing events, got: ${r.join(" · ")}`);
});

test("a head that is already seeded is refused, even with an empty table", () => {
  assert(preflightRefusals({ ...READY, head_seeded: 1 }).some((m) => /already seeded/.test(m)), "a seeded head must block");
  assert(preflightRefusals({ ...READY, head_count: 3 }).some((m) => /already seeded/.test(m)), "a non-zero head count must block");
});

test("a missing singleton head is refused — that target is not the migrated schema", () => {
  assert(preflightRefusals({ ...READY, head_count: -1 }).some((m) => /no singleton row/.test(m)), "must refuse");
});

test("staging nothing is refused rather than sealing an empty chain", () => {
  assert(preflightRefusals({ ...READY, staged: 0 }).some((m) => /nothing is staged/.test(m)), "must refuse");
});

test("staged rows that already carry a hash are refused", () => {
  assert(preflightRefusals({ ...READY, staged_already_chained: 2 }).some((m) => /already carry an event_hash/.test(m)), "must refuse");
});

test("a gap in the document order is refused — an event went missing before staging", () => {
  assert(preflightRefusals({ ...READY, ordinal_gaps: 1 }).some((m) => /contiguous range/.test(m)), "must refuse");
});

test("the preflight query reads every column the refusal rules consume", () => {
  const sql = preflightSql();
  for (const k of Object.keys(READY)) assert(new RegExp(`AS ${k}\\b`).test(sql), `preflight does not produce ${k}`);
});

console.log("\nVerification — and it can fail\n");

test("a sound chain verifies", () => {
  eq(verifyFailures(SOUND).length, 0, `expected no failure, got: ${verifyFailures(SOUND).join(" · ")}`);
});

test("an empty table is a verification failure, not a vacuous pass", () => {
  assert(verifyFailures({ ...SOUND, events: 0 }).some((m) => /is empty/.test(m)), "must fail");
});

/**
 * Each of these is a distinct way a bulk-built chain goes wrong, and each must be caught by a DIFFERENT
 * verdict — a verifier where one broken property masks another cannot localise a defect.
 */
for (const [name, patch, expect] of [
  ["a row altered after it was written", { recomputed_mismatch: 1 }, /no longer hash/],
  ["two genesis events (two chains promoted together)", { genesis: 2 }, /exactly one genesis/],
  ["a forked chain", { open_ends: 2 }, /exactly one open end/],
  ["a predecessor that was never promoted", { broken_links: 1 }, /predecessor that is not in the table/],
  ["a head sealed from staging after promotion lost a row", { head_count: 5 }, /the head records 5/],
  ["a seal that never ran", { head_points_at_an_event: 0 }, /does not identify a row/],
  ["a head left pointing mid-chain", { head_has_a_successor: 1 }, /not the tail/],
  ["an actor no foreign key checked — a suspension wider than the one named trigger", { orphan_actor: 3 }, /not in auth.users/],
]) {
  test(`ANTI-VACUITY — ${name} is detected`, () => {
    const f = verifyFailures({ ...SOUND, ...patch });
    assert(f.some((m) => expect.test(m)), `expected ${expect}, got: ${f.join(" · ") || "no failure at all"}`);
  });
}

test("the linked count must track the event count — a chain of islands is caught", () => {
  assert(verifyFailures({ ...SOUND, linked: 2 }).some((m) => /expected 3/.test(m)), "must fail");
});

test("the verify query produces every column the verdicts consume", () => {
  const sql = verifySql();
  for (const k of Object.keys(SOUND)) assert(new RegExp(`AS ${k}\\b`).test(sql), `verify does not produce ${k}`);
});

console.log("\nThe plan\n");

test("the suspension is one named trigger, disabled and re-armed around promotion and nothing else", () => {
  const plan = backfillPlan();
  const inPromoteTxn = plan.filter((s) => s.txn === "promote").map((s) => s.id);
  eq(JSON.stringify(inPromoteTxn), JSON.stringify(["suspend_chain_trigger", "promote", "restore_chain_trigger"]),
    "the disable, the insert and the re-arm must be one transaction, in that order — a promotion that commits " +
    "before re-arming leaves the chain trigger down on a live table");
  const disabling = plan.filter((s) => /DISABLE TRIGGER/i.test(s.sql)).map((s) => s.id);
  eq(JSON.stringify(disabling), JSON.stringify(["suspend_chain_trigger"]),
    "a wider suspension would run the chain pass and the seal with the audit table's defences down for no reason");
});

console.log("\nKPLUS-F027 — the suspension mechanism, and the privileges it needs\n");

test("no step reaches for session_replication_role — the superuser-only hammer is gone", () => {
  for (const step of backfillPlan()) {
    assert(!/session_replication_role/i.test(step.sql),
      `step ${step.id} sets session_replication_role: a SUSET parameter no non-superuser migration role can set, ` +
      `which also disables FOREIGN KEY enforcement session-wide (KPLUS-F027)`);
  }
});

test("the disable names ONE trigger — never ALL, never USER", () => {
  const sql = disableChainTriggerSql();
  assert(sql.includes(`DISABLE TRIGGER "${CHAIN_TRIGGER}"`), "the trigger must be named, so the statement cannot widen by accident");
  assert(!/DISABLE TRIGGER\s+(ALL|USER)\b/i.test(sql),
    "DISABLE TRIGGER ALL takes the internal RI triggers down with it — it requires superuser AND stops foreign keys firing");
  assert(/^ALTER TABLE audit\.audit_events /.test(sql), "it must act on audit.audit_events and nothing else");
});

test("the re-arm is the exact inverse of the disable", () => {
  eq(enableChainTriggerSql(), disableChainTriggerSql().replace("DISABLE", "ENABLE"),
    "anything else and the trigger comes back in a state that is not the state it left");
});

test("nothing in the procedure touches row-level security", () => {
  for (const step of backfillPlan()) {
    assert(!/ROW LEVEL SECURITY/i.test(step.sql),
      `step ${step.id} alters RLS — FORCE ROW LEVEL SECURITY must survive the migration untouched, not be ` +
      `switched off and hopefully switched back`);
  }
});

test("the declared migration-role privileges do not include SUPERUSER", () => {
  eq(REQUIRES_SUPERUSER, false, "the procedure must be runnable by a non-superuser migration role");
  const names = MIGRATION_ROLE_PRIVILEGES.map((p) => p.privilege).join(" | ");
  assert(!/superuser/i.test(names), `SUPERUSER appears in the required privilege set: ${names}`);
  assert(MIGRATION_ROLE_PRIVILEGES.length === 2, "the set is ownership plus BYPASSRLS; a third entry needs its own justification");
  assert(/OWNER of audit\.audit_events/.test(names) && /BYPASSRLS/.test(names), `unexpected privilege set: ${names}`);
  for (const p of MIGRATION_ROLE_PRIVILEGES) {
    assert(/rls_model\.json/.test(p.already_modelled),
      `${p.privilege} is not traced to an already-ratified role definition — a new production privilege is an operator decision`);
  }
});

test("the plan proves afterwards that every trigger came back armed", () => {
  const ids = backfillPlan().map((s) => s.id);
  assert(ids.includes("trigger_state"), "a suspension with no postcondition is a suspension nobody would notice was left on");
  eq(ids[ids.length - 1], "trigger_state", "it reads the final state, so it runs last");
  assert(/pg_trigger/.test(triggerStateSql()) && /'audit_events'/.test(triggerStateSql()), "it must read the real catalog");
});

test("ANTI-VACUITY — the trigger-state check fails on a trigger left down, a missing chain trigger, and an empty table", () => {
  const ARMED = [
    ["RI_ConstraintTrigger_c_1", "O", "t"], [CHAIN_TRIGGER, "O", "f"],
    ["audit_events_refuse_update", "O", "f"], ["audit_events_refuse_delete", "O", "f"],
  ];
  eq(triggerStateFailures(ARMED).length, 0, `a fully armed table must pass: ${triggerStateFailures(ARMED).join(" · ")}`);
  assert(triggerStateFailures(ARMED.map((r) => (r[0] === CHAIN_TRIGGER ? [r[0], "D", r[2]] : r)))
    .some((m) => /is not armed/.test(m)), "a promotion that committed with the chain trigger down must be caught");
  assert(triggerStateFailures(ARMED.map((r) => (r[0].startsWith("RI_") ? [r[0], "D", r[2]] : r)))
    .some((m) => /is not armed/.test(m)), "an FK trigger left down must be caught — that is the widened-suspension signature");
  assert(triggerStateFailures(ARMED.filter((r) => r[0] !== CHAIN_TRIGGER)).some((m) => /not on the table/.test(m)),
    "a table whose chain trigger was dropped rather than disabled must be caught");
  assert(triggerStateFailures([]).some((m) => /no triggers at all/.test(m)),
    "zero rows must be a failure, not a vacuous 'nothing is disabled'");
});

test("the plan runs preflight before anything is promoted", () => {
  const ids = backfillPlan().map((s) => s.id);
  assert(ids.indexOf("preflight") < ids.indexOf("promote"), "preflight must precede promotion");
  assert(ids.indexOf("chain") < ids.indexOf("promote"), "the chain must be built before it is promoted");
  assert(ids.indexOf("promote") < ids.indexOf("seal"), "the head must be sealed from a populated table");
  assert(ids.indexOf("seal") < ids.indexOf("verify"), "verification includes the head, so it runs last");
});

test("KPLUS-F026 — statistics are refreshed between promotion and the first read of the promoted table", () => {
  const ids = backfillPlan().map((s) => s.id);
  assert(ids.includes("analyze"), "without ANALYZE the seal's anti-join is planned for a table the planner thinks is empty");
  assert(ids.indexOf("promote") < ids.indexOf("analyze"), "analysing before the rows exist measures nothing");
  assert(ids.indexOf("analyze") < ids.indexOf("seal"), "the seal is the first statement to read the promoted table");
  assert(/^ANALYZE audit\.audit_events$/.test(analyzeSql()), "it must analyse the table that was just filled");
});

test("the procedure never issues an UPDATE against audit.audit_events", () => {
  for (const step of backfillPlan()) {
    assert(!/UPDATE\s+audit\.audit_events/i.test(step.sql), `step ${step.id} rewrites audit history`);
    assert(!/DELETE\s+FROM\s+audit\.audit_events/i.test(step.sql), `step ${step.id} deletes audit history`);
  }
});

test("staging is a migration-time table outside both target schemas", () => {
  assert(STAGING_TABLE.startsWith("audit_backfill."), "staging must not live in audit or bolao");
  assert(/CONSTRAINT staging_action_shape/.test(stagingDdl()),
    "staging enforces the target's action shape, so a malformed action is caught before promotion and not mid-insert");
  assert(/ordinal\s+bigint PRIMARY KEY/.test(stagingDdl()),
    "a duplicate ordinal would make 'the next event' ambiguous and the walk planner-dependent");
});

test("the seal reads the tail from audit_events, not from staging", () => {
  assert(/FROM audit\.audit_events/.test(sealSql()), "the head must agree with the table, not with the plan");
  assert(!sealSql().includes(STAGING_TABLE), "sealing from staging would hide a promotion that lost rows");
});

test("hashExpr defaults to the row's own stored predecessor, so the verifier re-derives rather than re-links", () => {
  assert(hashExpr("e").includes("p_previous_event_hash => e.previous_event_hash"),
    "a verifier that recomputes the LINKS as well as the hashes would validate a re-linked chain");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail) { console.log("✗ AUDIT CHAIN BACKFILL TESTS FAILED"); process.exit(1); }
console.log("✓ AUDIT CHAIN BACKFILL TESTS PASSED");
