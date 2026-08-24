/**
 * deploy_manifest.js — que codigo esta REALMENTE respondendo (Issue #321, F-06).
 *
 * A #306 e a #310 foram duas faces do mesmo problema: o repositorio dizia uma coisa e a producao
 * outra, e ninguem tinha como saber sem rodar um gate a mao. A `live-football` ganhou este padrao
 * depois disso; o intake nasceu sem ele, e repetir a omissao num endpoint novo seria escolher
 * redescobrir a licao.
 *
 * O agravante aqui e que o deploy deste repositorio e AUTOMATICO no merge. Um endpoint que se
 * publica sozinho e nao diz qual versao esta servindo transforma "verificar o que esta no ar" em
 * arqueologia.
 *
 * O valor e atualizado pelo gate de paridade quando as fontes mudam; ele identifica a REVISAO das
 * fontes, nao um segredo, e e devolvido no cabecalho `x-deploy-sha` de toda resposta.
 */
export const DEPLOYED_SOURCE_SHA = "unset-until-first-deploy";

/** Cabecalho de proveniencia. Barato, e a unica forma de responder "qual versao respondeu?". */
export function cabecalhoDeDeploy() {
  return { "x-deploy-sha": DEPLOYED_SOURCE_SHA };
}
