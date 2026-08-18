# ADR-014 — Correção de escritor único via idempotência + reconciliação, não um lock distribuído

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `scripts/sentinel/writer.mjs`, `scripts/sentinel/reconcile.mjs`.

## Contexto

Esta mesma sessão observou uma execução do `Safety check` disparada por `push` ser `cancelled`
quando um segundo push legítimo chegou ao mesmo grupo de concorrência — mesmo com
`cancel-in-progress: false` declarado. Grupo de concorrência do GitHub Actions sozinho não é uma
garantia confiável de escritor único.

## Decisão

Correção vem de três camadas, na ordem certa de confiança:

1. **Idempotência (a garantia real)**: toda escrita busca pelo fingerprint antes de escrever
   (`writer.mjs`, `upsertFinding`). Uma chamada repetida converge, nunca duplica.
2. **Detecção de corrida pós-escrita**: depois de criar uma Issue, `upsertFinding` busca de novo —
   se mais de uma Issue já existe para o mesmo fingerprint, a mais antiga (menor número) vence
   deterministicamente (`selectCanonical`/`resolveDuplicates`), e as demais são fechadas como
   `Duplicate` com link de volta.
3. **Reconciliação diária (o reparo, não a prevenção)**: `reconcile.mjs` varre todas as Issues
   geridas pelo Sentinel e repara o que uma execução anterior deixou pela metade — item de Project
   faltando, campo faltando, estado embutido malformado, duplicata que escapou do passo 2.

O grupo de concorrência do GitHub Actions no workflow do Sentinel continua aplicado, mas como
cortesia que reduz a frequência com que o passo 2 precisa agir — nunca como a garantia em si.

## Consequência

Nenhum lock/lease/heartbeat externo existe. `scripts/sentinel/test_acceptance.mjs` prova os cenários
4 (corrida → uma Issue canônica), 5 (falha de mutação de Project reparada por reconcile) e 10
(retry sem duplicata) exatamente contra este mecanismo, com um cliente GitHub falso — não é uma
garantia teórica, é testada.
