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
import { homedir } from "node:os";
import { join } from "node:path";

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
  { id: "pii-detector-engine", group: "security", cmd: ["node", "scripts/test_pii_detectors.mjs"],
    why: "o gate de PII passou a ser um CLI fino sobre scripts/pii_detectors.mjs na integracao de 2026-08-12; o motor agora e load-bearing para pii-gate, entao o suite dele roda no MESMO agregador — deixa-lo de fora seria o falso-verde N21 outra vez" },
  { id: "commit-message-pii-gate", group: "security", cmd: ["node", "scripts/audit_commit_message_pii.mjs"],
    why: "HIST-091/HIST-093 (2026-08-18): pii-gate so varre conteudo de arquivo/blob; PII real foi digitada direto em corpos de commit-message, uma superficie que nenhum gate cobria. Forward-only por design — varre so commits novos desde a base, nunca a historia inteira" },
  // Issue #250: o commit 3556dbce trazia "Does NOT fix #246" — escrito de proposito para NAO
  // fechar a Issue — e o parser lexical do GitHub casou `fix #246` e fechou uma Issue de
  // incidente de producao mesmo assim. Mesma familia do gate de PII em mensagem de commit:
  // risco lexico na prosa, que nenhum humano confere de forma confiavel.
  // Issue #251: numa execucao autonoma o orquestrador rodou `git checkout --detach` DENTRO da
  // arvore canonica compartilhada. Nada se perdeu, mas a regra ("todo trabalho automatizado vai
  // para worktree dedicada") existia so em prosa. Decisao do Eduardo: proteger contra AGENTE,
  // nunca contra o dono do repositorio.
  { id: "canonical-tree-guard", group: "security", cmd: ["node", "scripts/safety/test_canonical_tree_guard.mjs"],
    why: "guarda que impede sessao de agente de commitar/mesclar/rebasear/empurrar a partir da worktree PRINCIPAL, sem nunca bloquear humano nem CI (Issue #251)" },

  // Issue #266: a DDL de producao mora em DOIS diretorios e so um e o ledger de migracoes. Foi
  // assim que a #133 nasceu -- um grep ancorado em supabase/migrations devolveu 10 tabelas quando
  // producao tem 12. Este gate prova que todo objeto EXIGIDO tem um arquivo que o cria, e mantem
  // visivel qual deles vive fora do ledger. Hermetico: le .sql do repositorio, nunca o banco.
  // Issue #267: sete RPCs SECURITY DEFINER de operador (pagamento, resultado, fases, e-mail de
  // rodada, identidade da entrada, destinatarios) tinham EXECUTE para `authenticated` -- o papel
  // que QUALQUER requisicao com JWT assume no PostgREST. Revogado em producao em 2026-08-21, mas o
  // GRANT continua no baseline: sem este gate, uma reconstrucao a partir das migracoes traz a
  // exposicao de volta sem ninguem escrever uma linha errada.
  { id: "operator-rpc-exposure", group: "security", cmd: ["node", "scripts/db/audit_operator_rpc_exposure.mjs"],
    why: "efeito liquido da DDL nao pode deixar RPC de operador executavel por anon/authenticated/PUBLIC (Issue #267)" },
  { id: "operator-rpc-exposure-tests", group: "security", cmd: ["node", "scripts/db/test_operator_rpc_exposure.mjs"],
    why: "o gate acima decide por ORDEM (grant/revoke/regrant); esta suite prova que ele distingue os tres casos" },
  // Issue #270 — `rls_auto_enable()` sustenta o gatilho `ensure_rls`, que liga RLS em toda tabela
  // nova de `public`. Ela estava executavel por PUBLIC + anon + authenticated + service_role.
  // Revogado em producao em 2026-08-21. O invariante tem DUAS metades e as duas sao verificadas:
  // sem exposicao a cliente E gatilho ainda ativo -- apagar o gatilho zeraria a exposicao tambem.
  { id: "rls-auto-enable-privilege", group: "security", cmd: ["node", "scripts/db/audit_rls_auto_enable_privilege.mjs"],
    why: "SECURITY DEFINER que liga RLS sozinha nao pode ser executavel por cliente, e o gatilho nao pode morrer (Issue #270)" },
  { id: "rls-auto-enable-privilege-tests", group: "security", cmd: ["node", "scripts/db/test_rls_auto_enable_privilege.mjs"],
    why: "prova que o gate reprova a mutacao ingenua: revogar os tres papeis e deixar PUBLIC, que todos herdam" },
  // Issue #273 — generaliza a FORMA que as Issues #267 e #270 acharam a mao: funcao SECURITY
  // DEFINER (roda com o privilegio do dono) alcancavel por PUBLIC/anon/authenticated sem que
  // ninguem tenha decidido isso. Classifica por CAPACIDADE lida do corpo, nunca por nome, e
  // exige entrada ratificada em bolao/shared/safety/ratified_rpc_exposure.json.
  // Issue #276 — `authenticated` tinha TRUNCATE/REFERENCES/TRIGGER em 11 das 12 tabelas de
  // `public` (inclusive a de identidade do participante) e `anon` em ate 10. A RLS NAO cobre
  // estes tres: ela aplica policies a SELECT/INSERT/UPDATE/DELETE, e TRUNCATE e operacao de
  // tabela inteira. Revogado em producao em 2026-08-21. Ja tinha voltado uma vez -- as tabelas de
  // notificacao nasceram depois da remediacao de 2026-08-07 e vieram com o privilegio de novo.
  // Issue #271 — objeto novo em `public` nascia concedido a anon/authenticated/service_role sem
  // nenhum GRANT escrito. `bolao_round_notif_jobs` provou: nao tem um grant na DDL e `anon` tinha
  // TRUNCATE nela. Fechado para TABLES/SEQUENCES do criador `postgres`; FUNCTIONS e
  // `supabase_admin` continuam abertos, declarados com motivo, e o gate exige que continuem.
  { id: "default-privileges", group: "security", cmd: ["node", "scripts/db/audit_default_privileges.mjs"],
    why: "objeto novo em public nao pode nascer exposto, e uma reconstrucao limpa tem de manter a API intencional (Issue #271)" },
  { id: "default-privileges-tests", group: "security", cmd: ["node", "scripts/db/test_default_privileges.mjs"],
    why: "prova o meio-conserto por papel criador e a divergencia de reconstrucao por PUBLIC em funcao" },
  // Issue #271, opcao B — o outro lado do gate acima: em vez de conferir uma LISTA DECLARADA,
  // DESCOBRE toda funcao de aplicacao que a DDL cria em `public` e exige decisao de acesso para
  // cada uma. Modela a ACL EFETIVA de nascimento (PUBLIC embutido + default de schema), nao o
  // texto dos GRANTs -- que e a diferenca entre ver `_bolao_audit` exposta a `authenticated` e
  // nao ver (Issue #282).
  { id: "function-creation-discipline", group: "security", cmd: ["node", "scripts/db/audit_function_creation_discipline.mjs"],
    why: "funcao em public nasce executavel por PUBLIC e pelos papeis do default; sem decisao escrita, servico vira cliente (Issue #271)" },
  { id: "function-creation-discipline-tests", group: "security", cmd: ["node", "scripts/db/test_function_creation_discipline.mjs"],
    why: "prova as nove regressoes exigidas, e confere o modelo estatico contra ACLs lidas de um PostgreSQL 17.10 real" },
  // Issues #282/#284 — o outro lado da mesma raiz, agora em RELACAO: `PUBLIC` e pseudo-papel e
  // revoga-lo nao limpa `anon`/`authenticated`. Ate 2026-08-22 o modelo nem via view nenhuma
  // (`parseCreateTables` so casava `create table`), entao o achado da #282 era invisivel para o
  // gate que deveria pega-lo. O parser foi estendido junto.
  { id: "public-projection-privs", group: "security", cmd: ["node", "scripts/db/audit_public_projection_privs.mjs"],
    why: "projecao publica serve SELECT; escrita/administracao de papel de cliente nela e privilegio que ninguem decidiu conceder (#282)" },
  { id: "public-projection-privs-tests", group: "security", cmd: ["node", "scripts/db/test_public_projection_privs.mjs"],
    why: "as catorze regressoes exigidas, inclusive o controle negativo que remove a migracao corretiva e exige o defeito de volta" },
  // Issue #131 — os quatro verbos de linha nas seis tabelas-base do Powerball. Complementa o gate
  // acima, que trata os tres privilegios estruturais e deixa o CRUD de fora de proposito: aqui a
  // RLS realmente segura, e por isso mesmo ela e a UNICA coisa segurando. O gate impede que o
  // grant cresca enquanto a revogacao autorizada nao acontece.
  { id: "lottery-client-crud", group: "security", cmd: ["node", "scripts/db/audit_lottery_client_crud.mjs"],
    why: "anon/authenticated com CRUD direto em tabela de participante e pagamento, com so a RLS embaixo (Issue #131)" },
  { id: "lottery-client-crud-tests", group: "security", cmd: ["node", "scripts/db/test_lottery_client_crud.mjs"],
    why: "prova que o gate morde no acesso direto e fica quieto na view publica e na RPC — as duas metades" },
  { id: "client-structural-privs", group: "security", cmd: ["node", "scripts/db/audit_client_structural_privs.mjs"],
    why: "papel de cliente com TRUNCATE/REFERENCES/TRIGGER e o unico privilegio destas tabelas sem RLS embaixo (Issue #276)" },
  { id: "client-structural-privs-tests", group: "security", cmd: ["node", "scripts/db/test_client_structural_privs.mjs"],
    why: "prova as nove regressoes exigidas, e que remover a migracao reproduz a exposicao medida em producao" },
  { id: "secdef-exposure", group: "security", cmd: ["node", "scripts/db/audit_security_definer_exposure.mjs"],
    why: "funcao SECURITY DEFINER executavel por cliente sem ratificacao explicita e privilegio que ninguem decidiu conceder (Issue #273)" },
  { id: "secdef-exposure-tests", group: "security", cmd: ["node", "scripts/db/test_security_definer_exposure.mjs"],
    why: "prova as oito regressoes exigidas, inclusive a mutacao da #270 (revogar os papeis e deixar PUBLIC) e o falso-verde por varredura vazia" },  // Issue #292 — a ordem em que a DDL foi REALMENTE aplicada, e a prova de que cada revoke alcanca
  // um objeto que ja existe naquele ponto. Antes disto os gates ordenavam por DIRETORIO, e a
  // remediacao da #135 rodava antes do CREATE das views que devia proteger: existia, estava
  // commitada, tinha Issue fechada, e nao governava nada.
  { id: "ddl-execution-order", group: "security", cmd: ["node", "scripts/db/audit_ddl_execution_order.mjs"],
    why: "regra de seguranca em arquivo inerte, ou em posicao onde nao alcanca o objeto, nao e remediacao (Issue #292)" },
  { id: "ddl-execution-order-tests", group: "security", cmd: ["node", "scripts/db/test_ddl_execution_order.mjs"],
    why: "controle negativo: desligar a ordem corretiva tem de reintroduzir a divergencia, observando ACL e nao prosa" },
  // Issue #130 — o banco virou o sistema de registro do pagamento do Powerball. Estes dois guardam
  // as duas metades: o caminho de operador (append-only, idempotente, sem credencial no navegador)
  // e o `data.js`, que ainda carrega verdade financeira enquanto a reconciliacao nao fecha.
  { id: "powerball-operator-payments", group: "security", cmd: ["python3", "bolao/loterias/powerball/scripts/test_operator_payments.py"],
    why: "corrigir dinheiro apagando o passado, e reexecutar um dispatch cobrando duas vezes, sao os dois modos de falha (Issue #130)" },
  // Issue #130 — a ferramenta de reconciliacao do backfill historico. Ela nao escreve nada; o que
  // ela protege e a decisao de NAO escrever: classifica cada registro da origem e recusa importar
  // qualquer um cuja identidade dependa de adivinhacao (a unica chave entre as duas fontes e o
  // NOME, e nome e chave fraca).
  { id: "powerball-backfill-reconcile", group: "security", cmd: ["node", "bolao/loterias/powerball/scripts/test_backfill_reconcile.mjs"],
    why: "importar historico financeiro so pode acontecer onde a identidade e deterministica (Issue #130)" },
  { id: "powerball-data-js-authority", group: "security", cmd: ["node", "bolao/loterias/powerball/scripts/audit_data_js_authority.mjs"],
    why: "enquanto data.js carregar verdade financeira, uma edicao manual dela nao pode passar em silencio (Issue #130)" },
  // Issue #271 — a arquitetura de controle compensatorio aceita pelo dono exige provar que TODO
  // objeto criado pela Ferrarilabs e endurecido explicitamente. Funcao e view ja tinham gate;
  // sequencia sao zero em `public` (medido); faltava TABELA, cujo CRUD so era exigido nas seis do
  // Powerball. Este fecha a cobertura por classe de objeto.
  { id: "table-client-decisions", group: "security", cmd: ["node", "scripts/db/audit_table_client_decisions.mjs"],
    why: "toda tabela de aplicacao precisa de decisao escrita de privilegio de cliente, conferida contra a ACL efetiva (#271)" },
  { id: "table-client-decisions-tests", group: "security", cmd: ["node", "scripts/db/test_table_client_decisions.mjs"],
    why: "controle negativo: tabela nova com CRUD de cliente e sem decisao tem de reprovar" },

  { id: "ddl-provenance", group: "security", cmd: ["node", "scripts/db/audit_ddl_provenance.mjs"],
    why: "objeto exigido sem arquivo de DDL que o crie e uma restauracao que ninguem consegue reproduzir a partir do codigo (Issue #266)" },
  { id: "ddl-provenance-tests", group: "security", cmd: ["node", "scripts/db/test_ddl_provenance.mjs"],
    why: "o inventario precisa DISTINGUIR: achar criador quando existe e NAO achar quando nao existe" },
  { id: "closure-keyword-gate", group: "security", cmd: ["node", "scripts/audit_commit_message_closure_keywords.mjs"],
    why: "palavra-chave de fechamento do GitHub dentro de uma negacao FECHA a Issue que a frase diz nao fechar (Issue #250)" },
  { id: "closure-keyword-gate-tests", group: "security", cmd: ["node", "scripts/test_audit_commit_message_closure_keywords.mjs"],
    why: "precisao E cobertura do gate acima: um gate que nao morde da falsa seguranca, e um que morde demais e desligado na primeira semana" },
  { id: "commit-message-pii-gate-tests", group: "security", cmd: ["node", "scripts/test_audit_commit_message_pii.mjs"],
    why: "prova, contra um repositorio git temporario real, que o escopo forward-only realmente exclui historia anterior e que um valor real-shaped e bloqueado enquanto um valor sintetico e uma mencao generica passam" },
  { id: "sentinel-finding-schema", group: "security", cmd: ["node", "scripts/sentinel/test_finding_schema.mjs"],
    why: "Engineering Sentinel V1.0-A: o contrato canonico de Finding e a unica coisa que toda etapa posterior (fingerprint, policy, writer) confia sem revalidar" },
  { id: "sentinel-fingerprint", group: "security", cmd: ["node", "scripts/sentinel/test_fingerprint_sanity.mjs"],
    why: "fingerprint determinístico e a base de todo o modelo de dedupe do Sentinel; um fingerprint que muda sozinho vira 'um Issue por scan', exatamente o que a arquitetura existe para evitar" },
  { id: "sentinel-policy", group: "security", cmd: ["node", "scripts/sentinel/test_policy.mjs"],
    why: "prova o clamp determinístico: uma sugestão de IA nunca pode baixar a severidade abaixo do piso da regra, so pode subir" },
  { id: "sentinel-github-state", group: "security", cmd: ["node", "scripts/sentinel/test_github_state.mjs"],
    why: "o bloco HTML embutido e o unico armazenamento de estado do Sentinel (sem Supabase) — precisa sobreviver a JSON malformado, texto humano ao redor, e re-escrita idempotente sem duplicar o marcador" },
  { id: "sentinel-change-intent-detector", group: "security", cmd: ["node", "scripts/sentinel/test_change_intent_stale_detector.mjs"],
    why: "prova que o detector reusa D3 (nao reimplementa) e que teria pego #223 e o precedente 4044a438 automaticamente" },
  { id: "sentinel-acceptance", group: "security", cmd: ["node", "scripts/sentinel/test_acceptance.mjs"],
    why: "as 10 cenarios de aceitacao exigidos pela arquitetura aprovada (dedupe, corrida, resolucao em 3 ciclos, recorrencia, override humano, staleness, retry sem duplicata) contra um cliente GitHub falso — nenhum Issue real e tocado" },
  { id: "sentinel-security", group: "security", cmd: ["node", "scripts/sentinel/test_security.mjs"],
    why: "injecao de shell/log, quebra do marcador embutido por texto adversarial, e vazamento de token nos logs — a mesma disciplina de scripts/pii_detectors.mjs, aplicada ao Sentinel" },
  { id: "sentinel-main-ci-red-detector", group: "security", cmd: ["node", "scripts/sentinel/test_main_ci_red_detector.mjs"],
    why: "Engineering Sentinel V1.0-B: prova a taxonomia de classificacao de run (9 valores) e que a recuperacao exige confirmacao POSITIVA (SUCCESS), nunca inferida por ausencia — reproduz os runs reais #219 (falha) e PR #220 (recuperacao) como ground truth" },
  { id: "sentinel-main-ci-red-acceptance", group: "security", cmd: ["node", "scripts/sentinel/test_main_ci_red_acceptance.mjs"],
    why: "prova, via runOnce() real, que um CANCELLED nunca avanca o ciclo limpo nem resolve, que um SUCCESS confirmado resolve em exatamente 1 ciclo (nao 3), e que a recorrencia reabre o MESMO Issue" },
  { id: "sentinel-result-email-gap-detector", group: "security", cmd: ["node", "scripts/sentinel/test_result_email_gap_detector.mjs"],
    why: "Issue #373: uma lacuna de e-mail de resultado ja conhecida reprovava toda execucao agendada do vigia, e alarme cronico e alarme silenciado. Prova o ciclo HEALTHY/GAP_DETECTED/GAP_STILL_OPEN/RECOVERED sobre o state store do Sentinel, que UNKNOWN nunca e deduplicado nem tratado como saudavel, que recuperacao exige confirmacao positiva, e o controle de mutacao que mata uma dedupe que pararia de acusar lacuna NOVA" },
  { id: "sentinel-project-enrichment-isolation", group: "security", cmd: ["node", "scripts/sentinel/test_project_enrichment_isolation.mjs"],
    why: "Um erro de Projects v2 (o GITHUB_TOKEN nao pode receber o escopo `project`) escapava do upsertFinding e virava veredito: um GAP_STILL_OPEN corretamente classificado, que tem de sair 0, reprovava a run — o alarme cronico de volta por um motivo que nada tem a ver com o achado, e contra o que a propria sentinel.yml documenta (falha de campo do Project e caminho de reparo do reconcile.mjs, nao crash). Prova que estado do incidente e veredito de transicao nao dependem do enriquecimento, que GAP_DETECTED/UNKNOWN continuam reprovando, que falha de escrita CORE (Issue/state block) continua fatal, e a mutacao provando que tirar o isolamento reprova a suite" },
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
  { id: "live-evidence-expiry", group: "app", cmd: ["node", "bolao/shared/scripts/test_live_evidence_expiry.mjs"],
    why: "incidente 2026-09-02/03: com o produtor parado, o snapshot congelado era re-servido como observacao NOVA e a pagina afirmou AO VIVO por 829 min sobre um 0x0 do 14' de um jogo encerrado 2x0. Este gate prova que a evidencia ao vivo tem prazo, que o limiar e o MESMO do contrato de frescor, que idade NUNCA vira FINAL e que POSTPONED/SUSPENDED/FINAL declarados pela fonte mandam" },
  { id: "cdb-multi-upcoming-tie", group: "app", cmd: ["node", "bolao/cdb2026/scripts/audit_multi_upcoming_tie.mjs"],
    why: "incidente 2026-09-02: com dois jogos simultaneos (401909110 e 401909111) o CDB2026 mostrou UM -- `if (group.length > 1)` escondia o unico remanescente depois de excluir a primaria. Quebrava so em EXATAMENTE 2, por isso nenhum gate viu. Mutacao (`--mutar`) restaura o off-by-one e tem de reprovar" },
  { id: "pipeline-monitor", group: "scheduling", cmd: ["node", "bolao/scripts/test_pipeline_monitor.mjs"],
    why: "todos os incidentes do pipeline ao vivo em 2026-08 foram descobertos por alguem abrir o site e ver que estava errado; a CI de browser chegou a tropecar em alguns por acidente, o que e pior que nao detectar. Este gate prova que o vigia classifica certo, NAO repete alarme enquanto o mesmo incidente persiste (uma indisponibilidade de 3h e UM incidente, nao um por ciclo), reconhece recuperacao sozinho, usa os limiares do contrato compartilhado em vez de numeros proprios, e nao le nada de participante" },
  { id: "cron-coverage", group: "scheduling", cmd: ["node", "bolao/scripts/cron_coverage.test.mjs"],
    why: "scheduled workflows cover the expected event calendar" },
  // Issue #259 — o agendamento fora da janela era inerte por aritmetica (30 min de cadencia contra
  // um teto de 10 min de ultimo-bom-conhecido) e nem exercitava o caminho, porque o produtor pula
  // antes da rede. Removido; este gate fixa a decisao e a aritmetica, para que a proxima cadencia
  // que nao caiba no teto reprove pelo motivo certo em vez de parecer razoavel.
  { id: "live-producer-cadence", group: "scheduling", cmd: ["node", "bolao/scripts/test_live_producer_cadence.mjs"],
    why: "cadencia agendada tem de caber no teto do gateway, e a janela de jogo tem de continuar coberta (Issue #259)" },
  { id: "live-producer-dispatch", group: "scheduling", cmd: ["node", "workers/live-producer/test_live_producer.mjs"],
    why: "o cron Cloudflare so pode acordar o produtor GitHub conhecido; nao busca ESPN, nao normaliza e nao toca banco (#246)" },
  // Issue #180 — o ledger duravel do e-mail de resultado do CDB2026 e o detector de lacuna.
  // O caso que mais importa nao e achar a lacuna: e NAO transformar uma queda de banco numa
  // acusacao de e-mail perdido, e nunca deixar o ledger bloquear um envio legitimo.
  { id: "cdb-reconcile-migration-equivalence", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_reconcile_migration_equivalence.py"],
    why: "a correcao de `column reference status is ambiguous` toca o corpo inteiro da funcao que reconcilia 12 entregas reais -- diff ruidoso e o lugar classico para uma guarda sumir sem ninguem notar. Prova MECANICAMENTE que, removida a qualificacao, os dois corpos sao identicos, e que guardas, honestidade, assinatura e grant continuam os mesmos" },
  { id: "cdb-ledger-reconciliation", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_reconcile_result_email_ledger.py"],
    why: "a reconciliacao historica ESCREVE em producao, entao o que importa nao e ela funcionar: e ela RECUSAR todo cenario que nao seja exatamente o revisado (conjunto diferente, parcial, entry_ref duplicado, alvo errado, placar divergente, evidencia de provedor insuficiente, ledger ilegivel), ser atomica, ser idempotente, nunca fabricar provider_message_id nem hora de entrega, e nao ter caminho algum para emitir e-mail" },
  { id: "cdb-result-email-ledger-lifecycle", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_result_email_ledger_lifecycle.py"],
    why: "Issue #352: o adaptador do ledger conversava com RPCs que ninguem tinha lido — passava content hash onde a RPC quer UUID, marcava entrega numa transicao que exige `processing`, e lia uma coluna `entity_id` que a RPC nao devolve. Os tres eram invisiveis porque o dublê antigo nao modelava restricao nenhuma. Este gate usa um dublê FIEL (tipo do id, transicao de estado, 0 linhas levanta) e prova cada defeito por mutacao isolada" },
  { id: "cdb-result-email-recovery", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_recover_result_email.py"],
    why: "a recuperacao entrega UMA notificacao perdida; o jeito dela causar dano nao e falhar, e acertar o alvo errado ou reenviar para quem ja recebeu (a classe da #221). Este gate prova que ela RECUSA em todo caso duvidoso — ledger ilegivel, linha ambigua, entrega parcial, confronto/perna invalidos, placar divergente — e que nao existe fallback para a ultima perna" },
  { id: "cdb-partial-recover", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_partial_result_email_recovery.py"],
    why: "#400: envio interrompido no meio do lote deixa parte dos participantes sem o resultado, e o recuperador TOTAL nao serve (so age quando ninguem recebeu, e entao manda para todos -- duplicaria, incidente #221). Este gate prova que o caminho PARCIAL mira exatamente o subconjunto autorizado, que pendencia no ledger NAO abre o caminho sozinha, e que um ref ja entregue e estruturalmente inalcancavel (refs e estreitado no preflight, nao filtrado no laco). Quatro mutacoes provam que a protecao morde e que a defesa em profundidade e real" },
  { id: "cdb-missing-refs-parsing", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_missing_refs_parsing.py"],
    why: "#400: `missing_refs` do workflow vira argumento de um comando que manda e-mail para gente real. Este gate prova a camada LEXICA — vazio, formato, duplicata, teto, metacaractere de shell, quebra de linha (que truncava a lista em silencio) — e que a mensagem de erro nao ecoa o token perigoso. Uma mutacao prova que e a regex que protege. A camada SEMANTICA (conjunto exato do ledger) e do cdb-partial-recover" },
  { id: "cdb-result-email-auto-flow", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_result_email_auto_flow.py"],
    why: "incidente 2026-08-26: a perna foi gravada e ninguem recebeu e-mail porque `sb_save_leg()` virou mutacao estreita (status, None) e o chamador continuou lendo `state` do retorno. Este gate exercita run_auto() INTEIRO — gravar, decidir, reservar no ledger, enviar — com o contrato REAL das funcoes, que e a junta que nenhum teste de unidade cobria" },
  { id: "cdb-result-email-ledger", group: "notifications", cmd: ["python3", "bolao/cdb2026/scripts/test_result_email_ledger.py"],
    why: "UNKNOWN nao pode virar GAP, e o ledger nao pode impedir um e-mail de resultado de sair (Issue #180)" },

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
  { id: "harness-ports-unique", group: "app", cmd: ["node", "bolao/scripts/test_harness_ports_unique.mjs"],
    why: "duas suites na mesma porta fazem a SEGUNDA morrer com \"porta em uso\" — e quem falha costuma ser uma suite sem relacao com a mudanca" },
  { id: "cdb-bracket-persistence", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/test_bracket_persistence.mjs"],
    why: "o bracket completo tem de sobreviver a Salvar + recarregar: \"a RPC devolveu 200\" nao prova que os dados voltam" },
  { id: "cdb-bracket-browser", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/test_bracket_browser.mjs"],
    why: "o bracket de previsao no navegador REAL: quartas -> semifinal -> final -> campeao, sem salvar. O gate de unidade passava enquanto a producao renderizava undefined" },
  { id: "cdb-bracket-propagation", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_bracket_propagation.mjs"],
    why: "a semifinal reage ao palpite das quartas SEM salvar; e nao inventa vaga sem o mapeamento oficial da CBF" },
  { id: "cdb-schedule-reconciler", group: "app", cmd: ["python3", "bolao/cdb2026/scripts/test_schedule_reconciler.py"],
    why: "\"a fonte nao respondeu nada\" nao pode virar \"a CBF nao publicou\": janela larga demais esvazia a resposta em silencio, e um apelido divergente segura a tabela inteira" },
  { id: "cdb-trusted-ingestion", group: "security", cmd: ["python3", "bolao/cdb2026/scripts/test_trusted_result_ingestion.py"],
    why: "resultado oficial move dinheiro; a matriz de identidade (ano/fase/mando/regressao terminal) e o que separa o placar certo de um jogo plausivel entre os mesmos clubes" },
  { id: "canary-ownership-isolation", group: "security", cmd: ["python3", "bolao/scripts/test_canary_ownership_isolation.py"],
    why: "um verificador so pode destruir o que ele mesmo criou; escolher recurso real por indice foi como o link do operador morreu duas vezes" },
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
  { id: "cdb-tie-completeness", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_tie_completeness.mjs"],
    why: "Issue #167: um confronto sem teamA/teamB local nao rendeia bloco, e validatePicks() so olhava o DOM ja filtrado -- uma entrada podia salvar faltando um confronto inteiro, sem erro nenhum" },
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
  { id: "deploy-convergence", group: "browser", cmd: ["node", "bolao/scripts/test_deploy_convergence.mjs"],
    why: "um deploy publicado que nao chega ao usuario nao foi entregue, foi so publicado. Em 2026-08-27 a producao servia o bundle corrigido e o navegador seguia no aplicativo antigo. Este gate publica DE VERDADE duas versoes contra o service worker REAL do repositorio e deixa o navegador decidir; prova ainda que a aba aberta observa o carimbo `?v=` (unico por commit, garantido pelo bot) e nao `siteVersion` (bumpado A MAO, parado em v3.137 por cinco deploys), e que um formulario de palpites SUJO nunca e recarregado por baixo do participante" },
  { id: "state-convergence", group: "app", cmd: ["node", "bolao/shared/scripts/test_state_convergence.mjs"],
    why: "medido em producao: uma entrada tinha 4/4 palpites no remoto e 0/4 no localStorage, e os dois lados, sem `updatedAt`, caiam no mesmo `createdAt`. Com `>` ESTRITO o remoto nunca vencia e a copia velha sobrevivia para sempre -- recarregar nao resolvia e nunca ia resolver. Este gate trava o invariante nos TRES apps e cobre a #258: falha DEPOIS do commit nao pode virar Erro ao salvar, e o diagnostico que sai para o canal de reporte e um enum fechado, nunca texto de PostgREST" },
  { id: "hero-composition", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_hero_composition.mjs"],
    why: "duas vezes o #246 foi dado como resolvido por `hidden === false`, e duas vezes a producao provou que isso nao e aceitacao: hero montado e VAZIO no BR, e no CDB uma pagina que dizia \"Aguardando sorteio oficial\" com os quatro confrontos das quartas logo abaixo e a mesma partida renderizada DUAS vezes. Este gate prova composicao semantica: o estado do sorteio nao pode contradizer o proprio conteudo da pagina, e um confronto nao pode ter duas apresentacoes primarias" },
  { id: "hero-always-mounted", group: "app", cmd: ["node", "bolao/shared/scripts/test_hero_always_mounted.mjs"],
    why: "o hero de futebol sumiu da producao repetidas vezes, sempre por um gatilho diferente (gateway fora, cache vencido, cron atrasado, ESPN bloqueando) e sempre pelo mesmo motivo: cada app decidia sozinho `if (!aoVivo) esconde`. Este gate prova o invariante do #246 -- a EXISTENCIA do hero nao depende de status HTTP, frescor, horario de produtor, rede ou de haver jogo agora. Varre a matriz de falha inteira, as transicoes de frescor, e tem controle negativo para cada mutacao que restauraria o esconde" },
  { id: "standings-reconcile", group: "app",
    cmd: ["node", "bolao/br2026/scripts/test_standings_reconcile.mjs"],
    why: "a tabela ao vivo do BR2026 alimenta G4/Z4, que e o que o bolao pontua. O complemento da baseline usava `kickoff >= capturedAt`, e `capturedAt` e a hora em que O NAVEGADOR abriu a pagina: quem entrou tarde perdia os jogos da noite, quem estava com a aba aberta somava os mesmos jogos, e quando a ESPN ingerisse o resultado contaria duas vezes. Visto em producao 2026-08-30 (Mirassol 1x1 Palmeiras aparecia como Encerrado e a tabela seguia com 24 jogos). Este gate prova que cada partida encerrada conta EXATAMENTE UMA VEZ, independente do visitante e do atraso do feed de classificacao, com controle negativo reproduzindo o criterio antigo" },
  { id: "observation-cadence", group: "app",
    cmd: ["node", "bolao/shared/scripts/test_observation_cadence.mjs"],
    why: "Issue #379, visto em producao: com o pipeline saudavel, o relogio do hero congelava e a tela dizia \"Atualizacao atrasada · ha 4 min\" durante ~2 de cada 5 minutos. O teto de interpolacao era medido contra o intervalo de poll do CLIENTE (3x60s=180s), mas quem limita o frescor da observacao e a cadencia do PRODUTOR (cron de 5 em 5 min, #369) — entao TODA janela normal passava do teto. Este gate prova que o teto segue quem ESCREVE, que dentro da cadencia o relogio corre sem alarme, e que acima dela o atraso real continua sendo dito. Controle negativo nos dois sentidos" },
  { id: "hero-copy-contract", group: "app", cmd: ["node", "bolao/shared/scripts/test_hero_copy_contract.mjs"],
    why: "o invariante de EXISTENCIA do hero ficou verde e o TEXTO continuou regredindo: \"Dados ao vivo temporariamente indisponiveis\" impresso embaixo de uma proxima partida autoritativa que a queda da fonte nao torna incerta, e \"Encerra em\" impresso acima de \"Prazo encerrado\". Este gate prova o contrato de texto -- degradacao so vira aviso quando o conteudo exibido depende do frescor, e sorteio LOCKED nunca produz linguagem de espera de sorteio -- com controle negativo para cada mutacao que reintroduziria os dois defeitos" },
  { id: "live-hero-reliability", group: "app", cmd: ["node", "bolao/scripts/audit_live_hero_reliability.mjs"],
    why: "hero nao pode sumir por falha transitoria: retencao de ultimo estado confirmado, TTL 15min, sem inventar resultado" },
  { id: "powerball-reversal-integrity", group: "app", cmd: ["python3", "bolao/loterias/powerball/scripts/test_payment_writer_integrity.py"],
    why: "reversao precisa ser o inverso exato do alvo e da MESMA participacao — nenhuma constraint do banco prova isso, e o escritor real chegou a nao existir" },
  { id: "report-intake", group: "app", cmd: ["node", "scripts/report/test_report_intake.mjs"],
    why: "intake de reporte e canal externo NAO confiavel: schema allowlist, corpus adversarial, redacao, fail-closed e limites (Issue #321)" },
  { id: "report-security-ratchets", group: "app", cmd: ["node", "scripts/report/test_report_security_ratchets.mjs"],
    why: "propriedades que nao podem regredir: zero segredo no navegador, alvo nunca publico, sem credencial ampla, CORS sem curinga, log sem segredo" },
  { id: "report-ui", group: "app", cmd: ["node", "scripts/report/test_report_ui.mjs"],
    why: "com a flag desligada a UI nao pode existir (botao morto ensina que reportar nao funciona), e os quatro idiomas nao podem divergir no aviso de privacidade (Issue #321)" },
  { id: "worker-intake", group: "app", cmd: ["node", "scripts/report/test_worker_intake.mjs"],
    why: "o intake virou Cloudflare Worker: exercita Request/Response REAIS (a #324 foi um 500 que nenhum teste de unidade pegou), interruptor, idempotencia sem corrida, janela deslizante e sanitizacao de excecao (Issue #321)" },
  { id: "docs-drift", group: "app", cmd: ["node", "scripts/report/test_docs_drift.mjs"],
    why: "documentacao canonica que descreve um runtime que nao existe e pior que documentacao ausente — mede ARQUITETURA, nunca prosa (Issue #321)" },
  { id: "worker-isolation", group: "app", cmd: ["node", "scripts/report/test_worker_isolation.mjs"],
    why: "a credencial financeira nao pode voltar a existir no runtime de reporte: a lista de bindings E a fronteira, entao ela e testada (Issue #321, ADR-021)" },
  { id: "pii-fingerprints", group: "app", cmd: ["node", "scripts/test_pii_fingerprints.mjs"],
    why: "nome de pessoa nao tem sintaxe, entao o detector de FORMA nunca o veria — a lista fechada mora fora do repo e UNAVAILABLE nunca vale como PASS (Issue #181/#195)" },
  { id: "detector-source-hygiene", group: "app", cmd: ["node", "scripts/test_detector_source_hygiene.mjs"],
    why: "os 5 arquivos que o scan de PII PULA nao ficam isentos de disciplina — dois deles guardavam PII real e o gate nao os via" },
  { id: "powerball-public-projection", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/test_public_projection.mjs"],
    why: "allowlist explicita, injecao de campo sensivel provada barrada, e semantica financeira do artefato publico derivado" },
  { id: "powerball-projection-drift", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/generate_public_projection.mjs", "--check"],
    why: "data.js e DERIVADO: edicao manual de valor/cotas/metodo diverge do banco e reprova (Issue #303-A)" },
  { id: "powerball-ledger-totals", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/test_ledger_totals.mjs"],
    why: "CONTRIBUTION_TOTAL != GROSS_LEDGER_SUM: somar todos os tipos e comparar com o total historico de contribuicoes inventa divergencia que nao existe" },
  { id: "live-gateway", group: "app", cmd: ["node", "bolao/scripts/audit_live_gateway.mjs"],
    why: "gateway: cache, degradacao, injecao de falha da ESPN, seguranca contra proxy aberto" },
  { id: "migration-idempotency", group: "app", cmd: ["node", "scripts/db/audit_migration_idempotency.mjs"],
    why: "migracao NOVA nao reaplicavel trava o pipeline inteiro e o deploy das Edge Functions junto (Issue #306)" },
  { id: "sentinel-migrations-api", group: "app", cmd: ["node", "scripts/sentinel/test_supabase_migrations_api.mjs"],
    why: "401/403 devolvem resposta bem formada SEM migracao nenhuma; trata-la como lista vazia abriria alarme de deriva sobre todas (ADR-020)" },
  { id: "sentinel-migration-drift", group: "app", cmd: ["node", "scripts/sentinel/test_migration_drift_detector.mjs"],
    why: "migracao no repo que producao nunca aplicou foi a causa raiz da #306; UNKNOWN nao vira alarme nem alta medica (Issue #310-B)" },
  { id: "sentinel-live-deploy-drift", group: "app", cmd: ["node", "scripts/sentinel/test_live_deploy_drift_detector.mjs"],
    why: "deriva main-vs-producao vira fato duravel e deduplicado no cron do Sentinel; UNKNOWN nunca vira alarme de deriva (Issue #310)" },
  { id: "live-function-drift", group: "app", cmd: ["node", "scripts/db/audit_live_function_drift.mjs"],
    why: "merge != deploy: o manifesto tem de acompanhar a funcao, e producao e comparada por x-deploy-sha (Issue #306)" },
  { id: "live-function-drift-tests", group: "app", cmd: ["node", "scripts/db/test_live_function_drift.mjs"],
    why: "UNKNOWN nunca pode parecer LIVE_MATCHES_MAIN, e o hash tem de mudar quando a funcao muda" },
  { id: "freshness-contract", group: "app", cmd: ["node", "bolao/scripts/test_freshness_contract.mjs"],
    why: "FRESH/STALE_BUT_USABLE/UNAVAILABLE: fronteiras exatas, limiar com dono unico, e a prova de que LER nao rejuvenesce dado" },
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
  { id: "cachebust-app-shared-files", group: "app", cmd: ["node", "bolao/scripts/test_cachebust_app_shared_files.mjs"],
    why: "incidente 2026-09-03 (run 33786641021): where_to_watch.js em SHARED_FILES global exigia referencia em TODO app, inclusive copa2026 que nunca o carrega — sync_version.yml falhou (write copa2026) e o commit/deploy dos tres apps foi abortado. Prova o comando REAL do workflow (write --app=copa2026,br2026,cdb2026) com EXIT 0 contra copia do repo real, idempotencia, e que a tag de copa2026 nunca depende do conteudo de um modulo que ele nao consome" },
  { id: "cdb-next-match-venue", group: "app", cmd: ["node", "bolao/cdb2026/scripts/test_next_match_venue.mjs"],
    why: "producao 2026-09-03 (Gremio x Internacional, volta das quartas): o card nao mostrava o local. O renderizador estava certo; o DADO nao -- as 8 pernas de `quartas` tinham venue/city null porque o backfill de agenda era guardado por `if (m.kickoff) return`, entao quem gravasse a data primeiro fixava o local para sempre. Prova as duas correcoes: o latch desfeito (sem remarcar kickoff, sem tocar placar) e o enriquecimento de apresentacao a partir da observacao ja carregada (sem rede, sem estado, local armazenado sempre vence). Prova tambem que o 📍 e UMA implementacao por app, nos dois apps, como na Copa" },
  { id: "where-to-watch", group: "app", cmd: ["node", "bolao/shared/scripts/test_where_to_watch.mjs"],
    why: "\"Onde assistir\" e enriquecimento OPCIONAL: sem transmissao confirmada a linha nao existe e o card fica identico ao de antes. Este gate prova o fail safe, a chave de associacao (id ESPN, senao minuto de inicio + os DOIS times), a nao-duplicacao, o escape proprio e — o que mais importa — que o modulo continua removivel: nada de rede, nada de countdown, nada de scoring, e um unico ponto de consumo guardado em cada app" },
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
  { id: "br-round-close-preflight", group: "notifications",
    cmd: ["python3", "bolao/br2026/scripts/test_round_close_preflight.py"],
    why: "fechamento de rodada e e-mail pos-apito-final: rodada so fecha com TODOS os N jogos terminais, scoring/ranking finalizados antes da notificacao, e exatamente um e-mail por destinatario (aceito/incerto nunca reenviam)" },

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

  // Issue #248. Estes DOIS existem porque uma pergunta determinística e uma pergunta sobre
  // disponibilidade de terceiro estavam colapsadas no gate `accessibility` — e por isso #245 e
  // #247 reprovaram no MESMO check por um motivo externo aos dois.
  //
  //   `live-gateway-fixtures` — SEM rede, gate obrigatório: prova que os mocks que a suíte de
  //   acessibilidade usa continuam iguais ao que a Edge Function realmente emite. Um mock que
  //   derrapa do produto deixa o gate verde testando ficção.
  //
  //   `live-gateway-health`   — COM rede, `requires: "network"`: sonda o gateway implantado de
  //   verdade. O CI é hermético e não declara VERIFY_ALLOW_NETWORK=1, então lá ele é SKIPPED —
  //   nunca PASSED. Disponibilidade de terceiro não decide se o código de outra pessoa entra;
  //   e ainda assim a degradação continua VISÍVEL, com evidência, para quem rodar com rede.
  { id: "live-gateway-fixtures", group: "provider", cmd: ["node", "bolao/shared/scripts/test_live_gateway_fixtures.mjs"],
    why: "os fixtures do gateway usados pelo gate de acessibilidade tem de casar com o schema que live-football realmente emite (matches:null != matches:[])" },
  // Issue #246: o produtor que grava live_sports_cache a partir do egresso do GitHub Actions,
  // que alcanca a ESPN onde o Edge Runtime leva 403 da Akamai. Suite DETERMINISTICA (fetch e
  // escrita injetados): prova que fonte caida ou forma invalida NUNCA sobrescrevem o
  // ultimo-bom-conhecido, que o envelope gravado e o CANONICO do gateway (e nao o do snapshot),
  // e que so live_sports_cache e tocada.
  { id: "live-cache-producer", group: "provider", cmd: ["node", "bolao/shared/scripts/test_produce_live_cache.mjs"],
    why: "produtor do cache ao vivo: falha da fonte nao pode envenenar o ultimo-bom-conhecido, e o envelope gravado tem de ser o que a Edge Function monta" },
  { id: "live-gateway-health", group: "provider", cmd: ["node", "bolao/shared/scripts/check_live_gateway_health.mjs"],
    why: "saude REAL do gateway live-football: FRESH/STALE/SOURCE_UNAVAILABLE/GATEWAY_DOWN/UNKNOWN por competicao — o sinal de disponibilidade que so existia por acidente dentro do gate de acessibilidade", requires: "network" },

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
    why: "F20: insumos do pacote de review prontos; geracao pos-auth e mecanica", requires: "reviewsDir" },
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
  { id: "security-api-exposure", group: "security", cmd: ["node", "bolao/scripts/security/check_api_exposure.mjs"],
    why: "Revisao 2026-08-02: inventario de https:// referenciado, SRI em <script src>, service_role nunca em front-end" },
  { id: "security-public-secrets", group: "security", cmd: ["node", "bolao/scripts/security/check_public_secrets.mjs"],
    why: "Revisao 2026-08-02: varre segredo privilegiado (service_role, chave privada, token) contra allowlist conhecida" },
  { id: "security-xss-sinks", group: "security", cmd: ["node", "bolao/scripts/security/check_xss_sinks.mjs"],
    why: "Revisao 2026-08-02: eval/new Function/document.write sao zero-tolerancia (docs/bolao/SECURITY.md)" },
  { id: "security-rate-limit-docs", group: "security", cmd: ["python3", "bolao/scripts/security/check_rate_limit_docs.py"],
    why: "Revisao 2026-08-02: RATE_LIMIT_POLICY.md nao pode divergir dos limites reais em config.js" },
  { id: "security-sql-patterns", group: "security", cmd: ["python3", "bolao/scripts/security/check_sql_patterns.py"],
    why: "Revisao 2026-08-02: padrao de injecao SQL/comando; repositorio nao tem cliente SQL hoje" },
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
  { id: "br-round-email-durable-ledger", group: "notifications", cmd: ["python3", "bolao/br2026/scripts/test_round_email_durable_ledger.py"],
    why: "Issue #221: a rodada 23 foi enviada 4x para os 11 participantes reais porque o repositorio de producao nunca persistia entre execucoes. Prova exactly-once ENTRE processos novos (nao so dentro do mesmo objeto Python): reproduz o defeito real com um repositorio nao duravel, prova zero duplicatas com AtomicRoundLedgerRepo em 100 execucoes sequenciais e 10 workers concorrentes, parcial/incerto retentam so o que precisa, e a fiacao de producao usa o repositorio duravel" },
  { id: "br-round-state", group: "scoring", cmd: ["python3", "bolao/br2026/scripts/test_round_state.py"],
    why: "F1/F2: identidade canonica de rodada, proveniencia oficial, R21 nao bloqueia R22" },
  { id: "br-historical-ledger-epoch-guard", group: "notifications", cmd: ["python3", "bolao/br2026/scripts/test_historical_ledger_epoch_guard.py"],
    why: "incidente 2026-08-18: a rodada 22 (concluida e notificada em 2026-08-11) foi reenviada na primeira execucao apos o rearme do #221, porque sua unica evidencia de entrega ficou presa no JSON antigo `roundEmail.ledger` -- orfao desde F8, que so a tabela nova (bolao_round_notif_jobs) passou a alimentar. Prova que nenhuma rodada <= EARLIEST_DURABLE_LEDGER_ROUND pode virar candidata so por ausencia de linha na tabela nova (guardiao de epoca), que o JSON antigo volta a ser lido permanentemente, e que rodadas futuras legitimas continuam enviando normalmente" },
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
  { id: "powerball-scoring-email-placeholder", group: "scoring", cmd: ["python3", "bolao/loterias/powerball/scripts/test_audit_scoring_email_placeholder.py"],
    why: "Issue #134: o placeholder documentado 'sem e-mail no cadastro' (em-dash) nao pode ser rejeitado como e-mail invalido pela auditoria obrigatoria de pre-envio" },
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
  // Rodava em `npm run test:node` e faltava AQUI — exatamente a metade-do-caminho que o N21
  // descreve: estar numa lista e nao na outra e um orfao com outro nome.
  { id: "live-hero-width", group: "browser", cmd: ["node", "bolao/br2026/scripts/visual/check_live_hero_width.mjs"],
    why: "o aviso de atraso da #296 alargava a linha do hero e o nome do time escapava da coluna: 320px rolava na horizontal (Issue #316)" },
  { id: "snapshot-publication-guard", group: "app", cmd: ["node", "bolao/scripts/test_snapshot_publication_guard.mjs"],
    why: "commit de bot com GITHUB_TOKEN nao dispara CI; o contrato de gates afetados tem de continuar honesto e rodar ANTES do commit (Issue #316-B)" },
  { id: "br-standings-layout", group: "browser", cmd: ["node", "bolao/br2026/scripts/visual/check_standings_layout.mjs"],
    why: "geometria real da tabela de classificacao do BR2026 (a tela que o participante confere)", requires: "browser" },
  { id: "critical-functionality", group: "browser",
    cmd: ["node", "bolao/scripts/audit_critical_functionality.mjs"],
    why: "regressoes repetidas em que consertar UM defeito removeu ou quebrou OUTRA funcao critica que ja funcionava -- hero sumido, hero vazio, confronto duplicado, 'Ver palpites' perdido numa mudanca de layout, acao sumindo so no telefone. Este gate le bolao/shared/safety/critical_functionality.json e prova, no navegador e nos dois apps, que toda capacidade critica continua PRESENTE/VISIVEL/NAO-VAZIA/UNICA e com o comportamento de estado certo em toda a matriz de provedor e de ciclo de vida, em desktop E mobile. Oito mutacoes provam que ele morde, e um contador de cobertura impede que uma capacidade fique 'protegida' sem nunca ser medida",
    requires: "browser" },
  { id: "multi-live-hero", group: "browser", cmd: ["node", "bolao/scripts/audit_multi_live_hero.mjs"],
    why: "varios jogos simultaneos precisam TODOS aparecer no hero — renderizar so o primeiro foi regressao real", requires: "browser" },
  { id: "multi-live-hero-responsive", group: "browser", cmd: ["node", "bolao/scripts/audit_multi_live_hero_responsive.mjs"],
    why: "o hero com varios jogos ao vivo tem que sobreviver as larguras de celular, nao so a desktop", requires: "browser" },

  // ── comprovante / loterias / assunto (registrados na limpeza de 2026-08-16) ──
  { id: "cdb-receipt", group: "app", cmd: ["python3", "bolao/cdb2026/scripts/test_receipt.py"],
    why: "o comprovante e EVIDENCIA e nao pode vazar PII — renderizacao pura, sem banco e sem rede" },
  { id: "cdb-receipt-catchup-dedupe", group: "app", cmd: ["python3", "bolao/cdb2026/scripts/test_receipt_catchup_dedupe.py"],
    why: "incidente de 2026-08-16 reproduzido: dedupe cross-path do catch-up, participante pulado nunca mais" },
  { id: "cdb-qf-reminder", group: "app", cmd: ["python3", "bolao/cdb2026/scripts/test_qf_reminder.py"],
    why: "o lembrete ROTACIONA credencial antes de enviar: link que resolve para outra entrada mandaria a pessoa editar palpite alheio, e rotacao que encoste em palpite e mutacao silenciosa" },
  { id: "powerball-balance-unicity", group: "app", cmd: ["node", "bolao/loterias/powerball/scripts/test_current_balance_unicity.mjs"],
    why: "a tela tinha DOIS 'quanto temos' com valores diferentes — saldo exibido precisa ter uma fonte so" },
  { id: "powerball-run-31679185588", group: "app", cmd: ["python3", "bolao/loterias/powerball/scripts/test_run_31679185588_regression.py"],
    why: "regressao da run real: e-mails entregues e resultado orfao nao podem coexistir" },
  { id: "lottery-core", group: "app", cmd: ["python3", "bolao/loterias/scripts/test_lottery_core.py"],
    why: "nucleo das loterias" },
  { id: "lottery-adversarial-round2", group: "app", cmd: ["python3", "bolao/loterias/scripts/test_adversarial_round2.py"],
    why: "propriedades geradas, DST e patologias de rede — a rodada que achou o que o teste feliz nao acha" },
  { id: "lottery-failure-injection", group: "app", cmd: ["python3", "bolao/loterias/scripts/test_failure_injection.py"],
    why: "livro-razao: o sinal fazia parte do tipo e ninguem verificava; chave repetida com outro valor sumia" },
  { id: "lottery-jackpot-identity", group: "app", cmd: ["python3", "bolao/loterias/scripts/test_jackpot_identity.py"],
    why: "o jackpot exibido tem que ser o do sorteio CERTO — a pagina de resultado publica o valor SORTEADO" },
  { id: "lottery-prize-authority", group: "app", cmd: ["python3", "bolao/loterias/scripts/test_prize_authority.py"],
    why: "autoridade de premio: dinheiro real por entrada" },
  { id: "subject-policy", group: "security", cmd: ["python3", "bolao/shared/scripts/test_subject_policy.py"],
    why: "assunto de e-mail vem da politica e as MUTACOES provam que o portao morde — a Powerball saia com o icone errado e ninguem olhava" },
  { id: "subject-policy-interop", group: "security", cmd: ["node", "bolao/shared/scripts/test_subject_policy_interop.mjs"],
    why: "a politica de assunto tem que dizer o mesmo em py e js" },
  { id: "allowlist-conditionality", group: "app", cmd: ["node", "bolao/scripts/test_allowlist_conditionality.mjs"],
    why: "a excecao condicional do ALLOWLIST.json e a UNICA brecha na regra 'entrada nao utilizada = defeito'; estas mutacoes provam que ela morde e nao virou porta dos fundos" },

  // ── orfaos de meio-caminho, achados em 2026-08-16 ao construir o contrato de seguranca ──────
  // Os tres RODAVAM em `npm run test:node` e faltavam AQUI. E exatamente o N21 outra vez: estar
  // numa lista e nao na outra e um orfao com outro nome. A ausencia importa porque o contrato
  // permanente exige que o verify.mjs DOMINE a cadeia do npm test — sem dominancia, "rodei o
  // verify" deixa de implicar "rodei o npm test", e a garantia do `npm run check` fica furada.
  { id: "shared-visual-contract", group: "app", cmd: ["node", "bolao/scripts/check_shared_visual_contract.mjs"],
    why: "as fases 2-4 tiraram cada componente compartilhado dos CSS locais A MAO; sem este gate o framework volta a derivar no proximo 'ajuste rapido' feito no arquivo que ja estava aberto" },
  { id: "snapshot-window-coverage", group: "scheduling", cmd: ["node", "bolao/scripts/audit_snapshot_window_coverage.mjs"],
    why: "o hero ja sumiu porque o cron do snapshot era cego das 06:00 as 16:00 UTC — a janela nao cobria o horario do jogo" },
  { id: "cachebust-integration", group: "app", cmd: ["node", "bolao/scripts/cachebust.integration.test.mjs"],
    why: "um ?v= desatualizado publica codigo novo com asset velho; ja aconteceu logo APOS a propria correcao de cache-bust ser publicada (N13)" },
  { id: "br-round-manifest-build", group: "scoring", cmd: ["python3", "bolao/br2026/scripts/build_round_manifest.py"],
    why: "unico comando da cadeia do npm test que nao era um check daqui; sem ele a dominancia do verify sobre o npm test teria de abrir excecao, e excecao em regra de cobertura e por onde o proximo orfao entra" },

  // ── o contrato permanente de seguranca de mudanca ───────────────────────────────────────────
  // Issue #258: um participante reportou "Erro ao salvar" e a investigacao morreu porque o
  // motivo do servidor era descartado em cdbRpc(). Este gate trava as DUAS metades juntas: o
  // motivo chega ao console E a mensagem do participante continua generica (expo-la seria um
  // oraculo de enumeracao).
  { id: "cdb-save-error-diagnosable", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/test_save_error_diagnosable.mjs"],
    why: "a recusa de cdb_save_my_picks (ACESSO_NEGADO/CUTOFF_PASSADO/FASE_FECHADA) precisa ser diagnosticavel sem vazar detalhe tecnico na tela", requires: "browser" },
  { id: "cdb-entry-name-readonly", group: "browser", cmd: ["node", "bolao/cdb2026/scripts/test_entry_name_readonly.mjs"],
    why: "a identidade da entrada e VISIVEL e nao editavel: o participante precisa confirmar qual entrada abriu, e o save (cdb_save_my_picks) nao aceita nome nenhum — a tela tem de dizer a mesma coisa que o servidor faz", requires: "browser" },

  { id: "safety-contract", group: "security", cmd: ["node", "scripts/safety/audit_safety_contract.mjs"],
    why: "meta-gate: nenhuma mudanca pode enfraquecer o proprio portao que a julga, e nenhuma superficie critica pode mudar em silencio" },
  { id: "change-intent-lifecycle", group: "security", cmd: ["node", "scripts/safety/test_change_intent_lifecycle.mjs"],
    why: "ADR-018 (Issue #238): prova o modelo ONE_SHOT/CONDITIONAL isoladamente — shape, invariante MACHINE_VERIFIABLE, e o requisito anti-escape-hatch de que prosa sozinha nunca basta e um check nao pode proteger superficie diferente da declarada" },
  { id: "safety-contract-mutations", group: "security", cmd: ["node", "scripts/safety/test_safety_contract.mjs"],
    why: "as mutacoes que provam que o contrato MORDE; um contrato que nunca fica vermelho e uma decoracao cara" },
  { id: "mutation-isolation", group: "security", cmd: ["node", "scripts/safety/test_mutation_isolation.mjs"],
    why: "Issue #334: a suite de mutacao escreve no disco, e este roda em paralelo com quem LE os mesmos arquivos. Prova, sem depender de timing, que a mutacao vive numa worktree isolada e que nenhum leitor canonico a observa — e que uma arvore suja nunca rende um hash acionavel para o manifesto de deploy" },

];

function capabilities() {
  const browser = existsSync("node_modules/playwright") || existsSync("node_modules/@playwright/test") ||
                  !!process.env.PLAYWRIGHT_BROWSERS_PATH;
  // Egress is not probed: probing costs a network call and can hang. It is declared, not detected.
  const network = process.env.VERIFY_ALLOW_NETWORK === "1";
  // `audit_review_package_readiness.mjs` mede insumos que vivem FORA do repositorio, em
  // `~/Documents/GitHub/ferrarilabs-work/reviews` — o diretorio de trabalho do Eduardo. Isso nao e
  // defeito do gate: o pacote de review independente e montado a partir de material que
  // deliberadamente nao e versionado. Mas significa que ele nunca pode passar noutra maquina, e a
  // primeira execucao de CI o reprovou por isso (3 de 15 checks).
  //
  // Declarado como capacidade, ele vira SKIPPED onde o material nao existe — nunca PASSED. A
  // alternativa seria remove-lo da suite (perder cobertura na maquina onde ele funciona) ou
  // afrouxar as assercoes (verde falso). Nenhuma das duas.
  const reviewsDir = existsSync(join(homedir(), "Documents", "GitHub", "ferrarilabs-work", "reviews"));
  return { browser, network, reviewsDir };
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
