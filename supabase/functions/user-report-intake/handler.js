/**
 * handler.js — o fluxo de intake, isolado do runtime HTTP (Issue #321).
 *
 * Mesmo padrao do `gateway_core.js`: a Edge Function roda em Deno, que nao esta instalado nesta
 * maquina. Se a decisao morasse dentro do handler do Deno, ela so existiria onde nao da para
 * executa-la, e "testar" viraria reescrever a logica no teste -- o padrao de falso-verde que este
 * repositorio ja pagou caro.
 *
 * Tudo que decide esta aqui, com transporte injetado. Node testa este arquivo de verdade; Deno
 * importa o mesmo arquivo.
 */

import { validar, montarTitulo, montarCorpo, ABUSO, LIMITES, idExibivel } from "./policy.js";
import {
  criarRedis, chaveDeRede, impressao, avaliarLimites,
  reservarIdempotencia, confirmarIdempotencia, registrarDuplicata,
} from "./abuse.js";
import {
  obterTokenDeInstalacao, verificarDestinoPrivado, encontrarPorReportId,
  criarIssuePrivado, comentarOcorrencia,
} from "./github.js";

/**
 * Origens permitidas. Derivadas do CNAME real deste repositorio, nunca adivinhadas.
 *
 * CORS nao e autenticacao: um cliente que nao seja navegador ignora tudo isto. Por isso o controle
 * de abuso e obrigatorio de qualquer forma. O que o CORS entrega e impedir que uma pagina de
 * terceiro use o navegador de um participante logado como trampolim.
 */
export const ORIGENS_PERMITIDAS = Object.freeze([
  "https://www.ferrarilabs.com",
  "https://ferrarilabs.com",
  "https://ferrarilabs.github.io",
]);

export const CONFIG_NECESSARIA = Object.freeze([
  "REPORT_GITHUB_APP_ID",
  "REPORT_GITHUB_INSTALLATION_ID",
  "REPORT_GITHUB_PRIVATE_KEY",
  "REPORT_GITHUB_OWNER",
  "REPORT_GITHUB_REPO",
  "REPORT_REDIS_REST_URL",
  "REPORT_REDIS_REST_TOKEN",
  "REPORT_ABUSE_HMAC_SECRET",
]);

/**
 * Credenciais que este endpoint JAMAIS pode usar.
 *
 * O Supabase injeta os segredos do projeto em TODAS as Edge Functions -- entao
 * `SUPABASE_SERVICE_ROLE_KEY` esta presente no ambiente desta funcao, queira-se ou nao. A fronteira
 * aqui e de CODIGO, nao de plataforma: nada neste diretorio le esses nomes, e um gate reprova se
 * alguem passar a ler. Esta lista existe para esse gate ter alvo explicito.
 */
export const CREDENCIAIS_PROIBIDAS = Object.freeze([
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SUPABASE_DB_URL",
  "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_JWKS",
]);

const CABECALHOS_BASE = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

function cabecalhosCors(origem) {
  if (!origem || !ORIGENS_PERMITIDAS.includes(origem)) return {};
  // Ecoa SO uma origem que ja estava na lista -- nunca a recebida sem conferir.
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function resposta(status, corpo, origem, extra = {}) {
  return {
    status,
    headers: { ...CABECALHOS_BASE, ...cabecalhosCors(origem), ...extra },
    body: JSON.stringify(corpo),
  };
}

/** Config faltando => indisponivel. NUNCA diz QUAL falta: isso e mapa para quem sonda. */
export function conferirConfig(env) {
  const faltando = CONFIG_NECESSARIA.filter((k) => !env[k]);
  return { ok: faltando.length === 0, faltando };
}

/**
 * Fluxo completo. `deps` injeta transporte e relogio para o teste.
 *
 * Retorna `{status, headers, body}` — sem tocar em `Response`, que so existe no runtime.
 */
export async function tratarRequisicao(req, env, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const log = deps.log || (() => {});
  const agora = deps.agora || (() => new Date());
  const origem = req.headers?.origin || null;

  if (req.method === "OPTIONS") {
    // Preflight de origem desconhecida recebe 403 SEM cabecalho de CORS: o navegador ja bloqueia,
    // e responder 204 alegremente para qualquer um sugere uma permissao que nao existe.
    if (!origem || !ORIGENS_PERMITIDAS.includes(origem)) return resposta(403, { error: "ORIGIN" }, null);
    return { status: 204, headers: { ...cabecalhosCors(origem), "Cache-Control": "no-store" }, body: "" };
  }

  if (req.method !== "POST") return resposta(405, { error: "METHOD" }, origem);

  // Origem ausente e ACEITA de proposito: cliente nao-navegador e alguns contextos legitimos nao
  // mandam Origin, e recusar quebraria uso valido. A protecao real e o controle de abuso, nao isto.
  if (origem && !ORIGENS_PERMITIDAS.includes(origem)) {
    log({ evento: "report_origin_rejected" });
    return resposta(403, { error: "ORIGIN" }, null);
  }

  const tipo = String(req.headers?.["content-type"] || "");
  if (!tipo.toLowerCase().startsWith("application/json")) {
    return resposta(415, { error: "CONTENT_TYPE" }, origem);
  }

  // Tamanho conferido ANTES de parsear: parsear 5 MB de JSON hostil para depois recusar e pagar o
  // custo do ataque.
  const bruto = String(req.body ?? "");
  if (bruto.length > LIMITES.corpoBytes) {
    log({ evento: "report_schema_rejected", codigo: "BODY_TOO_LARGE" });
    return resposta(413, { error: "TOO_LARGE" }, origem);
  }

  const cfg = conferirConfig(env);
  if (!cfg.ok) {
    log({ evento: "report_config_incomplete", faltando: cfg.faltando.length });
    return resposta(503, { error: "UNAVAILABLE" }, origem);
  }

  let corpo;
  try { corpo = JSON.parse(bruto); }
  catch { return resposta(400, { error: "INVALID_JSON" }, origem); }

  const v = validar(corpo);
  if (!v.ok) {
    log({ evento: "report_schema_rejected", codigo: v.erro });
    // Honeypot recebe 202 e nao 400: dizer "voce falhou no honeypot" ensina a contorna-lo.
    if (v.erro === "ABUSE_HONEYPOT") return resposta(202, { ok: true, id: idExibivel(corpo.reportId) }, origem);
    return resposta(400, { error: "INVALID" }, origem);
  }
  const dados = v.dados;

  const redis = criarRedis({ url: env.REPORT_REDIS_REST_URL, token: env.REPORT_REDIS_REST_TOKEN, fetchImpl });
  const hoje = agora().toISOString().slice(0, 10);
  const chaveRede = await chaveDeRede(env.REPORT_ABUSE_HMAC_SECRET, deps.valorDeRede || null, hoje);

  const limites = await avaliarLimites(redis, { chaveRede, chaveSessao: dados.reportId.slice(0, 8) });
  if (!limites.permitido) {
    log({ evento: limites.motivo === "RATE_LIMITED" ? "report_rate_limited" : "report_unavailable",
          codigo: limites.motivo });
    const status = limites.motivo === "RATE_LIMITED" ? 429 : 503;
    return resposta(status, { error: limites.motivo === "RATE_LIMITED" ? "RATE_LIMITED" : "UNAVAILABLE" },
                    origem, { "Retry-After": String(limites.retryAfter || 60) });
  }

  const idem = await reservarIdempotencia(redis, dados.reportId);
  if (idem.estado === "created") {
    log({ evento: "report_duplicate", codigo: "IDEMPOTENT_REPLAY" });
    return resposta(200, { ok: true, id: idExibivel(dados.reportId) }, origem);
  }
  if (idem.estado === "em-curso") {
    return resposta(409, { error: "IN_PROGRESS" }, origem, { "Retry-After": "10" });
  }

  const t0 = Date.now();
  try {
    const token = await obterTokenDeInstalacao({
      appId: env.REPORT_GITHUB_APP_ID,
      installationId: env.REPORT_GITHUB_INSTALLATION_ID,
      chavePrivadaPem: env.REPORT_GITHUB_PRIVATE_KEY,
      fetchImpl,
    });

    const owner = env.REPORT_GITHUB_OWNER;
    const repo = env.REPORT_GITHUB_REPO;

    // Ultima linha antes da divulgacao. Conferida no runtime, contra a API -- nao assumida.
    await verificarDestinoPrivado({ token, owner, repo, fetchImpl });

    const jaExiste = await encontrarPorReportId({ token, owner, repo, reportId: dados.reportId, fetchImpl });
    if (jaExiste) {
      await confirmarIdempotencia(redis, dados.reportId, jaExiste);
      log({ evento: "report_duplicate", codigo: "RECONCILED" });
      return resposta(200, { ok: true, id: idExibivel(dados.reportId) }, origem);
    }

    const fp = await impressao(env.REPORT_ABUSE_HMAC_SECRET, dados);
    const dup = await registrarDuplicata(redis, fp);

    const numero = await criarIssuePrivado({
      token, owner, repo,
      titulo: montarTitulo(dados),
      corpo: montarCorpo(dados, {
        recebidoEm: agora().toISOString(),
        duplicado: dup.duplicado, ocorrencia: dup.ocorrencia, fingerprint: fp,
      }),
      labels: ["user-report", "status:untriaged", `app:${dados.app}`],
      fetchImpl,
    });

    await confirmarIdempotencia(redis, dados.reportId, numero);
    log({ evento: "report_github_created", app: dados.app, diagnostico: dados.diagnosticCode,
          duplicado: dup.duplicado, latencia_ms: Date.now() - t0 });

    // O numero do Issue PRIVADO nunca sai: e informacao interna, e devolve-lo daria ao cliente um
    // ponteiro para o repositorio privado.
    return resposta(201, { ok: true, id: idExibivel(dados.reportId) }, origem);
  } catch (e) {
    // So o CODIGO. O objeto de erro pode carregar corpo de resposta do GitHub, e corpo de resposta
    // de auth pode carregar fragmento de credencial.
    const codigo = String(e && e.message || "UNKNOWN").slice(0, 40);
    log({ evento: "report_github_failed", codigo, latencia_ms: Date.now() - t0 });
    return resposta(503, { error: "UNAVAILABLE" }, origem);
  }
}
