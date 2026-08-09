#!/usr/bin/env node
/**
 * Aggregating repository verification runner.
 *
 * WHY THIS EXISTS
 * The npm suites were `&&` chains. `&&` is the wrong operator for a test runner: the first failure
 * short-circuits everything after it. In a measured run of `test:node`, one failing check hid EIGHT
 * suites that all passed individually — including state-merge, golden-master and money-interop, the
 * ones most worth knowing about. "test:node FAILED" told a developer nothing about them.
 *
 * This runner executes every check, aggregates the results, and exits non-zero at the END. One
 * failure never hides another.
 *
 * DESIGN CONSTRAINTS
 *   · deterministic exit status: 0 all-pass, 1 any failure, 2 runner error
 *   · human summary on stdout; machine summary as JSON (--json / --json-out)
 *   · failures attributable to an individual named check
 *   · no production dependency: no DB, no network, no credentials. Checks needing either are
 *     declared `requires` and reported SKIPPED — never silently passed
 *   · no secrets or PII in output: child output is only surfaced for FAILED checks, and the checks
 *     themselves mask their matches
 *   · flaky checks are not concealed — a check that cannot run says so
 *
 * Usage:
 *   node scripts/verify.mjs                 # all checks available in this environment
 *   node scripts/verify.mjs --json          # machine-readable summary on stdout
 *   node scripts/verify.mjs --json-out=f    # write JSON summary to a file
 *   node scripts/verify.mjs --only=pii,cron # run a subset
 *   node scripts/verify.mjs --list          # list checks and exit
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(f);
const val = (p) => { const a = ARGS.find((x) => x.startsWith(p)); return a ? a.slice(p.length) : null; };

/**
 * `requires` gates a check on an environment capability:
 *   "browser" — Playwright/Chromium
 *   "network" — outbound egress
 * Missing capability ⇒ SKIPPED, never PASSED.
 */
const CHECKS = [
  // ── security / leakage ───────────────────────────────────────────────────────
  { id: "pii-gate", group: "security", cmd: ["node", "scripts/audit_pii_repo_wide.mjs"],
    why: "repo-wide PII/secret scan over tracked files" },
  { id: "pii-gate-tests", group: "security", cmd: ["node", "scripts/test_audit_pii_repo_wide.mjs"],
    why: "precision/recall of the PII gate itself (a broken gate is worse than none)" },
  { id: "powerball-email-gates", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_email_send_gates.py"],
    why: "pre-send contract: all-or-nothing recipients, fail-closed mode, provider unreachable from tests" },
  { id: "powerball-email-safety", group: "security", cmd: ["node", "bolao/loterias/powerball/scripts/test_email_safety_contract.mjs"],
    why: "contrato de seguranca do email: provedor inalcancavel em teste, conjunto de destinatarios completo, mira exata do sorteio" },
  { id: "powerball-email-a", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/audit_email_tests.mjs"],
    why: "fluxos de confirmacao/publicacao — nunca esteve no runner, ficou vermelho sem ninguem ver" },
  { id: "powerball-email-b", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/audit_email_tests_round2.mjs"],
    why: "round 2 do email" },
  { id: "powerball-email-c", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/audit_email_tests_round3.mjs"],
    why: "round 3: assunto, formatacao de dinheiro canonica, anexos" },
  { id: "powerball-email-d", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/audit_email_tests_round4.mjs"],
    why: "round 4: email de resultado, bolas visuais, origem canonica do link" },
  { id: "powerball-result-pipeline", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/test_result_pipeline.mjs"],
    why: "Powerball draw result: fetch, prize computation, surgical write, ticket highlight" },
  { id: "fixture-privacy", group: "security", cmd: ["node", "scripts/test_fixture_privacy.mjs"],
    why: "no third-party address inside any test fixture; provider unreachable from tests" },
  { id: "powerball-pii", group: "security", cmd: ["node", "bolao/loterias/powerball/scripts/audit_pii_tests.mjs"],
    why: "Powerball private-data contract" },
  { id: "powerball-pii-scope", group: "security", cmd: ["node", "bolao/loterias/powerball/scripts/test_pii_scan_scope.mjs"],
    why: "escopo da varredura de PII = rastreados + nao-rastreados - ignorados; restringir escopo e a direcao perigosa" },
  { id: "powerball-draw-model", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/audit_draw_model_tests.mjs"],
    why: "ciclo de vida do sorteio e rotulo do seletor — nunca esteve no runner, por isso ficou 9/2 sem ninguem ver" },

  // ── scheduling ───────────────────────────────────────────────────────────────
  { id: "cron-coverage", group: "scheduling", cmd: ["node", "bolao/scripts/cron_coverage.test.mjs"],
    why: "scheduled workflows cover the expected event calendar" },

  // ── scoring: money-affecting, never generalised across competitions ──────────
  { id: "scoring-copa", group: "scoring", cmd: ["python3", "bolao/copa2026/scripts/audit_scoring.py"], why: "Copa scoring self-test" },
  { id: "scoring-br", group: "scoring", cmd: ["python3", "bolao/br2026/scripts/audit_scoring.py"], why: "BR2026 scoring self-test" },
  { id: "scoring-cdb", group: "scoring", cmd: ["python3", "bolao/cdb2026/scripts/audit_scoring.py"], why: "CDB2026 scoring self-test" },
  { id: "integrity-cdb", group: "scoring", cmd: ["python3", "bolao/cdb2026/scripts/audit_integrity.py"], why: "CDB2026 integrity" },

  // ── application invariants ───────────────────────────────────────────────────
  { id: "test-isolation", group: "app", cmd: ["node", "bolao/scripts/audit_test_isolation.mjs"], why: "tests do not touch production origins" },
  { id: "roster-freeze", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_entry_roster_freeze.mjs"], why: "entry roster freeze" },
  { id: "draw-lifecycle", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_draw_lifecycle.mjs"], why: "draw lifecycle" },
  { id: "remote-authoritative", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_remote_authoritative.mjs"], why: "remote state is authoritative" },
  { id: "draw-provenance", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_draw_provenance.mjs"], why: "official draw provenance" },
  { id: "draw-provenance-patterns", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_draw_provenance_patterns.mjs"],
    why: "precision/recall of the tie-fabrication patterns" },
  { id: "cbf-ingestion", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_cbf_ingestion.mjs"], why: "CBF draw ingestion" },
  { id: "penalty-fields", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_penalty_fields.mjs"],
    why: "CDB2026 penalty scores stay separate from the regulation aggregate" },
  { id: "golden-master", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_golden_master.mjs"], why: "golden-master state" },
  { id: "state-merge", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_state_merge.mjs"], why: "state merge semantics" },
  { id: "state-invariants", group: "app", cmd: ["node", "bolao/scripts/audit_state_invariants.mjs"],
    why: "no canonical state field is lost by any merge path (4x recurring defect class)" },
  { id: "aggregate-hero", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_aggregate_hero.mjs"], why: "aggregate hero rendering" },
  { id: "visual-contract", group: "app", cmd: ["node", "bolao/scripts/check_shared_visual_contract.mjs"], why: "shared visual contract" },
  { id: "live-freshness", group: "app", cmd: ["node", "bolao/scripts/audit_live_freshness.test.mjs"],
    why: "live snapshot polling must revalidate — stale cache froze the live clock/score/plays" },
  { id: "live-clock", group: "app", cmd: ["node", "bolao/scripts/audit_live_clock.test.mjs"],
    why: "live clock must keep running when the same snapshot is re-fetched" },
  { id: "live-clock-semantics", group: "app", cmd: ["node", "bolao/scripts/audit_live_clock_semantics.mjs"],
    why: "matriz de estados do relogio ao vivo: dado velho CONGELA no ultimo minuto confirmado, nunca o apaga" },
  { id: "remote-write-visibility", group: "app", cmd: ["node", "bolao/scripts/audit_remote_write_visibility.mjs"],
    why: "gravacao remota que nao acontece nao pode parecer sucesso — incidente do agendamento CBF 2026-08-09" },
  { id: "snapshot-window", group: "app", cmd: ["node", "bolao/scripts/audit_snapshot_window_coverage.mjs"],
    why: "o cron do snapshot tem que cobrir TODO horario de jogo real — janela cega apagou o hero ao vivo 2x" },
  { id: "draw-countdown", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_draw_countdown.mjs"],
    why: "contagem do sorteio da CBF: aparece assim que a data existir, e nunca conta negativo" },
  { id: "tool-scope", group: "app", cmd: ["node", "bolao/scripts/audit_tool_scope.test.mjs"],
    why: "cross-app audit tools cannot silently shrink their app scope" },
  { id: "cachebust", group: "app", cmd: ["node", "bolao/scripts/cachebust.integration.test.mjs"], why: "cache-bust integration" },
  { id: "cachebust-cdb", group: "app", cmd: ["node", "bolao/cdb2026/scripts/check_cachebust.test.mjs"], why: "CDB cache-bust" },
  { id: "money-interop", group: "app", cmd: ["node", "bolao/shared/scripts/test_money_interop.mjs"], why: "money interop py<->js" },

  // ── notifications / outbox ───────────────────────────────────────────────────
  { id: "notif-repo-js", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_notification_repository.mjs"], why: "notification repository (js)" },
  { id: "notif-repo-py", group: "notifications", cmd: ["python3", "bolao/shared/scripts/test_notification_repository.py"], why: "notification repository (py)" },
  { id: "notif-worker", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_notification_worker.mjs"], why: "notification worker" },
  { id: "notif-pipeline", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_notification_pipeline.mjs"], why: "notification pipeline" },
  { id: "notif-outbox-interop", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_notification_outbox_interop.mjs"], why: "outbox interop" },
  { id: "notif-repo-interop", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_notification_repository_interop.mjs"], why: "repository interop" },
  { id: "durable-persist", group: "notifications", cmd: ["python3", "bolao/shared/scripts/test_durable_persist.py"], why: "durable persistence" },
  { id: "durable-notif-repo", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_durable_notification_repository.mjs"], why: "durable notification repository" },

  // Estes DOIS estavam marcados `requires: "network"` e por isso eram sempre PULADOS — mas nenhum
  // dos dois toca a rede. `test_espn_provider.py` diz no próprio cabeçalho "no network calls, no
  // real ESPN data" e injeta openers falsos (`fetch_json(..., opener=fake_opener_ok(...))`);
  // `test_pipeline_health.mjs` não tem uma única referência a fetch/http. Os dois passam offline —
  // e passavam, via `npm run test:provider`, enquanto o agregador os reportava como skip.
  // Um teste pulado NÃO é verde: eram 2 suítes reais sumindo do total sem ninguém perceber.
  { id: "espn-provider", group: "provider", cmd: ["python3", "bolao/shared/scripts/test_espn_provider.py"],
    why: "ESPN provider contract" },
  { id: "pipeline-health", group: "provider", cmd: ["node", "bolao/shared/scripts/test_pipeline_health.mjs"],
    why: "provider pipeline health" },

  // ── environment-dependent: SKIPPED, never silently passed ────────────────────
  { id: "structural-parity", group: "browser", cmd: ["node", "bolao/scripts/audit_structural_parity.mjs"],
    why: "cross-app structural parity", requires: "browser" },
  { id: "aria-nav", group: "browser", cmd: ["node", "bolao/scripts/test_aria_current_nav.mjs"],
    why: "ARIA current-nav", requires: "browser" },
  { id: "accessibility", group: "browser", cmd: ["node", "bolao/scripts/audit_accessibility.mjs"],
    why: "four-app a11y + responsive matrix (Batch 9)", requires: "browser" },
  { id: "visual-consistency", group: "browser", cmd: ["node", "bolao/scripts/audit_visual_consistency.mjs"],
    why: "visual consistency", requires: "browser" },
  { id: "prob-bar-geometry", group: "browser", cmd: ["node", "bolao/scripts/audit_prob_bar_geometry.mjs"],
    why: "barra de probabilidade com espessura uniforme e porcentagem nunca cortada", requires: "browser" },
  { id: "countdown-layout", group: "browser", cmd: ["node", "bolao/scripts/audit_countdown_layout.mjs"],
    why: "contador regressivo sem celula orfa — quebrava justamente perto do jogo", requires: "browser" },
  { id: "live-card-dom", group: "browser", cmd: ["node", "bolao/scripts/audit_live_card_dom.mjs"],
    why: "render do card ao vivo + separacao medida do rotulo de probabilidade, 8 larguras", requires: "browser" },
  { id: "draw-combo", group: "browser", cmd: ["node", "bolao/loterias/powerball/scripts/test_draw_combo.mjs"],
    why: "Powerball draw combos", requires: "browser" },
  { id: "combo-lifecycle", group: "browser", cmd: ["node", "bolao/loterias/powerball/scripts/test_combo_lifecycle.mjs"],
    why: "Powerball combobox listener lifecycle (Batch 9)", requires: "browser" },
  { id: "combo-visual", group: "browser", cmd: ["node", "bolao/loterias/powerball/scripts/test_combo_visual.mjs"],
    why: "Powerball combobox: exactly one selection marker, selection vs navigation distinct", requires: "browser" },
  { id: "live-prob-bars", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/test_live_prob_bars.mjs"],
    why: "live probability bars", requires: "browser" },
];

function capabilities() {
  const browser = existsSync("node_modules/playwright") || existsSync("node_modules/@playwright/test") ||
                  !!process.env.PLAYWRIGHT_BROWSERS_PATH;
  // Egress is not probed: probing costs a network call and can hang. It is declared, not detected.
  const network = process.env.VERIFY_ALLOW_NETWORK === "1";
  return { browser, network };
}

function main() {
  const caps = capabilities();

  if (has("--list")) {
    for (const c of CHECKS) console.log(`${c.id}\t${c.group}\t${c.requires || "-"}\t${c.why}`);
    return 0;
  }

  const only = val("--only=");
  const wanted = only ? new Set(only.split(",").map((s) => s.trim())) : null;
  const selected = CHECKS.filter((c) => !wanted || wanted.has(c.id) || wanted.has(c.group));
  if (wanted && selected.length === 0) {
    console.error(`no check matches --only=${only}`);
    return 2;
  }

  const results = [];
  const started = new Date().toISOString();

  for (const c of selected) {
    if (c.requires && !caps[c.requires]) {
      results.push({ id: c.id, group: c.group, status: "SKIPPED",
        reason: `requires ${c.requires} capability, not available in this environment`, ms: 0 });
      continue;
    }
    if (!existsSync(c.cmd[1])) {
      results.push({ id: c.id, group: c.group, status: "MISSING",
        reason: `script not found: ${c.cmd[1]}`, ms: 0 });
      continue;
    }
    const t0 = Date.now();
    const r = spawnSync(c.cmd[0], c.cmd.slice(1), { encoding: "utf8", timeout: 300000 });
    const ms = Date.now() - t0;
    if (r.error && r.error.code === "ETIMEDOUT") {
      results.push({ id: c.id, group: c.group, status: "FAILED", reason: "timed out after 300s", ms });
    } else if (r.error) {
      results.push({ id: c.id, group: c.group, status: "FAILED", reason: `spawn error: ${r.error.code}`, ms });
    } else if (r.status === 0) {
      results.push({ id: c.id, group: c.group, status: "PASSED", ms });
    } else {
      // Surface child output ONLY on failure, tail-limited. Checks mask their own matches.
      const tail = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").slice(-15).join("\n");
      results.push({ id: c.id, group: c.group, status: "FAILED", exitCode: r.status, ms, output: tail });
    }
  }

  const count = (s) => results.filter((r) => r.status === s).length;
  const failed = results.filter((r) => r.status === "FAILED" || r.status === "MISSING");

  // ── human summary ───────────────────────────────────────────────────────────
  const icon = { PASSED: "✓", FAILED: "✗", SKIPPED: "○", MISSING: "!" };
  console.log("\nRepository verification\n");
  let group = null;
  for (const r of results) {
    if (r.group !== group) { group = r.group; console.log(`  ${group}`); }
    const note = r.status === "SKIPPED" ? `  (${r.reason})`
               : r.status === "MISSING" ? `  (${r.reason})` : "";
    console.log(`    ${icon[r.status]} ${r.id.padEnd(26)} ${String(r.ms).padStart(6)}ms${note}`);
  }
  if (failed.length) {
    console.log("\n  FAILURES\n");
    for (const f of failed) {
      console.log(`  ── ${f.id} (exit ${f.exitCode ?? "n/a"}) ${f.reason ? "— " + f.reason : ""}`);
      if (f.output) console.log(f.output.split("\n").map((l) => `     ${l}`).join("\n"));
      console.log("");
    }
  }
  console.log(`\n  ${count("PASSED")} passed, ${count("FAILED")} failed, ` +
              `${count("SKIPPED")} skipped, ${count("MISSING")} missing\n`);
  if (count("SKIPPED")) {
    console.log("  NOTE: skipped checks were NOT run and are NOT passing. Environment capability is\n" +
                "  declared, not guessed — set VERIFY_ALLOW_NETWORK=1 or install Playwright to include them.\n");
  }
  console.log(failed.length === 0 ? "✓ VERIFICATION PASSED\n" : "✗ VERIFICATION FAILED\n");

  // ── machine summary ─────────────────────────────────────────────────────────
  const summary = {
    schemaVersion: 1,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    capabilities: caps,
    totals: { passed: count("PASSED"), failed: count("FAILED"),
              skipped: count("SKIPPED"), missing: count("MISSING") },
    // `output` is intentionally omitted from the JSON: it is the only field that can echo child
    // process text, and this file may be uploaded as a CI artifact.
    checks: results.map(({ output, ...rest }) => rest),
    verdict: failed.length === 0 ? "PASSED" : "FAILED",
  };
  const jsonOut = val("--json-out=");
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(summary, null, 2) + "\n"); console.log(`  JSON summary -> ${jsonOut}\n`); }
  if (has("--json")) console.log(JSON.stringify(summary, null, 2));

  return failed.length === 0 ? 0 : 1;
}

try { process.exit(main()); }
catch (e) { console.error(`runner error: ${e.message}`); process.exit(2); }
