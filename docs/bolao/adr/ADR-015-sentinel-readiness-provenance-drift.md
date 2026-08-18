# ADR-015 — Prontidão do Sentinel expira quando a proveniência muda

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `scripts/sentinel/finding_schema.mjs`, todo detector futuro.

## Contexto

Um finding/decisão de triagem que não se revalida quando o que o gerou muda (SHA de `main`, versão
do detector, versão da política, hash de configuração/evidência) pode ficar classificado sob uma
regra que já não é a regra atual — invisivelmente.

## Decisão

Todo Finding carrega uma tupla de proveniência obrigatória: `source_sha`, `detector_version`,
`policy_version`, `config_hash`, `evidence_hash` (`finding_schema.mjs`, campos obrigatórios). Uma
mudança em qualquer um desses campos, para um finding ainda ativo (não terminal), exige
revalidação antes de qualquer decisão de remediação continuar valendo — mesmo que nenhum caminho
de remediação exista ainda no v1.0-A (a regra é definida agora para não precisar ser inventada sob
pressão quando v1.4 existir).

## Consequência

`scripts/sentinel/test_acceptance.mjs` (teste 9) prova que uma mudança de `detector_version` fica
registrada na próxima observação, não silenciosamente carregada adiante. Um finding terminal
(`RESOLVED`/`FALSE_POSITIVE`) não recomputa sozinho — só uma recorrência genuína (novo evento de
observação) reabre a discussão.
