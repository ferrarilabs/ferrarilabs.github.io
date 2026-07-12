/* Bolão Brasileirão 2026 — app.js v1.3
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
// BR2026 is PT-BR only. Keep setLang/applyI18n for data-i18n attribute support.
let _lang = "pt-BR";
const t = key => window.BR2026_I18N?.["pt-BR"]?.[key] ?? key;

function setLang(l) {
  _lang = l;
  localStorage.setItem("bolao_br2026_lang", l);
  document.documentElement.lang = l.split("-")[0];
  applyI18n();
  renderAll();
}
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
  if (id === "probs") renderProbSection();
  if (id === "games") {
    setTimeout(() => {
      const next = document.querySelector("#gamesList .game-card.pre");
      next?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }
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
    g4:  [1, 2, 3, 4].map(i => $(`br-g4-${i}`)?.value || ""),
    sa6: [1, 2, 3, 4, 5, 6].map(i => $(`br-sa-${i}`)?.value || ""),
    z4:  [17, 18, 19, 20].map(i => $(`br-z4-${i}`)?.value || ""),
  };
}

function updateDropdowns() {
  const { g4, sa6, z4 } = getPickValues();
  const allPicked = new Set([...g4, ...sa6, ...z4].filter(Boolean));
  const allSelects = [
    ...[1, 2, 3, 4].map(i => ({ el: $(`br-g4-${i}`), own: g4[i - 1] })),
    ...[1, 2, 3, 4, 5, 6].map(i => ({ el: $(`br-sa-${i}`), own: sa6[i - 1] })),
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

  const dropdown = (id, labelKey, pts) => `
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

  // SA6 dropdowns — label uses {n} replacement
  const sa6Dropdowns = [1, 2, 3, 4, 5, 6].map(i => {
    const label = t("sa6SelectLabel").replace("{n}", i);
    return `<div class="pick-row">
      <label for="br-sa-${i}">
        <span class="pick-pos-label">${esc(label)}</span>
        <span class="pick-pts-hint">${esc(t("sa6Hit"))}</span>
      </label>
      <select id="br-sa-${i}" class="pick-select" ${locked ? "disabled" : ""}>
        <option value="">${esc(t("pickSelectTeam"))}</option>
        ${teamOpts}
      </select>
    </div>`;
  }).join("");

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
      <div class="pick-group-header sa6-header">🟡 ${esc(t("sa6Title"))}</div>
      <p class="pick-group-note">${esc(t("sa6Subtitle"))}</p>
      ${sa6Dropdowns}
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
    (p.g4  || []).forEach((team, i) => { const el = $(`br-g4-${i + 1}`);         if (el && team) el.value = team; });
    (p.sa6 || []).forEach((team, i) => { const el = $(`br-sa-${i + 1}`);         if (el && team) el.value = team; });
    (p.z4  || []).forEach((team, i) => { const el = $(`br-z4-${[17,18,19,20][i]}`); if (el && team) el.value = team; });
  }

  form.removeEventListener("change", updateDropdowns);
  form.addEventListener("change", updateDropdowns);
  updateDropdowns();
}

// ─── Validation ──────────────────────────────────────────────────────────────
function validatePicks(g4, sa6, z4) {
  const errors = [];
  if (g4.some(x => !x))  errors.push(t("errorG4Incomplete"));
  if (sa6.some(x => !x)) errors.push(t("errorSA6Incomplete"));
  if (z4.some(x => !x))  errors.push(t("errorZ4Incomplete"));
  if (new Set(g4.filter(Boolean)).size  < g4.filter(Boolean).length)  errors.push(t("errorDuplicateG4"));
  if (new Set(sa6.filter(Boolean)).size < sa6.filter(Boolean).length) errors.push(t("errorDuplicateSA6"));
  if (new Set(z4.filter(Boolean)).size  < z4.filter(Boolean).length)  errors.push(t("errorDuplicateZ4"));
  const g4z4Overlap = g4.filter(team => team && z4.includes(team));
  if (g4z4Overlap.length) errors.push(t("errorG4Z4Overlap").replace("{teams}", g4z4Overlap.join(", ")));
  const sa6Overlap = sa6.filter(team => team && (g4.includes(team) || z4.includes(team)));
  if (sa6Overlap.length) errors.push(t("errorSA6Overlap").replace("{teams}", sa6Overlap.join(", ")));
  return errors;
}

// ─── Save entry ──────────────────────────────────────────────────────────────
async function saveEntry() {
  if (isPastCutoff()) { alert(t("closed")); return; }
  const entryName    = $("entryName")?.value.trim() || "";
  const payerName    = $("payerName")?.value.trim() || "";
  const email        = $("participantEmail")?.value.trim() || "";
  const paymentMethod = $("paymentMethod")?.value || "";

  if (!entryName) { alert(t("errorEntryName")); return; }
  if (!email || !email.includes("@")) { alert(t("errorEmail")); return; }

  const { g4, sa6, z4 } = getPickValues();
  const errors = validatePicks(g4, sa6, z4);
  if (errors.length) { alert(errors.join("\n")); return; }

  const btn = $("saveEntryBtn");
  if (btn) { btn.disabled = true; btn.textContent = t("saving"); }

  try {
    const s   = state();
    const now = new Date().toISOString();
    const entry = _editingEntry
      ? { ..._editingEntry, entryName, payerName, participantEmail: email, paymentMethod, picks: { g4, sa6, z4 }, updatedAt: now }
      : { id: uuid(), entryName, payerName, participantEmail: email, paymentMethod, picks: { g4, sa6, z4 }, createdAt: now };

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
function scoreEntry(entry, g4Result, z4Result, sa6Result) {
  if (!g4Result || !z4Result) return null;
  const pg4  = entry.picks?.g4  || [];
  const pz4  = entry.picks?.z4  || [];
  const detail = { g4: [], z4: [], sa6: [] };
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

  // SA6: 8 pts for each pick that's in the sa6Result set (positions 7-12)
  const sa6Set   = new Set(sa6Result || []);
  const sa6Picks = entry.picks?.sa6 || [];
  let sa6Total = 0;
  sa6Picks.forEach(team => {
    if (!team) { detail.sa6.push(null); return; }
    const hit = sa6Set.has(team);
    const pts = hit ? C.scoring.sa6Hit : 0;
    sa6Total += pts;
    detail.sa6.push({ pts, type: hit ? "hit" : "miss" });
  });
  total += sa6Total;

  return { total, detail };
}

function getActiveScore(entry, s) {
  if (s.results?.locked && s.results?.g4 && s.results?.z4) {
    return { ...scoreEntry(entry, s.results.g4, s.results.z4, s.results.sa6), isOfficial: true };
  }
  if (_standings.length >= 20) {
    const g4  = _standings.slice(0,  4).map(tm => tm.name);
    const z4  = _standings.slice(16, 20).map(tm => tm.name);
    const sa6 = _standings.slice(6,  12).map(tm => tm.name);
    const sc  = scoreEntry(entry, g4, z4, sa6);
    return sc ? { ...sc, isOfficial: false } : null;
  }
  return null;
}

// ─── ESPN polling ────────────────────────────────────────────────────────────
let _standings  = [];   // sorted by rank (1st = index 0)
let _liveMatches = [];  // currently live matches
let _pollTime   = 0;
let _schedule   = [];   // full season events from ESPN
let _scheduleTs = 0;    // last schedule fetch timestamp
let _mcResult   = null; // Monte Carlo result cache
let _mcTs       = 0;    // timestamp of last MC run
let _matchProbs   = {};   // { "HomeTeam|AwayTeam": { pH, pD, pA } } for upcoming matches
let _ratingsCache = null; // invalidated on each standings poll
let _teamLogos    = {};   // { teamName: logoUrl } parsed from ESPN standings

async function fetchStandings() {
  try {
    const r = await fetch(C.espn.standingsUrl);
    const data = await r.json();
    const entries = data?.children?.[0]?.standings?.entries || [];
    const parsed = entries.map(e => {
      const getStat = (...names) => {
        for (const nm of names) {
          const hit = (e.stats || []).find(s => s.name === nm);
          if (hit) return hit.value ?? 0;
        }
        return 0;
      };
      return {
        name:   e.team?.displayName || "",
        abbr:   e.team?.abbreviation || "",
        logo:   e.team?.logos?.[0]?.href || "",
        rank:   getStat("rank") || 99,
        points: getStat("points"),
        played: getStat("gamesPlayed", "GP") || 1,
        gf:     getStat("pointsFor", "goalsFor"),
        ga:     getStat("pointsAgainst", "goalsAgainst"),
      };
    }).filter(entry => entry.name).sort((a, b) => a.rank - b.rank);
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
      const c    = comp.competitors || [];
      const home = c.find(x => x.homeAway === "home") || c[0];
      const away = c.find(x => x.homeAway === "away") || c[1];
      const clockSec = typeof comp.status?.clock === "number" ? comp.status.clock : null;
      return {
        id:        ev.id,
        state:     comp.status?.type?.state,
        homeTeam:  home?.team?.displayName || "",
        awayTeam:  away?.team?.displayName || "",
        homeScore: parseInt(home?.score || "0", 10),
        awayScore: parseInt(away?.score || "0", 10),
        clockSec,
        clockStr:  comp.status?.displayClock || "",
      };
    }).filter(Boolean);
  } catch (err) { console.warn("[BR2026] Scoreboard fetch failed", err); return null; }
}

async function pollAll() {
  const [standings, matches] = await Promise.all([fetchStandings(), fetchScoreboard()]);
  if (standings) {
    _standings    = standings;
    _matchProbs   = {};
    _ratingsCache = null;
    _teamLogos    = Object.fromEntries(standings.map(t => [t.name, t.logo]).filter(([,v]) => v));
    scheduleMC();
  }
  if (matches !== null) {
    _liveMatches = matches.filter(m => m.state === "in");
    _pollTime    = Date.now();
    // Overlay ALL fetched match states onto schedule cache (including "post" so
    // a finished game doesn't stay stuck as "ao vivo" until the 5-min TTL expires)
    matches.forEach(m => {
      const idx = _schedule.findIndex(g =>
        (g.homeTeam === m.homeTeam && g.awayTeam === m.awayTeam) ||
        (g.homeTeam === m.awayTeam && g.awayTeam === m.homeTeam)
      );
      if (idx >= 0) {
        _schedule[idx] = { ..._schedule[idx], state: m.state, homeScore: m.homeScore, awayScore: m.awayScore, clockStr: m.clockStr };
      }
    });
  }
  renderLiveCard();
  renderStandingsCard();
  renderRanking();
  if (_schedule.length) { renderGamesSection(); renderNextGameCard(); }
}

// ─── BRT helpers ────────────────────────────────────────────────────────────
// Always use { timeZone: "America/Sao_Paulo" } — never manual UTC offset arithmetic,
// which displays the wrong time for users outside Brazil.
function brtTimeStr(isoStr) {
  return new Date(isoStr).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}
function brtDateKey(isoStr) {
  // Returns "YYYY-MM-DD" in BRT, used for grouping games by day
  const s = new Date(isoStr).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const [dd, mm, yyyy] = s.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
function brtLongDate(isoStr) {
  return new Date(isoStr).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── Full-season schedule ────────────────────────────────────────────────────
async function fetchSchedule() {
  const CACHE_TTL = 5 * 60 * 1000;
  const cacheKey  = `br2026_schedule_${C.siteVersion}`;
  const now = Date.now();
  if (_schedule.length && now - _scheduleTs < CACHE_TTL) return;
  // Check sessionStorage cache (versioned key prevents stale structure reads)
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached?.ts && now - cached.ts < CACHE_TTL && cached.events?.length) {
      _schedule   = cached.events;
      _scheduleTs = cached.ts;
      return;
    }
  } catch {}
  try {
    const r = await fetch(C.espn.scheduleUrl, { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    _schedule = (data.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === "home") || comps[0];
      const away  = comps.find(c => c.homeAway === "away") || comps[1];
      return {
        id:        ev.id,
        dateISO:   comp.date || ev.date || "",
        state:     comp.status?.type?.state || "pre",
        detail:    comp.status?.type?.shortDetail || "",
        homeTeam:  home?.team?.displayName || "",
        awayTeam:  away?.team?.displayName || "",
        homeScore: home?.score != null ? parseInt(home.score, 10) : null,
        awayScore: away?.score != null ? parseInt(away.score, 10) : null,
        venue:     comp.venue?.fullName || "",
        city:      comp.venue?.address?.city || "",
      };
    }).filter(Boolean).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    _scheduleTs = now;
    sessionStorage.setItem(`br2026_schedule_${C.siteVersion}`, JSON.stringify({ ts: now, events: _schedule }));
  } catch (err) { console.warn("[BR2026] Schedule fetch failed", err); }
}

// ─── Ticker (running clock) ──────────────────────────────────────────────────
function formatClock(totalSec) {
  const m = Math.floor(totalSec / 60), s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Probability math (Poisson + Monte Carlo) ────────────────────────────────
function poisson(lambda, k) {
  if (k < 0) return 0;
  let logP = -lambda + k * Math.log(lambda || 1e-9);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function samplePoisson(lambda) {
  // Knuth's method — fast for lambda < 30
  const l = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > l);
  return k - 1;
}

function buildRatings() {
  if (_ratingsCache) return _ratingsCache;
  const completed = _schedule.filter(g => g.state === "post" && g.homeScore != null && g.awayScore != null);

  if (completed.length < 8) {
    // Early season: naive Poisson from standings averages
    const LG_AVG = 1.3, MIN_R = 0.3;
    const ratings = {};
    _standings.forEach(tm => {
      const n = Math.max(tm.played || 1, 1);
      ratings[tm.name] = { atk: Math.max((tm.gf||0)/n/LG_AVG, MIN_R), def: Math.max((tm.ga||0)/n/LG_AVG, MIN_R) };
    });
    _ratingsCache = ratings;
    return ratings;
  }

  // Dixon-Coles (1997) iterative proportional fitting with exponential time decay.
  // Estimates attack (α) and defense (β) jointly from observed goals — correctly
  // accounts for opponent quality instead of using naive season averages.
  const sorted = [...completed].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const N = sorted.length;
  const DECAY = 10; // half-weight at ~7 games back
  const weights = sorted.map((_, i) => Math.exp(-(N - 1 - i) / DECAY));
  const HOME_ADV = 1.15;
  const teams = [...new Set([...sorted.map(m => m.homeTeam), ...sorted.map(m => m.awayTeam)])];
  const alpha = {}, beta = {};
  teams.forEach(t => { alpha[t] = 1.0; beta[t] = 1.0; });

  for (let iter = 0; iter < 50; iter++) {
    teams.forEach(t => {
      let obs = 0, exp = 0;
      sorted.forEach((m, i) => {
        const w = weights[i];
        if (m.homeTeam === t) { obs += w * m.homeScore; exp += w * alpha[t] * beta[m.awayTeam] * HOME_ADV; }
        if (m.awayTeam === t) { obs += w * m.awayScore; exp += w * alpha[t] * beta[m.homeTeam]; }
      });
      if (exp > 0) alpha[t] = alpha[t] * obs / exp;
    });
    teams.forEach(t => {
      let obs = 0, exp = 0;
      sorted.forEach((m, i) => {
        const w = weights[i];
        if (m.homeTeam === t) { obs += w * m.awayScore; exp += w * alpha[m.awayTeam] * beta[t]; }
        if (m.awayTeam === t) { obs += w * m.homeScore; exp += w * alpha[m.homeTeam] * beta[t] * HOME_ADV; }
      });
      if (exp > 0) beta[t] = beta[t] * obs / exp;
    });
    // Identifiability: set geometric mean of α = 1
    const gm = Math.exp(teams.reduce((s, t) => s + Math.log(Math.max(alpha[t], 1e-9)), 0) / teams.length);
    teams.forEach(t => { alpha[t] /= gm; beta[t] *= gm; });
  }

  const ratings = { __dixonColes: true };
  teams.forEach(t => { ratings[t] = { atk: alpha[t], def: beta[t] }; });
  _standings.forEach(tm => { if (!ratings[tm.name]) ratings[tm.name] = { atk: 1.0, def: 1.0 }; });
  _ratingsCache = ratings;
  return ratings;
}

function expectedGoals(home, away, ratings) {
  const HOME_ADV = 1.15;
  const h = ratings[home] || { atk: 1, def: 1 };
  const a = ratings[away] || { atk: 1, def: 1 };
  if (ratings.__dixonColes) {
    // IPF parameters are already on the correct absolute scale; no LG_AVG factor needed
    return { lambdaH: h.atk * a.def * HOME_ADV, lambdaA: a.atk * h.def };
  }
  const LG_AVG = 1.3;
  return { lambdaH: h.atk * a.def * LG_AVG * HOME_ADV, lambdaA: a.atk * h.def * LG_AVG };
}

function matchProb(lambdaH, lambdaA) {
  const MAX = 8, RHO = -0.13;
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      // Dixon-Coles low-score correction
      const tau = i <= 1 && j <= 1
        ? (i===0&&j===0 ? 1-lambdaH*lambdaA*RHO : i===0&&j===1 ? 1+lambdaH*RHO : i===1&&j===0 ? 1+lambdaA*RHO : 1-RHO)
        : 1;
      const p = poisson(lambdaH, i) * poisson(lambdaA, j) * tau;
      if (i > j) pH += p;
      else if (i === j) pD += p;
      else pA += p;
    }
  }
  const sum = pH + pD + pA || 1;
  return { pH: pH / sum, pD: pD / sum, pA: pA / sum };
}

function inPlayProb(lambdaH, lambdaA, minuteElapsed, homeGoals, awayGoals) {
  const timeRem = Math.max(0, 90 - minuteElapsed) / 90;
  const lhRem = lambdaH * timeRem;
  const laRem = lambdaA * timeRem;
  const MAX = 8;
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poisson(lhRem, i) * poisson(laRem, j);
      const totH = homeGoals + i, totA = awayGoals + j;
      if (totH > totA) pH += p;
      else if (totH === totA) pD += p;
      else pA += p;
    }
  }
  const sum = pH + pD + pA;
  return { pH: pH / sum, pD: pD / sum, pA: pA / sum };
}

function parseMinute(clockStr) {
  const m = String(clockStr || "").match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 45;
}

function runMonteCarlo() {
  if (_standings.length < 20 || !_schedule.length) return null;
  const ratings   = buildRatings();
  const remaining = _schedule.filter(g => g.state === "pre");
  if (!remaining.length) {
    const sorted = _standings.slice().sort((a, b) => (b.points || 0) - (a.points || 0) || ((b.gf || 0) - (b.ga || 0)) - ((a.gf || 0) - (a.ga || 0)));
    const g4Set  = new Set(sorted.slice(0, 4).map(t => t.name));
    const sa6Set = new Set(sorted.slice(6, 12).map(t => t.name));
    const z4Set  = new Set(sorted.slice(16).map(t => t.name));
    return DATA.teams.map(name => ({ name, g4: g4Set.has(name) ? 100 : 0, sa6: sa6Set.has(name) ? 100 : 0, z4: z4Set.has(name) ? 100 : 0 }))
      .sort((a, b) => b.g4 - a.g4 || b.sa6 - a.sa6 || a.z4 - b.z4);
  }

  // Pre-compute lambdas per unique fixture (sample Poisson per sim for unbiased GD)
  const mpCache = {};
  remaining.forEach(g => {
    const key = `${g.homeTeam}|${g.awayTeam}`;
    if (!mpCache[key]) {
      const { lambdaH, lambdaA } = expectedGoals(g.homeTeam, g.awayTeam, ratings);
      mpCache[key]      = { lambdaH, lambdaA };
      _matchProbs[key]  = matchProb(lambdaH, lambdaA); // for game-hint display
    }
  });

  const counts = {};
  DATA.teams.forEach(t => { counts[t] = { g4: 0, sa6: 0, z4: 0 }; });

  for (let sim = 0; sim < 2000; sim++) {
    const pts = {}, gd = {};
    _standings.forEach(tm => {
      pts[tm.name] = tm.points || 0;
      gd[tm.name]  = (tm.gf || 0) - (tm.ga || 0);
    });
    DATA.teams.forEach(t => { if (pts[t] == null) pts[t] = 0; if (gd[t] == null) gd[t] = 0; });

    remaining.forEach(g => {
      const { lambdaH, lambdaA } = mpCache[`${g.homeTeam}|${g.awayTeam}`];
      const hg = samplePoisson(lambdaH), ag = samplePoisson(lambdaA);
      if (hg > ag) {
        pts[g.homeTeam] = (pts[g.homeTeam] || 0) + 3;
      } else if (hg === ag) {
        pts[g.homeTeam] = (pts[g.homeTeam] || 0) + 1;
        pts[g.awayTeam] = (pts[g.awayTeam] || 0) + 1;
      } else {
        pts[g.awayTeam] = (pts[g.awayTeam] || 0) + 3;
      }
      gd[g.homeTeam] = (gd[g.homeTeam] || 0) + hg - ag;
      gd[g.awayTeam] = (gd[g.awayTeam] || 0) + ag - hg;
    });

    const sorted = DATA.teams.slice().sort((a, b) =>
      ((pts[b] || 0) - (pts[a] || 0)) || ((gd[b] || 0) - (gd[a] || 0)) || (Math.random() - 0.5)
    );
    sorted.slice(0, 4).forEach(t  => { if (counts[t]) counts[t].g4++;  });
    sorted.slice(6, 12).forEach(t => { if (counts[t]) counts[t].sa6++; });
    sorted.slice(16).forEach(t    => { if (counts[t]) counts[t].z4++;  });
  }

  return DATA.teams.map(t => ({
    name: t,
    g4:  Math.round((counts[t]?.g4  || 0) / 20),
    sa6: Math.round((counts[t]?.sa6 || 0) / 20),
    z4:  Math.round((counts[t]?.z4  || 0) / 20),
  })).sort((a, b) => b.g4 - a.g4 || b.sa6 - a.sa6 || a.z4 - b.z4);
}

function scheduleMC() {
  if (Date.now() - _mcTs < 5 * 60 * 1000) return; // at most every 5 min
  _mcTs = Date.now(); // mark immediately to prevent duplicate enqueue
  setTimeout(() => {
    _mcResult = runMonteCarlo();
    _mcTs     = Date.now();
    renderProbSection();
  }, 50);
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
    const sec    = elapsed(m.clockSec);
    const clock  = sec !== null ? formatClock(sec) : m.clockStr;
    // In-play probability bars (only when standings are loaded)
    let probBarsHtml = "";
    if (_standings.length >= 20) {
      const ratings = buildRatings();
      const { lambdaH, lambdaA } = expectedGoals(m.homeTeam, m.awayTeam, ratings);
      const minute = sec !== null ? Math.floor(sec / 60) : parseMinute(m.clockStr);
      const { pH, pD, pA } = inPlayProb(lambdaH, lambdaA, minute, m.homeScore, m.awayScore);
      const homeLbl = esc(m.homeTeam.split(" ")[0]);
      const awayLbl = esc(m.awayTeam.split(" ")[0]);
      probBarsHtml = `<div class="prob-bars" role="group" aria-label="Probabilidades da partida">
        <div class="prob-bar home" style="width:${(pH*100).toFixed(0)}%">${homeLbl} ${(pH*100).toFixed(0)}%</div>
        <div class="prob-bar draw"  style="width:${(pD*100).toFixed(0)}%">Emp ${(pD*100).toFixed(0)}%</div>
        <div class="prob-bar away"  style="width:${(pA*100).toFixed(0)}%">${awayLbl} ${(pA*100).toFixed(0)}%</div>
      </div>`;
    }
    return `<div class="live-match">
      <span class="live-badge">${esc(t("liveNow"))}</span>
      <div class="live-teams">
        <span class="live-team-name">${esc(m.homeTeam)}</span>
        <span class="live-score">${m.homeScore} – ${m.awayScore}</span>
        <span class="live-team-name">${esc(m.awayTeam)}</span>
      </div>
      <span class="live-clock">${esc(clock)}</span>
      ${probBarsHtml}
    </div>`;
  }).join("");
  card.classList.remove("hidden");
}

// ─── Render: next game card ──────────────────────────────────────────────────
function renderNextGameCard() {
  const card = $("nextGameCard");
  if (!card || !_schedule.length) { card?.classList.add("hidden"); return; }

  const todayKey   = brtDateKey(new Date().toISOString());
  const todayGames = _schedule.filter(g => brtDateKey(g.dateISO) === todayKey);

  if (todayGames.length) {
    const items = todayGames.map(g => {
      const lm = _liveMatches.find(l => l.homeTeam === g.homeTeam && l.awayTeam === g.awayTeam);
      if (lm) {
        const secElap = lm.clockSec !== null ? Math.floor(lm.clockSec + (Date.now() - _pollTime) / 1000) : null;
        const clock   = secElap !== null ? formatClock(secElap) : lm.clockStr;
        return `<div class="today-game today-game-live">
          <span class="live-badge">${esc(t("liveNow"))}</span>
          <div class="today-game-teams">${esc(g.homeTeam)} <b class="today-score">${lm.homeScore} – ${lm.awayScore}</b> ${esc(g.awayTeam)}</div>
          <span class="today-game-time muted">${esc(clock)}</span>
        </div>`;
      } else if (g.state === "post") {
        return `<div class="today-game today-game-post">
          <div class="today-game-teams muted">${esc(g.homeTeam)} <span>${g.homeScore ?? 0} – ${g.awayScore ?? 0}</span> ${esc(g.awayTeam)}</div>
          <span class="today-game-time muted">${esc(t("gameFinal"))}</span>
        </div>`;
      } else {
        const timeStr = brtTimeStr(g.dateISO);
        const now     = Date.now();
        const diffMs  = new Date(g.dateISO).getTime() - now;
        let countdown = "";
        if (diffMs > 0 && diffMs < 3600000) {
          const m = Math.floor(diffMs / 60000), s = Math.floor((diffMs % 60000) / 1000);
          countdown = ` · ${m}m ${String(s).padStart(2, "0")}s`;
        }
        const mpKey = `${g.homeTeam}|${g.awayTeam}`;
        if (!_matchProbs[mpKey] && _standings.length >= 20) {
          const r = buildRatings();
          const { lambdaH, lambdaA } = expectedGoals(g.homeTeam, g.awayTeam, r);
          _matchProbs[mpKey] = matchProb(lambdaH, lambdaA);
        }
        const mp = _matchProbs[mpKey];
        const heroBars = mp ? (() => {
          const hPct = Math.round(mp.pH * 100), dPct = Math.round(mp.pD * 100), aPct = Math.round(mp.pA * 100);
          const hLogo = _teamLogos[g.homeTeam] ? `<img src="${esc(_teamLogos[g.homeTeam])}" width="14" height="14" alt="" aria-hidden="true" class="team-logo">` : "";
          const aLogo = _teamLogos[g.awayTeam] ? `<img src="${esc(_teamLogos[g.awayTeam])}" width="14" height="14" alt="" aria-hidden="true" class="team-logo">` : "";
          const hLbl = esc(g.homeTeam.length > 12 ? g.homeTeam.slice(0, 12) + "…" : g.homeTeam);
          const aLbl = esc(g.awayTeam.length > 12 ? g.awayTeam.slice(0, 12) + "…" : g.awayTeam);
          const bl = (pct, name, logo) => pct >= 14 ? `${name} ${logo} ${pct}%` : (pct >= 7 ? `${logo} ${pct}%` : `${pct}%`);
          return `<div class="prob-bars" role="group" aria-label="Probabilidades da partida">
            <div class="prob-bar home" style="width:${hPct}%">${bl(hPct, hLbl, hLogo)}</div>
            <div class="prob-bar draw"  style="width:${dPct}%">Emp ${dPct}%</div>
            <div class="prob-bar away"  style="width:${aPct}%">${bl(aPct, aLbl, aLogo)}</div>
          </div>`;
        })() : "";
        return `<div class="today-game">
          <div class="today-game-teams">${esc(g.homeTeam)} <span class="next-game-vs">×</span> ${esc(g.awayTeam)}</div>
          <span class="today-game-time muted">${esc(timeStr)} BRT${esc(countdown)}</span>
          ${heroBars}
        </div>`;
      }
    }).join("");

    card.innerHTML = `<div class="next-game-card">
      <div class="today-games-header">${esc(t("todayGamesLabel"))}</div>
      ${items}
    </div>`;
    card.classList.remove("hidden");
    return;
  }

  // No games today — show next upcoming game
  const now  = Date.now();
  const next = _schedule.find(g => g.state === "pre" && new Date(g.dateISO).getTime() > now - 30 * 60 * 1000);
  if (!next) { card.classList.add("hidden"); return; }

  const timeStr = brtLongDate(next.dateISO) + " BRT";
  const diffMs  = new Date(next.dateISO).getTime() - now;
  let countdown = "";
  if (diffMs > 0) {
    const totalSec = Math.floor(diffMs / 1000);
    const d  = Math.floor(totalSec / 86400);
    const h  = Math.floor((totalSec % 86400) / 3600);
    const m  = Math.floor((totalSec % 3600) / 60);
    const s  = totalSec % 60;
    const p2 = n => String(n).padStart(2, "0");
    countdown = d > 0 ? `${d}d ${p2(h)}h ${p2(m)}m` : `${p2(h)}h ${p2(m)}m ${p2(s)}s`;
  }

  const mpKeyNext = `${next.homeTeam}|${next.awayTeam}`;
  if (!_matchProbs[mpKeyNext] && _standings.length >= 20) {
    const r = buildRatings();
    const { lambdaH, lambdaA } = expectedGoals(next.homeTeam, next.awayTeam, r);
    _matchProbs[mpKeyNext] = matchProb(lambdaH, lambdaA);
  }
  const mpNext = _matchProbs[mpKeyNext];
  const nextBars = mpNext ? (() => {
    const hPct = Math.round(mpNext.pH * 100), dPct = Math.round(mpNext.pD * 100), aPct = Math.round(mpNext.pA * 100);
    const hLogo = _teamLogos[next.homeTeam] ? `<img src="${esc(_teamLogos[next.homeTeam])}" width="14" height="14" alt="" aria-hidden="true" class="team-logo">` : "";
    const aLogo = _teamLogos[next.awayTeam] ? `<img src="${esc(_teamLogos[next.awayTeam])}" width="14" height="14" alt="" aria-hidden="true" class="team-logo">` : "";
    const hLbl = esc(next.homeTeam.length > 12 ? next.homeTeam.slice(0, 12) + "…" : next.homeTeam);
    const aLbl = esc(next.awayTeam.length > 12 ? next.awayTeam.slice(0, 12) + "…" : next.awayTeam);
    const bl = (pct, name, logo) => pct >= 14 ? `${name} ${logo} ${pct}%` : (pct >= 7 ? `${logo} ${pct}%` : `${pct}%`);
    return `<div class="prob-bars" role="group" aria-label="Probabilidades">
      <div class="prob-bar home" style="width:${hPct}%">${bl(hPct, hLbl, hLogo)}</div>
      <div class="prob-bar draw"  style="width:${dPct}%">Emp ${dPct}%</div>
      <div class="prob-bar away"  style="width:${aPct}%">${bl(aPct, aLbl, aLogo)}</div>
    </div>`;
  })() : "";
  card.innerHTML = `<div class="next-game-card">
    <div class="next-game-label">${esc(t("nextGameLabel"))}</div>
    <div class="next-game-teams">${esc(next.homeTeam)} <span class="next-game-vs">×</span> ${esc(next.awayTeam)}</div>
    ${nextBars}
    <div class="next-game-info">${esc(timeStr)}${countdown ? ` · ${esc(countdown)}` : ""}</div>
    ${next.venue ? `<div class="next-game-venue">${esc(next.venue)}${next.city ? `, ${esc(next.city)}` : ""}</div>` : ""}
  </div>`;
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
    const pos       = i + 1;
    const zoneClass = pos <= 4 ? "g4-zone" : (pos >= 7 && pos <= 12) ? "sa6-zone" : pos >= 17 ? "z4-zone" : "";
    const badge     = pos <= 4
      ? `<span class="zone-badge g4-badge">G4</span>`
      : (pos >= 7 && pos <= 12)
        ? `<span class="zone-badge sa6-badge">${esc(t("standingsZoneSA"))}</span>`
        : pos >= 17
          ? `<span class="zone-badge z4-badge">Z4</span>`
          : "";
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

// ─── Render: games section ───────────────────────────────────────────────────
function renderGamesSection() {
  const box = $("gamesList");
  if (!box) return;
  if (!_schedule.length) {
    box.innerHTML = `<p class="muted">${esc(t("gamesLoading"))}</p>`;
    return;
  }

  // Group games by BRT calendar date (YYYY-MM-DD key)
  const byDate = {};
  _schedule.forEach(g => {
    const key = brtDateKey(g.dateISO);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(g);
  });

  const dateKeys = Object.keys(byDate).sort();
  let html = "";
  const hasRatings = _standings.length >= 20;
  const gRatings   = hasRatings ? buildRatings() : null;
  // Map dateISO → 1-based sequential game number in the season
  const gameNum = new Map(_schedule.map((g, i) => [g.id, i + 1]));

  dateKeys.forEach(key => {
    // Use the first game of the date to derive a display label via proper timezone
    const refISO    = byDate[key][0].dateISO;
    const dateLabel = new Date(refISO).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit"
    });
    html += `<div class="game-date-header">${esc(dateLabel)}</div>`;

    byDate[key].forEach(g => {
      const timeStr = brtTimeStr(g.dateISO);

      let scoreOrTime, statusHtml;
      if (g.state === "in") {
        scoreOrTime = `<span class="game-score-live">${g.homeScore ?? 0} – ${g.awayScore ?? 0}</span>`;
        statusHtml  = `<span class="game-status live">${esc(t("gameLive"))}${g.clockStr ? " · " + esc(g.clockStr) : ""}</span>`;
      } else if (g.state === "post") {
        scoreOrTime = `<span class="game-score-final">${g.homeScore ?? 0} – ${g.awayScore ?? 0}</span>`;
        statusHtml  = `<span class="game-status post">${esc(t("gameFinal"))}</span>`;
      } else {
        scoreOrTime = `<span class="game-time">${esc(timeStr)}</span>`;
        statusHtml  = `<span class="game-status pre">${esc(timeStr)} BRT</span>`;
      }

      let probBarsHtml = "";
      if (g.state === "pre" && hasRatings) {
        const mpKey = `${g.homeTeam}|${g.awayTeam}`;
        if (!_matchProbs[mpKey]) {
          const { lambdaH, lambdaA } = expectedGoals(g.homeTeam, g.awayTeam, gRatings);
          _matchProbs[mpKey] = matchProb(lambdaH, lambdaA);
        }
        const { pH, pD, pA } = _matchProbs[mpKey];
        const hPct = Math.round(pH * 100), dPct = Math.round(pD * 100), aPct = Math.round(pA * 100);
        const hLogo = _teamLogos[g.homeTeam] ? `<img src="${esc(_teamLogos[g.homeTeam])}" width="14" height="14" alt="" aria-hidden="true" class="team-logo">` : "";
        const aLogo = _teamLogos[g.awayTeam] ? `<img src="${esc(_teamLogos[g.awayTeam])}" width="14" height="14" alt="" aria-hidden="true" class="team-logo">` : "";
        const hLabel = esc(g.homeTeam.length > 12 ? g.homeTeam.slice(0, 12) + "…" : g.homeTeam);
        const aLabel = esc(g.awayTeam.length > 12 ? g.awayTeam.slice(0, 12) + "…" : g.awayTeam);
        // Narrow bars: drop the name when < 14% to avoid overflow
        const barLabel = (pct, name, logo) => pct >= 14 ? `${name} ${logo} ${pct}%` : (pct >= 7 ? `${logo} ${pct}%` : `${pct}%`);
        probBarsHtml = `<div class="prob-bars" role="group" aria-label="Probabilidades da partida">
          <div class="prob-bar home" style="width:${hPct}%" title="${esc(g.homeTeam)}: ${hPct}%">${barLabel(hPct, hLabel, hLogo)}</div>
          <div class="prob-bar draw"  style="width:${dPct}%" title="Emp: ${dPct}%">Emp ${dPct}%</div>
          <div class="prob-bar away"  style="width:${aPct}%" title="${esc(g.awayTeam)}: ${aPct}%">${barLabel(aPct, aLabel, aLogo)}</div>
        </div>`;
      }
      const homeLogo = _teamLogos[g.homeTeam] ? `<img src="${esc(_teamLogos[g.homeTeam])}" class="match-logo" alt="" aria-hidden="true">` : "";
      const awayLogo = _teamLogos[g.awayTeam] ? `<img src="${esc(_teamLogos[g.awayTeam])}" class="match-logo" alt="" aria-hidden="true">` : "";
      const partida  = gameNum.has(g.id) ? `<span class="game-number">Partida ${gameNum.get(g.id)}</span>` : "";
      const venueStr = g.venue ? `${esc(g.venue)}${g.city ? `, ${esc(g.city)}` : ""}` : "";
      const metaParts = [statusHtml, partida, venueStr].filter(Boolean);
      html += `<div class="game-card ${esc(g.state || "pre")}">
        <div class="game-matchup">
          <span class="match-team-name home-name">${esc(g.homeTeam)}</span>
          ${homeLogo}
          <div class="match-center">${scoreOrTime}</div>
          ${awayLogo}
          <span class="match-team-name away-name">${esc(g.awayTeam)}</span>
        </div>
        <div class="game-meta">${metaParts.join('<span class="game-meta-sep"> · </span>')}</div>
        ${probBarsHtml}
      </div>`;
    });
  });

  box.innerHTML = html;
}

// ─── Tiebreaker helpers ──────────────────────────────────────────────────────
function countSA6Hits(detail) {
  return (detail?.sa6 || []).filter(d => d?.type === "hit").length;
}
function countG4Exact(entry, g4Result) {
  return (entry.picks?.g4 || []).filter((pick, i) => pick && g4Result?.[i] === pick).length;
}
function countZ4Exact(entry, z4Result) {
  return (entry.picks?.z4 || []).filter((pick, i) => pick && z4Result?.[i] === pick).length;
}

// ─── Render: ranking ─────────────────────────────────────────────────────────
function renderRanking() {
  const box = $("rankingList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));

  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }

  // Tiebreaker reference arrays: when results are officially locked, use locked
  // values to ensure tiebreakers match the final score calculation exactly.
  const locked = s.results?.locked;
  const g4cur  = locked ? (s.results?.g4  || []) : (_standings.length >= 4  ? _standings.slice(0,  4).map(tm => tm.name) : []);
  const z4cur  = locked ? (s.results?.z4  || []) : (_standings.length >= 20 ? _standings.slice(16, 20).map(tm => tm.name) : []);

  const scored = entries.map(e => {
    const sc = getActiveScore(e, s) || { total: 0, detail: null, isOfficial: false };
    return { e, ...sc };
  }).sort((a, b) =>
    b.total - a.total ||
    countSA6Hits(b.detail) - countSA6Hits(a.detail) ||
    countG4Exact(b.e, g4cur) - countG4Exact(a.e, g4cur) ||
    countZ4Exact(b.e, z4cur) - countZ4Exact(a.e, z4cur) ||
    b.e.entryName.localeCompare(a.e.entryName, "pt-BR")
  );

  const hasAnyProvisional = scored.some(x => !x.isOfficial && _standings.length >= 20);
  const provNote = hasAnyProvisional
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
  const p          = entry.picks || {};
  const g4         = p.g4  || [];
  const sa6        = p.sa6 || [];
  const z4         = p.z4  || [];
  const g4Labels   = ["pos1","pos2","pos3","pos4"].map(t);
  const z4Labels   = ["pos17","pos18","pos19","pos20"].map(t);

  const mkCell = (team, d) => {
    if (!team) return `<div class="pick-cell pick-empty">—</div>`;
    const cls   = d ? (d.type === "exact" ? "pick-exact" : d.type === "group" ? "pick-group" : d.type === "hit" ? "pick-exact" : "pick-miss") : "";
    const badge = d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : "";
    return `<div class="pick-cell ${cls}">${esc(team)}${badge}</div>`;
  };

  const g4html = g4.map((team, i) => `
    <div class="pick-item">
      <span class="pick-pos-lbl">${esc(g4Labels[i])}</span>
      ${mkCell(team, detail?.g4?.[i])}
    </div>`).join("");

  const sa6html = sa6.map((team, i) => `
    <div class="pick-item">
      <span class="pick-pos-lbl">SA ${i + 1}</span>
      ${mkCell(team, detail?.sa6?.[i])}
    </div>`).join("");

  const z4html = z4.map((team, i) => `
    <div class="pick-item">
      <span class="pick-pos-lbl">${esc(z4Labels[i])}</span>
      ${mkCell(team, detail?.z4?.[i])}
    </div>`).join("");

  const hasSA6 = sa6.some(Boolean);
  const gridClass = hasSA6 ? "picks-display three-col" : "picks-display";

  return `<div class="${gridClass}">
    <div class="picks-col"><div class="picks-col-header g4-header-sm">🏆 G4</div>${g4html}</div>
    ${hasSA6 ? `<div class="picks-col"><div class="picks-col-header sa6-header-sm">🟡 Sul-Am.</div>${sa6html}</div>` : ""}
    <div class="picks-col"><div class="picks-col-header z4-header-sm">⬇️ Z4</div>${z4html}</div>
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
    const link       = C.paymentLinks?.[method];
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
  const cutoff = cutoffDate().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit"
  });
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
          <tr style="background:rgba(245,158,11,.07)"><td>🟡 Sul-Americana (7º–12º) — acerto</td><td><b>8</b></td></tr>
          <tr style="background:rgba(245,158,11,.07)"><td>🟡 Sul-Americana — erro</td><td>0</td></tr>
          <tr class="z4-zone"><td>17º–20º Z4 (${esc(t("rulesExact"))})</td><td><b>12</b></td></tr>
          <tr class="z4-zone"><td>17º–20º Z4 (${esc(t("rulesInZ4"))})</td><td>8</td></tr>
        </tbody>
      </table>
      <p>${esc(t("rulesMaxPoints"))}: <b>176 pts</b> (G4: 80 + Sul-Am.: 48 + Z4: 48)</p>
      <p>${esc(t("rulesPrizes"))}: 1º 70% · 2º 20% · 3º 10%</p>
      <p>${esc(t("rulesCutoff"))}: <b>${cutoff} (Brasília)</b></p>
      <h3>${esc(t("tbTitle"))}</h3>
      <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--muted);line-height:2">
        <li>Maior pontuação total</li>
        <li>${esc(t("tbSA6"))}</li>
        <li>${esc(t("tbG4"))}</li>
        <li>${esc(t("tbZ4"))}</li>
      </ol>
      <p class="muted small-text" style="margin-top:12px">${esc(C.transparency.disclaimer)}</p>
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
  const box     = $("adminPayments");
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
      s2.paid  = s2.paid || {};
      if (s2.paid[btn.dataset.togglePaid]) delete s2.paid[btn.dataset.togglePaid];
      else s2.paid[btn.dataset.togglePaid] = true;
      saveState(s2);
    })
  );
}

function renderAdminResults(s) {
  const box    = $("adminResults");
  if (!box) return;
  const r      = s.results;
  const locked = r?.locked;
  const opts   = DATA.teams.sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(team => `<option value="${esc(team)}">${esc(team)}</option>`).join("");
  const sel = id =>
    `<select id="${id}" ${locked ? "disabled" : ""}><option value="">—</option>${opts}</select>`;

  const g4rows = [0,1,2,3].map(i => `
    <div class="admin-row">
      <label for="adm-g4-${i}">${esc([t("pos1"),t("pos2"),t("pos3"),t("pos4")][i])}</label>
      ${sel(`adm-g4-${i}`)}
    </div>`).join("");

  const sa6rows = [0,1,2,3,4,5].map(i => `
    <div class="admin-row">
      <label for="adm-sa-${i}">Sul-Am. ${i + 1}</label>
      ${sel(`adm-sa-${i}`)}
    </div>`).join("");

  const z4rows = [0,1,2,3].map(i => `
    <div class="admin-row">
      <label for="adm-z4-${i}">${esc([t("pos17"),t("pos18"),t("pos19"),t("pos20")][i])}</label>
      ${sel(`adm-z4-${i}`)}
    </div>`).join("");

  box.innerHTML = `
    <h3>${esc(t("adminResults"))}</h3>
    ${locked ? `<p class="paid-badge">${esc(t("resultsLocked"))}</p>` : ""}
    <div class="admin-results-grid three-col">
      <div><h4>🏆 G4</h4>${g4rows}</div>
      <div><h4>🟡 Sul-Am.</h4>${sa6rows}</div>
      <div><h4>⬇️ Z4</h4>${z4rows}</div>
    </div>
    <div class="button-row" style="margin-top:14px;gap:8px">
      ${!locked ? `<button type="button" id="espnFillResultsBtn" class="secondary small-btn">${esc(t("espnFillResultsBtn"))}</button>` : ""}
      ${!locked ? `<button type="button" id="saveResultsBtn">${esc(t("saveResults"))}</button>` : ""}
      ${locked  ? `<button type="button" id="unlockResultsBtn" class="secondary">${esc(t("unlockResults"))}</button>` : ""}
    </div>`;

  // Populate existing values after innerHTML replacement
  if (r?.g4)  r.g4.forEach((v, i)  => { const el = $(`adm-g4-${i}`);  if (el && v) el.value = v; });
  if (r?.sa6) r.sa6.forEach((v, i) => { const el = $(`adm-sa-${i}`);  if (el && v) el.value = v; });
  if (r?.z4)  r.z4.forEach((v, i)  => { const el = $(`adm-z4-${i}`);  if (el && v) el.value = v; });

  $("espnFillResultsBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    const standings = await fetchStandings();
    if (!standings || standings.length < 20) { alert("ESPN fetch failed — try again."); return; }
    const g4  = standings.slice(0,  4).map(tm => tm.name);
    const sa6 = standings.slice(6, 12).map(tm => tm.name);
    const z4  = standings.slice(16, 20).map(tm => tm.name);
    g4.forEach( (v, i) => { const el = $(`adm-g4-${i}`);  if (el) el.value = v; });
    sa6.forEach((v, i) => { const el = $(`adm-sa-${i}`);  if (el) el.value = v; });
    z4.forEach( (v, i) => { const el = $(`adm-z4-${i}`);  if (el) el.value = v; });
    alert(`G4: ${g4.join(", ")}\nSul-Am.: ${sa6.join(", ")}\nZ4: ${z4.join(", ")}`);
  });

  $("saveResultsBtn")?.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const g4  = [0,1,2,3].map(i => $(`adm-g4-${i}`)?.value || "");
    const sa6 = [0,1,2,3,4,5].map(i => $(`adm-sa-${i}`)?.value || "");
    const z4  = [0,1,2,3].map(i => $(`adm-z4-${i}`)?.value || "");
    if (g4.some(v => !v) || sa6.some(v => !v) || z4.some(v => !v)) {
      alert(t("errorResultsIncomplete")); return;
    }
    const overlap    = g4.filter(v => z4.includes(v));
    if (overlap.length) { alert(t("errorG4Z4Overlap").replace("{teams}", overlap.join(", "))); return; }
    const sa6g4 = sa6.filter(v => v && g4.includes(v));
    const sa6z4 = sa6.filter(v => v && z4.includes(v));
    if (sa6g4.length || sa6z4.length) {
      alert(t("errorSA6Overlap").replace("{teams}", [...sa6g4, ...sa6z4].join(", "))); return;
    }
    if (!confirm(t("confirmLockResults"))) return;
    const s2 = state();
    s2.results = { locked: true, g4, sa6, z4, lockedAt: new Date().toISOString() };
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
  const box     = $("adminEntries");
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
      $("entryName").value          = entry.entryName          || "";
      $("payerName").value          = entry.payerName          || "";
      $("participantEmail").value   = entry.participantEmail   || "";
      $("paymentMethod").value      = entry.paymentMethod      || "";
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
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  const header  = ["Entrada","Pagador","Email","Método","Pago",
    "G4-1","G4-2","G4-3","G4-4",
    "SA6-1","SA6-2","SA6-3","SA6-4","SA6-5","SA6-6",
    "Z4-17","Z4-18","Z4-19","Z4-20","Pontos"].join(",");
  const rows = entries.map(e => {
    const picks = [
      ...(e.picks?.g4  || []),
      ...(e.picks?.sa6 || []),
      ...(e.picks?.z4  || []),
    ];
    const sc = getActiveScore(e, s);
    return [e.entryName, e.payerName || "", e.participantEmail || "", e.paymentMethod || "",
      (s.paid || {})[e.id] ? "Sim" : "Não", ...picks, sc?.total ?? 0]
      .map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(",");
  });
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `bolao-br2026-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── Email receipt ───────────────────────────────────────────────────────────
async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  const lastSent = Number(sessionStorage.getItem("br2026_emailTs") || 0);
  if (Date.now() - lastSent < C.emailjs.limitRateMs) return;
  const g4   = entry.picks?.g4  || [];
  const sa6  = entry.picks?.sa6 || [];
  const z4   = entry.picks?.z4  || [];
  const g4rows  = g4.map((team, i)  => `<tr><td style="padding:4px 8px">${[t("pos1"),t("pos2"),t("pos3"),t("pos4")][i]}</td><td style="padding:4px 8px"><b>${esc(team || "—")}</b></td></tr>`).join("");
  const sa6rows = sa6.map((team, i) => `<tr><td style="padding:4px 8px">Sul-Am. ${i+1}</td><td style="padding:4px 8px"><b>${esc(team || "—")}</b></td></tr>`).join("");
  const z4rows  = z4.map((team, i)  => `<tr><td style="padding:4px 8px">${[t("pos17"),t("pos18"),t("pos19"),t("pos20")][i]}</td><td style="padding:4px 8px"><b>${esc(team || "—")}</b></td></tr>`).join("");
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
    <h3 style="color:#f59e0b;margin-top:14px">🟡 Sul-Americana</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#0d2028;border-radius:8px"><tbody>${sa6rows}</tbody></table>
    <h3 style="color:#f87171;margin-top:14px">⬇️ Z4 — Rebaixamento</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#0d2028;border-radius:8px"><tbody>${z4rows}</tbody></table>
    <p style="margin-top:16px;font-size:11px;opacity:.6">Bolão informal entre amigos. ${new Date().toLocaleString("pt-BR")}</p>
  </div>
</div>`;
  try {
    await window.emailjs.send(C.emailjs.serviceId, C.emailjs.participantTemplateId, {
      to_email:     entry.participantEmail,
      entry_name:   `Brasileirão 2026 — ${entry.entryName}`,
      receipt_code: `BR2026-${(entry.id || "").slice(0, 8).toUpperCase()}`,
      html_message: html,
    }, { publicKey: C.emailjs.publicKey });
    sessionStorage.setItem("br2026_emailTs", String(Date.now()));
  } catch (err) {
    console.error("[BR2026] sendReceipt failed:", err);
  }
}

// ─── Countdown ───────────────────────────────────────────────────────────────
function renderCountdown() {
  const el = $("cutoffCountdown");
  if (!el) return;
  const diff = cutoffDate() - Date.now();
  if (diff <= 0) { el.innerHTML = `<strong>${esc(t("closedLabel"))}</strong>`; return; }
  const p2       = n => String(n).padStart(2, "0");
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
  const s  = state();
  const ts = s.meta?.updatedAt
    ? new Date(s.meta.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  el.textContent = ts ? `${C.siteVersion} · sync ${ts} BRT` : C.siteVersion;
}

// ─── Render: probabilidades (Monte Carlo) ────────────────────────────────────
function renderProbSection() {
  const box = $("probsContent");
  if (!box) return;

  if (_standings.length < 20) {
    box.innerHTML = `<p class="muted">${esc(t("probsNoData"))}</p>`;
    return;
  }

  if (!_mcResult) {
    box.innerHTML = `<p class="muted">${esc(t("probsLoading"))}</p>
<div style="margin-top:10px">
  <button type="button" id="mcRefreshBtn" class="secondary small-btn">${esc(t("probsRefresh"))}</button>
</div>`;
    $("mcRefreshBtn")?.addEventListener("click", () => { _mcTs = 0; _mcResult = null; renderProbSection(); scheduleMC(); });
    scheduleMC();
    return;
  }

  const lastRun = _mcTs
    ? new Date(_mcTs).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    : "—";

  const rows = _mcResult.map(row => `
    <tr>
      <td>${esc(row.name)}</td>
      <td>
        <div class="prob-cell">
          <span class="prob-pct g4">${row.g4}%</span>
          <div class="prob-bar-mini g4" style="width:${row.g4}%" aria-hidden="true"></div>
        </div>
      </td>
      <td>
        <div class="prob-cell">
          <span class="prob-pct sa6">${row.sa6}%</span>
          <div class="prob-bar-mini sa6" style="width:${row.sa6}%" aria-hidden="true"></div>
        </div>
      </td>
      <td>
        <div class="prob-cell">
          <span class="prob-pct z4">${row.z4}%</span>
          <div class="prob-bar-mini z4" style="width:${row.z4}%" aria-hidden="true"></div>
        </div>
      </td>
    </tr>`).join("");

  box.innerHTML = `
    <table class="prob-table">
      <thead>
        <tr>
          <th scope="col">${esc(t("team"))}</th>
          <th scope="col">${esc(t("probsG4"))}</th>
          <th scope="col">${esc(t("probsSA"))}</th>
          <th scope="col">${esc(t("probsZ4"))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap">
      <button type="button" id="mcRefreshBtn" class="secondary small-btn">${esc(t("probsRefresh"))}</button>
      <span class="muted" style="font-size:11px">${esc(t("probsLastRun"))} ${esc(lastRun)} BRT</span>
    </div>
    <p class="prob-disclaimer">${esc(t("probsDisclaimer"))}</p>`;

  $("mcRefreshBtn")?.addEventListener("click", () => {
    _mcTs     = 0;    // force re-run regardless of debounce
    _mcResult = null;
    box.innerHTML = `<p class="muted">${esc(t("probsLoading"))}</p>`;
    setTimeout(() => {
      _mcResult = runMonteCarlo();
      _mcTs     = Date.now();
      renderProbSection();
    }, 50);
  });
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
  if (_schedule.length) { renderGamesSection(); renderNextGameCard(); }
  if (isAdminActive()) renderAdmin();
  renderProbSection();
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

  // Countdown — 1s tick
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
    const pw   = $("adminPassword")?.value || "";
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

  // Load remote state then render
  await loadRemoteState();
  renderAll();

  // ESPN: poll immediately, then every 60s
  pollAll();
  setInterval(pollAll, C.espn.pollIntervalMs);

  // 1s ticker for running clock + next game countdown (skip when tab is hidden)
  setInterval(() => { if (!document.hidden) { renderLiveCard(); renderNextGameCard(); } }, 1000);

  // Remote sync every 30s (when database enabled) — skip when form is being filled or tab is hidden
  if (C.database.enabled) {
    setInterval(async () => {
      if (document.hidden || _editingEntry) return;
      await loadRemoteState();
      renderAll();
    }, 30000);
  }

  // Full-season schedule — fetch in background, render when ready
  fetchSchedule().then(() => { renderGamesSection(); renderNextGameCard(); });
}

init();

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
      if (m && m[1] !== window.BR2026_CONFIG?.siteVersion) location.reload();
    } catch (e) {}
  }
  setInterval(checkVersion, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
}());
