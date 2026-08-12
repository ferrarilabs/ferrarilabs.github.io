#!/usr/bin/env node
/**
 * Tests for the migration harness (Workstream O).
 *
 * All fixtures are synthetic SQL strings and hand-written snapshot documents. No database is contacted;
 * a test that needed one would not be able to prove the harness works without one, which is the whole
 * point of snapshots being plain JSON.
 *
 * The harness's most important property is a negative one: it cannot apply anything. That is tested by
 * source scan, because the guarantee is about what the code does NOT contain.
 */

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MIGRATION_NAME_RE, classifyFile, scanMigrationDir, stripSqlNoise, classifySql,
  DESTRUCTIVE_PATTERNS, WRITE_CLASSES, auditMigrationSet, buildManifest, dependencyGraph,
  diffSnapshots, classifyDiff, prePostValidate, isEmptyDiff, EMPTY_SNAPSHOT, sha256,
  PROVENANCE, declaredProvenance, ledgerProvenance, classifyLedgerProvenance,
  malformedLedgerRow, LEDGER_SNAPSHOT_SQL,
} from "./migration_harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/** Build a throwaway migration directory. Uses the OS temp dir, never the repo. */
function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "mh-"));
  try { for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body); return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("\nFilename validation\n");

test("a well-formed migration name is accepted", () => {
  eq(classifyFile("20260807120000_create_participants.sql").kind, "MIGRATION", "kind");
  eq(classifyFile("20260807120000_create_participants.sql").version, "20260807120000", "version");
});

test("names that are not migrations are rejected with a reason", () => {
  for (const bad of ["create_participants.sql", "2026_create.sql", "20260807120000-create.sql",
                     "20260807120000_CreateParticipants.sql", "20260807120000_create participants.sql",
                     "20260807120000_create__participants.sql"]) {
    const c = classifyFile(bad);
    eq(c.kind, "INVALID", `${bad} should be invalid`);
    assert(c.reason, `${bad} rejected with no reason`);
  }
});

test("an implausible timestamp is rejected", () => {
  eq(classifyFile("20261307120000_x.sql").kind, "INVALID", "month 13");
  eq(classifyFile("20260807990000_x.sql").kind, "INVALID", "hour 99");
  eq(classifyFile("19990807120000_x.sql").kind, "INVALID", "year 1999");
});

test("the baseline reference is classified as NON_MIGRATION, not invalid", () => {
  const c = classifyFile("BASELINE_current_production_state.reference.sql");
  eq(c.kind, "NON_MIGRATION",
    "the baseline is deliberately named so the CLI will not recognise it — registering it would collide with the existing ledger row's primary key");
});

test("a rollback plan is not itself a migration", () => {
  eq(classifyFile("20260807120000_x.rollback.sql").kind, "NON_MIGRATION", "rollback files must not apply as migrations");
});

console.log("\nOrdering and duplicates\n");

test("duplicate versions are an ERROR — version is the ledger primary key", () => {
  withDir({ "20260101000000_a.sql": "SELECT 1;", "20260101000000_b.sql": "SELECT 2;" }, (dir) => {
    const s = scanMigrationDir(dir);
    assert(s.findings.some((f) => f.severity === "ERROR" && /duplicate migration version/.test(f.message)), "not reported");
  });
});

test("identical content under two names is a WARN", () => {
  withDir({ "20260101000000_a.sql": "CREATE TABLE t (id int);", "20260102000000_b.sql": "CREATE TABLE t (id int);" }, (dir) => {
    const s = scanMigrationDir(dir);
    assert(s.findings.some((f) => /identical content/.test(f.message)), "not reported");
  });
});

test("a valid set produces no ERROR findings", () => {
  withDir({ "20260101000000_a.sql": "CREATE TABLE a (id int);", "20260102000000_b.sql": "CREATE TABLE b (id int);" }, (dir) => {
    const s = scanMigrationDir(dir);
    eq(s.findings.filter((f) => f.severity === "ERROR").length, 0, `findings: ${JSON.stringify(s.findings)}`);
  });
});

test("a missing directory is INFO, not a crash", () => {
  const s = scanMigrationDir(join(tmpdir(), "definitely-not-here-" + Date.now()));
  eq(s.exists, false, "exists");
  eq(s.findings[0].severity, "INFO", "severity");
});

console.log("\nSQL noise stripping — a classifier must read SQL, not prose\n");

test("comments and literals are stripped before matching", () => {
  const sql = `-- DROP TABLE payments
    /* TRUNCATE everything */
    INSERT INTO audit_events (action) VALUES ('DROP TABLE payments');`;
  const code = stripSqlNoise(sql);
  assert(!/DROP\s+TABLE/i.test(code), "a DROP TABLE inside a comment must not be seen as code");
  assert(!/TRUNCATE/i.test(code), "TRUNCATE inside a block comment must not be seen");
  assert(/INSERT\s+INTO/i.test(code), "the real statement must survive stripping");
});

test("a destructive keyword inside a string literal is not a finding", () => {
  const c = classifySql("INSERT INTO audit_events (action) VALUES ('TRUNCATE');");
  assert(!c.classes.includes(WRITE_CLASSES.DESTRUCTIVE_DDL),
    "this exact false positive occurred earlier in the programme: 'TRUNCATE' in a literal flagged as DML");
  assert(c.classes.includes(WRITE_CLASSES.DML), "it is still DML");
});

test("dollar-quoted function bodies are stripped", () => {
  const c = classifySql("CREATE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE t; END $$ LANGUAGE plpgsql;");
  assert(!c.destructive.some((d) => d.id === "DROP_TABLE"),
    "a DROP inside a function body is not executed at migration time and must not be reported as if it were");
});

console.log("\nDestructive detection and write classification\n");

test("every destructive pattern fires on its own example", () => {
  const examples = {
    DROP_TABLE: "DROP TABLE payments;",
    DROP_COLUMN: "ALTER TABLE payments DROP COLUMN memo;",
    DROP_SCHEMA: "DROP SCHEMA bolao CASCADE;",
    TRUNCATE: "TRUNCATE payments;",
    DELETE_NO_WHERE: "DELETE FROM payments;",
    UPDATE_NO_WHERE: "UPDATE payments SET amount = 0;",
    DROP_POLICY: "DROP POLICY p ON payments;",
    DISABLE_RLS: "ALTER TABLE payments DISABLE ROW LEVEL SECURITY;",
    DROP_CONSTRAINT: "ALTER TABLE payments DROP CONSTRAINT ck;",
    DROP_INDEX: "DROP INDEX idx;",
    ALTER_TYPE: "ALTER TABLE payments ALTER COLUMN amount TYPE numeric(14,2);",
  };
  for (const p of DESTRUCTIVE_PATTERNS) {
    const ex = examples[p.id];
    assert(ex, `no example for ${p.id} — an unexercised pattern is unproven`);
    const c = classifySql(ex);
    assert(c.destructive.some((d) => d.id === p.id), `${p.id} did not fire on "${ex}"`);
  }
});

test("every destructive pattern states why it is destructive", () => {
  for (const p of DESTRUCTIVE_PATTERNS) assert(p.why, `${p.id} has no rationale`);
});

test("a qualified DELETE or UPDATE is not flagged as unqualified", () => {
  assert(!classifySql("DELETE FROM payments WHERE payment_id = '1';").destructive.some((d) => d.id === "DELETE_NO_WHERE"), "qualified DELETE");
  assert(!classifySql("UPDATE payments SET memo = 'x' WHERE payment_id = '1';").destructive.some((d) => d.id === "UPDATE_NO_WHERE"), "qualified UPDATE");
});

test("additive DDL is classified as additive and not destructive", () => {
  const c = classifySql("CREATE TABLE participants (participant_id uuid primary key);");
  assert(c.classes.includes(WRITE_CLASSES.ADDITIVE_DDL), "additive");
  assert(!c.classes.includes(WRITE_CLASSES.DESTRUCTIVE_DDL), "not destructive");
});

test("privilege and security changes are classified separately", () => {
  assert(classifySql("GRANT SELECT ON t TO anon;").classes.includes(WRITE_CLASSES.PRIVILEGE), "privilege");
  assert(classifySql("CREATE POLICY p ON t FOR SELECT USING (true);").classes.includes(WRITE_CLASSES.SECURITY), "security");
  assert(classifySql("ALTER TABLE t ENABLE ROW LEVEL SECURITY;").classes.includes(WRITE_CLASSES.SECURITY), "rls");
});

test("a non-concurrent index build is warned about", () => {
  assert(classifySql("CREATE INDEX idx ON t (a);").findings.some((f) => f.id === "NON_CONCURRENT_INDEX"), "not warned");
  assert(!classifySql("CREATE INDEX CONCURRENTLY idx ON t (a);").findings.some((f) => f.id === "NON_CONCURRENT_INDEX"), "concurrent is fine");
});

test("ADD CONSTRAINT without NOT VALID is warned about", () => {
  assert(classifySql("ALTER TABLE t ADD CONSTRAINT ck CHECK (a > 0);").findings.some((f) => f.id === "VALIDATING_CONSTRAINT"), "not warned");
  assert(!classifySql("ALTER TABLE t ADD CONSTRAINT ck CHECK (a > 0) NOT VALID;").findings.some((f) => f.id === "VALIDATING_CONSTRAINT"), "NOT VALID is fine");
});

test("SECURITY DEFINER without search_path is an ERROR", () => {
  const c = classifySql("CREATE FUNCTION f() RETURNS void SECURITY DEFINER AS 'x' LANGUAGE sql;");
  assert(c.findings.some((f) => f.id === "DEFINER_WITHOUT_SEARCH_PATH" && f.severity === "ERROR"),
    "SECURITY DEFINER without an explicit search_path is a privilege-escalation vector");
});

test("SECURITY DEFINER with a QUOTED search_path is not a finding", () => {
  // pg_dump always emits `SET "search_path" TO …`. The detector originally matched only the
  // unquoted spelling, so every dump-shaped file — including the M0 baseline, whose 25 SECURITY
  // DEFINER functions all set search_path — was reported as a privilege-escalation vector.
  const c = classifySql(
    `CREATE FUNCTION "public"."f"() RETURNS void LANGUAGE "plpgsql" SECURITY DEFINER\n` +
    `    SET "search_path" TO 'public'\n    AS $$BEGIN END$$;`);
  assert(!c.findings.some((f) => f.id === "DEFINER_WITHOUT_SEARCH_PATH"),
    "a quoted search_path is an explicit search_path");
});

test("search_path as a mere name prefix does not satisfy the detector", () => {
  // The quoted-form fix must not widen into matching any identifier that starts with search_path.
  const c = classifySql("CREATE FUNCTION f() RETURNS void SECURITY DEFINER SET search_path_backup TO 'x' AS 'y' LANGUAGE sql;");
  assert(c.findings.some((f) => f.id === "DEFINER_WITHOUT_SEARCH_PATH"),
    "search_path_backup is a different setting");
});

console.log("\nRollback plan presence\n");

test("a destructive migration with no rollback plan is an ERROR", () => {
  withDir({ "20260101000000_drop.sql": "DROP TABLE payments;" }, (dir) => {
    const a = auditMigrationSet(dir);
    assert(a.findings.some((f) => f.severity === "ERROR" && /no .*rollback\.sql/.test(f.message)), "not reported");
  });
});

test("a destructive migration WITH a rollback plan is accepted", () => {
  withDir({
    "20260101000000_drop.sql": "DROP TABLE payments;",
    "20260101000000_drop.rollback.sql": "CREATE TABLE payments (payment_id uuid primary key);",
  }, (dir) => {
    const a = auditMigrationSet(dir);
    eq(a.entries[0].rollback, "20260101000000_drop.rollback.sql", "rollback linked");
    assert(!a.findings.some((f) => f.severity === "ERROR" && /rollback/.test(f.message)), "should not error");
  });
});

console.log("\nSHA manifest\n");

test("the manifest carries digests, never file contents", () => {
  const m = buildManifest([{ version: "20260101000000", digest: sha256("secret sql"), name: "a.sql" }]);
  assert(!m.entries.join("\n").includes("secret sql"), "the manifest must be safe to publish even when the SQL is not");
  assert(/^[0-9a-f]{64}$/.test(m.rollup), "rollup is a sha256");
});

test("the rollup changes when any file changes", () => {
  const a = buildManifest([{ version: "1", digest: sha256("x"), name: "a.sql" }]);
  const b = buildManifest([{ version: "1", digest: sha256("y"), name: "a.sql" }]);
  assert(a.rollup !== b.rollup, "a changed migration must change the rollup or the manifest proves nothing");
});

test("the rollup is stable for identical input", () => {
  const mk = () => buildManifest([{ version: "1", digest: sha256("x"), name: "a.sql" }]);
  eq(mk().rollup, mk().rollup, "rollup must be deterministic");
});

console.log("\nDependency graph\n");

test("a migration referencing an earlier migration's table gains an edge", () => {
  const entries = [{ name: "a.sql" }, { name: "b.sql" }];
  const bodies = new Map([
    ["a.sql", "CREATE TABLE participants (participant_id uuid primary key);"],
    ["b.sql", "CREATE TABLE pool_entries (participant_id uuid REFERENCES participants(participant_id));"],
  ]);
  const g = dependencyGraph(entries, bodies);
  assert(g.edges.some((e) => e.from === "b.sql" && e.to === "a.sql"), `no edge found: ${JSON.stringify(g.edges)}`);
});

test("a self-contained migration gains no edge", () => {
  const g = dependencyGraph([{ name: "a.sql" }], new Map([["a.sql", "CREATE TABLE t (id int);"]]));
  eq(g.edges.length, 0, "no dependency expected");
});

console.log("\nSchema snapshot diff\n");

const before = {
  tables: { participants: { participant_id: "uuid", email: "text" }, payments: { payment_id: "uuid", amount: "numeric(14,2)" } },
  primaryKeys: { participants: ["participant_id"], payments: ["payment_id"] },
  foreignKeys: { fk_pay_participant: "payments.payer_id → participants.participant_id" },
  uniques: { uq_email: "participants(email)" },
  checks: { ck_amount: "amount <> 0" },
  indexes: { idx_pay_paid_at: "payments(paid_at)" },
  rls: { participants: { enabled: true, forced: false }, payments: { enabled: true, forced: false } },
  policies: { p_participants_select: "md5:aaa" },
  acls: { payments: { anon: ["SELECT"], service_role: ["SELECT", "INSERT"] } },
  enums: { payment_kind: ["contribution", "refund"] },
  functions: { fn_touch: "md5:bbb" },
  triggers: { tr_touch: "payments BEFORE UPDATE" },
};

test("identical snapshots produce an empty diff", () => {
  const d = diffSnapshots(before, JSON.parse(JSON.stringify(before)));
  assert(d.empty, `expected empty, got ${JSON.stringify(d)}`);
  eq(classifyDiff(d).verdict, "NO_CHANGE", "verdict");
});

test("isEmptyDiff is not vacuous — it returns false for a real change", () => {
  const after = JSON.parse(JSON.stringify(before));
  after.tables.new_table = { id: "uuid" };
  assert(!isEmptyDiff(diffSnapshots(before, after)), "a new table must not read as an empty diff");
});

test("a dropped table is CRITICAL", () => {
  const after = JSON.parse(JSON.stringify(before)); delete after.tables.payments;
  eq(classifyDiff(diffSnapshots(before, after)).verdict, "CRITICAL", "verdict");
});

test("a dropped column is CRITICAL", () => {
  const after = JSON.parse(JSON.stringify(before)); delete after.tables.payments.amount;
  const d = diffSnapshots(before, after);
  assert(d.columns.removed.includes("payments.amount"), "column removal detected");
  eq(classifyDiff(d).verdict, "CRITICAL", "verdict");
});

test("a changed column type is detected as changed, not added/removed", () => {
  const after = JSON.parse(JSON.stringify(before)); after.tables.payments.amount = "double precision";
  const d = diffSnapshots(before, after);
  assert(d.columns.changed.includes("payments.amount"), "type change must be visible");
  eq(d.columns.removed.length, 0, "not a removal");
});

test("RLS being disabled is CRITICAL, and being enabled is reported too", () => {
  const off = JSON.parse(JSON.stringify(before)); off.rls.payments.enabled = false;
  const d1 = diffSnapshots(before, off);
  assert(d1.rls.disabled.includes("payments"), "disable detected");
  eq(classifyDiff(d1).verdict, "CRITICAL", "verdict");
  const on = JSON.parse(JSON.stringify(before)); on.rls.participants.enabled = false;
  assert(diffSnapshots(on, before).rls.enabled.includes("participants"), "enable detected in the other direction");
});

test("FORCE RLS changes are detected in both directions", () => {
  const forced = JSON.parse(JSON.stringify(before)); forced.rls.payments.forced = true;
  assert(diffSnapshots(before, forced).rls.forced.includes("payments"), "forced");
  assert(diffSnapshots(forced, before).rls.unforced.includes("payments"), "unforced");
});

test("a removed policy is CRITICAL and a changed policy body is detected", () => {
  const gone = JSON.parse(JSON.stringify(before)); delete gone.policies.p_participants_select;
  eq(classifyDiff(diffSnapshots(before, gone)).verdict, "CRITICAL", "removal");
  const changed = JSON.parse(JSON.stringify(before)); changed.policies.p_participants_select = "md5:zzz";
  assert(diffSnapshots(before, changed).policies.changed.includes("p_participants_select"),
    "a policy body change is detected by hash without ever printing the expression");
});

test("a new grant is CRITICAL, and a revoke is reported separately", () => {
  const granted = JSON.parse(JSON.stringify(before)); granted.acls.payments.anon.push("DELETE");
  const d = diffSnapshots(before, granted);
  assert(d.acls.granted.includes("payments:anon:DELETE"), "grant detected");
  eq(classifyDiff(d).verdict, "CRITICAL", "a new privilege is always critical, regardless of intent");
  const revoked = JSON.parse(JSON.stringify(before)); revoked.acls.payments.anon = [];
  assert(diffSnapshots(before, revoked).acls.revoked.includes("payments:anon:SELECT"), "revoke detected");
});

test("a new grantee appearing from nowhere is detected", () => {
  const after = JSON.parse(JSON.stringify(before)); after.acls.payments.some_new_role = ["SELECT"];
  assert(diffSnapshots(before, after).acls.granted.includes("payments:some_new_role:SELECT"), "not detected");
});

test("enum, function and trigger changes are detected", () => {
  const a = JSON.parse(JSON.stringify(before)); a.enums.payment_kind.push("chargeback");
  assert(diffSnapshots(before, a).enums.changed.includes("payment_kind"), "enum");
  const b = JSON.parse(JSON.stringify(before)); b.functions.fn_touch = "md5:ccc";
  assert(diffSnapshots(before, b).functions.changed.includes("fn_touch"), "function");
  const c = JSON.parse(JSON.stringify(before)); delete c.triggers.tr_touch;
  assert(diffSnapshots(before, c).triggers.removed.includes("tr_touch"), "trigger");
});

test("PK, FK, UNIQUE and CHECK changes are each detected", () => {
  const pk = JSON.parse(JSON.stringify(before)); pk.primaryKeys.payments = ["payment_id", "currency"];
  assert(diffSnapshots(before, pk).primaryKeys.changed.includes("payments"), "pk");
  const fk = JSON.parse(JSON.stringify(before)); delete fk.foreignKeys.fk_pay_participant;
  assert(diffSnapshots(before, fk).foreignKeys.removed.includes("fk_pay_participant"), "fk");
  const uq = JSON.parse(JSON.stringify(before)); delete uq.uniques.uq_email;
  assert(diffSnapshots(before, uq).uniques.removed.includes("uq_email"), "unique");
  const ck = JSON.parse(JSON.stringify(before)); delete ck.checks.ck_amount;
  assert(diffSnapshots(before, ck).checks.removed.includes("ck_amount"), "check");
});

test("an empty snapshot compared against a populated one reports everything as added", () => {
  const d = diffSnapshots(EMPTY_SNAPSHOT, before);
  assert(d.tables.added.length === 2, "tables added");
  assert(d.policies.added.length === 1, "policies added");
});

console.log("\nPre/post validation runner\n");

test("an expected change is accounted for", () => {
  const after = JSON.parse(JSON.stringify(before)); after.tables.new_table = { id: "uuid" };
  const r = prePostValidate({ before, after, expected: { tables: { added: ["new_table"] } } });
  eq(r.unaccounted.length, 0, `unaccounted: ${r.unaccounted.join(", ")}`);
  eq(r.verdict, "MINOR", "verdict");
});

test("an UNEXPECTED change is reported as unaccounted — the programme's original finding", () => {
  const after = JSON.parse(JSON.stringify(before));
  after.tables.new_table = { id: "uuid" };
  after.acls.payments.anon.push("DELETE");   // nobody asked for this
  const r = prePostValidate({ before, after, expected: { tables: { added: ["new_table"] } } });
  assert(r.unaccounted.some((u) => /acls\.granted: payments:anon:DELETE/.test(u)),
    "an unaccounted grant is exactly the condition that produced this programme: a schema whose grants no migration explains");
  eq(r.verdict, "UNACCOUNTED_CHANGE", "verdict");
});

test("no change at all yields NO_CHANGE", () => {
  eq(prePostValidate({ before, after: JSON.parse(JSON.stringify(before)) }).verdict, "NO_CHANGE", "verdict");
});

test("expected removals must also be declared to be accounted for", () => {
  const after = JSON.parse(JSON.stringify(before)); delete after.tables.payments;
  const bare = prePostValidate({ before, after });
  eq(bare.verdict, "UNACCOUNTED_CHANGE", "an undeclared table drop must never be silently accepted");
  const declared = prePostValidate({ before, after, expected: { tables: { removed: ["payments"] }, primaryKeys: { removed: ["payments"] } } });
  assert(declared.unaccounted.every((u) => !/tables\.removed/.test(u)), "declared removal should be accounted");
});

console.log("\nThe harness cannot apply anything (the negative guarantee)\n");

test("no database client, connection string, or apply path exists in the harness", () => {
  const src = readFileSync(join(HERE, "migration_harness.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const re of [/require\(['"]pg['"]\)/, /from ['"]pg['"]/, /postgres:\/\//i, /execFileSync\s*\(\s*['"]psql/,
                    /supabase\s+db\s+push/i, /migration\s+repair/i, /child_process/]) {
    assert(!re.test(src), `the harness must have no execution path (matched ${re}) — a harness that can apply is one someone will use to apply`);
  }
});

test("the real migrations directory audits without ERROR findings", () => {
  const a = auditMigrationSet(join(HERE, "..", "..", "supabase", "migrations"));
  const errs = a.findings.filter((f) => f.severity === "ERROR");
  eq(errs.length, 0, `errors: ${errs.map((e) => e.message).join("; ")}`);
});

console.log("\nLedger provenance — the M0 truthfulness discriminator\n");

const F = (name, body) => ({ name, version: name.slice(0, 14), body, kind: "MIGRATION", digest: "x" });
const EXEC_H = "-- PROVENANCE: MIGRATION_APPLIED_HISTORICALLY\n";
const ADOPT_H = "-- PROVENANCE: BASELINE_ADOPTED_AT_CURRENT_STATE\n";

/** The exact post-M0 shape Option E produces: two adopted baselines around one executed migration. */
const M0_FILES = [
  F("20260101000000_baseline_adopted_pre_tracking.sql", ADOPT_H + "create table bolao_state (id text primary key);"),
  F("20260806143644_add_minimal_powerball_schema.sql", EXEC_H + "create table lottery_draws (id uuid primary key);"),
  F("20260806143700_baseline_adopted_grants_and_policies.sql", ADOPT_H + "grant select on bolao_state to anon;"),
];
const M0_LEDGER = [
  { version: "20260101000000", name: "baseline_adopted_pre_tracking", statements: null },
  { version: "20260806143644", name: "add_minimal_powerball_schema", statements: ["create table lottery_draws (id uuid primary key);"] },
  { version: "20260806143700", name: "baseline_adopted_grants_and_policies", statements: null },
];

test("declaredProvenance reads the header, and its absence is UNDECLARED", () => {
  eq(declaredProvenance(EXEC_H + "select 1;"), PROVENANCE.EXECUTED, "executed");
  eq(declaredProvenance(ADOPT_H + "select 1;"), PROVENANCE.ADOPTED, "adopted");
  eq(declaredProvenance("select 1;"), PROVENANCE.UNDECLARED, "undeclared");
  eq(declaredProvenance("-- PROVENANCE: SOMETHING_ELSE\nselect 1;"), PROVENANCE.UNDECLARED, "an unrecognised value is not silently accepted");
});

test("ledgerProvenance treats recorded statements as executed and their absence as adopted", () => {
  eq(ledgerProvenance({ statements: ["create table t();"] }), PROVENANCE.EXECUTED, "statements present");
  eq(ledgerProvenance({ statements: null }), PROVENANCE.ADOPTED, "null statements — what migration repair leaves");
  eq(ledgerProvenance({ statements: [] }), PROVENANCE.ADOPTED, "empty array is also nothing executed");
  eq(ledgerProvenance({}), PROVENANCE.ADOPTED, "an absent column means no statements were recorded");
});

test("the expected post-M0 state is CONSISTENT, with adopted and executed correctly partitioned", () => {
  const r = classifyLedgerProvenance(M0_LEDGER, M0_FILES);
  eq(r.verdict, "CONSISTENT", `findings: ${r.findings.map((f) => f.message).join(" | ")}`);
  eq(JSON.stringify(r.adopted), JSON.stringify(["20260101000000", "20260806143700"]), "the two baselines are adopted");
  eq(JSON.stringify(r.executed), JSON.stringify(["20260806143644"]), "the pre-existing migration remains genuine executed history");
});

test("a file falsely claiming it was EXECUTED is caught — the forbidden claim", () => {
  const files = M0_FILES.map((f) => f.version === "20260101000000"
    ? { ...f, body: EXEC_H + "create table bolao_state (id text primary key);" } : f);
  const r = classifyLedgerProvenance(M0_LEDGER, files);
  eq(r.verdict, "INCONSISTENT", "must not pass");
  assert(r.findings.some((f) => /truthfulness principle forbids/.test(f.message)),
    "a file claiming execution while the ledger holds no statements is exactly the false claim the principle forbids");
});

test("a file understating real history as adopted is also caught", () => {
  const files = M0_FILES.map((f) => f.version === "20260806143644"
    ? { ...f, body: ADOPT_H + "create table lottery_draws (id uuid primary key);" } : f);
  const r = classifyLedgerProvenance(M0_LEDGER, files);
  eq(r.verdict, "INCONSISTENT", "must not pass");
  assert(r.findings.some((f) => /understates real history/.test(f.message)), "understatement is a finding too");
});

test("a migration file with no PROVENANCE header is rejected", () => {
  const files = M0_FILES.map((f) => ({ ...f, body: f.body.replace(/^--.*\n/, "") }));
  const r = classifyLedgerProvenance(M0_LEDGER, files);
  assert(r.findings.some((f) => /declares no PROVENANCE header/.test(f.message)),
    "leaving the distinction to inference is what this check exists to prevent");
});

// ── KPLUS-F003 ─────────────────────────────────────────────────────────────────────────────────
// The classifier's input shape was a convention nobody had written down, and the obvious way to read a
// text[] out of psql produces the wrong one. Proven against a real ledger in the campaign K+ A9
// rehearsal; pinned here so the shape contract is enforced rather than remembered.

test("a PostgreSQL array literal string is diagnosed as a bad READ, not a provenance disagreement", () => {
  const naive = M0_LEDGER.map((r) => ({ ...r, statements: r.statements === null ? "" : `{"${r.statements[0]}"}` }));
  const r = classifyLedgerProvenance(naive, M0_FILES);
  eq(r.verdict, "INCONSISTENT", "a wrongly-shaped snapshot must never be accepted");
  assert(r.findings.some((f) => /array literal string/.test(f.message)),
    "the message must point at the QUERY, not at migration headers that were never wrong");
  assert(r.findings.some((f) => /LEDGER_SNAPSHOT_SQL/.test(f.message)), "and must name the supported read");
});

test("malformedLedgerRow accepts every shape that transports correctly and rejects the rest", () => {
  eq(malformedLedgerRow({ statements: null }), null, "null is fine");
  eq(malformedLedgerRow({}), null, "absent is fine");
  eq(malformedLedgerRow({ statements: [] }), null, "empty array is fine");
  eq(malformedLedgerRow({ statements: ["create table t();"] }), null, "a real array is fine");
  assert(malformedLedgerRow({ statements: '{"create table t();"}' }), "an array literal is not");
  assert(malformedLedgerRow({ statements: 3 }), "a number is not");
});

test("LEDGER_SNAPSHOT_SQL reads exactly the three columns the classifier consumes, via JSON", () => {
  assert(/json_agg/.test(LEDGER_SNAPSHOT_SQL), "JSON transport is what preserves array-vs-null");
  assert(/row_to_json/.test(LEDGER_SNAPSHOT_SQL), "rows become objects");
  assert(/ORDER BY t\.version/.test(LEDGER_SNAPSHOT_SQL), "deterministic order, so two snapshots are comparable");
  for (const col of ["version", "name", "statements"]) assert(new RegExp(`\\b${col}\\b`).test(LEDGER_SNAPSHOT_SQL), `selects ${col}`);
  assert(!/\*/.test(LEDGER_SNAPSHOT_SQL), "never SELECT * — the ledger also holds created_by and idempotency_key");
});

test("a ledger row with no migration file is rejected", () => {
  const r = classifyLedgerProvenance([...M0_LEDGER, { version: "20270101000000", name: "ghost", statements: null }], M0_FILES);
  assert(r.findings.some((f) => /has no migration file/.test(f.message)),
    "a recorded version with no file cannot be reviewed, replayed or verified");
});

test("an adopted file with NO ledger row is rejected — db push would execute it", () => {
  const r = classifyLedgerProvenance(M0_LEDGER.filter((x) => x.version !== "20260806143700"), M0_FILES);
  assert(r.findings.some((f) => /db push would EXECUTE it/.test(f.message)),
    "a half-finished M0 is the dangerous state: the file describes existing objects and the CLI would re-create them");
});

test("an ordinary pending migration with no ledger row is NOT a finding", () => {
  const pending = F("20270601000000_add_participants.sql", EXEC_H + "create table participants (id uuid primary key);");
  const r = classifyLedgerProvenance(M0_LEDGER, [...M0_FILES, pending]);
  eq(r.verdict, "CONSISTENT", "a normal unapplied migration is pending, not inconsistent");
});

// The real migrations directory now holds the four M0 baseline files, derived from the measured
// production surface (PRODMIG-Q6). These two tests pin the M0 ledger delta to a NUMBER and make it
// fall out of the real files rather than out of a design document — the Option E table said 2, the
// files say 3, and the files are the thing that gets adopted.
//
// Both run against ledger FIXTURES, never a connection: the harness has no apply path and these
// tests must not acquire one.
const REAL_M0_FILES = () => auditMigrationSet(join(HERE, "..", "..", "supabase", "migrations")).migrations;
const TRACKED_ROW = { version: "20260806143644", name: "add_minimal_powerball_schema", statements: ["create table x();"] };

test("the M0 baseline files declare the provenance they are entitled to", () => {
  // Scoped to the ADOPTED set on purpose. This used to assert a total file count of 4, which broke the
  // moment the first EXPAND stage was promoted — a count is not the invariant. What must hold is that
  // adoption stays rare, deliberate and self-declaring: three files, all named for it, forever.
  const files = REAL_M0_FILES();
  const adopted = files.filter((f) => declaredProvenance(f.body) === PROVENANCE.ADOPTED);
  eq(adopted.length, 3, "exactly three files declare BASELINE_ADOPTED_AT_CURRENT_STATE — adoption is a one-off, not a habit");
  for (const f of adopted) {
    assert(/baseline_adopted/.test(f.name),
      `${f.name} declares adoption, so its NAME must say so too — the filename is the signal visible in the ledger`);
  }
  const executed = files.filter((f) => declaredProvenance(f.body) === PROVENANCE.EXECUTED);
  assert(executed.some((f) => f.version === "20260806143644"),
    "the one migration production really executed must still declare itself executed");
  assert(files.every((f) => declaredProvenance(f.body) !== PROVENANCE.UNDECLARED),
    "every file in supabase/migrations declares a provenance; UNDECLARED leaves the distinction to inference");
});

test("a promoted EXPAND stage declares itself EXECUTED, never adopted", () => {
  // An EXPAND stage genuinely runs, so its ledger row carries statements. If one ever declared
  // BASELINE_ADOPTED_AT_CURRENT_STATE it would be claiming its objects already existed — and
  // `migration repair` would then record it without ever creating them.
  const expand = REAL_M0_FILES().filter((f) => /_expand_/.test(f.name));
  assert(expand.length > 0, "at least one EXPAND stage has been promoted");
  for (const f of expand) {
    eq(declaredProvenance(f.body), PROVENANCE.EXECUTED, `${f.name} must declare MIGRATION_APPLIED_HISTORICALLY`);
    assert(!/baseline_adopted/.test(f.name), `${f.name} must not borrow the adopted naming signal`);
  }
});

test("against the PRE-M0 ledger the real files imply exactly three missing rows — the M0 delta", () => {
  const r = classifyLedgerProvenance([TRACKED_ROW], REAL_M0_FILES());
  const missing = r.findings.filter((f) => /db push would EXECUTE it/.test(f.message));
  eq(missing.length, 3, "M0 inserts three ledger rows, not the two Option E's table claimed");
  eq(r.verdict, "INCONSISTENT", "before M0 the repo and the ledger genuinely disagree");
});

test("against the POST-M0 ledger the same files cross-check clean", () => {
  const adoptedRows = REAL_M0_FILES()
    .filter((f) => declaredProvenance(f.body) === PROVENANCE.ADOPTED)
    .map((f) => ({ version: f.version, name: f.name.replace(/^\d+_|\.sql$/g, ""), statements: null }));
  const r = classifyLedgerProvenance([TRACKED_ROW, ...adoptedRows], REAL_M0_FILES());
  eq(r.findings.filter((f) => f.severity === "ERROR").length, 0, "no ERROR survives a completed M0");
  eq(r.verdict, "CONSISTENT", "three adopted rows plus the one executed row is the intended end state");
  eq(r.adopted.length, 3, "and the ledger reports three adopted versions");
  eq(r.executed.length, 1, "with history unchanged at one executed version");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ MIGRATION HARNESS TESTS PASSED\n" : "✗ MIGRATION HARNESS TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
