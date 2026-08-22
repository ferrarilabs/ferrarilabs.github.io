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

import {
  FRESH_MAX_AGE_MS, STALE_BUT_USABLE_MAX_AGE_MS,
  FRESHNESS, classifyFreshness, isServable, dataAgeMs,
} from "./freshness_contract.js";

export { FRESH_MAX_AGE_MS, STALE_BUT_USABLE_MAX_AGE_MS, FRESHNESS, classifyFreshness };

/**
 * TTL do cache fresco: 15 segundos.
 *
 * Escolhido a partir da meta operacional (dado com no máximo ~30s durante o jogo) e da cadência
 * de polling do navegador (15–30s ao vivo). Com 15s, requisições simultâneas de vários visitantes
 * colapsam num único fetch à ESPN, e o dado nunca fica mais de meio ciclo atrás.
 */
export const FRESH_TTL_MS = 15_000;

/**
 * Janela de "último bom conhecido" — AGORA DERIVADA do contrato de frescor (Issue #296).
 *
 * Era 10 min e era o teto de tudo. Depois da medição de 2026-08-22 (o agendador do GitHub entrega
 * com mediana de 25,1 min, não de 5 em 5), 10 min deixou de poder ser o teto: seria apagão na maior
 * parte do tempo. Mas ele também não podia simplesmente subir para 30 min, porque isso passaria a
 * chamar de FRESCO um dado de meia hora.
 *
 * A saída foi separar os dois papéis que este número acumulava:
 *
 *   FRESH_MAX_AGE_MS (10 min)             até aqui o dado é apresentado como ao vivo;
 *   STALE_BUT_USABLE_MAX_AGE_MS (30 min)  até aqui ainda é servido, mas ROTULADO como atrasado.
 *
 * Este alias sobrevive só porque é o teto do que é servível, e há chamador externo importando o
 * nome. O valor vem do contrato — não existe um segundo número aqui.
 */
export const LAST_KNOWN_GOOD_MAX_AGE_MS = STALE_BUT_USABLE_MAX_AGE_MS;

/**
 * HEALTH — os nomes que JÁ ESTÃO NO FIO, mapeados 1:1 sobre o contrato de frescor.
 *
 * Os valores string NÃO mudam. Navegador já implantado testa `body.status === "SOURCE_UNAVAILABLE"`
 * (`football_live_store.js:370`) com JS cacheado que não posso atualizar de forma síncrona; trocar
 * a string quebraria esses clientes sem nenhum ganho. Então o estado novo viaja no campo aditivo
 * `freshness`, e `health` continua sendo o rótulo antigo do MESMO estado — não uma segunda verdade.
 */
export const HEALTH = {
  FRESH: "FRESH",
  STALE: "STALE",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
};

/** Tradução única e total FRESHNESS -> HEALTH. Se um estado novo surgir, isto falha alto. */
export function healthForFreshness(freshness) {
  switch (freshness) {
    case FRESHNESS.FRESH: return HEALTH.FRESH;
    case FRESHNESS.STALE_BUT_USABLE: return HEALTH.STALE;
    case FRESHNESS.UNAVAILABLE: return HEALTH.SOURCE_UNAVAILABLE;
    default: throw new Error(`FRESHNESS desconhecido: ${freshness}`);
  }
}

export function espnUrlFor(competitionKey) {
  const slug = ALLOWED_COMPETITIONS[competitionKey];
  // Whitelist fechada: a chave é um ÍNDICE, nunca parte da URL. Não há concatenação de entrada do
  // usuário no endpoint, então não existe superfície para path traversal nem para transformar o
  // gateway em proxy aberto — o pior que um id desconhecido consegue é um 400.
  if (!slug) return null;
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
}

/**
 * Serve a partir do último bom conhecido, com o rótulo que a IDADE do dado manda.
 *
 * NÃO ESCREVE. Não toca em `observedAt` nem em `storedAt`, e não devolve `shouldStore: true`.
 * É a garantia estrutural de que LER NÃO REJUVENESCE: um visitante abrindo a página mil vezes
 * não deixa o dado um milissegundo mais novo. Só uma observação nova do produtor (passo 3) avança
 * o frescor.
 */
function serveFromCache({ cached, now, ageMs, freshness, upstreamStatus, sourceDegraded }) {
  const stale = freshness === FRESHNESS.STALE_BUT_USABLE;
  return {
    payload: {
      ...cached.payload,
      servedAt: new Date(now).toISOString(),
      ageSeconds: Math.round(ageMs / 1000),
      freshness,
      // `stale` é o que acende o aviso de atraso na UI. Ele segue a IDADE, não o resultado do
      // fetch: fonte com erro + cache de 8 min é dado fresco de verdade, e mentir dizendo
      // "atrasado" seria tão errado quanto o contrário.
      stale,
      // Tres motivos DISTINTOS, e a diferenca importa para quem depura:
      //   UPSTREAM_<n>          a fonte respondeu, com erro;
      //   UPSTREAM_UNREACHABLE  tentamos e nem resposta houve (timeout/DNS/abort);
      //   DATA_AGE              nao houve tentativa — o dado envelheceu sozinho.
      // Colapsar os dois primeiros em DATA_AGE diria "o dado ficou velho" para uma ESPN fora do ar.
      ...(stale ? { staleReason: upstreamStatus ? `UPSTREAM_${upstreamStatus}`
                                : (sourceDegraded ? "UPSTREAM_UNREACHABLE" : "DATA_AGE") } : {}),
      // A falha da fonte não some do relato só porque o dado ainda está fresco — ela vira sinal
      // de telemetria separado, para o monitor não ficar cego a uma ESPN caindo.
      ...(sourceDegraded ? { sourceDegraded: true } : {}),
    },
    health: healthForFreshness(freshness),
    freshness,
    ageSeconds: Math.round(ageMs / 1000),
    cacheHit: true,
    upstreamStatus,
    shouldStore: false,
  };
}

/**
 * Decide o que servir. PURA: recebe cache e um `fetchRaw` injetado, não fala com a rede.
 *
 * A classificação é por IDADE DO DADO, não pelo desfecho do fetch (Issue #296). Antes, QUALQUER
 * queda para o cache era rotulada STALE — inclusive um cache de 16 segundos —, o que chamava de
 * atrasado um dado fresco. E, do outro lado, o teto de 10 min derrubava para SOURCE_UNAVAILABLE um
 * dado de 12 min que ainda era perfeitamente útil se dissesse a idade.
 *
 * @param {object} args
 *   competition  chave da competição (validada pelo chamador)
 *   cached       {payload, observedAt, storedAt} | null   último bom conhecido
 *   now          timestamp
 *   fetchRaw     async () => {ok, status, json}  transporte injetado
 * @returns {{payload, health, freshness, ageSeconds, cacheHit, upstreamStatus, shouldStore}}
 */
export async function resolveGatewayResponse({ competition, cached, now, fetchRaw }) {
  // Duas idades, dois papéis distintos — foi confundi-las que produziu o rótulo errado:
  //   ageMs      idade do DADO (por `observedAt`) -> classifica o frescor;
  //   cacheAgeMs idade da nossa GRAVAÇÃO         -> só decide se vale reconsultar a ESPN.
  const ageMs = dataAgeMs(cached, now);
  const cacheAgeMs = cached && Number.isFinite(cached.storedAt) ? now - cached.storedAt : Infinity;

  // 1. Atalho anti-martelada: gravamos há menos de 15s, várias abas colapsam num fetch só.
  //    Ainda assim o rótulo sai de `classifyFreshness` — o atalho nunca DECRETA "fresco".
  if (cached && cacheAgeMs < FRESH_TTL_MS) {
    const freshness = classifyFreshness(ageMs);
    if (isServable(freshness)) {
      return serveFromCache({ cached, now, ageMs, freshness, upstreamStatus: null, sourceDegraded: false });
    }
    // Gravação recente de uma observação velha (produtor atrasado): não serve, vai à fonte.
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

  // 3. Resposta boa E com forma válida → promove a último bom conhecido. O ÚNICO ponto de todo o
  //    gateway que avança o frescor, e ele exige uma observação nova e bem-formada da fonte.
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
      payload.freshness = FRESHNESS.FRESH;
      payload.ageSeconds = 0;
      return {
        payload, health: HEALTH.FRESH, freshness: FRESHNESS.FRESH, ageSeconds: 0,
        cacheHit: false, upstreamStatus, shouldStore: true,
      };
    }
    // 200 com forma inválida é tratado como FALHA DA FONTE, não como "sem jogo".
    upstreamOk = false;
  }

  // 4. Fonte falhou (ou veio malformada). O último bom conhecido ainda é servível pela IDADE?
  //    Um cache velho JAMAIS é promovido a fresco aqui: `classifyFreshness` só olha a idade, e a
  //    idade não mudou por termos tentado — e falhado — buscar.
  const freshness = classifyFreshness(ageMs);
  if (cached && isServable(freshness)) {
    return serveFromCache({ cached, now, ageMs, freshness, upstreamStatus, sourceDegraded: true });
  }

  // 5. Nada confiável a oferecer. Admite. `matches: null`, jamais `[]`.
  const payload = sourceUnavailablePayload(competition,
    upstreamStatus ? `UPSTREAM_${upstreamStatus}` : "UPSTREAM_UNREACHABLE");
  payload.freshness = FRESHNESS.UNAVAILABLE;
  return {
    payload, health: HEALTH.SOURCE_UNAVAILABLE, freshness: FRESHNESS.UNAVAILABLE,
    ageSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    cacheHit: false, upstreamStatus, shouldStore: false,
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
