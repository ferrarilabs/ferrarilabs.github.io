# ADR-017 — Recuperação exige confirmação positiva, não apenas ausência

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `scripts/sentinel/detectors/main_ci_red.mjs`,
`scripts/sentinel/run.mjs`, `scripts/sentinel/policy.mjs` (`cleanCyclesToResolve`).

## Contexto

O modelo de resolução do V1.0-A (CHANGE_INTENT Stale) trata "o fingerprint não apareceu neste
scan" como o único sinal de que o problema sumiu — 3 ciclos limpos consecutivos por essa ausência
resolvem a Issue. Isso é correto para um detector cuja saída é sempre um julgamento completo do
estado atual (a declaração está obsoleta, ou não está).

Main CI Red (V1.0-B) não tem essa propriedade. A run mais recente de `Safety check` em `main` pode
estar `CANCELLED` (o grupo de concorrência do próprio Sentinel já causou isso nesta sessão — ver
ADR-014) ou `IN_PROGRESS`. Nenhum dos dois é evidência de que o CI está saudável — mas também não
produz um Finding, então "ausente deste scan" aconteceria de qualquer forma. Usar o modelo do
V1.0-A sem adaptação teria fechado uma Issue de CI vermelho depois de um run cancelado, o que é um
falso-positivo de recuperação — pior que não resolver, porque esconde um problema real.

## Decisão

`detectMainCiRed()` retorna `{ findings, confirmedRecoveries }` em vez de um array simples.
`confirmedRecoveries` é um `Set` de fingerprints com uma run `SUCCESS` positivamente observada —
nunca inferido por ausência. `run.mjs`'s `normalizeDetectorResult()` distingue as duas formas de
retorno; para um detector que fornece `confirmedRecoveries`, o laço de ciclo-limpo só avança um
fingerprint que está explicitamente no set, nunca por mera ausência dos `findings` deste run.

Como consequência direta, uma conclusão de CI confirmada é um sinal binário e não-instável — uma
única run verde confirmada já é prova suficiente. Por isso `RULE_DEFAULTS.main_ci_red` declara
`clean_cycles_to_resolve: 1`, contra os 3 do CHANGE_INTENT Stale — a diferença está registrada em
`policy.mjs`, não codificada em `writer.mjs` (`recordCleanCycleOrResolve` aceita `threshold` como
parâmetro, sem opinião sobre qual detector está chamando).

## Consequência

`scripts/sentinel/test_main_ci_red_acceptance.mjs` prova, contra `runOnce()` real: (1) um run
`CANCELLED` depois de uma falha não avança o contador nem resolve; (2) um `SUCCESS` confirmado
resolve em exatamente 1 ciclo; (3) uma falha depois da resolução reabre a mesma Issue e incrementa
`recurrence_count`. Um detector futuro decide, por si, se seu sinal de "problema sumiu" é confiável
o bastante para o modelo de ausência (V1.0-A) ou se precisa do modelo de confirmação positiva
(V1.0-B) — nenhum dos dois é o padrão obrigatório para todo detector.
