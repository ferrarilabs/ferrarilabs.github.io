/* Bolão Copa do Brasil 2026 — app.js v3.0
   Vanilla JS IIFE, no framework, no build step.
   Modelo de fases dinâmicas — ver docs/bolao/CDB2026_RULES_AND_MODEL.md (fonte oficial do
   modelo, aprovada por Eduardo em 2026-07-13). Diferente do bracket fixo da Copa do Mundo:
   confrontos e partidas nascem do admin cadastrando o sorteio real de cada fase, não de um
   chaveamento pré-definido no código-fonte. Pontuação é por partida (nunca por um "agregado"
   digitado direto pelo participante — isso era o modelo antigo v2.x, incorreto para o formato
   real da Copa do Brasil). */
(function () {
"use strict";

// ─── Aliases ────────────────────────────────────────────────────────────────
const C    = window.CDB2026_CONFIG;
const DATA = window.CDB2026_DATA;
const $    = id => document.getElementById(id);
const $$   = sel => [...document.querySelectorAll(sel)];
const esc  = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── Toast ──────────────────────────────────────────────────────────────────
// Mesma implementação da Copa (bolao/js/app.js) — não-bloqueante, substitui alert() em toda
// confirmação/erro que não seja validação de formulário (essas continuam alert(), de propósito
// — ver DESIGN_SYSTEM.md "Alert").
function showToast(msg, type = "info", durationMs = 3500) {
  let container = document.querySelector(".bolao-toasts");
  if (!container) {
    container = document.createElement("div");
    container.className = "bolao-toasts";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `bolao-toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 320);
  }, durationMs);
}

// ─── i18n ───────────────────────────────────────────────────────────────────
const t = key => window.CDB2026_I18N?.["pt-BR"]?.[key] ?? key;
function applyI18n() {
  $$("[data-i18n]").forEach(el => { const v = t(el.dataset.i18n); if (v) el.textContent = v; });
}

// ─── State ──────────────────────────────────────────────────────────────────
let _editingEntry = null;
// IDs de entrada com o detalhe de palpites expandido no ranking — sobrevive a re-renders (sync,
// troca de idioma) até o usuário fechar. Mesmo padrão da Copa (bolao/js/app.js).
const _openRankDetails = new Set();

// Estado de uma fase dentro do estado dinâmico: cutoffAt (definido pelo admin ao cadastrar os
// confrontos da fase) + ties (confrontos reais, cadastrados conforme cada sorteio acontece —
// nunca inventados no código-fonte, ver data.js).
function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
function emptyState() {
  const phases = {};
  DATA.phases.forEach(p => { phases[p.id] = emptyPhaseState(); });
  return { entries: [], deletedIds: [], paid: {}, phases, meta: { updatedAt: null, version: C.siteVersion } };
}
function state() {
  try {
    const r = localStorage.getItem(C.storeKey);
    const s = r ? Object.assign(emptyState(), JSON.parse(r)) : emptyState();
    s.phases = s.phases && typeof s.phases === "object" ? s.phases : {};
    DATA.phases.forEach(p => {
      s.phases[p.id] = s.phases[p.id] && typeof s.phases[p.id] === "object" ? s.phases[p.id] : emptyPhaseState();
      s.phases[p.id].ties = s.phases[p.id].ties || {};
    });
    return s;
  } catch { return emptyState(); }
}
function saveState(s, opts = {}) {
  s.meta = s.meta || {};
  s.meta.updatedAt = new Date().toISOString();
  s.meta.version = C.siteVersion;
  localStorage.setItem(C.storeKey, JSON.stringify(s));
  if (C.database.enabled && !opts.localOnly) saveRemoteState(s).catch(() => {});
  renderAll();
}

// ─── Supabase ───────────────────────────────────────────────────────────────
async function loadRemoteState() {
  if (!C.database.enabled) return;
  try {
    const { url, anonKey, table, stateId } = C.database;
    const r = await fetch(`${url}/rest/v1/${table}?id=eq.${stateId}&select=state`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data?.[0]?.state) return;
    const merged = mergeStates(state(), data[0].state, { preferRemoteResults: true });
    localStorage.setItem(C.storeKey, JSON.stringify(merged));
  } catch (err) { console.warn("[CDB2026] Supabase load failed", err); }
}
async function saveRemoteState(s) {
  if (!C.database.enabled) return;
  const { url, anonKey, table, stateId } = C.database;
  await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: stateId, state: s })
  });
}
// Merge de fases: para cada fase, cutoffAt e ties são mesclados independentemente — união de
// ties por id (nunca perde um confronto cadastrado em qualquer lado), remote-wins em cutoffAt e
// no conteúdo de cada tie já existente por padrão (mesma regra dos resultados oficiais na
// Copa/BR2026 — o admin/Supabase é fonte de verdade para resultado real).
function mergeStates(local, remote, opts = {}) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  const byId = {};
  [...(remote.entries || []), ...(local.entries || [])].forEach(e => { if (!deleted.has(e.id)) byId[e.id] = e; });
  const paid = { ...(remote.paid || {}), ...(local.paid || {}) };
  const phases = {};
  DATA.phases.forEach(p => {
    const localP  = local.phases?.[p.id]  || emptyPhaseState();
    const remoteP = remote.phases?.[p.id] || emptyPhaseState();
    const ties = opts.preferRemoteResults
      ? { ...localP.ties, ...remoteP.ties }
      : { ...remoteP.ties, ...localP.ties };
    const cutoffAt = opts.preferRemoteResults
      ? (remoteP.cutoffAt ?? localP.cutoffAt)
      : (localP.cutoffAt ?? remoteP.cutoffAt);
    phases[p.id] = { cutoffAt, ties };
  });
  return {
    entries: Object.values(byId),
    deletedIds: [...deleted],
    paid,
    phases,
    meta: (local.meta?.updatedAt || "") > (remote.meta?.updatedAt || "") ? local.meta : remote.meta,
  };
}

// ─── Admin auth ─────────────────────────────────────────────────────────────
async function sha256hex(msg) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
let _loginAttempts  = Number(sessionStorage.getItem("cdb2026_loginAttempts") || 0);
let _loginLockUntil = Number(sessionStorage.getItem("cdb2026_loginLockUntil") || 0);

function isAdminActive() { return Number(sessionStorage.getItem("cdb2026_adminUntil") || 0) > Date.now(); }
function guardAdmin() { if (isAdminActive()) return true; showSection("admin"); return false; }

// ─── Sections ───────────────────────────────────────────────────────────────
function showSection(id) {
  $$(".page").forEach(p => p.classList.toggle("active", p.id === id));
  $$(".nav button[data-section]").forEach(b => b.classList.toggle("active", b.dataset.section === id));
  const h = document.querySelector(`#${id} h2, #${id} h3`);
  if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: false }); }
  if (id === "admin") renderAdmin();
  if (id === "games") renderGamesSection();
  if (id === "probs") renderProbsSection();
}

// ─── Cutoff ─────────────────────────────────────────────────────────────────
// Não existe mais um cutoff único global (era um resquício do modelo antigo de bracket fixo —
// ver CDB2026_RULES_AND_MODEL.md). Cada FASE tem seu próprio cutoffAt, definido pelo admin ao
// cadastrar os confrontos daquela fase. O único uso "global" que resta é bloquear a CRIAÇÃO de
// entradas novas depois que a 1ª Fase já fechou — editar uma entrada existente continua
// funcionando fase a fase, cada confronto usa o cutoff da própria fase.
function fase1CutoffMs() {
  const c = state().phases?.["fase-1"]?.cutoffAt;
  return c ? new Date(c).getTime() : null;
}
function isPastFase1Cutoff() {
  const ms = fase1CutoffMs();
  return ms !== null && Date.now() > ms;
}
function isPhaseLocked(phaseState) {
  return !!phaseState?.cutoffAt && Date.now() > new Date(phaseState.cutoffAt).getTime();
}
function fase1Complete(s) {
  const ties = Object.values(s.phases?.["fase-1"]?.ties || {});
  return ties.length > 0 && ties.every(tie => tie.qualifiedTeamId);
}

// ─── Receipt code ───────────────────────────────────────────────────────────
// Mesmo algoritmo (FNV-32, não criptográfico, só identificação) e formato usado na Copa do
// Mundo (hashString/receiptCode em bolao/js/app.js) — padrão compartilhado da plataforma.
function hashString(str) {
  let h = 2166136261;
  for (const cp of str) { h ^= cp.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
function receiptCode(e) {
  return `CDB2026-${hashString(JSON.stringify({ n: e.entryName, t: e.createdAt }))}-${String(e.createdAt || "").slice(0, 10).replace(/-/g, "")}`;
}
// Edição própria da entrada exige e-mail + código do comprovante (não só o e-mail) — o
// comprovante só é conhecido por quem criou a entrada, o e-mail sozinho não é um segredo real.
function findEntryByEmailAndCode(email, code) {
  const s = state();
  const deleted = new Set(s.deletedIds || []);
  const norm = v => String(v || "").trim().toLowerCase();
  return (s.entries || []).find(e =>
    !deleted.has(e.id) &&
    norm(e.participantEmail) === norm(email) &&
    receiptCode(e).toUpperCase() === norm(code).toUpperCase()
  ) || null;
}

// ─── UUID ───────────────────────────────────────────────────────────────────
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

// ─── Team logo ──────────────────────────────────────────────────────────────
// Escudo real do time (ESPN CDN, DATA.teamLogos). Cobre os clubes mais prováveis de chegar às
// fases finais — um time cadastrado pelo admin que não estiver no dicionário simplesmente não
// mostra escudo (fallback gracioso, não é erro — a Copa do Brasil tem 126 clubes, muitos de
// divisões sem CDN de escudo conhecida).
function teamLogoImg(team, cls) {
  const url = DATA.teamLogos?.[team];
  if (!url) return "";
  return `<img src="${esc(url)}" class="${cls || "team-logo"}" alt="" aria-hidden="true">`;
}

// ─── Payment icon ───────────────────────────────────────────────────────────
const PAY_ICON_SVG = { CashApp: "assets/cashapp.svg", Zelle: "assets/zelle.svg", Venmo: "assets/venmo.svg" };
function payIcon(method) {
  const src = PAY_ICON_SVG[method];
  return src ? `<img src="${esc(src)}" alt="${esc(method)}" class="pay-method-icon">` : "💳";
}

// ─── Phase / tie / match helpers ────────────────────────────────────────────
function getPhaseDef(phaseId) { return DATA.phases.find(p => p.id === phaseId); }
function legsForFormat(format) { return format === "TWO_LEG" ? ["first", "second"] : ["single"]; }
function emptyMatch() { return { homeTeam: null, awayTeam: null, kickoff: null, venue: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" }; }

// Agregado de um confronto de ida+volta a partir das duas partidas — null se alguma ainda não
// tem placar. O mandante se inverte na volta (regra real do mata-mata): teamA soma seus gols
// como mandante da ida + visitante da volta; teamB o inverso.
function aggregateFromMatches(matches) {
  const first = matches?.first, second = matches?.second;
  if (!first || first.goalsHome == null || first.goalsAway == null) return null;
  if (!second || second.goalsHome == null || second.goalsAway == null) return null;
  return { totalA: first.goalsHome + second.goalsAway, totalB: first.goalsAway + second.goalsHome };
}
// Mesmo cálculo, mas a partir de um palpite (goalsHome/goalsAway "crus", ainda não gravados como
// Match) — usado tanto na pré-visualização ao vivo do formulário de palpite quanto na validação.
function predictedAggFromPicks(format, matchPicks) {
  if (format !== "TWO_LEG") {
    const m = matchPicks.single;
    return m ? { totalA: m.goalsHome, totalB: m.goalsAway } : null;
  }
  const first = matchPicks.first, second = matchPicks.second;
  if (!first || !second) return null;
  return { totalA: first.goalsHome + second.goalsAway, totalB: first.goalsAway + second.goalsHome };
}

// ─── Podium (campeão/vice) a partir da Final ────────────────────────────────
// A Final é sempre partida única com exatamente 1 confronto — campeão é o time classificado
// oficialmente, vice é o outro. Diferente da Copa do Mundo, não existe cascata de fases
// anteriores aqui: cada fase é palpitada e resolvida de forma independente, porque a Copa do
// Brasil sorteia os confrontos reais a cada fase (não é um chaveamento fixo e previsível).
function finalTieEntry(s) {
  const finalTies = s.phases?.final?.ties || {};
  const tieId = Object.keys(finalTies)[0];
  return tieId ? { tieId, tie: finalTies[tieId] } : null;
}
function officialPodium(s) {
  const f = finalTieEntry(s);
  if (!f || !f.tie.qualifiedTeamId) return { champion: null, runnerUp: null };
  const { tie } = f;
  return {
    champion: tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB,
    runnerUp: tie.qualifiedTeamId === "A" ? tie.teamB : tie.teamA,
  };
}
function predictedPodium(entry, s) {
  const f = finalTieEntry(s);
  if (!f) return { champion: null, runnerUp: null };
  const pick = entry.picks?.qualified?.[f.tieId];
  if (!pick) return { champion: null, runnerUp: null };
  const { tie } = f;
  return {
    champion: pick === "A" ? tie.teamA : tie.teamB,
    runnerUp: pick === "A" ? tie.teamB : tie.teamA,
  };
}

// ─── Per-tie picks (palpite por partida) ────────────────────────────────────
function getPickValues() {
  const picks = {
    matches:   { ...(_editingEntry?.picks?.matches   || {}) },
    qualified: { ...(_editingEntry?.picks?.qualified || {}) },
  };
  $$(".tie-pick-block.open").forEach(block => {
    const tieId  = block.dataset.tieId;
    const format = block.dataset.format;
    const legs   = legsForFormat(format);
    const matchPicks = {};
    let anyFilled = false;
    legs.forEach(leg => {
      const a = block.querySelector(`.pk-goals-home[data-leg="${leg}"]`)?.value;
      const b = block.querySelector(`.pk-goals-away[data-leg="${leg}"]`)?.value;
      if (a === "" && b === "") return;
      anyFilled = true;
      matchPicks[leg] = { goalsHome: parseInt(a, 10), goalsAway: parseInt(b, 10) };
    });
    const qual = block.querySelector(".pk-qualified")?.value || "";
    if (!anyFilled && !qual) { delete picks.matches[tieId]; delete picks.qualified[tieId]; return; }
    picks.matches[tieId] = matchPicks;
    if (qual) picks.qualified[tieId] = qual; else delete picks.qualified[tieId];
  });
  return picks;
}

// ─── Validation ──────────────────────────────────────────────────────────────
function validatePicks(picks) {
  const errors = [];
  $$(".tie-pick-block.open").forEach(block => {
    const tieId  = block.dataset.tieId;
    const format = block.dataset.format;
    const legs   = legsForFormat(format);
    const matchPicks = picks.matches[tieId] || {};
    legs.forEach(leg => {
      const m = matchPicks[leg];
      if (!m || !Number.isFinite(m.goalsHome) || !Number.isFinite(m.goalsAway) ||
          m.goalsHome < 0 || m.goalsHome > 20 || m.goalsAway < 0 || m.goalsAway > 20) {
        errors.push(t("errorPicksIncomplete"));
      }
    });
    const agg = predictedAggFromPicks(format, matchPicks);
    if (agg && agg.totalA === agg.totalB && !picks.qualified[tieId]) {
      errors.push(t("errorAdvanceRequired"));
    }
  });
  return [...new Set(errors)];
}

// ─── Render: pick form ───────────────────────────────────────────────────────
function renderPickForm() {
  const s    = state();
  const form = $("pickForm");
  if (!form) return;

  let html = "";
  DATA.phases.forEach(phase => {
    const phaseState = s.phases?.[phase.id] || emptyPhaseState();
    const ties = Object.entries(phaseState.ties || {});
    html += `<div class="pick-group">
      <div class="pick-group-header champion-header">${esc(phase.name)}</div>`;
    if (!ties.length) {
      html += `<p class="muted small-text">${esc(t("waitingDraw"))}</p></div>`;
      return;
    }
    ties.forEach(([tieId, tie]) => {
      if (!tie.teamA || !tie.teamB) return;
      const savedMatches = _editingEntry?.picks?.matches?.[tieId] || {};
      const savedQual    = _editingEntry?.picks?.qualified?.[tieId] || "";

      if (tie.qualifiedTeamId) {
        const winner = tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB;
        html += `<div class="pick-row tie-row locked" id="tie-${esc(tieId)}">
          <div class="tie-locked-note"><span class="tie-locked-score">${esc(tie.teamA)} ${teamLogoImg(tie.teamA)} × ${teamLogoImg(tie.teamB)} ${esc(tie.teamB)} — ${esc(t("gamesAdvances"))}: <b>${esc(winner)}</b></span></div>
        </div>`;
        return;
      }
      if (isPhaseLocked(phaseState)) {
        html += `<div class="pick-row tie-row locked" id="tie-${esc(tieId)}">
          <div class="tie-locked-note"><span class="tie-locked-score">${esc(tie.teamA)} ${teamLogoImg(tie.teamA)} <span class="muted">${esc(t("pickNotSubmitted"))}</span> ${teamLogoImg(tie.teamB)} ${esc(tie.teamB)}</span></div>
        </div>`;
        return;
      }

      const legs = legsForFormat(phase.format);
      const legInputs = legs.map(leg => {
        const home = leg === "second" ? tie.teamB : tie.teamA;
        const away = leg === "second" ? tie.teamA : tie.teamB;
        const label = leg === "single" ? "" : leg === "first" ? t("gamesLeg1") : t("gamesLeg2");
        const saved = savedMatches[leg];
        const gA = saved?.goalsHome ?? "", gB = saved?.goalsAway ?? "";
        return `<div class="tie-leg-pick">
          ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
          <div class="tie-inputs">
            <span class="tie-team-name">${esc(home)}</span>
            ${teamLogoImg(home)}
            <input type="number" min="0" max="20" class="pk-goals-home" data-leg="${leg}" value="${esc(gA)}" aria-label="${esc(t("pickAggScoreA"))} ${esc(home)}">
            <span class="tie-x">×</span>
            <input type="number" min="0" max="20" class="pk-goals-away" data-leg="${leg}" value="${esc(gB)}" aria-label="${esc(t("pickAggScoreB"))} ${esc(away)}">
            ${teamLogoImg(away)}
            <span class="tie-team-name">${esc(away)}</span>
          </div>
        </div>`;
      }).join("");
      const aggBlock = phase.format === "TWO_LEG"
        ? `<div class="pick-pts-hint">${esc(t("aggregatePreview"))}: <b class="pk-agg-value">—</b></div>`
        : "";

      html += `<div class="pick-row tie-row open tie-pick-block open" id="tie-${esc(tieId)}" data-tie-id="${esc(tieId)}" data-format="${esc(phase.format)}">
        ${legInputs}
        ${aggBlock}
        <select class="pk-qualified" aria-label="${esc(t("pickAdvanceLabel"))}">
          <option value="">${esc(t("pickSelectAdvance"))}</option>
          <option value="A" ${savedQual === "A" ? "selected" : ""}>${esc(tie.teamA)}</option>
          <option value="B" ${savedQual === "B" ? "selected" : ""}>${esc(tie.teamB)}</option>
        </select>
        <span class="pick-pts-hint">${esc(t("pickHintTie"))}</span>
      </div>`;
    });
    html += `</div>`;
  });

  form.innerHTML = html || `<p class="muted">${esc(t("pickNoOpenTies"))}</p>`;

  // Agregado previsto recalcula ao vivo enquanto o participante digita; "quem se classifica"
  // trava automaticamente quando o agregado previsto não empata (mesma regra da CBF real: só
  // faz sentido escolher manualmente quando o resultado seria decidido nos pênaltis).
  form.querySelectorAll(".tie-pick-block.open").forEach(block => {
    const format    = block.dataset.format;
    const qualSel    = block.querySelector(".pk-qualified");
    const aggValueEl = block.querySelector(".pk-agg-value");
    const update = () => {
      const legs = legsForFormat(format);
      const matchPicks = {};
      let complete = true;
      legs.forEach(leg => {
        const a = block.querySelector(`.pk-goals-home[data-leg="${leg}"]`)?.value;
        const b = block.querySelector(`.pk-goals-away[data-leg="${leg}"]`)?.value;
        if (a === "" || b === "") { complete = false; return; }
        matchPicks[leg] = { goalsHome: parseInt(a, 10), goalsAway: parseInt(b, 10) };
      });
      const agg = complete ? predictedAggFromPicks(format, matchPicks) : null;
      if (aggValueEl) aggValueEl.textContent = agg ? `${agg.totalA} × ${agg.totalB}` : "—";
      if (!agg) { qualSel.disabled = false; return; }
      if (agg.totalA === agg.totalB) {
        qualSel.disabled = false;
      } else {
        qualSel.value = agg.totalA > agg.totalB ? "A" : "B";
        qualSel.disabled = true;
      }
    };
    block.querySelectorAll(".pk-goals-home, .pk-goals-away").forEach(el => el.addEventListener("input", update));
    update(); // sincroniza travado/destravado ao carregar (inclusive editando entrada já salva)
  });
}

// ─── Save entry ──────────────────────────────────────────────────────────────
async function saveEntry() {
  if (isPastFase1Cutoff() && !_editingEntry) { showToast(t("closed"), "warn"); return; }
  const entryName     = $("entryName")?.value.trim() || "";
  const payerName     = $("payerName")?.value.trim() || "";
  const email         = $("participantEmail")?.value.trim() || "";
  const paymentMethod = $("paymentMethod")?.value || "";

  if (!entryName) { alert(t("errorEntryName")); return; }
  if (!email || !email.includes("@")) { alert(t("errorEmail")); return; }

  const picks  = getPickValues();
  const errors = validatePicks(picks);
  if (errors.length) { alert(errors.join("\n")); return; }

  const btn = $("saveEntryBtn");
  if (btn) { btn.disabled = true; btn.textContent = t("saving"); }

  try {
    const wasNew = !_editingEntry;
    const s   = state();
    const now = new Date().toISOString();
    const entry = _editingEntry
      ? { ..._editingEntry, entryName, payerName, participantEmail: email, paymentMethod, picks, updatedAt: now }
      : { id: uuid(), entryName, payerName, participantEmail: email, paymentMethod, picks, createdAt: now };

    if (_editingEntry) {
      const idx = s.entries.findIndex(e => e.id === entry.id);
      if (idx >= 0) s.entries[idx] = entry; else s.entries.push(entry);
    } else {
      s.entries.push(entry);
    }

    saveState(s);

    if (C.emailjs.enabled && window.emailjs) {
      sendReceipt(entry).catch(err => console.warn("[CDB2026] Email failed", err));
    }

    _editingEntry = null;
    renderPickForm();
    ["entryName", "payerName", "participantEmail"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    $("paymentMethod") && ($("paymentMethod").value = "");

    renderReceiptBox(entry);
    showToast(t("savedSuccess"), "success");
    if (!wasNew) showSection("ranking");
  } catch (err) {
    console.error("[CDB2026] Save error", err);
    showToast(t("saveError"), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("saveEntry"); }
  }
}

// ─── Receipt box ────────────────────────────────────────────────────────────
function renderReceiptBox(entry) {
  const box = $("receiptBox");
  if (!box) return;
  const code = receiptCode(entry);
  box.classList.remove("hidden");
  box.innerHTML = `
    <h3>${esc(t("receiptTitle"))}</h3>
    <p>${esc(t("receiptCodeLabel"))}: <code class="receipt-code">${esc(code)}</code></p>
    <p class="muted" style="font-size:12px">${esc(t("receiptSaveHint"))}</p>`;
}

// ─── Scoring ────────────────────────────────────────────────────────────────
// Pontuação por partida, mutuamente exclusiva (nunca soma exact+result+side na mesma partida) —
// mesmo espírito da Copa do Mundo (matchPoints/scoreEntry em bolao/js/app.js), aplicada aqui a
// cada partida individual (não a um agregado digitado direto — ver CDB2026_RULES_AND_MODEL.md).
function matchPoints(pick, result) {
  if (!pick || !result || result.goalsHome == null || result.goalsAway == null) return null;
  const sc = C.scoring.match;
  if (pick.goalsHome === result.goalsHome && pick.goalsAway === result.goalsAway) {
    return { pts: sc.exact, type: "exact" };
  }
  const pickSign = Math.sign(pick.goalsHome - pick.goalsAway);
  const realSign = Math.sign(result.goalsHome - result.goalsAway);
  if (pickSign === realSign) return { pts: sc.result, type: "result" };
  let pts = 0;
  if (pick.goalsHome === result.goalsHome) pts += sc.side;
  if (pick.goalsAway === result.goalsAway) pts += sc.side;
  return { pts, type: pts > 0 ? "side" : "miss" };
}

function scoreEntry(entry, s) {
  const sc = C.scoring;
  let total = 0;
  const detail = { matches: {}, ties: {} };

  DATA.phases.forEach(phase => {
    const ties = s.phases?.[phase.id]?.ties || {};
    Object.entries(ties).forEach(([tieId, tie]) => {
      const legs = legsForFormat(phase.format);
      const pickMatches = entry.picks?.matches?.[tieId] || {};
      legs.forEach(leg => {
        const r = matchPoints(pickMatches[leg], tie.matches?.[leg]);
        if (!r) return;
        detail.matches[`${tieId}:${leg}`] = r;
        total += r.pts;
      });
      if (tie.qualifiedTeamId) {
        const pickQual = entry.picks?.qualified?.[tieId];
        if (pickQual) {
          const hit = pickQual === tie.qualifiedTeamId;
          detail.ties[tieId] = { pts: hit ? sc.tieBonus : 0, type: hit ? "hit" : "miss" };
          total += detail.ties[tieId].pts;
        }
      }
    });
  });

  const official  = officialPodium(s);
  const predicted = predictedPodium(entry, s);
  if (official.champion && predicted.champion) {
    const hit = predicted.champion === official.champion;
    detail.champion = { pts: hit ? sc.bonus.champion : 0, type: hit ? "exact" : "miss" };
    total += detail.champion.pts;
  }
  if (official.runnerUp && predicted.runnerUp) {
    const hit = predicted.runnerUp === official.runnerUp;
    detail.runnerUp = { pts: hit ? sc.bonus.runnerUp : 0, type: hit ? "exact" : "miss" };
    total += detail.runnerUp.pts;
  }

  return { total, detail };
}
function getActiveScore(entry, s) { return scoreEntry(entry, s); }

function resultsProgress(s) {
  let done = 0, totalTies = 0;
  DATA.phases.forEach(phase => {
    const ties = Object.values(s.phases?.[phase.id]?.ties || {});
    totalTies += ties.length;
    done += ties.filter(tie => tie.qualifiedTeamId).length;
  });
  return { done, totalTies };
}

function renderFindEntryCard() {
  const card = $("findEntryCard");
  if (!card) return;
  card.classList.toggle("hidden", !fase1Complete(state()));
}

// ─── Tiebreaker helpers ──────────────────────────────────────────────────────
function hitChampion(detail) { return detail?.champion?.type === "exact" ? 1 : 0; }
function hitRunnerUp(detail) { return detail?.runnerUp?.type === "exact" ? 1 : 0; }
function countExactMatches(detail) { return Object.values(detail?.matches || {}).filter(d => d.type === "exact").length; }

// ─── Email receipt ───────────────────────────────────────────────────────────
let _lastEmailTs = 0;
async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  const now = Date.now();
  if (now - _lastEmailTs < C.emailjs.limitRateMs) return;

  const s = state();
  const rows = [];
  DATA.phases.forEach(phase => {
    Object.entries(s.phases?.[phase.id]?.ties || {}).forEach(([tieId, tie]) => {
      if (!tie.teamA || !tie.teamB) return;
      const pickMatches = entry.picks?.matches?.[tieId];
      if (!pickMatches) return;
      legsForFormat(phase.format).forEach(leg => {
        const pick = pickMatches[leg];
        if (!pick) return;
        const legLabel = leg === "single" ? "" : leg === "first" ? " (ida)" : " (volta)";
        rows.push(`<tr><td>${esc(tie.teamA)} × ${esc(tie.teamB)}${legLabel}</td><td>${pick.goalsHome} × ${pick.goalsAway}</td></tr>`);
      });
    });
  });
  const predicted = predictedPodium(entry, s);
  const podiumHtml = `
    <p><b>${esc(t("receiptCodeLabel"))}:</b> <code>${esc(receiptCode(entry))}</code></p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><th>Palpite</th><th>Time</th></tr>
      <tr><td>🏆 Campeão</td><td>${esc(predicted.champion || "—")}</td></tr>
      <tr><td>🥈 Vice-campeão</td><td>${esc(predicted.runnerUp || "—")}</td></tr>
    </table>`;
  const picksHtml = `
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:10px">
      <tr><th>Partida</th><th>Placar palpitado</th></tr>
      ${rows.join("") || `<tr><td colspan="2">—</td></tr>`}
    </table>`;

  const params = {
    to_email:    entry.participantEmail,
    to_name:     entry.entryName,
    entry_name:  entry.entryName,
    html_message: `<h2>Bolão Copa do Brasil 2026 — Comprovante</h2>
      <p>Entrada: <strong>${esc(entry.entryName)}</strong></p>
      ${podiumHtml}
      ${picksHtml}
      <p style="color:#888;font-size:12px">Versão: ${esc(C.siteVersion)} · ${esc(new Date().toISOString())}</p>`
  };

  try {
    await window.emailjs.send(C.emailjs.serviceId, C.emailjs.participantTemplateId, params, C.emailjs.publicKey);
    _lastEmailTs = Date.now();
    if (C.adminEmail) {
      await window.emailjs.send(C.emailjs.serviceId, C.emailjs.adminTemplateId, {
        ...params,
        to_email: C.adminEmail,
        html_message: `<p>Nova entrada: <strong>${esc(entry.entryName)}</strong> (${esc(entry.participantEmail)})</p>${podiumHtml}${picksHtml}`
      }, C.emailjs.publicKey);
    }
  } catch (err) {
    console.error("[CDB2026] sendReceipt failed:", err);
  }
}

// ─── Countdown ───────────────────────────────────────────────────────────────
function renderCountdown() {
  const box = $("cutoffCountdown");
  if (!box) return;
  const ms = fase1CutoffMs();
  if (ms === null) {
    box.innerHTML = `<div class="count-label">${esc(t("countdownTitle"))}</div><span class="count-closed">${esc(t("waitingDraw"))}</span>`;
    return;
  }
  const diff = ms - Date.now();
  if (diff <= 0) {
    box.innerHTML = `<span class="count-closed">${esc(t("closedLabel"))}</span>`;
    return;
  }
  const d  = Math.floor(diff / 86400000);
  const h  = Math.floor((diff % 86400000) / 3600000);
  const m  = Math.floor((diff % 3600000) / 60000);
  const s  = Math.floor((diff % 60000) / 1000);
  const p2 = n => String(n).padStart(2, "0");
  box.innerHTML = `
    <div class="count-label">${esc(t("countdownTitle"))}</div>
    <div class="count-grid">
      ${d > 0 ? `<div><b>${d}</b><span>${esc(t("countdownDays"))}</span></div>` : ""}
      <div><b>${p2(h)}</b><span>${esc(t("countdownHours"))}</span></div>
      <div><b>${p2(m)}</b><span>${esc(t("countdownMin"))}</span></div>
      <div><b>${p2(s)}</b><span>${esc(t("countdownSec"))}</span></div>
    </div>`;
}

// ─── Render: ranking ─────────────────────────────────────────────────────────
function renderRanking() {
  const box = $("rankingList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));

  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }

  const scored = entries.map(e => {
    const sc = getActiveScore(e, s) || { total: 0, detail: null };
    return { e, ...sc };
  }).sort((a, b) =>
    b.total - a.total ||
    hitChampion(b.detail) - hitChampion(a.detail) ||
    hitRunnerUp(b.detail) - hitRunnerUp(a.detail) ||
    countExactMatches(b.detail) - countExactMatches(a.detail) ||
    b.e.entryName.localeCompare(a.e.entryName, "pt-BR")
  );

  const { done, totalTies } = resultsProgress(s);
  const provNote = totalTies > 0 && done < totalTies
    ? `<p class="prov-note">↕ ${esc(t("provisionalNote"))}</p>` : "";

  let rank = 0, prevPts = -1;
  box.innerHTML = provNote;
  scored.forEach((item, i) => {
    if (item.total !== prevPts) { rank = i + 1; prevPts = item.total; }
    const paid      = (s.paid || {})[item.e.id];
    const medal     = { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `${rank}.`;
    const paidBadge = paid
      ? `<span class="paid-badge">${esc(t("paid"))}</span>`
      : `<span class="unpaid-badge">${esc(t("unpaid"))}</span>`;
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
      <div class="rank-pos">${medal}</div>
      <div><b>${esc(item.e.entryName)}</b> ${paidBadge}</div>
      <div class="points">${item.total}<small> pts</small></div>
      <button type="button" class="secondary small-btn" data-rank-toggle="${esc(item.e.id)}" aria-label="${esc(t("viewPicks"))} — ${esc(item.e.entryName || "")}">${esc(t("viewPicks"))}</button>`;
    box.appendChild(row);
    const detail = document.createElement("div");
    detail.className = `card picks-detail${_openRankDetails.has(item.e.id) ? "" : " hidden"}`;
    detail.dataset.rankDetail = item.e.id;
    detail.innerHTML = renderPickDisplay(item.e, item.detail);
    box.appendChild(detail);
  });

  box.querySelectorAll("[data-rank-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const id  = btn.dataset.rankToggle;
    const det = box.querySelector(`[data-rank-detail="${id}"]`);
    if (!det) return;
    det.classList.toggle("hidden");
    if (det.classList.contains("hidden")) _openRankDetails.delete(id);
    else _openRankDetails.add(id);
  }));
}

function renderPickDisplay(entry, detail) {
  const s = state();
  const rows = [];
  DATA.phases.forEach(phase => {
    Object.entries(s.phases?.[phase.id]?.ties || {}).forEach(([tieId, tie]) => {
      if (!tie.teamA || !tie.teamB) return;
      const pickMatches = entry.picks?.matches?.[tieId];
      if (!pickMatches) return;
      legsForFormat(phase.format).forEach(leg => {
        const pick = pickMatches[leg];
        if (!pick) return;
        const d = detail?.matches?.[`${tieId}:${leg}`];
        const legLabel = leg === "single" ? "" : ` — ${leg === "first" ? esc(t("gamesLeg1")) : esc(t("gamesLeg2"))}`;
        const cls = d ? (d.type === "exact" ? "pick-exact" : d.type === "miss" ? "pick-miss" : "pick-partial") : "";
        const badge = d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : "";
        rows.push(`<div class="pick-item">
          <span class="pick-pos-lbl">${esc(tie.teamA)} × ${esc(tie.teamB)}${legLabel}</span>
          <div class="pick-cell ${cls}">${pick.goalsHome} × ${pick.goalsAway}${badge}</div>
        </div>`);
      });
      const pickQual = entry.picks?.qualified?.[tieId];
      if (tie.qualifiedTeamId && pickQual) {
        const d = detail?.ties?.[tieId];
        const teamName = pickQual === "A" ? tie.teamA : tie.teamB;
        const cls = d?.type === "hit" ? "pick-exact" : "pick-miss";
        const badge = d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : "";
        rows.push(`<div class="pick-item">
          <span class="pick-pos-lbl">${esc(t("pickQualifiedLabel"))}: ${teamLogoImg(teamName)} ${esc(teamName)}</span>
          <div class="pick-cell ${cls}">${badge}</div>
        </div>`);
      }
    });
  });

  const predicted = predictedPodium(entry, s);
  const bonusRow = (label, team, d) => team
    ? `<div class="pick-item"><span class="pick-pos-lbl">${esc(label)}: ${teamLogoImg(team)} ${esc(team)}</span><div class="pick-cell ${d ? (d.type === "exact" ? "pick-exact" : "pick-miss") : ""}">${d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : ""}</div></div>`
    : "";

  return `<div class="picks-display cdb-picks">
    ${bonusRow("🏆 " + t("pickLabelChampion"), predicted.champion, detail?.champion)}
    ${bonusRow("🥈 " + t("pickLabelRunnerUp"), predicted.runnerUp, detail?.runnerUp)}
    ${rows.join("") || `<p class="muted">${esc(t("pickNoOpenTies"))}</p>`}
  </div>`;
}

// ─── Render: participants ─────────────────────────────────────────────────────
function renderParticipants() {
  const box = $("participantsList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }
  const total = entries.length;
  const paid  = entries.filter(e => (s.paid || {})[e.id]).length;
  const pot   = (total * C.entryFee).toFixed(0);
  box.innerHTML = `
    <div class="participants-stats">
      <span>${total} entradas</span>
      <span>${paid} pagas</span>
      <span>Pot: US$ ${pot}</span>
    </div>
    ${entries.map(e => {
      const isPaid = (s.paid || {})[e.id];
      return `<div class="participant-row">
        <span>${esc(e.entryName)}</span>
        <span class="muted">${esc(e.payerName || "")}</span>
        <span class="${isPaid ? "paid-badge" : "unpaid-badge"}">${esc(isPaid ? t("paid") : t("unpaid"))}</span>
      </div>`;
    }).join("")}`;
}

// ─── Render: payment ─────────────────────────────────────────────────────────
function renderPayment() {
  const box = $("paymentMethods");
  if (!box) return;
  box.innerHTML = Object.entries(C.paymentMethods).map(([method, handle]) => {
    const link = C.paymentLinks?.[method];
    const qr   = method === "Zelle" && C.zelle?.qrImage
      ? `<img src="${esc(C.zelle.qrImage)}" alt="QR Zelle" class="pay-qr">` : "";
    return `<div class="card pay-card">
      <div class="pay-icon">${payIcon(method)}</div>
      <div>
        <strong>${esc(method)}</strong><br>
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(handle)}</a>` : `<span>${esc(handle)}</span>`}
        ${qr}
      </div>
    </div>`;
  }).join("");
}

// ─── Render: rules ───────────────────────────────────────────────────────────
function renderRules() {
  const box = $("rulesContent");
  if (!box) return;
  const sc = C.scoring;
  const pr = C.prizes;
  box.innerHTML = `
    <div class="card">
      <h3>${esc(t("rulesScoring"))}</h3>
      <table class="rules-table">
        <thead><tr><th>${esc(t("rulesAcerto"))}</th><th>${esc(t("rulesPts"))}</th></tr></thead>
        <tbody>
          <tr><td>${esc(t("rulesMatchExact"))}</td><td><b>${sc.match.exact}</b></td></tr>
          <tr><td>${esc(t("rulesMatchResult"))}</td><td><b>${sc.match.result}</b></td></tr>
          <tr><td>${esc(t("rulesMatchSide"))}</td><td><b>${sc.match.side}</b> por lado</td></tr>
          <tr><td>${esc(t("rulesTieBonus"))}</td><td><b>${sc.tieBonus}</b></td></tr>
          <tr><td>🏆 Campeão</td><td><b>${sc.bonus.champion}</b></td></tr>
          <tr><td>🥈 Vice-campeão</td><td><b>${sc.bonus.runnerUp}</b></td></tr>
        </tbody>
      </table>
      <p class="muted small-text">${esc(t("rulesScoreNote"))}</p>
      <h3>${esc(t("tbTitle"))}</h3>
      <ol style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.8">
        <li>${esc(t("tbChampion"))}</li>
        <li>${esc(t("tbRunnerUp"))}</li>
        <li>${esc(t("tbExactTies"))}</li>
        <li>${esc(t("tbAlpha"))}</li>
      </ol>
    </div>
    <div class="card">
      <h3>${esc(t("rulesFormat"))}</h3>
      <p style="font-size:13px">${esc(t("rulesFormatText"))}</p>
      <p style="font-size:13px">${esc(t("rulesPenaltyText"))}</p>
      <p style="font-size:13px">${esc(t("rulesNoAwayGoalsText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesExampleTwoLegTitle"))}</h3>
      <p style="font-size:13px">${esc(t("rulesExampleTwoLegText"))}</p>
      <h3>${esc(t("rulesExampleSingleTitle"))}</h3>
      <p style="font-size:13px">${esc(t("rulesExampleSingleText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesPrizes"))}</h3>
      <table class="rules-table">
        <thead><tr><th>Posição</th><th>% do pot</th></tr></thead>
        <tbody>
          <tr><td>🥇 1º</td><td>${Math.round(pr.first * 100)}%</td></tr>
          <tr><td>🥈 2º</td><td>${Math.round(pr.second * 100)}%</td></tr>
          <tr><td>🥉 3º</td><td>${Math.round(pr.third * 100)}%</td></tr>
        </tbody>
      </table>
      <p class="muted" style="font-size:12px">Entrada: US$ ${C.entryFee}. Pot proporcional ao número de participantes.</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesCutoff"))}</h3>
      <p style="font-size:13px">${esc(t("rulesCutoffText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesTransparency"))}</h3>
      <p class="muted" style="font-size:12px">${esc(C.transparency.disclaimer)}</p>
    </div>`;
}

// ─── Probabilidades — estimativa por confronto já sorteado ──────────────────
// Mesma matemática (Poisson bivariado + correção Dixon-Coles) usada em bolao/js/app.js (Copa)
// e bolao/br2026/js/app.js (Brasileirão). Diferente do modelo antigo: itera os confrontos
// DINÂMICOS já cadastrados pelo admin (não um bracket fixo) e cobre tanto partida única quanto
// ida+volta, já que a Copa do Brasil tem os dois formatos dependendo da fase.
function poisson(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
function tauDC(x, y, lA, lB, rho) {
  if (x === 0 && y === 0) return 1 - lA * lB * rho;
  if (x === 0 && y === 1) return 1 + lA * rho;
  if (x === 1 && y === 0) return 1 + lB * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
function matchProb(lambdaHome, lambdaAway) {
  const MAX = 8, RHO = -0.13;
  const grid = [];
  let pA = 0, pD = 0, pB = 0;
  for (let i = 0; i <= MAX; i++) {
    grid[i] = [];
    for (let j = 0; j <= MAX; j++) {
      const p = poisson(lambdaHome, i) * poisson(lambdaAway, j) * tauDC(i, j, lambdaHome, lambdaAway, RHO);
      grid[i][j] = p;
      if (i > j) pA += p; else if (i === j) pD += p; else pB += p;
    }
  }
  const sum = pA + pD + pB || 1;
  return { pA: pA / sum, pD: pD / sum, pB: pB / sum, grid, sum };
}
const HOME_ADV_ELO = 65;
const DEFAULT_STRENGTH = 60;
function teamStrength(name) { return DATA.strength?.[name] ?? DEFAULT_STRENGTH; }
function eloFromStrength(strength) { return 1500 + ((strength ?? 65) - 70) * 10; }
function legLambdas(strengthHome, strengthAway) {
  const TOTAL = 2.5;
  const eloHome = eloFromStrength(strengthHome) + HOME_ADV_ELO;
  const eloAway = eloFromStrength(strengthAway);
  const pWinHome = 1 / (1 + Math.pow(10, (eloAway - eloHome) / 400));
  let lo = 0.1, hi = TOTAL - 0.1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (matchProb(mid, TOTAL - mid).pA < pWinHome) lo = mid; else hi = mid;
  }
  const lambdaHome = (lo + hi) / 2;
  return { lambdaHome, lambdaAway: TOTAL - lambdaHome };
}
// Combina os placares das duas pernas (ou usa a partida única direto) e aplica a regra real
// da CBF: sem gol fora de casa, empate vai para os pênaltis (50/50, imprevisível por modelo
// de gols).
function tieAdvanceProb(nameA, nameB, format) {
  if (format !== "TWO_LEG") {
    const { lambdaHome, lambdaAway } = legLambdas(teamStrength(nameA), teamStrength(nameB));
    const { pA, pD, pB } = matchProb(lambdaHome, lambdaAway);
    return { pHome: pA + pD * 0.5, pAway: pB + pD * 0.5 };
  }
  const leg1 = legLambdas(teamStrength(nameA), teamStrength(nameB));
  const leg2 = legLambdas(teamStrength(nameB), teamStrength(nameA));
  const grid1 = matchProb(leg1.lambdaHome, leg1.lambdaAway).grid;
  const grid2 = matchProb(leg2.lambdaHome, leg2.lambdaAway).grid;
  const MAX = 8;
  let pHome = 0, pDrawAgg = 0, pAway = 0, total = 0;
  for (let a1 = 0; a1 <= MAX; a1++) for (let b1 = 0; b1 <= MAX; b1++) {
    const p1 = grid1[a1][b1];
    if (!p1) continue;
    for (let a2 = 0; a2 <= MAX; a2++) for (let b2 = 0; b2 <= MAX; b2++) {
      const p2 = grid2[a2][b2];
      if (!p2) continue;
      const aggHome = a1 + b2, aggAway = b1 + a2;
      const p = p1 * p2;
      total += p;
      if (aggHome > aggAway) pHome += p;
      else if (aggHome === aggAway) pDrawAgg += p;
      else pAway += p;
    }
  }
  if (total > 0) { pHome /= total; pDrawAgg /= total; pAway /= total; }
  return { pHome: pHome + pDrawAgg * 0.5, pAway: pAway + pDrawAgg * 0.5 };
}
function tieProbBarsHtml(nameA, nameB, format) {
  const { pHome, pAway } = tieAdvanceProb(nameA, nameB, format);
  const hPct = Math.round(pHome * 100), aPct = Math.round(pAway * 100);
  const sA = esc(nameA.length > 14 ? nameA.slice(0, 14) + "…" : nameA);
  const sB = esc(nameB.length > 14 ? nameB.slice(0, 14) + "…" : nameB);
  const label = (pct, name) => pct >= 20 ? `${name} ${pct}%` : `${pct}%`;
  return `<div class="prob-bars" role="group" aria-label="${esc(t("probBarsLabel"))}">
    <div class="prob-bar home" style="width:${hPct}%" title="${esc(nameA)}: ${hPct}%">${label(hPct, sA)}</div>
    <div class="prob-bar away" style="width:${aPct}%" title="${esc(nameB)}: ${aPct}%">${label(aPct, sB)}</div>
  </div>`;
}
function renderProbsSection() {
  const box = $("probsContent");
  if (!box) return;
  const s = state();
  let html = "";
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {}).filter(([, tie]) => tie.teamA && tie.teamB);
    if (!ties.length) return;
    const rows = ties.map(([tieId, tie]) => {
      if (tie.qualifiedTeamId) {
        const winner = tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB;
        return `<div class="confronto-card card">
          <div class="confronto-header">${esc(tie.teamA)} ${teamLogoImg(tie.teamA, "match-logo")} × ${teamLogoImg(tie.teamB, "match-logo")} ${esc(tie.teamB)}</div>
          <p class="muted" style="font-size:12px">${esc(t("gamesAdvances"))}: <b>${esc(winner)}</b></p>
        </div>`;
      }
      return `<div class="confronto-card card">
        <div class="confronto-header">${esc(tie.teamA)} ${teamLogoImg(tie.teamA, "match-logo")} × ${teamLogoImg(tie.teamB, "match-logo")} ${esc(tie.teamB)}</div>
        ${tieProbBarsHtml(tie.teamA, tie.teamB, phase.format)}
      </div>`;
    }).join("");
    html += `<h3 class="games-round-header">${esc(phase.name)}</h3>${rows}`;
  });
  box.innerHTML = html || `<p class="muted">${esc(t("waitingDraw"))}</p>`;
}

// ─── Render: games (fases dinâmicas) ─────────────────────────────────────────
function renderGamesSection() {
  const box = $("gamesList");
  if (!box) return;
  const s = state();
  const fmtDate = dateStr => {
    if (!dateStr) return t("gamesTbd");
    try {
      return new Date(dateStr).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      }) + " BRT";
    } catch { return dateStr; }
  };

  let html = "";
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {});
    html += `<h3 class="games-round-header">${esc(phase.name)}</h3>`;
    if (!ties.length) {
      html += `<p class="muted" style="margin-bottom:14px">${esc(t("waitingDraw"))}</p>`;
      return;
    }
    html += ties.map(([tieId, tie]) => {
      if (!tie.teamA || !tie.teamB) return "";
      const legs = legsForFormat(phase.format);
      const legHtml = leg => {
        const m = tie.matches?.[leg];
        if (!m) return "";
        const home = leg === "second" ? tie.teamB : tie.teamA;
        const away = leg === "second" ? tie.teamA : tie.teamB;
        const label = leg === "single" ? "" : leg === "first" ? t("gamesLeg1") : t("gamesLeg2");
        const scoreOrDate = m.goalsHome != null
          ? `<b>${m.goalsHome} × ${m.goalsAway}</b>`
          : esc(fmtDate(m.kickoff));
        return `<div class="leg">
          ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
          <span class="leg-teams">${esc(home)} ${teamLogoImg(home, "team-logo")} × ${teamLogoImg(away, "team-logo")} ${esc(away)}</span>
          <span class="leg-info">${m.venue ? "📍 " + esc(m.venue) + " · " : ""}${scoreOrDate}</span>
        </div>`;
      };
      const agg = phase.format === "TWO_LEG" ? aggregateFromMatches(tie.matches) : null;
      const resultLine = tie.qualifiedTeamId
        ? `<div class="leg confronto-result">${agg ? `${esc(t("gamesAggregate"))}: <b>${agg.totalA} × ${agg.totalB}</b> — ` : ""}${esc(t("gamesAdvances"))}: ${esc(tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB)}</div>`
        : "";
      return `<div class="confronto-card card">
        <div class="confronto-header">${esc(tie.teamA)} ${teamLogoImg(tie.teamA, "match-logo")} × ${teamLogoImg(tie.teamB, "match-logo")} ${esc(tie.teamB)}</div>
        <div class="confronto-legs">
          ${legs.map(legHtml).join("")}
          ${resultLine}
        </div>
      </div>`;
    }).join("");
  });
  box.innerHTML = html;
}

// ─── Render: footer ───────────────────────────────────────────────────────────
function renderFooter() {
  const el = $("siteFooterBar");
  if (!el) return;
  const s  = state();
  const ts = s.meta?.updatedAt
    ? new Date(s.meta.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  el.textContent = ts ? `${C.siteVersion} · sync ${ts} BRT` : C.siteVersion;
}

// ─── Render: admin ───────────────────────────────────────────────────────────
function renderAdmin() {
  if (!isAdminActive()) return;
  const s = state();
  renderAdminEspnSync(s);
  renderAdminPhases(s);
  renderAdminResults(s);
  renderAdminPayments(s);
  renderAdminEntries(s);
}

// ─── Sincronização com ESPN (sob demanda, admin confirma cada confronto) ─────────────────────
// Nunca escreve no estado sem um clique explícito do admin em cada linha — ver comentário em
// config.js e docs/bolao/CDB2026_RULES_AND_MODEL.md "Sincronização com ESPN". Diferente do
// BR2026 (polling automático contínuo de uma tabela de liga), aqui é busca pontual: o admin
// clica quando um sorteio sai, revisa a lista, e decide o que entra em qual fase.
let _espnCandidates = null; // null = nunca buscou; [] = buscou, nada encontrado; [...] = resultados

async function fetchEspnCandidates() {
  const url = C.espn?.scoreboardUrl;
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json();
    return (data.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === "home") || comps[0];
      const away  = comps.find(c => c.homeAway === "away") || comps[1];
      const evState = comp.status?.type?.state || "pre";
      return {
        id: ev.id,
        dateISO: comp.date || ev.date || "",
        homeTeam: home?.team?.displayName || "",
        awayTeam: away?.team?.displayName || "",
        homeScore: evState === "post" && home?.score != null ? parseInt(home.score, 10) : null,
        awayScore: evState === "post" && away?.score != null ? parseInt(away.score, 10) : null,
      };
    }).filter(ev => ev && ev.homeTeam && ev.awayTeam)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  } catch (err) {
    console.warn("[CDB2026] ESPN fetch failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function renderAdminEspnSync(s) {
  const box = $("adminEspnSync");
  if (!box) return;

  const existingPairs = new Set();
  Object.values(s.phases || {}).forEach(ph => Object.values(ph.ties || {}).forEach(tie => {
    if (tie.teamA && tie.teamB) existingPairs.add([tie.teamA, tie.teamB].sort().join("|"));
  }));

  const phaseOptions = DATA.phases.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");

  let listHtml = "";
  if (_espnCandidates === null) {
    listHtml = `<p class="muted small-text">${esc(t("espnSyncHint"))}</p>`;
  } else if (_espnCandidates === "error") {
    listHtml = `<p class="muted small-text">${esc(t("espnSyncError"))}</p>`;
  } else if (!_espnCandidates.length) {
    listHtml = `<p class="muted small-text">${esc(t("espnSyncEmpty"))}</p>`;
  } else {
    listHtml = _espnCandidates.map((ev, i) => {
      const already = existingPairs.has([ev.homeTeam, ev.awayTeam].sort().join("|"));
      const dateStr = ev.dateISO ? new Date(ev.dateISO).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }) : t("gamesTbd");
      const scoreStr = ev.homeScore != null ? ` — ${ev.homeScore} × ${ev.awayScore}` : "";
      return `<div class="admin-row espn-candidate-row" data-espn-idx="${i}">
        <span class="tie-teams-admin">${esc(ev.homeTeam)} × ${esc(ev.awayTeam)}<span class="muted small-text"> — ${esc(dateStr)}${scoreStr}</span></span>
        ${already
          ? `<span class="muted small-text">${esc(t("espnSyncAlready"))}</span>`
          : `<select class="espn-candidate-phase" aria-label="${esc(t("adminPhasesTitle"))}">${phaseOptions}</select>
             <button type="button" class="small-btn" data-espn-add="${i}">${esc(t("espnSyncAdd"))}</button>`}
      </div>`;
    }).join("");
  }

  box.innerHTML = `
    <h3>${esc(t("espnSyncTitle"))}</h3>
    <p class="muted small-text">${esc(t("espnSyncDisclaimer"))}</p>
    <div class="button-row" style="margin:10px 0">
      <button type="button" id="espnSyncFetchBtn" class="secondary small-btn">${esc(t("espnSyncFetch"))}</button>
    </div>
    ${listHtml}`;

  $("espnSyncFetchBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    const btn = $("espnSyncFetchBtn");
    btn.disabled = true; btn.textContent = t("espnSyncFetching");
    const result = await fetchEspnCandidates();
    _espnCandidates = result === null ? "error" : result;
    renderAdminEspnSync(state());
  });

  box.querySelectorAll("[data-espn-add]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const idx = parseInt(btn.dataset.espnAdd, 10);
    const ev  = _espnCandidates[idx];
    const row = box.querySelector(`.espn-candidate-row[data-espn-idx="${idx}"]`);
    const phaseId = row.querySelector(".espn-candidate-phase").value;
    if (!ev || !phaseId) return;
    const format = getPhaseDef(phaseId).format;
    const tie = { teamA: ev.homeTeam, teamB: ev.awayTeam, matches: {}, qualifiedTeamId: null };
    legsForFormat(format).forEach(leg => { tie.matches[leg] = emptyMatch(); });
    // Partida única já finalizada na ESPN: preenche o placar direto, mesmo caminho usado pelo
    // salvamento manual de perna — evita o admin redigitar um resultado que já veio pronto.
    if (format === "SINGLE_MATCH" && ev.homeScore != null) {
      tie.matches.single = { homeTeam: ev.homeTeam, awayTeam: ev.awayTeam, goalsHome: ev.homeScore, goalsAway: ev.awayScore, status: "FINAL" };
    }
    const s2 = state();
    s2.phases[phaseId].ties[uuid()] = tie;
    saveState(s2);
    showToast(t("espnSyncAdded"), "success");
    renderAdminEspnSync(state());
  }));
}

function toLocalDatetimeValue(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Admin: cadastro de confrontos por fase. Nenhuma fase vem com confrontos pré-cadastrados no
// código — o admin adiciona o confronto real assim que o sorteio de cada fase acontece (ver
// CDB2026_RULES_AND_MODEL.md, "não inventar confrontos futuros").
function renderAdminPhases(s) {
  const box = $("adminPhases");
  if (!box) return;
  const teamOptions = Object.keys(DATA.teamLogos || {}).sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(name => `<option value="${esc(name)}">`).join("");
  let html = `<h3>${esc(t("adminPhasesTitle"))}</h3><datalist id="cdbTeamList">${teamOptions}</datalist>`;
  DATA.phases.forEach(phase => {
    const phaseState = s.phases?.[phase.id] || emptyPhaseState();
    const tieCount = Object.keys(phaseState.ties || {}).length;
    html += `<div class="admin-phase-block" data-phase="${esc(phase.id)}">
      <div class="admin-phase-header">
        <b>${esc(phase.name)}</b>
        <span class="muted small-text">${phase.format === "TWO_LEG" ? esc(t("formatTwoLeg")) : esc(t("formatSingleMatch"))} · ${tieCount} ${esc(t("adminTiesCount"))}</span>
      </div>
      <div class="admin-row">
        <span class="small-text muted">${esc(t("adminPhaseCutoff"))}</span>
        <input type="datetime-local" class="adm-phase-cutoff" value="${phaseState.cutoffAt ? esc(toLocalDatetimeValue(phaseState.cutoffAt)) : ""}">
        <button type="button" class="secondary small-btn" data-save-cutoff="${esc(phase.id)}">${esc(t("adminSaveCutoff"))}</button>
      </div>
      <div class="admin-row cdb-add-tie">
        <input type="text" class="adm-team-a" placeholder="${esc(t("adminTeamA"))}" list="cdbTeamList">
        <input type="text" class="adm-team-b" placeholder="${esc(t("adminTeamB"))}" list="cdbTeamList">
        <button type="button" class="small-btn" data-add-tie="${esc(phase.id)}">${esc(t("adminAddTie"))}</button>
      </div>
      ${Object.entries(phaseState.ties || {}).map(([tieId, tie]) => {
        const hasResults = tie.qualifiedTeamId || Object.values(tie.matches || {}).some(m => m?.goalsHome != null);
        return `<div class="admin-row">
          <span class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</span>
          ${hasResults
            ? `<span class="muted small-text">${esc(t("adminTieHasResults"))}</span>`
            : `<button type="button" class="danger small-btn" data-remove-tie="${esc(tieId)}" data-phase="${esc(phase.id)}">${esc(t("delete"))}</button>`}
        </div>`;
      }).join("")}
    </div>`;
  });
  box.innerHTML = html;

  box.querySelectorAll("[data-save-cutoff]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.saveCutoff;
    const input = box.querySelector(`.admin-phase-block[data-phase="${phaseId}"] .adm-phase-cutoff`);
    const val = input.value;
    const s2 = state();
    s2.phases[phaseId].cutoffAt = val ? new Date(val).toISOString() : null;
    saveState(s2);
    showToast(t("adminCutoffSaved"), "success");
  }));

  box.querySelectorAll("[data-add-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.addTie;
    const block = box.querySelector(`.admin-phase-block[data-phase="${phaseId}"]`);
    const teamA = block.querySelector(".adm-team-a").value.trim();
    const teamB = block.querySelector(".adm-team-b").value.trim();
    if (!teamA || !teamB || teamA === teamB) { alert(t("errorTieTeams")); return; }
    const format = getPhaseDef(phaseId).format;
    const tie = { teamA, teamB, matches: {}, qualifiedTeamId: null };
    legsForFormat(format).forEach(leg => { tie.matches[leg] = emptyMatch(); });
    const s2 = state();
    s2.phases[phaseId].ties[uuid()] = tie;
    saveState(s2);
    showToast(t("adminTieAdded"), "success");
  }));

  box.querySelectorAll("[data-remove-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmRemoveTie"))) return;
    const s2 = state();
    delete s2.phases[btn.dataset.phase]?.ties?.[btn.dataset.removeTie];
    saveState(s2);
  }));
}

// Linha(s) de resultado de UM confronto — 1 partida (SINGLE_MATCH) ou 2 (TWO_LEG, ida/volta).
// Cada partida é salva independentemente; assim que todas as partidas do confronto têm placar,
// o agregado (ou o próprio placar, se for partida única) é calculado e um botão travar o
// resultado oficial aparece — quem se classifica é automático quando não empata, manual (igual
// à escolha de pênaltis) quando empata.
function renderAdminResultsForTie(phase, tieId, tie) {
  if (tie.qualifiedTeamId) {
    const agg = phase.format === "TWO_LEG" ? aggregateFromMatches(tie.matches) : null;
    const summary = agg ? `${esc(t("gamesAggregate"))}: ${agg.totalA} × ${agg.totalB} — ` : "";
    return `<div class="admin-row cdb-admin-tie" data-tie-id="${esc(tieId)}">
      <span class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</span>
      <span class="leg-result-saved">✓ ${summary}${esc(t("gamesAdvances"))}: ${esc(tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB)}</span>
      <button type="button" class="secondary small-btn" data-unlock-tie="${esc(tieId)}" data-phase="${esc(phase.id)}">${esc(t("unlockResults"))}</button>
    </div>`;
  }

  const legs = legsForFormat(phase.format);
  const legRows = legs.map(leg => {
    const m = tie.matches?.[leg] || emptyMatch();
    const label = leg === "single" ? "" : leg === "first" ? t("gamesLeg1") : t("gamesLeg2");
    const home = leg === "second" ? tie.teamB : tie.teamA;
    const away = leg === "second" ? tie.teamA : tie.teamB;
    if (m.goalsHome != null) {
      return `<div class="admin-leg-row" data-tie-id="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">
        ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
        <span class="leg-teams-admin">${esc(home)} × ${esc(away)}</span>
        <span class="leg-result-saved">✓ ${m.goalsHome} × ${m.goalsAway}</span>
        <button type="button" class="secondary small-btn" data-edit-leg="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">${esc(t("edit"))}</button>
      </div>`;
    }
    return `<div class="admin-leg-row" data-tie-id="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">
      ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
      <span class="leg-teams-admin">${esc(home)} × ${esc(away)}</span>
      <input type="number" min="0" max="20" class="adm-leg-a" aria-label="${esc(home)}">
      <span class="tie-x">×</span>
      <input type="number" min="0" max="20" class="adm-leg-b" aria-label="${esc(away)}">
      <button type="button" class="small-btn" data-save-leg="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">${esc(t("saveLegResult"))}</button>
    </div>`;
  }).join("");

  const allSaved = legs.every(leg => tie.matches?.[leg]?.goalsHome != null);
  let aggregateBlock = "";
  if (allSaved) {
    let totalA, totalB;
    if (phase.format === "TWO_LEG") {
      const agg = aggregateFromMatches(tie.matches);
      totalA = agg.totalA; totalB = agg.totalB;
    } else {
      totalA = tie.matches.single.goalsHome; totalB = tie.matches.single.goalsAway;
    }
    const tied = totalA === totalB;
    aggregateBlock = `<div class="admin-tie-aggregate">
      <span class="leg-label">${esc(t("aggregatePreview"))}</span>
      <span class="leg-teams-admin">${totalA} × ${totalB}</span>
      ${tied
        ? `<select class="adm-qualified" aria-label="${esc(t("pickQualifiedLabel"))}">
             <option value="">${esc(t("pickSelectAdvance"))}</option>
             <option value="A">${esc(tie.teamA)}</option>
             <option value="B">${esc(tie.teamB)}</option>
           </select>`
        : `<span class="leg-teams-admin">${esc(t("gamesAdvances"))}: ${esc(totalA > totalB ? tie.teamA : tie.teamB)}</span>`}
      <button type="button" class="small-btn" data-lock-tie="${esc(tieId)}" data-phase="${esc(phase.id)}" data-total-a="${totalA}" data-total-b="${totalB}">${esc(t("saveResults"))}</button>
    </div>`;
  }

  return `<div class="admin-tie-block" data-tie-block="${esc(tieId)}">
    <div class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</div>
    ${legRows}
    ${aggregateBlock}
  </div>`;
}

function renderAdminResults(s) {
  const box = $("adminResults");
  if (!box) return;

  let html = `<h3>${esc(t("adminResults"))}</h3>`;
  let anyTies = false;
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {}).filter(([, tie]) => tie.teamA && tie.teamB);
    if (!ties.length) return;
    anyTies = true;
    html += `<div class="admin-round-header">${esc(phase.name)}</div>`;
    ties.forEach(([tieId, tie]) => { html += renderAdminResultsForTie(phase, tieId, tie); });
  });
  box.innerHTML = anyTies ? html : `<h3>${esc(t("adminResults"))}</h3><p class="muted">${esc(t("waitingDraw"))}</p>`;

  box.querySelectorAll("[data-save-leg]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.saveLeg, phaseId = btn.dataset.phase, leg = btn.dataset.leg;
    const row = box.querySelector(`.admin-leg-row[data-tie-id="${tieId}"][data-phase="${phaseId}"][data-leg="${leg}"]`);
    const a = parseInt(row.querySelector(".adm-leg-a").value, 10);
    const b = parseInt(row.querySelector(".adm-leg-b").value, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) { alert(t("errorLegIncomplete")); return; }
    const s2 = state();
    const tie = s2.phases[phaseId].ties[tieId];
    const home = leg === "second" ? tie.teamB : tie.teamA;
    const away = leg === "second" ? tie.teamA : tie.teamB;
    tie.matches[leg] = { ...(tie.matches[leg] || emptyMatch()), homeTeam: home, awayTeam: away, goalsHome: a, goalsAway: b, status: "FINAL" };
    saveState(s2);
    showToast(t("legResultSaved"), "success");
  }));
  box.querySelectorAll("[data-edit-leg]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const s2 = state();
    const tie = s2.phases[btn.dataset.phase]?.ties?.[btn.dataset.editLeg];
    if (tie?.matches?.[btn.dataset.leg]) {
      tie.matches[btn.dataset.leg].goalsHome = null;
      tie.matches[btn.dataset.leg].goalsAway = null;
      tie.matches[btn.dataset.leg].status = "SCHEDULED";
    }
    saveState(s2);
  }));
  box.querySelectorAll("[data-lock-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.lockTie, phaseId = btn.dataset.phase;
    const totalA = parseInt(btn.dataset.totalA, 10), totalB = parseInt(btn.dataset.totalB, 10);
    const block = box.querySelector(`[data-tie-block="${tieId}"]`);
    let qualified;
    if (totalA === totalB) {
      qualified = block.querySelector(".adm-qualified")?.value;
      if (!qualified) { alert(t("errorAdminAdvanceRequired")); return; }
    } else {
      qualified = totalA > totalB ? "A" : "B";
    }
    if (!confirm(t("confirmLockResults"))) return;
    const s2 = state();
    s2.phases[phaseId].ties[tieId].qualifiedTeamId = qualified;
    s2.phases[phaseId].ties[tieId].lockedAt = new Date().toISOString();
    saveState(s2);
    showToast(t("resultsSaved"), "success");
  }));
  box.querySelectorAll("[data-unlock-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmUnlockResults"))) return;
    const s2 = state();
    const tie = s2.phases[btn.dataset.phase]?.ties?.[btn.dataset.unlockTie];
    if (tie) { delete tie.qualifiedTeamId; delete tie.lockedAt; }
    saveState(s2);
  }));
}

function renderAdminPayments(s) {
  const box = $("adminPayments");
  if (!box) return;
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  box.innerHTML = `<h3>${esc(t("adminPayments"))}</h3>` + entries.map(e => {
    const isPaid = (s.paid || {})[e.id];
    return `<div class="admin-row">
      <span>${esc(e.entryName)}</span>
      <span class="muted small-text">${esc(e.paymentMethod || "")}</span>
      <button type="button" class="small-btn ${isPaid ? "secondary" : ""}" data-toggle-paid="${esc(e.id)}">${esc(isPaid ? t("markUnpaid") : t("markPaid"))}</button>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-toggle-paid]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const id = btn.dataset.togglePaid;
    const s2 = state();
    s2.paid = s2.paid || {};
    s2.paid[id] = !s2.paid[id];
    saveState(s2, { localOnly: false });
  }));
}

function renderAdminEntries(s) {
  const box = $("adminEntries");
  if (!box) return;
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  box.innerHTML = `<h3>${esc(t("adminEntries"))}</h3>` + (entries.length ? entries.map(e => `
    <div class="admin-row">
      <span>${esc(e.entryName)}</span>
      <span class="muted small-text">${esc(e.participantEmail || "")}</span>
      <button type="button" class="danger small-btn" data-delete-entry="${esc(e.id)}">${esc(t("delete"))}</button>
    </div>`).join("") : `<p class="muted">${esc(t("noEntries"))}</p>`);

  box.querySelectorAll("[data-delete-entry]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmDelete"))) return;
    const s2 = state();
    s2.deletedIds = s2.deletedIds || [];
    s2.deletedIds.push(btn.dataset.deleteEntry);
    saveState(s2);
  }));
}

// ─── Export CSV ──────────────────────────────────────────────────────────────
function exportCsv() {
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  const header  = ["Nome", "Pagador", "Email", "Pagamento", "Campeão", "Vice", "Pago", "Criado", "Palpites"];
  const rows    = [header];
  entries.forEach(e => {
    const predicted = predictedPodium(e, s);
    const lines = [];
    DATA.phases.forEach(phase => {
      Object.entries(s.phases?.[phase.id]?.ties || {}).forEach(([tieId, tie]) => {
        if (!tie.teamA || !tie.teamB) return;
        const pickMatches = e.picks?.matches?.[tieId];
        if (!pickMatches) return;
        legsForFormat(phase.format).forEach(leg => {
          const pick = pickMatches[leg];
          if (!pick) return;
          const legLabel = leg === "single" ? "" : leg === "first" ? " (ida)" : " (volta)";
          lines.push(`${tie.teamA} ${pick.goalsHome}x${pick.goalsAway} ${tie.teamB}${legLabel}`);
        });
      });
    });
    rows.push([
      e.entryName, e.payerName || "", e.participantEmail || "", e.paymentMethod || "",
      predicted.champion || "", predicted.runnerUp || "",
      (s.paid || {})[e.id] ? "Sim" : "Não",
      e.createdAt ? new Date(e.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      lines.join(" | ")
    ]);
  });
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `cdb2026_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Export JSON backup ───────────────────────────────────────────────────────
function exportJsonBackup() {
  const s    = state();
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `cdb2026_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Clear all data (admin) ───────────────────────────────────────────────────
async function clearAllData() {
  if (!confirm(t("clearDataConfirm"))) return;
  localStorage.removeItem(C.storeKey);
  if (C.database.enabled) {
    try {
      const { url, anonKey, table, stateId } = C.database;
      await fetch(`${url}/rest/v1/${table}?id=eq.${stateId}`, {
        method: "DELETE",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
      });
    } catch (err) { console.warn("[CDB2026] Clear remote failed", err); }
  }
  renderAll();
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
  applyI18n();
  renderFindEntryCard();
  renderPickForm();
  renderRanking();
  renderGamesSection();
  renderProbsSection();
  renderParticipants();
  renderPayment();
  renderRules();
  renderFooter();
  if (isAdminActive()) renderAdmin();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const wa = $("supportWhatsappBtn");
  if (wa) wa.href = C.whatsappGroup?.link || "#";

  $$("[data-section]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  showSection(isPastFase1Cutoff() ? "ranking" : "entry");

  $("bolaoSelect")?.addEventListener("change", e => {
    const allowed = ["/bolao/", "/bolao/br2026/", "/bolao/cdb2026/"];
    if (allowed.includes(e.target.value)) location.href = e.target.value;
  });

  renderCountdown();
  setInterval(() => { if (!document.hidden) renderCountdown(); }, 1000);

  $("saveEntryBtn")?.addEventListener("click", saveEntry);

  $("findEntryBtn")?.addEventListener("click", () => {
    if (!fase1Complete(state())) { showToast(t("findEntryLockedMsg"), "warn"); return; }
    const email = $("findEntryEmail")?.value.trim() || "";
    const code  = $("findEntryCode")?.value.trim() || "";
    if (!email || !code) { alert(t("findEntryMissing")); return; }
    const found = findEntryByEmailAndCode(email, code);
    if (!found) { showToast(t("findEntryNotFound"), "error"); return; }
    _editingEntry = found;
    renderPickForm();
    $("entryName") && ($("entryName").value = found.entryName || "");
    $("payerName") && ($("payerName").value = found.payerName || "");
    $("participantEmail") && ($("participantEmail").value = found.participantEmail || "");
    $("paymentMethod") && ($("paymentMethod").value = found.paymentMethod || "");
    showToast(t("findEntryLoaded"), "success");
  });

  $("adminPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") $("adminLoginBtn")?.click(); });
  $("adminLoginBtn")?.addEventListener("click", async () => {
    const now = Date.now();
    if (now < _loginLockUntil) {
      showToast(t("adminLocked").replace("{min}", Math.ceil((_loginLockUntil - now) / 60000)), "warn"); return;
    }
    const pw   = $("adminPassword")?.value || "";
    const hash = await sha256hex(pw);
    if (hash === C.adminPasswordHash) {
      _loginAttempts = 0;
      sessionStorage.removeItem("cdb2026_loginAttempts");
      sessionStorage.setItem("cdb2026_adminUntil", String(Date.now() + C.adminSessionMinutes * 60000));
      $("adminLogin")?.classList.add("hidden");
      $("adminArea")?.classList.remove("hidden");
      renderAdmin();
    } else {
      _loginAttempts++;
      sessionStorage.setItem("cdb2026_loginAttempts", _loginAttempts);
      if (_loginAttempts >= C.adminMaxAttempts) {
        _loginLockUntil = Date.now() + C.adminLockMinutes * 60000;
        sessionStorage.setItem("cdb2026_loginLockUntil", _loginLockUntil);
        showToast(t("adminLockedNow").replace("{min}", C.adminLockMinutes), "warn");
      } else {
        showToast(t("adminWrongPassword").replace("{n}", C.adminMaxAttempts - _loginAttempts), "error");
      }
    }
  });

  $("adminLogoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("cdb2026_adminUntil");
    $("adminLogin")?.classList.remove("hidden");
    $("adminArea")?.classList.add("hidden");
  });

  $("exportCsvBtn")?.addEventListener("click", () => { if (guardAdmin()) exportCsv(); });
  $("exportJsonBtn")?.addEventListener("click", () => { if (guardAdmin()) exportJsonBackup(); });
  $("clearDataBtn")?.addEventListener("click", () => { if (guardAdmin()) clearAllData(); });
  $("forceSyncBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    await loadRemoteState();
    renderAll();
    showToast(t("syncDone"), "success");
  });

  if (isAdminActive()) {
    $("adminLogin")?.classList.add("hidden");
    $("adminArea")?.classList.remove("hidden");
  }

  await loadRemoteState();
  renderAll();

  if (C.database.enabled) {
    setInterval(async () => { await loadRemoteState(); renderAll(); }, 30000);
  }
}

document.addEventListener("DOMContentLoaded", init);
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bolao/sw.js').catch(() => {});
}

// Reload when a new deploy is detected — on tab focus and every 10 min
(function startVersionPolling() {
  async function checkVersion() {
    if (document.hidden) return;
    try {
      const r = await fetch(`js/config.js?nc=${Date.now()}`);
      const text = await r.text();
      const m = text.match(/siteVersion:\s*"([^"]+)"/);
      if (m && m[1] !== window.CDB2026_CONFIG?.siteVersion) location.reload();
    } catch (e) {}
  }
  setInterval(checkVersion, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
}());
