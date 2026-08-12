# ADR-008 — `audit_events` armazena identificadores, não PII

**Status:** Aceito (ratificado pelo operador como decisão B1, 2026-08-07).
**Data:** 2026-08-07/08. **Aplica-se a:** modelo-alvo (`audit` schema).

## Contexto
Existem hoje duas implementações parciais de auditoria e **nenhuma** funciona:
`bolao_state.auditLog` é truncado em 200 entradas a cada escrita (descarta as **mais antigas**, que são
exatamente as que uma disputa precisaria — `JSON_CLASSIFICATION.md` J-04), e `lottery_admin_audit` tem
colunas de hash-chain **sem nenhum trigger** que as calcule ou proteja, com UPDATE/DELETE liberados
(`DATABASE_RECONCILIATION.md` R-04). O schema anuncia um controle que não existe.

Há também um conflito real e não resolvido: **direito ao apagamento vs. integridade de trilha
imutável** (`DATA_GOVERNANCE.md` G-02).

## Decisão
`audit_events` é append-only, hash-chained, e armazena **IDs estáveis, IDs de ator, ação, timestamps,
correlation/request IDs e metadata estruturada segura**. **Não** armazena nomes, e-mails, telefones,
referências de pagamento brutas, segredos ou payloads grandes quando um ID estabelece o mesmo fato.

Quando detalhe sensível for genuinamente necessário, vai para um sidecar `audit_event_details`, com
controle de acesso e retenção independentes, e **fora da hash-chain** — para que PII possa ser redigida
sem quebrar a integridade.

## Consequências
- Resolve G-02: redação-no-lugar passa a ser possível sem reescrever um log append-only.
- Reduz pressão de TOAST na segunda tabela mais propensa a isso (`PERFORMANCE_BASELINE.md` P-06) —
  dividendo de performance de uma decisão de governança.
- Reconstruir um evento "legível" exige join com o sidecar; aceitável.

## Restrição de ordem de construção — a mais crítica do programa
Esta decisão **precisa** estar resolvida antes de `audit_events` existir. Decidir depois significa
reescrever um log append-only, o que é por definição impossível. Custo hoje: ~zero (1 linha em
`lottery_admin_audit`). Cresce por linha.
