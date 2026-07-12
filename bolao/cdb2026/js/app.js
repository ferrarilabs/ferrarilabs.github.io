/* Bolão Copa do Brasil 2026 — app.js v1.0
   Vanilla JS IIFE, no framework, no build step */
(function () {
"use strict";

// ─── Aliases ────────────────────────────────────────────────────────────────
const C    = window.CDB2026_CONFIG;
const DATA = window.CDB2026_DATA;
const $    = id => document.getElementById(id);
const $$   = sel => [...document.querySelectorAll(sel)];
const esc  = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── i18n ───────────────────────────────────────────────────────────────────
const t = key => window.CDB2026_I18N?.["pt-BR"]?.[key] ?? key;
function applyI18n() {
  $$("[data-i18n]").forEach(el => { const v = t(el.dataset.i18n); if (v) el.textContent = v; });
}

// ─── State ──────────────────────────────────────────────────────────────────
let _editingEntry = null;

function emptyState() {
  return { entries: [], deletedIds: [], paid: {}, results: null, meta: { updatedAt: null, version: C.siteVersion } };
}
function state() {
  try { const r = localStorage.getItem(C.storeKey); return r ? Object.assign(emptyState(), JSON.parse(r)) : emptyState(); }
  catch { return emptyState(); }
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
function mergeStates(local, remote, opts = {}) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  const byId = {};
  [...(remote.entries || []), ...(local.entries || [])].forEach(e => { if (!deleted.has(e.id)) byId[e.id] = e; });
  const paid = { ...(remote.paid || {}), ...(local.paid || {}) };
  let results;
  if (opts.preferRemoteResults) {
    results = remote.results?.locked ? remote.results : (local.results?.locked ? local.results : remote.results || local.results);
  } else {
    results = local.results?.locked ? local.results : (remote.results?.locked ? remote.results : local.results || remote.results);
  }
  return {
    entries: Object.values(byId),
    deletedIds: [...deleted],
    paid,
    results,
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
}

// ─── Cutoff ─────────────────────────────────────────────────────────────────
const cutoffDate  = () => new Date(C.cutoffIso);
const isPastCutoff = () => Date.now() > cutoffDate().getTime();

// ─── UUID ───────────────────────────────────────────────────────────────────
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

// ─── Pick dropdowns ─────────────────────────────────────────────────────────
function getPickValues() {
  return {
    champion: $("cdb-champion")?.value || "",
    runnerUp: $("cdb-runner-up")?.value || "",
    semis:    [$("cdb-semi-1")?.value || "", $("cdb-semi-2")?.value || ""],
  };
}

function updateDropdowns() {
  const { champion, runnerUp, semis } = getPickValues();
  const allPicked = new Set([champion, runnerUp, ...semis].filter(Boolean));
  [
    { el: $("cdb-champion"),  own: champion },
    { el: $("cdb-runner-up"), own: runnerUp },
    { el: $("cdb-semi-1"),    own: semis[0] },
    { el: $("cdb-semi-2"),    own: semis[1] },
  ].forEach(({ el, own }) => {
    if (!el) return;
    el.querySelectorAll("option[value]").forEach(opt => {
      if (!opt.value) return;
      opt.disabled = allPicked.has(opt.value) && opt.value !== own;
    });
  });
}

function renderPickForm() {
  const locked  = isPastCutoff();
  const teamOpts = DATA.teams
    .slice()
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(t => `<option value="${esc(t)}">${esc(t)}</option>`)
    .join("");

  const sel = (id, labelKey, hintKey) => `
    <div class="pick-row">
      <label for="${id}">
        <span class="pick-pos-label">${esc(t(labelKey))}</span>
        <span class="pick-pts-hint">${esc(t(hintKey))}</span>
      </label>
      <select id="${id}" class="pick-select" ${locked ? "disabled" : ""}>
        <option value="">${esc(t("pickSelectTeam"))}</option>
        ${teamOpts}
      </select>
    </div>`;

  const form = $("pickForm");
  if (!form) return;
  form.innerHTML = `
    <div class="pick-group">
      <div class="pick-group-header champion-header">🏆 ${esc(t("picksGroupTitle"))}</div>
      ${sel("cdb-champion",  "pickChampion",  "pickHintChampion")}
      ${sel("cdb-runner-up", "pickRunnerUp",  "pickHintRunnerUp")}
      ${sel("cdb-semi-1",    "pickSemi1",     "pickHintSemi")}
      ${sel("cdb-semi-2",    "pickSemi2",     "pickHintSemi")}
    </div>`;

  if (_editingEntry) {
    const p = _editingEntry.picks || {};
    if (p.champion && $("cdb-champion"))  $("cdb-champion").value  = p.champion;
    if (p.runnerUp && $("cdb-runner-up")) $("cdb-runner-up").value = p.runnerUp;
    (p.semis || []).forEach((v, i) => {
      const el = $(`cdb-semi-${i + 1}`);
      if (el && v) el.value = v;
    });
  }

  form.removeEventListener("change", updateDropdowns);
  form.addEventListener("change", updateDropdowns);
  updateDropdowns();
}

// ─── Validation ──────────────────────────────────────────────────────────────
function validatePicks({ champion, runnerUp, semis }) {
  const errors = [];
  if (!champion || !runnerUp || semis.some(x => !x)) errors.push(t("errorPicksIncomplete"));
  const all = [champion, runnerUp, ...semis].filter(Boolean);
  if (new Set(all).size < all.length) errors.push(t("errorDuplicatePicks"));
  return errors;
}

// ─── Save entry ──────────────────────────────────────────────────────────────
async function saveEntry() {
  if (isPastCutoff()) { alert(t("closed")); return; }
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

    alert(t("savedSuccess"));
    showSection("ranking");
  } catch (err) {
    console.error("[CDB2026] Save error", err);
    alert(t("saveError"));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("saveEntry"); }
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────────
function scoreEntry(entry, results) {
  if (!results) return null;
  const picks = entry.picks || {};
  let total = 0;
  const detail = {};

  // Champion
  if (picks.champion) {
    const exact = picks.champion === results.champion;
    detail.champion = { pts: exact ? C.scoring.champion : 0, type: exact ? "exact" : "miss" };
    total += detail.champion.pts;
  }

  // Runner-up
  if (picks.runnerUp) {
    const exact = picks.runnerUp === results.runnerUp;
    detail.runnerUp = { pts: exact ? C.scoring.runnerUp : 0, type: exact ? "exact" : "miss" };
    total += detail.runnerUp.pts;
  }

  // Semifinalists — any order (just need to be in the top 4, including champion/runner-up)
  const semifinalistSet = new Set([
    results.champion, results.runnerUp, ...(results.semis || [])
  ].filter(Boolean));
  detail.semis = (picks.semis || []).map(pick => {
    if (!pick) return null;
    const hit = semifinalistSet.has(pick);
    return { pts: hit ? C.scoring.semifinalist : 0, type: hit ? "hit" : "miss" };
  });
  detail.semis.forEach(d => { if (d) total += d.pts; });

  return { total, detail };
}

function getActiveScore(entry, s) {
  if (s.results?.locked) {
    return { ...scoreEntry(entry, s.results), isOfficial: true };
  }
  return null;
}

// ─── Tiebreaker helpers ──────────────────────────────────────────────────────
function hitChampion(detail) { return detail?.champion?.type === "exact" ? 1 : 0; }
function hitRunnerUp(detail) { return detail?.runnerUp?.type === "exact" ? 1 : 0; }

// ─── Email receipt ───────────────────────────────────────────────────────────
let _lastEmailTs = 0;
async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  const now = Date.now();
  if (now - _lastEmailTs < C.emailjs.limitRateMs) return;

  const p = entry.picks || {};
  const picksHtml = `
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><th>Palpite</th><th>Time</th></tr>
      <tr><td>🏆 Campeão</td><td>${esc(p.champion || "—")}</td></tr>
      <tr><td>🥈 Vice-campeão</td><td>${esc(p.runnerUp || "—")}</td></tr>
      <tr><td>Semi 1</td><td>${esc((p.semis || [])[0] || "—")}</td></tr>
      <tr><td>Semi 2</td><td>${esc((p.semis || [])[1] || "—")}</td></tr>
    </table>`;

  const params = {
    to_email:    entry.participantEmail,
    to_name:     entry.entryName,
    entry_name:  entry.entryName,
    html_message: `<h2>Bolão Copa do Brasil 2026 — Comprovante</h2>
      <p>Entrada: <strong>${esc(entry.entryName)}</strong></p>
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
        html_message: `<p>Nova entrada: <strong>${esc(entry.entryName)}</strong> (${esc(entry.participantEmail)})</p>${picksHtml}`
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
  const diff = cutoffDate().getTime() - Date.now();
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
    const sc = getActiveScore(e, s) || { total: 0, detail: null, isOfficial: false };
    return { e, ...sc };
  }).sort((a, b) =>
    b.total - a.total ||
    hitChampion(b.detail) - hitChampion(a.detail) ||
    hitRunnerUp(b.detail) - hitRunnerUp(a.detail) ||
    b.e.entryName.localeCompare(a.e.entryName, "pt-BR")
  );

  const hasOfficial = s.results?.locked;
  const provNote = !hasOfficial
    ? `<p class="prov-note">↕ ${esc(t("provisionalNote"))}</p>` : "";

  let rank = 0, prevPts = -1;
  const rows = scored.map((item, i) => {
    if (item.total !== prevPts) { rank = i + 1; prevPts = item.total; }
    const paid      = (s.paid || {})[item.e.id];
    const medal     = { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `${rank}.`;
    const paidBadge = paid
      ? `<span class="paid-badge">${esc(t("paid"))}</span>`
      : `<span class="unpaid-badge">${esc(t("unpaid"))}</span>`;
    return `<div class="rank-card">
      <div class="rank-top">
        <span class="rank-pos">${medal}</span>
        <span class="rank-name">${esc(item.e.entryName)}</span>
        <span class="rank-pts">${item.total}<small> pts</small></span>
        ${paidBadge}
      </div>
      ${renderPickDisplay(item.e, item.detail)}
    </div>`;
  }).join("");

  box.innerHTML = provNote + rows;
}

function renderPickDisplay(entry, detail) {
  const p = entry.picks || {};
  const mkCell = (team, d) => {
    if (!team) return `<div class="pick-cell pick-empty">—</div>`;
    const cls   = d ? (d.type === "exact" ? "pick-exact" : d.type === "hit" ? "pick-exact" : "pick-miss") : "";
    const badge = d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : "";
    return `<div class="pick-cell ${cls}">${esc(team)}${badge}</div>`;
  };

  return `<div class="picks-display cdb-picks">
    <div class="pick-item"><span class="pick-pos-lbl">🏆 ${esc(t("pickLabelChampion"))}</span>${mkCell(p.champion, detail?.champion)}</div>
    <div class="pick-item"><span class="pick-pos-lbl">🥈 ${esc(t("pickLabelRunnerUp"))}</span>${mkCell(p.runnerUp, detail?.runnerUp)}</div>
    ${(p.semis || []).map((team, i) => `
    <div class="pick-item"><span class="pick-pos-lbl">${esc(t("pickLabelSemi"))} ${i + 1}</span>${mkCell(team, detail?.semis?.[i])}</div>`).join("")}
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
    return `<div class="pay-card">
      <strong>${esc(method)}</strong>
      ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(handle)}</a>` : `<span>${esc(handle)}</span>`}
    </div>`;
  }).join("");
}

// ─── Render: rules ───────────────────────────────────────────────────────────
function renderRules() {
  const box = $("rulesContent");
  if (!box) return;
  const sc  = C.scoring;
  const pr  = C.prizes;
  const total = entries => entries * C.entryFee;
  box.innerHTML = `
    <div class="card">
      <h3>${esc(t("rulesScoring"))}</h3>
      <table class="rules-table">
        <thead><tr><th>${esc(t("rulesAcerto"))}</th><th>${esc(t("rulesPts"))}</th></tr></thead>
        <tbody>
          <tr><td>🏆 Campeão — ${esc(t("rulesExact"))}</td><td><b>${sc.champion}</b></td></tr>
          <tr><td>🥈 Vice-campeão — ${esc(t("rulesExact"))}</td><td><b>${sc.runnerUp}</b></td></tr>
          <tr><td>Semifinalista acertado (×2)</td><td><b>${sc.semifinalist}</b> cada</td></tr>
          <tr><td><b>${esc(t("rulesMaxPoints"))}</b></td><td><b>${sc.champion + sc.runnerUp + sc.semifinalist * 2}</b></td></tr>
        </tbody>
      </table>
      <h3>${esc(t("tbTitle"))}</h3>
      <ol style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.8">
        <li>${esc(t("tbChampion"))}</li>
        <li>${esc(t("tbRunnerUp"))}</li>
        <li>${esc(t("tbAlpha"))}</li>
      </ol>
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
      <p style="font-size:13px">${esc(new Date(C.cutoffIso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))} BRT</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesTransparency"))}</h3>
      <p class="muted" style="font-size:12px">${esc(C.transparency.disclaimer)}</p>
    </div>`;
}

// ─── Render: games (Oitavas de Final) ────────────────────────────────────────
function renderGamesSection() {
  const box = $("gamesList");
  if (!box) return;
  const oitavas = DATA.oitavas || [];
  if (!oitavas.length) { box.innerHTML = `<p class="muted">Sem confrontos disponíveis.</p>`; return; }

  const fmtDate = (dateStr, timeStr) => {
    try {
      const d = new Date(`${dateStr}T${timeStr}:00-03:00`);
      return d.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        weekday: "short", day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      }) + " BRT";
    } catch { return `${dateStr} ${timeStr} BRT`; }
  };

  box.innerHTML = oitavas.map(o => {
    const legHtml = (legData, labelKey) => {
      if (!legData) return "";
      return `<div class="leg">
        <span class="leg-label">${esc(t(labelKey))}</span>
        <span class="leg-teams">${esc(legData.home)} × ${esc(legData.away)}</span>
        <span class="leg-info">📍 ${esc(legData.stadium)} · ${esc(fmtDate(legData.date, legData.time))}</span>
      </div>`;
    };
    return `<div class="confronto-card card">
      <div class="confronto-header">Oitavas ${o.id} — ${esc(o.home)} × ${esc(o.away)}</div>
      <div class="confronto-legs">
        ${legHtml({ home: o.home, away: o.away, stadium: o.stadium, date: o.date, time: o.time }, "gamesLeg1")}
        ${legHtml(o.leg2, "gamesLeg2")}
      </div>
    </div>`;
  }).join("");
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
  renderAdminResults(state());
  renderAdminPayments(state());
  renderAdminEntries(state());
}

function renderAdminResults(s) {
  const box = $("adminResults");
  if (!box) return;
  const r      = s.results;
  const locked = r?.locked;
  const opts   = DATA.teams.slice().sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(team => `<option value="${esc(team)}">${esc(team)}</option>`).join("");
  const sel = id =>
    `<select id="${id}" ${locked ? "disabled" : ""}><option value="">—</option>${opts}</select>`;

  box.innerHTML = `
    <h3>${esc(t("adminResults"))}</h3>
    ${locked ? `<p class="paid-badge">${esc(t("resultsLocked"))}</p>` : ""}
    <div class="cdb-results-grid">
      <div class="admin-row"><label for="adm-champion">${esc(t("adminChampion"))}</label>${sel("adm-champion")}</div>
      <div class="admin-row"><label for="adm-runner-up">${esc(t("adminRunnerUp"))}</label>${sel("adm-runner-up")}</div>
      <div class="admin-row"><label for="adm-semi-1">${esc(t("adminSemi1"))}</label>${sel("adm-semi-1")}</div>
      <div class="admin-row"><label for="adm-semi-2">${esc(t("adminSemi2"))}</label>${sel("adm-semi-2")}</div>
    </div>
    <div class="button-row" style="margin-top:14px;gap:8px">
      ${!locked ? `<button type="button" id="saveResultsBtn">${esc(t("saveResults"))}</button>` : ""}
      ${locked  ? `<button type="button" id="unlockResultsBtn" class="secondary">${esc(t("unlockResults"))}</button>` : ""}
    </div>`;

  if (r?.champion) $("adm-champion") && ($("adm-champion").value = r.champion);
  if (r?.runnerUp) $("adm-runner-up") && ($("adm-runner-up").value = r.runnerUp);
  if (r?.semis?.[0]) $("adm-semi-1") && ($("adm-semi-1").value = r.semis[0]);
  if (r?.semis?.[1]) $("adm-semi-2") && ($("adm-semi-2").value = r.semis[1]);

  $("saveResultsBtn")?.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const champion = $("adm-champion")?.value || "";
    const runnerUp = $("adm-runner-up")?.value || "";
    const semis    = [$("adm-semi-1")?.value || "", $("adm-semi-2")?.value || ""];
    if (!champion || !runnerUp || semis.some(v => !v)) {
      alert(t("errorResultsIncomplete")); return;
    }
    const all = [champion, runnerUp, ...semis];
    if (new Set(all).size < all.length) { alert(t("errorDuplicatePicks")); return; }
    if (!confirm(t("confirmLockResults"))) return;
    const s2 = state();
    s2.results = { champion, runnerUp, semis, locked: true, lockedAt: new Date().toISOString() };
    saveState(s2);
    alert(t("resultsSaved"));
    renderAdmin();
  });

  $("unlockResultsBtn")?.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmUnlockResults"))) return;
    const s2 = state();
    if (s2.results) { s2.results.locked = false; }
    saveState(s2);
    renderAdmin();
  });
}

function renderAdminPayments(s) {
  const box = $("adminPayments");
  if (!box) return;
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  box.innerHTML = `<h3>${esc(t("adminPayments"))}</h3>`
    + (entries.length ? entries.map(e => {
      const paid = (s.paid || {})[e.id];
      return `<div class="admin-row">
        <span>${esc(e.entryName)}</span>
        <span class="muted">${esc(e.payerName || "")}</span>
        <button type="button" class="${paid ? "secondary" : ""} small-btn" data-toggle-paid="${esc(e.id)}">
          ${esc(paid ? t("markUnpaid") : t("markPaid"))}
        </button>
      </div>`;
    }).join("") : `<p class="muted">${esc(t("noEntries"))}</p>`);

  box.querySelectorAll("[data-toggle-paid]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!guardAdmin()) return;
      const s2 = state();
      s2.paid = s2.paid || {};
      if (s2.paid[btn.dataset.togglePaid]) delete s2.paid[btn.dataset.togglePaid];
      else s2.paid[btn.dataset.togglePaid] = true;
      saveState(s2);
    })
  );
}

function renderAdminEntries(s) {
  const box = $("adminEntries");
  if (!box) return;
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  box.innerHTML = `<h3>${esc(t("adminEntries"))}</h3>`
    + (entries.length ? entries.map(e => `
      <div class="admin-row">
        <span>${esc(e.entryName)}</span>
        <span class="muted">${esc(e.participantEmail || "")}</span>
        <button type="button" class="secondary small-btn" data-edit-id="${esc(e.id)}">${esc(t("edit"))}</button>
        <button type="button" class="danger small-btn" data-delete-id="${esc(e.id)}">${esc(t("delete"))}</button>
      </div>`).join("") : `<p class="muted">${esc(t("noEntries"))}</p>`);

  box.querySelectorAll("[data-edit-id]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!guardAdmin()) return;
      const s2 = state();
      _editingEntry = (s2.entries || []).find(e => e.id === btn.dataset.editId) || null;
      renderPickForm();
      if (_editingEntry) {
        $("entryName") && ($("entryName").value = _editingEntry.entryName || "");
        $("payerName") && ($("payerName").value = _editingEntry.payerName || "");
        $("participantEmail") && ($("participantEmail").value = _editingEntry.participantEmail || "");
        $("paymentMethod") && ($("paymentMethod").value = _editingEntry.paymentMethod || "");
      }
      showSection("entry");
    })
  );
  box.querySelectorAll("[data-delete-id]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!guardAdmin()) return;
      if (!confirm(t("confirmDelete"))) return;
      const s2 = state();
      s2.deletedIds = [...(s2.deletedIds || []), btn.dataset.deleteId];
      saveState(s2);
    })
  );
}

// ─── Export CSV ──────────────────────────────────────────────────────────────
function exportCsv() {
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  const rows    = [["Nome", "Pagador", "Email", "Pagamento", "Campeão", "Vice", "Semi1", "Semi2", "Pago", "Criado"]];
  entries.forEach(e => {
    const p = e.picks || {};
    rows.push([
      e.entryName, e.payerName || "", e.participantEmail || "", e.paymentMethod || "",
      p.champion || "", p.runnerUp || "", (p.semis || [])[0] || "", (p.semis || [])[1] || "",
      (s.paid || {})[e.id] ? "Sim" : "Não",
      e.createdAt ? new Date(e.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ""
    ]);
  });
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `cdb2026_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
  applyI18n();
  renderPickForm();
  renderRanking();
  renderGamesSection();
  renderParticipants();
  renderPayment();
  renderRules();
  renderFooter();
  if (isAdminActive()) renderAdmin();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  // Navigation
  $$("[data-section]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  showSection(isPastCutoff() ? "ranking" : "entry");

  // Bolão switcher
  $("bolaoSelect")?.addEventListener("change", e => {
    const allowed = ["/bolao/", "/bolao/br2026/", "/bolao/cdb2026/"];
    if (allowed.includes(e.target.value)) location.href = e.target.value;
  });

  // Countdown
  renderCountdown();
  setInterval(() => { if (!document.hidden) renderCountdown(); }, 1000);

  // Save entry
  $("saveEntryBtn")?.addEventListener("click", saveEntry);

  // Admin login
  $("adminPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") $("adminLoginBtn")?.click(); });
  $("adminLoginBtn")?.addEventListener("click", async () => {
    const now = Date.now();
    if (now < _loginLockUntil) {
      alert(t("adminLocked").replace("{min}", Math.ceil((_loginLockUntil - now) / 60000))); return;
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
        alert(t("adminLockedNow").replace("{min}", C.adminLockMinutes));
      } else {
        alert(t("adminWrongPassword").replace("{n}", C.adminMaxAttempts - _loginAttempts));
      }
    }
  });

  $("adminLogoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("cdb2026_adminUntil");
    $("adminLogin")?.classList.remove("hidden");
    $("adminArea")?.classList.add("hidden");
  });

  $("exportCsvBtn")?.addEventListener("click", () => { if (guardAdmin()) exportCsv(); });
  $("forceSyncBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    await loadRemoteState();
    renderAll();
    alert(t("syncDone"));
  });

  if (isAdminActive()) {
    $("adminLogin")?.classList.add("hidden");
    $("adminArea")?.classList.remove("hidden");
  }

  // Load remote state then render
  await loadRemoteState();
  renderAll();

  // Remote sync every 30s (when database enabled)
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
