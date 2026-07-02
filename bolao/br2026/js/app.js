/* Bolão Brasileirão 2026 — app.js v1.0
   Vanilla JS IIFE, no framework, no build step */
(function () {
"use strict";

// ─── Aliases ────────────────────────────────────────────────────────────────
const C    = window.BR2026_CONFIG;
const DATA = window.BR2026_DATA;
const $    = id => document.getElementById(id);
const $$   = sel => [...document.querySelectorAll(sel)];
const esc  = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── i18n ───────────────────────────────────────────────────────────────────
let _lang = localStorage.getItem("bolao_br2026_lang") || "pt-BR";
const t = key => window.BR2026_I18N?.[_lang]?.[key]
             ?? window.BR2026_I18N?.["pt-BR"]?.[key] ?? key;

function setLang(l) {
  _lang = l;
  localStorage.setItem("bolao_br2026_lang", l);
  document.documentElement.lang = l.split("-")[0];
  applyI18n();
  renderAll();
}
function applyI18n() {
  $$("[data-i18n]").forEach(el => { const v = t(el.dataset.i18n); if (v) el.textContent = v; });
  $$("[data-lang]").forEach(b => b.classList.toggle("active", b.dataset.lang === _lang));
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
    const merged = mergeStates(state(), data[0].state);
    localStorage.setItem(C.storeKey, JSON.stringify(merged));
  } catch (err) { console.warn("[BR2026] Supabase load failed", err); }
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
function mergeStates(local, remote) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  const byId = {};
  [...(remote.entries || []), ...(local.entries || [])].forEach(e => { if (!deleted.has(e.id)) byId[e.id] = e; });
  const paid = { ...(remote.paid || {}), ...(local.paid || {}) };
  const results = local.results?.locked ? local.results : (remote.results?.locked ? remote.results : local.results || remote.results);
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
let _loginAttempts  = Number(sessionStorage.getItem("br2026_loginAttempts") || 0);
let _loginLockUntil = Number(sessionStorage.getItem("br2026_loginLockUntil") || 0);

function isAdminActive() { return Number(sessionStorage.getItem("br2026_adminUntil") || 0) > Date.now(); }
function guardAdmin() { if (isAdminActive()) return true; showSection("admin"); return false; }

// ─── Sections ───────────────────────────────────────────────────────────────
function showSection(id) {
  $$(".page").forEach(p => p.classList.toggle("active", p.id === id));
  $$(".nav button[data-section]").forEach(b => b.classList.toggle("active", b.dataset.section === id));
  const h = document.querySelector(`#${id} h2, #${id} h3`);
  if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: false }); }
  if (id === "admin") renderAdmin();
}

// ─── Cutoff ─────────────────────────────────────────────────────────────────
const cutoffDate = () => new Date(C.cutoffIso);
const isPastCutoff = () => Date.now() > cutoffDate().getTime();

// ─── UUID ───────────────────────────────────────────────────────────────────
function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

// ─── Pick dropdowns ─────────────────────────────────────────────────────────
function getPickValues() {
  return {
    g4: [1, 2, 3, 4].map(i => $(`br-g4-${i}`)?.value || ""),
    z4: [17, 18, 19, 20].map(i => $(`br-z4-${i}`)?.value || ""),
  };
}

function updateDropdowns() {
  const { g4, z4 } = getPickValues();
  const allPicked = new Set([...g4, ...z4].filter(Boolean));
  const allSelects = [
    ...[1, 2, 3, 4].map(i => ({ el: $(`br-g4-${i}`), own: g4[i - 1] })),
    ...[17, 18, 19, 20].map((pos, i) => ({ el: $(`br-z4-${pos}`), own: z4[i] })),
  ];
  allSelects.forEach(({ el, own }) => {
    if (!el) return;
    el.querySelectorAll("option[value]").forEach(opt => {
      if (!opt.value) return;
      opt.disabled = allPicked.has(opt.value) && opt.value !== own;
    });
  });
}

function renderPickForm() {
  const locked = isPastCutoff();
  const teamOpts = DATA.teams
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(team => `<option value="${esc(team)}">${esc(team)}</option>`)
    .join("");

  const dropdown = (id, labelKey, pts, hintKey) => `
    <div class="pick-row">
      <label for="${id}">
        <span class="pick-pos-label">${esc(t(labelKey))}</span>
        <span class="pick-pts-hint">${esc(pts)}</span>
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
      <div class="pick-group-header g4-header">🏆 ${esc(t("g4Title"))}</div>
      <p class="pick-group-note">${esc(t("g4Subtitle"))}</p>
      ${dropdown("br-g4-1",  "pos1",  "30 pts — exato / 10 no G4")}
      ${dropdown("br-g4-2",  "pos2",  "20 pts — exato / 10 no G4")}
      ${dropdown("br-g4-3",  "pos3",  "15 pts — exato / 10 no G4")}
      ${dropdown("br-g4-4",  "pos4",  "15 pts — exato / 10 no G4")}
    </div>
    <div class="pick-group">
      <div class="pick-group-header z4-header">⬇️ ${esc(t("z4Title"))}</div>
      <p class="pick-group-note">${esc(t("z4Subtitle"))}</p>
      ${dropdown("br-z4-17", "pos17", "12 pts — exato / 8 no Z4")}
      ${dropdown("br-z4-18", "pos18", "12 pts — exato / 8 no Z4")}
      ${dropdown("br-z4-19", "pos19", "12 pts — exato / 8 no Z4")}
      ${dropdown("br-z4-20", "pos20", "12 pts — exato / 8 no Z4")}
    </div>`;

  if (_editingEntry) {
    const p = _editingEntry.picks || {};
    (p.g4 || []).forEach((team, i) => { const el = $(`br-g4-${i + 1}`); if (el && team) el.value = team; });
    (p.z4 || []).forEach((team, i) => { const el = $(`br-z4-${[17,18,19,20][i]}`); if (el && team) el.value = team; });
  }

  form.removeEventListener("change", updateDropdowns);
  form.addEventListener("change", updateDropdowns);
  updateDropdowns();
}

// ─── Validation ──────────────────────────────────────────────────────────────
function validatePicks(g4, z4) {
  const errors = [];
  if (g4.some(x => !x)) errors.push(t("errorG4Incomplete"));
  if (z4.some(x => !x)) errors.push(t("errorZ4Incomplete"));
  if (new Set(g4.filter(Boolean)).size < g4.filter(Boolean).length) errors.push(t("errorDuplicateG4"));
  if (new Set(z4.filter(Boolean)).size < z4.filter(Boolean).length) errors.push(t("errorDuplicateZ4"));
  const overlap = g4.filter(team => team && z4.includes(team));
  if (overlap.length) errors.push(t("errorG4Z4Overlap").replace("{teams}", overlap.join(", ")));
  return errors;
}

// ─── Save entry ──────────────────────────────────────────────────────────────
async function saveEntry() {
  if (isPastCutoff()) { alert(t("closed")); return; }
  const entryName = $("entryName")?.value.trim() || "";
  const payerName = $("payerName")?.value.trim() || "";
  const email = $("participantEmail")?.value.trim() || "";
  const paymentMethod = $("paymentMethod")?.value || "";

  if (!entryName) { alert(t("errorEntryName")); return; }
  if (!email || !email.includes("@")) { alert(t("errorEmail")); return; }

  const { g4, z4 } = getPickValues();
  const errors = validatePicks(g4, z4);
  if (errors.length) { alert(errors.join("\n")); return; }

  const btn = $("saveEntryBtn");
  if (btn) { btn.disabled = true; btn.textContent = t("saving"); }

  try {
    const s = state();
    const now = new Date().toISOString();
    const entry = _editingEntry
      ? { ..._editingEntry, entryName, payerName, participantEmail: email, paymentMethod, picks: { g4, z4 }, updatedAt: now }
      : { id: uuid(), entryName, payerName, participantEmail: email, paymentMethod, picks: { g4, z4 }, createdAt: now };

    if (_editingEntry) {
      const idx = s.entries.findIndex(e => e.id === entry.id);
      if (idx >= 0) s.entries[idx] = entry; else s.entries.push(entry);
    } else {
      s.entries.push(entry);
    }

    saveState(s);

    if (C.emailjs.enabled && window.emailjs) {
      sendReceipt(entry).catch(err => console.warn("[BR2026] Email failed", err));
    }

    _editingEntry = null;
    renderPickForm();
    ["entryName", "payerName", "participantEmail"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    $("paymentMethod") && ($("paymentMethod").value = "");

    alert(t("savedSuccess"));
    showSection("ranking");
  } catch (err) {
    console.error("[BR2026] Save error", err);
    alert(t("saveError"));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("saveEntry"); }
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────────
function scoreEntry(entry, g4Result, z4Result) {
  if (!g4Result || !z4Result) return null;
  const pg4 = entry.picks?.g4 || [];
  const pz4 = entry.picks?.z4 || [];
  const detail = { g4: [], z4: [] };
  let total = 0;

  C.scoring.g4Exact.forEach((exactPts, i) => {
    const picked = pg4[i] || "";
    if (!picked) { detail.g4.push(null); return; }
    if (g4Result[i] === picked) {
      total += exactPts; detail.g4.push({ pts: exactPts, type: "exact" });
    } else if (g4Result.includes(picked)) {
      total += C.scoring.g4Group; detail.g4.push({ pts: C.scoring.g4Group, type: "group" });
    } else {
      detail.g4.push({ pts: 0, type: "miss" });
    }
  });

  for (let i = 0; i < 4; i++) {
    const picked = pz4[i] || "";
    if (!picked) { detail.z4.push(null); continue; }
    if (z4Result[i] === picked) {
      total += C.scoring.z4Exact; detail.z4.push({ pts: C.scoring.z4Exact, type: "exact" });
    } else if (z4Result.includes(picked)) {
      total += C.scoring.z4Group; detail.z4.push({ pts: C.scoring.z4Group, type: "group" });
    } else {
      detail.z4.push({ pts: 0, type: "miss" });
    }
  }

  return { total, detail };
}

function getActiveScore(entry, s) {
  if (s.results?.locked && s.results?.g4 && s.results?.z4) {
    return { ...scoreEntry(entry, s.results.g4, s.results.z4), isOfficial: true };
  }
  if (_standings.length >= 20) {
    const g4 = _standings.slice(0, 4).map(team => team.name);
    const z4 = _standings.slice(16, 20).map(team => team.name);
    const sc = scoreEntry(entry, g4, z4);
    return sc ? { ...sc, isOfficial: false } : null;
  }
  return null;
}

// ─── ESPN polling ────────────────────────────────────────────────────────────
let _standings = [];        // sorted by rank (1st = index 0)
let _liveMatches = [];      // currently live matches
let _pollTime = 0;

async function fetchStandings() {
  try {
    const r = await fetch(C.espn.standingsUrl);
    const data = await r.json();
    const entries = data?.children?.[0]?.standings?.entries || [];
    const parsed = entries.map(e => ({
      name: e.team?.displayName || "",
      abbr: e.team?.abbreviation || "",
      rank: (e.stats?.find(s => s.name === "rank") || {}).value ?? 99,
      points: (e.stats?.find(s => s.name === "points") || {}).value ?? 0,
    })).filter(entry => entry.name).sort((a, b) => a.rank - b.rank);
    return parsed.length ? parsed : null;
  } catch (err) { console.warn("[BR2026] Standings fetch failed", err); return null; }
}

async function fetchScoreboard() {
  try {
    const r = await fetch(C.espn.scoreboardUrl + "?limit=20");
    const data = await r.json();
    return (data?.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const c = comp.competitors || [];
      const home = c.find(x => x.homeAway === "home") || c[0];
      const away = c.find(x => x.homeAway === "away") || c[1];
      const clockSec = typeof comp.status?.clock === "number" ? comp.status.clock : null;
      return {
        id: ev.id,
        state: comp.status?.type?.state,    // "pre" | "in" | "post"
        homeTeam: home?.team?.displayName || "",
        awayTeam: away?.team?.displayName || "",
        homeScore: parseInt(home?.score || "0", 10),
        awayScore: parseInt(away?.score || "0", 10),
        clockSec,
        clockStr: comp.status?.displayClock || "",
      };
    }).filter(Boolean);
  } catch (err) { console.warn("[BR2026] Scoreboard fetch failed", err); return null; }
}

async function pollAll() {
  const [standings, matches] = await Promise.all([fetchStandings(), fetchScoreboard()]);
  if (standings) _standings = standings;
  if (matches !== null) { _liveMatches = matches.filter(m => m.state === "in"); _pollTime = Date.now(); }
  renderLiveCard();
  renderStandingsCard();
  renderRanking();
}

// ─── Ticker (running clock) ──────────────────────────────────────────────────
function formatClock(totalSec) {
  const m = Math.floor(totalSec / 60), s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Render: live match card ─────────────────────────────────────────────────
function renderLiveCard() {
  const card = $("liveMatchCard");
  if (!card) return;
  if (!_liveMatches.length) { card.classList.add("hidden"); return; }
  const elapsed = sec => sec !== null
    ? Math.floor(sec + (Date.now() - _pollTime) / 1000)
    : null;
  card.innerHTML = _liveMatches.map(m => {
    const sec = elapsed(m.clockSec);
    const clock = sec !== null ? formatClock(sec) : m.clockStr;
    return `<div class="live-match">
      <span class="live-badge">${esc(t("liveNow"))}</span>
      <div class="live-teams">
        <span class="live-team-name">${esc(m.homeTeam)}</span>
        <span class="live-score">${m.homeScore} – ${m.awayScore}</span>
        <span class="live-team-name">${esc(m.awayTeam)}</span>
      </div>
      <span class="live-clock">${esc(clock)}</span>
    </div>`;
  }).join("");
  card.classList.remove("hidden");
}

// ─── Render: standings table ─────────────────────────────────────────────────
function renderStandingsCard() {
  const card = $("standingsCard");
  if (!card) return;
  if (!_standings.length) {
    card.innerHTML = `<p class="muted">${esc(t("standingsLoading"))}</p>`;
    return;
  }
  const rows = _standings.map((team, i) => {
    const pos = i + 1;
    const zoneClass = pos <= 4 ? "g4-zone" : pos >= 17 ? "z4-zone" : "";
    const badge = pos <= 4 ? `<span class="zone-badge g4-badge">G4</span>` : pos >= 17 ? `<span class="zone-badge z4-badge">Z4</span>` : "";
    return `<tr class="${zoneClass}">
      <td class="td-pos">${pos}</td>
      <td>${esc(team.name)}${badge}</td>
      <td class="td-pts">${Math.round(team.points)}</td>
    </tr>`;
  }).join("");
  card.innerHTML = `
    <h3>${esc(t("standingsTitle"))}</h3>
    <div class="standings-wrap">
      <table class="standings-table">
        <thead><tr><th>#</th><th>${esc(t("team"))}</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="footer-note">${esc(t("standingsSource"))}</p>`;
}

// ─── Render: ranking ─────────────────────────────────────────────────────────
function renderRanking() {
  const box = $("rankingList");
  if (!box) return;
  const s = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));

  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }

  const scored = entries.map(e => {
    const sc = getActiveScore(e, s) || { total: 0, detail: null, isOfficial: false };
    return { e, ...sc };
  }).sort((a, b) => b.total - a.total || a.e.entryName.localeCompare(b.e.entryName, "pt-BR"));

  const hasAnyProvisional = scored.some(x => !x.isOfficial && _standings.length >= 20);
  const provNote = hasAnyProvisional
    ? `<p class="prov-note">↕ ${esc(t("provisionalNote"))}</p>` : "";

  let rank = 0, prevPts = -1;
  const rows = scored.map((item, i) => {
    if (item.total !== prevPts) { rank = i + 1; prevPts = item.total; }
    const paid = (s.paid || {})[item.e.id];
    const medal = { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `${rank}.`;
    const paidBadge = paid
      ? `<span class="paid-badge">${esc(t("paid"))}</span>`
      : `<span class="unpaid-badge">${esc(t("unpaid"))}</span>`;
    return `<div class="rank-card">
      <div class="rank-top">
        <span class="rank-pos">${medal}</span>
        <span class="rank-name">${esc(item.e.entryName)}</span>
        <span class="rank-pts${!item.isOfficial && item.total > 0 ? " prov" : ""}">
          ${item.total}<small>${!item.isOfficial && item.total > 0 ? " ↕" : " pts"}</small>
        </span>
        ${paidBadge}
      </div>
      ${renderPickDisplay(item.e, item.detail)}
    </div>`;
  }).join("");

  box.innerHTML = provNote + rows;
}

function renderPickDisplay(entry, detail) {
  const p = entry.picks || {};
  const g4 = p.g4 || [];
  const z4 = p.z4 || [];
  const g4Labels = ["pos1","pos2","pos3","pos4"].map(t);
  const z4Labels = ["pos17","pos18","pos19","pos20"].map(t);

  const mkCell = (team, d) => {
    if (!team) return `<div class="pick-cell pick-empty">—</div>`;
    const cls = d ? (d.type === "exact" ? "pick-exact" : d.type === "group" ? "pick-group" : "pick-miss") : "";
    const badge = d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : "";
    return `<div class="pick-cell ${cls}">${esc(team)}${badge}</div>`;
  };

  const g4html = g4.map((team, i) => `
    <div class="pick-item">
      <span class="pick-pos-lbl">${esc(g4Labels[i])}</span>
      ${mkCell(team, detail?.g4?.[i])}
    </div>`).join("");
  const z4html = z4.map((team, i) => `
    <div class="pick-item">
      <span class="pick-pos-lbl">${esc(z4Labels[i])}</span>
      ${mkCell(team, detail?.z4?.[i])}
    </div>`).join("");

  return `<div class="picks-display">
    <div class="picks-col"><div class="picks-col-header g4-header-sm">🏆 G4</div>${g4html}</div>
    <div class="picks-col"><div class="picks-col-header z4-header-sm">⬇️ Z4</div>${z4html}</div>
  </div>`;
}

// ─── Render: participants ─────────────────────────────────────────────────────
function renderParticipants() {
  const box = $("participantsList");
  if (!box) return;
  const s = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }
  const total = entries.length;
  const paid = entries.filter(e => (s.paid || {})[e.id]).length;
  const pot = (total * C.entryFee).toFixed(0);
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
    const handleHtml = link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(handle)}</a>`
      : esc(handle);
    return `<div class="pay-card"><strong>${esc(method)}</strong><span>${handleHtml}</span></div>`;
  }).join("");
}

// ─── Render: rules ───────────────────────────────────────────────────────────
function renderRules() {
  const box = $("rulesContent");
  if (!box) return;
  const cutoff = cutoffDate().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  box.innerHTML = `
    <div class="card">
      <h3>${esc(t("rulesScoring"))}</h3>
      <table class="rules-table">
        <thead><tr><th>${esc(t("rulesAcerto"))}</th><th>${esc(t("rulesPts"))}</th></tr></thead>
        <tbody>
          <tr><td>🥇 1º Lugar (${esc(t("rulesExact"))})</td><td><b>30</b></td></tr>
          <tr><td>🥇 1º Lugar (${esc(t("rulesInG4"))})</td><td>10</td></tr>
          <tr><td>🥈 2º Lugar (${esc(t("rulesExact"))})</td><td><b>20</b></td></tr>
          <tr><td>🥈 2º Lugar (${esc(t("rulesInG4"))})</td><td>10</td></tr>
          <tr><td>3º / 4º G4 (${esc(t("rulesExact"))})</td><td><b>15</b></td></tr>
          <tr><td>3º / 4º G4 (${esc(t("rulesInG4"))})</td><td>10</td></tr>
          <tr class="z4-zone"><td>17º–20º Z4 (${esc(t("rulesExact"))})</td><td><b>12</b></td></tr>
          <tr class="z4-zone"><td>17º–20º Z4 (${esc(t("rulesInZ4"))})</td><td>8</td></tr>
        </tbody>
      </table>
      <p>${esc(t("rulesMaxPoints"))}: <b>128 pts</b> (G4: 80 + Z4: 48)</p>
      <p>${esc(t("rulesPrizes"))}: 1º 70% · 2º 20% · 3º 10%</p>
      <p>${esc(t("rulesCutoff"))}: <b>${cutoff} (Brasília)</b></p>
      <p class="muted small-text">${esc(C.transparency.disclaimer)}</p>
    </div>`;
}

// ─── Render: admin ───────────────────────────────────────────────────────────
function renderAdmin() {
  if (!isAdminActive()) return;
  const s = state();
  renderAdminPayments(s);
  renderAdminResults(s);
  renderAdminEntries(s);
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

function renderAdminResults(s) {
  const box = $("adminResults");
  if (!box) return;
  const r = s.results;
  const locked = r?.locked;
  const opts = DATA.teams.sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(team => `<option value="${esc(team)}">${esc(team)}</option>`).join("");
  const sel = (id, val) =>
    `<select id="${id}" ${locked ? "disabled" : ""}><option value="">—</option>${opts}</select>`;

  const g4rows = [0,1,2,3].map(i => `
    <div class="admin-row">
      <label for="adm-g4-${i}">${esc([t("pos1"),t("pos2"),t("pos3"),t("pos4")][i])}</label>
      ${sel(`adm-g4-${i}`, r?.g4?.[i] || "")}
    </div>`).join("");
  const z4rows = [0,1,2,3].map(i => `
    <div class="admin-row">
      <label for="adm-z4-${i}">${esc([t("pos17"),t("pos18"),t("pos19"),t("pos20")][i])}</label>
      ${sel(`adm-z4-${i}`, r?.z4?.[i] || "")}
    </div>`).join("");

  box.innerHTML = `
    <h3>${esc(t("adminResults"))}</h3>
    ${locked ? `<p class="paid-badge">${esc(t("resultsLocked"))}</p>` : ""}
    <div class="admin-results-grid">
      <div><h4>🏆 G4</h4>${g4rows}</div>
      <div><h4>⬇️ Z4</h4>${z4rows}</div>
    </div>
    <div class="button-row" style="margin-top:14px;gap:8px">
      ${!locked ? `<button type="button" id="espnFillResultsBtn" class="secondary small-btn">${esc(t("espnFillResultsBtn"))}</button>` : ""}
      ${!locked ? `<button type="button" id="saveResultsBtn">${esc(t("saveResults"))}</button>` : ""}
      ${locked ? `<button type="button" id="unlockResultsBtn" class="secondary">${esc(t("unlockResults"))}</button>` : ""}
    </div>`;

  // Populate existing values after render (innerHTML replaced, so must re-query)
  if (r?.g4) r.g4.forEach((v, i) => { const el = $(`adm-g4-${i}`); if (el && v) el.value = v; });
  if (r?.z4) r.z4.forEach((v, i) => { const el = $(`adm-z4-${i}`); if (el && v) el.value = v; });

  $("espnFillResultsBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    const standings = await fetchStandings();
    if (!standings || standings.length < 20) { alert("ESPN fetch failed — try again."); return; }
    const g4 = standings.slice(0, 4).map(team => team.name);
    const z4 = standings.slice(16, 20).map(team => team.name);
    g4.forEach((v, i) => { const el = $(`adm-g4-${i}`); if (el) el.value = v; });
    z4.forEach((v, i) => { const el = $(`adm-z4-${i}`); if (el) el.value = v; });
    alert(`G4: ${g4.join(", ")}\nZ4: ${z4.join(", ")}`);
  });

  $("saveResultsBtn")?.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const g4 = [0,1,2,3].map(i => $(`adm-g4-${i}`)?.value || "");
    const z4 = [0,1,2,3].map(i => $(`adm-z4-${i}`)?.value || "");
    if (g4.some(v => !v) || z4.some(v => !v)) { alert(t("errorResultsIncomplete")); return; }
    const overlap = g4.filter(v => z4.includes(v));
    if (overlap.length) { alert(t("errorG4Z4Overlap").replace("{teams}", overlap.join(", "))); return; }
    if (!confirm(t("confirmLockResults"))) return;
    const s2 = state();
    s2.results = { locked: true, g4, z4, lockedAt: new Date().toISOString() };
    saveState(s2);
    alert(t("resultsSaved"));
    renderAdmin();
  });

  $("unlockResultsBtn")?.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmUnlockResults"))) return;
    const s2 = state();
    s2.results = { ...s2.results, locked: false };
    saveState(s2);
    renderAdmin();
  });
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
        <span class="muted small-text">${esc(e.participantEmail || "")}</span>
        <button type="button" class="secondary small-btn" data-edit="${esc(e.id)}">${esc(t("edit"))}</button>
        <button type="button" class="danger small-btn" data-del="${esc(e.id)}">${esc(t("delete"))}</button>
      </div>`).join("") : `<p class="muted">${esc(t("noEntries"))}</p>`);

  box.querySelectorAll("[data-edit]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!guardAdmin()) return;
      const entry = state().entries.find(e => e.id === btn.dataset.edit);
      if (!entry) return;
      _editingEntry = entry;
      $("entryName").value = entry.entryName || "";
      $("payerName").value = entry.payerName || "";
      $("participantEmail").value = entry.participantEmail || "";
      $("paymentMethod").value = entry.paymentMethod || "";
      renderPickForm();
      showSection("entry");
    })
  );

  box.querySelectorAll("[data-del]").forEach(btn =>
    btn.addEventListener("click", () => {
      if (!guardAdmin()) return;
      if (!confirm(t("confirmDelete"))) return;
      const s2 = state();
      s2.deletedIds = [...(s2.deletedIds || []), btn.dataset.del];
      saveState(s2);
      renderAdmin();
    })
  );
}

// ─── CSV export ──────────────────────────────────────────────────────────────
function exportCsv() {
  const s = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  const header = ["Entrada","Pagador","Email","Método","Pago","G4-1","G4-2","G4-3","G4-4","Z4-17","Z4-18","Z4-19","Z4-20","Pontos"].join(",");
  const rows = entries.map(e => {
    const picks = [...(e.picks?.g4 || []), ...(e.picks?.z4 || [])];
    const sc = getActiveScore(e, s);
    return [e.entryName, e.payerName || "", e.participantEmail || "", e.paymentMethod || "",
      (s.paid || {})[e.id] ? "Sim" : "Não", ...picks, sc?.total ?? 0]
      .map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",");
  });
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bolao-br2026-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── Email receipt ───────────────────────────────────────────────────────────
async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  const g4 = entry.picks?.g4 || [];
  const z4 = entry.picks?.z4 || [];
  const g4rows = g4.map((team, i) => `<tr><td style="padding:4px 8px">${[t("pos1"),t("pos2"),t("pos3"),t("pos4")][i]}</td><td style="padding:4px 8px"><b>${team || "—"}</b></td></tr>`).join("");
  const z4rows = z4.map((team, i) => `<tr><td style="padding:4px 8px">${[t("pos17"),t("pos18"),t("pos19"),t("pos20")][i]}</td><td style="padding:4px 8px"><b>${team || "—"}</b></td></tr>`).join("");
  const html = `
<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#07141b;color:#eef7f1;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#155e1e,#14532d);padding:20px;text-align:center">
    <div style="font-size:24px;font-weight:900">🇧🇷 Bolão Brasileirão 2026</div>
    <div style="opacity:.75;font-size:13px;margin-top:4px">Comprovante de palpite</div>
  </div>
  <div style="padding:20px">
    <p><b>Entrada:</b> ${esc(entry.entryName)}</p>
    <p><b>Código:</b> BR2026-${(entry.id || "").slice(0,8).toUpperCase()}</p>
    <h3 style="color:#2fe56e">🏆 G4 — Libertadores</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#0d2028;border-radius:8px"><tbody>${g4rows}</tbody></table>
    <h3 style="color:#f87171;margin-top:14px">⬇️ Z4 — Rebaixamento</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#0d2028;border-radius:8px"><tbody>${z4rows}</tbody></table>
    <p style="margin-top:16px;font-size:11px;opacity:.6">Bolão informal entre amigos. ${new Date().toLocaleString("pt-BR")}</p>
  </div>
</div>`;
  await window.emailjs.send(C.emailjs.serviceId, C.emailjs.participantTemplateId, {
    to_email: entry.participantEmail,
    entry_name: `Brasileirão 2026 — ${entry.entryName}`,
    receipt_code: `BR2026-${(entry.id || "").slice(0, 8).toUpperCase()}`,
    html_message: html,
  }, { publicKey: C.emailjs.publicKey });
}

// ─── Countdown ───────────────────────────────────────────────────────────────
function renderCountdown() {
  const el = $("cutoffCountdown");
  if (!el) return;
  const diff = cutoffDate() - Date.now();
  if (diff <= 0) { el.innerHTML = `<strong>${esc(t("closedLabel"))}</strong>`; return; }
  const p2 = n => String(n).padStart(2, "0");
  const totalSec = Math.floor(diff / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  el.innerHTML = `<div class="count-grid">
    <div><b>${d}</b><span>${esc(t("countdownDays"))}</span></div>
    <div><b>${p2(h)}</b><span>${esc(t("countdownHours"))}</span></div>
    <div><b>${p2(m)}</b><span>${esc(t("countdownMin"))}</span></div>
    <div><b>${p2(s)}</b><span>${esc(t("countdownSec"))}</span></div>
  </div>`;
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function renderFooter() {
  const el = $("siteFooterBar");
  if (!el) return;
  const s = state();
  const ts = s.meta?.updatedAt
    ? new Date(s.meta.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  el.textContent = ts ? `${C.siteVersion} · sync ${ts} BRT` : C.siteVersion;
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
  applyI18n();
  renderPickForm();
  renderRanking();
  renderParticipants();
  renderPayment();
  renderRules();
  renderStandingsCard();
  renderFooter();
  if (isAdminActive()) renderAdmin();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  // Language buttons
  $$("[data-lang]").forEach(btn => btn.addEventListener("click", () => setLang(btn.dataset.lang)));

  // Navigation
  $$("[data-section]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  showSection("entry");

  // Countdown
  renderCountdown();
  setInterval(renderCountdown, 1000);

  // Save entry
  $("saveEntryBtn")?.addEventListener("click", saveEntry);

  // Admin login
  $("adminPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") $("adminLoginBtn")?.click(); });
  $("adminLoginBtn")?.addEventListener("click", async () => {
    const now = Date.now();
    if (now < _loginLockUntil) {
      alert(t("adminLocked").replace("{min}", Math.ceil((_loginLockUntil - now) / 60000))); return;
    }
    const pw = $("adminPassword")?.value || "";
    const hash = await sha256hex(pw);
    if (hash === C.adminPasswordHash) {
      _loginAttempts = 0;
      sessionStorage.removeItem("br2026_loginAttempts");
      sessionStorage.setItem("br2026_adminUntil", String(Date.now() + C.adminSessionMinutes * 60000));
      $("adminLogin")?.classList.add("hidden");
      $("adminArea")?.classList.remove("hidden");
      renderAdmin();
    } else {
      _loginAttempts++;
      sessionStorage.setItem("br2026_loginAttempts", _loginAttempts);
      if (_loginAttempts >= C.adminMaxAttempts) {
        _loginLockUntil = Date.now() + C.adminLockMinutes * 60000;
        sessionStorage.setItem("br2026_loginLockUntil", _loginLockUntil);
        alert(t("adminLockedNow").replace("{min}", C.adminLockMinutes));
      } else {
        alert(t("adminWrongPassword").replace("{n}", C.adminMaxAttempts - _loginAttempts));
      }
    }
  });

  $("adminLogoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("br2026_adminUntil");
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

  // Load remote state, render, start ESPN polling
  await loadRemoteState();
  renderAll();

  // ESPN: poll immediately, then every 60s
  pollAll();
  setInterval(pollAll, C.espn.pollIntervalMs);

  // 1s ticker for running clock
  setInterval(renderLiveCard, 1000);
}

init();

})();
