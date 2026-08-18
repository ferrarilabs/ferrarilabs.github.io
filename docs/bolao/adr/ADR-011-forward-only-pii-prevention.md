# ADR-011 — Prevenção forward-only de PII é separada da remediação de histórico (HIST-091/HIST-093)

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** plataforma inteira (`scripts/`, `bolao/*/scripts/security/`).

## Contexto

A investigação HIST-091/HIST-093 (2026-08-17/18) confirmou PII real de participantes (emails,
referências de pagamento Zelle/CashApp, um nome) em histórico público do Git — parte em conteúdo
de arquivo (já coberto por `scripts/audit_pii_repo_wide.mjs` desde 2026-08-12), parte digitada
diretamente em corpos de commit-message, uma superfície que nenhum gate existente cobria.

A causa raiz do ponto cego: a extração original de 2026-08-06 varreu deliberadamente só conteúdo
de blob, para evitar falsos positivos contra metadado de autor/committer do próprio Git — decisão
razoável na época, mas que deixou invisível qualquer PII que uma pessoa tenha digitado de propósito
na mensagem do commit (lista de destinatários, nota "fix: email errado era X, agora Y", narrativa
de incidente).

Remediar o histórico já publicado exigiria reescrita de Git history — operação destrutiva
(force-push, ~130 refs de PR afetados, coordenação com GitHub Support), que já está sob HIST-091/
HIST-093 como faixa de trabalho separada, explicitamente gated atrás de autorização direta do
Eduardo, ainda não concedida. Essa decisão não pode ficar bloqueando a pergunta mais simples e mais
urgente: **como impedir que PII nova entre no histórico a partir de agora?**

## Decisão

Tratar prevenção forward-only e remediação de histórico como **duas decisões independentes**, cada
uma com seu próprio critério de pronto:

1. **Prevenção forward-only** (este ADR): `scripts/audit_commit_message_pii.mjs`, rodando ao lado
   do gate de arquivo já existente, cobrindo commit-message como uma superfície própria. Não requer
   autorização de reescrita de histórico porque não toca em nenhum commit já existente — só audita
   o que está prestes a entrar.
2. **Remediação de histórico** (HIST-091/HIST-093, inalterado por este ADR): permanece OPEN,
   permanece não classificado como risco aceito, permanece exigindo autorização explícita e
   separada antes de qualquer `git filter-repo`/force-push.

## Alternativas consideradas

- **Esperar a decisão de reescrita de histórico antes de prevenir novidade.** Rejeitado: deixaria a
  plataforma acumulando o mesmo tipo de exposição enquanto a decisão de risco/reescrita (que é
  genuinamente mais cara e mais lenta) não é tomada. Prevenção e remediação não competem pelo mesmo
  orçamento de risco.
- **Um scanner novo e paralelo para commit-message, com sua própria lista de padrões/allowlist.**
  Rejeitado: `scripts/pii_detectors.mjs` já é um motor testado (43 testes, `test_pii_detectors.mjs`)
  com allowlist de domínio reservado, prefixo sintético declarado e mecanismo de exposição
  declarada por caminho — duplicar essa lógica criaria duas superfícies de manutenção divergentes
  exatamente no tipo de código onde divergência já causou um incidente real (ver comentário em
  `scripts/audit_pii_repo_wide.mjs` sobre a reconciliação cross-workstream de 2026-08-12).
- **GitHub secret scanning / push protection como controle suficiente.** Rejeitado como *único*
  controle: ambos já estão habilitados neste repositório (confirmado via API), mas seu escopo é
  credenciais/tokens, não PII de participante de um produto específico (email, referência Zelle/
  CashApp, nome). Continuam como camada complementar, não substituta.

## Consequências

- Todo PR/push novo tem suas mensagens de commit auditadas; histórico anterior à base de comparação
  nunca é revarrido — o gate seria proibitivamente lento e, mais importante, fora de escopo: reescrever
  ou redigir histórico é uma decisão de risco, não um efeito colateral de um gate de CI.
- `npm run check` cresce dois checks (`commit-message-pii-gate`, `commit-message-pii-gate-tests`),
  classificados em `bolao/scripts/gate_registry.json` como `REGISTERED_AND_EXECUTED` — nenhum gate
  novo nasce invisível (lição do Issue #219/PR #220).
- HIST-091 e HIST-093 permanecem OPEN. Este ADR não os resolve, não os marca como risco aceito, e
  não muda o requisito de autorização explícita do Eduardo antes de qualquer reescrita de Git
  history.
- Automação futura (incluindo assistentes de IA) que investigar PII neste repositório deve tratar
  conteúdo de arquivo, corpo de commit-message, metadado de identidade (autor/committer) e metadado
  de tag como quatro superfícies **independentes**, cada uma adjudicada separadamente — é
  exatamente o modelo que esta investigação teve que reconstruir na prática, superfície por
  superfície, porque não estava documentado antes.
