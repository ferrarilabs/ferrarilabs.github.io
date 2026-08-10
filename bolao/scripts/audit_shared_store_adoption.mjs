/**
 * audit_shared_store_adoption.mjs — F12/F13. Prova CONSUMO REAL do store compartilhado.
 *
 * ─── POR QUE ESTE GATE EXISTE ────────────────────────────────────────────────────────────────
 *
 * `football_live_store.js` tinha suíte de unidade verde, era carregado pelos três `index.html`,
 * e os apps chamavam seus predicados (`isLiveEvent`, `isFinalEvent`). Tudo isso passava em
 * auditoria — e mesmo assim `createStore()` NUNCA era chamado por app nenhum. Cada app mantinha
 * sua própria hierarquia de fontes, seu próprio laço de poll e seu próprio estado ao vivo.
 *
 * A biblioteca canônica era decorativa. Os defeitos corrigidos nela (FINAL que regredia para AO
 * VIVO, `stop()` que não parava, cache envenenado aceito) não protegiam produção nenhuma, porque
 * produção não passava por ela.
 *
 * Este gate falha se:
 *   - o app carrega o módulo mas nunca instancia o store
 *   - sobra um segundo laço de poll ativo
 *   - sobra uma segunda hierarquia de busca ao gateway
 *
 * Presença de `<script src=...>` NÃO conta. Uso de predicado NÃO conta.
 *
 * Uso: node bolao/scripts/audit_shared_store_adoption.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Apps ATIVOS. Copa2026 está arquivada (CONFIG.archived) e é exceção documentada — ver
// CLAUDE.md "Copa do Mundo 2026 archive". Migrar um app arquivado não traz benefício e mexeria
// num torneio encerrado com dinheiro já pago.
const ACTIVE_APPS = ["br2026", "cdb2026"];
const ARCHIVED_APPS = ["copa2026"];

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
}

function appSource(app) {
  return readFileSync(join(ROOT, "bolao", app, "js", "app.js"), "utf8");
}

/** Remove comentários e literais de string para que a busca veja CÓDIGO, não prosa. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

console.log("SHARED_STORE_ADOPTION — consumo real, não inclusão de script\n");

for (const app of ACTIVE_APPS) {
  console.log(`${app}:`);
  const code = codeOnly(appSource(app));

  // 1. INSTANCIAÇÃO REAL da fábrica canônica.
  const instantiates = /BOLAO_FOOTBALL_LIVE\s*(?:\.|\?\.)\s*createStore\s*\(/.test(code)
    || /\bcreateStore\s*\(/.test(code);
  check(`${app.toUpperCase()}_ACTUALLY_USES_SHARED_STORE`, instantiates,
    "o app carrega football_live_store.js mas nunca chama createStore() — a biblioteca canônica " +
    "está decorativa e os defeitos corrigidos nela não protegem produção");

  // 2. Nenhuma SEGUNDA hierarquia de busca ao gateway dentro do app.
  const localGatewayFetch = /function\s+fetchFromGateway\s*\(/.test(code);
  check(`${app.toUpperCase()}_DUPLICATE_GATEWAY_FETCHERS = 0`, !localGatewayFetch,
    "fetchFromGateway() local ainda existe: segunda hierarquia de fontes convivendo com a do store");

  // 3. Nenhum SEGUNDO laço de poll ativo.
  const localPollLoop = /function\s+schedulePoll\s*\(/.test(code)
    || /_pollChainToken/.test(code);
  check(`${app.toUpperCase()}_DUPLICATE_LIVE_POLLERS = 0`, !localPollLoop,
    "laço de poll local ainda existe (schedulePoll/_pollChainToken): dois relógios governando " +
    "a mesma verdade ao vivo");

  // 4. Nenhum estado ao vivo paralelo mantido à mão.
  const shadowState = /_liveObservedAt\s*=/.test(code) && /_liveSource\s*=/.test(code);
  check(`${app.toUpperCase()}_NO_SHADOW_LIVE_STATE`, !shadowState,
    "_liveObservedAt/_liveSource ainda são mantidos localmente — verdade ao vivo duplicada");

  // 5. O navegador nunca fala com a ESPN (invariante de CSP e de arquitetura).
  const directEspn = /https?:\/\/[^\s"']*espn\.com/i.test(appSource(app).replace(/\/\/[^\n]*/g, ""));
  check(`${app.toUpperCase()}_NO_DIRECT_ESPN_BROWSER`, !directEspn,
    "referência direta a espn.com no código do navegador");
  console.log("");
}

// Exceção arquivada, registrada explicitamente para não virar omissão silenciosa.
for (const app of ARCHIVED_APPS) {
  const code = codeOnly(appSource(app));
  const usesPredicates = /BOLAO_FOOTBALL_LIVE/.test(code);
  check(`${app} (ARQUIVADO) permanece compatível com os predicados canônicos`, usesPredicates,
    "mesmo arquivado, o app deve continuar consumindo o predicado canônico de 'está ao vivo'");
}

const active = ACTIVE_APPS.filter(a => /createStore\s*\(/.test(codeOnly(appSource(a))));
console.log(`\nACTIVE_APPS_USING_SHARED_LIVE_STORE = ${active.length} de ${ACTIVE_APPS.length}` +
            (active.length ? ` (${active.join(", ")})` : ""));

console.log(`\n  ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\n🛑 SHARED_STORE_ADOPTION FAILED");
  process.exit(1);
}
console.log("\n✓ SHARED_STORE_ADOPTION PASSED");
