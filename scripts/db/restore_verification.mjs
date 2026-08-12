#!/usr/bin/env node
/**
 * Restore verification runner (Workstream P).
 *
 * WHAT THIS ADDS TO THE EXISTING PIECES
 * `acceptance_checks.mjs` already holds A1–A11 as data and the expected structure. `restore_rehearsal.mjs`
 * already holds the ten preflight gates and the restore sequence. What was missing is the layer that turns
 * the RESULT of a restore into a verdict a machine can act on:
 *
 *   · machine-readable output with a stable shape
 *   · a failure TAXONOMY, so "the restore failed" becomes a class with a known recovery
 *   · manifest reconciliation — the archive's own digest list against what actually landed
 *   · unexpected-object detection, which matters more than missing-object detection and is usually omitted
 *   · row-count validation with an explicit tolerance model
 *   · constraint, RLS and policy-hash validation
 *   · integration isolation checks: proof the restore target is not wired to anything real
 *   · production-reference detection: a hard refusal if any input names production
 *
 * NOTHING HERE CONNECTS TO A DATABASE. It consumes an OBSERVATION document — a plain JSON description of
 * what a restore produced — exactly like the schema snapshots in the migration harness. That is what makes
 * a dry-run test meaningful: the runner can be proven correct without a restore having happened.
 *
 * Usage:
 *   node scripts/db/restore_verification.mjs --self-test
 *   node scripts/db/restore_verification.mjs --observation obs.json [--json]
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { EXPECTED_STRUCTURE, EXPECTED_POLICY_MD5, APP_TABLES, ACCEPTANCE_CHECKS } from "./acceptance_checks.mjs";
import { diffSnapshots, classifyDiff } from "./migration_harness.mjs";
import { PRODUCTION_REF_SHA256 } from "./restore_rehearsal.mjs";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Failure taxonomy. Each class names a recovery, because a verdict without a recovery is just bad news.
 * The ordering matters: the first matching class wins, most fundamental first — there is no point
 * reporting a row-count mismatch when the archive would not decrypt.
 */
export const FAILURE_CLASSES = [
  { id: "F1_UNREADABLE_ARCHIVE", meaning: "the archive cannot be read at all", recovery: "fall back to the previous archive; treat the current one as lost and re-take a backup" },
  { id: "F2_DECRYPT_FAILED", meaning: "the archive will not decrypt", recovery: "verify key custody — the key is held outside the repo; a wrong key and a corrupt archive look identical here, so try the previous archive with the same key to separate them" },
  { id: "F3_INTEGRITY_MISMATCH", meaning: "the archive decrypts but its digest does not match the manifest", recovery: "the archive is corrupt in transit or at rest; discard and re-take. Do NOT restore from it" },
  { id: "F4_TOOLCHAIN_INCOMPATIBLE", meaning: "pg_restore cannot read the archive version", recovery: "use a pg_restore at least as new as the pg_dump that produced the archive; if none is available, re-dump from a running source with the client you do have" },
  { id: "F5_RESTORE_ERRORED", meaning: "the restore ran but reported errors", recovery: "read the error list; a restore with errors has produced an unknown state and must not be accepted" },
  { id: "F6_MISSING_OBJECT", meaning: "an expected object did not arrive", recovery: "the archive is incomplete for its stated scope; check the dump's --schema/--table flags" },
  { id: "F7_UNEXPECTED_OBJECT", meaning: "an object arrived that was not expected", recovery: "the archive is not what it claims to be, OR the restore target was not empty. Both are disqualifying" },
  { id: "F8_ROW_COUNT_MISMATCH", meaning: "row counts differ beyond tolerance", recovery: "compare against the source snapshot taken at dump time, not against today's production" },
  { id: "F9_CONSTRAINT_MISSING", meaning: "a PK, FK, UNIQUE or CHECK did not arrive", recovery: "restored data is unprotected; do not use this target as a source of truth for anything" },
  { id: "F10_RLS_MISSING", meaning: "RLS is not enabled on a table that had it", recovery: "the restored copy is more permissive than the original — treat as a security finding, not a restore defect" },
  { id: "F11_POLICY_DRIFT", meaning: "a policy body hash differs from the expected generation", recovery: "identify which generation the archive predates; a policy change between dump and expectation is normal drift and must be re-baselined deliberately" },
  { id: "F12_ISOLATION_BREACH", meaning: "the restore target is connected to something real", recovery: "STOP. Tear down the target. A rehearsal wired to production data or a live integration is not a rehearsal" },
  { id: "F13_PRODUCTION_REFERENCE", meaning: "an input names the production project", recovery: "STOP immediately and re-derive the target reference; nothing about this run is trustworthy" },
];

export const FAILURE_BY_ID = Object.fromEntries(FAILURE_CLASSES.map((f) => [f.id, f]));

/**
 * Decide whether the restore toolchain can read the archive.
 *
 * Precedence, and the order is the point:
 *   1. `toolchainReadable` — a MEASUREMENT (pg_restore listed the TOC). It decides outright, in both
 *      directions, because it answers the actual question rather than predicting the answer.
 *   2. version ordering — used only when nothing was measured. A client at least as new as the dump
 *      that wrote the archive is compatible by PostgreSQL's own guarantee. An OLDER client may still
 *      work (it usually does across one major version) but nothing here has established that, so it is
 *      reported as UNPROVEN — which fails, because an unproven recovery path is not a recovery path.
 *
 * Returns `{ ok: true|false|null, detail }`. `ok: null` means nothing was supplied to judge.
 */
export function toolchainVerdict(archive = {}) {
  const a = archive || {};
  const am = a.archiveMajor == null ? null : Number(String(a.archiveMajor).split(".")[0]);
  const rm = a.restoreMajor == null ? null : Number(String(a.restoreMajor).split(".")[0]);
  const versions = am && rm ? `archive from pg_dump ${am}.x, restore client ${rm}.x` : "client versions not supplied";

  if (a.toolchainReadable === true) return { ok: true, detail: `toolchain compatible — MEASURED: pg_restore read the archive TOC (${versions})` };
  if (a.toolchainReadable === false) return { ok: false, detail: `pg_restore could not read the archive TOC (${versions})` };
  if (am == null || rm == null) return { ok: null, detail: "toolchain compatibility not evaluated — neither a readability measurement nor client versions were supplied" };
  if (rm >= am) return { ok: true, detail: `toolchain compatible by version ordering, unmeasured (${versions})` };
  return { ok: false, detail: `UNPROVEN: restore client is older than the client that produced the archive and readability was never measured (${versions})` };
}

/**
 * The production project digest is IMPORTED from restore_rehearsal.mjs, never re-declared here.
 *
 * A second copy would be a second thing to keep correct, and this programme has already been bitten by
 * exactly that: an invented placeholder digest meant gate G3 could never fire. One authoritative digest,
 * imported — a duplicate is a guard that silently stops guarding the day the two drift.
 */
export { PRODUCTION_REF_SHA256 } from "./restore_rehearsal.mjs";

/** Row-count tolerance: exact by default, because "about right" is not a restore criterion. */
export const DEFAULT_TOLERANCE = { mode: "EXACT", allowedDelta: 0 };

const fail = (cls, detail) => ({ status: "FAIL", failureClass: cls, detail, recovery: FAILURE_BY_ID[cls].recovery });
const ok = (detail) => ({ status: "PASS", detail });
const skip = (detail) => ({ status: "SKIP", detail });

/**
 * An OBSERVATION is what a restore produced. Every field is optional; a missing field yields SKIP with a
 * reason, never a silent PASS. That distinction is the whole reliability of this runner: an unobserved
 * check must never be countable as a satisfied one.
 */
export function verifyRestore(observation, { expected = EXPECTED_STRUCTURE, tolerance = DEFAULT_TOLERANCE } = {}) {
  const o = observation || {};
  const checks = [];
  const add = (id, title, result) => checks.push({ id, title, ...result });

  // ── P0: production-reference detection runs FIRST and short-circuits ────────
  const refs = [o.targetRef, o.sourceRef, o.connectionLabel, ...(o.inputRefs || [])].filter(Boolean);
  const offending = refs.filter((r) => sha256(String(r).trim()) === PRODUCTION_REF_SHA256);
  if (offending.length) {
    add("P0", "no input names the production project", fail("F13_PRODUCTION_REFERENCE",
      `${offending.length} input reference(s) hash to the production digest`));
    return finish(checks, { shortCircuited: true });
  }
  add("P0", "no input names the production project", ok(`${refs.length} reference(s) checked against the production digest`));

  // ── P1: isolation ──────────────────────────────────────────────────────────
  if (o.isolation === undefined) add("P1", "restore target is isolated", skip("no isolation evidence supplied"));
  else {
    const i = o.isolation || {};
    const breaches = [];
    if (i.hasProductionSecrets) breaches.push("production secrets are reachable from the target");
    if (i.emailSendingEnabled) breaches.push("email sending is enabled — a rehearsal must not be able to email real participants");
    if (i.webhooksEnabled) breaches.push("outbound webhooks are enabled");
    if (i.scheduledJobsEnabled) breaches.push("scheduled jobs are enabled and would act on restored data");
    if (i.reachableFromInternet) breaches.push("the target is publicly reachable");
    add("P1", "restore target is isolated", breaches.length ? fail("F12_ISOLATION_BREACH", breaches.join("; ")) : ok("no integration reachable"));
  }

  // ── P2: archive readability, decryptability, integrity, toolchain ───────────
  const a = o.archive || {};
  if (o.archive === undefined) add("P2", "archive readable and verified", skip("no archive evidence supplied"));
  else if (a.readable === false) add("P2", "archive readable and verified", fail("F1_UNREADABLE_ARCHIVE", a.detail || "unreadable"));
  else if (a.decrypted === false) add("P2", "archive readable and verified", fail("F2_DECRYPT_FAILED", a.detail || "decryption failed"));
  else if (a.expectedDigest && a.actualDigest && a.expectedDigest !== a.actualDigest) {
    add("P2", "archive readable and verified", fail("F3_INTEGRITY_MISMATCH", "digest does not match the manifest"));
  } else {
    // Toolchain compatibility is an ORDERING question, not an equality one, and it is answerable by
    // MEASUREMENT rather than inference.
    //
    // KPLUS-F001/F002. This was `archiveMajor !== restoreMajor`. That rule is wrong in both
    // directions: it condemns a combination that works (the 20260808T005117Z archive was produced by
    // pg_dump 18.4 and restores completely under pg_restore 17.10 — measured, A1–A11 all PASS), and it
    // would clear a genuinely unreadable archive that happened to share a major version. Worse, no live
    // runner ever supplied archiveMajor/restoreMajor, so the check only ever ran in its own fixtures and
    // reported "toolchain compatible" in every real evaluation without comparing anything.
    //
    // `toolchainReadable` is that missing measurement: whether pg_restore actually listed the archive's
    // table of contents. When it is present it decides, because reading the archive is the whole
    // question. The version ordering is used only as a CONSERVATIVE fallback when nobody measured — and
    // an older client against a newer archive is then reported as unproven rather than assumed fine.
    const t = toolchainVerdict(a);
    if (t.ok === false) add("P2", "archive readable and verified", fail("F4_TOOLCHAIN_INCOMPATIBLE", t.detail));
    // `null` means nothing was measured and no versions were given. Per this file's own rule an
    // unobserved check is a SKIP, never a silent PASS — which is precisely the state the old code
    // reported as "toolchain compatible".
    else if (t.ok === null) add("P2", "archive readable and verified", skip(t.detail));
    else add("P2", "archive readable and verified", ok(`readable, decrypted, digest matches, ${t.detail}`));
  }

  // ── P3: manifest reconciliation ────────────────────────────────────────────
  if (!o.manifest) add("P3", "manifest reconciles with what landed", skip("no manifest supplied"));
  else {
    const declared = new Set(Object.keys(o.manifest.files || {}));
    const landed = new Set(Object.keys(o.manifest.landed || {}));
    const missing = [...declared].filter((f) => !landed.has(f));
    const extra = [...landed].filter((f) => !declared.has(f));
    const mismatched = [...declared].filter((f) => landed.has(f) && o.manifest.files[f] !== o.manifest.landed[f]);
    if (missing.length) add("P3", "manifest reconciles with what landed", fail("F6_MISSING_OBJECT", `${missing.length} manifest entr(ies) did not land`));
    else if (extra.length) add("P3", "manifest reconciles with what landed", fail("F7_UNEXPECTED_OBJECT", `${extra.length} file(s) landed that the manifest does not declare`));
    else if (mismatched.length) add("P3", "manifest reconciles with what landed", fail("F3_INTEGRITY_MISMATCH", `${mismatched.length} digest mismatch(es)`));
    else add("P3", "manifest reconciles with what landed", ok(`${declared.size} entr(ies) reconciled`));
  }

  // ── P4: restore ran without errors ─────────────────────────────────────────
  if (o.restoreErrors === undefined) add("P4", "restore completed without errors", skip("no restore log supplied"));
  else if ((o.restoreErrors || []).length) {
    add("P4", "restore completed without errors", fail("F5_RESTORE_ERRORED",
      `${o.restoreErrors.length} error(s); a restore with errors has produced an unknown state`));
  } else add("P4", "restore completed without errors", ok("no errors reported"));

  // ── P5/P6: missing and unexpected objects ──────────────────────────────────
  if (!o.objects) {
    add("P5", "all expected objects present", skip("no object inventory supplied"));
    add("P6", "no unexpected objects present", skip("no object inventory supplied"));
  } else {
    const seenTables = new Set(o.objects.tables || []);
    const wantTables = new Set(APP_TABLES);
    const missingT = [...wantTables].filter((t) => !seenTables.has(t));
    const extraT = [...seenTables].filter((t) => !wantTables.has(t));
    add("P5", "all expected objects present", missingT.length
      ? fail("F6_MISSING_OBJECT", `${missingT.length} expected table(s) absent: ${missingT.join(", ")}`)
      : ok(`${wantTables.size} expected table(s) present`));
    // Unexpected objects matter MORE than missing ones and are usually omitted from restore checks:
    // an extra table means either the archive is not what it claims, or the target was not empty.
    add("P6", "no unexpected objects present", extraT.length
      ? fail("F7_UNEXPECTED_OBJECT", `${extraT.length} unexpected table(s): ${extraT.join(", ")}`)
      : ok("no unexpected tables"));
  }

  // ── P7: structural counts against EXPECTED_STRUCTURE ───────────────────────
  if (!o.structure) add("P7", "structural counts match expectations", skip("no structure counts supplied"));
  else {
    const diffs = [];
    for (const [k, want] of Object.entries(expected)) {
      if (typeof want !== "number") continue;
      const got = o.structure[k];
      if (got === undefined) { diffs.push(`${k}: not observed`); continue; }
      if (got !== want) diffs.push(`${k}: expected ${want}, got ${got}`);
    }
    /**
     * Constraint dimensions are LISTED, not pattern-matched on key names.
     * A regex here would miss `primaryKeys` and `foreignKeys` (neither contains "pk" or "fk"), so the
     * most important restore failure of all — data arrived with no constraints protecting it — would be
     * misclassified as a missing object. Same lesson as the money-measure classification.
     */
    const constraintDims = ["primaryKeys", "foreignKeys", "uniqueConstraints", "uniqueIndexesNotConstraints", "checks"];
    const constraintDiffs = diffs.filter((d) => constraintDims.some((k) => d.startsWith(`${k}:`)));
    add("P7", "structural counts match expectations", diffs.length
      ? fail(constraintDiffs.length ? "F9_CONSTRAINT_MISSING" : "F6_MISSING_OBJECT", diffs.join("; "))
      : ok("all counted dimensions match"));
  }

  // ── P8: row counts ─────────────────────────────────────────────────────────
  if (!o.rowCounts) add("P8", "row counts match the source snapshot", skip("no row counts supplied"));
  else if (!o.sourceRowCounts) add("P8", "row counts match the source snapshot", skip("no source row counts to compare against — a restored count with nothing to compare it to proves nothing"));
  else {
    const diffs = [];
    for (const t of new Set([...Object.keys(o.sourceRowCounts), ...Object.keys(o.rowCounts)])) {
      const want = o.sourceRowCounts[t], got = o.rowCounts[t];
      if (want === undefined) { diffs.push(`${t}: present in restore, absent from source`); continue; }
      if (got === undefined) { diffs.push(`${t}: absent from restore`); continue; }
      const delta = Math.abs(got - want);
      if (tolerance.mode === "EXACT" ? delta !== 0 : delta > (tolerance.allowedDelta || 0)) {
        diffs.push(`${t}: expected ${want}, got ${got}`);
      }
    }
    add("P8", "row counts match the source snapshot", diffs.length
      ? fail("F8_ROW_COUNT_MISMATCH", diffs.join("; "))
      : ok(`${Object.keys(o.sourceRowCounts).length} table(s) match exactly`));
  }

  // ── P9: RLS ────────────────────────────────────────────────────────────────
  if (!o.rls) add("P9", "RLS enabled where the original had it", skip("no RLS observation supplied"));
  else {
    const missing = APP_TABLES.filter((t) => !(o.rls[t] && o.rls[t].enabled));
    add("P9", "RLS enabled where the original had it", missing.length
      ? fail("F10_RLS_MISSING", `RLS not enabled on: ${missing.join(", ")} — the restored copy is MORE permissive than the original`)
      : ok(`RLS enabled on all ${APP_TABLES.length} app tables`));
  }

  // ── P10: policy hashes ─────────────────────────────────────────────────────
  if (!o.policyHashes) add("P10", "policy bodies match a known generation", skip("no policy hashes supplied"));
  else {
    const known = new Set(Object.values(EXPECTED_POLICY_MD5));
    const unknown = Object.entries(o.policyHashes).filter(([, h]) => !known.has(h)).map(([n]) => n);
    add("P10", "policy bodies match a known generation", unknown.length
      ? fail("F11_POLICY_DRIFT", `${unknown.length} policy body hash(es) match no known generation`)
      : ok(`${Object.keys(o.policyHashes).length} policy hash(es) match a known generation`));
    // Hashes only — the expression is never printed, so drift is provable without disclosure.
  }

  // ── P11: schema diff against a reference snapshot, if supplied ─────────────
  if (!o.snapshotBefore || !o.snapshotAfter) add("P11", "schema matches the reference snapshot", skip("no snapshot pair supplied"));
  else {
    const d = diffSnapshots(o.snapshotBefore, o.snapshotAfter);
    const sev = classifyDiff(d);
    add("P11", "schema matches the reference snapshot", sev.verdict === "NO_CHANGE"
      ? ok("snapshot identical")
      : fail(sev.critical.length ? "F9_CONSTRAINT_MISSING" : "F6_MISSING_OBJECT", `${sev.verdict}: ${[...sev.critical, ...sev.major, ...sev.minor].join("; ")}`));
  }

  return finish(checks, { shortCircuited: false });
}

function finish(checks, { shortCircuited }) {
  const failed = checks.filter((c) => c.status === "FAIL");
  const skipped = checks.filter((c) => c.status === "SKIP");
  return {
    checks,
    counts: { pass: checks.filter((c) => c.status === "PASS").length, fail: failed.length, skip: skipped.length },
    failureClasses: [...new Set(failed.map((c) => c.failureClass))],
    shortCircuited,
    /**
     * INCOMPLETE is a distinct verdict from PASS.
     * A run with unobserved checks has not been proven good; calling it PASS would let a rehearsal that
     * measured almost nothing report success, which is the failure mode this whole workstream exists to
     * prevent.
     */
    verdict: failed.length ? "FAIL" : skipped.length ? "INCOMPLETE" : "PASS",
  };
}

/** The A1–A11 acceptance checks remain the authority on structure; this maps them to their P coverage. */
export function acceptanceCoverage() {
  return ACCEPTANCE_CHECKS.map((c) => ({
    id: c.id,
    title: c.title || c.name || "",
    automatedBy: {
      A1: "P5/P7", A2: "P7", A3: "P7", A4: "P7", A5: "P7", A6: "P7",
      A7: "P7", A8: "P10", A9: "P9", A10: "P7", A11: "P8",
    }[c.id] || "MANUAL",
  }));
}

const IS_MAIN = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_MAIN) {
  const argv = process.argv.slice(2);
  const f = argv.find((x) => x.startsWith("--observation="));
  const obs = f ? JSON.parse(readFileSync(f.slice("--observation=".length), "utf8")) : {};
  const r = verifyRestore(obs);
  if (argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(r.verdict === "PASS" ? 0 : 1); }
  console.log("\nRestore verification\n");
  for (const c of r.checks) {
    const icon = c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·";
    console.log(`  ${icon} ${c.id.padEnd(4)} ${c.title}`);
    console.log(`        ${c.detail}`);
    if (c.recovery) console.log(`        recovery: ${c.recovery}`);
  }
  console.log(`\n  ${r.counts.pass} pass, ${r.counts.fail} fail, ${r.counts.skip} skip`);
  console.log(`  verdict: ${r.verdict}${r.shortCircuited ? " (short-circuited)" : ""}\n`);
  if (!f) console.log("  (no --observation supplied: every check is SKIP, so the verdict is INCOMPLETE, not PASS)\n");
  process.exit(r.verdict === "PASS" ? 0 : 1);
}
