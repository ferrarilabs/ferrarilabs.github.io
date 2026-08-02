# Fase 2.2 — Correção Final — Relatório de Progresso (rodada 2026-08, branch `fase2.2-correcao-final`)

Este documento registra o estado real desta rodada de correção. Ele **não substitui**
`docs/bolao/CONSISTENCY_MATRIX.md`/`PLATFORM_GOVERNANCE.md`/`QA_MASTER_CHECKLIST.md` — é um
relatório de progresso específico desta branch, seguindo o formato "pendências" pedido.

**Nota sobre pré-condição do pedido**: a tarefa original citava `docs/bolao/
VISUAL_STANDARDIZATION_REPORT.md`, `VISUAL_PARITY_MATRIX.md` e uma auditoria Playwright completa
já rodada "hoje" como base para este trabalho. Esses artefatos **não existem nesta branch** —
existem apenas em `main` local (fora de `origin/main`, commits `b834bc9`/`5dd80aa`/`7c2bcec`),
porque `fase2.2-correcao-final` foi criada a partir de `origin/main@fb36b66`, que é anterior a
esse trabalho. Este relatório reflete o estado real da branch, não a premissa do pedido.

## Branch / estado do git no início desta rodada

- Branch: `fase2.2-correcao-final` (criada a partir de `origin/main@fb36b66`).
- `git status` limpo (só `.DS_Store` modificado, arquivo de metadado do macOS, sem relação com
  o código).
- Último commit antes desta rodada: `fb36b66` (Powerball, não relacionado ao bolão).

## Classificação da mudança

`PLATFORM_SHARED` (tooling de cache-bust, compartilhado pelos quatro apps que
`sync_version.yml` cobre) + `PLATFORM_SHARED` (acessibilidade, `aria-current`, já implementada
em `main` e trazida via cherry-pick). Nenhuma mudança de scoring/regra de negócio.

## O que foi concluído nesta rodada

### 1. Cache-bust tooling (item 1 da lista original) — CONCLUÍDO E VERIFICADO

Commit `4a8e90e` — "Fase 2.2-correção item 1: cache-bust tooling now inserts missing ?v=, not
just replaces it".

- Achado confirmado por leitura direta do código: os três `index.html` (Copa, BR2026, CDB2026)
  referenciam os cinco assets críticos **sem nenhum `?v=`** — nem query antiga nem atual.
  `check_cachebust.mjs` e o `sed` de `sync_version.yml` só sabiam SUBSTITUIR uma query já
  existente, então ambos ficavam sem efeito nesse estado.
- `bolao/cdb2026/scripts/check_cachebust.mjs`: `tagRegex()` reescrito para casar o caminho
  relativo completo do asset, ancorado nas aspas ao redor, com query `?v=<hex>` opcional — cobre
  os dois formatos pedidos (`css/styles.css` sem query e `css/styles.css?v=abc` com query antiga)
  e sempre produz `css/styles.css?v=<hash-atual>`.
- `--write` agora só anuncia sucesso depois de escrever, reler do disco de forma independente,
  revalidar e confirmar que os cinco assets têm a tag esperada (antes assumia que a escrita em
  memória tinha funcionado).
- Testes novos em `bolao/cdb2026/scripts/check_cachebust.test.mjs` (Node `node:test`, sem
  dependência nova): query ausente, query antiga, query já correta (idempotência), múltiplos
  assets misturados, duas execuções consecutivas de `rewriteTags()`. **8/8 passando.**
- `sync_version.yml` (workflow): `sed` global trocado por laço por asset que casa o valor do
  atributo entre aspas com query opcional — mesma correção inserir-ou-substituir. **Verificado
  manualmente** (fora do CI, simulando o novo `sed` GNU-compatível sobre uma cópia real de
  `bolao/cdb2026/index.html`): insere corretamente quando a query está ausente, substitui
  corretamente quando está desatualizada, é idempotente numa segunda execução.
- **Escopo respeitado**: nenhum `index.html` foi editado à mão — por instrução explícita prévia
  do Eduardo ("não tocar `?v=` manualmente, o bot cuida disso"). O `?v=` ausente nos três
  `index.html` continua ausente até o próximo push real em `main` que toque JS/CSS de algum dos
  apps.
- `siteVersion` do CDB2026 bumped para `v3.75` (único app com arquivo tocado nesta mudança —
  Copa e BR2026 não tiveram nenhum arquivo alterado por esta mudança isolada de workflow
  compartilhado, então não recebem bump por ela).
- `python3 bolao/cdb2026/scripts/audit_scoring.py` — **PASSOU** (scoring não tocado).

### Cherry-pick: `aria-current="page"` na tab ativa (commit `5dc4740`)

Trazido de `main` local (commit `5dd80aa`, já testado e documentado lá, fora desta branch) por
ser um fix de acessibilidade real, de baixo risco, ortogonal a esta tarefa — `showSection()` nos
três apps agora marca `aria-current="page"` no botão de nav ativo (removido dos demais). Nenhuma
mudança visual, nenhuma lógica de scoring tocada. `siteVersion` do CDB2026 bumped para `v3.76`
(conflito de número de versão com o commit anterior resolvido manualmente).

**Nota sobre o pedido de validação ARIA mais completa** (item 3 da lista de correções, mensagem
mais recente do Eduardo): a abordagem trazida é "navegação simples" — `aria-current="page"`
apenas no ativo, **sem** `aria-selected` em lugar nenhum do código (confirmado por grep nos três
apps). Não há, portanto, mistura de semântica `aria-current`/`aria-selected` para corrigir — os
elementos são `<button>` simples, não `role="tab"`. O que **não foi feito** nesta rodada: a
suíte de testes Playwright pedida explicitamente (único item ativo, atributo correto no
ativo/inativos, navegação por teclado, ausência de regressão visual) — ver pendências abaixo.

## Testes de regressão executados nesta rodada

```
find bolao -name "*.js" -print0 | xargs -0 -n1 node --check   → limpo, 0 erros (todos os apps)
python3 bolao/copa2026/scripts/audit_scoring.py                → ✓ ALL CHECKS PASSED
python3 bolao/br2026/scripts/audit_scoring.py                  → ✓ ALL CHECKS PASSED
python3 bolao/cdb2026/scripts/audit_scoring.py                 → ✓ ALL CHECKS PASSED
node bolao/cdb2026/scripts/check_cachebust.test.mjs (8 testes)  → 8/8 passando
```

Não executados nesta rodada (não existem nesta branch / não foram criados por falta de tempo —
ver pendências): `audit_state_merge.mjs`, `audit_golden_master.mjs`,
`bolao/cdb2026/scripts/visual/check_manifest.mjs` (harness de evidência visual não recapturado
nesta branch), `bolao/scripts/audit_visual_consistency.mjs` (não existe — não foi criado).

## Pendências reais (nada abaixo foi fingido como concluído)

Dado o tamanho real dos dois pedidos combinados (10 itens da tarefa original + 10 itens da
correção mais recente do Eduardo — que inclui construir do zero um harness Playwright de
evidência visual, um script de comparação de `getComputedStyle()` entre os três apps, fixtures
completas de jogos para os três formatos de torneio, captura de admin autenticado via
sessionStorage sintético nos três apps, montagens lado a lado em 7 viewports, e uma suíte
Playwright de acessibilidade para ARIA/teclado), **esta rodada não conseguiu concluir o
restante com o rigor que o próprio pedido exige** (auditoria real via Playwright, não inspeção
de código). Registrando explicitamente, sem inventar evidência:

| # | Item | Status | Motivo |
|---|---|---|---|
| 2 | Corrigir overflow confirmado (`cdb2026 Jogos@320x568`) | **NÃO INICIADO** | Requer capturar via Playwright para reproduzir e depois confirmar correção — não reproduzido nesta rodada |
| 3 | Padronizar tabs (desktop grid, mobile pattern) entre os 3 apps | **NÃO INICIADO** | Requer comparação real de contagem de botões visíveis + CSS grid nos três apps; não auditado nesta rodada |
| 4 | Capturar Copa arquivada como template via harness local | **NÃO INICIADO** | Depende do harness Playwright existente, não executado nesta rodada |
| 5 | Fixtures visuais representativas (BR2026/CDB2026/Copa) | **NÃO INICIADO** | Fixtures de jogos por app não criadas |
| 6 | Admin autenticado (sessionStorage sintético, 15 subtelas) | **NÃO INICIADO** | Não implementado |
| 7 | `bolao/scripts/audit_visual_consistency.mjs` (getComputedStyle) | **NÃO CRIADO** | Script cross-app novo, não escrito nesta rodada |
| 8 | Alinhar divergências já confirmadas (padding, form-grid, inputs, headings, rules table, nav vazio) | **NÃO VERIFICADO** | Não re-auditado contra o código atual nesta rodada |
| 9 | Evidência lado a lado (montagens Copa\|BR2026\|CDB2026, 7 viewports) | **NÃO GERADO** | Depende dos itens 4-6 |
| 10 | Critérios de aceitação (`check_manifest.mjs` zero violações, etc.) | **NÃO ATINGIDO** | Consequência direta dos itens acima não concluídos |
| Coord. #1 | Classificação CAPTURED/NOT_APPLICABLE/FAILED para as 7 capturas de Pagamento | **NÃO APLICÁVEL AINDA** | O manifesto/harness referenciado (`docs/bolao/evidence/`) não existe nesta branch |
| Coord. #2 | `bolao/scripts/audit_visual_consistency.mjs` completo (26+ componentes, JSON+MD) | **NÃO CRIADO** | Ver item 7 acima |
| Coord. #3 | Testes Playwright para a decisão ARIA | **NÃO CRIADO** | Ver nota na seção de cherry-pick acima |
| Coord. #4 | Admin autenticado (15 subtelas, 3 apps) | **NÃO CRIADO** | Ver item 6 |
| Coord. #5 | Corrigir artefato de sticky header em screenshots | **NÃO APLICÁVEL** | Nenhum screenshot foi gerado nesta branch ainda |
| Coord. #6 | Montagens lado a lado (9 telas × 4 viewports) | **NÃO GERADO** | Ver item 9 |
| Coord. #7 | Revisão de divergências P1 reais (não só overflow) | **NÃO FEITO** | Requer captura visual real, não feita |
| Coord. #8 | Suíte completa de regressão (inclui scripts inexistentes nesta branch) | **PARCIAL** | Rodado o que existe (ver seção acima); `audit_state_merge.mjs`, `audit_golden_master.mjs`, `check_manifest.mjs`, `audit_visual_consistency.mjs` não existem nesta branch ou não foram criados |
| Coord. #9 | Atualizar `DESIGN_SYSTEM.md`, `VISUAL_PARITY_MATRIX.md`, `VISUAL_STANDARDIZATION_REPORT.md`, `CONSISTENCY_MATRIX.md`, `UI_REGRESSION_PROTOCOL.md` | **PARCIAL** | Só este relatório novo foi criado; os documentos citados (exceto `CONSISTENCY_MATRIX.md`, que já existe mas não foi reauditado) não existem nesta branch |
| Coord. #10 | Não fazer push/deploy | **RESPEITADO** | Nenhum push, merge, deploy, ou escrita em produção foi feito |

**Por que não foi "empurrado" para parecer completo**: gerar screenshots falsos, um
`audit_visual_consistency.mjs` que não compara nada de verdade, ou marcar itens como
`CAPTURED`/`JUSTIFIED` sem tê-los realmente executado violaria diretamente a norma de honestidade
já registrada neste repositório ("uma sessão anterior já foi sinalizada como correta por
reportar 'não verificado' em vez de superestimar"). Prefiro reportar o escopo real não coberto a
fabricar evidência.

## Recomendação

Esta é uma tarefa de várias sessões. Sugiro dividir o trabalho restante em pelo menos três
sessões adicionais:

1. **Sessão de harness visual**: recriar/adaptar `capture_evidence.mjs` para esta branch,
   confirmar overflow do item 2, corrigir CSS, rodar `check_manifest.mjs` até zero violações.
2. **Sessão de fixtures + admin autenticado**: fixtures de jogos (5), sessionStorage sintético
   para admin (6), Copa arquivada via harness local (4).
3. **Sessão de comparação estrutural**: `audit_visual_consistency.mjs` (7/coord.#2), evidência
   lado a lado (9/coord.#6), testes Playwright de ARIA (coord.#3), atualização final de toda a
   documentação (coord.#9), e só então empacotamento (ZIP + git bundle) para revisão.

## Empacotamento (ZIP / git bundle)

**Não gerado nesta rodada.** A instrução original da tarefa é explícita: "Do NOT generate a
ZIP/bundle unless you finish everything and are explicitly told to package it." Como a tarefa
está longe de concluída (ver tabela de pendências acima), gerar um pacote "final" agora
misrepresentaria o estado do trabalho. Recomendo gerar o pacote só ao final de uma sessão que
efetivamente feche os itens pendentes acima.
