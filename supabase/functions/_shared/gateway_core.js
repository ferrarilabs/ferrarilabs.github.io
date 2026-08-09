/**
 * gateway_core.js — LÓGICA DO GATEWAY, isolada do runtime HTTP.
 *
 * ─── POR QUE SEPARADO DA FUNÇÃO ─────────────────────────────────────────────────────────────
 *
 * A Edge Function roda em Deno, que não está instalado nesta máquina. Se a lógica de cache,
 * stale-while-revalidate e degradação morasse dentro do handler, ela só existiria no runtime que
 * não consigo executar — e a única forma de "testá-la" seria reescrevê-la no teste, que é o
 * padrão de falso-verde que este repositório já pagou caro.
 *
 * Aqui fica TUDO que decide; o handler HTTP vira uma casca de ~40 linhas. Node testa este
 * arquivo de verdade, Deno importa o mesmo arquivo. Uma implementação.
 *
 * ─── A DISTINÇÃO QUE ORIGINA TODO O DESENHO ─────────────────────────────────────────────────
 *
 *   "a fonte falhou"            ≠   "não há jogo ao vivo"
 *
 * São estados diferentes e o app age diferente em cada um. Colapsar os dois numa lista vazia é
 * como o hero sumia: um erro de rede virava "não há jogo", e o card desaparecia da tela com um
 * jogo acontecendo. Por isso `matches: null` (não sei) nunca é `matches: []` (sei que não há).
 */

import {
  ALLOWED_COMPETITIONS, SCHEMA_VERSION,
  normalizeScoreboard, validateScoreboardShape,
  buildGatewayPayload, sourceUnavailablePayload,
} from "./normalize.js";

/**
 * TTL do cache fresco: 15 segundos.
 *
 * Escolhido a partir da meta operacional (dado com no máximo ~30s durante o jogo) e da cadência
 * de polling do navegador (15–30s ao vivo). Com 15s, requisições simultâneas de vários visitantes
 * colapsam num único fetch à ESPN, e o dado nunca fica mais de meio ciclo atrás.
 */
export const FRESH_TTL_MS = 15_000;

/**
 * Janela de "último bom conhecido": 10 minutos.
 *
 * Passado o TTL fresco, o cache continua SERVÍVEL — marcado como stale — por até 10 min. Isso é o
 * que faz uma falha transitória da ESPN (429, 500, timeout) não virar apagão para o usuário.
 * Além de 10 min sem NENHUMA observação boa, o gateway prefere admitir que não sabe a fingir que
 * sabe: responde SOURCE_UNAVAILABLE.
 */
export const LAST_KNOWN_GOOD_MAX_AGE_MS = 10 * 60_000;

export const HEALTH = {
  FRESH: "FRESH",
  STALE: "STALE",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
};

export function espnUrlFor(competitionKey) {
  const slug = ALLOWED_COMPETITIONS[competitionKey];
  // Whitelist fechada: a chave é um ÍNDICE, nunca parte da URL. Não há concatenação de entrada do
  // usuário no endpoint, então não existe superfície para path traversal nem para transformar o
  // gateway em proxy aberto — o pior que um id desconhecido consegue é um 400.
  if (!slug) return null;
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
}

/**
 * Decide o que servir. PURA: recebe cache e um `fetchRaw` injetado, não fala com a rede.
 *
 * @param {object} args
 *   competition  chave da competição (validada pelo chamador)
 *   cached       {payload, observedAt, storedAt} | null   último bom conhecido
 *   now          timestamp
 *   fetchRaw     async () => {ok, status, json}  transporte injetado
 * @returns {{payload, health, cacheHit, upstreamStatus, shouldStore}}
 */
export async function resolveGatewayResponse({ competition, cached, now, fetchRaw }) {
  const age = cached ? now - cached.storedAt : Infinity;

  // 1. Cache FRESCO: responde na hora, sem tocar na ESPN. É o caminho da imensa maioria das
  //    requisições durante um jogo, e o que torna o custo desprezível nesta escala.
  if (cached && age < FRESH_TTL_MS) {
    return {
      payload: { ...cached.payload, servedAt: new Date(now).toISOString(),
                 ageSeconds: Math.round((now - Date.parse(cached.observedAt)) / 1000) },
      health: HEALTH.FRESH, cacheHit: true, upstreamStatus: null, shouldStore: false,
    };
  }

  // 2. Cache vencido (ou inexistente): tenta a fonte.
  let raw = null, upstreamStatus = null, upstreamOk = false;
  try {
    const r = await fetchRaw();
    upstreamStatus = r?.status ?? null;
    upstreamOk = !!r?.ok;
    if (upstreamOk) raw = await r.json();
  } catch (err) {
    upstreamStatus = null; upstreamOk = false;  // timeout/DNS/abort caem aqui
  }

  // 3. Resposta boa E com forma válida → promove a último bom conhecido.
  //    A validação de FORMA é o que impede envenenamento de cache: um 200 com corpo quebrado
  //    nunca substitui uma observação boa anterior.
  if (upstreamOk && raw) {
    const problems = validateScoreboardShape(raw);
    if (problems.length === 0) {
      const observedAt = new Date(now).toISOString();
      const payload = buildGatewayPayload({
        competition, matches: normalizeScoreboard(raw, {}),
        observedAt, servedAt: observedAt, stale: false,
      });
      return { payload, health: HEALTH.FRESH, cacheHit: false, upstreamStatus, shouldStore: true };
    }
    // 200 com forma inválida é tratado como FALHA DA FONTE, não como "sem jogo".
    upstreamOk = false;
  }

  // 4. Fonte falhou (ou veio malformada). Há último bom conhecido dentro da janela?
  if (cached && age <= LAST_KNOWN_GOOD_MAX_AGE_MS) {
    return {
      payload: { ...cached.payload,
                 servedAt: new Date(now).toISOString(),
                 ageSeconds: Math.round((now - Date.parse(cached.observedAt)) / 1000),
                 stale: true,
                 staleReason: upstreamStatus ? `UPSTREAM_${upstreamStatus}` : "UPSTREAM_UNREACHABLE" },
      health: HEALTH.STALE, cacheHit: true, upstreamStatus, shouldStore: false,
    };
  }

  // 5. Nada confiável a oferecer. Admite. `matches: null`, jamais `[]`.
  return {
    payload: sourceUnavailablePayload(competition,
      upstreamStatus ? `UPSTREAM_${upstreamStatus}` : "UPSTREAM_UNREACHABLE"),
    health: HEALTH.SOURCE_UNAVAILABLE, cacheHit: false, upstreamStatus, shouldStore: false,
  };
}

/** Requisição inválida → 400 com motivo legível. Nunca 200 com corpo vazio. */
export function validateRequest(competitionKey, method) {
  if (method && method !== "GET" && method !== "OPTIONS") {
    return { ok: false, status: 405, error: "METHOD_NOT_ALLOWED" };
  }
  if (typeof competitionKey !== "string" || !competitionKey) {
    return { ok: false, status: 400, error: "COMPETITION_REQUIRED" };
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_COMPETITIONS, competitionKey)) {
    // Não ecoa o valor recebido de volta — entrada do usuário refletida na resposta é superfície
    // desnecessária, e o cliente já sabe o que enviou.
    return { ok: false, status: 400, error: "UNKNOWN_COMPETITION" };
  }
  return { ok: true, schemaVersion: SCHEMA_VERSION };
}
