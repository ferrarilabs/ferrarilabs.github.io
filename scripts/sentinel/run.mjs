#!/usr/bin/env node
/**
 * run.mjs — Sentinel V1.0-A entrypoint.
 *
 * Normal execution: run each registered detector, upsert every finding it produces, and advance
 * the clean-cycle counter (or resolve) any open Sentinel Issue for that detector whose fingerprint
 * did NOT appear this run. This is the per-trigger pipeline (push/schedule/workflow_dispatch) —
 * distinct from reconcile.mjs, which repairs GitHub-side drift independent of any fresh detection.
 *
 * `--dry-run`: runs the detector, normalizes, fingerprints, and applies policy exactly as normal,
 * then only PRINTS the intended action (create / update-occurrence / resolve) using a real,
 * read-only lookup against current GitHub state — it never calls a mutating client method. This is
 * intentionally a separate, simpler code path from the live upsert algorithm, not a wrapped
 * version of it: mixing a placeholder "would-be" Issue into upsertFinding's own read-after-write
 * sequence would require the client to lie to itself, which is worse than just not calling it.
 *
 * Usage:
 *   node scripts/sentinel/run.mjs                 # live
 *   node scripts/sentinel/run.mjs --dry-run        # preview only, zero GitHub mutation
 */
import { detectChangeIntentStale, DETECTOR_ID as CHANGE_INTENT_STALE_ID } from "./detectors/change_intent_stale.mjs";
import { detectMainCiRed, DETECTOR_ID as MAIN_CI_RED_ID } from "./detectors/main_ci_red.mjs";
import { detectLiveDeployDrift, DETECTOR_ID as LIVE_DEPLOY_DRIFT_ID } from "./detectors/live_deploy_drift.mjs";
import { detectMigrationDrift, DETECTOR_ID as MIGRATION_DRIFT_ID, NOME_DE_MIGRACAO } from "./detectors/migration_drift.mjs";
import { readdirSync, statSync } from "node:fs";
import { join, dirname as _dirname } from "node:path";
import { fileURLToPath as _fileURLToPath } from "node:url";
import { calcularSha, shaDeclarado } from "../db/audit_live_function_drift.mjs";
import { createRealGithubClient } from "./github_client.mjs";
import { upsertFinding, recordCleanCycleOrResolve } from "./writer.mjs";
import { parseStateBlock } from "./github_state.mjs";
import { createRunLogger } from "./audit_log.mjs";
import { cleanCyclesToResolve } from "./policy.mjs";

// Each `run(client)` returns EITHER a plain Finding[] (absence-based clean-cycle: "not seen this
// run" is itself enough to advance) OR `{ findings, confirmedRecoveries }` (positive-confirmation
// clean-cycle: only fingerprints explicitly in `confirmedRecoveries` advance — mere absence from
// `findings` is NOT evidence of recovery, e.g. a CANCELLED/IN_PROGRESS CI run). See
// detectors/main_ci_red.mjs for why Main CI Red needs the second shape and
// detectChangeIntentStale for why the first is correct there.
const DETECTORS = [
  { id: CHANGE_INTENT_STALE_ID, run: () => detectChangeIntentStale() },
  { id: MAIN_CI_RED_ID, run: (client) => detectMainCiRed({ fetchLatestRuns: (wf, br) => client.fetchLatestRuns(wf, br) }) },
  // Issue #310. Compara o hash das fontes com o header `x-deploy-sha` do endpoint PUBLICO de dado
  // esportivo: nenhuma credencial, somente leitura, nunca implanta. `UNKNOWN` nao vira finding.
  { id: LIVE_DEPLOY_DRIFT_ID, run: (_client, ctx) => detectLiveDeployDrift({
      lerShaEsperado: () => { try { return calcularSha(); } catch { return null; } },
      observacaoViva: ctx.liveDeployObservation,
    }) },
  // Issue #310-B. A metade que de fato quebrou na #306: migracao no repo que producao nunca
  // aplicou. Somente leitura de metadados; sem credencial o estado e UNKNOWN, nunca "saudavel".
  { id: MIGRATION_DRIFT_ID, run: (_client, ctx) => detectMigrationDrift({
      lerMigracoesDoRepo: lerMigracoesDoRepo,
      lerAplicadas: () => ctx.migracoesAplicadas,
    }) },
];

const RAIZ_REPO = _dirname(_fileURLToPath(import.meta.url)) + "/../..";

/** Versoes no disco + ha quanto tempo cada arquivo existe (mtime como proxy do merge). */
export function lerMigracoesDoRepo() {
  const dir = join(RAIZ_REPO, "supabase/migrations");
  let arquivos = [];
  try { arquivos = readdirSync(dir); } catch { return { versoes: [], idadeMs: () => null }; }
  const porVersao = new Map();
  for (const f of arquivos) {
    const m = NOME_DE_MIGRACAO.exec(f);
    if (m) porVersao.set(m[1], join(dir, f));
  }
  const agora = Date.now();
  return {
    versoes: [...porVersao.keys()].sort(),
    idadeMs: (v) => {
      const p = porVersao.get(v);
      if (!p) return null;
      // `mtime` num checkout do CI e a hora do checkout, nao a do merge. Isso e conservador do
      // lado certo: subestima a idade, entao no maximo adia o alarme, nunca o inventa.
      try { return agora - statSync(p).mtimeMs; } catch { return null; }
    },
  };
}

/**
 * Versoes aplicadas em producao, ou `null` se nao houve como ler.
 *
 * CREDENCIAL DE MENOR PRIVILEGIO: le `supabase_migrations.schema_migrations` via PostgREST usando
 * `SENTINEL_MIGRATION_READ_KEY` — uma chave que deve ser emitida para um papel com SELECT APENAS
 * nessa tabela (ver docs/bolao/adr/ADR-019). NAO usa `service_role`, NAO usa a senha do banco.
 *
 * Sem a variavel, devolve `null` -> UNKNOWN. Nunca "nenhuma migracao pendente", que seria declarar
 * saude sem ter medido — e e exatamente assim que um detector vira falso-verde.
 */
async function lerMigracoesAplicadas() {
  const key = process.env.SENTINEL_MIGRATION_READ_KEY;
  if (!key) return null;
  const url = "https://cmhqkkfczotdnssupkni.supabase.co/rest/v1/schema_migrations"
            + "?select=version&order=version";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "supabase_migrations" },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const linhas = await r.json();
    if (!Array.isArray(linhas)) return null;
    return linhas.map((l) => String(l.version));
  } catch {
    return null;   // -> UNKNOWN
  }
}

/** Leitura do header em producao. Timeout curto: o Sentinel nao pode ficar pendurado num cron. */
async function lerShaVivoDeProducao() {
  const url = "https://cmhqkkfczotdnssupkni.supabase.co/functions/v1/live-football?competition=br2026";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    // O header vem em QUALQUER status: um 503 SOURCE_UNAVAILABLE tambem e resposta desta funcao, e
    // a identidade dela nao depende de a ESPN estar de pe.
    return { alcancavel: true, sha: r.headers.get("x-deploy-sha") };
  } catch {
    return { alcancavel: false, sha: null };   // -> UNKNOWN, nunca DRIFT
  }
}

/** Normalizes both detector return shapes to `{ findings, confirmedRecoveries }`. */
function normalizeDetectorResult(raw) {
  if (Array.isArray(raw)) return { findings: raw, confirmedRecoveries: null };
  return { findings: raw.findings, confirmedRecoveries: raw.confirmedRecoveries ?? null };
}

function dryRunPreview(finding, client, logger) {
  const matches = client.searchSentinelIssues(finding.fingerprint);
  if (matches.length === 0) {
    logger.log({ action: "dry_run_preview", intent: "would_create_issue", fingerprint: finding.fingerprint, finding_type: finding.finding_type });
  } else {
    const issue = matches[0];
    const state = parseStateBlock(issue.body);
    logger.log({
      action: "dry_run_preview", intent: issue.state === "CLOSED" ? "would_reopen_as_recurrence" : "would_update_occurrence",
      fingerprint: finding.fingerprint, issue_number: issue.number,
      current_occurrence_count: state?.occurrence_count ?? null,
    });
  }
}

export function runOnce({
  dryRun = false,
  client = createRealGithubClient(),
  logger = createRunLogger(),
  // Observacao de producao ja feita pelo chamador. O default nao alcancavel vira UNKNOWN, e
  // UNKNOWN nao emite finding — quem nao mediu nao acusa.
  liveDeployObservation = { alcancavel: false, sha: null },
  // `null` = nao foi possivel ler -> UNKNOWN. O default NAO e lista vazia: lista vazia significaria
  // "producao nao aplicou nada", que e uma afirmacao, e nao medimos nada.
  migracoesAplicadas = null,
} = {}) {
  const results = { findings: [], upserts: [], cleanCycles: [] };

  for (const detector of DETECTORS) {
    const { findings, confirmedRecoveries } = normalizeDetectorResult(detector.run(client, { liveDeployObservation, migracoesAplicadas }));
    logger.log({ action: "detector_ran", detector: detector.id, finding_count: findings.length });
    results.findings.push(...findings);

    const seenFingerprints = new Set(findings.map((f) => f.fingerprint));
    const threshold = cleanCyclesToResolve(detector.id);

    for (const finding of findings) {
      if (dryRun) { dryRunPreview(finding, client, logger); continue; }
      const outcome = upsertFinding(finding, client, logger);
      results.upserts.push(outcome);
    }

    // Clean-cycle / resolution pass: every OPEN Sentinel Issue for this detector whose fingerprint
    // wasn't in this run's output gets a clean cycle recorded (or resolved at threshold). When the
    // detector supplies `confirmedRecoveries`, absence alone is NOT enough — the fingerprint must
    // be explicitly confirmed recovered (see normalizeDetectorResult's doc comment above).
    if (!dryRun) {
      const open = client.listSentinelIssues({ state: "open" });
      for (const issue of open) {
        const state = parseStateBlock(issue.body);
        if (!state || state.detector_id !== detector.id) continue;
        if (seenFingerprints.has(state.fingerprint)) continue;
        if (confirmedRecoveries && !confirmedRecoveries.has(state.fingerprint)) continue;
        const outcome = recordCleanCycleOrResolve(issue, client, logger, threshold);
        results.cleanCycles.push({ issue_number: issue.number, ...outcome });
      }
    } else {
      logger.log({ action: "dry_run_note", note: "clean-cycle/resolution pass skipped in dry-run — read-only preview only" });
    }
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  try {
    // A UNICA I/O de rede deste detector, feita aqui no ponto de entrada e passada pronta.
    const results = runOnce({
      dryRun,
      liveDeployObservation: await lerShaVivoDeProducao(),
      migracoesAplicadas: await lerMigracoesAplicadas(),
    });
    console.error(`\nSentinel run complete. findings=${results.findings.length} upserts=${results.upserts.length} clean_cycles=${results.cleanCycles.length}`);
    process.exit(0);
  } catch (e) {
    console.error(`Sentinel run failed: ${e?.stack || e}`);
    // Non-zero exit reports workflow failure, but Sentinel is never a required check (see
    // sentinel.yml / architecture "Failure Semantics") — ordinary development is unaffected.
    process.exit(1);
  }
}
