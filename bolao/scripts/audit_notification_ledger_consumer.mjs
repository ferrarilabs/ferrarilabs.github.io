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
  // ARMADO em 2026-08-11, DESARMADO em 2026-08-18 (Issue #221). O armamento assumia que
  // `SupabaseStateRoundLedgerRepo` persistia o ledger de rodada de verdade -- premissa falsa:
  // `put()` so muta um dict em memoria construido de um `sb_fetch()` (GET), sem NENHUM
  // PUT/PATCH/upsert que grave `bolao_state.roundEmail.ledger` de volta no Supabase. Resultado
  // real: a rodada 23 foi enviada 4x para os 11 participantes reais (44 envios em vez de 11) em
  // quatro execucoes agendadas independentes. A autorizacao de 2026-08-11 fica suspensa ate a
  // causa raiz ser corrigida -- religar o claim/settle a um armazenamento que realmente
  // persiste. Manter a assercao antiga (exigindo o token armado) faria esta suite exigir que o
  // produto continuasse duplicando entrega.
  //
  // O que substitui: a autorizacao tem de estar EXPLICITAMENTE ausente (nao apenas "diferente
  // por acidente") e a trava do sender tem de continuar existindo. Duas travas independentes
  // continuam sendo duas -- a diferenca e que agora ambas estao deliberadamente fechadas.
  check("o envio real está deliberadamente desarmado (Issue #221)",
    !/BOLAO_ALLOW_REAL_SEND:\s*"I UNDERSTAND"/.test(workflow),
    "o token de autorização literal ainda está presente — o envio real continuaria armado apesar do incidente de duplicação confirmado");

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
