// Sonda de egresso (DESCARTÁVEL). Uma requisição HTTP autenticada por token → UMA chamada ao provedor →
// metadados SANITIZADOS (status, content-type, chaves de `errors`, `results`, x-ratelimit-*, tempos).
// Nunca devolve corpo nem chave. Teto de 2 chamadas ao provedor por instância (best effort).
let used = 0;
const PATH = "/leagues?id=71&season=2026";           // 1 requisição barata; o id real é o que a prova local descobrir
export default {
  async fetch(req: Request, env: { API_FOOTBALL_KEY: string; PROBE_TOKEN: string }): Promise<Response> {
    if (req.headers.get("x-probe-token") !== env.PROBE_TOKEN) return new Response("nao autorizado", { status: 401 });
    if (used >= 2) return new Response(JSON.stringify({ error: "teto de 2 chamadas" }), { status: 429 });
    used++;
    const t0 = Date.now();
    try {
      const r = await fetch(`https://v3.football.api-sports.io${new URL(req.url).searchParams.get("path") ?? PATH}`, {
        headers: { "x-apisports-key": env.API_FOOTBALL_KEY, accept: "application/json" }, signal: AbortSignal.timeout(10000),
      });
      const wallMs = Date.now() - t0;
      let body: any = null; try { body = await r.json(); } catch { /* não-JSON */ }
      const rl = Object.fromEntries([...r.headers.entries()].filter(([k]) => /^x-ratelimit|retry-after/i.test(k)));
      return Response.json({ runtime: "cloudflare", callNumber: used, providerStatus: r.status, contentType: r.headers.get("content-type"),
        looksLikeProviderJson: body !== null && typeof body === "object" && "response" in body, errorsKeys: body?.errors ? Object.keys(body.errors) : [],
        results: body?.results ?? null, wallMs, cf: { colo: (req as any).cf?.colo ?? null }, ratelimit: rl });
    } catch (e) { return Response.json({ runtime: "cloudflare", callNumber: used, transportError: e instanceof Error ? e.name : "Error", wallMs: Date.now() - t0 }, { status: 502 }); }
  },
};
