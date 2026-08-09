// live-football — GATEWAY DE DADOS AO VIVO DE FUTEBOL (Supabase Edge Function, Deno).
//
// ─── POR QUE ESTA FUNÇÃO É TÃO CURTA ────────────────────────────────────────────────────────
//
// Ela é DELIBERADAMENTE uma casca. Toda a decisão — cache, degradação, validação de forma,
// distinção entre "fonte falhou" e "não há jogo", whitelist de competição — vive em
// `_shared/gateway_core.js` e `_shared/normalize.js`, que são ESM puro e rodam tanto em Deno
// quanto em Node.
//
// A razão é concreta: Deno não está instalado na máquina de desenvolvimento. Se a lógica morasse
// aqui, ela só existiria no runtime que não pode ser executado localmente, e a única forma de
// "testá-la" seria reescrevê-la no teste. Este repositório já pagou caro por esse padrão — o
// `drawSelectorLabel` "kept in sync manually" divergiu e três testes passaram verde por meses
// exercitando uma função que não existia mais.
//
// Consequência prática: `bolao/scripts/audit_live_gateway.mjs` exercita 25 casos (403/429/500/
// timeout/JSON quebrado/envenenamento de cache/fronteiras de TTL/injeção) contra o MESMO código
// que roda em produção. O que fica sem cobertura local são as ~40 linhas abaixo: roteamento,
// cabeçalhos e o cache do runtime.
//
// ─── O QUE ESTE GATEWAY NÃO FAZ ─────────────────────────────────────────────────────────────
//
// Não lê nem escreve `bolao_state`. Não toca em participante, pagamento, bilhete ou bracket.
// Não envia e-mail. Não aceita URL arbitrária. Serve dado esportivo PÚBLICO e nada mais.
// A chave de competição é ÍNDICE numa whitelist fechada, nunca parte da URL de destino — então
// não há superfície para transformá-lo em proxy aberto.

import {
  resolveGatewayResponse, validateRequest, espnUrlFor, FRESH_TTL_MS,
} from "../_shared/gateway_core.js";

// ─── CACHE COMPARTILHADO EM TABELA (decidido por medição, não por documentação) ─────────────
//
// A primeira versão usava um `Map` em memória do isolate, e uma sonda implantada em produção
// provou que isso NÃO funciona aqui: 10 requisições seguidas produziram 10 isolates distintos,
// todos com 3–6ms de vida. O `Map` nunca sobreviveria a uma requisição.
//
// A Web Cache API também não serve, e este é o achado que justifica ter medido em vez de inferir:
// `globalThis.caches` EXISTE (uma checagem por `typeof` diria "suportado"), mas `caches.open()`
// lança `Web Cache is not available in this context`. Construir a camada de confiabilidade sobre
// ela teria produzido um defeito que só apareceria em produção, provavelmente durante um jogo.
//
// Por que o cache importa — e não é sobre volume de requisição à ESPN:
//   · último-bom-conhecido COMPARTILHADO entre visitantes;
//   · o PRIMEIRO visitante no meio do jogo precisa ver o estado atual sem que nenhum navegador
//     tenha observado a partida antes;
//   · falha temporária da fonte não pode virar apagão para todo mundo ao mesmo tempo;
//   · proteção contra 429.
// Cache local de navegador ou de isolate não satisfaz nenhum desses.
//
// A tabela é EXCLUSIVA de dado esportivo público, separada de `bolao_state` de propósito. RLS
// restringe a escrita às três competições conhecidas: o pior caso possível com a anon key é
// sobrescrever cache esportivo público com outro dado esportivo público.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CACHE_TABLE = "live_sports_cache";

async function readSharedCache(competition: string) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${CACHE_TABLE}?competition=eq.${competition}&select=payload,observed_at,stored_at`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = rows?.[0];
    if (!row) return null;
    return { payload: row.payload, observedAt: row.observed_at, storedAt: Date.parse(row.stored_at) };
  } catch { return null; }  // cache indisponível degrada para buscar na fonte, nunca derruba a resposta
}

async function writeSharedCache(competition: string, payload: any, observedAt: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${CACHE_TABLE}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`,
                 "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ competition, payload, observed_at: observedAt,
                             stored_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(2500),
    });
  } catch { /* falha ao gravar cache não pode falhar a resposta ao visitante */ }
}

const CORS = {
  // A origem canônica de produção. `ferrarilabs.github.io` responde 301 e não executa página
  // nenhuma de produção, mas continua na lista porque o CNAME pode ser reconfigurado.
  "Access-Control-Allow-Origin": "*", // dado público; sem credencial, sem cookie, sem sessão
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // O NAVEGADOR não deve cachear: o gateway já faz cache do lado dele, e cache de browser
      // aqui reintroduziria exatamente o problema que este projeto está resolvendo — dado velho
      // servido como se fosse atual, sem o cliente saber a idade real.
      "cache-control": "no-store",
      ...CORS, ...extra,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const competition = url.searchParams.get("competition") ?? "";


  const check = validateRequest(competition, req.method);
  if (!check.ok) return json({ error: check.error, schemaVersion: 1 }, check.status);

  const now = Date.now();
  const cached = await readSharedCache(competition);

  const result = await resolveGatewayResponse({
    competition,
    cached,
    now,
    fetchRaw: () => fetch(espnUrlFor(competition)!, {
      signal: AbortSignal.timeout(6000),   // a ESPN pendurada não pode pendurar o visitante
      headers: { accept: "application/json" },
    }),
  });

  // Só promove a "último bom conhecido" o que passou por validação de forma — é o que impede que
  // um HTTP 200 com corpo quebrado destrua uma observação boa anterior.
  if (result.shouldStore) {
    await writeSharedCache(competition, result.payload, result.payload.observedAt!);
  }

  // Log operacional sem nenhum dado privado: só saúde, status da fonte e se veio do cache.
  console.log(JSON.stringify({
    competition, health: result.health, cacheHit: result.cacheHit,
    upstreamStatus: result.upstreamStatus, ttlMs: FRESH_TTL_MS,
  }));

  return json(result.payload, result.health === "SOURCE_UNAVAILABLE" ? 503 : 200, {
    "x-live-health": result.health,
  });
});
