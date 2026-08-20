#!/usr/bin/env node
// PRODUTOR DO CACHE AO VIVO — Issue #246.
//
// ─── POR QUE ESTE PRODUTOR EXISTE ───────────────────────────────────────────────────────────
//
// A Edge Function `live-football` não consegue mais falar com a ESPN. Diagnóstico com
// instrumentação temporária em produção (v13, removida em seguida) mediu, das TRÊS variantes de
// cabeçalho testadas a partir do próprio runtime: 403 em todas, com `server: AkamaiGHost` e a
// página "Access Denied". Não é User-Agent, não é `accept`, não é limite de taxa: é a Akamai
// negando o EGRESSO do Supabase Edge Runtime. O mesmo endpoint responde 200 de um runner do
// GitHub Actions e de um laptop.
//
// Então quem alcança a fonte passa a ser o produtor. O gateway continua sendo o CONSUMIDOR e não
// muda em nada: ele já lê `live_sports_cache` e já sabe degradar. Trocamos a dependência de um
// egresso bloqueado por um egresso que funciona, sem tocar no contrato de resposta.
//
// ─── NENHUMA NORMALIZAÇÃO NOVA ──────────────────────────────────────────────────────────────
//
// Este arquivo NÃO normaliza nada por conta própria. Ele importa `espnUrlFor`,
// `validateScoreboardShape`, `normalizeScoreboard` e `buildGatewayPayload` de
// `supabase/functions/_shared/` — exatamente os mesmos módulos que a Edge Function executa em
// produção. Não é uma segunda implementação nem uma terceira: é A implementação.
//
// Isso importa porque `bolao/shared/scripts/espn_provider.py` (o pipeline do snapshot commitado)
// produz um ENVELOPE DIFERENTE — `competitionId`/`generatedAt`, contra `competition`/`observedAt`
// do gateway. Gravar o envelope do snapshot aqui faria o gateway servir um corpo com nomes de
// campo errados, e nenhum teste de forma pegaria isso do lado do navegador.
//
// ─── O QUE ELE NUNCA FAZ ────────────────────────────────────────────────────────────────────
//
// Escreve em UMA tabela: `public.live_sports_cache` — dado esportivo público, como diz o próprio
// COMMENT da tabela ("Nunca contem dado de participante"). Não toca `bolao_state`, não toca
// participante, pagamento, scoring, ranking ou e-mail. Não cria nem altera schema.
//
// Uso:
//   node bolao/shared/scripts/produce_live_cache.mjs --dry-run
//   node bolao/shared/scripts/produce_live_cache.mjs            # exige SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ALLOWED_COMPETITIONS, buildGatewayPayload, normalizeScoreboard, validateScoreboardShape,
} from "../../../supabase/functions/_shared/normalize.js";
import { espnUrlFor } from "../../../supabase/functions/_shared/gateway_core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

export const CACHE_TABLE = "live_sports_cache";
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Competições que o gateway serve HOJE. Copa está arquivada e o seu app não chama o gateway, então
 * produzir cache para ela seria tráfego para ninguém.
 */
export const PRODUCED_COMPETITIONS = ["br2026", "cdb2026"];

/**
 * Janela de atividade, DERIVADA do calendário commitado de cada app — nunca chutada.
 *
 * `LOOKBACK` cobre uma partida em andamento (90 min + intervalo + acréscimos + pós-jogo);
 * `LOOKAHEAD` liga o produtor um pouco antes do apito para que o primeiro visitante já encontre
 * observação fresca em vez de esperar o próximo ciclo.
 */
export const WINDOW_LOOKBACK_MS = 3 * 60 * 60_000;
export const WINDOW_LOOKAHEAD_MS = 60 * 60_000;

/** Lê as datas de partida do snapshot commitado do app. Só calendário — nada de dado privado. */
export function fixtureDatesFor(competition, { root = ROOT } = {}) {
  try {
    const raw = JSON.parse(readFileSync(join(root, "bolao", competition, "data", "espn-normalized.json"), "utf8"));
    return (raw?.matches ?? []).map((m) => m?.date).filter(Boolean);
  } catch {
    // Sem calendário local não dá para afirmar "fora de janela". Devolver vazio faz
    // `isWithinWindow()` decidir pelo lado seguro (ver lá).
    return [];
  }
}

/**
 * `true` quando vale a pena ir à fonte.
 *
 * Sem calendário conhecido a resposta é `true`: um produtor que se cala porque não sabe o horário
 * é indistinguível de um produtor quebrado, e o custo de uma requisição extra é irrelevante perto
 * de deixar o cache expirar durante um jogo real.
 */
export function isWithinWindow(dates, now = Date.now()) {
  if (!dates.length) return true;
  return dates.some((d) => {
    const t = Date.parse(d);
    if (Number.isNaN(t)) return false;
    return t >= now - WINDOW_LOOKBACK_MS && t <= now + WINDOW_LOOKAHEAD_MS;
  });
}

/**
 * Núcleo testável: produz o registro de cache de UMA competição.
 *
 * `fetchImpl` e `writeImpl` são injetados para que a suíte exercite 403, forma inválida, lista
 * vazia e sucesso sem tocar a rede nem o banco.
 */
export async function produceOne(competition, { fetchImpl = fetch, writeImpl, now = Date.now(), force = false, root = ROOT } = {}) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_COMPETITIONS, competition)) {
    return { competition, action: "REJECTED", reason: "competicao fora da whitelist fechada" };
  }
  if (!force && !isWithinWindow(fixtureDatesFor(competition, { root }), now)) {
    return { competition, action: "SKIPPED_OUT_OF_WINDOW", reason: "nenhuma partida na janela derivada do calendario commitado" };
  }

  let raw = null, upstreamStatus = null;
  try {
    const r = await fetchImpl(espnUrlFor(competition), {
      method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    upstreamStatus = r.status;
    if (r.ok) raw = await r.json();
  } catch (e) {
    return { competition, action: "NO_WRITE", reason: `falha de transporte: ${(e && e.name) || "Error"}`, upstreamStatus };
  }

  // FALHA DA FONTE NUNCA ESCREVE. O último-bom-conhecido é a única coisa que segura o gateway
  // durante uma queda da ESPN; sobrescrevê-lo com lixo transformaria uma degradação em apagão.
  if (!raw) return { competition, action: "NO_WRITE", reason: `upstream nao-2xx`, upstreamStatus };

  const problems = validateScoreboardShape(raw);
  if (problems.length) {
    // 200 com forma inválida é FALHA DA FONTE, exatamente como o gateway trata (gateway_core.js).
    return { competition, action: "NO_WRITE", reason: `forma invalida: ${problems.slice(0, 3).join("; ")}`, upstreamStatus };
  }

  const observedAt = new Date(now).toISOString();
  const payload = buildGatewayPayload({
    competition, matches: normalizeScoreboard(raw, {}),
    observedAt, servedAt: observedAt, stale: false, staleReason: null,
  });

  if (!writeImpl) return { competition, action: "DRY_RUN", upstreamStatus, matches: payload.matches.length, payload };
  const written = await writeImpl({ competition, payload, observedAt });
  return { competition, action: written ? "WRITTEN" : "WRITE_FAILED", upstreamStatus, matches: payload.matches.length, payload };
}

/** A URL do Supabase vem da configuração DO APP, não de constante local (mesma regra da sonda). */
export function supabaseUrlFromAppConfig({ root = ROOT } = {}) {
  const src = readFileSync(join(root, "bolao", "br2026", "js", "config.js"), "utf8");
  const url = src.match(/database:\s*\{[\s\S]{0,400}?url:\s*["']([^"']+)["']/)?.[1]
           ?? src.match(/url:\s*["'](https:\/\/[a-z0-9]+\.supabase\.co)["']/)?.[1];
  if (!url) throw new Error("nao consegui ler a URL do Supabase de bolao/br2026/js/config.js");
  return url;
}

/**
 * UPSERT idempotente, com o MESMO mecanismo que a Edge Function já usa para gravar este registro
 * (`Prefer: resolution=merge-duplicates`, chaveado por `competition`). Reexecutar o produtor não
 * cria linha nova nem duplica: substitui a observação pela mais recente.
 */
function makeWriter(serviceKey, supabaseUrl) {
  return async ({ competition, payload, observedAt }) => {
    const r = await fetch(`${supabaseUrl}/rest/v1/${CACHE_TABLE}`, {
      method: "POST",
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json", Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ competition, payload, observed_at: observedAt, stored_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) console.error(`  [${competition}] escrita recusada: HTTP ${r.status}`);
    return r.ok;
  };
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // SEM FALLBACK PARA A ANON KEY. A migração 011 removeu INSERT/UPDATE de `anon` nesta tabela de
  // propósito; tentar assim mesmo daria 401 engolido e um cache que para de atualizar em silêncio.
  if (!dryRun && !serviceKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY ausente. Rode com --dry-run para validar sem gravar.");
    return 2;
  }

  const writeImpl = dryRun ? null : makeWriter(serviceKey, supabaseUrlFromAppConfig());
  console.log(`\nProdutor do cache ao vivo — ${dryRun ? "DRY RUN (nao grava)" : "gravando"}\n`);

  let failures = 0;
  for (const competition of PRODUCED_COMPETITIONS) {
    const r = await produceOne(competition, { writeImpl, force });
    const detail = r.matches !== undefined ? `${r.matches} partida(s)` : (r.reason ?? "");
    console.log(`  [${competition}] ${r.action}${r.upstreamStatus ? ` (upstream ${r.upstreamStatus})` : ""} ${detail}`);
    if (r.action === "NO_WRITE" || r.action === "WRITE_FAILED" || r.action === "REJECTED") failures++;
  }

  // Uma execução que não escreveu precisa ser VISÍVEL. O cache antigo continua servindo dentro do
  // teto de 10 min, e depois disso o gateway admite SOURCE_UNAVAILABLE — nada é falsificado.
  if (failures) { console.error(`\n✗ ${failures} competicao(oes) sem observacao nova\n`); return 1; }
  console.log("\n✓ producao concluida\n");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main(process.argv.slice(2)));
}
