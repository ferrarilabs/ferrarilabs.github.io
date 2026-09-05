#!/usr/bin/env node
/**
 * scheduler_stale.mjs — o agendador do GitHub parou de entregar? (#405)
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────────────────────
 *
 * Entre 2026-09-02T23:55:51Z e 2026-09-04T20:50:48Z (~45 h) o GitHub simplesmente parou de
 * entregar eventos `schedule` neste repositório. Runs agendados por dia: 09-01 → 25, 09-02 → 55,
 * **09-03 → 0**, 09-04 → 15.
 *
 * 09-03 é o dia do Grêmio × Internacional. O resultado não foi capturado, o e-mail de resultado
 * não saiu, e NADA avisou — porque `push`, `pull_request` e `workflow_dispatch` continuaram
 * funcionando o tempo todo. O CI dos PRs ficava verde enquanto o produto estava cego (#396).
 *
 * Nenhuma causa foi encontrada do lado do repositório: 32 workflows `active`, Actions `enabled`,
 * repo público e não arquivado, `default_branch` inalterado, cron do sender sem edição desde
 * 2026-08-12. A entrega voltou sozinha. É falha externa — não dá para impedir. Dá para PERCEBER.
 *
 * ─── O QUE FAZ UM VERDE FALSO, E COMO ISTO O EVITA ──────────────────────────────────────────
 *
 * Só conta execução com `event === "schedule"`. Durante a #396 o produtor de cache ao vivo rodava
 * a cada 5 minutos — mas por `workflow_dispatch` da Cloudflare, não por cron. Quem olhasse "tem
 * run recente?" veria atividade contínua e concluiria que estava tudo bem. `workflow_dispatch`,
 * `push`, `repository_dispatch` e qualquer outro gatilho são explicitamente descartados.
 *
 * ─── O LIMIAR: 6 h, MEDIDO, NÃO ESCOLHIDO ───────────────────────────────────────────────────
 *
 * A proposta inicial era 3 h. Os dados reais a REFUTARAM. Medindo os intervalos entre execuções
 * agendadas consecutivas nas ~200 mais recentes (2026-08-30 → 2026-09-05):
 *
 *     44.92 h   2026-09-02 23:55Z → 2026-09-04 20:50Z   <- a janela do #396
 *      3.12 h   2026-08-31 01:46Z → 2026-08-31 04:53Z   <- operação NORMAL
 *      2.75 h   2026-09-05 00:51Z → 2026-09-05 03:36Z
 *      2.68 h / 2.37 h / 2.18 h                          <- também normais
 *
 * O maior intervalo SAUDÁVEL observado é 3.12 h. Um limiar de 3 h teria disparado alarme falso em
 * 2026-08-31, com o repositório perfeitamente saudável — e um detector que grita em operação
 * normal é um detector que se aprende a ignorar, que é exatamente como o Sentinel chegou vermelho
 * ao #396.
 *
 * A separação entre saudável (≤3.12 h) e patológico (44.92 h) é enorme, então há muito espaço:
 * 6 h dá ~1.9× de folga sobre o pior intervalo saudável medido e ainda teria disparado por volta
 * de 2026-09-03T06:00Z — cerca de 17 horas ANTES do apito do Gre-Nal (23:00Z). Tempo de sobra.
 *
 * A cobertura de cron é contínua: `cdb2026_entry_saved_confirmation` roda de 5 em 5 minutos, 24/7,
 * sem porta de hora, e `live_pipeline_monitor` roda de hora em hora. Ou seja, num repositório saudável
 * SEMPRE há trabalho agendado de sobra dentro de qualquer janela de 6 h — o limiar não depende de
 * nenhum cron sazonal (`auto_results` é `* 6-7 *`, junho–julho, e por isso não conta).
 *
 * ─── LIMITAÇÃO ASSUMIDA ─────────────────────────────────────────────────────────────────────
 *
 * Este detector roda NO PRÓPRIO agendador que vigia. Numa parada total ele atrasa junto: encurta
 * a janela cega de ~45 h para a ordem do limiar, mas não a elimina. A eliminação exige gatilho
 * externo (o Worker da Cloudflare já provou entregar DURANTE a #396) — decisão separada,
 * deliberadamente fora daqui. Este arquivo não deve dar a impressão de garantir o que não garante.
 *
 * READ-ONLY. Nunca dispara, cancela ou re-executa workflow nenhum.
 */
import { createHash } from "node:crypto";
import { schedulerStaleFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

export const DETECTOR_ID = "scheduler_stale";
export const DETECTOR_VERSION = "1.0.0";

/** Ver o bloco "O LIMIAR" acima: medido contra intervalos reais, não escolhido por intuição. */
export const STALE_THRESHOLD_HOURS = 6;

export const FRESH = "FRESH";
export const STALE = "STALE";
export const NO_SCHEDULED_RUN = "NO_SCHEDULED_RUN";
export const UNKNOWN = "UNKNOWN";

/**
 * Classificação PURA. Sem I/O — dá para exercitar cada caso sem tocar a rede.
 *
 * `runs` é a lista bruta como o cliente devolve; a filtragem por `event` acontece AQUI, de
 * propósito: se ela morasse no cliente, um cliente novo (ou um teste) poderia entregar runs de
 * outro gatilho e o detector ficaria verde sem saber. A regra que evita o verde falso tem de
 * viver junto da decisão.
 */
export function classifyScheduler(runs, { now = new Date(), thresholdHours = STALE_THRESHOLD_HOURS } = {}) {
  const todos = (runs || []).filter((r) => r && r.createdAt);
  const agendados = todos.filter((r) => r.event === "schedule");

  if (agendados.length === 0) {
    // AUSENCIA NAO E EVIDENCIA. Uma amostra vazia significa "nao medi", nao "o cron parou" — e o
    // gate de aceitacao pegou exatamente isso: com um cliente vazio o detector acusava parada.
    //
    // Mesmo com runs na amostra, a ausencia de `schedule` so PROVA alguma coisa se a amostra
    // COBRIR uma janela maior que o limiar. Este repo faz ~288 dispatches/dia so do produtor de
    // cache ao vivo: uma amostra de 200 runs pode abranger poucas horas de dispatch e nao conter
    // nenhum `schedule` com tudo perfeitamente saudavel. Acusar ali seria alarme falso garantido.
    const instantes = todos.map((r) => new Date(r.createdAt).getTime()).filter(Number.isFinite);
    const janelaH = instantes.length ? (Math.max(...instantes) - Math.min(...instantes)) / 3600000 : 0;
    if (janelaH < thresholdHours) {
      return { state: UNKNOWN, newestAt: null, ageHours: null, thresholdHours,
               consideredRuns: agendados.length, sampleSpanHours: Math.round(janelaH * 100) / 100,
               reason: "amostra nao cobre o limiar — ausencia de `schedule` aqui nao prova parada" };
    }
    return { state: NO_SCHEDULED_RUN, newestAt: null, ageHours: null, thresholdHours,
             consideredRuns: 0, sampleSpanHours: Math.round(janelaH * 100) / 100 };
  }
  let newest = null;
  for (const r of agendados) {
    const t = new Date(r.createdAt).getTime();
    if (!Number.isFinite(t)) continue;                 // data ilegível nunca vira "fresco"
    if (newest === null || t > newest) newest = t;
  }
  if (newest === null) {
    return { state: NO_SCHEDULED_RUN, newestAt: null, ageHours: null, thresholdHours, consideredRuns: agendados.length };
  }
  const ageHours = (now.getTime() - newest) / 3600000;
  return {
    state: ageHours > thresholdHours ? STALE : FRESH,
    newestAt: new Date(newest).toISOString(),
    ageHours: Math.round(ageHours * 100) / 100,
    thresholdHours,
    consideredRuns: agendados.length,
  };
}

/**
 * @param {{fetchRecentRuns: () => Array}} deps  cliente injetado — nunca alcança a rede daqui
 * @returns {{overall: string, findings: Array}}
 */
export function detectSchedulerStale({ fetchRecentRuns, now = new Date(), thresholdHours = STALE_THRESHOLD_HOURS } = {}) {
  let runs;
  try {
    runs = fetchRecentRuns();
  } catch (e) {
    // Não conseguir LER não é o mesmo que "o agendador parou". Afirmar parada sem evidência é
    // exatamente o erro que este detector existe para não cometer.
    return { findings: [], confirmedRecoveries: new Set(), unknown: `nao foi possivel listar execucoes: ${String(e?.message || e)}` };
  }

  const c = classifyScheduler(runs, { now, thresholdHours });
  // FRESH = saudavel; UNKNOWN = nao medido. Nenhum dos dois emite finding.
  if (c.state === FRESH || c.state === UNKNOWN) return { findings: [], confirmedRecoveries: new Set(), evidence: c };

  const { canonical, authorization } = applyPolicy(DETECTOR_ID);
  const detalhe = c.state === NO_SCHEDULED_RUN
    ? "nenhuma execucao com event=schedule na amostra"
    : `execucao agendada mais recente tem ${c.ageHours} h (limiar ${c.thresholdHours} h)`;

  const finding = makeFinding({
    finding_type: DETECTOR_ID,
    fingerprint: schedulerStaleFingerprint(),
    detector_id: DETECTOR_ID,
    detector_version: DETECTOR_VERSION,
    observed_at: now.toISOString(),
    facts: [
      `Entrega de eventos \`schedule\` para "${REPOSITORY}" classificada ${c.state}: ${detalhe}.`,
      `Execucao agendada mais recente: ${c.newestAt ?? "(nenhuma)"}; execucoes com event=schedule na amostra: ${c.consideredRuns}.`,
      "Enquanto isto durar nenhum e-mail de resultado sai sozinho, nenhum snapshot de provedor e "
      + "atualizado e nenhum vigia roda — foi assim que o resultado do Gre-Nal (2026-09-03) passou "
      + "sem notificacao (#396).",
      "Somente event=schedule foi considerado: durante o #396 o produtor de cache ao vivo rodava a "
      + "cada 5 min por dispatch externo enquanto TODO o cron estava morto, entao 'ha run recente?' "
      + "teria concluido que estava tudo bem.",
    ],
    evidence: [
      `state=${c.state}`,
      `newest_scheduled_at=${c.newestAt ?? "none"}`,
      `age_hours=${c.ageHours ?? "n/a"}`,
      `threshold_hours=${c.thresholdHours}`,
      `scheduled_runs_considered=${c.consideredRuns}`,
    ],
    canonical, authorization,
    provenance: {
      source_sha: null,
      detector_version: DETECTOR_VERSION,
      policy_version: POLICY_VERSION,
      config_hash: hash(JSON.stringify({ thresholdHours: c.thresholdHours })),
      evidence_hash: hash(JSON.stringify({ newestAt: c.newestAt, state: c.state })),
    },
    status: "DETECTED",
    affected_files: [],
    affected_components: ["github-actions-scheduler"],
    schema_version: SCHEMA_VERSION,
  });

  return { findings: [finding], confirmedRecoveries: new Set(), evidence: c };
}

export const REPO = REPOSITORY;
