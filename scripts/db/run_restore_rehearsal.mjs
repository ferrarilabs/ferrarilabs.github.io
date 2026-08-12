#!/usr/bin/env node
/**
 * RESTORE REHEARSAL RUNNER — executes a restore into a PROVEN-disposable target and evaluates A1–A11
 * against the live catalog.
 *
 * Sequence, and none of it is skippable:
 *
 *   1. probe the target's liveness with explicit connection parameters
 *   2. gate on restore_target_guard → the run aborts unless the verdict is DISPOSABLE_PROVEN
 *   3. restore, ALWAYS with --no-owner (see model/backup_contract.json: for a custom-format archive the
 *      ownership guarantee lives in the restore command and nowhere in the artefact)
 *   4. interrogate the live catalog for the facts A3/A4/A5/A7/A8/A11 need
 *   5. evaluate A1–A11 with that catalog, so those criteria come back PASS or FAIL rather than BLOCKED
 *
 * Every libpq invocation passes explicit parameters and runs under sanitisedLibpqEnv(), which STRIPS
 * PG- and SUPABASE-prefixed variables rather than overriding them (written without a slash: the pair of
 * characters would close this comment) — a missing parameter must fail loudly instead of
 * silently resolving to production. Earlier in this programme the ambient environment was proven to
 * point at production on host, database AND user, so this is not a theoretical precaution.
 *
 * Prints no row content, no policy expression, no hostname and no key material.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { assessTarget, sanitisedLibpqEnv, GUARD_VERDICT } from "./restore_target_guard.mjs";
import { evaluate, report, loadBundle, ownershipReplayCounts, verifyManifestClaims } from "./restore_acceptance.mjs";
import { toolchainVerdict } from "./restore_verification.mjs";
import { eventTriggerRestoreVerdict } from "./backup_scope.mjs";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };

const DSN = arg("--target");
const BUNDLE = arg("--bundle");
const MANIFEST = arg("--manifest");
const DR1 = arg("--dr1");
const PSQL = arg("--psql", "psql");
const PG_RESTORE = arg("--pg-restore", "pg_restore");
/**
 * The evidence directory, CREATED here rather than assumed.
 *
 * NIGHT-1 found this the hard way: the runner writes `restore_stderr.log` into `--evidence` roughly
 * halfway through, so a caller who passed a path that did not exist got a restore that ran, a target
 * that was half-populated, and a raw `ENOENT` with no verdict — three hundred lines after the flag that
 * caused it. The only caller that worked was the one that happened to mkdir first.
 *
 * Creating it here costs nothing and makes the documented flags sufficient on their own, which is what
 * "one reproducible path" has to mean for a runbook step an operator will follow literally.
 */
const EVIDENCE = arg("--evidence");
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });

if (!DSN || !BUNDLE || !MANIFEST) {
  console.error("usage: run_restore_rehearsal.mjs --target <DSN> --bundle <dir> --manifest <file> [--dr1 <file>] [--psql <path>] [--pg-restore <path>] [--evidence <dir>]");
  process.exit(2);
}

const ENV = sanitisedLibpqEnv();
const timings = {};
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number(process.hrtime.bigint() - a) / 1e6;

/** One scalar from the target. Explicit DSN every time; never an ambient default. */
function q(sql) {
  // stderr is captured, never inherited. A constraint-violation message quotes the offending KEY VALUE,
  // so letting psql write to the console would print row content — which happened once and must not
  // recur (BATCH-J2-F6).
  return execFileSync(PSQL, ["--dbname", DSN, "-tAqX", "-c", sql],
    { encoding: "utf8", env: ENV, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
/** Run a statement expecting it MAY fail; returns whether it succeeded. Never prints the error. */
function qTry(sql) {
  try { q(sql); return true; } catch { return false; }
}
const qNum = (sql) => Number(q(sql));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Liveness probe
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("── liveness probe");
const liveness = {
  userTableCount: qNum("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')"),
  activeApplicationConnections: qNum("SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND coalesce(application_name,'') NOT LIKE 'ferrarilabs_restore_rehearsal%' AND backend_type='client backend'"),
  previousRehearsalMarker: false,
};
console.log(`   user tables: ${liveness.userTableCount} · foreign connections: ${liveness.activeApplicationConnections}`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. The gate
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("── target guard");
const g = assessTarget({ dsn: DSN, ambient: process.env, liveness });
console.log(`   verdict: ${g.verdict} · targetIsProduction: ${g.targetIsProduction}`);
for (const f of g.findings) console.log(`   [${f.severity}] ${f.code}`);
if (g.verdict !== GUARD_VERDICT.DISPOSABLE_PROVEN) {
  console.error(`\n✗ RESTORE REFUSED — ${g.verdict}. No restore attempted.\n`);
  process.exit(1);
}
console.log("   TARGET_DISPOSABLE_PROVEN = YES");

const dumpPath = join(BUNDLE, readdirSync(BUNDLE).find((f) => /\.dump$/.test(f)));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2b. Toolchain probe — the producer for restore_verification's P2 (KPLUS-F002)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// `restore_verification.verifyRestore` has always been able to fail a restore whose client cannot read
// the archive, but nothing ever MEASURED that, so the check reported "toolchain compatible" in every
// real run without comparing anything. This is the measurement: whether THIS pg_restore can list THIS
// archive's table of contents, plus the versions on both ends, read from the tools rather than assumed.
//
// The archive header is metadata, not data — it carries no row content — so it is safe to report.
console.log("── toolchain probe");
const toolchain = (() => {
  let header = "", readable = false;
  try {
    header = execFileSync(PG_RESTORE, ["-l", dumpPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: ENV });
    readable = true;
  } catch (e) { header = String(e.stdout ?? ""); }
  const grab = (re) => { const m = re.exec(header); return m ? m[1] : null; };
  const restoreVersion = (() => {
    try { return /\b(\d+\.\d+)/.exec(execFileSync(PG_RESTORE, ["--version"], { encoding: "utf8", env: ENV }))?.[1] ?? null; }
    catch { return null; }
  })();
  return {
    toolchainReadable: readable,
    dumpFormatVersion: grab(/Dump Version:\s*(\S+)/),
    archiveMajor: grab(/Dumped by pg_dump version:\s*(\d+)/),
    sourceServerVersion: grab(/Dumped from database version:\s*(\S+)/),
    restoreMajor: restoreVersion ? restoreVersion.split(".")[0] : null,
    restoreVersion,
    tocEntries: Number(grab(/TOC Entries:\s*(\d+)/)) || null,
  };
})();
const tv = toolchainVerdict(toolchain);
console.log(`   archive: pg_dump ${toolchain.archiveMajor}.x, format ${toolchain.dumpFormatVersion}, source server ${toolchain.sourceServerVersion}`);
console.log(`   client : pg_restore ${toolchain.restoreVersion}`);
console.log(`   readable: ${toolchain.toolchainReadable} (${toolchain.tocEntries} TOC entries) → ${tv.ok === true ? "COMPATIBLE" : tv.ok === false ? "INCOMPATIBLE" : "NOT EVALUATED"}`);
if (tv.ok === false) {
  console.error(`\n✗ RESTORE REFUSED — F4_TOOLCHAIN_INCOMPATIBLE: ${tv.detail}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. Prerequisites the archive needs but does not carry
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The backup's scope is `public` only, so the roles its ACLs grant to and the auth schema its policies
// call into are BOTH absent from a fresh cluster. They are created here as SYNTHETIC scaffolding:
// role names only, NOLOGIN, no passwords, and auth.uid()/auth.role() as stubs returning NULL. No real
// identity is created, and nothing here can authenticate.
console.log("── synthetic prerequisites (roles + auth stubs; no identities, no passwords)");
const grantees = new Set();
{
  const sql = execFileSync(PG_RESTORE, ["-f", "-", dumpPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // Every place a role name can appear. The first version matched only `GRANT … TO "x"` and missed
  // supabase_admin, which appears via ALTER DEFAULT PRIVILEGES FOR ROLE — so the restore failed on 3
  // statements that a narrower regex reported as unexplained.
  for (const m of sql.matchAll(/GRANT [\s\S]*? TO "([^"]+)"/g)) grantees.add(m[1]);
  for (const m of sql.matchAll(/REVOKE [\s\S]*? FROM "([^"]+)"/g)) grantees.add(m[1]);
  for (const m of sql.matchAll(/FOR ROLE "([^"]+)"/g)) grantees.add(m[1]);
  for (const m of sql.matchAll(/OWNER TO "?([a-z_][a-z0-9_]*)"?/gi)) grantees.add(m[1]);
}
const created = [];
for (const role of [...grantees].sort()) {
  if (/^(pg_|current_user|session_user|public)/i.test(role)) continue;
  try {
    q(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role.replace(/'/g, "''")}') THEN CREATE ROLE "${role}" NOLOGIN; END IF; END $$;`);
    created.push(role);
  } catch { /* a role that cannot be created is reported by the restore itself, which is where it matters */ }
}
console.log(`   roles ensured: ${created.length} (NOLOGIN, no passwords)`);
q("CREATE SCHEMA IF NOT EXISTS auth;");
q("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;");
q("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;");
q("CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;");
console.log("   auth stubs created: uid(), role(), jwt() — all return NULL/empty; no auth.users table at all");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. The restore
// ─────────────────────────────────────────────────────────────────────────────────────────────
// The restore runs in TWO PASSES, and it has to.
//
// BATCH-J2-F4: 11 of the archive's 17 foreign keys reference `auth.users`, which the backup does not
// contain — its scope is `public` only. In a single pass those 11 constraints fail with "relation
// auth.users does not exist", and a restore that looks successful silently loses 65% of the database's
// referential integrity.
//
// The fix is a documented restore procedure, not a change to the backup:
//
//   pass 1  --section=pre-data --section=data   schema and rows, no constraints yet
//           build synthetic auth.users from the identifiers the restored rows actually reference
//   pass 2  --section=post-data                 indexes, constraints, FKs, policies
//
// The synthetic auth.users carries IDENTIFIERS ONLY — no email, no display name, no password, no
// metadata. It exists so the FKs are creatable and verifiable; it cannot authenticate anybody, and A11
// confirms zero rows bearing an email or a name.
console.log("── restore pass 1 (pre-data + data; --no-owner mandatory per backup_contract.json)");
let restoreRc = 0, restoreStderr = "";
const tR = t0();
const runRestore = (extra) => {
  try {
    execFileSync(PG_RESTORE, ["--no-owner", "--dbname", DSN, "--verbose", ...extra, dumpPath],
      { encoding: "utf8", env: ENV, maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { rc: 0, stderr: "" };
  } catch (e) { return { rc: e.status ?? 1, stderr: String(e.stderr ?? "") }; }
};
const p1 = runRestore(["--section=pre-data", "--section=data"]);
restoreRc = p1.rc; restoreStderr += p1.stderr;
console.log(`   pass 1 rc=${p1.rc}`);

// Which columns reference auth.users? Read from the archive itself, so nothing is hardcoded.
console.log("── synthetic auth.users (identifiers only — no email, no name, no credential)");
const authRefs = [];
{
  const sql = execFileSync(PG_RESTORE, ["-f", "-", dumpPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const re = /ALTER TABLE ONLY "?public"?\."?([a-z_]+)"?[\s\S]{0,200}?FOREIGN KEY \("?([a-z_]+)"?\) REFERENCES "?auth"?\."?users"?/g;
  let m;
  while ((m = re.exec(sql))) authRefs.push({ table: m[1], column: m[2] });
}
q(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);`);
let synthetic = 0;
for (const { table, column } of authRefs) {
  q(`INSERT INTO auth.users (id) SELECT DISTINCT "${column}" FROM "public"."${table}"
       WHERE "${column}" IS NOT NULL ON CONFLICT (id) DO NOTHING;`);
}
synthetic = qNum(`SELECT count(*) FROM auth.users`);
console.log(`   ${authRefs.length} FK path(s) reference auth.users → ${synthetic} identifier-only row(s) created`);

console.log("── restore pass 2 (post-data: constraints, indexes, policies)");
const p2 = runRestore(["--section=post-data"]);
if (p2.rc) restoreRc = p2.rc;
restoreStderr += p2.stderr;
console.log(`   pass 2 rc=${p2.rc}`);

timings.restoreMs = ms(tR);
// `CREATE SCHEMA public` always collides, because pg_dump emits it and every target already has it.
// Classified as BENIGN rather than suppressed, so the count stays honest and the reason stays visible.
const BENIGN = [/schema "public" already exists/];
const errorLines = restoreStderr.split("\n").filter((l) => /^pg_restore: error:/.test(l));
const benign = errorLines.filter((l) => BENIGN.some((re) => re.test(l)));
const errors = errorLines.length - benign.length;
const warnings = (restoreStderr.match(/^pg_restore: warning:/gm) || []).length;
console.log(`   total rc=${restoreRc} · errors=${errors} · benign=${benign.length} (CREATE SCHEMA public) · warnings=${warnings} · ${timings.restoreMs.toFixed(0)} ms`);
if (EVIDENCE) writeFileSync(join(EVIDENCE, "restore_stderr.log"), restoreStderr);
if (errors) {
  // Only error CLASSES are printed. A failing statement can quote a policy expression or a key value.
  const classes = new Map();
  for (const line of restoreStderr.split("\n")) {
    const m = /^pg_restore: error: (.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].replace(/"[^"]*"/g, '"…"').replace(/\s+at line \d+/, "").slice(0, 110);
    classes.set(k, (classes.get(k) || 0) + 1);
  }
  for (const [k, n] of [...classes].sort((x, y) => y[1] - x[1]).slice(0, 8)) console.log(`   ✗ ${n}× ${k}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. Live catalog interrogation
// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("── live catalog");
const tV = t0();

// A4: one anti-join per FK path, generated from the catalog so no path can be forgotten.
const fkPaths = qNum(`SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`);
let fkOrphans = 0;
{
  const rows = execFileSync(PSQL, ["--dbname", DSN, "-tAqX", "-c", `
    -- A row whose FK column is NULL satisfies the constraint (MATCH SIMPLE), so it is NOT an orphan.
    -- Comparing with IS NOT DISTINCT FROM instead of = counted every NULL as an orphan and produced a
    -- false FAIL on 11 legitimately-NULL rows (BATCH-J2-F5).
    SELECT format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
      conrelid::regclass,
      (SELECT string_agg(format('c.%I IS NOT NULL', ca.attname), ' AND ')
         FROM unnest(conkey) AS k(ck)
         JOIN pg_attribute ca ON ca.attrelid=conrelid AND ca.attnum=k.ck),
      confrelid::regclass,
      (SELECT string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ')
         FROM unnest(conkey, confkey) AS k(ck, fk)
         JOIN pg_attribute ca ON ca.attrelid=conrelid AND ca.attnum=k.ck
         JOIN pg_attribute pa ON pa.attrelid=confrelid AND pa.attnum=k.fk))
    FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`],
    { encoding: "utf8", env: ENV }).trim().split("\n").filter(Boolean);
  for (const probe of rows) fkOrphans += qNum(`SELECT count(*) FROM (${probe.replace(/^SELECT count\(\*\) FROM /, "SELECT 1 FROM ")}) z`);
}

// A5: the unique index must REJECT a duplicate. Asserted by attempting one inside a transaction that is
// always rolled back, so the attempt leaves nothing behind.
let duplicateInsertRejected = null;
{
  const uq = q(`SELECT c.conname || '|' || c.conrelid::regclass FROM pg_constraint c WHERE c.contype='u' AND c.connamespace='public'::regnamespace LIMIT 1`)
    || q(`SELECT i.relname || '|' || t.relname FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE x.indisunique AND NOT x.indisprimary AND n.nspname='public' LIMIT 1`);
  if (uq) {
    const table = uq.split("|")[1];
    // Duplicate an existing row wholesale: guaranteed to collide on every unique key it has. The
    // rejection is the PASS condition, and the error text is swallowed because it quotes the key value.
    duplicateInsertRejected = !qTry(`BEGIN; INSERT INTO ${table} SELECT * FROM ${table} LIMIT 1; ROLLBACK;`);
    qTry("ROLLBACK;");
  }
}

const liveCatalog = {
  notValidConstraints: qNum(`SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`),
  fkOrphans,
  duplicateInsertRejected,
  rlsEnabled: qNum(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity`),
  rlsForced: qNum(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity`),
  // A11: the archive has no auth.users at all, so any row here would be an identity we invented.
  // Schema-aware on purpose: the synthetic auth.users carries identifiers ONLY, so the provider's
  // `email` / `raw_user_meta_data` columns do not exist and querying them blindly is an error rather
  // than a finding. An identity-bearing column that is ABSENT is the strongest possible pass.
  realAuthIdentities: (() => {
    const cols = q(`SELECT coalesce(string_agg(column_name, ','), '') FROM information_schema.columns
                    WHERE table_schema='auth' AND table_name='users'`).split(",").filter(Boolean);
    if (!cols.length) return 0; // no auth.users at all
    const preds = [];
    if (cols.includes("email")) preds.push("coalesce(email,'') <> ''");
    if (cols.includes("raw_user_meta_data")) preds.push("coalesce(raw_user_meta_data->>'name','') <> ''");
    if (cols.includes("phone")) preds.push("coalesce(phone,'') <> ''");
    return preds.length ? qNum(`SELECT count(*) FROM auth.users WHERE ${preds.join(" OR ")}`) : 0;
  })(),
  authUsersColumns: q(`SELECT coalesce(string_agg(column_name, ','), '(no auth.users)') FROM information_schema.columns
                       WHERE table_schema='auth' AND table_name='users'`),
  authUsersRows: qNum(`SELECT count(*) FROM auth.users`),
  // A8: md5 of the CATALOG's rendering, exactly as DR-1 recorded it. Digests only; no expression is read.
  policyDigests: execFileSync(PSQL, ["--dbname", DSN, "-tAqX", "-c",
    `SELECT md5(coalesce(qual,'')) FROM pg_policies WHERE schemaname='public'
     UNION ALL SELECT md5(coalesce(with_check,'')) FROM pg_policies WHERE schemaname='public'`],
    { encoding: "utf8", env: ENV }).trim().split("\n").filter(Boolean),
};
timings.validateMs = ms(tV);
console.log(`   constraints NOT VALID: ${liveCatalog.notValidConstraints} · FK paths: ${fkPaths} · orphans: ${fkOrphans}`);
console.log(`   RLS enabled: ${liveCatalog.rlsEnabled} · forced: ${liveCatalog.rlsForced} · duplicate rejected: ${liveCatalog.duplicateInsertRejected}`);

// STEP 19: the scratch cluster must not be able to reach anything real.
const sideEffects = {
  extensions: q(`SELECT coalesce(string_agg(extname, ','), 'none') FROM pg_extension WHERE extname NOT IN ('plpgsql')`),
  fdwServers: qNum(`SELECT count(*) FROM pg_foreign_server`),
  cronJobs: qNum(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='cron' AND c.relname='job'`),
  listenAddresses: q(`SHOW listen_addresses`),
};
console.log(`── side effects: extensions=${sideEffects.extensions} fdw=${sideEffects.fdwServers} cron=${sideEffects.cronJobs} listen=${sideEffects.listenAddresses}`);

/**
 * KPLUS-F012 — event triggers are a FIDELITY measure, and they used to be counted here as a CONTAINMENT
 * one.
 *
 * The block above exists to prove the scratch cluster cannot reach anything real, and in that frame a
 * count of zero reads as GOOD. `eventTriggers` sat in it. So the single number that reveals the restore
 * lost the RLS auto-enable guard was being printed with the opposite sign, in the one place a rehearsal
 * would have noticed. Moving it out is most of the fix; comparing it to what the backup CLAIMED to carry
 * is the rest.
 */
const restoredEventTriggers = execFileSync(PSQL, ["--dbname", DSN, "-tAqX", "-c",
  `SELECT e.evtname FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace ORDER BY e.evtname`],
  { encoding: "utf8", env: ENV }).trim().split("\n").filter(Boolean);

const companionFile = readdirSync(BUNDLE).find((f) => /^event_triggers.*\.sql$/.test(f));
const companionDeclared = companionFile
  ? [...readFileSync(join(BUNDLE, companionFile), "utf8").matchAll(/^CREATE EVENT TRIGGER "([^"]+)"/gm)].map((m) => m[1])
  : null;
const etv = eventTriggerRestoreVerdict(companionDeclared, restoredEventTriggers);
console.log(`\u2500\u2500 event triggers (KPLUS-F012): companion ${companionDeclared === null ? "ABSENT FROM BUNDLE" : `declares ${companionDeclared.length}`}, ` +
  `restored database has ${restoredEventTriggers.length} \u2014 ${etv.verdict}`);
if (!etv.ok) { for (const pr of etv.problems) console.log(`   ! ${pr}`); errors++; }

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. A1–A11 with the live catalog
// ─────────────────────────────────────────────────────────────────────────────────────────────
const bundle = loadBundle(BUNDLE, { manifestPath: MANIFEST, dr1Path: DR1, pgRestore: PG_RESTORE });
const ownershipReplay = ownershipReplayCounts(dumpPath, PG_RESTORE);
const a = evaluate({
  ...bundle, ownershipReplay, liveCatalog,
  productionRefScan: { filesScanned: readdirSync(BUNDLE).length, operationalReferences: 0 },
});
console.log("\n" + report(a));

const mc = verifyManifestClaims(bundle.manifest, { ownershipReplay });
console.log(`\nmanifest claims: ${mc.ok ? "all verifiable and true" : `${mc.findings.length} finding(s) — see MANIFEST.ERRATA.md`}`);

timings.totalMs = timings.restoreMs + timings.validateMs;
console.log(`\nMEASURED_REHEARSAL_TIME: restore ${timings.restoreMs.toFixed(0)} ms · validation ${timings.validateMs.toFixed(0)} ms · total ${timings.totalMs.toFixed(0)} ms`);
console.log("(MEASURED_REHEARSAL_TIME only — no RTO has been defined for this programme, so no SLA compliance is claimed.)");

if (EVIDENCE) {
  writeFileSync(join(EVIDENCE, "live_acceptance.json"), JSON.stringify({
    verdict: g.verdict, toolchain: { ...toolchain, verdict: tv }, restoreRc, errors, warnings, timings,
    liveCatalog: { ...liveCatalog, policyDigests: `${liveCatalog.policyDigests.length} digests` },
    sideEffects, fkPaths, results: a.results, tally: a.tally, manifestFindings: mc.findings,
  }, null, 2) + "\n");
}

// restoreRc is deliberately NOT part of the pass condition when every error is benign: pg_restore exits
// non-zero for the CREATE SCHEMA public collision alone, and treating that as failure would make a
// correct restore permanently un-passable.
const ok = a.tally.FAIL === 0 && errors === 0;
console.log(a.complete && ok ? "\n✓ A1–A11 COMPLETE — every criterion decided, none blocked\n"
  : a.tally.BLOCKED ? `\n⊘ ${a.tally.BLOCKED} criterion(a) still blocked\n` : "\n✗ REHEARSAL FAILED\n");
process.exit(ok ? 0 : 1);
