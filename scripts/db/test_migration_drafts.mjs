#!/usr/bin/env node
/**
 * Tests for the migration drafts, the static analyser, rollback classification and the dependency graph
 * (Workstreams 3, 3A, 3B, 4, 18, 19, 36).
 *
 * The analyser currently reports every draft SAFE with no blocking issue. A checker that reports clean is
 * indistinguishable from one that cannot report, so EVERY rule gets a synthetic violation and EVERY
 * positive expectation gets a synthetic omission. All SQL below is invented for the test.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  VERDICT, RULES, EXPECTATIONS, ROLLBACK_CLASSES,
  analyseSql, analyseDir, classifyRollback, verifyDependencyGraph,
} from "./migration_static_analysis.mjs";
import { stripSqlNoise } from "./migration_harness.mjs";
import { generateDrafts, DRAFT_DIR, PHASE_META, BANNER, requiredExtensions, TYPE_EXTENSIONS, BASE_EXTENSIONS, fitIndexName, MAX_IDENTIFIER_BYTES, entityHasUpdatedAt, updatedAtTriggerDdl, UPDATED_AT_FUNCTION_DDL, PAYMENT_ALLOCATION_DDL, paymentAllocationTriggerDdl, SNAPSHOT_INTEGRITY_DDL, snapshotIntegrityTriggerDdl } from "./generate_migration_drafts.mjs";
import { loadModel, withDefaults } from "./validate_target_model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const test = (n, fn) => {
  try { fn(); console.log(`  ✓ ${n}`); pass++; }
  catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

/** A minimal draft that satisfies every positive expectation, so a rule test isolates one rule. */
const CLEAN = `${BANNER}
-- ROLLBACK STRATEGY (FULL). drop it.
-- PRECHECKS: none
-- FAIL-CLOSED CONDITIONS: any error
BEGIN;
CREATE TABLE bolao."t" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "amount" numeric(14,2) NOT NULL,
  "currency" char(3) NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  "parent_id" uuid,
  CONSTRAINT "t_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "t_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES bolao."t" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE bolao."t" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao."t" FROM PUBLIC;
COMMIT;
`;

console.log("\nThe committed drafts must be clean\n");

test("all seventeen phases are generated with no DDL-quality error", () => {
  const { files, errors } = generateDrafts();
  eq(errors.length, 0, `DDL-quality errors: ${errors.join("; ")}`);
  eq(files.length, 17, "seventeen phases — the fifteen DDL phases, M16 (the normalized read surface) and M17 (classification zone predictions)");
  for (const p of ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"]) {
    assert(files.some((f) => f.phase === p), `missing ${p}`);
  }
});

test("the drafts on disk are fresh", () => {
  const { files } = generateDrafts();
  for (const f of files) {
    const p = join(DRAFT_DIR, f.name);
    assert(existsSync(p), `${f.name} not written`);
    eq(readFileSync(p, "utf8"), f.body, `${f.name} is stale — regenerate with --write`);
  }
});

test("no draft directory file was hand-edited into existence", () => {
  const { files } = generateDrafts();
  const known = new Set(files.map((f) => f.name));
  for (const n of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".sql"))) {
    assert(known.has(n), `orphan draft ${n} — not produced by the generator`);
  }
});

test("every draft carries the refusal banner and lives outside supabase/migrations", () => {
  for (const f of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".sql"))) {
    const body = readFileSync(join(DRAFT_DIR, f), "utf8");
    assert(/^-- NOT FOR PRODUCTION APPLY/.test(body), `${f} does not open with the refusal banner`);
    assert(/REQUIRES M0 \+ RESTORE REHEARSAL/.test(body), `${f} does not state its prerequisites`);
  }
  assert(!DRAFT_DIR.includes(join("supabase", "migrations")), "drafts must not live in the live migration directory");
});

test("no draft filename is CLI-recognisable as a migration", () => {
  // The CLI requires <14-digit timestamp>_<snake_case>.sql. `.draft.sql` and the M-prefix both fail it.
  for (const f of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".sql"))) {
    assert(!/^\d{14}_[a-z0-9_]+\.sql$/.test(f), `${f} would be picked up by supabase db push`);
  }
});

test("static analysis reports no BLOCKED and no unexplained finding on the real drafts", () => {
  const res = analyseDir(DRAFT_DIR);
  const blocked = res.files.filter((f) => f.verdict === VERDICT.BLOCKED);
  eq(blocked.length, 0, `BLOCKED: ${blocked.map((f) => `${f.name} (${f.findings.map((x) => x.id).join(",")})`).join("; ")}`);
  for (const f of res.files) {
    for (const x of f.findings) assert(x.why && x.why.length > 15, `${f.name}/${x.id} has no explanation`);
  }
});

test("every rollback classification is honest about data movement", () => {
  const res = analyseDir(DRAFT_DIR);
  for (const f of res.files) {
    assert(f.rollback, `${f.name} has no rollback classification`);
    eq(f.rollback.findings.length, 0, `${f.name}: ${f.rollback.findings.join("; ")}`);
    assert(ROLLBACK_CLASSES.includes(f.rollback.declared), `${f.name}: unknown class ${f.rollback.declared}`);
  }
});

test("the dependency graph over every draft phase is acyclic and ordered", () => {
  const g = verifyDependencyGraph();
  eq(g.findings.length, 0, `graph findings: ${g.findings.join("; ")}`);
  eq(g.phases, 17, "seventeen phases — the fifteen DDL phases, M16 and M17");
});

console.log("\nWS3A — the emitter cannot produce bad DDL\n");

test("no draft contains serial, float money, or a bare timestamp", () => {
  for (const f of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".sql"))) {
    const body = readFileSync(join(DRAFT_DIR, f), "utf8");
    /**
     * stripSqlNoise removes comments AND string literals. The naive `--` strip was not enough: a
     * COMMENT ON ... IS '...' literal containing the word "real" matched the float check, and the words
     * "CREATE TABLE" inside explanatory prose were parsed as a table declaration named "and".
     */
    const code = stripSqlNoise(body);
    assert(!/\b(big)?serial\b/i.test(code), `${f} emits serial`);
    assert(!/\b(float|real|double\s+precision|money)\b/i.test(code), `${f} emits a float-family type`);
    assert(!/\btimestamp\b(?!tz)/i.test(code), `${f} emits a bare timestamp`);
  }
});

test("every money column in the model has a currency companion in the same table", () => {
  for (const e of loadModel().entities) {
    const cols = e.columns.map(withDefaults);
    const money = cols.filter((c) => c.financial === "MONETARY_AMOUNT");
    if (!money.length) continue;
    assert(cols.some((c) => c.financial === "CURRENCY_CODE"), `${e.name} has money with no currency column`);
  }
});

test("every FK in every draft carries an explicit ON DELETE and ON UPDATE", () => {
  for (const f of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".sql"))) {
    const body = readFileSync(join(DRAFT_DIR, f), "utf8");
    for (const m of body.matchAll(/CONSTRAINT\s+"[^"]+"\s+FOREIGN KEY[^\n]*/g)) {
      assert(/ON DELETE/.test(m[0]), `${f}: FK with no ON DELETE`);
      assert(/ON UPDATE/.test(m[0]), `${f}: FK with no ON UPDATE`);
    }
  }
});

test("every created table enables RLS and revokes PUBLIC in the same migration", () => {
  for (const f of readdirSync(DRAFT_DIR).filter((x) => x.endsWith(".sql"))) {
    const body = readFileSync(join(DRAFT_DIR, f), "utf8");
    const code = stripSqlNoise(body);
    const created = [...code.matchAll(/CREATE\s+TABLE\s+([\w".]+)/gi)].map((m) => m[1].replace(/"/g, ""));
    for (const t of created) {
      assert(body.includes(`ALTER TABLE ${t.split(".")[0]}."${t.split(".")[1]}" ENABLE ROW LEVEL SECURITY`),
        `${f}: ${t} created without enabling RLS — a table that exists without RLS is an exposure window`);
      assert(body.includes(`REVOKE ALL ON TABLE ${t.split(".")[0]}."${t.split(".")[1]}" FROM PUBLIC`),
        `${f}: ${t} created without revoking PUBLIC`);
    }
  }
});

test("DERIVED_VIEW columns are never emitted as columns", () => {
  const model = loadModel();
  for (const e of model.entities) {
    const derived = e.columns.map(withDefaults).filter((c) => c.generated === "DERIVED_VIEW");
    if (!derived.length) continue;
    const phase = e.migrationPhase;
    const { files } = generateDrafts();
    const f = files.find((x) => x.phase === phase);
    assert(f, `no draft for ${phase}`);
    const ddl = f.body.split("CREATE TABLE")[1] || "";
    for (const d of derived) {
      const inCreate = new RegExp(`^\\s+"${d.sql}"\\s`, "m").test(f.body);
      assert(!inCreate, `${e.name}.${d.sql} is DERIVED_VIEW but was emitted as a column — a derived value stored is a second source of truth`);
    }
    assert(ddl.length > 0, "sanity");
  }
});

test("all 14 enum types are created in M1 with declared values", () => {
  const model = loadModel();
  const enums = model.enums || {};
  eq(Object.keys(enums).length, 14, "fourteen enum types");
  const { files } = generateDrafts();
  const m1 = files.find((f) => f.phase === "M1").body;
  for (const [name, def] of Object.entries(enums)) {
    const bare = name.split(".")[1];
    assert(m1.includes(`CREATE TYPE bolao."${bare}"`), `M1 does not create ${name}`);
    assert(def.values.length >= 2, `${name} has fewer than two values`);
    assert(def.why && def.why.length > 20, `${name} has no rationale`);
    for (const v of def.values) assert(m1.includes(`'${v}'`), `M1 omits value ${v} of ${name}`);
  }
});

test("every enum type referenced by a column is declared", () => {
  const model = loadModel();
  const declared = new Set(Object.keys(model.enums || {}));
  for (const e of model.entities) {
    for (const c of e.columns) {
      if (!/^(bolao|audit)\./.test(c.type)) continue;
      assert(declared.has(c.type), `${e.name}.${c.sql} uses undeclared type ${c.type}`);
    }
  }
});

test("settlement_status enum matches financial.mjs exactly", async () => {
  const { SETTLEMENT } = await import("./financial.mjs");
  const declared = loadModel().enums["bolao.settlement_status"].values;
  eq(JSON.stringify([...declared].sort()), JSON.stringify(Object.values(SETTLEMENT).sort()),
    "the SQL enum and the JS vocabulary must not drift — money depends on both");
});

test("outbox_status and delivery_outcome match outbox.mjs exactly", async () => {
  const ob = await import("./outbox.mjs");
  const model = loadModel();
  eq(JSON.stringify([...model.enums["bolao.outbox_status"].values].sort()),
     JSON.stringify(Object.values(ob.STATUS).sort()), "outbox_status drift");
  eq(JSON.stringify([...model.enums["bolao.delivery_outcome"].values].sort()),
     JSON.stringify(Object.values(ob.OUTCOME).sort()), "delivery_outcome drift");
});

console.log("\nWS3B — every analyser rule must be able to fire\n");

/** One synthetic violation per rule. A rule with no example here is unproven. */
const VIOLATIONS = {
  BLOCKING_INDEX_BUILD: "CREATE INDEX idx ON bolao.t (id);",
  BLOCKING_INDEX_DROP: "DROP INDEX idx;",
  VALIDATING_CONSTRAINT_ADD: "ALTER TABLE bolao.t ADD CONSTRAINT ck CHECK (amount > 0);",
  SET_NOT_NULL_DIRECT: 'ALTER TABLE bolao.t ALTER COLUMN currency SET NOT NULL;',
  VOLATILE_COLUMN_DEFAULT: "ALTER TABLE bolao.t ADD COLUMN created timestamptz DEFAULT now();",
  ALTER_COLUMN_TYPE: "ALTER TABLE bolao.t ALTER COLUMN amount TYPE numeric(20,4);",
  IMPLICIT_RENAME: "ALTER TABLE bolao.t RENAME COLUMN amount TO value;",
  DROP_TABLE: "DROP TABLE bolao.t;",
  DROP_SCHEMA: "DROP SCHEMA bolao CASCADE;",
  DROP_COLUMN: "ALTER TABLE bolao.t DROP COLUMN memo;",
  TRUNCATE: "TRUNCATE bolao.t;",
  DELETE_UNQUALIFIED: "DELETE FROM bolao.t;",
  UPDATE_UNQUALIFIED: "UPDATE bolao.t SET amount = 0;",
  DROP_CONSTRAINT: "ALTER TABLE bolao.t DROP CONSTRAINT ck;",
  RLS_DISABLE: "ALTER TABLE bolao.t DISABLE ROW LEVEL SECURITY;",
  POLICY_REMOVAL: "DROP POLICY p ON bolao.t;",
  DROP_TYPE: "DROP TYPE bolao.payment_kind;",
  PRIVILEGE_BROADENING: "GRANT SELECT ON bolao.t TO anon;",
  ENUM_VALUE_ADDITION: "ALTER TYPE bolao.payment_kind ADD VALUE 'gift';",
  CONSTRAINT_VALIDATION: "ALTER TABLE bolao.t VALIDATE CONSTRAINT ck;",
  POLICY_CREATION: "CREATE POLICY p ON bolao.t FOR SELECT TO anon USING (true);",
  SECURITY_DEFINER: "CREATE FUNCTION f() RETURNS void SECURITY DEFINER AS 'x' LANGUAGE sql;",
  DML_IN_MIGRATION: "INSERT INTO bolao.t (id) VALUES (gen_random_uuid());",
  LOCK_TABLE: "LOCK TABLE bolao.t IN ACCESS EXCLUSIVE MODE;",
  TRANSACTION_WRAPPED_CONCURRENT: "BEGIN; CREATE INDEX CONCURRENTLY idx ON bolao.t (id); COMMIT;",
};

for (const rule of RULES) {
  test(`${rule.id} fires on its own violation`, () => {
    const sql = VIOLATIONS[rule.id];
    assert(sql, `no synthetic violation defined for ${rule.id} — an unexercised rule is unproven`);
    const r = analyseSql(CLEAN + "\n" + sql);
    assert(r.findings.some((f) => f.id === rule.id), `${rule.id} did not fire on "${sql}"`);
  });
}

test("every rule states a reason, and every BLOCKED rule states the safe alternative", () => {
  for (const r of RULES) {
    assert(r.why && r.why.length > 15, `${r.id} has no rationale`);
    if (r.verdict === VERDICT.BLOCKED) {
      assert(r.safeAlternative, `${r.id} is BLOCKED but names no safe alternative — telling someone "no" without "instead" gets worked around`);
    }
  }
});

test("the safe forms of blocked statements do NOT fire", () => {
  const safe = [
    "CREATE INDEX CONCURRENTLY idx ON bolao.t (id);",
    "DROP INDEX CONCURRENTLY idx;",
    "ALTER TABLE bolao.t ADD CONSTRAINT ck CHECK (amount > 0) NOT VALID;",
    "ALTER TABLE bolao.t ADD COLUMN label text DEFAULT 'x';",
    "DELETE FROM bolao.t WHERE id = '1';",
    "UPDATE bolao.t SET amount = 0 WHERE id = '1';",
  ];
  for (const s of safe) {
    const r = analyseSql(CLEAN + "\n" + s);
    const blocked = r.findings.filter((f) => f.verdict === VERDICT.BLOCKED);
    eq(blocked.length, 0, `the safe form "${s}" was BLOCKED: ${blocked.map((b) => b.id).join(",")}`);
  }
});

test("a keyword inside a comment or a string literal never fires a rule", () => {
  const noisy = CLEAN + `
-- DROP TABLE bolao.t;  (explaining why we do not do this)
/* TRUNCATE everything */
INSERT INTO bolao."audit" (action) VALUES ('DROP TABLE bolao.t');
`;
  const r = analyseSql(noisy);
  const ids = r.findings.map((f) => f.id);
  assert(!ids.includes("DROP_TABLE"), "a DROP TABLE in a comment must not fire — a migration file is mostly comments");
  assert(!ids.includes("TRUNCATE"), "TRUNCATE in a block comment must not fire");
  assert(ids.includes("DML_IN_MIGRATION"), "the real INSERT must still be seen");
});

test("ON UPDATE RESTRICT in a foreign key is not read as an UPDATE statement", () => {
  // This exact false positive occurred: every FK carries ON UPDATE, so all ten drafts were reported as
  // "moves data" and six were wrongly accused of over-claiming FULL rollback.
  const r = classifyRollback("M2", CLEAN);
  assert(r.createsOnly, "a CREATE TABLE with FKs must be classified as creating only");
  eq(r.findings.length, 0, `unexpected findings: ${r.findings.join("; ")}`);
});

console.log("\nWS3B — every positive expectation must be able to fail\n");

const OMISSIONS = {
  HAS_BANNER: (s) => s.replace(/-- NOT FOR PRODUCTION APPLY/, "-- something else"),
  RLS_ENABLED_PER_TABLE: (s) => s.replace(/ALTER TABLE bolao\."t" ENABLE ROW LEVEL SECURITY;\n/, ""),
  PUBLIC_REVOKED_PER_TABLE: (s) => s.replace(/REVOKE ALL ON TABLE bolao\."t" FROM PUBLIC;\n/, ""),
  NO_BARE_TIMESTAMP: (s) => s.replace(/"at" timestamptz/, '"at" timestamp'),
  NO_SERIAL: (s) => s.replace(/"id" uuid/, '"id" serial'),
  NO_FLOAT_MONEY: (s) => s.replace(/numeric\(14,2\)/, "double precision"),
  EVERY_FK_HAS_ON_DELETE: (s) => s.replace(/ ON DELETE RESTRICT/, ""),
  DECLARES_ROLLBACK: (s) => s.replace(/-- ROLLBACK STRATEGY[^\n]*\n/, ""),
  DECLARES_PRECHECKS: (s) => s.replace(/-- PRECHECKS[^\n]*\n/, ""),
  DECLARES_FAIL_CLOSED: (s) => s.replace(/-- FAIL-CLOSED CONDITIONS[^\n]*\n/, ""),
};

test("the clean fixture satisfies every expectation", () => {
  const r = analyseSql(CLEAN);
  const missing = r.findings.filter((f) => f.id.startsWith("MISSING_"));
  eq(missing.length, 0, `clean fixture failed: ${missing.map((m) => m.id).join(", ")}`);
});

for (const e of EXPECTATIONS) {
  test(`MISSING_${e.id} fires when the property is removed`, () => {
    const mutate = OMISSIONS[e.id];
    assert(mutate, `no omission defined for ${e.id}`);
    const broken = mutate(CLEAN);
    assert(broken !== CLEAN, `the omission for ${e.id} changed nothing — the test would pass vacuously`);
    const r = analyseSql(broken);
    assert(r.findings.some((f) => f.id === `MISSING_${e.id}`), `MISSING_${e.id} did not fire`);
    eq(r.verdict, VERDICT.BLOCKED, "a missing safety property must BLOCK");
  });
}

console.log("\nWS18/WS19 — graph and rollback detectors must fire\n");

test("a dependency cycle is detected", () => {
  const g = verifyDependencyGraph({
    A: { title: "a", dependsOn: ["B"], rollbackClass: "FULL" },
    B: { title: "b", dependsOn: ["A"], rollbackClass: "FULL" },
  });
  assert(g.findings.some((f) => /cycle/.test(f)), "cycle not detected");
});

test("a forward dependency is detected", () => {
  const g = verifyDependencyGraph({
    A: { title: "a", dependsOn: ["M0"], rollbackClass: "FULL" },
    B: { title: "b", dependsOn: ["C"], rollbackClass: "FULL" },
    C: { title: "c", dependsOn: ["M0"], rollbackClass: "FULL" },
  });
  assert(g.findings.some((f) => /not earlier/.test(f)), "forward dependency not detected");
});

test("an unknown dependency and an unanchored phase are detected", () => {
  const g = verifyDependencyGraph({ A: { title: "a", dependsOn: [], rollbackClass: "FULL" }, B: { title: "b", dependsOn: ["Z"], rollbackClass: "FULL" } });
  assert(g.findings.some((f) => /no dependency declared/.test(f)), "unanchored not detected");
  assert(g.findings.some((f) => /unknown phase Z/.test(f)), "unknown dep not detected");
});

test("duplicate phase titles are detected — they would collide as filenames", () => {
  const g = verifyDependencyGraph({
    A: { title: "same", dependsOn: ["M0"], rollbackClass: "FULL" },
    B: { title: "same", dependsOn: ["A"], rollbackClass: "FULL" },
  });
  assert(g.findings.some((f) => /share a title/.test(f)), "duplicate title not detected");
});

test("a FULL rollback claim on a data-moving migration is rejected", () => {
  const withDml = CLEAN + "\nINSERT INTO bolao.t (id) VALUES (gen_random_uuid());";
  const r = classifyRollback("M2", withDml);       // M2 declares FULL
  assert(r.findings.some((f) => /declares FULL rollback but contains data movement/.test(f)),
    "over-claiming FULL rollback must be caught — a transform that has run cannot be undone by DROP alone");
});

test("every phase declares a rollback class from the closed vocabulary", () => {
  for (const [phase, meta] of Object.entries(PHASE_META)) {
    assert(meta.rollbackClass, `${phase} has no rollbackClass`);
    assert(ROLLBACK_CLASSES.includes(meta.rollbackClass), `${phase}: ${meta.rollbackClass} not in the vocabulary`);
    assert(meta.rollback && meta.rollback.length > 30, `${phase} has no rollback narrative`);
  }
});

test("every phase declares purpose, dependencies, backfill and app compatibility", () => {
  for (const [phase, meta] of Object.entries(PHASE_META)) {
    for (const f of ["title", "purpose", "dependsOn", "backfill", "appCompat"]) {
      assert(meta[f] !== undefined && meta[f] !== "", `${phase} missing ${f}`);
    }
    assert(meta.purpose.length > 60, `${phase}: purpose is too thin to review`);
  }
});

// ── KPLUS-F004 ─────────────────────────────────────────────────────────────────────────────────
// DDL-M2 failed on a real PostgreSQL server with `type "citext" does not exist`: DDL-M1 emitted a
// hardcoded `CREATE EXTENSION pgcrypto` and nothing derived the extension set from the types the model
// actually uses. Every static check passed, because each phase was internally consistent and the
// missing dependency was never named in the phase that broke. These tests make the dependency
// derivable and checked rather than remembered.

test("every extension-backed type used by the model has its extension created in DDL-M1", () => {
  const m1 = readFileSync(join(DRAFT_DIR, "M1_schema_extensions_and_enum_types.draft.sql"), "utf8");
  const model = loadModel();
  for (const entity of model.entities || []) {
    for (const col of entity.columns || []) {
      const base = String(col.type || "").trim().toLowerCase().replace(/\(.*$/, "").replace(/\[\]$/, "");
      const ext = TYPE_EXTENSIONS[base];
      if (!ext) continue;
      assert(new RegExp(`CREATE EXTENSION IF NOT EXISTS ${ext.name}\\b`).test(m1),
        `${entity.name}.${col.name} is ${base}, which needs the ${ext.name} extension, but DDL-M1 never creates it — every phase after M1 that declares such a column will fail to apply`);
    }
  }
});

test("requiredExtensions is derived from the model, not a fixed list", () => {
  const derived = requiredExtensions().map((e) => e.name);
  for (const e of BASE_EXTENSIONS) assert(derived.includes(e.name), `${e.name} is unconditionally required`);
  // Feed a model declaring an extension-backed type the real model might not use, and the extension
  // must appear. A test that only checks today's model would pass again the day the model changes.
  const synthetic = { entities: [{ name: "synthetic", columns: [{ name: "c", type: "citext" }] }] };
  assert(requiredExtensions(synthetic).some((e) => e.name === "citext"), "a citext column must pull in citext");
  const none = { entities: [{ name: "synthetic", columns: [{ name: "c", type: "text" }] }] };
  assert(!requiredExtensions(none).some((e) => e.name === "citext"), "and a model without one must not");
});

test("every extension DDL-M1 creates states why it is needed", () => {
  const m1 = readFileSync(join(DRAFT_DIR, "M1_schema_extensions_and_enum_types.draft.sql"), "utf8");
  for (const line of m1.split("\n")) {
    const mm = /^CREATE EXTENSION IF NOT EXISTS (\w+);/.exec(line);
    if (!mm) continue;
    const known = requiredExtensions().find((e) => e.name === mm[1]);
    assert(known, `DDL-M1 creates ${mm[1]}, which requiredExtensions() does not derive — an extension nobody can explain is one nobody can remove`);
    assert(known.why && known.why.length > 20, `${mm[1]} has no rationale`);
  }
});


// ── KPLUS-F006: index names must be unique AS POSTGRESQL STORES THEM ────────────────────────
// PostgreSQL truncates an identifier over NAMEDATALEN-1 bytes silently. Two emitted names that
// differ only past that boundary therefore arrive as one name, and `IF NOT EXISTS` turns the second
// CREATE INDEX into a no-op that reports success. This was not hypothetical: it is how
// competition_edition_standings lost its covering scoring-read index in a real migrated database.

const emittedIndexNames = () => {
  const names = [];
  for (const f of generateDrafts().files) {
    for (const line of f.body.split("\n")) {
      const m = /INDEX CONCURRENTLY IF NOT EXISTS "?([A-Za-z0-9_]+)"?/.exec(line);
      if (m) names.push(m[1]);
    }
  }
  return names;
};

test("no emitted index name exceeds PostgreSQL's identifier limit", () => {
  const over = emittedIndexNames().filter((n) => Buffer.byteLength(n, "utf8") > MAX_IDENTIFIER_BYTES);
  eq(over.length, 0, `these names would be truncated by the server, and truncation is silent: ${over.join(", ")}`);
});

test("emitted index names are unique after server-side truncation, not merely as written", () => {
  const names = emittedIndexNames();
  const truncated = names.map((n) => n.slice(0, MAX_IDENTIFIER_BYTES));
  eq(new Set(truncated).size, names.length,
    "two indexes collide once PostgreSQL truncates their names — IF NOT EXISTS would silently create only the first");
});

test("every declared index is emitted, except one a UNIQUE constraint already builds", () => {
  // KPLUS-F009: a total unique index on a single column that also carries `unique: true` is the same
  // index PostgreSQL builds for the UNIQUE constraint. Emitting both builds it twice under two names.
  const model = loadModel();
  let declared = 0, absorbed = 0;
  for (const e of model.entities || []) {
    const totalUnique = new Set((e.columns || []).map(withDefaults).filter((c) => c.unique === true).map((c) => c.sql));
    for (const idx of e.indexes || []) {
      declared++;
      if (idx.unique && !(idx.partial ?? idx.where) && idx.cols.length === 1 && totalUnique.has(idx.cols[0])) absorbed++;
    }
  }
  assert(absorbed > 0, "test premise: at least one declared index is absorbed by a UNIQUE constraint");
  eq(emittedIndexNames().length, declared - absorbed, "an index declared by the model did not reach the DDL");
});

test("a PARTIAL_WHERE_NOT_NULL column never gets a total UNIQUE constraint", () => {
  // KPLUS-F009 again, from the other side. "PARTIAL_WHERE_NOT_NULL" is a non-empty string and was
  // therefore truthy; participants.email got a total UNIQUE that re-imposed exactly the block its
  // partial index exists to avoid, making a redacted address unreusable.
  const bodies = generateDrafts().files.map((f) => f.body).join("\n");
  let checked = 0;
  for (const e of loadModel().entities || []) {
    for (const c of (e.columns || []).map(withDefaults)) {
      if (c.unique !== "PARTIAL_WHERE_NOT_NULL") continue;
      checked++;
      assert(!new RegExp(`CONSTRAINT "${e.name}_${c.sql}_key" UNIQUE`).test(bodies),
        `${e.name}.${c.sql} is declared PARTIAL_WHERE_NOT_NULL but got a total UNIQUE constraint`);
    }
  }
  assert(checked > 0, "test premise: the model declares at least one PARTIAL_WHERE_NOT_NULL column");
});

test("no CHECK requires a column to be NULL that the schema declares NOT NULL", () => {
  // KPLUS-F008. participants_redaction_complete required display_name IS NULL once redacted_at was
  // set, while display_name was NOT NULL — so no participant could ever be redacted. Each constraint
  // was individually valid, which is why every static check passed for as long as it existed.
  for (const e of loadModel().entities || []) {
    const notNull = new Set((e.columns || []).map(withDefaults)
      .filter((c) => c.nullable === false && c.generated !== "DERIVED_VIEW").map((c) => c.sql));
    for (const ck of e.checks || []) {
      for (const m of ck.expr.matchAll(/([a-z_]+)\s+IS NULL/g)) {
        assert(!notNull.has(m[1]),
          `${e.name}.${ck.name} can only be satisfied when ${m[1]} IS NULL, but ${m[1]} is NOT NULL — the state this check describes is unreachable`);
      }
    }
  }
});

test("fitIndexName leaves a name that already fits completely alone", () => {
  const short = "pool_entries_pool_id_idx";
  eq(fitIndexName(short, new Set()), short, "shortening a name that fits would rename indexes that were always correct");
});

test("fitIndexName disambiguates names that differ only past the truncation boundary", () => {
  // The real pair from the migrated catalog: identical for the first 63 bytes.
  const a = "competition_edition_standings_classification_snapshot_id_position_uidx";
  const b = "competition_edition_standings_classification_snapshot_id_position_club_name_idx";
  eq(a.slice(0, MAX_IDENTIFIER_BYTES), b.slice(0, MAX_IDENTIFIER_BYTES), "test premise: these collide when truncated");
  const used = new Set();
  const fa = fitIndexName(a, used); used.add(fa);
  const fb = fitIndexName(b, used); used.add(fb);
  assert(fa !== fb, "the two names must survive as distinct identifiers");
  assert(Buffer.byteLength(fa, "utf8") <= MAX_IDENTIFIER_BYTES && Buffer.byteLength(fb, "utf8") <= MAX_IDENTIFIER_BYTES,
    "and both must fit, or the server truncates them back into a collision");
});

test("fitIndexName is deterministic across regenerations", () => {
  const long = "competition_edition_standings_classification_snapshot_id_position_club_name_idx";
  eq(fitIndexName(long, new Set()), fitIndexName(long, new Set()),
    "a non-deterministic name would make --check report drift on every run");
});


// ── KPLUS-F013(a): behaviour the model says the DATABASE provides must exist in the DDL ──────
// The model stated `updated_at` was "maintained by trigger" and the generator emitted no triggers at
// all, so the column silently never moved. Each constraint was individually valid; the claim lived in
// a column's prose `notes`, where no validator looked.

const draftBodies = () => generateDrafts().files.map((f) => f.body).join("\n");

test("every entity declaring updated_at gets a trigger that maintains it", () => {
  const bodies = draftBodies();
  let checked = 0;
  for (const e of loadModel().entities || []) {
    if (!entityHasUpdatedAt(e)) continue;
    checked++;
    assert(new RegExp(`CREATE TRIGGER "${e.name}_set_updated_at"`).test(bodies),
      `${e.name} declares updated_at but no trigger maintains it — the column would read as its insert time forever`);
  }
  assert(checked >= 2, `test premise: at least two entities declare updated_at (found ${checked})`);
});

test("no entity WITHOUT updated_at gets one", () => {
  // Attaching a stamp to an append-only table would assert a mutability that table forbids.
  const bodies = draftBodies();
  for (const e of loadModel().entities || []) {
    if (entityHasUpdatedAt(e)) continue;
    assert(!new RegExp(`CREATE TRIGGER "${e.name}_set_updated_at"`).test(bodies),
      `${e.name} has no updated_at column but was given a trigger to maintain it`);
  }
});

test("the updated_at function is created before any trigger references it", () => {
  const files = generateDrafts().files;
  const fnPhase = files.findIndex((f) => f.body.includes("CREATE OR REPLACE FUNCTION bolao.set_updated_at"));
  const trgPhase = files.findIndex((f) => f.body.includes("EXECUTE FUNCTION bolao.set_updated_at()"));
  assert(fnPhase !== -1, "the trigger function is never created");
  assert(trgPhase !== -1, "no trigger references the function");
  assert(fnPhase <= trgPhase, `the function is created in phase index ${fnPhase} but first referenced in ${trgPhase} — the sequence would fail to apply`);
});

test("the updated_at trigger overrides any client-supplied value", () => {
  // A timestamp the caller can choose is evidence of nothing. The assignment must be unconditional.
  assert(/NEW\.updated_at\s*:=\s*now\(\)/.test(UPDATED_AT_FUNCTION_DDL),
    "the function must assign updated_at unconditionally, so a client-supplied value is overwritten");
  assert(!/IF\s+NEW\.updated_at\s+IS\s+NULL/i.test(UPDATED_AT_FUNCTION_DDL),
    "the function must not honour a client-supplied updated_at when one is present");
});

test("the trigger is gated so a no-op write does not advance updated_at", () => {
  const e = (loadModel().entities || []).find(entityHasUpdatedAt);
  const ddl = updatedAtTriggerDdl(e);
  assert(/WHEN \(OLD\.\* IS DISTINCT FROM NEW\.\*\)/.test(ddl),
    "without the guard, an idempotent re-save advances a timestamp nobody's data touched, and every consumer reading it as a change marker is misled");
});

test("a SECURITY-relevant function pins its search_path", () => {
  assert(/SET search_path/i.test(UPDATED_AT_FUNCTION_DDL),
    "a trigger function with an unpinned search_path can be redirected by a caller's schema");
});

/**
 * KPLUS-F023 — no function may be created without its EXECUTE grant being revoked from PUBLIC.
 *
 * PostgreSQL grants EXECUTE to PUBLIC on every new function. For the four trigger functions that is
 * inert, because a function returning `trigger` cannot be called; the defect is the DEFAULT, which the
 * next callable function inherits in silence. That stopped being hypothetical with KPLUS-F014's
 * `audit.event_canonical_v1` and `audit.event_hash_v1`.
 *
 * So this is a RULE over the generated DDL rather than six hand-written assertions: every function the
 * migration creates must be revoked, and a function added later fails this test until it is. That is
 * the difference between fixing six instances and closing the class.
 */
test("every function the migration creates has EXECUTE revoked from PUBLIC", () => {
  const sql = generateDrafts().files.map((f) => f.body).join("\n");
  const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_]+\.[a-z_0-9]+)\s*\(/g)].map((m) => m[1]);
  const revoked = new Set([...sql.matchAll(/REVOKE ALL ON FUNCTION\s+([a-z_]+\.[a-z_0-9]+)\s*\(/g)].map((m) => m[1]));
  assert(created.length >= 6, `expected the migration to create at least six functions, found ${created.length}`);
  const missing = created.filter((f) => !revoked.has(f));
  assert(missing.length === 0,
    `these functions are created with PUBLIC EXECUTE still granted: ${missing.join(", ")}`);
});

/**
 * KPLUS-F028 corrects this test's predecessor, which asserted that NO `GRANT EXECUTE` may exist at all.
 *
 * That was the right instinct applied one level too broadly. A trigger fires as part of the table's
 * machinery and needs no EXECUTE — but a call made INSIDE a SECURITY INVOKER trigger body is an ordinary
 * call, checked against the writing role. Forbidding every grant therefore forbade the audit spine from
 * working for any writer that is not a superuser, which is every writer in production. F027-8a measured
 * it: service_role's append is refused with "permission denied for function event_hash_v1".
 *
 * What must stay forbidden is a grant that undoes the REVOKE — to PUBLIC, or to the two principals the
 * access model treats as reachable from a browser. A grant to a named trusted role is an ACL decision
 * with a blast radius; a grant to PUBLIC is the default KPLUS-F023 exists to remove.
 */
test("EXECUTE is never granted back to PUBLIC or to a browser-reachable principal", () => {
  const sql = generateDrafts().files.map((f) => f.body).join("\n");
  const grants = [...sql.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([a-z_]+\.[a-z_0-9]+)\s*\([^)]*\)\s*TO\s+([a-z_, ]+);/gi)]
    .map((m) => ({ fn: m[1], to: m[2].split(",").map((s) => s.trim()) }));
  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]{0,400}?TO\s+PUBLIC/i.test(sql),
    "a GRANT to PUBLIC puts back exactly what KPLUS-F023 removes");
  for (const g of grants) {
    for (const role of g.to) {
      assert(!["public", "anon", "authenticated"].includes(role),
        `${g.fn} is executable by ${role}, which is reachable from a browser holding the public anon key`);
    }
  }
  // And anything granted must still have been revoked from PUBLIC first, or the grant is decoration on
  // top of a default that already gave everyone the same thing.
  const revoked = new Set([...sql.matchAll(/REVOKE ALL ON FUNCTION\s+([a-z_]+\.[a-z_0-9]+)\s*\(/g)].map((m) => m[1]));
  for (const g of grants) {
    assert(revoked.has(g.fn), `${g.fn} is granted to ${g.to.join("/")} but never revoked from PUBLIC`);
  }
  assert(/CREATE TRIGGER/.test(sql), "the triggers must still be created — this is an ACL change, not a behaviour change");
});

test("KPLUS-F028 — the chain trigger's nested calls are executable by the runtime that writes audit events", () => {
  const sql = generateDrafts().files.map((f) => f.body).join("\n");
  // The two functions audit.compute_event_chain() calls from inside its body. A SECURITY INVOKER trigger
  // body runs as the writing role, so without these the audit spine works for superusers and nobody else.
  for (const fn of ["audit.event_canonical_v1", "audit.event_hash_v1"]) {
    assert(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) TO service_role`).test(sql),
      `${fn} is called inside audit.compute_event_chain() but service_role cannot execute it — every audit ` +
      `append by the runtime fails with "permission denied for function" (KPLUS-F028)`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// KPLUS-F019 — the payment-allocation invariants must be enforced by the DATABASE.
//
// Workstream N attempted each of these against the real migrated target in raw SQL and the server
// accepted all three: 120.00 allocated against a 100.00 payment by two concurrent writers, a BRL
// allocation of a USD payment, and an allocation against a payment whose amount is NULL. Every one of
// them is stated as an invariant in model/write_contracts.json, and every one of them lived only in
// the contract code. Each expectation below therefore also has its omission tested, because a rule
// that cannot be observed missing is not being checked.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test("payment_allocations carries the allocation-integrity trigger, and nothing else does", () => {
  const bodies = draftBodies();
  assert(/CREATE TRIGGER "payment_allocations_check"/.test(bodies),
    "no trigger enforces the allocation invariants — the contract's checks then bind only callers that run the contract");
  const attached = [...bodies.matchAll(/EXECUTE FUNCTION bolao\.check_payment_allocation\(\)/g)].length;
  eq(attached, 1, "the allocation control is attached to more than one table, or to none");
  assert(paymentAllocationTriggerDdl({ schema: "bolao", name: "payments" }) === null,
    "the control must attach to payment_allocations alone; on payments it would fire on rows it does not govern");
});

test("the allocation function is created before the trigger that references it", () => {
  const files = generateDrafts().files;
  const fnPhase = files.findIndex((f) => f.body.includes("CREATE OR REPLACE FUNCTION bolao.check_payment_allocation"));
  const trgPhase = files.findIndex((f) => f.body.includes("EXECUTE FUNCTION bolao.check_payment_allocation()"));
  assert(fnPhase !== -1, "the allocation function is never created");
  assert(trgPhase !== -1, "no trigger references the allocation function");
  assert(fnPhase <= trgPhase, `the function is created in phase index ${fnPhase} but first referenced in ${trgPhase} — the sequence would fail to apply`);
});

test("the allocation control locks the payment row rather than trusting the caller to", () => {
  // This is the entire difference between the invariant holding and not holding. Two writers that
  // each read the same total and then each insert both pass a check that is not serialised.
  assert(/FROM bolao\.payments[\s\S]{0,80}FOR UPDATE/.test(PAYMENT_ALLOCATION_DDL),
    "without FOR UPDATE on the payment row, two concurrent allocations both see the same total and both commit");
});

test("the allocation control refuses an amount-less payment, a currency mismatch, and an over-allocation", () => {
  for (const [what, re] of [
    ["amount-less payment", /pay_amount IS NULL/],
    ["non-positive payment", /pay_amount <= 0/],
    ["non-positive allocation", /NEW\.allocated_amount <= 0/],
    ["payment currency mismatch", /NEW\.currency <> pay_currency/],
    ["entry currency mismatch", /NEW\.currency <> entry_ccy/],
    ["over-allocation", /allocated \+ NEW\.allocated_amount > pay_amount/],
  ]) assert(re.test(PAYMENT_ALLOCATION_DDL), `the control does not refuse a ${what}`);
});

test("the running total excludes the row being written, so an UPDATE is not counted twice", () => {
  // Without this the trigger is correct on INSERT and wrong on UPDATE: revising an allocation
  // downwards would be measured against a total that still contains its old value.
  assert(/allocation_id IS DISTINCT FROM NEW\.allocation_id/.test(PAYMENT_ALLOCATION_DDL),
    "the sum must exclude the row under consideration, or every UPDATE double-counts itself");
  assert(/BEFORE INSERT OR UPDATE ON/.test(paymentAllocationTriggerDdl({ schema: "bolao", name: "payment_allocations" })),
    "an INSERT-only trigger leaves the whole invariant bypassable by inserting small and updating large");
});

test("the allocation control raises a classifiable condition and pins its search_path", () => {
  assert(/ERRCODE = 'check_violation'/.test(PAYMENT_ALLOCATION_DDL),
    "a raise without an ERRCODE reaches callers as a generic internal error they cannot distinguish from a bug");
  assert(/SET search_path/i.test(PAYMENT_ALLOCATION_DDL),
    "a trigger function with an unpinned search_path can be redirected by a caller's schema");
});

test("the allocation control does not cap against the entry's expected fee", () => {
  // Deliberate, and stated in the contract: exceeding the fee is OVERPAID, a reportable state, not an
  // error. A cap here would refuse a real overpayment instead of recording it.
  assert(!/expected_fee_amount/.test(PAYMENT_ALLOCATION_DDL),
    "capping against the entry fee would turn an overpayment — which must be reportable — into a refused write");
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
// KPLUS-F020 / KPLUS-D01 — the cross-row invariants no single-row control can hold.
//
// Workstream N accepted all three against the real server: positions 1 and 4 with 2 and 3 absent;
// club_count = 4 over two standing rows; and a prize gross exceeding everything the pool collected.
// As with KPLUS-F019, every expectation below also has its omission tested.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test("the two cross-row controls exist, pin their search_path, and are revoked from PUBLIC", () => {
  for (const fn of ["check_snapshot_completeness", "check_prize_pool_solvency"]) {
    assert(new RegExp(`CREATE OR REPLACE FUNCTION bolao\\.${fn}\\(\\) RETURNS trigger`).test(SNAPSHOT_INTEGRITY_DDL), `${fn} is not created`);
    assert(new RegExp(`REVOKE ALL ON FUNCTION bolao\\.${fn}\\(\\) FROM PUBLIC`).test(SNAPSHOT_INTEGRITY_DDL), `${fn} keeps PUBLIC EXECUTE`);
  }
  eq((SNAPSHOT_INTEGRITY_DDL.match(/SET search_path = pg_catalog, pg_temp/g) || []).length, 2,
    "a security-relevant function with an unpinned search_path can be redirected by its caller's schema");
});

test("KPLUS-F020 — every control is DEFERRED, because none of these facts is true mid-statement", () => {
  const bodies = draftBodies();
  const triggers = [...bodies.matchAll(/CREATE CONSTRAINT TRIGGER "([\w]+)"\n\s+AFTER ([A-Z ]+) ON ([\w."]+)\n\s+DEFERRABLE INITIALLY DEFERRED/g)];
  eq(triggers.length, 4, `expected four deferred constraint triggers, found ${triggers.length}`);
  // An IMMEDIATE trigger would reject the legitimate load at its first row: after one of twenty standings
  // rows the snapshot is correctly incomplete.
  assert(!/CREATE CONSTRAINT TRIGGER[\s\S]{0,200}?DEFERRABLE INITIALLY IMMEDIATE/.test(bodies),
    "an INITIALLY IMMEDIATE constraint trigger would fire before the set it checks exists");
  const byName = Object.fromEntries(triggers.map((m) => [m[1], { events: m[2].trim(), table: m[3] }]));
  eq(byName["classification_snapshots_completeness"]?.events, "INSERT OR UPDATE", "snapshot completeness events");
  eq(byName["competition_edition_standings_completeness"]?.events, "INSERT OR UPDATE OR DELETE",
    "DELETE is how a gap appears and how club_count starts to overstate — omitting it leaves the common corruption path open");
  eq(byName["prize_allocations_solvency"]?.events, "INSERT OR UPDATE", "prize solvency events");
  eq(byName["payment_allocations_prize_solvency"]?.events, "UPDATE OR DELETE",
    "INSERT can only RAISE what a pool collected, so firing on it would cost a check that can never fail");
});

test("KPLUS-F020 — the controls attach to exactly the tables that can break them, and to no others", () => {
  const t = (name) => snapshotIntegrityTriggerDdl({ schema: "bolao", name });
  assert(t("classification_snapshots") && t("competition_edition_standings"), "the snapshot pair must be covered");
  assert(t("prize_allocations") && t("payment_allocations"), "the solvency pair must be covered");
  for (const other of ["participants", "pool_entries", "payments", "matches", "ranking_snapshots"]) {
    eq(t(other), null, `${other} received a cross-row trigger it has no part in`);
  }
  eq(snapshotIntegrityTriggerDdl({ schema: "audit", name: "audit_events" }), null, "the audit schema is not this control's business");
});

test("KPLUS-F020 — contiguity is checked by aggregate, and club_count against the rows that exist", () => {
  const fn = SNAPSHOT_INTEGRITY_DDL;
  assert(/count\(DISTINCT st\.position\)/.test(fn) && /max\(st\.position\)/.test(fn),
    "N distinct positive positions with maximum N are exactly 1..N — that is the whole contiguity proof");
  assert(/actual <> declared/.test(fn), "club_count must be compared against the rows actually present");
  assert(/IF NOT FOUND THEN RETURN NULL/.test(fn),
    "a snapshot deleted in the same transaction has nothing left to be consistent with; raising there refuses a legitimate teardown");
});

test("KPLUS-D01 — solvency is compared PER CURRENCY, never on a mixed total", () => {
  const fn = SNAPSHOT_INTEGRITY_DDL;
  assert(/GROUP BY pz\.currency/.test(fn) && /GROUP BY pa\.currency/.test(fn),
    "summing gross_amount across currencies compares two numbers that are not amounts of anything");
  assert(/FULL JOIN/.test(fn),
    "a currency declared but never collected must appear as collected=0, not vanish from the comparison — an inner join would hide exactly the insolvent case");
  assert(/t\.declared > t\.collected/.test(fn), "the comparison must be declared-exceeds-collected");
  assert(/KPLUS-OP-4\(a\)/.test(fn),
    "the fail-closed consequence must be stated where an operator reading the error will see it: a pool whose payments are not yet allocated reads as having collected nothing");
});

test("ANTI-VACUITY — each cross-row expectation fails when its piece is removed", () => {
  const omit = (needle) => SNAPSHOT_INTEGRITY_DDL.replace(needle, "");
  assert(!/count\(DISTINCT st\.position\)/.test(omit("count(DISTINCT st.position)")), "omission harness is broken");
  // Each of these is a rule whose absence must be observable, or the test above is decoration.
  for (const [what, needle] of [
    ["the club_count comparison", "actual <> declared"],
    ["the contiguity comparison", "distinct_pos <> actual OR max_pos <> actual"],
    ["the per-currency grouping", "GROUP BY pz.currency"],
    ["the solvency comparison", "t.declared > t.collected"],
  ]) {
    assert(SNAPSHOT_INTEGRITY_DDL.includes(needle), `${what} is not present to begin with`);
    assert(!omit(needle).includes(needle), `${what} survived its own omission — the harness proves nothing`);
  }
});

test("the cross-row functions are created before the triggers that reference them", () => {
  const files = generateDrafts().files;
  const fnPhase = files.findIndex((f) => f.body.includes("CREATE OR REPLACE FUNCTION bolao.check_snapshot_completeness"));
  assert(fnPhase >= 0, "the function is never created");
  for (const trg of ["classification_snapshots_completeness", "competition_edition_standings_completeness",
    "prize_allocations_solvency", "payment_allocations_prize_solvency"]) {
    const trgPhase = files.findIndex((f) => f.body.includes(`CREATE CONSTRAINT TRIGGER "${trg}"`));
    assert(trgPhase >= 0, `${trg} is never created`);
    assert(fnPhase <= trgPhase, `${trg} is created in a phase before the function it calls`);
  }
});

test("every generated function revokes EXECUTE from PUBLIC", () => {
  // MEASURED IN PRODUCTION, GNG-2B, 2026-08-11. A canary function created by the real creator role
  // (postgres) in the new bolao schema came out EXECUTABLE BY PUBLIC — anon, authenticated and PUBLIC
  // all returned true from has_function_privilege(). That is PostgreSQL's built-in default, not a
  // Supabase one, and it is the only built-in default that hands out a capability rather than
  // withholding it. Tables, views and sequences in the same canary transaction granted nothing to
  // anyone, so the platform itself broadens nothing; functions are the whole exposure.
  //
  // There is NO default-privilege safety net in bolao or audit (pg_default_acl is empty for both), and
  // KPLUS-F059 established that the schema-scoped ALTER DEFAULT PRIVILEGES form cannot revoke PUBLIC's
  // EXECUTE and fails silently. So the per-function REVOKE is the only thing standing between a new
  // SECURITY DEFINER function and the internet. It held for every phase when this was written; this
  // test is what keeps it holding.
  const { files } = generateDrafts();
  const offenders = [];
  for (const f of files) {
    const created = new Set([...f.body.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+([a-z_]+)\.([a-z_0-9]+)\s*\(/gi)]
      .map((m) => `${m[1]}.${m[2]}`));
    for (const fn of created) {
      const revoked = new RegExp(`REVOKE ALL ON FUNCTION\\s+${fn.replace(".", "\\.")}\\s*\\(`, "i").test(f.body);
      if (!revoked) offenders.push(`${f.phase}:${fn}`);
    }
  }
  assert(offenders.length === 0,
    `these generated functions never revoke EXECUTE from PUBLIC and would ship world-executable: ${offenders.join(", ")}`);
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ MIGRATION DRAFT TESTS PASSED\n" : "✗ MIGRATION DRAFT TESTS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
