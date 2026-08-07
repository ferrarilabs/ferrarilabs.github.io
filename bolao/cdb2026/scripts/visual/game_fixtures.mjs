/**
 * game_fixtures.mjs — shared "Jogos" fixtures for the visual harness (PR120-final review item 5).
 *
 * Why this exists: `capture_evidence.mjs`'s screenshot of "Jogos" was not a valid cross-app
 * comparison before this file — Copa showed `notApplicable` (archived), BR2026 showed a bare
 * "carregando" placeholder (its games come from a live ESPN fetch this harness intentionally
 * blocks/mocks empty), and only CDB2026 had a real fixture, and even that fixture only covered
 * one state (a single scheduled leg). This module gives all three apps an EQUIVALENT synthetic
 * data set covering: agendado (scheduled), ao vivo (live), finalizado (final/score), adiado
 * (postponed), a long team name, and (CDB2026 only, its own tournament format) ida/volta/agregado
 * — reusing the exact same visual tokens each app already renders with, never inventing new CSS.
 *
 * Design notes per app (each app's OWN mechanism is used — no production code is modified):
 *
 * - BR2026: `renderGamesSection()` reads a module-level `_schedule` array that is populated from
 *   either a live ESPN fetch or a versioned sessionStorage cache
 *   (`br2026_schedule_<siteVersion>`, see `fetchSchedule()` in bolao/br2026/js/app.js). Seeding
 *   that sessionStorage key with an already-parsed event array (same shape `fetchSchedule()`
 *   itself produces) makes the app skip the network fetch entirely and render these fixture
 *   events as if they were real — every state (`pre`/`in`/`post`/`postponed`) is a plain data
 *   field on each event, so all of them are reachable with no need to fake a live poll.
 *
 * - CDB2026: `renderGamesSection()` reads confronto/tie data straight out of app state
 *   (`state().phases[phaseId].ties`), same as any other seeded fixture in this harness — covers
 *   agendado/finalizado/nome-longo/estádio/ida-volta-agregado with no network involved. "ao vivo"
 *   and "adiado", however, are NOT plain state fields here — they come from `fetchLiveTies()`
 *   matching a live ESPN scoreboard response against the ties' team names at runtime (see
 *   `bolao/cdb2026/js/app.js` around `fetchEspnCandidates()`/`fetchLiveTies()`). This module also
 *   exports a realistic (schema-accurate, fictional-content) ESPN scoreboard mock body for exactly
 *   two of the fixture's ties, so the app's OWN unmodified matching logic — not a special test
 *   branch — resolves them to "live"/"postponed", the same way a real ESPN response would.
 *
 * - Copa: archived (`CONFIG.archived`), tournament concluded 2026-07-19. It is not given a
 *   synthetic games fixture at all — the real (already public, already final) 2026 World Cup
 *   results are what render once the harness unhides the Jogos nav button in ITS OWN ephemeral
 *   browser context only (mirrors the existing Admin-unhide technique in
 *   `bolao/scripts/audit_visual_consistency.mjs`'s `archivedAdminNeedsUnhide`) — see
 *   `capture_evidence.mjs`'s `unhideJogosForCopaHarness` usage. Copa's Jogos view has no distinct
 *   "postponed" bucket at all (verified by reading `renderGames()` — `statusClass` only maps
 *   done/live/pending), and a real "ao vivo" state can never recur for a concluded tournament — both
 *   are therefore genuinely N/A for Copa, not a gap in this fixture.
 */

// Long, but deliberately NOT matching any real entry in DATA.teamLogos. Two earlier attempts at
// this fixture used a real team's full legal name ("Grêmio Foot-Ball Porto Alegrense", 33 chars,
// and an even longer fictional confederation name, ~58 chars) and BOTH reproduced a genuine
// `.confronto-header` rendering artifact at 768px in the fullPage screenshot (text wrapping one
// character per line) — confirmed via isolated repro (see this branch's session notes) to be a
// Chromium fullPage-screenshot-capture-time artifact, NOT a real CSS bug: reading
// `getBoundingClientRect()` on the exact same element immediately AFTER the screenshot is taken
// shows a completely normal single-line 710px box, and the SAME long text renders correctly
// (wraps normally by word, no per-character breakage) once the team name does NOT resolve to a
// real `<img class="match-logo">` via `teamLogoImg()` — i.e. the artifact needs BOTH a long name
// AND a matched real logo image to reproduce, a combination that does not occur in real
// production data (every real team name in DATA.knownConfrontos is short, e.g. "Atlético-MG",
// "Corinthians"). Kept as a fictional (no-logo) name here so the fixture still validates the real
// "long name" CSS wrapping design token without exercising that unrelated capture-engine quirk.
export const LONG_TEAM_NAME_BR = "Associação Recreativa Fictícia";
export const LONG_TEAM_NAME_CDB = "Confederação Fictícia Regional";

// ── BR2026 ───────────────────────────────────────────────────────────────────────────────────
// Final, already-parsed `_schedule` event shape (see fetchSchedule() in bolao/br2026/js/app.js) —
// no ESPN mock needed, this is exactly the shape the app caches and reads directly.
export function br2026ScheduleFixture(baseIso = "2026-08-10T00:00:00.000Z") {
  const at = (offsetDays, hh = 20, mm = 0) => {
    const dt = new Date(baseIso);
    dt.setUTCDate(dt.getUTCDate() + offsetDays);
    dt.setUTCHours(hh, mm, 0, 0);
    return dt.toISOString();
  };
  return [
    // agendado
    { id: "fx-g1", dateISO: at(2), state: "pre", detail: "", postponed: false, homeTeam: "Time A", awayTeam: "Time B", homeScore: null, awayScore: null, venue: "Estádio Teste A", city: "Cidade Teste A" },
    // ao vivo (placar + badge)
    { id: "fx-g2", dateISO: at(0, 16, 0), state: "in", detail: "45'", postponed: false, homeTeam: "Time C", awayTeam: "Time D", homeScore: 1, awayScore: 0, venue: "Estádio Teste B", city: "Cidade Teste B" },
    // finalizado (placar)
    { id: "fx-g3", dateISO: at(-1), state: "post", detail: "", postponed: false, homeTeam: "Time E", awayTeam: "Time F", homeScore: 2, awayScore: 2, venue: "Estádio Teste C", city: "Cidade Teste C" },
    // adiado
    { id: "fx-g4", dateISO: at(3), state: "pre", detail: "", postponed: true, homeTeam: "Time G", awayTeam: "Time H", homeScore: null, awayScore: null, venue: "Estádio Teste D", city: "Cidade Teste D" },
    // nome longo
    { id: "fx-g5", dateISO: at(4), state: "pre", detail: "", postponed: false, homeTeam: LONG_TEAM_NAME_BR, awayTeam: "Time I", homeScore: null, awayScore: null, venue: "Estádio Teste E", city: "Cidade Teste E" },
  ];
}

// Seeds BR2026's own versioned sessionStorage schedule cache — must run AFTER the page has
// loaded (needs `window` and, if the caller wants the cache key to match exactly, the app's own
// siteVersion) but BEFORE the reload that lets the app's init() pick it up, same pattern used for
// the localStorage fixture seed elsewhere in this harness.
export async function seedBr2026Schedule(page, siteVersion) {
  const events = br2026ScheduleFixture();
  await page.evaluate(({ key, events }) => {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), events }));
  }, { key: `br2026_schedule_${siteVersion}`, events });
}

// ── CDB2026 ──────────────────────────────────────────────────────────────────────────────────
function emptyMatch() {
  return { homeTeam: null, awayTeam: null, kickoff: null, venue: null, city: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" };
}

// Merges into the existing minimal fixture's `phases` — superset, not a replacement, so any
// existing assertion about fx-t1/fx-f1 (kept unchanged below) keeps working.
export function cdb2026TiesFixture() {
  return {
    oitavas: {
      cutoffAt: null,
      ties: {
        // agendado (unchanged from the original minimal fixture)
        "fx-t1": { teamA: "Time A", teamB: "Time B", matches: {
          first: { ...emptyMatch(), kickoff: "2030-08-01T20:30:00.000Z" },
          second: emptyMatch(),
        } },
        // finalizado / placar / agregado (ida+volta both played — TWO_LEG format).
        // Kickoffs deliberately in the FIXTURE'S future (2030), not the narrative past a real
        // finished match would have — `effectivePhaseCutoffMs()` (bolao/cdb2026/js/app.js) derives
        // the phase's entry cutoff from the EARLIEST known kickoff across every tie in the active
        // phase, not per-tie, so a past-dated "already played" fixture tie here would drag the
        // whole phase's cutoff into the past and disable the Palpites nav button as a side effect
        // (found while building this fixture — Palpites started failing with "element is not
        // enabled" once this tie existed with real-past dates; fixed by keeping every synthetic
        // date in this fixture in the future, same convention fx-t1/fx-f1 already used).
        "fx-t2": { teamA: "Time C", teamB: "Time D", qualifiedTeamId: "A", matches: {
          first:  { ...emptyMatch(), kickoff: "2030-07-01T20:00:00.000Z", venue: "Estádio Teste C", city: "Cidade Teste C", goalsHome: 2, goalsAway: 1, status: "FINAL" },
          second: { ...emptyMatch(), kickoff: "2030-07-08T20:00:00.000Z", venue: "Estádio Teste D", city: "Cidade Teste D", goalsHome: 1, goalsAway: 1, status: "FINAL" },
        } },
        // nome longo + estádio. Venue/city kept realistically sized (comparable to real venue
        // strings elsewhere in this fixture, e.g. "Estádio Teste F, Cidade Teste F") rather than
        // artificially long — combining an already-wrapping long team name with an ALSO very long
        // venue+city string (an earlier ~74-char version, kept only in git history) was confirmed
        // to trigger a Chromium fullPage-screenshot-capture-time rendering artifact (the row's
        // CSS Grid `.leg-teams` 1fr column rendering with characters stacked one per line in the
        // OUTPUT IMAGE only — a live `getBoundingClientRect()` read immediately after the same
        // screenshot shows a completely normal box), not a real CSS bug. Realistic-length venue
        // strings avoid the artifact entirely while the team name alone still validates real
        // "nome longo" wrapping.
        "fx-t3": { teamA: LONG_TEAM_NAME_CDB, teamB: "Time E", matches: {
          first: { ...emptyMatch(), kickoff: "2030-08-15T19:00:00.000Z", venue: "Estádio Fictício", city: "Cidade Extensa" },
          second: emptyMatch(),
        } },
        // adiado (resolved via the ESPN mock below matching Time F x Time G as postponed).
        // Kickoff bumped from 2026-08-05 to 2031 (phase 7, real Playwright capture pass):
        // ESPN-mock resolution matches by TEAM NAME only (routeCdb2026Espn() below), never by
        // this date, so moving it doesn't touch the postponed/live behavior being tested. The
        // original 2026-08-05 date was itself already "keep it near-future" per the fx-t2
        // comment's own stated convention -- it just didn't account for the fixture being run
        // on-or-after that exact date, at which point `firstKnownKickoffMs()`
        // (bolao/cdb2026/js/app.js) picks it up as the phase's EARLIEST known kickoff and
        // `effectivePhaseCutoffMs()` computes a cutoff 1h before it -- so once "today" reached
        // 2026-08-04 (this sandbox's simulated date), fx-t5's same-day kickoff below put the
        // whole "oitavas" phase's cutoff in the past, silently closing Palpites and defaulting
        // the app to Ranking on load (confirmed via a real Playwright probe: nav shows
        // "Palpites" but the app boots into the "ranking" section). Same root cause the fx-t2
        // comment already warned about, just with a shorter fuse. Both fx-t4/fx-t5 moved to
        // 2031 (matching the rest of this fixture's already-future-dated ties) so this doesn't
        // recur for a long time; a fully date-proof fix (compute relative to Date.now() instead
        // of a fixed year) is a reasonable future improvement but out of scope for this pass.
        "fx-t4": { teamA: "Time F", teamB: "Time G", matches: {
          first: { ...emptyMatch(), kickoff: "2031-08-05T20:00:00.000Z", venue: "Estádio Teste F", city: "Cidade Teste F" },
          second: emptyMatch(),
        } },
        // ao vivo (resolved via the ESPN mock below matching Time H x Time I as in-progress)
        "fx-t5": { teamA: "Time H", teamB: "Time I", matches: {
          first: { ...emptyMatch(), kickoff: "2031-08-04T20:00:00.000Z", venue: "Estádio Teste H", city: "Cidade Teste H" },
          second: emptyMatch(),
        } },
      },
    },
    // single-match format (Final), kept from the original minimal fixture unchanged.
    final: { cutoffAt: null, ties: { "fx-f1": { teamA: "Time A", teamB: "Time C", matches: { single: { ...emptyMatch(), kickoff: "2030-11-01T22:00:00.000Z" } } } } },
  };
}

// Realistic (schema-accurate, fictional-content) ESPN scoreboard events — resolved by the app's
// OWN unmodified fetchEspnCandidates()/fetchLiveTies() matching logic (bolao/cdb2026/js/app.js),
// not a special test code path. `fx-t4` (Time F x Time G) resolves to "postponed" via
// `state:"post" && completed:false` (exactly the signal isLegPostponed() checks for); `fx-t5`
// (Time H x Time I) resolves to "live" via `state:"in"`.
export function cdb2026EspnScoreboardMock() {
  return {
    events: [
      {
        id: "9004",
        competitions: [{
          status: { type: { state: "post", completed: false, name: "STATUS_POSTPONED", description: "Postponed", shortDetail: "Adiado", detail: "" } },
          competitors: [
            { homeAway: "home", team: { displayName: "Time F" }, score: null },
            { homeAway: "away", team: { displayName: "Time G" }, score: null },
          ],
          venue: { fullName: "Estádio Teste F", address: { city: "Cidade Teste F" } },
        }],
      },
      {
        id: "9005",
        competitions: [{
          status: { type: { state: "in", completed: false, name: "STATUS_IN_PROGRESS", description: "In Progress", shortDetail: "", detail: "" }, clock: 2700, period: 2 },
          competitors: [
            { homeAway: "home", team: { displayName: "Time H" }, score: "1" },
            { homeAway: "away", team: { displayName: "Time I" }, score: "0" },
          ],
          venue: { fullName: "Estádio Teste H", address: { city: "Cidade Teste H" } },
        }],
      },
    ],
  };
}

// Registers the ESPN route for CDB2026 specifically — branches on path (scoreboard vs the
// per-event "summary" endpoint `fetchEspnEventSummary()` calls for live matches' play-by-play,
// which this mock intentionally returns empty for: extractMatchPlays() already handles "no plays"
// gracefully, and the play-by-play feed itself is out of scope for a static-card visual
// comparison). Must be registered on the CONTEXT before navigation, same as the other app-agnostic
// routes this harness already installs.
// ATUALIZADO em 2026-08-07 (migração para o snapshot): o CDB2026 não chama mais
// site.api.espn.com — ele lê `data/espn-normalized.json`. Um mock que continuasse interceptando só
// a ESPN teria virado fixture MORTA: nada falharia, mas os estados ao vivo/adiado que este mock
// existe para exercitar deixariam de ser exercitados em silêncio, e a suíte passaria dando a
// impressão de cobertura que não existe mais.
//
// Agora intercepta o SNAPSHOT e converte o mock de scoreboard da ESPN para a forma normalizada
// (`{schemaVersion, matches[]}`) — a mesma conversão que espn_provider.normalize_scoreboard() faz
// server-side. A rota da ESPN é mantida por segurança: se algum app voltar a chamar a ESPN direto,
// este mock responde em vez de deixar escapar uma requisição real de rede num teste.
function cdb2026NormalizedSnapshotMock() {
  const raw = cdb2026EspnScoreboardMock();
  const matches = (raw.events || []).map((ev) => {
    const comp = (ev.competitions || [{}])[0];
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === "home") || cs[0] || {};
    const away = cs.find((c) => c.homeAway === "away") || cs[1] || {};
    const st = (comp.status || {}).type || {};
    return {
      id: ev.id,
      date: ev.date,
      state: st.state,
      statusName: st.name,
      statusDescription: st.description,
      statusShortDetail: st.shortDetail,
      statusDetail: st.detail,
      completed: st.completed,
      homeTeam: (home.team || {}).displayName || "",
      awayTeam: (away.team || {}).displayName || "",
      homeTeamId: (home.team || {}).id,
      awayTeamId: (away.team || {}).id,
      homeScore: home.score,
      awayScore: away.score,
      homeWinner: home.winner,
      awayWinner: away.winner,
      venue: ((comp.venue || {}).fullName) || null,
      city: (((comp.venue || {}).address) || {}).city || null,
      clockSec: typeof (comp.status || {}).clock === "number" ? comp.status.clock : null,
      clockStr: (comp.status || {}).displayClock || "",
      period: typeof (comp.status || {}).period === "number" ? comp.status.period : null,
      details: Array.isArray(comp.details) ? comp.details : [],
    };
  });
  return {
    schemaVersion: 1,
    competitionId: "bra.copa_do_brazil",
    provider: "espn",
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    stale: false,
    staleReason: null,
    payloadHash: "fixture",
    matches,
  };
}

export async function routeCdb2026Espn(context) {
  const snapshot = cdb2026NormalizedSnapshotMock();
  await context.route("**/data/espn-normalized.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) }));
  // Rede de segurança: nenhuma requisição real à ESPN deve escapar de um teste.
  await context.route("**://site.api.espn.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [], keyEvents: [] }) }));
}

// ── Copa (archived) ──────────────────────────────────────────────────────────────────────────
// No fixture — see file header. Just the harness-only nav-unhide, mirroring
// `audit_visual_consistency.mjs`'s `archivedAdminNeedsUnhide` for the Admin section. Never
// touches `applyArchiveMode()`/`CONFIG.archived` — only removes a `.hidden` class from one nav
// button in THIS ephemeral Playwright page, so a real visitor's archived experience is unaffected.
export async function unhideCopaJogosForHarness(page) {
  await page.evaluate(() => document.querySelector('[data-section="games"]')?.classList.remove("hidden"));
}
