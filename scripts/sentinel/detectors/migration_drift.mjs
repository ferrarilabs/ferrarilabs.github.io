#!/usr/bin/env node
/**
 * migration_drift.mjs — Sentinel detector para "migracao que existe no repo e producao nunca aplicou".
 *
 * ─── POR QUE EXISTE (Issue #310-B, causa raiz da #306) ──────────────────────────────────────
 *
 * A #306 foi causada exatamente por isto: `20260822134050_powerball_payment_system_of_record.sql`
 * estava no disco desde 2026-08-22, a versao mais recente em `schema_migrations` era
 * `20260822110933`, e a diferenca ficou invisivel por horas. O pipeline abortava a cada push, o
 * check que falhava era externo (nao reprova nada no repositorio), e ninguem foi avisado.
 *
 * O detector `live_deploy_drift` (#310-A) cobre a FUNCAO. Este cobre as MIGRACOES — a metade que
 * de fato quebrou.
 *
 * ─── SOMENTE LEITURA, SEMPRE ────────────────────────────────────────────────────────────────
 *
 * Nunca aplica migracao, nunca executa DDL, nunca corrige nada. Le uma tabela de metadados e
 * compara com o disco. Aplicar uma migracao a partir de um alarme transformaria observabilidade em
 * mutacao de producao nao supervisionada — e a #306 mostrou que o caminho de deploy erra.
 *
 * ─── UNKNOWN NAO E SAUDAVEL ─────────────────────────────────────────────────────────────────
 *
 * Sem credencial, sem rede, ou com resposta ilegivel, o estado e UNKNOWN: nenhum finding (nao da
 * para afirmar deriva) e nenhuma confirmacao de recuperacao (nao da para afirmar saude). As duas
 * afirmacoes exigem ter medido.
 */
import { createHash } from "node:crypto";
import { migrationDriftFingerprint, REPOSITORY } from "../fingerprint.mjs";
import { applyPolicy, POLICY_VERSION } from "../policy.mjs";
import { makeFinding, SCHEMA_VERSION } from "../finding_schema.mjs";

export const DETECTOR_ID = "migration_drift";
export const DETECTOR_VERSION = "1.0.0";

export const ESTADOS = Object.freeze({
  MIGRATIONS_MATCH: "MIGRATIONS_MATCH",
  DEPLOY_PENDING: "DEPLOY_PENDING",
  LIVE_DRIFT: "LIVE_DRIFT",
  UNKNOWN: "UNKNOWN",
});

/** So arquivos que o Supabase realmente aplica: `<14 digitos>_nome.sql`. */
export const NOME_DE_MIGRACAO = /^(\d{14})_[a-z0-9_]+\.sql$/;

/**
 * Quanto tempo uma migracao pode estar no repo sem ter aplicado antes de virar DRIFT.
 *
 * Existe uma janela LEGITIMA: o merge acabou de acontecer e o pipeline ainda esta rodando. Sem essa
 * folga, todo merge de migracao geraria um alarme que se resolve sozinho em minutos — e um alarme
 * que grita a cada release e um alarme que alguem desliga. Passado o teto, "ainda esta rodando"
 * deixa de ser explicacao: na #306 ficou horas.
 */
export const JANELA_DE_DEPLOY_MS = 60 * 60_000;

function hash(text) { return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 24); }

/**
 * Classificacao PURA: versoes no disco vs versoes aplicadas. Sem rede, sem relogio proprio.
 *
 * @param noRepo    string[]  versoes (14 digitos) presentes em supabase/migrations/
 * @param aplicadas string[]|null  versoes em schema_migrations; `null` = nao foi possivel ler
 * @param idadeMs   (versao) => number|null  ha quanto tempo a migracao esta no repositorio
 */
export function classificar({ noRepo, aplicadas, idadeMs = () => null }) {
  if (!Array.isArray(aplicadas)) return { estado: ESTADOS.UNKNOWN, pendentes: [], orfas: [] };

  const aplicadasSet = new Set(aplicadas);
  const pendentes = noRepo.filter((v) => !aplicadasSet.has(v)).sort();

  // Aplicada em producao e AUSENTE do repositorio. Nao e o alvo desta Issue, mas e informacao que
  // nao pode sumir: significa que producao tem schema que o repositorio nao descreve.
  const noRepoSet = new Set(noRepo);
  const orfas = aplicadas.filter((v) => !noRepoSet.has(v)).sort();

  if (pendentes.length === 0) return { estado: ESTADOS.MIGRATIONS_MATCH, pendentes, orfas };

  // Dentro da janela de deploy -> ainda pode estar aplicando. Fora dela -> deriva de verdade.
  const velhas = pendentes.filter((v) => {
    const idade = idadeMs(v);
    return idade === null || idade > JANELA_DE_DEPLOY_MS;
  });
  return {
    estado: velhas.length > 0 ? ESTADOS.LIVE_DRIFT : ESTADOS.DEPLOY_PENDING,
    pendentes, orfas,
  };
}

/**
 * @param lerMigracoesDoRepo  () => {versoes: string[], idadeMs: fn}
 * @param lerAplicadas        () => string[]|null   `null` quando nao houve como ler (sem credencial)
 */
export function detectMigrationDrift({
  observedAt = new Date().toISOString(),
  lerMigracoesDoRepo,
  lerAplicadas,
  sourceSha = null,
} = {}) {
  const findings = [];
  const confirmedRecoveries = new Set();

  const { versoes: noRepo, idadeMs } = lerMigracoesDoRepo();
  const aplicadas = lerAplicadas();
  const { estado, pendentes, orfas } = classificar({ noRepo, aplicadas, idadeMs });

  // Identidade e o REPOSITORIO, nao a lista de versoes pendentes: enquanto a mesma migracao nao
  // aplica, e o MESMO incidente. Se o fingerprint carregasse as versoes, cada merge novo abriria
  // uma Issue nova para a mesma parada de pipeline.
  const fingerprint = migrationDriftFingerprint();

  if (estado === ESTADOS.MIGRATIONS_MATCH) {
    confirmedRecoveries.add(fingerprint);       // saude POSITIVAMENTE observada
    return { findings, confirmedRecoveries, estado, pendentes, orfas };
  }
  if (estado === ESTADOS.UNKNOWN) {
    return { findings, confirmedRecoveries, estado, pendentes, orfas };  // nem alarme, nem alta
  }
  if (estado === ESTADOS.DEPLOY_PENDING) {
    // Dentro da janela legitima: nao alarma, mas tambem NAO declara saude.
    return { findings, confirmedRecoveries, estado, pendentes, orfas };
  }

  const { canonical, authorization } = applyPolicy(DETECTOR_ID);
  findings.push(makeFinding({
    finding_type: DETECTOR_ID,
    fingerprint,
    detector_id: DETECTOR_ID,
    detector_version: DETECTOR_VERSION,
    observed_at: observedAt,
    facts: [
      `${pendentes.length} migracao(oes) existem em supabase/migrations/ e NAO constam em supabase_migrations.schema_migrations.`,
      `Versoes pendentes: ${pendentes.join(", ")}.`,
      `Ha mais de ${JANELA_DE_DEPLOY_MS / 60000} min no repositorio — fora da janela em que "o deploy ainda esta rodando" explica.`,
      `Foi exatamente esta condicao que causou a #306: o pipeline aborta na migracao e as Edge Functions nao chegam a ser implantadas.`,
      ...(orfas.length ? [`Alem disso, ${orfas.length} versao(oes) aplicadas em producao NAO existem no repositorio: ${orfas.join(", ")}.`] : []),
    ],
    evidence: [`pending=${pendentes.length}`, `orphans=${orfas.length}`, `state=${estado}`],
    canonical, authorization,
    provenance: {
      source_sha: sourceSha,
      detector_version: DETECTOR_VERSION,
      policy_version: POLICY_VERSION,
      config_hash: hash(JSON.stringify({ janelaMs: JANELA_DE_DEPLOY_MS })),
      evidence_hash: hash(JSON.stringify({ pendentes, orfas })),
    },
    status: "DETECTED",
    affected_files: pendentes.map((v) => `supabase/migrations/${v}_*.sql`),
    affected_components: ["supabase/migrations"],
    schema_version: SCHEMA_VERSION,
  }));

  return { findings, confirmedRecoveries, estado, pendentes, orfas };
}

export const REPO = REPOSITORY;
