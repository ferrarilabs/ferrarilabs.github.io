/**
 * report_safe_context.js — o que PODE sair do navegador num reporte de problema (Issue #321).
 *
 * ─── A REGRA QUE ORIGINA O ARQUIVO INTEIRO ──────────────────────────────────────────────────
 *
 * Este modulo e uma ALLOWLIST, nunca uma denylist. Ele CONSTROI o objeto que sai, campo por campo,
 * em vez de receber um objeto do produto e tentar limpar o que nao deveria estar la.
 *
 * A diferenca importa no dia em que alguem adiciona um campo novo em algum lugar do app: com
 * denylist, o campo novo vaza por padrao e alguem precisa lembrar de proibi-lo; com allowlist, ele
 * simplesmente nao existe aqui. Nao ha `...contexto` nem `Object.assign` neste arquivo, e essa
 * ausencia e a garantia.
 *
 * ─── ISTO NAO E UMA FRONTEIRA DE SEGURANCA ──────────────────────────────────────────────────
 *
 * Tudo aqui roda no navegador do participante, que ele controla. Um atacante edita o payload a
 * vontade. Este modulo existe para impedir VAZAMENTO ACIDENTAL de quem esta agindo de boa-fe --
 * a URL com token na query, o nome no titulo da pagina, o storage cheio de estado.
 *
 * A fronteira de verdade e o servidor, que valida e sanitiza tudo de novo, sem confiar em nada
 * disto. Ver `support-intake/support-intake/supabase/functions/user-report-intake/`.
 *
 * ─── BARRAMENTO DE DIAGNOSTICO ──────────────────────────────────────────────────────────────
 *
 * O produto publica CODIGOS, nunca texto de erro. `Error.message`, corpo de resposta, erro de SQL e
 * excecao crua NUNCA entram num reporte: eles carregam, com frequencia, exatamente o dado que este
 * canal existe para nao coletar (referencia de pagamento numa mensagem do servidor, token numa URL
 * de erro, nome numa violacao de constraint).
 *
 * Codigo desconhecido vira `UNKNOWN_SAFE_ERROR`. Nunca o texto.
 */
(function (root) {
  "use strict";

  /** Diagnosticos que o produto pode publicar. Fora desta lista, nada entra num reporte. */
  var DIAGNOSTICOS = [
    "SAVE_ACCESS_DENIED",
    "SAVE_PHASE_CLOSED",
    "SAVE_CUTOFF",
    "SAVE_NETWORK_FAILURE",
    "LIVE_SOURCE_UNAVAILABLE",
    "LIVE_CACHE_STALE",
    "VALIDATION_ERROR",
    "UNKNOWN_SAFE_ERROR",
  ];

  var APPS = ["br2026", "cdb2026", "powerball", "copa2026", "platform"];
  var ENGINES = ["chromium", "webkit", "gecko", "unknown"];

  /** Limites — repetidos no servidor, que e quem de fato decide. */
  var LIMITES = {
    description: { min: 10, max: 1500 },
    attemptedAction: { max: 600 },
    routeId: { max: 64 },
    sectionId: { max: 64 },
    locale: { max: 12 },
    siteVersion: { max: 24 },
    viewport: { min: 120, max: 20000 },
  };

  /** Controles e caracteres invisiveis: servem para esconder conteudo, nunca para relatar algo. */
  var CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  var INVISIVEIS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

  /**
   * Rota SEGURA: so o caminho, sem query e sem hash, reduzido a um identificador estavel.
   *
   * A query e o hash sao onde token de entrada, id de pagamento e referencia de participante
   * costumam viajar neste projeto. Eles nunca saem daqui -- nem redigidos, nem truncados: sao
   * DESCARTADOS antes de qualquer coisa tocar o objeto de saida.
   *
   * Segmentos que parecem identificador (uuid, hash, numero longo) viram `:id`, para que a rota
   * continue util para agrupar sem carregar o identificador em si.
   */
  function rotaSegura(href) {
    var caminho;
    try {
      caminho = new URL(String(href || ""), "https://placeholder.invalid").pathname;
    } catch (e) {
      return "unknown";
    }
    var partes = caminho.split("/").filter(Boolean).map(function (p) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return ":id";
      if (/^[0-9a-f]{16,}$/i.test(p)) return ":id";
      if (/^\d{6,}$/.test(p)) return ":id";
      if (p.length > 40) return ":id";
      return p.toLowerCase().replace(/[^a-z0-9._-]/g, "");
    });
    var r = "/" + partes.join("/");
    return r.length > LIMITES.routeId.max ? r.slice(0, LIMITES.routeId.max) : r;
  }

  /** Motor do navegador, grosso. NAO a versao: versao exata e impressao digital sem uso provado. */
  function motor(ua) {
    var s = String(ua || "");
    if (/\bEdg\/|\bChrome\/|\bChromium\//.test(s) && !/\bOPR\//.test(s)) return "chromium";
    if (/\bSafari\//.test(s) && !/\bChrome\//.test(s)) return "webkit";
    if (/\bGecko\/|\bFirefox\//.test(s)) return "gecko";
    return "unknown";
  }

  function inteiroLimitado(v, lim) {
    var n = Math.trunc(Number(v));
    if (!isFinite(n)) return null;
    if (n < lim.min || n > lim.max) return null;
    return n;
  }

  function textoLimitado(v, max) {
    if (typeof v !== "string") return null;
    var t = v.replace(CONTROLES, "").replace(INVISIVEIS, "").trim();
    if (!t) return null;
    return t.length > max ? t.slice(0, max) : t;
  }

  function normalizarDiagnostico(codigo) {
    return DIAGNOSTICOS.indexOf(String(codigo)) !== -1 ? String(codigo) : "UNKNOWN_SAFE_ERROR";
  }

  /**
   * Barramento: o produto chama `publicarDiagnostico("SAVE_ACCESS_DENIED")` e o ultimo codigo fica
   * disponivel para o modal. Guarda SO o codigo e o instante -- nunca o erro.
   */
  var ultimo = null;
  function publicarDiagnostico(codigo) {
    ultimo = { code: normalizarDiagnostico(codigo), at: Date.now() };
    return ultimo.code;
  }
  function ultimoDiagnostico(janelaMs) {
    if (!ultimo) return null;
    var limite = typeof janelaMs === "number" ? janelaMs : 10 * 60 * 1000;
    return (Date.now() - ultimo.at) <= limite ? ultimo.code : null;
  }
  function limparDiagnostico() { ultimo = null; }

  function gerarReportId(w) {
    var c = (w && w.crypto) || (typeof crypto !== "undefined" ? crypto : null);
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    // Sem randomUUID nao ha entropia confiavel aqui; o servidor rejeita formato invalido, entao
    // devolver algo obviamente invalido e melhor que inventar um UUID fraco que PARECE valido.
    return "unsupported-no-crypto";
  }

  /**
   * Monta o payload. Cada campo e construido POR NOME a partir de fontes explicitas.
   *
   * Repare no que NAO existe aqui: nenhuma leitura de `localStorage`, `sessionStorage`,
   * `document.cookie`, `document.referrer`, `location.search`, `location.hash`, nem do
   * User-Agent completo. Nao e omissao -- e o desenho.
   */
  function montarPayload(opcoes) {
    var o = opcoes || {};
    var w = o.window || (typeof window !== "undefined" ? window : null);
    var nav = (w && w.navigator) || {};
    var loc = (w && w.location) || {};

    return {
      reportId: o.reportId || gerarReportId(w),
      app: APPS.indexOf(String(o.app)) !== -1 ? String(o.app) : "platform",
      siteVersion: textoLimitado(o.siteVersion, LIMITES.siteVersion.max) || "unknown",
      routeId: rotaSegura(loc.pathname || ""),
      sectionId: textoLimitado(o.sectionId, LIMITES.sectionId.max) || "unknown",
      locale: textoLimitado(o.locale, LIMITES.locale.max) || "pt-BR",
      timestamp: new Date().toISOString(),
      viewport: {
        w: inteiroLimitado(w && w.innerWidth, LIMITES.viewport),
        h: inteiroLimitado(w && w.innerHeight, LIMITES.viewport),
      },
      online: typeof nav.onLine === "boolean" ? nav.onLine : true,
      browserEngine: motor(nav.userAgent),
      diagnosticCode: normalizarDiagnostico(o.diagnosticCode || ultimoDiagnostico()),
      description: textoLimitado(o.description, LIMITES.description.max),
      attemptedAction: textoLimitado(o.attemptedAction, LIMITES.attemptedAction.max),
      sessionReportId: o.sessionReportId || null,
      honeypot: typeof o.honeypot === "string" ? o.honeypot : "",
    };
  }

  /** Forma exibivel do reporte: opaca, sem identidade, sem tempo, sem competicao. */
  function idExibivel(reportId) {
    var hex = String(reportId || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return hex ? "RPT-" + hex.slice(0, 8) : "RPT-????????";
  }

  root.BOLAO_REPORT_CONTEXT = {
    DIAGNOSTICOS: DIAGNOSTICOS,
    APPS: APPS,
    ENGINES: ENGINES,
    LIMITES: LIMITES,
    rotaSegura: rotaSegura,
    motor: motor,
    normalizarDiagnostico: normalizarDiagnostico,
    publicarDiagnostico: publicarDiagnostico,
    ultimoDiagnostico: ultimoDiagnostico,
    limparDiagnostico: limparDiagnostico,
    montarPayload: montarPayload,
    idExibivel: idExibivel,
  };
})(typeof window !== "undefined" ? window : globalThis);
