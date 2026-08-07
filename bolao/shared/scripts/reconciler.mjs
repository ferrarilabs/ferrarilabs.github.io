// reconciler.mjs — finds and recovers gaps in the match-result notification pipeline
// (football-hardening checkpoint D). This is the piece that turns "the main workflow run
// crashed/was lost after confirming a result but before sending any email" from a silent,
// permanently-missed notification into a self-healing, at-most-once-duplicated, exactly-once
// eventually-delivered outcome — WITHOUT requiring anyone to notice and intervene manually.
//
// Deliberately has zero dependency on real time: every timestamp comparison uses the injected
// `clock`, so the entire reconciliation loop is testable by advancing a fake clock and calling
// reconcile() again — no sleep, no wall-clock races.

import * as matchStore from "./match_store.mjs";
import * as outbox from "./notification_outbox.mjs";
import { applyTransition } from "./match_store.mjs";

const STUCK_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000; // 5 min — matches the checkpoint's own SLO

/**
 * @param opts.recipients - function(matchId) -> array of { app, recipient } to notify
 * @param opts.buildPayloadSnapshot - function(matchRecord, recipient) -> frozen payload object
 * @param opts.sendFn - function(job) -> { ok, error? } (injectable — never a real email send here)
 * @param opts.clock - injected clock (see fake_clock.mjs)
 * @param opts.matchFile, opts.outboxFile - optional overrides for test isolation
 */
export function reconcile(opts) {
  const {
    recipients, buildPayloadSnapshot, sendFn, clock,
    matchFile = matchStore.defaultMatchStorePath(),
    outboxFile = outbox.defaultOutboxPath(),
    stuckThresholdMs = STUCK_PROCESSING_THRESHOLD_MS,
  } = opts;

  const report = {
    finalMatchesAdvancedToPersisted: [],
    resultsWithNoEmailsEnqueued: [],
    jobsRecovered: 0,
    jobsRetried: 0,
    jobsSentThisRun: 0,
    duplicatesPrevented: 0, // count of enqueue() calls that returned created:false
  };

  // 1. Find a final match not yet processed (confirmed but never advanced to result_persisted —
  // e.g. the process that would have persisted it crashed right after confirmation).
  for (const m of matchStore.listByState("final_confirmed", matchFile)) {
    const persisted = applyTransition(m.matchId, "result_persisted", clock, matchFile, {
      resultPayload: m.resultPayload ?? { recovered: true },
      reconciledBy: "reconciler:find-unprocessed-final",
    });
    report.finalMatchesAdvancedToPersisted.push(persisted.matchId);
  }

  // 2. Find a persisted result with no emails sent at all (result_persisted or
  // notifications_pending with zero outbox jobs for its CURRENT resultVersion) — the exact
  // incident scenario: result landed, notification step never ran.
  const candidates = [
    ...matchStore.listByState("result_persisted", matchFile),
    ...matchStore.listByState("notifications_pending", matchFile),
  ];
  for (const m of candidates) {
    const existingJobsThisVersion = outbox.jobsForMatch(m.matchId, outboxFile)
      .filter((j) => j.resultVersion === m.resultVersion);
    if (existingJobsThisVersion.length > 0) continue; // already enqueued for this version — skip
    report.resultsWithNoEmailsEnqueued.push(m.matchId);

    const targets = recipients(m.matchId);
    const enqueuedJobs = [];
    for (const { app, recipient } of targets) {
      const key = outbox.idempotencyKey(app, m.matchId, recipient, m.resultVersion);
      const { job, created } = outbox.enqueue({
        app, matchId: m.matchId, recipient, resultVersion: m.resultVersion,
        payloadSnapshot: buildPayloadSnapshot(m, recipient), // frozen NOW, never recomputed later
        idempotencyKey: key,
      }, clock, outboxFile);
      if (!created) report.duplicatesPrevented += 1;
      enqueuedJobs.push(job);
    }
    if (m.state === "result_persisted") {
      applyTransition(m.matchId, "notifications_pending", clock, matchFile, {
        reconciledBy: "reconciler:enqueue-missing-notifications", enqueuedCount: enqueuedJobs.length,
      });
    }
  }

  // 3. Recover jobs stuck in "processing" (a worker claimed them and then died before recording
  // a result) back to "pending" so step 4 below can retry them THIS run.
  report.jobsRecovered = outbox.recoverStuckJobs(stuckThresholdMs, clock, outboxFile);

  // 4. Retry retryable failures (and freshly-recovered/newly-enqueued pending jobs) — process
  // every match currently sitting in notifications_pending OR notifications_partial_failure
  // (a previous run failed for some/all recipients; this run retries the still-retryable ones).
  const toReconcile = [
    ...matchStore.listByState("notifications_pending", matchFile),
    ...matchStore.listByState("notifications_partial_failure", matchFile),
  ];
  for (const m of toReconcile) {
    const jobs = outbox.jobsForMatch(m.matchId, outboxFile).filter((j) => j.resultVersion === m.resultVersion);
    const toProcess = jobs.filter((j) => j.status === "pending" || (j.status === "failed" && j.attemptCount < j.maxAttempts));
    if (toProcess.length === 0) continue;
    applyTransition(m.matchId, "notifications_processing", clock, matchFile, { reconciledBy: "reconciler:begin-processing" });
    let anyFailed = false;
    for (const j of toProcess) {
      const claimed = outbox.claimForProcessing(j.jobId, clock, outboxFile);
      if (!claimed) continue; // already claimed/sent by a concurrent run — do NOT re-send
      report.jobsRetried += 1;
      const result = sendFn(claimed); // never re-derives payload — uses claimed.payloadSnapshot
      outbox.recordResult(claimed.jobId, result, clock, outboxFile);
      if (result.ok) report.jobsSentThisRun += 1; else anyFailed = true;
    }
    const finalJobs = outbox.jobsForMatch(m.matchId, outboxFile).filter((j) => j.resultVersion === m.resultVersion);
    const allSent = finalJobs.every((j) => j.status === "sent");
    const anyExhausted = finalJobs.some((j) => j.status === "failed" && j.attemptCount >= j.maxAttempts);
    if (allSent) {
      applyTransition(m.matchId, "notifications_complete", clock, matchFile, { reconciledBy: "reconciler:all-sent" });
    } else if (anyFailed || anyExhausted) {
      applyTransition(m.matchId, "notifications_partial_failure", clock, matchFile, { reconciledBy: "reconciler:partial-failure" });
    }
  }

  return report;
}
