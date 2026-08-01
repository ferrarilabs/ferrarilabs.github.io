# ADR-005 — Versionamento da regra de pontuação

**Status:** Aceito e implementado.
**Data:** 2026-08 (Fase 2, item §18/§19 do mega-prompt de modernização).
**Aplica-se a:** `bolao/cdb2026/`.

## Contexto

Antes desta modernização não havia forma de responder, olhando só para uma entrada pontuada,
"sob qual versão da regra ela foi calculada". Isso importa porque `matchPoints`/`scoreEntry`
(constantes de pontos, bônus de classificação, bônus de pódio) são exatamente a área que a regra
de negócio do repositório proíbe alterar sem autorização explícita de Eduardo (`CLAUDE.md`:
"Nunca alterar scoring ou regras de negócio... sem autorização explícita do Eduardo").

## Decisão

Adicionada a constante `SCORING_RULE_VERSION = "rules-2026-07-13"` (`app.js:807`), com uma regra
de manutenção documentada no comentário adjacente: só muda quando a REGRA muda (valores em
`config.scoring`, critério de desempate, ou o que conta como acerto) — nunca em refactor. Ao
mudar, o processo exigido é: registrar motivo + aprovação + impacto + recálculo no CHANGELOG, e
atualizar o golden master conscientemente (não deixar o teste "consertar sozinho").

`explainScore(entry, s)` (`app.js:889`, item §19) inclui `ruleVersion: SCORING_RULE_VERSION` em
todo resultado que produz, então qualquer decomposição de pontuação carrega consigo sob qual
regra foi gerada.

## Por que uma constante simples, não um histórico completo de versões

Um sistema completo de versionamento (múltiplas versões da regra coexistindo, recálculo
retroativo por versão) seria over-engineering para este app: a regra de pontuação da Copa do
Brasil está em vigor desde a v3.0 e não mudou durante toda a auditoria de 2026-08 (confirmado
pelo golden master — o hash do comportamento COMPLETO da regra não mudou entre o início e o fim
desta modernização). Uma constante simples resolve o requisito real (rastreabilidade de qual
regra gerou qual pontuação) sem construir infraestrutura para um cenário (múltiplas regras
coexistindo) que nunca aconteceu neste app.

## Consequências

- Qualquer mudança futura de regra tem, a partir de agora, um lugar único e óbvio para registrar
  que mudou (a constante) e uma disciplina documentada para fazer isso com segurança.
- Não retroage: entradas pontuadas antes desta modernização não têm essa informação anexada
  (porque a pontuação nunca foi persistida — é sempre recalculada ao vivo — não há dado
  histórico para retroagir).
