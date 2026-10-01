#!/usr/bin/env node
// CONTRATO DA PORTA DE INGESTÃO DO CACHE AO VIVO + PLANO DE POLLING. Hermético: sem rede, sem banco.
//   · falha fechada (sem token / token errado / sem calendário / sem credencial de escrita → nada gravado);
//   · UMA implementação do envelope: ESPN (produtor atual) e API-Football entram no MESMO buildGatewayPayload;
//   · forma inválida, `errors` do provedor, não-JSON e competição fora da whitelist NUNCA gravam;
//   · dry_run (shadow) não grava; só live_sports_cache é tocada; o token nunca é ecoado;
//   · mesclagem idempotente, poda de janela, jogo sumido de `live` pede resolução (followUp);
//   · plano de polling: só consome cota quando algo pode estar ao vivo, e falha PARA O LADO DE BUSCAR.
// Uso: node bolao/shared/scripts/test_live_ingest.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INGEST_COMPETITIONS, MAX_BODY_BYTES, applyObservation, buildCacheRecord, handleIngest, mergeMatches, tokenMatches,
} from "../../../supabase/functions/_shared/live_ingest_core.js";
import {
  CALENDAR_MAX_AGE_MS, SAFE_PATH, decideCompetition, isWithinWindow, planApiFootballRequests,
} from "../../../supabase/functions/_shared/polling_plan.js";
import { PRODUCED_COMPETITIONS, produceOne } from "./produce_live_cache.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let pass = 0, fail = 0;
const test = async (n, f) => { try { await f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const NOW = Date.parse("2026-10-04T21:10:00Z");           // 10 min depois do apito de 9001
const TOKEN = "token-de-teste-nao-real-0123456789";
const CAL = { generatedAt: "2026-10-04T20:00:00Z", matches: [
  { id: "9001", date: "2026-10-04T21:00Z", state: "pre", statusName: "STATUS_SCHEDULED", homeTeam: "Atlético-MG", awayTeam: "Palmeiras", homeTeamId: "7632", awayTeamId: "2029", venue: "Arena MRV", city: "BH" },
  { id: "9002", date: "2026-10-11T21:00Z", state: "pre", statusName: "STATUS_SCHEDULED", homeTeam: "Vasco da Gama", awayTeam: "Red Bull Bragantino", homeTeamId: "3454", awayTeamId: "6270" },
] };
const fx = (o = {}) => ({
  fixture: { id: o.id ?? 7001, timestamp: Date.parse("2026-10-04T21:00:00Z") / 1000, date: "2026-10-04T21:00:00+00:00", venue: { name: "Arena MRV", city: "BH" }, status: { short: o.short ?? "1H", elapsed: o.elapsed ?? 10, extra: null } },
  league: { id: o.league ?? 71 }, teams: { home: { id: 1, name: o.home ?? "Atletico Mineiro", winner: null }, away: { id: 2, name: o.away ?? "Palmeiras", winner: null } },
  goals: { home: o.gh ?? 1, away: o.ga ?? 0 }, events: [],
});
const env = (...f) => ({ errors: [], response: f });
const writes = [];
const deps = (extra = {}) => ({
  ingestToken: TOKEN, now: NOW, writeImpl: async (w) => { writes.push(w); return true; },
  readExisting: async () => null, loadCalendar: async () => CAL, ...extra,
});
const req = (method, qs, body, token = TOKEN) => ({ method, url: `https://x.invalid/i?${qs}`, headers: { authorization: token === null ? "" : `Bearer ${token}` }, bodyText: body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body)) });
const post = (body, qs = "provider=api_football&kind=live&competitions=br2026", token) => req("POST", qs, body, token);

console.log("\nIngestão — autenticação e falha fechada\n");
await test("sem token configurado: 503, nada gravado (nunca cai para aberto)", async () => { writes.length = 0; const r = await handleIngest(post(env()), deps({ ingestToken: "" })); eq(r.status, 503, "status"); eq(writes.length, 0, "gravou"); });
for (const [n, tk] of [["sem Authorization", null], ["token errado", "outro"], ["token vazio", ""]]) await test(`${n}: 401, nada gravado`, async () => { writes.length = 0; const r = await handleIngest(post(env(), undefined, tk), deps()); eq(r.status, 401, "status"); eq(writes.length, 0, "gravou"); });
await test("tokenMatches é estrito (prefixo, sufixo, não-string)", () => { assert(tokenMatches(TOKEN, TOKEN)); assert(!tokenMatches(TOKEN + "x", TOKEN)); assert(!tokenMatches(TOKEN.slice(1), TOKEN)); assert(!tokenMatches(undefined, TOKEN)); assert(!tokenMatches(TOKEN, "")); });
await test("a resposta nunca contém o token", async () => { for (const r of [await handleIngest(post(env()), deps()), await handleIngest(post("{"), deps()), await handleIngest(post(env(), undefined, "x"), deps())]) assert(!JSON.stringify(r).includes(TOKEN), "token vazou"); });
await test("provider desconhecido (ex.: espn) é recusado — o ingest só aceita o provedor fora do GitHub", async () => { eq((await handleIngest(post(env(), "provider=espn&kind=live&competitions=br2026"), deps())).status, 400, "espn"); });
await test("sem calendário injetado / sem leitura do cache: 503; calendário indisponível: NO_WRITE", async () => {
  eq((await handleIngest(post(env()), deps({ loadCalendar: undefined }))).status, 503, "sem dep");
  writes.length = 0; const r = await handleIngest(post(env(fx())), deps({ loadCalendar: async () => null })); eq(r.status, 422, "status"); eq(r.body.results[0].action, "NO_WRITE", "acao"); eq(writes.length, 0, "gravou sem identidade");
});

console.log("\nIngestão — escrita\n");
await test("POST válido: grava UMA linha por competição com a chave `competition` e o envelope do gateway", async () => {
  writes.length = 0; const r = await handleIngest(post(env(fx())), deps());
  eq(r.status, 200, "status"); eq(r.body.results[0].action, "WRITTEN", "acao"); eq(writes.length, 1, "escritas");
  eq(Object.keys(writes[0]).sort(), ["competition", "observedAt", "payload"], "campos"); eq(writes[0].competition, "br2026", "chave");
  eq(Object.keys(writes[0].payload).sort(), ["ageSeconds", "competition", "matches", "observedAt", "provider", "schemaVersion", "servedAt", "stale", "staleReason"], "envelope do gateway");
  eq(writes[0].payload.matches[0].id, "9001", "id canonico"); eq(writes[0].payload.matches[0].state, "in", "ao vivo");
});
await test("UMA implementação do envelope: ESPN e API-Football produzem payloads com as MESMAS chaves de topo", async () => {
  const espnRaw = { events: [{ id: "9001", date: "2026-10-04T21:00Z", competitions: [{ status: { clock: 600, displayClock: "10'", period: 1, type: { state: "in", name: "STATUS_FIRST_HALF", description: "x", shortDetail: "x", detail: "x", completed: false } }, venue: { fullName: "A", address: { city: "B" } }, competitors: [{ homeAway: "home", score: "1", team: { id: "7632", displayName: "Atlético-MG" } }, { homeAway: "away", score: "0", team: { id: "2029", displayName: "Palmeiras" } }], details: [] }] }] };
  const a = buildCacheRecord("br2026", espnRaw, { now: NOW }), b = applyObservation({ competition: "br2026", raw: env(fx()), kind: "live", calendar: CAL, existing: null, now: NOW });
  eq(Object.keys(a.payload).sort(), Object.keys(b.payload).sort(), "chaves do envelope"); eq(Object.keys(a.payload.matches[0]).sort(), Object.keys(b.payload.matches[0]).sort(), "chaves da partida");
  eq([a.payload.matches[0].id, a.payload.matches[0].homeScore, a.payload.matches[0].state], [b.payload.matches[0].id, b.payload.matches[0].homeScore, b.payload.matches[0].state], "mesmos fatos");
});
await test("produtor ESPN atual segue intacto: PRODUCED_COMPETITIONS === INGEST_COMPETITIONS e produceOne usa o núcleo", async () => {
  eq(PRODUCED_COMPETITIONS, [...INGEST_COMPETITIONS], "lista");
  const r = await produceOne("br2026", { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) }), now: NOW, force: true }); eq(r.action, "DRY_RUN", "acao");
});
await test("reexecução é idempotente: mesma chave e mesmo corpo → mesmo registro (modulo carimbo)", async () => {
  writes.length = 0; await handleIngest(post(env(fx())), deps()); await handleIngest(post(env(fx())), deps());
  eq(writes[0].payload, writes[1].payload, "payload"); eq(writes[0].competition, writes[1].competition, "chave");
});
await test("dry_run (shadow) valida e resume, NÃO grava", async () => {
  writes.length = 0; const r = await handleIngest(post(env(fx()), "provider=api_football&kind=live&competitions=br2026&dry_run=1"), deps());
  eq(r.status, 200, "status"); eq(r.body.results[0].action, "DRY_RUN", "acao"); eq(writes.length, 0, "gravou");
});
await test("envelope inválido, `errors` do provedor, não-JSON (HTML de bloqueio): 4xx e NUNCA grava", async () => {
  for (const [corpo, st] of [[{ response: "x", errors: [] }, 422], [{ errors: { requests: "limit" }, response: [] }, 422], ["<html>Access Denied</html>", 400]]) { writes.length = 0; const r = await handleIngest(post(corpo), deps()); eq(r.status, st, JSON.stringify(corpo)); eq(writes.length, 0, "gravou"); }
});
await test("competição fora da whitelist (copa2026, lixo, vazio): 400 e nada gravado", async () => {
  for (const c of ["copa2026", "../../etc", "BR2026", "", "br2026;x"]) { writes.length = 0; const r = await handleIngest(post(env(), `provider=api_football&kind=live&competitions=${c}`), deps()); eq(r.status, 400, c); eq(writes.length, 0, c); }
  eq((await handleIngest(post(env(), "provider=api_football&kind=zzz&competitions=br2026"), deps())).status, 400, "kind");
});
await test("corpo acima do limite: 413; sem credencial de escrita: 503; escrita recusada: 502", async () => {
  eq((await handleIngest(post("x".repeat(MAX_BODY_BYTES + 1)), deps())).status, 413, "413");
  eq((await handleIngest(post(env(fx())), deps({ writeImpl: undefined }))).status, 503, "503");
  const r = await handleIngest(post(env(fx())), deps({ writeImpl: async () => false })); eq(r.status, 502, "502"); eq(r.body.results[0].action, "WRITE_FAILED", "acao");
});
await test("uma observação multi-competição só toca as competições NOMEADAS (live=71 não 'observa' o CDB)", async () => {
  writes.length = 0; await handleIngest(post(env(fx()), "provider=api_football&kind=live&competitions=br2026"), deps()); eq(writes.map((w) => w.competition), ["br2026"], "so br2026");
});
await test("jogo que estava `in` e some de `live` pede sincronização do dia (followUp) — nunca inventa final", async () => {
  const prev = { payload: { matches: [{ ...applyObservation({ competition: "br2026", raw: env(fx()), kind: "live", calendar: CAL, existing: null, now: NOW }).payload.matches[0] }] } };
  const r = await handleIngest(post(env()), deps({ readExisting: async () => prev }));
  assert(r.body.followUp.length === 1 && r.body.followUp[0].kind === "day" && SAFE_PATH.test(r.body.followUp[0].path), JSON.stringify(r.body.followUp));
  eq(r.body.results[0].live, 1, "o jogo continua marcado ao vivo ate haver prova de final");
});
await test("mergeMatches: substitui por id, preserva o resto, poda fora da janela, ordem determinística", () => {
  const old = [{ id: "1", date: "2026-10-04T10:00Z", state: "pre" }, { id: "2", date: "2026-09-01T10:00Z", state: "post" }, { id: "3", date: "2026-10-04T22:00Z", state: "pre" }];
  const m = mergeMatches(old, [{ id: "1", date: "2026-10-04T10:00Z", state: "post" }], NOW);
  eq(m.map((x) => [x.id, x.state]), [["1", "post"], ["3", "pre"]], "mescla/poda");
});

console.log("\nPlano de polling — só gasta cota quando algo pode estar ao vivo\n");
const decide = (calendar, existingMatches = [], now = NOW) => decideCompetition({ calendar, existingMatches, now });
await test("jogo na janela [-3h,+1h] liga; fora da janela desliga; adiado/cancelado nunca liga", () => {
  eq(decide(CAL).poll, true, "na janela"); eq(decide(CAL, [], Date.parse("2026-10-06T12:00:00Z")).poll, false, "fora");
  const adiado = { ...CAL, matches: [{ ...CAL.matches[0], statusName: "STATUS_POSTPONED", state: "post" }] }; eq(decide(adiado).poll, false, "adiado");
});
await test("jogo já `in` no cache mantém a observação ligada mesmo fora da janela do calendário (prorrogação/atraso)", () => {
  eq(decide(CAL, [{ id: "9001", state: "in" }], Date.parse("2026-10-05T03:00:00Z")).poll, true, "cache ao vivo");
});
await test("partida que o calendário ainda mostra como não-encerrada fica 'possivelmente ao vivo' por 5 h (vs 3 h para encerradas)", () => {
  const t = Date.parse("2026-10-05T01:30:00Z");   // 4h30 depois do apito
  eq(decide(CAL, [], t).poll, true, "pre ha 4h30"); eq(decide({ ...CAL, matches: [{ ...CAL.matches[0], state: "post" }] }, [], t).poll, false, "post ha 4h30");
});
await test("FALHA PARA O LADO DE BUSCAR: calendário ausente/vazio/velho → janela larga 12h–03h59 UTC, nunca silêncio", () => {
  const dentro = Date.parse("2026-10-04T15:00:00Z"), fora = Date.parse("2026-10-04T08:00:00Z");
  for (const c of [null, { matches: [], generatedAt: "2026-10-04T00:00:00Z" }, { matches: CAL.matches, generatedAt: "2026-09-01T00:00:00Z" }, { matches: CAL.matches, generatedAt: "lixo" }]) {
    eq(decide(c, [], dentro).poll, true, "dentro"); eq(decide(c, [], fora).poll, false, "fora"); eq(decide(c, [], dentro).reason, "calendar_uncertain_fallback_window", "motivo");
  }
  assert(CALENDAR_MAX_AGE_MS === 7 * 24 * 3600_000);
});
await test("a janela larga é SUPERCONJUNTO da janela do produtor atual (14h–02h UTC)", () => {
  for (let h = 0; h < 24; h++) { const t = Date.parse(`2026-10-04T${String(h).padStart(2, "0")}:30:00Z`); if (h >= 14 || h <= 2) eq(decide(null, [], t).poll, true, `h=${h}`); }
});
await test("isWithinWindow (compartilhado com o produtor GitHub) mantém a semântica: sem datas = buscar", () => { eq(isWithinWindow([], NOW), true, "vazio"); eq(isWithinWindow(["2026-10-04T21:00Z"], NOW), true, "dentro"); eq(isWithinWindow(["2026-10-09T21:00Z"], NOW), false, "fora"); });
await test("requisições: UMA chamada `live` cobre as competições em janela; ids de liga vêm da configuração", () => {
  const both = planApiFootballRequests({ now: NOW, polling: { br2026: { poll: true }, cdb2026: { poll: true } } }); eq(both[0], { kind: "live", competitions: ["br2026", "cdb2026"], path: "/fixtures?live=71-73" }, "live");
  const one = planApiFootballRequests({ now: NOW, polling: { br2026: { poll: true }, cdb2026: { poll: false } } }); eq(one[0].path, "/fixtures?live=71", "so br");
  eq(planApiFootballRequests({ now: NOW, polling: { br2026: { poll: false }, cdb2026: { poll: false } } }), [], "nada a buscar");
});
await test("sincronização do dia: a cada 10 min, ou quando o cache ainda não tem jogo do dia; caminhos sempre na forma fechada", () => {
  const t10 = Date.parse("2026-10-04T21:10:00Z"), t11 = Date.parse("2026-10-04T21:11:00Z"), poll = { br2026: { poll: true } };
  const today = { br2026: [{ date: "2026-10-04T21:00Z" }] };
  eq(planApiFootballRequests({ now: t10, polling: poll, existingByCompetition: today }).map((r) => r.kind), ["live", "day"], "minuto 10");
  eq(planApiFootballRequests({ now: t11, polling: poll, existingByCompetition: today }).map((r) => r.kind), ["live"], "minuto 11");
  eq(planApiFootballRequests({ now: t11, polling: poll, existingByCompetition: {} }).map((r) => r.kind), ["live", "day"], "cache sem jogo do dia");
  for (const r of planApiFootballRequests({ now: t10, polling: { br2026: { poll: true }, cdb2026: { poll: true } }, existingByCompetition: {} })) assert(SAFE_PATH.test(r.path), r.path);
});
await test("GET ?plan=1: devolve decisões e requisições; fora de janela devolve poll=false e lista vazia", async () => {
  const on = await handleIngest(req("GET", "plan=1&provider=api_football"), deps()); eq([on.status, on.body.poll], [200, true], "dentro");
  const off = await handleIngest(req("GET", "plan=1&provider=api_football"), deps({ now: Date.parse("2026-10-07T08:00:00Z") })); eq([off.body.poll, off.body.requests], [false, []], "fora");
  eq((await handleIngest(req("GET", "provider=api_football"), deps())).status, 400, "sem plan");
});

console.log("\nSuperfície\n");
await test("a função só escreve em live_sports_cache; nada de participante/pagamento; núcleo sem node:/Deno", () => {
  const src = readFileSync(join(REPO, "supabase/functions/live-cache-ingest/index.ts"), "utf8");
  assert(/CACHE_TABLE\s*=\s*"live_sports_cache"/.test(src)); assert(!/bolao_state|participant|payment|ledger/i.test(src));
  for (const f of ["live_ingest_core.js", "polling_plan.js", "providers/api_football.js", "providers/espn.js"]) { const s = readFileSync(join(REPO, "supabase/functions/_shared", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.split(" // ")[0]).join("\n"); assert(!/from "node:|Deno\.|process\./.test(s), `${f} depende de runtime`); }
});
await test("config.toml declara a função sem JWT do Supabase (token próprio) e a gateway continua intacta", () => {
  const t = readFileSync(join(REPO, "supabase/config.toml"), "utf8");
  assert(/\[functions\.live-cache-ingest\][^[]*verify_jwt\s*=\s*false/.test(t)); assert(/\[functions\.live-football\][^[]*verify_jwt\s*=\s*false/.test(t));
});

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
