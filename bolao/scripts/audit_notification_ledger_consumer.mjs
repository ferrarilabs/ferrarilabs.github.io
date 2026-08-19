#!/usr/bin/env node
/**
 * audit_notification_ledger_consumer.mjs — F6. Prova CONSUMIDOR REAL do ledger de rodada.
 *
 * ─── POR QUE ESTE GATE EXISTE ────────────────────────────────────────────────────────────────
 *
 * A plataforma já tinha `notification_repository`, `durable_notification_repository`,
 * `notification_worker` e a SQL `010_notification_durability.sql` — tudo bem escrito, testado, e
 * com ZERO consumidores em produção. `grep` por essas classes em `bolao/br2026`, `bolao/cdb2026`,
 * `bolao/copa2026` e `.github/workflows` retornava vazio.
 *
 * É a mesma forma do defeito do FootballLiveStore: capacidade implementada, testada e nunca
 * chamada. Um sistema de notificação que produção não invoca não protege ninguém — e ainda
 * consome a confiança de quem lê a suíte verde.
 *
 * O que NÃO conta como prova de adoção, e o gate recusa explicitamente:
 *   - a SQL existir
 *   - a classe de repositório existir
 *   - o worker existir
 *   - testes de unidade instanciarem
 *   - um script auxiliar referenciar
 *
 * O que conta: o ponto de entrada REAL de produção (o workflow de cron) alcançar o resolver
 * canônico e o ledger durável, no mesmo arquivo que envia.
 *
 * Uso: node bolao/scripts/audit_notification_ledger_consumer.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

const SENDER = "bolao/br2026/scripts/send_round_email.py";
const WORKFLOW = ".github/workflows/br2026_round_emails.yml";

const sender = readFileSync(join(ROOT, SENDER), "utf8");
const workflow = readFileSync(join(ROOT, WORKFLOW), "utf8");

/** Só código executável: prosa que cita um símbolo não é uso dele. */
function codeOnly(py) {
  return py.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
}
const code = codeOnly(sender);

console.log("BR_NOTIFICATION_LEDGER_ACTUAL_CONSUMER\n");

// ─── 1. O ponto de entrada de produção é este arquivo ────────────────────────────────────────
{
  const invoca = new RegExp(`send_round_email\\.py\\s+--(auto|dry-run)`).test(workflow);
  check("BR_CRON_INVOCA_O_SENDER_CANONICO", invoca,
    `${WORKFLOW} não chama ${SENDER}`);
}

// ─── 2. Esse mesmo arquivo consome o modelo canônico de rodada ───────────────────────────────
{
  check("BR_CRON_USES_CANONICAL_ROUND_RECONCILER: importa o manifesto canônico",
    /import build_round_manifest/.test(code));
  check("BR_CRON_USES_CANONICAL_ROUND_RECONCILER: importa o resolver por rodada",
    /import round_state/.test(code));
  check("chama reconcile() de verdade", /ROUNDSTATE\.reconcile\s*\(/.test(code));
  check("valida o manifesto antes de decidir qualquer coisa",
    /MANIFEST\.validate\s*\(/.test(code));
}

// ─── 3. E consome o ledger durável ───────────────────────────────────────────────────────────
{
  check("BR_CRON_USES_DURABLE_NOTIFICATION_LEDGER: importa o ledger",
    /from round_notification_ledger import/.test(code));
  check("instancia RoundLedger no caminho de produção", /RoundLedger\s*\(/.test(code));
  check("cria/reusa o job por rodada", /ledger\.ensure_job\s*\(/.test(code));
  check("aplica o portão de completude de destinatários",
    /ledger\.assert_recipient_completeness\s*\(/.test(code));
  check("reivindica com lease antes de enviar", /ledger\.claim\s*\(/.test(code));
  check("marca início de envio no ledger", /ledger\.mark_sending\s*\(/.test(code));
}

// ─── 4. A janela rolante deixou de decidir elegibilidade ─────────────────────────────────────
{
  check("POSTPONED_OLD_ROUND_DOES_NOT_BLOCK: pendingBatch não decide mais elegibilidade",
    !/get_or_open_batch\s*\(/.test(code),
    "get_or_open_batch() ainda é chamado — a janela rolante voltou a governar");
  check("o estado legado é migrado como evidência, não como trava",
    /LEGACY\.migrate\s*\(/.test(code));
}

// ─── 5. Segurança do dry-run e do envio real ─────────────────────────────────────────────────
{
  check("o dry-run existe como modo de primeira classe do MESMO caminho",
    /def run_auto\(dry_run=False\)/.test(code) && /--dry-run/.test(code));
  // ARMADO em 2026-08-11, DESARMADO em 2026-08-18 (Issue #221): o armamento original assumia
  // que `SupabaseStateRoundLedgerRepo` persistia o ledger de rodada de verdade -- premissa
  // falsa, resultando na rodada 23 sendo enviada 4x para os 11 participantes reais (44 envios
  // em vez de 11). REARMADO no mesmo dia, apos a causa raiz ser corrigida E VERIFICADA:
  // `AtomicRoundLedgerRepo` (migracao 030, PR #226) substitui o repositorio nao duravel, um
  // segundo defeito achado durante a verificacao do rollout (`claim_bolao_notif_round_job`
  // serializava reivindicacao falha como objeto todo-null, PR #228) tambem foi corrigido, e a
  // rodada 23 foi confirmada SENT/11-aceitos/nao-reivindicavel diretamente contra producao
  // antes de rearmar.
  //
  // DESARMADO DE NOVO em 2026-08-18 ~22:14 UTC -- incidente NOVO: a rodada 22 (ja concluida e
  // notificada de verdade em 2026-08-11) foi reenviada aos mesmos 11 participantes reais na
  // primeira execucao apos o rearme acima, porque a troca para `AtomicRoundLedgerRepo` so foi
  // retroativamente povoada para a rodada 23 -- a unica evidencia de entrega da R22 ficou presa
  // no JSON antigo (`roundEmail.ledger`), que nada mais lia. A correcao (merge permanente do
  // JSON antigo + guardiao de epoca `apply_historical_ledger_epoch_guard`) esta implementada e
  // testada (`test_historical_ledger_epoch_guard.py`), mas o rearme e uma mudanca SEPARADA,
  // feita so apos `npm run check` verde e verificacao direta contra producao -- manter a
  // assercao "armado" aqui faria esta suite passar verde enquanto o workflow real continua
  // deliberadamente fechado, o oposto do que este gate existe para garantir.
  check("a autorização de envio permanece fechada (DESARMADO — incidente novo, R22 ressuscitada)",
    !/BOLAO_ALLOW_REAL_SEND:\s*"I UNDERSTAND"/.test(workflow),
    "o token literal de autorização voltou ao workflow antes do incidente de ressurreição da R22 ter sido verificado como corrigido em produção");

  check("o token que o sender exige continua sendo o literal esperado",
    /_ALLOW_TOKEN\s*=\s*"I UNDERSTAND"/.test(sender),
    "o valor que o sender exige mudou sem atualizar este gate — verifique antes de rearmar");

  check("o sender continua fail-closed por padrão (sem a variável, não envia)",
    /def real_send_allowed\(/.test(code) &&
    /return False, f?"?sem autorizacao explicita/.test(code),
    "a trava do sender deixou de ser fail-closed");
}

// ─── 6. Nenhum PII na identidade nem nos eventos ─────────────────────────────────────────────
{
  check("a chave de idempotência não é montada com e-mail",
    !/round_key\s*\([^)]*participantEmail/.test(code));
  check("os eventos operacionais usam id de entrada, não endereço",
    /entry_refs\s*=\s*\[e\["id"\]/.test(code));
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 BR_NOTIFICATION_LEDGER_ACTUAL_CONSUMER FAILED");
  process.exit(1);
}
console.log("\n✓ BR_NOTIFICATION_LEDGER_ACTUAL_CONSUMER PASSED");
