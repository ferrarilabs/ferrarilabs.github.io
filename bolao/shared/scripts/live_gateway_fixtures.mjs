#!/usr/bin/env node
/**
 * FIXTURES CANÔNICAS DO GATEWAY `live-football`.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────
 *
 * `audit_accessibility.mjs` é um gate de merge OBRIGATÓRIO e, até 2026-08-20, dependia da saúde
 * de um terceiro: ele abre os quatro apps num navegador, os apps chamam o gateway `live-football`
 * implantado, e a suíte reprova em QUALQUER erro de console. Quando a ESPN degradou, o gateway
 * passou a responder `503 SOURCE_UNAVAILABLE`, o fetch falhou, o erro foi ao console e o gate ficou
 * vermelho — para TODO PR do repositório, independentemente do que o PR mudava (Issue #248;
 * evidência: #245 e #247 reprovaram no MESMO check único, por motivo externo a ambos).
 *
 * Duas perguntas diferentes estavam colapsadas num mesmo check:
 *
 *     "a interface é acessível?"                 → tem de ser DETERMINÍSTICA
 *     "a cadeia de dados externa está saudável?" → é intrinsecamente NÃO-determinística
 *
 * Este módulo serve à primeira. `check_live_gateway_health.mjs` serve à segunda. Elas não voltam a
 * ser o mesmo contrato.
 *
 * ─── A FORMA NÃO É INVENTADA AQUI ───────────────────────────────────────────────────────────
 *
 * Um fixture que o produto nunca emite testa ficção. Por isso NENHUM corpo é escrito à mão: os
 * payloads saem dos MESMOS construtores que a Edge Function usa em produção
 * (`buildGatewayPayload()` / `sourceUnavailablePayload()`), e as partidas passam pelo
 * `normalizeScoreboard()` real a partir de um evento cru no formato da ESPN. Se o schema do
 * gateway mudar, estes fixtures mudam junto — e `test_live_gateway_fixtures.mjs` reprova se
 * deixarem de casar.
 *
 * Uso: importado por audit_accessibility.mjs e test_live_gateway_fixtures.mjs.
 */

import {
  ALLOWED_COMPETITIONS,
  buildGatewayPayload,
  normalizeScoreboard,
  sourceUnavailablePayload,
} from "../../../supabase/functions/_shared/normalize.js";

/**
 * Os quatro estados que o contrato do gateway sabe produzir.
 *
 * `EMPTY` é deliberadamente distinto de `SOURCE_UNAVAILABLE`: "não há jogo agora" (`matches: []`,
 * `stale:false`, HTTP 200) e "a fonte falhou e eu não sei" (`matches: null`, `stale:true`,
 * HTTP 503) são respostas diferentes. Colapsar as duas é exatamente o defeito que fez o card ao
 * vivo sumir da tela com partida acontecendo — ver o cabeçalho de `audit_live_gateway.mjs`.
 */
export const GATEWAY_STATES = Object.freeze(["FRESH", "STALE", "EMPTY", "SOURCE_UNAVAILABLE"]);

/** Idade da observação usada no fixture STALE: passado o TTL fresco, dentro da janela de 10 min. */
const STALE_AGE_MS = 4 * 60_000;

/** Evento cru no formato REAL da ESPN — a entrada que `normalizeScoreboard()` recebe em produção. */
function rawEspnEvent(kickoffIso) {
  return {
    id: "900001",
    date: kickoffIso,
    competitions: [{
      status: {
        clock: 2880, displayClock: "48'", period: 2,
        type: { state: "in", name: "STATUS_IN_PROGRESS", description: "In Progress",
                shortDetail: "48'", detail: "48'", completed: false },
      },
      venue: { fullName: "Arena", address: { city: "Cidade" } },
      competitors: [
        { homeAway: "home", score: "2", winner: false, team: { id: "1", displayName: "Atlético Mineiro Clube" } },
        { homeAway: "away", score: "1", winner: false, team: { id: "2", displayName: "Red Bull Bragantino" } },
      ],
      details: [],
    }],
  };
}

/** Partidas normalizadas pelo normalizador REAL — nunca um objeto escrito à mão. */
export function fixtureMatches(kickoffIso) {
  return normalizeScoreboard({ events: [rawEspnEvent(kickoffIso)] });
}

/**
 * Devolve `{ httpStatus, health, payload }` para um estado nomeado.
 *
 * Os códigos HTTP seguem o contrato que a própria Edge Function aplica
 * (`live-football/index.ts:167`): SOURCE_UNAVAILABLE → 503; qualquer outro estado servível → 200.
 */
export function gatewayFixture(competition, state = "FRESH", now = Date.now()) {
  if (!GATEWAY_STATES.includes(state)) {
    throw new Error(`estado de fixture desconhecido: ${state} (conhecidos: ${GATEWAY_STATES.join(", ")})`);
  }
  // A competição vira apenas um RÓTULO no corpo — nunca parte de URL — então uma chave desconhecida
  // não é superfície de ataque. Ainda assim o fixture só finge ser o que o gateway aceita.
  const key = Object.prototype.hasOwnProperty.call(ALLOWED_COMPETITIONS, competition) ? competition : "br2026";
  const servedAt = new Date(now).toISOString();

  if (state === "SOURCE_UNAVAILABLE") {
    return { httpStatus: 503, health: "SOURCE_UNAVAILABLE",
             payload: { ...sourceUnavailablePayload(key, "UPSTREAM_403"), servedAt } };
  }

  if (state === "STALE") {
    const observedAt = new Date(now - STALE_AGE_MS).toISOString();
    return {
      httpStatus: 200, health: "STALE",
      payload: buildGatewayPayload({
        competition: key, matches: fixtureMatches(observedAt),
        observedAt, servedAt, stale: true, staleReason: "UPSTREAM_403",
      }),
    };
  }

  // FRESH e EMPTY compartilham a saúde `FRESH`: uma observação recente SEM jogo é uma observação
  // boa. O que as separa é o conteúdo (`matches: []` vs. lista), não a saúde da fonte.
  const observedAt = servedAt;
  return {
    httpStatus: 200, health: "FRESH",
    payload: buildGatewayPayload({
      competition: key,
      matches: state === "EMPTY" ? [] : fixtureMatches(new Date(now - 48 * 60_000).toISOString()),
      observedAt, servedAt, stale: false, staleReason: null,
    }),
  };
}

/**
 * Instala o mock do gateway numa página Playwright.
 *
 * A competição é lida da PRÓPRIA query da requisição, então um app novo que chame o gateway com
 * outra competição continua recebendo um corpo coerente — o mock não precisa saber quem chamou.
 */
export async function routeLiveGateway(page, state = "FRESH") {
  await page.route("**/functions/v1/live-football*", (route) => {
    let competition = "br2026";
    try { competition = new URL(route.request().url()).searchParams.get("competition") || competition; }
    catch { /* URL malformada não pode derrubar a suíte: o fixture padrão ainda é uma resposta válida */ }
    const { httpStatus, health, payload } = gatewayFixture(competition, state);
    route.fulfill({
      status: httpStatus,
      contentType: "application/json",
      headers: { "x-live-health": health },
      body: JSON.stringify(payload),
    });
  });
}
