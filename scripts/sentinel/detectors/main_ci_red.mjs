#!/usr/bin/env node
/**
 * main_ci_red.mjs — Sentinel detector for the canonical Safety check workflow on `main`.
 *
 * Deliberately conservative (see docs/bolao/sentinel/README.md "V1.0-B" and the architecture's own
 * note that CI-failure fingerprinting is the hardest problem in the catalog — this is the second
 * attempt, not the first, and stays at workflow+job granularity, not inside verify.mjs's own
 * check IDs; see "Known scope decision" below).
 *
 * WHY THIS EXISTS: a cron/workflow that stops running is silent — no red run, no alert, nothing.
 * A workflow that starts FAILING repeatedly is the opposite problem: loud on GitHub, invisible to
 * anyone not actively watching the Actions tab. This detector makes "main's own safety net is
 * currently red" a durable, deduplicated fact instead of something only visible to whoever happens
 * to check.
 *
 * READ-ONLY. Never re-runs, cancels, or dispatches a workflow.
 */
import { createHash } from "node:crypto";
import { mainCiRedFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "main_ci_red";
export const DETECTOR_VERSION = "1.0.0";
export const MONITORED_WORKFLOW = "Safety check";
export const MONITORED_BRANCH = "main";

// A run stuck queued/in_progress this long past a normal duration (this workflow's own 45-minute
// timeout, plus buffer for legitimate long browser-suite runs already observed taking ~20min) is
// STALE, not merely IN_PROGRESS — a hung run is exactly the "CI hangs" failure mode the
// architecture's FMEA named.
export const STALE_THRESHOLD_MINUTES = 90;

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/**
 * Pure classification: GitHub's actual status/conclusion vocabulary -> the 9-value taxonomy this
 * detector is required to distinguish. No I/O, no side effects — the whole point is that this can
 * be unit-tested against every real value GitHub can return without a network call.
 */
export function classifyRun(run, { now = new Date(), staleThresholdMinutes = STALE_THRESHOLD_MINUTES } = {}) {
  if (!run) return "UNKNOWN";
  if (run.status !== "completed") {
    const ageMinutes = (now.getTime() - new Date(run.createdAt).getTime()) / 60000;
    return ageMinutes > staleThresholdMinutes ? "STALE" : "IN_PROGRESS";
  }
  switch (run.conclusion) {
    case "success": return "SUCCESS";
    case "failure": return "FAILURE";
    case "cancelled": return "CANCELLED";
    case "timed_out": return "TIMED_OUT";
    case "action_required": return "ACTION_REQUIRED";
    case "skipped": return "SKIPPED_INTENTIONAL";
    case "neutral": return "SKIPPED_INTENTIONAL";
    case "stale": return "STALE"; // GitHub's own rarely-used conclusion value for very old runs
    default: return "UNKNOWN";
  }
}

// Classifications that mean "CI did NOT confirm main is safe" -> a Finding.
const RED_CLASSIFICATIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STALE", "UNKNOWN"]);
// The only classification that counts as confirmed recovery (see writer.mjs's confirmed-recovery
// model) — CANCELLED, IN_PROGRESS, SKIPPED_INTENTIONAL are all "no signal," never "resolved."
const RECOVERED_CLASSIFICATION = "SUCCESS";

/**
 * `fetchLatestRuns(workflowName, branch)` must return an array of `{ headSha, createdAt, status,
 * conclusion, jobs: [{ name, conclusion }] }`, most-recent first — this is the one function that
 * touches GitHub; everything else here is pure. Tests inject a fixture function instead of the
 * real client.
 *
 * Returns `{ findings, confirmedRecoveries }` — see writer.mjs for why this detector's result
 * shape differs from detectChangeIntentStale's plain array: recovery here requires a POSITIVE
 * confirmed-green signal, not mere absence, and run.mjs's orchestration branches on that.
 */
export function detectMainCiRed({
  observedAt = new Date().toISOString(),
  fetchLatestRuns,
  now = new Date(),
} = {}) {
  const runs = fetchLatestRuns(MONITORED_WORKFLOW, MONITORED_BRANCH);
  const latest = runs?.[0];
  const findings = [];
  const confirmedRecoveries = new Set();

  if (!latest) return { findings, confirmedRecoveries }; // no signal at all — fail open, no finding

  const jobs = latest.jobs && latest.jobs.length > 0 ? latest.jobs : [{ name: MONITORED_WORKFLOW }];

  for (const job of jobs) {
    const classification = classifyRun(latest, { now });
    const fingerprint = mainCiRedFingerprint(MONITORED_WORKFLOW, job.name);

    if (classification === RECOVERED_CLASSIFICATION) {
      confirmedRecoveries.add(fingerprint);
      continue;
    }
    if (!RED_CLASSIFICATIONS.has(classification)) continue; // CANCELLED / IN_PROGRESS / SKIPPED_INTENTIONAL — no signal either way

    const { canonical, authorization } = applyPolicy(DETECTOR_ID);
    findings.push(makeFinding({
      finding_type: DETECTOR_ID,
      fingerprint,
      detector_id: DETECTOR_ID,
      detector_version: DETECTOR_VERSION,
      observed_at: observedAt,
      facts: [
        `Workflow "${MONITORED_WORKFLOW}" job "${job.name}" on branch "${MONITORED_BRANCH}" classified ${classification}.`,
        `Latest run: status=${latest.status}, conclusion=${latest.conclusion ?? "(none)"}, headSha=${latest.headSha}.`,
      ],
      evidence: [`workflow=${MONITORED_WORKFLOW}`, `job=${job.name}`, `classification=${classification}`],
      canonical, authorization,
      provenance: {
        source_sha: latest.headSha,
        detector_version: DETECTOR_VERSION,
        policy_version: POLICY_VERSION,
        config_hash: hash(JSON.stringify({ workflow: MONITORED_WORKFLOW, branch: MONITORED_BRANCH, staleThresholdMinutes: STALE_THRESHOLD_MINUTES })),
        evidence_hash: hash(JSON.stringify({ headSha: latest.headSha, job: job.name, classification })),
      },
      status: "DETECTED",
      affected_files: [],
      affected_components: [MONITORED_WORKFLOW, job.name],
      schema_version: SCHEMA_VERSION,
    }));
  }

  return { findings, confirmedRecoveries };
}

export const REPO = REPOSITORY;
