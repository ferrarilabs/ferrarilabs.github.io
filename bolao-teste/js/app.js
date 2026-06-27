
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
  document.title = `${CONFIG.appName || "Bolão do Ferrari"} - Copa 2026`;
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll("[data-i18n-value]").forEach(el => {
    const key = el.dataset.i18nValue;
    el.value = t(key);
  });
  const sel = $("#languageSelect");
  if (sel) sel.value = currentLang;
  const support = $("#supportWhatsappBtn span");
  if (support) support.textContent = t("supportWhatsApp");
}

function setupLanguageSwitcher() {
  const sel = $("#languageSelect");
  if (!sel) return;
  sel.value = currentLang;
  sel.addEventListener("change", () => {
    currentLang = sel.value;
    localStorage.setItem("bolaoLang", currentLang);
    renderAll();
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


function adminLogout() {
  if (!confirm("Sair do modo administrador?")) return;
  sessionStorage.removeItem("bolaoAdminOk");
  const area = $("#adminArea");
  const login = $("#adminLogin");
  if (area) area.style.display = "none";
  if (login) login.style.display = "block";
  alert("Logout realizado.");
}

function setupAdminLogout() {
  const btn = $("#adminLogoutBtn");
  if (btn) btn.addEventListener("click", adminLogout);
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


function finalPodiumForEntry(entry) {
  const winners = {};
  const losers = {};

  DATA.knockoutMatches.forEach(m => {
    const pick = entry.picks[m.match];
    const a = resolveSlotName(m.teamA, winners, losers);
    const b = resolveSlotName(m.teamB, winners, losers);

    if (!pick) return;

    if (pick.advanceSide === "A") {
      winners[m.match] = a;
      losers[m.match] = b;
    } else if (pick.advanceSide === "B") {
      winners[m.match] = b;
      losers[m.match] = a;
    }
  });

  const finalMatch = DATA.knockoutMatches.find(m => /final/i.test(m.phase || "") || String(m.match) === "104");
  const thirdMatch = DATA.knockoutMatches.find(m => /third|3/i.test(m.phase || "") || String(m.match) === "103");

  let champion = "Não definido";
  let runnerUp = "Não definido";
  let third = "Não definido";
  let fourth = "Não definido";

  if (finalMatch && entry.picks[finalMatch.match]) {
    const p = entry.picks[finalMatch.match];
    const a = resolveSlotName(finalMatch.teamA, winners, losers);
    const b = resolveSlotName(finalMatch.teamB, winners, losers);
    champion = p.advanceSide === "A" ? a : b;
    runnerUp = p.advanceSide === "A" ? b : a;
  }

  if (thirdMatch && entry.picks[thirdMatch.match]) {
    const p = entry.picks[thirdMatch.match];
    const a = resolveSlotName(thirdMatch.teamA, winners, losers);
    const b = resolveSlotName(thirdMatch.teamB, winners, losers);
    third = p.advanceSide === "A" ? a : b;
    fourth = p.advanceSide === "A" ? b : a;
  }

  return { champion, runnerUp, third, fourth };
}

function finalPodiumHtml(entry) {
  const p = finalPodiumForEntry(entry);
  return `
  <div class="podium-section">
    <div class="podium-title">🏆 Palpite final do participante</div>
    <div class="podium-subtitle">Destaque dos bônus finais: campeão, vice, 3º e 4º lugar</div>
    <div class="podium-grid">
      <div class="podium-card champion">
        <div class="podium-medal">🥇</div>
        <div class="podium-label">Campeão</div>
        <div class="podium-team">${escapeHtml(p.champion)}</div>
      </div>
      <div class="podium-card runner">
        <div class="podium-medal">🥈</div>
        <div class="podium-label">Vice-campeão</div>
        <div class="podium-team">${escapeHtml(p.runnerUp)}</div>
      </div>
      <div class="podium-card third">
        <div class="podium-medal">🥉</div>
        <div class="podium-label">3º lugar</div>
        <div class="podium-team">${escapeHtml(p.third)}</div>
      </div>
      <div class="podium-card fourth">
        <div class="podium-medal">4º</div>
        <div class="podium-label">4º lugar</div>
        <div class="podium-team">${escapeHtml(p.fourth)}</div>
      </div>
    </div>
  </div>`;
}

function buildReceiptHtml(entry) {
  const code = receiptCode(entry);
  const resolved = resolvedTeamsForEntry(entry);
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks[m.match];
    if (!p) return "";
    const r = resolved[m.match] || { displayA: p.displayA, displayB: p.displayB };
    const winner = p.advanceSide === "A" ? r.displayA : r.displayB;
    return `<tr>
      <td><b>Match ${m.match}</b><br><span>${escapeHtml(phaseLabel(m.phase))}</span></td>
      <td>${escapeHtml(r.displayA)}</td>
      <td class="score">${p.goalsA} x ${p.goalsB}</td>
      <td>${escapeHtml(r.displayB)}</td>
      <td>${escapeHtml(winner)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprovante - ${escapeHtml(entry.entryName)}</title>
<style>
body{font-family:Arial,sans-serif;margin:0;color:#111;background:#f5f7fb}
.receipt-document{max-width:900px;margin:24px auto;background:white;border-radius:18px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.12)}
.header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid #20bf55;padding-bottom:16px;margin-bottom:18px}
h1{margin:0;font-size:28px}
.subtitle{color:#52606d;margin-top:6px}
.badge{background:#e9fff1;color:#0c7a33;border:1px solid #86efac;border-radius:999px;padding:8px 12px;font-weight:bold;text-align:center}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f2f4f7;padding:16px;border-radius:14px;margin:16px 0}
.meta p{margin:4px 0}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:bold;color:#0c7a33;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}
td,th{border-bottom:1px solid #dde3ea;padding:10px;text-align:left;vertical-align:top}
th{background:#0b1b23;color:white}
td span{color:#6b7280;font-size:11px}
.score{font-size:16px;font-weight:bold;text-align:center;white-space:nowrap}
.podium-section{margin-top:24px;border-radius:18px;padding:20px;background:linear-gradient(135deg,#07151c,#0f3b22);color:white;border:2px solid #20bf55;break-inside:avoid}
.podium-title{font-size:24px;font-weight:900;text-align:center;margin-bottom:4px;text-transform:uppercase}
.podium-subtitle{text-align:center;color:#c7f9d4;font-size:12px;margin-bottom:16px}
.podium-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.podium-card{border-radius:16px;padding:16px;text-align:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16)}
.podium-card.champion{grid-column:1/3;background:linear-gradient(135deg,#ffe08a,#f5b301);color:#111;border-color:#f5b301}
.podium-card.runner{background:linear-gradient(135deg,#e5e7eb,#9ca3af);color:#111}
.podium-card.third{background:linear-gradient(135deg,#f4b183,#b45309);color:#111}
.podium-card.fourth{background:rgba(255,255,255,.10)}
.podium-medal{font-size:34px;font-weight:900;margin-bottom:4px}
.podium-label{text-transform:uppercase;font-size:11px;font-weight:900;letter-spacing:.8px;opacity:.82}
.podium-team{font-size:22px;font-weight:900;margin-top:4px}
.notice{margin-top:18px;background:#fff8e1;border:1px solid #ffd166;border-radius:12px;padding:12px;font-size:12px;color:#5f4300}
.footer{margin-top:18px;color:#6b7280;font-size:12px}
.actions{margin:16px auto;max-width:900px;text-align:center}
button{background:#20bf55;color:#03130b;border:0;border-radius:10px;padding:10px 14px;font-weight:bold;cursor:pointer}
@media print{body{background:white}.actions{display:none}.receipt-document{box-shadow:none;margin:0;border-radius:0}.meta{break-inside:avoid}tr{break-inside:avoid}}
</style>
</head>
<body>
<div class="actions"><button onclick="window.print()">Imprimir / salvar PDF</button></div>
<div class="receipt-document">
  <div class="header">
    <div>
      <h1>Comprovante do Bolão Copa 2026</h1>
      <div class="subtitle">Este comprovante registra exatamente os palpites enviados nesta entrada.</div>
    </div>
    <div class="badge">US$ 5 por entrada</div>
  </div>

  <div class="meta">
    <div>
      <p><b>Entrada:</b> ${escapeHtml(entry.entryName)}</p>
      <p><b>Responsável:</b> ${escapeHtml(entry.payerName)}</p>
      ${entry.participantEmail ? `<p><b>E-mail:</b> ${escapeHtml(entry.participantEmail)}</p>` : ""}
    </div>
    <div>
      <p><b>Pagamento:</b> ${escapeHtml(entry.paymentMethod || "Não informado")} ${escapeHtml(entry.paymentTo ? "— " + entry.paymentTo : "")}</p>
      <p><b>Enviado em:</b> ${new Date(entry.createdAt).toLocaleString("pt-BR")}</p>
      <p><b>Código:</b> <span class="code">${code}</span></p>
    </div>
  </div>

  <table>
    <thead><tr><th>Jogo</th><th>Time A</th><th>Placar</th><th>Time B</th><th>Ganha/avança</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${finalPodiumHtml(entry)}

  <div class="notice">
    <b>Regras importantes:</b> placar válido é 90 minutos + prorrogação. Pênaltis não entram no placar. Este é um bolão informal entre amigos. Em caso de falha técnica, comprovantes individuais, backups e master list serão usados como referência.
  </div>

  <div class="footer">
    Código de autenticação: <span class="code">${code}</span><br>
    Gerado por Bolão do Ferrari — Copa do Mundo 2026.
  </div>
</div>
</body>
</html>`;
}


function receiptFileName(entry, ext = "pdf") {
  const safeName = String(entry.entryName || "entrada").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `comprovante-${safeName}-${receiptCode(entry)}.${ext}`;
}

async function downloadReceiptPdf(entryId) {
  openReceipt(entryId);
  alert("O comprovante abriu em uma nova aba. Para salvar como PDF, use Compartilhar/Imprimir/Salvar como PDF no navegador.");
}

function renderLatestReceipt(entry) {
  const box = $("#latestReceiptBox");
  if (!box) return;
  box.style.display = "block";
  box.innerHTML = `
    <h2>${t("savedTitle")}</h2>
    <p class="muted">${t("savedText")}</p>
    <div class="receipt-code">${receiptCode(entry)}</div>
    <div class="receipt-actions">
      <button class="secondary" onclick="openReceipt('${entry.id}')">${t("openReceipt")}</button>
      <button class="secondary" onclick="downloadReceiptPdf('${entry.id}')">${t("downloadPdf")}</button>
      <button class="secondary" onclick="downloadReceipt('${entry.id}')">${t("downloadHtml")}</button>
      <button class="secondary" onclick="mailReceipt('${entry.id}', 'participant')">${t("sendEmail")}</button>
    </div>
  `;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
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


let polymarketCache = {
  fetchedAt: 0,
  events: [],
  markets: []
};

function normalizeNameForMarket(name) {
  return String(name || "")
    .toLowerCase()
    .replaceAll("united states", "usa")
    .replaceAll("côte d'ivoire", "ivory coast")
    .replaceAll("bosnia and herzegovina", "bosnia")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function fetchPolymarketEventsForSimulator(force = false) {
  const cfg = CONFIG.externalData?.polymarket || CONFIG.polymarket || {};
  const predCfg = CONFIG.predictionMarkets || {};
  if (!predCfg.enabled || !predCfg.preferPolymarket) return [];

  const maxAgeMs = (predCfg.cacheMinutes || 10) * 60 * 1000;
  if (!force && polymarketCache.events.length && Date.now() - polymarketCache.fetchedAt < maxAgeMs) {
    return polymarketCache.events;
  }

  try {
    const url = cfg.eventsUrl || "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`);
    const data = await res.json();
    const events = Array.isArray(data) ? data : (data.events || data.data || []);
    polymarketCache = { fetchedAt: Date.now(), events, markets: flattenPolymarketMarkets(events) };
    return events;
  } catch (err) {
    console.warn("Polymarket fetch failed. Falling back to local model.", err);
    return [];
  }
}

function flattenPolymarketMarkets(events) {
  const markets = [];
  for (const ev of events || []) {
    if (Array.isArray(ev.markets)) {
      for (const m of ev.markets) markets.push({ event: ev, market: m });
    } else if (ev.market) {
      markets.push({ event: ev, market: ev.market });
    }
  }
  return markets;
}

function extractMarketTitle(event, market) {
  return [
    event?.title, event?.slug, event?.ticker, event?.question,
    market?.question, market?.title, market?.slug, market?.description
  ].filter(Boolean).join(" | ");
}

function getOutcomeProbabilities(market) {
  const outcomes = safeJsonArray(market.outcomes);
  const pricesRaw = safeJsonArray(market.outcomePrices);
  const prices = pricesRaw.map(x => Number(x)).filter(x => !Number.isNaN(x));
  if (!outcomes.length || outcomes.length !== prices.length) return [];
  return outcomes.map((name, i) => ({ name: String(name), probability: prices[i] }));
}

function findPolymarketMatchProbability(teamA, teamB) {
  const a = normalizeNameForMarket(teamA);
  const b = normalizeNameForMarket(teamB);
  if (!a || !b) return null;

  let best = null;

  for (const item of polymarketCache.markets || []) {
    const title = normalizeNameForMarket(extractMarketTitle(item.event, item.market));
    if (!title.includes(a) || !title.includes(b)) continue;

    const probs = getOutcomeProbabilities(item.market);
    if (!probs.length) continue;

    let pA = null;
    let pB = null;

    for (const out of probs) {
      const outName = normalizeNameForMarket(out.name);
      if (outName === a || outName.includes(a) || a.includes(outName)) pA = out.probability;
      if (outName === b || outName.includes(b) || b.includes(outName)) pB = out.probability;
    }

    // Binary markets may be phrased as "Will Team A beat Team B?"
    if ((pA === null || pB === null) && probs.length === 2) {
      const yes = probs.find(x => normalizeNameForMarket(x.name).includes("yes"));
      const no = probs.find(x => normalizeNameForMarket(x.name).includes("no"));
      if (yes && no) {
        const titleMentionsAFirst = title.indexOf(a) >= 0 && (title.indexOf(b) < 0 || title.indexOf(a) < title.indexOf(b));
        if (titleMentionsAFirst) {
          pA = yes.probability;
          pB = no.probability;
        }
      }
    }

    if (pA !== null && pB !== null) {
      const sum = pA + pB;
      if (sum > 0) {
        pA = pA / sum;
        pB = pB / sum;
      }
      best = {
        teamA,
        teamB,
        pA,
        pB,
        source: "Polymarket",
        marketTitle: extractMarketTitle(item.event, item.market),
        marketId: item.market?.id || item.market?.conditionId || item.event?.id || "",
        updatedAt: new Date().toISOString()
      };
      break;
    }
  }

  return best;
}

function localMatchProbability(teamA, teamB) {
  const sa = teamStrength(teamA);
  const sb = teamStrength(teamB);
  // logistic-ish conversion, intentionally conservative
  const pA = 1 / (1 + Math.exp(-(sa - sb) / 8));
  return {
    teamA,
    teamB,
    pA,
    pB: 1 - pA,
    source: "Modelo local",
    marketTitle: "Sem mercado Polymarket compatível encontrado",
    updatedAt: new Date().toISOString()
  };
}

function probabilityForMatch(teamA, teamB) {
  const pm = findPolymarketMatchProbability(teamA, teamB);
  return pm || localMatchProbability(teamA, teamB);
}

function scoreFromProbability(pWinner) {
  // creates plausible scores, not exact science
  const r = Math.random();
  if (pWinner >= 0.72) {
    if (r < 0.35) return [3, 0];
    if (r < 0.70) return [2, 0];
    return [3, 1];
  }
  if (pWinner >= 0.58) {
    if (r < 0.40) return [2, 1];
    if (r < 0.70) return [1, 0];
    return [2, 0];
  }
  if (r < 0.45) return [1, 1];
  if (r < 0.70) return [2, 1];
  return [1, 0];
}

async function explainSimulator() {
  await fetchPolymarketEventsForSimulator(false);
  const available = polymarketCache.markets?.length || 0;
  alert(`Simulador automático:
- Tenta usar probabilidades por jogo do Polymarket.
- Se não encontrar mercado compatível, usa modelo local de força estimada.
- Sorteia o vencedor com base na probabilidade encontrada.
- Depois gera um placar plausível.

Mercados Polymarket carregados nesta sessão: ${available}

Simulador maluco:
- Preenche quase aleatoriamente.
- Serve para brincar ou preencher rápido.
- Não usa fonte estatística séria.

Nada disso é recomendação de aposta.`);
}


function predictedScoreFor(currentA, currentB, mode) {
  if (mode === "random") {
    const ga = Math.floor(Math.random() * 4);
    const gb = Math.floor(Math.random() * 4);
    return [ga, gb, { source: "Simulador maluco", pA: 0.5, pB: 0.5 }];
  }

  const prob = probabilityForMatch(currentA, currentB);
  const aWins = Math.random() < prob.pA;
  const winnerProb = aWins ? prob.pA : prob.pB;
  const [wg, lg] = scoreFromProbability(winnerProb);

  if (aWins) return [wg, lg, prob];
  return [lg, wg, prob];
}

async function autoFillPicks(mode = "smart") {
  const disclaimer = CONFIG.simulationDisclaimer || "Simulação é apenas entretenimento e pode estar errada.";
  if (!confirm((mode === "smart" ? "Preencher automaticamente usando Polymarket quando disponível e modelo local como fallback? " : "Preencher aleatoriamente? ") + "\n\n" + disclaimer + "\n\nVocê ainda pode revisar antes de salvar.")) return;

  if (mode === "smart") await fetchPolymarketEventsForSimulator(true);

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


const PAYMENT_INFO = CONFIG.paymentMethods || { CashApp: "$EduardoFerrari", Zelle: "914-406-5027", PayPal: "emferrari@gmail.com", Venmo: "Eduardo-Ferrari" };

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
    <div class="pay-mini-head">${paymentLogoFor(method) ? `<img src="${paymentLogoFor(method)}" alt="">` : ""}<b>Pagamento via ${method}</b></div>
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

function paymentLogoFor(method) {
  const map = { CashApp:"cashapp.svg", Zelle:"zelle.svg", PayPal:"paypal.svg", Venmo:"venmo.svg" };
  return map[method] ? `assets/${map[method]}` : "";
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

  let days = 0, hours = 0, minutes = 0;
  if (diff > 0) {
    const totalMinutes = Math.floor(diff / 60000);
    days = Math.floor(totalMinutes / 1440);
    hours = Math.floor((totalMinutes % 1440) / 60);
    minutes = totalMinutes % 60;
  }

  box.innerHTML = `
    <div class="countdown-clean">
      <div><b>${days}</b><span>Dias</span></div>
      <div><b>${hours}</b><span>Hrs</span></div>
      <div><b>${minutes}</b><span>Min</span></div>
    </div>
  `;
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


function renderSimulatorHelp() {
  const box = $("#simulatorHelpCard");
  if (!box) return;
  box.innerHTML = `
    <details open>
      <summary>${t("simulatorTitle")}</summary>
      <div class="sim-grid">
        <div>
          <h4>${t("autoSimulatorTitle")}</h4>
          <p>${t("autoSimulatorText")}</p>
        </div>
        <div>
          <h4>${t("randomSimulatorTitle")}</h4>
          <p>${t("randomSimulatorText")}</p>
        </div>
      </div>
      <p class="muted small"><b>Aviso:</b> ${t("simulatorWarning")}</p>
    </details>
  `;
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
  lines.push(`============================`);
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
  lines.push("PALPITES");
  lines.push("----------------------------");
  DATA.knockoutMatches.forEach(m => {
    const p = entry.picks[m.match];
    if (!p) return;
    const r = resolved[m.match] || { displayA: p.displayA, displayB: p.displayB };
    const winner = p.advanceSide === "A" ? r.displayA : r.displayB;
    lines.push(`Match ${m.match}: ${escapeHtml(r.displayA)} ${p.goalsA} x ${p.goalsB} ${escapeHtml(r.displayB)} | Ganha/avança: ${escapeHtml(winner)}`);
  });
  const podium = finalPodiumForEntry(entry);
  lines.push("");
  lines.push("PALPITE FINAL / BÔNUS");
  lines.push("----------------------------");
  lines.push(`Campeão: ${podium.champion}`);
  lines.push(`Vice-campeão: ${podium.runnerUp}`);
  lines.push(`3º lugar: ${podium.third}`);
  lines.push(`4º lugar: ${podium.fourth}`);
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
    html_message: buildReceiptHtml(entry),
      receipt_html: buildReceiptHtml(entry),
      receipt_text_pretty: receiptPlainText(entry).replaceAll("\n", "<br>")
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
      sampleMarketsWithPrices: (polymarketCache.markets || []).slice(0, 5).map(x => ({
        title: extractMarketTitle(x.event, x.market),
        outcomes: safeJsonArray(x.market.outcomes),
        outcomePrices: safeJsonArray(x.market.outcomePrices)
      })),
      note: (CONFIG.externalData?.polymarket?.note || "Mapeamento ainda precisa ser validado.") + " Polymarket ainda NÃO alimenta a simulação automaticamente nesta versão."
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
      note: cfg.note || "Nenhuma API de resultados configurada. Resultados continuam manuais nesta versão estática. Para automático, usar backend/proxy com API key protegida."
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


function isValidEmail(email) {
  const e = String(email || "").trim();
  if (!e) return true;
  if (/\s/.test(e)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function scoreWarningLevel(a, b) {
  const max = Math.max(a, b);
  const diff = Math.abs(a - b);
  const total = a + b;
  if (max >= 10 || diff >= 8 || total >= 12) return "extreme";
  if (max >= 6 || diff >= 5 || total >= 9) return "unusual";
  return "normal";
}

function validateScorePair(a, b) {
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a <= 20 && b <= 20;
}

function pickWinnerSide(goalsA, goalsB) {
  if (goalsA > goalsB) return "A";
  if (goalsB > goalsA) return "B";
  return "";
}

function confirmUnusualScores(picks) {
  const repeated = {};
  let hasCrazy = false;
  Object.values(picks).forEach(p => {
    const key = `${p.goalsA}x${p.goalsB}`;
    repeated[key] = (repeated[key] || 0) + 1;
    if (scoreWarningLevel(p.goalsA, p.goalsB) !== "normal") hasCrazy = true;
  });
  const manyRepeated = Object.values(repeated).some(n => n >= 8);
  if (hasCrazy && !confirm(t("crazyScoreWarning") + "\n\n" + t("keepScore") + "?")) return false;
  if (manyRepeated && !confirm(t("repetitiveWarning") + "\n\n" + t("keepScore") + "?")) return false;
  return true;
}

function validateEntryObject(entry) {
  if (!entry.entryName) return t("requiredEntryName");
  if (!entry.payerName) return t("requiredPayerName");
  if (!entry.paymentMethod) return t("requiredPaymentMethod");
  if (!isValidEmail(entry.participantEmail)) return t("invalidEmail");
  for (const m of DATA.knockoutMatches) {
    const p = entry.picks[m.match];
    if (!p) continue;
    if (!validateScorePair(p.goalsA, p.goalsB)) return `${t("invalidScore")} Match ${m.match}`;
    const winnerSide = pickWinnerSide(p.goalsA, p.goalsB);
    if (winnerSide && p.advanceSide !== winnerSide) return `${t("inconsistentAdvance")} Match ${m.match}`;
    if (!winnerSide && !p.advanceSide) return `${t("tieNeedsAdvance")} Match ${m.match}`;
  }
  return "";
}

function validateRealResultsState(s) {
  if (!s.results) return "";
  for (const [matchId, r] of Object.entries(s.results)) {
    if (r.goalsA === undefined || r.goalsB === undefined || r.goalsA === "" || r.goalsB === "") continue;
    const a = Number(r.goalsA);
    const b = Number(r.goalsB);
    if (!validateScorePair(a, b)) return `${t("invalidScore")} Match ${matchId}`;
    const winnerSide = pickWinnerSide(a, b);
    if (winnerSide && r.advanceSide && r.advanceSide !== winnerSide) return `${t("inconsistentAdvance")} Match ${matchId}`;
    if (!winnerSide && !r.advanceSide) return `${t("tieNeedsAdvance")} Match ${matchId}`;
  }
  return "";
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


async function sendRemovalEmail(entry, reason) {
  if (!entry || !entry.participantEmail) return { ok: false, reason: "missing participant email" };

  if (CONFIG.emailMode !== "emailjs" || !CONFIG.emailjs || !CONFIG.emailjs.enabled || !window.emailjs) {
    return { ok: false, fallback: "mailto", reason: "EmailJS not available" };
  }

  const text = [
    "Aviso de remoção de entrada do Bolão Copa 2026",
    "=============================================",
    "",
    `Entrada removida: ${entry.entryName}`,
    `Responsável: ${entry.payerName}`,
    `Código do comprovante original: ${receiptCode(entry)}`,
    reason ? `Motivo informado: ${reason}` : "Motivo informado: correção administrativa ou erro de preenchimento.",
    "",
    "Se você acredita que isso foi um erro, entre em contato no grupo do WhatsApp do bolão.",
    "",
    "Este aviso foi gerado automaticamente pelo site do bolão."
  ].join("\n");

  try {
    await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId, {
      to_email: entry.participantEmail,
      entry_name: `REMOVIDA - ${entry.entryName}`,
      payer_name: entry.payerName,
      payment_method: entry.paymentMethod || "",
      payment_to: entry.paymentTo || "",
      receipt_code: receiptCode(entry),
      receipt_text: text,
      receipt_text_pretty: text.replaceAll("\n", "<br>"),
      html_message: `<h2>Entrada removida do Bolão Copa 2026</h2><p><b>Entrada:</b> ${escapeHtml(entry.entryName)}</p><p><b>Código:</b> ${receiptCode(entry)}</p><p><b>Motivo:</b> ${escapeHtml(reason || "Correção administrativa ou erro de preenchimento.")}</p><p>Se você acredita que isso foi um erro, entre em contato no grupo do WhatsApp.</p>`
    }, { publicKey: CONFIG.emailjs.publicKey });

    return { ok: true };
  } catch (err) {
    console.error("Removal email failed", err);
    return { ok: false, reason: String(err) };
  }
}

async function deleteEntry(entryId) {
  const s = state();
  const entry = s.entries.find(e => e.id === entryId);
  if (!entry) return alert("Entrada não encontrada.");

  if (!confirm(t("deleteConfirm"))) return;
  const reason = prompt(t("deleteReasonPrompt"), "") || "";

  const emailResult = await sendRemovalEmail(entry, reason);

  const next = state();
  next.entries = next.entries.filter(e => e.id !== entryId);
  if (next.paid) delete next.paid[entryId];
  saveState(next);

  renderAll();
  alert(t("deleteEmailSent") + (emailResult.ok ? "" : "\n\nObs: e-mail automático pode não ter sido enviado. Verifique o EmailJS."));
}

function renderRanking() {
  const s = state();
  const box = $("#rankingList");
  const pot = $("#potValue");
  if (pot) pot.textContent = `$${s.entries.length * (CONFIG.entryFee || DATA.entryFee || 5)}`;

  if (!box) return;
  const rows = s.entries
    .map(e => ({ ...e, score: scoreEntry(e, s).total, bonus: scoreEntry(e, s).bonus }))
    .sort((a, b) => b.score - a.score);

  if (!rows.length) {
    box.innerHTML = `<div class="card"><p class="muted">Nenhuma entrada registrada ainda.</p></div>`;
    return;
  }

  box.innerHTML = `<div class="card"><p class="muted">${t("publicRankingNote")}</p></div>`;

  rows.forEach((r, idx) => {
    const div = document.createElement("div");
    div.className = "rank-row public-rank-row";
    div.innerHTML = `
      <div class="medal">${idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}</div>
      <div><b>${escapeHtml(r.entryName)}</b><br><span class="muted">${escapeHtml(r.payerName)}${r.bonus?.total ? " • bônus finais +" + r.bonus.total : ""}</span><br><span class="receipt-code">${receiptCode(r)}</span></div>
      <div class="points">${r.score}</div>
      <button class="small-btn secondary" onclick="togglePublicPicks('${r.id}')">${t("viewPicks")}</button>
    `;
    box.appendChild(div);

    const detail = document.createElement("div");
    detail.className = "card public-picks-card";
    detail.dataset.publicPicks = r.id;
    detail.style.display = "none";
    detail.innerHTML = `<h3>${escapeHtml(r.entryName)} — ${t("viewPicks")}</h3>${picksSummaryHtml(r)}`;
    box.appendChild(detail);
  });
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


function formatFriendlyDate(dateStr) {
  if (!dateStr) return "";
  // Keep date in a stable friendly format without timezone conversion surprises.
  const parts = String(dateStr).split("-");
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString(currentLang || "pt-BR", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  return dateStr;
}

function matchScheduleMeta(m) {
  const date = formatFriendlyDate(m.date || "");
  const time = m.timeET || m.kickoffET || m.time || "";
  const venue = m.venue || t("venueTbd");
  const items = [];
  if (date) items.push(`<span class="schedule-pill">📅 <b>${t("matchDateLabel")}:</b> ${escapeHtml(date)}</span>`);
  if (time) items.push(`<span class="schedule-pill">🕒 <b>${t("matchTimeLabel")}:</b> ${escapeHtml(time)}</span>`);
  if (venue) items.push(`<span class="schedule-pill">📍 <b>${t("matchVenueLabel")}:</b> ${escapeHtml(venue)}</span>`);
  return items.join("");
}

function picksSummaryHtml(entry) {
  const resolved = resolvedTeamsForEntry(entry);
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks[m.match];
    if (!p) return "";
    const r = resolved[m.match] || { displayA: p.displayA, displayB: p.displayB };
    const winner = p.advanceSide === "A" ? r.displayA : r.displayB;
    return `<tr><td>Match ${m.match}<br><span class="muted">${matchScheduleMeta(m)}</span></td><td>${escapeHtml(r.displayA)}</td><td><b>${p.goalsA} x ${p.goalsB}</b></td><td>${escapeHtml(r.displayB)}</td><td>${escapeHtml(winner)}</td></tr>`;
  }).join("");
  return `<div class="picks-detail"><table><thead><tr><th>Jogo</th><th>Time A</th><th>Placar</th><th>Time B</th><th>Ganha/avança</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function togglePublicPicks(entryId) {
  const row = document.querySelector(`[data-public-picks="${entryId}"]`);
  if (!row) return;
  row.style.display = row.style.display === "none" ? "block" : "none";
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


function renderReceipts() {
  const publicBox = $("#receiptsList");
  if (publicBox) publicBox.innerHTML = "";

  const adminBox = $("#adminReceipts");
  if (!adminBox) return;

  const s = state();
  adminBox.innerHTML = `<h2>${t("adminReceipts")}</h2><p class="muted">Ações administrativas: comprovantes, e-mails e exclusão de entradas.</p>`;

  if (!s.entries.length) {
    adminBox.innerHTML += `<p class="muted">${t("noEntries")}</p>`;
    return;
  }

  s.entries.forEach(r => {
    const div = document.createElement("div");
    div.className = "receipt-item admin-entry-item";
    div.innerHTML = `<div><b>${escapeHtml(r.entryName)}</b><br><span class="muted">${escapeHtml(r.payerName)}${r.participantEmail ? " • " + escapeHtml(r.participantEmail) : ""}</span><br><span class="receipt-code">${receiptCode(r)}</span></div>
      <div class="receipt-actions">
        <button class="small-btn secondary" onclick="openReceipt('${r.id}')">${t("openReceipt")}</button>
        <button class="small-btn secondary" onclick="downloadReceiptPdf('${r.id}')">${t("receiptOpenPdf")}</button>
        <button class="small-btn secondary" onclick="downloadReceipt('${r.id}')">${t("downloadHtml")}</button>
        <button class="small-btn secondary" onclick="mailReceipt('${r.id}', 'participant')">${t("participantEmailBtn")}</button>
        <button class="small-btn secondary" onclick="mailReceipt('${r.id}', 'admin')">${t("adminEmailBtn")}</button>
        <button class="small-btn danger" onclick="deleteEntry('${r.id}')">${t("deleteEntry")}</button>
      </div>`;
    adminBox.appendChild(div);
  });
}

function renderAll() {
  renderRanking();
  renderReceipts();
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
  setupAdminLogin();
  setupAdminLogout();
  renderBracketForm();
  renderAll();
  applyLanguage();
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

    renderLatestReceipt(entry);

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
