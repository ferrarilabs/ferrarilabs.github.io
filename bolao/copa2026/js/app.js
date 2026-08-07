/* Bolão do Ferrari — v4.45 */
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

// The EmailJS template's Subject field interpolates entry_name/receipt_code with plain {{}}
// (HTML-escaped) rather than {{{}}} like the body -- "/" comes out as the literal "&#x2F;" in
// the subject header, which is plain text and never HTML-decodes it back (Eduardo, 2026-07-24,
// saw this on BR2026's round-email date ranges). Free-typed entry names can contain "/" too, so
// strip it here before anything is used to build an entry_name/subject value for EmailJS.
function emailSubjectSafe(s) {
  return String(s ?? "").replace(/\//g, "-");
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

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
  return { entries: [], deletedIds: [], paid: {}, results: {}, auditLog: [], meta: { updatedAt: null, version: CONFIG.siteVersion } };
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

function mergeStates(local, remote, opts = {}) {
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
  // preferRemoteResults: used by loadRemoteState so Supabase corrections propagate
  // immediately (overwrite stale local cache). Default: local wins (for admin saves).
  const mergedResults = opts.preferRemoteResults
    ? { ...(local.results || {}), ...(remote.results || {}) }
    : { ...(remote.results || {}), ...(local.results || {}) };
  for (const mid of resultTombstones) delete mergedResults[mid];

  // Merge audit logs: union by timestamp (unique per event), newest-first, cap 200.
  const auditMap = new Map();
  for (const entry of [...(remote.auditLog || []), ...(local.auditLog || [])]) {
    if (entry?.ts) auditMap.set(entry.ts, entry);
  }
  const mergedAuditLog = [...auditMap.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200);

  return {
    entries: Object.values(byId).sort((a, b) => (a.createdAt || "") > (b.createdAt || "") ? 1 : -1),
    deletedIds: [...tombstones],
    deletedResults: [...resultTombstones],
    paid: mergedPaid,
    results: mergedResults,
    auditLog: mergedAuditLog,
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
      // preferRemoteResults: Supabase results (admin-managed) always win over
      // stale local cache — ensures corrections from Python script propagate.
      const merged = mergeStates(local, data.state, { preferRemoteResults: true });
      saveLocalState(merged);
      return true;
    }
    await saveRemoteState(state());
    return true;
  } catch (err) { console.warn("Remote load failed", err); return false; }
}

// ─── TEST ISOLATION (P0, 2026-08-07) ────────────────────────────────────────
// Propagado do CDB2026 (ver o comentário longo em bolao/cdb2026/js/app.js e
// docs/bolao/TEST_ISOLATION.md). O incidente foi no CDB2026, mas a causa é idêntica nos três
// apps: url/anonKey/stateId de produção estão hardcoded em config.js, então qualquer harness que
// carregue esta app grava na tabela real. Aqui vale mais ainda: a Copa está ARQUIVADA e paga —
// o estado remoto dela não deveria mudar nunca mais.
// Override deliberado: sessionStorage.setItem("copa2026_allow_production_writes", "I UNDERSTAND")
// A origem CANÔNICA de produção é o domínio customizado do arquivo CNAME na raiz do repo
// (www.ferrarilabs.com) — NÃO ferrarilabs.github.io, que responde 301 para ele. Errar isto
// bloqueia a produção inteira em silêncio (foi o que aconteceu na primeira versão deste guard,
// pega na verificação ao vivo). O apex e o github.io estão na lista porque são hosts nossos: hoje
// os dois redirecionam, então nenhuma página executa neles, mas se o CNAME for removido a
// produção passa a servir do github.io e o guard não pode virar um bloqueio total.
// audit_test_isolation.mjs lê o CNAME e falha se ele não estiver nesta lista — a lista não pode
// mais divergir do domínio real sem a suíte acusar.
const PRODUCTION_ORIGINS = [
  "https://www.ferrarilabs.com",
  "https://ferrarilabs.com",
  "https://ferrarilabs.github.io",
];
const ALLOW_PROD_WRITES_KEY = "copa2026_allow_production_writes";
function productionWriteBlockReason() {
  if (typeof location !== "undefined" && !PRODUCTION_ORIGINS.includes(location.origin)) {
    return `origem não-produção (${location.origin})`;
  }
  if (typeof navigator !== "undefined" && navigator.webdriver) {
    return "navegador sob automação (navigator.webdriver)";
  }
  return null;
}
function productionWritesAllowed() {
  const reason = productionWriteBlockReason();
  if (!reason) return { allowed: true };
  let override = null;
  // sessionStorage pode lançar (modo restrito/file://) — tratar como ausente é o lado seguro.
  try { override = sessionStorage.getItem(ALLOW_PROD_WRITES_KEY); } catch { override = null; }
  if (override === "I UNDERSTAND") return { allowed: true, overridden: true, reason };
  return { allowed: false, reason };
}

async function saveRemoteState(s, opts = {}) {
  if (!initDb()) return false;
  // TEST ISOLATION: fail closed antes de qualquer escrita remota. O estado local já foi gravado
  // pelo chamador, então nada é perdido — só não vaza para a produção.
  const gate = productionWritesAllowed();
  if (!gate.allowed) {
    console.warn(`[COPA2026] TEST ISOLATION: gravação remota BLOQUEADA — ${gate.reason}. ` +
      `Estado salvo apenas localmente. Para liberar deliberadamente: ` +
      `sessionStorage.setItem("${ALLOW_PROD_WRITES_KEY}", "I UNDERSTAND")`);
    return false;
  }
  if (gate.overridden) {
    console.warn(`[COPA2026] TEST ISOLATION: override ATIVO — gravando na PRODUÇÃO a partir de ${gate.reason}`);
  }
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
  // #heroCard is permanently display:none (CSS) — deadline rendered in
  // #reopenBanner so it is always visible regardless of hero state.
  const box = document.getElementById("reopenBanner");
  if (!box) return;
  const diff = cutoffDate() - Date.now();
  if (diff <= 0) { box.classList.add("hidden"); return; }
  const s   = Math.floor(diff / 1000);
  const d   = Math.floor(s / 86400);
  const h   = Math.floor((s % 86400) / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p2  = n => String(n).padStart(2, "0");
  box.innerHTML = `<div class="reopen-inner" style="text-align:center">
    <div class="reopen-header">⏰ ${escapeHtml(CONFIG.cutoffLabel)}</div>
    <div class="count-grid" style="max-width:360px;margin:0 auto">
      <div><b>${d}</b><span>${escapeHtml(t("countdownDays"))}</span></div>
      <div><b>${p2(h)}</b><span>${escapeHtml(t("countdownHours"))}</span></div>
      <div><b>${p2(m)}</b><span>${escapeHtml(t("countdownMin"))}</span></div>
      <div><b>${p2(sec)}</b><span>${escapeHtml(t("countdownSec"))}</span></div>
    </div>
  </div>`;
  box.classList.remove("hidden");
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

// Eduardo: "Seria ideal botar o horário brt e est sendo est primeiro para não confundir o
// pessoal" (2026-07-17) — a Copa mostra os horários em ET (m.timeET, fonte oficial FIFA), mas o
// público é majoritariamente brasileiro. Deriva o BRT do mesmo epoch já usado pro countdown
// (parseMatchKickoff) em vez de fazer conta de fuso na mão — Brasil (America/Sao_Paulo) não tem
// horário de verão desde 2019, mas usar Intl aqui evita repetir esse tipo de suposição hardcoded.
function brtTimeFromKickoff(dateStr, timeET) {
  const ms = parseMatchKickoff(dateStr, timeET);
  if (ms === null) return "";
  return new Date(ms).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

// Knockout matches can run regulation (90) + stoppage (~10) + extra time (30)
// + a penalty shootout (no fixed length, historically up to ~20-30 min) —
// well past 135/150 min. A cutoff shorter than that made the UI treat a
// match still in extra time/penalties as "over" and silently jump to the
// next scheduled match instead of showing it as live (July 2026 bug).
const MATCH_ASSUMED_OVER_MS = 210 * 60 * 1000;

function nextScheduledMatch() {
  const results = state().results || {};
  const now = Date.now();
  for (const m of DATA.knockoutMatches) {
    if (results[m.match]?.advanceSide) continue;
    const kickoff = parseMatchKickoff(m.date, m.timeET);
    if (kickoff === null) continue;
    // ESPN confirming this exact fixture is postponed/delayed always wins
    // over the elapsed-time guess — never silently skip to the next match
    // just because a postponed one never actually kicked off.
    const hint = _matchStatusHints[m.match];
    if (hint?.postponed) return { m, kickoff, postponed: true, label: hint.label };
    // Skip only once we're well past any realistic match length with no live data.
    if (now - kickoff > MATCH_ASSUMED_OVER_MS) continue;
    return { m, kickoff };
  }
  return null;
}

function renderNextMatch() {
  const card = $("#nextMatchCard");
  if (!card) return;

  // Filter live scores: skip matches where result is already saved OR
  // kickoff was too long ago (game is over — ESPN just hasn't reported "post" yet).
  const savedResults = state().results || {};
  const nowMs = Date.now();
  const liveEntries = Object.entries(_liveScores).filter(([mid, ls]) => {
    if (savedResults[mid]?.advanceSide) return false;
    const km = DATA.knockoutMatches.find(x => String(x.match) === mid);
    if (km) {
      const ko = parseMatchKickoff(km.date, km.timeET);
      if (ko && nowMs - ko > MATCH_ASSUMED_OVER_MS) return false;
    }
    return true;
  });

  const hasLive = liveEntries.length > 0;
  const next    = nextScheduledMatch();

  if (hasLive) {
    const knockoutIds = new Set(DATA.knockoutMatches.map(km => String(km.match)));
    const { winners: liveWinners, losers: liveLosers } = officialWinnersMap(state());
    const items = liveEntries.map(([mid, ls]) => {
      const m = DATA.knockoutMatches.find(x => x.match === mid)
             || DATA.groupMatches?.find(x => x.match === mid);
      // m.teamA/teamB come straight from data.js, which never gets rewritten
      // with real names — for M95+ that's still "Winner Match 87" unless
      // resolved through official results, same gap as mapEspnToLiveScores.
      const tA = (m && resolveSlot(m.teamA, liveWinners, liveLosers)) || "A";
      const tB = (m && resolveSlot(m.teamB, liveWinners, liveLosers)) || "B";
      const pointsBlock = knockoutIds.has(String(mid))
        ? `<div class="hero-live-points picks-detail">${liveMatchPointsTable(mid, ls.goalsA, ls.goalsB)}</div>`
        : "";
      const probBlock = m ? liveProbBarsHtml(m, ls) : "";
      const scorersBlock = goalScorersHtml(ls, tA, tB);
      const playsBlock = livePlaysHtml(ls, tA, tB, mid);
      const livePhaseText = m ? escapeHtml(phaseLabel(m.phase || "Fase de grupos")) +
        (m.group ? ` — ${escapeHtml(t("groupLabel"))} ${escapeHtml(m.group)}` : "") : "";
      // Eduardo: "Não precisa mostrar a localização no live mode" (2026-07-17) — só a fase
      // (útil pra saber "que jogo é esse" durante o jogo) fica; o local (📍) some no modo ao
      // vivo. Continua aparecendo normalmente no card "Próximo jogo" pré-live.
      const liveMetaBlock = livePhaseText ? `<div class="hero-live-meta">
        <span>${livePhaseText}${m ? ` · M${escapeHtml(String(m.match))}` : ""}</span>
      </div>` : "";
      // A real break in play (halftime, penalties — no running clock exists
      // once regulation/extra time ends — or any other stoppage clockPaused
      // picked up from the clock's own behavior) isn't more elapsed play
      // time — don't let the interpolation below keep ticking through it.
      //
      // MAX_INTERPOLATION_MS caps how far this local interpolation can run ahead of the last
      // successful poll — 3x the 60s poll interval, generous slack for normal jitter. Without
      // this, if a single poll doesn't land right as the match hits halftime, `isHalftime` stays
      // stale (false) and this display just keeps adding real elapsed seconds forever with
      // nothing to stop it, even though the match is genuinely stopped. Confirmed live in
      // CDB2026 (2026-08-01, Vasco×Fluminense): clock showed "58:11 (+14)" and kept climbing
      // during the real halftime break. Propagated here as defense-in-depth alongside the
      // formatMatchClock() stoppage cap above.
      const clockElapsedMs = Math.min(Date.now() - (ls.pollTime || Date.now()), 3 * 60000);
      const runningClock = ls.isHalftime || ls.isPenalties || ls.clockPaused
        ? ls.clock
        : ls.clockSeconds !== null
          ? formatMatchClock(ls.clockSeconds + Math.floor(clockElapsedMs / 1000), ls.period ?? null, ls.pastBoundary || 0)
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
      ${liveMetaBlock}
      ${scorersBlock}
      ${playsBlock}
      ${probBlock}
      ${pointsBlock}
      </div>`;
    }).join("");
    const savedScroll = captureLivePlaysScroll(card);
    card.innerHTML = `<div class="next-match-live-grid">${items}</div>`;
    restoreLivePlaysScroll(card, savedScroll);
    card.classList.remove("hidden");
    return;
  }

  if (!next) { card.classList.add("hidden"); return; }

  const { m, kickoff, postponed, label } = next;

  // Resolve slot names ("Winner Match X") to actual team names from official results.
  const { winners, losers } = officialWinnersMap(state());
  const tA = resolveSlot(m.teamA, winners, losers);
  const tB = resolveSlot(m.teamB, winners, losers);
  const phaseText = escapeHtml(phaseLabel(m.phase || "Fase de grupos")) +
    (m.group ? ` — ${escapeHtml(t("groupLabel"))} ${escapeHtml(m.group)}` : "");

  if (postponed) {
    card.innerHTML = `
      <div class="next-match-row">
        <div class="next-match-info">
          <div class="hero-next-label">${escapeHtml(t("heroNextMatch"))}</div>
          <div class="next-match-teams">${escapeHtml(tA)} ${escapeHtml(flag(tA))} <span class="muted">×</span> ${escapeHtml(flag(tB))} ${escapeHtml(tB)}</div>
          <div class="hero-next-time">${phaseText} · M${escapeHtml(String(m.match))}</div>
          <div class="hero-next-time"><span class="hero-next-live">${escapeHtml(t("matchPostponed"))}</span>${label ? " — " + escapeHtml(label) : ""}</div>
          ${m.venue && m.venue !== "A confirmar" ? `<div class="hero-next-venue">📍 ${escapeHtml(m.venue)}${m.city ? `, ${escapeHtml(m.city)}` : ""}</div>` : ""}
        </div>
      </div>`;
    card.classList.remove("hidden");
    return;
  }

  const diff = kickoff - Date.now();
  let timerHtml;
  if (diff <= 0) {
    timerHtml = `<span class="hero-next-live">${escapeHtml(t("heroMatchStarted"))}</span>`;
  } else {
    const totalS = Math.floor(diff / 1000);
    const d   = Math.floor(totalS / 86400);
    const h   = Math.floor((totalS % 86400) / 3600);
    const min = Math.floor((totalS % 3600) / 60);
    const sec = totalS % 60;
    const p2  = n => String(n).padStart(2, "0");
    const cells = d > 0
      ? [[d, t("countdownDays")], [p2(h), t("countdownHours")], [p2(min), t("countdownMin")], [p2(sec), t("countdownSec")]]
      : [[p2(h), t("countdownHours")], [p2(min), t("countdownMin")], [p2(sec), t("countdownSec")]];
    // "four" class sets grid to 4 columns when days > 0; default timer is 3-col.
    timerHtml = `<div class="count-grid next-match-timer${d > 0 ? " four" : ""}">${
      cells.map(([v, l]) => `<div><b>${v}</b><span>${escapeHtml(l)}</span></div>`).join("")
    }</div>`;
  }

  const probBlock = preMatchProbBarsHtml(m);
  card.innerHTML = `
    <div class="next-match-row">
      <div class="next-match-info">
        <div class="hero-next-label">${escapeHtml(t("heroNextMatch"))}</div>
        <div class="next-match-teams">${escapeHtml(tA)} ${escapeHtml(flag(tA))} <span class="muted">×</span> ${escapeHtml(flag(tB))} ${escapeHtml(tB)}</div>
        <div class="hero-next-time">${phaseText}</div>
        <div class="hero-next-time">${m.date ? escapeHtml(formatDate(m.date)) + " · " : ""}${escapeHtml(m.timeET || "")}${m.timeET ? ` · ${escapeHtml(brtTimeFromKickoff(m.date, m.timeET))} BRT` : ""} · M${escapeHtml(String(m.match))}</div>
        ${m.venue && m.venue !== "A confirmar" ? `<div class="hero-next-venue">📍 ${escapeHtml(m.venue)}${m.city ? `, ${escapeHtml(m.city)}` : ""}</div>` : ""}
      </div>
      <div class="next-match-countdown">${timerHtml}</div>
    </div>
    ${probBlock}`;
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
  showToast(t("adminExpired"), "warn");
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
  $$(".nav button[data-section]").forEach(b => {
    const active = b.dataset.section === id;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (id === "admin") renderAdmin();
  if (id === "probs") scheduleMC();
  // Ranking always fetches fresh from Supabase so scores are never stale
  if (id === "ranking") debouncedReload();
  if (id === "games") {
    setTimeout(() => {
      const next = document.querySelector('.game-card[data-state="pre"]');
      next?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }
  const heading = document.querySelector(`#${id} h2, #${id} h3`);
  if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
}

// Tournament fully decided (CONFIG.archived, see config.js) -- Eduardo, 2026-07-19: "Copa do
// mundo finalizada! ... Desabilitar os botões todos, deixar só o vencedor, auditoria e os
// palpites." The Ranking tab already contains all three (podium banner, audit-report-link, and
// the "Ver palpites" per-entry detail panel) -- see index.html's #ranking section -- so archive
// mode just needs to hide every other nav button and force Ranking as the only reachable
// section. Admin is hidden from the header too but stays reachable via the small footer link
// (renderFooterBar) since guardAdmin()'s password gate is the real protection, not UI hiding.
// Called once from init(); nav buttons are never removed from the DOM, just hidden, so nothing
// here is destructive — flipping CONFIG.archived back to false and reloading fully restores them.
function applyArchiveMode() {
  if (!CONFIG.archived) return;
  ["entry", "games", "probs", "rules", "admin"].forEach(section => {
    document.querySelector(`.nav button[data-section="${section}"]`)?.classList.add("hidden");
  });
  showSection("ranking");
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

function isRealTeamName(s) {
  return !!s && !/^Winner|^Loser/i.test(s);
}

// "Ver palpites" row display only (never scoring — matchPoints/resolvedMatchResult
// always compare against real results directly, independent of this). Once the
// real team in a future-round slot is known via official results, show it
// instead of the entry's own guessed cascade, with their original guess in
// parentheses when it turned out wrong. Requested by participants after R16
// concluded — "Winner Match 89" (or a since-incorrect guess) was confusing to
// read once the real bracket was already decided.
function resolvedTeamsForEntryDisplay(entry, officialWinners, officialLosers) {
  const winners = {}, losers = {}, resolved = {};
  for (const m of DATA.knockoutMatches) {
    const p = entry.picks?.[m.match];
    const predictedA = resolveSlot(m.teamA, winners, losers);
    const predictedB = resolveSlot(m.teamB, winners, losers);
    const realA = resolveSlot(m.teamA, officialWinners, officialLosers);
    const realB = resolveSlot(m.teamB, officialWinners, officialLosers);
    // Only show "(original pick)" when the entry actually had one — a late
    // joiner missing an early-round pick would otherwise show the raw
    // "Winner Match N" placeholder as their "original pick", which they
    // never made.
    const displayA = isRealTeamName(realA)
      ? (realA !== predictedA && isRealTeamName(predictedA) ? `${realA} (${predictedA})` : realA)
      : predictedA;
    const displayB = isRealTeamName(realB)
      ? (realB !== predictedB && isRealTeamName(predictedB) ? `${realB} (${predictedB})` : realB)
      : predictedB;
    resolved[m.match] = { displayA, displayB };
    if (p?.advanceSide === "A") { winners[m.match] = predictedA; losers[m.match] = predictedB; }
    else if (p?.advanceSide === "B") { winners[m.match] = predictedB; losers[m.match] = predictedA; }
  }
  return resolved;
}

// Builds a winners/losers map from official state.results — used to resolve
// slot names ("Winner Match X") for display in the next-match card and elsewhere.
function officialWinnersMap(s) {
  const results = s.results || {};
  const winners = {}, losers = {};
  for (const m of DATA.knockoutMatches) {
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    const r = results[m.match];
    if (r?.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
    else if (r?.advanceSide === "B") { winners[m.match] = b; losers[m.match] = a; }
  }
  return { winners, losers };
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
  // After updateDynamic, team names are resolved. Flag any R16+ match where
  // the teams changed since the pick was made (opponent changed mid-tournament).
  for (const m of DATA.knockoutMatches) {
    if (R32_IDS.has(String(m.match))) continue;
    const c = $(`[data-card-match="${m.match}"]`);
    const p = found.picks?.[m.match];
    if (!c || !p?.displayA || !p?.displayB) continue;
    if (p.displayA !== c.dataset.currentA || p.displayB !== c.dataset.currentB) {
      const head = c.querySelector(".match-head");
      if (head && !head.querySelector(".teams-changed-chip")) {
        const chip = document.createElement("span");
        chip.className = "pill teams-changed-chip";
        chip.title = `${t("teamsChangedTitle")}: ${p.displayA} × ${p.displayB}`;
        chip.textContent = `⚠️ ${t("teamsChangedChip")}`;
        head.appendChild(chip);
      }
    }
  }
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
  const r16Only = isR32Window() && !_editingEntry;
  if (saveBtn) {
    saveBtn.disabled = r16Only;
    saveBtn.textContent = _editingEntry ? t("editSaveBtn") : t("saveEntry");
  }
  const nameEl = $("#entryName");
  if (nameEl) nameEl.readOnly = !!_editingEntry || r16Only;
  // In R16 window without active edit: hide new-entry form, progress bar, save bar
  const formCard     = $("#entryFormCard");
  const progressCard = $("#entryProgressCard");
  const submitBar    = $(".sticky-submit");
  if (formCard)     formCard.style.display     = r16Only ? "none" : "";
  if (progressCard) progressCard.style.display = r16Only ? "none" : "";
  if (submitBar)    submitBar.style.display     = r16Only ? "none" : "";
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
  renderPaymentBox();
}

function inferFromForm() {
  const winners = {}, losers = {};
  const results = state().results || {};
  for (const m of DATA.knockoutMatches) {
    const card = $(`[data-card-match="${m.match}"]`);
    // Always resolve slot names first (needed for hidden R32 cards too).
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    if (card) { card.dataset.currentA = a; card.dataset.currentB = b; }
    // Completed matches: propagate real result into winners map regardless of
    // whether the card is rendered. Fixes R16+ slots when R32 cards are hidden.
    const result = results[m.match];
    if (result?.advanceSide) {
      if (result.advanceSide === "A") { winners[m.match] = a; losers[m.match] = b; }
      else { winners[m.match] = b; losers[m.match] = a; }
      continue;
    }
    if (!card) continue; // hidden and no real result — nothing to propagate
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
  if (teamA) teamA.innerHTML = `<span class="team-flag">${escapeHtml(flag(a))}</span><span class="team-name">${escapeHtml(a)}</span>`;
  if (teamB) teamB.innerHTML = `<span class="team-name">${escapeHtml(b)}</span><span class="team-flag">${escapeHtml(flag(b))}</span>`;
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
    if (isR32Window() && R32_IDS.has(String(m.match))) continue; // R32 done — hide during R16 window
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
        ${m.timeET ? `<span class="pill">🕒 ${escapeHtml(m.timeET)} · ${escapeHtml(brtTimeFromKickoff(m.date, m.timeET))} BRT</span>` : ""}
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
  // During R16 window, lock R32 inputs even for blank new entries so
  // participants can't retroactively pick already-played matches.
  if (isR32Window() && !_editingEntry) lockR32Inputs();
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
    // R32 matches not rendered during R16 window — nothing to read from form.
    if (isR32Window() && R32_IDS.has(String(m.match))) continue;
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
// Real champion/runner-up (once M104 is decided) and/or 3rd/4th (once M103 is decided) -- the
// two halves are independent, since a participant can earn the 3rd-place bonus without the
// champion being known yet, and vice versa.
//
// Eduardo, 2026-07-19: "O email pos jogo foi enviado sem o bonus do 3 lugar por que" -- M103
// concluded (France 4x6 England) but M104 hadn't been played yet. This function used to return
// null entirely unless M104 specifically was locked (`if (!rFin?.advanceSide) return null`),
// completely ignoring M103 -- so with only M103 decided, scoreEntry()'s bonus block never ran at
// all, silently paying zero bonus to everyone, including the real entries that had correctly
// predicted England for 3rd. Fixed to resolve champion/runnerUp and third/fourth independently;
// scoreEntry() already checks each of the four fields independently against the entry's own
// pick, so a partial podium (one half still "") was always safe to consume -- only the early
// return above was wrong.
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
  let champion = "", runnerUp = "";
  if (rFin?.advanceSide) {
    const fA = resolveSlot(fin.teamA, winners, losers), fB = resolveSlot(fin.teamB, winners, losers);
    champion = rFin.advanceSide === "A" ? fA : fB;
    runnerUp = rFin.advanceSide === "A" ? fB : fA;
  }
  let thirdPlace = "", fourth = "";
  if (rTrd?.advanceSide) {
    const tA = resolveSlot(trd.teamA, winners, losers), tB = resolveSlot(trd.teamB, winners, losers);
    thirdPlace = rTrd.advanceSide === "A" ? tA : tB;
    fourth     = rTrd.advanceSide === "A" ? tB : tA;
  }
  if (!champion && !thirdPlace) return null;
  return { champion, runnerUp, third: thirdPlace, fourth };
}

// Podium bonus contributed by exactly ONE match (M103 -> third+fourth, M104 -> champion+
// runnerUp), plus a human-readable note -- used ONLY to itemize a per-match breakdown row
// (admin result email, "Ver palpites" panel). Never for the aggregate total; scoreEntry()'s
// bonus block on the whole entry stays the single source of truth for that.
//
// Eduardo, 2026-07-19, after the correction email: "Email foi mais uma vez incorreto sem o
// bonus." The ranking TOTAL was already correct -- but the per-match breakdown row for M103 only
// ever showed the base 5 pts ("+5 England avança"), with the +10 podium bonus folded silently
// into the total with nothing connecting the two. Reasonable to read that table and conclude the
// bonus was still missing. Mirrors the fold-into-displayed-points design already used by the
// live/provisional preview (liveMatchPoints()), for consistency.
function matchPodiumBonus(entry, mid, s) {
  if (mid !== "103" && mid !== "104") return { pts: 0, notePt: "", noteEn: "", noteEs: "" };
  const realPod = podiumFromResults(s);
  if (!realPod) return { pts: 0, notePt: "", noteEn: "", noteEs: "" };
  const pred = finalPodiumForEntry(entry);
  let pts = 0;
  const notesPt = [], notesEn = [], notesEs = [];
  if (mid === "103") {
    if (pred.third && realPod.third && pred.third === realPod.third) {
      pts += CONFIG.bonus.third;
      notesPt.push(`+${CONFIG.bonus.third} bônus 3º lugar`); notesEn.push(`+${CONFIG.bonus.third} 3rd place bonus`); notesEs.push(`+${CONFIG.bonus.third} bono 3er lugar`);
    }
    if (pred.fourth && realPod.fourth && pred.fourth === realPod.fourth) {
      pts += CONFIG.bonus.fourth;
      notesPt.push(`+${CONFIG.bonus.fourth} bônus 4º lugar`); notesEn.push(`+${CONFIG.bonus.fourth} 4th place bonus`); notesEs.push(`+${CONFIG.bonus.fourth} bono 4º lugar`);
    }
  } else {
    if (pred.champion && pred.champion === realPod.champion) {
      pts += CONFIG.bonus.champion;
      notesPt.push(`+${CONFIG.bonus.champion} bônus campeão`); notesEn.push(`+${CONFIG.bonus.champion} champion bonus`); notesEs.push(`+${CONFIG.bonus.champion} bono campeón`);
    }
    if (pred.runnerUp && pred.runnerUp === realPod.runnerUp) {
      pts += CONFIG.bonus.runnerUp;
      notesPt.push(`+${CONFIG.bonus.runnerUp} bônus vice-campeão`); notesEn.push(`+${CONFIG.bonus.runnerUp} runner-up bonus`); notesEs.push(`+${CONFIG.bonus.runnerUp} bono subcampeón`);
    }
  }
  return { pts, notePt: notesPt.join(", "), noteEn: notesEn.join(", "), noteEs: notesEs.join(", ") };
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

// Stored result for a match; falls back to the hardcoded DATA result (offline
// resilience) when Supabase/localStorage hasn't got it yet.
function resolvedMatchResult(m, s) {
  const stored = (s.results || {})[m.match];
  if (stored !== undefined) return stored;
  if (m.status === "Final" && m.goalsA !== null) {
    return {
      goalsA: m.goalsA, goalsB: m.goalsB,
      advanceSide: m.winner === m.teamA ? "A" : m.winner === m.teamB ? "B" : null
    };
  }
  return null;
}

function scoreEntry(entry, s) {
  let total = 0;
  for (const m of DATA.knockoutMatches) {
    const mp = matchPoints(entry.picks?.[m.match], resolvedMatchResult(m, s));
    if (mp) total += mp.pts;
  }
  const bonus = { champion: 0, runnerUp: 0, third: 0, fourth: 0, total: 0, podiumHits: 0 };
  const realPod = podiumFromResults(s);
  if (realPod) {
    const pickPod = finalPodiumForEntry(entry);
    if (pickPod.champion && pickPod.champion === realPod.champion) bonus.champion = CONFIG.bonus.champion;
    if (pickPod.runnerUp && pickPod.runnerUp === realPod.runnerUp) bonus.runnerUp = CONFIG.bonus.runnerUp;
    if (pickPod.third    && pickPod.third    === realPod.third)    bonus.third    = CONFIG.bonus.third;
    if (pickPod.fourth   && pickPod.fourth   === realPod.fourth)   bonus.fourth   = CONFIG.bonus.fourth;
    bonus.total = bonus.champion + bonus.runnerUp + bonus.third + bonus.fourth;
    // Tiebreaker level 2: champion/runner-up/3rd correctly picked (not 4th).
    bonus.podiumHits = (bonus.champion > 0 ? 1 : 0) + (bonus.runnerUp > 0 ? 1 : 0) + (bonus.third > 0 ? 1 : 0);
    total += bonus.total;
  }
  return { total, bonus };
}

// Tiebreaker: how many knockout matches this entry got the exact score right.
// Used to break ties in total points — more exact scores ranks higher.
function exactMatchCount(entry, s) {
  let n = 0;
  for (const m of DATA.knockoutMatches) {
    const mp = matchPoints(entry.picks?.[m.match], resolvedMatchResult(m, s));
    if (mp?.exact) n++;
  }
  return n;
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
  if (!isValidEmail(to)) { showToast(t("invalidEmail"), "error"); return; }
  if (!window.emailjs) { showToast(t("emailjsNotLoaded"), "error"); return; }
  const template = target === "admin" ? CONFIG.emailjs.adminTemplateId : CONFIG.emailjs.participantTemplateId;
  try {
    await emailjs.send(CONFIG.emailjs.serviceId, template, {
      to_email: to, entry_name: emailSubjectSafe(e.entryName), receipt_code: receiptCode(e), html_message: receiptHtml(e)
    }, { publicKey: CONFIG.emailjs.publicKey });
    showToast(t("emailSent"), "success");
  } catch (err) {
    console.warn("Email failed", err);
    showToast(`${t("emailjsNotLoaded")}: ${err?.text || err?.message || String(err)}`, "error");
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
      to_email: e.participantEmail, entry_name: `REMOVIDA — ${emailSubjectSafe(e.entryName)}`,
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
  const scored = realEntries
    .map(e => { const sc = scoreEntry(e, s); return { e, total: sc.total, exact: exactMatchCount(e, s), podiumHits: sc.bonus.podiumHits }; })
    .sort((a, b) => b.total - a.total || b.exact - a.exact || b.podiumHits - a.podiumHits);

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

  // mid: when "103" or "104", the +5 "advance" note uses match-appropriate wording instead of
  // "avança"/"advances"/"avanza" -- Eduardo, 2026-07-19: nobody "advances" from the 3rd place
  // match or the Final, those are the last matches of the bracket for that side. Wording only.
  function scoreMatchSingle(pick, result, tA, tB, mid) {
    if (!pick || !result?.advanceSide) return { pts: 0, detPt: "sem palpite", detEn: "no pick", detEs: "sin pronóstico" };
    const pA = parseScore(pick.goalsA), pB = parseScore(pick.goalsB);
    if (pA === null || pB === null) return { pts: 0, detPt: "palpite inválido", detEn: "invalid pick", detEs: "pronóstico inválido" };
    const rA = parseScore(result.goalsA), rB = parseScore(result.goalsB);
    if (rA === null || rB === null) return { pts: 0, detPt: "resultado inválido", detEn: "invalid result", detEs: "resultado inválido" };
    let pts = 0; const nPt = [], nEn = [], nEs = [];
    if (pA === rA && pB === rB) {
      pts += sc.exactScore; nPt.push(`+${sc.exactScore} placar exato`); nEn.push(`+${sc.exactScore} exact score`); nEs.push(`+${sc.exactScore} marcador exacto`);
    } else {
      if (pA === rA) { pts += sc.oneTeamGoals; nPt.push(`+1 acertou gols de ${tA} (${rA})`); nEn.push(`+1 correct goals for ${tA} (${rA})`); nEs.push(`+1 acertó los goles de ${tA} (${rA})`); }
      if (pB === rB) { pts += sc.oneTeamGoals; nPt.push(`+1 acertou gols de ${tB} (${rB})`); nEn.push(`+1 correct goals for ${tB} (${rB})`); nEs.push(`+1 acertó los goles de ${tB} (${rB})`); }
    }
    if (pick.advanceSide === result.advanceSide) {
      const w = result.advanceSide === "B" ? tB : tA;
      pts += sc.advance;
      if (String(mid) === "103") {
        nPt.push(`+${sc.advance} ${w} vence a disputa de 3º lugar`); nEn.push(`+${sc.advance} ${w} wins the 3rd place match`); nEs.push(`+${sc.advance} ${w} gana el partido por el 3er lugar`);
      } else if (String(mid) === "104") {
        nPt.push(`+${sc.advance} ${w} vence a Final`); nEn.push(`+${sc.advance} ${w} wins the Final`); nEs.push(`+${sc.advance} ${w} gana la Final`);
      } else {
        nPt.push(`+${sc.advance} ${w} avança`); nEn.push(`+${sc.advance} ${w} advances`); nEs.push(`+${sc.advance} ${w} avanza`);
      }
    }
    return { pts, detPt: nPt.join(", ") || "—", detEn: nEn.join(", ") || "—", detEs: nEs.join(", ") || "—" };
  }

  const breakdownScored = lastMid ? scored.map(item => {
    const pick = item.e.picks?.[lastMid];
    let { pts, detPt, detEn, detEs } = scoreMatchSingle(pick, lastResult, lastTeamA, lastTeamB, lastMid);
    if (pick) {
      const bonus = matchPodiumBonus(item.e, lastMid, s);
      if (bonus.pts) {
        pts += bonus.pts;
        detPt = detPt !== "—" ? `${detPt}, ${bonus.notePt}` : bonus.notePt;
        detEn = detEn !== "—" ? `${detEn}, ${bonus.noteEn}` : bonus.noteEn;
        detEs = detEs !== "—" ? `${detEs}, ${bonus.noteEs}` : bonus.noteEs;
      }
    }
    const pickStr = pick
      ? `${Number(pick.goalsA)}–${Number(pick.goalsB)} (${pick.advanceSide === "B" ? lastTeamB : lastTeamA})`
      : "—";
    return { name: item.e.entryName || "?", pts, detPt, detEn, detEs, pickStr };
  }).sort((a, b) => b.pts - a.pts) : [];

  let breakdownPt = "", breakdownEn = "", breakdownEs = "";
  for (const row of breakdownScored) {
    const c = ptsColor(row.pts);
    breakdownPt += `<tr><td style="padding:6px 10px">${escapeHtml(row.name)}</td><td style="padding:6px 10px;text-align:center">${escapeHtml(row.pickStr)}</td><td style="padding:6px 10px;text-align:center;font-weight:700;color:${c}">${row.pts}</td><td style="padding:6px 10px;font-size:11px;color:#6b7280">${escapeHtml(row.detPt)}</td></tr>`;
    breakdownEn += `<tr><td style="padding:6px 10px">${escapeHtml(row.name)}</td><td style="padding:6px 10px;text-align:center">${escapeHtml(row.pickStr)}</td><td style="padding:6px 10px;text-align:center;font-weight:700;color:${c}">${row.pts}</td><td style="padding:6px 10px;font-size:11px;color:#6b7280">${escapeHtml(row.detEn)}</td></tr>`;
    breakdownEs += `<tr><td style="padding:6px 10px">${escapeHtml(row.name)}</td><td style="padding:6px 10px;text-align:center">${escapeHtml(row.pickStr)}</td><td style="padding:6px 10px;text-align:center;font-weight:700;color:${c}">${row.pts}</td><td style="padding:6px 10px;font-size:11px;color:#6b7280">${escapeHtml(row.detEs)}</td></tr>`;
  }

  let rankingRows = "", prevKey = null, rank = 0;
  for (let i = 0; i < scored.length; i++) {
    const item = scored[i];
    const key = `${item.total}:${item.exact}:${item.podiumHits}`;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;
    const medal = { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `${rank}`;
    const bg = rank <= 3 ? "#fffbe6" : "white";
    rankingRows += `<tr style="background:${bg}"><td style="padding:7px 10px;text-align:center">${medal}</td><td style="padding:7px 10px">${escapeHtml(item.e.entryName || "?")}</td><td style="padding:7px 10px;text-align:center;font-weight:700;color:${ptsColor(item.total)}">${item.total}</td></tr>`;
  }

  const matchCount = sortedMids.length;
  const lastLabel = lastMid ? `M${lastMid}` : "";
  const lastResultStr = lastResult ? `${lastTeamA} ${lastResult.goalsA}–${lastResult.goalsB} ${lastTeamB}` : "—";
  // Eduardo, 2026-07-19: nobody "advances" from M103/M104, those are the bracket's last matches.
  const lastWinnerVerbPt = String(lastMid) === "103" ? "vence a disputa de 3º lugar" : String(lastMid) === "104" ? "vence a Final" : "avança";
  const lastWinnerVerbEn = String(lastMid) === "103" ? "wins the 3rd place match" : String(lastMid) === "104" ? "wins the Final" : "advances";
  const lastWinnerVerbEs = String(lastMid) === "103" ? "gana el partido por el 3er lugar" : String(lastMid) === "104" ? "gana la Final" : "avanza";
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
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ ${escapeHtml(lastWinner)} ${lastWinnerVerbPt}</div>
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
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ ${escapeHtml(lastWinner)} ${lastWinnerVerbEn}</div>
    </div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Scoring — Latest match (${lastLabel})</div>
    <table ${tbl}><thead><tr ${thead}><th ${th}>Entry</th><th ${th} style="text-align:center">Pick</th><th ${th} style="text-align:center">Pts</th><th ${th}>Details</th></tr></thead><tbody>${breakdownEn}</tbody></table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">Exact score = 10 pts · Correct advance = 5 pts · Exact goals of 1 team = 1 pt <em>(per team, not per goal)</em></div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Current ranking (${matchCount} of 32 matches played)</div>
    <table ${tbl}><thead><tr ${thead}><th ${th} style="text-align:center">#</th><th ${th}>Entry</th><th ${th} style="text-align:center">Total</th></tr></thead><tbody>${rankingRows}</tbody></table>
    <div style="height:2px;background:#dbeafe;margin:24px 0"></div>
    <div style="font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #dbeafe">🇲🇽 Español</div>
    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Último partido (${lastLabel})</div>
      <div style="font-size:16px;font-weight:700">${escapeHtml(lastResultStr)}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">✓ ${escapeHtml(lastWinner)} ${lastWinnerVerbEs}</div>
    </div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Puntuación — Último partido (${lastLabel})</div>
    <table ${tbl}><thead><tr ${thead}><th ${th}>Entrada</th><th ${th} style="text-align:center">Pronóstico</th><th ${th} style="text-align:center">Pts</th><th ${th}>Detalles</th></tr></thead><tbody>${breakdownEs}</tbody></table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">Marcador exacto = 10 pts · Avance correcto = 5 pts · Goles exactos de 1 equipo = 1 pt <em>(por equipo, no por gol)</em></div>
    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Clasificación actual (${matchCount} de 32 partidos)</div>
    <table ${tbl}><thead><tr ${thead}><th ${th} style="text-align:center">#</th><th ${th}>Entrada</th><th ${th} style="text-align:center">Total</th></tr></thead><tbody>${rankingRows}</tbody></table>
    <div style="height:1px;background:#e2e8f0;margin:20px 0"></div>
    <div style="text-align:center;font-size:12px;color:#9ca3af"><a href="https://ferrarilabs.github.io/bolao/copa2026/" style="color:#1d4ed8;text-decoration:none">ferrarilabs.github.io/bolao/copa2026/</a> · Bolão do Ferrari · Copa 2026</div>
  </div>
</div>`;
}

function buildPodiumEmailHtml(info, s) {
  const medal = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const labelPt = { 1: "Campeão", 2: "Vice-campeão", 3: "3º lugar" };
  const labelEn = { 1: "Champion", 2: "Runner-up", 3: "3rd place" };
  const labelEs = { 1: "Campeón", 2: "Subcampeón", 3: "3er lugar" };
  // BATCH 5 (2026-08-07): formato USD canônico `US$ X.XX`. Esta lambda existia TRÊS vezes neste
  // arquivo (aqui, no .podium-amount e na tabela de conferência), cada uma com `$` e removendo
  // `.00` — três cópias da mesma regra é como a plataforma acabou com quatro formatos diferentes.
  // Agora todas as três chamam o formatador compartilhado (bolao/shared/js/money.js).
  const amt = a => window.BOLAO_MONEY.usd(a);
  // Real World Cup podium (which TEAM finished champion/runnerUp/third) -- used only for the
  // "Assim como <time>..." congrats line (Eduardo, 2026-07-18), a creative pairing between the
  // real podium and the bolão's own money podium. Cosmetic copy only, never affects payouts.
  const realPod = podiumFromResults(s) || {};
  const teamForRank = { 1: realPod.champion, 2: realPod.runnerUp, 3: realPod.third };
  const congrats = (p, lang) => {
    const team = teamForRank[p.rank];
    if (!team) return "";
    const name = escapeHtml(p.entryName), t2 = escapeHtml(team);
    const text = lang === "pt" ? `Parabéns, ${name}! Assim como ${t2}, você também é ${labelPt[p.rank]} — só que do nosso bolão! 🏆`
      : lang === "en" ? `Congrats, ${name}! Just like ${t2}, you're also the ${labelEn[p.rank]} — of our bolão! 🏆`
      : `¡Felicidades, ${name}! Así como ${t2}, tú también eres ${labelEs[p.rank]} — ¡de nuestro bolão! 🏆`;
    return `<div style="font-size:11px;color:#374151;margin-top:6px;font-style:italic">${text}</div>`;
  };
  const card = (p, labels, tiedNote, lang) => `<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
      <div style="font-size:30px;line-height:1;margin-bottom:6px">${medal[p.rank]}</div>
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px">${labels[p.rank]}</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${escapeHtml(p.entryName)}</div>
      <div style="font-size:22px;font-weight:900;color:#16a34a">${amt(p.amount)}</div>
      ${p.tied ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px">${tiedNote}</div>` : ""}
      ${congrats(p, lang)}
    </div>`;
  const cardsPt = info.payouts.map(p => card(p, labelPt, "Empate — valor dividido entre os empatados", "pt")).join("");
  const cardsEn = info.payouts.map(p => card(p, labelEn, "Tied — amount split between tied entries", "en")).join("");
  const cardsEs = info.payouts.map(p => card(p, labelEs, "Empate — monto dividido entre los empatados", "es")).join("");
  return `
  <div style="background:linear-gradient(135deg,#78350f,#451a03);border:2px solid #f59e0b;border-radius:14px;padding:22px 18px;margin-bottom:22px;text-align:center">
    <div style="font-size:20px;font-weight:900;color:white;margin-bottom:16px">🏆 Resultado Final do Bolão! · Final Bolão Result! · ¡Resultado Final del Bolão!</div>
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fde68a;margin-bottom:8px">Português</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">${cardsPt}</div>
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fde68a;margin-bottom:8px">English</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">${cardsEn}</div>
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fde68a;margin-bottom:8px">Español</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">${cardsEs}</div>
    <div style="font-size:13px;color:#fde68a;margin-bottom:14px">
      Obrigado a todos que participaram! Foi um prazer acompanhar a Copa com vocês.<br>
      Thanks to everyone who played! It was a pleasure following the World Cup with you all.<br>
      ¡Gracias a todos los que participaron! Fue un placer acompañar la Copa con ustedes.
    </div>
    <div style="font-size:11px;color:#fbbf2480">Pote total / Total pot: ${amt(info.pot)}</div>
  </div>
`;
}

async function sendResultEmailFromAdmin(testOnly) {
  if (!guardAdmin()) return;
  if (!window.emailjs) { showToast(t("emailjsNotLoaded"), "error"); return; }
  const s = state();
  const completedResults = Object.entries(s.results || {}).filter(([, v]) => v?.advanceSide);
  if (!completedResults.length) { showToast(t("noKnockoutResults"), "warn"); return; }

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

    // Tournament fully decided (M103 + M104 both locked) -- prepend podium/prize block and
    // use the special final subject line instead of the generic "Resultado Parcial" one.
    const podiumInfo = finalPodiumPayouts(s);
    const emailSubject = emailSubjectSafe(podiumInfo
      ? `🏆 Resultado Final do Bolão! · Final Bolão Result! — ${lastResultStr}`
      : `Resultado Parcial — M${lastMid}: ${lastResultStr}`);

    const html = (podiumInfo ? buildPodiumEmailHtml(podiumInfo, s) : "") + buildResultEmailHtml(s, testOnly);
    const deleted = new Set(s.deletedIds || []);

    if (testOnly) {
      await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId,
        { to_email: CONFIG.adminEmail, entry_name: emailSubject, receipt_code: emailSubject, html_message: html },
        { publicKey: CONFIG.emailjs.publicKey });
      showToast(`Email de teste enviado para ${CONFIG.adminEmail} ✓`, "success");
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
      // emailjs.init() aplica limitRate.throttle GLOBALMENTE à página (não por destinatário) --
      // bug real encontrado em auditoria (2026-07-14): com um intervalo de 3.5s entre envios
      // (bem menor que os 30s do throttle), praticamente todo envio depois do primeiro caía
      // silenciosamente no catch, o admin só via "1 ✓, N erros" sem saber por quê. Corrigido
      // usando o próprio limitRateMs como intervalo (+ margem), então nenhum envio nunca cai
      // dentro da própria janela de throttle da página.
      const gapMs = (CONFIG.emailjs.limitRateMs || 30000) + 500;
      const etaMin = Math.ceil((recipients.length * gapMs) / 60000);
      if (!confirm(`Enviar email de resultado para ${recipients.length} participante(s)? Leva cerca de ${etaMin} min (limite do EmailJS).`)) return;
      let sent = 0, errors = 0;
      for (let i = 0; i < recipients.length; i++) {
        const { addr } = recipients[i];
        try {
          await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId,
            { to_email: addr, entry_name: emailSubject, receipt_code: emailSubject, html_message: html },
            { publicKey: CONFIG.emailjs.publicKey });
          sent++;
          if (btn) btn.textContent = `Enviando... (${i + 1}/${recipients.length})`;
          if (i < recipients.length - 1) await new Promise(r => setTimeout(r, gapMs));
        } catch (err) {
          console.error("Result email error:", err);
          errors++;
        }
      }
      showToast(`Emails enviados: ${sent} ✓${errors ? `, erros: ${errors}` : ""}`, errors ? "warn" : "success", 5000);
    }
  } catch (err) {
    showToast(`Erro ao enviar: ${err?.text || err?.message || String(err)}`, "error", 5000);
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
  const r16Only = isR32Window() && !_editingEntry;
  const btn = $("#saveEntry");
  if (btn) btn.disabled = closed || r16Only;
  if (closed) $$("#bracketForm input,#bracketForm select,#smartPick,#randomPick").forEach(el => { el.disabled = true; });
}

// Rank-movement arrows (like a live league table): compares each id's position
// in `items` against the last time this `key`'s scores actually changed, not
// every re-render — so incidental redraws (language switch, countdown tick,
// a poll that finds no change) don't reset the arrows. Keyed so the overall
// ranking and each live match's provisional table track movement separately.
const _rankArrowState = new Map();

// renderRanking() fully rebuilds every entry's "Ver palpites" detail panel
// (always starting hidden) on every call — including the periodic 30s sync,
// visibilitychange/focus, and the version-check reload poll. Without this,
// an open panel silently snaps shut a few seconds after opening it, on the
// next background sync. Mirrors the same pattern already used for the Jogos
// tab's live-points toggle (_openLiveDetails).
const _openRankDetails = new Set();

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

// Eduardo: "Precisamos pensar num email para o campeão, vice e terceiro lugar com o valor
// recebido... e também uma tela especial para apos o fim do jogo de amanhã com o valor pago
// para cada um" (2026-07-18). Prêmio do BOLÃO (quem ganha dinheiro) nunca tinha sido calculado
// em lugar nenhum antes — CONFIG.prizes existia no config.js mas nunca era lido. Não confundir
// com podiumFromResults()/finalPodiumForEntry() (campeão/vice/3º/4º do MUNDIAL, usado só pro
// bônus de pontos) — aqui é sobre os 3 primeiros colocados do RANKING DO BOLÃO (por pontuação
// total), que são pessoas, não seleções.
//
// Só retorna algo quando M103 (3º lugar) E M104 (Final) estiverem travados pelo admin — antes
// disso o "resultado final" do bolão ainda não existe. Mesmo critério de pontuação/desempate já
// usado em renderRanking() (total → exact → podiumHits), reaproveitado aqui pra nunca divergir:
// dois desempates idênticos empatam de verdade (mesma chave `${total}:${exact}:${podiumHits}`
// usada pra agrupar rank na tela) e dividem o prêmio daquela colocação entre si — mesma regra já
// documentada na aba Regras ("a posição e o prêmio daquela colocação são divididos entre os
// empatados"), nunca implementada até agora. Eduardo confirmou (2026-07-18): pote é o valor JÁ
// pago agora (ninguém mais vai pagar depois do prazo).
function finalPodiumPayouts(s) {
  if (!(s.results?.["103"]?.advanceSide && s.results?.["104"]?.advanceSide)) return null;
  const deleted = new Set(s.deletedIds || []);
  const realEntries = (s.entries || []).filter(e => !deleted.has(e.id) && !e.diagnostics?.demo);
  if (!realEntries.length) return null;

  const paidCount = (s.entries || []).filter(e => s.paid[e.id]).length;
  const pot = paidCount * (CONFIG.entryFee || 5);
  if (!pot) return null;

  const scored = realEntries
    .map(e => { const sc = scoreEntry(e, s); return { e, total: sc.total, exact: exactMatchCount(e, s), podiumHits: sc.bonus.podiumHits }; })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.exact !== a.exact) return b.exact - a.exact;
      if (b.podiumHits !== a.podiumHits) return b.podiumHits - a.podiumHits;
      const aName = (a.e.entryName || "").toUpperCase();
      const bName = (b.e.entryName || "").toUpperCase();
      // Display-only stable order for genuinely-tied entries (same total/exact/podiumHits) —
      // never used to decide the money split below, only which name appears first in a group.
      if (aName < bName) return 1;
      if (aName > bName) return -1;
      return 0;
    });

  const byRank = { 1: [], 2: [], 3: [] };
  let rank = 0, prevKey = null;
  scored.forEach((item, i) => {
    const key = `${item.total}:${item.exact}:${item.podiumHits}`;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;
    if (byRank[rank]) byRank[rank].push(item);
  });

  const pct = { 1: CONFIG.prizes.first, 2: CONFIG.prizes.second, 3: CONFIG.prizes.third };
  const payouts = [];
  [1, 2, 3].forEach(r => {
    const group = byRank[r];
    if (!group.length) return;
    const amount = (pot * pct[r]) / group.length;
    group.forEach(item => payouts.push({
      id: item.e.id, entryName: item.e.entryName || "?", rank: r,
      amount, tied: group.length > 1,
    }));
  });
  return { pot, payouts };
}

function renderPodiumBanner() {
  const el = $("#podiumBanner");
  if (!el) return;
  const s = state();
  const info = finalPodiumPayouts(s);
  if (!info) { el.classList.add("hidden"); el.innerHTML = ""; return; }

  const rankMeta = {
    1: { medal: "🥇", labelKey: "podiumChampion" },
    2: { medal: "🥈", labelKey: "podiumRunnerUp" },
    3: { medal: "🥉", labelKey: "podiumThird" },
  };
  const cards = info.payouts.map(p => {
    const meta = rankMeta[p.rank];
    const tiedNote = p.tied ? `<div class="podium-tied-note">${escapeHtml(t("podiumTiedNote"))}</div>` : "";
    return `<div class="podium-card">
      <div class="podium-medal">${meta.medal}</div>
      <div class="podium-place">${escapeHtml(t(meta.labelKey))}</div>
      <div class="podium-name">${escapeHtml(p.entryName)}</div>
      <div class="podium-amount">${window.BOLAO_MONEY.usd(p.amount)}</div>
      ${tiedNote}
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="podium-title">${escapeHtml(t("podiumTitle"))}</div>
    <div class="podium-grid">${cards}</div>
    <div class="podium-thanks">${escapeHtml(t("podiumThanks"))}</div>
  `;
  el.classList.remove("hidden");
}

function renderRanking() {
  const s = state(), box = $("#rankingList");
  renderPodiumBanner();
  if (!box) return;
  const paidCount = s.entries.filter(e => s.paid[e.id]).length;
  const potEl = $("#potValue");
  // BATCH 5: era `$0`/`$65` (dólar nu, sem centavos) — agora o formato canônico `US$ 0.00`.
  if (potEl) potEl.textContent = window.BOLAO_MONEY.usd(paidCount * (CONFIG.entryFee || 5));
  if (!s.entries.length) { box.innerHTML = `<div class="card"><p>${escapeHtml(t("noEntries"))}</p></div>`; return; }
  // Tiebreak cascade: total points → most exact scores → most correct
  // champion/runner-up/3rd picks. Still tied after all three? Shared position —
  // Eduardo splits that placement's prize manually (payouts aren't automated).
  // Display-only 4th level for still-tied entries: reverse alphabetical
  // (Z→A) by entry name, uppercased and compared by plain code-unit order
  // (no locale-aware collation) so this always matches send_result_email.py's
  // identical Python-side tiebreak exactly.
  const ranked = s.entries
    .map(e => { const sc = scoreEntry(e, s); return { ...e, _score: sc.total, _bonus: sc.bonus, _exact: exactMatchCount(e, s) }; })
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      if (b._exact !== a._exact) return b._exact - a._exact;
      if (b._bonus.podiumHits !== a._bonus.podiumHits) return b._bonus.podiumHits - a._bonus.podiumHits;
      const aName = (a.entryName || "").toUpperCase();
      const bName = (b.entryName || "").toUpperCase();
      if (aName < bName) return 1;
      if (aName > bName) return -1;
      return 0;
    });
  // Tiebreak-aware arrows: encode (total, exact, podiumHits) as one sortable
  // number so ties that share a rank don't get an arbitrary up/down between them.
  const arrows = computeRankArrows("ranking", ranked.map(e => ({ id: e.id, score: e._score * 100000 + e._exact * 10 + e._bonus.podiumHits })));
  box.innerHTML = "";
  let prevKey = null, rank = 0;
  ranked.forEach((e, i) => {
    const key = `${e._score}:${e._exact}:${e._bonus.podiumHits}`;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;
    const medal = ["🥇","🥈","🥉"][rank - 1] || `${rank}`;
    const arrowHtml = rankArrowHtml(arrows[e.id]);
    const bonusLine = e._bonus?.total ? `${t("bonusLabel")} +${e._bonus.total}` : "";
    const demoBadge = e.diagnostics?.demo ? ' <span class="demo-badge">Demo</span>' : "";
    const bonusBadge = bonusLine ? `<br><span class="muted">${escapeHtml(bonusLine)}</span>` : "";
    // Phase 7-FIX ranking-row canonical skeleton (docs/bolao/CANONICAL_GAME_CARD_SKELETON.md's
    // ranking-row equivalent): .rank-row/.rank-pos/.points kept (still drive the grid/mobile
    // CSS, bolao/shared/css/responsive.css) — .ranking-row__position/__participant/__name/
    // __metadata/__score/__actions added as BEM labels on the same elements, same content/
    // values as before this change.
    const row = document.createElement("div");
    row.className = "rank-row ranking-row";
    row.innerHTML = `
<div class="rank-pos ranking-row__position">${medal}${arrowHtml}</div>
<div class="ranking-row__participant"><span class="ranking-row__name"><b>${escapeHtml(e.entryName)}</b></span>${demoBadge}<span class="ranking-row__metadata">${bonusBadge}</span></div>
<div class="points ranking-row__score">${e._score}</div>
<button type="button" class="secondary small-btn ranking-row__actions" data-rank-toggle="${escapeHtml(e.id)}" aria-label="${escapeHtml(t("viewPicks"))} — ${escapeHtml(e.entryName || "")}">${escapeHtml(t("viewPicks"))}</button>`;
    box.appendChild(row);
    const detail = document.createElement("div");
    const isOpen = _openRankDetails.has(e.id);
    detail.className = `card picks-detail${isOpen ? "" : " hidden"}`;
    detail.dataset.rankDetail = e.id;
    // Perf: picksTable() builds a full 32-match table -- achado em auditoria (2026-07-14), era
    // recalculado pra TODA entrada em todo render (resync de 30s incluso), mesmo quando o detalhe
    // está fechado (display:none, jogado fora). Só computa aqui se já estiver aberto; o clique que
    // abre (ver initEvents(), data-rank-toggle) computa sob demanda na primeira vez.
    if (isOpen) detail.innerHTML = picksTable(e);
    else detail.dataset.lazy = "1";
    box.appendChild(detail);
  });
}

function picksTable(entry) {
  const s = state();
  const { winners: officialWinners, losers: officialLosers } = officialWinnersMap(s);
  const r = resolvedTeamsForEntryDisplay(entry, officialWinners, officialLosers);
  const results = s.results || {};
  // Hide picks for any unplayed match while the entry window is still open.
  // Prevents participants from copying each other's future-round picks.
  // Uses isPastCutoff() so this stays correct regardless of which window phase we're in.
  const hideFuturePicks = !isPastCutoff();
  const rows = DATA.knockoutMatches.map(m => {
    const p = entry.picks?.[m.match], rr = r[m.match] || {};
    if (!p) return "";
    const result = results[m.match];
    if (hideFuturePicks && !result?.advanceSide) return "";
    const w = p.advanceSide === "A" ? rr.displayA : rr.displayB;
    const hasRealScore = result?.goalsA !== undefined && result?.goalsB !== undefined;
    const realScore = hasRealScore ? `${result.goalsA}–${result.goalsB}` : "—";
    const mp = matchPoints(p, result);
    let pts = result?.advanceSide ? (mp ? mp.pts : 0) : null;
    // M103/M104 also carry a podium bonus (3rd/4th, champion/runner-up) that scoreEntry() folds
    // into the entry's overall total -- fold it into THIS row's points too, so the number shown
    // per match actually matches what that match contributed. Eduardo, 2026-07-19: without this,
    // the row showed only the base 5 pts while the bonus appeared silently in the total further
    // up, reasonably read as "o bônus ainda está faltando".
    let bonusNote = "";
    if (pts !== null) {
      const bonus = matchPodiumBonus(entry, String(m.match), s);
      if (bonus.pts) { pts += bonus.pts; bonusNote = ` title="${escapeHtml(bonus[currentLang === "en-US" ? "noteEn" : currentLang === "es" ? "noteEs" : "notePt"])}"`; }
    }
    const ptsCell = pts === null
      ? `<span class="muted">—</span>`
      : `<b class="pick-pts${pts > 0 ? " pos" : ""}"${bonusNote}>${pts}</b>`;
    return `<tr><td>M${escapeHtml(String(m.match))}</td><td>${escapeHtml(rr.displayA||"")}</td><td><b>${p.goalsA}×${p.goalsB}</b></td><td>${escapeHtml(rr.displayB||"")}</td><td>${escapeHtml(w||"")}</td><td>${escapeHtml(realScore)}</td><td style="text-align:center">${ptsCell}</td></tr>`;
  }).join("");
  // Same count used for the standings tiebreaker — lets people see why they're
  // ranked above/below a tied entry without having to do the math themselves.
  const exactCount = exactMatchCount(entry, s);
  const pod = isPastCutoff() ? finalPodiumForEntry(entry) : {};
  const podHtml = (pod.champion || pod.runnerUp || pod.third)
    ? `<div class="picks-podium">
        ${pod.champion ? `<span>🥇 ${escapeHtml(pod.champion)}</span>` : ""}
        ${pod.runnerUp ? `<span>🥈 ${escapeHtml(pod.runnerUp)}</span>` : ""}
        ${pod.third    ? `<span>🥉 ${escapeHtml(pod.third)}</span>`    : ""}
      </div>` : "";
  return `<table><thead><tr><th>${escapeHtml(t("receiptGame"))}</th><th>${escapeHtml(t("receiptTeamA"))}</th><th>${escapeHtml(t("receiptScore"))}</th><th>${escapeHtml(t("receiptTeamB"))}</th><th>${escapeHtml(t("receiptWinner"))}</th><th>${escapeHtml(t("pickRealLabel"))}</th><th>${escapeHtml(t("pickPointsLabel"))}</th></tr></thead><tbody>${rows}</tbody></table>
<p class="footer-note" style="margin-top:8px">🎯 ${escapeHtml(t("pickExactCount").replace("{n}", exactCount))}</p>${podHtml}`;
}

function renderParticipants() {
  const s = state(), box = $("#participantsList");
  if (!box) return;
  if (!s.entries.length) { box.innerHTML = `<div class="card"><p>${escapeHtml(t("noEntries"))}</p></div>`; return; }
  box.innerHTML = "";
  for (const e of s.entries) {
    const div = document.createElement("div");
    div.className = "rank-row participant-row";
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
  const savedPlaysScroll = captureLivePlaysScroll(box);
  box.innerHTML = "";
  const s = state();
  const knockoutIds = new Set(DATA.knockoutMatches.map(km => String(km.match)));
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  // Same data.js slot-resolution gap as mapEspnToLiveScores — without it,
  // the Jogos tab shows the raw "Winner Match N" placeholder for M95+
  // instead of the real team name once it's known.
  const { winners: gameWinners, losers: gameLosers } = officialWinnersMap(s);
  for (const m of all) {
    const r = (s.results || {})[m.match];
    const live = r?.goalsA === undefined ? _liveScores[m.match] : null;
    const goalsA = r?.goalsA !== undefined ? r.goalsA : (live ? live.goalsA : m.goalsA);
    const goalsB = r?.goalsB !== undefined ? r.goalsB : (live ? live.goalsB : m.goalsB);
    const status = r?.goalsA !== undefined ? "Final" : (live ? "Live" : m.status);
    const hasScore = goalsA !== null && goalsA !== undefined && goalsB !== null && goalsB !== undefined;
    const venue = m.venue && m.venue !== "A confirmar" ? m.venue : "";
    const a = resolveSlot(m.teamA, gameWinners, gameLosers) || "";
    const b = resolveSlot(m.teamB, gameWinners, gameLosers) || "";
    const statusClass = status === "Final" ? "done" : status === "Live" ? "live" : "pending";
    const statusLabel = status === "Final" ? t("gameFinal") : status === "Live" ? t("gameLive") : t("gamePending");
    const canShowLivePoints = live && knockoutIds.has(String(m.match));

    // Compute per-match probability hint (upcoming) or in-play bars (live)
    let probBarsHtml = "";
    if (live) {
      probBarsHtml = liveProbBarsHtml(m, live);
    } else if (status !== "Final") {
      probBarsHtml = preMatchProbBarsHtml(m);
    }

    // Phase 7-FIX canonical game-card skeleton (docs/bolao/CANONICAL_GAME_CARD_SKELETON.md):
    // __header (competition label + status) → __metadata (date/time/venue, always separate
    // elements) → __match (team--home / center-score / team--away) → __extension (optional:
    // goal scorers, live plays, probability bars, live-points toggle). Same data/values as
    // before this change — only the element classes/nesting changed, verified by diffing this
    // function's inputs/outputs before and after.
    const extensionHtml = [
      live ? goalScorersHtml(live, a, b) : "",
      live ? livePlaysHtml(live, a, b, m.match) : "",
      probBarsHtml,
      canShowLivePoints ? `<button type="button" class="secondary small-btn" style="margin-top:10px" data-live-toggle="${escapeHtml(String(m.match))}">${escapeHtml(t("liveToggleShow"))}</button>` : "",
    ].join("");

    const div = document.createElement("div");
    div.className = `game-card${live ? " is-live" : ""}`;
    div.dataset.state = live ? "in" : (hasScore ? "post" : "pre");
    div.innerHTML = `
<div class="game-card__header">
  <span class="game-card__competition"><span class="match-badge">${escapeHtml(String(m.match))}</span> <span class="muted">${escapeHtml(phaseLabel(m.phase || "Fase de grupos"))}${m.group ? ` — ${escapeHtml(t("groupLabel"))} ${escapeHtml(m.group)}` : ""}</span></span>
  <span class="game-card__status status-chip ${statusClass}">${live ? "🔴 " : ""}${escapeHtml(statusLabel)}${live?.clock ? ` · ${escapeHtml(live.clock)}` : ""}</span>
</div>
<div class="game-card__metadata">
  ${m.date  ? `<span class="game-card__date pill">📅 ${escapeHtml(formatDate(m.date))}</span>` : ""}
  ${m.timeET ? `<span class="game-card__time pill">🕒 ${escapeHtml(m.timeET)} · ${escapeHtml(brtTimeFromKickoff(m.date, m.timeET))} BRT</span>` : ""}
  ${venue   ? `<span class="game-card__venue pill">📍 ${escapeHtml(venue)}</span>` : ""}
</div>
<div class="game-card__match">
  <div class="game-card__team game-card__team--home"><span class="game-card__team-name">${escapeHtml(a)}</span><span class="game-card__logo">${escapeHtml(flag(a))}</span></div>
  <div class="game-card__center">${hasScore ? `<span class="game-card__score${live ? " is-live" : ""}">${goalsA} — ${goalsB}</span>` : `<span class="game-card__score muted">×</span>`}</div>
  <div class="game-card__team game-card__team--away"><span class="game-card__logo">${escapeHtml(flag(b))}</span><span class="game-card__team-name">${escapeHtml(b)}</span></div>
</div>
<div class="game-card__extension">${extensionHtml}</div>`;
    box.appendChild(div);
    if (canShowLivePoints) {
      const detail = document.createElement("div");
      detail.className = `card picks-detail${_openLiveDetails.has(String(m.match)) ? "" : " hidden"}`;
      detail.dataset.liveDetail = String(m.match);
      detail.innerHTML = liveMatchPointsTable(m.match, live.goalsA, live.goalsB);
      box.appendChild(detail);
    }
  }
  restoreLivePlaysScroll(box, savedPlaysScroll);
}

function renderRules() {
  const box = $("#rulesContent");
  if (!box) return;
  const SC = CONFIG.scoring, BN = CONFIG.bonus;
  // data-visual-audit="card-base"/"rules-heading" (PR120-final review item 3): stable,
  // unambiguous selectors for bolao/scripts/audit_visual_consistency.mjs — this card/heading is
  // the same structural component in all three apps (a plain .card wrapping the scoring-rules
  // table), unlike a bare ".card"/"h3" selector which picks the FIRST match in DOM order and can
  // land on a structurally different element per app (e.g. Copa's entry-form card has its own
  // simulator grid layout). Purely additive — no CSS/behavior keys off this attribute.
  box.innerHTML = `
<div class="card" data-visual-audit="card-base">
  <h3 data-visual-audit="rules-heading">${escapeHtml(t("rulesScoringTitle"))}</h3>
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
    <li>${escapeHtml(t("rulesStandingsTie"))}</li>
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
  renderAdminAuditLog(s);
}

function renderAdminAuditLog(s) {
  const box = $("#adminAuditLog");
  if (!box) return;
  const log = Array.isArray(s.auditLog) ? s.auditLog : [];
  box.innerHTML = `<h3>${escapeHtml(t("auditLogTitle"))}</h3>`;
  if (!log.length) { box.innerHTML += `<p class="muted">${escapeHtml(t("auditLogEmpty"))}</p>`; return; }
  const fmtPick = p => p
    ? `${escapeHtml(String(p.goalsA))}×${escapeHtml(String(p.goalsB))} (${escapeHtml(p.advanceSide === "A" ? (p.displayA || "A") : (p.displayB || "B"))})`
    : "—";
  const rows = log.slice(0, 100).map(entry => {
    const ts = new Date(entry.ts).toLocaleString("pt-BR", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
    const changesHtml = (entry.changes || []).map(c =>
      `<li>M${escapeHtml(String(c.match))}: <span class="muted">${fmtPick(c.before)}</span> → <b>${fmtPick(c.after)}</b></li>`
    ).join("");
    const ipLine  = entry.ip && entry.ip !== "unknown" ? escapeHtml(entry.ip) : "IP desconhecido";
    const uaShort = entry.userAgent ? escapeHtml(entry.userAgent.slice(0, 80)) : "—";
    const scr     = entry.screen ? ` · ${escapeHtml(entry.screen)}` : "";
    return `<div class="audit-row">
      <div class="audit-meta">
        <span class="muted" style="font-size:11px">${escapeHtml(ts)} ET</span>
        <b>${escapeHtml(entry.entryName)}</b>
        <span class="muted" style="font-size:12px">${escapeHtml(entry.email)}</span>
      </div>
      <div style="font-size:11px;color:#667;margin-top:2px">🌐 ${ipLine}${scr}</div>
      <div style="font-size:10px;color:#555;word-break:break-all;margin-top:1px">📱 ${uaShort}</div>
      ${entry.changeCount
        ? `<ul class="audit-changes">${changesHtml}</ul>`
        : `<span class="muted" style="font-size:12px">(apenas dados pessoais)</span>`}
    </div>`;
  }).join("");
  box.innerHTML += rows;
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
    div.className = "rank-row participant-row";
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

// Bug real encontrado em auditoria (2026-07-14): renderAdminResultsManual() reconstrói o painel
// inteiro (todos os inputs de placar real) toda vez que renderAdmin() roda, inclusive no resync
// de 30s -- commitRealResult() só grava no estado quando os DOIS campos (gols A e gols B) já
// estão preenchidos, então um admin digitando o primeiro gol de uma partida podia ter esse valor
// apagado por um resync que chegasse antes do segundo. Mesmo princípio do pickFormIsDirty() já
// usado no formulário de palpite do participante, aplicado aqui pela primeira vez.
function resultsFormIsDirty() {
  const box = document.getElementById("resultsAdmin");
  if (!box) return false;
  const s = state();
  return [...box.querySelectorAll(".match-card")].some(card => {
    const mid = card.dataset.realMatch;
    const r = (s.results || {})[mid] || {};
    const ga = card.querySelector('[data-real-field="goalsA"]')?.value ?? "";
    const gb = card.querySelector('[data-real-field="goalsB"]')?.value ?? "";
    const savedGa = r.goalsA !== undefined && r.goalsA !== null ? String(r.goalsA) : "";
    const savedGb = r.goalsB !== undefined && r.goalsB !== null ? String(r.goalsB) : "";
    return ga !== savedGa || gb !== savedGb;
  });
}
function renderAdminResults(s) {
  if (resultsFormIsDirty()) return;
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
  <div class="team"><span class="team-flag">${flag(a)}</span><span class="team-name">${escapeHtml(a)}</span></div>
  <div class="vs">×</div>
  <div class="team right"><span class="team-name">${escapeHtml(b)}</span><span class="team-flag">${flag(b)}</span></div>
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
function csvEscape(v) {
  let s = String(v ?? "");
  // CSV/formula injection: a cell starting with =, +, -, @ (or tab/CR) can be read as a formula
  // by Excel/Sheets when the exported file is opened — prefix with an apostrophe so it's always
  // literal text. Real risk here: entryName/payerName are free text fully controlled by whoever
  // submits the entry form.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
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

/* ============================================================
   Monte Carlo / Probabilidades
   ============================================================ */
let _mcResult    = null;
let _mcTs        = 0;
let _copaEloCache = null;
const _lambdaCache = new Map();
let _polyCache   = null; // { data: {TeamName: prob}, ts }

// Maps Polymarket team names → our canonical names (data.js / knockoutMatches)
const POLY_ALIASES = {
  "USA":                       "United States",
  "Cote d'Ivoire":             "Ivory Coast",
  "Côte d'Ivoire":             "Ivory Coast",
  "Cabo Verde":                "Cape Verde",
  "Bosnia-Herzegovina":        "Bosnia and Herzegovina",
  "Bosnia & Herzegovina":      "Bosnia and Herzegovina",
  "Congo DR":                  "DR Congo",
  "DRC":                       "DR Congo",
  "Korea Republic":            "South Korea",
  "South Korea":               "South Korea",
};

async function fetchPolymarketOdds() {
  const ttlMs = (CONFIG.externalData?.polymarket?.cacheMinutes ?? 60) * 60000;
  if (_polyCache && Date.now() - _polyCache.ts < ttlMs) return _polyCache.data;
  if (!CONFIG.externalData?.polymarket?.enabled) return null;
  try {
    // Event 30615 = "World Cup Winner" — each market is a single-team Yes/No binary
    const res  = await fetch("https://gamma-api.polymarket.com/events/30615");
    const ev   = await res.json();
    const data = {};
    for (const m of (ev.markets || [])) {
      const outcomes = JSON.parse(m.outcomes || "[]");
      const prices   = JSON.parse(m.outcomePrices || "[]");
      if (outcomes[0] !== "Yes" || !prices[0]) continue;
      const q = (m.question || "");
      // "Will France win the 2026 FIFA World Cup?" → "France"
      const match = q.match(/Will (.+?) win the 2026/i);
      if (!match) continue;
      const raw  = match[1].trim();
      const team = POLY_ALIASES[raw] ?? raw;
      data[team] = parseFloat(prices[0]);
    }
    _polyCache = { data, ts: Date.now() };
    return data;
  } catch (err) {
    console.warn("Polymarket fetch failed:", err);
    return _polyCache?.data ?? null;
  }
}

function poisson(lambda, k) {
  if (k < 0 || lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// Compute ELO ratings from all Copa 2026 results (group stage + knockout).
// Initialised from DATA.strength ratings; each match updates both teams.
// Cached per page-load; cleared in recalcMC() when new results are saved.
function buildCopaELO() {
  if (_copaEloCache) return _copaEloCache;
  const K = 40;
  const elo = {};
  // Seed from pre-tournament strength ratings
  Object.entries(DATA.strength || {}).forEach(([name, s]) => {
    elo[name] = 1500 + (s - 70) * 10;
  });
  const update = (tA, tB, gA, gB) => {
    if (!elo[tA]) elo[tA] = 1500;
    if (!elo[tB]) elo[tB] = 1500;
    const sA = gA > gB ? 1 : gA === gB ? 0.5 : 0;
    const gdMult = 1 + Math.log1p(Math.abs(gA - gB)) * 0.3;
    const eA = 1 / (1 + Math.pow(10, (elo[tB] - elo[tA]) / 400));
    elo[tA] += K * gdMult * (sA - eA);
    elo[tB] += K * gdMult * ((1 - sA) - (1 - eA));
  };
  // Group stage (all 72 matches already have scores in DATA.groupMatches)
  (DATA.groupMatches || []).forEach(m => {
    if (m.status === "Final" && m.goalsA != null) update(m.teamA, m.teamB, m.goalsA, m.goalsB);
  });
  // Knockout: iterate in match order so slot resolution is correct
  const winners = {}, losers = {};
  const s = state();
  for (const m of DATA.knockoutMatches) {
    const r = resolvedMatchResult(m, s);
    const tA = resolveSlot(m.teamA, winners, losers);
    const tB = resolveSlot(m.teamB, winners, losers);
    if (r?.advanceSide) {
      if (!(/Winner|Loser/i.test(tA) || /Winner|Loser/i.test(tB))) {
        const gA = r.goalsA ?? (r.advanceSide === "A" ? 1 : 0);
        const gB = r.goalsB ?? (r.advanceSide === "B" ? 1 : 0);
        update(tA, tB, gA, gB);
      }
      if (r.advanceSide === "A") { winners[m.match] = tA; losers[m.match] = tB; }
      else { winners[m.match] = tB; losers[m.match] = tA; }
    }
  }
  _copaEloCache = elo;
  return elo;
}

// Compute Poisson lambdas from ELO ratings via bisection — ensures our
// bivariate Poisson win probability exactly matches the ELO prediction.
function copaExpectedGoals(teamA, teamB) {
  const key = `λ|${teamA}|${teamB}`;
  if (_lambdaCache.has(key)) return _lambdaCache.get(key);
  const TOTAL = 2.4;
  const elo  = buildCopaELO();
  const eloA = elo[teamA] ?? (1500 + (teamStrength(teamA) - 70) * 10);
  const eloB = elo[teamB] ?? (1500 + (teamStrength(teamB) - 70) * 10);
  const pWinA = 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  let lo = 0.1, hi = TOTAL - 0.1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (matchProb(mid, TOTAL - mid).pA < pWinA) lo = mid; else hi = mid;
  }
  const lambdaA = (lo + hi) / 2;
  const result = { lambdaA, lambdaB: TOTAL - lambdaA };
  _lambdaCache.set(key, result);
  return result;
}

// Dixon-Coles (1997) low-score correction — adjusts overestimated 0-0/1-0/0-1/1-1 cells.
function tauDC(x, y, lA, lB, rho) {
  if (x === 0 && y === 0) return 1 - lA * lB * rho;
  if (x === 0 && y === 1) return 1 + lA * rho;
  if (x === 1 && y === 0) return 1 + lB * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function matchProb(lambdaA, lambdaB) {
  const MAX = 8, RHO = -0.13;
  let pA = 0, pD = 0, pB = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poisson(lambdaA, i) * poisson(lambdaB, j) * tauDC(i, j, lambdaA, lambdaB, RHO);
      if (i > j) pA += p;
      else if (i === j) pD += p;
      else pB += p;
    }
  }
  const sum = pA + pD + pB || 1;
  return { pA: pA / sum, pD: pD / sum, pB: pB / sum };
}

function knockoutWinnerProb(lambdaA, lambdaB) {
  const { pA, pD, pB } = matchProb(lambdaA, lambdaB);
  const penA = (lambdaA + lambdaB) > 0 ? 0.45 + 0.1 * (lambdaA / (lambdaA + lambdaB)) : 0.5;
  return { pWinA: pA + pD * penA, pWinB: pB + pD * (1 - penA) };
}

function inPlayProb(lambdaA, lambdaB, minuteElapsed, goalsA, goalsB) {
  const timeRem = Math.max(0, 90 - minuteElapsed) / 90;
  const laRem = lambdaA * timeRem;
  const lbRem = lambdaB * timeRem;
  const MAX = 8;
  let pA = 0, pD = 0, pB = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poisson(laRem, i) * poisson(lbRem, j);
      const totA = goalsA + i, totB = goalsB + j;
      if (totA > totB) pA += p;
      else if (totA === totB) pD += p;
      else pB += p;
    }
  }
  const sum = pA + pD + pB || 1;
  return { pA: pA / sum, pD: pD / sum, pB: pB / sum };
}

function parseMinute(clockStr) {
  if (!clockStr) return -1;
  const m = String(clockStr).match(/^(\d+)/);
  return m ? Math.min(parseInt(m[1], 10), 90) : 0;
}

function probBarsMarkup(pA, pD, pB, a, b, drawLabel) {
  const sA = escapeHtml(a.length > 12 ? a.slice(0, 12) + "…" : a);
  const sB = escapeHtml(b.length > 12 ? b.slice(0, 12) + "…" : b);
  const pH = Math.round(pA * 100), pDr = Math.round(pD * 100), pAw = Math.round(pB * 100);
  // A narrow slice can't fit "Team NN%" without spilling out of its own bar —
  // below this threshold, drop just the name and keep the number (the title
  // tooltip still carries the full "Team: NN%" either way).
  const label = (pct, name) => pct >= 12 ? `${name} ${pct}%` : `${pct}%`;
  return `<div class="prob-bars" role="group" aria-label="${escapeHtml(t("probBarsLabel"))}">
  <div class="prob-bar home" style="width:${pH}%" title="${escapeHtml(a)}: ${pH}%">${label(pH, sA)}</div>
  <div class="prob-bar draw"  style="width:${pDr}%" title="${escapeHtml(drawLabel)}: ${pDr}%">${label(pDr, drawLabel)}</div>
  <div class="prob-bar away" style="width:${pAw}%" title="${escapeHtml(b)}: ${pAw}%">${label(pAw, sB)}</div>
</div>`;
}

// Pre-match probability bars for a match that hasn't kicked off yet —
// shared by the Jogos tab's game cards and the hero "próximo jogo" card.
// Static Poisson estimate from each team's strength rating (no live signal
// to blend in yet, unlike liveProbBarsHtml below).
// Derives match-level probabilities from Polymarket's tournament-winner prices.
// Formula: P(A advances) = poly_A / (poly_A + poly_B) — market-consensus normalization.
// For the draw slice (ET/pens): capped at min(22%, 2×min(advA,advB)) so lopsided
// matchups don't allocate absurd draw probabilities. Returns null when prices
// aren't loaded yet or when either team isn't found in the market.
function polyMatchProb(teamA, teamB) {
  const poly = _polyCache?.data;
  if (!poly) return null;
  const lookup = name => {
    if (poly[name] !== undefined) return poly[name];
    const k = Object.keys(poly).find(k2 =>
      k2.toLowerCase() === name.toLowerCase() ||
      name.toLowerCase().includes(k2.toLowerCase()) ||
      k2.toLowerCase().includes(name.toLowerCase())
    );
    return k !== undefined ? poly[k] : null;
  };
  const pA = lookup(teamA), pB = lookup(teamB);
  if (pA === null || pB === null) return null;
  const total = pA + pB;
  if (total < 0.001) return null;
  const advA = pA / total, advB = pB / total;
  // ET/Pens slice: capped so lopsided matchups don't overflow
  const pD  = Math.min(0.22, 2 * Math.min(advA, advB));
  return { pA: advA - pD * 0.5, pD, pB: advB - pD * 0.5, source: "polymarket" };
}

function preMatchProbBarsHtml(m) {
  // data.js keeps "Winner Match N" forever for M95+ — resolve via official
  // results first, or these bars silently stay blank once that's all that's
  // left unresolved (the actual matches, once decided, are real team names).
  const { winners: probWinners, losers: probLosers } = officialWinnersMap(state());
  const a = resolveSlot(m.teamA, probWinners, probLosers) || "";
  const b = resolveSlot(m.teamB, probWinners, probLosers) || "";
  if (!a || !b || /Winner|Loser/i.test(a) || /Winner|Loser/i.test(b)) return "";
  const drawLabel = m.group ? t("probDrawShort") : "ET/Pen.";
  // Priority 1: ESPN/DraftKings moneyline — sharpest, already in the poll payload
  const ek = _espnOddsCache.get(String(m.match));
  if (ek) return probBarsMarkup(ek.pA, ek.pD, ek.pB, a, b, drawLabel);
  // Priority 2: Polymarket tournament-odds normalization (knockout only)
  if (!m.group) {
    const poly = polyMatchProb(a, b);
    if (poly) return probBarsMarkup(poly.pA, poly.pD, poly.pB, a, b, drawLabel);
  }
  // Priority 3: ELO + Poisson model
  const { lambdaA, lambdaB } = copaExpectedGoals(a, b);
  const { pA, pD, pB } = matchProb(lambdaA, lambdaB);
  return probBarsMarkup(pA, pD, pB, a, b, drawLabel);
}

// In-play probability bars for a match currently live — shared by the Jogos
// tab's game cards and the hero "ao vivo" card, so both always show the same
// number computed the same way.
function liveProbBarsHtml(m, live) {
  const { winners: probWinners, losers: probLosers } = officialWinnersMap(state());
  const a = resolveSlot(m.teamA, probWinners, probLosers) || "";
  const b = resolveSlot(m.teamB, probWinners, probLosers) || "";
  if (!a || !b || /Winner|Loser/i.test(a) || /Winner|Loser/i.test(b)) return "";
  // Derive minute from the raw clockSeconds, not the display string — the
  // string can now read "(+2)" mid-stoppage or "Intervalo" at halftime,
  // neither of which parseMinute's leading-digit regex should have to
  // handle correctly on our behalf.
  const minute = live.clockSeconds != null
    ? Math.min(Math.floor(live.clockSeconds / 60), 90)
    : parseMinute(live.clock);
  const isTied = live.goalsA === live.goalsB;
  if (minute < 0 || (minute >= 90 && isTied && !m.group)) return "";
  const drawLabel = m.group ? t("probDrawShort") : "ET/Pen.";
  // Prefer ESPN's own win-probability model when a poll successfully fetched
  // it for this match; otherwise fall back to the site's Poisson estimate.
  const espnProb = _espnProbCache.get(m.match);
  if (espnProb) return probBarsMarkup(espnProb.pA, espnProb.pD, espnProb.pB, a, b, drawLabel);
  const base = copaExpectedGoals(a, b);
  // ESPN's real win-probability isn't in — sharpen our own estimate with
  // match stats (shots on target / possession) if we managed to fetch them,
  // instead of relying purely on the static pre-match strength rating.
  const { lambdaA, lambdaB } = statsAdjustedLambdas(base.lambdaA, base.lambdaB, _espnStatsCache.get(m.match));
  const ip = inPlayProb(lambdaA, lambdaB, minute, live.goalsA, live.goalsB);
  return probBarsMarkup(ip.pA, ip.pD, ip.pB, a, b, drawLabel);
}

// Goal-scorer + minute list for a live match (Google/ESPN scoreboard style),
// shared by the hero live card and the Jogos tab's game cards. Split into two
// columns under each team's own side (left = team A, right = team B) — same
// left/right convention as the team names/flags above it — so which team
// scored is obvious from position alone, no per-row flag needed. Silently
// renders nothing if ESPN didn't return scoring-play detail for this match.
function goalScorersHtml(live, tA, tB) {
  const scorers = live?.scorers;
  if (!Array.isArray(scorers) || !scorers.length) return "";
  const rowHtml = g => `<div class="goal-scorer-row">
        <span class="goal-scorer-name">${escapeHtml(g.scorer || "")}</span>
        <span class="goal-scorer-minute">${escapeHtml(g.minute || "")}</span>
      </div>`;
  const withText = g => g.scorer || g.minute;
  const leftRows = scorers.filter(g => g.side === "A" && withText(g)).map(rowHtml);
  const rightRows = scorers.filter(g => g.side === "B" && withText(g)).map(rowHtml);
  if (!leftRows.length && !rightRows.length) return "";
  return `<div class="goal-scorers">
    <div class="goal-scorer-col left">${leftRows.join("")}</div>
    <div class="goal-scorer-col right">${rightRows.join("")}</div>
  </div>`;
}

// One row per play (goal/card/sub), newest first, single scrollable column
// (unlike goalScorersHtml's two side-by-side columns) — box height is
// capped in CSS to ~3 rows so it can't grow the card indefinitely; more
// plays scroll inside their own box instead of pushing page content down.
// data-plays-match lets the caller restore this box's scrollTop across a
// full innerHTML rebuild (see preserveLivePlaysScroll) — without it, the
// running-clock tick (every 1s) recreates this element fresh each time and
// silently resets any scroll position the user just set.
const PLAY_ICON = { goal: "⚽", yellow: "🟨", red: "🟥", sub: "🔄" };
function livePlaysHtml(live, tA, tB, mid) {
  const plays = live?.plays;
  if (!Array.isArray(plays) || !plays.length) return "";
  const rows = [...plays].reverse().map(p => `<div class="live-plays-row">
    <span class="live-plays-minute">${escapeHtml(p.minute || "")}</span>
    <span class="live-plays-icon" aria-hidden="true">${PLAY_ICON[p.kind] || "•"}</span>
    <span class="live-plays-flag">${escapeHtml(flag(p.side === "A" ? tA : tB))}</span>
    <span class="live-plays-text">${escapeHtml(p.text || "")}</span>
  </div>`).join("");
  if (!rows) return "";
  return `<div class="live-plays" data-plays-match="${escapeHtml(String(mid ?? ""))}">${rows}</div>`;
}

// A full innerHTML rebuild (renderNextMatch's 1s clock tick, renderGames'
// periodic re-render) creates every .live-plays box fresh, wiping its
// scrollTop back to 0 — mid-scroll, that reads as the box "snapping back up"
// on its own. Call before mutating innerHTML and after, around the same
// root element, to carry each box's scroll position across the rebuild.
function captureLivePlaysScroll(root) {
  const saved = {};
  root?.querySelectorAll?.(".live-plays[data-plays-match]").forEach(el => {
    if (el.scrollTop > 0) saved[el.dataset.playsMatch] = el.scrollTop;
  });
  return saved;
}
function restoreLivePlaysScroll(root, saved) {
  if (!saved || !Object.keys(saved).length) return;
  root?.querySelectorAll?.(".live-plays[data-plays-match]").forEach(el => {
    const s = saved[el.dataset.playsMatch];
    if (s) el.scrollTop = s;
  });
}

// Cache pWinA for each ordered team pair to avoid recomputing Poisson for
// identical match-ups across the 2000 simulation iterations.
const _winProbCache = new Map();
function cachedKnockoutProb(nameA, nameB) {
  const key = `${nameA}|${nameB}`;
  if (_winProbCache.has(key)) return _winProbCache.get(key);
  const { lambdaA, lambdaB } = copaExpectedGoals(nameA, nameB);
  const { pWinA } = knockoutWinnerProb(lambdaA, lambdaB);
  _winProbCache.set(key, pWinA);
  return pWinA;
}

function runMonteCarlo(N) {
  N = N || 2000;
  const s = state();

  // Build initial winners/losers from all already-finalized matches
  const baseWinners = {}, baseLosers = {};
  for (const m of DATA.knockoutMatches) {
    const r = resolvedMatchResult(m, s);
    const a = resolveSlot(m.teamA, baseWinners, baseLosers);
    const b = resolveSlot(m.teamB, baseWinners, baseLosers);
    if (r?.advanceSide === "A") { baseWinners[m.match] = a; baseLosers[m.match] = b; }
    else if (r?.advanceSide === "B") { baseWinners[m.match] = b; baseLosers[m.match] = a; }
  }

  // Check that at least the first R32 match has known participants
  const hasAnyTeam = DATA.knockoutMatches.some(m => {
    const a = resolveSlot(m.teamA, baseWinners, baseLosers);
    return a && !/Winner|Loser/i.test(a);
  });
  if (!hasAnyTeam) return null;

  const champCount = {}, finalCount = {}, semiCount = {};

  for (let iter = 0; iter < N; iter++) {
    // Copy known results; unplayed matches will be filled in below
    const winners = Object.assign({}, baseWinners);
    const losers  = Object.assign({}, baseLosers);

    for (const m of DATA.knockoutMatches) {
      // Skip if result is already known
      const r = resolvedMatchResult(m, s);
      if (r?.advanceSide) continue;

      const a = resolveSlot(m.teamA, winners, losers);
      const b = resolveSlot(m.teamB, winners, losers);

      // Safety: if either team is still an unresolved placeholder, skip
      if (!a || !b || /Winner|Loser/i.test(a) || /Winner|Loser/i.test(b)) continue;

      const pWinA = cachedKnockoutProb(a, b);
      const aWins = Math.random() < pWinA;
      winners[m.match] = aWins ? a : b;
      losers[m.match]  = aWins ? b : a;
    }

    // Champion = winner of match 104 (the Final)
    const champ = winners["104"];
    if (champ) champCount[champ] = (champCount[champ] || 0) + 1;

    // Finalists = both participants in match 104
    if (champ) finalCount[champ] = (finalCount[champ] || 0) + 1;
    const runnerUp = losers["104"];
    if (runnerUp) finalCount[runnerUp] = (finalCount[runnerUp] || 0) + 1;

    // Semi-finalists = all 4 participants in matches 101 and 102
    for (const sfId of ["101", "102"]) {
      const w = winners[sfId], l = losers[sfId];
      if (w) semiCount[w] = (semiCount[w] || 0) + 1;
      if (l) semiCount[l] = (semiCount[l] || 0) + 1;
    }
  }

  return { champCount, finalCount, semiCount, N, ts: Date.now() };
}

const MC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between automatic recalcs
let _mcPending = false;

function scheduleMC() {
  const now = Date.now();
  if (_mcResult && now - _mcTs < MC_INTERVAL_MS) { renderProbs(); return; }
  if (_mcPending) return;
  _mcPending = true;
  const box = $("#probsContent");
  if (box) box.innerHTML = `<p class="muted">${escapeHtml(t("probsLoading"))}</p>`;
  _mcTs = now;
  // Run MC sync then fetch Polymarket async — both trigger a re-render
  setTimeout(async () => {
    try {
      const result = runMonteCarlo(2000);
      _mcResult = result;
    } catch (err) {
      console.warn("MC simulation failed", err);
      _mcResult = null;
    }
    _mcPending = false;
    renderProbs();
    // Fetch Polymarket in background; re-render once data arrives
    const poly = await fetchPolymarketOdds();
    if (poly) renderProbs();
  }, 0);
}

function recalcMC() {
  _mcResult = null;
  _mcTs = 0;
  _winProbCache.clear();
  _lambdaCache.clear();
  _copaEloCache = null;
  scheduleMC();
}

// Once M103 is decided but M104 (Final) is not, models the bolão's own money outcome under both
// possible Final winners, weighted by live market odds (Polymarket) for those two teams --
// reuses finalPodiumPayouts() itself (already validated all session) against two minimal, neutral
// placeholder scorelines (1-0 / 0-1) so the modeling is driven only by WHO WINS the Final, never a
// guessed final score. Eduardo, 2026-07-19: wanted the probability of winning the whole bolão
// shown, not just team-level World Cup odds ("probabilities of somebody winning the full part").
function computeMoneyProbabilities(s) {
  const fin = DATA.knockoutMatches.find(m => m.match === "104");
  if (!fin) return null;
  if (s.results?.["104"]?.advanceSide) return null; // already decided -- nothing to model
  const { winners, losers } = officialWinnersMap(s);
  const tA = resolveSlot(fin.teamA, winners, losers), tB = resolveSlot(fin.teamB, winners, losers);
  if (!isRealTeamName(tA) || !isRealTeamName(tB)) return null; // semifinals not both decided yet

  const poly = _polyCache?.data;
  let pA = 0.5, pB = 0.5;
  if (poly) {
    const rawA = poly[tA] ?? 0, rawB = poly[tB] ?? 0;
    const sum = rawA + rawB;
    if (sum > 0) { pA = rawA / sum; pB = rawB / sum; }
  }

  const withResult = side => {
    const clone = JSON.parse(JSON.stringify(s));
    clone.results = clone.results || {};
    clone.results["104"] = side === "A" ? { goalsA: 1, goalsB: 0, advanceSide: "A" } : { goalsA: 0, goalsB: 1, advanceSide: "B" };
    return clone;
  };
  const payoutsA = finalPodiumPayouts(withResult("A"));
  const payoutsB = finalPodiumPayouts(withResult("B"));
  if (!payoutsA || !payoutsB) return null;

  const byIdA = {}, byIdB = {};
  payoutsA.payouts.forEach(p => { byIdA[p.id] = p; });
  payoutsB.payouts.forEach(p => { byIdB[p.id] = p; });

  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id) && !e.diagnostics?.demo);
  const rows = entries.map(e => {
    const inA = byIdA[e.id], inB = byIdB[e.id];
    const pMoney = (inA ? pA : 0) + (inB ? pB : 0);
    const expected = (inA ? pA * inA.amount : 0) + (inB ? pB * inB.amount : 0);
    return { id: e.id, entryName: e.entryName, pMoney, expected };
  }).filter(r => r.pMoney > 0.001);
  rows.sort((a, b) => b.expected - a.expected);
  return { teamA: tA, teamB: tB, pA, pB, pot: payoutsA.pot, rows };
}

function moneyProbHtml(info) {
  if (!info || !info.rows.length) return "";
  const rows = info.rows.map(r => {
    const pct = Math.round(r.pMoney * 100);
    return `<tr>
      <td>${escapeHtml(r.entryName)}</td>
      <td class="prob-pct-champ">${pct}%</td>
      <td>${window.BOLAO_MONEY.usd(r.expected)}</td>
    </tr>`;
  }).join("");
  const subtitle = t("moneyProbSubtitle")
    .replace("{teamA}", info.teamA).replace("{pA}", Math.round(info.pA * 100))
    .replace("{teamB}", info.teamB).replace("{pB}", Math.round(info.pB * 100));
  return `<div class="card money-prob-card">
    <h3>${escapeHtml(t("moneyProbTitle"))}</h3>
    <p class="muted" style="font-size:12px;margin-bottom:10px">${escapeHtml(subtitle)}</p>
    <table class="prob-table">
      <thead><tr><th>${escapeHtml(t("moneyProbEntry"))}</th><th>${escapeHtml(t("moneyProbChance"))}</th><th>${escapeHtml(t("moneyProbExpected"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="prob-disclaimer">${escapeHtml(t("moneyProbDisclaimer"))}</p>
  </div>`;
}

function renderProbs() {
  const box = $("#probsContent");
  if (!box) return;

  if (!_mcResult) {
    box.innerHTML = `<p class="muted">${escapeHtml(t("probsNoData"))}</p>
<div class="button-row" style="margin-top:14px">
  <button type="button" data-action="recalcMC">${escapeHtml(t("probsRefresh"))}</button>
</div>`;
    return;
  }

  const { champCount, finalCount, semiCount, N, ts } = _mcResult;
  const poly = _polyCache?.data ?? null;

  // Build set of teams definitively eliminated by saved results.
  // Polymarket is slow to update — without this, eliminated teams can appear
  // with non-zero Polymarket odds even after losing their match.
  const eliminated = new Set();
  {
    const ew = {}, el = {};
    for (const m of DATA.knockoutMatches) {
      const r = resolvedMatchResult(m, state());
      const a = resolveSlot(m.teamA, ew, el);
      const b = resolveSlot(m.teamB, ew, el);
      if (r?.advanceSide === "A") {
        ew[m.match] = a; el[m.match] = b;
        if (b && !/Winner|Loser/i.test(b)) eliminated.add(b);
      } else if (r?.advanceSide === "B") {
        ew[m.match] = b; el[m.match] = a;
        if (a && !/Winner|Loser/i.test(a)) eliminated.add(a);
      }
    }
  }

  // Merge MC teams + any Polymarket team still in tournament (price > 0.005)
  const allTeams = new Set([
    ...Object.keys(champCount),
    ...Object.keys(finalCount),
    ...Object.keys(semiCount),
    ...(poly ? Object.keys(poly).filter(k => poly[k] > 0.005 && !eliminated.has(k)) : [])
  ]);

  const rows = [...allTeams]
    .map(team => {
      // Try to match Polymarket by exact name, then by partial match
      let pPoly = poly ? (poly[team] ?? null) : null;
      if (pPoly === null && poly) {
        const key = Object.keys(poly).find(k =>
          k.toLowerCase() === team.toLowerCase() ||
          team.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(team.toLowerCase())
        );
        if (key) pPoly = poly[key];
      }
      return {
        team,
        pChamp: (champCount[team] || 0) / N,
        pFinal: (finalCount[team] || 0) / N,
        pSemi:  (semiCount[team] || 0) / N,
        pPoly
      };
    })
    .filter(r => !eliminated.has(r.team) && (r.pSemi > 0.001 || (r.pPoly ?? 0) > 0.005))
    .sort((a, b) => {
      // Sort by Polymarket if available, else by MC
      if (poly) return (b.pPoly ?? 0) - (a.pPoly ?? 0) || b.pChamp - a.pChamp;
      return b.pChamp - a.pChamp || b.pFinal - a.pFinal;
    });

  if (!rows.length) {
    box.innerHTML = `<p class="muted">${escapeHtml(t("probsNoData"))}</p>`;
    return;
  }

  const maxChamp = Math.max(...rows.map(r => r.pChamp), 0.01);
  const maxPoly  = poly ? Math.max(...rows.map(r => r.pPoly ?? 0), 0.01) : 0.01;
  const timeStr  = ts
    ? new Date(ts).toLocaleTimeString(currentLang, { hour: "2-digit", minute: "2-digit" })
    : "";
  const lastCalcStr = timeStr ? ` · ${escapeHtml(t("probsLastCalc"))}: ${escapeHtml(timeStr)}` : "";
  const hasEspnOdds = _espnOddsCache.size > 0;
  const polyNote    = poly
    ? ` · <a href="https://polymarket.com/event/world-cup-winner" target="_blank" rel="noopener" style="color:inherit">Polymarket</a> (ao vivo)`
    : ' · <span class="muted">Polymarket carregando…</span>';
  const oddsNote = hasEspnOdds ? ' · Barras: odds DraftKings via ESPN' : '';

  const hasPoly = poly && rows.some(r => r.pPoly !== null);

  const trs = rows.map(r => {
    const champPct = Math.round(r.pChamp * 100);
    const finalPct = Math.round(r.pFinal * 100);
    const semiPct  = Math.round(r.pSemi  * 100);
    const barW     = Math.max(2, Math.round(r.pChamp / maxChamp * 100));
    const polyPct  = r.pPoly !== null ? Math.round(r.pPoly * 100) : null;
    const polyBar  = r.pPoly !== null ? Math.max(2, Math.round(r.pPoly / maxPoly * 100)) : 0;
    const polyCell = hasPoly
      ? (polyPct !== null
          ? `<td><span class="prob-champ-bar poly-bar" style="width:${polyBar}px"></span><span class="prob-pct-champ">${polyPct}%</span></td>`
          : `<td class="muted" style="font-size:11px">—</td>`)
      : "";
    return `<tr>
      <td>${escapeHtml(flag(r.team))} ${escapeHtml(r.team)}</td>
      <td><span class="prob-champ-bar" style="width:${barW}px"></span><span class="prob-pct-champ">${champPct}%</span></td>
      ${polyCell}
      <td class="prob-pct-final">${finalPct}%</td>
      <td class="prob-pct-semi">${semiPct}%</td>
    </tr>`;
  }).join("");

  const polyHeader = hasPoly ? `<th title="Preços ao vivo do Polymarket">📈 Mercado</th>` : "";

  box.innerHTML = `
${moneyProbHtml(computeMoneyProbabilities(state()))}
<p class="muted" style="font-size:12px;margin-bottom:12px">🎲 ${N.toLocaleString()} simulações${lastCalcStr}${polyNote}${oddsNote}</p>
<table class="prob-table">
  <thead><tr>
    <th></th>
    <th title="${escapeHtml(t("probsChamp"))}">${escapeHtml(t("probsChamp"))}</th>
    ${polyHeader}
    <th>${escapeHtml(t("probsFinal"))}</th>
    <th>${escapeHtml(t("probsSemi"))}</th>
  </tr></thead>
  <tbody>${trs}</tbody>
</table>
<div class="button-row" style="margin-top:14px">
  <button type="button" class="secondary" data-action="recalcMC">${escapeHtml(t("probsRefresh"))}</button>
</div>
<p class="prob-disclaimer">${escapeHtml(t("probsDisclaimer"))}</p>`;
}

async function autoFill(mode) {
  if (isPastCutoff()) { showToast(t("closed"), "warn"); return; }
  const filled = $$('[data-field="goalsA"],[data-field="goalsB"]').some(el => el.value !== "");
  if (filled && !confirm(t("overwritePicks"))) return;
  const winners = {}, losers = {};
  const stateResults = state().results || {};
  for (const m of DATA.knockoutMatches) {
    const c = $(`[data-card-match="${m.match}"]`);
    // Resolve slot names before card guard — hidden R32 cards must still propagate.
    const a = resolveSlot(m.teamA, winners, losers);
    const b = resolveSlot(m.teamB, winners, losers);
    if (R32_IDS.has(String(m.match))) {
      // Propagate winner from existing picks (edit mode) or confirmed results, skip fill.
      const p = _editingEntry?.picks?.[m.match];
      const r = stateResults[m.match];
      const side = p?.advanceSide || r?.advanceSide;
      if (side === "A") { winners[m.match] = a; losers[m.match] = b; }
      else if (side === "B") { winners[m.match] = b; losers[m.match] = a; }
      continue;
    }
    if (!c) continue;
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
   Audit log + edit confirmation email
   ============================================================ */
async function fetchClientIp() {
  try {
    const r = await Promise.race([
      fetch("https://api.ipify.org?format=json").then(r => r.json()),
      new Promise((_, rej) => setTimeout(() => rej(), 3000))
    ]);
    return r.ip || "unknown";
  } catch { return "unknown"; }
}

function appendToAuditLog(s, beforeEntry, updatedEntry, changes, ctx = {}) {
  if (!Array.isArray(s.auditLog)) s.auditLog = [];
  const ua = navigator.userAgent || "";
  s.auditLog.unshift({
    ts:          new Date().toISOString(),
    action:      "edit",
    entryId:     beforeEntry.id,
    entryName:   beforeEntry.entryName,
    email:       updatedEntry.participantEmail || beforeEntry.participantEmail || "",
    changeCount: changes.length,
    changes,
    ip:          ctx.ip || "unknown",
    userAgent:   ua,
    platform:    navigator.platform || "",
    screen:      `${screen.width}×${screen.height}`,
    lang:        navigator.language || ""
  });
  if (s.auditLog.length > 200) s.auditLog.length = 200;
}

function buildEditEmailHtml(beforeEntry, updatedEntry, changes) {
  const rc = receiptCode(beforeEntry);
  const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
  const fmtPick = p => p
    ? `${p.goalsA}×${p.goalsB} → ${escapeHtml(p.advanceSide === "A" ? (p.displayA || "A") : (p.displayB || "B"))}`
    : "—";
  const changeRows = changes.map(c => {
    const m = DATA.knockoutMatches.find(x => String(x.match) === String(c.match));
    const label = m ? `M${c.match} · ${escapeHtml(m.phase || m.round || "")}` : `M${c.match}`;
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #2a3a4a">${label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #2a3a4a;color:#aaa">${fmtPick(c.before)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #2a3a4a;color:#6cf">${fmtPick(c.after)}</td>
    </tr>`;
  }).join("");
  const changesHtml = changes.length
    ? `<h3 style="margin-top:20px">Alterações (${changes.length}):</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr>
    <th style="padding:6px 10px;text-align:left;background:#07151c">Jogo</th>
    <th style="padding:6px 10px;text-align:left;background:#07151c">Antes</th>
    <th style="padding:6px 10px;text-align:left;background:#07151c">Depois</th>
  </tr></thead>
  <tbody>${changeRows}</tbody>
</table>`
    : `<p style="color:#aaa">Apenas dados pessoais atualizados (sem alteração de picks).</p>`;
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d1b26;color:#e0e8f0;padding:24px;border-radius:10px">
<h2 style="margin-top:0;color:#6cf">Palpites atualizados ✓</h2>
<p><b>Entrada:</b> ${escapeHtml(beforeEntry.entryName)}</p>
<p><b>Código:</b> <code style="background:#07151c;padding:2px 6px;border-radius:4px">${escapeHtml(rc)}</code></p>
<p><b>Atualizado em:</b> ${escapeHtml(ts)} ET</p>
${changesHtml}
<p style="margin-top:24px;font-size:12px;color:#667">Se não foi você que fez essa alteração, entre em contato com o administrador do bolão.</p>
</div>`;
}

/* ============================================================
   Save entry
   ============================================================ */
async function saveEntry() {
  if (isPastCutoff()) { showToast(t("cutoffClosed"), "warn"); return; }
  if (isR32Window() && !_editingEntry) { showToast(t("r16EditOnly"), "warn"); return; }
  const btn = $("#saveEntry");
  if (btn) { btn.disabled = true; btn.textContent = t("saveInProgress"); }
  try {
    const entry = await readEntryFromForm();
    if (!entry) return;
    const s = state();
    if (_editingEntry) {
      // Edit mode: update existing entry in-place, preserve R32 picks
      const beforeEntry = JSON.parse(JSON.stringify(_editingEntry)); // snapshot for audit/email
      const idx = s.entries.findIndex(e => e.id === _editingEntry.id);
      if (idx === -1) { showToast(t("editCodeNotFound"), "error"); return; }
      const merged = { ...entry.picks };
      for (const mid of Object.keys(_editingEntry.picks || {})) {
        if (R32_IDS.has(mid)) merged[mid] = _editingEntry.picks[mid];
      }
      // Compute diff for audit log and email
      const allMids = new Set([...Object.keys(beforeEntry.picks || {}), ...Object.keys(merged)]);
      const changes = [];
      for (const mid of allMids) {
        const before = beforeEntry.picks?.[mid] ?? null;
        const after  = merged[mid] ?? null;
        if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ match: mid, before, after });
      }
      s.entries[idx] = {
        ..._editingEntry,
        picks: merged,
        // entryName and createdAt are intentionally NOT updated — receiptCode depends on both.
        entryName:          _editingEntry.entryName,
        createdAt:          _editingEntry.createdAt,
        payerName:          entry.payerName,
        participantEmail:   entry.participantEmail,
        paymentMethod:      entry.paymentMethod,
        updatedAt:          new Date().toISOString()
      };
      const updatedEntry = s.entries[idx];
      const clientIp = await fetchClientIp();
      appendToAuditLog(s, beforeEntry, updatedEntry, changes, { ip: clientIp });
      saveState(s);
      sessionStorage.removeItem(DRAFT_KEY);
      // Stay in edit mode — repopulate form from state and keep _editingEntry set.
      loadEntryByCode(receiptCode(updatedEntry));
      renderAll();
      showToast(t("entryUpdated"), "success");
      // Send confirmation email to participant only (fire-and-forget, no admin copy)
      const toEmail = updatedEntry.participantEmail;
      if (isValidEmail(toEmail) && window.emailjs && CONFIG.emailjs?.enabled) {
        const html = buildEditEmailHtml(beforeEntry, updatedEntry, changes);
        const subject = `Palpites atualizados — ${emailSubjectSafe(beforeEntry.entryName)}`;
        emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.participantTemplateId,
          { to_email: toEmail, entry_name: subject, receipt_code: receiptCode(beforeEntry), html_message: html },
          { publicKey: CONFIG.emailjs.publicKey }
        ).then(() => showToast(t("editConfirmSent").replace("{email}", toEmail), "info", 5000))
         .catch(err => console.warn("Edit confirmation email failed", err));
      }
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
    if (btn) { btn.disabled = isPastCutoff() || (isR32Window() && !_editingEntry); btn.textContent = _editingEntry ? t("editSaveBtn") : t("saveEntry"); }
  }
}

/* ============================================================
   Admin actions
   ============================================================ */
async function adminLogin() {
  const lock = Number(sessionStorage.getItem("adminLockUntil") || "0");
  if (Date.now() < lock) { showToast(t("adminLocked"), "warn"); return; }
  if (!CONFIG.adminPasswordHash) { showToast(t("adminWrongPassword"), "error"); return; }
  const pwd = ($("#adminPassword")?.value || "").trim();
  if (!pwd) return;
  let hash;
  try {
    hash = await sha256Hex(pwd);
  } catch (err) {
    console.warn("SHA-256 unavailable", err);
    showToast(t("adminLoginError"), "error");
    return;
  }
  if (hash === CONFIG.adminPasswordHash) {
    sessionStorage.setItem("adminOk", "true");
    sessionStorage.setItem("adminUntil", String(Date.now() + CONFIG.adminSessionMinutes * 60000));
    sessionStorage.removeItem("adminAttempts");
    sessionStorage.removeItem("adminLockUntil");
    if ($("#adminPassword")) $("#adminPassword").value = "";
    $("#adminLogin")?.classList.add("hidden");
    $("#adminArea")?.classList.remove("hidden");
    renderAdmin();
    startResultsPolling();
  } else {
    if ($("#adminPassword")) $("#adminPassword").value = "";
    const n = Number(sessionStorage.getItem("adminAttempts") || "0") + 1;
    sessionStorage.setItem("adminAttempts", String(n));
    if (n >= (CONFIG.adminMaxAttempts || 5)) {
      sessionStorage.setItem("adminLockUntil", String(Date.now() + CONFIG.adminLockMinutes * 60000));
      sessionStorage.setItem("adminAttempts", "0");
      showToast(t("adminLocked"), "warn");
    } else {
      showToast(t("adminWrongPassword"), "error");
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
  if (isToday(e.createdAt) && !e.diagnostics?.demo) { showToast(t("deleteTodayBlocked"), "warn"); return; }
  if (!confirm(t("deleteConfirm"))) return;
  const reason = prompt(t("deleteReasonPrompt"), "") || "";
  s.entries = s.entries.filter(x => x.id !== id);
  delete s.paid[id];
  if (!s.deletedIds) s.deletedIds = [];
  s.deletedIds.push(id);
  saveState(s, { forceResults: true });
  await sendRemovalEmail(e, reason).catch(() => {});
  renderAll();
  showToast(t("deleteEmailSent"), "success");
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
  if (todayEntries.length > 0) showToast(t("clearDataTodayKept").replace("{n}", todayEntries.length), "info");
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
  saveState(s); renderAll(); showToast(t("demoCreated"), "success");
}

async function refreshApiFootball() {
  if (!guardAdmin()) return;
  if (!CONFIG.apiFootball?.enabled || !CONFIG.apiFootball?.apiKey) { showToast(t("apiFootballNotConfigured"), "warn"); return; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${CONFIG.apiFootball.baseUrl}/fixtures?league=${CONFIG.apiFootball.league}&season=${CONFIG.apiFootball.season}`,
      { headers: { "x-apisports-key": CONFIG.apiFootball.apiKey }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    localStorage.setItem("bolao_api_football_cache", JSON.stringify({ ts: Date.now(), payload: await res.json() }));
    showToast(t("apiFootballUpdated"), "success");
  } catch (err) { console.warn("API-Football failed", err); showToast(t("apiFootballNotConfigured"), "error"); }
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

// ESPN's own in-game win-probability model (undocumented Core API v2 —
// confirmed to exist for other sports, not confirmed for soccer). Best
// effort only: on any failure or unexpected shape, returns null so the
// caller falls back to the site's own Poisson-based estimate. Never throws,
// never blocks rendering (fetched async, cached, applied on the next render).
// APOSENTADA na migração para o snapshot (2026-08-07): probabilidade ao vivo da ESPN (sports.core.api.espn.com).
// Só era alcançável por pollLiveScores() para partidas AO VIVO. A Copa do Mundo terminou em
// 2026-07-19 e o app está arquivado (CONFIG.archived), então nenhum caminho de chamada pode mais
// disparar isto — e mantê-la faria o navegador chamar a ESPN direto, que é exatamente a dependência
// que esta migração remove (e que permitiria remover a ESPN do CSP só pela metade).
//
// Mantida como no-op DOCUMENTADA em vez de deletada: os chamadores continuam existindo e sempre
// souberam lidar com `null` (era o retorno de qualquer falha de rede). Deletar exigiria mexer nos
// chamadores, o que ampliaria o diff sem ganho. O snapshot deliberadamente NÃO inclui dados por
// evento (evita fan-out N+1 server-side) — extractMatchPlays() já cai para `comp.details`, que o
// snapshot fornece.
async function fetchEspnWinProbability(_eventId, _competitionId) {
  return null;
}

const _espnProbCache = new Map();
const _espnOddsCache = new Map(); // mid → {pA, pD, pB} vig-stripped DraftKings

function americanToImplied(oddsStr) {
  const v = parseInt(oddsStr, 10);
  if (isNaN(v)) return null;
  return v < 0 ? Math.abs(v) / (Math.abs(v) + 100) : 100 / (v + 100);
}

// Reads DraftKings moneyline odds from the ESPN scoreboard response — the
// same JSON fetchEspnFixtures() already fetches, just fields that were
// never read. Populates _espnOddsCache for every upcoming match where
// DraftKings has published a line (typically 1–2 days before kickoff).
function extractEspnOdds(events) {
  if (!Array.isArray(events)) return;
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  const s = state();
  // Same data.js slot-resolution gap as mapEspnToLiveScores — without it,
  // odds never populate for M95+ either.
  const { winners: oddsWinners, losers: oddsLosers } = officialWinnersMap(s);
  for (const m of all) {
    if ((s.results || {})[m.match]?.goalsA !== undefined) continue;
    const teamA = resolveSlot(m.teamA, oddsWinners, oddsLosers);
    const teamB = resolveSlot(m.teamB, oddsWinners, oddsLosers);
    if (/Winner|Loser/i.test(teamA) || /Winner|Loser/i.test(teamB)) continue;
    const normA = normalizeTeamName(teamA), normB = normalizeTeamName(teamB);
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp || comp.status?.type?.state === "post") continue;
      const odds = comp.odds?.[0];
      if (!odds?.moneyline) continue;
      const [c0, c1] = comp.competitors || [];
      if (!c0 || !c1) continue;
      const n0 = normalizeTeamName(c0.team?.displayName);
      const n1 = normalizeTeamName(c1.team?.displayName);
      // Map ESPN home/away to our teamA/teamB — c0 is ESPN's home side
      let oddsA, oddsB;
      if (n0 === normA && n1 === normB) {
        oddsA = odds.moneyline.home?.close?.odds;
        oddsB = odds.moneyline.away?.close?.odds;
      } else if (n1 === normA && n0 === normB) {
        oddsA = odds.moneyline.away?.close?.odds;
        oddsB = odds.moneyline.home?.close?.odds;
      } else {
        continue;
      }
      const oddsD = odds.moneyline.draw?.close?.odds;
      const rA = americanToImplied(oddsA), rB = americanToImplied(oddsB), rD = americanToImplied(oddsD);
      if (rA === null || rB === null) continue;
      const total = rA + rB + (rD ?? 0);
      if (total < 0.1) continue;
      _espnOddsCache.set(String(m.match), {
        pA: rA / total,
        pD: rD !== null ? rD / total : 0,
        pB: rB / total
      });
      break;
    }
  }
}

// ESPN's per-event "summary" endpoint (same site.api.espn.com family we
// already use for scores, so much more likely to actually work for soccer
// than the specialized predictor API above). Pulls shots-on-target and
// possession — used only as an input to sharpen our own in-play estimate
// when ESPN's real win-probability isn't available, never displayed
// directly. Tries a few plausible stat-name variants since the exact keys
// aren't confirmed without live testing; returns null on any mismatch.
// APOSENTADA na migração para o snapshot (2026-08-07): boxscore/estatísticas por partida (endpoint summary da ESPN).
// Só era alcançável por pollLiveScores() para partidas AO VIVO. A Copa do Mundo terminou em
// 2026-07-19 e o app está arquivado (CONFIG.archived), então nenhum caminho de chamada pode mais
// disparar isto — e mantê-la faria o navegador chamar a ESPN direto, que é exatamente a dependência
// que esta migração remove (e que permitiria remover a ESPN do CSP só pela metade).
//
// Mantida como no-op DOCUMENTADA em vez de deletada: os chamadores continuam existindo e sempre
// souberam lidar com `null` (era o retorno de qualquer falha de rede). Deletar exigiria mexer nos
// chamadores, o que ampliaria o diff sem ganho. O snapshot deliberadamente NÃO inclui dados por
// evento (evita fan-out N+1 server-side) — extractMatchPlays() já cai para `comp.details`, que o
// snapshot fornece.
async function fetchEspnMatchStats(_eventId, _teamAName, _teamBName) {
  return null;
}

// Blend pre-match lambdas with an in-match dominance signal (shots on
// target, then possession as a weaker fallback signal) so the fallback
// estimate reacts to what's actually happening, not just the static
// pre-tournament team strength rating + elapsed time. Deliberately mild
// (70/30) — a stat snapshot is noisy, especially early in a match.
function statsAdjustedLambdas(lambdaA, lambdaB, stats) {
  if (!stats) return { lambdaA, lambdaB };
  let shareA = null;
  const sotA = stats.shotsOnTargetA, sotB = stats.shotsOnTargetB;
  if (sotA != null && sotB != null && sotA + sotB >= 2) {
    shareA = sotA / (sotA + sotB);
  } else if (stats.possessionA != null && stats.possessionB != null) {
    const sum = stats.possessionA + stats.possessionB;
    if (sum > 0) shareA = stats.possessionA / sum;
  }
  if (shareA === null) return { lambdaA, lambdaB };
  const total = lambdaA + lambdaB;
  if (total <= 0) return { lambdaA, lambdaB };
  const adjA = total * (0.7 * (lambdaA / total) + 0.3 * shareA);
  return { lambdaA: adjA, lambdaB: total - adjA };
}

const _espnStatsCache = new Map();

/* ── ESPN free results ── */
// ─── MIGRAÇÃO PARA O SNAPSHOT SERVER-SIDE (2026-08-07) ──────────────────────
// Antes daqui isto chamava site.api.espn.com DIRETO do navegador. Dois problemas reais, não
// hipotéticos: (a) a ESPN não dá garantia de CORS e a produção registrava
// `Access to fetch ... has been blocked` em toda carga de página; (b) a ESPN já nos bloqueou
// duas vezes (403 por user-agent e, depois, TLS nos runners do GitHub).
//
// Agora lê o snapshot NORMALIZADO gerado server-side por bolao/shared/scripts/espn_provider.py e
// versionado em data/espn-normalized.json. Mesma origem da página, então CORS deixa de existir
// como classe de problema.
//
// ADAPTADOR, de propósito: o snapshot tem forma achatada (homeTeam/homeScore/state/...), mas todo
// o código a jusante (mapEspnToMatches, extractMatchPlays, pollLiveScores) espera a forma crua da
// ESPN (`ev.competitions[0].competitors[]`). Reconstruir a forma AQUI mantém o diff cirúrgico e
// não toca em nenhuma lógica de scoring/ranking — o objetivo é trocar a FONTE, não o
// comportamento.
//
// Falha segura: qualquer erro devolve `null`, exatamente como a versão anterior fazia. `null` já
// significa "sem dados neste ciclo" para todos os chamadores; nenhum resultado é inventado.
// `stale: true` no snapshot NÃO é tratado como erro — dado velho conhecido é melhor que nenhum, e
// a idade fica registrada em generatedAt/staleSince para auditoria.
const ESPN_SNAPSHOT_URL = "data/espn-normalized.json";

function snapshotEventsToEspnShape(matches) {
  return matches.map(m => ({
    id: m.id,
    date: m.date,
    competitions: [{
      date: m.date,
      status: {
        clock: m.clockSec, period: m.period, displayClock: m.clockStr,
        type: {
          state: m.state, name: m.statusName, description: m.statusDescription,
          shortDetail: m.statusShortDetail, detail: m.statusDetail, completed: m.completed,
        },
      },
      venue: { fullName: m.venue, address: { city: m.city } },
      competitors: [
        { homeAway: "home", team: { id: m.homeTeamId, displayName: m.homeTeam }, score: m.homeScore, winner: m.homeWinner },
        { homeAway: "away", team: { id: m.awayTeamId, displayName: m.awayTeam }, score: m.awayScore, winner: m.awayWinner },
      ],
      details: m.details || [],
    }],
  }));
}

async function fetchEspnFixtures() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(ESPN_SNAPSHOT_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = await res.json();
    if (!snap || !Array.isArray(snap.matches)) throw new Error("snapshot normalizado sem matches[]");
    if (snap.stale) console.warn(`[Copa2026] snapshot ESPN marcado stale (${snap.staleReason || "?"}) — usando último dado bom conhecido`);
    return snapshotEventsToEspnShape(snap.matches);
  } catch (err) {
    clearTimeout(timer);
    console.warn("[Copa2026] leitura do snapshot ESPN falhou", err);
    return null;
  }
}

// Supplements the scoreboard's `comp.details` (used by extractMatchPlays) with ESPN's richer
// per-event summary endpoint. Confirmed live during the World Cup Final (2026-07-19, Eduardo:
// "As substituições sumiram do lugar onde tem os lances cartões e gols"): comp.details only ever
// carries goals and cards for this match -- 11 real substitutions had happened by the 79th
// minute, comp.details still showed just the 2 yellow cards, nothing more. The summary endpoint's
// keyEvents array has the same goals/cards PLUS substitutions. Only called for matches currently
// live (see pollLiveScores) so this never adds load on a normal poll with nothing in progress.
// Fails soft like every other ESPN fetch here: any error just means this cycle falls back to
// comp.details alone (cards/goals keep working, subs silently stay missing until the next poll).
// APOSENTADA na migração para o snapshot (2026-08-07): keyEvents por partida (endpoint summary da ESPN), que trazia as substituições.
// Só era alcançável por pollLiveScores() para partidas AO VIVO. A Copa do Mundo terminou em
// 2026-07-19 e o app está arquivado (CONFIG.archived), então nenhum caminho de chamada pode mais
// disparar isto — e mantê-la faria o navegador chamar a ESPN direto, que é exatamente a dependência
// que esta migração remove (e que permitiria remover a ESPN do CSP só pela metade).
//
// Mantida como no-op DOCUMENTADA em vez de deletada: os chamadores continuam existindo e sempre
// souberam lidar com `null` (era o retorno de qualquer falha de rede). Deletar exigiria mexer nos
// chamadores, o que ampliaria o diff sem ganho. O snapshot deliberadamente NÃO inclui dados por
// evento (evita fan-out N+1 server-side) — extractMatchPlays() já cai para `comp.details`, que o
// snapshot fornece.
async function fetchEspnEventSummary(_eventId) {
  return null;
}

function mapEspnToMatches(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  const s = state();
  const mapped = [];
  // Same data.js slot-resolution gap as mapEspnToLiveScores — without it, the
  // admin's "Atualizar via ESPN" button can never auto-detect a finished
  // M95+ match at all, since data.js's team names for those never resolve.
  const { winners: matchWinners, losers: matchLosers } = officialWinnersMap(s);
  for (const m of all) {
    if ((s.results || {})[m.match]?.goalsA !== undefined) continue;
    const teamA = resolveSlot(m.teamA, matchWinners, matchLosers);
    const teamB = resolveSlot(m.teamB, matchWinners, matchLosers);
    if (/Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(teamA) ||
        /Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(teamB)) continue;
    const normA = normalizeTeamName(teamA), normB = normalizeTeamName(teamB);
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
  if (!events) { if (!silent) showToast("Erro ao buscar ESPN. Verifique o console.", "error"); return; }
  const mapped = mapEspnToMatches(events);
  if (!mapped.length) { if (!silent) showToast(t("noEspnResults"), "info"); return; }
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
    if (!silent) showToast(`${applied} resultado(s) atualizado(s) via ESPN.`, "success");
  } else {
    if (!silent) showToast(t("noNewResults"), "info");
  }
}

/* ── Public live scoreboard (no admin required) ── */
let _liveScores = {};
let _liveScoreTimer = null;
let _liveScorePollTime = 0;
let _prevLiveIds = new Set();
const _openLiveDetails = new Set();
// Real ESPN status for not-yet-live matches, matched by team name alone
// (ignoring data.js's hardcoded date) — a postponed/delayed fixture gets a
// new real kickoff from ESPN that no longer matches m.date/timeET, so this
// is the only way to detect it. Without it, nextScheduledMatch()'s
// elapsed-time heuristic is the sole signal, and it just silently treats a
// postponed match as "over" once enough time passes — confirmed real case:
// Mexico x England (M92) postponed for weather, July 2026.
let _matchStatusHints = {};

// Regulation/extra-time half boundaries, in minutes, checked largest-first —
// once the clock passes one, show "(+N)" stoppage minutes past it, the same
// convention broadcasters (and Google's live scoreboard) use instead of a
// raw minute count that just keeps climbing past 45/90.
const HALF_BOUNDARIES_MIN = [120, 105, 90, 45];

// ESPN's scoreboard feed reports which half/period a live match is actually
// in via status.period (1 = 1st half, 2 = 2nd half, 3/4 = extra-time periods,
// 5 = penalties). That's the SAME signal broadcasters (and Google's live
// scoreboard) use — an authoritative fact from the match feed, not something
// we have to reconstruct by watching the raw clock number and guessing. This
// is preferred over the boundary-guessing fallback below whenever it's
// present: no lag, no missed observation window, correct the instant ESPN's
// own period flips, including for extra time.
const PERIOD_BOUNDARY_MIN = { 1: 45, 2: 90, 3: 105, 4: 120 };

function fmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Realistic upper bound on how long past a boundary something is still
// credible as "stoppage" — broadcasters essentially never call it stoppage
// further past a half/period's normal duration than this.
const MAX_STOPPAGE_SECONDS = 8 * 60;

// period: ESPN's status.period for this match, when known — see
// PERIOD_BOUNDARY_MIN above. skipBoundariesUpTo: legacy fallback used only
// when period isn't available (see _confirmedBoundary below) — ignores any
// boundary at or below this value (minutes) once a halftime/pause
// observation confirmed the match has moved past that half.
function formatMatchClock(totalSeconds, period = null, skipBoundariesUpTo = 0) {
  const totalMinutes = totalSeconds / 60;

  if (period === 5) return fmtClock(totalSeconds); // penalties — no running stoppage concept

  const knownBoundary = period != null ? PERIOD_BOUNDARY_MIN[period] : undefined;
  if (knownBoundary !== undefined) {
    if (totalMinutes <= knownBoundary) return fmtClock(totalSeconds);
    const secsPastBoundary = totalSeconds - knownBoundary * 60;
    // No known period has a legitimate next real-clock state to numerically grow into once its
    // own boundary + a realistic stoppage window has passed — it's always followed by either the
    // next period, halftime, full-time, or a shootout, never more running clock. Once that cap is
    // passed, freeze here for good instead of letting the display keep climbing. This used to
    // only apply to period===4 (the actual fix for the runaway "120:07 (+1)…" Eduardo caught live
    // during Australia x Egypt's shootout), on the theory that periods 1-3 would always get a
    // fresh isHalftime/period-change signal before running away — but CDB2026 hit the SAME
    // unbounded-growth bug live on period 1 (2026-08-01, Vasco×Fluminense: "58:11 (+14)" and
    // still climbing, well into the real halftime break) when one poll cycle didn't land in time
    // to flip isHalftime. Propagated the fix here to close the same gap for every known period,
    // not just 4.
    if (secsPastBoundary > MAX_STOPPAGE_SECONDS) {
      return `${fmtClock(knownBoundary * 60 + MAX_STOPPAGE_SECONDS)} (+${MAX_STOPPAGE_SECONDS / 60})`;
    }
    const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
    return `${fmtClock(totalSeconds)} (+${stoppageMin})`;
  }

  // Fallback for when ESPN's period field isn't present in the feed: the
  // largest boundary the clock has actually passed, capped at a realistic
  // 8 minutes of stoppage — needed because without period, this clock is
  // just one continuous counter with no built-in notion of "which half" it's
  // in. This is exactly what Eduardo caught live ("55:11 (+11)" during
  // confirmed 2nd-half play, well past any real 1st-half stoppage) — period
  // fixes that at the source when available; this stays as a safety net for
  // when it isn't.
  const boundary = HALF_BOUNDARIES_MIN.find(b => b > skipBoundariesUpTo && totalMinutes > b);
  if (!boundary) return fmtClock(totalSeconds);
  const secsPastBoundary = totalSeconds - boundary * 60;
  if (secsPastBoundary > MAX_STOPPAGE_SECONDS) return fmtClock(totalSeconds);
  const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
  return `${fmtClock(totalSeconds)} (+${stoppageMin})`;
}

// Sticky per-match record of the highest half-boundary we've directly
// confirmed the match has moved past — set the moment we observe the match
// paused (isHalftime) at/near a boundary. Once set, formatMatchClock stops
// treating that boundary as a possible ongoing stoppage for this match, no
// matter how long since the tab last polled while it was still 1st half.
const CONFIRMED_BOUNDARY_KEY = "bolao_confirmed_half_boundary";
let _confirmedBoundary = {};

function loadConfirmedBoundary() {
  try { return JSON.parse(localStorage.getItem(CONFIRMED_BOUNDARY_KEY) || "{}"); }
  catch { return {}; }
}

function saveConfirmedBoundary() {
  try { localStorage.setItem(CONFIRMED_BOUNDARY_KEY, JSON.stringify(_confirmedBoundary)); }
  catch { /* storage full/unavailable — falls back to formatMatchClock's time cap only */ }
}

// Provisional per-entry points for a match still in progress: goals-correct
// component always counts; the advance bonus only counts while the live
// score isn't a draw (pickWinner returns "" on a tie). Never touches
// state().results — purely a live preview, official points still require
// the admin to confirm the result.
function liveMatchPoints(pick, liveGoalsA, liveGoalsB, matchId, entryPredictedTeam, realTeamA, realTeamB) {
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
  const advanceCorrect = liveAdvance && pick.advanceSide === liveAdvance;
  if (advanceCorrect) pts += CONFIG.scoring.advance;
  // M103 (3rd place) and M104 (Final) are the only two matches whose winner/loser directly
  // decides a podium bonus (champion/runner-up/3rd/4th) — see scoreEntry()'s bonus block, which
  // only ever applies once the admin locks results.
  //
  // Eduardo, 2026-07-18: "Score tem um problema: somente quem selecionou a Inglaterra lá no
  // início deve receber o bonus, não o time que passou." Confirmed against real data: comparing
  // just the bracket SIDE letter (pick.advanceSide === liveAdvance) is NOT enough — of 21 real
  // entries that picked side B for M103, only 2 (Simone Hirle #4, Gabriel Ferrari) actually
  // traced their OWN bracket picks through to "England" specifically; the other 19 predicted
  // entirely different teams (Mexico, Argentina, Colombia...) that happened to land on the same
  // side only because THIS live preview never checked team identity. scoreEntry()'s official bonus
  // (via finalPodiumForEntry()/podiumFromResults()) already compares by actual team name, never by
  // side alone — this mirrors that exactly, using the entry's own bracket-resolved team
  // (entryPredictedTeam, from resolvedTeamsForEntry()) against the real team currently leading.
  if (advanceCorrect && (matchId === "103" || matchId === "104")) {
    const realLeadingTeam = liveAdvance === "A" ? realTeamA : realTeamB;
    if (entryPredictedTeam && isRealTeamName(entryPredictedTeam) && entryPredictedTeam === realLeadingTeam) {
      // A single advanceSide pick on these matches predicts BOTH podium slots at once (3rd AND
      // 4th are two sides of the same M103 result; champion AND runnerUp of the same M104
      // result) — same all-or-nothing logic as podiumFromResults()/finalPodiumForEntry().
      if (matchId === "103") pts += CONFIG.bonus.third + CONFIG.bonus.fourth;
      else pts += CONFIG.bonus.champion + CONFIG.bonus.runnerUp;
    }
  }
  return pts;
}

function liveMatchPointsTable(matchId, liveGoalsA, liveGoalsB) {
  const s = state();
  const entries = s.entries || [];
  if (!entries.length) return `<p class="muted">${escapeHtml(t("liveNoPicks"))}</p>`;

  // Real team names for this match, so each row can show which team the
  // entry actually picked to advance — a tied predicted score (e.g. "1×1")
  // otherwise gives no visual clue which side they picked. Requested by
  // participants: hard to tell during a live tie who picked what.
  const km = DATA.knockoutMatches.find(x => String(x.match) === String(matchId));
  const { winners: pointsWinners, losers: pointsLosers } = officialWinnersMap(s);
  const pickTeamName = side => {
    if (!km || !side) return null;
    return resolveSlot(side === "A" ? km.teamA : km.teamB, pointsWinners, pointsLosers);
  };

  // Official score for every entry (before this live match)
  const officialScore = {};
  entries.forEach(e => { officialScore[e.id] = scoreEntry(e, s).total; });

  // Official rank (position in overall ranking right now)
  const officialRank = {};
  [...entries]
    .sort((a, b) => (officialScore[b.id] || 0) - (officialScore[a.id] || 0))
    .forEach((e, i) => { officialRank[e.id] = i; });

  // Points this live match would add for each entry (null = no pick for it).
  // For M103/M104, the podium bonus must compare the entry's OWN bracket-traced team (not just
  // the bracket side) against the real team currently leading — see liveMatchPoints() comment.
  const realTeamA = pickTeamName("A"), realTeamB = pickTeamName("B");
  const livePtsRaw = {};
  entries.forEach(e => {
    const pick = e.picks?.[matchId];
    const predicted = resolvedTeamsForEntry(e)[matchId];
    const entryPredictedTeam = pick?.advanceSide === "A" ? predicted?.displayA : pick?.advanceSide === "B" ? predicted?.displayB : null;
    livePtsRaw[e.id] = liveMatchPoints(pick, liveGoalsA, liveGoalsB, String(matchId), entryPredictedTeam, realTeamA, realTeamB);
  });

  // Provisional rank: add live match pts to every entry, re-rank all entries.
  // Tie-broken by this match's own live points so the assigned "Pos." always
  // matches the order rows are displayed in below — previously the rank here
  // and the visual row sort used different tie-breaks and could disagree
  // (e.g. two entries tied on provisional total but the one further ahead
  // in this specific match would render above a "lower Pos." entry).
  const provScore = {};
  entries.forEach(e => { provScore[e.id] = (officialScore[e.id] || 0) + (livePtsRaw[e.id] ?? 0); });
  const provRank = {};
  [...entries]
    .sort((a, b) => (provScore[b.id] || 0) - (provScore[a.id] || 0) || (livePtsRaw[b.id] ?? 0) - (livePtsRaw[a.id] ?? 0))
    .forEach((e, i) => { provRank[e.id] = i; });

  // Show only entries with picks for this match, sorted by that same
  // provisional rank — guaranteed consistent with the Pos. column by
  // construction, can't diverge again.
  const rows = entries
    .map(e => {
      const pick = e.picks?.[matchId];
      const livePts = livePtsRaw[e.id];
      if (livePts === null) return null;
      const oRank = officialRank[e.id] ?? 0;
      const pRank = provRank[e.id] ?? 0;
      const delta = Math.abs(oRank - pRank);
      return {
        id: e.id,
        name: e.entryName || "?",
        pickStr: pick ? `${pick.goalsA}×${pick.goalsB}` : "—",
        pickTeam: pickTeamName(pick?.advanceSide),
        livePts,
        provTotal: provScore[e.id] || 0,
        provPos: pRank + 1,
        arrow: pRank < oRank ? "up" : pRank > oRank ? "down" : null,
        delta
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.provPos - b.provPos);

  if (!rows.length) return `<p class="muted">${escapeHtml(t("liveNoPicks"))}</p>`;

  const trs = rows.map((row) => {
    const pickCell = row.pickTeam
      ? `${escapeHtml(row.pickStr)} <b class="live-pick-team">${escapeHtml(row.pickTeam)}</b>`
      : escapeHtml(row.pickStr);
    return `<tr><td style="text-align:center">${row.provPos}${rankArrowHtml(row.arrow, row.delta)}</td><td>${escapeHtml(row.name)}</td><td>${pickCell}</td><td style="text-align:center"><b class="pick-pts${row.livePts > 0 ? " pos" : ""}">${row.livePts}</b></td></tr>`;
  }).join("");
  return `<table><thead><tr><th style="text-align:center">${escapeHtml(t("livePosCol"))}</th><th>${escapeHtml(t("liveEntryCol"))}</th><th>${escapeHtml(t("livePickCol"))}</th><th style="text-align:center">${escapeHtml(t("livePointsCol"))}</th></tr></thead><tbody>${trs}</tbody></table>
<p class="footer-note" style="margin-top:8px">${escapeHtml(t("liveProvisionalNote"))}</p>`;
}

// Pulls goal-scorer + minute from the same scoreboard event we already
// fetch for the score/clock (comp.details), so no extra network call.
// Best-effort: ESPN's exact field names for this aren't confirmed without
// live testing, so this fails soft (empty array) if the shape doesn't match.
// Wrapped in try/catch and defensive against null/malformed array entries —
// this must NEVER throw, since it runs inline inside mapEspnToLiveScores()
// for every live match on every poll; an uncaught exception here would
// throw before _liveScores gets reassigned, freezing the live score/clock
// for ALL matches indefinitely (not just the goal-scorer list).
function extractGoalEvents(comp) {
  try {
    const details = Array.isArray(comp.details) ? comp.details : [];
    const [c0, c1] = comp.competitors || [];
    const goals = [];
    for (const d of details) {
      if (!d) continue;
      const isGoal = d.scoringPlay === true || /goal/i.test(d.type?.text || d.type?.name || "");
      if (!isGoal) continue;
      const teamId = d.team?.id;
      let side = null;
      if (teamId != null && c0?.team?.id != null && String(teamId) === String(c0.team.id)) side = "c0";
      else if (teamId != null && c1?.team?.id != null && String(teamId) === String(c1.team.id)) side = "c1";
      if (!side) continue;
      const athlete = d.athletesInvolved?.[0];
      const scorer = athlete?.displayName || athlete?.shortName || null;
      const clockVal = typeof d.clock?.value === "number" ? d.clock.value : null;
      const minute = d.clock?.displayValue || (clockVal != null ? `${Math.floor(clockVal / 60)}'` : "");
      if (!scorer && !minute) continue;
      goals.push({ side, scorer, minute, order: clockVal ?? 0 });
    }
    return goals.sort((a, b) => a.order - b.order);
  } catch (err) {
    console.warn("extractGoalEvents failed, skipping goal-scorer list for this match", err);
    return [];
  }
}

// Built for the "últimos lances" minute-by-minute feed (July 2026).
// Generalizes extractGoalEvents to capture cards and substitutions, primarily from comp.details
// (no extra network call, same scoreboard endpoint already polled every 60s) but falling back to
// the richer per-event summary endpoint's keyEvents for live matches (see
// fetchEspnEventSummary) since comp.details alone never carries substitutions. This is ESPN's
// data, not a broadcaster commentary feed: only discrete events (goal/card/sub) are available,
// never prose-style play-by-play like a TV broadcaster's live text (e.g. ge.globo) — that data
// source isn't available to this site.
//
// Confirmed against a REAL live match (World Cup Final, 2026-07-19, event 760517): type.text is
// exactly "Yellow Card"/"Substitution" as assumed, and a substitution's participant order is
// [athlete in, athlete out] (keyEvents shape — comp.details' athletesInvolved order still
// unconfirmed, since real subs never appeared there to check). Same "fails soft, never throws"
// contract as extractGoalEvents: this runs inline inside mapEspnToLiveScores() on every poll, so
// a shape mismatch must degrade to an empty array, never break the live score/clock for every
// match.
function extractMatchPlays(comp, keyEvents) {
  try {
    // Prefer the richer summary-endpoint keyEvents when available — comp.details is missing
    // substitutions entirely (confirmed live, World Cup Final, 2026-07-19 — see
    // fetchEspnEventSummary). Falls back to comp.details when the extra fetch wasn't provided or
    // failed, so goals/cards never regress even if the summary call is down.
    const details = Array.isArray(keyEvents) && keyEvents.length
      ? keyEvents
      : (Array.isArray(comp.details) ? comp.details : []);
    const [c0, c1] = comp.competitors || [];
    const plays = [];
    for (const d of details) {
      if (!d) continue;
      const typeText = `${d.type?.text || ""} ${d.type?.name || ""}`;
      const isGoal = d.scoringPlay === true || /goal/i.test(typeText);
      const isRedCard = /red card|second yellow/i.test(typeText);
      const isYellowCard = !isRedCard && /yellow card/i.test(typeText);
      const isSub = /substitution/i.test(typeText);
      let kind = null;
      if (isGoal) kind = "goal";
      else if (isRedCard) kind = "red";
      else if (isYellowCard) kind = "yellow";
      else if (isSub) kind = "sub";
      if (!kind) continue; // not a play type we render — skip silently
      const teamId = d.team?.id;
      let side = null;
      if (teamId != null && c0?.team?.id != null && String(teamId) === String(c0.team.id)) side = "c0";
      else if (teamId != null && c1?.team?.id != null && String(teamId) === String(c1.team.id)) side = "c1";
      if (!side) continue;
      const clockVal = typeof d.clock?.value === "number" ? d.clock.value : null;
      const minute = d.clock?.displayValue || (clockVal != null ? `${Math.floor(clockVal / 60)}'` : "");
      // comp.details lists athletes in athletesInvolved[]; the summary endpoint's keyEvents uses
      // participants[].athlete instead — support both shapes so switching source never silently
      // drops names. Confirmed via a real substitution keyEvent: participants order is
      // [athlete in, athlete out].
      const names = (d.athletesInvolved || (d.participants || []).map(p => p?.athlete))
        .map(a => a?.displayName || a?.shortName)
        .filter(Boolean);
      // Substitution: show both names joined, without claiming which is
      // in/out — that ordering isn't confirmed. Everything else: first
      // (only) name involved.
      const text = kind === "sub" ? names.slice(0, 2).join(" ↔ ") : (names[0] || "");
      if (!text && !minute) continue;
      plays.push({ kind, side, minute, text, order: clockVal ?? 0 });
    }
    return plays.sort((a, b) => a.order - b.order);
  } catch (err) {
    console.warn("extractMatchPlays failed, skipping plays feed for this match", err);
    return [];
  }
}

function mapEspnToLiveScores(events, keyEventsById) {
  if (!Array.isArray(events) || !events.length) return {};
  keyEventsById = keyEventsById || {};
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  const s = state();
  const out = {};
  if (!Object.keys(_confirmedBoundary).length) _confirmedBoundary = loadConfirmedBoundary();
  // data.js's knockoutMatches never gets rewritten with real team names — a
  // match like M95 stays "Winner Match 87"/"Winner Match 86" in the static
  // fixture forever. Resolve those slots via the official results (the same
  // mechanism already used for the "Próximo Jogo" label) before matching
  // against ESPN, or live tracking silently never works for R16's second
  // half onward (confirmed dead for M95 — Argentina x Egypt — July 2026).
  const { winners: officialWinners, losers: officialLosers } = officialWinnersMap(s);
  for (const m of all) {
    if ((s.results || {})[m.match]?.goalsA !== undefined) continue;
    const teamA = resolveSlot(m.teamA, officialWinners, officialLosers);
    const teamB = resolveSlot(m.teamB, officialWinners, officialLosers);
    if (/Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(teamA) ||
        /Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(teamB)) continue;
    const normA = normalizeTeamName(teamA), normB = normalizeTeamName(teamB);
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
      const period = typeof comp.status?.period === "number" ? comp.status.period : null;
      // ESPN's break-state naming isn't confirmed without live testing (no
      // network access from this sandbox) — best-effort match on the common
      // enum/description shapes, falls back to the normal clock if it
      // doesn't hit so a miss here never breaks the display, just skips the
      // "Intervalo" label.
      const statusName = (comp.status?.type?.name || "").toUpperCase();
      const statusText = `${comp.status?.type?.description || ""} ${comp.status?.type?.shortDetail || ""} ${comp.status?.type?.detail || ""}`.toLowerCase();
      const isHalftime = statusName.includes("HALFTIME") || /half.?time|intervalo|entretiempo/.test(statusText);
      // Penalty shootout: there's no running match clock during penalties —
      // regulation/extra time is over, the "45/90/105/120 + stoppage" concept
      // doesn't apply at all. Google's own live scoreboard shows a static
      // "Penalties" label here instead of a clock (confirmed from a
      // screenshot Eduardo sent: score "1 (0) — Live — Penalties — 1 (0)",
      // no ticking timer).
      //
      // Confirmed from a real live payload (Eduardo sent it mid-match,
      // Australia vs Egypt): the instant extra time ends, ESPN reports
      // period 4 still (not yet 5) with type.name "STATUS_END_OF_EXTRATIME"
      // and type.detail/shortDetail "AET-pens" — the clock is frozen at
      // 120:00 in that state too, well before penalties actually start. The
      // original fix here only matched the word "penalt", which "AET-pens"
      // doesn't contain — that gap is exactly why the clock kept climbing
      // instead of freezing. period === 5 is kept as a guess for once kicks
      // are actually being taken (unconfirmed, no live sample of that state
      // yet), alongside broader name/text matching so any wording ESPN uses
      // for either state is covered.
      const isPenalties = period === 5
        || statusName.includes("SHOOTOUT")
        || statusName.includes("PENALT")
        || statusName.includes("END_OF_EXTRATIME")
        || /penalt|pênalti|penales|\bpens\b|shootout|end of extra ?time/.test(statusText);
      // Paused right at/near a boundary confirms this match has moved past
      // it for good — record it so formatMatchClock never again mistakes
      // "well into the next half" for "still stoppage from the last one."
      if (isHalftime && clockSeconds != null) {
        const nearBoundary = HALF_BOUNDARIES_MIN
          .filter(b => clockSeconds / 60 >= b - 3)
          .sort((a, b) => b - a)[0];
        if (nearBoundary && (_confirmedBoundary[m.match] ?? 0) < nearBoundary) {
          _confirmedBoundary[m.match] = nearBoundary;
          saveConfirmedBoundary();
        }
      }
      const skipUpTo = _confirmedBoundary[m.match] ?? 0;
      const clock = isHalftime
        ? t("liveHalftime")
        : isPenalties
          ? t("livePenalties")
          : clockSeconds !== null && clockSeconds >= 0
            ? formatMatchClock(clockSeconds, period, skipUpTo)
            : (comp.status?.type?.shortDetail || "");
      const eventId = ev.id, competitionId = comp.id || ev.id;
      const goalEvents = extractGoalEvents(comp);
      const matchPlays = extractMatchPlays(comp, keyEventsById[eventId]);
      if (n0 === normA && n1 === normB) {
        const scorers = goalEvents.map(g => ({ side: g.side === "c0" ? "A" : "B", scorer: g.scorer, minute: g.minute }));
        const plays = matchPlays.map(p => ({ ...p, side: p.side === "c0" ? "A" : "B" }));
        out[m.match] = { goalsA: s0, goalsB: s1, clock, clockSeconds, period, isHalftime, isPenalties, pastBoundary: skipUpTo, pollTime: Date.now(), eventId, competitionId, scorers, plays };
        break;
      }
      if (n1 === normA && n0 === normB) {
        const scorers = goalEvents.map(g => ({ side: g.side === "c0" ? "B" : "A", scorer: g.scorer, minute: g.minute }));
        const plays = matchPlays.map(p => ({ ...p, side: p.side === "c0" ? "B" : "A" }));
        out[m.match] = { goalsA: s1, goalsB: s0, clock, clockSeconds, period, isHalftime, isPenalties, pastBoundary: skipUpTo, pollTime: Date.now(), eventId, competitionId, scorers, plays };
        break;
      }
    }
  }
  return out;
}

// Matches by team name only (no date filter — see _matchStatusHints comment
// above) so a postponed/rescheduled fixture is still found even though its
// real ESPN date no longer matches data.js. Only worth checking for matches
// that aren't already resolved or currently showing as live.
function computeMatchStatusHints(events) {
  if (!Array.isArray(events) || !events.length) return {};
  const all = [...(DATA.groupMatches || []), ...(DATA.knockoutMatches || [])];
  const s = state();
  const out = {};
  // Same slot-resolution gap as mapEspnToLiveScores above — without it, this
  // never fires for M95 onward either since data.js's team names stay as
  // "Winner Match N" forever.
  const { winners: officialWinners, losers: officialLosers } = officialWinnersMap(s);
  for (const m of all) {
    if ((s.results || {})[m.match]?.goalsA !== undefined) continue;
    const teamA = resolveSlot(m.teamA, officialWinners, officialLosers);
    const teamB = resolveSlot(m.teamB, officialWinners, officialLosers);
    if (/Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(teamA) ||
        /Winner|Loser|(?:1st|2nd|3rd)\s|Group\s/i.test(teamB)) continue;
    const normA = normalizeTeamName(teamA), normB = normalizeTeamName(teamB);
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const [c0, c1] = comp.competitors || [];
      if (!c0 || !c1) continue;
      const n0 = normalizeTeamName(c0.team?.displayName);
      const n1 = normalizeTeamName(c1.team?.displayName);
      if (!((n0 === normA && n1 === normB) || (n1 === normA && n0 === normB))) continue;
      const stateName = comp.status?.type?.state || "";
      const name = (comp.status?.type?.name || "").toUpperCase();
      const detail = `${comp.status?.type?.description || ""} ${comp.status?.type?.shortDetail || ""} ${comp.status?.type?.detail || ""}`.trim();
      const postponed = stateName === "pre" && (
        /POSTPON|DELAY|SUSPEND|CANCEL/.test(name) || /postpon|delay|suspend|adiad|cancel/i.test(detail)
      );
      out[m.match] = { state: stateName, postponed, label: detail, kickoffIso: comp.date || ev.date || null };
      break;
    }
  }
  return out;
}

// The running clock interpolates seconds between 60s ESPN polls. ESPN's feed
// can lag the real broadcast by 2–4+ minutes (VAR delays, half-time transitions,
// network lag after the tab was backgrounded). The old 150s cap caused visible
// backward jumps whenever ESPN's lag exceeded that threshold.
// New strategy: the clock is MONOTONIC during play — it never goes backward
// unless ESPN signals a legitimate period boundary reset (clock drops from near
// a 45-min mark to near 0, which means a new half or ET period is starting).
// A genuinely paused clock (fresh.clockPaused, from detectClockPaused's own
// raw poll-to-poll comparison, below) skips all of this and trusts ESPN's
// frozen value as-is — otherwise "monotonic" would mean a stalled clock (a
// real break, not lag) keeps extrapolating forward with no cap at all for
// as long as the pause lasts, since a frozen clock never looks like either
// "ahead" or "a period reset" to the logic above.
function mergeLiveClock(fresh, prev) {
  if (fresh.clockPaused) return fresh;
  if (!prev || prev.clockSeconds == null || fresh.clockSeconds == null) return fresh;
  const elapsed = (fresh.pollTime - prev.pollTime) / 1000;
  if (elapsed <= 0) return fresh;
  const extrapolated = prev.clockSeconds + elapsed;
  const behindBy = extrapolated - fresh.clockSeconds;
  if (behindBy <= 0) return fresh; // ESPN is ahead — accept it
  // ESPN is behind our extrapolation. Accept the reset if ESPN's own period
  // number changed — authoritative, a new half/ET period genuinely started.
  // Only fall back to guessing from the raw clock value when period isn't
  // available on either side to compare.
  if (fresh.period != null && prev.period != null) {
    if (fresh.period !== prev.period) return fresh;
  } else {
    const BOUNDARY_S = [45, 90, 105].map(m => m * 60);
    const nearBoundary = BOUNDARY_S.some(b => prev.clockSeconds >= b - 120);
    const looksLikePeriodReset = fresh.clockSeconds < 120 && nearBoundary;
    if (looksLikePeriodReset) return fresh;
  }
  return { ...fresh, clockSeconds: extrapolated };
}

// mergeLiveClock only has something to compare against while _liveScores
// lives in memory — a full page reload wipes it, so the very first poll
// after a refresh had no prior estimate and just took ESPN's (laggy) value
// as-is, undoing the anti-backward-jump guard on every reload. Persisting
// the last known clock per match to localStorage gives that first poll a
// prior estimate to compare against too.
const LIVE_CLOCK_CACHE_KEY = "bolao_live_clock_cache";

function loadLiveClockCache() {
  try { return JSON.parse(localStorage.getItem(LIVE_CLOCK_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function saveLiveClockCache(scores) {
  try {
    const cache = {};
    for (const [mid, ls] of Object.entries(scores)) {
      if (ls.clockSeconds != null) cache[mid] = { clockSeconds: ls.clockSeconds, pollTime: ls.pollTime, period: ls.period ?? null };
    }
    localStorage.setItem(LIVE_CLOCK_CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full/unavailable — clock just won't survive a reload this time */ }
}

// Detects a genuinely paused clock (halftime, a long stoppage, VAR review)
// straight from its own behavior across two REAL polls, instead of trying to
// recognize ESPN's exact halftime status wording (isHalftime, above, is a
// best-effort label for when that guess happens to be right — this is the
// fallback that works even when it isn't). Must compare raw poll-to-poll
// values, not the smoothed/extrapolated ones mergeLiveClock produces, or a
// pause would look identical to normal lag and never trigger.
const LIVE_CLOCK_RAW_CACHE_KEY = "bolao_live_clock_raw_cache";
let _rawClockHistory = {};

function loadRawClockCache() {
  try { return JSON.parse(localStorage.getItem(LIVE_CLOCK_RAW_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function saveRawClockCache(history) {
  try { localStorage.setItem(LIVE_CLOCK_RAW_CACHE_KEY, JSON.stringify(history)); }
  catch { /* storage full/unavailable — pause detection just resets on reload this time */ }
}

function detectClockPaused(freshRaw, prevRaw) {
  if (!prevRaw || prevRaw.clockSeconds == null || freshRaw.clockSeconds == null) return false;
  const realElapsed = (freshRaw.pollTime - prevRaw.pollTime) / 1000;
  if (realElapsed < 30) return false; // too little time between polls to tell anything
  const clockDelta = freshRaw.clockSeconds - prevRaw.clockSeconds;
  // Real time passed but the match clock barely moved — it's paused right
  // now, whatever the reason. Some slack (30%) for ESPN's own poll jitter.
  return clockDelta < realElapsed * 0.3;
}

// Vários elementos (card ao vivo, próximo jogo) aparecem/somem dinamicamente a cada poll --
// mesmo achado do BR2026/CDB2026 (Eduardo, screenshot, 2026-07-17: "Ainda tem bastante areas em
// branco ao final da pagina, isso tinha sido corrigido"): quando o conteúdo ENCOLHE enquanto a
// página está rolada perto do final, o Safari no iOS é conhecido por não recalcular a área
// rolável até uma interação nova. `scrollBy(0, 0)` não move a página, só força o WebKit a
// recalcular os limites de rolagem.
function nudgeScrollReflow() {
  requestAnimationFrame(() => { if (window.scrollY > 0) window.scrollBy(0, 0); });
}

async function pollLiveScores() {
  const prevIds = new Set(Object.keys(_liveScores));
  const events = await fetchEspnFixtures();
  if (!events) return;
  extractEspnOdds(events); // reads DraftKings lines already in the same payload
  // Fetch the richer per-event summary (keyEvents, includes substitutions — see
  // fetchEspnEventSummary) only for matches currently live, so a normal poll with nothing in
  // progress never adds extra network calls.
  const liveEventIds = events
    .filter(ev => ev.competitions?.[0]?.status?.type?.state === "in")
    .map(ev => ev.id)
    .filter(Boolean);
  const keyEventsById = {};
  if (liveEventIds.length) {
    const summaries = await Promise.all(liveEventIds.map(id => fetchEspnEventSummary(id)));
    liveEventIds.forEach((id, i) => { if (summaries[i]) keyEventsById[id] = summaries[i]; });
  }
  const fresh = mapEspnToLiveScores(events, keyEventsById);
  _matchStatusHints = computeMatchStatusHints(events);
  const cache = loadLiveClockCache();
  if (!Object.keys(_rawClockHistory).length) _rawClockHistory = loadRawClockCache();
  const merged = {};
  const nextRawHistory = {};
  for (const [mid, ls] of Object.entries(fresh)) {
    ls.clockPaused = detectClockPaused(ls, _rawClockHistory[mid]);
    merged[mid] = mergeLiveClock(ls, _liveScores[mid] || cache[mid]);
    if (ls.clockSeconds != null) nextRawHistory[mid] = { clockSeconds: ls.clockSeconds, pollTime: ls.pollTime };
  }
  _rawClockHistory = nextRawHistory;
  saveRawClockCache(_rawClockHistory);
  _liveScores = merged;
  saveLiveClockCache(_liveScores);
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
  nudgeScrollReflow();

  // Best-effort: try ESPN's own win-probability model for each live match,
  // once per poll cycle. Fire-and-forget — renders already happened above
  // with the Poisson fallback; this just upgrades the numbers in place if
  // ESPN's endpoint returns something usable.
  for (const [mid, ls] of Object.entries(_liveScores)) {
    fetchEspnWinProbability(ls.eventId, ls.competitionId).then(prob => {
      if (!prob) return;
      _espnProbCache.set(mid, prob);
      renderGames();
      renderNextMatch();
    });
    const m = DATA.knockoutMatches.find(x => x.match === mid) || DATA.groupMatches?.find(x => x.match === mid);
    if (m) {
      // Resolve data.js's "Winner Match N" placeholders (M95+) before passing
      // team names in — fetchEspnMatchStats matches ESPN's boxscore by name.
      const { winners: statsWinners, losers: statsLosers } = officialWinnersMap(state());
      const statsTeamA = resolveSlot(m.teamA, statsWinners, statsLosers);
      const statsTeamB = resolveSlot(m.teamB, statsWinners, statsLosers);
      fetchEspnMatchStats(ls.eventId, statsTeamA, statsTeamB).then(stats => {
        if (!stats) return;
        _espnStatsCache.set(mid, stats);
        if (!_espnProbCache.has(mid)) { renderGames(); renderNextMatch(); }
      });
    }
  }
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
  const { winners: endWinners, losers: endLosers } = officialWinnersMap(s);
  const lines = matchIds.map(mid => {
    const r = s.results?.[mid];
    const m = DATA.knockoutMatches.find(x => String(x.match) === mid);
    if (!r || !m) return `M${mid} encerrado`;
    // data.js keeps "Winner Match N" forever for M95+ — resolve via official
    // results (earlier matches only, so this match's own result being saved
    // yet or not doesn't matter) instead of showing the raw placeholder.
    const tA = resolveSlot(m.teamA, endWinners, endLosers);
    const tB = resolveSlot(m.teamB, endWinners, endLosers);
    const winner = r.advanceSide === "B" ? tB : tA;
    const verb = t("teamAdvances").replace("{team}", "").trim();
    return `M${mid}: ${escapeHtml(tA)} ${r.goalsA}–${r.goalsB} ${escapeHtml(tB)} · ${escapeHtml(flag(winner))} <strong>${escapeHtml(winner)}</strong> ${escapeHtml(verb)}`;
  });
  // Only the logged-in admin gets an action button here — everyone else
  // (i.e. virtually every visitor) just gets the plain "match ended"
  // notice. Surfacing an "Admin → enviar emails" prompt to regular
  // participants exposed an admin-only workflow to the whole bolão.
  const adminReady = isAdminActive();
  const actionHtml = adminReady
    ? `<button id="matchEndSendEmail" type="button" class="banner-btn-primary">📧 Enviar emails agora</button>`
    : "";
  banner.innerHTML = `<div class="match-end-banner-content">
    <span class="match-end-banner-icon">⚽</span>
    <div class="match-end-banner-text">
      <strong>${escapeHtml(t("matchEnded"))}</strong>
      ${lines.map(l => `<span>${l}</span>`).join("")}
      ${adminReady ? `<small>${escapeHtml(t("espnSyncedNote"))}</small>` : ""}
    </div>
    <div class="match-end-banner-actions">
      ${actionHtml}
      <button type="button" class="banner-btn-dismiss" aria-label="${escapeHtml(t("close"))}">✕</button>
    </div>
  </div>`;
  banner.classList.remove("hidden");
  $("#matchEndSendEmail")?.addEventListener("click", () => sendResultEmailFromAdmin(false));
  banner.querySelector(".banner-btn-dismiss")?.addEventListener("click", () => banner.classList.add("hidden"));
}

/* ============================================================
   Reopen banner (visible while site is past cutoff / closed)
   ============================================================ */
// Polls config.js every 60 s while closed; auto-reloads when auto_reopen.py
// commits the new cutoffIso (2026-07-04T12:00:00-04:00) to GitHub Pages.
let _reopenPoller = null;
function startReopenPolling() {
  if (cutoffDate() > Date.now() || _reopenPoller) return;
  _reopenPoller = setInterval(async () => {
    if (cutoffDate() > Date.now()) { clearInterval(_reopenPoller); _reopenPoller = null; return; }
    try {
      const r = await fetch(`js/config.js?nc=${Date.now()}`);
      const text = await r.text();
      const m = text.match(/cutoffIso:\s*"([^"]+)"/);
      // Reload only when the published cutoff changed — not when it matches the
      // currently loaded value (the old ">= date" check caused an infinite reload
      // loop once we passed that date with no new config published).
      if (m && m[1] !== CONFIG.cutoffIso) location.reload();
    } catch (e) { /* network hiccup — next poll retries, nothing to recover here */ }
  }, 60000);
}

// A tab that's been open since before a fix shipped is stuck running the old
// JS forever — no client-side code can retroactively patch code already
// loaded into a running page. sw.js (no-store) and the pageshow/bfcache
// listener (see init()) cover most real navigations, but a tab that's simply
// left open and foregrounded the whole time gets neither. This is the
// general-purpose backstop: poll the deployed siteVersion and reload once it
// genuinely differs — same safe pattern as startReopenPolling above (exact
// string match only, never a range/threshold, which is what caused an
// infinite reload loop before — see v4.109).
let _versionPoller = null;
// Bug real encontrado em auditoria (2026-07-14): checkVersion() já protegia sessões de admin
// (isAdminActive()) contra o reload forçado, mas não protegia um participante no meio do
// preenchimento do bracket — um deploy no meio de uma sessão apagava os palpites ainda não
// salvos sem aviso nenhum. Mesmo princípio do pickFormIsDirty() já usado no BR2026/CDB2026.
function bracketFormIsDirty() {
  const form = document.getElementById("bracketForm");
  if (!form) return false;
  return [...form.querySelectorAll('[data-field="goalsA"], [data-field="goalsB"]')].some(el => el.value !== "") ||
         [...form.querySelectorAll('[data-field="advanceSide"]')].some(el => el.value !== "");
}
async function checkVersion() {
  if (document.hidden || isAdminActive() || bracketFormIsDirty()) return;
  try {
    const r = await fetch(`js/config.js?nc=${Date.now()}`);
    const text = await r.text();
    const m = text.match(/siteVersion:\s*"([^"]+)"/);
    if (m && m[1] !== CONFIG.siteVersion) location.reload();
  } catch (e) { /* network hiccup — next poll retries, nothing to recover here */ }
}
function startVersionPolling() {
  if (_versionPoller) return;
  _versionPoller = setInterval(checkVersion, 10 * 60 * 1000);
  // Also check immediately when user switches back to this tab — catches
  // deploys that happened while the tab was in background without waiting
  // the full 10-minute poll interval.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkVersion();
  });
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
function renderFooterBar() {
  const el = $("#siteFooterBar");
  if (!el) return;
  const s = state();
  const syncAt = s.meta?.updatedAt
    ? new Date(s.meta.updatedAt).toLocaleString("pt-BR", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  const versionLine = syncAt
    ? `${escapeHtml(CONFIG.siteVersion)} · sync ${escapeHtml(syncAt)} ET`
    : escapeHtml(CONFIG.siteVersion);
  // Archive mode hides the Admin nav button (see applyArchiveMode) -- this small, low-contrast
  // link keeps admin one click away for Eduardo without cluttering the header for everyone else.
  // Admin itself stays password-gated (guardAdmin()) regardless of how this section is reached.
  el.innerHTML = CONFIG.archived
    ? `${versionLine} &nbsp;·&nbsp; <button type="button" class="footer-admin-link" data-action="show-admin">Admin</button>`
    : versionLine;
}

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
  renderProbs();
  renderRules();
  updateDynamic();
  renderFooterBar();
  if (isAdminActive() && !$("#adminArea")?.classList.contains("hidden")) renderAdmin();
  nudgeScrollReflow();
}

/* ============================================================
   Event delegation — single listener on document
   ============================================================ */
function initEvents() {
  // bolão switcher
  document.getElementById("bolaoSelect")?.addEventListener("change", e => {
    const allowed = ["/bolao/copa2026/", "/bolao/br2026/", "/bolao/cdb2026/"];
    if (allowed.includes(e.target.value)) location.href = e.target.value;
  });

  // nav buttons
  document.addEventListener("click", e => {
    const nav = e.target.closest(".nav button[data-section]");
    if (nav) { showSection(nav.dataset.section); return; }

    const adminLink = e.target.closest('[data-action="show-admin"]');
    if (adminLink) { showSection("admin"); return; }

    const lang = e.target.closest("[data-lang]");
    if (lang) { setLang(lang.dataset.lang); return; }

    const bannerNav = e.target.closest("[data-banner-nav]");
    if (bannerNav) { showSection(bannerNav.dataset.bannerNav); return; }

    if (e.target.closest("#heroToggle")) { toggleHero(); return; }

    if (e.target.closest("[data-action='reload']")) { location.reload(); return; }

    const rankToggle = e.target.closest("[data-rank-toggle]");
    if (rankToggle) {
      const id = rankToggle.dataset.rankToggle;
      const det = document.querySelector(`[data-rank-detail="${id}"]`);
      if (det) {
        det.classList.toggle("hidden");
        if (det.classList.contains("hidden")) {
          _openRankDetails.delete(id);
        } else {
          _openRankDetails.add(id);
          if (det.dataset.lazy) {
            const entry = (state().entries || []).find(x => x.id === id);
            if (entry) det.innerHTML = picksTable(entry);
            delete det.dataset.lazy;
          }
        }
      }
      return;
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

    // Recalculate Monte Carlo (Probabilidades tab)
    if (e.target.closest('[data-action="recalcMC"]')) { recalcMC(); return; }

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
  $("#espnSync")?.addEventListener("click", () => runEspnUpdate().catch(err => { console.warn("ESPN update failed", err); showToast("Erro ESPN. Verifique o console.", "error"); }));
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
   July 4 — America 250 fireworks (canvas overlay, 8 s, today only)
   ============================================================ */
function launchJuly4Fireworks() {
  const d = new Date();
  if (d.getMonth() !== 6 || d.getDate() !== 4) return; // July 4 only
  const SEEN_KEY = "bolao_july4fw_2026";
  if (localStorage.getItem(SEEN_KEY)) return;
  localStorage.setItem(SEEN_KEY, "1");

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9998";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // US palette + gold
  const PAL = ["#BF0A30","#ffffff","#002868","#FFD700","#FF8C00","#AEE6FF"];
  const particles = [];

  function burst(x, y) {
    const n = 80 + (Math.random() * 40 | 0);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = Math.random() * 4.5 + 0.8;
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 1.2,
        color: PAL[Math.random() * PAL.length | 0],
        life: 1,
        decay: 0.010 + Math.random() * 0.016,
        r: 1.5 + Math.random() * 2
      });
    }
  }

  const endAt   = Date.now() + 8000;
  let nextBurst = Date.now() + 300;

  function frame() {
    // Clear to transparent so the page shows through — no dark overlay build-up
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = Date.now();
    if (now < endAt && now >= nextBurst) {
      burst(
        canvas.width  * (0.15 + Math.random() * 0.7),
        canvas.height * (0.08 + Math.random() * 0.40)
      );
      nextBurst = now + 450 + (Math.random() * 350 | 0);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx; p.y += p.vy;
      p.vy += 0.055; p.vx *= 0.99;
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (now < endAt || particles.length > 0) requestAnimationFrame(frame);
    else canvas.remove();
  }

  requestAnimationFrame(frame);
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
  applyArchiveMode();

  // Restore admin session if still valid
  if (isAdminActive()) {
    $("#adminLogin")?.classList.add("hidden");
    $("#adminArea")?.classList.remove("hidden");
    renderAdmin();
    startResultsPolling();
  }

  restoreDraft();
  startReopenPolling();
  startVersionPolling();
  setTimeout(launchJuly4Fireworks, 400); // brief settle, then launch
  setInterval(() => { if (!document.hidden) { updateCountdown(); renderNextMatch(); } }, 1000);
  startLiveScorePolling();
  // Pre-fetch Polymarket odds in background so match prob bars are ready before
  // the user visits the Probabilidades tab; re-renders games/next-match on arrival
  fetchPolymarketOdds().then(poly => { if (poly) { renderNextMatch(); renderGames?.(); } }).catch(() => {});
  setInterval(() => { if (!document.hidden) debouncedReload(); }, 30000);

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
  // iOS Safari can restore a backgrounded tab from bfcache without reliably
  // firing visibilitychange, leaving the page stuck on whatever state was in
  // memory at the last real load — force a resync whenever that happens.
  window.addEventListener("pageshow", e => { if (e.persisted) debouncedReload(); });

  // Disable entry nav button only after cutoff; default landing depends on cutoff
  const navEntryBtn = document.querySelector('.nav button[data-section="entry"]');
  if (navEntryBtn) navEntryBtn.disabled = isPastCutoff();
  showSection(isPastCutoff() ? "ranking" : "entry");
}

document.addEventListener("DOMContentLoaded", () => init().catch(err => console.error("Init failed", err)));

window.Bolao = { openReceipt, downloadReceipt, showSection };

})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bolao/copa2026/sw.js').catch(() => {});
}
