#!/usr/bin/env node
/**
 * CDB2026 — quem lê a linha CRUA precisa da credencial privilegiada, e o workflow precisa fornecê-la.
 *
 * O DEFEITO QUE ISTO FECHA (2026-08-12, três execuções agendadas seguidas em vermelho)
 * -----------------------------------------------------------------------------------
 * A migração 20260812080000 tirou da `anon` o acesso à linha crua do cdb2026 — ela carrega
 * participantEmail/payerName/paymentMethod dos 12 participantes, e a chave publicável vai em todo
 * config.js servido ao navegador.
 *
 * Antes de revogar, enumerei os consumidores do NAVEGADOR. Não enumerei os scripts server-side.
 * `send_result_email.py` lia a linha crua com a chave anon; a consulta passou a devolver `[]`, e o
 * código fazia `[0]["state"]` direto:
 *
 *     IndexError: list index out of range
 *
 * Três execuções agendadas falharam com uma mensagem que não dizia nada sobre permissão. "Não
 * consigo ver" e "não existe" são coisas diferentes, e só uma delas é bug de dados.
 *
 * Este gate trava as duas metades da lição:
 *   1. todo acesso à linha crua passa pela credencial privilegiada;
 *   2. o workflow que executa esse script realmente injeta essa credencial.
 *
 * A segunda metade importa tanto quanto a primeira: código correto sem o segredo no ambiente
 * falha exatamente igual.
 *
 * HERMÉTICO: lê fonte e YAML. Não faz rede, não usa credencial.
 *
 * Uso: node bolao/cdb2026/scripts/test_trusted_state_access.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); pass++; }
                         catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };

const SENDER = "bolao/cdb2026/scripts/send_result_email.py";
const WORKFLOW = ".github/workflows/cdb2026_result_emails.yml";
const src = readFileSync(join(ROOT, SENDER), "utf8");
const wf = readFileSync(join(ROOT, WORKFLOW), "utf8");
// Só código executável: prosa que cita um símbolo não é uso dele.
const code = src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

console.log("\nCDB2026 — acesso confiável ao estado cru\n");

test("o sender resolve a credencial por um helper privilegiado", () => {
  assert(/def _sb_key\(\)/.test(code), "sumiu o helper de credencial privilegiada");
  assert(/SUPABASE_SERVICE_ROLE_KEY/.test(code),
    "o sender não referencia mais a credencial privilegiada");
});

test("o helper FALHA FECHADO sem a credencial", () => {
  const fn = code.slice(code.indexOf("def _sb_key("), code.indexOf("def sb_fetch("));
  assert(/raise\s+RuntimeError/.test(fn),
    "sem a credencial o helper não levanta — continuar com a anon devolve lista vazia e o " +
    "script trata 'não posso ver' como 'não existe'");
});

test("nenhum acesso à linha CRUA usa a chave anon", () => {
  // A projeção sanitizada com anon continua legítima; a linha crua, não.
  for (const linha of code.split("\n")) {
    if (!/rest\/v1\/bolao_state\b/.test(linha) && !/"apikey": ANON_KEY/.test(linha)) continue;
    assert(!/ANON_KEY/.test(linha),
      `acesso à linha crua com a chave anon: ${linha.trim().slice(0, 90)}`);
  }
});

test("lista VAZIA não é tratada como estado vazio", () => {
  const fn = code.slice(code.indexOf("def sb_fetch("), code.indexOf("def _sb_upsert("));
  assert(/if not linhas/.test(fn) && /raise\s+RuntimeError/.test(fn),
    "sb_fetch voltou a indexar [0] sem checar — é literalmente o IndexError que derrubou três " +
    "execuções agendadas");
  assert(!/json\.loads\(r\.read\(\)\)\[0\]/.test(fn),
    "voltou o acesso direto ao índice 0");
});

test("o WORKFLOW injeta a credencial privilegiada", () => {
  assert(/SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/.test(wf),
    `${WORKFLOW} não injeta SUPABASE_SERVICE_ROLE_KEY — o código correto falha igual sem o ` +
    "segredo no ambiente");
});

test("a autorização explícita de envio continua exigida", () => {
  assert(/BOLAO_ALLOW_REAL_SEND:\s*"I UNDERSTAND"/.test(wf),
    "sumiu a autorização positiva de envio real");
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
console.log(fail === 0 ? "✓ TRUSTED STATE ACCESS PASSED\n" : "✗ TRUSTED STATE ACCESS FAILED\n");
process.exit(fail === 0 ? 0 : 1);
