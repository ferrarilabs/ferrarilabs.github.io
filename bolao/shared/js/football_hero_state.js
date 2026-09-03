/**
 * football_hero_state.js — a política ÚNICA de apresentação do hero de futebol (#246).
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────
 *
 * O hero sumiu da produção repetidas vezes, por causas diferentes a cada vez: gateway fora,
 * cache vencido, cron do GitHub atrasado, ESPN bloqueando o egresso. Nenhuma dessas é a causa
 * raiz. A causa raiz é que CADA app decidia sozinho, e todos decidiam a mesma coisa errada:
 *
 *     if (!temJogoAoVivo) { card.classList.add("hidden"); return; }
 *
 * Havia seis caminhos assim, em dois apps — dois deles duplicados dentro do mesmo arquivo. Cada
 * camada que falhava chegava num deles por um caminho distinto, e todos terminavam em `hidden`.
 * Por isso "sumiu por quatro causas diferentes": era um sintoma só, com quatro gatilhos.
 *
 * ─── O INVARIANTE ───────────────────────────────────────────────────────────────────────────
 *
 * Duas perguntas que estavam coladas e não podem estar:
 *
 *     1. O hero DEVE EXISTIR?
 *     2. QUÃO FRESCO é o dado dentro dele?
 *
 * A resposta de (1) NUNCA depende de status HTTP, frescor de cache, horário do produtor,
 * disponibilidade da ESPN, sucesso de fetch, conectividade, nem da existência de jogo ao vivo.
 *
 * **O provedor ENRIQUECE o hero. O provedor não é DONO da existência do hero.**
 *
 * Por isso este módulo não devolve booleano de visibilidade: `visible` é sempre `true`, e existe
 * como campo justamente para que uma leitura futura de `if (!estado.visible)` seja impossível de
 * escrever por engano. O que varia é o CONTEÚDO, nunca a presença.
 *
 * ─── ONDE ESTE MÓDULO NÃO MANDA ─────────────────────────────────────────────────────────────
 *
 * `football_live_store.js` continua sendo a autoridade única do ciclo de vida e do frescor do
 * dado ao vivo. Este arquivo não observa rede, não busca, não normaliza e não decide se uma
 * partida está ao vivo. Ele traduz "o que o store sabe" + "o que o torneio sabe" em "o que a
 * tela mostra". Ciclo de vida do LIVE e visibilidade do HERO são coisas diferentes, e foi
 * confundi-las que produziu o defeito.
 *
 * ─── HONESTIDADE ────────────────────────────────────────────────────────────────────────────
 *
 * Nenhum estado aqui inventa confronto, placar ou minuto. Quando não há dado, o estado diz que
 * não há — em vez de mostrar um buraco vazio, e em vez de mostrar um número velho como se fosse
 * atual. `SCHEDULE_UNKNOWN` é uma resposta legítima e verdadeira; hero ausente não é.
 */
(function (root) {
  "use strict";

  /**
   * Os estados semânticos. A ordem aqui é a ordem de PRECEDÊNCIA da decisão, e isso é
   * proposital: o mais informativo e mais confirmado vem primeiro.
   */
  var HERO = {
    LIVE_FRESH: "LIVE_FRESH",                 // ao vivo confirmado, observação recente
    LIVE_DELAYED: "LIVE_DELAYED",             // ao vivo confirmado, observação atrasada
    RECENT_FINAL: "RECENT_FINAL",             // terminou há pouco e nada mais próximo por vir
    UPCOMING: "UPCOMING",                     // próxima partida conhecida e autoritativa
    SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE", // fonte fora, mas há calendário/resultado local
    SCHEDULE_UNKNOWN: "SCHEDULE_UNKNOWN",     // sem fonte E sem próxima partida conhecida
  };

  /** Quanto tempo um resultado final ainda merece o hero, quando não há nada mais próximo. */
  var RECENT_FINAL_WINDOW_MS = 6 * 60 * 60 * 1000;

  function comoMs(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  /**
   * A política. Determinística e pura: mesmas entradas, mesmo resultado, sem relógio implícito
   * (`now` entra por parâmetro) e sem I/O — para que o teste possa varrer a matriz inteira sem
   * rede e sem esperar.
   *
   * @param {object}   e
   * @param {string}   e.liveState        estado do FootballLiveStore (STATE.*)
   * @param {Array}    e.liveMatches      partidas ao vivo confirmadas (pode ser vazio)
   * @param {object}   e.nextMatch        próxima partida autoritativa conhecida, ou null
   * @param {object}   e.recentResult     último resultado relevante conhecido, ou null
   * @param {boolean}  e.sourceOk         a fonte ao vivo respondeu de forma utilizável
   * @param {number}   e.now              instante de referência (ms)
   * @returns {{visible: true, state: string, reason: string, matches: Array,
   *            nextMatch: ?object, recentResult: ?object, degraded: boolean}}
   */
  function deriveFootballHeroState(e) {
    e = e || {};
    var agora = typeof e.now === "number" ? e.now : Date.now();
    var aoVivo = Array.isArray(e.liveMatches) ? e.liveMatches : [];
    var proxima = e.nextMatch || null;
    var recente = e.recentResult || null;
    var fonteOk = e.sourceOk !== false;

    // O hero SEMPRE existe. Este objeto é a base de toda saída, e `visible` nunca é outra coisa.
    var base = {
      visible: true,
      matches: aoVivo,
      nextMatch: proxima,
      recentResult: recente,
      degraded: false,
    };

    function saida(estado, motivo, degradado) {
      base.state = estado;
      base.reason = motivo;
      base.degraded = !!degradado;
      return base;
    }

    // 1. Ao vivo confirmado ganha de tudo — inclusive de fonte degradada. Uma observação atrasada
    //    de um jogo que ESTÁ acontecendo continua sendo a informação mais relevante da página; o
    //    que muda é dizer que está atrasada, não esconder a partida.
    //
    //    O LIMITE disso, aprendido em produção (incidente 2026-09-02/03): `LIVE_CRITICAL_STALE`
    //    NÃO é "atrasado", é "sem evidência suficiente". O contrato de frescor já dizia isso em
    //    football_live_store.js — `> 30 min = UNAVAILABLE  não passa por verdade ao vivo` — e
    //    esta função o contradizia, devolvendo LIVE_DELAYED para QUALQUER idade. Resultado: 829
    //    minutos depois do último dado, a página ainda estampava AO VIVO sobre um 0×0 do 14' de
    //    um jogo que terminara 2×0. Duas camadas, dois contratos, e o de baixo ignorado.
    //
    //    Retirar a AFIRMAÇÃO ao vivo não é esconder o hero: o invariante do #246 continua
    //    valendo, e a decisão cai para os ramos autoritativos abaixo (final recente / próxima
    //    partida / fonte indisponível), que são LOCAIS e honestos. UNKNOWN != LIVE, UNKNOWN != FINAL:
    //    em nenhum momento se conclui que a partida acabou.
    var evidenciaVencida = e.liveState === "LIVE_CRITICAL_STALE";
    if (aoVivo.length && !evidenciaVencida) {
      var atrasado = e.liveState === "LIVE_STALE" || !fonteOk;
      return atrasado
        ? saida(HERO.LIVE_DELAYED, "live confirmado com observacao atrasada", true)
        : saida(HERO.LIVE_FRESH, "live confirmado e recente", false);
    }
    if (aoVivo.length && evidenciaVencida) {
      // A partida sai da APRESENTAÇÃO ao vivo. `matches` esvazia para que nenhum consumidor
      // desenhe placar/relógio como se fossem atuais — o dado velho não vira dado corrente.
      base.matches = [];
      aoVivo = [];
    }

    // 2. Sem jogo ao vivo. A partir daqui a fonte ao vivo não tem mais nada a dizer, e quem
    //    responde é o estado autoritativo do torneio/liga — que é LOCAL e não depende de rede.
    var tRecente = recente ? comoMs(recente.kickoff || recente.date || recente.finishedAt) : null;
    var recenteAindaVale = tRecente != null && (agora - tRecente) <= RECENT_FINAL_WINDOW_MS;
    var tProxima = proxima ? comoMs(proxima.kickoff || proxima.date) : null;

    // Um final recente só vence a próxima partida se realmente estiver mais perto do agora —
    // senão o participante fica olhando o passado com o próximo jogo já marcado.
    if (recente && recenteAindaVale) {
      var maisPertoQueAProxima = tProxima == null || (agora - tRecente) < (tProxima - agora);
      if (maisPertoQueAProxima) {
        return saida(HERO.RECENT_FINAL, "final recente e nada mais proximo", !fonteOk || evidenciaVencida);
      }
    }

    if (proxima) {
      return saida(HERO.UPCOMING, "proxima partida autoritativa conhecida", !fonteOk || evidenciaVencida);
    }

    // 3. Não há ao vivo, não há final recente, não há próxima conhecida. Ainda assim o hero fica:
    //    a diferença entre os dois estados abaixo é DIZER A VERDADE sobre por que está vazio.
    if (!fonteOk || evidenciaVencida) {
      return saida(HERO.SOURCE_UNAVAILABLE,
        evidenciaVencida ? "evidencia ao vivo vencida: nao da para afirmar que segue ao vivo"
                         : "fonte ao vivo indisponivel", true);
    }
    return saida(HERO.SCHEDULE_UNKNOWN, "sem partida ao vivo, final recente ou proxima conhecida", false);
  }

  root.BOLAO_FOOTBALL_HERO = {
    HERO: HERO,
    RECENT_FINAL_WINDOW_MS: RECENT_FINAL_WINDOW_MS,
    deriveFootballHeroState: deriveFootballHeroState,
  };
})(typeof window !== "undefined" ? window : globalThis);
