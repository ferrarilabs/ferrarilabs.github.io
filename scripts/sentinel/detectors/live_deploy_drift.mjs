#!/usr/bin/env node
/**
 * live_deploy_drift.mjs — Sentinel detector para "o que esta em `main` != o que esta em PRODUCAO".
 *
 * ─── POR QUE EXISTE (Issue #310, causa em #306) ─────────────────────────────────────────────
 *
 * Em 2026-08-22 a Issue #296 entrou em `main` com CI verde e ficou HORAS sem chegar a producao: a
 * integracao Supabase-GitHub aplica as migracoes ANTES de implantar as funcoes, uma migracao
 * nao-idempotente falhava, e o pipeline abortava antes do deploy. O check que falhava e EXTERNO —
 * nao reprova nada no repositorio — e a divergencia so apareceu num `curl` manual, por acaso.
 *
 * O gate `live-function-drift` (PR #307) sabe detectar isso, mas so compara com producao quando
 * alguem define `VERIFY_ALLOW_NETWORK=1`, e nenhum workflow define. Ou seja: ele teria pego a #306
 * se alguem tivesse rodado. A #306 aconteceu porque ninguem rodou.
 *
 * Este detector fecha essa lacuna: roda no cron diario do Sentinel e transforma a deriva num fato
 * duravel e deduplicado, em vez de algo visivel so para quem desconfiar.
 *
 * ─── CREDENCIAL: NENHUMA ────────────────────────────────────────────────────────────────────
 *
 * A comparacao usa o header `x-deploy-sha` do endpoint PUBLICO de dado esportivo. Nao precisa de
 * service_role, nem de senha do banco, nem de token de management. O menor privilegio possivel
 * aqui e literalmente nenhum privilegio — e por isso esta parte e GREEN sem acao do dono.
 *
 * ─── SOMENTE LEITURA ────────────────────────────────────────────────────────────────────────
 *
 * Nunca implanta, nunca redeploya, nunca dispara workflow. Reportar e agir sao decisoes separadas;
 * automatizar a segunda a partir da primeira transformaria um alarme numa mutacao de producao nao
 * supervisionada.
 *
 * ─── UNKNOWN NAO E DRIFT ────────────────────────────────────────────────────────────────────
 *
 * Se producao nao responde (rede, timeout, 5xx do proprio Supabase), o estado e UNKNOWN e NENHUM
 * finding e emitido. Um alarme dizendo "producao divergiu" quando na verdade nao deu para medir e
 * pior que silencio: ele gasta a confianca que o alarme real vai precisar.
 */
import { createHash } from "node:crypto";
import { liveDeployDriftFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "live_deploy_drift";
export const DETECTOR_VERSION = "1.0.0";

/** A funcao monitorada. Hoje o projeto tem exatamente uma Edge Function. */
export const MONITORED_FUNCTION = "live-football";

export const ESTADOS = Object.freeze({
  LIVE_MATCHES_EXPECTED: "LIVE_MATCHES_EXPECTED",
  DEPLOY_PENDING: "DEPLOY_PENDING",
  LIVE_DRIFT: "LIVE_DRIFT",
  UNKNOWN: "UNKNOWN",
});

/** Estados que geram finding. `LIVE_MATCHES_EXPECTED` e sucesso; `UNKNOWN` e ausencia de medida. */
const ESTADOS_COM_FINDING = new Set([ESTADOS.LIVE_DRIFT, ESTADOS.DEPLOY_PENDING]);

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/**
 * Classificacao PURA. Sem rede, sem relogio, sem efeito colateral.
 *
 * `alcancavel:false` domina tudo: um hash lido de uma resposta que nao chegou nao vale nada, nem
 * para dizer que combina, nem para dizer que divergiu.
 */
export function classificar({ esperado, vivo, alcancavel }) {
  if (!alcancavel) return ESTADOS.UNKNOWN;
  if (!esperado) return ESTADOS.UNKNOWN;          // repo sem manifesto legivel: nao da para comparar
  if (!vivo) return ESTADOS.DEPLOY_PENDING;       // producao anterior ao mecanismo do header
  return vivo === esperado ? ESTADOS.LIVE_MATCHES_EXPECTED : ESTADOS.LIVE_DRIFT;
}

/**
 * SINCRONA de proposito. A unica I/O de rede (ler o header em producao) acontece FORA daqui e
 * chega pronta em `observacaoViva` — mesmo padrao do `main_ci_red`, que recebe as execucoes ja
 * buscadas. Isso mantem `runOnce()` sincrono: torna-lo async obrigaria a alterar ~15 pontos de
 * chamada nas suites de aceitacao que protegem a semantica de deduplicacao do Sentinel, o que e
 * risco maior do que esta funcionalidade justifica.
 *
 * O default e `{ alcancavel: false }` -> UNKNOWN -> nenhum finding. Um chamador que esqueca de
 * passar a observacao NAO produz alarme falso; produz silencio, que e o lado seguro.
 *
 * @param {object} args
 *   lerShaEsperado  () => string|null        hash calculado das fontes no repositorio
 *   observacaoViva  {alcancavel, sha}        leitura do header em producao, ja feita
 */
export function detectLiveDeployDrift({
  observedAt = new Date().toISOString(),
  lerShaEsperado,
  observacaoViva = { alcancavel: false, sha: null },
  sourceSha = null,
} = {}) {
  const findings = [];
  const confirmedRecoveries = new Set();

  const esperado = lerShaEsperado();
  const { alcancavel, sha: vivo } = observacaoViva;
  const estado = classificar({ esperado, vivo, alcancavel });

  // A identidade e a FUNCAO, nao o hash: uma deriva que persiste por dias e o MESMO incidente, e
  // deve incrementar occurrence_count numa Issue so. Se o fingerprint carregasse o hash esperado,
  // cada commit em `main` abriria uma Issue nova para o mesmo problema.
  const fingerprint = liveDeployDriftFingerprint(MONITORED_FUNCTION);

  if (estado === ESTADOS.LIVE_MATCHES_EXPECTED) {
    // Recuperacao POSITIVAMENTE observada: producao respondeu e o hash bate.
    confirmedRecoveries.add(fingerprint);
    return { findings, confirmedRecoveries, estado };
  }

  // UNKNOWN sai aqui: nem finding, nem recuperacao. Nao medimos, entao nao afirmamos nada.
  if (!ESTADOS_COM_FINDING.has(estado)) return { findings, confirmedRecoveries, estado };

  const { canonical, authorization } = applyPolicy(DETECTOR_ID);
  const fatos = estado === ESTADOS.LIVE_DRIFT
    ? [
        `A Edge Function "${MONITORED_FUNCTION}" em PRODUCAO nao corresponde ao codigo em main.`,
        `Hash esperado (calculado das fontes): ${esperado}. Hash em producao (x-deploy-sha): ${vivo}.`,
        `Merge nao virou deploy. Ver #306 para a causa ja observada uma vez: migracao nao-idempotente aborta o pipeline antes de implantar as funcoes.`,
      ]
    : [
        `A Edge Function "${MONITORED_FUNCTION}" em producao nao expoe o header x-deploy-sha.`,
        `Isso indica versao anterior ao mecanismo de identidade (#306) — E deriva, mas nao da para dizer QUAL codigo esta la.`,
        `Hash esperado (calculado das fontes): ${esperado}.`,
      ];

  findings.push(makeFinding({
    finding_type: DETECTOR_ID,
    fingerprint,
    detector_id: DETECTOR_ID,
    detector_version: DETECTOR_VERSION,
    observed_at: observedAt,
    facts: fatos,
    evidence: [`function=${MONITORED_FUNCTION}`, `state=${estado}`, `expected=${esperado}`, `live=${vivo ?? "(ausente)"}`],
    canonical, authorization,
    provenance: {
      source_sha: sourceSha,
      detector_version: DETECTOR_VERSION,
      policy_version: POLICY_VERSION,
      config_hash: hash(JSON.stringify({ fn: MONITORED_FUNCTION })),
      evidence_hash: hash(JSON.stringify({ estado, esperado, vivo })),
    },
    status: "DETECTED",
    affected_files: ["supabase/functions/live-football/index.ts"],
    affected_components: [MONITORED_FUNCTION],
    schema_version: SCHEMA_VERSION,
  }));

  return { findings, confirmedRecoveries, estado };
}

export const REPO = REPOSITORY;
