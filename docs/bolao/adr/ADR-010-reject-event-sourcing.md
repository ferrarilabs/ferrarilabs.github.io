# ADR-010 — Event sourcing completo é REJEITADO; adota-se log de eventos append-only

**Status:** Aceito (rejeição deliberada, com vocabulário adotado).
**Data:** 2026-08-08. **Aplica-se a:** modelo-alvo.

## Contexto
O modelo-alvo introduz `audit_events` e `outbox_events`, o que naturalmente levanta a pergunta: adotar
event sourcing como paradigma?

Evidência: a tabela em uso tem **3 linhas**; o banco inteiro tem **~500 kB**; há **um** mantenedor;
**nenhum** requisito de replay foi declarado; e `lottery_admin_audit` já captura before/after snapshots.

## Decisão
**Rejeitar event sourcing completo.** Adotar um **log de eventos append-only**, e adotar o
*vocabulário* de ES para clareza:

| Conceito | Neste sistema |
|---|---|
| Commands | Ações de admin (`admin_record_payment`, …) |
| Events | Linhas de `audit_events` (fatos em passado) |
| Aggregates | `participant`, `pool_entry`, `payment` |
| Snapshots | `ranking_snapshots` |
| Projection candidates | ranking, classificação, saldo de pagamento |

## Justificativa
Projeções, versionamento de eventos e ferramenta de replay são complexidade desproporcional a este
volume. Pior: **scoring viraria uma projeção**, e scoring é o subsistema mais protegido do repositório
(ADR-005, quatro suítes independentes). Colocá-lo atrás de replay aumenta risco sem benefício.

## Consequência de nomenclatura
`NAMING_STANDARDS.md` proíbe uma tabela chamada apenas `event` — o nome convida à suposição de que ES
está em jogo. Usar `audit_event` (o que um humano fez) e `outbox_event` (algo a entregar).

## Reavaliar se
Surgir requisito real de replay temporal, auditoria regulatória exigindo reconstrução ponto-a-ponto, ou
múltiplos consumidores independentes do mesmo fluxo de eventos. Nenhum existe hoje.
