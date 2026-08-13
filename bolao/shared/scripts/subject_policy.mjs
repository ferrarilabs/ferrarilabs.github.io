/**
 * Política de ícone de assunto — ESPELHO JS de `subject_policy.py`.
 *
 * ═══ POR QUE EXISTE UM ESPELHO ══════════════════════════════════════════════════════════════
 *
 * Os e-mails desta plataforma saem por DOIS runtimes: os remetentes Python
 * (`send_result_email.py` e os três do futebol) e o renderizador JS (`email/render.mjs`, usado
 * pelos envios de confirmação, publicação de bilhetes e resultado).
 *
 * A política em Python cobria só o primeiro. O segundo montava o assunto com o ícone digitado
 * no meio de um template string:
 *
 *     return `${prefix}🔴 Resultado Powerball — ...`;
 *
 * Medido em 2026-08-13: trocar aquele 🔴 por ⚽ deixa OITO portões de e-mail verdes. É
 * exatamente a classe de regressão que a política foi criada para tornar impossível — e ela
 * era invisível para o portão, que varria uma lista fixa de cinco arquivos .py.
 *
 * Mesmo padrão já usado neste repositório para dinheiro (`money.py` + `money.js`, mantidos em
 * sincronia por `test_money_interop.mjs`): uma implementação por runtime, com um teste de
 * interoperabilidade que falha se as duas divergirem. Ver `test_subject_policy_interop.mjs`.
 */

export const POWERBALL = "🔴";
export const MEGA_MILLIONS = "🔵";
export const FUTEBOL = "⚽";
export const FUTEBOL_CAMPEAO = "🏆";

/** Propósito semântico -> ícone. Tem de ser IDÊNTICO ao `PROPOSITOS` do subject_policy.py. */
export const PROPOSITOS = {
  LOTERIA_POWERBALL_RESULTADO: POWERBALL,
  LOTERIA_POWERBALL_ABERTURA: POWERBALL,
  LOTERIA_POWERBALL_COMPROVANTE: POWERBALL,
  LOTERIA_MEGAMILLIONS_RESULTADO: MEGA_MILLIONS,
  LOTERIA_MEGAMILLIONS_ABERTURA: MEGA_MILLIONS,
  LOTERIA_MEGAMILLIONS_COMPROVANTE: MEGA_MILLIONS,

  FUTEBOL_RESULTADO_RODADA: FUTEBOL,
  FUTEBOL_RESULTADO_PARCIAL: FUTEBOL,
  FUTEBOL_RANKING_PARCIAL: FUTEBOL,
  FUTEBOL_STATUS: FUTEBOL,
  FUTEBOL_CONVITE: FUTEBOL,
  FUTEBOL_COMPROVANTE: FUTEBOL,
  FUTEBOL_CONFIRMACAO_PALPITE: FUTEBOL,
  FUTEBOL_CORRECAO: FUTEBOL,

  FUTEBOL_RESULTADO_FINAL_CAMPEAO: FUTEBOL_CAMPEAO,
};

export class PropositoDesconhecido extends Error {}

/** O ícone do propósito. Propósito não declarado LEVANTA — nunca cai num padrão. */
export function icone(proposito) {
  if (!Object.prototype.hasOwnProperty.call(PROPOSITOS, proposito)) {
    throw new PropositoDesconhecido(
      `PROPOSITO_NAO_DECLARADO: ${proposito}. Adicione-o a PROPOSITOS (nos DOIS runtimes) em ` +
      `vez de escolher um caractere no ponto de uso — foi assim que o resultado da Powerball ` +
      `acabou com bola de futebol. Conhecidos: ${Object.keys(PROPOSITOS).sort().join(", ")}`);
  }
  return PROPOSITOS[proposito];
}

/**
 * Identidade de cada jogo num só lugar.
 *
 * `renderDrawResultSubject` chumbava "Powerball", "PB" e 🔴 no template — mesmo recebendo o
 * jogo em `payload.poolId`. Um sorteio de Mega Millions passando por ali sairia como
 * "🔴 Resultado Powerball — ... PB 17": ícone errado, jogo errado e rótulo de bola errado, num
 * e-mail sobre dinheiro real. Bug latente hoje (não há sorteio de MM), e a Mega Millions já é
 * parte do escopo da plataforma.
 */
export const JOGOS = {
  powerball: {
    label: "Powerball",
    bola: "PB",
    propositoResultado: "LOTERIA_POWERBALL_RESULTADO",
    propositoAbertura: "LOTERIA_POWERBALL_ABERTURA",
    propositoComprovante: "LOTERIA_POWERBALL_COMPROVANTE",
  },
  megamillions: {
    label: "Mega Millions",
    bola: "MB",
    propositoResultado: "LOTERIA_MEGAMILLIONS_RESULTADO",
    propositoAbertura: "LOTERIA_MEGAMILLIONS_ABERTURA",
    propositoComprovante: "LOTERIA_MEGAMILLIONS_COMPROVANTE",
  },
};

/** Metadados do jogo. Jogo desconhecido LEVANTA em vez de virar Powerball por omissão. */
export function jogo(poolId) {
  const g = JOGOS[String(poolId || "").toLowerCase()];
  if (!g) {
    throw new PropositoDesconhecido(
      `JOGO_NAO_DECLARADO: ${poolId}. Assumir Powerball por omissão foi o defeito: o assunto ` +
      `sairia com o nome e o ícone do jogo errado.`);
  }
  return g;
}

/**
 * Monta o assunto: ícone do propósito + texto. O texto NÃO pode trazer ícone próprio — dois
 * ícones significa que alguém montou metade aqui e metade no remetente.
 */
export function assunto(proposito, texto) {
  const ic = icone(proposito);
  const achados = [POWERBALL, MEGA_MILLIONS, FUTEBOL, FUTEBOL_CAMPEAO].filter((x) =>
    String(texto).includes(x));
  if (achados.length) {
    throw new Error(
      `ICONE_NO_TEXTO: ${achados.join(",")} já está no texto do assunto (${texto}). O ícone vem ` +
      `do propósito; o remetente escreve só o texto.`);
  }
  return `${ic} ${texto}`;
}
