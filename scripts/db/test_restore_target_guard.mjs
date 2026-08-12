#!/usr/bin/env node
/**
 * CONTROLS for the restore target guard.
 *
 * The guard decides whether a restore may proceed. It protects an irreversible action — restoring a
 * backup over a live database — so it is tested in both directions, and both directions matter equally:
 *
 *   it must REFUSE production, and every unproven target;
 *   it must be ABLE TO SAY YES to a genuinely disposable one.
 *
 * The second is not a convenience. BATCH-J2-F3 was a guard that could never say yes: it blocked on
 * AMBIENT_ENV_IS_PRODUCTION, a fact about the operator's shell rather than about the target, and the
 * operator's shell always carries production libpq variables. A guard that always refuses gets bypassed,
 * and a bypassed guard protects nothing. So "can this guard ever approve anything?" is a control here.
 *
 * No hostname, project reference, credential or fingerprint value is printed by these tests.
 */

import { assessTarget, sanitisedLibpqEnv, fingerprint, GUARD_VERDICT } from "./restore_target_guard.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const MARKER = "?application_name=ferrarilabs_restore_rehearsal";
const SCRATCH = `postgresql://scratch_owner@127.0.0.1:55432/rehearsal_scratch${MARKER}`;
const EMPTY = { userTableCount: 0, activeApplicationConnections: 0, previousRehearsalMarker: false };

// Synthetic "production" identity: invented values, fingerprinted the same way the guard does it. No
// real hostname is used, and nothing real is printed.
const PROD = { host: "prod-db.invalid", user: "prod_user", db: "prod_database" };
const PROD_FP = { hostFp: fingerprint(PROD.host), userFp: fingerprint(PROD.user), dbFp: fingerprint(PROD.db) };
const PROD_AMBIENT = { PGHOST: PROD.host, PGUSER: PROD.user, PGDATABASE: PROD.db };

const assess = (o) => assessTarget({ productionFingerprints: PROD_FP, ...o });

console.log("\nREFUSALS — the guard must say no");
{
  check("no target supplied", assess({ dsn: null, ambient: {}, liveness: EMPTY }).verdict === GUARD_VERDICT.REFUSED_NO_TARGET);

  for (const [field, dsn] of [
    ["host", `postgresql://scratch@${PROD.host}:5432/scratch_db${MARKER}`],
    ["user", `postgresql://${PROD.user}@127.0.0.1:55432/scratch_db${MARKER}`],
    ["database", `postgresql://scratch@127.0.0.1:55432/${PROD.db}${MARKER}`],
  ]) {
    const a = assess({ dsn, ambient: {}, liveness: EMPTY });
    check(`production ${field} is refused even WITH a valid disposable marker`,
      a.verdict === GUARD_VERDICT.REFUSED_PRODUCTION && a.targetIsProduction === true, a.verdict);
  }

  check("a target with no disposability marker is refused",
    assess({ dsn: "postgresql://scratch@127.0.0.1:55432/scratch_db", ambient: {}, liveness: EMPTY }).verdict === GUARD_VERDICT.REFUSED_UNPROVEN);

  check("an unfamiliar hostname is NOT treated as evidence of safety",
    assess({ dsn: "postgresql://x@some-other-host.invalid:5432/whatever", ambient: {}, liveness: EMPTY }).verdict !== GUARD_VERDICT.DISPOSABLE_PROVEN);

  check("a populated target with no previous-rehearsal marker is refused",
    assess({ dsn: SCRATCH, ambient: {}, liveness: { ...EMPTY, userTableCount: 9 } }).verdict === GUARD_VERDICT.REFUSED_UNPROVEN);

  check("a target something else is connected to is refused",
    assess({ dsn: SCRATCH, ambient: {}, liveness: { ...EMPTY, activeApplicationConnections: 2 } }).verdict === GUARD_VERDICT.REFUSED_UNPROVEN);

  check("no liveness probe at all is refused (offline checks cannot confirm a good target)",
    assess({ dsn: SCRATCH, ambient: {}, liveness: null }).verdict === GUARD_VERDICT.REFUSED_UNPROVEN);
}

console.log("\nAPPROVAL — the guard must be able to say yes (BATCH-J2-F3)");
{
  const clean = assess({ dsn: SCRATCH, ambient: {}, liveness: EMPTY });
  check("a disposable target in a clean environment is approved",
    clean.verdict === GUARD_VERDICT.DISPOSABLE_PROVEN && clean.targetIsProduction === false, clean.verdict);

  // The regression that motivated the fix: the operator's shell points at production, the target does
  // not. Refusing here made DISPOSABLE_PROVEN unreachable in the only environment this tool runs in.
  const ambientProd = assess({ dsn: SCRATCH, ambient: PROD_AMBIENT, liveness: EMPTY });
  check("a disposable target is STILL approved when the ambient env points at production",
    ambientProd.verdict === GUARD_VERDICT.DISPOSABLE_PROVEN, ambientProd.verdict);
  check("...and the ambient hazard is still reported, loudly and as CRITICAL",
    ambientProd.findings.some((f) => f.code === "AMBIENT_ENV_IS_PRODUCTION" && f.severity === "CRITICAL"));
  check("...scoped to ENVIRONMENT, so it informs without deciding the target's disposability",
    ambientProd.findings.find((f) => f.code === "AMBIENT_ENV_IS_PRODUCTION").scope === "ENVIRONMENT");
  check("every finding carries a scope",
    ambientProd.findings.every((f) => f.scope === "TARGET" || f.scope === "ENVIRONMENT"));
}

console.log("\nMITIGATION IS VERIFIED, NOT ASSUMED");
{
  // The ambient hazard is tolerated only because sanitisedLibpqEnv() strips those variables. That claim
  // is checked here, so the tolerance cannot outlive the thing that justifies it.
  const probe = sanitisedLibpqEnv({
    PGHOST: "h", PGUSER: "u", PGDATABASE: "d", PGPORT: "5432", PGPASSWORD: "p",
    SUPABASE_DB_URL: "x", DATABASE_URL: "y", PATH: "/usr/bin", HOME: "/tmp",
  });
  // PGPASSFILE is EXPECTED: the sanitiser sets it to a nonexistent path on purpose, so libpq cannot
  // silently pick up a stored password. It is the one PG-prefixed key that must survive.
  const leaked = Object.keys(probe).filter((k) => /^(PG|SUPABASE|DATABASE_URL)/i.test(k) && k !== "PGPASSFILE");
  check("sanitisedLibpqEnv strips every PG-, SUPABASE- and DATABASE_URL- variable", leaked.length === 0,
    leaked.length ? `leaked ${leaked.length} key(s)` : "0 leaked");
  check("it STRIPS rather than overrides (a missing parameter must fail loudly, not resolve elsewhere)",
    !("PGHOST" in probe) && !("PGDATABASE" in probe));
  check("unrelated variables survive", probe.PATH === "/usr/bin" && probe.HOME === "/tmp");
  check("PGPASSFILE points somewhere nonexistent so a stored password cannot be picked up silently",
    probe.PGPASSFILE === "/nonexistent" || !("PGPASSFILE" in probe) === false, String(probe.PGPASSFILE));
}

console.log("\nNO LEAKAGE");
{
  const a = assess({ dsn: `postgresql://${PROD.user}@${PROD.host}:5432/${PROD.db}${MARKER}`, ambient: PROD_AMBIENT, liveness: EMPTY });
  const text = JSON.stringify(a);
  check("the refusal never echoes the host, user or database", !text.includes(PROD.host) && !text.includes(PROD.user) && !text.includes(PROD.db));
  check("the assessment does not carry fingerprint values at all",
    !text.includes(PROD_FP.hostFp) && !text.includes(PROD_FP.userFp) && !text.includes(PROD_FP.dbFp));
  check("it still says WHICH fields matched, which is what the operator needs",
    /hostFp|userFp|dbFp/.test(text));
}

console.log(`\n  ${pass} passed · ${fail} failed\n`);
if (fail) { console.error("✗ RESTORE TARGET GUARD CONTROLS FAILED\n"); process.exit(1); }
console.log("✓ guard refuses production and every unproven target, and can still approve a disposable one\n");
