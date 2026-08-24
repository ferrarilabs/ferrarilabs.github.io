/**
 * abuse.js — limite de taxa, idempotencia, deduplicacao e disjuntor (Issue #321).
 *
 * ─── ARMAZENAMENTO ISOLADO, DE PROPOSITO ────────────────────────────────────────────────────
 *
 * Este estado NAO mora no banco do Ferrarilabs. Vai para um Redis dedicado (Upstash, REST sobre
 * HTTPS) que existe so para controle de abuso do intake.
 *
 * O motivo e de fronteira, nao de performance: se o endpoint publico de reporte tivesse credencial
 * do banco de producao, um comprometimento dele viraria caminho para participante, pagamento,
 * palpite e ranking. Ele nao precisa do banco -- entao nao tem acesso a ele.
 *
 * O que pode viver aqui: chave pseudonima, contador, timestamp, estado de idempotencia,
 * impressao de duplicata, e o numero do Issue PRIVADO. Nada mais.
 * O que NUNCA vive aqui: relato, nome, e-mail, telefone, pagamento, token, palpite.
 *
 * ─── IP NUNCA E PERSISTIDO ──────────────────────────────────────────────────────────────────
 *
 * A chave de rede e `HMAC-SHA256(segredo, YYYY-MM-DD || valor_de_rede)`. Guarda-se so o HMAC.
 * O componente de data faz a chave rotacionar sozinha todo dia, entao ninguem consegue seguir um
 * visitante ao longo do tempo -- nem nos. E o HMAC tambem nao vai para log.
 */

const enc = new TextEncoder();

/** Chave pseudonima de rede. `valorDeRede` vazio => `null` (o chamador cai para chave de sessao). */
export async function chaveDeRede(segredo, valorDeRede, hoje) {
  if (!segredo || !valorDeRede) return null;
  const material = `${hoje}|${valorDeRede}`;
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(material));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Impressao para deduplicacao. HMAC, nao hash puro.
 *
 * Um hash sem chave sobre texto de baixa entropia ("nao consigo salvar") e reversivel por
 * dicionario: quem tivesse o dump conseguiria testar frases ate achar a que gerou a impressao.
 * Com HMAC, sem o segredo isso nao anda.
 */
export async function impressao(segredo, dados) {
  const material = [dados.app, dados.diagnosticCode, dados.routeId,
                    dados.description.toLowerCase().replace(/\s+/g, " ").trim()].join("|");
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(segredo || "sem-segredo"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(material));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/**
 * Cliente Redis por REST. `fetchImpl` injetavel para teste sem rede.
 *
 * Host FIXO: a URL vem de variavel de ambiente do servidor e nunca do corpo da requisicao. Deixar o
 * cliente escolher o destino seria SSRF de manual.
 */
export function criarRedis({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 4000 }) {
  if (!url || !token) return null;

  async function comando(...args) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw new Error(`REDIS_HTTP_${r.status}`);
      const j = await r.json();
      return j.result;
    } finally {
      clearTimeout(t);
    }
  }

  return {
    /**
     * INCR + EXPIRE atomico o suficiente: o INCR e atomico, e o EXPIRE so e aplicado quando o
     * contador acabou de nascer. Um `GET` seguido de `SET` teria corrida -- duas requisicoes
     * simultaneas leriam o mesmo valor e ambas passariam.
     */
    async contar(chave, janelaSeg) {
      const n = await comando("INCR", chave);
      if (n === 1) await comando("EXPIRE", chave, String(janelaSeg));
      return n;
    },
    async marcarSeNovo(chave, valor, ttlSeg) {
      const r = await comando("SET", chave, valor, "NX", "EX", String(ttlSeg));
      return r === "OK";
    },
    async definir(chave, valor, ttlSeg) { return comando("SET", chave, valor, "EX", String(ttlSeg)); },
    async ler(chave) { return comando("GET", chave); },
  };
}

/**
 * Avalia todos os limites. Devolve `{ permitido, motivo, retryAfter }`.
 *
 * FALHA FECHADO: se o Redis nao responde, o reporte e RECUSADO. A alternativa -- aceitar sem
 * controle -- transforma uma indisponibilidade do limitador em canal aberto de spam para um
 * repositorio privado, e o custo de um participante ter de tentar de novo em alguns minutos e
 * muito menor que o de milhares de Issues.
 */
export async function avaliarLimites(redis, { chaveRede, chaveSessao, politica = null }) {
  const p = politica || (await import("./policy.js")).ABUSO;
  if (!redis) return { permitido: false, motivo: "RATE_STORE_UNAVAILABLE", retryAfter: 60 };

  try {
    if (await redis.ler("breaker:open")) {
      return { permitido: false, motivo: "CIRCUIT_OPEN", retryAfter: 300 };
    }

    const sujeito = chaveRede || (chaveSessao ? `s:${chaveSessao}` : null);
    if (sujeito) {
      for (const { limite, janelaSeg } of p.porRede) {
        const n = await redis.contar(`rl:${sujeito}:${janelaSeg}`, janelaSeg);
        if (n > limite) {
          return { permitido: false, motivo: "RATE_LIMITED", retryAfter: Math.min(janelaSeg, 900) };
        }
      }
    }

    for (const { limite, janelaSeg } of p.global) {
      const n = await redis.contar(`rl:global:${janelaSeg}`, janelaSeg);
      if (n > limite) {
        // Estourar o teto global e sinal de ataque, nao de uso. Fecha o intake por um tempo em vez
        // de deixar cada requisicao seguinte pagar o custo de avaliar tudo de novo.
        await redis.definir("breaker:open", "1", p.disjuntorSeg);
        return { permitido: false, motivo: "CIRCUIT_OPEN", retryAfter: Math.min(p.disjuntorSeg, 900) };
      }
    }

    return { permitido: true };
  } catch {
    return { permitido: false, motivo: "RATE_STORE_UNAVAILABLE", retryAfter: 60 };
  }
}

/**
 * Idempotencia em duas fases.
 *
 * `processing` (TTL curto) segura a janela entre "comecei" e "criei o Issue". `created` (7 dias)
 * responde sucesso sem criar de novo.
 *
 * A janela que importa e a do meio: o Issue foi criado no GitHub e o `created` nao chegou a ser
 * gravado (queda, timeout). Numa nova tentativa, o chamador RECONCILIA procurando o `report_id`
 * nos Issues recentes do repositorio privado ANTES de criar outro -- ver `github.js`. Sem isso,
 * uma falha de rede vira Issue duplicada, e a duplicata carrega o mesmo relato pessoal.
 */
/**
 * Chave de idempotencia REAL: amarra o `reportId` a QUEM enviou.
 *
 * O `reportId` e gerado no navegador, entao um cliente hostil pode escolher o que quiser --
 * inclusive o `reportId` de outra pessoa. Se a chave fosse so `idem:<reportId>`, bastaria
 * reserva-lo primeiro para que o relato legitimo colidisse com uma idempotencia ja em curso: o
 * participante veria sucesso e a Issue nunca apareceria. Supressao silenciosa e pior que recusa,
 * porque ninguem fica sabendo.
 *
 * Derivar de `chaveDeRede || reportId` faz remetentes diferentes ocuparem espacos de chave
 * diferentes. O `reportId` continua sendo o identificador que a pessoa ve na tela (`RPT-XXXXXXXX`)
 * e o que correlaciona um pedido de remocao -- ele so deixa de ser a chave de controle.
 *
 * Sem `chaveDeRede` (limitador indisponivel) o handler ja recusou antes de chegar aqui; o
 * fallback existe para nao produzir uma chave `undefined` silenciosa em teste.
 */
export async function chaveIdempotencia(segredo, chaveRede, reportId) {
  const material = `${chaveRede || "sem-rede"}|${reportId}`;
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(segredo || "sem-segredo"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(material));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function reservarIdempotencia(redis, chaveIdem, politica) {
  const p = politica || (await import("./policy.js")).ABUSO;
  const chave = `idem:${chaveIdem}`;
  const anterior = await redis.ler(chave);
  if (anterior && String(anterior).startsWith("created")) {
    return { estado: "created", valor: String(anterior) };
  }
  const novo = await redis.marcarSeNovo(chave, "processing", 60);
  return novo ? { estado: "novo" } : { estado: "em-curso" };
}

export async function confirmarIdempotencia(redis, chaveIdem, numeroIssue, politica) {
  const p = politica || (await import("./policy.js")).ABUSO;
  await redis.definir(`idem:${chaveIdem}`, `created:${numeroIssue}`, p.idempotenciaSeg);
}

/** Duplicata: mesma impressao dentro da janela. Devolve a contagem de ocorrencias. */
export async function registrarDuplicata(redis, fp, politica) {
  const p = politica || (await import("./policy.js")).ABUSO;
  const n = await redis.contar(`dup:${fp}`, p.duplicataSeg);
  return { duplicado: n > 1, ocorrencia: n };
}

/**
 * Metricas agregadas, sem conteudo (F-11).
 *
 * ─── O QUE ENTRA ────────────────────────────────────────────────────────────────────────────
 *
 * Contadores por DIA e por DESFECHO. Nunca relato, nunca chave de rede, nunca reportId, nunca
 * impressao digital. Se um contador puder identificar uma pessoa, ele nao pertence a este arquivo.
 *
 * ─── POR QUE ISTO IMPORTA MAIS DO QUE PARECE ────────────────────────────────────────────────
 *
 * `redigir()` ja devolve QUAIS classes de padrao sensivel bateram, e esse dado hoje morre no
 * retorno. Agregado, ele diz algo acionavel: se 40% dos relatos trazem telefone, o problema nao e o
 * redator -- e o texto da tela, que esta convidando a pessoa a se identificar. Sem isso, ninguem
 * descobre que o aviso nao esta funcionando.
 *
 * E um disjuntor que abre em silencio e um disjuntor que ninguem conserta.
 *
 * ─── FALHA ABERTA, DE PROPOSITO ─────────────────────────────────────────────────────────────
 *
 * Ao contrario do limite de taxa, metrica NAO pode derrubar um reporte legitimo: perder um
 * contador e irrelevante, perder o relato de alguem nao e. Por isso este e o unico lugar do
 * modulo que engole o erro.
 */
export async function registrarMetrica(redis, chave, dia) {
  if (!redis) return;
  const d = dia || new Date().toISOString().slice(0, 10);
  try { await redis.contar(`m:${d}:${chave}`, 60 * 60 * 24 * 35); }
  catch { /* metrica nunca derruba reporte — ver o cabecalho desta funcao */ }
}
