# CDB2026 — Auditoria de código (2026-08)

## Resumo executivo

| | |
|---|---|
| App auditado | Bolão Copa do Brasil 2026 (`bolao/cdb2026/`) |
| Versão no início | `v3.54` |
| Versão após correções | `v3.55` |
| Branch | `main` |
| Commit auditado | `a32baef0308cebd25c4f50257e22a15b512162e9` |
| Relação com `origin/main` | 0 à frente / 0 atrás (sincronizado; árvore limpa) |
| Data | 2026-08 |

**Estado geral:** o app está bem mais completo do que a documentação afirmava (ver §"Documentação
desatualizada"). O motor de pontuação oficial está **correto** e permanece intocado. Os problemas
encontrados estavam concentrados em **persistência concorrente** e nos **documentos que provam o
que o participante apostou** — não no cálculo de pontos.

| Severidade | Confirmados | Corrigidos |
|---|---|---|
| P0 | 1 | 1 |
| P1 | 4 | 4 |
| P2 | 3 | 3 |
| P3 | 0 | 0 |
| Decisão de produto | 2 | 0 (aguardam Eduardo) |
| Limitação arquitetural | 1 | 0 (exige backend) |

Hipóteses do briefing que se mostraram **não-bugs**: 3 (detalhadas em §"Hipóteses não confirmadas").

---

## Funções que JÁ EXISTIAM antes desta auditoria

Registrado explicitamente para não atribuir a este trabalho nada que já estava pronto:

- Nove fases, confrontos dinâmicos, partida única e ida-e-volta, seleção de classificados.
- `scoreEntry()` / `matchPoints()` / `liveScoreEntry()` / `rankEntriesBy()` — pontuação oficial,
  pontuação ao vivo e desempate.
- `audit_scoring.py` (5 checagens, passando) — **existia**, ao contrário do que a matriz dizia.
- Detecção de jogo adiado (`postponed`, `isLegPostponed`, i18n `gamePostponed`) — **existia**
  desde a v3.54, ao contrário do que a matriz dizia.
- Comprovante (`receiptHtml`, `receiptCode`), e-mail EmailJS, export CSV/JSON/HTML.
- Sincronização ESPN (`autoSyncEspn`, `autoSyncEspnResults`), card ao vivo, hero de ranking ao vivo.
- Painel admin, controle de pagamento, audit log parcial, `tripleConfirm()` em ações destrutivas.
- Supabase + localStorage, `mergeStates()`, service worker, `AbortController` em todo fetch.
- `window.__CDB2026_TESTHOOKS__`.

---

## Problemas comprovados

Todos foram **reproduzidos antes de corrigir**. Os IDs abaixo aparecem como comentário no código.

### AUDIT-03 — P0 — Gravação sobrescreve alterações de outro cliente (lost update)

- **Arquivo/função:** `bolao/cdb2026/js/app.js` → `saveState()` / `saveRemoteState()`
- **Evidência:** `saveRemoteState()` fazia `POST` da coluna `state` inteira com o snapshot local
  de quem gravou. O header `Prefer: resolution=merge-duplicates` resolve conflito de **linha** no
  upsert — **não** mescla o JSON. Nenhum caminho de escrita relia o remoto antes de gravar.
- **Reprodução (executada contra a função real, com `fetch` mockado):** remoto tem `paid.e1=true`
  (admin) e a entrada `e3` de outro participante; cliente com cache anterior salva sua entrada
  `e2`. Antes: POST continha `paid.e1=false` e **apenas** `e1,e2` → pagamento revertido e `e3`
  **apagada**. Depois: `paid.e1=true` e `e1,e2,e3`.
- **Impacto:** perda de dados em dinheiro real, mais provável justamente no pico de envios perto
  do prazo.
- **Correção:** read-merge-write — `saveRemoteState()` lê o estado remoto atual e passa por
  `mergeStates(..., { preferRemoteResults: true })` antes de gravar. Se a pré-leitura falhar
  (offline), grava o snapshot local mesmo assim e registra `console.warn` (melhor que perder a
  entrada; o risco de sobrescrita volta só nesse caso degradado).
- **Teste:** `audit_state_merge.mjs` → "save preserves remote payment mark", "save preserves a
  concurrent entry it never saw".

### AUDIT-01 — P1 — Flags de migração `espnSync` descartadas em todo merge

- **Arquivo/função:** `app.js` → `mergeStates()`
- **Evidência:** o objeto `espnSync` era **reconstruído do zero** com apenas `activePhaseId` e
  `seededKnownConfrontos`. Cinco flags são escritas no estado; três (`backfilledOitavasKickoffs`,
  `healedFalseAutoResults`, `healedPhantomTies`) não constavam e sumiam. Como `loadRemoteState()`
  substitui o localStorage pelo resultado do merge, elas sumiam **em todo sync remoto**.
- **Reprodução:** merge com os dois lados totalmente flagados → só 2 de 5 sobreviviam.
- **Impacto:** rotinas documentadas como "roda uma vez" voltavam a rodar a cada carga.
  `backfillOitavasKickoffs`/`healFalseEspnAutoResults` são auto-protegidas e idempotentes na
  prática; **`healPhantomTies` apaga ties** fora da lista curada de `DATA.knownConfrontos` — um
  confronto adicionado à mão pelo admin numa fase curada, antes de qualquer palpite referenciá-lo,
  era silenciosamente removido na carga seguinte.
- **Correção:** lista explícita `ESPN_SYNC_ONCE_FLAGS` com merge OR (any-true-wins) por flag.
- **Teste:** 6 checagens em `audit_state_merge.mjs`.

### AUDIT-02 — P1 — `paid` usava spread (local vence) em vez de any-true-wins

- **Arquivo/função:** `app.js` → `mergeStates()`
- **Evidência:** `{ ...remote.paid, ...local.paid }` faz local vencer incondicionalmente. Um
  `false` local antigo apagava um `true` remoto mais novo do admin. `PROJECT_MEMORY.md` já
  **descrevia** este merge como any-true-wins e a Copa já implementava assim de verdade — só
  CDB2026/BR2026 tinham o spread.
- **Correção:** união das chaves dos dois lados com OR por chave.
- **Teste:** 4 checagens (inclui "unpaid stays unpaid", para não criar pagamento fantasma).

### AUDIT-04 — P1 — Falha de gravação no Supabase tratada como sucesso

- **Arquivo/função:** `app.js` → `saveRemoteState()` / `saveState()`
- **Evidência:** `await fetch()` **não rejeita** em 4xx/5xx e não havia checagem de
  `response.ok`; o call site usava `.catch(() => {})` vazio. Um 401/403 (RLS), 400 ou 500
  resultava em toast de sucesso normal, com o dado só no navegador. O caminho de **leitura** já
  checava `r.ok` — só o de escrita não.
- **Correção:** `saveRemoteState()` lança em `!r.ok` (com status e trecho do corpo); `saveState()`
  loga e mostra o novo toast `syncFailed`, que diferencia "salvo neste dispositivo" de
  "sincronizado" e orienta a avisar o organizador. O dado local **nunca** é perdido.
- **Teste:** "HTTP 403 rejects instead of reporting success", "offline pre-read still saves".

### AUDIT-05 — P1 — Placar da VOLTA invertido no comprovante, no ranking e no CSV

- **Arquivo/função:** `app.js` → `receiptHtml()`, `renderPickDisplay()`, `exportCsv()`
- **Evidência:** o formulário coleta `goalsHome`/`goalsAway` relativos ao mandante **real** da
  perna (na volta o mandante é `teamB`), e a aba Jogos/o admin já exibiam assim. Estas três
  superfícies imprimiam `teamA × teamB` fixo.
- **Reprodução (Vasco=teamA, Fluminense=teamB):** palpite de volta "Fluminense 3 × 0 Vasco"
  aparecia como **"Vasco 3 × 0 Fluminense"** — inversão do que foi apostado.
- **Impacto:** **não afeta pontuação** (`matchPoints()` compara palpite e resultado na mesma
  orientação). Afeta exatamente os documentos que provam a aposta numa disputa por dinheiro real.
- **Correção:** função única `legTeams(tie, leg, match)` (fonte única de "quem é mandante nesta
  perna", respeitando `match.homeTeam/awayTeam` quando a ESPN já gravou), usada nas três
  superfícies.
- **Teste:** 4 checagens de orientação em `audit_state_merge.mjs`.

### AUDIT-06 — P1 (latente) — Jogo adiado podia virar resultado FINAL 0-0 automático

- **Arquivo/função:** `app.js` → `fetchEspnCandidates()` (consumido por `autoSyncEspn()` e
  `autoSyncEspnResults()`)
- **Evidência:** `postponed` era calculado corretamente, mas `homeScore`/`awayScore`/
  `homeWinner`/`awayWinner` só checavam `evState === "post"`. Dados reais da ESPN (verificados em
  2026-07-29 na `bra.1`) mostram jogo adiado como `state:"post"` **com `score:"0"`** — ou seja,
  `homeScore` viraria `0`, não `null`.
- **Impacto:** gravaria a perna como `FINAL` 0-0 de um jogo nunca disputado, pontuando quem
  "acertou" 0-0; pior, `if (m.goalsHome != null) return` faz o placar falso **bloquear para
  sempre** o preenchimento do resultado real.
- **Exposição hoje:** **nenhuma** — verificado contra a API real: 142 jogos da Copa do Brasil,
  **0** adiados no momento. Latente, mas a competição adia jogos com frequência.
- **Correção:** `&& !postponed` nos quatro campos.

### AUDIT-07 — P2 — Comprovante prometido por e-mail que nunca era enviado

- **Arquivo/função:** `app.js` → `sendReceipt()` / `saveEntry()`
- **Evidência:** `_lastEmailTs` é **global** (não por participante). A 2ª entrada salva dentro de
  30 s — inclusive de **outra pessoa** — caía em `return` silencioso: sem e-mail ao participante,
  sem cópia ao admin, sem erro. E o toast dizia "Palpite salvo! **Verifique seu e-mail** para o
  comprovante."
- **Correção:** fila serial `queueReceipt()` que **espera** a janela em vez de descartar. O rate
  limit continua existindo (proteção de cota do EmailJS, exigida pelo briefing); a mensagem ao
  participante passa a ser verdadeira.

### AUDIT-08 — P2 — Ações de admin sobre dinheiro sem rastro no audit log

- **Arquivo/função:** `app.js` → handler `data-toggle-paid`, handler `data-delete-entry`
- **Evidência:** o audit log cobria resultado/tie/lock/unlock, mas **não** a marcação de
  pagamento nem a exclusão de entrada — as duas ações mais ligadas a dinheiro.
- **Correção:** `appendAdminAuditLog()` em ambas, com antes/depois (`toggle-paid`: `from`/`to`;
  `delete-entry`: nome, e-mail e se estava paga) + rótulos i18n.

### AUDIT-09 — P2 — Fuso horário implícito no comprovante

- **Arquivo/função:** `app.js` → `receiptHtml()` ("Enviado em")
- **Evidência:** único `toLocaleString("pt-BR")` do arquivo **sem** `timeZone`. Como o comprovante
  é gerado no cliente, um participante no exterior via um horário que parece BRT mas não é,
  divergindo do CSV (que já usava `America/Sao_Paulo`).
- **Correção:** `{ timeZone: "America/Sao_Paulo" }` + sufixo `(BRT)` explícito. **Nenhuma data
  histórica foi alterada** — só a apresentação.

---

## Hipóteses não confirmadas (investigadas, NÃO são bugs)

1. **Bônus de campeão/vice ausente no ranking ao vivo da final.** `liveScoreEntry()` soma apenas
   pontos de partida e nunca projeta pódio. Isso é **deliberado e documentado**
   (`CDB2026_RULES_AND_MODEL.md` §8: projetar classificado ao vivo depende do agregado ida+volta,
   possivelmente prorrogação/pênaltis — "especulativo demais"). O bônus oficial é aplicado
   corretamente por `scoreEntry()` a partir de `officialPodium()`. **Comportamento correto e
   conservador — nada alterado.**
2. **Campeão/vice e pênaltis.** `officialPodium()` resolve só de `tie.qualifiedTeamId`, que exige
   lock manual (com escolha explícita obrigatória em empate) ou sinal `homeWinner`/`awayWinner` da
   ESPN pós-pênaltis. Empate sem sinal **não** resolve vencedor. Correto nos 4 cenários testados.
3. **Formatação de comprovante/CSV** (acentos, 0-0 vs "não jogado"). `esc()` é passe único,
   charset UTF-8 declarado, CSV com BOM e aspas; todas as superfícies testam `!= null` (nunca
   truthy), então 0-0 legítimo nunca se confunde com "sem resultado". **Nada a corrigir.**
4. **Colisão de service worker / cache entre apps.** `bolao/sw.js` e `bolao/copa2026/sw.js` são
   byte-idênticos e genéricos (sem path de app); o handler é network-first para HTML e
   cache-first só para URLs com `?v=`, e o `activate` apaga todo cache com nome diferente do
   atual. Não reproduzi colisão. **Não alterado** (o briefing pede prova antes de mexer).
5. **Overflow horizontal / tabela travada no mobile.** CDB2026 é mata-mata e **não tem tabela de
   classificação** — a classe de bug corrigida no BR2026 não se aplica. 28 combinações
   rota×viewport sem overflow.

---

## Decisões que dependem do proprietário (não alteradas)

1. **Privacidade da página de participantes.** Hoje é pública e mostra: nome da entrada, **nome
   real do pagador**, **método de pagamento** (CashApp/Zelle/Venmo) e status pago/não pago
   (`app.js`, `renderParticipants`). Não foi alterado — o briefing classifica isto como decisão de
   produto. Opção mínima se quiser reduzir exposição: manter só o nome da entrada + status.
2. **Exclusão de entrada.** É soft-delete (`deletedIds`; o objeto continua no estado) com **uma**
   confirmação, enquanto ações destrutivas de resultado usam `tripleConfirm()`. Agora tem audit
   log (AUDIT-08). Falta decidir: promover para `tripleConfirm()`? Avisar o participante por
   e-mail? (O briefing pede para **não** implementar e-mail de exclusão sem confirmar que é
   requisito vigente — classificado aqui como **requisito não confirmado**.)

---

## Limitação arquitetural (exige backend — fora do escopo)

O app é estático: a "autenticação" do admin é um hash SHA-256 comparado **no navegador**, e o
cliente usa a chave `publishable`/anon do Supabase. Verificado: **nenhuma** `service_role` no
código-cliente e senha nunca em texto puro — o que é o correto possível nesta arquitetura. Mas:

- quem tiver a chave pública pode, pelo console, gravar na linha do estado (inclusive resultados);
- o mesmo hash de admin é compartilhado pelos três apps;
- o cutoff é apenas client-side.

Isto **não** é corrigível sem servidor. Não implementei backend (fora do escopo) e **não** afirmo
que o painel ficou "seguro". Evolução futura: autenticação real, autorização por papel, endpoints
administrativos e resultados imutáveis via Edge Functions.

---

## Documentação desatualizada encontrada

`docs/bolao/CONSISTENCY_MATRIX.md` estava descrevendo um estado muito anterior ao código:

| Afirmação da matriz | Realidade verificada no código |
|---|---|
| Copa `v4.125`, em `bolao/` | `v4.161`, movida para `bolao/copa2026/` |
| BR2026 `v1.14`, "Não publicado" | `v1.79`, em produção |
| CDB2026 `v2.0`, "Não publicado" | `v3.54` (agora `v3.55`), **em produção** |
| Item 25: CDB2026 "sem CSS, sem i18n, sem lógica" de adiamento | Existe desde v3.54 (`postponed`, `isLegPostponed`, `gamePostponed`) |
| CDB2026 sem auditor de pontuação | `bolao/cdb2026/scripts/audit_scoring.py` existe e passa 5/5 |

Cabeçalho e os itens contraditos foram atualizados; o histórico foi preservado e marcado como tal.

---

## Testes

| Comando | Antes | Depois |
|---|---|---|
| `find bolao -name "*.js" \| xargs -n1 node --check` | OK (14 arquivos) | OK (14 arquivos) |
| `python3 -m py_compile bolao/*/scripts/*.py` | OK | OK |
| `python3 bolao/cdb2026/scripts/audit_scoring.py` | 5/5 | 5/5 |
| `python3 bolao/br2026/scripts/audit_scoring.py` | 5/5 | 5/5 |
| `python3 bolao/copa2026/scripts/audit_scoring.py` | 6/6 | 6/6 |
| `node bolao/cdb2026/scripts/audit_state_merge.mjs` | (não existia) | **21/21** |

`audit_state_merge.mjs` **extrai as funções reais** de `app.js` em tempo de execução (não é uma
transcrição à mão) — se alguém editar `mergeStates`/`saveRemoteState`/`legTeams`, a suíte enxerga.
Sem dependências novas, sem rede, sem Supabase. Validado que **falha** contra o código pré-correção
(3 flags perdidas, pagamento revertido, 403 silencioso) e passa depois.

**Browser QA (executado, não presumido):** Playwright/Chromium contra `python3 -m http.server`.
28 combinações rota×viewport (`/bolao/`, `/bolao/br2026/`, `/bolao/cdb2026/`, `/bolao/copa2026/` ×
320×568, 375×667, 390×844, 414×896, 768×1024, 1024×768, 1440×900): **0 overflow horizontal, 0 erro
de JS**. As 8 seções do CDB2026 navegam e ativam corretamente; 48 controles focáveis no formulário.

---

## Regressão

- **CDB2026:** alvo das mudanças; suítes acima + QA de navegador.
- **BR2026:** `git diff --name-only` confirma **nenhum** arquivo tocado; `audit_scoring.py` 5/5;
  rota e navegação OK em todos os viewports.
- **Copa do Mundo 2026:** **nenhum** arquivo tocado; `audit_scoring.py` 6/6; modo arquivado intacto
  (só Ranking/Participantes/Pagamento visíveis, seção ativa = `ranking`); `/bolao/` continua
  redirecionando para `/bolao/br2026/`; os 4 stubs de redirect antigos continuam respondendo 200.
  Nenhum resultado histórico recalculado ou alterado.

---

## Limitações desta auditoria

- **Nenhuma escrita foi feita em produção.** Nenhum e-mail real enviado, nenhum registro do
  Supabase alterado, nenhum push/deploy. As correções estão em commit local para revisão humana.
- Os cenários de concorrência foram exercitados contra as **funções reais** com `fetch`/
  `localStorage` mockados — não contra o Supabase real (proibido pelo briefing).
- AUDIT-06 é **latente**: verificado que hoje não há jogo adiado na Copa do Brasil, então não foi
  possível observar o bug disparando com dado real — a prova é o caminho de código somado ao
  formato real da ESPN observado na `bra.1` em 2026-07-29.
- Não auditei em profundidade BR2026/Copa além do necessário para regressão e comparação.
- Dados esportivos (confrontos, datas, códigos ESPN) **não** foram alterados.
