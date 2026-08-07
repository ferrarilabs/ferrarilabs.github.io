#!/usr/bin/env node
// test_notification_worker.mjs — proves notification_worker.mjs's --dry-run mode never touches
// the real match/outbox files (football-hardening readiness follow-up, item 7).
//
// Run: node bolao/shared/scripts/test_notification_worker.mjs

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorker } from "./notification_worker.mjs";
import * as matchStore from "./match_store.mjs";
import { makeFakeClock } from "./fake_clock.mjs";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}`);
  if (!pass && detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

const tmp = mkdtempSync(join(tmpdir(), "worker-test-"));
const matchFile = join(tmp, "match_store.json");
const outboxFile = join(tmp, "outbox.json");
const clock = makeFakeClock();

// Seed a real "final_confirmed, unnotified" match — the exact scenario a real worker run
// would act on.
matchStore.getOrCreate("cdb2026:worker-test", clock, matchFile);
matchStore.applyTransition("cdb2026:worker-test", "live", clock, matchFile);
matchStore.applyTransition("cdb2026:worker-test", "final_pending_confirmation", clock, matchFile);
matchStore.applyTransition("cdb2026:worker-test", "final_confirmed", clock, matchFile, { resultPayload: { homeScore: 1, awayScore: 0 } });

const beforeMatchContent = readFileSync(matchFile, "utf8");
const outboxExistedBefore = existsSync(outboxFile);

const recipients = () => [{ app: "cdb2026", recipient: "dryrun@example.test" }];
const buildPayloadSnapshot = (m, r) => ({ matchId: m.matchId, recipient: r.recipient });
const sendFn = () => { throw new Error("sendFn must NEVER be called for real during a dry run"); };

const { report } = runWorker({ dryRun: true, matchFile, outboxFile, recipients, buildPayloadSnapshot, sendFn, clock });

check("dry-run: real match_store.json file is BYTE-IDENTICAL after the run", readFileSync(matchFile, "utf8") === beforeMatchContent, "match file was altered during a dry run");
check("dry-run: real outbox.json file was NOT created (no write happened)", existsSync(outboxFile) === outboxExistedBefore, "outbox file appeared during a dry run");
check("dry-run: report shows wouldCreateEvents (the match WOULD have advanced to result_persisted)", report.wouldCreateEvents.length === 1, report.wouldCreateEvents);
check("dry-run: report shows wouldEnqueueJobs (the notification job that WOULD be created)", report.wouldEnqueueJobs.length === 1 && report.wouldEnqueueJobs[0].recipient === "dryrun@example.test", report.wouldEnqueueJobs);
check("dry-run: report shows wouldSend (the send that WOULD happen, never a real network call)", report.wouldSend.length === 1, report.wouldSend);

// Real (non-dry-run) run against a DIFFERENT temp file DOES persist — proves dry-run is the
// exception, not that the worker is broken/never writes anything.
{
  const realMatchFile = join(tmp, "real_match_store.json");
  const realOutboxFile = join(tmp, "real_outbox.json");
  matchStore.getOrCreate("cdb2026:worker-real-test", clock, realMatchFile);
  matchStore.applyTransition("cdb2026:worker-real-test", "live", clock, realMatchFile);
  matchStore.applyTransition("cdb2026:worker-real-test", "final_pending_confirmation", clock, realMatchFile);
  matchStore.applyTransition("cdb2026:worker-real-test", "final_confirmed", clock, realMatchFile, { resultPayload: { homeScore: 2, awayScore: 2 } });
  let realSendCalled = false;
  const realSendFn = () => { realSendCalled = true; return { ok: true }; };
  runWorker({ dryRun: false, matchFile: realMatchFile, outboxFile: realOutboxFile, recipients, buildPayloadSnapshot, sendFn: realSendFn, clock });
  check("real (non-dry) run: outbox.json WAS created (proves dry-run's absence above is meaningful, not a broken worker)", existsSync(realOutboxFile), "real run didn't write anything");
  check("real (non-dry) run: sendFn WAS actually called", realSendCalled, "real run never called sendFn");
}

rmSync(tmp, { recursive: true, force: true });

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed.`);
if (pass !== results.length) {
  console.error(`✗ ${results.length - pass} check(s) FAILED`);
  process.exit(1);
}
console.log("✓ ALL NOTIFICATION WORKER DRY-RUN CHECKS PASSED");
process.exit(0);
