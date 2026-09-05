#!/usr/bin/env node
/**
 * policy.mjs — the ONLY place a Finding's canonical fields get set.
 *
 * No AI in this vertical slice (CHANGE_INTENT Stale has no `suggested` block at all — see the
 * architecture doc: it's absent, not an error, whenever no Triage/AI pass ran). Every value below
 * is a deterministic rule-floor set once, in code, matching this repo's existing Project taxonomy
 * exactly — no new fields, no new options.
 *
 * The clamp function exists here even though this detector never receives an AI suggestion,
 * because policy.mjs is where EVERY future detector's clamp will live too — this is the one place
 * "AI may raise, never lower, below the rule floor" is enforced, structurally, for the whole
 * system, not per-detector.
 */

export const POLICY_VERSION = "1.0.0";

const SEVERITY_ORDER = ["None", "Low", "Medium", "High", "Critical"];
const PRIORITY_ORDER = ["P3 - Low", "P2 - Medium", "P1 - High", "P0 - Critical"];

function clampOrdered(order, floor, suggested) {
  if (!suggested) return floor;
  const floorIdx = order.indexOf(floor);
  const suggestedIdx = order.indexOf(suggested);
  if (suggestedIdx < 0) return floor; // unrecognized suggestion never wins
  return suggestedIdx > floorIdx ? suggested : floor; // AI may only raise, never lower
}

/** The one function every detector's canonical severity/priority must pass through. */
export function clampSeverity(floor, suggested) { return clampOrdered(SEVERITY_ORDER, floor, suggested); }
export function clampPriority(floor, suggested) { return clampOrdered(PRIORITY_ORDER, floor, suggested); }

/**
 * Rule-level defaults, keyed by detector_id. Adding a new detector means adding one entry here —
 * this is intentionally the single place a new detector's severity floor is decided, not scattered
 * per-detector logic.
 */
const RULE_DEFAULTS = {
  change_intent_stale: {
    severity: "Medium",
    priority: "P2 - Medium",
    work_type: "Governance / Drift",
    area: "Governance",
    environment: "Development",
    domain: "Shared Platform",
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    clean_cycles_to_resolve: 3,
  },
  live_deploy_drift: {
    severity: "High",
    priority: "P1 - High",
    work_type: "Infrastructure / Deploy",
    area: "Infrastructure / CI",
    // `Production` de proposito: o sintoma E o estado de producao, nao do repositorio.
    environment: "Production",
    domain: "Shared Platform",
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    // Uma leitura do header e um sinal binario e nao-flaky: ou o hash bate ou nao. Um unico ciclo
    // em que producao POSITIVAMENTE responde com o hash certo prova a recuperacao. Nunca inferido
    // de ausencia — UNKNOWN nao conta como ciclo limpo.
    clean_cycles_to_resolve: 1,
  },
  migration_drift: {
    severity: "High",
    priority: "P1 - High",
    work_type: "Infrastructure / Deploy",
    area: "Infrastructure / CI",
    environment: "Production",
    domain: "Shared Platform",
    // Le APENAS metadados de migracao. Nenhum dado de participante, pagamento ou scoring.
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    // "As migracoes do repo constam como aplicadas" e binario e nao-flaky. Um ciclo em que isso e
    // POSITIVAMENTE observado basta. UNKNOWN nunca conta como ciclo limpo.
    clean_cycles_to_resolve: 1,
  },
  scheduler_stale: {
    severity: "High",
    priority: "P1 - High",
    work_type: "Infrastructure / CI",
    area: "Infrastructure / CI",
    // `Production` de proposito: o sintoma e que a producao deixou de ser observada e notificada,
    // nao que o repositorio esta errado.
    environment: "Production",
    domain: "Shared Platform",
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    // Uma unica execucao agendada recente PROVA que a entrega voltou — o sinal e binario e nao
    // depende de acumular ciclos. Nunca inferido de ausencia.
    clean_cycles_to_resolve: 1,
  },
  cdb2026_phase_advance: {
    severity: "High",
    priority: "P1 - High",
    work_type: "Infrastructure / Deploy",
    area: "Infrastructure / CI",
    environment: "Production",
    domain: "CDB2026",
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    // A transicao acontecer (sucessora materializada) e prova positiva e imediata.
    clean_cycles_to_resolve: 1,
  },
  main_ci_red: {
    severity: "High",
    priority: "P1 - High",
    work_type: "Infrastructure / CI",
    area: "Infrastructure / CI",
    environment: "Development",
    domain: "Shared Platform",
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    // A CI conclusion is a binary, non-flaky signal (unlike "detector no longer observes X" in
    // general) — one confirmed green run is sufficient proof of recovery. See writer.mjs's
    // confirmed-recovery model: this is used only when a green run is POSITIVELY observed, never
    // merely inferred from absence.
    clean_cycles_to_resolve: 1,
  },
  cdb2026_result_email_gap: {
    severity: "High",
    priority: "P1 - High",
    work_type: "Infrastructure / CI",
    area: "Infrastructure / CI",
    environment: "Development",
    domain: "Shared Platform",
    // A missed RESULT NOTIFICATION does not change anyone's points or position — the ledger and the
    // scoring path are untouched by this detector, which is read-only and never sends anything.
    data_impact: "No",
    scoring_ranking_impact: "No",
    investigation_level: "I1",
    mutation_level: "M1",
    // Same reasoning as main_ci_red: recovery here is a POSITIVE observation (the very leg that was
    // a GAP is now classified HEALTHY by the same detector on the same ledger), never mere absence
    // from the report. One such confirmation is sufficient; see detectors/cdb2026_result_email_gap.mjs.
    clean_cycles_to_resolve: 1,
  },
};

/**
 * Builds the canonical block + authorization pair for a detector's raw finding. `suggested` is
 * optional and, for this vertical slice, always absent (no AI runs on this detector) — the clamp
 * functions handle its absence correctly (floor wins).
 */
export function applyPolicy(detectorId, suggested = {}) {
  const rule = RULE_DEFAULTS[detectorId];
  if (!rule) throw new Error(`policy.mjs: no rule defaults registered for detector_id "${detectorId}"`);

  return {
    canonical: {
      severity: clampSeverity(rule.severity, suggested.severity),
      priority: clampPriority(rule.priority, suggested.priority),
      work_type: rule.work_type,
      area: rule.area,
      environment: rule.environment,
      domain: rule.domain,
      data_impact: rule.data_impact,
      scoring_ranking_impact: rule.scoring_ranking_impact,
    },
    authorization: {
      investigation_level: rule.investigation_level,
      mutation_level: rule.mutation_level,
    },
  };
}

/** How many consecutive clean cycles this detector requires before auto-resolving a finding. */
export function cleanCyclesToResolve(detectorId) {
  const rule = RULE_DEFAULTS[detectorId];
  if (!rule) throw new Error(`policy.mjs: no rule defaults registered for detector_id "${detectorId}"`);
  return rule.clean_cycles_to_resolve;
}
