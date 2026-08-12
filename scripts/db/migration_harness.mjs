#!/usr/bin/env node
/**
 * Migration harness (Workstream O).
 *
 * SCOPE — read this first
 * This harness NEVER connects to production. It operates on:
 *   · migration files on disk (names, contents, digests)
 *   · schema SNAPSHOTS: plain JSON documents describing a schema, produced from a scratch database or
 *     written by hand as a fixture
 * Every function here is pure with respect to the database. There is no code path that applies a
 * migration, repairs a ledger, or opens a connection — deliberately, because a harness that can also
 * apply is a harness someone will use to apply.
 *
 * WHAT IT IS FOR
 * The programme's central discovery was that production has a fully-materialised schema with NO
 * recorded provenance for RLS enablement, 52 grants or 6 policies. That happened because objects were
 * created outside any migration and nothing compared intent against reality. This harness is the
 * comparison that was missing: given a declared migration set and two schema snapshots, it says
 * exactly what changed and whether anything changed that no migration accounts for.
 *
 * Usage:
 *   node scripts/db/migration_harness.mjs --dir supabase/migrations
 *   node scripts/db/migration_harness.mjs --diff before.json after.json
 *   node scripts/db/migration_harness.mjs --json
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ─────────────────────────────────────────────────────────────────────────────
// 1. FILENAME + ORDERING + DUPLICATES
// ─────────────────────────────────────────────────────────────────────────────
/** Supabase CLI convention: <14-digit UTC timestamp>_<snake_case_name>.sql */
export const MIGRATION_NAME_RE = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

/**
 * Files that are deliberately NOT migrations and must not be treated as one.
 * The baseline reference is the important case: it is named so the CLI will not recognise it, because
 * registering it as a migration would collide with the existing ledger row's primary key.
 */
export const NON_MIGRATION_SUFFIXES = [".reference.sql", ".rollback.sql", ".md"];

export function classifyFile(name) {
  for (const s of NON_MIGRATION_SUFFIXES) if (name.endsWith(s)) return { kind: "NON_MIGRATION", reason: `suffix ${s}` };
  const m = name.match(MIGRATION_NAME_RE);
  if (!m) return { kind: "INVALID", reason: "does not match <14-digit timestamp>_<snake_case>.sql" };
  const [, ts, slug] = m;
  const year = Number(ts.slice(0, 4)), month = Number(ts.slice(4, 6)), day = Number(ts.slice(6, 8));
  const hh = Number(ts.slice(8, 10)), mm = Number(ts.slice(10, 12)), ss = Number(ts.slice(12, 14));
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 59) {
    return { kind: "INVALID", reason: `timestamp ${ts} is not a plausible UTC instant` };
  }
  return { kind: "MIGRATION", version: ts, slug };
}

export function scanMigrationDir(dir) {
  if (!existsSync(dir)) return { exists: false, files: [], migrations: [], findings: [{ severity: "INFO", message: `no migration directory at ${dir}` }] };
  const names = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).sort();
  const files = [], findings = [];
  for (const name of names) {
    const cls = classifyFile(name);
    const body = readFileSync(join(dir, name), "utf8");
    files.push({ name, ...cls, digest: sha256(body), bytes: body.length, body });
    if (cls.kind === "INVALID") findings.push({ severity: "ERROR", message: `${name}: ${cls.reason}` });
  }
  const migrations = files.filter((f) => f.kind === "MIGRATION");

  // Duplicate version: the ledger's primary key is `version`, so two files sharing one cannot both apply.
  const byVersion = new Map();
  for (const m of migrations) {
    if (!byVersion.has(m.version)) byVersion.set(m.version, []);
    byVersion.get(m.version).push(m.name);
  }
  for (const [v, list] of byVersion) {
    if (list.length > 1) findings.push({ severity: "ERROR", message: `duplicate migration version ${v}: ${list.join(", ")} — version is the ledger primary key, so only one can ever apply` });
  }
  // Duplicate content under different names: usually a copy-paste that will apply twice.
  const byDigest = new Map();
  for (const m of migrations) {
    if (!byDigest.has(m.digest)) byDigest.set(m.digest, []);
    byDigest.get(m.digest).push(m.name);
  }
  for (const [, list] of byDigest) {
    if (list.length > 1) findings.push({ severity: "WARN", message: `identical content in ${list.join(", ")} — the same statements would apply twice` });
  }
  // Ordering: filename order must equal version order.
  const versions = migrations.map((m) => m.version);
  const sorted = [...versions].sort();
  if (JSON.stringify(versions) !== JSON.stringify(sorted)) {
    findings.push({ severity: "ERROR", message: "lexical filename order differs from version order" });
  }
  return { exists: true, files, migrations, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SQL CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Strip comments and string literals before pattern-matching.
 *
 * This programme has produced repeated false positives from bare keyword scans: the word "TRUNCATE"
 * inside a string literal flagged as DML, prose matching a FLOAT check. A SQL classifier must read SQL,
 * so literals and comments come out first. Every pattern below then applies to code only.
 */
export function stripSqlNoise(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")     // block comments
    .replace(/--[^\n]*/g, " ")             // line comments
    .replace(/\$\$[\s\S]*?\$\$/g, " '' ")  // dollar-quoted bodies
    .replace(/'(?:''|[^'])*'/g, " '' ");   // single-quoted literals
}

export const DESTRUCTIVE_PATTERNS = [
  { id: "DROP_TABLE", re: /\bDROP\s+TABLE\b/i, why: "removes rows irrecoverably without a backup" },
  { id: "DROP_COLUMN", re: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+COLUMN\b/i, why: "removes data and breaks any client still selecting it" },
  { id: "DROP_SCHEMA", re: /\bDROP\s+SCHEMA\b/i, why: "removes everything in the schema" },
  { id: "TRUNCATE", re: /\bTRUNCATE\b/i, why: "removes all rows; not subject to RLS and not a DELETE trigger event" },
  { id: "DELETE_NO_WHERE", re: /\bDELETE\s+FROM\s+[\w."]+\s*(?:;|$)/i, why: "unqualified DELETE removes every row" },
  { id: "UPDATE_NO_WHERE", re: /\bUPDATE\s+[\w."]+\s+SET\b(?![\s\S]*?\bWHERE\b)/i, why: "unqualified UPDATE rewrites every row" },
  { id: "DROP_POLICY", re: /\bDROP\s+POLICY\b/i, why: "removes an access control; a table can silently become readable" },
  { id: "DISABLE_RLS", re: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i, why: "disables row security wholesale" },
  { id: "DROP_CONSTRAINT", re: /\bDROP\s+CONSTRAINT\b/i, why: "removes an invariant that data may then violate" },
  { id: "DROP_INDEX", re: /\bDROP\s+INDEX\b/i, why: "may make a live query plan collapse" },
  { id: "ALTER_TYPE", re: /\bALTER\s+(?:TABLE\s+[\w."]+\s+)?ALTER\s+(?:COLUMN\s+)?[\w."]+\s+(?:SET\s+DATA\s+)?TYPE\b/i, why: "rewrites the table under an exclusive lock and can lose precision" },
];

export const WRITE_CLASSES = {
  NONE: "NONE",
  ADDITIVE_DDL: "ADDITIVE_DDL",
  MUTATING_DDL: "MUTATING_DDL",
  DESTRUCTIVE_DDL: "DESTRUCTIVE_DDL",
  DML: "DML",
  PRIVILEGE: "PRIVILEGE",
  SECURITY: "SECURITY",
};

/** Classify a migration body. A statement can carry several classes; the strongest drives review. */
export function classifySql(sql) {
  const code = stripSqlNoise(sql);
  const classes = new Set();
  const destructive = DESTRUCTIVE_PATTERNS.filter((p) => p.re.test(code)).map((p) => ({ id: p.id, why: p.why }));
  if (destructive.length) classes.add(WRITE_CLASSES.DESTRUCTIVE_DDL);
  if (/\bCREATE\s+(TABLE|SCHEMA|INDEX|VIEW|MATERIALIZED\s+VIEW|TYPE|FUNCTION|TRIGGER|SEQUENCE)\b/i.test(code)) classes.add(WRITE_CLASSES.ADDITIVE_DDL);
  if (/\bALTER\s+TABLE\b/i.test(code) && !destructive.length) classes.add(WRITE_CLASSES.MUTATING_DDL);
  if (/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(code)) classes.add(WRITE_CLASSES.DML);
  if (/\b(GRANT|REVOKE)\b/i.test(code)) classes.add(WRITE_CLASSES.PRIVILEGE);
  if (/\b(ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|ALTER\s+POLICY|DROP\s+POLICY|SECURITY\s+DEFINER)\b/i.test(code)) classes.add(WRITE_CLASSES.SECURITY);
  if (classes.size === 0) classes.add(WRITE_CLASSES.NONE);

  const findings = [];
  // A non-concurrent index build blocks writes for its duration.
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i.test(code)) {
    findings.push({ severity: "WARN", id: "NON_CONCURRENT_INDEX", message: "CREATE INDEX without CONCURRENTLY blocks writes for the whole build" });
  }
  // NOT NULL added without the NOT VALID / VALIDATE two-step scans the table under a lock.
  if (/\bADD\s+CONSTRAINT\b(?![\s\S]*?\bNOT\s+VALID\b)/i.test(code)) {
    findings.push({ severity: "WARN", id: "VALIDATING_CONSTRAINT", message: "ADD CONSTRAINT without NOT VALID scans the whole table while holding a lock" });
  }
  // `search_path` may be quoted: pg_dump always writes `SET "search_path" TO …`, so the unquoted-only
  // test reported every dump-shaped file — including the M0 baseline, whose 25 SECURITY DEFINER
  // functions all set it — as a privilege-escalation vector. A false ERROR on a safe file is not
  // harmless here: it either blocks M0 or teaches an operator to wave this detector through.
  if (/\bSECURITY\s+DEFINER\b/i.test(code) && !/\bSET\s+"?search_path"?[\s=]/i.test(code)) {
    findings.push({ severity: "ERROR", id: "DEFINER_WITHOUT_SEARCH_PATH", message: "SECURITY DEFINER without an explicit search_path is a privilege-escalation vector" });
  }
  return { classes: [...classes], destructive, findings };
}

/** A destructive migration must ship with a rollback plan next to it. */
export function rollbackPlanFor(dir, migrationName) {
  const candidate = migrationName.replace(/\.sql$/, ".rollback.sql");
  return existsSync(join(dir, candidate)) ? candidate : null;
}

export function auditMigrationSet(dir) {
  const scan = scanMigrationDir(dir);
  const findings = [...scan.findings];
  const entries = [];
  for (const m of scan.migrations) {
    const cls = classifySql(m.body);
    const rollback = rollbackPlanFor(dir, m.name);
    for (const f of cls.findings) findings.push({ severity: f.severity, message: `${m.name}: ${f.message}` });
    if (cls.classes.includes(WRITE_CLASSES.DESTRUCTIVE_DDL) && !rollback) {
      findings.push({ severity: "ERROR", message: `${m.name}: destructive (${cls.destructive.map((d) => d.id).join(", ")}) with no ${m.name.replace(/\.sql$/, ".rollback.sql")}` });
    }
    entries.push({ name: m.name, version: m.version, digest: m.digest, bytes: m.bytes, classes: cls.classes, destructive: cls.destructive, rollback });
  }
  return { dir, ...scan, entries, findings, manifest: buildManifest(entries) };
}

/** SHA manifest: digests only, never contents — the manifest is safe to publish, the SQL may not be. */
export function buildManifest(entries) {
  const lines = entries.map((e) => `${e.version}  ${e.digest}  ${e.name}`);
  return { entries: lines, rollup: sha256(lines.join("\n")) };
}

/** Dependency graph inferred from object names mentioned by each migration. */
export function dependencyGraph(entries, bodies) {
  const created = new Map();  // object → migration that creates it
  const nodes = [], edges = [];
  const objRe = /\bCREATE\s+(?:UNIQUE\s+)?(TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|FUNCTION|INDEX|POLICY|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi;
  const refRe = /\b(?:REFERENCES|ALTER\s+TABLE|FROM|JOIN|ON)\s+([\w."]+)/gi;
  for (const e of entries) {
    const code = stripSqlNoise(bodies.get(e.name) || "");
    nodes.push(e.name);
    let m;
    while ((m = objRe.exec(code))) created.set(m[2].replace(/"/g, "").toLowerCase(), e.name);
    refRe.lastIndex = 0;
    while ((m = refRe.exec(code))) {
      const target = m[1].replace(/"/g, "").toLowerCase();
      const owner = created.get(target);
      if (owner && owner !== e.name) edges.push({ from: e.name, to: owner, via: target });
    }
  }
  return { nodes, edges: dedupeEdges(edges) };
}
const dedupeEdges = (edges) => {
  const seen = new Set(), out = [];
  for (const e of edges) { const k = `${e.from}|${e.to}|${e.via}`; if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. SCHEMA SNAPSHOT + DIFF
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A snapshot is a plain JSON document, so it can be produced from a scratch database OR hand-written
 * as a fixture. Both are first-class: the fixture path is what makes the diff testable without any
 * database at all.
 */
export const EMPTY_SNAPSHOT = {
  tables: {}, primaryKeys: {}, foreignKeys: {}, uniques: {}, checks: {},
  indexes: {}, rls: {}, policies: {}, acls: {}, enums: {}, functions: {}, triggers: {},
};

const setOf = (v) => new Set(Array.isArray(v) ? v : Object.keys(v || {}));
const diffSets = (a, b) => ({
  added: [...b].filter((x) => !a.has(x)).sort(),
  removed: [...a].filter((x) => !b.has(x)).sort(),
});

/** Compare two snapshots dimension by dimension. Every dimension is reported, including empty ones. */
export function diffSnapshots(before, after) {
  const A = { ...EMPTY_SNAPSHOT, ...before }, B = { ...EMPTY_SNAPSHOT, ...after };
  const out = {};

  // Object-set dimensions.
  for (const dim of ["tables", "enums", "functions", "triggers", "policies", "indexes", "uniques", "checks", "primaryKeys", "foreignKeys"]) {
    out[dim] = diffSets(setOf(A[dim]), setOf(B[dim]));
    // Detail changes on objects present in both.
    const changed = [];
    for (const key of Object.keys(B[dim] || {})) {
      if (!(key in (A[dim] || {}))) continue;
      const ja = JSON.stringify(A[dim][key]), jb = JSON.stringify(B[dim][key]);
      if (ja !== jb) changed.push(key);
    }
    out[dim].changed = changed.sort();
  }

  // Column-level diff inside tables present in both.
  const columns = { added: [], removed: [], changed: [] };
  for (const t of Object.keys(B.tables)) {
    if (!(t in A.tables)) continue;
    const ca = A.tables[t] || {}, cb = B.tables[t] || {};
    for (const c of Object.keys(cb)) {
      if (!(c in ca)) columns.added.push(`${t}.${c}`);
      else if (JSON.stringify(ca[c]) !== JSON.stringify(cb[c])) columns.changed.push(`${t}.${c}`);
    }
    for (const c of Object.keys(ca)) if (!(c in cb)) columns.removed.push(`${t}.${c}`);
  }
  out.columns = { added: columns.added.sort(), removed: columns.removed.sort(), changed: columns.changed.sort() };

  // RLS enablement is a boolean per table; a flip in either direction is significant.
  const rls = { enabled: [], disabled: [], forced: [], unforced: [] };
  for (const t of new Set([...Object.keys(A.rls), ...Object.keys(B.rls)])) {
    const a = A.rls[t] || {}, b = B.rls[t] || {};
    if (!a.enabled && b.enabled) rls.enabled.push(t);
    if (a.enabled && !b.enabled) rls.disabled.push(t);
    if (!a.forced && b.forced) rls.forced.push(t);
    if (a.forced && !b.forced) rls.unforced.push(t);
  }
  out.rls = rls;

  // ACLs: per (object, grantee) privilege sets.
  const acl = { granted: [], revoked: [] };
  for (const obj of new Set([...Object.keys(A.acls), ...Object.keys(B.acls)])) {
    const a = A.acls[obj] || {}, b = B.acls[obj] || {};
    for (const grantee of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const pa = new Set(a[grantee] || []), pb = new Set(b[grantee] || []);
      for (const p of pb) if (!pa.has(p)) acl.granted.push(`${obj}:${grantee}:${p}`);
      for (const p of pa) if (!pb.has(p)) acl.revoked.push(`${obj}:${grantee}:${p}`);
    }
  }
  out.acls = { granted: acl.granted.sort(), revoked: acl.revoked.sort() };

  out.empty = isEmptyDiff(out);
  return out;
}

export function isEmptyDiff(d) {
  for (const [, v] of Object.entries(d)) {
    if (typeof v !== "object" || v === null) continue;
    for (const [, list] of Object.entries(v)) {
      if (Array.isArray(list) && list.length) return false;
    }
  }
  return true;
}

/**
 * Severity of a diff, for the pre/post runner.
 * Anything that removes an access control or data is CRITICAL regardless of intent — the point of this
 * classification is that "we meant to" is not visible in a snapshot.
 */
export function classifyDiff(d) {
  const critical = [], major = [], minor = [];
  if (d.rls.disabled.length) critical.push(`RLS disabled on ${d.rls.disabled.join(", ")}`);
  if (d.policies.removed.length) critical.push(`policies removed: ${d.policies.removed.join(", ")}`);
  if (d.acls.granted.length) critical.push(`privileges granted: ${d.acls.granted.join(", ")}`);
  if (d.tables.removed.length) critical.push(`tables removed: ${d.tables.removed.join(", ")}`);
  if (d.columns.removed.length) critical.push(`columns removed: ${d.columns.removed.join(", ")}`);
  if (d.foreignKeys.removed.length) major.push(`foreign keys removed: ${d.foreignKeys.removed.join(", ")}`);
  if (d.checks.removed.length) major.push(`checks removed: ${d.checks.removed.join(", ")}`);
  if (d.uniques.removed.length) major.push(`unique constraints removed: ${d.uniques.removed.join(", ")}`);
  if (d.primaryKeys.changed.length) major.push(`primary keys changed: ${d.primaryKeys.changed.join(", ")}`);
  if (d.functions.changed.length) major.push(`functions changed: ${d.functions.changed.join(", ")}`);
  if (d.triggers.added.length || d.triggers.removed.length) major.push("triggers changed");
  if (d.enums.changed.length) major.push(`enums changed: ${d.enums.changed.join(", ")}`);
  if (d.indexes.added.length || d.indexes.removed.length) minor.push("indexes changed");
  if (d.tables.added.length) minor.push(`tables added: ${d.tables.added.join(", ")}`);
  if (d.columns.added.length) minor.push(`columns added: ${d.columns.added.join(", ")}`);
  return { critical, major, minor, verdict: critical.length ? "CRITICAL" : major.length ? "MAJOR" : minor.length ? "MINOR" : "NO_CHANGE" };
}

/**
 * Pre/post validation runner.
 *
 * `expected` describes the change the migration set is SUPPOSED to make. Anything in the actual diff
 * that is not expected is UNACCOUNTED — and unaccounted change is precisely the condition that produced
 * this programme's original finding: a schema whose RLS, grants and policies no migration explains.
 */
export function prePostValidate({ before, after, expected = {} }) {
  const diff = diffSnapshots(before, after);
  const severity = classifyDiff(diff);
  const unaccounted = [];
  const check = (dim, kind) => {
    const actual = (diff[dim] && diff[dim][kind]) || [];
    const allowed = new Set(((expected[dim] || {})[kind]) || []);
    for (const x of actual) if (!allowed.has(x)) unaccounted.push(`${dim}.${kind}: ${x}`);
  };
  for (const dim of ["tables", "columns", "enums", "functions", "triggers", "policies", "indexes", "uniques", "checks", "primaryKeys", "foreignKeys"]) {
    for (const kind of ["added", "removed", "changed"]) check(dim, kind);
  }
  for (const kind of ["enabled", "disabled", "forced", "unforced"]) check("rls", kind);
  for (const kind of ["granted", "revoked"]) check("acls", kind);

  return { diff, severity, unaccounted, verdict: unaccounted.length ? "UNACCOUNTED_CHANGE" : severity.verdict };
}

// ─────────────────────────────────────────────────────────────────────────────
const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--diff");
  if (di >= 0) {
    const before = JSON.parse(readFileSync(argv[di + 1], "utf8"));
    const after = JSON.parse(readFileSync(argv[di + 2], "utf8"));
    const r = prePostValidate({ before, after });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.verdict === "NO_CHANGE" ? 0 : 1);
  }
  const dArg = argv.find((a) => a.startsWith("--dir="));
  const dir = dArg ? dArg.slice("--dir=".length) : join(ROOT, "supabase", "migrations");
  const audit = auditMigrationSet(dir);
  const bodies = new Map(audit.files.map((f) => [f.name, f.body]));
  const graph = dependencyGraph(audit.entries, bodies);

  if (argv.includes("--json")) {
    const { files, ...rest } = audit;
    console.log(JSON.stringify({ ...rest, graph }, null, 2));
    process.exit(audit.findings.some((f) => f.severity === "ERROR") ? 1 : 0);
  }
  console.log(`\nMigration harness — ${dir.replace(ROOT + "/", "")}\n`);
  console.log(`  files: ${audit.files.length}  migrations: ${audit.migrations.length}  non-migration: ${audit.files.filter((f) => f.kind === "NON_MIGRATION").length}`);
  for (const e of audit.entries) {
    console.log(`  ${e.version}  ${e.classes.join("+").padEnd(28)} ${e.name}${e.rollback ? "  [rollback]" : ""}`);
    for (const d of e.destructive) console.log(`        ! ${d.id}: ${d.why}`);
  }
  console.log(`\n  manifest rollup: ${audit.manifest.rollup}`);
  console.log(`  dependency edges: ${graph.edges.length}`);
  for (const f of audit.findings) console.log(`  ${f.severity === "ERROR" ? "✗" : f.severity === "WARN" ? "!" : "·"} ${f.message}`);
  const errs = audit.findings.filter((f) => f.severity === "ERROR").length;
  console.log(`\n  ${errs} error(s)\n`);
  console.log(errs ? "✗ MIGRATION SET INVALID\n" : "✓ MIGRATION SET OK\n");
  process.exit(errs ? 1 : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. LEDGER PROVENANCE (M0 baseline registration)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The distinction the M0 decision turns on.
 *
 * A migration ledger row can mean one of two entirely different things, and conflating them is how a
 * migration history becomes a fabrication:
 *
 *   MIGRATION_APPLIED_HISTORICALLY   this SQL was EXECUTED against the database at that version
 *   BASELINE_ADOPTED_AT_CURRENT_STATE this SQL DESCRIBES objects that already existed; it was never run,
 *                                    and the row exists only to stop the CLI trying to run it
 *
 * `supabase migration repair --status applied` produces the second kind. It records the version and
 * leaves `statements` NULL, because there were no statements — nothing was executed.
 *
 * That NULL is usually treated as a weakness (drift for those versions is not backed by recorded SQL,
 * which is true). It is also, structurally, the honest discriminator: the ledger itself distinguishes
 * executed history from adopted baseline, with no annotation required. This module makes that readable
 * and checkable instead of leaving it as an inference nobody re-derives.
 *
 * Two independent signals must AGREE:
 *   · the ledger row: `statements` present ⇒ executed; absent ⇒ adopted
 *   · the migration file's own `-- PROVENANCE:` header, whose digest is in the SHA manifest
 * Disagreement is a finding. A file claiming it was executed while the ledger holds no statements for it
 * is precisely the false claim the truthfulness principle forbids.
 */
export const PROVENANCE = {
  EXECUTED: "MIGRATION_APPLIED_HISTORICALLY",
  ADOPTED: "BASELINE_ADOPTED_AT_CURRENT_STATE",
  UNDECLARED: "UNDECLARED",
};

export const PROVENANCE_HEADER_RE = /^\s*--\s*PROVENANCE:\s*(MIGRATION_APPLIED_HISTORICALLY|BASELINE_ADOPTED_AT_CURRENT_STATE)\s*$/m;

/** Read a migration file's declared provenance from its header. */
export function declaredProvenance(sql) {
  const m = String(sql).match(PROVENANCE_HEADER_RE);
  return m ? m[1] : PROVENANCE.UNDECLARED;
}

/**
 * The ONLY supported way to read the ledger into the snapshot shape this module consumes.
 *
 * KPLUS-F003. `statements` is a `text[]`, and the shape contract here is a JS array or `null`. The
 * obvious read — `psql -tA -c 'SELECT version, name, statements FROM …'` — returns the array as a
 * PostgreSQL array LITERAL, i.e. the string `{"CREATE …","…"}`. That is neither an array nor null, so a
 * genuinely executed migration reads as UNDECLARED and the M0 postcheck rejects a correct ledger.
 *
 * Going through JSON is what makes the distinction survive transport: a `text[]` becomes a real array,
 * an empty array stays `[]`, and SQL NULL becomes JS `null` — which are exactly the three cases
 * `ledgerProvenance` distinguishes. Since M0's authorization to write two rows into a production ledger
 * rests on this postcheck, the read must not be left to whoever is at the prompt.
 *
 * Usage: run this statement, take the single scalar, `JSON.parse` it, pass it to
 * `classifyLedgerProvenance`. Against a LOCAL target only — this module never opens a connection itself.
 */
export const LEDGER_SNAPSHOT_SQL =
  `SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.version), '[]'::json)
     FROM (SELECT version, name, statements FROM supabase_migrations.schema_migrations) t`;

/**
 * Provenance implied by a ledger row.
 *
 * `statements` is a text[]. A NULL or empty array means no SQL was recorded as executed for that version,
 * which is what `migration repair` leaves behind.
 *
 * Anything that is neither returns UNDECLARED rather than guessing — see `LEDGER_SNAPSHOT_SQL` for the
 * one shape that transports correctly, and `malformedLedgerRow()` for how a wrong shape is reported.
 */
export function ledgerProvenance(row) {
  const s = row ? row.statements : undefined;
  if (s === null || s === undefined) return PROVENANCE.ADOPTED;
  if (Array.isArray(s) && s.length === 0) return PROVENANCE.ADOPTED;
  if (Array.isArray(s) && s.length > 0) return PROVENANCE.EXECUTED;
  return PROVENANCE.UNDECLARED;
}

/**
 * Is this row's `statements` the wrong SHAPE, as opposed to carrying the wrong provenance?
 *
 * The two failures need different messages. "Your file disagrees with the ledger" sends an operator to
 * re-read a migration header; "you read the ledger with the wrong query" sends them to fix the query.
 * Before this existed, the second produced the first's message.
 */
export function malformedLedgerRow(row) {
  const s = row ? row.statements : undefined;
  if (s === null || s === undefined || Array.isArray(s)) return null;
  return typeof s === "string" && /^\{.*\}$/s.test(s)
    ? "statements arrived as a PostgreSQL array literal string rather than an array — the ledger was read without JSON transport; use LEDGER_SNAPSHOT_SQL"
    : `statements arrived as ${typeof s}, which is neither an array nor null — the snapshot shape is wrong; use LEDGER_SNAPSHOT_SQL`;
}

/**
 * Cross-check a ledger snapshot against the migration files.
 *
 * `ledgerRows` is a plain array of `{version, name, statements}` — a SNAPSHOT, never a live query. Like
 * every other input in this harness, that is what makes the check testable without a database and
 * impossible to accidentally point at production.
 */
export function classifyLedgerProvenance(ledgerRows, migrationFiles) {
  const byVersion = new Map(migrationFiles.map((f) => [f.version, f]));
  const rowsByVersion = new Map((ledgerRows || []).map((r) => [String(r.version), r]));
  const entries = [], findings = [];

  for (const row of ledgerRows || []) {
    const version = String(row.version);
    const file = byVersion.get(version);
    const fromLedger = ledgerProvenance(row);
    const fromFile = file ? declaredProvenance(file.body) : PROVENANCE.UNDECLARED;

    // A wrong snapshot SHAPE is diagnosed before anything is concluded from it. Otherwise a bad read
    // of a perfectly good ledger is reported as a provenance disagreement, sending the operator to
    // audit migration headers that were never wrong (KPLUS-F003).
    const malformed = malformedLedgerRow(row);
    if (malformed) {
      findings.push({ severity: "ERROR", version, message: `ledger row ${version} is unreadable: ${malformed}` });
      entries.push({ version, name: row.name ?? null, fromLedger: PROVENANCE.UNDECLARED, fromFile, file: file ? file.name : null });
      continue;
    }

    if (!file) {
      findings.push({ severity: "ERROR", version,
        message: `ledger version ${version} has no migration file — a recorded version with no file cannot be reviewed, replayed or verified` });
    } else if (fromFile === PROVENANCE.UNDECLARED) {
      findings.push({ severity: "ERROR", version,
        message: `${file.name} declares no PROVENANCE header; the ledger implies ${fromLedger}. An undeclared file leaves the executed-vs-adopted distinction to inference` });
    } else if (fromFile !== fromLedger) {
      findings.push({ severity: "ERROR", version,
        message: `PROVENANCE DISAGREEMENT on ${version}: file declares ${fromFile} but the ledger implies ${fromLedger}` +
          (fromFile === PROVENANCE.EXECUTED
            ? ". A file claiming it was executed while the ledger holds no statements for it is the false claim the truthfulness principle forbids"
            : ". A file claiming baseline adoption while the ledger holds recorded statements understates real history") });
    }
    entries.push({ version, name: row.name ?? null, fromLedger, fromFile, file: file ? file.name : null });
  }

  // Files with no ledger row are simply pending; that is normal, not a finding. But a file DECLARING
  // adoption while unrecorded is a half-finished M0 — the CLI would try to execute it.
  for (const f of migrationFiles) {
    if (rowsByVersion.has(f.version)) continue;
    if (declaredProvenance(f.body) === PROVENANCE.ADOPTED) {
      findings.push({ severity: "ERROR", version: f.version,
        message: `${f.name} declares BASELINE_ADOPTED_AT_CURRENT_STATE but has no ledger row — db push would EXECUTE it against a database where those objects already exist` });
    }
  }

  const adopted = entries.filter((e) => e.fromLedger === PROVENANCE.ADOPTED).map((e) => e.version);
  const executed = entries.filter((e) => e.fromLedger === PROVENANCE.EXECUTED).map((e) => e.version);
  return { entries, findings, adopted, executed,
    verdict: findings.some((f) => f.severity === "ERROR") ? "INCONSISTENT" : "CONSISTENT" };
}
