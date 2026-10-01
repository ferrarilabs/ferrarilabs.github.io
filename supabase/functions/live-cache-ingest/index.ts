// live-cache-ingest — porta de ENTRADA estreita do cache ao vivo.
//
// Quem BUSCA no provedor (API-Football) é um agendador fora do GitHub (Worker da Cloudflare); este
// endpoint recebe o corpo CRU e faz TODO o resto no núcleo canônico (`live_ingest_core.js`):
// valida o envelope, resolve a identidade contra o calendário, mescla ao cache e grava. A credencial
// de escrita (service role) nunca sai do Supabase; o chamador só porta um token que serve para ESTE
// endpoint e nada mais.
//
// FALHA FECHADA: sem LIVE_INGEST_TOKEN a função responde 503. Merge desta pasta a implanta INERTE.
import { handleIngest, INGEST_COMPETITIONS } from "../_shared/live_ingest_core.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const WRITE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_TOKEN = Deno.env.get("LIVE_INGEST_TOKEN") ?? "";
// Calendário canônico = o snapshot commitado, servido como arquivo estático público (o mesmo que os apps leem).
const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "https://www.ferrarilabs.com";
const CACHE_TABLE = "live_sports_cache";
const CALENDAR_TTL_MS = 10 * 60_000;

const calendarMemo = new Map<string, { at: number; value: unknown }>();
async function loadCalendar(competition: string) {
  const hit = calendarMemo.get(competition);
  if (hit && Date.now() - hit.at < CALENDAR_TTL_MS) return hit.value;
  try {
    const r = await fetch(`${SITE_ORIGIN}/bolao/${competition}/data/espn-normalized.json`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return hit?.value ?? null;           // calendário velho é melhor que nenhum
    const j = await r.json();
    const value = { matches: j.matches ?? [], generatedAt: j.generatedAt ?? null };
    calendarMemo.set(competition, { at: Date.now(), value });
    return value;
  } catch { return hit?.value ?? null; }
}

async function readExisting(competition: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${CACHE_TABLE}?competition=eq.${competition}&select=payload,observed_at`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return (await r.json())?.[0] ?? null;
  } catch { return null; }
}

// Mesmo UPSERT idempotente do gateway e do produtor atual: chave `competition`, merge-duplicates.
async function writeSharedCache({ competition, payload, observedAt }: { competition: string; payload: unknown; observedAt: string }) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${CACHE_TABLE}`, {
      method: "POST",
      headers: { apikey: WRITE_KEY, Authorization: `Bearer ${WRITE_KEY}`,
                 "content-type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ competition, payload, observed_at: observedAt, stored_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.error(`[live-cache-ingest] escrita recusada: HTTP ${r.status}`);
    return r.ok;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  const bodyText = req.method === "POST" ? await req.text() : "";
  const { status, body } = await handleIngest(
    { method: req.method, url: req.url, headers: { authorization: req.headers.get("authorization") ?? "" }, bodyText },
    { ingestToken: INGEST_TOKEN, writeImpl: WRITE_KEY ? writeSharedCache : undefined, readExisting, loadCalendar },
  );
  // Log operacional: status e contagem, nunca o corpo nem o token.
  console.log(JSON.stringify({ component: "live-cache-ingest", status, competitions: INGEST_COMPETITIONS.length }));
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
});
