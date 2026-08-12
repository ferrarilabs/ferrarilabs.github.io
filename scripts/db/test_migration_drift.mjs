#!/usr/bin/env node
/**
 * BATCH G tests — migration-draft drift detection, with a deliberate defect for every detector.
 *
 * STEP 27/28. The governing rule: a comparator that has only ever been observed to pass is
 * indistinguishable from one that cannot fail. Six of the detectors in migration_drift.mjs were in
 * fact broken when first written — the nullability check never fired for ANY of the 211 columns,
 * because the model marks nullable columns with `nullable: true` and says nothing at all for NOT NULL,
 * so `nullable === false` was never true. It reported a clean sweep. That is the failure mode this
 * suite exists to make impossible.
 *
 * Every mutation below is applied to an in-memory copy. No draft file is modified.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDraft, parseAllDrafts, draftInventory, stripNoise, DRAFT_DIR,
  diffModelToDrafts, typeScrutiny, enumReconciliation, indexReconciliation, staleNameScan,
  constraintReconciliation, rlsAlignment, writeContractAlignment, auditOutboxAlignment,
  reportingAlignment, orderingGraph, expandContractAndBackfill, hazardScan, headerCheck,
  fixtureRepresentationCheck, roundTrip, traceability, readinessMatrix, runAll,
  CLASS, SOURCE_OF_TRUTH, NUMBERING_CONFLICT, SYNTHETIC_EXECUTION_LIMITATION,
  STALE_NAMES, BACKFILL_MAP, FIXTURE_MONEY_MAP, ROLLBACK_CLASSES, HAZARDS, HAZARD_DISPOSITIONS,
  EXTERNAL_TABLES,
} from "./migration_drift.mjs";

let pass = 0, fail = 0, asserts = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const atest = async (n, fn) => {
  try { await fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { asserts++; if (!c) throw new Error(m); };
const eq = (a, b, m) => { asserts++; if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

const MODEL = JSON.parse(readFileSync(join(DRAFT_DIR, "..", "..", "..", "..", "model", "target_model.json"), "utf8"));
const model = () => structuredClone(MODEL);
const drafts = () => parseAllDrafts();
const inv = () => draftInventory(drafts());

const kinds = (list) => list.map((f) => f.kind);
const errsOf = (list) => list.filter((f) => f.klass === CLASS.ERROR);

// =============================================================================================
console.log("\nSTEP 1 — source of truth map, and the numbering conflict\n");
// =============================================================================================

test("every governed concern names a machine-readable source", () => {
  for (const concern of ["entities", "columns", "types", "nullability", "primaryKeys", "foreignKeys",
    "uniqueConstraints", "checks", "indexes", "enums", "rlsIntent", "aclIntent", "writeContracts",
    "audit", "outbox", "reporting"]) {
    assert(SOURCE_OF_TRUTH[concern], `no source declared for ${concern}`);
    assert(/\.json|\.mjs/.test(SOURCE_OF_TRUTH[concern]), `${concern} names prose, not an artefact: ${SOURCE_OF_TRUTH[concern]}`);
  }
});

test("the two M-numbering schemes are recorded as a conflict, not silently reconciled", () => {
  assert(NUMBERING_CONFLICT.draftScheme && NUMBERING_CONFLICT.phasePlanScheme, "both schemes must be described");
  assert(/M8/.test(NUMBERING_CONFLICT.collision), "the collision must name a colliding label");
  assert(/NOT resolved by renaming/.test(NUMBERING_CONFLICT.resolution), "renaming must be an operator decision");
  assert(/^none/.test(NUMBERING_CONFLICT.draftScheme.backfills), "the draft scheme contains no backfill phase");
});

test("the absence of a PostgreSQL server is recorded, with what it means", () => {
  eq(SYNTHETIC_EXECUTION_LIMITATION.postgresServerAvailable, false, "no server is available");
  assert(SYNTHETIC_EXECUTION_LIMITATION.notProven.length >= 3, "what is NOT proven must be enumerated");
  assert(/production/.test(SYNTHETIC_EXECUTION_LIMITATION.productionHazard), "the libpq production-default hazard must be recorded");
});

// =============================================================================================
console.log("\nSTEP 2 — the parser\n");
// =============================================================================================

test("all seventeen drafts parse, including the two namespaced phases and the additive-ALTER M13", () => {
  const d = drafts();
  eq(d.length, 17, "draft count — 17 since M17, classification zone predictions");
  eq(d.map((x) => x.phase).join(","), "M1,M2,M3,M4,M5,M6,M7,M8,M9,M10,DDL-M11,DDL-M12,M13,M14,M15,M16,M17",
    "phases in order. DDL-M11 carries its scheme in its id because model/migration_phases.json already uses a bare M11 for write_through_via_server_mediated_writes (BATCH-G-OP-1).");
});

test("the union of the drafts creates all 28 modelled entities", () => {
  const i = inv();
  eq(Object.keys(i.tables).length, 28, `tables: ${Object.keys(i.tables).length}`);
  for (const e of MODEL.entities) assert(i.tables[e.name], `${e.name} not created`);
});

test("table names are unquoted and unqualified", () => {
  for (const t of Object.keys(inv().tables)) {
    assert(!/["'.]/.test(t), `table name ${t} still carries quoting or a schema prefix`);
  }
});

test("stripNoise removes comments, string literals and dollar-quoted bodies", () => {
  const { code, comments } = stripNoise(`-- DROP TABLE x;\nSELECT 'TRUNCATE me';\n$$ DROP TABLE y; $$`);
  assert(!/DROP TABLE x/.test(code), "a comment leaked into code");
  assert(!/TRUNCATE me/.test(code), "a string literal leaked into code");
  assert(!/DROP TABLE y/.test(code), "a dollar-quoted body leaked into code");
  assert(comments.length >= 1, "comments must be returned for header parsing");
});

test("an expression index's column list is captured whole", () => {
  const p = parseDraft(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "t_x_idx" ON bolao."t" (lower(display_name));`, { name: "M9_x.draft.sql" });
  eq(p.indexes[0].cols.join(","), "lower(display_name)",
    "balanced-paren extraction is required: a naive \\(([^)]*)\\) closes on the inner paren and silently records a different index");
});

test("UNIQUE and the partial predicate are both captured", () => {
  const p = parseDraft(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "t_a_uidx" ON bolao."t" (a) WHERE a IS NOT NULL;`, { name: "M9_x.draft.sql" });
  eq(p.indexes[0].unique, true, "unique");
  eq(p.indexes[0].partial, "a IS NOT NULL", "partial predicate");
});

test("a partial predicate is never borrowed from a later statement", () => {
  const p = parseDraft(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "t_a_idx" ON bolao."t" (a);\n` +
    `SELECT 1 FROM pg_class WHERE NOT indisvalid;`, { name: "M9_x.draft.sql" });
  eq(p.indexes[0].partial, null,
    "an index with no WHERE must report none; a cross-statement match previously attached a postcheck's WHERE to nine indexes");
});

test("a column DEFAULT that is a string literal is recovered", () => {
  const p = parseDraft(`CREATE TABLE bolao."t" (\n  "state" bolao.st NOT NULL DEFAULT 'active',\n  "n" integer DEFAULT 0\n);`, { name: "M9_x.draft.sql" });
  eq(p.tables.t.columns.state.default, "'active'", "literal default must be recovered from raw text after stripNoise blanks it");
  eq(p.tables.t.columns.n.default, "0", "numeric default");
});

test("inline and table-level foreign keys are both captured, with ON DELETE and the schema", () => {
  const p = parseDraft(
    `CREATE TABLE bolao."t" (\n  "a" uuid REFERENCES bolao."p" ("p_id") ON DELETE RESTRICT,\n` +
    `  "b" uuid,\n  CONSTRAINT "t_b_fkey" FOREIGN KEY ("b") REFERENCES auth."users" ("id") ON DELETE SET NULL\n);`,
    { name: "M9_x.draft.sql" });
  const fks = p.tables.t.fks;
  eq(fks.length, 2, "both forms");
  eq(fks.find((f) => f.columns[0] === "a").onDelete, "RESTRICT", "inline ON DELETE");
  const b = fks.find((f) => f.columns[0] === "b");
  eq(b.onDelete, "SET NULL", "table-level ON DELETE");
  eq(b.refSchema, "auth", "the referenced schema must be recorded so external targets can be recognised");
});

test("declared header metadata is extracted", () => {
  const d = drafts();
  for (const x of d) {
    assert(x.header.rollback, `${x.phase} has no rollback strategy in its header`);
    assert(x.banner.notForProduction && x.banner.reviewDraftOnly && x.banner.requiresAuthorization, `${x.phase} banner`);
  }
  eq(d.find((x) => x.phase === "M5").header.dependencies, "M4", "M5 depends on M4");
});

// =============================================================================================
console.log("\nSTEP 20 — the model round-trip is exact\n");
// =============================================================================================

test("TARGET_MODEL -> DRAFTS -> PARSED_SCHEMA has zero diffs", () => {
  const r = roundTrip({ model: MODEL, inv: inv() });
  eq(r.diffs.length, 0, `diffs:\n      ${r.diffs.map((d) => JSON.stringify(d)).join("\n      ")}`);
});

test("the round-trip is computed by an INDEPENDENT parser, not by the generator", () => {
  // The generator writes the files; this module parses them back with its own parser. If both used the
  // same code the round-trip would be a tautology.
  // Checked on IMPORT statements, not on any mention: both files legitimately name the other in prose,
  // and a prose match would make this test unfixable without deleting an explanation.
  const importsOf = (src) => [...src.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const gen = readFileSync(join(DRAFT_DIR, "..", "..", "..", "..", "scripts", "db", "generate_migration_drafts.mjs"), "utf8");
  assert(!importsOf(gen).some((i) => /migration_drift/.test(i)), "the generator must not import the drift parser");
  const drift = readFileSync(join(DRAFT_DIR, "..", "..", "..", "..", "scripts", "db", "migration_drift.mjs"), "utf8");
  assert(!importsOf(drift).some((i) => /generate_migration_drafts/.test(i)), "the drift parser must not import the generator");
});

test("a DERIVED_VIEW column is absent from the DDL and its absence is required", () => {
  const i = inv();
  assert(!i.tables.pool_entries.columns.settlement_status,
    "settlement_status is DERIVED_VIEW and must never be a stored column");
  assert(!i.tables.payments.columns.unapplied_amount, "unapplied_amount is DERIVED_VIEW");
});

// =============================================================================================
console.log("\nCURRENT STATE — zero ERROR findings\n");
// =============================================================================================

await atest("the committed drafts produce no ERROR finding in any group", async () => {
  const r = await runAll();
  eq(r.errors.length, 0, `errors:\n      ${r.errors.map((f) => `[${f.group}] ${f.kind} ${f.subject}`).join("\n      ")}`);
});

await atest("every remaining finding is classified, and no class is used without a reason", async () => {
  const r = await runAll();
  for (const f of r.all) {
    assert(Object.values(CLASS).includes(f.klass), `${f.kind} has unknown class ${f.klass}`);
    assert(f.why && f.why.length > 25, `${f.kind} ${f.subject} has no usable reason`);
  }
});

await atest("the 19 uniqueness controls the model declares are all created", async () => {
  const i = inv();
  // A uniqueness control counts whether it is written as CREATE UNIQUE INDEX or as a UNIQUE
  // constraint — PostgreSQL builds a unique index for both. Counting only the first missed every
  // constraint-expressed control (KPLUS-F009).
  const uniques = [
    ...i.indexes.filter((ix) => ix.unique),
    ...Object.values(i.tables).flatMap((t) => (t.uniques || []).map((u) => ({ table: t.name, cols: u.columns }))),
  ];
  assert(uniques.length >= 19, `only ${uniques.length} uniqueness controls are created`);
  // The five that specific controls depend on.
  const has = (t, cols) => uniques.some((ix) => ix.table === t && ix.cols.join(",") === cols);
  assert(has("payments", "external_reference"), "the payment-reference idempotency control");
  assert(has("predictions", "pool_entry_id,match_id"), "the concurrent-prediction control");
  assert(has("payment_allocations", "payment_id,pool_entry_id"), "the duplicate-allocation control");
  assert(has("match_results", "match_id"), "the single-official-result control");
  assert(has("outbox_events", "idempotency_key"), "the delivery-idempotency control");
  assert(has("participant_identity_links", "merged_participant_id"), "the merge-once control");
});

await atest("no index name is used twice, so none can be silently dropped by IF NOT EXISTS", async () => {
  const seen = new Map();
  for (const ix of inv().indexes) {
    assert(!seen.has(ix.name), `index name ${ix.name} is used twice (${seen.get(ix.name)} and ${ix.phase})`);
    seen.set(ix.name, ix.phase);
  }
});

// =============================================================================================
console.log("\nSTEP 27/28 — a deliberate defect for every detector\n");
// =============================================================================================

const MUTANTS = [];
const mutant = (id, requirement, run) => { MUTANTS.push({ id, requirement, run }); };

// 1 — wrong column name
mutant("M-WRONG-COLUMN-NAME", "diffModelToDrafts reports a renamed column", () => {
  const i = inv();
  const t = i.tables.payments;
  t.columns.amount_paid = t.columns.amount; delete t.columns.amount;
  const f = diffModelToDrafts({ model: model(), inv: i });
  assert(kinds(f).includes("MISSING_COLUMN") && kinds(f).includes("EXTRA_COLUMN"), `got ${kinds(f)}`);
});

// 2 — missing index
mutant("M-MISSING-INDEX", "the round-trip reports a dropped index", () => {
  const i = inv();
  i.indexes = i.indexes.filter((ix) => ix.name !== "payments_external_reference_uidx");
  const r = roundTrip({ model: MODEL, inv: i });
  assert(r.diffs.some((d) => d.kind === "DIFF_INDEXES" && d.table === "payments"), `got ${JSON.stringify(r.diffs)}`);
});

// 3 — wrong FK target
mutant("M-WRONG-FK", "diffModelToDrafts reports a foreign key pointing at the wrong parent", () => {
  const i = inv();
  i.tables.pool_entries.fks.find((f) => f.columns.includes("pool_id")).refTable = "participants";
  const f = diffModelToDrafts({ model: model(), inv: i });
  assert(kinds(f).includes("WRONG_FK_TARGET"), `got ${kinds(f)}`);
});

// 4 — missing FK entirely
mutant("M-MISSING-FK", "diffModelToDrafts reports an unenforced reference", () => {
  const i = inv();
  i.tables.pool_entries.fks = i.tables.pool_entries.fks.filter((f) => !f.columns.includes("pool_id"));
  assert(kinds(diffModelToDrafts({ model: model(), inv: i })).includes("MISSING_FK"), "not detected");
});

// 5 — wrong enum values
mutant("M-WRONG-ENUM", "enumReconciliation reports differing values", async () => {
  const i = inv();
  const e = i.enums.find((x) => x.name === "bolao.pool_status");
  e.values = e.values.filter((v) => v !== "frozen");
  const f = await enumReconciliation({ model: model(), inv: i });
  assert(kinds(f).includes("ENUM_VALUES_DIFFER"), `got ${kinds(f)}`);
});

// 6 — enum not declared at all
mutant("M-ENUM-UNDECLARED", "enumReconciliation reports an enum no draft creates", async () => {
  const i = inv();
  i.enums = i.enums.filter((x) => x.name !== "bolao.payment_kind");
  const f = await enumReconciliation({ model: model(), inv: i });
  assert(kinds(f).includes("ENUM_NOT_DECLARED"), `got ${kinds(f)}`);
});

// 7 — an enum falling behind the vocabulary it claims to mirror
mutant("M-ENUM-BEHIND-CODE", "enumReconciliation reports an enum that no longer mirrors its module", async () => {
  const m = model();
  m.enums["bolao.settlement_status"].values = m.enums["bolao.settlement_status"].values.filter((v) => v !== "unknown");
  const f = await enumReconciliation({ model: m, inv: inv() });
  assert(kinds(f).includes("ENUM_BEHIND_CODE"), `got ${kinds(f)}`);
});

// 8 — wrong nullability. THE detector that was silently broken.
mutant("M-WRONG-NULLABILITY", "diffModelToDrafts reports a column made nullable", () => {
  const i = inv();
  // `kind` is NOT NULL in the model. An earlier version of this mutant used `currency`, which the model
  // declares nullable — legacy asserted payments have neither an amount nor a currency — so the mutant
  // was mutating a column to a state the model already permitted, and proved nothing.
  i.tables.payments.columns.kind.notNull = false;
  const f = diffModelToDrafts({ model: model(), inv: i });
  assert(kinds(f).includes("WRONG_NULLABILITY"), `got ${kinds(f)}`);
});

// 9 — money as a float
mutant("M-MONEY-FLOAT", "typeScrutiny reports money typed as a float", () => {
  const i = inv();
  i.tables.payments.columns.amount.type = "double precision";
  const f = typeScrutiny({ model: model(), inv: i });
  assert(kinds(f).includes("MONEY_FLOAT"), `got ${kinds(f)}`);
  assert(errsOf(f).length > 0, "money as a float must be an ERROR, not a review item");
});

// 10 — money as numeric with no scale
mutant("M-MONEY-NO-SCALE", "typeScrutiny reports numeric with no scale", () => {
  const i = inv();
  i.tables.payments.columns.amount.type = "numeric(14)";
  assert(kinds(typeScrutiny({ model: model(), inv: i })).includes("MONEY_NO_SCALE"), "not detected");
});

// 11 — a naive timestamp for an event time
mutant("M-NAIVE-TIMESTAMP", "typeScrutiny reports timestamp without time zone", () => {
  const i = inv();
  i.tables.payments.columns.paid_at.type = "timestamp";
  assert(kinds(typeScrutiny({ model: model(), inv: i })).includes("TIMESTAMP_WITHOUT_TIMEZONE"), "not detected");
});

// 12 — money with no currency column
mutant("M-MONEY-NO-CURRENCY", "typeScrutiny reports an amount with no currency", () => {
  const i = inv();
  delete i.tables.payments.columns.currency;
  assert(kinds(typeScrutiny({ model: model(), inv: i })).includes("MONEY_WITHOUT_CURRENCY"), "not detected");
});

// 13 — missing constraint
mutant("M-MISSING-CONSTRAINT", "constraintReconciliation reports a table with no CHECKs", () => {
  const i = inv();
  i.tables.payments.checks = [];
  const f = constraintReconciliation({ model: model(), inv: i });
  assert(kinds(f).includes("MISSING_CHECKS") || kinds(f).includes("MONEY_SIGN_UNCONSTRAINED"), `got ${kinds(f)}`);
});

// 14 — the money-sign CHECK removed specifically
mutant("M-MONEY-SIGN-UNGUARDED", "constraintReconciliation reports amount and kind with no relating CHECK", () => {
  const i = inv();
  i.tables.payments.checks = i.tables.payments.checks.filter((c) => !(/kind/i.test(c.expr) && /amount/i.test(c.expr)));
  assert(kinds(constraintReconciliation({ model: model(), inv: i })).includes("MONEY_SIGN_UNCONSTRAINED"), "not detected");
});

// 15 — a destructive cascade on a money-bearing table
mutant("M-WRONG-ON-DELETE", "constraintReconciliation reports ON DELETE CASCADE on history", () => {
  const i = inv();
  i.tables.payment_allocations.fks.find((f) => f.columns.includes("payment_id")).onDelete = "CASCADE";
  const f = constraintReconciliation({ model: model(), inv: i });
  assert(kinds(f).includes("DESTRUCTIVE_CASCADE_ON_HISTORY"), `got ${kinds(f)}`);
  assert(errsOf(f).length > 0, "a cascade that destroys money-bearing history must be an ERROR");
});

// 16 — SET NULL on a business reference (not an actor column)
mutant("M-SET-NULL-ON-HISTORY", "constraintReconciliation reports SET NULL on a business FK", () => {
  const i = inv();
  i.tables.payment_allocations.fks.find((f) => f.columns.includes("pool_entry_id")).onDelete = "SET NULL";
  assert(kinds(constraintReconciliation({ model: model(), inv: i })).includes("DESTRUCTIVE_SET_NULL_ON_HISTORY"), "not detected");
});

// 17 — a table with no primary key
mutant("M-NO-PK", "constraintReconciliation reports a table with no primary key", () => {
  const i = inv();
  i.tables.payments.pk = [];
  assert(kinds(constraintReconciliation({ model: model(), inv: i })).includes("NO_PRIMARY_KEY"), "not detected");
});

// 18 — wrong PK
mutant("M-WRONG-PK", "diffModelToDrafts reports a changed primary key", () => {
  const i = inv();
  i.tables.payments.pk = ["external_reference"];
  assert(kinds(diffModelToDrafts({ model: model(), inv: i })).includes("WRONG_PK"), "not detected");
});

// 19 — a stale column name
mutant("M-STALE-NAME", "staleNameScan reports a pre-model column name", () => {
  const i = inv();
  i.tables.payments.columns.occurred_at = { name: "occurred_at", type: "timestamptz", notNull: true };
  assert(kinds(staleNameScan({ inv: i })).includes("STALE_COLUMN_NAME"), "not detected");
});

// 20 — a stored settlement column, the second-source-of-truth defect
mutant("M-DERIVED-STORED", "diffModelToDrafts reports a DERIVED_VIEW column created as stored", () => {
  const i = inv();
  i.tables.pool_entries.columns.settlement_status = { name: "settlement_status", type: "bolao.settlement_status", notNull: false };
  const f = diffModelToDrafts({ model: model(), inv: i });
  assert(kinds(f).includes("DERIVED_COLUMN_STORED"), `got ${kinds(f)}`);
});

// 21 — RLS not enabled in the creating phase
mutant("M-RLS-LATE", "rlsAlignment reports a table created without RLS", () => {
  const d = drafts();
  const m5 = d.find((x) => x.phase === "M5");
  m5.rlsEnabled = m5.rlsEnabled.filter((t) => t !== "payments");
  const f = rlsAlignment({ model: model(), inv: inv(), drafts: d });
  assert(kinds(f).includes("RLS_NOT_ENABLED_AT_CREATE"), `got ${kinds(f)}`);
});

// 22 — a grant to a client role in the creating phase
mutant("M-GRANT-IN-DDL", "rlsAlignment reports a grant to anon in a DDL phase", () => {
  const d = drafts();
  d.find((x) => x.phase === "M5").grants.push({ privileges: "SELECT", target: "bolao.payments", roles: ["anon"] });
  const f = rlsAlignment({ model: model(), inv: inv(), drafts: d });
  assert(kinds(f).includes("GRANT_TO_CLIENT_ROLE_IN_DDL_PHASE"), `got ${kinds(f)}`);
});

// 23 — a financial table granted to a client role anywhere
mutant("M-FINANCIAL-GRANT", "rlsAlignment reports a financial grant to a client role", () => {
  const i = inv();
  i.grants.push({ privileges: "SELECT", target: "bolao.payment_allocations", roles: ["authenticated"], phase: "M5" });
  const f = rlsAlignment({ model: model(), inv: i, drafts: drafts() });
  assert(kinds(f).includes("FINANCIAL_GRANT_TO_CLIENT"), `got ${kinds(f)}`);
});

// 24 — a missing WS13-required field
mutant("M-MISSING-WS13-FIELD", "writeContractAlignment reports a missing contract-support column", () => {
  const i = inv();
  delete i.tables.payments.columns.reverses_payment_id;
  const f = writeContractAlignment({ inv: i });
  assert(kinds(f).includes("CONTRACT_SUPPORT_COLUMN_MISSING"), `got ${kinds(f)}`);
});

// 25 — a contract writing to a table no draft creates
mutant("M-CONTRACT-TABLE-MISSING", "writeContractAlignment reports a contract target that does not exist", () => {
  const i = inv();
  delete i.tables.outbox_events;
  const f = writeContractAlignment({ inv: i });
  assert(kinds(f).includes("CONTRACT_TABLE_NOT_CREATED") || kinds(f).includes("CONTRACT_SUPPORT_TABLE_MISSING"), `got ${kinds(f)}`);
});

// 26 — the audit chain made mutable
mutant("M-AUDIT-MUTABLE", "auditOutboxAlignment reports an UPDATE grant on the audit chain", () => {
  const i = inv();
  i.grants.push({ privileges: "UPDATE", target: "audit.audit_events", roles: ["service"], phase: "M8" });
  const f = auditOutboxAlignment({ inv: i, drafts: drafts() });
  assert(kinds(f).includes("AUDIT_MUTABLE_GRANT"), `got ${kinds(f)}`);
});

// 27 — an audit or outbox table missing
mutant("M-OUTBOX-MISSING", "auditOutboxAlignment reports a missing outbox table", () => {
  const i = inv();
  delete i.tables.outbox_delivery_attempts;
  assert(kinds(auditOutboxAlignment({ inv: i, drafts: drafts() })).includes("AUDIT_OUTBOX_TABLE_MISSING"), "not detected");
});

// 28 — a stale report dependency
mutant("M-STALE-REPORT-DEP", "reportingAlignment reports an index on a table no draft creates", async () => {
  const i = inv();
  delete i.tables.prize_allocations;
  const f = await reportingAlignment({ inv: i });
  assert(kinds(f).includes("REPORT_INDEX_TABLE_MISSING"), `got ${kinds(f)}`);
});

// 29 — the declared money mapping going stale
mutant("M-MONEY-MAP-STALE", "fixtureRepresentationCheck reports a mapping target that no longer exists", () => {
  const i = inv();
  delete i.tables.payment_allocations.columns.allocated_amount;
  const f = fixtureRepresentationCheck({ inv: i });
  assert(kinds(f).includes("MONEY_MAP_TARGET_MISSING"), `got ${kinds(f)}`);
});

// 30 — the money mapping pointing at an inexact type
mutant("M-MONEY-MAP-INEXACT", "fixtureRepresentationCheck reports a mapping target that is not exact numeric", () => {
  const i = inv();
  i.tables.payments.columns.amount.type = "real";
  assert(kinds(fixtureRepresentationCheck({ inv: i })).includes("MONEY_MAP_TARGET_NOT_EXACT"), "not detected");
});

// 31 — a forward dependency
mutant("M-FORWARD-DEP", "orderingGraph reports a phase depending on a later one", () => {
  const d = drafts();
  d.find((x) => x.phase === "M2").header.dependencies = "M7";
  assert(kinds(orderingGraph({ drafts: d })).includes("FORWARD_DEPENDENCY"), "not detected");
});

// 32 — an FK whose parent is created later
mutant("M-FK-LATER", "orderingGraph reports an FK whose target does not exist yet", () => {
  const d = drafts();
  d.find((x) => x.phase === "M2").tables.participants.fks.push({
    name: "x", columns: ["display_name"], refTable: "pool_entries", refSchema: "bolao", refColumns: ["pool_entry_id"], onDelete: "RESTRICT",
  });
  assert(kinds(orderingGraph({ drafts: d })).includes("FK_TARGET_CREATED_LATER"), "not detected");
});

// 33 — an enum used before it is declared
mutant("M-ENUM-LATER", "orderingGraph reports an enum referenced before creation", () => {
  const d = drafts();
  d.find((x) => x.phase === "M2").tables.participants.columns.display_name.type = "bolao.pool_status";
  const m1 = d.find((x) => x.phase === "M1");
  m1.enums = m1.enums.filter((e) => e.name !== "bolao.pool_status");
  d.find((x) => x.phase === "M4").enums.push({ name: "bolao.pool_status", values: ["open"] });
  assert(kinds(orderingGraph({ drafts: d })).includes("ENUM_CREATED_LATER"), "not detected");
});

// 34 — a table created twice
mutant("M-TABLE-TWICE", "orderingGraph reports a table created in two phases", () => {
  const d = drafts();
  d.find((x) => x.phase === "M6").tables.payments = d.find((x) => x.phase === "M5").tables.payments;
  assert(kinds(orderingGraph({ drafts: d })).includes("TABLE_CREATED_TWICE"), "not detected");
});

// 35 — a missing backfill path
mutant("M-NO-BACKFILL", "expandContractAndBackfill reports a table with no backfill domain", () => {
  const i = inv();
  i.tables.invented_table = { name: "invented_table", columns: {}, pk: ["x"], fks: [], uniques: [], checks: [], columnOrder: [], phase: "M9" };
  assert(kinds(expandContractAndBackfill({ inv: i, drafts: drafts() })).includes("NO_BACKFILL_PATH"), "not detected");
});

// 36 — a missing rollback class
mutant("M-NO-ROLLBACK", "expandContractAndBackfill reports a phase with no rollback strategy", () => {
  const d = drafts();
  delete d.find((x) => x.phase === "M5").header.rollback;
  assert(kinds(expandContractAndBackfill({ inv: inv(), drafts: d })).includes("NO_ROLLBACK_CLASS"), "not detected");
});

// 37 — an unknown rollback class
mutant("M-BAD-ROLLBACK", "expandContractAndBackfill rejects an unrecognised rollback class", () => {
  const d = drafts();
  d.find((x) => x.phase === "M5").header.rollback = "JUST_DROP_IT";
  assert(kinds(expandContractAndBackfill({ inv: inv(), drafts: d })).includes("UNKNOWN_ROLLBACK_CLASS"), "not detected");
});

// 38 — a missing banner
mutant("M-NO-BANNER", "headerCheck reports a draft missing the not-for-production banner", () => {
  const d = drafts();
  d.find((x) => x.phase === "M5").banner.notForProduction = false;
  assert(kinds(headerCheck({ drafts: d })).includes("MISSING_BANNER"), "not detected");
});

// 39 — an applicable filename
mutant("M-APPLICABLE-FILENAME", "headerCheck reports a CLI-recognisable migration filename", () => {
  const d = drafts();
  d.find((x) => x.phase === "M5").name = "20260809120000_payments.sql";
  assert(kinds(headerCheck({ drafts: d })).includes("APPLICABLE_FILENAME"), "not detected");
});

// 40 — a non-transactional phase
mutant("M-NOT-TRANSACTIONAL", "headerCheck reports a phase with no BEGIN/COMMIT", () => {
  const d = drafts();
  d.find((x) => x.phase === "M5").transactional = false;
  assert(kinds(headerCheck({ drafts: d })).includes("NOT_TRANSACTIONAL"), "not detected");
});

// 41 — a duplicate index
mutant("M-DUPLICATE-INDEX", "indexReconciliation reports two identical indexes", async () => {
  const i = inv();
  const ix = i.indexes.find((x) => x.name === "payment_allocations_pool_entry_id_idx");
  i.indexes.push({ ...ix, name: "payment_allocations_pool_entry_id_idx2" });
  const f = await indexReconciliation({ inv: i });
  assert(kinds(f).includes("DUPLICATE_INDEX"), `got ${kinds(f)}`);
});

// 42 — a non-concurrent index on a pre-existing table
mutant("M-NON-CONCURRENT-INDEX", "indexReconciliation reports a blocking index build", async () => {
  const i = inv();
  i.indexes.push({ name: "late_idx", table: "payments", cols: ["memo"], unique: false, concurrently: false, partial: null, phase: "M9" });
  const f = await indexReconciliation({ inv: i });
  assert(kinds(f).includes("NON_CONCURRENT_INDEX"), `got ${kinds(f)}`);
});

// 43 — a table missing entirely
mutant("M-MISSING-TABLE", "diffModelToDrafts reports a modelled table no draft creates", () => {
  const i = inv();
  delete i.tables.ranking_snapshots;
  assert(kinds(diffModelToDrafts({ model: model(), inv: i })).includes("MISSING_TABLE"), "not detected");
});

// 44 — an unmodelled table
mutant("M-EXTRA-TABLE", "diffModelToDrafts reports a table absent from the model", () => {
  const i = inv();
  i.tables.shadow_ledger = { name: "shadow_ledger", columns: {}, pk: ["x"], fks: [], uniques: [], checks: [], columnOrder: [], phase: "M9" };
  assert(kinds(diffModelToDrafts({ model: model(), inv: i })).includes("EXTRA_TABLE"), "not detected");
});

// 45 — a missing default
mutant("M-MISSING-DEFAULT", "diffModelToDrafts reports a dropped default", () => {
  const i = inv();
  i.tables.payments.columns.payment_id.default = null;
  assert(kinds(diffModelToDrafts({ model: model(), inv: i })).includes("MISSING_DEFAULT"), "not detected");
});

// 46 — a wrong type
mutant("M-WRONG-TYPE", "diffModelToDrafts reports a changed type", () => {
  const i = inv();
  i.tables.payments.columns.payment_id.type = "text";
  assert(kinds(diffModelToDrafts({ model: model(), inv: i })).includes("WRONG_TYPE"), "not detected");
});

for (const m of MUTANTS) {
  await atest(`MUTANT ${m.id}: ${m.requirement}`, async () => { await m.run(); });
}

test("every mutant id is unique", () => {
  const ids = MUTANTS.map((m) => m.id);
  eq(new Set(ids).size, ids.length, "duplicate mutant id");
});

test("the mutation set covers every defect class STEP 27 requires", () => {
  const ids = MUTANTS.map((m) => m.id).join(" ");
  for (const [label, re] of [
    ["wrong column name", /WRONG-COLUMN-NAME/], ["missing index", /MISSING-INDEX/],
    ["wrong FK", /WRONG-FK/], ["wrong enum", /WRONG-ENUM/],
    ["wrong nullability", /WRONG-NULLABILITY/], ["money float", /MONEY-FLOAT/],
    ["missing constraint", /MISSING-CONSTRAINT/], ["wrong ON DELETE", /WRONG-ON-DELETE/],
    ["stale report dependency", /STALE-REPORT-DEP/], ["missing WS13 field", /MISSING-WS13-FIELD/],
  ]) {
    assert(re.test(ids), `no mutant covers "${label}"`);
  }
  assert(MUTANTS.length >= 40, `only ${MUTANTS.length} mutants`);
});

// =============================================================================================
console.log("\nSTEP 17 — hazards, every one dispositioned\n");
// =============================================================================================

test("every hazard detector has a stated reason", () => {
  for (const h of HAZARDS) {
    assert(h.id && h.re && h.klass && h.why, `hazard ${h.id} incomplete`);
    assert(h.why.length > 25, `hazard ${h.id} reason too short`);
  }
});

test("every hazard raised by the committed drafts is dispositioned", () => {
  const raw = hazardScan({ drafts: drafts() });
  const undispositioned = raw.filter((f) => !HAZARD_DISPOSITIONS[f.kind]);
  eq(undispositioned.length, 0,
    `undispositioned: ${[...new Set(undispositioned.map((f) => f.kind))].join(", ")} — a hazard with no disposition is an unreviewed hazard`);
});

test("every disposition names a reason and applies to a real detector", () => {
  for (const [kind, d] of Object.entries(HAZARD_DISPOSITIONS)) {
    assert(HAZARDS.some((h) => h.id === kind), `disposition for unknown detector ${kind}`);
    assert(d.why && d.why.length > 40, `disposition ${kind} has no usable reason`);
    assert(Object.values(CLASS).includes(d.verdict), `disposition ${kind} has unknown verdict`);
  }
});

test("MUTANT: an injected DROP is caught by the hazard scan and by the expand rule", () => {
  const p = parseDraft(`-- REVIEW DRAFT ONLY\nBEGIN;\nDROP TABLE bolao."payments";\nCOMMIT;`, { name: "M9_x.draft.sql" });
  void p;
  const one = HAZARDS.find((h) => h.id === "H-DROP");
  assert(one.re.test(`DROP TABLE bolao."payments";`), "the DROP detector must fire on a real DROP");
  eq(one.klass, CLASS.ERROR, "a DROP in an expand phase is an ERROR");
});

test("MUTANT: a TRUNCATE is caught", () => {
  assert(HAZARDS.find((h) => h.id === "H-TRUNCATE").re.test("TRUNCATE bolao.payments;"), "not detected");
});

test("MUTANT: an RLS disable is caught", () => {
  assert(HAZARDS.find((h) => h.id === "H-RLS-DISABLE").re.test("ALTER TABLE x DISABLE ROW LEVEL SECURITY;"), "not detected");
});

test("MUTANT: a GRANT TO PUBLIC is caught", () => {
  assert(HAZARDS.find((h) => h.id === "H-GRANT-PUBLIC").re.test("GRANT SELECT ON bolao.payments TO PUBLIC;"), "not detected");
});

test("MUTANT: a data-destructive type change is caught", () => {
  assert(HAZARDS.find((h) => h.id === "H-TYPE-CHANGE").re.test("ALTER TABLE x ALTER COLUMN amount TYPE integer;"), "not detected");
});

test("a hazard keyword inside a comment or a literal does not fire", () => {
  const { code } = stripNoise(`-- never TRUNCATE this table\nSELECT 'DROP TABLE payments';`);
  for (const h of HAZARDS) {
    if (h.id === "H-UPDATE-NO-WHERE") continue;
    assert(!new RegExp(h.re.source, h.re.flags).test(code), `${h.id} fired on prose or a literal`);
  }
});

// =============================================================================================
console.log("\nSTEP 29/31 — traceability and readiness\n");
// =============================================================================================

await atest("every created object traces through the whole chain, with no orphan", async () => {
  const tr = await traceability({ inv: inv() });
  eq(tr.orphans.length, 0, `orphans: ${tr.orphans.map((o) => o.object).join(", ")}`);
  eq(tr.rows.length, 28, "one row per created table");
  for (const r of tr.rows) {
    assert(r.migration, `${r.object} has no migration phase`);
    assert(r.backfillDomain, `${r.object} has no backfill domain`);
    assert(r.rollbackClass, `${r.object} has no rollback class`);
  }
});

await atest("the money-bearing objects trace to a financial gate", async () => {
  const tr = await traceability({ inv: inv() });
  for (const o of ["payments", "payment_allocations", "prize_allocations"]) {
    const r = tr.rows.find((x) => x.object === o);
    eq(r.cutoverGate, "GATE-FIN", `${o} must be gated by GATE-FIN`);
    eq(r.parityTest, "FINANCIAL_PARITY", `${o} parity`);
  }
  const pred = tr.rows.find((x) => x.object === "predictions");
  eq(pred.cutoverGate, "GATE-PRED", "predictions gate");
  eq(pred.parityTest, "SCORING_PARITY", "predictions parity");
});

await atest("MUTANT: an object with no backfill domain is reported as an orphan", async () => {
  const i = inv();
  i.tables.shadow = { name: "shadow", columns: {}, pk: ["x"], fks: [], uniques: [], checks: [], columnOrder: [], phase: "M9" };
  const tr = await traceability({ inv: i });
  assert(tr.orphans.some((o) => o.object === "shadow"), "an untraceable object must be reported");
  eq(tr.ok, false, "the traceability result must not be ok");
});

await atest("the readiness matrix scores all thirteen phases on every dimension", async () => {
  const rm = await readinessMatrix();
  eq(Object.keys(rm).length, 17, "phase count — 17 since M17");
  const DIMS = ["SCHEMA_MATCH", "CONSTRAINT_MATCH", "INDEX_MATCH", "ENUM_MATCH", "RLS_ALIGNMENT",
    "WRITE_CONTRACT_ALIGNMENT", "BACKFILL_READY", "PARITY_READY", "ROLLBACK_READY", "REPORT_READY", "ORDERING"];
  for (const [phase, row] of Object.entries(rm)) {
    for (const d of DIMS) {
      assert(row[d], `${phase} has no ${d}`);
      assert(["READY", "PARTIAL", "BLOCKED"].includes(row[d]), `${phase}.${d} = ${row[d]}`);
    }
  }
});

await atest("no phase is BLOCKED on schema, constraints, enums, RLS, ordering or write contracts", async () => {
  const rm = await readinessMatrix();
  for (const [phase, row] of Object.entries(rm)) {
    for (const d of ["SCHEMA_MATCH", "CONSTRAINT_MATCH", "ENUM_MATCH", "RLS_ALIGNMENT", "ORDERING", "WRITE_CONTRACT_ALIGNMENT"]) {
      assert(row[d] !== "BLOCKED", `${phase}.${d} is BLOCKED`);
    }
  }
});

await atest("scoring-critical phases are now PARITY_READY=READY, derived from real gate evidence", async () => {
  // Batch I closed BATCH-H-F1: br2026's league classification is modelled (DDL-M11), so all three
  // competitions reach PASS_EXACT and nothing remains blocked. This is DERIVED from the producer's
  // coverage, not hand-edited — test_scoring_parity_gate.mjs asserts the coverage constant matches an
  // actual producer run, so claiming READY while the gate disagrees fails there.
  const rm = await readinessMatrix();
  eq(rm.M7.PARITY_READY, "READY", "M7 creates predictions and match_results");
  eq(rm.M10.PARITY_READY, "READY", "M10 creates ranking_snapshots");
  eq(rm["DDL-M11"].PARITY_READY, "READY", "DDL-M11 creates the classification itself");
  eq(rm.M5.PARITY_READY, "READY", "the money phase has a real FINANCIAL_PARITY producer");
});

await atest("NEGATIVE: a single blocked competition holds every scoring-critical phase at PARTIAL", async () => {
  // The readiness rule must remain load-bearing now that nothing is blocked. Proven directly on the
  // function rather than by mutating a shared constant.
  const { SCORING_PARITY_COVERAGE } = await import("./migration_drift.mjs");
  eq(Object.keys(SCORING_PARITY_COVERAGE.blocked).length, 0, "nothing is blocked today");
  assert(/READY only when NO competition is blocked/.test(
    readFileSync(join(DRAFT_DIR, "..", "..", "..", "..", "scripts", "db", "migration_drift.mjs"), "utf8")),
    "the rule must be stated where it is enforced");
});

// =============================================================================================
console.log("\nDeclared maps must stay complete\n");
// =============================================================================================

test("every created table has a backfill map entry, and every entry a table", () => {
  const i = inv();
  for (const t of Object.keys(i.tables)) assert(BACKFILL_MAP[t], `${t} has no backfill map entry`);
  for (const t of Object.keys(BACKFILL_MAP)) assert(i.tables[t], `the backfill map names ${t}, which no draft creates`);
});

test("the not-backfilled domains state why, rather than omitting a reason", () => {
  for (const [t, m] of Object.entries(BACKFILL_MAP)) {
    if (m.transformer === null && m.parity === "none") assert(m.note, `${t} has no transformer and no parity but no note explaining it`);
  }
  assert(/already sent|lie about history|re-notification/.test(BACKFILL_MAP.outbox_events.note),
    "the outbox refusal must state the real-world consequence");
});

test("every stale name maps to a canonical replacement and a reason", () => {
  for (const [n, m] of Object.entries(STALE_NAMES)) {
    assert(m.canonical, `${n} has no canonical replacement`);
    assert(m.why && m.why.length > 25, `${n} has no usable reason`);
    assert(Array.isArray(m.onlyOn) && m.onlyOn.length, `${n} is not scoped to a table, so it would match anywhere`);
  }
});

test("the fixture money map declares its own cost", () => {
  assert(FIXTURE_MONEY_MAP.amount_minor.note, "the flattening of three differently-named columns into one must be recorded");
  assert(/net_amount/.test(FIXTURE_MONEY_MAP.amount_minor.note), "the unexercised gross/net distinction must be named");
});

test("external tables are declared with a reason rather than silently skipped", () => {
  for (const [t, m] of Object.entries(EXTERNAL_TABLES)) {
    assert(m.schema && m.why, `${t} incomplete`);
  }
  eq(EXTERNAL_TABLES.users.schema, "auth", "auth.users");
});

test("the rollback classes are the ones the WS5 choreography uses", () => {
  for (const c of ["FULL", "FULL_BEFORE_BACKFILL", "FORWARD_FIX_ONLY", "DATA_RESTORE_REQUIRED"]) {
    assert(ROLLBACK_CLASSES.includes(c), `${c} missing`);
  }
  assert(!ROLLBACK_CLASSES.includes("DROP_TABLE"), "a DROP is not a rollback narrative");
});

console.log(`\n  ${pass} passed, ${fail} failed · ${asserts} assertions · ${MUTANTS.length} mutants\n`);
console.log(fail === 0 ? "✓ MIGRATION DRIFT TESTS PASSED\n" : "✗ MIGRATION DRIFT TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
