/**
 * index.ts — Cloudflare Worker `ferrarilabs-support-intake` (Issue #321).
 *
 * ─── A FRONTEIRA QUE ESTE ARQUIVO EXISTE PARA MANTER ────────────────────────────────────────
 *
 * A credencial financeira/de participante NAO EXISTE neste runtime. Nao por disciplina de codigo,
 * mas porque este Worker nao tem binding nenhum para o projeto do dinheiro -- nao ha D1, nao ha
 * Hyperdrive, nao ha service binding, nao ha `SUPABASE_*`. Um comprometimento total daqui alcanca
 * exatamente: a API do GitHub, com escopo de um repositorio privado e uma permissao.
 *
 * ─── ORDEM DAS DECISOES, E POR QUE ELA IMPORTA ──────────────────────────────────────────────
 *
 * 1. preflight            — CORS antes de tudo; navegador precisa de resposta mesmo desligado
 * 2. metodo / origem      — barato, e recusa nao revela nada
 * 3. INTERRUPTOR          — antes de QUALQUER dependencia: sem rate limit, sem DO, sem GitHub
 * 4. tipo / tamanho       — recusar 5 MB antes de parsear e nao pagar o custo do ataque
 * 5. config completa      — 503 generico, sem dizer o que falta
 * 6. schema               — allowlist; campo desconhecido reprova o corpo inteiro
 * 7. rajada (binding)     — pre-filtro barato, local ao colo
 * 8. estado (DO)          — a politica de verdade: limites, idempotencia, disjuntor
 * 9. GitHub               — so aqui existe credencial em memoria
 *
 * O interruptor esta no passo 3 de proposito. Se estivesse depois da configuracao, "provisionar
 * segredo" e "abrir o canal ao mundo" voltariam a ser a mesma coisa.
 */
import {
  validar, montarTitulo, montarCorpo, idExibivel, redigir, LIMITES, CAMPOS_ACEITOS,
} from "./policy.ts";
import { chaveDeRede, chaveIdempotencia, impressao } from "./identidade.ts";
import {
  obterTokenDeInstalacao, verificarDestinoPrivado, encontrarPorReportId, criarIssuePrivado,
} from "./github.ts";
import { classificar, comFalha } from "./falhas.ts";

export { EstadoDoIntake } from "./state.ts";

/** Origens reais do Ferrari Labs. Allowlist exata -- nunca `*`, nunca reflexo do recebido. */
export const ORIGENS_PERMITIDAS: readonly string[] = Object.freeze([
  "https://www.ferrarilabs.com",
  "https://ferrarilabs.com",
  "https://ferrarilabs.github.io",
]);

/** Segredos exigidos. A ausencia de qualquer um mantem o canal fechado. */
export const CONFIG_NECESSARIA: readonly string[] = Object.freeze([
  "REPORT_GITHUB_APP_ID",
  "REPORT_GITHUB_INSTALLATION_ID",
  "REPORT_GITHUB_PRIVATE_KEY",
  "REPORT_ABUSE_HMAC_SECRET",
  "REPORT_GITHUB_OWNER",
  "REPORT_GITHUB_REPO",
]);

/**
 * O interruptor de servidor. So a string exata liga.
 *
 * `"TRUE"`, `"1"`, `"yes"`, espaco sobrando, ausente e vazio significam DESLIGADO. Nao ha coercao e
 * nao ha "parece verdadeiro": um interruptor de seguranca que aceita sinonimos e um interruptor que
 * alguem liga sem querer.
 */
export const HABILITADO_VALOR_EXATO = "true";
export function intakeHabilitado(env: Record<string, unknown>): boolean {
  return (env ?? {}).REPORT_INTAKE_ENABLED === HABILITADO_VALOR_EXATO;
}

export function conferirConfig(env: Record<string, unknown>): { ok: boolean; faltando: string[] } {
  const faltando = CONFIG_NECESSARIA.filter((k) => !(env ?? {})[k]);
  return { ok: faltando.length === 0, faltando };
}

const CABECALHOS_BASE: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function cabecalhosCors(origem: string | null): Record<string, string> {
  if (!origem || !ORIGENS_PERMITIDAS.includes(origem)) return {};
  // Ecoa SO uma origem que ja estava na lista -- nunca a recebida sem conferir.
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/**
 * 204/205/304 PROIBEM corpo: `new Response("", { status: 204 })` LANCA, e a excecao vira 500.
 * Foi exatamente assim que o preflight de origem PERMITIDA quebrou em producao (#324) enquanto o de
 * origem proibida funcionava -- o unico caminho quebrado era o caminho feliz. `""` e `null` parecem
 * a mesma coisa e nao sao: so `null` e ausencia de corpo.
 */
const STATUS_SEM_CORPO = new Set([204, 205, 304]);

function responder(
  status: number,
  corpo: unknown,
  origem: string | null,
  versao: string,
  extra: Record<string, string> = {},
): Response {
  const headers = {
    ...CABECALHOS_BASE,
    ...cabecalhosCors(origem),
    // F-06: qual versao respondeu. Vem do binding `version_metadata`, entao ninguem precisa manter
    // um SHA sincronizado a mao. Nao e segredo -- e um identificador de publicacao.
    "x-deploy-id": versao,
    ...extra,
  };
  const body = STATUS_SEM_CORPO.has(status) ? null : JSON.stringify(corpo);
  return new Response(body, { status, headers });
}

type Log = (e: Record<string, unknown>) => void;

/**
 * Metrica agregada (F-11): so numeros e codigos estaveis, nunca conteudo.
 *
 * Nunca relato, nunca chave de rede, nunca reportId, nunca impressao. Se um contador puder
 * identificar uma pessoa, ele nao pertence aqui. `redigir()` ja sabe QUAIS classes de padrao
 * sensivel apareceram, e agregado isso responde algo acionavel: se muita gente escreve telefone, o
 * problema nao e o redator -- e o texto da tela.
 */
function metrica(log: Log, nome: string, extra: Record<string, unknown> = {}): void {
  log({ evento: "report_metrica", metrica: nome, ...extra });
}

async function tratar(req: Request, env: any, ctx: ExecutionContext, deps: any = {}): Promise<Response> {
  const log: Log = deps.log ?? ((evento) => console.log(JSON.stringify(evento)));
  const fetchImpl: typeof fetch = deps.fetchImpl ?? globalThis.fetch;
  const agora = deps.agora ?? (() => new Date());
  const versao = String(env?.VERSAO?.id ?? deps.versao ?? "desconhecida");
  const origem = req.headers.get("origin");
  const t0 = Date.now();

  // 1. Preflight. Responde mesmo com o canal desligado: CORS e mecanica do navegador, e faze-lo
  //    depender do interruptor produziria um erro de rede confuso em vez de uma recusa limpa.
  if (req.method === "OPTIONS") {
    if (!origem || !ORIGENS_PERMITIDAS.includes(origem)) {
      return responder(403, { error: "ORIGIN" }, null, versao);
    }
    return responder(204, null, origem, versao);
  }

  if (req.method !== "POST") return responder(405, { error: "METHOD" }, origem, versao);

  // Origem ausente e ACEITA de proposito: cliente nao-navegador e alguns contextos legitimos nao
  // mandam Origin, e recusar quebraria uso valido. A protecao real e o controle de abuso -- CORS
  // nunca foi autenticacao.
  if (origem && !ORIGENS_PERMITIDAS.includes(origem)) {
    metrica(log, "origem_rejeitada");
    return responder(403, { error: "ORIGIN" }, null, versao);
  }

  // 3. INTERRUPTOR — antes de qualquer dependencia.
  if (!intakeHabilitado(env)) {
    metrica(log, "desligado");
    return responder(503, { error: "UNAVAILABLE" }, origem, versao);
  }

  const tipo = String(req.headers.get("content-type") ?? "");
  if (!tipo.toLowerCase().startsWith("application/json")) {
    return responder(415, { error: "CONTENT_TYPE" }, origem, versao);
  }

  const bruto = await req.text();
  if (bruto.length > LIMITES.corpoBytes) {
    metrica(log, "corpo_grande");
    return responder(413, { error: "TOO_LARGE" }, origem, versao);
  }

  const cfg = conferirConfig(env);
  if (!cfg.ok) {
    // NUNCA diz QUAL falta: isso e mapa para quem sonda.
    log({ evento: "report_config_incompleta", faltando: cfg.faltando.length });
    return responder(503, { error: "UNAVAILABLE" }, origem, versao);
  }

  let corpo: unknown;
  try { corpo = JSON.parse(bruto); }
  catch { return responder(400, { error: "INVALID_JSON" }, origem, versao); }

  const v = validar(corpo);
  if (!v.ok) {
    metrica(log, "schema_rejeitado", { codigo: v.erro });
    // Honeypot recebe 202: dizer "voce falhou no honeypot" ensina a contorna-lo.
    if (v.erro === "ABUSE_HONEYPOT") {
      return responder(202, { ok: true, id: idExibivel((corpo as any)?.reportId) }, origem, versao);
    }
    return responder(400, { error: "INVALID" }, origem, versao);
  }
  const dados = v.dados;

  // Afirmacao da PLATAFORMA, nunca cabecalho que o cliente escreve.
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  const chaveRede = await chaveDeRede(env.REPORT_ABUSE_HMAC_SECRET, ip);
  if (!chaveRede) {
    // Sem sinal de rede confiavel nao ha como limitar abuso. Falha FECHADA.
    metrica(log, "sem_chave_rede");
    return responder(503, { error: "UNAVAILABLE" }, origem, versao);
  }

  // 7. Pre-filtro de rajada. Local ao colo e eventualmente consistente -- barato, e por isso vem
  //    antes do DO: enxurrada morre aqui sem acordar estado durável.
  if (env.RAJADA) {
    const { success } = await comFalha("RATE_LIMIT_FAILURE", () => env.RAJADA.limit({ key: chaveRede }));
    if (!success) {
      metrica(log, "rajada");
      return responder(429, { error: "RATE_LIMITED" }, origem, versao, { "Retry-After": "60" });
    }
  }

  const chaveIdem = await chaveIdempotencia(env.REPORT_ABUSE_HMAC_SECRET, chaveRede, dados.reportId);
  const estado = env.ESTADO.get(env.ESTADO.idFromName("global"));

  const decisao: any = await comFalha("STATE_FAILURE", async () =>
    (await estado.fetch("https://estado.invalid/", {
      method: "POST",
      body: JSON.stringify({ acao: "avaliar", chaveRede, chaveIdem, agora: agora().getTime() }),
    })).json());

  if (!decisao.ok) {
    metrica(log, decisao.motivo === "CIRCUIT_OPEN" ? "disjuntor" : "limitado", { motivo: decisao.motivo });
    const status = decisao.motivo === "EM_CURSO" ? 409 : 429;
    return responder(status, { error: decisao.motivo }, origem, versao, {
      "Retry-After": String(decisao.retryAfter),
    });
  }
  if (decisao.estado === "ja-criado") {
    // Idempotencia: o mesmo envio ja virou Issue. Devolve sucesso sem criar nada de novo, e sem
    // revelar o numero do Issue privado.
    metrica(log, "idempotente");
    return responder(200, { ok: true, id: idExibivel(dados.reportId) }, origem, versao);
  }

  try {
    const token = await obterTokenDeInstalacao({
      appId: env.REPORT_GITHUB_APP_ID,
      installationId: env.REPORT_GITHUB_INSTALLATION_ID,
      chavePrivadaPem: env.REPORT_GITHUB_PRIVATE_KEY,
      fetchImpl,
    });
    const owner = env.REPORT_GITHUB_OWNER;
    const repo = env.REPORT_GITHUB_REPO;

    // ULTIMA LINHA antes da divulgacao: o destino e PRIVADO agora, verificado no runtime. Config
    // deriva; esta checagem nao.
    await verificarDestinoPrivado({ token, owner, repo, fetchImpl });

    // Reconciliacao: se o processo morreu depois de criar a Issue e antes de confirmar o estado,
    // a Issue existe e o DO nao sabe. Procurar pelo reportId antes de criar fecha essa janela.
    const jaExiste = await encontrarPorReportId({ token, owner, repo, reportId: dados.reportId, fetchImpl });
    if (jaExiste) {
      await comFalha("STATE_FAILURE", () => estado.fetch("https://estado.invalid/", {
        method: "POST",
        body: JSON.stringify({ acao: "confirmar", chaveIdem, issue: jaExiste, agora: agora().getTime() }),
      }));
      metrica(log, "reconciliado");
      return responder(200, { ok: true, id: idExibivel(dados.reportId) }, origem, versao);
    }

    const fp = await impressao(env.REPORT_ABUSE_HMAC_SECRET, dados);
    const numero = await criarIssuePrivado({
      token, owner, repo,
      titulo: montarTitulo(dados),
      corpo: montarCorpo(dados, { recebidoEm: agora().toISOString(), fingerprint: fp }),
      labels: ["user-report", "status:untriaged", `app:${dados.app}`],
      fetchImpl,
    });

    await comFalha("STATE_FAILURE", () => estado.fetch("https://estado.invalid/", {
      method: "POST",
      body: JSON.stringify({ acao: "confirmar", chaveIdem, issue: numero, impressao: fp, agora: agora().getTime() }),
    }));

    metrica(log, "aceito", { app: dados.app, diagnostico: dados.diagnosticCode, latencia_ms: Date.now() - t0 });
    for (const c of classesRedigidas(dados)) metrica(log, "redigido", { classe: c });

    // O numero do Issue PRIVADO nunca sai: e informacao interna, e devolve-lo daria ao cliente um
    // ponteiro para o repositorio privado.
    return responder(201, { ok: true, id: idExibivel(dados.reportId) }, origem, versao);
  } catch (e) {
    // So o CODIGO -- e agora o codigo vem de uma ALLOWLIST, nao da mensagem do erro (#339).
    //
    // A versao anterior truncava `e.message` em 40 caracteres. Isso bastava para o cliente, e nunca
    // bastou para o log: a mensagem nasce de biblioteca, de runtime e do provedor, e pode carregar
    // fragmento de credencial. `classificar()` nao le `.message` -- ele devolve um membro de
    // `CODIGOS_DE_FALHA` ou `INTERNAL_UNKNOWN`.
    const codigo = classificar(e);
    log({ evento: "report_github_falhou", codigo, latencia_ms: Date.now() - t0 });
    // Libera a reserva para a pessoa poder tentar de novo em vez de esperar o TTL.
    //
    // O `.catch()` nao e decorativo: uma rejeicao dentro de `waitUntil` escapa das duas fronteiras
    // desta funcao e vira excecao NAO tratada do runtime -- que a plataforma registra com a mensagem
    // crua. Engolir aqui e o que mantem a garantia do #339 valida tambem neste caminho.
    ctx.waitUntil(
      estado.fetch("https://estado.invalid/", {
        method: "POST",
        body: JSON.stringify({ acao: "liberar", chaveIdem, agora: agora().getTime() }),
      }).then(() => undefined, () => { metrica(log, "liberacao_falhou"); }),
    );
    return responder(503, { error: "UNAVAILABLE" }, origem, versao);
  }
}

function classesRedigidas(dados: any): string[] {
  const a = redigir(dados.description).classes;
  const b = dados.attemptedAction ? redigir(dados.attemptedAction).classes : [];
  return [...new Set([...a, ...b])];
}

/**
 * Fronteira TOTAL contra excecao inesperada (F-15).
 *
 * O `try` interno cobre o que a gente PREVIU que falha (GitHub, rede). O caminho classico de
 * vazamento e o outro: o erro que ninguem previu, lancado de dentro de um parser, de um binding ou
 * de um runtime que mudou. Uma mensagem dessas carrega, com frequencia, caminho de arquivo, nome de
 * variavel de ambiente ou fragmento de configuracao.
 *
 * Aqui nada disso chega ao cliente: sempre o MESMO 503 generico, byte a byte. E deliberadamente NAO
 * se usa `ctx.passThroughOnException()`, que mandaria a requisicao para a origem e esconderia o
 * defeito em vez de trata-lo.
 */
export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    try {
      return await tratar(req, env, ctx);
    } catch (e) {
      // Allowlist, nao redacao (#339): o erro que chega aqui e, por definicao, o que ninguem previu
      // -- de um parser, de um binding, de um runtime que mudou. E exatamente essa mensagem que
      // costuma carregar caminho de arquivo, nome de variavel de ambiente ou pedaco de configuracao.
      const codigo = classificar(e);
      try { console.log(JSON.stringify({ evento: "report_excecao_nao_tratada", codigo })); } catch { /* log quebrado nao pode virar 500 */ }
      return new Response(JSON.stringify({ error: "UNAVAILABLE" }), {
        status: 503,
        headers: { ...CABECALHOS_BASE, "x-deploy-id": String(env?.VERSAO?.id ?? "desconhecida") },
      });
    }
  },
};

/** Exportado so para teste: exercita o handler com Request/Response REAIS. */
export const __teste = { tratar, responder, cabecalhosCors, classesRedigidas, STATUS_SEM_CORPO, classificar };
