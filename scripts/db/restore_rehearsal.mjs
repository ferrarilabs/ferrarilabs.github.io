#!/usr/bin/env node
/**
 * Restore-rehearsal orchestrator — preflight guards, restore sequencing, A1–A11 acceptance,
 * evidence manifest, cleanup plan.
 *
 * WHY THIS EXISTS
 * Three backup writers exist in this repository and ZERO readers (finding DG-01). A backup that has
 * never been restored is an untested assertion, and the project's own standing rule is not to declare
 * something protected without evidence. This script is the missing reader.
 *
 * IT CANNOT TOUCH PRODUCTION. By construction:
 *   · it refuses to run unless an explicit disposable target is supplied;
 *   · it refuses if the target's project ref matches the production ref (guard G3);
 *   · it never reads the production connection profile;
 *   · every acceptance query is read-only;
 *   · `--dry-run` (the DEFAULT) performs every local validation and executes nothing remote.
 *
 * DEFAULT IS DRY-RUN. Restoring requires `--execute` plus a target DSN. That asymmetry is deliberate:
 * the dangerous mode should be the one you have to ask for.
 *
 * Usage:
 *   node scripts/db/restore_rehearsal.mjs                       # dry-run: validate everything local
 *   node scripts/db/restore_rehearsal.mjs --backup=<dir>         # point at a specific backup
 *   node scripts/db/restore_rehearsal.mjs --execute --target-dsn=... --key-file=...
 *   node scripts/db/restore_rehearsal.mjs --json-out=evidence.json
 *
 * Exit: 0 all gates passed · 1 a gate failed · 2 runner/usage error.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ACCEPTANCE_CHECKS, EXPECTED_STRUCTURE, APP_TABLES } from "./acceptance_checks.mjs";
import { pathToFileURL } from "node:url";

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const val = (p) => { const a = ARGS.find((x) => x.startsWith(p)); return a ? a.slice(p.length) : null; };

const BACKUP_ROOT = join(homedir(), "Documents/GitHub/ferrarilabs-work/backups");
const EXECUTE = has("--execute");

/**
 * The production project ref, as a sha256 digest. Used ONLY to refuse a target that matches it
 * (guard G3). Stored as a digest so this file never contains the ref itself — the guard compares
 * digests, never plaintext.
 *
 * THIS VALUE MUST BE THE REAL DIGEST. An earlier draft carried an invented placeholder, which meant
 * G3 could never fire: it would have cheerfully accepted the production project as a rehearsal target
 * while reporting PASS. A guard that cannot trigger is worse than no guard, because it manufactures
 * confidence. `test_restore_rehearsal.mjs` asserts the digest is well-formed and that a matching ref
 * is actually refused.
 */
export const PRODUCTION_REF_SHA256 = "ad9cb2c065690ecb525308797281349bb372e0440e2c5d725d18c7f05501bc8f";

const gates = [];
const gate = (id, title, status, detail) => { gates.push({ id, title, status, detail }); return status === "PASS"; };
const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

// ── backup discovery ──────────────────────────────────────────────────────────
function findBackup() {
  const explicit = val("--backup=");
  if (explicit) return explicit;
  if (!existsSync(BACKUP_ROOT)) return null;
  const candidates = readdirSync(BACKUP_ROOT)
    .filter((d) => /^\d{8}T\d{6}Z$/.test(d))
    .filter((d) => existsSync(join(BACKUP_ROOT, d, "MANIFEST.txt")))
    .sort()
    .reverse();
  return candidates.length ? join(BACKUP_ROOT, candidates[0]) : null;
}

/**
 * Parse MANIFEST.txt.
 *
 * Row counts are tolerated in three shapes because the generator has produced more than one:
 *   row_count.<table>|<n>     (current)
 *   row_count.<table>,<n>
 *   row_count.<table> = <n>
 *
 * Non-numeric `row_count.*` lines are IGNORED rather than parsed as tables. The current manifest
 * contains `row_count.BEGIN`, `row_count.SET` and `row_count.ROLLBACK` — psql command tags that
 * leaked into the manifest when it was generated. Harmless, but recorded as a defect in the backup
 * tooling (see BACKUP_RESTORE_OPERATIONAL_DESIGN.md): a manifest is evidence and should not contain
 * transcript noise. Filtering here rather than rewriting the manifest, because the manifest is signed
 * evidence of a completed backup and must not be edited after the fact.
 */
function parseManifest(dir) {
  const txt = readFileSync(join(dir, "MANIFEST.txt"), "utf8");
  const kv = {};
  const rowCounts = {};
  const noise = [];
  for (const line of txt.split("\n")) {
    const rc = line.match(/^row_count\.([A-Za-z_][A-Za-z0-9_]*)\s*[|,=]\s*(\d+)\s*$/);
    if (rc) { rowCounts[rc[1]] = Number(rc[2]); continue; }
    if (/^row_count\./.test(line)) { noise.push(line.trim()); continue; }
    const m = line.match(/^([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  return { kv, rowCounts, noise, raw: txt };
}

// ── PREFLIGHT GUARDS ──────────────────────────────────────────────────────────
function preflight(backupDir, manifest) {
  // G1 — backup artefacts present
  const enc = readdirSync(backupDir).find((f) => f.endsWith(".tar.gz.enc"));
  gate("G1", "encrypted backup artefact present", enc ? "PASS" : "FAIL",
    enc ? `${enc}` : "no *.tar.gz.enc in the backup directory");

  // G2 — backup hash validation against the manifest
  if (enc) {
    const actual = sha256File(join(backupDir, enc));
    const expected = manifest.kv["sha256.bundle_encrypted"];
    gate("G2", "encrypted archive sha256 matches manifest",
      expected ? (actual === expected ? "PASS" : "FAIL") : "FAIL",
      expected ? (actual === expected ? `sha256 ${actual.slice(0, 12)}…` :
        `manifest ${expected.slice(0, 12)}… vs actual ${actual.slice(0, 12)}…`)
        : "manifest has no sha256.bundle_encrypted");
  }

  // G3 — PRODUCTION MISMATCH. The single most important guard.
  const targetDsn = val("--target-dsn=") || process.env.REHEARSAL_TARGET_DSN || "";
  if (EXECUTE) {
    if (!targetDsn) {
      gate("G3", "target is a disposable project, not production", "FAIL",
        "--execute requires --target-dsn (or REHEARSAL_TARGET_DSN)");
    } else {
      // Extract the project ref from a Supabase DSN without logging the DSN.
      const refMatch = targetDsn.match(/postgres\.([a-z0-9]{20})|\/\/([a-z0-9]{20})\./);
      const ref = refMatch ? (refMatch[1] || refMatch[2]) : null;
      if (!ref) {
        gate("G3", "target is a disposable project, not production", "FAIL",
          "could not extract a project ref from the target DSN — refusing rather than guessing");
      } else if (sha256(ref) === PRODUCTION_REF_SHA256) {
        gate("G3", "target is a disposable project, not production", "FAIL",
          "TARGET IS THE PRODUCTION PROJECT — refusing. This guard exists so a rehearsal can never " +
          "destroy production.");
      } else {
        gate("G3", "target is a disposable project, not production", "PASS",
          `target ref digest ${sha256(ref).slice(0, 12)}… differs from production`);
      }
    }
    // G4 — the production connection profile must NOT be loaded in this shell
    const leaked = ["PGHOST", "PGUSER", "PGPASSWORD", "PGPASSFILE", "PGDATABASE"]
      .filter((k) => process.env[k]);
    gate("G4", "production connection profile absent from the environment",
      leaked.length === 0 ? "PASS" : "FAIL",
      leaked.length === 0 ? "no PG* variables set"
        : `PG* variables present (${leaked.join(", ")}) — unset them; a stray PGHOST can redirect psql`);
  } else {
    gate("G3", "target is a disposable project, not production", "SKIP",
      "dry-run: no target supplied, nothing can be written anywhere");
    gate("G4", "production connection profile absent from the environment", "SKIP", "dry-run");
  }

  // G5 — a pg_restore that can READ this archive must be available on this machine
  //
  // The question this guard asks is "can this archive be restored HERE", not "is the default
  // client the right version". Those differ whenever more than one PostgreSQL client is installed,
  // which is the normal state on a machine that talks to more than one server.
  //
  // Measured 2026-08-12: the canonical backup was written by pg_dump 18.4, and the linked client
  // was 17.10, so G5 failed. Homebrew's versioned formulae are KEG-ONLY — installing
  // postgresql@18 leaves postgresql@17 linked and undamaged, and puts an 18.4 pg_restore at
  // /opt/homebrew/opt/postgresql@18/bin. Demanding that the newer client also become the DEFAULT
  // would force replacing a working installation to satisfy a check, which is the wrong direction.
  //
  // So: search candidates, take the first that is new enough, and REPORT WHICH ONE. Reporting the
  // path is the point — a rehearsal that passes via a client the operator did not know was being
  // used is not evidence. `PG_RESTORE` overrides everything for the non-Homebrew case.
  const producer = manifest.kv["pg_dump_client_version"] || "";
  const producerMajor = producer.split(".")[0];
  const candidates = [
    process.env.PG_RESTORE,
    "pg_restore",
    "/opt/homebrew/opt/postgresql@18/bin/pg_restore",
    "/usr/local/opt/postgresql@18/bin/pg_restore",
    "/opt/homebrew/opt/libpq/bin/pg_restore",
  ].filter(Boolean);

  let chosen = null, chosenMajor = null, best = null;
  for (const bin of candidates) {
    const out = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (out.error || out.status !== 0) continue;
    const m = (out.stdout || "").match(/(\d+)\.\d+/);
    if (!m) continue;
    const major = Number(m[1]);
    if (best === null || major > best) best = major;
    if (producerMajor && major >= Number(producerMajor)) { chosen = bin; chosenMajor = major; break; }
  }

  gate("G5", "pg_restore major version can read this archive",
    chosen ? "PASS" : "FAIL",
    chosen
      ? `archive produced by pg_dump ${producer}; using pg_restore ${chosenMajor}.x at ${chosen}`
      : `archive produced by pg_dump ${producer || "?"}; best available pg_restore ${best ?? "?"}.x — ` +
        `a custom-format archive cannot be read by an OLDER pg_restore. Install PostgreSQL ` +
        `${producerMajor || "18"} client tools (keg-only: it will not replace your current one), ` +
        `or set PG_RESTORE to a compatible binary.`);

  // G6 — decryption key available and decryption actually works
  const keyFile = val("--key-file=") || defaultKeyFor(manifest.kv["backup_id"]);
  if (!keyFile || !existsSync(keyFile)) {
    gate("G6", "decryption key available", "FAIL",
      "no key file found — pass --key-file=<path>. Key custody is the operator's; this script never " +
      "reads its contents into any output.");
  } else {
    const mode = (statSync(keyFile).mode & 0o777).toString(8);
    const encPath = enc ? join(backupDir, enc) : null;
    let ok = false, detail = "";
    if (encPath) {
      const out = `/tmp/_rehearsal_probe_${process.pid}.tar.gz`;
      const d = spawnSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000",
        "-in", encPath, "-out", out, "-pass", `file:${keyFile}`], { encoding: "utf8" });
      if (d.status === 0 && existsSync(out)) {
        const got = sha256File(out);
        const want = manifest.kv["sha256.bundle_plaintext"];
        ok = want ? got === want : true;
        detail = ok ? `decrypted and plaintext sha256 matches manifest (key mode ${mode})`
                    : `decrypted but plaintext sha256 differs from manifest`;
        spawnSync("rm", ["-f", out]);
      } else {
        detail = "openssl could not decrypt with the supplied key";
      }
    }
    gate("G6", "decryption works and yields the manifest's plaintext hash", ok ? "PASS" : "FAIL", detail);
    gate("G7", "key file permissions are restrictive", mode === "600" ? "PASS" : "WARN",
      `mode ${mode} (expected 600)`);
  }

  // G8 — manifest must carry the row counts A2 compares against
  const missing = APP_TABLES.filter((t) => !(t in manifest.rowCounts));
  gate("G8", "manifest carries per-table row counts for A2",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0 ? `${Object.keys(manifest.rowCounts).length} tables recorded`
      : `missing row counts for: ${missing.join(", ")} — A2 cannot be evaluated`);

  // G8b — manifest hygiene. Transcript noise is harmless but is a defect in the generator.
  if (manifest.noise.length) {
    gate("G8b", "manifest contains no transcript noise", "WARN",
      `${manifest.noise.length} non-numeric row_count.* line(s) — psql command tags leaked into the ` +
      `manifest during generation. Ignored here; fix the generator, do not edit signed evidence.`);
  } else {
    gate("G8b", "manifest contains no transcript noise", "PASS", "clean");
  }

  // G9 — side-effect isolation. These must be OFF for the rehearsal.
  const sideEffects = [
    ["scheduler", process.env.REHEARSAL_ALLOW_SCHEDULER === "1"],
    ["email sending", !!(process.env.EMAILJS_PRIVATE_KEY || process.env.EMAILJS_USER_ID)],
    ["external provider writes", process.env.REHEARSAL_ALLOW_EXTERNAL === "1"],
  ].filter(([, on]) => on).map(([n]) => n);
  gate("G9", "side effects disabled (scheduler, email, external integrations)",
    sideEffects.length === 0 ? "PASS" : "FAIL",
    sideEffects.length === 0 ? "no scheduler/email/external credentials or overrides present"
      : `ENABLED: ${sideEffects.join(", ")} — a rehearsal must not send mail or drive a provider`);

  // G10 — synthetic auth strategy must be declared before restoring
  const authStrategy = val("--auth-strategy=") || "synthetic-uuid-seed";
  const allowed = ["synthetic-uuid-seed", "null-out-actors"];
  gate("G10", "auth.users strategy is declared and permitted",
    allowed.includes(authStrategy) ? "PASS" : "FAIL",
    allowed.includes(authStrategy)
      ? `${authStrategy} — no real identity is restored (ratified first-rehearsal rule)`
      : `unknown strategy "${authStrategy}"; permitted: ${allowed.join(", ")}`);

  return { enc, targetDsn, keyFile, authStrategy };
}

function defaultKeyFor(backupId) {
  if (!backupId) return null;
  const p = join(homedir(), "Documents/GitHub/ferrarilabs-work/.backup-keys", `backup-${backupId}.key`);
  return existsSync(p) ? p : null;
}

// ── RESTORE SEQUENCING (documented; executed only with --execute) ─────────────
export const RESTORE_SEQUENCE = [
  { step: 1, action: "decrypt archive to a working dir OUTSIDE any git tree", destructive: false },
  { step: 2, action: "verify plaintext sha256 against manifest", destructive: false },
  { step: 3, action: "pg_restore --schema-only into the disposable target", destructive: true },
  { step: 4, action: "apply the event-trigger companion (ensure_rls) OR record the deviation", destructive: true },
  { step: 5, action: "seed synthetic auth.users rows — UUIDs referenced by the data, no email/name", destructive: true },
  { step: 6, action: "pg_restore --data-only --disable-triggers", destructive: true },
  { step: 7, action: "VALIDATE CONSTRAINT on every NOT VALID constraint", destructive: true },
  { step: 8, action: "run A1–A11 acceptance checks (all read-only)", destructive: false },
  { step: 9, action: "write the evidence manifest", destructive: false },
  { step: 10, action: "destroy the disposable project; shred decrypted copies", destructive: true },
];

// ── ACCEPTANCE (executed only with --execute) ────────────────────────────────
function runAcceptance(dsn, manifest) {
  const results = [];
  for (const check of ACCEPTANCE_CHECKS) {
    if (check.dynamic === "orphans") {
      results.push({ id: check.id, title: check.title, status: "PENDING",
        detail: "requires the generated orphan query against a live target" });
      continue;
    }
    let sql = check.sql;
    if (check.binds) for (const [k, v] of Object.entries(check.binds)) sql = sql.replaceAll(`$${k}`, `'${v}'`);
    // `--csv` ALONE. Two flags that used to be here contradicted the parser below, and because the
    // execute path had never been run against a live target, nothing caught it:
    //
    //   -t          suppresses the header row — but the parser reads lines[0] AS the column names,
    //               so every value came back `undefined` and every check reported a phantom failure.
    //   -F "|"      sets the CSV field separator to a pipe — but the parser splits on ",", so the
    //               whole row collapsed into a single column even once the header existed.
    //
    // Measured 2026-08-12 during the first real restore rehearsal: A1–A11 reported
    // "expected 7, got undefined" against a target that had been restored correctly. The data was
    // fine; the reader was not. A verification path that cannot pass is worse than no verification,
    // because it trains the operator to read red as normal.
    const r = spawnSync("psql", [dsn, "-X", "-A", "--csv", "-c", sql], { encoding: "utf8" });
    if (r.status !== 0) {
      results.push({ id: check.id, title: check.title, status: "ERROR", detail: "query failed" });
      continue;
    }
    const lines = (r.stdout || "").trim().split("\n");
    const cols = lines[0]?.split(",") ?? [];
    const vals = lines[1]?.split(",") ?? [];
    const row = Object.fromEntries(cols.map((c, i) => [c.trim(), vals[i]]));
    const problems = check.expect(row, EXPECTED_STRUCTURE, manifest.rowCounts);
    results.push(problems === null
      ? { id: check.id, title: check.title, status: "PASS" }
      : { id: check.id, title: check.title, status: "FAIL", detail: problems.join("; ") });
  }
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const backupDir = findBackup();
  if (!backupDir || !existsSync(backupDir)) {
    console.error("no backup found. Pass --backup=<dir> or create one first.");
    return 2;
  }
  const manifest = parseManifest(backupDir);
  const ctx = preflight(backupDir, manifest);

  const acceptance = EXECUTE
    ? runAcceptance(ctx.targetDsn, manifest)
    : ACCEPTANCE_CHECKS.map((c) => ({ id: c.id, title: c.title, status: "NOT_RUN",
        detail: "dry-run: acceptance requires a disposable target" }));

  // ── report ─────────────────────────────────────────────────────────────────
  const icon = { PASS: "✓", FAIL: "✗", WARN: "!", SKIP: "○", NOT_RUN: "·", PENDING: "·", ERROR: "✗" };
  console.log(`\nRestore rehearsal — ${EXECUTE ? "EXECUTE" : "DRY RUN"}`);
  console.log(`  backup: ${manifest.kv["backup_id"] || "(unknown id)"}`);
  console.log(`  server: ${manifest.kv["server_version"] || "?"}   producer: pg_dump ${manifest.kv["pg_dump_client_version"] || "?"}\n`);
  console.log("  PREFLIGHT GATES");
  for (const g of gates) {
    console.log(`    ${icon[g.status]} ${g.id} ${g.title}`);
    if (g.detail) console.log(`        ${g.detail}`);
  }
  console.log("\n  RESTORE SEQUENCE (executed only with --execute)");
  for (const s of RESTORE_SEQUENCE) {
    console.log(`    ${String(s.step).padStart(2)}. ${s.destructive ? "[writes target]" : "[read-only] "} ${s.action}`);
  }
  console.log("\n  ACCEPTANCE A1–A11");
  for (const a of acceptance) {
    console.log(`    ${icon[a.status]} ${a.id} ${a.title}`);
    if (a.detail && a.status !== "NOT_RUN") console.log(`        ${a.detail}`);
  }

  const failed = gates.filter((g) => g.status === "FAIL").length +
                 acceptance.filter((a) => a.status === "FAIL" || a.status === "ERROR").length;
  const warned = gates.filter((g) => g.status === "WARN").length;
  console.log(`\n  gates: ${gates.filter((g) => g.status === "PASS").length} pass, ` +
              `${failed} fail, ${warned} warn, ${gates.filter((g) => g.status === "SKIP").length} skip`);

  if (!EXECUTE) {
    console.log("\n  DRY RUN — nothing was written anywhere. Actual restore is BLOCKED pending a");
    console.log("  disposable Supabase project (operator decision B-07). Everything that can be");
    console.log("  validated without one has been validated above.\n");
  }
  console.log(failed === 0 ? "✓ REHEARSAL PREFLIGHT PASSED\n" : "✗ REHEARSAL PREFLIGHT FAILED\n");

  // ── evidence manifest ──────────────────────────────────────────────────────
  const evidence = {
    schemaVersion: 1,
    mode: EXECUTE ? "execute" : "dry-run",
    generatedAt: new Date().toISOString(),
    backupId: manifest.kv["backup_id"] || null,
    serverVersion: manifest.kv["server_version"] || null,
    producerClient: manifest.kv["pg_dump_client_version"] || null,
    // No DSN, no key path, no ref — only digests and statuses.
    gates: gates.map(({ id, title, status }) => ({ id, title, status })),
    restoreSequence: RESTORE_SEQUENCE,
    acceptance: acceptance.map(({ id, title, status }) => ({ id, title, status })),
    verdict: failed === 0 ? "PREFLIGHT_PASSED" : "PREFLIGHT_FAILED",
    executionBlocker: EXECUTE ? null : "disposable Supabase project not provisioned (B-07)",
  };
  const out = val("--json-out=");
  if (out) { writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n"); console.log(`  evidence -> ${out}\n`); }
  if (has("--json")) console.log(JSON.stringify(evidence, null, 2));

  return failed === 0 ? 0 : 1;
}

// Run-as-main detection by exact module URL. `endsWith("x.mjs")` is wrong: "test_x.mjs"
// also ends with "x.mjs", so importing this module from its own test suite would execute the CLI.
const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  try { process.exit(main()); }
  catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); }
}
