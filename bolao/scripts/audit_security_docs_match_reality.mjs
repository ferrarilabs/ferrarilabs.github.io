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

  // ARMADO em 2026-08-11 (autorizacao explicita do Eduardo para a R22 em diante, apos
  // auditoria independente de scoring e conteudo). Ate aqui este bloco exigia
  // `NotImplementedError` no sender e ausencia de `--auto`/`BOLAO_ALLOW_REAL_SEND` no workflow.
  //
  // Essas tres assercoes provavam "o envio real e inalcancavel". Essa propriedade deixou de ser
  // a desejada -- o envio real e o objetivo agora. Apagar as assercoes sem substituir deixaria
  // o bloco com nome de portao e nenhum portao dentro, que e pior do que nao ter portao.
  //
  // O que continua tendo de ser verdade, e passa a ser verificado aqui:

  check("o envio real EXIGE o ledger atômico — sem ele, bloqueia",
    /atomic_ledger_available\(/.test(code) &&
    /REAL_SEND_REQUIRES_ATOMIC_LEDGER/.test(code),
    "o envio real ficou alcançável sem checar a atomicidade do ledger");

  check("o cron roda o sender canônico em modo de envio",
    /send_round_email\.py\s+--auto\b/.test(wf),
    "o workflow deixou de chamar o sender canônico com --auto");

  check("o transporte é checado ANTES de reivindicar a rodada",
    code.indexOf("real_send_allowed()") < code.indexOf("ledger.claim("),
    "descobrir o bloqueio depois do claim deixa a rodada presa em SENDING sem nenhuma tentativa");

  check("ACEITO e INCERTO nunca entram no conjunto reenviável",
    /REENVIAVEL\s*=\s*\(RECIPIENT_STATE\["PENDING"\],\s*RECIPIENT_STATE\["FAILED"\]\)/.test(code),
    "o conjunto reenviável passou a incluir ACCEPTED ou UNCERTAIN — isso duplica entrega");

  // A regex anterior (`!/alvos\s*or\s*resolved/`) NAO pegava a mutacao real, que escreve
  // `] or resolved`. Foi medido: mutando o codigo, este gate continuava verde. A propriedade
  // agora vive numa funcao pura (`alvos_reenviaveis`) com teste direto em
  // bolao/br2026/scripts/test_round_delivery_loop.py; aqui fica so a exigencia de que a selecao
  // continue passando por ela, em vez de voltar a ser embutida e inauditavel.
  check("a seleção de alvos passa pela função pura auditável",
    /alvos = alvos_reenviaveis\(/.test(code) && /^def alvos_reenviaveis\(/m.test(code),
    "a seleção de destinatários voltou a ser embutida no laço, onde o claim mascara mutações");

  check("destinatário é marcado SENDING antes da chamada ao provedor",
    code.indexOf('RECIPIENT_STATE["SENDING"])') < code.indexOf("saida = send_email("),
    "sem SENDING antes do POST, um crash no meio do transporte fica indistinguível de 'não tentado'");

  check("SENDING órfão é reconciliado para UNCERTAIN, nunca para reenvio",
    /transporte interrompido/.test(code) &&
    /RECIPIENT_STATE\["UNCERTAIN"\]/.test(code));

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
