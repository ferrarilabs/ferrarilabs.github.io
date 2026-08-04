# Visual Standardization Report — FASE 2.2 (2026-08-02)

> **ATENÇÃO (atualizado em 2026-08, branch `fase2.2-correcao-final`):** este relatório foi
> escrito em 2026-08-02 e descreve corretamente o que era verdade NAQUELE momento (nenhuma
> mudança de código feita naquela sessão). Sessões subsequentes na mesma branch implementaram
> correções reais que fecham vários dos itens abaixo listados como "Ainda aberto"/"Pendências":
> - **H-3 (`aria-current`/`aria-selected`, P2)** — **RESOLVIDO.** `aria-current="page"`
>   implementado nos três apps, validado por `bolao/scripts/test_aria_current_nav.mjs`
>   (mouse + teclado, os três apps). Não é mais uma pendência.
> - **Tabs — colunas desktop/mobile** (tabela "Verificações reais", linha `.nav`) —
>   **CORRIGIDO.** A contagem de colunas descrita (`repeat(8/9/6,1fr)` desktop) e a diferença
>   mobile (4/8 colunas na Copa vs. 3 em BR2026/CDB2026) foram unificadas — ver
>   `docs/bolao/CONSISTENCY_MATRIX.md`, nota "branch `fase2.2-correcao-final`".
> - **`main` padding / `.form-grid`** (linha "`main` max-width/padding", tratada como "decisão
>   registrada, não pendência") — **item 8 foi autorizado e aplicado** nesta branch: BR2026/
>   CDB2026 agora usam `20px 18px` (igual à Copa) e o mesmo `.form-grid` de 2 colunas fixas com
>   colapso em `@media (max-width:900px)`. Achado extra na verificação: sem o colapso, o
>   formulário rendia 3 colunas espremidas a 768px em BR2026/CDB2026 (a Copa já colapsava pra 1
>   coluna nessa largura) — corrigido junto.
> - **Item 5 das Pendências (validação visual real via Playwright)** — o ambiente desta rodada
>   TEM Node/Playwright disponíveis (via `nvm` + Chromium em cache local), diferente da sessão
>   que escreveu este relatório (que não tinha `node`/`npx`). O harness
>   (`bolao/cdb2026/scripts/visual/capture_evidence.mjs`, `bolao/scripts/
>   audit_visual_consistency.mjs`, `bolao/scripts/make_visual_comparison_montages.mjs`) foi
>   rodado de verdade nesta branch — screenshots, `getComputedStyle` e montagens lado a lado
>   existem agora em `docs/bolao/evidence/visual/` e `docs/bolao/evidence/visual-comparison/`.
>
> Itens que continuam genuinamente abertos (não tocados nesta branch): H-2 (estrutura de cards
> de Regras, decisão editorial pendente), H-4 (`.rules-table` sem wrapper de overflow), H-6
> (recibo/comprovante ausente em BR2026/CDB2026). Detalhe completo:
> `docs/bolao/FASE2.2_CORRECAO_FINAL_REPORT.md`. O texto abaixo foi mantido como registro
> histórico do estado em 2026-08-02, não reescrito.

Relatório final da auditoria visual e de UX completa entre os três aplicativos bolão
(`bolao/copa2026/`, `bolao/br2026/`, `bolao/cdb2026/`), executada conforme a especificação
completa da tarefa "FASE 2.2 — AUDITORIA VISUAL, PADRONIZAÇÃO DE UX E CONSISTÊNCIA ENTRE OS
BOLÕES". Ver `docs/bolao/VISUAL_PARITY_MATRIX.md` para a matriz componente-a-componente, e
`docs/bolao/DESIGN_SYSTEM.md`/`docs/bolao/PLATFORM_DESIGN_SYSTEM.md` para o inventário completo
de tokens/componentes canônicos (estendido por rodadas anteriores, não recriado aqui).

## Constatação central desta rodada

Antes de propor qualquer mudança, esta sessão leu `PROJECT_MEMORY.md`,
`PLATFORM_GOVERNANCE.md`, `CONSISTENCY_MATRIX.md` (1973 linhas), `QA_MASTER_CHECKLIST.md`,
`DESIGN_SYSTEM.md` (723 linhas) e `PLATFORM_DESIGN_SYSTEM.md` (206 linhas), e os três
CHANGELOG.md. Essa leitura mostrou que **a maior parte do trabalho pedido nesta tarefa já foi
executada em rodadas anteriores**, entre 2026-07-12 e hoje (2026-08-02, commit `ef7f2c4`
"CDB2026: bring Jogos tab to parity with Copa/BR2026", feito momentos antes desta sessão
começar). A plataforma já passou por no mínimo 6 rodadas de auditoria/padronização visual
documentadas (`DESIGN_SYSTEM.md` linhas 492–724), cada uma corrigindo achados reais: badge de
status convergido, estrutura de ranking unificada, toast portado para os 3 apps, tokens de cor
alinhados, ícone Zelle quebrado corrigido, folga de padding removida, campo "próximo jogo" e
countdown unificados, esquema de cor do CDB2026 corrigido de dourado para verde, e — hoje mesmo,
antes desta sessão — a aba "Jogos" do CDB2026 trazida a paridade total com Copa/BR2026 (chips de
status, placar ao vivo, auto-scroll).

O trabalho desta sessão, portanto, foi: (1) verificar por leitura direta de código que os
achados documentados anteriormente continuam válidos hoje (vários já estavam citados como
possivelmente desatualizados pelo aviso no topo de `CONSISTENCY_MATRIX.md`); (2) produzir os
dois artefatos que o usuário pediu explicitamente e que ainda não existiam
(`VISUAL_PARITY_MATRIX.md`, este relatório); (3) buscar ativamente qualquer divergência **nova**
ou **P1** ainda não capturada; (4) confirmar que scoring/regras de negócio permanecem intocados.

**Nenhuma divergência P1 nova foi encontrada.** Nenhuma alteração de código (CSS/JS/HTML) foi
necessária nesta rodada — os pontos que a documentação anterior listava como "não resolvido"
(ex.: folga de padding do `main`, token `--red`) já haviam sido corrigidos por sessões
subsequentes não totalmente refletidas no texto histórico do `DESIGN_SYSTEM.md` (confirmado
lendo o CSS atual, não pela prosa do documento).

## Baseline (estado de cada bolão nesta data)

| App | Versão | Status |
|---|---|---|
| Copa do Mundo 2026 | `v4.163` | Encerrada/arquivada, referência visual canônica |
| Brasileirão 2026 | `v1.81` | Em produção |
| Copa do Brasil 2026 | `v3.74` | Em produção (Jogos trazida a paridade hoje, momentos antes desta sessão) |

## Verificações reais feitas nesta sessão (por leitura de código, não Playwright)

| Item | Copa | BR2026 | CDB2026 | Conclusão |
|---|---|---|---|---|
| `siteVersion` | v4.163 | v1.81 | v3.74 | — |
| Token `--red` | `#ff6b6b` | `#ff6b6b` | `#ff6b6b` | Unificado (confirma resolução de 2026-07-14) |
| `main` max-width / padding | `1140px` / `20px 18px` | `1140px` / `16px 14px` | `1140px` / `16px 14px` | max-width idêntico; diferença de 4px de padding é decisão registrada (2026-07-16), não pendência |
| `.nav` (tabs) — colunas desktop | `repeat(8,1fr)` | `repeat(9,1fr)` | `repeat(6,1fr)` | Proporcional ao nº real de abas — correto |
| `.nav button` CSS (padding/font/min-height/estados) | referência | idêntico | idêntico | Consistente |
| `.rules-table` | presente, sem wrapper de overflow | presente, sem wrapper de overflow | presente, sem wrapper de overflow | Mesmo nível de risco nos três — não é divergência entre apps |
| Toast (`showToast`/`.bolao-toast`) | 34 chamadas no JS | 10 chamadas no JS | 21 chamadas no JS | Presente e funcional nos três |
| Sticky-submit (sombra/min-width) | `rgba(47,229,110,.35)` / `200px` | idêntico | idêntico | Unificado |
| Admin login (markup) | `#adminLogin`/`#adminPassword`/`#adminLoginBtn` | idêntico | idêntico | Consistente |
| `aria-current`/`aria-selected` nas tabs | ausente | ausente | ausente | Gap real de acessibilidade, compartilhado igualmente pelos 3 — não corrigido nesta rodada (ver Pendências) |
| `node`/`npx` disponíveis nesta máquina | não | não | não | Confirmado por `which` e `find / -maxdepth 4 -iname node` — harness Playwright (`bolao/cdb2026/scripts/visual/*.mjs`) não pôde ser executado |

## Inconsistências encontradas nesta rodada

Nenhuma inconsistência **nova** foi encontrada (nenhum ID novo). A tabela abaixo relaciona os
itens que a documentação histórica ainda listava como potencialmente abertos e o que esta
sessão confirmou sobre cada um:

| ID | Componente | Aplicação | Diferença | Severidade | Situação confirmada nesta sessão |
|---|---|---|---|---|---|
| H-1 | `main` padding-bottom | BR2026/CDB2026 | `DESIGN_SYSTEM.md` (2026-07-14) registrava incerteza sobre 80px de folga | P3 | **Já resolvido** em 2026-07-16 (comentário no CSS confirma: folga removida a pedido do Eduardo) — pendência falsa, doc desatualizado |
| H-2 | Estrutura de cards da página Regras | Copa (2)/BR2026 (1)/CDB2026 (7) | Padrão de agrupamento diverge | P3 | Ainda aberto — requer decisão editorial do Eduardo, não é um bug de componente (ver `DESIGN_SYSTEM.md` linha 601) |
| H-3 | `aria-current`/`aria-selected` em tabs | Copa/BR2026/CDB2026 | Nenhum dos três marca a aba ativa semanticamente para leitor de tela | P2 | Ainda aberto — ver Pendências |
| H-4 | `.rules-table` sem wrapper `overflow-x:auto` estrutural | Copa/BR2026/CDB2026 | Não quebra hoje (conteúdo curto) mas não é garantia | P3 | Ainda aberto, risco baixo, sem alteração hoje |
| H-5 | Admin toolbar — densidade (13 vs 2 vs 4 botões) | Copa/BR2026/CDB2026 | Diferença grande de nº de ações | Medium (feature) | Confirmado: CSS do botão idêntico nos três, a diferença é de **feature**, não de componente visual — fora do escopo de padronização visual pura, já catalogado em `CONSISTENCY_MATRIX.md` item 6/10 |
| H-6 | Recibo/comprovante | Ausente em BR2026/CDB2026 | Feature inteira ausente | P2 (feature) | Confirmado ausente — fora do escopo desta fase (visual/estrutural), requer autorização para nova feature, não uma correção de padronização |

## Diferenças legítimas (por competição) — confirmadas, não alteradas

- **Hero**: Copa tem card de placar ao vivo dentro do hero; BR2026 tem 2 cards irmãos; CDB2026
  não tem card ao vivo (sem API externa). `INTENTIONALLY_DIFFERENT`.
- **Card de jogo**: Copa/BR2026 usam card de partida única; CDB2026 agrega ida+volta num único
  card com linha de agregado/"quem avança" — estrutura de mata-mata de duas pernas sem
  equivalente na Copa. `TOURNAMENT_SPECIFIC`.
- **Tabela de standings**: só existe no BR2026 (Série A ao vivo) — sem equivalente na Copa
  (mata-mata) nem no CDB2026 (sem fonte de dados única para 126 clubes).
- **Fórmula de scoring, bracket, tiebreak**: cada app mantém a sua (não tocado nesta fase, por
  regra explícita do `CLAUDE.md` e por não fazer parte do escopo visual).
- **Nº de colunas do nav em mobile** (4 na Copa vs 3 em BR2026/CDB2026): proporcional ao número
  real de abas de cada app, sinalizado ao Eduardo em 2026-07-14 e mantido deliberadamente.

## Alterações realizadas nesta sessão (arquivo por arquivo)

Nenhuma alteração de código foi necessária — nenhuma divergência P1 ou P2 de baixo risco foi
encontrada que não estivesse já resolvida. Arquivos criados/atualizados:

- `docs/bolao/VISUAL_PARITY_MATRIX.md` — novo, matriz completa componente-a-componente pedida
  pela tarefa (§4 da especificação original).
- `docs/bolao/VISUAL_STANDARDIZATION_REPORT.md` — este documento (§19 da especificação
  original).
- `docs/bolao/DESIGN_SYSTEM.md` / `docs/bolao/PLATFORM_DESIGN_SYSTEM.md` — não alterados: a
  auditoria desta sessão não encontrou nenhum padrão real do código canônico (Copa) que não
  estivesse já documentado neles. Re-verificados, não re-escritos.
- `docs/bolao/CONSISTENCY_MATRIX.md` — não alterado: nenhum achado desta sessão resolve, cria
  ou muda uma divergência já rastreada lá (a única correção seria de natureza "o doc histórico
  do DESIGN_SYSTEM.md está desatualizado no item H-1", o que já está anotado no aviso de topo
  do próprio `CONSISTENCY_MATRIX.md` como comportamento esperado — "confirme contra o código
  atual antes de usar qualquer linha como lista de trabalho").
- `docs/bolao/CDB2026_REQUIREMENTS_TRACEABILITY_MATRIX.md` — não tocado: nenhum achado desta
  sessão envolve rastreabilidade de requisito específico do CDB2026.
- Nenhum `siteVersion` foi incrementado em nenhum dos três `js/config.js` — nenhum código foi
  modificado.
- Nenhum CHANGELOG de app foi alterado — nenhuma mudança de comportamento/visual para
  registrar.

## Evidências

- **Leitura de código real**: confirmada nesta sessão para todos os itens da tabela de
  "Verificações reais feitas" acima — comandos `grep`/`sed` diretos contra
  `bolao/{copa2026,br2026,cdb2026}/css/styles.css`, `js/config.js`, `js/app.js`, `index.html`.
- **Evidência visual (screenshots) pré-existente**: `docs/bolao/evidence/visual/manifest.json`
  e os PNGs em `docs/bolao/evidence/visual/{copa2026,br2026,cdb2026}/`, capturados via
  Playwright em 2026-08-01, cobrindo Palpites/Ranking/Jogos/Regras/Admin em 7 viewports. A
  captura do CDB2026 é anterior ao commit `ef7f2c4` (Jogos tab parity, 2026-08-02) — portanto
  **estava desatualizada para a seção Jogos do CDB2026** — corrigido pela recaptura abaixo.

### Atualização — verificação Playwright real (sessão de acompanhamento, mesmo dia)

O ambiente não tinha `node`/`npx` (confirmado por `which` e `find`). Instalado via `nvm`
(`~/.nvm`, sem sudo, sem tocar configuração de sistema) e Playwright + Chromium via `npm install`
**fora do repositório**, em `/private/tmp/.../scratchpad/pw` — o repo não ganhou `package.json`
nem `node_modules` (confirmado: `git status` limpo para esses caminhos). O harness existente
(`capture_evidence.mjs`) já previa exatamente esse cenário via as variáveis `PLAYWRIGHT_PATH` e
`PLAYWRIGHT_CHROMIUM_PATH` (comentário no próprio `playwright_loader.mjs`), então nenhuma edição
de script foi necessária — só as env vars apontando para a instalação no scratchpad.

Resultado da execução real (`node bolao/cdb2026/scripts/visual/capture_evidence.mjs`):

- **112 entradas no manifest**: 70 capturadas, 35 `notApplicable` (seção não existe naquele app),
  7 `failed`.
- **`overflow_report.json` e `console_errors.json`: ambos `[]`** — zero overflow horizontal e
  zero erro de console em qualquer viewport/seção capturada.
- As 7 falhas são todas `cdb2026 Pagamento` (todos os 7 viewports): o botão
  `[data-section="payment"]` existe com `style="display:none"` — **idêntico nos três apps**
  (confirmado por grep em `index.html` dos três) — e só fica visível condicionalmente via JS.
  Não é uma divergência entre os apps, é uma limitação do harness (clica antes do botão ficar
  visível) que afeta igualmente qualquer app se o harness tentasse a mesma seção neles.
- **Achado novo, não é bug do app**: a screenshot `cdb2026_games_1440x900.png` mostra o topbar
  sticky duplicado (aparece uma vez no topo e de novo mais abaixo na imagem). Confirmado como
  artefato conhecido de `page.screenshot({ fullPage: true })` do Playwright com elementos
  `position: sticky` em páginas longas (o composite de página inteira re-renderiza o elemento
  fixo em cada segmento capturado) — **não** um bug de renderização real do app. Registrado aqui
  para que ninguém persiga isso como defeito; `cdb2026_ranking_1440x900.png` (mesma sessão,
  mesmo app) confirma o header renderizando uma única vez normalmente.
- Screenshots atualizados e commitados para os três apps (substituindo a evidência de
  2026-08-01); a seção Jogos do CDB2026 agora reflete o estado pós-`ef7f2c4`.
- **Acessibilidade**: nenhuma medição de contraste WCAG foi feita ainda (ferramenta de contraste
  não fazia parte deste harness). A ausência de `aria-current`/`aria-selected` foi confirmada por
  `grep` e **corrigida nesta sessão** (ver abaixo) — `aria-selected` não foi adicionado de
  propósito: os botões de nav são `<button>` simples, não um par `role="tab"`/`role="tablist"`,
  então `aria-current="page"` é o padrão ARIA correto aqui.
- **Regressão de scoring**: `audit_scoring.py` rodado novamente após a mudança de
  `aria-current` — **6/6 (copa2026), 5/5 (br2026), 5/5 (cdb2026)**, sem alteração de resultado
  (a mudança não toca scoring/ranking/entries).

## Pendências (nada foi corrigido silenciosamente — tudo abaixo está genuinamente em aberto)

1. ~~**`aria-current`/`aria-selected` nas tabs de navegação (H-3, P2)**~~ — **RESOLVIDO**
   nesta sessão de acompanhamento: `showSection()` em `app.js` dos três apps agora toggla
   `aria-current="page"` no botão de nav ativo (removido dos demais). Commit local (ver abaixo),
   `audit_scoring.py` 6/6, 5/5, 5/5 após a mudança.
2. **Estrutura de cards da página Regras (H-2, P3)** — Copa (2 cards) / BR2026 (1 card) /
   CDB2026 (7 cards) divergem em padrão de agrupamento. Decisão editorial do Eduardo necessária
   antes de reestruturar — sinalizado desde 2026-07-14, ainda sem resposta registrada.
3. **`.rules-table` sem wrapper `overflow-x:auto` estrutural (H-4, P3)** — risco baixo e
   idêntico nos três apps (não é uma divergência entre eles). Não corrigido nesta rodada.
4. **Recibo/comprovante ausente em BR2026/CDB2026 (H-6)** — gap de feature de longa data,
   fora do escopo de uma fase declarada como "visual/estrutural" (implementar comprovante é uma
   feature nova grande, não uma padronização).
5. ~~**Validação visual real (Playwright, `getComputedStyle`, screenshots multi-viewport)**~~ —
   **PARCIALMENTE RESOLVIDO**: Node instalado via `nvm` e Playwright executado de fato (ver
   seção "Atualização" acima) — 70 screenshots recapturados, `overflow_report.json` e
   `console_errors.json` ambos vazios. `getComputedStyle` estruturado (JSON/Markdown
   classificado IGUAL/EQUIVALENTE/JUSTIFICADA/DIVERGENTE, por componente) ainda **não** foi
   produzido — o harness atual captura screenshots e overflow/console, não um diff de estilo
   computado por componente. Ficou para uma tarefa separada em andamento
   (CORREÇÃO FINAL, branch dedicada).
6. **Admin toolbar — densidade de ações (H-5)** — não é uma pendência de padronização visual
   (o componente é idêntico); é uma lacuna de feature já registrada em
   `CONSISTENCY_MATRIX.md`, mantida fora do escopo desta fase por decisão de categoria
   (`feature gap`, não `visual`).

## Commits desta sessão

Ver mensagens de commit para o hash exato — resumo:
1. `docs(bolao): add VISUAL_PARITY_MATRIX.md and VISUAL_STANDARDIZATION_REPORT.md (FASE 2.2)`
   — os dois documentos acima, sem nenhuma alteração de código (`bolao/copa2026`,
   `bolao/br2026`, `bolao/cdb2026` inalterados).

### Sessão de acompanhamento (mesmo dia, Node instalado)

2. `5dd80aa` — `Add aria-current="page" to active tab nav button (Copa/BR2026/CDB2026)` —
   `app.js` dos três apps (`showSection()`), `js/config.js` (`siteVersion` bump: copa2026
   v4.164, br2026 v1.82, cdb2026 v3.75), e os três `CHANGELOG.md`. `audit_scoring.py` 6/6, 5/5,
   5/5 após a mudança.
3. (próximo commit) — recaptura de `docs/bolao/evidence/visual/` via Playwright real (Node
   instalado via `nvm`, Playwright/Chromium fora do repo) e atualização deste relatório com os
   resultados. Sem alteração de código de app.

Não houve push. Trabalho segue local em `main`, aguardando revisão do Eduardo antes de
qualquer publicação — conforme instrução explícita da tarefa original.
