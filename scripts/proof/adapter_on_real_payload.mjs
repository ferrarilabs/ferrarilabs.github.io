#!/usr/bin/env node
/**
 * Roda payloads REAIS capturados (`.proof-out/*.json`) pelo adaptador API-Football e imprime a matriz de campos
 * e a reconciliação com o calendário ESPN. Offline: nenhuma rede, nenhuma escrita.
 *
 *   node scripts/proof/adapter_on_real_payload.mjs [.proof-out/serieA-last2.json ...]
 */
import { readFileSync, readdirSync } from "node:fs";
import { LEAGUES, STATUS_MAP, resolveIdentity, toCanonicalMatches, validateEnvelope } from "../../supabase/functions/_shared/providers/api_football.js";
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(".proof-out").filter((f) => /^(serieA|copa|live).*\.json$/.test(f)).map((f) => `.proof-out/${f}`);
if (!files.length) { console.error("nenhum payload em .proof-out/ — rode primeiro api_football_free_proof.mjs"); process.exit(2); }
const cal = (c) => JSON.parse(readFileSync(`bolao/${c}/data/espn-normalized.json`, "utf8")).matches;
const fieldMatrix = [
  ["fixture.id", "(só para identityMap/log)", "id canônico vem do calendário"],
  ["fixture.timestamp / date", "canonicalDate()", "date"], ["fixture.status.short", "STATUS_MAP", "state/statusName/completed/period"],
  ["fixture.status.elapsed/extra", "clockOf()", "clockSec/clockStr"], ["goals.home/away", "intOrNull()", "homeScore/awayScore"],
  ["teams.*.winner", "boolean", "homeWinner/awayWinner"], ["teams.*.name", "teamKey()+resolveIdentity()", "homeTeam/awayTeam/homeTeamId/awayTeamId (calendário)"],
  ["fixture.venue.name/city", "direct", "venue/city"], ["events[]", "detailsOf()", "details[]"], ["league.id", "LEAGUES filter", "competição"],
];
for (const f of files) {
  const raw = JSON.parse(readFileSync(f, "utf8"));
  console.log(`\n### ${f}`); console.log("envelope:", validateEnvelope(raw).length ? validateEnvelope(raw) : "OK");
  const present = (path, o) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o) !== undefined;
  const sample = raw.response?.[0];
  if (sample) console.log("campos presentes na 1ª fixture:", Object.fromEntries(["fixture.id", "fixture.timestamp", "fixture.status.short", "fixture.status.elapsed", "fixture.status.extra", "goals.home", "teams.home.winner", "fixture.venue.name", "events", "league.id"].map((p) => [p, present(p, sample)])));
  for (const comp of Object.keys(LEAGUES)) {
    const mine = (raw.response ?? []).filter((x) => x.league?.id === LEAGUES[comp].leagueId); if (!mine.length) continue;
    const calendar = cal(comp);
    const r = toCanonicalMatches(raw, { competition: comp, calendar });
    console.log(`${comp}: ${mine.length} fixtures → ${r.matches.length} canônicas, ${r.unmapped.length} unmapped`);
    for (const x of mine) { const id = resolveIdentity(x, calendar); console.log(`  fixture ${x.fixture.id} ${x.teams.home.name} x ${x.teams.away.name} [${x.fixture.status.short}${STATUS_MAP[x.fixture.status.short] ? "" : " STATUS DESCONHECIDO"}] → ${id.ok ? `ESPN ${id.entry.id} via ${id.via}` : `FAIL-CLOSED: ${id.reason}`}`); }
    if (r.matches[0]) console.log("  exemplo canônico:", JSON.stringify({ ...r.matches[0], details: `[${r.matches[0].details.length}]` }));
  }
}
console.log("\nMatriz (campo bruto → adaptador → canônico):"); for (const [a, b, c] of fieldMatrix) console.log(`  ${a} → ${b} → ${c}`);
console.log("\nPASS/FAIL por campo: confira 'campos presentes', 'unmapped' e o exemplo canônico acima contra o jogo real.");
