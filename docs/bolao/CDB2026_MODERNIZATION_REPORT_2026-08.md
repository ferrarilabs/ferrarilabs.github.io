# CDB2026 — Relatório de Modernização (Fase 2, 2026-08)

**Branch:** `claude/cdb2026-audit-2026-08` (local, não enviada ao remoto por instrução explícita).
**Pré-requisito:** Fase 1 (auditoria + correção cirúrgica) já concluída e commitada —
ver `CDB2026_CODE_AUDIT_2026-08.md`.
**Princípio orientador (citado do mega-prompt):** *"Modernizar a estrutura ao redor da regra sem
alterar silenciosamente o resultado produzido pela regra."*

Este relatório consolida os achados e decisões da Fase 2. Documentos de apoio (não repetidos
aqui): `CDB2026_CODE_INVENTORY.md`, `CDB2026_DATA_DICTIONARY.md`,
`CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md`, `CDB2026_DATA_LINEAGE.md`,
`CDB2026_RISK_CONTROL_MATRIX.md`, `CDB2026_DEPENDENCY_INVENTORY.md`,
`CDB2026_BACKUP_AND_RECOVERY.md`, `CDB2026_OPERATIONS_RUNBOOK.md`, `docs/bolao/adr/ADR-001..005`.

---

## §2 — Golden master (pré-requisito antes de qualquer limpeza)

Criado ANTES de qualquer mudança de código desta fase:
- `bolao/cdb2026/scripts/fixtures/golden_state.json` — fixture anonimizada, real, cobrindo
  placar exato/resultado/lado/erro completo, 0-0 legítimo, perna sem resultado, classificação
  certa/errada, empate de pontuação (desempate completo), entrada sem palpite nenhum.
- `bolao/cdb2026/scripts/audit_golden_master.mjs` — extrai as funções REAIS de `app.js` em
  tempo de execução (não uma cópia hand-transcrita) e fixa um hash SHA-256 do comportamento
  completo. **Esse hash não mudou durante toda a Fase 2** — prova (não afirma) que nenhuma
  limpeza alterou o resultado da regra.

Todas as mudanças de código desta fase foram verificadas contra este suite antes de serem
consideradas concluídas.

---

## §4 — Detecção de código morto

Ver §12 do relatório da Fase 1 (`CDB2026_CODE_AUDIT_2026-08.md`) para as 12 chaves i18n já
removidas. Esta fase ampliou a varredura (ver Anexo A abaixo, achados B1-B9 do sweep de
duplicação/código morto) e removeu, com evidência verificada individualmente:

| Item removido | Verificação feita | Risco | Rollback |
|---|---|---|---|
| `_liveTiesLastPollAt` (variável, `app.js`) | grep confirma 1 declaração + 1 atribuição, zero leituras em todo o arquivo | Nenhum (write-only) | `git revert` do commit |
| `.cdb-results-grid` (CSS) | grep contra `app.js`+`index.html`, incluindo templates gerados | Nenhum | idem |
| `.pick-group-note` (CSS) | idem | Nenhum | idem |
| `.pick-pos-label` (CSS) | idem | Nenhum | idem |
| `.pick-select` (CSS, com comentário adjacente removido junto) | idem | Nenhum | idem |
| `.tie-advance` (CSS) | idem | Nenhum | idem |
| `.tie-vs` (CSS) | idem | Nenhum | idem |
| `.tie-teams-pending` (CSS, seletor combinado — `.tie-teams-admin` preservado, está vivo) | idem, cuidado extra para não remover o seletor irmão vivo | Nenhum | idem |
| `.live-plays-flag` (CSS, seletor combinado — `.live-plays-icon` preservado, está vivo) | idem | Nenhum | idem |

**NÃO removido apesar de aparentemente não-lido** (falso positivo verificado, não removido):
`C.database.provider`/`C.espn.leagueSlug`/`C.database.localFallback` em `config.js` — confirmado
que `localFallback` é um marcador arquitetural já documentado em `CONSISTENCY_MATRIX.md` e
`PROJECT_MEMORY.md` como presente nos TRÊS apps ("mantido nos três"); `provider`/`leagueSlug`
seguem o mesmo padrão de schema compartilhado com BR2026 (que também os tem) e Copa (que tem
`provider`). Remover unilateralmente de só um app criaria uma divergência de plataforma não
autorizada — fora do escopo de um patch cirúrgico de um app só. Registrado como achado, não
executado.

---

## §5/§6 — Duplicidade e eficiência

Um sweep completo e verificado (grep + leitura de todos os 26 sites de `innerHTML=`, todos os
139 símbolos top-level, e cross-check contra `index.html`/`styles.css`/`config.js`/`data.js`)
foi feito cobrindo TODAS as categorias pedidas pelo mega-prompt, não só timestamps. O relatório
completo, com linha exata e evidência de cada achado, está no **Anexo A** deste documento.

### Implementado nesta fase (baixo risco, comportamento idêntico, verificado)

1. **Timezone/timestamp (o achado original que motivou a investigação):** política de timezone
   documentada por leitura direta do código (não assumida): armazenamento é UTC ISO 8601 em
   todo o estado; kickoff/cutoff mostrado ao participante é dual ET+BRT (`fmtDate()`/
   `estTimeStr()`, decisão intencional de Eduardo em 2026-07-17, preservada); recibo/rodapé/
   rótulo de cutoff/CSV administrativo usam só BRT — esses 4 sites foram consolidados num único
   helper `formatBrtTimestamp()` (`app.js`, perto de `legTeams()`). **Achado não corrigido, só
   documentado:** o audit log admin usa `America/New_York` ("ET"), inconsistente com os outros 4
   sites BRT, sem justificativa documentada encontrada — mudar isso muda o horário civil exibido
   (não é só formatação), então não foi alterado sem decisão explícita de Eduardo. Ver
   `CDB2026_RISK_CONTROL_MATRIX.md` para o registro formal.
2. **Cache localStorage (achado A5 do Anexo A):** `loadLiveClockCache`/`saveLiveClockCache` e
   `loadRawClockCache`/`saveRawClockCache` consolidados sobre um par genérico
   `safeLocalStorageGetJson`/`safeLocalStorageSetJson` — mesma chave, mesmo valor, comportamento
   idêntico (verificado: `catch` silencioso preservado exatamente).
3. **Scaffolding de fetch com timeout (achado A1):** `fetchEspnEventSummary()` e
   `fetchEspnCandidates()` reimplementavam manualmente o mesmo `AbortController`+`setTimeout`
   que `fetchJson()` (`app.js:111`) já generaliza, com o MESMO timeout (10000ms). Consolidado
   para chamar `fetchJson()` — o `try/catch` externo de cada função (que já tratava falha de
   rede retornando `null`) foi preservado, só o scaffolding interno duplicado foi removido.
4. **Markup do QR do Zelle (achado A3):** `renderPayment()`/`renderPaymentBox()` duplicavam a
   mesma linha de `<img>` — extraído para `zelleQrHtml()`.

Todos os 4 itens acima foram verificados após a mudança com: `node --check`, o golden master
completo (hash de comportamento **inalterado**), `audit_state_merge.mjs`, e QA de navegador real
(Playwright, desktop 1440 + mobile 390, nas 4 rotas `/bolao/`, `/bolao/br2026/`,
`/bolao/cdb2026/`, `/bolao/copa2026/`) — screenshots confirmaram o Zelle QR, o rodapé BRT, e o
countdown/próximos-jogos renderizando corretamente após as mudanças.

### Documentado, NÃO implementado (risco maior do que o valor justifica, ou requer mais teste do que existe hoje)

- **A2** (`checkVersion()` sem checagem `.ok`): baixo valor, e a função vive num IIFE separado
  que não enxerga `fetchJson()` por desenho (comentário do próprio código explica) — mudar isso
  exigiria reestruturar o escopo de scripts, não é uma correção isolada.
- **A4** (travessia de picks triplicada em recibo/ranking/CSV): a travessia é de fato idêntica,
  mas a SAÍDA de cada uma é genuinamente diferente (HTML com pontos, HTML sem pontos, texto
  CSV) — unificar às cegas arrisca um bug sutil num dos três documentos que provam o que o
  participante apostou. Não centralizado, por instrução explícita do mega-prompt: "não
  centralize funções cujas regras sejam apenas aparentemente semelhantes."
- **A5 (parcial) / persistência do `localStorage` principal:** `state()`/`saveState()` não são
  os únicos pontos de leitura/escrita de `C.storeKey` — `loadRemoteState()`/`saveRemoteState()`
  escrevem diretamente por um motivo real (evitar re-disparar o próprio `saveRemoteState()` e
  causar round-trips infinitos). Não consolidado — o Anexo A explica o risco em detalhe.
- **C1** (`pollLiveTies()` sem guarda de chamada-em-andamento, ao contrário do
  `debouncedReload()` do Supabase que já resolve exatamente esse padrão): achado real e de valor,
  mas a área tocada (polling ao vivo/ESPN) não tem cobertura de golden master (só funções puras
  de scoring são extraídas hoje) — corrigir sem esse teste violaria a regra "qualquer
  refatoração próxima de áreas críticas exige golden master antes e depois". Registrado como
  recomendação para uma iteração futura que primeiro construa esse teste.
- **C2-C8**: ver Anexo A — a maioria é "nada encontrado" ou uma característica arquitetural já
  deliberada (full-render em vez de diffing, ver `ADR-001`), não uma ineficiência corrigível por
  um patch pequeno.

---

## §4 (concorrência) — reavaliação

Read-merge-write (Fase 1, AUDIT-03) **não é uma solução completa** para concorrência simultânea.
Um teste novo e real prova isso (não apenas afirma): dois clientes que leem a mesma versão
remota, fazem alterações independentes, e gravam quase ao mesmo tempo — o segundo sobrescreve o
primeiro sem aviso, porque nenhum dos dois sabia da escrita do outro no momento da leitura.

**Classificação exigida pelo mega-prompt:**
- ✅ MITIGADA PARA CLIENTES DESATUALIZADOS SEQUENCIAIS.
- ⚠️ NÃO COMPLETAMENTE RESOLVIDA PARA ESCRITAS SIMULTÂNEAS.

Detalhe completo, incluindo por que (sem revision number/CAS/RPC transacional/armazenamento por
entidade no schema atual) e a recomendação arquitetural: `docs/bolao/adr/ADR-002-state-merge-strategy.md`.
**Nenhum backend novo foi implementado** — por instrução explícita do mega-prompt.

---

## §5 (`paid`) — reavaliação do any-true-wins

A regra atual (AUDIT-02, Fase 1) faz `paid: true` vencer sempre no merge, para evitar que um
dispositivo desatualizado reverta um pagamento real acidentalmente. **Consequência documentada
aqui, não corrigida:** essa mesma regra também impede a correção legítima de um pagamento
marcado erroneamente como `true` — se um admin corrige `true → false` num dispositivo, e o outro
dispositivo (com `true` desatualizado) sincronizar depois, o `true` antigo vence de volta.

Verificado por leitura de código: `renderAdminPayments()` (`app.js:3218-3234`) já grava
`from`/`to` no audit log (AUDIT-08), mas não tem campo de motivo nem confirmação extra — ao
contrário de `clearAllData()`, que usa `tripleConfirm()`.

**Modelo futuro proposto (não implementado — mudança de forma de dado, exige decisão do
Eduardo):**

```javascript
{
  paid,        // boolean — mantido para compatibilidade com o merge atual
  updatedAt,   // ISO 8601 — quando essa marca foi definida
  updatedBy,   // identificador do admin (hoje não existe login individual por admin)
  reason,      // string obrigatória especificamente quando true → false
  operationId, // uuid — permite idempotência e correlação com o audit log
}
```

Qualquer mudança de `true` para `false` deveria, sob esse modelo, exigir `reason` preenchido e
ficar sujeita a uma confirmação extra (`tripleConfirm()`, já existe e é reutilizável), igual ao
padrão já usado para exclusão de entrada. **Não implementado nesta modernização** — muda o
formato do campo `paid` no estado, o que é uma mudança de contrato de dado que precisa ser
coordenada com qualquer outro consumidor (nenhum encontrado além do próprio `app.js`, mas a
mudança de forma ainda é maior que um patch cirúrgico e mexe perto de dinheiro real).

---

## §6 (fila de e-mail) — reavaliação

`queueReceipt()`/`sendReceipt()` (`app.js:1083-1118`) usa uma fila em memória
(`_emailQueue`, uma `Promise` encadeada) para serializar envios e respeitar o rate limit do
EmailJS (30s entre envios).

**Cenários avaliados (por leitura de código — não há harness de teste para envio de e-mail
real):**

| Cenário | O que acontece hoje |
|---|---|
| Fechar a aba antes do envio | A fila (`_emailQueue`, variável de módulo em memória) é perdida. Se `saveEntry()` já rodou, a entrada FOI salva (local + remoto) — só o e-mail não sai. |
| Refresh da página | Mesmo efeito — a fila não sobrevive a um reload. |
| Falha do EmailJS | `sendReceipt()` captura o erro com `console.error` e retorna — nenhuma UI informa o participante. |
| Retry | **Não existe.** Uma falha não tenta de novo automaticamente. |
| Duplicidade | A fila serializada evita duas chamadas de `sendReceipt()` rodarem ao mesmo tempo (isso é o que ela resolve) — mas não impede duas CHAMADAS de `queueReceipt()` para a mesma entrada (não observado em uso normal, já que `saveEntry()` só chama uma vez por submissão). |
| Múltiplas entradas rápidas | Enfileiradas corretamente, respeitando o rate limit de 30s entre envios — não perdem, só atrasam. |
| Diferença entre enfileirado/enviado/falhou | **Não existe distinção visível na UI.** O toast de sucesso (`savedSuccess`) é mostrado de forma otimista, ANTES do e-mail ser de fato enviado (fire-and-forget). |

**Ação tomada nesta fase (autorizada explicitamente pelo próprio mega-prompt: "documente a
limitação e use mensagens verdadeiras na interface"):** o texto de `savedSuccess` em `i18n.js`
foi corrigido — antes dizia "Verifique seu e-mail para o comprovante" (uma promessa de entrega
antes de ela acontecer); agora diz "O comprovante também fica disponível aqui na página — o
envio por e-mail pode levar alguns instantes", apontando para o comprovante em-página
(`renderReceiptBox()`), que É síncrono e sempre disponível, em vez de prometer um e-mail que
pode falhar silenciosamente.

**Não implementado (mudança de comportamento maior que uma correção de texto):** persistência da
fila (ex. `sessionStorage`) para sobreviver a refresh, retry automático, ou um indicador visual
de enviado/falhou. Registrado como recomendação futura.

---

## §7 (áreas críticas) — confirmação de preservação

- `scoreEntry`, ranking oficial, critérios de desempate, entradas, resultados oficiais,
  campeão/vice, cutoffs, pagamentos, dados históricos: **nenhum comportamento alterado** —
  confirmado pelo hash de comportamento completo do golden master, idêntico do início ao fim
  desta fase.
- `explainScore()` reconcilia exatamente com `scoreEntry()` em todas as 4 entradas da fixture,
  incluindo uma entrada sem nenhum palpite (zero linhas, sem fabricar dado) — 8 checks dedicados
  no golden master, todos passando.

---

## §8 — Verificação final

Ver a saída completa registrada no chat da sessão (2026-08-01) para:
`node --check` em todos os `.js` de `bolao/`; `py_compile` dos 3 `audit_scoring.py` +
`audit_integrity.py`; os 3 `audit_scoring.py` reais; `audit_state_merge.mjs`;
`audit_golden_master.mjs`; `audit_integrity.py` contra a fixture; QA de navegador real
(Playwright headless, Supabase/ESPN/EmailJS/CDN bloqueados para não tocar produção, rotas
`/bolao/`, `/bolao/br2026/`, `/bolao/cdb2026/`, `/bolao/copa2026/`, viewports desktop-1440 e
mobile-390) — screenshots confirmam renderização correta em todas as 4 rotas, sem erro real de
console (o único erro de CSP `frame-ancestors` em `<meta>` é pré-existente e não relacionado a
esta mudança).

---

## Anexo A — Relatório completo de duplicidade/código morto/eficiência

*(Produzido por uma varredura dedicada de leitura completa do arquivo, cruzada com grep contra
`index.html`/`styles.css`/`config.js`/`data.js`; cada achado tem linha exata e evidência.)*

### A. Duplicidade
- **A1** Scaffolding de fetch+timeout triplicado (`fetchJson`, `fetchEspnEventSummary`,
  `fetchEspnCandidates`, e um 4º caso intencionalmente separado em `checkVersion()` por estar
  fora do escopo do IIFE principal) — A1 **implementado** (ver acima), o 4º caso **não**.
- **A2** Checagem de `r.ok` inconsistente em 5 sites, `checkVersion()` sem checagem — **não
  implementado** (baixo valor, escopo de IIFE separado).
- **A3** Markup do QR Zelle duplicado — **implementado**.
- **A4** Travessia de picks triplicada (recibo/ranking/CSV) com saída genuinamente diferente —
  **não implementado** (risco maior que o valor).
- **A5** 4 sites de escrita direta de `C.storeKey` (2 dos quais bypassam `saveState()` por
  motivo real) + 2 pares de cache localStorage — o par de cache **foi** consolidado; os 4 sites
  de `C.storeKey` **não foram** tocados (risco de causar round-trips infinitos).
- **A6-A11** `appendAdminAuditLog`, `saveState` opts, `pickFormIsDirty` (duplicado entre dois
  IIFEs por desenho), crestes de time, sanitização (`esc()`), toast/modal/validação: **nada
  encontrado** que precisasse de correção — verificado, não assumido.

### B. Código morto
- **B1-B2** `_liveTiesLastPollAt` e 7 regras CSS — **removidos** (ver tabela acima).
- **B3** `provider`/`leagueSlug`/`localFallback` em `config.js` — **não removidos** (padrão
  compartilhado entre apps, ver acima).
- **B4-B5, B8-B9** `console.log` de debug, seletores mortos, comentários obsoletos, listeners
  duplicados: **nada encontrado**.
- **B6** Rotinas de migração "rodam uma vez" (`seedKnownConfrontos` etc.): confirmadas AINDA
  alcançáveis (todo estado novo começa com as flags em `false`) — não são código morto.
- **B7** Fallbacks `|| []`/`|| {}` para campos de `DATA` que hoje sempre existem: atualmente
  inalcançáveis, mas não comprovadamente seguros de remover permanentemente (dependem de
  `data.js` manter a forma atual) — **não removidos**.

### C. Eficiência
- **C1** `pollLiveTies()` sem guarda de chamada-em-andamento (ao contrário do
  `debouncedReload()` do Supabase, que já resolve o mesmo padrão de gatilho) — achado real,
  **não corrigido** nesta fase (falta cobertura de teste para a área).
- **C2** Saves ao Supabase não coordenados entre ações administrativas rápidas em sequência —
  mesma classe de risco do §4 (concorrência), **não corrigido** pelo mesmo motivo (exigiria
  arquitetura nova).
- **C3** Duas rotinas de polling ESPN independentes sem cache compartilhado — achado real, baixo
  valor de correção isolada (cada uma tem propósito diferente).
- **C4** Full-render a cada `saveState()`, mesmo para uma mudança de 1 campo — característica
  arquitetural deliberada (sem framework/VDOM, ver `ADR-001`), não um bug.
- **C5** `explainScore()` só é consumida pelo suite de auditoria, não pela UI em runtime — nota
  informativa, não uma ineficiência.
- **C6** Múltiplos listeners no mesmo evento global, para propósitos genuinamente diferentes —
  **nada a corrigir**.
- **C7** Serialização "tripla" do estado no fluxo read-merge-write — cada serialização é de um
  objeto DIFERENTE (pré-merge, pós-merge, payload de rede) — **nada a corrigir**, é o desenho
  intencional do AUDIT-03.
- **C8** Consultas DOM repetidas em loop — **nada encontrado**.

---

## Conclusão

Todas as mudanças de código desta Fase 2 (timezone, cache localStorage, fetch ESPN, QR Zelle,
2 variáveis/seletores mortos + 7 regras CSS mortas, texto do toast de e-mail, `explainScore()`,
`audit_integrity.py`) foram verificadas contra o golden master (hash de comportamento
inalterado), a suíte de merge/orientação, os 3 `audit_scoring.py`, e QA de navegador real nas 4
apps. Nenhuma área crítica (scoring, ranking, desempate, resultados oficiais, pagamentos, dados
históricos) teve seu comportamento alterado. Achados de maior risco (concorrência verdadeira,
audit log não-inviolável, `paid` any-true-wins impedindo correção legítima, fila de e-mail em
memória) foram caracterizados, testados onde possível, e documentados com recomendação — não
corrigidos às pressas sem a base de teste ou autorização que exigiriam.

---

## Fase 2.1 — correções bloqueadoras e paridade visual profissional (2026-08, revisão independente)

Segunda rodada, disparada por uma revisão independente que confirmou 6 bloqueadores reais contra
o código desta branch. Todos os 6 foram trabalhados; os itens abaixo resumem o que foi
efetivamente corrigido/testado vs. o que ficou como limitação documentada.

### 1/2/3 — Semântica de persistência (bloqueador #1/#2)

O read-merge-write da v3.55 (`mergeStates` com `preferRemoteResults: true`) protege resultado
oficial contra cache de PARTICIPANTE, mas a mesma regra aplicada a uma ação do próprio ADMIN
impedia `paid: true -> false`, destravar um confronto, limpar um placar, etc. — não por corrida,
mas porque o merge campo-a-campo não distinguia "correção intencional do admin" de "cache
desatualizado".

**Implementado:** `applyAdminMutation()`/`applyMutationOverRemote()` — toda ação administrativa
agora declara explicitamente qual mudança está fazendo (12 tipos: `upsert-entry`, `delete-entry`,
`set-payment`, `set-cutoff`, `add-tie`, `remove-tie`, `save-leg`, `clear-leg`, `lock-tie`,
`unlock-tie`, `set-active-phase`, mais `espn-add-tie`/`espn-save-result` para o caminho da
sincronização ESPN, e um wrapper `batch` para os ciclos ESPN que mudam vários confrontos numa só
gravação). A gravação começa do estado REMOTO mais recente (preserva qualquer mudança remota não
relacionada — nova entrada, outro pagamento, audit events), aplica a mutação explicitamente por
cima, une entradas/tombstones/audit log pela mesma regra de sempre. Todos os 15 call sites de
escrita administrativa (cutoff, add/remove tie, save/clear leg, lock/unlock tie, toggle-paid,
delete-entry, fase ESPN ativa, `autoSyncEspn()`, `autoSyncEspnResults()`) foram religados para
passar a mutação correta. `mergeStates()` (agora só usada pelo fluxo de participante) e
`applyAdminMutation()` compartilham a lógica de merge de entries/tombstones/audit log via
`mergeEntriesTombstonesAuditLog()`, evitando duplicar a regra duas vezes.

**Testado:** `audit_state_merge.mjs`, seção "Fase 2.1 §3" — as 8 mutações pedidas pelo mega-prompt
(resultado oficial, correção, limpeza, classificado, destravamento, cutoff ×3, pagamento ×2, fase
ESPN) mais preservação de alteração remota independente e batch ESPN. Todas passam contra as
funções REAIS extraídas de `app.js`, não uma cópia.

### 4 — Concorrência (reclassificação em 3 categorias, não 2)

- Clientes sequenciais desatualizados: **MITIGADO** (inalterado desde a v3.55).
- Mutações explícitas: **CORRIGIDAS** por operação direcionada (item acima).
- Gravações simultâneas reais: **limitação arquitetural restante** — nem o read-merge-write nem a
  mutação dirigida eliminam a janela entre duas leituras pré-gravação que acontecem antes de
  qualquer uma das duas escritas ficar visível. Sem revision number/CAS/RPC transacional no
  schema atual, essa classe de risco continua existindo. Ver `docs/bolao/adr/ADR-002-state-merge-strategy.md`
  (seção nova) para a classificação completa e a recomendação arquitetural.

### 5 — Cache-bust

`bolao/cdb2026/index.html` tinha `?v=58d393d` (um commit anterior a TODA a Fase 1/2/2.1).
Substituído por uma tag derivada do conteúdo: os primeiros 12 hex de SHA-256 dos 5 arquivos
críticos (`styles.css`, `config.js`, `data.js`, `i18n.js`, `app.js`) concatenados, em vez de um
identificador escolhido à mão. Editar qualquer um desses arquivos muda a tag automaticamente —
"conteúdo mudou mas o cache-bust ficou parado" deixa de ser possível por construção. Novo script
`scripts/check_cachebust.mjs` (com `--write` para regenerar) falha com código de saída != 0 se a
tag não bater com o conteúdo atual — cobre os dois gatilhos pedidos (`siteVersion` mudar OU
qualquer arquivo crítico mudar), já que `config.js` é um dos 5 arquivos hasheados. Rodado com
`--write` como último passo desta fase, depois de todo o código estar finalizado — **sem deploy**.

### 6/7 — Paridade visual (P1)

Dois problemas concretos corrigidos:
- **Densidade da topbar:** 8 abas primárias → 6 (`Palpites, Ranking, Jogos, Probabilidades,
  Regras, Admin`), igual à contagem/ordem de BR2026. `Participantes`/`Pagamento` saíram da barra
  principal para um link secundário compacto (`.nav-secondary`) logo abaixo — mesmo atributo
  `data-section`, mesmo listener genérico, nenhuma funcionalidade removida. `grid-template-columns`
  ajustado de 8 para 6 colunas (a contagem real de botões visíveis).
- **Botão sticky cobrindo campo:** adotado o padrão canônico exato da Copa (`pointer-events: none`
  no wrapper + só o botão com `pointer-events: auto` + `text-align: right`), mais
  `env(safe-area-inset-bottom)` e `#entry { padding-bottom: ~92px }` (reserva de espaço no fluxo,
  TOURNAMENT_SPECIFIC — CDB2026 tem mais linhas de palpite por página que a Copa).
  **Testado e confirmado sem overlap nos dois estados de repouso reais** (carga inicial e
  scroll-até-o-fim, os únicos dois momentos em que um usuário de fato para e interage) nas 4
  larguras exigidas (320/375/390/414px) — `check_sticky_overlap.mjs`.
  **Limitação documentada, não escondida:** overlap geométrico transitório DURANTE o gesto de
  scroll (25%/50%/75%) ainda ocorre em alguns pontos — isso é como QUALQUER botão `position:
  sticky` funciona (inclusive o da própria Copa, nunca testado antes desta auditoria), e o
  `pointer-events: none` do wrapper garante que esse overlap nunca bloqueia um toque real (só o
  botão em si intercepta clique). Eliminar 100% do overlap geométrico durante scroll ativo exigiria
  abandonar o padrão sticky (ex. uma barra permanentemente fixa reservando espaço o tempo todo) —
  uma mudança maior, não feita aqui por não ser proporcional ao problema real (nenhum campo fica
  inacessível, só temporariamente sobreposto durante um gesto que o próprio usuário controla).

### 8 — Evidência visual durável

`bolao/cdb2026/scripts/visual/capture_evidence.mjs` — harness Playwright real (não produção, rede
externa bloqueada), captura as 3 apps nos 7 viewports exigidos (320×568 a 1440×900), nas seções
disponíveis em cada app (Copa está em modo arquivado — só Ranking é alcançável, documentado no
cabeçalho do script, não é bug do harness). Produz `docs/bolao/evidence/visual/manifest.json`
(rota/seção/viewport/commit/timestamp), `overflow_report.json` (elementos que ultrapassam o
viewport) e `console_errors.json`. Rodado: **84 screenshots, 0 overflow, 0 erro real de console**.
Nenhum dado real de participante usado (estado sintético/vazio).

### 9 — Documentação

`CONSISTENCY_MATRIX.md`: corrigidas as 3 afirmações erradas confirmadas contra o código atual
(`database.enabled` — era descrito como `false`, é `true`; estratégia de merge — era descrita como
"local-wins", corrigido para descrever o any-true-wins/remote-wins/mutação-dirigida real; "nenhuma
API externa" — corrigido, CDB2026 usa ESPN desde antes desta modernização). O item de detecção de
adiamento já tinha sido corrigido na auditoria anterior. Status de publicação já estava correto
("Em produção").

PII removida de `CDB2026_BACKUP_AND_RECOVERY.md`, `CDB2026_OPERATIONS_RUNBOOK.md`,
`CDB2026_DATA_DICTIONARY.md`, `CONSISTENCY_MATRIX.md` e `audit_integrity.py` (comentário) — nome
real de participante substituído por "Participante A #1/#2" nos exemplos; e-mails/nomes reais de
outras 2 entradas substituídos por "Participante A/B/C". `CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md`
ganhou 4 requisitos novos (R23 paridade visual, R24 mutação administrativa, R25 fixtures
positiva/negativas, R26 cache-bust), cada um apontando para o teste real que o verifica.

### 10 — Fixtures de integridade

`golden_state.json` não tinha mais nenhum WARNING/ERROR/CRITICAL depois de mover o único caso
problemático (perna FINAL 0x0 com kickoff no futuro) para `invalid_future_final_0x0.json`, uma de
3 fixtures negativas novas (`invalid_duplicate_entry.json`, `invalid_orphan_pick.json` completam
o conjunto). `audit_integrity.py --self-test` (novo modo) roda os 3 self-tests do script —
transcrição de pontuação bate com o golden master, fixture golden roda limpa, e cada fixture
negativa dispara exatamente o finding que existe para provar — e falha (`exit 1`) se qualquer um
não bater, em vez de exigir inspeção manual da saída.

### 11/12 — Aceitação e veredito

Ver a saída da suíte completa registrada no chat da sessão (2026-08-01) para a prova de cada
critério de aceitação. **Não declarado "APROVADO PARA PRODUÇÃO"** neste documento — por instrução
explícita do mega-prompt, esse veredito não é dado enquanto o cache-bust e as mutações
administrativas não estivessem corrigidos; ambos foram corrigidos e verificados nesta fase, mas
a declaração final de aprovação é uma decisão do Eduardo, não deste relatório.
