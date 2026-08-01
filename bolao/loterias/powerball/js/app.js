(function () {
  "use strict";
  var DRAWS = window.POWERBALL_DRAWS;
  var GAME_TYPES = window.LOTTERY_GAME_TYPES;
  var LOCAL_KEY = "powerball_local_results_v1";
  var currentIdx = DRAWS.length - 1;
  var countdownTimer = null;

  function fmtUsd(n) {
    if (n === null || n === undefined) return "—";
    return "US$" + n.toLocaleString("en-US");
  }

  function loadLocalOverrides() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveLocalOverride(drawId, data) {
    var all = loadLocalOverrides();
    all[drawId] = data;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  }

  function getEffectiveDraw(draw) {
    var overrides = loadLocalOverrides()[draw.id];
    if (!overrides) return draw;
    var merged = JSON.parse(JSON.stringify(draw));
    if (overrides.result) merged.result = overrides.result;
    if (overrides.profit) merged.profit = overrides.profit;
    return merged;
  }

  function renderDrawSelector() {
    var sel = document.getElementById("pbDrawSelect");
    sel.innerHTML = DRAWS.map(function (d, i) {
      var gt = GAME_TYPES[d.gameType] || GAME_TYPES.powerball;
      var hasResult = getEffectiveDraw(d).result.numbers ? "✓ " : "";
      return '<option value="' + i + '"' + (i === currentIdx ? " selected" : "") + '>' +
        hasResult + gt.icon + " " + gt.label + " — " + d.drawing.drawDateLabel + "</option>";
    }).join("");
  }

  function applyTheme(gameType) {
    var gt = GAME_TYPES[gameType] || GAME_TYPES.powerball;
    document.documentElement.style.setProperty("--lot-accent", gt.accent);
    document.documentElement.style.setProperty("--lot-accent2", gt.accent2);
    document.getElementById("pbLogo").textContent = gt.icon;
    document.getElementById("pbPreviousResultsLink").href = gt.previousResultsUrl;
    document.title = "Bolão " + gt.label + " — Ferrari";
    return gt;
  }

  function renderSummary(draw) {
    var totalCotas = draw.participants.reduce(function (s, p) { return s + p.cotas; }, 0);
    var el = document.getElementById("pbSummary");
    el.innerHTML = [
      [fmtUsd(draw.finance.totalArrecadado), "Total arrecadado"],
      [totalCotas, "Cotas (US$20 cada)"],
      [draw.participants.length, "Participantes"],
      [fmtUsd(draw.finance.valorUtilizado), "Valor utilizado (tickets)"],
      [fmtUsd(draw.finance.valorGuardadoProximoSorteio), "Guardado p/ próximo sorteio"],
      ["$" + (draw.drawing.jackpot / 1e6).toFixed(0) + "M", "Jackpot"]
    ].map(function (row) {
      return '<div class="pb-summary-item"><div class="v">' + row[0] + '</div><div class="l">' + row[1] + "</div></div>";
    }).join("");
  }

  // "31/07/2026" + "4:52:51 PM" -> timestamp, para ordenar a tabela por entrada.
  function parseEntryTimestamp(p) {
    var dm = p.data.split("/"); // DD/MM/YYYY
    var iso = dm[2] + "-" + dm[1] + "-" + dm[0];
    var hora = p.hora === "—" ? "00:00:00" : p.hora;
    var t = new Date(iso + " " + hora).getTime();
    return isNaN(t) ? 0 : t;
  }

  function renderTable(draw) {
    var tbody = document.getElementById("pbParticipantsBody");
    var sorted = draw.participants.slice().sort(function (a, b) {
      return parseEntryTimestamp(a) - parseEntryTimestamp(b);
    });
    tbody.innerHTML = sorted.map(function (p) {
      var statusClass = p.status === "organizador" ? "organizador" : "verificado";
      var statusLabel = p.status === "organizador" ? "Organizador" : "✓ Verificado";
      return "<tr>" +
        "<td>" + p.name + "</td>" +
        "<td>" + fmtUsd(p.valor) + "</td>" +
        "<td>" + p.metodo + "</td>" +
        "<td>" + p.data + (p.hora !== "—" ? " " + p.hora : "") + "</td>" +
        '<td><span class="pb-status-pill ' + statusClass + '">' + statusLabel + "</span></td>" +
        "</tr>";
    }).join("");
  }

  function renderSharedTickets(draw) {
    var t = draw.sharedTickets;
    document.getElementById("pbTicketsMeta").textContent =
      "Comprado por " + t.compradoPor + " · " + t.dataComprovante + " · US$" + t.valorPorTicket + "/ticket (Power Play)";

    document.getElementById("pbTicketsBody").innerHTML = t.series.map(function (s) {
      var numsHtml = s.numeros && s.numeros.length
        ? "<ul>" + s.numeros.map(function (n, i) { return "<li>Jogo " + (i + 1) + ": " + n + "</li>"; }).join("") +
          (s.qtd > s.numeros.length ? '<li class="pb-pending">+ ' + (s.qtd - s.numeros.length) + " ticket(s) desse serial ainda não cadastrado(s)</li>" : "") +
          "</ul>"
        : '<div class="pb-pending">Números individuais deste serial ainda não cadastrados.</div>';
      var precoUnit = s.valorTotal ? s.valorTotal / s.qtd : t.valorPorTicket;
      return '<div class="pb-ticket-block">' +
        '<div class="serial">Serial: ' + s.serial + (s.jogos ? " · Jogos " + s.jogos : "") + (s.compradoEm ? " · " + s.compradoEm : "") + '</div>' +
        '<div class="qtd">' + s.qtd + " ticket(s) · " + fmtUsd(precoUnit) + "/ticket" + (s.valorTotal ? " · total " + fmtUsd(s.valorTotal) : "") + "</div>" +
        numsHtml +
        "</div>";
    }).join("");
  }

  // "01-14-27-63-64 — PB 25" -> { numbers:[1,14,27,63,64], special:25 }
  function parseTicketNumeros(str) {
    var m = str.match(/^([\d\s-]+?)\s*—\s*PB\s*(\d+)$/);
    if (!m) return null;
    return { numbers: m[1].split("-").map(Number), special: Number(m[2]) };
  }

  function allTickets(draw) {
    var out = [];
    draw.sharedTickets.series.forEach(function (s) {
      s.numeros.forEach(function (n) {
        var parsed = parseTicketNumeros(n);
        if (parsed) out.push(parsed);
      });
    });
    return out;
  }

  function computePrize(draw, gt, official) {
    var tickets = allTickets(draw);
    var total = 0;
    var jackpotHit = false;
    var breakdown = [];

    tickets.forEach(function (t) {
      var mainMatches = t.numbers.filter(function (n) { return official.numbers.indexOf(n) !== -1; }).length;
      var specialMatch = t.special === official.special;
      var prize = gt.prizeTable(mainMatches, specialMatch, official.multiplier);
      if (!prize) return;
      if (prize.amount === null) { jackpotHit = true; return; }
      if (prize.amount > 0) {
        total += prize.amount;
        breakdown.push(prize.label + " (" + fmtUsd(prize.amount) + ")");
      }
    });

    return { total: total, jackpotHit: jackpotHit, breakdown: breakdown, ticketsChecked: tickets.length };
  }

  function fetchOfficialResult(draw, gt) {
    var dateStr = draw.drawing.drawDateIso.slice(0, 10); // YYYY-MM-DD
    var url = gt.resultsApi + "?$order=draw_date DESC&$limit=20";
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (rows) {
      var row = rows.find(function (r) { return (r.draw_date || "").slice(0, 10) === dateStr; });
      if (!row) throw new Error("Sorteio de " + dateStr + " ainda não publicado");
      return gt.parseResult(row);
    });
  }

  function renderResultPending(state, message) {
    document.getElementById("pbResultDisplay").style.display = "none";
    var pending = document.getElementById("pbResultPending");
    pending.style.display = "";
    document.getElementById("pbResultPendingMsg").textContent = message;
    document.getElementById("pbResultRetryBtn").style.display = state === "error" ? "" : "none";
  }

  function renderResult(draw, gt) {
    var display = document.getElementById("pbResultDisplay");
    var pending = document.getElementById("pbResultPending");
    var r = draw.result;

    if (r && r.numbers && r.numbers.length) {
      pending.style.display = "none";
      display.style.display = "";
      var sortedNums = r.numbers.slice().sort(function (a, b) { return a - b; });
      document.getElementById("pbResultNumbers").textContent =
        sortedNums.join("-") + "  ·  " + gt.specialBallLabel + " " + r.special +
        (r.multiplier ? "  ·  Power Play " + r.multiplier + "x" : "");
      document.getElementById("pbResultChecked").textContent = "Conferido automaticamente em " + r.checkedAt;

      var profitEl = document.getElementById("pbResultProfit");
      if (r.jackpotHit) {
        profitEl.innerHTML = "🎉 <strong>JACKPOT!</strong> Ligue para o organizador imediatamente.";
      } else if (r.premiosGanhos > 0) {
        profitEl.innerHTML = "Prêmios ganhos: <strong>" + fmtUsd(r.premiosGanhos) + "</strong>" +
          (r.breakdown && r.breakdown.length ? " (" + r.breakdown.join(", ") + ")" : "") +
          " · Lucro: <strong>" + fmtUsd(r.premiosGanhos - draw.finance.valorUtilizado) + "</strong>";
      } else {
        profitEl.innerHTML = "Nenhum prêmio nesse sorteio · Lucro: <strong>" + fmtUsd(-draw.finance.valorUtilizado) + "</strong>";
      }
      return;
    }

    // Sem resultado salvo ainda: se o sorteio já passou, busca automaticamente.
    var drawPassed = new Date(draw.drawing.drawDateIso).getTime() <= Date.now();
    if (!drawPassed) {
      renderResultPending("waiting", "O resultado é buscado automaticamente na fonte oficial (NY Open Data) assim que o sorteio acontecer.");
      return;
    }

    renderResultPending("loading", "Buscando resultado oficial…");
    fetchOfficialResult(draw, gt).then(function (official) {
      var computed = computePrize(draw, gt, official);
      var override = {
        result: {
          numbers: official.numbers,
          special: official.special,
          multiplier: official.multiplier,
          checkedAt: new Date().toLocaleString("pt-BR"),
          premiosGanhos: computed.total,
          jackpotHit: computed.jackpotHit,
          breakdown: computed.breakdown
        }
      };
      saveLocalOverride(draw.id, override);
      if (DRAWS[currentIdx].id === draw.id) renderDraw(currentIdx);
    }).catch(function (err) {
      renderResultPending("error", "Não foi possível confirmar o resultado ainda (" + err.message + "). Ele é publicado pela loteria após o sorteio — tente novamente em instantes.");
    });
  }

  function wireResultRetry() {
    document.getElementById("pbResultRetryBtn").onclick = function () {
      renderDraw(currentIdx);
    };
  }

  function tick(draw, gt) {
    clearInterval(countdownTimer);
    function step() {
      var target = new Date(draw.drawing.drawDateIso).getTime();
      var diff = target - Date.now();
      var box = document.getElementById("pbCountdownNums");
      var statusBadge = document.getElementById("pbStatusBadge");

      if (diff <= 0) {
        box.innerHTML = '<div class="n">Sorteio realizado</div>';
        statusBadge.textContent = gt.icon + " " + gt.label.toUpperCase() + " — SORTEIO ENCERRADO";
        clearInterval(countdownTimer);
        return;
      }

      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);

      box.innerHTML =
        '<div><div class="n">' + d + '</div><div class="u">dias</div></div>' +
        '<div><div class="n">' + h + '</div><div class="u">horas</div></div>' +
        '<div><div class="n">' + m + '</div><div class="u">min</div></div>' +
        '<div><div class="n">' + s + '</div><div class="u">seg</div></div>';

      statusBadge.textContent = gt.icon + " " + gt.label.toUpperCase() + " · ATIVO — Sorteio em " + h + "h " + m + "min";
    }
    step();
    countdownTimer = setInterval(step, 1000);
  }

  function shareText(draw, gt) {
    return "🎟️ Bolão " + gt.label + " — Jackpot $" + (draw.drawing.jackpot / 1e6).toFixed(0) +
      "M\nSorteio: " + draw.drawing.drawDateLabel +
      "\nParticipantes: " + draw.participants.length +
      "\nTotal arrecadado: " + fmtUsd(draw.finance.totalArrecadado) +
      "\nGuardado p/ próximo sorteio: " + fmtUsd(draw.finance.valorGuardadoProximoSorteio) +
      "\n\nBoa sorte a todos! 🍀";
  }

  function wireShareButtons(draw, gt) {
    var url = "https://wa.me/?text=" + encodeURIComponent(shareText(draw, gt));
    document.querySelectorAll(".js-share-whatsapp").forEach(function (btn) {
      btn.href = url;
    });
  }

  function renderDraw(idx) {
    currentIdx = idx;
    var draw = getEffectiveDraw(DRAWS[idx]);
    var gt = applyTheme(draw.gameType);

    document.getElementById("pbJackpot").textContent = "$" + (draw.drawing.jackpot / 1e6).toFixed(0) + "M";
    document.getElementById("pbDrawDate").textContent = draw.drawing.drawDateLabel;

    renderSummary(draw);
    renderTable(draw);
    renderSharedTickets(draw);
    renderResult(draw, gt);
    wireResultRetry();
    tick(draw, gt);
    renderDrawSelector();
    wireShareButtons(draw, gt);
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderDrawSelector();
    renderDraw(currentIdx);

    document.getElementById("pbDrawSelect").addEventListener("change", function (e) {
      renderDraw(Number(e.target.value));
    });
  });
})();
