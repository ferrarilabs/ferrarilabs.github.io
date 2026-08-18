# ADR-013 — Sentinel separa autoridade de INVESTIGAÇÃO da de MUTAÇÃO

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `scripts/sentinel/policy.mjs` e qualquer detector futuro.

## Contexto

Um desenho inicial usava uma única escada de autonomia (L0–L4: detectar / detectar+Issue /
+investigação / +auto-fix / +auto-merge). Isso torna estruturalmente impossível expressar "deixe a
IA investigar a fundo um achado de scoring, mas nunca deixe nada mutar scoring sem aprovação" — a
mesma faixa que permite investigação profunda também implica mutação.

## Decisão

Dois eixos independentes, nunca colapsados em uma escada só:

- **Investigação** (`I0`–`I3`): quanto o Sentinel/Claude pode OLHAR, sempre somente-leitura.
- **Mutação** (`M0`–`M4`): o que pode ESCREVER. `M1` (metadado de Issue/Project) é o teto do
  v1.0-A inteiro — nenhum detector desta fatia tem `M2`+.

Para categorias sensíveis (scoring, ranking, payments, security, Supabase), a investigação pode
ser generosa (`I2`/`I3`) exatamente porque a mutação continua travada em `M0`/`M1` — entender rápido
não implica poder agir.

## Consequência

`CHANGE_INTENT Stale` (o único detector desta fatia) recebe `investigation_level: "I1"` (evidência
determinística, sem IA) e `mutation_level: "M1"` (Issue/Project apenas) — ver
`scripts/sentinel/policy.mjs`. Nenhum detector futuro pode receber `M2`+ sem uma decisão
arquitetural separada e documentada, nunca por herança implícita de um nível de investigação alto.
