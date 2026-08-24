/**
 * pii_fingerprints.mjs — detectar valor real de participante SEM guardar valor real de participante.
 *
 * ─── O BURACO QUE ISTO FECHA ────────────────────────────────────────────────────────────────
 *
 * `pii_detectors.mjs` reconhece FORMA: e-mail, JWT, token, telefone, referencia de pagamento. Isso
 * cobre tudo que tem sintaxe propria -- e nome de pessoa nao tem. A auditoria forense das refs
 * normais (#181) encontrou nome completo de participante pareado com referencia de pagamento em
 * mensagem de commit, e nenhum gate do repositorio media aquilo, porque nao havia o que medir.
 *
 * ─── POR QUE NAO "TODA FRASE CAPITALIZADA" ──────────────────────────────────────────────────
 *
 * Porque "Copa do Brasil", "Edge Function", "GitHub Support" e "Ver Palpites" tambem sao frases
 * capitalizadas. Uma regra assim produziria centenas de falsos positivos por dia, seria desligada
 * na primeira semana, e um gate desligado protege menos que um gate que nunca existiu.
 *
 * ─── COMO ISTO FUNCIONA ─────────────────────────────────────────────────────────────────────
 *
 * Lista FECHADA de valores conhecidos, comparada por HMAC-SHA256, com a lista e o sal morando FORA
 * deste repositorio. O repositorio guarda o MECANISMO; nunca os valores.
 *
 * HMAC com sal privado, e nao SHA-256 puro, porque hash puro de um nome e reversivel por
 * dicionario: quem obtivesse a lista testaria nomes ate casar. Sem o sal, isso nao anda.
 *
 * ─── ESTADO, E POR QUE `UNAVAILABLE` NAO E `PASS` ───────────────────────────────────────────
 *
 * Sem a lista privada, o detector responde `UNAVAILABLE` -- nunca `PASS`. Quem roda sem a lista
 * (um clone limpo, o CI publico) sabe que NAO verificou, em vez de receber um verde que significa
 * "nao procurei". Essa distincao e a razao de o arquivo existir.
 *
 * ─── FORMATO DA LISTA PRIVADA ───────────────────────────────────────────────────────────────
 *
 * Caminho: `$FERRARILABS_PII_FINGERPRINTS`, ou `~/Documents/GitHub/ferrarilabs-work/pii_fingerprints.json`.
 * `chmod 600`, NUNCA `git add`ado, NUNCA neste repositorio.
 *
 *   {
 *     "salt": "<aleatorio, >=32 bytes em hex>",
 *     "fingerprints": { "<hmac hex>": "PII_XXXXXXXX", ... }
 *   }
 *
 * O valor de cada entrada e um rotulo OPACO, para o relatorio poder nomear a ocorrencia sem
 * reproduzir o dado. Gerar a lista e ato do dono -- ver `--help`.
 */
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CAMINHO_PADRAO = join(homedir(), "Documents", "GitHub", "ferrarilabs-work",
                                   "pii_fingerprints.json");

export function caminhoDaLista() {
  return process.env.FERRARILABS_PII_FINGERPRINTS || CAMINHO_PADRAO;
}

/**
 * Normaliza antes de comparar, para que "Joao  da Silva", "joão da silva" e "JOAO DA SILVA" gerem
 * a MESMA impressao. Sem isso a lista precisaria enumerar variacoes de caixa e espaco, e a primeira
 * que faltasse seria um falso negativo silencioso.
 */
export function normalizar(valor) {
  return String(valor)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // remove acento
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function impressao(sal, valor) {
  return createHmac("sha256", String(sal)).update(normalizar(valor)).digest("hex");
}

/** Carrega a lista privada. Devolve `{ estado, sal, mapa, caminho, erro }`. */
export function carregarLista(caminho = caminhoDaLista()) {
  if (!existsSync(caminho)) {
    return { estado: "UNAVAILABLE", caminho, motivo: "lista privada ausente" };
  }
  let dados;
  try { dados = JSON.parse(readFileSync(caminho, "utf-8")); }
  catch (e) { return { estado: "ERROR", caminho, motivo: `lista ilegivel: ${e.message}` }; }

  if (!dados || typeof dados.salt !== "string" || dados.salt.length < 32) {
    return { estado: "ERROR", caminho, motivo: "sal ausente ou curto demais (>=32 hex)" };
  }
  if (!dados.fingerprints || typeof dados.fingerprints !== "object") {
    return { estado: "ERROR", caminho, motivo: "`fingerprints` ausente" };
  }
  // Uma lista que carregasse valores em claro seria exatamente o que este desenho evita. Um valor
  // que nao tem forma de hex de 64 caracteres so pode ser um valor cru que alguem colou por engano.
  const chaves = Object.keys(dados.fingerprints);
  const crus = chaves.filter((k) => !/^[0-9a-f]{64}$/.test(k));
  if (crus.length) {
    return { estado: "ERROR", caminho,
             motivo: `${crus.length} entrada(s) nao sao HMAC hex — a lista guarda impressao, nunca valor` };
  }
  return { estado: "ENFORCED", caminho, sal: dados.salt,
           mapa: new Map(Object.entries(dados.fingerprints)), total: chaves.length };
}

/**
 * Candidatos a nome de pessoa num texto. DELIBERADAMENTE amplo: aqui gerar candidato demais nao
 * custa nada, porque so vira achado o que casar com a lista fechada. O filtro e a lista, nao a
 * heuristica -- que e exatamente o inverso de "detectar toda frase capitalizada".
 */
export function candidatos(texto) {
  const out = new Set();
  const re = /\b[A-ZÀ-Ý][\p{L}'-]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\p{L}'-]+){1,3}\b/gu;
  let m;
  while ((m = re.exec(String(texto)))) out.add(m[0]);
  // Tokens isolados tambem: apelido, primeiro nome sozinho, identificador de uma palavra.
  const re1 = /\b[A-ZÀ-Ý][\p{L}'-]{2,}\b/gu;
  while ((m = re1.exec(String(texto)))) out.add(m[0]);
  return [...out];
}

/** Varre um texto contra a lista. Devolve rotulos OPACOS -- nunca o valor casado. */
export function varrer(texto, lista) {
  if (!lista || lista.estado !== "ENFORCED") return { estado: lista?.estado || "UNAVAILABLE", achados: [] };
  const achados = [];
  for (const c of candidatos(texto)) {
    const rotulo = lista.mapa.get(impressao(lista.sal, c));
    if (rotulo) achados.push(rotulo);
  }
  return { estado: "ENFORCED", achados: [...new Set(achados)] };
}
