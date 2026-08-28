#!/usr/bin/env node
/**
 * cdb2026_result_email_gap.mjs — Sentinel detector for the CDB2026 result-email watchdog (Issue #373).
 *
 * WHY THIS EXISTS
 * `bolao/cdb2026/scripts/detect_missed_result_emails.py` is correct and stays correct: it reads the
 * durable ledger and answers "a leg finished and no delivery was recorded?" What was wrong was the
 * SIGNAL. The watch workflow translated any GAP into `exit 1`, so ONE persistent, already-known gap
 * (`quartas:espn-atletico-mg_cruzeiro:first`) failed EVERY scheduled run, twice a day, forever, and
 * mailed a GitHub failure notice each time even though nothing had changed. A chronic alarm is a
 * silenced alarm — the exact failure mode the watchdog itself was built to prevent.
 *
 * This module converts the detector's report into the same transition/dedup model the Sentinel
 * pipeline monitor already uses, over the same state store (a Sentinel Issue's embedded state
 * block — see github_state.mjs). No second state store is invented here.
 *
 *   HEALTHY  →  GAP_DETECTED  →  GAP_STILL_OPEN  →  RECOVERED
 *
 *   GAP_DETECTED   first appearance of a fingerprint, OR the same fingerprint with CHANGED
 *                  evidence. Opens/updates one Issue AND surfaces (run fails).
 *   GAP_STILL_OPEN same fingerprint, byte-identical evidence, incident already open. The incident
 *                  is still updated (occurrence_count, last_seen_at) — it is the NOTIFICATION that
 *                  is deduplicated, never the detection.
 *   RECOVERED      positively confirmed, never inferred from absence (see below).
 *   HEALTHY        nothing open, nothing found.
 *
 * UNKNOWN IS NEVER DEDUPLICATED AND NEVER HEALTHY.
 * "The ledger could not be read" is an operational failure of the monitor, not a finding about
 * delivery. It opens no incident (asserting a gap from an outage is precisely the false-alarm the
 * Python detector refuses to make) and it always surfaces — it can never be silenced by this
 * module's dedupe, because it never enters the fingerprint path at all.
 *
 * RECOVERY IS POSITIVE, DELIBERATELY CONSERVATIVE.
 * The Python report only enumerates GAP/UNKNOWN findings; it does not list the HEALTHY entityIds.
 * So "this fingerprint is missing from this run's findings" is NOT accepted as recovery here — a
 * leg can also drop out of the expected set for reasons that are not a fix. Recovery is asserted
 * only when the detector read the ledger successfully and asserted the whole pool clean
 * (`overall === "HEALTHY"`, i.e. zero GAP and zero UNKNOWN). That can hold an incident open one
 * extra cycle when two gaps recover one at a time; holding a real incident open too long is a
 * cost this repo can pay, closing a real incident that was never fixed is not.
 *
 * READ-ONLY WITH RESPECT TO THE PIPELINE. This module never sends or re-sends an email, never
 * touches the notification ledger, and never imports a sender. It consumes an already-produced
 * JSON report and returns plain objects.
 */
import { createHash } from "node:crypto";
import { resultEmailGapFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "cdb2026_result_email_gap";
export const DETECTOR_VERSION = "1.0.0";
export const POOL = "cdb2026";

export const HEALTHY = "HEALTHY";
export const GAP_DETECTED = "GAP_DETECTED";
export const GAP_STILL_OPEN = "GAP_STILL_OPEN";
export const RECOVERED = "RECOVERED";
export const UNKNOWN = "UNKNOWN";

/** Transitions that must reach a human as a failed run. GAP_STILL_OPEN is deliberately absent. */
const SURFACED_AS_FAILURE = new Set([GAP_DETECTED, UNKNOWN]);

/**
 * The ONLY report fields allowed to shape an incident's identity-of-content or its Issue text.
 * An allowlist, not a denylist: a field this detector has never seen cannot leak into a public
 * GitHub Issue just because the Python side started emitting it. `entityId` is a fixture id
 * (phase/tie/leg) — never a recipient. No participant field is listed, and none may be added
 * without re-reading the PII rules in CLAUDE.md.
 */
const EVIDENCE_KEYS = ["state", "entityId", "phase", "leg", "kickoff", "reason"];

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/**
 * Identity-of-CONTENT for one finding: what would make this "a different problem worth waking
 * someone for" rather than "the same problem, observed again". Excludes every observation field
 * (run id, observed_at, the report's counts) for the same reason fingerprint.mjs excludes them.
 */
export function gapEvidenceHash(achado) {
  const material = {};
  for (const k of EVIDENCE_KEYS) {
    if (achado?.[k] !== undefined && achado?.[k] !== null) material[k] = String(achado[k]);
  }
  return hash(JSON.stringify(material));
}

/**
 * Pure transition classification for ONE gap finding. `prior` is the incident state already stored
 * in GitHub (`{ evidence_hash }`) or `null` when no incident is open for this fingerprint.
 */
export function classifyGapTransition(prior, evidenceHash) {
  if (!prior) return { transition: GAP_DETECTED, changed: false };
  if (prior.evidence_hash !== evidenceHash) return { transition: GAP_DETECTED, changed: true };
  return { transition: GAP_STILL_OPEN, changed: false };
}

function buildFinding(achado, fingerprint, evidenceHash, observedAt, sourceSha) {
  const { canonical, authorization } = applyPolicy(DETECTOR_ID);
  return makeFinding({
    finding_type: DETECTOR_ID,
    fingerprint,
    detector_id: DETECTOR_ID,
    detector_version: DETECTOR_VERSION,
    observed_at: observedAt,
    facts: [
      `CDB2026: leg "${achado.findingId}" has a saved result past the detector's grace window and NO delivery recorded in the durable ledger (bolao_notif_jobs, pool ${POOL}).`,
      `Detector reason: ${achado.reason}.`,
      `This is a MONITORING finding. No email was sent, re-sent, or queued, and the notification ledger was not modified — detect_missed_result_emails.py is read-only.`,
    ],
    evidence: [`findingId=${achado.findingId}`, `state=${achado.state}`, `pool=${POOL}`],
    canonical, authorization,
    provenance: {
      source_sha: sourceSha,
      detector_version: DETECTOR_VERSION,
      policy_version: POLICY_VERSION,
      config_hash: hash(JSON.stringify({ pool: POOL, evidenceKeys: EVIDENCE_KEYS })),
      evidence_hash: evidenceHash,
    },
    status: "DETECTED",
    affected_files: [],
    affected_components: [`cdb2026 result email`, achado.findingId],
    schema_version: SCHEMA_VERSION,
  });
}

/**
 * @param report          parsed JSON from `detect_missed_result_emails.py --json`
 * @param openIncidents   `[{ fingerprint, evidence_hash, issueNumber }]` — the Sentinel Issues
 *                        currently OPEN for this detector, read from their embedded state blocks.
 * @returns `{ findings, confirmedRecoveries, transitions, overall, exitCode }`
 *          `exitCode` 1 means "surface this run as a failure"; 0 means "green and quiet".
 */
export function detectResultEmailGap({
  report,
  openIncidents = [],
  observedAt = new Date().toISOString(),
  sourceSha = process.env.GITHUB_SHA || "unknown",
} = {}) {
  if (!report || typeof report !== "object") {
    throw new Error("cdb2026_result_email_gap: no report to classify — a missing report is an operational failure, never HEALTHY");
  }
  const priorByFingerprint = new Map(openIncidents.map((i) => [i.fingerprint, i]));
  const reported = Array.isArray(report.findings) ? report.findings : [];
  const findings = [];
  const transitions = [];
  const confirmedRecoveries = new Set();

  for (const achado of reported) {
    if (achado?.state === UNKNOWN) {
      // Never fingerprinted, never deduplicated, never an incident: it is the MONITOR that failed.
      transitions.push({ transition: UNKNOWN, findingId: achado.findingId ?? null, fingerprint: null, changed: false });
      continue;
    }
    if (achado?.state !== "GAP") continue; // HEALTHY/PRE_LEDGER never reach the report; ignore defensively
    const fingerprint = resultEmailGapFingerprint(achado.findingId);
    const evidenceHash = gapEvidenceHash(achado);
    const { transition, changed } = classifyGapTransition(priorByFingerprint.get(fingerprint) || null, evidenceHash);
    transitions.push({ transition, findingId: achado.findingId, fingerprint, changed });
    // The finding is emitted for EVERY gap, including GAP_STILL_OPEN: the incident must keep
    // accruing occurrence_count and last_seen_at. Only the NOTIFICATION is deduplicated.
    findings.push(buildFinding(achado, fingerprint, evidenceHash, observedAt, sourceSha));
  }

  // Positive recovery only — see the module header. `overall === HEALTHY` is the detector asserting
  // it READ the ledger and found zero gaps and zero unknowns; UNKNOWN can never reach this branch.
  if (report.overall === HEALTHY) {
    for (const incident of openIncidents) {
      confirmedRecoveries.add(incident.fingerprint);
      transitions.push({ transition: RECOVERED, findingId: null, fingerprint: incident.fingerprint, changed: false });
    }
    if (openIncidents.length === 0) {
      transitions.push({ transition: HEALTHY, findingId: null, fingerprint: null, changed: false });
    }
  }

  const exitCode = transitions.some((t) => SURFACED_AS_FAILURE.has(t.transition)) ? 1 : 0;
  return { findings, confirmedRecoveries, transitions, overall: report.overall ?? null, exitCode };
}

export const REPO = REPOSITORY;
export { SURFACED_AS_FAILURE, EVIDENCE_KEYS };
