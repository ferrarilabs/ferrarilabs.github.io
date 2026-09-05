#!/usr/bin/env node
/**
 * fingerprint.mjs — deterministic Finding identity.
 *
 * A fingerprint is built ONLY from fields that identify the same underlying problem, never from
 * fields that describe one observation of it. No timestamp, no source SHA, no line number, no
 * workflow run ID — those change on every re-observation of the exact same problem, and including
 * any of them would mean every scan creates a new Issue instead of updating one (the "one Issue
 * per scan" failure this architecture exists to avoid). See the architecture doc's "Fingerprinting"
 * section for the full reasoning.
 */
import { createHash } from "node:crypto";

const REPO = "ferrarilabs/ferrarilabs.github.io";

function hash(parts) {
  return "sha256:" + createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

/**
 * CHANGE_INTENT Stale: identity is the repo + finding type + the declaration's own surface_id.
 * A surface_id is already a stable, unique identifier (assigned once, in critical_surfaces.json) —
 * no additional entropy needed.
 */
export function changeIntentStaleFingerprint(surfaceId) {
  return hash([REPO, "change_intent_stale", surfaceId]);
}

/**
 * Main CI Red: identity is repo + workflow name + job name — deliberately NOT the conclusion, the
 * run ID, the SHA, or any log text. Two different jobs failing on the same commit are two
 * different incidents (different fingerprints); the same job failing across many commits is the
 * SAME incident (one fingerprint, occurrence_count increments) until a confirmed green run closes
 * it — see writer.mjs's confirmed-recovery model.
 */
export function mainCiRedFingerprint(workflowName, jobName) {
  return hash([REPO, "main_ci_red", workflowName, jobName]);
}

/**
 * Live Deploy Drift: identidade e o repo + a FUNCAO. Deliberadamente NAO inclui o hash esperado —
 * se incluisse, cada commit em `main` mudaria o fingerprint e abriria uma Issue nova para o mesmo
 * incidente. Uma deriva que persiste por dias e o MESMO incidente: uma Issue, occurrence_count
 * subindo, ate producao voltar a bater.
 */
export function liveDeployDriftFingerprint(functionName) {
  return hash([REPO, "live_deploy_drift", functionName]);
}

/**
 * Migration Drift: identidade e o REPOSITORIO. Enquanto a mesma migracao nao aplicar e o MESMO
 * incidente — o pipeline esta parado, e nao importa quantas migracoes se acumulem atras dele. Se o
 * fingerprint carregasse as versoes pendentes, cada merge novo abriria uma Issue nova para a mesma
 * parada.
 */
export function migrationDriftFingerprint() {
  return hash([REPO, "migration_drift"]);
}

/**
 * CDB2026 Result Email Gap: identity is repo + finding type + the Python detector's own
 * `findingId` (`cdb2026:result-email-gap:<entityId>` — phase/tie/leg, already deliberately free of
 * timestamp, attempt or occurrence count; see detect_missed_result_emails.py's `finding_id()`).
 * The SAME gap persisting for days is ONE incident (one fingerprint, occurrence_count increments);
 * a gap on a different leg is a different incident. Nothing about the observation — the run, the
 * report's counts, the reason text — enters the identity.
 */
export function resultEmailGapFingerprint(findingId) {
  return hash([REPO, "cdb2026_result_email_gap", findingId]);
}

/**
 * Scheduler Stale (#405): identidade e o REPOSITORIO, e so. Nao inclui idade nem timestamp — se
 * incluisse, cada execucao do detector durante a mesma parada abriria uma Issue nova para o mesmo
 * incidente. Uma parada de agendamento que dura horas e UM incidente: uma Issue, occurrence_count
 * subindo, ate o cron voltar.
 */
export function schedulerStaleFingerprint() {
  return hash([REPO, "scheduler_stale"]);
}

/**
 * Phase Advance (#406): identidade e o PAR fase-ativa + sucessora. Quartas->Semifinal e um
 * incidente distinto de Semifinal->Final, e cada um se resolve por conta propria quando aquela
 * transicao acontece.
 */
export function phaseAdvanceFingerprint(activePhaseId, successorPhaseId) {
  return hash([REPO, "cdb2026_phase_advance", activePhaseId, successorPhaseId]);
}

export const REPOSITORY = REPO;
