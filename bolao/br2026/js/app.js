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
// CSV/formula injection: a cell starting with =, +, -, @ (or tab/CR) can be read as a formula by
// Excel/Sheets when the exported file is opened — prefix with an apostrophe so it's always
// literal text. Real risk: entryName/payerName are free text fully controlled by whoever submits
// the entry form. Same fix as the Copa (bolao/js/app.js csvEscape()).
const csvEscape = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

// Mesmo algoritmo (FNV-32, não criptográfico, só identificação) e formato usado na Copa do
// Mundo e no CDB2026 (hashString/receiptCode em bolao/js/app.js e bolao/cdb2026/js/app.js) —
// padrão compartilhado da plataforma. Achado em auditoria (2026-07-14, Eduardo: "o email de
// comprovante do BR2026 é diferente do da CDB2026... tem que ser igual"): este app nunca teve
// essas duas funções — sendReceipt() usava um formato próprio (`BR2026-${id.slice(0,8)}`),
// divergente do padrão dos outros dois apps.
function hashString(str) {
  let h = 2166136261;
  for (const cp of str) { h ^= cp.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
function receiptCode(e) {
  return `BR2026-${hashString(JSON.stringify({ n: e.entryName, t: e.createdAt }))}-${String(e.createdAt || "").slice(0, 10).replace(/-/g, "")}`;
}

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
// IDs de entrada com o detalhe de palpites expandido no ranking — mesmo padrão da Copa
// (bolao/js/app.js), sobrevive a re-renders (sync, troca de idioma) até o usuário fechar.
const _openRankDetails = new Set();

function emptyState() {
  return { entries: [], deletedIds: [], paid: {}, results: null, cutoffAt: null, auditLog: [], meta: { updatedAt: null, version: C.siteVersion } };
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
    // Timeout de rede (item 50 do CONSISTENCY_MATRIX.md, 2026-07-15) -- este era o único fetch
    // do arquivo sem AbortController; sem timeout, uma resposta pendurada do Supabase travaria
    // o load/save indefinidamente, diferente dos fetches da ESPN que já passavam por fetchJson().
    const r = await fetchJson(`${url}/rest/v1/${table}?id=eq.${stateId}&select=state`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data?.[0]?.state) return;
    const merged = mergeStates(state(), data[0].state, { preferRemoteResults: true });
    localStorage.setItem(C.storeKey, JSON.stringify(merged));
  } catch (err) { console.warn("[BR2026] Supabase load failed", err); }
}

// Same pattern as the Copa (bolao/js/app.js reloadRemoteIfVisible/debouncedReload) — a single,
// debounced entry point for "resync from Supabase now" so visibilitychange/focus/pageshow firing
// close together (which they do) can't trigger overlapping fetches.
async function reloadRemoteIfVisible() {
  if (document.hidden || !C.database.enabled || _editingEntry) return;
  await loadRemoteState();
  renderAll();
}
let _reloadTimer = null;
function debouncedReload() {
  clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(() => reloadRemoteIfVisible().catch(err => console.warn("[BR2026] Reload failed", err)), 60);
}

async function saveRemoteState(s) {
  if (!C.database.enabled) return;
  const { url, anonKey, table, stateId } = C.database;
  await fetchJson(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: stateId, state: s })
  });
}
function mergeStates(local, remote, opts = {}) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  // Achado 2026-07-16 (Eduardo: renomeou duas entradas direto no Supabase, "não aparece
  // ainda") -- "local sempre vence" (versão anterior) escondia edições de admin pra sempre em
  // qualquer navegador que já tivesse a entrada em cache. Mesmo princípio já corrigido pro
  // cutoffAt no mesmo dia: preferir sempre o mais RECENTE, nunca um lado fixo -- só que aqui
  // por registro (cada entrada tem seu próprio updatedAt/createdAt), não por um único timestamp
  // global. Mesmo padrão que a Copa já usa (bolao/js/app.js mergeStates()).
  const byId = {};
  for (const e of (local.entries || [])) if (!deleted.has(e.id)) byId[e.id] = e;
  for (const e of (remote.entries || [])) {
    if (deleted.has(e.id)) continue;
    const existing = byId[e.id];
    if (!existing) { byId[e.id] = e; continue; }
    const remoteTs = e.updatedAt || e.createdAt || "";
    const localTs  = existing.updatedAt || existing.createdAt || "";
    if (remoteTs > localTs) byId[e.id] = e;
  }
  const paid = { ...(remote.paid || {}), ...(local.paid || {}) };
  let results;
  if (opts.preferRemoteResults) {
    results = remote.results?.locked ? remote.results : (local.results?.locked ? local.results : remote.results || local.results);
  } else {
    results = local.results?.locked ? local.results : (remote.results?.locked ? remote.results : local.results || remote.results);
  }
  // Merge audit logs: union by timestamp (unique per event), newest-first, cap 200 — same
  // pattern as Copa (bolao/js/app.js mergeStates()).
  const auditMap = new Map();
  for (const entry of [...(remote.auditLog || []), ...(local.auditLog || [])]) {
    auditMap.set(entry.ts, entry);
  }
  const mergedAuditLog = [...auditMap.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 200);
  return {
    entries: Object.values(byId),
    deletedIds: [...deleted],
    paid,
    results,
    // Uma vez congelado (freezeSeasonCutoff), nunca deve ser sobrescrito por null vindo de um
    // cliente mais antigo/desatualizado. Achado em 2026-07-16 (extensão manual de prazo pedida
    // por Eduardo): "local sempre vence" impedia justamente esse caso -- um navegador que já
    // tinha aberto a página antes da extensão manter o cutoffAt antigo em cache pra sempre,
    // mesmo depois do admin atualizar o Supabase. Corrigido para sempre preferir o valor MAIS
    // TARDE entre local e remoto (nunca o mais cedo, nunca null) -- preserva a proteção original
    // (cutoff nunca anda pra trás/some) e ainda deixa uma extensão manual se propagar de verdade.
    cutoffAt: (() => {
      if (!local.cutoffAt) return remote.cutoffAt || null;
      if (!remote.cutoffAt) return local.cutoffAt;
      return new Date(remote.cutoffAt).getTime() > new Date(local.cutoffAt).getTime() ? remote.cutoffAt : local.cutoffAt;
    })(),
    auditLog: mergedAuditLog,
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

// ─── Admin action safety: triple confirmation + audit journal ───────────────────────────────
// Eduardo, 2026-07-16: "make sure there's triple confirmation if I click incorrectly it can be
// rolled back easily... what I want to avoid is to fat finger something... we need to have a way
// to journal this so it can be rolled back if needed". Applies to locking/unlocking the official
// classification result (real money is paid out from it). Two confirm() dialogs alone can be
// blitzed through with fast taps on mobile; the third step requires typing a fixed word, which an
// accidental tap sequence cannot produce.
const ADMIN_CONFIRM_WORD = "CONFIRMAR";
function tripleConfirm(summaryMsg, detailMsg) {
  if (!confirm(summaryMsg)) return false;
  if (!confirm(detailMsg)) return false;
  const typed = prompt(t("tripleConfirmType").replace("{word}", ADMIN_CONFIRM_WORD));
  return typed === ADMIN_CONFIRM_WORD;
}
function appendAdminAuditLog(s, action, detail) {
  if (!Array.isArray(s.auditLog)) s.auditLog = [];
  s.auditLog.unshift({ ts: new Date().toISOString(), action, admin: true, detail });
  if (s.auditLog.length > 200) s.auditLog.length = 200;
}

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
// Regra confirmada por Eduardo (2026-07-14, comparando com Copa/CDB2026): "the cutoff should be
// until 1 hour before the first game". C.cutoffIso (config.js) era um valor ESTÁTICO, digitado
// manualmente e nunca mais atualizado -- ficou defasado (apontava pra 19/jul 23h59) enquanto o
// card "Próximo jogo" (que lê o calendário real da ESPN) já mostrava Botafogo x Santos em 16/jul,
// os dois discordando na mesma tela. Agora o cutoff é calculado a partir do MESMO jogo que o card
// "Próximo jogo" usa (nextUpcomingGame(), abaixo) assim que o calendário carrega, e então
// CONGELADO em s.cutoffAt (estado compartilhado via Supabase, nunca recalculado depois de
// definido) -- sem congelar, o "próximo jogo ainda não realizado" avançaria a cada rodada
// conforme jogos terminam, o que reabriria as entradas depois de fechadas (inaceitável: dinheiro
// real). C.cutoffIso continua existindo só como valor de fallback antes do primeiro congelamento
// (ex.: no instante entre o carregamento da página e o calendário responder).
function nextUpcomingGame() {
  const now = Date.now();
  return _schedule.find(g => g.state === "pre" && !g.postponed && new Date(g.dateISO).getTime() > now - 30 * 60 * 1000) || null;
}
function computeSeasonCutoffIso() {
  const g = nextUpcomingGame();
  if (!g) return null;
  const ms = new Date(g.dateISO).getTime();
  return Number.isFinite(ms) ? new Date(ms - 3600000).toISOString() : null;
}
function freezeSeasonCutoff(s) {
  if (s.cutoffAt) return false;
  const iso = computeSeasonCutoffIso();
  if (!iso) return false;
  s.cutoffAt = iso;
  return true;
}
const cutoffDate = () => new Date(state().cutoffAt || C.cutoffIso);
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
  if (isPastCutoff()) { showToast(t("closed"), "warn"); return; }
  const entryName    = $("entryName")?.value.trim() || "";
  const payerName    = $("payerName")?.value.trim() || "";
  const email        = $("participantEmail")?.value.trim() || "";
  const paymentMethod = $("paymentMethod")?.value || "";

  if (!entryName) { alert(t("errorEntryName")); return; }
  if (!payerName) { alert(t("requiredPayerName")); return; }
  if (!email || !email.includes("@")) { alert(t("errorEmail")); return; }
  if (!paymentMethod) { alert(t("requiredPaymentMethod")); return; }

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

    const wasNew = !_editingEntry;
    _editingEntry = null;
    renderPickForm();
    ["entryName", "payerName", "participantEmail"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    $("paymentMethod") && ($("paymentMethod").value = "");

    renderReceiptBox(entry);
    showToast(t("savedSuccess"), "success");
    if (!wasNew) showSection("ranking");
  } catch (err) {
    console.error("[BR2026] Save error", err);
    showToast(t("saveError"), "error");
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

// ─── Projeção do Bolão — índice de precisão (2026-07-14) ─────────────────────
// Puramente informativo: NUNCA usado em ranking, ordenação, desempate ou pontuação (essas
// continuam 100% baseadas em scoreEntry()/getActiveScore()/rankEntries(), intocados). Mede o
// quão perto o palpite original está da tabela atual, posição a posição, para dar ao
// participante um número além da pontuação -- não decide nada.
//
// G4/Z4: cada posição do palpite (1..4 e 17..20) tem uma posição real correspondente na tabela
// atual -- a "distância" é o deslocamento entre onde o participante colocou o time e onde ele
// está de verdade DENTRO do próprio grupo de 4 (0 = acertou a posição exata; 3 = o time picado
// para aquela posição está na ponta oposta do grupo, ou nem está no grupo -- distância máxima).
// SA6: é um conjunto de 6 times sem posição própria dentro do grupo (meio de tabela, posições
// 7-12) -- só faz sentido acerto/erro, não distância.
function accuracyMetrics(entry, g4Result, z4Result, sa6Result) {
  const pg4  = entry.picks?.g4  || [];
  const pz4  = entry.picks?.z4  || [];
  const psa6 = entry.picks?.sa6 || [];

  const distances = [];
  let exactPositions = 0, onePositionAway = 0, twoPositionsAway = 0;

  // Distância = |posição do slot que o participante escolheu para esse time − posição real do
  // time dentro do mesmo grupo hoje| (0 = acertou a posição exata). Precisa do índice do SLOT
  // (não só do time), senão "onde o time está de verdade" fica comparado contra 0 sempre, em vez
  // de contra a posição que o participante efetivamente palpitou.
  const groupDistance = (picked, slotIndex, resultArr) => {
    if (!picked || !resultArr || !resultArr.length) return null;
    const realIdx = resultArr.indexOf(picked);
    return realIdx === -1 ? resultArr.length : Math.abs(slotIndex - realIdx); // fora do grupo = distância máxima
  };

  [[pg4, g4Result], [pz4, z4Result]].forEach(([picks, result]) => {
    picks.forEach((picked, slotIndex) => {
      const d = groupDistance(picked, slotIndex, result);
      if (d == null) return;
      distances.push(d);
      if (d === 0) exactPositions++;
      else if (d === 1) onePositionAway++;
      else if (d === 2) twoPositionsAway++;
    });
  });

  const sa6Set = new Set(sa6Result || []);
  let sa6Hits = 0, sa6Total = 0;
  psa6.forEach(picked => { if (!picked) return; sa6Total++; if (sa6Set.has(picked)) sa6Hits++; });

  if (!distances.length && !sa6Total) {
    return { exactPositions: 0, onePositionAway: 0, twoPositionsAway: 0, totalPositionDistance: 0,
      averageDeviation: null, largestDeviation: null, accuracyIndex: null };
  }

  const totalPositionDistance = distances.reduce((a, b) => a + b, 0);
  // Maior distância possível dentro de um grupo de 4 é 3 -- normaliza a precisão posicional pra
  // uma escala 0..1 (1 = todas as posições exatas) independente de quantos palpites de G4/Z4 o
  // participante preencheu.
  const positionalAccuracy = distances.length ? 1 - (totalPositionDistance / (distances.length * 3)) : null;
  const sa6Accuracy = sa6Total ? sa6Hits / sa6Total : null;
  const parts = [positionalAccuracy, sa6Accuracy].filter(v => v != null);
  const accuracyIndex = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;

  return {
    exactPositions, onePositionAway, twoPositionsAway,
    totalPositionDistance,
    averageDeviation: distances.length ? totalPositionDistance / distances.length : null,
    largestDeviation: distances.length ? Math.max(...distances) : null,
    accuracyIndex, // 0..1 (ou null sem palpite nenhum comparável ainda) -- só informativo
  };
}

// ─── ESPN polling ────────────────────────────────────────────────────────────
let _standings  = [];   // sorted by rank (1st = index 0)
let _liveMatches = [];  // currently live matches
// Live-card expand/collapse: a full round often kicks off simultaneously (up to 10 games at
// once), so a wall of detailed cards with probability bars doesn't scan well. Each match keeps
// an independent expanded/collapsed state (user's choice always wins); the first time a given
// match id is seen, default it collapsed once there are more than 2 live games, expanded
// otherwise (see docs/bolao/BR2026_LIVE_STANDINGS.md).
let _liveExpanded = new Set(); // match ids currently showing full detail (probability bars)
let _liveSeenIds  = new Set(); // match ids that already got a default expand/collapse applied
let _schedule   = [];   // full season events from ESPN
let _scheduleTs = 0;    // last schedule fetch timestamp
let _mcResult   = null; // Monte Carlo result cache
let _mcTs       = 0;    // timestamp of last MC run
let _matchProbs   = {};   // { "HomeTeam|AwayTeam": { pH, pD, pA } } for upcoming matches
let _ratingsCache = null; // invalidated on each standings poll
let _teamLogos    = {};   // { teamName: logoUrl } parsed from ESPN standings

// ─── Live clock (ported from Copa, bolao/js/app.js — see PLATFORM_ARCHITECTURE.md
// "Golden master") ────────────────────────────────────────────────────────────
// Achado por Eduardo (2026-07-15, auditoria comparativa Copa/BR2026/CDB2026): o card "ao vivo"
// do BR2026 não tinha NENHUMA detecção de intervalo (halftime) nem proteção contra o relógio
// andar pra trás por lag da ESPN -- o filtro de partida ao vivo só olhava `state === "in"`, que
// a ESPN mantém "in" durante o intervalo também (o campo granular que muda é `type.name`, não
// `state`). Sem tratamento, o relógio simplesmente continuava extrapolando pra frente durante o
// intervalo inteiro (~15min), sem nunca mostrar "Intervalo" -- e como o card salvava o placar cru
// da ESPN a cada poll, um poll atrasado podia fazer o relógio parecer regredir por alguns
// segundos. Portado quase literalmente da Copa (mesmos nomes de função e mesma lógica) porque
// Eduardo pediu explicitamente "tem que bater exatamente com o da Copa" -- Brasileirão nunca tem
// prorrogação/pênaltis (liga, não mata-mata), mas o código mantém o tratamento de period 3/4/5
// mesmo assim, por defesa e paridade exata com a Copa, e porque não custa nada a mais.
const BR_HALF_BOUNDARIES_MIN = [120, 105, 90, 45];
const BR_PERIOD_BOUNDARY_MIN = { 1: 45, 2: 90, 3: 105, 4: 120 };
const BR_MAX_STOPPAGE_SECONDS = 8 * 60;

function brFmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatMatchClock(totalSeconds, period = null, skipBoundariesUpTo = 0) {
  const totalMinutes = totalSeconds / 60;
  if (period === 5) return brFmtClock(totalSeconds); // pênaltis — sem conceito de acréscimo
  const knownBoundary = period != null ? BR_PERIOD_BOUNDARY_MIN[period] : undefined;
  if (knownBoundary !== undefined) {
    if (totalMinutes <= knownBoundary) return brFmtClock(totalSeconds);
    const secsPastBoundary = totalSeconds - knownBoundary * 60;
    if (period === 4 && secsPastBoundary > BR_MAX_STOPPAGE_SECONDS) {
      return `${brFmtClock(knownBoundary * 60 + BR_MAX_STOPPAGE_SECONDS)} (+${BR_MAX_STOPPAGE_SECONDS / 60})`;
    }
    const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
    return `${brFmtClock(totalSeconds)} (+${stoppageMin})`;
  }
  const boundary = BR_HALF_BOUNDARIES_MIN.find(b => b > skipBoundariesUpTo && totalMinutes > b);
  if (!boundary) return brFmtClock(totalSeconds);
  const secsPastBoundary = totalSeconds - boundary * 60;
  if (secsPastBoundary > BR_MAX_STOPPAGE_SECONDS) return brFmtClock(totalSeconds);
  const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
  return `${brFmtClock(totalSeconds)} (+${stoppageMin})`;
}

const BR_CONFIRMED_BOUNDARY_KEY = "br2026_confirmed_half_boundary";
let _brConfirmedBoundary = {};
function loadConfirmedBoundary() {
  try { return JSON.parse(localStorage.getItem(BR_CONFIRMED_BOUNDARY_KEY) || "{}"); }
  catch { return {}; }
}
function saveConfirmedBoundary() {
  try { localStorage.setItem(BR_CONFIRMED_BOUNDARY_KEY, JSON.stringify(_brConfirmedBoundary)); }
  catch { /* storage full/unavailable */ }
}

// Monotônico: o relógio nunca anda pra trás, a não ser que a ESPN sinalize um reset de
// período legítimo (period mudou, ou o clock caiu perto de 0 vindo de perto de um boundary).
function mergeLiveClock(fresh, prev) {
  if (fresh.clockPaused) return fresh;
  if (!prev || prev.clockSeconds == null || fresh.clockSeconds == null) return fresh;
  const elapsed = (fresh.pollTime - prev.pollTime) / 1000;
  if (elapsed <= 0) return fresh;
  const extrapolated = prev.clockSeconds + elapsed;
  const behindBy = extrapolated - fresh.clockSeconds;
  if (behindBy <= 0) return fresh;
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

const BR_LIVE_CLOCK_CACHE_KEY = "br2026_live_clock_cache";
function loadLiveClockCache() {
  try { return JSON.parse(localStorage.getItem(BR_LIVE_CLOCK_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveLiveClockCache(scores) {
  try {
    const cache = {};
    for (const [id, ls] of Object.entries(scores)) {
      if (ls.clockSeconds != null) cache[id] = { clockSeconds: ls.clockSeconds, pollTime: ls.pollTime, period: ls.period ?? null };
    }
    localStorage.setItem(BR_LIVE_CLOCK_CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full/unavailable */ }
}

// Detecta um relógio genuinamente pausado (intervalo, pausa longa, VAR) comparando dois polls
// CRUS (não os já mesclados por mergeLiveClock) -- funciona mesmo quando o texto de status da
// ESPN pro intervalo não bate com nenhuma das nossas regras de reconhecimento de texto.
const BR_LIVE_CLOCK_RAW_CACHE_KEY = "br2026_live_clock_raw_cache";
let _brRawClockHistory = {};
function loadRawClockCache() {
  try { return JSON.parse(localStorage.getItem(BR_LIVE_CLOCK_RAW_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveRawClockCache(history) {
  try { localStorage.setItem(BR_LIVE_CLOCK_RAW_CACHE_KEY, JSON.stringify(history)); }
  catch { /* storage full/unavailable */ }
}
function detectClockPaused(freshRaw, prevRaw) {
  if (!prevRaw || prevRaw.clockSeconds == null || freshRaw.clockSeconds == null) return false;
  const realElapsed = (freshRaw.pollTime - prevRaw.pollTime) / 1000;
  if (realElapsed < 30) return false;
  const clockDelta = freshRaw.clockSeconds - prevRaw.clockSeconds;
  return clockDelta < realElapsed * 0.3;
}

function teamLogoImg(team, cls) {
  return _teamLogos[team]
    ? `<img src="${esc(_teamLogos[team])}" class="${cls || "match-logo"}" alt="" aria-hidden="true">`
    : "";
}

// ─── Payment icon ───────────────────────────────────────────────────────────
// Mesmos ícones/assinatura que payIcon() em bolao/js/app.js — ver DESIGN_SYSTEM.md "Pagamento".
const PAY_ICON_SVG = { CashApp: "assets/cashapp.svg", Zelle: "assets/zelle.svg", Venmo: "assets/venmo.svg" };
function payIcon(method) {
  const src = PAY_ICON_SVG[method];
  return src ? `<img src="${esc(src)}" alt="${esc(method)}" class="pay-method-icon">` : "💳";
}

// AbortController timeout wrapper — every ESPN fetch in this file goes through this so a hung
// request can't pile up across polls (see docs/bolao/BR2026_LIVE_STANDINGS.md "Higiene de rede").
async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 10000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ESPN's standings endpoint (v2/.../standings) and scoreboard/schedule endpoint
// (site/v2/.../scoreboard) occasionally disagree on a team's displayName -- found
// 2026-07-16 (Eduardo: Probabilidades showing Remo/Athletico Paranaense wildly wrong):
// standings returns "Athletico Paranaense" (matches DATA.teams), scoreboard returns
// "Athletico-PR". Every function downstream (buildRatings(), runMonteCarlo(), the
// standings-vs-schedule cross-reference) assumes both feeds use the same name for the
// same team -- a silent mismatch splits one team's data across two dictionary keys
// instead of erroring, which is exactly what happened: Athletico's simulated points
// accumulated under "Athletico-PR" while their starting total stayed frozen under
// "Athletico Paranaense", making them look relegation-bound despite being 4th place.
// Same alias-map pattern as bolao/scripts/send_result_email.py's ESPN_ALIASES, just
// applied client-side. Mirrors bolao/js/i18n.js scoping -- keep in sync by hand if
// ESPN renames a team.
const ESPN_SCOREBOARD_NAME_ALIASES = { "Athletico-PR": "Athletico Paranaense" };
function normalizeEspnTeamName(name) {
  return ESPN_SCOREBOARD_NAME_ALIASES[name] || name;
}

async function fetchStandings() {
  try {
    const r = await fetchJson(C.espn.standingsUrl);
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
        // Sem "|| 1" -- um time com 0 jogos de verdade (início de temporada/recém-promovido) tem
        // que aparecer como 0 na coluna "J" da tabela, não 1 (achado em auditoria, 2026-07-14).
        // A divisão em buildRatings() (linha ~817) já tem sua própria proteção independente
        // (Math.max(tm.played || 1, 1)) contra dividir por zero -- não depende deste valor.
        played: getStat("gamesPlayed", "GP"),
        wins:   getStat("wins"),
        draws:  getStat("ties", "draws"),
        losses: getStat("losses"),
        gf:     getStat("pointsFor", "goalsFor"),
        ga:     getStat("pointsAgainst", "goalsAgainst"),
        gd:     getStat("pointDifferential", "goalDifferential"),
      };
    // Ordenar só por `rank` da ESPN não é suficiente -- achado em auditoria (2026-07-14): logo
    // após uma rodada terminar, a ESPN pode devolver ranks empatados por um instante (antes do
    // desempate deles terminar de aplicar do lado deles), e a classificação PROVISÓRIA (G4/SA6/Z4)
    // é fatiada por índice fixo direto deste array -- um empate de rank podia errar a fronteira
    // entre zonas. Desempate próprio e determinístico: saldo de gols → gols pró → nome (nunca hoje
    // era a fonte oficial de pontuação, que sempre vem do resultado travado pelo admin).
    }).filter(entry => entry.name).sort((a, b) =>
      a.rank - b.rank || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name, "pt-BR")
    );
    // DATA.teams (lista fixa usada no formulário de palpite) e o nome ao vivo da ESPN (usado pra
    // pontuar) nunca são checados um contra o outro -- achado em auditoria (2026-07-14). Se a ESPN
    // mudar o `displayName` de um time, todo mundo que apostou nele passa a pontuar zero
    // silenciosamente (comparação por igualdade exata de string em scoreEntry()). Aviso no console
    // é o mínimo pra não deixar isso passar batido -- não é um erro fatal, o time ainda aparece na
    // tabela normalmente, só não bate com nenhuma opção do formulário.
    const knownTeams = new Set(DATA.teams || []);
    const unknown = parsed.filter(tm => !knownTeams.has(tm.name)).map(tm => tm.name);
    if (unknown.length) console.warn("[BR2026] Time(s) da ESPN sem correspondência em DATA.teams:", unknown);
    return parsed.length ? parsed : null;
  } catch (err) { console.warn("[BR2026] Standings fetch failed", err); return null; }
}

// Minute-by-minute plays feed (goals/cards/subs) — ported from Copa's extractMatchPlays
// (bolao/js/app.js), see PLATFORM_ARCHITECTURE.md "Golden master". Same comp.details array
// already fetched every poll for the live score/clock, no extra network call. side is
// "home"/"away" here (not Copa's "c0"/"c1"/"A"/"B" — BR2026 has no bracket-slot resolution,
// homeTeam/awayTeam are always the real team names already). Same "fails soft, never throws"
// contract: a shape mismatch degrades to an empty array, never breaks the live score/clock.
const PLAY_ICON = { goal: "⚽", yellow: "🟨", red: "🟥", sub: "🔄" };
function extractMatchPlays(comp) {
  try {
    const details = Array.isArray(comp.details) ? comp.details : [];
    const [c0, c1] = comp.competitors || [];
    const home = (comp.competitors || []).find(x => x.homeAway === "home") || c0;
    const away = (comp.competitors || []).find(x => x.homeAway === "away") || c1;
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
      if (teamId != null && home?.team?.id != null && String(teamId) === String(home.team.id)) side = "home";
      else if (teamId != null && away?.team?.id != null && String(teamId) === String(away.team.id)) side = "away";
      if (!side) continue;
      const clockVal = typeof d.clock?.value === "number" ? d.clock.value : null;
      const minute = d.clock?.displayValue || (clockVal != null ? `${Math.floor(clockVal / 60)}'` : "");
      const names = (d.athletesInvolved || [])
        .map(a => a?.displayName || a?.shortName)
        .filter(Boolean);
      // Substitution: show both names joined, without claiming which is in/out — that
      // ordering isn't confirmed against a real payload (same caveat as Copa's version).
      const text = kind === "sub" ? names.slice(0, 2).join(" ↔ ") : (names[0] || "");
      if (!text && !minute) continue;
      plays.push({ kind, side, minute, text, order: clockVal ?? 0 });
    }
    return plays.sort((a, b) => a.order - b.order);
  } catch (err) {
    console.warn("[BR2026] extractMatchPlays failed, skipping plays feed for this match", err);
    return [];
  }
}

function livePlaysHtml(plays, homeTeam, awayTeam, mid) {
  if (!Array.isArray(plays) || !plays.length) return "";
  const rows = [...plays].reverse().map(p => `<div class="live-plays-row">
    <span class="live-plays-minute">${esc(p.minute || "")}</span>
    <span class="live-plays-icon" aria-hidden="true">${PLAY_ICON[p.kind] || "•"}</span>
    ${teamLogoImg(p.side === "home" ? homeTeam : awayTeam, "team-logo")}
    <span class="live-plays-text">${esc(p.text || "")}</span>
  </div>`).join("");
  return `<div class="live-plays" data-plays-match="${esc(String(mid ?? ""))}">${rows}</div>`;
}

async function fetchScoreboard() {
  try {
    const r = await fetchJson(C.espn.scoreboardUrl + "?limit=20");
    const data = await r.json();
    return (data?.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const c    = comp.competitors || [];
      const home = c.find(x => x.homeAway === "home") || c[0];
      const away = c.find(x => x.homeAway === "away") || c[1];
      const clockSec = typeof comp.status?.clock === "number" ? comp.status.clock : null;
      const period   = typeof comp.status?.period === "number" ? comp.status.period : null;
      // Mesma detecção de intervalo/pênaltis da Copa (mapEspnToLiveScores) -- `state` da ESPN
      // continua "in" durante o intervalo, só `type.name`/texto do status muda.
      const statusName = (comp.status?.type?.name || "").toUpperCase();
      const statusText = `${comp.status?.type?.description || ""} ${comp.status?.type?.shortDetail || ""} ${comp.status?.type?.detail || ""}`.toLowerCase();
      const isHalftime = statusName.includes("HALFTIME") || /half.?time|intervalo|entretiempo/.test(statusText);
      const isPenalties = period === 5
        || statusName.includes("SHOOTOUT")
        || statusName.includes("PENALT")
        || statusName.includes("END_OF_EXTRATIME")
        || /penalt|pênalti|penales|\bpens\b|shootout|end of extra ?time/.test(statusText);
      return {
        id:        ev.id,
        state:     comp.status?.type?.state,
        homeTeam:  normalizeEspnTeamName(home?.team?.displayName || ""),
        awayTeam:  normalizeEspnTeamName(away?.team?.displayName || ""),
        homeScore: parseInt(home?.score || "0", 10),
        awayScore: parseInt(away?.score || "0", 10),
        clockSec,
        clockStr:  comp.status?.displayClock || "",
        period, isHalftime, isPenalties,
        plays: extractMatchPlays(comp),
      };
    }).filter(Boolean);
  } catch (err) { console.warn("[BR2026] Scoreboard fetch failed", err); return null; }
}

let _pollInFlight = false;

async function pollAll() {
  if (_pollInFlight) return; // a poll is already running — never overlap requests
  if (document.hidden) return; // resource hygiene — no network work while the tab isn't visible
  _pollInFlight = true;
  try {
    const [standings, matches] = await Promise.all([fetchStandings(), fetchScoreboard()]);
    // Antes exigia os DOIS endpoints falhando ao mesmo tempo pra engajar o backoff -- achado em
    // auditoria (2026-07-14): um dos dois falhando sozinho, de forma persistente (ex.: tabela 200
    // mas calendário 5xx), nunca reduzia a frequência do poll, batendo na ESPN a cada 60s
    // indefinidamente sem nenhum recuo.
    _pollFailed = !standings || matches === null;

    if (matches !== null) {
      const rawLive = matches.filter(m => m.state === "in");
      // Window state machine keyed off baseline presence (not _liveMatches, which resets to []
      // on every page load) so a reload mid-match keeps the same frozen baseline instead of
      // silently adopting a fresh, already-live one. See docs/bolao/BR2026_LIVE_STANDINGS.md
      // "Baseline" for the full priority order and the reload/two-tabs edge cases.
      if (rawLive.length > 0 && !_standingsBaseline) captureStandingsBaseline();
      if (rawLive.length === 0 && _standingsBaseline) clearStandingsBaseline();

      // Mesma orquestração de relógio da Copa (pollLiveScores): detecta pausa a partir de dois
      // polls CRUS, depois mescla o valor mesclado anterior com o novo pra nunca andar pra trás
      // (mergeLiveClock), a não ser que a ESPN sinalize um reset de período legítimo.
      const now = Date.now();
      const prevById = new Map(_liveMatches.map(m => [m.id, m]));
      const clockCache = loadLiveClockCache();
      if (!Object.keys(_brRawClockHistory).length) _brRawClockHistory = loadRawClockCache();
      const nextRawHistory = {};
      const nextLive = rawLive.map(m => {
        const rawFresh = { clockSeconds: m.clockSec, pollTime: now, period: m.period };
        const clockPaused = detectClockPaused(rawFresh, _brRawClockHistory[m.id]);
        if (m.clockSec != null) nextRawHistory[m.id] = { clockSeconds: m.clockSec, pollTime: now };
        const prevMerged = prevById.get(m.id) || clockCache[m.id];
        const merged = mergeLiveClock({ clockSeconds: m.clockSec, pollTime: now, period: m.period, clockPaused }, prevMerged);
        return { ...m, clockSeconds: merged.clockSeconds, pollTime: now, clockPaused };
      });
      _brRawClockHistory = nextRawHistory;
      saveRawClockCache(_brRawClockHistory);
      saveLiveClockCache(Object.fromEntries(nextLive.map(m => [m.id, m])));

      _liveMatches = nextLive;
      // Overlay fetched match states onto the schedule cache (including "post" so a finished
      // game doesn't stay stuck as "ao vivo" until the 5-min TTL expires). Matched by ESPN's
      // stable event id first — team-name comparison is only a fallback for rows the id can't
      // reach yet (e.g. schedule cache older than this poll's ids).
      matches.forEach(m => {
        let idx = m.id ? _schedule.findIndex(g => g.id === m.id) : -1;
        if (idx < 0) {
          idx = _schedule.findIndex(g =>
            (g.homeTeam === m.homeTeam && g.awayTeam === m.awayTeam) ||
            (g.homeTeam === m.awayTeam && g.awayTeam === m.homeTeam)
          );
        }
        if (idx >= 0) {
          _schedule[idx] = { ..._schedule[idx], state: m.state, homeScore: m.homeScore, awayScore: m.awayScore, clockStr: m.clockStr };
        }
      });
    }

    if (standings) {
      _standings    = standings;
      _matchProbs   = {};
      _ratingsCache = null;
      _teamLogos    = Object.fromEntries(standings.map(t => [t.name, t.logo]).filter(([,v]) => v));
      scheduleMC();
    }

    renderLiveCard();
    renderLiveRankingHero();
    renderStandingsCard();
    renderRanking();
    if (_schedule.length) { renderGamesSection(); renderNextGameCard(); }
    nudgeScrollReflow();
  } finally {
    _pollInFlight = false;
  }
}

// Vários cards (ao vivo, ranking ao vivo, próximo jogo, contagem regressiva) agora aparecem/somem
// dinamicamente a cada poll de 60s -- quando o conteúdo ENCOLHE (ex.: um jogo termina e o card
// "ao vivo" vira `.hidden`) enquanto a página está rolada perto do final, o Safari no iOS é
// conhecido por não recalcular a área rolável até uma interação nova, deixando um vão vazio
// "fantasma" abaixo do conteúdo real (Eduardo, screenshot, 2026-07-17: "Ainda tem bastante areas
// em branco ao final da pagina, isso tinha sido corrigido"). `scrollBy(0, 0)` não move a página
// (imperceptível), mas força o WebKit a recalcular os limites de rolagem -- correção padrão
// documentada pra esse bug específico do iOS. Roda só se já houver rolagem (sem custo/efeito
// quando a página está no topo).
function nudgeScrollReflow() {
  requestAnimationFrame(() => { if (window.scrollY > 0) window.scrollBy(0, 0); });
}

// Self-scheduling loop (not setInterval) so a slow poll can't overlap the next tick, and so a
// failed poll backs off instead of hammering ESPN every 60s. Same single loop as always — this
// does not add a second/parallel polling path.
let _pollBackoffMs = 0;
let _pollFailed    = false;
function schedulePoll() {
  const base  = C.espn.pollIntervalMs;
  const delay = _pollFailed ? Math.min(base * 4, base + _pollBackoffMs) : base;
  _pollBackoffMs = _pollFailed ? Math.min(_pollBackoffMs + base, base * 4) : 0;
  setTimeout(async () => { await pollAll(); schedulePoll(); }, delay);
}

// ─── Live club-standings movement ────────────────────────────────────────────
// Separate on purpose from participant-ranking movement below: separate storage key, separate
// pure function, separate output shape/labels/icons. Never merge the two — see
// docs/bolao/BR2026_LIVE_STANDINGS.md "Por que dois cálculos separados".
const STANDINGS_BASELINE_KEY = "bolao_br2026_standings_baseline_v1";
let _standingsBaseline = null; // { capturedAt, standings: [{name,abbr,logo,rank,points,played,wins,draws,losses,gf,ga,gd}] } | null

function loadStandingsBaseline() {
  try {
    const raw = sessionStorage.getItem(STANDINGS_BASELINE_KEY);
    _standingsBaseline = raw ? JSON.parse(raw) : null;
  } catch { _standingsBaseline = null; }
}
function captureStandingsBaseline() {
  // Only freeze a baseline from a snapshot we actually trust (full 20-team table fetched before
  // this window started). If the page just loaded mid-match there is no such snapshot yet — leave
  // the baseline null and the UI shows "unavailable" rather than a fabricated 0-movement.
  if (_standings.length < 20) { _standingsBaseline = null; saveStandingsBaseline(); return; }
  _standingsBaseline = { capturedAt: new Date().toISOString(), standings: _standings.map(t => ({ ...t })) };
  saveStandingsBaseline();
}
function clearStandingsBaseline() {
  _standingsBaseline = null;
  saveStandingsBaseline();
}
function saveStandingsBaseline() {
  try {
    if (_standingsBaseline) sessionStorage.setItem(STANDINGS_BASELINE_KEY, JSON.stringify(_standingsBaseline));
    else sessionStorage.removeItem(STANDINGS_BASELINE_KEY);
  } catch { /* storage full/unavailable — baseline just won't survive a reload this time */ }
}

function zoneForPosition(pos) {
  if (pos == null) return null;
  if (pos <= 4) return "g4";
  if (pos >= 7 && pos <= 12) return "sa6";
  if (pos >= 17) return "z4";
  return null;
}

// Matches still relevant to the open window that ESPN has already marked "post" (finished while
// the tab was open) — NOT the whole season's completed matches, or already-baselined results
// would be double counted.
function windowCompletedMatches() {
  if (!_standingsBaseline) return [];
  return _schedule.filter(g => g.state === "post" && !g.postponed && g.dateISO >= _standingsBaseline.capturedAt);
}

// Pure, side-effect-free — takes full snapshots in, returns a brand-new array, never mutates its
// inputs. Tie-break intentionally reuses only the criteria already coded elsewhere in this app
// (points, then goal difference — see runMonteCarlo()'s sort); BR2026 has no fuller CBF tiebreak
// chain (head-to-head etc.) implemented anywhere yet, so this does not invent one — see
// docs/bolao/BR2026_LIVE_STANDINGS.md "Critérios de desempate" for the documented limitation.
function calculateLiveStandings({ baselineStandings, liveMatches, completedMatches, tieBreakRules }) {
  if (!baselineStandings || !baselineStandings.length) return null;
  const rules = tieBreakRules || ["points", "goalDifference"];
  const table = new Map(baselineStandings.map(t => [t.name, {
    name: t.name, abbr: t.abbr, logo: t.logo, previousPosition: t.rank,
    points: t.points, played: t.played, wins: t.wins, draws: t.draws, losses: t.losses,
    gf: t.gf, ga: t.ga,
  }]));
  [...(liveMatches || []), ...(completedMatches || [])].forEach(m => {
    if (!m || m.postponed) return; // adiado/cancelado nunca altera a tabela ao vivo
    const home = table.get(m.homeTeam), away = table.get(m.awayTeam);
    if (!home || !away) return; // time desconhecido na baseline — ignora defensivamente
    const hg = Number(m.homeScore) || 0, ag = Number(m.awayScore) || 0;
    home.played++; away.played++;
    home.gf += hg; home.ga += ag;
    away.gf += ag; away.ga += hg;
    if (hg > ag)      { home.points += 3; home.wins++;  away.losses++; }
    else if (hg < ag) { away.points += 3; away.wins++;  home.losses++; }
    else              { home.points += 1; away.points += 1; home.draws++; away.draws++; }
  });
  const rows = [...table.values()].map(r => ({ ...r, gd: r.gf - r.ga }));
  rows.sort((a, b) => {
    for (const rule of rules) {
      if (rule === "points" && b.points !== a.points) return b.points - a.points;
      if (rule === "goalDifference" && b.gd !== a.gd) return b.gd - a.gd;
      if (rule === "goalsFor" && b.gf !== a.gf) return b.gf - a.gf;
    }
    // Sem critério para desempatar: preserva a ordem da baseline em vez de inventar um novo
    // critério ou depender da ordem de iteração do Map (não-determinística por nome).
    return (a.previousPosition ?? 99) - (b.previousPosition ?? 99);
  });
  return rows.map((r, i) => {
    const livePosition = i + 1;
    const movement = r.previousPosition != null ? r.previousPosition - livePosition : 0;
    return {
      teamName: r.name, abbr: r.abbr, logo: r.logo,
      previousPosition: r.previousPosition, livePosition, movement,
      pointsBeforeLive: baselineStandings.find(b => b.name === r.name)?.points ?? null,
      livePoints: r.points, played: r.played, wins: r.wins, draws: r.draws, losses: r.losses,
      goalsFor: r.gf, goalsAgainst: r.ga, goalDifference: r.gd,
      zoneBefore: zoneForPosition(r.previousPosition), liveZone: zoneForPosition(livePosition),
      sourceTimestamp: Date.now(),
    };
  });
}

function liveStandingsNow() {
  if (!_standingsBaseline) return null;
  return calculateLiveStandings({
    baselineStandings: _standingsBaseline.standings,
    liveMatches: _liveMatches,
    completedMatches: windowCompletedMatches(),
  });
}

// G4/Z4/SA6 team-name sets for "right now" -- prefers the LIVE-adjusted table
// (liveStandingsNow(), which folds in-progress match scores into the standings) over the raw
// ESPN table (_standings, which only updates once ESPN itself marks a match "post" and
// republishes). Bug found 2026-07-16 (Eduardo: "nao esta mostrando o ranking pra cima ou baixo
// de cada um baseado no resultado atual da rodada"): renderRanking()'s g4cur/z4cur/sa6cur used
// _standings directly, so the Ranking tab's provisional rank/movement arrows were frozen at
// whatever ESPN's table said BEFORE kickoff and only moved once the match fully ended and ESPN
// republished -- too late to be a live projection. Single source of truth for both
// renderRanking() and renderLiveRankingHero(), so they can never disagree about "current".
function currentResultSet() {
  const live = liveStandingsNow();
  if (live && live.length >= 20) {
    const sorted = [...live].sort((a, b) => a.livePosition - b.livePosition);
    return {
      g4:  sorted.slice(0, 4).map(r => r.teamName),
      z4:  sorted.slice(16, 20).map(r => r.teamName),
      sa6: sorted.slice(6, 12).map(r => r.teamName),
    };
  }
  return {
    g4:  _standings.length >= 4  ? _standings.slice(0, 4).map(tm => tm.name) : [],
    z4:  _standings.length >= 20 ? _standings.slice(16, 20).map(tm => tm.name) : [],
    sa6: _standings.length >= 12 ? _standings.slice(6, 12).map(tm => tm.name) : [],
  };
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

// Caixa de dígitos ao vivo (dias/horas/min/seg) para o card "Próximo jogo" -- mesmo algoritmo e
// mesma marcação (.count-grid + variante .four quando há dias) do contador da Copa
// (renderNextMatch() em bolao/js/app.js), só trocando a classe .next-match-timer por
// .next-game-timer (CSS local). Ver DESIGN_SYSTEM.md -- antes o "próximo jogo" só tinha texto
// inline ("6d 01h 13m"), divergência real encontrada por Eduardo.
function countdownTimerHtml(diffMs) {
  if (diffMs <= 0) return `<span class="next-game-live">${esc(t("matchStarted"))}</span>`;
  const totalS = Math.floor(diffMs / 1000);
  const d   = Math.floor(totalS / 86400);
  const h   = Math.floor((totalS % 86400) / 3600);
  const min = Math.floor((totalS % 3600) / 60);
  const sec = totalS % 60;
  const p2  = n => String(n).padStart(2, "0");
  const cells = d > 0
    ? [[d, t("countdownDays")], [p2(h), t("countdownHours")], [p2(min), t("countdownMin")], [p2(sec), t("countdownSec")]]
    : [[p2(h), t("countdownHours")], [p2(min), t("countdownMin")], [p2(sec), t("countdownSec")]];
  return `<div class="count-grid next-game-timer${d > 0 ? " four" : ""}">${
    cells.map(([v, l]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join("")
  }</div>`;
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
  } catch { /* corrupt/unparseable cache entry — fall through and refetch */ }
  try {
    const r = await fetchJson(C.espn.scheduleUrl, { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    _schedule = (data.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === "home") || comps[0];
      const away  = comps.find(c => c.homeAway === "away") || comps[1];
      const statusName = comp.status?.type?.name || "";
      return {
        id:        ev.id,
        dateISO:   comp.date || ev.date || "",
        state:     comp.status?.type?.state || "pre",
        detail:    comp.status?.type?.shortDetail || "",
        postponed: statusName === "Postponed" || statusName === "Canceled",
        homeTeam:  normalizeEspnTeamName(home?.team?.displayName || ""),
        awayTeam:  normalizeEspnTeamName(away?.team?.displayName || ""),
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

  // Naive per-game rating from standings averages -- used as the early-season fallback on its
  // own, and as a shrinkage anchor for the Dixon-Coles fit below once there's enough data.
  const LG_AVG = 1.3, MIN_R = 0.3;
  const naiveRatings = {};
  _standings.forEach(tm => {
    const n = Math.max(tm.played || 1, 1);
    naiveRatings[tm.name] = { atk: Math.max((tm.gf||0)/n/LG_AVG, MIN_R), def: Math.max((tm.ga||0)/n/LG_AVG, MIN_R) };
  });

  if (completed.length < 8) {
    _ratingsCache = naiveRatings;
    return naiveRatings;
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

  // Clamp bounds for α/β — achado 2026-07-16 (Eduardo: Probabilidades mostrando Remo com 0%
  // de chance de rebaixamento apesar de estar em 18º). O ajuste multiplicativo iterativo (sem
  // nenhum amortecimento) pode divergir pra um time com amostra pequena/ruidosa -- Remo tinha
  // atk=5.93 (quase 6x a força de um time médio) sem nada nos resultados reais dele que
  // justificasse isso, o que dava a ele um gol esperado de ~10 por partida e zerava sua chance
  // de rebaixamento em todas as 2000 simulações. [0.25, 3] é generoso o bastante pra refletir
  // diferença real de força entre o melhor e o pior time da liga sem permitir esse tipo de
  // explosão numérica.
  const MIN_RATING = 0.25, MAX_RATING = 3;
  const clamp = v => Math.min(MAX_RATING, Math.max(MIN_RATING, v));
  for (let iter = 0; iter < 50; iter++) {
    teams.forEach(t => {
      let obs = 0, exp = 0;
      sorted.forEach((m, i) => {
        const w = weights[i];
        if (m.homeTeam === t) { obs += w * m.homeScore; exp += w * alpha[t] * beta[m.awayTeam] * HOME_ADV; }
        if (m.awayTeam === t) { obs += w * m.awayScore; exp += w * alpha[t] * beta[m.homeTeam]; }
      });
      if (exp > 0) alpha[t] = clamp(alpha[t] * obs / exp);
    });
    teams.forEach(t => {
      let obs = 0, exp = 0;
      sorted.forEach((m, i) => {
        const w = weights[i];
        if (m.homeTeam === t) { obs += w * m.awayScore; exp += w * alpha[m.awayTeam] * beta[t]; }
        if (m.awayTeam === t) { obs += w * m.homeScore; exp += w * alpha[m.homeTeam] * beta[t] * HOME_ADV; }
      });
      if (exp > 0) beta[t] = clamp(beta[t] * obs / exp);
    });
    // Identifiability: set geometric mean of α = 1
    const gm = Math.exp(teams.reduce((s, t) => s + Math.log(Math.max(alpha[t], 1e-9)), 0) / teams.length);
    teams.forEach(t => { alpha[t] = clamp(alpha[t] / gm); beta[t] = clamp(beta[t] * gm); });
  }

  // Shrinkage toward the naive per-game rating -- achado 2026-07-16 (Eduardo: Remo mostrando
  // 0% de chance de rebaixamento apesar de estar em 18º/20, saldo -8). O clamp acima impede
  // valores impossíveis, mas não resolve a causa: o ajuste iterativo genuinamente DIVERGE pra
  // alguns times (Remo, Corinthians) até bater no teto, mesmo depois de reduzir iterações ou
  // adicionar amortecimento -- confirmado comparando o alpha ajustado contra gols reais/jogo de
  // cada um dos 20 times com os dados ao vivo da ESPN. Times cujo ajuste diverge ficam presos
  // no teto/piso independentemente de quantas iterações rodam, então o problema é estrutural
  // (um loop de realimentação entre pares de times), não falta de convergência. Puxar o
  // resultado final 70% em direção à média ingênua (gols/jogo) neutraliza a divergência sem
  // descartar o modelo inteiro -- times realmente fortes/fracos continuam se destacando
  // (Palmeiras/Flamengo seguem com G4 alto, Chapecoense/Vasco seguem com Z4 alto), só os casos
  // que davam valores fisicamente implausíveis deixam de zerar uma zona inteira.
  const SHRINK = 0.7;
  const ratings = { __dixonColes: true };
  teams.forEach(t => {
    const nv = naiveRatings[t] || { atk: 1, def: 1 };
    ratings[t] = { atk: clamp((1 - SHRINK) * alpha[t] + SHRINK * nv.atk), def: clamp((1 - SHRINK) * beta[t] + SHRINK * nv.def) };
  });
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
// Mesmo padrão da Copa (hero-live-card, ver formatMatchClock/runningClock em bolao/js/app.js):
// num intervalo/pênaltis/pausa real, mostra o rótulo fixo em vez de deixar a interpolação local
// continuar somando segundos através da pausa (era exatamente esse o bug encontrado em
// auditoria 2026-07-15 -- relógio subindo e descendo durante o intervalo inteiro, sem nunca
// indicar "Intervalo"). Compartilhado entre o card "ao vivo" e o card "próximo jogo" -- os dois
// mostravam o placar da mesma partida ao vivo, sem motivo pra duplicar a lógica.
// Achado real (screenshot de Eduardo, 2026-07-16): "um cronometro mostra só minutos e outro
// mostra minutos e segundos" -- pausado caía pro `m.clockStr` cru da ESPN ("51'", só minuto),
// rodando usava formatMatchClock() ("MM:SS"). Dois formatos diferentes pro MESMO elemento
// dependendo de um estado interno que o usuário nem vê. Corrigido pra sempre passar por
// formatMatchClock() quando `clockSeconds` existe -- pausado só significa não somar o tempo
// decorrido desde o último poll, nunca trocar de formato (mesmo princípio da Copa, que nunca
// teve essa bifurcação -- só esta cópia introduziu o bug).
function liveClockDisplay(m) {
  const clock = m.isHalftime ? t("liveHalftime")
    : m.isPenalties ? t("livePenalties")
    : m.clockSeconds != null
      ? formatMatchClock(
          m.clockPaused ? m.clockSeconds : m.clockSeconds + Math.floor((Date.now() - (m.pollTime || Date.now())) / 1000),
          m.period ?? null, 0)
      : m.clockStr;
  const sec = m.isHalftime || m.isPenalties || m.clockPaused
    ? m.clockSeconds
    : m.clockSeconds != null ? m.clockSeconds + Math.floor((Date.now() - (m.pollTime || Date.now())) / 1000) : null;
  return { clock, sec };
}

function renderLiveCard() {
  const card = $("liveMatchCard");
  if (!card) return;
  if (!_liveMatches.length) { card.classList.add("hidden"); return; }

  const liveIds = new Set(_liveMatches.map(m => m.id));
  // Prune ids for matches no longer live, so the Sets don't grow across a long session.
  [..._liveSeenIds].forEach(id => { if (!liveIds.has(id)) _liveSeenIds.delete(id); });
  [..._liveExpanded].forEach(id => { if (!liveIds.has(id)) _liveExpanded.delete(id); });
  // First time a match id shows up: default expanded when it's just 1-2 games, collapsed once
  // a full round kicks off together — the user's own toggle always wins after that.
  const defaultExpanded = _liveMatches.length <= 2;
  _liveMatches.forEach(m => {
    if (_liveSeenIds.has(m.id)) return;
    _liveSeenIds.add(m.id);
    if (defaultExpanded) _liveExpanded.add(m.id);
  });

  const header = _liveMatches.length > 1
    ? `<div class="live-header">🔴 ${_liveMatches.length} ${esc(t("liveMatchesLabel"))}</div>` : "";

  // Posição atual na tabela + seta de movimento por time, mesma fonte (calculateLiveStandings)
  // já usada na tabela de classificação — Eduardo pediu explicitamente "mostrar a posicao atual
  // de cada time com uma seta pra cima ou baixo" no card ao vivo (2026-07-16), não só na tabela.
  const liveTable = liveStandingsNow();
  const teamPosHtml = (teamName) => {
    if (!liveTable) return "";
    const row = liveTable.find(r => r.teamName === teamName);
    if (!row) return "";
    return `<span class="live-team-pos">${row.livePosition}º${standingsMovementHtml(row)}</span>`;
  };
  const teamColHtml = (teamName) => `<div class="live-team">
    <div class="live-team-logo-box">${teamLogoImg(teamName)}</div>
    <span class="live-team-name">${esc(teamName)}</span>
    ${teamPosHtml(teamName)}
  </div>`;

  const rows = _liveMatches.map(m => {
    const { clock, sec } = liveClockDisplay(m);
    const expanded = _liveExpanded.has(m.id);
    // In-play probability bars (only when standings are loaded)
    let probBarsHtml = "";
    if (_standings.length >= 20) {
      const ratings = buildRatings();
      const { lambdaH, lambdaA } = expectedGoals(m.homeTeam, m.awayTeam, ratings);
      const minute = sec !== null ? Math.floor(sec / 60) : parseMinute(m.clockStr);
      const { pH, pD, pA } = inPlayProb(lambdaH, lambdaA, minute, m.homeScore, m.awayScore);
      const homeLbl = esc(m.homeTeam.split(" ")[0]);
      const awayLbl = esc(m.awayTeam.split(" ")[0]);
      const hPct = Math.round(pH * 100), dPct = Math.round(pD * 100), aPct = Math.round(pA * 100);
      // Mesmo limiar de 12% usado nas outras 3 chamadas de prob-bars deste arquivo (renderGamesSection,
      // renderNextGameCard, renderRanking) -- faltava aqui, causando o nome do time estourar a fatia
      // estreita da barra (achado 2026-07-16, ex.: "Palmeiras 12%" cortado pra "neiras").
      const barLabel = (pct, name) => pct >= 12 ? `${name} ${pct}%` : `${pct}%`;
      probBarsHtml = `<div class="prob-bars" role="group" aria-label="Probabilidades da partida">
        <div class="prob-bar home" style="width:${hPct}%">${barLabel(hPct, homeLbl)}</div>
        <div class="prob-bar draw"  style="width:${dPct}%">Emp ${dPct}%</div>
        <div class="prob-bar away"  style="width:${aPct}%">${barLabel(aPct, awayLbl)}</div>
      </div>`;
    }
    // Mesma estrutura horizontal da Copa (hero-live-top: time | placar | badge+relógio | placar |
    // time, ver bolao/js/app.js renderNextMatch()) -- Eduardo: "faca igual da copa do mundo, voce
    // sabe mais que isso" (2026-07-16). A pilha vertical anterior (badge/times/posições/relógio
    // cada um em sua própria linha, com bastante espaço vazio entre elas) não seguia o padrão
    // visual canônico da plataforma (ver CLAUDE.md "Copa do Mundo 2026 é a referência visual
    // canônica"/PLATFORM_GOVERNANCE.md "Golden master") -- só a Copa tinha essa estrutura testada.
    const rowInner = `
      <div class="live-top">
        ${teamColHtml(m.homeTeam)}
        <div class="live-score">${m.homeScore}</div>
        <div class="live-center">
          <span class="live-badge">${esc(t("liveNow"))}</span>
          <span class="live-clock">${esc(clock)}</span>
        </div>
        <div class="live-score">${m.awayScore}</div>
        ${teamColHtml(m.awayTeam)}
      </div>`;
    const playsHtml = livePlaysHtml(m.plays, m.homeTeam, m.awayTeam, m.id);
    const detailHtml = playsHtml + probBarsHtml;
    // The whole row is the tap target (not just a small chevron) — better mobile touch target
    // than an icon-only button. Only made toggleable when there's actually a detail underneath
    // (plays feed and/or probability bars); otherwise it's a plain, non-interactive row.
    const row = detailHtml
      ? `<button type="button" class="live-match-row" data-live-toggle="${esc(m.id)}"
           aria-expanded="${expanded}" aria-label="${esc(expanded ? t("liveToggleCollapse") : t("liveToggleExpand"))}">
          ${rowInner}
          <span class="live-chevron" aria-hidden="true">${expanded ? "▲" : "▼"}</span>
        </button>`
      : `<div class="live-match-row">${rowInner}</div>`;
    return `<div class="live-match">
      ${row}
      ${detailHtml ? `<div class="live-match-detail${expanded ? "" : " hidden"}">${detailHtml}</div>` : ""}
    </div>`;
  }).join("");

  const savedPlaysScroll = {};
  card.querySelectorAll(".live-plays[data-plays-match]").forEach(el => {
    if (el.scrollTop > 0) savedPlaysScroll[el.dataset.playsMatch] = el.scrollTop;
  });
  card.innerHTML = header + `<div class="live-match-grid">${rows}</div>`;
  card.querySelectorAll(".live-plays[data-plays-match]").forEach(el => {
    const s = savedPlaysScroll[el.dataset.playsMatch];
    if (s) el.scrollTop = s;
  });
  card.querySelectorAll("[data-live-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.liveToggle;
    if (_liveExpanded.has(id)) _liveExpanded.delete(id); else _liveExpanded.add(id);
    renderLiveCard();
  }));
  card.classList.remove("hidden");
}

// ─── Render: live ranking hero ────────────────────────────────────────────────
// "Quem está subindo/descendo no ranking com o placar ao vivo atual" -- Eduardo pediu
// explicitamente um hero nesse estilo, "mesmo estilo da Copa" (hero-live-points), logo abaixo
// do card de jogos ao vivo (2026-07-16). Reaproveita o cálculo já usado nas setas do Ranking
// (calculateRankingMovement — ver docs/bolao/BR2026_LIVE_STANDINGS.md), só muda ONDE é
// mostrado — nenhum cálculo novo. Só aparece com jogo(s) ao vivo, baseline confiável, e pelo
// menos um participante realmente subindo/descendo — sem isso fica escondido (Eduardo: "se
// ficar ruim ou muito busy deixa de fora"), nunca mostra uma tabela parada sem nada relevante.
function renderLiveRankingHero() {
  const card = $("liveRankingHero");
  if (!card) return;
  if (!_liveMatches.length) { card.classList.add("hidden"); return; }

  const s = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  const locked  = s.results?.locked;
  if (!entries.length || locked || _standings.length < 20) { card.classList.add("hidden"); return; }

  const baseline = rankingBaselineResultSet();
  if (!baseline) { card.classList.add("hidden"); return; }

  const cur = currentResultSet();
  const movement = calculateRankingMovement({ entries, baseline, live: cur });
  const scored   = rankEntries(entries, cur.g4, cur.z4, cur.sa6).sort((a, b) => a.rank - b.rank);
  const hasMover = scored.some(item => {
    const mv = movement.get(item.e.id);
    return mv && (mv.status === "up" || mv.status === "down");
  });
  // Só mostra o hero quando há de fato alguém subindo/descendo com o placar atual -- lista
  // parada, ninguém se mexendo, não é uma "projeção ao vivo" interessante de mostrar (Eduardo:
  // "se ficar ruim ou muito busy deixa de fora"). Mas UMA VEZ que aparece, mostra TODO MUNDO
  // (não só quem se move), com scroll -- Eduardo: "no ranking so aparece da 4 posicao pra baixo,
  // tem que aparecer todos, pode scrolar mas deixa pelo menos 4-5 no topo" (2026-07-16). Filtrar
  // pra só os movers cortava a lista de um jeito que parecia estar faltando gente do topo.
  if (!hasMover) { card.classList.add("hidden"); return; }

  const rows = scored.map(item => {
    const mv = movement.get(item.e.id);
    return `<tr>
    <td style="text-align:center">${item.rank}${rankMovementHtml(mv)}</td>
    <td>${esc(item.e.entryName)}</td>
    <td style="text-align:center"><b class="pick-pts${item.total > 0 ? " pos" : ""}">${item.total}</b></td>
  </tr>`;
  }).join("");

  card.innerHTML = `
    <div class="live-header">🏆 ${esc(t("liveRankingHeroTitle"))}</div>
    <div class="live-ranking-scroll">
      <table class="live-ranking-table">
        <thead><tr>
          <th style="text-align:center">${esc(t("liveRankingHeroPosCol"))}</th>
          <th>${esc(t("liveRankingHeroEntryCol"))}</th>
          <th style="text-align:center">${esc(t("liveRankingHeroPtsCol"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="footer-note" style="margin-top:8px">${esc(t("liveRankingHeroNote"))}</p>`;
  card.classList.remove("hidden");
}

// ─── Render: next game card ──────────────────────────────────────────────────
function renderNextGameCard() {
  const card = $("nextGameCard");
  if (!card || !_schedule.length) { card?.classList.add("hidden"); return; }

  const todayKey    = brtDateKey(new Date().toISOString());
  // Jogos ao vivo já aparecem no card "🔴 N jogos ao vivo agora" (renderLiveCard()) -- achado
  // 2026-07-16 (Eduardo: "se ja esta mostrando ao vivo, nao precisa mostrar duas vezes").
  // Exclui aqui pra não duplicar; jogos "pre" (ainda não começaram) e "post" (já terminaram)
  // continuam aparecendo normalmente.
  const liveKeys    = new Set(_liveMatches.map(m => `${m.homeTeam}|${m.awayTeam}`));
  const todayGames  = _schedule
    .filter(g => brtDateKey(g.dateISO) === todayKey)
    .filter(g => !liveKeys.has(`${g.homeTeam}|${g.awayTeam}`));

  // Sem jogo hoje: mostra TODOS os jogos do próximo dia com jogo, não só o primeiro em ordem
  // cronológica -- achado real (2026-07-16, Eduardo: "proximo jogo mostra somente um, mas amanha
  // tem mais, mostre proximos jogos quando ha mais de um no mesmo dia"). nextUpcomingGame() em si
  // não muda (ainda usado pelo congelamento do cutoff -- precisa continuar sendo um único jogo
  // fixo); só a exibição aqui passa a agrupar por dia.
  let groupLabel = "todayGamesLabel";
  let groupDateLabel = "";
  let gamesToShow = todayGames;
  if (!gamesToShow.length) {
    const next = nextUpcomingGame();
    if (next) {
      const nextDayKey = brtDateKey(next.dateISO);
      gamesToShow = _schedule.filter(g => g.state === "pre" && !g.postponed && brtDateKey(g.dateISO) === nextDayKey);
      groupLabel = "nextGamesLabel";
      // Todos os jogos deste grupo são do mesmo dia (filtrado por nextDayKey acima) -- um
      // subtítulo só, não repetido por linha (cada linha já mostra o horário).
      groupDateLabel = new Date(next.dateISO).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" });
    }
  }

  // Sem jogo hoje e só 1 jogo no próximo dia: mantém o layout rico de sempre (contador regressivo
  // em dígitos grandes, local do jogo) em vez da lista compacta -- essa é a experiência original
  // de "próximo jogo", só perdida quando o agrupamento por dia (acima) passou a reaproveitar o
  // mesmo item compacto do "jogos de hoje" pra todo mundo. Eduardo: "A contagem regressiva dos
  // próximos jogos sumiu" (2026-07-16). Lista compacta (sem contador em dígitos) continua só
  // quando há hoje, ou mais de um jogo no próximo dia -- mesmo comportamento de antes desta
  // rodada de mudanças pro caso "hoje".
  if (groupLabel === "nextGamesLabel" && gamesToShow.length === 1) {
    const next    = gamesToShow[0];
    const now     = Date.now();
    const timeStr = brtLongDate(next.dateISO) + " BRT";
    const diffMs  = new Date(next.dateISO).getTime() - now;
    const timerHtml = countdownTimerHtml(diffMs);

    const mpKeyNext = `${next.homeTeam}|${next.awayTeam}`;
    if (!_matchProbs[mpKeyNext] && _standings.length >= 20) {
      const r = buildRatings();
      const { lambdaH, lambdaA } = expectedGoals(next.homeTeam, next.awayTeam, r);
      _matchProbs[mpKeyNext] = matchProb(lambdaH, lambdaA);
    }
    const mpNext = _matchProbs[mpKeyNext];
    const nextBars = mpNext ? (() => {
      const hPct = Math.round(mpNext.pH * 100), dPct = Math.round(mpNext.pD * 100), aPct = Math.round(mpNext.pA * 100);
      const hLbl = esc(next.homeTeam.length > 12 ? next.homeTeam.slice(0, 12) + "…" : next.homeTeam);
      const aLbl = esc(next.awayTeam.length > 12 ? next.awayTeam.slice(0, 12) + "…" : next.awayTeam);
      const bl = (pct, name) => pct >= 12 ? `${name} ${pct}%` : `${pct}%`;
      return `<div class="prob-bars" role="group" aria-label="Probabilidades">
        <div class="prob-bar home" style="width:${hPct}%">${bl(hPct, hLbl)}</div>
        <div class="prob-bar draw"  style="width:${dPct}%">Emp ${dPct}%</div>
        <div class="prob-bar away"  style="width:${aPct}%">${bl(aPct, aLbl)}</div>
      </div>`;
    })() : "";
    card.innerHTML = `<div class="next-game-card">
      <div class="next-game-label">${esc(t("nextGameLabel"))}</div>
      <div class="next-game-row">
        <div class="next-game-info-block">
          <div class="next-game-teams">${esc(next.homeTeam)} ${teamLogoImg(next.homeTeam, "team-logo")} <span class="next-game-vs">×</span> ${teamLogoImg(next.awayTeam, "team-logo")} ${esc(next.awayTeam)}</div>
          <div class="next-game-info">${esc(timeStr)}</div>
          ${next.venue ? `<div class="next-game-venue">${esc(next.venue)}${next.city ? `, ${esc(next.city)}` : ""}</div>` : ""}
        </div>
        ${timerHtml}
      </div>
      ${nextBars}
    </div>`;
    card.classList.remove("hidden");
    return;
  }

  if (gamesToShow.length) {
    const items = gamesToShow.map(g => {
      if (g.state === "post") {
        return `<div class="today-game today-game-post">
          <div class="today-game-teams muted">${esc(g.homeTeam)} ${teamLogoImg(g.homeTeam, "team-logo")} <span>${g.homeScore ?? 0} – ${g.awayScore ?? 0}</span> ${teamLogoImg(g.awayTeam, "team-logo")} ${esc(g.awayTeam)}</div>
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
        // No team badge in the bar — matches bolao/js/app.js's probBarsMarkup
        // exactly (plain "Team NN%", same 12% threshold for dropping the
        // name on a narrow slice). Badges were cluttering the label and
        // pulling it off the visual center.
        const heroBars = mp ? (() => {
          const hPct = Math.round(mp.pH * 100), dPct = Math.round(mp.pD * 100), aPct = Math.round(mp.pA * 100);
          const hLbl = esc(g.homeTeam.length > 12 ? g.homeTeam.slice(0, 12) + "…" : g.homeTeam);
          const aLbl = esc(g.awayTeam.length > 12 ? g.awayTeam.slice(0, 12) + "…" : g.awayTeam);
          const bl = (pct, name) => pct >= 12 ? `${name} ${pct}%` : `${pct}%`;
          return `<div class="prob-bars" role="group" aria-label="Probabilidades da partida">
            <div class="prob-bar home" style="width:${hPct}%">${bl(hPct, hLbl)}</div>
            <div class="prob-bar draw"  style="width:${dPct}%">Emp ${dPct}%</div>
            <div class="prob-bar away"  style="width:${aPct}%">${bl(aPct, aLbl)}</div>
          </div>`;
        })() : "";
        return `<div class="today-game">
          <div class="today-game-teams">${esc(g.homeTeam)} ${teamLogoImg(g.homeTeam, "team-logo")} <span class="next-game-vs">×</span> ${teamLogoImg(g.awayTeam, "team-logo")} ${esc(g.awayTeam)}</div>
          <span class="today-game-time muted">${esc(timeStr)} BRT${esc(countdown)}</span>
          ${heroBars}
        </div>`;
      }
    }).join("");

    card.innerHTML = `<div class="next-game-card">
      <div class="today-games-header">${esc(t(groupLabel))}${groupDateLabel ? ` · ${esc(groupDateLabel)}` : ""}</div>
      ${items}
    </div>`;
    card.classList.remove("hidden");
    return;
  }

  card.classList.add("hidden");
}

// Club-table movement glyph — separate markup/classes/i18n keys from the participant ranking's
// rankMovementHtml() above (movement vs rank-movement namespaces never mix).
function standingsMovementHtml(mv) {
  if (!mv || mv.previousPosition == null) {
    return `<span class="movement movement-unavailable" title="${esc(t("standingsMovementUnavailable"))}"><span class="visually-hidden">${esc(t("standingsMovementUnavailable"))}</span>–</span>`;
  }
  if (mv.movement === 0) {
    const label = t("standingsMovementSame").replace("{pos}", mv.livePosition);
    return `<span class="movement movement-same" title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span>•</span>`;
  }
  const status = mv.movement > 0 ? "up" : "down";
  const n     = Math.abs(mv.movement);
  const label = (status === "up" ? t("standingsMovementUp") : t("standingsMovementDown"))
    .replace("{n}", n).replace("{previous}", mv.previousPosition).replace("{current}", mv.livePosition);
  const glyph = status === "up" ? "▲" : "▼";
  return `<span class="movement movement-${status}" title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span>${glyph}<span class="movement-n" aria-hidden="true">${n}</span></span>`;
}

// ─── Render: standings table ─────────────────────────────────────────────────
function renderStandingsCard() {
  const card = $("standingsCard");
  if (!card) return;
  if (!_standings.length) {
    card.innerHTML = `<p class="muted">${esc(t("standingsLoading"))}</p>`;
    return;
  }
  // While a match window is open, the table itself re-sorts to live position (like the sports
  // apps this feature is modeled on) — annotating a delta badge onto ESPN's still-official row
  // order would not actually show "posição ao vivo atual" as asked. Outside a window, fall back
  // to ESPN's own order (unavailable movement, no fabricated position).
  const live = liveStandingsNow();
  const rowsSource = live
    ? live.map(r => ({
        name: r.teamName, pos: r.livePosition, points: r.livePoints, played: r.played,
        wins: r.wins, draws: r.draws, losses: r.losses, gf: r.goalsFor, ga: r.goalsAgainst,
        gd: r.goalDifference, mv: r,
      }))
    : _standings.map((team, i) => ({
        name: team.name, pos: i + 1, points: team.points, played: team.played,
        wins: team.wins, draws: team.draws, losses: team.losses, gf: team.gf, ga: team.ga,
        gd: team.gd, mv: null,
      }));
  const rows = rowsSource.map(row => {
    const pos       = row.pos;
    const zoneClass = pos <= 4 ? "g4-zone" : (pos >= 7 && pos <= 12) ? "sa6-zone" : pos >= 17 ? "z4-zone" : "";
    const badge     = pos <= 4
      ? `<span class="zone-badge g4-badge">G4</span>`
      : (pos >= 7 && pos <= 12)
        ? `<span class="zone-badge sa6-badge">${esc(t("standingsZoneSA"))}</span>`
        : pos >= 17
          ? `<span class="zone-badge z4-badge">Z4</span>`
          : "";
    const gd = Math.round(row.gd);
    return `<tr class="${zoneClass}">
      <td class="td-pos">${pos}</td>
      <td class="td-mov">${standingsMovementHtml(row.mv)}</td>
      <td class="td-team"><span class="td-team-name" title="${esc(row.name)}">${esc(row.name)}</span>${badge}</td>
      <td class="td-pts">${Math.round(row.points)}</td>
      <td>${Math.round(row.played)}</td>
      <td>${Math.round(row.wins)}</td>
      <td>${Math.round(row.draws)}</td>
      <td>${Math.round(row.losses)}</td>
      <td>${Math.round(row.gf)}</td>
      <td>${Math.round(row.ga)}</td>
      <td>${gd > 0 ? "+" + gd : gd}</td>
    </tr>`;
  }).join("");
  const disclaimer = live
    ? `<p class="footer-note live-standings-disclaimer">${esc(t("liveTableDisclaimer"))}</p>` : "";
  card.innerHTML = `
    <h3>${esc(t("standingsTitle"))}</h3>
    <div class="standings-wrap">
      <table class="standings-table">
        <thead><tr>
          <th class="td-pos">#</th><th class="td-mov">${esc(t("standingsMovCol"))}</th>
          <th class="td-team">${esc(t("team"))}</th><th class="td-pts">Pts</th>
          <th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${disclaimer}
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
      if (g.postponed) {
        scoreOrTime = `<span class="game-time muted">—</span>`;
        statusHtml  = `<span class="game-status postponed">${esc(t("gamePostponed"))}</span>`;
      } else if (g.state === "in") {
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
        const hLabel = esc(g.homeTeam.length > 12 ? g.homeTeam.slice(0, 12) + "…" : g.homeTeam);
        const aLabel = esc(g.awayTeam.length > 12 ? g.awayTeam.slice(0, 12) + "…" : g.awayTeam);
        // No team badge in the bar (matches bolao/js/app.js's probBarsMarkup) —
        // drop the name below 12% to avoid overflow, same threshold too.
        const barLabel = (pct, name) => pct >= 12 ? `${name} ${pct}%` : `${pct}%`;
        probBarsHtml = `<div class="prob-bars" role="group" aria-label="Probabilidades da partida">
          <div class="prob-bar home" style="width:${hPct}%" title="${esc(g.homeTeam)}: ${hPct}%">${barLabel(hPct, hLabel)}</div>
          <div class="prob-bar draw"  style="width:${dPct}%" title="Emp: ${dPct}%">Emp ${dPct}%</div>
          <div class="prob-bar away"  style="width:${aPct}%" title="${esc(g.awayTeam)}: ${aPct}%">${barLabel(aPct, aLabel)}</div>
        </div>`;
      }
      const homeLogo = _teamLogos[g.homeTeam] ? `<img src="${esc(_teamLogos[g.homeTeam])}" class="match-logo" alt="" aria-hidden="true">` : "";
      const awayLogo = _teamLogos[g.awayTeam] ? `<img src="${esc(_teamLogos[g.awayTeam])}" class="match-logo" alt="" aria-hidden="true">` : "";
      const partida  = gameNum.has(g.id) ? `<span class="game-number">Partida ${gameNum.get(g.id)}</span>` : "";
      const venueStr = g.venue ? `${esc(g.venue)}${g.city ? `, ${esc(g.city)}` : ""}` : "";
      const metaParts = [statusHtml, partida, venueStr].filter(Boolean);
      html += `<div class="game-card ${esc(g.state || "pre")}">
        <div class="game-matchup">
          <div class="match-team home"><span class="match-team-name home-name">${esc(g.homeTeam)}</span>${homeLogo}</div>
          <div class="match-center">${scoreOrTime}</div>
          <div class="match-team away">${awayLogo}<span class="match-team-name away-name">${esc(g.awayTeam)}</span></div>
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

// Single source of truth for "score entries against a result set, then rank them" — used for the
// displayed ranking AND for both sides of the ranking-movement comparison below, so baseline rank
// and live rank can never drift apart from what renderRanking() actually shows (see CLAUDE.md
// "send_result_email.py had silently drifted from the site's own scoring logic" — same class of
// bug, avoided here by only ever having one implementation of this comparator).
function rankEntries(entries, g4Result, z4Result, sa6Result) {
  const scored = entries.map(e => {
    const sc = scoreEntry(e, g4Result, z4Result, sa6Result) || { total: 0, detail: null };
    return { e, ...sc };
  }).sort((a, b) =>
    b.total - a.total ||
    countSA6Hits(b.detail) - countSA6Hits(a.detail) ||
    countG4Exact(b.e, g4Result) - countG4Exact(a.e, g4Result) ||
    countZ4Exact(b.e, z4Result) - countZ4Exact(a.e, z4Result) ||
    b.e.entryName.localeCompare(a.e.entryName, "pt-BR")
  );
  // Rank deve avançar sempre que QUALQUER nível do desempate mudar, não só o total — mesmo padrão
  // da Copa (bolao/js/app.js renderRanking(), chave composta `${total}:${exact}:${podiumHits}`).
  // Bug real encontrado em auditoria (2026-07-14): comparar só `item.total` deixava duas entradas
  // com o mesmo total mas desempate diferente (ex.: acertos de SA6 diferentes) mostrando o MESMO
  // rank/medalha, mesmo com o array já ordenado corretamente — afeta diretamente quem aparece
  // como 2º/3º lugar, base do rateio de prêmio (70/20/10%).
  let rank = 0, prevKey = null;
  return scored.map((item, i) => {
    const key = `${item.total}:${countSA6Hits(item.detail)}:${countG4Exact(item.e, g4Result)}:${countZ4Exact(item.e, z4Result)}`;
    if (key !== prevKey) { rank = i + 1; prevKey = key; }
    return { ...item, rank };
  });
}

// ─── Participant ranking movement ────────────────────────────────────────────────────────────
// Deliberately separate from calculateLiveStandings() above: own inputs, own output shape, own
// caller, own CSS/i18n (rank-movement-*, not the club's movement-*). Never merge — see
// docs/bolao/BR2026_LIVE_STANDINGS.md "Por que dois cálculos separados".
//
// Uses the stateless official-vs-provisional pattern already proven correct in the Copa
// (bolao/js/app.js liveMatchPointsTable(): recomputed fully fresh from two full snapshots every
// call, nothing persisted between calls) — NOT the Copa's other, flawed ranking-arrow pattern
// (computeRankArrows()/_rankArrowState: baseline = last render, resets on reload). Eduardo
// confirmed building BR2026 on the correct pattern and diverging from the flawed one on purpose.
function calculateRankingMovement({ entries, baseline, live }) {
  if (!entries || !entries.length) return new Map();
  const liveRanked = rankEntries(entries, live.g4, live.z4, live.sa6);
  if (!baseline) {
    // No trustworthy pre-window snapshot yet (e.g. page loaded mid-match) — never fabricate
    // movement; mark it explicitly unavailable instead.
    return new Map(liveRanked.map(x => [x.e.id, { rank: x.rank, total: x.total, previousRank: null, movement: null, status: "unavailable" }]));
  }
  const baseRanked   = rankEntries(entries, baseline.g4, baseline.z4, baseline.sa6);
  const baseRankById = new Map(baseRanked.map(x => [x.e.id, x.rank]));
  return new Map(liveRanked.map(x => {
    const previousRank = baseRankById.has(x.e.id) ? baseRankById.get(x.e.id) : null;
    const movement = previousRank != null ? previousRank - x.rank : null;
    const status = movement == null ? "unavailable" : movement > 0 ? "up" : movement < 0 ? "down" : "same";
    return [x.e.id, { rank: x.rank, total: x.total, previousRank, movement, status }];
  }));
}

// Baseline G4/Z4/SA6 name arrays for the ranking comparison, derived from the SAME frozen
// standings snapshot the club table uses (_standingsBaseline) — sharing the raw data source is
// fine; it's the calculation/state/labels/icons that must stay separate, not the inputs.
function rankingBaselineResultSet() {
  if (!_standingsBaseline || _standingsBaseline.standings.length < 20) return null;
  const st = _standingsBaseline.standings;
  return {
    g4:  st.slice(0, 4).map(tm => tm.name),
    z4:  st.slice(16, 20).map(tm => tm.name),
    sa6: st.slice(6, 12).map(tm => tm.name),
  };
}

// Participant-ranking movement glyph — separate markup/classes/i18n keys from the club table's
// standingsMovementHtml() below (movement vs rank-movement namespaces never mix).
function rankMovementHtml(mv) {
  if (!mv || mv.status === "unavailable") {
    return ` <span class="movement movement-unavailable" title="${esc(t("rankMovementUnavailable"))}"><span class="visually-hidden">${esc(t("rankMovementUnavailable"))}</span>–</span>`;
  }
  if (mv.status === "same") {
    return ` <span class="movement movement-same" title="${esc(t("rankMovementSame"))}"><span class="visually-hidden">${esc(t("rankMovementSame"))}</span>•</span>`;
  }
  const n     = Math.abs(mv.movement);
  const label = (mv.status === "up" ? t("rankMovementUp") : t("rankMovementDown")).replace("{n}", n);
  const glyph = mv.status === "up" ? "▲" : "▼";
  return ` <span class="movement movement-${mv.status}" title="${esc(label)}"><span class="visually-hidden">${esc(label)}</span>${glyph}<span class="movement-n" aria-hidden="true">${n}</span></span>`;
}

// ─── Render: ranking ─────────────────────────────────────────────────────────
function renderRanking() {
  const box = $("rankingList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));

  // Mesmo lugar/cálculo da Copa (renderRanking(), bolao/js/app.js) -- achado em auditoria
  // (2026-07-15): o Pot só aparecia na barra de estatísticas de Participantes, sem equivalente
  // na Copa, que mostra no cabeçalho do Ranking.
  const paidCount = entries.filter(e => (s.paid || {})[e.id]).length;
  const potEl = $("potValue");
  if (potEl) potEl.textContent = `$${paidCount * (C.entryFee || 5)}`;

  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }

  // Tiebreaker reference arrays: when results are officially locked, use locked
  // values to ensure tiebreakers match the final score calculation exactly.
  const locked = s.results?.locked;
  const isOfficial = !!(locked && s.results?.g4 && s.results?.z4);
  const cur    = locked ? { g4: s.results?.g4 || [], z4: s.results?.z4 || [], sa6: s.results?.sa6 || [] } : currentResultSet();
  const g4cur  = cur.g4, z4cur = cur.z4, sa6cur = cur.sa6;

  const scored = rankEntries(entries, g4cur, z4cur, sa6cur);

  // Ranking movement is a separate, additive calculation — see calculateRankingMovement() above.
  // Only meaningful while the season is still live; once results are locked there is no more
  // "live window" to compare against.
  const rankMovement = locked ? null : calculateRankingMovement({
    entries, baseline: rankingBaselineResultSet(), live: { g4: g4cur, z4: z4cur, sa6: sa6cur },
  });

  const hasAnyProvisional = !isOfficial && _standings.length >= 20;
  const provNote = hasAnyProvisional
    ? `<p class="prov-note">↕ ${esc(t("provisionalNote"))}</p>` : "";

  // Estrutura densa de 1 linha (.rank-row) + detalhe expansível (.picks-detail) — mesmo padrão
  // da Copa (bolao/js/app.js renderRanking()), ver DESIGN_SYSTEM.md "Ranking — estrutura do
  // card". Cada entrada gera dois elementos irmãos, não um card único empilhado.
  // Pago/Pendente é informação de administração do bolão, não do ranking público -- mesmo
  // padrão da Copa (renderRanking(), bolao/js/app.js), que nunca mostrou esse badge na linha do
  // ranking (só existe na aba Participantes). Achado real (2026-07-16, Eduardo: "nao precisa
  // pago e pendente, so para o admin"). "Ver palpites" só faz sentido depois do prazo -- antes
  // disso o botão só levava a uma mensagem "escondido até o prazo" (o dado em si já estava
  // protegido dentro de renderPickDisplay(), mas o botão continuava visível e clicável sem
  // fazer nada útil).
  const canViewPicks = isPastCutoff();
  box.innerHTML = provNote;
  scored.forEach(item => {
    const rank      = item.rank;
    const medal     = { 1: "🥇", 2: "🥈", 3: "🥉" }[rank] || `${rank}`;
    const mv        = rankMovement?.get(item.e.id);
    const viewBtn   = canViewPicks
      ? `<button type="button" class="secondary small-btn" data-rank-toggle="${esc(item.e.id)}" aria-expanded="${_openRankDetails.has(item.e.id)}" aria-label="${esc(t("viewPicks"))} — ${esc(item.e.entryName || "")}">${esc(t("viewPicks"))}</button>`
      : "";
    const row = document.createElement("div");
    row.className = "rank-row";
    // Pontos sempre no mesmo estilo (verde, número puro sem "pts") -- Copa e CDB2026 nunca
    // coloriram de amarelo/trocaram o rótulo por "↕" pra sinalizar "provisório" (isso já é
    // comunicado pelo prov-note no topo da lista). Eduardo: "no ranking mostra a pontuacao em
    // amarelo e com uma seta para cima e baixo, deveria ser igual copa e copa do brasil"
    // (2026-07-16) -- a seta de movimento (rankMovementHtml) é intencional e fica; só o
    // amarelo/"↕" nos pontos saiu. O sufixo " pts" saiu depois (mesmo dia): a coluna de pontos
    // no mobile tem largura FIXA de 40px (pra o botão "Ver palpites" nunca deslocar conforme o
    // placar tem 1-3 dígitos, ver CSS) -- dimensionada só pros dígitos, igual a Copa (que também
    // nunca mostrou "pts" aqui). Com o sufixo, "170 pts" não cabia numa linha só e quebrava --
    // Eduardo: "Deixe tudo da entrada em uma linha e sem crlf".
    row.innerHTML = `
      <div class="rank-pos">${medal}${rankMovementHtml(mv)}</div>
      <div><b>${esc(item.e.entryName)}</b></div>
      <div class="points">${item.total}</div>
      ${viewBtn}`;
    box.appendChild(row);
    if (canViewPicks) {
      const detail = document.createElement("div");
      detail.className = `card picks-detail${_openRankDetails.has(item.e.id) ? "" : " hidden"}`;
      detail.dataset.rankDetail = item.e.id;
      detail.innerHTML = renderPickDisplay(item.e, item.detail, { g4: g4cur, z4: z4cur, sa6: sa6cur, isOfficial });
      box.appendChild(detail);
    }
  });

  box.querySelectorAll("[data-rank-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const id  = btn.dataset.rankToggle;
    const det = box.querySelector(`[data-rank-detail="${id}"]`);
    if (!det) return;
    det.classList.toggle("hidden");
    if (det.classList.contains("hidden")) _openRankDetails.delete(id);
    else _openRankDetails.add(id);
    btn.setAttribute("aria-expanded", String(!det.classList.contains("hidden")));
  }));
}

function renderPickDisplay(entry, detail, resultSet) {
  // Achado real (2026-07-14, Eduardo: "ver palpites nao pode estar aberto ate o Brasileirão
  // iniciar, senao as pessoas podem copiar") -- mesma proteção que a Copa já tem
  // (hideFuturePicks() em bolao/js/app.js), nunca implementada aqui: nada impedia expandir
  // "Ver palpites" de qualquer entrada, a qualquer momento, mesmo antes do prazo -- outro
  // participante podia literalmente copiar o palpite de alguém antes de enviar o seu.
  if (!isPastCutoff()) return `<p class="muted">${esc(t("picksHiddenUntilCutoff"))}</p>`;
  // Achado real (2026-07-14, Eduardo: "a visualizacao de ver palpites da CDB tambem esta
  // inconsistente com a da copa"): esta função usava um card em grid de 2-3 colunas
  // (.picks-display/.pick-item/.pick-cell), estrutura totalmente diferente da Copa, que usa
  // <table> dentro de .picks-detail (mesmas classes de CSS: .picks-detail table/th/td, ver
  // bolao/css/styles.css). Reconstruído para usar a MESMA estrutura de tabela -- só o conteúdo
  // muda por torneio (posição/time em vez de partida/placar/vencedor).
  const p          = entry.picks || {};
  const g4         = p.g4  || [];
  const sa6        = p.sa6 || [];
  const z4         = p.z4  || [];
  const g4Labels   = ["pos1","pos2","pos3","pos4"].map(t);
  const z4Labels   = ["pos17","pos18","pos19","pos20"].map(t);

  const cellClass = d => d ? (d.type === "exact" ? "pick-exact" : d.type === "group" ? "pick-group" : d.type === "hit" ? "pick-exact" : "pick-miss") : "";
  const ptsCell = d => d
    ? `<b class="pick-pts${d.pts > 0 ? " pos" : ""}">${d.pts > 0 ? "+" + d.pts : "—"}</b>`
    : `<span class="muted">—</span>`;

  const groupTable = (title, teams, labels, details) => {
    const rows = teams.map((team, i) => {
      const d = details?.[i];
      return `<tr class="${cellClass(d)}"><td>${esc(labels[i] || String(i + 1))}</td><td><b>${esc(team || "—")}</b></td><td style="text-align:center">${ptsCell(d)}</td></tr>`;
    }).join("");
    return `<h4 style="margin:14px 0 4px">${esc(title)}</h4>
      <table><thead><tr><th>${esc(t("receiptColPos"))}</th><th>${esc(t("receiptColTeam"))}</th><th style="text-align:center">Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const hasSA6 = sa6.some(Boolean);

  // Projeção do Bolão -- índice de precisão + maiores divergências (Fase 4 da spec, 2026-07-14).
  // Só aparece na fase de projeção (não oficial ainda) -- uma vez os resultados travados
  // (`resultSet.isOfficial`), a pontuação já é definitiva e essa seção informativa não faz mais
  // sentido (accuracyMetrics() continua correta mas deixa de ser exibida, evitando confundir
  // "precisão da projeção" com "resultado final"). Sem resultSet (ex.: e-mail de comprovante, que
  // reusa esta mesma função) a seção simplesmente não aparece -- puramente aditivo.
  let accuracyBlock = "";
  if (resultSet && !resultSet.isOfficial) {
    const acc = accuracyMetrics(entry, resultSet.g4, resultSet.z4, resultSet.sa6);
    const pct = acc.accuracyIndex != null ? `${Math.round(acc.accuracyIndex * 100)}%` : "—";

    const divergences = [];
    // Mesmo cálculo de distância que accuracyMetrics() usa (slot palpitado vs. posição real) --
    // nunca comparar contra 0 fixo, senão "divergência" vira só "índice real do time", ignorando
    // pra qual posição o participante efetivamente palpitou.
    const pushDiv = (picks, labels, result, groupLabel) => picks.forEach((picked, i) => {
      if (!picked) return;
      const realIdx = result.indexOf(picked);
      const distance = realIdx === -1 ? result.length : Math.abs(i - realIdx);
      if (distance === 0) return; // acertou -- não é divergência
      divergences.push({ team: picked, pickedLabel: labels[i], groupLabel, distance, realIdx });
    });
    pushDiv(g4, g4Labels, resultSet.g4 || [], t("receiptGroupG4"));
    pushDiv(z4, z4Labels, resultSet.z4 || [], t("receiptGroupZ4"));
    divergences.sort((a, b) => b.distance - a.distance);
    const top5 = divergences.slice(0, 5);

    const divRows = top5.map(d => {
      const realPos = d.realIdx === -1 ? t("accuracyOutsideGroup") : `${d.groupLabel} #${d.realIdx + 1}`;
      return `<tr><td>${esc(d.team)}</td><td>${esc(d.pickedLabel)}</td><td>${esc(realPos)}</td></tr>`;
    }).join("");

    accuracyBlock = `
      <div class="accuracy-summary">
        <span>${esc(t("accuracyIndexLabel"))}: <b>${pct}</b></span>
        <span>${esc(t("accuracyExactLabel"))}: <b>${acc.exactPositions}</b></span>
      </div>
      ${top5.length ? `<h4 style="margin:14px 0 4px">${esc(t("accuracyTopDivergencesTitle"))}</h4>
      <table><thead><tr><th>${esc(t("receiptColTeam"))}</th><th>${esc(t("accuracyColPicked"))}</th><th>${esc(t("accuracyColCurrent"))}</th></tr></thead>
      <tbody>${divRows}</tbody></table>` : ""}`;
  }

  // Sem wrapper próprio -- o container externo (renderRanking(), <div class="card picks-detail">)
  // já carrega essa classe, igual ao padrão da Copa (picksTable() também não se auto-envolve).
  return `${groupTable(t("receiptGroupG4"), g4, g4Labels, detail?.g4)}
    ${hasSA6 ? groupTable(t("receiptGroupSA6"), sa6, sa6.map((_, i) => `SA ${i + 1}`), detail?.sa6) : ""}
    ${groupTable(t("receiptGroupZ4"), z4, z4Labels, detail?.z4)}
    ${accuracyBlock}`;
}

// ─── Render: participants ─────────────────────────────────────────────────────
// Estrutura idêntica à Copa (.rank-row, ícone + nome/pagador/método + chip de status —
// bolao/js/app.js renderParticipants()) -- achado em auditoria (2026-07-15, Eduardo: "as telas
// de participantes e ranking tem formatos... diferentes da Copa" / "tudo precisa permanecer
// 100% igual a nao ser que nao se aplique"). Antes usava .participant-row (componente próprio,
// sem ícone, sem método de pagamento) e uma barra de estatísticas (total/pagas/pot) sem
// equivalente NENHUM na Copa -- removida; o Pot agora vive só no cabeçalho do Ranking
// (#potValue), igual à Copa.
function renderParticipants() {
  const box = $("participantsList");
  if (!box) return;
  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  if (!entries.length) { box.innerHTML = `<p class="muted">${esc(t("noEntries"))}</p>`; return; }
  box.innerHTML = entries.map(e => {
      const isPaid = (s.paid || {})[e.id];
      return `<div class="rank-row participant-row">
        <div>👤</div>
        <div><b>${esc(e.entryName)}</b><br><span class="muted">${esc(e.payerName || "")} · ${esc(e.paymentMethod || "")}</span></div>
        <span class="${isPaid ? "paid-badge" : "unpaid-badge"}">${esc(isPaid ? t("paid") : t("unpaid"))}</span>
      </div>`;
  }).join("");
}

// ─── Render: payment ─────────────────────────────────────────────────────────
// Mesma estrutura de card (ícone + nome + handle) da Copa (bolao/js/app.js renderPayment()) —
// ver DESIGN_SYSTEM.md "Pagamento".
function renderPayment() {
  const box = $("paymentMethods");
  if (!box) return;
  box.innerHTML = Object.entries(C.paymentMethods).map(([method, handle]) => {
    const link       = C.paymentLinks?.[method];
    const handleHtml = link
      ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(handle)}</a>`
      : esc(handle);
    const qr = method === "Zelle" && C.zelle?.qrImage
      ? `<img src="${esc(C.zelle.qrImage)}" alt="QR Zelle" class="pay-qr">` : "";
    return `<div class="card pay-card">
      <div class="pay-icon">${payIcon(method)}</div>
      <div><strong>${esc(method)}</strong><br><span>${handleHtml}</span>${qr}</div>
    </div>`;
  }).join("");
}

// Prévia do método de pagamento dentro do formulário de entrada (mostra handle/QR assim que o
// participante seleciona, sem precisar navegar até a aba Pagamento) -- item novo encontrado em
// auditoria (2026-07-15): a Copa tem esse recurso (renderPaymentBox()/#paymentBox,
// bolao/js/app.js) desde sempre, nenhum dos outros dois apps tinha. Portado exatamente.
function renderPaymentBox() {
  const method = $("paymentMethod")?.value;
  const box = $("paymentBox");
  if (!box) return;
  if (!method) { box.innerHTML = ""; return; }
  const handle = esc(C.paymentMethods[method] || "");
  const link = C.paymentLinks?.[method] || "";
  const qr = method === "Zelle" && C.zelle?.qrImage
    ? `<img src="${esc(C.zelle.qrImage)}" alt="QR Zelle" class="pay-qr">` : "";
  box.innerHTML = `<div class="pay-card">
    <div class="pay-icon">${payIcon(method)}</div>
    <div><b>${esc(method)}</b><br><span class="muted">${handle}</span>
    ${link ? `<br><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t("paymentOpenLink"))}</a>` : ""}${qr}</div></div>`;
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
  renderAdminAuditLog(s);
}

function renderAdminAuditLog(s) {
  const box = $("adminAuditLog");
  if (!box) return;
  const log = Array.isArray(s.auditLog) ? s.auditLog : [];
  box.innerHTML = `<h3>${esc(t("auditLogTitle"))}</h3>`;
  if (!log.length) { box.innerHTML += `<p class="muted">${esc(t("auditLogEmpty"))}</p>`; return; }
  const rows = log.slice(0, 100).map(entry => {
    const ts = new Date(entry.ts).toLocaleString("pt-BR", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
    const d = entry.detail || {};
    return `<div class="audit-row">
      <div class="audit-meta">
        <span class="muted" style="font-size:11px">${esc(ts)} ET</span>
        <b>${esc(t(`auditAction_${entry.action.replace(/-/g, "_")}`) || entry.action)}</b>
      </div>
      <div style="font-size:11px;color:#667;margin-top:2px;word-break:break-all">${esc(JSON.stringify(d))}</div>
    </div>`;
  }).join("");
  box.innerHTML += rows;
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

// Bug real encontrado em auditoria (2026-07-14): renderAdminResults() reconstrói o painel inteiro
// (14 <select> de resultado oficial) toda vez que renderAdmin() roda, inclusive no resync de 30s
// -- sem essa checagem, um admin destravando um resultado pra corrigir e editando alguns campos
// podia ter tudo revertido pro valor salvo anterior no meio da edição, sem perceber, e salvar por
// cima sem querer. Mesmo princípio do pickFormIsDirty() já usado no formulário de palpite.
function resultsFormIsDirty() {
  const box = document.getElementById("adminResults");
  if (!box) return false;
  const r = state().results || {};
  const savedG4  = r.g4  || ["", "", "", ""];
  const savedSa6 = r.sa6 || ["", "", "", "", "", ""];
  const savedZ4  = r.z4  || ["", "", "", ""];
  const cur = (prefix, n) => [...Array(n)].map((_, i) => box.querySelector(`#adm-${prefix}-${i}`)?.value || "");
  const g4  = cur("g4", 4), sa6 = cur("sa", 6), z4 = cur("z4", 4);
  const diff = (a, b) => a.some((v, i) => v !== (b[i] || ""));
  return diff(g4, savedG4) || diff(sa6, savedSa6) || diff(z4, savedZ4);
}
function renderAdminResults(s) {
  const box    = $("adminResults");
  if (!box) return;
  if (resultsFormIsDirty()) return;
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
    if (!standings || standings.length < 20) { showToast("ESPN fetch failed — try again.", "error"); return; }
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
    // Time duplicado DENTRO do mesmo grupo -- achado em auditoria (2026-07-14): o formulário de
    // palpite do participante (validatePicks()) já bloqueia isso, o formulário de resultado
    // OFICIAL do admin nunca checava. Um mis-click travando o mesmo time duas vezes no G4/SA6/Z4
    // corrompe a pontuação de todo mundo que apostou em qualquer uma das posições envolvidas.
    if (new Set(g4).size  < g4.length)  { alert(t("errorDuplicateG4"));  return; }
    if (new Set(sa6).size < sa6.length) { alert(t("errorDuplicateSA6")); return; }
    if (new Set(z4).size  < z4.length)  { alert(t("errorDuplicateZ4"));  return; }
    const overlap    = g4.filter(v => z4.includes(v));
    if (overlap.length) { alert(t("errorG4Z4Overlap").replace("{teams}", overlap.join(", "))); return; }
    const sa6g4 = sa6.filter(v => v && g4.includes(v));
    const sa6z4 = sa6.filter(v => v && z4.includes(v));
    if (sa6g4.length || sa6z4.length) {
      alert(t("errorSA6Overlap").replace("{teams}", [...sa6g4, ...sa6z4].join(", "))); return;
    }
    if (!tripleConfirm(t("confirmLockResults"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    s2.results = { locked: true, g4, sa6, z4, lockedAt: new Date().toISOString() };
    appendAdminAuditLog(s2, "lock-results", { g4, sa6, z4 });
    saveState(s2);
    showToast(t("resultsSaved"), "success");
    renderAdmin();
  });

  $("unlockResultsBtn")?.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!tripleConfirm(t("confirmUnlockResults"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    appendAdminAuditLog(s2, "unlock-results", { previousG4: s2.results?.g4, previousSa6: s2.results?.sa6, previousZ4: s2.results?.z4, previousLockedAt: s2.results?.lockedAt });
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
      renderPaymentBox();
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
      .map(csvEscape).join(",");
  });
  // CRLF, não LF -- Excel no Windows renderiza mal um CSV com quebra de linha bare-LF. Mesmo
  // bug já corrigido uma vez na Copa (CHANGELOG v3.0) e no CDB2026 (v2.0); BR2026 nunca tinha
  // recebido a correção (CONSISTENCY_MATRIX.md item 14).
  const blob = new Blob([header + "\r\n" + rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `bolao-br2026-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ─── Export JSON backup / Clear all data (admin) ────────────────────────────
// Itens 7/16 do CONSISTENCY_MATRIX.md (2026-07-15) -- BR2026 era o único dos três apps sem
// backup JSON bruto nem botão de limpar dados; portado quase literalmente do CDB2026
// (exportJsonBackup()/clearAllData(), bolao/cdb2026/js/app.js).
function exportJsonBackup() {
  const s    = state();
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `br2026_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

async function clearAllData() {
  if (!confirm(t("clearDataConfirm"))) return;
  localStorage.removeItem(C.storeKey);
  if (C.database.enabled) {
    try {
      const { url, anonKey, table, stateId } = C.database;
      await fetchJson(`${url}/rest/v1/${table}?id=eq.${stateId}`, {
        method: "DELETE",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
      });
    } catch (err) { console.warn("[BR2026] Clear remote failed", err); }
  }
  renderAll();
}

// ─── Email receipt ───────────────────────────────────────────────────────────
// Mesma estrutura/CSS visual do comprovante da Copa (receiptHtml() em bolao/js/app.js) e do
// CDB2026 -- achado em auditoria (2026-07-14): os três apps tinham um e-mail de comprovante
// visualmente diferente entre si (tema escuro/Inter aqui, tabela sem estilo no CDB2026, tema
// claro/Arial na Copa). Alinhado ao padrão canônico da Copa (tema claro, cartão branco,
// grade `.meta`, código em monospace, tabela com cabeçalho escuro) -- só o CONTEÚDO muda por
// torneio (G4/Sul-Americana/Z4 em vez de partidas do bracket), como previsto em
// PLATFORM_GOVERNANCE.md ("diferenças específicas de torneio devem ser preservadas").
function receiptHtml(entry) {
  const g4  = entry.picks?.g4  || [];
  const sa6 = entry.picks?.sa6 || [];
  const z4  = entry.picks?.z4  || [];
  const groupRows = (teams, labels) => teams.map((team, i) =>
    `<tr><td>${esc(labels[i] || String(i + 1))}</td><td><b>${esc(team || "—")}</b></td></tr>`
  ).join("");
  const g4rows  = groupRows(g4,  [t("pos1"), t("pos2"), t("pos3"), t("pos4")]);
  const sa6rows = groupRows(sa6, sa6.map((_, i) => `Sul-Am. ${i + 1}`));
  const z4rows  = groupRows(z4,  [t("pos17"), t("pos18"), t("pos19"), t("pos20")]);
  const groupTable = (title, rows) => `<h3 style="margin:18px 0 6px;color:#07151c">${esc(title)}</h3>
    <table><thead><tr><th>${esc(t("receiptColPos"))}</th><th>${esc(t("receiptColTeam"))}</th></tr></thead><tbody>${rows}</tbody></table>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(t("receiptTitle"))}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;color:#111}
.doc{max-width:900px;margin:24px auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 40px #0002}
h1{margin:0 0 4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f1f5f9;border-radius:14px;padding:14px;margin:18px 0}
.code{font-family:monospace;color:#087a35;font-weight:bold}
table{width:100%;border-collapse:collapse;margin-top:10px}td,th{padding:8px 10px;border-bottom:1px solid #dde}
th{background:#07151c;color:#fff;text-align:left}
.notice{background:#fff4cc;border:1px solid #e8c65b;border-radius:12px;padding:12px;margin-top:16px;font-size:13px}
@media print{body{background:#fff}.doc{box-shadow:none;margin:0;border-radius:0;padding:10px}}</style></head>
<body><div class="doc">
<h1>${esc(t("receiptTitle"))}</h1>
<p>${esc(t("receiptIntro"))}</p>
<div class="meta">
<div><b>${esc(t("receiptEntry"))}:</b> ${esc(entry.entryName)}<br>
<b>${esc(t("receiptResponsible"))}:</b> ${esc(entry.payerName || "")}<br>
<b>${esc(t("receiptEmail"))}:</b> ${esc(entry.participantEmail)}</div>
<div><b>${esc(t("receiptPayment"))}:</b> ${esc(entry.paymentMethod || "")}<br>
<b>${esc(t("receiptSentAt"))}:</b> ${new Date(entry.createdAt).toLocaleString("pt-BR")}<br>
<b>${esc(t("receiptCode"))}:</b> <span class="code">${esc(receiptCode(entry))}</span></div></div>
${groupTable(t("receiptGroupG4"), g4rows)}
${groupTable(t("receiptGroupSA6"), sa6rows)}
${groupTable(t("receiptGroupZ4"), z4rows)}
<div class="notice">${esc(t("receiptFooterNote"))}</div>
</div></body></html>`;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Abrir comprovante / baixar HTML — item 9 do CONSISTENCY_MATRIX.md (2026-07-15): a Copa sempre
// teve esse fluxo (openReceipt()/downloadReceipt(), bolao/js/app.js) via Blob URL, nunca
// document.write; BR2026 não tinha NENHUMA confirmação visual pós-salvamento (só um toast e
// pulava direto pro Ranking) -- reaproveita o mesmo receiptHtml() já usado no e-mail.
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

// Mesmo padrão do CDB2026 (renderReceiptBox()) -- card de confirmação com código + botões
// abrir/baixar, chamado logo após salvar. BR2026 não tinha equivalente nenhum antes.
function renderReceiptBox(entry) {
  const box = $("receiptBox");
  if (!box) return;
  const code = receiptCode(entry);
  box.classList.remove("hidden");
  box.innerHTML = `
    <h3>${esc(t("receiptTitle"))}</h3>
    <p>${esc(t("receiptCodeLabel"))}: <code class="receipt-code">${esc(code)}</code></p>
    <p class="muted" style="font-size:12px">${esc(t("receiptSaveHint"))}</p>
    <div class="receipt-actions">
      <button type="button" data-receipt-action="open">${esc(t("openReceipt"))}</button>
      <button type="button" class="secondary" data-receipt-action="download">${esc(t("downloadHtml"))}</button>
    </div>`;
  box.querySelector('[data-receipt-action="open"]')?.addEventListener("click", () => openReceipt(entry.id));
  box.querySelector('[data-receipt-action="download"]')?.addEventListener("click", () => downloadReceipt(entry.id));
}

async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  const lastSent = Number(sessionStorage.getItem("br2026_emailTs") || 0);
  if (Date.now() - lastSent < C.emailjs.limitRateMs) return;
  const html = receiptHtml(entry);
  const code = receiptCode(entry);
  try {
    await window.emailjs.send(C.emailjs.serviceId, C.emailjs.participantTemplateId, {
      to_email:     entry.participantEmail,
      entry_name:   `Brasileirão 2026 — ${entry.entryName}`,
      receipt_code: code,
      html_message: html,
    }, { publicKey: C.emailjs.publicKey });
    sessionStorage.setItem("br2026_emailTs", String(Date.now()));
    // Cópia para o admin -- mesmo padrão da Copa (mailReceipt(id,"participant") + ("admin") em
    // toda entrada salva) e do CDB2026 (já enviava cópia ao admin). BR2026 era o único dos 3
    // apps sem isso -- achado em auditoria, corrigido junto por ser parte do mesmo padrão de
    // e-mail de comprovante.
    if (C.adminEmail) {
      await window.emailjs.send(C.emailjs.serviceId, C.emailjs.adminTemplateId, {
        to_email:     C.adminEmail,
        entry_name:   `Nova entrada — ${entry.entryName}`,
        receipt_code: code,
        html_message: html,
      }, { publicKey: C.emailjs.publicKey });
    }
  } catch (err) {
    console.error("[BR2026] sendReceipt failed:", err);
  }
}

// ─── Countdown ───────────────────────────────────────────────────────────────
function renderCountdown() {
  const el = $("cutoffCountdown");
  if (!el) return;
  const card = el.closest(".count-card");
  const diff = cutoffDate() - Date.now();
  // Mesmo padrão da Copa (updateCountdown(), bolao/js/app.js): esconde a caixa inteira depois
  // do prazo, não deixa um "Encerrado" solto ocupando o mesmo espaço vazio da contagem
  // regressiva. Eduardo, screenshot do hero pós-prazo: "Pode esconder isso" (2026-07-16).
  if (diff <= 0) { card?.classList.add("hidden"); return; }
  card?.classList.remove("hidden");
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
  // Perf: essa função reconstrói uma tabela de 20 linhas com mini-barras a cada renderAll() (todo
  // resync de 30s, todo save), mesmo com a aba Probabilidades fora de tela -- achado em auditoria
  // (2026-07-14). showSection() já chama renderProbSection() explicitamente ao abrir a aba, então
  // pular aqui quando ela não está ativa não perde nenhuma atualização real.
  if (!document.getElementById("probs")?.classList.contains("active")) return;

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

// Real bug found by Eduardo in CDB2026 (2026-07-14, same architecture here): renderPickForm()
// rebuilds #pickForm's entire innerHTML every time renderAll() runs, and renderAll() also runs
// from a BACKGROUND resync (reloadRemoteIfVisible()) that a window blur/focus cycle can trigger
// mid-fill (opening any of these 14 native <select> dropdowns does this on many browsers/mobile).
// A brand-new, never-saved entry has no _editingEntry set, so nothing protected it -- the resync
// would silently wipe every team already picked. Fix: never rebuild a form the user is actively
// filling in, regardless of why renderAll() ran. See bolao/cdb2026/js/app.js for the full
// reproduction writeup (same fix, only the dirty-check selector differs: dropdowns here vs.
// number inputs + a select there).
function pickFormIsDirty() {
  const form = $("pickForm");
  if (!form) return false;
  return [...form.querySelectorAll(".pick-select")].some(el => el.value !== "");
}

// ─── Render all ──────────────────────────────────────────────────────────────
// Bug real encontrado em auditoria (2026-07-14): não existia botão "Cancelar" pra sair do modo de
// edição de uma entrada -- se o admin clicasse "Editar" e navegasse pra outra seção sem salvar,
// _editingEntry ficava preso pra sempre (só é limpo em saveEntry() bem-sucedido), o que também
// PARA o sync remoto indefinidamente (reloadRemoteIfVisible() e o poll de 30s checam
// _editingEntry -- ver linhas 102/2123). Mesmo padrão que a Copa já tem (editByCodeCard/
// cancelEditMode em bolao/js/app.js).
function renderEditModeBanner() {
  const box = $("editModeBanner");
  if (!box) return;
  if (!_editingEntry) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="edit-mode-banner card">
    <span>${esc(t("editModeBanner").replace("{name}", _editingEntry.entryName || ""))}</span>
    <button type="button" id="editCancelBtn" class="secondary small-btn">${esc(t("editCancelBtn"))}</button>
  </div>`;
  $("editCancelBtn")?.addEventListener("click", () => {
    _editingEntry = null;
    $("entryName").value = "";
    $("payerName").value = "";
    $("participantEmail").value = "";
    $("paymentMethod").value = "";
    renderAll();
  });
}
function renderAll() {
  applyI18n();
  if (!pickFormIsDirty()) renderPickForm();
  renderEditModeBanner();
  renderRanking();
  renderParticipants();
  renderPayment();
  renderRules();
  renderStandingsCard();
  renderFooter();
  if (_schedule.length) { renderGamesSection(); renderNextGameCard(); }
  if (isAdminActive()) renderAdmin();
  renderProbSection();
  nudgeScrollReflow();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const wa = $("supportWhatsappBtn");
  if (wa) wa.href = C.whatsappGroup?.link || "#";

  // Navigation
  $$("[data-section]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  // Disable "Palpites" nav button only after cutoff; default landing depends on cutoff — same
  // pattern as Copa (bolao/js/app.js init()).
  const navEntryBtn = document.querySelector('.nav button[data-section="entry"]');
  if (navEntryBtn) navEntryBtn.disabled = isPastCutoff();
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
  $("paymentMethod")?.addEventListener("change", renderPaymentBox);

  // Admin login
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
        showToast(t("adminLockedNow").replace("{min}", C.adminLockMinutes), "warn");
      } else {
        showToast(t("adminWrongPassword").replace("{n}", C.adminMaxAttempts - _loginAttempts), "error");
      }
    }
  });

  $("adminLogoutBtn")?.addEventListener("click", () => {
    sessionStorage.removeItem("br2026_adminUntil");
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

  // Load remote state then render
  loadStandingsBaseline();
  await loadRemoteState();
  renderAll();

  // ESPN: poll immediately, then self-reschedule (backoff on failure, paused while hidden)
  pollAll();
  schedulePoll();
  // Resume promptly on focus instead of waiting out the rest of a paused interval
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollAll(); debouncedReload(); } });

  // 1s ticker for running clock + next game countdown (skip when tab is hidden)
  setInterval(() => { if (!document.hidden) { renderLiveCard(); renderNextGameCard(); } }, 1000);

  // Remote sync every 30s (when database enabled) — skip when form is being filled or tab is hidden
  if (C.database.enabled) {
    setInterval(() => { if (!document.hidden && !_editingEntry) debouncedReload(); }, 30000);
    window.addEventListener("focus", debouncedReload);
    // iOS Safari can restore a backgrounded tab from bfcache without reliably firing
    // visibilitychange, leaving the page stuck on whatever state was in memory at the last real
    // load — force a resync whenever that happens. Same fix already applied to the Copa
    // (bolao/js/app.js) after a real incident where a stale local browser state won a merge
    // against fresher Supabase data; see docs/bolao/LESSONS_LEARNED.md "Safari" / "Supabase —
    // merge/sync". This app's mergeStates() already applies preferRemoteResults:true on every
    // load, so the missing piece here was purely "reliably trigger that reload", not the merge
    // rule itself.
    window.addEventListener("pageshow", e => { if (e.persisted) debouncedReload(); });
  }

  // Full-season schedule — fetch in background, render when ready
  fetchSchedule().then(() => {
    renderGamesSection();
    renderNextGameCard();
    const s = state();
    if (freezeSeasonCutoff(s)) saveState(s);
  });
}

// Read-only test hooks — pure functions only, no state mutation exposed. Used by
// bolao/br2026/scripts/audit_live_standings_and_ranking.py and Playwright regression tests. See
// docs/bolao/BR2026_LIVE_STANDINGS.md "Testes".
window.__BR2026_TESTHOOKS__ = { calculateLiveStandings, zoneForPosition, rankEntries, calculateRankingMovement, scoreEntry, pollAll, accuracyMetrics };

init();

})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bolao/sw.js').catch(() => {});
}

// Reload when a new deploy is detected — on tab focus and every 10 min
(function startVersionPolling() {
  // Bug real encontrado em auditoria (2026-07-14): sem essa checagem, um deploy no meio do
  // preenchimento do formulário de palpites apagava tudo sem aviso (location.reload() forçado).
  // Mesma checagem de pickFormIsDirty() lá em cima, duplicada aqui porque esta IIFE roda fora do
  // escopo do módulo principal (não tem acesso às funções internas).
  function formIsDirty() {
    const form = document.getElementById("pickForm");
    if (!form) return false;
    return [...form.querySelectorAll(".pick-select")].some(el => el.value !== "");
  }
  async function checkVersion() {
    if (document.hidden || formIsDirty()) return;
    try {
      // Escopo isolado desta IIFE não enxerga o fetchJson() do módulo principal -- timeout
      // inline equivalente (item 50 do CONSISTENCY_MATRIX.md, 2026-07-15).
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let r;
      try { r = await fetch(`js/config.js?nc=${Date.now()}`, { signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      const text = await r.text();
      const m = text.match(/siteVersion:\s*"([^"]+)"/);
      if (m && m[1] !== window.BR2026_CONFIG?.siteVersion) location.reload();
    } catch (e) { /* network hiccup — next poll retries, nothing to recover here */ }
  }
  setInterval(checkVersion, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
}());
