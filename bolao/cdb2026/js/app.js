/* Bolão Copa do Brasil 2026 — app.js v2.0
   Vanilla JS IIFE, no framework, no build step.
   Picks are per-confronto (mata-mata ida+volta, placar agregado), same shape as the
   Copa do Mundo bracket in bolao/js/app.js: exact aggregate / correct advance / partial
   goal-count points per tie, plus a champion/runner-up/semifinalist bonus resolved by
   walking the bracket — see resolveBracket(). */
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
// IDs de entrada com o detalhe de palpites expandido no ranking — mesmo padrão da Copa
// (bolao/js/app.js), sobrevive a re-renders (sync, troca de idioma) até o usuário fechar.
const _openRankDetails = new Set();

function emptyState() {
  return { entries: [], deletedIds: [], paid: {}, results: { ties: {} }, meta: { updatedAt: null, version: C.siteVersion } };
}
function state() {
  try {
    const r = localStorage.getItem(C.storeKey);
    const s = r ? Object.assign(emptyState(), JSON.parse(r)) : emptyState();
    s.results = s.results && typeof s.results === "object" ? s.results : { ties: {} };
    s.results.ties = s.results.ties || {};
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
function mergeStates(local, remote, opts = {}) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  const byId = {};
  [...(remote.entries || []), ...(local.entries || [])].forEach(e => { if (!deleted.has(e.id)) byId[e.id] = e; });
  const paid = { ...(remote.paid || {}), ...(local.paid || {}) };
  const localTies  = local.results?.ties  || {};
  const remoteTies = remote.results?.ties || {};
  const ties = opts.preferRemoteResults
    ? { ...localTies, ...remoteTies }
    : { ...remoteTies, ...localTies };
  return {
    entries: Object.values(byId),
    deletedIds: [...deleted],
    paid,
    results: { ties },
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
// Escudo real do time (ESPN CDN, DATA.teamLogos — mesmas URLs que o BR2026 busca ao vivo do
// standings da Série A, aqui fixas em data.js porque o CDB2026 não tem nenhuma API ao vivo).
// Mesmo helper name/assinatura que teamLogoImg() em bolao/br2026/js/app.js, mesmas classes CSS
// (.team-logo 14px inline / .match-logo 22px em destaque) — símbolo do time consistente nos
// três apps: bandeira na Copa, escudo real aqui e no BR2026.
function teamLogoImg(team, cls) {
  const url = DATA.teamLogos?.[team];
  if (!url) return "";
  return `<img src="${esc(url)}" class="${cls || "team-logo"}" alt="" aria-hidden="true">`;
}

// ─── Payment icon ───────────────────────────────────────────────────────────
// Mesmos ícones/assinatura que payIcon() em bolao/js/app.js — ver DESIGN_SYSTEM.md "Pagamento".
const PAY_ICON_SVG = { CashApp: "assets/cashapp.svg", Zelle: "assets/zelle.svg", Venmo: "assets/venmo.svg" };
function payIcon(method) {
  const src = PAY_ICON_SVG[method];
  return src ? `<img src="${esc(src)}" alt="${esc(method)}" class="pay-method-icon">` : "💳";
}

// ─── Bracket resolution ─────────────────────────────────────────────────────
// Resolve os nomes reais de cada confronto a partir de uma fonte de resultado (oficial ou o
// palpite de uma entrada) — mesmo padrão de resolução dinâmica de bracket usado na Copa do
// Mundo (resolvedTeamsForEntry/podiumFromResults em bolao/js/app.js), generalizado aqui via
// getResultFn(tieId) -> {advance:"home"|"away"} | undefined.
function resolveBracket(getResultFn) {
  const resolved = {};
  DATA.ties.forEach(tie => {
    let home = tie.home, away = tie.away;
    if (tie.fromHome) {
      const r   = getResultFn(tie.fromHome);
      const src = resolved[tie.fromHome];
      home = (r && r.advance && src) ? (r.advance === "home" ? src.home : src.away) : null;
    }
    if (tie.fromAway) {
      const r   = getResultFn(tie.fromAway);
      const src = resolved[tie.fromAway];
      away = (r && r.advance && src) ? (r.advance === "home" ? src.home : src.away) : null;
    }
    resolved[tie.id] = { home, away };
  });
  return resolved;
}
function resolveOfficial(results) { return resolveBracket(id => results?.ties?.[id]); }
function resolveEntry(entry)      { return resolveBracket(id => entry.picks?.ties?.[id]); }

function tieIsOpen(tie, resolvedHome, resolvedAway, results) {
  if (!resolvedHome || !resolvedAway) return false;      // times ainda não definidos
  if (!tie.cutoffIso) return false;                       // data ainda não confirmada
  if (Date.now() >= new Date(tie.cutoffIso).getTime()) return false; // cutoff da ida já passou
  if (results?.ties?.[tie.id]) return false;               // resultado já lançado
  return true;
}

const ROUND_LABELS = { oitavas: "roundOitavas", quartas: "roundQuartas", semifinal: "roundSemifinal", final: "roundFinal" };
const ROUNDS = ["oitavas", "quartas", "semifinal", "final"];

// ─── Podium picks (campeão/vice/semifinalistas) ──────────────────────────────
// Travados junto com o cutoff global (antes das oitavas começarem) — igual à Copa do Mundo:
// uma vez feito o palpite, ele não muda mesmo que o time seja eliminado depois. Isso é
// INTENCIONALMENTE separado dos palpites por confronto abaixo, que sim vão abrindo fase a
// fase — a trava aqui é sempre isPastCutoff() (cutoff único, anterior às oitavas), nunca
// depende de estar editando uma entrada existente.
function getPodiumPickValues() {
  return {
    champion: $("cdb-champion")?.value || "",
    runnerUp: $("cdb-runner-up")?.value || "",
    semis:    [$("cdb-semi-1")?.value || "", $("cdb-semi-2")?.value || ""],
  };
}
function updatePodiumDropdowns() {
  const { champion, runnerUp, semis } = getPodiumPickValues();
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
function podiumPickRowHtml(id, labelKey, hintKey, locked, teamOpts) {
  return `
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
}

// ─── Per-tie picks ────────────────────────────────────────────────────────────
function tieRowId(tie) { return `tie-${tie.id}`; }

// Regra da CBF na Copa do Brasil: sem critério de gols fora de casa — agregado igual depois
// dos dois jogos vai direto para pênaltis. Vitória simples no agregado: quem avança é
// determinístico, o campo é preenchido automaticamente e travado (sem edição manual possível
// — não faz sentido deixar escolher algo que a regra já decide sozinha). Agregado empatado:
// pênaltis são imprevisíveis, o campo destrava e o participante escolhe manualmente quem acha
// que avança.
// `reset`: true quando chamado a partir de um evento de digitação (usuário mudando o placar
// ativamente) — aí limpa qualquer seleção de um estado anterior que ficaria obsoleta/enganosa.
// false na sincronização inicial ao editar uma entrada existente — preserva a escolha manual
// já salva para um agregado empatado em vez de apagá-la só por re-renderizar a tela.
function inferAdvance(goalsAEl, goalsBEl, advanceEl, reset = true) {
  const a = parseInt(goalsAEl.value, 10), b = parseInt(goalsBEl.value, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) { advanceEl.disabled = false; if (reset) advanceEl.value = ""; return; }
  if (a !== b) {
    advanceEl.value = a > b ? "home" : "away";
    advanceEl.disabled = true;
  } else {
    advanceEl.disabled = false;
    if (reset) advanceEl.value = "";
  }
}

function renderPickForm() {
  const s          = state();
  const resolved   = resolveOfficial(s.results);
  const savedTies  = (_editingEntry?.picks?.ties) || {};
  const form       = $("pickForm");
  if (!form) return;

  // Podium picks — locked once the global cutoff passes, regardless of edit mode.
  const podiumLocked = isPastCutoff();
  const teamOpts = DATA.teams.slice().sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map(team => `<option value="${esc(team)}">${esc(team)}</option>`).join("");
  let html = `<div class="pick-group">
    <div class="pick-group-header champion-header">🏆 ${esc(t("picksGroupTitle"))}</div>
    ${podiumPickRowHtml("cdb-champion",  "pickChampion",  "pickHintChampion", podiumLocked, teamOpts)}
    ${podiumPickRowHtml("cdb-runner-up", "pickRunnerUp",  "pickHintRunnerUp", podiumLocked, teamOpts)}
    ${podiumPickRowHtml("cdb-semi-1",    "pickSemi1",     "pickHintSemi",     podiumLocked, teamOpts)}
    ${podiumPickRowHtml("cdb-semi-2",    "pickSemi2",     "pickHintSemi",     podiumLocked, teamOpts)}
  </div>`;

  ROUNDS.forEach(round => {
    const ties = DATA.ties.filter(tie => tie.round === round);
    if (!ties.length) return;
    html += `<div class="pick-group">
      <div class="pick-group-header champion-header">${esc(t(ROUND_LABELS[round]))}</div>`;
    ties.forEach(tie => {
      const { home, away } = resolved[tie.id];
      const saved = savedTies[tie.id];
      const open  = tieIsOpen(tie, home, away, s.results);
      const rid   = tieRowId(tie);

      if (!home || !away) {
        html += `<div class="pick-row tie-row" id="${rid}">
          <span class="tie-teams-pending">${esc(t("pickWaitingSlot"))}</span>
        </div>`;
        return;
      }
      if (!open) {
        const summary = saved
          ? `<span class="tie-locked-score">${esc(home)} ${teamLogoImg(home)} ${saved.goalsA} × ${saved.goalsB} ${teamLogoImg(away)} ${esc(away)}</span>`
          : `<span class="tie-locked-score">${esc(home)} ${teamLogoImg(home)} <span class="muted">${esc(t("pickNotSubmitted"))}</span> ${teamLogoImg(away)} ${esc(away)}</span>`;
        html += `<div class="pick-row tie-row locked" id="${rid}">
          <div class="tie-locked-note">${summary}</div>
        </div>`;
        return;
      }

      const gA = saved?.goalsA ?? "", gB = saved?.goalsB ?? "";
      const adv = saved?.advance || "";
      html += `<div class="pick-row tie-row open" id="${rid}" data-tie-id="${esc(tie.id)}">
        <div class="tie-inputs">
          <span class="tie-team-name">${esc(home)}</span>
          ${teamLogoImg(home)}
          <input type="number" min="0" max="20" class="tie-goals-a" data-tie="${esc(tie.id)}" value="${esc(gA)}" aria-label="${esc(t("pickAggScoreA"))} ${esc(home)}">
          <span class="tie-x">×</span>
          <input type="number" min="0" max="20" class="tie-goals-b" data-tie="${esc(tie.id)}" value="${esc(gB)}" aria-label="${esc(t("pickAggScoreB"))} ${esc(away)}">
          ${teamLogoImg(away)}
          <span class="tie-team-name">${esc(away)}</span>
        </div>
        <select class="tie-advance" data-tie="${esc(tie.id)}" aria-label="${esc(t("pickAdvanceLabel"))}">
          <option value="">${esc(t("pickSelectAdvance"))}</option>
          <option value="home" ${adv === "home" ? "selected" : ""}>${esc(home)}</option>
          <option value="away" ${adv === "away" ? "selected" : ""}>${esc(away)}</option>
        </select>
        <span class="pick-pts-hint">${esc(t("pickHintTie"))}</span>
      </div>`;
    });
    html += `</div>`;
  });

  form.innerHTML = html || `<p class="muted">${esc(t("pickNoOpenTies"))}</p>`;

  // Restore saved podium picks (read-only display once locked, editable before cutoff)
  if (_editingEntry) {
    const p = _editingEntry.picks || {};
    if (p.champion && $("cdb-champion"))  $("cdb-champion").value  = p.champion;
    if (p.runnerUp && $("cdb-runner-up")) $("cdb-runner-up").value = p.runnerUp;
    (p.semis || []).forEach((v, i) => {
      const el = $(`cdb-semi-${i + 1}`);
      if (el && v) el.value = v;
    });
  }
  form.removeEventListener("change", updatePodiumDropdowns);
  form.addEventListener("change", updatePodiumDropdowns);
  updatePodiumDropdowns();

  form.querySelectorAll(".tie-row.open").forEach(row => {
    const tieId = row.dataset.tieId;
    const a = row.querySelector(".tie-goals-a"), b = row.querySelector(".tie-goals-b"), adv = row.querySelector(".tie-advance");
    inferAdvance(a, b, adv, false); // sincroniza travado/destravado sem apagar escolha manual salva
    [a, b].forEach(el => el.addEventListener("input", () => inferAdvance(a, b, adv)));
  });
}

function getPickValues() {
  const podium = getPodiumPickValues();
  const ties   = { ...(_editingEntry?.picks?.ties || {}) };
  $$(".tie-row.open").forEach(row => {
    const tieId = row.dataset.tieId;
    const a   = row.querySelector(".tie-goals-a")?.value;
    const b   = row.querySelector(".tie-goals-b")?.value;
    const adv = row.querySelector(".tie-advance")?.value;
    if (a === "" && b === "" && !adv) { delete ties[tieId]; return; }
    ties[tieId] = { goalsA: parseInt(a, 10), goalsB: parseInt(b, 10), advance: adv || "" };
  });
  return { champion: podium.champion, runnerUp: podium.runnerUp, semis: podium.semis, ties };
}

// ─── Validation ──────────────────────────────────────────────────────────────
// Podium picks (champion/runnerUp/semis) are only required/validated while still editable
// (before the global cutoff) — once locked, saveEntry() never touches them again, so an
// admin/self-service edit of later-round tie picks can't accidentally wipe or re-require them.
function validatePicks({ champion, runnerUp, semis, ties }) {
  const errors = [];
  if (!isPastCutoff()) {
    if (!champion || !runnerUp || semis.some(x => !x)) errors.push(t("errorPicksIncomplete"));
    const all = [champion, runnerUp, ...semis].filter(Boolean);
    if (new Set(all).size < all.length) errors.push(t("errorDuplicatePicks"));
  }
  $$(".tie-row.open").forEach(row => {
    const tieId = row.dataset.tieId;
    const pick  = ties[tieId];
    if (!pick || !Number.isFinite(pick.goalsA) || !Number.isFinite(pick.goalsB) ||
        pick.goalsA < 0 || pick.goalsA > 20 || pick.goalsB < 0 || pick.goalsB > 20) {
      errors.push(t("errorPicksIncomplete")); return;
    }
    if (!pick.advance) errors.push(t("errorAdvanceRequired"));
  });
  return [...new Set(errors)];
}

// ─── Save entry ──────────────────────────────────────────────────────────────
async function saveEntry() {
  if (isPastCutoff() && !_editingEntry) { showToast(t("closed"), "warn"); return; }
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

// ─── Podium resolution (from official tie results) ───────────────────────────
// Deriva o campeão/vice/semifinalistas reais a partir dos resultados dos confrontos já
// lançados pelo admin (final-1 e semifinal-1/2) — evita que o admin precise digitar o pódio
// duas vezes (uma no resultado do confronto, outra "à parte").
function officialPodium(results) {
  const resolved = resolveOfficial(results);
  const finalRes = results?.ties?.["final-1"];
  const finalOff = resolved["final-1"];
  let champion = null, runnerUp = null;
  if (finalRes?.advance && finalOff.home && finalOff.away) {
    champion = finalRes.advance === "home" ? finalOff.home : finalOff.away;
    runnerUp = finalRes.advance === "home" ? finalOff.away : finalOff.home;
  }
  const semis = [];
  ["semifinal-1", "semifinal-2"].forEach(id => {
    const res = results?.ties?.[id], off = resolved[id];
    if (res?.advance && off.home && off.away) semis.push(res.advance === "home" ? off.away : off.home);
  });
  return { champion, runnerUp, semis };
}

// ─── Scoring ────────────────────────────────────────────────────────────────
// scoreEntry: pontos por confronto (placar agregado exato / avanço correto / um lado do
// agregado correto) — mesmo modelo da Copa do Mundo (scoreEntry em bolao/js/app.js), aplicado
// ao agregado da ida+volta em vez de a uma partida única — MAIS bônus de pódio.
//
// O bônus usa entry.picks.champion/runnerUp/semis — os 4 palpites feitos e travados ANTES do
// cutoff global, exatamente como a Copa do Mundo: se o time escolhido cair no meio do
// caminho, o bônus é perdido, sem chance de trocar o palpite depois (ver validatePicks() e o
// "locked" dos dropdowns em renderPickForm()). Isso é deliberadamente diferente dos palpites
// por confronto acima, que vão abrindo fase a fase.
function scoreEntry(entry, results) {
  if (!results || !results.ties) return null;
  const picks = entry.picks || {};
  const ties  = picks.ties || {};
  const sc    = C.scoring;
  let total   = 0;
  const detail = { ties: {} };

  DATA.ties.forEach(tie => {
    const res  = results.ties[tie.id];
    const pick = ties[tie.id];
    if (!res || !pick) return;
    let pts = 0, type = "miss";
    if (pick.goalsA === res.goalsA && pick.goalsB === res.goalsB) { pts = sc.tie.exact; type = "exact"; }
    else if (pick.advance === res.advance) { pts = sc.tie.advance; type = "advance"; }
    else if (pick.goalsA === res.goalsA || pick.goalsB === res.goalsB) { pts = sc.tie.partial; type = "partial"; }
    detail.ties[tie.id] = { pts, type };
    total += pts;
  });

  const podium = officialPodium(results);
  if (podium.champion && picks.champion) {
    const exact = picks.champion === podium.champion;
    detail.champion = { pts: exact ? sc.bonus.champion : 0, type: exact ? "exact" : "miss" };
    total += detail.champion.pts;
  }
  if (podium.runnerUp && picks.runnerUp) {
    const exact = picks.runnerUp === podium.runnerUp;
    detail.runnerUp = { pts: exact ? sc.bonus.runnerUp : 0, type: exact ? "exact" : "miss" };
    total += detail.runnerUp.pts;
  }
  if (podium.semis.length) {
    const semifinalistSet = new Set([podium.champion, podium.runnerUp, ...podium.semis].filter(Boolean));
    detail.semis = (picks.semis || []).map(pick => {
      if (!pick) return null;
      const hit = semifinalistSet.has(pick);
      return { pts: hit ? sc.bonus.semifinalist : 0, type: hit ? "hit" : "miss" };
    });
    detail.semis.forEach(d => { if (d) total += d.pts; });
  }

  return { total, detail };
}

function getActiveScore(entry, s) { return scoreEntry(entry, s.results); }

function resultsProgress(results) {
  const done = DATA.ties.filter(tie => results?.ties?.[tie.id]).length;
  return { done, totalTies: DATA.ties.length };
}

// Edição própria só faz sentido depois que a primeira fase (oitavas) termina — antes disso,
// nenhum confronto de fase seguinte está resolvido, então não há nada novo pra editar e o
// card só confunde quem está enviando a entrada pela primeira vez.
function oitavasComplete(results) {
  return DATA.ties.filter(tie => tie.round === "oitavas").every(tie => results?.ties?.[tie.id]);
}

function renderFindEntryCard() {
  const card = $("findEntryCard");
  if (!card) return;
  // Escondido por completo (não só os campos) até as oitavas terminarem — antes disso não há
  // nada de novo pra editar, e o card só confundia quem estava enviando a entrada pela
  // primeira vez (via feedback direto do Eduardo).
  card.classList.toggle("hidden", !oitavasComplete(state().results));
}

// ─── Tiebreaker helpers ──────────────────────────────────────────────────────
function hitChampion(detail) { return detail?.champion?.type === "exact" ? 1 : 0; }
function hitRunnerUp(detail) { return detail?.runnerUp?.type === "exact" ? 1 : 0; }
function countExactTies(detail) { return Object.values(detail?.ties || {}).filter(d => d.type === "exact").length; }

// ─── Email receipt ───────────────────────────────────────────────────────────
let _lastEmailTs = 0;
async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;
  const now = Date.now();
  if (now - _lastEmailTs < C.emailjs.limitRateMs) return;

  const resolved = resolveEntry(entry);
  const ties     = entry.picks?.ties || {};
  const rows = DATA.ties.map(tie => {
    const pick = ties[tie.id];
    const { home, away } = resolved[tie.id];
    if (!pick || !home || !away) return "";
    return `<tr><td>${esc(home)} × ${esc(away)}</td><td>${pick.goalsA} × ${pick.goalsB}</td></tr>`;
  }).join("");
  const p = entry.picks || {};
  const podiumHtml = `
    <p><b>${esc(t("receiptCodeLabel"))}:</b> <code>${esc(receiptCode(entry))}</code></p>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><th>Palpite</th><th>Time</th></tr>
      <tr><td>🏆 Campeão</td><td>${esc(p.champion || "—")}</td></tr>
      <tr><td>🥈 Vice-campeão</td><td>${esc(p.runnerUp || "—")}</td></tr>
      <tr><td>Semi 1</td><td>${esc((p.semis || [])[0] || "—")}</td></tr>
      <tr><td>Semi 2</td><td>${esc((p.semis || [])[1] || "—")}</td></tr>
    </table>`;
  const picksHtml = `
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;margin-top:10px">
      <tr><th>Confronto</th><th>Placar agregado palpitado</th></tr>
      ${rows || `<tr><td colspan="2">—</td></tr>`}
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
    const sc = getActiveScore(e, s) || { total: 0, detail: null };
    return { e, ...sc };
  }).sort((a, b) =>
    b.total - a.total ||
    hitChampion(b.detail) - hitChampion(a.detail) ||
    hitRunnerUp(b.detail) - hitRunnerUp(a.detail) ||
    countExactTies(b.detail) - countExactTies(a.detail) ||
    b.e.entryName.localeCompare(a.e.entryName, "pt-BR")
  );

  const { done, totalTies } = resultsProgress(s.results);
  const provNote = done < totalTies
    ? `<p class="prov-note">↕ ${esc(t("provisionalNote"))}</p>` : "";

  // Estrutura densa de 1 linha (.rank-row) + detalhe expansível (.picks-detail) — mesmo padrão
  // da Copa (bolao/js/app.js renderRanking()), ver DESIGN_SYSTEM.md "Ranking — estrutura do
  // card". Cada entrada gera dois elementos irmãos, não um card único empilhado.
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
  const resolved = resolveEntry(entry);
  const picks    = entry.picks?.ties || {};
  const rows = DATA.ties.map(tie => {
    const pick = picks[tie.id];
    const { home, away } = resolved[tie.id];
    if (!home || !away || !pick) return "";
    const d     = detail?.ties?.[tie.id];
    const cls   = d ? (d.type === "exact" ? "pick-exact" : d.type === "advance" ? "pick-partial" : d.type === "partial" ? "pick-partial" : "pick-miss") : "";
    const badge = d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : "";
    return `<div class="pick-item">
      <span class="pick-pos-lbl">${teamLogoImg(home)} ${esc(home)} × ${esc(away)} ${teamLogoImg(away)}</span>
      <div class="pick-cell ${cls}">${pick.goalsA} × ${pick.goalsB}${badge}</div>
    </div>`;
  }).filter(Boolean).join("");

  const p = entry.picks || {};
  const bonusRow = (label, team, d) => team
    ? `<div class="pick-item"><span class="pick-pos-lbl">${esc(label)}: ${teamLogoImg(team)} ${esc(team)}</span><div class="pick-cell ${d ? (d.type === "exact" || d.type === "hit" ? "pick-exact" : "pick-miss") : ""}">${d ? `<b class="pick-pts-badge">${d.pts > 0 ? "+" + d.pts : "—"}</b>` : ""}</div></div>`
    : "";

  return `<div class="picks-display cdb-picks">
    ${bonusRow("🏆 " + t("pickLabelChampion"), p.champion, detail?.champion)}
    ${bonusRow("🥈 " + t("pickLabelRunnerUp"), p.runnerUp, detail?.runnerUp)}
    ${(p.semis || []).map((team, i) => bonusRow(t("pickLabelSemi") + " " + (i + 1), team, detail?.semis?.[i])).join("")}
    ${rows || `<p class="muted">${esc(t("pickNoOpenTies"))}</p>`}
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
// Mesma estrutura de card (ícone + nome + handle) da Copa (bolao/js/app.js renderPayment()) —
// ver DESIGN_SYSTEM.md "Pagamento".
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
  const sc  = C.scoring;
  const pr  = C.prizes;
  box.innerHTML = `
    <div class="card">
      <h3>${esc(t("rulesScoring"))}</h3>
      <table class="rules-table">
        <thead><tr><th>${esc(t("rulesAcerto"))}</th><th>${esc(t("rulesPts"))}</th></tr></thead>
        <tbody>
          <tr><td>${esc(t("rulesTieExact"))}</td><td><b>${sc.tie.exact}</b></td></tr>
          <tr><td>${esc(t("rulesTieAdvance"))}</td><td><b>${sc.tie.advance}</b></td></tr>
          <tr><td>${esc(t("rulesTiePartial"))}</td><td><b>${sc.tie.partial}</b></td></tr>
          <tr><td>🏆 Campeão — ${esc(t("rulesExact"))}</td><td><b>${sc.bonus.champion}</b></td></tr>
          <tr><td>🥈 Vice-campeão — ${esc(t("rulesExact"))}</td><td><b>${sc.bonus.runnerUp}</b></td></tr>
          <tr><td>Semifinalista acertado (×2)</td><td><b>${sc.bonus.semifinalist}</b> cada</td></tr>
        </tbody>
      </table>
      <h3>${esc(t("tbTitle"))}</h3>
      <ol style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.8">
        <li>${esc(t("tbChampion"))}</li>
        <li>${esc(t("tbRunnerUp"))}</li>
        <li>${esc(t("tbExactTies"))}</li>
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
      <p style="font-size:13px">${esc(t("rulesCutoffText"))}</p>
    </div>
    <div class="card">
      <h3>${esc(t("rulesTransparency"))}</h3>
      <p class="muted" style="font-size:12px">${esc(C.transparency.disclaimer)}</p>
    </div>`;
}

// ─── Render: games (bracket completo) ────────────────────────────────────────
function renderGamesSection() {
  const box = $("gamesList");
  if (!box) return;
  const s        = state();
  const resolved = resolveOfficial(s.results);

  const fmtDate = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return t("gamesTbd");
    try {
      const d = new Date(`${dateStr}T${timeStr}:00-03:00`);
      return d.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        weekday: "short", day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      }) + " BRT";
    } catch { return `${dateStr} ${timeStr} BRT`; }
  };

  let html = "";
  ROUNDS.forEach(round => {
    const ties = DATA.ties.filter(tie => tie.round === round);
    if (!ties.length) return;
    html += `<h3 class="games-round-header">${esc(t(ROUND_LABELS[round]))}</h3>`;
    html += ties.map(tie => {
      const { home, away } = resolved[tie.id];
      const res = s.results.ties[tie.id];
      // O jogo de volta (leg2) tem mandante/visitante invertidos em relação à ida — usa sempre
      // os nomes resolvidos do bracket (home/away), nunca os campos estáticos de tie.leg2, que
      // só existem para as oitavas e ficam null a partir das quartas. Antes o "Jogo 2" mostrava
      // a mesma ordem do "Jogo 1", errado.
      const legHtml = (legData, labelKey, swapped) => {
        if (!legData || !legData.date) return "";
        const h = swapped ? away : home;
        const a = swapped ? home : away;
        return `<div class="leg">
          <span class="leg-label">${esc(t(labelKey))}</span>
          <span class="leg-teams">${teamLogoImg(h, "team-logo")} ${h ? esc(h) : "?"} × ${a ? esc(a) : "?"} ${teamLogoImg(a, "team-logo")}</span>
          <span class="leg-info">📍 ${esc(legData.stadium || "—")} · ${esc(fmtDate(legData.date, legData.time))}</span>
        </div>`;
      };
      const headerTeams = (home && away) ? `${teamLogoImg(home, "match-logo")} ${esc(home)} × ${esc(away)} ${teamLogoImg(away, "match-logo")}` : esc(t("pickWaitingSlot"));
      const resultLine = res
        ? `<div class="leg confronto-result">${esc(t("gamesAggregate"))}: <b>${res.goalsA} × ${res.goalsB}</b> — ${esc(t("gamesAdvances"))}: ${res.advance === "home" ? esc(home) : esc(away)}</div>`
        : "";
      return `<div class="confronto-card card">
        <div class="confronto-header">${headerTeams}</div>
        <div class="confronto-legs">
          ${legHtml({ home: tie.home, away: tie.away, stadium: tie.stadium, date: tie.date, time: tie.time }, "gamesLeg1", false)}
          ${legHtml(tie.leg2, "gamesLeg2", true)}
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
  renderAdminResults(state());
  renderAdminPayments(state());
  renderAdminEntries(state());
}

function renderAdminResults(s) {
  const box = $("adminResults");
  if (!box) return;
  const resolved = resolveOfficial(s.results);

  let html = `<h3>${esc(t("adminResults"))}</h3>`;
  ROUNDS.forEach(round => {
    const ties = DATA.ties.filter(tie => tie.round === round);
    if (!ties.length) return;
    html += `<div class="admin-round-header">${esc(t(ROUND_LABELS[round]))}</div>`;
    ties.forEach(tie => {
      const { home, away } = resolved[tie.id];
      const res = s.results.ties[tie.id];
      if (!home || !away) {
        html += `<div class="admin-row muted">${esc(tie.id)} — ${esc(t("pickWaitingSlot"))}</div>`;
        return;
      }
      html += `<div class="admin-row cdb-admin-tie" data-tie-id="${esc(tie.id)}">
        <span class="tie-teams-admin">${esc(home)} × ${esc(away)}</span>
        <input type="number" min="0" max="20" class="adm-goals-a" value="${res ? res.goalsA : ""}" ${res ? "disabled" : ""} aria-label="${esc(home)}">
        <span class="tie-x">×</span>
        <input type="number" min="0" max="20" class="adm-goals-b" value="${res ? res.goalsB : ""}" ${res ? "disabled" : ""} aria-label="${esc(away)}">
        <select class="adm-advance" ${res ? "disabled" : ""}>
          <option value="">—</option>
          <option value="home" ${res?.advance === "home" ? "selected" : ""}>${esc(home)}</option>
          <option value="away" ${res?.advance === "away" ? "selected" : ""}>${esc(away)}</option>
        </select>
        ${res
          ? `<button type="button" class="secondary small-btn" data-unlock-tie="${esc(tie.id)}">${esc(t("unlockResults"))}</button>`
          : `<button type="button" class="small-btn" data-save-tie="${esc(tie.id)}">${esc(t("saveResults"))}</button>`}
      </div>`;
    });
  });
  box.innerHTML = html;

  box.querySelectorAll("[data-save-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.saveTie;
    const row = box.querySelector(`.cdb-admin-tie[data-tie-id="${tieId}"]`);
    const a = parseInt(row.querySelector(".adm-goals-a").value, 10);
    const b = parseInt(row.querySelector(".adm-goals-b").value, 10);
    const adv = row.querySelector(".adm-advance").value;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || !adv) { alert(t("errorResultsIncomplete")); return; }
    if (!confirm(t("confirmLockResults"))) return;
    const s2 = state();
    s2.results.ties[tieId] = { goalsA: a, goalsB: b, advance: adv, lockedAt: new Date().toISOString() };
    saveState(s2);
    showToast(t("resultsSaved"), "success");
  }));
  box.querySelectorAll("[data-unlock-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!confirm(t("confirmUnlockResults"))) return;
    const s2 = state();
    delete s2.results.ties[btn.dataset.unlockTie];
    saveState(s2);
  }));
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
  const header  = ["Nome", "Pagador", "Email", "Pagamento", "Campeão", "Vice", "Semi1", "Semi2", "Pago", "Criado",
    ...DATA.ties.map(tie => tie.id)];
  const rows    = [header];
  entries.forEach(e => {
    const p = e.picks || {};
    const resolved = resolveEntry(e);
    const picks    = e.picks?.ties || {};
    const tieCols  = DATA.ties.map(tie => {
      const pick = picks[tie.id];
      const { home, away } = resolved[tie.id];
      if (!pick || !home || !away) return "";
      return `${home} ${pick.goalsA}×${pick.goalsB} ${away}`;
    });
    rows.push([
      e.entryName, e.payerName || "", e.participantEmail || "", e.paymentMethod || "",
      p.champion || "", p.runnerUp || "", (p.semis || [])[0] || "", (p.semis || [])[1] || "",
      (s.paid || {})[e.id] ? "Sim" : "Não",
      e.createdAt ? new Date(e.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      ...tieCols
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

  // Self-service: find and edit my own entry (email + receipt code — email alone isn't a secret)
  $("findEntryBtn")?.addEventListener("click", () => {
    if (!oitavasComplete(state().results)) { showToast(t("findEntryLockedMsg"), "warn"); return; }
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
