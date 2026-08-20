#!/usr/bin/env node
/**
 * SAÚDE AO VIVO DO GATEWAY `live-football` — sonda REAL, somente leitura.
 *
 * ─── O QUE ESTE CHECK RESPONDE, E O QUE ELE NÃO RESPONDE ────────────────────────────────────
 *
 *     "a cadeia de dados esportivos externa está saudável AGORA?"   ← esta suíte
 *     "a interface é acessível?"                                    ← audit_accessibility.mjs
 *
 * Até 2026-08-20 ninguém respondia a primeira. `audit_live_gateway.mjs` injeta o transporte e diz
 * no próprio cabeçalho que "nenhum teste aqui toca a rede" — o que está CERTO para o que ele prova
 * (contrato de degradação), mas deixava a plataforma sem NENHUM sinal do gateway de verdade. O
 * incidente #246 só foi notado porque a suíte de acessibilidade tinha, por acidente, uma
 * dependência viva — o sinal certo saindo do lugar errado (Issue #248).
 *
 * ─── POR QUE NÃO É UM GATE DE MERGE ─────────────────────────────────────────────────────────
 *
 * Declarado `requires: "network"` em scripts/verify.mjs. O CI é HERMÉTICO por construção (ver o
 * cabeçalho de safety_check.yml) e não declara `VERIFY_ALLOW_NETWORK=1`, então lá este check é
 * reportado SKIPPED — nunca PASSED, nunca verde falso. A disponibilidade de um terceiro não pode
 * decidir se o código de outra pessoa entra: era exatamente esse acoplamento que a Issue #248
 * desfez. O que ele NÃO faz é sumir: rodado com rede, ele reprova alto e com evidência.
 *
 * Uso:
 *   node bolao/shared/scripts/check_live_gateway_health.mjs
 *   VERIFY_ALLOW_NETWORK=1 node scripts/verify.mjs --only=live-gateway-health
 *
 * Saída: 0 somente se TODAS as competições estiverem FRESH. Qualquer degradação → 1.
 *
 * PRIVACIDADE: a sonda lê um endpoint público de placar. Não envia credencial, não toca Supabase
 * com chave nenhuma, não escreve em lugar algum, e o que imprime é só competição, código HTTP,
 * saúde e carimbo de tempo — nunca dado de participante.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const TIMEOUT_MS = 15_000;

/** Os cinco veredictos que esta sonda sabe distinguir. */
export const VERDICTS = Object.freeze({
  FRESH: "FRESH",                             // observação recente e boa
  STALE: "STALE",                             // serve último bom conhecido; upstream falhando
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",   // gateway respondeu, e admite que não sabe
  GATEWAY_DOWN: "GATEWAY_DOWN",               // o gateway em si não respondeu
  UNKNOWN: "UNKNOWN",                         // respondeu algo que o contrato não descreve
});

/**
 * A URL vem da configuração DO PRÓPRIO APP, não de uma constante daqui.
 *
 * Se um app trocar de gateway e esta sonda tivesse a URL fixa, ela seguiria verde monitorando um
 * endereço que ninguém mais usa — o formato de falha mais silencioso possível para um monitor.
 */
function gatewayTargetsFromAppConfigs() {
  const apps = [
    { app: "br2026", config: join(ROOT, "bolao", "br2026", "js", "config.js") },
    { app: "cdb2026", config: join(ROOT, "bolao", "cdb2026", "js", "config.js") },
  ];
  const targets = [];
  for (const { app, config } of apps) {
    const src = readFileSync(config, "utf8");
    const url = src.match(/liveGateway:\s*\{[\s\S]{0,400}?url:\s*["']([^"']+)["']/)?.[1];
    const competition = src.match(/liveGateway:\s*\{[\s\S]{0,400}?competition:\s*["']([^"']+)["']/)?.[1];
    if (!url || !competition) {
      throw new Error(
        `não consegui ler liveGateway.url/competition de ${config}. ` +
        `A sonda NÃO adivinha um endereço: monitorar o alvo errado é pior que não monitorar.`);
    }
    targets.push({ app, url, competition });
  }
  return targets;
}

/** Uma sonda somente leitura. Nunca lança: um erro de rede é um VEREDICTO, não uma exceção. */
async function probe({ app, url, competition }) {
  const startedAt = new Date().toISOString();
  const full = `${url}?competition=${encodeURIComponent(competition)}`;
  let res, body = null, transportError = null;

  try {
    res = await fetch(full, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    try { body = await res.json(); }
    catch { body = null; } // 200 com corpo ilegível é UNKNOWN, não sucesso
  } catch (e) {
    transportError = e?.name === "TimeoutError" ? `timeout após ${TIMEOUT_MS}ms` : String(e?.message || e);
  }

  const base = { app, competition, observedBy: startedAt, url: full };

  if (transportError) {
    return { ...base, verdict: VERDICTS.GATEWAY_DOWN, httpStatus: null, liveHealthHeader: null,
             upstream: null, detail: transportError };
  }

  const httpStatus = res.status;
  const liveHealthHeader = res.headers.get("x-live-health");
  const upstream = body?.staleReason ?? null;
  const shared = { ...base, httpStatus, liveHealthHeader, upstream,
                   observedAt: body?.observedAt ?? null, ageSeconds: body?.ageSeconds ?? null };

  if (body && body.status === "SOURCE_UNAVAILABLE") {
    return { ...shared, verdict: VERDICTS.SOURCE_UNAVAILABLE,
             detail: `o gateway respondeu e admite que não sabe (matches: ${JSON.stringify(body.matches)})` };
  }
  if (httpStatus >= 500) {
    return { ...shared, verdict: VERDICTS.GATEWAY_DOWN, detail: `HTTP ${httpStatus} sem corpo de contrato` };
  }
  if (httpStatus === 200 && body && Array.isArray(body.matches)) {
    return body.stale === true
      ? { ...shared, verdict: VERDICTS.STALE,
          detail: `servindo último bom conhecido há ${body.ageSeconds ?? "?"}s` }
      : { ...shared, verdict: VERDICTS.FRESH,
          detail: `${body.matches.length} partida(s) na observação` };
  }
  return { ...shared, verdict: VERDICTS.UNKNOWN,
           detail: `resposta fora do contrato (HTTP ${httpStatus}, matches=${JSON.stringify(body?.matches)})` };
}

const DEGRADED = new Set([VERDICTS.STALE, VERDICTS.SOURCE_UNAVAILABLE, VERDICTS.GATEWAY_DOWN, VERDICTS.UNKNOWN]);

async function main() {
  console.log("\nSaúde ao vivo do gateway live-football (somente leitura)\n");
  const results = [];
  for (const target of gatewayTargetsFromAppConfigs()) results.push(await probe(target));

  for (const r of results) {
    const mark = r.verdict === VERDICTS.FRESH ? "✓" : "✗";
    console.log(`  ${mark} [${r.app}] ${r.verdict}`);
    console.log(`      competição      ${r.competition}`);
    console.log(`      HTTP            ${r.httpStatus ?? "(sem resposta)"}`);
    console.log(`      x-live-health   ${r.liveHealthHeader ?? "(ausente)"}`);
    console.log(`      upstream        ${r.upstream ?? "(nenhum motivo declarado)"}`);
    console.log(`      observedAt      ${r.observedAt ?? "(nenhum)"}${r.ageSeconds != null ? `  (${r.ageSeconds}s)` : ""}`);
    console.log(`      sondado em      ${r.observedBy}`);
    console.log(`      detalhe         ${r.detail}`);
  }

  const degraded = results.filter((r) => DEGRADED.has(r.verdict));
  console.log(`\n  ${results.length - degraded.length} saudável(is), ${degraded.length} degradado(s)`);

  if (degraded.length) {
    console.log(
      `\n✗ GATEWAY AO VIVO DEGRADADO — ${degraded.map((d) => `${d.app}:${d.verdict}`).join(", ")}\n` +
      `  Isto é disponibilidade de terceiro, NÃO defeito do código sendo testado.\n` +
      `  Não conserte um gate para deixar isto verde: rastreie em uma Issue de incidente.\n`);
    process.exit(1);
  }
  console.log("\n✓ GATEWAY AO VIVO SAUDÁVEL\n");
}

// Só sonda quando EXECUTADO. Sem esta guarda, um `import` deste módulo — para reusar `VERDICTS`
// ou para testar `gatewayTargetsFromAppConfigs()` — dispararia uma chamada de rede real como
// efeito colateral, e um teste offline passaria a depender da ESPN. Exatamente o acoplamento que
// a Issue #248 removeu; não vale reintroduzi-lo pela porta dos fundos.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
