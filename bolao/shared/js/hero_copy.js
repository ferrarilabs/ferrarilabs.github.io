/**
 * hero_copy.js — o CONTRATO DE TEXTO do hero e do prazo (#246).
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────
 *
 * `football_hero_state.js` já resolveu a EXISTÊNCIA do hero. O que sobrou, e o que continuou
 * gerando rótulo errado em produção, foi a DECISÃO DE TEXTO: cada renderizador escolhia a
 * própria frase, no meio do HTML, misturando três perguntas que são independentes:
 *
 *     A. ESTADO DA COMPETIÇÃO   — sorteio pendente/marcado/publicado, palpites abertos/fechados
 *     B. ESTADO DO CONTEÚDO     — ao vivo / final recente / próxima / sem calendário
 *     C. FRESCOR DO DADO        — fresco / atrasado / indisponível
 *
 * Coladas, elas produziram exatamente os dois defeitos que o Eduardo viu na produção:
 *
 *   1. "Dados ao vivo temporariamente indisponíveis" impresso embaixo de uma PRÓXIMA PARTIDA
 *      autoritativa e local. O aviso era verdadeiro sobre a fonte e IRRELEVANTE sobre o que
 *      estava na tela: o confronto e o horário não vieram do provedor ao vivo, então a queda
 *      dele não torna aquele conteúdo incerto. Alarme sem consequência treina o participante a
 *      ignorar o alarme — inclusive quando ele importa.
 *
 *   2. "Encerra em" impresso acima de "Prazo encerrado". Um rótulo de contagem regressiva em
 *      cima de um prazo que já venceu é uma contradição na mesma caixa.
 *
 * ─── O QUE ESTE MÓDULO FAZ ──────────────────────────────────────────────────────────────────
 *
 * Duas funções PURAS que recebem os três estados acima e devolvem CHAVES de i18n. Não formatam,
 * não tocam no DOM, não leem relógio global (`now` entra por parâmetro) e não conhecem nenhum
 * app. O renderizador consome o resultado; ele não decide mais nada sobre texto.
 *
 * ─── ONDE ESTE MÓDULO NÃO MANDA ─────────────────────────────────────────────────────────────
 *
 * Não decide visibilidade (é `football_hero_state.js`, e a resposta é sempre "existe"), não
 * decide se uma partida está ao vivo (é `football_live_store.js`), e não conhece as regras de
 * torneio de nenhum app: os estados de sorteio entram como um vocabulário NEUTRO
 * (`DRAW.*`), e é o CDB2026 que mapeia o próprio `DRAW_LIFECYCLE` para ele. O BR2026 não tem
 * sorteio e simplesmente não passa esse campo.
 */
(function (root) {
  "use strict";

  /** Estados de conteúdo do hero — os mesmos de `football_hero_state.js`, por contrato. */
  var HERO = {
    LIVE_FRESH: "LIVE_FRESH",
    LIVE_DELAYED: "LIVE_DELAYED",
    RECENT_FINAL: "RECENT_FINAL",
    UPCOMING: "UPCOMING",
    SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
    SCHEDULE_UNKNOWN: "SCHEDULE_UNKNOWN",
  };

  /**
   * A pergunta que separa o aviso útil do alarme inútil:
   *
   *     O que está sendo MOSTRADO depende do frescor da fonte ao vivo?
   *
   * Placar e minuto de um jogo em andamento dependem — se a fonte atrasa, o número na tela pode
   * estar velho, e calar isso é mentir. Um confronto futuro e um resultado final já encerrado
   * NÃO dependem: vieram do calendário/estado local do torneio, e continuam igualmente corretos
   * com o provedor fora do ar.
   *
   * `SCHEDULE_UNKNOWN` e `SOURCE_UNAVAILABLE` também dependem, por um motivo diferente: ali não
   * há conteúdo nenhum, e a queda da fonte é justamente a explicação de por que não há.
   */
  function freshnessAffectsDisplayed(heroState) {
    return heroState === HERO.LIVE_FRESH ||
           heroState === HERO.LIVE_DELAYED ||
           heroState === HERO.SOURCE_UNAVAILABLE ||
           heroState === HERO.SCHEDULE_UNKNOWN;
  }

  /**
   * Texto do hero de futebol.
   *
   * @param {object}  e
   * @param {string}  e.heroState  estado de conteúdo (HERO.*)
   * @param {boolean} e.degraded   a fonte ao vivo está degradada? (fato, vindo do store)
   * @returns {{state:string, noticeKey:?string, noticeRelevant:boolean, reason:string}}
   *   `noticeKey` é `null` quando NÃO se deve imprimir aviso nenhum. Nunca é uma string vazia:
   *   ausência de aviso é uma decisão explícita, não um texto em branco.
   */
  function selectHeroCopy(e) {
    e = e || {};
    var estado = e.heroState || HERO.SCHEDULE_UNKNOWN;
    var degradado = e.degraded === true;

    if (!degradado) {
      return { state: estado, noticeKey: null, noticeRelevant: false,
               reason: "fonte integra: nada a avisar" };
    }
    if (!freshnessAffectsDisplayed(estado)) {
      // O caso 1 do cabeçalho. A fonte ESTÁ fora — e o hero mostra conteúdo autoritativo que não
      // veio dela. Dizer "dados ao vivo indisponíveis" aqui seria verdadeiro sobre o sistema e
      // enganoso sobre a tela. O estado degradado continua no `data-hero-degraded` para quem
      // diagnostica; o participante não recebe um alarme sem consequência.
      return { state: estado, noticeKey: null, noticeRelevant: false,
               reason: "conteudo exibido nao depende do frescor da fonte" };
    }
    if (estado === HERO.LIVE_FRESH || estado === HERO.LIVE_DELAYED) {
      // Partida retida/atrasada: ela CONTINUA visível (invariante do #246) e o texto diz a
      // verdade sobre a atualização, não sobre a existência do dado — "indisponível" seria falso
      // com um placar na tela.
      return { state: estado, noticeKey: "liveDataDelayed", noticeRelevant: true,
               reason: "partida no ar com atualizacao atrasada" };
    }
    return { state: estado, noticeKey: "liveDataUnavailable", noticeRelevant: true,
             reason: "sem conteudo por indisponibilidade da fonte" };
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Prazo / sorteio
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /** Vocabulário NEUTRO de sorteio. Cada app mapeia o próprio ciclo de vida para cá. */
  var DRAW = {
    NONE: "NONE",                                   // esta competição não tem sorteio
    WAITING: "WAITING",                             // nem data marcada
    SCHEDULED: "SCHEDULED",                         // data marcada, ainda no futuro
    AWAITING_PUBLICATION: "AWAITING_PUBLICATION",   // ocorreu, publicação oficial pendente
    INGESTED: "INGESTED",                           // chegou, proveniência não validada
    LOCKED: "LOCKED",                               // validado, bracket autoritativo
  };

  /** Vocabulário NEUTRO de palpite. */
  var PICKS = {
    WAITING_DRAW: "WAITING_DRAW",       // sem sorteio validado não há o que palpitar
    SCHEDULE_PENDING: "SCHEDULE_PENDING", // sorteado, datas/horários oficiais ainda não saíram
    OPEN: "OPEN",
    CLOSED: "CLOSED",
  };

  /** Os modos de apresentação da caixa de prazo. */
  var MODE = {
    PICKS_COUNTDOWN: "PICKS_COUNTDOWN",   // contagem regressiva do prazo de palpite
    PICKS_CLOSED: "PICKS_CLOSED",         // prazo vencido — apresentação DEDICADA
    SCHEDULE_PENDING: "SCHEDULE_PENDING", // sorteado, faltam datas e horários
    DRAW_COUNTDOWN: "DRAW_COUNTDOWN",     // contagem regressiva do sorteio
    DRAW_STATUS: "DRAW_STATUS",           // mensagem de estado do sorteio
  };

  /**
   * As chaves que AFIRMAM que o sorteio ainda não aconteceu. Exportadas para que o gate de
   * regressão possa provar que nenhuma delas é alcançável com o sorteio já travado — em vez de
   * conferir uma string solta no meio do renderizador.
   */
  var DRAW_WAIT_KEYS = ["drawWaiting", "waitingDraw", "drawCountdownTitle"];

  /**
   * Texto da caixa de prazo. PURA.
   *
   * @param {object}  e
   * @param {string}  e.picksState      PICKS.*
   * @param {string}  e.drawState       DRAW.* (default DRAW.NONE)
   * @param {?number} e.cutoffMs        instante do prazo de palpite, ou null
   * @param {?number} e.drawScheduledMs instante do sorteio marcado, ou null
   * @param {number}  e.now
   * @returns {{mode:string, labelKey:string, bodyKey:?string, noteKey:?string,
   *            countdownMs:?number, reason:string}}
   */
  function selectPicksCountdownCopy(e) {
    e = e || {};
    var agora = typeof e.now === "number" ? e.now : Date.now();
    var picks = e.picksState || PICKS.CLOSED;
    var draw = e.drawState || DRAW.NONE;
    var cutoffMs = typeof e.cutoffMs === "number" ? e.cutoffMs : null;
    var drawMs = typeof e.drawScheduledMs === "number" ? e.drawScheduledMs : null;

    function saida(mode, labelKey, bodyKey, noteKey, countdownMs, reason) {
      return { mode: mode, labelKey: labelKey, bodyKey: bodyKey || null, noteKey: noteKey || null,
               countdownMs: countdownMs == null ? null : countdownMs, reason: reason };
    }

    // 1. Palpites abertos com prazo REAL no futuro. Só aqui "Encerra em" é verdade.
    if (picks === PICKS.OPEN && cutoffMs !== null && cutoffMs - agora > 0) {
      return saida(MODE.PICKS_COUNTDOWN, "countdownTitle", null, null, cutoffMs - agora,
                   "prazo de palpite aberto");
    }

    // 2. Sorteado, confrontos definidos, datas oficiais pendentes. Nem "aguardando sorteio"
    //    (falso) nem "encerra em" (não existe prazo para contar).
    if (picks === PICKS.SCHEDULE_PENDING) {
      return saida(MODE.SCHEDULE_PENDING, "schedulePendingTitle", "schedulePendingRule",
                   "schedulePendingNote", null, "sorteio concluido, tabela pendente");
    }

    // 3. Sorteio marcado e ainda no futuro: contagem regressiva do SORTEIO. Mais informativo que
    //    repetir que os palpites da fase anterior fecharam.
    if (draw === DRAW.SCHEDULED && drawMs !== null && drawMs - agora > 0) {
      return saida(MODE.DRAW_COUNTDOWN, "drawCountdownTitle", null, null, drawMs - agora,
                   "sorteio oficial marcado");
    }

    // 4. Prazo vencido: apresentação DEDICADA. Aqui havia `countdownTitle` ("Encerra em") com
    //    "Prazo encerrado" embaixo — rótulo de contagem regressiva sobre um prazo que já venceu.
    if (picks === PICKS.CLOSED) {
      return saida(MODE.PICKS_CLOSED, "picksClosedTitle", "picksClosedBody", null, null,
                   "prazo de palpite vencido");
    }

    // 5. Só agora as mensagens de SORTEIO. Elas exigem `picks === WAITING_DRAW`, que por
    //    construção do ciclo de vida da fase é incompatível com um sorteio validado — e o guarda
    //    explícito abaixo torna a incompatibilidade estrutural, não uma coincidência de ordem.
    if (draw !== DRAW.LOCKED) {
      if (draw === DRAW.AWAITING_PUBLICATION) {
        return saida(MODE.DRAW_STATUS, "drawStatusTitle", "drawAwaitingPublication", null, null,
                     "sorteio ocorreu, publicacao oficial pendente");
      }
      if (draw === DRAW.INGESTED) {
        return saida(MODE.DRAW_STATUS, "drawStatusTitle", "drawIngestedPending", null, null,
                     "sorteio recebido, proveniencia nao validada");
      }
      if (draw === DRAW.WAITING) {
        return saida(MODE.DRAW_STATUS, "drawStatusTitle", "drawWaiting", null, null,
                     "sorteio sem data marcada");
      }
    }

    // 6. Fallback. Deliberadamente NÃO é `waitingDraw`: era esse default que fazia o estado MAIS
    //    avançado (bracket travado, confrontos na tela) receber a mensagem MENOS avançada
    //    ("Aguardando sorteio oficial"). Um estado desconhecido não pode virar uma AFIRMAÇÃO
    //    sobre o sorteio; vira a apresentação de prazo fechado, que é a mais conservadora.
    return saida(MODE.PICKS_CLOSED, "picksClosedTitle", "picksClosedBody", null, null,
                 draw === DRAW.LOCKED ? "sorteio travado: mensagem de espera e impossivel"
                                      : "estado nao mapeado: apresentacao conservadora");
  }

  root.BOLAO_HERO_COPY = {
    HERO: HERO,
    DRAW: DRAW,
    PICKS: PICKS,
    MODE: MODE,
    DRAW_WAIT_KEYS: DRAW_WAIT_KEYS,
    freshnessAffectsDisplayed: freshnessAffectsDisplayed,
    selectHeroCopy: selectHeroCopy,
    selectPicksCountdownCopy: selectPicksCountdownCopy,
  };
})(typeof window !== "undefined" ? window : globalThis);
