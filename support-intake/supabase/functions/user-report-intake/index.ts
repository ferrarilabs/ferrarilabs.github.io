/**
 * index.ts — casca HTTP do intake de reportes (Issue #321).
 *
 * Deliberadamente fina. Toda a decisao mora em `handler.js`, que roda em Node e em Deno igualmente
 * -- e por isso o corpus adversarial inteiro e exercitado de verdade, sem rede e sem credencial.
 *
 * `verify_jwt = false`: o participante NAO precisa de conta para reportar um problema. Exigir
 * autenticacao aqui transformaria "achei um bug" em "crie uma conta", e o controle de abuso e feito
 * por limite de taxa pseudonimo, nao por identidade.
 */
import { tratarRequisicao, corpoDeResposta } from "./handler.js";

Deno.serve(async (req: Request) => {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const body = req.method === "POST" ? await req.text() : "";

  const env: Record<string, string> = {};
  for (const k of [
    "REPORT_GITHUB_APP_ID", "REPORT_GITHUB_INSTALLATION_ID", "REPORT_GITHUB_PRIVATE_KEY",
    "REPORT_GITHUB_OWNER", "REPORT_GITHUB_REPO", "REPORT_REDIS_REST_URL",
    "REPORT_REDIS_REST_TOKEN", "REPORT_ABUSE_HMAC_SECRET",
  ]) {
    const v = Deno.env.get(k);
    if (v) env[k] = v;
  }

  // Sinal de rede vindo do proxy da plataforma. NUNCA persistido: vira HMAC com componente de data
  // dentro de `handler`, e nem o valor cru nem o HMAC vao para log.
  const valorDeRede = headers["x-forwarded-for"]?.split(",")[0]?.trim() || null;

  const r = await tratarRequisicao(
    { method: req.method, headers, body },
    env,
    {
      valorDeRede,
      // Log estruturado por EVENTO. Nunca o corpo, nunca cabecalho cru, nunca erro cru.
      log: (e: unknown) => console.log(JSON.stringify(e)),
    },
  );

  // 204/205/304 exigem corpo `null`; passar "" lanca e o preflight vira 500.
  return new Response(corpoDeResposta(r.status, r.body), { status: r.status, headers: r.headers });
});
