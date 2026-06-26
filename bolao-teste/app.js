
const DATA = window.BOLAO_DATA;
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const storeKey = "bolao2026_test_v6";
const ADMIN_PASS = "bolao2026";

function flag(name) {
  const text = String(name || "");
  return DATA.flags[text] || (text.includes("Winner") || text.includes("Loser") || text.includes("Group") || text.includes("3rd") || text.includes("TBD") ? "🔁" : "🏳️");
}

function state() {
  return JSON.parse(localStorage.getItem(storeKey) || '{"entries":[],"results":{},"paid":{}}');
}

function saveState(s) {
  localStorage.setItem(storeKey, JSON.stringify(s));
}

function phaseLabel(p) {
  const map = {
    "Round of 32": "Round of 32 / 16 avos",
    "Round of 16": "Oitavas",
    "Quarterfinal": "Quartas",
    "Semifinal": "Semifinais",
    "3rd Place": "3º lugar",
    "Final": "Final"
  };
  return map[p] || p;
}

function oppositeSide(side) {
  return side === "A" ? "B" : side === "B" ? "A" : "";
}

function getMatchByPhase(phaseName) {
  return DATA.knockoutMatches.find(m => String(m.phase).toLowerCase() === String(phaseName).toLowerCase());
}

function resolveSlotName(slot, winnersByMatch, losersByMatch = {}) {
  const text = String(slot || "");
  const win = text.match(/Winner Match (\d+)/i) || text.match(/Vencedor Match (\d+)/i);
  const loser = text.match(/Loser Match (\d+)/i) || text.match(/Perdedor Match (\d+)/i);
  if (win) return winnersByMatch[win[1]] || text;
  if (loser) return losersByMatch[loser[1]] || text;
  return text;
}

function scoreSideFromInputs(card) {
  const ga = card.querySelector(`[data-field="goalsA"]`)?.value;
  const gb = card.querySelector(`[data-field="goalsB"]`)?.value;
  if (ga === "" || gb === "") return "";
  const a = Number(ga);
  const b = Number(gb);
  if (a > b) return "A";
  if (b > a) return "B";
  return "";
}

function setSelectOptions(select, currentA, currentB, placeholder = "Selecione") {
  const previous = select.value;
  select.innerHTML = `
    <option value="">${placeholder}</option>
    <option value="A">${flag(currentA)} ${currentA}</option>
    <option value="B">${flag(currentB)} ${currentB}</option>
  `;
  if (previous === "A" || previous === "B") select.value = previous;
}

function updateAdvanceControlForCard(card) {
  const select = card.querySelector(`[data-field="advanceSide"]`);
  const help = card.querySelector("[data-advance-help]");
  if (!select) return;

  const ga = card.querySelector(`[data-field="goalsA"]`)?.value ?? "";
  const gb = card.querySelector(`[data-field="goalsB"]`)?.value ?? "";
  const currentA = card.dataset.currentA || "Time A";
  const currentB = card.dataset.currentB || "Time B";

  if (ga === "" || gb === "") {
    select.disabled = true;
    select.value = "";
    if (help) help.innerHTML = "Preencha o placar primeiro. Quem avança só será escolhido se o jogo terminar empatado.";
    return;
  }

  const autoSide = Number(ga) > Number(gb) ? "A" : Number(gb) > Number(ga) ? "B" : "";

  if (autoSide) {
    select.disabled = true;
    select.value = autoSide;
    const team = autoSide === "A" ? currentA : currentB;
    if (help) help.innerHTML = `<span class="auto-advance">Avanço automático:</span> ${flag(team)} ${team} avança porque venceu no placar informado.`;
  } else {
    select.disabled = false;
    if (select.value !== "A" && select.value !== "B") select.value = "";
    if (help) {
      const matchId = card.dataset.cardMatch;
      const match = DATA.knockoutMatches.find(x => String(x.match) === String(matchId));
      help.innerHTML = getActionHelpForPhase(match?.phase);
    }
  }
}

function updateAllAdvanceControls() {
  DATA.knockoutMatches.forEach(m => {
    const card = document.querySelector(`[data-card-match="${m.match}"]`);
    if (card) updateAdvanceControlForCard(card);
  });
}

function inferPredictedWinnersFromForm() {
  const winners = {};
  const losers = {};

  DATA.knockoutMatches.forEach(m => {
    const card = document.querySelector(`[data-card-match="${m.match}"]`);
    if (!card) return;

    const currentA = card.dataset.currentA || resolveSlotName(m.teamA, winners, losers);
    const currentB = card.dataset.currentB || resolveSlotName(m.teamB, winners, losers);
    const ga = card.querySelector(`[data-field="goalsA"]`)?.value;
    const gb = card.querySelector(`[data-field="goalsB"]`)?.value;
    const selectValue = card.querySelector(`[data-field="advanceSide"]`)?.value || "";

    let side = "";
    if (ga !== "" && gb !== "") {
      if (Number(ga) > Number(gb)) side = "A";
      else if (Number(gb) > Number(ga)) side = "B";
      else side = selectValue;
    }

    if (side === "A") {
      winners[m.match] = currentA;
      losers[m.match] = currentB;
    } else if (side === "B") {
      winners[m.match] = currentB;
      losers[m.match] = currentA;
    }
  });

  return { winners, losers };
}

function inferRealWinnersFromAdminState(s) {
  const winners = {};
  const losers = {};

  DATA.knockoutMatches.forEach(m => {
    const real = s.results[m.match];
    const currentA = resolveSlotName(m.teamA, winners, losers);
    const currentB = resolveSlotName(m.teamB, winners, losers);

    if (!real) return;

    let side = "";
    if (real.goalsA !== "" && real.goalsB !== "" && real.goalsA !== undefined && real.goalsB !== undefined) {
      if (Number(real.goalsA) > Number(real.goalsB)) side = "A";
      else if (Number(real.goalsB) > Number(real.goalsA)) side = "B";
      else side = real.advanceSide || "";
    }

    if (side === "A") {
      winners[m.match] = currentA;
      losers[m.match] = currentB;
    } else if (side === "B") {
      winners[m.match] = currentB;
      losers[m.match] = currentA;
    }
  });

  return { winners, losers };
}

function updateDynamicBracketLabels() {
  const { winners, losers } = inferPredictedWinnersFromForm();

  DATA.knockoutMatches.forEach(m => {
    const card = document.querySelector(`[data-card-match="${m.match}"]`);
    if (!card) return;

    const currentA = resolveSlotName(m.teamA, winners, losers);
    const currentB = resolveSlotName(m.teamB, winners, losers);

    card.dataset.currentA = currentA;
    card.dataset.currentB = currentB;

    const teamAEl = card.querySelector("[data-team-a-label]");
    const teamBEl = card.querySelector("[data-team-b-label]");
    const gaLabel = card.querySelector("[data-goals-a-label]");
    const gbLabel = card.querySelector("[data-goals-b-label]");
    const select = card.querySelector(`[data-field="advanceSide"]`);
    const note = card.querySelector("[data-dynamic-note]");

    if (teamAEl) teamAEl.textContent = `${flag(currentA)} ${currentA}`;
    if (teamBEl) teamBEl.textContent = `${currentB} ${flag(currentB)}`;
    if (gaLabel) gaLabel.textContent = `Gols — ${currentA}`;
    if (gbLabel) gbLabel.textContent = `Gols — ${currentB}`;

    if (select) setSelectOptions(select, currentA, currentB, "Selecione");

    if (note && (currentA !== m.teamA || currentB !== m.teamB)) {
      note.innerHTML = `Sua previsão atual para este jogo: <span class="team-chip">${flag(currentA)} ${currentA}</span> x <span class="team-chip">${flag(currentB)} ${currentB}</span>. O palpite vale para a <b>posição do bracket</b>. Se outro time avançar na vida real, ele herda esta vaga.`;
    } else if (note) {
      note.innerHTML = "Placar válido: <b>90 minutos + prorrogação</b>. Pênaltis não contam no placar.";
    }
  });

  updateAllAdvanceControls();
}

function setupAdminLogin() {
  const btn = document.getElementById("adminLoginBtn");
  if (!btn) return;

  if (sessionStorage.getItem("bolaoAdminOk") === "true") {
    document.getElementById("adminLogin").style.display = "none";
    document.getElementById("adminArea").style.display = "block";
  }

  btn.addEventListener("click", () => {
    const pass = document.getElementById("adminPassword").value;
    if (pass === ADMIN_PASS) {
      sessionStorage.setItem("bolaoAdminOk", "true");
      document.getElementById("adminLogin").style.display = "none";
      document.getElementById("adminArea").style.display = "block";
    } else {
      alert("Senha incorreta.");
    }
  });
}


function getActionLabelForPhase(phase) {
  const p = String(phase || "").toLowerCase();
  if (p === "final" || p === "3rd place") return "Quem ganha?";
  return "Quem avança?";
}

function getActionHelpForPhase(phase) {
  const p = String(phase || "").toLowerCase();
  if (p === "final") return "Se a final empatar no placar informado, escolha quem será campeão.";
  if (p === "3rd place") return "Se a disputa de 3º lugar empatar no placar informado, escolha quem fica em 3º.";
  return "O placar está empatado. Escolha quem avança. Pênaltis não entram no placar.";
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function receiptCode(entry) {
  const raw = JSON.stringify({entryName: entry.entryName, payerName: entry.payerName, createdAt: entry.createdAt, picks: entry.picks});
  return `BOLAO-${hashString(raw)}-${entry.createdAt.slice(0,10).replaceAll("-","")}`;
}

function buildReceiptHtml(entry) {
  const code = receiptCode(entry);
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks[m.match];
    if (!p) return "";
    const winner = p.advanceSide === "A" ? p.displayA : p.displayB;
    return `<tr><td>Match ${m.match}</td><td>${p.displayA}</td><td>${p.goalsA} x ${p.goalsB}</td><td>${p.displayB}</td><td>${winner}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprovante - ${entry.entryName}</title>
<style>
body{font-family:Arial,sans-serif;margin:24px;color:#111}
h1{margin-bottom:4px}
.meta{background:#f2f4f7;padding:14px;border-radius:12px;margin:14px 0}
.code{font-family:monospace;font-weight:bold}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}
@media print{button{display:none}}
</style>
</head>
<body>
<button onclick="window.print()">Imprimir / salvar PDF</button>
<h1>Comprovante do Bolão Copa 2026</h1>
<p>Este comprovante registra os palpites enviados nesta entrada.</p>
<div class="meta">
<p><b>Entrada:</b> ${entry.entryName}</p>
<p><b>Responsável:</b> ${entry.payerName}</p>
<p><b>Pagamento:</b> ${entry.paymentMethod || "Não informado"} ${entry.paymentTo ? "— " + entry.paymentTo : ""}</p>
<p><b>Enviado em:</b> ${new Date(entry.createdAt).toLocaleString("pt-BR")}</p>
<p><b>Código de autenticação:</b> <span class="code">${code}</span></p>
</div>
<table>
<thead><tr><th>Jogo</th><th>Time/posição A</th><th>Placar</th><th>Time/posição B</th><th>Ganha/avança</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="margin-top:20px;font-size:12px;color:#666">Placar válido: 90 minutos + prorrogação. Pênaltis não entram no placar.</p>
</body>
</html>`;
}

function downloadReceipt(entryId) {
  const s = state();
  const entry = s.entries.find(e => e.id === entryId);
  if (!entry) return alert("Entrada não encontrada.");
  const html = buildReceiptHtml(entry);
  const blob = new Blob([html], {type:"text/html;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comprovante-${entry.entryName.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-${receiptCode(entry)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openReceipt(entryId) {
  const s = state();
  const entry = s.entries.find(e => e.id === entryId);
  if (!entry) return alert("Entrada não encontrada.");
  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(buildReceiptHtml(entry));
  w.document.close();
}

function teamStrength(name) {
  const text = String(name || "");
  if (DATA.strength && DATA.strength[text]) return DATA.strength[text];
  if (text.includes("Winner") || text.includes("Loser") || text.includes("TBD") || text.includes("Group")) return 65;
  return 65;
}

function predictedScoreFor(currentA, currentB, mode) {
  if (mode === "random") {
    const ga = Math.floor(Math.random() * 4);
    const gb = Math.floor(Math.random() * 4);
    return [ga, gb];
  }
  const sa = teamStrength(currentA);
  const sb = teamStrength(currentB);
  const diff = sa - sb;
  let ga = 1, gb = 1;
  if (diff >= 12) [ga, gb] = [3, 0];
  else if (diff >= 6) [ga, gb] = [2, 0];
  else if (diff >= 2) [ga, gb] = [2, 1];
  else if (diff <= -12) [ga, gb] = [0, 3];
  else if (diff <= -6) [ga, gb] = [0, 2];
  else if (diff <= -2) [ga, gb] = [1, 2];
  else [ga, gb] = Math.random() > 0.5 ? [1, 1] : [2, 2];
  return [ga, gb];
}

function autoFillPicks(mode = "smart") {
  if (!confirm(mode === "smart" ? "Preencher automaticamente baseado em força estimada dos times? Você ainda pode revisar." : "Preencher aleatoriamente? Você ainda pode revisar.")) return;

  DATA.knockoutMatches.forEach(m => {
    updateDynamicBracketLabels();
    const card = document.querySelector(`[data-card-match="${m.match}"]`);
    if (!card) return;
    const currentA = card.dataset.currentA || m.teamA;
    const currentB = card.dataset.currentB || m.teamB;
    let [ga, gb] = predictedScoreFor(currentA, currentB, mode);

    // Avoid too many ties in lazy mode; if tie, pick side by strength but keep the tie possible sometimes.
    const gaEl = card.querySelector(`[data-field="goalsA"]`);
    const gbEl = card.querySelector(`[data-field="goalsB"]`);
    const select = card.querySelector(`[data-field="advanceSide"]`);
    gaEl.value = ga;
    gbEl.value = gb;
    updateDynamicBracketLabels();

    if (ga === gb && select) {
      const sa = teamStrength(card.dataset.currentA);
      const sb = teamStrength(card.dataset.currentB);
      select.value = mode === "random" ? (Math.random() > 0.5 ? "A" : "B") : (sa >= sb ? "A" : "B");
      updateDynamicBracketLabels();
    }
  });
}


const PAYMENT_INFO = {
  CashApp: "$emferrari",
  Zelle: "914-406-5027",
  PayPal: "emferrari@gmail.com",
  Venmo: "Eduardo-Ferrari"
};

function updatePaymentBox() {
  const method = $("#paymentMethod")?.value || "";
  const box = $("#paymentBox");
  if (!box) return;

  if (!method) {
    box.innerHTML = `<b>Pagamento</b><p>Selecione o método de pagamento para ver os dados.</p>`;
    return;
  }

  const value = PAYMENT_INFO[method];
  box.innerHTML = `
    <b>Pagamento via ${method}</b>
    <p>Envie <b>US$ 5 por entrada</b> para:</p>
    <div class="copy-line">
      <span class="copy-value">${value}</span>
      <button type="button" class="small-btn secondary" onclick="copyPaymentInfo('${method}')">Copiar</button>
    </div>
    <p class="hidden-note">Depois do envio, o pagamento ainda precisa ser confirmado pelo admin.</p>
  `;
}

function copyPaymentInfo(method) {
  const value = PAYMENT_INFO[method];
  navigator.clipboard?.writeText(value).then(() => {
    alert(`${method} copiado: ${value}`);
  }).catch(() => {
    prompt("Copie o valor:", value);
  });
}

function renderBracketForm() {
  const form = $("#bracketForm");
  form.innerHTML = "";
  let currentPhase = "";

  DATA.knockoutMatches.forEach(m => {
    if (m.phase !== currentPhase) {
      currentPhase = m.phase;
      const header = document.createElement("div");
      header.className = "card";
      header.innerHTML = `<h2>${phaseLabel(currentPhase)}</h2><p class="muted">Preencha o placar considerando 90 minutos + prorrogação. Se o placar empatar, escolha quem avança. Pênaltis não entram no placar.</p>`;
      form.appendChild(header);
    }

    const card = document.createElement("div");
    card.className = "match-card";
    card.dataset.cardMatch = m.match;
    card.dataset.currentA = m.teamA;
    card.dataset.currentB = m.teamB;

    card.innerHTML = `
      <div class="match-head">
        <span class="match-badge">Match ${m.match}</span>
        <span class="phase">${m.date || ""}</span>
      </div>
      <div class="teams">
        <div class="team" data-team-a-label>${flag(m.teamA)} ${m.teamA}</div>
        <div class="vs">x</div>
        <div class="team right" data-team-b-label>${m.teamB} ${flag(m.teamB)}</div>
      </div>
      <p class="dynamic-note" data-dynamic-note>Placar válido: <b>90 minutos + prorrogação</b>. Pênaltis não contam no placar.</p>
      <div class="score-inputs">
        <label><span data-goals-a-label>Gols — ${m.teamA}</span><input type="number" min="0" step="1" data-match="${m.match}" data-field="goalsA" placeholder="0"></label>
        <label><span data-goals-b-label>Gols — ${m.teamB}</span><input type="number" min="0" step="1" data-match="${m.match}" data-field="goalsB" placeholder="0"></label>
      </div>
      <label style="margin-top:10px">${getActionLabelForPhase(m.phase)} <span class="muted">(só se empatar)</span>
        <select data-match="${m.match}" data-field="advanceSide" disabled>
          <option value="">Preencha o placar primeiro</option>
          <option value="A">${flag(m.teamA)} ${m.teamA}</option>
          <option value="B">${flag(m.teamB)} ${m.teamB}</option>
        </select>
      </label>
      <div class="advance-help" data-advance-help>Preencha o placar primeiro. Quem avança só será escolhido se o jogo terminar empatado.</div>
    `;
    form.appendChild(card);
  });

  $$("[data-match]").forEach(el => {
    el.addEventListener("input", updateDynamicBracketLabels);
    el.addEventListener("change", updateDynamicBracketLabels);
  });

  updateDynamicBracketLabels();
}

function readEntryFromForm() {
  updateDynamicBracketLabels();

  const entryName = $("#entryName").value.trim();
  const payerName = $("#payerName").value.trim();
  const paymentMethod = $("#paymentMethod")?.value || "";

  if (!entryName || !payerName) {
    alert("Preencha Nome da Entrada e Responsável pelo Pagamento.");
    return null;
  }

  if (!paymentMethod) {
    alert("Selecione o método de pagamento.");
    return null;
  }

  const picks = {};

  for (const m of DATA.knockoutMatches) {
    const card = document.querySelector(`[data-card-match="${m.match}"]`);
    const ga = card.querySelector(`[data-field="goalsA"]`).value;
    const gb = card.querySelector(`[data-field="goalsB"]`).value;
    const selectSide = card.querySelector(`[data-field="advanceSide"]`).value;

    if (ga === "" || gb === "") {
      alert(`Faltou preencher o placar do Match ${m.match}.`);
      return null;
    }

    let finalAdvanceSide = "";
    if (Number(ga) > Number(gb)) finalAdvanceSide = "A";
    else if (Number(gb) > Number(ga)) finalAdvanceSide = "B";
    else finalAdvanceSide = selectSide;

    if (!finalAdvanceSide) {
      alert(`O Match ${m.match} está empatado. Escolha quem avança.`);
      return null;
    }

    picks[m.match] = {
      goalsA: Number(ga),
      goalsB: Number(gb),
      advanceSide: finalAdvanceSide,
      displayA: card.dataset.currentA,
      displayB: card.dataset.currentB
    };
  }

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    entryName,
    payerName,
    paymentMethod,
    paymentTo: PAYMENT_INFO[paymentMethod],
    createdAt: new Date().toISOString(),
    picks
  };
}

function getPickFinalPlacements(entry) {
  const finalMatch = getMatchByPhase("Final");
  const thirdMatch = getMatchByPhase("3rd Place");
  if (!finalMatch || !thirdMatch) return null;

  const finalPick = entry.picks[finalMatch.match];
  const thirdPick = entry.picks[thirdMatch.match];
  if (!finalPick || !thirdPick || !finalPick.advanceSide || !thirdPick.advanceSide) return null;

  return {
    championSide: finalPick.advanceSide,
    runnerUpSide: oppositeSide(finalPick.advanceSide),
    thirdSide: thirdPick.advanceSide,
    fourthSide: oppositeSide(thirdPick.advanceSide),
    finalMatch: finalMatch.match,
    thirdMatch: thirdMatch.match
  };
}

function getRealFinalPlacements(s) {
  const finalMatch = getMatchByPhase("Final");
  const thirdMatch = getMatchByPhase("3rd Place");
  if (!finalMatch || !thirdMatch) return null;

  const finalReal = s.results[finalMatch.match];
  const thirdReal = s.results[thirdMatch.match];
  if (!finalReal || !thirdReal) return null;

  let finalSide = "";
  if (finalReal.goalsA !== "" && finalReal.goalsB !== "" && finalReal.goalsA !== undefined && finalReal.goalsB !== undefined) {
    if (Number(finalReal.goalsA) > Number(finalReal.goalsB)) finalSide = "A";
    else if (Number(finalReal.goalsB) > Number(finalReal.goalsA)) finalSide = "B";
    else finalSide = finalReal.advanceSide || "";
  }

  let thirdSide = "";
  if (thirdReal.goalsA !== "" && thirdReal.goalsB !== "" && thirdReal.goalsA !== undefined && thirdReal.goalsB !== undefined) {
    if (Number(thirdReal.goalsA) > Number(thirdReal.goalsB)) thirdSide = "A";
    else if (Number(thirdReal.goalsB) > Number(thirdReal.goalsA)) thirdSide = "B";
    else thirdSide = thirdReal.advanceSide || "";
  }

  if (!finalSide || !thirdSide) return null;

  return {
    championSide: finalSide,
    runnerUpSide: oppositeSide(finalSide),
    thirdSide,
    fourthSide: oppositeSide(thirdSide),
    finalMatch: finalMatch.match,
    thirdMatch: thirdMatch.match
  };
}

function calculateBonus(entry, s) {
  const pick = getPickFinalPlacements(entry);
  const real = getRealFinalPlacements(s);
  const bonusCfg = DATA.bonus || { champion: 25, runnerUp: 15, third: 10, fourth: 5 };

  if (!pick || !real) {
    return { total: 0, champion: 0, runnerUp: 0, third: 0, fourth: 0 };
  }

  const result = {
    champion: pick.championSide === real.championSide ? bonusCfg.champion : 0,
    runnerUp: pick.runnerUpSide === real.runnerUpSide ? bonusCfg.runnerUp : 0,
    third: pick.thirdSide === real.thirdSide ? bonusCfg.third : 0,
    fourth: pick.fourthSide === real.fourthSide ? bonusCfg.fourth : 0
  };
  result.total = result.champion + result.runnerUp + result.third + result.fourth;
  return result;
}

function scoreEntry(entry, s) {
  let total = 0;
  const detail = {};

  DATA.knockoutMatches.forEach(m => {
    const real = s.results[m.match];
    const pick = entry.picks[m.match];

    if (!real || !pick || real.goalsA === "" || real.goalsB === "" || real.goalsA === undefined || real.goalsB === undefined) {
      detail[m.match] = null;
      return;
    }

    let realAdvanceSide = "";
    if (Number(real.goalsA) > Number(real.goalsB)) realAdvanceSide = "A";
    else if (Number(real.goalsB) > Number(real.goalsA)) realAdvanceSide = "B";
    else realAdvanceSide = real.advanceSide || "";

    if (!realAdvanceSide) {
      detail[m.match] = null;
      return;
    }

    let pts = 0;

    if (Number(pick.goalsA) === Number(real.goalsA) && Number(pick.goalsB) === Number(real.goalsB)) {
      pts += DATA.rules.exactScore;
    } else {
      if (Number(pick.goalsA) === Number(real.goalsA)) pts += DATA.rules.oneTeamGoals;
      if (Number(pick.goalsB) === Number(real.goalsB)) pts += DATA.rules.oneTeamGoals;
    }

    if (pick.advanceSide === realAdvanceSide) pts += DATA.rules.advance;

    total += pts;
    detail[m.match] = pts;
  });

  const bonus = calculateBonus(entry, s);
  total += bonus.total;

  return { total, detail, bonus };
}

function renderRanking() {
  const s = state();
  const ranked = s.entries
    .map(e => {
      const scored = scoreEntry(e, s);
      return { ...e, paid: !!s.paid[e.id], score: scored.total, bonus: scored.bonus };
    })
    .sort((a, b) => b.score - a.score);

  const paidCount = ranked.filter(r => r.paid).length;
  $("#potValue").textContent = `$${paidCount * DATA.entryFee}`;

  const list = $("#rankingList");
  list.innerHTML = ranked.length ? "" : `<div class="card"><p class="muted">Nenhuma entrada ainda. Use “Criar 3 entradas demo” no Admin para testar.</p></div>`;

  ranked.forEach((r, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
    const div = document.createElement("div");
    div.className = "rank-row";
    div.innerHTML = `
      <div class="medal">${medal}</div>
      <div><b>${r.entryName}</b><br><span class="muted">${r.payerName}${r.paymentMethod ? " • " + r.paymentMethod : ""}${r.bonus?.total ? " • bônus finais +" + r.bonus.total : ""}</span><br><span class="receipt-code">${receiptCode(r)}</span></div>
      <div class="points">${r.score}</div>
      <div class="status">${r.paid ? "Pago" : "Pendente"}</div>
    `;
    list.appendChild(div);
  });

  const receipts = $("#receiptsList");
  if (receipts) {
    receipts.innerHTML = `<h2>Comprovantes</h2><p class="muted">Abra ou baixe o comprovante HTML da entrada. No navegador, dá para imprimir ou salvar como PDF.</p>`;
    ranked.forEach(r => {
      const div = document.createElement("div");
      div.className = "match-card";
      div.innerHTML = `<b>${r.entryName}</b><br><span class="receipt-code">${receiptCode(r)}</span><div class="receipt-actions"><button class="small-btn secondary" onclick="openReceipt('${r.id}')">Abrir comprovante</button><button class="small-btn secondary" onclick="downloadReceipt('${r.id}')">Baixar HTML</button></div>`;
      receipts.appendChild(div);
    });
  }
}

function renderAdmin() {
  const s = state();
  const { winners, losers } = inferRealWinnersFromAdminState(s);

  const pay = $("#paymentsAdmin");
  pay.innerHTML = `<h2>Pagamentos</h2>`;

  if (!s.entries.length) {
    pay.innerHTML += `<p class="muted">Sem entradas.</p>`;
  }

  s.entries.forEach(e => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <div class="medal">💵</div>
      <div><b>${e.entryName}</b><br><span class="muted">${e.payerName}${e.paymentMethod ? " • " + e.paymentMethod + " → " + (e.paymentTo || "") : ""}</span></div>
      <label><input type="checkbox" data-paid="${e.id}" ${s.paid[e.id] ? "checked" : ""}> Pago</label>
    `;
    pay.appendChild(row);
  });

  $$("[data-paid]").forEach(cb => cb.addEventListener("change", e => {
    const st = state();
    st.paid[e.target.dataset.paid] = e.target.checked;
    saveState(st);
    renderAll();
  }));

  const res = $("#resultsAdmin");
  res.innerHTML = `<h2>Resultados reais</h2><p class="muted">Lance o placar real considerando 90 minutos + prorrogação. Pênaltis não entram no placar. Se empatar, selecione quem avançou nos pênaltis. Nas fases futuras, os times mudam conforme resultados reais anteriores.</p>`;

  DATA.knockoutMatches.forEach(m => {
    const real = s.results[m.match] || {};
    const currentA = resolveSlotName(m.teamA, winners, losers);
    const currentB = resolveSlotName(m.teamB, winners, losers);

    const card = document.createElement("div");
    card.className = "match-card";
    card.innerHTML = `
      <div class="match-head">
        <span class="match-badge">Match ${m.match}</span>
        <span class="phase">${phaseLabel(m.phase)}</span>
      </div>
      <div class="teams">
        <div class="team">${flag(currentA)} ${currentA}</div>
        <div class="vs">x</div>
        <div class="team right">${currentB} ${flag(currentB)}</div>
      </div>
      <div class="score-inputs">
        <label>Real ${currentA}<input type="number" min="0" data-real-match="${m.match}" data-real-field="goalsA" value="${real.goalsA ?? ""}"></label>
        <label>Real ${currentB}<input type="number" min="0" data-real-match="${m.match}" data-real-field="goalsB" value="${real.goalsB ?? ""}"></label>
      </div>
      <label style="margin-top:10px">${getActionLabelForPhase(m.phase).replace("?", " real?")} <span class="muted">(necessário se empatar)</span>
        <select data-real-match="${m.match}" data-real-field="advanceSide">
          <option value="">Selecione</option>
          <option value="A" ${real.advanceSide === "A" ? "selected" : ""}>${flag(currentA)} ${currentA}</option>
          <option value="B" ${real.advanceSide === "B" ? "selected" : ""}>${flag(currentB)} ${currentB}</option>
        </select>
      </label>
    `;
    res.appendChild(card);
  });

  $$("[data-real-match]").forEach(el => el.addEventListener("change", e => {
    const st = state();
    const match = e.target.dataset.realMatch;
    const field = e.target.dataset.realField;
    st.results[match] = st.results[match] || {};
    st.results[match][field] = field.startsWith("goals")
      ? (e.target.value === "" ? "" : Number(e.target.value))
      : e.target.value;
    saveState(st);
    renderAll();
  }));
}

function renderGames() {
  $("#updatedLabel").textContent = DATA.updatedLabel;
  const list = $("#gamesList");
  list.innerHTML = "";

  const known = DATA.groupMatches.concat(DATA.knockoutMatches);
  known.forEach(m => {
    const div = document.createElement("div");
    div.className = "match-card";
    const score = m.goalsA !== null && m.goalsB !== null ? `${m.goalsA} x ${m.goalsB}` : "—";
    div.innerHTML = `
      <div class="match-head">
        <span class="match-badge">${String(m.match).startsWith("GS") ? m.match : "Match " + m.match}</span>
        <span class="phase">${m.phase} ${m.group ? "• Grupo " + m.group : ""} • ${m.status}</span>
      </div>
      <div class="teams">
        <div class="team">${flag(m.teamA)} ${m.teamA}</div>
        <div class="vs">${score}</div>
        <div class="team right">${m.teamB} ${flag(m.teamB)}</div>
      </div>
    `;
    list.appendChild(div);
  });
}

function renderAll() {
  renderRanking();
  renderAdmin();
  renderGames();
}

function loadDemo() {
  const s = state();

  if (s.entries.length && !confirm("Já existem entradas. Adicionar demos mesmo assim?")) return;

  const names = [["Eduardo #1", "Eduardo"], ["Gabriel", "Eduardo"], ["Nicole", "Eduardo"]];

  names.forEach((n, idx) => {
    const picks = {};
    DATA.knockoutMatches.forEach((m, j) => {
      const ga = (idx + j) % 4;
      const gb = (idx + j + 1) % 3;
      let side = ga > gb ? "A" : gb > ga ? "B" : (idx % 2 === 0 ? "A" : "B");
      picks[m.match] = {
        goalsA: ga,
        goalsB: gb,
        advanceSide: side,
        displayA: m.teamA,
        displayB: m.teamB
      };
    });

    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    const methods = ["CashApp","Zelle","Venmo"];
    const method = methods[idx % methods.length];
    s.entries.push({ id, entryName: n[0], payerName: n[1], paymentMethod: method, paymentTo: PAYMENT_INFO[method], createdAt: new Date().toISOString(), picks });
    s.paid[id] = idx !== 2;
  });

  s.results["73"] = { goalsA: 1, goalsB: 0 };
  s.results["74"] = { goalsA: 2, goalsB: 1 };

  saveState(s);
  renderAll();
  alert("Entradas demo criadas.");
}

function clearAll() {
  if (confirm("Limpar todos os dados de teste deste navegador?")) {
    localStorage.removeItem(storeKey);
    renderAll();
  }
}

function initTabs() {
  $$("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    $$(".panel").forEach(p => p.classList.toggle("active", p.id === tab));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  setupAdminLogin();
  renderBracketForm();
  renderAll();

  $("#saveEntry").addEventListener("click", e => {
    e.preventDefault();

    const entry = readEntryFromForm();
    if (!entry) return;

    const s = state();
    s.entries.push(entry);
    s.paid[entry.id] = false;
    saveState(s);

    alert("Entrada de teste salva. Vá em Ranking ou Admin para ver.");
    $("#entryName").value = "";
    $("#payerName").value = "";
    if ($("#paymentMethod")) $("#paymentMethod").value = "";
    updatePaymentBox();
    $("#bracketForm").reset();
    updateDynamicBracketLabels();
    renderAll();
  });

  $("#loadDemo").addEventListener("click", loadDemo);
  $("#clearAll").addEventListener("click", clearAll);
  const paymentMethod = $("#paymentMethod");
  if (paymentMethod) paymentMethod.addEventListener("change", updatePaymentBox);
  updatePaymentBox();
  const smart = $("#smartPick");
  const random = $("#randomPick");
  if (smart) smart.addEventListener("click", () => autoFillPicks("smart"));
  if (random) random.addEventListener("click", () => autoFillPicks("random"));
});
