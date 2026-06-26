
const DATA = window.BOLAO_DATA;
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const storeKey = "bolao2026_test_v6";
const CONFIG = window.BOLAO_CONFIG || {};
const ADMIN_PASS_HASH = CONFIG.adminPasswordHash || "b4d9fbb1663d6f71b81a50734bb768558944bf7d2139e4eef5715c3971d25505";
const ADMIN_LOCK_KEY = "bolaoAdminLockUntil";
const ADMIN_ATTEMPTS_KEY = "bolaoAdminAttempts";


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getAdminLockUntil() {
  return Number(localStorage.getItem(ADMIN_LOCK_KEY) || "0");
}

function isAdminLocked() {
  return Date.now() < getAdminLockUntil();
}

function recordFailedAdminAttempt() {
  const attempts = Number(localStorage.getItem(ADMIN_ATTEMPTS_KEY) || "0") + 1;
  localStorage.setItem(ADMIN_ATTEMPTS_KEY, String(attempts));
  const max = CONFIG.adminMaxAttempts || 5;
  if (attempts >= max) {
    const minutes = CONFIG.adminLockMinutes || 15;
    localStorage.setItem(ADMIN_LOCK_KEY, String(Date.now() + minutes * 60 * 1000));
    localStorage.setItem(ADMIN_ATTEMPTS_KEY, "0");
  }
}

function clearAdminAttempts() {
  localStorage.removeItem(ADMIN_ATTEMPTS_KEY);
  localStorage.removeItem(ADMIN_LOCK_KEY);
}


let currentLang = localStorage.getItem("bolaoLang") || "pt-BR";

function t(key) {
  return (window.BOLAO_I18N && window.BOLAO_I18N[currentLang] && window.BOLAO_I18N[currentLang][key]) ||
         (window.BOLAO_I18N && window.BOLAO_I18N["pt-BR"] && window.BOLAO_I18N["pt-BR"][key]) ||
         key;
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  const sel = $("#languageSelect");
  if (sel) sel.value = currentLang;
}

function setupLanguageSwitcher() {
  const sel = $("#languageSelect");
  if (!sel) return;
  sel.value = currentLang;
  sel.addEventListener("change", () => {
    currentLang = sel.value;
    localStorage.setItem("bolaoLang", currentLang);
    applyLanguage();
  });
}



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

  btn.addEventListener("click", async () => {
    if (isAdminLocked()) {
      const waitMin = Math.ceil((getAdminLockUntil() - Date.now()) / 60000);
      alert(`Admin bloqueado temporariamente. Tente novamente em ${waitMin} minuto(s).`);
      return;
    }

    const pass = document.getElementById("adminPassword").value;
    const hash = await sha256Hex(pass);

    if (hash === ADMIN_PASS_HASH) {
      clearAdminAttempts();
      sessionStorage.setItem("bolaoAdminOk", "true");
      document.getElementById("adminLogin").style.display = "none";
      document.getElementById("adminArea").style.display = "block";
    } else {
      recordFailedAdminAttempt();
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
  const resolved = resolvedTeamsForEntry(entry);
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks[m.match];
    if (!p) return "";
    const r = resolved[m.match] || { displayA: p.displayA, displayB: p.displayB };
    const winner = p.advanceSide === "A" ? r.displayA : r.displayB;
    return `<tr><td>Match ${m.match}</td><td>${escapeHtml(r.displayA)}</td><td>${p.goalsA} x ${p.goalsB}</td><td>${escapeHtml(r.displayB)}</td><td>${escapeHtml(winner)}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprovante - ${escapeHtml(entry.entryName)}</title>
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
<p><b>Entrada:</b> ${escapeHtml(entry.entryName)}</p>
<p><b>Responsável:</b> ${escapeHtml(entry.payerName)}</p>
${entry.participantEmail ? `<p><b>E-mail:</b> ${escapeHtml(entry.participantEmail)}</p>` : ""}
<p><b>Pagamento:</b> ${escapeHtml(entry.paymentMethod || "Não informado")} ${escapeHtml(entry.paymentTo ? "— " + entry.paymentTo : "")}</p>
<p><b>Enviado em:</b> ${new Date(entry.createdAt).toLocaleString("pt-BR")}</p>
<p><b>Código de autenticação:</b> <span class="code">${code}</span></p>
</div>
<table>
<thead><tr><th>Jogo</th><th>Time escolhido A</th><th>Placar</th><th>Time escolhido B</th><th>Ganha/avança</th></tr></thead>
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
  const disclaimer = CONFIG.simulationDisclaimer || "Simulação é apenas entretenimento e pode estar errada.";
  if (!confirm((mode === "smart" ? "Preencher automaticamente baseado em força estimada dos times? " : "Preencher aleatoriamente? ") + "\n\n" + disclaimer + "\n\nVocê ainda pode revisar antes de salvar.")) return;

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


const PAYMENT_INFO = CONFIG.paymentMethods || { CashApp: "$emferrari", Zelle: "914-406-5027", PayPal: "emferrari@gmail.com", Venmo: "Eduardo-Ferrari" };

function updatePaymentBox() {
  const method = $("#paymentMethod")?.value || "";
  const box = $("#paymentBox");
  if (!box) return;

  if (!method) {
    box.innerHTML = `<b>Pagamento</b><p>Selecione o método de pagamento para ver os dados.</p>`;
    return;
  }

  const value = PAYMENT_INFO[method];
  const link = paymentLink(method);
  const openButton = link
    ? `<a class="small-btn pay-button" href="${link}" target="_blank" rel="noopener">Abrir ${method}</a>`
    : "";

  box.innerHTML = `
    <b>Pagamento via ${method}</b>
    <p>Envie <b>US$ 5 por entrada</b> para:</p>
    <div class="copy-line">
      <span class="copy-value">${value}</span>
      ${openButton}
      <button type="button" class="small-btn secondary" onclick="copyPaymentInfo('${method}')">Copiar</button>
    </div>
    ${method === "PayPal" ? `<p class="hidden-note">Use Friends & Family quando pagar via PayPal.</p>` : ""}
    ${method === "Zelle" ? `<p class="hidden-note">Zelle normalmente deve ser pago pelo app do banco. Use copiar ou o QR Code do seu banco.</p>` : ""}
    <p class="hidden-note">Depois do envio, o pagamento ainda precisa ser confirmado pelo admin.</p>
  `;
}

function copyText(value) {
  navigator.clipboard?.writeText(value).then(() => {
    alert("Copiado!");
  }).catch(() => {
    prompt("Copie:", value);
  });
}

function copyPaymentInfo(method) {
  const value = PAYMENT_INFO[method];
  copyText(value);
}

function paymentLink(method) {
  return (CONFIG.paymentLinks && CONFIG.paymentLinks[method]) ? CONFIG.paymentLinks[method] : "";
}


function getCutoffDate() {
  return new Date(CONFIG.cutoffIso || "2026-06-28T14:00:00-04:00");
}

function isPastCutoff() {
  return new Date() >= getCutoffDate();
}

function updateCountdown() {
  const cutoff = getCutoffDate();
  const now = new Date();
  const diff = cutoff - now;
  const box = document.querySelector(".countdown");
  const label = $("#cutoffLabel");
  if (label) label.textContent = `Cutoff oficial: ${CONFIG.cutoffLabel || "1 hora antes do primeiro jogo do mata-mata"}`;

  if (!box) return;
  if (diff <= 0) {
    box.innerHTML = `<b>0</b><small>dias</small><b>0</b><small>hrs</small><b>0</b><small>min</small>`;
    return;
  }

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  box.innerHTML = `<b>${days}</b><small>dias</small><b>${hours}</b><small>hrs</small><b>${minutes}</b><small>min</small>`;
}

function lockFormIfCutoff() {
  if (!isPastCutoff()) return;
  const entryPanel = $("#entry");
  if (!entryPanel || entryPanel.querySelector(".locked-banner")) return;

  const banner = document.createElement("div");
  banner.className = "locked-banner";
  banner.innerHTML = `<b>Inscrições encerradas.</b><br>O prazo terminou ${CONFIG.cutoffLabel || "1 hora antes do primeiro jogo do mata-mata"}.`;
  const form = $("#bracketForm");
  entryPanel.insertBefore(banner, form);

  entryPanel.querySelectorAll("input, select, button").forEach(el => {
    if (el.closest(".topbar")) return;
    if (el.id === "adminPassword") return;
    el.disabled = true;
  });
}

function renderSimulationDisclaimer() {
  const box = $("#simulationDisclaimer");
  if (!box) return;
  box.innerHTML = `<b>Aviso sobre simulação:</b> ${CONFIG.simulationDisclaimer || "A simulação é apenas entretenimento e pode estar errada."}<br><span class="muted">Fonte/configuração: ${CONFIG.simulationSource || "modelo local"}</span>`;
}

function resolvedTeamsForEntry(entry) {
  const winners = {};
  const losers = {};
  const byMatch = {};

  DATA.knockoutMatches.forEach(m => {
    const pick = entry.picks[m.match];
    const a = resolveSlotName(m.teamA, winners, losers);
    const b = resolveSlotName(m.teamB, winners, losers);
    byMatch[m.match] = { displayA: a, displayB: b };

    if (!pick) return;
    const side = pick.advanceSide;
    if (side === "A") {
      winners[m.match] = a;
      losers[m.match] = b;
    } else if (side === "B") {
      winners[m.match] = b;
      losers[m.match] = a;
    }
  });

  return byMatch;
}

function receiptPlainText(entry) {
  const resolved = resolvedTeamsForEntry(entry);
  const code = receiptCode(entry);
  const lines = [];
  lines.push(`Comprovante do Bolão Copa 2026`);
  lines.push(`Entrada: ${escapeHtml(entry.entryName)}`);
  lines.push(`Responsável: ${escapeHtml(entry.payerName)}`);
  if (entry.participantEmail) lines.push(`E-mail: ${escapeHtml(entry.participantEmail)}`);
  lines.push(`Pagamento: ${escapeHtml(entry.paymentMethod || "Não informado")} ${entry.paymentTo ? "- " + entry.paymentTo : ""}`);
  lines.push(`Enviado em: ${new Date(entry.createdAt).toLocaleString("pt-BR")}`);
  if (entry.diagnostics) {
    lines.push(`IP público: ${entry.diagnostics.publicIp || "não capturado"}`);
    lines.push(`Dispositivo: ${entry.diagnostics.deviceType || ""} / ${entry.diagnostics.browser || ""} / ${entry.diagnostics.platform || ""}`);
    lines.push(`Timezone: ${entry.diagnostics.timezone || ""}`);
  }
  lines.push(`Código: ${code}`);
  lines.push("");
  DATA.knockoutMatches.forEach(m => {
    const p = entry.picks[m.match];
    if (!p) return;
    const r = resolved[m.match] || { displayA: p.displayA, displayB: p.displayB };
    const winner = p.advanceSide === "A" ? r.displayA : r.displayB;
    lines.push(`Match ${m.match}: ${escapeHtml(r.displayA)} ${p.goalsA} x ${p.goalsB} ${escapeHtml(r.displayB)} | Ganha/avança: ${escapeHtml(winner)}`);
  });
  lines.push("");
  lines.push("Placar válido: 90 minutos + prorrogação. Pênaltis não entram no placar.");
  return lines.join("\\n");
}


async function sendReceiptEmail(entry, target) {
  if (CONFIG.emailMode !== "emailjs" || !CONFIG.emailjs || !CONFIG.emailjs.enabled) {
    return { ok: false, fallback: "mailto", reason: t("emailNotConfigured") };
  }
  if (!window.emailjs) {
    return { ok: false, fallback: "mailto", reason: "EmailJS library not loaded." };
  }

  const recipient = target === "admin" ? (CONFIG.adminEmail || "emferrari@gmail.com") : (entry.participantEmail || "");
  if (!recipient) return { ok: false, reason: "Missing recipient email." };

  const templateId = target === "admin" ? CONFIG.emailjs.adminTemplateId : CONFIG.emailjs.participantTemplateId;
  if (!CONFIG.emailjs.publicKey || !CONFIG.emailjs.serviceId || !templateId) {
    return { ok: false, fallback: "mailto", reason: "EmailJS config incomplete." };
  }

  const params = {
    to_email: recipient,
    entry_name: entry.entryName,
    payer_name: entry.payerName,
    payment_method: entry.paymentMethod || "",
    payment_to: entry.paymentTo || "",
    receipt_code: receiptCode(entry),
    receipt_text: receiptPlainText(entry),
    html_message: buildReceiptHtml(entry)
  };

  try {
    await emailjs.send(CONFIG.emailjs.serviceId, templateId, params, { publicKey: CONFIG.emailjs.publicKey });
    return { ok: true };
  } catch (err) {
    console.error("EmailJS failed", err);
    return { ok: false, fallback: "mailto", reason: "EmailJS failed." };
  }
}

async function mailReceipt(entryId, target) {
  const s = state();
  const entry = s.entries.find(e => e.id === entryId);
  if (!entry) return alert("Entrada não encontrada.");

  const recipient = target === "admin" ? (CONFIG.adminEmail || "emferrari@gmail.com") : (entry.participantEmail || "");
  if (!recipient) {
    alert("Esta entrada não tem e-mail informado.");
    return;
  }

  const sent = await sendReceiptEmail(entry, target);
  if (sent.ok) {
    alert("E-mail enviado.");
    return;
  }

  if (sent.fallback === "mailto") {
    alert((sent.reason || t("emailNotConfigured")) + "\n\nVou abrir seu app de e-mail como fallback.");
    const subject = encodeURIComponent(`Comprovante Bolão Copa 2026 - ${escapeHtml(entry.entryName)}`);
    const body = encodeURIComponent(receiptPlainText(entry));
    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
  } else {
    alert(sent.reason || "Não foi possível enviar e-mail.");
  }
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


function detectDeviceType() {
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  if (/Tablet|iPad/i.test(ua)) return "tablet";
  return "desktop";
}

function detectBrowser() {
  const ua = navigator.userAgent || "";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  if (ua.includes("Firefox/")) return "Firefox";
  return "Unknown";
}

async function getPublicIp() {
  if (!CONFIG.diagnostics?.capturePublicIp) return "";
  try {
    const res = await fetch(CONFIG.diagnostics.ipLookupUrl || "https://api.ipify.org?format=json", { cache: "no-store" });
    if (!res.ok) return "";
    const data = await res.json();
    return data.ip || "";
  } catch (err) {
    console.warn("IP lookup failed", err);
    return "";
  }
}

async function collectDiagnostics() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  return {
    publicIp: await getPublicIp(),
    userAgent: navigator.userAgent || "",
    browser: detectBrowser(),
    deviceType: detectDeviceType(),
    platform: navigator.platform || "",
    language: navigator.language || "",
    languages: navigator.languages ? navigator.languages.join(",") : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    colorDepth: screen.colorDepth || "",
    referrer: document.referrer || "",
    pageUrl: location.href,
    online: navigator.onLine,
    connectionEffectiveType: conn.effectiveType || "",
    connectionDownlink: conn.downlink || "",
    capturedAt: new Date().toISOString()
  };
}

function setStatusConsole(message) {
  const box = $("#externalDataStatus");
  if (box) box.textContent = typeof message === "string" ? message : JSON.stringify(message, null, 2);
}

async function checkDiagnosticsConnection() {
  setStatusConsole("Coletando diagnóstico...");
  const data = await collectDiagnostics();
  setStatusConsole(data);
}

async function checkPolymarketConnection() {
  setStatusConsole("Consultando Polymarket Gamma API...");
  try {
    const url = CONFIG.externalData?.polymarket?.eventsUrl || "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100";
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    const events = Array.isArray(data) ? data : (data.events || data.data || []);
    const worldCup = events.filter(e => JSON.stringify(e).toLowerCase().includes("world cup")).slice(0, 5);
    setStatusConsole({
      ok: res.ok,
      status: res.status,
      totalEventsReturned: events.length,
      possibleWorldCupEvents: worldCup.map(e => ({
        id: e.id,
        title: e.title || e.slug || e.ticker || e.question || "untitled",
        slug: e.slug
      })),
      note: CONFIG.externalData?.polymarket?.note || "Mapeamento ainda precisa ser validado."
    });
  } catch (err) {
    setStatusConsole({ ok: false, error: String(err), note: "Pode ser CORS, rede, endpoint indisponível ou bloqueio do navegador." });
  }
}

async function checkResultsApiConnection() {
  const cfg = CONFIG.externalData?.results || {};
  if (!cfg.endpoint) {
    setStatusConsole({
      ok: false,
      provider: cfg.provider || "manual",
      mode: cfg.mode || "manual",
      note: cfg.note || "Nenhuma API de resultados configurada. Resultados continuam manuais."
    });
    return;
  }
  setStatusConsole("Consultando API de resultados...");
  try {
    const res = await fetch(cfg.endpoint, { cache: "no-store" });
    const data = await res.json();
    setStatusConsole({ ok: res.ok, status: res.status, sample: data });
  } catch (err) {
    setStatusConsole({ ok: false, error: String(err) });
  }
}

async function readEntryFromForm() {
  updateDynamicBracketLabels();

  const entryName = $("#entryName").value.trim();
  const payerName = $("#payerName").value.trim();
  const participantEmail = $("#participantEmail")?.value.trim() || "";
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

  const diagnostics = CONFIG.diagnostics?.captureDeviceInfo ? await collectDiagnostics() : {};

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    entryName,
    payerName,
    participantEmail,
    paymentMethod,
    paymentTo: PAYMENT_INFO[paymentMethod],
    diagnostics,
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
  const bonusCfg = CONFIG.bonus || DATA.bonus || { champion: 25, runnerUp: 15, third: 10, fourth: 5 };

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


function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

function flattenEntriesForExport(includePicks = true) {
  const s = state();
  return s.entries.map(entry => {
    const base = {
      id: entry.id,
      receiptCode: receiptCode(entry),
      entryName: entry.entryName,
      payerName: entry.payerName,
      participantEmail: entry.participantEmail || "",
      paymentMethod: entry.paymentMethod || "",
      paymentTo: entry.paymentTo || "",
      paid: !!s.paid[entry.id],
      createdAt: entry.createdAt,
      score: scoreEntry(entry, s).total,
      diagnostics_publicIp: entry.diagnostics?.publicIp || "",
      diagnostics_deviceType: entry.diagnostics?.deviceType || "",
      diagnostics_browser: entry.diagnostics?.browser || "",
      diagnostics_platform: entry.diagnostics?.platform || "",
      diagnostics_timezone: entry.diagnostics?.timezone || "",
      diagnostics_screen: entry.diagnostics?.screen || "",
      diagnostics_viewport: entry.diagnostics?.viewport || "",
      diagnostics_userAgent: entry.diagnostics?.userAgent || ""
    };
    if (includePicks) {
      DATA.knockoutMatches.forEach(m => {
        const p = entry.picks[m.match];
        if (p) {
          base[`match_${m.match}_A`] = p.displayA || "";
          base[`match_${m.match}_score`] = `${p.goalsA}x${p.goalsB}`;
          base[`match_${m.match}_B`] = p.displayB || "";
          base[`match_${m.match}_advanceSide`] = p.advanceSide || "";
        }
      });
    }
    return base;
  });
}

function objectsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach(k => set.add(k));
    return set;
  }, new Set()));
  return [headers.map(csvEscape).join(",")]
    .concat(rows.map(row => headers.map(h => csvEscape(row[h])).join(",")))
    .join("\\n");
}

function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadBackupJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: CONFIG.appName || "Bolão",
    storageKey: storeKey,
    data: state(),
    matches: DATA.knockoutMatches,
    config: {
      entryFee: CONFIG.entryFee,
      prizes: CONFIG.prizes,
      bonus: CONFIG.bonus,
      scoring: CONFIG.scoring
    },
    disclaimer: CONFIG.transparency?.legalDisclaimer || "",
    note: "Compare receipt codes and exported backup/master list to detect later changes."
  };
  downloadText(`bolao-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function downloadBackupCsv() {
  const rows = flattenEntriesForExport(true);
  downloadText(`bolao-backup-${new Date().toISOString().slice(0,10)}.csv`, objectsToCsv(rows), "text/csv");
}

function downloadMasterCsv() {
  const rows = flattenEntriesForExport(false);
  downloadText(`bolao-master-list-${new Date().toISOString().slice(0,10)}.csv`, objectsToCsv(rows), "text/csv");
}

function openMasterList() {
  const s = state();
  const rows = s.entries.map(e => {
    const scored = scoreEntry(e, s);
    return `<tr><td>${escapeHtml(e.entryName)}</td><td>${escapeHtml(e.payerName)}</td><td>${e.paymentMethod || ""}</td><td>${s.paid[e.id] ? "Pago" : "Pendente"}</td><td>${scored.total}</td><td><code>${receiptCode(e)}</code></td><td>${new Date(e.createdAt).toLocaleString("pt-BR")}</td></tr>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Master List Bolão</title><style>body{font-family:Arial;margin:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}code{font-size:12px}</style></head><body><h1>Master List - Bolão Copa 2026</h1><p>Gerado em ${new Date().toLocaleString("pt-BR")}</p><p>${CONFIG.transparency?.legalDisclaimer || ""}</p><table><thead><tr><th>Entrada</th><th>Responsável</th><th>Pagamento</th><th>Status</th><th>Pontos</th><th>Código</th><th>Enviado em</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();
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
  $("#potValue").textContent = `$${paidCount * (CONFIG.entryFee || DATA.entryFee)}`;

  const list = $("#rankingList");
  list.innerHTML = ranked.length ? "" : `<div class="card"><p class="muted">Nenhuma entrada ainda. Use “Criar 3 entradas demo” no Admin para testar.</p></div>`;

  ranked.forEach((r, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
    const div = document.createElement("div");
    div.className = "rank-row";
    div.innerHTML = `
      <div class="medal">${medal}</div>
      <div><b>${escapeHtml(r.entryName)}</b><br><span class="muted">${escapeHtml(r.payerName)}${r.paymentMethod ? " • " + r.paymentMethod : ""}${r.bonus?.total ? " • bônus finais +" + r.bonus.total : ""}</span><br><span class="receipt-code">${receiptCode(r)}</span></div>
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
      div.innerHTML = `<b>${escapeHtml(r.entryName)}</b><br><span class="receipt-code">${receiptCode(r)}</span><div class="receipt-actions"><button class="small-btn secondary" onclick="openReceipt('${r.id}')">Abrir comprovante</button><button class="small-btn secondary" onclick="downloadReceipt('${r.id}')">Baixar HTML</button><button class="small-btn secondary" onclick="mailReceipt('${r.id}', 'participant')">E-mail para participante</button><button class="small-btn secondary" onclick="mailReceipt('${r.id}', 'admin')">E-mail para Eduardo</button></div>`;
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
      <div><b>${escapeHtml(e.entryName)}</b><br><span class="muted">${escapeHtml(e.payerName)}${e.paymentMethod ? " • " + e.paymentMethod + " → " + (e.paymentTo || "") : ""}</span></div>
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


function renderParticipants() {
  const s = state();
  const box = $("#participantsList");
  const stat = $("#statParticipants");
  if (stat) stat.textContent = s.entries.length;
  if (!box) return;
  if (!s.entries.length) {
    box.innerHTML = `<p class="muted">Nenhuma entrada registrada ainda.</p>`;
    return;
  }
  box.innerHTML = "";
  s.entries.forEach(e => {
    const div = document.createElement("div");
    div.className = "rank-row";
    div.innerHTML = `<div class="medal">👤</div><div><b>${escapeHtml(e.entryName)}</b><br><span class="muted">${escapeHtml(e.payerName)}${e.paymentMethod ? " • " + e.paymentMethod : ""}</span></div><div class="status">${state().paid[e.id] ? "Pago" : "Pendente"}</div>`;
    box.appendChild(div);
  });
}

function renderAll() {
  renderRanking();
  renderAdmin();
  renderGames();
  renderParticipants();
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
    $$(".tab,.nav-link,.top-link").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    $$(".panel").forEach(p => p.classList.toggle("active", p.id === tab));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  setupLanguageSwitcher();
  applyLanguage();
  setupAdminLogin();
  renderBracketForm();
  renderAll();
  renderSimulationDisclaimer();
  updateCountdown();
  setInterval(updateCountdown, 30000);
  lockFormIfCutoff();

  $("#saveEntry").addEventListener("click", async e => {
    e.preventDefault();

    if (isPastCutoff()) {
      alert("As inscrições já foram encerradas pelo cutoff.");
      return;
    }

    const entry = await readEntryFromForm();
    if (!entry) return;

    const s = state();
    s.entries.push(entry);
    s.paid[entry.id] = false;
    saveState(s);

    alert("Entrada salva. Guarde o comprovante. Se o e-mail automático estiver configurado, o site tentará enviar o comprovante agora.");

    if (CONFIG.emailMode === "emailjs" && CONFIG.emailjs?.enabled) {
      try {
        await sendReceiptEmail(entry, "participant");
        await sendReceiptEmail(entry, "admin");
      } catch (err) {
        console.warn("Auto email failed", err);
      }
    }
    $("#entryName").value = "";
    $("#payerName").value = "";
    if ($("#participantEmail")) $("#participantEmail").value = "";
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
