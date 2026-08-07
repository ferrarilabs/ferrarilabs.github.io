#!/usr/bin/env node
/**
 * notification_worker.mjs — CLI entrypoint running the reconciler as a standalone worker/
 * notification-processing step, with a real --dry-run mode (football-hardening readiness
 * follow-up, item 7).
 *
 * Run:  node bolao/shared/scripts/notification_worker.mjs [--dry-run] [--match-file=...] [--outbox-file=...]
 *
 * Dry-run technique: reconcile() always mutates whatever match/outbox files it's pointed at —
 * rather than threading a dryRun flag through every internal mutation (state-machine
 * transitions, outbox enqueue/claim/record — reconciler.mjs's own file header explains why it's
 * deliberately clock-injected and side-effect-heavy by design), this wrapper copies the REAL
 * files to a throwaway temp location first when --dry-run is set, runs the real reconcile()
 * against the COPIES, diffs what changed, reports it as "would" actions, and deletes the temp
 * copies — the real files are never touched. This proves the exact same decision logic a real
 * run would use (event/job creation, idempotency checks, retry logic) without ever persisting
 * anything.
 */
import { existsSync, mkdtempSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile } from "./reconciler.mjs";
import * as matchStore from "./match_store.mjs";
import * as outbox from "./notification_outbox.mjs";
import { makeRealClock } from "./fake_clock.mjs";

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  const matchFileArg = argv.find((a) => a.startsWith("--match-file="))?.slice("--match-file=".length);
  const outboxFileArg = argv.find((a) => a.startsWith("--outbox-file="))?.slice("--outbox-file=".length);
  return { dryRun, matchFileArg, outboxFileArg };
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function runWorker({ dryRun, matchFile, outboxFile, recipients, buildPayloadSnapshot, sendFn, clock = makeRealClock() }) {
  const realMatchFile = matchFile || matchStore.defaultMatchStorePath();
  const realOutboxFile = outboxFile || outbox.defaultOutboxPath();

  const report = {
    dryRun: !!dryRun,
    wouldCreateEvents: [],
    wouldEnqueueJobs: [],
    wouldSend: [],
    wouldSkipAlreadyProcessed: [],
    wouldRetry: [],
    validationErrors: [],
  };

  if (!dryRun) {
    const result = reconcile({ recipients, buildPayloadSnapshot, sendFn, clock, matchFile: realMatchFile, outboxFile: realOutboxFile });
    return { report: null, result };
  }

  // Dry-run: work against throwaway copies, never the real files.
  const tmp = mkdtempSync(join(tmpdir(), "notif-worker-dryrun-"));
  const tmpMatchFile = join(tmp, "match_store.json");
  const tmpOutboxFile = join(tmp, "notification_outbox.json");
  if (existsSync(realMatchFile)) copyFileSync(realMatchFile, tmpMatchFile);
  if (existsSync(realOutboxFile)) copyFileSync(realOutboxFile, tmpOutboxFile);

  const outboxBefore = readJsonSafe(tmpOutboxFile) || [];
  const beforeIds = new Set(outboxBefore.map((j) => j.jobId));

  const dryRunSendFn = (job) => {
    report.wouldSend.push({ recipient: job.recipient, matchId: job.matchId });
    return { ok: true }; // never a real send — this function never touches a network
  };

  const result = reconcile({ recipients, buildPayloadSnapshot, sendFn: dryRunSendFn, clock, matchFile: tmpMatchFile, outboxFile: tmpOutboxFile });

  const outboxAfter = readJsonSafe(tmpOutboxFile) || [];
  for (const j of outboxAfter) {
    if (!beforeIds.has(j.jobId)) report.wouldEnqueueJobs.push({ jobId: j.jobId, matchId: j.matchId, recipient: j.recipient, idempotencyKey: j.idempotencyKey });
  }
  report.wouldSkipAlreadyProcessed = (result.duplicatesPrevented ?? 0) > 0
    ? [{ count: result.duplicatesPrevented }] : [];
  report.wouldCreateEvents = result.finalMatchesAdvancedToPersisted.map((matchId) => ({ matchId }));
  report.wouldRetry = [{ jobsRetried: result.jobsRetried }];

  rmSync(tmp, { recursive: true, force: true });
  // Real files were NEVER opened for writing above — only the tmp copies were.
  return { report, result: null };
}

function main() {
  const { dryRun, matchFileArg, outboxFileArg } = parseArgs(process.argv.slice(2));
  console.log(dryRun ? "=== DRY-RUN MODE (item 7) — no state/outbox files altered, no real send ===" : "=== notification_worker.mjs — real run ===");

  // No production recipients/payload builder is wired here in this readiness pass — this CLI
  // exists to prove the dry-run MECHANISM works generically (item 7's exact requirement); wiring
  // real per-app recipients into a live worker is future application work, same caution as
  // durable_persist.py not being bolted into production without its own review.
  const recipients = () => [];
  const buildPayloadSnapshot = () => ({});
  const sendFn = () => ({ ok: true });

  const { report, result } = runWorker({ dryRun, matchFile: matchFileArg, outboxFile: outboxFileArg, recipients, buildPayloadSnapshot, sendFn });
  if (dryRun) {
    console.log("\n=== DRY-RUN REPORT ===");
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n=== RESULT ===");
    console.log(JSON.stringify(result, null, 2));
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
