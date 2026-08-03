# Authorization Test Plan — Origin, Object, and Property (reference suite)

2026-08-02. Proposta de referência para testes de autorização por origem, objeto e propriedade —
reutilizável em bolões futuros e no eventual backend real proposto em
`docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md`. Complementa
`supabase/tests/rls/` (que cobre policy SQL diretamente); este documento cobre o raciocínio de
teste em nível mais alto, incluindo camadas que RLS sozinha não resolve.

**Regra fixada explicitamente, conforme pedido pela tarefa**: origem permitida (CORS) nunca
concede autorização; origem não permitida nunca protege contra um cliente HTTP direto. Nenhum
teste abaixo deve tratar "a chamada veio do domínio certo" como prova de que ela era legítima.

## 1. Testes de autorização por origem (Origin)

| Teste | Por quê | Status hoje |
|---|---|---|
| Uma chamada de escrita feita sem header `Origin` (ex.: `curl`, script Python) deve ser avaliada pelas mesmas regras de RLS que uma chamada feita por um navegador em `www.ferrarilabs.com` | Confirma que CORS não é usado como controle de acesso | **Confirmado por design** — os scripts Python já fazem isso rotineiramente (sem `Origin`) e usam a mesma RLS; ver `SESSION_AND_TOKEN_SECURITY.md` |
| Uma chamada com `Origin` arbitrário (`https://evil-attacker-example.com`) deve receber a mesma resposta RLS que qualquer outra origem | Confirma que CORS não substitui autorização | **Testado nesta auditoria** (leitura) — Supabase reflete qualquer `Origin`; RLS (não CORS) é o único portão real, ver `CORS_AND_ORIGIN_POLICY.md` |

## 2. Testes de autorização por objeto (linha `bolao_state`)

| Teste | Por quê | Status hoje |
|---|---|---|
| `anon` não deve conseguir ler/gravar uma linha com `id` fora de `('main','br2026','cdb2026')` | BOLA clássico — acessar objeto de outro "tenant" | **Confirmado (leitura)** nesta auditoria — RLS restringe corretamente ao conjunto de 3 ids |
| `anon` não deve conseguir gravar em `bolao_state` com um `id` fabricado (ex. `id='admin-only'`) para criar uma linha fora do conjunto autorizado | BOLA na direção de escrita | **Não executado** (seria escrita em produção); esperado que a `WITH CHECK` já bloqueie — ver `RLS_POLICY_MATRIX.md` |

## 3. Testes de autorização por propriedade (dentro do mesmo documento JSON)

Esta é a camada que **RLS não resolve hoje** — documentado extensivamente em
`SUPABASE_SECURITY_REVIEW.md` e no ADR-006. Os testes abaixo são os que **deveriam** existir uma
vez que a arquitetura evolua (RPC gated, ou tabelas separadas):

| Teste | Por quê | Status hoje |
|---|---|---|
| Um participante autenticado só pode escrever seu próprio objeto em `entries[]` — não pode alterar `entries[]` de outro participante na mesma chamada | Broken Object Property Level Authorization | **Não enforced** — qualquer `update` bem-formado da linha inteira passa hoje |
| Um participante não pode escrever em `state.results`/`state.phases[].ties` | Function-level authorization (participante vs. admin) | **Não enforced** |
| Um participante não pode escrever em `state.paid` para uma entrada que não é a dele | Property-level authorization | **Não enforced** |
| Um participante não pode escrever/remover `state.auditLog` | Integridade da trilha de auditoria | **Não enforced** — `auditLog` é só mais uma chave do mesmo JSON mutável |
| Um participante não pode alterar `state.meta`/`cutoffAt`/`phases[].cutoffAt` | Regra de negócio (cutoff), não só segurança | **Não enforced** por banco — só client-side |
| Admin (via uma futura autenticação real) pode alterar `results`/`paid`/`cutoffAt` | Caminho legítimo que deve continuar funcionando após qualquer hardening | Hoje "funciona" só porque a UI restringe — não há ainda um caminho de admin autorizado a nível de banco para preservar |

## Onde isso deveria rodar

Ver `supabase/tests/rls/README.md` — os testes de objeto/origem que envolvem só SQL/RLS puro
cabem lá (pgTAP). Os testes de propriedade que dependem de uma futura RPC/Edge Function
(ADR-006) precisarão de um runner de integração HTTP (ex. um script Node/Python que faz
requisições reais contra uma instância de teste, nunca produção) — não implementado nesta
revisão, documentado aqui como requisito para quando a arquitetura evoluir.

## Não implementado nesta revisão

Nenhum destes testes foi implementado como código executável além dos exemplos `.sql` em
`supabase/tests/rls/` (que já são proposta, não execução real). Este documento é o plano de
referência pedido pela tarefa, não uma suíte funcional — depende de decisões arquiteturais
(ADR-006) que exigem aprovação explícita do Eduardo antes de implementação.
