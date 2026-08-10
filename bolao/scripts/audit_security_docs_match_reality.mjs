#!/usr/bin/env node
/**
 * audit_security_docs_match_reality.mjs — F11 + REAL_SEND_REQUIRES_ATOMIC_LEDGER.
 *
 * ─── F11: A DOCUMENTAÇÃO AFIRMAVA O CONTRÁRIO DA REALIDADE ───────────────────────────────────
 *
 * `docs/bolao/SECURITY.md` dizia, em dois lugares, que não há dado sensível armazenado. Verificado
 * contra produção em 2026-08-10: toda entrada de `bolao_state` carrega `participantEmail`,
 * `payerName` e `paymentMethod`, e a anon key é pública por construção.
 *
 * Uma afirmação falsa num documento de segurança é pior que a ausência do documento: alguém lê
 * "no sensitive data", conclui que a linha de risco já foi avaliada, e não olha de novo. Foi
 * exatamente o que aconteceu — a exposição (F10) conviveu com um documento que a negava.
 *
 * Este gate não tenta julgar prosa. Ele trava uma coisa objetiva: se o código de produção conhece
 * campos de PII, o documento de segurança NÃO pode afirmar que não existe dado sensível, e TEM de
 * citar o achado aberto.
 *
 * ─── TRAVA DE ENVIO REAL ─────────────────────────────────────────────────────────────────────
 *
 * O ledger durável hoje persiste em `bolao_state.roundEmail.ledger` — read-modify-write sobre
 * JSON. É durável, mas não é atômico. Enquanto a migração 010 não estiver aplicada, envio real
 * não pode ser habilitado, e a garantia tem de falhar fechada.
 *
 * Uso: node bolao/scripts/audit_security_docs_match_reality.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

const SECURITY = read("docs/bolao/SECURITY.md");

// Campos de PII que o CÓDIGO DE PRODUÇÃO demonstra existirem no estado público.
const PII_FIELDS = ["participantEmail", "payerName"];
const APP_SOURCES = ["bolao/br2026/js/app.js", "bolao/cdb2026/js/app.js"];

console.log("SECURITY_DOCS_MATCH_REALITY (F11)\n");

const piiNoCodigo = PII_FIELDS.filter((f) =>
  APP_SOURCES.some((src) => new RegExp(`\\b${f}\\b`).test(read(src))));

check("o código de produção realmente manipula campos de PII (premissa deste gate)",
  piiNoCodigo.length > 0, "nenhum campo de PII encontrado — o gate perdeu sua premissa");

if (piiNoCodigo.length > 0) {
  // Negações categóricas proibidas enquanto houver PII no estado público.
  const negacoes = [
    /no sensitive data/i,
    /no sensitive financial data stored/i,
    /nenhum dado sens[ií]vel/i,
    /sem dado sens[ií]vel/i,
  ];
  const encontradas = negacoes.filter((re) => re.test(SECURITY));
  check("SECURITY.md NÃO afirma ausência de dado sensível",
    encontradas.length === 0,
    `afirmações que contradizem produção: ${encontradas.map(String).join(", ")}`);

  check("SECURITY.md nomeia os campos de PII que existem de fato",
    PII_FIELDS.every((f) => SECURITY.includes(f)),
    `campos ausentes do documento: ${PII_FIELDS.filter((f) => !SECURITY.includes(f)).join(", ")}`);

  check("SECURITY.md cita o achado aberto correspondente (F10)",
    /\bF10\b/.test(SECURITY),
    "o documento descreve a exposição mas não a liga ao achado rastreado");

  check("SECURITY.md não classifica a exposição de PII como aceita",
    !/anon key is public \| Accepted/i.test(SECURITY),
    "linha de risco marcada 'Accepted' enquanto a exposição segue aberta");
}

// ─── REAL_SEND_REQUIRES_ATOMIC_LEDGER ────────────────────────────────────────────────────────
console.log("\nREAL_SEND_REQUIRES_ATOMIC_LEDGER");
{
  const sender = read("bolao/br2026/scripts/send_round_email.py");
  const code = sender.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const workflow = read(".github/workflows/br2026_round_emails.yml");
  const wf = workflow.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  check("o caminho de envio real está desabilitado enquanto o ledger não é atômico",
    /NotImplementedError/.test(code),
    "o envio real ficou alcançável com o ledger JSON read-modify-write");

  check("o cron não roda em modo de envio", !/--auto\b/.test(wf), "workflow voltou a --auto");

  check("o job do cron não declara autorização de envio",
    !/BOLAO_ALLOW_REAL_SEND/.test(wf));

  check("o risco de atomicidade está registrado no próprio código, não só em documento",
    /for update skip locked/i.test(sender) && /atomicidade/i.test(sender),
    "o sender não explica por que o ledger atual não basta para envio real");

  // O portão fail-closed do provedor continua existindo, independentemente do resto.
  check("o portão fail-closed do provedor continua no lugar",
    /def real_send_allowed\(/.test(code) && /BOLAO_ALLOW_REAL_SEND/.test(code));
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 SECURITY_DOCS_MATCH_REALITY FAILED");
  process.exit(1);
}
console.log("\n✓ SECURITY_DOCS_MATCH_REALITY / REAL_SEND_REQUIRES_ATOMIC_LEDGER PASSED");
