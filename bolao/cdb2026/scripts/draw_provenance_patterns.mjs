/**
 * CDB2026 — padrões que detectam "confronto fabricado" no caminho de admin.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * A asserção 13 de `audit_draw_provenance.mjs` garante um invariante de dinheiro: nenhum caminho do
 * admin pode INVENTAR um confronto (emparelhar classificados por conta própria). Só
 * `register-official-draw` insere `ties` nas quartas.
 *
 * A checagem é feita sobre o TEXTO-FONTE da função, e isso já falhou duas vezes por motivos opostos:
 *
 *   1. FALSO POSITIVO (Batch 4) — o padrão original continha a palavra solta `derive`, que casava com
 *      `DERIVED_PHASES` e `TOPOLOGY_PHASE_NOT_DERIVED`, constantes de GUARDA. A suíte quebrou apesar
 *      de o invariante estar intacto. Corrigido tornando a checagem estrutural.
 *
 *   2. FALSO NEGATIVO (este arquivo) — a versão estrutural exigia a ordem `qualified` … `teamA`, então
 *      um emparelhamento escrito na ordem inversa — `ties[id] = { teamA: qualified.map(...)[0] }` —
 *      passava sem ser detectado. Um invariante que só pega uma das duas ordens de escrita não é um
 *      invariante.
 *
 * Os padrões vivem aqui, exportados, para que a asserção e o meta-teste
 * (`test_draw_provenance_patterns.mjs`) usem A MESMA fonte de verdade. Sem isso, o meta-teste poderia
 * passar sobre uma cópia divergente do padrão e a asserção real regredir em silêncio.
 *
 * REGRA AO EDITAR: qualquer mudança nestes padrões precisa manter o meta-teste em 0 falso positivo e
 * 0 falso negativo. Adicione a fixture ANTES de afrouxar o padrão.
 */

/**
 * Emparelhamento de classificados em confronto — detectado nas DUAS ordens de escrita.
 *
 * Duas restrições, cada uma vinda de um falso positivo REAL encontrado no app:
 *   · exige contexto de ATRIBUIÇÃO (`teamA:` / `teamA =`) do lado do time, para não casar com leitura
 *     inocente (`tie.teamA`);
 *   · `\bqualified\b` com fronteira de palavra, porque `qualifiedTeamId` é um CAMPO legítimo do
 *     confronto ("qual time avançou") e aparece 8× em `app.js` em expressões como
 *     `tie.qualifiedTeamId === "A" ? tie.teamA : tie.teamB` — leitura, não emparelhamento. Sem a
 *     fronteira, o padrão sinalizava todas as oito.
 */
export const PAIRING_FROM_QUALIFIED =
  /(\bqualified\b[^\n]{0,80}\bteam[AB]\s*[:=]|\bteam[AB]\s*[:=][^\n]{0,80}\bqualified\b)/i;

/** Geradores de sorteio: emparelhamento automático ou aleatoriedade. */
export const RANDOM_PAIRING = /\b(?:autoPair|shuffle)\s*\(|Math\s*\.\s*random/i;

/** Todos os padrões proibidos, com rótulo — o rótulo entra na mensagem de falha. */
export const FORBIDDEN_TIE_FABRICATION = [
  { label: "pairing-from-qualified", re: PAIRING_FROM_QUALIFIED },
  { label: "random-pairing", re: RANDOM_PAIRING },
];

/**
 * @param {string} source trecho de código a inspecionar
 * @returns {string[]} rótulos dos padrões que casaram (vazio = limpo)
 */
export function detectTieFabrication(source) {
  return FORBIDDEN_TIE_FABRICATION.filter(({ re }) => re.test(source)).map(({ label }) => label);
}
