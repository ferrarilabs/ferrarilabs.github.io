#!/usr/bin/env node
/**
 * run.mjs — Sentinel V1.0-A entrypoint.
 *
 * Normal execution: run each registered detector, upsert every finding it produces, and advance
 * the clean-cycle counter (or resolve) any open Sentinel Issue for that detector whose fingerprint
 * did NOT appear this run. This is the per-trigger pipeline (push/schedule/workflow_dispatch) —
 * distinct from reconcile.mjs, which repairs GitHub-side drift independent of any fresh detection.
 *
 * `--dry-run`: runs the detector, normalizes, fingerprints, and applies policy exactly as normal,
 * then only PRINTS the intended action (create / update-occurrence / resolve) using a real,
 * read-only lookup against current GitHub state — it never calls a mutating client method. This is
 * intentionally a separate, simpler code path from the live upsert algorithm, not a wrapped
 * version of it: mixing a placeholder "would-be" Issue into upsertFinding's own read-after-write
 * sequence would require the client to lie to itself, which is worse than just not calling it.
 *
 * Usage:
 *   node scripts/sentinel/run.mjs                 # live
 *   node scripts/sentinel/run.mjs --dry-run        # preview only, zero GitHub mutation
 */
import { detectChangeIntentStale, DETECTOR_ID as CHANGE_INTENT_STALE_ID } from "./detectors/change_intent_stale.mjs";
import { createRealGithubClient } from "./github_client.mjs";
import { upsertFinding, recordCleanCycleOrResolve } from "./writer.mjs";
import { parseStateBlock } from "./github_state.mjs";
import { createRunLogger } from "./audit_log.mjs";

// Registered v1.0-A detectors. Adding Main CI Red later means adding one entry here, one file
// under detectors/ — nothing else in this file changes.
const DETECTORS = [
  { id: CHANGE_INTENT_STALE_ID, run: detectChangeIntentStale },
];

function dryRunPreview(finding, client, logger) {
  const matches = client.searchSentinelIssues(finding.fingerprint);
  if (matches.length === 0) {
    logger.log({ action: "dry_run_preview", intent: "would_create_issue", fingerprint: finding.fingerprint, finding_type: finding.finding_type });
  } else {
    const issue = matches[0];
    const state = parseStateBlock(issue.body);
    logger.log({
      action: "dry_run_preview", intent: issue.state === "CLOSED" ? "would_reopen_as_recurrence" : "would_update_occurrence",
      fingerprint: finding.fingerprint, issue_number: issue.number,
      current_occurrence_count: state?.occurrence_count ?? null,
    });
  }
}

export function runOnce({ dryRun = false, client = createRealGithubClient(), logger = createRunLogger() } = {}) {
  const results = { findings: [], upserts: [], cleanCycles: [] };

  for (const detector of DETECTORS) {
    const findings = detector.run();
    logger.log({ action: "detector_ran", detector: detector.id, finding_count: findings.length });
    results.findings.push(...findings);

    const seenFingerprints = new Set(findings.map((f) => f.fingerprint));

    for (const finding of findings) {
      if (dryRun) { dryRunPreview(finding, client, logger); continue; }
      const outcome = upsertFinding(finding, client, logger);
      results.upserts.push(outcome);
    }

    // Clean-cycle / resolution pass: every OPEN Sentinel Issue for this detector whose fingerprint
    // wasn't in this run's output gets a clean cycle recorded (or resolved at the 3rd).
    if (!dryRun) {
      const open = client.listSentinelIssues({ state: "open" });
      for (const issue of open) {
        const state = parseStateBlock(issue.body);
        if (!state || state.detector_id !== detector.id) continue;
        if (seenFingerprints.has(state.fingerprint)) continue;
        const outcome = recordCleanCycleOrResolve(issue, client, logger);
        results.cleanCycles.push({ issue_number: issue.number, ...outcome });
      }
    } else {
      logger.log({ action: "dry_run_note", note: "clean-cycle/resolution pass skipped in dry-run — read-only preview only" });
    }
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  try {
    const results = runOnce({ dryRun });
    console.error(`\nSentinel run complete. findings=${results.findings.length} upserts=${results.upserts.length} clean_cycles=${results.cleanCycles.length}`);
    process.exit(0);
  } catch (e) {
    console.error(`Sentinel run failed: ${e?.stack || e}`);
    // Non-zero exit reports workflow failure, but Sentinel is never a required check (see
    // sentinel.yml / architecture "Failure Semantics") — ordinary development is unaffected.
    process.exit(1);
  }
}
