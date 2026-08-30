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

/**
 * O CICLO DENTRO DA EXECUÇÃO — por que ele existe (Issue #381).
 *
 * Eduardo, com jogo ao vivo: *"O placar demora para atualizar. Teve gol já a 3-5 min atrás e ainda
 * não atualizou. Durante a Copa do Mundo era muito rápido."* Estava certo, e o número bate com a
 * arquitetura: o placar só muda quando o produtor ESCREVE, e o produtor escrevia uma vez por
 * execução, de cinco em cinco minutos. O relógio a página sabe interpolar; **gol não se
 * interpola** — ele aparece na próxima escrita ou não aparece.
 *
 * Orçamento de latência de antes:
 *
 *     escrita (cron de 5 min)   até 300 s   <- termo dominante
 *     poll do cliente                 60 s
 *     TTL do gateway                  15 s
 *                                  ~ 6 min de pior caso
 *
 * Por que não simplesmente subir o cron: quem alcança a ESPN é o runner do GitHub — a Akamai nega
 * o egresso do Cloudflare e do Supabase (403 medido nos dois). E o agendamento do GitHub Actions
 * não honra cadência abaixo de alguns minutos (mediana medida de 34 min quando configurado para 5),
 * que é justamente por que o despacho passou a vir do cron da Cloudflare (#369).
 *
 * A saída é não gastar a execução inteira numa observação só: o mesmo despacho de 5 em 5 minutos
 * abre um runner que fica vivo e OBSERVA A CADA 15 SEGUNDOS. Mesma quantidade de execuções, mesma
 * autoridade, ~20× mais observações. Repositório público: minuto de Actions não é cobrado.
 *
 * O ciclo REAVALIA A JANELA a cada volta: um jogo que termina no meio da execução para de ser
 * observado na hora, em vez de a execução continuar batendo na fonte por educação.
 */
const LOOP_INTERVAL_MS = 15_000;
/**
 * Um pouco abaixo do intervalo de despacho (5 min). O `concurrency` do workflow tem
 * `cancel-in-progress: true`, então o despacho seguinte encerraria esta execução de qualquer
 * forma — sair sozinho antes disso deixa o log legível e o encerramento previsível.
 */
const LOOP_DURATION_MS = 4 * 60_000 + 40_000;

const dorme = (ms) => new Promise(r => setTimeout(r, ms));

function argNum(argv, nome, padrao) {
  const pref = `--${nome}=`;
  const hit = argv.find(a => a.startsWith(pref));
  if (!hit) return padrao;
  const v = Number(hit.slice(pref.length));
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const loop = argv.includes("--loop");
  const intervalo = argNum(argv, "loop-interval-ms", LOOP_INTERVAL_MS);
  const duracao = argNum(argv, "loop-duration-ms", LOOP_DURATION_MS);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  // SEM FALLBACK PARA A ANON KEY. A migração 011 removeu INSERT/UPDATE de `anon` nesta tabela de
  // propósito; tentar assim mesmo daria 401 engolido e um cache que para de atualizar em silêncio.
  if (!dryRun && !serviceKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY ausente. Rode com --dry-run para validar sem gravar.");
    return 2;
  }

  const writeImpl = dryRun ? null : makeWriter(serviceKey, supabaseUrlFromAppConfig());
  console.log(`\nProdutor do cache ao vivo — ${dryRun ? "DRY RUN (nao grava)" : "gravando"}\n`);

  const fim = Date.now() + duracao;
  let failures = 0, voltas = 0, escritas = 0;

  do {
    voltas++;
    let observouAlguma = false;
    for (const competition of PRODUCED_COMPETITIONS) {
      const r = await produceOne(competition, { writeImpl, force });
      if (r.action !== "SKIPPED_OUT_OF_WINDOW") observouAlguma = true;
      if (r.action === "WRITTEN" || r.action === "DRY_RUN") escritas++;
      // Fora de janela é o caso comum e não muda de volta para volta: registrar uma vez por
      // execução mantém o log legível em vez de repetir vinte linhas idênticas.
      if (voltas === 1 || r.action !== "SKIPPED_OUT_OF_WINDOW") {
        const detail = r.matches !== undefined ? `${r.matches} partida(s)` : (r.reason ?? "");
        console.log(`  [${competition}] ${r.action}${r.upstreamStatus ? ` (upstream ${r.upstreamStatus})` : ""} ${detail}`);
      }
      if (r.action === "NO_WRITE" || r.action === "WRITE_FAILED" || r.action === "REJECTED") failures++;
    }
    if (!loop) break;
    // NENHUMA competição na janela: encerra já. Segurar o runner por cinco minutos sem ter o que
    // observar seria queimar tempo e continuar batendo numa fonte que não tem nada novo a dizer.
    if (!observouAlguma) {
      console.log("  (nenhuma competicao na janela — encerrando sem ciclar)");
      break;
    }
    if (Date.now() + intervalo >= fim) break;
    await dorme(intervalo);
  } while (Date.now() < fim);

  if (loop && voltas > 1) {
    console.log(`\n  ciclo: ${voltas} observacao(oes) em ~${Math.round(duracao / 1000)}s (intervalo ${Math.round(intervalo / 1000)}s), ${escritas} escrita(s)`);
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
