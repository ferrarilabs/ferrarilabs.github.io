/**
 * football_live_store.js — A ÚNICA FONTE DE VERDADE DE ESTADO AO VIVO NO NAVEGADOR.
 *
 * ─── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────────────────────
 *
 * O hero de jogo ao vivo sumiu da tela quatro vezes, por quatro causas diferentes. A investigação
 * mostrou por quê: **21 pontos** no código decidiam independentemente se uma partida estava ao
 * vivo (`state === "in"`, `state === "post"`, `completed === true`, `.postponed`), espalhados por
 * três apps. Não havia uma decisão para consertar — havia vinte e uma. Consertar uma deixava as
 * outras vinte, e a próxima quebra vinha de um lugar diferente.
 *
 * Este módulo existe para que passe a haver UMA.
 *
 * ─── HIERARQUIA DE FONTES ───────────────────────────────────────────────────────────────────
 *
 *   1. gateway Ferrari Labs (dado sob demanda, segundos de idade)
 *   2. último-bom-conhecido do próprio gateway (já vem marcado `stale`)
 *   3. snapshot commitado (bootstrap e emergência APENAS — não é mais o transporte ao vivo)
 *
 * O navegador NUNCA fala com a ESPN. O snapshot commitado deixou de ser o caminho crítico: ele
 * serve para a primeira pintura da tela e para o caso de o gateway estar fora.
 *
 * ─── A REGRA QUE ORIGINA O DESENHO ──────────────────────────────────────────────────────────
 *
 * São TRÊS perguntas diferentes, e tratá-las como uma foi a origem de todas as quebras:
 *
 *     A partida está ao vivo?           → a FONTE declara. Não expira com o tempo.
 *     Qual o último minuto confirmado?  → FATO observado. Também não expira.
 *     Há quanto tempo não observamos?   → só ISTO envelhece.
 *
 * Ausência de evidência nova nunca é evidência de que a partida acabou.
 */
(function (root) {
  "use strict";

  var STATE = {
    NO_LIVE_MATCH: "NO_LIVE_MATCH",
    LIVE_FRESH: "LIVE_FRESH",
    LIVE_STALE: "LIVE_STALE",
    LIVE_CRITICAL_STALE: "LIVE_CRITICAL_STALE",
    FINAL: "FINAL",
    POSTPONED: "POSTPONED",
    SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  };

  var SOURCE = { GATEWAY: "gateway", SNAPSHOT: "snapshot", NONE: "none" };

  // Frescor. `LIVE_STALE` acima de 30s; `LIVE_CRITICAL_STALE` acima de 10 min — o mesmo limite da
  // janela de último-bom-conhecido do gateway, de propósito: passado isso, nem o servidor tem
  // observação recente, e o cliente não deveria fingir mais confiança que a fonte.
  var STALE_AFTER_MS = 30_000;
  var CRITICAL_STALE_AFTER_MS = 10 * 60_000;

  // Cadência adaptativa. Números escolhidos pela meta operacional (dado com no máximo ~30s durante
  // o jogo), não por chute.
  var POLL = {
    LIVE: 15_000,
    NEAR_KICKOFF: 30_000,   // até 30 min antes de uma partida agendada
    IDLE: 120_000,
    HIDDEN: 300_000,        // aba em segundo plano: manter vivo sem gastar bateria
  };
  var NEAR_KICKOFF_WINDOW_MS = 30 * 60_000;

  /** Estados TERMINAIS declarados pela fonte. Nunca inferidos por relógio. */
  function terminalOf(m) {
    if (!m) return null;
    if (m.postponed || m.statusName === "STATUS_POSTPONED") return STATE.POSTPONED;
    if (m.statusName === "STATUS_CANCELED" || m.statusName === "STATUS_SUSPENDED") return STATE.POSTPONED;
    if (m.state === "post" || m.completed === true) return STATE.FINAL;
    return null;
  }

  /**
   * ★ A ÚNICA DECISÃO DE "ESTÁ AO VIVO?" DA PLATAFORMA. ★
   *
   * Qualquer componente que precise saber isso chama aqui. Reimplementar este predicado em
   * qualquer outro lugar é o defeito que este módulo existe para eliminar — e há um gate que
   * falha se voltar a acontecer.
   */
  function isLiveMatch(m) {
    if (!m) return false;
    if (terminalOf(m)) return false;
    return m.state === "in";
  }

  function firstLive(matches) {
    if (!Array.isArray(matches)) return null;
    for (var i = 0; i < matches.length; i++) if (isLiveMatch(matches[i])) return matches[i];
    return null;
  }

  function parseTs(v) {
    var t = Date.parse(v || "");
    return isFinite(t) ? t : 0;
  }

  // ─── STORE ────────────────────────────────────────────────────────────────────────────────
  function createStore(opts) {
    opts = opts || {};
    var competition = opts.competition;
    var gatewayUrl = opts.gatewayUrl;
    var now = opts.now || function () { return Date.now(); };
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(root) : null);

    var listeners = [];
    var timer = null;          // SINGLETON: só pode existir UM timer por store
    var started = false;
    var consecutiveFailures = 0;

    // Observação corrente. Substituída SOMENTE por outra estritamente mais nova.
    var current = null;        // { matches, observedAt, observedTs, source, stale, staleReason }
    var lastGatewayOkAt = null;
    var lastError = null;
    // Id da última partida CONFIRMADA ao vivo. Sem isto, quando uma observação nova traz a partida
    // já encerrada, não há como saber QUAL das partidas do payload é a que interessa — e o estado
    // terminal (FINAL/adiado) cairia em "não há jogo", que é justamente a confusão que este
    // módulo existe para eliminar.
    var lastLiveMatchId = null;

    function emit() {
      var snap = getState();
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](snap); } catch (e) { /* um consumidor com defeito não derruba os outros */ }
      }
    }

    // Ciclo de vida terminal já confirmado, por id de partida. Ver enforceTerminalMonotonicity().
    var terminalById = {};

    /**
     * TERMINAL_STATE_NON_REGRESSION.
     *
     * A regra de timestamp sozinha protege contra resposta ATRASADA que chega fora de ordem.
     * Ela não protege contra o caso oposto, que é real: o upstream declara FINAL às 22h05 e,
     * numa observação MAIS NOVA às 22h06, volta a declarar a mesma partida como `in`. Pela regra
     * de timestamp a observação nova é aceita, e o ciclo de vida anda para trás — o hero volta a
     * dizer AO VIVO num jogo que já acabou. Foi assim que o comentário anterior aqui errou: ele
     * argumentava que nenhum caso especial era necessário, mas cobria só metade do problema.
     *
     * Uma vez que a fonte declarou terminal (FINAL/adiado) para uma partida, o CICLO DE VIDA
     * daquela partida não regride. O que continua podendo ser corrigido é o FATO: placar, minuto,
     * detalhes — correções pós-jogo do provedor são legítimas e não devem ser descartadas. Por
     * isso preservamos os campos novos e reimpomos apenas os campos que determinam o terminal.
     */
    function enforceTerminalMonotonicity(matches) {
      if (!Array.isArray(matches)) return matches;
      var out = [];
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        var known = m && m.id ? terminalById[m.id] : null;
        var t = terminalOf(m);
        if (t && m && m.id) {
          terminalById[m.id] = { state: t, statusName: m.statusName, matchState: m.state, postponed: !!m.postponed };
          out.push(m);
          continue;
        }
        if (!known) { out.push(m); continue; }
        // Regressão: a observação nova diz não-terminal para uma partida já encerrada. Mantém o
        // ciclo de vida, absorve os fatos novos.
        var fixed = {};
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) fixed[k] = m[k];
        fixed.state = known.matchState;
        fixed.statusName = known.statusName;
        fixed.postponed = known.postponed;
        if (known.state === STATE.FINAL) fixed.completed = true;
        out.push(fixed);
      }
      return out;
    }

    /**
     * Aceita uma observação apenas se for ESTRITAMENTE mais nova que a corrente.
     *
     * A ordem de CHEGADA das respostas não é verdade: duas requisições em voo podem retornar
     * fora de ordem, e a mais antiga chegando depois faria o placar andar para trás. A verdade é
     * o `observedAt` da FONTE.
     *
     * Exceção deliberada: transição terminal (FINAL/adiado) de uma observação mais nova sempre
     * entra; e uma observação mais VELHA nunca reverte um terminal já registrado.
     */
    function ingest(obs) {
      if (!obs || !obs.observedAt) return false;
      var ts = parseTs(obs.observedAt);
      if (!ts) return false;
      if (current && ts <= current.observedTs) return false;   // fora de ordem: descarta
      obs.observedTs = ts;
      obs.matches = enforceTerminalMonotonicity(obs.matches);
      current = obs;
      var lv = firstLive(obs.matches);
      if (lv && lv.id) lastLiveMatchId = lv.id;
      return true;
    }

    function classify() {
      if (!current) {
        return { state: lastError ? STATE.SOURCE_UNAVAILABLE : STATE.NO_LIVE_MATCH, match: null };
      }
      var age = now() - current.observedTs;
      var live = firstLive(current.matches);

      if (!live) {
        // `matches: null` = a fonte não sabe. Diferente de lista vazia = sabemos que não há jogo.
        if (current.matches === null) return { state: STATE.SOURCE_UNAVAILABLE, match: null };

        // Sem partida ao vivo na observação. Houve TRANSIÇÃO de verdade? Só conta como terminal
        // se a fonte declarar explicitamente — nunca por dedução de tempo. Prioriza a partida que
        // estava ao vivo; se nunca houve uma, aceita um terminal único no payload (o caso do jogo
        // adiado que nunca chegou a começar).
        if (Array.isArray(current.matches)) {
          var i, t;
          if (lastLiveMatchId) {
            for (i = 0; i < current.matches.length; i++) {
              if (current.matches[i].id !== lastLiveMatchId) continue;
              t = terminalOf(current.matches[i]);
              if (t) return { state: t, match: current.matches[i] };
            }
          }
          var terminais = [];
          for (i = 0; i < current.matches.length; i++) {
            t = terminalOf(current.matches[i]);
            if (t) terminais.push({ state: t, match: current.matches[i] });
          }
          // Um único terminal é inequívoco. Vários (rodada encerrada) não caracterizam "a partida
          // em destaque acabou" — aí é simplesmente não haver jogo ao vivo.
          if (terminais.length === 1) return terminais[0];
        }
        return { state: STATE.NO_LIVE_MATCH, match: null };
      }

      var term = terminalOf(live);
      if (term) return { state: term, match: live };
      if (age > CRITICAL_STALE_AFTER_MS) return { state: STATE.LIVE_CRITICAL_STALE, match: live };
      if (age > STALE_AFTER_MS || current.stale) return { state: STATE.LIVE_STALE, match: live };
      return { state: STATE.LIVE_FRESH, match: live };
    }

    function getState() {
      var c = classify();
      var age = current ? now() - current.observedTs : null;
      return {
        state: c.state,
        match: c.match,
        matches: current ? current.matches : null,
        source: current ? current.source : SOURCE.NONE,
        observedAt: current ? current.observedAt : null,
        ageMs: age,
        stale: c.state === STATE.LIVE_STALE || c.state === STATE.LIVE_CRITICAL_STALE,
        staleReason: current ? current.staleReason || null : null,
        health: {
          gatewayLastOkAt: lastGatewayOkAt,
          consecutiveFailures: consecutiveFailures,
          lastError: lastError,
        },
      };
    }

    /** Bootstrap a partir do snapshot commitado. Só entra se não houver nada mais novo. */
    function seedFromSnapshot(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.matches)) return false;
      return ingest({
        matches: snapshot.matches,
        observedAt: snapshot.generatedAt,
        source: SOURCE.SNAPSHOT,
        stale: true,
        staleReason: "BOOTSTRAP_SNAPSHOT",
      }) && (emit(), true);
    }

    async function refresh() {
      if (!fetchImpl || !gatewayUrl) return false;
      try {
        var r = await fetchImpl(gatewayUrl + "?competition=" + encodeURIComponent(competition), {
          cache: "no-store",
        });
        var body = await r.json();

        // Contrato versionado: versão desconhecida é REJEITADA explicitamente, nunca interpretada
        // com otimismo. Interpretar errado um schema futuro seria pior que não usar o dado.
        if (body && body.schemaVersion !== 1) {
          lastError = "UNSUPPORTED_SCHEMA_" + body.schemaVersion;
          consecutiveFailures++;
          emit();
          return false;
        }

        if (!r.ok || !body || body.matches === null || body.status === "SOURCE_UNAVAILABLE") {
          // Fonte indisponível NÃO limpa a observação corrente. É exatamente aqui que o hero
          // sumia: um erro virava "não há jogo".
          lastError = (body && body.staleReason) || ("HTTP_" + r.status);
          consecutiveFailures++;
          emit();
          return false;
        }

        lastGatewayOkAt = new Date(now()).toISOString();
        consecutiveFailures = 0;
        lastError = null;
        var changed = ingest({
          matches: body.matches,
          observedAt: body.observedAt,
          source: SOURCE.GATEWAY,
          stale: !!body.stale,
          staleReason: body.staleReason || null,
        });
        if (changed) emit();
        return changed;
      } catch (e) {
        lastError = "NETWORK";
        consecutiveFailures++;
        emit();
        return false;
      }
    }

    /** Cadência adaptativa a partir do estado corrente. */
    function nextIntervalMs() {
      if (typeof document !== "undefined" && document.hidden) return POLL.HIDDEN;
      var c = classify();
      if (c.state === STATE.LIVE_FRESH || c.state === STATE.LIVE_STALE) return POLL.LIVE;
      if (c.state === STATE.LIVE_CRITICAL_STALE) return POLL.LIVE;
      // Perto do apito inicial de alguma partida agendada?
      if (current && Array.isArray(current.matches)) {
        var t = now();
        for (var i = 0; i < current.matches.length; i++) {
          var d = parseTs(current.matches[i].date);
          if (d && d - t > 0 && d - t < NEAR_KICKOFF_WINDOW_MS) return POLL.NEAR_KICKOFF;
        }
      }
      // Backoff exponencial limitado após falhas seguidas — não martelar um gateway que caiu.
      if (consecutiveFailures > 0) {
        return Math.min(POLL.IDLE, POLL.LIVE * Math.pow(2, Math.min(consecutiveFailures, 3)));
      }
      return POLL.IDLE;
    }

    function schedule() {
      // STOP_DURING_INFLIGHT_REFRESH: `stop()` pode ter acontecido enquanto o refresh que nos
      // chamou estava em voo. Sem esta guarda, o `.then(schedule)` de start() e o `schedule()`
      // do tick ressuscitam o laço DEPOIS do stop — a store fica polindo para sempre, invisível,
      // e cada start/stop de um rerender deixa mais um laço órfão para trás.
      if (!started) return;
      // SINGLETON: limpa antes de agendar. Sem isto, cada rerender/troca de idioma/troca de aba
      // criaria mais um laço — o defeito de timers acumulados que já apareceu neste repositório.
      if (timer) { clearTimeout(timer); timer = null; }
      timer = setTimeout(async function tick() {
        if (!started) return;
        await refresh();
        schedule();
      }, nextIntervalMs());
    }

    function start() {
      if (started) return;   // idempotente: chamar duas vezes não cria dois laços
      started = true;
      refresh().then(schedule);
    }

    function stop() {
      started = false;
      if (timer) { clearTimeout(timer); timer = null; }
      listeners = [];
    }

    return {
      STATE: STATE, SOURCE: SOURCE,
      subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
      getState: getState,
      seedFromSnapshot: seedFromSnapshot,
      refresh: refresh,
      start: start,
      stop: stop,
      isRunning: function () { return started; },
      timerCount: function () { return timer ? 1 : 0; },
      nextIntervalMs: nextIntervalMs,
      _ingest: ingest,      // exposto para teste de monotonicidade
    };
  }


  /**
   * ─── PREDICADOS CANÔNICOS DE ESTADO DE PARTIDA ─────────────────────────────────────────────
   *
   * Todo consumidor que precise saber em que estado uma partida está chama AQUI. Antes deste
   * módulo havia 21 lugares decidindo isso por conta própria, e o hero sumiu quatro vezes porque
   * não existia uma decisão para consertar — existiam vinte e uma.
   *
   * DISTINÇÃO QUE IMPORTA: nem toda leitura de `state` é uma decisão de estado AO VIVO. Consultas
   * de TABELA ("qual o próximo jogo?", "quais partidas contam para a classificação?", "quais
   * confrontos faltam?") leem o mesmo campo para responder outra pergunta, e passá-las por um
   * resolvedor de estado ao vivo conflaria as duas. Essas permanecem locais, documentadas.
   */
  function isFinalMatch(m) { return terminalOf(m) === STATE.FINAL; }
  function isPostponedMatch(m) { return terminalOf(m) === STATE.POSTPONED; }
  function isScheduledMatch(m) { return !!m && m.state === "pre" && !terminalOf(m); }

  /**
   * Adaptador para o formato de EVENTO da ESPN (`ev.competitions[0].status.type.*`), que os apps
   * ainda manipulam em alguns caminhos. Converte para a forma normalizada e delega — assim o
   * predicado continua sendo um só, e não nascem dois dialetos da mesma regra.
   */
  function eventToMatchShape(ev) {
    var comp = (ev && ev.competitions && ev.competitions[0]) || null;
    if (!comp) return null;
    var t = (comp.status && comp.status.type) || {};
    return { id: ev.id, state: t.state, statusName: t.name, completed: t.completed,
             postponed: ev.postponed === true };
  }
  function isLiveEvent(ev) { return isLiveMatch(eventToMatchShape(ev)); }
  function isFinalEvent(ev) { return isFinalMatch(eventToMatchShape(ev)); }
  root.BOLAO_FOOTBALL_LIVE = {
    isFinalMatch: isFinalMatch,
    isPostponedMatch: isPostponedMatch,
    isScheduledMatch: isScheduledMatch,
    eventToMatchShape: eventToMatchShape,
    isLiveEvent: isLiveEvent,
    isFinalEvent: isFinalEvent,
    STATE: STATE, SOURCE: SOURCE, POLL: POLL,
    STALE_AFTER_MS: STALE_AFTER_MS,
    CRITICAL_STALE_AFTER_MS: CRITICAL_STALE_AFTER_MS,
    isLiveMatch: isLiveMatch,
    terminalOf: terminalOf,
    firstLive: firstLive,
    createStore: createStore,
  };
})(typeof window !== "undefined" ? window : globalThis);
