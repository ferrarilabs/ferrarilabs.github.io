#!/usr/bin/env node
/**
 * reconcile.mjs — the daily drift-repair sweep.
 *
 * M1 only: it never touches code, branches, or files. GitHub is both desired state and observed
 * state — there is exactly one source of truth. The embedded state comment is a cache of what
 * Sentinel itself last wrote, used only to detect drift, never a competing ground truth. This
 * module does NOT re-run detectors; it only restores consistency between an Issue and its Project
 * item for Issues that already exist. Detecting *new* findings (and the clean-cycle/resolution
 * path) is run.mjs's job, called every trigger; this is the backstop for whatever a writer run
 * might have left half-done.
 *
 * Independently runnable: `node scripts/sentinel/reconcile.mjs [--dry-run]`.
 */
import { parseStateBlock, upsertStateBlockInBody } from "./github_state.mjs";
import { resolveDuplicates, CANONICAL_TO_PROJECT_FIELD } from "./writer.mjs";
import { createRealGithubClient } from "./github_client.mjs";
import { createRunLogger } from "./audit_log.mjs";

/**
 * One full reconciliation pass. Returns a summary of repairs made (or, in dry-run, that WOULD be
 * made) — never throws on a single Issue's problem; one bad Issue doesn't stop the sweep for the
 * rest.
 */
export function reconcile(client, { dryRun = false, logger } = {}) {
  const summary = { rebuilt_state: [], project_item_created: [], fields_repaired: [], duplicates_resolved: [], errors: [] };
  const issues = client.listSentinelIssues({ state: "open" });

  // ── duplicate detection across the WHOLE open sentinel-managed set, not just this run's finding ──
  const byFingerprint = new Map();
  for (const issue of issues) {
    const state = parseStateBlock(issue.body);
    const fp = state?.fingerprint;
    if (!fp) continue; // malformed handled below, separately — a fingerprint-less issue can't be grouped
    if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
    byFingerprint.get(fp).push(issue);
  }
  for (const [fp, group] of byFingerprint) {
    if (group.length <= 1) continue;
    if (dryRun) { summary.duplicates_resolved.push({ fingerprint: fp, count: group.length, dryRun: true }); continue; }
    const canonical = resolveDuplicates(group, client, logger);
    summary.duplicates_resolved.push({ fingerprint: fp, canonical: canonical.number, count: group.length });
  }

  for (const issue of issues) {
    try {
      repairOne(issue, client, { dryRun, logger, summary });
    } catch (e) {
      summary.errors.push({ issue_number: issue.number, error: String(e?.message || e) });
      logger?.log({ action: "reconcile_error", issue_number: issue.number, error: String(e?.message || e) });
    }
  }
  return summary;
}

function repairOne(issueRef, client, { dryRun, logger, summary }) {
  const issue = client.getIssue(issueRef.number);
  let state = parseStateBlock(issue.body);

  if (!state) {
    // malformed or missing — rebuild from observable GitHub truth rather than crash or leave unmanaged
    if (dryRun) { summary.rebuilt_state.push({ issue_number: issue.number, dryRun: true }); return; }
    state = {
      fingerprint: null, finding_type: "unknown", detector_id: "unknown", detector_version: "unknown",
      first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
      occurrence_count: 1, clean_cycle_count: 0, recurrence_count: 0, canonical_last_written: {},
      status: issue.state === "OPEN" ? "ISSUE_OPEN" : "RESOLVED",
    };
    client.updateIssueBody(issue.number, upsertStateBlockInBody(issue.body, state));
    summary.rebuilt_state.push({ issue_number: issue.number });
    logger?.log({ action: "state_rebuilt", issue_number: issue.number });
    return; // one repair per pass per issue — next sweep continues from the now-valid state
  }

  // Project item existence + field completeness, checked against `intended_canonical` — the
  // durable checkpoint writer.mjs records BEFORE attempting the Project mutation (see writer.mjs's
  // own comment on this). This is what makes "Issue created, Project write failed" repairable:
  // reconcile never re-runs the detector/policy, so intended_canonical is the only record of what
  // SHOULD be set. `canonical_last_written` (what's CONFIRMED already correct) is used only to
  // detect a human override, exactly like writer.mjs's own fieldsToWrite().
  const desired = state.intended_canonical || {};
  if (Object.keys(desired).length === 0) return;

  if (dryRun) {
    summary.project_item_created.push({ issue_number: issue.number, dryRun: true });
    return;
  }

  const itemId = client.ensureProjectItem(issue.nodeId);
  const current = client.getProjectFields(itemId);
  const missing = {};
  for (const [canonicalKey, value] of Object.entries(desired)) {
    const projectField = CANONICAL_TO_PROJECT_FIELD[canonicalKey];
    if (!projectField) continue;
    if (current[projectField] === undefined || current[projectField] === null) missing[projectField] = value;
  }
  if (Object.keys(missing).length > 0) {
    client.setProjectFields(itemId, missing);
    const verified = client.getProjectFields(itemId);
    for (const [field, value] of Object.entries(missing)) {
      if (verified[field] !== value) throw new Error(`reconcile: read-back mismatch repairing "${field}" on issue #${issue.number}`);
    }
    summary.fields_repaired.push({ issue_number: issue.number, fields: Object.keys(missing) });
    logger?.log({ action: "fields_repaired", issue_number: issue.number, fields: Object.keys(missing) });
  }
}

if (process.argv[1] && process.argv[1].endsWith("reconcile.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  const logger = createRunLogger();
  try {
    const summary = reconcile(createRealGithubClient(), { dryRun, logger });
    logger.log({ action: "reconcile_summary", dry_run: dryRun, ...summary });
    console.error(`\nReconciliation complete (dry_run=${dryRun}). ` +
      `rebuilt_state=${summary.rebuilt_state.length} fields_repaired=${summary.fields_repaired.length} ` +
      `duplicates_resolved=${summary.duplicates_resolved.length} errors=${summary.errors.length}`);
    process.exit(summary.errors.length > 0 ? 1 : 0);
  } catch (e) {
    console.error(`Reconciliation failed: ${e?.stack || e}`);
    process.exit(1); // reported, never a required check — see sentinel.yml's own comment
  }
}
