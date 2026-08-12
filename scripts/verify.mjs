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
  { id: "anon-key-shape", group: "security", cmd: ["node", "bolao/scripts/test_anon_key_shape.mjs"],
    why: "chave anon malformada devolve 401 em tudo; foi ela que derrubou a leitura de participantes e esta a montante do incidente de 10/08" },
  { id: "pii-gate", group: "security", cmd: ["node", "scripts/audit_pii_repo_wide.mjs"],
    why: "repo-wide PII/secret scan over tracked files" },
  { id: "pii-gate-tests", group: "security", cmd: ["node", "scripts/test_audit_pii_repo_wide.mjs"],
    why: "precision/recall of the PII gate itself (a broken gate is worse than none)" },
  { id: "powerball-email-gates", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_email_send_gates.py"],
    why: "pre-send contract: all-or-nothing recipients, fail-closed mode, provider unreachable from tests" },
  { id: "email-send-safety", group: "security", cmd: ["node", "scripts/audit_email_send_safety.mjs"],
    why: "AUD-01/02/03: todo caminho capaz de enviar email falha fechado; inventario obrigatorio" },
  { id: "python-sender-failclosed", group: "security", cmd: ["python3", "bolao/scripts/test_python_sender_failclosed.py"],
    why: "AUD-02 exercitado: os 4 senders Python recusam transporte real sem autorizacao explicita" },
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
  { id: "copa-private-readers", group: "security", cmd: ["python3", "bolao/copa2026/scripts/test_private_readers.py"],
    why: "a chave publica vai em todo navegador; quem so a tem nao pode alcancar o documento privado" },
  { id: "copa-operator-cli", group: "app", cmd: ["python3", "bolao/copa2026/scripts/test_operator_cli.py"],
    why: "CLI de operador da Copa arquivada" },
  { id: "copa-app-routing", group: "app", cmd: ["node", "bolao/copa2026/scripts/test_app_routing.mjs"],
    why: "roteamento do app arquivado da Copa" },
  { id: "powerball-outbox-order", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_outbox_precedes_provider.py"],
    why: "a obrigacao duravel tem de existir ANTES do provedor; criar depois tambem satisfaz \"o ciclo cria um evento\" e e justamente o caso que perde a obrigacao" },
  { id: "no-whole-document-writers", group: "security", cmd: ["node", "bolao/scripts/test_no_whole_document_writers.mjs"],
    why: "dois gravadores de documento inteiro sem token comum perdem o trabalho um do outro em silencio" },
  { id: "cdb-bracket-propagation", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_bracket_propagation.mjs"],
    why: "a semifinal reage ao palpite das quartas SEM salvar; e nao inventa vaga sem o mapeamento oficial da CBF" },
  { id: "cdb-schedule-reconciler", group: "app", cmd: ["python3", "bolao/cdb2026/scripts/test_schedule_reconciler.py"],
    why: "\"a fonte nao respondeu nada\" nao pode virar \"a CBF nao publicou\": janela larga demais esvazia a resposta em silencio, e um apelido divergente segura a tabela inteira" },
  { id: "cdb-trusted-ingestion", group: "security", cmd: ["python3", "bolao/cdb2026/scripts/test_trusted_result_ingestion.py"],
    why: "resultado oficial move dinheiro; a matriz de identidade (ano/fase/mando/regressao terminal) e o que separa o placar certo de um jogo plausivel entre os mesmos clubes" },
  { id: "no-real-email-in-verification", group: "security", cmd: ["python3", "bolao/scripts/test_no_real_email_in_verification.py"],
    why: "verificador que fala com o provedor mandou dois e-mails a mais para o operador em 2026-08-12; participante real nunca e alvo de verificacao" },
  { id: "m8m9-no-silent-fallback", group: "security", cmd: ["python3", "bolao/scripts/test_m8m9_no_silent_fallback.py"],
    why: "auditoria que falha em silencio e pior que nao ter auditoria; a ponte M8/M9 levanta, nao adivinha, e nenhum caminho REST morto sobrevive" },
  { id: "cdb-invitation-email", group: "security", cmd: ["python3", "bolao/cdb2026/scripts/test_invitation_email.py"],
    why: "o convite carrega o link de acesso pessoal: nao pode sair sem prazo oficial publicado (regra 50), nem duas vezes (reemitir invalida o link em uso), nem levar o token para o log do Actions" },
  { id: "cdb-trusted-state-access", group: "security", cmd: ["node", "bolao/cdb2026/scripts/test_trusted_state_access.mjs"],
    why: "quem le a linha crua precisa da credencial privilegiada E o workflow tem de injeta-la; sem isso o job morre com IndexError" },
  { id: "cdb-phase-lifecycle", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_phase_lifecycle.mjs"],
    why: "cutoffAt=null significava tanto 'sem sorteio' quanto 'prazo pendente'; o segundo caso deixou 12 pessoas sem conseguir palpitar" },
  { id: "cdb-tie-id-parity", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_operator_tie_id_matches_app.mjs"],
    why: "id de confronto divergente entre app.js e operator_cli.py cria confronto PARALELO, com palpites divididos" },
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
  { id: "live-hero-reliability", group: "app", cmd: ["node", "bolao/scripts/audit_live_hero_reliability.mjs"],
    why: "hero nao pode sumir por falha transitoria: retencao de ultimo estado confirmado, TTL 15min, sem inventar resultado" },
  { id: "live-gateway", group: "app", cmd: ["node", "bolao/scripts/audit_live_gateway.mjs"],
    why: "gateway: cache, degradacao, injecao de falha da ESPN, seguranca contra proxy aberto" },
  { id: "football-live-store", group: "app", cmd: ["node", "bolao/scripts/audit_football_live_store.mjs"],
    why: "cenarios de aceitacao do LIVE DATA PLANE V2: primeira visita no meio do jogo, sem scheduler, fora de ordem, falha de fonte" },
  { id: "live-decision-scope", group: "app", cmd: ["node", "bolao/scripts/audit_live_decision_scope.mjs"],
    why: "21 pontos decidiam LIVE independentemente; consolidado para 9 consultas de tabela declaradas — nao pode crescer" },
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
  { id: "combo-next-label", group: "browser", cmd: ["node", "bolao/loterias/powerball/scripts/test_combo_next_label.mjs"],
    why: "o sufixo '· próximo' some/aparece se dois renders derivarem o sorteio de formas diferentes", requires: "browser" },
  { id: "combo-visual", group: "browser", cmd: ["node", "bolao/loterias/powerball/scripts/test_combo_visual.mjs"],
    why: "Powerball combobox: exactly one selection marker, selection vs navigation distinct", requires: "browser" },
  { id: "live-prob-bars", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/test_live_prob_bars.mjs"],
    why: "live probability bars", requires: "browser" },

  // ── F1-F20 / N# — gates da remediacao de 2026-08-10 ──────────────────────────────────
  // Achado N21: estes 21 rodavam em `npm run test:*` e NAO em `npm run verify`. O agregador
  // canonico e o que um revisor executa -- ele reportava verde enquanto 21 gates, entre eles
  // os de seguranca de email, PII e ledger de notificacao, nao rodavam.
  { id: "package-readiness", group: "security", cmd: ["node", "bolao/scripts/audit_review_package_readiness.mjs"],
    why: "F20: insumos do pacote de review prontos; geracao pos-auth e mecanica" },
  { id: "live-cache-write-authority", group: "security", cmd: ["node", "bolao/scripts/audit_live_cache_write_authority.mjs"],
    why: "F8: so o gateway confiavel escreve no cache ao vivo; anon nunca" },
  { id: "br2026-narrow-persistence", group: "security", cmd: ["node", "bolao/scripts/audit_br2026_narrow_persistence.mjs"],
    why: "F10/N22: BR2026 le projecao publica e so grava por RPC estreita" },
  { id: "cdb-public-projection", group: "security", cmd: ["python3", "bolao/cdb2026/scripts/test_public_projection_and_submit.py"],
    why: "CDB2026 stage 4 aditivo: projecao publica sem PII e submissao estreita que recusa entrada invalida" },
  { id: "powerball-observability", group: "app", cmd: ["python3", "bolao/loterias/powerball/scripts/test_lifecycle_observability.py"],
    why: "O log do Actions tem de responder a noite inteira sozinho, sem PII e sem segredo" },
  { id: "powerball-transport-targets", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_transport_honors_targets.py"],
    why: "O transporte REAL tem de obedecer a lista do ledger; alvo parcial recusa em vez de difundir" },
  { id: "powerball-anon-denied", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_anon_notification_denied.py"],
    why: "N24: anon key publica nao pode mutar nem ler o ledger de notificacao (12 ataques concretos)" },
  { id: "powerball-workflow-health", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_production_workflow_health.py"],
    why: "POWERBALL_RECENT_PRODUCTION_WORKFLOW_HEALTH: sem dependencia de CLI local; estado normal nao vira falha" },
  { id: "powerball-settle-real-db", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_settle_rpc_real_db.py"],
    why: "Executa as RPCs do ledger no Postgres real: so execucao revela erro de tipo (ver N23)" },
  { id: "powerball-cross-draw", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_cross_draw_resolution.py"],
    why: "Resolucao de contato entre sorteios: endereco divergente NUNCA e adivinhado" },
  { id: "powerball-email-visual", group: "app", cmd: ["python3", "bolao/loterias/powerball/scripts/test_result_email_visual.py"],
    why: "PB-R1: bolas do e-mail de resultado, degradacao sem CSS, origem canonica do link" },
  { id: "powerball-workflow-arming", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_workflow_arming_contract.py"],
    why: "PB-R3 + NO_FAKE_EMAIL: concorrencia, cobertura de cron, transporte real, estado de armamento" },
  { id: "powerball-crash-matrix", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_crash_matrix.py"],
    why: "Matriz de crash A-M contra run_lifecycle real: crash/concorrencia/lease nunca reenviam para quem ja recebeu" },
  { id: "powerball-ledger-consumer", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_ledger_actual_consumer.py"],
    why: "POWERBALL_NOTIFICATION_LEDGER_ACTUAL_CONSUMER: prova por comportamento que run_lifecycle consome o ledger" },
  { id: "powerball-result-identity", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_result_draw_identity.py"],
    why: "P0 2026-08-10: resultado tem de ser DAQUELE sorteio; nunca o mais recente" },
  { id: "gate-registry", group: "security", cmd: ["node", "bolao/scripts/audit_gate_registry.mjs"],
    why: "meta-gate: nenhum gate pode existir sem classificacao (17 orfaos achados em 2026-08-10)" },
  { id: "security-docs-reality", group: "security", cmd: ["node", "bolao/scripts/audit_security_docs_match_reality.mjs"],
    why: "F11: SECURITY.md nao pode negar PII que existe; REAL_SEND_REQUIRES_ATOMIC_LEDGER" },
  { id: "html-table-structure", group: "app", cmd: ["node", "bolao/scripts/audit_html_table_structure.mjs"],
    why: "F16/F17: validade de tabela no HTML GERADO, nao so nos .html" },
  { id: "shared-store-adoption", group: "app", cmd: ["node", "bolao/scripts/audit_shared_store_adoption.mjs"],
    why: "F12/F13: BR e CDB consomem de fato o FootballLiveStore" },
  { id: "live-store-lifecycle", group: "app", cmd: ["node", "bolao/shared/scripts/test_live_store_lifecycle.mjs"],
    why: "F14/F15: stop() durante refresh em voo; estado terminal nao regride" },
  { id: "cache-poisoning", group: "security", cmd: ["node", "bolao/shared/scripts/test_cache_poisoning.mjs"],
    why: "F9: payload persistido do cache tratado como entrada nao confiavel" },
  { id: "round-ledger", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_round_notification_ledger.mjs"],
    why: "F6: matriz de crash, claim/lease, parcial != SENT, contrato sobre o SQL real" },
  { id: "round-ledger-interop", group: "notifications", cmd: ["node", "bolao/shared/scripts/test_round_ledger_interop.mjs"],
    why: "F6: as duas implementacoes do ledger (Node/Python) nao podem derivar" },
  { id: "ledger-consumer", group: "notifications", cmd: ["node", "bolao/scripts/audit_notification_ledger_consumer.mjs"],
    why: "F6: o cron real alcanca o reconciliador canonico e o ledger duravel" },
  { id: "br-delivery-loop", group: "notifications", cmd: ["python3", "bolao/br2026/scripts/test_round_delivery_loop.py"],
    why: "o laco de entrega por destinatario: aceito nunca reenvia, parcial nunca vira SENT, incerto falha fechado" },
  { id: "br-round-state", group: "scoring", cmd: ["python3", "bolao/br2026/scripts/test_round_state.py"],
    why: "F1/F2: identidade canonica de rodada, proveniencia oficial, R21 nao bloqueia R22" },
  { id: "br-recipient-completeness", group: "security", cmd: ["python3", "bolao/br2026/scripts/test_recipient_completeness.py"],
    why: "F4/F5: conjunto de destinatarios incompleto = zero chamadas ao provedor" },
  { id: "ops-logging", group: "security", cmd: ["node", "bolao/scripts/test_ops_logging.mjs"],
    why: "logging JSONL, ZIP-9, integridade, backup, restauracao, HOLD, sem PII" },
  { id: "cdb-bracket-progression", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_bracket_progression.mjs"],
    why: "topologia do chaveamento e dependencias WINNER_OF" },
  { id: "cdb-result-email-source", group: "app", cmd: ["python3", "bolao/cdb2026/scripts/test_result_email_source.py"],
    why: "origem canonica do email de resultado do CDB" },
  { id: "copa-bracket-correction", group: "app", cmd: ["python3", "bolao/copa2026/scripts/test_bracket_correction_routing.py"],
    why: "roteamento de correcao de chaveamento (Copa arquivada)" },
  { id: "powerball-metadata-concurrency", group: "app", cmd: ["python3", "bolao/loterias/powerball/scripts/test_metadata_concurrency.py"],
    why: "o atualizador de jackpot escreve no mesmo data.js que outra sessao edita; snapshot velho apagaria participante que ja pagou" },
  { id: "powerball-open-draw", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/test_open_draw_metadata.mjs"],
    why: "o sorteio ABERTO tem de mostrar jackpot oficial com procedencia, nunca estado de espera com o dado disponivel" },
  { id: "powerball-scoring", group: "scoring", cmd: ["python3", "bolao/loterias/powerball/scripts/audit_scoring.py"],
    why: "premiacao do Powerball" },
  { id: "powerball-private-data", group: "security", cmd: ["node", "bolao/loterias/powerball/scripts/email/test_private_data_contract.mjs"],
    why: "contrato de dado privado do Powerball" },
  { id: "powerball-send-gating", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_send_result_email_gating.py"],
    why: "trava de envio do email de resultado do Powerball" },
  { id: "br-live-behavior-parity", group: "browser", cmd: ["node", "bolao/scripts/audit_br_live_behavior_parity.mjs"],
    why: "F12: comportamento ao vivo do BR preservado pela migracao", requires: "browser" },
  { id: "responsive-14-width", group: "browser", cmd: ["node", "bolao/scripts/audit_responsive_matrix.mjs"],
    why: "matriz de 14 larguras x 4 apps: geometria real, nao 'a pagina carregou'", requires: "browser" },
  { id: "cdb-sticky-overlap", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/visual/check_sticky_overlap.mjs"],
    why: "sobreposicao de elemento fixo em varias posicoes de rolagem", requires: "browser" },

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
    // Suites de navegador levam MUITO mais tempo e disputam CPU entre si: numa execucao medida,
    // `accessibility` levou 114s e `responsive-14-width` 93s, e a suite seguinte ficou esperando
    // um Chromium. Com teto unico de 300s, QUAL suite estourava variava de execucao para execucao
    // -- um agregado nao-deterministico e uma fabrica de vermelho falso, e vermelho falso ensina
    // a reexecutar ate passar, que e como um vermelho VERDADEIRO passa despercebido.
    // O teto maior nao afrouxa gate nenhum: cada suite continua tendo de passar inteira.
    const limite = c.requires === "browser" || c.group === "browser" ? 900000 : 300000;
    const t0 = Date.now();
    const r = spawnSync(c.cmd[0], c.cmd.slice(1), { encoding: "utf8", timeout: limite });
    const ms = Date.now() - t0;
    if (r.error && r.error.code === "ETIMEDOUT") {
      results.push({ id: c.id, group: c.group, status: "FAILED",
                     reason: `timed out after ${limite / 1000}s`, ms });
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
