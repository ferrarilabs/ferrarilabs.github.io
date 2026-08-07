# Test isolation — gravação remota fail closed

**Status:** obrigatório, nos três apps (`copa2026`, `br2026`, `cdb2026`)
**Criado:** 2026-08-07 (P0, depois do incidente de produção do CDB2026)
**Suíte:** `bolao/scripts/audit_test_isolation.mjs` (33 checks)

## Por que isto existe

O incidente de produção do CDB2026 foi causado por uma fixture de harness que carregou a
aplicação com a configuração **real** do Supabase e gravou entradas sintéticas na tabela de
produção — entradas, chaves de `paid` e confrontos que tiveram de ser removidos por SQL manual.

A causa raiz não foi a fixture. Foi que **nada impedia** a fixture: `url`, `anonKey` e `stateId`
de produção estão hardcoded em `js/config.js` de cada app, e é isso que qualquer harness carrega.
Não havia flag de teste, porque não existia nenhuma.

## A regra

> Gravação remota é **NEGADA por padrão** sempre que a origem não é a produção **ou** o navegador
> está sob automação. Só um override explícito, digitado no console, libera.

Contexto não-produção:

| Condição | Exemplo | Resultado |
|---|---|---|
| `location.origin !== "https://ferrarilabs.github.io"` | `localhost:8080`, `127.0.0.1`, `file://` | **BLOQUEADO** |
| `navigator.webdriver` verdadeiro | Playwright, Puppeteer, Selenium | **BLOQUEADO** |
| Produção real, sem automação | participante de verdade | permitido |

Participantes reais nunca satisfazem nenhuma das duas condições de bloqueio.

## Onde o guard fica — e por que ali

Dentro de `saveRemoteState()`, **antes** de qualquer chamada remota. Esse é o único ponto por onde
toda escrita remota passa nos três apps.

Deliberadamente **não** em cada chamador: um guard que depende de o teste lembrar de chamá-lo não
é uma fronteira, é uma convenção — e foi exatamente uma convenção que falhou no incidente.

A escrita **local** (`localStorage`) continua acontecendo normalmente. O guard só impede o vazamento
para a produção; nada é perdido.

## Escape hatch

Para administrar a produção a partir de um preview local, digite no console:

```js
sessionStorage.setItem("cdb2026_allow_production_writes", "I UNDERSTAND");
// br2026_allow_production_writes / copa2026_allow_production_writes para os outros
```

Propriedades intencionais: precisa ser digitado, o valor tem de casar exatamente com
`"I UNDERSTAND"`, é namespaced por app (não vaza entre apps), e morre ao fechar a aba. Quando
ativo, cada gravação emite um `console.warn` avisando que está escrevendo na produção.

Se `sessionStorage` lançar (modo restrito, `file://`), o override é tratado como **ausente** —
fail closed, nunca fail open.

## Limitação — leia antes de confiar nisto

Este é um controle de **camada de aplicação**, não uma fronteira de segurança de banco. Ele **não**
impede um `POST` direto na REST API do Supabase com a anon key, por fora da aplicação. A anon key é
pública por construção (está no `config.js` servido ao browser).

A afirmação correta é: *"o vetor que causou o incidente — um harness carregando a aplicação — está
fechado"*. Não: *"é impossível escrever na produção por qualquer meio"*.

Enforcement real no banco (RLS por role/origem, em vez de RLS apenas por `id`) fica para a
modernização do banco — ver a branch `db-modernization-architecture`. **Continua sendo o risco de
produção aberto de maior severidade.**

## Regra para qualquer teste futuro

- Nenhuma fixture aponta para a produção. Testes de browser rodam contra `localhost` — onde este
  guard já os bloqueia por origem, e o `navigator.webdriver` do Playwright os bloqueia de novo.
- Nunca setar o override dentro de um teste, script ou workflow. Ele é para uso humano interativo.
- Ao adicionar um app novo, adicionar o guard **e** o app na lista `APPS` de
  `bolao/scripts/audit_test_isolation.mjs` no mesmo patch.
