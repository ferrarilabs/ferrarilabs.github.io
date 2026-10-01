/**
 * Contrato hermético do Worker direto (sem GitHub Actions): relógio + ponte de egresso.
 * Tudo injetado (fetch/sleep); nenhuma rede, nenhuma credencial real.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tick } from "./src/index.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const INGEST = "https://abcdefghij.supabase.co/functions/v1/live-cache-ingest";
const KEY = "CHAVE-DE-PROVEDOR-DE-TESTE", TOKEN = "TOKEN-DE-INGESTAO-DE-TESTE";
const ENV = { PRODUCER_MODE: "shadow", INGEST_URL: INGEST, API_FOOTBALL_KEY: KEY, LIVE_INGEST_TOKEN: TOKEN, OBSERVATIONS_PER_TICK: "1", INTERVAL_MS: "15000", MIN_REMAINING_REQUESTS: "200" };

let ok = 0, fail = 0;
const teste = async (n, f) => { try { await f(); console.log(`  ✓ ${n}`); ok++; } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const afirma = (c, m) => { if (!c) throw new Error(m || "assercao falhou"); };

const PLANO = { requests: [{ kind: "live", competitions: ["br2026", "cdb2026"], path: "/fixtures?live=71-73" }, { kind: "day", competitions: ["br2026"], path: "/fixtures?league=71&season=2026&from=2026-10-04&to=2026-10-05" }] };
/** Servidor falso: ingest + provedor. `cfg` ajusta respostas. */
function mundo(cfg = {}) {
  const log = [];
  const f = async (url, o = {}) => {
    const u = String(url); log.push({ url: u, o });
    if (u.startsWith(INGEST) && u.includes("plan=1")) return new Response(JSON.stringify(cfg.plano ?? PLANO), { status: cfg.planStatus ?? 200 });
    if (u.startsWith("https://v3.football.api-sports.io/")) {
      const st = cfg.providerStatus ?? 200;
      return new Response(st === 200 ? JSON.stringify({ errors: [], response: [] }) : "x", { status: st, headers: { "x-ratelimit-requests-remaining": String(cfg.remaining ?? 5000) } });
    }
    if (u.startsWith(INGEST)) return new Response(JSON.stringify(cfg.ingestBody ?? { results: [] }), { status: cfg.ingestStatus ?? 200 });
    throw new Error(`host inesperado: ${u}`);
  };
  return { f, log, provider: () => log.filter((l) => l.url.startsWith("https://v3.football")), ingest: () => log.filter((l) => l.url.startsWith(INGEST) && !l.url.includes("plan=1")) };
}

console.log("\nLive producer direto — fail closed e inerte por padrão\n");
await teste("modo off (padrão): não toca a rede", async () => { const w = mundo(); const r = await tick({ ...ENV, PRODUCER_MODE: "off" }, { fetchImpl: w.f }); afirma(r.action === "OFF" && w.log.length === 0, JSON.stringify(r)); });
await teste("modo ausente/inválido: trata como off", async () => { const w = mundo(); const r = await tick({ ...ENV, PRODUCER_MODE: "qualquer" }, { fetchImpl: w.f }); afirma(r.action === "OFF" && w.log.length === 0); });
for (const faltando of ["API_FOOTBALL_KEY", "LIVE_INGEST_TOKEN"]) await teste(`sem ${faltando}: SEM_CREDENCIAL e nenhuma chamada`, async () => { const w = mundo(); const r = await tick({ ...ENV, [faltando]: "" }, { fetchImpl: w.f }); afirma(r.action === "SEM_CREDENCIAL" && w.log.length === 0); });
for (const url of ["https://evil.example/x", "https://abc.supabase.co/functions/v1/live-football", "http://abc.supabase.co/functions/v1/live-cache-ingest", ""])
  await teste(`INGEST_URL fora da forma fechada (${url || "vazio"}): CONFIG_INVALIDA e o token não sai`, async () => { const w = mundo(); const r = await tick({ ...ENV, INGEST_URL: url }, { fetchImpl: w.f }); afirma(r.action === "CONFIG_INVALIDA" && w.log.length === 0, JSON.stringify(r)); });

console.log("\nPlano e janela\n");
await teste("função diz que não há o que buscar: ZERO chamadas ao provedor (cota preservada)", async () => {
  const w = mundo({ plano: { requests: [] } }); const r = await tick(ENV, { fetchImpl: w.f });
  afirma(r.action === "SEM_JANELA" && r.providerCalls === 0 && w.provider().length === 0, JSON.stringify(r));
});
await teste("plano recusado (401/503/transporte): para sem chamar o provedor", async () => {
  for (const st of [401, 503]) { const w = mundo({ planStatus: st }); const r = await tick(ENV, { fetchImpl: w.f }); afirma(r.action === "PLANO_RECUSADO" && w.provider().length === 0, String(st)); }
  const r = await tick(ENV, { fetchImpl: async () => { throw Object.assign(new Error("segredo?"), { name: "TimeoutError" }); } }); afirma(r.action === "PLANO_RECUSADO" && !JSON.stringify(r).includes("segredo"));
});

console.log("\nPonte provedor → ingest\n");
await teste("shadow: busca no provedor com a chave só no cabeçalho e envia ao ingest com dry_run=1", async () => {
  const w = mundo(); const r = await tick(ENV, { fetchImpl: w.f });
  afirma(r.action === "OBSERVADO" && r.providerCalls === 2 && r.ingestCalls === 3, JSON.stringify(r));
  for (const p of w.provider()) { afirma(p.o.headers["x-apisports-key"] === KEY, "chave fora do cabeçalho"); afirma(!p.url.includes(KEY), "chave na URL"); }
  for (const i of w.ingest()) { afirma(i.url.includes("dry_run=1"), "shadow gravaria"); afirma(i.o.headers.authorization === `Bearer ${TOKEN}`); afirma(!i.url.includes(TOKEN), "token na URL"); afirma(!(i.o.body ?? "").includes(KEY), "chave vazou no corpo"); }
});
await teste("authoritative: sem dry_run; a chave de provedor nunca vai ao ingest e o token nunca vai ao provedor", async () => {
  const w = mundo(); await tick({ ...ENV, PRODUCER_MODE: "authoritative" }, { fetchImpl: w.f });
  afirma(w.ingest().every((i) => !i.url.includes("dry_run")), "dry_run em authoritative");
  afirma(w.provider().every((p) => !JSON.stringify(p).includes(TOKEN)), "token foi ao provedor");
  afirma(w.ingest().every((i) => !JSON.stringify(i).includes(KEY)), "chave foi ao ingest");
});
await teste("o corpo do provedor é repassado CRU (nenhuma normalização no Worker)", async () => {
  const w = mundo(); await tick(ENV, { fetchImpl: w.f }); afirma(w.ingest()[0].o.body === JSON.stringify({ errors: [], response: [] }));
});
await teste("caminho vindo do plano fora da forma fechada NÃO é seguido (nunca vira proxy aberto)", async () => {
  const w = mundo({ plano: { requests: [{ kind: "live", competitions: ["br2026"], path: "https://evil.example/x" }, { kind: "live", competitions: ["br2026"], path: "/status" }, { kind: "live", competitions: ["br2026"], path: "/fixtures?live=71-73/../x" }] } });
  await tick(ENV, { fetchImpl: w.f }); afirma(w.provider().length === 0, "seguiu caminho inseguro");
});
await teste("followUp do ingest é executado UMA vez (dedupe) e respeita o teto por observação", async () => {
  const fu = { kind: "day", competitions: ["br2026"], path: "/fixtures?league=71&season=2026&from=2026-10-04&to=2026-10-05" };
  const w = mundo({ plano: { requests: [PLANO.requests[0]] }, ingestBody: { results: [], followUp: [fu, fu] } }); const r = await tick(ENV, { fetchImpl: w.f });
  afirma(r.providerCalls === 2, `esperava live + 1 followUp, veio ${r.providerCalls}`);
  const inf = Array.from({ length: 40 }, (_, i) => ({ kind: "day", competitions: ["br2026"], path: `/fixtures?league=71&season=2026&from=2026-10-${10 + (i % 20)}&to=2026-10-${10 + (i % 20)}&x=${i}` }));
  const w2 = mundo({ plano: { requests: inf } }); const r2 = await tick(ENV, { fetchImpl: w2.f }); afirma(r2.providerCalls <= 5, `teto estourado: ${r2.providerCalls}`);
});

console.log("\nFalhas do provedor nunca viram observação\n");
for (const [st, razao] of [[401, "AUTH"], [403, "AUTH"], [429, "RATE_LIMITED"], [500, "UPSTREAM"], [503, "UPSTREAM"]]) {
  await teste(`provedor HTTP ${st}: PARADO (${razao}), NENHUM ingest, nada gravado`, async () => {
    const w = mundo({ providerStatus: st }); const r = await tick({ ...ENV, PRODUCER_MODE: "authoritative", OBSERVATIONS_PER_TICK: "3" }, { fetchImpl: w.f, sleep: async () => {} });
    afirma(r.action === "PARADO" && r.stopReason === razao, JSON.stringify(r)); afirma(w.ingest().length === 0, "enviou ao ingest apesar da falha"); afirma(w.provider().length === 1, "insistiu apesar da falha");
  });
}
await teste("falha de transporte do provedor: PARADO sem vazar a mensagem da exceção", async () => {
  const f = async (u) => { if (String(u).includes("plan=1")) return new Response(JSON.stringify(PLANO)); throw Object.assign(new Error(KEY), { name: "TimeoutError" }); };
  const r = await tick(ENV, { fetchImpl: f }); afirma(r.action === "PARADO" && !JSON.stringify(r).includes(KEY));
});
await teste("guarda de cota: restante abaixo do mínimo encerra o disparo (protege o plano Free/Pro)", async () => {
  const w = mundo({ remaining: 150 }); const r = await tick({ ...ENV, PRODUCER_MODE: "authoritative" }, { fetchImpl: w.f }); afirma(r.stopReason === "QUOTA_GUARD", JSON.stringify(r));
});
await teste("ingest 401/503: PARADO (token/configuração errados não são insistidos)", async () => {
  for (const st of [401, 503]) { const w = mundo({ ingestStatus: st }); const r = await tick(ENV, { fetchImpl: w.f }); afirma(r.action === "PARADO", String(st)); afirma(w.provider().length === 1, "continuou apos recusa"); }
});

console.log("\nModo rápido (várias observações por disparo)\n");
await teste("OBSERVATIONS_PER_TICK=4 faz 4 observações espaçadas por INTERVAL_MS e respeita o teto de 20", async () => {
  const sleeps = []; const w = mundo({ plano: { requests: [PLANO.requests[0]] } });
  const r = await tick({ ...ENV, OBSERVATIONS_PER_TICK: "4", INTERVAL_MS: "15000" }, { fetchImpl: w.f, sleep: async (ms) => { sleeps.push(ms); } });
  afirma(r.observations === 4 && sleeps.length === 3 && sleeps.every((s) => s === 15000), JSON.stringify({ r, sleeps }));
  const r2 = await tick({ ...ENV, OBSERVATIONS_PER_TICK: "9999" }, { fetchImpl: mundo({ plano: { requests: [PLANO.requests[0]] } }).f, sleep: async () => {} }); afirma(r2.observations === 20, String(r2.observations));
});
await teste("o modo rápido para sozinho quando a janela fecha no meio do disparo", async () => {
  let n = 0; const base = mundo();
  const f = async (u, o) => (String(u).includes("plan=1") && ++n > 2 ? new Response(JSON.stringify({ requests: [] })) : base.f(u, o));
  const r = await tick({ ...ENV, OBSERVATIONS_PER_TICK: "6" }, { fetchImpl: f, sleep: async () => {} }); afirma(r.action === "SEM_JANELA" && r.observations === 2, JSON.stringify(r));
});

console.log("\nSuperfície do Worker\n");
await teste("a fonte não contém credencial de banco, ESPN, nem tabela; padrão é off; cron de 1 min; sem endereço público", async () => {
  const fonte = readFileSync(join(AQUI, "src/index.ts"), "utf8"), cfg = readFileSync(join(AQUI, "wrangler.jsonc"), "utf8");
  const exec = `${fonte}\n${cfg}`.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.split("//")[0]).join("\n");
  for (const proibido of ["SUPABASE_SERVICE_ROLE_KEY", "site.api.espn.com", "live_sports_cache", "rest/v1", "GH_DISPATCH_TOKEN", "api.github.com"]) afirma(!exec.includes(proibido), `Worker toca ${proibido}`);
  afirma(/"PRODUCER_MODE"\s*:\s*"off"/.test(cfg), "padrão não é off"); afirma(/"crons"\s*:\s*\[\s*"\* \* \* \* \*"\s*\]/.test(cfg), "cron não é de 1 min");
  afirma(/"workers_dev"\s*:\s*false/.test(cfg) && /"preview_urls"\s*:\s*false/.test(cfg), "endereço público");
  afirma(/"required"\s*:\s*\[\s*"API_FOOTBALL_KEY"\s*,\s*"LIVE_INGEST_TOKEN"\s*\]/.test(cfg), "segredos declarados");
});
await teste("log do scheduled não contém chave nem token", async () => {
  const w = mundo(); const linhas = []; const orig = console.log; console.log = (s) => linhas.push(String(s));
  try { const m = await import("./src/index.ts"); await m.default.scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, ENV, {}); } finally { console.log = orig; }
  afirma(!linhas.join("").includes(KEY) && !linhas.join("").includes(TOKEN), "segredo no log");
});

console.log(`\n  ${ok} passed, ${fail} failed\n`);
console.log(fail ? "✗ LIVE PRODUCER DIRECT FAILED" : "✓ LIVE PRODUCER DIRECT OK");
process.exit(fail ? 1 : 0);
