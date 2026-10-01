// Sonda de egresso (DESCARTÁVEL) — Supabase Edge → API-Football. Mesmo contrato da sonda Cloudflare.
// Sem banco, sem service role, sem escrita. Implantar com --no-verify-jwt e autenticar por PROBE_TOKEN.
let used = 0;
Deno.serve(async (req: Request) => {
  if (req.headers.get("x-probe-token") !== Deno.env.get("PROBE_TOKEN")) return new Response("nao autorizado", { status: 401 });
  if (used >= 2) return Response.json({ error: "teto de 2 chamadas" }, { status: 429 });
  used++;
  const t0 = Date.now();
  try {
    const path = new URL(req.url).searchParams.get("path") ?? "/leagues?id=71&season=2026";
    const r = await fetch(`https://v3.football.api-sports.io${path}`, {
      headers: { "x-apisports-key": Deno.env.get("API_FOOTBALL_KEY") ?? "", accept: "application/json" }, signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - t0;
    let body: any = null; try { body = await r.json(); } catch { /* não-JSON */ }
    const rl = Object.fromEntries([...r.headers.entries()].filter(([k]) => /^x-ratelimit|retry-after/i.test(k)));
    return Response.json({ runtime: "supabase-edge", callNumber: used, providerStatus: r.status, contentType: r.headers.get("content-type"),
      looksLikeProviderJson: body !== null && typeof body === "object" && "response" in body, errorsKeys: body?.errors ? Object.keys(body.errors) : [],
      results: body?.results ?? null, latencyMs, ratelimit: rl });
  } catch (e) { return Response.json({ runtime: "supabase-edge", callNumber: used, transportError: e instanceof Error ? e.name : "Error", latencyMs: Date.now() - t0 }, { status: 502 }); }
});
