#!/usr/bin/env node
/**
 * result_email_gap_watch.mjs — the incident layer of the CDB2026 result-email watchdog (Issue #373).
 *
 * Consumes the JSON report produced by `bolao/cdb2026/scripts/detect_missed_result_emails.py --json`
 * and turns it into Sentinel incident state (one Issue per fingerprint, embedded state block) plus a
 * TRANSITION-AWARE exit code, so a persistent known gap stops failing every scheduled run.
 *
 * This process NEVER sends email, NEVER writes the notification ledger, and NEVER re-runs the
 * Python detector. Its only writes are to GitHub Issues.
 *
 *   exit 0  HEALTHY · GAP_STILL_OPEN · RECOVERED   (green; RECOVERED is announced, not failed)
 *   exit 1  GAP_DETECTED · UNKNOWN                 (a transition a human has not seen yet)
 *
 * Usage:
 *   node scripts/sentinel/result_email_gap_watch.mjs --report report.json [--dry-run]
 */
import { readFileSync } from "node:fs";
import { detectResultEmailGap, DETECTOR_ID, GAP_DETECTED, GAP_STILL_OPEN, RECOVERED, HEALTHY, UNKNOWN } from "./detectors/cdb2026_result_email_gap.mjs";
import { createRealGithubClient } from "./github_client.mjs";
import { upsertFinding, recordCleanCycleOrResolve } from "./writer.mjs";
import { parseStateBlock } from "./github_state.mjs";
import { createRunLogger } from "./audit_log.mjs";
import { cleanCyclesToResolve } from "./policy.mjs";

/** Open Sentinel Issues belonging to this detector, with the evidence hash of their last observation. */
export function readOpenIncidents(client) {
  const out = [];
  for (const issue of client.listSentinelIssues({ state: "open" })) {
    const state = parseStateBlock(issue.body);
    if (!state || state.detector_id !== DETECTOR_ID) continue;
    out.push({ fingerprint: state.fingerprint, evidence_hash: state.provenance?.evidence_hash ?? null, issueNumber: issue.number });
  }
  return out;
}

export function runWatch({ report, client = createRealGithubClient(), logger = createRunLogger(), dryRun = false } = {}) {
  const openIncidents = readOpenIncidents(client);
  const result = detectResultEmailGap({ report, openIncidents });
  const byFingerprint = new Map(result.transitions.filter((t) => t.fingerprint).map((t) => [t.fingerprint, t]));

  if (!dryRun) {
    // Every gap is upserted, including GAP_STILL_OPEN: detection and occurrence accounting are
    // never deduplicated — only the notification is.
    for (const finding of result.findings) upsertFinding(finding, client, logger);

    const threshold = cleanCyclesToResolve(DETECTOR_ID);
    for (const incident of openIncidents) {
      if (!result.confirmedRecoveries.has(incident.fingerprint)) continue;
      recordCleanCycleOrResolve({ number: incident.issueNumber }, client, logger, threshold);
    }
  }

  for (const t of result.transitions) {
    const issue = t.fingerprint ? openIncidents.find((i) => i.fingerprint === t.fingerprint)?.issueNumber : null;
    const ref = issue ? ` (incident #${issue})` : "";
    if (t.transition === GAP_DETECTED) {
      console.log(`::error title=CDB2026 result email ${t.changed ? "GAP CHANGED" : "GAP DETECTED"}::${t.findingId}${ref} — uma perna terminou sem entrega registrada no ledger. Incidente aberto/atualizado no Sentinel.`);
    } else if (t.transition === UNKNOWN) {
      console.log(`::error title=CDB2026 result email UNKNOWN::O ledger ou o estado nao pode ser lido. NENHUMA lacuna foi afirmada — isto NAO e um e-mail perdido, e NAO e saudavel.`);
    } else if (t.transition === GAP_STILL_OPEN) {
      console.log(`GAP_STILL_OPEN — ${t.findingId}${ref}: lacuna conhecida, evidencia inalterada. Incidente atualizado; sem nova notificacao (dedupe).`);
    } else if (t.transition === RECOVERED) {
      console.log(`::notice title=CDB2026 result email RECOVERED::${ref.trim() || t.fingerprint} — o detector leu o ledger e nao encontrou nenhuma lacuna. Incidente fechado.`);
    } else if (t.transition === HEALTHY) {
      console.log("HEALTHY — nenhuma lacuna, nenhum incidente aberto.");
    }
  }

  logger.log({ action: "result_email_gap_watch", overall: result.overall, transitions: result.transitions.map((t) => t.transition), exit_code: result.exitCode });
  return result;
}

if (process.argv[1] && process.argv[1].endsWith("result_email_gap_watch.mjs")) {
  const i = process.argv.indexOf("--report");
  if (i < 0 || !process.argv[i + 1]) {
    console.error("result_email_gap_watch: --report <path> is required");
    process.exit(1);
  }
  try {
    const report = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
    const result = runWatch({ report, dryRun: process.argv.includes("--dry-run") });
    process.exit(result.exitCode);
  } catch (e) {
    // A crash here is an operational failure of the monitor — it is never silently green.
    console.error(`result_email_gap_watch failed: ${e?.stack || e}`);
    process.exit(1);
  }
}
