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

// Cache em memória do isolate. Não é compartilhado entre instâncias, e isso é aceitável nesta
// escala: com TTL de 15s e o volume real do Ferrari Labs, o pior caso é um punhado de fetches
// extras à ESPN por minuto. Um cache distribuído (KV/Redis) seria infraestrutura nova para
// resolver um problema que este projeto não tem.
const cache = new Map<string, { payload: unknown; observedAt: string; storedAt: number }>();

// Coalescência: requisições simultâneas que caem no mesmo cache-miss compartilham UM único fetch
// à ESPN, em vez de uma por visitante. Sem isto, o instante em que o TTL vence vira uma pequena
// avalanche sobre a fonte.
const inFlight = new Map<string, Promise<unknown>>();

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
  const cached = cache.get(competition) ?? null;

  // Se já existe um fetch em voo para esta competição, espera por ELE em vez de abrir outro.
  let pending = inFlight.get(competition);
  if (!pending) {
    pending = resolveGatewayResponse({
      competition,
      cached,
      now,
      fetchRaw: () => fetch(espnUrlFor(competition)!, {
        signal: AbortSignal.timeout(6000),   // a ESPN pendurada não pode pendurar o visitante
        headers: { accept: "application/json" },
      }),
    }).finally(() => inFlight.delete(competition));
    inFlight.set(competition, pending);
  }

  const result = await pending as Awaited<ReturnType<typeof resolveGatewayResponse>>;

  // Só promove a "último bom conhecido" o que passou por validação de forma — é o que impede
  // que um HTTP 200 com corpo quebrado destrua uma observação boa anterior.
  if (result.shouldStore) {
    cache.set(competition, {
      payload: result.payload,
      observedAt: result.payload.observedAt!,
      storedAt: now,
    });
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
