// live-cache-ingest — porta de ENTRADA do cache ao vivo para um relay de egresso.
//
// POR QUE EXISTE: só um runner do GitHub alcança a ESPN (Akamai nega Cloudflare e Supabase). Com o
// repositório privado o runner custa minutos; num repositório PÚBLICO mínimo ele é gratuito. Esse
// relay só faz o GET e entrega o corpo CRU aqui. Toda a lógica (forma, normalização, envelope,
// gravação) roda NESTA função, no mesmo núcleo que o produtor atual usa (`live_ingest_core.js`).
// A credencial de escrita (service role) nunca sai do Supabase; o relay só porta um token que serve
// para ESTE endpoint e para nada mais.
//
// FALHA FECHADA: sem LIVE_INGEST_TOKEN a função responde 503. Merge desta pasta implanta a função
// inerte; ela só passa a aceitar tráfego quando o segredo for criado (ver o runbook de cutover).
import { handleIngest } from "../_shared/live_ingest_core.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const WRITE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_TOKEN = Deno.env.get("LIVE_INGEST_TOKEN") ?? "";
const CACHE_TABLE = "live_sports_cache";

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
    { ingestToken: INGEST_TOKEN, writeImpl: WRITE_KEY ? writeSharedCache : undefined },
  );
  // Log operacional: ação e contagem, nunca o corpo nem o token.
  console.log(JSON.stringify({ component: "live-cache-ingest", status, action: (body as any)?.action ?? null }));
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
});
