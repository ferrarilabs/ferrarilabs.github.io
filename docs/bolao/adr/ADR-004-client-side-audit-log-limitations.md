# ADR-004 — Limitações do audit log client-side

**Status:** Aceito com limitação explícita (não é uma trilha de auditoria à prova de violação).
**Data:** 2026-08.
**Aplica-se a:** `bolao/cdb2026/` (`s.auditLog`, gravado por `appendAdminAuditLog()`,
`app.js:302`).

## Contexto

`appendAdminAuditLog(s, action, detail)` grava um evento (`{action, ts, detail}`) dentro do
próprio objeto de estado (`s.auditLog`), que é o MESMO documento JSON que qualquer cliente com a
`anon key` do Supabase pode ler e sobrescrever via `saveRemoteState()`.

## Declaração explícita exigida pelo mega-prompt da Fase 2

> Um audit log salvo dentro do mesmo estado mutável e gravável pelo cliente não é um registro de
> auditoria verdadeiramente inviolável.

Isso é literalmente verdade aqui: não existe nenhuma barreira técnica impedindo que:
- alguém com acesso ao DevTools do navegador edite `s.auditLog` antes de chamar `saveState()`;
- alguém com a `anon key` (exposta no `config.js`, carregado publicamente por qualquer visitante
  do site) grave diretamente na tabela `bolao_state` via `curl`/Postman, apagando ou reescrevendo
  o log inteiro;
- um bug de merge (como o AUDIT-01 corrigido nesta mesma auditoria) apague entradas do log sem
  querer.

## Decisão

Mesmo com essa limitação, manter o audit log como está — ele tem valor real:
- **Contra erro operacional não-malicioso** (o caso dominante em produção): reconstrói "quem
  marcou o quê e quando" quando dois admins mexem no mesmo dado, ou quando um participante
  contesta um pagamento. Foi literalmente criado para isso — AUDIT-08 (Fase 1, 2026-08) achou
  que `toggle-paid` mexia em dinheiro real sem deixar rastro nenhum antes desta correção.
- **Não** oferece proteção contra um adversário técnico deliberado com acesso à `anon key` ou ao
  navegador do admin — e nunca foi projetado para isso.

Implementar um log verdadeiramente inviolável (write-only, fora do alcance do cliente) exigiria
um backend próprio ou uma RPC Supabase com `service_role` rodando server-side — fora do escopo
desta modernização (mudança de arquitetura, não patch cirúrgico) e do modelo "local-first sem
backend próprio" que é a decisão de plataforma vigente (ver ADR-001).

## Consequências

- Documentar esta limitação explicitamente (este ADR + `CDB2026_RISK_CONTROL_MATRIX.md`) para
  que ninguém trate o audit log como evidência forense em uma disputa de dinheiro real sem
  entender o que ele de fato garante.
- Nenhuma mudança de código nesta modernização — apenas a caracterização honesta do controle
  existente.
