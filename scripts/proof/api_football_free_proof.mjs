#!/usr/bin/env node
/**
 * Prova do plano FREE da API-Football — roda na MÁQUINA LOCAL do Eduardo, somente leitura.
 *
 *   API_FOOTBALL_KEY=... node scripts/proof/api_football_free_proof.mjs
 *
 * Teto duro: 20 chamadas (contador interno). A chave NUNCA é impressa nem gravada; só status, `errors`,
 * `results` e cabeçalhos x-ratelimit-* aparecem. Payloads de fixtures (dado esportivo público) vão para
 * `.proof-out/` (ignorado pelo git) para alimentar `adapter_on_real_payload.mjs`. Nenhuma escrita em produção.
 * O cabeçalho `x-apisports-key` e os parâmetros abaixo são os documentados publicamente e SÃO parte do que
 * esta prova confirma (um 401/`errors` aqui é um achado, não um bug de script).
 */
import { mkdirSync, writeFileSync } from "node:fs";
const KEY = process.env.API_FOOTBALL_KEY;
if (!KEY) { console.error("API_FOOTBALL_KEY ausente. Dashboard da API-Football → Account → My Access → copie a API key e exporte-a (nunca em arquivo versionado)."); process.exit(2); }
const BASE = "https://v3.football.api-sports.io", MAX_CALLS = 20, OUT = ".proof-out";
mkdirSync(OUT, { recursive: true });
let calls = 0; const log = [];
const RL = (h) => Object.fromEntries([...h.entries()].filter(([k]) => /^x-ratelimit|^x-rate|retry-after/i.test(k)));

async function api(path, label) {
  if (calls >= MAX_CALLS) throw new Error(`teto de ${MAX_CALLS} chamadas atingido`);
  calls++;
  const t0 = performance.now();
  const r = await fetch(BASE + path, { headers: { "x-apisports-key": KEY, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const ms = Math.round(performance.now() - t0);
  let body = null; try { body = await r.json(); } catch { /* corpo não-JSON: registrado como null */ }
  const errors = body?.errors && (Array.isArray(body.errors) ? body.errors : Object.entries(body.errors).map(([k, v]) => `${k}: ${v}`));
  const entry = { n: calls, label, path, status: r.status, ms, results: body?.results ?? null, errors: errors?.length ? errors : [], ratelimit: RL(r.headers) };
  log.push(entry); console.log(JSON.stringify(entry));
  return { r, body, entry };
}

const pick = (list, re) => list.find((l) => re.test(l.league.name)) ?? null;
const classify = ({ r, body, entry }, id) => {
  if (r.status >= 400) return "OTHER_ERROR";
  if (entry.errors.some((e) => /plan|season/i.test(e))) return "FREE_PLAN_SEASON_BLOCKED";
  const hit = (body?.response ?? []).find((x) => x.league?.id === id);
  if (!hit) return "COMPETITION_NOT_FOUND";
  return (hit.seasons ?? []).some((s) => s.year === 2026) ? "CONFIRMED_2026_ACCESS" : "OTHER_ERROR";
};

await api("/status", "conta/plano/uso");
const br = await api("/leagues?country=Brazil", "descoberta: ligas do Brasil");
const leagues = br.body?.response ?? [];
const serieA = pick(leagues, /^Serie A$/i) ?? pick(leagues, /brasileir/i), copa = pick(leagues, /^Copa Do Brasil$/i);
const summary = { serieA: null, copa: null };
for (const [k, found] of [["serieA", serieA], ["copa", copa]]) {
  if (!found) { summary[k] = { id: null, status: "COMPETITION_NOT_FOUND" }; continue; }
  const id = found.league.id;
  const seasons = (found.seasons ?? []).map((s) => s.year);
  const t = await api(`/leagues?id=${id}&season=2026`, `${k}: acesso à temporada 2026`);
  const cov = (t.body?.response?.[0]?.seasons ?? []).find((s) => s.year === 2026)?.coverage ?? (found.seasons ?? []).find((s) => s.year === 2026)?.coverage ?? null;
  summary[k] = { id, name: found.league.name, country: found.country?.name, seasonsAvailable: [seasons[0], seasons.at(-1)], status: classify(t, id), coverage: cov };
}
// Fixtures: só para ligas com 2026 acessível. 1 chamada `last` e 1 `next` por liga (≤ 4).
const ids = [];
for (const k of ["serieA", "copa"]) {
  const s = summary[k]; if (s?.status !== "CONFIRMED_2026_ACCESS") continue; ids.push(s.id);
  for (const q of ["last=2", "next=2"]) {
    const f = await api(`/fixtures?league=${s.id}&season=2026&${q}`, `${k}: fixtures ${q}`);
    if (f.body?.response?.length) writeFileSync(`${OUT}/${k}-${q.replace("=", "")}.json`, JSON.stringify(f.body, null, 1));
  }
}
// Semântica do `live`: UMA chamada com as duas ligas (formato documentado `live=ID-ID`). Só se ambas acessíveis.
if (ids.length === 2) {
  const lv = await api(`/fixtures?live=${ids.join("-")}`, "live multi-liga");
  const leaguesSeen = [...new Set((lv.body?.response ?? []).map((x) => x.league?.id))];
  summary.liveQuery = { status: lv.r.status, errors: lv.entry.errors, results: lv.entry.results, leaguesSeen, filteredToRequested: leaguesSeen.every((i) => ids.includes(i)) };
  if (lv.body?.response?.length) writeFileSync(`${OUT}/live.json`, JSON.stringify(lv.body, null, 1));
} else summary.liveQuery = "NOT_TESTABLE (competição sem acesso à temporada 2026 no plano Free)";
const last = log.at(-1);
console.log("\n=== RESUMO (sem segredo) ===");
console.log(JSON.stringify({ callsUsed: calls, remainingHeaders: last.ratelimit, ...summary }, null, 2));
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ callsUsed: calls, summary, log }, null, 1));
