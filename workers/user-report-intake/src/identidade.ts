/**
 * identidade.ts — chaves pseudônimas de abuso, sem nunca guardar quem é a pessoa (Issue #321).
 *
 * ─── O QUE ENTRA E O QUE SAI ────────────────────────────────────────────────────────────────
 *
 * Entra: o IP que a PLATAFORMA afirma (`CF-Connecting-IP`), nunca um cabecalho que o cliente possa
 * escrever. Sai: um HMAC truncado. O IP cru nao e persistido, nao vai para log, e nao volta em
 * resposta nenhuma.
 *
 * ─── POR QUE `CF-Connecting-IP` E NAO `X-Forwarded-For` ─────────────────────────────────────
 *
 * `X-Forwarded-For` e um cabecalho de REQUISICAO: qualquer cliente escreve o que quiser nele. Usa-lo
 * como chave de limite significaria que trocar de identidade custa uma linha de curl. O
 * `CF-Connecting-IP` e escrito pela borda da Cloudflare depois de terminar a conexao TCP/TLS -- e
 * afirmacao da plataforma, nao do remetente.
 *
 * ─── NORMALIZACAO IPv6 (/64) ────────────────────────────────────────────────────────────────
 *
 * Em IPv4 uma pessoa tem um endereco. Em IPv6 ela recebe rotineiramente um /64 inteiro -- bilhoes
 * de enderecos -- e trocar de endereco dentro dele nao custa nada. Limitar por endereco IPv6
 * completo seria um limite que qualquer um contorna sem esforco. Agrupar pelo /64 mede o que de
 * fato corresponde a um assinante.
 *
 * ─── POR QUE A CHAVE NAO CARREGA MAIS A DATA (F-09, corrigido de verdade) ───────────────────
 *
 * A versao anterior punha a data no material do HMAC, para a chave "rotacionar sozinha todo dia".
 * O teste da janela deslizante provou que isso NAO resolvia o F-09 -- resolvia o oposto: se a
 * CHAVE muda a meia-noite, o limite de 24h zera junto, por mais deslizante que a contagem seja.
 * Nao da para ter limite de 24 horas medido sobre um identificador que troca a cada 24 horas.
 *
 * A rotacao continua existindo, so que pelo lado certo: o estado durável APAGA os registros mais
 * velhos que a janela (ver `limpar()` em `state.ts`). O resultado e mais forte que antes -- nenhum
 * identificador sobrevive a janela de qualquer jeito -- e o limite longo passa a significar o que
 * promete.
 *
 * A chave continua pseudonima: HMAC com segredo do servidor, irreversivel sem ele, e o IP cru
 * nunca e persistido nem logado.
 */

const enc = new TextEncoder();

async function hmac(segredo: string, material: string, bytes: number): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(material));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, bytes);
}

/**
 * Reduz um IPv6 ao prefixo /64. IPv4 volta inteiro.
 *
 * Feito sobre a forma textual de proposito: o valor so precisa ser ESTAVEL para virar chave, nao
 * canonico. Uma biblioteca de parsing de IP aqui seria dependencia nova para ganhar exatidao que
 * ninguem consome -- e dependencia nova neste Worker e superficie nova.
 */
export function normalizarRede(ip: string): string {
  const s = String(ip || "").trim().toLowerCase();
  if (!s) return "";
  if (!s.includes(":")) return s; // IPv4

  // `::` expande para os grupos que faltam; so os 4 primeiros (64 bits) interessam.
  const [esq, dir] = s.includes("::") ? s.split("::", 2) : [s, null];
  const a = esq ? esq.split(":").filter(Boolean) : [];
  const b = dir ? dir.split(":").filter(Boolean) : [];
  const faltando = 8 - a.length - b.length;
  const grupos = dir === null ? a : [...a, ...Array(Math.max(0, faltando)).fill("0"), ...b];
  const prefixo = grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  while (prefixo.length < 4) prefixo.push("0");
  return prefixo.join(":") + "::/64";
}

/** Chave de taxa: pseudonima e ESTAVEL. A rotacao vem da expiracao no estado, nao da chave. */
export async function chaveDeRede(segredo: string, ip: string): Promise<string | null> {
  const rede = normalizarRede(ip);
  if (!segredo || !rede) return null;
  return hmac(segredo, `rede|${rede}`, 32);
}

/**
 * Chave de idempotencia REAL (F-04): amarra o `reportId` a QUEM enviou.
 *
 * O `reportId` nasce no navegador, entao um cliente hostil escolhe o que quiser -- inclusive o de
 * outra pessoa. Se a chave fosse o `reportId` cru, bastava reserva-lo primeiro para que o relato
 * legitimo colidisse com uma idempotencia ja em curso: a pessoa veria sucesso e a Issue nunca
 * apareceria. Supressao silenciosa e pior que recusa, porque ninguem fica sabendo.
 *
 * O `reportId` continua sendo o identificador que a pessoa VE (`RPT-XXXXXXXX`) e o que correlaciona
 * um pedido de remocao. Ele so deixa de ser a chave de controle.
 */
export async function chaveIdempotencia(segredo: string, chaveRede: string | null, reportId: string): Promise<string> {
  return hmac(segredo || "sem-segredo", `${chaveRede || "sem-rede"}|${reportId}`, 32);
}

/**
 * Impressao de duplicata: HMAC, nao hash puro.
 *
 * Hash sem chave sobre texto de baixa entropia ("nao consigo salvar") e reversivel por dicionario:
 * quem tivesse o dump testaria frases ate achar a que gerou a impressao. Com HMAC, sem o segredo
 * isso nao anda.
 */
export async function impressao(
  segredo: string,
  dados: { app: string; diagnosticCode: string; routeId: string; description: string },
): Promise<string> {
  const material = [
    dados.app,
    dados.diagnosticCode,
    dados.routeId,
    dados.description.toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("|");
  return hmac(segredo || "sem-segredo", material, 24);
}
