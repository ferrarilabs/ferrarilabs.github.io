/**
 * IDENTIDADE DO QUE ESTA IMPLANTADO (Issue #306).
 *
 * ─── O PROBLEMA ─────────────────────────────────────────────────────────────────────────────
 *
 * Em 2026-08-22 a Issue #296 entrou em `main` com CI verde e ficou HORAS sem chegar a producao: a
 * integracao Supabase-GitHub morria aplicando uma migracao nao-idempotente e abortava ANTES de
 * implantar as funcoes. `main` verde nao era evidencia de producao, e nada dizia a diferenca --
 * a divergencia foi encontrada por `curl` manual.
 *
 * "merge aconteceu" nunca pode significar "producao implantada" sem evidencia.
 *
 * ─── COMO ESTE ARQUIVO RESOLVE ──────────────────────────────────────────────────────────────
 *
 * Este SHA e o resumo determinístico do CODIGO-FONTE da funcao (index.ts + os modulos de
 * `_shared/` que ela importa). A funcao o devolve no header `x-deploy-sha` de toda resposta.
 *
 * Com isso a comparacao vira trivial e automatizavel:
 *
 *     hash calculado do repositorio  ==  x-deploy-sha vindo de producao   ->  LIVE_MATCHES_MAIN
 *     diferente                                                          ->  LIVE_DRIFT
 *
 * O valor NAO e mantido a mao no sentido de "lembrar de bumpar": o gate
 * `scripts/db/audit_live_function_drift.mjs` RECALCULA o hash a partir dos arquivos e reprova se
 * esta constante nao bater. Editar a funcao sem atualizar aqui e impossivel de passar batido.
 *
 * Nao vai no corpo da resposta, e sim num header: o contrato do payload nao muda, entao nenhum
 * cliente ja implantado percebe diferenca.
 */
export const DEPLOYED_SOURCE_SHA = "1d6e6db62deffc44";
