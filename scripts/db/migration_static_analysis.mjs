#!/usr/bin/env node
/**
 * Migration SQL static analysis (Workstream 3B), plus rollback classification (WS19) and dependency-graph
 * verification (WS18).
 *
 * WHAT IT IS FOR
 * `migration_harness.mjs` already detects destructive statements and classifies write types. This adds the
 * checks that matter for a migration about to be applied to a LIVE database, where the question is not "is
 * this destructive" but "how long will this hold a lock, and what happens if it fails halfway".
 *
 * Every rule reads STRIPPED SQL — comments, string literals and dollar-quoted bodies removed first. This
 * programme has produced repeated false positives from bare keyword scans, and a migration file is mostly
 * comments, so scanning raw text would flag the documentation rather than the SQL.
 *
 * CLASSIFICATION
 *   SAFE             no lock of consequence, no data loss, reversible
 *   REVIEW_REQUIRED  correct but needs a human to confirm the context (a lock that is brief only because
 *                    the table is empty, an enum addition, a constraint validation)
 *   DESTRUCTIVE      removes data, an access control, or an invariant
 *   BLOCKED          must not be applied as written — there is a known safe alternative
 *
 * BLOCKED is separate from DESTRUCTIVE on purpose. A DROP TABLE may be a legitimate, authorised act. A
 * plain `CREATE INDEX` on a live table is never right when `CONCURRENTLY` exists, so it is BLOCKED rather
 * than merely flagged.
 *
 * Usage:
 *   node scripts/db/migration_static_analysis.mjs                 # analyse the drafts
 *   node scripts/db/migration_static_analysis.mjs --dir=<path>
 *   node scripts/db/migration_static_analysis.mjs --json
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { stripSqlNoise } from "./migration_harness.mjs";
import { DRAFT_DIR, PHASE_META } from "./generate_migration_drafts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const VERDICT = { SAFE: "SAFE", REVIEW_REQUIRED: "REVIEW_REQUIRED", DESTRUCTIVE: "DESTRUCTIVE", BLOCKED: "BLOCKED" };
const RANK = { SAFE: 0, REVIEW_REQUIRED: 1, DESTRUCTIVE: 2, BLOCKED: 3 };
const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);

/**
 * Rules. Each is `{id, verdict, re, why, safeAlternative}` and applies to stripped SQL.
 *
 * `notRe` lets a rule exempt the safe form of the same statement, so `CREATE INDEX CONCURRENTLY` does not
 * trip the plain-index rule. Expressing the exemption in the rule rather than in a post-filter keeps the
 * reason for it next to the rule it belongs to.
 */
export const RULES = [
  // ── BLOCKED: a safe alternative exists and is not optional ────────────────
  { id: "BLOCKING_INDEX_BUILD", verdict: VERDICT.BLOCKED,
    re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i,
    why: "a plain CREATE INDEX holds a write lock for the entire build",
    safeAlternative: "CREATE INDEX CONCURRENTLY, outside any transaction, then verify pg_index.indisvalid" },
  { id: "BLOCKING_INDEX_DROP", verdict: VERDICT.BLOCKED,
    re: /\bDROP\s+INDEX\b(?!\s+CONCURRENTLY)/i,
    why: "a plain DROP INDEX takes ACCESS EXCLUSIVE on the table",
    safeAlternative: "DROP INDEX CONCURRENTLY" },
  { id: "VALIDATING_CONSTRAINT_ADD", verdict: VERDICT.BLOCKED,
    re: /\bALTER\s+TABLE\b[\s\S]{0,200}?\bADD\s+CONSTRAINT\b(?![\s\S]{0,300}?\bNOT\s+VALID\b)/i,
    why: "ADD CONSTRAINT on an existing table scans every row while holding a lock. Inline constraints in CREATE TABLE are fine — the table is new and empty — but ALTER TABLE ... ADD CONSTRAINT is not",
    safeAlternative: "ADD CONSTRAINT ... NOT VALID, then VALIDATE CONSTRAINT as a separate statement" },
  { id: "SET_NOT_NULL_DIRECT", verdict: VERDICT.BLOCKED,
    re: /\bALTER\s+COLUMN\s+[\w"]+\s+SET\s+NOT\s+NULL\b/i,
    why: "SET NOT NULL scans the whole table under ACCESS EXCLUSIVE",
    safeAlternative: "add a CHECK (col IS NOT NULL) NOT VALID, VALIDATE it, then SET NOT NULL — which PostgreSQL 12+ can then prove without a scan" },
  { id: "VOLATILE_COLUMN_DEFAULT", verdict: VERDICT.BLOCKED,
    re: /\bADD\s+COLUMN\b[\s\S]{0,160}?\bDEFAULT\b[\s\S]{0,80}?\b(now|clock_timestamp|random|gen_random_uuid|uuid_generate_v4|nextval)\s*\(/i,
    why: "a VOLATILE default on ADD COLUMN rewrites the entire table; a constant default does not (PG 11+)",
    safeAlternative: "ADD COLUMN nullable with no default, backfill in bounded batches, then set the default for new rows only" },
  { id: "ALTER_COLUMN_TYPE", verdict: VERDICT.BLOCKED,
    re: /\bALTER\s+COLUMN\s+[\w"]+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    why: "changing a column type rewrites the table under ACCESS EXCLUSIVE and can lose precision silently",
    safeAlternative: "add a new column of the new type, dual-write, migrate readers, drop the old column in a separate contract release" },
  { id: "IMPLICIT_RENAME", verdict: VERDICT.BLOCKED,
    re: /\bALTER\s+TABLE\b[\s\S]{0,120}?\bRENAME\b/i,
    why: "a rename is an instant break for every client mid-session; there is no compatible window at all",
    safeAlternative: "add the new name, dual-write, migrate readers, drop the old name later" },

  // ── DESTRUCTIVE: removes data, an access control, or an invariant ──────────
  { id: "DROP_TABLE", verdict: VERDICT.DESTRUCTIVE, re: /\bDROP\s+TABLE\b/i, why: "removes rows irrecoverably" },
  { id: "DROP_SCHEMA", verdict: VERDICT.DESTRUCTIVE, re: /\bDROP\s+SCHEMA\b/i, why: "removes everything in the schema" },
  { id: "DROP_COLUMN", verdict: VERDICT.DESTRUCTIVE, re: /\bDROP\s+COLUMN\b/i, why: "removes data and breaks any client still selecting it" },
  { id: "TRUNCATE", verdict: VERDICT.DESTRUCTIVE, re: /\bTRUNCATE\b/i, why: "removes all rows; not subject to RLS and not a DELETE trigger event" },
  { id: "DELETE_UNQUALIFIED", verdict: VERDICT.DESTRUCTIVE, re: /\bDELETE\s+FROM\s+[\w."]+\s*(?:;|$)/i, why: "unqualified DELETE removes every row" },
  { id: "UPDATE_UNQUALIFIED", verdict: VERDICT.DESTRUCTIVE, re: /\bUPDATE\s+[\w."]+\s+SET\b(?![\s\S]{0,4000}?\bWHERE\b)/i, why: "unqualified UPDATE rewrites every row" },
  { id: "DROP_CONSTRAINT", verdict: VERDICT.DESTRUCTIVE, re: /\bDROP\s+CONSTRAINT\b/i, why: "removes an invariant that data may then violate" },
  { id: "RLS_DISABLE", verdict: VERDICT.DESTRUCTIVE, re: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i, why: "disables row security wholesale" },
  { id: "POLICY_REMOVAL", verdict: VERDICT.DESTRUCTIVE, re: /\bDROP\s+POLICY\b/i, why: "removes an access control; a table can silently become readable" },
  { id: "DROP_TYPE", verdict: VERDICT.DESTRUCTIVE, re: /\bDROP\s+TYPE\b/i, why: "removes an enum other objects may depend on" },

  // ── REVIEW_REQUIRED: correct, but context decides ─────────────────────────
  { id: "PRIVILEGE_BROADENING", verdict: VERDICT.REVIEW_REQUIRED, re: /\bGRANT\b/i,
    why: "any GRANT widens access. The anon key is public, so a grant to anon grants the internet" },
  { id: "ENUM_VALUE_ADDITION", verdict: VERDICT.REVIEW_REQUIRED, re: /\bALTER\s+TYPE\b[\s\S]{0,120}?\bADD\s+VALUE\b/i,
    why: "ALTER TYPE ADD VALUE cannot run in a transaction block and cannot be rolled back; old clients receiving an unknown value must tolerate it" },
  { id: "CONSTRAINT_VALIDATION", verdict: VERDICT.REVIEW_REQUIRED, re: /\bVALIDATE\s+CONSTRAINT\b/i,
    why: "validation scans the table. It takes only a SHARE UPDATE EXCLUSIVE lock so writes continue, but on a large table it is long-running" },
  { id: "POLICY_CREATION", verdict: VERDICT.REVIEW_REQUIRED, re: /\bCREATE\s+POLICY\b/i,
    why: "a new policy changes who can see what; the predicate needs reading, not just the statement" },
  { id: "SECURITY_DEFINER", verdict: VERDICT.REVIEW_REQUIRED, re: /\bSECURITY\s+DEFINER\b/i,
    why: "runs with the definer's privileges; without an explicit search_path it is a privilege-escalation vector" },
  { id: "DML_IN_MIGRATION", verdict: VERDICT.REVIEW_REQUIRED, re: /\b(INSERT\s+INTO|MERGE\s+INTO|DELETE\s+FROM)\b|\bUPDATE\s+[\w."]+\s+SET\b/i,
    why: "data movement inside a schema migration. Acceptable for small reference data; a backfill belongs in the batched framework, not here" },
  { id: "LOCK_TABLE", verdict: VERDICT.REVIEW_REQUIRED, re: /\bLOCK\s+TABLE\b/i,
    why: "an explicit lock blocks other sessions for the transaction's duration" },
  { id: "TRANSACTION_WRAPPED_CONCURRENT", verdict: VERDICT.BLOCKED, re: /BEGIN\s*;[\s\S]*?\bCONCURRENTLY\b[\s\S]*?COMMIT\s*;/i,
    why: "CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction block and will error",
    safeAlternative: "move the CONCURRENTLY statement outside BEGIN/COMMIT" },
];

/** Positive checks — properties a migration SHOULD have. Absence is a finding. */
export const EXPECTATIONS = [
  { id: "HAS_BANNER", why: "a draft must announce that it is not for production apply",
    test: (raw) => /NOT FOR PRODUCTION APPLY/.test(raw) },
  { id: "RLS_ENABLED_PER_TABLE", why: "every created table must enable RLS in the same migration; a table that exists without RLS, even briefly, is an exposure window",
    test: (raw, code) => {
      const created = [...code.matchAll(/CREATE\s+TABLE\s+([\w".]+)/gi)].map((m) => m[1].replace(/"/g, ""));
      const enabled = new Set([...code.matchAll(/ALTER\s+TABLE\s+([\w".]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)].map((m) => m[1].replace(/"/g, "")));
      return created.every((t) => enabled.has(t));
    } },
  { id: "PUBLIC_REVOKED_PER_TABLE", why: "PUBLIC must be revoked on every new table, or default privileges may make it readable",
    test: (raw, code) => {
      const created = [...code.matchAll(/CREATE\s+TABLE\s+([\w".]+)/gi)].map((m) => m[1].replace(/"/g, ""));
      const revoked = new Set([...code.matchAll(/REVOKE\s+ALL\s+ON\s+TABLE\s+([\w".]+)\s+FROM\s+PUBLIC/gi)].map((m) => m[1].replace(/"/g, "")));
      return created.every((t) => revoked.has(t));
    } },
  { id: "NO_BARE_TIMESTAMP", why: "a bare timestamp means an instant is ambiguous",
    test: (raw, code) => !/\btimestamp\b(?!tz)/i.test(code) },
  { id: "NO_SERIAL", why: "serial leaks insertion order and is not stable across restores",
    test: (raw, code) => !/\b(big)?serial\b/i.test(code) },
  { id: "NO_FLOAT_MONEY", why: "float/real/money must never appear",
    test: (raw, code) => !/\b(float|real|double\s+precision|money)\b/i.test(code) },
  { id: "EVERY_FK_HAS_ON_DELETE", why: "an FK with no explicit ON DELETE inherits NO ACTION silently",
    test: (raw, code) => {
      const fks = [...code.matchAll(/FOREIGN\s+KEY[\s\S]{0,200}?REFERENCES[\s\S]{0,200}?(?=,\n|\n\s*\)|;)/gi)];
      return fks.every((m) => /ON\s+DELETE/i.test(m[0]));
    } },
  { id: "DECLARES_ROLLBACK", why: "a migration with no stated rollback cannot be approved",
    test: (raw) => /ROLLBACK STRATEGY/.test(raw) },
  { id: "DECLARES_PRECHECKS", why: "prechecks are what make a failure fail closed",
    test: (raw) => /PRECHECKS/.test(raw) },
  { id: "DECLARES_FAIL_CLOSED", why: "the operator must know when to stop rather than improvise",
    test: (raw) => /FAIL-CLOSED CONDITIONS/.test(raw) },
];

export function analyseSql(raw, { name = "(inline)" } = {}) {
  const code = stripSqlNoise(raw);
  const findings = [];
  let verdict = VERDICT.SAFE;

  for (const r of RULES) {
    if (!r.re.test(code)) continue;
    findings.push({ id: r.id, verdict: r.verdict, why: r.why, safeAlternative: r.safeAlternative || null });
    verdict = worst(verdict, r.verdict);
  }
  for (const e of EXPECTATIONS) {
    let ok = true;
    try { ok = e.test(raw, code); } catch { ok = false; }
    if (!ok) {
      findings.push({ id: `MISSING_${e.id}`, verdict: VERDICT.BLOCKED, why: e.why, safeAlternative: null });
      verdict = worst(verdict, VERDICT.BLOCKED);
    }
  }
  return { name, verdict, findings };
}

/** WS19 — rollback classification, taken from declared phase metadata and cross-checked against the SQL. */
export const ROLLBACK_CLASSES = ["FULL", "FULL_BEFORE_BACKFILL", "FORWARD_FIX_ONLY", "DATA_RESTORE_REQUIRED", "NOT_SAFE"];

export function classifyRollback(phase, raw) {
  const declared = (PHASE_META[phase] || {}).rollbackClass || null;
  const code = stripSqlNoise(raw);
  const findings = [];
  if (!declared) findings.push("no rollbackClass declared for this phase");
  else if (!ROLLBACK_CLASSES.includes(declared)) findings.push(`rollbackClass "${declared}" is not in the closed vocabulary`);

  /**
   * A phase that only CREATEs can honestly claim FULL. One that moves data cannot.
   *
   * The DML patterns must be precise shapes, not bare keywords: `UPDATE\s+` matched `ON UPDATE RESTRICT`
   * in every foreign key, so all ten drafts were reported as "moves data" and six were wrongly accused of
   * over-claiming FULL rollback. A keyword is not a statement.
   */
  const createsOnly = !(/\b(INSERT\s+INTO|MERGE\s+INTO|DELETE\s+FROM)\b/i.test(code)
    || /\bUPDATE\s+[\w."]+\s+SET\b/i.test(code));
  if (declared === "FULL" && !createsOnly) {
    findings.push("declares FULL rollback but contains data movement — a transform that has run cannot be undone by DROP alone");
  }
  return { phase, declared, createsOnly, findings };
}

/** WS18 — dependency graph over the declared phases. */
export function verifyDependencyGraph(phases = PHASE_META) {
  const names = Object.keys(phases);
  const findings = [];
  const pos = new Map(names.map((n, i) => [n, i]));

  for (const [name, meta] of Object.entries(phases)) {
    const deps = meta.dependsOn || [];
    if (!deps.length) findings.push(`${name}: no dependency declared — an unanchored phase can be applied at any time`);
    for (const d of deps) {
      if (d === "M0") continue;                                  // the baseline, outside this set
      if (!pos.has(d)) { findings.push(`${name}: depends on unknown phase ${d}`); continue; }
      if (pos.get(d) >= pos.get(name)) findings.push(`${name}: depends on ${d}, which is not earlier`);
    }
  }
  // Cycle detection over the declared edges.
  const seen = new Map();
  const visit = (n, stack) => {
    if (stack.includes(n)) { findings.push(`dependency cycle: ${[...stack, n].join(" → ")}`); return; }
    if (seen.get(n)) return;
    seen.set(n, true);
    for (const d of (phases[n] || {}).dependsOn || []) if (d !== "M0") visit(d, [...stack, n]);
  };
  for (const n of names) visit(n, []);

  // Duplicate and orphan detection.
  const titles = names.map((n) => phases[n].title);
  if (new Set(titles).size !== titles.length) findings.push("two phases share a title, which would produce duplicate filenames");

  return { phases: names.length, findings };
}

export function analyseDir(dir) {
  if (!existsSync(dir)) return { exists: false, files: [], findings: [{ severity: "INFO", message: `no draft directory at ${dir}` }] };
  const names = readdirSync(dir).filter((f) => f.endsWith(".sql") && statSync(join(dir, f)).isFile()).sort();
  const files = names.map((name) => {
    const raw = readFileSync(join(dir, name), "utf8");
    // Both draft-scheme forms: the historical bare `M7_` and the namespaced `DDL-M11_` introduced for
    // new phases, because two numbering systems already both claim M1-M10 (BATCH-G-OP-1).
    const phase = (name.match(/^(DDL-M\d+|M\d+)_/) || [])[1] || null;
    return { name, phase, ...analyseSql(raw, { name }), rollback: phase ? classifyRollback(phase, raw) : null };
  });
  return { exists: true, files };
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const dArg = argv.find((a) => a.startsWith("--dir="));
  const dir = dArg ? dArg.slice("--dir=".length) : DRAFT_DIR;
  const res = analyseDir(dir);
  const graph = verifyDependencyGraph();

  if (argv.includes("--json")) { console.log(JSON.stringify({ ...res, graph }, null, 2)); process.exit(0); }

  console.log(`\nMigration static analysis — ${dir.replace(join(HERE, "..", "..") + "/", "")}\n`);
  let blocked = 0, destructive = 0;
  for (const f of res.files || []) {
    const icon = f.verdict === VERDICT.SAFE ? "✓" : f.verdict === VERDICT.REVIEW_REQUIRED ? "!" : "✗";
    console.log(`  ${icon} ${f.verdict.padEnd(16)} ${f.name}`);
    for (const x of f.findings) {
      console.log(`        [${x.verdict}] ${x.id}: ${x.why}`);
      if (x.safeAlternative) console.log(`            → ${x.safeAlternative}`);
    }
    if (f.rollback) {
      console.log(`        rollback: ${f.rollback.declared}${f.rollback.createsOnly ? " (creates only)" : " (moves data)"}`);
      for (const x of f.rollback.findings) console.log(`            ✗ ${x}`);
    }
    if (f.verdict === VERDICT.BLOCKED) blocked++;
    if (f.verdict === VERDICT.DESTRUCTIVE) destructive++;
  }
  console.log(`\n  dependency graph: ${graph.phases} phases, ${graph.findings.length} finding(s)`);
  for (const x of graph.findings) console.log(`      ✗ ${x}`);
  console.log(`\n  ${blocked} BLOCKED, ${destructive} DESTRUCTIVE\n`);
  const bad = blocked + graph.findings.length + (res.files || []).reduce((n, f) => n + (f.rollback ? f.rollback.findings.length : 0), 0);
  console.log(bad ? "✗ STATIC ANALYSIS FOUND BLOCKING ISSUES\n" : "✓ NO BLOCKING ISSUE\n");
  process.exit(bad ? 1 : 0);
}
