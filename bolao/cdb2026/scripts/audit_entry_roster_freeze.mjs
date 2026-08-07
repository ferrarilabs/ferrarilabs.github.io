/**
 * audit_entry_roster_freeze.mjs — CDB2026 permanent entry-roster freeze regression suite.
 *
 * Run:  node bolao/cdb2026/scripts/audit_entry_roster_freeze.mjs
 *
 * Why this exists (Batch 0, 2026-08-07): as inscrições da Copa do Brasil estão encerradas em
 * definitivo, mas os palpites ainda reabrem três vezes (quartas, semifinal, final). O perigo
 * concreto encontrado na auditoria: `entryCutoffMs()` deriva o fechamento das inscrições do
 * cutoff da FASE ATIVA (`espnSync.activePhaseId`). Quando o sorteio das quartas for cadastrado,
 * esse cutoff volta a ser um instante FUTURO, `isPastEntryCutoff()` vira false e o formulário de
 * nova entrada reabre sozinho. Ou seja: abrir os palpites reabriria a inscrição.
 *
 * A invariante que esta suíte protege:
 *
 *     PICKS_OPEN pode alternar por fase.  ENTRY_CREATION_ALLOWED permanece false.
 *     PICKS_OPEN != REGISTRATION_OPEN
 *
 * Sem dependências, sem rede, sem Supabase, sem browser. `js/app.js` é um IIFE de browser e não
 * pode ser importado, então as funções sob teste são extraídas do texto-fonte real em runtime —
 * mesma técnica de audit_state_merge.mjs. Isso testa o CÓDIGO QUE EMBARCA, não uma cópia
 * transcrita à mão (a exata deriva que o cabeçalho de audit_scoring.py alerta).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE    = dirname(fileURLToPath(import.meta.url));
const APP_JS  = join(HERE, "..", "js", "app.js");
const CFG_JS  = join(HERE, "..", "js", "config.js");
const HTML    = join(HERE, "..", "index.html");
const FIXTURE = join(HERE, "fixtures", "golden_state.json");

const src  = readFileSync(APP_JS, "utf8");
const cfg  = readFileSync(CFG_JS, "utf8");
const html = readFileSync(HTML, "utf8");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
/** Variante assíncrona: `saveEntry()` é async, e um teste async passado ao `test()` síncrono
 *  teria suas falhas engolidas (a promise rejeitaria fora do try). Usar sempre com `await`. */
async function atest(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Extract a top-level `function name(...) { ... }` from the real app.js by brace matching. */
function extractFn(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() not found in app.js`);
  if (src.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  let p = src.indexOf("(", start), parens = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === "(") parens++;
    else if (src[j] === ")") { parens--; if (parens === 0) { bodyStart = src.indexOf("{", j); break; } }
  }
  if (bodyStart === -1) throw new Error(`could not locate body of ${name}()`);
  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

/** Build the shipping `applyAdminMutation` + `isEntryCreationAllowed` in an isolated scope,
 *  with a controllable CONFIG (`C`) so both frozen and unfrozen behaviour can be exercised. */
function buildMutator(frozen) {
  const code = `
    const C = { entryRosterFrozen: ${frozen} };
    function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
    ${extractFn("isEntryCreationAllowed")}
    ${extractFn("applyAdminMutation")}
    return { applyAdminMutation, isEntryCreationAllowed };
  `;
  return new Function(code)();
}

const golden   = JSON.parse(readFileSync(FIXTURE, "utf8"));
const baseline = JSON.parse(JSON.stringify(golden));
const idsHash  = st => createHash("sha256")
  .update(([...(st.entries || [])].map(e => e.id).sort()).join("\n")).digest("hex");

const BEFORE_COUNT = (baseline.entries || []).length;
const BEFORE_HASH  = idsHash(baseline);

console.log("\nCDB2026 — entry roster freeze suite");
console.log(`  roster baseline: ${BEFORE_COUNT} entries, ids sha256 ${BEFORE_HASH.slice(0, 16)}…\n`);

// ── T01/T02 — roster preservado ────────────────────────────────────────────
test("T01 existing roster count unchanged by the freeze", () => {
  const { applyAdminMutation } = buildMutator(true);
  const existing = baseline.entries[0];
  const out = applyAdminMutation(JSON.parse(JSON.stringify(baseline)),
    { type: "upsert-entry", entry: { ...existing, entryName: "renamed" } });
  assertEqual((out.entries || []).length, BEFORE_COUNT, "entry count changed");
});

test("T02 existing roster IDs unchanged by the freeze", () => {
  const { applyAdminMutation } = buildMutator(true);
  const existing = baseline.entries[0];
  const out = applyAdminMutation(JSON.parse(JSON.stringify(baseline)),
    { type: "upsert-entry", entry: { ...existing, entryName: "renamed" } });
  assertEqual(idsHash(out), BEFORE_HASH, "entry id set changed");
});

// ── T03 — UI ───────────────────────────────────────────────────────────────
test("T03 UI cannot start a new entry (card hidden by default + gated by the invariant)", () => {
  assert(/id="newEntryCard"[^>]*class="card hidden"/.test(html),
    "#newEntryCard must ship with the 'hidden' class (fail closed if JS never runs)");
  const fn = extractFn("renderNewEntryCard");
  assert(/isEntryCreationAllowed\(\)/.test(fn),
    "renderNewEntryCard() must gate on isEntryCreationAllowed()");
  assert(!/isPastEntryCutoff\(\)/.test(fn),
    "renderNewEntryCard() must NOT gate on the phase cutoff — that is what reopens registration");
});

// ── T04 — mutação direta ───────────────────────────────────────────────────
test("T04 direct create-entry mutation is rejected with ENTRY_ROSTER_FROZEN", () => {
  const { applyAdminMutation } = buildMutator(true);
  const st = JSON.parse(JSON.stringify(baseline));
  let threw = null;
  try {
    applyAdminMutation(st, { type: "upsert-entry", entry: { id: "brand-new-id", entryName: "X" } });
  } catch (e) { threw = e; }
  assert(threw, "creation was NOT rejected");
  assertEqual(threw.message, "ENTRY_ROSTER_FROZEN", "wrong rejection code");
});

test("T04b rejected creation performs no partial write (no state mutation, no id allocated)", () => {
  const { applyAdminMutation } = buildMutator(true);
  const st = JSON.parse(JSON.stringify(baseline));
  try { applyAdminMutation(st, { type: "upsert-entry", entry: { id: "ghost", entryName: "X" } }); } catch {}
  assertEqual((st.entries || []).length, BEFORE_COUNT, "source state was mutated");
  assertEqual(idsHash(st), BEFORE_HASH, "source roster changed");
  assert(!JSON.stringify(st).includes("ghost"), "rejected entry leaked into state");
});

// ── T05 — admin ────────────────────────────────────────────────────────────
test("T05 admin path uses the same guard — no privileged bypass exists", () => {
  const fn = extractFn("applyAdminMutation");
  assert(/ENTRY_ROSTER_FROZEN/.test(fn), "admin mutation lacks the freeze guard");
  assert(!/isAdmin|adminBypass|force/i.test(fn.split("ENTRY_ROSTER_FROZEN")[0].slice(-400)),
    "an admin-only bypass appears to guard the freeze");
});

// ── T06 — a invariante central ─────────────────────────────────────────────
test("T06 picks-open transition does not reopen registration (PICKS_OPEN != REGISTRATION_OPEN)", () => {
  const { applyAdminMutation, isEntryCreationAllowed } = buildMutator(true);
  // Simula exatamente o cenário perigoso: o sorteio das quartas entra, a fase ativa vira
  // `quartas` e o cutoff da fase passa a ser FUTURO — isPastEntryCutoff() viraria false.
  const st = JSON.parse(JSON.stringify(baseline));
  st.espnSync = { ...(st.espnSync || {}), activePhaseId: "quartas" };
  st.phases = { ...(st.phases || {}) };
  st.phases.quartas = { cutoffAt: new Date(Date.now() + 7 * 864e5).toISOString(), ties: {} };
  assertEqual(isEntryCreationAllowed(), false, "entry creation became allowed when picks opened");
  let threw = null;
  try {
    applyAdminMutation(st, { type: "upsert-entry", entry: { id: "new-during-qf", entryName: "X" } });
  } catch (e) { threw = e; }
  assertEqual(threw && threw.message, "ENTRY_ROSTER_FROZEN", "registration reopened with picks");
});

test("T06b saveEntry() gates creation on the freeze, before any cutoff logic", () => {
  const fn = extractFn("saveEntry");
  const gate = fn.indexOf("isEntryCreationAllowed()");
  assert(gate !== -1, "saveEntry() does not consult isEntryCreationAllowed()");
  assert(gate < fn.indexOf("getPickValues()"), "freeze guard runs after form/pick reads");
  assert(gate < fn.indexOf("uuid()"), "freeze guard runs after an id is allocated");
  assert(/!_editingEntry && !isEntryCreationAllowed\(\)/.test(fn),
    "the guard must apply to creation only, never to editing an existing entry");
});

// ── T07/T08 — continuidade das entradas existentes ─────────────────────────
test("T07 existing entry can still be updated while frozen (picks for new phases)", () => {
  const { applyAdminMutation } = buildMutator(true);
  const existing = baseline.entries[0];
  const updated  = { ...existing, picks: { ...(existing.picks || {}), matches: { "qf-1": { home: 2, away: 1 } } } };
  const out = applyAdminMutation(JSON.parse(JSON.stringify(baseline)), { type: "upsert-entry", entry: updated });
  const got = out.entries.find(e => e.id === existing.id);
  assert(got, "existing entry disappeared");
  assertEqual(got.picks.matches["qf-1"].home, 2, "new-phase pick was not stored");
  assertEqual(out.entries.length, BEFORE_COUNT, "update changed the roster size");
});

test("T08 existing historical picks are untouched by the freeze", () => {
  const { applyAdminMutation } = buildMutator(true);
  const existing = baseline.entries[0];
  const before   = JSON.stringify(existing.picks);
  const out = applyAdminMutation(JSON.parse(JSON.stringify(baseline)),
    { type: "upsert-entry", entry: { ...existing, entryName: "renamed only" } });
  const got = out.entries.find(e => e.id === existing.id);
  assertEqual(JSON.stringify(got.picks), before, "historical picks mutated");
});

// ── T09 — scoring intocado ─────────────────────────────────────────────────
test("T09 the freeze touches no scoring surface", () => {
  for (const name of ["SCORING_RULE_VERSION", "scoreEntry", "getActiveScore"]) {
    // presença apenas — a prova numérica é audit_scoring.py, executado à parte
    assert(src.includes(name), `${name} missing from app.js`);
  }
  const guard = extractFn("applyAdminMutation");
  const seg = guard.slice(guard.indexOf("upsert-entry"), guard.indexOf("delete-entry"));
  assert(!/score|points|pontos/i.test(seg), "freeze guard region references scoring");
});

// ── T10/T11/T12 — persistência, bypass, idempotência ───────────────────────
test("T10 reload/persist cycle creates no entry", () => {
  const { applyAdminMutation } = buildMutator(true);
  let st = JSON.parse(JSON.stringify(baseline));
  for (let i = 0; i < 3; i++) st = JSON.parse(JSON.stringify(applyAdminMutation(st, { type: "set-payment", entryId: baseline.entries[0].id, value: true })));
  assertEqual((st.entries || []).length, BEFORE_COUNT, "roster grew across persist cycles");
  assertEqual(idsHash(st), BEFORE_HASH, "roster ids changed across persist cycles");
});

test("T11 batch/nested invocation cannot smuggle in a creation", () => {
  const { applyAdminMutation } = buildMutator(true);
  const st = JSON.parse(JSON.stringify(baseline));
  let threw = null;
  try {
    applyAdminMutation(st, { type: "batch", mutations: [
      { type: "set-payment", entryId: baseline.entries[0].id, value: true },
      { type: "upsert-entry", entry: { id: "smuggled", entryName: "X" } },
    ]});
  } catch (e) { threw = e; }
  assertEqual(threw && threw.message, "ENTRY_ROSTER_FROZEN", "batch bypassed the freeze");
  assert(!JSON.stringify(st).includes("smuggled"), "smuggled entry leaked into state");
});

test("T12 repeated rejected attempts are idempotently rejected", () => {
  const { applyAdminMutation } = buildMutator(true);
  const st = JSON.parse(JSON.stringify(baseline));
  for (let i = 0; i < 5; i++) {
    let threw = null;
    try { applyAdminMutation(st, { type: "upsert-entry", entry: { id: `rep-${i}`, entryName: "X" } }); }
    catch (e) { threw = e; }
    assertEqual(threw && threw.message, "ENTRY_ROSTER_FROZEN", `attempt ${i} not rejected`);
  }
  assertEqual((st.entries || []).length, BEFORE_COUNT, "roster grew across rejected attempts");
  assertEqual(idsHash(st), BEFORE_HASH, "roster ids changed across rejected attempts");
});

// ── Guarda de configuração ─────────────────────────────────────────────────
test("CFG entryRosterFrozen is true in the shipping config", () => {
  assert(/entryRosterFrozen:\s*true/.test(cfg),
    "CONFIG.entryRosterFrozen must be true for CDB2026");
});

test("CFG unfreezing restores creation (the guard is the flag, not a hardcode)", () => {
  const { applyAdminMutation, isEntryCreationAllowed } = buildMutator(false);
  assertEqual(isEntryCreationAllowed(), true, "unfrozen config still blocks creation");
  const out = applyAdminMutation(JSON.parse(JSON.stringify(baseline)),
    { type: "upsert-entry", entry: { id: "allowed-when-open", entryName: "X" } });
  assertEqual(out.entries.length, BEFORE_COUNT + 1, "creation blocked even when unfrozen");
});

// ─── Harness do fluxo REAL de self-service (T13–T21) ───────────────────────
/**
 * Monta e executa o `saveEntry()` que EMBARCA, com um DOM stub mínimo.
 *
 * Por que stub e não browser: este repo não tem node_modules nem Playwright instalável offline,
 * e `js/app.js` é um IIFE de browser. Então extraímos as funções reais (mesma técnica do resto
 * desta suíte) e injetamos só as bordas (elementos, toasts, persistência). O que está sob teste
 * — saveEntry, updateExistingEntry, editingEntryIsValid, renderNewEntryCard, receiptCode — é o
 * código de produção, não uma transcrição. Nada de email (emailjs.enabled=false, sem
 * window.emailjs) e nada de banco (saveState é um espião em memória).
 */
function buildAppHarness({ frozen, initialState, editing, inputs = {} }) {
  const code = `
    const calls = { saveState: [], toasts: [], alerts: [], sections: [], receipts: [], queueReceipt: 0, errors: [] };
    let _state = initialState;
    let _editingEntry = editing;
    const C = { entryRosterFrozen: ${frozen}, emailjs: { enabled: false } };
    const window = {}; // sem emailjs: queueReceipt nunca é alcançado
    // console capturado: a rejeição esperada faz o app logar console.error — é comportamento
    // correto em produção, mas aqui só polui a saída da suíte. Guardado para inspeção.
    const console = { error: (...a) => calls.errors.push(a.map(String).join(" ")), warn() {}, log() {} };
    const els = {};
    function el(id) {
      if (!els[id]) els[id] = {
        id, value: inputs[id] ?? "", disabled: false, readOnly: false, textContent: "",
        _hidden: true,
        classList: { toggle(cls, on) { if (cls === "hidden") els[id]._hidden = !!on; } },
      };
      return els[id];
    }
    for (const k of ["entryName","payerName","participantEmail","paymentMethod","saveEntryBtn","newEntryCard","newEntryTitle"]) el(k);
    const $ = id => els[id] || null;
    const t = k => k;
    const alert = m => calls.alerts.push(m);
    const showToast = (m, kind) => calls.toasts.push([m, kind]);
    const state = () => _state;
    const saveState = s => { _state = s; calls.saveState.push(JSON.parse(JSON.stringify(s))); };
    const showSection = s => calls.sections.push(s);
    const renderPickForm = () => {};
    const renderReceiptBox = e => calls.receipts.push(e);
    const queueReceipt = () => { calls.queueReceipt++; };
    const getPickValues = () => picks;
    const validatePicks = () => [];
    const isPastEntryCutoff = () => false;
    const uuid = () => "GENERATED-NEW-ID";
    ${extractFn("isEntryCreationAllowed")}
    ${extractFn("editingEntryIsValid")}
    ${extractFn("updateExistingEntry")}
    ${extractFn("renderNewEntryCard")}
    ${extractFn("hashString")}
    ${extractFn("receiptCode")}
    ${extractFn("saveEntry")}
    return {
      saveEntry, renderNewEntryCard, receiptCode, editingEntryIsValid, updateExistingEntry,
      calls, els, getState: () => _state, getEditing: () => _editingEntry,
    };
  `;
  return new Function("initialState", "editing", "inputs", "picks", code)(
    initialState, editing, inputs, { matches: { "qf-1": { home: 3, away: 0 } }, qualified: { "qf-1": "A" } }
  );
}

const freshState = () => JSON.parse(JSON.stringify(baseline));

test("T13 existing entry lookup reveals the edit/picks form while roster frozen", () => {
  const st = freshState();
  const h  = buildAppHarness({ frozen: true, initialState: st, editing: st.entries[0] });
  h.renderNewEntryCard();
  assertEqual(h.els.newEntryCard._hidden, false, "#newEntryCard stayed hidden for an existing entry");
  assertEqual(h.els.newEntryTitle.textContent, "entryTitleEditing", "card still titled as a NEW entry");
  assertEqual(h.els.entryName.readOnly, true, "identity input editable while frozen");
  assertEqual(h.els.paymentMethod.disabled, true, "payment method editable while frozen");
});

test("T14 frozen mode with no editing entry keeps the new-entry form hidden", () => {
  const h = buildAppHarness({ frozen: true, initialState: freshState(), editing: null });
  h.renderNewEntryCard();
  assertEqual(h.els.newEntryCard._hidden, true, "#newEntryCard visible with no entry loaded");
});

test("T14b a stale/tombstoned editing entry does NOT reveal the form", () => {
  const st = freshState();
  const h1 = buildAppHarness({ frozen: true, initialState: st, editing: { id: "ghost-id", entryName: "X" } });
  h1.renderNewEntryCard();
  assertEqual(h1.els.newEntryCard._hidden, true, "stale entry revealed the form");
  const st2 = freshState();
  st2.deletedIds = [...(st2.deletedIds || []), st2.entries[0].id];
  const h2 = buildAppHarness({ frozen: true, initialState: st2, editing: st2.entries[0] });
  h2.renderNewEntryCard();
  assertEqual(h2.els.newEntryCard._hidden, true, "tombstoned entry revealed the form");
});

await atest("T15 stale _editingEntry id cannot append a new entry", async () => {
  const st = freshState();
  const stale = { id: "no-longer-here", entryName: "Ghost", payerName: "G",
    participantEmail: "g@example.com", paymentMethod: "Zelle", createdAt: "2026-07-01T00:00:00.000Z" };
  const h = buildAppHarness({ frozen: true, initialState: st, editing: stale,
    inputs: { entryName: "Ghost", payerName: "G", participantEmail: "g@example.com", paymentMethod: "Zelle" } });
  await h.saveEntry();
  const out = h.getState();
  assertEqual((out.entries || []).length, BEFORE_COUNT, "roster grew via a stale edit");
  assertEqual(idsHash(out), BEFORE_HASH, "roster ids changed via a stale edit");
  assertEqual(h.calls.saveState.length, 0, "state was persisted despite the rejection");
  assert(h.calls.toasts.some(([m]) => m === "entryGoneOnSave"), "no deterministic rejection surfaced");
  assertEqual(h.getEditing(), null, "stale editing entry was not cleared");
});

await atest("T16 tombstoned _editingEntry cannot append a new entry", async () => {
  const st = freshState();
  const victim = JSON.parse(JSON.stringify(st.entries[0]));
  st.deletedIds = [...(st.deletedIds || []), victim.id];
  const h = buildAppHarness({ frozen: true, initialState: st, editing: victim,
    inputs: { entryName: victim.entryName, payerName: victim.payerName || "P",
      participantEmail: victim.participantEmail || "p@example.com", paymentMethod: victim.paymentMethod || "Zelle" } });
  await h.saveEntry();
  const out = h.getState();
  assertEqual((out.entries || []).length, BEFORE_COUNT, "roster grew via a tombstoned edit");
  assertEqual(idsHash(out), BEFORE_HASH, "roster ids changed via a tombstoned edit");
  assertEqual(h.calls.saveState.length, 0, "state was persisted despite the rejection");
});

// T17/T18/T19/T20/T21 compartilham um único save real do self-service congelado.
const T17 = (() => {
  const st = freshState();
  const original = JSON.parse(JSON.stringify(st.entries[0]));
  const h = buildAppHarness({
    frozen: true, initialState: st, editing: st.entries[0],
    // inputs deliberadamente ADULTERADOS: se a identidade não for imutável, isto vaza para o estado
    inputs: { entryName: "IDENTIDADE ROUBADA", payerName: "Outro Pagador",
      participantEmail: "invasor@example.com", paymentMethod: "Venmo" },
  });
  const done = h.saveEntry().then(() => ({ h, original, saved: h.getState().entries.find(e => e.id === original.id) }));
  return { h, original, done };
})();

await atest("T17 self-service edit preserves id/createdAt/entryName/participantEmail/payerName/paymentMethod", async () => {
  const { original, saved } = await T17.done;
  assert(saved, "entry disappeared after the self-service save");
  for (const f of ["id", "createdAt", "entryName", "participantEmail", "payerName", "paymentMethod"]) {
    assertEqual(saved[f], original[f], `identity field ${f} was mutated by the self-service edit`);
  }
});

await atest("T18 self-service edit can change new-phase picks", async () => {
  const { saved, original } = await T17.done;
  assertEqual(saved.picks.matches["qf-1"].home, 3, "new-phase pick was not persisted");
  assert(saved.updatedAt && saved.updatedAt !== original.updatedAt, "updatedAt was not bumped");
});

await atest("T19 receiptCode remains unchanged after an ordinary frozen-mode pick update", async () => {
  const { h, original, saved } = await T17.done;
  assertEqual(h.receiptCode(saved), h.receiptCode(original), "receipt code changed — recovery code destroyed");
});

await atest("T20 roster ID set unchanged after all permitted edits", async () => {
  const { h } = await T17.done;
  const out = h.getState();
  assertEqual((out.entries || []).length, BEFORE_COUNT, "roster size changed after a permitted edit");
  assertEqual(idsHash(out), BEFORE_HASH, "roster id set changed after a permitted edit");
});

await atest("T21 the flow runs the REAL saveEntry path (observed persistence), not applyAdminMutation", async () => {
  const { h, original } = await T17.done;
  assertEqual(h.calls.saveState.length, 1, "saveEntry() did not reach persistence exactly once");
  const persisted = h.calls.saveState[0].entries.find(e => e.id === original.id);
  assert(persisted, "the persisted state does not contain the edited entry");
  assertEqual(persisted.picks.matches["qf-1"].home, 3, "the persisted state lacks the new picks");
  assertEqual(h.getEditing(), null, "editing session was not closed after save");
  assertEqual(h.els.newEntryCard._hidden, true, "card did not return to the frozen/hidden state");
  assertEqual(h.calls.queueReceipt, 0, "an email receipt was queued during the audit");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) { console.log("\n✗ ENTRY ROSTER FREEZE SUITE FAILED\n"); process.exit(1); }
console.log("\n✓ ALL CHECKS PASSED\n");
