# ADR-002 — Estratégia de merge de estado (read-merge-write, sem CAS)

**Status:** Aceito com limitação conhecida e documentada (não "resolvido").
**Data:** 2026-08 (Fase 1 introduziu o fix de read-merge-write — AUDIT-03; Fase 2 caracteriza
formalmente o que ele NÃO resolve).
**Aplica-se a:** `bolao/cdb2026/` (mecanismo específico desta app; BR2026 tem uma implementação
paralela não idêntica — ver `CONSISTENCY_MATRIX.md`).

## Contexto

CDB2026 é local-first: cada navegador mantém o estado completo em `localStorage` e o replica
para uma única linha (`id = "cdb2026"`) numa tabela Supabase (`bolao_state`), usando a
`anon key` (nunca `service_role`). Não existe backend próprio, autenticação de usuário por
sessão de servidor, nem WebSocket — cada cliente decide sozinho quando ler/escrever o remoto.

Antes da auditoria de 2026-08 (AUDIT-03), `saveRemoteState()` fazia um `POST` cego do snapshot
local inteiro, substituindo a linha remota. Um cliente que carregou antes de outra pessoa mudar
algo (ex.: admin marcar um pagamento) apagava essa mudança silenciosamente ao salvar.

## Decisão

`saveRemoteState()` agora faz **read-merge-write**: antes de gravar, lê o estado remoto atual,
executa `mergeStates(local, remote, { preferRemoteResults: true })` (união de entradas por id,
campo `paid` e flags de migração em "any-true-wins", entrada mais nova por `updatedAt` vence em
conflito de edição), grava o snapshot local com o resultado do merge, e só então faz o `POST`.

## O que isso resolve

O caso **sequencial**: cliente B salva depois que a escrita do cliente A já está visível
remotamente. B lê o valor pós-A, o merge preserva as mudanças de A que B nunca tocou. Coberto por
`audit_state_merge.mjs` ("save preserves remote payment mark", "save preserves a concurrent
entry it never saw").

## O que isso NÃO resolve

O caso de **corrida verdadeira**: dois clientes cujas leituras pré-gravação acontecem ANTES de
qualquer um dos dois gravar. Cada cliente só sabe o que ele próprio leu — um cliente que leu
antes da escrita do outro ficar visível não tem como saber dela, e sua própria escrita pode
sobrescrevê-la sem aviso. Provado (não apenas assumido) por um teste de caracterização dedicado
em `audit_state_merge.mjs` ("Fase 2 §4: TRUE concurrent writes are NOT fully resolved by
read-merge-write") que reproduz exatamente esse cenário e confirma o resultado indesejado
acontece.

**Classificação exigida pelo mega-prompt da Fase 2:**
- MITIGADA PARA CLIENTES DESATUALIZADOS SEQUENCIAIS.
- NÃO COMPLETAMENTE RESOLVIDA PARA ESCRITAS SIMULTÂNEAS.

## Por que não foi resolvido nesta modernização

O schema atual (`bolao_state.state jsonb`, upsert por `id`) não tem nenhum dos mecanismos que
tornariam compare-and-swap possível:
- nenhuma coluna de número de revisão;
- nenhum suporte a `If-Match`/ETag no endpoint REST do Supabase usado hoje (PostgREST simples,
  sem RPC customizada);
- nenhuma RPC transacional (`rpc()`) que faça o merge no servidor, dentro de uma transação;
- nenhum armazenamento por entidade (a linha inteira é um único blob JSON — não é possível fazer
  um upsert atômico só do campo `paid.e1`, por exemplo, sem reescrever o documento inteiro).

Implementar qualquer um desses mecanismos é uma mudança de arquitetura de backend, não um patch
cirúrgico — explicitamente fora do escopo autorizado desta modernização ("Não implemente backend
automaticamente").

## Recomendação arquitetural (não implementada)

Se corridas simultâneas se tornarem um problema real observado em produção (hoje: nenhum
incidente relatado), a correção correta é uma RPC Postgres transacional
(`supabase.rpc('cdb2026_apply_patch', {...})`) que recebe um patch semântico (ex.: "marque a
entrada X como paga") em vez do documento inteiro, aplicado dentro de uma transação com
`SELECT ... FOR UPDATE` na linha, eliminando a janela de corrida por completo. Uma alternativa
mais simples, mas parcial, seria adicionar uma coluna `revision integer` e fazer o `POST`
condicional (`WHERE revision = :expected`), rejeitando e forçando um novo merge no cliente
quando a revisão mudou — reduz a janela de corrida ao tempo de uma requisição, não a elimina.

## Consequências de não agir agora

Continua existindo uma janela pequena (a duração de duas leituras+gravações quase simultâneas)
em que uma mudança de admin pode ser silenciosamente sobrescrita por outra. Dado o volume de
uso real (poucos admins, ações não excessivamente frequentes), o risco é considerado baixo mas
não nulo — registrado aqui para que uma decisão futura tenha o contexto completo, não para ser
ignorado.
