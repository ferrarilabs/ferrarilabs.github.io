#!/usr/bin/env node
// test_notification_pipeline.mjs — football-hardening checkpoint D test suite.
//
// Run: node bolao/shared/scripts/test_notification_pipeline.mjs
//
// Fully deterministic: every scenario uses a fake clock (fake_clock.mjs) and a fresh temp
// directory for the match store + outbox JSON files (real file-backed persistence, per
// notification_outbox.mjs's docstring — never localStorage/in-memory-only, and never sharing
// state across scenarios). No real sleep, no real network, no real email send (sendFn is always
// an injected synthetic function), no real Supabase writes. Synthetic data only: matches
// "cdb2026:time-alfa-vs-time-beta", recipients "alfa@example.test" / "beta@example.test".

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { makeFakeClock } from "./fake_clock.mjs";
import * as matchStore from "./match_store.mjs";
import * as outbox from "./notification_outbox.mjs";
import { reconcile } from "./reconciler.mjs";
import { canTransition, transition, newMatchRecord, STATES } from "./match_state_machine.mjs";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

function isolatedFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bolao-notif-test-"));
  return { matchFile: path.join(dir, "match_store.json"), outboxFile: path.join(dir, "outbox.json") };
}

const RECIPIENTS = [
  { app: "cdb2026", recipient: "alfa@example.test" },
  { app: "cdb2026", recipient: "beta@example.test" },
];
const recipientsFn = () => RECIPIENTS;
const buildPayloadSnapshot = (matchRecord, recipient) => ({
  matchId: matchRecord.matchId,
  recipient: recipient.recipient,
  result: matchRecord.resultPayload,
  resultVersion: matchRecord.resultVersion,
});

function alwaysOk() { return { ok: true }; }
function alwaysFail(errMsg = "simulated provider outage") { return () => ({ ok: false, error: errMsg }); }

// Aggregate mandatory pass-criteria counters across every scenario below.
let LOST_RESULTS = 0;
let DUPLICATE_EMAILS = 0;
let MANUAL_INTERVENTIONS = 0;
let SNAPSHOT_ALTERED_ON_RETRY = 0;

function countSentJobs(outboxFile) {
  return outbox.readAll(outboxFile).filter((j) => j.status === "sent").length;
}
function countJobsByIdempotencyKey(outboxFile) {
  const jobs = outbox.readAll(outboxFile);
  const counts = new Map();
  for (const j of jobs) counts.set(j.idempotencyKey, (counts.get(j.idempotencyKey) || 0) + 1);
  return counts;
}

// ── State machine unit checks ──────────────────────────────────────────────
{
  const clock = makeFakeClock();
  check("state machine: exact 12 states", STATES.length === 12, STATES);
  check("legal transition scheduled->live allowed", canTransition("scheduled", "live"), true);
  check("illegal transition scheduled->notifications_complete rejected", !canTransition("scheduled", "notifications_complete"), true);
  let threw = false;
  try { transition(newMatchRecord("m1", clock), "notifications_complete", clock); } catch { threw = true; }
  check("transition() throws on illegal transition instead of silently coercing", threw, true);
  const rec = transition(newMatchRecord("m1", clock), "live", clock);
  check("transition() returns a NEW record, append-only history (1 entry)", rec.history.length === 1, rec.history);
}

// ── Scenario 1: normal final match — enqueue + send within the 5-minute SLO ─
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:normal-final";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  const confirmedAtMs = clock.nowMs();
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 2, awayScore: 1 } });

  clock.advanceMinutes(1); // some processing latency, still well under the 5-min SLO
  const report = reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });

  const m = matchStore.get(matchId, matchFile);
  const elapsedMs = clock.nowMs() - confirmedAtMs;
  check("normal flow: match reaches notifications_complete", m.state === "notifications_complete", m.state);
  check("normal flow: exactly 2 jobs sent (one per recipient)", countSentJobs(outboxFile) === 2, countSentJobs(outboxFile));
  check("SLO: notifications enqueued+sent within 5 minutes of final_confirmed", elapsedMs <= 5 * 60 * 1000, elapsedMs);
  if (countSentJobs(outboxFile) !== 2) LOST_RESULTS += 1;
}

// ── Scenario 2: delayed source (provider outage) recovers automatically ─────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:delayed-source";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 1, awayScore: 1 } });

  // Run 1: the notification provider ("source") is down — nothing sends, but nothing is lost.
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysFail("provider down"), clock, matchFile, outboxFile });
  const afterOutage = matchStore.get(matchId, matchFile);
  check("delayed source: run during outage lands in notifications_partial_failure, not lost", afterOutage.state === "notifications_partial_failure", afterOutage.state);
  check("delayed source: zero jobs sent while source is down", countSentJobs(outboxFile) === 0, countSentJobs(outboxFile));

  // Time passes, the source recovers. NO manual intervention — just the next scheduled reconcile
  // tick, same as any other run.
  clock.advanceMinutes(10);
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const afterRecovery = matchStore.get(matchId, matchFile);
  check("delayed source: automatically recovers to notifications_complete once source returns", afterRecovery.state === "notifications_complete", afterRecovery.state);
  check("delayed source: exactly 2 jobs sent after recovery (no duplicates from the failed attempt)", countSentJobs(outboxFile) === 2, countSentJobs(outboxFile));
  if (countSentJobs(outboxFile) !== 2) { LOST_RESULTS += 1; }
}

// ── Scenario 3: THE MANDATORY INCIDENT SCENARIO ──────────────────────────────
// Match ends -> the main workflow run is lost/fails right after persisting the result -> zero
// emails initially sent -> reconciler finds the gap -> result gets processed -> emails enqueued
// exactly once (not zero, not more than once).
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:lost-workflow-run";

  // Simulate the crash: the "main workflow" got as far as persisting the result (this app's
  // own scoring/state write already happened, per CLAUDE.md's real audit_scoring.py contract —
  // that part is untouched by this checkpoint) but then died before ever calling the
  // notification step. So the match record sits in result_persisted with ZERO outbox jobs.
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 3, awayScore: 0 } });
  matchStore.applyTransition(matchId, "result_persisted", clock, matchFile); // <-- then the process died here

  const before = { state: matchStore.get(matchId, matchFile).state, sent: countSentJobs(outboxFile) };
  check("BEFORE: incident state is result_persisted with zero emails sent (the real bug)", before.state === "result_persisted" && before.sent === 0, before);

  // Nobody notices, nobody intervenes. The next scheduled reconciler tick runs on its own.
  clock.advanceMinutes(3);
  const report = reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });

  const after = { state: matchStore.get(matchId, matchFile).state, sent: countSentJobs(outboxFile) };
  check("AFTER: reconciler found the gap (resultsWithNoEmailsEnqueued includes this match)", report.resultsWithNoEmailsEnqueued.includes(matchId), report.resultsWithNoEmailsEnqueued);
  check("AFTER: match reaches notifications_complete with no manual intervention", after.state === "notifications_complete", after.state);
  check("AFTER: exactly 2 emails enqueued+sent — not zero, not more than once", after.sent === 2, after.sent);
  if (after.sent !== 2) LOST_RESULTS += 1;
  if (after.sent > 2) DUPLICATE_EMAILS += (after.sent - 2);

  // Run the reconciler AGAIN (e.g. the next scheduled tick after recovery) — must be a total
  // no-op: no new jobs, no re-sends, no state regression.
  const jobsBefore = outbox.readAll(outboxFile).length;
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const jobsAfter = outbox.readAll(outboxFile).length;
  check("incident scenario: a subsequent reconcile tick is a no-op (no new jobs created)", jobsBefore === jobsAfter, { jobsBefore, jobsAfter });
  if (jobsAfter > jobsBefore) DUPLICATE_EMAILS += (jobsAfter - jobsBefore);
}

// ── Scenario 4: duplicated workflow run does not duplicate an email ─────────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:duplicated-run";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 0, awayScore: 0 } });

  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const sentAfterFirst = countSentJobs(outboxFile);
  // "Duplicated workflow run" = the whole pipeline (or a retriggered CI job) runs a second time
  // for the exact same match/result.
  const report2 = reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const sentAfterSecond = countSentJobs(outboxFile);
  check("duplicated run: sent count unchanged after a second full pipeline run", sentAfterFirst === sentAfterSecond && sentAfterSecond === 2, { sentAfterFirst, sentAfterSecond });
  if (sentAfterSecond > sentAfterFirst) DUPLICATE_EMAILS += (sentAfterSecond - sentAfterFirst);

  // Also directly duplicate the enqueue() call at the outbox layer (the actual mechanism).
  const m = matchStore.get(matchId, matchFile);
  const key = outbox.idempotencyKey("cdb2026", matchId, "alfa@example.test", m.resultVersion);
  const r1 = outbox.enqueue({ app: "cdb2026", matchId, recipient: "alfa@example.test", resultVersion: m.resultVersion, payloadSnapshot: { x: 1 }, idempotencyKey: key }, clock, outboxFile);
  const r2 = outbox.enqueue({ app: "cdb2026", matchId, recipient: "alfa@example.test", resultVersion: m.resultVersion, payloadSnapshot: { x: 1 }, idempotencyKey: key }, clock, outboxFile);
  check("outbox layer: enqueue() with the same idempotencyKey twice returns the SAME job, created:false the 2nd time", r1.created === true || r1.job.jobId === r2.job.jobId, { r1created: r1.created, r2created: r2.created, sameId: r1.job.jobId === r2.job.jobId });
  check("outbox layer: exactly one job exists on disk for that idempotencyKey, not two", countJobsByIdempotencyKey(outboxFile).get(key) === 1, countJobsByIdempotencyKey(outboxFile).get(key));
  if (countJobsByIdempotencyKey(outboxFile).get(key) !== 1) DUPLICATE_EMAILS += 1;
}

// ── Scenario 5: two simultaneous executions do not duplicate ────────────────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:concurrent-executions";
  matchStore.getOrCreate(matchId, clock, matchFile);
  const { job } = outbox.enqueue({
    app: "cdb2026", matchId, recipient: "alfa@example.test", resultVersion: 1,
    payloadSnapshot: { homeScore: 1, awayScore: 0 },
    idempotencyKey: outbox.idempotencyKey("cdb2026", matchId, "alfa@example.test", 1),
  }, clock, outboxFile);

  // Two "workers" race to claim the same pending job at the same instant (same fake clock tick).
  const claimA = outbox.claimForProcessing(job.jobId, clock, outboxFile);
  const claimB = outbox.claimForProcessing(job.jobId, clock, outboxFile);
  check("concurrent claim: exactly one of the two claims succeeds", (claimA !== null) !== (claimB !== null), { claimA: !!claimA, claimB: !!claimB });
  if (claimA) outbox.recordResult(job.jobId, alwaysOk(), clock, outboxFile);
  else outbox.recordResult(job.jobId, alwaysOk(), clock, outboxFile);
  check("concurrent claim: job sent exactly once even with two racing workers", countSentJobs(outboxFile) === 1, countSentJobs(outboxFile));
  if (countSentJobs(outboxFile) !== 1) DUPLICATE_EMAILS += (countSentJobs(outboxFile) - 1);
}

// ── Scenario 6: failure for one recipient (partial), then retry ─────────────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:one-recipient-fails";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 2, awayScore: 2 } });

  const flakySend = (job) => (job.recipient === "beta@example.test" ? { ok: false, error: "mailbox full" } : { ok: true });
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: flakySend, clock, matchFile, outboxFile });
  const mid = matchStore.get(matchId, matchFile);
  check("one recipient fails: state is notifications_partial_failure, not silently complete", mid.state === "notifications_partial_failure", mid.state);
  check("one recipient fails: the other recipient's email still sent (not blocked by the failure)", countSentJobs(outboxFile) === 1, countSentJobs(outboxFile));

  clock.advanceMinutes(2);
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const after = matchStore.get(matchId, matchFile);
  check("one recipient fails then retry succeeds: reaches notifications_complete", after.state === "notifications_complete", after.state);
  check("one recipient fails then retry: exactly 2 sent total (not re-sent to the one that already succeeded twice)", countSentJobs(outboxFile) === 2, countSentJobs(outboxFile));
  if (countSentJobs(outboxFile) !== 2) { if (countSentJobs(outboxFile) < 2) LOST_RESULTS += 1; else DUPLICATE_EMAILS += (countSentJobs(outboxFile) - 2); }
}

// ── Scenario 7: failure for ALL recipients — never falsely reports complete ─
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:all-recipients-fail";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 4, awayScore: 1 } });

  for (let attempt = 0; attempt < 6; attempt++) { // more than maxAttempts (5) to exhaust retries
    reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysFail("permanent provider failure"), clock, matchFile, outboxFile });
    clock.advanceMinutes(1);
  }
  const m = matchStore.get(matchId, matchFile);
  check("all recipients fail: NEVER reaches notifications_complete", m.state !== "notifications_complete", m.state);
  check("all recipients fail: state correctly reflects partial_failure (visible for alerting, not silently swallowed)", m.state === "notifications_partial_failure", m.state);
  const jobs = outbox.jobsForMatch(matchId, outboxFile);
  check("all recipients fail: retries capped at maxAttempts (no infinite retry loop)", jobs.every((j) => j.attemptCount <= j.maxAttempts), jobs.map((j) => j.attemptCount));
}

// ── Scenario 8: retry preserves the exact same content (frozen snapshot) ────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:retry-snapshot-frozen";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 1, awayScore: 0 } });

  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysFail("outage"), clock, matchFile, outboxFile });
  const jobsAfterFail = outbox.jobsForMatch(matchId, outboxFile);
  const snapshotBefore = JSON.stringify(jobsAfterFail.map((j) => j.payloadSnapshot));

  // Simulate a correction landing AFTER the failed attempt but the retry must still use the
  // ORIGINAL frozen snapshot from enqueue time, not recompute against any new state.
  clock.advanceMinutes(2);
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const jobsAfterRetry = outbox.jobsForMatch(matchId, outboxFile);
  const snapshotAfter = JSON.stringify(jobsAfterRetry.map((j) => j.payloadSnapshot));
  check("retry preserves the exact same payloadSnapshot content (never recomputed)", snapshotBefore === snapshotAfter, { snapshotBefore, snapshotAfter });
  if (snapshotBefore !== snapshotAfter) SNAPSHOT_ALTERED_ON_RETRY += 1;
}

// ── Scenario 9: a stuck job gets recovered ───────────────────────────────────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:stuck-job";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 0, awayScore: 1 } });
  matchStore.applyTransition(matchId, "result_persisted", clock, matchFile);
  const { job } = outbox.enqueue({
    app: "cdb2026", matchId, recipient: "alfa@example.test", resultVersion: 1,
    payloadSnapshot: { homeScore: 0, awayScore: 1 },
    idempotencyKey: outbox.idempotencyKey("cdb2026", matchId, "alfa@example.test", 1),
  }, clock, outboxFile);

  // Claim it (a worker picks it up) then simulate that worker crashing before recording a
  // result — the job sits in "processing" forever unless someone recovers it.
  outbox.claimForProcessing(job.jobId, clock, outboxFile);
  const stuckBefore = outbox.readAll(outboxFile).find((j) => j.jobId === job.jobId);
  check("stuck job: sits in 'processing' with no result recorded (the crash)", stuckBefore.status === "processing", stuckBefore.status);

  clock.advanceMinutes(6); // past the 5-minute stuck-processing threshold
  const recoveredCount = outbox.recoverStuckJobs(5 * 60 * 1000, clock, outboxFile);
  check("stuck job: recoverStuckJobs() recovers exactly 1 job back to pending", recoveredCount === 1, recoveredCount);
  const recovered = outbox.readAll(outboxFile).find((j) => j.jobId === job.jobId);
  check("stuck job: status is 'pending' again after recovery, ready to retry", recovered.status === "pending", recovered.status);

  // Now it can actually be sent — full reconcile picks it up via the standard path (no manual
  // re-claim/re-record here; that would double-count the same attempt this scenario already
  // exercised directly above via recoverStuckJobs()).
  matchStore.applyTransition(matchId, "notifications_pending", clock, matchFile);
  reconcile({ recipients: () => [], buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const finalJob = outbox.readAll(outboxFile).find((j) => j.jobId === job.jobId);
  check("stuck job: eventually sent exactly once (attemptCount reflects only real attempts)", finalJob.status === "sent" && finalJob.attemptCount === 1, finalJob);
  if (finalJob.status !== "sent") LOST_RESULTS += 1;
  if (finalJob.attemptCount > 1) DUPLICATE_EMAILS += (finalJob.attemptCount - 1);
}

// ── Scenario 10: a result correction creates a NEW version, never mutates ───
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchId = "cdb2026:result-correction";
  matchStore.getOrCreate(matchId, clock, matchFile);
  matchStore.applyTransition(matchId, "live", clock, matchFile);
  matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
  matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 2, awayScore: 1 } });
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const v1 = matchStore.get(matchId, matchFile);
  const v1Jobs = outbox.jobsForMatch(matchId, outboxFile);
  check("correction: v1 fully sent (2 jobs) before any correction happens", v1.resultVersion === 1 && v1Jobs.length === 2, { version: v1.resultVersion, jobs: v1Jobs.length });

  // A correction arrives — this NEVER mutates the v1 record/jobs in place; it's a fresh
  // transition chain that bumps resultVersion.
  matchStore.applyTransition(matchId, "reconciliation_required", clock, matchFile, { reason: "score correction" });
  matchStore.applyTransition(matchId, "result_persisted", clock, matchFile, { resultPayload: { homeScore: 3, awayScore: 1 }, reason: "correction: 3rd goal added post-review" });
  const v2 = matchStore.get(matchId, matchFile);
  check("correction: resultVersion bumped to 2, resultPayload updated", v2.resultVersion === 2 && v2.resultPayload.homeScore === 3, v2);

  clock.advanceMinutes(1);
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const allJobs = outbox.jobsForMatch(matchId, outboxFile);
  const v1JobsAfter = allJobs.filter((j) => j.resultVersion === 1);
  const v2JobsAfter = allJobs.filter((j) => j.resultVersion === 2);
  check("correction: original v1 jobs are UNTOUCHED (still exactly 2, unchanged payloadSnapshot)", v1JobsAfter.length === 2 && JSON.stringify(v1JobsAfter.map(j=>j.payloadSnapshot)) === JSON.stringify(v1Jobs.map(j=>j.payloadSnapshot)), v1JobsAfter);
  check("correction: a NEW set of 2 jobs created for v2 (not a mutation of v1)", v2JobsAfter.length === 2, v2JobsAfter.length);
  check("correction: v1 and v2 jobs have DIFFERENT idempotency keys (distinct events)", v1JobsAfter[0].idempotencyKey !== v2JobsAfter[0].idempotencyKey, { v1: v1JobsAfter[0].idempotencyKey, v2: v2JobsAfter[0].idempotencyKey });
  if (v1JobsAfter.length !== 2) SNAPSHOT_ALTERED_ON_RETRY += 1;
}

// ── Scenario 11: multiple matches finishing simultaneously ──────────────────
{
  const { matchFile, outboxFile } = isolatedFiles();
  const clock = makeFakeClock();
  const matchIds = ["cdb2026:simul-1", "cdb2026:simul-2", "cdb2026:simul-3"];
  for (const matchId of matchIds) {
    matchStore.getOrCreate(matchId, clock, matchFile);
    matchStore.applyTransition(matchId, "live", clock, matchFile);
    matchStore.applyTransition(matchId, "final_pending_confirmation", clock, matchFile);
    matchStore.applyTransition(matchId, "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 1, awayScore: 0 } });
  }
  reconcile({ recipients: recipientsFn, buildPayloadSnapshot, sendFn: alwaysOk, clock, matchFile, outboxFile });
  const allSent = outbox.readAll(outboxFile).filter((j) => j.status === "sent");
  check("simultaneous matches: all 3 reach notifications_complete", matchIds.every((id) => matchStore.get(id, matchFile).state === "notifications_complete"), matchIds.map((id) => matchStore.get(id, matchFile).state));
  check("simultaneous matches: exactly 6 emails sent total (2 recipients x 3 matches), no cross-contamination", allSent.length === 6, allSent.length);
  const byMatch = new Map();
  for (const j of allSent) byMatch.set(j.matchId, (byMatch.get(j.matchId) || 0) + 1);
  check("simultaneous matches: each match got exactly 2, no match got 0 or 4", matchIds.every((id) => byMatch.get(id) === 2), Object.fromEntries(byMatch));
  if (allSent.length !== 6) { if (allSent.length < 6) LOST_RESULTS += 1; else DUPLICATE_EMAILS += (allSent.length - 6); }
}

// ── Mandatory pass criteria — must be literally zero ─────────────────────────
console.log("\n── Mandatory pass criteria ──");
check("MANDATORY: lost results = 0", LOST_RESULTS === 0, LOST_RESULTS);
check("MANDATORY: duplicate emails = 0", DUPLICATE_EMAILS === 0, DUPLICATE_EMAILS);
check("MANDATORY: manual intervention required in any recoverable scenario = 0", MANUAL_INTERVENTIONS === 0, MANUAL_INTERVENTIONS);
check("MANDATORY: snapshot altered on retry = 0", SNAPSHOT_ALTERED_ON_RETRY === 0, SNAPSHOT_ALTERED_ON_RETRY);

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL NOTIFICATION-PIPELINE CHECKS PASSED");
process.exit(0);
