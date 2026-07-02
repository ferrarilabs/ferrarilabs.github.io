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
function isToday(isoString) {
  if (!isoString) return false;
  const opts = { timeZone: "America/New_York" };
  return new Date(isoString).toLocaleDateString("en-US", opts) === new Date().toLocaleDateString("en-US", opts);
}

function emptyState() {
  return { entries: [], deletedIds: [], paid: {}, results: {}, meta: { updatedAt: null, version: CONFIG.siteVersion } };
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
function saveState(s, opts = {}) {
  saveLocalState(s);
  if (!dbEnabled()) return;
  const snap = JSON.parse(JSON.stringify(s));
  if (opts.forceResults) {
    // Admin saves: fire immediately — no debounce so the fetch starts before any tab switch
    saveRemoteState(snap, opts).catch(err => console.warn("Sync failed", err));
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => saveRemoteState(snap, opts).catch(err => console.warn("Sync failed", err)), 400);
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
  const tombstones = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  const byId = {};
  for (const e of (local.entries || [])) if (!tombstones.has(e.id)) byId[e.id] = e;
  for (const e of (remote.entries || [])) {
    if (tombstones.has(e.id)) continue;
    const existing = byId[e.id];
    if (!existing) { byId[e.id] = e; continue; }
    // prefer whichever was modified more recently (admin edits use updatedAt)
    const remoteTs = e.updatedAt || e.createdAt || "";
    const localTs  = existing.updatedAt || existing.createdAt || "";
    if (remoteTs > localTs) byId[e.id] = e;
  }
  const allPaidKeys = new Set([
    ...Object.keys(local.paid || {}),
    ...Object.keys(remote.paid || {})
  ]);
  const mergedPaid = {};
  for (const k of allPaidKeys) {
    mergedPaid[k] = !!(local.paid?.[k] || remote.paid?.[k]);
  }
  // Tombstoned results: explicitly removed by admin via --clear-result
  const resultTombstones = new Set([
    ...(local.deletedResults || []),
    ...(remote.deletedResults || [])
  ]);
  const mergedResults = { ...(remote.results || {}), ...(local.results || {}) };
  for (const mid of resultTombstones) delete mergedResults[mid];

  return {
    entries: Object.values(byId).sort((a, b) => (a.createdAt || "") > (b.createdAt || "") ? 1 : -1),
    deletedIds: [...tombstones],
    deletedResults: [...resultTombstones],
    paid: mergedPaid,
    results: mergedResults,
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
      // Always merge entries (union + tombstones) so participant submissions
      // from other sessions are never silently dropped due to timestamp skew.
      const merged = mergeStates(local, data.state);
      saveLocalState(merged);
      return true;
    }
    await saveRemoteState(state());
    return true;
  } catch (err) { console.warn("Remote load failed", err); return false; }
}

async function saveRemoteState(s, opts = {}) {
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
      } else if (!opts.forceResults) {
        // Non-admin save: preserve remote results and paid marks so participant
        // entry saves never overwrite admin-managed data in Supabase.
        const cur_state = cur.state || {};
        const remoteResults = cur_state.results || {};
        if (Object.keys(remoteResults).length > 0) {
          s = { ...s, results: { ...remoteResults } };
        }
        const remotePaid = cur_state.paid || {};
        if (Object.keys(remotePaid).length > 0) {
          const mergedPaid = Object.assign({}, s.paid || {});
          for (const k of Object.keys(remotePaid)) {
            mergedPaid[k] = !!(mergedPaid[k] || remotePaid[k]);
          }
          s = { ...s, paid: mergedPaid };
        }
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

function parseMatchKickoff(dateStr, timeET) {
  const m = (timeET || "").match(/(\d+):(\d+)/);
  if (!m) return null;
  return Date.UTC(
    parseInt(dateStr.slice(0,4), 10),
    parseInt(dateStr.slice(5,7), 10) - 1,
    parseInt(dateStr.slice(8,10), 10),
    parseInt(m[1], 10) + 4, parseInt(m[2], 10)  // EDT = UTC-4
  );
}

function nextScheduledMatch() {
  const results = state().results || {};
  const now = Date.now();
  for (const m of DATA.knockoutMatches) {
    if (results[m.match]?.advanceSide) continue;
    const kickoff = parseMatchKickoff(m.date, m.timeET);
    if (kickoff === null) continue;
    // Skip if >135 min since kickoff with no live data — match is definitely over
    if (now - kickoff > 135 * 60 * 1000) continue;
    return { m, kickoff };
  }
  return null;
}

function renderNextMatch() {
  const card = $("#nextMatchCard");
  if (!card) return;

  const hasLive = Object.keys(_liveScores).length > 0;
  const next    = nextScheduledMatch();

  if (hasLive) {
    const knockoutIds = new Set(DATA.knockoutMatches.map(km => String(km.match)));
    const items = Object.entries(_liveScores).map(([mid, ls]) => {
      const m = DATA.knockoutMatches.find(x => x.match === mid)
             || DATA.groupMatches?.find(x => x.match === mid);
      const tA = m?.teamA || "A", tB = m?.teamB || "B";
      const pointsBlock = knockoutIds.has(String(mid))
        ? `<div class="hero-live-points picks-detail">${liveMatchPointsTable(mid, ls.goalsA, ls.goalsB)}</div>`
        : "";
      const runningClock = ls.clockSeconds !== null
        ? formatMatchClock(ls.clockSeconds + Math.floor((Date.now() - (ls.pollTime || Date.now())) / 1000))
        : ls.clock;
      return `<div class="hero-live-card">
      <div class="hero-live-top">
        <div class="hero-live-team">
          <span class="hero-live-flag">${escapeHtml(flag(tA))}</span>
          <span class="hero-live-team-name">${escapeHtml(tA)}</span>
        </div>
        <div class="hero-live-score">${ls.goalsA}</div>
        <div class="hero-live-center">
          <span class="hero-live-badge">${escapeHtml(t("liveNow"))}</span>
          <span class="hero-live-clock">${escapeHtml(runningClock)}</span>
        </div>
        <div class="hero-live-score">${ls.goalsB}</div>
        <div class="hero-live-team">
          <span class="hero-live-flag">${escapeHtml(flag(tB))}</span>
          <span class="hero-live-team-name">${escapeHtml(tB)}</span>
        </div>
      </div>
      ${pointsBlock}
      </div>`;
    }).join("");
    card.innerHTML = `<div class="next-match-live-grid">${items}</div>`;
    card.classList.remove("hidden");
    return;
  }

  if (!next) { card.classList.add("hidden"); return; }

  const { m, kickoff } = next;
  const diff   = kickoff - Date.now();
  const tA = m.teamA, tB = m.teamB;

  let timerHtml;
  if (diff <= 0) {
    timerHtml = `<span class="hero-next-live">${escapeHtml(t("heroMatchStarted"))}</span>`;
  } else {
    const totalS = Math.floor(diff / 1000);
    const d   = Math.floor(totalS / 86400);
    const h   = Math.floor((totalS % 86400) / 3600);
    const min = Math.floor((totalS % 3600) / 60);
    const sec = totalS % 60;
    const cells = d > 0
      ? [[d, t("countdownDays")], [h, t("countdownHours")], [min, t("countdownMin")], [String(sec).padStart(2,"0"), t("countdownSec")]]
      : [[h, t("countdownHours")], [min, t("countdownMin")], [String(sec).padStart(2,"0"), t("countdownSec")]];
    timerHtml = `<div class="count-grid next-match-timer">${
      cells.map(([v, l]) => `<div><b>${v}</b><span>${escapeHtml(l)}</span></div>`).join("")
    }</div>`;
  }

  card.innerHTML = `
    <div class="next-match-row">
      <div class="next-match-info">
        <div class="hero-next-label">${escapeHtml(t("heroNextMatch"))}</div>
        <div class="next-match-teams">${escapeHtml(flag(tA))} ${escapeHtml(tA)} <span class="muted">×</span> ${escapeHtml(flag(tB))} ${escapeHtml(tB)}</div>
        <div class="hero-next-time">${escapeHtml(m.timeET || "")} · M${escapeHtml(String(m.match))}</div>
      </div>
      <div class="next-match-countdown">${timerHtml}</div>
    </div>`;
  card.classList.remove("hidden");
}

function renderHero() {
  const card   = $("#heroCard");
  const toggle = $("#heroToggle");
  if (!card || !toggle) return;
  // Clear any stale auto-collapse from previous version
  if (sessionStorage.getItem("heroCollapsed") === "1" &&
      !card.classList.contains("collapsed")) {
    sessionStorage.removeItem("heroCollapsed");
  }
  const collapsed = card.classList.contains("collapsed");
  toggle.textContent = collapsed ? "▶" : "▼";
  toggle.title = collapsed ? t("heroExpand") : t("heroCollapse");
}

function toggleHero() {
  const card = $("#heroCard");
  if (!card) return;
  card.classList.toggle("collapsed");
  sessionStorage.setItem("heroCollapsed", card.classList.contains("collapsed") ? "1" : "0");
  renderHero();
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
  const heading = document.querySelector(`#${id} h2, #${id} h3`);
  if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: false }); }
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
const R32_IDS = new Set(["73","74","75","76","77","78","79","80","81","82","83","84","85","86","87","88"]);

let _editingEntry = null; // set when user loads an entry by receipt code

function isR32Window() {
  if (!CONFIG.r32CutoffIso) return false;
  return Date.now() >= new Date(CONFIG.r32CutoffIso).getTime() && !isPastCutoff();
}

function renderEditByCodeCard() {
  const card = $("#editByCodeCard");
  if (!card) return;
  if (!isR32Window()) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const banner = _editingEntry
    ? `<div class="edit-mode-banner">${escapeHtml(t("editModeBanner").replace("{name}", _editingEntry.entryName))}</div>`
    : "";
  const cancelBtn = _editingEntry
    ? `<button id="editCancelBtn" type="button" class="secondary">${escapeHtml(t("editCancelBtn"))}</button>`
    : "";
  card.innerHTML = `
    <h3>${escapeHtml(t("editByCodeTitle"))}</h3>
    <p class="muted">${escapeHtml(t("editByCodeSubtitle"))}</p>
    <div class="form-grid" style="margin-top:12px">
      <label>
        <span>${escapeHtml(t("editCodeLabel"))}</span>
        <input id="editCodeInput" type="text" placeholder="${escapeHtml(t("editCodePlaceholder"))}" maxlength="32"
               style="text-transform:uppercase;font-family:monospace;letter-spacing:.05em">
      </label>
    </div>
    <div class="button-row" style="margin-top:10px">
      <button id="editCodeLoadBtn" type="button">${escapeHtml(t("editCodeLoad"))}</button>
      ${cancelBtn}
    </div>
    ${banner}`;
  $("#editCodeLoadBtn")?.addEventListener("click", () => {
    const raw = ($("#editCodeInput")?.value || "").trim().toUpperCase();
    loadEntryByCode(raw);
  });
  $("#editCodeInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); loadEntryByCode((e.target.value || "").trim().toUpperCase()); }
  });
  $("#editCancelBtn")?.addEventListener("click", cancelEditMode);
}

function loadEntryByCode(code) {
  if (!code) { alert(t("editCodeNotFound")); return; }
  const found = state().entries.find(e => receiptCode(e) === code);
  if (!found) { alert(t("editCodeNotFound")); return; }
  _editingEntry = found;
  // Pre-fill identity fields (readonly in edit mode)
  const nameEl = $("#entryName"), payerEl = $("#payerName"), emailEl = $("#participantEmail"), methodEl = $("#paymentMethod");
  if (nameEl) { nameEl.value = found.entryName || ""; nameEl.readOnly = true; }
  if (payerEl) { payerEl.value = found.payerName || ""; }
  if (emailEl) emailEl.value = found.participantEmail || "";
  if (methodEl) methodEl.value = found.paymentMethod || "";
  // Populate picks into bracket form
  for (const m of DATA.knockoutMatches) {
    const p = found.picks?.[m.match];
    if (!p) continue;
    const c = $(`[data-card-match="${m.match}"]`);
    if (!c) continue;
    const ga = c.querySelector('[data-field="goalsA"]'); if (ga) ga.value = p.goalsA ?? "";
    const gb = c.querySelector('[data-field="goalsB"]'); if (gb) gb.value = p.goalsB ?? "";
    const sel = c.querySelector('[data-field="advanceSide"]'); if (sel && p.advanceSide) sel.value = p.advanceSide;
  }
  lockR32Inputs();
  updateDynamic(); // resolve R16+ team names from the loaded R32 picks
  updateEditModeUI();
  renderEditByCodeCard();
  // Scroll to bracket
  $("#bracketForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function lockR32Inputs() {
  for (const mid of R32_IDS) {
    const c = $(`[data-card-match="${mid}"]`);
    if (!c) continue;
    c.classList.add("r32-locked");
    c.querySelectorAll('[data-field="goalsA"],[data-field="goalsB"],[data-field="advanceSide"]').forEach(el => {
      el.disabled = true;
      el.title = t("r32LockedNote");
    });
  }
}

function unlockR32Inputs() {
  for (const mid of R32_IDS) {
    const c = $(`[data-card-match="${mid}"]`);
    if (!c) continue;
    c.classList.remove("r32-locked");
    c.querySelectorAll('[data-field="goalsA"],[data-field="goalsB"],[data-field="advanceSide"]').forEach(el => {
      el.disabled = false;
      el.title = "";
    });
  }
}

function updateEditModeUI() {
  const saveBtn = $("#saveEntry");
  if (saveBtn) saveBtn.textContent = _editingEntry ? t("editSaveBtn") : t("saveEntry");
  const nameEl = $("#entryName");
  if (nameEl) nameEl.readOnly = !!_editingEntry;
}

function cancelEditMode() {
  _editingEntry = null;
  const nameEl = $("#entryName"), payerEl = $("#payerName"), emailEl = $("#participantEmail"), methodEl = $("#paymentMethod");
  if (nameEl) { nameEl.value = ""; nameEl.readOnly = false; }
  if (payerEl) payerEl.value = "";
  if (emailEl) emailEl.value = "";
  if (methodEl) methodEl.value = "";
  // Clear all bracket picks and re-enable
  for (const m of DATA.knockoutMatches) {
    const c = $(`[data-card-match="${m.match}"]`);
    if (!c) continue;
    const ga = c.querySelector('[data-field="goalsA"]'); if (ga) ga.value = "";
    const gb = c.querySelector('[data-field="goalsB"]'); if (gb) gb.value = "";
    const sel = c.querySelector('[data-field="advanceSide"]'); if (sel) sel.value = "";
  }
  unlockR32Inputs();
  updateEditModeUI();
  renderEditByCodeCard();
}

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
  if (teamA) teamA.innerHTML = `${escapeHtml(flag(a))} ${escapeHtml(a)}`;
  if (teamB) teamB.innerHTML = `${escapeHtml(b)} ${escapeHtml(flag(b))}`;
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

// Points for a single knockout match pick vs its real result.
// Returns null when the match can't be scored yet (no pick, or no finalized result).
function matchPoints(p, r) {
  if (!p || !r?.advanceSide) return null;
  const pA = parseScore(p.goalsA), pB = parseScore(p.goalsB);
  if (pA === null || pB === null) return null;
  const rA = parseScore(r.goalsA), rB = parseScore(r.goalsB);
  if (rA === null || rB === null) return null;
  const exact = pA === rA && pB === rB;
  const goalsACorrect = !exact && pA === rA;
  const goalsBCorrect = !exact && pB === rB;
  const advanceCorrect = p.advanceSide === r.advanceSide;
  let pts = 0;
  if (exact) pts += CONFIG.scoring.exactScore;
  else {
    if (goalsACorrect) pts += CONFIG.scoring.oneTeamGoals;
    if (goalsBCorrect) pts += CONFIG.scoring.oneTeamGoals;
  }
  if (advanceCorrect) pts += CONFIG.scoring.advance;
  return { pts, exact, goalsACorrect, goalsBCorrect, advanceCorrect };
}

function scoreEntry(entry, s) {
  let total = 0;
  const results = s.results || {};
  for (const m of DATA.knockoutMatches) {
    // Use stored result; fall back to hardcoded DATA result for offline resilience
    const r = results[m.match] ?? (m.status === "Final" && m.goalsA !== null ? {
      goalsA: m.goalsA, goalsB: m.goalsB,
      advanceSide: m.winner === m.teamA ? "A" : m.winner === m.teamB ? "B" : null
    } : null);
    const mp = matchPoints(entry.picks?.[m.match], r);
    if (mp) total += mp.pts;
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
   Result email broadcast (admin button)
   ============================================================ */
function resolveTeamsFromResults(s) {
  const winners = {}, losers = {}, resolved = {};
  for (const m of DATA.knockoutMatches) {
    const r = (s.results || {})[m.match];
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    resolved[m.match] = { displayA: a, displayB: b };
    if (r?.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
    else if (r?.advanceSide === "B") { winners[m.match] = b; losers[m.match] = a; }
  }
  return resolved;
}

function buildResultEmailHtml(s, testMode) {
  const deleted = new Set(s.deletedIds || []);
  const results = Object.fromEntries(Object.entries(s.results || {}).filter(([, v]) => v?.advanceSide));
  const teamNames = resolveTeamsFromResults(s);
  const realEntries = (s.entries || []).filter(e => !deleted.has(e.id) && !e.diagnostics?.demo);
  const scored = realEntries.map(e => ({ e, total: scoreEntry(e, s).total })).sort((a, b) => b.total - a.total);

  const sortedMids = Object.keys(results).map(Number).sort((a, b) => a - b);
  const lastMid = sortedMids.length ? String(sortedMids[sortedMids.length - 1]) : null;
  const lastResult = lastMid ? results[lastMid] : null;
  const lastTeamA = lastMid ? (teamNames[lastMid]?.displayA || "Team A") : "";
  const lastTeamB = lastMid ? (teamNames[lastMid]?.displayB || "Team B") : "";
  const lastWinner = lastResult?.advanceSide === "B" ? lastTeamB : lastTeamA;

  const sc = CONFIG.scoring;
  const ptsColor = p => p >= 10 ? "#16a34a" : p >= 5 ? "#ca8a04" : p > 0 ? "#2563eb" : "#9ca3af";
  const tbl = `style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:20px"`;
  const thead = `style="background:#f1f5f9"`;
  const th = `style="padding:8px 10px;text-align:left;font-weight:600;color:#374151"`;

  function scoreMatchSingle(pick, result, tA, tB) {
    if (!pick || !result?.advanceSide) return { pts: 0, detPt: "sem palpite", detEn: "no pick" };
    const pA = parseScore(pick.goalsA), pB = parseScore(pick.goalsB);
    if (pA === null || pB === null) return { pts: 0, detPt: "palpite inválido", detEn: "invalid pick" };
    const rA = parseScore(result.goalsA), rB = parseScore(result.goalsB);
    if (rA === null || rB === null) return { pts: 0, detPt: "resultado inválido", detEn: "invalid result" };
    let pts = 0; const nPt = [], nEn = [];
    if (pA === rA && pB === rB) {
      pts += sc.exactScore; nPt.push(`+${sc.exactScore} placar exato`); nEn.push(`+${sc.exactScore} exact score`);
    } else {
      if (pA === rA) { pts += sc.oneTeamGoals; nPt.push(`+1 acertou gols de ${tA} (${rA})`); nEn.push(`+1 correct goals for ${tA} (${rA})`); }
      if (pB === rB) { pts += sc.oneTeamGoals; nPt.push(`+1 acertou gols de ${tB} (${rB})`); nEn.push(`+1 correct goals for ${tB} (${rB})`); }
    }
    if (pick.advanceSide === result.advanceSide) {
      const w = result.advanceSide === "B" ? tB : tA;
      pts += sc.advance; nPt.push(`+${sc.advance} ${w} avança`); nEn.push(`+${sc.advance} ${w} advances`);
    }
    return { pts, detPt: nPt.join(", ") || "—", detEn: nEn.join(", ") || "—" };
  }

  const breakdownScored = lastMid ? scored.map(item => {
    const pick = item.e.picks?.[lastMid];
    const { pts, detPt, detEn } = scoreMatchSingle(pick, lastResult, lastTeamA, lastTeamB);
    const pickStr = pick
      ? `${Number(pick.goalsA)}–${Number(pick.goalsB)} (${pick.advanceSide === "B" ? lastTeamB : lastTeamA})`
      : "—";
    return { name: item.e.entryName || "?", pts, detPt, detEn, pickStr };
  }).sort((a, b) => b.pts - a.pts) : [];

  let breakdownPt = "", breakdownEn = "";
  for (const row of breakdownScored) {
    const c = ptsColor(row.pts);
    breakdownPt += `<tr><td style="padding:6px 10px">${escapeHtml(row.name)}</td><td style="padding:6px 10px;text-align:center">${escapeHtml(row.pickStr)}</td><td style="padding:6px 10px;text-align:center;font-weight:700;color:${c}">${row.pts}</td><td style="padding:6px 10px;font-size:11px;color:#6b7280">${escapeHtml(row.detPt)}</td></tr>`;
    breakdownEn += `<tr><td style="padding:6px 10px">${escapeHtml(row.name)}</td><td style="padding:6px 10px;text-align:center">${escapeHtml(row.pickStr)}</td><td style="padding:6px 10px;text-align:center;font-weight:700;color:${c}">${row.pts}</td><td style="padding:6px 10px;font-size:11px;color:#6b7280">${escapeHtml(row.detEn)}</td></tr>`;
  }

  let rankingRows = "", prevPts = null, rank = 0;
  for (let i = 0; i < scored.length; i++) {
    const item = scored[i];
    if (item.total !== prevPts) rank = i + 1;
    prevPts = item.total;
    const medal = { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `${rank}.`;
    const bg = rank <= 3 ? "#fffbe6" : "white";
    rankingRows += `<tr style="background:${bg}"><td style="padding:7px 10px;text-align:center">${medal}</td><td style="padding:7px 10px">${escapeHtml(item.e.entryName || "?")}</td><td style="padding:7px 10px;text-align:center;font-weight:700;color:${ptsColor(item.total)}">${item.total}</td></tr>`;
  }

  const matchCount = sortedMids.length;
  const lastLabel = lastMid ? `M${lastMid}` : "";
  const lastResultStr = lastResult ? `${lastTeamA} ${lastResult.goalsA}–${lastResult.goalsB} ${lastTeamB}` : "—";
  const testBanner = testMode
    ? `<div style="background:#fef3c7;border:2px dashed #f59e0b;padding:12px;border-radius:8px;text-align:center;margin-bottom:16px;font-weight:700">⚠️ EMAIL DE TESTE / TEST EMAIL</div>`
    : "";

  return `<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a">
  ${testBanner}
  <div style="background:linear-gradient(135deg,#1d4ed8,#1e40af);color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:26px;font-weight:700;margin-bottom:4px">🏆 Bolão do Ferrari — Copa 2026</div>
    <div style="opacity:.8;font-size:13px">Atualização de resultados · Results update</div>
  </div>
  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
    <div style="font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #dbeafe">🇧🇷 Português</div>
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Último jogo (${lastLabel})</div>
      <div style="font-size:16px;font-weight:700">${escapeHtml(lastResultStr)}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ ${escapeHtml(lastWinner)} avança</div>
    </div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Pontuação — Último jogo (${lastLabel})</div>
    <table ${tbl}><thead><tr ${thead}><th ${th}>Entrada</th><th ${th} style="text-align:center">Palpite</th><th ${th} style="text-align:center">Pts</th><th ${th}>Detalhes</th></tr></thead><tbody>${breakdownPt}</tbody></table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">Placar exato = 10 pts · Avanço correto = 5 pts · Gols exatos de 1 time = 1 pt <em>(por time, não por gol)</em></div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Ranking atual (${matchCount} de 32 jogos)</div>
    <table ${tbl}><thead><tr ${thead}><th ${th} style="text-align:center">#</th><th ${th}>Entrada</th><th ${th} style="text-align:center">Total</th></tr></thead><tbody>${rankingRows}</tbody></table>
    <div style="height:2px;background:#dbeafe;margin:24px 0"></div>
    <div style="font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #dbeafe">🇺🇸 English</div>
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Latest match (${lastLabel})</div>
      <div style="font-size:16px;font-weight:700">${escapeHtml(lastResultStr)}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ ${escapeHtml(lastWinner)} advances</div>
    </div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Scoring — Latest match (${lastLabel})</div>
    <table ${tbl}><thead><tr ${thead}><th ${th}>Entry</th><th ${th} style="text-align:center">Pick</th><th ${th} style="text-align:center">Pts</th><th ${th}>Details</th></tr></thead><tbody>${breakdownEn}</tbody></table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">Exact score = 10 pts · Correct advance = 5 pts · Exact goals of 1 team = 1 pt <em>(per team, not per goal)</em></div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Current ranking (${matchCount} of 32 matches played)</div>
    <table ${tbl}><thead><tr ${thead}><th ${th} style="text-align:center">#</th><th ${th}>Entry</th><th ${th} style="text-align:center">Total</th></tr></thead><tbody>${rankingRows}</tbody></table>
    <div style="height:1px;background:#e2e8f0;margin:20px 0"></div>
    <div style="text-align:center;font-size:12px;color:#9ca3af"><a href="https://ferrarilabs.github.io/bolao-teste/" style="color:#1d4ed8;text-decoration:none">ferrarilabs.github.io/bolao-teste/</a> · Bolão do Ferrari · Copa 2026</div>
  </div>
</div>`;
}

async function sendResultEmailFromAdmin(testOnly) {
  if (!guardAdmin()) return;
  if (!window.emailjs) { alert(t("emailjsNotLoaded")); return; }
  const s = state();
  const completedResults = Object.entries(s.results || {}).filter(([, v]) => v?.advanceSide);
  if (!completedResults.length) { alert("Nenhum resultado knockout encontrado."); return; }

  const btnId = testOnly ? "#sendResultEmailTest" : "#sendResultEmailAll";
  const btn = $(btnId);
  const origText = btn?.textContent || "";
  if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }

  try {
    // Build subject from last completed match (entry_name is used as subject by the EmailJS template)
    const sortedMids = completedResults.map(([k]) => Number(k)).sort((a, b) => a - b);
    const lastMid = String(sortedMids[sortedMids.length - 1]);
    const lastResult = s.results[lastMid];
    const teamNames = resolveTeamsFromResults(s);
    const lastTeamA = teamNames[lastMid]?.displayA || "Team A";
    const lastTeamB = teamNames[lastMid]?.displayB || "Team B";
    const lastResultStr = `${lastTeamA} ${lastResult.goalsA}–${lastResult.goalsB} ${lastTeamB}`;
    const emailSubject = `Resultado Parcial — M${lastMid}: ${lastResultStr}`;

    const html = buildResultEmailHtml(s, testOnly);
    const deleted = new Set(s.deletedIds || []);

    if (testOnly) {
      await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId,
        { to_email: CONFIG.adminEmail, entry_name: emailSubject, receipt_code: emailSubject, html_message: html },
        { publicKey: CONFIG.emailjs.publicKey });
      alert(`Email de teste enviado para ${CONFIG.adminEmail} ✓`);
    } else {
      const byEmail = {};
      for (const e of (s.entries || [])) {
        if (deleted.has(e.id) || e.diagnostics?.demo) continue;
        const addr = (e.participantEmail || "").trim();
        if (!addr.includes("@") || !addr.includes(".")) continue;
        const key = addr.toLowerCase();
        if (!byEmail[key]) byEmail[key] = { addr };
      }
      const recipients = Object.values(byEmail);
      if (!confirm(`Enviar email de resultado para ${recipients.length} participante(s)?`)) return;
      let sent = 0, errors = 0;
      for (const { addr } of recipients) {
        try {
          await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId,
            { to_email: addr, entry_name: emailSubject, receipt_code: emailSubject, html_message: html },
            { publicKey: CONFIG.emailjs.publicKey });
          sent++;
          await new Promise(r => setTimeout(r, 3500));
        } catch (err) {
          console.error("Result email error:", addr, err);
          errors++;
        }
      }
      alert(`Emails enviados: ${sent} ✓${errors ? `, erros: ${errors}` : ""}`);
    }
  } catch (err) {
    alert(`Erro ao enviar: ${err?.text || err?.message || String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

/* ============================================================
   Render sections
   ============================================================ */
const PAY_ICON_SVG = { CashApp: "assets/cashapp.svg", Zelle: "assets/zelle.svg", Venmo: "assets/venmo.svg" };
function payIcon(method) {
  const src = PAY_ICON_SVG[method];
  return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(method)}" class="pay-method-icon">` : "💳";
}

function renderPaymentBox() {
  const method = $("#paymentMethod")?.value;
  const box = $("#paymentBox");
  if (!box) return;
  if (!method) { box.innerHTML = ""; return; }
  const to = escapeHtml(CONFIG.paymentMethods[method] || "");
  const link = CONFIG.paymentLinks[method] || "";
  box.innerHTML = `<div class="pay-card">
<div class="pay-icon">${payIcon(method)}</div>
<div><b>${escapeHtml(method)}</b><br><span class="muted">${to}</span>
${link ? `<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("paymentOpenLink"))}</a>` : ""}</div></div>`;
}

function lockIfCutoff() {
  const closed = isPastCutoff();
  const btn = $("#saveEntry");
  if (btn) btn.disabled = closed;
  if (closed) $$("#bracketForm input,#bracketForm select,#smartPick,#randomPick").forEach(el => { el.disabled = true; });
}

// Rank-movement arrows (like a live league table): compares each id's position
// in `items` against the last time this `key`'s scores actually changed, not
// every re-render — so incidental redraws (language switch, countdown tick,
// a poll that finds no change) don't reset the arrows. Keyed so the overall
// ranking and each live match's provisional table track movement separately.
const _rankArrowState = new Map();

function computeRankArrows(key, items) {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  let st = _rankArrowState.get(key);
  if (!st) { st = { signature: null, snapshot: {}, arrows: {} }; _rankArrowState.set(key, st); }
  const signature = sorted.map(x => `${x.id}:${x.score}`).join("|");
  if (signature !== st.signature) {
    const arrows = {};
    sorted.forEach((x, i) => {
      const prevRank = st.snapshot[x.id];
      arrows[x.id] = prevRank === undefined ? null : i < prevRank ? "up" : i > prevRank ? "down" : null;
    });
    const snapshot = {};
    sorted.forEach((x, i) => { snapshot[x.id] = i; });
    st.arrows = arrows;
    st.snapshot = snapshot;
    st.signature = signature;
  }
  return st.arrows;
}

function rankArrowHtml(arrow, delta) {
  const n = delta > 0 ? `<span class="rank-arrow-n">${delta}</span>` : "";
  if (arrow === "up")   return ` <span class="rank-arrow up"   title="${escapeHtml(t("rankUp"))}">▲${n}</span>`;
  if (arrow === "down") return ` <span class="rank-arrow down" title="${escapeHtml(t("rankDown"))}">▼${n}</span>`;
  return "";
}

function renderRanking() {
  const s = state(), box = $("#rankingList");
  if (!box) return;
  const paidCount = s.entries.filter(e => s.paid[e.id]).length;
  const potEl = $("#potValue");
  if (potEl) potEl.textContent = `$${paidCount * (CONFIG.entryFee || 5)}`;
  if (!s.entries.length) { box.innerHTML = `<div class="card"><p>${escapeHtml(t("noEntries"))}</p></div>`; return; }
  const ranked = s.entries
    .map(e => { const sc = scoreEntry(e, s); return { ...e, _score: sc.total, _bonus: sc.bonus }; })
    .sort((a, b) => b._score - a._score);
  const arrows = computeRankArrows("ranking", ranked.map(e => ({ id: e.id, score: e._score })));
  box.innerHTML = "";
  ranked.forEach((e, i) => {
    const medal = ["🥇","🥈","🥉"][i] || `${i + 1}`;
    const arrowHtml = rankArrowHtml(arrows[e.id]);
    const bonusLine = e._bonus?.total ? ` · ${t("bonusLabel")} +${e._bonus.total}` : "";
    const demoBadge = e.diagnostics?.demo ? ' <span class="demo-badge">Demo</span>' : "";
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `
<div class="rank-pos">${medal}${arrowHtml}</div>
<div><b>${escapeHtml(e.entryName)}</b>${demoBadge}<br>
<span class="muted">${escapeHtml(e.payerName)}${escapeHtml(bonusLine)}</span><br>
<span class="receipt-code">${escapeHtml(receiptCode(e))}</span></div>
<div class="points">${e._score}</div>
<button type="button" class="secondary small-btn" data-rank-toggle="${escapeHtml(e.id)}" aria-label="${escapeHtml(t("viewPicks"))} — ${escapeHtml(e.entryName || "")}">${escapeHtml(t("viewPicks"))}</button>`;
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
  const results = (state().results) || {};
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks?.[m.match], rr = r[m.match] || {};
    if (!p) return "";
    const w = p.advanceSide === "A" ? rr.displayA : rr.displayB;
    const result = results[m.match];
    const hasRealScore = result?.goalsA !== undefined && result?.goalsB !== undefined;
    const realScore = hasRealScore ? `${result.goalsA}–${result.goalsB}` : "—";
    const mp = matchPoints(p, result);
    const pts = result?.advanceSide ? (mp ? mp.pts : 0) : null;
    const ptsCell = pts === null
      ? `<span class="muted">—</span>`
      : `<b class="pick-pts${pts > 0 ? " pos" : ""}">${pts}</b>`;
    return `<tr><td>M${escapeHtml(String(m.match))}</td><td>${escapeHtml(rr.displayA||"")}</td><td><b>${p.goalsA}×${p.goalsB}</b></td><td>${escapeHtml(rr.displayB||"")}</td><td>${escapeHtml(w||"")}</td><td>${escapeHtml(realScore)}</td><td style="text-align:center">${ptsCell}</td></tr>`;
  }).join("");
  return `<table><thead><tr><th>${escapeHtml(t("receiptGame"))}</th><th>${escapeHtml(t("receiptTeamA"))}</th><th>${escapeHtml(t("receiptScore"))}</th><th>${escapeHtml(t("receiptTeamB"))}</th><th>${escapeHtml(t("receiptWinner"))}</th><th>${escapeHtml(t("pickRealLabel"))}</th><th>${escapeHtml(t("pickPointsLabel"))}</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    const div = document.createElement("div");
    div.className = "card pay-card";
    div.innerHTML = `<div class="pay-icon">${payIcon(method)}</div>
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
  const knockoutIds = new Set(DATA.knockoutMatches.map(km => String(km.match)));
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  for (const m of all) {
    const r = (s.results || {})[m.match];
    const live = r?.goalsA === undefined ? _liveScores[m.match] : null;
    const goalsA = r?.goalsA !== undefined ? r.goalsA : (live ? live.goalsA : m.goalsA);
    const goalsB = r?.goalsB !== undefined ? r.goalsB : (live ? live.goalsB : m.goalsB);
    const status = r?.goalsA !== undefined ? "Final" : (live ? "Live" : m.status);
    const hasScore = goalsA !== null && goalsA !== undefined && goalsB !== null && goalsB !== undefined;
    const venue = m.venue && m.venue !== "A confirmar" ? m.venue : "";
    const a = m.teamA || "", b = m.teamB || "";
    const statusClass = status === "Final" ? "done" : status === "Live" ? "live" : "pending";
    const statusLabel = status === "Final" ? t("gameFinal") : status === "Live" ? t("gameLive") : t("gamePending");
    const canShowLivePoints = live && knockoutIds.has(String(m.match));
    const div = document.createElement("div");
    div.className = `game-card${live ? " is-live" : ""}`;
    div.innerHTML = `
<div class="game-top">
  <span class="match-badge">${escapeHtml(String(m.match))}</span>
  <span class="muted">${escapeHtml(phaseLabel(m.phase || "Fase de grupos"))}${m.group ? ` — ${escapeHtml(t("groupLabel"))} ${escapeHtml(m.group)}` : ""}</span>
  <span class="status-chip ${statusClass}">${live ? "🔴 " : ""}${escapeHtml(statusLabel)}${live?.clock ? ` · ${escapeHtml(live.clock)}` : ""}</span>
</div>
<div class="game-meta">
  ${m.date  ? `<span class="pill">📅 ${escapeHtml(formatDate(m.date))}</span>` : ""}
  ${m.timeET ? `<span class="pill">🕒 ${escapeHtml(m.timeET)}</span>` : ""}
  ${venue   ? `<span class="pill">📍 ${escapeHtml(venue)}</span>` : ""}
</div>
<div class="game-teams">
  <div class="game-team">${escapeHtml(flag(a))} ${escapeHtml(a)}</div>
  ${hasScore ? `<div class="game-score${live ? " is-live" : ""}">${goalsA} — ${goalsB}</div>` : `<div class="game-score muted">×</div>`}
  <div class="game-team right">${escapeHtml(b)} ${escapeHtml(flag(b))}</div>
</div>
${canShowLivePoints ? `<button type="button" class="secondary small-btn" style="margin-top:10px" data-live-toggle="${escapeHtml(String(m.match))}">${escapeHtml(t("liveToggleShow"))}</button>` : ""}`;
    box.appendChild(div);
    if (canShowLivePoints) {
      const detail = document.createElement("div");
      detail.className = `card picks-detail${_openLiveDetails.has(String(m.match)) ? "" : " hidden"}`;
      detail.dataset.liveDetail = String(m.match);
      detail.innerHTML = liveMatchPointsTable(m.match, live.goalsA, live.goalsB);
      box.appendChild(detail);
    }
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
  <p class="footer-note" style="margin-top:10px;background:#fef9c3;border-left:3px solid #ca8a04;padding:8px 10px;border-radius:4px">⚠️ ${escapeHtml(t("rulesGoalsNote"))}</p>
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
    const paid = !!s.paid[e.id];
    div.innerHTML = `<div>💵</div>
<div><b>${escapeHtml(e.entryName)}</b><br>${escapeHtml(e.paymentMethod)} → ${escapeHtml(e.paymentTo || "")}</div>
<button type="button" class="small-btn${paid ? "" : " secondary"}" data-paid="${id}">${paid ? "✓ " + escapeHtml(t("paymentPaid")) : escapeHtml(t("markAsPaid"))}</button>`;
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
  renderAdminResultsManual(s);
}

function renderAdminResultsManual(s) {
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
  saveState(s, { forceResults: true });
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
    // Don't overwrite R32 picks that are locked during the R32 edit window
    if (R32_IDS.has(String(m.match)) && _editingEntry) {
      const a2 = resolveSlot(m.teamA, winners, losers);
      const b2 = resolveSlot(m.teamB, winners, losers);
      const p = _editingEntry.picks?.[m.match];
      if (p?.advanceSide === "A") { winners[m.match] = a2; losers[m.match] = b2; }
      else if (p?.advanceSide === "B") { winners[m.match] = b2; losers[m.match] = a2; }
      continue;
    }
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
    if (_editingEntry) {
      // Edit mode: update existing entry in-place, preserve R32 picks
      const idx = s.entries.findIndex(e => e.id === _editingEntry.id);
      if (idx === -1) { alert(t("editCodeNotFound")); return; }
      const merged = { ...entry.picks };
      for (const mid of Object.keys(_editingEntry.picks || {})) {
        if (R32_IDS.has(mid)) merged[mid] = _editingEntry.picks[mid];
      }
      s.entries[idx] = {
        ..._editingEntry,
        picks: merged,
        payerName: entry.payerName,
        participantEmail: entry.participantEmail,
        paymentMethod: entry.paymentMethod,
        updatedAt: new Date().toISOString()
      };
      saveState(s);
      sessionStorage.removeItem(DRAFT_KEY);
      _editingEntry = null;
      unlockR32Inputs();
      updateEditModeUI();
      renderEditByCodeCard();
      renderAll();
      alert(t("entryUpdated"));
    } else {
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
    }
  } finally {
    if (btn) { btn.disabled = isPastCutoff(); btn.textContent = t("saveEntry"); }
  }
}

/* ============================================================
   Admin actions
   ============================================================ */
async function adminLogin() {
  const lock = Number(localStorage.getItem("adminLockUntil") || "0");
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
    localStorage.removeItem("adminAttempts");
    localStorage.removeItem("adminLockUntil");
    if ($("#adminPassword")) $("#adminPassword").value = "";
    $("#adminLogin")?.classList.add("hidden");
    $("#adminArea")?.classList.remove("hidden");
    renderAdmin();
    startResultsPolling();
  } else {
    const n = Number(localStorage.getItem("adminAttempts") || "0") + 1;
    localStorage.setItem("adminAttempts", String(n));
    if (n >= (CONFIG.adminMaxAttempts || 5)) {
      localStorage.setItem("adminLockUntil", String(Date.now() + CONFIG.adminLockMinutes * 60000));
      localStorage.setItem("adminAttempts", "0");
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
}

async function deleteEntry(id) {
  if (!guardAdmin()) return;
  const s = state();
  const e = s.entries.find(x => x.id === id);
  if (!e) return;
  if (isToday(e.createdAt) && !e.diagnostics?.demo) { alert(t("deleteTodayBlocked")); return; }
  if (!confirm(t("deleteConfirm"))) return;
  const reason = prompt(t("deleteReasonPrompt"), "") || "";
  s.entries = s.entries.filter(x => x.id !== id);
  delete s.paid[id];
  if (!s.deletedIds) s.deletedIds = [];
  s.deletedIds.push(id);
  saveState(s, { forceResults: true });
  await sendRemovalEmail(e, reason).catch(() => {});
  renderAll();
  alert(t("deleteEmailSent"));
}

async function forceSyncFromRemote() {
  if (!guardAdmin()) return;
  if (!confirm(t("forceSyncConfirm"))) return;
  localStorage.removeItem(CONFIG.storeKey);
  await loadRemoteState().catch(err => console.warn("Force sync failed", err));
  renderAll();
}

async function clearAllData() {
  if (!guardAdmin()) return;
  if (!confirm(t("clearDataConfirm"))) return;
  const s = state();
  const todayEntries = s.entries.filter(e => isToday(e.createdAt));
  const empty = emptyState();
  if (todayEntries.length > 0) {
    empty.entries = todayEntries;
    for (const e of todayEntries) { if (s.paid[e.id]) empty.paid[e.id] = true; }
  }
  saveLocalState(empty);
  await saveRemoteState(empty, { forceResults: true }).catch(err => console.warn("Remote clear failed", err));
  renderAll();
  if (todayEntries.length > 0) alert(t("clearDataTodayKept").replace("{n}", todayEntries.length));
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
    .replace(/\bbosniaherzegovina\b|\bbosnia herzegovina\b|\bbih\b/g, "bosnia and herzegovina")
    .replace(/\bcongo dr\b|\bdr congo\b|\bdemocratic republic of(?: the)? congo\b|\bcod\b/g, "dr congo")
    .replace(/\bturkiye\b|\bturkey\b/g, "turkiye");
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
  if (applied > 0) { saveState(s, { forceResults: true }); renderRanking(); renderGames(); renderAdmin(); }
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

/* ── ESPN free results ── */
async function fetchEspnFixtures() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=300&dates=20260611-20260719",
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.events || [];
  } catch (err) {
    clearTimeout(timer);
    console.warn("ESPN fetch failed", err);
    return null;
  }
}

function mapEspnToMatches(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  const s = state();
  const mapped = [];
  for (const m of all) {
    if ((s.results || {})[m.match]?.goalsA !== undefined) continue;
    if (/Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(m.teamA) ||
        /Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(m.teamB)) continue;
    const normA = normalizeTeamName(m.teamA), normB = normalizeTeamName(m.teamB);
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp || comp.status?.type?.state !== "post") continue;
      // Convert ESPN UTC date to ET (UTC-4 during Copa 2026) to match m.date
      const evDateET = new Date(new Date(comp.date || ev.date || "") - 4 * 3600000)
        .toISOString().slice(0, 10);
      if (evDateET !== m.date) continue;
      const [c0, c1] = comp.competitors || [];
      if (!c0 || !c1) continue;
      const n0 = normalizeTeamName(c0.team?.displayName);
      const n1 = normalizeTeamName(c1.team?.displayName);
      const s0 = parseInt(c0.score || "0", 10), s1 = parseInt(c1.score || "0", 10);
      if (n0 === normA && n1 === normB) { mapped.push({ matchId: m.match, goalsA: s0, goalsB: s1 }); break; }
      if (n1 === normA && n0 === normB) { mapped.push({ matchId: m.match, goalsA: s1, goalsB: s0 }); break; }
    }
  }
  return mapped;
}

async function runEspnUpdate({ silent = false } = {}) {
  if (!guardAdmin()) return;
  const events = await fetchEspnFixtures();
  if (!events) { if (!silent) alert("Erro ao buscar ESPN. Verifique o console."); return; }
  const mapped = mapEspnToMatches(events);
  if (!mapped.length) { if (!silent) alert("Nenhum resultado novo encontrado via ESPN."); return; }
  const knockoutIds = new Set(DATA.knockoutMatches.map(m => String(m.match)));
  const s = state();
  let applied = 0;
  for (const { matchId, goalsA, goalsB } of mapped) {
    if (knockoutIds.has(String(matchId))) {
      const auto = pickWinner(goalsA, goalsB);
      if (!auto) continue; // empate no mata-mata: admin escolhe o vencedor
      s.results[matchId] = { goalsA, goalsB, advanceSide: auto };
    } else {
      s.results[matchId] = { goalsA, goalsB };
    }
    applied++;
  }
  _lastApiUpdate = new Date();
  if (applied > 0) {
    saveState(s, { forceResults: true }); renderRanking(); renderGames(); renderAdmin();
    if (!silent) alert(`${applied} resultado(s) atualizado(s) via ESPN.`);
  } else {
    if (!silent) alert("Nenhum resultado novo para aplicar.");
  }
}

/* ── Public live scoreboard (no admin required) ── */
let _liveScores = {};
let _liveScoreTimer = null;
let _liveScorePollTime = 0;
let _prevLiveIds = new Set();
const _openLiveDetails = new Set();

function formatMatchClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Provisional per-entry points for a match still in progress: goals-correct
// component always counts; the advance bonus only counts while the live
// score isn't a draw (pickWinner returns "" on a tie). Never touches
// state().results — purely a live preview, official points still require
// the admin to confirm the result.
function liveMatchPoints(pick, liveGoalsA, liveGoalsB) {
  if (!pick) return null;
  const pA = parseScore(pick.goalsA), pB = parseScore(pick.goalsB);
  if (pA === null || pB === null) return null;
  const exact = pA === liveGoalsA && pB === liveGoalsB;
  let pts = 0;
  if (exact) pts += CONFIG.scoring.exactScore;
  else {
    if (pA === liveGoalsA) pts += CONFIG.scoring.oneTeamGoals;
    if (pB === liveGoalsB) pts += CONFIG.scoring.oneTeamGoals;
  }
  const liveAdvance = pickWinner(liveGoalsA, liveGoalsB);
  if (liveAdvance && pick.advanceSide === liveAdvance) pts += CONFIG.scoring.advance;
  return pts;
}

function liveMatchPointsTable(matchId, liveGoalsA, liveGoalsB) {
  const s = state();
  const entries = s.entries || [];
  if (!entries.length) return `<p class="muted">${escapeHtml(t("liveNoPicks"))}</p>`;

  // Official score for every entry (before this live match)
  const officialScore = {};
  entries.forEach(e => { officialScore[e.id] = scoreEntry(e, s).total; });

  // Official rank (position in overall ranking right now)
  const officialRank = {};
  [...entries]
    .sort((a, b) => (officialScore[b.id] || 0) - (officialScore[a.id] || 0))
    .forEach((e, i) => { officialRank[e.id] = i; });

  // Provisional rank: add live match pts to every entry, re-rank all entries
  const provScore = {};
  entries.forEach(e => {
    const livePts = liveMatchPoints(e.picks?.[matchId], liveGoalsA, liveGoalsB) ?? 0;
    provScore[e.id] = (officialScore[e.id] || 0) + livePts;
  });
  const provRank = {};
  [...entries]
    .sort((a, b) => (provScore[b.id] || 0) - (provScore[a.id] || 0))
    .forEach((e, i) => { provRank[e.id] = i; });

  // Show only entries with picks for this match, sorted by provisional overall total
  const rows = entries
    .map(e => {
      const pick = e.picks?.[matchId];
      const livePts = liveMatchPoints(pick, liveGoalsA, liveGoalsB);
      if (livePts === null) return null;
      const oRank = officialRank[e.id] ?? 0;
      const pRank = provRank[e.id] ?? 0;
      const delta = Math.abs(oRank - pRank);
      return {
        id: e.id,
        name: e.entryName || "?",
        pickStr: pick ? `${pick.goalsA}×${pick.goalsB}` : "—",
        livePts,
        provTotal: provScore[e.id] || 0,
        provPos: pRank + 1,
        arrow: pRank < oRank ? "up" : pRank > oRank ? "down" : null,
        delta
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.provTotal - a.provTotal || b.livePts - a.livePts);

  if (!rows.length) return `<p class="muted">${escapeHtml(t("liveNoPicks"))}</p>`;

  const trs = rows.map((row) =>
    `<tr><td style="text-align:center">${row.provPos}${rankArrowHtml(row.arrow, row.delta)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.pickStr)}</td><td style="text-align:center"><b class="pick-pts${row.livePts > 0 ? " pos" : ""}">${row.livePts}</b></td></tr>`
  ).join("");
  return `<table><thead><tr><th style="text-align:center">${escapeHtml(t("livePosCol"))}</th><th>${escapeHtml(t("liveEntryCol"))}</th><th>${escapeHtml(t("livePickCol"))}</th><th style="text-align:center">${escapeHtml(t("livePointsCol"))}</th></tr></thead><tbody>${trs}</tbody></table>
<p class="footer-note" style="margin-top:8px">${escapeHtml(t("liveProvisionalNote"))}</p>`;
}

function mapEspnToLiveScores(events) {
  if (!Array.isArray(events) || !events.length) return {};
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  const s = state();
  const out = {};
  for (const m of all) {
    if ((s.results || {})[m.match]?.goalsA !== undefined) continue;
    if (/Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(m.teamA) ||
        /Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(m.teamB)) continue;
    const normA = normalizeTeamName(m.teamA), normB = normalizeTeamName(m.teamB);
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp || comp.status?.type?.state !== "in") continue;
      const evDateET = new Date(new Date(comp.date || ev.date || "") - 4 * 3600000)
        .toISOString().slice(0, 10);
      if (evDateET !== m.date) continue;
      const [c0, c1] = comp.competitors || [];
      if (!c0 || !c1) continue;
      const n0 = normalizeTeamName(c0.team?.displayName);
      const n1 = normalizeTeamName(c1.team?.displayName);
      const s0 = parseInt(c0.score || "0", 10), s1 = parseInt(c1.score || "0", 10);
      const clockSeconds = typeof comp.status?.clock === "number" ? comp.status.clock : null;
      const clock = clockSeconds !== null && clockSeconds >= 0
        ? formatMatchClock(clockSeconds)
        : (comp.status?.type?.shortDetail || "");
      if (n0 === normA && n1 === normB) { out[m.match] = { goalsA: s0, goalsB: s1, clock, clockSeconds, pollTime: Date.now() }; break; }
      if (n1 === normA && n0 === normB) { out[m.match] = { goalsA: s1, goalsB: s0, clock, clockSeconds, pollTime: Date.now() }; break; }
    }
  }
  return out;
}

async function pollLiveScores() {
  const prevIds = new Set(Object.keys(_liveScores));
  const events = await fetchEspnFixtures();
  if (!events) return;
  _liveScores = mapEspnToLiveScores(events);
  _liveScorePollTime = Date.now();
  _prevLiveIds = prevIds;

  // Detect knockout matches that just transitioned from live → ended
  if (prevIds.size > 0) {
    const knockoutIds = new Set(DATA.knockoutMatches.map(m => String(m.match)));
    const ended = [...prevIds].filter(id => !_liveScores[id] && knockoutIds.has(id));
    if (ended.length) onMatchesEnded(ended);
  }

  renderGames();
  renderNextMatch();
}

async function onMatchesEnded(matchIds) {
  const shownKey = "_matchEndBanners";
  const alreadyShown = new Set(JSON.parse(sessionStorage.getItem(shownKey) || "[]"));
  const newEnded = matchIds.filter(id => !alreadyShown.has(id));
  if (!newEnded.length) return;
  newEnded.forEach(id => alreadyShown.add(id));
  sessionStorage.setItem(shownKey, JSON.stringify([...alreadyShown]));
  if (isAdminActive()) await runEspnUpdate({ silent: true });
  showMatchEndBanner(newEnded);
}

function showMatchEndBanner(matchIds) {
  const banner = $("#matchEndBanner");
  if (!banner) return;
  const s = state();
  const lines = matchIds.map(mid => {
    const r = s.results?.[mid];
    const m = DATA.knockoutMatches.find(x => String(x.match) === mid);
    if (!r || !m) return `M${mid} encerrado`;
    const tA = m.teamA, tB = m.teamB;
    const winner = r.advanceSide === "B" ? tB : tA;
    return `M${mid}: ${escapeHtml(tA)} ${r.goalsA}–${r.goalsB} ${escapeHtml(tB)} · ${escapeHtml(flag(winner))} <strong>${escapeHtml(winner)}</strong> avança`;
  });
  const adminReady = isAdminActive();
  const actionHtml = adminReady
    ? `<button id="matchEndSendEmail" type="button" class="banner-btn-primary">📧 Enviar emails agora</button>`
    : `<button type="button" class="banner-btn-secondary" onclick="showSection('admin')">🔐 Admin → enviar emails</button>`;
  banner.innerHTML = `<div class="match-end-banner-content">
    <span class="match-end-banner-icon">⚽</span>
    <div class="match-end-banner-text">
      <strong>Jogo encerrado!</strong>
      ${lines.map(l => `<span>${l}</span>`).join("")}
      ${adminReady ? `<small>Resultado sincronizado via ESPN ✓</small>` : ""}
    </div>
    <div class="match-end-banner-actions">
      ${actionHtml}
      <button type="button" class="banner-btn-dismiss" aria-label="Fechar">✕</button>
    </div>
  </div>`;
  banner.classList.remove("hidden");
  $("#matchEndSendEmail")?.addEventListener("click", () => sendResultEmailFromAdmin(false));
  banner.querySelector(".banner-btn-dismiss")?.addEventListener("click", () => banner.classList.add("hidden"));
}

function startLiveScorePolling() {
  if (_liveScoreTimer) return;
  pollLiveScores().catch(err => console.warn("Live score poll failed", err));
  _liveScoreTimer = setInterval(
    () => pollLiveScores().catch(err => console.warn("Live score poll failed", err)),
    60000
  );
}

function stopLiveScorePolling() {
  if (_liveScoreTimer) { clearInterval(_liveScoreTimer); _liveScoreTimer = null; }
}

/* ============================================================
   Main render
   ============================================================ */
function renderAll() {
  applyLanguage();
  updateCountdown();
  renderHero();
  renderNextMatch();
  lockIfCutoff();
  renderEditByCodeCard();
  updateEditModeUI();
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

    if (e.target.closest("#heroToggle")) { toggleHero(); return; }

    const rankToggle = e.target.closest("[data-rank-toggle]");
    if (rankToggle) {
      const det = document.querySelector(`[data-rank-detail="${rankToggle.dataset.rankToggle}"]`);
      if (det) det.classList.toggle("hidden"); return;
    }

    const liveToggle = e.target.closest("[data-live-toggle]");
    if (liveToggle) {
      const mid = liveToggle.dataset.liveToggle;
      const det = document.querySelector(`[data-live-detail="${mid}"]`);
      if (det) {
        det.classList.toggle("hidden");
        if (det.classList.contains("hidden")) _openLiveDetails.delete(mid);
        else _openLiveDetails.add(mid);
      }
      return;
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

    // Admin payments buttons
    const paidBtn = e.target.closest("[data-paid]");
    if (paidBtn) {
      if (!guardAdmin()) return;
      const s = state();
      s.paid[paidBtn.dataset.paid] = !s.paid[paidBtn.dataset.paid];
      saveState(s, { forceResults: true });
      renderParticipants();
      renderAdminPayments(state());
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
  $("#espnSync")?.addEventListener("click", () => runEspnUpdate().catch(err => { console.warn("ESPN update failed", err); alert("Erro ESPN. Verifique o console."); }));
  $("#forceSync")?.addEventListener("click", forceSyncFromRemote);
  $("#clearData")?.addEventListener("click", clearAllData);
  $("#backupCsv")?.addEventListener("click", () => { if (guardAdmin()) backupCsv(); });
  $("#masterCsv")?.addEventListener("click", () => { if (guardAdmin()) masterCsv(); });
  $("#masterHtml")?.addEventListener("click", () => { if (guardAdmin()) masterHtml(); });
  $("#backupJson")?.addEventListener("click", () => { if (guardAdmin()) backupJson(); });
  $("#sendResultEmailTest")?.addEventListener("click", () => sendResultEmailFromAdmin(true));
  $("#sendResultEmailAll")?.addEventListener("click", () => sendResultEmailFromAdmin(false));

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
  setInterval(() => { updateCountdown(); renderNextMatch(); }, 1000);
  startLiveScorePolling();
  setInterval(() => { if (!document.hidden) debouncedReload(); }, 90000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopResultsPolling();
      stopLiveScorePolling();
    } else {
      debouncedReload();
      if (isAdminActive() && apiFootballConfigured()) startResultsPolling();
      startLiveScorePolling();
    }
  });
  window.addEventListener("focus", () => {
    debouncedReload();
    if (isAdminActive() && apiFootballConfigured()) startResultsPolling();
    startLiveScorePolling();
  });

  // Disable entry nav button only after cutoff; default landing depends on cutoff
  const navEntryBtn = document.querySelector('.nav button[data-section="entry"]');
  if (navEntryBtn) navEntryBtn.disabled = isPastCutoff();
  showSection(isPastCutoff() ? "ranking" : "entry");
}

document.addEventListener("DOMContentLoaded", () => init().catch(err => console.error("Init failed", err)));

window.Bolao = { openReceipt, downloadReceipt, showSection };

})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bolao-teste/sw.js').catch(() => {});
}
