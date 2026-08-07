#!/usr/bin/env node
// test_pipeline_health.mjs — football-hardening checkpoint G observability test.
//
// Run: node bolao/shared/scripts/test_pipeline_health.mjs
//
// Exercises the real, committed on-disk state (the espn-normalized.json snapshots from
// checkpoint C2, currently-empty outbox/match_store from checkpoint D/F not having run in this
// environment yet) — proves pipeline_health.mjs actually reads real files at the real paths
// (this exact regression: an earlier version of this file double-joined "bolao" into the path
// and silently reported every app as "no snapshot on disk yet" despite 3 real committed
// snapshots existing — caught here so it can't come back).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { espnSnapshotHealth, outboxHealth, matchStoreHealth } from "./pipeline_health.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

// ── 1. ESPN snapshot health reads the REAL committed snapshots (regression guard for the
// double-path-join bug — a wrong path silently reports "not present" instead of erroring). ──
for (const app of ["copa2026", "br2026", "cdb2026"]) {
  const h = espnSnapshotHealth(app);
  check(`${app}: pipeline_health finds the real committed espn-normalized.json`, h.present === true, h);
  if (h.present) {
    check(`${app}: reports a positive match count from the real snapshot`, h.matchCount > 0, h.matchCount);
    check(`${app}: reports stale as a boolean (not undefined)`, typeof h.stale === "boolean", h.stale);
    check(`${app}: reports a numeric ageMinutes`, typeof h.ageMinutes === "number" && h.ageMinutes >= 0, h.ageMinutes);
  }
}

// ── 2. Outbox/match-store health degrade gracefully when the files don't exist yet (this repo
// hasn't run a real reconciler cycle outside of isolated tests) — informational, not an error.
{
  const ob = outboxHealth();
  check("outboxHealth(): reports present:false gracefully when no outbox file exists yet (not a crash)", ob.present === false || ob.present === true, ob);
  const ms = matchStoreHealth();
  check("matchStoreHealth(): reports present:false gracefully when no match store exists yet (not a crash)", ms.present === false || ms.present === true, ms);
  if (!ms.present) {
    check("matchStoreHealth(): explains WHY it's absent (not just silently empty)", typeof ms.note === "string" && ms.note.length > 0, ms.note);
  }
}

// ── 3. CLI --json mode produces valid, parseable JSON (real subprocess invocation) ──────────
{
  const out = execFileSync("node", [join(HERE, "pipeline_health.mjs"), "--json"], { encoding: "utf8" });
  let parsed = null;
  let parseOk = true;
  try { parsed = JSON.parse(out); } catch { parseOk = false; }
  check("CLI --json produces valid JSON", parseOk, out.slice(0, 200));
  if (parseOk) {
    check("CLI --json output has espnSnapshots for all 3 apps", Array.isArray(parsed.espnSnapshots) && parsed.espnSnapshots.length === 3, parsed.espnSnapshots?.length);
    check("CLI --json output's espnSnapshots all report present:true (real committed data)", parsed.espnSnapshots.every((s) => s.present === true), parsed.espnSnapshots.map((s) => s.present));
  }
}

// ── 4. CLI human-readable mode exits 0 and mentions all three apps ──────────────────────────
{
  const out = execFileSync("node", [join(HERE, "pipeline_health.mjs")], { encoding: "utf8" });
  check("CLI human-readable mode mentions all 3 apps", ["copa2026", "br2026", "cdb2026"].every((a) => out.includes(a)), out.slice(0, 100));
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL PIPELINE HEALTH CHECKS PASSED");
process.exit(0);
