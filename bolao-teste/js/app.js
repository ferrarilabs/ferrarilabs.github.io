/* Bolão do Ferrari — v4.0-clean */
(function () {
"use strict";

const CONFIG = window.BOLAO_CONFIG;
const DATA   = window.BOLAO_DATA;
const I18N   = window.BOLAO_I18N;

if (!CONFIG || !DATA || !I18N) {
  document.body.innerHTML = '<p style="color:red;padding:2em;font-family:sans-serif">Erro de configuração: config/data/i18n ausentes.</p>';
  return;
}

/* ============================================================
   Utilities
   ============================================================ */
function $(sel, ctx) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isValidEmail(e) {
  const s = String(e || "").trim();
  return !!s && !/\s/.test(s) && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function parseScore(v) {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : null;
}

function pickWinner(a, b) { return a > b ? "A" : b > a ? "B" : ""; }

function hashString(str) {
  let h = 2166136261;
  for (const cp of str) { h ^= cp.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function receiptCode(e) {
  return `BOLAO-${hashString(JSON.stringify({ n: e.entryName, t: e.createdAt }))}-${String(e.createdAt || "").slice(0, 10).replace(/-/g, "")}`;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatDate(d) {
  if (!d) return "";
  const [y, m, day] = String(d).split("-");
  if (!y || !m || !day) return d;
  try {
    return new Date(Number(y), Number(m) - 1, Number(day))
      .toLocaleDateString(currentLang, { weekday: "short", month: "short", day: "numeric" });
  } catch { return d; }
}

function flag(name) {
  const n = String(name || "").toLowerCase().trim();
  const map = {
    "south africa":"🇿🇦","canada":"🇨🇦","brazil":"🇧🇷","brasil":"🇧🇷","japan":"🇯🇵",
    "argentina":"🇦🇷","france":"🇫🇷","germany":"🇩🇪","spain":"🇪🇸","portugal":"🇵🇹",
    "england":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","italy":"🇮🇹","netherlands":"🇳🇱","mexico":"🇲🇽",
    "united states":"🇺🇸","usa":"🇺🇸","uruguay":"🇺🇾","colombia":"🇨🇴",
    "senegal":"🇸🇳","norway":"🇳🇴","morocco":"🇲🇦","ivory coast":"🇨🇮",
    "australia":"🇦🇺","saudi arabia":"🇸🇦","qatar":"🇶🇦","ghana":"🇬🇭",
    "nigeria":"🇳🇬","egypt":"🇪🇬","tunisia":"🇹🇳","algeria":"🇩🇿",
    "croatia":"🇭🇷","switzerland":"🇨🇭","belgium":"🇧🇪","denmark":"🇩🇰",
    "sweden":"🇸🇪","poland":"🇵🇱","austria":"🇦🇹","serbia":"🇷🇸",
    "ukraine":"🇺🇦","turkey":"🇹🇷","türkiye":"🇹🇷","south korea":"🇰🇷",
    "iran":"🇮🇷","uzbekistan":"🇺🇿","jordan":"🇯🇴","new zealand":"🇳🇿",
    "panama":"🇵🇦","costa rica":"🇨🇷","jamaica":"🇯🇲","haiti":"🇭🇹",
    "curacao":"🇨🇼","curaçao":"🇨🇼","paraguay":"🇵🇾","ecuador":"🇪🇨",
    "chile":"🇨🇱","peru":"🇵🇪","venezuela":"🇻🇪","bolivia":"🇧🇴",
    "bosnia and herzegovina":"🇧🇦","scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿",
    "czechia":"🇨🇿","czech republic":"🇨🇿","slovakia":"🇸🇰","hungary":"🇭🇺",
    "romania":"🇷🇴","greece":"🇬🇷","albania":"🇦🇱","georgia":"🇬🇪",
    "slovenia":"🇸🇮","cape verde":"🇨🇻","cabo verde":"🇨🇻","dr congo":"🇨🇩",
    "iraq":"🇮🇶"
  };
  return map[n] || "🏳️";
}

/* ============================================================
   i18n
   ============================================================ */
let currentLang = localStorage.getItem("bolao_lang") || "pt-BR";

function t(key) {
  return I18N[currentLang]?.[key] ?? I18N["pt-BR"]?.[key] ?? key;
}

function phaseLabel(phase) {
  return ({ "Round of 32": t("phaseR32"), "Round of 16": t("phaseR16"),
            "Quarterfinal": t("phaseQF"), "Semifinal": t("phaseSF"),
            "3rd Place": t("phaseThird"), "Final": t("phaseFinal"),
            "Fase de grupos": t("phaseGroup") })[phase] || phase;
}

function setLang(code) {
  if (!I18N[code]) return;
  currentLang = code;
  localStorage.setItem("bolao_lang", code);
  applyLanguage();
  renderAll();
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  $$("[data-i18n]").forEach(el => {
    const txt = t(el.dataset.i18n);
    if (txt !== el.dataset.i18n) el.textContent = txt;
  });
  $$("[data-lang]").forEach(b => b.classList.toggle("active", b.dataset.lang === currentLang));
  $$("[data-phase]").forEach(el => { el.textContent = phaseLabel(el.dataset.phase); });
  $$("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  const gl = $("#gamesUpdatedLabel"); if (gl) gl.textContent = DATA.updatedLabel || "";
  const af = $("#amountField"); if (af) af.value = t("amountValue");
}

/* ============================================================
   State (localStorage + Supabase mirror)
   ============================================================ */
function emptyState() {
  return { entries: [], paid: {}, results: {}, meta: { updatedAt: null, version: CONFIG.siteVersion } };
}

function state() {
  try {
    const raw = localStorage.getItem(CONFIG.storeKey);
    return raw ? Object.assign(emptyState(), JSON.parse(raw)) : emptyState();
  } catch { return emptyState(); }
}

function saveLocalState(s) {
  s.meta = { updatedAt: new Date().toISOString(), version: CONFIG.siteVersion };
  localStorage.setItem(CONFIG.storeKey, JSON.stringify(s));
}

let syncTimer = null;
function saveState(s) {
  saveLocalState(s);
  if (!dbEnabled()) return;
  clearTimeout(syncTimer);
  const snap = JSON.parse(JSON.stringify(s));
  syncTimer = setTimeout(() => saveRemoteState(snap).catch(err => console.warn("Sync failed", err)), 400);
}

/* ── Supabase ── */
let remoteDb = null;

function dbEnabled() {
  return !!(CONFIG.database?.enabled && CONFIG.database?.provider === "supabase" &&
            CONFIG.database?.url && CONFIG.database?.anonKey && window.supabase);
}

function initDb() {
  if (!dbEnabled() || remoteDb) return !!remoteDb;
  try { remoteDb = window.supabase.createClient(CONFIG.database.url, CONFIG.database.anonKey); return true; }
  catch (err) { console.warn("Supabase init failed", err); return false; }
}

function mergeStates(local, remote) {
  const byId = {};
  for (const e of (local.entries || [])) byId[e.id] = e;
  for (const e of (remote.entries || [])) {
    if (!byId[e.id] || (e.createdAt > (byId[e.id].createdAt || ""))) byId[e.id] = e;
  }
  const allPaidKeys = new Set([
    ...Object.keys(local.paid || {}),
    ...Object.keys(remote.paid || {})
  ]);
  const mergedPaid = {};
  for (const k of allPaidKeys) {
    mergedPaid[k] = !!(local.paid?.[k] || remote.paid?.[k]);
  }
  return {
    entries: Object.values(byId).sort((a, b) => (a.createdAt || "") > (b.createdAt || "") ? 1 : -1),
    paid: mergedPaid,
    results: Object.assign({}, local.results || {}, remote.results || {}),
    meta: { updatedAt: new Date().toISOString(), version: CONFIG.siteVersion }
  };
}

async function loadRemoteState() {
  if (!initDb()) return false;
  const cfg = CONFIG.database;
  try {
    const { data, error } = await remoteDb
      .from(cfg.table).select("state,updated_at")
      .eq("id", cfg.stateId || "main").maybeSingle();
    if (error) throw error;
    if (data?.state) {
      const local = state();
      const localAt = local.meta?.updatedAt || "";
      const remoteAt = data.updated_at || data.state.meta?.updatedAt || "";
      const merged = remoteAt > localAt ? mergeStates(local, data.state) : local;
      saveLocalState(merged);
      return true;
    }
    await saveRemoteState(state());
    return true;
  } catch (err) { console.warn("Remote load failed", err); return false; }
}

async function saveRemoteState(s) {
  if (!initDb()) return false;
  const cfg = CONFIG.database;
  try {
    const { data: cur } = await remoteDb
      .from(cfg.table).select("updated_at,state")
      .eq("id", cfg.stateId || "main").maybeSingle();
    if (cur) {
      const remoteAt = cur.updated_at || cur.state?.meta?.updatedAt || "";
      const localAt  = s.meta?.updatedAt || "";
      if (remoteAt > localAt) {
        const merged = mergeStates(s, cur.state || {});
        saveLocalState(merged);
        s = merged;
      }
    }
    const { error } = await remoteDb.from(cfg.table).upsert(
      { id: cfg.stateId || "main", state: s, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
    if (error) throw error;
    return true;
  } catch (err) { console.warn("Remote save failed", err); return false; }
}

async function reloadRemoteIfVisible() {
  if (document.hidden || !dbEnabled()) return;
  await loadRemoteState();
  renderAll();
}

let _reloadTimer = null;
function debouncedReload() {
  clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(() => reloadRemoteIfVisible().catch(err => console.warn("Reload failed", err)), 60);
}

/* ============================================================
   Cutoff
   ============================================================ */
function cutoffDate() { return new Date(CONFIG.cutoffIso); }
function isPastCutoff() { return Date.now() >= cutoffDate().getTime(); }

function updateCountdown() {
  const box = $("#countdown");
  if (!box) return;
  const diff = cutoffDate() - Date.now();
  if (diff <= 0) { box.innerHTML = `<strong>${escapeHtml(t("closed"))}</strong>`; return; }
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
  box.innerHTML = `<div class="count-grid">
    <div><b>${d}</b><span>${t("countdownDays")}</span></div>
    <div><b>${h}</b><span>${t("countdownHours")}</span></div>
    <div><b>${m}</b><span>${t("countdownMin")}</span></div>
    <div><b>${String(sec).padStart(2,"0")}</b><span>${t("countdownSec")}</span></div>
  </div>`;
  const lbl = $("#cutoffLabel");
  if (lbl) lbl.textContent = CONFIG.cutoffLabel;
}

/* ============================================================
   Admin
   ============================================================ */
function isAdminActive() {
  return sessionStorage.getItem("adminOk") === "true" &&
         Number(sessionStorage.getItem("adminUntil") || "0") > Date.now();
}

function guardAdmin() {
  if (isAdminActive()) return true;
  sessionStorage.removeItem("adminOk"); sessionStorage.removeItem("adminUntil");
  $("#adminArea")?.classList.add("hidden");
  $("#adminLogin")?.classList.remove("hidden");
  alert(t("adminExpired"));
  return false;
}

function extendAdmin() {
  if (isAdminActive())
    sessionStorage.setItem("adminUntil", String(Date.now() + CONFIG.adminSessionMinutes * 60000));
}

/* ============================================================
   Navigation
   ============================================================ */
function showSection(id) {
  $$(".page").forEach(p => p.classList.toggle("active", p.id === id));
  $$(".nav button[data-section]").forEach(b => b.classList.toggle("active", b.dataset.section === id));
  if (id === "admin") renderAdmin();
}

/* ============================================================
   Bracket helpers
   ============================================================ */
function resolveSlot(v, winners, losers) {
  const s = String(v || "");
  const id = (s.match(/Match\s+(\d+)/i) || [])[1];
  if (/^Winner/i.test(s)) return (id && winners[id]) || s;
  if (/^Loser/i.test(s)) return (id && losers[id]) || s;
  return s;
}

function winnerLabel(m) {
  return /final$|3rd/i.test(m.phase || "") ? t("winnerLabelFinal") : t("winnerLabelAdv");
}

function resolvedTeamsForEntry(entry) {
  const winners = {}, losers = {}, resolved = {};
  for (const m of DATA.knockoutMatches) {
    const p = entry.picks?.[m.match];
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    resolved[m.match] = { displayA: a, displayB: b };
    if (p?.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
    else if (p?.advanceSide === "B") { winners[m.match] = b; losers[m.match] = a; }
  }
  return resolved;
}

function finalPodiumForEntry(entry) {
  const r = resolvedTeamsForEntry(entry);
  let champion = "", runnerUp = "", thirdPlace = "", fourth = "";
  const fin = DATA.knockoutMatches.find(m => m.match === "104");
  const trd = DATA.knockoutMatches.find(m => m.match === "103");
  if (fin && entry.picks?.[fin.match]) {
    const p = entry.picks[fin.match], rr = r[fin.match] || {};
    champion = p.advanceSide === "A" ? rr.displayA : rr.displayB;
    runnerUp = p.advanceSide === "A" ? rr.displayB : rr.displayA;
  }
  if (trd && entry.picks?.[trd.match]) {
    const p = entry.picks[trd.match], rr = r[trd.match] || {};
    thirdPlace = p.advanceSide === "A" ? rr.displayA : rr.displayB;
    fourth     = p.advanceSide === "A" ? rr.displayB : rr.displayA;
  }
  return { champion, runnerUp, third: thirdPlace, fourth };
}

/* ============================================================
   Bracket form
   ============================================================ */
const DRAFT_KEY = "bolao_draft_v4";

function inferFromForm() {
  const winners = {}, losers = {};
  for (const m of DATA.knockoutMatches) {
    const card = $(`[data-card-match="${m.match}"]`);
    if (!card) continue;
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    card.dataset.currentA = a; card.dataset.currentB = b;
    const ga = parseScore(card.querySelector('[data-field="goalsA"]')?.value);
    const gb = parseScore(card.querySelector('[data-field="goalsB"]')?.value);
    const sel = card.querySelector('[data-field="advanceSide"]');
    const side = (ga !== null && gb !== null) ? (pickWinner(ga, gb) || sel?.value || "") : (sel?.value || "");
    if (side === "A") { winners[m.match] = a; losers[m.match] = b; }
    else if (side === "B") { winners[m.match] = b; losers[m.match] = a; }
  }
  return { winners, losers };
}

function updateCard(card, preW, preL) {
  const mid = card.dataset.cardMatch;
  const m = DATA.knockoutMatches.find(x => x.match === mid);
  if (!m) return;
  const { winners, losers } = preW ? { winners: preW, losers: preL } : inferFromForm();
  const a = resolveSlot(m.teamA, winners, losers);
  const b = resolveSlot(m.teamB, winners, losers);
  card.dataset.currentA = a; card.dataset.currentB = b;
  const teamA = card.querySelector(".team-a");
  const teamB = card.querySelector(".team-b");
  if (teamA) teamA.innerHTML = `${flag(a)} ${escapeHtml(a)}`;
  if (teamB) teamB.innerHTML = `${escapeHtml(b)} ${flag(b)}`;
  const slA = card.querySelector('[data-score-label="A"]');
  const slB = card.querySelector('[data-score-label="B"]');
  if (slA) slA.textContent = a;
  if (slB) slB.textContent = b;
  const sel = card.querySelector('[data-field="advanceSide"]');
  if (sel) {
    const optA = sel.querySelector('option[value="A"]');
    const optB = sel.querySelector('option[value="B"]');
    if (optA) optA.textContent = a;
    if (optB) optB.textContent = b;
    const ga = parseScore(card.querySelector('[data-field="goalsA"]')?.value);
    const gb = parseScore(card.querySelector('[data-field="goalsB"]')?.value);
    const note = card.querySelector(".auto-note");
    if (ga !== null && gb !== null) {
      const side = pickWinner(ga, gb);
      if (side) {
        sel.value = side; sel.disabled = true;
        if (note) note.textContent = t("autoAdvanceNote").replace("{team}", side === "A" ? a : b);
      } else {
        sel.disabled = false;
        if (note) note.textContent = t("tieNote");
      }
    } else {
      sel.disabled = false;
      if (card.querySelector('[data-field="goalsA"]')?.value === "" && note) note.textContent = "";
    }
  }
}

function updateProgress() {
  const total = DATA.knockoutMatches.length;
  let done = 0;
  for (const m of DATA.knockoutMatches) {
    const c = $(`[data-card-match="${m.match}"]`);
    if (!c) continue;
    const ga = c.querySelector('[data-field="goalsA"]')?.value;
    const gb = c.querySelector('[data-field="goalsB"]')?.value;
    if (ga !== "" && gb !== "") done++;
  }
  const pt = $("#progressText"), pb = $("#progressBar");
  if (pt) pt.textContent = `${done}/${total}`;
  if (pb) { pb.style.width = `${total ? (done / total) * 100 : 0}%`; pb.parentElement?.setAttribute("aria-valuenow", String(Math.round(done / total * 100))); }
}

let _draftTimer = null;
function saveDraftDebounced() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraft, 400);
}

function updateDynamic() {
  const { winners, losers } = inferFromForm();
  $$(".match-card[data-card-match]").forEach(card => updateCard(card, winners, losers));
  updateProgress();
  saveDraftDebounced();
}

function renderBracket() {
  const form = $("#bracketForm");
  if (!form) return;
  form.innerHTML = "";
  for (const m of DATA.knockoutMatches) {
    const card = document.createElement("div");
    card.className = "match-card";
    card.dataset.cardMatch = m.match;
    const venueHtml = m.venue && m.venue !== "A confirmar"
      ? `<span class="pill">📍 ${escapeHtml(m.venue)}</span>`
      : `<span class="pill">📍 ${escapeHtml(t("venueTbd"))}</span>`;
    card.innerHTML = `
      <div class="match-head">
        <span class="match-badge">Match ${escapeHtml(String(m.match))}</span>
        <span class="phase" data-phase="${escapeHtml(m.phase)}">${escapeHtml(phaseLabel(m.phase))}</span>
      </div>
      <div class="match-meta">
        ${m.date ? `<span class="pill">📅 ${escapeHtml(formatDate(m.date))}</span>` : ""}
        ${m.timeET ? `<span class="pill">🕒 ${escapeHtml(m.timeET)}</span>` : ""}
        ${venueHtml}
      </div>
      <div class="teams">
        <div class="team team-a"></div>
        <div class="vs">×</div>
        <div class="team team-b right"></div>
      </div>
      <div class="score-inputs">
        <label>
          <span data-score-label="A">${escapeHtml(m.teamA)}</span>
          <input type="number" min="0" max="20" step="1" inputmode="numeric" enterkeyhint="next" data-field="goalsA" autocomplete="off" data-i18n-aria="goalsTeamA" aria-label="${escapeHtml(t("goalsTeamA"))}">
        </label>
        <label>
          <span data-score-label="B">${escapeHtml(m.teamB)}</span>
          <input type="number" min="0" max="20" step="1" inputmode="numeric" enterkeyhint="next" data-field="goalsB" autocomplete="off" data-i18n-aria="goalsTeamB" aria-label="${escapeHtml(t("goalsTeamB"))}">
        </label>
      </div>
      <label aria-label="${escapeHtml(winnerLabel(m))}">${escapeHtml(winnerLabel(m))}
        <select data-field="advanceSide">
          <option value="">${escapeHtml(t("selectOption"))}</option>
          <option value="A">${escapeHtml(m.teamA)}</option>
          <option value="B">${escapeHtml(m.teamB)}</option>
        </select>
      </label>
      <div class="auto-note" aria-live="polite"></div>`;
    form.appendChild(card);
  }
  updateDynamic();
}

/* ── Draft ── */
function saveDraft() {
  try {
    const picks = {};
    for (const m of DATA.knockoutMatches) {
      const c = $(`[data-card-match="${m.match}"]`);
      if (!c) continue;
      picks[m.match] = {
        goalsA: c.querySelector('[data-field="goalsA"]')?.value || "",
        goalsB: c.querySelector('[data-field="goalsB"]')?.value || "",
        advanceSide: c.querySelector('[data-field="advanceSide"]')?.value || ""
      };
    }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      picks,
      name:   $("#entryName")?.value || "",
      payer:  $("#payerName")?.value || "",
      email:  $("#participantEmail")?.value || "",
      method: $("#paymentMethod")?.value || "",
      ts: Date.now()
    }));
  } catch { /* ignore */ }
}

function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft?.ts || Date.now() - draft.ts > 7200000) return;
    const hasSomething = Object.values(draft.picks || {}).some(p => p.goalsA !== "" || p.goalsB !== "");
    if (!hasSomething) return;
    if (!confirm(t("draftRestoreMsg"))) { sessionStorage.removeItem(DRAFT_KEY); return; }
    if (draft.name) { const el = $("#entryName"); if (el) el.value = draft.name; }
    if (draft.payer) { const el = $("#payerName"); if (el) el.value = draft.payer; }
    if (draft.email) { const el = $("#participantEmail"); if (el) el.value = draft.email; }
    if (draft.method) { const el = $("#paymentMethod"); if (el) el.value = draft.method; }
    for (const m of DATA.knockoutMatches) {
      const c = $(`[data-card-match="${m.match}"]`);
      const p = draft.picks?.[m.match];
      if (!c || !p) continue;
      const ga = c.querySelector('[data-field="goalsA"]'); if (ga) ga.value = p.goalsA;
      const gb = c.querySelector('[data-field="goalsB"]'); if (gb) gb.value = p.goalsB;
      const sel = c.querySelector('[data-field="advanceSide"]'); if (sel) sel.value = p.advanceSide;
    }
    updateDynamic();
  } catch { /* ignore */ }
}

/* ============================================================
   Validation
   ============================================================ */
function scoreWarningLevel(a, b) {
  const max = Math.max(a, b), diff = Math.abs(a - b);
  if (max >= 10 || diff >= 8) return "extreme";
  return "normal";
}

function confirmUnusualScores(picks) {
  const rep = {};
  let hasExtreme = false;
  for (const p of Object.values(picks)) {
    const k = `${p.goalsA}x${p.goalsB}`;
    rep[k] = (rep[k] || 0) + 1;
    if (scoreWarningLevel(p.goalsA, p.goalsB) === "extreme") hasExtreme = true;
  }
  if (hasExtreme && !confirm(`${t("crazyScoreWarning")}\n\n${t("keepScore")}`)) return false;
  if (Object.values(rep).some(n => n >= 8) && !confirm(`${t("repetitiveWarning")}\n\n${t("keepScore")}`)) return false;
  return true;
}

async function readEntryFromForm() {
  updateDynamic();
  const entryName       = ($("#entryName")?.value || "").trim();
  const payerName       = ($("#payerName")?.value || "").trim();
  const participantEmail = ($("#participantEmail")?.value || "").trim();
  const paymentMethod   = $("#paymentMethod")?.value || "";

  if (!entryName)                       { alert(t("requiredEntryName")); return null; }
  if (!payerName)                       { alert(t("requiredPayerName")); return null; }
  if (!isValidEmail(participantEmail))  { alert(t("invalidEmail")); $("#participantEmail")?.focus(); return null; }
  if (!paymentMethod)                   { alert(t("requiredPaymentMethod")); return null; }

  const picks = {};
  for (const m of DATA.knockoutMatches) {
    const c = $(`[data-card-match="${m.match}"]`);
    const gaRaw = c?.querySelector('[data-field="goalsA"]')?.value;
    const gbRaw = c?.querySelector('[data-field="goalsB"]')?.value;
    if (gaRaw === "" || gaRaw === undefined || gbRaw === "" || gbRaw === undefined) {
      alert(`${t("missingScore")} Match ${m.match}`);
      $(`[data-card-match="${m.match}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return null;
    }
    const ga = parseScore(gaRaw), gb = parseScore(gbRaw);
    if (ga === null || gb === null) {
      alert(`${t("invalidScore")} Match ${m.match}`);
      $(`[data-card-match="${m.match}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return null;
    }
    const autoSide = pickWinner(ga, gb);
    const sel = c?.querySelector('[data-field="advanceSide"]');
    const side = autoSide || (sel?.value || "");
    if (autoSide && sel?.value && autoSide !== sel.value) { alert(`${t("inconsistentAdvance")} ${m.match}`); return null; }
    if (!side) { alert(`${t("tieNeedsAdvance")} Match ${m.match}`); return null; }
    picks[m.match] = {
      goalsA: ga, goalsB: gb, advanceSide: side,
      displayA: c?.dataset.currentA || m.teamA,
      displayB: c?.dataset.currentB || m.teamB
    };
  }
  if (!confirmUnusualScores(picks)) return null;

  let diagnostics = {};
  try {
    diagnostics = {
      userAgent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${innerWidth}x${innerHeight}`,
      capturedAt: new Date().toISOString()
    };
  } catch { /* non-critical */ }

  return {
    id: generateId(), entryName, payerName, participantEmail, paymentMethod,
    paymentTo: CONFIG.paymentMethods[paymentMethod] || "",
    createdAt: new Date().toISOString(), diagnostics, picks
  };
}

/* ============================================================
   Scoring
   ============================================================ */
function podiumFromResults(s) {
  const winners = {}, losers = {};
  for (const m of DATA.knockoutMatches) {
    const r = (s.results || {})[m.match];
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    if (!r?.advanceSide) continue;
    if (r.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
    else { winners[m.match] = b; losers[m.match] = a; }
  }
  const fin = DATA.knockoutMatches.find(m => m.match === "104");
  const trd = DATA.knockoutMatches.find(m => m.match === "103");
  const rFin = fin && (s.results || {})[fin.match];
  const rTrd = trd && (s.results || {})[trd.match];
  if (!rFin?.advanceSide) return null;
  const fA = resolveSlot(fin.teamA, winners, losers), fB = resolveSlot(fin.teamB, winners, losers);
  const champion = rFin.advanceSide === "A" ? fA : fB;
  const runnerUp = rFin.advanceSide === "A" ? fB : fA;
  let thirdPlace = "", fourth = "";
  if (rTrd?.advanceSide) {
    const tA = resolveSlot(trd.teamA, winners, losers), tB = resolveSlot(trd.teamB, winners, losers);
    thirdPlace = rTrd.advanceSide === "A" ? tA : tB;
    fourth     = rTrd.advanceSide === "A" ? tB : tA;
  }
  return { champion, runnerUp, third: thirdPlace, fourth };
}

function scoreEntry(entry, s) {
  let total = 0;
  const results = s.results || {};
  for (const m of DATA.knockoutMatches) {
    const p = entry.picks?.[m.match], r = results[m.match];
    if (!p || !r?.advanceSide) continue;
    const pA = Number(p.goalsA), pB = Number(p.goalsB);
    const rA = Number(r.goalsA), rB = Number(r.goalsB);
    if (isNaN(rA) || isNaN(rB)) continue;
    if (pA === rA && pB === rB) {
      total += CONFIG.scoring.exactScore;
    } else {
      if (pA === rA) total += CONFIG.scoring.oneTeamGoals;
      if (pB === rB) total += CONFIG.scoring.oneTeamGoals;
    }
    if (p.advanceSide === r.advanceSide) total += CONFIG.scoring.advance;
  }
  const bonus = { champion: 0, runnerUp: 0, third: 0, fourth: 0, total: 0 };
  const realPod = podiumFromResults(s);
  if (realPod) {
    const pickPod = finalPodiumForEntry(entry);
    if (pickPod.champion && pickPod.champion === realPod.champion) bonus.champion = CONFIG.bonus.champion;
    if (pickPod.runnerUp && pickPod.runnerUp === realPod.runnerUp) bonus.runnerUp = CONFIG.bonus.runnerUp;
    if (pickPod.third    && pickPod.third    === realPod.third)    bonus.third    = CONFIG.bonus.third;
    if (pickPod.fourth   && pickPod.fourth   === realPod.fourth)   bonus.fourth   = CONFIG.bonus.fourth;
    bonus.total = bonus.champion + bonus.runnerUp + bonus.third + bonus.fourth;
    total += bonus.total;
  }
  return { total, bonus };
}

/* ============================================================
   Receipt HTML
   ============================================================ */
function receiptHtml(entry) {
  const r = resolvedTeamsForEntry(entry);
  const pod = finalPodiumForEntry(entry);
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks?.[m.match], rr = r[m.match] || {};
    if (!p) return "";
    const w = p.advanceSide === "A" ? rr.displayA : rr.displayB;
    return `<tr><td>M${escapeHtml(String(m.match))}<br><small>${escapeHtml(phaseLabel(m.phase))}</small></td><td>${escapeHtml(rr.displayA||"")}</td><td><b>${p.goalsA} × ${p.goalsB}</b></td><td>${escapeHtml(rr.displayB||"")}</td><td><b>${escapeHtml(w||"")}</b></td></tr>`;
  }).join("");

  return `<!doctype html><html lang="${currentLang}"><head><meta charset="utf-8">
<title>${escapeHtml(t("receiptTitle"))}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;color:#111}
.doc{max-width:900px;margin:24px auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 40px #0002}
h1{margin:0 0 4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f1f5f9;border-radius:14px;padding:14px;margin:18px 0}
.code{font-family:monospace;color:#087a35;font-weight:bold}.pod{background:linear-gradient(135deg,#07151c,#0f3b22);color:#fff;border-radius:18px;padding:18px;margin:22px 0}
.pod h2{text-align:center;margin:0 0 14px}.podgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.podcard{border-radius:14px;padding:14px;text-align:center;background:#ffffff18}
.champ{grid-column:1/3;background:#ffd35a;color:#111}.team-name{font-size:22px;font-weight:900;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:10px}td,th{padding:8px 10px;border-bottom:1px solid #dde}
th{background:#07151c;color:#fff;text-align:left}
.notice{background:#fff4cc;border:1px solid #e8c65b;border-radius:12px;padding:12px;margin-top:16px;font-size:13px}
@media print{body{background:#fff}.doc{box-shadow:none;margin:0;border-radius:0;padding:10px}}</style></head>
<body><div class="doc">
<h1>${escapeHtml(t("receiptTitle"))}</h1>
<p>${escapeHtml(t("receiptIntro"))}</p>
<div class="meta">
<div><b>${escapeHtml(t("receiptEntry"))}:</b> ${escapeHtml(entry.entryName)}<br>
<b>${escapeHtml(t("receiptResponsible"))}:</b> ${escapeHtml(entry.payerName)}<br>
<b>${escapeHtml(t("receiptEmail"))}:</b> ${escapeHtml(entry.participantEmail)}</div>
<div><b>${escapeHtml(t("receiptPayment"))}:</b> ${escapeHtml(entry.paymentMethod)} — ${escapeHtml(entry.paymentTo||"")}<br>
<b>${escapeHtml(t("receiptSentAt"))}:</b> ${new Date(entry.createdAt).toLocaleString(currentLang)}<br>
<b>${escapeHtml(t("receiptCode"))}:</b> <span class="code">${escapeHtml(receiptCode(entry))}</span></div></div>
<div class="pod"><h2>${escapeHtml(t("receiptFinalPick"))}</h2><div class="podgrid">
<div class="podcard champ"><div>${escapeHtml(t("receiptChampion"))}</div><div class="team-name">${escapeHtml(pod.champion||"—")}</div></div>
<div class="podcard"><div>${escapeHtml(t("receiptRunnerUp"))}</div><div class="team-name">${escapeHtml(pod.runnerUp||"—")}</div></div>
<div class="podcard"><div>${escapeHtml(t("receiptThird"))}</div><div class="team-name">${escapeHtml(pod.third||"—")}</div></div>
<div class="podcard"><div>${escapeHtml(t("receiptFourth"))}</div><div class="team-name">${escapeHtml(pod.fourth||"—")}</div></div>
</div></div>
<table><thead><tr><th>${escapeHtml(t("receiptGame"))}</th><th>${escapeHtml(t("receiptTeamA"))}</th><th>${escapeHtml(t("receiptScore"))}</th><th>${escapeHtml(t("receiptTeamB"))}</th><th>${escapeHtml(t("receiptWinner"))}</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="notice"><b>${escapeHtml(t("receiptRuleLabel"))}:</b> ${escapeHtml(t("receiptRuleText"))}</div>
<div class="notice" style="margin-top:12px"><b>${escapeHtml(t("receiptLegendTitle"))}:</b> ${escapeHtml(t("receiptLegendExact"))} &middot; ${escapeHtml(t("receiptLegendAdvance"))} &middot; ${escapeHtml(t("receiptLegendOneTeam"))} &middot; ${escapeHtml(t("receiptLegendChampion"))} &middot; ${escapeHtml(t("receiptLegendRunnerUp"))} &middot; ${escapeHtml(t("receiptLegendThird"))} &middot; ${escapeHtml(t("receiptLegendFourth"))}</div>
<div style="margin-top:16px;border:2px dashed #b0cdb0;border-radius:14px;padding:16px">
<b>${escapeHtml(t("receiptCheckTitle"))}</b>
<table style="width:100%;font-size:12px;margin-top:10px;border-collapse:collapse">
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendExact"))}</td><td style="text-align:center;width:40px;border-bottom:1px solid #dde">x____</td><td style="text-align:right;width:80px;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendAdvance"))}</td><td style="text-align:center;border-bottom:1px solid #dde">x____</td><td style="text-align:right;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendOneTeam"))}</td><td style="text-align:center;border-bottom:1px solid #dde">x____</td><td style="text-align:right;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendChampion"))}</td><td style="border-bottom:1px solid #dde"></td><td style="text-align:right;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendRunnerUp"))}</td><td style="border-bottom:1px solid #dde"></td><td style="text-align:right;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendThird"))}</td><td style="border-bottom:1px solid #dde"></td><td style="text-align:right;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td style="padding:4px 6px;border-bottom:1px solid #dde">${escapeHtml(t("receiptLegendFourth"))}</td><td style="border-bottom:1px solid #dde"></td><td style="text-align:right;border-bottom:1px solid #dde">____ pts</td></tr>
<tr><td colspan="2" style="padding:8px 6px;font-weight:bold">${escapeHtml(t("receiptCheckTotal"))}</td><td style="text-align:right;font-weight:bold;font-size:15px">____ pts</td></tr>
</table>
<p style="margin:12px 0 0;font-size:12px;color:#777">${escapeHtml(t("receiptCheckBy"))}: ___________________________ &nbsp;&nbsp;&nbsp; ${escapeHtml(t("receiptCheckDate"))}: ___________</p>
</div>
</div></body></html>`;
}

function openReceipt(id) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  const blob = new Blob([receiptHtml(e)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) { URL.revokeObjectURL(url); alert(t("receiptPopupBlocked")); return; }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function downloadReceipt(id) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  downloadBlob(`comprovante-${receiptCode(e)}.html`, receiptHtml(e), "text/html");
}

function renderLatestReceipt(e) {
  const box = $("#latestReceiptBox");
  if (!box) return;
  const code = escapeHtml(receiptCode(e)), id = escapeHtml(e.id);
  box.classList.remove("hidden");
  box.innerHTML = `<h2>${escapeHtml(t("savedTitle"))}</h2>
<p>${escapeHtml(t("savedText"))}</p>
<div class="receipt-code">${code}</div>
<div class="receipt-actions">
  <button type="button" data-action="open" data-eid="${id}">${escapeHtml(t("openReceipt"))}</button>
  <button type="button" class="secondary" data-action="download" data-eid="${id}">${escapeHtml(t("downloadHtml"))}</button>
  <button type="button" class="secondary" data-action="email-p" data-eid="${id}">${escapeHtml(t("sendEmail"))}</button>
</div>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ============================================================
   EmailJS
   ============================================================ */
function setupEmailJs() {
  if (!window.emailjs || !CONFIG.emailjs.enabled) return;
  try {
    emailjs.init({ publicKey: CONFIG.emailjs.publicKey, limitRate: { throttle: CONFIG.emailjs.limitRateMs || 30000 } });
  } catch (err) { console.warn("EmailJS init error", err); }
}

async function mailReceipt(id, target) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  const to = target === "admin" ? CONFIG.adminEmail : e.participantEmail;
  if (!isValidEmail(to)) { alert(t("invalidEmail")); return; }
  if (!window.emailjs) { alert(t("emailjsNotLoaded")); return; }
  const template = target === "admin" ? CONFIG.emailjs.adminTemplateId : CONFIG.emailjs.participantTemplateId;
  try {
    await emailjs.send(CONFIG.emailjs.serviceId, template, {
      to_email: to, entry_name: e.entryName, receipt_code: receiptCode(e), html_message: receiptHtml(e)
    }, { publicKey: CONFIG.emailjs.publicKey });
    alert(t("emailSent"));
  } catch (err) {
    console.warn("Email failed", err);
    alert(`${t("emailjsNotLoaded")}: ${err?.text || err?.message || String(err)}`);
  }
}

async function sendRemovalEmail(e, reason) {
  if (!isValidEmail(e.participantEmail) || !window.emailjs) return;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<h2>${escapeHtml(t("removalEmailTitle"))}</h2>
<p><b>${escapeHtml(t("receiptEntry"))}:</b> ${escapeHtml(e.entryName)}</p>
<p><b>${escapeHtml(t("receiptCode"))}:</b> ${escapeHtml(receiptCode(e))}</p>
${reason ? `<p><b>${escapeHtml(t("deleteReasonPrompt"))}</b> ${escapeHtml(reason)}</p>` : ""}
<p>${escapeHtml(t("removalEmailContact"))}</p></div>`;
  try {
    await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId, {
      to_email: e.participantEmail, entry_name: `REMOVIDA — ${e.entryName}`,
      receipt_code: receiptCode(e), html_message: html
    }, { publicKey: CONFIG.emailjs.publicKey });
  } catch (err) { console.warn("Removal email failed", err); }
}

/* ============================================================
   Render sections
   ============================================================ */
function renderPaymentBox() {
  const method = $("#paymentMethod")?.value;
  const box = $("#paymentBox");
  if (!box) return;
  if (!method) { box.innerHTML = ""; return; }
  const to = escapeHtml(CONFIG.paymentMethods[method] || "");
  const link = CONFIG.paymentLinks[method] || "";
  const icon = { CashApp: "💚", Zelle: "💜", Venmo: "🔵" }[method] || "💳";
  box.innerHTML = `<div class="pay-card">
<div class="pay-icon">${icon}</div>
<div><b>${escapeHtml(method)}</b><br><span class="muted">${to}</span>
${link ? `<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("paymentOpenLink"))}</a>` : ""}</div></div>`;
}

function lockIfCutoff() {
  const closed = isPastCutoff();
  const btn = $("#saveEntry");
  if (btn) btn.disabled = closed;
  if (closed) $$("#bracketForm input,#bracketForm select,#smartPick,#randomPick").forEach(el => { el.disabled = true; });
}

function renderRanking() {
  const s = state(), box = $("#rankingList");
  if (!box) return;
  if (!s.entries.length) { box.innerHTML = `<div class="card"><p>${escapeHtml(t("noEntries"))}</p></div>`; return; }
  const ranked = s.entries
    .map(e => { const sc = scoreEntry(e, s); return { ...e, _score: sc.total, _bonus: sc.bonus }; })
    .sort((a, b) => b._score - a._score);
  box.innerHTML = "";
  ranked.forEach((e, i) => {
    const medal = ["🥇","🥈","🥉"][i] || `${i + 1}`;
    const bonusLine = e._bonus?.total ? ` · ${t("bonusLabel")} +${e._bonus.total}` : "";
    const demoBadge = e.diagnostics?.demo ? ' <span class="demo-badge">Demo</span>' : "";
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
<div class="rank-pos">${medal}</div>
<div><b>${escapeHtml(e.entryName)}</b>${demoBadge}<br>
<span class="muted">${escapeHtml(e.payerName)}${escapeHtml(bonusLine)}</span><br>
<span class="receipt-code">${escapeHtml(receiptCode(e))}</span></div>
<div class="points">${e._score}</div>
<button type="button" class="secondary small-btn" data-rank-toggle="${escapeHtml(e.id)}">${escapeHtml(t("viewPicks"))}</button>`;
    box.appendChild(row);
    const detail = document.createElement("div");
    detail.className = "card picks-detail hidden";
    detail.dataset.rankDetail = e.id;
    detail.innerHTML = picksTable(e);
    box.appendChild(detail);
  });
}

function picksTable(entry) {
  const r = resolvedTeamsForEntry(entry);
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks?.[m.match], rr = r[m.match] || {};
    if (!p) return "";
    const w = p.advanceSide === "A" ? rr.displayA : rr.displayB;
    return `<tr><td>M${escapeHtml(String(m.match))}</td><td>${escapeHtml(rr.displayA||"")}</td><td><b>${p.goalsA}×${p.goalsB}</b></td><td>${escapeHtml(rr.displayB||"")}</td><td>${escapeHtml(w||"")}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>${escapeHtml(t("receiptGame"))}</th><th>${escapeHtml(t("receiptTeamA"))}</th><th>${escapeHtml(t("receiptScore"))}</th><th>${escapeHtml(t("receiptTeamB"))}</th><th>${escapeHtml(t("receiptWinner"))}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderParticipants() {
  const s = state(), box = $("#participantsList");
  if (!box) return;
  if (!s.entries.length) { box.innerHTML = `<div class="card"><p>${escapeHtml(t("noEntries"))}</p></div>`; return; }
  box.innerHTML = "";
  for (const e of s.entries) {
    const div = document.createElement("div");
    div.className = "rank-row";
    const paid = s.paid[e.id];
    div.innerHTML = `<div>👤</div>
<div><b>${escapeHtml(e.entryName)}</b><br><span class="muted">${escapeHtml(e.payerName)} · ${escapeHtml(e.paymentMethod)}</span></div>
<div class="status-chip ${paid ? "done" : "pending"}">${escapeHtml(paid ? t("paymentPaid") : t("paymentPending"))}</div>`;
    box.appendChild(div);
  }
}

function renderPayment() {
  const box = $("#paymentMethods");
  if (!box) return;
  box.innerHTML = "";
  for (const [method, value] of Object.entries(CONFIG.paymentMethods)) {
    const link = CONFIG.paymentLinks[method] || "";
    const icon = { CashApp: "💚", Zelle: "💜", Venmo: "🔵" }[method] || "💳";
    const div = document.createElement("div");
    div.className = "card pay-card";
    div.innerHTML = `<div class="pay-icon">${icon}</div>
<div><b>${escapeHtml(method)}</b><br><span class="muted">${escapeHtml(value)}</span>
${link ? `<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("paymentOpenLink"))}</a>` : ""}
${method === "Zelle" && CONFIG.zelle?.qrImage ? `<br><img src="${escapeHtml(CONFIG.zelle.qrImage)}" alt="Zelle QR" style="max-width:120px;margin-top:8px;border-radius:8px">` : ""}</div>`;
    box.appendChild(div);
  }
}

function renderGames() {
  const box = $("#gamesList");
  if (!box) return;
  box.innerHTML = "";
  const s = state();
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  for (const m of all) {
    const r = (s.results || {})[m.match];
    const goalsA = r?.goalsA !== undefined ? r.goalsA : m.goalsA;
    const goalsB = r?.goalsB !== undefined ? r.goalsB : m.goalsB;
    const status = r?.advanceSide ? "Final" : m.status;
    const hasScore = goalsA !== null && goalsA !== undefined && goalsB !== null && goalsB !== undefined;
    const venue = m.venue && m.venue !== "A confirmar" ? m.venue : "";
    const a = m.teamA || "", b = m.teamB || "";
    const div = document.createElement("div");
    div.className = "game-card";
    div.innerHTML = `
<div class="game-top">
  <span class="match-badge">${escapeHtml(String(m.match))}</span>
  <span class="muted">${escapeHtml(phaseLabel(m.phase || "Fase de grupos"))}${m.group ? ` — ${escapeHtml(t("groupLabel"))} ${escapeHtml(m.group)}` : ""}</span>
  <span class="status-chip ${status === "Final" ? "done" : "pending"}">${escapeHtml(status === "Final" ? t("gameFinal") : t("gamePending"))}</span>
</div>
<div class="game-meta">
  ${m.date  ? `<span class="pill">📅 ${escapeHtml(formatDate(m.date))}</span>` : ""}
  ${m.timeET ? `<span class="pill">🕒 ${escapeHtml(m.timeET)}</span>` : ""}
  ${venue   ? `<span class="pill">📍 ${escapeHtml(venue)}</span>` : ""}
</div>
<div class="game-teams">
  <div class="game-team">${flag(a)} ${escapeHtml(a)}</div>
  ${hasScore ? `<div class="game-score">${goalsA} — ${goalsB}</div>` : `<div class="game-score muted">×</div>`}
  <div class="game-team right">${escapeHtml(b)} ${flag(b)}</div>
</div>`;
    box.appendChild(div);
  }
}

function renderRules() {
  const box = $("#rulesContent");
  if (!box) return;
  const SC = CONFIG.scoring, BN = CONFIG.bonus;
  box.innerHTML = `
<div class="card">
  <h3>${escapeHtml(t("rulesScoringTitle"))}</h3>
  <table class="rules-table"><tbody>
    <tr><td>${escapeHtml(t("scoreExact"))}</td><td>${SC.exactScore} pts</td></tr>
    <tr><td>${escapeHtml(t("scoreAdvance"))}</td><td>${SC.advance} pts</td></tr>
    <tr><td>${escapeHtml(t("scoreOneTeamGoals"))}</td><td>${SC.oneTeamGoals} pt</td></tr>
    <tr><td>${escapeHtml(t("scoreChampion"))}</td><td>+${BN.champion} pts</td></tr>
    <tr><td>${escapeHtml(t("scoreRunnerUp"))}</td><td>+${BN.runnerUp} pts</td></tr>
    <tr><td>${escapeHtml(t("scoreThird"))}</td><td>+${BN.third} pts</td></tr>
    <tr><td>${escapeHtml(t("scoreFourth"))}</td><td>+${BN.fourth} pts</td></tr>
  </tbody></table>
</div>
<div class="card">
  <h3>${escapeHtml(t("rulesMainTitle"))}</h3>
  <ul class="rules-list">
    <li>${escapeHtml(t("rulesEntryFee"))}</li>
    <li>${escapeHtml(t("rulesPrize"))}</li>
    <li>${escapeHtml(t("rulesCutoff"))}</li>
    <li>${escapeHtml(t("rulesValidScore"))}</li>
    <li>${escapeHtml(t("rulesTie"))}</li>
    <li>${escapeHtml(t("rulesBracket"))}</li>
    <li>${escapeHtml(t("rulesBonus"))}</li>
    <li>${escapeHtml(t("rulesInformal"))}</li>
    <li>${escapeHtml(t("rulesReceipt"))}</li>
    <li>${escapeHtml(t("rulesPayment"))}</li>
  </ul>
  <p class="footer-note">${escapeHtml(CONFIG.transparency.disclaimer)}</p>
</div>`;
}

/* ── Admin render ── */
function renderAdmin() {
  if (!isAdminActive()) return;
  extendAdmin();
  const s = state();
  renderAdminReceipts(s);
  renderAdminPayments(s);
  renderAdminResults(s);
}

function renderAdminReceipts(s) {
  const box = $("#adminReceipts");
  if (!box) return;
  box.innerHTML = `<h3>${escapeHtml(t("adminReceipts"))}</h3>`;
  if (!s.entries.length) { box.innerHTML += `<p>${escapeHtml(t("noEntries"))}</p>`; return; }
  for (const e of s.entries) {
    const id = escapeHtml(e.id);
    const div = document.createElement("div");
    div.className = "card admin-entry";
    div.innerHTML = `<b>${escapeHtml(e.entryName)}</b><br>
<span class="muted">${escapeHtml(e.payerName)} · ${escapeHtml(e.participantEmail || "")}</span><br>
<span class="receipt-code">${escapeHtml(receiptCode(e))}</span>
<div class="receipt-actions">
  <button type="button" class="small-btn" data-act="open" data-id="${id}">${escapeHtml(t("openReceipt"))}</button>
  <button type="button" class="small-btn secondary" data-act="html" data-id="${id}">${escapeHtml(t("downloadHtml"))}</button>
  <button type="button" class="small-btn secondary" data-act="emailp" data-id="${id}">${escapeHtml(t("participantEmailBtn"))}</button>
  <button type="button" class="small-btn secondary" data-act="emaila" data-id="${id}">${escapeHtml(t("adminEmailBtn"))}</button>
  <button type="button" class="small-btn danger" data-act="delete" data-id="${id}">${escapeHtml(t("deleteEntry"))}</button>
</div>`;
    box.appendChild(div);
  }
}

function renderAdminPayments(s) {
  const box = $("#paymentsAdmin");
  if (!box) return;
  box.innerHTML = `<h3>${escapeHtml(t("adminPayments"))}</h3>`;
  for (const e of s.entries) {
    const id = escapeHtml(e.id);
    const div = document.createElement("div");
    div.className = "rank-row";
    div.innerHTML = `<div>💵</div>
<div><b>${escapeHtml(e.entryName)}</b><br>${escapeHtml(e.paymentMethod)} → ${escapeHtml(e.paymentTo || "")}</div>
<label><input type="checkbox" data-paid="${id}" ${s.paid[e.id] ? "checked" : ""}> ${escapeHtml(t("paymentPaid"))}</label>`;
    box.appendChild(div);
  }
}

function inferRealWinners(s) {
  const winners = {}, losers = {};
  for (const m of DATA.knockoutMatches) {
    const r = (s.results || {})[m.match];
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    if (!r?.advanceSide) continue;
    if (r.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
    else { winners[m.match] = b; losers[m.match] = a; }
  }
  return { winners, losers };
}

function renderAdminResults(s) {
  const box = $("#resultsAdmin");
  if (!box) return;
  const { winners, losers } = inferRealWinners(s);
  box.innerHTML = `<h3>${escapeHtml(t("adminResults"))}</h3>`;
  for (const m of DATA.knockoutMatches) {
    const r = (s.results || {})[m.match] || {};
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    const div = document.createElement("div");
    div.className = "match-card";
    div.dataset.realMatch = m.match;
    div.innerHTML = `
<div class="match-head">
  <span class="match-badge">Match ${escapeHtml(String(m.match))}</span>
  <span class="phase">${escapeHtml(phaseLabel(m.phase))}</span>
</div>
<div class="teams">
  <div>${flag(a)} ${escapeHtml(a)}</div>
  <div class="vs">×</div>
  <div>${escapeHtml(b)} ${flag(b)}</div>
</div>
<div class="score-inputs">
  <input type="number" min="0" max="20" inputmode="numeric" data-real-field="goalsA" value="${r.goalsA !== undefined && r.goalsA !== null ? r.goalsA : ""}" autocomplete="off">
  <input type="number" min="0" max="20" inputmode="numeric" data-real-field="goalsB" value="${r.goalsB !== undefined && r.goalsB !== null ? r.goalsB : ""}" autocomplete="off">
</div>
<label>${escapeHtml(winnerLabel(m))}
  <select data-real-field="advanceSide">
    <option value="">${escapeHtml(t("selectOption"))}</option>
    <option value="A" ${r.advanceSide === "A" ? "selected" : ""}>${escapeHtml(a)}</option>
    <option value="B" ${r.advanceSide === "B" ? "selected" : ""}>${escapeHtml(b)}</option>
  </select>
</label>`;
    updateRealCard(div);
    box.appendChild(div);
  }
}

function updateRealCard(card) {
  const ga = parseScore(card.querySelector('[data-real-field="goalsA"]')?.value);
  const gb = parseScore(card.querySelector('[data-real-field="goalsB"]')?.value);
  const sel = card.querySelector('[data-real-field="advanceSide"]');
  if (!sel) return;
  if (ga !== null && gb !== null) {
    const side = pickWinner(ga, gb);
    if (side) { sel.value = side; sel.disabled = true; }
    else sel.disabled = false;
  }
}

function commitRealResult(card) {
  const mid = card.dataset.realMatch;
  const ga = parseScore(card.querySelector('[data-real-field="goalsA"]')?.value);
  const gb = parseScore(card.querySelector('[data-real-field="goalsB"]')?.value);
  const sel = card.querySelector('[data-real-field="advanceSide"]');
  if (ga === null || gb === null) return;
  const auto = pickWinner(ga, gb);
  const side = auto || (sel?.value || "");
  if (!side) return;
  const s = state();
  s.results[mid] = { goalsA: ga, goalsB: gb, advanceSide: side };
  saveState(s);
  renderRanking();
  renderGames();
}

/* ============================================================
   CSV / export
   ============================================================ */
function csvEscape(v) { const s = String(v ?? ""); return `"${s.replace(/"/g, '""')}"`; }
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = [...rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set())];
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) lines.push(headers.map(h => csvEscape(r[h])).join(","));
  return lines.join("\r\n");
}

function exportRows(full) {
  const s = state();
  return s.entries.map(e => {
    const sc = scoreEntry(e, s);
    const row = { id: e.id, receiptCode: receiptCode(e), entryName: e.entryName, payerName: e.payerName,
                  email: e.participantEmail, paymentMethod: e.paymentMethod,
                  paid: s.paid[e.id] ? "sim" : "nao", createdAt: e.createdAt, score: sc.total };
    if (full) {
      for (const m of DATA.knockoutMatches) {
        const p = e.picks?.[m.match];
        row[`match_${m.match}`] = p ? `${p.displayA} ${p.goalsA}x${p.goalsB} ${p.displayB} adv:${p.advanceSide}` : "";
      }
    }
    return row;
  });
}

function backupJson()  { downloadBlob(`bolao-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), state: state() }, null, 2), "application/json"); }
function backupCsv()   { downloadBlob(`bolao-backup-${new Date().toISOString().slice(0,10)}.csv`, toCsv(exportRows(true)), "text/csv"); }
function masterCsv()   { downloadBlob(`bolao-master-${new Date().toISOString().slice(0,10)}.csv`, toCsv(exportRows(false)), "text/csv"); }
function masterHtml()  {
  const trs = exportRows(false).map(r => `<tr><td>${escapeHtml(r.entryName)}</td><td>${escapeHtml(r.payerName)}</td><td>${r.score}</td><td>${r.paid}</td><td>${escapeHtml(r.receiptCode)}</td></tr>`).join("\n");
  downloadBlob("master-list.html", `<!doctype html><html><head><meta charset="utf-8"><title>Master List</title><style>body{font-family:Arial;padding:20px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ddd}th{background:#07151c;color:#fff}</style></head><body><h1>Master List — Bolão Copa 2026</h1><p>${new Date().toLocaleString(currentLang)}</p><table><thead><tr><th>${t("receiptEntry")}</th><th>${t("payerName")}</th><th>${t("points")}</th><th>${t("paymentPaid")}</th><th>${t("receiptCode")}</th></tr></thead><tbody>${trs}</tbody></table></body></html>`, "text/html");
}

/* ============================================================
   Simulator
   ============================================================ */
function teamStrength(name) {
  const map = DATA.strength || {};
  const lower = String(name || "").toLowerCase();
  for (const [k, v] of Object.entries(map)) { if (k.toLowerCase() === lower) return v; }
  return 60;
}

function predictScore(a, b, mode) {
  if (mode === "random") return [Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)];
  const diff = teamStrength(a) - teamStrength(b);
  const aWins = Math.random() < 1 / (1 + Math.exp(-diff / 8));
  const close = Math.abs(diff) < 8;
  return aWins ? (close ? [2,1] : [3,1]) : (close ? [1,2] : [1,3]);
}

async function autoFill(mode) {
  if (isPastCutoff()) { alert(t("closed")); return; }
  const filled = $$('[data-field="goalsA"],[data-field="goalsB"]').some(el => el.value !== "");
  if (filled && !confirm(t("overwritePicks"))) return;
  const winners = {}, losers = {};
  for (const m of DATA.knockoutMatches) {
    const c = $(`[data-card-match="${m.match}"]`);
    if (!c) continue;
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    const [ga, gb] = predictScore(a, b, mode);
    const gaEl = c.querySelector('[data-field="goalsA"]');
    const gbEl = c.querySelector('[data-field="goalsB"]');
    if (gaEl) gaEl.value = ga;
    if (gbEl) gbEl.value = gb;
    const auto = pickWinner(ga, gb);
    const side = auto || (Math.random() < 0.5 ? "A" : "B");
    const selEl = c.querySelector('[data-field="advanceSide"]');
    if (selEl) { selEl.value = side; selEl.disabled = !!auto; }
    if (side === "A") { winners[m.match] = a; losers[m.match] = b; }
    else { winners[m.match] = b; losers[m.match] = a; }
    c.dataset.currentA = a; c.dataset.currentB = b;
  }
  updateDynamic();
}

/* ============================================================
   Save entry
   ============================================================ */
async function saveEntry() {
  if (isPastCutoff()) { alert(t("cutoffClosed")); return; }
  const btn = $("#saveEntry");
  if (btn) { btn.disabled = true; btn.textContent = t("saveInProgress"); }
  try {
    const entry = await readEntryFromForm();
    if (!entry) return;
    const s = state();
    const duplicate = s.entries.find(e =>
      e.entryName.trim().toLowerCase() === entry.entryName.trim().toLowerCase()
    );
    if (duplicate && !confirm(t("duplicateEntryConfirm"))) return;
    s.entries.push(entry);
    saveState(s);
    sessionStorage.removeItem(DRAFT_KEY);
    renderLatestReceipt(entry);
    renderAll();
    await mailReceipt(entry.id, "participant").catch(err => console.warn("Participant email failed", err));
    await mailReceipt(entry.id, "admin").catch(err => console.warn("Admin email failed", err));
  } finally {
    if (btn) { btn.disabled = isPastCutoff(); btn.textContent = t("saveEntry"); }
  }
}

/* ============================================================
   Admin actions
   ============================================================ */
async function adminLogin() {
  const lock = Number(sessionStorage.getItem("adminLockUntil") || "0");
  if (Date.now() < lock) { alert(t("adminLocked")); return; }
  if (!CONFIG.adminPasswordHash) { alert(t("adminWrongPassword")); return; }
  const pwd = ($("#adminPassword")?.value || "").trim();
  if (!pwd) return;
  let hash;
  try {
    hash = await sha256Hex(pwd);
  } catch (err) {
    console.warn("SHA-256 unavailable", err);
    alert(t("adminLoginError"));
    return;
  }
  if (hash === CONFIG.adminPasswordHash) {
    sessionStorage.setItem("adminOk", "true");
    sessionStorage.setItem("adminUntil", String(Date.now() + CONFIG.adminSessionMinutes * 60000));
    sessionStorage.removeItem("adminAttempts");
    if ($("#adminPassword")) $("#adminPassword").value = "";
    $("#adminLogin")?.classList.add("hidden");
    $("#adminArea")?.classList.remove("hidden");
    renderAdmin();
    startResultsPolling();
  } else {
    const n = Number(sessionStorage.getItem("adminAttempts") || "0") + 1;
    sessionStorage.setItem("adminAttempts", String(n));
    if (n >= (CONFIG.adminMaxAttempts || 5)) {
      sessionStorage.setItem("adminLockUntil", String(Date.now() + CONFIG.adminLockMinutes * 60000));
      sessionStorage.setItem("adminAttempts", "0");
      alert(t("adminLocked"));
    } else {
      alert(t("adminWrongPassword"));
    }
  }
}

function adminLogout() {
  if (!confirm(t("logoutConfirm"))) return;
  stopResultsPolling();
  sessionStorage.removeItem("adminOk"); sessionStorage.removeItem("adminUntil");
  $("#adminArea")?.classList.add("hidden");
  $("#adminLogin")?.classList.remove("hidden");
  alert(t("logoutDone"));
}

async function deleteEntry(id) {
  if (!guardAdmin()) return;
  const s = state();
  const e = s.entries.find(x => x.id === id);
  if (!e) return;
  if (!confirm(t("deleteConfirm"))) return;
  const reason = prompt(t("deleteReasonPrompt"), "") || "";
  s.entries = s.entries.filter(x => x.id !== id);
  delete s.paid[id];
  saveState(s);
  await sendRemovalEmail(e, reason).catch(() => {});
  renderAll();
  alert(t("deleteEmailSent"));
}

async function clearAllData() {
  if (!guardAdmin()) return;
  if (!confirm(t("clearDataConfirm"))) return;
  const empty = emptyState();
  saveLocalState(empty);
  await saveRemoteState(empty).catch(err => console.warn("Remote clear failed", err));
  renderAll();
}

function loadDemoData() {
  if (!guardAdmin()) return;
  const s = state();
  ["Ana Demo", "Bruno Demo", "Carlos Demo"].forEach((name, idx) => {
    const picks = {}, winners = {}, losers = {};
    DATA.knockoutMatches.forEach((m, i) => {
      const a = resolveSlot(m.teamA, winners, losers), b = resolveSlot(m.teamB, winners, losers);
      const ga = (i + idx) % 4, gb = (i + idx + 1) % 3;
      const side = ga > gb ? "A" : gb > ga ? "B" : ((i + idx) % 2 ? "A" : "B");
      picks[m.match] = { goalsA: ga, goalsB: gb, advanceSide: side, displayA: a, displayB: b };
      if (side === "A") { winners[m.match] = a; losers[m.match] = b; }
      else { winners[m.match] = b; losers[m.match] = a; }
    });
    s.entries.push({ id: generateId(), entryName: name, payerName: name,
      participantEmail: "demo@noreply.invalid", paymentMethod: "CashApp",
      paymentTo: CONFIG.paymentMethods.CashApp, createdAt: new Date().toISOString(),
      diagnostics: { demo: true }, picks });
  });
  saveState(s); renderAll(); alert(t("demoCreated"));
}

async function refreshApiFootball() {
  if (!guardAdmin()) return;
  if (!CONFIG.apiFootball?.enabled || !CONFIG.apiFootball?.apiKey) { alert(t("apiFootballNotConfigured")); return; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${CONFIG.apiFootball.baseUrl}/fixtures?league=${CONFIG.apiFootball.league}&season=${CONFIG.apiFootball.season}`,
      { headers: { "x-apisports-key": CONFIG.apiFootball.apiKey }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    localStorage.setItem("bolao_api_football_cache", JSON.stringify({ ts: Date.now(), payload: await res.json() }));
    alert(t("apiFootballUpdated"));
  } catch (err) { console.warn("API-Football failed", err); alert(t("apiFootballNotConfigured")); }
}

/* ============================================================
   API-Football live results polling
   NOTE: API key is browser-visible in a static site.
   TODO: for production, proxy requests through a Supabase Edge Function.
   ============================================================ */
let _pollTimer     = null;
let _lastApiUpdate = null;

function apiFootballConfigured() {
  return !!(CONFIG.apiFootball?.enabled && CONFIG.apiFootball?.apiKey);
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bcote d ivoire\b|\bivory coast\b/g, "ivory coast")
    .replace(/\bunited states(?: of america)?\b|\busa\b/g, "united states")
    .replace(/\bbih\b/g, "bosnia and herzegovina");
}

async function fetchApiFootballFixtures() {
  if (!apiFootballConfigured()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(
      `${CONFIG.apiFootball.baseUrl}/fixtures?league=${CONFIG.apiFootball.league}&season=${CONFIG.apiFootball.season}`,
      { headers: { "x-apisports-key": CONFIG.apiFootball.apiKey }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    localStorage.setItem("bolao_api_football_cache", JSON.stringify({ ts: Date.now(), payload: json }));
    return json.response || [];
  } catch (err) {
    clearTimeout(timer);
    console.warn("API-Football fetch failed", err);
    return null;
  }
}

function mapApiFootballToMatches(fixtures) {
  if (!Array.isArray(fixtures) || !fixtures.length) return [];
  const FINISHED = new Set(["FT", "AET", "PEN"]);
  const s = state();
  const winners = {}, losers = {};
  const mapped = [];

  for (const m of DATA.knockoutMatches) {
    const r = (s.results || {})[m.match];
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    if (r?.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
    else if (r?.advanceSide === "B") { winners[m.match] = b; losers[m.match] = a; }

    // Skip unresolved placeholder slots — cannot reliably match to API fixture
    if (/Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(a) ||
        /Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(b)) continue;

    const normA = normalizeTeamName(a), normB = normalizeTeamName(b);
    for (const fix of fixtures) {
      if (!FINISHED.has(fix.fixture?.status?.short)) continue;
      if (fix.goals?.home === null || fix.goals?.away === null) continue;
      if ((fix.fixture?.date || "").slice(0, 10) !== m.date) continue;
      const hN = normalizeTeamName(fix.teams?.home?.name);
      const aN = normalizeTeamName(fix.teams?.away?.name);
      if (hN === normA && aN === normB) {
        mapped.push({ matchId: m.match, goalsA: fix.goals.home, goalsB: fix.goals.away }); break;
      }
      if (hN === normB && aN === normA) {
        mapped.push({ matchId: m.match, goalsA: fix.goals.away, goalsB: fix.goals.home }); break;
      }
    }
  }
  return mapped;
}

async function applyApiResultsToState(fixtures) {
  const mapped = mapApiFootballToMatches(fixtures || []);
  _lastApiUpdate = new Date();
  if (!mapped.length) { updateApiStatusBar(); return 0; }
  const s = state();
  let applied = 0;
  for (const { matchId, goalsA, goalsB } of mapped) {
    const ex = (s.results || {})[matchId];
    if (ex && ex.goalsA !== null && ex.goalsA !== undefined) continue; // never overwrite manual
    const auto = pickWinner(goalsA, goalsB);
    if (!auto) continue; // draw: admin must choose winner
    s.results[matchId] = { goalsA, goalsB, advanceSide: auto };
    applied++;
  }
  if (applied > 0) { saveState(s); renderRanking(); renderGames(); renderAdmin(); }
  updateApiStatusBar();
  return applied;
}

function updateApiStatusBar() {
  const bar = $("#apiStatusBar");
  if (!bar) return;
  if (!apiFootballConfigured()) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const tStr = _lastApiUpdate
    ? _lastApiUpdate.toLocaleTimeString(currentLang, { hour: "2-digit", minute: "2-digit" })
    : "—";
  const autoStr = _pollTimer ? t("apiFootballAutoOn") : t("apiFootballAutoOff");
  bar.innerHTML = `<span class="muted" style="font-size:12px">${escapeHtml(t("apiFootballSource"))} &nbsp;&middot;&nbsp; ${escapeHtml(t("apiFootballLastUpdate"))}: ${escapeHtml(tStr)} &nbsp;&middot;&nbsp; ${escapeHtml(autoStr)}</span>`;
}

async function runApiResultsUpdate() {
  if (!apiFootballConfigured()) return;
  const fixtures = await fetchApiFootballFixtures();
  await applyApiResultsToState(fixtures);
}

function startResultsPolling() {
  if (!apiFootballConfigured() || _pollTimer) return;
  _pollTimer = setInterval(
    () => runApiResultsUpdate().catch(err => console.warn("Results poll failed", err)),
    5 * 60 * 1000
  );
  updateApiStatusBar();
}

function stopResultsPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  updateApiStatusBar();
}

/* ============================================================
   Main render
   ============================================================ */
function renderAll() {
  applyLanguage();
  updateCountdown();
  lockIfCutoff();
  renderPaymentBox();
  renderRanking();
  renderParticipants();
  renderPayment();
  renderGames();
  renderRules();
  updateDynamic();
  if (isAdminActive() && !$("#adminArea")?.classList.contains("hidden")) renderAdmin();
}

/* ============================================================
   Event delegation — single listener on document
   ============================================================ */
function initEvents() {
  // nav buttons
  document.addEventListener("click", e => {
    const nav = e.target.closest(".nav button[data-section]");
    if (nav) { showSection(nav.dataset.section); return; }

    const lang = e.target.closest("[data-lang]");
    if (lang) { setLang(lang.dataset.lang); return; }

    const rankToggle = e.target.closest("[data-rank-toggle]");
    if (rankToggle) {
      const det = document.querySelector(`[data-rank-detail="${rankToggle.dataset.rankToggle}"]`);
      if (det) det.classList.toggle("hidden"); return;
    }

    // Receipt box actions
    const actionBtn = e.target.closest("[data-action][data-eid]");
    if (actionBtn) {
      const id = actionBtn.dataset.eid, act = actionBtn.dataset.action;
      if (act === "open") openReceipt(id);
      else if (act === "download") downloadReceipt(id);
      else if (act === "email-p") mailReceipt(id, "participant");
      return;
    }

    // Admin entry actions
    const actBtn = e.target.closest("[data-act][data-id]");
    if (actBtn) {
      if (!guardAdmin()) return;
      const id = actBtn.dataset.id, act = actBtn.dataset.act;
      if (act === "open") openReceipt(id);
      else if (act === "html") downloadReceipt(id);
      else if (act === "emailp") mailReceipt(id, "participant");
      else if (act === "emaila") mailReceipt(id, "admin");
      else if (act === "delete") deleteEntry(id);
      return;
    }
  });

  // Admin payments checkboxes
  document.addEventListener("change", e => {
    const paidEl = e.target.closest("[data-paid]");
    if (!paidEl) return;
    if (!guardAdmin()) return;
    const s = state();
    s.paid[paidEl.dataset.paid] = paidEl.checked;
    saveState(s);
    renderParticipants();
    renderAdminPayments(state());
  });

  // Bracket form
  const form = $("#bracketForm");
  if (form) {
    form.addEventListener("input", e => {
      if (e.target.matches('input[type="number"]') && Number(e.target.value) > 20) e.target.value = "";
      if (e.target.matches("input,select")) updateDynamic();
    });
    form.addEventListener("change", e => { if (e.target.matches("input,select")) updateDynamic(); });
  }

  // Simulator
  $("#smartPick")?.addEventListener("click", () => autoFill("smart"));
  $("#randomPick")?.addEventListener("click", () => autoFill("random"));
  $("#saveEntry")?.addEventListener("click", saveEntry);
  $("#paymentMethod")?.addEventListener("change", renderPaymentBox);

  // Admin login
  $("#adminLoginBtn")?.addEventListener("click", adminLogin);
  $("#adminLogoutBtn")?.addEventListener("click", adminLogout);
  $("#adminPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") adminLogin(); });

  // Admin toolbar
  $("#loadDemoData")?.addEventListener("click", loadDemoData);
  $("#refreshFootballApi")?.addEventListener("click", refreshApiFootball);
  $("#apiFetchResults")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    await runApiResultsUpdate().catch(err => console.warn("Manual refresh failed", err));
  });
  $("#clearData")?.addEventListener("click", clearAllData);
  $("#backupCsv")?.addEventListener("click", () => { if (guardAdmin()) backupCsv(); });
  $("#masterCsv")?.addEventListener("click", () => { if (guardAdmin()) masterCsv(); });
  $("#masterHtml")?.addEventListener("click", () => { if (guardAdmin()) masterHtml(); });
  $("#backupJson")?.addEventListener("click", () => { if (guardAdmin()) backupJson(); });

  // Admin results
  const resultsBox = $("#resultsAdmin");
  if (resultsBox) {
    resultsBox.addEventListener("input", e => {
      if (!isAdminActive()) return;
      const card = e.target.closest("[data-real-match]");
      if (!card) return;
      if (e.target.matches('input[type="number"]') && Number(e.target.value) > 20) e.target.value = "";
      updateRealCard(card);
      commitRealResult(card);
    });
    resultsBox.addEventListener("change", e => {
      if (!guardAdmin()) return;
      const card = e.target.closest("[data-real-match]");
      if (card) { updateRealCard(card); commitRealResult(card); }
    });
  }
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
  const wa = $("#supportWhatsappBtn");
  if (wa) wa.href = CONFIG.whatsappGroup.link;

  setupEmailJs();
  renderBracket();
  applyLanguage();

  await loadRemoteState();
  renderAll();
  initEvents();

  // Restore admin session if still valid
  if (isAdminActive()) {
    $("#adminLogin")?.classList.add("hidden");
    $("#adminArea")?.classList.remove("hidden");
    renderAdmin();
    startResultsPolling();
  }

  restoreDraft();
  setInterval(updateCountdown, 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopResultsPolling();
    } else {
      debouncedReload();
      if (isAdminActive() && apiFootballConfigured()) startResultsPolling();
    }
  });
  window.addEventListener("focus", () => {
    debouncedReload();
    if (isAdminActive() && apiFootballConfigured()) startResultsPolling();
  });

  showSection("entry");
}

document.addEventListener("DOMContentLoaded", () => init().catch(err => console.error("Init failed", err)));

window.Bolao = { openReceipt, downloadReceipt, mailReceipt, showSection };

})();
