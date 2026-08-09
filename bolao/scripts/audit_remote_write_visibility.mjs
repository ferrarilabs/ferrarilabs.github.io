#!/usr/bin/env node
/**
 * GRAVAÇÃO REMOTA QUE NÃO ACONTECE NÃO PODE PARECER SUCESSO.
 *
 * ─── O INCIDENTE ────────────────────────────────────────────────────────────────────────────
 *
 * 2026-08-09: o Eduardo registrou a data do sorteio da CBF pelo painel admin do CDB2026 e a tela
 * confirmou. Horas depois, o estado canônico no Supabase continuava com `officialDraw: null` — a
 * alteração nunca saiu do navegador dele, e nada na interface disse isso.
 *
 * Duas falhas independentes, ambas do mesmo formato — silêncio num caminho de gravação:
 *
 *   1. CDB2026: `saveRemoteState()` devolve `{ok:false, skipped:true}` quando a gravação remota é
 *      BLOQUEADA (isolamento de teste) ou desligada. Isso RESOLVE a promessa. O chamador só tinha
 *      `.catch()`, então o caso pulado passava direto e a tela mostrava "salvo".
 *
 *   2. BR2026: pior. `.catch(() => {})` engolia até erro real, e `saveRemoteState()` nem checava
 *      `r.ok` — um 401/403 do RLS era tratado como sucesso. A correção equivalente existia no
 *      CDB2026 desde a auditoria de 2026-08 (AUDIT-04) e nunca foi propagada. É o app que
 *      movimenta pagamento.
 *
 * ─── A LIÇÃO, QUE É A MESMA DE SEMPRE ───────────────────────────────────────────────────────
 *
 * Um verde que não corresponde a efeito. Já apareceu como workflow que roda sem commitar, cron
 * que não acorda, teste fora do agregado, e agora gravação que não grava. O padrão: alguém
 * confunde "a operação terminou" com "a operação teve efeito".
 *
 * Uso: node bolao/scripts/audit_remote_write_visibility.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APPS = ["br2026", "cdb2026"]; // copa2026 está arquivada — ver o teste de exceção no fim

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("\nVisibilidade de gravação remota\n");

for (const app of APPS) {
  const src = readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");

  test(`[${app}] a resposta do Supabase é CHECADA (4xx/5xx não é sucesso)`, () => {
    // `await fetch()` não rejeita em 4xx/5xx. Sem isto, o RLS negando a escrita vira "salvo".
    assert(/if \(!r\.ok\)/.test(src),
      "a resposta do POST não é checada — um 401/403 do RLS voltaria a passar por sucesso");
    assert(/throw new Error\(`Supabase respondeu \$\{r\.status\}/.test(src),
      "a falha do provedor não vira erro propagável");
  });

  test(`[${app}] gravação PULADA é reportada ao usuário, não só ao console`, () => {
    // O caso que faltava: `{skipped:true}` resolve, então `.catch` nunca dispara.
    assert(/\.then\(res =>[\s\S]{0,400}res\.skipped/.test(src),
      "o caminho de gravação pulada não é inspecionado — a tela mostraria 'salvo' sem ter salvo");
    assert(/showToast\(t\("syncBlocked"\)/.test(src),
      "não há aviso visível quando a alteração fica só no navegador");
  });

  test(`[${app}] gravação com ERRO é reportada ao usuário`, () => {
    assert(/showToast\(t\("syncFailed"\)/.test(src),
      "falha de sincronização volta a ser silenciosa");
    assert(!/saveRemoteState\([^)]*\)\.catch\(\(\) => \{\}\)/.test(src),
      "voltou o `.catch(() => {})` que engole erro real");
  });

  test(`[${app}] o upsert grava \`updated_at\``, () => {
    // Sem isto não há como responder "quando o estado canônico mudou pela última vez?" — foi o
    // que atrasou o diagnóstico deste incidente: a coluna dizia 14/07 com conteúdo de 01/08.
    assert(/updated_at: new Date\(\)\.toISOString\(\)/.test(src),
      "o upsert não escreve `updated_at`; a coluna congela na criação da linha");
  });

  test(`[${app}] as duas chaves de i18n existem`, () => {
    const i18n = readFileSync(join(ROOT, "bolao", app, "js", "i18n.js"), "utf8");
    for (const k of ["syncBlocked", "syncFailed"]) {
      assert(new RegExp(`\\b${k}\\s*:`).test(i18n), `falta a chave ${k} — o toast sairia vazio`);
    }
  });

  test(`[${app}] o bloqueio de escrita em produção continua fail-closed`, () => {
    // A correção acima torna o bloqueio VISÍVEL. Não pode, de tabela, torná-lo mais permissivo.
    assert(/productionWritesAllowed\(\)/.test(src), "sumiu o portão de isolamento de produção");
    assert(/navigator\.webdriver/.test(src),
      "o portão deixou de reconhecer navegador automatizado — um teste poderia gravar em produção");
  });
}

test("[copa2026] arquivado: exceção registrada, não esquecida", () => {
  // A Copa está arquivada (`CONFIG.archived`), sem fluxo de entrada ou pagamento ativo. Ela usa
  // `.catch(err => console.warn(...))`, sem toast. Não propaguei a correção para lá de propósito:
  // o app não tem gravação de usuário em curso, e mexer num app arquivado em produção tem risco
  // sem benefício. Registrado aqui para que a diferença seja uma DECISÃO, não um esquecimento.
  const cfg = readFileSync(join(ROOT, "bolao", "copa2026", "js", "config.js"), "utf8");
  assert(/archived:\s*true/.test(cfg),
    "a Copa deixou de estar arquivada — a exceção acima perdeu a justificativa e a correção " +
    "de visibilidade de gravação precisa ser propagada para lá também");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ REMOTE WRITE VISIBILITY FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
