/**
 * fixture.mjs — canonical forensic-visual fixture (forensic visual parity audit, 2026-08-04).
 *
 * Single source of truth for the EXACT literal text/numbers used across all three apps in this
 * audit, verbatim from the task spec. Every app renders this same content through its OWN real
 * rendering pipeline (renderGamesSection()/renderRanking()) -- no app's production code is
 * modified; only the fixture DATA each app already supports overriding is set to these values.
 *
 * Copa is a special case: its Jogos view renders DATA.groupMatches (real, hardcoded 2026 World
 * Cup results -- the tournament is concluded, CONFIG.archived is true) and has no fixture
 * injection point of its own for game data (see game_fixtures.mjs's file header: "no fixture at
 * all -- the real ... results are what render"). To get a "pre" (scheduled, no score yet) row
 * out of an app whose entire real dataset is final scores, this module intercepts js/data.js's
 * network response (see copaDataOverrideScript() / installCopaDataOverride() below) and APPENDS
 * (does not replace) a small in-page patch that overwrites two real match objects' fields with
 * this fixture's canonical text -- same technique class as SYNTHETIC_BUTTON_TEXT in
 * audit_visual_consistency.mjs (harness-only, never touches the file on disk, never touches
 * applyArchiveMode()/CONFIG.archived). Copa has no "live" simulation available post-tournament
 * (ESPN-runtime-only mechanism, and the module-scoped `_liveScores` var is not reachable from
 * outside app.js's IIFE) and no distinct "postponed" CSS state at all (verified: .status-chip
 * only has done/pending/live -- see FINDINGS.md this audit produces) -- both are therefore
 * genuine, permanent N/A for Copa, not a gap this fixture works around.
 */

// ── Canonical text (verbatim from the forensic audit spec) ────────────────────────────────────
export const GAMES = {
  homeShort: "Brasil",
  awayShort: "Japão",
  homeLong: "Associação Atlética Internacional",
  awayLong: "Clube Atlético Mineiro de Belo Horizonte",
  dateLabel: "15 AGO",
  timeLabel: "8:30 PM ET",
  venue: "Estádio Internacional de Testes",
  scores: { scoreless: [0, 0], oneNil: [1, 0], drawHigh: [2, 2], blowout: [12, 11] },
  aggregate: "3 × 2",
  advances: "Brasil",
};

// CDB2026's live/postponed detection matches an ESPN scoreboard mock by TEAM NAME, not by tie id
// (fetchLiveTies()/isLegPostponed(), bolao/cdb2026/js/app.js) -- giving every state the exact same
// "Brasil"/"Japão" pair (as first attempted here) made the "pre" tie's own ESPN lookup collide
// with the "postponed"/"live" mock events and get silently reclassified as postponed, confirmed by
// a live capture showing a "pre"-intended tie rendered with class "leg postponed". Each state below
// gets its own short, comparable-length pair instead -- "Brasil"/"Japão" is still the literal pair
// used for the pre/scheduled state (closest to the spec's literal example), post/live/postponed use
// distinct pairs so ESPN name-matching can never cross-contaminate between states. Applied
// identically to BR2026 and CDB2026 for the same state so cross-app text stays comparable per
// state -- only the mapping from STATE to name pair had to become non-uniform, not the principle.
export const GAMES_BY_STATE = {
  pre: { home: "Brasil", away: "Japão" },
  post: { home: "França", away: "Coreia do Sul" },
  live: { home: "México", away: "Canadá" },
  postponed: { home: "Nigéria", away: "Uruguai" },
};

export const RANKING = [
  { pos: 1, name: "Eduardo Ferrari #1", points: 176 },
  { pos: 2, name: "Nome Médio de Participante", points: 158 },
  { pos: 3, name: "Participante com Nome Extremamente Longo para Teste", points: 148 },
  { pos: 3, name: "Outro Participante Empatado", points: 148 },
  { pos: 10, name: "Participante Décima Posição", points: 135 },
  { pos: 99, name: "Participante Posição Longa", points: 12 },
];

// Fictional ids -- never collide with real entries, never a real name/email.
export function forensicRankingEntries() {
  return RANKING.map((r, i) => ({
    id: `forensic-${i + 1}`,
    entryName: r.name,
    payerName: r.name,
    participantEmail: `forensic${i + 1}@example.invalid`,
    paymentMethod: "CashApp",
    picks: {},
    _forensicPoints: r.points, // consumed by the per-app score override below, not real scoring
  }));
}

// ── BR2026 games fixture (real _schedule cache shape, see game_fixtures.mjs for the mechanism
// this reuses -- br2026_schedule_<siteVersion> sessionStorage key) ────────────────────────────
export function br2026ForensicSchedule(baseIso = "2026-08-15T00:00:00.000Z") {
  const at = (offsetDays, hh, mm = 0) => {
    const dt = new Date(baseIso);
    dt.setUTCDate(dt.getUTCDate() + offsetDays);
    dt.setUTCHours(hh, mm, 0, 0);
    return dt.toISOString();
  };
  const base = { venue: GAMES.venue, city: "" };
  return [
    { id: "fx-pre", dateISO: at(2, 20, 30), state: "pre", detail: "", postponed: false, homeTeam: GAMES_BY_STATE.pre.home, awayTeam: GAMES_BY_STATE.pre.away, homeScore: null, awayScore: null, ...base },
    { id: "fx-live", dateISO: at(0, 16, 0), state: "in", detail: "45'", postponed: false, homeTeam: GAMES_BY_STATE.live.home, awayTeam: GAMES_BY_STATE.live.away, homeScore: GAMES.scores.oneNil[0], awayScore: GAMES.scores.oneNil[1], ...base },
    { id: "fx-post", dateISO: at(-1, 20, 30), state: "post", detail: "", postponed: false, homeTeam: GAMES_BY_STATE.post.home, awayTeam: GAMES_BY_STATE.post.away, homeScore: GAMES.scores.drawHigh[0], awayScore: GAMES.scores.drawHigh[1], ...base },
    { id: "fx-postponed", dateISO: at(3, 20, 30), state: "pre", detail: "", postponed: true, homeTeam: GAMES_BY_STATE.postponed.home, awayTeam: GAMES_BY_STATE.postponed.away, homeScore: null, awayScore: null, ...base },
    { id: "fx-longnames", dateISO: at(4, 20, 30), state: "pre", detail: "", postponed: false, homeTeam: GAMES.homeLong, awayTeam: GAMES.awayLong, homeScore: null, awayScore: null, ...base },
    { id: "fx-blowout", dateISO: at(-2, 20, 30), state: "post", detail: "", postponed: false, homeTeam: GAMES_BY_STATE.post.home, awayTeam: GAMES_BY_STATE.post.away, homeScore: GAMES.scores.blowout[0], awayScore: GAMES.scores.blowout[1], ...base },
  ];
}

export async function seedBr2026ForensicSchedule(page, siteVersion) {
  const events = br2026ForensicSchedule();
  await page.evaluate(({ key, events }) => {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), events }));
  }, { key: `br2026_schedule_${siteVersion}`, events });
}

// ── CDB2026 ties fixture (real state.phases shape) ─────────────────────────────────────────────
function emptyMatch() {
  return { homeTeam: null, awayTeam: null, kickoff: null, venue: null, city: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" };
}

export function cdb2026ForensicTies() {
  return {
    oitavas: {
      cutoffAt: null,
      ties: {
        "fx-pre": { teamA: GAMES_BY_STATE.pre.home, teamB: GAMES_BY_STATE.pre.away, matches: {
          first: { ...emptyMatch(), kickoff: "2030-08-01T20:30:00.000Z", venue: GAMES.venue, city: "" },
          second: emptyMatch(),
        } },
        "fx-post": { teamA: GAMES_BY_STATE.post.home, teamB: GAMES_BY_STATE.post.away, qualifiedTeamId: "A", matches: {
          first:  { ...emptyMatch(), kickoff: "2030-07-01T20:00:00.000Z", venue: GAMES.venue, city: "", goalsHome: GAMES.scores.drawHigh[0], goalsAway: GAMES.scores.drawHigh[1], status: "FINAL" },
          second: { ...emptyMatch(), kickoff: "2030-07-08T20:00:00.000Z", venue: GAMES.venue, city: "", goalsHome: 1, goalsAway: 1, status: "FINAL" },
        } },
        "fx-longnames": { teamA: GAMES.homeLong, teamB: GAMES.awayLong, matches: {
          first: { ...emptyMatch(), kickoff: "2030-08-15T19:00:00.000Z", venue: GAMES.venue, city: "" },
          second: emptyMatch(),
        } },
        "fx-postponed": { teamA: GAMES_BY_STATE.postponed.home, teamB: GAMES_BY_STATE.postponed.away, matches: {
          first: { ...emptyMatch(), kickoff: "2026-08-05T20:00:00.000Z", venue: GAMES.venue, city: "" },
          second: emptyMatch(),
        } },
        "fx-live": { teamA: GAMES_BY_STATE.live.home, teamB: GAMES_BY_STATE.live.away, matches: {
          first: { ...emptyMatch(), kickoff: "2026-08-04T20:00:00.000Z", venue: GAMES.venue, city: "" },
          second: emptyMatch(),
        } },
      },
    },
    final: { cutoffAt: null, ties: { "fx-f1": { teamA: GAMES_BY_STATE.pre.home, teamB: GAMES_BY_STATE.pre.away, matches: { single: { ...emptyMatch(), kickoff: "2030-11-01T22:00:00.000Z" } } } } },
  };
}

export function cdb2026ForensicEspnMock() {
  return {
    events: [
      {
        id: "fx-postponed-espn",
        competitions: [{
          status: { type: { state: "post", completed: false, name: "STATUS_POSTPONED", description: "Postponed", shortDetail: "Adiado", detail: "" } },
          competitors: [
            { homeAway: "home", team: { displayName: GAMES_BY_STATE.postponed.home } },
            { homeAway: "away", team: { displayName: GAMES_BY_STATE.postponed.away } },
          ],
          venue: { fullName: GAMES.venue, address: { city: "" } },
        }],
      },
      {
        id: "fx-live-espn",
        competitions: [{
          status: { type: { state: "in", completed: false, name: "STATUS_IN_PROGRESS", description: "In Progress", shortDetail: "", detail: "" }, clock: 2700, period: 2 },
          competitors: [
            { homeAway: "home", team: { displayName: GAMES_BY_STATE.live.home }, score: String(GAMES.scores.oneNil[0]) },
            { homeAway: "away", team: { displayName: GAMES_BY_STATE.live.away }, score: String(GAMES.scores.oneNil[1]) },
          ],
          venue: { fullName: GAMES.venue, address: { city: "" } },
        }],
      },
    ],
  };
}

// Each state's ESPN mock event uses that state's OWN dedicated team-name pair (GAMES_BY_STATE) --
// an earlier version of this fixture used the same "Brasil"/"Japão" pair for every tie and hit a
// real bug: CDB2026's fetchLiveTies()/isLegPostponed() match ESPN events by team NAME, not tie id,
// so the "pre" tie's own lookup collided with the postponed mock event and silently got
// reclassified as postponed (confirmed via a live capture -- the "pre"-intended tie rendered with
// class "leg postponed"). Distinct name pairs per state eliminate the collision entirely.
export async function routeCdb2026ForensicEspn(context) {
  const body = cdb2026ForensicEspnMock();
  await context.route("**://site.api.espn.com/**", (route) => {
    const url = route.request().url();
    if (/\/summary(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keyEvents: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

// ── Copa: patch two real DATA.groupMatches entries in place (see file header) ─────────────────
// Registers a route on js/data.js that appends an in-page patch to the end of the real file body
// -- the real data.js content is untouched on disk and still runs first; this only OVERWRITES two
// already-existing match objects' fields after window.BOLAO_DATA exists, using the exact same
// canonical text as the other two apps. Never touches CONFIG.archived or applyArchiveMode().
export async function installCopaForensicDataOverride(context, rootDir) {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const originalPath = join(rootDir, "bolao", "copa2026", "js", "data.js");
  const original = readFileSync(originalPath, "utf8");
  const patch = `
// ── forensic visual parity audit patch (harness-only, never written to disk) ──────────────────
(function () {
  var gm = window.BOLAO_DATA.groupMatches;
  if (!gm || !gm.length) return;
  Object.assign(gm[0], {
    teamA: ${JSON.stringify(GAMES_BY_STATE.pre.home)}, teamB: ${JSON.stringify(GAMES_BY_STATE.pre.away)},
    goalsA: undefined, goalsB: undefined, winner: undefined, status: "Pending",
    date: "2026-08-15", timeET: ${JSON.stringify(GAMES.timeLabel)}, venue: ${JSON.stringify(GAMES.venue)},
  });
  Object.assign(gm[1], {
    teamA: ${JSON.stringify(GAMES_BY_STATE.post.home)}, teamB: ${JSON.stringify(GAMES_BY_STATE.post.away)},
    goalsA: ${GAMES.scores.drawHigh[0]}, goalsB: ${GAMES.scores.drawHigh[1]}, winner: "Empate", status: "Final",
    date: "2026-08-14", timeET: "", venue: ${JSON.stringify(GAMES.venue)},
  });
  if (gm[2]) Object.assign(gm[2], {
    teamA: ${JSON.stringify(GAMES.homeLong)}, teamB: ${JSON.stringify(GAMES.awayLong)},
    goalsA: undefined, goalsB: undefined, winner: undefined, status: "Pending",
    date: "2026-08-16", timeET: ${JSON.stringify(GAMES.timeLabel)}, venue: ${JSON.stringify(GAMES.venue)},
  });
})();
`;
  await context.route("**/copa2026/js/data.js", (route) => {
    route.fulfill({ status: 200, contentType: "application/javascript", body: original + patch });
  });
}

// ── Ranking fixture (real state.entries -- entryName is seeded directly and needs no override,
// every app reads it identically) ──────────────────────────────────────────────────────────────
export function forensicRankingState(baseState) {
  return {
    ...baseState,
    entries: forensicRankingEntries(),
    paid: Object.fromEntries(forensicRankingEntries().map((e, i) => [e.id, i % 2 === 0])),
  };
}

// Real per-app scoring (scoreEntry()/rankEntries()) is a different formula in each app by design
// (CLAUDE.md: tournament-specific scoring must never be generalized) and is already exhaustively
// covered by each app's own audit_scoring.py -- reverse-engineering picks that happen to total
// exactly 176/158/148/148/135/12 in three unrelated formulas would test nothing this audit cares
// about (visual token rendering) and would silently start testing scoring correctness instead,
// out of scope here and expressly forbidden ("nunca alterar scoring... sem autorização explícita").
// The fixture's position/points numbers are illustrative display labels (the task's own ranking
// table is not a real leaderboard -- it includes non-sequential jumps like 3,3,10,99 on purpose,
// to exercise wrapping/spacing, not real rank math). Overridden as literal text post-render via
// the data-visual-role markers, same technique class as SYNTHETIC_BUTTON_TEXT in
// audit_visual_consistency.mjs -- entryName/order come from the real render (real DOM structure,
// real CSS classes, real medal logic verified against each app's own {1:"🥇",2:"🥈",3:"🥉"} map),
// only the point/position NUMBER is overlaid.
export async function overrideRankingText(page) {
  await page.evaluate((ranking) => {
    const rows = document.querySelectorAll('[data-visual-role="ranking-row"]');
    ranking.forEach((r, i) => {
      const row = rows[i];
      if (!row) return;
      const posEl = row.querySelector('[data-visual-role="ranking-position"]');
      const ptsEl = row.querySelector('[data-visual-role="ranking-points"]');
      if (posEl) {
        const medal = { 1: "🥇", 2: "🥈", 3: "🥉" }[r.pos] || String(r.pos);
        // Preserve any movement-arrow element already rendered after the medal/number text node
        // (rankMovementHtml() output) -- only the leading text/medal changes, not sibling markup.
        const firstChild = posEl.firstChild;
        if (firstChild && firstChild.nodeType === Node.TEXT_NODE) firstChild.textContent = medal;
        else posEl.insertBefore(document.createTextNode(medal), posEl.firstChild);
      }
      if (ptsEl) ptsEl.textContent = String(r.points);
    });
  }, RANKING);
}
