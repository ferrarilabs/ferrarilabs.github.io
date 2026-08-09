/**
 * live_clock.js — SEMÂNTICA CANÔNICA DO RELÓGIO AO VIVO (navegador + Node).
 *
 * ─── O BUG QUE ORIGINOU ESTE ARQUIVO ────────────────────────────────────────────────────────
 *
 * 2026-08-09, print de produção do Eduardo: card do Cruzeiro 1 × 1 Mirassol marcado **AO VIVO**,
 * feed de lances mostrando 48', 27', 26' — e no centro, onde deveria estar o minuto:
 * "Atualização pendente". A tela sabia que o jogo estava ao vivo, sabia o placar, sabia os
 * lances, e mesmo assim não dizia o minuto que ela própria acabara de exibir no feed.
 *
 * A causa foi uma correção anterior MINHA passando do ponto. O problema original era o relógio
 * disparar sozinho (interpolar minutos indefinidamente com o relógio local depois que a fonte
 * parava de atualizar). A correção capou a interpolação — certo — e, passado o teto, **trocou o
 * relógio inteiro** pela mensagem de "dado velho" — errado.
 *
 * São três perguntas diferentes, e o código tratava como uma:
 *
 *   A. A partida está oficialmente ao vivo?          → a FONTE declara. Não expira com o tempo.
 *   B. Que minuto a fonte confirmou por último?       → um FATO observado. Também não expira.
 *   C. Há quanto tempo não observamos a fonte?        → isso sim envelhece.
 *
 * "Não sei se ainda é 48'" nunca justificou apagar "a última confirmação foi 48'". O minuto
 * confirmado continua sendo a melhor informação disponível; o que muda é a confiança nele.
 *
 * ─── ORDEM DE AUTORIDADE (derivada do dado normalizado real da ESPN) ────────────────────────
 *
 * 1. Estados DECLARADOS pela fonte que não dependem de relógio: intervalo, pênaltis, encerrado.
 *    São afirmações sobre o estado da partida, não medidas de tempo — dado velho não os invalida.
 * 2. `clockSeconds` + `period` — o relógio normalizado. É o valor autoritativo do minuto.
 * 3. `clockStr` — o texto da fonte, usado quando não há segundos normalizados.
 * 4. Feed de lances — **checagem de consistência apenas, NUNCA autoridade de relógio.** Um lance
 *    aos 48' prova que a partida chegou ao 48'; não prova que o minuto atual é 48'.
 *
 * ─── PROIBIÇÃO EXPLÍCITA ────────────────────────────────────────────────────────────────────
 *
 * O relógio local NUNCA inventa minuto de futebol depois que a observação envelhece. Passado o
 * teto, o valor CONGELA no último confirmado. Nunca exibir 63' só porque se passaram 15 minutos
 * locais desde um 48' confirmado.
 *
 * ─── ESTADOS ────────────────────────────────────────────────────────────────────────────────
 *
 *   LIVE_FRESH   observação recente  → minuto interpolado a partir do confirmado
 *   LIVE_STALE   observação velha    → minuto CONGELADO no último confirmado + marca de atraso
 *   HALFTIME     declarado pela fonte
 *   PENALTIES    declarado pela fonte
 *   FINAL        declarado pela fonte — sem timer, sem aviso de atraso
 *   UNKNOWN      sem minuto confirmado E sem estado declarado — só aqui cabe a mensagem genérica
 *
 * `UNKNOWN` é o único caso em que a mensagem genérica substitui tudo, porque é o único em que
 * genuinamente não há nada confirmado a mostrar.
 */
(function (root) {
  "use strict";

  var STATE = {
    LIVE_FRESH: "LIVE_FRESH",
    LIVE_STALE: "LIVE_STALE",
    HALFTIME: "HALFTIME",
    PENALTIES: "PENALTIES",
    FINAL: "FINAL",
    UNKNOWN: "UNKNOWN",
  };

  /**
   * @param {object} m           partida normalizada (clockSeconds, clockStr, period, pollTime,
   *                             isHalftime, isPenalties, clockPaused, isFinal)
   * @param {object} opts        { now, maxInterpolationMs }
   * @returns {{state, seconds, stale, confirmedSeconds, usesConfirmedOnly}}
   *
   * Devolve SEMÂNTICA, não texto. A formatação (e a tradução) continua em cada app, porque o
   * formato do minuto é decisão visual e o i18n é local — mas a DECISÃO de qual valor mostrar,
   * e se ele está atrasado, passa a ser uma só para a plataforma inteira.
   */
  function resolveLiveClock(m, opts) {
    m = m || {};
    opts = opts || {};
    var now = opts.now != null ? opts.now : Date.now();
    var maxInterp = opts.maxInterpolationMs != null ? opts.maxInterpolationMs : 180000;

    var pollTime = m.pollTime != null ? m.pollTime : now;
    var ageMs = Math.max(0, now - pollTime);
    var stale = ageMs > maxInterp;
    var confirmed = m.clockSeconds != null ? m.clockSeconds : null;

    // 1. Estados declarados pela fonte — imunes à idade da observação.
    if (m.isFinal) {
      return { state: STATE.FINAL, seconds: confirmed, stale: false, confirmedSeconds: confirmed, usesConfirmedOnly: true, ageMs: ageMs };
    }
    if (m.isHalftime) {
      return { state: STATE.HALFTIME, seconds: confirmed, stale: stale, confirmedSeconds: confirmed, usesConfirmedOnly: true, ageMs: ageMs };
    }
    if (m.isPenalties) {
      return { state: STATE.PENALTIES, seconds: confirmed, stale: stale, confirmedSeconds: confirmed, usesConfirmedOnly: true, ageMs: ageMs };
    }

    // 2. Sem nada confirmado e sem estado declarado: aqui, e só aqui, não sabemos mesmo.
    if (confirmed == null && !m.clockStr) {
      return { state: STATE.UNKNOWN, seconds: null, stale: stale, confirmedSeconds: null, usesConfirmedOnly: true, ageMs: ageMs };
    }

    // 3. Observação velha → CONGELA no último confirmado. Nunca inventa minuto novo.
    if (stale) {
      return { state: STATE.LIVE_STALE, seconds: confirmed, stale: true, confirmedSeconds: confirmed, usesConfirmedOnly: true, ageMs: ageMs };
    }

    // 4. Relógio parado declarado pela fonte (VAR, atendimento): não interpola, mas não é atraso.
    if (m.clockPaused) {
      return { state: STATE.LIVE_FRESH, seconds: confirmed, stale: false, confirmedSeconds: confirmed, usesConfirmedOnly: true, ageMs: ageMs };
    }

    // 5. Fresco: interpola a partir do confirmado, limitado ao teto.
    var interpolated = confirmed != null
      ? confirmed + Math.floor(Math.min(ageMs, maxInterp) / 1000)
      : null;
    return {
      state: STATE.LIVE_FRESH,
      seconds: interpolated,
      stale: false,
      confirmedSeconds: confirmed,
      usesConfirmedOnly: false,
      ageMs: ageMs,
    };
  }

  /**
   * Checagem de CONSISTÊNCIA entre o feed de lances e o relógio exibido.
   *
   * O feed não é autoridade de relógio — um lance aos 48' não prova que agora são 48'. Mas ele é
   * um sinal forte de contradição: se o feed mostra um lance aos 48' e o card não consegue exibir
   * minuto nenhum, alguma coisa está errada na resolução, não na partida. Foi exatamente esse o
   * formato do bug relatado.
   *
   * @returns {null|{reason, feedMinute, clockMinute}} null quando consistente.
   */
  function clockFeedConsistency(resolved, feedMinutes) {
    if (!feedMinutes || !feedMinutes.length) return null;
    var maxFeed = Math.max.apply(null, feedMinutes.filter(function (n) { return typeof n === "number" && isFinite(n); }));
    if (!isFinite(maxFeed)) return null;

    if (resolved.state === STATE.UNKNOWN) {
      return { reason: "FEED_HAS_MINUTE_BUT_CLOCK_UNKNOWN", feedMinute: maxFeed, clockMinute: null };
    }
    if (resolved.seconds == null && resolved.state !== STATE.HALFTIME && resolved.state !== STATE.PENALTIES && resolved.state !== STATE.FINAL) {
      return { reason: "FEED_HAS_MINUTE_BUT_NO_CLOCK_VALUE", feedMinute: maxFeed, clockMinute: null };
    }
    return null;
  }


  // ═══ RETENÇÃO DO ÚLTIMO ESTADO AO VIVO CONFIRMADO ═══════════════════════════════════════════
  //
  // POR QUE: o hero de jogo ao vivo já sumiu da tela do Eduardo três vezes, e a terceira expôs a
  // fragilidade estrutural — ele era controlado por `_liveMatches.length > 0`, ou seja, pela
  // observação ATUAL e por mais nada. Qualquer falha transitória a montante (snapshot velho,
  // fetch que falhou, payload que omitiu a partida) apagava um jogo que estava acontecendo.
  //
  // O INVARIANTE: ausência de evidência nova não é evidência de que a partida acabou.
  //
  // Uma vez que uma observação VÁLIDA confirmou "esta partida está ao vivo", o hero continua
  // visível com o ÚLTIMO ESTADO CONFIRMADO até que aconteça uma de duas coisas:
  //   a) uma observação autoritativa diga explicitamente que acabou/foi adiada/suspensa; ou
  //   b) o TTL de retenção expire — e aí o estado degrada para desconhecido, NUNCA para um
  //      resultado inventado.
  //
  // TTL = 15 MINUTOS. Escolhido a partir de medição, não de palpite: em 2026-08-09 os intervalos
  // reais entre execuções do cron do GitHub foram 24, 28, 34, 38, 40 e 47 minutos — o agendador
  // não entrega os `*/10` declarados. Reter por 15 min cobre com folga a falha TRANSITÓRIA (um
  // fetch que falhou, um payload incompleto) sem chegar perto de sustentar um jogo encerrado na
  // tela: um tempo de futebol dura 45 min, então 15 min nunca atravessa uma partida inteira.
  //
  // ISTO NÃO É UMA SEGUNDA FONTE DE VERDADE. É cache de apresentação: qualquer observação válida
  // nova SEMPRE substitui o retido, inclusive para pior (FINAL, adiado). O snapshot normalizado
  // continua sendo a autoridade.
  var RETENTION_TTL_MS = 15 * 60 * 1000;

  var FEATURED = {
    LIVE_CONFIRMED: "LIVE_CONFIRMED",
    LIVE_RETAINED: "LIVE_RETAINED",
    FINAL: "FINAL",
    POSTPONED: "POSTPONED",
    SUSPENDED: "SUSPENDED",
    SCHEDULED: "SCHEDULED",
    SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
    UNKNOWN: "UNKNOWN",
  };

  // Estados TERMINAIS declarados pela fonte. Só eles tiram o hero do ar antes do TTL — e nunca
  // se infere nenhum deles pela passagem do tempo.
  function terminalState(m) {
    if (!m) return null;
    if (m.postponed) return FEATURED.POSTPONED;
    if (m.suspended) return FEATURED.SUSPENDED;
    if (m.isFinal || m.state === "post" || m.completed === true) return FEATURED.FINAL;
    return null;
  }

  function observationIsUsable(m) {
    // Observação malformada é DESCARTADA, não aceita como "sem jogo ao vivo". Aceitar lixo como
    // ausência é como um payload quebrado apagaria o hero.
    return !!(m && m.id && (m.homeTeam || m.awayTeam));
  }

  /**
   * @param {object} args
   *   observed  partida ao vivo na observação ATUAL (ou null se não veio nenhuma)
   *   retained  último estado confirmado ao vivo ({match, confirmedAt}) ou null
   *   now       timestamp
   *   sourceOk  a observação atual é confiável? (false = fetch falhou / payload inválido)
   * @returns {{state, match, retained, reason, ageMs}}
   */
  function resolveFeaturedMatchState(args) {
    args = args || {};
    var now = args.now != null ? args.now : Date.now();
    var observed = observationIsUsable(args.observed) ? args.observed : null;
    var retained = args.retained || null;
    var sourceOk = args.sourceOk !== false;

    // 1. Observação atual válida e ao vivo: autoridade máxima. Substitui o retido sempre.
    if (sourceOk && observed) {
      var term = terminalState(observed);
      if (term) return { state: term, match: observed, retained: false, reason: "OBSERVED_TERMINAL", ageMs: 0 };
      return { state: FEATURED.LIVE_CONFIRMED, match: observed, retained: false, reason: "OBSERVED_LIVE", ageMs: 0 };
    }

    // 2. Sem observação ao vivo agora. Havia uma confirmada antes?
    if (retained && retained.match) {
      var age = now - (retained.confirmedAt || 0);
      // 2a. A observação atual, sendo válida, diz explicitamente que a partida terminou?
      if (sourceOk && args.terminalForRetained) {
        return { state: args.terminalForRetained, match: retained.match, retained: true,
                 reason: "TERMINAL_CONFIRMED", ageMs: age };
      }
      // 2b. Dentro do TTL: mantém no ar com o último confirmado. `<=` é deliberado — no instante
      //     exato do TTL ainda vale; a expiração é ESTRITAMENTE depois.
      if (age <= RETENTION_TTL_MS) {
        return { state: FEATURED.LIVE_RETAINED, match: retained.match, retained: true,
                 reason: sourceOk ? "OMITTED_FROM_SNAPSHOT" : "SOURCE_UNAVAILABLE", ageMs: age };
      }
      // 2c. TTL expirado: degrada para desconhecido. NÃO inventa resultado nem mantém "ao vivo".
      return { state: FEATURED.UNKNOWN, match: null, retained: false, reason: "RETENTION_EXPIRED", ageMs: age };
    }

    // 3. Nunca houve confirmação. Fonte ruim é diferente de "não há jogo".
    if (!sourceOk) return { state: FEATURED.SOURCE_UNAVAILABLE, match: null, retained: false, reason: "SOURCE_UNAVAILABLE", ageMs: 0 };
    return { state: FEATURED.UNKNOWN, match: null, retained: false, reason: "NO_LIVE_MATCH", ageMs: 0 };
  }

  root.BOLAO_LIVE_CLOCK = {
    FEATURED: FEATURED,
    RETENTION_TTL_MS: RETENTION_TTL_MS,
    resolveFeaturedMatchState: resolveFeaturedMatchState,
    terminalState: terminalState,
    STATE: STATE,
    resolveLiveClock: resolveLiveClock,
    clockFeedConsistency: clockFeedConsistency,
  };
})(typeof window !== "undefined" ? window : globalThis);
