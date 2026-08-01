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
  ${extractFn("mergeStates")}
  ${extractFn("legTeams")}
  return { mergeStates, legTeams };
`;
const { mergeStates, legTeams } = new Function(harness)();

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
  const saveRemoteState = (() => {
    const body = `
      const DATA = { phases: [{ id: "oitavas" }] };
      function emptyPhaseState() { return { cutoffAt: null, ties: {} }; }
      const C = { siteVersion: "test", storeKey: "k",
        database: { enabled: true, url: "http://x", anonKey: "a", table: "t", stateId: "cdb2026" } };
      const localStorage = { setItem: () => {}, getItem: () => null };
      const console = { warn: () => {} };
      async function fetchJson(u, o) { return fetchImpl(u, o); }
      ${extractFn("mergeStates")}
      ${extractFn("saveRemoteState")}
      return saveRemoteState;`;
    return fetchImpl => new Function("fetchImpl", body)(fetchImpl);
  })();

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

console.log("\n" + (failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ AUDIT FAILED — ${failures} check(s)`));
process.exit(failures === 0 ? 0 : 1);
