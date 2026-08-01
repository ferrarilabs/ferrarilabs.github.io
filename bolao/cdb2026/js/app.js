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
// CSV/formula injection: a cell starting with =, +, -, @ (or tab/CR) can be read as a formula
// by Excel/Sheets when the exported file is opened — prefix with an apostrophe so it's always
// literal text. Real risk here: entryName/payerName are free text fully controlled by whoever
// submits the entry form.
const csvEscape = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

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
  // espnSync.activePhaseId: a única decisão que fica com o admin na sincronização automática —
  // qual fase é "a atual" agora. Ver autoSyncEspn() — não dá para inferir isso com segurança a
  // partir dos dados da ESPN sem verificação ao vivo (ambiente sem acesso de rede externo).
  // espnSync.seededKnownConfrontos: true depois que seedKnownConfrontos() rodar uma vez — nunca
  // reaplica a população inicial, mesmo que o admin remova um confronto semeado.
  return { entries: [], deletedIds: [], paid: {}, phases, espnSync: { activePhaseId: null, seededKnownConfrontos: false }, auditLog: [], meta: { updatedAt: null, version: C.siteVersion } };
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
    s.espnSync = s.espnSync && typeof s.espnSync === "object" ? s.espnSync : { activePhaseId: null };
    return s;
  } catch { return emptyState(); }
}
function saveState(s, opts = {}) {
  s.meta = s.meta || {};
  s.meta.updatedAt = new Date().toISOString();
  s.meta.version = C.siteVersion;
  localStorage.setItem(C.storeKey, JSON.stringify(s));
  if (C.database.enabled && !opts.localOnly) {
    // Nunca engolir a falha em silêncio (era `.catch(() => {})`): o estado fica só no navegador
    // e o participante/admin via a mesma mensagem de sucesso de sempre, sem saber que nada foi
    // sincronizado. Achado na auditoria de 2026-08 (AUDIT-04). O dado local já está gravado
    // acima, então a falha remota nunca perde a entrada -- só precisa ser VISÍVEL.
    saveRemoteState(s).catch(err => {
      console.warn("[CDB2026] Supabase save failed", err);
      showToast(t("syncFailed"), "warn", 8000);
    });
  }
  renderAll();
}

// AbortController timeout wrapper — item 50 do CONSISTENCY_MATRIX.md (2026-07-15): as chamadas
// ao Supabase abaixo eram feitas com fetch() cru, sem timeout, diferente de
// fetchEspnCandidates() (que já usava AbortController) — uma resposta pendurada travaria
// load/save indefinidamente. Mesmo padrão/nome de bolao/br2026/js/app.js.
async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 10000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ─── Supabase ───────────────────────────────────────────────────────────────
async function loadRemoteState() {
  if (!C.database.enabled) return;
  try {
    const { url, anonKey, table, stateId } = C.database;
    const r = await fetchJson(`${url}/rest/v1/${table}?id=eq.${stateId}&select=state`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    });
    if (!r.ok) return;
    const data = await r.json();
    if (!data?.[0]?.state) return;
    const merged = mergeStates(state(), data[0].state, { preferRemoteResults: true });
    localStorage.setItem(C.storeKey, JSON.stringify(merged));
  } catch (err) { console.warn("[CDB2026] Supabase load failed", err); }
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
  _reloadTimer = setTimeout(() => reloadRemoteIfVisible().catch(err => console.warn("[CDB2026] Reload failed", err)), 60);
}
// Lê o estado remoto atual e mescla ANTES de gravar (read-merge-write). Sem isto, cada gravação
// substituía a coluna `state` inteira pelo snapshot local de quem gravou -- `Prefer:
// resolution=merge-duplicates` resolve conflito de LINHA no upsert, não mescla o JSON. Achado na
// auditoria de 2026-08 (AUDIT-03, perda de dados confirmada): admin marca X como pago; um
// participante que carregou a página antes disso salva uma entrada nova; o POST dele reescrevia a
// linha toda com o cache velho e X voltava a "não pago". Mesmo mecanismo apagava entradas novas
// simultâneas de dois participantes (lost update) -- justamente no pico de envios perto do prazo.
// `preferRemoteResults: true` mantém a regra já usada no load: resultado/tie oficial do admin
// (remoto) vence o cache local; entradas continuam união por mais recente e `paid` é any-true-wins.
async function saveRemoteState(s) {
  if (!C.database.enabled) return { ok: false, skipped: true };
  const { url, anonKey, table, stateId } = C.database;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  let payload = s;
  try {
    const cur = await fetchJson(`${url}/rest/v1/${table}?id=eq.${stateId}&select=state`, { headers });
    if (cur.ok) {
      const rows = await cur.json();
      const remote = rows?.[0]?.state;
      if (remote) {
        payload = mergeStates(s, remote, { preferRemoteResults: true });
        payload.meta = { ...(s.meta || {}), updatedAt: new Date().toISOString(), version: C.siteVersion };
        localStorage.setItem(C.storeKey, JSON.stringify(payload));
      }
    }
  } catch (err) {
    // Pré-leitura falhou (rede/timeout): grava o snapshot local mesmo assim -- é melhor que
    // perder a entrada do participante. O risco de sobrescrita volta só neste caso degradado.
    console.warn("[CDB2026] pre-save remote read failed, saving local snapshot as-is", err);
  }
  const r = await fetchJson(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: stateId, state: payload })
  });
  // `await fetch()` NÃO rejeita em 4xx/5xx -- sem esta checagem, um 401/403 (RLS), 400 ou 500
  // era tratado como sucesso e o participante via "salvo" com o dado só no navegador dele.
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Supabase respondeu ${r.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return { ok: true };
}
// Merge de fases: para cada fase, cutoffAt e ties são mesclados independentemente — união de
// ties por id (nunca perde um confronto cadastrado em qualquer lado), remote-wins em cutoffAt e
// no conteúdo de cada tie já existente por padrão (mesma regra dos resultados oficiais na
// Copa/BR2026 — o admin/Supabase é fonte de verdade para resultado real).
function mergeStates(local, remote, opts = {}) {
  const deleted = new Set([...(local.deletedIds || []), ...(remote.deletedIds || [])]);
  // Achado 2026-07-16 (mesmo achado do BR2026, propagado aqui por ter a mesma estrutura de
  // merge): "local sempre vence" escondia edição de admin pra sempre em qualquer navegador que
  // já tivesse a entrada em cache. Preferir sempre o registro mais RECENTE por entrada
  // (updatedAt/createdAt), mesmo padrão que a Copa já usa (bolao/js/app.js mergeStates()).
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
  // any-true-wins por chave (união das chaves dos dois lados), NUNCA spread — um spread
  // (`{...remote.paid, ...local.paid}`) faz "local sempre vence", então um `false` local velho
  // sobrescrevia um `true` remoto mais novo do admin. Achado na auditoria de 2026-08 (AUDIT-02):
  // `docs/bolao/PROJECT_MEMORY.md` já DESCREVIA este merge como any-true-wins e a Copa
  // (`bolao/copa2026/js/app.js` mergedPaid) já implementava assim de verdade — só CDB2026/BR2026
  // tinham o spread. Pagamento só é desmarcado por ação explícita do admin (que grava remoto e
  // vira o lado mais novo), nunca por cache velho de participante.
  const paid = {};
  for (const k of new Set([...Object.keys(remote.paid || {}), ...Object.keys(local.paid || {})])) {
    paid[k] = !!(local.paid?.[k] || remote.paid?.[k]);
  }
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
  // TODOS os flags de migração "roda uma vez" precisam estar listados aqui. Este objeto é
  // reconstruído do zero (não é spread), então qualquer flag esquecido é DESCARTADO a cada
  // merge -- e como loadRemoteState() substitui o localStorage pelo resultado do merge, o flag
  // sumia em todo sync remoto, fazendo as rotinas "roda uma vez" rodarem de novo em toda carga.
  // Achado na auditoria de 2026-08 (AUDIT-01): 5 flags eram escritos, só 2 sobreviviam ao merge.
  // Risco concreto do que voltava a rodar: healPhantomTies() apaga ties fora da lista curada de
  // DATA.knownConfrontos -- um confronto adicionado à mão pelo admin numa fase curada, antes de
  // qualquer palpite referenciá-lo, era silenciosamente removido na carga seguinte.
  // Ao adicionar um flag novo de migração, adicione também nesta lista.
  const ESPN_SYNC_ONCE_FLAGS = [
    "seededKnownConfrontos",
    "backfilledOitavasKickoffs",
    "healedFalseAutoResults",
    "healedPhantomTies",
  ];
  const espnSync = {
    activePhaseId: opts.preferRemoteResults
      ? (remote.espnSync?.activePhaseId ?? local.espnSync?.activePhaseId ?? null)
      : (local.espnSync?.activePhaseId ?? remote.espnSync?.activePhaseId ?? null),
  };
  // OR, não remote-wins/local-wins — uma vez executada a migração em QUALQUER dispositivo, o
  // flag deve permanecer true depois do merge em todos, para a rotina nunca reaplicar.
  for (const f of ESPN_SYNC_ONCE_FLAGS) {
    espnSync[f] = !!(local.espnSync?.[f] || remote.espnSync?.[f]);
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
    phases,
    espnSync,
    auditLog: mergedAuditLog,
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

// ─── Admin action safety: triple confirmation + audit journal ───────────────────────────────
// Eduardo, 2026-07-16: "make sure there's triple confirmation if I click incorrectly it can be
// rolled back easily... what I want to avoid is to fat finger something... we need to have a way
// to journal this so it can be rolled back if needed". ESPN auto-sync covers normal operation —
// this only matters when Eduardo intervenes manually (delete confronto, enter/edit a leg score,
// lock/unlock a tie's official result). Two confirm() dialogs alone can be blitzed through with
// fast taps on mobile; the third step requires typing a fixed word, which an accidental tap
// sequence cannot produce.
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
  if (id === "games") renderGamesSection();
  if (id === "probs") renderProbsSection();
}

// ─── Cutoff ─────────────────────────────────────────────────────────────────
// Não existe mais um cutoff único global (era um resquício do modelo antigo de bracket fixo —
// ver CDB2026_RULES_AND_MODEL.md). Cada FASE tem seu próprio cutoffAt. O único uso "global" que
// resta é bloquear a CRIAÇÃO de entradas novas e alimentar o contador regressivo do topo — os
// dois usam o cutoff da fase que está realmente aberta para palpite AGORA
// (`espnSync.activePhaseId`, hoje "oitavas").
//
// Regra confirmada por Eduardo (2026-07-14): "the cutoff should be until 1 hour before the first
// game" — igual à Copa/BR2026 (ver rulesCutoffText no i18n). Antes disso dependia do admin
// CALCULAR e digitar esse valor manualmente em "Fases e confrontos" — passo que nunca tinha sido
// feito em produção, então o contador ficava preso em "aguardando sorteio" para sempre mesmo com
// o mecanismo (v3.10) já corrigido para ler a fase certa. Agora é calculado automaticamente: 1h
// antes do kickoff mais cedo já conhecido entre os confrontos da fase ativa (capturado pela
// sincronização com a ESPN — ver autoSyncEspn()). `cutoffAt` definido manualmente pelo admin
// ainda tem prioridade quando existir, para os casos em que ele queira um prazo diferente do
// automático (ex.: fechar mais cedo por algum motivo).
function firstKnownKickoffMs(s, phaseId) {
  let earliest = null;
  Object.values(s.phases?.[phaseId]?.ties || {}).forEach(tie => {
    Object.values(tie.matches || {}).forEach(m => {
      if (!m?.kickoff) return;
      const ms = new Date(m.kickoff).getTime();
      if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
    });
  });
  return earliest;
}
// Mesmo cálculo reaproveitado nos dois pontos que precisam saber se UMA fase específica já travou
// — a criação/edição de entradas (isPhaseLocked, abaixo) e o contador/bloqueio global da fase
// ativa (entryCutoffMs). Bug real encontrado em auditoria (2026-07-14): antes desta correção,
// isPhaseLocked() só olhava o cutoffAt MANUAL — como a fase nunca teve esse campo preenchido em
// produção (é opcional, o auto-cálculo existe justamente para não depender disso), uma entrada
// podia continuar sendo editada para um confronto cujo jogo real já tinha começado ou terminado.
//
// v3.18 (2026-07-14, EMERGENCY_HOTFIX, Eduardo: "esse negócio de resultado manual não funciona,
// implemente igual a Copa do Mundo, urgente, ninguém está conseguindo entrar palpites"): até aqui,
// um `cutoffAt` MANUAL tinha prioridade incondicional sobre o auto-calculado, para sempre, sem
// nenhuma checagem de validade -- foi a causa raiz de PELO MENOS três incidentes de produção no
// mesmo dia (um valor manual esquecido de testes anteriores ao mecanismo de auto-cálculo travava a
// fase inteira). A Copa não tem esse problema porque não existe ambiguidade manual-vs-auto: o
// cutoff é um valor único, direto, sem um toggle que pode ficar esquecido/desatualizado.
// Replicando essa simplicidade aqui: quando existe kickoff conhecido para a fase, o auto-calculado
// (kickoff mais cedo conhecido menos 1h) SEMPRE vence -- elimina essa classe inteira de bug de
// vez. O campo manual (`cutoffAt`) continua existindo só como fallback para quando NENHUM kickoff é
// conhecido ainda (ex.: antes do sorteio real de uma fase), igual sempre foi seu propósito original
// antes do auto-cálculo existir.
function effectivePhaseCutoffMs(s, phaseId) {
  const firstKickoff = firstKnownKickoffMs(s, phaseId);
  if (firstKickoff !== null) return firstKickoff - 3600000;
  const manual = s.phases?.[phaseId]?.cutoffAt;
  return manual ? new Date(manual).getTime() : null;
}
function entryCutoffMs() {
  const s = state();
  const phaseId = s.espnSync?.activePhaseId || "fase-1";
  return effectivePhaseCutoffMs(s, phaseId);
}
function isPastEntryCutoff() {
  const ms = entryCutoffMs();
  return ms !== null && Date.now() > ms;
}
function isPhaseLocked(s, phaseId) {
  const ms = effectivePhaseCutoffMs(s, phaseId);
  return ms !== null && Date.now() > ms;
}
// "Editar minha entrada" só faz sentido depois que a Oitavas (primeira fase que o participante de
// fato palpita -- fase-1 a fase-4 são histórico já concluído antes do bolão existir, ver
// DATA.phasesConcludedNoData) termina: antes disso não há nada de novo pra editar, e o card só
// confunde quem está enviando a entrada pela primeira vez -- mesma intenção original de
// oitavasComplete() no modelo antigo de bracket fixo (pré-rewrite v3.0, ver git history).
//
// v3.20 (2026-07-14, EMERGENCY_HOTFIX, mesmo dia): a v3.9 "corrigiu" um bug real (o card ficava
// travado PARA SEMPRE porque a checagem antiga usava fase-1, que nunca tem confronto cadastrado
// no modelo novo) mas checando a fase ERRADA -- fase1Complete() checava fase-1 (sempre
// "concluída" via DATA.phasesConcludedNoData desde a v3.8), não Oitavas. O efeito colateral nunca
// percebido: o gate virou um no-op permanente, "editar minha entrada" ficou disponível o tempo
// todo desde a v3.9, quando devia continuar fechado até a Oitavas terminar de verdade. Renomeado
// e re-targetado para checar a fase certa.
function oitavasComplete(s) {
  return phaseFullyResolved(s, "oitavas");
}
// Verdadeiro quando a fase tem confrontos cadastrados e todos já têm resultado (qualifiedTeamId)
// — usado para tirar fases já decididas do formulário de palpites (nada a apostar) sem depender
// de cutoffAt, que é opcional e só o admin define manualmente.
function phaseFullyResolved(s, phaseId) {
  const ties = Object.values(s.phases?.[phaseId]?.ties || {});
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
// The EmailJS template's Subject field interpolates entry_name/receipt_code with plain {{}}
// (HTML-escaped) rather than {{{}}} like the body -- "/" comes out as the literal "&#x2F;" in
// the subject header, which is plain text and never HTML-decodes it back (Eduardo, 2026-07-24,
// saw this on BR2026's round-email date ranges -- same platform-wide gap, hardened here for
// free-typed entry names too). Same helper as Copa/BR2026, kept local per app per platform
// convention (no shared imports between the three apps).
function emailSubjectSafe(s) {
  return String(s ?? "").replace(/\//g, "-");
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
function emptyMatch() { return { homeTeam: null, awayTeam: null, kickoff: null, venue: null, city: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" }; }

// Fonte única de "quem é mandante nesta perna". No mata-mata de ida e volta o mandante se
// inverte na volta, e `goalsHome`/`goalsAway` (tanto de palpite quanto de resultado) são SEMPRE
// relativos ao mandante REAL daquela perna -- é assim que o formulário coleta (renderPickForm) e
// como a aba Jogos/o admin já exibiam. Achado na auditoria de 2026-08 (AUDIT-05): o comprovante,
// o detalhe "Ver palpites" do ranking e o CSV imprimiam `teamA × teamB` fixo com
// `goalsHome × goalsAway`, invertendo o placar da VOLTA -- um palpite "Fluminense 3 × 0 Vasco"
// aparecia como "Vasco 3 × 0 Fluminense" nesses três documentos. Não afetava pontuação
// (matchPoints compara palpite e resultado na mesma orientação), só os documentos que provam o
// que o participante apostou. Use SEMPRE esta função ao exibir uma perna.
function legTeams(tie, leg, match) {
  return {
    home: match?.homeTeam || (leg === "second" ? tie.teamB : tie.teamA),
    away: match?.awayTeam || (leg === "second" ? tie.teamA : tie.teamB),
  };
}

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
    // Mesma ordenação cronológica da aba "Jogos" (ver firstLegKickoffMs()) -- achado por Eduardo
    // (2026-07-14): o fix anterior só cobria "Jogos" (fora deliberadamente do escopo pedido na
    // hora), mas o formulário de Palpites é o que participantes de fato usam, e continuava na
    // ordem crua de inserção. Confrontos sem kickoff conhecido ainda ficam no fim.
    ties.sort(([, tieA], [, tieB]) => {
      const msA = firstLegKickoffMs(tieA, phase.format);
      const msB = firstLegKickoffMs(tieB, phase.format);
      if (msA === null && msB === null) return 0;
      if (msA === null) return 1;
      if (msB === null) return -1;
      return msA - msB;
    });
    // Fases já decididas (todo confronto com qualifiedTeamId) ou já concluídas antes do bolão
    // existir (ver DATA.phasesConcludedNoData) não têm nada a apostar — tiradas do formulário de
    // palpites em vez de mostrar N linhas travadas ou um "aguardando sorteio" enganoso. Ainda
    // aparecem normalmente em "Jogos" para referência.
    if (phaseFullyResolved(s, phase.id)) return;
    if (!ties.length && (DATA.phasesConcludedNoData || []).includes(phase.id)) return;
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
      if (isPhaseLocked(s, phase.id)) {
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
  if (isPastEntryCutoff() && !_editingEntry) { showToast(t("closed"), "warn"); return; }
  const entryName     = $("entryName")?.value.trim() || "";
  const payerName     = $("payerName")?.value.trim() || "";
  const email         = $("participantEmail")?.value.trim() || "";
  const paymentMethod = $("paymentMethod")?.value || "";

  if (!entryName) { alert(t("errorEntryName")); return; }
  if (!payerName) { alert(t("requiredPayerName")); return; }
  if (!email || !email.includes("@")) { alert(t("errorEmail")); return; }
  if (!paymentMethod) { alert(t("requiredPaymentMethod")); return; }

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
      queueReceipt(entry);
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
// Botões "Abrir comprovante"/"Baixar HTML" -- item 9 do CONSISTENCY_MATRIX.md (2026-07-15),
// mesmo padrão da Copa (.receipt-actions, renderLatestReceipt() em bolao/js/app.js). Botões
// recriados a cada render, então os listeners são anexados diretamente aqui (sem delegação
// global) -- mesmo padrão já usado em renderRanking() para data-rank-toggle.
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
  card.classList.toggle("hidden", !oitavasComplete(state()));
}

// ─── Tiebreaker helpers ──────────────────────────────────────────────────────
function hitChampion(detail) { return detail?.champion?.type === "exact" ? 1 : 0; }
function hitRunnerUp(detail) { return detail?.runnerUp?.type === "exact" ? 1 : 0; }
function countExactMatches(detail) { return Object.values(detail?.matches || {}).filter(d => d.type === "exact").length; }

// ─── Email receipt ───────────────────────────────────────────────────────────
let _lastEmailTs = 0;
// Mesma estrutura/CSS visual do comprovante da Copa (receiptHtml() em bolao/js/app.js) e do
// BR2026 -- achado em auditoria (2026-07-14): os três apps tinham um e-mail de comprovante
// visualmente diferente entre si (tabela `border="1"` sem estilo nenhum aqui, tema escuro/Inter
// no BR2026, tema claro/Arial na Copa). Alinhado ao padrão canônico da Copa (tema claro, cartão
// branco, grade `.meta`, código em monospace, tabela com cabeçalho escuro, bloco de destaque
// estilo pódio) -- só o CONTEÚDO muda por torneio (campeão/vice em 2 cartões em vez de 4, placar
// por confronto em vez de partidas do bracket), como previsto em PLATFORM_GOVERNANCE.md
// ("diferenças específicas de torneio devem ser preservadas").
function receiptHtml(entry, s) {
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
        const { home: rHome, away: rAway } = legTeams(tie, leg, tie.matches?.[leg]);
        rows.push(`<tr><td>${esc(rHome)} × ${esc(rAway)}${legLabel}</td><td><b>${pick.goalsHome} × ${pick.goalsAway}</b></td></tr>`);
      });
    });
  });
  const predicted = predictedPodium(entry, s);

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(t("receiptTitle"))}</title>
<style>body{font-family:Arial,sans-serif;background:#f4f7fb;margin:0;color:#111}
.doc{max-width:900px;margin:24px auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 40px #0002}
h1{margin:0 0 4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f1f5f9;border-radius:14px;padding:14px;margin:18px 0}
.code{font-family:monospace;color:#087a35;font-weight:bold}.pod{background:linear-gradient(135deg,#07151c,#0f3b22);color:#fff;border-radius:18px;padding:18px;margin:22px 0}
.pod h2{text-align:center;margin:0 0 14px}.podgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.podcard{border-radius:14px;padding:14px;text-align:center;background:#ffffff18}
.champ{background:#ffd35a;color:#111}.team-name{font-size:22px;font-weight:900;margin-top:4px}
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
<b>${esc(t("receiptSentAt"))}:</b> ${new Date(entry.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (BRT)<br>
<b>${esc(t("receiptCodeLabel"))}:</b> <span class="code">${esc(receiptCode(entry))}</span></div></div>
<div class="pod"><h2>${esc(t("pickHintTie") ? "🏆 Palpite final do participante" : "")}</h2><div class="podgrid">
<div class="podcard champ"><div>🥇 ${esc(t("pickLabelChampion"))}</div><div class="team-name">${esc(predicted.champion || "—")}</div></div>
<div class="podcard"><div>🥈 ${esc(t("pickLabelRunnerUp"))}</div><div class="team-name" style="color:#fff">${esc(predicted.runnerUp || "—")}</div></div>
</div></div>
<table><thead><tr><th>${esc(t("receiptColMatch"))}</th><th>${esc(t("receiptColScore"))}</th></tr></thead>
<tbody>${rows.join("") || `<tr><td colspan="2">—</td></tr>`}</tbody></table>
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
// document.write (ver SECURITY.md); CDB2026 só mostrava o código do comprovante em texto, sem
// jeito de abrir/imprimir/baixar. Reaproveita o mesmo receiptHtml() já usado no e-mail.
function openReceipt(id) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  const blob = new Blob([receiptHtml(e, state())], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) { URL.revokeObjectURL(url); alert(t("receiptPopupBlocked")); return; }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function downloadReceipt(id) {
  const e = state().entries.find(x => x.id === id);
  if (!e) return;
  downloadBlob(`comprovante-${receiptCode(e)}.html`, receiptHtml(e, state()), "text/html");
}

// Fila serial com espaçamento mínimo entre envios. Antes: `if (now - _lastEmailTs <
// limitRateMs) return;` DESCARTAVA o e-mail em silêncio -- e como `_lastEmailTs` é global (não
// por participante), a 2ª entrada salva dentro de 30s (mesmo de outra pessoa) nunca recebia
// comprovante, nem o admin recebia a cópia, enquanto o participante via
// "Palpite salvo! Verifique seu e-mail para o comprovante." Achado na auditoria de 2026-08
// (AUDIT-07). O rate limit continua existindo (proteção de cota do EmailJS, exigida) -- só que
// agora ele ESPERA a janela em vez de jogar o e-mail fora, então a mensagem ao participante
// passa a ser verdadeira. Serial: cada envio só começa quando o anterior terminou.
let _emailQueue = Promise.resolve();
function queueReceipt(entry) {
  _emailQueue = _emailQueue.then(async () => {
    const wait = C.emailjs.limitRateMs - (Date.now() - _lastEmailTs);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    return sendReceipt(entry);
  }).catch(err => console.warn("[CDB2026] queued receipt failed", err));
  return _emailQueue;
}

async function sendReceipt(entry) {
  if (!C.emailjs.enabled || !window.emailjs) return;

  const s = state();
  const html = receiptHtml(entry, s);
  const code = receiptCode(entry);
  const params = {
    to_email:     entry.participantEmail,
    entry_name:   `Copa do Brasil 2026 — ${emailSubjectSafe(entry.entryName)}`,
    receipt_code: code,
    html_message: html,
  };

  try {
    await window.emailjs.send(C.emailjs.serviceId, C.emailjs.participantTemplateId, params, { publicKey: C.emailjs.publicKey });
    _lastEmailTs = Date.now();
    if (C.adminEmail) {
      await window.emailjs.send(C.emailjs.serviceId, C.emailjs.adminTemplateId, {
        ...params,
        to_email: C.adminEmail,
        entry_name: `Nova entrada — ${emailSubjectSafe(entry.entryName)}`,
      }, { publicKey: C.emailjs.publicKey });
    }
  } catch (err) {
    console.error("[CDB2026] sendReceipt failed:", err);
  }
}

// ─── Countdown ───────────────────────────────────────────────────────────────
function renderCountdown() {
  const box  = $("cutoffCountdown");
  if (!box) return;
  const card = box.closest(".count-card");
  const ms   = entryCutoffMs();
  if (ms === null) {
    card?.classList.remove("hidden");
    box.innerHTML = `<div class="count-label">${esc(t("countdownTitle"))}</div><span class="count-closed">${esc(t("waitingDraw"))}</span>`;
    return;
  }
  const diff = ms - Date.now();
  // Mesmo padrão da Copa (updateCountdown(), bolao/js/app.js) e do BR2026 (v1.56): esconde a
  // caixa inteira depois do prazo em vez de deixar "Encerrado" solto ocupando o mesmo espaço
  // vazio da contagem regressiva. Eduardo, screenshot do hero pós-prazo: "Pode esconder isso"
  // (2026-07-16, mesmo achado do BR2026 propagado aqui).
  if (diff <= 0) { card?.classList.add("hidden"); return; }
  card?.classList.remove("hidden");
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
// Rank deve avançar sempre que QUALQUER nível do desempate mudar, não só o total — mesmo padrão
// da Copa (bolao/js/app.js renderRanking(), chave composta `${total}:${exact}:${podiumHits}`).
// Bug real encontrado em auditoria (2026-07-14): comparar só `item.total` deixava duas entradas
// com o mesmo total mas desempate diferente mostrando o MESMO rank/medalha, mesmo com o array
// já ordenado corretamente — afeta diretamente quem aparece como 2º lugar (não há 3º na Copa do
// Brasil, prêmio é só campeão/vice), base do rateio de prêmio.
// Única implementação do desempate — usada tanto pelo Ranking exibido quanto por
// calculateRankingMovement() abaixo, pra baseline-rank e live-rank nunca poderem divergir do que
// a tela realmente mostra (mesma classe de bug do CHANGELOG v4.57 da Copa, evitada aqui por só
// ter UM lugar que sabe ordenar entradas).
function rankEntriesBy(entries, scoreFn) {
  const scored = entries.map(e => ({ e, ...(scoreFn(e) || { total: 0, detail: null }) }))
    .sort((a, b) =>
      b.total - a.total ||
      hitChampion(b.detail) - hitChampion(a.detail) ||
      hitRunnerUp(b.detail) - hitRunnerUp(a.detail) ||
      countExactMatches(b.detail) - countExactMatches(a.detail) ||
      b.e.entryName.localeCompare(a.e.entryName, "pt-BR")
    );
  let rank = 0, prevKey = null;
  return scored.map((item, i) => {
    const key = `${item.total}:${hitChampion(item.detail)}:${hitRunnerUp(item.detail)}:${countExactMatches(item.detail)}`;
    if (key !== prevKey) { rank = i + 1; prevKey = key; }
    return { ...item, rank };
  });
}

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

  // Durante uma janela ao vivo, o total exibido já soma os pontos da(s) partida(s) em
  // andamento (liveScoreEntry()) -- mesmo padrão do BR2026 (currentResultSet(), v1.54): antes
  // disso o Ranking só reagia ao placar DEPOIS que a ESPN marcava o jogo como encerrado, tarde
  // demais pra ser uma "projeção ao vivo" de verdade. A seta de movimento (rankMovementHtml)
  // compara contra a posição oficial (sem o placar ao vivo) -- ver calculateRankingMovement().
  const movement = calculateRankingMovement(entries, s);
  const scored   = rankEntriesBy(entries, e => (_liveTies.length ? liveScoreEntry(e, s) : getActiveScore(e, s)));

  const { done, totalTies } = resultsProgress(s);
  const provNote = totalTies > 0 && done < totalTies
    ? `<p class="prov-note">↕ ${esc(t("provisionalNote"))}</p>` : "";

  // Pago/Pendente é informação de administração do bolão, não do ranking público -- mesmo
  // padrão da Copa (renderRanking(), bolao/js/app.js), que nunca mostrou esse badge na linha do
  // ranking (só existe na aba Participantes). Achado real (2026-07-16, Eduardo: "nao precisa
  // pago e pendente, so para o admin"). "Ver palpites" só faz sentido depois do prazo da fase
  // ativa -- antes disso o botão só levava a uma mensagem "escondido até o prazo"
  // (renderPickDisplay() já protegia o dado, mas o botão continuava visível e clicável sem
  // fazer nada útil).
  const canViewPicks = isPastEntryCutoff();
  box.innerHTML = provNote;
  scored.forEach(item => {
    const medal   = { 1: "🥇", 2: "🥈", 3: "🥉" }[item.rank] || `${item.rank}`;
    const mv      = movement.get(item.e.id);
    const viewBtn = canViewPicks
      ? `<button type="button" class="secondary small-btn" data-rank-toggle="${esc(item.e.id)}" aria-label="${esc(t("viewPicks"))} — ${esc(item.e.entryName || "")}">${esc(t("viewPicks"))}</button>`
      : "";
    const row = document.createElement("div");
    row.className = "rank-row";
    // Número puro, sem sufixo " pts" -- mesmo padrão da Copa. A coluna de pontos no mobile tem
    // largura FIXA de 40px (pra o botão "Ver palpites" nunca deslocar conforme o placar tem
    // 1-3 dígitos, ver CSS), dimensionada só pros dígitos. Com "170 pts" a linha quebrava --
    // Eduardo: "Deixe tudo da entrada em uma linha e sem crlf" (2026-07-16, mesmo ajuste no BR2026).
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
      detail.innerHTML = renderPickDisplay(item.e, item.detail);
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
  }));
}

function renderPickDisplay(entry, detail) {
  // Achado real (2026-07-14, Eduardo: "ver palpites nao pode estar aberto ate a CDB e o
  // brasileirao iniciarem, senao as pessoas podem copiar") -- mesma proteção que a Copa já tem
  // (hideFuturePicks() em bolao/js/app.js), nunca implementada aqui: nada impedia expandir "Ver
  // palpites" de qualquer entrada a qualquer momento, mesmo antes do prazo da fase ativa --
  // outro participante podia copiar o palpite de alguém antes de enviar o seu. Gate simples e
  // seguro por enquanto: esconde TUDO até o prazo da fase ativa passar (mais restritivo que o
  // necessário quando a fase ativa já avançou além de uma fase antiga já decidida, mas nunca
  // expõe cedo demais -- refino por fase específica fica para uma iteração futura se precisar).
  if (!isPastEntryCutoff()) return `<p class="muted">${esc(t("picksHiddenUntilCutoff"))}</p>`;
  // Achado real (2026-07-14, Eduardo: "a visualizacao de ver palpites da CDB tambem esta
  // inconsistente com a da copa"): esta função usava um card flex-column
  // (.picks-display.cdb-picks/.pick-item/.pick-cell), estrutura totalmente diferente da Copa,
  // que usa <table> dentro de .picks-detail (mesmas classes de CSS: .picks-detail table/th/td,
  // ver bolao/css/styles.css). Reconstruído para usar a MESMA estrutura de tabela -- só o
  // conteúdo muda por torneio (confronto/placar em vez de partida/placar/vencedor do bracket).
  const s = state();
  const ptsCell = d => d
    ? `<b class="pick-pts${d.pts > 0 ? " pos" : ""}">${d.pts > 0 ? "+" + d.pts : "—"}</b>`
    : `<span class="muted">—</span>`;
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
        const legLabel = leg === "single" ? "" : ` (${leg === "first" ? esc(t("gamesLeg1")) : esc(t("gamesLeg2"))})`;
        const cls = d ? (d.type === "exact" ? "pick-exact" : d.type === "miss" ? "pick-miss" : "pick-partial") : "";
        const { home: pHome, away: pAway } = legTeams(tie, leg, tie.matches?.[leg]);
        rows.push(`<tr class="${cls}"><td>${esc(pHome)} × ${esc(pAway)}${legLabel}</td><td><b>${pick.goalsHome} × ${pick.goalsAway}</b></td><td style="text-align:center">${ptsCell(d)}</td></tr>`);
      });
      const pickQual = entry.picks?.qualified?.[tieId];
      if (tie.qualifiedTeamId && pickQual) {
        const d = detail?.ties?.[tieId];
        const teamName = pickQual === "A" ? tie.teamA : tie.teamB;
        const cls = d?.type === "hit" ? "pick-exact" : "pick-miss";
        rows.push(`<tr class="${cls}"><td>${esc(t("pickQualifiedLabel"))}: ${esc(tie.teamA)} × ${esc(tie.teamB)}</td><td><b>${esc(teamName)}</b></td><td style="text-align:center">${ptsCell(d)}</td></tr>`);
      }
    });
  });

  const predicted = predictedPodium(entry, s);
  const bonusRow = (label, team, d) => team
    ? `<tr class="${d ? (d.type === "exact" ? "pick-exact" : "pick-miss") : ""}"><td>${esc(label)}</td><td><b>${esc(team)}</b></td><td style="text-align:center">${ptsCell(d)}</td></tr>`
    : "";

  return `<table><thead><tr><th>${esc(t("receiptColMatch"))}</th><th>${esc(t("receiptColScore"))}</th><th style="text-align:center">Pts</th></tr></thead>
    <tbody>
      ${bonusRow("🏆 " + t("pickLabelChampion"), predicted.champion, detail?.champion)}
      ${bonusRow("🥈 " + t("pickLabelRunnerUp"), predicted.runnerUp, detail?.runnerUp)}
      ${rows.join("") || `<tr><td colspan="3">${esc(t("pickNoOpenTies"))}</td></tr>`}
    </tbody></table>`;
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
  const sc = C.scoring;
  const pr = C.prizes;
  box.innerHTML = `
    <div class="card">
      <h3>${esc(t("rulesScoring"))}</h3>
      <table class="rules-table">
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
  // Perf: recomputava a grade de Poisson/Dixon-Coles inteira (busca binária + grade 81 células,
  // por confronto TWO_LEG aberto) a cada renderAll() -- todo resync de 30s, todo save -- mesmo com
  // a aba fora de tela. Achado em auditoria (2026-07-14). showSection() já chama esta função
  // explicitamente ao abrir a aba (linha ~194), então pular aqui não perde nenhuma atualização.
  if (!document.getElementById("probs")?.classList.contains("active")) return;
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
// Mesmo formato usado pelo BR2026 (brtLongDate em bolao/br2026/js/app.js) — dia da semana
// abreviado + data + hora, fuso America/Sao_Paulo. Compartilhado entre a aba "Jogos" e o card
// "Próxima partida" (renderNextTieCard()) para o mesmo confronto aparecer com a mesma data nos
// dois lugares.
// Eduardo: "Seria ideal botar o horário brt e est sendo est primeiro para não confundir o
// pessoal" (2026-07-17) — mesmo ajuste do BR2026 (estTimeStr, bolao/br2026/js/app.js): público
// inclui brasileiros morando nos EUA. Usa Intl (America/New_York) em vez de offset fixo -- a
// Copa do Brasil roda o ano inteiro e cruza a virada EDT/EST (novembro).
function estTimeStr(dateStr) {
  const d = new Date(dateStr);
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
    .formatToParts(d).find(p => p.type === "timeZoneName")?.value || "ET";
  return `${time} (${tz})`;
}

function fmtDate(dateStr) {
  if (!dateStr) return t("gamesTbd");
  try {
    const brt = new Date(dateStr).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    }) + " BRT";
    return `${estTimeStr(dateStr)} · ${brt}`;
  } catch { return dateStr; }
}

// Caixa de dígitos ao vivo (dias/horas/min/seg) para o card "Próxima partida" -- mesmo algoritmo
// e mesma marcação (.count-grid + variante .four quando há dias) do contador da Copa
// (renderNextMatch() em bolao/js/app.js) e do BR2026 (countdownTimerHtml(), mesmo nome/mesma
// implementação lá). Ver DESIGN_SYSTEM.md -- antes o card só tinha texto estático de data, sem
// contador nenhum, divergência real encontrada por Eduardo.
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

// Kickoff da perna de ida (ou da partida única em SINGLE_MATCH) -- sempre o primeiro item de
// legsForFormat(format), nunca a volta -- usado só para ORDENAR a aba "Jogos" em ordem
// cronológica (pedido do Eduardo, 2026-07-14), nunca para decidir nada de pontuação/cutoff.
function firstLegKickoffMs(tie, format) {
  const firstLeg = legsForFormat(format)[0];
  const ms = tie.matches?.[firstLeg]?.kickoff ? new Date(tie.matches[firstLeg].kickoff).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function renderGamesSection() {
  const box = $("gamesList");
  if (!box) return;
  const s = state();

  let html = "";
  DATA.phases.forEach(phase => {
    const ties = Object.entries(s.phases?.[phase.id]?.ties || {});
    // Ordem cronológica pela data da ida (ou única) -- confrontos sem kickoff conhecido ainda
    // (aguardando sorteio/data) ficam no fim, na ordem em que já estavam, em vez de embaralhar.
    ties.sort(([, tieA], [, tieB]) => {
      const msA = firstLegKickoffMs(tieA, phase.format);
      const msB = firstLegKickoffMs(tieB, phase.format);
      if (msA === null && msB === null) return 0;
      if (msA === null) return 1;
      if (msB === null) return -1;
      return msA - msB;
    });
    html += `<h3 class="games-round-header">${esc(phase.name)}</h3>`;
    if (!ties.length) {
      const msg = (DATA.phasesConcludedNoData || []).includes(phase.id) ? "phaseAlreadyConcluded" : "waitingDraw";
      html += `<p class="muted" style="margin-bottom:14px">${esc(t(msg))}</p>`;
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
        // Item 25 do CONSISTENCY_MATRIX.md (2026-07-15) -- chip de "Adiado" quando a ESPN
        // sinaliza a partida como adiada/cancelada (ver isLegPostponed()/fetchLiveTies()).
        const postponedChip = m.goalsHome == null && isLegPostponed(tieId, leg)
          ? ` <span class="game-status postponed">${esc(t("gamePostponed"))}</span>` : "";
        return `<div class="leg">
          ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
          <span class="leg-teams">${esc(home)} ${teamLogoImg(home, "team-logo")} × ${teamLogoImg(away, "team-logo")} ${esc(away)}</span>
          <span class="leg-info">${m.venue ? "📍 " + esc(m.venue) + (m.city ? ", " + esc(m.city) : "") + " · " : ""}${scoreOrDate}${postponedChip}</span>
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

// ─── Render: próxima partida ───────────────────────────────────────────────────
// Card equivalente ao #nextGameCard do BR2026 (mesmas classes CSS, mesmo formato de data —
// fmtDate() acima) — não existia nenhum aqui antes (achado por Eduardo, 2026-07-14, ver
// DESIGN_SYSTEM.md). Depende de matches[leg].kickoff estar preenchido; hoje isso só acontece via
// sincronização com a ESPN (autoSyncEspn() grava kickoff/venue/city na primeira perna de um
// confronto novo) — não existe ainda um jeito do admin cadastrar kickoff manualmente para um
// confronto adicionado à mão. Fica escondido normalmente até isso acontecer, mesmo comportamento
// de "sem próximo jogo" que a Copa/BR2026 já têm.
function findNextUpcomingMatch(s) {
  let best = null;
  DATA.phases.forEach(phase => {
    Object.values(s.phases?.[phase.id]?.ties || {}).forEach(tie => {
      if (!tie.teamA || !tie.teamB) return;
      legsForFormat(phase.format).forEach(leg => {
        const m = tie.matches?.[leg];
        if (!m || !m.kickoff || m.status === "FINAL") return;
        const kickoffMs = new Date(m.kickoff).getTime();
        if (!Number.isFinite(kickoffMs) || kickoffMs <= Date.now()) return;
        if (!best || kickoffMs < best.kickoffMs) {
          const home = m.homeTeam || (leg === "second" ? tie.teamB : tie.teamA);
          const away = m.awayTeam || (leg === "second" ? tie.teamA : tie.teamB);
          best = { kickoffMs, m, home, away };
        }
      });
    });
  });
  return best;
}

// "YYYY-MM-DD" em BRT, mesmo formato do BR2026 (brtDateKey, bolao/br2026/js/app.js) -- usado só
// pra agrupar partidas por dia, nunca pra exibir direto (fmtDate() já cuida disso).
function brtDateKey(isoStr) {
  const s = new Date(isoStr).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const [dd, mm, yyyy] = s.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

// Todas as partidas futuras que caem no mesmo dia (BRT) da mais próxima -- achado real
// (2026-07-16, Eduardo: "proximo jogo mostra somente um, mas amanha tem mais, mostre proximos
// jogos quando ha mais de um no mesmo dia"). findNextUpcomingMatch() em si não muda (é só "a
// mais próxima"); esta função agrupa por dia em cima do resultado dela.
function findAllUpcomingMatchesOnNextDay(s) {
  const first = findNextUpcomingMatch(s);
  if (!first) return [];
  const dayKey = brtDateKey(new Date(first.kickoffMs).toISOString());
  const all = [];
  DATA.phases.forEach(phase => {
    Object.values(s.phases?.[phase.id]?.ties || {}).forEach(tie => {
      if (!tie.teamA || !tie.teamB) return;
      legsForFormat(phase.format).forEach(leg => {
        const m = tie.matches?.[leg];
        if (!m || !m.kickoff || m.status === "FINAL") return;
        const kickoffMs = new Date(m.kickoff).getTime();
        if (!Number.isFinite(kickoffMs) || kickoffMs <= Date.now()) return;
        if (brtDateKey(m.kickoff) !== dayKey) return;
        const home = m.homeTeam || (leg === "second" ? tie.teamB : tie.teamA);
        const away = m.awayTeam || (leg === "second" ? tie.teamA : tie.teamB);
        all.push({ kickoffMs, m, home, away, phaseName: phase.name });
      });
    });
  });
  return all.sort((a, b) => a.kickoffMs - b.kickoffMs);
}

function renderNextTieCard() {
  const card = $("nextTieCard");
  if (!card) return;
  const s     = state();
  const group = findAllUpcomingMatchesOnNextDay(s);
  if (!group.length) { card.classList.add("hidden"); return; }

  if (group.length > 1) {
    // Contador em dígitos, mesmo componente exato da Copa (countdownTimerHtml() -> .count-grid)
    // -- não texto solto. Eduardo: "A contagem regressiva tem que ser igual copa meu!"
    // (2026-07-17), mesmo ajuste do BR2026.
    const items = group.map(({ m, home, away, kickoffMs, phaseName }) => {
      const diffMs   = kickoffMs - Date.now();
      const timerHtml = countdownTimerHtml(diffMs);
      return `<div class="today-game">
      <div class="next-game-row">
        <div class="next-game-info-block">
          <div class="today-game-teams">${esc(home)} ${teamLogoImg(home, "team-logo")} <span class="next-game-vs">×</span> ${teamLogoImg(away, "team-logo")} ${esc(away)}</div>
          <div class="today-game-time muted">${phaseName ? esc(phaseName) + " · " : ""}${esc(fmtDate(m.kickoff))}</div>
          ${m.venue ? `<div class="next-game-venue">📍 ${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</div>` : ""}
        </div>
        ${timerHtml}
      </div>
    </div>`;
    }).join("");
    card.innerHTML = `<div class="next-game-card">
      <div class="today-games-header">${esc(t("nextGamesLabel"))}</div>
      ${items}
    </div>`;
    card.classList.remove("hidden");
    return;
  }

  const next = group[0];
  const { m, home, away, phaseName } = next;
  const diffMs    = next.kickoffMs - Date.now();
  const timerHtml = countdownTimerHtml(diffMs);

  card.innerHTML = `<div class="next-game-card">
    <div class="next-game-label">${esc(t("nextGameLabel"))}</div>
    <div class="next-game-row">
      <div class="next-game-info-block">
        <div class="next-game-teams">${esc(home)} ${teamLogoImg(home, "team-logo")} <span class="next-game-vs">×</span> ${teamLogoImg(away, "team-logo")} ${esc(away)}</div>
        ${phaseName ? `<div class="next-game-info">${esc(phaseName)}</div>` : ""}
        <div class="next-game-info">${esc(fmtDate(m.kickoff))}</div>
        ${m.venue ? `<div class="next-game-venue">${esc(m.venue)}${m.city ? `, ${esc(m.city)}` : ""}</div>` : ""}
      </div>
      ${timerHtml}
    </div>
  </div>`;
  card.classList.remove("hidden");
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
// Bug real encontrado em auditoria (2026-07-14), classificado CRÍTICO: nem "Fases e confrontos"
// nem "Resultados" tinham qualquer proteção contra o resync de 30s em segundo plano -- diferente
// do formulário de palpite do participante (pickFormIsDirty(), já corrigido). Um admin digitando
// o nome de um time novo, ou lançando o placar real logo após um jogo (sob pressão de tempo, a
// pior hora pra isso acontecer), podia ter o campo apagado por um resync que não tem nada a ver
// com essa ação. Os campos de "adicionar confronto"/placar não têm valor salvo pra comparar (ficam
// sempre em branco depois de salvos com sucesso) -- então "sujo" aqui é simplesmente "tem algo
// digitado, ainda não enviado".
function adminPhasesFormIsDirty() {
  const box = document.getElementById("adminPhases");
  if (!box) return false;
  if ([...box.querySelectorAll(".adm-team-a, .adm-team-b")].some(el => el.value.trim() !== "")) return true;
  const s = state();
  return [...box.querySelectorAll(".admin-phase-block")].some(block => {
    const phaseId = block.dataset.phase;
    const input = block.querySelector(".adm-phase-cutoff");
    if (!input) return false;
    const saved = s.phases?.[phaseId]?.cutoffAt ? toLocalDatetimeValue(s.phases[phaseId].cutoffAt) : "";
    return input.value !== saved;
  });
}
function adminResultsFormIsDirty() {
  const box = document.getElementById("adminResults");
  if (!box) return false;
  return [...box.querySelectorAll(".adm-leg-a, .adm-leg-b")].some(el => el.value.trim() !== "");
}
function renderAdmin() {
  if (!isAdminActive()) return;
  const s = state();
  renderAdminEspnSync(s);
  if (!adminPhasesFormIsDirty()) renderAdminPhases(s);
  if (!adminResultsFormIsDirty()) renderAdminResults(s);
  renderAdminPayments(s);
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
    const teams = d.teamA && d.teamB ? `${esc(d.teamA)} × ${esc(d.teamB)}` : "";
    return `<div class="audit-row">
      <div class="audit-meta">
        <span class="muted" style="font-size:11px">${esc(ts)} ET</span>
        <b>${esc(t(`auditAction_${entry.action.replace(/-/g, "_")}`) || entry.action)}</b>
        ${teams ? `<span class="muted" style="font-size:12px">${teams}</span>` : ""}
      </div>
      <div style="font-size:11px;color:#667;margin-top:2px;word-break:break-all">${esc(JSON.stringify(d))}</div>
    </div>`;
  }).join("");
  box.innerHTML += rows;
}

// ─── Sincronização com ESPN (automática, sem clique por confronto) ───────────────────────────
// v3.3: a v3.1 exigia um clique de confirmação por confronto — Eduardo pediu para automatizar.
// A única decisão que continua manual é qual fase é "a atual" (s.espnSync.activePhaseId): não
// dá para inferir isso com segurança a partir dos dados da ESPN sem verificação ao vivo (ver
// docs/bolao/CDB2026_RULES_AND_MODEL.md "Sincronização com ESPN"). Com a fase ativa definida,
// confrontos novos são detectados e adicionados sozinhos — sem clique por linha. O que
// continua manual e nunca é automatizado: TRAVAR um resultado (isso decide o pagamento) — essa
// etapa continua exigindo o fluxo existente em "Resultados".
const ESPN_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let _espnLastAutoSyncAt = 0;
let _espnLastRunSummary = null; // { addedCount, added, lockedCount, locked, filledLegsCount, error, at } | null — só para exibir no admin

// ─── Live match card (2026-07-15) ────────────────────────────────────────────────────────────
// Achado em auditoria comparativa Copa/BR2026/CDB2026 (Eduardo, 2026-07-15): CDB2026 nunca teve
// NENHUMA experiência de "jogo ao vivo" para o participante -- só a sincronização de resultado
// FINAL a cada 5 min (autoSyncEspnFull, acima), que roda em segundo plano e não mostra nada na
// tela enquanto o jogo está em andamento. Como as Oitavas são mata-mata real (jogo dia 1º de
// agosto, com prorrogação/pênaltis genuinamente possíveis), essa era a maior divergência real da
// plataforma vs. a Copa. Eduardo pediu explicitamente "tem que bater exatamente com o da Copa" --
// portado quase literalmente (mesmos nomes de função, mesma lógica de relógio/intervalo/pênaltis)
// de bolao/js/app.js (pollLiveScores/mapEspnToLiveScores/mergeLiveClock/formatMatchClock), ao
// contrário do BR2026 (liga, sem prorrogação/pênaltis reais), aqui o period 3/4/5 IMPORTA de
// verdade -- mantido completo, não simplificado.
const CDB_HALF_BOUNDARIES_MIN = [120, 105, 90, 45];
const CDB_PERIOD_BOUNDARY_MIN = { 1: 45, 2: 90, 3: 105, 4: 120 };
const CDB_MAX_STOPPAGE_SECONDS = 8 * 60;

function cdbFmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatMatchClock(totalSeconds, period = null, skipBoundariesUpTo = 0) {
  const totalMinutes = totalSeconds / 60;
  if (period === 5) return cdbFmtClock(totalSeconds); // pênaltis — sem conceito de acréscimo
  const knownBoundary = period != null ? CDB_PERIOD_BOUNDARY_MIN[period] : undefined;
  if (knownBoundary !== undefined) {
    if (totalMinutes <= knownBoundary) return cdbFmtClock(totalSeconds);
    const secsPastBoundary = totalSeconds - knownBoundary * 60;
    // Prorrogação (period 4): sem estado de relógio real pra crescer depois do próprio limite --
    // sempre segue direto pra fim de jogo ou pênaltis. Mesmo cap da Copa (bug real que ela
    // pegou ao vivo: relógio subindo pra sempre "120:07 (+1)…" sem nenhum teto).
    if (period === 4 && secsPastBoundary > CDB_MAX_STOPPAGE_SECONDS) {
      return `${cdbFmtClock(knownBoundary * 60 + CDB_MAX_STOPPAGE_SECONDS)} (+${CDB_MAX_STOPPAGE_SECONDS / 60})`;
    }
    const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
    return `${cdbFmtClock(totalSeconds)} (+${stoppageMin})`;
  }
  const boundary = CDB_HALF_BOUNDARIES_MIN.find(b => b > skipBoundariesUpTo && totalMinutes > b);
  if (!boundary) return cdbFmtClock(totalSeconds);
  const secsPastBoundary = totalSeconds - boundary * 60;
  if (secsPastBoundary > CDB_MAX_STOPPAGE_SECONDS) return cdbFmtClock(totalSeconds);
  const stoppageMin = Math.max(1, Math.ceil(secsPastBoundary / 60));
  return `${cdbFmtClock(totalSeconds)} (+${stoppageMin})`;
}

// Monotônico: o relógio nunca anda pra trás, a não ser que a ESPN sinalize um reset de período
// legítimo (period mudou, ou o clock caiu perto de 0 vindo de perto de um boundary conhecido).
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

// Detecta um relógio genuinamente pausado (intervalo, pausa longa, VAR, ou o INTERVALO ENTRE
// PRORROGAÇÃO E PÊNALTIS) a partir de dois polls CRUS -- funciona mesmo quando o texto de status
// da ESPN não bate com nenhuma das regras de reconhecimento de isHalftime/isPenalties.
function detectClockPaused(freshRaw, prevRaw) {
  if (!prevRaw || prevRaw.clockSeconds == null || freshRaw.clockSeconds == null) return false;
  const realElapsed = (freshRaw.pollTime - prevRaw.pollTime) / 1000;
  if (realElapsed < 30) return false;
  const clockDelta = freshRaw.clockSeconds - prevRaw.clockSeconds;
  return clockDelta < realElapsed * 0.3;
}

const CDB_LIVE_CLOCK_CACHE_KEY = "cdb2026_live_clock_cache";
function loadLiveClockCache() {
  try { return JSON.parse(localStorage.getItem(CDB_LIVE_CLOCK_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveLiveClockCache(scores) {
  try {
    const cache = {};
    for (const [id, ls] of Object.entries(scores)) {
      if (ls.clockSeconds != null) cache[id] = { clockSeconds: ls.clockSeconds, pollTime: ls.pollTime, period: ls.period ?? null };
    }
    localStorage.setItem(CDB_LIVE_CLOCK_CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full/unavailable */ }
}

const CDB_LIVE_CLOCK_RAW_CACHE_KEY = "cdb2026_live_clock_raw_cache";
let _cdbRawClockHistory = {};
function loadRawClockCache() {
  try { return JSON.parse(localStorage.getItem(CDB_LIVE_CLOCK_RAW_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function saveRawClockCache(history) {
  try { localStorage.setItem(CDB_LIVE_CLOCK_RAW_CACHE_KEY, JSON.stringify(history)); }
  catch { /* storage full/unavailable */ }
}

let _liveTies = []; // [{ tieId, tie, phaseId, leg, homeTeam, awayTeam, goalsHome, goalsAway, clockSeconds, pollTime, period, isHalftime, isPenalties, clockPaused, clockStr }]
let _liveTiesLastPollAt = 0;
const LIVE_TIE_POLL_INTERVAL_MS = 60 * 1000; // mesma cadência da Copa/BR2026 -- rápida o bastante pro relógio parecer "ao vivo"

// Pernas (ida/volta) atualmente sinalizadas como adiadas/canceladas pela ESPN -- item 25 do
// CONSISTENCY_MATRIX.md (2026-07-15), portado do BR2026 (fetchSchedule()/`postponed`). Chave
// "tieId:leg", populada/atualizada no mesmo poll de 60s do card ao vivo (pollLiveTies).
let _postponedLegKeys = new Set();
function isLegPostponed(tieId, leg) { return _postponedLegKeys.has(`${tieId}:${leg}`); }

// Casa cada perna (ida/volta) de cada confronto da fase ATIVA com um evento da ESPN, pela mesma
// identidade de mandante já usada em autoSyncEspnResults() (nunca por ordem de data). Roda só
// sobre a fase ativa (s.espnSync.activePhaseId) -- as demais fases não têm jogo "agora". Retorna
// tanto as pernas "in" (ao vivo) quanto as sinalizadas como adiadas/canceladas.
async function fetchLiveTies(s) {
  const phaseId = s.espnSync?.activePhaseId;
  if (!phaseId) return { live: [], postponedKeys: new Set() };
  const candidates = await fetchEspnCandidates();
  if (!candidates) return null;
  const format = getPhaseDef(phaseId)?.format;
  const legs = legsForFormat(format);
  const ties = s.phases?.[phaseId]?.ties || {};
  const found = [];
  const postponedKeys = new Set();
  Object.entries(ties).forEach(([tieId, tie]) => {
    if (!tie.teamA || !tie.teamB || tie.qualifiedTeamId) return;
    legs.forEach(leg => {
      const m = tie.matches?.[leg];
      if (!m || m.goalsHome != null) return; // já tem placar (manual ou auto) — não é "ao vivo"
      const home = leg === "second" ? tie.teamB : tie.teamA;
      const away = leg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === home && c.awayTeam === away);
      if (!ev) return;
      if (ev.postponed) { postponedKeys.add(`${tieId}:${leg}`); return; }
      if (ev.state !== "in") return;
      found.push({ tieId, tie, phaseId, leg, homeTeam: home, awayTeam: away, ev });
    });
  });
  return { live: found, postponedKeys };
}

async function pollLiveTies() {
  const s = state();
  const result = await fetchLiveTies(s);
  if (result === null) return; // fetch falhou — mantém o último estado conhecido na tela
  const { live: found, postponedKeys } = result;
  _postponedLegKeys = postponedKeys;
  const now = Date.now();
  const prevById = new Map(_liveTies.map(l => [`${l.tieId}:${l.leg}`, l]));
  const clockCache = loadLiveClockCache();
  if (!Object.keys(_cdbRawClockHistory).length) _cdbRawClockHistory = loadRawClockCache();
  const nextRawHistory = {};
  const nextLive = found.map(({ tieId, tie, phaseId, leg, homeTeam, awayTeam, ev }) => {
    const key = `${tieId}:${leg}`;
    const rawFresh = { clockSeconds: ev.clockSec, pollTime: now, period: ev.period };
    const clockPaused = detectClockPaused(rawFresh, _cdbRawClockHistory[key]);
    if (ev.clockSec != null) nextRawHistory[key] = { clockSeconds: ev.clockSec, pollTime: now };
    const prevMerged = prevById.get(key) || clockCache[key];
    const merged = mergeLiveClock({ clockSeconds: ev.clockSec, pollTime: now, period: ev.period, clockPaused }, prevMerged);
    return {
      tieId, tie, phaseId, leg, homeTeam, awayTeam,
      goalsHome: ev.liveHomeScore, goalsAway: ev.liveAwayScore,
      clockSeconds: merged.clockSeconds, pollTime: now, period: ev.period,
      isHalftime: ev.isHalftime, isPenalties: ev.isPenalties, clockPaused,
      clockStr: ev.clockStr || "", plays: ev.plays || [],
    };
  });
  _cdbRawClockHistory = nextRawHistory;
  saveRawClockCache(_cdbRawClockHistory);
  saveLiveClockCache(Object.fromEntries(nextLive.map(l => [`${l.tieId}:${l.leg}`, l])));
  _liveTies = nextLive;
  _liveTiesLastPollAt = now;
  renderLiveTieCard();
  renderLiveRankingHero();
  renderRanking();
  // Re-renderiza Jogos/Palpites pra refletir uma mudança de status de adiado/cancelado -- barato
  // o bastante (só recomputa HTML a partir do estado já em memória) pra rodar a cada poll de 60s.
  renderGamesSection();
  if (!pickFormIsDirty()) renderPickForm();
  nudgeScrollReflow();
}

// Vários cards (ao vivo, ranking ao vivo, próxima partida, contagem regressiva) aparecem/somem
// dinamicamente a cada poll de 60s -- mesmo achado do BR2026 (Eduardo, screenshot, 2026-07-17:
// "Ainda tem bastante areas em branco ao final da pagina, isso tinha sido corrigido"): quando o
// conteúdo ENCOLHE enquanto a página está rolada perto do final, o Safari no iOS é conhecido por
// não recalcular a área rolável até uma interação nova. `scrollBy(0, 0)` não move a página, só
// força o WebKit a recalcular os limites de rolagem.
function nudgeScrollReflow() {
  requestAnimationFrame(() => { if (window.scrollY > 0) window.scrollBy(0, 0); });
}

// Mesmo padrão de "runningClock" da Copa/BR2026 (ver liveClockDisplay em bolao/br2026/js/app.js):
// num intervalo/pênaltis/pausa real, mostra o rótulo fixo em vez de deixar a interpolação local
// somar segundos através da pausa.
// Mesmo bug corrigido no BR2026 (screenshot de Eduardo, 2026-07-16): "um cronometro mostra só
// minutos e outro mostra minutos e segundos" -- pausado caía pro `l.clockStr` cru da ESPN ("51'",
// só minuto), rodando usava formatMatchClock() ("MM:SS"). Sempre passa por formatMatchClock()
// agora quando `clockSeconds` existe -- pausado só significa não somar o tempo decorrido desde o
// último poll, nunca trocar de formato.
function liveClockDisplay(l) {
  const clock = l.isHalftime ? t("liveHalftime")
    : l.isPenalties ? t("livePenalties")
    : l.clockSeconds != null
      ? formatMatchClock(
          l.clockPaused ? l.clockSeconds : l.clockSeconds + Math.floor((Date.now() - (l.pollTime || Date.now())) / 1000),
          l.period ?? null, 0)
      : l.clockStr;
  return clock;
}

// ─── Live ranking movement ───────────────────────────────────────────────────
// "up and down for the user ranking, yes" (Eduardo, 2026-07-16, depois de confirmar que
// posição de TIME ao vivo não se aplica ao CDB2026 -- mata-mata, sem classificação de liga).
// Reaproveita rankEntriesBy() -- única fonte de desempate, usada tanto pelo Ranking exibido
// quanto por este cálculo, mesmo princípio do BR2026 (calculateRankingMovement() lá).
//
// liveScoreEntry() soma os pontos de partidas AO VIVO (ainda sem placar salvo em
// s.phases[...].matches[leg], por isso scoreEntry() sozinho não os vê) por cima do total
// oficial -- só pontuação por partida (matchPoints()), nunca tenta prever quem se classifica
// ao vivo (isso depende do agregado das duas pernas + prorrogação/pênaltis, especulativo demais
// pra uma perna ainda em andamento). O `detail.matches` injetado mantém countExactMatches()
// consistente mesmo quando a partida ao vivo bate um placar exato do palpite.
function liveScoreEntry(entry, s) {
  const official = scoreEntry(entry, s);
  if (!_liveTies.length) return official;
  let extra = 0;
  const matches = { ...official.detail.matches };
  _liveTies.forEach(l => {
    const pick = entry.picks?.matches?.[l.tieId]?.[l.leg];
    const r = matchPoints(pick, { goalsHome: l.goalsHome, goalsAway: l.goalsAway });
    if (!r) return;
    matches[`${l.tieId}:${l.leg}`] = r;
    extra += r.pts;
  });
  return { total: official.total + extra, detail: { ...official.detail, matches } };
}

function calculateRankingMovement(entries, s) {
  if (!entries.length) return new Map();
  const liveRanked = rankEntriesBy(entries, e => (_liveTies.length ? liveScoreEntry(e, s) : getActiveScore(e, s)));
  if (!_liveTies.length) {
    return new Map(liveRanked.map(x => [x.e.id, { rank: x.rank, total: x.total, previousRank: null, movement: null, status: "unavailable" }]));
  }
  const baseRanked   = rankEntriesBy(entries, e => getActiveScore(e, s));
  const baseRankById = new Map(baseRanked.map(x => [x.e.id, x.rank]));
  return new Map(liveRanked.map(x => {
    const previousRank = baseRankById.has(x.e.id) ? baseRankById.get(x.e.id) : null;
    const movement = previousRank != null ? previousRank - x.rank : null;
    const status = movement == null ? "unavailable" : movement > 0 ? "up" : movement < 0 ? "down" : "same";
    return [x.e.id, { rank: x.rank, total: x.total, previousRank, movement, status }];
  }));
}

// Mesmo glifo/classes/i18n do BR2026 (rankMovementHtml, bolao/br2026/js/app.js) -- nunca
// misturar com o movimento de posição de time (não existe aqui, ver nota acima).
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

// Hero "Ranking ao vivo" -- mesmo padrão visual/UX do BR2026 (#liveRankingHero,
// renderLiveRankingHero() em bolao/br2026/js/app.js v1.55): mostra TODO MUNDO ordenado por
// posição (não só quem se move -- v1.54 do BR2026 filtrava e escondia o topo da lista, corrigido
// depois), dentro de uma caixa com scroll e cabeçalho fixo.
//
// Antes só aparecia com tie(s) ao vivo E pelo menos alguém realmente subindo/descendo. Removido
// em 2026-07-17 (mesmo ajuste do BR2026 v1.65, ver changelog dele — Eduardo, durante um jogo real
// ao vivo do BR2026: "onde está o ranking provisório? Você remove funcionalidades"): a caixa
// sumir bem na hora que tem jogo rolando, só porque ainda ninguém cruzou fronteira nenhuma, era
// pior que mostrar a lista com setas neutras ("–"). Propagado aqui mesmo sem CDB2026 ter tie(s)
// ao vivo agora (Oitavas só começa 1º/ago) -- mesmo padrão de código, mesma decisão de produto.
function renderLiveRankingHero() {
  const card = $("liveRankingHero");
  if (!card) return;
  if (!_liveTies.length) { card.classList.add("hidden"); return; }

  const s       = state();
  const deleted = new Set(s.deletedIds || []);
  const entries = (s.entries || []).filter(e => !deleted.has(e.id));
  if (!entries.length) { card.classList.add("hidden"); return; }

  const movement = calculateRankingMovement(entries, s);
  const scored   = rankEntriesBy(entries, e => liveScoreEntry(e, s));

  const rows = scored.map(item => {
    const mv = movement.get(item.e.id);
    return `<tr>
    <td style="text-align:center">${item.rank}${rankMovementHtml(mv)}</td>
    <td>${esc(item.e.entryName)}</td>
    <td style="text-align:center"><b class="pick-pts pos">${item.total}</b></td>
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

// Mesma estrutura horizontal da Copa/BR2026 (hero-live-card/.live-top, ver
// bolao/br2026/js/app.js renderLiveCard()) -- Eduardo: "aplicou as mesmas alteracoes na
// CDB2026? PRECISAMOS SER CONSISTENTES!" (2026-07-16). Antes desta mudança o card ao vivo do
// CDB2026 usava a mesma pilha vertical que o BR2026 tinha antes de ser corrigida (achado de
// consistência real, não só um pedido -- ver CONSISTENCY_MATRIX.md). Sem posição de tabela (não
// existe classificação de liga na Copa do Brasil -- mata-mata), sem barras de probabilidade ao
// vivo (CDB2026 não tem um modelo in-play minuto a minuto, só o pré-jogo em matchProb(); não
// inventado aqui pra não misturar feature nova com paridade visual).
const teamColHtml = (teamName) => `<div class="live-team">
  <div class="live-team-logo-box">${teamLogoImg(teamName)}</div>
  <span class="live-team-name">${esc(teamName)}</span>
</div>`;

function renderLiveTieCard() {
  const card = $("liveTieCard");
  if (!card) return;
  if (!_liveTies.length) { card.classList.add("hidden"); return; }
  const rows = _liveTies.map(l => {
    const clock = liveClockDisplay(l);
    const playsHtml = livePlaysHtml(l.plays, l.homeTeam, l.awayTeam, `${l.tieId}:${l.leg}`);
    // Local do jogo (venue) removido do modo ao vivo -- Eduardo: "Não precisa mostrar a
    // localização no live mode" (2026-07-17). Fase continua (útil pra saber "que confronto é
    // esse" durante o jogo) -- venue continua aparecendo normalmente no card pré-live.
    const phaseName = getPhaseDef(l.phaseId)?.name || "";
    const metaHtml = phaseName ? `<div class="live-match-meta"><span>${esc(phaseName)}</span></div>` : "";
    return `<div class="live-match">
      <div class="live-top">
        ${teamColHtml(l.homeTeam)}
        <div class="live-score">${l.goalsHome ?? 0}</div>
        <div class="live-center">
          <span class="live-badge">${esc(t("liveNow"))}</span>
          <span class="live-clock">${esc(clock)}</span>
        </div>
        <div class="live-score">${l.goalsAway ?? 0}</div>
        ${teamColHtml(l.awayTeam)}
      </div>
      ${metaHtml}
      ${playsHtml ? `<div class="live-match-detail">${playsHtml}</div>` : ""}
    </div>`;
  }).join("");
  card.innerHTML = `<div class="live-match-grid">${rows}</div>`;
  card.classList.remove("hidden");
}

// Minuto a minuto (gols/cartões/substituições) -- ported from Copa/BR2026 (extractMatchPlays,
// ver bolao/br2026/js/app.js), mesmo comp.details já buscado a cada poll do card ao vivo, com
// fallback para o endpoint de summary por evento (keyEvents, inclui substituições -- ver
// fetchEspnEventSummary) em partidas ao vivo, já que comp.details nunca traz substituições
// (confirmado ao vivo, Final da Copa do Mundo, 2026-07-19, propagado aqui no mesmo dia -- Eduardo:
// "aplicou as mesmas alteracoes na CDB2026? PRECISAMOS SER CONSISTENTES!", 2026-07-16).
// side é "home"/"away" (não "c0"/"c1" da Copa nem A/B) -- mesma convenção já usada pelo resto do
// live-tie code deste arquivo (homeTeam/awayTeam sempre nomes reais, sem resolução de slot de
// bracket como a Copa precisa). Mesmo contrato "falha silenciosa": formato inesperado da ESPN
// degrada pra lista vazia, nunca quebra o placar/relógio ao vivo.
const PLAY_ICON = { goal: "⚽", yellow: "🟨", red: "🟥", sub: "🔄" };
function extractMatchPlays(comp, keyEvents) {
  try {
    const details = Array.isArray(keyEvents) && keyEvents.length
      ? keyEvents
      : (Array.isArray(comp.details) ? comp.details : []);
    const comps = comp.competitors || [];
    const home = comps.find(c => c.homeAway === "home") || comps[0];
    const away = comps.find(c => c.homeAway === "away") || comps[1];
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
      if (!kind) continue;
      const teamId = d.team?.id;
      let side = null;
      if (teamId != null && home?.team?.id != null && String(teamId) === String(home.team.id)) side = "home";
      else if (teamId != null && away?.team?.id != null && String(teamId) === String(away.team.id)) side = "away";
      if (!side) continue;
      const clockVal = typeof d.clock?.value === "number" ? d.clock.value : null;
      const minute = d.clock?.displayValue || (clockVal != null ? `${Math.floor(clockVal / 60)}'` : "");
      // comp.details lista atletas em athletesInvolved[]; o endpoint de summary usa
      // participants[].athlete -- suporta os dois formatos (mesmo padrão da Copa/BR2026).
      const names = (d.athletesInvolved || (d.participants || []).map(p => p?.athlete))
        .map(a => a?.displayName || a?.shortName)
        .filter(Boolean);
      const text = kind === "sub" ? names.slice(0, 2).join(" ↔ ") : (names[0] || "");
      if (!text && !minute) continue;
      plays.push({ kind, side, minute, text, order: clockVal ?? 0 });
    }
    return plays.sort((a, b) => a.order - b.order);
  } catch (err) {
    console.warn("[CDB2026] extractMatchPlays failed, skipping plays feed for this match", err);
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

// Supplements comp.details with ESPN's richer per-event summary endpoint (keyEvents, includes
// substitutions — see extractMatchPlays). Same fix as Copa/BR2026, propagated here same day
// (Eduardo: "PRECISAMOS SER CONSISTENTES"). Only called for matches currently live, so a normal
// poll with nothing in progress never adds extra network calls. Fails soft: any error just means
// this cycle falls back to comp.details alone.
async function fetchEspnEventSummary(eventId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const summaryUrl = (C.espn?.scoreboardUrl || "").replace(/\/scoreboard(\?.*)?$/, "/summary");
    if (!summaryUrl) return null;
    const r = await fetch(`${summaryUrl}?event=${eventId}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data?.keyEvents) ? data.keyEvents : null;
  } catch (err) {
    console.warn(`[CDB2026] ESPN event summary fetch failed for event ${eventId}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEspnCandidates() {
  const url = C.espn?.scoreboardUrl;
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json();
    const events = data.events || [];
    const liveEventIds = events
      .filter(ev => ev.competitions?.[0]?.status?.type?.state === "in")
      .map(ev => ev.id)
      .filter(Boolean);
    const keyEventsById = {};
    if (liveEventIds.length) {
      const summaries = await Promise.all(liveEventIds.map(id => fetchEspnEventSummary(id)));
      liveEventIds.forEach((id, i) => { if (summaries[i]) keyEventsById[id] = summaries[i]; });
    }
    return events.map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const comps = comp.competitors || [];
      const home  = comps.find(c => c.homeAway === "home") || comps[0];
      const away  = comps.find(c => c.homeAway === "away") || comps[1];
      const evState = comp.status?.type?.state || "pre";
      // Campos de jogo AO VIVO (2026-07-15, ver CDB2026: recurso de partida ao vivo) --
      // adicionados sem tocar homeScore/awayScore/homeWinner/awayWinner acima, que
      // autoSyncEspn()/autoSyncEspnResults() já dependem para decidir "confronto acabou" (só
      // `state === "post"`). Mesma detecção de intervalo/pênaltis da Copa/BR2026
      // (mapEspnToLiveScores/fetchScoreboard) -- `state` da ESPN fica "in" durante o intervalo
      // também, só `type.name`/texto do status muda.
      const clockSec = typeof comp.status?.clock === "number" ? comp.status.clock : null;
      const period   = typeof comp.status?.period === "number" ? comp.status.period : null;
      const statusName = (comp.status?.type?.name || "").toUpperCase();
      const statusText = `${comp.status?.type?.description || ""} ${comp.status?.type?.shortDetail || ""} ${comp.status?.type?.detail || ""}`.toLowerCase();
      const isHalftime = statusName.includes("HALFTIME") || /half.?time|intervalo|entretiempo/.test(statusText);
      const isPenalties = period === 5
        || statusName.includes("SHOOTOUT")
        || statusName.includes("PENALT")
        || statusName.includes("END_OF_EXTRATIME")
        || /penalt|pênalti|penales|\bpens\b|shootout|end of extra ?time/.test(statusText);
      // Item 25 do CONSISTENCY_MATRIX.md (2026-07-15) -- CDB2026 não tinha nenhuma forma de
      // sinalizar jogo adiado/cancelado; portado do BR2026 (fetchSchedule(), mesma checagem) --
      // só que o BR2026 original tinha um bug real nessa checagem, herdado aqui junto: o `name`
      // da ESPN para um jogo adiado é a constante "STATUS_POSTPONED"/"STATUS_CANCELED", nunca o
      // texto "POSTPONED"/"CANCELED" comparado aqui, então essa comparação nunca batia. Corrigido
      // junto com o BR2026 (Eduardo, 2026-07-26, achado auditando dados da tabela do BR2026:
      // "outros sites mostra pontuacao diferentes") -- usa state==="post" + completed===false,
      // que é o sinal real e confiável (verificado contra dados reais da ESPN).
      const postponed = evState === "post" && comp.status?.type?.completed === false;
      return {
        id: ev.id,
        dateISO: comp.date || ev.date || "",
        homeTeam: home?.team?.displayName || "",
        awayTeam: away?.team?.displayName || "",
        // `!postponed` é obrigatório aqui, não só no chip de "Adiado": a ESPN devolve um jogo
        // adiado como state:"post" COM score "0" (verificado em dados reais de 2026-07-29 na
        // bra.1) -- sem esta guarda, `homeScore` virava 0 (não null) e autoSyncEspn()/
        // autoSyncEspnResults() gravavam a perna como FINAL 0-0 de um jogo nunca disputado.
        // Pior: `if (m.goalsHome != null) return` mais abaixo faz o placar falso BLOQUEAR para
        // sempre o preenchimento automático do resultado real. Achado na auditoria de 2026-08
        // (AUDIT-06) -- latente hoje (nenhum jogo da Copa do Brasil está adiado), mas a Copa do
        // Brasil adia jogos com frequência e o bolão paga dinheiro real.
        homeScore: evState === "post" && !postponed && home?.score != null ? parseInt(home.score, 10) : null,
        awayScore: evState === "post" && !postponed && away?.score != null ? parseInt(away.score, 10) : null,
        // `winner` é o campo que a própria ESPN usa pra indicar quem passou de fase depois de
        // pênaltis (o placar normal por si só empata em caso de disputa) -- só confiável quando o
        // jogo já terminou (evState === "post"); usado em autoSyncEspnResults() para travar um
        // confronto empatado no agregado sem precisar do admin escolher manualmente.
        // Mesma guarda `!postponed` (ver homeScore acima): um jogo adiado nunca tem vencedor.
        homeWinner: evState === "post" && !postponed ? home?.winner === true : null,
        awayWinner: evState === "post" && !postponed ? away?.winner === true : null,
        venue: comp.venue?.fullName || "",
        city: comp.venue?.address?.city || "",
        state: evState,
        liveHomeScore: evState === "in" && home?.score != null ? parseInt(home.score, 10) : null,
        liveAwayScore: evState === "in" && away?.score != null ? parseInt(away.score, 10) : null,
        clockSec, period, isHalftime, isPenalties, postponed,
        clockStr: comp.status?.displayClock || "",
        plays: extractMatchPlays(comp, keyEventsById[ev.id]),
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

function existingPairsAcrossPhases(s) {
  const pairs = new Set();
  Object.values(s.phases || {}).forEach(ph => Object.values(ph.ties || {}).forEach(tie => {
    if (tie.teamA && tie.teamB) pairs.add([tie.teamA, tie.teamB].sort().join("|"));
  }));
  return pairs;
}

// Slug determinístico (não um uuid aleatório) para confrontos adicionados pela sincronização
// automática — se dois dispositivos rodarem a auto-sync de forma independente antes de se
// sincronizarem entre si (Supabase), os dois geram o MESMO id para o mesmo confronto real, e o
// merge por chave (mergeStates) naturalmente colapsa em uma única entrada em vez de duplicar.
// Ties adicionados manualmente continuam usando uuid() — sem esse risco de corrida.
function espnTieId(teamA, teamB) {
  const slug = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "espn-" + [slug(teamA), slug(teamB)].sort().join("_");
}

// Popula os confrontos JÁ SORTEADOS conhecidos (DATA.knownConfrontos, ver data.js) — roda
// exatamente uma vez por estado (marcado em s.espnSync.seededKnownConfrontos), nunca de novo
// depois disso. Isso é o que garante que o admin possa remover um confronto errado pela UI
// existente sem que ele volte sozinho no próximo carregamento. Chamado em init(), depois do
// merge com o Supabase, para nunca semear por cima do que outro dispositivo já salvou.
function seedKnownConfrontos(s) {
  if (s.espnSync?.seededKnownConfrontos) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.seededKnownConfrontos = true;
  const existingPairs = existingPairsAcrossPhases(s);
  let added = false;
  Object.entries(DATA.knownConfrontos || {}).forEach(([phaseId, ties]) => {
    if (!s.phases[phaseId]) return;
    const format = getPhaseDef(phaseId).format;
    // Dois formatos de entrada em DATA.knownConfrontos[phaseId]: confronto FUTURO (só
    // teamA/teamB — ex. Oitavas, sorteado mas ainda não jogado, matches ficam vazios) e
    // confronto JÁ DECIDIDO (com winner + legs — ex. 5ª Fase, já concluída em maio/2026,
    // populada aqui só para referência em "Jogos", ver DATA.phasesConcludedNoData e
    // docs/bolao/CDB2026_RULES_AND_MODEL.md seção 7.2). legs[leg] pode ser null/incompleto
    // quando o placar de uma perna específica não pôde ser confirmado por fonte — nesse caso a
    // perna fica sem resultado (mesmo estado de "ainda não jogada"), mas quem avançou
    // (qualifiedTeamId) já é conhecido com confiança e é setado de qualquer forma.
    ties.forEach(({ teamA, teamB, winner, legs, kickoff, venue, city }) => {
      const pairKey = [teamA, teamB].sort().join("|");
      if (existingPairs.has(pairKey)) return;
      const tie = { teamA, teamB, matches: {}, qualifiedTeamId: winner || null };
      legsForFormat(format).forEach(leg => {
        const home  = leg === "second" ? teamB : teamA;
        const away  = leg === "second" ? teamA : teamB;
        const score = legs?.[leg];
        tie.matches[leg] = (score && score.goalsHome != null && score.goalsAway != null)
          ? { ...emptyMatch(), homeTeam: home, awayTeam: away, goalsHome: score.goalsHome, goalsAway: score.goalsAway, status: "FINAL" }
          : emptyMatch();
      });
      // kickoff/venue/city de um confronto FUTURO (ex. Oitavas) vão sempre na primeira perna
      // (ida, ou única em SINGLE_MATCH) -- é o mesmo dado usado pelo card "Próxima partida" e
      // pelo cutoff automático (ver entryCutoffMs()/firstKnownKickoffMs() em app.js).
      if (kickoff) {
        const firstLeg = format === "SINGLE_MATCH" ? "single" : "first";
        tie.matches[firstLeg] = { ...tie.matches[firstLeg], kickoff, venue: venue || null, city: city || null };
      }
      s.phases[phaseId].ties[espnTieId(teamA, teamB)] = tie;
      existingPairs.add(pairKey);
      added = true;
    });
    // Só promove a fase a "ativa" (usada pela sincronização ESPN) se ela não vier inteira já
    // decidida — senão a 5ª Fase (histórico, ver acima) tomaria o lugar da Oitavas como fase
    // ativa dependendo da ordem de DATA.knownConfrontos, quebrando a sincronização automática.
    const allResolved = ties.length > 0 && ties.every(tie => tie.winner);
    if (!allResolved && !s.espnSync.activePhaseId) s.espnSync.activePhaseId = phaseId;
  });
  return added;
}

// Preenche kickoff/venue/city em confrontos JÁ SEMEADOS que ainda não tinham essa informação —
// diferente de seedKnownConfrontos() (que só CRIA confronto novo, nunca toca um que já existe),
// esta função só ATUALIZA metadado que ainda estava vazio, sem tocar em placar/qualifiedTeamId/
// nada que o admin já tenha lançado. Necessário porque a Oitavas já tinha sido semeada (v3.6,
// antes da CBF divulgar data/hora de cada jogo) — sem isso, DATA.knownConfrontos ganhar kickoff
// nunca chegaria a quem já tem o app rodando: seedKnownConfrontos() está travada por
// seededKnownConfrontos (true desde a v3.6) e nunca mais roda. Bug real encontrado por Eduardo
// (2026-07-14): mesmo com o cutoff automático (kickoff - 1h, ver entryCutoffMs()) corrigido, o
// contador continuava preso em "aguardando sorteio" em produção porque não havia kickoff nenhum
// gravado em nenhum confronto da Oitavas. Roda uma única vez (flag própria, separada da de
// seedKnownConfrontos), nunca reaplica — o admin pode corrigir kickoff/venue depois (quando isso
// tiver uma UI) sem risco de essa função sobrescrever de volta.
function backfillOitavasKickoffs(s) {
  if (s.espnSync?.backfilledOitavasKickoffs) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.backfilledOitavasKickoffs = true;
  const knownTies = DATA.knownConfrontos?.oitavas || [];
  let changed = false;
  Object.values(s.phases?.oitavas?.ties || {}).forEach(tie => {
    if (!tie.teamA || !tie.teamB) return;
    const pairKey = [tie.teamA, tie.teamB].sort().join("|");
    const known = knownTies.find(k => [k.teamA, k.teamB].sort().join("|") === pairKey);
    if (!known?.kickoff) return;
    const m = tie.matches?.first;
    if (!m || m.kickoff) return; // já tem kickoff (ESPN sync ou admin) -- nunca sobrescreve
    tie.matches.first = { ...m, kickoff: known.kickoff, venue: known.venue || m.venue || null, city: known.city || m.city || null };
    changed = true;
  });
  return changed;
}

// Auto-cura de dado corrompido pela v3.16 (2026-07-14, EMERGENCY_HOTFIX v3.18, Eduardo: "os jogos
// das oitavas também estão errados e não deixam entrar resultado" / "não faça limpeza manual, faça
// automático"). v3.16 podia casar um evento antigo/errado da ESPN (mesmo par de nomes de time, ver
// autoSyncEspnResults) e preencher placar/travar um confronto que ainda nem começou de verdade.
// Prova definitiva de corrupção, sem ambiguidade nenhuma: um resultado "espn-auto" numa fase cujo
// kickoff conhecido ainda não passou é logicamente impossível (o jogo não pode ter terminado antes
// de começar). Reverte automaticamente -- roda uma única vez por estado (flag própria), na
// inicialização, depois do merge com o Supabase. NUNCA mexe num confronto onde pelo menos um
// kickoff conhecido já passou (esse pode legitimamente já ter sido jogado de verdade) -- só reverte
// o que é matematicamente impossível de ser real agora.
function healFalseEspnAutoResults(s) {
  if (s.espnSync?.healedFalseAutoResults) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.healedFalseAutoResults = true;
  const now = Date.now();
  let changed = false;
  Object.values(s.phases || {}).forEach(phase => {
    Object.values(phase.ties || {}).forEach(tie => {
      const matches = Object.values(tie.matches || {});
      const anyKnownKickoffAlreadyPast = matches.some(m => {
        const ms = m?.kickoff ? new Date(m.kickoff).getTime() : NaN;
        return Number.isFinite(ms) && ms <= now;
      });
      if (anyKnownKickoffAlreadyPast) return; // pelo menos um jogo pode já ter sido jogado de verdade -- não mexe
      const hadEspnAutoData = matches.some(m => m?.resultSource === "espn-auto") || tie.lockedBy === "espn-auto";
      if (!hadEspnAutoData) return;
      Object.values(tie.matches || {}).forEach(m => {
        if (m?.resultSource === "espn-auto") {
          m.goalsHome = null; m.goalsAway = null; m.status = "SCHEDULED"; delete m.resultSource;
        }
      });
      if (tie.lockedBy === "espn-auto") { delete tie.qualifiedTeamId; delete tie.lockedAt; delete tie.lockedBy; }
      changed = true;
    });
  });
  return changed;
}

// Auto-cura de confrontos-fantasma criados pela falta de guarda em autoSyncEspn() -- v3.19,
// EMERGENCY_HOTFIX, 2026-07-14, mesmo dia do incidente v3.17/v3.18. Achado em produção: dos 112
// ties gravados na fase Oitavas, só 8 eram os confrontos reais (DATA.knownConfrontos.oitavas); os
// outros 104 eram jogos de fases anteriores da Copa do Brasil real (fetchEspnCandidates cobre o
// ano inteiro) confundidos com Oitavas porque o par de nomes de time nunca tinha aparecido em
// outra fase rastreada por este app. Nove desses fantasmas chegaram a ser travados
// (lockedBy:"espn-auto") com um kickoff antigo real anexado, o que arrastava
// firstKnownKickoffMs()/o cutoff automático para o passado -- exatamente os sintomas relatados
// ("fechado para palpites", "sem contador regressivo", "jogos das oitavas errados"). Roda uma
// única vez (flag própria), na inicialização, depois do merge com o Supabase e depois de
// seedKnownConfrontos(). Só remove um tie quando a fase tem uma lista curada de confrontos reais
// (DATA.knownConfrontos[phaseId]) e o par do tie não está nela -- nunca mexe em fase sem lista
// curada (nada a validar). Nunca remove um tie que tenha pelo menos um palpite real de
// participante referenciando-o, mesmo que não devesse acontecer (defesa extra).
function healPhantomTies(s) {
  if (s.espnSync?.healedPhantomTies) return false;
  s.espnSync = s.espnSync || {};
  s.espnSync.healedPhantomTies = true;
  let changed = false;
  const pickedTieIds = new Set();
  (s.entries || []).forEach(e => {
    Object.keys(e.picks?.matches || {}).forEach(id => pickedTieIds.add(id));
    Object.keys(e.picks?.qualified || {}).forEach(id => pickedTieIds.add(id));
  });
  Object.entries(s.phases || {}).forEach(([phaseId, phase]) => {
    const known = DATA.knownConfrontos?.[phaseId];
    if (!known) return; // sem lista curada para esta fase -- nada a validar, não mexe
    const knownPairs = new Set(known.map(k => [k.teamA, k.teamB].sort().join("|")));
    Object.entries(phase.ties || {}).forEach(([tieId, tie]) => {
      const pairKey = [tie.teamA, tie.teamB].sort().join("|");
      if (knownPairs.has(pairKey)) return;
      if (pickedTieIds.has(tieId)) return; // palpite real de participante -- não apaga
      delete phase.ties[tieId];
      changed = true;
    });
  });
  return changed;
}

// Faz o trabalho de fato: busca, filtra o que já existe, cria os confrontos novos na fase ativa,
// salva uma vez (não uma vez por confronto). Retorna um resumo para o admin ver o que aconteceu.
//
// v3.19 (2026-07-14, EMERGENCY_HOTFIX): antes desta correção, QUALQUER par de nomes de time visto
// no ano inteiro de dados da ESPN (fetchEspnCandidates, dates=20260101-20261231, ~500 jogos de
// todas as fases) que ainda não existisse em nenhuma fase rastreada virava confronto novo na fase
// ativa -- sem checar se aquele par É de fato um confronto real desta fase. Restrição: só cria um
// confronto novo se o par já é um dos confrontos REALMENTE sorteados e conhecidos para esta fase
// (DATA.knownConfrontos[phaseId], curado manualmente -- ver data.js). Sem essa curadoria para a
// fase (ex.: Quartas/Semifinal antes do sorteio real acontecer), não cria nada -- confrontos
// dessas fases continuam exigindo cadastro manual do admin (tela "Fases e confrontos"), que já
// era o modelo documentado em CDB2026_RULES_AND_MODEL.md antes da automação de ESPN existir.
async function autoSyncEspn(s) {
  const phaseId = s.espnSync?.activePhaseId;
  if (!phaseId) return { addedCount: 0, added: [], error: false, needsPhase: true };

  const candidates = await fetchEspnCandidates();
  if (candidates === null) return { addedCount: 0, added: [], error: true, needsPhase: false };

  const knownPairs = new Set((DATA.knownConfrontos?.[phaseId] || []).map(k => [k.teamA, k.teamB].sort().join("|")));
  const existingPairs = existingPairsAcrossPhases(s);
  const format = getPhaseDef(phaseId).format;
  const added = [];
  const s2 = state(); // relê o estado mais recente antes de escrever — outra aba pode ter mudado algo

  candidates.forEach(ev => {
    const pairKey = [ev.homeTeam, ev.awayTeam].sort().join("|");
    if (existingPairs.has(pairKey)) return;
    if (!knownPairs.has(pairKey)) return; // não é um confronto real conhecido desta fase -- ignora
    existingPairs.add(pairKey); // evita adicionar o mesmo par duas vezes nesta mesma leva
    const tie = { teamA: ev.homeTeam, teamB: ev.awayTeam, matches: {}, qualifiedTeamId: null };
    legsForFormat(format).forEach(leg => { tie.matches[leg] = emptyMatch(); });
    // O evento da ESPN corresponde à primeira perna do confronto (a ida, ou a única partida em
    // SINGLE_MATCH) — kickoff/local vêm do evento mesmo se ainda não jogado (alimenta o card
    // "próxima partida", ver renderNextTieCard()). Placar é preenchido se o jogo já terminou na
    // ESPN (autoSyncEspnResults(), chamada logo depois desta função no mesmo ciclo, cuida do
    // avanço/travamento do confronto — aqui só entra o placar bruto da perna, igual ao que já
    // acontecia antes de v3.16).
    const firstLeg = format === "SINGLE_MATCH" ? "single" : "first";
    tie.matches[firstLeg] = {
      ...tie.matches[firstLeg],
      homeTeam: ev.homeTeam, awayTeam: ev.awayTeam,
      kickoff: ev.dateISO || null, venue: ev.venue || null, city: ev.city || null,
      ...(ev.homeScore != null ? { goalsHome: ev.homeScore, goalsAway: ev.awayScore, status: "FINAL", resultSource: "espn-auto" } : {}),
    };
    s2.phases[phaseId].ties[espnTieId(ev.homeTeam, ev.awayTeam)] = tie;
    added.push(`${ev.homeTeam} × ${ev.awayTeam}`);
  });

  if (added.length) saveState(s2);
  return { addedCount: added.length, added, error: false, needsPhase: false };
}

// ─── Automação de RESULTADO (não só emparelhamento) — v3.16 ─────────────────────────────────
// Eduardo autorizou explicitamente em 2026-07-14, depois de eu apresentar o risco documentado em
// docs/bolao/CDB2026_RULES_AND_MODEL.md §7 (travar resultado decide pagamento; casar a perna
// errada num confronto de ida/volta seria grave). Decisão registrada em
// docs/bolao/CONSISTENCY_MATRIX.md e no CHANGELOG desta versão.
//
// Como o risco de "casar a perna errada" é mitigado: NÃO se usa ordem de data para decidir se um
// evento da ESPN é ida ou volta -- usa-se a identidade do time mandante, que é o mesmo sinal que a
// UI manual já usa (`home = leg === "second" ? tie.teamB : tie.teamA`, ver renderAdminResultsForTie
// e o handler de data-save-leg). Ida e volta têm mandantes sempre invertidos entre si por definição
// de mata-mata -- não há ambiguidade nesse sinal.
//
// Como o risco de "travar um confronto errado" é mitigado:
//  1. Nunca sobrescreve uma perna que já tem placar -- nem uma lançada manualmente, nem uma já
//     preenchida por uma rodada anterior desta mesma função (mesmo guard que a UI manual usa:
//     `m.goalsHome == null`).
//  2. Nunca sobrescreve um confronto que já tem `qualifiedTeamId` -- travar de novo por cima de um
//     resultado já travado (manual ou automático) nunca acontece; corrigir exige "Destravar" na UI
//     como sempre exigiu.
//  3. Quando o agregado bate diferente, o vencedor é inequívoco pelo placar (mesma regra que o botão
//     manual já usava: `totalA > totalB ? "A" : "B"` -- nenhuma regra nova).
//  4. Quando o agregado empata (só decide nos pênaltis -- a Copa do Brasil não usa gols fora de
//     casa como critério de desempate), só trava automaticamente se a ESPN reportar um vencedor
//     explícito (campo `winner` da API, que já reflete o resultado da disputa de pênaltis). Se esse
//     dado não vier, a função NÃO adivinha -- o confronto fica exatamente como ficava antes:
//     esperando o admin escolher manualmente no select + "Salvar resultado".
function aggregateOrSingleTotals(format, matches) {
  if (format === "TWO_LEG") { const agg = aggregateFromMatches(matches); return [agg.totalA, agg.totalB]; }
  return [matches.single.goalsHome, matches.single.goalsAway];
}

// Achado real em produção (2026-07-14, Eduardo: "CDB2026 continua dizendo fechado, sem o contador
// regressivo, sem possibilidade de entrada para palpites das oitavas"): o casamento de evento por
// nome de time sozinho (ver autoSyncEspnResults abaixo) busca em `candidates`, que cobre o ANO
// INTEIRO da competição (fetchEspnCandidates usa dates=20260101-20261231) -- sem checar proximidade
// de data, um evento antigo/não relacionado com o mesmo par de nomes de time (temporada inteira,
// múltiplas rodadas) podia em tese ser casado com uma perna que ainda nem começou, preenchendo
// placar/travando o confronto errado. Guarda mínima: só aceita o evento se a data dele estiver
// razoavelmente perto do kickoff já conhecido da perna (quando existe um -- Oitavas já vem com
// kickoff semeado via DATA.knownConfrontos, ver seedKnownConfrontos). Sem kickoff conhecido ainda,
// mantém o comportamento permissivo anterior (nada pra comparar).
const RESULT_MATCH_WINDOW_DAYS = 21;
function withinResultMatchWindow(candidateDateISO, knownKickoffISO) {
  if (!knownKickoffISO) return true;
  const c = new Date(candidateDateISO).getTime();
  const k = new Date(knownKickoffISO).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(k)) return true;
  return Math.abs(c - k) <= RESULT_MATCH_WINDOW_DAYS * 86400000;
}

async function autoSyncEspnResults(s) {
  const phaseId = s.espnSync?.activePhaseId;
  if (!phaseId) return { lockedCount: 0, locked: [], filledLegsCount: 0, error: false };

  const candidates = await fetchEspnCandidates();
  if (candidates === null) return { lockedCount: 0, locked: [], filledLegsCount: 0, error: true };

  const format = getPhaseDef(phaseId).format;
  const legs = legsForFormat(format);
  const s2 = state(); // relê o estado mais recente antes de escrever — outra aba pode ter mudado algo
  const ties = s2.phases[phaseId]?.ties || {};
  let filledLegsCount = 0;
  const locked = [];

  Object.values(ties).forEach(tie => {
    if (!tie.teamA || !tie.teamB) return;

    // Âncora de data pro tie inteiro: a perna sendo checada pode ainda não ter kickoff conhecido
    // (ex.: volta, antes da ida ser jogada) -- nesse caso usa o kickoff de QUALQUER outra perna já
    // conhecida do mesmo confronto como referência (ida e volta acontecem sempre a poucos dias uma
    // da outra), em vez de ficar sem checagem nenhuma nessa perna.
    const tieKickoffAnchor = legs.map(l => tie.matches?.[l]?.kickoff).find(Boolean);

    legs.forEach(leg => {
      const m = tie.matches?.[leg];
      if (!m || m.goalsHome != null) return; // já preenchido (manual ou auto) — nunca sobrescreve
      const home = leg === "second" ? tie.teamB : tie.teamA;
      const away = leg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === home && c.awayTeam === away && c.homeScore != null
        && withinResultMatchWindow(c.dateISO, m.kickoff || tieKickoffAnchor));
      if (!ev) return;
      tie.matches[leg] = { ...m, homeTeam: home, awayTeam: away, goalsHome: ev.homeScore, goalsAway: ev.awayScore, status: "FINAL", resultSource: "espn-auto" };
      filledLegsCount++;
    });

    if (tie.qualifiedTeamId) return; // já travado (manual ou auto) — nunca sobrescreve
    if (!legs.every(leg => tie.matches?.[leg]?.goalsHome != null)) return; // ainda falta perna

    const [totalA, totalB] = aggregateOrSingleTotals(format, tie.matches);
    let qualified = null;
    if (totalA !== totalB) {
      qualified = totalA > totalB ? "A" : "B";
    } else {
      const decisiveLeg  = format === "TWO_LEG" ? "second" : "single";
      const decisiveHome = decisiveLeg === "second" ? tie.teamB : tie.teamA;
      const decisiveAway = decisiveLeg === "second" ? tie.teamA : tie.teamB;
      const ev = candidates.find(c => c.homeTeam === decisiveHome && c.awayTeam === decisiveAway
        && withinResultMatchWindow(c.dateISO, tie.matches?.[decisiveLeg]?.kickoff || legs.map(l => tie.matches?.[l]?.kickoff).find(Boolean)));
      if (ev?.homeWinner === true) qualified = decisiveHome === tie.teamA ? "A" : "B";
      else if (ev?.awayWinner === true) qualified = decisiveAway === tie.teamA ? "A" : "B";
      // Sem sinal de vencedor da ESPN: fica sem travar, cai pro fluxo manual existente.
    }

    if (!qualified) return;
    tie.qualifiedTeamId = qualified;
    tie.lockedAt = new Date().toISOString();
    tie.lockedBy = "espn-auto";
    locked.push(`${tie.teamA} × ${tie.teamB}`);
  });

  if (filledLegsCount || locked.length) saveState(s2);
  return { lockedCount: locked.length, locked, filledLegsCount, error: false };
}

// Roda os dois ciclos em sequência (emparelhamento, depois resultado) e funde num resumo único
// para a UI do admin. autoSyncEspnResults() relê o estado internamente, então já enxerga
// qualquer confronto novo que autoSyncEspn() acabou de adicionar no mesmo ciclo.
async function autoSyncEspnFull(s) {
  const pairSummary = await autoSyncEspn(s);
  const resultSummary = await autoSyncEspnResults(state());
  return {
    addedCount: pairSummary.addedCount, added: pairSummary.added,
    lockedCount: resultSummary.lockedCount, locked: resultSummary.locked,
    filledLegsCount: resultSummary.filledLegsCount,
    error: pairSummary.error || resultSummary.error,
    needsPhase: pairSummary.needsPhase,
  };
}

function renderAdminEspnSync(s) {
  const box = $("adminEspnSync");
  if (!box) return;

  const phaseOptions = `<option value="">${esc(t("espnSyncPickPhase"))}</option>`
    + DATA.phases.map(p => `<option value="${esc(p.id)}" ${s.espnSync?.activePhaseId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");

  let statusHtml;
  if (!s.espnSync?.activePhaseId) {
    statusHtml = `<p class="muted small-text">${esc(t("espnSyncNeedsPhase"))}</p>`;
  } else if (_espnLastRunSummary?.error) {
    statusHtml = `<p class="muted small-text">${esc(t("espnSyncError"))}</p>`;
  } else if (_espnLastRunSummary) {
    const when = new Date(_espnLastRunSummary.at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const lines = [];
    if (_espnLastRunSummary.addedCount) {
      lines.push(`<p class="small-text">✓ ${_espnLastRunSummary.addedCount} ${esc(t("espnSyncAddedCount"))}: ${esc(_espnLastRunSummary.added.join(", "))}</p>`);
    }
    if (_espnLastRunSummary.lockedCount) {
      lines.push(`<p class="small-text">✓ ${_espnLastRunSummary.lockedCount} ${esc(t("espnSyncLockedCount"))}: ${esc(_espnLastRunSummary.locked.join(", "))}</p>`);
    }
    if (!lines.length) lines.push(`<p class="muted small-text">${esc(t("espnSyncNothingNew"))}</p>`);
    lines.push(`<p class="muted small-text">${esc(when)}</p>`);
    statusHtml = lines.join("");
  } else {
    statusHtml = `<p class="muted small-text">${esc(t("espnSyncChecking"))}</p>`;
  }

  box.innerHTML = `
    <h3>${esc(t("espnSyncTitle"))}</h3>
    <p class="muted small-text">${esc(t("espnSyncAutoDisclaimer"))}</p>
    <div class="admin-row">
      <span class="small-text muted">${esc(t("espnSyncActivePhase"))}</span>
      <select id="espnSyncPhaseSelect">${phaseOptions}</select>
      <button type="button" id="espnSyncNowBtn" class="secondary small-btn">${esc(t("espnSyncRefresh"))}</button>
    </div>
    ${statusHtml}`;

  $("espnSyncPhaseSelect")?.addEventListener("change", (e) => {
    if (!guardAdmin()) return;
    // Zera o guard ANTES de saveState() — saveState() re-renderiza de forma síncrona (via
    // renderAll()), então se isso rodasse depois, a re-renderização em cascata leria o valor
    // antigo do guard e poderia pular a sincronização da fase recém-selecionada.
    _espnLastRunSummary = null;
    _espnLastAutoSyncAt = 0; // força a próxima renderização a sincronizar de novo com a fase nova
    const s2 = state();
    s2.espnSync = s2.espnSync || {};
    s2.espnSync.activePhaseId = e.target.value || null;
    saveState(s2);
  });

  $("espnSyncNowBtn")?.addEventListener("click", async () => {
    if (!guardAdmin()) return;
    _espnLastAutoSyncAt = Date.now();
    const btn = $("espnSyncNowBtn");
    btn.disabled = true; btn.textContent = t("espnSyncFetching");
    _espnLastRunSummary = { ...(await autoSyncEspnFull(state())), at: Date.now() };
    if (_espnLastRunSummary.addedCount) showToast(t("espnSyncAddedToast"), "success");
    if (_espnLastRunSummary.lockedCount) showToast(t("espnSyncLockedToast"), "success");
    renderAdmin();
  });

  // Auto-sync: roda sozinho quando o painel admin abre (ou a cada 5 min se ele continuar aberto)
  // — sem exigir clique. Guarda por timestamp para não rodar de novo a cada re-render (ex.: depois
  // de marcar um pagamento como pago, o que também dispara renderAdmin()). Desde v3.16 também
  // captura e trava resultado automaticamente (autoSyncEspnFull) -- ver autoSyncEspnResults() para
  // o racional completo e as salvaguardas.
  if (s.espnSync?.activePhaseId && Date.now() - _espnLastAutoSyncAt > ESPN_AUTO_SYNC_INTERVAL_MS) {
    _espnLastAutoSyncAt = Date.now();
    autoSyncEspnFull(s).then(summary => {
      _espnLastRunSummary = { ...summary, at: Date.now() };
      if (summary.addedCount) showToast(t("espnSyncAddedToast"), "success");
      if (summary.lockedCount) showToast(t("espnSyncLockedToast"), "success");
      if (summary.addedCount || summary.lockedCount || summary.filledLegsCount) renderAdmin();
      else renderAdminEspnSync(state());
    });
  }
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
    // Fase já concluída ANTES deste bolão existir (DATA.phasesConcludedNoData, v3.8) -- achado em
    // auditoria (2026-07-14): o formulário de "Adicionar confronto" aparecia normal mesmo assim.
    // Nada impedia o admin de cadastrar um confronto ali por engano, quebrando silenciosamente o
    // contrato documentado em data.js ("essas fases não têm o que apostar, de propósito") -- esse
    // confronto passaria a aparecer no formulário de palpite e em Jogos, contradizendo o design.
    const concludedNoData = (DATA.phasesConcludedNoData || []).includes(phase.id) && !tieCount;
    if (concludedNoData) {
      html += `<div class="admin-phase-block" data-phase="${esc(phase.id)}">
        <div class="admin-phase-header">
          <b>${esc(phase.name)}</b>
          <span class="muted small-text">${esc(t("phaseAlreadyConcluded"))}</span>
        </div>
      </div>`;
      return;
    }
    html += `<div class="admin-phase-block" data-phase="${esc(phase.id)}">
      <div class="admin-phase-header">
        <b>${esc(phase.name)}</b>
        <span class="muted small-text">${phase.format === "TWO_LEG" ? esc(t("formatTwoLeg")) : esc(t("formatSingleMatch"))} · ${tieCount} ${esc(t("adminTiesCount"))}</span>
      </div>
      <div class="admin-row">
        <span class="small-text muted">${esc(t("adminPhaseCutoff"))}</span>
        <input type="datetime-local" class="adm-phase-cutoff" aria-label="${esc(t("adminPhaseCutoff"))}" value="${phaseState.cutoffAt ? esc(toLocalDatetimeValue(phaseState.cutoffAt)) : ""}">
        <button type="button" class="secondary small-btn" data-save-cutoff="${esc(phase.id)}">${esc(t("adminSaveCutoff"))}</button>
      </div>
      ${(() => {
        // Diagnóstico de fonte do cutoff -- achado real (2026-07-14, Eduardo: "o bolao da CDB
        // fala encerrado, quando não deveria" / "ninguém está conseguindo entrar palpites").
        // v3.18: desde que o auto-cálculo SEMPRE vence quando existe kickoff conhecido (ver
        // effectivePhaseCutoffMs), um cutoffAt manual preenchido pode estar simplesmente sendo
        // IGNORADO -- mostra os dois estados sem ambiguidade: "manual ativo" só quando não há
        // kickoff conhecido nenhum (é o único caso em que o manual pesa de verdade); "manual
        // preenchido mas ignorado" quando há kickoff conhecido (o auto está mandando, o manual é
        // só um resquício sem efeito -- o botão deixa limpar por clareza, mas não muda o cutoff
        // efetivo, que já é o automático).
        const effMs = effectivePhaseCutoffMs(s, phase.id);
        const hasManual = !!phaseState.cutoffAt;
        const hasKnownKickoff = firstKnownKickoffMs(s, phase.id) !== null;
        const manualInEffect = hasManual && !hasKnownKickoff;
        let label;
        if (effMs === null) label = t("cutoffSourceNone");
        else {
          const dateStr = new Date(effMs).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          if (manualInEffect) label = `${t("cutoffSourceManual")}: ${dateStr} BRT`;
          else if (hasManual) label = `${t("cutoffSourceAuto")}: ${dateStr} BRT — ${t("cutoffSourceManualIgnored")}`;
          else label = `${t("cutoffSourceAuto")}: ${dateStr} BRT`;
        }
        const resetBtn = hasManual
          ? `<button type="button" class="secondary small-btn" data-clear-cutoff="${esc(phase.id)}">${esc(t("adminUseAutoCutoff"))}</button>`
          : "";
        return `<div class="admin-row cutoff-source-diag"><span class="small-text muted">${esc(label)}</span>${resetBtn}</div>`;
      })()}
      <div class="admin-row cdb-add-tie">
        <input type="text" class="adm-team-a" placeholder="${esc(t("adminTeamA"))}" aria-label="${esc(t("adminTeamA"))}" list="cdbTeamList">
        <input type="text" class="adm-team-b" placeholder="${esc(t("adminTeamB"))}" aria-label="${esc(t("adminTeamB"))}" list="cdbTeamList">
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

  box.querySelectorAll("[data-clear-cutoff]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.clearCutoff;
    const s2 = state();
    s2.phases[phaseId].cutoffAt = null;
    saveState(s2);
    showToast(t("adminCutoffSaved"), "success");
  }));

  box.querySelectorAll("[data-add-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const phaseId = btn.dataset.addTie;
    const block = box.querySelector(`.admin-phase-block[data-phase="${phaseId}"]`);
    // Normalização contra a lista conhecida de times (mesma usada no <datalist>) -- achado em
    // auditoria (2026-07-14): "corinthians" e "Corinthians" eram tratados como times diferentes
    // em tudo (escudo, força, checagem de duplicata abaixo), só por causa de caixa/acento.
    const normalize = raw => {
      const v = raw.trim();
      const known = Object.keys(DATA.teamLogos || {});
      const hit = known.find(name => name.localeCompare(v, "pt-BR", { sensitivity: "base" }) === 0);
      return hit || v;
    };
    const teamA = normalize(block.querySelector(".adm-team-a").value);
    const teamB = normalize(block.querySelector(".adm-team-b").value);
    if (!teamA || !teamB || teamA === teamB) { alert(t("errorTieTeams")); return; }
    // Checagem de par duplicado -- achado em auditoria (2026-07-14): só a sincronização automática
    // com a ESPN usava existingPairsAcrossPhases(); o cadastro manual (typo, clique duplo, admin
    // esquecendo que já adicionou) podia criar dois confrontos independentes pro mesmo jogo real.
    const s2 = state();
    const pairKey = [teamA, teamB].sort().join("|");
    if (existingPairsAcrossPhases(s2).has(pairKey)) { alert(t("errorTieDuplicate")); return; }
    const format = getPhaseDef(phaseId).format;
    const tie = { teamA, teamB, matches: {}, qualifiedTeamId: null };
    legsForFormat(format).forEach(leg => { tie.matches[leg] = emptyMatch(); });
    s2.phases[phaseId].ties[uuid()] = tie;
    // Limpa os campos ANTES de salvar -- mesmo motivo do data-save-leg logo abaixo:
    // adminPhasesFormIsDirty() leria esses inputs ainda preenchidos no DOM antigo e bloquearia a
    // própria atualização que deveria mostrar o confronto recém-adicionado.
    block.querySelector(".adm-team-a").value = "";
    block.querySelector(".adm-team-b").value = "";
    saveState(s2);
    showToast(t("adminTieAdded"), "success");
  }));

  box.querySelectorAll("[data-remove-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    const tieId = btn.dataset.removeTie;
    // Excluir um confronto SEM resultado ainda é permitido (hasResults já bloqueia o botão nesse
    // caso), mas participantes podem já ter salvo palpite pra ele -- achado em auditoria
    // (2026-07-14): o palpite ficava órfão sem nenhum aviso, o participante só via o confronto
    // sumir do formulário na próxima vez que abrisse, sem explicação. Conta quantas entradas
    // referenciam esse tieId e avisa no próprio confirm().
    const s = state();
    const deleted = new Set(s.deletedIds || []);
    const affected = (s.entries || []).filter(e =>
      !deleted.has(e.id) && (e.picks?.matches?.[tieId] || e.picks?.qualified?.[tieId])
    ).length;
    const msg = affected > 0 ? t("confirmRemoveTieWithPicks").replace("{n}", affected) : t("confirmRemoveTie");
    if (!tripleConfirm(msg, t("tripleConfirmDetail"))) return;
    const s2 = state();
    const removedTie = s2.phases[btn.dataset.phase]?.ties?.[tieId];
    appendAdminAuditLog(s2, "remove-tie", { phase: btn.dataset.phase, tieId, teamA: removedTie?.teamA, teamB: removedTie?.teamB, removedTie });
    delete s2.phases[btn.dataset.phase]?.ties?.[tieId];
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
    const autoTag = tie.lockedBy === "espn-auto" ? ` <span class="espn-auto-tag">${esc(t("espnAutoTag"))}</span>` : "";
    return `<div class="admin-row cdb-admin-tie" data-tie-id="${esc(tieId)}">
      <span class="tie-teams-admin">${esc(tie.teamA)} × ${esc(tie.teamB)}</span>
      <span class="leg-result-saved">✓ ${summary}${esc(t("gamesAdvances"))}: ${esc(tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB)}${autoTag}</span>
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
      const autoTag = m.resultSource === "espn-auto" ? ` <span class="espn-auto-tag">${esc(t("espnAutoTag"))}</span>` : "";
      return `<div class="admin-leg-row" data-tie-id="${esc(tieId)}" data-phase="${esc(phase.id)}" data-leg="${leg}">
        ${label ? `<span class="leg-label">${esc(label)}</span>` : ""}
        <span class="leg-teams-admin">${esc(home)} × ${esc(away)}</span>
        <span class="leg-result-saved">✓ ${m.goalsHome} × ${m.goalsAway}${autoTag}</span>
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
    // Achado em auditoria (2026-07-14): o atributo HTML max="20" não bloqueia envio via JS, e ao
    // contrário de excluir/travar/destravar confronto (que já pedem confirm()), lançar um placar
    // real não pedia nada -- um typo mudava o ranking público na hora, sem nenhuma barreira.
    if (a > 20 || b > 20) { alert(t("errorLegScoreRange")); return; }
    // Sempre triple-confirm ao lançar um placar manual — publica na hora, sem passar pelo ESPN
    // auto-sync (que já é confiável e não passa por aqui). Ver tripleConfirm() acima.
    if (!tripleConfirm(t("confirmSaveLeg").replace("{a}", a).replace("{b}", b), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const tie = s2.phases[phaseId].ties[tieId];
    const home = leg === "second" ? tie.teamB : tie.teamA;
    const away = leg === "second" ? tie.teamA : tie.teamB;
    tie.matches[leg] = { ...(tie.matches[leg] || emptyMatch()), homeTeam: home, awayTeam: away, goalsHome: a, goalsAway: b, status: "FINAL", resultSource: "admin" };
    appendAdminAuditLog(s2, "save-leg", { phase: phaseId, tieId, leg, teamA: home, teamB: away, goalsHome: a, goalsAway: b });
    // Limpa os campos ANTES de salvar -- saveState() chama renderAll() de forma síncrona, e
    // adminResultsFormIsDirty() (novo, ver renderAdmin()) leria esses mesmos inputs ainda com "a"/
    // "b" digitados no DOM antigo (a reconstrução ainda não rodou) e bloquearia a própria
    // atualização que deveria mostrar o placar recém-salvo. Bug pego pelo teste automatizado
    // (test_round2_fixes.js) antes de chegar em produção.
    row.querySelector(".adm-leg-a").value = "";
    row.querySelector(".adm-leg-b").value = "";
    saveState(s2);
    showToast(t("legResultSaved"), "success");
  }));
  box.querySelectorAll("[data-edit-leg]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    // Achado em auditoria (2026-07-14): "Editar" apagava um placar já lançado imediatamente, sem
    // confirmação -- um mis-click descartava um resultado oficial sem nenhum jeito de desfazer.
    if (!tripleConfirm(t("confirmEditLeg"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const tie = s2.phases[btn.dataset.phase]?.ties?.[btn.dataset.editLeg];
    const m = tie?.matches?.[btn.dataset.leg];
    if (m) {
      appendAdminAuditLog(s2, "edit-leg", { phase: btn.dataset.phase, tieId: btn.dataset.editLeg, leg: btn.dataset.leg, previousGoalsHome: m.goalsHome, previousGoalsAway: m.goalsAway });
      m.goalsHome = null;
      m.goalsAway = null;
      m.status = "SCHEDULED";
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
    if (!tripleConfirm(t("confirmLockResults"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    s2.phases[phaseId].ties[tieId].qualifiedTeamId = qualified;
    s2.phases[phaseId].ties[tieId].lockedAt = new Date().toISOString();
    s2.phases[phaseId].ties[tieId].lockedBy = "admin";
    appendAdminAuditLog(s2, "lock-tie", { phase: phaseId, tieId, qualifiedTeamId: qualified, totalA, totalB });
    saveState(s2);
    showToast(t("resultsSaved"), "success");
  }));
  box.querySelectorAll("[data-unlock-tie]").forEach(btn => btn.addEventListener("click", () => {
    if (!guardAdmin()) return;
    if (!tripleConfirm(t("confirmUnlockResults"), t("tripleConfirmDetail"))) return;
    const s2 = state();
    const tie = s2.phases[btn.dataset.phase]?.ties?.[btn.dataset.unlockTie];
    if (tie) {
      appendAdminAuditLog(s2, "unlock-tie", { phase: btn.dataset.phase, tieId: btn.dataset.unlockTie, previousQualifiedTeamId: tie.qualifiedTeamId, previousLockedAt: tie.lockedAt, previousLockedBy: tie.lockedBy });
      delete tie.qualifiedTeamId; delete tie.lockedAt; delete tie.lockedBy;
    }
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
    const before = !!s2.paid[id];
    s2.paid[id] = !before;
    // Pagamento é dinheiro real e era a única ação de admin que mexia em dinheiro sem deixar
    // rastro nenhum no audit log (achado da auditoria de 2026-08, AUDIT-08). Guarda antes/depois
    // para reconstruir quem estava pago em qualquer momento.
    appendAdminAuditLog(s2, "toggle-paid", {
      entryId: id,
      entryName: (s2.entries || []).find(e => e.id === id)?.entryName || null,
      from: before, to: !before,
    });
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
    const delId = btn.dataset.deleteEntry;
    s2.deletedIds.push(delId);
    // Exclusão de entrada é soft-delete (o objeto continua em `entries`, só entra na tombstone
    // list), mas não deixava NENHUM rastro de quem/quando -- numa disputa por dinheiro real esse
    // é exatamente o registro que faz falta. Achado da auditoria de 2026-08 (AUDIT-08).
    const delEntry = (s2.entries || []).find(e => e.id === delId);
    appendAdminAuditLog(s2, "delete-entry", {
      entryId: delId,
      entryName: delEntry?.entryName || null,
      participantEmail: delEntry?.participantEmail || null,
      wasPaid: !!s2.paid?.[delId],
    });
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
          const { home: cHome, away: cAway } = legTeams(tie, leg, tie.matches?.[leg]);
          lines.push(`${cHome} ${pick.goalsHome}x${pick.goalsAway} ${cAway}${legLabel}`);
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
  const csv  = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
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
      await fetchJson(`${url}/rest/v1/${table}?id=eq.${stateId}`, {
        method: "DELETE",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
      });
    } catch (err) { console.warn("[CDB2026] Clear remote failed", err); }
  }
  renderAll();
}

// Real bug found by Eduardo (2026-07-14): renderPickForm() rebuilds #pickForm's entire innerHTML
// from scratch every time renderAll() runs. renderAll() also runs from a BACKGROUND resync
// (reloadRemoteIfVisible(), gated by _editingEntry) — but _editingEntry is only set when the user
// loaded an EXISTING saved entry; a brand-new, never-saved entry leaves it null the entire time
// it's being filled out. Opening the "quem se classifica" <select> triggers a window blur/focus
// cycle on many browsers/mobile (the native picker takes and returns focus), which fires the
// `focus` listener -> debouncedReload() -> renderAll() -> renderPickForm() mid-typing, wiping
// every score/pick the participant hadn't saved yet. Reproduced and confirmed with Playwright
// (dispatch a focus event mid-fill -> the just-typed goal is gone ~1s later, once the background
// fetch settles). Same code pattern exists in BR2026 (also fixed) — Copa doesn't have this bug,
// its renderBracket() (builds the form) and updateDynamic() (called every renderAll()) are
// already separate functions, so a resync there never touches the live input elements.
// Fix: never blow away a form the user is actively typing into, regardless of why renderAll() ran.
function pickFormIsDirty() {
  const form = $("pickForm");
  if (!form) return false;
  return [...form.querySelectorAll(".pk-goals-home, .pk-goals-away")].some(el => el.value !== "") ||
         [...form.querySelectorAll(".pk-qualified")].some(el => el.value !== "");
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
  applyI18n();
  renderFindEntryCard();
  if (!pickFormIsDirty()) renderPickForm();
  renderRanking();
  renderNextTieCard();
  renderLiveTieCard();
  renderLiveRankingHero();
  renderGamesSection();
  renderProbsSection();
  renderParticipants();
  renderPayment();
  renderRules();
  renderFooter();
  if (isAdminActive()) renderAdmin();
  nudgeScrollReflow();
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const wa = $("supportWhatsappBtn");
  if (wa) wa.href = C.whatsappGroup?.link || "#";

  $$("[data-section]").forEach(btn => btn.addEventListener("click", () => showSection(btn.dataset.section)));
  // Disable "Palpites" nav button only after the active phase's cutoff; default landing depends
  // on it — same pattern as Copa (bolao/js/app.js init()), propagated here alongside BR2026.
  const navEntryBtn = document.querySelector('.nav button[data-section="entry"]');
  if (navEntryBtn) navEntryBtn.disabled = isPastEntryCutoff();
  showSection(isPastEntryCutoff() ? "ranking" : "entry");

  $("bolaoSelect")?.addEventListener("change", e => {
    const allowed = ["/bolao/copa2026/", "/bolao/br2026/", "/bolao/cdb2026/"];
    if (allowed.includes(e.target.value)) location.href = e.target.value;
  });

  renderCountdown();
  // Mesmo tick de 1s do BR2026/Copa -- antes renderNextTieCard() só re-renderizava via renderAll()
  // (save, resync a cada 30s), então o contador do card "Próxima partida" nunca atualizava ao
  // vivo entre um re-render e outro. Divergência real encontrada por Eduardo (2026-07-14).
  // renderLiveTieCard() no mesmo tick: só re-renderiza o relógio já interpolado em memória
  // (liveClockDisplay), sem rede — o poll de rede real é o setInterval de 60s logo abaixo.
  setInterval(() => { if (!document.hidden) { renderCountdown(); renderNextTieCard(); renderLiveTieCard(); } }, 1000);

  // Poll de partida ao vivo (2026-07-15) -- mesma cadência de 60s da Copa/BR2026
  // (pollLiveScores/pollAll), separado do sync de resultado FINAL a cada 5 min
  // (autoSyncEspnFull, acima) -- concerns diferentes: este é só pra exibição em tempo real
  // enquanto o jogo está rolando, nunca grava nada no estado/Supabase.
  pollLiveTies();
  setInterval(() => { if (!document.hidden) pollLiveTies(); }, LIVE_TIE_POLL_INTERVAL_MS);

  $("saveEntryBtn")?.addEventListener("click", saveEntry);
  $("paymentMethod")?.addEventListener("change", renderPaymentBox);

  $("findEntryBtn")?.addEventListener("click", () => {
    if (!oitavasComplete(state())) { showToast(t("findEntryLockedMsg"), "warn"); return; }
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
    renderPaymentBox();
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
  // Roda depois do merge com o Supabase (nunca antes) — nunca semeia por cima do que outro
  // dispositivo já salvou. Persiste na primeira vez que o flag vira true, mesmo se nada novo foi
  // de fato adicionado (ex.: outro dispositivo já semeou e isso só chegou agora via merge) — ver
  // seedKnownConfrontos() e docs/bolao/CDB2026_RULES_AND_MODEL.md seção 7 "Confrontos já sorteados".
  const seedState  = state();
  const wasSeeded   = !!seedState.espnSync.seededKnownConfrontos;
  const wasBackfilled = !!seedState.espnSync.backfilledOitavasKickoffs;
  const wasHealed = !!seedState.espnSync.healedFalseAutoResults;
  const wasHealedPhantoms = !!seedState.espnSync.healedPhantomTies;
  seedKnownConfrontos(seedState);
  backfillOitavasKickoffs(seedState);
  healFalseEspnAutoResults(seedState);
  healPhantomTies(seedState);
  if (!wasSeeded || !wasBackfilled || !wasHealed || !wasHealedPhantoms) saveState(seedState, { localOnly: false });
  renderAll();

  // Resume live-tie polling right away on focus/visible/bfcache-restore instead of waiting out
  // whatever's left of the current 60s cycle -- unconditional (not gated on C.database.enabled),
  // since ESPN live scores/clock work independently of Supabase. Same class of gap as the
  // Supabase resync below (see its comment): Copa already re-triggers its own live-score poll
  // from focus/pageshow (startLiveScorePolling()) after a real past incident; this app's
  // handlers only resynced Supabase, leaving the live-tie card free to go stale until a manual
  // reload -- found auditing BR2026's identical gap (Eduardo, 2026-07-25: "have to refresh to
  // get an updated score and clocks are not in sync with the actual game time").
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLiveTies(); });
  window.addEventListener("focus", pollLiveTies);
  window.addEventListener("pageshow", e => { if (e.persisted) pollLiveTies(); });

  if (C.database.enabled) {
    setInterval(() => { if (!document.hidden && !_editingEntry) debouncedReload(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) debouncedReload(); });
    window.addEventListener("focus", debouncedReload);
    // iOS Safari can restore a backgrounded tab from bfcache without reliably firing
    // visibilitychange, leaving the page stuck on whatever state was in memory at the last real
    // load — force a resync whenever that happens. Same fix already applied to the Copa
    // (bolao/js/app.js) after a real incident where a stale local browser state won a merge
    // against fresher Supabase data; see docs/bolao/LESSONS_LEARNED.md "Safari" / "Supabase —
    // merge/sync". mergeStates() here already applies preferRemoteResults:true on every load, so
    // the missing piece was purely "reliably trigger that reload", not the merge rule itself.
    window.addEventListener("pageshow", e => { if (e.persisted) debouncedReload(); });
  }
}

document.addEventListener("DOMContentLoaded", init);

// Read-only test hooks — pure functions only, no state mutation exposed. Mesmo padrão do BR2026
// (window.__BR2026_TESTHOOKS__, bolao/br2026/js/app.js).
window.__CDB2026_TESTHOOKS__ = { rankEntriesBy, calculateRankingMovement, liveScoreEntry, scoreEntry, matchPoints, extractMatchPlays };
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
    return [...form.querySelectorAll(".pk-goals-home, .pk-goals-away")].some(el => el.value !== "") ||
           [...form.querySelectorAll(".pk-qualified")].some(el => el.value !== "");
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
      if (m && m[1] !== window.CDB2026_CONFIG?.siteVersion) location.reload();
    } catch (e) { /* network hiccup — next poll retries, nothing to recover here */ }
  }
  setInterval(checkVersion, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
}());
