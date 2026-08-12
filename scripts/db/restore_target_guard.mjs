#!/usr/bin/env node
/**
 * RESTORE TARGET GUARD — Batch J.
 *
 * One job: make it impossible to run a restore against production by accident.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, CONCRETELY
 *
 * In this very session, `pg_isready` with no arguments connected to the production pooler. The shell
 * carries PGHOST, PGPORT, PGDATABASE and PGUSER, and they were verified — by salted fingerprint, so no
 * hostname was printed — to match the recorded production identity on ALL THREE identity fields.
 *
 * So any bare `psql`, `pg_dump` or `pg_restore` in this environment targets production. A restore
 * rehearsal that forgot one flag would not have failed safely; it would have restored a backup over the
 * live database. That is the failure this file exists to make unreachable.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE STANCE: DENY BY DEFAULT, AND NEVER INFER SAFETY
 *
 * A different hostname is NOT evidence of safety — the brief says so explicitly, and it is right: a
 * typo'd host, a second production project, or a stale copy of the same project all present as
 * "different". So a target is disposable only when it PROVES it, positively, and every one of these
 * must hold:
 *
 *   1. an explicit DSN was supplied (ambient PG* is never consulted, and its presence is a finding)
 *   2. the DSN's identity is not the recorded production identity (compared by salted fingerprint)
 *   3. the DSN carries an explicit disposability marker the operator had to put there on purpose
 *   4. the database name is not a known production database name
 *   5. the target answers a liveness probe as EMPTY or as a previous rehearsal target
 *
 * Rules 1-4 are checkable with no connection at all, which is why they run first: a guard that has to
 * connect in order to decide whether connecting is safe has already lost.
 *
 * No secret, hostname, project reference or password is ever printed or returned. Identity comparison
 * is by salted one-way fingerprint, and the production fingerprints live OUTSIDE this repository (see
 * PRODUCTION_FINGERPRINT_FILE): committing them would put a reversible-by-enumeration hint to the
 * production host into Git for no benefit, since the guard reads them at runtime just as easily.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** Salt is fixed and public: these fingerprints exist to REFUSE a match, not to hide a value. */
const SALT = "ferrarilabs-target-guard:";
export const fingerprint = (s) => createHash("sha256").update(SALT + String(s ?? "")).digest("hex").slice(0, 16);

/**
 * Production identity fingerprints, kept outside Git.
 *
 * A Supabase pooler user is `postgres.<20-char project ref>`, so a fingerprint of it is not reversible.
 * The HOST, though, follows the low-entropy pattern `aws-N-<region>.pooler.supabase.com` and could be
 * enumerated from a published hash. Keeping the file private costs nothing and removes that question
 * entirely.
 */
export const PRODUCTION_FINGERPRINT_FILE =
  join(homedir(), "Documents", "GitHub", "ferrarilabs-work", "db-modernization", "production-identity.fingerprints.json");

export const GUARD_VERDICT = {
  DISPOSABLE_PROVEN: "DISPOSABLE_PROVEN",
  REFUSED_PRODUCTION: "REFUSED_PRODUCTION",
  REFUSED_UNPROVEN: "REFUSED_UNPROVEN",
  REFUSED_NO_TARGET: "REFUSED_NO_TARGET",
};

/** Database names that are production by convention on this platform. */
const PRODUCTION_DB_NAMES = new Set(["postgres"]);

/**
 * A target must carry a marker the operator typed deliberately. Not a heuristic on the hostname: the
 * point is that a human asserted "this is throwaway", so an accident cannot satisfy it.
 */
const DISPOSABLE_MARKERS = [/[?&]application_name=ferrarilabs_restore_rehearsal(?:&|$)/];

export function loadProductionFingerprints(path = PRODUCTION_FINGERPRINT_FILE) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/**
 * Parse a DSN into identity parts WITHOUT retaining the password.
 * Returns fingerprints and structural facts only — never the values themselves.
 */
export function inspectDsn(dsn) {
  if (typeof dsn !== "string" || !dsn.trim()) return null;
  let u;
  try { u = new URL(dsn); } catch { return { parseError: true }; }
  const database = (u.pathname || "").replace(/^\//, "");
  return {
    hostFp: fingerprint(u.hostname),
    userFp: fingerprint(decodeURIComponent(u.username || "")),
    dbFp: fingerprint(database),
    // Structural facts, safe to report: they describe a SHAPE, not an identity.
    isSupabaseHost: /\.supabase\.(com|co)$/i.test(u.hostname),
    isPooler: /pooler\./i.test(u.hostname),
    databaseIsProductionName: PRODUCTION_DB_NAMES.has(database),
    hasDisposableMarker: DISPOSABLE_MARKERS.some((re) => re.test(dsn)),
    hasPassword: !!u.password,
    port: u.port || null,
  };
}

/**
 * Decide whether a restore may proceed.
 *
 * `ambient` is passed in rather than read from process.env so the decision is testable and so a caller
 * cannot accidentally have it consulted as a fallback. The ambient values are used ONLY to detect the
 * hazard — never to build a target.
 */
export function assessTarget({ dsn = null, ambient = {}, productionFingerprints = loadProductionFingerprints(),
  liveness = null } = {}) {
  const findings = [];
  // `scope` separates a finding about the TARGET from a finding about the ENVIRONMENT this process runs
  // in. Only a TARGET finding can refuse a target: see the verdict logic at the end for why conflating
  // the two made DISPOSABLE_PROVEN unreachable (BATCH-J2-F3).
  const add = (severity, code, detail, scope = "TARGET") => findings.push({ severity, code, detail, scope });

  const ambientIdentity = {
    hostFp: ambient.PGHOST ? fingerprint(ambient.PGHOST) : null,
    userFp: ambient.PGUSER ? fingerprint(ambient.PGUSER) : null,
    dbFp: ambient.PGDATABASE ? fingerprint(ambient.PGDATABASE) : null,
  };
  const ambientSet = Object.values(ambientIdentity).some(Boolean);
  if (ambientSet) {
    add("WARNING", "AMBIENT_PG_ENV_PRESENT",
      "PG* variables are set in this environment. They are never used to build a target, but a tool invoked without an explicit DSN would silently use them.");
  }
  if (productionFingerprints && ambientSet) {
    const matches = ["hostFp", "userFp", "dbFp"].filter((k) => ambientIdentity[k] && ambientIdentity[k] === productionFingerprints[k]);
    if (matches.length) {
      add("CRITICAL", "AMBIENT_ENV_IS_PRODUCTION",
        `the ambient environment matches the recorded production identity on ${matches.join(", ")}. Every libpq call in this batch must pass an explicit target, and every one must be checked by this guard.`,
        "ENVIRONMENT");
    }
  }

  if (!dsn) {
    add("CRITICAL", "NO_EXPLICIT_TARGET",
      "no target DSN was supplied. A restore must never fall back to the ambient environment, so the absence of a target is a refusal, not a default.");
    return { verdict: GUARD_VERDICT.REFUSED_NO_TARGET, targetIsProduction: null, findings, target: null };
  }

  const t = inspectDsn(dsn);
  if (!t || t.parseError) {
    add("CRITICAL", "UNPARSABLE_TARGET", "the supplied DSN could not be parsed, so its identity cannot be established");
    return { verdict: GUARD_VERDICT.REFUSED_UNPROVEN, targetIsProduction: null, findings, target: null };
  }

  // ── Rule 2: is this production? Compared by fingerprint, never by value.
  let identityKnown = false;
  if (!productionFingerprints) {
    add("CRITICAL", "PRODUCTION_FINGERPRINTS_UNAVAILABLE",
      `the recorded production identity was not found at ${PRODUCTION_FINGERPRINT_FILE.replace(homedir(), "~")}. Without it the guard cannot prove a target is NOT production, and an unprovable target is refused.`);
  } else {
    identityKnown = true;
    const matches = ["hostFp", "userFp", "dbFp"].filter((k) => t[k] === productionFingerprints[k]);
    if (matches.length >= 2) {
      add("CRITICAL", "TARGET_IS_PRODUCTION",
        `the target matches the recorded production identity on ${matches.join(", ")}. Refused.`);
      return { verdict: GUARD_VERDICT.REFUSED_PRODUCTION, targetIsProduction: true, findings, target: safeTarget(t) };
    }
    if (matches.length === 1) {
      // One field matching is not proof of production, and it is certainly not proof of safety. A
      // rehearsal target sharing production's host is the likeliest real mistake: same project,
      // different database name.
      add("CRITICAL", "TARGET_SHARES_PRODUCTION_IDENTITY",
        `the target matches production on ${matches[0]}. A partial match is refused rather than reasoned about: the most likely cause is the production project with a different database name.`);
      return { verdict: GUARD_VERDICT.REFUSED_PRODUCTION, targetIsProduction: true, findings, target: safeTarget(t) };
    }
  }

  // ── Rules 3 and 4: positive proof of disposability.
  if (!t.hasDisposableMarker) {
    add("CRITICAL", "NO_DISPOSABILITY_MARKER",
      "the DSN carries no application_name=ferrarilabs_restore_rehearsal marker. A different hostname is not evidence of safety, so the operator must assert disposability deliberately.");
  }
  if (t.databaseIsProductionName) {
    add("CRITICAL", "PRODUCTION_DATABASE_NAME",
      "the target database is named `postgres`, which is the production convention on this platform. A rehearsal target must use its own database name so a mistake is visible in the DSN itself.");
  }

  // ── Rule 5: liveness, when the caller has probed it. Not required to REFUSE, but required to ALLOW.
  if (liveness) {
    if (liveness.userTableCount > 0 && !liveness.previousRehearsalMarker) {
      add("CRITICAL", "TARGET_NOT_EMPTY",
        `the target already holds ${liveness.userTableCount} user table(s) and carries no previous-rehearsal marker. Restoring into an unknown populated database is indistinguishable from restoring over something that matters.`);
    }
    if (liveness.activeApplicationConnections > 0) {
      add("CRITICAL", "TARGET_HAS_APPLICATION_TRAFFIC",
        `${liveness.activeApplicationConnections} non-rehearsal connection(s) are active. A database something is talking to is not disposable.`);
    }
  } else {
    // CRITICAL, not a warning (BATCH-J2-F7). The text below always said a restore must not proceed on
    // offline checks alone, but as a WARNING it never enforced that. The contradiction was invisible
    // while AMBIENT_ENV_IS_PRODUCTION happened to block every assessment; scoping that finding to the
    // ENVIRONMENT removed the accidental blocker and exposed this one.
    add("CRITICAL", "LIVENESS_NOT_PROBED",
      "no liveness probe was supplied. The offline rules can refuse a bad target but cannot confirm a good one is empty, so a restore must not proceed on offline checks alone.");
  }

  // ── Verdict.
  //
  // BATCH-J2-F3, found by the first live rehearsal. This previously blocked on EVERY critical finding,
  // including AMBIENT_ENV_IS_PRODUCTION — a fact about the shell, not about the target. Since the
  // operator's shell always carries production libpq variables, DISPOSABLE_PROVEN was unreachable in the
  // only environment this guard will ever run in: a guard that can never say yes protects nothing,
  // because the operator's next move is to bypass it.
  //
  // A target's disposability is decided by TARGET-scoped findings alone. The ambient hazard is real, but
  // it is mitigated structurally — every child process runs under sanitisedLibpqEnv(), which STRIPS
  // those variables — and that mitigation is VERIFIED here rather than assumed. If the sanitiser ever
  // stops stripping them, the ambient finding becomes blocking again.
  const sanitiserWorks = (() => {
    const probe = sanitisedLibpqEnv({ PGHOST: "x", PGUSER: "x", PGDATABASE: "x", PGPORT: "1", SUPABASE_DB_URL: "x", KEEP: "1" });
    return !Object.keys(probe).some((k) => /^(PG(HOST|USER|DATABASE|PORT)|SUPABASE)/i.test(k)) && probe.KEEP === "1";
  })();
  if (!sanitiserWorks) {
    add("CRITICAL", "ENV_SANITISER_INEFFECTIVE",
      "sanitisedLibpqEnv() did not strip PG- and SUPABASE-prefixed variables from a probe environment. The ambient production identity is therefore NOT mitigated, so it blocks.");
  }

  const blocking = findings.filter((f) => f.severity === "CRITICAL" && f.scope === "TARGET");
  if (blocking.length) {
    return { verdict: GUARD_VERDICT.REFUSED_UNPROVEN, targetIsProduction: identityKnown ? false : null, findings, target: safeTarget(t) };
  }
  return { verdict: GUARD_VERDICT.DISPOSABLE_PROVEN, targetIsProduction: false, findings, target: safeTarget(t) };
}

/** Everything about a target that is safe to log: shapes and fingerprints, never values. */
function safeTarget(t) {
  return {
    // Fingerprints are deliberately NOT returned. They are inputs to the comparison, not results, and
    // the salt lives in this source file — so a fingerprint plus a guessed hostname is a confirmation
    // oracle. The findings already name WHICH fields matched, which is what an operator needs.
    isSupabaseHost: t.isSupabaseHost, isPooler: t.isPooler,
    databaseIsProductionName: t.databaseIsProductionName,
    hasDisposableMarker: t.hasDisposableMarker,
    port: t.port,
  };
}

/**
 * The environment a libpq subprocess must be given: every PG- and SUPABASE-prefixed variable REMOVED.
 * (Written without a glob because `PG*` followed by a slash would close this comment block.)
 *
 * Stripping rather than overriding is deliberate. An override still leaves a value libpq will use when
 * the explicit flag is missing; removal makes a missing flag an error instead of a silent fallback to
 * production.
 */
export function sanitisedLibpqEnv(base = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(PG|SUPABASE|DATABASE_URL)/i.test(k)) continue;
    out[k] = v;
  }
  // A password must reach libpq through PGPASSFILE or the DSN, never through a shell variable that
  // every child process inherits.
  out.PGPASSFILE = base.PGPASSFILE_REHEARSAL || "/nonexistent";
  return out;
}

export function report(assessment) {
  const lines = [`verdict: ${assessment.verdict}`, `targetIsProduction: ${assessment.targetIsProduction}`];
  for (const f of assessment.findings) lines.push(`  [${f.severity}] ${f.code} — ${f.detail}`);
  if (assessment.target) {
    lines.push(`  target shape: supabaseHost=${assessment.target.isSupabaseHost} pooler=${assessment.target.isPooler} ` +
      `prodDbName=${assessment.target.databaseIsProductionName} marker=${assessment.target.hasDisposableMarker}`);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dsn = process.argv[2] || null;
  const a = assessTarget({ dsn, ambient: process.env });
  console.log(report(a));
  console.log(a.verdict === GUARD_VERDICT.DISPOSABLE_PROVEN
    ? "\n✓ target proven disposable — a restore may proceed once liveness is probed\n"
    : "\n✗ RESTORE REFUSED\n");
  process.exit(a.verdict === GUARD_VERDICT.DISPOSABLE_PROVEN ? 0 : 1);
}

export default { assessTarget, inspectDsn, fingerprint, sanitisedLibpqEnv, GUARD_VERDICT, report };
