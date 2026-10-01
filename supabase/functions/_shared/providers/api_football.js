/**
 * Adaptador API-Football (api-sports.io v3) → partida CANÔNICA (a mesma forma que a ESPN produz).
 *
 * ─── O CONTRATO NÃO MUDA ────────────────────────────────────────────────────────────────────
 * Os consumidores (gateway, football_live_store.js, heróis, pontuação ao vivo) conhecem o objeto
 * canônico: `id`, `state` ('pre'|'in'|'post'), `statusName`, `completed`, `homeTeam/awayTeam`,
 * `homeTeamId/awayTeamId`, `homeScore/awayScore`, `clockSec/clockStr/period`, `details[]`...
 * Este módulo é a ÚNICA fronteira que conhece o vocabulário da API-Football.
 *
 * ─── IDENTIDADE ─────────────────────────────────────────────────────────────────────────────
 * Os apps casam a observação ao calendário por `id` (hoje: id do evento ESPN no snapshot
 * commitado). Um id da API-Football seria um id novo e quebraria o casamento. Por isso cada fixture
 * da API-Football é RESOLVIDA para a partida do calendário canônico — que fornece `id`, nomes e
 * ids de time — e só os FATOS ao vivo (placar, estado, minuto, lances) vêm da API-Football.
 * Casamento CONSERVADOR: duas equipes + data próxima, sem ambiguidade; senão a fixture é descartada
 * e reportada em `unmapped` (preferimos não atualizar a atribuir o placar à partida errada).
 * `identityMap` (fixtureId → id canônico) tem prioridade e dá estabilidade depois de verificado.
 *
 * ─── O QUE AINDA É HIPÓTESE ─────────────────────────────────────────────────────────────────
 * O esquema aqui segue a API-Football v3 como documentada publicamente, MAS a documentação oficial
 * não pôde ser lida na sessão em que isto foi escrito (HTTP 403 pelo proxy) e não há credencial.
 * Os testes usam fixtures SINTÉTICAS. Os ids de liga abaixo estão marcados UNVERIFIED e DEVEM ser
 * confirmados (`GET /leagues`) e uma resposta real do plano Free comparada ao adaptador antes de
 * qualquer cutover — ver docs/private-repo-migration/actions/API_FOOTBALL_PROVIDER_ASSESSMENT.md.
 */

export const PROVIDER_ID = "api_football";
export const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

/** UNVERIFIED: ids/temporada precisam ser confirmados com `GET /leagues?country=Brazil&season=2026`. */
export const LEAGUES = Object.freeze({
  br2026: Object.freeze({ leagueId: 71, season: 2026 }),
  cdb2026: Object.freeze({ leagueId: 73, season: 2026 }),
});

/** short code da API-Football → vocabulário canônico (o mesmo que o snapshot da ESPN usa). */
const S = (state, statusName, description, completed, period = null) => ({ state, statusName, description, completed, period });
export const STATUS_MAP = Object.freeze({
  TBD: S("pre", "STATUS_SCHEDULED", "Scheduled", false),
  NS: S("pre", "STATUS_SCHEDULED", "Scheduled", false),
  "1H": S("in", "STATUS_FIRST_HALF", "First Half", false, 1),
  HT: S("in", "STATUS_HALFTIME", "Halftime", false, 1),
  "2H": S("in", "STATUS_SECOND_HALF", "Second Half", false, 2),
  ET: S("in", "STATUS_FIRST_HALF_EXTRA_TIME", "Extra Time", false, 3),
  BT: S("in", "STATUS_END_OF_REGULATION", "Break Time", false, 2),
  P: S("in", "STATUS_SHOOTOUT", "Penalty Shootout", false, 5),
  LIVE: S("in", "STATUS_IN_PROGRESS", "In Progress", false),
  INT: S("in", "STATUS_DELAYED", "Interrupted", false),
  SUSP: S("post", "STATUS_SUSPENDED", "Suspended", false),
  FT: S("post", "STATUS_FULL_TIME", "Full Time", true, 2),
  AET: S("post", "STATUS_FINAL_AET", "Full Time (AET)", true, 4),
  PEN: S("post", "STATUS_FINAL_PEN", "Full Time (Penalties)", true, 5),
  AWD: S("post", "STATUS_FORFEIT", "Technical Loss Awarded", true),
  WO: S("post", "STATUS_FORFEIT", "Walkover", true),
  // Mesma convenção do snapshot da ESPN para adiado: state "post", completed false.
  PST: S("post", "STATUS_POSTPONED", "Postponed", false),
  CANC: S("post", "STATUS_CANCELED", "Canceled", false),
  ABD: S("post", "STATUS_SUSPENDED", "Abandoned", false),
});


const strip = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Divergências conhecidas de nome entre fontes. Cresce caso a caso, com teste (PROJECT_MEMORY: matching é frágil). */
export const TEAM_ALIASES = Object.freeze({
  "atletico mineiro": "atletico mg", "atletico mg": "atletico mg", "atletico": "atletico mg",
  "athletico paranaense": "athletico pr", "athletico pr": "athletico pr", "atletico paranaense": "athletico pr",
  "vasco da gama": "vasco", "vasco da gama ac": "vasco", "cr vasco da gama": "vasco",
  "red bull bragantino": "bragantino", "rb bragantino": "bragantino", "bragantino sp": "bragantino",
  "gremio": "gremio", "gremio fbpa": "gremio", "internacional rs": "internacional", "sport recife": "sport",
  "operario pr": "operario pr", "operario ferroviario": "operario pr",
});

/** Chave comparável de um nome de time. */
export function teamKey(name) {
  const k = strip(name).replace(/\b(fc|ec|sc|ac|esporte clube|futebol clube|clube)\b/g, " ").replace(/\s+/g, " ").trim();
  return TEAM_ALIASES[k] ?? k;
}

const MAX_DATE_GAP_MS = 36 * 3600_000;

const isEmptyErrors = (e) => e == null || (Array.isArray(e) && e.length === 0) || (typeof e === "object" && !Array.isArray(e) && Object.keys(e).length === 0);

/**
 * Forma do ENVELOPE da API-Football. Atenção: a API sinaliza muitos erros (chave inválida, limite do
 * plano, parâmetro inválido) com HTTP 200 e um campo `errors` — um 200 NÃO é prova de sucesso.
 * Lista `response` vazia é LEGÍTIMA (nada ao vivo); quem distingue "sem jogo" de "fonte falhou" é
 * `errors`/HTTP, nunca o tamanho.
 */
export function validateEnvelope(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") return ["payload não é objeto"];
  if (!isEmptyErrors(raw.errors)) { problems.push("provedor reportou `errors`"); return problems; }
  if (!Array.isArray(raw.response)) { problems.push("`response` ausente ou não é lista"); return problems; }
  for (const f of raw.response.slice(0, 5)) {
    if (!f?.fixture || f.fixture.id == null) { problems.push("fixture sem `fixture.id`"); break; }
    if (!f.teams?.home || !f.teams?.away) { problems.push("fixture sem `teams.home/away`"); break; }
    if (!f.fixture.status || typeof f.fixture.status.short !== "string") { problems.push("fixture sem `fixture.status.short`"); break; }
  }
  return problems;
}

/** `2026-10-04T21:00:00+00:00` → formato do snapshot (`2026-10-04T21:00Z`). */
function canonicalDate(fx, fallback) {
  const ts = Number.isFinite(fx?.fixture?.timestamp) ? fx.fixture.timestamp * 1000 : Date.parse(fx?.fixture?.date);
  if (!Number.isFinite(ts)) return fallback ?? null;
  return new Date(ts).toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
}

const intOrNull = (v) => (Number.isInteger(v) ? v : null);

/** Pausas não têm minuto novo a mostrar: o texto da pausa é o relógio. */
function clockFor(short, st, status) {
  if (st.state === "pre") return { clockSec: 0, clockStr: "0'" };
  if (short === "HT") return { clockSec: 2700, clockStr: "HT" };
  if (short === "BT") return { clockSec: 5400, clockStr: "90'" };
  if (short === "P") return { clockSec: 7200, clockStr: "P" };
  return clockOf(status);
}

function clockOf(status) {
  const el = intOrNull(status?.elapsed);
  if (el == null) return { clockSec: 0, clockStr: "0'" };
  const extra = intOrNull(status?.extra);
  const base = `${el}'`;
  return { clockSec: el * 60, clockStr: extra ? `${base}+${extra}'` : base };
}

function detailsOf(fx, home, away) {
  const out = [];
  for (const ev of Array.isArray(fx.events) ? fx.events : []) {
    if (ev?.type !== "Goal" || ev.detail === "Missed Penalty") continue;   // só gols; pênalti perdido não é lance de gol
    const el = intOrNull(ev.time?.elapsed);
    if (el == null) continue;
    const extra = intOrNull(ev.time?.extra);
    const scorerIsHome = String(ev.team?.id) === String(fx.teams.home.id);
    // Gol contra: o lance é creditado ao ADVERSÁRIO de quem o marcou. HIPÓTESE sobre a convenção da
    // ESPN para `team` neste caso — confirmar na comparação em sombra (ver assessment).
    const creditedHome = ev.detail === "Own Goal" ? !scorerIsHome : scorerIsHome;
    const team = creditedHome ? home : away;
    const label = ev.detail === "Penalty" ? "Goal - Penalty" : ev.detail === "Own Goal" ? "Own Goal" : "Goal";
    const entry = {
      type: { text: label },
      scoringPlay: true,
      team: team.id != null ? { id: String(team.id) } : {},
      clock: { value: el * 60, displayValue: extra ? `${el}'+${extra}'` : `${el}'` },
    };
    if (ev.player?.name) entry.athletesInvolved = [{ displayName: ev.player.name, shortName: ev.player.name }];
    out.push(entry);
  }
  return out;
}

/**
 * Resolve uma fixture da API-Football para a partida do calendário canônico.
 * @returns {{ok:true, entry:object, via:string}|{ok:false, reason:string}}
 */
export function resolveIdentity(fx, calendar, identityMap = {}) {
  const fid = String(fx.fixture.id);
  if (Object.prototype.hasOwnProperty.call(identityMap, fid)) {
    const entry = calendar.find((c) => String(c.id) === String(identityMap[fid]));
    return entry ? { ok: true, entry, via: "identityMap" } : { ok: false, reason: "identityMap aponta para partida fora do calendario" };
  }
  const hk = teamKey(fx.teams.home.name), ak = teamKey(fx.teams.away.name);
  if (!hk || !ak) return { ok: false, reason: "time sem nome" };
  const t = Number.isFinite(fx.fixture.timestamp) ? fx.fixture.timestamp * 1000 : Date.parse(fx.fixture.date);
  if (!Number.isFinite(t)) return { ok: false, reason: "fixture sem data" };
  const cands = calendar
    .filter((c) => teamKey(c.homeTeam) === hk && teamKey(c.awayTeam) === ak)
    .map((c) => ({ c, gap: Math.abs(Date.parse(c.date) - t) }))
    .filter((x) => Number.isFinite(x.gap) && x.gap <= MAX_DATE_GAP_MS)
    .sort((a, b) => a.gap - b.gap);
  if (!cands.length) return { ok: false, reason: "sem partida no calendario para este confronto/data" };
  // Ida e volta do mata-mata têm as mesmas equipes: só aceita se o mais próximo for inequívoco.
  if (cands.length > 1 && cands[1].gap - cands[0].gap < 12 * 3600_000) return { ok: false, reason: "ambiguo: mais de uma partida candidata" };
  return { ok: true, entry: cands[0].c, via: "teams+date" };
}

/**
 * Corpo cru da API-Football → partidas canônicas de UMA competição.
 * Fixtures de outras ligas no mesmo corpo (ex.: `live=71-73`) são ignoradas aqui; o chamador chama
 * uma vez por competição.
 *
 * @param {object} raw
 * @param {{competition:string, calendar:object[], identityMap?:object}} ctx
 */
export function toCanonicalMatches(raw, { competition, calendar, identityMap = {} }) {
  const lg = LEAGUES[competition];
  const matches = [], unmapped = [];
  if (!lg) return { matches, unmapped: [{ fixtureId: null, reason: "competicao desconhecida" }] };
  for (const fx of raw?.response ?? []) {
    if (fx?.league?.id != null && Number(fx.league.id) !== lg.leagueId) continue;
    const id = resolveIdentity(fx, calendar ?? [], identityMap);
    if (!id.ok) { unmapped.push({ fixtureId: fx.fixture?.id ?? null, reason: id.reason }); continue; }
    const cal = id.entry;
    const short = fx.fixture.status.short;
    const st = STATUS_MAP[short];
    if (!st) { unmapped.push({ fixtureId: fx.fixture.id, reason: `status desconhecido: ${short}` }); continue; }

    // Lados vêm do calendário (nomes e ids canônicos); só os fatos vêm da API-Football.
    const homeTeam = { id: cal.homeTeamId }, awayTeam = { id: cal.awayTeamId };
    const clock = clockFor(short, st, fx.fixture.status);
    const finished = st.state === "post";
    let period = st.period;
    if (short === "ET") period = (intOrNull(fx.fixture.status.elapsed) ?? 0) > 105 ? 4 : 3;

    const detailShort = st.state === "pre" ? "Scheduled" : finished ? (st.completed ? short : st.description) : (clock.clockStr || st.description);
    matches.push({
      id: cal.id,
      date: canonicalDate(fx, cal.date),
      state: st.state,
      statusName: st.statusName,
      statusDescription: st.description,
      statusShortDetail: detailShort,
      statusDetail: detailShort,
      completed: st.completed,
      homeTeam: cal.homeTeam,
      awayTeam: cal.awayTeam,
      homeTeamId: cal.homeTeamId ?? null,
      awayTeamId: cal.awayTeamId ?? null,
      homeScore: st.state === "pre" ? 0 : (intOrNull(fx.goals?.home) ?? 0),
      awayScore: st.state === "pre" ? 0 : (intOrNull(fx.goals?.away) ?? 0),
      homeWinner: typeof fx.teams.home.winner === "boolean" ? fx.teams.home.winner : false,
      awayWinner: typeof fx.teams.away.winner === "boolean" ? fx.teams.away.winner : false,
      venue: fx.fixture.venue?.name ?? cal.venue ?? null,
      city: fx.fixture.venue?.city ?? cal.city ?? "",
      clockSec: clock.clockSec,
      clockStr: clock.clockStr,
      period,
      details: detailsOf(fx, homeTeam, awayTeam),
    });
  }
  return { matches, unmapped };
}

/** Classifica falha HTTP do provedor. NUNCA vira escrita: o último-bom-conhecido segura o gateway. */
export function classifyHttpFailure(status) {
  if (status === 401 || status === 403 || status === 499) return { kind: "AUTH", retry: false };
  if (status === 429) return { kind: "RATE_LIMITED", retry: true };
  if (status >= 500) return { kind: "UPSTREAM", retry: true };
  return { kind: "HTTP_ERROR", retry: false };
}
