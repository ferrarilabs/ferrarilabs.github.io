(function () {
  "use strict";
  var D = window.POWERBALL_DATA;

  function fmtUsd(n) {
    return "US$" + n.toLocaleString("en-US");
  }

  function renderSummary() {
    var totalCotas = D.participants.reduce(function (s, p) { return s + p.cotas; }, 0);
    var el = document.getElementById("pbSummary");
    el.innerHTML = [
      [fmtUsd(D.finance.totalArrecadado), "Total arrecadado"],
      [totalCotas, "Cotas (US$20 cada)"],
      [D.participants.length, "Participantes"],
      [fmtUsd(D.finance.valorUtilizado), "Valor utilizado (tickets)"],
      [fmtUsd(D.finance.valorGuardadoProximoSorteio), "Guardado p/ próximo sorteio"],
      ["$" + (D.drawing.jackpot / 1e6).toFixed(0) + "M", "Jackpot"]
    ].map(function (row) {
      return '<div class="pb-summary-item"><div class="v">' + row[0] + '</div><div class="l">' + row[1] + "</div></div>";
    }).join("");
  }

  function renderTable() {
    var tbody = document.getElementById("pbParticipantsBody");
    tbody.innerHTML = D.participants.map(function (p) {
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

  function renderSharedTickets() {
    var t = D.sharedTickets;
    document.getElementById("pbTicketsMeta").textContent =
      "Comprado por " + t.compradoPor + " · " + t.dataComprovante + " · US$" + t.valorPorTicket + "/ticket (Power Play)";

    document.getElementById("pbTicketsBody").innerHTML = t.series.map(function (s) {
      var numsHtml = s.numeros && s.numeros.length
        ? "<ul>" + s.numeros.map(function (n, i) { return "<li>Ticket " + (i + 1) + ": " + n + "</li>"; }).join("") +
          (s.qtd > s.numeros.length ? '<li class="pb-pending">+ ' + (s.qtd - s.numeros.length) + " ticket(s) desse serial ainda não cadastrado(s)</li>" : "") +
          "</ul>"
        : '<div class="pb-pending">Números individuais deste serial ainda não cadastrados.</div>';
      return '<div class="pb-ticket-block">' +
        '<div class="serial">Serial: ' + s.serial + '</div>' +
        '<div class="qtd">' + s.qtd + " ticket(s)</div>" +
        numsHtml +
        "</div>";
    }).join("");
  }

  function tick() {
    var target = new Date(D.drawing.drawDateIso).getTime();
    var now = Date.now();
    var diff = target - now;
    var box = document.getElementById("pbCountdownNums");
    var statusBadge = document.getElementById("pbStatusBadge");

    if (diff <= 0) {
      box.innerHTML = '<div class="n">Sorteio realizado</div>';
      statusBadge.textContent = "SORTEIO ENCERRADO";
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

    statusBadge.textContent = "ATIVO — Sorteio em " + h + "h " + m + "min";
  }

  function shareWhatsapp() {
    var text = "🔴 Bolão Powerball — Jackpot $" + (D.drawing.jackpot / 1e6).toFixed(0) +
      "M\nSorteio: " + D.drawing.drawDateLabel +
      "\nParticipantes: " + D.participants.length +
      "\nTotal arrecadado: " + fmtUsd(D.finance.totalArrecadado) +
      "\nGuardado p/ próximo sorteio: " + fmtUsd(D.finance.valorGuardadoProximoSorteio) +
      "\n\nBoa sorte a todos! 🍀";
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("pbJackpot").textContent = "$" + (D.drawing.jackpot / 1e6).toFixed(0) + "M";
    document.getElementById("pbDrawDate").textContent = D.drawing.drawDateLabel;

    renderSummary();
    renderTable();
    renderSharedTickets();
    tick();
    setInterval(tick, 1000);

    document.getElementById("pbShareBtn").addEventListener("click", shareWhatsapp);
  });
})();
