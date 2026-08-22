/**
 * PROJECAO PUBLICA DO POWERBALL — do banco autoritativo para o artefato publico (Issue #303-A).
 *
 * ─── A INVERSAO QUE ESTE MODULO COMPLETA ────────────────────────────────────────────────────
 *
 *   BANCO   = estado de negocio AUTORITATIVO
 *   data.js = artefato PUBLICO DERIVADO
 *
 * Antes disto, `data.js` era mantido a mao e um `pin` impedia que edicoes financeiras passassem
 * despercebidas. Um pin detecta divergencia; ele nao produz a verdade. Aqui a verdade e produzida.
 *
 * ─── ALLOWLIST, NUNCA DENYLIST ──────────────────────────────────────────────────────────────
 *
 * Nenhuma linha do banco e serializada automaticamente. Cada campo publico e CONSTRUIDO por nome.
 * A diferenca importa no dia em que alguem adiciona uma coluna: com denylist, a coluna nova vaza
 * por padrao e alguem precisa lembrar de proibi-la; com allowlist, ela simplesmente nao aparece.
 *
 * `lottery_participants` ja carrega `email` e `phone`. `lottery_payment_transactions` carrega
 * `external_reference`, `memo`, `reason` e `operator_client_ref`. Nada disso pode alcancar um
 * arquivo servido pelo GitHub Pages.
 *
 * ─── SEMANTICA FINANCEIRA ───────────────────────────────────────────────────────────────────
 *
 * O valor publico de uma participacao e o LIQUIDO do razao daquela participacao: contribuicao mais
 * ajuste mais estorno. E por isso que o ajuste de +2,00 classificado como acerto pessoal alheio ao
 * bolao, uma vez estornado por -2,00, soma exatamente zero aqui -- sem nenhuma excecao escrita para
 * essa pessoa. Uma excecao subtrativa por participante seria um caso especial que a proxima consulta
 * esqueceria; o estorno se anula sozinho.
 *
 * Puro: recebe linhas, devolve o artefato. Sem rede, sem banco, sem relogio.
 */

/**
 * Os UNICOS campos que chegam ao artefato publico. Construidos por nome, um a um.
 *
 * Mudar esta lista e uma decisao de exposicao publica, nao um detalhe de implementacao — o gate
 * `test_public_projection.mjs` fixa o conjunto e reprova se ele crescer sem alguem decidir.
 */
export const CAMPOS_PUBLICOS = Object.freeze(["name", "cotas", "valor", "metodo", "data", "hora", "status", "state"]);

/**
 * Os campos que o BANCO realmente possui, e que por isso sao DERIVADOS e conferidos contra ele.
 *
 * Sao os que carregam dinheiro: cota, valor liquido e o meio de pagamento. Uma edicao manual em
 * qualquer um deles faz o `--check` reprovar — e essa e a garantia que a Issue #303-A pede.
 */
export const CAMPOS_DERIVADOS = Object.freeze(["name", "cotas", "valor", "metodo"]);

/**
 * Campos de APRESENTACAO que o banco NAO possui hoje. Declarados, com o motivo, em vez de
 * silenciosamente "derivados" a partir de uma coluna que significa outra coisa.
 *
 * Descoberto ao construir o gerador (2026-08-22) — e a razao de eles nao estarem em
 * `CAMPOS_DERIVADOS`:
 *
 *   state    COLISAO DE NOME. `lottery_participants.state` vale "active" nas 18 linhas: e o
 *            estado de CICLO DE VIDA do registro, nao a UF. O estado americano (NC/FL) existe
 *            somente no `data.js`. Mapear um pelo outro teria trocado "NC" por "active" em
 *            producao — o gerador so nao fez isso porque o `--check` comparou antes.
 *
 *   data     22 das 76 transacoes tem `paid_at IS NULL`, contribuicoes inclusive. Derivar daqui
 *   hora     APAGARIA a data/hora que hoje aparece para essas pessoas. Ausencia de timestamp no
 *            banco nao e evidencia de que o pagamento nao teve hora.
 *
 *   status   "organizador" e rotulo de exibicao, nao consequencia do razao. O razao sabe se houve
 *            contribuicao; nao sabe que aquela pessoa organiza o bolao.
 *
 * Isto e divida declarada, nao desenho definitivo: quando o banco passar a guardar UF, os 22
 * timestamps e o papel do participante, estes campos migram para `CAMPOS_DERIVADOS`.
 */
export const CAMPOS_APRESENTACAO = Object.freeze(["data", "hora", "status", "state"]);

/**
 * Campos que NUNCA podem sair do banco, mesmo que a allowlist um dia erre.
 *
 * Redundante de proposito: a allowlist ja bastaria. Esta lista existe como segunda tranca, para
 * que um erro de digitacao na allowlist ("emai1") nao vire vazamento -- `assertSemPII` varre o
 * artefato PRONTO procurando qualquer coisa com cara de e-mail ou telefone, independentemente do
 * nome do campo.
 */
export const NUNCA_PUBLICO = Object.freeze([
  "email", "phone", "telefone", "external_reference", "externalReference", "txId", "tx_id",
  "memo", "reason", "operator_client_ref", "operatorClientRef", "created_by", "updated_by",
  "participant_id", "participation_id", "transaction_id", "provider", "proof_object_path",
]);

const cents = (v) => Math.round(Number(v) * 100);

/** Formata centavos como o numero que `data.js` sempre usou (dolar inteiro quando exato). */
function valorPublico(totalCents) {
  const d = totalCents / 100;
  return Number.isInteger(d) ? d : Number(d.toFixed(2));
}

/**
 * Liquido de uma participacao: contribuicao + ajuste + estorno.
 *
 * `reversal` entra com o proprio sinal (negativo), entao anular um ajuste de +2,00 com -2,00 da
 * zero por aritmetica, nao por excecao.
 */
export function liquidoDaParticipacao(transacoes) {
  let total = 0;
  for (const t of transacoes) {
    if (!["contribution", "adjustment", "reversal", "refund", "carryover"].includes(t.type)) {
      throw new Error(`tipo de transacao desconhecido na projecao: ${JSON.stringify(t.type)}`);
    }
    total += cents(t.amount);
  }
  return total;
}

/** A transacao que define metodo/data/hora publicos: a CONTRIBUICAO, nunca um ajuste interno. */
function contribuicaoPrincipal(transacoes) {
  const contribs = transacoes.filter((t) => t.type === "contribution");
  if (contribs.length === 0) return null;
  return contribs.slice().sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)))[0];
}

function formatarData(iso, tz = "America/New_York") {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(d);
  return { data: p, hora: h };
}

/**
 * Projeta UM participante. Cada campo e construido por nome — a linha nunca e espalhada.
 *
 * Note a ausencia de qualquer `...participante` ou `Object.assign`: e essa ausencia que faz uma
 * coluna nova do banco nao aparecer aqui sozinha.
 */
export function projetarParticipante({ participante, participacao, transacoes, statusOverride }) {
  const principal = contribuicaoPrincipal(transacoes);
  const quando = formatarData(principal?.paid_at);
  return {
    name: participante.display_name,
    cotas: participacao.cotas,
    valor: valorPublico(liquidoDaParticipacao(transacoes)),
    metodo: statusOverride?.metodo ?? principal?.method ?? null,
    data: quando?.data ?? null,
    hora: quando?.hora ?? null,
    status: statusOverride?.status ?? (principal ? "verificado" : "pendente"),
    state: participante.state ?? null,
  };
}

/**
 * Varre o artefato PRONTO atras de qualquer coisa sensivel. Segunda tranca, depois da allowlist.
 *
 * Checa por NOME DE CAMPO e por FORMATO do valor: um e-mail que chegasse num campo chamado `name`
 * escaparia da checagem por nome, e um campo chamado `email` com valor vazio escaparia da checagem
 * por formato. As duas juntas nao deixam brecha obvia.
 */
export function assertSemPII(artefato) {
  const problemas = [];
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const TELEFONE = /(?:\+?\d[\d\s().-]{8,}\d)/;

  const visitar = (no, caminho) => {
    if (no === null || no === undefined) return;
    if (Array.isArray(no)) return no.forEach((v, i) => visitar(v, `${caminho}[${i}]`));
    if (typeof no === "object") {
      for (const [k, v] of Object.entries(no)) {
        if (NUNCA_PUBLICO.includes(k)) problemas.push(`${caminho}.${k}: campo proibido no artefato publico`);
        visitar(v, `${caminho}.${k}`);
      }
      return;
    }
    const s = String(no);
    if (EMAIL.test(s)) problemas.push(`${caminho}: valor com formato de e-mail`);
    if (TELEFONE.test(s)) problemas.push(`${caminho}: valor com formato de telefone`);
  };

  visitar(artefato, "$");
  if (problemas.length) {
    throw new Error("PII NA PROJECAO PUBLICA:\n  - " + problemas.join("\n  - "));
  }
  return artefato;
}

/** Projeta um sorteio inteiro e verifica antes de devolver. Nunca devolve sem passar pela tranca. */
export function projetarSorteio({ participantes, participacoes, transacoes, overrides = {} }) {
  const porParticipante = new Map(participantes.map((p) => [p.participant_id, p]));
  const porParticipacao = new Map();
  for (const t of transacoes) {
    if (!porParticipacao.has(t.participation_id)) porParticipacao.set(t.participation_id, []);
    porParticipacao.get(t.participation_id).push(t);
  }

  const linhas = participacoes.map((pa) => {
    const participante = porParticipante.get(pa.participant_id);
    if (!participante) throw new Error(`participacao sem participante: ${pa.participation_id}`);
    return projetarParticipante({
      participante, participacao: pa,
      transacoes: porParticipacao.get(pa.participation_id) || [],
      statusOverride: overrides[participante.display_name],
    });
  });

  return assertSemPII(linhas);
}
