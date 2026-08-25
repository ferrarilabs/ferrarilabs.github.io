/**
 * falhas.ts — classificacao de falha por ALLOWLIST, para observabilidade sem segredo (Issue #339).
 *
 * ─── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA FECHAR ──────────────────────────────────────────
 *
 * Antes, as duas fronteiras de excecao derivavam o `codigo` do log da mensagem crua do erro:
 *
 *     String((e as Error)?.message ?? "UNKNOWN").slice(0, 40).replace(/[^\w .:-]/g, "")
 *
 * Truncar em 40 e tirar pontuacao protege o CLIENTE -- e isso sempre esteve certo e testado. Mas o
 * valor resultante ia para o LOG, e mensagem de excecao nao e nossa: ela nasce de biblioteca, de
 * runtime e de provedor. Os proprios fixtures de F-15 mostravam a consequencia, gravando linhas com
 * `Bearer ghs_...` e `SUPABASE_SERVICE_ROLE_KEY=eyJ0...` dentro do `codigo`.
 *
 * ─── POR QUE NAO `redigir()` ────────────────────────────────────────────────────────────────
 *
 * `redigir()` e DENYLIST: ela conhece os formatos de segredo que existiam no dia em que foi escrita.
 * Um formato novo de token -- de um provedor novo, ou do mesmo provedor no ano que vem -- passa
 * inteiro. Denylist responde "o que eu sei que e segredo?"; a pergunta certa aqui e a inversa.
 *
 * Entao o log nao filtra a mensagem: ele NUNCA A VE. O `codigo` registrado e sempre membro de
 * `CODIGOS_DE_FALHA`, um conjunto fechado escrito aqui. Um erro que nao carrega classificacao
 * nossa vira `INTERNAL_UNKNOWN`. Nao ha caminho -- nem com biblioteca hostil, nem com formato de
 * segredo futuro -- em que um pedaco de `message` chegue ao log: `classificar()` nao le `.message`,
 * nao le `.stack` e nao serializa o erro.
 *
 * A garantia e ESTRUTURAL, nao editorial.
 */

/**
 * O conjunto fechado. Cada codigo corresponde a um ponto de falha REAL do fluxo -- nenhum existe
 * "por completude". Precisao inventada num painel e pior que categoria grossa: ela sugere um
 * diagnostico que ninguem pode sustentar.
 */
export const CODIGOS_DE_FALHA = Object.freeze([
  /** Emissao do token de instalacao falhou (o GitHub recusou a assinatura do App). */
  "GITHUB_AUTH",
  /** O GitHub aplicou limite de taxa/abuso -- deduzido do STATUS e do cabecalho, nunca do corpo. */
  "GITHUB_RATE_LIMIT",
  /** Nosso proprio `AbortController` cortou a chamada em 8s. */
  "GITHUB_TIMEOUT",
  /** Qualquer outra resposta nao-ok do GitHub. */
  "GITHUB_UPSTREAM",
  /** INVARIANTE CENTRAL violado: o repositorio de destino nao esta privado. */
  "TARGET_NOT_PRIVATE",
  /** Guarda anti-SSRF: alguem tentou falar com host que nao e a API do GitHub. */
  "DESTINO_BLOQUEADO",
  /** Import de chave ou assinatura RS256 falhou. */
  "CRYPTO_FAILURE",
  /** O Durable Object de estado nao respondeu ou respondeu invalido. */
  "STATE_FAILURE",
  /** O binding de pre-filtro de rajada falhou. */
  "RATE_LIMIT_FAILURE",
  /** Tudo o mais. Deliberadamente sem detalhe: o detalhe e exatamente o que nao pode ir ao log. */
  "INTERNAL_UNKNOWN",
] as const);

export type CodigoFalha = (typeof CODIGOS_DE_FALHA)[number];

const PERMITIDOS: ReadonlySet<string> = new Set(CODIGOS_DE_FALHA);

/**
 * Erro com classificacao EXPLICITA, criada por nos no ponto do `throw`.
 *
 * `mensagemInterna` existe para depuracao local e para manter os sentinelas que as catracas de
 * seguranca ja verificam no fonte (`GITHUB_AUTH_${r.status}`, `TARGET_REPO_NOT_PRIVATE`,
 * `DESTINO_NAO_PERMITIDO`). Ela NUNCA e logada -- quem loga le `codigo`, e so.
 */
export class FalhaClassificada extends Error {
  readonly codigo: CodigoFalha;

  constructor(codigo: CodigoFalha, mensagemInterna?: string) {
    super(mensagemInterna ?? codigo);
    this.name = "FalhaClassificada";
    this.codigo = codigo;
  }
}

/**
 * Reduz QUALQUER valor lancado a um membro do conjunto fechado.
 *
 * Repare no que esta funcao nao faz: nao le `.message`, nao le `.stack`, nao chama `String(e)` e
 * nao serializa o erro. Ela le UM campo, e mesmo esse campo so passa se ja estiver na allowlist --
 * entao nem um objeto hostil que finja ser nosso, carregando `codigo` com texto arbitrario,
 * consegue escrever no log. O retorno pertence a `CODIGOS_DE_FALHA` por construcao.
 */
export function classificar(e: unknown): CodigoFalha {
  const bruto = (e as { codigo?: unknown } | null | undefined)?.codigo;
  return typeof bruto === "string" && PERMITIDOS.has(bruto)
    ? (bruto as CodigoFalha)
    : "INTERNAL_UNKNOWN";
}

/**
 * Executa `fn` e converte qualquer falha NAO classificada em `codigo`.
 *
 * Uma falha que ja vem classificada passa intacta: quem esta mais perto do erro sabe mais sobre ele
 * do que quem embrulha. Serve para dar nome as fronteiras que nao lancam por conta propria -- o
 * Durable Object e o binding de rajada -- sem espalhar `try/catch` pelo fluxo principal.
 */
export async function comFalha<T>(codigo: CodigoFalha, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof FalhaClassificada ? e : new FalhaClassificada(codigo);
  }
}
