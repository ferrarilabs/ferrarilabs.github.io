#!/usr/bin/env node
// CONTRATO DO RELAY DE INGESTÃO DO CACHE AO VIVO — migração de custo do GitHub Actions.
// Hermético: sem rede, sem banco. Prova as propriedades que precisam valer ANTES de qualquer deploy:
//   · falha fechada (sem token configurado / token errado → nada é aceito nem gravado);
//   · UMA implementação: o registro do relay é idêntico ao do produtor atual para o mesmo corpo cru;
//   · forma inválida / não-JSON / competição fora da whitelist NUNCA gravam;
//   · dry_run não grava; a única tabela tocada é live_sports_cache; o token nunca é ecoado;
//   · o relay é autônomo (sem imports do repositório) e só segue URLs da ESPN;
//   · reexecução é idempotente (mesma chave de upsert).
// Uso: node bolao/shared/scripts/test_live_ingest.mjs
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  INGEST_COMPETITIONS, MAX_BODY_BYTES, buildCacheRecord, handleIngest, isActive, tokenMatches,
} from "../../../supabase/functions/_shared/live_ingest_core.js";
import { produceOne, PRODUCED_COMPETITIONS } from "./produce_live_cache.mjs";
import { espnUrlFor } from "../../../supabase/functions/_shared/gateway_core.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let pass = 0, fail = 0;
const test = async (n, f) => { try { await f(); console.log(`  ✓ ${n}`); pass++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const NOW = Date.parse("2026-08-20T18:00:00Z");
const TOKEN = "token-de-teste-nao-real-0123456789";
const raw = (state = "in", date = "2026-08-20T17:30Z") => ({
  events: [{ id: "900001", date, competitions: [{
    status: { clock: 1800, displayClock: "30'", period: 1, type: { state, name: "STATUS_IN_PROGRESS", description: "In Progress", shortDetail: "30'", detail: "30'", completed: false } },
    venue: { fullName: "Arena", address: { city: "Cidade" } },
    competitors: [
      { homeAway: "home", score: "1", winner: false, team: { id: "1", displayName: "Cruzeiro" } },
      { homeAway: "away", score: "0", winner: false, team: { id: "2", displayName: "Mirassol" } }],
    details: [] }] }],
});
const post = (competition, body, { token = TOKEN, query = "" } = {}) => ({
  method: "POST", url: `https://x.invalid/ingest?competition=${competition}${query}`,
  headers: { authorization: token === null ? "" : `Bearer ${token}` }, bodyText: typeof body === "string" ? body : JSON.stringify(body),
});
const writes = []; const writeImpl = async (w) => { writes.push(w); return true; };
const run = (req, extra = {}) => handleIngest(req, { ingestToken: TOKEN, writeImpl, now: NOW, ...extra });

console.log("\nRelay de ingestão — autenticação e falha fechada\n");
await test("sem token configurado: 503 e nada gravado (nunca cai para aberto)", async () => {
  writes.length = 0; const r = await handleIngest(post("br2026", raw()), { ingestToken: "", writeImpl, now: NOW });
  eq(r.status, 503, "status"); eq(writes.length, 0, "gravou");
});
for (const [nome, tk] of [["sem Authorization", null], ["token errado", "outro"], ["token vazio", ""]]) {
  await test(`${nome}: 401 e nada gravado`, async () => { writes.length = 0; const r = await run(post("br2026", raw(), { token: tk })); eq(r.status, 401, "status"); eq(writes.length, 0, "gravou"); });
}
await test("tokenMatches é estrito (prefixo, sufixo e não-string)", () => {
  assert(tokenMatches(TOKEN, TOKEN)); assert(!tokenMatches(TOKEN + "x", TOKEN)); assert(!tokenMatches(TOKEN.slice(1), TOKEN));
  assert(!tokenMatches(undefined, TOKEN)); assert(!tokenMatches(TOKEN, ""));
});
await test("a resposta nunca contém o token", async () => {
  for (const r of [await run(post("br2026", raw())), await run(post("br2026", "{")), await run(post("br2026", raw(), { token: "x" }))])
    assert(!JSON.stringify(r).includes(TOKEN), "token vazou");
});

console.log("\nRelay de ingestão — comportamento de escrita\n");
await test("POST válido grava UMA linha em live_sports_cache com a chave `competition`", async () => {
  writes.length = 0; const r = await run(post("br2026", raw()));
  eq(r.status, 200, "status"); eq(r.body.action, "WRITTEN", "action"); eq(writes.length, 1, "escritas");
  eq(writes[0].competition, "br2026", "chave"); eq(Object.keys(writes[0]).sort(), ["competition", "observedAt", "payload"], "campos");
});
await test("UMA implementação: registro do relay === registro do produtor atual (mesmo corpo cru)", async () => {
  const viaRelay = buildCacheRecord("br2026", raw(), { now: NOW });
  const viaProdutor = await produceOne("br2026", { fetchImpl: async () => ({ ok: true, status: 200, json: async () => raw() }), now: NOW, force: true });
  eq(viaRelay.payload, viaProdutor.payload, "payload divergiu");
});
await test("PRODUCED_COMPETITIONS do produtor === INGEST_COMPETITIONS do núcleo (fonte única)", () => eq(PRODUCED_COMPETITIONS, [...INGEST_COMPETITIONS], "lista"));
await test("reexecução é idempotente: mesma chave, mesmo corpo, mesmo registro", async () => {
  writes.length = 0; await run(post("br2026", raw())); await run(post("br2026", raw()));
  eq(writes.length, 2, "escritas"); eq(writes[0].payload, writes[1].payload, "payload"); eq(writes[0].competition, writes[1].competition, "chave");
});
await test("dry_run valida mas NÃO grava", async () => {
  writes.length = 0; const r = await run(post("br2026", raw(), { query: "&dry_run=1" }));
  eq(r.status, 200, "status"); eq(r.body.action, "DRY_RUN", "action"); eq(writes.length, 0, "gravou");
});
await test("forma inválida: 422 e NUNCA grava (último-bom-conhecido preservado)", async () => {
  writes.length = 0; const r = await run(post("br2026", { events: "nao-e-lista" })); eq(r.status, 422, "status"); eq(writes.length, 0, "gravou");
});
await test("corpo que não é JSON (ex.: página 'Access Denied' em HTML): 400 e não grava", async () => {
  writes.length = 0; const r = await run(post("br2026", "<html>Access Denied</html>")); eq(r.status, 400, "status"); eq(writes.length, 0, "gravou");
});
await test("competição fora da whitelist (copa2026 arquivada, lixo, traversal): 400 e não grava", async () => {
  for (const c of ["copa2026", "../../etc", "BR2026", "", "br2026;x", "br2026%00"]) { writes.length = 0; const r = await run(post(c, raw())); eq(r.status, 400, c); eq(writes.length, 0, c); }
});
await test("corpo acima do limite: 413", async () => {
  writes.length = 0; const r = await run(post("br2026", "x".repeat(MAX_BODY_BYTES + 1))); eq(r.status, 413, "status"); eq(writes.length, 0, "gravou");
});
await test("sem credencial de escrita: 503 e o pedido real não finge sucesso", async () => {
  const r = await handleIngest(post("br2026", raw()), { ingestToken: TOKEN, writeImpl: undefined, now: NOW }); eq(r.status, 503, "status");
});
await test("escrita recusada pelo banco vira 502 (nunca sucesso silencioso)", async () => {
  const r = await run(post("br2026", raw()), { writeImpl: async () => false }); eq(r.status, 502, "status"); eq(r.body.action, "WRITE_FAILED", "action");
});
await test("métodos fora de GET(plan)/POST: 405; GET sem ?plan=1: 400", async () => {
  eq((await run({ method: "DELETE", url: "https://x.invalid/i", headers: { authorization: `Bearer ${TOKEN}` }, bodyText: "" })).status, 405, "DELETE");
  eq((await run({ method: "GET", url: "https://x.invalid/i", headers: { authorization: `Bearer ${TOKEN}` }, bodyText: "" })).status, 400, "GET");
});
await test("?plan=1 devolve as URLs da ESPN geradas por espnUrlFor (sem duplicar o mapa no relay)", async () => {
  const r = await run({ method: "GET", url: "https://x.invalid/i?plan=1", headers: { authorization: `Bearer ${TOKEN}` }, bodyText: "" });
  eq(r.body.competitions, INGEST_COMPETITIONS.map((competition) => ({ competition, url: espnUrlFor(competition) })), "plano");
});
await test("isActive: ao vivo ou apito em [-3h,+1h] liga; encerrado antigo/futuro distante desliga", () => {
  const m = (state, date) => ({ state, date });
  assert(isActive([m("in", "2026-08-20T12:00Z")], NOW)); assert(isActive([m("pre", "2026-08-20T18:30Z")], NOW));
  assert(isActive([m("post", "2026-08-20T15:30Z")], NOW)); assert(!isActive([m("post", "2026-08-20T10:00Z")], NOW));
  assert(!isActive([m("pre", "2026-08-21T20:00Z")], NOW)); assert(!isActive([], NOW));
});

console.log("\nRelay (público) — autonomia e segurança do template\n");
const relaySrc = readFileSync(join(REPO, "infra/live-relay/relay.mjs"), "utf8");
const relayWf = readFileSync(join(REPO, "infra/live-relay/.github/workflows/relay.yml"), "utf8");
await test("relay.mjs é autônomo: nenhum import do repositório nem de pacote", () => assert(!/^\s*import\s/m.test(relaySrc) && !/require\(/.test(relaySrc), "tem import"));
await test("relay.mjs só segue URL da ESPN e não conhece chave de banco/service role", () => {
  assert(relaySrc.includes("site.api.espn.com/apis/site/v2/sports/soccer/")); assert(!/SERVICE_ROLE|SUPABASE_[A-Z_]*KEY|rest\/v1/.test(relaySrc), "conhece credencial de banco");
});
await test("workflow do relay: só dispatch (sem cron), permissão mínima, só o token de ingestão", () => {
  assert(!/schedule:|cron:/.test(relayWf), "tem cron"); assert(/workflow_dispatch:/.test(relayWf)); assert(/permissions:\s*\n\s*contents:\s*read/.test(relayWf));
  assert(!/contents:\s*write|id-token|issues:\s*write/.test(relayWf)); const segredos = [...relayWf.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]);
  eq([...new Set(segredos)], ["LIVE_INGEST_TOKEN"], "segredos");
});
await test("relay ponta a ponta (fetch simulado): GET plano → ESPN → POST → grava; encerra sem jogo ativo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  try {
    const stub = join(dir, "stub.mjs");
    writeFileSync(stub, `
      import { handleIngest } from ${JSON.stringify(pathToFileURL(join(REPO, "supabase/functions/_shared/live_ingest_core.js")).href)};
      const RAW = ${JSON.stringify(raw("pre", "2026-12-31T20:00Z"))}; const writes = []; globalThis.__w = writes;
      globalThis.fetch = async (url, o = {}) => {
        const u = String(url);
        if (u.startsWith("https://site.api.espn.com/")) return new Response(JSON.stringify(RAW), { status: 200 });
        const r = await handleIngest({ method: o.method ?? "GET", url: u, headers: o.headers ?? {}, bodyText: o.body ?? "" },
          { ingestToken: "T", writeImpl: async (w) => { writes.push(w.competition); return true; } });
        return new Response(JSON.stringify(r.body), { status: r.status });
      };
      process.on("exit", () => console.log("WRITES=" + writes.join(",")));
    `);
    const p = spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, join(REPO, "infra/live-relay/relay.mjs"), "--loop"], {
      env: { ...process.env, INGEST_URL: "https://abc123.supabase.co/functions/v1/live-cache-ingest", LIVE_INGEST_TOKEN: "T" }, encoding: "utf8", timeout: 20_000,
    });
    assert(p.status === 0, `saida ${p.status}: ${p.stderr}`); assert(p.stdout.includes("WRITES=br2026,cdb2026"), p.stdout); assert(/ativa=false/.test(p.stdout), "deveria encerrar sem ciclar");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
await test("relay recusa configuração fora da forma fechada (URL arbitrária não recebe o token)", () => {
  const p = spawnSync(process.execPath, [join(REPO, "infra/live-relay/relay.mjs")], { env: { ...process.env, INGEST_URL: "https://evil.example/x", LIVE_INGEST_TOKEN: "T" }, encoding: "utf8", timeout: 10_000 });
  eq(p.status, 2, "status");
});

console.log("\nSuperfície do endpoint\n");
await test("a função só escreve em live_sports_cache e nunca em tabela de participante/pagamento", () => {
  const src = readFileSync(join(REPO, "supabase/functions/live-cache-ingest/index.ts"), "utf8");
  const tabelas = [...src.matchAll(/rest\/v1\/\$\{([A-Z_]+)\}/g)].map(m => m[1]); eq(tabelas, ["CACHE_TABLE"], "tabelas");
  assert(/CACHE_TABLE\s*=\s*"live_sports_cache"/.test(src)); assert(!/bolao_state|participant|payment|ledger/i.test(src));
});
await test("config.toml declara a função sem JWT do Supabase (token próprio) e a gateway continua intacta", () => {
  const t = readFileSync(join(REPO, "supabase/config.toml"), "utf8");
  assert(/\[functions\.live-cache-ingest\][^[]*verify_jwt\s*=\s*false/.test(t)); assert(/\[functions\.live-football\][^[]*verify_jwt\s*=\s*false/.test(t));
});

console.log(`\n${pass} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
