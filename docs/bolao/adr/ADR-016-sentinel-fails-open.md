# ADR-016 — Automação do Sentinel falha aberto; os portões de segurança existentes mantêm seu próprio comportamento

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `.github/workflows/sentinel.yml`, todo o Sentinel.

## Contexto

O Sentinel é monitoramento/automação, não um portão de enforcement como `npm run check` ou o
contrato de segurança. Misturar os dois faria do Sentinel um novo ponto único de falha para
desenvolvimento normal.

## Decisão

- `sentinel.yml` nunca entra na lista de "required checks" de branch protection, em nenhuma fase
  deste documento. Se o Sentinel quebrar, atrasar ou não rodar, nenhum PR fica bloqueado.
- Os portões existentes (`npm run check`, o contrato de segurança, os gates de PII) continuam
  rodando dentro do CI normal, independentes da infraestrutura do Sentinel, e mantêm o próprio
  comportamento de fail-closed já estabelecido onde este repositório já decidiu que é o certo. O
  Sentinel apenas LÊ o resultado deles como um sinal a mais (o futuro detector `Main CI Red`) —
  nunca fica entre um desenvolvedor e esses portões.
- Retries dentro do próprio Sentinel são limitados (backoff exponencial, no máximo 3 tentativas,
  só para classes de erro transitórias — 429/502/503/504/rede) — nunca para erro de autenticação
  ou validação, que é erro de lógica, não falha transitória.

## Consequência

Uma falha do Sentinel é reportada (exit code não-zero, log estruturado) mas nunca vira bloqueio.
`scripts/sentinel/run.mjs`/`reconcile.mjs` documentam isso explicitamente no próprio comentário de
saída de erro.
