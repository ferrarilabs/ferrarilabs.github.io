#!/usr/bin/env node
// live-relay — o ÚNICO trabalho que exige um runner do GitHub: o GET na ESPN.
//
// Zero lógica de negócio: não valida, não normaliza, não decide janela, não conhece o banco. Pergunta
// à função `live-cache-ingest` O QUE buscar (?plan=1), busca o corpo CRU e o entrega de volta. Toda a
// inteligência vive no repositório privado (supabase/functions/_shared/live_ingest_core.js).
//
// Segredo: apenas LIVE_INGEST_TOKEN (serve só para o endpoint de ingestão). Nenhuma chave de banco.
// Sem dependências: Node 20+.
//
//   INGEST_URL=https://<projeto>.supabase.co/functions/v1/live-cache-ingest \
//   LIVE_INGEST_TOKEN=... node relay.mjs [--dry-run] [--loop]

const INGEST_URL = process.env.INGEST_URL ?? "";
const TOKEN = process.env.LIVE_INGEST_TOKEN ?? "";
const ESPN_PREFIX = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const INTERVAL_MS = 15_000;
const DURATION_MS = 5 * 60_000 + 30_000;   // até o próximo despacho cancelar (concurrency)
const dryRun = process.argv.includes("--dry-run");
const loop = process.argv.includes("--loop");

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/live-cache-ingest$/.test(INGEST_URL) || !TOKEN) {
  console.error("INGEST_URL (forma fechada) e LIVE_INGEST_TOKEN sao obrigatorios"); process.exit(2);
}
const auth = { authorization: `Bearer ${TOKEN}` };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function passada(plan) {
  let ativa = false, falhas = 0;
  for (const { competition, url } of plan) {
    // O plano vem de fora: só se segue URL da ESPN, nunca um endereço arbitrário.
    if (typeof url !== "string" || !url.startsWith(ESPN_PREFIX)) { console.error(`  [${competition}] URL fora da ESPN — ignorada`); falhas++; continue; }
    let espn;
    try { espn = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) }); }
    catch (e) { console.error(`  [${competition}] falha de transporte: ${e?.name ?? "Error"}`); falhas++; continue; }
    if (!espn.ok) { console.error(`  [${competition}] ESPN HTTP ${espn.status}`); falhas++; continue; }
    const corpo = await espn.text();
    const r = await fetch(`${INGEST_URL}?competition=${encodeURIComponent(competition)}${dryRun ? "&dry_run=1" : ""}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: corpo, signal: AbortSignal.timeout(20_000),
    });
    const resp = await r.json().catch(() => ({}));
    console.log(`  [${competition}] ingest HTTP ${r.status} ${resp.action ?? ""} ${resp.matches ?? ""} ativa=${resp.active ?? "?"}`);
    if (!r.ok) falhas++; else if (resp.active) ativa = true;
  }
  return { ativa, falhas };
}

const p = await fetch(`${INGEST_URL}?plan=1`, { headers: auth, signal: AbortSignal.timeout(15_000) });
if (!p.ok) { console.error(`plano recusado: HTTP ${p.status}`); process.exit(1); }
const { competitions } = await p.json();
const fim = Date.now() + DURATION_MS;
let falhasTotal = 0;
do {
  const { ativa, falhas } = await passada(competitions);
  falhasTotal += falhas;
  // Nada em andamento nem perto: uma observação basta, o runner encerra (não bate na fonte à toa).
  if (!loop || !ativa || Date.now() + INTERVAL_MS >= fim) break;
  await dorme(INTERVAL_MS);
} while (Date.now() < fim);
process.exit(falhasTotal ? 1 : 0);
