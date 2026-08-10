#!/usr/bin/env node
/**
 * audit_br2026_narrow_persistence.mjs — F10/N22 Stage 4, gate de transição do BR2026.
 *
 * ─── O QUE MUDOU E POR QUÊ ───────────────────────────────────────────────────────────────────
 *
 * Até 2026-08-10 o BR2026 lia `bolao_state` cru (com `participantEmail`, `payerName`,
 * `paymentMethod`) e gravava o DOCUMENTO INTEIRO com `merge-duplicates`. A anon key vai neste
 * mesmo `js/config.js`, servido a todo navegador — então qualquer portador podia reescrever
 * entradas, pagamentos, resultados e estado de notificação de uma vez só.
 *
 * Agora:
 *   LEITURA : `bolao_state_public` — mesma forma, sem os quatro campos privados.
 *   ESCRITA : `submit_entry` (única anônima). Operador saiu do navegador.
 *
 * ─── POR QUE ESTE GATE INSPECIONA CALL SITES, NÃO NOMES ──────────────────────────────────────
 *
 * Procurar "existe uma função chamada submit_entry" não prova nada — foi assim que o
 * FootballLiveStore ficou carregado, testado e nunca instanciado. Aqui se verifica que o caminho
 * de gravação genérico NÃO EXISTE mais no código, não que um novo tenha nascido ao lado dele.
 *
 * Uso: node bolao/scripts/audit_br2026_narrow_persistence.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = "bolao/br2026/js/app.js";
const CFG = "bolao/br2026/js/config.js";

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

/** Só código executável: prosa que cita um símbolo não é uso dele. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const app = codeOnly(readFileSync(join(ROOT, APP), "utf8"));
const cfg = codeOnly(readFileSync(join(ROOT, CFG), "utf8"));

console.log("BR2026_NARROW_PERSISTENCE (F10/N22 stage 4)\n");

// ─── BR2026_USES_PUBLIC_STATE ────────────────────────────────────────────────────────────────
{
  check("BR2026_USES_PUBLIC_STATE: config declara a projeção pública",
    /readTable:\s*["']bolao_state_public["']/.test(cfg),
    "config.database.readTable precisa apontar para bolao_state_public");
  check("a leitura usa readTable, não a tabela crua",
    /C\.database\.readTable/.test(app),
    "loadRemoteState() não consome readTable");
  check("nenhum SELECT direto de bolao_state no app",
    !/rest\/v1\/bolao_state\b(?!_public)/.test(app) && !/["']bolao_state["']/.test(app),
    "voltou a referenciar a tabela crua");
}

// ─── BR2026_FULL_DOCUMENT_WRITES = 0 ─────────────────────────────────────────────────────────
{
  check("BR2026_FULL_DOCUMENT_WRITES = 0: saveRemoteState() não existe mais",
    !/function\s+saveRemoteState\s*\(/.test(app),
    "a gravação de documento inteiro voltou");
  check("nenhum merge-duplicates no app",
    !/merge-duplicates/.test(app),
    "upsert de documento completo reapareceu");
  check("saveState() não dispara gravação remota",
    !/saveState[\s\S]{0,600}?saveRemoteState\(/.test(app));
  check("nenhum POST para a tabela de estado",
    !/rest\/v1\/\$\{table\}[\s\S]{0,200}?method:\s*["']POST["']/.test(app),
    "há POST direto na tabela de estado");
}

// ─── BR2026_USES_NARROW_MUTATIONS ────────────────────────────────────────────────────────────
{
  check("BR2026_USES_NARROW_MUTATIONS: existe um chamador de RPC estreita",
    /function\s+callNarrowRpc\s*\(/.test(app) && /rest\/v1\/rpc\//.test(app));
  check("a submissão pública chama submit_entry",
    /callNarrowRpc\(\s*["']submit_entry["']/.test(app),
    "o formulário público não usa a RPC estreita");
  check("submit_entry envia clientRef (idempotência)",
    /p_client_ref/.test(app));
  // A janela entre a checagem e o `throw` e arbitraria; o que importa e que exista um throw
  // dentro do corpo de callNarrowRpc apos o teste de !r.ok. Extraimos a funcao e olhamos dentro.
  const corpoRpc = (() => {
    const i = app.indexOf("async function callNarrowRpc");
    if (i < 0) return "";
    const fim = app.indexOf("\n}", i);
    return fim < 0 ? app.slice(i) : app.slice(i, fim);
  })();
  check("a RPC falha FECHADA (lança em resposta não-ok)",
    /if \(!r\.ok\)/.test(corpoRpc) && /throw\s+err/.test(corpoRpc),
    "um 4xx/5xx viraria sucesso silencioso");
  check("a UI distingue criado de reenvio idempotente",
    /created !== false/.test(app) && /entryAlreadyRegistered/.test(app),
    "clique duplo apareceria como cadastro novo");
  check("a UI distingue erro de validação de falha de infraestrutura",
    /httpStatus === 400/.test(app) && /entryRejected/.test(app));
}

// ─── BR2026_PUBLIC_OPERATOR_WRITES = 0 ───────────────────────────────────────────────────────
{
  // Cada operação de operador tem de ter perdido sua gravação. Procuramos a MUTAÇÃO, não o botão:
  // o controle pode continuar visível (para não esconder o estado), mas não pode gravar.
  const mutacoesProibidas = [
    ["marcar pago", /s2\.paid\[[^\]]+\]\s*=\s*true/],
    ["remover pago", /delete\s+s2\.paid\[/],
    ["travar resultados", /s2\.results\s*=\s*\{\s*locked:\s*true/],
    ["destravar resultados", /s2\.results\s*=\s*\{\s*\.\.\.s2\.results,\s*locked:\s*false/],
    ["excluir entrada", /s2\.deletedIds\s*=\s*\[/],
  ];
  for (const [nome, re] of mutacoesProibidas) {
    check(`BR2026_PUBLIC_OPERATOR_WRITES = 0: ${nome} não grava no navegador`,
      !re.test(app), `a mutação "${nome}" voltou ao caminho público`);
  }
  check("o operador é avisado de para onde a ação foi",
    /adminWriteMoved/.test(app),
    "controle desativado sem explicar o caminho correto");
}

// ─── PII fora do navegador ───────────────────────────────────────────────────────────────────
{
  // A projeção não entrega estes campos; o app não pode assumir que existem em caminho crítico.
  check("o app não constrói entrada com campos privados a partir do estado lido",
    !/state\(\)[\s\S]{0,120}?participantEmail/.test(app),
    "há leitura de PII a partir do estado, que a projeção não fornece mais");
}

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 BR2026_NARROW_PERSISTENCE FAILED");
  process.exit(1);
}
console.log("\n✓ BR2026_NARROW_PERSISTENCE PASSED");
