#!/usr/bin/env node
/**
 * cdb2026_phase_advance.mjs — a fase ativa acabou e a seguinte nunca foi materializada (#406)
 *
 * ─── O DEFEITO QUE ISTO TORNA VISÍVEL ───────────────────────────────────────────────────────
 *
 * `_find_new_legs()` (send_result_email.py) varre SOMENTE `state.espnSync.activePhaseId`. E
 * `activePhaseId` não avança sozinho: é gravado apenas por mutação explícita de admin
 * (`app.js:1560`); o caminho de seed (`:5100`) só atribui quando o campo está `null`.
 *
 * Estado real medido em 2026-09-05:
 *
 *     activePhaseId = quartas
 *     quartas   : 4 ties, 0 pernas sem placar        <- fase COMPLETA
 *     semifinal : 0 ties, topologia oficial presente
 *
 * Ou seja: quando a semifinal for jogada, o `--auto` varre uma fase concluída, não acha nada e não
 * envia nada — em silêncio, indefinidamente, com o cron perfeitamente saudável. E o silêncio é
 * idêntico ao de "ainda não houve resultado".
 *
 * Isto é INDEPENDENTE do #396. Cron saudável é necessário, não suficiente. O #396 expôs; esta
 * falha existiria de qualquer forma.
 *
 * ─── A CONDIÇÃO, E O QUE ELA DELIBERADAMENTE NÃO É ──────────────────────────────────────────
 *
 * Alerta somente quando TODAS valem:
 *
 *   1. existe `activePhaseId`;
 *   2. a fase ativa está INTEIRAMENTE decidida (todo confronto com `qualifiedTeamId`, toda perna
 *      com placar) — uma fase pela metade é operação normal;
 *   3. existe uma fase sucessora com TOPOLOGIA AUTORITATIVA registrada;
 *   4. essa sucessora tem ZERO ties materializados.
 *
 * `data/horário ainda não divulgados` NÃO faz parte da condição, e isso é o ponto mais importante
 * deste arquivo. Confronto conhecido sem kickoff é estado NORMAL e saudável do produto — é
 * exatamente o caso da #395, em que a semifinal aparece como "Vencedor de X × Y" ou já com os dois
 * clubes, aguardando a CBF publicar a tabela. Um detector que confundisse as duas coisas ia gritar
 * durante a janela legítima entre "fase decidida" e "tabela publicada", e um alarme que toca em
 * operação normal é um alarme que se aprende a ignorar — foi assim que o Sentinel chegou vermelho
 * ao #396. Este detector olha MATERIALIZAÇÃO DE CONFRONTO, nunca presença de data.
 *
 * Item 3 também importa: sem topologia autoritativa não há o que materializar, e cobrar
 * materialização seria pedir para inventar chaveamento. Sucessora sem topologia ⇒ silêncio.
 *
 * NÃO INVENTA NADA: nem time, nem data, nem local, nem transmissão, nem topologia. Só lê o estado
 * autoritativo que o CDB2026 já usa e compara com ele mesmo.
 *
 * READ-ONLY. Não escreve estado, não avança fase, não manda e-mail. Avançar a fase tocaria regra
 * de torneio e exige autorização própria do Eduardo — este detector só torna o buraco visível.
 */
import { createHash } from "node:crypto";
import { phaseAdvanceFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "cdb2026_phase_advance";
export const DETECTOR_VERSION = "1.0.0";

/** Ordem oficial do mata-mata. Sucessora = a próxima nesta lista que tenha topologia registrada. */
export const PHASE_ORDER = [
  "fase-1", "fase-2", "fase-3", "fase-4", "fase-5", "oitavas", "quartas", "semifinal", "final",
];

export const HEALTHY = "HEALTHY";
export const SUCCESSOR_NOT_MATERIALIZED = "SUCCESSOR_NOT_MATERIALIZED";
export const UNKNOWN = "UNKNOWN";

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/** Topologia é autoritativa quando tem slots E proveniência validada — mesma regra do app. */
export function hasAuthoritativeTopology(phase) {
  const t = phase && phase.topology;
  if (!t || !t.slots || Object.keys(t.slots).length === 0) return false;
  const p = t.provenance;
  return !!(p && p.authority === "CBF" && p.validatedAt);
}

/** Uma fase está inteiramente decidida quando todo tie tem vencedor e toda perna tem placar. */
export function isPhaseFullyDecided(phase) {
  const ties = Object.values((phase && phase.ties) || {});
  if (ties.length === 0) return false;                       // fase vazia não é "decidida"
  for (const t of ties) {
    if (!t.qualifiedTeamId) return false;
    for (const m of Object.values(t.matches || {})) {
      if (m && m.goalsHome === null || m && m.goalsHome === undefined) return false;
    }
  }
  return true;
}

/**
 * Classificação PURA sobre o documento de estado do CDB2026. Sem I/O.
 */
export function classifyPhaseAdvance(state) {
  const phases = (state && state.phases) || {};
  const activeId = state && state.espnSync && state.espnSync.activePhaseId;
  if (!activeId) return { state: UNKNOWN, reason: "sem activePhaseId no estado" };
  const active = phases[activeId];
  if (!active) return { state: UNKNOWN, reason: `fase ativa "${activeId}" nao existe no estado` };

  if (!isPhaseFullyDecided(active)) {
    return { state: HEALTHY, activePhaseId: activeId, reason: "fase ativa ainda nao esta inteiramente decidida" };
  }

  const idx = PHASE_ORDER.indexOf(activeId);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) {
    return { state: HEALTHY, activePhaseId: activeId, reason: "nao ha fase sucessora no chaveamento" };
  }

  for (const nextId of PHASE_ORDER.slice(idx + 1)) {
    const next = phases[nextId];
    if (!next) continue;
    if (!hasAuthoritativeTopology(next)) {
      // Sem topologia oficial nao ha o que materializar — cobrar seria pedir para inventar
      // chaveamento. Silencio e a resposta certa.
      return {
        state: HEALTHY, activePhaseId: activeId, successorPhaseId: nextId,
        reason: `sucessora "${nextId}" ainda nao tem topologia autoritativa`,
      };
    }
    const ties = Object.keys(next.ties || {});
    if (ties.length > 0) {
      return {
        state: HEALTHY, activePhaseId: activeId, successorPhaseId: nextId,
        reason: `sucessora "${nextId}" ja tem ${ties.length} confronto(s) materializado(s)`,
      };
    }
    return {
      state: SUCCESSOR_NOT_MATERIALIZED,
      activePhaseId: activeId,
      successorPhaseId: nextId,
      successorSlots: Object.keys(next.topology.slots).length,
      reason: `fase ativa "${activeId}" inteiramente decidida e sucessora "${nextId}" tem topologia `
        + "autoritativa mas nenhum confronto materializado",
    };
  }
  return { state: HEALTHY, activePhaseId: activeId, reason: "nenhuma fase sucessora presente no estado" };
}

/**
 * @param {{fetchState: () => object}} deps  leitura injetada — nunca alcança a rede daqui
 */
export function detectCdb2026PhaseAdvance({ fetchState, now = new Date() } = {}) {
  let state;
  try {
    state = fetchState();
  } catch (e) {
    // Nao conseguir LER nunca vira "esta quebrado".
    return { findings: [], confirmedRecoveries: new Set(), unknown: `nao foi possivel ler o estado: ${String(e?.message || e)}` };
  }

  const c = classifyPhaseAdvance(state);
  if (c.state !== SUCCESSOR_NOT_MATERIALIZED) {
    return { findings: [], confirmedRecoveries: new Set(), evidence: c };
  }

  const { canonical, authorization } = applyPolicy(DETECTOR_ID);
  const finding = makeFinding({
    finding_type: DETECTOR_ID,
    fingerprint: phaseAdvanceFingerprint(c.activePhaseId, c.successorPhaseId),
    detector_id: DETECTOR_ID,
    detector_version: DETECTOR_VERSION,
    observed_at: now.toISOString(),
    facts: [
      `Fase ativa "${c.activePhaseId}" esta inteiramente decidida (todo confronto com vencedor, toda perna com placar).`,
      `Sucessora "${c.successorPhaseId}" tem topologia autoritativa (${c.successorSlots} vaga(s)) e ZERO confrontos materializados.`,
      "`_find_new_legs()` varre somente `espnSync.activePhaseId`, e `activePhaseId` nao avanca "
      + "sozinho (so por mutacao explicita de admin). Enquanto isso valer, o resultado da proxima "
      + "fase NAO sera descoberto nem notificado — em silencio, com o cron saudavel.",
      "Isto NAO e o caso legitimo de 'confronto conhecido sem data/horario oficial' (#395): a "
      + "condicao aqui e ausencia de CONFRONTO MATERIALIZADO, nunca ausencia de kickoff.",
    ],
    evidence: [
      `active_phase=${c.activePhaseId}`,
      `successor_phase=${c.successorPhaseId}`,
      `successor_topology_slots=${c.successorSlots}`,
      "successor_materialized_ties=0",
    ],
    canonical, authorization,
    provenance: {
      source_sha: null,
      detector_version: DETECTOR_VERSION,
      policy_version: POLICY_VERSION,
      config_hash: hash(JSON.stringify({ phaseOrder: PHASE_ORDER })),
      evidence_hash: hash(JSON.stringify({ active: c.activePhaseId, successor: c.successorPhaseId })),
    },
    status: "DETECTED",
    affected_files: [],
    affected_components: ["cdb2026", c.activePhaseId, c.successorPhaseId],
    schema_version: SCHEMA_VERSION,
  });

  return { findings: [finding], confirmedRecoveries: new Set(), evidence: c };
}

export const REPO = REPOSITORY;
