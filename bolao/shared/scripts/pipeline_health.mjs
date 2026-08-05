#!/usr/bin/env node
/**
 * pipeline_health.mjs — observability CLI for the checkpoint C/D/F operational pipeline
 * (football-hardening checkpoint G).
 *
 * Not a dashboard — a single command Eduardo (or CI) can run to see whether the ESPN-snapshot /
 * match-state / notification pipeline built across checkpoints C, D, and F is actually healthy,
 * instead of it being a black box. Reads real on-disk state only (no network, no Supabase writes,
 * no email sends) and prints a human-readable report plus a machine-readable JSON summary.
 *
 * Run:  node bolao/shared/scripts/pipeline_health.mjs [--json]
 *
 * Reports, per app (copa2026, br2026, cdb2026):
 *   - ESPN snapshot freshness: generatedAt, sourceUpdatedAt, stale flag/reason, age in minutes,
 *     match count (from bolao/{app}/data/espn-normalized.json, written by checkpoint C's
 *     sync_espn.py).
 *   - Notification outbox job status counts: pending/processing/sent/failed, and any job stuck
 *     in "processing" past the 5-minute threshold (from bolao/shared/scripts/
 *     notification_outbox.json, written by checkpoint D's reconciler / checkpoint F's
 *     send_result_email.py / send_round_email.py wiring).
 *   - Match store state distribution (from bolao/shared/scripts/match_store.json, written by
 *     checkpoint D's reconciler — this file is populated by RUNNING the reconciler; it will
 *     legitimately be empty/absent until the reconciler is wired into a real scheduled job,
 *     which is noted, not treated as an error).
 *
 * Exit code: 0 always for a successful READ of pipeline state (this is an observability tool,
 * not a test) UNLESS an unexpected error occurs reading/parsing a file that exists — a MISSING
 * file (nothing has run yet) is reported as informational, not a failure.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOLAO_ROOT = join(HERE, "..", "..");
const KNOWN_APPS = ["copa2026", "br2026", "cdb2026"];
// Section 8 review finding: a hardcoded list meant a brand-new pool (built by
// bolao/shared/scripts/new_bolao.mjs) would silently never appear in this report. Auto-discover
// any additional bolao/<app>/data/ directory (what new_bolao.mjs's scaffold + sync_espn.py
// create) so a new pool shows up here with zero manual edit to this shared file. KNOWN_APPS is
// kept as the base list (order-stable, matches existing output) rather than fully replaced by
// discovery, so this can't silently drop one of the three original apps if a directory is
// temporarily missing/renamed mid-migration.
function discoverApps() {
  const discovered = new Set(KNOWN_APPS);
  let entries = [];
  try { entries = readdirSync(join(BOLAO_ROOT), { withFileTypes: true }); } catch { return [...discovered]; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "shared" || e.name === "scripts" || e.name === "loterias") continue;
    if (existsSync(join(BOLAO_ROOT, e.name, "data"))) discovered.add(e.name);
  }
  return [...discovered];
}
const APPS = discoverApps();
const STUCK_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000;
const AS_JSON = process.argv.includes("--json");

function readJsonSafe(path) {
  if (!existsSync(path)) return { exists: false, data: null, error: null };
  try {
    return { exists: true, data: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (err) {
    return { exists: true, data: null, error: String(err.message || err) };
  }
}

function ageMinutes(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.round(ms / 60000);
}

function espnSnapshotHealth(app) {
  const path = join(BOLAO_ROOT, app, "data", "espn-normalized.json");
  const r = readJsonSafe(path);
  if (!r.exists) return { app, present: false };
  if (r.error) return { app, present: true, parseError: r.error };
  const d = r.data;
  return {
    app, present: true,
    schemaVersion: d.schemaVersion, competitionId: d.competitionId, provider: d.provider,
    generatedAt: d.generatedAt, sourceUpdatedAt: d.sourceUpdatedAt,
    ageMinutes: ageMinutes(d.generatedAt),
    stale: !!d.stale, staleReason: d.staleReason || null,
    matchCount: Array.isArray(d.matches) ? d.matches.length : 0,
    payloadHash: d.payloadHash,
  };
}

function outboxHealth() {
  const path = join(HERE, "notification_outbox.json");
  const r = readJsonSafe(path);
  if (!r.exists) return { present: false, byApp: {} };
  if (r.error) return { present: true, parseError: r.error };
  const jobs = Array.isArray(r.data) ? r.data : [];
  const byApp = {};
  const stuckJobs = [];
  const now = Date.now();
  for (const j of jobs) {
    const app = j.app || "unknown";
    byApp[app] = byApp[app] || { pending: 0, processing: 0, sent: 0, failed: 0, total: 0 };
    byApp[app][j.status] = (byApp[app][j.status] || 0) + 1;
    byApp[app].total += 1;
    if (j.status === "processing" && j.processingStartedAt) {
      const age = now - new Date(j.processingStartedAt).getTime();
      if (age >= STUCK_PROCESSING_THRESHOLD_MS) {
        stuckJobs.push({ jobId: j.jobId, app, matchId: j.matchId, recipient: j.recipient, stuckForMinutes: Math.round(age / 60000) });
      }
    }
  }
  return { present: true, totalJobs: jobs.length, byApp, stuckJobs };
}

function matchStoreHealth() {
  const path = join(HERE, "match_store.json");
  const r = readJsonSafe(path);
  if (!r.exists) return { present: false, note: "No reconciler run has populated this yet — expected until the reconciler is wired into a scheduled job. Not an error." };
  if (r.error) return { present: true, parseError: r.error };
  const records = Object.values(r.data || {});
  const byState = {};
  for (const rec of records) byState[rec.state] = (byState[rec.state] || 0) + 1;
  const needsAttention = records.filter((rec) => rec.state === "reconciliation_required" || rec.state === "notifications_partial_failure");
  return { present: true, totalMatches: records.length, byState, needsAttention: needsAttention.map((r2) => ({ matchId: r2.matchId, state: r2.state })) };
}

function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    espnSnapshots: APPS.map(espnSnapshotHealth),
    outbox: outboxHealth(),
    matchStore: matchStoreHealth(),
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log("=== Football Pipeline Health Report ===");
  console.log(`Generated: ${report.generatedAt}\n`);

  console.log("-- ESPN snapshot freshness (checkpoint C) --");
  for (const s of report.espnSnapshots) {
    if (!s.present) { console.log(`  [${s.app}] no snapshot on disk yet (sync_espn.py hasn't run)`); continue; }
    if (s.parseError) { console.log(`  [${s.app}] ✗ snapshot present but UNREADABLE: ${s.parseError}`); continue; }
    const flag = s.stale ? "STALE" : "fresh";
    console.log(`  [${s.app}] ${flag} — ${s.matchCount} matches, generated ${s.ageMinutes}min ago${s.stale ? ` (${s.staleReason})` : ""}`);
  }

  console.log("\n-- Notification outbox (checkpoint D/F) --");
  if (!report.outbox.present) {
    console.log("  no outbox file on disk yet (no notification job has ever been enqueued)");
  } else if (report.outbox.parseError) {
    console.log(`  ✗ outbox present but UNREADABLE: ${report.outbox.parseError}`);
  } else {
    console.log(`  total jobs: ${report.outbox.totalJobs}`);
    for (const [app, counts] of Object.entries(report.outbox.byApp)) {
      console.log(`  [${app}] pending=${counts.pending || 0} processing=${counts.processing || 0} sent=${counts.sent || 0} failed=${counts.failed || 0}`);
    }
    if (report.outbox.stuckJobs.length) {
      console.log(`  ⚠ ${report.outbox.stuckJobs.length} job(s) stuck in "processing" past the 5-min threshold — reconciler should recover these on its next run:`);
      for (const j of report.outbox.stuckJobs) console.log(`      ${j.jobId} (${j.app}/${j.matchId}) stuck ${j.stuckForMinutes}min`);
    }
  }

  console.log("\n-- Match state pipeline (checkpoint D) --");
  if (!report.matchStore.present) {
    console.log(`  ${report.matchStore.note}`);
  } else if (report.matchStore.parseError) {
    console.log(`  ✗ match store present but UNREADABLE: ${report.matchStore.parseError}`);
  } else {
    console.log(`  total tracked matches: ${report.matchStore.totalMatches}`);
    for (const [state, count] of Object.entries(report.matchStore.byState)) console.log(`    ${state}: ${count}`);
    if (report.matchStore.needsAttention.length) {
      console.log(`  ⚠ ${report.matchStore.needsAttention.length} match(es) need attention:`);
      for (const m of report.matchStore.needsAttention) console.log(`      ${m.matchId}: ${m.state}`);
    }
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

export { espnSnapshotHealth, outboxHealth, matchStoreHealth };
