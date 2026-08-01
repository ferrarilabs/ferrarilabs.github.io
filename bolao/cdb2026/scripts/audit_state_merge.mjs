/**
 * audit_state_merge.mjs — CDB2026 state-merge / display-orientation regression suite.
 *
 * Run:  node bolao/cdb2026/scripts/audit_state_merge.mjs
 *
 * Why this exists (auditoria 2026-08): `audit_scoring.py` covers the SCORING formula, but four
 * of the six bugs found in that audit lived outside it — in `mergeStates()` (payment/migration
 * flags silently dropped) and in the display layer (second-leg home/away inverted on the
 * receipt, the ranking pick detail and the CSV). Those are exactly the surfaces that prove, in a
 * real-money dispute, what a participant actually bet — so they need their own guard.
 *
 * No dependencies, no network, no Supabase, no browser. `bolao/cdb2026/js/app.js` is a browser
 * IIFE and cannot be imported, so the two pure functions under test (`mergeStates`, `legTeams`)
 * are extracted from that file's real source text at runtime and evaluated in isolation. That
 * means this suite tests the SHIPPING code, not a copy of it — if someone edits those functions
 * in app.js, this suite sees the edit. It does deliberately NOT re-implement them (a hand-copied
 * transcription is exactly the drift `audit_scoring.py`'s own header warns about).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "js", "app.js");
const src = readFileSync(APP_JS, "utf8");

/** Extract a top-level `function name(...) { ... }` by brace-matching from the real app.js.
 *  The parameter list is skipped by paren-matching first — otherwise a default value like
 *  `opts = {}` is mistaken for the function body and the extraction stops immediately. */
function extractFn(name) {
  let start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() not found in app.js`);
  // Include the `async ` prefix when present, or the extracted body loses its async-ness and
  // its internal `await`s become syntax errors.
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
  throw new Error(`unbalanced braces extracting ${name}()`);
}

// mergeStates() closes over DATA.phases (phase list) and emptyPhaseState(); provide the minimum
// real-shaped stand-ins so the extracted source runs unmodified.
const harness = `
  const DATA = { phases: [{ id: "oitavas" }, { id: "quartas" }] };
  function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
  ${extractFn("mergeEntriesTombstonesAuditLog")}
  ${extractFn("mergeStates")}
  ${extractFn("applyAdminMutation")}
  ${extractFn("applyMutationOverRemote")}
  ${extractFn("legTeams")}
  return { mergeStates, legTeams, applyAdminMutation, applyMutationOverRemote };
`;
const { mergeStates, legTeams, applyAdminMutation, applyMutationOverRemote } = new Function(harness)();

// Shared factory for the saveRemoteState() tests below (AUDIT-03, Fase 2 §4 concurrency, Fase
// 2.1 mutation regressions) — same real-source extraction, just parameterized so the harness
// isn't hand-copied 3+ times (that copy-paste is itself exactly the kind of duplication this
// project's own Fase 2 audit flags elsewhere).
function makeSaveRemoteStateFactory() {
  const body = `
    const DATA = { phases: [{ id: "oitavas" }] };
    function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
    const C = { siteVersion: "test", storeKey: "k",
      database: { enabled: true, url: "http://x", anonKey: "a", table: "t", stateId: "cdb2026" } };
    const localStorage = { setItem: () => {}, getItem: () => null };
    const console = { warn: () => {} };
    async function fetchJson(u, o) { return fetchImpl(u, o); }
    ${extractFn("mergeEntriesTombstonesAuditLog")}
    ${extractFn("mergeStates")}
    ${extractFn("applyAdminMutation")}
    ${extractFn("applyMutationOverRemote")}
    ${extractFn("saveRemoteState")}
    return saveRemoteState;`;
  return fetchImpl => new Function("fetchImpl", body)(fetchImpl);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

console.log("Running CDB2026 state-merge / display-orientation audit...\n");

// ── AUDIT-01: all five espnSync "run once" migration flags survive a merge ──────────────────
// Regression: only activePhaseId + seededKnownConfrontos were carried through, so the other
// three were wiped on every remote sync and their one-shot routines re-ran on every load.
{
  const flags = {
    seededKnownConfrontos: true, backfilledOitavasKickoffs: true,
    healedFalseAutoResults: true, healedPhantomTies: true,
  };
  const local  = { espnSync: { activePhaseId: "oitavas", ...flags } };
  const remote = { espnSync: { activePhaseId: "oitavas", ...flags } };
  const m = mergeStates(local, remote, { preferRemoteResults: true });
  for (const f of Object.keys(flags)) {
    check(`espnSync.${f} survives merge (both sides true)`, m.espnSync[f] === true, `got ${m.espnSync[f]}`);
  }
  // Set on only ONE device must still win — that is the whole point of a "ran once" flag.
  const onlyLocal  = mergeStates({ espnSync: { healedPhantomTies: true } }, {}, { preferRemoteResults: true });
  const onlyRemote = mergeStates({}, { espnSync: { healedPhantomTies: true } }, { preferRemoteResults: true });
  check("espnSync flag set only locally survives", onlyLocal.espnSync.healedPhantomTies === true);
  check("espnSync flag set only remotely survives", onlyRemote.espnSync.healedPhantomTies === true);
}

// ── AUDIT-02: `paid` is any-true-wins, not local-wins ───────────────────────────────────────
// Regression: `{...remote.paid, ...local.paid}` let a stale local `false` erase an admin's
// fresher remote `true`, silently un-marking a payment.
{
  const m = mergeStates({ paid: { e1: false } }, { paid: { e1: true } }, { preferRemoteResults: true });
  check("remote paid:true beats stale local paid:false", m.paid.e1 === true, `got ${m.paid.e1}`);

  const m2 = mergeStates({ paid: { e2: true } }, { paid: { e2: false } }, { preferRemoteResults: true });
  check("local paid:true beats remote paid:false", m2.paid.e2 === true, `got ${m2.paid.e2}`);

  const m3 = mergeStates({ paid: { a: true } }, { paid: { b: true } }, { preferRemoteResults: true });
  check("paid keys from both sides are unioned", m3.paid.a === true && m3.paid.b === true);

  const m4 = mergeStates({ paid: { c: false } }, { paid: { c: false } }, { preferRemoteResults: true });
  check("unpaid stays unpaid (no phantom true)", m4.paid.c === false, `got ${m4.paid.c}`);
}

// ── Concurrent entries: neither client's new entry may be lost by the merge ─────────────────
{
  const local  = { entries: [{ id: "X", entryName: "X", createdAt: "2026-08-01T10:00:00Z" }] };
  const remote = { entries: [{ id: "Y", entryName: "Y", createdAt: "2026-08-01T10:00:01Z" }] };
  const m = mergeStates(local, remote, { preferRemoteResults: true });
  const ids = m.entries.map(e => e.id).sort();
  check("two concurrent new entries both survive", ids.join(",") === "X,Y", `got ${ids.join(",")}`);
}

// ── Fresher remote edit of an existing entry wins (admin rename etc.) ───────────────────────
{
  const local  = { entries: [{ id: "X", entryName: "old", updatedAt: "2026-08-01T10:00:00Z" }] };
  const remote = { entries: [{ id: "X", entryName: "new", updatedAt: "2026-08-01T11:00:00Z" }] };
  const m = mergeStates(local, remote, { preferRemoteResults: true });
  check("fresher remote entry edit wins", m.entries[0].entryName === "new", `got ${m.entries[0].entryName}`);
}

// ── Deleted entries stay deleted (tombstone union) ──────────────────────────────────────────
{
  const local  = { deletedIds: ["X"], entries: [] };
  const remote = { entries: [{ id: "X", entryName: "resurrected", createdAt: "2026-08-01T10:00:00Z" }] };
  const m = mergeStates(local, remote, { preferRemoteResults: true });
  check("locally-deleted entry is not resurrected by remote", !m.entries.some(e => e.id === "X"));
}

// ── AUDIT-03: read-merge-write on save (lost update) ────────────────────────────────────────
// Regression: saveRemoteState() POSTed the caller's whole local snapshot, replacing the remote
// `state` column outright (`Prefer: resolution=merge-duplicates` resolves the ROW conflict, it
// does not merge the JSON). A client that loaded before someone else's change silently erased
// it. Exercised against the REAL saveRemoteState() with fetch/localStorage stubbed.
{
  const saveRemoteState = makeSaveRemoteStateFactory();

  // Remote holds an admin payment mark AND another participant's entry this client never saw.
  const remoteState = {
    paid: { e1: true },
    entries: [
      { id: "e1", entryName: "pre-existing", createdAt: "2026-08-01T09:00:00Z" },
      { id: "e3", entryName: "other participant", createdAt: "2026-08-01T10:30:00Z" },
    ],
  };
  let posted = null;
  const fn = saveRemoteState(async (url, opts) => {
    if (!opts || opts.method !== "POST") return { ok: true, json: async () => [{ state: remoteState }] };
    posted = JSON.parse(opts.body);
    return { ok: true, text: async () => "" };
  });
  await fn({
    paid: { e1: false }, // stale: this client still thinks e1 is unpaid
    entries: [
      { id: "e1", entryName: "pre-existing", createdAt: "2026-08-01T09:00:00Z" },
      { id: "e2", entryName: "my new entry", createdAt: "2026-08-01T10:31:00Z" },
    ],
  });
  check("save preserves remote payment mark (no lost update)", posted.state.paid.e1 === true, `got ${posted.state.paid.e1}`);
  const ids = posted.state.entries.map(e => e.id).sort().join(",");
  check("save preserves a concurrent entry it never saw", ids === "e1,e2,e3", `got ${ids}`);

  // Non-2xx must reject — `await fetch()` does NOT throw on 4xx/5xx on its own.
  const fn403 = saveRemoteState(async (url, opts) => {
    if (!opts || opts.method !== "POST") return { ok: true, json: async () => [] };
    return { ok: false, status: 403, text: async () => '{"message":"RLS denied"}' };
  });
  let threw = false;
  await fn403({ entries: [] }).catch(() => { threw = true; });
  check("HTTP 403 rejects instead of reporting success", threw);

  // Pre-read failure (offline) must still push the local snapshot — never drop the entry.
  let postedOffline = null;
  const fnOffline = saveRemoteState(async (url, opts) => {
    if (!opts || opts.method !== "POST") throw new Error("network down");
    postedOffline = JSON.parse(opts.body);
    return { ok: true, text: async () => "" };
  });
  await fnOffline({ entries: [{ id: "z", entryName: "offline entry" }] });
  check("offline pre-read still saves the local entry", postedOffline?.state.entries[0].id === "z");
}

// ── Fase 2 §4: TRUE concurrent writes are NOT fully resolved by read-merge-write ────────────
// AUDIT-03's read-merge-write fix eliminates the SEQUENTIAL case (client B saves after client
// A's write is already visible remotely — B's pre-read sees it, mergeStates keeps it). It does
// NOT eliminate a genuine RACE: two clients whose pre-save read both happen before either
// client's write is visible. Each client only merges against what IT read, so a client that
// read before the other wrote has no way to know about that other write and will overwrite it.
// This is not a regression to "fix" here — there is no revision number, compare-and-swap,
// optimistic-locking column, or transactional RPC in this schema (plain upsert-by-id on the
// whole `state` JSON column) to make a true CAS possible. This test PROVES the residual risk
// so it is characterized honestly instead of assumed away. See
// docs/bolao/CDB2026_MODERNIZATION_REPORT_2026-08.md for the classification and the
// architectural recommendation (RPC with row version / optimistic concurrency) — NOT
// implemented automatically, per explicit instruction.
{
  const saveRemoteStateFactory = makeSaveRemoteStateFactory();

  // Server starts at V0. Both clients' pre-save reads are served V0 — neither has seen the
  // other's write when it reads, which is what makes this a genuine race and not staleness.
  let server = { entries: [{ id: "X", entryName: "Original", updatedAt: "2026-08-01T10:00:00Z" }], paid: {} };
  const V0 = JSON.parse(JSON.stringify(server));

  const saveA = saveRemoteStateFactory(async (url, opts) => {
    if (!opts || opts.method !== "POST") return { ok: true, json: async () => [{ state: V0 }] };
    server = JSON.parse(opts.body).state; // A's write lands first
    return { ok: true, text: async () => "" };
  });
  await saveA({ entries: [{ id: "X", entryName: "Renamed by A", updatedAt: "2026-08-01T10:00:05Z" }], paid: {} });
  check("client A's write lands", server.entries[0].entryName === "Renamed by A", `got ${server.entries[0].entryName}`);

  // B's pre-save read is served V0 too (it happened before A's write, in this race) — B never
  // sees "Renamed by A" at all, so its own merge has no way to preserve it.
  const saveB = saveRemoteStateFactory(async (url, opts) => {
    if (!opts || opts.method !== "POST") return { ok: true, json: async () => [{ state: V0 }] };
    server = JSON.parse(opts.body).state;
    return { ok: true, text: async () => "" };
  });
  await saveB({ entries: [{ id: "X", entryName: "Renamed by B", updatedAt: "2026-08-01T10:00:06Z" }], paid: {} });

  check(
    "NÃO COMPLETAMENTE RESOLVIDA PARA ESCRITAS SIMULTÂNEAS: B's race write silently discards A's change (expected/documented residual risk, not a regression)",
    server.entries[0].entryName === "Renamed by B",
    `got ${server.entries[0].entryName}`
  );
}

// ── AUDIT-05: second-leg home/away orientation ──────────────────────────────────────────────
// Regression: receipt / ranking detail / CSV printed a fixed `teamA × teamB`, so a leg-2 pick of
// "Fluminense 3 × 0 Vasco" was rendered "Vasco 3 × 0 Fluminense" — an inversion of the bet.
{
  const tie = { teamA: "Vasco", teamB: "Fluminense" };
  const l1 = legTeams(tie, "first", null);
  check("leg 1 home/away = teamA/teamB", l1.home === "Vasco" && l1.away === "Fluminense", `got ${l1.home}/${l1.away}`);

  const l2 = legTeams(tie, "second", null);
  check("leg 2 home/away is SWAPPED (teamB/teamA)", l2.home === "Fluminense" && l2.away === "Vasco", `got ${l2.home}/${l2.away}`);

  const ls = legTeams(tie, "single", null);
  check("single match home/away = teamA/teamB", ls.home === "Vasco" && ls.away === "Fluminense");

  // An explicitly stored per-match home/away (ESPN sync writes these) must override the
  // positional default — otherwise a fixture ESPN reports with reversed venue renders wrong.
  const lm = legTeams(tie, "first", { homeTeam: "Fluminense", awayTeam: "Vasco" });
  check("explicit match.homeTeam/awayTeam overrides positional default", lm.home === "Fluminense" && lm.away === "Vasco");
}

// ── Fase 2.1 §3: mutação administrativa dirigida deve persistir por cima do estado remoto ───
// Cada teste abaixo: remoto começa com um valor ANTIGO, a gravação carrega a mutação explícita
// do admin, resultado esperado é o valor NOVO — provando que applyMutationOverRemote() não
// reaplica nenhuma regra de "remoto vence"/"any-true-wins" pensada pra proteger contra cache de
// PARTICIPANTE quando quem está gravando é o próprio admin corrigindo um dado.
{
  const saveRemoteState = makeSaveRemoteStateFactory();
  async function postedStateFor(remote, mutation) {
    let posted = null;
    const fn = saveRemoteState(async (url, opts) => {
      if (!opts || opts.method !== "POST") return { ok: true, json: async () => [{ state: remote }] };
      posted = JSON.parse(opts.body).state;
      return { ok: true, text: async () => "" };
    });
    await fn({}, { mutation });
    return posted;
  }

  // Resultado oficial (SCHEDULED sem placar -> FINAL 2x1)
  {
    const remote = { phases: { oitavas: { ties: { t1: { teamA: "Vasco", teamB: "Fluminense", matches: { single: { goalsHome: null, goalsAway: null, status: "SCHEDULED" } } } } } } };
    const match = { goalsHome: 2, goalsAway: 1, status: "FINAL", homeTeam: "Vasco", awayTeam: "Fluminense" };
    const p = await postedStateFor(remote, { type: "save-leg", phaseId: "oitavas", tieId: "t1", leg: "single", match });
    check("resultado oficial: SCHEDULED->FINAL 2x1 persiste", p.phases.oitavas.ties.t1.matches.single.goalsHome === 2 && p.phases.oitavas.ties.t1.matches.single.goalsAway === 1 && p.phases.oitavas.ties.t1.matches.single.status === "FINAL");
  }

  // Correção de resultado (FINAL 1x0 -> FINAL 2x1)
  {
    const remote = { phases: { oitavas: { ties: { t1: { teamA: "Vasco", teamB: "Fluminense", matches: { single: { goalsHome: 1, goalsAway: 0, status: "FINAL" } } } } } } };
    const match = { goalsHome: 2, goalsAway: 1, status: "FINAL" };
    const p = await postedStateFor(remote, { type: "save-leg", phaseId: "oitavas", tieId: "t1", leg: "single", match });
    check("correção de resultado: FINAL 1x0->FINAL 2x1 persiste", p.phases.oitavas.ties.t1.matches.single.goalsHome === 2 && p.phases.oitavas.ties.t1.matches.single.goalsAway === 1);
  }

  // Limpeza de resultado (FINAL 1x0 -> SCHEDULED, placar null)
  {
    const remote = { phases: { oitavas: { ties: { t1: { teamA: "Vasco", teamB: "Fluminense", matches: { single: { goalsHome: 1, goalsAway: 0, status: "FINAL" } } } } } } };
    const p = await postedStateFor(remote, { type: "clear-leg", phaseId: "oitavas", tieId: "t1", leg: "single" });
    const m = p.phases.oitavas.ties.t1.matches.single;
    check("limpeza de resultado: FINAL 1x0->SCHEDULED/null persiste", m.goalsHome === null && m.goalsAway === null && m.status === "SCHEDULED", `got ${JSON.stringify(m)}`);
  }

  // Classificado (qualifiedTeamId null -> "A")
  {
    const remote = { phases: { oitavas: { ties: { t1: { teamA: "Vasco", teamB: "Fluminense", qualifiedTeamId: null } } } } };
    const p = await postedStateFor(remote, { type: "lock-tie", phaseId: "oitavas", tieId: "t1", qualifiedTeamId: "A", lockedAt: "2026-08-01T00:00:00Z", lockedBy: "admin" });
    check("classificado: null->\"A\" persiste", p.phases.oitavas.ties.t1.qualifiedTeamId === "A", `got ${p.phases.oitavas.ties.t1.qualifiedTeamId}`);
  }

  // Destravamento (qualifiedTeamId "A" -> ausente)
  {
    const remote = { phases: { oitavas: { ties: { t1: { teamA: "Vasco", teamB: "Fluminense", qualifiedTeamId: "A", lockedAt: "x", lockedBy: "admin" } } } } };
    const p = await postedStateFor(remote, { type: "unlock-tie", phaseId: "oitavas", tieId: "t1" });
    check("destravamento: \"A\"->ausente persiste", !("qualifiedTeamId" in p.phases.oitavas.ties.t1), `got ${JSON.stringify(p.phases.oitavas.ties.t1)}`);
  }

  // Cutoff: null -> data
  {
    const remote = { phases: { oitavas: { cutoffAt: null, ties: {} } } };
    const p = await postedStateFor(remote, { type: "set-cutoff", phaseId: "oitavas", cutoffAt: "2026-08-01T20:00:00Z" });
    check("cutoff: null->data persiste", p.phases.oitavas.cutoffAt === "2026-08-01T20:00:00Z");
  }
  // Cutoff: data antiga -> data nova
  {
    const remote = { phases: { oitavas: { cutoffAt: "2026-08-01T10:00:00Z", ties: {} } } };
    const p = await postedStateFor(remote, { type: "set-cutoff", phaseId: "oitavas", cutoffAt: "2026-08-01T20:00:00Z" });
    check("cutoff: data antiga->data nova persiste", p.phases.oitavas.cutoffAt === "2026-08-01T20:00:00Z");
  }
  // Cutoff: data -> null
  {
    const remote = { phases: { oitavas: { cutoffAt: "2026-08-01T10:00:00Z", ties: {} } } };
    const p = await postedStateFor(remote, { type: "set-cutoff", phaseId: "oitavas", cutoffAt: null });
    check("cutoff: data->null persiste", p.phases.oitavas.cutoffAt === null, `got ${p.phases.oitavas.cutoffAt}`);
  }

  // Pagamento: false -> true
  {
    const remote = { paid: { e1: false }, phases: {} };
    const p = await postedStateFor(remote, { type: "set-payment", entryId: "e1", value: true });
    check("pagamento: false->true persiste", p.paid.e1 === true);
  }
  // Pagamento: true -> false — o caso que any-true-wins nunca deixava passar antes da Fase 2.1
  {
    const remote = { paid: { e1: true }, phases: {} };
    const p = await postedStateFor(remote, { type: "set-payment", entryId: "e1", value: false });
    check("pagamento: true->false persiste (mutação dirigida, não any-true-wins)", p.paid.e1 === false, `got ${p.paid.e1}`);
  }

  // Fase ESPN ativa: oitavas -> quartas
  {
    const remote = { espnSync: { activePhaseId: "oitavas" }, phases: {} };
    const p = await postedStateFor(remote, { type: "set-active-phase", phaseId: "quartas" });
    check("fase ESPN: oitavas->quartas persiste", p.espnSync.activePhaseId === "quartas", `got ${p.espnSync.activePhaseId}`);
  }

  // Preservação de alteração remota independente enquanto o admin corrige outro resultado
  {
    const remote = {
      entries: [{ id: "e-new", entryName: "nova entrada remota", createdAt: "2026-08-01T12:00:00Z" }],
      paid: { "e-other": true },
      auditLog: [{ ts: "2026-08-01T11:00:00Z", action: "toggle-paid", detail: { entryId: "e-other" } }],
      phases: { oitavas: { ties: { t1: { teamA: "Vasco", teamB: "Fluminense", matches: { single: { goalsHome: 1, goalsAway: 0, status: "FINAL" } } } } } },
    };
    const match = { goalsHome: 2, goalsAway: 1, status: "FINAL" };
    const p = await postedStateFor(remote, { type: "save-leg", phaseId: "oitavas", tieId: "t1", leg: "single", match });
    check("preservação: nova entrada remota sobrevive à mutação de outro admin", p.entries.some(e => e.id === "e-new"));
    check("preservação: outro pagamento remoto sobrevive", p.paid["e-other"] === true);
    check("preservação: audit events remotos sobrevivem", p.auditLog.some(ev => ev.ts === "2026-08-01T11:00:00Z"));
    check("preservação: a mutação em si também foi aplicada", p.phases.oitavas.ties.t1.matches.single.goalsHome === 2);
  }
}

// ── Fase 2.1 §3: batch de mutações ESPN aplica todas em sequência, uma gravação só ──────────
{
  const base = { phases: { oitavas: { ties: {} } } };
  const mutations = [
    { type: "espn-add-tie", phaseId: "oitavas", tieId: "t1", tie: { teamA: "A", teamB: "B", matches: {} } },
    { type: "espn-add-tie", phaseId: "oitavas", tieId: "t2", tie: { teamA: "C", teamB: "D", matches: {} } },
  ];
  const applied = applyAdminMutation(base, { type: "batch", mutations });
  check("batch: aplica múltiplas mutações ESPN numa gravação só", Object.keys(applied.phases.oitavas.ties).length === 2);
  check("batch: primeira mutação aplicada", applied.phases.oitavas.ties.t1.teamA === "A");
  check("batch: segunda mutação aplicada", applied.phases.oitavas.ties.t2.teamA === "C");
}

// ── Merge da Fase 2.1 (2026-08-01): cutoffOffsetMs sobrevive a uma mutação administrativa ────
// O hotfix ao vivo (f2f8512) só protegeu mergeStates() -- applyMutationOverRemote(), escrito
// DEPOIS naquele hotfix numa branch separada, reconstruía phases sem carregar cutoffOffsetMs
// junto, reintroduzindo o mesmo bug pelo caminho de mutação dirigida. Pego antes do deploy.
{
  const remote = {
    phases: {
      oitavas: { cutoffOffsetMs: 900000, ties: { t1: { teamA: "Vasco", teamB: "Fluminense", matches: {} } } },
      quartas: { cutoffOffsetMs: 1800000, ties: {} },
    },
  };
  // Mutação numa fase DIFERENTE de onde o override vive -- prova que a preservação não depende
  // de coincidência com o que está sendo mutado.
  const applied = applyMutationOverRemote({}, remote, { type: "set-active-phase", phaseId: "quartas" });
  check("mutação em outra fase preserva cutoffOffsetMs da fase não tocada", applied.phases.oitavas.cutoffOffsetMs === 900000, `got ${applied.phases.oitavas.cutoffOffsetMs}`);
  check("cutoffOffsetMs de mais de uma fase sobrevive simultaneamente", applied.phases.quartas.cutoffOffsetMs === 1800000, `got ${applied.phases.quartas.cutoffOffsetMs}`);

  // Mutação NA MESMA fase onde o override vive (ex.: travar um confronto da própria Oitavas).
  const applied2 = applyMutationOverRemote({}, remote, { type: "lock-tie", phaseId: "oitavas", tieId: "t1", qualifiedTeamId: "A", lockedAt: "x", lockedBy: "admin" });
  check("mutação na MESMA fase do override preserva cutoffOffsetMs", applied2.phases.oitavas.cutoffOffsetMs === 900000, `got ${applied2.phases.oitavas.cutoffOffsetMs}`);
  check("a mutação em si também foi aplicada (não é um no-op)", applied2.phases.oitavas.ties.t1.qualifiedTeamId === "A");
}

console.log("\n" + (failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ AUDIT FAILED — ${failures} check(s)`));
process.exit(failures === 0 ? 0 : 1);
