#!/usr/bin/env node
// test_notification_repository.mjs — real tests for MemoryNotificationRepository and
// FileNotificationRepository against the shared NotificationRepository contract (football-
// hardening readiness follow-up, items 2/5). SupabaseNotificationRepository is code-complete
// but NOT tested here — see docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_EXECUTION.md for why
// (no test Supabase project available) and its own honest NÃO EXECUTADO status.
//
// Run: node bolao/shared/scripts/test_notification_repository.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MemoryNotificationRepository, FileNotificationRepository,
  toCanonical, fromCanonical, buildIdempotencyKey, JOB_STATUS, SCHEMA_VERSION,
} from "./notification_repository.mjs";
import { makeFakeClock } from "./fake_clock.mjs";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

async function runSuite(label, makeRepo) {
  // ── Same battery of real behavior checks, run against EVERY adapter — Copa/BR/CDB must see
  // identical behavior regardless of backend. ────────────────────────────────────────────────
  {
    const repo = makeRepo();
    const { event, created } = await repo.createEvent({ poolId: "cdb2026", entityType: "tie", entityId: "oitavas:tie-1", eventType: "final_confirmed", eventVersion: 1, payloadSnapshot: { homeScore: 1, awayScore: 1 } });
    check(`${label}: createEvent() creates on first call`, created === true, event);
    const dup = await repo.createEvent({ poolId: "cdb2026", entityType: "tie", entityId: "oitavas:tie-1", eventType: "final_confirmed", eventVersion: 1, payloadSnapshot: { homeScore: 1, awayScore: 1 } });
    check(`${label}: createEvent() is idempotent (same pool/entity/type/version -> created:false)`, dup.created === false && dup.event.eventId === event.eventId, dup);

    const key1 = buildIdempotencyKey("cdb2026", "oitavas:tie-1", "alfa@example.test", 1);
    const key2 = buildIdempotencyKey("cdb2026", "oitavas:tie-1", "beta@example.test", 1);
    const { jobs, createdCount } = await repo.enqueueJobs(event.eventId, [
      { poolId: "cdb2026", recipient: "alfa@example.test", payloadSnapshot: { x: 1 }, idempotencyKey: key1 },
      { poolId: "cdb2026", recipient: "beta@example.test", payloadSnapshot: { x: 1 }, idempotencyKey: key2 },
    ]);
    check(`${label}: enqueueJobs() creates 2 jobs`, createdCount === 2 && jobs.length === 2, { createdCount, jobsLen: jobs.length });

    const dupJobs = await repo.enqueueJobs(event.eventId, [
      { poolId: "cdb2026", recipient: "alfa@example.test", payloadSnapshot: { x: 1 }, idempotencyKey: key1 },
    ]);
    check(`${label}: enqueueJobs() is idempotent (same idempotencyKey -> 0 new)`, dupJobs.createdCount === 0, dupJobs);

    const claimed = await repo.claimPendingJobs("cdb2026", 50, "test-worker");
    check(`${label}: claimPendingJobs() claims exactly 2`, claimed.length === 2 && claimed.every((j) => j.status === JOB_STATUS.PROCESSING), claimed.map((j) => j.status));

    const claimedAgain = await repo.claimPendingJobs("cdb2026", 50, "test-worker-2");
    check(`${label}: claimPendingJobs() a second time claims ZERO (already processing)`, claimedAgain.length === 0, claimedAgain);

    const sent = await repo.markSent(claimed[0].jobId, { providerMessageId: "provider-msg-1" });
    check(`${label}: markSent() transitions to sent with providerMessageId`, sent.status === JOB_STATUS.SENT && sent.providerMessageId === "provider-msg-1", sent);

    const failed = await repo.markRetryableFailure(claimed[1].jobId, { error: "simulated provider outage" });
    check(`${label}: markRetryableFailure() transitions to failed_retryable with error recorded`, failed.status === JOB_STATUS.FAILED_RETRYABLE && failed.lastError === "simulated provider outage", failed);
  }

  // ── Stuck job recovery ──────────────────────────────────────────────────────────────────
  {
    const clock = makeFakeClock();
    const repo = makeRepo(clock);
    const { event } = await repo.createEvent({ poolId: "br2026", entityType: "round_batch", entityId: "round:g1,g2", eventType: "final_confirmed", eventVersion: 1, payloadSnapshot: {} });
    await repo.enqueueJobs(event.eventId, [{ poolId: "br2026", recipient: "x@example.test", payloadSnapshot: {}, idempotencyKey: buildIdempotencyKey("br2026", "round:g1,g2", "x@example.test", 1) }]);
    await repo.claimPendingJobs("br2026", 10, "crashed-worker");
    clock.advanceMinutes(10);
    const recovered = await repo.releaseStuckJobs(5 * 60 * 1000);
    check(`${label}: releaseStuckJobs() recovers exactly 1 stuck job`, recovered === 1, recovered);
  }

  // ── Missing notifications ───────────────────────────────────────────────────────────────
  {
    const repo = makeRepo();
    const { event } = await repo.createEvent({ poolId: "copa2026", entityType: "match", entityId: "M95", eventType: "final_confirmed", eventVersion: 1, payloadSnapshot: {} });
    const missing = await repo.findMissingNotifications("copa2026");
    check(`${label}: findMissingNotifications() finds an event with zero jobs`, missing.some((e) => e.eventId === event.eventId), missing);
    await repo.enqueueJobs(event.eventId, [{ poolId: "copa2026", recipient: "y@example.test", payloadSnapshot: {}, idempotencyKey: buildIdempotencyKey("copa2026", "M95", "y@example.test", 1) }]);
    const missingAfter = await repo.findMissingNotifications("copa2026");
    check(`${label}: findMissingNotifications() no longer lists it once jobs exist`, !missingAfter.some((e) => e.eventId === event.eventId), missingAfter);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notif-repo-test-"));

await runSuite("MemoryNotificationRepository", (clock) => new MemoryNotificationRepository(clock || makeFakeClock()));
await runSuite("FileNotificationRepository", (clock) => new FileNotificationRepository(clock || makeFakeClock(), {
  eventsPath: path.join(fs.mkdtempSync(path.join(tmpDir, "run-")), "events.json"),
  jobsPath: path.join(fs.mkdtempSync(path.join(tmpDir, "run-")), "jobs.json"),
}));

// ── Canonical schema compatibility (item 5) ────────────────────────────────────────────────
{
  const oldJob = {
    schemaVersion: 1, jobId: "job_1", app: "cdb2026", matchId: "oitavas:tie-1", recipient: "a@x.test",
    resultVersion: 1, payloadSnapshot: { x: 1 }, idempotencyKey: "cdb2026:oitavas:tie-1:a@x.test:v1",
    status: "sent", attemptCount: 1, maxAttempts: 5, processingStartedAt: null, lastAttemptAt: "2026-01-01T00:00:00Z",
    sentAt: "2026-01-01T00:00:00Z", providerMessageId: "pm-1", lastError: null, createdAt: "2026-01-01T00:00:00Z",
  };
  const canonical = toCanonical(oldJob);
  check("toCanonical(): maps app->poolId, matchId->entityId, resultVersion->eventVersion", canonical.poolId === "cdb2026" && canonical.entityId === "oitavas:tie-1" && canonical.eventVersion === 1, canonical);
  check("toCanonical(): schemaVersion bumped to current SCHEMA_VERSION", canonical.schemaVersion === SCHEMA_VERSION, canonical.schemaVersion);
  check("toCanonical(): preserves providerMessageId", canonical.providerMessageId === "pm-1", canonical.providerMessageId);

  const roundTripped = fromCanonical(canonical);
  check("fromCanonical(): round-trips back to the old field names", roundTripped.app === "cdb2026" && roundTripped.matchId === "oitavas:tie-1" && roundTripped.resultVersion === 1, roundTripped);
  check("fromCanonical(): round-trips status sent (no failed_retryable/failed_permanent split in v1)", roundTripped.status === "sent", roundTripped.status);
}

fs.rmSync(tmpDir, { recursive: true, force: true });

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL NOTIFICATION REPOSITORY CHECKS PASSED");
process.exit(0);
