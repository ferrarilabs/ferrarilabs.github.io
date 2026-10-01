#!/usr/bin/env node
// ADAPTADOR API-FOOTBALL → CANÔNICO — hermético, fixtures SINTÉTICAS (nenhuma credencial, nenhuma rede).
// O que se prova: o objeto canônico que os apps/gateway já consomem sai com a MESMA forma da ESPN, a
// identidade é estável e conservadora, todo estado do ciclo de vida mapeia, e nada de falha do provedor
// chega a virar escrita. ATENÇÃO: o esquema do provedor aqui é o documentado publicamente; a validação
// contra uma resposta REAL é um item de prova pendente (ver API_FOOTBALL_PROVIDER_ASSESSMENT.md).
// Uso: node bolao/shared/scripts/test_api_football_adapter.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEAGUES, STATUS_MAP, classifyHttpFailure, resolveIdentity, teamKey, toCanonicalMatches, validateEnvelope,
} from "../../../supabase/functions/_shared/providers/api_football.js";
import { normalizeScoreboard } from "../../../supabase/functions/_shared/normalize.js";
import { applyObservation } from "../../../supabase/functions/_shared/live_ingest_core.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let pass = 0, fail = 0;
const test = async (n, f) => { try { await f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const KICKOFF = Date.parse("2026-10-04T21:00:00Z");
/** Calendário canônico SINTÉTICO (ids/nomes no formato do snapshot ESPN). */
const CAL = [
  { id: "9001", date: "2026-10-04T21:00Z", homeTeam: "Atlético-MG", awayTeam: "Palmeiras", homeTeamId: "7632", awayTeamId: "2029", venue: "Arena MRV", city: "Belo Horizonte" },
  { id: "9002", date: "2026-10-05T00:30Z", homeTeam: "Vasco da Gama", awayTeam: "Red Bull Bragantino", homeTeamId: "3454", awayTeamId: "6270", venue: "São Januário", city: "Rio de Janeiro" },
  { id: "9003", date: "2026-10-04T19:00Z", homeTeam: "Athletico Paranaense", awayTeam: "Grêmio", homeTeamId: "3458", awayTeamId: "6273", venue: "Ligga Arena", city: "Curitiba" },
];
/** Fixture sintética no esquema documentado da API-Football v3. */
const fx = ({ id = 7001, short = "1H", elapsed = 27, extra = null, home = "Atletico Mineiro", away = "Palmeiras", gh = 1, ga = 0, ts = KICKOFF / 1000, league = 71, events = [], winner = [null, null] } = {}) => ({
  fixture: { id, referee: null, timezone: "UTC", date: new Date(ts * 1000).toISOString().replace("Z", "+00:00"), timestamp: ts, venue: { id: 1, name: "Arena MRV", city: "Belo Horizonte" },
    status: { long: "x", short, elapsed, extra } },
  league: { id: league, name: "x", season: 2026, round: "Regular Season - 30" },
  teams: { home: { id: 100, name: home, winner: winner[0] }, away: { id: 200, name: away, winner: winner[1] } },
  goals: { home: gh, away: ga }, score: {}, events,
});
const env = (...fixtures) => ({ get: "fixtures", parameters: {}, errors: [], results: fixtures.length, paging: { current: 1, total: 1 }, response: fixtures });
const conv = (raw, competition = "br2026") => toCanonicalMatches(raw, { competition, calendar: CAL });
const one = (f, competition) => { const r = conv(env(f), competition); assert(r.matches.length === 1, `esperava 1 partida, veio ${r.matches.length} (${JSON.stringify(r.unmapped)})`); return r.matches[0]; };

console.log("\nCiclo de vida → vocabulário canônico\n");
await test("1º tempo ao vivo: state in, minuto, placar, ids canônicos do calendário", () => {
  const m = one(fx({ short: "1H", elapsed: 27 }));
  eq([m.id, m.state, m.statusName, m.completed], ["9001", "in", "STATUS_FIRST_HALF", false], "ciclo");
  eq([m.homeScore, m.awayScore, m.clockStr, m.clockSec, m.period], [1, 0, "27'", 1620, 1], "placar/relogio");
  eq([m.homeTeam, m.awayTeam, m.homeTeamId, m.awayTeamId], ["Atlético-MG", "Palmeiras", "7632", "2029"], "identidade dos times vem do calendario");
});
await test("intervalo: state in, texto HT, nada de minuto novo", () => {
  const m = one(fx({ short: "HT", elapsed: 45 })); eq([m.state, m.statusName, m.clockStr, m.clockSec], ["in", "STATUS_HALFTIME", "HT", 2700], "HT");
});
await test("2º tempo com acréscimo: 90'+3'", () => {
  const m = one(fx({ short: "2H", elapsed: 90, extra: 3, gh: 2, ga: 2 })); eq([m.statusName, m.clockStr, m.period, m.homeScore, m.awayScore], ["STATUS_SECOND_HALF", "90'+3'", 2, 2, 2], "2H");
});
await test("encerrado (FT): state post, completed true, vencedor", () => {
  const m = one(fx({ short: "FT", elapsed: 90, extra: 8, gh: 2, ga: 1, winner: [true, false] }));
  eq([m.state, m.statusName, m.completed, m.homeWinner, m.awayWinner, m.statusShortDetail, m.clockStr], ["post", "STATUS_FULL_TIME", true, true, false, "FT", "90'+8'"], "FT");
});
await test("0 x 0 ao vivo: placar zero é zero, nunca ausente", () => {
  const m = one(fx({ short: "1H", elapsed: 12, gh: 0, ga: 0 })); eq([m.homeScore, m.awayScore], [0, 0], "0x0");
});
await test("prorrogação: in, period 3 e depois 4 após 105'", () => {
  eq(one(fx({ short: "ET", elapsed: 98, gh: 1, ga: 1 })).period, 3, "ET1"); eq(one(fx({ short: "ET", elapsed: 110 })).period, 4, "ET2");
  eq(one(fx({ short: "ET", elapsed: 98 })).state, "in", "state");
});
await test("encerrado na prorrogação (AET) e nos pênaltis (PEN): finais, vencedor preservado", () => {
  const a = one(fx({ short: "AET", elapsed: 120, gh: 2, ga: 1, winner: [true, false] })); eq([a.statusName, a.state, a.completed], ["STATUS_FINAL_AET", "post", true], "AET");
  const p = one(fx({ short: "PEN", elapsed: 120, gh: 1, ga: 1, winner: [false, true] })); eq([p.statusName, p.completed, p.homeWinner, p.awayWinner], ["STATUS_FINAL_PEN", true, false, true], "PEN");
});
await test("disputa de pênaltis em andamento (P): in, sem inventar minuto", () => {
  const m = one(fx({ short: "P", elapsed: 120, gh: 1, ga: 1 })); eq([m.state, m.statusName, m.clockStr, m.period], ["in", "STATUS_SHOOTOUT", "P", 5], "P");
});
await test("adiado (PST): mesma convenção do snapshot — state post, completed false, STATUS_POSTPONED", () => {
  const m = one(fx({ short: "PST", elapsed: null, gh: null, ga: null }));
  eq([m.state, m.statusName, m.completed, m.homeScore, m.awayScore], ["post", "STATUS_POSTPONED", false, 0, 0], "PST");
});
await test("cancelado (CANC) e abandonado/suspenso: terminais para a store, nunca 'ao vivo'", () => {
  const c = one(fx({ short: "CANC", elapsed: null, gh: null, ga: null })); eq([c.statusName, c.state, c.completed], ["STATUS_CANCELED", "post", false], "CANC");
  const a = one(fx({ short: "ABD", elapsed: 60 })); eq([a.statusName, a.state], ["STATUS_SUSPENDED", "post"], "ABD");
});
await test("agendado (NS/TBD): state pre, relógio zerado, sem placar", () => {
  const m = one(fx({ short: "NS", elapsed: null, gh: null, ga: null })); eq([m.state, m.statusName, m.homeScore, m.clockStr, m.completed], ["pre", "STATUS_SCHEDULED", 0, "0'", false], "NS");
});
await test("todo status.short documentado tem mapeamento, e nenhum 'in' é terminal", () => {
  for (const k of ["TBD", "NS", "1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO", "LIVE"]) assert(STATUS_MAP[k], `sem mapeamento: ${k}`);
  assert(STATUS_MAP.FT.state === "post" && STATUS_MAP["1H"].state === "in" && STATUS_MAP.NS.state === "pre");
});
await test("status desconhecido não vira partida: vai para unmapped", () => {
  const r = conv(env(fx({ short: "ZZZ" }))); eq(r.matches.length, 0, "partidas"); assert(/status desconhecido/.test(r.unmapped[0].reason), r.unmapped[0].reason);
});

console.log("\nLances (details) e forma canônica\n");
await test("gols viram details no formato ESPN; pênalti perdido e cartão são ignorados; gol contra credita o adversário", () => {
  const ev = (type, detail, minute, teamId, name, extra = null) => ({ time: { elapsed: minute, extra }, team: { id: teamId, name: "x" }, player: { id: 1, name }, type, detail });
  const m = one(fx({ short: "2H", elapsed: 80, gh: 2, ga: 0, events: [
    ev("Goal", "Normal Goal", 27, 100, "J. López"), ev("Card", "Yellow Card", 30, 200, "X"), ev("Goal", "Missed Penalty", 40, 100, "Y"),
    ev("Goal", "Own Goal", 70, 200, "Z", null), ev("Goal", "Penalty", 90, 100, "W", 2) ] }));
  eq(m.details.length, 3, "so gols");
  eq(m.details[0], { type: { text: "Goal" }, scoringPlay: true, team: { id: "7632" }, clock: { value: 1620, displayValue: "27'" }, athletesInvolved: [{ displayName: "J. López", shortName: "J. López" }] }, "gol normal");
  eq(m.details[1].team, { id: "7632" }, "gol contra de 200 (visitante) credita o mandante");
  eq([m.details[2].type.text, m.details[2].clock.displayValue], ["Goal - Penalty", "90'+2'"], "penalti convertido com acrescimo");
});
await test("PARIDADE DE FORMA: as chaves da partida canônica são exatamente as da ESPN e as do snapshot commitado", () => {
  const espnRaw = { events: [{ id: "1", date: "2026-10-04T21:00Z", competitions: [{ status: { clock: 1, displayClock: "1'", period: 1, type: { state: "in", name: "STATUS_IN_PROGRESS", description: "x", shortDetail: "x", detail: "x", completed: false } },
    venue: { fullName: "A", address: { city: "B" } }, competitors: [{ homeAway: "home", score: "0", team: { id: "1", displayName: "A" } }, { homeAway: "away", score: "0", team: { id: "2", displayName: "B" } }], details: [] }] }] };
  const esp = Object.keys(normalizeScoreboard(espnRaw)[0]).sort();
  eq(Object.keys(one(fx())).sort(), esp, "chaves vs normalizeScoreboard");
  const snap = JSON.parse(readFileSync(join(REPO, "bolao/br2026/data/espn-normalized.json"), "utf8")).matches[0];
  eq(Object.keys(one(fx())).sort(), Object.keys({ details: 1, ...snap }).sort(), "chaves vs snapshot commitado");
});
await test("tipos dos campos consumidos pelo store/herói: strings, inteiros, booleanos", () => {
  const m = one(fx({ short: "FT", elapsed: 90, gh: 1, ga: 0, winner: [true, false] }));
  for (const k of ["id", "date", "state", "statusName", "homeTeam", "awayTeam", "homeTeamId", "awayTeamId", "clockStr"]) assert(typeof m[k] === "string", `${k} nao e string`);
  for (const k of ["homeScore", "awayScore", "clockSec"]) assert(Number.isInteger(m[k]), `${k} nao e inteiro`);
  for (const k of ["completed", "homeWinner", "awayWinner"]) assert(typeof m[k] === "boolean", `${k} nao e booleano`);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(m.date), `formato de data: ${m.date}`);
});

console.log("\nIdentidade e times\n");
await test("estabilidade: a mesma fixture resolve sempre para o mesmo id canônico (e é determinística)", () => {
  const a = one(fx({ short: "1H" })), b = one(fx({ short: "FT", elapsed: 90 })), c = one(fx({ short: "HT" }));
  eq([a.id, b.id, c.id], ["9001", "9001", "9001"], "id");
});
await test("mapeamento de nomes: acento, caixa, prefixo/sufixo e apelidos divergentes", () => {
  eq(teamKey("Atlético-MG"), teamKey("Atletico Mineiro"), "Atletico"); eq(teamKey("Vasco da Gama"), teamKey("Vasco"), "Vasco");
  eq(teamKey("Red Bull Bragantino"), teamKey("RB Bragantino"), "Bragantino"); eq(teamKey("Athletico Paranaense"), teamKey("Athletico-PR"), "Athletico");
  eq(teamKey("Grêmio"), teamKey("Gremio FBPA"), "Gremio"); assert(teamKey("Atlético-MG") !== teamKey("Atlético Goianiense"), "MG != GO");
  const r = conv(env(fx({ id: 7002, home: "Vasco", away: "RB Bragantino", ts: Date.parse("2026-10-05T00:30:00Z") / 1000 }))); eq(r.matches[0].id, "9002", "vasco x bragantino");
});
await test("identityMap tem prioridade sobre nomes; id fora do calendário é recusado", () => {
  const f = fx({ id: 7003, home: "Time Que Nao Casa", away: "Outro", ts: KICKOFF / 1000 });
  eq(toCanonicalMatches(env(f), { competition: "br2026", calendar: CAL, identityMap: { 7003: "9001" } }).matches[0].id, "9001", "override");
  eq(toCanonicalMatches(env(f), { competition: "br2026", calendar: CAL, identityMap: { 7003: "ZZZ" } }).matches.length, 0, "alvo inexistente");
});
await test("conservador: confronto sem partida no calendário ou data fora de ±36 h → unmapped, NUNCA chute", () => {
  const r1 = conv(env(fx({ home: "Santos", away: "Sport" }))); eq([r1.matches.length, r1.unmapped.length], [0, 1], "sem confronto");
  const r2 = conv(env(fx({ ts: (KICKOFF + 3 * 24 * 3600_000) / 1000 }))); eq([r2.matches.length, r2.unmapped.length], [0, 1], "data longe");
});
await test("ida e volta com as mesmas equipes: ambíguo → unmapped; desambígua quando uma data é bem mais próxima", () => {
  const cal2 = [...CAL, { ...CAL[0], id: "9101", date: "2026-10-04T21:30Z" }];
  eq(resolveIdentity(fx(), cal2).ok, false, "ambiguo");
  const cal3 = [...CAL, { ...CAL[0], id: "9102", date: "2026-10-11T21:00Z" }];
  eq(resolveIdentity(fx(), cal3).entry.id, "9001", "mais proximo");
});
await test("orientação trocada (mandante×visitante) não casa — não se troca placar por dedução", () => {
  eq(conv(env(fx({ home: "Palmeiras", away: "Atletico Mineiro" }))).matches.length, 0, "invertido");
});
await test("competição desconhecida ou liga de outra competição: nada é produzido", () => {
  eq(toCanonicalMatches(env(fx()), { competition: "copa2026", calendar: CAL }).matches.length, 0, "competicao desconhecida");
  eq(conv(env(fx({ league: 73 })), "br2026").matches.length, 0, "liga 73 nao entra em br2026");
  eq(LEAGUES.br2026.leagueId !== LEAGUES.cdb2026.leagueId, true, "ligas distintas");
});

console.log("\nFalhas do provedor nunca viram escrita\n");
await test("envelope malformado: não-objeto, sem response, fixture sem campos obrigatórios", () => {
  for (const bad of [null, "x", {}, { response: "nope", errors: [] }, { errors: [], response: [{ fixture: {} }] }, { errors: [], response: [{ fixture: { id: 1, status: { short: "NS" } } }] }]) assert(validateEnvelope(bad).length > 0, JSON.stringify(bad));
});
await test("HTTP 200 com `errors` (limite do plano, chave inválida) é falha da fonte, não 'sem jogos'", () => {
  assert(validateEnvelope({ errors: { requests: "limit reached" }, response: [] }).length > 0); assert(validateEnvelope({ errors: ["token"], response: [] }).length > 0);
});
await test("resposta `live` vazia é legítima (nada ao vivo) e é aceita", () => eq(validateEnvelope(env()), [], "vazio"));
await test("HTTP 401/403/499 → AUTH; 429 → RATE_LIMITED; 5xx → UPSTREAM; nenhum é sucesso", () => {
  for (const s of [401, 403, 499]) eq(classifyHttpFailure(s).kind, "AUTH", String(s));
  eq(classifyHttpFailure(429), { kind: "RATE_LIMITED", retry: true }, "429");
  for (const s of [500, 502, 503, 504]) eq(classifyHttpFailure(s).kind, "UPSTREAM", String(s));
});
await test("applyObservation: forma inválida / errors / calendário ausente → NO_WRITE; vazio válido → grava preservando o cache", () => {
  const base = { competition: "br2026", kind: "live", calendar: { matches: CAL, generatedAt: "2026-10-04T00:00:00Z" }, existing: null, now: KICKOFF };
  eq(applyObservation({ ...base, raw: { response: "x", errors: [] } }).ok, false, "forma");
  eq(applyObservation({ ...base, raw: { errors: { x: 1 }, response: [] } }).ok, false, "errors");
  eq(applyObservation({ ...base, raw: env(), calendar: null }).action, "NO_WRITE", "sem calendario");
  const prev = { payload: { matches: [one(fx({ short: "1H" }))] } };
  const empty = applyObservation({ ...base, raw: env(), existing: prev });
  eq([empty.ok, empty.matches, empty.vanishedLive], [true, 1, 1], "vazio preserva o cache e acusa jogo sumido (pede resolucao)");
});

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
