/**
 * where_to_watch.js — enriquecimento NÃO-CRÍTICO dos cards de próximas partidas.
 *
 * Invariante de segurança: este módulo nunca decide qual é a próxima partida, nunca calcula
 * horário/estado/countdown e nunca faz fetch. Ele só lê o confronto que os apps BR2026/CDB2026
 * JÁ renderizaram e, quando existe uma transmissão brasileira confirmada no mapa abaixo,
 * acrescenta uma linha "Onde assistir". Confronto desconhecido => DOM permanece idêntico.
 *
 * Por que os dados são curados em vez de buscados no browser: direitos de transmissão mudam por
 * rodada e as páginas públicas não oferecem um contrato/API estável para consumo client-side.
 * Scraping no navegador seria uma dependência frágil (CORS/layout/anti-bot) em uma superfície que
 * hoje é estável. A atualização deste pequeno mapa é deliberadamente independente do calendário.
 *
 * Fontes consultadas em 2026-09-02:
 * - Claro tv+ / Premiere: grade com canais exatos de Brasileirão e Copa do Brasil.
 * - Record: confirmação da partida da rodada transmitida em TV aberta.
 * A disponibilidade da TV aberta pode variar por praça/região.
 */
(function (root) {
  "use strict";

  if (typeof document === "undefined" || typeof location === "undefined") return;

  var path = location.pathname || "";
  var competition = path.indexOf("/bolao/br2026/") !== -1 ? "br2026"
                  : path.indexOf("/bolao/cdb2026/") !== -1 ? "cdb2026"
                  : null;
  if (!competition) return;

  function norm(value) {
    var s = String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[–—-]/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Nomes que variam entre ESPN, aliases locais e copy de tela.
    s = s.replace(/^red bull bragantino$/, "bragantino");
    s = s.replace(/^rb bragantino$/, "bragantino");
    s = s.replace(/^vasco da gama$/, "vasco");
    s = s.replace(/^athletico paranaense$/, "athletico pr");
    return s;
  }

  function key(home, away) {
    return norm(home) + "|" + norm(away);
  }

  // Somente partidas com transmissão brasileira confirmada. Não há fallback inventado.
  var BROADCASTS = {
    br2026: {
      "flamengo|mirassol": "Premiere 1",
      "bragantino|bahia": "Premiere 4",
      "sao paulo|atletico mg": "Premiere 1",
      "fluminense|vasco": "sportv · Premiere 2",
      "coritiba|mirassol": "Premiere 1",
      "remo|flamengo": "Globo (TV aberta) · GE TV · Premiere 1",
      "cruzeiro|athletico pr": "Globo (TV aberta) · Premiere 2",
      "internacional|santos": "Globo (TV aberta) · Premiere 3",
      "botafogo|palmeiras": "Record (TV aberta) · CazéTV (YouTube) · Premiere 1",
      "corinthians|chapecoense": "Amazon Prime Video",
      "vitoria|gremio": "sportv · Premiere"
    },
    cdb2026: {
      "santos|palmeiras": "Globo (TV aberta) · sportv · sportv 4K · GE TV · Premiere 1 · Amazon Prime Video",
      "vitoria|vasco": "Globo (TV aberta) · sportv 2 · Premiere 2 · Amazon Prime Video",
      "gremio|internacional": "Amazon Prime Video"
    }
  };

  var table = BROADCASTS[competition] || {};

  function matchupFrom(el) {
    var raw = String(el && el.textContent || "").replace(/\s+/g, " ").trim();
    // Cards futuros usam ×. Não tenta interpretar placar (–) nem jogo já encerrado.
    var parts = raw.split("×");
    if (parts.length !== 2) return null;
    var home = parts[0].trim();
    var away = parts[1].trim();
    return home && away ? key(home, away) : null;
  }

  function enrichBlock(block) {
    if (!block || block.querySelector(".next-game-broadcast")) return;

    var teams = block.querySelector(".next-game-teams, .today-game-teams");
    if (!teams) return;

    var matchKey = matchupFrom(teams);
    if (!matchKey || !Object.prototype.hasOwnProperty.call(table, matchKey)) return;

    var line = document.createElement("div");
    // Reusa a tipografia já existente do card; nenhuma regra CSS nova é necessária.
    line.className = "next-game-info next-game-broadcast";
    line.setAttribute("aria-label", "Onde assistir esta partida no Brasil");

    var label = document.createElement("strong");
    label.textContent = "📺 Onde assistir: ";
    line.appendChild(label);
    line.appendChild(document.createTextNode(table[matchKey]));

    block.appendChild(line);
  }

  function apply() {
    document.querySelectorAll("#liveMatchCard .next-game-info-block, #nextGameCard .next-game-info-block")
      .forEach(enrichBlock);
  }

  var queued = false;
  function queueApply() {
    if (queued) return;
    queued = true;
    var schedule = typeof root.requestAnimationFrame === "function"
      ? root.requestAnimationFrame.bind(root)
      : function (fn) { return setTimeout(fn, 0); };
    schedule(function () {
      queued = false;
      apply();
    });
  }

  // Os apps redesenham esses cards em polls/re-syncs. O observer só reage a DOM; não altera a
  // cadência nem cria I/O. A própria classe .next-game-broadcast torna a operação idempotente.
  var observer = new MutationObserver(queueApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", queueApply, { once: true });
  } else {
    queueApply();
  }

  root.BOLAO_WHERE_TO_WATCH = {
    apply: apply,
    competition: competition,
    broadcasts: table
  };
})(typeof window !== "undefined" ? window : globalThis);
