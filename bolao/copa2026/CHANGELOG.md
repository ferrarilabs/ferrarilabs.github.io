# CHANGELOG

## v4.179 — 2026-08-09 — Barra de probabilidade: espessura uniforme em toda a plataforma

O Eduardo mandou um print do iPhone com barras de altura visivelmente diferente **na mesma tela**.
Medido em Chromium a 390px: 30px, 31px, 44px e 56px — e o mesmo jogo (Bahia×Vasco) renderizava
44px numa seção e 56px em outra.

**Causa raiz:** o limiar que decide manter o nome do time é PERCENTUAL (`pct >= 12`), mas o que
decide se o rótulo CABE é PIXEL. Um segmento de 17% num viewport de 390px tem ~56px — não cabe
"Vasco da Gam… 17%". Com `white-space: normal` no mobile, o rótulo quebrava em três linhas e
esticava a linha inteira, porque `.prob-bars` estava em `height: auto`. Como a largura vem da
probabilidade, cada partida esticava um tanto diferente. A espessura desigual era **sintoma de um
limiar medido na unidade errada**, não um problema de altura.

**Correção:** nome e porcentagem viraram elementos separados (`.prob-bar__name` / `.prob-bar__pct`).
A porcentagem tem `flex: none` e nunca encolhe nem quebra; o nome tem `min-width: 0` e encolhe com
reticências até sumir. Com isso o rótulo não pode mais crescer em altura, e a altura voltou a ser
FIXA no mobile — resolvendo o dilema que a quebra de linha da Fase 7 tentava resolver, sem
reintroduzir o corte de texto que a motivou.

Nada de scoring, regra de torneio ou probabilidade foi tocado — só a montagem do rótulo e o CSS.

**Gate permanente:** `bolao/scripts/audit_prob_bar_geometry.mjs` mede os 3 apps em 3 viewports e
trava DUAS propriedades ao mesmo tempo — toda barra com a mesma altura E a porcentagem nunca
cortada. Travar só a altura deixaria passar a "correção" preguiçosa de esconder o rótulo de todo
mundo, que também igualaria as alturas e seria uma piora.

## v4.178 — 2026-08-08 — `<th scope="col">` em todas as tabelas renderizadas

Cabeçalho de tabela sem `scope` deixa o leitor de tela sem a associação entre célula e cabeçalho:
numa tabela de ranking ou classificação, a pessoa ouve os números sem saber de que coluna são.

Encontrado pela suíte de acessibilidade dos quatro apps — e vale registrar COMO: a tabela do
ranking ao vivo do BR2026 só existe no DOM quando há jogo ao vivo, e não havia jogo ao vivo em
lugar nenhum porque o snapshot da ESPN estava congelado. Assim que o snapshot voltou a ser
publicado, a tabela apareceu e o defeito com ela. Um bug estava escondendo o outro.

Todas as tabelas destes apps têm cabeçalho só na primeira linha (nenhuma tem cabeçalho de linha),
então `scope="col"` é o valor correto em todas.

## v4.177 — 2026-08-08 — Invariantes de estado: nenhum campo de topo se perde no merge

**Classe de defeito com histórico, não precaução teórica.** O mesmo erro apareceu QUATRO vezes no
CDB2026: o objeto devolvido por `mergeStates()` era montado ENUMERANDO campos, então um campo novo,
ausente da lista, era descartado em silêncio a cada merge — flags de `espnSync` (AUDIT-01),
`cutoffOffsetMs`, e `officialDraw` duas vezes. Nada falhava; o dado evaporava.

Copa2026 e BR2026 nunca tinham sido auditados para isso e tinham exatamente a mesma forma de código.
A base do retorno passa a ser um SPREAD das duas entradas. Todos os campos conhecidos continuam
resolvidos explicitamente e sobrescrevem o spread, então o comportamento de tudo que existe hoje é
IDÊNTICO — o spread só decide o destino de campo que ninguém enumerou.

`bolao/scripts/audit_state_invariants.mjs` (18 checagens, nos três apps) prova a PROPRIEDADE, não a
lista: inventa um campo de topo que o código não conhece e exige que ele sobreviva. Também executa a
matriz de autoridade que antes só existia como comentário — `paid` any-true-wins, `deletedIds` união
(exclusão nunca ressuscita), `cutoffAt` sempre o mais tarde, `officialDraw`/`topology`/
`cutoffOffsetMs` por fase, flags "roda uma vez" por OR — e tem um teste de contrato que falha se
algum `mergeStates()` voltar a enumerar campos à mão.

## v4.176 — 2026-08-07 — Centavos só quando existem de verdade

Eduardo: "os centavos continuam aparecendo, só deve aparecer no prêmio final".

`usd()` passa a omitir `.00` em valor inteiro e manter 2 casas só quando há centavo quebrado:

    $0 · $5 · $60 · $115 · $1,250        (inteiros, sem centavos)
    $80.50 · $11.50 · $1,250.50          (centavos reais preservados)

O prêmio final é exatamente o valor que cai em centavo quebrado (70% do pote), então "sumir com o
`.00`" atende o pedido sem inventar um formatador por contexto — que teria voltado a espalhar regra de
formatação pelo código, o problema que o Batch 5 resolveu.

É também o comportamento que a Copa tinha originalmente (`toFixed(2).replace(/\.00$/, "")`), agora
promovido a regra canônica dos três runtimes e coberto pelo teste de interop.

## v4.175 — 2026-08-07 — Símbolo dos valores volta a `$` (decisão revisada)

Eduardo, depois de ver o `US$ ` em produção: "agora mostra US$ ao invés de $ em todos os sites".
Decisão revisada — os **valores formatados** voltam a `$`: `$5.00`, `$1,250.00`, `$856M`.

Toda a infraestrutura do Batch 5 continua valendo: um formatador canônico por runtime, paridade
navegador/Node/Python garantida pelo teste de interop, e arredondamento half-up explícito. Só o
prefixo mudou — em UM lugar por runtime, que era exatamente o objetivo de centralizar.

**Divergência DELIBERADA, registrada a pedido dele:** a prose do i18n ("Valor: US$ 5 por entrada",
presente desde 2026-07-11) continua com `US$` e **sem centavos** — escolha explícita do Eduardo
("prose sem centavos, valores com"). Então numa mesma tela a frase diz `US$ 5` e o valor calculado
diz `$60.00`. Isto é intencional; não "unificar" por conta própria numa próxima passada.

Também revertida a linha de taxa de entrada do CDB2026 para prose (`Entrada: US$ 5.`) em vez da saída
do formatador — ela é frase, não valor calculado.

E corrigida uma inconsistência de espaçamento que existia antes de tudo isto: o Powerball mostrava
`US$10 cada` (sem espaço) contra `US$ 5 por entrada` dos três bolões. Agora `US$ 10 cada`.

Verificado em browser nos quatro apps: valores `$0.00`/`$856M`/`$140.00`, prose `US$ 5`/`US$ 10`,
nenhum `US$` sem espaço restante.

## v4.174 — 2026-08-07 — BATCH 5: formato USD canônico `US$ X.XX`

Decisão de produto do Eduardo: o formato humano canônico é **`US$ X.XX`** (`US$ 5.00`,
`US$ 1,250.00`), e a UI não pode usar um formato enquanto o email do participante usa outro.

A plataforma tinha **quatro** formatos em produção para o mesmo tipo de valor: `US$5` (UI do
Powerball), `$1,250.00` (email do Powerball), `$5` (Copa, com `.00` removido — e a mesma lambda
**triplicada** no arquivo) e `$65`/`$0` (potes do CDB2026/BR2026/Copa, interpolação direta).

Formatador canônico novo, uma implementação por runtime porque não há build step neste repo:
`bolao/shared/js/money.js` (navegador), `bolao/shared/scripts/money.mjs` (Node/email),
`bolao/shared/scripts/money.py` (Python/email). As três são comparadas por
`bolao/shared/scripts/test_money_interop.mjs` contra a mesma tabela de valores — divergir faz a
suíte falhar.

**Duas divergências reais de arredondamento foram encontradas pelo próprio teste de interop:**
`5.005` dava `US$ 5.01` no JS (`Intl`) e `US$ 5.00` no Python (half-even); `1250` compacto dava
`US$ 1.3K` no JS e `US$ 1.2K` no Python. Nenhum default de linguagem é "o certo" para dinheiro — o
que importa é a plataforma concordar. O arredondamento para centavos agora é **explícito e half-up**
nos três runtimes (`Math.round` no positivo; `math.floor(x + 0.5)` no Python).

Escopo deliberado: **só dinheiro**. Nenhum `toLocaleString` de DATA foi tocado.

## v4.173 — 2026-08-07 — Migração para o snapshot ESPN server-side (fim da dependência de CORS)

O navegador não chama mais `site.api.espn.com`. Passa a ler o snapshot NORMALIZADO gerado
server-side por `bolao/shared/scripts/espn_provider.py` e versionado em `data/espn-normalized.json`
— mesma origem da página, então CORS deixa de existir como classe de problema.

Motivo (nada hipotético): a produção registrava `Access to fetch ... has been blocked` em toda
carga de página, e a ESPN já nos bloqueou duas vezes — 403 por user-agent e, depois, TLS nos
runners do GitHub (`SSL: TLSV1_ALERT_INTERNAL_ERROR`).

- `fetchEspnFixtures()` lê o snapshot e um ADAPTADOR (`snapshotEventsToEspnShape()`) reconstrói a
  forma crua da ESPN que todo o código a jusante já esperava (`ev.competitions[0].competitors[]`).
  Trocar a FONTE sem tocar em `mapEspnToMatches`, `extractMatchPlays`, `pollLiveScores` nem em
  qualquer coisa de scoring/ranking — diff cirúrgico de propósito.
- Falha segura idêntica à anterior: qualquer erro devolve `null`, que já significava "sem dados
  neste ciclo" para todos os chamadores. Nenhum resultado é inventado. `stale: true` NÃO é tratado
  como erro (dado velho conhecido é melhor que nenhum) e só emite aviso no console.
- `fetchEspnWinProbability`, `fetchEspnMatchStats` e `fetchEspnEventSummary` viraram **no-ops
  documentadas**. Eram alcançáveis só por `pollLiveScores()` em partida AO VIVO; a Copa terminou em
  2026-07-19 e o app está arquivado, então nenhum caminho pode dispará-las — e mantê-las faria o
  navegador chamar a ESPN direto, exatamente a dependência que esta migração remove. Não deletadas
  porque os chamadores sempre souberam lidar com `null`; deletar ampliaria o diff sem ganho.
- `index.html`: `site.api.espn.com` e `sports.core.api.espn.com` **removidos** do `connect-src` do
  CSP. Não sobrou nenhuma chamada de browser para a ESPN, então a permissão deixou de ser
  necessária — e agora o CSP passa a ser uma barreira real contra reintrodução acidental.

Verificado em browser real: **0** requisições diretas à ESPN, snapshot carregado (104 partidas,
`stale: false`), **104 game cards renderizados** com dados reais, nenhum erro de console, nenhum
4xx/5xx. `audit_scoring.py` da Copa segue passando — scoring e resultados armazenados intocados.

## v4.172 — 2026-08-07 — HOTFIX: origem de produção errada no guard de test isolation

O guard de test isolation entregue na versão anterior usava
`PRODUCTION_ORIGIN = "https://ferrarilabs.github.io"`. **Essa não é a origem de produção.** O
`CNAME` na raiz do repo aponta para `www.ferrarilabs.com`, e o github.io (e o apex) respondem
**301** para lá. Ou seja: nenhuma página de produção executa em `ferrarilabs.github.io`, e o guard
estava bloqueando **toda** gravação remota de **todos** os participantes reais, nos três apps.

Pior: em silêncio. O guard devolve `skipped` em vez de rejeitar, então `saveState()` não caía no
`.catch()` e nem o toast de `syncFailed` aparecia — o participante via "salvo" com o dado só no
navegador dele. Exatamente a classe de falha que a AUDIT-04 já tinha corrigido neste arquivo.

Detectado na **verificação ao vivo** pós-deploy (o `curl` na produção mostrou o 301 para
`www.ferrarilabs.com`), não pela suíte — a suíte comparava o guard com um literal transcrito, então
concordava com o erro. Janela de exposição: entre o deploy da versão anterior e este.

- `js/app.js`: `PRODUCTION_ORIGIN` (string) → `PRODUCTION_ORIGINS` (allowlist) contendo
  `www.ferrarilabs.com` (canônico, do CNAME), o apex e o github.io. Os dois últimos só
  redirecionam hoje, mas se o CNAME for removido a produção passa a servir do github.io e o guard
  não pode virar bloqueio total. Match por igualdade dentro da lista — nunca substring.
- `bolao/scripts/audit_test_isolation.mjs`: passa a **ler o `CNAME`** e falhar se o domínio real
  não estiver na allowlist. É o check que faltava; verificado por controle negativo — restaurar o
  valor errado faz a suíte falhar em 3 checks nos três apps. 36 checks.

Lição registrada: um guard de segurança que decide sobre a identidade do ambiente tem de derivar
essa identidade de uma fonte de verdade versionada (aqui, o `CNAME`), nunca de um literal — e
nenhuma verificação de deploy pode ser considerada completa sem checagem ao vivo.

## v4.171 — 2026-08-07 — TEST ISOLATION (P0): gravação remota fail closed fora da produção

Propagação da correção P0 aberta pelo incidente de produção do CDB2026 (ver
`docs/bolao/TEST_ISOLATION.md`). O incidente foi no CDB2026, mas a causa raiz é idêntica nos três
apps: `url`/`anonKey`/`stateId` de produção são hardcoded em `js/config.js`, então qualquer harness
que carregue a aplicação grava na tabela real. Não havia flag de teste — porque não existia nenhuma.

Regra: gravação remota é NEGADA por padrão quando `location.origin` não é
`https://ferrarilabs.github.io` OU `navigator.webdriver` é verdadeiro (Playwright/Puppeteer/
Selenium). Participantes reais nunca satisfazem nenhuma das duas.

- `js/app.js`: guard `productionWritesAllowed()` dentro de `saveRemoteState()`, **antes** de
  qualquer chamada remota — o único ponto por onde toda escrita remota passa. Não em cada
  chamador: um guard que depende do teste lembrar de chamá-lo é convenção, não fronteira, e foi
  uma convenção que falhou no incidente. A escrita local (`localStorage`) segue normal — nada é
  perdido, só não vaza.
- Escape hatch deliberado, para administrar produção de um preview local:
  `sessionStorage.setItem("copa2026_allow_production_writes", "I UNDERSTAND")` — precisa ser digitado, valor exato,
  namespaced por app, morre ao fechar a aba, e avisa no console a cada gravação. `sessionStorage`
  lançando é tratado como override ausente (fail closed, nunca fail open).

Limitação registrada de propósito: é controle de camada de aplicação, não fronteira de banco. NÃO
impede um POST direto na REST API com a anon key (que é pública por construção). Enforcement real
via RLS por role/origem fica para a modernização do banco — segue como o risco de produção aberto
de maior severidade.

Testes: `bolao/scripts/audit_test_isolation.mjs`, 33 checks nos três apps (produção permitida;
localhost/127.0.0.1/`file://`/webdriver negados; override correto libera; override com valor errado
não libera; `sessionStorage` lançando não libera; chave namespaced; origem não casa por substring).
O check de chokepoint foi verificado com controle negativo — neutralizar o guard faz a suíte
falhar. Scoring intocado; `audit_scoring.py` dos três apps segue passando.

## v4.170 — 2026-08-04 — Phase 7 of platform visual-framework migration: real visual validation, `.prob-bar` legibility fix

Phase 6 shipped without a real browser. Phase 7 installed Playwright + a real Chrome binary and
re-verified everything with actual captures/computed styles instead of source-only comparison —
see `docs/bolao/evidence/canonical-framework/README.md` and `docs/bolao/CONSISTENCY_MATRIX.md`'s
phase 7 entry.

**Real bug found in Copa's own canonical `.prob-bar` value, fixed here**: `min-width: 6px` (this
app's own value, inherited by BR2026/CDB2026 through `bolao/shared/css/components.css`) was
empirically measured (real Chrome, Playwright) to genuinely clip the percentage label this app's
own `label(pct,name)` helper (`js/app.js:2656`) renders inside every probability-bar segment — a
3% segment at 390px rendered with `scrollWidth(22px) > clientWidth(19px)`, i.e. the "3%" text
didn't fully fit. `min-width: 32px` (the value BR2026/CDB2026 already carried as an undocumented
local override) renders the same segment with no clipping. Promoted 32px to the shared canonical
value — this was Copa's own value that needed to change, not something BR2026/CDB2026 were wrong
about.

Computed-style audit (`bolao/scripts/audit_visual_consistency.mjs`, real Chromium, 30
components): 0 unapproved divergences, 383 EQUAL, 23 JUSTIFIED (documented variants), 14 N/A. 0
console errors, 0 horizontal overflow, 0 sticky-submit overlap — all confirmed live at
390×844/768×1024/1440×900 (and 7 viewports for the overlap check).

## (tooling, no siteVersion bump) — 2026-08-04 — Phase 6 of platform visual-framework migration: evidence + wrap-up

Final phase of the 6-phase migration (phase 1: component catalog; phase 2: shared tokens/shell +
Copa migration; phase 3: BR2026 migration; phase 4: CDB2026 migration; phase 5: admin
standardization + contract script). No CSS/JS changes to this app in this phase — this entry
documents the wrap-up: full `docs/bolao/evidence/canonical-framework/COMPONENT_AUDIT.md`
classification of all 28 canonical components across the three apps (mix of EQUAL/
VARIANT_APPROVED/DIVERGENT, with a real previously-undocumented `.prob-bar` min-width
divergence surfaced), an honest `README.md` in that same folder documenting that no
browser/screenshot tool was available this session (verified by checking, not assumed) so no
rendered-pixel evidence was fabricated, and a final full re-run of every test/audit script
across all three apps — all pass. See `docs/bolao/CONSISTENCY_MATRIX.md` for the consolidated
list of documented cross-app divergences from phases 2-5.

## v4.169 — 2026-08-04 — Phase 2 of platform visual-framework migration: shared CSS tokens/shell

Copa is the platform's canonical visual reference (`CLAUDE.md`, "Golden master rule"). Phase 1
(previous commit) catalogued Copa's real CSS values into
`docs/bolao/CANONICAL_VISUAL_COMPONENT_CATALOG.md`; this phase extracts those values into a new
shared stylesheet set and migrates Copa itself to consume it, so BR2026/CDB2026 (phases 3-4) have
a real shared contract to copy instead of hand-copying values file by file.

- Added `bolao/shared/css/{tokens,reset,shell,navigation,components,forms,admin,responsive}.css`
  — every value copied verbatim from Copa's own `css/styles.css` (no invented values). Covers the
  28 components catalogued as actually existing in Copa in phase 1 (topbar, brand, nav/tabs, card,
  game-card, score, status-badge, probability-bar, ranking-row/position/score, rules-table,
  form-grid, input/select, buttons, admin-toolbar, toast, etc.).
- `index.html` now loads the 8 shared stylesheets before `css/styles.css`, so Copa's own file only
  needs to carry Copa-specific rules/overrides (hero, bracket, count-grid, receipt box, podium
  banner, match-end banner, reopen banner, America250 badge, audit log, demo badge, site footer,
  etc.) and Copa-specific responsive tweaks.
- Trimmed `css/styles.css` from 1302 to 733 lines by removing rules that are now fully duplicated
  in the shared files, replacing each removed block with a short pointer comment to where it lives
  now (no rule was deleted without a shared-file equivalent already in place).
- Not touched: any `.js` file, scoring, business rules, Supabase, EmailJS, Powerball/other
  lottery modules. `python3 scripts/audit_scoring.py` re-run after this change, still passes (see
  repo `CLAUDE.md` — required after every change, scoring-related or not).
- Known follow-up for phase 5 (not done here): `shared/css/responsive.css`'s desktop nav rule
  hardcodes `repeat(6, minmax(0,1fr))`, which is Copa's real visible-tab count — BR2026 (7 tabs)
  and CDB2026 (6 tabs) will need their own override when they migrate in phases 3-4, same as they
  already do today for the mobile 3-column rule.

## (tooling, no siteVersion bump) — 2026-08-04 — EMERGENCY_HOTFIX propagation: live-monitoring deadline anchor

Propagated from `bolao/cdb2026/scripts/send_result_email.py` (same incident, same architecture —
"EXATAMENTE igual Copa do Mundo" per Eduardo, 2026-08-01). `any_copa_match_live()`'s live-match
monitoring deadline was `time.time() + 80*60` (measured from whenever the workflow run happened
to start, not from the match's real kickoff) — CDB2026 hit this for real on 2026-08-04
(Athletico-PR × Vitória: a cron tick landing 11m42s after kickoff, ordinary `*/10` granularity,
ate enough of the fixed 80-minute window that it closed ~4 minutes before the match's real
finish). Fixed the same way here: `any_copa_match_live()` now returns the earliest live match's
kickoff ISO string (was a bare boolean) so `run_auto()` can anchor its deadline to kickoff + 130
min instead of run-start + 80 min. **Dormant in this app** — the World Cup concluded 2026-07-19
and `CONFIG.archived` is `true`; no live match can ever occur again — kept in sync purely so this
script doesn't silently drift from CDB2026's copy again (same class of drift CLAUDE.md's own
"never assume a change is unrelated" scoring-audit rule exists to catch). No app file touched
(`css/styles.css`, `js/config.js`, `js/data.js`, `js/i18n.js`, `js/app.js` unchanged) — script
only, no `siteVersion` bump/cache-bust needed.

`audit_scoring.py`: passed (scoring untouched — timing/deadline only).

## v4.168 — 2026-08 — PR120-final review item 7: audit_visual_consistency.mjs reaches exit 0

Full rationale/findings documented once in `bolao/cdb2026/CHANGELOG.md` v3.85 (same change,
touches all three apps equally). Summary: fixed a real selector-ambiguity bug (CDB2026 has two
`.form-grid` elements; the generic selector picked the wrong, hidden one) via a new
`data-visual-audit="form-grid"` marker on the real entry-form grid in all three apps (purely
additive attribute, no CSS/behavior change) — same technique item 3 already used for
`.card`/`h3`/buttons. The remaining 7 DIVERGENT findings (form-grid height, button-small/danger
height, game-card gap/height, status-badge gap/minHeight) were investigated with a Playwright
probe, confirmed content/structure-driven rather than token bugs, and documented in
`docs/bolao/evidence/visual-comparison/ALLOWLIST.json` with verifiable justifications.
`audit_visual_consistency.mjs` now exits 0 (365 EQUAL, 13 JUSTIFIED, 0 DIVERGENT). No
scoring/bracket/tiebreak logic touched. Also retroactively covers the prior (unversioned)
commit's item 3/4 work — `data-visual-audit="card-base"/"rules-heading"/"button-primary"/
"button-small"/"button-danger"` markers and `.form-grid` margin / `.rules-table` font-size /
`.game-card` padding+border-radius+margin-bottom alignment to Copa — which should have bumped
`siteVersion` and didn't; noted here rather than rewriting that commit's history.

## v4.167 — 2026-08 — PR120-final review item 2: unify cache-bust (content-hash, not commit-SHA)

Same platform-shared fix documented in full in `bolao/cdb2026/CHANGELOG.md` v3.84 (new
`bolao/scripts/cachebust.mjs` is the single source of truth for the `?v=` tag; the workflow
`.github/workflows/sync_version.yml` and the local checker now compute/apply the exact same
content hash instead of two incompatible values). This app's `index.html` was rewritten to
`?v=9bf6932b24fb` (matches the current content hash of its own five critical files) as part of
that same commit — Copa's own bump, not shared with the other two apps' hashes (each app's tag is
independently computed from its own files). No scoring/bracket/tiebreak logic touched.

## v4.166 — 2026-08 — Fase 2.2-correção item 7/coord.#2: cross-app computed-style consistency audit

New `bolao/scripts/audit_visual_consistency.mjs` (top-level, cross-app — not under any single
app's own `scripts/`). Full rationale, methodology, and findings in
`bolao/cdb2026/CHANGELOG.md` v3.80 (this is the same change, documented once in detail since it
touches all three apps equally). Summary: 339/364 property comparisons EQUAL across
Copa/BR2026/CDB2026, 24 flagged DIVERGENT (documented, not auto-fixed — findings presented first
per audit-first workflow), including independent confirmation of the already-known `main`
padding and `.form-grid` divergences (item 8, still awaiting explicit authorization before any
fix), plus new findings (`h3` and `.rules-table td` diverge in CDB2026 specifically). Report:
`docs/bolao/evidence/visual-comparison/audit_visual_consistency.{json,md}`. `audit_scoring.py`:
6/6 (unaffected).

## v4.165 — 2026-08 — Fase 2.2-correção item 3: tab nav standardized across all three apps (desktop column count, mobile 3-col pattern)

Verified against the ACTUAL current CSS/HTML (not the possibly-stale numbers in the original
task prompt) that Copa's desktop `.nav` grid still had `repeat(8, ...)` columns while only 6
buttons are ever visible (Participantes/Pagamento are permanently `display:none`) — 2 dead
columns stretching the row. Fixed to `repeat(6, ...)`, matching the real visible count, in both
the base rule and the `min-width:901px` override (both were stale).

Mobile nav standardized to **3 columns** across Copa/BR2026/CDB2026 (was 4 for Copa only,
3 for the other two already). Not picked "because 2 of 3 already do it" — verified it's a real
improvement for Copa's own layout too: 6 buttons / 4 columns was 4+2 (uneven last row); 6 buttons
/ 3 columns is 3+3 (two full rows). Verified with a real 320px viewport (Claude Browser
resize_window + screenshot, temporarily un-hiding the archived nav via a client-side-only debug
script — CONFIG.archived/applyArchiveMode() itself was NOT touched) that the longest label,
"Probabilidades", still renders in full at 11px with no ellipsis truncation.

Added a defensive rule for a button left alone in the final mobile row when the visible count
isn't divisible by 3 (`:nth-child(3n):nth-last-child(1) { grid-column: 1 / -1 }` — the `3n`
instead of the more obvious `3n+1` accounts for the two `display:none` Participantes/Pagamento
buttons living INSIDE `.nav`, which `:nth-child` counts even though they don't occupy a grid
cell; full accounting in the CSS comment). Currently inert for Copa (6 items, 2 full rows, no
orphan) but matches the equivalent fix in BR2026 (which DOES have an orphan today — 7 items) and
keeps the three files' patterns consistent for whoever edits nav items next.

Propagated to all three apps in the same round — see `bolao/br2026/CHANGELOG.md` and
`bolao/cdb2026/CHANGELOG.md`. `audit_scoring.py`: 6/6 (unaffected, no scoring/logic touched).

## v4.164 — 2026-08-02 — Tab nav: `aria-current="page"` on the active section button

Fase 2.2 visual/accessibility audit (`docs/bolao/VISUAL_PARITY_MATRIX.md`) flagged that the main
nav buttons only signaled the active tab via a `.active` CSS class, invisible to screen readers.
`showSection()` now also toggles `aria-current="page"` on the matching `.nav button[data-section]`
(removed on the rest). Not `aria-selected` — these are plain `<button>` elements, not a
`role="tab"`/`role="tablist"` pair, so `aria-current` is the correct ARIA pattern here rather than
adding a tab role without its full required structure. Same fix propagated to BR2026 and CDB2026
(same `showSection()` shape in all three). No visual change, no scoring/logic touched.
`audit_scoring.py`: 6/6.

## v4.163 — 2026-08-01 — Live clock stoppage-time cap missing for regular-time periods (propagated from CDB2026)

Real live incident (CDB2026, Vasco×Fluminense, Oitavas, 2026-08-01): the live clock kept climbing
past halftime ("58:11 (+14)" and still rising) because `formatMatchClock()`'s stoppage-time cap
only applied to `period===4` (extra time) — the same gap Copa's own comment already described
fixing once for extra time, on the assumption periods 1-3 would always get a fresh isHalftime
signal in time. They don't, if a single 60s poll doesn't land right when the match pauses.

Fixed here too: the cap now applies to any known period, not just 4. Also added a companion cap
in the `runningClock` interpolation itself (hero-live-card) — 3x the 60s poll interval — so even
a poll that's stuck for several minutes can't make the display run away indefinitely.
`audit_scoring.py` re-run, passing — scoring untouched.

## v4.162 — 2026-08-01 — `.sticky-submit` CTA overlap fixed (propagated from CDB2026 Fase 2.2)

An independent review of CDB2026's "Salvar entrada" button found it visually covering the "Nova
entrada" `<h2>` on mobile — CDB2026's own overlap test only checked focusable controls, never
headings/text/cards. Per the platform propagation rule, the same `.sticky-submit` pattern was
audited here (the canonical/golden-master copy of it) with a comprehensive check across all 7
required viewports (headings, labels, selects, inputs, cards — not just focusable controls):
confirmed the SAME defect, 77 overlap findings across viewports/scroll positions (the entry
section is unreachable in production right now — `CONFIG.archived` hides it — but the CSS/DOM
still has the bug, and this file is what BR2026/CDB2026 copy their visual patterns from).

Fixed the same way as CDB2026: removed `position: sticky`/`pointer-events` from `.sticky-submit`,
button now lives in normal document flow — structurally unable to overlap a sibling, not just
"tested and not found today." Re-ran the comprehensive check after the fix: 0 findings across all
7 viewports. `audit_scoring.py` re-run, still passing (scoring/ranking/tiebreaks untouched).

## v4.161 — 2026-07-24 — Entry-name email subjects hardened against the "/" → "&#x2F;" escaping bug

Follow-up to BR2026's round-email subject fix (same day). Eduardo asked "Fixed for everything
that exists now and the future?" — the round-email fix was, but digging further found the same
underlying defect has one more live exposure this repo didn't cover yet: the regular entry-
confirmation emails (sent whenever anyone submits/edits picks, or when they're removed) put the
participant's raw, free-typed entry name directly into the same subject-carrying EmailJS field
(`entry_name`). If a participant ever types "/" into their entry name, the receipt subject — and
the admin's copy — would show the same `&#x2F;` garbling that the round-email date ranges showed.
Pre-existing across all three apps, unrelated to the recent Copa move, just never triggered
because nobody had typed a "/" into an entry name yet.

Added `emailSubjectSafe(s)` (returns `s` with "/" replaced by "-") next to `receiptCode()` in
each app's `app.js` and applied it at every place a participant-entered string feeds an
`entry_name` value: the initial confirmation + admin-copy emails, the removal-notice email, the
result-email subject (defensive — team names are controlled data, not user input, but cheap to
cover), and the edit-confirmation email. Does not touch `receiptCode()` itself (already safe —
hex hash + digits only, no user text). HTML bodies are untouched — they render through
`{{{html_message}}}`, already immune.

Propagated to BR2026 and CDB2026 in the same patch (`PLATFORM_SHARED` classification — all
three apps share this exact EmailJS template pattern). `audit_scoring.py` re-run on all three
after — 5/5 each, unaffected (email-subject string handling only, no scoring/ranking logic
touched). `node --check` clean on all three `app.js`.

## 2026-07-22 — Full-repo path audit after the GitHub Actions fix (no siteVersion bump — docs/security config only)

Eduardo, on seeing the workflow-path fix: "You should have been through everywhere." Correct —
the 2026-07-19 post-move audit grepped inside `bolao/` and missed everything outside it. Did a
full-repo sweep this time (`grep -rn "bolao/"` across the whole tree, not just the app folders)
and found more real gaps from the same move:

- **Security-relevant:** `.gitignore` only had `bolao/backups/`. `backup.py`/`backup_daily.py`
  resolve their output directory relative to their own script location, so after the move they
  silently started writing participant PII (names, emails, payment methods, pulled from
  Supabase) to `bolao/copa2026/backups/` — a path `.gitignore` no longer covered. Confirmed via
  `git log` that no backup file was ever actually committed (no leak occurred — no CI workflow
  runs the backup scripts), but the gap was real. Fixed by adding all three apps' `backups/`
  paths to `.gitignore`.
- `CHATGPT.md` at repo root — turned out to be even more stale than the move itself (still
  described a single pre-BR2026/CDB2026 app, dated 2026-06-27). Replaced with a short pointer to
  `CLAUDE.md` instead of re-syncing a second full copy, since the duplication was the actual
  root cause of the drift.
- Six operational docs (`QA_CHECKLIST.md`, `QA_MASTER_CHECKLIST.md`, `UI_REGRESSION_PROTOCOL.md`,
  `CDB2026_RULES_AND_MODEL.md`, `PROJECT_MEMORY.md`, `ARCHITECTURE.md`, `LESSONS_LEARNED.md`)
  had actionable instructions (not historical log entries) pointing at
  `bolao/scripts/audit_scoring.py` and similar paths that no longer exist. Fixed all of them.
- `PROJECT_MEMORY.md` also had a factual claim that went stale with the move: it said all three
  apps register the same `/bolao/sw.js`. Since v4.159 the Copa registers its own
  `/bolao/copa2026/sw.js`; BR2026/CDB2026 still share `/bolao/sw.js`. Corrected.
- Left untouched, intentionally: dated changelog/design-doc entries that cite the old
  `bolao/js/...` paths as historical record of a real state on the date they were written
  (rewriting those would be revisionist, not a correction).

Full detail in `docs/bolao/CONSISTENCY_MATRIX.md`, "Follow-up (mesmo dia, 2026-07-22)" note.
`audit_scoring.py` re-run on all three apps after this pass — 5/5 on each, unaffected (docs and
`.gitignore` only, no app code touched).

## 2026-07-22 — GitHub Actions workflow paths fixed (no siteVersion bump — CI config only)

Eduardo: "I got a workflow error about email send." Checked the actual failed run
(`.github/workflows/auto_results.yml`, run 29883861333) — confirmed the exact cause:
`##[error]An error occurred trying to start process '/usr/bin/bash' with working directory
'.../bolao/scripts'. No such file or directory`. The v4.159 Copa move (`bolao/` →
`bolao/copa2026/`) updated every in-repo path reference except the GitHub Actions workflow
files — missed entirely during that audit.

Fixed `auto_results.yml`'s two `working-directory: bolao/scripts` steps and the
`git add bolao/js/config.js` line to point at `bolao/copa2026/scripts` and
`bolao/copa2026/js/config.js`. Also fixed `sync_version.yml` (the cache-bust bot), which had the
same gap two ways: its path *trigger* still watched the now-nonexistent `bolao/js/**`/`bolao/css/**`
(so it would silently never fire again for future Copa edits), and its `index.html` sync loop
never included `bolao/copa2026/index.html` (so even a manually-triggered run wouldn't have bumped
Copa's real cache-bust version, though the harmless `bolao/index.html` redirect stub was still in
the loop, always a no-op since it has no `?v=` query strings).

Verified `--auto`'s idempotency before assuming the fix alone was enough: `run_auto()` only sends
anything for match IDs not already in Supabase — since all 32 knockout matches (through M104) are
already locked, the fixed workflow will just report "nothing to do" and exit cleanly on every
remaining scheduled run this month, no risk of a duplicate email. The workflow's own `cron:`
schedule is scoped to months 6–7 only, so it stops firing on its own once August starts — left
as-is rather than also disabling it, since disabling a schedule Eduardo set up wasn't part of the
reported problem.

`br2026_round_emails.yml` was unaffected (references `bolao/br2026/scripts`, never moved).

`audit_scoring.py`: PASSED on all 3 apps, unchanged — CI configuration only, no app code touched.

## v4.160 — 2026-07-19

### Fixed — audit report said "provisional, before the Final" even though the tournament had concluded

Eduardo asked for a full post-move audit ("ensure absolutely nothing got broken"). Verified the
whole platform end-to-end against the real production URLs (not just local): the `/bolao/`
redirect, all 4 emailed-link stubs, the Copa/BR2026/CDB2026 switchers, the service worker path,
and the CDN scripts — all confirmed correct in production. Found one real issue while checking
the audit report's actual rendered content: `generate_audit_report.py` had **hardcoded**
"Top 3 provisório atual (antes da Final)" / "This audit is published before the Final's (M104)
result... tomorrow" text in two places (the ranking-tiebreak finding and the executive summary's
closing paragraph) that never became conditional on whether the tournament was actually decided
— unlike the prize-mechanism finding right next to it, which already correctly branched on
`tournament_decided`. Since M104 has been locked in production since earlier today, the live
audit report was showing "provisional... decided tomorrow" language on a tournament that had
already concluded (Spain champion) — confusing, though **not a scoring or payout bug**: the
underlying totals (`score_entry_total()`) were already fully correct, verified independently
earlier today (Aline's 191 pts, Simone Hirle #4's 227 pts — unchanged before/after this fix,
confirming the math was never wrong, only the prose describing it).

Fixed both spots to branch on the same `tournament_decided` flag the prize-mechanism finding
already used: now says "Top 3 final" / "Tournament concluded — this ranking is final" and "This
audit was published before the Final's result... the tournament has concluded, this report
reflects the final result" in all 3 languages. Regenerated the audit report and both detail
pages to confirm — only the intended text and generation timestamp changed, nothing else.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — narrative-text fix only, the scoring
computation itself was never wrong.

## v4.159 — 2026-07-19

### Changed — Copa moved from `bolao/` to `bolao/copa2026/`; `/bolao/` now redirects to Brasileirão

Eduardo, after v4.158 (which only changed the switcher's default selected option): "O drop down
aparece mas a pagina não redireciona" — he expected an actual redirect. Confirmed the full plan
before touching anything: move the entire Copa app (previously directly under `bolao/`) to
`bolao/copa2026/`, matching the folder pattern already used by `bolao/br2026/`/`bolao/cdb2026/`,
so `bolao/index.html` could become a real redirect without leaving the v4.157 archived Ranking
(podium/audit link/"Ver palpites") with no URL of its own anywhere.

**Moved** (via `git mv`, history preserved): `index.html`, `js/`, `css/`, `assets/`, `scripts/`,
`docs/`, `preview/`, `audit-report.html`, `audit-detail-picks.html`,
`audit-detail-governance.html`, `classificacao-geral.html`, `CHANGELOG.md`, `README.md`/`.txt` —
all now live under `bolao/copa2026/` instead of directly under `bolao/`.

**`bolao/index.html`** is now a redirect (meta refresh + `location.replace`) to `/bolao/br2026/`.
**`bolao/audit-report.html`, `audit-detail-picks.html`, `audit-detail-governance.html`, and
`classificacao-geral.html`** are now small redirect stubs at the old paths pointing into
`bolao/copa2026/` — these links were already emailed to real participants before the move and
had to keep resolving. **`bolao/sw.js`** was left in place unchanged (identical copy) at the old
path as a safety net for any browser that still has the old `/bolao/`-scoped service worker
registered; the live app now registers its own copy at `bolao/copa2026/sw.js`.

**Fixed absolute references** that assumed the old location: canonical link; the "Copa do Mundo"
option in all three apps' "Alternar bolão" switcher (pointing it at `/bolao/` now would create an
infinite redirect loop); the switcher's `allowed` array in all three apps; the service worker
registration path; the footer links inside emails (`send_result_email.py`,
`send_bracket_correction_email.py`); and the GitHub source-code links inside the audit report
(`generate_audit_report.py`). `generate_audit_report.py`'s and
`generate_classificacao_geral.py`'s `REPO_ROOT`/`OUT_PATH` computations got one extra `".."` for
the new nesting level. Regenerated the audit report pages with the fixed scripts to confirm.

**Verification**: `node --check` on all 3 apps, `python3 -m py_compile` on the Copa scripts,
`audit_scoring.py` PASSED on all 3 apps (run from the new Copa location). The full redirect chain
was tested end-to-end with Playwright (`/bolao/` → `/bolao/br2026/`,
`/bolao/audit-report.html` → `/bolao/copa2026/audit-report.html`, and the other 3 stubs) — all
confirmed working. Full visual verification of the moved page (`bolao/copa2026/`) itself was
limited by a sandbox network instability (the synchronous CDN scripts — emailjs, supabase-js —
hung in the headless browser; confirmed not a regression from this change since BR2026, untouched
in this respect, showed the identical hang in the same test) — direct HTML inspection confirms
the values are correct, and the nav/switcher rendering logic itself wasn't touched by this
change, only the path values. A quick manual visual check in production after deploy is
recommended.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — structural/path change only, no scoring,
bracket, or business rule touched.

## v4.158 — 2026-07-19

### Changed — archived Copa page's bolão switcher now defaults to Brasileirão

Eduardo: "Deixe o default do site como o Brasileiro agora." Clarified in conversation what
"default" should mean before touching anything — first considered redirecting `/bolao/` to
`/bolao/br2026/`, which would have required moving the entire archived Copa app to a new
`bolao/copa2026/` folder to keep it reachable at all (its Ranking tab, with the podium/audit
link/"Ver palpites" panel set up in v4.157, otherwise has no other home). Eduardo asked for the
simplest option that achieves the same nudge without that risk: just flip which option is
pre-selected in the "Alternar bolão" `<select>` on the archived Copa page itself.

One HTML change (`bolao/index.html`): the switcher's `selected` attribute moved from "🏆 Copa do
Mundo" to "🇧🇷 Brasileirão". Purely cosmetic — confirmed the only JS reference to `#bolaoSelect`
is its `change` listener (navigates only when the user manually picks a different option), so
this doesn't trigger any navigation on load and doesn't touch anything else on the page. BR2026's
and CDB2026's own switchers are unchanged, still correctly pre-selecting their own app. No files
moved, no redirect added — every link already emailed to real participants (`/bolao/`,
`audit-report.html`, `audit-detail-*.html`) keeps working exactly as before.

Verified with Playwright: switcher shows "Brasileirão" selected on load, page content is still
the full archived Copa Ranking underneath it, unaffected.

`audit_scoring.py`: PASSED, unchanged — one attribute moved on one page, no app logic touched.

## v4.157 — 2026-07-19

### Added — archive mode: tournament over, site simplified to Ranking + audit + picks

Eduardo, after the Final concluded (Spain champion): "Copa do mundo finalizada! ... Desabilitar
os botões todos, deixar só o vencedor, auditoria e os palpites." Discussed the "move to
`copa2026/`" idea too — recommended against it (18+ real emails, the audit report, and the
BR2026/CDB2026 switcher all already point at `/bolao/`; moving would break every one of those
links for no real benefit) in favor of freezing `/bolao/` in place as the permanent 2026 archive
and building Copa 2030 as a new sibling folder when the time comes — Eduardo agreed.

**New `CONFIG.archived` flag** (`config.js`, currently `true`): a single, trivially-reversible
switch. When on, `applyArchiveMode()` (`app.js`) hides the Palpites/Jogos/Probabilidades/Regras
and Admin nav buttons and forces Ranking as the only reachable section. No new page was built —
Ranking already contains the podium/winner banner, the audit report link, and the "Ver palpites"
per-entry detail panel (click any entry to see their picks), so it already was "vencedor +
auditoria + palpites" in one place once the nav noise around it is gone.

Admin stays reachable (not deleted or actually locked out — `guardAdmin()`'s password gate is
the real protection, always was) via a small, low-contrast text link added to the footer version
line, only rendered when archived — declutters the header for everyone else without blocking
Eduardo from doing an occasional post-tournament correction.

Verified structurally with Playwright (real Supabase reads aren't reachable from this sandbox's
browser context, but the nav-hiding logic doesn't depend on entry data): all 5 buttons hidden,
Ranking active by default, footer admin link renders and correctly switches to the Admin section
when clicked, both desktop and mobile.

**Not propagated to BR2026/CDB2026** — both tournaments are still in progress (BR2026 entries
closed but the season is still being played; CDB2026 just opened, Round of 16 starts 2026-08-01).
Archive mode is meaningless until each of those tournaments actually finishes; noted for when
that day comes.

`audit_scoring.py`: PASSED, unchanged — this only hides navigation, no scoring/business rule
touched.

## v4.156 — 2026-07-19

### Fixed — substitutions missing from the live "lances" feed (cards/goals still showed, subs never did)

Eduardo, live during the World Cup Final: "As substituições sumiram do lugar onde tem os lances
cartões e gols." Investigated with real live data (event 760517, Spain × Argentina, 79th minute):
confirmed ESPN's scoreboard endpoint (`comp.details`, the field `extractMatchPlays()` reads) only
ever returned the 2 yellow cards for this match — 11 real substitutions had already happened by
minute 75, and none of them ever appeared in `comp.details`. Not a regression from a code change
on our side (this exact code hasn't changed since v4.119, and its own comment already flagged
substitutions as "unconfirmed against a real match" pre-ship) — it's ESPN's scoreboard endpoint
never carrying substitution events at all, discovered only now because this is the first live
match with real subs since the feature shipped.

**Fix**: ESPN's separate per-event `summary` endpoint (`.../summary?event=<id>`) has a richer
`keyEvents` array that DOES include substitutions (confirmed live: same match, 9 real subs, all
with correct player names and side). New `fetchEspnEventSummary(eventId)`, called only for
matches currently live (`pollLiveScores()`), fetched in parallel via `Promise.all` so a normal
poll with nothing in progress never adds extra network calls. `extractMatchPlays(comp, keyEvents)`
now prefers this richer source when available and falls back to `comp.details` alone if the extra
fetch fails — cards/goals never regress even if the summary call is down. The two sources use
different athlete-name fields (`athletesInvolved` vs `participants[].athlete`) — both now
supported. Verified end-to-end against the real live Final: without the fix, only 3 yellow cards
showed; with it, all 9 real substitutions appear too, correctly ordered, alongside the cards.

**Propagated same-day to BR2026 and CDB2026** (`bolao/br2026/js/app.js`,
`bolao/cdb2026/js/app.js`) — both had ported this exact `extractMatchPlays()`/scoreboard-only
pattern from Copa and had the identical bug. Same fix applied: `fetchEspnEventSummary()` per app
(deriving the summary URL from each app's own `C.espn.scoreboardUrl`), wired into their own
polling functions (`fetchScoreboard()` for BR2026, `fetchEspnCandidates()` for CDB2026). Verified
the derived summary URL and endpoint against real ESPN data for both leagues (`bra.1`,
`bra.copa_do_brazil`) — reachable, correct shape, no live match right now to show real
substitutions but the endpoint itself confirmed working.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — presentation-only fix (an additional ESPN
fetch and a richer plays-list source), no scoring, bracket, or business rule touched.

## v4.155 — 2026-07-19

### Added — Copa do Brasil 2026 invite appended to the true final-result email

Eduardo, after reviewing the test preview: "The email is much better now... just send at the end
of the last match on the same format with the winner, runner up and 3 place like you did
yesterday. Just add the invite to the new bolao." Also confirmed it's fine to share the CDB2026
public URL directly ("You can put the public link, no problem") — no code change needed there,
the invite already used the real URL.

**`build_cdb_invite_html()`** (`send_result_email.py`): new bilingual PT/EN invite block for the
Copa do Brasil 2026 bolão (CDB2026), styled to match the existing podium-reveal block. Wired into
`run_auto()`'s M104 branch, appended **only** when `compute_final_payouts()` confirms the
tournament is truly over (both M103 and M104 locked) — the exact same gate that already decides
whether to prepend the champion/runner-up/3rd-place podium block. A normal per-match email
(`build_html()` on its own) is never affected; verified structurally (`build_cdb_invite_html()`
is called from exactly one place in the file) and with a real dry run (real M103 data + an
in-memory-only simulated M104 result, never written to Supabase) confirming the invite block
renders once, after the podium block, with the correct link.

No email was sent by this change — per Eduardo's explicit instruction ("Don't send anything
now"), this only prepares the automated pipeline to include the invite when the real Final
concludes and `--auto` (or a manual final send) fires as usual.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — additive-only change to the email builder,
gated behind the existing tournament-complete check; no scoring, bracket, or business rule
touched.

## v4.154 — 2026-07-19

### Fixed — "avança" wording on the last two matches; full IP disclosure on the governance audit page; regenerated "Classificação Geral" (who's still alive) report from real data with a real generator script

Eduardo, reviewing the site ahead of the Final: (1) "classificacao-geral.html" — not the
Probabilidades tab built in v4.153 — was the page he meant by "probabilities" and needed a full
audit-grade refresh; (2) the audit governance page should show full IP details, not masked; (3)
the "+5 {team} avança" wording is wrong for M103 (3rd place match) and M104 (Final) — "purely a
semantic issue, not a scoring change," since nobody "advances" from the tournament's last two
matches; (4) requested a full scan confirming Gabriel Ferrari's 15 points on M103 already folds
in the 10-point 3rd-place bonus once, not twice.

**"avança" wording fix** (`score_match()` in `send_result_email.py`, `scoreMatchSingle()` in
`app.js`, both call sites in `build_html()`/`buildResultEmailHtml()` and
`generate_audit_report.py`'s traceability computation): the +5 "correct side" bonus note and the
"Último jogo" callout line are now match-ID-aware — M103 says "vence a disputa de 3º lugar" / "wins
the 3rd place match", M104 says "vence a Final" / "wins the Final", every other match keeps
"avança" / "advances" unchanged. Points math is untouched — verified in Node and Python with real
M103 data (France 4×6 England) that all three match types still award exactly 5 points, only the
displayed text differs.

**Gabriel Ferrari's 15-point M103 total — verified correct, not a bug.** Full scan: for all 23 real
entries, summed every one of the 32 individual per-match displayed points (each already folding in
any podium bonus, per the v4.152 fix) and compared against the official `score_entry_total()`.
Zero mismatches. Gabriel's 15 = 5 (base advance points, England correctly picked) + 10 (3rd-place
podium bonus), folded in exactly once — confirmed identical to the official total everywhere.

**Full IP disclosure on `audit-detail-governance.html`** (`generate_audit_report.py`): per
Eduardo's explicit instruction, IPs are no longer masked (`_mask_ip()` removed entirely) — the page
now shows the complete IP address, plus a previously-uncaptured `lang` (browser language) field,
alongside the existing timestamp/device/platform/change-diff data. This reverses the masking
decision made in v4.153 at Eduardo's direct request; participant email addresses remain excluded
(unchanged policy). Description text on the governance page and the executive summary's audit
links section updated to say "full IP" instead of "partially masked."

**`classificacao-geral.html` regenerated from real data, now with a real generator script**
(**NEW** `bolao/scripts/generate_classificacao_geral.py` — the page previously had no generator,
just a hand-written one-off from v4.134/2026-07-15, stale since the semifinals). With M103 now
locked and only M104 (the Final) outstanding, the "Vivo/Eliminado" (alive/eliminated) check is now
an **exact enumeration** (all 56 realistic M104 outcomes: every scoreline 0×0–6×6, ties split
across both possible penalty-shootout winners) rather than a sample, and the "chance" percentages
use a disclosed bivariate-Poisson model (independent Poisson goals for each finalist, combined
expected goals fixed at 2.4, split solved by bisection to reproduce the live Polymarket
market-implied win probability for the two remaining teams) instead of app.js's JS-only
team-strength Monte Carlo engine, which isn't portable to Python. Same "Garantido" (guaranteed
at-least-this-position)/percentage/"<0,1%"/"—" (impossible) cell semantics and CSS as the original
page. Ranking/tiebreak cascade (`total → exact → podium hits`) reuses `send_result_email.py`'s own
functions, so it can never drift from the official scoring.

Caught and fixed during review, before shipping: the first draft sorted table rows by total score
only, which put ties in the wrong visual order relative to their own displayed rank number
whenever the tiebreak (exact scores / podium hits) mattered — e.g. Marodin's row appeared above
Gabriel Ferrari's despite Gabriel's badge correctly reading a better rank (7 vs 8). Fixed by
sorting rows by the already-correctly-computed tiebreak rank instead of re-deriving order from
total alone; re-verified against real data that both Gabriel-vs-Marodin (podium hits break the
tie) and Gustavo Ribeiro-vs-Simone Hirle #2 (exact-score count breaks the tie) now display in the
right order.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — every change this release is wording,
display, or a new read-only report generator; no scoring formula, bracket, or business rule was
touched.

## v4.153 — 2026-07-19

### Added — "chance of winning the bolão" on the Probabilidades tab, and full lottery-audit-grade traceability report

Eduardo: wanted the Probabilidades tab updated to show the probability of winning the whole
bolão (money), not just team-level World Cup odds, plus a full audit — "every single result of
every single game in every single person's pick," with creation/modification timestamps and
before/after values, structured as an executive summary with links to detail (including code)
rather than one giant page — "like a lottery audit."

**Probabilidades tab — "💰 Chance de ganhar o bolão"** (`computeMoneyProbabilities()` /
`moneyProbHtml()` in `app.js`): once M103 is decided and M104 (the Final) is not, models the
bolão's own money outcome under both possible Final winners, weighted by live market odds
(Polymarket) for those two teams specifically (renormalized to sum to 100%, since only 2 teams
remain). Reuses `finalPodiumPayouts()` itself — already shipped and validated — against two
minimal placeholder scorelines (1-0 / 0-1), so the model is driven only by *who wins*, never a
guessed final score; disclaimer text makes this explicit. Verified against real production data:
numbers match hand-traced math exactly (e.g. an entry that only wins money in one of the two
scenarios shows exactly half its scenario payout as "expected value" and 50% "prize chance").
Gracefully falls back to 50/50 if Polymarket hasn't loaded yet.

**Full traceability audit, restructured as summary + detail pages** (`generate_audit_report.py`):
- `bolao/audit-report.html` (existing) is now a true executive summary: trimmed narrative, with a
  new "🔍 Auditoria detalhada e transparência de código" section linking to the two pages below
  plus direct GitHub links to the actual scoring/email/audit source files (repo confirmed public).
- **NEW** `bolao/audit-detail-picks.html` — for every one of the 23 real entries, every one of the
  32 knockout matches: the pick, the real result, and the exact points earned (base + podium
  bonus, itemized per v4.152), collapsible per entry with a navigable index. This is the raw,
  unsummarized data behind every number in the executive summary.
- **NEW** `bolao/audit-detail-governance.html` — creation/last-update timestamp for every entry,
  plus the complete real edit history already captured by the site's own "editar por código" flow
  (`state.auditLog`): exact before/after value for every changed pick, timestamp, partially-masked
  IP, device/browser, per edit event. **Important finding disclosed, not hidden**: 11 of the 23
  entries have `updatedAt` differing from `createdAt` with NO matching audit log record — this
  does not correspond to a participant edit (the site's edit flow always logs one) and most likely
  reflects an administrative or data-migration operation that predates this audit; the exact cause
  was not established and is reported as such rather than mischaracterized as a verified edit.
  Participant emails are not shown on this public page, consistent with the rest of the site
  (Participantes tab is admin-only).

Both new pages are `noindex,nofollow` (matching the main site) and use masked IPs — no participant
email addresses are exposed on any audit page. Given the scale (23×32 = 736 match rows), the two
detail pages use trilingual chrome/headers but Portuguese-only per-row notes (numbers, team names,
and timestamps are already language-neutral) — a deliberate, disclosed scope tradeoff from the
fully trilingual executive summary, to keep the pages generatable and usable.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — both additions are read-only (new reporting
script output + a client-side probability display), no scoring or business logic touched.

## v4.152 — 2026-07-19

### Fixed — podium bonus never itemized in the per-match breakdown (display-only gap, not a computation bug)

Eduardo, after the corrective email for v4.151 went out: "Email foi mais uma vez incorreto sem o
bonus." Investigated thoroughly before touching anything:

- Confirmed the LIVE deployed site (`ferrarilabs.github.io/bolao/`, served `app.js?v=e06ccef`)
  already had the v4.151 fix — `score_entry_total()`/`scoreEntry()` correctly return 227/158 for
  Simone Hirle #4/Gabriel Ferrari, verified fresh against production data right before making any
  change.
- The actual root cause: the per-match breakdown table shown for M103 in **every** result view
  (automated email, admin manual email, and the site's own "Ver palpites" panel) only ever
  displayed the base match points (exact/goals/advance — max 15) and never itemized the podium
  bonus anywhere in that row, even though the AGGREGATE total further down (ranking table,
  ranking list) always correctly included it. A reasonable reader scanning "M103: 5 pts, +5
  England avança" — the first, most prominent number in the email — would conclude the bonus was
  still missing, without necessarily connecting it to the correct total several rows further down.
  This exact same gap existed independently in three places, so this was very likely the real
  cause of all three "sem o bônus" reports, not a repeat of the v4.151 computation bug.

Fixed by folding the podium bonus into the *displayed* per-match points for M103/M104 specifically
(mirroring the same "fold bonus into displayed pts" design already used by the live/provisional
preview, `liveMatchPoints()`), with an explicit note (e.g. "+5 England avança, +10 bônus 3º
lugar") wherever the match has a detail column, and a tooltip on the site's "Ver palpites" points
cell (which has no detail column). New shared helper: `match_podium_bonus_note()` (Python) /
`matchPodiumBonus()` (JS) — used by `send_result_email.py`'s `build_html()`, `app.js`'s
`buildResultEmailHtml()` (admin manual email), and `app.js`'s `picksTable()` (site's per-entry
picks panel). Does **not** touch `score_entry_total()`/`scoreEntry()`'s aggregate total logic at
all — those were already correct and remain the single source of truth; this only makes the
per-match display consistent with what the total already said.

Verified against real production data across all three surfaces: Simone Hirle #4 and Gabriel
Ferrari now show 15 pts (with the bonus itemized) at M103 in the Python email builder, the JS
admin email builder, and the site's picks panel; Mitch is the best (predicted the wrong team,
correctly gets no bonus) stays at 5 pts everywhere, unchanged.

`audit_scoring.py`: PASSED, unchanged — display-only fix, doesn't touch the aggregate scoring
functions the suite covers.

## v4.151 — 2026-07-19

### Fixed — 3rd-place bonus withheld from OFFICIAL scoring until the Final was also decided (real money bug, already-sent email affected)

Eduardo, after M103 (3rd place) concluded and the automated result email went out: "O email pos
jogo foi enviado sem o bonus do 3 lugar por que."

Confirmed as a real bug — and unlike the two live-preview-only bugs fixed yesterday (v4.147,
v4.149), **this one hit official scoring directly.** `_podium_from_results()`
(`send_result_email.py`) and `podiumFromResults()` (`app.js`) — the functions
`score_entry_total()`/`scoreEntry()` actually use to award the champion/runner-up/3rd/4th bonus —
only returned a result once **both** M104 (Final) **and** M103 (3rd place) were decided. Real M103
concluded 2026-07-19 (France 4×6 England, England 3rd), but M104 hadn't been played yet — so
`_podium_from_results()`/`podiumFromResults()` returned `None`/`null` entirely, and every entry's
3rd/4th place bonus was silently zeroed, including the 2 real entries (Simone Hirle #4, Gabriel
Ferrari) who had actually predicted England for 3rd through their own bracket. Each was missing 10
points — in the site's live Ranking tab, and in the automated result email already sent right after
M103.

Root cause: the two positions (champion/runner-up from M104, 3rd/4th from M103) are independent
achievements — a participant can earn one without the other being known yet — but the gating logic
required both, treating the podium as one atomic all-or-nothing object.

Fixed: `_podium_from_results()`/`podiumFromResults()` now resolve champion/runner-up and 3rd/4th
independently, returning as soon as *either* half is known. `podium_bonus_points()`/
`podium_hits()`/`scoreEntry()`'s bonus block already checked each of the four positions
independently against the entry's own prediction — they only ever needed the upstream gate fixed,
not touched themselves. Verified with real production data: `score_entry_total()`/`scoreEntry()`
now correctly award +10 to Simone Hirle #4 (217→227) and Gabriel Ferrari (148→158), matching an
independent from-scratch recomputation exactly.

**Impact and what's already fixed vs. what's stale:**
- The site's **Ranking tab is already correct** — `scoreEntry()` recomputes on every page load,
  nothing was stored with the wrong value.
- The **audit report** (`bolao/audit-report.html`, v4.150) has been regenerated with the corrected
  totals and its own independent-recompute logic updated to match (same bug existed in
  `generate_audit_report.py`'s `independent_real_podium()` — fixed in the same commit so the
  report's own cross-check doesn't false-flag against the corrected official score).
- The **M103 result email already sent** to participants kept the stale total (missing the
  bonus) — it cannot be recalled. **Update, same day**: Eduardo asked for a standalone corrective
  email for transparency — sent to all 18 real recipients (23 entries, deduplicated by email),
  explaining the bug plainly (bilingual PT/EN), naming the 2 affected entries and their corrected
  totals, linking the public audit report, and including the full up-to-date ranking table
  (`build_html(state, focus_mid="103")`, already reflecting the fix). 18/18 delivered, 0 errors.
  Sent via a one-off script (not committed to the repo — not a reusable feature, just this
  specific correction).

Also added a permanent regression test to `bolao/scripts/audit_scoring.py`
(`check_partial_podium_bonus`) that locks only through M103 (leaving M104 undecided) and asserts
the bonus still applies — confirmed it fails against the old buggy logic and passes with the fix.
The pre-existing `check_bonus_and_fourth_present` never caught this because it always locks the
*entire* bracket (M73-M104) at once in its test fixture, so it never exercised the partial-podium
state where this bug actually lived.

Checked BR2026/CDB2026 for the same pattern: not applicable to either — CDB2026's champion+runnerUp
both come from a single Final match (no separate 3rd-place match splitting the podium into two
independently-timed events like Copa's M103/M104), so there's no equivalent gate to get wrong;
BR2026 has no podium-bonus concept at all.

`audit_scoring.py`: now includes the new regression check above and passes on all 3 apps.

## v4.150 — 2026-07-18

### Added — trilingual technical audit report, published on-site before the Final

Eduardo, the day before the Final (M104): "Antes dos resultados finais fazer uma auditoria
automática com relatório estilo kpmg, big 4 e adicionar no site como um pdf ou html e colocar um
link para visualização. Colocar o máximo de detalhes possíveis! A auditoria precisa ser nas 3
linguagens só para deixar claro."

New `bolao/scripts/generate_audit_report.py` fetches the live production Supabase state and
generates `bolao/audit-report.html` — a professional-structure audit report (scope, methodology,
independent recomputation, findings, opinion, sign-off), fully trilingual (pt-BR/en-US/es) with a
language-toggle bar matching the site's own switcher, and print/PDF-friendly (the site has no
build step and no PDF library, so HTML was chosen — the report itself was explicit that either was
acceptable: "um pdf ou html"). Explicitly NOT branded as or affiliated with KPMG or any other
accounting firm — the header says so plainly; "Big 4 style" here means the report's structure and
rigor, not the branding.

Checks performed, all against real production data (23 real entries, 30 locked results as of
publication):
- **A.** Scoring formula constants (exact/goals/advance/bonus/prize %) cross-checked against
  independently-declared expected values — catches the exact class of "silent drift" bug from the
  July 2026 incident (CHANGELOG v4.57).
- **B.** Bracket structure integrity — all 32 knockout matches present, no broken slot references.
- **C.** Locked result data integrity — winning side matches the recorded score (accounting for
  penalty-shootout draws, which are expected and not flagged).
- **D.** Entry/payment data integrity — no duplicate IDs, no orphan picks, paid-count reconciled.
- **E.** Independent score recomputation for **every one of the 23 real entries** — points
  recalculated from raw picks + raw results in code deliberately kept separate from
  `score_entry_total()`, diffed against the official value. All 23 matched exactly.
- **F.** Ranking/tiebreak order verification (total → exact → podium hits) via the same
  independent recompute.
- **G.** Prize/pot mechanism verification (pot = paid × entry fee, 70/20/10% split).
- **H.** Full disclosure of the two bugs found and fixed earlier today (v4.147, v4.149), with the
  real before/after numbers, as a "findings identified and remediated" section — transparency
  about what went wrong is itself part of what was asked for.
- **I.** Embeds `audit_scoring.py`'s static self-test suite results.

A discreet "🔍 Ver Relatório de Auditoria da Pontuação" link was added to the top of the Ranking
tab (`bolao/index.html`), opening the report in a new tab. Report can be regenerated any time by
re-running the script — not wired into any automated cron, generated on demand.

Copa-only this round — BR2026/CDB2026 have no Final imminent, so this wasn't propagated; see
`docs/bolao/CONSISTENCY_MATRIX.md`.

`audit_scoring.py`: PASSED on all 3 apps, unchanged — this adds a new read-only reporting script,
doesn't touch scoring or business logic anywhere.

## v4.149 — 2026-07-18

### Fixed — live podium-bonus preview awarded bonus by bracket SIDE instead of TEAM (real money bug, M103 live)

Eduardo, with M103 (3rd place, França × Inglaterra) still live: "Score tem um problema: somente
quem selecionou a Inglaterra lá no início deve receber o bonus, não o time que passou. Entendeu?"

Confirmed as a real bug in the live-preview podium bonus shipped in v4.147 earlier today.
`liveMatchPoints()` only compared the entry's bracket-slot pick (`pick.advanceSide === liveAdvance`,
just the letter "A"/"B") against the currently-leading side — it never checked WHICH team the
entry's own bracket picks actually traced through to that slot. Verified against real production
data: of 21 real entries that picked side B for M103, only 2 (Simone Hirle #4, Gabriel Ferrari)
had actually predicted "England" specifically by tracing their own picks through the bracket
(`resolvedTeamsForEntry()`); the other 19 predicted entirely different teams (Mexico, Argentina,
Colombia, Brazil, Switzerland...) that only happened to land on the same bracket side because this
preview never checked team identity. All 21 would have shown the podium bonus live, even though
only 2 would ever actually receive it once the match locks.

Important: this bug was confined to the LIVE PREVIEW only (`liveMatchPointsTable()`, the "Pontos
(provisório)" table in the live match card) — the OFFICIAL scoring (`scoreEntry()`, via
`finalPodiumForEntry()`/`podiumFromResults()`) already compared by actual team name, never by side
alone, and was never wrong. `send_result_email.py` and the new prize-payout feature (v4.148) both
rely exclusively on official scoring and were also unaffected. No participant was ever paid or
scored incorrectly — this only affected what the live "what-if" preview displayed before a result
locked.

Fixed: `liveMatchPoints()` now takes the entry's own bracket-resolved team for that podium slot
(`entryPredictedTeam`, from `resolvedTeamsForEntry()`) and the real team names for both sides of
the match (`realTeamA`/`realTeamB`, from the existing `officialWinnersMap()`/`resolveSlot()`
already used by `liveMatchPointsTable()`), and only awards the bonus when the entry's own predicted
team matches the real team currently leading — mirroring `scoreEntry()`'s logic exactly.
Re-verified against the same real M103 data: with the fix, only the 2 entries that actually
predicted England now show the bonus; the other 19 correctly do not.

### Added — creative "parabéns" line for the top-3 in the podium/prize email

Eduardo: "Na descrição do email fale algo assim para os 3 primeiros: parabens [usuário] assim
como [time] você também é [campeão, vice, terceiro lugar], algo criativo assim." Added to each
top-3 card in the podium/prize email (both `send_result_email.py`'s automated builder and
`app.js`'s admin manual-send builder): a line pairing the real World Cup podium (which TEAM
finished champion/runner-up/3rd) with the bolão's own money podium (which ENTRY finished
1st/2nd/3rd) — e.g. "Parabéns, Simone Hirle #4! Assim como Spain, você também é Campeão — só que
do nosso bolão! 🏆" — verified with the real M104 result (Spain champion, Argentina runner-up,
England 3rd) producing matching text in both builders, in all languages each already supports
(PT/EN for the automated email, PT/EN/ES for the admin manual email). Purely cosmetic copy —
does not touch payouts, scoring, or the site banner (not requested; email only, per Eduardo's
wording).

`audit_scoring.py` (all 3 apps): PASSED, unchanged — this is a live-preview-only fix plus cosmetic
email copy; the official scoring pipeline the suite covers was never wrong.

## v4.148 — 2026-07-18

### Added — prêmio em dinheiro do pódio: banner no site + bloco no email de resultado

Eduardo, com a Final marcada para o dia seguinte: "Isso tem que estar no email também que será
enviado após os dois jogos! Precisamos pensar num email para o campeão, vice e terceiro lugar com
o valor recebido e uma tela especial para apos o fim do jogo de amanhã com o valor pago para cada
um e também com um agradecimento pela participação! Veja o placar atual para não ter nenhuma
duvida."

Investigado antes de implementar: `CONFIG.prizes` (`{ first: 0.70, second: 0.20, third: 0.10 }`)
já existia em `config.js` desde antes desta sessão, mas nunca era usado em lugar nenhum — nem no
site, nem no email automático, nem no manual. Não havia cálculo de prêmio em dinheiro implementado
em lugar algum do código, apesar da regra de divisão 70/20/10 já estar documentada na aba Regras.

Importante não confundir dois "pódios" diferentes que já existiam antes: (A) `podiumFromResults()`
/`finalPodiumForEntry()` — qual SELEÇÃO fica campeã/vice/3ª/4ª, usado só para o bônus de PONTOS
(`CONFIG.bonus`, ver v4.147 acima); (B) o novo `finalPodiumPayouts()` — qual ENTRADA do bolão
(participante) fica em 1º/2º/3º no ranking geral de pontos, usado para o prêmio em DINHEIRO
(`CONFIG.prizes`). São conceitos independentes; a implementação abaixo só toca o (B).

Confirmado com Eduardo via 3 perguntas antes de implementar: destinatários = todos os
participantes; base do cálculo do prêmio = pote atual (`pagantes × entryFee`), sem ressalva de
"pote pode crescer" (não há mais pagamentos esperados nesta altura do torneio); local da tela no
site = substitui o topo da aba Ranking assim que a Final travar.

**Site (`bolao/index.html`, `bolao/js/app.js`, `bolao/js/i18n.js`, `bolao/css/styles.css`):**
novo `#podiumBanner` no topo da aba Ranking. `finalPodiumPayouts(s)` só retorna resultado quando
M103 (3º lugar) E M104 (Final) estão travados pelo admin — antes disso o pódio do bolão ainda não
existe. Calcula o ranking geral (mesmo critério de desempate de `renderRanking()`: total → exato →
pódio, sem o desempate por nome que é só de exibição), agrupa por chave `total:exato:pódio` (não
pelo nome) para detectar empates reais, e divide o valor daquela colocação entre os empatados —
seguindo a regra já documentada na aba Regras ("a posição e o prêmio daquela colocação são
divididos entre os empatados"), que nunca tinha sido codificada até agora. Verificado com dados
reais de produção (23 entradas pagas, pote $115): 🥇 Simone Hirle #4 $80.50 · 🥈 Mitch is the best
$23 · 🥉 Aline $11.50 — e confirmado que o banner some corretamente enquanto M103/M104 não estão
travados (estado real de produção no momento da implementação).

**Email automático (`bolao/scripts/send_result_email.py`):** `compute_final_payouts()` (espelha
`finalPodiumPayouts()` exatamente, incluindo o mesmo agrupamento de empate) e
`build_podium_html()` (bloco bilíngue PT/EN com os 3 cartões de prêmio + agradecimento aos
participantes) — disparado dentro de `run_auto()` só quando `mid == "104"` E M103 já está salvo,
prependendo o bloco ao email normal e trocando o assunto para "🏆 Resultado Final do Bolão! · Final
Bolão Result!". Testado isoladamente com os mesmos dados reais usados no teste do site — os
valores batem exatamente ($80.50/$23/$11.50, pote $115).

**Email manual do admin (`buildPodiumEmailHtml()`, `sendResultEmailFromAdmin()` em `app.js`):**
mesmo bloco (agora trilíngue PT/EN/ES, consistente com o resto do email manual, que já é trilíngue
onde o automático é bilíngue), acionado pela mesma condição (`finalPodiumPayouts()` não-nulo), com
o mesmo assunto especial — mantendo os dois caminhos de email em paridade, como já vinha sendo
feito nesta sessão (ver v4.57 no histórico sobre o risco de esses dois caminhos divergirem).

Não altera pontuação nem regra de negócio — só adiciona a exibição/cálculo do prêmio em dinheiro
que já estava documentado nas Regras mas nunca tinha sido implementado. `audit_scoring.py` passa
sem alteração nos três apps.

## v4.147 — 2026-07-18

### Fixed — pontuação provisória do M103/M104 não incluía o bônus de pódio (real money bug)

Eduardo, durante o jogo real da disputa do 3º lugar (M103, França × Inglaterra): "O ranking
parcial onde calculamos os pontos de acordo com o resultado não mostra o bônus pelo 3º lugar.
Deveria mostrar assim como amanhã deve mostrar o bônus do primeiro e segundo. Isso é específico
somente desses dois jogos!"

Confirmado como bug real. `liveMatchPoints()` (usada só pela tabela "Pontos (provisório)" dentro
do card ao vivo, `liveMatchPointsTable()`) sempre calculou apenas os pontos de partida (placar
exato/gols de um time/avanço correto) — nunca incluiu o bônus de pódio (`CONFIG.bonus`), que na
pontuação OFICIAL (`scoreEntry()`) só é aplicado depois que o admin trava o resultado. Para a
imensa maioria dos jogos do mata-mata isso está certo (não há bônus de pódio associado). Mas M103
(disputa do 3º lugar) e M104 (Final) são diferentes: o vencedor/perdedor dessas duas partidas
especificamente DEFINE quem é campeão/vice/3º/4º — o placar ao vivo já permite projetar esse
bônus, e a tabela provisória deveria refletir isso, mas não refletia.

Corrigido: `liveMatchPoints()` agora recebe o `matchId` e, quando for exatamente "103" ou "104" E
o palpite de avanço da entrada bater com o lado que está ganhando ao vivo, soma também o bônus de
pódio correspondente (3º+4º = 15 pts pro M103; campeão+vice = 40 pts pro M104) — um único palpite
de avanço nesses dois jogos sempre prevê os dois lugares do pódio ao mesmo tempo (mesma lógica
"tudo ou nada" de `podiumFromResults()`/`finalPodiumForEntry()`, nunca os dois bônus
separadamente). Confirmado com o jogo real (França 2×1 Inglaterra simulado): quem acertou o
placar exato E o lado vencedor foi de 15 pts (10 exato + 5 avanço) para 30 pts (10+5+15 bônus).

Não altera a pontuação OFICIAL (`scoreEntry()`/`matchPoints()`) — só a projeção ao vivo, que já
deveria ter incluído esse bônus desde que o card "Pontos (provisório)" existe.

`audit_scoring.py`: PASSOU (a suíte cobre a pontuação oficial/e-mail, não a exibição ao vivo no
navegador — verificação manual feita com dados reais via Playwright, ver acima).

Achado o mesmo tipo de lacuna no CDB2026 (bônus de campeão/vice não entra na pontuação ao vivo da
Final) — não corrigido nesta rodada: lá as chaves têm formato ida+volta com classificação
agregada, mais arriscado de replicar corretamente ao vivo, e não há nenhuma chave ao vivo pra
testar agora (Oitavas só começa 1º/ago). Registrado em `docs/bolao/CONSISTENCY_MATRIX.md` pra
decisão do Eduardo.

## v4.146 — 2026-07-17

### Changed — local do jogo removido do card ao vivo

Eduardo: "Não precisa mostrar a localização no live mode." O card ao vivo (`hero-live-card`)
ganhou fase+local na rodada anterior (v4.144) — o local (📍) volta a ficar de fora enquanto o jogo
está rolando. A fase (ex. "Disputa do 3º lugar") continua, útil pra saber "que jogo é esse"
durante a partida. O local continua aparecendo normalmente no card "Próximo jogo" (pré-live).

Mesmo ajuste no BR2026 (removida a única linha de meta que existia lá, já que BR2026 não tem
"fase") e no CDB2026 (mantida a fase, removido só o local).

`audit_scoring.py`: PASSOU. Presentation-only, nenhuma fórmula de pontuação tocada.

## v4.145 — 2026-07-17

### Changed — horário do jogo agora mostra EST/EDT e BRT juntos (EST primeiro)

Eduardo: "Seria ideal botar o horário brt e est sendo est primeiro para não confundir o
pessoal." A Copa sempre mostrou o horário só em ET (`m.timeET`, fonte oficial FIFA, ex.
"17:00 (EDT)") — sem o equivalente em BRT, o que confunde o público brasileiro (inclusive
brasileiros morando nos EUA, dado que os métodos de pagamento do bolão são CashApp/Zelle/Venmo).

Adicionado `brtTimeFromKickoff()` — deriva o horário BRT do mesmo epoch já usado pelo contador
regressivo (`parseMatchKickoff()`), sem repetir conta de fuso na mão. Aplicado nos três lugares
que mostram `m.timeET`: card "Próximo jogo" (hero), pill de horário no formulário de palpites, e
pill de horário na lista completa de jogos. Formato: `"17:00 (EDT) · 18:00 BRT"` — EST/EDT
primeiro, como pedido.

Mesmo ajuste no BR2026 e no CDB2026 (que já mostravam só BRT, sem EST) — ver changelog de cada
app.

`audit_scoring.py`: PASSOU. Presentation-only, nenhuma fórmula de pontuação tocada.

## v4.144 — 2026-07-17

### Fixed — "Próximo jogo"/"Ao vivo": faltava a fase do torneio e o local do jogo

Eduardo, screenshot do card "Próximo jogo" real (France × England, disputa do 3º lugar, M103,
Hard Rock Stadium — jogo real de amanhã 18/jul): "Falta a localização do jogo e qual rodada
estamos." O local (`m.venue`) já aparecia no card de "próximo jogo" pré-live, mas a FASE do
torneio ("Disputa do 3º lugar") nunca aparecia em lugar nenhum do hero — só o número cru "M103".
No card AO VIVO (`hero-live-card`) faltavam os dois: nem fase, nem local, em nenhum estado.

Corrigido `renderNextMatch()`: adicionada uma linha com `phaseLabel(m.phase)` (+ grupo, na fase de
grupos) acima da linha de data/hora, no card "próximo jogo" (normal e adiado). Adicionado um novo
bloco `.hero-live-meta` no card ao vivo, mostrando fase + local (`m.venue`) — nenhum dos dois
existia ali antes. Reaproveita o mesmo helper `phaseLabel()`/`t("groupLabel")` já usado na lista
completa de jogos (`renderGamesSection()`), sem introduzir lógica nova.

Verificado com o estado real de produção (Supabase) — M103 (França × Inglaterra, 3º lugar,
18/jul, Hard Rock Stadium) renderiza corretamente "Disputa do 3º lugar" + local no card
pré-live, e o mesmo no card ao vivo simulado com dados reais da ESPN mockados.

Mesmo achado no BR2026 (venue faltava na lista compacta "Jogos de hoje" e no card ao vivo) e no
CDB2026 (fase faltava no card de próximo confronto, e fase+venue faltavam no card ao vivo) — ver
changelog de cada app.

`audit_scoring.py`: PASSOU. Mudança é só apresentação (nova linha de texto/CSS), nenhuma fórmula
de pontuação tocada.

## v4.143 — 2026-07-17

### Fixed — vão em branco no final da página no iOS (hipótese: reflow de rolagem do WebKit)

Eduardo, screenshot: "Ainda tem bastante areas em branco ao final da pagina, isso tinha sido
corrigido." Investigado a fundo — reproduzido localmente com o estado real do Supabase (11
entradas do BR2026) e comparado byte a byte com produção: nenhuma sobra encontrada no Chromium.
Hipótese de trabalho (não confirmada, sem acesso a Safari/iOS real neste ambiente): cards que
aparecem/somem dinamicamente a cada poll de 60s (ao vivo, próximo jogo) fazem o conteúdo
ENCOLHER enquanto a página pode estar rolada perto do final — o Safari no iOS é conhecido por
não recalcular a área rolável até uma interação nova, deixando um vão vazio "fantasma". Aplicado
`nudgeScrollReflow()` (um `scrollBy(0, 0)` imperceptível, força o WebKit a recalcular) depois de
cada ciclo de renderização nos três apps — correção padrão documentada pra esse bug específico,
sem custo/efeito quando a página não está rolada.

## v4.142 — 2026-07-17

### Fixed — caixa de foco feia ao redor do título ao trocar de aba

Eduardo, screenshot: uma caixa azul aparecia em volta de "Projeção do Bolão" (BR2026) depois de
trocar de aba. `showSection()` dá `tabindex="-1"` + `.focus()` no `<h2>`/`<h3>` da seção a cada
troca de aba, de propósito — pra leitor de tela saber que a página mudou — mas o anel de foco
padrão do navegador ficava visível como uma caixa ao redor do texto. Como esse elemento nunca é
alcançado por navegação real via Tab, esconder o anel visual não perde nada de acessibilidade de
verdade (o foco continua movendo pra leitores de tela, só o desenho do anel some). Mesmo
`showSection()` existe nos três apps — corrigido nos três ao mesmo tempo.

## v4.141 — 2026-07-16

### Fixed — cosmético de ranking, propagado a partir de uma auditoria de consistência disparada pelo BR2026/CDB2026

Eduardo pediu consistência entre os três apps depois de várias rodadas de ajuste no card "ao
vivo" do BR2026/CDB2026 ("PRECISAMOS SER CONSISTENTES!"). Auditando o Ranking da Copa pra
comparar, achado real aqui também: o número de posição pra 4º lugar em diante mostrava um ponto
sobrando ("4.", "5."...) — Eduardo: "e tira o '.' se a posicao nao muda no ranking, parece
sujeira". Corrigido nos três apps ao mesmo tempo (mesma linha de código, `rankArrowHtml`/medalha
de posição). Nenhuma fórmula de pontuação tocada — só o texto do número exibido.

## v4.140 — 2026-07-16

### Security — senha do admin atualizada

Eduardo pediu para trocar a senha do admin. `adminPasswordHash` (SHA-256) atualizado; a senha
em texto puro nunca entra no source, como sempre. Mesma senha nos três apps (já compartilhavam
o mesmo hash antes desta troca).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v4.139 — 2026-07-16

### Fixed — badge "Pago"/"Pendente" (e botão "Marcar como pago") vazando da própria caixa em telas estreitas

Eduardo: "the pago is outside the box. You should be very thorough about these knits." Causa
raiz: `.rank-row` é reaproveitado por `renderRanking()` (4 itens: posição, nome, pontuação,
botão) E por `renderParticipants()`/`renderAdminPayments()` (só 3 itens: ícone, nome/detalhe,
badge ou botão) — a mesma classe, duas estruturas diferentes. O breakpoint mobile
(`max-width:900px`) fixa a 3ª coluna do grid em `40px` (dimensionado só para o placar de 1-3
dígitos do ranking); ao cair no mesmo template, o badge/botão do Participantes/Pagamentos era
forçado nesse mesmo espaço de 40px, insuficiente pro texto ("Pendente" tem 8 letras — mediu
79px de largura real, quase o dobro do espaço alocado).

Não reproduzido com precisão pixel-a-pixel no Chromium do sandbox (o texto "Pago" sozinho
ficava só ~1px apertado ali, invisível na prática) — mas a causa raiz é sólida e comprovada por
medição de DOM (`scrollWidth` vs coluna do grid), não é uma correção especulativa: o cálculo do
CSS Grid genuinely reserva só 40px para um conteúdo que precisa de até 79px.

- Nova classe modificadora `.rank-row.participant-row` (aplicada em `renderParticipants()` e
  `renderAdminPayments()`) com `grid-template-columns: 28px 1fr auto;` — 3 colunas reais para a
  estrutura real de 3 itens, badge/botão com largura de conteúdo (`auto`), igual ao desktop
  (que já usa `auto` na coluna e nunca teve esse problema).
- `renderRanking()` continua com `.rank-row` puro (sem a nova classe) — 4 colunas, `40px` fixo
  na pontuação continua correto e intencional ali.

Testado com Playwright: badge "Pendente" mede 79px de largura, cabe com 13px de folga antes da
borda direita da linha (antes: forçado em 40px). Mesma correção nos três apps — `renderAdminPayments()`
só existe na Copa com essa estrutura (BR2026/CDB2026 usam `.admin-row`, não afetado).

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v4.138 — 2026-07-16

### Fixed — endurecido `overflow-x: hidden` para `overflow-x: clip` (side-scroll voltou no BR2026/CDB2026)

Eduardo reportou que o side-scroll horizontal (item já resolvido com `overflow-x: hidden` em
2026-07-16, v4.137) voltou a aparecer no BR2026, mesmo com o `hidden` ainda presente no CSS.
Não foi possível reproduzir com Chromium (sandbox só tem esse engine disponível) em nenhuma
largura testada (390/414/430/440px) — o padrão do bug (screenshot real em iOS Safari, cortando
consistentemente o lado direito de toda linha de botões) bate com um problema documentado do
WebKit: `overflow-x: hidden` sozinho não impede o "rubber-band" horizontal do iOS Safari quando
um ancestral usa `position: sticky` + `backdrop-filter` juntos (exatamente o `.topbar` dos três
apps) — `hidden` ainda cria uma região de scroll programável que o bounce elástico do iOS
consegue acionar; `overflow-x: clip` é mais rígido e não cria essa região.

- `html, body { overflow-x: hidden; }` → `html, body { overflow-x: hidden; overflow-x: clip; }`
  (mesma linha, `hidden` mantido como fallback para navegadores sem suporte a `clip`) — aplicado
  aos três apps (Copa, BR2026, CDB2026) já que os três compartilham a mesma estrutura de topbar
  sticky+blur.

Correção especulativa e propagada por prudência (o mesmo topbar existe nos três apps, o mesmo
bug pode aparecer em qualquer um) — sem uma reprodução real confirmada em WebKit, marcado para
acompanhamento: se o side-scroll persistir depois deste patch, a causa é outra e precisa de
investigação com acesso a um dispositivo real ou WebKit.

Não altera scoring nem lógica de negócio. `audit_scoring.py` (Copa/BR2026/CDB2026): 5/5.

## v4.137 — 2026-07-16

### Fixed — rede de segurança contra rolagem horizontal da página (propagado de achado no BR2026)

Eduardo reportou, via screenshot mobile real do BR2026, que a página "faz scroll para o lado" —
pediu para corrigir em todos. Nenhum dos 3 apps tinha `overflow-x: hidden` no `html`/`body`, uma
rede de segurança padrão contra qualquer elemento (conhecido ou ainda não identificado) forçar
rolagem horizontal da página inteira. Adicionado aqui (Copa, referência canônica) e na página
`classificacao-geral.html`; propagado também ao BR2026 (v1.42) e CDB2026 (v3.31) — ver changelog
de cada app para o achado original (badge "Pago"/checkmark também corrigido nos dois).

Verificado via Playwright que não quebra nenhum scroll horizontal interno intencional
(`.table-scroll`, `.picks-detail`) nem o header sticky.

Não altera scoring nem lógica de negócio. `audit_scoring.py`: 5/5.

## v4.136 — 2026-07-16

### Fixed — "Classificação Geral": prova exaustiva de vivo/eliminado testava resultados fisicamente impossíveis

Eduardo pediu para continuar auditando a v4.135 como estatístico ("challenge it and fix") em vez
de aceitar a correção anterior como definitiva. Achado real, mais sério que os dois da v4.135:

A checagem exaustiva (que decide "Vivo"/"Eliminado" e "Garantido") enumerava, para cada um dos 2
jogos restantes, todo `placar × placar × lado-que-avança` como se os três fossem independentes.
Mas não são — `commitRealResult()` em `app.js` (linha ~2083) mostra que o formulário real do
admin **trava automaticamente** o lado que avança sempre que o placar não é empate
(`pickWinner(ga, gb)` decide sozinho; o `<select>` manual só é consultado quando `ga === gb`, ou
seja, só em caso de pênaltis). A enumeração antiga incluía cenários que o admin **fisicamente não
consegue registrar** — por exemplo 3×1 com o lado B credenciado como avançando — inflando quem
aparecia como "vivo" e, pior, tornando "Garantido" mais difícil de provar do que deveria (o pior
caso adversarial testado incluía ataques que não existem de verdade).

**Impacto real, verificado**: de 23 participantes, só **Arthur Lopes Huller** cruzou um limiar de
exibição — antes aparecia "Vivo" para o 3º lugar com uma chance residual "<0,1%"; com a
enumeração corrigida (só resultados fisicamente registráveis), seu melhor caso matemático é 4º
lugar — ele está **matematicamente eliminado** do pódio do bolão, não vivo com chance rara. Os
demais participantes tiveram pequenos ajustes numéricos no pior/melhor caso interno que não
cruzaram nenhum limiar 1º/2º/3º, então a tabela visível não muda para eles.

**Correção**: novo script de enumeração restringe `advanceSide` a só os valores que o placar
permite (`goalsA > goalsB` força A, `goalsB > goalsA` força B, só empate deixa os dois lados
como opção — replicando `pickWinner()` exatamente). Reduziu o espaço de cenários de 2.000 para
720 (os 1.280 removidos eram todos fisicamente irregistráveis). As porcentagens de Monte Carlo
não precisaram de correção — `simulate_match()` já respeitava essa mesma regra desde a v4.134.

Escrito um verificador automatizado que confere as 69 células da tabela (23 participantes × 3
posições) contra a prova matemática de baixo nível, não só os 2 casos que o Eduardo notou —
0 inconsistências após a correção. Metodologia atualizada na própria página explicando a regra.

Não altera scoring nem lógica de app em produção — só a análise/exibição desta página isolada.
`audit_scoring.py`: 5/5 (scoring não tocado).

## v4.135 — 2026-07-16

### Fixed — "Classificação Geral": chance exibida como "100%" quando não era garantida; "Vivo" sem nenhuma chance visível

Eduardo, dois achados no `classificacao-geral.html` da v4.134, ambos confirmados reais e
corrigidos:

1. **"chance nao pode ser 100% pois ainda nada é 100%"** — correto, e havia um bug real por trás:
   Simone Hirle #4 mostrava "100%" de chance de 1º lugar, mas a checagem exaustiva (enumeração de
   todos os resultados matematicamente possíveis dos 2 jogos restantes, não a simulação) mostra
   que o pior caso dela é 2º lugar — ou seja, existe um resultado real e possível em que ela NÃO
   fica em 1º. O valor real da simulação era 99,93%; um arredondamento pra 0 casas decimais
   (`.toFixed(0)` a partir de 10%) inflou pra "100%" no texto. Corrigido: nenhuma célula não
   comprovadamente garantida pode mais exibir "100%" — o arredondamento agora nunca ultrapassa
   99,9% nesses casos.
2. **"arthur diz vivo mas nao mostra nenhuma chance"** — também correto, causa diferente: Arthur
   está matematicamente vivo pro 3º lugar (existe um resultado válido que o leva lá — daí "Vivo"
   estar certo), mas as 1.500 simulações de Monte Carlo (ponderadas pela força real das seleções)
   nunca bateram nesse resultado específico — é raro, não impossível. A célula mostrava "—"
   (idêntico ao caso realmente impossível), lendo como contradição direta do "Vivo" ao lado.

**Correção de fundo, não só de arredondamento**: a página misturava dois tipos de resposta
matemática diferentes — **prova exaustiva** (existe/não existe um resultado possível) e
**estimativa por simulação** (Monte Carlo) — sob um único número, sem nunca comunicar qual dos
dois era. Adicionado ao script de geração um segundo cálculo exaustivo (pior caso possível, não
só o melhor caso já calculado para o Vivo/Eliminado) e uma classificação de 3 estados por célula:

- **Garantido** — pior caso comprovado ≤ posição (prova, não estimativa) — nunca mais um número.
- **Percentual** — matematicamente possível mas não garantido — estimativa de Monte Carlo, nunca
  exibida como "100%".
- **&lt;0,1%** — matematicamente possível (Vivo) mas as simulações reais não bateram nenhuma vez —
  nunca mais um "—" que contradiz o badge "Vivo".
- **—** — matematicamente impossível, mantido como estava.

Metodologia explicada na própria página (seção "Como foi calculado"). Não altera scoring nem
nenhuma lógica de app em produção — só a análise/exibição desta página isolada.
`audit_scoring.py`: 5/5 (scoring não tocado).

## v4.134 — 2026-07-15

### Added — página estática "Classificação Geral" (não linkada na navegação)

Pedido do Eduardo: uma página compartilhável mostrando vivo/eliminado e chance de 1º/2º/3º lugar
no bolão, corrigindo uma imagem gerada por ChatGPT que circulou no grupo com a fórmula de
pontuação errada.

- Novo arquivo `bolao/classificacao-geral.html` — página estática autocontida (sem dependência de
  `js/app.js`/`config.js`/Supabase em runtime), `noindex,nofollow`, CSP restritiva
  (`default-src 'none'`). **Não linkada em nenhum nav ou índice** — acesso só por URL direta,
  conforme pedido ("link escondido").
- Pontuação, chaveamento e bônus de pódio replicados função por função a partir do código real
  (`scoreEntry`, `matchPoints`, `podiumFromResults`) contra o estado real do Supabase (23
  entradas, resultados oficiais até a semifinal — jogos 73–102). "Vivo/eliminado" é uma checagem
  exaustiva de todos os placares/lados relevantes dos 2 jogos restantes (3º lugar e Final); as
  porcentagens de chance são uma simulação de Monte Carlo (1.500 iterações) usando a tabela de
  força de seleções já existente em `data.js`.
- **É uma foto do momento (15/07/2026), não atualiza sozinha** — precisa ser regerada
  manualmente se quiser refletir resultados novos.
- Não altera scoring, regras de negócio, nem nenhum arquivo do app em produção (`app.js`,
  `config.js` além do bump de versão, `data.js`) — página nova e isolada.
- `audit_scoring.py`: 5/5 (scoring não tocado).

## v4.133 — 2026-07-14

### Fixed — auditoria estilo Big Tech, rodada 2: itens que Eduardo autorizou explicitamente após ver o relatório

Depois do relatório completo da v4.132 (achados sem correção automática), Eduardo pediu
explicitamente "corrija tudo e implemente". Implementado o que não mexe em scoring/regra de
negócio nem em comportamento de produção fora do escopo de "patch pequeno e reversível":

- **Envio de e-mail em massa quebrado para 3+ destinatários**: o intervalo entre envios (3.5s) era
  bem menor que o throttle global do EmailJS (30s), então praticamente todo envio depois do
  primeiro caía silenciosamente no erro. Corrigido usando o próprio `limitRateMs` como intervalo (+
  margem), com o admin vendo uma estimativa de tempo e progresso "(N/total)" durante o envio.
- **Painel de resultado real do admin sem proteção contra sync em segundo plano**: mesmo princípio
  do `pickFormIsDirty()` já usado no formulário de palpite — `resultsFormIsDirty()` novo, compara
  os inputs de placar contra `s.results` e pula a reconstrução enquanto houver edição em
  andamento.
- **E-mail de resultado sem versão em espanhol**: adicionado bloco 🇲🇽 Español completo (tabela de
  pontuação da última partida + ranking), espelhando os blocos PT/EN já existentes.
- **`aria-label` "Fechar" hardcoded em português**: nova chave i18n `close`, adicionada nos 3
  idiomas.
- **Código morto removido**: `renderReopenBanner()` era um no-op permanente desde a reabertura
  automática de julho — removida a função e o call site.
- **Performance do ranking**: `picksTable()` (tabela completa de 32 partidas) agora só é computada
  quando o detalhe de uma entrada é expandido, não em todo resync de 30s para todas as entradas.
- **Alvo de toque mínimo (WCAG) no nav mobile**: `min-height: 44px` — propagado para os 3 apps.

22 testes automatizados novos (`test_round2_fixes.js`), incluindo o envio de e-mail em massa de
ponta a ponta com EmailJS mockado (confirma o Espanhol presente e o timing correto, sem depender
de rede real). `node --check`: OK. `audit_scoring.py`: 5/5 — nenhum valor de pontuação tocado.

## v4.132 — 2026-07-14

### Fixed — auditoria estilo Big Tech (arquitetura, bugs, UX, QA, segurança, mobile, performance, a11y): deploy podia apagar palpite não salvo

Eduardo pediu uma auditoria completa nível Big Tech ("Google, Meta, Amazon ou Microsoft") nos 3
apps, com instrução explícita de reportar achados primeiro e não alterar scoring/regras de
negócio sem autorização. Três agentes de pesquisa (um por app) leram o código real e citaram
arquivo:linha para cada achado; os de maior severidade foram verificados manualmente lendo o
código de novo antes de qualquer correção. Relatório completo entregue a Eduardo fora deste
changelog. Nesta rodada, corrigido só o que era seguro, estreito, reversível e não mexia em
scoring/regra de negócio:

- **`checkVersion()` podia apagar um palpite não salvo:** o poller de deploy (10 min + toda
  troca de aba) já protegia sessão de admin (`isAdminActive()`), mas não protegia um participante
  no meio do preenchimento do bracket — um deploy nesse momento forçava `location.reload()` sem
  aviso, apagando tudo. Adicionado `bracketFormIsDirty()`, mesmo princípio do `pickFormIsDirty()`
  já usado no BR2026/CDB2026 desde a correção do bug de apagar palpite em segundo plano.

Achados de maior risco (ex.: envio de e-mail em massa possivelmente falhando por causa do
throttle do EmailJS, entrada de resultado real do admin sem proteção contra sync em segundo
plano) foram documentados e reportados a Eduardo para decisão, não corrigidos automaticamente —
tocam o caminho de resultado/e-mail em produção, correção nesse ponto é maior risco.
`audit_scoring.py`: 5/5, scoring não tocado.

## v4.131 — 2026-07-14

### Fixed — card "Próximo jogo" não mostrava a data

Auditoria de consistência entre os 3 apps pedida por Eduardo ("próximo jogo mostra dia hora
estádio mas não está consistente nos 3"): o card só mostrava hora (`m.timeET`), sem data — o
BR2026 já mostrava data+hora. Adicionado `formatDate(m.date)` antes da hora, mesmo padrão usado
nos cards de partida do bracket. CDB2026 ganhou um card equivalente pela primeira vez (não tinha
nenhum) — ver changelog do CDB2026 v3.9.

Não é o mesmo bug do CDB2026/BR2026 v3.9 (palpites apagados durante o preenchimento) — a Copa
não tem essa vulnerabilidade: `renderBracket()` (constrói o formulário) e `updateDynamic()`
(atualiza o estado visual a partir do que já foi digitado, chamada em todo `renderAll()`) já são
funções separadas desde o início, então um resync em segundo plano nunca reconstrói os `<input>`
que já existem na tela.

`node --check`: OK. `audit_scoring.py`: 5/5, sem impacto.

## v4.130 — 2026-07-14

### Fixed — CSV/formula injection no export (segurança)

Varredura pedida por Eduardo ("find all possible bugs, as if you were a qa of a betting site").
`csvEscape()` (usado por `backupCsv()` e `masterCsv()`) só escapava aspas duplas — uma célula
começando com `=`, `+`, `-`, `@`, tab ou CR pode ser interpretada como fórmula pelo Excel/Sheets
ao abrir o arquivo exportado (CSV/formula injection, OWASP). Risco real: `entryName`/`payerName`
são texto livre, totalmente controlado por quem preenche o formulário público de inscrição.
Corrigido prefixando essas células com um apóstrofo `'` antes do escape de aspas, forçando
interpretação como texto literal. Mesmo bug encontrado e corrigido nos outros dois apps (ver
changelogs de `br2026` e `cdb2026`).

### Fixed — blocos `catch` vazios sem comentário

Dois `catch (e) {}` (polling de cutoff/versão) não tinham o comentário exigido pelo
`CLAUDE.md` explicando por que o erro é intencionalmente ignorado. Adicionado comentário — sem
mudança de comportamento (falha de rede numa checagem periódica: a próxima tentativa cobre).

Sem mudança de scoring. `audit_scoring.py`: 5/5.

## v4.129 — 2026-07-13

### Fixed — topbar quebrava horizontalmente no mobile (afetava Copa, Brasileirão e Copa do Brasil)

Reportado com screenshots: no celular, a página inteira aparecia cortada/deslocada horizontalmente — texto do cabeçalho e da lista de jogos cortados na borda esquerda.

Causa: o seletor de bolão (`<select id="bolaoSelect">`, adicionado recentemente) foi colocado na mesma linha do grid mobile do topbar junto com a marca e o botão do WhatsApp — três elementos que não encolhem (texto `nowrap`) espremidos numa única linha simplesmente não cabem em nenhuma largura de celular, empurrando a página inteira pra rolagem horizontal. Além disso, `grid-template-columns: 1fr` (e `repeat(N, 1fr)` da navegação) tem largura mínima implícita — não encolhe abaixo do conteúdo sem `minmax(0, 1fr)`, que é o motivo raiz de tudo transbordar mesmo com `flex-wrap`/grid presente.

Fix (aplicado nos três bolões — Copa, Brasileirão e Copa do Brasil):
- Seletor de bolão ganhou linha própria no mobile, em vez de competir por espaço com marca+WhatsApp.
- `grid-template-columns` do topbar e da navegação trocado para `minmax(0, 1fr)` — permite os itens encolherem de verdade em vez de forçar a largura do conteúdo.
- Subtítulo da marca ("Copa 2026" etc.) escondido no mobile — `text-overflow: ellipsis` não funciona num container flex com múltiplos filhos, só cortava o texto sem indicar visualmente.

QA: testado em 9 larguras (320px a 1440px) nos três bolões — zero overflow horizontal em qualquer combinação.

Sem mudança de scoring — só CSS. `audit_scoring.py`: 5/5.

---

## v4.128 — 2026-07-12

### Fixed — spinner nativo removido dos inputs numéricos

Placar é sempre digitado (0-20); o spinner de seta pra cima/baixo do navegador não ajuda e
ocupa espaço à toa em telas estreitas. `input[type=number]::-webkit-inner/outer-spin-button`
suprimido + `-moz-appearance:textfield`, mesmo tratamento aplicado nos três apps.

`audit_scoring.py`: 5/5 — só CSS.

## v4.127 — 2026-07-12

### Fixed — badge/status tokenizado (findings Critical/High autorizados do DESIGN_SYSTEM.md)

Autorização explícita do Eduardo para implementar os 3 findings maiores que ficaram pendentes
em v4.126 (badge/status, ranking, toast — ver `docs/bolao/CONSISTENCY_MATRIX.md` itens 67-69).
Nesta versão, só o que toca a Copa:

- **`.status-chip.done`**: hex literal (`#143d22`/`#72ff9d`) → `rgba(47,229,110,.15)`/
  `var(--green)`/borda `rgba(47,229,110,.3)` — mesmo tratamento visual agora usado em
  `.game-status`/`.paid-badge` no BR2026/CDB2026 (ver changelogs daqueles apps). `.status-chip
  .live`, `.game-card.is-live`, `.game-score.is-live` passaram a usar `var(--red)` em vez de
  `#ff6b6b` hardcoded (mesmo valor, agora tokenizado).
- Nenhuma mudança de estrutura/JS na Copa — o ranking da Copa (`.rank-row`) já era o padrão
  que BR2026/CDB2026 adotaram nesta mesma versão (ver item 68 da matrix); nada a fazer aqui.
- A Copa já tinha o sistema de toast (`.bolao-toast`/`showToast()`) — nada a portar aqui; foi
  BR2026/CDB2026 que ganharam o sistema nesta versão (ver changelogs daqueles apps, item 69).

`audit_scoring.py`: 5/5 — só CSS, nenhuma lógica de scoring/ranking tocada.

## v4.126 — 2026-07-12

### Fixed — 5 patches mínimos de design system (auditoria de UX cross-app)

Findings de baixo risco do `docs/bolao/DESIGN_SYSTEM.md` (auditoria comparativa Copa/BR2026/
CDB2026), CSS-only, sem tocar lógica/JS/scoring:

- **Tokens `--gold`/`--red` adicionados ao `:root`** — a Copa usava hex literal (`#f59e0b`,
  `#ff6b6b`) onde BR2026/CDB2026 já usam variável; os hex existentes não foram trocados (fora
  do escopo de patch mínimo), só o token passou a existir para uso futuro. `--red` da Copa
  ficou `#ff6b6b` (o valor já usado ao vivo em produção), não `#f87171` como BR2026/CDB2026 —
  trocar o valor mudaria a cor renderizada em produção, registrado como diferença residual em
  `CONSISTENCY_MATRIX.md`.
- **Input/select/label migrados para o padrão BR2026/CDB2026** (2 dos 3 apps já usavam):
  fundo `var(--bg3)` em vez de `var(--bg)`, `border-radius:9px` em vez de `11px`, foco por
  `border-color` em vez de `outline`, label em `UPPERCASE`/`var(--muted)` em vez de
  sentence-case com cor hardcoded `#cfe6dd`. Cutoff de entrada já passou há duas semanas
  (tournament em fase de mata-mata) — campos de formulário hoje só são usados pelo admin,
  risco de mudar a aparência agora é baixo.
- **`h1,h2,h3` normalizado** — nenhuma mudança aqui (a Copa já tinha essa regra; ela virou o
  padrão que BR2026/CDB2026 adotaram, ver changelogs daqueles apps).
- **`.rules-table td` padding**: `8px 10px` → `7px 10px`, igual aos outros dois apps.
- **Botão sticky (`.sticky-submit button`)**: adicionado `min-width:200px` (já existia em
  BR2026/CDB2026).

Findings maiores da mesma auditoria (badge/status com 3 implementações diferentes, estrutura
do card de Ranking divergente, sistema de toast ausente em BR2026/CDB2026) **não foram
implementados nesta rodada** — tocam lógica de render em JS, patch maior, aguardando
autorização específica (ver `docs/bolao/AUDIT_PROTOCOL.md` — findings Critical/High ainda
precisam ser apresentados antes de corrigidos).

`audit_scoring.py`: 5/5 — nenhuma mudança de scoring/JS.

---

## v4.125 — 2026-07-12

### Fixed — alinhamento do topbar (todos os bolões)

- `align-items: center` + `align-self: center` adicionados em todos os breakpoints do topbar grid
- Copa mobile: gap ajustado para `6px 8px` (row gap menor entre linhas do topbar)
- `audit_scoring.py`: 5/5.

---

## v4.124 — 2026-07-12

### Fixed — topbar Copa: switcher sempre top-right em mobile e desktop

- Mobile `1fr auto auto`: brand | WA | switcher na row 1 — WA volta a ficar visível
- Desktop `1fr auto auto auto`: brand | WA | lang | switcher (col 4 = far right)
- Posição do switcher agora consistente com BR2026/CDB2026 em todas as resoluções
- `audit_scoring.py`: 5/5.

---

## v4.123 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC HIGH-1**: lockout admin migrado de `localStorage` para `sessionStorage`
- **SEC MEDIUM-2**: `escapeHtml()` em `p.goalsA`/`p.goalsB` no audit log (XSS no painel admin)
- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS H1**: `.bolao-switcher` agora tem `grid-column/grid-row` explícitos no topbar (estava sumindo no desktop)
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v4.122 — 2026-07-12

### Fixed — card "Próximo jogo": bandeiras no meio + local do jogo

- Flags movidas para o centro: `France 🇫🇷 × 🇪🇸 Spain` (era `🇫🇷 France × 🇪🇸 Spain`)
- Local do jogo (`m.venue` + `m.city`) exibido abaixo do horário com ícone 📍 (classe `.hero-next-venue`)
- Mesma correção no path de jogo adiado
- `audit_scoring.py`: 5/5.

---

## v4.121 — 2026-07-12

### Novo — seletor de bolão no header da Copa do Mundo

Adicionado dropdown "Alternar bolão" no header da Copa do Mundo (já existia no BR2026 e CDB2026). Permite navegar entre os três bolões — Copa do Mundo, Brasileirão 2026 e Copa do Brasil 2026 — sem precisar lembrar a URL manualmente. Estilo consistente com os outros bolões (pill border-radius, sem `appearance` nativo, cor do theme). `audit_scoring.py`: 5/5.

---

## v4.120 — 2026-07-12

### Fixed — caixa de lances "voltava sozinha pra cima" ao tentar rolar

Reportado logo após o v4.119 ir ao ar: ao tentar rolar a caixa de lances pra ver os mais antigos, ela voltava pro topo sozinha.

Causa: o card ao vivo é reconstruído do zero a cada 1 segundo (pra atualizar o relógio correndo) e a cada 60s (novo placar da ESPN) — cada reconstrução cria a caixa de lances como um elemento novo, zerando a posição de rolagem que a pessoa tinha acabado de definir. Como o relógio atualiza a cada segundo, a rolagem praticamente nunca "grudava".

Fix: `captureLivePlaysScroll`/`restoreLivePlaysScroll` guardam a posição de rolagem de cada caixa antes da reconstrução e a devolvem depois, tanto no card "ao vivo" (aba Palpites/próximo jogo) quanto na aba Jogos.

QA: reproduzi o bug isoladamente (rolei a caixa, esperei os ticks do relógio, confirmei que voltava a zero na versão antiga), confirmei que o fix resolve exatamente isso, e rodei de novo toda a bateria de testes do v4.119 (varredura de regressão em todas as abas, 13 payloads maliciosos, isolamento entre duas partidas ao vivo simultâneas) — tudo passou de novo, incluindo através dos ticks do relógio. `audit_scoring.py`: 5/5.

---

## v4.119 — 2026-07-12

### Novo — lances minuto a minuto (gols, cartões, substituições) no card ao vivo

Pedido do Eduardo: uma caixa compacta logo abaixo dos artilheiros, uma linha por lance (gol/cartão/substituição), altura fixa (~3 linhas visíveis) e rolagem para ver o resto — sem quebrar o layout do card.

Usa exatamente os mesmos dados que o placar ao vivo já busca a cada 60s (`comp.details` da ESPN) — nenhuma chamada de API extra. Ícone em vez de texto para o tipo de lance (⚽🟨🟥🔄), então não depende de idioma nenhum; nomes de jogador vêm da ESPN como estão.

QA muito rigoroso antes de subir, já que mexe no card ao vivo (visto por todo mundo durante cada partida):
- Varredura de regressão em todas as abas (Palpites, Ranking, Jogos, Probabilidades, Regras, Admin) com placar ao vivo mockado e sem — zero erros de console além de um warning de CSP pré-existente (confirmado idêntico rodando a mesma varredura sem essa mudança).
- 13 payloads maliciosos/malformados testados contra a função de extração (`details` ausente/nulo/não-array, entradas nulas, time ausente, atletas ausentes ou não-array, relógio ausente, tipos de evento desconhecidos como "Offside"/"Corner Kick", substituição com atletas nulos misturados) — todos passaram sem erro e sem quebrar o placar/relógio ao vivo.
- Confirmado que tipos de evento não reconhecidos não geram nenhum falso positivo (a caixa nem aparece).
- Testado com 12 lances simultâneos — a caixa mantém a altura de ~3 linhas, resto rola, card não estica.
- Testado com duas partidas ao vivo simultaneamente — cada card mostra só os próprios lances, sem misturar dados.
- `python3 bolao/scripts/audit_scoring.py`: 5/5 — a mudança não toca em nenhuma função de pontuação.

---

## v4.118 — 2026-07-11

### Changed — layout centralizado no card de partidas (Jogos)

Cards de jogo agora exibem `Nome | 🏴 | Score | 🏴 | Nome` em fileira única — antes era `🏴 Nome | Score | Nome 🏴` com times pressionados para as bordas. Mudança puramente cosmética (HTML + CSS); scoring, lógica e dados intocados. audit_scoring.py: ✓ 5/5.

## v4.117 — 2026-07-08

### Fixed — cards da aba Jogos (e formulário de resultado do admin) empilhavam em 3 blocos no mobile

Reportado com screenshot: no celular, cada partida virava 3 blocos separados de altura total — nome do time A, depois o placar, depois o nome do time B, cada um numa linha própria e com sua própria borda/respiro — mesmo para nomes curtos como "Spain" e "Belgium". Causa: uma regra de mobile (`@media max-width: 500px`) trocava `.game-teams` de grid de 3 colunas (nome × placar × nome, numa linha só, igual ao desktop) para grid de 1 coluna — empilhando tudo. A mesma regra existia para `.teams`, usado tanto no formulário de palpites quanto no formulário de resultado do admin (o que o Eduardo usa toda vez que lança um resultado, geralmente do celular).

Fix: manteve a partida numa linha só no mobile também (igual ao desktop) — só reduziu fonte/gap para caber, e deixou o nome do time quebrar em 2 linhas dentro da própria coluna quando for muito comprido (ex: "Bosnia and Herzegovina"), em vez de forçar a linha inteira a virar 3 blocos.

QA feita com Playwright/Chromium local antes de subir: comparei screenshots antes/depois em 390px, 360px (Android comum) e desktop; testei o caso de nome de time bem longo; conferi que a versão desktop (que já estava boa) não mudou nada. Sem mudança de scoring — só CSS.

---

## v4.116 — 2026-07-08

### Fixed — "Ver palpites" fechava sozinho depois de alguns segundos

`renderRanking()` reconstrói o HTML de todos os cards de "Ver palpites" do zero toda vez que roda — inclusive na sincronização automática de 30s, ao voltar pra aba, e no novo check de versão (v4.113). Cada reconstrução recriava o painel de detalhe já fechado (`hidden`) por padrão, sem lembrar que o usuário tinha acabado de abrir um — por isso fechava sozinho pouco depois de clicar.

Fix: `_openRankDetails`, um Set que guarda quais entradas estão com o painel aberto no momento, igual ao mecanismo que já existia pro placar ao vivo da aba Jogos (`_openLiveDetails`) — `renderRanking()` agora consulta esse Set ao reconstruir cada painel, em vez de sempre começar fechado.

---

## v4.115 — 2026-07-07

### Novo — "Ver palpites" mostra o time real (com o palpite original entre parênteses) + destaque de quem avança no placar ao vivo

Pedido dos participantes, via Eduardo, depois que as oitavas terminaram:

**1. "Ver palpites" mostra o time real das rodadas seguintes.** Antes, a linha de cada partida futura (quartas em diante) mostrava o time que o PRÓPRIO palpite da pessoa previa (às vezes já sabidamente errado, ou ainda "Winner Match N" cru se faltava palpite de rodada anterior). Agora, uma vez que o time real de um confronto é conhecido pelo resultado oficial, ele aparece primeiro — com o palpite original entre parênteses só quando ele foi diferente do que aconteceu de verdade. Exemplo: se alguém apostou no Canadá e o Marrocos avançou de verdade, a linha mostra "Marrocos (Canadá)". Se o palpite bateu, mostra só o nome, sem repetição redundante. **Puramente visual — a pontuação nunca usou esses nomes para calcular pontos** (sempre compara resultado real com o palpite pelo ID da partida, goalsA/goalsB/advanceSide), só a exibição na tabela mudou. O recibo (comprovante de envio) e o "pódio previsto" continuam mostrando exatamente o que a pessoa previu originalmente, sem essa substituição — são registros históricos e devem continuar assim.

**2. Placar ao vivo: time escolhido para avançar agora aparece em negrito.** Na tabela "Pontos provisórios" (aba Jogos/próximo jogo, com o jogo rolando), cada linha só mostrava o placar previsto (ex: "1×1") — em caso de empate no palpite de gols, não dava pra saber qual time a pessoa escolheu pra passar de fase. Agora o nome do time escolhido aparece embaixo do placar, em negrito/verde.

Rodei `audit_scoring.py` de novo depois dessa mudança — sem impacto (esperado, é só exibição).

---

## v4.114 — 2026-07-06

### Fixed — placar ao vivo, probabilidades e detecção automática de resultado nunca funcionaram a partir da 2ª metade das oitavas (M95+)

Reportado com Argentina × Egypt (M95): o site mostrava "Em andamento" mas sem placar, sem relógio, sem barra de probabilidade — e o ranking não reagia. Causa raiz: `data.js` guarda os times das oitavas de final (M89-94) e da fase de grupos com nome real, mas M95 em diante (M95, M96, quartas, semis, disputa de 3º, final) ficam **para sempre** como `"Winner Match 87"` / `"Loser Match 101"` no arquivo — nunca são reescritos com o nome real do time, mesmo depois de decididos. Toda função que casava esses jogos com a ESPN por nome de time tinha um filtro que ignorava qualquer time ainda em formato `"Winner/Loser Match N"` — então essas partidas eram silenciosamente excluídas do rastreamento ao vivo, para sempre, a partir de M95.

Como isso nunca tinha aparecido antes: é a primeira vez que o campeonato chega numa partida desse grupo (M95+) — R32 e a primeira leva de oitavas (M89-94) sempre tiveram nome de time real no `data.js` desde o início, então o bug estava latente sem nunca ter sido exercitado.

Sete funções tinham exatamente essa mesma lacuna, todas corrigidas resolvendo `"Winner/Loser Match N"` pelo resultado oficial (mesmo mecanismo já usado — e correto — no rótulo "Próximo Jogo") antes de comparar com a ESPN:

- `mapEspnToLiveScores` — placar/relógio ao vivo nunca populava
- `computeMatchStatusHints` — detecção de adiamento (v4.112) também nunca funcionava
- `extractEspnOdds` — odds do DraftKings/barra de probabilidade pré-jogo ficavam sempre vazias
- Card "ao vivo" do "Próximo Jogo" — mostraria `"Winner Match 87"` como nome do time e bandeira errada assim que o placar ao vivo passasse a funcionar
- `renderGames` (aba Jogos) — mesma coisa, nome cru aparecendo na lista de jogos
- `preMatchProbBarsHtml` / `liveProbBarsHtml` — barra de probabilidade em branco
- `fetchEspnMatchStats` — chutes no alvo/posse de bola nunca populavam (degradação silenciosa, sem erro visível)
- `mapEspnToMatches` — botão "Atualizar via ESPN" do admin nunca detectava um resultado de M95+ automaticamente
- `showMatchEndBanner` — mostraria `"Winner Match 87"` no aviso de "partida encerrada"

O ranking não estar "reagindo" durante o jogo é esperado — pontos só entram quando o resultado oficial é salvo, nunca durante a partida (pontuação provisória só aparece dentro do detalhe expandido "Pontos provisórios"). Isso não muda.

`send_result_email.py` (o script Python que roda no GitHub Actions) já fazia essa resolução corretamente em `_resolve_team` — só o caminho client-side (JS, no navegador) tinha a lacuna.

---

## v4.113 — 2026-07-06

### Fixed — ranking ainda ficava desatualizado (Brasil × Noruega) em abas já abertas antes das correções anteriores

Reportado de novo depois do v4.108/v4.111: ranking sem o resultado atualizado fora do modo anônimo. As correções anteriores (Supabase vencendo o cache local, service worker sem cache HTTP, resync no bfcache) já cobrem qualquer carregamento novo da página — mas uma aba que já estava aberta desde ANTES dessas correções irem ao ar continua rodando o JavaScript antigo, com a lógica de merge antiga, para sempre. Código já carregado na memória do navegador não se autoatualiza sozinho — só um reload de verdade da página resolve, e nada no código antigo sabia que devia fazer isso.

Fix: `startVersionPolling()` — a cada 10 minutos (aba visível, sem sessão de admin ativa para não atrapalhar alguém digitando um resultado), busca `config.js` e recarrega a página sozinha se o `siteVersion` publicado for diferente do carregado. Comparação é sempre por igualdade exata (nunca um "maior/igual que") — o mesmo cuidado do fix do loop de reload do v4.109, para não repetir aquele bug.

A partir de agora, qualquer aba (mesmo uma esquecida aberta por dias) se autocorrige sozinha em até 10 minutos após qualquer novo deploy — ninguém mais deve precisar fechar e reabrir manualmente por causa de cache.

---

## v4.112 — 2026-07-06

### Fixed — "Próximo Jogo" pulava para o jogo seguinte enquanto o atual ainda estava rolando ou tinha sido adiado

Reportado com o México × Inglaterra (M92, oitavas), adiado por causa do clima: o card "Próximo Jogo" trocou para Spain × Portugal como se o jogo do México já tivesse terminado, quando na verdade nunca chegou a começar.

Duas causas, dois fixes:

1. **Corte de tempo curto demais:** `nextScheduledMatch()` considerava um jogo "definitivamente encerrado" 135 minutos após o pontapé inicial, e o filtro de placar ao vivo em `renderNextMatch()` usava 150 minutos — nenhum dos dois contava com prorrogação (30 min) + pênaltis (sem tempo fixo, historicamente até ~20-30 min), que somados facilmente passam de 150 min. Fix: os dois cortes foram unificados numa única constante `MATCH_ASSUMED_OVER_MS` de 210 minutos.
2. **Adiamentos não eram detectados (o pedido do Eduardo — "deve puxar ao vivo da fonte se o jogo está rolando; isso vai acontecer de novo"):** o site não tinha nenhum jeito de saber que um jogo foi adiado — só comparava o relógio contra o horário fixo do `data.js`. Agora `computeMatchStatusHints()` casa cada partida ainda não resolvida com o evento real da ESPN por nome de time (ignorando a data cadastrada, já que um jogo adiado tem uma data real diferente na ESPN), e se a ESPN reportar status "adiado/atrasado/suspenso" antes do jogo começar, o card mostra "Adiado" em vez de pular pro próximo jogo da chave — a fonte ao vivo passa a valer mais que a suposição por tempo decorrido.

Não muda scoring nem estrutura do ranking — só quando/como o card de "próximo jogo"/"ao vivo" decide que uma partida acabou ou nunca começou.

---

## v4.111 — 2026-07-06

### Fixed — mobile: navegador normal ainda mostrava dado antigo (incógnito funcionava)

v4.108 já tinha corrigido o merge para o Supabase vencer o cache local, mas dois problemas independentes ainda podiam prender um celular numa versão velha mesmo com essa correção:

- **`sw.js` (service worker):** a estratégia "network-first" para HTML fazia só `fetch(e.request)`, que ainda consulta o cache HTTP do próprio navegador antes de ir na rede. Safari no iOS (e alguns proxies de operadora) cacheiam de forma mais agressiva que desktop — então mesmo com o handler "network-first" rodando, o navegador podia devolver um `index.html` antigo do cache, travando o usuário nos `app.js?v=<sha antigo>` para sempre. Fix: `fetch(e.request, { cache: 'no-store' })`, forçando ida real à rede. Versão do cache do SW também subiu (`bolao-sw-v1` → `v2`) para descartar entradas antigas.
- **bfcache do iOS Safari:** ao voltar para uma aba em segundo plano, o WebKit pode restaurar a página do bfcache sem disparar `visibilitychange` de forma confiável (bug conhecido do WebKit) — a página nunca refaz o `debouncedReload()` e fica presa no estado em memória do último carregamento real. Fix: listener em `pageshow` com `event.persisted` forçando um resync sempre que isso acontece.

Nenhum dos dois precisa de ação do usuário — o SW novo se instala sozinho na próxima visita e o `pageshow` cobre daí em diante.

---

## v4.110 — 2026-07-05

### Fixed — probabilidades: "USA" e "United States" apareciam como entradas separadas

Polymarket usa nomes próprios que divergem dos nomes canônicos do site (ex: "USA" vs "United States", "Cabo Verde" vs "Cape Verde"). O partial match genérico não detectava todos os casos. Fix: adicionado `POLY_ALIASES` em `fetchPolymarketOdds()` — normaliza os nomes na ingestão para que "USA" → "United States" antes de qualquer comparação.

Aliases mapeados: USA, Cote d'Ivoire, Côte d'Ivoire, Cabo Verde, Bosnia-Herzegovina, Bosnia & Herzegovina, Congo DR, DRC, Korea Republic.

---

## v4.109 — 2026-07-05

### Fixed — auditoria: reload loop infinito + 7 quick wins

**🔴 Crítico — reload loop infinito:** `startReopenPolling()` comparava o `cutoffIso` do servidor com `>= "2026-07-04"` — sempre true pois o config atual tem exatamente essa data → `location.reload()` a cada 60s para todos os visitantes. Fix: só recarregar quando o servidor publicar um `cutoffIso` diferente do carregado (`m[1] !== CONFIG.cutoffIso`).

**🟡 Médio — setInterval de 1s em background:** `renderNextMatch()` rodava com aba escondida. Adicionado guard `if (!document.hidden)`. Removido `renderReopenBanner()` (no-op) do loop.

**🟡 Médio — strings hardcoded em PT:** "Nenhum resultado knockout encontrado", "Nenhum resultado novo encontrado via ESPN", "Nenhum resultado novo para aplicar", "Jogo encerrado!", "Resultado sincronizado via ESPN ✓", "avança" — movidas para `i18n.js` em pt-BR/es/en-US.

**🟢 Baixo — Scotland duplicada em data.js:** segunda entrada no objeto `flags` removida.

---

## v4.108 — 2026-07-05

### Fixed — cache stale: resultados do Supabase agora sempre vencem o localStorage

Problema: quando o script Python salvava um resultado corrigido no Supabase, o browser local continuava mostrando o valor antigo porque o merge (`mergeStates`) usava local-wins para resultados. Só na próxima sessão sem cache é que o valor correto aparecia.

Três mudanças:
- `mergeStates` aceita `{ preferRemoteResults: true }` — quando ativo, o Supabase vence para a chave de resultado duplicada (ao invés do local)
- `loadRemoteState()` agora usa `preferRemoteResults: true` — resultados do Supabase sempre sobrescrevem o cache local ao sincronizar
- Intervalo de sync automático reduzido de 90s → 30s
- Aba Ranking dispara `debouncedReload()` ao ser aberta — ranking sempre busca dado fresco ao ser visualizado

Comportamento de save preservado: `saveRemoteState()` continua usando local-wins (admins do browser escrevem sobre Supabase, não o contrário).

---

## v4.107 — 2026-07-05

### Fixed — probabilidades: times eliminados sumiam apenas do MC, não do Polymarket

Times eliminados tinham probabilidade 0 na simulação Monte Carlo, mas podiam continuar aparecendo na tabela de probabilidades se o Polymarket ainda exibisse odds > 0.5% para eles (API lenta a atualizar). Corrigido: `renderProbs()` agora constrói um `eliminated` set a partir dos resultados oficiais salvos e o usa em dois lugares — ao filtrar as chaves do Polymarket que entram em `allTeams`, e no `.filter()` final das linhas — garantindo que nenhum time eliminado apareça, independente do estado da API do Polymarket.

---

## v4.106 — 2026-07-05

### Fixed — cronômetro definitivo (4 bugs de uma vez)

**Bug 1 — layout quebrado com d>0 (`four` class):** O `renderNextMatch()` gerava 4 células (Dias/Horas/Min/Seg) quando o próximo jogo era no dia seguinte, mas o CSS de `.next-match-timer` só tem 3 colunas por padrão. O 4° bloco (Dias) transbordava pra uma segunda linha em mobile e desktop. Corrigido: adicionada a classe `four` quando `d > 0` — o CSS já existia (`.next-match-timer.four { grid-template-columns: repeat(4,1fr) }`), só nunca era aplicado pelo JS.

**Bug 2 — nomes de times "Winner Match X" nas Quartas e em diante:** `renderNextMatch()` usava `m.teamA`/`m.teamB` diretamente do `data.js`, que para QF+ são templates como "Winner Match 89". Adicionado `officialWinnersMap(s)` que percorre os resultados salvos no estado e resolve os slots em ordem, e `renderNextMatch()` agora resolve os nomes antes de exibir.

**Bug 3 — prazo das Oitavas invisível (e de todas as rodadas futuras):** O countdown de prazo estava dentro de `#heroCard { display: none }` (CSS permanente) — nunca aparecia na tela. Corrigido: `updateCountdown()` agora usa `#reopenBanner` para mostrar o countdown quando `cutoffIso` é futuro, ou esconde o banner quando passou. Isso garante que prazos das QF/SF/Final apareçam automaticamente quando Eduardo atualizar `cutoffIso` no `config.js`.

**Bug 4 — badge "AO VIVO" piscando após o jogo encerrar:** Quando o jogo termina, a API do ESPN pode demorar vários minutos para atualizar o status de "in" para "post". Nesse intervalo, `_liveScores` ainda tinha dados e o card pulsava. Corrigido: `renderNextMatch()` agora filtra `_liveScores` excluindo (a) partidas cujo resultado já foi salvo no estado (`advanceSide` confirmado) e (b) partidas cujo kickoff foi há mais de 150 minutos — ambos indicam que o jogo terminou, independentemente do delay da ESPN.

**Limpeza:** Removidos `ESTIMATED_REOPEN_UTC`, `M88_KICKOFF_UTC`, `fmtCdMs()` e toda a lógica M88-específica de `renderReopenBanner()` (obsoleta desde 4 jul). `renderReopenBanner()` é agora um no-op; `updateCountdown()` gerencia o `#reopenBanner` para todas as rodadas futuras.

Auditoria de pontuação: mudanças são só de UI/display. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.105 — 2026-07-04

### Added — desempate por ordem alfabética (Z→A) só pra exibição
- Eduardo perguntou por que "Roberta" aparecia depois de "Simone" no ranking, mesmo empatadas (111 pts). Resposta: elas (junto com Rodrigo Hajj) estavam totalmente empatadas nos 3 critérios de desempate já existentes (total, placares exatos, acertos de campeão/vice/3º) — sem um 4º critério, a ordem entre empatados ficava só na ordem em que as entradas foram salvas, sem nenhum significado.
- A pedido do Eduardo: adicionado um 4º nível, só de exibição (não muda a posição/medalha, que continua compartilhada) — quando tudo mais empata, ordena por nome da entrada em ordem alfabética invertida (Z→A). "Tem que estar tudo exatamente igual" — implementado com a mesma lógica (maiúsculas, comparação simples por código de caractere, sem colação de idioma) tanto no site (`renderRanking()`) quanto no e-mail (`send_result_email.py`), e verificado que os dois produzem exatamente a mesma ordem pro cenário real reportado (Simone Hirle #4, Rodrigo Hajj, Roberta).
- `audit_scoring.py` também ganhou um caso de teste novo cobrindo esse 4º nível (usando esses mesmos três nomes), já que a regra pede pra atualizar o audit sempre que a cascata de desempate mudar.
- Auditoria de pontuação: mudança é só de ORDEM DE EXIBIÇÃO entre empatados — não muda quem está empatado, quantos pontos cada um tem, nem a posição/medalha. `audit_scoring.py` re-rodado — 5/5 continuam passando (incluindo o novo caso).

## v4.104 — 2026-07-04

### Fixed — flash da aba Palpites ao dar refresh
- Eduardo: "Quando da refresh na pagina aparece por uns segundos a pagina de entradas. Acho que é melhor fazer default do botão de ranking." Causa: o HTML estático sempre marcava `#entry` (Palpites) como a aba `active` por padrão — só depois que `js/app.js` termina de carregar e rodar (`showSection(isPastCutoff() ? "ranking" : "entry")`) é que a aba correta (Ranking, já que o prazo encerrou) aparece. Nesse intervalo, a página de Palpites piscava na tela.
- Corrigido exatamente como o Eduardo sugeriu: trocado o `active` estático do HTML de `#entry` pra `#ranking`, já que o site está fechado pro resto deste torneio (sem mais fase de entrada esperada). Confirmado direto no HTML bruto (antes de qualquer JS rodar) que `#ranking` já vem marcado como a aba ativa.
- Auditoria de pontuação: mudança é só de qual aba aparece primeiro. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.103 — 2026-07-04

### Fixed — sobrou uma caixa vazia onde era o hero
- Eduardo: "Ainda ficou uma caixa ali…", com print mostrando uma barra escura vazia (só com a setinha ▼ de recolher) logo abaixo do menu. Causa: v4.102 escondeu todo o CONTEÚDO do hero (texto de intro, badge America250) e, como o prazo já passou, a caixa de contagem regressiva também já estava escondida (lógica da v4.100) — mas o CARD em si (fundo, borda, padding) continuava sendo renderizado, agora vazio.
- Corrigido: `#heroCard` inteiro escondido via CSS. A página agora vai direto do menu pro card "Próximo jogo".
- Auditoria de pontuação: mudança é só de exibição/CSS. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.102 — 2026-07-04

### Changed — badge America250 removido do hero
- Eduardo: "Pode esconder o america 250 também tire toda a caixa. Agora ficou melhor!" — depois de esconder o texto de intro do hero (v4.101), pediu pra remover o badge/logo America250 também. Escondido via CSS (`#heroBody .america250-badge`), mesma abordagem das outras duas remoções — a caixa de contagem regressiva continua normal.
- Auditoria de pontuação: mudança é só de exibição/CSS. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.101 — 2026-07-04

### Changed — hero simplificado + ranking realmente em uma linha só no mobile
- Eduardo pediu pra esconder o texto de intro do hero ("Bolão Copa 2026" / "Preencha seu bracket e participe." / "Valor: US$ 5 por entrada..."). Escondido via CSS (`#heroBody .eyebrow`, `h1`, `p[data-i18n="heroText"]`) — o badge America250 e a caixa de contagem regressiva continuam aparecendo normalmente.
- No ranking mobile (v4.100 já tinha reduzido de 3 blocos de linha pra 2), Eduardo pediu pra ir além: posição, nome, pontuação e o botão "Ver palpites" numa linha só, sem desalinhar dependendo do tamanho do placar. A pontuação agora tem uma coluna de largura FIXA (não mais `auto`/dependente do conteúdo) — assim o botão sempre começa exatamente no mesmo X, seja o placar "0" ou "117". Verificado com Playwright: posição do botão idêntica (mesmo pixel) em 3 placares de tamanhos diferentes (1, 2 e 3 dígitos); nome de entrada bem longo quebra em várias linhas normalmente sem desalinhar pontos/botão; desktop conferido sem mudanças (a alteração é só no breakpoint mobile).
- Auditoria de pontuação: as duas mudanças são só de exibição/CSS. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.100 — 2026-07-04

### Fixed — mensagens de reabertura ficavam permanentemente presas em "aguardando M88"
- Eduardo: "Agora que os palpites acabaram pode esconder essas duas boxes". A caixa do hero ("Abrindo em breve… Verificando resultado do M88…") e o banner de reabertura ("🔒 M88 encerrado — site reabre em instantes! Recarregar agora") só existiam pra cobrir o período entre o M88 terminar e o site reabrir pras Oitavas — mas nenhum dos dois tinha uma condição de saída pra quando esse período TAMBÉM já tivesse passado. Resultado: depois que o prazo de edição das Oitavas (12h ET, 4 jul) também encerrou, as duas caixas continuavam mostrando pra sempre a mesma mensagem desatualizada de "aguardando M88", mesmo o M88 já tendo acabado há horas.
- Corrigido: as duas agora reconhecem quando o `cutoffIso` já foi atualizado pelo `auto_reopen.py` pra depois de 4 de julho (ou seja, o M88 já reabriu o site uma vez) E esse novo prazo também já passou — nesse caso, escondem a caixa inteira em vez de repetir a mensagem de "M88 encerrado, reabre em instantes" pro resto do torneio. Verificado com Playwright em 4 cenários: aguardando M88 ainda (mostra normal), fechado mas checando M88 (mostra "Abrindo em breve"), janela das Oitavas aberta (esconde as duas, mostra contagem normal até o prazo), e totalmente resolvido — as duas somem (o caso do Eduardo).

### Fixed — ranking muito grande no mobile
- Eduardo: "veja se tem como redesenhar o ranking no mobile pra ficar mais simples de ver. Ta muito grande a caixa agora!" — cada entrada ocupava 3 blocos de linha empilhados (posição+nome, pontos numa linha própria, botão "Ver palpites" ocupando a largura toda numa terceira linha), deixando só ~1 entrada visível por tela no celular.
- Corrigido só via CSS (mobile, sem tocar em nenhuma lógica de pontuação/ranking/dados): posição, nome e pontos agora dividem a mesma linha (pontos ao lado do nome em vez de embaixo), e o botão "Ver palpites" volta ao tamanho compacto natural dele em vez de esticar a largura toda — o card cai de 3 blocos de linha pra 2, sem mudar nada na estrutura/HTML gerado. Verificado com Playwright: 5 entradas cabem confortavelmente na tela onde antes cabia 1; nome de entrada bem longo continua quebrando limpo sem colidir com os pontos; botão "Ver palpites" testado e confirmado que continua abrindo o detalhe dos palpites normalmente; desktop conferido pixel-idêntico ao que já era (fora do breakpoint mobile).
- Auditoria de pontuação: as duas mudanças são só de exibição/CSS, não tocam em `data.js`, scoring, ranking ou `send_result_email.py`. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.88 — 2026-07-04

### Deadline + nav simplificada

- `cutoffIso` e `r32CutoffIso` ajustados para `2026-07-04T12:00:00-04:00` (4 jul, meio-dia ET — 1h antes do 1º jogo das Oitavas)
- Botões "Participantes" e "Pagamento" ocultos na nav (site está no modo Ranking+Palpites agora)
- audit_scoring.py: 5/5 ✓

## v4.87 — 2026-07-04

### Reabertura para picks de Oitavas de Final

- `cutoffIso` atualizado para `2026-07-05T14:00:00-04:00` — site reaberto após M88 (Colombia vs Ghana)
- `cutoffLabel` atualizado para "Oitavas de Final — prazo: 5 jul, 14h ET"
- O poller de reopen detecta `cutoffIso >= "2026-07-04"` e recarrega automaticamente para quem estava na página fechada
- A partir de `r32CutoffIso` (4 jul, 01h ET): modo edição-apenas ativa (sem novas entradas)
- audit_scoring.py: 5/5 ✓

## v4.86 — 2026-07-04

### Fixed — visual mobile na aba Jogos (e no formulário de palpites)
- Eduardo: "Tem como fazer um visual melhor no mobile para a aba jogos? No pc parece ok…". Com uma screenshot real do celular, três problemas ficaram claros:
  1. **Ordem de bandeira/nome trocava entre os dois times**: o time A sempre mostrava "🏳️ Nome", mas o time B mostrava "Nome 🏳️" — porque bandeira+nome eram uma única string de texto (não elementos separados), então o CSS de mobile não conseguia reordenar. No desktop isso fica ok porque as bandeiras ficam nas bordas externas (visual intencional); empilhado em uma coluna só no mobile, virava um zigue-zague estranho.
  2. **Caixa vazia enorme** onde o placar ainda não saiu: o placeholder "×" herdava o mesmo box com bastante padding e fonte 22px usado pro placar de verdade, ficando um retângulo praticamente vazio e chamativo.
  3. **Texto cortado nas barras de probabilidade** ("United State...", "gypt 17%"): a barra de 3 seções fica bem estreita no celular e o texto era só cortado com reticências no meio da palavra.
- Corrigido: bandeira e nome agora são `<span>`s separados (não mais uma string concatenada), permitindo o CSS reordenar por breakpoint sem tocar no HTML gerado — resultado: os dois times sempre mostram "bandeira nome" no mobile, consistente, e o desktop continua pixel-idêntico ao que já era (verificado por screenshot antes/depois). O placeholder "×" agora encolhe pra um texto pequeno e discreto só no mobile — o placar de verdade (ao vivo ou finalizado) continua com o destaque de sempre. As barras de probabilidade agora quebram linha em vez de cortar o texto no meio.
- Mesma classe de bug encontrada e corrigida também no **formulário de palpites** (aba Palpites): o card de cada confronto do mata-mata não tinha NENHUMA regra de mobile — ficava sempre 3 colunas lado a lado mesmo em telas estreitas, apertando nomes longos tipo "Bosnia and Herzegovina". Agora empilha em coluna única no mobile, consistente com a aba Jogos. Também alinhado o painel de resultados reais do Admin (`resultsAdmin`), que usava o mesmo HTML sem as classes certas.
- Verificado com Playwright em várias larguras (390px mobile, 1280px desktop) e com o nome de time mais longo do bracket ("Bosnia and Herzegovina") — cabe numa linha só, sem cortar.
- Auditoria de pontuação: mudança é só visual/CSS. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.85 — 2026-07-04

### Removed — botão "Verificar reabertura"
- Eduardo perguntou o que era o botão "Verificar reabertura" no banner de reabertura (mostrado enquanto o site está fechado esperando o M88 terminar) e, depois de eu explicar que ele só faz `location.reload()` — um atalho manual redundante, já que o site já checa sozinho a cada 60s se o prazo foi atualizado — pediu pra remover.
- Removido o botão e a chave de i18n `reopenCheckBtn` (não usada em mais nenhum lugar) nos três idiomas. O texto "🔴 M88 ao vivo — aguardando resultado final" continua aparecendo normalmente; só o botão saiu.
- Auditoria de pontuação: mudança é só de UI. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.84 — 2026-07-04

### Edição de palpites: audit log + email confirmação + bloqueio de novas entradas na janela R16

**Audit log interno:**
- `state.auditLog[]` registra cada edição com timestamp, entry name, email, e diff pick-a-pick (antes × depois). Máximo 200 entradas. Visível no painel Admin → "Log de Alterações".

**Email de confirmação ao participante (somente):**
- Ao salvar edição, envia email ao participante com tabela de alterações (M89 France×Argentina: 2×1 → 1×0, etc.). Sem cópia para o admin.
- Fire-and-forget: UI reseta imediatamente, email é enviado em background. Toast "Confirmação enviada para email@..." aparece quando o envio completa.

**Bloqueio de novas entradas na janela R16:**
- `isR32Window() && !_editingEntry` → botão Salvar desabilitado, campo nome readOnly. Toast de aviso se tentar salvar. Apenas edições via código de comprovante são aceitas.

**audit_scoring.py: 5/5 ✓**

## v4.83 — 2026-07-04

### Corrigido — número de comprovante nunca muda ao editar palpites
- `saveEntry()` em modo de edição agora declara `entryName` e `createdAt` explicitamente a partir de `_editingEntry`, em vez de confiar no spread implícito. O `receiptCode` depende de ambos; tornar explícito impede que qualquer alteração futura no bloco quebre essa garantia por acidente.
- Auditoria de pontuação: `audit_scoring.py` 5/5 ✓

## v4.82 — 2026-07-03

### Fixed — `podiumPicks` ReferenceError silencioso quebrava ver palpites no ranking
- `picksTable()` chamava `podiumPicks(entry)` mas a função se chama `finalPodiumForEntry`. Toda vez que um usuário clicava em uma entrada no Ranking para ver os palpites, a função lançava um `ReferenceError` silencioso: a tabela de palpites ficava em branco e as medalhas 🥇🥈🥉 nunca apareciam. Corrigido para `finalPodiumForEntry(entry)`.

### Melhorado — sistema de notificações toast (sem mais alertas bloqueantes)
- Adicionada função `showToast(msg, type, durationMs)` e CSS `.bolao-toast` com animação de entrada e 4 variantes: `success` (verde), `error` (vermelho), `warn` (laranja), `info` (azul).
- ~25 chamadas `alert()` não-bloqueantes convertidas para toasts: confirmações de salvar entrada, login/logout admin, envio de emails, sync ESPN, demo data, delete de entrada, etc.
- Mantidos como `alert()`: validação de formulário (erros que precisam de atenção imediata antes de continuar) e popup bloqueado.
- Mantidos como `confirm()`: todas as ações destrutivas (deletar, limpar dados, sobrescrever palpites).
- Auditoria de pontuação: `audit_scoring.py` rodado — 5/5 checks passam ✓

## v4.78 — 2026-07-03

### Fixed — relógio sem teto de segurança na prorrogação (2º tempo) causou subida sem parar
- No mesmo jogo (Austrália x Egito), depois que os pênaltis começaram de verdade, Eduardo pegou o relógio mostrando "120:07 (+1)" e subindo — a v4.77 já reconhecia o estado "AET-pens" (fim da prorrogação, prestes a bater pênaltis), mas assim que os pênaltis realmente começaram, a ESPN mudou pra um status/texto que ainda não tínhamos visto/reconhecido, e esse relógio continuou subindo até se corrigir sozinho minutos depois.
- Causa raiz, achada revisando o código com mais cuidado: o ramo do `formatMatchClock` que usa o `period` da ESPN como fonte de verdade (introduzido na v4.75) **não tinha nenhum teto** — diferente do fallback antigo, que sempre limitou o acréscimo mostrado a 8 minutos. Pra período 4 (2º tempo da prorrogação) especificamente, isso é grave: depois desse período não existe mais "próximo tempo real" pro relógio crescer de forma legítima — só dá em pênaltis ou fim de jogo — então, sem teto, qualquer status que a gente não reconheça deixa a interpolação local subir pra sempre.
- Corrigido: o período 4 agora usa o mesmo teto realista de 8 minutos que o fallback sempre teve, mas em vez de só esconder a anotação "+N" (que ainda deixaria o número base subindo puro), o relógio agora **para de vez** em "120:00 (+8)" quando o teto é alcançado — não sobe mais, esteja a ESPN mandando o texto de status certo ou não. Isso funciona como uma segunda camada de proteção, independente de reconhecer o texto exato que a ESPN usa: mesmo se a v4.77 (e futuras tentativas de reconhecer o texto exato dos pênaltis) não pegar algum status novo que a ESPN inventar, o relógio nunca mais vai subir pra sempre — no pior caso, ele congela num valor razoável em vez de continuar subindo na tela do Eduardo.
- Verificado com Playwright simulando exatamente o cenário real: relógio em "120:07 (+1)" (igual ao print do Eduardo) e depois mais de 20 minutos de "tempo real" passando com um status nunca visto antes — o relógio sobe até "128:00 (+8)" e trava ali, não continua subindo. Todos os testes de regressão anteriores (v4.73, v4.75, v4.76, v4.77) continuam passando.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.77 — 2026-07-03

### Fixed — relógio realmente parou nos pênaltis (v4.76 não pegou o estado real da ESPN)
- Eduardo mandou o JSON real da ESPN direto do jogo Austrália x Egito que estava ao vivo nesse exato momento (não deu pra pegar sozinho — `site.api.espn.com` está bloqueado pela política de rede do sandbox, confirmado nos logs do proxy). Isso permitiu confirmar, com dado real, o que a v4.76 tinha adivinhado sem conseguir testar contra a API de verdade.
- O jogo estava no estado exato do fim da prorrogação, prestes a ir pra pênaltis: `status.period` ainda era **4** (não 5 como eu tinha assumido), `status.type.name` era `"STATUS_END_OF_EXTRATIME"`, e `status.type.detail`/`shortDetail` era `"AET-pens"` — com o relógio (`status.clock`) já parado em 7200s (120:00) fixo. A detecção da v4.76 só reconhecia a palavra "penalt" no texto — "AET-pens" não contém essa palavra, então esse estado passava batido e o relógio continuava interpolando pra frente sem parar. Esse é o bug real que o Eduardo viu.
- Corrigido: a detecção de pênaltis agora também reconhece `type.name` contendo `"END_OF_EXTRATIME"` ou `"SHOOTOUT"`/`"PENALT"`, e o texto de status agora também inclui `type.detail` (antes só olhava `description` + `shortDetail`), com o regex ampliado pra pegar variações como "pens", "shootout" e "end of extra time" além de "penalt"/"pênalti"/"penales".
- Confirmado: nesse payload real não existe nenhum campo separado pro placar da disputa de pênaltis (só `score` normal, "1"/"1") — reforça a decisão de não ter implementado ainda o "1 (0)" do Google; ainda não dá pra confirmar o nome do campo sem uma amostra durante a disputa em si.
- Verificado com Playwright usando o payload real exato que o Eduardo mandou: relógio mostra "Pênaltis" imediatamente em vez de continuar subindo, e continua assim mesmo simulando vários minutos depois no mesmo estado. Todos os testes de regressão anteriores (v4.73, v4.75, v4.76) continuam passando.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.76 — 2026-07-03

### Fixed — relógio não parava na disputa de pênaltis
- Eduardo mandou print do placar ao vivo do Google (Austrália x Egito, 1-1, "Live — Penalties", sem relógio nenhum rodando) e reportou que o nosso relógio continuava correndo depois que o jogo foi pra pênaltis. Causa: nada no código tratava a fase de pênaltis como uma pausa — o relógio continuava interpolando segundo a segundo pra sempre, já que não existe mais tempo de jogo real depois do fim da prorrogação.
- Corrigido igual ao padrão já usado pro intervalo: quando `status.period === 5` (pênaltis, o mesmo campo da ESPN usado no fix do v4.75) — ou, como fallback, quando o texto de status da ESPN menciona "penalty"/"pênalti"/"penales" — o card mostra "Pênaltis" (i18n em `pt-BR`/`es`/`en-US`) parado no lugar do relógio, igual ao "Penalties" estático do Google, e a interpolação por segundo é desligada nesse estado (mesmo tratamento que já existia pro intervalo).
- Verificado com Playwright: relógio mostra "Pênaltis" assim que a disputa começa, continua mostrando "Pênaltis" (não sobe pra "125:00" nem nada do tipo) mesmo simulando vários minutos depois, e o fallback por texto (quando `period` não vem no payload) também funciona.
- Não implementado ainda: o placar da disputa de pênaltis em si — tipo o "1 (0)" do Google, onde o número entre parênteses é o placar dos pênaltis separado do placar normal. Não achei, sem acesso à API ao vivo pra confirmar, qual campo exato a ESPN usa pra isso — prefiro não adivinhar um nome de campo e arriscar mostrar um número errado. Se você conseguir me mandar um exemplo do JSON ao vivo durante uma disputa de pênaltis (ou eu confirmar o campo de outro jeito), dá pra adicionar.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.75 — 2026-07-03

### Fixed — relógio ao vivo: correção pela raiz, não mais um patch heurístico
- Eduardo reportou de novo que o relógio "ainda não está funcionando" e pediu algo tão bom quanto o placar ao vivo do Google. As correções anteriores (v4.59, v4.62, v4.73) eram todas heurísticas: adivinhar em qual tempo o jogo está observando o número bruto do relógio da ESPN (que é um contador contínuo, sem noção de 1º/2º tempo) e um texto de status nem sempre confiável. Isso deixava buracos: um acréscimo real de mais de 8 minutos no 2º tempo era escondido pelo teto de segurança; o intervalo só era "lembrado" se fosse observado dentro de uma janela de 3 minutos do marco de 45 min (fácil de perder com polling a cada 60s); e o prorrogação (105/120 min) nunca tinha essa mesma proteção.
- Correção pela raiz: a própria ESPN já manda, no mesmo payload, `status.period` — um número que diz exatamente em qual tempo o jogo está (1 = 1º tempo, 2 = 2º tempo, 3/4 = prorrogação, 5 = pênaltis). É o mesmo tipo de sinal que uma fonte de dados profissional (a que provavelmente alimenta o placar do Google) fornece — não precisa mais ser reconstruído por adivinhação. Agora `formatMatchClock` usa esse campo como fonte de verdade sempre que presente: o marco de tempo (45/90/105/120) vem direto do `period`, não de qual valor o relógio "parece" ter cruzado. Isso corrige o problema definitivamente, no instante em que a ESPN reporta a virada de tempo — sem depender de ter "visto" o intervalo, sem teto arbitrário de 8 minutos escondendo acréscimos reais e longos, e cobrindo a prorrogação do mesmo jeito.
- A lógica antiga (marco por valor do relógio + confirmação por observar o intervalo) continua no código como fallback — só entra em ação se `status.period` não vier no payload por algum motivo. Sem regressão possível: no pior caso, volta a se comportar exatamente como a v4.73.
- `mergeLiveClock` (anti-retrocesso do relógio entre polls) também passou a usar a mudança de `period` como sinal de "novo tempo começou de verdade", em vez de só adivinhar pelo valor bruto do relógio.
- Verificado com Playwright: cenário exato reportado (55:11, ESPN já mandando period=2 desde o primeiro poll, sem nunca ter visto o intervalo) → relógio limpo, imediato. Também testado: acréscimo real de 9 minutos no 2º tempo (que a v4.73 esconderia pelo teto de 8 min) → mostrado corretamente; prorrogação (period=3, 100:00) → limpo, não confunde com acréscimo do 2º tempo; acréscimo real dentro da prorrogação → mostrado corretamente; e o fallback antigo (sem `period` no payload) → continua funcionando como antes, sem quebrar.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo, não toca em `data.js`, scoring ou tiebreak. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.74 — 2026-07-03

### Fixed — deploy do GitHub Pages falhando ("Deployment failed, try again later")
- Eduardo reportou: "deploy / Deploy GitHub Pages / deploy / Failed in 15 seconds". Causa: duas rotinas de deploy disputando a mesma publicação a cada push — o job automático do GitHub Pages ("pages build and deployment", ativo porque o Source do repo está em "Deploy from a branch") e um workflow customizado `.github/workflows/pages.yml` (adicionado por outra sessão, v4.69) usando `actions/deploy-pages@v4`, que só funciona sem conflito se o Source do repo for "GitHub Actions". Como isso não foi alterado, os dois disparavam pro mesmo commit ao mesmo tempo e um sempre falhava com "Deployment failed, try again later" — confirmado nos logs exatos do job via GitHub Actions.
- Correção: removido `.github/workflows/pages.yml`, voltando ao único caminho de deploy que funcionou a sessão inteira (o automático). Eduardo escolheu essa opção em vez de mexer manualmente nas configurações do GitHub Pages.
- Auditoria de pontuação: mudança é puramente de infraestrutura de deploy, não toca em `data.js`, scoring ou `send_result_email.py`. `audit_scoring.py` re-rodado mesmo assim — 5/5 continuam passando.

## v4.73 — 2026-07-03

### Fixed
- **Relógio mostrava "(+11)" de acréscimo do 1º tempo com o jogo já 10 minutos dentro do 2º tempo (Austrália x Egito)**: `formatMatchClock` não tinha limite pra quanto tempo depois de um marco (45/90/105/120 min) ainda considerava "acréscimo" — como o `clockSeconds` da ESPN é um contador contínuo sem noção de "qual tempo estamos", um valor tipo 55:11 (55 min de jogo, ~10 min dentro do 2º tempo) continuava sendo lido como "45:00 + 10 min de acréscimo do 1º tempo" pra sempre, mesmo estando claramente no 2º tempo. Duas correções: (1) um teto de 8 minutos — além disso, presume-se que já viramos de tempo, mostra o relógio puro sem "(+N)"; (2) mais precisa: quando o app observa diretamente o intervalo (`isHalftime`) perto de um marco, grava isso por partida (`localStorage`) e nunca mais considera aquele marco específico como possível acréscimo em andamento, mesmo poucos minutos depois de retomar o jogo. Verificado com Playwright reproduzindo o cenário exato reportado (55:11 sem ter visto o intervalo → mostra limpo) e mais 3 cenários de regressão (acréscimo real do 1º tempo, retomada logo após intervalo confirmado, acréscimo real do 2º tempo perto dos 90 min) — todos corretos.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo. Rodei `audit_scoring.py` mesmo assim — 5/5 continuam passando.

## v4.72 — 2026-07-03

### Fixed — badge gigante era cache, não bug de código
Eduardo mandou foto do laptop mostrando o badge America250 enorme, dominando o hero card. Verificado: o código-fonte atual em `main` já estava correto — testei um checkout limpo de `origin/main` (`021c1ae`) com carregamento totalmente sem cache e o badge renderiza pequeno e certo (34px de altura, exatamente como pretendido). Causa real: dois commits ficaram com o MESMO número de versão "v4.71" — o meu (fix do badge, `7e590ca`) e um fix de layout de navegação de outra sessão que chegou ~1 minuto depois (`021c1ae`) sem bumpar `siteVersion` de novo. Como o cache-busting (`?v=`) depende desse número, o CSS mudou de conteúdo duas vezes sob a mesma URL — o navegador do Eduardo (ou algum cache intermediário) pegou uma cópia inconsistente durante essa janela de transição. Bump pra v4.72 força uma URL de cache-busting garantidamente nova.

## v4.71 — 2026-07-03

### Fixed
- **Badge "America 250" quebrado (Eduardo): "O logo america 250 nao ficou legal, arrume ele"**. Causa: um bug de seletor CSS — `.america250-badge span:first-child` pretendia estilizar só a bandeirinha, mas essa combinação (descendente + `:first-child`) também batia em `.a250-label` ("AMERICA"), já que ele também é o primeiro filho do SEU PRÓPRIO pai (`.a250-text`). Isso fazia "AMERICA" herdar 17px em vez dos 7px pretendidos, com especificidade maior que a regra certa — o texto ficava gigante, colidindo com as estrelas, e "250" quebrava linha. Também investigado: os fogos de artifício não são bug, só estão programados pra só aparecerem no dia 4/jul (`getMonth()===6 && getDate()===4`) — testado forçando a data e confirmado que funcionam normalmente.
- Tentei achar o logo oficial via Wikimedia Commons pra usar em vez de recriar em CSS, mas o sandbox não tem acesso de rede pra esses domínios (403 da política de rede). Eduardo mandou o PNG oficial diretamente — extraí o fundo preto (transparência via luminância), recortei e redimensionei (`bolao/assets/america250-logo.png`), e troquei o badge inteiro (que antes era bandeira+texto+estrelas em CSS) pra usar a imagem oficial de verdade.
- Auditoria de pontuação: mudança é só visual (imagem estática), não mexe em resultado/ranking. `audit_scoring.py` re-rodado — 5/5 continuam passando.

## v4.65 — 2026-07-03

### Fixed — M85 resultado em data.js
- Switzerland 2-0 Algeria (Final) — ESPN já mostrava "post"; data.js ainda estava "Scheduled"

### Added — banner de reabertura com contagem regressiva
- `#reopenBanner`: aparece enquanto o site está fechado (cutoffIso no passado)
- Mostra M86/M87/M88 com status dinâmico (⏳ / 🔴 ao vivo / ✅ concluído)
- Conta regressiva em segundos até o kickoff do M88 (Colombia vs Ghana 21:30 EDT)
- Após M88 kick off: "ao vivo — aguardando resultado"
- Quando resultado do M88 chega no Supabase: "site reabre em instantes" + botão recarregar
- `startReopenPolling()`: verifica config.js a cada 60s; auto-reload quando `auto_reopen.py`
  comitar `cutoffIso = 2026-07-04T12:00:00-04:00` no GitHub Pages
- Informa prazo: palpites R16 disponíveis até 12:00 EDT (4 jul)

### Verified — bracket 100% até a Final
- M89 Canada vs Morocco · M90 Paraguay vs France · M91 Brazil vs Norway
- M92 Mexico vs England · M93 Spain vs Portugal · M94 Belgium vs United States
- M95 W(M87) vs W(M86) · M96 W(M85=Switzerland) vs W(M88) · QF/SF/3rd/Final corretos
- Sem conflitos de chaveamento · Audit 5/5

## v4.62 — 2026-07-03

### Fixed
- **Relógio ao vivo continuava andando durante o intervalo de verdade (Portugal x Croácia)**: mesmo depois do v4.61 tornar o relógio monotônico (nunca volta pra trás), um relógio genuinamente PAUSADO (intervalo, uma parada longa qualquer) ainda parecia "atrás da extrapolação" pra essa lógica — e como não existe mais nenhum teto (o v4.61 removeu o cap de 150s de propósito, pra resolver o problema de saltos pra trás), o relógio ficava subindo pra sempre durante a pausa inteira, sem se autocorrigir nunca. Corrigido com uma detecção que não depende de adivinhar o texto de status da ESPN pra intervalo: compara o `clockSeconds` bruto entre dois polls reais — se passou bastante tempo real mas o relógio do jogo mal andou, está pausado, e tanto a extrapolação armazenada quanto a interpolação exibida na tela param completamente até o relógio voltar a se mexer de verdade. Compatível com a reescrita monotônica do v4.61 — só entra em ação quando uma pausa real é detectada, sem interferir na lógica de reset de período deles.
- Auditoria de pontuação: mudança é só de exibição do relógio ao vivo, não mexe em resultado/ranking. Rodei `audit_scoring.py` mesmo assim — 5/5 continuam passando.

## v4.64 — 2026-07-03

### Added — odds DraftKings via ESPN (zero custo, zero chamadas novas)

A pesquisa da madrugada revelou que `fetchEspnFixtures()` já traz o campo `competitions[0].odds[0].moneyline.home/away/draw.close.odds` no mesmo JSON que sempre foi buscado — apenas nunca foi lido.

- `americanToImplied()`: converte odds americanas (+135, -550) em probabilidade implícita
- `extractEspnOdds(events)`: varre o payload ESPN e popula `_espnOddsCache` com probabilidades vig-stripped (home + draw + away normalizados para somar 1) para cada jogo identificado no bracket
- Barras de pré-jogo agora têm 3 fontes em prioridade: **1) DraftKings via ESPN** → 2) Polymarket normalizado → 3) ELO+Poisson. DraftKings é publicado 1-2 dias antes do apito para jogos concretos (times definidos).
- Nota "Barras: odds DraftKings via ESPN" aparece na tab Probabilidades quando dados estão carregados.

Dados confirmados para R16: Paraguay 5% / ET 14% / France 81%, Brazil 51% / ET 25% / Norway 23%, Spain 49% / ET 27% / Portugal 24%, etc. Audit: ✓ 5/5.

## v4.63 — 2026-07-02

### Added — Polymarket como fonte de probabilidades

**Tab Probabilidades:** coluna "📈 Mercado" ao lado do nosso Monte Carlo. Preços ao vivo do mercado "World Cup Winner" do Polymarket (event 30615) — mostra o que o mercado de previsão coloca em cada time. Diferença clara: nosso ELO tinha Brasil alto, Polymarket mostra França 34%, Argentina 20%, Brasil 6%. Cache de 60 min (configurável em `config.js`).

**Barras de pré-jogo nos jogos do mata-mata:** agora usam a probabilidade derivada do Polymarket via normalização — P(A avança) = poly_A / (poly_A + poly_B) — em vez do modelo ELO puro. A fatia ET/Pens é estimada como min(22%, 2×min(advA,advB)) para que jogos muito desequilibrados (França vs Paraguai) não aloquem probabilidade absurda de prorrogação. Carregado no init da página, barras já aparecem com dados do mercado desde o primeiro acesso.

`fetchPolymarketOdds()`, `polyMatchProb()`, coluna `.poly-bar` (âmbar) na tabela de probs. Scoring não foi tocado — audit 5/5 passando.

## v4.62 — 2026-07-03

## v4.61 — 2026-07-02

### Fixed — relógio ao vivo monotônico + email em quasi-tempo-real após jogo

**Relógio ao vivo (`mergeLiveClock`):** O antigo guard de `behindBy < 150s` bloqueava a extrapolação apenas para lags pequenos — se o feed da ESPN atrasasse mais de 2m30s (comum na Copa com VAR, transições de período, tab em background), o relógio pulava para trás visivelmente. A nova lógica torna o relógio **monotônico durante o jogo**: nunca volta, independentemente do lag do ESPN. O único momento em que aceita uma queda é quando a diferença parece um reset de período legítimo (clock cai de próximo a um múltiplo de 45 min para perto de 0), cobrindo início do 2T, início da prorrogação e início do 2T da prorrogação.

**Email quasi-tempo-real (`run_auto` + `any_copa_match_live`):** O modo `--auto` agora detecta quando há um jogo ao vivo após não encontrar resultados novos. Nesse caso, em vez de sair e esperar o próximo cron (até 10 min), fica em loop de polling a cada 2 min por até 80 min até o jogo terminar — detectando o final em até ~2 min em vez de até 10. O `timeout-minutes` do workflow foi ajustado para 100 min para comportar esse loop.

## v4.60 — 2026-07-02

## v4.59 — 2026-07-02

### Changed
- **Relógio ao vivo mostra acréscimos e intervalo, estilo Google**: pedido depois de um print do placar do Google (Portugal x Croácia, "46:03 (+4)" no intervalo). Agora, quando o relógio passa de 45/90/105/120 minutos, mostra "(+N)" com os minutos de acréscimo em vez de só continuar contando (ex: "46:03 (+2)"). Durante o intervalo (detectado via status da ESPN), mostra "Intervalo" em vez de um relógio andando — antes o relógio interpolado continuava subindo durante o intervalo todo, o que não fazia sentido (o jogo não está rolando). Aplica no card "ao vivo" do hero e no chip de status da aba Jogos. O cálculo de probabilidade ao vivo (minuto da partida) foi desacoplado do texto exibido, usando o `clockSeconds` bruto diretamente, pra não quebrar com o novo texto "(+N)"/"Intervalo".

## v4.58 — 2026-07-02

### Added — auditoria automática antes de CADA envio de email, não só uma vez
Eduardo, depois da auditoria do v4.57: "acho que a gente deveria fazer isso antes de um email ser enviado, logo depois que o jogo termina... precisa rodar uma auditoria completa pra garantir 1000% de precisão... não quero ouvir os usuários me dizendo de novo que não entendem a pontuação... isso nunca pode quebrar... todo pedido de mudança que eu fizer, revise se a função de pontuação continua funcionando, mesmo que seja só pra dizer que nada mudou." Duas coisas viraram regra permanente:

- **`bolao/scripts/audit_scoring.py` (novo)**: bateria de 5 checagens estáticas (bracket bate com `data.js`, simulação de torneio completo com bracket perfeito, bônus+4º lugar presentes, validação de placar bate com o site, ordem de desempate correta) rodável isolada (`python3 audit_scoring.py`) ou importada. `send_result_email.py --auto` agora roda essa auditoria ANTES de tocar em qualquer coisa — se falhar, não salva nem envia email nenhum (saída não-zero, falha visível no GitHub Actions).
- **Checagem em tempo real por partida**: além do duplo-check de estabilidade já existente (v4.55), cada resultado "confirmado" agora passa por `check_match_is_real()` (data do evento não pode ser futura; times não podem ainda ser um slot "WN"/"LN" não resolvido) e `check_result_shape()` (placar 0–20, `advanceSide` só A ou B) antes de ser salvo ou disparar email. Isso mira especificamente o problema que já aconteceu antes (ver "Resultados somente do banco de dados" no changelog): um resultado aparecendo pra uma partida que não tinha realmente acontecido ainda.
- Testado com simulação completa: bracket antigo (quebrado, pré-v4.57) reintroduzido numa cópia isolada confirma que a auditoria realmente pega os 9 confrontos errados; teste de integração ponta a ponta simula `run_auto()` inteiro com um resultado real (salva + envia, 1 destinatário) e com um resultado com data no futuro (corretamente bloqueado, zero salvamentos, zero emails).
- **Regra permanente documentada no `CLAUDE.md`**: essa é a parte do site que nunca pode quebrar — tem dinheiro real em jogo. A partir de agora, toda mudança no repositório (relacionada a pontuação ou não) deve rodar `audit_scoring.py` e reportar o resultado explicitamente, mesmo que seja só "nada mudou, auditoria continua passando".

## v4.57 — 2026-07-02

### Fixed — auditoria estilo Big 4 no pipeline de resultado/ranking (Eduardo pediu depois de reclamações sobre o ranking)
Disparado por participantes questionando o ranking (print do WhatsApp da Aline: "Wu tava em 7 atras do ewerton e agora o vini pegou meu lugar" — na verdade só faltava o resultado da Espanha, já resolvido). Eduardo pediu uma auditoria completa dos resultados/ranking, com a exigência de sempre verificar isso antes de qualquer PR daqui pra frente. Todos os problemas encontrados estavam isolados em `send_result_email.py` (o script Python do cron de email) — o site (`app.js`) já estava correto em todos os pontos abaixo, usa uma única fonte de verdade (`scoreEntry()`) em todo lugar (ranking, CSV, master export, email manual do admin).

- **[Crítico] Chaveamento das Oitavas/Quartas estava errado em 9 dos 16 confrontos**: `MATCH_TEAMS` no script tinha pares diferentes do bracket real em `data.js` (ex: M89 estava codificado como "vencedor M73 x vencedor M74", mas o confronto real é "vencedor M73 x vencedor M76"). Isso não geraria um resultado errado — a busca por esse confronto na ESPN simplesmente nunca bateria, então os emails automáticos das Oitavas em diante parariam silenciosamente de funcionar assim que a Fase de Grupos... digo, a Rodada de 32 terminasse (R16 começa 4/jul, faltavam só 2 dias). Corrigido e verificado programaticamente contra `data.js` (todos os 32 confrontos batem agora) e com simulação completa do torneio (bracket "perfeito" resolve o campeão corretamente através das 4 rodadas de mata-mata).
- **[Alto] Pontos de bônus (campeão/vice/3º/4º: 25/15/10/5 pts) nunca eram somados no total do email** — só eram usados como critério de desempate, nunca como pontos de fato. O site já soma esses pontos no total (`scoreEntry`). Assim que alguém acertasse um palpite de pódio (o que só é possível perto da final), o total mostrado no email ficaria MENOR que o total real do site — divergência que só apareceria bem na reta final, quando o dinheiro do prêmio está em jogo.
- **[Alto] 4º lugar computado mas descartado**: as duas funções de resolução de pódio calculavam a variável `fourth` internamente mas nunca a incluíam no dicionário retornado — o bônus de 4º lugar (+5) nunca conseguia ser concedido a ninguém, mesmo que a lógica acima estivesse corrigida.
- **[Baixo] Validação de placar mais permissiva no Python que no site**: `_parse()` aceitava negativos e valores acima de 20 que o formulário do site (`parseScore`) já rejeita — endurecido pra bater exatamente com a mesma regra (dígitos, 0–20).

Todas as correções verificadas com testes automatizados: comparação programática linha a linha entre `MATCH_TEAMS` e `data.js`, simulação de torneio completo com bracket perfeito (campeão resolve corretamente através de 4 rodadas, bônus = 55 pts, total bate com o esperado), e `build_html()` ponta a ponta com múltiplas entradas e resultados mistos.

## v4.56 — 2026-07-02

### Changed
- **Lista de artilheiros dividida em duas colunas, uma pro lado de cada time (Eduardo):** "identado ao lado do time... assim se os dois times fizerem gol você tem um na esquerda e um na direita, tipo o Google." Antes era uma lista única centralizada com uma bandeirinha por linha; agora os gols do time A ficam na coluna esquerda e os do time B na direita, alinhados como os nomes dos times logo acima — quem fez o gol fica óbvio pela posição, sem precisar de bandeira em cada linha.

## v4.55 — 2026-07-02

### Fixed
- **Placar ao vivo podia congelar indefinidamente ("mostrando jogo em andamento a noite toda")**: `extractGoalEvents()` (novo em v4.53, artilheiro + minuto) rodava sem proteção dentro de `mapEspnToLiveScores()` — se a ESPN mandasse qualquer item inesperado dentro de `competitions[].details` (ex: entrada nula no array), a função lançava uma exceção ANTES de `_liveScores` ser atualizado, travando o placar/relógio ao vivo de TODAS as partidas indefinidamente (não só o artilheiro), até a página ser recarregada. Agora `extractGoalEvents()` nunca lança exceção — qualquer formato inesperado só derruba a lista de artilheiros daquela partida, sem afetar placar/relógio. Reproduzido com Playwright (array `details` com entradas nulas/inválidas) — placar ao vivo continua atualizando normalmente.
- **Cron de email automático tinha sido removido sem querer**: um commit anterior (v4.40, 1/jul) trocou o envio automático de emails por um fluxo manual (admin clica "Enviar emails agora" ou dispara o GitHub Action manualmente) — mas isso exige alguém ativo o tempo todo. Restaurado o agendamento automático (`*/10 min` durante a janela de jogos) em `auto_results.yml`, mantendo o disparo manual disponível também.
- **Duplo-check antes de mandar email de resultado**: `send_result_email.py --auto` agora espera 20s e busca a ESPN de novo antes de confirmar um resultado como definitivo — só salva no Supabase e envia email se o placar e o time que avança baterem nas duas consultas. Evita mandar um resultado errado caso a ESPN marque "final" um instante antes de uma correção tardia (VAR, ajuste de estatística).

### Added
- **Barra de probabilidade no card "Próximo jogo" do topo**: até agora só aparecia na aba Jogos (pré-jogo) e no card "ao vivo" — faltava no hero quando não há nenhum jogo rolando, então ninguém via a probabilidade antes do jogo começar de fato. Extraído `preMatchProbBarsHtml()` (compartilhado com a aba Jogos, mesma conta) e adicionado ao card do hero.

## v4.54 — 2026-07-02

### Fixed
- **Banner de "jogo encerrado" mostrava um botão de admin pra todo mundo**: Eduardo pegou um screenshot mostrando o banner com "🔐 Admin → enviar emails" aparecendo para um participante comum. O banner é público (dispara pra qualquer visitante quando um jogo termina), mas o botão navegava pra seção Admin — expondo um fluxo de admin pra todo o bolão. Agora só quem já está logado como admin vê algum botão de ação ali (o de "Enviar emails agora"); todo mundo mais só vê o aviso "Jogo encerrado! M{id} encerrado" e o X pra fechar.

## v4.53 — 2026-07-02

### Added
- **Nome de quem fez o gol e o minuto no placar ao vivo**: pedido depois de um print do placar ao vivo do Google (Espanha x Áustria mostrando "M. Oyarzabal 36'" / "P. Porro 66'" abaixo do placar). O app agora extrai os gols (`competitions[].details`) do mesmo evento da ESPN que já usamos pro placar/relógio — sem chamada de rede extra — e mostra artilheiro + minuto tanto no card "ao vivo" do topo quanto no card do jogo na aba Jogos. Best-effort: se a ESPN não mandar esse detalhe pra uma partida específica, a lista simplesmente não aparece, sem quebrar o resto do card.

## v4.52 — 2026-07-02

### Fixed
- **Posições da tabela de pontuação ao vivo fora de ordem**: o número da "Pos." e a ordem visual das linhas usavam critérios de desempate diferentes quando duas entradas empatavam na pontuação provisória geral — o número da posição desempatava por ordem de cadastro, mas a linha em si era ordenada pelos pontos daquela partida específica, então "Pos. 3" podia aparecer visualmente acima de "Pos. 2". Agora os dois usam exatamente o mesmo critério (pontuação provisória geral, desempatada pelos pontos da partida ao vivo), então a lista sempre aparece em ordem 1, 2, 3... batendo com o número mostrado.

## v4.51 — 2026-07-02

### Added
- **Estimativa própria de probabilidade agora usa estatísticas reais do jogo**: quando o modelo de probabilidade da ESPN não estiver disponível, o app tenta buscar chutes a gol e posse de bola do jogo (via `site.api.espn.com/.../summary`, mesmo domínio já usado pro placar — mais provável de funcionar que a API de probabilidade especializada) e usa isso pra ajustar o cálculo próprio (70% força pré-jogo + 30% domínio do jogo em andamento), em vez de depender só do rating estático dos times + tempo decorrido. Essas estatísticas não aparecem em lugar nenhum da interface — são só um dado de entrada a mais pro cálculo. Se a busca falhar, cai pro cálculo estático de sempre, sem quebrar nada.

## v4.50 — 2026-07-02

### Changed
- **Barra de probabilidade nunca fica totalmente vazia**: em vez de esconder o rótulo inteiro em fatias estreitas (< 12%), agora sempre mostra pelo menos o "N%" — só o nome do time/rótulo é que some quando não cabe. O tooltip ao passar o mouse continua com a informação completa.

## v4.49 — 2026-07-02

### Added
- **Barra de probabilidade também no card "ao vivo" do topo**: antes só aparecia nos cards de jogo da aba Jogos — agora aparece embaixo do placar no card ao vivo do hero também, mesmo cálculo (compartilhado via `liveProbBarsHtml`, sem duplicar lógica).
- **Tentativa de usar o modelo de probabilidade real da ESPN**: além do cálculo próprio (Poisson com base na força dos times), o app agora tenta buscar a probabilidade real da ESPN (`sports.core.api.espn.com/.../probabilities`, o mesmo tipo de modelo que alimenta os placares ao vivo deles) uma vez por ciclo de poll. Se a ESPN não devolver dado válido pra futebol (não documentado, não foi possível confirmar antes do deploy), cai automaticamente pro cálculo próprio — nunca quebra.

### Fixed
- **Texto cortado em fatias estreitas da barra de probabilidade** (ex: "Austria 3%" vazando pra fora da fatia azul): fatias abaixo de 12% agora escondem o texto (mantendo cor + tooltip ao passar o mouse) em vez de estourar o texto pra fora da barra.

## v4.48 — 2026-07-02

### Fixed
- **Relógio ao vivo ainda voltava pra trás a cada refresh da página**: a correção da v4.47 só funcionava enquanto a aba ficava aberta continuamente — o estado que protege contra retrocesso vivia só na memória do JavaScript, então um refresh (F5 / recarregar) zerava tudo e o primeiro poll depois do reload aceitava o valor (atrasado) da ESPN sem nenhuma referência anterior pra comparar. Agora o último relógio conhecido de cada partida é salvo no `localStorage` a cada poll, então mesmo logo após um refresh o app tem uma referência pra continuar contando pra frente em vez de voltar. Testado simulando exatamente esse cenário (tempo real avança, ESPN reporta atrasado, dá refresh) — o relógio não regride mais.

## v4.47 — 2026-07-02

### Fixed
- **Relógio ao vivo "resetando" ao voltar pra aba (durante o jogo da Espanha)**: o cronômetro interpolado podia visivelmente pular pra trás quando o app fazia um poll novo na ESPN logo depois do usuário sair e voltar pra página — o feed gratuito da ESPN atrasa em relação ao tempo real (tipicamente até ~1-2 min, pior logo após retomar). Adicionado `mergeLiveClock()`: se o valor novo da ESPN estiver *pouco* atrasado em relação ao que já estava na tela, o relógio continua contando a partir do valor extrapolado em vez de saltar pra trás. Um salto grande (ex: início do 2º tempo, prorrogação) continua passando normalmente — não é bloqueado.

## v4.46 — 2026-07-02

### Changed
- **Barras de probabilidade pré-jogo (Google-style)**: jogos agendados agora mostram a mesma barra visual colorida que os jogos ao vivo — barra proporcional ao % de vitória de cada time, com "ET/Pen." no meio para mata-mata e "Emp" para fase de grupos
- **Label correto nas barras**: fase de grupos usa "Emp"; mata-mata usa "ET/Pen." — tanto em live quanto pré-jogo
- **Auto-scroll Jogos**: ao clicar na aba Jogos, a lista rola automaticamente até o próximo jogo agendado

### Fixed
- **i18n barras (A1)**: "Emp" hardcoded em português substituído por `t("probDrawShort")` — usuários en-US/es veem "D"/"Emp"
- **90' empatado mata-mata (C2)**: barras ocultas quando relógio ≥ 90 min e jogo empatado em mata-mata (evitava "Emp 100%")
- **ARIA prob-bars (C1)**: `role="meter"` inválido removido; substituído por `role="group"` com `aria-label` localizado
- **Debounce scheduleMC (A3)**: flag `_mcPending` evita múltiplos `setTimeout` enfileirados
- **copaExpectedGoals NaN (M1)**: guard para `total=0` retorna lambdas neutras 1.2/1.2
- **matchProb normalizado (M4)**: probabilidades de vitória/empate/derrota somam exatamente 100%
- **parseMinute (M2/M3)**: string vazia retorna -1 (sem barras); "0:00" retorna 0 (barras mostram no kick-off)
- **probsNoData**: texto atualizado sem referência obsoleta a "início do mata-mata"

## v4.45 — 2026-07-02

### Added
- **Aba "Probabilidades"**: nova seção com simulação Monte Carlo (2.000 iterações) da Copa do Mundo 2026. Mostra P(Campeão), P(Final) e P(Semi) para cada seleção ainda no torneio, usando modelo Poisson bivariado com os ratings de força das equipes. Botão "Recalcular" + cache de 5 minutos para não sobrecarregar.
- **Barras de probabilidade ao vivo**: durante partidas em andamento, barras animadas (tipo Google) abaixo do placar mostram probabilidades dinâmicas de vitória/empate/derrota conforme o jogo avança e gols são marcados.
- **Hint de probabilidade por jogo**: jogos ainda não disputados mostram um hint discreto (ex: "🎲 Brasil 62% · Emp 21% · Japão 17%") abaixo do local, calculado com as mesmas ratings de força.

## v4.44 — 2026-07-02

### Fixed
- **Banner "jogo encerrado" — botão admin quebrado**: o botão "🔐 Admin → enviar emails" usava `onclick="showSection('admin')"` inline, que era bloqueado pelo CSP (`script-src` sem `'unsafe-inline'`) e também não encontrava a função (dentro do IIFE). Migrado para `data-banner-nav="admin"` com handler no event delegation existente.
- **Botão de salvar em modo edição**: o bloco `finally` de `saveEntry()` sempre restaurava o texto "Salvar entrada", mesmo quando o usuário estava no modo edição de palpites. Agora restaura "Atualizar entrada" se `_editingEntry` ainda estiver ativo (ex: validação falhou e o modo ainda está ativo).
- **Campo de senha admin não limpo após tentativa errada**: ao errar a senha, o campo `#adminPassword` não era apagado, deixando o texto visível para quem pudesse ver a tela. Agora é limpo imediatamente após uma tentativa falha.

## v4.43 — 2026-07-02

### Fixed
- **Countdown sem jitter de tamanho**: horas e minutos agora são sempre 2 dígitos (padStart "0"), igual aos segundos. Somado a `font-variant-numeric: tabular-nums` e `min-width: 2ch` nos dígitos, a caixa do countdown não muda mais de largura a cada segundo.

### Added
- **Versão e última sincronização discreta no rodapé**: rodapé minúsculo (11px, opacity 60%) mostra `v4.43 · sync 02/07 14:32 ET` — útil para confirmar visualmente que o deploy chegou e quando foi a última sincronização com o Supabase.

## v4.42 — 2026-07-02

### Added
- **Notificação automática de jogo encerrado (browser)**: quando o ESPN confirma que um jogo acabou (live → não-live na próxima poll), aparece um banner verde sticky no topo da página com o placar e um botão "📧 Enviar emails agora". Se o admin estiver logado, o sync do ESPN já roda silenciosamente antes de mostrar o botão. Se não estiver logado, o banner mostra um link para a aba Admin.
- **GitHub Actions — disparo manual**: removido o cron de `auto_results.yml`; o workflow agora só dispara via `workflow_dispatch` (botão "Run workflow" no GitHub.com ou app mobile). Roda `send_result_email.py --auto` que sincroniza ESPN → Supabase → envia emails para todos, de forma idempotente (não envia duplicatas).

### Changed
- `runEspnUpdate()` aceita `{ silent: true }` para rodar sem alerts quando chamado automaticamente pela detecção de fim de jogo.

## v4.41 — 2026-07-02

### Added
- **Contador de placares exatos em "Ver palpites"**: no final da tabela de palpites de cada entrada (na aba Ranking), agora mostra quantos placares exatos aquela entrada acertou — o mesmo número usado no primeiro nível do critério de desempate, pra facilitar entender por que uma entrada ficou acima de outra com o mesmo total. Reaproveita `exactMatchCount()`, sem duplicar a lógica.

## v4.40 — 2026-07-02

### Added
- **Critério de desempate no ranking**: definido depois de um print no grupo mostrando dois primeiros lugares empatados. Cascata: (1) pontos totais, (2) mais placares exatos, (3) mais acertos de campeão/vice/3º lugar. Se ainda empatar depois dos três níveis, a posição (e o prêmio daquela colocação) é dividida entre os empatados — igual já acontecia visualmente, só que agora é decisão explícita, não um efeito colateral da ordenação estável. Implementado de forma consistente no ranking do site, no gerador de e-mail em JS (usado pelo botão de admin) e no script Python do cron automático (`send_result_email.py`), incluindo a resolução da árvore do mata-mata para achar o campeão/vice/3º previstos por cada entrada.
- Nova regra no site (`rulesStandingsTie`) documentando o critério, nos três idiomas.

## v4.39 — 2026-07-01

### Fixed
- **Relógio ao vivo correndo**: o cronômetro do card ao vivo agora conta os segundos em tempo real entre polls do ESPN (antes ficava estático mostrando só minutos, atualizava só a cada 60s). ESPN retorna segundos inteiros, mas o relógio avança continuamente via interpolação.
- **Ranking ao vivo mostra posição geral, não posição no jogo**: a tabela de pontuação provisória agora é ordenada pelo total geral provisional (não pelos pontos daquele jogo específico) e exibe a posição real do participante no ranking geral — ex.: "3°" quer dizer 3° no bolão inteiro, não 3° entre quem apostou naquele jogo.
- **Jogo encerrado não fica mais "Em andamento"**: ao término da partida (ESPN confirma FULL_TIME), o card some corretamente e mostra o próximo jogo. Antes ficava mostrando "Em andamento" por até 3 horas após o apito. Novo comportamento: jogo ignorado após 135 min do horário de kickoff sem placar ao vivo confirmado.
- **BUG-04 crítico — entrada manual de resultado reativada**: admin pode agora inserir resultado manualmente para jogos com empate no placar (que vão a pênaltis). Antes `box.innerHTML = ""` desabilitava o painel inteiramente.
- **BUG-01 — pontuação funciona offline/sem sync**: `scoreEntry()` agora usa os resultados hardcoded de data.js como fallback quando o admin ainda não rodou o ESPN sync. M73 (Canadá) e M74 (Brasil) agora pontuam corretamente para usuários com localStorage limpo.
- **BUG-03 — isToday() usa timezone correto**: comparação de "hoje" agora usa `America/New_York` em vez de comparar UTC com local, eliminando o falso "jogo de hoje" quando se está a leste do ET.
- **BUG-05 — autoFill respeita R32 bloqueadas**: ao usar ⚡ Simular ou 🎲 Simular Maluco no modo de edição, os campos R32 (M73–M88) bloqueados para edição não são mais sobrescritos.
- **A11Y-01 — foco se move ao trocar seção**: ao clicar nas abas de navegação, o foco do teclado/leitor de tela vai automaticamente para o primeiro cabeçalho daquela seção.
- **A11Y-02 — aria-label contextual em "Ver palpites"**: o botão agora inclui o nome da entrada no aria-label, facilitando navegação por leitor de tela.
- **SEC-05 — flag() escapado em innerHTML**: todos os usos de `flag()` dentro de templates HTML agora passam por `escapeHtml()` para evitar possível XSS via nomes de times.

## v4.35 — 2026-07-02

### Added
- **Posição numerada na pontuação ao vivo**: a lista de pontuação provisória (embaixo do placar no hero e no dropdown da aba Jogos) agora mostra o número da posição (1, 2, 3...) de cada entrada, junto com a seta ▲/▼, em vez de só a seta ao lado do nome.

## v4.34 — 2026-07-02

### Added
- **Pontuação ao vivo direto no card do topo**: o card "ao vivo" no hero agora mostra, sempre visível logo abaixo do placar, a lista de quem apostou o quê naquela partida e quantos pontos cada um estaria fazendo com o placar atual (com as setas ▲/▼) — antes isso só existia escondido atrás do botão "Ver pontuação ao vivo" na aba Jogos. Reaproveita a mesma `liveMatchPointsTable()`, sem duplicar lógica.

## v4.33 — 2026-07-02

### Changed
- **Card "ao vivo" do topo redesenhado, estilo Google**: o card de partida ao vivo no hero agora segue o layout do placar ao vivo do Google (referência enviada pelo Eduardo) — bandeira de cada time em um selo arredondado, nome do time embaixo, placar grande dos dois lados, e no centro um badge "AO VIVO" com o cronômetro (MM:SS) sublinhado em vermelho. Antes era um bloco empilhado (badge/placar/times em texto corrido); agora é times-placar-badge-placar-times, igual à referência.

## v4.32 — 2026-07-02

### Added
- **Setas de variação também no placar ao vivo por partida**: o dropdown "🔴 Ver pontuação ao vivo" de cada jogo em andamento agora mostra ▲/▼ ao lado de cada entrada, indicando se ela subiu ou desceu na pontuação provisória *daquela partida* desde a última mudança no placar ao vivo — igual à tabela do Brasileirão em tempo real no Globo Esporte. Reaproveita a mesma lógica de setas do ranking geral (extraída para `computeRankArrows(key, items)`, agora compartilhada entre o ranking oficial e cada partida ao vivo, uma "trilha" de setas por jogo).
- Texto de aviso do placar ao vivo reforçado nos três idiomas: deixa explícito que o banco de dados e o ranking oficial só atualizam quando a partida termina oficialmente — nunca durante o jogo. A pontuação/setas ao vivo são só uma prévia no navegador, nunca gravadas no Supabase.

## v4.31 — 2026-07-01

### Fixed
- **Cache-busting parado desde v4.19**: os `?v=` de `styles.css`/`config.js`/`data.js`/`i18n.js`/`app.js` no `index.html` não eram atualizados desde a v4.19, mesmo com várias releases depois (v4.20–v4.30). Navegadores (principalmente mobile) continuavam servindo os arquivos antigos do cache em vez de buscar a versão nova após cada deploy. Atualizado para `?v=4.31` — provável causa de "não estou vendo as mudanças no celular".
- **Card "Próximo jogo" quebrado no mobile**: o cronômetro (HRS/MIN/SEG) herdava a regra `.count-grid { grid-template-columns: repeat(2, 1fr) }` do breakpoint `max-width:500px` — pensada para o countdown de 4 células (dias/hrs/min/seg) do banner principal — fazendo o cronômetro de 3 células quebrar em 2+1 de forma feia. Adicionado override específico para `.next-match-timer` restaurando 3/4 colunas. Também: o card agora empilha (informação do jogo em cima, cronômetro embaixo, full-width) em telas estreitas em vez de espremer o cronômetro ao lado do nome dos times, evitando que a altura do card varie de forma estranha conforme o tamanho do nome dos times (ex: "Bosnia and Herzegovina").

## v4.27 — 2026-07-01

### Added
- **Pontuação ao vivo por jogo**: nos cards de jogos em andamento (aba Jogos), um botão "🔴 Ver pontuação ao vivo" abre uma lista com cada entrada, seu palpite e quantos pontos ela faria *se o placar atual valesse agora* — provisório, não escreve em `state().results`, só conta oficialmente quando o admin confirmar o resultado. O dropdown fica aberto entre atualizações (a cada poll de 60s) em vez de fechar sozinho.
- **Cronômetro em minutos e segundos**: o badge "🔴 Ao vivo" agora mostra o tempo decorrido da partida como MM:SS (ex: "63:27"), usando o campo `status.clock` (segundos) da ESPN em vez do texto resumido (que só tinha o minuto).
- **Setas de variação no ranking**: cada posição no ranking agora mostra ▲ ou ▼ quando a colocação da entrada mudou desde a última vez que a pontuação oficial mudou (estilo tabela de campeonato). Não pisca em re-renders que não mudam a pontuação (troca de idioma, etc.) — só atualiza quando o placar oficial de fato muda.
- Chaves i18n novas (`liveToggleShow`, `liveEntryCol`, `livePickCol`, `livePointsCol`, `liveProvisionalNote`, `liveNoPicks`, `rankUp`, `rankDown`) nos três idiomas.

## v4.26 — 2026-07-01

### Added
- **Pontos por partida no ranking**: a tabela de palpites ("Ver palpites" em cada entrada do ranking) agora mostra, para cada jogo do mata-mata, o resultado real e quantos pontos a entrada ganhou naquela partida especificamente — não só o total. Colunas novas: "Resultado real" e "Pontos" (destacado em verde quando > 0).
- Chaves i18n `pickRealLabel` e `pickPointsLabel` nos três idiomas.

### Changed
- **Refatoração (sem mudança de comportamento)**: a lógica de pontuação por partida foi extraída de `scoreEntry` para uma função compartilhada `matchPoints(pick, result)`, reutilizada tanto no cálculo do total quanto na nova coluna de pontos — elimina duplicação e garante que os dois lugares nunca divirjam. `scoreEntry` continua retornando exatamente `{ total, bonus }` como antes; verificado que o total por entrada não mudou.

### Fixed (correção de atribuição)
- Sugestão de placar/pontuação ao vivo (v4.25) foi do Alan (participante), não do Eduardo — corrigido em `docs/bolao/BUGS_AND_FEEDBACK.md`.

## v4.25 — 2026-07-01

### Added
- **Placar ao vivo na aba Jogos**: sugestão de usuário — a aba "Jogos" agora busca a fonte ESPN (já usada no sync do admin) a cada 60s, para qualquer visitante, e mostra um badge "🔴 Ao vivo" com o minuto/status do jogo em andamento, sem precisar de login admin. O placar ao vivo é só exibição — não escreve em `state().results`, então não afeta a pontuação até o admin aplicar o resultado oficial (mantém a proteção contra sobrescrita manual já existente).
- **Ranking com auto-atualização**: o ranking (pontuação) agora recarrega do Supabase a cada 90s enquanto a aba está visível, além dos gatilhos existentes (foco/visibilitychange). Participantes veem a pontuação mudar sem precisar trocar de aba ou dar refresh.
- Novas chaves i18n `gameLive` e `gamesLiveNote` nos três idiomas.

## v4.15 — 2026-06-29

### Added
- **Botão "📧 Email a todos" e "📧 Teste (admin)" no painel admin**: Envia o email de resultado parcial diretamente do browser (funciona no celular). Usa EmailJS já configurado. Botão Teste envia só para o admin; botão principal envia para todos os participantes com email válido. Reusa `scoreEntry`, `resolveSlot` e `escapeHtml` já existentes.

### Updated
- **Resultados**: Match 73 (África do Sul 0–1 Canadá) e Match 74 (Brasil 2–1 Japão) atualizados em `data.js` e Supabase.

---

## v4.13 — 2026-06-28

### Fixed (arquitetural)
- **Resultados somente do banco de dados**: `mergeStates` e `saveRemoteState` agora usam exclusivamente `remote.results` — o localStorage nunca mais contribui com resultados. Se o Supabase não tem um resultado, o app mostra zero. Elimina o bug onde outro dispositivo com localStorage antigo/de-teste populava resultados incorretos no ranking.

---

## v4.12 — 2026-06-28

### Fixed
- **Resultados incorretos (M73/M74/M78)**: Removidos diretamente do Supabase — provavelmente vieram do localStorage de teste de outro dispositivo sincronizado via ESPN sync antes dos jogos começarem.
- **Painel de resultados manuais desativado**: `renderAdminResults()` agora renderiza nada. Resultados só via botão ⚽ ESPN (automático). Para reativar em emergência: trocar `renderAdminResults(s)` por `renderAdminResultsManual(s)` em `renderAdmin()`.

---

## v4.11 — 2026-06-28

### Added
- **Botão ☁️ Sync remoto**: força descarte do localStorage e recarrega do Supabase — corrige dispositivos com entradas de teste persistindo no localStorage depois de tombstones propagados.

### Fixed
- **Proteção de entradas de hoje**: `deleteEntry` agora permite deletar entradas com `diagnostics.demo = true` mesmo sendo de hoje. Entradas reais de hoje continuam protegidas.

---

## v4.10 — 2026-06-28

### Fixed
- **Entradas de participantes não aparecendo**: `loadRemoteState` ignorava entradas do Supabase quando o timestamp local era mais recente (ex: admin tinha salvo algo após o participante). Correção: merge sempre acontece em `loadRemoteState` — entradas são sempre união (com tombstones), nunca descartadas por timestamp.
- **Valor do pot restaurado**: `#potValue` recolocado no cabeçalho do Ranking. Mostra `$N` baseado no número de entradas marcadas como pagas × `CONFIG.entryFee`.
- **Ícones SVG de pagamento**: CashApp, Zelle e Venmo agora usam os arquivos SVG de `assets/` em vez de emoji em todos os cards de pagamento.
- **Ícones admin faltantes**: botões `adminDemoData` (🎭), `adminRefreshFootball` (⚽) e `apiFootballRefreshResults` (🔄) receberam emojis alinhados com o restante da toolbar.

---

## v4.9 — 2026-06-28

### Fixed
- **Deletadas voltando do Supabase**: `mergeStates` era uma união aditiva — nunca removia entradas, só adicionava. Se o Supabase ainda tinha uma entrada deletada, qualquer sync posterior (focus/visibilitychange) trazia ela de volta. Correção: tombstones (`deletedIds[]` no estado). IDs deletados são propagados no merge e filtram entradas tanto no local quanto no remoto. `deleteEntry` agora também salva imediatamente (`forceResults: true`) em vez de usar debounce 400ms, eliminando a janela de corrida.

---

## v4.8 — 2026-06-28

### Fixed
- **Payment marking redesigned**: replaced checkbox + `change` event with a toggle button + `click` event. iOS Safari has a known inconsistency where `change` events on checkboxes inside `<label>` elements can be swallowed in scrollable containers; `click` on a `<button>` is universally reliable.
- **Admin saves no longer debounced**: `saveState` with `forceResults: true` (all admin operations: payment, result entry, ESPN sync, clear) now fires `saveRemoteState` immediately instead of after 400ms. Eliminates the window where backgrounding the app on mobile could cancel the queued `setTimeout` before Supabase received the write.
- **Toggle UX**: payment button shows "Marcar pago" (secondary style) when unpaid, "✓ Pago" (green) when paid. Clicking again toggles back — admin can correct mistakes.

---

## v4.7 — 2026-06-28

### Fixed
- **Payment checkbox race condition**: the v4.6 `!opts.forceResults` branch only preserved remote `results` but not remote `paid`. A participant submitting an entry after admin marked a payment could silently overwrite `paid: {}` in Supabase, erasing the mark. Fix: now also merges remote `paid` using any-true-wins in the same branch.
- **Payment checkbox UX**: if the admin session expired (30-min timeout) when clicking a payment checkbox, `guardAdmin()` opened the login modal but the checkbox stayed visually checked (a lie — nothing was saved). Fix: checkbox now reverts to its prior state if `guardAdmin()` fails, so admin sees the action was blocked.
- **Payment save hardened**: payment checkbox saves now pass `{ forceResults: true }` to `saveState`, so the save goes through the direct upsert path (no accidental result merge clobbering the admin's fresh paid update).

---

## v4.6 — 2026-06-28

### Fixed (architecture)
- **`saveRemoteState` race condition**: non-admin saves (participant entry submissions) could overwrite admin real results in Supabase when `localAt > remoteAt` caused the merge to be skipped. Fix: when `opts.forceResults` is not set (all non-admin saves), remote results are always merged back into the state before upserting — admin results can never be lost by a participant save.
- **`saveState` / `saveRemoteState`**: added `opts = {}` parameter. Admin operations (`commitRealResult`, `runEspnUpdate`, `applyApiResultsToState`, `clearAllData`) now pass `{ forceResults: true }` to bypass the remote-results-merge, allowing admin to explicitly set or clear results.

### Verified (no bug)
- Cross-checked all writes to `state().results`: only 4 sites, all behind `guardAdmin()` / `isAdminActive()`. Participant `saveEntry` has no write path to `state().results`.

---

## v4.5 — 2026-06-28

### Data
- `data.js`: GS-63 to GS-72 (June 26–27 group stage matches) updated with final scores.
- `data.js`: All Round of 32 team placeholders resolved with actual qualified teams (Paraguay, Norway, France, Sweden, Ecuador, England, DR Congo, Belgium, Senegal, Spain, Austria, Portugal, Croatia, Algeria, Egypt, Cape Verde, Colombia, Ghana).

---

## v4.4 — 2026-06-28

### Added
- **ESPN free results sync** (botão "⚽ ESPN" no admin toolbar): busca todos os jogos encerrados da Copa 2026 via `site.api.espn.com` — sem API key, sem limite de requisições.
  - Cobre **grupo + mata-mata**: resultados de grupos são armazenados em `state().results` e aparecem imediatamente no tab Jogos; mata-mata atualiza o ranking.
  - Não sobrescreve resultados já inseridos manualmente pelo admin.
  - Empates no mata-mata são ignorados automaticamente — admin escolhe o avançado no painel de resultados.
  - Conversão UTC→ET para evitar mismatch de data em jogos noturnos.
- CSP `connect-src` atualizado para incluir `https://site.api.espn.com`.

### Fixed
- `renderGames()`: status badge agora usa `r?.goalsA !== undefined` (antes `r?.advanceSide`) — jogos de grupo sem `advanceSide` agora marcam "Final" corretamente.

---

## v4.3.1 — 2026-06-27

### Fixed
- `renderGames()`: Jogos tab now overlays `state().results` scores on knockout matches — admin-entered results are immediately visible to all participants without refreshing.
- `commitRealResult()`: calls `renderGames()` after saving so the Jogos tab updates instantly when admin enters a knockout score.
- Admin payments checkbox: now calls `renderAdminPayments(state())` after save so the admin panel explicitly re-renders from the saved state, preventing a visual race with the Supabase debounce reload.

---

## v4.3-patch — 2026-06-27

Optional API-Football live results polling added to admin panel.

### Added
- `fetchApiFootballFixtures()`: fetches + caches fixtures from API-Football (10s AbortController timeout).
- `mapApiFootballToMatches()`: matches API fixtures to bracket match IDs by team name normalization + date. Skips unresolved placeholder slots ("Winner Match X", "1st Group H", etc.).
- `applyApiResultsToState()`: applies matched finished results to local+remote state. Never overwrites manual admin results. Skips draws (admin must choose winner).
- `startResultsPolling()` / `stopResultsPolling()`: 5-minute polling interval. Only runs while admin is active.
- `updateApiStatusBar()`: shows last update time, source, and auto-update status in admin panel.
- Admin button: "Atualizar resultados agora" (`#apiFetchResults`) — manual trigger.
- Status bar (`#apiStatusBar`) below admin toolbar: source · last update · auto on/off.
- `visibilitychange` handler: stops polling when tab hidden, resumes when visible + admin active.
- `window.focus` handler: resumes polling when admin active.
- Polling auto-starts on login and on session restore (page reload while admin active).
- 5 new i18n keys per language: `apiFootballRefreshResults`, `apiFootballLastUpdate`, `apiFootballSource`, `apiFootballAutoOn`, `apiFootballAutoOff` (pt-BR, es, en-US).

### Not changed
- Scoring, ranking, receipt, email, Supabase adapter, layout — untouched.
- `apiFootball.enabled=false` or empty `apiKey` → polling never starts, button does nothing.

---

## v4.2-patch — 2026-06-27

Surgical patch on v4.1-patch. Data updates and receipt improvements.

### Fixed / Updated
- `data.js`: All 32 knockout match venues now filled in (was "A confirmar"). Times added in EDT format for matches 74–104.
- `data.js`: Fixed M74 (Brazil vs Japan) kickoff time: 12:00 → 13:00 EDT.
- Sources: NBC Sports schedule + Wikipedia Copa 2026 knockout bracket.

### Added
- Receipt HTML: scoring legend section showing all point values.
- Receipt HTML: manual point verification table (fill-in area for double-checking scores).
- i18n: 12 new keys (`receiptLegendTitle`, `receiptLegendExact`, `receiptLegendAdvance`, `receiptLegendOneTeam`, `receiptLegendChampion`, `receiptLegendRunnerUp`, `receiptLegendThird`, `receiptLegendFourth`, `receiptCheckTitle`, `receiptCheckBy`, `receiptCheckDate`, `receiptCheckTotal`) added to all 3 languages (pt-BR, es, en-US).

### Confirmed (no change needed)
- Supabase already `enabled: true` in `config.js` with correct credentials.

---

## v4.1-patch — 2026-06-27

Surgical patch on v4.0-clean. No architecture changes.

### Fixed
- `mergeStates()`: `paid` now uses "any true wins" (payment confirmed on one device is never overwritten by another). `results` now uses remote-wins (admin is sole source of truth).
- `adminLogin()`: wrapped `sha256Hex()` in try/catch; alerts `adminLoginError` if `crypto.subtle` is unavailable (e.g. HTTP).
- `updateDynamic()`: `saveDraft()` now runs debounced at 400 ms instead of on every keystroke.
- CSP: removed unused `https://api.ipify.org` from `connect-src`.
- Supabase CDN: pinned to `@2.45.4`, added `integrity` (SRI) and `crossorigin="anonymous"`.
- Deleted `js/i18n-repair.js` (not loaded anywhere; legacy artifact).

### Added (optional improvements)
- Duplicate entry name check in `saveEntry()` — prompts confirmation before saving.
- `demo-badge` visual label on demo entries in ranking.
- CSS `:focus-visible` outline on buttons/inputs/selects for keyboard accessibility.
- `<link rel="canonical">` in `index.html`.
- i18n keys: `adminLoginError`, `duplicateEntryConfirm` (pt-BR, es, en-US).

---

## v4.0-clean — 2026-06-27

Full clean rebuild from scratch. No code carried over from v3.x.

### What changed
- Single IIFE `app.js` — no globals, no module bundler required.
- `config.js`, `data.js`, `i18n.js` are plain `window.*` assignments.
- Admin auth: SHA-256 via `crypto.subtle`, per-action `guardAdmin()`, 30-min session, lockout after N attempts.
- Bracket: slot resolution propagates across rounds; auto-advance when score is non-tie.
- Draft: `sessionStorage` with restore offer; key `bolao_draft_v4`.
- Scoring: called once per entry in `renderRanking`; bonus computed from `finalPodiumForEntry`.
- Supabase: merge-before-save (fetch remote `updated_at` first); local-first.
- i18n: 3 languages (PT-BR / ES-MX / EN-US), button toggle, no dropdown.
- Receipt: Blob URL — no `document.write`.
- EmailJS: `limitRate:{throttle:30000}`, HTML only via `html_message` field.
- CSV: `\r\n` line endings for Excel.
- CSP meta tag with all required directives.
- `escapeHtml` applied on every user-data DOM insertion.
- WhatsApp group button and QR in payment section.

### Removed from v3.x
- `i18n-repair.js` — no longer needed.
- PayPal payment method.
- All legacy patch files (`FIX_LOG_*`, `RELEASE_LOCK.md`).

---

## v3.3.4-stable-repair

- Removed visible language dropdown.
- Added timer seconds.
- Removed A/B score labels.
- Repaired rules i18n.
- Added Supabase focus/visibility reload and remote clear.

## v3.3.1-db-ui-fixes

- Desktop/mobile header fix.
- Language selector changed to flag buttons.
- Games view redesigned.
- Rules scoring table restored.
- Admin demo data restored.
- Optional API-Football refresh added as cached data only.

## v3.3-db-ready

- Optional Supabase remote state adapter.
- Local-first remote mirror.
- Phase labels polished.
- Supabase setup docs added.

## v3.2.1-rc1

- Final release-lock patch.
- Corrected UK nation flag emojis.
- Removed initial `Time A` / `Time B` dropdown flash.
- Softer score >20 guard while typing.
- Receipt HTML labels now use i18n.

## v3.0

- Clean rebuild from the unstable v2 branch.
- CSV backups, receipts, admin, ranking, i18n, EmailJS and validation stabilized.
