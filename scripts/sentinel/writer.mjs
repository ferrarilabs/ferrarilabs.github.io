#!/usr/bin/env node
/**
 * writer.mjs — the ONLY module that decides what GitHub mutation a Finding requires, and the
 * idempotent upsert algorithm itself.
 *
 * Correctness does NOT come from preventing concurrent writers (a GitHub Actions concurrency group
 * is applied at the workflow level as a courtesy, never relied on alone — see the architecture
 * doc's "Idempotent Upsert" section). Correctness comes from:
 *   1. every write being search-before-write (fingerprint-keyed), so a retried/duplicated call
 *      converges instead of duplicating;
 *   2. an explicit post-write re-search that catches the race a pure pre-write search can't
 *      prevent, and deterministically resolves it (oldest Issue wins, others marked Duplicate);
 *   3. read-back verification before any external write is considered successful — the embedded
 *      state comment is only updated AFTER GitHub's own state has been confirmed to match intent.
 */
import { validateFinding } from "./finding_schema.mjs";
import { SENTINEL_LABEL } from "./github_client.mjs";
import { upsertStateBlockInBody, parseStateBlock } from "./github_state.mjs";

const CLEAN_CYCLES_TO_RESOLVE = 3;

const CANONICAL_TO_PROJECT_FIELD = {
  severity: "Severity",
  priority: "Priority",
  work_type: "Work Type",
  area: "Area",
  environment: "Environment",
  domain: "Domain",
  data_impact: "Data Impact",
  scoring_ranking_impact: "Scoring / Ranking Impact",
};

function humanReadableTitle(finding) {
  const surfaceOrType = finding.affected_components?.find((c) => c !== "safety-contract") || finding.finding_type;
  return `[Sentinel] ${finding.finding_type.replace(/_/g, " ")}: ${surfaceOrType}`;
}

function humanReadableBody(finding) {
  const lines = [
    `Detected by Sentinel (\`${finding.detector_id}\` v${finding.detector_version}).`,
    "",
    "**Facts**",
    ...finding.facts.map((f) => `- ${f}`),
    "",
    "**Evidence**",
    ...finding.evidence.map((e) => `- ${e}`),
    "",
    `_This is a monitoring finding, not a manual report. Investigation authority: ` +
      `${finding.authorization.investigation_level}, mutation authority: ${finding.authorization.mutation_level} ` +
      `(Issue/Project metadata only — Sentinel does not modify code)._`,
  ];
  return lines.join("\n");
}

function nowIso() { return new Date().toISOString(); }

/** Deterministic canonical-duplicate selection: lowest Issue number (oldest) wins. */
export function selectCanonical(issues) {
  return [...issues].sort((a, b) => a.number - b.number)[0];
}

/**
 * Given the set of currently-open Sentinel Issues sharing one fingerprint, close every one except
 * the canonical (oldest) as a duplicate, linking back. Idempotent: re-running against an
 * already-resolved set is a no-op (nothing left to close).
 */
export function resolveDuplicates(matches, client, logger) {
  const open = matches.filter((i) => i.state === "OPEN");
  if (open.length <= 1) return selectCanonical(matches);
  const canonical = selectCanonical(open);
  for (const dup of open) {
    if (dup.number === canonical.number) continue;
    client.addComment(dup.number, `Duplicate of #${canonical.number} (same Sentinel fingerprint) — closing. Canonical Issue: #${canonical.number}.`);
    const dupItemId = client.ensureProjectItem(dup.nodeId ?? client.getIssue(dup.number).nodeId);
    client.setProjectFields(dupItemId, { Status: "Duplicate" });
    client.closeIssue(dup.number);
    logger?.log({ action: "duplicate_resolved", closed: dup.number, canonical: canonical.number });
  }
  return canonical;
}

/**
 * Step 8/9's human-override check: for each canonical field Sentinel is about to write, compare
 * GitHub's CURRENT value against what Sentinel itself last wrote (from the parsed embedded state).
 * A mismatch means something outside Sentinel changed it — skip that field, mark it overridden.
 */
function fieldsToWrite(finding, currentProjectFields, lastWrittenByField) {
  const toWrite = {};
  const overridden = {};
  for (const [canonicalKey, projectField] of Object.entries(CANONICAL_TO_PROJECT_FIELD)) {
    const desired = finding.canonical[canonicalKey];
    if (desired === undefined || desired === null) continue;
    const lastWritten = lastWrittenByField?.[canonicalKey];
    const current = currentProjectFields?.[projectField];
    const humanChangedIt = lastWritten !== undefined && current !== undefined && current !== lastWritten;
    if (humanChangedIt) { overridden[canonicalKey] = true; continue; }
    toWrite[projectField] = desired;
  }
  return { toWrite, overridden };
}

/**
 * The full idempotent upsert for one Finding. Returns the final Issue number and whether a
 * mutation actually occurred (for logging/tests), never throws on a business-logic outcome (only
 * on a truly unexpected client failure, which callers should let propagate to the run's own
 * bounded-retry wrapper).
 */
export function upsertFinding(finding, client, logger) {
  const { ok, errors } = validateFinding(finding);
  if (!ok) throw new Error(`writer.mjs refuses an invalid Finding: ${errors.join("; ")}`);

  // 2/3. search for an existing canonical Issue by fingerprint
  let matches = client.searchSentinelIssues(finding.fingerprint);
  let issue;

  if (matches.length === 0) {
    // 4. create
    client.ensureLabel(SENTINEL_LABEL);
    const body = upsertStateBlockInBody(humanReadableBody(finding), {
      fingerprint: finding.fingerprint,
      finding_type: finding.finding_type,
      detector_id: finding.detector_id,
      detector_version: finding.detector_version,
      first_seen_at: nowIso(),
      last_seen_at: nowIso(),
      occurrence_count: 0, // the unconditional increment below (shared by the new- and existing-issue paths) brings this to 1 — setting it to 1 here would double-count
      source_sha: finding.provenance.source_sha,
      policy_version: finding.provenance.policy_version,
      status: "ISSUE_OPEN",
      clean_cycle_count: 0,
      recurrence_count: 0,
      canonical_last_written: {},
      provenance: finding.provenance,
    });
    issue = client.createIssue({ title: humanReadableTitle(finding), body, labels: [SENTINEL_LABEL] });
    logger?.log({ action: "issue_created", fingerprint: finding.fingerprint, issue_number: issue.number });

    // 6. re-search AFTER create — this is the actual race-correctness step, not the pre-check above.
    matches = client.searchSentinelIssues(finding.fingerprint);
  }

  // 6/7. race handling: if more than one Issue now carries this fingerprint, converge to one.
  issue = matches.length > 1 ? resolveDuplicates(matches, client, logger) : (issue || matches[0]);

  // 5. read back
  issue = client.getIssue(issue.number);

  // update observation state (occurrence count, last_seen, possible recurrence)
  let state = parseStateBlock(issue.body) || {
    fingerprint: finding.fingerprint, occurrence_count: 0, clean_cycle_count: 0, recurrence_count: 0,
    canonical_last_written: {}, status: "ISSUE_OPEN",
  };
  const wasClosed = issue.state === "CLOSED";
  if (wasClosed) {
    client.reopenIssue(issue.number);
    state.recurrence_count = (state.recurrence_count || 0) + 1;
    client.addComment(issue.number, `Recurrence #${state.recurrence_count}: this finding's fingerprint was observed again after resolution. Reopening.`);
    logger?.log({ action: "recurrence", issue_number: issue.number, recurrence_count: state.recurrence_count });
  }
  state.occurrence_count = (state.occurrence_count || 0) + 1;
  state.last_seen_at = nowIso();
  state.source_sha = finding.provenance.source_sha;
  state.detector_version = finding.provenance.detector_version;
  // The state block records the LATEST observation's provenance, not the first one's. Issue #373:
  // cdb2026_result_email_gap compares the stored `provenance.evidence_hash` against the current
  // observation to tell "same problem, seen again" (deduplicate the notification) from "the problem
  // CHANGED" (surface it again). Freezing provenance at creation would make a changed finding
  // surface on every subsequent run forever, since the comparison would never converge. Every other
  // field here is already refreshed per observation; provenance was the inconsistent one.
  state.provenance = finding.provenance;
  state.clean_cycle_count = 0; // seen again this run — any resolution countdown resets
  state.status = "ISSUE_OPEN";
  // Durable CHECKPOINT: record what we INTEND to write before attempting the Project mutation, so
  // that if the process dies (or the mutation itself fails) between here and step 10, the intent
  // survives in the Issue body and reconcile.mjs can complete the write later — it has no other
  // way to know what "should" be set, since it never re-runs the detector/policy itself.
  state.intended_canonical = { ...finding.canonical };
  issue.body = upsertStateBlockInBody(issue.body, state);
  client.updateIssueBody(issue.number, issue.body);

  // 7. ensure Project membership
  const itemId = client.ensureProjectItem(issue.nodeId);

  // 8/9. set canonical fields, respecting human overrides; read back and verify
  const currentFields = client.getProjectFields(itemId);
  const { toWrite, overridden } = fieldsToWrite(finding, currentFields, state.canonical_last_written);
  if (Object.keys(toWrite).length > 0) client.setProjectFields(itemId, toWrite);
  const verified = client.getProjectFields(itemId);
  for (const [field, value] of Object.entries(toWrite)) {
    if (verified[field] !== value) {
      throw new Error(`writer.mjs: read-back mismatch on Project field "${field}" for issue #${issue.number} — expected "${value}", got "${verified[field]}"`);
    }
  }

  // 10. embedded state updated only now, after external state is confirmed
  state.canonical_last_written = { ...state.canonical_last_written, ...Object.fromEntries(
    Object.entries(CANONICAL_TO_PROJECT_FIELD)
      .filter(([, pf]) => toWrite[pf] !== undefined)
      .map(([ck]) => [ck, finding.canonical[ck]])
  ) };
  const newBody = upsertStateBlockInBody(issue.body, state);
  client.updateIssueBody(issue.number, newBody);

  logger?.log({
    action: "upsert_complete", issue_number: issue.number, fingerprint: finding.fingerprint,
    occurrence_count: state.occurrence_count, overridden_fields: Object.keys(overridden),
  });

  return { issueNumber: issue.number, itemId, occurrenceCount: state.occurrence_count, overriddenFields: Object.keys(overridden) };
}

/**
 * For a Sentinel-managed Issue whose fingerprint was NOT present in this run's detected findings:
 * advance its clean-cycle counter, or close it once `threshold` is reached. Idempotent per call
 * (one call = one cycle recorded); callers must call this at most once per scan.
 *
 * `threshold` defaults to CLEAN_CYCLES_TO_RESOLVE (3, CHANGE_INTENT Stale's value) but is
 * per-detector via policy.mjs's `cleanCyclesToResolve()` — Main CI Red uses 1, since a CI
 * conclusion is a binary, non-flaky signal unlike "detector no longer observes X" in general. This
 * function itself has no opinion about WHICH detector is calling it; the threshold is the caller's
 * decision, kept in the one place (policy.mjs) that already owns every other per-detector rule.
 */
export function recordCleanCycleOrResolve(issueRef, client, logger, threshold = CLEAN_CYCLES_TO_RESOLVE) {
  const issue = client.getIssue(issueRef.number); // always re-read: guarantees nodeId/body are current, never trusts a partial caller-supplied object
  if (issue.state !== "OPEN") return { action: "noop" };
  const state = parseStateBlock(issue.body);
  if (!state) {
    logger?.log({ action: "malformed_state_on_clean_cycle", issue_number: issue.number });
    return { action: "skipped_malformed_state" };
  }
  const cleanCycles = (state.clean_cycle_count || 0) + 1;
  if (cleanCycles < threshold) {
    state.clean_cycle_count = cleanCycles;
    client.updateIssueBody(issue.number, upsertStateBlockInBody(issue.body, state));
    logger?.log({ action: "clean_cycle_recorded", issue_number: issue.number, clean_cycle_count: cleanCycles });
    return { action: "clean_cycle_recorded", cleanCycles };
  }
  state.clean_cycle_count = cleanCycles;
  state.status = "RESOLVED";
  const withEvidence = upsertStateBlockInBody(issue.body, state);
  client.updateIssueBody(issue.number, withEvidence);
  client.addComment(issue.number, `Resolved: ${threshold} consecutive clean observation cycle(s) with no matching finding.`);
  client.setProjectFields(client.ensureProjectItem(issue.nodeId), { Status: "Done" });
  client.closeIssue(issue.number);
  logger?.log({ action: "resolved", issue_number: issue.number });
  return { action: "resolved" };
}

export { CLEAN_CYCLES_TO_RESOLVE, CANONICAL_TO_PROJECT_FIELD };
